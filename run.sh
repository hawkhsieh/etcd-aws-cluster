docker rm -f etcd 
docker run -d -p 4001:4001 -p 2380:2380 -p 2379:2379 --name etcd etcd-aws-cluster
