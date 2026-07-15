#!/usr/bin/env bash
# anmika-mahjong 本番起動 [2026-07-15 yuma]
#
# cloudflared ingress (anmika.magiccatlab.com) 前提の3プロセス構成:
#   :8790  uvicorn server.app:app   … /api /auth (+static も配れる)
#   :8080  uvicorn server.app:app   … ingress default 経路の静的 SPA
#   :8791  node ws_server.ts        … /ws/* ゲーム state authority
#
# 使い方:
#   server/start_prod.sh          # 起動 (既に起動済みの proc はスキップ)
#   server/stop_prod.sh           # 停止
#
# Discord OAuth を有効にする場合は server/.secrets.env に
# DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET を追記して再起動する。
set -euo pipefail
cd "$(dirname "$0")/.."

PY=server/.venv/bin/python
if [ ! -x "$PY" ]; then
  echo "server/.venv がない。先に: python3 -m venv server/.venv && server/.venv/bin/pip install -r server/requirements.txt" >&2
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo "dist/ がない。先に: npm run build" >&2
  exit 1
fi

SECRETS_FILE="server/.secrets.env"
if [ ! -f "$SECRETS_FILE" ]; then
  umask 077
  {
    echo "ANMIKA_SESSION_SECRET=$("$PY" -c 'import secrets; print(secrets.token_hex(32))')"
    echo "ANMIKA_WS_SECRET=$("$PY" -c 'import secrets; print(secrets.token_hex(32))')"
  } > "$SECRETS_FILE"
  echo "generated $SECRETS_FILE (session/ws secrets)"
fi
set -a
# shellcheck disable=SC1090
. "$SECRETS_FILE"
set +a

mkdir -p server/logs server/run server/data

start_one() {
  local name="$1"
  shift
  local pidfile="server/run/$name.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "$name: already running (pid $(cat "$pidfile"))"
    return 0
  fi
  nohup "$@" > "server/logs/$name.log" 2>&1 &
  echo $! > "$pidfile"
  echo "$name: started (pid $(cat "$pidfile"))"
}

start_one api "$PY" -m uvicorn server.app:app --host 127.0.0.1 --port 8790
start_one static "$PY" -m uvicorn server.app:app --host 127.0.0.1 --port 8080
start_one ws node --import tsx server/ws_server.ts

sleep 2
for port in 8790 8080 8791; do
  if "$PY" - "$port" <<'EOF'
import socket, sys
s = socket.socket()
s.settimeout(2)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
    print(f"port {sys.argv[1]}: listening")
except Exception as e:
    print(f"port {sys.argv[1]}: NOT listening ({e})")
    sys.exit(1)
finally:
    s.close()
EOF
  then :; else
    echo "起動失敗。server/logs/*.log を確認" >&2
    exit 1
  fi
done
echo "all up"
