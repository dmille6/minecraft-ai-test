#!/bin/bash
# Overnight judge run on the Studio: wait for downloads, then label the replay set with two judges, one at a time.
export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH
cd ~/mcai
while ! grep -q "done mlx-community/gpt-oss-120b-4bit" logs/download.log; do grep -q FAIL logs/download.log && { echo "download failed"; exit 1; }; sleep 60; done
run () {  # model_dir port label extra_json
  mlx_lm.server --model "models/$1" --host 127.0.0.1 --port $2 > logs/server-$3.log 2>&1 & SP=$!
  for i in $(seq 1 120); do curl -s -m 3 localhost:$2/v1/models >/dev/null && break; sleep 10; done
  /usr/bin/python3 judge.py http://127.0.0.1:$2 "models/$1" replay-1000.jsonl labels-$3.jsonl "$4" >> logs/judge-$3.log 2>&1
  kill $SP; wait $SP 2>/dev/null; sleep 10
}
run Qwen3.5-122B-A10B-4bit 8090 qwen122b '{"chat_template_kwargs":{"enable_thinking":false}}'
run gpt-oss-120b-4bit 8091 gptoss120b '{"reasoning_effort":"low"}'
echo "$(date -u +%FT%TZ) overnight done"
