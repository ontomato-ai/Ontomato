#!/bin/sh
set -eu
: "${PUBLIC_BASE_PATH:=}"
: "${WORKBENCH_UPSTREAM:=ontomato:3000}"
: "${WEB_UPSTREAM:=$WORKBENCH_UPSTREAM}"
: "${MANAGER_UPSTREAM:=ontology-manager:80}"
: "${JAVA_UPSTREAM:=datarag:18087}"
: "${WEB_MOUNT:=/}"
: "${MANAGER_MOUNT:=/}"
: "${LEGACY_API_PREFIX:=ontomato}"
: "${TRUSTED_PROXY_CIDR:=127.0.0.1/32}"
# Deployment input is substituted into Nginx syntax. Restrict it to path segments and host:port values.
if [ -n "$PUBLIC_BASE_PATH" ] && ! printf '%s' "$PUBLIC_BASE_PATH" | grep -Eq '^(/[A-Za-z0-9_-]+)+$'; then
  echo 'PUBLIC_BASE_PATH must be empty or slash-separated letters, digits, underscores and hyphens, without a trailing slash' >&2; exit 1
fi
for upstream in "$WORKBENCH_UPSTREAM" "$WEB_UPSTREAM" "$MANAGER_UPSTREAM" "$JAVA_UPSTREAM"; do
  printf '%s' "$upstream" | grep -Eq '^[A-Za-z0-9_.-]+:[0-9]+$' || { echo 'Invalid gateway upstream' >&2; exit 1; }
done
for mount in "$WEB_MOUNT" "$MANAGER_MOUNT"; do
  printf '%s' "$mount" | grep -Eq '^/([A-Za-z0-9_-]+/)*$' || { echo 'Invalid upstream mount' >&2; exit 1; }
done
case "$LEGACY_API_PREFIX" in ontomato|data-agent) ;; *) echo 'Invalid legacy API prefix' >&2; exit 1;; esac
printf '%s' "$TRUSTED_PROXY_CIDR" | grep -Eq '^[0-9a-fA-F.:]+/[0-9]+$' || { echo 'Invalid trusted proxy CIDR' >&2; exit 1; }
# Docker's host-gateway extra_host is in /etc/hosts, not its embedded DNS (notably on Linux).
# Resolve only this fixed development host; Compose service names retain dynamic DNS resolution.
resolve_dev_host() {
  case "$1" in
    host.docker.internal:*)
      host_address=$(awk '$2 == "host.docker.internal" { print $1; exit }' /etc/hosts)
      [ -n "$host_address" ] || { echo 'Missing host-gateway entry for development' >&2; exit 1; }
      printf '%s:%s' "$host_address" "${1##*:}" ;;
    *) printf '%s' "$1" ;;
  esac
}
WORKBENCH_UPSTREAM=$(resolve_dev_host "$WORKBENCH_UPSTREAM")
WEB_UPSTREAM=$(resolve_dev_host "$WEB_UPSTREAM")
MANAGER_UPSTREAM=$(resolve_dev_host "$MANAGER_UPSTREAM")
JAVA_UPSTREAM=$(resolve_dev_host "$JAVA_UPSTREAM")
export PUBLIC_BASE_PATH WORKBENCH_UPSTREAM WEB_UPSTREAM MANAGER_UPSTREAM JAVA_UPSTREAM WEB_MOUNT MANAGER_MOUNT LEGACY_API_PREFIX TRUSTED_PROXY_CIDR
envsubst '${PUBLIC_BASE_PATH} ${WORKBENCH_UPSTREAM} ${WEB_UPSTREAM} ${MANAGER_UPSTREAM} ${JAVA_UPSTREAM} ${WEB_MOUNT} ${MANAGER_MOUNT} ${LEGACY_API_PREFIX} ${TRUSTED_PROXY_CIDR}' \
  < /etc/nginx/templates/gateway.conf.template > /etc/nginx/conf.d/default.conf
exec "$@"
