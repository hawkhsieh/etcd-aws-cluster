// Copyright (c) 2016, David M. Lee, II

import 'babel-polyfill';

import AWS from 'aws-sdk';
import _ from 'lodash';
import _request from 'request';
import async from 'async';

const request = _request.defaults({ json: true });

const config = {
  client: {
    port: 2379,
    scheme: 'http',
  },
  peer: {
    port: 2380,
    scheme: 'http',
  },
};

const metadata = new AWS.MetadataService();

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function failOn(err) {
  if (err) {
    fail(err.stack);
  }
}

function go() {
  console.error('Loading instance metadata');
  metadata.request('/latest/dynamic/instance-identity/document', (err, document) => {
    failOn(err);
    document = JSON.parse(document);

    const region = document.region;
    const instanceId = document.instanceId;
    const instanceIp = document.privateIp;
    const myPeerUrl = `${config.peer.scheme}://${instanceIp}:${config.peer.port}`;
    const myClientUrl = `${config.peer.scheme}://${instanceIp}:${config.peer.port}`;

    console.log(`export ETCD_NAME=${instanceId}`);
    console.log(`export ETCD_LISTEN_PEER_URLS=${myPeerUrl}`);
    console.log(`export ETCD_INITIAL_ADVERTISE_PEER_URLS=${myPeerUrl}`);
    console.log(`export ETCD_LISTEN_CLIENT_URLS=${myClientUrl}`);
    console.log(`export ETCD_ADVERTISE_CLIENT_URLS=${myClientUrl}`);

    const autoscaling = new AWS.AutoScaling({
      apiVersion: '2011-01-01',
      region,
    });

    const ec2 = new AWS.EC2({
      apiVersion: '2015-10-01',
      region,
    });

    console.error('Finding ASG for', instanceId);
    autoscaling.describeAutoScalingInstances({ InstanceIds: [instanceId] }, (err, data) => {
      failOn(err);
      if (_.isEmpty(data.AutoScalingInstances)) {
        fail('Not a member of an auto scaling group');
      }
      const asgName = data.AutoScalingInstances[0].AutoScalingGroupName;
      console.error('Finding instances in', asgName);

      autoscaling.describeAutoScalingGroups({ AutoScalingGroupNames: [asgName] }, (err, data) => {
        failOn(err);
        const peers = data.AutoScalingGroups[0].Instances;
        const peerInstanceIds = _(peers)
          .filter(p => p.LifecycleState === 'InService')
          .map('InstanceId')
          .valueOf();

        if (_.isEmpty(peerInstanceIds)) {
          fail('unable to find members of auto scaling group');
        }

        ec2.describeInstances({ InstanceIds: peerInstanceIds }, (err, data) => {
          failOn(err);
          const peers = _(data.Reservations).flatMap('Instances').map(instance => {
            const privateIp = _(instance.NetworkInterfaces).flatMap('PrivateIpAddress').valueOf();
            const instanceId = instance.InstanceId;
            const clientURL = `${config.client.scheme}://${privateIp}:${config.client.port}`;
            const peerURL = `${config.peer.scheme}://${privateIp}:${config.peer.port}`;

            return { instanceId, clientURL, peerURL };
          }).valueOf();

          console.error('found peers', JSON.stringify(peers, null, 2));

          async.reduce(_.map(peers, 'clientURL'), null, (currentCluster, client, done) => {
            if (currentCluster) {
              done(currentCluster);
              return;
            }

            const memberUrl = `${client}/v2/members`;
            request(memberUrl, (err, res) => {
              if (err) {
                // we're bootstrapping the cluster, so we can ignore errors
                done();
                return;
              }

              console.error('found existing cluster');
              done(null, { memberUrl, members: res.body.members });
            });
          }, (err, currentCluster) => {
            failOn(err);

            if (_.isEmpty(currentCluster)) {
              const cluster = _.map(peers, p => `${p.instanceId}=${p.peerURL}`);

              console.error('creating new cluster');
              console.log('export ETCD_INITIAL_CLUSTER_STATE=new');
              console.log(`export ETCD_INITIAL_CLUSTER=${cluster}`);
            } else {
              const memberUrl = currentCluster.memberUrl;
              let members = currentCluster.members;

              console.error('memberUrl', memberUrl);
              console.error('members', JSON.stringify(members, null, 2));

              const badMembers =
                _.filter(members, (member) => !_.includes(peerInstanceIds, member.name));
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
                      name: instanceId,
                    },
                  }, (err, res) => {
                    failOn(err);
                    if (res.statusCode !== 200 && res.statusCode !== 409) {
                      fail(`Error joining cluster: ${JSON.stringify(res.body)}`);
                    }

                    const cluster = _.map(members, m => `${m.name}=${m.peerURLs[0]}`);
                    console.log('export ETCD_INITIAL_CLUSTER_STATE=existing');
                    console.log(`export ETCD_INITIAL_CLUSTER=${cluster}`);
                  });
                });
              });
            }
          });
        });
      });
    });
  });
}

go();
