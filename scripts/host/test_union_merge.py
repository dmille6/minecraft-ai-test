#!/usr/bin/env python3
"""The orphan manifest's merge=union (phase 1 item 3, 11-06): behaviour on a REAL git merge, made the way promomerge.py
merges (`git merge --no-ff` in a checkout of main), with the repo's own .gitattributes.

    python3 scripts/host/test_union_merge.py          (exit 1 on failure)

Checks: (1) git reports merge=union for the manifest in this checkout; (2) two branches that each add a REQUIRED entry at
the top of the list merge CLEAN and keep both entries; (3) POSITIVE CONTROL / mutant: the same merge without the attribute
conflicts (so (2) passed because of the attribute, not because the hunks never touched); (4) the attribute is scoped: the
same conflict in another file still conflicts.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MANIFEST = 'bots/test/nothing-important-is-orphaned.test.mjs'
FAILS = []
ENV = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
           GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')


def check(name, cond, detail=''):
    if not cond:
        FAILS.append(f'{name} {detail}')


def g(repo, *a, check_rc=True):
    r = subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True, env=ENV)
    if check_rc and r.returncode != 0:
        raise RuntimeError(f'git {a}: {r.stderr}')
    return r


BASE = """const REQUIRED = [
  'docs/reports/STATE.md',
  'bots/src/a.mjs',
]
"""


def scenario(attrs, path=MANIFEST):
    """-> (merge rc, merged text). main and two branches; each branch adds one line at the top of REQUIRED."""
    d = tempfile.mkdtemp(prefix='union-')
    try:
        g(d, 'init', '-q', '-b', 'main')
        if attrs is not None:
            open(os.path.join(d, '.gitattributes'), 'w').write(attrs)
        os.makedirs(os.path.join(d, os.path.dirname(path)), exist_ok=True)
        open(os.path.join(d, path), 'w').write(BASE)
        g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', 'base')
        for br, entry in (('one', "  'bots/src/one.mjs',\n"), ('two', "  'bots/src/two.mjs',\n")):
            g(d, 'checkout', '-q', '-b', br, 'main')
            open(os.path.join(d, path), 'w').write(BASE.replace('const REQUIRED = [\n', 'const REQUIRED = [\n' + entry))
            g(d, 'commit', '-q', '-am', br)
        g(d, 'checkout', '-q', 'main')
        g(d, 'merge', '--no-ff', '-q', '-m', 'one', 'one')
        r = g(d, 'merge', '--no-ff', '-q', '-m', 'two', 'two', check_rc=False)      # promomerge.py merge_onto's call
        return r.returncode, open(os.path.join(d, path)).read()
    finally:
        shutil.rmtree(d, ignore_errors=True)


def main():
    attrs = open(os.path.join(ROOT, '.gitattributes')).read()
    r = subprocess.run(['git', '-C', ROOT, 'check-attr', 'merge', '--', MANIFEST], capture_output=True, text=True)
    check('this checkout resolves merge=union for the manifest', r.stdout.strip().endswith('merge: union'), r.stdout)
    rc, text = scenario(attrs)
    check('two REQUIRED additions merge clean with the attribute', rc == 0, rc)
    check('both entries survive the merge', "'bots/src/one.mjs'" in text and "'bots/src/two.mjs'" in text, text)
    check('no conflict markers', '<<<<<<<' not in text and '>>>>>>>' not in text, text)
    rc2, text2 = scenario(None)
    check('POSITIVE CONTROL: without the attribute the same merge conflicts', rc2 != 0 and '<<<<<<<' in text2, rc2)
    rc3, _ = scenario(attrs, path='bots/test/other.test.mjs')
    check('the attribute is scoped to the manifest (another file still conflicts)', rc3 != 0, rc3)
    for f in FAILS:
        print('FAIL', f)
    print(f'union merge: {"FAIL" if FAILS else "ok"} ({len(FAILS)} failures)')
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
