FROM docker.io/library/nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
COPY nginx.conf.template /etc/nginx/templates/gateway.conf.template
COPY docker-entrypoint.sh /gateway-entrypoint.sh
COPY LICENSE NOTICE /licenses/
ENTRYPOINT ["/bin/sh", "/gateway-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
