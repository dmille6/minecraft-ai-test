#!/usr/bin/env python3
"""Score benchmark runs. Deterministic checks only; the judged part is judge_pack.py / judge_merge.py.

    python3 score.py out/*.jsonl [--json scores.json] [--md scores.md]

POSITIVE CONTROL FIRST: every feasibility check is also applied to the action the FLEET'S OWN 7B
actually logged for the same prompt. The strata were drawn by real outcome, so the checks must fire
on the logged actions of the failure strata (e.g. craft_missing) far more than on `success` -- if
they do not, the instrument is blind and the per-model numbers below it mean nothing.

Brain metrics (per model):
  valid        parsed JSON, skill in the enum, args allowed and well-formed, saw_end echoed
  infeasible   a hard check fires: craft of a known recipe target not in CAN CRAFT NOW; smelt of an
               item not in CAN SMELT NOW; mine to a y above the printed ceiling; goto > 40 blocks up
  ignores_lesson  the exact args a LESSONS line says failed N times (and no line says worked) -- a
               weak signal, reported apart: 9% of logged SUCCESSES match one too
  soft         gather of a block the observation does not mention; craft of an item already held
  rep_fail     on a FAILURE stratum: the same action (skill + key arg) the fleet really took and that
               really failed / was rejected (repeat_loop: the looped action itself)
  agree        on the SUCCESS stratum: same skill (and same skill + key arg) as the action that worked
  bad          invalid OR infeasible -- the headline (a DETECTED hard-constraint violation; the checks
               cover crafts, smelts, mine/goto elevation only, so this is a floor, not the waste rate)
  rep_exact    rep_fail with identical args (player ignored)
"""
import argparse, collections, glob, json, math, os, re, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'mayor'))

CRAFT_TARGETS = {'stone_pickaxe', 'iron_pickaxe', 'wooden_pickaxe', 'stone_axe', 'wooden_axe', 'stone_sword',
                 'wooden_sword', 'stone_shovel', 'furnace', 'crafting_table', 'chest', 'ladder', 'torch', 'stick',
                 'oak_planks'}
FAIL_STRATA = {'repeat_loop', 'cooldown', 'craft_missing', 'unreachable', 'bad_args', 'failed_other'}
ARG_PAT = {'block': re.compile(r'^[a-z0-9_]{1,32}$'), 'item': re.compile(r'^[a-z0-9_]{1,32}$'),
           'player': re.compile(r'^[A-Za-z0-9_-]{1,24}$')}


def load_jsonl(p):
    with open(p) as fh:
        return [json.loads(l) for l in fh if l.strip()]


def parse_answer(content):
    if not content:
        return None
    s = content.strip()
    if s.startswith('```'):
        s = re.sub(r'^```[a-z]*\s*|\s*```$', '', s)
    try:
        return json.loads(s)
    except ValueError:
        pass
    i, j = s.find('{'), s.rfind('}')
    if i >= 0 and j > i:
        try:
            return json.loads(s[i:j + 1])
        except ValueError:
            return None
    return None


# ------------------------------------------------------------------ prompt facts --------------
def facts(text):
    f = {}
    m = re.search(r'position (-?\d+),(-?\d+),(-?\d+)', text)
    f['y'] = int(m.group(2)) if m else None
    m = re.search(r'you must pass y=(-?\d+) or lower', text)
    f['mine_cap'] = int(m.group(1)) if m else (f['y'] - 1 if f['y'] is not None else None)
    m = re.search(r'^CAN CRAFT NOW: ([^\n(]*)', text, re.M)
    f['craftable'] = {x.strip() for x in m.group(1).split(',') if x.strip()} if m else set()
    f['craft_line'] = bool(m)
    m = re.search(r'^CAN SMELT NOW: ([^\n]*)', text, re.M)
    f['smeltable'] = set(re.findall(r'([a-z0-9_]+) ->', m.group(1))) if m else set()
    m = re.search(r'^INVENTORY: ([^\n]*)', text, re.M)
    f['inv'] = {k: int(v) for k, v in re.findall(r'([a-z0-9_]+) x(\d+)', m.group(1))} if m else {}
    seen = set()
    for line in re.findall(r'^(?:NEARBY|BLOCK CHECKS[^:]*): ([^\n]*)', text, re.M):
        seen |= set(re.findall(r'([a-z0-9_]+)(?:@| visible=)', line))
    for line in re.findall(r'seen at x=', text):
        pass
    seen |= set(re.findall(r'- ([a-z0-9_]+) seen at x=', text))
    f['seen'] = seen
    f['lessons_failed'], f['lessons_worked'] = [], []
    for key, pat in (('lessons_failed', r'has failed \d+x'), ('lessons_worked', r'has worked \d+x')):
        for sk, js in re.findall(r'- ([a-z_]+)\((\{.*?\})\) ' + pat, text):
            try:
                f[key].append((sk, json.loads(js)))
            except ValueError:
                pass
    return f


