#!/bin/sh
# opentv-adblock control script.
#
#   ctl.sh on         turn ad blocking on, now and at every boot
#   ctl.sh off        turn ad blocking off, now and at every boot
#   ctl.sh start      turn it on now, until the next reboot
#   ctl.sh stop       turn it off now, until the next reboot (back to stock behaviour)
#   ctl.sh restart    stop, then start
#   ctl.sh status     show what is active
#   ctl.sh state      the same, as key=value lines (for scripts and apps)
#   ctl.sh logs       show recent log lines
#   ctl.sh boot       used by the Homebrew Channel boot script
#
# Settings live in "config" next to this script.

DIR=$(cd "$(dirname "$0")" && pwd)
CONF="$DIR/config"
LOG="$DIR/opentv-adblock.log"
PLOG="$DIR/pvproxy.log"
LOOP_PID="$DIR/run-proxy.pid"
NODE_PID="$DIR/pvproxy.pid"
UPD_PID="$DIR/update-watch.pid"
UPDATING="$DIR/.prime-updating"
LOCK="$DIR/.lock"
MARK="# opentv-adblock blocklist"
TV_CA=/etc/ssl/certs/ca-certificates.crt
APP_ID=amazon

ENABLED=1
ENABLE_PRIME=1
ENABLE_HOSTS=1
PROXY_PORT=8888
REMOVE_REMOTE=1
RESTART_WAM=0
WAM_DELAY=20
[ -f "$CONF" ] && . "$CONF"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Keep a log under about 1 MB. The proxy's log is only rotated by proxy_loop, right
# before it starts the proxy, so the running proxy never writes into the old file.
rotate() {
  f=${1:-$LOG}
  if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 1000000 ]; then mv "$f" "$f.old"; fi
}

# Change one setting in the config file (added if missing), and in this run too
set_conf() {
  [ -f "$CONF" ] || touch "$CONF"
  if grep -q "^$1=" "$CONF"; then
    sed -i "s/^$1=[^[:space:]#]*/$1=$2/" "$CONF"
  else
    echo "$1=$2" >> "$CONF"
  fi
  eval "$1=\$2"
}

# Only one start/stop at a time (a toggle pressed twice must not overlap)
lock() {
  n=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    if [ -f "$LOCK/pid" ] && ! pid_alive "$LOCK/pid"; then
      rm -rf "$LOCK"; continue                        # left behind by a stopped run or a reboot
    fi
    n=$((n + 1)); [ $n -ge 120 ] && { rm -rf "$LOCK"; continue; }
    sleep 1
  done
  write_pid "$LOCK/pid" $$
  trap 'rm -rf "$LOCK"' EXIT
  trap 'exit 1' INT TERM
}

node_bin() { command -v node 2>/dev/null; }

luna() { luna-send -n 1 -w "${3:-5000}" "$1" "$2" </dev/null 2>/dev/null; }

foreground_app() {
  luna luna://com.webos.applicationManager/getForegroundAppInfo '{}' 3000 |
    sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p' | head -n 1
}

# Something is listening on the proxy port (on any address: 127.0.0.1, 0.0.0.0, ::)
listening() {
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -q "[:.]$PROXY_PORT\$"
  else
    node -e "require('net').connect($PROXY_PORT,'127.0.0.1').on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})" 2>/dev/null
  fi
}

is_mounted() { grep -q " $1 " /proc/mounts 2>/dev/null; }

