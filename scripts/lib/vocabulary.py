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

# FOUR patterns, because the first version of this had SEVEN false negatives against the
# live fleet (skill_error, goal_changed, path_timeout, canopy_failed, canopy_refused,
# drowning, fire) and a registry with false negatives reports live paths as "cannot emit",
# which is the same confident-wrong shape it exists to prevent.
#
#   1. failClass: 'x'                      the common case
#   2. failClass: e?.failClass ?? 'x'      a fallback after ?? -- runner.mjs:257
#   3. Name: ['x', `...`]                  a mapping table -- skills.mjs:686
#   4. 'a', 'b', 'c' inside a *_FAIL_CLASSES set/array -- skills.mjs:80
#   5. return 'x'                          a classifier -- state.mjs:125
# Rather than enumerate `: 'x'`, `?? 'x'`, `cond ? 'a' : 'b'` and the next variant we have
# not met yet, take EVERY quoted snake_case literal on the remainder of the line after a
# `failClass:`. Over-capturing a neighbouring literal is harmless -- the registry is used to
# decide whether a zero is explainable, so a superset makes it CONSERVATIVE. Under-capturing
# is what produced seven false "cannot emit" verdicts.
FAILCLASS_LINE = re.compile(r"""fail_?[Cc]lass\s*[:=](.*)""")
MAPPAIR = re.compile(r"""^\s*([A-Z]\w+)\s*:\s*\[\s*['"]([a-z0-9_]+)['"]\s*,""", re.M)
CLASSSET = re.compile(r"""FAIL_CLASSES\s*=\s*new\s+Set\(\[(.*?)\]\)""", re.S)
RETURNLIT = re.compile(r"""return\s+['"]([a-z0-9_]+)['"]""")
QUOTED = re.compile(r"""['"]([a-z0-9_]+)['"]""")
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
            return {'fail_class': set(d['fail_class']),
                    'fail_class_weak': set(d.get('fail_class_weak') or ()),
                    'kind': set(d['kind']), 'sha': short}
        except Exception:
            pass
    files = [f for f in _git(repo, 'ls-tree', '-r', '--name-only', short).splitlines()
             if f.startswith(SRC_DIRS) and f.endswith('.mjs')]
    if not files:
        raise LookupError(f'no bots/src/*.mjs at {short} in {repo} — wrong repo or sha')
    fc, weak, kd = set(), set(), set()
    for f in files:
        src = _git(repo, 'show', f'{short}:{f}')
        for tail in FAILCLASS_LINE.findall(src):
            # Cut the tail at the end of the failClass EXPRESSION. Without this, a
            # `failClass: 'x', detail: `...you need a wooden_pickaxe...`` line put
            # `wooden_pickaxe` and `raw_iron` in the registry and the silent-instrument
            # report filled with item names. Over-capture is safe for the raise and
            # useless for the report, so bound it.
            for stop in (', detail', ',detail', ', status', ',status', '})', '}'):
                i = tail.find(stop)
                if i >= 0:
                    tail = tail[:i]
            fc.update(QUOTED.findall(tail))
        fc.update(m[1] for m in MAPPAIR.findall(src))
        for body in CLASSSET.findall(src):
            # Strip // comments first: UNKNOWN_FAIL_CLASSES carries long explanatory
            # comments INSIDE the Set literal that mention item names ('raw_iron',
            # 'item'), and those were landing in the registry.
            body = re.sub(r'//[^\n]*', '', body)
            fc.update(QUOTED.findall(body))
        # `return 'x'` is only a fail class if the file is a classifier; restrict to the
        # two that are, or every skill's string returns pollute the registry.
        # `return 'x'` in the classifiers catches real classes (state.mjs:125 returns
        # 'goal_changed') but ALSO item names and sentinels, so it lands in the WEAK set.
        # The raise uses strong|weak, because over-capture there just means "explainable"
        # and is safe. The silent-instrument REPORT uses strong only, because an item name
        # listed as a silent failure class is noise that gets the report ignored.
        if f.endswith(('state.mjs', 'runner.mjs')):
            weak.update(RETURNLIT.findall(src))
        kd.update(KIND.findall(src))
    # Two sentinels that are control flow, not failure classes, and pollute every report.
    fc -= {'unknown', 'failed', 'pathfinding'}
    out = {'fail_class': fc, 'fail_class_weak': weak - fc, 'kind': kd, 'sha': short}
    if cache:
        try:
            json.dump({'fail_class': sorted(fc),
                       'fail_class_weak': sorted(out['fail_class_weak']),
                       'kind': sorted(kd), 'sha': short}, open(cache, 'w'))
        except Exception:
            pass
    return out


# `_death` rows put the DEATH CAUSE in the same `fail_class` field. Those come from the
# game's damage source, not from any literal in our source, so checking them against a
# source-derived registry is a category error -- it reported `drowning` and `fire` as
# "this build cannot emit that". They are a second vocabulary and are listed separately.
DEATH_CAUSE_KINDS = ('_death',)


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
