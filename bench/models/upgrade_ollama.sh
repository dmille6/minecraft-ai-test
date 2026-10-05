#!/bin/bash
# Owner-approved (10-05 ~17:30Z) Ollama app upgrade on the Studio, BETWEEN benchmark runs. Reversible: the old app
# bundle is kept in ~/mbench/upgrade/Ollama-<old>.app (to roll back: quit Ollama, move it back, open -a Ollama).
#   upgrade_ollama.sh ~/mbench/upgrade/Ollama-darwin-0.35.1.zip
set -u
ZIP=${1:?zip}
cd ~/mbench
# between models: the queue's last driver line says "done" (the next model waits on out/GPU_RESERVED before it
# prints its start line) and nothing is running
until tail -1 out/driver.log | grep -q " done$" && ! pgrep -f "run_bench.py|throughput.py|serving.py|lms_factor.sh" >/dev/null; do sleep 20; done
OLD=$(curl -s -m 10 localhost:11434/api/version | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])" 2>/dev/null || echo unknown)
echo "$(date -u +%FT%TZ) upgrade: before=$OLD" | tee -a out/upgrade.log
killall Ollama 2>/dev/null; killall ollama 2>/dev/null; sleep 4; pkill -f "Ollama.app/Contents/Resources/llama-server"; sleep 2
[ -e ~/mbench/upgrade/Ollama-$OLD.app ] || mv /Applications/Ollama.app ~/mbench/upgrade/Ollama-$OLD.app
rm -rf /Applications/Ollama.app
unzip -q "$ZIP" -d /Applications/ || { echo "unzip failed: rolling back"; mv ~/mbench/upgrade/Ollama-$OLD.app /Applications/Ollama.app; open -a Ollama; exit 2; }
open -a Ollama
for i in $(seq 1 60); do curl -s -m 5 localhost:11434/api/version >/dev/null && break; sleep 2; done
NEW=$(curl -s -m 10 localhost:11434/api/version | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])" 2>/dev/null || echo DOWN)
echo "$(date -u +%FT%TZ) upgrade: after=$NEW; launchctl OLLAMA_NUM_PARALLEL=$(launchctl getenv OLLAMA_NUM_PARALLEL) OLLAMA_KEEP_ALIVE=$(launchctl getenv OLLAMA_KEEP_ALIVE)" | tee -a out/upgrade.log
grep -a -o "OLLAMA_NUM_PARALLEL:[^ ]*\|OLLAMA_KEEP_ALIVE:[^ ]*\|OLLAMA_CONTEXT_LENGTH:[^ ]*" ~/.ollama/logs/server.log | tail -3 | tee -a out/upgrade.log
# co-tenants still work? the LCIA keep-warm pins qwen2.5-coder:7b; the fleet analyst calls qwen3.8:27b
sh ~/llmcache/ollama-watchdog.sh; sleep 2
/Applications/Ollama.app/Contents/Resources/ollama ps | tee -a out/upgrade.log
curl -s -m 300 localhost:11434/api/chat -d '{"model":"qwen3.8:27b","messages":[{"role":"user","content":"Reply with OK."}],"stream":false,"think":false,"options":{"num_predict":5}}' | python3 -c "import json,sys;d=json.load(sys.stdin);print('analyst-model check:', repr(d.get('message',{}).get('content')))" | tee -a out/upgrade.log
/Applications/Ollama.app/Contents/Resources/ollama stop qwen3.8:27b 2>/dev/null
echo "$(date -u +%FT%TZ) upgrade done" | tee -a out/upgrade.log
