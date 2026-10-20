#!/bin/sh
# OpenTV Launcher installer. Runs ON THE TV, in its root shell.
#
# Easiest: paste this one line into the TV's root shell. The TV downloads
# everything from GitHub:
#     curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-launcher-LG/main/install/install.sh | sh
#
# If your TV can't reach GitHub, share the files from your computer instead:
# run "sh install/serve.sh" on the computer and paste the line it prints, like:
#     curl -fsS http://192.168.1.4:8000/install/install.sh | sh -s 192.168.1.4 8000
#
# It installs, sets up auto-start and checks every step.
# Arguments (optional): <computer IP> [port]

APP_ID="com.opentvlauncher.lg"
SERVICE_ID="$APP_ID.service"
APPS="/media/developer/apps/usr/palm"
APPDIR="$APPS/applications/$APP_ID"
INIT_FILE="/var/lib/webosbrew/init.d/50opentvlauncher"
LOG="/tmp/opentvlauncher.log"
IPK="/tmp/opentvlauncher.ipk"
DEFAULT_PORT="8000"
GITHUB="https://raw.githubusercontent.com/c0d3-ninja/opentv-launcher-LG/main"

ok()   { echo "  [ OK ] $*"; }
info() { echo "  [ .. ] $*"; }
warn() { echo "  [ !! ] $*"; }
fail() {
  echo ""
  echo "  [FAIL] $*"
  echo ""
  echo "  Installation stopped. Nothing else was changed."
  exit 1
}
step() { echo ""; echo "Step $1: $2"; }

# Read an answer from the person at the keyboard, with a default.
ask() {
  printf "  %s" "$1"
  [ -n "$2" ] && printf " [%s]" "$2"
  printf ": "
  if [ -r /dev/tty ]; then read -r answer </dev/tty; else read -r answer; fi
  [ -z "$answer" ] && answer="$2"
}

echo ""
echo "=============================================="
echo "        OpenTV Launcher for LG: Install"
echo "=============================================="

# ---------------------------------------------------------------- checks
step 1 "Checking this TV"
[ "$(id -u)" = "0" ] || fail "This needs the TV's root shell. Log in as root and run it again."
ok "Running as root"
[ -d /var/lib/webosbrew ] || fail "Homebrew Channel not found. Root the TV and install the Homebrew Channel first."
ok "Homebrew Channel found"
command -v luna-send >/dev/null 2>&1 || fail "luna-send not found. Is this an LG webOS TV?"
command -v curl >/dev/null 2>&1 || fail "curl not found on this TV."
ok "TV tools found (luna-send, curl)"
if luna-send -n 1 -w 5000 luna://com.webos.applicationManager/dev/listApps '{}' 2>/dev/null | grep -q '"com.palmdts.devmode"' ||
   [ -d /media/cryptofs/apps/usr/palm/applications/com.palmdts.devmode ]; then
  warn "LG's Developer Mode app is installed. Please uninstall it: when its"
  warn "session runs out it can delete apps like this one."
fi
TV_IP=$(ip -4 addr 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | grep -v '^127\.' | head -n 1)
[ -n "$TV_IP" ] && ok "This TV's IP address is $TV_IP"

# ---------------------------------------------------------------- source
step 2 "Finding the download"
COMPUTER_IP="$1"
BASE=""
if [ -z "$COMPUTER_IP" ]; then
  info "Trying GitHub"
  NAME=$(curl -s -f -L -m 20 "$GITHUB/dist/latest.txt" | tr -d ' \r\n')
  if [ -n "$NAME" ]; then
    BASE="$GITHUB"
    ok "Downloading from GitHub"
  else
    warn "This TV can't reach GitHub. We'll use your computer instead."
    echo "  On your computer, inside the opentv-launcher-LG folder, run:"
    echo "      sh install/serve.sh"
    echo "  It shows your computer's IP address. Type it below."
    echo ""
  fi