# Process id files hold "<id> <start time>". After a reboot (or a power cut) the files
# are still there, but the same ids can belong to completely different programs; the
# start time tells them apart, so we never trust or stop a program that isn't ours.
proc_start() { [ -r "/proc/$1/stat" ] && sed 's/^.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20; }
write_pid() { echo "$2 $(proc_start "$2")" > "$1"; }
# The id in a process id file, only if that process is still the one that wrote it
pid_of() {
  [ -f "$1" ] || return 1
  set -- $(cat "$1" 2>/dev/null)
  [ -n "$1" ] && [ -n "$2" ] && [ "$(proc_start "$1")" = "$2" ] && echo "$1"
}
pid_alive() { [ -n "$(pid_of "$1")" ]; }
# This shell is the proxy's restart loop named in the file
loop_is_me() { [ "$(cut -d' ' -f1 "$LOOP_PID" 2>/dev/null)" = "$$" ]; }

# Our proxy is up: our own process is running and the port answers
proxy_ready() { pid_alive "$NODE_PID" && listening; }

restart_wam() {
  # Only used with RESTART_WAM=1. Web apps (SonyLIV, ZEE5, ...) run in LG's web-app engine.
  # It looks addresses up again by itself within about a minute, so this is normally not
  # needed. Restarting it closes every web app, including home-screen apps like
  # OpenTV Launcher, so whatever was on screen is opened again afterwards.
  fg=$(foreground_app)
  if systemctl restart webapp-mgr.service 2>/dev/null; then log "web-app engine restarted (systemd)"
  elif initctl restart webapp-mgr 2>/dev/null; then log "web-app engine restarted (upstart)"
  else log "could not restart the web-app engine; reopen apps to apply the blocklist"; return
  fi
  if [ -n "$fg" ]; then
    sleep 3
    luna luna://com.webos.applicationManager/launch "{\"id\":\"$fg\"}" 10000 >/dev/null
    log "reopened $fg"
  fi
}

close_prime() {
  luna luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" >/dev/null
}

# Like "Close All" in Recent Lists: close every app there and remove its card, so each
# app opens fresh with the new blocking. OpenTV Launcher and LG's home stay.
SWITCHED=0
close_recents() {
  ids=$(luna luna://com.webos.service.recent/listRecents '{}' 5000 |
    grep -o '"appId": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
  n=0
  for id in $ids; do
    case "$id" in
      com.opentvlauncher.lg|com.webos.app.home|*[!A-Za-z0-9._-]*) continue ;;
    esac
    luna luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$id\"}" >/dev/null
    luna luna://com.webos.service.recent/removeRecent "{\"appId\":\"$id\"}" >/dev/null
    n=$((n + 1))
  done
  log "closed $n app(s) in Recent Lists"
}

# ---------------- Google ad-server blocklist (/etc/hosts) ----------------

hosts_active() { grep -q "^$MARK" /etc/hosts 2>/dev/null; }

# Lines from a blocklist file: comments and blank lines dropped, a bare domain becomes
# "0.0.0.0 domain", and every blocked domain is also blocked for IPv6 ("::  domain")
hosts_lines() {
  [ -f "$1" ] || return 0
  awk '/^[[:space:]]*#/ || NF == 0 { next }
       NF == 1 { print "0.0.0.0 " $1; print ":: " $1; next }
       $1 == "0.0.0.0" || $1 == "127.0.0.1" { print; for (i = 2; i <= NF; i++) print ":: " $i; next }
       { print }' "$1"
}

# Returns 0 only when the blocklist was switched on now
hosts_start() {
  [ "$ENABLE_HOSTS" = 1 ] || return 1
  hosts_active && return 1
  {
    cat /etc/hosts
    echo
    echo "$MARK"
    hosts_lines "$DIR/hosts.blocklist"
    hosts_lines "$DIR/hosts.custom"
  } > "$DIR/hosts.generated"
  if mount --bind "$DIR/hosts.generated" /etc/hosts; then
    log "blocklist on ($(grep -c '^0\.0\.0\.0' "$DIR/hosts.generated") domains)"
    return 0
  fi
  log "could not mount the blocklist over /etc/hosts"
  return 1
}

# Returns 0 only when the blocklist was switched off now
hosts_stop() {
  hosts_active || return 1
  n=0
  while hosts_active && [ $n -lt 5 ]; do umount /etc/hosts 2>/dev/null || break; n=$((n + 1)); done
  if hosts_active; then log "could not remove the blocklist from /etc/hosts"; return 1; fi
  log "blocklist off"
  return 0
}

# ---------------- Prime Video proxy ----------------

prime_dir() {
  d=$(luna-send -n 1 -w 5000 -f luna://com.webos.applicationManager/getAppInfo "{\"id\":\"$APP_ID\"}" </dev/null 2>/dev/null \
      | sed -n 's/.*"folderPath": *"\([^"]*\)".*/\1/p' | head -n 1)
  for c in "$d" /media/cryptofs/apps/usr/palm/applications/$APP_ID /usr/palm/applications/$APP_ID; do
    if [ -n "$c" ] && [ -f "$c/appinfo.json" ]; then echo "$c"; return 0; fi
  done
  return 1
}

prime_supported() {
  # Only the Ignition-based (native) Prime Video app accepts the proxy options.
  # The answer is remembered until the app changes (checking means reading a large file).
  bin="$1/bin/ignition"
  grep -q '"main" *: *"bin/ignition"' "$1/appinfo.json" 2>/dev/null || return 1
  [ -f "$bin" ] || return 1
  key="$bin $(wc -c < "$bin" 2>/dev/null) $(date -r "$bin" +%s 2>/dev/null)"
  if [ -f "$DIR/.prime_check" ]; then
    case "$(cat "$DIR/.prime_check")" in
      "yes $key") return 0 ;;
      "no $key") return 1 ;;
    esac
  fi
  if grep -q 'http-proxy-server' "$bin" 2>/dev/null; then echo "yes $key" > "$DIR/.prime_check"; return 0; fi
  echo "no $key" > "$DIR/.prime_check"
  return 1
}

