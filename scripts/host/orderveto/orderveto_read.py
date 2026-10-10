"""orderveto: are the admission gate's refusals of WORK ORDERS justified, and what do they cost?

Rows: today's /var/log/mcai/*/llm-<bot>.jsonl (one row per decision), sorted by time per bot. Full walk.
A row is a WORK ORDER when llm.latency_ms == 0 and the response text is empty (cognitive.mjs synthesises the
proposal and skips the LLM). Positive control: the same bot's skill log carries one `work_order` event per order.

Key = actionKey(skill, args) using the declared arg lists of SKILLS (skillargs.json, dumped from skills.mjs).
"""
import json, glob, collections, sys, os, re, statistics
from datetime import datetime

SINCE = sys.argv[1] if len(sys.argv) > 1 else '2026-10-10T00:00:00'
ARGS = json.load(open(os.path.expanduser('~/orderveto/skillargs.json')))


def key(skill, args):
    args = args or {}
    decl = ARGS.get(skill)
    names = sorted(decl) if decl is not None else sorted(args.keys())
    kept = {n: args[n] for n in names if n in args and args[n] is not None}
    return skill + ':' + json.dumps(kept, separators=(',', ':'), sort_keys=True)


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


rows_total = 0
bots = 0
order_rows = collections.Counter()      # (src, status)
refused = collections.Counter()          # (src, reason)
classes = collections.Counter()          # (reason, class)
cls_ex = {}
cost = collections.defaultdict(list)     # (src, reason) -> seconds until next decision
instead = collections.Counter()          # what the bot did at the next ADMITTED decision after a refused order
streaks = collections.Counter()          # length of consecutive refused-order runs
streak_secs = []
later = collections.Counter()            # (reason, class, later outcome of same key)
by_skill = collections.Counter()         # (reason, skill)
first_ts = None; last_ts = None
wo_events = 0

for f in sorted(glob.glob('/var/log/mcai/*/llm-*.jsonl')):
    rows = []
    for l in open(f, errors='replace'):
        try:
            d = json.loads(l)
        except Exception:
            continue
        t = d.get('@timestamp', '')
        if t < SINCE:
            continue
        llm = d.get('llm') or {}
        o = d.get('outcome') or {}
        tc = (d.get('tool_calls') or [None])[0] or {}
        resp = ((d.get('response') or {}).get('text') or '')
        src = 'order' if (llm.get('latency_ms') or 0) == 0 and not resp and tc.get('skill') else 'model'
        rows.append((t, src, tc.get('skill'), key(tc.get('skill') or '?', tc.get('args')),
                     llm.get('admission') is not None, o.get('status'), (o.get('detail') or '')[:160],
                     llm.get('error'), (tc.get('reason') or '')[:90], d.get('run_id'), (d.get('code') or {}).get('version')))
    if not rows:
        continue
    bots += 1
    rows.sort(key=lambda r: r[0])
    rows_total += len(rows)
    first_ts = min(first_ts or rows[0][0], rows[0][0]); last_ts = max(last_ts or rows[-1][0], rows[-1][0])
    # positive control: work_order events in the skill log, same window
    sk = f.replace('/llm-', '/skill-')
    if os.path.exists(sk):
        for l in open(sk, errors='replace'):
            if '"work_order"' in l:
                try:
                    e = json.loads(l)
                except Exception:
                    continue
                if (e.get('skill') or {}).get('name') == 'work_order' and e.get('@timestamp', '') >= SINCE:
                    wo_events += 1
    hist = []   # admitted rows so far: (t, key, status, detail, src)
    run = 0; run_start = None
    for i, r in enumerate(rows):
        t, src, skill, k, adm, st, det, err, why, run_id, ver = r
        order_rows[(src, 'admitted' if adm else ('refused' if st == 'aborted' else st))] += 1
        nxt = rows[i + 1] if i + 1 < len(rows) else None
        if adm:
            hist.append((t, k, st, det, src))
            if src == 'order' and run:
                streaks[min(run, 20)] += 1; streak_secs.append(ts(t) - ts(run_start)); run = 0
            continue
        if st != 'aborted':
            continue
        reason = err or 'other'
        refused[(src, reason)] += 1
        if nxt is not None:
            cost[(src, reason)].append(ts(nxt[0]) - ts(t))
        if src != 'order':
            continue
        if run == 0:
            run_start = t
        run += 1
        by_skill[(reason, skill)] += 1
        # --- classify from the bot's own history of this key ---
        same = [h for h in hist[-8:] if h[1] == k]     # the admission window is the last 8 admitted keys
        prev = [h for h in hist if h[1] == k]
        if reason == 'repeat_loop':
            sts = [h[2] for h in same]
            ok = sum(s == 'success' for s in sts); bad = sum(s in ('failed', 'unknown') for s in sts)
            ne = sum(s == 'no_effect' for s in sts)
            if len(same) < 4:
                c = 'window-mismatch (fewer than 4 same-key admissions in the last 8: restart/escape boundary)'
            elif ok >= 3:
                c = 'A: repeats a SUCCEEDING order (>=3 of the window succeeded)'
            elif bad >= 3:
                c = 'C: repeats a FAILING order (>=3 of the window failed/unknown)'
            elif ne >= 3:
                c = 'B: repeats a NO-EFFECT order (>=3 of the window were skips)'
            else:
                c = 'D: mixed window'
        elif reason == 'cooldown':
            p = prev[-1] if prev else None
            if not p:
                c = 'no prior admission of this key today (cooldown set before the window / by a restart-carried key?)'
            elif p[2] == 'failed':
                c = 'C: last attempt FAILED'
            elif p[2] == 'unknown':
                c = 'U: last attempt UNKNOWN (no measurable change)'
            else:
                c = 'X: last attempt ' + str(p[2])
        else:
            c = 'other gate: ' + reason
        classes[(reason, c)] += 1
        if (reason, c) not in cls_ex:
            pv = same[-1] if same else (prev[-1] if prev else None)
            cls_ex[(reason, c)] = (f.split('/')[-2], t, k[:70], why[:60], pv[2] if pv else None, (pv[3] if pv else '')[:90])
        # --- what happened LATER to the same key ---
        fut = next((rr for rr in rows[i + 1:] if rr[3] == k and rr[4]), None)
        later[(reason, c[:2], 'never admitted again today' if fut is None else 'later admitted -> ' + str(fut[5]))] += 1
        # --- what the bot did at its next admitted decision ---
        nadm = next((rr for rr in rows[i + 1:] if rr[4]), None)
        if nadm is not None:
            instead[(reason, nadm[1], nadm[2], 'same key' if nadm[3] == k else 'other key')] += 1


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


