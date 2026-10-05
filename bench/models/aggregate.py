#!/usr/bin/env python3
"""One table per role across every run in out/, on COMMON items only (the screen set), for the report.

    python3 aggregate.py [--ref q25-7b] [--md out/scoreboard.md] [--json out/scoreboard.json]
"""
import argparse, collections, contextlib, glob, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score as S  # noqa: E402
import stage_b_planning as B3, stage_b_allocation as B2, stage_b_adversarial as B4, stage_b_stuck as B1  # noqa: E402


def quiet(f, *a):
    with contextlib.redirect_stdout(io.StringIO()):
        return f(*a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ref', default='q25-7b')
    ap.add_argument('--md'); ap.add_argument('--json')
    a = ap.parse_args()
    runs = sorted(p for p in glob.glob(os.path.join(HERE, 'out', '*.jsonl')) if not os.path.basename(p).startswith(('smoke', 't-')))
    items = [x for f in sorted(glob.glob(os.path.join(HERE, 'data', 'mbench-sample*.jsonl'))) for x in S.load_jsonl(f)] + \
        S.load_jsonl(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))
    sysp = json.load(open(os.path.join(HERE, 'data', 'system_prompts.json')))
    screen = {l.strip() for l in open(os.path.join(HERE, 'data', 'screen_ids.txt')) if l.strip()}
    B1.ONLY_IDS = screen
    board = {}
    for p in runs:
        recs = {}
        for r in S.load_jsonl(p):
            recs[r['id']] = r
        if not recs:
            continue
        lab = next(iter(recs.values()))['label']
        model = next(iter(recs.values()))['model']
        sc = {k: v for k, v in recs.items() if k in screen}
        rows = S.score_brain(items, sc, sysp)
        brain = S.summarize_brain(rows, 'brain') or {}
        stuck = S.summarize_brain(rows, 'stuck') or {}
        osum, _ = S.score_overseer(items, sc)
        tim = S.timing(sc, 'brain') or {}
        tp = os.path.join(HERE, 'out', 'tput-%s.json' % lab)
        tput = json.load(open(tp))['levels'] if os.path.exists(tp) else {}
        b1 = quiet(B1.cmd_score, [p]).get(lab, {})
        b2 = quiet(B2.cmd_score, [p]).get(lab, {})
        b3 = quiet(B3.cmd_score, [p]).get(lab, {})
        b4 = quiet(B4.cmd_score, [p]).get(lab, {})
        info = os.path.join(HERE, 'out', 'info-%s.txt' % lab)
        board[lab] = {'model': model, 'brain': brain, 'stuck': stuck, 'overseer': osum or {}, 'timing': tim, 'tput': tput,
                      'b1': b1, 'b2': b2, 'b3': b3, 'b4': b4,
                      'info': open(info).read()[:600] if os.path.exists(info) else ''}
    lines = []
    P = lambda x: '-' if x is None else ('%.0f' % x if isinstance(x, (int, float)) else str(x))
    lines.append('### Bot brain (A1 screen: 120 real decisions, same items for every model)\n')
    lines.append('| model | valid % | hard-infeasible % | repeats the failed action % (n=77) | repeats the 4x loop % (n=17) | same skill as a logged success % (n=26) | ignores a failing lesson % | adversarial: took the bait (of 36) | p50 s @4 | 1 bot s | 8 bots s | decisions/min |')
    lines.append('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for lab, r in sorted(board.items(), key=lambda kv: (kv[1]['brain'].get('bad', 999) if kv[1]['brain'] else 999, kv[1]['brain'].get('rep_fail', 999) if kv[1]['brain'] else 999)):
        b, t, tp = r['brain'], r['timing'], r['tput']
        if not b:
            continue
        lines.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            lab, P(b.get('valid')), P(b.get('infeasible')), P(b.get('rep_fail')), P(b.get('loop_repeat')), P(b.get('agree_skill')),
            P(b.get('ignores_lesson')), P(r['b4'].get('took_bait')), t.get('p50_s', '-'),
            (tp.get('1') or {}).get('p50_s', '-'), (tp.get('8') or {}).get('p50_s', '-'), (tp.get('8') or {}).get('decisions_per_min', '-')))
    lines.append('\n### Overseer and stuck escalation (thinking as noted; screen items)\n')
    lines.append('| model | overseer valid % (n=24) | overseer agrees w/ deterministic mayor (Jaccard) | allocation: exact optimum (of 60) | rule violations (of 60) | utility / optimum | planning: goal reached (of 30) | stuck: GOOD (either labeller) % | stuck: BAD (either) % |')
    lines.append('|---|---|---|---|---|---|---|---|---|')
    for lab, r in sorted(board.items(), key=lambda kv: -(kv[1]['b3'].get('reached') or 0)):
        o, b1, b2, b3 = r['overseer'], r['b1'], r['b2'], r['b3']
        n1 = max(1, b1.get('n', 0))
        lines.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            lab, P(o.get('valid')), o.get('agree_det_jaccard', '-'), P(b2.get('exact_optimum')), P(b2.get('any_violation')),
            b2.get('utility_ratio', '-'), P(b3.get('reached')), P(100.0 * b1.get('good_one', 0) / n1) if b1 else '-',
            P(100.0 * b1.get('bad_any', 0) / n1) if b1 else '-'))
    md = '\n'.join(lines)
    print(md)
    if a.md:
        open(a.md, 'w').write(md + '\n')
    if a.json:
        json.dump(board, open(a.json, 'w'), indent=1, default=str)


if __name__ == '__main__':
    main()
