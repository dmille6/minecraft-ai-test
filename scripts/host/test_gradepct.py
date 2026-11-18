#!/usr/bin/env python3
"""Behaviour tests for gradepct.py and gradetarget.py on a SYNTHETIC plan (gradetidy-01show, T11 bundle (d)).

    python3 scripts/host/test_gradepct.py            (exit 1 on any failure)

Every decision tested is also MUTATED (bottom): a mutant must change the answer, and its anchor must be present and unique.
"""
import importlib.util, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, src_text=None):
    path = os.path.join(HERE, name)
    if src_text is not None:
        fd, path = tempfile.mkstemp(suffix='.py'); os.write(fd, src_text.encode()); os.close(fd)
    spec = importlib.util.spec_from_file_location('m_%d' % id(path), path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    if src_text is not None:
        os.unlink(path)
    return m


def plan(box=(0, -30, 20, -20), y=69, over=None, gate=None):
    """A plan: every column class t at y; `over` {(x, z): (cls, h)}; T11 holds (10, -26)."""
    over = over or {}
    x0, z0, x1, z1 = box
    h = [[over.get((x, z), ('t', y))[1] for x in range(x0, x1 + 1)] for z in range(z0, z1 + 1)]
    c = [''.join(over.get((x, z), ('t', y))[0] for x in range(x0, x1 + 1)) for z in range(z0, z1 + 1)]
    t = {'box': list(box), 'h': h, 'class': c, 'terraces': []}
    if gate is not None:
        t['gate'] = {'id': 'T11', 'cols': [list(g) for g in gate]}
    return t


FAILS = []


def check(name, cond):
    print(('  PASS  ' if cond else '  FAIL  ') + name)
    if not cond:
        FAILS.append(name)


def run(GP, GT):
    # a 3x3 terrace at y69 (T11) around (10,-26) inside a fixed ring; everything else outside (o)
    T11 = [(x, z) for x in (9, 10, 11) for z in (-27, -26, -25)]
    over = {(x, z): ('o', 0) for x in range(0, 21) for z in range(-30, -19) if (x, z) not in T11}
    over[(12, -26)] = ('f', 75)
    p = GP.Plan(plan(over=over, gate=T11))
    H = {c: 69 for c in T11}
    TOP = {c: 'grass_block' for c in T11}
    H[(9, -27)] = 70                      # off height
    TOP[(9, -25)] = 'cobblestone'        # grey at height
    H[(12, -26)] = 75; TOP[(12, -26)] = 'stone_bricks'
    m = GP.measure(p, H, TOP)
    check('grade_pct = at height with an earth top / ground columns (7 of 9)', m['town']['at_height_earth'] == 7 and m['town']['columns'] == 9 and m['town']['grade_pct'] == 77.8)
    check('height-only share beside it (8 of 9) and the grey top named', m['town']['at_height'] == 8 and m['town']['other_tops_at_height'] == {'cobblestone': 1})
    check('T11 is the run holding x10 z-26', set(m['terraces']) == {'T11'} and m['terraces']['T11']['columns'] == 9)
    check('the gate is measured on its own', m['gate']['columns'] == 9 and m['gate']['grade_pct'] == 77.8)
    check('a 2+ step against a fixed column is split from ground-ground', m['gate']['ground_fixed_2plus'] == 1 and m['gate']['ground_ground_2plus'] == 0)
    H2 = dict(H); H2[(10, -26)] = 72
    m2 = GP.measure(p, H2, TOP)
    check('a 3-high column inside the terrace: 4 ground-ground 2+ pairs', m2['gate']['ground_ground_2plus'] == 4)
    # dirt_path counts as earth
    TOP3 = dict(TOP); TOP3[(9, -25)] = 'dirt_path'
    check('dirt_path is earth', GP.measure(p, H, TOP3)['gate']['at_height_earth'] == 8)
    # the control: nothing read raises (a zero is a failed read)
    try:
        GP.measure(p, {}, {}); ok = False
    except GP.ReadFailed:
        ok = True
    check('nothing read -> ReadFailed, never 0%', ok)
    # --before: a column outside the gate that moved is named; the gate's own are not
    p2 = GP.Plan(plan(gate=T11))
    Hb = {c: 69 for c in p2.ground()}
    Ha = dict(Hb); Ha[(0, -30)] = 68; Ha[(10, -26)] = 70
    T2 = {c: 'grass_block' for c in Ha}
    mb = GP.measure(p2, Ha, T2, before={f'{x},{z}': v for (x, z), v in Hb.items()})
    check('changed outside the gate: 1 (the gate\'s own move not counted)', mb['changed_outside_gate']['changed'] == 1 and mb['changed_outside_gate']['cols'] == [[0, -30]])
    # an unknown class is not ground (no opinion)
    p3 = GP.Plan(plan(over={(1, -21): ('q', 60)}))
    check('an unknown class is not ground', (1, -21) not in set(p3.ground()))
    # gradetarget: the gate is the flood at y69 from the seed, nothing across a height change
    big = plan(box=(0, -30, 20, -20), over={(x, -23): ('t', 70) for x in range(0, 21)})
    raw = json.dumps(big).encode()
    out = GT.publish(raw, 'T11', 1, 'gsha', None)
    cols = {tuple(c) for c in out['gate']['cols']}
    check('gradetarget: the gate is the y69 run holding (10,-26), not the y70 row', (10, -26) in cols and all(z != -23 for _, z in cols) and all(z < -23 for _, z in cols))
    check('gradetarget: version and the source hash', out['v'] == 1 and len(out['sha256']) == 64)


def main():
    GP, GT = load('gradepct.py'), load('gradetarget.py')
    run(GP, GT)
    # MUTANTS
    for f, old, new, what in [
        ('gradepct.py', "        ok = [c for c in at if TOP[c] in EARTH]\n", "        ok = at\n", 'the earth-top test'),
        ('gradepct.py', "                elif cl == 'f':\n                    gf += 1\n", "                elif cl == 'f':\n                    gg += 1\n", 'the fixed split'),
        ('gradepct.py', "    if not read:\n        raise ReadFailed(", "    if False:\n        raise ReadFailed(", 'the read control'),
        ('gradetarget.py', "            if n not in run and at(*n) == (y, 't'):\n", "            if n not in run and at(*n)[1] == 't':\n", 'the height in the flood'),
    ]:
        src = open(os.path.join(HERE, f)).read()
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + what
        mod = load(f, src.replace(old, new))
        before = len(FAILS)
        sys.stdout = open(os.devnull, 'w')
        try:
            run(mod if f == 'gradepct.py' else load('gradepct.py'), mod if f == 'gradetarget.py' else load('gradetarget.py'))
        except Exception:
            FAILS.append('threw')
        finally:
            sys.stdout = sys.__stdout__
        killed = len(FAILS) > before
        del FAILS[before:]
        check(f'MUTANT killed: {what}', killed)
    print(f"\n{'FAILED ' + str(len(FAILS)) if FAILS else 'all passed'}")
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
