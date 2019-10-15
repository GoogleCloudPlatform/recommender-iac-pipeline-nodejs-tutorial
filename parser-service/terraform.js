/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * terraform.js manages tasks related to Terraform such as downloading the
 * terraform state from a GCP bucket and making changes to existing terraform
 * files based on recommendations received.
 */

const GIT_WORK_DIR_PATH = `/repo`
const TERRAFORM_STATE_BUCKET = process.env.TERRAFORM_STATE_BUCKET

const {Storage} = require('@google-cloud/storage')
const storage = new Storage()
const stateBucket = storage.bucket(TERRAFORM_STATE_BUCKET)
const fs = require('fs-extra')
const path = require('path')

/**
 * Pulls down current TF state from the GCS bucket
 *
 * @return the state json
 */
const getTFState = async () => {
  console.log('Started - Download TF State')

  const result = await stateBucket
    .file('terraform/state/default.tfstate')
    .download()

  const state = JSON.parse(result[0].toString())

  console.log('Completed - Download TF State', state)

  return state
}

/**
 * Compare the array created by parsing the recommendations payload to the
 * instances in the tf.state file to create an array of VMs that need to be
 * resized and were in the TF state file.
 *
 * @param state from terraform
 * @param vmList the list of VMs to be resized
 * @return list of VMs to be updated (also contains the TF resource name)
 */
const getVMResourcesByIdFromState = (state, vmList) => {
  const instancesFound = []

  for (const resource of state.resources) {
    if (resource.type == 'google_compute_instance') {
      resource.instances.forEach(instance => {
        vmList.forEach(vm => {
          if (vm.instanceID == instance.attributes.self_link) {
            instancesFound.push({
              ...vm,
              tfResourceName: resource.name
            })
          }
        })
      })
    }
  }

  return instancesFound
}

/**
 * Compare the array created by parsing the recommendations payload to the
 * instances in the tf.state file to create an array of IAM recommendations
 *
 * @param state from terraform
 * @param iamRecommendations the list of iam recommendations to be worked on
 * @return list of IAM members to be updated
 *         (also contains the TF resource name)
 */
const getIAMBindingsFromState = (state, iamRecommendations) => {
  const removeResourcesFound = []
  state.resources.forEach(resource => {
    if (resource.type == 'google_project_iam_binding') {
      resource.instances.forEach(instance => {
        iamRecommendations.forEach(recommendation => {
          if (instance.attributes.project == recommendation.project &&
              instance.attributes.role == recommendation.role &&
              instance.attributes.members.includes(recommendation.member)) {
                const recommentationWithResourceName =
                  {...recommendation, resourceName: resource.name}
                  removeResourcesFound.push(recommentationWithResourceName)
              }
        })
      })
    }
  })

  return removeResourcesFound
}

/**
 * Goes through the cloned repo and iterates through each TF manifest to see
 * if the VM that needs to be resized is found. If so, replaces the machine type
 *
 * @param repoPath the path to the terraform repository
 * @param resources a list of resources to apply
 * @param destPath is used for writing to a destination path for tests
 * @return list of recommendations (ids and etags) which have been applied in
 *         the repository
 *         [{id: string, etag: string}]
 */
const findAndModifyInstances = async (repoPath, resources, destPath) => {

  const recommendationsToClaim = []

  const writePath = destPath ? destPath : repoPath
  let originalFiles = await readAllTFFiles(repoPath)
  const tfFiles = await replaceVariableValuesInTFFiles(repoPath, originalFiles)

  resources.forEach(resource => {
    console.log('resource', resource)
    originalFiles = tfFiles.map((file, index) => {
      let expr =
        '(resource\\s+\\"google_compute_instance\\"\\s+\\"(' +
        resource.tfResourceName +
        ')\\".+?machine_type\\s+=\\s+)\\"([\\w -]+)\\"'

      var reg = new RegExp(expr, 'gs')
      const matches = reg.exec(file.contents)
      if (matches) {
        recommendationsToClaim.push({
          id: resource.recommendationID,
          etag: resource.recommendationETAG
        })

        const indexOfMember = matches[0].indexOf(`machine_type`)

        const lineNumToReplace =
            findLineNumbersFromCharacters(
              file.contents, matches.index + indexOfMember)

        const contents = replaceLine(
          originalFiles[index].contents,
          lineNumToReplace,
          `  machine_type = "${resource.size}"`
        )

        console.log('contents', contents)
        return {
          ...file,
          contents: contents
        }
      } else {
        return originalFiles[index]
      }
    })
  })

  // Write the results back to the file
  await Promise.all(originalFiles.map(async file => {
    const filePath = file.path.replace(repoPath, writePath)
    await fs.writeFile(filePath, file.contents)
  }))

  return recommendationsToClaim
}

/**
 * Reads all TF files in a repository and extracts the full path and contents
 * of those files
 *
 * @param repoDir the path to the terraform repository
 * @return list of TF files (object)
 */
