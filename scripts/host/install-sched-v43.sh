#!/bin/bash
# install-sched-v43.sh [--dry-run | --wait | --rollback <STAMP>] -- canary-sched.py v43 on the bots host (10.0.0.31).
# OWNER 2026-11-12 "lets do the rebase, and get things where we dont keep getting stalled".
#
# v43 = the installed v42 (md5 684ca0f3) plus:
#   - effectfix-01 (11-07, on main since 086b0a55, reviewed then, never installed): `queue add` / add-variant run
#     `effectwatch.py validate` on a registration's effect field; only an explicit INVALID refuses.
#   - the autorebase accepts a rebased diff whose added and removed lines are the reviewed ones when ONLY context lines
#     of a path list differ (CONTEXT_FREE_PATHS: the required-paths list every change appends a line to).
#   - two more skippable block kinds: no patch source (H2), a stale staged registration of a run that never deployed (H3).
# ONLY ~/canary-sched.py is replaced. canary-loop.sh, verdict.py, funread.py, the gate bundle, the queue, the crontab and
# every state file are untouched; no state format changes, so a queued variant, a hold and a finished job read as before.
# BETWEEN CANARIES ONLY (install-hold + flock -n /tmp/mcai-canary.lock), and never while an autorebase build is in flight.
#
# STAGE (Mac):  git archive <sha> scripts/host scripts/lib | ssh mike@10.0.0.31 'rm -rf ~/sched43-install/src && mkdir -p ~/sched43-install/src && tar -x -C ~/sched43-install/src'
# THEN (.31):   bash ~/sched43-install/src/scripts/host/install-sched-v43.sh --dry-run
#               nohup bash ~/sched43-install/src/scripts/host/install-sched-v43.sh --wait > ~/sched43-install/wait.log 2>&1 &
# ROLLBACK:     bash ~/sched43-install/src/scripts/host/install-sched-v43.sh --rollback <STAMP>   (between canaries)
#               v42 reads everything v43 writes; an entry v43 skipped as no-patch / stale-registration blocks the head again.
set -u
H=/home/mike; SRC=$(cd "$(dirname "$0")/../.." && pwd); S=$SRC/scripts/host; MAN=/srv/mcbots/trial-manifest.json
BK=$H/sched43-install
SCHED_BASE=684ca0f3d070ece78327714b533d4542
die() { echo "REFUSED: $*"; [ -n "${HELD:-}" ] && python3 $H/canary-sched.py install-release >/dev/null 2>&1; exit 2; }
say() { echo "== $(date -u +%FT%TZ) $*"; }
m5() { md5sum < "$1" | cut -c1-32; }

between() {   # prints why not, returns 1; silent 0 when between canaries
  local L; L=$(ps -eo pid,args | awk '$2=="bash" && $3 ~ /canary-loop\.sh$/ {print}')
  [ -z "$L" ] || { echo "a canary loop runs: $L"; return 1; }
  python3 -c "import json,sys; m=json.load(open('$MAN')); sys.exit(1 if (m.get('canary_pool') or m.get('canary_code_version')) else 0)" \
    || { echo "a canary is declared in $MAN"; return 1; }
  ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf >/dev/null 2>&1 && { echo "canary drop-ins exist"; return 1; }
  return 0
}
ar_running() {   # an autorebase build in flight keeps its scheduler file: LIVE = starting/running, heartbeat within 20 min
  python3 - "$H/autorebase/jobs" <<'EOF'
import datetime as dt, glob, json, os, sys
now = dt.datetime.now(dt.timezone.utc)
for p in glob.glob(os.path.join(sys.argv[1], '*.json')):
    try:
        j = json.load(open(p))
        hb = dt.datetime.fromisoformat(str(j.get('hb') or j.get('at')).replace('Z', '+00:00'))
    except Exception:
        hb = None
    if j.get('state') in ('starting', 'running') and (hb is None or (now - hb).total_seconds() <= 20 * 60):
        print(os.path.basename(p)); sys.exit(1)
EOF
}
put() { cp "$1" "$2.new" && chmod "$3" "$2.new" && mv "$2.new" "$2" && cmp -s "$1" "$2"; }   # tmp + rename, then byte-compare
restore() { cp -p "$BK/backup-$1/canary-sched.py" $H/canary-sched.py.rb && mv $H/canary-sched.py.rb $H/canary-sched.py; }

if [ "${1:-}" = "--rollback" ]; then
  ST=${2:?usage: --rollback <STAMP>}; [ -f "$BK/backup-$ST/canary-sched.py" ] || die "no $BK/backup-$ST/canary-sched.py"
  W=$(between) || die "$W"
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  restore "$ST" || die "restore failed"
  say "restored canary-sched.py $(m5 $H/canary-sched.py | cut -c1-8)"
  exit 0
