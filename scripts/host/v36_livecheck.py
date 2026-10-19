#!/usr/bin/env python3
"""v36_livecheck.py <staged dir>  -- READ-ONLY LIVE positive control for the tier-2 baseline interlock (Claude r5).

Every test_tiers fixture writes its own rows, and v36_replay runs --dryrun, which never reaches the log check. So
this runs the STAGED tierrule.load_buckets + asymmetric_rows on the REAL skill logs of every enabled bot over the last
240 min, with a 4-pool "canary" of pools no ledger decision touched in 12 h (not isolated-*, placebo-c or the live
canary), and the staged drawsteady.version_clean on one of them. Exit 0 only if: no unreadable file / bad line
(bad == 0), >= 80% of the enabled bots have rows, the check is CLEAN (between canaries the 4 untouched pools run the
controls' build), and version_clean agrees with the pool's own rows (one build -> ok; a fleet transition in the window
-> not ok, on 'builds'). A real row format the loader cannot read would make tier 2 silently never KEEP."""
import datetime as dt, importlib.util, json, os, sys

S = sys.argv[1]
sys.path.insert(0, S)


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(S, name + '.py'))
    m = importlib.util.module_from_spec(spec); sys.modules[name] = m; spec.loader.exec_module(m); return m


TR = load('tierrule'); DS = load('drawsteady'); BR = load('bagread')
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
since = now - dt.timedelta(minutes=240)
LOGROOT = '/var/log/mcai'
wants = '/etc/systemd/system/multi-user.target.wants'
enabled = sorted(n[len('mcbot@'):-len('.service')] for n in os.listdir(wants)
                 if n.startswith('mcbot@') and n.endswith('.service') and n != 'mcbot@.service')
pool = lambda b: '-'.join(b.split('-')[:2])
man = json.load(open('/srv/mcbots/trial-manifest.json'))
touched = {p.strip() for p in str(man.get('canary_pool') or '').split(',') if p.strip()}
for l in open('/var/log/mcai/_canary-decisions.jsonl'):
    try:
        r = json.loads(l); t = dt.datetime.fromisoformat(r['ts'].replace('Z', '+00:00'))
    except Exception:
        continue
    if (now - t).total_seconds() < 12 * 3600:
        touched |= {p.strip() for p in str(r.get('canary_pool') or '').split(',') if p.strip()}
pools = sorted({pool(b) for b in enabled})
free = [p for p in pools if p not in touched and p != 'placebo-c' and not p.startswith('isolated')]
if len(free) < 4:
    print('LIVECHECK REFUSED: only %d untouched pools (%s) -- cannot form a 4-pool canary' % (len(free), free)); sys.exit(2)
can_pools = free[:4]
can = [b for b in enabled if pool(b) in can_pools]
rows, bad = TR.load_buckets(LOGROOT, enabled, since, now)
withrows = sum(1 for b in enabled if rows.get(b))
ok, why, het = TR.asymmetric_rows({b: rows.get(b, {}) for b in can}, {b: rows.get(b, {}) for b in enabled if b not in can},
                                  can, since, now, bad)
print('LIVECHECK loader: %d enabled bots, %d with rows, bad %d; canary pools %s' % (len(enabled), withrows, bad, can_pools))
print('LIVECHECK asymmetric_rows: %s :: %s' % ('CLEAN' if ok else 'NOT CLEAN', why))
fail = []
if bad:
    fail.append('bad %d' % bad)
if withrows < 0.8 * len(enabled):
    fail.append('only %d of %d bots have rows' % (withrows, len(enabled)))
if not ok:
    fail.append('not clean: ' + why)
# version_clean on the first canary pool, against its own rows
fv = str(man.get('declared_code_version') or '')[:7]
live = DS.read_units()
mem = DS.membership(enabled, live)
up = [p for p in can_pools if all(mem[b] for b in enabled if pool(b) == p)]
if not up:
    print('LIVECHECK FAILED: no untouched pool with every unit running for the version_clean control'); sys.exit(1)
p0 = up[0]; units = {b: mem[b] for b in enabled if pool(b) == p0}
st = {}
for b in units:
    rs, b_bad, b_cor, _d = BR.bot_rows(b, since, now, root=LOGROOT)
    st[b] = ([(x, v) for x, v, _bag in rs], b_bad, b_cor) if (rs or b_bad or b_cor) else None
vok, vwhy = DS.version_clean(st, units, fv, since, now)
builds = {str(v)[:7] for s in st.values() if s for _x, v in s[0] if since <= _x < now}
print('LIVECHECK version_clean %s (builds seen %s, fleet %s): %s :: %s' % (p0, sorted(builds), fv, vok, vwhy))
if builds == {fv} and not vok:
    fail.append('version_clean refused a single-build pool: ' + vwhy)
if len(builds) > 1 and (vok or 'builds' not in vwhy):
    fail.append('version_clean did not refuse a two-build pool on its builds: ' + vwhy)
if fail:
    print('LIVECHECK FAILED: ' + '; '.join(fail)); sys.exit(1)
print('LIVECHECK OK'); sys.exit(0)
