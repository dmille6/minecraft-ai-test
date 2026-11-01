#!/bin/bash
# servea-llama.sh -- serving option A (OWNER 11-01): run llama.cpp llama-server for the fleet, stoppable cleanly.
#
#   servea-llama.sh start <model.gguf> <alias> [np] [ctx_per_slot]   start (supervised: restarts a crash, max 5 / 10 min)
#   servea-llama.sh stop                                            stop the supervisor and the server, wait for exit
#   servea-llama.sh status                                          pid, alias, /health, slots busy, VRAM
#
# User space only. Paths come from the environment (defaults = the 3090's ~/batchtest layout):
#   SERVEA_HOME (~/batchtest/servea: pid files + logs), LLAMA_DIR (the b12020 binaries), LLAMA_LIBS (extra
#   LD_LIBRARY_PATH: cudart + libgomp), SERVEA_PORT (18080), SERVEA_HOST (0.0.0.0).
# Flags are the batching report's (docs/reports/batching-3090-2026-10-31.md s.5): -np 8 --no-kv-unified, 6144 per
# slot, flash attention, --jinja, --reasoning off (qwen3.5 must not think), prompt cache on (the default).
# Not a systemd --user unit on purpose: the 3090 has no linger, so a user unit would die with the last ssh session.
set -u
H=${SERVEA_HOME:-$HOME/batchtest/servea}
D=${LLAMA_DIR:-$HOME/batchtest/llama-b12020/llama-b12020}
L=${LLAMA_LIBS:-$HOME/batchtest/cudart/cudart-llama-b12020-bin-ubuntu-cuda-12.8-x64:$HOME/batchtest/lib}
PORT=${SERVEA_PORT:-18080}
BIND=${SERVEA_HOST:-0.0.0.0}
mkdir -p "$H/logs"
alive () { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

case "${1:-}" in
start)
  G=${2:?model.gguf}; A=${3:?alias}; NP=${4:-8}; CPS=${5:-6144}
  [ -f "$G" ] || { echo "no such model: $G"; exit 2; }
  if alive "$H/supervisor.pid"; then echo "already running ($(cat "$H/alias")); stop first"; exit 1; fi
  rm -f "$H/stop"; echo "$A" > "$H/alias"
  # The supervisor: one server at a time; a crash is restarted after 5 s, but 5 crashes in 10 min gives up (a
  # crash loop on a shared GPU is worse than a dead endpoint: the bots' pool fails over to the next endpoint).
  setsid nohup bash -c '
    H='"$H"'; D='"$D"'; export LD_LIBRARY_PATH='"$L"':'"$D"'
    starts=()
    while [ ! -f "$H/stop" ]; do
      now=$(date +%s); starts+=("$now"); recent=0
      for s in "${starts[@]}"; do [ $((now - s)) -lt 600 ] && recent=$((recent + 1)); done
      if [ "$recent" -gt 5 ]; then echo "$(date -u +%FT%TZ) GIVING UP: >5 starts in 10 min" >> "$H/logs/supervisor.log"; break; fi
      echo "$(date -u +%FT%TZ) start '"$A"' np='"$NP"' ctx='"$((NP * CPS))"'" >> "$H/logs/supervisor.log"
      "$D/llama-server" -m '"$G"' --alias '"$A"' -ngl 99 -fa on -np '"$NP"' -c '"$((NP * CPS))"' --no-kv-unified \
        --jinja --reasoning off --no-webui --metrics --host '"$BIND"' --port '"$PORT"' \
        >> "$H/logs/'"$A"'.log" 2>&1 &
      echo $! > "$H/server.pid"; wait $!
      echo "$(date -u +%FT%TZ) server exited rc=$?" >> "$H/logs/supervisor.log"
      [ -f "$H/stop" ] || sleep 5
    done
    rm -f "$H/server.pid" "$H/supervisor.pid"' > /dev/null 2>&1 &
  echo $! > "$H/supervisor.pid"
  for i in $(seq 1 180); do
    curl -sf "localhost:$PORT/health" > /dev/null && { echo "READY $A on :$PORT (server $(cat "$H/server.pid"))"; exit 0; }
    alive "$H/supervisor.pid" || break; sleep 1
  done
  echo "NOT READY after ${i}s"; tail -20 "$H/logs/$A.log"; exit 1 ;;
stop)
  touch "$H/stop"
  alive "$H/server.pid" && kill "$(cat "$H/server.pid")"
  for i in $(seq 1 30); do alive "$H/server.pid" || alive "$H/supervisor.pid" || break; sleep 1; done
  if alive "$H/server.pid"; then kill -9 "$(cat "$H/server.pid")"; fi
  if alive "$H/supervisor.pid"; then kill "$(cat "$H/supervisor.pid")"; fi
  rm -f "$H/server.pid" "$H/supervisor.pid"
  curl -sf "localhost:$PORT/health" > /dev/null && { echo "STILL ANSWERING on :$PORT"; exit 1; }
  echo "STOPPED" ;;
status)
  if alive "$H/server.pid"; then echo "server $(cat "$H/server.pid") alias $(cat "$H/alias" 2>/dev/null)"; else echo "server not running"; fi
  alive "$H/supervisor.pid" && echo "supervisor $(cat "$H/supervisor.pid")"
  echo "health: $(curl -s -m 3 "localhost:$PORT/health" || echo none)"
  curl -s -m 3 "localhost:$PORT/slots" 2>/dev/null | python3 -c 'import json,sys; s=json.load(sys.stdin); print("slots busy", sum(1 for x in s if x.get("is_processing")), "of", len(s))' 2>/dev/null
  nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader 2>/dev/null ;;
*) sed -n '2,8p' "$0"; exit 2 ;;
esac
