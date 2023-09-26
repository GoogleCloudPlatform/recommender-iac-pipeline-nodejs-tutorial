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
 * Routes.js orchestrates the calling of the various helper function when an
 * http service is invoked.
 */

import * as recommender from './recommender.js';
import * as terraform from './terraform.js';
import * as sourceControl from './sourcecontrol.js';
import * as github from './github.js';
import * as db from './db.js';

const BASE_REPO = process.env.GITHUB_ACCOUNT;

const applyRecommendations = async (req, res) => {
  try {
    const { body, params } = req;
    const { repo: repoName, projects: projectIDs, location, stub } = body;
    const type = params.type.toUpperCase();
    let listRecommendationsFn, applyRecommendationsFn;

    switch (type) {
      case 'VM':
        listRecommendationsFn = recommender.listVMResizeRecommendations;
        applyRecommendationsFn = terraform.applyVMResizeRecommendations;
        break;
      case 'IAM':
        listRecommendationsFn = recommender.listIAMRecommendations;
        applyRecommendationsFn = terraform.applyIAMRecommendations;
        break;
      default:
        return res.status(500).send('Unknown operation');
    }

    const recommendations = await listRecommendationsFn(projectIDs, Boolean(stub), location);

    if (recommendations.length === 0) {
      return res.end('Nothing to apply');
    }

    await sourceControl.cloneRepository(`git@${BASE_REPO}/${repoName}.git`, repoName);

    const recommendationsToClaim = await applyRecommendationsFn(repoName, recommendations, Boolean(stub));

    if (recommendationsToClaim.length > 0) {
      const commitMessage = type === 'VM'
        ? `Recommended VM Rightsizing as on ${new Date().toLocaleString()}`
        : `Recommended IAM Updates as on ${new Date().toLocaleString()}`;

      const commit = await sourceControl.commitChanges(commitMessage, repoName);

      await github.createPullRequest(`git@${BASE_REPO}/${repoName}.git`, commit.branch, commitMessage);

      await db.createCommit(repoName, commit.commit, recommendationsToClaim, Boolean(stub));

      if (!stub) {
        await recommender.setRecommendationStatus(recommendationsToClaim, 'markClaimed');
      }
    }

    res.sendStatus(201).end();
  } catch (e) {
    console.error(e);
    res.sendStatus(500).end(e.toString());
  }
};

/**
 * This handles the route called by the Pub/Sub subscription after the Cloud
 * Build (CI / CD) job completes. If the job has run successfully, the
 * service updates the recommendations state by invoking the Recommender API.
 *
 * @param req is the request object
 * @param res is the response object
 */
const ci = async (req, res) => {
  const data = req.body.message.data
  const payload = JSON.parse(Buffer.from(data, 'base64').toString())

  try {
    if (payload.status == 'SUCCESS' && payload.substitutions) {
      const commitID = payload.substitutions.COMMIT_SHA
      const repoName = payload.substitutions.REPO_NAME
      const fullRepoName = `${BASE_REPO}/${repoName}`

      // Get parent commits
      console.log('/ci starting step Get Parent Commits')
      const parentCommits =
        await github.getParentCommits(fullRepoName, commitID)
      console.log('/ci end step Get Parent Commits',
        JSON.stringify(parentCommits))

      // Get Recommendation IDs from DB for each parent commit
      console.log('/ci starting step Get Recommendation IDs from DB')
      const dbLookUpPromises = parentCommits.map(c => db.getCommit(repoName, c))
      const dbLookUpPromisesResult =
        await Promise.all(dbLookUpPromises)

      // Flatten recommendations
      const recommendationIDs = dbLookUpPromisesResult.reduce((acc, result) => {
        return [...acc, ...result]
      }, [])

      console.log('/ci recommendationIDs are', recommendationIDs)

      // Get etags for recommendations
      console.log('/ci starting step Get etags for recommendation')
      const recommendationsResult =
        await recommender.getRecommendations(recommendationIDs)

      console.log('/ci recommendations are', recommendationsResult)

      const recommendations = recommendationsResult.map(reco => ({
        id: reco.name,
        etag: reco.etag
      }))

      // Mark Recommendations as succeeded
      console.log('/ci starting step Mark Recommendations as succeeded')
      await recommender.setRecommendationStatus(
        recommendations, 'markSucceeded')

      res.sendStatus(201)
    } else {
      res.sendStatus(200)
    }
  } catch (e) {
    console.log('ERROR: ', e.toString())
    res.status(500).send(e.toString())
  }
}

export { applyRecommendations, ci };
