#!/bin/bash
# isolated2shared-direct.sh [--rollback] <owner> <hold-minutes> <pool> [<pool>...]
# OWNER-DIRECT isolated -> shared-town conversion (OWNER APPROVED 2026-10-20 ~12:45Z "i agree do it all, get it working").
# Design: docs/reports/isolated-to-shared-2026-10-20.md section 6.3. Run on 10.0.0.31 as mike, BETWEEN CANARIES only:
#
#   bash ~/isolated2shared/isolated2shared-direct.sh <owner> 240 isolated-b                          # the pilot
#   bash ~/isolated2shared/isolated2shared-direct.sh <owner> <W+60> isolated-a isolated-c isolated-d   # the rest
#   bash ~/isolated2shared/isolated2shared-direct.sh --rollback <owner> <W+60> <pool>...              # any phase
#
# Per run: the loop lock (flock -n /tmp/mcai-canary.lock) for the whole run; `canary-sched.py install-hold <owner> <minutes>`
# (refuses unless the slot is free; the hold then stays until it expires or `install-release` -- the tripwire window and
# the post-conversion quiet period are THAT hold); a clean `plan` for every pool first; then per pool: journal row, stop the
# five units, `apply` (or `rollback`), start the five units 12 s apart, journal row. A refused apply starts the units back on
# their unchanged env. It never touches the manifest, the queue, the world or any other pool.
set -u
H=/home/mike; J=$H/canary-journal.jsonl; RUN=isolated2shared-01
D=${I2S_DIR:-$H/isolated2shared}; TOOL=$D/isolated2shared.mjs
MODE=apply; [ "${1:-}" = "--rollback" ] && { MODE=rollback; shift; }
[ $# -ge 3 ] || { echo "usage: $0 [--rollback] <owner> <hold-minutes> <pool>..."; exit 2; }
OWNER=$1; HOLD=$2; shift 2; POOLS="$*"
case "$HOLD" in ''|*[!0-9]*) echo "hold-minutes must be an integer"; exit 2;; esac
for p in $POOLS; do case "$p" in isolated-a|isolated-b|isolated-c|isolated-d) ;; *) echo "not an isolated pool: $p"; exit 2;; esac; done
journal() { printf '{"ts":"%s","run":"%s","phase":"%s","note":%s}\n' "$(date -u +%FT%TZ)" "$RUN" "$1" "$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$2")" >> $J; }
units() { for b in Alpha Bravo Comet Delta Echo; do echo "mcbot@$1-$b"; done; }
start_staggered() { for u in $(units "$1"); do sudo systemctl start "$u"; sleep 12; done; }

exec 9>/tmp/mcai-canary.lock; flock -n 9 || { echo "REFUSED: /tmp/mcai-canary.lock is held (a canary loop, a deploy or an installer)"; exit 2; }
python3 $H/canary-sched.py install-hold "$OWNER" "$HOLD"; rc=$?
if [ $rc -ne 0 ]; then echo "REFUSED: the slot is not free (install-hold exit $rc); releasing the hold"; python3 $H/canary-sched.py install-release; exit 2; fi
if [ $MODE = apply ]; then
  for p in $POOLS; do
    out=$(sudo node "$TOOL" plan --pool "$p" 2>&1); rc=$?
    printf '%s\n' "$out" | tee -a $H/digest/isolated2shared.log
    [ $rc -eq 0 ] || { echo "REFUSED: plan for $p does not seed cleanly (read it above); nothing changed"; python3 $H/canary-sched.py install-release; exit 2; }
  done
fi
for p in $POOLS; do
  T0=$(date -u +%FT%TZ)
  journal owner-direct "$MODE $p: stop 5 units $T0, $MODE, start 12 s apart; OWNER 2026-10-20 'i agree do it all, get it working'; hold $HOLD min by $OWNER"
  sudo systemctl stop $(units "$p")
  out=$(sudo env I2S_UNDER_LOCK=1 node "$TOOL" "$MODE" --pool "$p" 2>&1); rc=$?
  printf '%s\n' "$out" | tee -a $H/digest/isolated2shared.log
  if [ $rc -ne 0 ]; then
    echo "NOT DONE: $MODE $p exited $rc (a REFUSED line above means nothing was written; anything else: read"
    echo "  'sudo node $TOOL status --pool $p', then re-run (apply resumes from its marker) or roll back). Starting its units."
    start_staggered "$p"
    journal "$MODE-refused" "$p: $MODE exited $rc; units restarted; status: $(sudo node "$TOOL" status --pool "$p" 2>&1 | head -1)"; exit 3
  fi
  start_staggered "$p"
  journal "$MODE-done" "$p since $T0: tripwire  cd $D && nice -n 19 python3 isolated2sharedtrip.py --since $T0 --pools $p"
  echo "DONE $MODE $p since $T0"
  echo "  tripwire (+15, +60, +180 min):  cd $D && nice -n 19 python3 isolated2sharedtrip.py --since $T0 --pools $p"
done
echo "The install-hold stays until it expires ($HOLD min) or: python3 $H/canary-sched.py install-release (only after the read is recorded)"
