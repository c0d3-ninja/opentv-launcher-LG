#!/bin/sh
# OpenTV Launcher watcher. Installed as /var/lib/webosbrew/init.d/50opentvlauncher,
# which the Homebrew Channel runs at every boot.
#   - boot: syncs app icons, then opens OpenTV Launcher
#   - wake from standby (Quick Start+): opens OpenTV Launcher
#   - Home button: LG's home (com.webos.app.home) is replaced by OpenTV Launcher
#   - recent apps: every app that comes to the front is saved to $RECENT

trap '' HUP   # keep running when the shell that started us goes away

APP_ID="com.opentvlauncher.lg"
LG_HOME="com.webos.app.home"
APPDIR="/media/developer/apps/usr/palm/applications/$APP_ID"
LOG="/tmp/opentvlauncher.log"
SERVICE_ID="$APP_ID.service"
RECENT_DIR="/var/lib/webosbrew/opentvlauncher"
RECENT="$RECENT_DIR/recent.txt"   # recently used apps, newest first
ELEVATE="/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service"

# Give the launcher's service root (Homebrew Channel tool). Needed after
# every boot and every reinstall.
elevate() {
  if [ -x "$ELEVATE" ]; then
    echo "$(date) elevating $SERVICE_ID"
    "$ELEVATE" "$SERVICE_ID" >/dev/null 2>&1
    # elevate-service can crash on its last step (the rescan prints too much
    # for it), so rescan here and restart the service as root.
    ls-control scan-services >/dev/null 2>&1
    pkill -f "services/$SERVICE_ID" 2>/dev/null
  fi
}

open_launcher() {
  # App deleted (watch_uninstall cleans up shortly): leave LG's home alone
  [ -d "$APPDIR" ] || return 0
  # Reinstalling the app wipes its folder: re-copy icons if they are gone,
  # and restart the page so it picks them up.
  if [ ! -f "$APPDIR/installed.js" ]; then
    echo "$(date) icons missing (reinstalled?), syncing"
    elevate
    node "$APPDIR/sync-icons.js"
    luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
    sleep 1
  fi
  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
}

# Put an app at the top of the recent list (keeps 30, no duplicates).
record_recent() {
  id="$1"
  case "$id" in ""|"$APP_ID"|"$LG_HOME") return ;; esac
  mkdir -p "$RECENT_DIR"
  [ "$(head -n 1 "$RECENT" 2>/dev/null)" = "$id" ] && return
  { echo "$id"; grep -v -x -F "$id" "$RECENT" 2>/dev/null; } | head -n 30 >"$RECENT.tmp" &&
    mv "$RECENT.tmp" "$RECENT"
}

# First run: start the recent list from the apps launched since boot
# (system log, oldest first) and LG's own recents.
seed_recent() {
  [ -s "$RECENT" ] && return
  echo "$(date) seeding recent apps"
  luna-send -n 1 -w 3000 luna://com.webos.service.recent/listRecents '{}' 2>/dev/null |
    sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p' | while read -r id; do record_recent "$id"; done
  grep NL_APP_LAUNCH_BEGIN /var/log/messages 2>/dev/null |
    sed -n 's/.*"app_id":"\([^"]*\)".*/\1/p' | while read -r id; do record_recent "$id"; done
}

foreground() {
  luna-send -n 1 -w 3000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null \
    | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p'
}

# LG reopens the last app/input a few seconds after boot or wake.
# Open ours now, then again if something else took the screen.
open_and_hold() {
  open_launcher
  for t in 3 4 5; do
    sleep "$t"
    fg=$(foreground)
    if [ -n "$fg" ] && [ "$fg" != "$APP_ID" ]; then
      echo "$(date) $1: '$fg' took over, reopening"
      open_launcher
    fi
  done
}

# True if the most recent launch of LG's home came from our "LG Home" button.
# (Back inside an app also sends you to LG's home, via "last_input_handler";
# that is replaced with the launcher like the Home button.)
home_opened_by_us() {
  grep "NL_APP_LAUNCH_BEGIN {\"app_id\":\"$LG_HOME\"" /var/log/messages 2>/dev/null | tail -n 1 |
    grep -q "\"caller_id\":\"$APP_ID"
}