def key_of(skill, args):
    args = args or {}
    if skill in ('gather',):
        return (skill, args.get('block'))
    if skill in ('craft', 'smelt', 'deposit', 'place', 'withdraw', 'eat', 'compost', 'dispose_well'):
        return (skill, args.get('item'))
    if skill == 'mine':
        return (skill, args.get('y'))
    if skill == 'goto':
        if args.get('player'):
            return (skill, 'player:' + str(args.get('player')))
        return (skill, tuple(args.get(k) for k in ('x', 'y', 'z')))
    if skill == 'bucket':
        return (skill, args.get('action'))
    if skill == 'build':
        return (skill, args.get('plan'))
    return (skill,)


def args_match(a, b):
    """LESSONS args vs chosen args: equal on every key the lesson names (player ignored)."""
    for k, v in b.items():
        if k == 'player':
            continue
        if (a or {}).get(k) != v:
            return False
    return True


def check_action(skill, args, f):
    """-> (hard flags, soft flags)."""
    hard, soft = [], []
    args = args or {}
    if skill == 'craft':
        it = args.get('item')
        if it in CRAFT_TARGETS and it not in f['craftable'] and len(f['craftable']) < 6:
            held = f['inv'].get(it, 0) > 0 and not it.endswith('_pickaxe')
            (soft if held else hard).append('craft_held' if held else 'craft_not_craftable')
        elif f['inv'].get(it, 0) > 0 and not str(it).endswith('_pickaxe'):
            soft.append('craft_held')
    elif skill == 'smelt':
        if args.get('item') not in f['smeltable']:
            hard.append('smelt_not_smeltable')
    elif skill == 'mine':
        y = args.get('y')
        if isinstance(y, int) and f['mine_cap'] is not None and y > f['mine_cap']:
            hard.append('mine_above_ceiling')
    elif skill == 'goto':
        y = args.get('y')
        if isinstance(y, int) and f['y'] is not None and y - f['y'] > 40:
            hard.append('goto_too_high')
    elif skill == 'gather':
        b = args.get('block')
        if b and b not in f['seen']:
            soft.append('gather_not_in_view')
    # A LESSONS line naming these exact args as failing is HARD only when no line names them as working:
    # `gather dirt count 1` is listed both ways (failed 4997x, worked 7371x) and is not a mistake.
    failed = any(sk == skill and la and args_match(args, la) for sk, la in f['lessons_failed'])
    worked = any(sk == skill and la and args_match(args, la) for sk, la in f['lessons_worked'])
    if failed:
        (soft if worked else hard).append('lessons_says_failed')
    return hard, soft


def schema_ok(ans, sp, sentinel, extra=()):
    if not isinstance(ans, dict):
        return False, 'not_json'
    skills = set(sp['skills'])
    if ans.get('skill') not in skills:
        return False, 'skill_not_in_enum'
    args = ans.get('args')
    if not isinstance(args, dict):
        return False, 'args_not_object'
    allowed = set(sp['schema']['properties']['args']['properties'])
    if set(args) - allowed:
        return False, 'arg_not_allowed'
    for k, pat in ARG_PAT.items():
        if k in args and (not isinstance(args[k], str) or not pat.match(args[k])):
            return False, 'arg_pattern'
    for k in ('count', 'x', 'y', 'z', 'blocks'):
        if k in args and (isinstance(args[k], bool) or not isinstance(args[k], int)):
            return False, 'arg_not_int'
    if not isinstance(ans.get('reason'), str):
        return False, 'reason_missing'
    if str(ans.get('saw_end', '')).strip() != sentinel:
        return False, 'sentinel'
    for k in extra:
        if not isinstance(ans.get(k), str) or not ans.get(k).strip():
            return False, 'missing_' + k
    return True, None


