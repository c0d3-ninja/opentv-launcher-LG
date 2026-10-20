#!/bin/sh
# OpenTV Launcher uninstaller. Runs ON THE TV, in its root shell.
#
# Paste this one line into the TV's root shell:
#     curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-launcher-LG/main/install/uninstall.sh | sh
#
# No internet on the TV? Run "sh install/serve.sh" on your computer and paste
# the UNINSTALL line it prints, or copy this file to the TV and run it with sh.

APP_ID="com.opentvlauncher.lg"
SERVICE_ID="$APP_ID.service"
APPS="/media/developer/apps/usr/palm"
INIT_FILE="/var/lib/webosbrew/init.d/50opentvlauncher"
DATA_DIR="/var/lib/webosbrew/opentvlauncher"
LOG="/tmp/opentvlauncher.log"

ok()   { echo "  [ OK ] $*"; }
warn() { echo "  [ !! ] $*"; }
fail() { echo ""; echo "  [FAIL] $*"; echo ""; exit 1; }
step() { echo ""; echo "Step $1: $2"; }

echo ""
echo "=============================================="
echo "       OpenTV Launcher for LG: Uninstall"
echo "=============================================="

step 1 "Checking this TV"
[ "$(id -u)" = "0" ] || fail "This needs the TV's root shell. Log in as root and run it again."
ok "Running as root"

step 2 "Stopping the background watcher"
for p in $(ps -ef 2>/dev/null | grep -E "50opentvlauncher|$APP_ID/autostart.sh" | grep -v grep | awk '{print $2}'); do
  kill "$p" 2>/dev/null
done
for p in $(ps -ef 2>/dev/null | grep -E "luna-send -i .*(getForegroundAppInfo|getPowerState)|tail -n 0 -F /var/log/messages" | grep -v grep | awk '{print $2}'); do
  kill "$p" 2>/dev/null
done
sleep 1
if ps -ef 2>/dev/null | grep -E "50opentvlauncher|$APP_ID/autostart.sh" | grep -v grep >/dev/null; then
  warn "The watcher is still running. It stops for good after the next restart."
else
  ok "Watcher stopped"
fi

step 3 "Turning off auto-start"
rm -f "$INIT_FILE"
[ -e "$INIT_FILE" ] && fail "Could not delete $INIT_FILE"
ok "It will no longer open when the TV turns on"

step 4 "Removing the app"
luna-send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
luna-send -n 1 -w 30000 luna://com.webos.appInstallService/dev/remove "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
sleep 2
pkill -f "services/$SERVICE_ID" 2>/dev/null
rm -rf "$APPS/applications/$APP_ID" "$APPS/packages/$APP_ID" "$APPS/services/$SERVICE_ID"
ls-control scan-services >/dev/null 2>&1
if luna-send -n 1 -w 5000 luna://com.webos.applicationManager/dev/listApps '{}' 2>/dev/null | grep -q "\"$APP_ID\""; then
  fail "The TV still lists the app. Restart the TV and run this again."
fi
[ -d "$APPS/applications/$APP_ID" ] && fail "App files are still in $APPS/applications/$APP_ID"
ok "App and background service removed"

step 5 "Removing saved data"
rm -rf "$DATA_DIR" "$LOG"
ok "Recent apps list and log removed"

echo ""
echo "=============================================="
echo "  Done! OpenTV Launcher is uninstalled and verified."
echo ""
echo "  Press Home on the remote: LG's own home is back."
echo "  The Homebrew Channel and root access were not touched."
echo "=============================================="
echo ""
