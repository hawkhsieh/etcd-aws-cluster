# etcd-aws-cluster

This container serves to assist in the creation of an etcd (2.x) cluster from an
AWS auto scaling group. This is [a fork](#why-fork) from the
[upstream Monsanto repo][], ported to Node.js. Much thanks to @tj-corrigan for
doing the actual hard work of [figuring out][] how to bootstrap etcd in AWS.

## Docker Versions

 - `1`, `1.0` - ([1/Dockerfile](https://github.com/building5/etcd-aws-cluster/blob/1/Dockerfile))
 - `2`, `2.0`, `latest` - ([master/Dockerfile](https://github.com/building5/etcd-aws-cluster/blob/master/Dockerfile))

## Usage

This container should be run on the instance in the autoscaling group you wish
to run the etcd node on. It will autodiscover the current status of the cluster,
and write a set of etcd params to stdout.

```
$ docker run building5/etcd-aws-cluster
```

For cases where you cannot run a docker container (like starting up an etcd
cluster you want to point you docker cluster at), you can also run from npm

```
$ npm install -g etcd-aws-cluster
$ etcd-aws-cluster
```

This output could be:

 * written to `/etc/sysconfig/etcd-cluster` for systemd startup. The output can
   then be loaded as an `EnvironmentFile` in an etcd2 drop-in to properly
   configure etcd2:

   ```
   [Service]
   EnvironmentFile=/etc/sysconfig/etcd-cluster
   ```
 * written to (or `eval` from) `/etc/default/etcd` for upstart startup
   ```
   eval $(docker run building5/etcd-aws-cluster)
   ```
 * used with `docker run --env-file` for running in a docker container
   ```
   $ docker run --env-file <(docker run building5/etcd-aws-cluster) etcd
   ```

The following params are written:

 * `ETCD_NAME`
   * Node name; uses EC2 instance id
 * `ETCD_LISTEN_CLIENT_URLS`
   * URL to listen on for client traffic; defaults to http://0.0.0.0:2379
 * `ETCD_LISTEN_PEER_URLS`
   * URL to listen on for peer traffic; defaults to http://0.0.0.0:2380
 * `ETCD_ADVERTISE_CLIENT_URLS`
   * URL to advertise for client traffic; defaults to http://<private-ip>:2379
 * `ETCD_INITIAL_ADVERTISE_PEER_URLS`
   * URL to advertise for peer traffic; defaults to http://<private-ip>:2380
 * `ETCD_INITIAL_CLUSTER_STATE`
   * `new` (spinning up new cluster) or `existing` (joining existing cluster)
 * `ETCD_INITIAL_CLUSTER`
   * comma separated list of the other members of the cluster

## Permissions

IAM permissions are needed to inspect the ASG and its members. The easiest way to do that
is with an [IAM instance profile][]. An example policy is given below, but you may want to
narrow the `Resource` to the specific ASG the instance will belong to.

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Stmt1456626729000",
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "autoscaling:Describe*"
      ],
      "Resource": ["*"]
    }
  ]
}
```

## Workflow

- get the instance id and ip from amazon
- fetch the autoscaling group this machine belongs to
- obtain the ip of every member of the auto scaling group
- for each member of the autoscaling group detect if they are running etcd and
  if so who they see as members of the cluster

  if no machines respond

    - assume that this is a new cluster
    - write a file using the ids/ips of the autoscaling group

  else

    - assume that we are joining an existing cluster
    - check to see if any machines are listed as being part of the cluster but
      are not part of the autoscaling group
      -  if so remove it from the etcd cluster
    - add this machine to the current cluster
    - write a file using the ids/ips obtained from query etcd for members of the
      cluster

## Why fork?

The differences in this fork are:

 - Versions tagged in Git.
 - Ported to Node.js, so I have a hope of debugging it.
 - Automatic Docker Hub builds, rebuilding whenever the base `FROM` image is
   updated, so we'll keep up to date with security patches.
 - More flexibility, for cases when not using CoreOS.

 [upstream Monsanto repo]: https://github.com/MonsantoCo/etcd-aws-cluster
 [figuring out]: http://engineering.monsanto.com/2015/06/12/etcd-clustering/
 [IAM instance profile]: http://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html
