#!/bin/sh
set -eu
arch=$1
destination=$2
root=$(CDPATH="" cd -- "$(dirname -- "$0")" && pwd)
release=$(awk -v arch="$arch" '$1 == arch {print $2, $3, $4}' "$root/sources.lock")
if [ -z "$release" ]; then
    echo "Unsupported Codex architecture: $arch" >&2
    exit 1
fi
read -r version sha url <<MANIFEST
$release
MANIFEST
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
sh "$root/../../../scripts/github-download.sh" "$url" "$sha" "$archive"
mkdir -p "$destination/codex-resources"
tar -xzf "$archive" -C "$destination" bin/codex bin/codex-exec-server codex-package.json codex-path/rg
"$destination/bin/codex" --version | grep -Fx "codex-cli $version"
