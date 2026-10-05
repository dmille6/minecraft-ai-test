#!/usr/bin/env python3
"""Stage B1: score stuck-escalation answers against GROUND-TRUTH labels written BEFORE any model ran,
independently by Claude and by Codex (data/labels-claude.jsonl, data/labels-codex.jsonl).

    python3 stage_b_stuck.py agree                 # how far the two label sets agree (on each other's actions)
    python3 stage_b_stuck.py score out/*.jsonl

A label action is "skill" or "skill:arg=value[,arg=value]" with "any" and "<N"/">N" for integers. An answer
matches a label action when the skill is equal and every arg the label names is satisfied. Per engine an answer
is GOOD (matches a good action), BAD (matches a bad action), or UNLABELLED. Reported per model:
  good_both   GOOD under both label sets          bad_any   BAD under either
  good_one    GOOD under at least one             unl_both  unlabelled under both
and, for the items an engine marked unsolvable, how often the model still picked a BAD action.
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ONLY_IDS = None     # aggregate.py sets this to the screen ids so every model is scored on the same items


def parse_label(s):
    s = str(s).strip()
    if ':' not in s:
        return s, {}
    sk, rest = s.split(':', 1)
    args = {}
    for part in re.split(r',(?=[a-z_]+\s*[=<>])', rest):
        m = re.match(r'\s*([a-z_]+)\s*([=<>])\s*(.+?)\s*$', part)
        if m:
            args[m.group(1)] = (m.group(2), m.group(3))
        elif part.strip() == 'any':
            pass
    return sk.strip(), args


def matches(answer, label):
    sk, args = parse_label(label)
    if not isinstance(answer, dict) or answer.get('skill') != sk:
        return False
    a = answer.get('args') if isinstance(answer.get('args'), dict) else {}
    for k, (op, v) in args.items():
        if v == 'any':
            continue
        av = a.get(k)
        if op == '=':
            if str(av) != v:
                return False
        else:
            try:
                n = float(v)
            except ValueError:
                return False
            if not isinstance(av, (int, float)) or not ((av < n) if op == '<' else (av > n)):
                return False
    return True


def verdict(answer, lab):
    if lab is None:
        return 'nolabel'
    if any(matches(answer, g) for g in lab.get('good') or []):
        return 'good'
    if any(matches(answer, b) for b in lab.get('bad') or []):
        return 'bad'
    return 'unlabelled'


def load_labels(name):
    p = os.path.join(HERE, 'data', 'labels-%s.jsonl' % name)
    out = {}
    if os.path.exists(p):
        for l in open(p):
            l = l.strip()
            if l.startswith('{'):
                try:
                    r = json.loads(l); out[r['id']] = r
                except (ValueError, KeyError):
                    pass
    return out


def cmd_agree():
    A, B = load_labels('claude'), load_labels('codex')
    ids = sorted(set(A) & set(B))
    agree_solv = sum(A[i].get('solvable') == B[i].get('solvable') for i in ids)
    cross = {'good_in_other_good': 0, 'good_in_other_bad': 0, 'n': 0}
    for i in ids:
        for x, y in ((A[i], B[i]), (B[i], A[i])):
            for g in x.get('good') or []:
                sk, args = parse_label(g)
                pseudo = {'skill': sk, 'args': {k: (int(v) if v.lstrip('-').isdigit() else v) for k, (op, v) in args.items() if op == '='}}
                cross['n'] += 1
                v = verdict(pseudo, y)
                cross['good_in_other_good'] += v == 'good'
                cross['good_in_other_bad'] += v == 'bad'
    print('labelled by both: %d; solvable verdict agrees on %d; a GOOD action of one engine is GOOD for the other %d/%d, BAD for the other %d/%d'
          % (len(ids), agree_solv, cross['good_in_other_good'], cross['n'], cross['good_in_other_bad'], cross['n']))


def cmd_score(paths):
    from score import parse_answer
    A, B = load_labels('claude'), load_labels('codex')
    res = {}
    for p in paths:
        recs = {}
        for l in open(p):
            r = json.loads(l)
            if r.get('set') == 'stuck' and (ONLY_IDS is None or r['id'] in ONLY_IDS):
                recs[r['id']] = r
        if not recs:
            continue
        lab = next(iter(recs.values()))['label']
        c = {'n': 0, 'good_both': 0, 'good_one': 0, 'bad_any': 0, 'unl_both': 0, 'invalid': 0}
        for i, r in recs.items():
            c['n'] += 1
            a = None if r.get('error') else parse_answer(r.get('content'))
            if not isinstance(a, dict) or not a.get('skill'):
                c['invalid'] += 1; c['bad_any'] += 1
                continue
            va, vb = verdict(a, A.get(i)), verdict(a, B.get(i))
            c['good_both'] += va == 'good' and vb == 'good'
            c['good_one'] += va == 'good' or vb == 'good'
            c['bad_any'] += va == 'bad' or vb == 'bad'
            c['unl_both'] += va in ('unlabelled', 'nolabel') and vb in ('unlabelled', 'nolabel')
        res[lab] = c
        n = max(1, c['n'])
        print('%-22s n=%2d good_both=%4.0f%% good_one=%4.0f%% bad_any=%4.0f%% unlabelled=%4.0f%% invalid=%d' % (
            lab, c['n'], 100.0 * c['good_both'] / n, 100.0 * c['good_one'] / n, 100.0 * c['bad_any'] / n, 100.0 * c['unl_both'] / n, c['invalid']))
    return res


if __name__ == '__main__':
    {'agree': cmd_agree, 'score': lambda: cmd_score(sys.argv[2:])}[sys.argv[1]]()
