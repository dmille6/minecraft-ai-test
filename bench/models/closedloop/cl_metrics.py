#!/usr/bin/env python3
"""Stage C metrics for ONE closed-loop run directory (on the bots host): ~/mbench-cl/runs/<run_id>/<bot>/

    python3 cl_metrics.py ~/mbench-cl/runs/<run_id> [--start ISO --end ISO] > metrics.json

POSITIVE CONTROL first: rows, bots, decisions, inventory snapshots per bot; a zero next to a zero control is
printed as UNCONTROLLED.

Per bot and per run (the RUN is the independent unit):
  output      useful resource-equivalent value: value(final inventory) + value of what deposit rows moved into
              chests (their negative inventory_delta). Fixed value table below: a log is 1, its 4 planks 1 in
              total, so crafting never creates value; dirt and junk are worth 0, so dirt farming cannot win.
  milestones  first time held: crafting_table, wooden_pickaxe, stone_pickaxe, furnace, raw_iron, iron_ingot,
              iron_pickaxe (minutes from the bot's first row; censored at the run end)
  pickless    share of inventory snapshots (time-weighted) with no pickaxe
  loops       repeat_loop rejections per bot-hour; decisions per bot-hour; model share of decisions
  deaths      death rows per bot-hour
  stuck       minutes inside windows of >= 10 min with the bot within 8 blocks of where the window started
  latency     llm.latency_ms p50/p95 of model decisions; llm errors (timeouts)
"""
import argparse, collections, glob, json, math, os, statistics, sys
from datetime import datetime