print('WINDOW %s .. %s  bots %d  rows %d' % (first_ts, last_ts, bots, rows_total))
print('POSITIVE CONTROL: work_order events in skill logs %d vs order rows %d' % (
    wo_events, sum(v for (s, _), v in order_rows.items() if s == 'order')))
for s in ('order', 'model'):
    n = sum(v for (ss, _), v in order_rows.items() if ss == s)
    print('== %s decisions %d: %s' % (s, n, ', '.join('%s %d (%.1f%%)' % (k2, v, 100 * v / n) for (ss, k2), v in order_rows.most_common() if ss == s)))
    for (ss, r), v in refused.most_common():
        if ss == s:
            c = cost[(ss, r)]
            print('   refused %-20s %6d (%.1f%% of %s)  secs to next decision: median %s p90 %s sum %.1f bot-h' % (
                r, v, 100 * v / n, s, q(c, .5) and round(q(c, .5)), q(c, .9) and round(q(c, .9)), sum(min(x, 600) for x in c) / 3600))
print('\n== refused ORDERS by skill')
for (r, sk), v in by_skill.most_common(25):
    print('  %-14s %-16s %6d' % (r, sk, v))
print('\n== CLASSES (refused orders), each with its first example = positive control')
for (r, c), v in sorted(classes.items(), key=lambda kv: (kv[0][0], -kv[1])):
    print('  %-12s %6d  %s\n       e.g. %s' % (r, v, c, cls_ex[(r, c)]))
print('\n== LATER: the same key, next time it was admitted')
for (r, c, w), v in sorted(later.items(), key=lambda kv: (kv[0][0], kv[0][1], -kv[1])):
    print('  %-12s %-3s %6d  %s' % (r, c, v, w))
print('\n== INSTEAD: next admitted decision after a refused order')
for (r, s, sk, same), v in instead.most_common(20):
    print('  %-12s %-6s %-16s %-9s %6d' % (r, s, sk, same, v))
print('\n== STREAKS of consecutive refused orders before the next admitted order (len: count)')
print('  ', dict(sorted(streaks.items())), ' secs median %s p90 %s max %s' % (q(streak_secs, .5), q(streak_secs, .9), max(streak_secs) if streak_secs else None))
