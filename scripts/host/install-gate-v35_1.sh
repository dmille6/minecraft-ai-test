#!/bin/bash
# install-gate-v35_1.sh [--dry-run] -- gate v35.1 on the bots host (10.0.0.31), BETWEEN CANARIES ONLY.
#
# v35.1 = TWO files (live defect 2026-10-12: v35's drawsteady validated EVERY ledger row, so three September FLEET-WIDE
# promotion rows made it refuse on every run and the 6-h steady release never fired -- silently, for 8.5 h):
#   ~/mcai-analysis/drawsteady.py   only rows inside the 12-h window are validated (rows > 10 min in the future, too, are
#                                   not yet decided); a FLEET-WIDE row in the window suspends the release; anything else
#                                   malformed in the window still refuses
#   ~/mcai-analysis/drawrec.sh      a drawsteady REFUSAL (or no RELEASE line) is PAGED to ~/digest/page.jsonl, once per 6 h
# docs/reports/threepool-2026-10-10.md, "v35.1". Neither file is a part of the gate bundle (verdict.py + its imports + the
# loop-run decision modules), so the registered GATE DIGEST is UNCHANGED: b7ce36d777443eae018e804f4776e95a -- verified
# before and after.
#
# STAGE (from the repo at the commit being installed): cp -a ~/gate-v35 ~/gate-v35_1 (the unchanged v35 files), then
# scp scripts/{drawsteady.py,test_threepool.py,test_drawrequire.py} scripts/host/{drawrec.sh,install-gate-v35_1.sh} mike@10.0.0.31:gate-v35_1/
# THEN:  bash ~/gate-v35_1/install-gate-v35_1.sh --dry-run    then   bash ~/gate-v35_1/install-gate-v35_1.sh
set -u
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MAN=/srv/mcbots/trial-manifest.json; RULES=$H/digest/RULES-IN-FORCE.md
declare -A TGT=([drawsteady.py]=$H/mcai-analysis/drawsteady.py [drawrec.sh]=$H/mcai-analysis/drawrec.sh)
declare -A BASE=([drawsteady.py]=c42346a3084380c37123baf41ae6feee [drawrec.sh]=3d2568f2a960a764141369ac8686350c)   # v35, 10-12 20:33Z
DIGEST=b7ce36d777443eae018e804f4776e95a
say() { echo "== $*"; }; die() { echo "REFUSED: $*"; exit 2; }
W() { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: $*" || die "$*"; }

say "1. nothing may be running; the live gate is v35"
for f in drawsteady.py drawrec.sh drawrequire.py test_threepool.py test_drawrequire.py test_bagfix.py bagfixrule.py bagfixgate.py \
         deathgate.py canary-loop.sh bagread.py holdtoken.py; do [ -f "$S/$f" ] || die "staged file missing: $S/$f"; done
for f in "${!TGT[@]}"; do
  LM=$(md5sum < "${TGT[$f]}" | cut -c1-32)
  [ "$LM" = "${BASE[$f]}" ] || cmp -s "$S/$f" "${TGT[$f]}" || die "live ${TGT[$f]} is $LM, not the v35 base ${BASE[$f]}"
done
for f in bagfixrule.py bagfixgate.py deathgate.py bagread.py drawrequire.py; do
  cmp -s "$S/$f" "$H/mcai-analysis/$f" || die "staged $f differs from the live one (v35.1 changes only drawsteady.py and drawrec.sh)"
done
cmp -s "$S/canary-loop.sh" "$H/canary-loop.sh" || die "staged canary-loop.sh differs from the live one"
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
[ "$LIVE" = "$DIGEST" ] || die "the live gate bundle is $LIVE, not v35's $DIGEST"
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null || die "gatedigest.py does not pass on the live gate"
_busy() {   # the slot checks: run before the lock (a dry run reports them) and AGAIN under it (round 1, Claude)
  local DROPINS L CP
  DROPINS=$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
  [ -z "$DROPINS" ] || W "canary drop-ins present: $DROPINS"
  L=$(pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep || true)
  [ -z "$L" ] || W "a canary loop is running: $L"
  CP=$(python3 -c "
import json
m = json.load(open('$MAN'))
print('ACTIVE ' + str(m.get('canary_pool')) if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')" 2>&1) || CP="unreadable"
  [ "$CP" = "INACTIVE" ] || W "a canary is declared or the manifest is unreadable ($CP)"
}
_busy
if [ -n "$DRY" ]; then
  HO=$(python3 $S/holdtoken.py owner 2>&1); [ -z "$HO" ] || echo "  (dry run) WOULD REFUSE: an install-hold exists (owner $HO)"
  flock -n /tmp/mcai-canary.lock true || echo "  (dry run) WOULD REFUSE: /tmp/mcai-canary.lock is held"
else
  TOKEN="install-gate-v35_1:$$:$(date +%s%N)"
  CL=$(python3 $S/holdtoken.py claim "$TOKEN" 30 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-500)"
  trap 'python3 $S/holdtoken.py release "$TOKEN" >/dev/null 2>&1' EXIT
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  _busy      # re-checked UNDER the hold and the lock: nothing may have started since
fi

say "2. the staged files pass their tests (staging dir, nothing live)"
cd "$S" || die "cannot cd $S"
for t in test_threepool test_drawrequire; do
  python3 $t.py > $t.out 2>&1 || die "$t.py failed: $(grep -E '^FAIL|pass' $t.out | tail -5)"
  grep -qE '^SKIPPED[[:space:]]' $t.out && die "$t.py SKIPPED a section on the host: $(grep -E '^SKIPPED' $t.out | head -3)"
  echo "  $t: $(tail -1 $t.out)"
done
bash -n drawrec.sh || die "drawrec.sh does not parse"
# the LIVE positive control: on the live ledger the staged drawsteady must PARSE (the v35 defect refused)
NEW=$(python3 $S/drawsteady.py 2>&1); OLD=$(python3 ${TGT[drawsteady.py]} 2>&1)
echo "$NEW" | grep -q "STEADY inputs unreadable or malformed" && die "the staged drawsteady still refuses the live ledger: $(echo "$NEW" | head -2)"
echo "  live ledger, installed v35: $(echo "$OLD" | grep -m1 'STEADY ' | cut -c1-140)"
echo "  live ledger, staged v35.1:  $(echo "$NEW" | tail -1 | cut -c1-140)"

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install:"
  for f in "${!TGT[@]}"; do echo "    $S/$f ($(md5sum < $S/$f | cut -c1-8)) -> ${TGT[$f]} ($(md5sum < ${TGT[$f]} | cut -c1-8))"; done
  echo "  the gate bundle digest stays $DIGEST"
  exit 0
fi

say "3. install (every backup verified first, then each file replaced by rename)"
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  cp -p "$t" "$t.bak-v35_1-$STAMP" && cmp -s "$t" "$t.bak-v35_1-$STAMP" || die "backup of $t failed; nothing installed"
  cp "$S/$f" "$t.new-v35_1" && cmp -s "$S/$f" "$t.new-v35_1" && chmod --reference="$t" "$t.new-v35_1" \
    || { rm -f "$t.new-v35_1"; die "staging $t.new-v35_1 failed; nothing installed"; }
done
_rollback() { for f in "${!TGT[@]}"; do mv -f "${TGT[$f]}.bak-v35_1-$STAMP" "${TGT[$f]}"; rm -f "${TGT[$f]}.new-v35_1"; done; echo "ROLLED BACK v35.1"; }
trap '_rollback; exit 4' INT TERM HUP
for f in "${!TGT[@]}"; do mv -f "${TGT[$f]}.new-v35_1" "${TGT[$f]}" || { _rollback; exit 4; }; echo "  installed ${TGT[$f]}"; done
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
if [ "$LIVE" != "$DIGEST" ] || ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null; then
  _rollback; echo "the gate digest moved ($LIVE)"; exit 3
fi
trap - INT TERM HUP
echo "$(date -u +%FT%TZ) gate v35.1 installed: drawsteady.py $(md5sum < ${TGT[drawsteady.py]} | cut -c1-8), drawrec.sh $(md5sum < ${TGT[drawrec.sh]} | cut -c1-8); bundle $DIGEST unchanged; backups *.bak-v35_1-$STAMP" >> $H/digest/gate-installs.log
echo "INSTALLED v35.1: drawsteady.py + drawrec.sh replaced; bundle digest unchanged ($DIGEST); backups *.bak-v35_1-$STAMP"
