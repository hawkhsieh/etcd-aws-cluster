FROM alpine:3.3
MAINTAINER David M. Lee <leedm777@yahoo.com>

RUN apk --update add \
        python \
        py-pip \
        jq \
        curl \
        bash \
    && pip install --upgrade awscli \
    && rm -rf /var/cache/apk/*

RUN curl -L https://github.com/coreos/etcd/releases/download/v2.3.4/etcd-v2.3.4-linux-amd64.tar.gz -o etcd-v2.3.4-linux-amd64.tar.gz && tar xzvf etcd-v2.3.4-linux-amd64.tar.gz
COPY etcd-aws-cluster /etcd-aws-cluster

RUN mkdir -p /etc/sysconfig/
ENV ETCD_CURLOPTS --connect-timeout 3

ENTRYPOINT ["/etcd-aws-cluster"]