prime_targets() {
  echo "$1/default_config.json"
  echo "/var/palm/jail/$APP_ID$1/default_config.json"
}

prime_routed() {
  for t in $(prime_targets "$1"); do is_mounted "$t" && return 0; done
  return 1
}

prime_unroute() {
  for t in $(prime_targets "$1"); do
    while is_mounted "$t"; do umount "$t" 2>/dev/null || break; done
  done
}

# Proxy processes of this install that we no longer track (for example one left running
# after a stop raced a restart). Found by their command line, so any "ps" works.
orphan_pids() {
  keep=$(pid_of "$NODE_PID")
  for d in /proc/[0-9]*; do
    p=${d#/proc/}
    [ "$p" = "$keep" ] && continue
    case "$({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null)" in
      "node $DIR/pvproxy.js"*) echo "$p" ;;
    esac
  done
}

kill_orphans() {
  pids=$(orphan_pids)
  [ -n "$pids" ] || return 1
  kill $pids 2>/dev/null
  n=0
  while [ -n "$(orphan_pids)" ] && [ $n -lt 5 ]; do sleep 1; n=$((n + 1)); done
  log "Prime Video: stopped a leftover proxy ($pids)"
  return 0
}

# The port is taken by something that isn't our running proxy. A leftover proxy of
# ours is stopped (returns 1: carry on); anything else is another program (returns 0).
port_taken_by_other() {
  listening || return 1
  pid_alive "$NODE_PID" && return 1
  kill_orphans && ! listening && return 1
  listening
}

proxy_loop() {
  write_pid "$LOOP_PID" $$
  fails=0
  cooldown=0       # seconds to wait before retrying after a give-up
  while loop_is_me; do
    if [ $cooldown -gt 0 ]; then
      log "Prime Video: retrying in $(( cooldown / 60 )) minutes"
      sleep $cooldown
      loop_is_me || break
      cooldown=0
      fails=0
      d=$(prime_dir) && prime_route "$d"
      log "Prime Video: proxy restarting after cooldown"
    fi
    if port_taken_by_other; then
      log "Prime Video: port $PROXY_PORT is used by another program; change PROXY_PORT in config"
      d=$(prime_dir) && prime_unroute "$d"
      rm -f "$LOOP_PID"; exit 1
    fi
    if ! listening; then
      t0=$(date +%s)
      rotate "$PLOG"
      # Started in the background so its process id is recorded at once: a stop right
      # after a (re)start always finds it
      # Trust the TV's list of certificate authorities on top of Node.js's own
      # (Node.js 8 logs a harmless "Ignoring extra certs" warning for the overlap)
      ca=""; [ -r "$TV_CA" ] && ca=$TV_CA
      NODE_EXTRA_CA_CERTS=$ca PROXY_PORT=$PROXY_PORT REMOVE_REMOTE=$REMOVE_REMOTE \
        node "$DIR/pvproxy.js" >> "$PLOG" 2>&1 </dev/null &
      write_pid "$NODE_PID" $!
      wait $!
      code=$?
      rm -f "$NODE_PID"
      loop_is_me || break
      if [ $code = 3 ]; then
        # The proxy couldn't verify Amazon's certificates: unroute and retry after a cooldown
        log "Prime Video: Amazon's certificates could not be verified (see $PLOG); app set back to normal, retrying later"
        d=$(prime_dir) && prime_unroute "$d"
        cooldown=300; continue
      fi
      if port_taken_by_other; then
        log "Prime Video: port $PROXY_PORT is used by another program; change PROXY_PORT in config"
        d=$(prime_dir) && prime_unroute "$d"
        rm -f "$LOOP_PID"; exit 1
      fi
      if [ $(( $(date +%s) - t0 )) -lt 30 ]; then fails=$((fails + 1)); else fails=1; fi
      if [ $fails -ge 3 ]; then
        # The proxy keeps crashing quickly: unroute and retry after a cooldown
        log "Prime Video: the proxy keeps stopping (see $PLOG); app set back to normal, retrying later"
        d=$(prime_dir) && prime_unroute "$d"
        cooldown=300; continue
      fi
      log "Prime Video: proxy stopped; restarting"
    fi
    sleep 2
  done
}

