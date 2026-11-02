#!/usr/bin/env python3
"""Within-gate decisions/min of each model ON THE FLEET'S SERVING CARD, from ladder runs measured there (the owner 11-02
capacity rule's input when the serving card is not the loop's own 3090, e.g. the 5080 measured by the serving agent).

    python3 card_rates.py --card "<card>" --by "<who, when>" \
        --model <round alias>=<served model>@<glob of batchload outputs named ...-r<rate>.jsonl> ... --ladder 20,40,... \
        [--cannot <round alias>="<why it cannot be served on this card>"] --out card-rates.json

Every rate is computed with weekly.py's OWN latency_summary (p50 <= 2.5 s, p95 <= 5 s over ALL requests, >= 99% valid)
and within_gate_rate (the highest measured rung that holds AND every lower measured rung holds) over the rungs found.
A model that cannot be loaded on the card (e.g. VRAM beside the fleet's resident model) is recorded with rate 0 and
its reason; the rule then counts it at the lowest rung. Files are hashed so the evidence is pinned.
"""
import argparse, glob, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import weekly as W  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--card', required=True); ap.add_argument('--by', required=True)
    ap.add_argument('--model', nargs='+', default=[]); ap.add_argument('--cannot', nargs='*', default=[])
    ap.add_argument('--minutes', type=int, default=3); ap.add_argument('--out', required=True)
    ap.add_argument('--ladder', required=True, help='comma list: the rungs every model on this card was measured at')
    a = ap.parse_args()
    L = sorted(int(x) for x in a.ladder.split(','))
    out = {'card': a.card, 'measured_by': a.by, 'ladder': L, 'rates': {}, 'runs': {}, 'files': {}, 'cannot': {}}
    for spec in a.model:
        # <round alias>=<served model name>@<glob>: every record must carry that served model (Codex r3: no mixing)
        alias, rest = spec.split('=', 1)
        served, g = rest.split('@', 1)
        rungs = {}
        for f in sorted(glob.glob(os.path.expanduser(g))):
            m = re.search(r'-r(\d+)\.jsonl$', f)
            if not m:
                continue
            r = int(m.group(1))
            if r in rungs:                                     # a retry must not silently replace a failed run (Claude r3)
                raise SystemExit('REFUSED: two files for %s at %d/min' % (alias, r))
            recs = W.lines(f)
            # the requested alias AND the server's answer (servedModel, where the record has one) must both be `served`
            bad = ({str(x.get('model')) for x in recs} | {str(x['servedModel']) for x in recs if x.get('servedModel')}) - {served}
            if bad:
                raise SystemExit('REFUSED: %s holds records of %s, not %s' % (f, sorted(bad), served))
            rungs[r] = W.latency_summary(recs, a.minutes, r)
            out['files'][f] = hashlib.sha256(open(f, 'rb').read()).hexdigest()
        if not rungs:
            raise SystemExit('REFUSED: no ladder files for %s (%s)' % (alias, g))
        # ONE ladder for every measured model (Claude r3 blocker): each model must have exactly --ladder's rungs up to
        # its first failure, so no model is credited from a late first rung and the rule's floor is the ladder's own
        rate = W.within_gate_rate(rungs, L)       # None when the ladder's first rung is absent; stops at a gap
        if rate is None:
            missing = [r for r in L if r not in rungs]
            raise SystemExit('REFUSED: %s lacks ladder rungs %s (found %s)' % (alias, missing, sorted(rungs)))
        out['runs'][alias] = {str(k): v for k, v in sorted(rungs.items())}
        out['rates'][alias] = rate
    for spec in a.cannot:
        alias, why = spec.split('=', 1)
        out['rates'][alias] = 0; out['cannot'][alias] = why
    json.dump(out, open(a.out, 'w'), indent=1)
    print(json.dumps({'card': a.card, 'rates': out['rates'], 'cannot': out['cannot']}, indent=1))


if __name__ == '__main__':
    main()
