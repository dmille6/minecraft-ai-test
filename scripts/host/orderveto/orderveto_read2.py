"""orderveto read 2: WHY the refused orders' own attempts fail, whether the cause had changed by the refusal,
what the long refusal streaks are, and the positive control (`_work_order` events in the skill log).
Same rows as orderveto_read.py (today's llm-*.jsonl, full walk, sorted per bot)."""
import json, glob, collections, sys, os, re
from datetime import datetime

SINCE = sys.argv[1] if len(sys.argv) > 1 else '2026-10-10T00:00:00'
UNTIL = sys.argv[2] if len(sys.argv) > 2 else '2026-10-10T13:28:00'   # the host was powered off 13:28:15Z
ARGS = json.load(open(os.path.expanduser('~/orderveto/skillargs.json')))
STACK = json.load(open(os.path.expanduser('~/orderveto/stacks.json')))


def est_slots(inv):
    return sum(-(-int(c) // max(1, STACK.get(n, 64))) for n, c in inv.items() if isinstance(c, (int, float)) and c > 0)



def key(skill, args):
    args = args or {}
    decl = ARGS.get(skill)
    names = sorted(decl) if decl is not None else sorted(args.keys())
    return skill + ':' + json.dumps({n: args[n] for n in names if n in args and args[n] is not None}, separators=(',', ':'), sort_keys=True)


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def fclass(det):
    d = det or ''
    for name, pat in [
        ('bag full -> deposit (craftroom)', r'frees slots|bag is \d+/36|no room|36/36|full bag|inventory (is )?full'),
        ('runner paused', r'paused after repeated failures'),
        ('missing ingredients', r'missing|need(s)? \d+ more|not enough'),
        ('table/furnace unreachable', r'crafting_table|furnace.*(away|reach)|could not be reached|no path'),
        ('interrupted (reflex)', r'^(entombed|stagnation|stuck|stranded|danger|low_health|flooded|death)'),
        ('timeout', r'timeout|ran out of time|timed out'),
        ('no output (smelt)', r'produced no'),
    ]:
        if re.search(pat, d, re.I):
            return name
    return 'other: ' + d[:60]


wo_ev = 0; order_rows = 0
att = collections.Counter(); att_ex = {}
under = collections.Counter()
ref_cause = collections.Counter()       # (reason, cause of the last same-key failure, cause still holds at the refusal?)
streak_rows = []
bots_with_refusals = set()
for f in sorted(glob.glob('/var/log/mcai/*/llm-*.jsonl')):
    bot = f.split('/')[-2]
    sk = f.replace('/llm-', '/skill-')
    if os.path.exists(sk):
        for l in open(sk, errors='replace'):
            if '_work_order' in l:
                try:
                    e = json.loads(l)
                except Exception:
                    continue
                if (e.get('skill') or {}).get('name') == '_work_order' and SINCE <= e.get('@timestamp', '') < UNTIL:
                    wo_ev += 1
    rows = []
    for l in open(f, errors='replace'):
        try:
            d = json.loads(l)
        except Exception:
            continue
        t = d.get('@timestamp', '')
        if not (SINCE <= t < UNTIL):
            continue
        llm = d.get('llm') or {}; o = d.get('outcome') or {}
        tc = (d.get('tool_calls') or [None])[0] or {}
        resp = ((d.get('response') or {}).get('text') or '')
        src = 'order' if (llm.get('latency_ms') or 0) == 0 and not resp and tc.get('skill') else 'model'
        inv = (d.get('bot') or {}).get('inventory') or {}
        rows.append(dict(t=t, src=src, skill=tc.get('skill'), k=key(tc.get('skill') or '?', tc.get('args')),
                         adm=llm.get('admission') is not None, st=o.get('status'), det=(o.get('detail') or '')[:200],
                         err=llm.get('error'), slots=est_slots(inv), ms=d.get('messages') or [], pos=(d.get('bot') or {}).get('pos')))
    rows.sort(key=lambda r: r['t'])
    last_fail = {}
    last_real = {}
    run = []
    for r in rows:
        if r['src'] == 'order':
            order_rows += 1
        if r['src'] == 'order' and r['adm']:
            c = r['st'] if r['st'] == 'success' else (r['st'] + ' | ' + fclass(r['det']))
            att[(r['skill'], c)] += 1; att_ex.setdefault((r['skill'], c), (bot, r['t'], r['det'][:120]))
        if r['adm']:
            if r['st'] in ('failed', 'unknown'):
                last_fail[r['k']] = (fclass(r['det']), r['slots'], r['t'], r['det'])
                if fclass(r['det']) != 'runner paused':
                    last_real[r['k']] = (fclass(r['det']), r['slots'], r['t'])
            elif r['st'] == 'success':
                last_fail.pop(r['k'], None)
                last_real.pop(r['k'], None)
        if r['src'] == 'order' and not r['adm'] and r['st'] == 'aborted':
            bots_with_refusals.add(bot)
            lf = last_fail.get(r['k'])
            if lf:
                cause = lf[0]
                still = ''
                if cause.startswith('bag full'):
                    still = 'no fewer slots than at the failure (HOLDS)' if r['slots'] >= lf[1] else 'fewer slots than at the failure (CHANGED)'
                elif cause == 'runner paused':
                    m = re.search(r'(\d+)s until auto-resume', lf[3])
                    if m:
                        still = 'inside the runner pause (HOLDS)' if ts(r['t']) < ts(lf[2]) + int(m.group(1)) else 'runner pause over (CHANGED)'
                ref_cause[(r['err'], cause, still)] += 1
                if cause == 'runner paused':
                    lr = last_real.get(r['k'])
                    under[(r['err'], lr[0] if lr else 'none', ('no fewer slots (HOLDS)' if r['slots'] >= lr[1] else 'fewer slots (CHANGED)') if lr and lr[0].startswith('bag full') else '')] += 1
            else:
                ref_cause[(r['err'], 'no failure on record', '')] += 1
            run.append(r)
        elif r['src'] == 'order' and r['adm'] or (r['adm'] and run):
            if len(run) >= 10:
                streak_rows.append((bot, run[0]['t'], run[-1]['t'], len(run), ts(run[-1]['t']) - ts(run[0]['t']),
                                    collections.Counter(x['err'] for x in run).most_common(2), run[0]['k'][:60], run[0]['slots'],
                                    r['src'], r['skill'], r['st']))
            run = []
    if len(run) >= 10:
        streak_rows.append((bot, run[0]['t'], run[-1]['t'], len(run), ts(run[-1]['t']) - ts(run[0]['t']),
                            collections.Counter(x['err'] for x in run).most_common(2), run[0]['k'][:60], run[0]['slots'], 'END', None, None))

print('POSITIVE CONTROL: _work_order events %d vs order rows %d (window %s..%s)' % (wo_ev, order_rows, SINCE, UNTIL))
print('bots with a refused order: %d' % len(bots_with_refusals))
print('\n== ADMITTED orders by outcome (denominator: admitted orders %d)' % sum(att.values()))
for (s, c), v in att.most_common(30):
    print('  %-8s %6d  %-60s e.g. %s' % (s, v, c, att_ex[(s, c)]))
print('\n== REFUSED orders: the cause of the same key\'s last failure, and whether it still held (denominator %d)' % sum(ref_cause.values()))
for (e, c, s), v in ref_cause.most_common(30):
    print('  %-12s %6d  %-40s %s' % (e, v, c, s))
print('\n== ... and for a last failure of runner paused, the last failure BEFORE the pause (denominator %d)' % sum(under.values()))
for (e, c, st), v in under.most_common(12):
    print('  %-12s %6d  %-40s %s' % (e, v, c, st))
print('\n== STREAKS of >= 10 consecutive refused orders (%d); total bot-h %.2f' % (len(streak_rows), sum(x[4] for x in streak_rows) / 3600))
for x in sorted(streak_rows, key=lambda x: -x[4])[:25]:
    print('  ', x)
