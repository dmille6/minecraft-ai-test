#!/bin/bash
# Co-load re-test after the Studio was cleared of co-tenants (owner, 10-06 ~17:00Z): the recommended pair resident
# together under an 8-bot load, 20 min each. Run while the GPU is reserved (no other benchmark running).
set -u
cd "$(dirname "$0")"
L=~/.lmstudio/bin/lms; O=/Applications/Ollama.app/Contents/Resources/ollama
echo "=== $(date -u +%FT%TZ) co-load A: gemma4 MLX 8-bit on LM Studio + gpt-oss:120b (medium) on Ollama" | tee -a out/driver.log
$L server start --port 1234 >> out/coload.log 2>&1; $L unload --all >> out/coload.log 2>&1
$L load gemma-4-26b-a4b-it@8bit -y --context-length 16384 --parallel 8 --identifier bench >> out/coload.log 2>&1
python3 serving.py --engine openai --worker bench --worker-think false --overseer gpt-oss:120b --overseer-think medium \
  --overseer-engine ollama --escalate-every 180 --bots 8 --minutes 20 --label coload-gemma4mlx8+gptoss-med >> out/coload.log 2>&1
$L unload --all >> out/coload.log 2>&1; $L server stop >> out/coload.log 2>&1; $O stop gpt-oss:120b
echo "=== $(date -u +%FT%TZ) co-load B: gemma4:26b + gpt-oss:120b (medium), both on Ollama" | tee -a out/driver.log
python3 serving.py --worker gemma4:26b --worker-think false --overseer gpt-oss:120b --overseer-think medium \
  --escalate-every 180 --bots 8 --minutes 20 --label coload-gemma4+gptoss-med-clean >> out/coload.log 2>&1
$O stop gemma4:26b; $O stop gpt-oss:120b
echo "=== $(date -u +%FT%TZ) co-load done" | tee -a out/driver.log
