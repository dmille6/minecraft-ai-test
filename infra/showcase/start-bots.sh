#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: THE command that starts the 10 showcase bots. NOT RUN until the gate passes.
# Design: docs/reports/showcase-2026-10-20.md section 9. The owner's rule (10-20 13:05Z): the bots start only when the
# town plan's first pieces (per-town siting file, sorted deposits, station placement into plots) are KEPT on the bench
# and inside the followed release.
#   sudo /srv/showcase/bin/start-bots.sh
set -uo pipefail
B=/srv/showcase/bin
exec 9>>/srv/showcase/ops.lock; flock 9
# FUN MODE (10-28): a stale or other-release brain replay is REFRESHED here, never a refusal that waits on a human. A fresh
# replay that FAILS still fails the gate below (the brain path is broken).
if ! python3 $B/showcase_ops.py replay-fresh; then
  echo "== brain replay stale or for another release: refreshing (replay-prompts.sh)"
  SHOWCASE_LOCK_HELD=1 $B/replay-prompts.sh >> /srv/showcase/ops/replay-cron.log 2>&1 || echo "   replay failed (the gate below says why)"
fi
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
# the tripwire's run epoch: its 180-min read never reaches back past this start (docs/reports/showcase-progress-lane-2026-10-25.md)
[ -d /srv/showcase/trip ] && date -u -d "@$T0" +%FT%TZ > /srv/showcase/trip/RUN_SINCE
echo "== starting 10 bots, 12 s apart, release $(basename "$REL") ($EXPECT)"
for n in Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno; do
  systemctl enable --now "mcshow@showcase-$n" >/dev/null 2>&1 && echo "   started showcase-$n"
  sleep 12
done
echo "== verify (10 min): from every bot a skill row on $EXPECT and an llm row, both NEWER than this start"
fail=1; missing="(verifier never ran)"
for i in $(seq 1 40); do
  if missing=$(python3 - "$EXPECT" "$T0" <<'PY'
import json, sys, datetime as dt
exp, t0 = sys.argv[1], float(sys.argv[2])
names = ['showcase-' + n for n in 'Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno'.split()]
def newest(p):
    try:
        with open(p, 'rb') as f:
            f.seek(0, 2); f.seek(max(0, f.tell() - 65536))
            for l in reversed(f.read().splitlines()):
                try: return json.loads(l)
                except ValueError: pass
    except OSError: return None
def fresh(r):
    try: return dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00')).timestamp() >= t0
    except Exception: return False
bad = []
for n in names:
    s = newest(f'/var/log/mcai/{n}/skill-{n}.jsonl'); l = newest(f'/var/log/mcai/{n}/llm-{n}.jsonl')
    if not s or not fresh(s) or (s.get('code') or {}).get('version') != exp: bad.append(f'{n}:skill'); continue
    if not l or not fresh(l): bad.append(f'{n}:llm')
print(' '.join(bad) if bad else 'ALL-OK')
PY
); then
    [ "$missing" = ALL-OK ] && { fail=0; break; }
  else
    missing="verifier crashed (exit $?)"
  fi
  sleep 15
done
if [ $fail -ne 0 ]; then
  echo "VERIFY FAILED: $missing -- stopping the bots (stop-bots.sh)"
  SHOWCASE_LOCK_HELD=1 $B/stop-bots.sh "start verify failed: $missing"; exit 1
fi
echo "== served-model share since this start (must be >= 90% gemma4 before AUTO_FOLLOW goes on)"
if ! python3 - "$T0" <<'PY'
import collections, datetime as dt, glob, json, sys
t0 = float(sys.argv[1]); c = collections.Counter()
for p in glob.glob('/var/log/mcai/showcase-[A-Z]*/llm-*.jsonl'):
    if 'FIXTURE' in p: continue
    for l in open(p, errors='replace'):
        try:
            r = json.loads(l)
            if dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00')).timestamp() < t0: continue
            c[(r.get('llm') or {}).get('model') or 'unserved'] += 1
        except (ValueError, KeyError): pass
n = sum(c.values()); g = sum(v for k, v in c.items() if str(k).startswith('gemma4'))
print(f'   {n} decisions since start: {dict(c)}')
sys.exit(0 if n and g / n >= 0.9 else 1)
PY
then
  echo "VERIFY FAILED: the brain is not serving gemma4 (see the share above) -- stopping the bots"
  SHOWCASE_LOCK_HELD=1 $B/stop-bots.sh "start verify failed: gemma4 share < 90%"; exit 1
fi
if [ -e /srv/showcase/LANE ]; then
  echo "STARTED: 10 bots on $EXPECT; PROGRESS LANE: AUTO_FOLLOW stays off (the follower observes only)."
else
  touch /srv/showcase/AUTO_FOLLOW
  echo "STARTED: 10 bots on $EXPECT; AUTO_FOLLOW on. The bench's fleetstatus SHOWCASE block reports them from ES."
fi
