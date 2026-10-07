#!/usr/bin/env python3
"""ugsafe2_value.py <since-iso> <until-iso> <out.pkl>  -- the VALUE-WEIGHTED output measure, per bot per 5-min bin
(bag-fix death rule, precondition 2(c); docs/reports/bagfix-death-rule-2026-10-07.md).

Same walk as ugsafe2_extract.py (per bot, rotation-aware, dedup on (t, kind, detail), sorted) and the same snapshot
RE-TIMING as ugsafe2_analyse.py (a skill row's bot snapshot is its END, so it is placed at t + duration), so the bins
line up with an.pkl's. Per bin:
  vgain   value credited by bagfixrule.accumulate (NET change in bag_value; 0 on _death, the respawn step, transfers)
  vlost   bag_value carried into each _death
  igain / ilost   the same on iron_units (ingot-equivalents)
  gained / lost_items   the RAW item measure, recomputed here as the positive control: it must reproduce an.pkl's
                        'gained' and 'lost_items' to the item, or the value bins are not comparable.
"""
import sys, os, json, glob, pickle, datetime as dt
from collections import Counter, defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
for p in ('/opt/minecraft-ai/scripts/lib', '/home/mike/mcai-analysis/lib', HERE, os.path.join(HERE, '..'),
          os.path.join(HERE, 'lib'), os.path.join(HERE, '..', 'lib'), os.path.expanduser('~/mcai-analysis')):
    sys.path.insert(0, p)
from telemetry import open_log
from bagfixrule import bag_value, iron_units, accumulate, to_obs

BIN = 300


def parse_t(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def files_for(pattern, since):
    out = []
    for f in sorted(glob.glob(pattern)):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < since:
                continue
        except OSError:
            continue
        out.append(f)
    return out


def walk_bot(d, since, until):
    s0, u0 = since.timestamp(), until.timestamp()
    seen, rows = set(), []
    for f in files_for(os.path.join(d, 'skill-*.jsonl*'), since):
        with open_log(f) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                sk = r.get('skill') or {}
                kind = sk.get('name')
                if not kind:
                    continue
                try:
                    t = parse_t(r.get('@timestamp', ''))
                except Exception:
                    continue
                if t < s0 or t >= u0:
                    continue
                det = (sk.get('detail') or '')[:400]
                key = (t, kind, det)
                if key in seen:
                    continue
                seen.add(key)
                bot = r.get('bot') or {}
                inv = bot.get('inventory') if isinstance(bot.get('inventory'), dict) else None
                hp = bot.get('health')
                if inv is None:
                    rows.append((t, kind, sk.get('duration_ms'), None, None, None, hp))
                    continue
                tools = bot.get('tools') if isinstance(bot.get('tools'), dict) else {}
                nit = sum(c for c in inv.values() if isinstance(c, (int, float)))
                rows.append((t, kind, sk.get('duration_ms'), bag_value(inv, tools), iron_units(inv, tools), nit, hp))
    rows.sort(key=lambda x: x[0])
    return rows


def bin_bot(rows):
    bins = defaultdict(Counter)
    obs = sorted(((t + ((dur or 0) / 1000.0 if not kind.startswith('_') else 0.0), kind, v, i, nit, hp)
                  for t, kind, dur, v, i, nit, hp in rows), key=lambda o: o[0])
    # (1) the RAW measure, exactly ugsafe2_analyse.py's -- the positive control against an.pkl
    pn = None
    for to, kind, v, i, nit, hp in obs:
        if nit is None or hp is None:
            continue
        b = int(to // BIN)
        if kind == '_death':
            bins[b]['lost_items'] += nit
            bins[b]['death'] += 1
        elif pn is not None:
            bins[b]['gained'] += max(0, nit - pn)
        pn = nit
    # (2) the VALUE measure through bagfixrule.accumulate -- the one estimator the live 24-h read also uses
    raw = [(t, kind, (dur or 0) / 1000.0, v if (nit is not None and hp is not None) else None,
            i if (nit is not None and hp is not None) else None) for t, kind, dur, v, i, nit, hp in rows]
    for (t, sec, dv, di, vl, il, death, dinv, invo) in accumulate(to_obs(raw)):
        c = bins[int(t // BIN)]
        c['vsec'] += sec; c['vgain'] += dv; c['vlost'] += vl; c['igain'] += di; c['ilost'] += il
        c['inv_obs'] += invo; c['deaths_with_inv'] += dinv
    return dict(bins)


if __name__ == '__main__':
    since = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
    until = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
    out = {}
    for d in sorted(glob.glob('/var/log/mcai/*/')):
        d = d.rstrip('/')
        if not glob.glob(os.path.join(d, 'skill-*.jsonl*')):
            continue
        rows = walk_bot(d, since, until)
        if not rows:
            continue
        out[os.path.basename(d)] = bin_bot(rows)
        tot = Counter()
        for c in out[os.path.basename(d)].values():
            tot.update(c)
        print(os.path.basename(d), len(rows), {k: round(v, 1) for k, v in tot.items()}, flush=True)
    pickle.dump(out, open(sys.argv[3], 'wb'), protocol=4)
    print('bots', len(out))
