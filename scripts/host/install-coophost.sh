#!/bin/bash
# install-coophost.sh -- STAGED installer for the cooperation tier's host tools (design r9.1 B0a, B1, X1). Run on 10.0.0.31
# by the OPERATOR, from a checkout of the branch that carries these files (never from /opt/minecraft-ai: a deploy resets
# that tree). It changes no bot, queue, scheduler, manifest or env; it copies host scripts, patches the installed
# fleetstatus.py with the B1 header line (three anchored edits, backup first), and with --cron adds B1's crontab line.
# Idempotent; every replaced file is kept as <file>.bak-<UTC stamp>.
#
#   bash scripts/host/install-coophost.sh            # self-tests, copy, fleetstatus line, a live S0 window into a scratch dir
#   bash scripts/host/install-coophost.sh --cron     # the same, then append B1's cron line (skipped if already present)
#
#   B0a  staffcensus.py + check-staffcensus.py -> ~/staffcensus/scripts/host/. The standing */5 tick picks the new file up;
#        its first tick seeds out/capability-state.json PER BOT (1, 3, then 7 days back until every present bot's build
#        has a spawn row) and re-walks hourly while any bot is still missing one; an empty seed is never saved.
#   B1   coopread.py (daily cooperation census) -> ~/coopread/scripts/host/ (+ lib/telemetry.py); its line in fleetstatus
#   X1   sightread.py (sighting-quality read)   -> ~/coopread/scripts/host/ (run by hand; no cron)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
case "$SRC" in /opt/minecraft-ai*) echo "REFUSED: run from a checkout outside /opt/minecraft-ai (a deploy resets that tree)"; exit 1;; esac
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

echo "== B1 + X1: the cooperation census and the sighting read"
put "$SRC/scripts/host/coopread.py" "$HOME/coopread/scripts/host"
put "$SRC/scripts/host/sightread.py" "$HOME/coopread/scripts/host"
put "$SRC/scripts/lib/telemetry.py" "$HOME/coopread/scripts/lib"
touch "$HOME/coopread/scripts/lib/__init__.py"
mkdir -p "$HOME/coopread/out" "$HOME/sightread/out"

echo "== the B1 line in the INSTALLED fleetstatus.py (patched in place, never replaced)"
python3 -B "$SRC/scripts/host/patch-fleetstatus-coop.py" "$HOME/estel/scripts/host/fleetstatus.py"

echo "== one live S0 window into a scratch dir (nothing written to ~/staffcensus/out)"
SCR="$(mktemp -d)"
if ! ( cd "$HOME/staffcensus" && nice -n 19 python3 -B scripts/host/staffcensus.py --window 1 --out-dir "$SCR" > "$SCR/out.txt" 2>&1 ); then
  echo "  !! the live window FAILED -- its tail:"; tail -20 "$SCR/out.txt"; rm -rf "$SCR"; exit 1
fi
grep -E "seed walk|RECORD WITHOUT|capability|PROJECT" "$SCR/out.txt" || true
rm -rf "$SCR"

LINE='20 2 * * * cd /home/mike/coopread && /usr/bin/nice -n 19 /usr/bin/python3 -B scripts/host/coopread.py --day --out-dir /home/mike/coopread/out >> /home/mike/coopread/out/day.log 2>&1'
echo "== cron (B1 daily at 02:20Z; S0's own lines are already installed)"
echo "  $LINE"
if [ "$CRON" = 1 ]; then
  CUR="$(crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$CUR" | grep -qF 'scripts/host/coopread.py --day'; then echo "  cron already present"
  else
    printf '%s\n%s\n' "$CUR" "$LINE" | crontab -
    crontab -l | grep -qF 'scripts/host/coopread.py --day' && echo "  cron added" || { echo "  !! cron NOT added"; exit 1; }
  fi
fi
echo "done."
