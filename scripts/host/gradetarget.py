#!/usr/bin/env python3
"""Publish the ground plan for the bots, gated (gradetidy-01show, T11 bundle (b)).

    python3 scripts/host/gradetarget.py --target docs/reports/gradeplan-2026-11-18/draft3/target.json --gate T11 --v 1 \
        --out grade-target.json [--generator-sha SHA] [--region-at ISO]

Writes the plan's box, h and class with a version `v`, the source file's `sha256`, the generator's sha and the region's time,
and a GATE: the columns this release may grade. `--gate T11` is the 4-connected run of class `t` at y69 holding x10 z-26 (the
release-1 terrace, 218 columns on draft 3). The file is copied into the pool's shared dir by hand, through the showcase release;
the bots log its `grade_v` (v<v>:<sha256[:8]>:<gate>) on every refresh row.
"""
import argparse, hashlib, json, sys

GATES = {'T11': {'seed': (10, -26), 'y': 69}}
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def flood(t, seed, y):
    """The 4-connected run of class 't' at target y holding seed -> sorted [[x, z]]. Pure."""
    x0, z0, x1, z1 = t['box']

    def at(x, z):
        if not (x0 <= x <= x1 and z0 <= z <= z1):
            return None, None
        return t['h'][z - z0][x - x0], t['class'][z - z0][x - x0]
    if at(*seed) != (y, 't'):
        raise ValueError(f'seed {seed} is not class t at y{y}: {at(*seed)}')
    run, st = {tuple(seed)}, [tuple(seed)]
    while st:
        x, z = st.pop()
        for dx, dz in N4:
            n = (x + dx, z + dz)
            if n not in run and at(*n) == (y, 't'):
                run.add(n); st.append(n)
    return sorted([list(c) for c in run])


def publish(raw_bytes, gate, v, generator_sha=None, region_at=None):
    t = json.loads(raw_bytes)
    g = GATES[gate]
    cols = flood(t, g['seed'], g['y'])
    return {'v': int(v), 'sha256': hashlib.sha256(raw_bytes).hexdigest(), 'generator_sha': generator_sha, 'region_at': region_at,
            'box': t['box'], 'h': t['h'], 'class': t['class'], 'class_key': t.get('class_key'), 'terraces': t.get('terraces'),
            'gate': {'id': gate, 'seed': list(g['seed']), 'y': g['y'], 'cols': cols}}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', required=True)
    ap.add_argument('--gate', required=True, choices=sorted(GATES))
    ap.add_argument('--v', required=True, type=int)
    ap.add_argument('--out', required=True)
    ap.add_argument('--generator-sha')
    ap.add_argument('--region-at')
    a = ap.parse_args(argv)
    raw = open(a.target, 'rb').read()
    out = publish(raw, a.gate, a.v, a.generator_sha, a.region_at)
    json.dump(out, open(a.out, 'w'))
    print(f"wrote {a.out}: v{out['v']} sha256 {out['sha256'][:12]} gate {a.gate} {len(out['gate']['cols'])} columns")
    return 0


if __name__ == '__main__':
    sys.exit(main())