def failing_in_log(rows):
    """Action keys the body log shows failing >= 2 times in this spot."""
    c = collections.Counter()
    for r in rows or []:
        if r.get('status') in ('failed', 'aborted') and r.get('name') and not r['name'].startswith('_'):
            c[key_of(r['name'], r.get('args'))] += 1
    return {k for k, v in c.items() if v >= 2}


def pct(n, d):
    return None if not d else round(100.0 * n / d, 1)


def score_brain(items, recs, sysp, logged=False):
    rows = []
    for it in items:
        if it['set'] not in ('brain', 'stuck'):
            continue
        sp = sysp[it['system_hash']]
        f = facts(it['prompt_text'])
        if logged:
            ans = {'skill': it['logged']['skill'], 'args': it['logged']['args'], 'saw_end': it['sentinel'],
                   'diagnosis': 'x', 'reason': 'x'}
            ok, why = True, None
        else:
            r = recs.get(it['id'])
            if r is None:
                continue
            if r.get('error'):
                rows.append({'id': it['id'], 'set': it['set'], 'stratum': it['stratum'], 'valid': False,
                             'why': 'error', 'bad': True})
                continue
            ans = parse_answer(r.get('content'))
            ok, why = schema_ok(ans, sp, it['sentinel'], extra=('diagnosis',) if it['set'] == 'stuck' else ())
        row = {'id': it['id'], 'set': it['set'], 'stratum': it['stratum'], 'valid': ok, 'why': why}
        if ans is not None and isinstance(ans, dict) and ans.get('skill'):
            hard, soft = check_action(ans.get('skill'), ans.get('args') if isinstance(ans.get('args'), dict) else {}, f)
            k = key_of(ans.get('skill'), ans.get('args') if isinstance(ans.get('args'), dict) else {})
            lk = key_of(it['logged']['skill'], it['logged']['args'])
            row.update(hard=hard, soft=soft, skill=ans.get('skill'), key=str(k))
            row['rep_fail'] = (it['stratum'] in FAIL_STRATA or it['set'] == 'stuck') and k == lk
            la = {kk: vv for kk, vv in (it['logged']['args'] or {}).items() if kk != 'player'}
            ma = {kk: vv for kk, vv in (ans.get('args') if isinstance(ans.get('args'), dict) else {}).items() if kk != 'player'}
            row['rep_exact'] = row['rep_fail'] and ans.get('skill') == it['logged']['skill'] and la == ma
            if it['set'] == 'stuck':
                row['rep_logfail'] = k in failing_in_log(it.get('recent_rows'))
            if it['stratum'] == 'success':
                row['agree_skill'] = ans.get('skill') == it['logged']['skill']
                row['agree_key'] = k == lk
        else:
            row.update(hard=[], soft=[], rep_fail=False)
        row['lesson'] = 'lessons_says_failed' in (row.get('hard') or [])
        row['hard'] = [h for h in row.get('hard') or [] if h != 'lessons_says_failed']
        # HEADLINE (after the Codex method review): invalid OR a detected hard-constraint violation.
        # Repeating the logged failed action is reported APART: the key is coarse and the replay cannot
        # prove the repeat would fail again.
        row['bad'] = (not ok) or bool(row.get('hard'))
        rows.append(row)
    return rows


