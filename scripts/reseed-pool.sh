#!/usr/bin/env bash
# reseed-pool.sh <pool> [--seed N] [--radius 512] [--go] -- the SEED CANARY's world change for ONE pool.
# (owner 15 Sep 21:30Z; decided 17 Sep 12:10Z: after the -13c verdict, no promotion freeze, read by promotion epoch;
#  rewritten 17 Sep 13:30Z after a Codex review of the first draft: no nested eval, every stage journaled and
#  verified, fail-fast, unique archives, HOME_* and BOARD_* rewritten from the town record, readiness from the
#  service's own start time plus a live RCON answer.)
#
# A world change, so it is the one place "do not change the world to fix a bot" does not apply: the world IS the
# treatment. Nothing about the pool that encodes the old terrain is deleted; it is archived under .pre-reseed-<ts>.
# Nothing runs without --go. Stages are journaled in ~/mcai-analysis/reseed-<pool>.journal and a re-run resumes.
set -euo pipefail
POOL="${1:?pool, e.g. board-c}"; shift
SEED=""; RADIUS=512; GO=0
while [ $# -gt 0 ]; do case "$1" in --seed) SEED="$2"; shift 2;; --radius) RADIUS="$2"; shift 2;; --go) GO=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done
case "$POOL" in placebo-c|isolated-*) echo "refusing: $POOL is never a canary pool (draw rule)"; exit 2;; esac
KEY=~/.ssh/id_ed25519; BH=mike@10.0.0.31; WH=mike@10.0.0.30
B() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$BH" "$@"; }
W() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$WH" "$@"; }
J=~/mcai-analysis/reseed-$POOL.journal; mkdir -p ~/mcai-analysis
done_stage() { grep -q "^$1 " "$J" 2>/dev/null; }
mark() { printf '%s %s %s\n' "$1" "$(date -u +%FT%TZ)" "${2:-}" >> "$J"; }
if done_stage seed; then SEED=$(grep '^seed ' "$J" | tail -1 | awk '{print $3}'); TS=$(grep '^seed ' "$J" | tail -1 | awk '{print $4}'); else [ -n "$SEED" ] || SEED=$(python3 -c "import secrets; print(secrets.randbits(63))"); TS=$(date -u +%Y%m%dT%H%M%SZ); fi
echo "== reseed $POOL seed=$SEED radius=$RADIUS ts=$TS go=$GO journal=$J"
[ $GO = 1 ] || { echo "DRY RUN: preconditions only, then the plan. Add --go to act."; }

# ---- preconditions (always run)
MAN=$(B 'python3 -c "import json; d=json.load(open(\"/srv/mcbots/trial-manifest.json\")); print(d.get(\"canary_pool\") or \"\")"')
case ",$MAN," in *",$POOL,"*) echo "refusing: $POOL is the live code canary ($MAN)"; exit 2;; esac
if B "sudo tail -30 /var/log/mcai/_canary-decisions.jsonl" | python3 -c "
import sys,json,datetime as dt; now=dt.datetime.now(dt.timezone.utc); pool='$POOL'
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    if pool in [p.strip() for p in str(r.get('canary_pool') or '').split(',')] and (now-dt.datetime.fromisoformat(r['ts'])).total_seconds()<12*3600: sys.exit(1)
"; then :; else echo "refusing: $POOL had a canary decision in the last 12 h (ledger exclusion)"; exit 2; fi
BOTS=$(B "systemctl list-units 'mcbot@$POOL-*' --no-legend --plain | awk '{print \$1}' | sed 's/mcbot@//; s/.service//' | sort"); N=$(echo "$BOTS" | grep -c .)
[ "$N" = 5 ] || { echo "refusing: expected 5 bots for $POOL, found $N: $BOTS"; exit 2; }
# the pool's state dir and each bot's STATE_DIR, from the env files, never guessed
ENVINFO=$(B "for b in $(echo $BOTS); do sudo grep -h '^STATE_DIR=\|^MEMORY_POOL=\|^MEMORY_SCOPE=' /srv/mcbots/harness/env/\$b.env | tr '\n' ' '; echo; done")
STATEDIRS=$(echo "$ENVINFO" | grep -o 'STATE_DIR=[^ ]*' | cut -d= -f2 | sort -u); MPOOL=$(echo "$ENVINFO" | grep -o 'MEMORY_POOL=[^ ]*' | cut -d= -f2 | sort -u); SCOPES=$(echo "$ENVINFO" | grep -o 'MEMORY_SCOPE=[^ ]*' | cut -d= -f2 | sort -u)
[ "$(echo "$MPOOL" | wc -l | tr -d " ")" = 1 ] && [ "$MPOOL" = "$POOL" ] || { echo "refusing: MEMORY_POOL of the five bots is '$MPOOL', expected '$POOL'"; exit 2; }
POOLDIR=$(dirname "$(echo "$STATEDIRS" | head -1)")/_pool-$POOL
echo "bots: $(echo $BOTS) | scope $SCOPES | state dirs: $(echo $STATEDIRS) | pool dir: $POOLDIR"
W "test -f /srv/block2/$POOL/server.properties && systemctl is-active block2@$POOL.service" >/dev/null || { echo "refusing: block2@$POOL not active or no server.properties"; exit 2; }
W "test -f ~/scripts/place-town.py && test -f ~/scripts/pregen-world.py" || { echo "refusing: ~/scripts/place-town.py or pregen-world.py missing on the worlds host"; exit 2; }
echo "preconditions ok"
[ $GO = 1 ] || { echo "PLAN: stop 5 bots -> archive $POOLDIR and $(echo $STATEDIRS | wc -w) state dirs -> stop block2@$POOL -> archive world + TOWN-PLACED.json -> level-seed=$SEED -> start -> wait for the service's own 'Done' and an RCON answer -> place-town.py -> pregen radius $RADIUS -> rewrite HOME_*/BOARD_* in 5 envs -> start bots 12 s apart -> append to docs/reports/seed-canary-registration.md"; exit 0; }
done_stage seed || mark seed "$SEED $TS"

