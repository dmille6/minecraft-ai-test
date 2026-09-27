#!/usr/bin/env python3
"""Behaviour test for place-town.py's derived world map.

Tests the DECISION, not the text: a temporary ROOT is built with the shapes that
actually occur on .30 -- fleet worlds, a sandbox with a port and no town, a
template with neither, and a duplicate port -- and the function is asked what it
finds. Every case is then MUTATED to prove the test can fail.
"""
import importlib.util, os, sys, tempfile
from pathlib import Path

SRC = os.environ.get('PLACE_TOWN', '/home/mike/scripts/place-town.py')

def load(root):
    spec = importlib.util.spec_from_file_location('pt_' + os.path.basename(root), SRC)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.ROOT = Path(root)
    return m

def world(root, name, port=None, town=True):
    d = Path(root) / name; d.mkdir()
    if town: (d / 'TOWN-PLACED.json').write_text('{"siting":{"chosen":[0,0]}}')
    if port is not None:
        (d / 'server.properties').write_text(
            f"level-name=world\nrcon.port={port}\nrcon.password=x\n")

fails = []
def check(label, got, want):
    ok = got == want
    print(('  ok   ' if ok else '  FAIL ') + f"{label}: got {got!r} want {want!r}")
    if not ok: fails.append(label)

print("1. the real fleet shape: 16 towns, 4 sandboxes with ports and no town, 1 template")
with tempfile.TemporaryDirectory() as t:
    real = {'hive-a':25670,'hive-b':25671,'board-a':25672,'board-b':25673,
            'isolated-a':25674,'isolated-b':25675,'placebo-a':25676,'placebo-b':25677,
            'hive-c':25678,'hive-d':25679,'board-c':25680,'board-d':25681,
            'isolated-c':25682,'isolated-d':25683,'placebo-c':25684,'placebo-d':25685}
    for w, p in real.items(): world(t, w, p)
    for i, w in enumerate(['sandbox','sandbox2','sandbox3','sandbox4']):
        world(t, w, 25699 + i, town=False)
    world(t, 'template', None, town=False)
    m = load(t); got = m._discover_worlds()
    check("world count", len(got), 16)
    check("ports round-trip", {k: m.BASE_RCON + v for k, v in got.items()}, real)
    check("board-a is 25672, not the alphabetical 25670",
          m.BASE_RCON + got['board-a'], 25672)
    check("sandboxes excluded", [w for w in got if 'sandbox' in w], [])
    check("template excluded", 'template' in got, False)

print("2. a town with no readable port is REFUSED, not silently excluded and not")
print("   admitted at offset 0. The first version of this test asserted 'excluded',")
print("   which is the behaviour the review called the dangerous one: fifteen worlds")
print("   silently becoming the denominator of `for world in sorted(ARMS)`.")
with tempfile.TemporaryDirectory() as t:
    world(t, 'hive-a', 25670); world(t, 'hive-b', None)   # town, no server.properties
    try:
        got = load(t)._discover_worlds()
        check("raised instead of returning a subset", False, True)
    except SystemExit as e:
        check("named the world it could not read", 'hive-b' in str(e), True)
        check("did not admit hive-a alone", 'PARTIAL DISCOVERY' in str(e), True)

print("3. two worlds claiming one port REFUSE rather than silently drop one")
with tempfile.TemporaryDirectory() as t:
    world(t, 'hive-a', 25670); world(t, 'board-a', 25670)
    m = load(t)
    try:
        m._discover_worlds(); check("raised", False, True)
    except SystemExit as e:
        check("refused and named both worlds",
              ('hive-a' in str(e) and 'board-a' in str(e)), True)

print("4. an empty ROOT discovers nothing")
with tempfile.TemporaryDirectory() as t:
    got = load(t)._discover_worlds()
    check("discovers nothing", got, {})

print("4b. PARTIAL discovery REFUSES -- a town with no readable port beside towns that have one")
with tempfile.TemporaryDirectory() as t:
    world(t, 'hive-a', 25670); world(t, 'hive-b', 25671); world(t, 'board-a', None)
    m = load(t)
    try:
        m._discover_worlds(); check("raised on partial discovery", False, True)
    except SystemExit as e:
        check("refused and named the bad world", 'board-a' in str(e), True)
        check("said PARTIAL DISCOVERY", 'PARTIAL DISCOVERY' in str(e), True)

