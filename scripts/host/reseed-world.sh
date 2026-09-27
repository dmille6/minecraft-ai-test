#!/usr/bin/env bash
# reseed-world.sh -- the WORLD half of a pool reseed. Runs on 10.0.0.30.
#
# WHY TWO SCRIPTS AND NOT ONE. docs/reports/seed-canary-registration.md:11 claims a
# `scripts/reseed-pool.sh <pool> --go` that "gained a guarded --new-seed so the next
# one is one command, not hand work". It does not exist on either host or in the
# repo. It cannot: the worlds live on .30, the bots and their state live on .31, and
# THERE IS NO INTER-HOST SSH IN EITHER DIRECTION (verified 2026-09-27 11:52Z, both
# ways, "Permission denied (publickey)"; archive-state.sh's header says the same).
# So the operation is two scripts with a handoff file the operator carries across,
# and the documentation that promised one command was promising something the
# network layout forbids.
#
#   sudo ./reseed-world.sh <pool> [--new-seed N] [--go]
#
# DRY RUN IS THE DEFAULT. Without --go it prints every action and touches nothing.
# It writes /srv/block2/<pool>/RESEED-HANDOFF.json, which reseed-bots.sh on .31
# consumes -- copy it across by hand.
#
# It archives rather than deletes: `world` -> `world.pre-reseed-<ts>` and
# `TOWN-PLACED.json` likewise, which is byte-for-byte the naming the 19 Sep reseed
# of placebo-a/b used and which is still on disk. Nothing here is recoverable from a
# backup that was never taken, so nothing here deletes.
set -euo pipefail

POOL=""; SEED=""; GO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --new-seed) SEED="${2:?--new-seed needs a value}"; shift 2 ;;
    --go) GO=1; shift ;;
    -*) echo "unknown flag $1" >&2; exit 2 ;;
    *) [ -z "$POOL" ] || { echo "ONE POOL PER INVOCATION. A loop over sixteen worlds is how sixteen worlds are lost at once." >&2; exit 2; }
       POOL="$1"; shift ;;
  esac
