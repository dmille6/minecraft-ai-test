#!/bin/bash
# install-autorebase-v40.sh [--dry-run | --wait | --rollback <STAMP>] -- canary-sched.py v40 (the autorebase TEST STEP
# judges host-load flakes by import closure and repeated, interleaved alone runs) + haltwatch.py's slot push, on the bots
# host (10.0.0.31). The scheduler is replaced BETWEEN CANARIES ONLY (install-hold + flock -n /tmp/mcai-canary.lock).
# Reviews: Codex + Claude (scheduler-critical tooling), see the commit.
#
# WHAT IT INSTALLS
#   ~/w5alarms/scripts/host/haltwatch.py   e871331a -> new: --label fleet also PUSHES alarmhead's '!! canary slot IDLE' /
#                                          scheduler-silent line (source slotwatch). A cron watcher, not the scheduler:
#                                          installed at once (atomic rename), no hold needed.
#   ~/canary-sched.py                      v39 (da95eb1b) -> v40. Atomic rename under the hold. The cron line is unchanged.
# Nothing else: canary-loop.sh, verdict.py, the gate bundle, alarmhead.py and the queue are untouched.
#
# STAGE (Mac):  git archive <sha> | ssh mike@10.0.0.31 'rm -rf ~/ar40-install/src && mkdir -p ~/ar40-install/src && tar -x -C ~/ar40-install/src'
# THEN (.31):   bash ~/ar40-install/src/scripts/host/install-autorebase-v40.sh --dry-run
#               nohup bash ~/ar40-install/src/scripts/host/install-autorebase-v40.sh --wait > ~/ar40-install/wait.log 2>&1 &
# ROLLBACK:     bash ~/ar40-install/src/scripts/host/install-autorebase-v40.sh --rollback <STAMP>   (between canaries)
set -u
H=/home/mike; SRC=$(cd "$(dirname "$0")/../.." && pwd); S=$SRC/scripts/host; MAN=/srv/mcbots/trial-manifest.json
BK=$H/ar40-install
BASE_MD5=da95eb1b3ccef3d1ef047723e66ef457
HW=$H/w5alarms/scripts/host/haltwatch.py
HW_BASE_MD5=e871331a206aa801c506261abafcea15
die() { echo "REFUSED: $*"; [ -n "${HELD:-}" ] && python3 $H/canary-sched.py install-release >/dev/null 2>&1; exit 2; }
say() { echo "== $(date -u +%FT%TZ) $*"; }

between() {   # prints why not, returns 1; silent 0 when between canaries
  local L; L=$(ps -eo pid,args | awk '$2=="bash" && $3 ~ /canary-loop\.sh$/ {print}')
  [ -z "$L" ] || { echo "a canary loop runs: $L"; return 1; }
  python3 -c "import json,sys; m=json.load(open('$MAN')); sys.exit(1 if (m.get('canary_pool') or m.get('canary_code_version')) else 0)" \
    || { echo "a canary is declared in $MAN"; return 1; }
  ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf >/dev/null 2>&1 && { echo "canary drop-ins exist"; return 1; }
  return 0
}
ar_running() {   # an autorebase build in flight must not have its scheduler file swapped under it
  python3 - "$H/autorebase/jobs" <<'EOF'
import glob, json, os, sys
for p in glob.glob(os.path.join(sys.argv[1], '*.json')):
    try:
        j = json.load(open(p))
    except Exception:
        continue
    if j.get('state') in ('starting', 'running'):
        print(os.path.basename(p)); sys.exit(1)
EOF
}

if [ "${1:-}" = "--rollback" ]; then
  ST=${2:?usage: --rollback <STAMP>}; B=$BK/backup-$ST; [ -f "$B/canary-sched.py" ] || die "no backup $B"
  W=$(between) || die "$W"
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  cp -p "$B/canary-sched.py" $H/canary-sched.py.rb && mv $H/canary-sched.py.rb $H/canary-sched.py
  [ -f "$B/haltwatch.py" ] && cp -p "$B/haltwatch.py" $HW.rb && mv $HW.rb $HW
  say "restored canary-sched.py ($(md5sum < $H/canary-sched.py | cut -c1-8)) and haltwatch.py ($(md5sum < $HW | cut -c1-8))"
  exit 0
fi
MODE=install; [ "${1:-}" = "--dry-run" ] && MODE=dry; [ "${1:-}" = "--wait" ] && MODE=wait
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say "1. staged files"
for f in canary-sched.py test_canary_sched.py test_autorebase.py haltwatch.py test_w5alarms.py; do
  [ -f "$S/$f" ] || die "staged $f missing"
done
[ "$(md5sum < $H/canary-sched.py | cut -c1-32)" = "$BASE_MD5" ] || die "live canary-sched.py is not v39 ($BASE_MD5): re-merge"
[ "$(md5sum < $HW | cut -c1-32)" = "$HW_BASE_MD5" ] || [ "$(md5sum < $HW | cut -c1-32)" = "$(md5sum < $S/haltwatch.py | cut -c1-32)" ] \
  || die "live $HW is neither the base ($HW_BASE_MD5) nor the staged one: re-merge"
