#!/bin/bash
# install-autorebase.sh [--dry-run | --wait | --rollback <STAMP>] -- canary-sched.py v39 (AUTOREBASE) on the bots host
# (10.0.0.31), BETWEEN CANARIES ONLY. Reviews: Codex + Claude (tooling tier), see the commit.
#
# WHAT IT INSTALLS
#   ~/canary-sched.py                        v37 (md5 2e9339e9) -> v39: queue set-patch / add-variant, autorebase-build /
#                                            -clear, the H2 autorebase wait. Atomic rename. The cron line is unchanged.
#   ~/stallcheck/app/scripts/host/stallcheck.py   detector c: an entry with a patch source is not "dead" until its
#                                            autorebase refuses. Atomic rename.
#   ~/autorebase/{jobs,logs,push,work}, ~/autorebase/repo.git (a bare https clone; the Mac relay fetches from it)
# Nothing else: canary-loop.sh, verdict.py and the gate bundle are untouched (gate digest checked before and after).
# The Mac side (push relay): cp scripts/host/autorebase-relay.sh ~/bin/ && bash ~/bin/autorebase-relay.sh --install-launchd
#
# STAGE (Mac):  git archive <sha> | ssh mike@10.0.0.31 'rm -rf ~/ar-install/src && mkdir -p ~/ar-install/src && tar -x -C ~/ar-install/src'
# THEN (.31):   bash ~/ar-install/src/scripts/host/install-autorebase.sh --dry-run
#               bash ~/ar-install/src/scripts/host/install-autorebase.sh --wait   (polls until the slot is free, then installs)
# ROLLBACK:     bash ~/ar-install/src/scripts/host/install-autorebase.sh --rollback <STAMP>   (between canaries)
set -u
H=/home/mike; SRC=$(cd "$(dirname "$0")/../.." && pwd); S=$SRC/scripts/host; MAN=/srv/mcbots/trial-manifest.json
BK=$H/ar-install
BASE_MD5=2e9339e9cdb0245183e22d730b94a4fc
SC=$H/stallcheck/app/scripts/host/stallcheck.py
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

if [ "${1:-}" = "--rollback" ]; then
  ST=${2:?usage: --rollback <STAMP>}; B=$BK/backup-$ST; [ -f "$B/canary-sched.py" ] || die "no backup $B"
  W=$(between) || die "$W"
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  cp -p "$B/canary-sched.py" $H/canary-sched.py.rb && mv $H/canary-sched.py.rb $H/canary-sched.py
  [ -f "$B/stallcheck.py" ] && cp -p "$B/stallcheck.py" $SC.rb && mv $SC.rb $SC
  say "restored canary-sched.py ($(md5sum < $H/canary-sched.py | cut -c1-8)) and stallcheck.py; ~/autorebase is left (inert)"
  say "queued entries keep their 'patch' field: v37 ignores it"
  exit 0
fi
MODE=install; [ "${1:-}" = "--dry-run" ] && MODE=dry; [ "${1:-}" = "--wait" ] && MODE=wait
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say "1. staged files"
for f in canary-sched.py test_canary_sched.py test_autorebase.py stallcheck.py test_stallcheck.py autorebase-relay.sh; do
  [ -f "$S/$f" ] || die "staged $f missing"
done
[ "$(md5sum < $H/canary-sched.py | cut -c1-32)" = "$BASE_MD5" ] || die "live canary-sched.py is not v37 ($BASE_MD5): re-merge"
[ -f "$SC" ] || die "no installed $SC"
python3 -m py_compile "$S/canary-sched.py" || die "canary-sched.py does not compile"

say "2. tests (staging)"
mkdir -p $BK
python3 -B "$S/test_canary_sched.py" > $BK/test_canary_sched.out 2>&1 || { tail -15 $BK/test_canary_sched.out; die "test_canary_sched failed"; }
tail -1 $BK/test_canary_sched.out
python3 -B "$S/test_autorebase.py" > $BK/test_autorebase.out 2>&1 || { tail -15 $BK/test_autorebase.out; die "test_autorebase failed"; }
tail -1 $BK/test_autorebase.out
python3 -B "$S/test_autorebase.py" --mutants > $BK/test_autorebase_mut.out 2>&1 || { tail -12 $BK/test_autorebase_mut.out; die "an autorebase mutant survived"; }
tail -1 $BK/test_autorebase_mut.out
python3 -B "$S/test_stallcheck.py" > $BK/test_stallcheck.out 2>&1 || { tail -15 $BK/test_stallcheck.out; die "test_stallcheck failed"; }
tail -1 $BK/test_stallcheck.out

