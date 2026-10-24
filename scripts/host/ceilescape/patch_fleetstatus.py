#!/usr/bin/env python3
"""patch_fleetstatus.py <installed fleetstatus.py> <repo rescue_line.py> -- add ceilescape-01's "needs rescue" header line to
the INSTALLED fleetstatus on 10.0.0.31 (~/estel/scripts/host/fleetstatus.py). The coordinator runs it; it is never run by the
build. PATCHED, never replaced (the installed copy carries changes that are not on main). Three edits, each anchored on text
that must occur exactly once (the same anchors structcount's patcher uses; either may run first):
  * the rescue_line block (verbatim from rescue_line.py, between its markers) inserted after `def _ts(s)`;
  * `print(rep['rescue'])` after the frontier print;
  * `'rescue': rescue_line(now), ` after `'frontier': frontier_line(now), ` in the report dict.
Idempotent (a copy that already has rescue_line is left alone). Backed up first; the result must parse; written by an atomic
rename with the file's mode kept. Exit 0 patched or already patched, 1 refused (nothing written)."""
import ast
import os
import shutil
import sys
import time


def block(repo):
    s = open(repo).read()
    i = s.index('# >>> rescue_line (ceilescape-01)')
    j = s.index('# <<< rescue_line', i)
    j = s.index('\n', j) + 1
    return s[i:j]


def patch(text, blk):
    if 'def rescue_line' in text:
        return None, 'already patched'
    edits = [("def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n",
              "def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n\n\n" + blk + "\n"),
             ("    if rep.get('frontier'):\n        print(rep['frontier'])\n",
              "    if rep.get('frontier'):\n        print(rep['frontier'])\n    if rep.get('rescue'):\n        print(rep['rescue'])\n"),
             ("'frontier': frontier_line(now), ", "'frontier': frontier_line(now), 'rescue': rescue_line(now), ")]
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            return None, 'anchor found %d times: %r' % (n, old[:60])
        text = text.replace(old, new)
    ast.parse(text)
    return text, 'patched'


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        base = ("import datetime as dt\n\n\ndef _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n\n\n"
                "def show(rep):\n    if rep.get('frontier'):\n        print(rep['frontier'])\n\n\n"
                "def main():\n    rep = {'frontier': frontier_line(now), 'x': 1}\n")
        here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rescue_line.py')
        out, why = patch(base, block(here))
        assert why == 'patched' and "'rescue': rescue_line(now)" in out and "print(rep['rescue'])" in out and 'def rescue_line' in out, why
        assert patch(out, block(here)) == (None, 'already patched')
        assert patch(base.replace('def _ts', 'def _tz'), block(here))[0] is None, 'a missing anchor refuses'
        print('SELFTEST ok'); sys.exit(0)
    inst, repo = sys.argv[1], sys.argv[2]
    new, why = patch(open(inst).read(), block(repo))
    if new is None:
        print(why)
        sys.exit(0 if why == 'already patched' else 1)
    bak = '%s.bak-ceilescape-%s' % (inst, time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    shutil.copy2(inst, bak)
    tmp = inst + '.tmp.%d' % os.getpid()
    with open(tmp, 'w') as f:
        f.write(new); f.flush(); os.fsync(f.fileno())
    shutil.copymode(inst, tmp)
    os.replace(tmp, inst)
    print('%s (backup %s)' % (why, bak))
