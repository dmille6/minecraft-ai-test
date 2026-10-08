#!/bin/bash
# prepare-variant.sh <source-branch> <source-base-sha> <new-base-sha> <registration.json> [<out-dir>]
#
# MECHANICAL preparation of a canary variant on a moved fleet base (docs/reports/canary-throughput-2026-10-08.md,
# "variant prep"; both engines YES on condition that it grants NO approval). 3 of the 5 no-launch gaps of 10-03..10-08
# (5.0 h) were "the variant for the base that just moved was not ready". This does the mechanical part only:
#   1. a throwaway git worktree at <new-base-sha> (never /opt/minecraft-ai, never the operator's tree);
#   2. cherry-pick <source-base-sha>..<source-branch> onto it -- ABORTS on any conflict (a conflict needs a reviewed rebase);
#   3. `git range-diff` old range vs new range (unchanged patches print as '=': anything else is a behavioural change
#      that must be reviewed);
#   4. `npm test` from bots/ (the real runner, scripts/run-tests.mjs) and eslint no-undef on bots/src;
#   5. writes <out-dir>/<run>.<new7>.json: the registration with "sha" = the new head, "approved" REMOVED, and a
#      "variant_prep" block (source, bases, range-diff verdict, test + lint results) -- so `canary-sched.py queue add`
#      REFUSES it until a reviewer adds an "approved" naming the review;
#   6. writes <out-dir>/<run>.<new7>.variant-report.txt.
# It never pushes, never stages anything on the host, and leaves a branch `vp/<run>-on-<new7>` for the reviewer.
set -u
SRC=${1:?source branch}; OLDBASE=${2:?source base sha}; NEWBASE=${3:?new base sha}; REG=${4:?registration.json}
OUT=${5:-$(pwd)}
REPO=$(git rev-parse --show-toplevel) || exit 2
RUN=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('run_id') or d.get('run') or '')" "$REG")
[ -n "$RUN" ] || RUN=$(basename "$REG" | cut -d. -f1)
N7=$(git -C "$REPO" rev-parse --short=7 "$NEWBASE") || { echo "unknown base $NEWBASE"; exit 2; }
BR="vp/$RUN-on-$N7"; WT=$(mktemp -d "${TMPDIR:-/tmp}/prepare-variant-XXXXXX")
REPORT="$OUT/$RUN.$N7.variant-report.txt"; : > "$REPORT"
log() { echo "$*" | tee -a "$REPORT"; }
cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1; }
trap cleanup EXIT
git -C "$REPO" rev-parse --verify -q "$BR" >/dev/null && { log "REFUSED: branch $BR exists"; exit 2; }
git -C "$REPO" worktree add -q -b "$BR" "$WT" "$NEWBASE" || exit 2
log "variant prep $RUN: $OLDBASE..$SRC onto $N7 ($(date -u +%FT%TZ))"
( cd "$WT/bots" && { npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null 2>&1; } )
nundef() { ( cd "$WT/bots" && npx eslint src/*.mjs 2>&1 | grep -c "no-undef" ); }
U0=$(nundef); log "no-undef errors on the new base itself: $U0"
N=$(git -C "$REPO" rev-list --count "$OLDBASE..$SRC")
log "commits to carry: $N"
if ! git -C "$WT" -c user.email=variant-prep@local -c user.name=variant-prep cherry-pick -x "$OLDBASE..$SRC" >>"$REPORT" 2>&1; then
  git -C "$WT" cherry-pick --abort >/dev/null 2>&1
  git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1; git -C "$REPO" branch -D "$BR" >/dev/null 2>&1
  log "RESULT: CONFLICT -- not prepared; this variant needs a reviewed rebase"; exit 3
fi
HEAD=$(git -C "$WT" rev-parse HEAD)
RD=$(git -C "$REPO" range-diff "$OLDBASE..$SRC" "$NEWBASE..$HEAD" 2>&1)
log "--- range-diff"; log "$RD"
CHANGED=$(echo "$RD" | grep -cvE '^[0-9]+: +[0-9a-f]+ = ' || true)
RDV=$([ "$CHANGED" = 0 ] && echo "identical patches" || echo "CHANGED patches ($CHANGED line(s)): review the differences")
log "range-diff verdict: $RDV"
( cd "$WT/bots" && npm test > "$WT/.npmtest.out" 2>&1; echo $? > "$WT/.npmtest.rc" )
TRC=$(cat "$WT/.npmtest.rc"); log "--- npm test (exit $TRC)"; tail -5 "$WT/.npmtest.out" | tee -a "$REPORT"
U1=$(nundef); LRC=$([ "$U1" -le "$U0" ] && echo 0 || echo 1)
log "--- eslint no-undef: $U1 on the variant vs $U0 on its base (exit $LRC: 1 = the variant ADDS an undefined name)"
( cd "$WT/bots" && npx eslint src/*.mjs 2>&1 | grep "no-undef" | head -10 ) | tee -a "$REPORT"
python3 - "$REG" "$OUT/$RUN.$N7.json" "$HEAD" "$SRC" "$OLDBASE" "$NEWBASE" "$RDV" "$TRC" "$LRC" <<'PY'
import json, sys
src, dst, head, br, ob, nb, rdv, trc, lrc = sys.argv[1:]
r = json.load(open(src))
r.pop('approved', None)
r['sha'] = head[:7]
r['variant_prep'] = {'source_branch': br, 'source_base': ob, 'new_base': nb, 'head': head, 'range_diff': rdv,
                     'npm_test_exit': int(trc), 'no_undef_exit': int(lrc),
                     'NOT_APPROVED': 'mechanical preparation only: a reviewer must add "approved" before queue add'}
json.dump(r, open(dst, 'w'), indent=1)
print('wrote', dst)
PY
log "RESULT: prepared $BR @ ${HEAD:0:7}; tests exit $TRC, lint exit $LRC; range-diff: $RDV. NOT APPROVED."
[ "$TRC" = 0 ] && [ "$LRC" = 0 ] || exit 4
