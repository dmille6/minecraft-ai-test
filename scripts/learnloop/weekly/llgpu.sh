#!/bin/bash
# llgpu.sh -- the learning loop's ONLY door to the 3090 (10.0.0.16). Installed at ~/learnloop-train/r3/llgpu.sh.
# Run locally, or from 10.0.0.31 through the restricted key (authorized_keys: command="llgpu.sh --ssh",
# from="10.0.0.31",restrict): then the verb comes from SSH_ORIGINAL_COMMAND and only the verbs below exist.
#
#   status                         JSON: our lock, other GPU users, servea, Ollama, disk, our jobs
#   claim <holder> <phase>         take the GPU for the learning loop (exit 75 = BUSY: somebody else is on it)
#   release <holder>               give it back (also stops our Ollama/llama-server)
#   teacher-up|teacher-down <holder>   start/stop the 3090 Ollama (the local teacher qwen3.8:27b), as found: disabled
#   put <run>                      stdin -> runs/<run>/train.jsonl (sha256 printed)
#   train <holder> <run> <base> <quant> [epochs]   detached train_sft.py (LoRA only, no merged-16bit: disk)
#   export <holder> <run> <base> [outtype]         detached export_lora_gguf.py -> runs/<run>/cand-<outtype>.gguf (CPU only)
#   convert-base <holder> <base> [outtype]         the UNTUNED base through the same converter (control; CPU only)
#   job <run> <kind>               state of a detached job: running | done | failed (+ log tail)
#   serve <holder> <model> <alias> llama-server b12020 on :18090 with the servea flags (the fleet serving path)
#   unserve <holder>
#   get <run> <file>               cat a result file (metrics.json, *.export.json, peft_probe.jsonl, *.log)
#   models                         the model keys `serve` accepts
#
# GPU RULES (owner + control session): NEVER stop, signal or slow ~/ethan-gpu on purpose -- its llama-server is the
# only process allowed to share the GPU with us. `claim` refuses (75) while ANY other GPU process exists, while the
# serving agent's ~/batchtest server or servea supervisor is alive, or while another holder has the lock. Nothing here
# kills a process it did not start. The Blackwell and 10.0.0.72 are never contacted.
set -u
R=$HOME/learnloop-train/r3; T=$HOME/learnloop-train; PY=$T/venv/bin/python
LOCK=$R/GPU-LOCK; NOTE=$HOME/GPU3090-IN-USE.txt
LD=$HOME/batchtest/llama-b12020/llama-b12020
LL=$HOME/batchtest/cudart/cudart-llama-b12020-bin-ubuntu-cuda-12.8-x64:$HOME/batchtest/lib:$LD
PORT=18090
mkdir -p "$R/runs" "$R/models" "$R/jobs"
die() { echo "REFUSED: $*"; exit 2; }
okname() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]] || die "bad name '$1'"; }
alive() { [ -f "$1" ] || return 1; local p st; read -r p st < "$1"; kill -0 "$p" 2>/dev/null || return 1
  [ -z "$st" ] || [ "$(awk '{print $22}' "/proc/$p/stat" 2>/dev/null)" = "$st" ]; }   # the serving agent's files carry no start time
snap() { case "$1" in
  qwen35-9b) ls -d "$T"/hf/hub/models--unsloth--Qwen3.5-9B/snapshots/*/ 2>/dev/null | head -1;;
  qwen35-4b) ls -d "$T"/hf/hub/models--unsloth--Qwen3.5-4B/snapshots/*/ 2>/dev/null | head -1;;
  *) echo "";; esac; }
