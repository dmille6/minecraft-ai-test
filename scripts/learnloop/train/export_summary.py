#!/usr/bin/env python3
"""learning loop M3: the export-check verdicts plus their determinism ceiling (export_check.sh calls this).

    python3 export_summary.py --items m3-eval.jsonl --bf16 bf16-t0.jsonl --det q4-t0.jsonl q4-t0-rep.jsonl \
        --quant cand=q4-t0.jsonl cand-q8=q8-t0.jsonl

For each quant run: eval_offline.export_check against the 16-bit run (the s.3.2 gate, unchanged: complete coverage,
same skill >= 97% of items both answered schema-valid, schema-valid share not below the 16-bit's). Printed beside it:
the DETERMINISM CONTROL, the same quant model replayed twice at temperature 0 -- the instrument's own ceiling. A gate
that the control itself cannot reach is reported as `ceiling_below_gate`, so a FAIL is never read as a quantization
loss when it may be serving nondeterminism (dry round 10-24: ceiling 96.7%, q4 87.8%, q8 97.2%).
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from eval_offline import export_check, load  # noqa: E402


def summarise(ids, bf16, det_a, det_b, quants):
    det = export_check(det_a, det_b, ids)
    out = {'determinism_control': {k: det[k] for k in ('items_both_valid', 'same_skill', 'same_skill_pct', 'complete_coverage')},
           'ceiling_below_gate': not (det['complete_coverage'] and det['same_skill'] >= 0.97 * max(det['items_both_valid'], 1)),
           'quants': {}}
    for name, recs in quants.items():
        r = export_check(recs, bf16, ids)
        out['quants'][name] = r
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True)
    ap.add_argument('--bf16', required=True)
    ap.add_argument('--det', nargs=2, required=True)
    ap.add_argument('--quant', nargs='+', required=True, help='name=path')
    a = ap.parse_args()
    ids = [r['id'] for r in load(a.items)]
    q = {}
    for s in a.quant:
        n, p = s.split('=', 1)
        q[n] = load(p)
    print(json.dumps(summarise(ids, load(a.bf16), load(a.det[0]), load(a.det[1]), q), indent=1))


if __name__ == '__main__':
    main()
