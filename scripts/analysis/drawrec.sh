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
# THE BAND CENTRE MUST COVER THE POOLS THE BAND JUDGES.
# When the 5080-half restriction came out of elig() at 19:51Z the centre was left
# as poolrank2's 5080-half median, so the three -d pools were judged for band
# eligibility against a median they do not contribute to -- silently, and biasing
# exactly the pools the change had just enfranchised. Caught in review 21:0xZ,
# ninety minutes later. The in-file justification for leaving it ("33.4 vs 31.7,
# inside the rounding of the band") was a ONE-DAY SNAPSHOT of a quantity measured
# to move 53% in 2.3 hours, which is not a reason, it is a coincidence.
med5080 = float(re.search(r'5080-half median items/bh: ([\d.]+)', txt).group(1))
_all = sorted(ibh for _p, (_h, ibh) in band.items())
med = _all[len(_all) // 2] if _all else med5080
print('band centre: all-pool median %.1f (5080-half median %.1f, %+.0f%%)'
      % (med, med5080, 100 * (med - med5080) / med5080 if med5080 else 0))
now = dt.datetime.now(dt.timezone.utc)
# EXCLUSIONS COME FROM THE LEDGER AND THE MANIFEST, NEVER FROM A TYPED LIST (2026-09-14: a typed dict with duplicate
# keys let stale times overwrite fresh ones and the draw offered pools that were still excluded). A pool is excluded
# for 12 h after its last canary DECISION (the ledger's ts; conservative, later than declared_at) and while it is the
# manifest's live canary.
import json
ledger = txt.split('=== LEDGER')[1].split('=== MANIFEST')[0] if '=== LEDGER' in txt else ''
excl = set()
for line in ledger.strip().splitlines():
    try: row = json.loads(line)
    except Exception: continue
    ts = dt.datetime.fromisoformat(row['ts'])
    if (now - ts).total_seconds() < 12 * 3600:
        for p in str(row.get('canary_pool') or '').split(','):
            if p.strip(): excl.add(p.strip())
try:
    man = json.loads(txt.split('=== MANIFEST')[1]) if '=== MANIFEST' in txt else {}
    for p in str(man.get('canary_pool') or '').split(','):
        if p.strip(): excl.add(p.strip())
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
# MANUAL EXCLUSIONS (18 Sep 2026): ~/mcai-analysis/draw-exclude.txt on the host, lines "<pool> <until ISO-8601 UTC> <why>".
# reseed-pool.sh writes the two re-seeded pools here for the seed canary's 72-h read, so no code canary lands on them
# and changes their arm under the read. Expired lines are ignored; malformed lines refuse the draw (a silent skip
# would be a widened draw nobody registered).
import datetime as _dt, os as _os
_xf = _os.path.expanduser('~/mcai-analysis/draw-exclude.txt')
if _os.path.exists(_xf):
    for _line in open(_xf):
        _line = _line.strip()
        if not _line or _line.startswith('#'): continue
        try: _p, _until = _line.split()[:2]; _u = _dt.datetime.fromisoformat(_until.replace('Z', '+00:00'))
        except Exception: raise SystemExit(f'draw-exclude.txt: malformed line {_line!r}; refusing to draw')
        if _u > now: excl.add(_p); print('manual exclusion:', _p, 'until', _until)
# THE INFERENCE HALF IS NO LONGER HELD CONSTANT -- IT IS RECORDED AS A COVARIATE.
#
# This term used to read `h == '5080' and`. It made 3 of 12 pools permanently
# control and was the single filter that failed today's draw: with 6 of the 9
# 5080 pools inside their 12 h exclusion, the eligible set was 2, and the band
# then took it to 0. Dropping the half term alone made it 2 (board-d, placebo-d).
#
# It was dropped on a measurement, not an argument (halfdid.py, 2026-09-19, 360
# placebo canaries on windows where nothing was deployed, so the true effect is
# zero and every number is noise):
#
#     canary drawn from      n    null sd   null median
#     5080 half (allowed)  231       0.89         -8.6%
#     3090 half (banned)   129       0.70         +0.2%
#
# The forbidden half is BETTER behaved, not worse. That matches the harness env:
# every pool lists BOTH endpoints in OLLAMA_BASE_URLS with the same
# qwen2.5:7b-instruct on each, so the "half" only names which is tried first. It
# was never an isolation boundary. Two positive controls gate that study -- the
# aggregator matches poolrank2 exactly, and a planted +30% recovers as +30.0%.
#
# The BAND STAYS. The same study says it buys almost nothing on spread (sd 0.81
# inside vs 0.84 outside) but it does remove a -10% median bias -- regression to
# the mean, the hazard in argmax-pool-guarantees-reversion. Widening it would be
# the wrong move, and this comment exists so nobody reads "the half came out" as
# "the matching came out".
#
# `med` is the ALL-POOL median, computed above from the same table elig() draws
# from. It used to be the 5080-half median, which was a leftover from when the
# draw could only pick 5080 pools; see the note at the parse site.
def elig(w): return [p for p, (h, ibh) in band.items() if p != 'placebo-c' and not p.startswith('isolated') and p not in excl and abs(ibh - med) / med <= w and p in expo and (expo[p][0] >= 8 or expo[p][1] >= 20) and (ALLOWED is None or p in ALLOWED)]
e = elig(0.25); w = '±25%'
# TWO pools are needed, so widen when the ±25% band yields FEWER THAN TWO, not only when it yields none: on 16 Sep 21:13Z the
# loop's first draw found one pool at ±25% and slept instead of stating the ±40% band the rule allows.
if len(e) < 2: e = elig(0.40); w = '±40% (widened, stated)'
trapped = [p for p in e if expo[p][2] >= 1]
print('median', round(med, 1), 'excluded(12h)', sorted(excl), 'band', w)
print('eligible', [(p, band[p][0], band[p][1], expo[p]) for p in e], '| with a trapped bot:', trapped)
print('half mix on offer:', {h: sum(1 for p in e if band[p][0] == h) for h in ('5080', '3090')},
      '-- RECORD THE HALF OF EACH DRAWN POOL AS A READ COVARIATE')
rng = secrets.SystemRandom(); order = trapped + [p for p in e if p not in trapped]; pick = (rng.sample(trapped, min(2, len(trapped))) + rng.sample([p for p in e if p not in trapped], max(0, 2 - min(2, len(trapped))))) if len(e) >= 2 else None
print('DRAW (two pools of five, owner C):', pick or 'NONE (fewer than two eligible)')
if pick: print('drawn halves:', {p: band[p][0] for p in pick})
PY
