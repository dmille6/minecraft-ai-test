#!/bin/bash
# HOST COPY (10.0.0.31): identical to the Mac drawrec.sh except the remote part runs locally. canary-loop.sh calls this;
# the loop's first real draw (16 Sep 23:50Z) found no such file on the host -- the --no-act run had skipped the draw phase.
# Deploy-time draw: rule v5 band on the 5080 half + exposure. The built-in exposure filter (>= 20 entombed+marooned rows
# OR >= 8 livelock_escape rows in the prior 3 h) was written for recovery-ladder-01 and is BLIND TO EVERY OTHER MECHANISM.
# 17 Sep it drew board-b,hive-b for the pocket-rung + death-site bundle: both had 0 sealed pockets and 0 deaths in 6 h, the
# only such pair available, and the canary reached +360 with 60 bot-h and zero exposure on BOTH halves -- unmeasurable by
# construction. So: pass a run_id and, if its registration declares `draw_exposure`, drawexposure.py narrows the eligible
# list to pools that can actually expose THAT change. With no run_id, behaviour is exactly as before.
# A pool with a trapped bot is preferred but not required.
RUN=${1:-}
export DRAW_RUN="$RUN"
bash -c 'cd /opt/minecraft-ai; POOLS=1 python3 /tmp/immobiledid.py 2>/dev/null; python3 /tmp/poolrank2.py 2>/dev/null; echo "=== LEDGER"; tail -40 /var/log/mcai/_canary-decisions.jsonl; echo "=== MANIFEST"; cat /srv/mcbots/trial-manifest.json' > /tmp/drawrec.txt 2>&1
python3 - <<'PY'
import re, secrets, datetime as dt
txt = open('/tmp/drawrec.txt').read()
expo = {m.group(1): (int(m.group(2)), int(m.group(3)), int(m.group(4))) for m in re.finditer(r'^\s+(\S+)\s+livelock\s+(\d+) climbs\s+(\d+) immobile>=30m (\d+)', txt, re.M)}
band = {m.group(1): (m.group(2), float(m.group(3))) for m in re.finditer(r'^(\S+)\s+(5080|3090)\s+bots \d+\s+items/bh\s+([\d.]+)', txt, re.M)}
med = float(re.search(r'5080-half median items/bh: ([\d.]+)', txt).group(1))
now = dt.datetime.now(dt.timezone.utc)
# EXCLUSIONS COME FROM THE LEDGER AND THE MANIFEST, NEVER FROM A TYPED LIST (2026-09-14: a typed dict with duplicate
# keys let stale times overwrite fresh ones and the draw offered pools that were still excluded). A pool is excluded
# for 12 h after its last canary DECISION (the ledger's ts; conservative, later than declared_at) and while it is the
# manifest's live canary.
import json, sys as _sys
_sys.path.insert(0, '/opt/minecraft-ai/scripts/lib')
import canary_manifest as _cm
ledger = txt.split('=== LEDGER')[1].split('=== MANIFEST')[0] if '=== LEDGER' in txt else ''
excl = set()
for line in ledger.strip().splitlines():
    try: row = json.loads(line)
    except Exception: continue
    ts = dt.datetime.fromisoformat(row['ts'])
    if (now - ts).total_seconds() < 12 * 3600:
        # A SPLIT CANARY'S WORLDS ARE NOT IN canary_pool. It holds a sentinel, so the comma split
        # that used to be here resolved a within-world canary to no worlds at all and this
        # exclusion failed OPEN -- offering for a fresh canary the very pools one had just used.
        # worlds_touched reads the roster beside it, and answers ALL_WORLDS when it cannot.
        for p in _cm.worlds_touched(row): excl.add(p)
try:
    man = json.loads(txt.split('=== MANIFEST')[1]) if '=== MANIFEST' in txt else {}
    for p in _cm.worlds_touched(man): excl.add(p)
except Exception: pass
# Registration-driven exposure. This MUST be a term inside elig(), not a filter applied to its
# result: the `len(e) < 2` widening below recomputes e from scratch, and an earlier narrowing was
# silently discarded by it (caught in test, 17 Sep -- the widened draw offered two pools that
# could not expose the change at all). A pool that cannot expose the change under test is not
# eligible, however busy it looks on the v8 livelock/climb filter.
import os, subprocess, ast as _ast
RUN = os.environ.get('DRAW_RUN', '')
ALLOWED = None
if RUN:
    _r = subprocess.run(['python3', os.path.expanduser('~/mcai-analysis/drawexposure.py'), RUN,
                         '--registrations', os.path.expanduser('~/mcai-analysis/registrations')],
                        capture_output=True, text=True)
    _l = [x for x in _r.stdout.splitlines() if x.startswith('eligible on exposure:')]
    if _l:
        _v = _l[0].split(':', 1)[1].strip()
        ALLOWED = [] if _v == 'NONE' else _ast.literal_eval(_v)
        print('draw_exposure:', RUN, 'pools able to expose this change:', ALLOWED)
    else:
        print('draw_exposure: no requirement declared for', RUN, '-- v8 filter only')
def elig(w): return [p for p, (h, ibh) in band.items() if h == '5080' and p != 'placebo-c' and not p.startswith('isolated') and p not in excl and _cm.ALL_WORLDS not in excl and abs(ibh - med) / med <= w and p in expo and (expo[p][0] >= 8 or expo[p][1] >= 20) and (ALLOWED is None or p in ALLOWED)]
e = elig(0.25); w = '±25%'
# TWO pools are needed, so widen when the ±25% band yields FEWER THAN TWO, not only when it yields none: on 16 Sep 21:13Z the
# loop's first draw found one pool at ±25% and slept instead of stating the ±40% band the rule allows.
if len(e) < 2: e = elig(0.40); w = '±40% (widened, stated)'
trapped = [p for p in e if expo[p][2] >= 1]
# ALL_WORLDS IS NOT A POOL NAME, so `p not in excl` would have silently ignored it and the
# exclusion would have been a no-op -- the exact failure mode it was added to prevent. It is
# tested for by name in elig() above; a within-world canary in the last 12h excludes every pool,
# which is correct: it treated bots in all sixteen worlds.
if _cm.ALL_WORLDS in excl:
    print('EXCLUDED: a within-world canary touched every world in the last 12h')
print('median', round(med, 1), 'excluded(12h)', sorted(excl), 'band', w)
print('eligible', [(p, band[p][1], expo[p]) for p in e], '| with a trapped bot:', trapped)
rng = secrets.SystemRandom(); order = trapped + [p for p in e if p not in trapped]; pick = (rng.sample(trapped, min(2, len(trapped))) + rng.sample([p for p in e if p not in trapped], max(0, 2 - min(2, len(trapped))))) if len(e) >= 2 else None
print('DRAW (two pools of five, owner C):', pick or 'NONE (fewer than two eligible)')
PY
