#!/usr/bin/env python3
"""voyager-01 DAILY METRICS (docs/reports/voyager-01-design-2026-11-06.md §7, §8). Read-only; run as root on the worlds host.

  voyager_metrics.py [--since ISO] [--until ISO] [--arms a,b,c,ctl] [--json]

Every number says its denominator; every zero is printed next to a positive control from the same files.
Sources: /srv/voyager/logs/<arm>/voyager-<arm>.jsonl (the harness), the library files, VoyagerGuard's events.jsonl and
survival.jsonl (the server's record), /var/log/voyager/proxy.jsonl (cost, latency). The control arm has no library:
its items come from its heartbeats only if it ran the voyager heartbeat; otherwise from the fleet skill log.
"""
import argparse
import collections
import datetime as dt
import glob
import json
import os

ROOT = '/srv/voyager'
TIERS = [('wood', ('wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_sword', 'wooden_hoe')),
         ('stone', ('stone_pickaxe', 'stone_axe', 'stone_shovel', 'stone_sword', 'stone_hoe')),
         ('iron', ('iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_sword', 'iron_hoe')),
         ('diamond', ('diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_sword', 'diamond_hoe'))]


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None


def jl(path, since, until):
    out = []
    for p in sorted(glob.glob(path + '.*'), reverse=True) + [path]:
        if p.endswith('.tmp'):
            continue
        try:
            with open(p, 'rb') as f:
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    t = ts(r.get('t'))
                    if t and since <= t < until:
                        out.append(r)
        except FileNotFoundError:
            pass
    return out


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None


def clusters(cells):
    s = set(cells)
    seen, out = set(), []
    for c in cells:
        if c in seen:
            continue
        comp, st = [], [c]
        seen.add(c)
        while st:
            u = st.pop()
            comp.append(u)
            for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                v = (u[0] + d[0], u[1] + d[1], u[2] + d[2])
                if v in s and v not in seen:
                    seen.add(v)
                    st.append(v)
        out.append(comp)
    return out


