#!/usr/bin/env bash
# reseed-pool.sh <pool> [--seed N] [--radius 512] [--new-seed] [--go] -- the SEED CANARY's world change for ONE pool.
#   --new-seed: the seed has no placeable town. Discard the world this run generated, draw another seed and
#               resume. See `SOME SEEDS HAVE NO TOWN` below. Guarded four ways; never touches a placed town.
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
SEED=""; RADIUS=512; GO=0; NEWSEED=0
while [ $# -gt 0 ]; do case "$1" in --seed) SEED="$2"; shift 2;; --radius) RADIUS="$2"; shift 2;; --go) GO=1; shift;; --new-seed) NEWSEED=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done
case "$POOL" in placebo-c|isolated-*) echo "refusing: $POOL is never a canary pool (draw rule)"; exit 2;; esac
[[ "$POOL" =~ ^(hive|board|placebo)-[a-d]$ ]] || { echo "refusing: pool name must be <arm>-<a..d>"; exit 2; }
[[ "$SEED" =~ ^-?[0-9]{0,19}$ && "$RADIUS" =~ ^[0-9]{2,4}$ ]] || { echo "refusing: seed/radius must be numeric"; exit 2; }
KEY=~/.ssh/id_ed25519; BH=mike@10.0.0.31; WH=mike@10.0.0.30
B() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$BH" "$@"; }
W() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$WH" "$@"; }
J=~/mcai-analysis/reseed-$POOL.journal; mkdir -p ~/mcai-analysis
done_stage() { grep -q "^$1 " "$J" 2>/dev/null; }
mark() { printf '%s %s %s\n' "$1" "$(date -u +%FT%TZ)" "${2:-}" >> "$J"; }
# BEFORE anything writes to the journal. `done_stage seed || mark seed ...` further
# down CREATES the journal, so a --new-seed refusal placed after it would first
# manufacture the very journal it then reports as missing, and leave it behind.
# ...and before the dry-run PLAN, which would otherwise print the plan for a
# NORMAL run and say nothing about the flag that was actually passed.
if [ $NEWSEED = 1 ] && [ $GO != 1 ]; then echo "refusing: --new-seed needs --go (it deletes a world)"; exit 2; fi
if [ $NEWSEED = 1 ] && ! done_stage seed; then echo "refusing --new-seed: nothing journaled for $POOL -- this is a clean start, just run it without the flag"; exit 2; fi
if done_stage seed; then SEED=$(grep '^seed ' "$J" | tail -1 | awk '{print $3}'); TS=$(grep '^seed ' "$J" | tail -1 | awk '{print $4}'); else [ -n "$SEED" ] || SEED=$(python3 -c "import secrets; print(secrets.randbits(63))"); TS=$(date -u +%Y%m%dT%H%M%SZ); fi
echo "== reseed $POOL seed=$SEED radius=$RADIUS ts=$TS go=$GO journal=$J"
[ $GO = 1 ] || { echo "DRY RUN: preconditions only, then the plan. Add --go to act."; }

# ---- preconditions (always run)
MAN=$(B 'python3 -c "import json; d=json.load(open(\"/srv/mcbots/trial-manifest.json\")); print(d.get(\"canary_pool\") or \"\")"')
case ",$MAN," in *",$POOL,"*) echo "refusing: $POOL is the live code canary ($MAN)"; exit 2;; esac
if B "sudo cat /var/log/mcai/_canary-decisions.jsonl" | python3 -c "
import sys,json,datetime as dt; now=dt.datetime.now(dt.timezone.utc); pool='$POOL'
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: sys.exit(3)
    if pool in [p.strip() for p in str(r.get('canary_pool') or '').split(',')] and (now-dt.datetime.fromisoformat(r['ts'])).total_seconds()<12*3600: sys.exit(1)
