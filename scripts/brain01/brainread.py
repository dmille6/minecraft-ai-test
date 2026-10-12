#!/usr/bin/env python3
"""brain-01 READ (registered with the canary; host: /tmp/brainread.py, invoked by canary-loop.sh as `brainread.py <M>`).

    python3 brainread.py <M>                       the loop: pools/declared_at/sha from the trial manifest; writes the
                                                   bound evidence object via ~/readjson.py emit (verdict.py reads it)
    python3 brainread.py --pools P,Q --declared <ISO> [--minutes M] [--json OUT]    a dry run (no emit)

Canary bots = the bots of --pools; control = every other fleet bot except placebo-c, isolated-* and the fixed
brain subset (/srv/mcbots/brain-subset.json, if any). Rows: llm-<bot>.jsonl (decisions) and skill-<bot>.jsonl
(_brain_config, _brain_share, deaths), rotation-aware (.gz read too), sorted by time. Before = the same length of
time immediately before --declared; after = --declared .. +M. Every gate prints its denominator, and the
liveness gate is the positive control for the rest: a canary whose bots never decided by gemma4 is INERT, and
nothing else in this read can be read.

GATES (any FAIL = the canary is broken, whatever the primaries say):
  G1 liveness        share of the canary's MODEL decisions with llm.brain == gemma4      >= 0.80
  G2 fallback        share with brain == local (the Studio slow or down)                 <= 0.20
  G3 nothing served  model decisions no endpoint answered (llm.endpoint null) per bot-h <= control's + 0.5
  G4 schema-valid    canary gemma4 decisions' schema-valid share                         >= control's - 0.01
  G5 slow decisions  gemma4 decisions slower than the fleet's own 45 s budget             <= 0.5%
  G6 model_mismatch  canary rows carrying a mismatch                                     == 0
  G7 config          every canary bot's _brain_config names gemma4 as its FIRST endpoint all
  G8 every bot       each canary bot >= 1 model decision / 10 min, >= 60% of them gemma4 all
PRIMARIES (DiD, canary minus control, after minus before; reported with the null-DiD SD measured 10-12 on the
fleet -- see docs/reports/brain01-design-2026-10-12.md): refused-at-admission share of model decisions; success
share; decisions per bot-hour (not gated: a 3 h placebo of two untouched pools gave -20%); stagnation events per bot-hour; items per bot-hour (report only, MDE ~93% of the mean); stone and iron
pickaxe crafts per bot-hour. HARM: deaths per bot-hour (the loop's death gate, two-death floor, is authoritative).
"""
import argparse, collections, glob, gzip, json, os, re, statistics as st, sys
from datetime import datetime, timedelta, timezone
P = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
TS = re.compile(r'\{"@timestamp":\s*"([^"]+)"')


