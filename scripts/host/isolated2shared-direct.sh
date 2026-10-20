#!/bin/bash
# isolated2shared-direct.sh -- OWNER-DIRECT isolated -> shared-town conversion (OWNER APPROVED 2026-10-20 ~12:45Z "i agree do
# it all, get it working"). Design: docs/reports/isolated-to-shared-2026-10-20.md sections 4.2, 5.2, 6.3. On 10.0.0.31 as mike,
# BETWEEN CANARIES only:
#
#   bash isolated2shared-direct.sh <owner> isolated-b                              # the pilot
#   bash isolated2shared-direct.sh <owner> isolated-a isolated-c isolated-d        # the rest (reuses + extends the hold)
#   bash isolated2shared-direct.sh --rollback <owner> <pool>...                    # any phase
#   bash isolated2shared-direct.sh --release <owner>                               # ONLY after the quiet period (refuses before)
#   options before <owner>: --quiet <min> --why "<text>" [--accept-contamination "<who decided>"]  (raise the computed quiet
#   period; LOWER it, never below 240, only with --accept-contamination: design 5.2a; journalled)
#
# THE HOLD (design 5.2) lives in isolated2sharedhold.py: the scheduler's install-hold claimed with holdtoken.py BEFORE the loop
# lock, reused and EXTENDED by a later phase, released only by --release once QUIET has passed since the LAST transition, QUIET
# recomputed at release (max of recorded and now). Every mode runs under this rollout's own lock ($D/rollout.lock), so a
# release cannot race a conversion (Codex r3 P1-1).
#
# Per pool: journal `owner-direct`; stop the 5 units; `apply` (or `rollback`); then
#   exit 0 -> restart the 5 units 12 s apart, verify all active, journal `<mode>-done`;
#   exit 2 -> the tool wrote nothing; restart ONLY if `status` shows the pool uniformly isolated or converted (an earlier
#             interrupted run may have left it mixed: Codex r3 P1-2), else leave the units stopped;
#   other  -> the tool died part-way: the units STAY STOPPED, journal `<mode>-incomplete`; re-run (apply resumes) or roll back.
set -u
H=/home/mike; J=$H/canary-journal.jsonl; RUN=isolated2shared-01
D=${I2S_DIR:-$H/isolated2shared}; TOOL=$D/isolated2shared.mjs; HOLD="python3 $D/isolated2sharedhold.py"
MODE=apply; QUIET=""; WHY=""; ACCEPT=""; ACCEPT_ROW=""
while [ $# -gt 0 ]; do case "$1" in
  --rollback) MODE=rollback; shift;; --release) MODE=release; shift;;
  --accept-contamination) ACCEPT=${2:-}; shift 2;;
  --quiet) QUIET=${2:-}; shift 2;; --why) WHY=${2:-}; shift 2;; *) break;; esac; done
