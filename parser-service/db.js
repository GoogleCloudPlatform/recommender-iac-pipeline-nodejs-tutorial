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

const {Firestore} = require('@google-cloud/firestore')

const firestore = new Firestore()

/**
 * Create a record in the database (Firestore) for the commit that was created.
 *
 * @param repoName is the name of the repo in github.com:<account>/<repo>
 *                 format
 * @param commitID is the Short SHA for the commit
 * @param recommendations is the a list of recommendation objects containing
 *                        an id and an etag
 *                        [{id: string,
 *                          etag: string}]
 * @param stub is written to the DB so that the next stage knows that it needs
 *             to mock the call to the recommender api
 */
const createCommit = async (repoName, commitID, recommendations, stub) => {

  const recommendationIDs = recommendations.map(r => r.id)
  const recommendationEtags = recommendations.map(r => r.etag)

  const uniqueID = `${repoName}-${commitID}`

  const document = firestore.doc(`applied_recommendations/${uniqueID}`)

  await document.set({
    commitID: commitID,
    repoName: repoName,
    recommendationIDs: recommendationIDs,
    recommendationEtags: recommendationEtags,
    stub: stub,
    status: 'Pull Request Created'
  })
}

/**
 * Gets the commit / record from the database.
 *
 * @param repoName is the name of the repo in github.com:<account>/<repo>
 *                 format
 * @param commitID is the Short SHA for the commit
 * @return a list of recommendation IDs from Firestore
 */
const getCommit = async (repoName, commitID) => {

  const uniqueID = `${repoName}-${commitID}`

  const document = firestore.doc(`applied_recommendations/${uniqueID}`)

  const doc = await document.get()
  console.log('Doc from firestore', doc.data())

  if (doc.data()) {
    if (!doc.data().stub) {
      return doc.data().recommendationIDs
    }
  }

  return []
}

module.exports = {
  createCommit,
  getCommit
}