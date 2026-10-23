#!/bin/bash
# install-coophost.sh -- STAGED installer for the cooperation tier's host tools (design r9.1 B0a, B1, X1). Run on 10.0.0.31
# by the OPERATOR, from a checkout of the branch that carries these files (never from /opt/minecraft-ai: a deploy resets
# that tree). It changes no bot, queue, scheduler, manifest or env; it only copies host scripts and (with --cron) adds
# crontab lines. Idempotent; every replaced file is kept as <file>.bak-<UTC stamp>.
#
#   bash scripts/host/install-coophost.sh            # copy + self-tests + one live census tick into a scratch dir; print cron
#   bash scripts/host/install-coophost.sh --cron     # the same, then append the cron lines (skipped if already present)
#
#   B0a  staffcensus.py + check-staffcensus.py  -> ~/staffcensus/scripts/host/ (the standing S0 census; the next tick seeds
#        its capability state, out/capability-state.json, by one bounded walk)
#   B1   coopread.py (daily cooperation census)  -> ~/coopread/scripts/host/ (+ lib/telemetry.py)
#   X1   sightread.py (sighting-quality read)    -> ~/coopread/scripts/host/ (run by hand; no cron)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CRON=0; [ "${1:-}" = "--cron" ] && CRON=1

put() {   # put <src> <dst-dir>
  local f="$1" d="$2" b; b="$(basename "$f")"
  mkdir -p "$d"
  if [ -f "$d/$b" ] && ! cmp -s "$f" "$d/$b"; then cp -p "$d/$b" "$d/$b.bak-$STAMP"; echo "  backup $d/$b.bak-$STAMP"; fi
  cp "$f" "$d/$b"; echo "  installed $d/$b ($(md5sum "$d/$b" | cut -c1-8))"
}

echo "== self-tests from the source tree ($SRC)"
( cd "$SRC/scripts/host" && python3 -B staffcensus.py --selftest >/dev/null && echo "  staffcensus selftest OK" )
( cd "$SRC/scripts/host" && python3 -B coopread.py --selftest >/dev/null && echo "  coopread selftest OK" )
( cd "$SRC/scripts/host" && python3 -B sightread.py --selftest >/dev/null && echo "  sightread selftest OK" )

echo "== B0a: the S0 census"
put "$SRC/scripts/host/staffcensus.py" "$HOME/staffcensus/scripts/host"
put "$SRC/scripts/host/check-staffcensus.py" "$HOME/staffcensus/scripts/host"
echo "  (the cron lines for S0 are unchanged; the next */5 tick picks the new file up and seeds capability-state.json)"

echo "== B1 + X1: the cooperation census and the sighting read"
put "$SRC/scripts/host/coopread.py" "$HOME/coopread/scripts/host"
put "$SRC/scripts/host/sightread.py" "$HOME/coopread/scripts/host"
put "$SRC/scripts/lib/telemetry.py" "$HOME/coopread/scripts/lib"
touch "$HOME/coopread/scripts/lib/__init__.py"
mkdir -p "$HOME/coopread/out" "$HOME/sightread/out"

echo "== one live S0 window into a scratch dir (nothing written to ~/staffcensus/out)"
SCR="$(mktemp -d)"
( cd "$HOME/staffcensus" && nice -n 19 python3 -B scripts/host/staffcensus.py --window 1 --out-dir "$SCR" | grep -E "RECORD WITHOUT|capability|PROJECT" || true )
rm -rf "$SCR"

LINES='20 2 * * * cd /home/mike/coopread && /usr/bin/nice -n 19 /usr/bin/python3 -B scripts/host/coopread.py --day --out-dir /home/mike/coopread/out >> /home/mike/coopread/out/day.log 2>&1'
echo "== cron (B1 daily at 02:20Z; S0's own lines are already installed)"
echo "  $LINES"
echo "  fleetstatus line: python3 -B /home/mike/coopread/scripts/host/coopread.py --line"
if [ "$CRON" = 1 ]; then
  if crontab -l 2>/dev/null | grep -qF 'scripts/host/coopread.py --day'; then echo "  cron already present"; else
    ( crontab -l 2>/dev/null; echo "$LINES" ) | crontab -; echo "  cron added"; fi
fi
echo "done."
