#!/usr/bin/env bash
# install-valuescore.sh -- STAGED installer for the value-weighted scoreboard (docs/reports/valuescore-2026-10-23.md).
# The coordinator (or the owner) runs it on 10.0.0.31 as mike, from a checkout or copy of this branch. Nothing is
# installed until --apply.
#
#   bash scripts/host/install-valuescore.sh             # DRY RUN: checks and a smoke run from this checkout; changes nothing
#   bash scripts/host/install-valuescore.sh --apply     # install into ~/mcai-analysis + add one cron line (marker valuescore-1023)
#   bash scripts/host/install-valuescore.sh --rollback  # restore the backed-up scoreboard.py, remove valuescore + its cron line
#
# --apply does, in order (it stops at the first failure):
#   1. the self-test (test_valuescore.py: 36 cases, 8 mutants) passes from this checkout;
#   2. ~/estel/scripts/lib/estelemetry.py is md5-identical to this checkout's scripts/lib/estelemetry.py;
#   3. ~/mcai-analysis/scoreboard.py is the version this branch was written against (md5 a27acb0e...), so nothing newer is
#      overwritten; it is backed up to scoreboard.py.bak-<ts>;
#   4. copies scoreboard.py, valuescore.py and test_valuescore.py into ~/mcai-analysis/;
#   5. smoke run: the installed valuescore.py for yesterday must succeed (it raises ValueBlind on a blind input);
#   6. crontab: backed up to ~/mcai-analysis/crontab.bak-<ts>; adds ONE line (00:50Z daily, nice 19) writing
#      ~/digest/valuescore/<day>.json and appending text to ~/digest/valuescore.log, unless the marker is already there.
# Read-only on the fleet throughout: ES searches with the read-only key, and files under ~ only.
set -euo pipefail
MODE="${1:-dry}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SRC/../.." && pwd)"
DEST="$HOME/mcai-analysis"
ESTEL="$HOME/estel/scripts"
MARK='# valuescore-1023'
EXPECT_OLD='a27acb0ecd04cd91dc453576f2b2f1ec'
TS="$(date -u +%Y%m%dT%H%M%SZ)"
YDAY="$(date -u -d yesterday +%F)"
CRON="50 0 * * * cd $DEST && MCAI_ESTEL_SCRIPTS=$ESTEL nice -n 19 /usr/bin/python3 valuescore.py --json $HOME/digest/valuescore/\$(date -u -d yesterday +\\%F).json >> $HOME/digest/valuescore.log 2>&1 $MARK"

die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$(id -un)" = mike ] || die "run as mike on 10.0.0.31"
[ "$(hostname)" = block2-bots ] || die "run on 10.0.0.31 (block2-bots), not $(hostname)"

if [ "$MODE" = --rollback ]; then
  B="$(ls -1t "$DEST"/scoreboard.py.bak-* 2>/dev/null | head -1 || true)"
  [ -n "$B" ] || die "no scoreboard.py.bak-* in $DEST"
  cp -p "$B" "$DEST/scoreboard.py"
  rm -f "$DEST/valuescore.py" "$DEST/test_valuescore.py"
  crontab -l > "$DEST/crontab.bak-$TS"
  grep -vF "$MARK" "$DEST/crontab.bak-$TS" | crontab -
  echo "rolled back: scoreboard.py <- $B (md5 $(md5sum < "$DEST/scoreboard.py" | cut -c1-8)); valuescore removed; cron lines with '$MARK': $(crontab -l | grep -cF "$MARK" || true)"
  exit 0
fi

echo "== 1. self-test from $SRC"
python3 "$SRC/test_valuescore.py" | tail -1
python3 "$SRC/test_valuescore.py" > /dev/null || die "self-test failed"

echo "== 2. estelemetry copy"
A="$(md5sum < "$ESTEL/lib/estelemetry.py" | cut -d' ' -f1)"; Bm="$(md5sum < "$REPO/scripts/lib/estelemetry.py" | cut -d' ' -f1)"
echo "   ~/estel $A   repo $Bm"
[ "$A" = "$Bm" ] || die "~/estel/scripts/lib/estelemetry.py differs from the repo copy: refresh ~/estel first"

echo "== 3. installed scoreboard.py"
CUR="$(md5sum < "$DEST/scoreboard.py" | cut -d' ' -f1)"
echo "   md5 $CUR (expected $EXPECT_OLD)"
[ "$CUR" = "$EXPECT_OLD" ] || die "~/mcai-analysis/scoreboard.py is not the version this branch was written against; merge first"

echo "== smoke run from the checkout (yesterday, $YDAY)"
MCAI_ESTEL_SCRIPTS="$ESTEL" nice -n 19 python3 "$SRC/valuescore.py" --day "$YDAY" | sed -n 1,3p

if [ "$MODE" != --apply ]; then
  echo
  echo "DRY RUN: nothing changed. --apply would copy scoreboard.py, valuescore.py, test_valuescore.py into $DEST"
  echo "(backup scoreboard.py.bak-$TS) and add this cron line (backup crontab.bak-$TS):"
  echo "   $CRON"
  exit 0
fi

echo "== 4. install"
cp -p "$DEST/scoreboard.py" "$DEST/scoreboard.py.bak-$TS"
install -m 0644 "$SRC/scoreboard.py" "$SRC/valuescore.py" "$SRC/test_valuescore.py" "$DEST/"
mkdir -p "$HOME/digest/valuescore"
echo "== 5. smoke run of the installed copy"
( cd "$DEST" && MCAI_ESTEL_SCRIPTS="$ESTEL" nice -n 19 python3 valuescore.py --day "$YDAY" --json "$HOME/digest/valuescore/$YDAY.json" ) \
  || { cp -p "$DEST/scoreboard.py.bak-$TS" "$DEST/scoreboard.py"; die "smoke run failed: scoreboard.py restored"; }
echo "== 6. cron"
crontab -l > "$DEST/crontab.bak-$TS"
if grep -qF "$MARK" "$DEST/crontab.bak-$TS"; then
  echo "   cron line already present"
else
  { cat "$DEST/crontab.bak-$TS"; echo "$CRON"; } | crontab -
  echo "   added: $CRON"
fi
echo "INSTALLED $TS: scoreboard.py $(md5sum < "$DEST/scoreboard.py" | cut -c1-8), valuescore.py $(md5sum < "$DEST/valuescore.py" | cut -c1-8); rollback: bash $0 --rollback"
