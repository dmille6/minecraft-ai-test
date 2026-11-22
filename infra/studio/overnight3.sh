#!/bin/bash
# Replaces overnight2's second half: wait for the running Qwen judge on replay-5000, stop its server,
# then gpt-oss with a 1500-token limit on replay-1000 (retries unparsed rows only).
export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH
cd ~/mcai
JP=$1; SP=$2
while kill -0 $JP 2>/dev/null; do sleep 60; done
kill $SP; sleep 15
mlx_lm.server --model models/gpt-oss-120b-4bit --host 127.0.0.1 --port 8091 > logs/server3-gptoss.log 2>&1 & S2=$!
for i in $(seq 1 120); do curl -s -m 3 localhost:8091/v1/models >/dev/null && break; sleep 10; done
JUDGE_MAX_TOKENS=1500 /usr/bin/python3 judge.py http://127.0.0.1:8091 models/gpt-oss-120b-4bit replay-1000.jsonl labels-gptoss120b.jsonl '{"reasoning_effort":"low"}' >> logs/judge3-gptoss.log 2>&1
kill $S2
echo "$(date -u +%FT%TZ) overnight3 done"
