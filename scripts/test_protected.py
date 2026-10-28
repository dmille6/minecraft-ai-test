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
pats = P.parse_patterns('# c\n\nbots/src/reflex.mjs   # trailing\nbots/src/skills.mjs::mine\n'
                        'tooling: scripts/verdict.py\ntooling: a.mjs::f\n')
check(pats == [('bots/src/reflex.mjs', None, '3'), ('bots/src/skills.mjs', 'mine', '3'),
               ('scripts/verdict.py', None, 'tooling'), ('a.mjs', 'f', 'tooling')], f'parse {pats}')

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
check(P.decl_at(SRC, 1) == P.IMPORTS, 'an import line is owned by IMPORTS, not by a declaration')
check(P.decl_at('// header\nconst A = 1\n', 1) is None, 'a comment above the first declaration has no owner')
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
PATS = [('bots/src/reflex.mjs', None, '3'), ('bots/src/escape.mjs', None, '3'), ('bots/src/skills.mjs', 'mine', '3')]
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
check(P.hits(table, PATS, read) == ['bots/src/skills.mjs::SKILLS row naming mine'],
      'editing the SKILLS row whose key/run names mine IS protected (a dispatch row re-points the skill)')
table_build = [{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs',
                'old_lines': set(), 'new_lines': {11}}]
check(P.hits(table_build, PATS, read) == [], 'the table\'s own header line is not a row')
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
cpats = [('bots/src/skills.mjs', 'STEP_UP', '3')]
creader = lambda side, path: CONSTS  # noqa: E731
check(P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {1},
               'new_lines': {1}}], cpats, creader) == ['bots/src/skills.mjs::STEP_UP'], 'a listed constant is protected')
check(P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {3},
               'new_lines': {3}}], cpats, creader) == [], 'the function after it is not')
docs = [ch[1]]
check(P.hits(docs, PATS, read) == [], 'a docs file is not protected')

# ---- FAIL-OPEN 1 (second-engine review of 00c2c52b): a pure-add hunk inserting a column-0 declaration
# ---- inside a protected function. With -U0 the hunk is `-4,0 +5,2`: no old line of its own, and on the
# ---- new side the inserted lines belong to the NEW declaration, so the old decider read it as clean.
REPRO_NEW = SRC.split('\n')
REPRO_NEW[4:4] = ['const SNEAK = 0', '  return SNEAK   // mine now returns 0']   # after line 4, inside mine
REPRO_NEW = '\n'.join(REPRO_NEW)
REPRO_DIFF = '\n'.join([
    'diff --git a/bots/src/skills.mjs b/bots/src/skills.mjs',
    '--- a/bots/src/skills.mjs',
    '+++ b/bots/src/skills.mjs',
    '@@ -4,0 +5,2 @@ async function mine (ctx) {',
    '+const SNEAK = 0',
    '+  return SNEAK   // mine now returns 0',
])
rch = P.parse_diff(REPRO_DIFF)
check(rch[0]['old_lines'] == set() and rch[0]['old_anchors'] == {4, 5} and rch[0]['hunks'] == [(4, 0, 5, 2)],
      f'a pure-add hunk has no old lines but anchors a, a+1 ({rch[0]})')
rread = lambda side, path: SRC if side == 'old' else REPRO_NEW  # noqa: E731
rh = P.hits(rch, PATS, rread)
check('bots/src/skills.mjs::mine' in rh, f'REPRO: a declaration inserted inside mine is a change to mine ({rh})')
check('bots/src/skills.mjs::mine (new declaration SNEAK inserted inside it)' in rh, f'and it is named as such ({rh})')
no_anchor = [{**rch[0], 'old_anchors': set(), 'new_anchors': set(), 'hunks': []}]
check(P.hits(no_anchor, PATS, rread) == [], 'POSITIVE CONTROL for the repro: without anchors it reads clean (the bug)')
BUILD_NEW = SRC.split('\n'); BUILD_NEW[9:9] = ['const HELPER = 1']; BUILD_NEW = '\n'.join(BUILD_NEW)
bch = P.parse_diff('diff --git a/bots/src/skills.mjs b/bots/src/skills.mjs\n--- a/bots/src/skills.mjs\n'
                   '+++ b/bots/src/skills.mjs\n@@ -9,0 +10 @@\n+const HELPER = 1')
check(P.hits(bch, PATS, lambda side, path: SRC if side == 'old' else BUILD_NEW) == [],
      'the same insertion inside build is not protected (anchors 9, 10 are build)')