done
[ -n "$POOL" ] || { echo "usage: sudo $0 <pool> [--new-seed N] [--go]" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run under sudo: server.properties is root-only" >&2; exit 2; }

ROOT=/srv/block2
# RESEED_TS is a seam for the guard test: the "archive target already exists"
# refusal is otherwise unreachable from outside, because the stamp is generated
# per run. A guard nobody has seen fire is not a guard.
TS="${RESEED_TS:-$(date -u +%Y%m%dT%H%M%SZ)}"
D="$ROOT/$POOL"
say() { printf '%s\n' "$*"; }
run() { if [ "$GO" = 1 ]; then say "  RUN  $*"; "$@"; else say "  dry  $*"; fi; }

# A POOL IS A WORLD THAT EXISTS AND HAS A TOWN. This is the same test place-town.py
# now derives its map from, so the two cannot disagree -- the previous failure was a
# hand-kept eight-world list against a sixteen-world fleet, twice.
[ -d "$D" ] || { echo "$D does not exist" >&2; exit 2; }
[ -f "$D/TOWN-PLACED.json" ] || { echo "$D has no TOWN-PLACED.json -- not a fleet world (sandbox* and template are not)" >&2; exit 2; }
systemctl cat "block2@$POOL.service" >/dev/null 2>&1 || { echo "no block2@$POOL.service" >&2; exit 2; }
for t in "$D/world.pre-reseed-$TS" "$D/TOWN-PLACED.pre-reseed-$TS.json"; do
  [ -e "$t" ] && { echo "archive target $t already exists -- refusing to overwrite an archive" >&2; exit 2; }
done

OLD_SEED="$(grep -E '^level-seed=' "$D/server.properties" | cut -d= -f2)"
OLD_TOWN="$(python3 -c "import json,sys; d=json.load(open('$D/TOWN-PLACED.json')); print(d['home'], d['board'], d.get('rcon_port'))")"
PORT="$(grep -E '^rcon.port=' "$D/server.properties" | cut -d= -f2)"
PW="$(grep -E '^rcon.password=' "$D/server.properties" | cut -d= -f2)"
# A SEED WE DID NOT CHOOSE IS A SEED WE CANNOT RE-CREATE. Recorded in the handoff.
[ -n "$SEED" ] || SEED="$(python3 -c 'import secrets; print(secrets.randbelow(2**63))')"
[ "$SEED" != "$OLD_SEED" ] || { echo "the new seed equals the old one ($SEED) -- that is not a reseed" >&2; exit 2; }

say "reseed-world $POOL   $( [ "$GO" = 1 ] && echo '*** LIVE ***' || echo '(dry run -- pass --go)')"
say "  ts          $TS"
say "  old seed    $OLD_SEED"
say "  NEW seed    $SEED"
say "  old town    $OLD_TOWN"
say "  rcon        127.0.0.1:$PORT"
say "  world size  $(du -sh "$D/world" 2>/dev/null | cut -f1)   free: $(df -h "$ROOT" | awk 'NR==2{print $4}')"

say "1. stop the server"
run systemctl stop "block2@$POOL.service"
say "2. archive the world and the town (MOVE, so there is no half-copied world)"
run mv "$D/world" "$D/world.pre-reseed-$TS"
run mv "$D/TOWN-PLACED.json" "$D/TOWN-PLACED.pre-reseed-$TS.json"
say "3. write the new seed (server.properties backed up first)"
run cp -a "$D/server.properties" "$D/server.properties.bak-$TS"
if [ "$GO" = 1 ]; then
  python3 - "$D/server.properties" "$SEED" <<'PY'
import os, re, sys
p, seed = sys.argv[1], sys.argv[2]
src = open(p).read()
assert re.search(r'(?m)^level-seed=', src), "ANCHOR MISSING: no level-seed line"
assert len(re.findall(r'(?m)^level-seed=', src)) == 1, "ANCHOR NOT UNIQUE"
out = re.sub(r'(?m)^level-seed=.*$', 'level-seed=' + seed, src)
# Never open(p,'w') with something that might not be a string: it truncates before
# it raises. Temp file plus os.replace, every time.
open(p + '.tmp', 'w').write(out); os.replace(p + '.tmp', p)
print("  RUN  level-seed=" + seed)
PY
else
  say "  dry  sed level-seed=$OLD_SEED -> level-seed=$SEED in $D/server.properties"
fi
say "4. start the server and wait for RCON to answer (the world generates now)"
run systemctl start "block2@$POOL.service"
if [ "$GO" = 1 ]; then
  for i in $(seq 1 60); do
    if python3 -c "
import socket,struct,sys
s=socket.create_connection(('127.0.0.1',$PORT),3)
def c(k,b):
    p=struct.pack('<ii',1,k)+b.encode()+b'\x00\x00'; s.sendall(struct.pack('<i',len(p))+p)
    n=struct.unpack('<i',s.recv(4))[0]; rid,_=struct.unpack('<ii',s.recv(8)); s.recv(n-8)
    return rid
sys.exit(0 if c(3,'$PW')!=-1 else 1)" 2>/dev/null; then say "  RCON up after ${i}s"; break; fi
    sleep 1
    [ "$i" = 60 ] && { echo "RCON never came up on $PORT -- the world did not start. Archive is intact at world.pre-reseed-$TS" >&2; exit 1; }
  done
fi
say "5. pregenerate the operating radius around 0,0, BEFORE the town is sited"
say "   (the town search spirals out to rings*step = 480 blocks, inside pregen's 512)"
run python3 /home/mike/scripts/pregen-world.py "$POOL" --x 0 --z 0 --radius 512
say "6. site the town -- place-town re-scores whatever it picks, so a bad site refuses"
run python3 /home/mike/scripts/place-town.py "$POOL" --force
say "7. write the handoff that .31's half consumes"
if [ "$GO" = 1 ]; then
  python3 - "$D" "$POOL" "$SEED" "$OLD_SEED" "$TS" <<'PY'
import json, os, sys
d, pool, seed, old, ts = sys.argv[1:6]
town = json.load(open(os.path.join(d, 'TOWN-PLACED.json')))
out = {'pool': pool, 'ts': ts, 'new_seed': seed, 'old_seed': old,
       'home': town['home'], 'board': town['board'],
       'rcon_port': town.get('rcon_port'),
       'world_archive': f'world.pre-reseed-{ts}',
       'note': 'consumed by reseed-bots.sh on 10.0.0.31 -- carry this file across by hand'}
p = os.path.join(d, 'RESEED-HANDOFF.json')
open(p + '.tmp', 'w').write(json.dumps(out, indent=2)); os.replace(p + '.tmp', p)
print('  RUN  wrote', p); print(json.dumps(out, indent=2))
PY
else
  say "  dry  write $D/RESEED-HANDOFF.json with the new town from place-town"
fi
say
say "NEXT, ON 10.0.0.31 -- the bots still hold the OLD town coordinates and the old"
say "lessons, and they are pointed at a world that no longer contains their home:"
say "  scp mike@10.0.0.30:$D/RESEED-HANDOFF.json ."
say "  sudo ~/bin/reseed-bots.sh RESEED-HANDOFF.json --go"
say "THEN verify from here: rcon 'list' must show 5 bots, and the pool must emit"
say "telemetry again. Until reseed-bots.sh runs, this pool has no working bots."
