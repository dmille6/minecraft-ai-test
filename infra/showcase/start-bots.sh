#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: THE command that starts the 10 showcase bots. NOT RUN until the gate passes.
# Design: docs/reports/showcase-2026-10-20.md section 9. The owner's rule (10-20 13:05Z): the bots start only when the
# town plan's first pieces (per-town siting file, sorted deposits, station placement into plots) are KEPT on the bench
# and inside the followed release.
#   sudo /srv/showcase/bin/start-bots.sh
set -uo pipefail
B=/srv/showcase/bin
exec 9>>/srv/showcase/ops.lock; flock 9
echo "== gate"
if ! python3 $B/showcase_ops.py gate; then
  echo "NOT STARTED: fix the FAIL lines above (each names its remedy) and rerun"; exit 1
fi
REL=$(readlink -f /srv/showcase/harness)
if [ ! -s "$REL/env/showcase-Alpha.env" ]; then
  echo "== env files (from the release's pinned control env + town-site.json)"
  python3 - "$REL" <<'PY' || { echo "NOT STARTED: env build failed"; exit 1; }
import json, sys
sys.path.insert(0, '/srv/showcase/bin')
import showcase_ops as O
rel = json.load(open(sys.argv[1] + '/RELEASE.json'))
O.write_envs(sys.argv[1], rel)
print('envs written')
PY
fi
EXPECT=$(python3 -c "import json; print(json.load(open('$REL/RELEASE.json'))['expected_version'])")
T0=$(date +%s)
echo "== starting 10 bots, 12 s apart, release $(basename "$REL") ($EXPECT)"
for n in Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno; do
  systemctl enable --now "mcshow@showcase-$n" >/dev/null 2>&1 && echo "   started showcase-$n"
  sleep 12
done
echo "== verify (10 min): a join, a skill row on $EXPECT, and an llm row from every bot"
fail=1
for i in $(seq 1 40); do
  missing=$(python3 - "$EXPECT" "$T0" <<'PY'
import json, os, sys
exp, t0 = sys.argv[1], float(sys.argv[2])
names = ['showcase-' + n for n in 'Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno'.split()]
log = open('/srv/showcase/server/logs/latest.log', errors='replace').read()
bad = []
def newest(p):
    try:
        with open(p, 'rb') as f:
            f.seek(0, 2); f.seek(max(0, f.tell() - 65536))
            for l in reversed(f.read().splitlines()):
                try: return json.loads(l)
                except ValueError: pass
    except OSError: return None
for n in names:
    if f'{n} joined the game' not in log: bad.append(f'{n}:no-join'); continue
    s = newest(f'/var/log/mcai/{n}/skill-{n}.jsonl'); l = newest(f'/var/log/mcai/{n}/llm-{n}.jsonl')
    if not s or (s.get('code') or {}).get('version') != exp: bad.append(f'{n}:skill'); continue
    if not l: bad.append(f'{n}:llm')
print(' '.join(bad))
PY
)
  [ -z "$missing" ] && { fail=0; break; }
  sleep 15
done
if [ $fail -ne 0 ]; then
  echo "VERIFY FAILED: $missing -- stopping the bots (stop-bots.sh)"
  $B/stop-bots.sh "start verify failed: $missing"; exit 1
fi
touch /srv/showcase/AUTO_FOLLOW
python3 - <<'PY'
import collections, json, glob
c = collections.Counter()
for p in glob.glob('/var/log/mcai/showcase-*/llm-*.jsonl'):
    for l in open(p, errors='replace'):
        try: c[(json.loads(l).get('llm') or {}).get('model')] += 1
        except ValueError: pass
print('served models so far:', dict(c))
PY
echo "STARTED: 10 bots on $EXPECT; AUTO_FOLLOW on. The bench's fleetstatus SHOWCASE block reports them from ES."
