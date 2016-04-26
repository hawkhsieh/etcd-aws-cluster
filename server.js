#!/usr/bin/env node

var AWS = require('aws-sdk');
var async = require('async');
var config = require('config');
var _ = require('lodash');
var request = require('request').defaults({ json: true });

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
  console.error(document);
  document = JSON.parse(document);

  var region = document.region;
  var instanceId = document.instanceId;
  var instanceIp = document.privateIp;
  var myPeerUrl = `${config.peer.scheme}://${instanceIp}:${config.peer.port}`;
  var myClientUrl = `${config.peer.scheme}://${instanceIp}:${config.peer.port}`;

  console.log(`export ETCD_NAME=${instanceId}`);
  console.log(`export ETCD_LISTEN_PEER_URLS=${myPeerUrl}`);
  console.log(`export ETCD_INITIAL_ADVERTISE_PEER_URLS=${myPeerUrl}`);
  console.log(`export ETCD_LISTEN_CLIENT_URLS=${myClientUrl}`);
  console.log(`export ETCD_ADVERTISE_CLIENT_URLS=${myClientUrl}`);

  var autoscaling = new AWS.AutoScaling({
    apiVersion: '2011-01-01',
    region
  });

  var ec2 = new AWS.EC2({
    apiVersion: '2015-10-01',
    region
  });

  console.error('Finding ASG for', instanceId);
  autoscaling.describeAutoScalingInstances({ InstanceIds: [instanceId] }, (err, data) => {
    failOn(err);
    if (_.isEmpty(data.AutoScalingInstances)) {
      fail('Not a member of an auto scaling group');
    }
    var asgName = data.AutoScalingInstances[0].AutoScalingGroupName;
    console.error('Finding instances in', asgName);

    autoscaling.describeAutoScalingGroups({ AutoScalingGroupNames: [asgName] }, (err, data) => {
      failOn(err);
      var peers = data.AutoScalingGroups[0].Instances;
      var peerInstanceIds = _(peers)
        .filter(p => p.LifecycleState === "InService")
        .map('InstanceId')
        .valueOf();

      if (_.isEmpty(peerInstanceIds)) {
        fail('unable to find members of auto scaling group');
      }

      ec2.describeInstances({ InstanceIds: peerInstanceIds }, (err, data) => {
        failOn(err);
        var addresses = _(data.Reservations)
          .flatMap('Instances').flatMap('NetworkInterfaces').map('PrivateIpAddress').valueOf();

        var peers = _(data.Reservations).flatMap('Instances').map(instance => {
          var privateIp = _(instance.NetworkInterfaces).flatMap('PrivateIpAddress').valueOf();
          var instanceId = instance.InstanceId;
          var clientURL = `${config.client.scheme}://${privateIp}:${config.client.port}`;
          var peerURL = `${config.peer.scheme}://${privateIp}:${config.peer.port}`;

          return { instanceId, clientURL, peerURL };
        }).valueOf();

        async.reduce(_.map(peers, 'clientURL'), null, (currentCluster, client, done) => {
          if (currentCluster) {
            done(currentCluster);
            return;
          }

          var memberUrl = `${client}/v2/members`;
          request(memberUrl, (err, res) => {
            if (err) {
              // we're bootstrapping the cluster, so we can ignore errors
              done();
              return;
            }

            console.error('found existing cluster');
            done(null, { memberUrl, members: res.body.members })
          })
        }, (err, currentCluster) => {
          failOn(err);

          if (_.isEmpty(currentCluster)) {
            console.error('creating new cluster');
            console.log('export ETCD_INITIAL_CLUSTER_STATE=new');
            console.log(`export ETCD_INITIAL_CLUSTER=${_.map(peers, p => `${p.instanceId}=${p.peerURL}`)}`)
          } else {
            var memberUrl = currentCluster.memberUrl;
            var members = currentCluster.members;

            var badMembers = _.filter(members, (member) => !_.includes(peerInstanceIds, member.name));
            async.eachSeries(badMembers, (member, done) => {
              console.error(`Removing bad member ${member.name} (${member.id})`);
              request.delete(`${memberUrl}/v2/members/${member.id}`, (e, r) => {
                failOn(e);
                if (r.statusCode !== 204) {
                  fail(`Error deleting bad member ${JSON.stringify(r.body)}`);
                }
                done(e, r);
              });
            }, (err) => {
              failOn(err);
              console.error('joining existing cluster');

              // re-fetch the cluster list
              request(memberUrl, (err, res) => {
                failOn(err);
                members = res.body.members;

                request.post({
                  url: memberUrl,
                  body: {
                    peerURLs: [myPeerUrl],
                    name: instanceId
                  }
                }, (err, res) => {
                  failOn(err);
                  if (res.statusCode !== 200 && res.statusCode !== 409) {
                    fail(`Error joining cluster: ${JSON.stringify(res.body)}`);
                  }

                  console.log('export ETCD_INITIAL_CLUSTER_STATE=existing');
                  console.log(`export ETCD_INITIAL_CLUSTER=${_.map(members, m => `${m.name}=${m.peerURLs[0]}`)}`)
                });
              });
            });
          }
        })
      });
    });
  });
});
