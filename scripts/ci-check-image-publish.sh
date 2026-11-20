#!/usr/bin/env bash
set -euo pipefail

if [[ "$GITHUB_REF_TYPE" == tag ]]; then exit 0; fi

repo="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY"
branch="refs/heads/$GITHUB_REF_NAME"
head=$(git rev-parse HEAD)
if [[ "$GITHUB_REF_NAME" != develop ]]; then
  remote=$(git ls-remote "$repo" "$branch" | cut -f1)
  if [[ "$head" != "$remote" ]]; then
    echo "$GITHUB_REF_NAME has advanced to $remote; not publishing from stale $head" >&2
    exit 1
  fi
  exit 0
fi

if [[ $(git rev-parse --is-shallow-repository) == true ]]; then
  git fetch --no-tags --unshallow "$repo" "$branch"
else
  git fetch --no-tags "$repo" "$branch"
fi
if ! git merge-base --is-ancestor "$head" FETCH_HEAD; then
  echo "$head is outside the current develop history; not publishing" >&2
  exit 1
fi

# Workbench is the first moving tag written by each publisher. Compare that
# tag even if the preceding run only partially published or failed verification.
tag="edge${ARCH:+-$ARCH}"
builds=$(docker buildx imagetools inspect "$REGISTRY/ontomato-workbench:$tag" --format '{{json .Image}}' |
  jq -er 'if has("config") then . else .[] end | .config.Labels["io.ontomato.build"] |
    if type == "string" then . else error("missing image build label") end')
while IFS= read -r build; do
  if [[ ! "$build" =~ -g([0-9a-f]{12})$ ]]; then
    echo "Cannot read the published commit from $tag build label: $build" >&2
    exit 1
  fi
  published=${BASH_REMATCH[1]}
  if ! git merge-base --is-ancestor "$published" "$head"; then
    echo "$head would replace $tag from $published with an older or unrelated commit" >&2
    exit 1
  fi
done <<< "$builds"