[ $# -ge 1 ] || { echo "usage: $0 [--rollback|--release] [--quiet <min> --why <text> [--accept-contamination <who decided>]] <owner> [<pool>...]"; exit 2; }
OWNER=$1; shift; POOLS="$*"
[ "$MODE" = release ] || [ -n "$POOLS" ] || { echo "name at least one pool"; exit 2; }
for p in $POOLS; do case "$p" in isolated-a|isolated-b|isolated-c|isolated-d) ;; *) echo "not an isolated pool: $p"; exit 2;; esac; done
if [ -n "$QUIET" ]; then case "$QUIET" in *[!0-9]*) echo "--quiet must be minutes"; exit 2;; esac; [ -n "$WHY" ] || { echo "--quiet needs --why"; exit 2; }; fi
# journal <phase> <note> [<pool>]: the pool is a FIELD, so reconciliation is per pool (Codex r5 P2-2)
journal() { printf '{"ts":"%s","run":"%s","phase":"%s","note":%s%s}\n' "$(date -u +%FT%TZ)" "$RUN" "$1" "$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$2")" "${3:+,\"pool\":\"$3\"}" >> $J; }
units() { for b in Alpha Bravo Comet Delta Echo; do echo "mcbot@$1-$b"; done; }
# RESTART, not start: a unit something else started meanwhile (fleet-recycle restarts every unit, stopped ones included) is
# restarted onto the new env too, never left running the old one
start_staggered() { for u in $(units "$1"); do sudo systemctl restart "$u"; sleep 12; done; }
all_active() { local bad=""; for u in $(units "$1"); do systemctl is-active --quiet "$u" || bad="$bad $u"; done; [ -z "$bad" ] || { echo "NOT ACTIVE:$bad"; return 1; }; }
# UNIFORM = every env isolated or every env converted, AND no rollback under way (a half rollback with uniform env lines can
# still hold stale journals: Codex r4 P2-3)
uniform() { local s; s=$(sudo node "$TOOL" status --pool "$1" 2>&1); echo "$s" | grep -q -E "^$1: env (isolated|converted) " && ! echo "$s" | grep -q "ROLLBACK STARTED"; }
# fleet-recycle.timer restarts EVERY unit (a stopped one too) every 6 h and takes no lock: never overlap it
recycle_clear() {
  systemctl is-active --quiet fleet-recycle.service && { echo "REFUSED: fleet-recycle is running now"; return 1; }
  # a monotonic timer: NextElapseUSecRealtime is empty, so read the NEXT column of list-timers ("Tue 2026-10-20 13:31:17 UTC")
  local next; next=$(systemctl list-timers --all --no-legend fleet-recycle.timer 2>/dev/null | awk '{print $1, $2, $3, $4}')
  [ -n "$next" ] || { echo "REFUSED: fleet-recycle.timer's next run is unknown"; return 1; }
  local at; at=$(date -d "$next" +%s 2>/dev/null) || { echo "REFUSED: cannot read fleet-recycle.timer's next run ('$next')"; return 1; }
  local left=$(( at - $(date +%s) ))
  [ "$left" -gt 1800 ] || [ "$left" -lt -60 ] || { echo "REFUSED: fleet-recycle.timer fires in $left s (needs > 30 min of clear time)"; return 1; }
}

# THIS ROLLOUT'S OWN LOCK, every mode (release included)
mkdir -p "$D"; exec 7>"$D/rollout.lock"; flock -n 7 || { echo "REFUSED: another isolated2shared run holds $D/rollout.lock"; exit 2; }

# QUIET: computed now; --quiet can only RAISE it unless the computation fails (then it is the bound, with its --why)
CQ=$($HOLD quiet 2>&1); crc=$?
if [ $crc -eq 0 ]; then
  # BELOW the computed value only as an explicit, journalled decision (design 5.2: the 240-min floor stays -- it is the pilot's
  # tripwire + rollback window and the tier-2 +180 read's PRE)
  [ -z "$QUIET" ] || [ "$QUIET" -ge "$CQ" ] || [ -n "$ACCEPT" ] || { echo "REFUSED: --quiet $QUIET is below the computed $CQ (pass --accept-contamination \"<who decided, why>\" to take the shorter hold)"; exit 2; }
  [ -z "$ACCEPT" ] || WHY="$WHY; ACCEPTED CONTAMINATION below computed $CQ: $ACCEPT"
  # a DEDICATED row (Claude r6 P3-2), so the reader of a later +360/+720 read finds the decision without remembering it
  [ -z "$ACCEPT" ] || [ "$QUIET" -ge "$CQ" ] || ACCEPT_ROW="quiet $QUIET below computed $CQ, accepted by: $ACCEPT; reads beyond +$((QUIET - 60)) of the next canaries may hold the switch in their PRE"
  QUIET=${QUIET:-$CQ}
elif [ -z "$QUIET" ] && [ "$MODE" = rollback ] && RQ=$(python3 -c "import json,sys; print(int(json.load(open(sys.argv[1]))['quiet_min']))" "$D/HOLD.json" 2>/dev/null); then
  QUIET=$RQ; WHY="computation failed ($CQ): the recorded quiet period"     # a rollback is never a dead end (Claude r3 P3-6); a release is (Codex r4 P2-1)
elif [ -z "$QUIET" ]; then
  echo "REFUSED: the quiet period cannot be computed ($CQ): pass --quiet <min> --why <text>"; exit 2
fi
[ "$QUIET" -ge 240 ] || QUIET=240

if [ "$MODE" = release ]; then
  out=$($HOLD release "$OWNER" "$QUIET" 2>&1); rc=$?; echo "$out"
  [ $rc -eq 0 ] && journal hold-released "by $OWNER (quiet $QUIET; ${WHY:-computed}): $out"
  exit $rc