print("4c. but NO port readable anywhere is the unprivileged case, not partial")
with tempfile.TemporaryDirectory() as t:
    world(t, 'hive-a', None); world(t, 'hive-b', None)
    check("returns empty rather than raising", load(t)._discover_worlds(), {})

print("4d. THE MODULE-LEVEL FALLBACK, which case 4 never reached: the module runs")
print("    _discover_worlds() at IMPORT, against the real ROOT, before load() can")
print("    replace it -- so the fallback must be tested by importing with a ROOT")
print("    that is already empty. Done by copying the source with ROOT rewritten.")
with tempfile.TemporaryDirectory() as t:
    src0 = Path(SRC).read_text()
    anchor = 'ROOT = Path("/srv/block2")'
    assert anchor in src0 and src0.count(anchor) == 1, "ANCHOR ROOT"
    mp = Path(tempfile.mkdtemp()) / 'pt.py'
    mp.write_text(src0.replace(anchor, f'ROOT = Path("{t}")', 1))
    import io, contextlib
    err = io.StringIO()
    spec = importlib.util.spec_from_file_location('fb', str(mp))
    mm = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stderr(err):
        spec.loader.exec_module(mm)
    check("ARMS falls back to the stale eight", len(mm.ARMS), 8)
    check("and says the c/d ports are WRONG", 'WRONG' in err.getvalue(), True)

print("\nMUTANTS -- each must be DETECTED by the checks above, or those checks prove nothing")
src = Path(SRC).read_text()
MUTANTS = [
    ("drop the TOWN-PLACED.json filter (sandboxes leak in)",
     "if not (d / 'TOWN-PLACED.json').exists():\n            continue",
     "if False:\n            continue"),
    ("go back to the alphabetical index (board-a becomes 25670)",
     "found[d.name] = port - BASE_RCON",
     "found[d.name] = len(found)"),
    ("drop the duplicate-port guard",
     "if port in ports:", "if False and port in ports:"),
    ("drop the partial-discovery guard (fifteen worlds become the denominator)",
     "if found and townless_port:", "if False and townless_port:"),
]
for label, old, new in MUTANTS:
    assert old in src, f"ANCHOR MISSING for mutant: {label}"
    assert src.count(old) == 1, f"ANCHOR NOT UNIQUE ({src.count(old)}) for: {label}"
    mp = Path(tempfile.mkdtemp()) / 'pt.py'
    mp.write_text(src.replace(old, new, 1))
    spec = importlib.util.spec_from_file_location('mut', str(mp))
    mm = importlib.util.module_from_spec(spec); spec.loader.exec_module(mm)
    # Each mutant is shown the fixture that its own check exists for, and "killed"
    # means the mutated function gave a DIFFERENT answer from the real one.
    with tempfile.TemporaryDirectory() as t:
        if 'partial-discovery' in label:
            world(t, 'hive-a', 25670); world(t, 'board-a', None)
            mm.ROOT = Path(t)
            try:
                g = mm._discover_worlds()
                killed = True             # it should have refused, and returned a subset
            except SystemExit:
                killed = False            # the guard still fires
        elif 'duplicate-port' in label:
            world(t, 'hive-a', 25670); world(t, 'board-a', 25670)
            mm.ROOT = Path(t)
            try:
                mm._discover_worlds(); killed = True      # it should have refused
            except SystemExit:
                killed = False                            # the guard still fires
        else:
            world(t, 'hive-a', 25670); world(t, 'board-a', 25672)
            world(t, 'sandbox', 25699, town=False)
            mm.ROOT = Path(t)
            g = mm._discover_worlds()
            killed = len(g) != 2 or mm.BASE_RCON + g.get('board-a', -1) != 25672
    print(('  killed  ' if killed else '  SURVIVED ') + label)
    if not killed: fails.append('mutant survived: ' + label)

print()
if fails:
    print(f"{len(fails)} FAILURE(S): {fails}"); sys.exit(1)
print("all checks pass, all mutants killed")
