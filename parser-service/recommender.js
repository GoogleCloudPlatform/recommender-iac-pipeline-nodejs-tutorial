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
 * Recommender.js (module) handles all tasks related to recommendations such
 * as fetching recommendations, updating recommendation state and parsing
 * recommendations.
 */

const sampleRecommendationVM = require('./stub/vm.json')
const sampleRecommendationIAM = require('./stub/iam.json')

const {google} = require('googleapis')
const request = require('request-promise')

/**
 * Invoke the Recommender API and filter recommendations by VM Resize
 * recommendations
 *
 * @param projectIDs is the list of GCP project IDs for which the service should
 *                 pull recommendations from the Recommender API. These project
 *                 IDs should map to the corresponding IaC repository
 *                 [string]
 * @param isStub to determine if the invocation of the Recommender API
 *        should be mocked.
 *        boolean
 * @return filtered VM recommendations
 *         [{instanceID: string, size: string, recommendationID: string,
 *           recommendationETag: string}]
 */
const listVMResizeRecommendations = async (projectIDs, isStub) => {
  const recommendations =
      await fetchRecommendations('VM', projectIDs, isStub)

  const vmsToSize = await
    filterVMSizeRecommendations(recommendations)

  console.log('Completed listVMResizeRecommendations',
    JSON.stringify(vmsToSize))

  return vmsToSize
}

/**
 * Invoke the Recommender API and filter recommendations by IAM role change
 * recommendations
 *
 * @param projectIDs is the list of GCP project IDs for which the service should
 *                 pull recommendations from the Recommender API. These project
 *                 IDs should map to the corresponding IaC repository
 *                 [string]
 * @param isStub boolean to determine if the invocation of the Recommender API
 *             should be mocked.
 * @return filtered IAM recommendations
 *         [{project: string, member: string, role: string,
 *           add: string, recommendationID: string, recommendationETag: string}]
 */
const listIAMRecommendations = async (projectIDs, isStub) => {
  const recommendations =
      await fetchRecommendations('IAM', projectIDs, isStub)

  const iamRecommendations = await
    filterIAMRecommendations(recommendations)

  console.log('Completed listIAMRecommendations',
    JSON.stringify(iamRecommendations))

  return iamRecommendations
}

/**
 * Mock the invocation of the Recommender API using stubs
 *
 * @param type is the recommendation type that needs to be processed using a
 *             stub - this could be 'VM' or 'IAM'
 */
const fetchRecommendationsStub = async (type) => {
  if (type == 'VM') {
    return sampleRecommendationVM
  } else {
    return sampleRecommendationIAM
  }
}

/**
 * Invoked the Recommender API
 *
 * @param type is the recommendation type that needs to be processed using a
 *             stub - this could be 'VM' or 'IAM'
 * @param projects is the list of GCP project IDs for which the service should
 *                 pull recommendations from the Recommender API. These project
 *                 IDs should map to the corresponding IaC repository
 * @param stub boolean to determine if the invocation of the Recommender API
 *             should be mocked.
 * @return list of recommendations from the recommender API
 *        [{ name: string, description: string, stateInfo: object, etag: string
 *            lastRefreshTime: datetime, content: object }]
 */
const fetchRecommendations = async (type, projects, stub) => {

  if (stub) {
    return fetchRecommendationsStub(type)
  }

  const typeURLPath = type == 'IAM' ?
    'google.iam.policy.Recommender' :
    'google.compute.instance.MachineTypeRecommender'

  // Fetch OAuth Token
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  })

  const authClient = await auth.getClient()

  const accessToken = await authClient.getAccessToken()

  // Create promises of requests to fetch recommendations
  const recommendationPromises = projects.map(project => request({
    uri: `https://recommender.googleapis.com/v1beta1/projects/${project}/locations/global/recommenders/${typeURLPath}/recommendations`,
    method: 'GET',
    headers: {      
      Authorization: `Bearer ${accessToken.token}`,
      'x-goog-user-project': `${project}`
    },
  }))

  // Wait for requests to complete
  const recommendationsFromAPI =
    (await Promise.all(recommendationPromises))
      .map(str => JSON.parse(str))
      .filter(r => r.recommendations)
      .reduce((a, v) => [...a, ...v.recommendations], [])

  return recommendationsFromAPI
}

/**
 * Invoked the Recommender API to get the metadata for a list of recommendations
 *
 * @param recommendationIDs a list of recommendationIDs for which metadata needs
 *                          to be retrieved
 */
