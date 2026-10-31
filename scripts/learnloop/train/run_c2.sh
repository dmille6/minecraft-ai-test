#!/bin/bash
# run_c2.sh <phase> -- learning loop CANDIDATE 2 on the 3090 VM (10.0.0.16): Qwen3.5-9B, 8-bit LoRA, cleaned data.
# Owner 10-30 "queue both". Same guards as run.sh (gpu_guard: DROP16_VERIFIED, no Ollama model resident, other GPU
# processes only with ALLOW_OTHER_GPU) -- this file sources nothing from run.sh so the boot-01 record stays as it was.
#
#   bash run_c2.sh train          8-bit LoRA (Unsloth: QLoRA is "not recommended" for Qwen3.5; bf16 LoRA needs ~22 GB,
#                                 which does not fit beside ethan-gpu), one epoch of c2/train.jsonl, checkpoints
#   bash run_c2.sh export         merged 16-bit -> GGUF bf16 (llama.cpp) -> Modelfiles that copy the STOCK qwen3.5:9b
#                                 tag's RENDERER/PARSER/PARAMETERs, so candidate and base differ only in weights
#   bash run_c2.sh export-base    the untuned Qwen3.5-9B through the SAME converter (a converter-effect control)
#   bash run_c2.sh create         ollama create: cand q8_0 + bf16, base-conv q8_0 (ollama must be running)
#   bash run_c2.sh template-check served prompt (think:false, the canary's proxy path) == trained render, per model
#
# SERVING (corrected after the Claude review, B1): the bots' client sends NO `think`. On the 3090's Ollama 0.32.14 the
# stock qwen3.5 renderer then THINKS (replay-cands-01: the no-think probe failed 5/5); on the Blackwell's Ollama 0.33.2
# `think` unset renders exactly like think:false (qwen35-01 registration: 40/40 byte-identical at T=0) -- and the
# qwen35-01 canary serves the stock tag there with `think` unset, no proxy. So: the OFFLINE replay here goes through a
# think:false proxy (= what 0.33.2 does by default), for the candidate AND every model it is compared with; and a
# candidate canary must first pass `template_check.py --served-think unset` against the Blackwell (the check below
# with SERVED_THINK=unset URL=...), i.e. think unset == the trained no-think render ON THE SERVER THAT WILL SERVE IT.
set -u
set -o pipefail      # `| tee` must not hide train_sft.py's exit 3 (broken gradients) -- Claude review note
T=$HOME/learnloop-train
PY=$T/venv/bin/python
export HF_HOME=$T/hf
export CC=${CC:-$T/bin/cc}
RUN=${RUN:-c2-01}
CAND=${CAND:-cand-qwen35-9b-c2}
DATA=${DATA:-$T/c2/train.jsonl}
GA=${GA:-16}
EPOCHS=${EPOCHS:-1}
SNAP=$(ls -d "$HF_HOME"/hub/models--unsloth--Qwen3.5-9B/snapshots/*/ 2>/dev/null | head -1)
LCPP=$T/llama.cpp
say() { echo "== $*"; }
die() { echo "REFUSED: $*"; exit 2; }
gpu_guard() {
  [ -n "${DROP16_VERIFIED:-}" ] || die "set DROP16_VERIFIED=<ISO time of the +24 h drop16.sh --verify OK>"
  local ps; ps=$(curl -s -m 5 http://127.0.0.1:11434/api/ps || echo STOPPED)
  case "$ps" in STOPPED|'{"models":[]}') ;; *) die "Ollama holds a model: $ps";; esac
  local other; other=$(nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>&1) || die "nvidia-smi failed ($other)"
  if [ -n "$other" ]; then
    echo "  other GPU processes: $other"
    [ -n "${ALLOW_OTHER_GPU:-}" ] || die "another process holds GPU memory: set ALLOW_OTHER_GPU=<owner decision>"
    echo "  ALLOW_OTHER_GPU=$ALLOW_OTHER_GPU"
  fi
}
[ -n "$SNAP" ] || die "no unsloth/Qwen3.5-9B snapshot in $HF_HOME"
case "${1:-}" in
  train)
    gpu_guard 2>&1 | tee -a "$T/runs-$RUN.log"; [ "${PIPESTATUS[0]}" = 0 ] || exit 2
    [ -x "$CC" ] || die "no C compiler at CC=$CC"
    [ -f "$DATA" ] || die "no training file $DATA"
    nice -n 5 $PY "$T/train_sft.py" --base "$SNAP" --data "$DATA" --out "$T/runs/$RUN" --max-steps 0 --epochs "$EPOCHS" \
      --grad-accum "$GA" --quant 8bit --targets qwen35 --save-steps "${SAVE:-100}" ${RESUME:+--resume} \
      --probe-items "$T/data/m3-eval.jsonl" --probe-n 30 \
      --m2b-verified "$DROP16_VERIFIED" 2>&1 | tee -a "$T/runs-$RUN.log"
    ;;
  export|export-base)
    if [ "$1" = export ]; then M=$T/runs/$RUN/merged-16bit; OUT=$T/runs/$RUN/$CAND-bf16.gguf; else
      M=$T/runs/base-qwen35-9b/hf; OUT=$T/runs/base-qwen35-9b/qwen35-9b-base-bf16.gguf; mkdir -p "$M"
      for f in "$SNAP"*; do ln -sf "$(readlink -f "$f")" "$M/$(basename "$f")"; done; fi
    [ -d "$M" ] || die "no model at $M"
    say "convert $M -> $OUT (bf16, text model only: no --mmproj)"
    PYTHONPATH=$LCPP/gguf-py $PY "$LCPP/convert_hf_to_gguf.py" "$M" --outtype bf16 --outfile "$OUT" || die "convert failed"
    sha256sum "$OUT" | tee "$OUT.sha256"
    (cd "$LCPP" && git rev-parse HEAD) > "$(dirname "$OUT")/llama.cpp.sha"
    # fetch to a temp file first (Codex r1 note: a failed fetch must not clobber the cached copy)
    if curl -sf -m 30 http://127.0.0.1:11434/api/show -d '{"model": "qwen3.5:9b-q8_0"}' > "$T/base-meta/.q35.tmp" 2>/dev/null; then
      mv "$T/base-meta/.q35.tmp" "$T/base-meta/qwen3.5_9b-q8_0.json"; else rm -f "$T/base-meta/.q35.tmp"; fi
    [ -s "$T/base-meta/qwen3.5_9b-q8_0.json" ] || die "need the stock tag's metadata: start ollama and rerun"
    $PY - "$OUT" "$T/base-meta/qwen3.5_9b-q8_0.json" <<'PY' || die "Modelfile write failed"
import json, os, sys
gguf, meta_p = sys.argv[1:3]
meta = json.load(open(meta_p))
lines = [l for l in meta['modelfile'].splitlines() if l.startswith(('RENDERER ', 'PARSER ', 'PARAMETER '))]
assert any(l == 'RENDERER qwen3.5' for l in lines) and any(l == 'PARSER qwen3.5' for l in lines), lines
open(gguf[:-len('.gguf')] + '.Modelfile', 'w').write('FROM %s\n%s\n' % (gguf, '\n'.join(lines)))
print('Modelfile', gguf[:-len('.gguf')] + '.Modelfile', lines)
PY
    ;;
  create)
    MF=$T/runs/$RUN/$CAND-bf16.Modelfile; BMF=$T/runs/base-qwen35-9b/qwen35-9b-base-bf16.Modelfile
    [ -f "$MF" ] || die "run export first"
    ollama create "$CAND-bf16" -f "$MF" && ollama create "$CAND-q8" -q q8_0 -f "$MF" || die "create failed (candidate)"
    [ -f "$BMF" ] && { ollama create qwen35-9b-baseconv-q8 -q q8_0 -f "$BMF" || die "create failed (base)"; }
    ollama list | grep -E "$CAND|baseconv"
    ;;
  template-check)
    # SERVED_THINK=false (default: the offline replay's proxy path on this host) or unset (the Blackwell, before a canary)
    URL=${URL:-http://127.0.0.1:11434}
    for m in ${MODELS:-"$CAND-q8" "$CAND-bf16" qwen35-9b-baseconv-q8 qwen3.5:9b-q8_0}; do
      curl -sf -m 10 "$URL/api/show" -d "{\"model\": \"$m\"}" >/dev/null || die "$m is not on $URL (a skipped model is not a pass)"
      $PY "$T/template_check.py" --url "$URL" --items "$T/data/m3-eval.jsonl" --model "$m" --base "$SNAP" --control-model qwen2.5:7b-instruct \
        --served-think "${SERVED_THINK:-false}" --n 3 || die "template check FAILED for $m"
    done
    ;;
  *) sed -n 2,16p "$0"; exit 2;;
esac