# ---- FAIL-OPEN 2a: imports of a `::` file ----------------------------------------------------
ISRC = '\n'.join([
    "import { DEPTH_OF } from './depth.mjs'",      # 1  used by mine
    "import { townThing } from './town.mjs'",      # 2  used by build only
    "import {",                                    # 3
    "  multiA,",                                   # 4
    "  multiB as mb",                              # 5  mb used by mine
    "} from './multi.mjs'",                        # 6
    "async function mine () {",                    # 7
    "  return DEPTH_OF() + mb",                    # 8
    "}",                                           # 9
    "function build () {",                         # 10
    "  return townThing() + multiA",               # 11
    "}",                                           # 12
])
ipats = [('m.mjs', 'mine', '3')]
iread = lambda side, path: ISRC  # noqa: E731
def ich(old=(), new=()):
    return [{'old_path': 'm.mjs', 'new_path': 'm.mjs', 'old_lines': set(old), 'new_lines': set(new)}]
check(P.decl_owners(ISRC)[1:7] == [P.IMPORTS] * 6, 'single- and multi-line imports are IMPORTS-owned')
check(P.decl_owners(ISRC)[8] == 'mine', 'the region after the imports is still attributed normally')
check(P.hits(ich({1}, {1}), ipats, iread) == ['m.mjs::(imports) (binds DEPTH_OF, used in mine)'],
      'editing an import a protected function uses is protected')
check(P.hits(ich({2}, {2}), ipats, iread) == [], 'POSITIVE CONTROL: editing an import only build uses is not')
check(P.hits(ich({5}, set()), ipats, iread) == ['m.mjs::(imports) (binds mb, used in mine)'],
      'a line of a multi-line import that binds a name mine uses (aliased) is protected')
NEWIMP = ISRC.replace("import { townThing } from './town.mjs'",
                      "import { townThing } from './town.mjs'\nimport { extra } from './extra.mjs'\nimport './patch.mjs'")
nread = lambda side, path: ISRC if side == 'old' else NEWIMP  # noqa: E731
check(P.hits(ich((), {3}), ipats, nread) == [], 'an ADDED named import is not protected (it cannot rebind a name)')
check(P.hits(ich((), {4}), ipats, nread) == ['m.mjs::(imports) (side-effect import)'], 'an added side-effect import is')
check(P.import_bindings("import a, { b as c, d } from 'x'") == {'a', 'c', 'd'}, 'default + braces + alias')
check(P.import_bindings("import * as ns from 'x'") == {'ns'}, 'namespace import')
check(P.import_bindings("import 'x'") == set(), 'side-effect import binds nothing')
check(P.import_bindings("import weird") is None, 'an unreadable import is None (the caller fails closed)')
WEIRD = "import weird\nasync function mine () {\n  return 1\n}\n"
check(P.hits(ich({1}, set()), ipats, lambda side, path: WEIRD) == ['m.mjs::(imports) (unreadable import, line 1)'],
      'an import the parser cannot read is protected')

# ---- FAIL-OPEN 2b: table rows ------------------------------------------------------------------
TSRC = '\n'.join([
    "export const SKILLS = {",                     # 1
    "  goto: { run: goto, args: [] },",            # 2
    "  // a comment between rows",                 # 3
    "  build: {",                                  # 4
    "    usage: 'build',",                         # 5
    "    run: build },",                           # 6
    "  keepout_exit: { run: keepoutExit },",       # 7
    "  sneaky: {",                                 # 8
    "    usage: 'x',",                             # 9
    "    run: mine },",                            # 10
    "}",                                           # 11
])
tr = P.table_rows(TSRC)
check(tr[2] == {'goto'} and tr[3] is None and tr[5] == {'build'} and tr[9] == {'sneaky', 'mine'} and tr[11] is None,
      f'table_rows: key + run per row, comments and the closing brace in none ({tr})')
tpats = [('t.mjs', 'goto', '3'), ('t.mjs', 'keepoutExit', '3'), ('t.mjs', 'mine', '3')]
tch = lambda n: [{'old_path': 't.mjs', 'new_path': 't.mjs', 'old_lines': {n}, 'new_lines': {n}}]  # noqa: E731
tread = lambda side, path: TSRC  # noqa: E731
check(P.hits(tch(2), tpats, tread) == ['t.mjs::SKILLS row naming goto'], 'the goto row')
check(P.hits(tch(7), tpats, tread) == ['t.mjs::SKILLS row naming keepoutExit'], 'keepout_exit names keepoutExit (_ and case)')
check(P.hits(tch(9), tpats, tread) == ['t.mjs::SKILLS row naming mine'], 'a row whose run: (on a later line) names mine')
check(P.hits(tch(5), tpats, tread) == [], 'POSITIVE CONTROL: the build row is not protected')

