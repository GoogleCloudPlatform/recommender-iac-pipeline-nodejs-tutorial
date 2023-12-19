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

import { Storage } from '@google-cloud/storage';
import { Resource } from '@google-cloud/resource';
import fs from 'fs-extra';
import path from 'path';

const GIT_WORK_DIR_PATH = '/repo';
const TERRAFORM_STATE_BUCKET = process.env.TERRAFORM_STATE_BUCKET;

const storage = new Storage();
const stateBucket = storage.bucket(TERRAFORM_STATE_BUCKET);
const resource = new Resource();

/**
 * Fetches the Terraform state from the bucket and returns it as a JSON object.
 * @return {Object} The Terraform state in JSON format.
 */
const getTFState = async () => {
  const result = await stateBucket
    .file('terraform/state/default.tfstate')
    .download();

  const state = JSON.parse(result[0].toString());
  return state;
};

/**
 * Finds and returns virtual machine resources by their IDs from the Terraform state.
 * @param {Object} state The Terraform state.
 * @param {Array} vmList The list of VM identifiers.
 * @return {Array} List of VM resources found.
 */
const getVMResourcesByIdFromState = (state, vmList) => {
  const instancesFound = [];
  const instanceIdPrefixToRemove = '//compute.googleapis.com/';

  for (const resource of state.resources) {
    if (resource.type === 'google_compute_instance') {
      resource.instances.forEach(instance => {
        vmList.forEach(vm => {
          if (
            vm.instanceID.substring(instanceIdPrefixToRemove.length) ===
            instance.attributes.id
          ) {
            instancesFound.push({
              ...vm,
              tfResourceName: resource.name,
            });
          }
        });
      });
    }
  }

  return instancesFound;
};

/**
 * Gets the project number from the given project ID.
 * @param {string} projectID The Google Cloud Project ID.
 * @return {Promise<string>} The project number.
 */
const getProjectNumberFromProjectID = async projectID => {
  const project = resource.project(projectID);
  const projectInfo = await project.get();
  return projectInfo[0].metadata.projectNumber;
};

/**
 * Retrieves IAM bindings based on recommendations.
 * @param {Object} state The Terraform state.
 * @param {Array} iamRecommendations The list of IAM recommendations.
 * @param {boolean} isStub Flag to indicate if it's a stub.
 * @return {Promise<Array>} The list of resources to remove.
 */
const getIAMBindingsFromState = async (state, iamRecommendations, isStub) => {
  const removeResourcesFound = [];
  const projectMapping = new Map();

  for (const { instances } of state.resources) {
    for (const { attributes } of instances) {
      let projectNumber = projectMapping.get(attributes.project);

      if (!projectNumber) {
        projectNumber = isStub
          ? attributes.project
          : await getProjectNumberFromProjectID(attributes.project);

        projectMapping.set(attributes.project, projectNumber);
      }
    }
  }

  state.resources.forEach(({ type, instances, name }) => {
    if (type === 'google_project_iam_binding') {
      instances.forEach(({ attributes }) => {
        iamRecommendations.forEach(recommendation => {
          const projectNumber = projectMapping.get(attributes.project);

          if (
            projectNumber === recommendation.project &&
            attributes.role === recommendation.role &&
            attributes.members.includes(recommendation.member)
          ) {
            removeResourcesFound.push({
              ...recommendation,
              resourceName: name,
              project: attributes.project,
            });
          }
        });
      });
    }
  });

  return removeResourcesFound;
};

/**
 * Finds and modifies instance sizes based on recommendations.
 * @param {string} repoPath The repository path.
 * @param {Array} resources The resources to find and modify.
 * @param {string} [destPath] Optional destination path for modified files.
 * @return {Promise<Array>} List of recommendations claimed.
 */
const findAndModifyInstances = async (repoPath, resources, destPath) => {
  const recommendationsToClaim = [];
  const writePath = destPath || repoPath;

  let originalFiles = await readAllTFFiles(repoPath);
  const tfFiles = await replaceVariableValuesInTFFiles(repoPath, originalFiles);

  resources.forEach(resource => {
    originalFiles = tfFiles.map((file, index) => {
      const expr = new RegExp(
        `(resource\\s+"google_compute_instance"\\s+"${resource.tfResourceName}".+?machine_type\\s+=\\s+)"([\\w -]+)"`,
        'gs'
      );

      const matches = expr.exec(file.contents);
      if (matches) {
        recommendationsToClaim.push({
          id: resource.recommendationID,
          etag: resource.recommendationETAG,
        });

        const lineNumToReplace = findLineNumbersFromCharacters(
          file.contents,
          matches.index + matches[0].indexOf('machine_type')
        );

        const contents = replaceLine(
          originalFiles[index].contents,
          lineNumToReplace,
          `  machine_type = "${resource.size}"`
        );

        return { ...file, contents };
      }

      return originalFiles[index];
    });
  });

  await Promise.all(
    originalFiles.map(async ({ path, contents }) => {
      const filePath = path.replace(repoPath, writePath);
      await fs.writeFile(filePath, contents);
    })
  );

  return recommendationsToClaim;
};

