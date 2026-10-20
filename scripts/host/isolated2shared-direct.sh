#!/bin/bash
# isolated2shared-direct.sh -- OWNER-DIRECT isolated -> shared-town conversion (OWNER APPROVED 2026-10-20 ~12:45Z "i agree do
# it all, get it working"). Design: docs/reports/isolated-to-shared-2026-10-20.md sections 4.2, 5.2, 6.3. On 10.0.0.31 as mike,
# BETWEEN CANARIES only:
#
#   bash isolated2shared-direct.sh <owner> isolated-b                              # the pilot
#   bash isolated2shared-direct.sh <owner> isolated-a isolated-c isolated-d        # the rest (reuses the pilot's hold)
#   bash isolated2shared-direct.sh --rollback <owner> <pool>...                    # any phase
#   bash isolated2shared-direct.sh --release <owner>                               # ONLY after the quiet period (refuses before)
#   options before <owner>: --quiet <min> --why "<text>"   (override the computed quiet period; journalled)
#
# THE HOLD (design 5.2): the scheduler's install-hold, claimed with holdtoken.py (the scheduler's own slot checks, under its
# tick lock; refused if any other hold exists) BEFORE the loop lock (canary-sched counts a held loop lock as a busy slot).
# It is NOT released on exit: it is the analysis guard. `--release` releases it only once QUIET minutes have passed since
# the LAST transition (apply-done / rollback-done / apply-incomplete in the journal), QUIET = the longest read minute of
# every ready queue entry's registrations + 60 (fail closed: no readable registration -> refuse unless --quiet is given).
# An expired hold BLOCKS the scheduler (S8 stale) until released -- by design.
#
# Per pool: journal `owner-direct`; stop the 5 units; `apply` (or `rollback`); then
#   exit 0 -> restart the 5 units 12 s apart, verify all active, journal `<mode>-done` with the not-before time;
#   exit 2 -> a clean REFUSAL (nothing written): restart them unchanged, stop;
#   other  -> the tool died part-way: the units STAY STOPPED (a mixed pool is worse than five idle bots), journal
#             `<mode>-incomplete`, print status; the operator re-runs (apply resumes) or rolls back.
set -u
H=/home/mike; J=$H/canary-journal.jsonl; RUN=isolated2shared-01
D=${I2S_DIR:-$H/isolated2shared}; TOOL=$D/isolated2shared.mjs; HOLDF=$D/HOLD.json
HT=${HOLDTOKEN:-$H/gate-v36/holdtoken.py}
MODE=apply; QUIET=""; WHY=""
while [ $# -gt 0 ]; do case "$1" in
  --rollback) MODE=rollback; shift;; --release) MODE=release; shift;;
  --quiet) QUIET=$2; shift 2;; --why) WHY=$2; shift 2;; *) break;; esac; done
