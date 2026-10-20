#!/bin/sh
# Copies a tagged release of opentv-adblock-webos into app/adblock, so the
# launcher ships with the ad blocker built in.
#   sh scripts/sync-adblock.sh ../opentv-adblock-webos v1.1.1
set -e
REPO=${1:?usage: sh scripts/sync-adblock.sh <path to opentv-adblock-webos> <tag>}
TAG=${2:?usage: sh scripts/sync-adblock.sh <path to opentv-adblock-webos> <tag>}
cd "$(dirname "$0")/.."
OUT=app/adblock
FILES="install.sh uninstall.sh SHA256SUMS src/pvproxy.js src/primeconfig.js src/ctl.sh src/hosts.blocklist LICENSE"
git -C "$REPO" rev-parse -q --verify "$TAG^{commit}" >/dev/null || { echo "No tag $TAG in $REPO"; exit 1; }
rm -rf "$OUT"
mkdir -p "$OUT/src"
for f in $FILES; do git -C "$REPO" show "$TAG:$f" > "$OUT/$f"; done
chmod 755 "$OUT/install.sh" "$OUT/uninstall.sh" "$OUT/src/ctl.sh"
echo "$TAG $(git -C "$REPO" rev-parse --short "$TAG^{commit}")" > "$OUT/VERSION"
# The release must match its own checksums
(cd "$OUT" && sha256sum -c --quiet SHA256SUMS)
echo "app/adblock is now opentv-adblock-webos $(cat "$OUT/VERSION")"
