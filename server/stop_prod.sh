#!/usr/bin/env bash
# anmika-mahjong 本番停止 [start_prod.sh と対]
set -euo pipefail
cd "$(dirname "$0")/.."

for name in api static ws; do
  pidfile="server/run/$name.pid"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "$name: stopped (pid $pid)"
    else
      echo "$name: not running"
    fi
    rm -f "$pidfile"
  else
    echo "$name: no pidfile"
  fi
done
