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

# Root is needed for everything below
[ "$(id -u)" = "0" ] || fail "This needs the TV's root shell. Log in as root and run it again."

stop_watcher() {
  for p in $(ps -ef 2>/dev/null | grep -E "50opentvlauncher|$APP_ID/autostart.sh" | grep -v grep | awk '{print $2}'); do
    kill "$p" 2>/dev/null
  done
  for p in $(ps -ef 2>/dev/null | grep -E "luna-send -i .*(getForegroundAppInfo|getPowerState)|tail -n 0 -F /var/log/messages" | grep -v grep | awk '{print $2}'); do
    kill "$p" 2>/dev/null
  done
}

step 1 "Going to LG's home screen"
# Stop the watcher first, or it would put the launcher back on screen
stop_watcher
luna-send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" </dev/null >/dev/null 2>&1
luna-send -n 1 -w 5000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' </dev/null >/dev/null 2>&1
i=0
while :; do
  FG=$(luna-send -n 1 -w 3000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null |
    sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')
  [ "$FG" = "com.webos.app.home" ] && break
  i=$((i + 1)); [ $i -ge 8 ] && break
  sleep 1
done
if [ "$FG" = "com.webos.app.home" ]; then
  ok "LG's home is on screen"
else
  warn "Couldn't confirm LG's home is on screen. Carrying on."
fi

step 2 "Stopping the background watcher"
stop_watcher
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

step 4 "Removing the app (this takes up to 2 minutes)"
luna-send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" </dev/null >/dev/null 2>&1
pkill -f "services/$SERVICE_ID" 2>/dev/null

# Is the app still known to the TV? Only trusts a real answer from the TV.
#   0 = still installed, 1 = gone, 2 = the TV didn't answer
app_listed() {
  out=$(luna-send -n 1 -w 8000 luna://com.webos.applicationManager/dev/listApps '{}' </dev/null 2>/dev/null)
  echo "$out" | grep -q '"returnValue": *true' || return 2
  echo "$out" | grep -q "\"$APP_ID\"" && return 0
  return 1
}

# LG's own uninstaller runs in the background: ask it, then wait until the
# TV no longer lists the app. It can ignore a request while it is busy (for
# example just after the TV starts), so ask again, up to 3 times.
# The app's files must stay in place until it is done.
app_listed; state=$?
attempt=1
while [ $state -ne 1 ]; do
  luna-send -n 1 -w 30000 luna://com.webos.appInstallService/dev/remove "{\"id\":\"$APP_ID\"}" </dev/null >/tmp/opentvlauncher-remove.txt 2>&1
  i=0
  while :; do
    sleep 2
    app_listed; state=$?
    [ $state -eq 1 ] && break
    i=$((i + 1)); [ $i -ge 15 ] && break
  done
  [ $state -eq 1 ] && break
  if [ $attempt -ge 3 ]; then
    echo ""
    cat /tmp/opentvlauncher-remove.txt
    fail "The TV did not remove the app (details above). Restart the TV and run this again."
  fi
  warn "The TV's installer is busy. Asking again in 10 seconds (attempt $((attempt + 1)) of 3)"
  attempt=$((attempt + 1))
  sleep 10
done
rm -f /tmp/opentvlauncher-remove.txt
ok "The TV removed the app"

# Leftovers (only after LG's uninstaller is done)
rm -rf "$APPS/applications/$APP_ID" "$APPS/packages/$APP_ID" "$APPS/services/$SERVICE_ID"
ls-control scan-services >/dev/null 2>&1
[ -d "$APPS/applications/$APP_ID" ] && fail "App files are still in $APPS/applications/$APP_ID"
if luna-send -n 1 -w 8000 luna://com.webos.applicationManager/listLaunchPoints '{}' </dev/null 2>/dev/null | grep -q "\"$APP_ID\""; then
  fail "The app's icon is still on the TV. Restart the TV and run this again."
fi
ok "App, icon and background service removed"

step 5 "Removing the ad blocker"
# Only if the launcher installed it; a separate install of opentv-adblock is kept
ADB_DIR="/home/root/opentv-adblock"
if [ -f "$DATA_DIR/adblock-installed-by-launcher" ] && [ -f "$ADB_DIR/uninstall.sh" ]; then
  if sh "$ADB_DIR/uninstall.sh" </dev/null >/tmp/opentvlauncher-adblock.txt 2>&1 && [ ! -f "$ADB_DIR/ctl.sh" ]; then
    ok "Ad blocker turned off and removed"
  else
    warn "The ad blocker could not be removed completely:"
    sed -n 's/^ *\[\(FAIL\|!!\)\] /    /p' /tmp/opentvlauncher-adblock.txt
  fi
  rm -f /tmp/opentvlauncher-adblock.txt
elif [ -f "$ADB_DIR/ctl.sh" ]; then
  ok "Ad blocker was installed separately: kept (remove it with sh $ADB_DIR/uninstall.sh)"
else
  ok "No ad blocker to remove"
fi

step 6 "Removing saved data"
rm -rf "$DATA_DIR" "$LOG"
ok "Recent apps list and log removed"

echo ""
echo "=============================================="
echo "  Done! OpenTV Launcher is uninstalled and verified."
echo ""
echo "  LG's own home is back on screen."
echo "  The Homebrew Channel and root access were not touched."
echo "=============================================="
echo ""