const readAllTFFiles = async (repoDir) => {
  const allFiles = await fs.readdir(repoDir)

  const tfFiles = allFiles.filter(file => {
    const fullPath = path.join(repoDir, file)
    if (!fs.statSync(fullPath).isDirectory()) {
      const extension = file.split('.')[1]
      return extension.toLowerCase() == 'tf' ? true : false
    } else {
      return false
    }
  })

  return await Promise.all(tfFiles.map(async file => {
      const fullPath = path.join(repoDir, file)
      const contents = (
        await fs.readFile(fullPath)).toString()
      return {
        path: fullPath,
        contents: contents
      }
  }))
}

/**
 * Reads the TFVars file and extracts variable names and values
 *
 * @param variableFilePath the path to the tfvars file
 * @return An object containing all the variables and their values
 */
const getTFVariables = async (variableFilePath) => {
  const variables = {}
  if (await fs.exists(variableFilePath)) {
    const contents = (
      await fs.readFile(variableFilePath)).toString()
    const lines = contents.split('\n')
    lines.forEach(line => {
      const values = line.split('=')
      variables[values[0].trim()] =
        values[1].replace(/\"/g, "").trim()
    })
  }

  return variables
}

/**
 * Replaces variable values in TF contents using regular expressions
 *
 * @param repoDir the path to the repo
 * @param tfContents the contents of each file
 * @return list of new contents
 */
const replaceVariableValuesInTFFiles = async (repoDir, tfContents) => {
  const variableFilePath = path.join(repoDir, 'terraform.tfvars')
  const variables = await getTFVariables(variableFilePath)
  return tfContents.map(file => {

    // Loop through each variable and replace
    let contents = file.contents
    Object.keys(variables).forEach(variable => {
      var reg = new RegExp(
        '\\${\\s*var\\.' + variable + '\\s*}', 'gs')

      contents = contents.replace(reg, variables[variable])
    })

    return {
      path: file.path,
      contents: contents
    }
  })
}

/**
 * Replaces Service Account values in TF contents using regular expressions
 *
 * @param tfContents the contents of each file
 * @return list of new contents
 */
const replaceServiceAccountValues = (tfContents) => {
  // Find all service accounts and create map serviceacccountname -> account_id
  const serviceAccounts = {}
  tfContents.forEach(file => {
    var reg = new RegExp(
      'resource\\s*"google_service_account"\\s*"(\\w+)"\\s*{.+?account_id\\s*=\\s*"(\\w+)".+?}', 'gs')

    const groups = reg.exec(file.contents)
    if (groups) {
      serviceAccounts[groups[1]] = groups[2]
    }
  })

  if (Object.keys(serviceAccounts).length > 0) {
    // Find google_project_iam_binding elements and replace service account_Id
    return tfContents.map(file => {

      // Loop through each variable and replace
      let contents = file.contents
      Object.keys(serviceAccounts).forEach(sa => {
        var reg = new RegExp(
          '\\${\\s*google_service_account\\.' + sa + '\\.account_id\\s*}', 'gs')

        contents = contents.replace(reg, serviceAccounts[sa])
      })

      return {
        path: file.path,
        contents: contents
      }
    })
  } else {
    return tfContents
  }
}

/**
 * Goes through the cloned repo and iterates through each TF manifest to see
 * if the IAM member for which role is changed needs to be updated
 *
 * @param repoPath the path to the terraform repository
 * @param resources a list of resources to apply
 * @param destPath is used for writing to a destination path for tests
 * @return list of recommendation (ids and etags) which have been applied in
 *         the repository
 */
const findAndModifyIAMRoleBindings = async (repoPath, resources, destPath) => {

  const recommendationsToClaim = []

  const writePath = destPath ? destPath : repoPath
  let originalFiles = await readAllTFFiles(repoPath)
  tfFiles = await replaceVariableValuesInTFFiles(repoPath, originalFiles)
  tfFiles = replaceServiceAccountValues(tfFiles)

  resources.forEach(resource => {
    originalFiles = tfFiles.map((file, index) => {
      let expr =
        'resource\\s+"google_project_iam_binding"\\s+"' +
        resource.resourceName +
        '"\\s+{.+?project\\s*=\\s*"' +
        resource.project +
        '".+?role\\s*=\\s*"' +
        resource.role +
        '".+?members\\s*=\\s*(\\[.+?"' +
        resource.member + '".+?\\]).+?}'

      var reg = new RegExp(expr, 'gs')
      const matches = reg.exec(file.contents)
      if (matches) {
        recommendationsToClaim.push({
          id: resource.recommendationID,
          etag: resource.recommendationETAG
        })
        let members = JSON.parse(matches[1])
        members = members.filter(mem => mem != resource.member)
        if (members.length > 0) {
          // Remove only members part
          // Find location of members match

          const indexOfMember = matches[0].indexOf(`"${resource.member}"`)
          console.log('indexOfMember', indexOfMember)
          const lineNumToComment =
            findLineNumbersFromCharacters(
              file.contents, matches.index + indexOfMember)

          const contents = commentLines(
            originalFiles[index].contents,
            lineNumToComment,
            lineNumToComment)

          return {
            ...file,
            contents: contents
          }
        } else {
          // Remove full section
          const startLine =
            findLineNumbersFromCharacters(
              file.contents, matches.index)

          const endLine =
            findLineNumbersFromCharacters(
              file.contents, matches.index + matches[0].length)

          let contents = commentLines(
            originalFiles[index].contents,
            startLine,
            endLine)

          // If add resource present
          let additionalLines = ''
          if (resource.add) {

            additionalLines = '\n\n'

            additionalLines += copyLines(
              originalFiles[index].contents,
              startLine,
              endLine
            )

            additionalLines =
              additionalLines.replace(
                /(.+role\s*=\s*").+?(".+)/gs, `$1${resource.add}$2`)
          }

          return {
            ...file,
            contents: contents + additionalLines
          }
        }
      } else {
        return originalFiles[index]
      }
    })
  })

  // Write the results back to the file
  await Promise.all(originalFiles.map(async file => {
    const filePath = file.path.replace(repoPath, writePath)
    await fs.writeFile(filePath, file.contents)
  }))

  return recommendationsToClaim
}

/**
 * Finds the line number given the character count
 *
 * @param text to search through
 * @param index of the character
 * @return line number
 */
const findLineNumbersFromCharacters = (text, index) => {
  // Find line breaks
  let num = 1
  for (let i = 0; i <= index; i++) {
    if (text[i] == '\n') {
      num += 1
    }
  }
  return num
}

/**
 * Comments lines specified in the contents
 *
 * @param text to comment lines in
 * @param startLine starting line to comment
 * @param endLine end line to comment
 * @return the new contents
 */
const commentLines = (text, startLine, endLine) => {
  let allLines = text.split('\n')
  allLines[startLine - 1] = '/* ' + allLines[startLine - 1]
  allLines[endLine - 1] = allLines[endLine - 1] + ' */'
  return allLines.join('\n')
}

/**
 * Copy between line number in contents
 *
 * @param text of the contents
 * @param startLine starting line to copy
 * @param endLine end line to copy
 * @return the copied lines
 */
const copyLines = (text, startLine, endLine) => {
  let allLines = text.split('\n')
  return allLines.slice(startLine - 1, endLine).join('\n')
}

/**
 * Replace a line at index with contents
 *
 * @param contents
 * @param lineNum to replace
 * @param text to replace with
 * @return new contents
 */
const replaceLine = (contents, lineNum, text) => {
  let allLines = contents.split('\n')
  allLines[lineNum - 1] = text
  return allLines.join('\n')
}

/**
 * Applies the VM resize recommendations to the TF files in the repository.
 * The TF State is first obtained from a bucket in GCS. Then the terraform
 * resource names are obtained for each of the resources in the TF file and
 * finally the recommendations are applied
 *
 * @param repoName name of the repo path
 * @param vmResizeRecommendations the list of vm recommendations to be worked on
 *        [{instanceID: string, size: int, recommendationID: string,
 *           recommendationETag: string}]
 * @return list of recommendations and etags that have been claimed
 *         [{recommendationID: string, recommendationETag: string}]
 */
const applyVMResizeRecommendations = async (repoName, vmResizeRecommendations) => {

    let recommendationsToClaim = []

    // Download TF State
    const tfState = await getTFState()

    // Find recommendation in state
    let resourceNames = getVMResourcesByIdFromState(
      tfState, vmResizeRecommendations)

    // Make changes to file
    if (resourceNames.length > 0) {
      recommendationsToClaim = await findAndModifyInstances(
        `/repo/${repoName}`, resourceNames)
    }

    return recommendationsToClaim
}

/**
 * Applies the IAM recommendations to the TF files in the repository.
 * The TF State is first obtained from a bucket in GCS. Then the terraform
 * resource names are obtained for each of the resources in the TF file and
 * finally the recommendations are applied
 *
 * @param repoName name of the repo path
 *        string
 * @param iamRecommendations the list of iam recommendations to be worked on
 *        [{project: string, member: string, role: string,
 *           add: string, recommendationID: string, recommendationETag: string}]
 * @return list of recommendations and etags that have been claimed
 *         [{recommendationID: string, recommendationETag: string}]
 */
const applyIAMRecommendations = async (repoName, iamRecommendations) => {

    let recommendationsToClaim = []

    // Download TF State
    const tfState = await getTFState()

    // Find recommendation in state
    let resourceNames = getIAMBindingsFromState(tfState, iamRecommendations)

    // Make changes to file
    if (resourceNames.length > 0) {
      recommendationsToClaim = await findAndModifyIAMRoleBindings(
        `/repo/${repoName}`, resourceNames)
    }

    return recommendationsToClaim
}

module.exports = {
  GIT_WORK_DIR_PATH,
  applyVMResizeRecommendations,
  applyIAMRecommendations
}