fi
MODE=install; [ "${1:-}" = "--dry-run" ] && MODE=dry; [ "${1:-}" = "--wait" ] && MODE=wait
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say "1. staged files"
for f in "$S/canary-sched.py" "$S/test_canary_sched.py" "$S/test_autorebase.py" "$SRC/scripts/lib/protected.py"; do
  [ -f "$f" ] || die "staged $f missing"
done
[ "$(m5 $H/canary-sched.py)" = "$SCHED_BASE" ] || [ "$(m5 $H/canary-sched.py)" = "$(m5 $S/canary-sched.py)" ] \
  || die "live canary-sched.py is not v42 ($SCHED_BASE): re-merge"
python3 -m py_compile "$S/canary-sched.py" || die "does not compile"

say "2. tests (staging, nice 10)"
mkdir -p $BK
for t in "$S/test_canary_sched.py" "$S/test_autorebase.py"; do
  o=$BK/$(basename $t .py).out
  nice -n 10 python3 -B "$t" > $o 2>&1 || { tail -15 $o; die "$(basename $t) failed"; }
  tail -1 $o
done

if [ $MODE = dry ]; then
  W=$(between) && say "dry run: between canaries now" || say "dry run: NOT between canaries ($W)"
  J=$(ar_running) || say "dry run: an autorebase build is in flight ($J)"
  say "dry run: would install canary-sched.py $(m5 $S/canary-sched.py | cut -c1-8) over $(m5 $H/canary-sched.py | cut -c1-8) between canaries"
  exit 0
fi

if [ $MODE = wait ]; then
  say "waiting for the slot to be free and no autorebase build in flight (polls every 20 s)"
  while ! W=$(between) || ! J=$(ar_running); do sleep 20; done
fi

say "3. install-hold + loop lock"
W=$(between) || die "$W"
J=$(ar_running) || die "an autorebase build is in flight ($J): wait for it"
python3 $H/canary-sched.py install-hold install-sched-v43 15; RC=$?; HELD=1
for i in $(seq 1 45); do
  [ $RC -eq 0 ] && break
  sleep 20; python3 $H/canary-sched.py install-hold install-sched-v43 15 >/dev/null; RC=$?
done
[ $RC -eq 0 ] || die "the slot did not settle within 15 min of the hold"
exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
W=$(between) || die "$W"
J=$(ar_running) || die "an autorebase build is in flight ($J)"
GD0=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
python3 $H/canary-sched.py status > $BK/status-before-$STAMP.out 2>&1

say "4. backup $BK/backup-$STAMP, then install"
mkdir -p "$BK/backup-$STAMP" && cp -p $H/canary-sched.py "$BK/backup-$STAMP/" && \
  cp -p $H/canary-queue.json "$BK/backup-$STAMP/canary-queue.json" || die "backup failed"
put "$S/canary-sched.py" $H/canary-sched.py 755 || { restore $STAMP; die "the installed file differs from the staged one: rolled back"; }

say "5. verify"
T=$(python3 $H/canary-sched.py tick --no-act 2>&1); echo "$T" | tail -n 3 | cut -c1-300
if ! echo "$T" | grep -qE '(BUSY|BLOCK|WAIT|IDLE|LAUNCH|AUTOREBASE|LAUNCHING|SKIP|holds the scheduler lock)'; then
  restore $STAMP; die "tick --no-act did not decide: rolled back"
fi
python3 $H/canary-sched.py status > $BK/status-$STAMP.out 2>&1 || { restore $STAMP; die "status failed: rolled back"; }
# the same entries in the same order and states as before the swap (the queue is untouched; only the code changed)
if ! diff <(grep -v '^DECISION' $BK/status-before-$STAMP.out | awk '{print $1, $2}') <(grep -v '^DECISION' $BK/status-$STAMP.out | awk '{print $1, $2}') >/dev/null; then
  restore $STAMP; die "status lists other entries or states than before the swap: rolled back"
fi
GD1=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
[ "$GD0" = "$GD1" ] || { restore $STAMP; die "the gate digest changed ($GD0 -> $GD1): rolled back"; }
cmp -s $H/canary-queue.json "$BK/backup-$STAMP/canary-queue.json" || echo "NOTE: the queue changed during the install (another writer?)"
python3 $H/canary-sched.py install-release; HELD=""
say "done: canary-sched.py $(m5 $H/canary-sched.py | cut -c1-8) (v43); rollback stamp $STAMP"
