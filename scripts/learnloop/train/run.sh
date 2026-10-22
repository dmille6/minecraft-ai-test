#!/bin/bash
# run.sh <phase> -- learning loop M3 on the 3090 VM (VM 200 ollama-3090, 10.0.0.16), one phase at a time.
# Procedure and the owner-approved steps: docs/reports/learnloop-m1-m3-2026-10-22.md section "3090 training VM".
#
#   bash run.sh preflight        read-only: GPU, free VRAM, Ollama state, venv, base weights, data present
#   bash run.sh stop-ollama      OWNER-APPROVED STEP: stop + disable ollama.service so nothing can load a model
#   bash run.sh fit              50 optimizer steps at seq 3,072: peak VRAM, tok/s, grad-norm (writes runs/fit-01)
#   bash run.sh train            the dry round: 200 steps x grad-accum 10 = the 2,000-example subset, one epoch
#   bash run.sh export           merged 16-bit -> GGUF bf16 (llama.cpp convert) -> Modelfiles for Ollama q4_K_M + bf16
#   bash run.sh template-check   served prompt == trained prompt, token for token (needs ollama running + models created)
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
  # ANY OTHER GPU PROCESS (Claude r4 P3): on 10-22 a llama-server that is not ours (~/ethan-gpu, 6 GB) was resident.
  # A VRAM figure measured beside it must say so: refuse unless the owner's decision is named in ALLOW_OTHER_GPU.
  local other; other=$(nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>&1) \
    || die "nvidia-smi failed ($other) -- an unreadable GPU is not an empty one (Claude r5 P3)"
  if [ -n "$other" ]; then
    echo "  other GPU processes: $other"
    [ -n "${ALLOW_OTHER_GPU:-}" ] || die "another process holds GPU memory (above): stop it, or set ALLOW_OTHER_GPU=<owner decision> to train beside it"
    echo "  ALLOW_OTHER_GPU=$ALLOW_OTHER_GPU (recorded in the run log)"
  fi
}
case "${1:-}" in
  preflight)
    say "GPU"; nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader
    nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader
    say "ollama"; systemctl is-active ollama; curl -s -m 5 http://127.0.0.1:11434/api/ps; echo
    sudo -n cat "$OVR" 2>/dev/null | grep -E 'NUM_PARALLEL|MAX_LOADED|KEEP_ALIVE|CONTEXT'
    say "venv"; $PY -c "import torch, unsloth, trl, transformers, peft; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), 'free GiB %.1f' % (torch.cuda.mem_get_info()[0] / 2**30)); print('unsloth', unsloth.__version__, 'trl', trl.__version__, 'transformers', transformers.__version__, 'peft', peft.__version__)" 2>&1 | grep -v -E 'Warning|W10|patch'
    say "base weights"; du -shL "$HF_HOME"/hub/models--unsloth--Qwen3-8B 2>/dev/null || echo "MISSING: unsloth/Qwen3-8B"
    say "data"; ls -la "$DATA"/m3-train-2000.jsonl "$DATA"/m3-eval.jsonl "$DATA"/MANIFEST.json 2>&1
    say "disk"; df -h "$T" | tail -1
    ;;
  stop-ollama)
    sudo -n mkdir -p "$T/saved" && sudo -n cp -p "$OVR" "$T/saved/override.conf.$(date -u +%Y%m%dT%H%M%SZ)" || die "cannot save $OVR"
    sudo -n systemctl stop ollama && sudo -n systemctl disable ollama 2>/dev/null
    sleep 3; systemctl is-active ollama; nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader
    ;;
  fit)
    # the guard's findings (other GPU processes, ALLOW_OTHER_GPU) go into the SAME run log (Codex r5 P3)
    gpu_guard 2>&1 | tee "$T/runs-fit-01.log"; [ "${PIPESTATUS[0]}" = 0 ] || exit 2
    $PY "$T/train_sft.py" --data "$DATA/m3-train-2000.jsonl" --out "$T/runs/fit-01" --fit-test-only --m2b-verified "$DROP16_VERIFIED" 2>&1 | tee -a "$T/runs-fit-01.log"
    ;;
  train)
    gpu_guard 2>&1 | tee "$T/runs-$RUN.log"; [ "${PIPESTATUS[0]}" = 0 ] || exit 2
    [ -f "$T/runs/fit-01/metrics.json" ] || die "run the fit test first"
    nice -n 5 $PY "$T/train_sft.py" --data "$DATA/m3-train-2000.jsonl" --out "$T/runs/$RUN" --max-steps 200 --grad-accum 10 --m2b-verified "$DROP16_VERIFIED" 2>&1 | tee -a "$T/runs-$RUN.log"
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
    # Written by python, byte for byte: $(cat ...) would strip the template's trailing "\n\n" after </think> (Codex r1 P2)
    $PY - "$T/runs/$RUN" "$CAND" <<'PY' || die "Modelfile write failed"
import os, sys
d, cand = sys.argv[1:3]
tpl = open(os.path.join(d, 'template.txt')).read()
assert tpl.endswith('</think>\n\n'), 'template must end with the no-think tail: %r' % tpl[-24:]
gguf = os.path.join(d, cand + '-bf16.gguf')
for name, src in (('bf16', gguf), ('q4', gguf), ('base-nothink', 'qwen3:8b')):
    open(os.path.join(d, 'Modelfile.' + name), 'w').write('FROM %s\nTEMPLATE """%s"""\nPARAMETER stop "<|im_end|>"\n' % (src, tpl))
print('Modelfiles written; template tail %r' % tpl[-12:])
PY
    (cd "$T/llama.cpp" && git rev-parse HEAD) > "$T/runs/$RUN/llama.cpp.sha"
    echo "Modelfiles written. With ollama running (start-ollama):"
    echo "  ollama create $CAND-bf16 -f $T/runs/$RUN/Modelfile.bf16"
    echo "  ollama create $CAND -q q4_K_M -f $T/runs/$RUN/Modelfile.q4"
    echo "  ollama pull qwen3:8b && ollama create qwen3-8b-nothink -f $T/runs/$RUN/Modelfile.base-nothink"
    sha256sum "$T/runs/$RUN/$CAND-bf16.gguf" | tee "$T/runs/$RUN/gguf.sha256"
    ;;
  template-check)
    # the served prompt must equal the trained one, token for token (template_check.py); needs ollama running and
    # the models created (see export's printed commands)
    for m in "$CAND" "$CAND-bf16" qwen3-8b-nothink; do
      $PY "$T/template_check.py" --items "$DATA/m3-eval.jsonl" --model "$m" --n 3 || die "template check FAILED for $m"
    done
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
