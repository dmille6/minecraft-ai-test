#!/usr/bin/env python3
# indexsearch2read.py --at ISO [--hours 2] [--glob G] | --selftest
#   The WATCH READ for storehub piece C, indexsearch-02 (design docs/reports/storehub-design-2026-11-03.md section 6 row C;
#   code bots/src/indexsearch2.mjs): the town search skips a chest the town index knows -- fresh within the need's miss life
#   (60 min), clean, no deposit since -- does not hold the need; one recheck per pass, the oldest first.
#   Compares the `--hours` window AFTER the activation `--at` with the same length BEFORE it, plus the 24 h before (the small
#   showcase's 2 h holds ~2 withdraw_pick and ~3 kit searches: the 24 h baseline is the one with a denominator).
#   Default glob: the showcase's logs (/var/log/mcai/showcase-*/skill-*.jsonl*, rotated .gz included). Streamed: only the
#   kinds below are held. DENOMINATORS FIRST.
#
# ROWS
#   _indexsearch2_mode   once per spawn: the licence (the build is live; index_search=off is the rollback)
#   _withdraw_pick       verb=withdraw_pick rows: visits=, maxrep=, ix=<held back>/<rechecks> (pick pass),<...> (ingredients)
#   _kit_search          visits=, maxrep=, left=, ix=<held back>/<rechecks>
#   withdraw_pick / toolkit skill rows: status (failed share)
#
# MEASURES (each per search, with its count)
#   visits_mean          mean visits= (PRIMARY; the design: fleet 7.9 -> <= 2.5, showcase 3.75 -> <= 2)
#   empty_share          tried= entries ending :none / all parsed entries (the row cuts tried= at 300 chars: parsed, not all)
#   outcomes             withdraw_pick took_pick / crafted_pick / short / ...; kit took / crafted / no_iron / more ...
#   failed_share         withdraw_pick + toolkit skill rows with status failed / all of them (NO RISE: post <= pre24 + 10 pp)
#   exposure             post search rows whose ix= held back >= 1 (the rule acted); licence rows post
# DEFECTS (each is a REVERT: put INDEXSEARCH2=off in the env or roll back the release)
#   D1 withdraw_pick maxrep > 2 or kit maxrep > 1 (a container opened twice in a pass)
#   D2 a pass with rechecks > 1 (ix=n/r with r > INDEX_RECHECK_VISITS)
#   D3 visits over the caps (withdraw_pick 16 + 8, kit 12)
# VERDICT  DEFECT if any D; else NO_HARM when failed_share does not rise past 10 pp over the 24 h baseline (or n < 3: say so);
#          EFFECT is reported, never judged on the 2 h (n is too small): the fleet read judges it.
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter

KINDS = ('_indexsearch2_mode', '_withdraw_pick', '_kit_search', 'withdraw_pick', 'toolkit')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
RECHECK = 1
CAP_WP, CAP_KIT = 16 + 8, 12
DEFAULT_GLOB = '/var/log/mcai/showcase-*/skill-*.jsonl*'


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def tried(d):
    m = re.search(r'tried=\[([^\]]*)(\]?)', d or '')
    out = []
    parts = m.group(1).split(';') if m and m.group(1) else []
    if m and not m.group(2):
        parts = parts[:-1]   # no closing bracket: the row was cut at 300 characters inside the last entry
    for t in parts:
        if ':' in t and re.match(r'^-?\d+,-?\d+,-?\d+:[a-z_]+$', t):
            out.append(t.rsplit(':', 1)[1])
    return out


def ts(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))


def stream(pattern, since, until):
    for f in sorted(glob.glob(pattern)):
        op = gzip.open if f.endswith('.gz') else open
        try:
            fh = op(f, 'rt', errors='replace')
        except OSError:
            continue
        with fh:
            for ln in fh:
                if not any(k in ln for k in KINDS):
                    continue
                try:
                    r = json.loads(ln)
                except Exception:
                    continue
                sk = r.get('skill') or {}
                n = sk.get('name')
                if n not in KINDS:
                    continue
                try:
                    t = ts(r.get('@timestamp', ''))
                except Exception:
                    continue
                if since <= t < until:
                    yield {'t': t, 'name': n, 'detail': sk.get('detail') or '', 'status': sk.get('status'),
                           'bot': (r.get('bot') or {}).get('name')}


def ixparts(v):
    """'12/1,3/0' -> [(12, 1), (3, 0)]; '-' parts skipped."""
    out = []
    for p in (v or '').split(','):
        m = re.match(r'^(\d+)/(\d+)$', p)
        if m:
            out.append((int(m.group(1)), int(m.group(2))))
    return out


