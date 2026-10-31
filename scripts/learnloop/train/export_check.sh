#!/bin/bash
# export_check.sh <out dir> <bf16 model> <quant model> [<quant model> ...] -- the s.3.2 export check, run ON 10.0.0.31
# (node + the replay copy that eval.sh made), against the 3090's Ollama started for evaluation (run.sh start-ollama).
#
#   bash export_check.sh ~/learnloop/m3/export-check-boot-01 cand-qwen3-8b-v0-boot-bf16 cand-qwen3-8b-v0-boot cand-qwen3-8b-v0-boot-q8
#
# WHY GREEDY (measured 10-24 on the dry round): at the fleet's temperature 0.7 the SAME q4 weights replayed twice
# chose the same skill on 66.7% of items, so the 97% gate cannot be met by any export at 0.7. The check therefore
# replays every model at LLM_TEMPERATURE=0 (everything else is the fleet's client, as in eval.sh), and runs the FIRST
# quant model twice: that determinism control (96.7% on the dry round, NUM_PARALLEL 2) is the instrument's ceiling and
# is printed next to every verdict. Gate (unchanged): same skill >= 97% of items both answered schema-valid, complete
# coverage, and the quant's schema-valid share not below the 16-bit's.
set -u
O=${1:?out dir}; BF=${2:?bf16 model}; shift 2
[ $# -ge 1 ] || { echo "usage: export_check.sh <out dir> <bf16 model> <quant model>..."; exit 2; }
[ -n "${DROP16_VERIFIED:-}" ] || { echo "REFUSED: set DROP16_VERIFIED=<ISO time of the +24 h drop16.sh --verify OK>"; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
DS=${DS:-$HOME/learnloop/datasets/v0}
URL=${URL:-http://10.0.0.16:11434}
B=$(ls -d "$HOME"/learnloop/replay/bots-*/bots 2>/dev/null | head -1)
[ -n "$B" ] || { echo "REFUSED: no replay copy under ~/learnloop/replay (run eval.sh once first)"; exit 2; }
mkdir -p "$O"
f() { echo "$O/$(echo "$1" | tr ':/' '__')$2.jsonl"; }
run() {
  echo "== $1 T=0 -> $2"
  LLM_TEMPERATURE=0 nice -n 19 node "$HERE/replay_client.mjs" "$B" "$DS/m3-eval.jsonl" "$2" "$URL" "$1" 2 || { echo "replay of $1 failed"; exit 4; }
}
run "$BF" "$(f "$BF" -t0)"
for q in "$@"; do run "$q" "$(f "$q" -t0)"; done
run "$1" "$(f "$1" -t0-rep)"
python3 "$HERE/export_summary.py" --items "$DS/m3-eval.jsonl" --bf16 "$(f "$BF" -t0)" --det "$(f "$1" -t0)" "$(f "$1" -t0-rep)" \
  --quant $(for q in "$@"; do echo "$q=$(f "$q" -t0)"; done) | tee "$O/summary.json"
