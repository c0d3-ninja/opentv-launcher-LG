#!/bin/sh
# Run this ON YOUR COMPUTER (Mac or Linux), from anywhere inside the
# opentv-launcher-LG folder:
#     sh install/serve.sh
#
# It shares this folder on your local network and prints the one line to
# paste into the TV's root shell. The TV downloads everything from your
# computer, so the TV itself never needs the internet.

PORT="${1:-8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "=============================================="
echo "      OpenTV Launcher for LG: share to TV"
echo "=============================================="
echo ""

# Checks
if [ ! -f "$ROOT/dist/latest.txt" ] || [ ! -f "$ROOT/dist/$(cat "$ROOT/dist/latest.txt" 2>/dev/null)" ]; then
  echo "  [FAIL] No IPK found in $ROOT/dist"
  echo "         Run: sh build-ipk.sh"
  exit 1
fi
echo "  [ OK ] IPK found: dist/$(cat "$ROOT/dist/latest.txt")"

PY=""
command -v python3 >/dev/null 2>&1 && PY=python3
[ -z "$PY" ] && command -v python >/dev/null 2>&1 && PY=python
if [ -z "$PY" ]; then
  echo "  [FAIL] Python 3 is needed to share files. Install it and run this again."
  exit 1
fi
echo "  [ OK ] Python found ($PY)"

# This computer's IP address on the local network
IP=""
if command -v ipconfig >/dev/null 2>&1; then               # macOS
  for i in en0 en1 en2 en3 en4 en5; do
    IP=$(ipconfig getifaddr "$i" 2>/dev/null) && [ -n "$IP" ] && break
  done
fi
if [ -z "$IP" ] && command -v hostname >/dev/null 2>&1; then  # Linux
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$IP" ]; then
  printf "  Couldn't find this computer's IP address. Type it (example 192.168.1.4): "
  read -r IP
fi
echo "  [ OK ] This computer's IP address: $IP"

if (command -v lsof >/dev/null 2>&1 && lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1); then
  echo "  [FAIL] Port $PORT is already in use. Try: sh install/serve.sh 8080"
  exit 1
fi

cat <<EOF

----------------------------------------------
  Now, on the TV's root shell (telnet or SSH),
  paste ONE of these lines:

  To INSTALL:
    curl -fsS http://$IP:$PORT/install/install.sh | sh -s $IP $PORT

  To UNINSTALL:
    curl -fsS http://$IP:$PORT/install/uninstall.sh | sh
----------------------------------------------

  Keep this window open until the TV says "Done".
  Press Ctrl+C here to stop sharing afterwards.
  (If your computer asks to allow incoming connections, click Allow.)

EOF

cd "$ROOT" && exec "$PY" -m http.server "$PORT" --bind 0.0.0.0