fi
if [ -z "$BASE" ]; then
  while [ -z "$COMPUTER_IP" ]; do
    ask "Your computer's IP address (example 192.168.1.4)" ""
    COMPUTER_IP="$answer"
    case "$COMPUTER_IP" in
      *[!0-9.]*|"") warn "That doesn't look like an IP address. Try again."; COMPUTER_IP="" ;;
    esac
  done
  PORT="$2"
  if [ -z "$PORT" ]; then ask "Port" "$DEFAULT_PORT"; PORT="$answer"; fi
  BASE="http://$COMPUTER_IP:$PORT"
  info "Checking that your computer can be reached"
  curl -s -o /dev/null -m 8 "$BASE/" ||
    fail "Can't reach $COMPUTER_IP:$PORT. Is install/serve.sh still running on your computer, and are the TV and computer on the same network?"
  ok "Your computer answered ($COMPUTER_IP, port $PORT)"
  NAME=$(curl -s -f -m 10 "$BASE/dist/latest.txt" | tr -d ' \r\n')
  [ -n "$NAME" ] || fail "Can't find dist/latest.txt. Run install/serve.sh from inside the opentv-launcher-LG folder."
fi

# ---------------------------------------------------------------- download
step 3 "Downloading the IPK"
ok "Newest version: $NAME"
rm -f "$IPK"
curl -s -f -L -m 180 -o "$IPK" "$BASE/dist/$NAME" ||
  fail "Download of dist/$NAME failed."
SIZE=$(wc -c <"$IPK" | tr -d ' ')
[ "$(head -c 7 "$IPK")" = "!<arch>" ] || fail "The downloaded file is not an IPK (got $SIZE bytes)."
ok "Downloaded $SIZE bytes"
command -v md5sum >/dev/null 2>&1 && ok "Checksum (md5): $(md5sum "$IPK" | cut -d' ' -f1)"

# ---------------------------------------------------------------- clean up an older copy
step 4 "Removing any older copy"
for p in $(ps -ef 2>/dev/null | grep -E "50opentvlauncher|$APP_ID/autostart.sh" | grep -v grep | awk '{print $2}'); do
  kill "$p" 2>/dev/null
done
for p in $(ps -ef 2>/dev/null | grep -E "luna-send -i .*(getForegroundAppInfo|getPowerState)|tail -n 0 -F /var/log/messages" | grep -v grep | awk '{print $2}'); do
  kill "$p" 2>/dev/null
done
luna-send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
rm -rf "$APPS/applications/$APP_ID" "$APPS/packages/$APP_ID"
ok "Ready for a clean install"

