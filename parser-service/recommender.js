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


import { google } from 'googleapis';
import axios from 'axios';
import sampleRecommendationVM from './stub/vm.json' assert {type:'json'};
import sampleRecommendationIAM from './stub/iam.json' assert {type:'json'};

/**
 * Asynchronously fetches and returns a Google authentication client.
 * 
 * @returns {Promise<GoogleAuth>} A promise that resolves to the Google authentication client.
 */
const fetchAuthClient = async () => {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return await auth.getClient();
};

/**
 * Fetches recommendation stubs for testing purposes.
 * 
 * @param {string} type The type of recommendation to fetch ('VM' or 'IAM').
 * @returns {Promise<Object>} A promise that resolves to the recommendation data.
 */
const fetchRecommendationsStub = async (type) =>
  type === 'VM' ? sampleRecommendationVM : sampleRecommendationIAM;

/**
 * Asynchronously fetches recommendations from the Google Recommender API or stubs based on the specified type.
 *
 * @param {string} type The type of recommendations to fetch ('VM' or 'IAM').
 * @param {Array<string>} projects An array of project IDs for which recommendations are fetched.
 * @param {boolean} stub Determines whether to use stub data for recommendations.
 * @param {string} location The location for which recommendations are fetched.
 * @returns {Promise<Array>} A promise that resolves to an array of recommendations.
 */
const fetchRecommendations = async (type, projects, stub, location) => {
  if (stub) return fetchRecommendationsStub(type);

  const authClient = await fetchAuthClient();
  const accessToken = await authClient.getAccessToken();

  const typeURLPath = type === 'IAM'
    ? 'google.iam.policy.Recommender'
    : 'google.compute.instance.MachineTypeRecommender';

  const recommendationPromises = projects.map((project) => axios.get(
    `https://recommender.googleapis.com/v1beta1/projects/${project}/locations/${location}/recommenders/${typeURLPath}/recommendations`, {
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'x-goog-user-project': project,
      },
    })
  );

  const recommendationsFromAPI = await Promise.all(recommendationPromises);
  return recommendationsFromAPI
    .map(({ data }) => data)
    .filter((r) => r.recommendations)
    .flatMap((r) => r.recommendations);
};

/**
 * Lists VM resize recommendations for the given project IDs.
 * 
 * @param {Array<string>} projectIDs An array of project IDs to fetch VM resize recommendations for.
 * @param {boolean} isStub Whether to use stub data.
 * @param {string} location The location for the recommendations.
 * @returns {Promise<Array>} A promise that resolves to an array of VM resize recommendations.
 */
const listVMResizeRecommendations = async (projectIDs, isStub, location) => {
  const recommendations = await fetchRecommendations('VM', projectIDs, isStub, location);
  const vmsToSize = filterVMSizeRecommendations(recommendations);
  console.log('Completed listVMResizeRecommendations', JSON.stringify(vmsToSize));
  return vmsToSize;
};

/**
 * Lists IAM recommendations for the given project IDs.
 * 
 * @param {Array<string>} projectIDs An array of project IDs to fetch IAM recommendations for.
 * @param {boolean} isStub Whether to use stub data.
 * @param {string} location The location for the recommendations.
 * @returns {Promise<Array>} A promise that resolves to an array of IAM recommendations.
 */
const listIAMRecommendations = async (projectIDs, isStub, location) => {
  const recommendations = await fetchRecommendations('IAM', projectIDs, isStub, location);
  const iamRecommendations = filterIAMRecommendations(recommendations);
  console.log('Completed listIAMRecommendations', JSON.stringify(iamRecommendations));
  return iamRecommendations;
};

/**
 * Sets the status for a list of recommendations.
 * 
 * @param {Array<Object>} recommendationsIDsAndETags An array of objects containing recommendation IDs and their corresponding ETags.
 * @param {string} newStatus The new status to set for the recommendations.
 * @returns {Promise<void>} A promise that resolves when the status updates are complete.
 */
const setRecommendationStatus = async (recommendationsIDsAndETags, newStatus) => {
  const authClient = await fetchAuthClient();
  const accessToken = await authClient.getAccessToken();

  const promises = recommendationsIDsAndETags.map(({ id, etag }) => axios.post(
    `https://recommender.googleapis.com/v1beta1/${id}:${newStatus}`, {
      etag,
    }, {
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'x-goog-user-project': id.split('/')[1],
      },
    }).catch(function (error) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.log(error.response.data);
        console.log(error.response.status);
        console.log(error.response.headers);
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.log(error.request);
      } else {
        // Something happened in setting up the request that triggered an Error
        console.log('Error', error.message);
      }
        console.log(error.config);
    })
  );

  await Promise.all(promises);
};

/**
 * Fetches recommendation details for a given array of recommendation IDs.
 *
 * @param {Array<string>} recommendationIDs An array of recommendation IDs to fetch details for.
 * @returns {Promise<Array>} A promise that resolves to an array of recommendation details.
 */
const getRecommendations = async (recommendationIDs) => {
  const authClient = await fetchAuthClient();
  const accessToken = await authClient.getAccessToken();

  const promises = recommendationIDs.map((id) => axios.get(
    `https://recommender.googleapis.com/v1beta1/${id}`, {
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'x-goog-user-project': id.split('/')[1],
      },
    }
  ));

  const results = await Promise.all(promises);
  return results.map(({ data }) => data);
};

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


/**
 * Filters and processes IAM recommendations from a given list of recommendations.
 * 
 * @param {Array<Object>} recommendations An array of recommendation objects to be processed.
 * @returns {Array<Object>} An array of processed IAM recommendations.
 */
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
                operation.resource.split('/').pop() == project
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

/**
 * Processes and formats a role string from its full path.
 * 
 * @param {string} role The full path of the role to be processed.
 * @returns {string} The processed role string.
 */
const processRole = (role) => {
  const splitPortions = role.split('/');
  return `roles/${splitPortions[splitPortions.length - 1]}`;
};

export {
  listVMResizeRecommendations,
  listIAMRecommendations,
  setRecommendationStatus,
  getRecommendations,
};
