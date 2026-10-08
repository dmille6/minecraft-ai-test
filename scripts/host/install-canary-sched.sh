#!/bin/bash
# install-canary-sched.sh [--dry-run | --rollback <STAMP>] -- install the canary SCHEDULER on the bots host (10.0.0.31),
# BETWEEN CANARIES ONLY. Design: docs/reports/canary-throughput-2026-10-08.md (Codex + Claude, six rounds, both APPROVE).
#
# WHAT IT INSTALLS
#   ~/canary-sched.py                    NEW. The scheduler (it launches nothing while the queue is empty).
#   ~/canary-queue.json                  NEW, EMPTY ({"version":1,"entries":[]}) -- only if absent.
#   ~/digest/sched-state.jsonl           three seeded `closed` rows for the September runs the journal never closed
#                                        (owner-01, digwatch-01, blindstep-02; all superseded by later fleet deploys),
#                                        agreed in design round 3 (R2) -- appended only if absent.
#   ~/mcai-analysis/drawrec.sh           PATCHED in place by patch_drawrec_exposure.py (anchored; the exposure filter
#                                        fails CLOSED on a drawexposure crash). Refuses if the anchor moved.
#   crontab                              + one line: */5 * * * * python3 ~/canary-sched.py tick >> ~/digest/sched.log
# Nothing else: canary-loop.sh, verdict.py, chain-after.sh, canarywatch.py and the gate bundle are NOT touched, so the
# gatedigest registration does not change (checked: verdict.py --gate-digest before == after).
#
# STAGE (from the repo, on the Mac):
#   ssh mike@10.0.0.31 'mkdir -p ~/sched-install'
#   scp scripts/host/{canary-sched.py,test_canary_sched.py,patch_drawrec_exposure.py,test_patch_drawrec.py,\
#       install-canary-sched.sh} mike@10.0.0.31:sched-install/
# THEN:  bash ~/sched-install/install-canary-sched.sh --dry-run
#        bash ~/sched-install/install-canary-sched.sh          (no loop, no chain/launch/install, no canary declared)
# ROLLBACK: bash ~/sched-install/install-canary-sched.sh --rollback <STAMP printed by the install>
set -u
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); MAN=/srv/mcbots/trial-manifest.json
LINE='*/5 * * * * /usr/bin/python3 /home/mike/canary-sched.py tick >> /home/mike/digest/sched.log 2>&1'
die() { echo "REFUSED: $*"; exit 2; }
say() { echo "== $*"; }

if [ "${1:-}" = "--rollback" ]; then
  ST=${2:?usage: --rollback <STAMP>}; B=$H/sched-install/backup-$ST
  [ -d "$B" ] || die "no backup $B"
  [ -n "${SCHED_ROLLBACK_LOCKED:-}" ] || { exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "the loop lock is held: roll back between canaries"; }
  [ -f "$B/crontab" ] && crontab "$B/crontab" && say "crontab restored"
  [ -f "$B/drawrec.sh" ] && cp -p "$B/drawrec.sh" $H/mcai-analysis/drawrec.sh.rb && mv $H/mcai-analysis/drawrec.sh.rb $H/mcai-analysis/drawrec.sh && say "drawrec.sh restored ($(md5sum < $H/mcai-analysis/drawrec.sh | cut -c1-8))"
  [ -f "$B/NO-SCHED" ] && rm -f $H/canary-sched.py && say "canary-sched.py removed"
  [ -f "$B/canary-sched.py" ] && cp -p "$B/canary-sched.py" $H/canary-sched.py && say "previous canary-sched.py restored"
  [ -f "$B/NO-QUEUE" ] && rm -f $H/canary-queue.json && say "canary-queue.json removed"
  say "rollback done (sched-state.jsonl is append-only history and is left in place)"; exit 0
fi

DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
r() { if [ -n "$DRY" ]; then echo "  (dry run) WOULD REFUSE: $*"; else die "$*"; fi; }

