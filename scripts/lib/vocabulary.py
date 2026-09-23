"""What names the DEPLOYED build can emit, extracted from that build's own source.

WHY. On 2026-09-23 a query for two failure classes returned 0. Three different readings
of that 0 were published in one evening -- "the instruments have zero emit sites" (wrong:
they are in the source), "the instruments are live so the zero is data" (wrong: the rows
really are absent), and a silent 0 from the fixed library (wrong: unfalsifiable). The only
honest answer needs BOTH halves: can this build emit the name, and did it.

So the registry is built from `git show <sha>:<path>`, never from the working tree -- the
working tree has misled this project four separate times in one day by being stale.

  can_emit=False, rows=0  -> NotAnInstrument: this build cannot produce that name
  can_emit=True,  rows=0  -> NotAnInstrument: a live code path that never fired. A
                             FINDING, not a zero, and the caller must say which it means.
  can_emit=True,  rows>0  -> a count
"""
import json
import os
import re
import subprocess

# `failClass: 'x'` / `failClass = 'x'` / `fail_class: 'x'`, and logEvent({ kind: 'x' }).
FAILCLASS = re.compile(r"""fail_?[Cc]lass\s*[:=]\s*['"]([a-z0-9_]+)['"]""")
KIND = re.compile(r"""kind\s*:\s*['"]([a-z0-9_]+)['"]""")
SRC_DIRS = ('bots/src',)


def _git(repo, *args):
    return subprocess.run(('git', '-C', repo) + args, capture_output=True, text=True,
                          check=True).stdout


def extract(repo, sha, cache_dir=None):
    """{'fail_class': set, 'kind': set, 'sha': sha} for the code at `sha`.

    Cached per sha because a sha's source never changes.
    """
    short = sha.split('+')[0]
    cache = os.path.join(cache_dir or '/tmp', f'vocab-{short}.json') if cache_dir or True else None
    if cache and os.path.exists(cache):
        try:
            d = json.load(open(cache))
            return {'fail_class': set(d['fail_class']), 'kind': set(d['kind']), 'sha': short}
        except Exception:
            pass
    files = [f for f in _git(repo, 'ls-tree', '-r', '--name-only', short).splitlines()
             if f.startswith(SRC_DIRS) and f.endswith('.mjs')]
    if not files:
        raise LookupError(f'no bots/src/*.mjs at {short} in {repo} — wrong repo or sha')
    fc, kd = set(), set()
    for f in files:
        src = _git(repo, 'show', f'{short}:{f}')
        fc.update(FAILCLASS.findall(src))
        kd.update(KIND.findall(src))
    out = {'fail_class': fc, 'kind': kd, 'sha': short}
    if cache:
        try:
            json.dump({'fail_class': sorted(fc), 'kind': sorted(kd), 'sha': short},
                      open(cache, 'w'))
        except Exception:
            pass
    return out


def report(repo, sha, emitted_classes):
    """Compare what the build CAN emit against what it DID, for a read's own header.

    `emitted_classes` is Events.classes() as {name: count} or an iterable of names.
    Returns (silent, unknown): live paths that produced nothing, and names in the data
    that the source does not explain (an upgrade, or a stale registry).
    """
    v = extract(repo, sha)
    seen = set(emitted_classes)
    silent = sorted(v['fail_class'] - seen)
    unknown = sorted(seen - v['fail_class'])
    return silent, unknown
