#!/usr/bin/env python3
# plinthfirsttrip.py [--since ISO] [--version SHA8] -- the FLEET TRIPWIRE for plinthfirst-01's direct rollout. READ ONLY.
# Run on 10.0.0.31 beside plinth2trip.py (which keeps judging P1-P5 / C1-C9 of every plinth):
#
#     cd ~/mcai-analysis && nice -n 19 python3 plinthfirsttrip.py --since <rollout ISO> --version <sha8>
#
# It walks every bot's skill log (/var/log/mcai/*/skill-*.jsonl and rotated .gz) from --since, keeping rows of --version only
# (`version` / `code_version` field prefix; restart lag skipped), and judges plinth-first's OWN lines:
#   T1 fresh natural dig   a `_well_pit_dug from=fresh pf=1` at a cap that is no plinth cap (rows' and records' caps): a NEW
#                          natural well under the policy. (pf=0 starts -- the 24 h natural fallback after a planner 'none' --
#                          are reported, never a breach.)
#   T2 no_evidence replan  a `_plinth stage=planned why=trigger_complete_lost_no_evidence`: a finished plinth replanned without
#                          evidence about its cap (every no-site record over a finished cap now carries it).
#   T3 unshared plan       a `_plinth stage=planned` from a bot whose `_plinthfirst_mode` says shared=0 (plinth-02.1's guard).
#   T4 two raised caps     two different plan/complete plinth caps in one SHARED town's record (C6's precursor).
#   INSTRUMENT             >= 1 `_plinthfirst_mode` row of the version, and rows walked > 0; else a blind read (not a rollback).
# REPORTED: licence mix (policy= shared=), no_site rows by shadow= (policy exposure = shadow=<x,y,z>), planned rows by trigger
#           and k, well_site_held rows, pf=0 fresh starts.
# LAST LINE: `TRIPWIRE OK` or `TRIPWIRE BREACH <line> <town> <detail>` (the first breach repeated last).
import argparse, glob, gzip, json, os, re, sys
from collections import Counter, defaultdict

STATE = '/var/lib/mcai'
LOGS = '/var/log/mcai'


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def xyz(s):
    try:
        a = tuple(int(v) for v in (s or '').split(','))
        return a if len(a) == 3 else None
    except ValueError:
        return None


def town_of(bot):
    # isolated bots are their own 'towns' for records, but share a world: name them by pool for reporting
    return '-'.join((bot or '').split('-')[:2])


def record_caps():
    """{town: {cap: [state, ...]}} from every pool's plinth record (shared and per-bot isolated dirs)."""
    out = defaultdict(lambda: defaultdict(list))
    for f in glob.glob('%s/_pool-*/junkwell-plinth-*.json' % STATE):
        if '.lease.' in f or '.caprefused.' in f or '.pre-reseed' in f:
            continue
        d = os.path.basename(os.path.dirname(f))[len('_pool-'):]
        town = d[len('self-'):].rsplit('-', 1)[0] if d.startswith('self-') else d
        try:
            r = json.load(open(f))
        except Exception:
            continue
        cap = (r.get('plan') or {}).get('cap')
        if cap and r.get('state') in ('plan', 'complete'):
            out[town][(cap['x'], cap['y'], cap['z'])].append((r.get('state'), d))
    return out


def rows(since, version):
    files = sorted(glob.glob('%s/*/skill-*.jsonl*' % LOGS))
    day = since[:10].replace('-', '')
    for f in files:
        m = re.search(r'-(\d{8})\.gz$', f)
        if m and m.group(1) < day:      # rotated ~23:59Z: a file named for a day before --since holds nothing of the window
            continue
        opener = gzip.open if f.endswith('.gz') else open
        try:
            fh = opener(f, 'rb')
        except Exception:
            continue
        with fh:
            for raw in fh:
                if b'"_plinth' not in raw and b'"_well_pit_dug"' not in raw and b'"_well_refused"' not in raw:
                    yield None
                    continue
                try:
                    r = json.loads(raw)
                except Exception:
                    continue
                t = r.get('@timestamp') or ''
                if t < since:
                    continue
                v = str((r.get('code') or {}).get('version') or '')   # `code.version` = <sha>+<config> (restart lag: other builds skipped)
                if version and v and not v.startswith(version):
                    continue
                yield r


