#!/bin/bash
# Unattended-run guard for the Studio benchmark. Ollama 0.33.3's scheduler wedged twice on 10-05 (after a
# num_ctx change / a GPU OOM): every request hung until the server was restarted. If a benchmark is running
# and NO result has been written for 20 min (the per-request timeout is 15), probe Ollama with a tiny model;
# if the probe also hangs, restart Ollama the same way the Studio's own LCIA watchdog does, and log it.
cd "$(dirname "$0")"
while true; do
  sleep 120
  pgrep -f "run_bench.py|throughput.py|serving.py" >/dev/null || continue
  newest=$(ls -t out/*.jsonl 2>/dev/null | head -1); [ -z "$newest" ] && continue
  age=$(( $(date +%s) - $(stat -f %m "$newest") ))
  [ "$age" -lt 1200 ] && continue
  if ! curl -s -m 90 localhost:11434/api/generate -d '{"model":"qwen2.5:0.5b-instruct","prompt":"hi","stream":false,"options":{"num_predict":2}}' | grep -q response; then
    echo "$(date -u +%FT%TZ) WEDGED: no result for ${age}s and the probe hung -> restarting Ollama" >> out/watchdog.log
    killall Ollama 2>/dev/null; killall ollama 2>/dev/null; sleep 4; pkill -f "Ollama.app/Contents/Resources/llama-server"; sleep 2
    open -a Ollama; sleep 30
  fi
done
