#!/usr/bin/env python3
"""
Behaviour tests for scripts/lib/protected.py (the fun-mode tier-3 decider) and for the real list,
config/protected-paths.txt. Run by bots/test/protected-paths.test.mjs, so `npm test` covers it.

Every "not protected" assertion sits next to a positive control showing the same input shape
IS caught, and the CLI is driven end to end on a throwaway git repo.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, 'lib'))
import protected as P  # noqa: E402

n = 0


def check(cond, label):
    global n
    n += 1
    assert cond, 'FAILED: ' + label


# ---- globs ---------------------------------------------------------------------------------
check(P.glob_match('bots/src/reflex.mjs', 'bots/src/*.mjs'), '* matches inside a segment')
check(not P.glob_match('bots/src/sub/reflex.mjs', 'bots/src/*.mjs'), '* does not cross /')
check(P.glob_match('bots/src/sub/reflex.mjs', 'bots/src/**/*.mjs'), '** crosses /')
check(P.glob_match('bots/src/reflex.mjs', 'bots/src/**/*.mjs'), '**/ also matches zero segments')
check(P.glob_match('stairLiquid', 'stair*') and not P.glob_match('mine', 'stair*'), 'symbol globs')
check(not P.glob_match('bots/src/reflexAmjs', 'bots/src/reflex.mjs'), '. is literal')

# ---- patterns ------------------------------------------------------------------------------
pats = P.parse_patterns('# c\n\nbots/src/reflex.mjs   # trailing\nbots/src/skills.mjs::mine\n')
check(pats == [('bots/src/reflex.mjs', None), ('bots/src/skills.mjs', 'mine')], f'parse {pats}')

# ---- declarations --------------------------------------------------------------------------
SRC = '\n'.join([
    "import x from 'y'",                       # 1  (above any declaration)
    "const DEPTH = 12",                        # 2  DEPTH
    "async function mine (ctx) {",             # 3  mine
    "  function inner () { return 1 }",        # 4  nested: still mine
    "  return DEPTH",                          # 5
    "}",                                       # 6
    "",                                        # 7  still mine (blank after it)
    "export async function build(ctx) {",      # 8  build
    "  return 2",                              # 9
    "}",                                       # 10
    "export const SKILLS = {",                 # 11 SKILLS
    "  mine: { run: mine },",                  # 12
    "}",                                       # 13
])
check(P.decl_at(SRC, 1) is None, 'line above the first declaration has no owner')
check(P.decl_at(SRC, 2) == 'DEPTH', 'top-level const is a declaration')
check(P.decl_at(SRC, 3) == 'mine' and P.decl_at(SRC, 4) == 'mine', 'nested function belongs to mine')
check(P.decl_at(SRC, 7) == 'mine', 'trailing blank attributed to the function above')
check(P.decl_at(SRC, 9) == 'build', 'export async function')
check(P.decl_at(SRC, 12) == 'SKILLS', 'a table entry is not the function it names')

# ---- diff parsing --------------------------------------------------------------------------
DIFF = '\n'.join([
    'diff --git a/bots/src/skills.mjs b/bots/src/skills.mjs',
    'index 1..2 100644',
    '--- a/bots/src/skills.mjs',
    '+++ b/bots/src/skills.mjs',
    '@@ -5 +5 @@ async function mine (ctx) {',
    '-  return DEPTH',
    '+  return DEPTH + 1',
    '@@ -9,0 +10,2 @@ export async function build(ctx) {',
    '+  a()',
    '+  b()',
    'diff --git a/docs/new.md b/docs/new.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/docs/new.md',
    '@@ -0,0 +1,3 @@',
    '+x',
    'diff --git a/bots/src/old.mjs b/bots/src/escape.mjs',
    'similarity index 90%',
    'rename from bots/src/old.mjs',
    'rename to bots/src/escape.mjs',
])
ch = P.parse_diff(DIFF)
check(len(ch) == 3, f'three files {len(ch)}')
check(ch[0]['old_lines'] == {5} and ch[0]['new_lines'] == {5, 10, 11}, f'line sets {ch[0]}')
check(ch[1]['old_path'] is None and ch[1]['new_lines'] == {1, 2, 3}, 'added file')
check(ch[2]['old_path'] == 'bots/src/old.mjs' and ch[2]['new_path'] == 'bots/src/escape.mjs', 'rename')

# ---- the decision --------------------------------------------------------------------------
PATS = [('bots/src/reflex.mjs', None), ('bots/src/escape.mjs', None), ('bots/src/skills.mjs', 'mine')]
read = lambda side, path: SRC if path == 'bots/src/skills.mjs' else None  # noqa: E731

only_build = [{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs',
               'old_lines': set(), 'new_lines': {9}}]
only_mine = [{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs',
              'old_lines': {5}, 'new_lines': {5}}]
check(P.hits(only_mine, PATS, read) == ['bots/src/skills.mjs::mine'], 'POSITIVE CONTROL: mine body is protected')
check(P.hits(only_build, PATS, read) == [], 'a build-only edit of the same file is not')
check(P.hits(only_build, PATS, None) == ['bots/src/skills.mjs::mine (function not checked)'],
      'with no reader the symbol entry is a hit: unknown is protected')
table = [{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs',
          'old_lines': set(), 'new_lines': {12}}]
check(P.hits(table, PATS, read) == [], 'editing the SKILLS table row is not editing mine')
whole = [{'old_path': None, 'new_path': 'bots/src/reflex.mjs', 'old_lines': set(), 'new_lines': {1}}]
check(P.hits(whole, PATS, read) == ['bots/src/reflex.mjs'], 'whole-file entry')
deleted = [{'old_path': 'bots/src/reflex.mjs', 'new_path': None, 'old_lines': {1, 2}, 'new_lines': set()}]
check(P.hits(deleted, PATS, read) == ['bots/src/reflex.mjs'], 'deleting a protected file is protected')
renamed_in = [ch[2]]
check(P.hits(renamed_in, PATS, read) == ['bots/src/escape.mjs'], 'renaming onto a protected path is protected')
pure_rename = [{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/moves.mjs',
                'old_lines': set(), 'new_lines': set()}]
check(P.hits(pure_rename, PATS, read) == ['bots/src/skills.mjs::mine (no line hunks: rename, mode or binary change)'],
      'a pure rename of a :: file is protected (fails closed), not silently clean')
binary = P.parse_diff('diff --git a/bots/src/skills.mjs b/bots/src/skills.mjs\nindex 1..2 100644\n'
                      'Binary files a/bots/src/skills.mjs and b/bots/src/skills.mjs differ')
check(binary[0]['new_path'] == 'bots/src/skills.mjs' and P.hits(binary, PATS, read),
      'a binary change to a :: file is protected')
CONSTS = "const STEP_UP = 24\nasync function build () {\n  return 1\n}\n"
cpats = [('bots/src/skills.mjs', 'STEP_UP')]
creader = lambda side, path: CONSTS  # noqa: E731
check(P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {1},
               'new_lines': {1}}], cpats, creader) == ['bots/src/skills.mjs::STEP_UP'], 'a listed constant is protected')
check(P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {3},
               'new_lines': {3}}], cpats, creader) == [], 'the function after it is not')
docs = [ch[1]]
check(P.hits(docs, PATS, read) == [], 'a docs file is not protected')

# ---- the real list -------------------------------------------------------------------------
REAL = P.parse_patterns(open(os.path.join(ROOT, 'config', 'protected-paths.txt')).read())
check(len(REAL) >= 40, f'the real list is not vacuous ({len(REAL)} entries)')
for g, sym in REAL:
    if any(c in g for c in '*?'):
        continue
    check(os.path.exists(os.path.join(ROOT, g)), f'listed path exists: {g} (renamed? update the list)')
    if sym:
        text = open(os.path.join(ROOT, g)).read()
        names = set(P.decl_owners(text))
        check(any(nm and P.glob_match(nm, sym) for nm in names),
              f'listed function exists: {g}::{sym} (renamed? update the list)')
for must in ('bots/src/reflex.mjs', 'bots/src/scaffold.mjs', 'bots/src/index.mjs',
             'scripts/deploy-fleet.sh', 'infra/guard/death-tripper.py', 'config/protected-paths.txt'):
    check(P.hits([{'old_path': must, 'new_path': must, 'old_lines': {1}, 'new_lines': {1}}], REAL, None),
          f'the real list protects {must}')
SK = open(os.path.join(ROOT, 'bots', 'src', 'skills.mjs')).read()
SK_OWN = P.decl_owners(SK)
skread = lambda side, path: SK if path == 'bots/src/skills.mjs' else None  # noqa: E731
for name in ('STAIR_LOOKAHEAD', 'FLOW_NEIGHBOURS', 'FLOW_FACES', 'STEP_UP', 'RESCUE_BLOCK', 'settle',
             'watchDigging', 'mine', 'goto', 'surface'):
    ln = SK_OWN.index(name)
    check(P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {ln},
                   'new_lines': {ln}}], REAL, skread) == [f'bots/src/skills.mjs::{name}'],
          f'the real list protects skills.mjs::{name}')
for name in ('build', 'townDeposit', 'foundRun', 'placeIntoPlan', 'craft', 'BLUEPRINTS'):
    ln = SK_OWN.index(name)
    check(P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {ln},
                   'new_lines': {ln}}], REAL, skread) == [],
          f'the real list leaves building skills.mjs::{name} unprotected')
check(not P.hits([{'old_path': 'bots/src/townplan.mjs', 'new_path': 'bots/src/townplan.mjs',
                   'old_lines': {1}, 'new_lines': {1}}], REAL, None),
      'the real list leaves building (townplan.mjs) unprotected')

# ---- the CLI, end to end on a throwaway repo -----------------------------------------------
tmp = tempfile.mkdtemp()
try:
    g = lambda *a: subprocess.run(['git', '-C', tmp, *a], check=True, capture_output=True, text=True)  # noqa: E731
    g('init', '-q', '-b', 'main')
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
    os.makedirs(os.path.join(tmp, 'config')); os.makedirs(os.path.join(tmp, 'bots', 'src'))
    open(os.path.join(tmp, 'config', 'protected-paths.txt'), 'w').write('bots/src/skills.mjs::mine\n')
    open(os.path.join(tmp, 'bots', 'src', 'skills.mjs'), 'w').write(SRC + '\n')
    g('add', '-A'); g('commit', '-qm', 'base')
    base = g('rev-parse', 'HEAD').stdout.strip()

    def cli(*a):
        return subprocess.run([sys.executable, os.path.join(HERE, 'lib', 'protected.py'), '--repo', tmp, *a],
                              capture_output=True, text=True)

    lines = SRC.split('\n'); lines[8] = '  return 3'   # line 9: inside build
    open(os.path.join(tmp, 'bots', 'src', 'skills.mjs'), 'w').write('\n'.join(lines) + '\n')
    g('commit', '-qam', 'build only')
    r = cli('--base', base, '--head', 'HEAD')
    check(r.returncode == 0, f'CLI: build-only change -> exit 0 ({r.returncode} {r.stdout}{r.stderr})')

    lines[4] = '  return DEPTH * 2'                    # line 5: inside mine
    open(os.path.join(tmp, 'bots', 'src', 'skills.mjs'), 'w').write('\n'.join(lines) + '\n')
    g('commit', '-qam', 'mine too')
    r = cli('--base', base, '--head', 'HEAD')
    check(r.returncode == 1 and 'skills.mjs::mine' in r.stdout, f'CLI: mine change -> exit 1 ({r.stdout})')

    r = cli('--files', 'bots/src/skills.mjs')
    check(r.returncode == 1, 'CLI --files: a :: entry with no diff is a hit')
    r = cli('--base', 'no-such-rev')
    check(r.returncode == 2, 'CLI: an undecidable change exits 2, never 0')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# ---- MUTANT: decl_at that ignores nesting would misattribute; prove the test sees it ---------
src = open(os.path.join(HERE, 'lib', 'protected.py')).read()
old = "r'^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?'"
assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE'
mut = src.replace(old, "r'^\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?'", 1)
ns = {'__name__': 'protected_mutant', '__file__': os.path.join(HERE, 'lib', 'protected.py')}
exec(compile(mut, 'protected_mutant', 'exec'), ns)
check(ns['decl_at'](SRC, 5) != 'mine', 'MUTANT KILLED: indented declarations would steal mine\'s body')

print(f'test_protected: {n} checks passed')
