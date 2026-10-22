#!/bin/bash
# run.sh <phase> -- learning loop M3 on the 3090 VM (VM 200 ollama-3090, 10.0.0.16), one phase at a time.
# Procedure and the owner-approved steps: docs/reports/learnloop-m1-m3-2026-10-22.md section "3090 training VM".
#
#   bash run.sh preflight        read-only: GPU, free VRAM, Ollama state, venv, base weights, data present
#   bash run.sh stop-ollama      OWNER-APPROVED STEP: stop + disable ollama.service so nothing can load a model
#   bash run.sh fit              50 optimizer steps at seq 3,072: peak VRAM, tok/s, grad-norm (writes runs/fit-01)
#   bash run.sh train            the dry round: 200 steps x grad-accum 10 = the 2,000-example subset, one epoch
#   bash run.sh export           merged 16-bit -> GGUF bf16 (llama.cpp convert) -> Ollama q4_K_M + bf16 models
#   bash run.sh start-ollama     OWNER-APPROVED STEP: start ollama with OLLAMA_NUM_PARALLEL=2 for the evaluation
#   bash run.sh restore-ollama   put ollama.service back exactly as it was (the saved override), and start it
#
# Every phase that touches the GPU refuses unless (a) DROP16_VERIFIED=<the +24 h drop16.sh --verify timestamp> is set
# by the operator and (b) no Ollama model is resident. Nothing here contacts 10.0.0.72 or any bot.
set -u
T=$HOME/learnloop-train
PY=$T/venv/bin/python
export HF_HOME=$T/hf
DATA=${DATA:-$T/data}
RUN=${RUN:-dry-01}
CAND=${CAND:-cand-qwen3-8b-v0-dry}
OVR=/etc/systemd/system/ollama.service.d/override.conf
say() { echo "== $*"; }
die() { echo "REFUSED: $*"; exit 2; }
gpu_guard() {
  [ -n "${DROP16_VERIFIED:-}" ] || die "set DROP16_VERIFIED=<ISO time of the +24 h drop16.sh --verify OK> -- no training while a bot can reach .16"
  local ps; ps=$(curl -s -m 5 http://127.0.0.1:11434/api/ps || echo STOPPED)
  case "$ps" in STOPPED|'{"models":[]}') ;; *) die "Ollama holds a model: $ps";; esac
}
case "${1:-}" in
  preflight)
    say "GPU"; nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader
    nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader
    say "ollama"; systemctl is-active ollama; curl -s -m 5 http://127.0.0.1:11434/api/ps; echo
    sudo -n cat "$OVR" 2>/dev/null | grep -E 'NUM_PARALLEL|MAX_LOADED|KEEP_ALIVE|CONTEXT'
    say "venv"; $PY -c "import torch, unsloth, trl, transformers, peft; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), 'free GiB %.1f' % (torch.cuda.mem_get_info()[0] / 2**30)); print('unsloth', unsloth.__version__, 'trl', trl.__version__, 'transformers', transformers.__version__, 'peft', peft.__version__)" 2>&1 | grep -v -E 'Warning|W10|patch'
    say "base weights"; du -sh "$HF_HOME"/hub/models--unsloth--Qwen3-8B 2>/dev/null || echo "MISSING: unsloth/Qwen3-8B"
    say "data"; ls -la "$DATA"/m3-train-2000.jsonl "$DATA"/m3-eval.jsonl "$DATA"/MANIFEST.json 2>&1
    say "disk"; df -h "$T" | tail -1
    ;;
  stop-ollama)
    sudo -n mkdir -p "$T/saved" && sudo -n cp -p "$OVR" "$T/saved/override.conf.$(date -u +%Y%m%dT%H%M%SZ)" || die "cannot save $OVR"
    sudo -n systemctl stop ollama && sudo -n systemctl disable ollama 2>/dev/null
    sleep 3; systemctl is-active ollama; nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader
    ;;
  fit)
    gpu_guard
    $PY "$T/train_sft.py" --data "$DATA/m3-train-2000.jsonl" --out "$T/runs/fit-01" --fit-test-only --i-checked-m2b 2>&1 | tee "$T/runs-fit-01.log"
    ;;
  train)
    gpu_guard
    [ -f "$T/runs/fit-01/metrics.json" ] || die "run the fit test first"
    nice -n 5 $PY "$T/train_sft.py" --data "$DATA/m3-train-2000.jsonl" --out "$T/runs/$RUN" --max-steps 200 --grad-accum 10 --i-checked-m2b 2>&1 | tee "$T/runs-$RUN.log"
    ;;
  export)
    M=$T/runs/$RUN/merged-16bit
    [ -d "$M" ] || die "no merged model at $M"
    [ -d "$T/llama.cpp" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$T/llama.cpp" || die "llama.cpp clone failed"
    say "convert to GGUF bf16"
    PYTHONPATH=$T/llama.cpp/gguf-py $PY "$T/llama.cpp/convert_hf_to_gguf.py" "$M" --outtype bf16 --outfile "$T/runs/$RUN/$CAND-bf16.gguf" || die "convert failed"
    # THE NO-THINK TEMPLATE: exactly the training render (apply_chat_template(..., enable_thinking=False)), so the served
    # prompt equals the trained one. The base Qwen3-8B is served with the SAME template for the comparison.
    cat > "$T/runs/$RUN/template.txt" <<'TPL'
{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{- range .Messages }}{{- if eq .Role "user" }}<|im_start|>user
{{ .Content }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ .Content }}<|im_end|>
{{ end }}{{- end }}<|im_start|>assistant
<think>

