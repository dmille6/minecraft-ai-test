#!/usr/bin/env bash
# install-valuescore.sh -- STAGED installer for the value-weighted scoreboard (docs/reports/valuescore-2026-10-23.md).
# The coordinator (or the owner) runs it on 10.0.0.31 as mike, from a checkout or copy of this branch. Nothing is
# installed until --apply.
#
#   bash scripts/host/install-valuescore.sh             # DRY RUN: checks and a smoke run from this checkout; changes nothing
#   bash scripts/host/install-valuescore.sh --apply     # install into ~/mcai-analysis + add ONE cron line
#   bash scripts/host/install-valuescore.sh --rollback  # undo exactly what the newest --apply recorded, and nothing else
#
# --apply, in order (any failure after step 4 begins restores the complete prior state: files AND crontab):
#   1. the self-test (test_valuescore.py) passes from this checkout;
#   2. ~/estel/scripts/lib/estelemetry.py is md5-identical to this checkout's scripts/lib/estelemetry.py;
#   3. ~/mcai-analysis/scoreboard.py is the version this branch was written against (md5 a27acb0e...);
#   4. records a STATE file (~/mcai-analysis/.valuescore-install-<ts>.state): the scoreboard.py backup path, whether
#      valuescore.py / test_valuescore.py already existed (and their backups), and the crontab backup (or "none");
#   5. copies scoreboard.py, valuescore.py, test_valuescore.py into ~/mcai-analysis/;
#   6. smoke run of the INSTALLED copy for yesterday (it raises ValueBlind on a blind input);
#   7. adds the cron line (00:50Z daily, nice 19) unless that EXACT line is already there.
# --rollback reads the newest state file: restores scoreboard.py from ITS backup, restores or removes the two companion
# files as recorded, and removes the ONE exact cron line only if THIS install added it (other lines, look-alikes, and a
# line that was already there before the install are untouched). A `crontab -l` error other than "no crontab" refuses.
# Temporary files live under $HOME only.
# Read-only on the fleet throughout: ES searches with the read-only key; files under ~ only.
set -euo pipefail
MODE="${1:-dry}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SRC/../.." && pwd)"
DEST="$HOME/mcai-analysis"
ESTEL="$HOME/estel/scripts"
EXPECT_OLD='a27acb0ecd04cd91dc453576f2b2f1ec'
TS="$(date -u +%Y%m%dT%H%M%SZ)"
YDAY="$(date -u -d yesterday +%F)"
CRON="50 0 * * * cd $DEST && MCAI_ESTEL_SCRIPTS=$ESTEL nice -n 19 /usr/bin/python3 valuescore.py --json $HOME/digest/valuescore/\$(date -u -d yesterday +\\%F).json >> $HOME/digest/valuescore.log 2>&1 # valuescore-1023"

die() { echo "REFUSED: $*" >&2; exit 2; }
# every temporary file under $HOME (Codex r2 P3); Python's tempfile (the self-test's mutants) follows TMPDIR
TMPD="$(mktemp -d "$HOME/.valuescore-tmp.XXXXXX")"; export TMPDIR="$TMPD"
trap 'rm -rf "$TMPD"' EXIT
md5() { md5sum < "$1" | cut -d' ' -f1; }
# `crontab -l` exits 1 both for "no crontab for mike" and for real errors: only the first reads as empty (Codex r2 P2-2).
cron_get() {
  local out err rc
  rc=0; out="$(crontab -l 2> "$TMPD/cron.err")" || rc=$?       # `|| rc=` keeps set -e from exiting on a failed read
  if [ $rc -ne 0 ]; then
    if grep -q '^no crontab for' "$TMPD/cron.err"; then return 0; fi
    echo "REFUSED: crontab -l failed: $(cat "$TMPD/cron.err")" >&2; exit 2
  fi
  printf '%s\n' "$out"
}
cron_put() { if [ -s "$1" ]; then crontab "$1"; else crontab -r 2>/dev/null || true; fi; }
[ "$(id -un)" = mike ] || die "run as mike on 10.0.0.31"
[ "$(hostname)" = block2-bots ] || die "run on 10.0.0.31 (block2-bots), not $(hostname)"

if [ "$MODE" = --rollback ]; then
  STATE="$(ls -1t "$DEST"/.valuescore-install-*.state 2>/dev/null | head -1 || true)"
  [ -n "$STATE" ] || die "no .valuescore-install-*.state in $DEST: nothing this installer did to undo"
  # shellcheck disable=SC1090
  . "$STATE"
  [ -n "${INSTALLED_SB_MD5:-}" ] || die "$STATE has no INSTALLED_SB_MD5 (the install did not complete); restore by hand from it"
  [ "$(md5 "$DEST/scoreboard.py")" = "$INSTALLED_SB_MD5" ] \
    || die "~/mcai-analysis/scoreboard.py changed since this install (md5 $(md5 "$DEST/scoreboard.py") != $INSTALLED_SB_MD5): not overwriting someone else's edit"
  cp -p "$SB_BACKUP" "$DEST/scoreboard.py"
  for f in valuescore.py test_valuescore.py; do
    v="BK_${f%%.py}"; b="${!v:-}"
    if [ -n "$b" ]; then cp -p "$b" "$DEST/$f"; else rm -f "$DEST/$f"; fi
  done
  if [ "${CRON_ADDED:-0}" = 1 ]; then                            # remove the line only if THIS install added it
    cron_get > "$TMPD/cron.now"
    grep -vxF -- "$CRON_LINE" "$TMPD/cron.now" > "$TMPD/cron.new" || true   # exact line only; an empty result is fine
    cron_put "$TMPD/cron.new"
  fi
  mv "$STATE" "$STATE.rolled-back-$TS"
  echo "rolled back $STATE: scoreboard.py <- $SB_BACKUP (md5 $(md5 "$DEST/scoreboard.py" | cut -c1-8)); exact cron line present: $(cron_get | grep -cxF -- "$CRON_LINE" || true)"
  exit 0
