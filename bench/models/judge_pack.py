#!/usr/bin/env python3
"""Build BLIND judge packets from benchmark runs, and merge the judges' scores back.

    python3 judge_pack.py pack out/*.jsonl --dir judge/        # writes packets + a private key
    python3 judge_pack.py merge --dir judge/ --scores judge/claude-*.jsonl --scores judge/codex-*.jsonl

PACK. A fixed, stratified subset of items (seeded; the same for every model). For each item the
distinct answers across all models are pooled, deduplicated on the decision itself (skill + args, or
the overseer's accepted assignment set) and shown under shuffled letters. The judge never sees a model
name, a count of how many models chose an answer, or which answer the fleet logged. The letter->model
map is written to key.json, which the judges are never given.

MERGE. Each judge returns one JSON line per item: {"id": ..., "scores": {"A": {"score": 1-5,
"executable": true|false, "why": "..."}, ...}}. Per model: mean score, share scored >= 4, share
scored <= 2; judge agreement: Spearman rho and exact/within-1 agreement over all (item, letter) pairs
both judges scored, and the model ranking under each judge.
"""
import argparse, collections, glob, json, os, random, re, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'mayor'))

BRAIN_PICK = {'success': 14, 'repeat_loop': 10, 'cooldown': 8, 'craft_missing': 7, 'unreachable': 8,
              'bad_args': 4, 'failed_other': 5, 'trigger_other': 4}
OVERSEER_PICK = 12

RUBRIC = {
 'brain': """You are judging ONE decision of a Minecraft bot's planner. The bot sees exactly the OBSERVATION
below (its task, state, inventory, what it can craft/smelt now, nearby blocks, lessons from past runs,
recent events). It must pick ONE skill call. Several candidate answers (letters) are shown; each is a
JSON object {reason, skill, args}. Score EACH candidate 1-5:
 5 = the move a strong player would make here, given exactly what the observation says
 4 = a good, plausible move
 3 = acceptable but wasteful or indirect
 2 = likely to fail or waste the turn: missing prerequisites, repeats what the observation shows just
     failed or looped, targets something not available, ignores a clear signal in the observation
 1 = impossible, invalid, or harmful
Also say executable: true if the bot can actually perform it from where it is with what it has.""",
 'stuck': """You are judging advice for a Minecraft bot that has been STUCK in about the same place for many
minutes. You see its usual OBSERVATION plus its RECENT BODY LOG (reflex and skill rows with the game's
own failure details). Each candidate (letter) gives a short diagnosis and ONE skill call. Score EACH 1-5:
 5 = correct diagnosis AND an action that can be performed from exactly here with what it carries, and
     that plausibly gets it moving (or makes real progress toward that)
 4 = mostly right; the action is executable and sensible
 3 = partly right; the action is executable but unlikely to help much
 2 = wrong diagnosis, or the action repeats what the log shows failing here, or needs something the
     bot does not have and cannot get from here
 1 = impossible, invalid, or harmful
Also say executable: true if the action can be performed from where the bot is with what it carries.""",
 'overseer': """You are judging a town OVERSEER ("mayor") for one Minecraft world worked by up to five bots.
It reads one SNAPSHOT (bots, inventories, shortages S..., candidate duties C... with feasibility and
blockers, resource sightings R...) and proposes temporary duties for the next 10 minutes, or abstains.
Rules it was given: assign only feasible candidates; target must be one of the candidate's targets;
at most 2 bots per duty and 3 per world; one duty per bot; cite only snapshot ids; list unmet needs.
Each candidate answer (letter) is shown with what a strict validator ACCEPTED and REJECTED. Score
EACH 1-5 on usefulness to the town: right priorities (the most damaging shortage first), sensible
choice of bot among the feasible ones, honest unmet_needs / abstain, no rule-breaking, reasons that
match the snapshot. executable: true if every assignment it made was accepted by the validator.""",
}


def load_jsonl(p):
    with open(p) as fh:
        return [json.loads(l) for l in fh if l.strip()]


def items_all():
    return [x for f in sorted(glob.glob(os.path.join(HERE, 'data', 'mbench-sample*.jsonl'))) for x in load_jsonl(f)] + load_jsonl(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))


def pick_items(items, seed=7):
    rng = random.Random(seed)
    out = []
    by = collections.defaultdict(list)
    for it in items:
        if it['set'] == 'brain':
            by[it['stratum']].append(it)
    for s, n in BRAIN_PICK.items():
        x = sorted(by[s], key=lambda i: i['id'])
        rng.shuffle(x)
        out += x[:n]
    out += [it for it in items if it['set'] == 'stuck']
    ov = sorted([it for it in items if it['set'] == 'overseer'], key=lambda i: i['id'])
    rng.shuffle(ov)
    out += ov[:OVERSEER_PICK]
    return out


