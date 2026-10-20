#!/bin/sh
# Run once on the rooted TV (telnet) after installing OpenTV Launcher:
#   sh /media/developer/apps/usr/palm/applications/com.opentvlauncher.lg/install-autostart.sh
# Pass "remove" to turn it off again.

APPDIR="/media/developer/apps/usr/palm/applications/com.opentvlauncher.lg"
DEST="/var/lib/webosbrew/init.d/50opentvlauncher"

# Stop any watcher that is already running
for p in $(ps -ef 2>/dev/null | grep -E "50opentvlauncher|opentvlauncher.lg/autostart.sh" | grep -v grep | awk '{print $2}'); do
  kill "$p" 2>/dev/null
done
# and its luna-send subscriptions and log reader
for p in $(ps -ef 2>/dev/null | grep -E "luna-send -i .*(getForegroundAppInfo|getPowerState)|tail -n 0 -F /var/log/messages" | grep -v grep | awk '{print $2}'); do
  kill "$p" 2>/dev/null
done

if [ "$1" = "remove" ]; then
  rm -f "$DEST"
  echo "Auto-start removed."
  exit 0
fi

mkdir -p /var/lib/webosbrew/init.d
# A real copy (not a link), so reinstalling the app can't break it
cp "$APPDIR/autostart.sh" "$DEST"
chmod 755 "$DEST"
echo "Installed $DEST"
nohup "$DEST" >/dev/null 2>&1 &
sleep 1
echo "Watcher started. Log: /tmp/opentvlauncher.log"