ethan_pids() { pgrep -f "/home/mike/ethan-gpu/" | tr '\n' ' '; }
# A recorded pid file is "pid starttime" (/proc/<pid>/stat field 22). A pid counts as OURS only while it is alive, its
# start time matches the record, and its command line is one of ours (Codex r1/r2: a reused pid must never be exempted
# from the busy check nor signalled).
starttime() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null; }
record_pid() { echo "$1 $(starttime "$1")" > "$2"; }
our_pid() {          # <pidfile> -> the pid if it is still the process we started, else nothing
  [ -f "$1" ] || return 0; local p st; read -r p st < "$1"; [ -n "$p" ] || return 0
  [ -n "$st" ] && [ "$(starttime "$p")" = "$st" ] || return 0
  case "$(ps -o args= -p "$p" 2>/dev/null)" in
    *"$R/train_sft.py"*|*"$R/export_lora_gguf.py"*|*"convert_hf_to_gguf.py"*"$R/runs/"*|*"$LD/llama-server"*"--port $PORT"*) echo "$p";;
  esac; }
# GPU compute processes that are neither ethan-gpu nor ours. A failed nvidia-smi is itself a busy answer.
others() {
  local e ours=" " f p0 q_out; e=" $(ethan_pids) "
  for f in "$R"/jobs/*.pid "$R/serve.pid"; do p0=$(our_pid "$f"); [ -n "$p0" ] && ours="$ours$p0 "; done
  if ! q_out=$(nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader 2>&1); then
    echo "unknown:nvidia-smi failed: $(echo "$q_out" | head -1 | cut -c1-80)"; return 0; fi
  echo "$q_out" | while IFS=, read -r p m; do
    p=$(echo "$p" | tr -d ' '); [ -n "$p" ] || continue
    case "$e" in *" $p "*) continue;; esac
    case "$ours" in *" $p "*) continue;; esac
    # the 3090 Ollama's runner while WE started Ollama (the local teacher) is ours too
    if [ -f "$R/ollama-started-by-us" ]; then case "$(ps -o args= -p "$p" 2>/dev/null)" in /usr/local/lib/ollama/*) continue;; esac; fi
    echo "$p:$(echo "$m" | tr -d ' '):$(ps -o args= -p "$p" 2>/dev/null | cut -c1-120)"
  done; }
serving_agent() {
  local s=""
  alive "$HOME/batchtest/servea/supervisor.pid" && s="$s servea-supervisor"
  alive "$HOME/batchtest/servea/server.pid" && s="$s servea-server"
  alive "$HOME/batchtest/server.pid" && s="$s batchtest-server"
  echo "$s"; }
holder() { [ -f "$LOCK" ] && python3 -c "import json;print(json.load(open('$LOCK'))['holder'])" 2>/dev/null; }
need() { [ "$(holder)" = "$1" ] || die "the GPU lock is not held by $1 (holder: $(holder || echo none))"; }
ollama_state() { systemctl is-active ollama 2>/dev/null; }

status() {
  python3 - "$(holder)" "$(others | tr '\n' '|')" "$(serving_agent)" "$(ollama_state)" "$(df -BG --output=avail / | tail -1 | tr -d ' G')" \
    "$(alive "$R/serve.pid" && cat "$R/serve.alias")" "$(ethan_pids)" "$(ls "$R"/jobs/*.pid 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')" <<'PY'
import json, sys, time
h, oth, sa, ol, disk, srv, eth, jobs = sys.argv[1:9]
print(json.dumps({'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'lock_holder': h or None,
                  'other_gpu': [x for x in oth.split('|') if x], 'serving_agent': sa.split(), 'ollama': ol,
                  'disk_free_gb': int(disk or 0), 'our_server': srv or None, 'ethan_pids': eth.split(),
                  'our_jobs': jobs.split(),
                  'busy': bool([x for x in oth.split('|') if x] or sa.split() or (h and h != ''))}))
PY
}

stop_ours_server() {     # only a pid whose command line is OUR llama-server on OUR port is ever signalled (Codex r1)
  local sp; sp=$(our_pid "$R/serve.pid")
  if [ -n "$sp" ]; then kill "$sp"; for _ in $(seq 1 30); do kill -0 "$sp" 2>/dev/null || break; sleep 1; done; fi
  rm -f "$R/serve.pid" "$R/serve.alias"; }
stop_ours() {
  stop_ours_server
  if [ "$(ollama_state)" = active ] && [ -f "$R/ollama-started-by-us" ]; then
    curl -s -m 20 localhost:11434/api/ps | python3 -c "import json,sys,subprocess
for m in json.load(sys.stdin).get('models') or []: subprocess.run(['curl','-s','-m','30','localhost:11434/api/generate','-d',json.dumps({'model':m['name'],'keep_alive':0})],capture_output=True)" 2>/dev/null
    sudo -n systemctl stop ollama; rm -f "$R/ollama-started-by-us"
  fi; }

model_path() { case "$1" in
  run:*) local r=${1#run:}; okname "${r%%/*}"; echo "$R/runs/${r%%/*}/${r#*/}";;
  *) okname "$1"; echo "$R/models/$1.gguf";; esac; }

