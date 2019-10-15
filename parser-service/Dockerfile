# Copyright 2019 Google LLC

# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at

#     https://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

FROM node:10-alpine

# Install git in the container
RUN apk update && \
    apk upgrade && \
    apk --no-cache add git && \
    apk --no-cache add openssh && \
    mkdir /repo && \
    mkdir -p /root/.ssh

# Create and change to the app directory.
WORKDIR /app

# Copying this separately prevents re-running npm install on every code change.
COPY package*.json ./
RUN npm install

# Copy local code to the container image.
COPY . /app

# Configure and document the service HTTP port.
ENV PORT 8080
EXPOSE $PORT

# Run the web service on container startup.
CMD ["npm", "start"]