fi

recycle_clear || exit 2
[ -z "$ACCEPT_ROW" ] || journal contamination-accepted "$ACCEPT_ROW; pools $POOLS; mode $MODE"
# 1. THE HOLD FIRST (claimed, or reused and extended), then the loop lock
out=$($HOLD claim "$OWNER" "$QUIET" 2>&1); rc=$?; echo "$out"
[ $rc -eq 0 ] || { echo "REFUSED: no hold"; exit 2; }
case "$out" in *CLAIMED*) CLAIMED=1;; *) CLAIMED="";; esac
DONE=0
drop_if_unused() { [ -n "$CLAIMED" ] && [ $DONE -eq 0 ] && $HOLD drop; }
exec 9>/tmp/mcai-canary.lock; flock -n 9 || { echo "REFUSED: /tmp/mcai-canary.lock is held"; drop_if_unused; exit 2; }
if [ "$MODE" = apply ]; then
  for p in $POOLS; do
    out=$(sudo node "$TOOL" plan --pool "$p" 2>&1); rc=$?
    printf '%s\n' "$out" | tee -a $H/digest/isolated2shared.log
    [ $rc -eq 0 ] || { echo "REFUSED: plan for $p does not seed cleanly (read it above); nothing changed"; drop_if_unused; exit 2; }
  done
fi
for p in $POOLS; do
  recycle_clear || { echo "stopping before $p (nothing done for it)"; drop_if_unused; exit 2; }
  T0=$(date -u +%FT%TZ)
  journal owner-direct "$MODE $p: stop 5 units $T0, $MODE, restart 12 s apart; OWNER 2026-10-20 'i agree do it all, get it working'; by $OWNER, quiet $QUIET min (${WHY:-computed})" "$p"
  sudo systemctl stop $(units "$p")
  out=$(sudo env I2S_UNDER_LOCK=1 node "$TOOL" "$MODE" --pool "$p" 2>&1); rc=$?
  printf '%s\n' "$out" | tee -a $H/digest/isolated2shared.log
  if [ $rc -eq 2 ]; then
    if uniform "$p"; then
      echo "REFUSED: $MODE $p wrote nothing; the pool is uniform; restarting its units"; start_staggered "$p"
      # SAFE only once every unit is verified active (Codex r6 P2-1): a failed restart is UNSAFE
      if all_active "$p"; then journal "$MODE-refused" "$p: $MODE refused (nothing written); units restarted" "$p"
      else journal "$MODE-blocked" "$p: $MODE refused; the restart did not bring every unit up" "$p"; fi
    else
      echo "REFUSED: $MODE $p wrote nothing, but the pool is NOT uniform (an earlier interrupted run): units LEFT STOPPED"
      journal "$MODE-blocked" "$p: $MODE refused; pool not uniform or mid-rollback; units LEFT STOPPED" "$p"
    fi
    drop_if_unused; exit 3
  elif [ $rc -ne 0 ]; then
    DONE=$((DONE + 1))
    ST=$(sudo node "$TOOL" status --pool "$p" 2>&1 | head -1)
    journal "$MODE-incomplete" "$p: $MODE exited $rc part-way; units LEFT STOPPED; $ST" "$p"
    echo "INCOMPLETE: $MODE $p exited $rc. The five units are LEFT STOPPED. Status: $ST"
    echo "  re-run this command (apply resumes from its marker) or: bash $0 --rollback $OWNER $p"; exit 4
  fi
  DONE=$((DONE + 1))
  start_staggered "$p"
  if ! all_active "$p"; then journal "$MODE-incomplete" "$p: $MODE done but not every unit is active after the restart" "$p"; echo "units not active: see systemctl status"; exit 5; fi
  journal "$MODE-done" "$p since $T0; quiet >= $QUIET min after the last transition; tripwire: cd $D && nice -n 19 python3 isolated2sharedtrip.py --since $T0 --pools $p" "$p"
  echo "DONE $MODE $p since $T0"
  echo "  tripwire (+15, +60, +180 min):  cd $D && nice -n 19 python3 isolated2sharedtrip.py --since $T0 --pools $p"
done
echo "THE HOLD STAYS (it is the analysis guard): bash $0 --release $OWNER  (refuses until the last transition + $QUIET min)"
