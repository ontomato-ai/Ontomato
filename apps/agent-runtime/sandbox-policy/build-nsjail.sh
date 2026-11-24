#!/bin/sh
set -eu
mkdir /build-nsjail
cd /build-nsjail
while read -r name version digest source license; do
    case "$name" in '#'*) continue ;; esac
    curl -fsSL "$source" -o "$name.tar.gz"
    printf '%s  %s\n' "$digest" "$name.tar.gz" | sha256sum -c -
    mkdir "$name"
    tar -xzf "$name.tar.gz" -C "$name" --strip-components=1
done < /sandbox-policy/sources.lock
rmdir nsjail/kafel
mv kafel nsjail/kafel
cd nsjail
# Keep compiler-driver link options out of Kafel's recursive make, which calls ld.
make -j2 MAKEOVERRIDES= LDFLAGS="-static -Wl,-z,noexecstack $(pkg-config --static --libs protobuf libnl-route-3.0) -pthread"
! readelf -l nsjail | grep -q INTERP
install -D -m755 nsjail /output/nsjail
install -D -m644 LICENSE /output/licenses/nsjail.txt
install -D -m644 kafel/LICENSE /output/licenses/kafel.txt
