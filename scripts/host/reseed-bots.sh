#!/usr/bin/env bash
# reseed-bots.sh -- the BOT half of a pool reseed. Runs on 10.0.0.31.
#
#   sudo ./reseed-bots.sh <RESEED-HANDOFF.json> [--go] [--keep-lessons]
#
# The other half is reseed-world.sh on 10.0.0.30, which writes the handoff file.
# There is no inter-host ssh, so the file is carried across by hand -- see that
# script's header for why the documented one-command reseeder cannot exist.
#
# DRY RUN IS THE DEFAULT. Without --go it prints every action and touches nothing.
#
# WHAT IT DOES AND DOES NOT PRESERVE. The bots' inventories live in the WORLD, in
# world/playerdata, so archiving the world has already destroyed them -- the
# 10,125 saplings the fleet was holding on 2026-09-27 do not survive a reseed and
# the planting obligation has nothing to plant until the bots gather more. That is
# a real cost of reseeding and it is not this script's to avoid: carrying playerdata
# into a freshly generated world would place bots at coordinates chosen for
# different terrain, and giving a bot items it did not gather in the world it is in
# is the thing the owner's "do not change the world to fix a bot" forbids.
#
# The LESSONS (/var/lib/mcai/<bot>/lessons-<bot>.json) are a separate question and
# this script archives them by default, byte-for-byte as the 19 Sep reseed of
# placebo-a/b did -- those archives are still on disk and are the only prior art
# this operation has. --keep-lessons leaves them in place; use it only knowing that
# place-scoped avoid rules then name coordinates in a world that no longer exists.
set -euo pipefail

HANDOFF=""; GO=0; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --go) GO=1; shift ;;
    --keep-lessons) KEEP=1; shift ;;
    -*) echo "unknown flag $1" >&2; exit 2 ;;
    *) [ -z "$HANDOFF" ] || { echo "ONE HANDOFF PER INVOCATION" >&2; exit 2; }
       HANDOFF="$1"; shift ;;
  esac
done
[ -n "$HANDOFF" ] || { echo "usage: sudo $0 <RESEED-HANDOFF.json> [--go] [--keep-lessons]" >&2; exit 2; }
[ -f "$HANDOFF" ] || { echo "$HANDOFF not found -- it is written by reseed-world.sh on .30" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run under sudo: /var/lib/mcai and the env files are root-owned" >&2; exit 2; }

ENVDIR=/srv/mcbots/harness/env
STATEDIR=/var/lib/mcai
# Overridable ONLY so the canary refusal below can be exercised. My first test of
# that guard passed `env MANIFEST=...` at a hardcoded path and the guard silently
# did not fire -- a guard that has never been seen to fire is not a guard, and a
# test that cannot reach it reads as a pass.
MANIFEST="${MANIFEST:-/srv/mcbots/trial-manifest.json}"
say() { printf '%s\n' "$*"; }
run() { if [ "$GO" = 1 ]; then say "  RUN  $*"; "$@"; else say "  dry  $*"; fi; }

eval "$(python3 - "$HANDOFF" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
# The caller `eval`s this script's STDOUT, so a complaint must go to stdout as
# shell to run -- sys.exit(msg) writes to stderr, the eval captures nothing, and
# the failure surfaced as `POOL: unbound variable` instead of the reason. Found by
# feeding it a handoff with only `pool`.
missing = [k for k in ('pool', 'ts', 'new_seed', 'home', 'board') if k not in d]
if missing:
    print("echo 'handoff %s is missing: %s' >&2; exit 2" % (sys.argv[1], ', '.join(missing)))
    sys.exit(0)
hx, hy, hz = d['home']; bx, by, bz = d['board']
print(f"POOL={d['pool']}; TS={d['ts']}; SEED={d['new_seed']}")
print(f"HX={hx}; HY={hy}; HZ={hz}; BX={bx}; BY={by}; BZ={bz}")
PY
)"

# A CANARY IS A SECOND CODE VERSION. Restarting a pool's bots during one is how a
# canary dissolves; and a reseed of the canary's own pool destroys its exposure.
CP="$(python3 -c "import json; print((json.load(open('$MANIFEST')).get('canary_pool') or '').strip())")"
if [ -n "$CP" ]; then
  echo "REFUSING: the manifest declares canary_pool='$CP'. Read and close it first" >&2
  echo "(check-open-loop.py), then tear it down, then reseed." >&2
  exit 2
fi

