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
 * sourcecontrol.js manages tasks related to the GIT IaC repository. It has
 * functions that let you clone and commit changes to your IaC repository.
 */
import simpleGit from 'simple-git';
import fs from 'fs-extra';

const GIT_WORK_DIR_PATH = '/repo';

const cloneRepository = async (repoURI, repoName) => {
  const baseDIR = `${GIT_WORK_DIR_PATH}/${repoName}`;
  await fs.mkdirp(baseDIR);
  await fs.emptyDir(baseDIR);

  const git = simpleGit(baseDIR);
  await git.clone(repoURI, baseDIR);
  await git.addConfig('user.name', 'RecommenderBot');
  await git.addConfig('user.email', 'recommenderbot@example.com');
};

const commitChanges = async (commitMessage, repoName) => {
  const baseDIR = `${GIT_WORK_DIR_PATH}/${repoName}`;
  const branchName = createBranchName();

  const git = simpleGit(baseDIR);
  await git.checkoutLocalBranch(branchName);
  await git.add(`${baseDIR}/.`);
  const commit = await git.commit(commitMessage);

  await git.push('origin', branchName);

  return commit;
};

const createBranchName = () => {
  const d = new Date();
  const dateString = d.toISOString().replace(/[: \.]/g, '-');
  return `recommender-changes-${dateString}`;
};

export {
  cloneRepository,
  commitChanges
};