# ---------------------------------------------------------------- install
step 5 "Installing the app (this takes up to a minute)"
# Is the app installed? 0 = yes, 1 = no, 2 = the TV didn't answer
app_installed() {
  out=$(luna-send -n 1 -w 8000 luna://com.webos.applicationManager/dev/listApps '{}' </dev/null 2>/dev/null)
  echo "$out" | grep -q '"returnValue": *true' || return 2
  echo "$out" | grep -q "\"$APP_ID\"" && [ -f "$APPDIR/index.html" ] && return 0
  return 1
}
# The TV's installer ignores new requests while it is still busy (for
# example finishing an uninstall), so wait for the result and try again.
attempt=1
while :; do
  luna-send -n 12 -w 40000 luna://com.webos.appInstallService/dev/install \
    "{\"id\":\"$APP_ID\",\"ipkUrl\":\"$IPK\",\"subscribe\":true}" </dev/null >/tmp/opentvlauncher-install.txt 2>&1
  i=0
  until app_installed; do
    i=$((i + 1)); [ $i -ge 15 ] && break
    sleep 2
  done
  app_installed && break
  if [ $attempt -ge 3 ]; then
    echo ""
    cat /tmp/opentvlauncher-install.txt
    fail "The TV did not install the app (details above). Restart the TV and run this again."
  fi
  warn "The TV's installer is busy. Trying again in 15 seconds (attempt $((attempt + 1)) of 3)"
  attempt=$((attempt + 1))
  sleep 15
done
ok "OpenTV Launcher is installed"
for f in index.html boot.js apps.js launcher.js style.css autostart.sh install-autostart.sh sync-icons.js adblock/install.sh; do
  [ -f "$APPDIR/$f" ] || fail "Installed, but $f is missing from $APPDIR"
done
[ -f "$APPS/services/$SERVICE_ID/service.js" ] || fail "Installed, but the background service is missing."
ok "All app files are in place"
rm -f "$IPK" /tmp/opentvlauncher-install.txt

# ---------------------------------------------------------------- auto-start
step 6 "Turning on start-up, Home button and recent apps"
rm -f "$LOG"
sh "$APPDIR/install-autostart.sh" </dev/null >/dev/null 2>&1
[ -x "$INIT_FILE" ] || fail "Could not create the start-up file $INIT_FILE"
ok "Starts automatically every time the TV turns on"

# ---------------------------------------------------------------- ad blocker
step 7 "Setting up the ad blocker"
# The ad blocker (opentv-adblock-webos) ships inside the launcher. It is installed
# to the same place as a separate install, and switched on or off with
# "Block ads" in Launcher Settings.
ADB_DIR="/home/root/opentv-adblock"
ADB_OWNED="/var/lib/webosbrew/opentvlauncher/adblock-installed-by-launcher"
if [ -f "$ADB_DIR/ctl.sh" ] && [ ! -f "$ADB_OWNED" ]; then
  ok "Ad blocker already installed separately: left as it is"
  ok "\"Block ads\" in Launcher Settings switches it on and off"
else
  # Keep the current setting when updating; a new install starts off
  was_on=0
  grep -q '^ENABLED=1' "$ADB_DIR/config" 2>/dev/null && [ -f "$ADB_OWNED" ] && was_on=1
  if sh "$APPDIR/adblock/install.sh" --no-start </dev/null >/tmp/opentvlauncher-adblock.txt 2>&1 &&
     [ -f "$ADB_DIR/ctl.sh" ]; then
    mkdir -p "$(dirname "$ADB_OWNED")"
    echo "$(cat "$APPDIR/adblock/VERSION" 2>/dev/null)" > "$ADB_OWNED"
    if [ $was_on = 1 ]; then
      sh "$ADB_DIR/ctl.sh" on </dev/null >/dev/null 2>&1
      ok "Ad blocker updated, and on (as before)"
    else
      sh "$ADB_DIR/ctl.sh" off </dev/null >/dev/null 2>&1
      ok "Ad blocker installed. It is off: switch on \"Block ads\" in Launcher Settings"
    fi
    rm -f /tmp/opentvlauncher-adblock.txt
  else
    warn "The ad blocker could not be installed (the launcher works without it):"
    sed -n 's/^ *\[\(FAIL\|!!\)\] /    /p' /tmp/opentvlauncher-adblock.txt
  fi
fi

# ---------------------------------------------------------------- verify
step 8 "Checking everything works (up to 90 seconds)"
info "Waiting for the launcher to set itself up"
i=0
until grep -q "boot -> launcher" "$LOG" 2>/dev/null; do
  i=$((i + 1)); [ $i -gt 45 ] && fail "The launcher did not start. See $LOG"
  sleep 2
done
ok "Background watcher is running"

# The service restarts while it gets root: give it up to 30 seconds
i=0
until luna-send -n 1 -w 5000 "luna://$SERVICE_ID/status" '{}' </dev/null 2>/dev/null | grep -q '"root": *true'; do
  i=$((i + 1)); [ $i -ge 10 ] && break
  sleep 3
done
if [ $i -lt 10 ]; then
  ok "Root access is working (new apps get their icons by themselves)"
else
  warn "Root access is not on yet. Press Home on the remote once; it turns on by itself."
fi

ICONS=$(sed -n 's/.*synced \([0-9]*\) apps, \([0-9]*\) icons.*/\2 icons for \1 apps/p' "$LOG" | tail -n 1)
[ -n "$ICONS" ] && ok "Copied $ICONS"

# The launcher is reopened a few times right after start: wait for it
i=0
while :; do
  FG=$(luna-send -n 1 -w 3000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null |
    sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')
  [ "$FG" = "$APP_ID" ] && break
  i=$((i + 1)); [ $i -ge 8 ] && break
  sleep 2
done
if [ "$FG" = "$APP_ID" ]; then
  ok "OpenTV Launcher is on screen"
else
  warn "Another app${FG:+ ($FG)} is on screen. Press Home on the remote."
fi

echo ""
echo "=============================================="
echo "  Done! OpenTV Launcher is installed and verified."
echo ""
echo "  Try it with the remote:"
echo "    - Home opens OpenTV Launcher"
echo "    - Back twice opens Recent Lists"
echo "    - LG Home (top bar) opens LG's own home"
echo "    - Launcher Settings (sliders, top bar) has \"Block ads\""
echo ""
echo "  Log: $LOG"
echo "  To remove it later, paste this into the TV's root shell:"
echo "    curl -fsSL $GITHUB/install/uninstall.sh | sh"
echo "=============================================="
echo ""
