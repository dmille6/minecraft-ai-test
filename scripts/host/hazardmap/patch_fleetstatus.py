#!/usr/bin/env python3
"""patch_fleetstatus.py <installed fleetstatus.py> [--revert] -- add the hazard map's header line to the INSTALLED fleetstatus
on 10.0.0.31 (~/estel/scripts/host/fleetstatus.py), or with --revert take exactly that out again. That copy carries changes
that are not on main, so it is PATCHED, never replaced. This is the structcount patch's pattern. Three edits, each anchored on text that must occur exactly once:
  * the hazardmap_line block, inserted after `def _ts(s)`;
  * `print(rep['hazardmap'])` after the frontier print;
  * `'hazardmap': hazardmap_line(now), ` after `'frontier': frontier_line(now), ` in the report dict.
The anchors are the frontier census's, which structcount's patch also uses and leaves intact, so the two patches compose in
either order. It is idempotent: a copy that already has hazardmap_line is left alone. The file is backed up first, the
result must parse, and it is written by an atomic rename. Exit 0 patched or already patched, 1 refused (nothing written).

The line itself is the hazard map's own `check` (OK, or HAZARDMAP ALARM naming why). When the tool is not installed there
is no line; a check that fails to run is an ALARM, never a quiet OK."""
import ast
import os
import shutil
import sys
import time

BLOCK = '''# HAZARD MAP (per-seed hazard map, OWNER 2026-10-24; scripts/host/hazardmap): the tool's own check, never a quiet OK
def hazardmap_line(now, home=None):
    import subprocess
    home = home or os.path.expanduser('~/hazardmap')
    tool = os.path.join(home, 'app', 'scripts', 'host', 'hazardmap', 'hazardmap.py')
    if not os.path.exists(tool):
        return None
    try:
        r = subprocess.run([sys.executable, '-B', tool, 'check', '--home', home], capture_output=True, text=True, timeout=60)
        out = (r.stdout.strip().splitlines() or [''])[-1]
        return out or 'HAZARDMAP ALARM: the check printed nothing (exit %d)' % r.returncode
    except Exception as e:
        return 'HAZARDMAP ALARM: the check did not run (%s)' % type(e).__name__
'''

EDITS = [("def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n",
          "def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n\n\n" + BLOCK + "\n"),
         ("    if rep.get('frontier'):\n        print(rep['frontier'])\n",
          "    if rep.get('frontier'):\n        print(rep['frontier'])\n    if rep.get('hazardmap'):\n        print(rep['hazardmap'])\n"),
         ("'frontier': frontier_line(now), ", "'frontier': frontier_line(now), 'hazardmap': hazardmap_line(now), ")]


def patch(text):
    if 'def hazardmap_line' in text:
        return None, 'already patched'
    for old, new in EDITS:
        n = text.count(old)
        if n != 1:
            return None, 'anchor found %d times: %r' % (n, old[:60])
        text = text.replace(old, new)
    ast.parse(text)
    return text, 'patched'


INSERTS = ["\n\n" + BLOCK + "\n",
           "    if rep.get('hazardmap'):\n        print(rep['hazardmap'])\n",
           "'hazardmap': hazardmap_line(now), "]


def revert(text):
    """The exact inverse of patch(): each of its three INSERTIONS must occur once and is removed, wherever it now sits, so
    anything else in the file is kept -- including a structcount patch applied later at the same anchors. Used by the
    rollback instead of restoring the .bak copy (which would also undo later edits)."""
    if 'def hazardmap_line' not in text:
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
    bak = '%s.bak-hazardmap-%s' % (inst, time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    shutil.copy2(inst, bak)
    tmp = inst + '.tmp.%d' % os.getpid()
    with open(tmp, 'w') as f:
        f.write(new); f.flush(); os.fsync(f.fileno())
    shutil.copymode(inst, tmp)
    os.replace(tmp, inst)
    print('%s (backup %s)' % (why, bak))
