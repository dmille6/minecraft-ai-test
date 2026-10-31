#!/bin/bash
# install-loop-v38.sh [--dry-run | --rollback <STAMP>] -- canary-loop.sh v38 for qwen35-01 (commits 3a14e639, e7cf0e86),
# on the bots host (10.0.0.31), BETWEEN CANARIES ONLY. Reviews: Codex + Claude r1 APPROVE (tooling tier).
#
# WHAT IT INSTALLS
#   ~/canary-loop.sh                 v37 (md5 2fdd0224) -> v38: the env teardown proof compares KEY=VALUE pairs, and
#                                    `poll_read` (a model-env stall guard beside the death poll). Atomic rename.
#   ~/mcai-analysis/modelread.py     NEW: the model-env read (+M, --poll). The scheduler stages /tmp/modelread.py from
#                                    here at launch (H4, reads_src) -- this script never writes /tmp.
# Nothing else. verdict.py and the gate bundle are untouched (gate digest checked before and after).
#
# STAGE (Mac):  ssh mike@10.0.0.31 'mkdir -p ~/loop38'
#               scp scripts/host/{canary-loop.sh,test_funmode_loop.py,heavyread.sh,modelread.py,test_modelread.py,\
#                   install-loop-v38.sh} mike@10.0.0.31:loop38/  && scp scripts/funread.py mike@10.0.0.31:loop38/
# THEN:         bash ~/loop38/install-loop-v38.sh --dry-run ; bash ~/loop38/install-loop-v38.sh
#               then: python3 ~/canary-sched.py queue release qwen35-01
# ROLLBACK:     bash ~/loop38/install-loop-v38.sh --rollback <STAMP>   (between canaries)
set -u
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); MAN=/srv/mcbots/trial-manifest.json
BASE_MD5=2fdd022418163f3f5a8f3f66604dd45a
die() { echo "REFUSED: $*"; [ -n "${HELD:-}" ] && python3 $H/canary-sched.py install-release >/dev/null 2>&1; exit 2; }
say() { echo "== $*"; }

between() {
  local L; L=$(ps -eo pid,args | awk '$2=="bash" && $3 ~ /canary-loop\.sh$/ {print}')
  [ -z "$L" ] || die "a canary loop runs: $L"
  python3 -c "import json,sys; m=json.load(open('$MAN')); sys.exit(1 if (m.get('canary_pool') or m.get('canary_code_version')) else 0)" \
    || die "a canary is declared in $MAN"
  ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf >/dev/null 2>&1 && die "canary drop-ins exist"
  return 0
}

if [ "${1:-}" = "--rollback" ]; then
  ST=${2:?usage: --rollback <STAMP>}; B=$S/backup-$ST; [ -f "$B/canary-loop.sh" ] || die "no backup $B"
  between; exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  cp -p "$B/canary-loop.sh" $H/canary-loop.sh.rb && mv $H/canary-loop.sh.rb $H/canary-loop.sh
  say "canary-loop.sh restored ($(md5sum < $H/canary-loop.sh | cut -c1-8)); modelread.py left in place (inert without a registration naming it)"
  exit 0
fi
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say "1. staged files"
cd "$S" || die "no staging dir"
for f in canary-loop.sh test_funmode_loop.py heavyread.sh funread.py modelread.py test_modelread.py; do [ -f "$f" ] || die "staged $f missing"; done
[ "$(md5sum < $H/canary-loop.sh | cut -c1-32)" = "$BASE_MD5" ] || die "live canary-loop.sh is not v37 ($BASE_MD5): re-merge"
cmp -s funread.py $H/mcai-analysis/funread.py || die "staged funread.py differs from the live one (the test must run the live read)"
bash -n canary-loop.sh || die "staged loop does not parse"

say "2. tests"
python3 test_funmode_loop.py > test_funmode_loop.out 2>&1 || { tail -15 test_funmode_loop.out; die "test_funmode_loop failed"; }
tail -1 test_funmode_loop.out
python3 test_modelread.py > test_modelread.out 2>&1 || { tail -15 test_modelread.out; die "test_modelread failed"; }
tail -1 test_modelread.out

if [ -n "$DRY" ]; then
  between && say "dry run: between canaries now; would install canary-loop.sh $(md5sum < canary-loop.sh | cut -c1-8) and modelread.py $(md5sum < modelread.py | cut -c1-8)"
  exit 0
fi

say "3. install-hold + loop lock"
between
python3 $H/canary-sched.py install-hold install-loop-v38 20 || die "install-hold refused (the slot is not free)"; HELD=1
exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
between
GD0=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)

say "4. install (backup $S/backup-$STAMP)"
mkdir -p "$S/backup-$STAMP" && cp -p $H/canary-loop.sh "$S/backup-$STAMP/"
cp canary-loop.sh $H/canary-loop.sh.new && chmod 755 $H/canary-loop.sh.new && mv $H/canary-loop.sh.new $H/canary-loop.sh
cp modelread.py $H/mcai-analysis/modelread.py.new && mv $H/mcai-analysis/modelread.py.new $H/mcai-analysis/modelread.py
cmp -s canary-loop.sh $H/canary-loop.sh && cmp -s modelread.py $H/mcai-analysis/modelread.py || die "installed files differ from staged"
GD1=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
[ "$GD0" = "$GD1" ] || echo "WARNING: gate digest output changed ($GD0 -> $GD1): check gatedigest.py before the next launch"
python3 $H/canary-sched.py install-release; HELD=""
say "done: canary-loop.sh $(md5sum < $H/canary-loop.sh | cut -c1-8), modelread.py $(md5sum < $H/mcai-analysis/modelread.py | cut -c1-8); rollback stamp $STAMP"
say "next: python3 ~/canary-sched.py queue release qwen35-01"
