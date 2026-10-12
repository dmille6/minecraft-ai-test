#!/bin/bash
# install-gate-v35_1.sh [--dry-run] -- gate v35.1 on the bots host (10.0.0.31), BETWEEN CANARIES ONLY.
#
# v35.1 = ONE file: ~/mcai-analysis/drawsteady.py (live defect 2026-10-12: v35 validated EVERY ledger row, so three
# September FLEET-WIDE promotion rows made it refuse on every run and the 6-h steady release never fired). Now only rows
# inside the 12-h window are validated; a FLEET-WIDE row in the window suspends the release; anything else malformed in
# the window still refuses. docs/reports/threepool-2026-10-10.md, "v35.1".
# drawsteady.py is NOT a part of the gate bundle (verdict.py + its imports + the loop-run decision modules), so the
# registered GATE DIGEST is UNCHANGED: b7ce36d777443eae018e804f4776e95a. This installer verifies that, before and after.
#
# STAGE (from the repo at the commit being installed): copy ~/gate-v35 (the v35 staging, unchanged files) to ~/gate-v35_1,
# then scp scripts/{drawsteady.py,test_threepool.py} scripts/host/install-gate-v35_1.sh mike@10.0.0.31:gate-v35_1/
# THEN:  bash ~/gate-v35_1/install-gate-v35_1.sh --dry-run    then   bash ~/gate-v35_1/install-gate-v35_1.sh
set -u
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MAN=/srv/mcbots/trial-manifest.json; RULES=$H/digest/RULES-IN-FORCE.md
T=$H/mcai-analysis/drawsteady.py
BASE=c42346a3084380c37123baf41ae6feee          # v35 drawsteady.py as installed 10-12 20:33Z
DIGEST=b7ce36d777443eae018e804f4776e95a
say() { echo "== $*"; }; die() { echo "REFUSED: $*"; exit 2; }
W() { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: $*" || die "$*"; }

say "1. nothing may be running; the live gate is v35"
for f in drawsteady.py test_threepool.py test_bagfix.py bagfixrule.py bagfixgate.py deathgate.py canary-loop.sh drawrec.sh \
         bagread.py holdtoken.py; do [ -f "$S/$f" ] || die "staged file missing: $S/$f"; done
LM=$(md5sum < "$T" | cut -c1-32)
[ "$LM" = "$BASE" ] || cmp -s "$S/drawsteady.py" "$T" || die "live $T is $LM, not the v35 base $BASE"
for f in bagfixrule.py bagfixgate.py deathgate.py bagread.py drawrec.sh; do
  cmp -s "$S/$f" "$H/mcai-analysis/$f" || die "staged $f differs from the live one (v35.1 changes only drawsteady.py)"
done
cmp -s "$S/canary-loop.sh" "$H/canary-loop.sh" || die "staged canary-loop.sh differs from the live one"
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
[ "$LIVE" = "$DIGEST" ] || die "the live gate bundle is $LIVE, not v35's $DIGEST"
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null || die "gatedigest.py does not pass on the live gate"
DROPINS=$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
[ -z "$DROPINS" ] || W "canary drop-ins present: $DROPINS"
if [ -n "$DRY" ]; then
  HO=$(python3 $S/holdtoken.py owner 2>&1); [ -z "$HO" ] || echo "  (dry run) WOULD REFUSE: an install-hold exists (owner $HO)"
else
  TOKEN="install-gate-v35_1:$$:$(date +%s%N)"
  CL=$(python3 $S/holdtoken.py claim "$TOKEN" 30 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-500)"
  trap 'python3 $S/holdtoken.py release "$TOKEN" >/dev/null 2>&1' EXIT
fi
L=$(pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep || true)
[ -z "$L" ] || W "a canary loop is running: $L"
CP=$(python3 -c "
import json, sys
m = json.load(open('$MAN'))
print('ACTIVE ' + str(m.get('canary_pool')) if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')" 2>&1) || CP="unreadable"
[ "$CP" = "INACTIVE" ] || W "a canary is declared or the manifest is unreadable ($CP)"
if [ -n "$DRY" ]; then
  flock -n /tmp/mcai-canary.lock true || echo "  (dry run) WOULD REFUSE: /tmp/mcai-canary.lock is held"
else
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
fi

say "2. the staged drawsteady passes its tests (staging dir, nothing live)"
cd "$S" || die "cannot cd $S"
python3 test_threepool.py > test_threepool.out 2>&1 || die "test_threepool.py failed: $(grep -E '^FAIL|pass' test_threepool.out | tail -5)"
grep -q "SKIPPED" test_threepool.out && die "test_threepool.py SKIPPED a section on the host"
echo "  test_threepool: $(tail -1 test_threepool.out)"
# the LIVE positive control: on the live ledger the staged copy must PARSE (the v35 defect refused), the live copy is shown
NEW=$(python3 $S/drawsteady.py 2>&1); OLD=$(python3 $T 2>&1)
echo "$NEW" | grep -q "STEADY inputs unreadable or malformed" && die "the staged drawsteady still refuses the live ledger: $(echo "$NEW" | head -2)"
echo "  live ledger, installed v35: $(echo "$OLD" | grep -m1 'STEADY ' | cut -c1-140)"
echo "  live ledger, staged v35.1:  $(echo "$NEW" | tail -1 | cut -c1-140)"

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install $S/drawsteady.py ($(md5sum < $S/drawsteady.py | cut -c1-8)) -> $T ($LM); bundle digest stays $DIGEST"
  exit 0
fi

say "3. install (backup verified first, replace by rename)"
cp -p "$T" "$T.bak-v35_1-$STAMP" && cmp -s "$T" "$T.bak-v35_1-$STAMP" || die "backup of $T failed; nothing installed"
cp "$S/drawsteady.py" "$T.new-v35_1" && cmp -s "$S/drawsteady.py" "$T.new-v35_1" && chmod --reference="$T" "$T.new-v35_1" \
  || { rm -f "$T.new-v35_1"; die "staging $T.new-v35_1 failed; nothing installed"; }
mv -f "$T.new-v35_1" "$T" || { mv -f "$T.bak-v35_1-$STAMP" "$T"; die "mv failed: restored"; }
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
if [ "$LIVE" != "$DIGEST" ] || ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null; then
  mv -f "$T.bak-v35_1-$STAMP" "$T"; echo "ROLLED BACK: the gate digest moved ($LIVE)"; exit 3
fi
echo "$(date -u +%FT%TZ) gate v35.1 installed: drawsteady.py $(md5sum < $T | cut -c1-8); bundle $DIGEST unchanged; backup $T.bak-v35_1-$STAMP" >> $H/digest/gate-installs.log
echo "INSTALLED v35.1: drawsteady.py replaced; bundle digest unchanged ($DIGEST); backup $T.bak-v35_1-$STAMP"
