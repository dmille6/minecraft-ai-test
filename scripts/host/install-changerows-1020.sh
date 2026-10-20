#!/bin/bash
# install-changerows-1020.sh [--dry-run] -- gate v36.1 (CHANGE-ROW SPELLING, 2026-10-20) on the bots host, BETWEEN
# CANARIES ONLY. docs/reports/changerows-underscore-2026-10-20.md. Two files change and the bundle is RE-REGISTERED:
#   ~/verdict.py                       registered_row_names(): change_rows / linkage_extra stripped like the row kinds
#   ~/mcai-analysis/changerowcheck.py  assess(): the declared name looked up stripped, as tally() keys its counts
#   ~/digest/RULES-IN-FORCE.md         the v36.1 paragraph + the new GATE DIGEST + parts
# Nothing else changes; every other gate/loop/scheduler file must equal the staged copy (precheck step 2).
#
# STAGE (from the repo at the commit being installed; the coordinator, or already done under ~/changerows-1020/stage):
#   ssh mike@10.0.0.31 'mkdir -p ~/changerows-1020/stage'
#   scp scripts/{verdict.py,changerowcheck.py,tierrule.py,bagfixrule.py,usaferule.py,usafegate.py,bagfixgate.py,\
#       deathgate.py,drawrequire.py,singledeath.py,drawsteady.py,test_tiers.py,test_keep180.py,test_usafe.py,test_bagfix.py,\
#       test_changerowcheck.py,test_verdict_acceptance.py,test_threepool.py,test_drawrequire.py,test_holdtoken.py,\
#       test_changerows_underscore.py,test_license_change_rows.py} \
#       scripts/host/{canary-loop.sh,drawrec.sh,bagread.py,holdtoken.py,heavyread.sh,canary-sched.py,test_bagfix_loop.py,\
#       canarywatch.py,ugsafe2_value.py,changerows_replay.py,changerows-precheck.sh,changerows-suites.sh,gatedigest.py,\
#       changerows-rules-paragraph.md,install-changerows-1020.sh} \
#       docs/reports/airpocket-01.{ee21207,dbb4d78}.json mike@10.0.0.31:changerows-1020/stage/
# THEN:  bash ~/changerows-1020/stage/changerows-precheck.sh      (read-only; any time)
#        bash ~/changerows-1020/stage/install-changerows-1020.sh --dry-run
#        bash ~/changerows-1020/stage/install-changerows-1020.sh
# (test_verdict_acceptance_mutants.py refuses to score on this host by design -- ~/mcai-analysis shadows its copies --
#  so it is run in the repo, as for v35/v36. test_changerows_underscore.py's own mutants mutate verdict.py only, which
#  is run as a script, so they ARE valid here and run below.)
# It takes the scheduler's install-hold (holdtoken.py claim: the scheduler's own slot checks under its tick lock) and
# /tmp/mcai-canary.lock (flock -n) for the whole run, refuses on a declared canary, a running loop or chain, or any
# canary drop-in, and releases its own hold on exit. NEVER wrap canary-sched.py in flock ~/sched.lock (it deadlocks).
set -u
DRY=""
while [ $# -gt 0 ]; do case "$1" in --dry-run) DRY=1;; *) echo "unknown arg $1"; exit 2;; esac; shift; done
KEEP_HOLD=""   # set when a rollback could not be verified: the install-hold is then NOT released (fix by hand)
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ); TAG=v36_1
MAN=/srv/mcbots/trial-manifest.json; RULES=$H/digest/RULES-IN-FORCE.md
OLD_DIGEST=199517353b444cfdeb706d3ad965e05b
export TMPDIR=$S/tmp; mkdir -p "$TMPDIR"     # the suites' temp worlds stay inside the staging dir
say() { echo "== $*"; }; die() { echo "REFUSED: $*"; exit 2; }
W() { if [ -n "$DRY" ]; then echo "  (dry run) WOULD REFUSE: $*"; else die "$*"; fi; }
declare -A TGT=([verdict.py]=$H/verdict.py [changerowcheck.py]=$H/mcai-analysis/changerowcheck.py)

say "1. precheck (read-only): staged set complete, unchanged files equal live, targets on their v36 base, digest predicted"
bash "$S/changerows-precheck.sh" > "$S/precheck.out" 2>&1; PRC=$?
sed 's/^/  /' "$S/precheck.out"
[ $PRC -eq 0 ] || die "precheck failed (see above)"