"; then :; else rc=$?; [ $rc = 3 ] && echo "refusing: unreadable ledger line" || echo "refusing: $POOL had a canary decision in the last 12 h (ledger exclusion)"; exit 2; fi
# --all, BECAUSE A RESUME FINDS ITS BOTS ALREADY STOPPED. Without it
# `list-units` omits inactive units, so the second invocation of a journaled,
# resumable script -- which by design runs with the five bots down -- counts
# zero and refuses to continue the operation it is halfway through.
# And `|| true`, because `grep -c` exits 1 on no match and `set -euo pipefail`
# then kills the script BEFORE the refusal below can say why. Measured
# 2026-09-18 23:54Z: a resumed reseed of placebo-a died printing nothing at all,
# with five bots stopped and a world half-migrated.
BOTS=$(B "systemctl list-units --all 'mcbot@$POOL-*' --no-legend --plain | awk '{print \$1}' | sed 's/mcbot@//; s/.service//' | sort -u"); N=$(echo "$BOTS" | grep -c . || true)
[ "$N" = 5 ] || { echo "refusing: expected 5 bots for $POOL, found $N: $BOTS"; exit 2; }
# the pool's state dir and each bot's STATE_DIR, from the env files, never guessed
ENVINFO=$(B "for b in $(echo $BOTS); do sudo grep -h '^STATE_DIR=\|^MEMORY_POOL=\|^MEMORY_SCOPE=' /srv/mcbots/harness/env/\$b.env | tr '\n' ' '; echo; done")
STATEDIRS=$(echo "$ENVINFO" | grep -o 'STATE_DIR=[^ ]*' | cut -d= -f2 | sort -u); MPOOL=$(echo "$ENVINFO" | grep -o 'MEMORY_POOL=[^ ]*' | cut -d= -f2 | sort -u); SCOPES=$(echo "$ENVINFO" | grep -o 'MEMORY_SCOPE=[^ ]*' | cut -d= -f2 | sort -u)
[ "$(echo "$MPOOL" | wc -l | tr -d " ")" = 1 ] && [ "$MPOOL" = "$POOL" ] || { echo "refusing: MEMORY_POOL of the five bots is '$MPOOL', expected '$POOL'"; exit 2; }
POOLDIR=$(dirname "$(echo "$STATEDIRS" | head -1)")/_pool-$POOL
echo "bots: $(echo $BOTS) | scope $SCOPES | state dirs: $(echo $STATEDIRS) | pool dir: $POOLDIR"
# THIS GUARD IS FOR A CLEAN START, AND ONLY A CLEAN START. Requiring the server
# to be ACTIVE is the right check before tearing a pool apart -- do not reseed a
# world that is already broken. But the world stage's FIRST act is to stop that
# server, so on a resume the guard refuses the operation it is halfway through,
# which is the fourth resume-path defect found tonight. It is not weakened: on a
# clean start (nothing journaled) it is exactly as before; on a resume it was
# already satisfied once, and the journal is the proof.
if ! done_stage world-reseeded; then
  if done_stage bots-stopped; then
    W "test -f /srv/block2/$POOL/server.properties && systemctl cat block2@$POOL.service" >/dev/null || { echo "refusing: block2@$POOL has no unit or no server.properties"; exit 2; }
  else
    W "test -f /srv/block2/$POOL/server.properties && systemctl is-active block2@$POOL.service" >/dev/null || { echo "refusing: block2@$POOL not active or no server.properties"; exit 2; }
  fi
fi
W "test -f ~/scripts/place-town.py && test -f ~/scripts/pregen-world.py" || { echo "refusing: ~/scripts/place-town.py or pregen-world.py missing on the worlds host"; exit 2; }
echo "preconditions ok"
[ $GO = 1 ] || { echo "PLAN: stop 5 bots -> archive $POOLDIR and $(echo $STATEDIRS | wc -w) state dirs -> stop block2@$POOL -> archive world + TOWN-PLACED.json -> level-seed=$SEED -> start -> wait for the service's own 'Done' and an RCON answer -> place-town.py -> pregen radius $RADIUS -> rewrite HOME_*/BOARD_* in 5 envs -> start bots 12 s apart -> append to docs/reports/seed-canary-registration.md"; exit 0; }
done_stage seed || mark seed "$SEED $TS"

