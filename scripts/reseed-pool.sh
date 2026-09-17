#!/usr/bin/env bash
# reseed-pool.sh <pool> [--seed N] [--radius 512] [--go] -- the SEED CANARY's world change for ONE pool (owner, 15 Sep
# 21:30Z; decided 17 Sep 12:10Z: after the -13c verdict, no promotion freeze, read by promotion epoch).
#
# A world change, so it is the one place where "do not change the world to fix a bot" does not apply: the world IS
# the treatment. Everything about the pool that encodes the old terrain is archived, never deleted:
#   .31  the five bots' units are stopped; the pool state dir (/var/lib/mcai/_pool-<pool>: world facts, lessons) and
#        each bot's STATE_DIR are moved aside (.pre-reseed-<ts>); HOME_X/Y/Z in the five env files are rewritten from
#        the new town record.
#   .30  block2@<pool> is stopped; world/ and TOWN-PLACED.json are moved aside; level-seed is rewritten (rcon
#        password and ports untouched); the server is started; place-town.py sites and stamps the identical town
#        on the new terrain (its printed HOME_X/Y/Z are the source for the env files); pregen-world.py generates the
#        operating radius so the pool does not pay chunk generation on the server thread that the other fourteen
#        never pay (that would be a terrain-caching arm effect, see pregen-world.py).
# Nothing runs without --go; without it every remote step is printed. Run from the mini with the lab key.
set -euo pipefail
POOL="${1:?pool, e.g. board-c}"; shift
SEED=""; RADIUS=512; GO=0
while [ $# -gt 0 ]; do case "$1" in --seed) SEED="$2"; shift 2;; --radius) RADIUS="$2"; shift 2;; --go) GO=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done
[ -n "$SEED" ] || SEED=$(python3 -c "import secrets; print(secrets.randbits(63))")
case "$POOL" in placebo-c|isolated-*) echo "refusing: $POOL is never a canary pool (draw rule)"; exit 2;; esac
KEY=~/.ssh/id_ed25519; B="ssh -i $KEY -o BatchMode=yes mike@10.0.0.31"; W="ssh -i $KEY -o BatchMode=yes mike@10.0.0.30"
TS=$(date -u +%Y%m%dT%H%MZ); REPO=~/Documents/mcai-rl02
run() { if [ $GO = 1 ]; then eval "$@"; else echo "WOULD: $*"; fi; }
echo "== reseed $POOL seed=$SEED radius=$RADIUS ts=$TS go=$GO"
# 0. preconditions: the pool is not the live code canary, and its bots are the five we expect
MAN=$($B 'python3 -c "import json; d=json.load(open(\"/srv/mcbots/trial-manifest.json\")); print(d.get(\"canary_pool\") or \"\")"')
case ",$MAN," in *",$POOL,"*) echo "refusing: $POOL is the live code canary ($MAN)"; exit 2;; esac
BOTS=$($B "systemctl list-units 'mcbot@$POOL-*' --no-legend --plain | awk '{print \$1}' | sed 's/mcbot@//; s/.service//' | sort"); N=$(echo "$BOTS" | grep -c .)
[ "$N" = 5 ] || { echo "refusing: expected 5 bots for $POOL, found $N: $BOTS"; exit 2; }
echo "bots: $(echo $BOTS)"
# 1. stop the pool's bots and archive their state (coordinates in it belong to the old terrain)
for b in $BOTS; do run "$B 'sudo systemctl stop mcbot@$b.service'"; done
run "$B 'sudo mv /var/lib/mcai/_pool-$POOL /var/lib/mcai/_pool-$POOL.pre-reseed-$TS 2>/dev/null || true; for b in $(echo $BOTS); do sudo mv /var/lib/mcai/\$b /var/lib/mcai/\$b.pre-reseed-$TS 2>/dev/null || true; done; ls -d /var/lib/mcai/*pre-reseed-$TS'"
# 2. the world: stop, archive, re-seed, start
run "$W 'sudo systemctl stop block2@$POOL.service; cd /srv/block2/$POOL && sudo mv world world.pre-reseed-$TS && sudo mv TOWN-PLACED.json TOWN-PLACED.pre-reseed-$TS.json && sudo sed -i \"s/^level-seed=.*/level-seed=$SEED/\" server.properties && sudo grep ^level-seed server.properties && sudo systemctl start block2@$POOL.service'"
# 3. wait for the server (Done line in latest.log), then site and stamp the town, then pregenerate
run "$W 'for i in \$(seq 1 60); do sudo grep -q \"Done (\" /srv/block2/$POOL/logs/latest.log 2>/dev/null && break; sleep 5; done; sudo grep \"Done (\" /srv/block2/$POOL/logs/latest.log | tail -1'"
run "$W 'cd ~/scripts && sudo python3 place-town.py $POOL' | tee /tmp/reseed-$POOL-town.txt"
run "$W 'cd ~/scripts && sudo python3 pregen-world.py $POOL --centre-from /srv/block2/$POOL/TOWN-PLACED.json --radius $RADIUS' | tail -3"
# 4. the bots' home: from the town record; then start them 12 s apart
if [ $GO = 1 ]; then
  HOME=$($W "sudo python3 -c \"import json; h=json.load(open('/srv/block2/$POOL/TOWN-PLACED.json'))['home']; print(*h)\"")
  read -r HX HY HZ <<<"$HOME"; echo "new home: $HX $HY $HZ"
  for b in $BOTS; do $B "sudo sed -i 's/^HOME_X=.*/HOME_X=$HX/; s/^HOME_Y=.*/HOME_Y=$HY/; s/^HOME_Z=.*/HOME_Z=$HZ/' /srv/mcbots/harness/env/$b.env; sudo grep -h '^HOME_' /srv/mcbots/harness/env/$b.env | tr '\n' ' '; echo"; done
  for b in $BOTS; do $B "sudo systemctl start mcbot@$b.service"; sleep 12; done
  $B "systemctl list-units 'mcbot@$POOL-*' --no-legend --plain | awk '{print \$1, \$4}'"
else
  echo "WOULD: rewrite HOME_X/Y/Z in the five env files from TOWN-PLACED.json and start the bots 12 s apart"
fi
echo "== done $POOL seed=$SEED. Record in docs/reports/seed-canary-registration.md: pool, seed, ts, home; the read is by pool set vs the fourteen, split at each promotion."