const getRecommendations = async (recommendationIDs) => {
  // Fetch OAuth Token
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  })

  const authClient = await auth.getClient()

  const accessToken = await authClient.getAccessToken()

  // Create promises of requests
  const promises = recommendationIDs.map(id => {
    console.log(id);
    const uri = `https://recommender.googleapis.com/v1beta1/${id}`
    return request({
      uri,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'x-goog-user-project': id.split('/')[1]
      }
    })
  })

  const result = await Promise.all(promises)

  return result.map(r => JSON.parse(r))
}

/**
 * Invokes the Recommender API to update recommendation status once processed
 *
 * @param recommendationsIDsAndETags list of recommendations for which the status
 *        needs to be updated
 * @param newStatus string value of state that needs to be set for a recommendation
 */
const setRecommendationStatus = async (recommendationsIDsAndETags, newStatus) => {

  // Fetch OAuth Token
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  })

  const authClient = await auth.getClient()

  const accessToken = await authClient.getAccessToken()

  // Create promises of requests
  const promises = recommendationsIDsAndETags.map(recommendation => {
    console.log(recommendation.id);
    const uri =
      `https://recommender.googleapis.com/v1beta1/${recommendation.id}:${newStatus}`
    console.log('setRecommendationStatus uri', uri)
    return request({
      uri,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,        
        'x-goog-user-project': recommendation.id.split('/')[1]
      },
      json: {
        etag: recommendation.etag
      }
    })
  })

  await Promise.all(promises)
}

/**
 * Review the recommendations payload to create an array of instances for
 * active recommendations. This array will comprise of the instance selfLink and
 * recommended machine type
 * @param recommendations is a list of recommendations from the API
 *        [{ name: string, description: string, stateInfo: object, etag: string
 *            lastRefreshTime: datetime, content: object }]
 * @return VMS to resize
 *        [{ instanceID: string, size: string, recommendationID: string
 *           recommendationETAG: string}]
 * */
const filterVMSizeRecommendations = (recommendations) => {
  const vmsToResize = []
  recommendations.forEach(recommendation => {
    if (recommendation.stateInfo.state == "ACTIVE") {
      recommendation.content.operationGroups.forEach(group => {
        group.operations.forEach(operation => {
          if (operation.action == 'replace' &&
              operation.resourceType == 'compute.googleapis.com/Instance' &&
              operation.path == '/machineType') {
            const value = operation.value.split('/')
            const size = value[value.length - 1]
            const recommendationID = recommendation.name
            const recommendationETAG = recommendation.etag

            vmsToResize.push({
              instanceID: operation.resource,
              size,
              recommendationID,
              recommendationETAG
            })
          }
        })
      })
    }
  })

  return vmsToResize
}


// Review the recommendations payload to create an array of instances for
// active recommendations. This array will comprise of the instance selfLink and
// recommended machine type
const filterIAMRecommendations = (recommendations) => {
  const removeRecommendations = []

  recommendations.forEach(recommendation => {
    if (recommendation.stateInfo.state == 'ACTIVE') {
      recommendation.content.operationGroups.forEach(group => {
        group.operations.forEach(operation => {
          if (operation.action == 'remove' &&
              operation.resourceType ==
                'cloudresourcemanager.googleapis.com/Project' &&
              operation.path == '/iamPolicy/bindings/*/members/*') {

            const project = recommendation.name.split('/')[1]
            const member =
              operation.pathFilters["/iamPolicy/bindings/*/members/*"]
            const role = operation.pathFilters["/iamPolicy/bindings/*/role"]
            const recommendationID = recommendation.name
            const recommendationETAG = recommendation.etag
            let add = ''
            // Find add recommendations for the same remove
            group.operations.forEach(operation => {
              if (operation.action == 'add' &&
                operation.resourceType ==
                  'cloudresourcemanager.googleapis.com/Project' &&
                operation.path == '/iamPolicy/bindings/*/members/-' &&
                operation.value == member &&
                operation.resource.split(':')[1] == project
                ) {
                  add = operation.pathFilters["/iamPolicy/bindings/*/role"]
                }
            })

            removeRecommendations.push({
              project,
              member,
              role: processRole(role),
              add: add ? processRole(add) : '',
              recommendationID,
              recommendationETAG
            })
          }
        })
      })
    }
  })


  return removeRecommendations
}

const processRole = (role) => {
  const splitPortions = role.split('/')
  return 'roles/' + splitPortions[splitPortions.length - 1]
}

module.exports = {
  listVMResizeRecommendations,
  listIAMRecommendations,
  setRecommendationStatus,
  getRecommendations
}