def arm_metrics(a, since, until, proxy_rows):
    v = jl(os.path.join(ROOT, 'logs', a, f'voyager-{a}.jsonl'), since, until)
    g = jl(os.path.join(ROOT, 'worlds', a, 'plugins', 'VoyagerGuard', 'events.jsonl'), since, until)
    surv = jl(os.path.join(ROOT, 'worlds', a, 'plugins', 'VoyagerGuard', 'survival.jsonl'), since, until)
    k = collections.Counter(r['kind'] for r in v)
    hb = [r for r in v if r['kind'] == 'heartbeat' and r.get('connected')]
    bot_h = len(hb) / 60.0
    items = set()
    for r in hb:
        for n in (r.get('inv') or []):
            items.add(n)
    for r in v:
        if r['kind'] == 'task_done' and r.get('success', {}).get('item'):
            items.add(r['success']['item'])
    tiers = {}
    for name, tools in TIERS:
        first = [ts(r['t']) for r in hb if set(r.get('inv') or []) & set(tools)]
        first += [ts(r['t']) for r in v if r['kind'] == 'task_done' and (r.get('success') or {}).get('item') in tools]
        if first:
            tiers[name] = min(first).isoformat()[:16]
    done = [r for r in v if r['kind'] == 'task_done']
    kinds = collections.Counter(r.get('library_kind') for r in done)
    proposed = [r for r in v if r['kind'] == 'task_proposed']
    refused = [r for r in v if r['kind'] == 'task_refused']
    failed = [r for r in v if r['kind'] == 'task_failed']
    types = collections.Counter((r.get('success') or {}).get('kind') for r in proposed)
    projects = [r for r in proposed if (r.get('success') or {}).get('kind') in ('placed', 'structure')]
    projects_done = [r for r in done if (r.get('success') or {}).get('kind') in ('placed', 'structure')]
    reused = collections.Counter()
    for r in done:
        for n in r.get('reused') or []:
            if n != r.get('skill'):
                reused[n] += 1
    lib = []
    for p in glob.glob(os.path.join(ROOT, 'state', a, 'voyager', 'library', '*.json')):
        try:
            lib.append(json.load(open(p)))
        except Exception:
            pass
    invented = [s for s in lib if s.get('kind') == 'invented']
    places = [(r['x'], r['y'], r['z']) for r in g if r.get('kind') == 'place']
    breaks = {(r['x'], r['y'], r['z']) for r in g if r.get('kind') == 'break'}
    standing = [c for c in places if c not in breaks]
    big = [c for c in clusters(standing) if len(c) >= 20]
    survived = [r for r in surv if r.get('survived')]
    deaths = [r for r in g if r.get('kind') == 'death']
    pr = [r for r in proxy_rows if r.get('arm') == a and 'ms' in r]
    usd = sum(r.get('usd') or 0 for r in pr)
    lat = [r['ms'] for r in pr if not r.get('error')]
    return {
        'arm': a, 'bot_hours_connected': round(bot_h, 2), 'heartbeats': len(hb), 'rows': len(v),
        'iterations': k['task_proposed'] + len({r.get('iteration') for r in refused} - {r.get('iteration') for r in proposed}),
        'tasks': {'proposed': len(proposed), 'refused': len(refused), 'verified': len(done), 'failed': len(failed),
                  'types': dict(types)},
        'executions': k['execution'], 'lint_refused': k['lint_refused'],
        'unique_items': len(items), 'items': sorted(items), 'tool_tiers_first': tiers,
        'skills': {'library_files': len(lib), 'invented': len(invented), 'by_kind_at_verify': dict(kinds),
                   'reused_distinct': len(reused), 'reuse_calls': sum(reused.values()), 'demoted': sum(1 for s in lib if s.get('demoted'))},
        'projects': {'proposed': len(projects), 'finished': len(projects_done)},
        'blocks': {'placed_server': len(places), 'broken_server': len(breaks), 'standing': len(standing),
                   'clusters_ge20': len(big), 'largest_cluster': max((len(c) for c in clusters(standing)), default=0),
                   'survival_reads': len(surv), 'survived_24h': len(survived)},
        'deaths': len(deaths), 'deaths_per_bot_h': round(len(deaths) / bot_h, 3) if bot_h else None,
        'death_causes': [str(d.get('message'))[:60] for d in deaths],
        'safety': {'sandbox_violation': k['sandbox_violation'], 'command_attempt': k['command_attempt'],
                   'server_command_denied': sum(1 for r in g if r.get('kind') == 'command_denied')},
        'llm': {'calls': len(pr), 'errors': sum(1 for r in pr if r.get('error')), 'usd': round(usd, 4),
                'p50_ms': pct(lat, 0.5), 'p95_ms': pct(lat, 0.95),
                'usd_per_verified_skill': round(usd / len(invented), 4) if invented else None},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', default=None)
    ap.add_argument('--until', default=None)
    ap.add_argument('--arms', default='a,b,c,ctl')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    until = ts(a.until) if a.until else dt.datetime.now(dt.timezone.utc)
    since = ts(a.since) if a.since else until - dt.timedelta(hours=24)
    proxy = jl('/var/log/voyager/proxy.jsonl', since, until)
    res = [arm_metrics(x, since, until, proxy) for x in a.arms.split(',')]
    if a.json:
        print(json.dumps({'since': since.isoformat(), 'until': until.isoformat(), 'arms': res}, indent=1))
        return
    print(f'voyager-01 metrics {since.isoformat()[:16]} .. {until.isoformat()[:16]} UTC (proxy rows {len(proxy)})')
    for m in res:
        if not m['rows']:
            print(f"\n[{m['arm']}] no rows in the window (positive control: proxy rows for it = {m['llm']['calls']})")
            continue
        t, s, b, l = m['tasks'], m['skills'], m['blocks'], m['llm']
        print(f"\n[{m['arm']}] {m['bot_hours_connected']} bot-h connected ({m['heartbeats']} heartbeats, {m['rows']} rows)")
        print(f"  tasks: {t['proposed']} proposed, {t['refused']} refused by the filter, {t['verified']} verified, {t['failed']} failed; types {t['types']}")
        print(f"  executions {m['executions']}, lint refusals {m['lint_refused']}")
        print(f"  unique items {m['unique_items']}; tool tiers first reached {m['tool_tiers_first'] or 'none'}")
        print(f"  skills: {s['library_files']} in the library, {s['invented']} invented, {s['reused_distinct']} reused by later runs ({s['reuse_calls']} calls), {s['demoted']} demoted; at verify {s['by_kind_at_verify']}")
        print(f"  projects: {m['projects']['proposed']} proposed, {m['projects']['finished']} finished")
        print(f"  blocks (server): placed {b['placed_server']}, broken {b['broken_server']}, standing {b['standing']}, largest cluster {b['largest_cluster']}, clusters>=20 {b['clusters_ge20']}; 24-h reads {b['survival_reads']}, survived {b['survived_24h']}")
        print(f"  deaths {m['deaths']} ({m['deaths_per_bot_h']}/bot-h) {m['death_causes']}")
        print(f"  safety: sandbox violations {m['safety']['sandbox_violation']}, command attempts {m['safety']['command_attempt']}, server-denied commands {m['safety']['server_command_denied']}")
        print(f"  llm: {l['calls']} calls, {l['errors']} errors, ${l['usd']}, p50 {l['p50_ms']} ms, p95 {l['p95_ms']} ms, $/invented skill {l['usd_per_verified_skill']}")


if __name__ == '__main__':
    main()
