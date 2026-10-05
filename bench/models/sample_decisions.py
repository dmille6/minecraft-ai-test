#!/usr/bin/env python3
"""Build the replay sample for the model benchmark from REAL fleet logs. READ-ONLY on the bots host.

    nice python3 sample_decisions.py --out /tmp/mbench-sample.jsonl [--seed 20261005]

Walks today's live /var/log/mcai/*/llm-*.jsonl (full walk; rotation is at ~23:59Z, so this is the
day so far), keeps only decisions the MODEL made (llm.latency_ms > 0, prompt text ending in the
saw_end sentinel), classifies each into a stratum by trigger and outcome, and draws a stratified
sample with a per-bot cap. Also draws STUCK episodes (a model decision taken while the bot then stayed
within 8 blocks for the next 10+ minutes, with a trap-type trigger or one of the all-day stranded
bots) and attaches the bot's last 25 skill/reflex rows before that decision.

Positive control printed first: rows walked, bots, model decisions, per-stratum population.
"""
import argparse, collections, glob, json, math, os, random, re, sys

STRATA = {           # name: (target n, predicate on (trigger, status, detail))
    'success':        90,
    'repeat_loop':    60,
    'cooldown':       45,   # "failed recently" / "has failed Nx across runs" admission vetoes
    'craft_missing':  40,
    'unreachable':    50,
    'bad_args':       30,
    'failed_other':   45,
    'unknown_noeff':  20,
    'trigger_other':  40,
}
STUCK_N = 40
ALLDAY = ('board-a-Comet', 'placebo-c-Bravo', 'placebo-c-Echo', 'board-c-Bravo')
TRAP_TRIGGERS = ('entombed', 'stuck', 'stagnation', 'stranded', 'flooded_pocket', 'liveness_restart', 'timeout')


def stratum(trigger, status, detail):
    d = detail or ''
    if trigger not in ('idle', None):
        return 'trigger_other'
    if status == 'aborted':
        if 'identical action' in d:
            return 'repeat_loop'
        if 'failed recently' in d or 'across runs' in d:
            return 'cooldown'
        if ('DOWNWARD' in d or 'blocks ABOVE' in d or re.search(r'count \d+ outside', d)
                or 'you hold no' in d):
            return 'bad_args'
        return None
    if status == 'failed':
        if d.startswith('cannot craft') or ('craft' in d and 'short' in d):
            return 'craft_missing'
        if 'unreachable' in d or 'buried' in d or 'beside water' in d or 'refused' in d:
            return 'unreachable'
        return 'failed_other'
    if status == 'success':
        return 'success'
    if status in ('unknown', 'no_effect'):
        return 'unknown_noeff'
    return None


