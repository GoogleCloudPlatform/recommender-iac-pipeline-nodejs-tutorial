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
 * db.js allows you to interact with Cloud Firestore where recommendations
 * processed by the service along with Git commit data is stored. These details
 * are retrieved after the CI/CD process is completed to complete the feedback
 * loop.
 */

import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore();

/**
 * Create a record in the database (Firestore) for the created commit.
 *
 * @param {string} repoName - Name of the repo in github.com:<account>/<repo> format
 * @param {string} commitID - Short SHA for the commit
 * @param {Array<Object>} recommendations - List of recommendation objects containing an id and an etag
 * @param {boolean} stub - Written to the DB so the next stage knows it needs to mock the call to the Recommender API
 * @returns {Promise<void>}
 */
export const createCommit = async (repoName, commitID, recommendations, stub) => {
  try {
    const recommendationIDs = recommendations.map(r => r.id);
    const recommendationEtags = recommendations.map(r => r.etag);
    const uniqueID = `${repoName}-${commitID}`;
    const document = firestore.doc(`applied_recommendations/${uniqueID}`);
    await document.set({
      commitID,
      repoName,
      recommendationIDs,
      recommendationEtags,
      stub,
      status: 'Pull Request Created'
    });
  } catch (error) {
    console.error(`Failed to create commit in Firestore for ${repoName}:`, error);
  }
};

/**
 * Gets the commit/record from the database.
 *
 * @param {string} repoName - Name of the repo in github.com:<account>/<repo> format
 * @param {string} commitID - Short SHA for the commit
 * @returns {Promise<Array<string>>} - A list of recommendation IDs from Firestore
 */
export const getCommit = async (repoName, commitID) => {
  try {
    const uniqueID = `${repoName}-${commitID}`;
    const document = firestore.doc(`applied_recommendations/${uniqueID}`);
    const doc = await document.get();
    if (doc.exists && !doc.data().stub) {
      return doc.data().recommendationIDs;
    }
    return [];
  } catch (error) {
    console.error(`Failed to get commit from Firestore for ${repoName}:`, error);
    return [];
  }
};