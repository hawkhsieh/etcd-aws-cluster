# etcd-aws-cluster

## v1.0 (2016-03-11)

 * Forked from MonsantoCo for tagging and automatic rebuilds from Docker hub
 * Updated README
 * Removed unnecessary volumes from Dockerfile
 * Switched to Docker maintained alpine image
 * Added SIGTERM/SIGINT handlers, for stopability
 * Removed unnecessary packages
 * Direct all debug output to stderr
 * Added command line options, and option to send output to stdout
 * Set `ETCD_INITIAL_ADVERTISE_PEER_URLS`
 * Remove quotes from `ETCD_INITIAL_CLUSTER`, so it can be used by Docker's
   `--env-file`