[ $# -ge 1 ] || { echo "usage: $0 [--rollback|--release] [--quiet <min> --why <text>] <owner> [<pool>...]"; exit 2; }
OWNER=$1; shift; POOLS="$*"
[ "$MODE" = release ] || [ -n "$POOLS" ] || { echo "name at least one pool"; exit 2; }
for p in $POOLS; do case "$p" in isolated-a|isolated-b|isolated-c|isolated-d) ;; *) echo "not an isolated pool: $p"; exit 2;; esac; done
[ -z "$QUIET" ] || { case "$QUIET" in *[!0-9]*) echo "--quiet must be minutes"; exit 2;; esac; [ -n "$WHY" ] || { echo "--quiet needs --why"; exit 2; }; }
[ -f "$HT" ] || { echo "REFUSED: holdtoken.py not found at $HT (set HOLDTOKEN=)"; exit 2; }
journal() { printf '{"ts":"%s","run":"%s","phase":"%s","note":%s}\n' "$(date -u +%FT%TZ)" "$RUN" "$1" "$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$2")" >> $J; }
units() { for b in Alpha Bravo Comet Delta Echo; do echo "mcbot@$1-$b"; done; }
# RESTART, not start: a unit something else started meanwhile (fleet-recycle restarts every unit, stopped ones included) is
# restarted onto the new env too, never left running the old one
start_staggered() { for u in $(units "$1"); do sudo systemctl restart "$u"; sleep 12; done; }
all_active() { local bad=""; for u in $(units "$1"); do systemctl is-active --quiet "$u" || bad="$bad $u"; done; [ -z "$bad" ] || { echo "NOT ACTIVE:$bad"; return 1; }; }
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
# QUIET = max read minute over every READY queue entry's registrations + 60 (5.2), from the scheduler's own status table
computed_quiet() {
  python3 - "$H" <<'PY'
import json, subprocess, sys
H = sys.argv[1]
st = subprocess.run(['python3', H + '/canary-sched.py', 'status'], capture_output=True, text=True).stdout.splitlines()
ready = {l.split()[0] for l in st if len(l.split()) > 1 and l.split()[1] in ('ready', 'running')}
q = json.load(open(H + '/canary-queue.json'))
w = []
for e in q.get('entries', []):
    if e.get('run') not in ready:
        continue
    for v in (e.get('variants') or {}).values():
        try:
            w.append(max(int(m) for m in json.load(open(v['registration'])).get('read_minutes') or []))
        except Exception:
            pass
print(max(w) + 60 if w else '')
PY
}
last_transition() {
  python3 - "$J" "$RUN" <<'PY'
import json, sys
last = ''
for l in open(sys.argv[1]):
    try:
        r = json.loads(l)
    except Exception:
        continue
    if r.get('run') == sys.argv[2] and r.get('phase') in ('apply-done', 'rollback-done', 'apply-incomplete', 'rollback-incomplete'):
        last = max(last, r.get('ts', ''))
print(last)
PY
}
# <ISO> + <minutes> -> ISO, and "is now past it" (python: GNU date misreads "...Z + 420 minutes" as a zone offset)
plus_min() { python3 -c "import datetime as d,sys; t=d.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')) if sys.argv[1] else d.datetime.now(d.timezone.utc); print((t+d.timedelta(minutes=int(sys.argv[2]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1" "$2"; }
past() { python3 -c "import datetime as d,sys; sys.exit(0 if d.datetime.now(d.timezone.utc) >= d.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')) else 1)" "$1"; }
hold_field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ''))" "$HOLDF" "$1" 2>/dev/null; }

if [ "$MODE" = release ]; then
  [ -f "$HOLDF" ] || { echo "no hold recorded in $HOLDF"; exit 2; }
  TOKEN=$(hold_field token); Q=$(hold_field quiet_min); LT=$(last_transition)
  [ -n "$LT" ] || { echo "REFUSED: no transition in the journal; release by hand only if none happened: python3 $HT release $TOKEN"; exit 2; }
  NB=$(plus_min "$LT" "$Q")
  past "$NB" || { echo "REFUSED: the quiet period runs to $NB (last transition $LT + $Q min)"; exit 2; }
  python3 "$HT" release "$TOKEN" && rm -f "$HOLDF" && journal hold-released "by $OWNER; last transition $LT + $Q min = $NB" && echo "hold released"
  exit $?
fi

recycle_clear || exit 2
if [ -z "$QUIET" ]; then
  QUIET=$(computed_quiet)
  [ -n "$QUIET" ] || { echo "REFUSED: no ready queue entry with a readable registration: pass --quiet <min> --why <text>"; exit 2; }
fi
[ "$QUIET" -ge 240 ] || QUIET=240     # the pilot's own 180-min tripwire + 60, at least
# 1. THE HOLD FIRST (holdtoken claim), then the loop lock
if [ -f "$HOLDF" ] && [ "$(python3 "$HT" owner 2>&1)" = "$(hold_field token)" ]; then
  TOKEN=$(hold_field token); CLAIMED=""
  Q0=$(hold_field quiet_min); [ "${Q0:-0}" -ge "$QUIET" ] && QUIET=$Q0
  echo "reusing this rollout's hold $TOKEN"