VALUE = {
    'log': 1.0, 'planks': 0.25, 'stick': 0.125, 'crafting_table': 1.0, 'wooden_pickaxe': 1.6, 'wooden_axe': 1.6,
    'wooden_sword': 1.0, 'wooden_shovel': 0.6, 'cobblestone': 0.5, 'stone_pickaxe': 1.8, 'stone_axe': 1.8,
    'stone_sword': 1.1, 'stone_shovel': 0.7, 'furnace': 4.0, 'coal': 2.0, 'charcoal': 1.5, 'raw_iron': 4.0,
    'iron_ingot': 5.0, 'iron_pickaxe': 15.5, 'iron_axe': 15.5, 'iron_sword': 10.5, 'iron_shovel': 5.5, 'torch': 0.6,
    'chest': 2.0, 'raw_copper': 1.0, 'copper_ingot': 1.5, 'bucket': 15.0, 'ladder': 0.3, 'diamond': 20.0,
    'sapling': 0.2, 'apple': 0.2,
}
MILESTONES = ['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'raw_iron', 'iron_ingot', 'iron_pickaxe']


def item_value(name, n):
    if name.endswith('_log') or name.endswith('_stem'):
        return VALUE['log'] * n
    if name.endswith('_planks'):
        return VALUE['planks'] * n
    if name.endswith('_sapling'):
        return VALUE['sapling'] * n
    return VALUE.get(name, 0.0) * n


def inv_value(inv):
    return sum(item_value(k, v) for k, v in (inv or {}).items() if isinstance(v, (int, float)))


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def load(path):
    out = []
    if not os.path.exists(path):
        return out
    for l in open(path, errors='replace'):
        try:
            out.append(json.loads(l))
        except ValueError:
            pass
    return out


def bot_metrics(d, t0, t1):
    name = os.path.basename(d.rstrip('/'))
    llm = load(os.path.join(d, 'llm-%s.jsonl' % name))
    sk = load(os.path.join(d, 'skill-%s.jsonl' % name))
    if t0:
        llm = [r for r in llm if r.get('@timestamp') and t0 <= ts(r['@timestamp']) <= t1]
        sk = [r for r in sk if r.get('@timestamp') and t0 <= ts(r['@timestamp']) <= t1]
    rows = sorted([r for r in llm + sk if r.get('@timestamp')], key=lambda r: r['@timestamp'])
    if not rows:
        return {'bot': name, 'rows': 0}
    start, end = ts(rows[0]['@timestamp']), ts(rows[-1]['@timestamp'])
    if t0:
        start, end = t0, t1
    hours = max(1e-6, (end - start) / 3600)
    snaps = [(ts(r['@timestamp']), (r.get('bot') or {}).get('inventory')) for r in rows if isinstance((r.get('bot') or {}).get('inventory'), dict)]
    poss = [(ts(r['@timestamp']), (r.get('bot') or {}).get('pos')) for r in rows if isinstance((r.get('bot') or {}).get('pos'), dict)]
    first = {}
    for t, inv in snaps:
        for m in MILESTONES:
            if m not in first and inv.get(m, 0) > 0:
                first[m] = round((t - start) / 60, 1)
    deposited = 0.0
    for r in sk:
        s = r.get('skill') or {}
        if s.get('name') == 'deposit' and s.get('status') == 'success' and isinstance(s.get('inventory_delta'), dict):
            if t0 and not (t0 <= ts(r['@timestamp']) <= t1):
                continue
            deposited += sum(item_value(k, -v) for k, v in s['inventory_delta'].items() if isinstance(v, (int, float)) and v < 0)
    final_inv = snaps[-1][1] if snaps else {}
    pickless = 0.0
    for (ta, inv), (tb, _) in zip(snaps, snaps[1:] + [(end, None)]):
        if not any(k.endswith('_pickaxe') and v > 0 for k, v in inv.items()):
            pickless += max(0.0, tb - ta)
    stuck = 0.0
    i = 0
    while i < len(poss):
        t_i, p_i = poss[i]
        j = i
        while j + 1 < len(poss) and all(isinstance(poss[j + 1][1].get(k), (int, float)) for k in 'xyz') and \
                math.dist([poss[j + 1][1][k] for k in 'xyz'], [p_i[k] for k in 'xyz']) <= 8:
            j += 1
        dur = poss[j][0] - t_i
        if dur >= 600:
            stuck += dur; i = j + 1
        else:
            i += 1
    dec = [r for r in llm if (r.get('llm') or {}).get('latency_ms')]
    lat = sorted(r['llm']['latency_ms'] / 1000 for r in dec)
    loops = sum(1 for r in llm if 'identical action' in str((r.get('outcome') or {}).get('detail', '')))
    deaths = sum(1 for r in rows if r.get('trigger') == 'death')
    errs = sum(1 for r in llm if (r.get('llm') or {}).get('error'))
    err_kinds = collections.Counter(str((r.get('llm') or {}).get('error'))[:40] for r in llm if (r.get('llm') or {}).get('error'))
    return {'bot': name, 'rows': len(rows), 'hours': round(hours, 3), 'snapshots': len(snaps),
            'output': round(inv_value(final_inv) + deposited, 2), 'output_per_h': round((inv_value(final_inv) + deposited) / hours, 2),
            'deposited_value': round(deposited, 2), 'final_inventory': final_inv,
            'milestones_min': first, 'pickless_share': round(pickless / max(1e-6, end - start), 3),
            'stuck_min': round(stuck / 60, 1), 'loops_per_h': round(loops / hours, 1), 'deaths': deaths,
            'decisions': len(dec), 'decisions_per_h': round(len(dec) / hours, 1), 'rejections': errs,
            'rejection_kinds': dict(err_kinds.most_common(4)),
            'latency_p50': round(lat[len(lat) // 2], 2) if lat else None,
            'latency_p95': round(lat[min(len(lat) - 1, int(0.95 * len(lat)))], 2) if lat else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_dir')
    ap.add_argument('--start'); ap.add_argument('--end')
    a = ap.parse_args()
    t0 = ts(a.start) if a.start else None
    t1 = ts(a.end) if a.end else None
    bots = [bot_metrics(d, t0, t1) for d in sorted(glob.glob(os.path.join(a.run_dir, '*/'))) if not d.rstrip('/').endswith('state')]
    bots = [b for b in bots if not b['bot'].endswith('-state')]
    ctl = {'bots': len(bots), 'rows': sum(b['rows'] for b in bots), 'snapshots': sum(b.get('snapshots', 0) for b in bots),
           'decisions': sum(b.get('decisions', 0) for b in bots)}
    print('POSITIVE CONTROL', json.dumps(ctl), file=sys.stderr)
    if not ctl['rows'] or not ctl['snapshots']:
        print('UNCONTROLLED: no rows or no inventory snapshots -- the read is blind', file=sys.stderr)
    live = [b for b in bots if b['rows']]
    run = {'control': ctl, 'bots': bots}
    if live:
        run['team_output_per_h'] = round(sum(b['output'] for b in live) / max(b['hours'] for b in live), 2)
        run['mean_output_per_bot_h'] = round(statistics.mean(b['output_per_h'] for b in live), 2)
        run['milestone_bots'] = {m: sum(1 for b in live if m in b['milestones_min']) for m in MILESTONES}
        run['first_team_min'] = {m: min((b['milestones_min'][m] for b in live if m in b['milestones_min']), default=None) for m in MILESTONES}
        run['pickless_share'] = round(statistics.mean(b['pickless_share'] for b in live), 3)
        run['stuck_min_per_bot'] = round(statistics.mean(b['stuck_min'] for b in live), 1)
        run['loops_per_bot_h'] = round(statistics.mean(b['loops_per_h'] for b in live), 1)
        run['deaths'] = sum(b['deaths'] for b in live)
        run['decisions_per_bot_h'] = round(statistics.mean(b['decisions_per_h'] for b in live), 1)
        run['rejections'] = sum(b['rejections'] for b in live)
        lat = [b['latency_p50'] for b in live if b['latency_p50'] is not None]
        run['latency_p50_med'] = statistics.median(lat) if lat else None
    print(json.dumps(run, indent=1))


if __name__ == '__main__':
    main()
