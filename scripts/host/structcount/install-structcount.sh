#!/bin/bash
# install-structcount.sh -- the structure count's install on 10.0.0.30 (building tier step 0). THE OPERATOR RUNS THIS; it is
# never run by an agent. Run it as mike from a checkout of the branch:
#
#     bash scripts/host/structcount/install-structcount.sh --check      # everything below except the cron line
#     bash scripts/host/structcount/install-structcount.sh --install    # the same, then the cron line and the first real run
#
# What it does (read-only on every world: the count reads COPIES of the nightly backup's staging, via sudo -n tar -c):
#   1. copies structcount.py, test_structcount.py, scread.py and serve.py into ~/structcount/bin (a stable copy; cron never
#      runs from a checkout or /opt/minecraft-ai);
#   2. runs the full test suite there (fixture world, blind-input and behaviour mutants, the daily pipeline, the Q8 hop);
#   3. a TRIAL publication into ~/structcount/trial (never the real out/), read back with the reader, which must say OK;
#   4. the overlapping-run fixture: two trial runs started together, exactly one must exit 8 (busy) and touch nothing;
#   5. a failed rerun from a same-day OK (--fail-at manifest_ok): the reader must then say UNKNOWN;
#   6. --install only: adds the cron lines (crontab backed up first; idempotent) and runs the first real count now, so the
#      3-day baseline starts today.
# Cron (mike, UTC): 03:45 then every 30 min to 05:45. A run before the backup has logged `good <today>` exits 0 and records
# no attempt; a run after today's OK exits 0 at once.
set -u
MODE=${1:---check}
case "$MODE" in --check|--install) ;; *) echo "usage: $0 --check | --install"; exit 2;; esac
SRC=$(cd "$(dirname "$0")" && pwd)
D=$HOME/structcount; B=$D/bin; T=$D/trial
LOG=/var/log/mcai-monitor/world-backup.log
say() { echo "== $*"; }
fail() { echo "!! INSTALL STOPPED: $*"; exit 1; }
[ "$(hostname)" = block2-worlds ] || fail "run this on 10.0.0.30 (block2-worlds), not $(hostname)"
sudo -n true 2>/dev/null || fail "sudo -n is needed to read the backup staging (read-only tar)"
mkdir -p "$B" "$D/out" "$D/attempts" || fail "cannot create $D"
for f in structcount.py test_structcount.py scread.py serve.py; do
  cp -p "$SRC/$f" "$B/.$f.new" && mv -f "$B/.$f.new" "$B/$f" || fail "copy $f"
done
say "1/5 copied into $B: $(cd "$B" && md5sum structcount.py test_structcount.py scread.py serve.py | tr '\n' ' ')"

say "2/5 the test suite"
python3 -B "$B/test_structcount.py" > "$D/install-tests.out" 2>&1 || { tail -20 "$D/install-tests.out"; fail "the test suite failed (full output $D/install-tests.out)"; }
tail -1 "$D/install-tests.out"

say "3/5 a trial publication from today's staging (into $T)"
rm -rf "$T"; mkdir -p "$T"
DAY=$(date -u +%F)
SKIP=""
if ! grep -q " good $DAY:" "$LOG" 2>/dev/null; then
  SKIP=--skip-backup-check
  echo "   (today's backup has not logged good $DAY yet: the trial reads the newest staging anyway)"
fi
TA="--out $T/out --attempts $T/attempts --work $T/work"
nice -n 19 python3 -B "$B/structcount.py" daily $TA $SKIP > "$T/run1.out" 2>&1; RC=$?
cat "$T/run1.out"
[ "$RC" = 0 ] || fail "the trial run exited $RC"
R=$(python3 "$B/scread.py" "$T/out" "$T/attempts"); echo "   reader: $R"
case "$R" in OK*) ;; *) fail "the reader did not say OK after the trial";; esac

say "4/5 the overlapping-run fixture"
( nice -n 19 python3 -B "$B/structcount.py" daily $TA $SKIP --force > "$T/runA.out" 2>&1; echo $? > "$T/runA.rc" ) &
sleep 0.3
( nice -n 19 python3 -B "$B/structcount.py" daily $TA $SKIP --force > "$T/runB.out" 2>&1; echo $? > "$T/runB.rc" ) &
wait
A=$(cat "$T/runA.rc"); Bc=$(cat "$T/runB.rc"); echo "   exit codes: first $A, second $Bc ($(head -1 "$T/runB.out"))"
[ "$A" = 0 ] && [ "$Bc" = 8 ] || fail "want 0 and 8 (busy)"
R=$(python3 "$B/scread.py" "$T/out" "$T/attempts"); echo "   reader: $R"
case "$R" in OK*) ;; *) fail "the reader did not say OK after the overlapping runs";; esac

say "5/5 a failed rerun from a same-day OK"
nice -n 19 python3 -B "$B/structcount.py" daily $TA $SKIP --force --fail-at manifest_ok > "$T/run5.out" 2>&1; RC=$?
echo "   exit $RC: $(tail -1 "$T/run5.out")"
R=$(python3 "$B/scread.py" "$T/out" "$T/attempts"); echo "   reader: $R"
case "$R" in UNKNOWN*) ;; *) fail "the reader did not say UNKNOWN after a failed rerun";; esac
rm -rf "$T/work"

if [ "$MODE" = --check ]; then
  say "CHECK PASSED. Nothing installed in cron. Re-run with --install to add the cron lines and start the baseline."
  exit 0
fi

say "installing the cron lines"
MARK='# structcount (building tier step 0)'
crontab -l > "$D/crontab.bak-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
if crontab -l 2>/dev/null | grep -qF "$MARK"; then
  echo "   already installed"
else
  CMD="cd $B && /usr/bin/nice -n 19 /usr/bin/python3 -B structcount.py daily >> $D/daily.log 2>&1"
  { crontab -l 2>/dev/null; echo "$MARK -- docs/reports/building-tier-2026-10-23.md section 2; reader: python3 $B/scread.py $D/out $D/attempts"
    echo "45 3 * * * $CMD"; echo "15,45 4,5 * * * $CMD"; } | crontab - || fail "crontab"
  crontab -l | grep -A2 -F "$MARK"
fi
say "the first real count now (the baseline starts today)"
nice -n 19 python3 -B "$B/structcount.py" daily >> "$D/daily.log" 2>&1; RC=$?     # never --skip-backup-check: the real count waits for the backup
tail -3 "$D/daily.log"
echo "   reader: $(python3 "$B/scread.py" "$D/out" "$D/attempts")"
say "INSTALLED (exit $RC). Next: install-structcount-key.sh (Q8) so 10.0.0.31 can mirror it."
