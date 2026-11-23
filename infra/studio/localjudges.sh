#!/bin/bash
# After overnight3: score every local judge candidate on the 300-decision pilot with rubric v3 (blind), one model at a time.
export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH
cd ~/mcai
while ! grep -q "overnight3 done" logs/overnight3.log 2>/dev/null; do sleep 60; done
run () {  # dir port tag extra
  mlx_lm.server --model "models/$1" --host 127.0.0.1 --port $2 > logs/lj-server-$3.log 2>&1 & SP=$!
  for i in $(seq 1 120); do curl -s -m 3 localhost:$2/v1/models >/dev/null && break; sleep 10; done
  JUDGE_MAX_TOKENS=${5:-800} /usr/bin/python3 judge_v3.py http://127.0.0.1:$2 "models/$1" pilot300-v3.jsonl lj-$3.jsonl "$4" >> logs/lj-$3.log 2>&1
  kill $SP; wait $SP 2>/dev/null; sleep 10
}
run Qwen3.5-122B-A10B-4bit 8090 qwen122b '{"chat_template_kwargs":{"enable_thinking":false}}'
run Qwen3.8-27B-8bit 8092 qwen38-27b '{"chat_template_kwargs":{"enable_thinking":false}}'
run Muse-Glimmer-30B-4bit 8093 muse30b '{}'
run gpt-oss-120b-4bit 8091 gptoss120b '{"reasoning_effort":"low"}' 1500
run Qwen3.8-27B-8bit 8092 qwen38-27b-think '{"chat_template_kwargs":{"enable_thinking":true}}' 3000
echo "$(date -u +%FT%TZ) localjudges done"