# ---- tooling -----------------------------------------------------------------------------------
tl = [('scripts/verdict.py', None, 'tooling'), ('bots/src/reflex.mjs', None, '3')]
v = [{'old_path': 'scripts/verdict.py', 'new_path': 'scripts/verdict.py', 'old_lines': {1}, 'new_lines': {1}}]
r_ = [{'old_path': 'bots/src/reflex.mjs', 'new_path': 'bots/src/reflex.mjs', 'old_lines': {1}, 'new_lines': {1}}]
check(P.hits(v, tl) == ['scripts/verdict.py [tooling]'] and P.tier_of(P.hits(v, tl)) == 'tooling', 'tooling hit')
check(P.tier_of(P.hits(v + r_, tl)) == '3', 'tooling + tier 3 is tier 3')
check(P.tier_of([]) is None, 'no hits, no tier')
check(P.hits(v, [('scripts/verdict.py', None, 'tooling'), ('scripts/*.py', None, '3')]) == ['scripts/verdict.py'],
      'a path both tooling and tier 3 is tier 3')

# ---- the real list -------------------------------------------------------------------------
REAL = P.parse_patterns(open(os.path.join(ROOT, 'config', 'protected-paths.txt')).read())
check(len(REAL) >= 40, f'the real list is not vacuous ({len(REAL)} entries)')
for g, sym, _tier in REAL:
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
for must in ('bots/src/runner.mjs', 'bots/src/cognitive.mjs', 'bots/src/admission.mjs', 'bots/package.json',
             'bots/package-lock.json'):
    h = P.hits([{'old_path': must, 'new_path': must, 'old_lines': {1}, 'new_lines': {1}}], REAL, None)
    check(h == [must] and P.tier_of(h) == '3', f'the real list protects {must} at tier 3 ({h})')
for tool in ('infra/showcase/showcase_ops.py', 'infra/showcase/showcase_trip.py', 'scripts/host/canary-sched.py',
             'scripts/canary-loop.sh', 'scripts/host/canary-loop.sh', 'scripts/verdict.py', 'scripts/lib/protected.py',
             'config/protected-paths.txt'):
    h = P.hits([{'old_path': tool, 'new_path': tool, 'old_lines': {1}, 'new_lines': {1}}], REAL, None)
    check(P.tier_of(h) == 'tooling', f'the real list classes {tool} as tooling ({h})')
for name in ('gather', 'gatherRun', 'collectManually', 'canopyDrop', 'withKeepout'):
    ln = SK_OWN.index(name)
    check(P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {ln},
                   'new_lines': {ln}}], REAL, skread) == [f'bots/src/skills.mjs::{name}'],
          f'the real list protects skills.mjs::{name}')
SK_LINES = SK.split('\n')
def sk_row(table, key):
    start = SK_LINES.index(f'export const {table} = {{')
    for i in range(start + 1, len(SK_LINES)):
        if SK_LINES[i].startswith(f'  {key}:'):
            return i + 1
        if SK_LINES[i].startswith('}'):
            break
    raise AssertionError(f'no row {table}.{key}')
for table, key, protected_ in (('SKILLS', 'mine', True), ('SKILLS', 'goto', True), ('SKILLS', 'keepout_exit', True),
                               ('SKILLS', 'gather', True), ('SKILLS', 'surface', True), ('SKILL_CONTRACTS', 'goto', True),
                               ('SKILL_CONTRACTS', 'mine', True), ('SKILL_CONTRACTS', 'gather', True),
                               ('SKILL_CONTRACTS', 'keepout_exit', True), ('SKILLS', 'build', False),
                               ('SKILLS', 'found_store', False), ('SKILL_CONTRACTS', 'build', False),
                               ('SKILL_CONTRACTS', 'town_deposit', False)):
    ln = sk_row(table, key)
    h = P.hits([{'old_path': 'bots/src/skills.mjs', 'new_path': 'bots/src/skills.mjs', 'old_lines': {ln},
                 'new_lines': {ln}}], REAL, skread)
    check(bool(h) == protected_, f'real skills.mjs {table}.{key} row protected={protected_} ({h})')
