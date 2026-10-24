#!/usr/bin/env bash
# LAVASIGHT-01 PAPER (10-24): base vs candidate on the failmine lava scenes, one sandbox, sequential, base first each pair.
#
#   sandbox/lavasight/lavasight-paper.sh <server> <baseRoot> <candRoot> <worldMap> <outDir> <repeats> <scene.json:start> ...
#
# Needs <server>'s OWN lock with tag `lavasight` (sandbox/sbxlock.sh take <server> lavasight "<note>"): scene-e2e refuses
# otherwise (FM_TAG=lavasight). The candidate reads the real isolated-a lava map translated into the arena (pool-hook.mjs);
# the base never opens the file. Results: <outDir>/results.jsonl (scene-e2e's rows) + the run dirs with every bot log.
set -euo pipefail
SERVER="$1"; BASE="$2"; CAND="$3"; WMAP="$4"; OUT="$5"; REP="$6"; shift 6
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
mkdir -p "$OUT"
for spec in "$@"; do
  scene="${spec%%:*}"; start="${spec##*:}"
  for i in $(seq 1 "$REP"); do
    for build in base cand; do
      root="$BASE"; [[ "$build" == cand ]] && root="$CAND"
      echo "=== $(date -u +%FT%TZ) $SERVER $build $(basename "$scene") start $start rep $i"
      FM_TAG=lavasight FM_OUT="$OUT" FM_POOL_HOOK="$HERE/pool-hook.mjs" LAVASIGHT_WORLD_MAP="$WMAP" \
        node "$REPO/sandbox/failmine/scene-e2e.mjs" "$root" "$build" "$scene" "$SERVER" "" "$start" 2>&1 | grep -E 'RESULT|FATAL|pool hook|placed' | cut -c1-400 || true
    done
  done
done
