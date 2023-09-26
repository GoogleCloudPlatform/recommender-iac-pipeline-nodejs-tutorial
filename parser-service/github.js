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
 * github.js uses the Octokit library to invoke GitHub specific tasks. It is
 * used to create a pull request in GitHub.
 */
 import { Octokit } from '@octokit/rest';

 // Initialize Octokit with GitHub Personal Access Token
 const octokit = new Octokit({
   auth: process.env.GITHUB_PAT,
 });
 
 // Helper function to destructure repo name to [owner, repo]
 const getRepoComponents = (repoName) => {
   const [ownerPart, repoPart] = repoName.split('/');
   const owner = ownerPart.split(':')[1];
   const repo = repoPart.split('.')[0];
   return { owner, repo };
 };
 
 /**
  * Create a pull request on GitHub.
  * @param {string} repoName - Full repository name as 'github.com:<account>/<repo>'.
  * @param {string} branchName - Name of the branch for which PR will be created.
  * @param {string} body - Description for the pull request.
  */
 const createPullRequest = async (repoName, branchName, body) => {
   const { owner, repo } = getRepoComponents(repoName);
   await octokit.pulls.create({
     owner,
     repo,
     title: body,
     head: branchName,
     base: 'master',
     body,
   });
 };
 
 /**
  * Fetch parent commits' short SHAs for a given commit.
  * @param {string} repoName - Full repository name as 'github.com:<account>/<repo>'.
  * @param {string} commitId - Commit SHA for which parent commits are needed.
  * @returns {Promise<Array<string>>} - Array of short SHAs of parent commits.
  */
 const getParentCommits = async (repoName, commitId) => {
   const { owner, repo } = getRepoComponents(repoName);
   const { data: commitData } = await octokit.git.getCommit({
     owner,
     repo,
     commit_sha: commitId,
   });
 
   return commitData?.parents?.map(parent => parent.sha.substr(0, 7)) || [];
 };
 
 export {
   createPullRequest,
   getParentCommits,
 };
 