fi

echo "== 1. self-test from $SRC"
python3 "$SRC/test_valuescore.py" > "$TMPD/selftest" || { tail -5 "$TMPD/selftest"; die "self-test failed"; }
tail -1 "$TMPD/selftest"

echo "== 2. estelemetry copy"
A="$(md5 "$ESTEL/lib/estelemetry.py")"; B="$(md5 "$REPO/scripts/lib/estelemetry.py")"
echo "   ~/estel $A   repo $B"
[ "$A" = "$B" ] || die "~/estel/scripts/lib/estelemetry.py differs from the repo copy: refresh ~/estel first"

echo "== 3. installed scoreboard.py"
CUR="$(md5 "$DEST/scoreboard.py")"
echo "   md5 $CUR (expected $EXPECT_OLD)"
[ "$CUR" = "$EXPECT_OLD" ] || die "~/mcai-analysis/scoreboard.py is not the version this branch was written against; merge first"

echo "== smoke run from the checkout (yesterday, $YDAY)"
MCAI_ESTEL_SCRIPTS="$ESTEL" nice -n 19 python3 "$SRC/valuescore.py" --day "$YDAY" > "$TMPD/smoke" \
  || { cat "$TMPD/smoke"; die "smoke run from the checkout failed"; }
sed -n 1,3p "$TMPD/smoke"

if [ "$MODE" != --apply ]; then
  echo
  echo "DRY RUN: nothing changed. --apply would install scoreboard.py, valuescore.py, test_valuescore.py into $DEST"
  echo "(every replaced file and the crontab backed up first, recorded in a state file) and add this cron line:"
  echo "   $CRON"
  exit 0
fi

echo "== 4. state + backups"
STATE="$DEST/.valuescore-install-$TS.state"
SB_BACKUP="$DEST/scoreboard.py.bak-$TS"; cp -p "$DEST/scoreboard.py" "$SB_BACKUP"
BK_valuescore=""; BK_test_valuescore=""
[ -e "$DEST/valuescore.py" ] && { BK_valuescore="$DEST/valuescore.py.bak-$TS"; cp -p "$DEST/valuescore.py" "$BK_valuescore"; }
[ -e "$DEST/test_valuescore.py" ] && { BK_test_valuescore="$DEST/test_valuescore.py.bak-$TS"; cp -p "$DEST/test_valuescore.py" "$BK_test_valuescore"; }
CRON_BACKUP="$DEST/crontab.bak-$TS"; cron_get > "$CRON_BACKUP"      # a real crontab -l error stops here, before any change
printf 'SB_BACKUP=%q\nBK_valuescore=%q\nBK_test_valuescore=%q\nCRON_BACKUP=%q\nCRON_LINE=%q\nCRON_ADDED=0\n' \
  "$SB_BACKUP" "$BK_valuescore" "$BK_test_valuescore" "$CRON_BACKUP" "$CRON" > "$STATE"
restore() {
  echo "FAILED during --apply: restoring the prior state from $STATE" >&2
  cp -p "$SB_BACKUP" "$DEST/scoreboard.py"
  if [ -n "$BK_valuescore" ]; then cp -p "$BK_valuescore" "$DEST/valuescore.py"; else rm -f "$DEST/valuescore.py"; fi
  if [ -n "$BK_test_valuescore" ]; then cp -p "$BK_test_valuescore" "$DEST/test_valuescore.py"; else rm -f "$DEST/test_valuescore.py"; fi
  cron_put "$CRON_BACKUP"
  mv "$STATE" "$STATE.failed"
}
trap 'restore; rm -rf "$TMPD"' ERR

echo "== 5. install"
install -m 0644 "$SRC/scoreboard.py" "$SRC/valuescore.py" "$SRC/test_valuescore.py" "$DEST/"
mkdir -p "$HOME/digest/valuescore"

echo "== 6. smoke run of the installed copy"
( cd "$DEST" && MCAI_ESTEL_SCRIPTS="$ESTEL" nice -n 19 python3 valuescore.py --day "$YDAY" --json "$HOME/digest/valuescore/$YDAY.json" ) > /dev/null

echo "== 7. cron"
if grep -qxF -- "$CRON" "$CRON_BACKUP"; then
  echo "   the exact cron line is already present"
else
  { cat "$CRON_BACKUP"; echo "$CRON"; } > "$CRON_BACKUP.new"
  crontab "$CRON_BACKUP.new"; rm -f "$CRON_BACKUP.new"
  echo 'CRON_ADDED=1' >> "$STATE"
  echo "   added: $CRON"
fi
echo "INSTALLED_SB_MD5=$(md5 "$DEST/scoreboard.py")" >> "$STATE"
trap - ERR
echo "INSTALLED $TS: scoreboard.py $(md5 "$DEST/scoreboard.py" | cut -c1-8), valuescore.py $(md5 "$DEST/valuescore.py" | cut -c1-8); state $STATE; undo: bash $0 --rollback"
