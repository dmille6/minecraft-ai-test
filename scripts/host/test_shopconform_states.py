#!/usr/bin/env python3
"""townstyle-01/03: shopconform.py's block-state reading (H8) -- its selftest on the real file, then each state rule broken (an anchored
mutant: the anchor present and unique) must fail the selftest. `python3 -I scripts/host/test_shopconform_states.py`"""
import os, subprocess, sys, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, 'shopconform.py')).read()
M = [
    ("        if cell_done(n, palette, c.get('role')) and (not c.get('ws') or state_ok(read_props(x, y, z) if read_props else None, c.get('ws'))):",
     "        if cell_done(n, palette, c.get('role')):"),
    ("    if isinstance(rec.get('style'), dict) and isinstance(rec.get('palette'), dict):\n        palette = rec['palette']", "    pass"),
    ("    return all(str(props.get(k)).lower() == str(v).lower() for k, v in ws.items())", "    return True"),
    ("    if not isinstance(props, dict):\n        return False", "    if not isinstance(props, dict):\n        return True"),
]
def run(src):
    d = tempfile.mkdtemp(prefix='scm-')
    try:
        for f in os.listdir(HERE):
            if f.endswith('.py') and f != 'shopconform.py':
                shutil.copy(os.path.join(HERE, f), d)
        open(os.path.join(d, 'shopconform.py'), 'w').write(src)
        return subprocess.run([sys.executable, '-I', os.path.join(d, 'shopconform.py'), 'selftest'], capture_output=True, text=True).returncode
    finally:
        shutil.rmtree(d, ignore_errors=True)
assert run(SRC) == 0, 'the real file must pass'
bad = 0
for old, new in M:
    assert SRC.count(old) == 1, ('ANCHOR MISSING OR NOT UNIQUE', old[:70])
    killed = run(SRC.replace(old, new)) != 0
    print('killed' if killed else 'SURVIVED', old[:80].replace('\n', ' '))
    bad += not killed
print('shopconform state mutants: %d/%d killed' % (len(M) - bad, len(M)))
sys.exit(1 if bad else 0)
