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
# M3 run (10-24): the base, the training file and the round's shape are parameters, so the bootstrap round and the
# qwen2.5 control (design s.3.1/s.3.4) run through the same phases. Defaults = the approved dry round.
BASE=${BASE:-unsloth/Qwen3-8B}
TRAIN=${TRAIN:-$DATA/m3-train-2000.jsonl}
STEPS=${STEPS:-200}
GA=${GA:-10}
FIT=${FIT:-fit-01}
case "$BASE" in *Qwen2.5*) BASE_TAG=${BASE_TAG:-qwen2.5:7b-instruct};; *) BASE_TAG=${BASE_TAG:-qwen3:8b};; esac
# TRITON NEEDS A C COMPILER for its launcher stubs and VM 200 has none (the 10-24 fit test died "Failed to find C
# compiler"). bin/cc = zig cc from the venv's ziglang wheel + the Python 3.12 headers extracted (dpkg -x, not installed)
# into $T/sysroot -- contained in $T, nothing system-wide. Checked: a Triton kernel builds with it and fails without.
export CC=${CC:-$T/bin/cc}
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
    [ -x "$CC" ] || die "no C compiler at CC=$CC (Triton needs one; see the CC note above)"
    gpu_guard 2>&1 | tee "$T/runs-$FIT.log"; [ "${PIPESTATUS[0]}" = 0 ] || exit 2
    $PY "$T/train_sft.py" --base "$BASE" --data "$TRAIN" --out "$T/runs/$FIT" --fit-test-only --grad-accum "$GA" --m2b-verified "$DROP16_VERIFIED" 2>&1 | tee -a "$T/runs-$FIT.log"
    ;;
  train)
    gpu_guard 2>&1 | tee "$T/runs-$RUN.log"; [ "${PIPESTATUS[0]}" = 0 ] || exit 2
    [ -x "$CC" ] || die "no C compiler at CC=$CC (Triton needs one; see the CC note above)"
    [ -f "$T/runs/$FIT/metrics.json" ] || die "run the fit test first ($T/runs/$FIT/metrics.json)"
    nice -n 5 $PY "$T/train_sft.py" --base "$BASE" --data "$TRAIN" --out "$T/runs/$RUN" --max-steps "$STEPS" --grad-accum "$GA" ${SAVE:+--save-steps "$SAVE"} ${RESUME:+--resume} --m2b-verified "$DROP16_VERIFIED" 2>&1 | tee -a "$T/runs-$RUN.log"
    ;;
  export)
    M=$T/runs/$RUN/merged-16bit
    [ -d "$M" ] || die "no merged model at $M"
    [ -d "$T/llama.cpp" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$T/llama.cpp" || die "llama.cpp clone failed"
    # QWEN3: force the trained no-think render INTO the GGUF's chat template (nothink_template.py says why: on Ollama
    # 0.32.14 a Modelfile TEMPLATE alone served the THINKING prompt to a client that sends no `think`, as the fleet's).
    case "$BASE_TAG" in qwen3*) $PY "$T/nothink_template.py" "$M" || die "no-think template rewrite failed";; esac
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
    # M3 (10-24): each arm is served with ITS BASE's TEMPLATE and sampling PARAMETERs, read byte-exact from the 3090's
    # Ollama by `run.sh base-meta` (/api/show). Qwen3 keeps the no-think template above (the training render); the
    # qwen2.5 control uses qwen2.5:7b-instruct's own template (its HF render equals it for system + user). Without the
    # base's parameters the candidate would sample with Ollama's defaults (top_k 40, top_p 0.9) while the base it is
    # compared against inherits its own -- a difference that is not the training.
    [ -f "$T/base-meta/$BASE_TAG.json" ] || die "no $T/base-meta/$BASE_TAG.json -- run 'bash run.sh base-meta' with ollama up"
    # Written by python, byte for byte: $(cat ...) would strip the template's trailing "\n\n" after </think> (Codex r1 P2)
    $PY - "$T/runs/$RUN" "$CAND" "$T/base-meta/$BASE_TAG.json" "$BASE_TAG" <<'PY' || die "Modelfile write failed"
import json, os, sys
d, cand, meta_p, tag = sys.argv[1:5]
meta = json.load(open(meta_p))
if tag.startswith('qwen3'):
    tpl = open(os.path.join(d, 'template.txt')).read()
    assert tpl.endswith('</think>\n\n'), 'template must end with the no-think tail: %r' % tpl[-24:]
else:
    tpl = meta['template']
    open(os.path.join(d, 'template.txt'), 'w').write(tpl)
assert '"""' not in tpl, 'template holds a triple quote'
params = []
for line in (meta.get('parameters') or '').splitlines():
    if line.strip():
        k, v = line.split(None, 1)
        params.append('PARAMETER %s %s' % (k, v.strip()))