say "3. the scratch repo (outside the hold: a clone takes a while)"
mkdir -p $H/autorebase/jobs $H/autorebase/logs $H/autorebase/push $H/autorebase/work
if [ ! -d $H/autorebase/repo.git ]; then
  git clone -q --bare https://github.com/dmille6/minecraft-ai-test.git $H/autorebase/repo.git.new && mv $H/autorebase/repo.git.new $H/autorebase/repo.git \
    || die "clone failed"
fi
git -C $H/autorebase/repo.git fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*' || die "fetch failed"
sudo -n true 2>/dev/null || die "sudo -n is not available (the build fetches into the root-owned deploy repo)"

if [ $MODE = dry ]; then
  W=$(between) && say "dry run: between canaries now" || say "dry run: NOT between canaries ($W)"
  say "dry run: would install canary-sched.py $(md5sum < $S/canary-sched.py | cut -c1-8), stallcheck.py $(md5sum < $S/stallcheck.py | cut -c1-8)"
  exit 0
fi
if [ $MODE = wait ]; then
  say "waiting for the slot to be free (polls every 20 s; takes the install-hold the moment no loop runs)"
  while ! W=$(between); do sleep 20; done
fi

say "4. install-hold + loop lock"
W=$(between) || die "$W"
python3 $H/canary-sched.py install-hold install-autorebase 20; RC=$?; HELD=1
# exit 2 = the hold is written but the slot is not settled yet (S5 restarts after a teardown): wait for it, bounded
for i in $(seq 1 90); do
  [ $RC -eq 0 ] && break
  sleep 20; python3 $H/canary-sched.py install-hold install-autorebase 20 >/dev/null; RC=$?
done
[ $RC -eq 0 ] || die "the slot did not settle within 30 min of the hold"
exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
W=$(between) || die "$W"
GD0=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)

say "5. install (backup $BK/backup-$STAMP)"
mkdir -p "$BK/backup-$STAMP" && cp -p $H/canary-sched.py "$BK/backup-$STAMP/" && cp -p $SC "$BK/backup-$STAMP/" || die "backup failed"
cp "$S/canary-sched.py" $H/canary-sched.py.new && chmod 755 $H/canary-sched.py.new && mv $H/canary-sched.py.new $H/canary-sched.py
cp "$S/stallcheck.py" $SC.new && mv $SC.new $SC
if ! cmp -s "$S/canary-sched.py" $H/canary-sched.py || ! cmp -s "$S/stallcheck.py" $SC; then
  cp -p "$BK/backup-$STAMP/canary-sched.py" $H/canary-sched.py; cp -p "$BK/backup-$STAMP/stallcheck.py" $SC
  die "installed files differ from staged: rolled back"
fi

say "6. verify"
T=$(python3 $H/canary-sched.py tick --no-act 2>&1); echo "$T" | cut -c1-300
if ! echo "$T" | grep -qE '(BUSY|BLOCK|WAIT|IDLE|LAUNCH|AUTOREBASE|LAUNCHING|holds the scheduler lock)'; then
  cp -p "$BK/backup-$STAMP/canary-sched.py" $H/canary-sched.py; cp -p "$BK/backup-$STAMP/stallcheck.py" $SC
  die "tick --no-act did not decide: rolled back"
fi
python3 $H/canary-sched.py status > $BK/status-$STAMP.out 2>&1 || { cp -p "$BK/backup-$STAMP/canary-sched.py" $H/canary-sched.py; die "status failed: rolled back"; }
GD1=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
[ "$GD0" = "$GD1" ] || echo "WARNING: gate digest output changed ($GD0 -> $GD1): check gatedigest.py before the next launch"
python3 $H/canary-sched.py install-release; HELD=""
say "done: canary-sched.py $(md5sum < $H/canary-sched.py | cut -c1-8), stallcheck.py $(md5sum < $SC | cut -c1-8); rollback stamp $STAMP"
