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

// re-wrote to ES6
import express from 'express'
import { downloadFiles } from './gcs.js'
import { applyRecommendations, ci } from './routes.js'
import dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

const PORT = process.env.PORT || 8080
const SSH_KEYS_BUCKET = process.env.SSH_KEYS_BUCKET

const app = express()

// Using express.json middleware instead of body-parser
app.use(express.json())
/**
 * Main entry point to the service. It sets up the container with the SSH keys
 * that are needed to clone the IaC repository, and starts the express server
 */
const run = async () => {
  try {
    await downloadFiles(SSH_KEYS_BUCKET, '/root/.ssh', '500')

    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`)
    })
  } catch (error) {
    console.error("Failed to start server:", error)
  }
}

/**
 * Entry point route for pipeline execution. This method starts the pipeline.
 * The recommendation type is either 'vm' or 'iam' that the pipeline
 * needs to retrieve Recommender recommendations for.
 */
app.post('/recommendation/:type', applyRecommendations)
/**
 * This route writes the Commit SHA and the Recommender recommendations IDs to
 * Cloud Firestore.
 */
app.post('/ci', ci)

// Start the application
run()