python3 -m py_compile "$S/canary-sched.py" "$S/haltwatch.py" || die "does not compile"

say "2. tests (staging, nice 10)"
mkdir -p $BK
nice -n 10 python3 -B "$S/test_canary_sched.py" > $BK/test_canary_sched.out 2>&1 || { tail -15 $BK/test_canary_sched.out; die "test_canary_sched failed"; }
tail -1 $BK/test_canary_sched.out
nice -n 10 python3 -B "$S/test_autorebase.py" > $BK/test_autorebase.out 2>&1 || { tail -15 $BK/test_autorebase.out; die "test_autorebase failed"; }
tail -1 $BK/test_autorebase.out
nice -n 10 python3 -B "$S/test_autorebase.py" --mutants > $BK/test_autorebase_mut.out 2>&1 || { tail -12 $BK/test_autorebase_mut.out; die "an autorebase mutant survived"; }
tail -1 $BK/test_autorebase_mut.out
nice -n 10 python3 -B "$S/test_w5alarms.py" > $BK/test_w5alarms.out 2>&1 || { tail -15 $BK/test_w5alarms.out; die "test_w5alarms failed"; }
tail -1 $BK/test_w5alarms.out

if [ $MODE = dry ]; then
  W=$(between) && say "dry run: between canaries now" || say "dry run: NOT between canaries ($W)"
  J=$(ar_running) || say "dry run: an autorebase build is in flight ($J)"
  say "dry run: would install haltwatch.py $(md5sum < $S/haltwatch.py | cut -c1-8) now, canary-sched.py $(md5sum < $S/canary-sched.py | cut -c1-8) between canaries"
  exit 0
fi

say "3. haltwatch.py (the slot push): a cron watcher, installed now (backup $BK/backup-$STAMP)"
mkdir -p "$BK/backup-$STAMP" && cp -p $H/canary-sched.py "$BK/backup-$STAMP/" && cp -p $HW "$BK/backup-$STAMP/" || die "backup failed"
cp "$S/haltwatch.py" $HW.new && mv $HW.new $HW
cmp -s "$S/haltwatch.py" $HW || { cp -p "$BK/backup-$STAMP/haltwatch.py" $HW; die "installed haltwatch differs from staged: rolled back"; }
( cd $H/w5alarms/scripts && python3 -B host/haltwatch.py --label fleet --no-push --no-state ) > $BK/haltwatch-verify.out 2>&1 \
  || { cp -p "$BK/backup-$STAMP/haltwatch.py" $HW; cat $BK/haltwatch-verify.out; die "haltwatch --no-push run failed: rolled back"; }
cat $BK/haltwatch-verify.out | cut -c1-240

if [ $MODE = wait ]; then
  say "waiting for the slot to be free and no autorebase build in flight (polls every 20 s)"
  while ! W=$(between) || ! J=$(ar_running); do sleep 20; done
fi

say "4. install-hold + loop lock"
W=$(between) || die "$W"
J=$(ar_running) || die "an autorebase build is in flight ($J): wait for it"
python3 $H/canary-sched.py install-hold install-autorebase-v40 20; RC=$?; HELD=1
for i in $(seq 1 90); do
  [ $RC -eq 0 ] && break
  sleep 20; python3 $H/canary-sched.py install-hold install-autorebase-v40 20 >/dev/null; RC=$?
done
[ $RC -eq 0 ] || die "the slot did not settle within 30 min of the hold"
exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
W=$(between) || die "$W"
J=$(ar_running) || die "an autorebase build is in flight ($J)"
GD0=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)

say "5. install canary-sched.py v40"
cp "$S/canary-sched.py" $H/canary-sched.py.new && chmod 755 $H/canary-sched.py.new && mv $H/canary-sched.py.new $H/canary-sched.py
if ! cmp -s "$S/canary-sched.py" $H/canary-sched.py; then
  cp -p "$BK/backup-$STAMP/canary-sched.py" $H/canary-sched.py
  die "installed canary-sched.py differs from staged: rolled back"
fi

say "6. verify"
T=$(python3 $H/canary-sched.py tick --no-act 2>&1); echo "$T" | cut -c1-300
if ! echo "$T" | grep -qE '(BUSY|BLOCK|WAIT|IDLE|LAUNCH|AUTOREBASE|LAUNCHING|holds the scheduler lock)'; then
  cp -p "$BK/backup-$STAMP/canary-sched.py" $H/canary-sched.py
  die "tick --no-act did not decide: rolled back"
fi
python3 $H/canary-sched.py status > $BK/status-$STAMP.out 2>&1 || { cp -p "$BK/backup-$STAMP/canary-sched.py" $H/canary-sched.py; die "status failed: rolled back"; }
GD1=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
[ "$GD0" = "$GD1" ] || echo "WARNING: gate digest output changed ($GD0 -> $GD1): check gatedigest.py before the next launch"
python3 $H/canary-sched.py install-release; HELD=""
say "done: canary-sched.py $(md5sum < $H/canary-sched.py | cut -c1-8), haltwatch.py $(md5sum < $HW | cut -c1-8); rollback stamp $STAMP"
