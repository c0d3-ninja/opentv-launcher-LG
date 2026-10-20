#!/bin/sh
# opentv-adblock uninstaller. Turns everything off and removes it.
#   sh /home/root/opentv-adblock/uninstall.sh            remove everything
#   sh /home/root/opentv-adblock/uninstall.sh --keep     turn off and remove the boot script, keep settings and logs
# Or, without the files on the TV:
#   curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/uninstall.sh | sh

DEST=${INSTALL_DIR:-/home/root/opentv-adblock}
BOOT_SCRIPT=/var/lib/webosbrew/init.d/70opentv-adblock
KEEP=0
[ "$1" = "--keep" ] && KEEP=1
WARNED=0

ok()   { echo "  [ OK ] $*"; }
warn() { echo "  [ !! ] $*"; WARNED=1; }

[ "$(id -u)" = 0 ] || { echo "  [FAIL] Run this as root on the TV."; exit 1; }

echo ""
echo "=============================================="
echo "      opentv-adblock for LG: Uninstall"
echo "=============================================="
echo ""

rm -f "$BOOT_SCRIPT"
if [ -e "$BOOT_SCRIPT" ]; then warn "Could not delete $BOOT_SCRIPT"; else ok "It will no longer turn on at boot"; fi

# A start-up still in progress would turn things back on: stop it first.
# Its process ids are in the install folder: whoever holds the lock (a start-up or a
# switch on/off), the proxy's restart loop, then the proxy itself. Each file holds
# "<id> <start time>": after a reboot the same id can belong to another program,
# so a process is only stopped when its start time matches too.
proc_start() { [ -r "/proc/$1/stat" ] && sed 's/^.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20; }
for pf in "$DEST/.lock/pid" "$DEST/update-watch.pid" "$DEST/run-proxy.pid" "$DEST/pvproxy.pid"; do
  [ -f "$pf" ] || continue
  set -- $(cat "$pf" 2>/dev/null)
  [ -n "$1" ] && [ -n "$2" ] && [ "$(proc_start "$1")" = "$2" ] && kill "$1" 2>/dev/null
done
# Anything of ours not in those files: found by command line, so any "ps" works
for d in /proc/[0-9]*; do
  case "$({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null)" in
    "sh $DEST/ctl.sh "*|"node $DEST/pvproxy.js"*) kill "${d#/proc/}" 2>/dev/null ;;
    # the Prime Video update watcher's listener
    "luna-send -i luna://com.webos.appInstallService/status "*) kill "${d#/proc/}" 2>/dev/null ;;
  esac
done

if [ -f "$DEST/ctl.sh" ]; then
  sh "$DEST/ctl.sh" stop </dev/null >/dev/null 2>&1
fi
# Anything still overlaid (for example from a folder that was already deleted)
grep -q "^# opentv-adblock blocklist" /etc/hosts 2>/dev/null && umount /etc/hosts 2>/dev/null
for m in $(grep -E 'default_config\.json' /proc/mounts 2>/dev/null | awk '{print $2}' | grep '/amazon'); do
  umount "$m" 2>/dev/null
done

if grep -q "^# opentv-adblock blocklist" /etc/hosts 2>/dev/null; then
  warn "The blocklist is still active. It goes away at the next reboot."
else
  ok "Google ad blocklist off"
fi
if grep -E 'default_config\.json' /proc/mounts 2>/dev/null | grep -q '/amazon'; then
  warn "Prime Video still has the proxy setting. It goes away at the next reboot."
else
  ok "Prime Video back to normal"
fi

if [ $KEEP = 1 ]; then
  ok "Files kept in $DEST"
elif [ -d "$DEST" ]; then
  # Only our own files are deleted, so a mistaken INSTALL_DIR can never wipe a folder
  for f in ctl.sh pvproxy.js primeconfig.js hosts.blocklist uninstall.sh config hosts.custom \
           hosts.generated prime_config.json key.pem cert.pem .prime_check \
           opentv-adblock.log opentv-adblock.log.old pvproxy.log pvproxy.log.old \
           run-proxy.pid pvproxy.pid update-watch.pid .prime-updating; do
    rm -f "$DEST/$f"
  done
  rm -rf "$DEST/.lock"
  if rmdir "$DEST" 2>/dev/null; then
    ok "Files removed"
  else
    warn "Our files were removed, but $DEST also has other files, so it was left in place"
  fi
else
  ok "No files to remove"
fi

echo ""
echo "=============================================="
if [ $KEEP = 1 ]; then
  echo "  Done! opentv-adblock is turned off."
  echo "  Its files are kept in $DEST."
  echo "  To use it again: sh $DEST/ctl.sh on (and reinstall to turn on at boot)"
elif [ $WARNED = 0 ]; then
  echo "  Done! opentv-adblock is turned off and removed."
  echo "  Nothing on the TV was permanently changed."
else
  echo "  opentv-adblock is removed, with the warnings above."
  echo "  A reboot finishes the job."
fi
echo "=============================================="
echo ""