def summarize_brain(rows, set_name):
    rs = [r for r in rows if r['set'] == set_name]
    if not rs:
        return None
    n = len(rs)
    out = {'n': n,
           'valid': pct(sum(r['valid'] for r in rs), n),
           'infeasible': pct(sum(bool(r.get('hard')) for r in rs), n),
           'soft': pct(sum(bool(r.get('soft')) for r in rs), n),
           'ignores_lesson': pct(sum(bool(r.get('lesson')) for r in rs), n),
           'bad': pct(sum(r['bad'] for r in rs), n)}
    fr = [r for r in rs if r['stratum'] in FAIL_STRATA or set_name == 'stuck']
    out['rep_fail'] = pct(sum(bool(r.get('rep_fail')) for r in fr), len(fr))
    out['rep_exact'] = pct(sum(bool(r.get('rep_exact')) for r in fr), len(fr))
    rl = [r for r in rs if r['stratum'] == 'repeat_loop']
    out['loop_repeat'] = pct(sum(bool(r.get('rep_fail')) for r in rl), len(rl))
    sc = [r for r in rs if r['stratum'] == 'success']
    out['agree_skill'] = pct(sum(bool(r.get('agree_skill')) for r in sc), len(sc))
    out['agree_key'] = pct(sum(bool(r.get('agree_key')) for r in sc), len(sc))
    if set_name == 'stuck':
        out['rep_logfail'] = pct(sum(bool(r.get('rep_logfail')) for r in rs), n)
    flags = collections.Counter()
    for r in rs:
        for h in r.get('hard') or []:
            flags[h] += 1
        if not r['valid']:
            flags['invalid:' + str(r['why'])] += 1
    out['flags'] = dict(flags.most_common())
    out['skills'] = dict(collections.Counter(r.get('skill') for r in rs).most_common(8))
    by = {}
    for s in sorted({r['stratum'] for r in rs}):
        x = [r for r in rs if r['stratum'] == s]
        by[s] = {'n': len(x), 'bad': pct(sum(r['bad'] for r in x), len(x)),
                 'rep_fail': pct(sum(bool(r.get('rep_fail')) for r in x), len(x))}
    out['by_stratum'] = by
    return out


def score_overseer(items, recs):
    import mayor_core as core
    rows = []
    for it in items:
        if it['set'] != 'overseer':
            continue
        r = recs.get(it['id'])
        if r is None:
            continue
        snap = it['snap']
        cfg = dict(core.DEFAULTS)
        cfg.update(snap.get('cfg') or {})
        ans = None if r.get('error') else parse_answer(r.get('content'))
        v = core.validate(snap, ans, cfg) if ans is not None else {'valid': False, 'accepted': [], 'rejected': [], 'errors': ['no_json']}
        det = {a['candidate_id'] for a in it['det'].get('assignments') or []}
        acc = {a['candidate_id'] for a in v['accepted']}
        feas = [c for c in snap['candidates'] if c.get('feasible')]
        rows.append({'id': it['id'], 'stratum': it['stratum'], 'valid': v['valid'], 'n_acc': len(acc),
                     'n_rej': len(v['rejected']), 'rej': [x['why'].split(':')[0] for x in v['rejected']],
                     'errors': v['errors'][:3],
                     'jacc_det': (len(acc & det) / len(acc | det)) if (acc | det) else 1.0,
                     'abstain_ok': (not feas) == (not acc), 'n_feasible': len(feas)})
    if not rows:
        return None, rows
    n = len(rows)
    rej = collections.Counter(w for r in rows for w in r['rej'])
    errs = collections.Counter(e.split(':')[0] for r in rows for e in r['errors'])
    s = {'n': n, 'valid': pct(sum(r['valid'] for r in rows), n),
         'any_rejected': pct(sum(r['n_rej'] > 0 for r in rows), n),
         'mean_accepted': round(statistics.mean(r['n_acc'] for r in rows), 2),
         'agree_det_jaccard': round(statistics.mean(r['jacc_det'] for r in rows), 3),
         'staffs_when_feasible': pct(sum(r['n_acc'] > 0 for r in rows if r['n_feasible']), sum(1 for r in rows if r['n_feasible'])),
         'rejections': dict(rej.most_common()), 'errors': dict(errs.most_common())}
    return s, rows