proxy_start() {
  pid_alive "$LOOP_PID" && return 0
  nohup sh "$DIR/ctl.sh" run-proxy </dev/null >/dev/null 2>&1 &
}

proxy_stop() {
  p=$(pid_of "$LOOP_PID"); rm -f "$LOOP_PID"; [ -n "$p" ] && kill "$p" 2>/dev/null
  p=$(pid_of "$NODE_PID"); rm -f "$NODE_PID"; [ -n "$p" ] && kill "$p" 2>/dev/null
  kill_orphans >/dev/null   # anything we lost track of
}

# ---------------- Prime Video updates ----------------
# While an app is installed or updated, the TV announces each step on
# appInstallService/status, one line each, ending in "id":"<app>". When Prime Video
# starts updating, its covered settings file is uncovered at once, so the update can
# replace its files freely; when the update is done the cover goes back on.

upd_is_me() { [ "$(cut -d' ' -f1 "$UPD_PID" 2>/dev/null)" = "$$" ]; }

prime_uncover_for_update() {
  # Time matters here: the installer starts replacing files a few hundred ms after its
  # first announcement. The app's folder was looked up when the watcher started.
  d=${PRIME_DIR_CACHE:-$(prime_dir)}
  touch "$UPDATING"
  [ -n "$d" ] && prime_routed "$d" || return 0
  prime_unroute "$d"
  log "Prime Video is being updated: proxy setting removed until the update is done"
  # In case the TV never announces the end: a timer that sets it up again after 30 minutes
  nohup sh "$DIR/ctl.sh" update-fallback </dev/null >/dev/null 2>&1 &
}

update_events() {
  while read -r line; do
    case "$line" in *"\"id\":\"$APP_ID\""*) ;; *) continue ;; esac
    # Fast path, shell built-ins only: the first announcement of an install, update or
    # removal uncovers at once (unless it is already the end of a fresh install)
    if [ ! -f "$UPDATING" ]; then
      case "$line" in
        *'"state":"installed"'*) ;;
        *) prime_uncover_for_update; continue ;;
      esac
    fi
    upd_is_me || return 0
    state=$(echo "$line" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')
    simple=$(echo "$line" | sed -n 's/.*"simpleStatus":"\([^"]*\)".*/\1/p')
    [ "$simple" = remove ] && continue   # removed: nothing to put back
    case "$state" in
      installed|*fail*|*error*|*cancel*|*abort*)
        # Done (or stopped): put the cover back, in the background so no event is missed
        if [ -f "$UPDATING" ]; then
          log "Prime Video update finished ($state)"
          ( sleep 3; sh "$DIR/ctl.sh" prime-reapply ) </dev/null >/dev/null 2>&1 &
        elif [ "$state" = installed ]; then
          # Installed while it wasn't routed (for example a fresh install): route it
          ( sleep 3; sh "$DIR/ctl.sh" prime-reapply ) </dev/null >/dev/null 2>&1 &
        fi ;;
    esac
  done
}

update_watch() {
  write_pid "$UPD_PID" $$
  while upd_is_me; do
    PRIME_DIR_CACHE=$(prime_dir)
    luna-send -i luna://com.webos.appInstallService/status '{"subscribe":true}' </dev/null 2>/dev/null | update_events
    upd_is_me && sleep 5   # the install service restarted: listen again
  done
}

update_watch_start() {
  pid_alive "$UPD_PID" && return 0
  nohup sh "$DIR/ctl.sh" run-update-watch </dev/null >/dev/null 2>&1 &
}

update_watch_stop() {
  p=$(pid_of "$UPD_PID"); rm -f "$UPD_PID"
  if [ -n "$p" ]; then
    # Its listener first (a child of the watcher), then the watcher
    for d in /proc/[0-9]*; do
      [ "$(sed -n 's/^PPid:[[:space:]]*//p' "$d/status" 2>/dev/null)" = "$p" ] && kill "${d#/proc/}" 2>/dev/null
    done
    kill "$p" 2>/dev/null
  fi
  # Anything else of the watcher (its event reader), found by command line
  for d in /proc/[0-9]*; do
    case "$({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null)" in
      "sh $DIR/ctl.sh run-update-watch"*|"sh $DIR/ctl.sh update-fallback"*) kill "${d#/proc/}" 2>/dev/null ;;
    esac
  done
}

