#!/bin/bash
# eval.sh <dataset dir> <model> [<model> ...] -- learning loop M3 offline evaluation, run ON 10.0.0.31 (it has node and
# the deploy checkout; the 3090 VM has neither). Replays <dataset>/m3-eval.jsonl through the bots' own LlmClient at the
# dataset's newest code version against the 3090's Ollama, one model at a time, then scores all of them.
#
#   bash eval.sh ~/learnloop/datasets/v0 qwen2.5:7b-instruct qwen3-8b-nothink cand-qwen3-8b-v0-dry cand-qwen3-8b-v0-dry-bf16
#
# The FIRST model is the reference for the gates (s.4a: the fleet model, base qwen2.5:7b). Needs DROP16_VERIFIED set
# (no bot can reach .16) and the 3090's Ollama started for evaluation (run.sh start-ollama). Read-only on the deploy
# checkout (git archive only). Concurrency 2: this is a measurement, not a load test.
set -u
DS=${1:?dataset dir}; shift
[ $# -ge 1 ] || { echo "usage: eval.sh <dataset dir> <model>..."; exit 2; }
[ -n "${DROP16_VERIFIED:-}" ] || { echo "REFUSED: set DROP16_VERIFIED=<ISO time of the +24 h drop16.sh --verify OK>"; exit 2; }
URL=${URL:-http://10.0.0.16:11434}
HERE=$(cd "$(dirname "$0")" && pwd)
VER=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['newest_code_version'])" "$DS/MANIFEST.json")
SHA=$(git -C /opt/minecraft-ai rev-parse --verify "$VER^{commit}") || { echo "REFUSED: $VER not in /opt/minecraft-ai"; exit 2; }
B=$HOME/learnloop/replay/bots-${SHA:0:12}
if [ ! -d "$B/bots/src" ]; then
  mkdir -p "$B" && git -C /opt/minecraft-ai archive "$SHA" bots/src bots/package.json | tar -x -C "$B" || exit 3
  ln -s /srv/mcbots/harness/node_modules "$B/bots/node_modules"
fi
OUT=$DS/eval; mkdir -p "$OUT"
RUNS=()
for m in "$@"; do
  f=$OUT/$(echo "$m" | tr ':/' '__').jsonl
  echo "== replay $m -> $f"
  nice -n 19 node "$HERE/replay_client.mjs" "$B/bots" "$DS/m3-eval.jsonl" "$f" "$URL" "$m" 2 || { echo "replay of $m failed"; exit 4; }
  RUNS+=("$f")
done
mkdir -p "$HERE/bench"; cp -n /opt/minecraft-ai/bench/models/score.py "$HERE/bench/" 2>/dev/null || true
python3 "$HERE/eval_offline.py" --items "$DS/m3-eval.jsonl" --runs "${RUNS[@]}" --json "$OUT/scores.json"