else
  TOKEN="$RUN:$$:$(date +%s%N)"
  CL=$(python3 "$HT" claim "$TOKEN" $((QUIET + 60)) 2>&1) || { echo "REFUSED: install-hold not claimed: $CL"; exit 2; }
  CLAIMED=1
fi
python3 -c "import json,sys; json.dump({'token': sys.argv[1], 'quiet_min': int(sys.argv[2]), 'owner': sys.argv[3], 'why': sys.argv[4]}, open(sys.argv[5], 'w'))" "$TOKEN" "$QUIET" "$OWNER" "${WHY:-computed}" "$HOLDF"
release_unused() { [ -n "$CLAIMED" ] && python3 "$HT" release "$TOKEN" >/dev/null 2>&1 && rm -f "$HOLDF"; }
exec 9>/tmp/mcai-canary.lock; flock -n 9 || { echo "REFUSED: /tmp/mcai-canary.lock is held"; release_unused; exit 2; }
if [ "$MODE" = apply ]; then
  for p in $POOLS; do
    out=$(sudo node "$TOOL" plan --pool "$p" 2>&1); rc=$?
    printf '%s\n' "$out" | tee -a $H/digest/isolated2shared.log
    [ $rc -eq 0 ] || { echo "REFUSED: plan for $p does not seed cleanly (read it above); nothing changed"; release_unused; exit 2; }
  done
fi
for p in $POOLS; do
  recycle_clear || { echo "stopping before $p (nothing done for it)"; exit 2; }
  T0=$(date -u +%FT%TZ)
  journal owner-direct "$MODE $p: stop 5 units $T0, $MODE, restart 12 s apart; OWNER 2026-10-20 'i agree do it all, get it working'; hold $TOKEN by $OWNER, quiet $QUIET min (${WHY:-computed})"
  sudo systemctl stop $(units "$p")
  out=$(sudo env I2S_UNDER_LOCK=1 node "$TOOL" "$MODE" --pool "$p" 2>&1); rc=$?
  printf '%s\n' "$out" | tee -a $H/digest/isolated2shared.log
  if [ $rc -eq 2 ]; then
    echo "REFUSED: $MODE $p wrote nothing; restarting its units unchanged"; start_staggered "$p"
    journal "$MODE-refused" "$p: $MODE refused (nothing written); units restarted unchanged"; exit 3
  elif [ $rc -ne 0 ]; then
    ST=$(sudo node "$TOOL" status --pool "$p" 2>&1 | head -1)
    journal "$MODE-incomplete" "$p: $MODE exited $rc part-way; units LEFT STOPPED; $ST"
    echo "INCOMPLETE: $MODE $p exited $rc. The five units are LEFT STOPPED. Status: $ST"
    echo "  re-run this command (apply resumes from its marker) or: bash $0 --rollback $OWNER $p"; exit 4
  fi
  start_staggered "$p"
  if ! all_active "$p"; then journal "$MODE-incomplete" "$p: $MODE done but not every unit is active after the restart"; echo "units not active: see systemctl status"; exit 5; fi
  NB=$(plus_min "" "$QUIET")
  journal "$MODE-done" "$p since $T0; quiet until >= $NB; tripwire: cd $D && nice -n 19 python3 isolated2sharedtrip.py --since $T0 --pools $p"
  echo "DONE $MODE $p since $T0"
  echo "  tripwire (+15, +60, +180 min):  cd $D && nice -n 19 python3 isolated2sharedtrip.py --since $T0 --pools $p"
done
echo "THE HOLD STAYS (it is the analysis guard). Not before $(plus_min "" "$QUIET"): bash $0 --release $OWNER"