prime_start() {
  # $1 = seconds to wait for the app, the proxy and the app's jail folder
  wait=${1:-120}
  [ "$ENABLE_PRIME" = 1 ] || return 0
  if [ -z "$(node_bin)" ]; then log "Prime Video: Node.js not found, skipped"; return 0; fi
  if [ ! -f "$DIR/key.pem" ] || [ ! -f "$DIR/cert.pem" ]; then log "Prime Video: certificate missing, skipped"; return 0; fi
  # Also when Prime Video isn't installed yet: it is set up as soon as it is
  update_watch_start

  dir=""; n=0
  while [ -z "$dir" ] && [ $n -lt "$wait" ]; do dir=$(prime_dir) || { sleep 5; n=$((n + 5)); }; done
  if [ -z "$dir" ]; then log "Prime Video: app not installed, skipped"; return 0; fi
  if ! prime_supported "$dir"; then log "Prime Video: this app version does not support a proxy, skipped ($dir)"; return 0; fi

  proxy_start
  n=0
  while ! proxy_ready && [ $n -lt "$wait" ]; do
    sleep 2; n=$((n + 2))
    [ $n -ge 4 ] && ! pid_alive "$LOOP_PID" && break   # the proxy gave up (see the log)
  done
  if ! proxy_ready; then log "Prime Video: proxy did not start, app left untouched"; proxy_stop; return 0; fi

  # Already routed through this port: nothing to change (Prime Video is left open)
  if prime_routed "$dir" && grep -q "\"127.0.0.1:$PROXY_PORT\"" "$DIR/prime_config.json" 2>/dev/null; then
    return 0
  fi

  # Build the config from the app's current file, so an updated app or a new port is picked up
  prime_unroute "$dir"
  node "$DIR/primeconfig.js" "$dir/default_config.json" "$DIR/prime_config.json" "$PROXY_PORT" ||
    { log "Prime Video: could not build config"; proxy_stop; return 0; }

  close_prime            # Prime Video reads its settings when it opens
  mounted=0
  for t in $(prime_targets "$dir"); do
    case "$t" in /var/palm/jail/*)
      n=0
      while [ ! -f "$t" ] && [ $n -lt "$wait" ]; do sleep 2; n=$((n + 2)); done ;;
    esac
    [ -f "$t" ] || continue
    if mount --bind "$DIR/prime_config.json" "$t"; then mounted=$((mounted + 1)); fi
  done
  if [ $mounted -gt 0 ]; then SWITCHED=1; log "Prime Video: routed through the proxy ($dir)"
  else log "Prime Video: no config file to override, app left untouched ($dir)"; proxy_stop
  fi
}

prime_stop() {
  update_watch_stop
  rm -f "$UPDATING"
  dir=$(prime_dir)
  if [ -n "$dir" ] && prime_routed "$dir"; then
    SWITCHED=1
    prime_unroute "$dir"
    close_prime          # so it opens again with its normal settings
  fi
  proxy_stop
  log "Prime Video: proxy off"
}

# ---------------- on / off ----------------

# SWITCHED=1 when blocking actually changed, so apps are only closed when needed
do_start() {
  rotate
  if hosts_start; then
    SWITCHED=1
    [ "$RESTART_WAM" = 1 ] && restart_wam
  fi
  prime_start "${1:-30}"
}

do_stop() {
  prime_stop
  if hosts_stop; then
    SWITCHED=1
    [ "$RESTART_WAM" = 1 ] && restart_wam
  fi
}

after_switch() { [ "$SWITCHED" = 1 ] && close_recents; }

# ---------------- status ----------------

prime_state() {
  if [ "$ENABLE_PRIME" != 1 ]; then echo disabled; return; fi
  dir=$(prime_dir) || { echo missing; return; }
  prime_supported "$dir" || { echo unsupported; return; }
  if [ -f "$UPDATING" ] && pid_alive "$UPD_PID"; then echo updating
  elif proxy_ready && prime_routed "$dir"; then echo on
  elif pid_alive "$LOOP_PID"; then echo starting
  else echo off
  fi
}

hosts_state() {
  if hosts_active; then echo on
  elif [ "$ENABLE_HOSTS" != 1 ]; then echo disabled
  else echo off
  fi
}

ads_removed() { if [ -f "$PLOG" ]; then grep -c 'Remote ad break' "$PLOG"; else echo 0; fi; }

cmd_state() {
  echo "installed=1"
  echo "enabled=$ENABLED"
  echo "hosts=$(hosts_state)"
  echo "prime=$(prime_state)"
  echo "ad_breaks_removed=$(ads_removed)"
}

cmd_status() {
  echo "opentv-adblock  ($DIR)"
  echo "webOS:          $(cat /etc/starfish-release 2>/dev/null || echo unknown)"
  echo "Node.js:        $(node -v 2>/dev/null || echo 'not found')"
  echo "At boot:        $([ "$ENABLED" = 1 ] && echo 'turns on' || echo 'stays off')"
  echo
  case "$(hosts_state)" in
    on) echo "Google ad blocklist: ON  ($(grep -c '^0\.0\.0\.0' /etc/hosts) domains)" ;;
    disabled) echo "Google ad blocklist: OFF (disabled in config)" ;;
    *) echo "Google ad blocklist: OFF" ;;
  esac
  case "$(prime_state)" in
    on) echo "Prime Video proxy:   ON  (port $PROXY_PORT, ad breaks removed so far: $(ads_removed))" ;;
    starting) echo "Prime Video proxy:   starting" ;;
    updating) echo "Prime Video proxy:   paused while Prime Video updates (back on by itself)" ;;
    disabled) echo "Prime Video proxy:   OFF (disabled in config)" ;;
    missing) echo "Prime Video proxy:   app not installed" ;;
    unsupported) echo "Prime Video proxy:   not supported by this Prime Video version" ;;
    *) echo "Prime Video proxy:   OFF" ;;
  esac
}

# ---------------- commands ----------------

case "$1" in
  boot)
    # Runs in the background so the TV's start-up isn't held up
    nohup sh "$DIR/ctl.sh" boot-run </dev/null >/dev/null 2>&1 &
    ;;
  boot-run)
    lock
    # Left from before the reboot: the processes they name are gone
    for f in "$LOOP_PID" "$NODE_PID" "$UPD_PID"; do pid_alive "$f" || rm -f "$f"; done
    rm -f "$UPDATING"
    rotate
    if [ "$ENABLED" != 1 ]; then log "boot: turned off, nothing to do"; exit 0; fi
    log "boot"
    if hosts_start && [ "$RESTART_WAM" = 1 ]; then
      sleep "$WAM_DELAY"; restart_wam
    fi
    prime_start 120
    ;;
  on)
    lock
    set_conf ENABLED 1
    log "turned on"
    do_start 30
    after_switch
    cmd_status
    ;;
  off)
    lock
    set_conf ENABLED 0
    log "turned off"
    do_stop
    after_switch
    cmd_status
    ;;
  start)
    lock
    do_start 30
    after_switch
    cmd_status
    ;;
  stop)
    lock
    do_stop
    after_switch
    cmd_status
    ;;
  restart)
    lock
    do_stop
    do_start 30
    after_switch
    cmd_status
    ;;
  status) cmd_status ;;
  state) cmd_state ;;
  logs)
    echo "== $LOG"; tail -n 20 "$LOG" 2>/dev/null
    echo "== $PLOG"; tail -n 30 "$PLOG" 2>/dev/null
    ;;
  run-proxy) proxy_loop ;;
  run-update-watch) update_watch ;;
  update-fallback)
    # Checks once a minute; ends as soon as the update reports back or blocking is off
    n=0
    while [ $n -lt 30 ]; do
      sleep "${UPD_FALLBACK_STEP:-60}"
      [ -f "$UPDATING" ] && pid_alive "$UPD_PID" || exit 0
      n=$((n + 1))
    done
    log "Prime Video update didn't report back in 30 minutes: setting it up again"
    exec sh "$DIR/ctl.sh" prime-reapply
    ;;
  prime-reapply)
    # After a Prime Video update (from the update watcher): cover it again
    lock
    rm -f "$UPDATING"
    if [ "$ENABLED" = 1 ] && [ "$ENABLE_PRIME" = 1 ] && pid_alive "$UPD_PID"; then
      prime_start 60
    fi
    ;;
  *)
    echo "usage: $0 {on|off|start|stop|restart|status|state|logs}"
    exit 1
    ;;
esac
