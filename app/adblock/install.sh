#!/bin/sh
# opentv-adblock installer for rooted LG webOS TVs (Homebrew Channel).
#
# Run on the TV as root. Easiest, one line (downloads everything from GitHub):
#   curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/install.sh | sh
#
# Or from a copy of this folder on the TV:
#   sh install.sh              install (or update) and turn it on
#   sh install.sh --no-start   install only; it turns on at the next boot
#
# Environment: INSTALL_DIR (default /home/root/opentv-adblock)
#              OTV_REF     GitHub tag or branch to download (default: the release below)

# Downloads come from a fixed release, not from whatever is on main at that moment,
# so a half-finished change can never break an install. Update with each release.
RELEASE="v1.2.0"
REF=${OTV_REF:-$RELEASE}
REPO_RAW="https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/$REF"
# Keep in sync with FILES in scripts/sums.js
FILES="src/pvproxy.js src/primeconfig.js src/ctl.sh src/hosts.blocklist uninstall.sh"
DEST=${INSTALL_DIR:-/home/root/opentv-adblock}
INIT_DIR=/var/lib/webosbrew/init.d
BOOT_SCRIPT="$INIT_DIR/70opentv-adblock"
START=1
for a in "$@"; do [ "$a" = "--no-start" ] && START=0; done

ok()   { echo "  [ OK ] $*"; }
info() { echo "  [ .. ] $*"; }
warn() { echo "  [ !! ] $*"; }
CHANGED=0
die() {
  echo ""; echo "  [FAIL] $*"; echo ""
  if [ $CHANGED = 0 ]; then
    echo "  Nothing was changed."
  else
    echo "  The install did not finish. Fix the problem above and run the install command again,"
    echo "  or remove what was installed with: sh $DEST/uninstall.sh"
  fi
  exit 1
}

echo ""
echo "=============================================="
echo "       opentv-adblock for LG: Install"
echo "=============================================="
echo ""

# ---- checks ----
[ "$(id -u)" = 0 ] || die "Run this as root on the TV."
command -v luna-send >/dev/null 2>&1 || die "This does not look like a webOS TV (luna-send not found)."
[ -d /var/lib/webosbrew ] || die "Homebrew Channel with root access is required (/var/lib/webosbrew not found)."
ok "Rooted webOS TV ($(cat /etc/starfish-release 2>/dev/null || echo 'version unknown'))"

# ---- the files: this folder, or GitHub when run with curl | sh ----
SRC=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
if [ ! -f "$SRC/src/pvproxy.js" ]; then
  command -v curl >/dev/null 2>&1 || die "curl not found. Copy the project folder to the TV and run: sh install.sh"
  SRC=/tmp/opentv-adblock-src
  rm -rf "$SRC"; mkdir -p "$SRC/src" || die "Cannot create $SRC"
  info "Downloading $REF from GitHub"
  for f in $FILES SHA256SUMS; do
    code=$(curl -sL --retry 3 -m 90 -w '%{http_code}' -o "$SRC/$f" "$REPO_RAW/$f" 2>/dev/null)
    case "$code" in
      200) ;;
      404)
        echo ""
        echo "  [FAIL] Version $REF was not found on GitHub ($f)."
        echo "         If it was published just now, wait a minute and try again."
        if [ "$REF" != main ]; then
          echo "         To install the latest development version instead:"
          echo "         curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/install.sh | OTV_REF=main sh"
        fi
        echo ""; echo "  Nothing was changed."; rm -rf "$SRC"; exit 1 ;;
      000|"")
        rm -rf "$SRC"
        die "Can't reach GitHub. Check the TV's internet connection and try again." ;;
      *)
        rm -rf "$SRC"
        die "GitHub answered with error $code for $f. Try again in a few minutes." ;;
    esac
  done
  ok "Downloaded $REF"
fi
for f in $FILES; do [ -s "$SRC/$f" ] || die "$f is missing from $SRC"; done

