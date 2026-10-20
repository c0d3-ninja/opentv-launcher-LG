#!/bin/sh
# Builds a webOS IPK with the layout appInstallService expects:
#   data.tar.gz -> usr/palm/applications/<id>/...  +  usr/palm/packages/<id>/packageinfo.json
#   control.tar.gz -> Debian-style "control"
set -e
cd "$(dirname "$0")"
ID=com.opentvlauncher.lg
VER=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' app/appinfo.json)
OUT="dist/${ID}_${VER}_all.ipk"
B=$(mktemp -d)

SVC="$ID.service"
mkdir -p "$B/data/usr/palm/applications/$ID" "$B/data/usr/palm/packages/$ID" "$B/data/usr/palm/services/$SVC" "$B/ctl"
cp -R app/. "$B/data/usr/palm/applications/$ID/"
cp -R service/. "$B/data/usr/palm/services/$SVC/"
# Files the TV creates at run time are never packed
rm -rf "$B/data/usr/palm/applications/$ID/installed.js" "$B/data/usr/palm/applications/$ID/installed.js.tmp" \
       "$B/data/usr/palm/applications/$ID/icons" "$B/data/usr/palm/applications/$ID/recents"
# Catch JavaScript mistakes before they reach the TV
if command -v node >/dev/null 2>&1; then
  for f in app/*.js service/*.js; do node --check "$f" || { echo "Syntax error in $f"; exit 1; }; done
fi
cat > "$B/data/usr/palm/packages/$ID/packageinfo.json" <<EOF
{
  "id": "$ID",
  "version": "$VER",
  "app": "$ID",
  "services": ["$SVC"]
}
EOF
SIZE=$(du -sk "$B/data" | cut -f1)
cat > "$B/ctl/control" <<EOF
Package: $ID
Version: $VER
Section: misc
Priority: optional
Architecture: all
Installed-Size: $((SIZE * 1024))
Maintainer: OpenTV Launcher <opentv-launcher@users.noreply.github.com>
Description: OpenTV Launcher
webOS-Package-Format-Version: 2
webOS-Packager-Version: x.y.x
EOF
printf '2.0\n' > "$B/debian-binary"
(cd "$B/data" && tar czf ../data.tar.gz --owner=0 --group=0 usr)
(cd "$B/ctl" && tar czf ../control.tar.gz --owner=0 --group=0 control)
mkdir -p dist
rm -f "$OUT"
(cd "$B" && ar rc "$OLDPWD/$OUT" debian-binary control.tar.gz data.tar.gz)
# The installer reads this to find the newest IPK
basename "$OUT" > dist/latest.txt
echo "$OUT"