def rows(path, t0, t1):
    out = []
    for f in sorted(glob.glob(path) + glob.glob(path + '-*')):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for l in fh:
                    m = TS.match(l)
                    ts = m.group(1) if m else None
                    if not ts or ts < t0 or ts >= t1:
                        continue
                    try:
                        out.append(json.loads(l))
                    except ValueError:
                        pass
        except OSError:
            pass
    out.sort(key=lambda d: d['@timestamp'])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('window', nargs='?', type=float, default=None, help='the loop: the read minute M')
    ap.add_argument('--pools', default=None); ap.add_argument('--declared', default=None)
    ap.add_argument('--minutes', type=float, default=None); ap.add_argument('--json', default=None)
    ap.add_argument('--logroot', default='/var/log/mcai'); ap.add_argument('--subset', default='/srv/mcbots/brain-subset.json')
    a = ap.parse_args()
    LOOP = a.pools is None
    if LOOP:                      # bound to the ACTIVE canary, exactly as the other registered reads
        man = json.load(open('/srv/mcbots/trial-manifest.json'))
        a.pools, a.declared = man['canary_pool'], man['declared_at']
    pools = [p.strip() for p in a.pools.split(',') if p.strip()]
    d0 = P(a.declared); now = datetime.now(timezone.utc)
    elapsed = (now - d0).total_seconds() / 60
    mins = min(elapsed, a.window if a.window is not None else (a.minutes if a.minutes is not None else elapsed))
    t_after = (d0, d0 + timedelta(minutes=mins)); t_before = (d0 - timedelta(minutes=mins), d0)
    iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%S')
    subset = set()
    if os.path.exists(a.subset):
        subset = set(json.load(open(a.subset)).get('bots') or [])
    bots = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob(a.logroot + '/*-*/'))
    canary = [b for b in bots if any(b.startswith(p + '-') for p in pools)]
    control = [b for b in bots if b not in canary and b not in subset and not b.startswith('placebo-c-') and not b.startswith('isolated')]
    res = {'pools': pools, 'declared': a.declared, 'minutes': round(mins, 1), 'canary_bots': canary, 'control_bots': len(control), 'gates': {}, 'primary': {}}

    def tally(group, win):
        c = collections.Counter(); hours = collections.Counter(); cfg = {}; per = collections.defaultdict(collections.Counter)
        for b in group:
            L = rows('%s/%s/llm-%s.jsonl' % (a.logroot, b, b), iso(win[0]), iso(win[1]))
            S = rows('%s/%s/skill-%s.jsonl' % (a.logroot, b, b), iso(win[0]), iso(win[1]))
            ts = [r['@timestamp'] for r in L]          # bot-hours from DECISION rows only (Codex r1: skill traffic is not a brain)
            if ts:
                hours[b] = (P(max(ts)) - P(min(ts))).total_seconds() / 3600
            for r in L:
                llm = r.get('llm') or {}; o = (r.get('outcome') or {}).get('status'); model = (llm.get('latency_ms') or 0) > 0
                c['rows'] += 1; c['model'] += model
                br = llm.get('brain', 'absent'); c['brain:%s' % br] += 1
                # NOTHING SERVED, comparably in both arms: llm.endpoint is null on every build (the baseline has no brain)
                c['unserved'] += ('endpoint' in llm and llm.get('endpoint') is None and (llm.get('latency_ms') or 0) > 0)
                per[b]['model'] += model; per[b]['gemma4'] += (model and br == 'gemma4')
                if model:
                    c['refused'] += (o == 'aborted' and llm.get('admission') is None); c['success'] += (o == 'success')
                    if br == 'gemma4':
                        c['g_valid'] += bool(llm.get('schema_valid')); c['g_n'] += 1
                        c['g_slow'] += (llm.get('latency_ms') or 0) > 45000
                    c['valid'] += bool(llm.get('schema_valid'))
                c['mismatch'] += bool(llm.get('model_mismatch'))
                for tc in (r.get('tool_calls') or [])[:1]:
                    if tc.get('skill') == 'craft' and o == 'success' and (tc.get('args') or {}).get('item') in ('stone_pickaxe', 'iron_pickaxe'):
                        c['craft:%s' % tc['args']['item']] += 1
            for r in S:
                sk = r.get('skill') or {}; n = sk.get('name', '')
                if n == '_brain_config':
                    cfg[b] = sk.get('detail', '')
                if n.startswith('_stagnation') or 'STAGNANT' in (sk.get('detail') or ''):
                    c['stagnant'] += 1
                if n == '_death':
                    c['deaths'] += 1
                c['items'] += sum(v for v in (sk.get('inventory_delta') or {}).values() if isinstance(v, (int, float)) and v > 0)
        c['bot_h'] = sum(hours.values())
        return c, cfg, per

    ca, cfg, per = tally(canary, t_after); cb, _, _ = tally(canary, t_before)
    oa, _, _ = tally(control, t_after); ob, _, _ = tally(control, t_before)
    res['denominators'] = {'canary_after': dict(ca), 'control_after': {k: oa[k] for k in ('rows', 'model', 'bot_h')}}
    rate = lambda c, k, d='model': c[k] / c[d] if c[d] else None
    perh = lambda c, k: c[k] / c['bot_h'] if c['bot_h'] else None
    G = res['gates']
    G['G1_liveness'] = {'value': rate(ca, 'brain:gemma4'), 'denominator': ca['model'], 'pass': (rate(ca, 'brain:gemma4') or 0) >= 0.80}
    G['G2_fallback'] = {'value': rate(ca, 'brain:local'), 'denominator': ca['model'], 'pass': (rate(ca, 'brain:local') or 0) <= 0.20}
    G['G3_nothing_served_per_bot_h'] = {'value': perh(ca, 'unserved'), 'control': perh(oa, 'unserved'),
                                        'pass': (perh(ca, 'unserved') or 0) <= (perh(oa, 'unserved') or 0) + 0.5}
    gv, cv = rate(ca, 'g_valid', 'g_n'), rate(oa, 'valid')
    G['G4_schema_valid'] = {'value': gv, 'control': cv, 'denominator': ca['g_n'], 'pass': gv is not None and cv is not None and gv >= cv - 0.01}
    def did(k, f):
        v = [f(x, k) for x in (ca, cb, oa, ob)]
        return None if None in v else (v[0] - v[1]) - (v[2] - v[3]), v
    # DECISIONS PER BOT-HOUR is REPORTED, not gated: a 3 h placebo read of two untouched pools (hive-a, hive-b,
    # 10-12) already gave DiD -15.8/bot-h (-20%), so a -10% gate would revert on noise. Missed decisions are gated
    # directly instead: G3 (nothing served) and G5 (a gemma4 decision slower than the fleet's own 45 s budget).
    dd, v = did('rows', perh)
    res['primary']['decisions_per_bot_h'] = {'did': dd, 'canary_after_before_control_after_before': v}
    G['G5_slow_gemma4_decisions'] = {'value': ca['g_slow'], 'of': ca['g_n'], 'pass': ca['g_slow'] <= 0.005 * ca['g_n']}
    G['G6_model_mismatch_rows'] = {'value': ca['mismatch'], 'pass': ca['mismatch'] == 0}
    first = lambda d: d.split('pool=[', 1)[1].split(' ', 1)[0] if 'pool=[' in d else None   # the FIRST pool entry's label
    G['G7_brain_config'] = {'bots_with_gemma4_first': sum(1 for b in canary if first(cfg.get(b, '')) == 'gemma4'), 'of': len(canary),
                            'pass': len(canary) > 0 and all(first(cfg.get(b, '')) == 'gemma4' for b in canary)}
    # G8 EVERY canary bot decides, and by gemma4 (Codex r1: one live bot of ten passed every pooled gate). The floor is
    # 1 model decision per 10 min per bot over the window; the per-bot gemma4 share floor is 0.6.
    floor = max(1, int(mins / 10))
    lame = {b: dict(per[b]) for b in canary if per[b]['model'] < floor or per[b]['gemma4'] < 0.6 * max(1, per[b]['model'])}
    G['G8_every_bot_on_gemma4'] = {'floor_model_decisions': floor, 'failing_bots': lame, 'of': len(canary), 'pass': len(canary) > 0 and not lame}
    for k, f in (('refused', rate), ('success', rate), ('stagnant', perh), ('items', perh), ('deaths', perh),
                 ('craft:stone_pickaxe', perh), ('craft:iron_pickaxe', perh)):
        dv, parts = did(k, f)
        res['primary'][k] = {'did': dv, 'canary_after_before_control_after_before': parts}
    res['all_gates_pass'] = all(g['pass'] for g in G.values())
    # FLAT FIELDS for the registration's own_lines (the loop compares one top-level field with one value).
    res['gates_failed'] = sum(1 for g in G.values() if not g['pass'])
    res['liveness_gemma4_share'] = G['G1_liveness']['value'] or 0
    res['model_mismatch_rows'] = ca['mismatch']
    res['canary_model_decisions'] = ca['model']
    res['canary_bot_h'] = round(ca['bot_h'], 1)
    # Exposure: enough gemma4 decisions to read the primaries at all (power: docs/reports/brain01-design-2026-10-12.md).
    res['exposure_ready'] = int(ca['brain:gemma4'] >= 1500 and ca['bot_h'] >= 50 and not lame)
    print(json.dumps(res, indent=1, default=str))
    if a.json:
        json.dump(res, open(a.json, 'w'), indent=1, default=str)
    if LOOP:                      # the bound evidence object verdict.py requires (readjson: sha, pools, run_id, declared_at, window)
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('brainread', a.window if a.window is not None else mins, {k: v for k, v in res.items() if k not in ('canary_bots',)})


if __name__ == '__main__':
    main()