say "preconditions (between canaries only)"
L=$(ps -eo pid,args | awk '$2=="bash" && $3 ~ /canary-loop\.sh$/ {print}')
[ -z "$L" ] || r "a canary loop runs: $L"
C=$(ps -eo pid,args | awk '{b=$3; sub(".*/","",b); if ($2 ~ /bash$/ && (b ~ /^chain-.*\.sh$/ || b ~ /^launch-.*\.sh$/ || (b ~ /^install-.*\.sh$/ && b != "install-canary-sched.sh"))) print}')
[ -z "$C" ] || r "a chain/launch/install script runs: $C"
CP=$(python3 -c "
import json,sys
m=json.load(open('$MAN'))
if not isinstance(m,dict) or 'canary_pool' not in m: sys.exit(3)
print('ACTIVE' if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')" 2>&1); RCP=$?
[ $RCP -eq 0 ] || r "manifest unreadable ($CP)"
[ "$CP" = "INACTIVE" ] || r "a canary is declared ($CP)"
ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf >/dev/null 2>&1 && r "canary drop-ins exist"
if [ -n "$DRY" ]; then
  flock -n /tmp/mcai-canary.lock true || echo "  (dry run) WOULD REFUSE: /tmp/mcai-canary.lock is held"
else
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
fi

say "tests in the staging dir"
cd "$S" || die "no staging dir"
python3 test_canary_sched.py > test_canary_sched.out 2>&1 || { tail -15 test_canary_sched.out; die "test_canary_sched failed"; }
tail -1 test_canary_sched.out
cp $H/mcai-analysis/drawrec.sh "$S/drawrec.live.sh"
python3 test_patch_drawrec.py "$S/drawrec.live.sh" > test_patch_drawrec.out 2>&1 || { cat test_patch_drawrec.out; die "test_patch_drawrec failed on the LIVE drawrec.sh"; }
tail -1 test_patch_drawrec.out
python3 patch_drawrec_exposure.py "$S/drawrec.live.sh" "$S/drawrec.new.sh" || die "drawrec patch refused (anchor moved: re-merge)"
bash -n "$S/drawrec.new.sh" || die "patched drawrec.sh does not parse"
[ "$(grep -c '^TARGET_K = 4$' "$S/drawrec.new.sh")" = 1 ] || die "TARGET_K = 4 line not intact"
python3 -m py_compile canary-sched.py || die "canary-sched.py does not compile"
GD0=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
say "gate digest before: $GD0 (this install changes no bundle file)"

if [ -n "$DRY" ]; then
  say "dry run: would install canary-sched.py $(md5sum < canary-sched.py | cut -c1-8), drawrec.sh $(md5sum < $H/mcai-analysis/drawrec.sh | cut -c1-8) -> $(md5sum < drawrec.new.sh | cut -c1-8), the empty queue, 3 seed rows, the cron line"
  SCHED_QUEUE=$S/dry-queue.json SCHED_STATE=$S/dry-state.jsonl SCHED_TICK_LOCK=$S/dry.lock SCHED_QUEUE_LOCK=$S/dryq.lock \
    python3 canary-sched.py tick --no-act | cut -c1-400
  exit 0
fi

B=$H/sched-install/backup-$STAMP; mkdir -p "$B" || die "cannot make $B"
crontab -l > "$B/crontab" 2>/dev/null || : > "$B/crontab"
cp -p $H/mcai-analysis/drawrec.sh "$B/drawrec.sh"
[ -f $H/canary-sched.py ] && cp -p $H/canary-sched.py "$B/canary-sched.py" || touch "$B/NO-SCHED"
[ -f $H/canary-queue.json ] || touch "$B/NO-QUEUE"
cmp -s "$B/drawrec.sh" "$S/drawrec.live.sh" || die "drawrec.sh changed during the install: re-run"
rollback() { echo "!! verification failed: rolling back"; SCHED_ROLLBACK_LOCKED=1 bash "$S/install-canary-sched.sh" --rollback "$STAMP"; exit 3; }   # this process holds the lock

say "install (tmp + rename)"
cp canary-sched.py $H/canary-sched.py.new-$STAMP && chmod 755 $H/canary-sched.py.new-$STAMP && mv $H/canary-sched.py.new-$STAMP $H/canary-sched.py || rollback
cp drawrec.new.sh $H/mcai-analysis/drawrec.sh.new-$STAMP && chmod 755 $H/mcai-analysis/drawrec.sh.new-$STAMP && mv $H/mcai-analysis/drawrec.sh.new-$STAMP $H/mcai-analysis/drawrec.sh || rollback
[ -f $H/canary-queue.json ] || { echo '{"version": 1, "entries": []}' > $H/canary-queue.json.new-$STAMP && mv $H/canary-queue.json.new-$STAMP $H/canary-queue.json; } || rollback
mkdir -p $H/digest
for run in owner-01 digwatch-01 blindstep-02; do
  grep -q "\"run\": \"$run\", \"how\": \"historical\"" $H/digest/sched-state.jsonl 2>/dev/null || \
    printf '{"state": "human", "run": "%s", "how": "historical", "why": "install seed (design r3 R2): September run the journal never closed; superseded by later fleet-wide deploys", "by": "install-canary-sched", "at": "%s"}\n' "$run" "$(date -u +%FT%TZ)" >> $H/digest/sched-state.jsonl
done
( crontab -l 2>/dev/null | grep -vF "canary-sched.py tick"; echo "$LINE" ) | crontab - || rollback

say "verify"
[ "$(md5sum < $H/canary-sched.py)" = "$(md5sum < canary-sched.py)" ] || rollback
[ "$(md5sum < $H/mcai-analysis/drawrec.sh)" = "$(md5sum < drawrec.new.sh)" ] || rollback
[ "$(crontab -l | grep -cF "canary-sched.py tick")" = 1 ] || rollback
python3 -c "import json; json.load(open('$H/canary-queue.json'))" || rollback
T=$(python3 $H/canary-sched.py tick --no-act 2>&1) || { echo "$T"; rollback; }
echo "$T" | cut -c1-300
GD1=$(python3 $H/verdict.py --gate-digest 2>/dev/null | md5sum | cut -c1-32)
[ "$GD0" = "$GD1" ] || { echo "gate digest moved: $GD0 -> $GD1"; rollback; }
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $H/digest/RULES-IN-FORCE.md | tail -1
say "INSTALLED $STAMP. Rollback: bash $S/install-canary-sched.sh --rollback $STAMP"