def answer_key(it, content):
    from score import parse_answer
    a = parse_answer(content)
    if not isinstance(a, dict):
        return ('INVALID',), {'raw': (content or '')[:300]}
    if it['set'] == 'overseer':
        import mayor_core as core
        cfg = dict(core.DEFAULTS); cfg.update(it['snap'].get('cfg') or {})
        v = core.validate(it['snap'], a, cfg)
        acc = sorted((x['candidate_id'], x['target'] or '') for x in v['accepted'])
        shown = {'answer': a, 'validator_accepted': [x['candidate_id'] for x in v['accepted']],
                 'validator_rejected': [{'candidate_id': (x['item'] or {}).get('candidate_id') if isinstance(x['item'], dict) else None,
                                         'why': x['why']} for x in v['rejected']],
                 'validator_errors': v['errors'][:5]}
        # Not deduplicated beyond identical text: reasons and unmet_needs differ even when the accepted
        # set is the same, and the rubric scores them (Codex method review, item 4).
        return ('O', json.dumps(a, sort_keys=True)), shown
    args = a.get('args') if isinstance(a.get('args'), dict) else {}
    args = {k: v for k, v in args.items() if k != 'player'}
    shown = {k: a.get(k) for k in ('diagnosis', 'reason', 'skill') if k in a}
    shown['args'] = a.get('args')
    if it['set'] == 'stuck':
        # The stuck rubric scores the diagnosis, so answers with different diagnoses stay separate.
        return ('S', a.get('skill'), json.dumps(args, sort_keys=True), str(a.get('diagnosis'))), shown
    return ('B', a.get('skill'), json.dumps(args, sort_keys=True)), shown


def context_text(it):
    if it['set'] == 'brain':
        return 'OBSERVATION:\n' + it['prompt_text']
    if it['set'] == 'stuck':
        import run_bench as R
        text = it['prompt_text']
        cut = text.rfind('saw_end:')
        return ('OBSERVATION:\n' + text[:cut] + '\nRECENT BODY LOG (seconds before this decision; oldest first):\n' +
                R.compact_rows(it.get('recent_rows') or [], it['t']))
    import mayor_frontier as F
    return F.build_prompt(it['snap'])


def cmd_pack(a):
    items = {i['id']: i for i in items_all()}
    picked = pick_items(list(items.values()))
    runs = {}
    for p in a.runs:
        recs = {}
        for r in load_jsonl(p):
            recs[r['id']] = r
        if recs:
            runs[next(iter(recs.values()))['label']] = recs
    os.makedirs(a.dir, exist_ok=True)
    rng = random.Random(11)
    key = {}
    packets = collections.defaultdict(list)
    for it in picked:
        groups = collections.OrderedDict()
        for lab in sorted(runs):
            r = runs[lab].get(it['id'])
            if r is None:
                continue
            k, shown = answer_key(it, None if r.get('error') else r.get('content'))
            groups.setdefault(k, {'shown': shown, 'labels': []})['labels'].append(lab)
        ks = list(groups)
        rng.shuffle(ks)
        letters = {}
        cands = {}
        for i, k in enumerate(ks):
            L = chr(65 + i)
            letters[L] = groups[k]['labels']
            cands[L] = groups[k]['shown']
        key[it['id']] = letters
        ctx = context_text(it)
        packets[it['set']].append({'id': it['id'], 'context': ctx, 'candidates': cands})
        # RELIABILITY COPIES (Codex plan): ~20% order-swapped (letters reversed), ~10% exact repeats, under ids the
        # judge cannot link back. Merged scores use only the original; the copies measure position bias and
        # self-consistency.
        r = rng.random()
        if r < 0.30 and len(cands) > 1:
            kind = 'swap' if r < 0.20 else 'rep'
            Ls = list(cands)
            order = list(reversed(Ls)) if kind == 'swap' else Ls
            cid = '%s~%s%d' % (it['set'][0], kind, len(key))
            key[cid] = {'of': it['id'], 'kind': kind, 'map': {chr(65 + j): L for j, L in enumerate(order)}}
            packets[it['set']].append({'id': cid, 'context': ctx, 'candidates': {chr(65 + j): cands[L] for j, L in enumerate(order)}})
    for s in packets:
        rng.shuffle(packets[s])
    for s, pk in packets.items():
        with open(os.path.join(a.dir, 'packet-%s.md' % s), 'w') as fh:
            fh.write('# Judge packet: %s (%d items)\n\n%s\n\nReturn ONE JSON line per item, nothing else:\n'
                     '{"id": "<item id>", "scores": {"A": {"score": 1-5, "executable": true|false, "why": "<= 20 words"}, ...}}\n'
                     'Score every letter. Judge each candidate on its own merits; several may deserve the same score.\n\n'
                     % (s, len(pk), RUBRIC[s]))
            for p in pk:
                fh.write('\n\n======== ITEM %s ========\n%s\n\n-------- CANDIDATES --------\n' % (p['id'], p['context']))
                for L, c in p['candidates'].items():
                    fh.write('%s: %s\n' % (L, json.dumps(c, separators=(',', ':'))[:3000]))
    json.dump(key, open(os.path.join(a.dir, 'key.json'), 'w'))
    print('packed', {s: len(v) for s, v in packets.items()}, 'models', sorted(runs),
          'mean candidates/item', round(statistics.mean(len(v) for v in key.values()), 1))