# ---- self-tests on the bot's own row strings ----
assert kv('at=1,2,3 from=fresh pf=1')['pf'] == '1' and xyz('1,2,3') == (1, 2, 3) and xyz('x') is None
assert town_of('isolated-c-Alpha') == 'isolated-c' and town_of('board-a-Echo') == 'board-a'
assert kv('phase=mode v=1 policy=1 shared=0 minraise=2 lost=evidence dy=12 w=x')['shared'] == '0'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', required=True)
    ap.add_argument('--version', default='')
    a = ap.parse_args()
    walked = 0
    lic = {}
    seen = Counter()   # the instrument: the kinds this read selects, seen at all in the window
    pit, planned, nosite, held = [], [], [], 0
    plinth_caps = defaultdict(set)
    for r in rows(a.since, a.version):
        walked += 1
        if r is None:
            continue
        k = (r.get('skill') or {}).get('name')
        d = (r.get('skill') or {}).get('detail') or ''
        bot = (r.get('bot') or {}).get('name') or ''
        f = kv(d)
        seen[k] += 1
        if k == '_plinthfirst_mode':
            lic[bot] = f
        elif k == '_plinth':
            c = xyz(f.get('at'))
            if c:
                plinth_caps[town_of(bot)].add(c)
            if f.get('stage') == 'planned':
                planned.append((bot, f.get('why', ''), f.get('k'), c))
        elif k == '_well_pit_dug':
            pit.append((bot, r.get('@timestamp'), f))
        elif k == '_well_refused':
            if 'reason=no_site ' in d:
                nosite.append((bot, f.get('shadow')))
            elif 'reason=well_site_held' in d:
                held += 1
    recs = record_caps()
    for town, caps in recs.items():
        for c in caps:
            plinth_caps[town].add(c)
    breaches = []

    def breach(line, town, detail):
        breaches.append('TRIPWIRE BREACH %s %s %s' % (line, town, detail))

    for bot, t, f in pit:
        c = xyz(f.get('at'))
        if f.get('from') == 'fresh' and f.get('pf') == '1' and c not in plinth_caps[town_of(bot)]:
            breach('T1', town_of(bot), 'fresh natural dig under the policy at %s (%s %s)' % (f.get('at'), bot, t))
    for bot, why, k, c in planned:
        if why.startswith('trigger_complete_lost_no_evidence'):
            breach('T2', town_of(bot), 'replanned without evidence (%s at %s)' % (bot, c))
        if lic.get(bot, {}).get('shared') == '0':
            breach('T3', town_of(bot), 'an unshared bot planned (%s at %s)' % (bot, c))
    for town, caps in recs.items():
        if town.startswith('isolated'):
            continue
        if len(caps) > 1:
            breach('T4', town, 'two raised caps planned or complete: %s' % sorted(caps))
    print('DENOMINATORS since %s version %s | lines walked %d | selected rows %s | bots with a licence row %d' % (a.since, a.version or '*', walked, dict(seen), len(lic)))
    print('LICENCE      %s' % dict(Counter('policy=%s shared=%s' % (f.get('policy'), f.get('shared')) for f in lic.values())))
    print('NO_SITE      %d rows; shadow: %s  (policy exposure = a shadow=<x,y,z>)' % (len(nosite), dict(Counter('cell' if xyz(s) else (s or '-') for _, s in nosite))))
    print('PLANNED      %d: by trigger %s; by k %s' % (len(planned), dict(Counter(w for _, w, _, _ in planned)), dict(Counter(k for _, _, k, _ in planned))))
    print('HELD         well_site_held rows %d | fresh starts pf=0 (natural fallback) %d' % (held, sum(1 for _, _, f in pit if f.get('from') == 'fresh' and f.get('pf') == '0')))
    if walked == 0 or not lic:
        print('NOTE         INSTRUMENT: no rows or no _plinthfirst_mode row of this version yet -- a blind read, not a rollback trigger')
    for b in breaches:
        print(b)
    print(breaches[0] if breaches else 'TRIPWIRE OK')


if __name__ == '__main__':
    main()