verb=${1:-}
if [ "$verb" = --ssh ]; then
  # restricted key: split SSH_ORIGINAL_COMMAND on spaces; every argument must be a plain token
  read -r -a A <<< "${SSH_ORIGINAL_COMMAND:-}"
  for x in "${A[@]}"; do [[ "$x" =~ ^[A-Za-z0-9._:/@=+-]{1,128}$ ]] || die "bad argument"; [[ "$x" == *..* ]] && die "bad argument"; done
  set -- "${A[@]}"; verb=${1:-}
fi
shift || true
case "$verb" in
status) status ;;
claim)
  h=${1:?holder}; ph=${2:?phase}; okname "$h"; okname "$ph"
  exec 9>"$R/.claim.lock"; flock -n 9 || { echo BUSY claim-race; exit 75; }
  cur=$(holder); if [ -n "$cur" ] && [ "$cur" != "$h" ]; then echo "BUSY lock held by $cur"; exit 75; fi
  o=$(others); [ -z "$o" ] || { echo "BUSY other GPU process: $o"; exit 75; }
  s=$(serving_agent); [ -z "$s" ] || { echo "BUSY serving agent:$s"; exit 75; }
  python3 -c "import json,time,sys;json.dump({'holder':sys.argv[1],'phase':sys.argv[2],'since':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},open(sys.argv[3],'w'))" "$h" "$ph" "$LOCK"
  printf 'The learning loop (%s, phase %s) is using this GPU since %s.\nState: %s/llgpu.sh status. Lock file: %s\nIt never touches ~/ethan-gpu. Please do not start another GPU job until this file is gone.\n' \
    "$h" "$ph" "$(date -u +%FT%TZ)" "$R" "$LOCK" > "$NOTE"
  echo "CLAIMED $h $ph" ;;
