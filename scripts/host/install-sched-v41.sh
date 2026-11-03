#!/bin/bash
# install-sched-v41.sh [--dry-run | --wait | --rollback <STAMP>] -- canary-sched.py v41 (bundles of unrelated changes +
# the fast read plan), canary-loop.sh v39 (fun_reads plans + the bundle ledger note) and funread.py (fun_reads), on the
# bots host (10.0.0.31). OWNER 11-03 item 2. Reviews: Codex + Claude (design and blockers, two rounds), see the commits.
# ALL THREE ARE REPLACED TOGETHER, BETWEEN CANARIES ONLY (install-hold + flock -n /tmp/mcai-canary.lock), because v41's
# autorebase writes `fun_reads` into registrations that only loop v39 and the new funread.py can read; and because bash
# re-reads a running canary-loop.sh by byte offset (no loop may be running).
#
# WHAT IT INSTALLS (each by tmp + rename, each verified byte-identical to the staged file, backed up first)
#   ~/canary-sched.py                v40 (7f52a99f) -> v41
#   ~/canary-loop.sh                 v38 (bff4daa7) -> v39
#   ~/mcai-analysis/funread.py       dfccdd56 -> fun_reads
#   ~/digest/RULES-IN-FORCE.md       GATE DIGEST 971142ea (v37) -> 5de4b571 (v38): funread.py is part of the gate bundle,
#                                    so gatedigest.py refuses every launch until the new generation is registered
#                                    (found at the 11-03 install; registered by hand at 06:5xZ, now part of the install)
# Nothing else: verdict.py, the gate bundle, drawrec.sh, the queue and the crontab are untouched.
#
# STAGE (Mac):  git archive <sha> | ssh mike@10.0.0.31 'rm -rf ~/sched41-install/src && mkdir -p ~/sched41-install/src && tar -x -C ~/sched41-install/src'
# THEN (.31):   bash ~/sched41-install/src/scripts/host/install-sched-v41.sh --dry-run
#               nohup bash ~/sched41-install/src/scripts/host/install-sched-v41.sh --wait > ~/sched41-install/wait.log 2>&1 &
# ROLLBACK:     bash ~/sched41-install/src/scripts/host/install-sched-v41.sh --rollback <STAMP>   (between canaries)
#               (a queued BUNDLE entry or a `fun_reads` registration needs v41: split/cancel them before rolling back)
set -u
H=/home/mike; SRC=$(cd "$(dirname "$0")/../.." && pwd); S=$SRC/scripts/host; MAN=/srv/mcbots/trial-manifest.json
BK=$H/sched41-install
SCHED_BASE=7f52a99ffc2fb6c0cc582d6fc6957572
LOOP_BASE=bff4daa7e0423730113130517231a126
FR=$H/mcai-analysis/funread.py
FR_BASE=dfccdd568c1d39495d8302ac1a0a7d2f
RU=$H/digest/RULES-IN-FORCE.md
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
ar_running() {   # an autorebase build in flight must not have its scheduler file swapped under it
  # LIVE = starting/running with a heartbeat within 20 min (the scheduler's AR_STALE_MIN): a job that died keeps
  # state `running` forever (stuckcells-01 on e54d1cce, hb 01:16Z, seen 11-03), and must not stall the install
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
put() {   # put <staged> <live> <mode>: tmp + rename, then byte-compare
  cp "$1" "$2.new" && chmod "$3" "$2.new" && mv "$2.new" "$2" && cmp -s "$1" "$2"
}
restore() {   # restore <stamp>: every file of the backup
  local B=$BK/backup-$1
  cp -p "$B/canary-sched.py" $H/canary-sched.py.rb && mv $H/canary-sched.py.rb $H/canary-sched.py
  cp -p "$B/canary-loop.sh" $H/canary-loop.sh.rb && mv $H/canary-loop.sh.rb $H/canary-loop.sh
  cp -p "$B/funread.py" $FR.rb && mv $FR.rb $FR
  [ -f "$B/RULES-IN-FORCE.md" ] && cp -p "$B/RULES-IN-FORCE.md" $RU.rb && mv $RU.rb $RU
}

if [ "${1:-}" = "--rollback" ]; then
  ST=${2:?usage: --rollback <STAMP>}; B=$BK/backup-$ST
  for f in canary-sched.py canary-loop.sh funread.py; do [ -f "$B/$f" ] || die "no $B/$f"; done
  W=$(between) || die "$W"
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  restore "$ST"
  say "restored canary-sched.py $(m5 $H/canary-sched.py | cut -c1-8), canary-loop.sh $(m5 $H/canary-loop.sh | cut -c1-8), funread.py $(m5 $FR | cut -c1-8)"
  exit 0
fi
MODE=install; [ "${1:-}" = "--dry-run" ] && MODE=dry; [ "${1:-}" = "--wait" ] && MODE=wait
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say "1. staged files"
for f in "$S/canary-sched.py" "$S/canary-loop.sh" "$SRC/scripts/funread.py" "$S/test_canary_sched.py" "$S/test_autorebase.py" \
         "$S/test_funmode_loop.py" "$SRC/scripts/test_funread.py" "$S/servea-q.py"; do
  [ -f "$f" ] || die "staged $f missing"
done
[ "$(m5 $H/canary-sched.py)" = "$SCHED_BASE" ] || [ "$(m5 $H/canary-sched.py)" = "$(m5 $S/canary-sched.py)" ] || die "live canary-sched.py is not v40 ($SCHED_BASE): re-merge"
[ "$(m5 $H/canary-loop.sh)" = "$LOOP_BASE" ] || [ "$(m5 $H/canary-loop.sh)" = "$(m5 $S/canary-loop.sh)" ] || die "live canary-loop.sh is not v38 ($LOOP_BASE): re-merge"
[ "$(m5 $FR)" = "$FR_BASE" ] || [ "$(m5 $FR)" = "$(m5 $SRC/scripts/funread.py)" ] || die "live funread.py is not $FR_BASE: re-merge"
python3 -m py_compile "$S/canary-sched.py" "$SRC/scripts/funread.py" || die "does not compile"
bash -n "$S/canary-loop.sh" || die "canary-loop.sh does not parse"

say "2. tests (staging, nice 10)"
mkdir -p $BK
for t in "$S/test_canary_sched.py" "$S/test_autorebase.py" "$S/test_funmode_loop.py" "$SRC/scripts/test_funread.py"; do
  o=$BK/$(basename $t .py).out
  nice -n 10 python3 -B "$t" > $o 2>&1 || { tail -15 $o; die "$(basename $t) failed"; }
  tail -1 $o
done

if [ $MODE = dry ]; then
  W=$(between) && say "dry run: between canaries now" || say "dry run: NOT between canaries ($W)"
  J=$(ar_running) || say "dry run: an autorebase build is in flight ($J)"
  say "dry run: would install canary-sched.py $(m5 $S/canary-sched.py | cut -c1-8), canary-loop.sh $(m5 $S/canary-loop.sh | cut -c1-8), funread.py $(m5 $SRC/scripts/funread.py | cut -c1-8) between canaries"
  exit 0
fi

if [ $MODE = wait ]; then
  say "waiting for the slot to be free and no autorebase build in flight (polls every 20 s)"
  while ! W=$(between) || ! J=$(ar_running); do sleep 20; done
fi

say "3. install-hold + loop lock"
W=$(between) || die "$W"
J=$(ar_running) || die "an autorebase build is in flight ($J): wait for it"
python3 $H/canary-sched.py install-hold install-sched-v41 20; RC=$?; HELD=1
for i in $(seq 1 90); do
  [ $RC -eq 0 ] && break
  sleep 20; python3 $H/canary-sched.py install-hold install-sched-v41 20 >/dev/null; RC=$?
done
[ $RC -eq 0 ] || die "the slot did not settle within 30 min of the hold"
exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
W=$(between) || die "$W"
J=$(ar_running) || die "an autorebase build is in flight ($J)"
GD0=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
python3 $H/canary-sched.py tick --no-act > $BK/tick-before-$STAMP.out 2>&1
python3 $H/canary-sched.py status > $BK/status-before-$STAMP.out 2>&1

say "4. backup $BK/backup-$STAMP, then install all three"
mkdir -p "$BK/backup-$STAMP" && cp -p $H/canary-sched.py $H/canary-loop.sh $FR $RU "$BK/backup-$STAMP/" && \
  cp -p $H/canary-queue.json "$BK/backup-$STAMP/canary-queue.json" || die "backup failed"
put "$SRC/scripts/funread.py" $FR 644 && put "$S/RULES-IN-FORCE.md" $RU 644 && put "$S/canary-loop.sh" $H/canary-loop.sh 755 && \
  put "$S/canary-sched.py" $H/canary-sched.py 755 \
  || { restore $STAMP; die "an installed file differs from the staged one: rolled back"; }

say "5. verify"
T=$(python3 $H/canary-sched.py tick --no-act 2>&1); echo "$T" | cut -c1-300
if ! echo "$T" | grep -qE '(BUSY|BLOCK|WAIT|IDLE|LAUNCH|AUTOREBASE|LAUNCHING|holds the scheduler lock)'; then
  restore $STAMP; die "tick --no-act did not decide: rolled back"
fi
python3 $H/canary-sched.py status > $BK/status-$STAMP.out 2>&1 || { restore $STAMP; die "status failed: rolled back"; }
# the servea waiter parses `status`: its snapshot must still read every entry
python3 -c "
import importlib.util,sys
s=importlib.util.spec_from_file_location('q','$S/servea-q.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
e,b,d=m.parse_status(open('$BK/status-$STAMP.out').read())
o=[l.split()[0] for l in open('$BK/status-before-$STAMP.out') if m.LINE.match(l)]
sys.exit(0 if [x['run'] for x in e]==o and d else 1)" || { restore $STAMP; die "servea-q no longer parses status like before: rolled back"; }
cmp -s $H/canary-queue.json "$BK/backup-$STAMP/canary-queue.json" || echo "NOTE: the queue changed during the install (another writer?)"
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RU > $BK/gatedigest-$STAMP.out 2>&1 \
  || { cat $BK/gatedigest-$STAMP.out; restore $STAMP; die "gatedigest.py refuses the installed gate (funread.py is in its bundle): rolled back"; }
tail -1 $BK/gatedigest-$STAMP.out
python3 $H/canary-sched.py install-release; HELD=""
say "done: canary-sched.py $(m5 $H/canary-sched.py | cut -c1-8), canary-loop.sh $(m5 $H/canary-loop.sh | cut -c1-8), funread.py $(m5 $FR | cut -c1-8); rollback stamp $STAMP"