# THE ROSTER IS DERIVED FROM THE ENV FILES THAT EXIST, never from a name list. The
# fleet has 84 mcbot unit instances for 80 bots: every pool's *-Charlie has a unit
# and NO env file, has never started, and is reported `failed`. A hand-kept roster
# is how it gets started by accident.
mapfile -t BOTS < <(cd "$ENVDIR" && ls "$POOL"-*.env 2>/dev/null | sed 's/\.env$//')
[ "${#BOTS[@]}" -gt 0 ] || { echo "no env file matches $ENVDIR/$POOL-*.env" >&2; exit 2; }
if [ "${#BOTS[@]}" != 5 ]; then
  echo "REFUSING: $POOL has ${#BOTS[@]} env files, expected 5: ${BOTS[*]}" >&2
  exit 2
fi
for b in "${BOTS[@]}"; do
  [ -e "$STATEDIR/$b.pre-reseed-$TS" ] && { echo "archive target $STATEDIR/$b.pre-reseed-$TS exists -- refusing" >&2; exit 2; }
done

say "reseed-bots $POOL   $( [ "$GO" = 1 ] && echo '*** LIVE ***' || echo '(dry run -- pass --go)')"
say "  handoff     $HANDOFF (ts $TS, seed $SEED)"
say "  roster      ${BOTS[*]}"
say "  new home    $HX,$HY,$HZ     new board  $BX,$BY,$BZ"
say "  old home    $(grep -h '^HOME_' "$ENVDIR/${BOTS[0]}.env" | tr '\n' ' ')"
say "  lessons     $( [ "$KEEP" = 1 ] && echo 'KEPT (--keep-lessons)' || echo 'archived' )"

say "1. stop the pool's bots (Charlie is not in the roster and is not touched)"
for b in "${BOTS[@]}"; do run systemctl stop "mcbot@$b.service"; done
say "2. archive the accumulated lessons, exactly as the 19 Sep reseed named them"
if [ "$KEEP" = 0 ]; then
  for b in "${BOTS[@]}"; do
    [ -d "$STATEDIR/$b" ] && run mv "$STATEDIR/$b" "$STATEDIR/$b.pre-reseed-$TS" || say "  --   $STATEDIR/$b does not exist"
  done
  [ -d "$STATEDIR/_pool-$POOL" ] && run mv "$STATEDIR/_pool-$POOL" "$STATEDIR/_pool-$POOL.pre-reseed-$TS" || say "  --   $STATEDIR/_pool-$POOL does not exist"
else
  say "  --   lessons kept in place"
fi
say "3. point the env files at the new town (each backed up first)"
for b in "${BOTS[@]}"; do
  f="$ENVDIR/$b.env"
  run cp -a "$f" "$f.bak-$TS"
  if [ "$GO" = 1 ]; then
    python3 - "$f" "$HX" "$HY" "$HZ" "$BX" "$BY" "$BZ" <<'PY'
import os, re, sys
f = sys.argv[1]; vals = dict(zip(('HOME_X','HOME_Y','HOME_Z','BOARD_X','BOARD_Y','BOARD_Z'), sys.argv[2:8]))
src = open(f).read()
for k in vals:
    n = len(re.findall(r'(?m)^%s=' % k, src))
    assert n == 1, f"ANCHOR {k} appears {n} times in {f}, expected 1"
for k, v in vals.items():
    src = re.sub(r'(?m)^%s=.*$' % k, f'{k}={v}', src)
open(f + '.tmp', 'w').write(src); os.replace(f + '.tmp', f)
print("  RUN  rewrote HOME_*/BOARD_* in", f)
PY
  else
    say "  dry  rewrite HOME_X/Y/Z=$HX/$HY/$HZ BOARD_X/Y/Z=$BX/$BY/$BZ in $f"
  fi
done
say "4. start the bots staggered 12s -- a simultaneous start of five clients on one"
say "   world is the load pattern the fleet-restart protocol exists to avoid"
for i in "${!BOTS[@]}"; do
  [ "$i" -gt 0 ] && run sleep 12
  run systemctl start "mcbot@${BOTS[$i]}.service"
done
say "5. units after the start"
if [ "$GO" = 1 ]; then
  sleep 5
  for b in "${BOTS[@]}"; do printf '   %-22s %s\n' "$b" "$(systemctl is-active "mcbot@$b.service")"; done
else
  say "  dry  systemctl is-active for each"
fi
say
say "VERIFY FROM 10.0.0.30 -- five ACTIVE units is not five bots in a world:"
say "  rcon 'list' on the pool's port must show 5 players"
say "and from here, that the pool emits telemetry again, and that the first"
say "_plant_spot appears -- the reseed destroyed the saplings with the old world's"
say "playerdata, so time-to-first-planting is the number this reseed must be judged on."