def spearman(x, y):
    def rank(v):
        o = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(o):
            j = i
            while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
                j += 1
            for k in range(i, j + 1):
                r[o[k]] = (i + j) / 2.0 + 1
            i = j + 1
        return r
    rx, ry = rank(x), rank(y)
    mx, my = statistics.mean(rx), statistics.mean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else None


def cmd_merge(a):
    key_all = json.load(open(os.path.join(a.dir, 'key.json')))
    copies = {k: v for k, v in key_all.items() if isinstance(v, dict) and 'of' in v}
    key = {k: v for k, v in key_all.items() if k not in copies}
    sets = {i['id']: i['set'] for i in items_all()}
    judges = {}
    for pat in a.scores:
        for p in glob.glob(pat):
            name = os.path.basename(p).split('-')[0]
            for line in open(p):
                line = line.strip()
                if not line.startswith('{'):
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r.get('id') in key_all:
                    judges.setdefault(name, {})[r['id']] = r.get('scores') or {}
    out = {'judges': {}, 'agreement': {}}
    for jn, sc in judges.items():
        per = collections.defaultdict(lambda: collections.defaultdict(list))
        for iid, letters in key.items():
            for L, labs in letters.items():
                s = (sc.get(iid) or {}).get(L)
                if not isinstance(s, dict) or not isinstance(s.get('score'), (int, float)):
                    continue
                for lab in labs:
                    per[sets[iid]][lab].append((s['score'], bool(s.get('executable'))))
        out['judges'][jn] = {st: {lab: {'n': len(v), 'mean': round(statistics.mean(x for x, _ in v), 2),
                                        'good': round(100.0 * sum(x >= 4 for x, _ in v) / len(v), 1),
                                        'poor': round(100.0 * sum(x <= 2 for x, _ in v) / len(v), 1),
                                        'exec': round(100.0 * sum(e for _, e in v) / len(v), 1)}
                                  for lab, v in sorted(labs.items())} for st, labs in per.items()}
    names = sorted(judges)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            A, B = judges[names[i]], judges[names[j]]
            for st in ('brain', 'stuck', 'overseer', 'all'):
                xs, ys = [], []
                for iid, letters in key.items():
                    if st != 'all' and sets[iid] != st:
                        continue
                    for L in letters:
                        sa, sb = (A.get(iid) or {}).get(L), (B.get(iid) or {}).get(L)
                        if isinstance(sa, dict) and isinstance(sb, dict) and isinstance(sa.get('score'), (int, float)) and isinstance(sb.get('score'), (int, float)):
                            xs.append(sa['score']); ys.append(sb['score'])
                if xs:
                    out['agreement']['%s~%s:%s' % (names[i], names[j], st)] = {
                        'pairs': len(xs), 'spearman': round(spearman(xs, ys), 3) if len(xs) > 2 else None,
                        'exact': round(100.0 * sum(x == y for x, y in zip(xs, ys)) / len(xs), 1),
                        'within1': round(100.0 * sum(abs(x - y) <= 1 for x, y in zip(xs, ys)) / len(xs), 1)}
    # reliability: the same judge on an order-swapped or repeated copy
    rel = {}
    for jn, sc in judges.items():
        for kind in ('swap', 'rep'):
            same = tot = within = 0
            for cid, c in copies.items():
                if c['kind'] != kind or cid not in sc or c['of'] not in sc:
                    continue
                for L_copy, L_orig in c['map'].items():
                    x, y = (sc[cid] or {}).get(L_copy), (sc[c['of']] or {}).get(L_orig)
                    if isinstance(x, dict) and isinstance(y, dict) and isinstance(x.get('score'), (int, float)) and isinstance(y.get('score'), (int, float)):
                        tot += 1; same += x['score'] == y['score']; within += abs(x['score'] - y['score']) <= 1
            if tot:
                rel['%s:%s' % (jn, kind)] = {'pairs': tot, 'exact': round(100.0 * same / tot, 1), 'within1': round(100.0 * within / tot, 1)}
    out['reliability'] = rel
    for k, v in rel.items():
        print('reliability', k, v)
    json.dump(out, open(os.path.join(a.dir, 'merged.json'), 'w'), indent=1)
    for jn, d in out['judges'].items():
        for st, labs in d.items():
            print('judge %-8s %-9s ' % (jn, st) + '  '.join('%s %.2f/%d%%' % (lab, v['mean'], v['good']) for lab, v in
                                                       sorted(labs.items(), key=lambda kv: -kv[1]['mean'])))
    for k, v in out['agreement'].items():
        print('agreement', k, v)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd')
    p = sub.add_parser('pack'); p.add_argument('runs', nargs='+'); p.add_argument('--dir', required=True)
    m = sub.add_parser('merge'); m.add_argument('--dir', required=True); m.add_argument('--scores', action='append', required=True)
    a = ap.parse_args()
    {'pack': cmd_pack, 'merge': cmd_merge}[a.cmd](a)


if __name__ == '__main__':
    main()