# ---- SOME SEEDS HAVE NO TOWN, AND THAT LEFT FIVE BOTS DOWN.
# Measured 2026-09-19 11:17Z on placebo-b: seed 2308430494737375791 was rejected
# at EVERY candidate on the spiral -- "platform relief 43 > 3", "centre is
# water", "24% of columns within 32 are water" -- and place-town.py exited
# non-zero. The script stopped exactly there, correctly refusing to replay a
# placement, with the pool's five bots stopped, its state archived and its world
# reseeded but townless. Recovery was hand work: stop the server, delete the
# world this run had generated, edit the journal's seed in place (the TIMESTAMP
# must not change -- the archives are named for it), drop `world-reseeded` and
# `server-up`, re-run. That is this flag, with the guards the hand work relied
# on made explicit.
#
# It also bounds what the seed canary can claim. The population is not "random
# seeds"; it is "random seeds on which the standard town sites" -- flat, dry,
# low relief. That filter removes exactly the mountainous and flooded terrain a
# terrain experiment would most want to see. Registered in
# docs/reports/seed-canary-registration.md, prospectively, the day it was found.
if [ $NEWSEED = 1 ]; then
  done_stage bots-started && { echo "refusing --new-seed: $POOL is already re-seeded and its bots are running"; exit 2; }
  W "sudo test -d /srv/block2/$POOL/world.pre-reseed-$TS" || { echo "refusing --new-seed: /srv/block2/$POOL/world.pre-reseed-$TS is not there, so the ORIGINAL world is not archived and the world about to be deleted may be it"; exit 2; }
  W "sudo test ! -f /srv/block2/$POOL/TOWN-PLACED.json" || { echo "refusing --new-seed: a town IS placed for this seed -- re-run without the flag and let it continue"; exit 2; }
  OLDSEED=$SEED; SEED=$(python3 -c "import secrets; print(secrets.randbits(63))")
  echo "== --new-seed: $OLDSEED had no placeable town; drawing $SEED, keeping ts=$TS so the archives keep their names"
  W "set -e; sudo systemctl stop block2@$POOL.service; sleep 4; case \"\$(systemctl is-active block2@$POOL.service || true)\" in active|activating|reloading) echo \"block2@$POOL still active after stop\"; exit 1;; esac; cd /srv/block2/$POOL; sudo test -d world.pre-reseed-$TS; sudo test ! -f TOWN-PLACED.json; sudo rm -rf world world_nether world_the_end; sudo ls -d world.pre-reseed-$TS; echo 'townless world discarded, archive intact'" || { echo "could not discard the townless world; nothing was changed in the journal"; exit 1; }
  python3 - "$J" "$SEED" <<'PY'
