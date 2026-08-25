#!/usr/bin/env bash
# The CPU layout decides which cores each ARM runs on, and it carries two
# properties the experiment depends on. Neither is obvious from reading the
# shuffle, and both were wrong at some point today.
#
#   STRATIFIED  every arm must hold exactly one slot in each quarter of the CPU
#               range. A plain seeded shuffle is NOT enough at n=16: one draw
#               gave isolated {0,1,3,9} and placebo {4,10,13,15}, means of 3.25
#               against 10.5, which leaves arm correlated with core position
#               exactly as the old fixed layout did -- by luck, and harder to
#               notice.
#
#   VARIES      the layout must differ between repetitions, or the confound is
#               fixed rather than averaged out. Seeded on the world seed ALONE
#               it was constant, so "re-randomise between repetitions" could
#               never have happened.
#
# Requires bash 4 for mapfile; macOS ships 3.2, so run this on a lab host.
set -uo pipefail
cd "$(dirname "$0")"
# mapfile arrived in bash 4; macOS ships 3.2. Skip rather than fail, so a local
# preflight does not report a red for something only the lab hosts can run.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "  skipped -- needs bash 4 (this is ${BASH_VERSION%%(*}); run it on a lab host"
  exit 0
fi
FAIL=0
ARMS=(hive-a hive-b board-a board-b isolated-a isolated-b placebo-a placebo-b
      hive-c hive-d board-c board-d isolated-c isolated-d placebo-c placebo-d)
SEED=1239381899
SLOTBLOCK=$(sed -n '/^mapfile -t SLOT/,/^)$/p' provision-block2.sh)
[ -n "$SLOTBLOCK" ] || { echo "  FAIL  cannot find the slot block in provision-block2.sh"; exit 1; }

declare -A LAYOUT
for REP in 1 2 3; do
  eval "$SLOTBLOCK"
  seen=""
  for i in "${!ARMS[@]}"; do seen="$seen ${SLOT[$i]}"; done
  LAYOUT[$REP]="$seen"

  n=$(echo $seen | tr ' ' '\n' | sort -u | grep -c .)
  if [ "$n" -ne "${#ARMS[@]}" ]; then
    echo "  FAIL  rep $REP assigns $n distinct slots for ${#ARMS[@]} worlds"; FAIL=1
  fi
  for fam in hive board isolated placebo; do
    q=""
    for i in "${!ARMS[@]}"; do
      case "${ARMS[$i]}" in $fam-*) q="$q $(( ${SLOT[$i]} / 4 ))";; esac
    done
    u=$(echo $q | tr ' ' '\n' | sort -u | grep -c .)
    if [ "$u" -ne 4 ]; then
      echo "  FAIL  rep $REP: $fam is not stratified — quarters$q"; FAIL=1
    fi
  done
done
[ "$FAIL" -eq 0 ] && echo "  ok    every arm holds one slot per quarter, in all 3 repetitions"

if [ "${LAYOUT[1]}" = "${LAYOUT[2]}" ] || [ "${LAYOUT[2]}" = "${LAYOUT[3]}" ]; then
  echo "  FAIL  the layout does NOT change between repetitions — the confound is fixed"
  FAIL=1
else
  echo "  ok    the layout changes between repetitions"
fi

# Reproducible: same seed AND same repetition must give the same answer, or the
# manifest cannot describe what actually ran.
REP=2; eval "$SLOTBLOCK"; a=""
for i in "${!ARMS[@]}"; do a="$a ${SLOT[$i]}"; done
if [ "$a" != "${LAYOUT[2]}" ]; then
  echo "  FAIL  rep 2 is not reproducible from the same inputs"; FAIL=1
else
  echo "  ok    same seed + same repetition reproduces the same layout"
fi
echo "  $([ "$FAIL" -eq 0 ] && echo "all passed" || echo "FAILURES")"
exit $FAIL
