FROM node:4
MAINTAINER David M. Lee <leedm777@yahoo.com>

RUN npm install -g --loglevel http npm@3

RUN useradd --system --create-home node && \
    mkdir /usr/src/app && \
    chown node:node /usr/src/app

# trickery to only run npm install when package.json changes
WORKDIR /usr/src/app
COPY package.json /usr/src/app/
RUN npm --loglevel http install

COPY . /usr/src/app

USER node
ENTRYPOINT ["node", "server.js"]
