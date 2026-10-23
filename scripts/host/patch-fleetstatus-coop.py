#!/usr/bin/env python3
"""patch-fleetstatus-coop.py <installed fleetstatus.py> -- add the cooperation census (B1) header line to an INSTALLED
fleetstatus.py in place (a backup <file>.bak-<UTC stamp> first). The installed copy can carry lines main does not (the
learning loop's), so the file is never replaced: three anchored, unique edits are applied, and a file that already has
the line is left alone. The function's source is read from this branch's fleetstatus.py between its markers. Exit 1 when
an anchor is missing or not unique (nothing is written)."""
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def main(target):
    src = open(os.path.join(HERE, 'fleetstatus.py')).read()
    a, b = src.index('# >>> coop_line'), src.index('# <<< coop_line')
    func = src[a:src.index('\n', b) + 1]
    t = open(target).read()
    if 'def coop_line(' in t:
        print(f'{target}: already carries coop_line; nothing to do')
        return 0
    edits = [("def _frontier_line(now, p):", func + "\n\ndef _frontier_line(now, p):"),
             ("        print(rep['frontier'])\n", "        print(rep['frontier'])\n    if rep.get('coop'):\n        print(rep['coop'])\n"),
             ("'frontier': frontier_line(now), ", "'frontier': frontier_line(now), 'coop': coop_line(now), ")]
    for old, _ in edits:
        if t.count(old) != 1:
            print(f'{target}: anchor {old.strip()[:60]!r} found {t.count(old)} times; NOTHING WRITTEN')
            return 1
    for old, new in edits:
        t = t.replace(old, new)
    bak = f'{target}.bak-{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}'
    shutil.copy2(target, bak)
    with open(target + '.tmp', 'w') as f:
        f.write(t)
    os.replace(target + '.tmp', target)
    print(f'{target}: coop_line added (backup {bak})')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
