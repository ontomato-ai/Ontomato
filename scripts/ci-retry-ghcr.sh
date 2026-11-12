#!/usr/bin/env bash
# Retry only the GHCR write command supplied by the image workflow.
set -euo pipefail

for attempt in 1 2 3; do
  printf 'GHCR write attempt %s/3: %s\n' "$attempt" "$*"
  if "$@"; then
    exit 0
  else
    status=$?
  fi
  if [ "$attempt" != 3 ]; then sleep 5; fi
done
exit "$status"