# Every file must match its checksum: catches broken or half-finished downloads
if [ -f "$SRC/SHA256SUMS" ] && command -v sha256sum >/dev/null 2>&1; then
  bad=""
  for f in $FILES; do
    want=$(grep "  $f\$" "$SRC/SHA256SUMS" | cut -d' ' -f1)
    have=$(sha256sum "$SRC/$f" | cut -d' ' -f1)
    [ -n "$want" ] && [ "$want" = "$have" ] || bad="$bad $f"
  done
  if [ -z "$bad" ]; then
    ok "All files match their checksums"
  elif [ "$SRC" = /tmp/opentv-adblock-src ]; then
    die "Downloaded files don't match their checksums:$bad. Please run the install command again."
  else
    warn "Changed from the release (checksum differs):$bad"
  fi
elif [ ! -f "$SRC/SHA256SUMS" ]; then
  warn "No SHA256SUMS file: the files were not checked against their checksums"
else
  warn "sha256sum is not available on this TV: the files were not checked against their checksums"
fi

PRIME=1
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found: Prime Video ad removal is off (Google ad blocking still works)"
  PRIME=0
else
  major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
  if [ "${major:-0}" -lt 8 ]; then
    warn "Node.js 8 or newer is needed for Prime Video ad removal; it is off"
    PRIME=0
  else
    ok "Node.js $(node -v)"
  fi
fi
if [ $PRIME = 1 ] && ! command -v openssl >/dev/null 2>&1 && [ ! -f "$DEST/key.pem" ]; then
  warn "openssl not found: Prime Video ad removal is off (Google ad blocking still works)"
  PRIME=0
fi

# ---- stop a previous install before updating ----
if [ -f "$DEST/ctl.sh" ]; then
  info "Updating the existing install in $DEST"
  CHANGED=1
  # A start-up still waiting for Prime Video (up to 2 minutes after the TV starts) holds
  # the lock: stop it, the install turns everything on again below
  for d in /proc/[0-9]*; do
    case "$({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null)" in
      "sh $DEST/ctl.sh boot-run"*) kill "${d#/proc/}" 2>/dev/null && info "Stopped a start-up that was still running" ;;
    esac
  done
  sh "$DEST/ctl.sh" stop </dev/null >/dev/null 2>&1
fi

# ---- copy files ----
CHANGED=1
mkdir -p "$DEST" "$INIT_DIR" || die "Cannot create $DEST"
for f in $FILES; do
  cp "$SRC/$f" "$DEST/$(basename "$f")" || die "Cannot copy $f"
done
chmod 755 "$DEST/ctl.sh" "$DEST/uninstall.sh"
ok "Files installed to $DEST"

# ---- per-TV certificate (only secures the hop between the app and the proxy on this TV) ----
if [ $PRIME = 1 ] && { [ ! -f "$DEST/key.pem" ] || [ ! -f "$DEST/cert.pem" ]; }; then
  info "Creating a certificate for this TV"
  if openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=opentv-adblock" \
       -keyout "$DEST/key.pem" -out "$DEST/cert.pem" </dev/null >/dev/null 2>&1; then
    chmod 600 "$DEST/key.pem"
    ok "Certificate created"
  else
    warn "Certificate creation failed: Prime Video ad removal is off"
    PRIME=0
  fi
fi

# ---- settings (kept on update) ----
set_conf() {
  if grep -q "^$1=" "$DEST/config"; then sed -i "s/^$1=[^[:space:]#]*/$1=$2/" "$DEST/config"
  else echo "$1=$2" >> "$DEST/config"; fi
}
if [ ! -f "$DEST/config" ]; then
  cat > "$DEST/config" <<EOF