# ---- stage 1: bots down, state archived
if ! done_stage bots-stopped; then
  for b in $BOTS; do B "sudo systemctl stop mcbot@$b.service"; done
  for b in $BOTS; do st=$(B "systemctl is-active mcbot@$b.service || true"); [ "$st" = inactive ] || { echo "stop failed: $b is $st"; exit 1; }; done
  mark bots-stopped
fi
if ! done_stage state-archived; then
  B "set -e; sudo mv $POOLDIR $POOLDIR.pre-reseed-$TS; $(for d in $STATEDIRS; do printf 'sudo mv %s %s.pre-reseed-%s; ' "$d" "$d" "$TS"; done) ls -d $POOLDIR.pre-reseed-$TS $(for d in $STATEDIRS; do printf '%s.pre-reseed-%s ' "$d" "$TS"; done)" || { echo "state archive failed (nothing else touched); inspect and re-run"; exit 1; }
  mark state-archived
fi
# ---- stage 2: the world
if ! done_stage world-reseeded; then
  W "set -e; sudo systemctl stop block2@$POOL.service; sleep 3; [ \"\$(systemctl is-active block2@$POOL.service || true)\" = inactive ]; cd /srv/block2/$POOL; sudo mv world world.pre-reseed-$TS; sudo mv TOWN-PLACED.json TOWN-PLACED.pre-reseed-$TS.json; sudo sed -i 's/^level-seed=.*/level-seed=$SEED/' server.properties; sudo -u minecraft test -r server.properties; sudo grep -q '^level-seed=$SEED\$' server.properties; echo reseeded" || { echo "world stage failed; the archives are world.pre-reseed-$TS and TOWN-PLACED.pre-reseed-$TS.json; do not re-run blindly"; exit 1; }
  mark world-reseeded
fi
if ! done_stage server-up; then
  W "set -e; sudo systemctl start block2@$POOL.service; T0=\$(date +%s); for i in \$(seq 1 90); do sleep 5; A=\$(systemctl show block2@$POOL.service -p ActiveEnterTimestampMonotonic --value); L=\$(sudo grep -c 'Done (' /srv/block2/$POOL/logs/latest.log 2>/dev/null || echo 0); if [ \"\$L\" -ge 1 ] && sudo grep -q \"level-seed=$SEED\" /srv/block2/$POOL/server.properties && [ \$(( \$(date +%s) - T0 )) -ge 10 ]; then if sudo python3 - <<'PY'
import socket,struct,sys
c=dict(l.split('=',1) for l in open('/srv/block2/$POOL/server.properties').read().splitlines() if '=' in l and not l.startswith('#'))
s=socket.create_connection(('127.0.0.1',int(c['rcon.port'])),timeout=5)
def send(t,body):
    p=struct.pack('<ii',1,t)+body.encode()+b'\x00\x00'; s.sendall(struct.pack('<i',len(p))+p); ln=struct.unpack('<i',s.recv(4))[0]; d=b''
    while len(d)<ln: d+=s.recv(ln-len(d))
    return d[8:-2].decode(errors='replace')