release)
  h=${1:?holder}; need "$h"
  for p in "$R"/jobs/*.pid; do [ -f "$p" ] && alive "$p" && die "job $(basename "$p" .pid) still running"; done
  stop_ours; rm -f "$LOCK" "$NOTE"; echo "RELEASED $h" ;;
teacher-up)
  need "${1:?holder}"
  if [ "$(ollama_state)" != active ]; then sudo -n systemctl start ollama && touch "$R/ollama-started-by-us"; fi
  for _ in $(seq 1 30); do curl -sf -m 3 localhost:11434/api/version >/dev/null && { echo "OLLAMA UP"; exit 0; }; sleep 1; done
  die "ollama did not come up" ;;
teacher-down) need "${1:?holder}"; stop_ours; echo "OLLAMA $(ollama_state)" ;;
put-eval)
  # the gate set (promptcache layout) for the trainer's PEFT probe; written once
  [ -s "$R/m3-eval.v0.pc.jsonl" ] && { echo "exists"; exit 0; }
  cat > "$R/m3-eval.v0.pc.jsonl.part" && mv "$R/m3-eval.v0.pc.jsonl.part" "$R/m3-eval.v0.pc.jsonl"; echo "written" ;;
put)
  run=${1:?run}; okname "$run"; mkdir -p "$R/runs/$run"
  [ -e "$R/runs/$run/train.jsonl" ] && die "runs/$run/train.jsonl exists (immutable)"
  cat > "$R/runs/$run/train.jsonl.part" && mv "$R/runs/$run/train.jsonl.part" "$R/runs/$run/train.jsonl"
  sha256sum "$R/runs/$run/train.jsonl" | cut -c1-64 ;;
train)
  h=${1:?holder}; run=${2:?run}; base=${3:?base}; q=${4:?quant}; ep=${5:-1}; need "$h"; okname "$run"
  case "$q" in 8bit|16bit) ;; *) die "quant must be 8bit or 16bit";; esac
  [[ "$ep" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "bad epochs"
  S=$(snap "$base"); [ -n "$S" ] || die "unknown base $base (or no snapshot)"
  [ -f "$R/runs/$run/train.jsonl" ] || die "no runs/$run/train.jsonl (put it first)"
  [ "$(ollama_state)" = active ] && die "Ollama is running: teacher-down first (the trainer refuses a resident model)"
  alive "$R/jobs/$run-train.pid" && die "already running"
  [ -f "$R/runs/$run/metrics.json" ] && die "runs/$run already trained"
  # DROP16: no bot env names 10.0.0.16 (verified 10-31 06:00Z, 80/80 environ; the serving agent's servea is checked by claim)
  # NOT `cd && cmd &` (a forked subshell becomes $!, and killing it leaves the trainer running): cd first, then one
  # simple background command, so $! is the trainer itself (setsid does not fork: a background job is no group leader)
  cd "$T"
  HF_HOME=$T/hf CC=$T/bin/cc setsid nohup nice -n 5 "$PY" "$R/train_sft.py" --base "$S" --data "$R/runs/$run/train.jsonl" \
    --out "$R/runs/$run" --max-steps 0 --epochs "$ep" --grad-accum 16 --quant "$q" --targets qwen35 --save-steps 100 --resume \
    $( [ -s "$R/m3-eval.v0.pc.jsonl" ] && echo --probe-items "$R/m3-eval.v0.pc.jsonl" --probe-n 30) --no-merged --m2b-verified "${DROP16_VERIFIED:-2026-10-31T06:00Z}" \
    > "$R/runs/$run/train.log" 2>&1 < /dev/null &
  record_pid $! "$R/jobs/$run-train.pid"; echo "STARTED train $run pid $!" ;;
export|convert-base)
  # CPU + disk only (the merge and the converter never touch the GPU): no claim needed, so it can run beside anyone
  h=${1:?holder}; okname "$h"
  [ "$(df -BG --output=avail / | tail -1 | tr -d ' G')" -ge 12 ] || die "less than 12 GB free on /"
  if [ "$verb" = export ]; then run=${2:?run}; base=${3:?base}; ot=${4:-q8_0}; okname "$run"
    [ -d "$R/runs/$run/lora" ] || die "no runs/$run/lora"; out=$R/runs/$run/cand-$ot.gguf; lora="--lora $R/runs/$run/lora"; job=$run-export-$ot
  else base=${2:?base}; ot=${3:-q8_0}; run=base-$base; mkdir -p "$R/runs/$run"; out=$R/runs/$run/base-$ot.gguf; lora=""; job=$run-convert-$ot; fi
  case "$ot" in q8_0|bf16) ;; *) die "outtype q8_0|bf16";; esac
  S=$(snap "$base"); [ -n "$S" ] || die "unknown base $base"
  [ -e "$out" ] && die "$out exists"
  alive "$R/jobs/$job.pid" && die "already running"
  if [ -n "$lora" ]; then cmd=("$PY" "$R/export_lora_gguf.py" --base "$S" $lora --out "$out" --outtype "$ot")
  else cmd=(env PYTHONPATH=$T/llama.cpp/gguf-py "$PY" "$T/llama.cpp/convert_hf_to_gguf.py" "$S" --outtype "$ot" --outfile "$out"); fi
  setsid nohup nice -n 10 "${cmd[@]}" > "$R/runs/$run/$job.log" 2>&1 < /dev/null &
  record_pid $! "$R/jobs/$job.pid"; echo "STARTED $job pid $!" ;;
job)
  run=${1:?run}; kind=${2:?kind}; okname "$run"; okname "$kind"; p=$R/jobs/$run-$kind.pid
  [ -f "$p" ] || { echo "none"; exit 0; }
  if alive "$p"; then echo "running"; exit 0; fi
  case "$kind" in
    train) if python3 -c "import json,sys;sys.exit(0 if json.load(open('$R/runs/$run/metrics.json'))['verdict']=='OK' else 1)" 2>/dev/null && [ -f "$R/runs/$run/lora/adapter_model.safetensors" ]; then echo done; else echo failed; tail -5 "$R/runs/$run/train.log"; fi ;;
    export-*) ot=${kind#export-}; if grep -q "^MERGED" "$R/runs/$run/$run-$kind.log" 2>/dev/null && [ -s "$R/runs/$run/cand-$ot.gguf" ]; then echo done; else echo failed; tail -5 "$R/runs/$run/$run-$kind.log"; fi ;;
    convert-*) ot=${kind#convert-}; if grep -q "Model successfully exported" "$R/runs/$run/$run-$kind.log" 2>/dev/null && [ -s "$R/runs/$run/base-$ot.gguf" ]; then echo done; else echo failed; tail -5 "$R/runs/$run/$run-$kind.log"; fi ;;
    *) echo "unknown kind";;
  esac ;;
serve)
  h=${1:?holder}; m=${2:?model}; al=${3:?alias}; need "$h"; okname "$al"
  G=$(model_path "$m"); [ -f "$G" ] || die "no model file for $m"
  [ "$(ollama_state)" = active ] && die "Ollama is running: teacher-down first"
  stop_ours_server
  # the servea flags (batching report s.5 / servea-llama.sh): -np 8 --no-kv-unified, 6144 per slot, fa, jinja, no reasoning
  LD_LIBRARY_PATH=$LL setsid nohup "$LD/llama-server" -m "$G" --alias "$al" -ngl 99 -fa on -np 8 -c 49152 --no-kv-unified \
    --jinja --reasoning off --no-webui --metrics --host 0.0.0.0 --port $PORT > "$R/serve-$al.log" 2>&1 < /dev/null &
  record_pid $! "$R/serve.pid"; echo "$al" > "$R/serve.alias"
  for _ in $(seq 1 240); do alive "$R/serve.pid" || break; curl -sf -m 2 localhost:$PORT/health >/dev/null && { echo "READY $al :$PORT $(nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader | tr '\n' ' ')"; exit 0; }; sleep 1; done
  tail -20 "$R/serve-$al.log"; rm -f "$R/serve.pid"; die "server did not come up" ;;
unserve) need "${1:?holder}"; stop_ours; echo "UNSERVED" ;;
get)
  run=${1:?run}; f=${2:?file}; okname "$run"
  [[ "$f" =~ ^(metrics\.json|log_history\.json|peft_probe\.jsonl|cand-[a-z0-9_]+\.gguf\.export\.json|[a-z0-9._-]+\.log)$ ]] || die "not a result file"
  cat "$R/runs/$run/$f" ;;
models)
  ls "$R/models" 2>/dev/null | sed 's/\.gguf$//'; for d in "$R"/runs/*/; do ls "$d" | grep -E '\.gguf$' | sed "s|^|run:$(basename "$d")/|"; done ;;
*) sed -n 2,22p "$0"; exit 2 ;;
esac