_busy() {
  local DROPINS L C CP
  DROPINS=$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
  [ -z "$DROPINS" ] || W "canary drop-ins present: $DROPINS"
  L=$(pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep || true)
  [ -z "$L" ] || W "a canary loop is running: $L"
  C=$(pgrep -af 'chain-[a-z0-9-]*\.sh|launch-[a-z0-9-]*\.sh|chain-after' | grep -v -e pgrep -e install-changerows || true)
  [ -z "$C" ] || W "a chain/launch script is running: $C"
  CP=$(python3 -c "
import json, sys
m = json.load(open('$MAN'))
if not isinstance(m, dict) or 'canary_pool' not in m: sys.exit(3)
print('ACTIVE ' + str(m.get('canary_pool')) + ' ' + str(m.get('canary_code_version')) if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')" 2>&1) || CP="unreadable ($CP)"
  [ "$CP" = "INACTIVE" ] || W "a canary is declared or the manifest is unreadable ($CP)"
}
_busy
if [ -n "$DRY" ]; then
  HO=$(python3 $S/holdtoken.py owner 2>&1); [ -z "$HO" ] || echo "  (dry run) WOULD REFUSE: an install-hold exists (owner $HO)"
  flock -n /tmp/mcai-canary.lock true || echo "  (dry run) WOULD REFUSE: /tmp/mcai-canary.lock is held"
else
  TOKEN="install-changerows-1020:$$:$(date +%s%N)"
  CL=$(python3 $S/holdtoken.py claim "$TOKEN" 120 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-500)"
  trap '[ -n "$KEEP_HOLD" ] && echo "INSTALL-HOLD KEPT ($TOKEN): a rollback was not verified -- restore by hand, then python3 $S/holdtoken.py release $TOKEN" || python3 $S/holdtoken.py release "$TOKEN" >/dev/null 2>&1' EXIT
  echo "  $(echo "$CL" | tail -1 | cut -c1-200)"
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  _busy      # re-checked UNDER the hold and the lock
fi

say "2. the staged bundle passes its tests (staging dir, nothing live): changerows-suites.sh"
cd "$S" || die "cannot cd $S"
bash "$S/changerows-suites.sh" > "$S/suites.out" 2>&1; SRC=$?
sed 's/^/  /' "$S/suites.out"
[ $SRC -eq 0 ] && grep -q "^SUITES OK$" "$S/suites.out" || die "a suite failed or SKIPPED a section (see above)"

say "3. the digest the installed bundle WILL have, and the rules file re-registered (scratch copy)"
PD=$(VERDICT_MODULE_DIR=$S python3 $S/verdict.py --gate-digest | head -1)
PARTS=$(VERDICT_MODULE_DIR=$S python3 $S/verdict.py --gate-digest | tail -n +2)
echo "$PARTS" | grep -q UNRESOLVED && die "a part is UNRESOLVED: $PARTS"
echo "  predicted bundle digest: $PD"; echo "$PARTS"
NEWRULES=$S/RULES-IN-FORCE.md.$TAG
python3 - "$RULES" "$NEWRULES" "$PD" "$S/changerows-rules-paragraph.md" "$PARTS" <<'PY' || die "could not rewrite the rules file"
import re, sys
src, dst, digest, para, parts = sys.argv[1:6]
t = open(src).read()
n = len(re.findall(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', t))
assert n == 1, 'expected exactly one GATE DIGEST line, found %d' % n
t = re.sub(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', 'GATE DIGEST verdict-bundle md5 ' + digest, t)
t, nh = re.subn(r'(?m)^## THE REGISTERED GATE CODE \(.*\)$', '## THE REGISTERED GATE CODE (v36.1, 2026-10-20; the interlock is v32)', t, count=1)
assert nh == 1, 'header not found'
old = re.search(r'(?ms)^  parts \d{4}-\d\d-\d\d.*?\n\n', t)
assert old, 'parts block not found'
lines = ['    %-17s %s' % tuple(l.split()) for l in parts.splitlines() if l.strip()]
t = t.replace(old.group(0), '  parts 2026-10-20 (v36.1; verdict.py + its imports + the three loop-run decision modules; '
              'verdict.py and changerowcheck.py changed):\n' + '\n'.join(lines) + '\n\n', 1)
anchor = '## Rules in force (docs/reports/recovery-ladder-registration.md)\n'
assert t.count(anchor) == 1, 'rules anchor not found once'
p = open(para).read().rstrip('\n')
assert p.startswith('**v36.1 ') and p.count('\n') == 0, 'the paragraph must be ONE line starting **v36.1'
assert 'v36.1 (2026-10-20' not in t, 'the v36.1 paragraph is already in the rules file'
t = t.replace(anchor, anchor + p + ' ', 1)
open(dst, 'w').write(t)
PY
# VERDICT_MODULE_DIR reaches the `verdict.py --gate-digest` subprocess gatedigest spawns, so the STAGED changerowcheck
# is the part it hashes (without it, find_spec would resolve the live ~/mcai-analysis copy and the check would be wrong)
VERDICT_MODULE_DIR=$S python3 $H/mcai-analysis/gatedigest.py --verdict $S/verdict.py --rules $NEWRULES \
  || die "the staged bundle does not pass gatedigest against the rewritten rules"

say "4. positive controls on LIVE data (read-only)"
python3 $S/changerows_replay.py selftest > replay-selftest.out 2>&1 || die "changerows_replay.py selftest failed"
# 4a. dryrun replay of 60 past reads (the --dryrun path skips linkage, so this proves nothing ELSE moved). The staged
#     copy runs on its OWN modules against $NEWRULES (round 1, Codex P1: v36_replay.py strips VERDICT_MODULE_DIR, so
#     the staged verdict.py would hash the LIVE changerowcheck and every line would carry a GATE-CODE note).
python3 $S/changerows_replay.py dryrun $H/verdict.py $S/verdict.py $NEWRULES > dryrun_replay.out 2>&1 || die "verdict dryrun replay differs: $(grep -E '^DIFF|^FAIL|REPLAY' dryrun_replay.out | head -6 | tr '\n' ' ')"
echo "  dryrun replay: $(tail -1 dryrun_replay.out)"
# 4b. the non-dry replay of the underscore registrations' recorded reads (the linkage runs): no recorded word moves
python3 $S/changerows_replay.py verdict $H/verdict.py $S/verdict.py $NEWRULES $S/work cobblekeep-01 180,360 > replay-cobblekeep.out 2>&1 \
  || die "cobblekeep-01 replay: $(grep -E '^DIFF|^FAIL|^NOT FAITHFUL|^REFUSED' replay-cobblekeep.out | head -4 | tr '\n' ' ')"
python3 $S/changerows_replay.py verdict $H/verdict.py $S/verdict.py $NEWRULES $S/work lidclear-01 180,360 > replay-lidclear.out 2>&1 \
  || die "lidclear-01 replay: $(grep -E '^DIFF|^FAIL|^NOT FAITHFUL|^REFUSED' replay-lidclear.out | head -4 | tr '\n' ' ')"
grep -E '^(SAME|POSITIVE)' replay-cobblekeep.out replay-lidclear.out | sed 's/^/  /'

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install:"
  for f in "${!TGT[@]}"; do echo "    $S/$f ($(md5sum < $S/$f | cut -c1-8)) -> ${TGT[$f]} ($(md5sum < "${TGT[$f]}" | cut -c1-8))"; done
  echo "    $NEWRULES -> $RULES; bundle $OLD_DIGEST -> $PD"
  exit 0
fi

# THE HOLD MUST STILL BE OURS: the tests and replays above are long; an expired or replaced hold means the scheduler
# may launch -- refuse rather than install under a launch.
[ "$(python3 $S/holdtoken.py owner 2>&1)" = "$TOKEN" ] || die "the install-hold is no longer ours ($(python3 $S/holdtoken.py owner 2>&1)): nothing installed"
_busy
# THE PRECHECK AGAIN, UNDER THE HOLD AND THE LOCK (round 1, Claude P2): steps 2-4 can take an hour or more; a hand edit
# to either target or to the registered bundle in that time must refuse here, not be silently overwritten (and then
# make the rollback refuse on OLD_DIGEST).
bash "$S/changerows-precheck.sh" > "$S/precheck2.out" 2>&1 || { sed 's/^/  /' "$S/precheck2.out"; die "the precheck no longer passes under the hold: nothing installed"; }
grep -q "^PRECHECK OK: predicted bundle $PD\$" "$S/precheck2.out" || die "the predicted bundle moved since step 3 ($(tail -1 $S/precheck2.out)): nothing installed"
say "5. install: backups verified first, then each file replaced by rename"
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  cp -p "$t" "$t.bak-$TAG-$STAMP" && cmp -s "$t" "$t.bak-$TAG-$STAMP" || die "backup of $t failed; nothing installed"
  cp "$S/$f" "$t.new-$TAG" && cmp -s "$S/$f" "$t.new-$TAG" || { rm -f "$t.new-$TAG"; die "staging $t.new-$TAG failed; nothing installed"; }
  chmod --reference="$t" "$t.new-$TAG"
done
cp -p "$RULES" "$RULES.bak-$TAG-$STAMP" && cmp -s "$RULES" "$RULES.bak-$TAG-$STAMP" || die "backup of $RULES failed; nothing installed"
_rollback() {
  # CHECKED: every restore is verified against its backup (kept); a failure keeps the hold
  trap - INT TERM HUP
  echo "ROLLING BACK v36.1"
  local bad=""
  for f in "${!TGT[@]}"; do
    t=${TGT[$f]}
    cp -p "$t.bak-$TAG-$STAMP" "$t.rb-$TAG" && mv -f "$t.rb-$TAG" "$t" && cmp -s "$t.bak-$TAG-$STAMP" "$t" || bad="$bad $t"
    rm -f "$t.new-$TAG"
  done
  cp -p "$RULES.bak-$TAG-$STAMP" "$RULES.rb-$TAG" && mv -f "$RULES.rb-$TAG" "$RULES" && cmp -s "$RULES.bak-$TAG-$STAMP" "$RULES" || bad="$bad $RULES"
  if [ -n "$bad" ]; then KEEP_HOLD=1; echo "ROLLBACK INCOMPLETE:$bad -- backups *.bak-$TAG-$STAMP kept"; return 1; fi
  # THE RESTORED GATE MUST PASS THE INTERLOCK (round 1, Codex P2): a failure keeps the hold and says so
  if ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES; then
    KEEP_HOLD=1; echo "ROLLBACK UNVERIFIED: files restored from *.bak-$TAG-$STAMP but gatedigest.py does not pass -- the install-hold is KEPT"
    return 1
  fi
  [ "$(python3 $H/verdict.py --gate-digest | head -1)" = "$OLD_DIGEST" ] \
    || { KEEP_HOLD=1; echo "ROLLBACK UNVERIFIED: the restored bundle is not $OLD_DIGEST -- the install-hold is KEPT"; return 1; }
  echo "ROLLED BACK v36.1 (verified against the backups; bundle $OLD_DIGEST, gatedigest passes)"
}
trap '_rollback; exit 4' INT TERM HUP
for f in "${!TGT[@]}"; do mv -f "${TGT[$f]}.new-$TAG" "${TGT[$f]}" || { _rollback; exit 4; }; echo "  installed ${TGT[$f]}"; done
mv -f "$NEWRULES" "$RULES" || { _rollback; exit 4; }
echo "  re-registered $RULES"

say "6. the interlock agrees, or everything is rolled back"
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
if [ "$LIVE" != "$PD" ] || ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES; then
  echo "MISMATCH: live $LIVE vs predicted $PD"; _rollback; exit 3
fi
for f in "${!TGT[@]}"; do cmp -s "$S/$f" "${TGT[$f]}" || { echo "MISMATCH: ${TGT[$f]} is not the staged $f"; _rollback; exit 3; }; done
trap - INT TERM HUP
echo "$(date -u +%FT%TZ) gate v36.1 installed (change-row spelling): bundle $PD (was $OLD_DIGEST); verdict.py $(md5sum < $H/verdict.py | cut -c1-8), changerowcheck.py $(md5sum < $H/mcai-analysis/changerowcheck.py | cut -c1-8); backups *.bak-$TAG-$STAMP" >> $H/digest/gate-installs.log || echo "WARNING: the gate-installs.log line could not be written -- add it by hand"
echo "INSTALLED v36.1: bundle $PD registered; backups *.bak-$TAG-$STAMP"