def dist(a, b):
    return math.sqrt(sum((a[k] - b[k]) ** 2 for k in ('x', 'y', 'z')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--seed', type=int, default=20261005)
    ap.add_argument('--per-bot-cap', type=int, default=6)
    ap.add_argument('--files', default='/var/log/mcai/*/llm-*.jsonl', help='glob; .gz rotated files are read too')
    ap.add_argument('--scale', type=float, default=1.0, help='multiply every stratum target')
    ap.add_argument('--no-stuck', action='store_true')
    ap.add_argument('--id-prefix', default='')
    ap.add_argument('--hashes', default='', help='comma list: keep only these system_hash values (rebuildable prompts)')
    a = ap.parse_args()
    keep_hash = set(a.hashes.split(',')) if a.hashes else None
    rng = random.Random(a.seed)

    walked = 0
    model_rows = 0
    bots = set()
    pools = collections.defaultdict(list)          # stratum -> rows
    per_bot_rows = collections.defaultdict(list)    # bot -> [(t, pos, row)] for stuck detection
    import gzip
    for f in sorted(glob.glob(a.files)):
        fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        for line in fh:
            walked += 1
            try:
                r = json.loads(line)
            except ValueError:
                continue
            bot = (r.get('bot') or {}).get('name')
            bots.add(bot)
            L = r.get('llm') or {}
            p = r.get('prompt') or {}
            text = p.get('text') or ''
            pos = (r.get('bot') or {}).get('pos')
            if pos and all(isinstance(pos.get(k), (int, float)) for k in 'xyz'):
                per_bot_rows[bot].append((r.get('@timestamp'), pos, None))
            if not L.get('latency_ms') or not re.search(r'saw_end: END-[A-Z0-9]+\s*$', text):
                continue
            if keep_hash is not None and p.get('system_hash') not in keep_hash:
                continue
            tc = (r.get('tool_calls') or [None])[0]
            if not tc or not tc.get('skill'):
                continue
            model_rows += 1
            o = r.get('outcome') or {}
            s = stratum(r.get('trigger'), o.get('status'), o.get('detail'))
            rec = {
                'bot': bot, 'pool': (r.get('exp') or {}).get('pool'), 'role': (r.get('bot') or {}).get('role'),
                't': r.get('@timestamp'), 'trigger': r.get('trigger'), 'system_hash': p.get('system_hash'),
                'code_version': (r.get('code') or {}).get('version'),
                'prompt_text': text,
                'sentinel': re.search(r'saw_end: (END-[A-Z0-9]+)\s*$', text).group(1),
                'logged': {'skill': tc.get('skill'), 'args': tc.get('args') or {}, 'reason': tc.get('reason')},
                'outcome': {'status': o.get('status'), 'detail': (o.get('detail') or '')[:400]},
                'llm': {k: L.get(k) for k in ('model', 'prompt_tokens', 'completion_tokens', 'latency_ms', 'admission')},
                'milestone': ((r.get('messages') or [{}])[0] or {}).get('milestone'),
                'pos': pos,
            }
            if s:
                pools[s].append(rec)
            if r.get('trigger') in TRAP_TRIGGERS or bot in ALLDAY:
                pools['_stuck_cand'].append(rec)

    print('POSITIVE CONTROL: rows walked %d, bots %d, model decisions %d' % (walked, len(bots), model_rows))
    for k in sorted(pools):
        print('  population %-14s %6d' % (k, len(pools[k])))
    if model_rows < 1000:
        sys.exit('too few model decisions -- the query is wrong, not the fleet')

    def draw(rows, n, cap, taken):
        rng.shuffle(rows)
        out, by = [], collections.Counter()
        for r in rows:
            if len(out) >= n:
                break
            key = (r['bot'], r['t'])
            if key in taken or by[r['bot']] >= cap:
                continue
            out.append(r); by[r['bot']] += 1; taken.add(key)
        return out

    taken = set()
    sample = []
    for s, n in STRATA.items():
        n = int(round(n * a.scale))
        got = draw(pools[s], n, a.per_bot_cap, taken)
        for g in got:
            g['set'] = 'brain'; g['stratum'] = s
        sample += got
        print('  drew %-14s %3d / %d' % (s, len(got), n))

    # STUCK: the bot stays within 8 blocks over the next 10-20 min (real stranding, not a 2-min blip).
    idx = {b: sorted(v, key=lambda x: x[0]) for b, v in per_bot_rows.items()}
    def stays(rec):
        if not rec['pos']:
            return False
        rows = idx.get(rec['bot'], [])
        t0 = rec['t']
        later = [p for (t, p, _) in rows if t > t0][:400]
        # timestamps are ISO strings; compare by minutes via a cheap parse
        def mins(t):
            return int(t[11:13]) * 60 + int(t[14:16]) + int(t[17:19]) / 60.0
        m0 = mins(t0)
        win = [p for (t, p, _) in rows if t > t0 and t[:10] == t0[:10] and 10 <= mins(t) - m0 <= 20]
        return len(win) >= 2 and all(dist(p, rec['pos']) <= 8 for p in win)
    cands = [] if a.no_stuck else [r for r in pools['_stuck_cand'] if (r['bot'], r['t']) not in taken and stays(r)]
    allday = [r for r in cands if r['bot'] in ALLDAY]
    other = [r for r in cands if r['bot'] not in ALLDAY]
    print('  stuck candidates (stay<=8 blocks 10-20 min later): all-day bots %d, others %d' % (len(allday), len(other)))
    stuck = draw(allday, 16, 4, taken) + draw(other, STUCK_N - 16, 2, taken)
    for g in stuck:
        g['set'] = 'stuck'; g['stratum'] = 'stuck:' + (g['trigger'] or '')
    # Context: last 25 skill/reflex rows before the decision.
    for g in stuck:
        f = '/var/log/mcai/%s/skill-%s.jsonl' % (g['bot'], g['bot'])
        prev = []
        for line in open(f, errors='replace'):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('@timestamp', '') >= g['t']:
                continue
            sk = r.get('skill') or {}
            prev.append({'t': r.get('@timestamp'), 'trigger': r.get('trigger'), 'name': sk.get('name'),
                         'args': sk.get('args'), 'status': sk.get('status'), 'detail': (sk.get('detail') or '')[:220],
                         'pos': (r.get('bot') or {}).get('pos')})
        prev.sort(key=lambda x: x['t'])
        g['recent_rows'] = prev[-25:]
    sample += stuck
    print('  drew stuck %d' % len(stuck))

    for i, g in enumerate(sample):
        g['id'] = '%s%s-%03d' % (a.id_prefix, g['set'][0], i)
    with open(a.out, 'w') as fh:
        for g in sample:
            fh.write(json.dumps(g) + '\n')
    print('wrote %d to %s' % (len(sample), a.out))


if __name__ == '__main__':
    main()
