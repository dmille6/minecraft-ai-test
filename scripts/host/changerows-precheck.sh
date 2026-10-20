#!/bin/bash
# changerows-precheck.sh -- READ-ONLY precheck for install-changerows-1020.sh (gate v36.1, change-row spelling).
# Takes no lock, claims no hold, writes nothing outside its own staging dir. Safe to run while a canary is live:
# it reports a live canary as BUSY (the install itself must wait for the gap) but never touches it.
#   bash ~/changerows-1020/stage/changerows-precheck.sh          exit 0 = staged set is installable; 2 = not
# The installer runs this same file as its step 1.
set -u
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd)
RULES=$H/digest/RULES-IN-FORCE.md; MAN=/srv/mcbots/trial-manifest.json
OLD_DIGEST=199517353b444cfdeb706d3ad965e05b
FAIL=0
bad() { echo "PRECHECK FAIL: $*"; FAIL=1; }
declare -A TGT=([verdict.py]=$H/verdict.py [changerowcheck.py]=$H/mcai-analysis/changerowcheck.py)
declare -A BASE=([verdict.py]=43bdfb34ea3386eaeb0185baa9725d1f [changerowcheck.py]=e8211c7633b54ecf8a19b503eca725b4)
SAME="bagfixrule.py:$H/mcai-analysis/bagfixrule.py usaferule.py:$H/mcai-analysis/usaferule.py usafegate.py:$H/mcai-analysis/usafegate.py bagfixgate.py:$H/mcai-analysis/bagfixgate.py deathgate.py:$H/mcai-analysis/deathgate.py drawrequire.py:$H/mcai-analysis/drawrequire.py singledeath.py:$H/mcai-analysis/singledeath.py tierrule.py:$H/mcai-analysis/tierrule.py drawsteady.py:$H/mcai-analysis/drawsteady.py bagread.py:$H/mcai-analysis/bagread.py heavyread.sh:$H/mcai-analysis/heavyread.sh canary-loop.sh:$H/canary-loop.sh drawrec.sh:$H/mcai-analysis/drawrec.sh canary-sched.py:$H/canary-sched.py canarywatch.py:$H/canarywatch.py"

echo "== precheck 1. staged files present"
for f in "${!TGT[@]}" test_changerows_underscore.py test_license_change_rows.py test_changerowcheck.py test_verdict_acceptance.py \
         test_tiers.py test_keep180.py test_bagfix.py test_usafe.py test_threepool.py test_drawrequire.py test_holdtoken.py \
         test_bagfix_loop.py holdtoken.py ugsafe2_value.py changerows_replay.py changerows-rules-paragraph.md changerows-suites.sh \
         airpocket-01.ee21207.json airpocket-01.dbb4d78.json; do
  [ -f "$S/$f" ] || bad "staged file missing: $S/$f"
done
echo "== precheck 2. every unchanged file equals the live one"
for pair in $SAME; do cmp -s "$S/${pair%%:*}" "${pair#*:}" || bad "staged ${pair%%:*} differs from the live ${pair#*:} (this install does not change it)"; done
echo "== precheck 3. the two targets are on the base this fix was built on (or already the staged copy)"
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}; LM=$(md5sum < "$t" | cut -c1-32)
  if [ "$LM" = "${BASE[$f]}" ]; then echo "  $t = base ${BASE[$f]:0:8}"
  elif cmp -s "$S/$f" "$t"; then echo "  $t ALREADY the staged copy"
  else bad "live $t is $LM, not the base ${BASE[$f]} (someone changed it since 10-20; rebuild the fix on it)"; fi
done
echo "== precheck 4. the live gate is the registered v36 gate"
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
[ "$LIVE" = "$OLD_DIGEST" ] || bad "the live gate bundle is $LIVE, not v36's $OLD_DIGEST"
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null || bad "gatedigest.py does not pass on the live gate"
echo "  live bundle $LIVE"
echo "== precheck 5. the bundle the install WILL register (staged modules first; parts must all resolve)"
PD=$(VERDICT_MODULE_DIR=$S python3 $S/verdict.py --gate-digest | head -1)
PARTS=$(VERDICT_MODULE_DIR=$S python3 $S/verdict.py --gate-digest | tail -n +2)
echo "$PARTS" | grep -q UNRESOLVED && bad "a part is UNRESOLVED: $PARTS"
for f in "${!TGT[@]}"; do
  echo "$PARTS" | grep -qE "^ *$f +$(md5sum < $S/$f | cut -c1-32)$" || bad "predicted parts do not carry the staged $f"
done
[ "$PD" != "$OLD_DIGEST" ] || bad "the predicted bundle equals the old one: the staged files are not the fix"
echo "  predicted bundle $PD"; echo "$PARTS"
echo "== precheck 6. canary slot (REPORTED; the installer refuses while any of these is present)"
ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf >/dev/null 2>&1 && echo "  BUSY: canary drop-ins present"
pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep | sed 's/^/  BUSY: loop /'
python3 -c "
import json; m = json.load(open('$MAN'))
print('  BUSY: declared canary ' + str(m.get('run_id')) + ' on ' + str(m.get('canary_pool')) if (m.get('canary_pool') or m.get('canary_code_version')) else '  manifest: no canary declared')"
[ $FAIL -eq 0 ] && echo "PRECHECK OK: predicted bundle $PD" || echo "PRECHECK FAILED"
exit $((FAIL * 2))
