#!/bin/sh
# Install Debian packages from an optional mirror, then restore the base
# sources. A failed mirror install retries once from those original sources.
# Usage: apt-install.sh <debian-mirror> <security-mirror> <package>...
set -eu

mirror=$1
security_mirror=$2
shift 2

sources=/etc/apt/sources.list.d/debian.sources
cp "$sources" /tmp/debian.sources.original

install_packages() {
  apt-get update \
  && apt-get install -y --no-install-recommends "$@"
}

echo "Installing Debian packages from ${mirror}"
sed -i -E \
  -e "s#https?://deb.debian.org/debian-security#${security_mirror}#g" \
  -e "s#https?://deb.debian.org/debian#${mirror}#g" \
  "$sources"

if ! install_packages "$@"; then
  echo "Installing from ${mirror} failed; retrying with the original Debian sources" >&2
  cp /tmp/debian.sources.original "$sources"
  install_packages "$@"
fi

cp /tmp/debian.sources.original "$sources"
rm -f /tmp/debian.sources.original
