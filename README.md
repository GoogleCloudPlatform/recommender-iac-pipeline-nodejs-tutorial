# GCP Recommender and IaC pipeline integration

This repository contains the code to build an automation pipeline that comprises
of the recommdender-parser service hosted in managed Cloud Run and other ancillary
GCP services. The service is invoked by scheduled Cloud Scheduler jobs.
This service calls the Recommender API to retrieve Recommender recommendations
for the projects that you specify.It parses these VM rightsizing and IAM role
recommendations to map them to the configuration you have in your Terraform
manifests. It updates your IaC manifests to reflect these recommendations and
generates a pull request for your to review and merge.
Once you review and merge the pull request, a Cloud Build job rolls out the
changes to your infrastructure in your GCP organisation


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

Change directory to one of the included directories

Follow the walkthrough in the tutorial associated with the Nodejs example for
configuration details of Cloud platform products (Cloud Storage, Cloud Run, Cloud Build
and other ancillary services) and adapt accordingly using the accompanying README for
each example.

The following sequence diagram outlines the key interactions in the functions
called by this service. Please note that the interactions are specifically
outlined for 'IAMRoleBindings' flow. The VM rightsizing flow follows a similar
interaction pattern.

![Recommender service sequence diagram:](https://cloud.google.com/static/recommender/docs/images/iac-architecture.svg)


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