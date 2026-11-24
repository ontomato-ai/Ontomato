#!/bin/sh
set -e
node --import tsx /usr/local/lib/ontomato-sandbox/preflight.mjs
exec "$@"
