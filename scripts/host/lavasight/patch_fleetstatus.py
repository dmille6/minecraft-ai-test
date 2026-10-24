#!/usr/bin/env python3
"""patch_fleetstatus.py <installed fleetstatus.py> [--revert] -- add lavasight-01's publisher line to the INSTALLED fleetstatus on
10.0.0.31 (~/estel/scripts/host/fleetstatus.py), or with --revert take exactly that out again. The hazardmap patch's
pattern (scripts/host/hazardmap/patch_fleetstatus.py), on the same frontier anchors, so the patches compose in any order:
  * the lavamap_line block, inserted after `def _ts(s)`;
  * `print(rep['lavamap'])` after the frontier print;
  * `'lavamap': lavamap_line(now), ` after `'frontier': frontier_line(now), ` in the report dict.
Idempotent; the file is backed up first, the result must parse, written by an atomic rename. Exit 0 patched or already
patched, 1 refused (nothing written).

The line is the publisher's own `check` over /var/lib/mcai (OK, or LAVAMAP ALARM naming the pools whose file is absent,
unreadable or stale -- Claude r2 P3-8: a checker nobody calls is not a check). Not installed -> no line; a check that fails
to run is an ALARM, never a quiet OK."""
import ast
import os
import shutil
import sys
import time

BLOCK = '''# LAVA MAP (lavasight-01; scripts/host/lavasight): the publisher's own check of every pool's lava-map.json, never a quiet OK
def lavamap_line(now, home=None):
    import subprocess
    home = home or os.path.expanduser('~/lavasight')
    tool = os.path.join(home, 'app', 'lavamap_publish.py')
    if not os.path.exists(tool):
        return None
    try:
        r = subprocess.run([sys.executable, '-B', tool, 'check', '--root', '/var/lib/mcai',
                            '--map', os.path.expanduser('~/hazardmap/out/hazardmap.json')], capture_output=True, text=True, timeout=60)
        out = (r.stdout.strip().splitlines() or [''])[-1]
        return out or 'LAVAMAP ALARM: the check printed nothing (exit %d)' % r.returncode
    except Exception as e:
        return 'LAVAMAP ALARM: the check did not run (%s)' % type(e).__name__
'''

EDITS = [("def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n",
          "def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n\n\n" + BLOCK + "\n"),
         ("    if rep.get('frontier'):\n        print(rep['frontier'])\n",
          "    if rep.get('frontier'):\n        print(rep['frontier'])\n    if rep.get('lavamap'):\n        print(rep['lavamap'])\n"),
         ("'frontier': frontier_line(now), ", "'frontier': frontier_line(now), 'lavamap': lavamap_line(now), ")]

INSERTS = ["\n\n" + BLOCK + "\n",
           "    if rep.get('lavamap'):\n        print(rep['lavamap'])\n",
           "'lavamap': lavamap_line(now), "]


def patch(text):
    if 'def lavamap_line' in text:
        return None, 'already patched'
    for old, new in EDITS:
        n = text.count(old)
        if n != 1:
            return None, 'anchor found %d times: %r' % (n, old[:60])
        text = text.replace(old, new)
    ast.parse(text)
    return text, 'patched'


def revert(text):
    """The exact inverse of patch(): each insertion must occur once and is removed wherever it now sits."""
    if 'def lavamap_line' not in text:
        return None, 'not patched'
    for ins in INSERTS:
        n = text.count(ins)
        if n != 1:
            return None, 'inserted text found %d times: %r' % (n, ins[:60])
        text = text.replace(ins, '')
    ast.parse(text)
    return text, 'reverted'


if __name__ == '__main__':
    inst = sys.argv[1]
    undo = '--revert' in sys.argv[2:]
    new, why = (revert if undo else patch)(open(inst).read())
    if new is None:
        print(why)
        sys.exit(0 if why in ('already patched', 'not patched') else 1)
    bak = '%s.bak-lavamap-%s' % (inst, time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    shutil.copy2(inst, bak)
    tmp = inst + '.tmp-lavamap'
    with open(tmp, 'w') as fh:
        fh.write(new)
    os.replace(tmp, inst)
    print('%s (backup %s)' % (why, bak))
