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
 * gcs.js provides helper functions to work with Google Cloud Storage such as
 * downloading specific files from a bucket.
 */

const { Storage } = require('@google-cloud/storage')
const fs = require('fs-extra')

const storage = new Storage()

/**
 * Downloads all the files in a Bucket from GCS. Once the files have been
 * downloaded it also sets permissions on the files.
 *
 * @param bucketName is the name of the repo in github.com:<account>/<repo>
 *                 format
 * @param dest The destination directory where the files should be downloaded
 * @param permissions a set of *inx permissions that need to be added to the
 *                    files after download
 */
const downloadFiles = async (bucketName, dest, permissions) => {
  const [files] = await storage.bucket(bucketName).getFiles()

  const fileNames = files.map(f => f.name)

  const downloadPromises =
    fileNames
      .map(filename => storage.bucket(bucketName).file(filename).download({
        destination: `${dest}/${filename}`
      }))


  await Promise.all(downloadPromises)

  if (permissions) {
    const permissionChangePromises =
      fileNames.map(filename => fs.chmod(`${dest}/${filename}`, permissions))

      await Promise.all(permissionChangePromises)
  }
}

module.exports = {
  downloadFiles
}