send(3,c['rcon.password'].strip()); out=send(2,'list'); sys.exit(0 if 'players online' in out else 1)
PY
then echo \"server up after \$(( \$(date +%s) - T0 )) s\"; exit 0; fi; fi; done; echo 'server did not come up in 450 s'; exit 1" || exit 1
  mark server-up
fi
# ---- stage 3: the town, then pregeneration
if ! done_stage town-placed; then
  W "set -e; cd ~/scripts && sudo python3 place-town.py $POOL" | tee ~/mcai-analysis/reseed-$POOL-town-$TS.txt || { echo "place-town failed; see the log; the marker must not exist before a re-run (place-town refuses a second stamp)"; exit 1; }
  W "sudo test -f /srv/block2/$POOL/TOWN-PLACED.json && sudo python3 -c \"import json; d=json.load(open('/srv/block2/$POOL/TOWN-PLACED.json')); assert d['arm']=='$POOL'; print('home', *d['home'], 'board', *d['board'], 'border', d.get('border_radius'))\"" | tee -a ~/mcai-analysis/reseed-$POOL-town-$TS.txt
  mark town-placed
fi
if ! done_stage pregen; then
  W "set -e; cd ~/scripts && sudo python3 pregen-world.py $POOL --centre-from /srv/block2/$POOL/TOWN-PLACED.json --radius $RADIUS" | tail -5 || { echo "pregen failed"; exit 1; }
  mark pregen
fi
# ---- stage 4: the bots' home and board, then start them
if ! done_stage envs; then
  REC=$(W "sudo python3 -c \"import json; d=json.load(open('/srv/block2/$POOL/TOWN-PLACED.json')); print(*d['home'], *d['board'], d.get('border_radius') or '')\"")
  read -r HX HY HZ BX BY BZ BR <<<"$REC"; echo "new home $HX $HY $HZ board $BX $BY $BZ border ${BR:-unchanged}"
  for b in $BOTS; do
    B "set -e; F=/srv/mcbots/harness/env/$b.env; sudo sed -i 's/^HOME_X=.*/HOME_X=$HX/; s/^HOME_Y=.*/HOME_Y=$HY/; s/^HOME_Z=.*/HOME_Z=$HZ/; s/^BOARD_X=.*/BOARD_X=$BX/; s/^BOARD_Y=.*/BOARD_Y=$BY/; s/^BOARD_Z=.*/BOARD_Z=$BZ/' \$F; sudo grep -q '^HOME_X=$HX\$' \$F && sudo grep -q '^HOME_Z=$HZ\$' \$F && sudo grep -q '^BOARD_X=$BX\$' \$F; [ -z '$BR' ] || sudo grep -q '^WORLD_BORDER_RADIUS=$BR\$' \$F || echo \"WARN: WORLD_BORDER_RADIUS differs from the record for $b\"; echo \"$b ok\"" || { echo "env rewrite failed for $b"; exit 1; }
  done
  mark envs "$HX $HY $HZ"
fi
if ! done_stage bots-started; then
  for b in $BOTS; do B "sudo systemctl start mcbot@$b.service"; sleep 12; done
  sleep 20; B "systemctl list-units 'mcbot@$POOL-*' --no-legend --plain | awk '{print \$1, \$4}'"
  mark bots-started
fi
# ---- stage 5: the registration record
if ! done_stage registered; then
  HOMEREC=$(grep '^envs ' "$J" | tail -1 | cut -d' ' -f3-)
  printf -- '- %s: pool **%s** re-seeded with `level-seed=%s` (archives world.pre-reseed-%s, TOWN-PLACED.pre-reseed-%s.json on .30; %s.pre-reseed-%s and the five STATE_DIRs on .31); new home %s; radius %s pregenerated; bots restarted 12 s apart. Treatment starts at the bots-started stamp in ~/mcai-analysis/reseed-%s.journal.\n' "$(date -u +%FT%TZ)" "$POOL" "$SEED" "$TS" "$TS" "$POOLDIR" "$TS" "$HOMEREC" "$RADIUS" "$POOL" >> ~/Documents/mcai-rl02/docs/reports/seed-canary-registration.md
  mark registered
fi
echo "== done $POOL seed=$SEED (journal $J)"