import sys
j, seed = sys.argv[1], sys.argv[2]
keep = [l for l in open(j) if not l.startswith(('world-reseeded ', 'server-up '))]
out = []
for l in keep:
    if l.startswith('seed '):
        f = l.split()
        out.append('seed-rejected %s %s no-placeable-town
' % (f[1], f[2]))
        out.append('seed %s %s %s
' % (f[1], seed, f[3]))     # SAME ts, new seed
    else:
        out.append(l)
open(j, 'w').writelines(out)
PY
  grep -c '^seed-rejected ' "$J" | xargs -I{} echo "journal reset; {} seed(s) rejected so far for $POOL"
fi

# ---- stage 1: bots down, state archived
if ! done_stage bots-stopped; then
  for b in $BOTS; do B "sudo systemctl stop mcbot@$b.service"; done
  for b in $BOTS; do st=$(B "systemctl is-active mcbot@$b.service || true"); [ "$st" = inactive ] || { echo "stop failed: $b is $st"; exit 1; }; done
  mark bots-stopped
fi
if ! done_stage state-archived; then
  # each source/archive pair reconciled on its own, so a re-run after a partial failure never re-moves or nests
  B "set -e; mv_once() { if [ -e \"\$1\" ] && [ ! -e \"\$2\" ]; then sudo mv \"\$1\" \"\$2\"; elif [ ! -e \"\$1\" ] && [ -e \"\$2\" ]; then :; elif [ -e \"\$1\" ] && [ -e \"\$2\" ]; then echo \"both \$1 and \$2 exist\"; exit 1; else echo \"neither \$1 nor \$2 exists\"; exit 1; fi; }; mv_once $POOLDIR $POOLDIR.pre-reseed-$TS; $(for d in $STATEDIRS; do printf 'mv_once %s %s.pre-reseed-%s; ' "$d" "$d" "$TS"; done) echo archived" || { echo "state archive failed; inspect and re-run (each pair is reconciled individually)"; exit 1; }
  mark state-archived
fi
# ---- stage 2: the world
if ! done_stage world-reseeded; then
  W "set -e; sudo systemctl stop block2@$POOL.service; sleep 3; case \"\$(systemctl is-active block2@$POOL.service || true)\" in active|activating|reloading) echo \"block2@$POOL still active after stop\"; exit 1;; esac; cd /srv/block2/$POOL; mv_once() { if [ -e \"\$1\" ] && [ ! -e \"\$2\" ]; then sudo mv \"\$1\" \"\$2\"; elif [ ! -e \"\$1\" ] && [ -e \"\$2\" ]; then :; else echo \"cannot reconcile \$1 / \$2\"; exit 1; fi; }; mv_once world world.pre-reseed-$TS; mv_once TOWN-PLACED.json TOWN-PLACED.pre-reseed-$TS.json; sudo sed -i 's/^level-seed=.*/level-seed=$SEED/' server.properties; sudo -u minecraft test -r server.properties; sudo grep -q '^level-seed=$SEED\$' server.properties; echo reseeded" || { echo "world stage failed; archives are world.pre-reseed-$TS and TOWN-PLACED.pre-reseed-$TS.json; re-run reconciles"; exit 1; }
  mark world-reseeded
fi
if ! done_stage server-up; then
  # T0 COMES FROM THE SERVICE, NOT FROM THIS ATTEMPT. If a previous attempt
# started the server and died before `mark server-up`, `systemctl start` is
# correctly a no-op -- and a T0 of "now" then gives a journal window that can
# never reach back to that earlier `Done (`, so every resume times out after
# 450 s with the bots down and only a manual restart recovers it. Found by the
# Codex audit of this resume path, 2026-09-18. ActiveEnterTimestamp is when the
# unit actually came up, whichever attempt did it; the fallback is this attempt.
W "set -e; sudo systemctl start block2@$POOL.service; T0=\$(date -d \"\$(systemctl show -p ActiveEnterTimestamp --value block2@$POOL.service)\" +%s 2>/dev/null || date +%s); for i in \$(seq 1 90); do sleep 5; if sudo journalctl -u block2@$POOL.service --since \"-\$(( \$(date +%s) - T0 + 5 )) s\" --no-pager 2>/dev/null | grep -q 'Done ('; then if sudo python3 - <<'PY'
import socket,struct,sys
c=dict(l.split('=',1) for l in open('/srv/block2/$POOL/server.properties').read().splitlines() if '=' in l and not l.startswith('#'))
s=socket.create_connection(('127.0.0.1',int(c['rcon.port'])),timeout=5); s.settimeout(5)
def rd(n):
    d=b''
    while len(d)<n:
        x=s.recv(n-len(d))
        if not x: raise SystemExit(2)
        d+=x
    return d
def send(t,body):
    p=struct.pack('<ii',1,t)+body.encode()+b'\x00\x00'; s.sendall(struct.pack('<i',len(p))+p); ln=struct.unpack('<i',rd(4))[0]; return rd(ln)[8:-2].decode(errors='replace')
send(3,c['rcon.password'].strip()); out=send(2,'list'); sys.exit(0 if 'players online' in out else 1)
PY
then echo \"server up after \$(( \$(date +%s) - T0 )) s (Done from this invocation, RCON answers)\"; exit 0; fi; fi; done; echo 'server did not come up in 450 s'; exit 1" || exit 1
  mark server-up
fi
# ---- stage 3: the town, then pregeneration
if ! done_stage town-placed; then
  # A COMPLETED PLACEMENT WITHOUT ITS STAMP MUST NOT BE REPLAYED. place-town.py
  # refuses a second stamp, so a crash between writing TOWN-PLACED.json and
  # `mark town-placed` left the resume unable to advance at all -- five bots
  # down, manual reconciliation only. Found by the Codex audit, 2026-09-18.
  # The marker must also be NEWER than server.properties, which the seed
  # rewrite touched: an older marker is the PREVIOUS world's town and is
  # exactly what this must not accept.
  if W "sudo test -f /srv/block2/$POOL/TOWN-PLACED.json && sudo find /srv/block2/$POOL/TOWN-PLACED.json -newer /srv/block2/$POOL/server.properties | grep -q ." 2>/dev/null; then
    echo "town already placed for this seed (marker newer than server.properties); verifying it rather than replacing it"
  else
  W "set -e; cd ~/scripts && sudo python3 place-town.py $POOL" | tee ~/mcai-analysis/reseed-$POOL-town-$TS.txt || { echo "place-town failed; see ~/mcai-analysis/reseed-$POOL-town-$TS.txt. If every candidate was rejected for relief or water, this seed has no town: re-run as \`reseed-pool.sh $POOL --new-seed --go\`. Do NOT re-run plain -- place-town refuses a second stamp, and the five bots stay down until one of these happens."; exit 1; }
  W "sudo test -f /srv/block2/$POOL/TOWN-PLACED.json && sudo find /srv/block2/$POOL/TOWN-PLACED.json -newer /srv/block2/$POOL/server.properties | grep -q . && sudo python3 -c \"import json; d=json.load(open('/srv/block2/$POOL/TOWN-PLACED.json')); assert d['arm']=='$POOL' and d['siting']['chosen']; print('home', *d['home'], 'board', *d['board'], 'border', d.get('border_radius'), 'site', *d['siting']['chosen'])\"" | tee -a ~/mcai-analysis/reseed-$POOL-town-$TS.txt || { echo "town record missing, stale, or without a chosen site"; exit 1; }
  fi
  grep -qi "warn\|!!\|failed" ~/mcai-analysis/reseed-$POOL-town-$TS.txt 2>/dev/null && echo "NOTE: place-town printed warnings; read ~/mcai-analysis/reseed-$POOL-town-$TS.txt before trusting the town" || true
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
  PORT=$(W "sudo grep -oP '(?<=^server-port=)[0-9]+' /srv/block2/$POOL/server.properties")
  for b in $BOTS; do
    B "set -e; F=/srv/mcbots/harness/env/$b.env; for kv in HOME_X=$HX HOME_Y=$HY HOME_Z=$HZ BOARD_X=$BX BOARD_Y=$BY BOARD_Z=$BZ; do k=\${kv%%=*}; if sudo grep -q \"^\$k=\" \$F; then sudo sed -i \"s/^\$k=.*/\$kv/\" \$F; else echo \"\$kv\" | sudo tee -a \$F >/dev/null; fi; sudo grep -q \"^\$kv\$\" \$F; done; sudo grep -q '^MINECRAFT_PORT=$PORT\$' \$F; [ -z '$BR' ] || sudo grep -q '^WORLD_BORDER_RADIUS=$BR\$' \$F; echo '$b ok'" || { echo "env rewrite/verify failed for $b (six coordinates, port $PORT, border ${BR:-n/a})"; exit 1; }
  done
  mark envs "$HX $HY $HZ"
fi
if ! done_stage bots-started; then
  for b in $BOTS; do B "sudo systemctl start mcbot@$b.service"; sleep 12; done
  for i in $(seq 1 24); do sleep 10; # THE POOL COMES IN AS argv, NOT THROUGH THE HEREDOC. `<<'PY'` with a QUOTED
# delimiter suppresses every expansion, so `+"$POOL"+` -- written that way
# plainly intending substitution -- reached python as six literal characters and
# it opened `/srv/block2/$POOL/server.properties`. Measured 2026-09-18 23:57Z:
# this crashed AFTER the five bots had been started and their envs rewritten,
# so the reseed was functionally complete and the journal said `envs`, leaving
# the run unable to mark itself done.
#
# The `server-up` stage looks identical and is not: there the heredoc sits
# INSIDE `W "..."`, whose double quotes let the local shell expand $POOL before
# ssh sends it. Two constructs one line apart, one safe and one not -- which is
# why the fix is argv, where quoting cannot decide it either way.
ON=$(W "sudo python3 - $POOL" <<'PY'
import socket,struct,re,sys
c=dict(l.split('=',1) for l in open('/srv/block2/'+sys.argv[1]+'/server.properties').read().splitlines() if '=' in l and not l.startswith('#'))
s=socket.create_connection(('127.0.0.1',int(c['rcon.port'])),timeout=5); s.settimeout(5)
def rd(n):
    d=b''
    while len(d)<n:
        x=s.recv(n-len(d))
        if not x: raise SystemExit(2)
        d+=x
    return d
def send(t,body):
    p=struct.pack('<ii',1,t)+body.encode()+b'\x00\x00'; s.sendall(struct.pack('<i',len(p))+p); ln=struct.unpack('<i',rd(4))[0]; return rd(ln)[8:-2].decode(errors='replace')
send(3,c['rcon.password'].strip()); out=re.sub('§.','',send(2,'list')); m=re.search(r'There are (\d+)',out); print(m.group(1) if m else 0)
PY
); [ "${ON:-0}" = 5 ] && break; done
  [ "${ON:-0}" = 5 ] || { echo "only $ON of 5 bots joined $POOL within 4 min; inspect before marking"; exit 1; }
  B "systemctl list-units 'mcbot@$POOL-*' --no-legend --plain | awk '{print \$1, \$4}'"; echo "5/5 in the world"
  mark bots-started
fi
# ---- stage 5: the registration record
if ! done_stage registered; then
  HOMEREC=$(grep '^envs ' "$J" | tail -1 | cut -d' ' -f3-)
  printf -- '- %s: pool **%s** re-seeded with `level-seed=%s` (archives world.pre-reseed-%s, TOWN-PLACED.pre-reseed-%s.json on .30; %s.pre-reseed-%s and the five STATE_DIRs on .31); new home %s; radius %s pregenerated; bots restarted 12 s apart. Treatment starts at the bots-started stamp in ~/mcai-analysis/reseed-%s.journal.\n' "$(date -u +%FT%TZ)" "$POOL" "$SEED" "$TS" "$TS" "$POOLDIR" "$TS" "$HOMEREC" "$RADIUS" "$POOL" >> ~/Documents/mcai-rl02/docs/reports/seed-canary-registration.md
  # keep code canaries off this pool for the 72-h read (drawrec.sh reads ~/mcai-analysis/draw-exclude.txt on the host)
  UNTIL=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc)+d.timedelta(hours=72)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  B "mkdir -p ~/mcai-analysis; printf '%s %s seed-canary-read\n' '$POOL' '$UNTIL' >> ~/mcai-analysis/draw-exclude.txt; tail -2 ~/mcai-analysis/draw-exclude.txt"
  mark registered
fi
echo "== done $POOL seed=$SEED (journal $J)"