# Home button, fast path: the system log records LG's home being launched
# the moment the button is pressed (caller com.webos.surfacemanager), before
# it is drawn. Open ours right then.
watch_home_log() {
  while true; do
    tail -n 0 -F /var/log/messages 2>/dev/null |
    while read -r line; do
      case "$line" in
        *NL_APP_LAUNCH_BEGIN*"\"app_id\":\"$LG_HOME\""*)
          case "$line" in
            *"\"caller_id\":\"$APP_ID"*) echo "$(date) LG home opened from launcher, leaving it" ;;
            *) echo "$(date) home button -> launcher"; open_launcher & ;;
          esac
          ;;
      esac
    done
    sleep 2
  done
}

# Home button, safety net: if LG's home still reaches the front and we did
# not ask for it, open ours.
watch_home() {
  while true; do
    luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true}' 2>/dev/null |
    while read -r line; do
      case "$line" in
        *'"appId"'*) record_recent "$(echo "$line" | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')" ;;
      esac
      case "$line" in
        *"\"appId\":\"$LG_HOME\""*|*"\"appId\": \"$LG_HOME\""*)
          sleep 1
          if ! home_opened_by_us && [ "$(foreground)" = "$LG_HOME" ]; then
            echo "$(date) LG home in front -> launcher"
            open_launcher
          fi
          ;;
      esac
    done
    sleep 2
  done
}

# Wake from standby: power state returns to Active from a standby state.
watch_power() {
  last="Active"
  while true; do
    luna-send -i luna://com.webos.service.tvpower/power/getPowerState '{"subscribe":true}' 2>/dev/null |
    while read -r line; do
      state=$(echo "$line" | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p')
      [ -z "$state" ] && continue
      if [ "$state" = "Active" ]; then
        case "$last" in
          "Active Standby"|Suspend|Off|"Power Off"|"Screen Off")
            echo "$(date) wake ($last -> Active) -> launcher"
            sleep 2
            open_and_hold wake &
            ;;
        esac
      fi
      last="$state"
    done
    sleep 2
  done
}

# The app was deleted some other way (for example from LG's own home):
# remove this watcher's start-up file and saved data, then stop everything.
INIT_FILE="/var/lib/webosbrew/init.d/50opentvlauncher"
app_is_gone() {
  [ -d "$APPDIR" ] && return 1
  out=$(luna-send -n 1 -w 8000 luna://com.webos.applicationManager/dev/listApps '{}' 2>/dev/null)
  echo "$out" | grep -q '"returnValue": *true' || return 1   # no answer: don't guess
  echo "$out" | grep -q "\"$APP_ID\"" && return 1
  return 0
}

cleanup_if_uninstalled() {
  app_is_gone || return 0
  # A reinstall also removes the folder for a moment: check again later
  sleep 90
  app_is_gone || return 0
  echo "$(date) app was uninstalled: removing the watcher"
  rm -f "$INIT_FILE"
  rm -rf "$RECENT_DIR"
  for p in $(ps -ef 2>/dev/null | grep -E "luna-send -i .*(getForegroundAppInfo|getPowerState)|tail -n 0 -F /var/log/messages" | grep -v grep | awk '{print $2}'); do
    kill "$p" 2>/dev/null
  done
  for p in $(ps -ef 2>/dev/null | grep -E "50opentvlauncher|$APP_ID/autostart.sh" | grep -v grep | awk '{print $2}'); do
    kill "$p" 2>/dev/null   # includes this process: everything stops
  done
  exit 0
}

watch_uninstall() {
  while true; do
    sleep 60
    cleanup_if_uninstalled
  done
}

main() {
  # Uninstalled while the TV was off: clean up and stop
  cleanup_if_uninstalled

  # Wait for the app manager to come up after boot (up to 2 minutes).
  i=0
  while [ $i -lt 60 ]; do
    luna-send -n 1 -w 3000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null \
      | grep -q '"returnValue": *true' && break
    sleep 2; i=$((i + 1))
  done
  sleep 5

  elevate
  seed_recent
  echo "$(date) syncing icons"
  node "$APPDIR/sync-icons.js"
  # Close any launcher page loaded before the sync, so it reloads with the icons
  luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
  sleep 1

  watch_home_log &
  watch_home &
  watch_power &
  watch_uninstall &

  echo "$(date) boot -> launcher"
  open_and_hold boot
  wait
}

main >>"$LOG" 2>&1 &