BK = open(os.path.join(ROOT, 'bots', 'src', 'bankable.mjs')).read()
BK_OWN = P.decl_owners(BK)
for name, want in (('scaffoldKeep', True), ('isScaffoldItem', True), ('depositPlan', False)):
    ln = BK_OWN.index(name)
    h = P.hits([{'old_path': 'bots/src/bankable.mjs', 'new_path': 'bots/src/bankable.mjs', 'old_lines': {ln},
                 'new_lines': {ln}}], REAL, lambda side, path: BK)
    check(bool(h) == want, f'bankable.mjs::{name} protected={want} ({h})')
check(not P.hits([{'old_path': 'bots/src/features.mjs', 'new_path': 'bots/src/features.mjs',
                   'old_lines': {1}, 'new_lines': {1}}], REAL, None),
      'the real list leaves building features\' spawn work (features.mjs) unprotected')
check(os.path.exists(os.path.join(ROOT, 'bots', 'src', 'features.mjs')), 'features.mjs exists (positive control)')
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

    check(r.stdout.strip().endswith('tier=3'), f'CLI: the last line names the tier ({r.stdout})')

    g('checkout', '-q', '-b', 'repro', base)            # the reviewer's repro, through git diff -U0 itself
    open(os.path.join(tmp, 'bots', 'src', 'skills.mjs'), 'w').write(REPRO_NEW + '\n')
    g('commit', '-qam', 'insert a declaration inside mine')
    d = g('diff', '-U0', base, 'HEAD').stdout
    check('@@ -4,0 +5,2 @@' in d, f'git emits the pure-add hunk the repro models ({d})')
    r = cli('--base', base, '--head', 'HEAD')
    check(r.returncode == 1 and 'skills.mjs::mine' in r.stdout, f'CLI REPRO: exit 1 ({r.returncode} {r.stdout}{r.stderr})')

    g('checkout', '-q', '-b', 'tool', base)
    open(os.path.join(tmp, 'config', 'protected-paths.txt'), 'w').write('bots/src/skills.mjs::mine\ntooling: ops/*.py\n')
    os.makedirs(os.path.join(tmp, 'ops'))
    g('add', '-A'); g('commit', '-qm', 'list v2')
    tbase = g('rev-parse', 'HEAD').stdout.strip()
    open(os.path.join(tmp, 'ops', 'read.py'), 'w').write('print(1)\n')
    g('add', '-A'); g('commit', '-qm', 'a tooling script')
    r = cli('--base', tbase, '--head', 'HEAD')
    check(r.returncode == 1 and 'PROTECTED (tooling' in r.stdout and r.stdout.strip().endswith('tier=tooling'),
          f'CLI: a tooling-only change exits 1 and says tier=tooling ({r.returncode} {r.stdout})')
    g('checkout', '-q', 'main')
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


def mutant(old, new, probe, label):
    """Apply one textual mutant to protected.py, prove the anchor is present and unique, and require the
    probe to FAIL under it (a mutant that cannot be seen failing is not a test)."""
    assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {old}'
    m = {'__name__': 'protected_mutant', '__file__': os.path.join(HERE, 'lib', 'protected.py')}
    exec(compile(src.replace(old, new, 1), 'protected_mutant', 'exec'), m)
    check(not probe(m), f'MUTANT KILLED: {label}')


mutant("cur['old_anchors'].update(x for x in (a, a + 1) if x >= 1)", "pass",
       lambda M: 'bots/src/skills.mjs::mine' in M['hits'](M['parse_diff'](REPRO_DIFF), PATS, rread),
       'without old-side anchors the inserted-declaration repro reads clean')
mutant("        if cur is not None:\n            names[cur].update(_RUN.findall(line))\n        row_of.append(cur)",
       "        row_of.append(None)",
       lambda M: M['hits'](tch(2), tpats, tread) == ['t.mjs::SKILLS row naming goto'],
       'without table rows the goto row is unprotected')
mutant("            owners.append(IMPORTS)\n", "            owners.append(name)\n",
       lambda M: M['hits'](ich({1}, {1}), ipats, iread) == ['m.mjs::(imports) (binds DEPTH_OF, used in mine)'],
       'without IMPORTS ownership an edited import is unprotected')
mutant("        if line.startswith('tooling:'):", "        if False:",
       lambda M: M['tier_of'](M['hits'](v, M['parse_patterns']('tooling: scripts/verdict.py\n'))) == 'tooling',
       'a list parser that ignores tooling: cannot class a tooling path')

print(f'test_protected: {n} checks passed')
