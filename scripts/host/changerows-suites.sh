#!/bin/bash
# changerows-suites.sh -- READ-ONLY: the installer's step 2 (the staged bundle's suites) on its own, in the staging
# dir, temp worlds under <stage>/tmp. Takes no lock and no hold. Exit 0 = every suite passed with nothing SKIPPED.
set -u
S=$(cd "$(dirname "$0")" && pwd); cd "$S" || exit 2
export TMPDIR=$S/tmp; mkdir -p "$TMPDIR"
export VERDICT_MODULE_DIR=$S
RC=0
for tt in test_changerows_underscore test_changerowcheck test_tiers test_keep180 test_bagfix test_usafe test_threepool \
          test_drawrequire test_holdtoken test_bagfix_loop; do
  python3 $tt.py > $tt.out 2>&1 || { echo "FAIL $tt: $(grep -E '^FAIL|^CASE.*FAIL|pass' $tt.out | tail -5 | tr '\n' ' ')"; RC=1; continue; }
  case $tt in test_tiers|test_keep180|test_bagfix|test_usafe|test_threepool)
    grep -qE '^SKIPPED[[:space:]]' $tt.out && { echo "SKIPPED in $tt: $(grep -E '^SKIPPED' $tt.out | head -3 | tr '\n' ' ')"; RC=1; };; esac
  echo "$tt: $(tail -1 $tt.out)"
done
grep -q '^ALL PASS$' test_changerows_underscore.out || { echo "FAIL test_changerows_underscore: no ALL PASS"; RC=1; }
VERDICT_PY=$S/verdict.py python3 test_license_change_rows.py > test_license_change_rows.out 2>&1 || { echo "FAIL test_license_change_rows"; RC=1; }
echo "test_license_change_rows: $(tail -1 test_license_change_rows.out)"
python3 test_verdict_acceptance.py > test_verdict_acceptance.out 2>&1
grep -q "83/83 acceptance cases pass" test_verdict_acceptance.out || { echo "FAIL acceptance: $(tail -1 test_verdict_acceptance.out)"; RC=1; }
echo "test_verdict_acceptance: $(tail -1 test_verdict_acceptance.out)"
echo "SUITES $([ $RC -eq 0 ] && echo OK || echo FAILED)"
exit $RC