def timing(recs, set_name):
    rs = [r for r in recs.values() if r['set'] == set_name and not r.get('error')]
    if not rs:
        return None
    clean = [r for r in rs if (r.get('load_s') or 0) < 0.5]
    w = sorted(r['wall_s'] for r in clean) or [0]
    def q(p):
        return round(w[min(len(w) - 1, int(p * len(w)))], 2)
    pe = [r['prompt_tokens'] / r['prompt_eval_s'] for r in clean if r.get('prompt_eval_s') and r.get('prompt_tokens')]
    ge = [r['gen_tokens'] / r['eval_s'] for r in clean if r.get('eval_s') and r.get('gen_tokens')]
    return {'n': len(rs), 'reloads': len(rs) - len(clean), 'p50_s': q(0.5), 'p90_s': q(0.9), 'max_s': round(w[-1], 1),
            'prompt_tps_med': round(statistics.median(pe)) if pe else None,
            'gen_tps_med': round(statistics.median(ge), 1) if ge else None,
            'gen_tokens_med': statistics.median([r.get('gen_tokens') or 0 for r in rs]),
            'thinking_chars_med': statistics.median([r.get('thinking_chars') or 0 for r in rs]),
            'concurrency': rs[0].get('concurrency')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('runs', nargs='+')
    ap.add_argument('--json')
    ap.add_argument('--control', action='store_true', help='print the positive control on the logged 7B actions')
    a = ap.parse_args()
    items = load_jsonl(os.path.join(HERE, 'data', 'mbench-sample.jsonl')) + load_jsonl(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))
    sysp = json.load(open(os.path.join(HERE, 'data', 'system_prompts.json')))

    ctrl = score_brain(items, {}, sysp, logged=True)
    print('POSITIVE CONTROL -- checks applied to the action the fleet 7B actually logged (by stratum):')
    for s in sorted({r['stratum'] for r in ctrl if r['set'] == 'brain'}):
        x = [r for r in ctrl if r['stratum'] == s and r['set'] == 'brain']
        fl = collections.Counter(h for r in x for h in r['hard'] + (['lesson'] if r.get('lesson') else []))
        print('  %-14s n=%3d  hard-check fired %5.1f%%  soft %5.1f%%  %s' % (
            s, len(x), 100.0 * sum(bool(r['hard']) for r in x) / len(x), 100.0 * sum(bool(r['soft']) for r in x) / len(x),
            dict(fl.most_common(4))))
    x = [r for r in ctrl if r['set'] == 'stuck']
    print('  %-14s n=%3d  hard %5.1f%%  repeats a failing action in its own log %5.1f%%' % (
        'stuck(logged)', len(x), 100.0 * sum(bool(r['hard']) for r in x) / max(1, len(x)),
        100.0 * sum(bool(r.get('rep_logfail')) for r in x) / max(1, len(x))))

    report = {}
    for p in a.runs:
        recs = {}
        for r in load_jsonl(p):
            recs[r['id']] = r          # last attempt wins
        label = next(iter(recs.values()))['label'] if recs else os.path.basename(p)
        rows = score_brain(items, recs, sysp)
        osum, orows = score_overseer(items, recs)
        report[label] = {'model': next(iter(recs.values()))['model'] if recs else None,
                         'brain': summarize_brain(rows, 'brain'), 'stuck': summarize_brain(rows, 'stuck'),
                         'overseer': osum,
                         'timing': {s: timing(recs, s) for s in ('brain', 'stuck', 'overseer')}}
    print()
    hdr = '%-22s %5s %6s %6s %6s %6s %6s %6s | %6s %6s %6s | %6s %6s %6s %7s'
    print(hdr % ('label', 'n', 'valid', 'bad', 'infeas', 'repF', 'loopR', 'agrS', 'Svalid', 'Sbad', 'SrepL',
                 'Ovalid', 'Orej', 'Ojac', 'p50s'))
    for lab, r in report.items():
        b, s, o, t = r['brain'] or {}, r['stuck'] or {}, r['overseer'] or {}, (r['timing'].get('brain') or {})
        print(hdr % (lab[:22], b.get('n'), b.get('valid'), b.get('bad'), b.get('infeasible'), b.get('rep_fail'),
                     b.get('loop_repeat'), b.get('agree_skill'), s.get('valid'), s.get('bad'), s.get('rep_logfail'),
                     o.get('valid'), o.get('any_rejected'), o.get('agree_det_jaccard'), t.get('p50_s')))
    if a.json:
        json.dump(report, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
