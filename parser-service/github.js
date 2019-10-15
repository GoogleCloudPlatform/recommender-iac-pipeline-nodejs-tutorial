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

const Octokit = require('@octokit/rest')
const octokit = new Octokit({
  auth: process.env.GITHUB_PAT
})

/**
 * Creates a pull request in GitHub by calling the API.
 *
 * @param repoName is the name of the repo in github.com:<account>/<repo>
 *                 format
 * @param branchName The branch for which the pull request should be created
 * @param body The body / description of the pull request passed in as a string
 */
const createPullRequest = async (repoName, branchName, body) => {

  const repoComponents = repoName.split('/')
  const owner = repoComponents[0].split(':')[1]
  const repo = repoComponents[1].split('.')[0]

  await octokit.pulls.create({
    owner: owner,
    repo: repo,
    title: body,
    head: branchName,
    base: 'master',
    body: body
  })
}

/**
 * Gets the Short SHAs for the parent commits of this specific commits. This
 * is used to identify whether the current commit had any parent that was
 * associated to applied recommendations
 *
 * @param repoName is the name of the repo in github.com:<account>/<repo>
 *                 format
 * @param commitID The full commit ID
 * @return list of commit ids (short SHA)
 */
const getParentCommits = async (repoName, commitId) => {
  const repoComponents = repoName.split('/')
  const owner = repoComponents[0].split(':')[1]
  const repo = repoComponents[1].split('.')[0]

  const commit = await octokit.git.getCommit({
    owner: owner,
    repo: repo,
    commit_sha: commitId
  })

  if (commit.data) {
    if (commit.data.parents) {
      return commit.data.parents.map(p => p.sha.substr(0, 7))
    }
  }

  return []
}

module.exports = {
  createPullRequest,
  getParentCommits
}

