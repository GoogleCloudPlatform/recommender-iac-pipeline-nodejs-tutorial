# Sample IaC repository

This repository contains sample Terraform manifest files for you to spin up
resources in a sample GCP project for the purposes of this tutorial.

The Terraform manifests are used to illustrate the automation pipeline. The manifests
are modified by the service when it parses Recommender recommendations and finds
recommendations for resources managed by Terraform.


## How to use this example

Use the [tutorial](https://cloud.google.com/recommender/docs/tutorial-iac) to understand how to configure
your Google Cloud Platform projects to use this pipeline.

1.  Check it out from GitHub.
2.  Create a new local repository and copy the files from this repo into it.
3.  Develop and enhance it for your use case

## Quickstart

Clone this repository

```sh
git clone https://github.com/GoogleCloudPlatform/recommender-iac-pipeline-nodejs-tutorial.git
```

Change directory to one of the example directories

Follow the walkthrough in the tutorial associated with the Nodejs example for
configuration details of Cloud platform products (Cloud Storage, Cloud Run, Cloud Build
and other ancillary services) and adapt accordingly using the accompanying README for
each example.

## License

Copyright 2019 Google LLC

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.