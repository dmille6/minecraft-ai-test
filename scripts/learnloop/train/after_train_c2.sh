#!/bin/bash
# chained after `run_c2.sh train`: export -> create -> eval Ollama config (NUM_PARALLEL 2) -> template checks
set -u
T=$HOME/learnloop-train; cd $T
until [ -f runs/c2-01/metrics.json ] && grep -q "saved .*merged-16bit" runs-c2-01.log 2>/dev/null; do
  pgrep -f "train_sft.py --base" >/dev/null || { [ -f runs/c2-01/metrics.json ] || { echo "$(date -u +%FT%TZ) TRAINING ENDED WITHOUT metrics.json"; exit 3; }; }
  sleep 60; done
echo "$(date -u +%FT%TZ) training done: $(python3 -c "import json;m=json.load(open(\"runs/c2-01/metrics.json\"));print(m[\"verdict\"],m[\"tokens_per_s_timed\"],m[\"loss_first5\"],m[\"loss_last5\"])")"
grep -q "^OK" <(python3 -c "import json;print(json.load(open(\"runs/c2-01/metrics.json\"))[\"verdict\"])") || { echo "verdict not OK"; exit 3; }
bash run_c2.sh export > c2/export.log 2>&1 || { echo "export FAILED"; tail -5 c2/export.log; exit 4; }
echo "$(date -u +%FT%TZ) exported: $(cat runs/c2-01/cand-qwen35-9b-c2-bf16.gguf.sha256)"
bash run_c2.sh create 2>&1 | tr "\r" "\n" | grep -E "success|error|REFUSED|cand-|baseconv" | tail -6
sudo -n sed -i "s/OLLAMA_NUM_PARALLEL=1/OLLAMA_NUM_PARALLEL=2/" /etc/systemd/system/ollama.service.d/override.conf && sudo -n systemctl daemon-reload && sudo -n systemctl restart ollama; sleep 3
echo "$(date -u +%FT%TZ) ollama NUM_PARALLEL=$(grep -o "NUM_PARALLEL=[0-9]*" /etc/systemd/system/ollama.service.d/override.conf)"
SERVED_THINK=false bash run_c2.sh template-check > c2/template-check.log 2>&1 && echo "template-check PASS" || { echo "template-check FAILED"; tail -20 c2/template-check.log; exit 5; }
echo "$(date -u +%FT%TZ) AFTER-TRAIN DONE"
