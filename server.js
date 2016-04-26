#!/usr/bin/env node

var AWS = require('aws-sdk');
var config = require('config');

var metadata = new AWS.MetadataService();

function failOn(err) {
  if (err) {
    console.error(err.stack);
    process.exit(1);
  }
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

metadata.request('/latest/dynamic/instance-identity/document', (err, document) => {
  failOn(err);
  var region = document.region;
  if (!region) {
    fail('Could not get region');
  }
});
