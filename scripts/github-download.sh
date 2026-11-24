#!/bin/sh
# Fetch a pinned GitHub artifact and verify its SHA256.
# PINNED_DOWNLOADS_DIR optionally names a directory of prefetched artifacts,
# each stored under its SHA256; a matching file there is used without network.
# GITHUB_DOWNLOAD_PROXIES holds optional space-separated URL prefixes, each
# prepended to the full GitHub URL; they are tried in order before GitHub
# itself. An attempt is abandoned when the transfer stalls below 100 KiB/s for a
# minute, so a slow or unreachable source falls through instead of hanging.
# Usage: github-download.sh <url> <sha256> <output>
set -eu

url=$1
sha=$2
output=$3

verify() {
    printf '%s  %s\n' "$sha" "$output" | sha256sum --check --status
}

if [ -n "${PINNED_DOWNLOADS_DIR:-}" ] && [ -f "$PINNED_DOWNLOADS_DIR/$sha" ]; then
    cp "$PINNED_DOWNLOADS_DIR/$sha" "$output"
    if verify; then
        echo "Using prefetched $url"
        exit 0
    fi
    echo "Prefetched $PINNED_DOWNLOADS_DIR/$sha did not match $sha" >&2
fi

for prefix in ${GITHUB_DOWNLOAD_PROXIES:-} ""; do
    source="$prefix$url"
    echo "Downloading $source"
    if curl --fail --silent --show-error --location --http1.1 \
            --connect-timeout 20 --speed-limit 102400 --speed-time 60 --max-time 1800 \
            --output "$output" "$source" \
        && verify; then
        exit 0
    fi
    echo "Download from $source failed or did not match $sha" >&2
done
rm -f "$output"
exit 1