/**
 * Checks if a given file path corresponds to a Terraform file.
 * @param {string} filePath The full path to the file.
 * @return {boolean} True if the file is a Terraform file, otherwise false.
 */
const isTerraformFile = filePath => {
  return path.extname(filePath).toLowerCase() === '.tf';
};

/**
 * Reads files from a given directory and filters them based on a filtering function.
 * @param {string} repoDir The directory where the files are located.
 * @param {function} filterFn A filtering function to apply to each file.
 * @return {Promise<Array>} A promise resolving to an array of filtered files.
 */
const readFilteredFiles = async (repoDir, filterFn) => {
  const allFiles = await fs.readdir(repoDir);
  return await Promise.all(
    allFiles
      .filter(file => filterFn(path.join(repoDir, file)))
      .map(async file => {
        const fullPath = path.join(repoDir, file);
        const contents = await fs.readFile(fullPath, 'utf-8');
        return { path: fullPath, contents };
      })
  );
};

/**
 * Reads all Terraform files from a given directory.
 * @param {string} repoDir The directory where the Terraform files are located.
 * @return {Promise<Array>} A promise resolving to an array of Terraform files.
 */
const readAllTFFiles = async repoDir => {
  return readFilteredFiles(repoDir, filePath => {
    return !fs.statSync(filePath).isDirectory() && isTerraformFile(filePath);
  });
};

/**
 * Reads and parses the Terraform variable file.
 * @param {string} variableFilePath The full path to the variable file.
 * @return {Promise<Object>} A promise resolving to an object containing the parsed variables.
 */
const getTFVariables = async variableFilePath => {
  const variables = {};
  try {
    const contents = await fs.readFile(variableFilePath, 'utf-8');
    contents.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        variables[key.trim()] = value.replace(/"/g, '').trim();
      }
    });
  } catch (err) {
    console.error(`Could not read ${variableFilePath}: ${err}`);
  }
  return variables;
};

/**
 * Replaces placeholders in the file contents based on the provided variables and regex builder.
 * @param {Object} file The file object containing path and contents.
 * @param {Object} variables The variables to use for replacement.
 * @param {function} regexBuilder A function to build regex patterns for replacement.
 * @return {Object} The file object with replaced contents.
 */
const replaceInContents = (file, variables, regexBuilder) => {
  let contents = file.contents;
  Object.keys(variables).forEach(variable => {
    const reg = regexBuilder(variable);
    contents = contents.replace(reg, variables[variable]);
  });
  return { ...file, contents };
};

/**
 * Replaces variable values in the contents of Terraform files.
 * @param {string} repoDir The directory where the Terraform files are located.
 * @param {Array} tfContents An array containing the contents of the Terraform files.
 * @return {Promise<Array>} A promise resolving to an array of files with replaced contents.
 */
const replaceVariableValuesInTFFiles = async (repoDir, tfContents) => {
  const variableFilePath = path.join(repoDir, 'terraform.tfvars');
  const variables = await getTFVariables(variableFilePath);
  return tfContents.map(file => replaceInContents(file, variables, 
    variable => new RegExp(`\\$\\{\\s*var\\.${variable}\\s*}`, 'gs'))
  );
};


/**
 * Replaces Service Account values in TF contents using regular expressions
 *
 * @param tfContents the contents of each file
 * @return list of new contents
 */const replaceServiceAccountValues = tfContents => {
  // Find all service accounts and create map serviceacccountname -> account_id
  const serviceAccounts = {};
  tfContents.forEach(file => {
    const reg = new RegExp(
      'resource\\s*"google_service_account"\\s*"(\\w+)"\\s*{.+?account_id\\s*=\\s*"(\\w+)".+?}', 'gs'
    );
    
    const groups = reg.exec(file.contents);
    if (groups) {
      serviceAccounts[groups[1]] = groups[2];
    }
  });

  if (Object.keys(serviceAccounts).length > 0) {
    return tfContents.map(file => {
      let contents = file.contents;
      Object.keys(serviceAccounts).forEach(sa => {
        const reg = new RegExp(
          `\\$\\{\\s*google_service_account\\.${sa}\\.account_id\\s*}`, 'gs'
        );

        contents = contents.replace(reg, serviceAccounts[sa]);
      });

      return {
        path: file.path,
        contents
      };
    });
  }
  
  return tfContents;
};

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
  const recommendationsToClaim = [];
  const writePath = destPath || repoPath;
  let originalFiles = await readAllTFFiles(repoPath);
  let tfFiles = await replaceVariableValuesInTFFiles(repoPath, originalFiles);
  tfFiles = replaceServiceAccountValues(tfFiles);

  resources.forEach(resource => {
    originalFiles = tfFiles.map((file, index) => {
      const expr = `resource\\s+"google_project_iam_binding"\\s+"${resource.resourceName}"\\s+{.+?project\\s*=\\s*"${resource.project}".+?role\\s*=\\s*"${resource.role}".+?members\\s*=\\s*(\\[.+?"${resource.member}".+?\\]).+?}`;
      const reg = new RegExp(expr, 'gs');
      const matches = reg.exec(file.contents);

      if (matches) {
        recommendationsToClaim.push({
          id: resource.recommendationID,
          etag: resource.recommendationETAG,
        });

        let members = JSON.parse(matches[1]);
        members = members.filter(mem => mem !== resource.member);

        if (members.length > 0) {
          const indexOfMember = matches[0].indexOf(`"${resource.member}"`);
          const lineNumToComment = findLineNumbersFromCharacters(
            file.contents,
            matches.index + indexOfMember
          );

          const contents = commentLines(
            originalFiles[index].contents,
            lineNumToComment,
            lineNumToComment
          );

          return { ...file, contents };
        } else {
          const startLine = findLineNumbersFromCharacters(
            file.contents,
            matches.index
          );
          const endLine = findLineNumbersFromCharacters(
            file.contents,
            matches.index + matches[0].length
          );

          let contents = commentLines(
            originalFiles[index].contents,
            startLine,
            endLine
          );

          let additionalLines = '';
          if (resource.add) {
            additionalLines = `\n\n${copyLines(
              originalFiles[index].contents,
              startLine,
              endLine
            )}`;
            additionalLines = additionalLines.replace(
              /(.+role\s*=\s*").+?(".+)/gs,
              `$1${resource.add}$2`
            );
          }

          return { ...file, contents: contents + additionalLines };
        }
      } else {
        return originalFiles[index];
      }
    });
  });

  await Promise.all(
    originalFiles.map(async file => {
      const filePath = file.path.replace(repoPath, writePath);
      await fs.writeFile(filePath, file.contents);
    })
  );

  return recommendationsToClaim;
};


