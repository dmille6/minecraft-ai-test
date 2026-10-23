#!/usr/bin/env python3
"""patch_fleetstatus.py <installed fleetstatus.py> <repo fleetstatus.py> -- add the structure count's header line to the
INSTALLED fleetstatus on 10.0.0.31 (~/estel/scripts/host/fleetstatus.py), which carries changes that are not on main (the
learning-loop line), so it is PATCHED, never replaced. Three edits, each anchored on text that must occur exactly once:
  * the structcount_line block (taken verbatim from the repo copy) inserted after `def _ts(s)`;
  * `print(rep['structcount'])` after the frontier print;
  * `'structcount': structcount_line(now), ` after `'frontier': frontier_line(now), ` in the report dict.
Idempotent (an installed copy that already has structcount_line is left alone). The file is backed up first, the result must
parse, and it is written by an atomic rename. Exit 0 patched or already patched, 1 refused (nothing written)."""
import ast
import os
import shutil
import sys
import time


def block(repo):
    s = open(repo).read()
    i = s.index('# STRUCTURE COUNT (building tier step 0')
    j = s.index('\n\n\n', s.index('def structcount_line', i))
    return s[i:j]


def patch(text, blk):
    if 'def structcount_line' in text:
        return None, 'already patched'
    edits = [("def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n",
              "def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n\n\n" + blk + "\n"),
             ("    if rep.get('frontier'):\n        print(rep['frontier'])\n",
              "    if rep.get('frontier'):\n        print(rep['frontier'])\n    if rep.get('structcount'):\n        print(rep['structcount'])\n"),
             ("'frontier': frontier_line(now), ", "'frontier': frontier_line(now), 'structcount': structcount_line(now), ")]
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            return None, 'anchor found %d times: %r' % (n, old[:60])
        text = text.replace(old, new)
    ast.parse(text)
    return text, 'patched'


if __name__ == '__main__':
    inst, repo = sys.argv[1], sys.argv[2]
    new, why = patch(open(inst).read(), block(repo))
    if new is None:
        print(why)
        sys.exit(0 if why == 'already patched' else 1)
    bak = '%s.bak-structcount-%s' % (inst, time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    shutil.copy2(inst, bak)
    tmp = inst + '.tmp.%d' % os.getpid()
    with open(tmp, 'w') as f:                                  # Claude r1 P3-8: durable, and the installed file's mode kept
        f.write(new); f.flush(); os.fsync(f.fileno())
    shutil.copymode(inst, tmp)
    os.replace(tmp, inst)
    print('%s (backup %s)' % (why, bak))