</think>

TPL
    for v in bf16 q4; do
      { echo "FROM $T/runs/$RUN/$CAND-bf16.gguf"; echo 'TEMPLATE """'"$(cat "$T/runs/$RUN/template.txt")"'"""'; echo 'PARAMETER stop "<|im_end|>"'; } > "$T/runs/$RUN/Modelfile.$v"
    done
    { echo "FROM qwen3:8b"; echo 'TEMPLATE """'"$(cat "$T/runs/$RUN/template.txt")"'"""'; echo 'PARAMETER stop "<|im_end|>"'; } > "$T/runs/$RUN/Modelfile.base-nothink"
    echo "Modelfiles written. With ollama running (start-ollama):"
    echo "  ollama create $CAND-bf16 -f $T/runs/$RUN/Modelfile.bf16"
    echo "  ollama create $CAND -q q4_K_M -f $T/runs/$RUN/Modelfile.q4"
    echo "  ollama pull qwen3:8b && ollama create qwen3-8b-nothink -f $T/runs/$RUN/Modelfile.base-nothink"
    sha256sum "$T/runs/$RUN/$CAND-bf16.gguf" | tee "$T/runs/$RUN/gguf.sha256"
    ;;
  start-ollama)
    [ -f "$OVR" ] || die "no $OVR"
    sudo -n cp -p "$OVR" "$OVR.learnloop-eval-bak" || die "backup failed"
    sudo -n sed -i -e 's/OLLAMA_NUM_PARALLEL=16/OLLAMA_NUM_PARALLEL=2/' "$OVR"
    sudo -n systemctl daemon-reload && sudo -n systemctl start ollama; sleep 3; systemctl is-active ollama
    ;;
  restore-ollama)
    S=$(ls -1 "$T"/saved/override.conf.* 2>/dev/null | head -1)
    [ -n "$S" ] || die "no saved override in $T/saved"
    sudo -n cp -p "$S" "$OVR" && sudo -n systemctl daemon-reload && sudo -n systemctl enable ollama && sudo -n systemctl restart ollama
    sleep 3; systemctl is-active ollama; sudo -n diff "$S" "$OVR" && echo "override restored byte-equal to $S"
    ;;
  *) sed -n 2,14p "$0"; exit 2;;
esac