/**
 * Finds the line number given the character count
 *
 * @param text to search through
 * @param index of the character
 * @return line number
 */
const findLineNumbersFromCharacters = (text, index) => {
  let num = 1;
  for (let i = 0; i <= index; i++) {
    if (text[i] === '\n') {
      num += 1;
    }
  }
  return num;
};

/**
 * Comments out lines of text between specified start and end lines.
 * @param {string} text The original text.
 * @param {number} startLine The 1-based line number where commenting starts.
 * @param {number} endLine The 1-based line number where commenting ends.
 * @return {string} The modified text with lines commented out.
 */
const commentLines = (text, startLine, endLine) => {
  const allLines = text.split('\n');
  allLines[startLine - 1] = `/* ${allLines[startLine - 1]}`;
  allLines[endLine - 1] = `${allLines[endLine - 1]} */`;
  return allLines.join('\n');
};

/**
 * Copies lines of text between specified start and end lines.
 * @param {string} text The original text.
 * @param {number} startLine The 1-based line number where copying starts.
 * @param {number} endLine The 1-based line number where copying ends.
 * @return {string} The lines of text that were copied.
 */
const copyLines = (text, startLine, endLine) => {
  const allLines = text.split('\n');
  return allLines.slice(startLine - 1, endLine).join('\n');
};

/**
 * Replaces a line of text at a given line number.
 * @param {string} contents The original text.
 * @param {number} lineNum The 1-based line number to replace.
 * @param {string} text The new text to insert.
 * @return {string} The modified text with the line replaced.
 */
const replaceLine = (contents, lineNum, text) => {
  const allLines = contents.split('\n');
  allLines[lineNum - 1] = text;
  return allLines.join('\n');
};

/**
 * Applies VM resize recommendations to a Terraform repo.
 * @param {string} repoName The name of the repo where Terraform files are located.
 * @param {Array} vmResizeRecommendations An array of VM resize recommendations.
 * @param {boolean} isStub A flag to indicate if the function should run in stub mode.
 * @return {Promise<Array>} A promise resolving to an array of claimed recommendations.
 */
const applyVMResizeRecommendations = async (repoName, vmResizeRecommendations, isStub) => {
  let recommendationsToClaim = [];

  const tfState = await getTFState();
  const resourceNames = getVMResourcesByIdFromState(tfState, vmResizeRecommendations);
  
  if (resourceNames.length > 0) {
    recommendationsToClaim = await findAndModifyInstances(`/repo/${repoName}`, resourceNames);
  }

  return recommendationsToClaim;
};

/**
 * Applies IAM role recommendations to a Terraform repo.
 * @param {string} repoName The name of the repo where Terraform files are located.
 * @param {Array} iamRecommendations An array of IAM recommendations.
 * @param {boolean} isStub A flag to indicate if the function should run in stub mode.
 * @return {Promise<Array>} A promise resolving to an array of claimed recommendations.
 */
const applyIAMRecommendations = async (repoName, iamRecommendations, isStub) => {
  let recommendationsToClaim = [];

  const tfState = await getTFState();
  const resourceNames = await getIAMBindingsFromState(tfState, iamRecommendations, isStub);
  
  if (resourceNames.length > 0) {
    recommendationsToClaim = await findAndModifyIAMRoleBindings(`/repo/${repoName}`, resourceNames);
  }

  return recommendationsToClaim;
};

export {
  GIT_WORK_DIR_PATH,
  applyVMResizeRecommendations,
  applyIAMRecommendations
};