# opentv-adblock settings. Run "sh $DEST/ctl.sh restart" after changing them.
ENABLED=1                # 1 = turns on at every boot (ctl.sh on / ctl.sh off change this)
ENABLE_PRIME=$PRIME           # Prime Video ad removal (on-device proxy)
ENABLE_HOSTS=1           # block Google ad servers for the whole TV
PROXY_PORT=8888          # local port for the Prime Video proxy
REMOVE_REMOTE=1          # 0 = only hide ad markers/pause ads (uBlock-style), keep ad entries
RESTART_WAM=0            # 1 = restart LG's web-app engine when blocking switches (closes web apps)
WAM_DELAY=20             # with RESTART_WAM=1: seconds to wait after boot before that restart
EOF
  [ $PRIME = 0 ] && echo "PRIME_AUTO_OFF=1         # switched off by the installer; turned back on when possible" >> "$DEST/config"
  ok "Settings created"
else
  # Settings from version 1.0.0: the web-app engine restart closed every web app. Now off by default.
  grep -q '^ENABLED=' "$DEST/config" || set_conf RESTART_WAM 0
  if [ $PRIME = 0 ] && grep -q '^ENABLE_PRIME=1' "$DEST/config"; then
    set_conf ENABLE_PRIME 0; set_conf PRIME_AUTO_OFF 1
  elif [ $PRIME = 1 ] && grep -q '^PRIME_AUTO_OFF=1' "$DEST/config"; then
    set_conf ENABLE_PRIME 1; sed -i '/^PRIME_AUTO_OFF=/d' "$DEST/config"
  fi
  ok "Your settings were kept"
fi
[ -f "$DEST/hosts.custom" ] || printf '# Extra domains to block, one per line, for example:\n# ads.example.com\n' > "$DEST/hosts.custom"

# ---- boot script ----
{ cat > "$BOOT_SCRIPT" <<EOF
#!/bin/sh
# opentv-adblock: turns ad blocking on at boot. Remove with: sh $DEST/uninstall.sh
[ -f "$DEST/ctl.sh" ] && sh "$DEST/ctl.sh" boot
EOF
} 2>/dev/null && chmod 755 "$BOOT_SCRIPT" && [ -f "$BOOT_SCRIPT" ] && [ -x "$BOOT_SCRIPT" ] ||
  die "Could not create the boot script $BOOT_SCRIPT"
ok "Starts automatically every time the TV turns on"
[ "$SRC" = /tmp/opentv-adblock-src ] && rm -rf "$SRC"

echo ""
PROBLEMS=0
if [ $START = 1 ]; then
  info "Turning it on (up to 30 seconds)"
  sh "$DEST/ctl.sh" on </dev/null >/dev/null 2>&1
  STATE=$(sh "$DEST/ctl.sh" state </dev/null 2>/dev/null)
  val() { echo "$STATE" | sed -n "s/^$1=//p"; }
  case "$(val hosts)" in
    on) ok "Google ad blocklist is on" ;;
    disabled) info "Google ad blocklist is turned off in the settings" ;;
    *) warn "The Google ad blocklist did not turn on"; PROBLEMS=1 ;;
  esac
  case "$(val prime)" in
    on) ok "Prime Video ad removal is on" ;;
    disabled) info "Prime Video ad removal is off on this TV (see the warnings above)" ;;
    missing) info "Prime Video is not installed. Ad removal starts by itself after the next boot once it is." ;;
    unsupported) info "This Prime Video version can't use the proxy; only the Google blocklist applies to it" ;;
    *) warn "Prime Video ad removal did not turn on"; PROBLEMS=1 ;;
  esac
else
  set_conf ENABLED 1
  echo "  It turns on at the next boot. To turn it on now: sh $DEST/ctl.sh on"
fi

echo ""
echo "=============================================="
if [ $PROBLEMS = 0 ]; then
  echo "  Done! opentv-adblock is installed."
else
  echo "  Installed, but something did not turn on."
  echo "  See what happened:  sh $DEST/ctl.sh logs"
  echo "  Then try again:     sh $DEST/ctl.sh restart"
fi
echo ""
echo "  Turn off:   sh $DEST/ctl.sh off"
echo "  Turn on:    sh $DEST/ctl.sh on"
echo "  Status:     sh $DEST/ctl.sh status"
echo "  Remove:     sh $DEST/uninstall.sh"
echo "=============================================="
echo ""
