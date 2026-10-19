#!/bin/bash
# install-gate-v36.sh [--dry-run] -- gate v36 (CANARY TIERS, owner 2026-10-19) on the bots host, BETWEEN CANARIES ONLY.
# docs/reports/canary-tiers-2026-10-19.md. Three files change, and the gate bundle is RE-REGISTERED:
#   ~/verdict.py                    tier-2 +180 KEEP, the log-based baseline interlock, the `tier 2 (v36)` marker
#   ~/mcai-analysis/tierrule.py     NEW (pure; in the bundle)
#   ~/mcai-analysis/drawsteady.py   candidates_t2 + version_clean, ONLY for a tier-2 DRAW_RUN
#   ~/digest/RULES-IN-FORCE.md      the v36 paragraph + the new GATE DIGEST + parts
# canary-loop.sh, drawrec.sh, canary-sched.py are NOT changed and must equal the staged copies.
#
# STAGE (from the repo at the commit being installed):
#   ssh mike@10.0.0.31 'mkdir -p ~/gate-v36'
#   scp scripts/{verdict.py,tierrule.py,drawsteady.py,bagfixrule.py,usaferule.py,usafegate.py,bagfixgate.py,changerowcheck.py,\
#       deathgate.py,drawrequire.py,singledeath.py,test_tiers.py,test_keep180.py,test_usafe.py,test_bagfix.py,\
#       test_changerowcheck.py,test_verdict_acceptance.py,test_threepool.py,\
#       test_drawrequire.py,test_heavyread.py,test_holdtoken.py} \
#       scripts/host/{canary-loop.sh,drawrec.sh,bagread.py,holdtoken.py,heavyread.sh,canary-sched.py,test_bagfix_loop.py,\
#       canarywatch.py,install-gate-v36.sh,v36-rules-paragraph.md,v36_replay.py,v36_livecheck.py,ugsafe2_value.py} \
#       docs/reports/airpocket-01.{ee21207,dbb4d78}.json mike@10.0.0.31:gate-v36/
# (test_verdict_acceptance_mutants.py refuses to score on this host by design -- ~/mcai-analysis shadows its copies --
#  so, as for v35, it is run in the repo and not here.)
# THEN:  bash ~/gate-v36/install-gate-v36.sh --dry-run    then    bash ~/gate-v36/install-gate-v36.sh
# It takes the scheduler's install-hold (holdtoken.py claim: the scheduler's own slot checks under its tick lock) and
# /tmp/mcai-canary.lock (flock -n) for the whole run, refuses on a declared canary, a running loop or chain, or any
# canary drop-in, and releases its own hold on exit. NEVER wrap canary-sched.py in flock ~/sched.lock (it deadlocks).
set -u
# [--then <script>] (coordinator 10-19: ONE install window with brain-01): after v36 is installed and verified, run
# <script> while this installer STILL holds the install-hold and /tmp/mcai-canary.lock (HOLD_TOKEN exported, fd 8
# inherited). Its failure leaves v36 installed (the two are independent) and is reported. With --dry-run, it is run
# with --dry-run too.
DRY=""; THEN=""
while [ $# -gt 0 ]; do case "$1" in --dry-run) DRY=1;; --then) THEN=${2:?--then needs a script}; shift;; *) echo "unknown arg $1"; exit 2;; esac; shift; done
[ -z "$THEN" ] || [ -f "$THEN" ] || { echo "REFUSED: --then script $THEN missing"; exit 2; }
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MAN=/srv/mcbots/trial-manifest.json; RULES=$H/digest/RULES-IN-FORCE.md
say() { echo "== $*"; }; die() { echo "REFUSED: $*"; exit 2; }
W() { if [ -n "$DRY" ]; then echo "  (dry run) WOULD REFUSE: $*"; else die "$*"; fi; }
declare -A TGT=([verdict.py]=$H/verdict.py [tierrule.py]=$H/mcai-analysis/tierrule.py [drawsteady.py]=$H/mcai-analysis/drawsteady.py)
declare -A BASE=([verdict.py]=164e170dbd75dff033ebbba06d74f5c9 [tierrule.py]=ABSENT [drawsteady.py]=b4a20bc75260c248bd498336ad01516e)
OLD_DIGEST=b7ce36d777443eae018e804f4776e95a
SAME="bagfixrule.py:$H/mcai-analysis/bagfixrule.py usaferule.py:$H/mcai-analysis/usaferule.py usafegate.py:$H/mcai-analysis/usafegate.py bagfixgate.py:$H/mcai-analysis/bagfixgate.py changerowcheck.py:$H/mcai-analysis/changerowcheck.py deathgate.py:$H/mcai-analysis/deathgate.py drawrequire.py:$H/mcai-analysis/drawrequire.py singledeath.py:$H/mcai-analysis/singledeath.py bagread.py:$H/mcai-analysis/bagread.py heavyread.sh:$H/mcai-analysis/heavyread.sh canary-loop.sh:$H/canary-loop.sh drawrec.sh:$H/mcai-analysis/drawrec.sh canary-sched.py:$H/canary-sched.py canarywatch.py:$H/canarywatch.py"

say "1. staged files present; unchanged files equal the live ones; targets on their v35.1 base"
for f in "${!TGT[@]}" test_tiers.py test_keep180.py test_usafe.py test_bagfix.py test_changerowcheck.py test_verdict_acceptance.py \
         test_threepool.py test_drawrequire.py test_holdtoken.py test_bagfix_loop.py \
         holdtoken.py v36-rules-paragraph.md v36_replay.py v36_livecheck.py ugsafe2_value.py airpocket-01.ee21207.json airpocket-01.dbb4d78.json; do
  [ -f "$S/$f" ] || die "staged file missing: $S/$f"
done
for pair in $SAME; do cmp -s "$S/${pair%%:*}" "${pair#*:}" || die "staged ${pair%%:*} differs from the live ${pair#*:} (v36 does not change it)"; done
for f in "${!BASE[@]}"; do
  t=${TGT[$f]}
  if [ "${BASE[$f]}" = ABSENT ]; then
    [ ! -e "$t" ] || cmp -s "$S/$f" "$t" || die "$t exists and is not the staged copy"
  else
    LM=$(md5sum < "$t" | cut -c1-32)
    [ "$LM" = "${BASE[$f]}" ] || cmp -s "$S/$f" "$t" || die "live $t is $LM, not the base v36 was built on (${BASE[$f]})"
  fi
done
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
[ "$LIVE" = "$OLD_DIGEST" ] || die "the live gate bundle is $LIVE, not v35.1's $OLD_DIGEST"
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null || die "gatedigest.py does not pass on the live gate"

_busy() {
  local DROPINS L C CP
  DROPINS=$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
  [ -z "$DROPINS" ] || W "canary drop-ins present: $DROPINS"
  L=$(pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep || true)
  [ -z "$L" ] || W "a canary loop is running: $L"
  C=$(pgrep -af 'chain-[a-z0-9-]*\.sh|launch-[a-z0-9-]*\.sh|chain-after' | grep -v -e pgrep -e install-gate || true)
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
  TOKEN="install-gate-v36:$$:$(date +%s%N)"
  CL=$(python3 $S/holdtoken.py claim "$TOKEN" 180 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-500)"
  trap 'python3 $S/holdtoken.py release "$TOKEN" >/dev/null 2>&1' EXIT
  echo "  $(echo "$CL" | tail -1 | cut -c1-200)"
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  _busy      # re-checked UNDER the hold and the lock
fi

say "2. the staged bundle passes its tests (staging dir, nothing live)"
cd "$S" || die "cannot cd $S"
export VERDICT_MODULE_DIR=$S
# test_heavyread (~45 min) is not run: heavyread.sh is not changed by v36 and is asserted equal to the live copy above.
for tt in test_tiers test_keep180 test_bagfix test_usafe test_threepool test_drawrequire test_changerowcheck test_holdtoken test_bagfix_loop; do
  python3 $tt.py > $tt.out 2>&1 || die "$tt.py failed: $(grep -E '^FAIL|pass' $tt.out | tail -5 | tr '\n' ' ')"
  case $tt in test_tiers|test_keep180|test_bagfix|test_usafe|test_threepool)
    grep -qE '^SKIPPED[[:space:]]' $tt.out && die "$tt.py SKIPPED a section on the host: $(grep -E '^SKIPPED' $tt.out | head -3 | tr '\n' ' ')";; esac
  echo "  $tt: $(tail -1 $tt.out)"
done
python3 test_verdict_acceptance.py > test_verdict_acceptance.out 2>&1 || true
grep -q "83/83 acceptance cases pass" test_verdict_acceptance.out || die "acceptance suite: $(tail -1 test_verdict_acceptance.out)"
echo "  test_verdict_acceptance: $(grep -m1 '83/83' test_verdict_acceptance.out)"
unset VERDICT_MODULE_DIR

say "3. the digest the installed bundle WILL have, and the rules file re-registered (scratch copy)"
PD=$(python3 $S/verdict.py --gate-digest | head -1)
PARTS=$(python3 $S/verdict.py --gate-digest | tail -n +2)
echo "$PARTS" | grep -q UNRESOLVED && die "a part is UNRESOLVED: $PARTS"
echo "$PARTS" | grep -q "tierrule.py" || die "tierrule.py is not a part of the predicted bundle"
echo "  predicted bundle digest: $PD"; echo "$PARTS"
NEWRULES=$S/RULES-IN-FORCE.md.v36
python3 - "$RULES" "$NEWRULES" "$PD" "$S/v36-rules-paragraph.md" "$PARTS" <<'PY' || die "could not rewrite the rules file"
import re, sys
src, dst, digest, para, parts = sys.argv[1:6]
t = open(src).read()
n = len(re.findall(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', t))
assert n == 1, 'expected exactly one GATE DIGEST line, found %d' % n
t = re.sub(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', 'GATE DIGEST verdict-bundle md5 ' + digest, t)
t, nh = re.subn(r'(?m)^## THE REGISTERED GATE CODE \(.*\)$', '## THE REGISTERED GATE CODE (v36, 2026-10-19; the interlock is v32)', t, count=1)
assert nh == 1, 'header not found'
old = re.search(r'(?ms)^  parts \d{4}-\d\d-\d\d.*?\n\n', t)
assert old, 'parts block not found'
lines = ['    %-17s %s' % tuple(l.split()) for l in parts.splitlines() if l.strip()]
t = t.replace(old.group(0), '  parts 2026-10-19 (v36; verdict.py + its imports, tierrule.py included, + the three loop-run decision modules):\n'
              + '\n'.join(lines) + '\n\n', 1)
anchor = '## Rules in force (docs/reports/recovery-ladder-registration.md)\n'
assert t.count(anchor) == 1, 'rules anchor not found once'
t = t.replace(anchor, anchor + open(para).read().rstrip('\n') + ' ', 1)
open(dst, 'w').write(t)
PY
python3 $H/mcai-analysis/gatedigest.py --verdict $S/verdict.py --rules $NEWRULES || die "the staged verdict.py does not pass gatedigest against the rewritten rules"

say "4. positive controls on LIVE data (read-only): tier-3 behaviour identical"
python3 $S/v36_replay.py $H/verdict.py $S/verdict.py $NEWRULES 60 > v36_replay.out 2>&1 || die "verdict replay differs: $(grep -E '^DIFF|REPLAY' v36_replay.out | head -6 | tr '\n' ' ')"
echo "  $(tail -1 v36_replay.out)"
for R in "" bamboo-02 treefarm-02; do
  A=$(DRAW_RUN=$R python3 $H/mcai-analysis/drawsteady.py 2>&1 | grep -E '^STEADY (RELEASE|12h|6h|no |inputs|a fleet)' | sed -E 's/: .*//' | sort)
  B=$(cd $S && DRAW_RUN=$R python3 $S/drawsteady.py 2>&1 | grep -E '^STEADY (RELEASE|12h|6h|no |inputs|a fleet)' | sed -E 's/: .*//' | sort)
  [ "$A" = "$B" ] || die "drawsteady differs for DRAW_RUN='$R': installed [$A] staged [$B]"
  echo "  drawsteady DRAW_RUN='${R}': identical ($(echo "$A" | grep RELEASE))"
done

python3 $S/v36_livecheck.py $S > v36_livecheck.out 2>&1 || die "live positive control for the tier-2 loader failed: $(tail -3 v36_livecheck.out | tr '\n' ' ')"
sed 's/^/  /' v36_livecheck.out

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install:"
  for f in "${!TGT[@]}"; do echo "    $S/$f ($(md5sum < $S/$f | cut -c1-8)) -> ${TGT[$f]} ($( [ -f "${TGT[$f]}" ] && md5sum < "${TGT[$f]}" | cut -c1-8 || echo NEW))"; done
  echo "    $NEWRULES -> $RULES; bundle $OLD_DIGEST -> $PD"
  if [ -n "$THEN" ]; then say "DRY RUN of the second install in this window: $THEN"; bash "$THEN" --dry-run; fi
  exit 0
fi

# THE HOLD MUST STILL BE OURS (Claude r5): the tests and replays above can be long; an expired or replaced hold means
# the scheduler may launch -- refuse rather than install under a launch.
[ "$(python3 $S/holdtoken.py owner 2>&1)" = "$TOKEN" ] || die "the install-hold is no longer ours ($(python3 $S/holdtoken.py owner 2>&1)): nothing installed"
_busy
say "5. install: backups verified first, then each file replaced by rename"
declare -A EXISTED=()
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  if [ -e "$t" ]; then
    EXISTED[$f]=1
    cp -p "$t" "$t.bak-v36-$STAMP" && cmp -s "$t" "$t.bak-v36-$STAMP" || die "backup of $t failed; nothing installed"
  fi
  cp "$S/$f" "$t.new-v36" && cmp -s "$S/$f" "$t.new-v36" || { rm -f "$t.new-v36"; die "staging $t.new-v36 failed; nothing installed"; }
  [ -n "${EXISTED[$f]:-}" ] && chmod --reference="$t" "$t.new-v36"
done
cp -p "$RULES" "$RULES.bak-v36-$STAMP" && cmp -s "$RULES" "$RULES.bak-v36-$STAMP" || die "backup of $RULES failed; nothing installed"
_rollback() {
  trap - INT TERM HUP
  echo "ROLLING BACK v36"
  for f in "${!TGT[@]}"; do
    t=${TGT[$f]}
    if [ -n "${EXISTED[$f]:-}" ]; then mv -f "$t.bak-v36-$STAMP" "$t"; else rm -f "$t"; fi
    rm -f "$t.new-v36"
  done
  mv -f "$RULES.bak-v36-$STAMP" "$RULES"
  python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES
}
trap '_rollback; exit 4' INT TERM HUP
for f in "${!TGT[@]}"; do mv -f "${TGT[$f]}.new-v36" "${TGT[$f]}" || { _rollback; exit 4; }; echo "  installed ${TGT[$f]}"; done
mv -f "$NEWRULES" "$RULES" || { _rollback; exit 4; }
echo "  re-registered $RULES"

say "6. the interlock agrees, or everything is rolled back"
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
if [ "$LIVE" != "$PD" ] || ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES; then
  echo "MISMATCH: live $LIVE vs predicted $PD"; _rollback; exit 3
fi
trap - INT TERM HUP
echo "$(date -u +%FT%TZ) gate v36 installed (canary tiers): bundle $PD (was $OLD_DIGEST); verdict.py $(md5sum < $H/verdict.py | cut -c1-8), tierrule.py $(md5sum < $H/mcai-analysis/tierrule.py | cut -c1-8), drawsteady.py $(md5sum < $H/mcai-analysis/drawsteady.py | cut -c1-8); backups *.bak-v36-$STAMP" >> $H/digest/gate-installs.log || echo "WARNING: the gate-installs.log line could not be written -- add it by hand"
echo "INSTALLED v36: bundle $PD registered; backups *.bak-v36-$STAMP"
if [ -n "$THEN" ]; then
  say "7. the second install in this window (hold and lock still held): $THEN"
  [ "$(python3 $S/holdtoken.py owner 2>&1)" = "$TOKEN" ] || { echo "REFUSED: the install-hold is no longer ours; $THEN NOT run (v36 stays installed)"; exit 2; }
  HOLD_TOKEN=$TOKEN bash "$THEN"; RT=$?
  [ $RT -eq 0 ] || { echo "SECOND INSTALL FAILED (exit $RT): $THEN -- v36 stays installed"; exit 5; }
  echo "WINDOW COMPLETE: v36 + $(basename "$THEN")"
fi
