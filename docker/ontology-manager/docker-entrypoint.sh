#!/bin/sh
set -eu
: "${ONTOLOGY_INITIAL_ROUTE:=/playground}"
export ONTOLOGY_INITIAL_ROUTE
envsubst '${ONTOLOGY_INITIAL_ROUTE}' < /usr/share/nginx/html/config.js.template > /usr/share/nginx/html/config.js
cp /etc/nginx/templates/ontology-manager.conf.template /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
