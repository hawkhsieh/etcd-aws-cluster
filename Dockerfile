FROM gliderlabs/alpine:3.1
MAINTAINER David M. Lee <leedm777@yahoo.com>

RUN apk --update add \
      python \
      py-pip \
      jq \
      curl \
      wget \
      bash &&\
    pip install --upgrade awscli &&\
    mkdir /root/.aws

COPY etcd-aws-cluster /etcd-aws-cluster

# Expose volume for adding credentials
VOLUME ["/root/.aws"]

# Expose directory to write output to, and to potentially read certs from
VOLUME ["/etc/sysconfig/", "/etc/certs"]

ENTRYPOINT /etcd-aws-cluster