if not any(p.startswith('PARAMETER stop ') and '<|im_end|>' in p for p in params):
    params.append('PARAMETER stop "<|im_end|>"')
gguf = os.path.join(d, cand + '-bf16.gguf')
# the untuned base is built by `run.sh export-base` exactly like the candidate (same converter, template, quantizer)
base_gguf = os.path.join(os.path.dirname(os.path.dirname(d)), 'runs', 'base-qwen3-8b', 'qwen3-8b-base-bf16.gguf') \
    if os.path.basename(os.path.dirname(d)) == 'runs' else None
files = [('bf16', gguf), ('q4', gguf)] + ([('base-nothink', base_gguf)] if tag.startswith('qwen3') and base_gguf else [])
for name, src in files:
    open(os.path.join(d, 'Modelfile.' + name), 'w').write('FROM %s\nTEMPLATE """%s"""\n%s\n' % (src, tpl, '\n'.join(params)))
print('Modelfiles written (%s); base %s; params %s; template tail %r' % (', '.join(n for n, _ in files), tag, params, tpl[-12:]))
PY
    (cd "$T/llama.cpp" && git rev-parse HEAD) > "$T/runs/$RUN/llama.cpp.sha"
    echo "Modelfiles written. With ollama running (start-ollama):"
    echo "  ollama create $CAND-bf16 -f $T/runs/$RUN/Modelfile.bf16"
    echo "  ollama create $CAND -q q4_K_M -f $T/runs/$RUN/Modelfile.q4"
    case "$BASE_TAG" in qwen3*) echo "  (after bash run.sh export-base) ollama create qwen3-8b-nothink -q q4_K_M -f $T/runs/$RUN/Modelfile.base-nothink";; esac
    sha256sum "$T/runs/$RUN/$CAND-bf16.gguf" | tee "$T/runs/$RUN/gguf.sha256"
    ;;
  export-base)
    # the UNTUNED Qwen3-8B, built exactly as a candidate is: HF base weights (symlinked) + the same no-think template
    # rewrite + the same converter; then `ollama create qwen3-8b-nothink -q q4_K_M` from the Modelfile export wrote
    B=$T/runs/base-qwen3-8b
    S=$(ls -d "$HF_HOME"/hub/models--unsloth--Qwen3-8B/snapshots/*/ | head -1)
    [ -n "$S" ] || die "no unsloth/Qwen3-8B snapshot in $HF_HOME"
    mkdir -p "$B/hf"
    for f in "$S"*; do n=$(basename "$f")
      case "$n" in tokenizer*|chat_template*|special_tokens*|added_tokens*) cp -L "$f" "$B/hf/$n" && chmod u+w "$B/hf/$n";; *) ln -sf "$(readlink -f "$f")" "$B/hf/$n";; esac
    done
    $PY "$T/nothink_template.py" "$B/hf" || die "no-think template rewrite failed (base)"
    PYTHONPATH=$T/llama.cpp/gguf-py $PY "$T/llama.cpp/convert_hf_to_gguf.py" "$B/hf" --outtype bf16 --outfile "$B/qwen3-8b-base-bf16.gguf" || die "convert failed (base)"
    sha256sum "$B/qwen3-8b-base-bf16.gguf" | tee "$B/gguf.sha256"
    ;;
  base-meta)
    # read-only: the base tags' TEMPLATE + PARAMETERS from this host's Ollama, byte-exact (/api/show); export uses them
    mkdir -p "$T/base-meta"
    for tag in qwen3:8b qwen2.5:7b-instruct; do
      curl -sf -m 30 http://127.0.0.1:11434/api/show -d "{\"model\": \"$tag\"}" > "$T/base-meta/$tag.json" || die "api/show $tag failed (pull it first?)"
      $PY -c "import json,sys; m=json.load(open(sys.argv[1])); print(sys.argv[2], 'template', len(m['template']), 'chars; parameters', m.get('parameters','').split()); print('  details', m.get('details'))" "$T/base-meta/$tag.json" "$tag"
    done
    ;;
  template-check)
    # the served prompt must equal the trained one, token for token (template_check.py); needs ollama running and
    # the models created (see export's printed commands)
    # per arm (M3 10-24): the HF tokenizer of the arm's base, and an Ollama control model served with a DIFFERENT
    # template (Qwen3 arm: stock qwen3:8b; qwen2.5 arm: qwen3-8b-nothink, whose no-think tail adds tokens)
    case "$BASE_TAG" in qwen3*) MS="$CAND $CAND-bf16 qwen3-8b-nothink"; CTL=qwen3:8b; TV=--think-variants;; *) MS="$CAND $CAND-bf16 $BASE_TAG"; CTL=qwen3-8b-nothink;; esac
    for m in $MS; do
      $PY "$T/template_check.py" --items "$DATA/m3-eval.jsonl" --model "$m" --base "$BASE" --control-model "$CTL" --n 3 ${TV:-} || die "template check FAILED for $m"
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
