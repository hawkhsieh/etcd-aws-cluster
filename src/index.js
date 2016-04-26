// Copyright (c) 2016, David M. Lee, II

import 'babel-polyfill';

import AWS from 'aws-sdk';
import _ from 'lodash';
import _request from 'request';
import fetch from 'node-fetch';
import {install as installSourceMapSupport} from 'source-map-support';

installSourceMapSupport();

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

const go = async function go() {
  console.error('Loading instance metadata');
  const document = await new Promise((resolve, reject) => {
    metadata.request('/latest/dynamic/instance-identity/document', (err, d) => {
      if (err) {
        return reject(err);
      }
      return resolve(JSON.parse(d));
    });
  });

  const region = document.region;
  const instanceId = document.instanceId;
  const instanceIp = document.privateIp;
  // advertise the instance private address
  const myPeerUrl = `${config.peer.scheme}://${instanceIp}:${config.peer.port}`;
  const myClientUrl = `${config.client.scheme}://${instanceIp}:${config.client.port}`;
  // listen on the any address, so it can be reached on localhost
  const myPeerListenUrl = `${config.peer.scheme}://0.0.0.0:${config.peer.port}`;
  const myClientListenUrl = `${config.client.scheme}://0.0.0.0:${config.client.port}`;

  console.log(`export ETCD_NAME=${instanceId}`);
  console.log(`export ETCD_LISTEN_PEER_URLS=${myPeerListenUrl}`);
  console.log(`export ETCD_LISTEN_CLIENT_URLS=${myClientListenUrl}`);
  console.log(`export ETCD_INITIAL_ADVERTISE_PEER_URLS=${myPeerUrl}`);
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
  const { AutoScalingInstances } =
    await autoscaling.describeAutoScalingInstances({ InstanceIds: [instanceId] }).promise();

  if (_.isEmpty(AutoScalingInstances)) {
    fail('Not a member of an auto scaling group');
  }
  const asgName = AutoScalingInstances[0].AutoScalingGroupName;
  console.error('Finding instances in', asgName);

  const { AutoScalingGroups } =
    await autoscaling.describeAutoScalingGroups({ AutoScalingGroupNames: [asgName] }).promise();
  const asgInstanceIds = _(AutoScalingGroups[0].Instances)
    .filter(p => p.LifecycleState === 'InService')
    .map('InstanceId')
    .valueOf();

  if (_.isEmpty(asgInstanceIds)) {
    fail('unable to find members of auto scaling group');
  }

  const { Reservations } =
    await ec2.describeInstances({ InstanceIds: asgInstanceIds }).promise();

  const peers = _(Reservations).flatMap('Instances').map(instance => {
    const privateIp = _(instance.NetworkInterfaces).flatMap('PrivateIpAddress').valueOf();
    const clientURL = `${config.client.scheme}://${privateIp}:${config.client.port}`;
    const peerURL = `${config.peer.scheme}://${privateIp}:${config.peer.port}`;

    return { instanceId: instance.InstanceId, clientURL, peerURL };
  }).valueOf();

  console.error('found peers', JSON.stringify(peers, null, 2));

  const currentCluster = await _.reduce(_.map(peers, 'clientURL'), async(_prior, client) => {
    const prior = await _prior;

    if (prior) {
      return prior;
    }

    const url = `${client}/v2/members`;
    try {
      console.error('Trying', url);
      const res = await fetch(url);

      if (res.status !== 200) {
        console.error('  got', res.status);
        return null;
      }

      const body = await res.json();
      return { memberUrl: url, members: body.members };
    } catch (err) {
      // if we can't reach this peer, we could be bootstrapping.
      // return null and try the next one.
      console.error('  err', err.message);
      return null;
    }
  }, null);

  console.error('currentCluster', currentCluster);
  if (_.isEmpty(currentCluster)) {
    const cluster = _.map(peers, p => `${p.instanceId}=${p.peerURL}`);

    console.error('creating new cluster');
    console.log('export ETCD_INITIAL_CLUSTER_STATE=new');
    console.log(`export ETCD_INITIAL_CLUSTER=${cluster}`);
  } else {
    const memberUrl = currentCluster.memberUrl;
    let members = currentCluster.members;

    console.error('memberUrl', memberUrl);

    const badMembers =
      _.filter(members, (member) => !_.includes(asgInstanceIds, member.name));
    for (const member of badMembers) {
      console.error('Removing bad member', member);
      const res = await fetch(`${memberUrl}/v2/members/${member.id}`, { method: 'DELETE' });
      if (res.status !== 204) {
        fail(`Error deleting bad member ${await res.text()}`);
      }
    }
    console.error('joining existing cluster');

    const addRes = await fetch(memberUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        peerURLs: [myPeerUrl],
        name: instanceId,
      }),
    });

    if (addRes.statusCode !== 200 && addRes.status !== 409) {
      fail(`Error joining cluster: ${addRes.status} ${JSON.stringify(await addRes.text())}`);
    }

    // re-fetch the cluster list
    const memberRes = await fetch(memberUrl);
    if (memberRes.status !== 200) {
      fail(`Error re-fetching member list: ${await memberRes.text()}`);
    }
    members = (await memberRes.json()).members;

    console.error('members', JSON.stringify(members, null, 2));

    const cluster = _.map(members, m => `${m.name}=${m.peerURLs[0]}`);
    console.log('export ETCD_INITIAL_CLUSTER_STATE=existing');
    console.log(`export ETCD_INITIAL_CLUSTER=${cluster}`);
  }
};

go().catch(failOn);