def measure(rows):
    m = {'licence': 0, 'rows': len(rows), 'defects': []}
    fails = Counter()
    for kind, cap, rep in (('_withdraw_pick', CAP_WP, 2), ('_kit_search', CAP_KIT, 1)):
        rs = [r for r in rows if r['name'] == kind and (kind != '_withdraw_pick' or 'verb=withdraw_pick' in r['detail'])]
        vis, res, oc, exp = [], Counter(), Counter(), 0
        for r in rs:
            f = kv(r['detail'])
            v = int(f['visits']) if f.get('visits', '').isdigit() else None
            if v is not None:
                vis.append(v)
                if v > cap:
                    m['defects'].append(f'D3 {kind} visits={v} > {cap} ({r["bot"]} {r["t"]:%H:%MZ})')
            mr = int(f['maxrep']) if f.get('maxrep', '').isdigit() else 0
            if mr > rep:
                m['defects'].append(f'D1 {kind} maxrep={mr} > {rep} ({r["bot"]} {r["t"]:%H:%MZ})')
            ix = ixparts(f.get('ix'))
            if any(rk > RECHECK for _, rk in ix):
                m['defects'].append(f'D2 {kind} ix={f.get("ix")} rechecks > {RECHECK} ({r["bot"]} {r["t"]:%H:%MZ})')
            if any(n > 0 for n, _ in ix):
                exp += 1
            for x in tried(r['detail']):
                res[x] += 1
            oc[f.get('outcome', '?')] += 1
        tot = sum(res.values())
        m[kind] = {'searches': len(rs), 'visits_mean': round(sum(vis) / len(vis), 2) if vis else None, 'visits_sum': sum(vis),
                   'tried_parsed': tot, 'empty_share': round(res['none'] / tot, 3) if tot else None,
                   'outcomes': dict(oc.most_common(8)), 'exposed': exp}
    for r in rows:
        if r['name'] == '_indexsearch2_mode':
            m['licence'] += 1
        elif r['name'] in ('withdraw_pick', 'toolkit'):
            fails['all'] += 1
            fails['failed'] += 1 if r['status'] == 'failed' else 0
    m['skill_rows'] = fails['all']
    m['failed_share'] = round(fails['failed'] / fails['all'], 3) if fails['all'] else None
    return m


def verdict(pre24, post):
    if post['defects']:
        return 'DEFECT'
    if post['skill_rows'] < 3 or pre24['failed_share'] is None:
        return 'NO_HARM_UNMEASURED (n<3 post skill rows or no baseline: say so; read again at +24 h)'
    if post['failed_share'] > pre24['failed_share'] + 0.10:
        return 'FAILED_SHARE_ROSE'
    return 'NO_HARM'


def main(argv):
    if '--selftest' in argv:
        return selftest()
    a = dict(zip(argv[::2], argv[1::2]))
    at = ts(a['--at'])
    h = float(a.get('--hours', 2))
    g = a.get('--glob', DEFAULT_GLOB)
    post = measure(list(stream(g, at, at + dt.timedelta(hours=h))))
    pre = measure(list(stream(g, at - dt.timedelta(hours=h), at)))
    pre24 = measure(list(stream(g, at - dt.timedelta(hours=24), at)))
    for name, m in (('PRE24', pre24), (f'PRE{h:g}h', pre), (f'POST{h:g}h', post)):
        print(f'{name}: rows={m["rows"]} licence={m["licence"]} skill_rows={m["skill_rows"]} failed_share={m["failed_share"]}')
        for k in ('_withdraw_pick', '_kit_search'):
            print(f'  {k}: {json.dumps(m[k])}')
    if post['rows'] and not post['licence']:
        print('!! no _indexsearch2_mode licence row after --at: the build is not live (or the window is wrong)')
    for d in post['defects']:
        print('!!', d)
    print('VERDICT', verdict(pre24, post))
    return 0


def selftest():
    T = dt.datetime(2026, 11, 3, 22, 0, tzinfo=dt.timezone.utc)
    R = lambda n, d='', s='success', b='showcase-Alpha': {'t': T, 'name': n, 'detail': d, 'status': s, 'bot': b}
    ok = [R('_indexsearch2_mode', 'phase=mode index_search=on'),
          R('_withdraw_pick', 'outcome=took_pick need=pickaxe uses=1 verification=server verb=withdraw_pick line=any town=13 cand=2,- visits=1 maxrep=1 vfail=0 ix=12/0,- cursor=- tried=[-14,64,-6:success]'),
          R('_kit_search', 'outcome=took need=kit_iron town=9 cand=2 visits=2 vfail=0 maxrep=1 left=0 ix=7/1 tried=[1,2,3:none;4,5,6:success]'),
          R('withdraw_pick'), R('toolkit'), R('toolkit', s='failed')]
    m = measure(ok)
    assert m['licence'] == 1 and not m['defects'], m
    assert m['_withdraw_pick']['visits_mean'] == 1 and m['_withdraw_pick']['exposed'] == 1, m
    assert m['_kit_search']['empty_share'] == 0.5 and m['_kit_search']['exposed'] == 1, m
    assert m['failed_share'] == round(1 / 3, 3), m
    # each defect has a failing fixture
    d1 = measure([R('_kit_search', 'outcome=took need=kit_iron visits=2 maxrep=2 left=0 ix=0/0 tried=[]')])
    assert any(x.startswith('D1') for x in d1['defects']), d1
    d2 = measure([R('_kit_search', 'outcome=took need=kit_iron visits=2 maxrep=1 left=0 ix=5/2 tried=[]')])
    assert any(x.startswith('D2') for x in d2['defects']), d2
    d3 = measure([R('_withdraw_pick', 'outcome=short need=stick:2 verb=withdraw_pick visits=25 maxrep=2 vfail=0 ix=0/0,0/0 tried=[]')])
    assert any(x.startswith('D3') for x in d3['defects']), d3
    assert verdict(m, d3) == 'DEFECT'
    # no harm, a rise, and too few rows
    base = measure([R('toolkit')] * 9 + [R('toolkit', s='failed')])
    assert verdict(base, measure([R('toolkit')] * 4)) == 'NO_HARM'
    assert verdict(base, measure([R('toolkit', s='failed')] * 2 + [R('toolkit')] * 2)) == 'FAILED_SHARE_ROSE'
    assert verdict(base, measure([R('toolkit')])).startswith('NO_HARM_UNMEASURED')
    # a control row of another verb is not a search
    assert measure([R('_withdraw_pick', 'outcome=took need=stick:2 verification=server cursor=- verb=withdraw tried=[]')])['_withdraw_pick']['searches'] == 0
    # the tried= parser drops a fragment cut at 300 characters
    assert tried('tried=[1,2,3:none;4,5,6:succ') == ['none'], tried('tried=[1,2,3:none;4,5,6:succ')
    print('selftest OK')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
