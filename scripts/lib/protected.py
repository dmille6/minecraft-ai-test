#!/usr/bin/env python3
"""
DOES THIS DIFF TOUCH PROTECTED PATHS? (fun mode, docs/PROCESS-fun-mode.md § Tiers; OWNER 2026-10-28)

The one decider for tier 3. The showcase gate and the canary loop both call it; neither should
re-implement the match. Stdlib only, so it can be copied to a host that has no checkout.

The list is config/protected-paths.txt:
    <glob>                    every line of every matching file
    <glob>::<function glob>   only lines inside those top-level declarations of that file
    tooling: <entry>          either form above, tier TOOLING: host scripts that never run on a bot
                              (two engines, no fleet canary)

Pure parts (tested in scripts/test_protected.py): parse_patterns, glob_match, decl_owners/decl_at,
table_rows, parse_diff, hits, tier_of. The CLI wraps them in git:

    python3 scripts/lib/protected.py                       # origin/main...HEAD
    python3 scripts/lib/protected.py --base A --head B
    python3 scripts/lib/protected.py --files a.mjs b.py    # path-only; a `::` entry counts as hit
    exit 0 = not protected, 1 = protected (hits printed), 2 = could not decide

Exit 1 covers BOTH protected tiers. The last stdout line says which: `tier=3` when any hit is tier 3,
else `tier=tooling`. A gate that reads only the exit code treats tooling as tier 3: the safe side.
Exit 2 is never "not protected": a gate that cannot run this must treat the change as tier 3.

What a `::` entry covers beyond the lines inside the named declaration (each closes a fail-open):
  - HUNK ANCHORS. Every `@@ -a,b +c,d @@` hunk also attributes old-side lines a and a+1 (and new-side
    c and c+1). A pure-add hunk (`-a,0`) has no old lines of its own, so without this a column-0
    declaration inserted inside a protected function re-labels the lines after it on the new side and
    the change reads as clean. Such a declaration is reported as inserted inside the old region.
  - IMPORTS. A changed or deleted import (old side) is protected when a name it binds appears in a
    protected declaration of that file; an added side-effect-only import (`import 'x'`) is protected
    always. An ADDED named/default import is not: ESM refuses a binding that duplicates an existing
    one, so it cannot rebind a name a protected function uses. To add a name, add an import LINE
    rather than editing one a protected function depends on.
  - TABLE ROWS. In a top-level object-literal table (SKILLS, SKILL_CONTRACTS, ...), a 2-space-indented
    row whose key or `run:` target names a protected symbol is protected, compared case-insensitively
    with `_` removed (so the row `keepout_exit` names `keepoutExit`).
Not covered, by construction: unprotected code in the same process can still monkeypatch the bot at
runtime. Path-based tiers cannot see that; review does.
"""
import argparse
import functools
import os
import re
import subprocess
import sys

DEFAULT_LIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                            'config', 'protected-paths.txt')

TIER3, TOOLING = '3', 'tooling'
IMPORTS = '(imports)'

# A top-level declaration starts at column 0. Nested functions are indented in this codebase,
# so column 0 is the boundary of the region a changed line belongs to.
_DECL = re.compile(r'^(?:export\s+(?:default\s+)?)?(?:async\s+)?'
                   r'(?:function\s*\*?\s*|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)')
_IMPORT = re.compile(r'^import\b')
_IMPORT_END = re.compile(r"""(\bfrom\s*['"]|^import\s*['"])""")
_SIDE_EFFECT_IMPORT = re.compile(r"""^import\s*['"]""")
_TABLE = re.compile(r'^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:Object\.freeze\()?\{\s*(?://.*)?$')
_ROW_KEY = re.compile(r"""^  (['"]?)([A-Za-z_$][\w$]*)\1\s*:""")
_RUN = re.compile(r'\brun\s*:\s*([A-Za-z_$][\w$]*)')
_IDENT = re.compile(r'[A-Za-z_$][\w$]*')


def parse_patterns(text):
    """[(path_glob, symbol_glob_or_None, tier)] from the list file's text; tier is TIER3, or TOOLING
    for a `tooling:` entry. Comments and blanks skipped."""
    out = []
    for raw in text.splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        tier = TIER3
        if line.startswith('tooling:'):
            tier, line = TOOLING, line[len('tooling:'):].strip()
            if not line:
                continue
        if '::' in line:
            p, s = line.split('::', 1)
            out.append((p.strip(), s.strip() or None, tier))
        else:
            out.append((line, None, tier))
    return out


@functools.lru_cache(maxsize=None)
def _glob_re(g):
    i, out = 0, ''
    while i < len(g):
        c = g[i]
        if g.startswith('**/', i):
            out += '(?:.*/)?'; i += 3; continue
        if g.startswith('**', i):
            out += '.*'; i += 2; continue
        out += '[^/]*' if c == '*' else '[^/]' if c == '?' else re.escape(c)
        i += 1
    return re.compile('^' + out + '$')


def glob_match(path, g):
    """`*` and `?` stay inside one segment; `**` crosses them."""
    return bool(_glob_re(g).match(path))


def decl_owners(text):
    """owners[i] = name of the top-level declaration whose region holds 1-based line i (None above
    the first). An import statement's lines are IMPORTS instead, and the region around it carries on
    after it. One pass, so a 16k-line file costs one scan, not one per changed line."""
    owners, name, in_import = [None], None, False
    for line in text.splitlines():
        if in_import or _IMPORT.match(line):
            owners.append(IMPORTS)
            in_import = not _IMPORT_END.search(line)   # a multi-line `import {` runs to its `from '...'`
            continue
        m = _DECL.match(line)
        if m:
            name = m.group(1)
        owners.append(name)
    return owners


def decl_at(text, line_no):
    """Name of the top-level declaration whose region holds 1-based line_no, or None above the first."""
    owners = decl_owners(text)
    return owners[min(line_no, len(owners) - 1)]


def table_rows(text):
    """rows[i] = the identifiers naming 1-based line i's ROW of a top-level object-literal table (the
    row's 2-space-indented key and every `run:` target in it), or None outside any row. A row runs from
    its key line through the deeper-indented lines after it; a blank, a comment, or anything at indent
    <= 2 that is not a key ends it."""
    row_of, names, cur, in_table = [None], [], None, False
    for line in text.splitlines():
        if not in_table:
            in_table, cur = bool(_TABLE.match(line)), None
            row_of.append(None)
            continue
        if line.startswith('}'):
            in_table, cur = False, None
            row_of.append(None)
            continue
        m = _ROW_KEY.match(line)
        if m:
            names.append({m.group(2)})
            cur = len(names) - 1
        elif not line.strip() or not line.startswith('   ') or line.lstrip().startswith('//'):
            cur = None
        if cur is not None:
            names[cur].update(_RUN.findall(line))
        row_of.append(cur)
    return [None if r is None else names[r] for r in row_of]


def import_bindings(stmt):
    """Local names an import statement binds, or None when it cannot be read (the caller fails closed).
    `import 'x'` binds nothing: set()."""
    s = ' '.join(stmt.split())
    if _SIDE_EFFECT_IMPORT.match(s):
        return set()
    m = re.match(r"""^import\s+(.*?)\s+from\s*['"]""", s)
    if not m:
        return None
    head, out = m.group(1), set()
    star = re.search(r'\*\s*as\s+([A-Za-z_$][\w$]*)', head)
    if star:
        out.add(star.group(1))
    brace = re.search(r'\{([^}]*)\}', head)
    if brace:
        for part in brace.group(1).split(','):
            toks = part.split()
            if toks:
                out.add(toks[-1])   # `a` or `a as b` -> the local name is the last token
    default = re.match(r'^([A-Za-z_$][\w$]*)\s*(?:,|$)', head)
    if default:
        out.add(default.group(1))
    return out


_HUNK = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def parse_diff(diff_text):
    """Changes from a `git diff -U0` text: [{old_path, new_path, old_lines, new_lines, old_anchors,
    new_anchors, hunks}]. A path is None on the side where the file does not exist (added / deleted).
    hunks are (a, b, c, d) from each `@@ -a,b +c,d @@`; anchors are a, a+1 / c, c+1 of every hunk."""
    changes, cur = [], None
    for line in diff_text.splitlines():
        if line.startswith('diff --git '):
            cur = {'old_path': None, 'new_path': None, 'old_lines': set(), 'new_lines': set(),
                   'old_anchors': set(), 'new_anchors': set(), 'hunks': []}
            m = re.match(r'^diff --git a/(.*) b/(.*)$', line)
            if m:   # paths stay set for mode-only / binary changes with no ---/+++ lines
                cur['old_path'], cur['new_path'] = m.group(1), m.group(2)
            changes.append(cur)
        elif cur is None:
            continue
        elif line.startswith('--- '):
            cur['old_path'] = None if line[4:] == '/dev/null' else line[4:].removeprefix('a/')
        elif line.startswith('+++ '):
            cur['new_path'] = None if line[4:] == '/dev/null' else line[4:].removeprefix('b/')
        elif line.startswith('rename from '):
            cur['old_path'] = line[len('rename from '):]
        elif line.startswith('rename to '):
            cur['new_path'] = line[len('rename to '):]
        else:
            m = _HUNK.match(line)
            if m:
                a, b = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
                c, d = int(m.group(3)), int(m.group(4) if m.group(4) is not None else 1)
                cur['old_lines'].update(range(a, a + b))
                cur['new_lines'].update(range(c, c + d))
                cur['old_anchors'].update(x for x in (a, a + 1) if x >= 1)
                cur['new_anchors'].update(x for x in (c, c + 1) if x >= 1)
                cur['hunks'].append((a, b, c, d))
    return changes


class _File:
    """One side of one file, read once: its lines, declaration owners and table rows."""

    def __init__(self, text):
        self.lines = [''] + text.splitlines()
        self.owners = decl_owners(text)
        self.rows = table_rows(text)
        self._words = {}

    def owner(self, n):
        return self.owners[n] if 0 <= n < len(self.owners) else self.owners[-1]

    def row(self, n):
        return self.rows[n] if 0 <= n < len(self.rows) else None

    def import_stmt(self, n):
        """The whole import statement holding line n (lines are IMPORTS-owned)."""
        lo = n
        while lo > 1 and self.owners[lo - 1] == IMPORTS and not _IMPORT.match(self.lines[lo]):
            lo -= 1
        hi = n
        while hi + 1 < len(self.owners) and self.owners[hi + 1] == IMPORTS and not _IMPORT.match(self.lines[hi + 1]):
            hi += 1
        return '\n'.join(self.lines[lo:hi + 1])

    def words_in(self, sym):
        """Identifiers used anywhere inside the declarations matching `sym` (cached)."""
        if sym not in self._words:
            w = set()
            for i in range(1, len(self.owners)):
                o = self.owners[i]
                if o and o != IMPORTS and glob_match(o, sym):
                    w.update(_IDENT.findall(self.lines[i]))
            self._words[sym] = w
        return self._words[sym]


def hits(changes, patterns, read=None):
    """Sorted list of human-readable hits; a tooling-tier hit ends in ' [tooling]' (tier_of reads it).
    `read(side, path)` returns that file's text on side 'old' or 'new' (None if unknown); with no
    reader, or no text, a `::` entry on a matching path counts as a hit -- unknown is protected,
    never the reverse."""
    found = {}

    def add(h, tier):
        if found.get(h) != TIER3:
            found[h] = tier

    for ch in changes:
        no_hunks = not (ch.get('old_lines') or ch.get('new_lines'))
        files = {}

        def get(side, path):
            if (side, path) not in files:
                text = read(side, path) if read else None
                files[(side, path)] = None if text is None else _File(text)
            return files[(side, path)]

        for side, path, lines, anchors in (
                ('old', ch.get('old_path'), ch.get('old_lines') or set(), ch.get('old_anchors') or set()),
                ('new', ch.get('new_path'), ch.get('new_lines') or set(), ch.get('new_anchors') or set())):
            if not path:
                continue
            for g, sym, tier in patterns:
                if not glob_match(path, g):
                    continue
                if sym is None:
                    add(path, tier)
                    continue
                if no_hunks:   # pure rename / mode / binary: nothing to attribute, so fail closed
                    add(f'{path}::{sym} (no line hunks: rename, mode or binary change)', tier)
                    continue
                f = get(side, path)
                if f is None:
                    add(f'{path}::{sym} (function not checked)', tier)
                    continue
                for n in sorted(lines):
                    o = f.owner(n)
                    if o == IMPORTS:
                        stmt = f.import_stmt(n)
                        b = import_bindings(stmt)
                        if b is None:
                            add(f'{path}::{IMPORTS} (unreadable import, line {n})', tier)
                        elif not b and _SIDE_EFFECT_IMPORT.match(stmt.strip()):
                            add(f'{path}::{IMPORTS} (side-effect import)', tier)
                        elif side == 'old':
                            used = sorted(b & f.words_in(sym))
                            if used:
                                add(f'{path}::{IMPORTS} (binds {", ".join(used)}, used in {sym})', tier)
                        continue
                    if o and glob_match(o, sym):
                        add(f'{path}::{o}', tier)
                    r = f.row(n)
                    if r and any(glob_match(_norm(x), _norm(sym)) for x in r):
                        add(f'{path}::{o} row naming {sym}', tier)
                for n in sorted(anchors - lines):   # anchors attribute regions only: not imports, not rows
                    o = f.owner(n)
                    if o and o != IMPORTS and glob_match(o, sym):
                        add(f'{path}::{o}', tier)
            # A NEW COLUMN-0 DECLARATION INSIDE AN OLD PROTECTED REGION: named for the reader (the anchors
            # above already make it a hit; this line says why).
        old_p, new_p = ch.get('old_path'), ch.get('new_path')
        if old_p and new_p and ch.get('hunks') and read:
            for g, sym, tier in patterns:
                if sym is None or not glob_match(old_p, g):
                    continue
                fo, fn = get('old', old_p), get('new', new_p)
                if fo is None or fn is None:
                    continue
                for a, b, c, d in ch['hunks']:
                    for k in range(c, c + d):
                        m = _DECL.match(fn.lines[k]) if 0 < k < len(fn.lines) else None
                        if not m:
                            continue
                        for o in {fo.owner(x) for x in (a, a + 1)}:
                            if o and o != IMPORTS and glob_match(o, sym):
                                add(f'{old_p}::{o} (new declaration {m.group(1)} inserted inside it)', tier)
    return sorted(h if t == TIER3 else f'{h} [tooling]' for h, t in found.items())


def _norm(sym):
    return sym.replace('_', '').lower()


def tier_of(hit_list):
    """'3' if any hit is tier 3, 'tooling' if every hit is tooling, None for no hits."""
    if not hit_list:
        return None
    return TOOLING if all(h.endswith(' [tooling]') for h in hit_list) else TIER3


# ---------------------------------------------------------------- CLI (git around the pure parts)

def _git(*a, cwd=None):
    return subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True, check=True).stdout


def main(argv=None):
    ap = argparse.ArgumentParser(description='Does this change touch protected paths?')
    ap.add_argument('--base', default='origin/main')
    ap.add_argument('--head', default='HEAD')
    ap.add_argument('--list', default=None, help='protected list (default config/protected-paths.txt)')
    ap.add_argument('--files', nargs='*', help='path-only mode: these repo-relative paths changed')
    ap.add_argument('--repo', default=None)
    a = ap.parse_args(argv)
    try:
        repo = a.repo or _git('rev-parse', '--show-toplevel').strip()
        lst = a.list or os.path.join(repo, 'config', 'protected-paths.txt')
        patterns = parse_patterns(open(lst).read())
        if not patterns:
            raise ValueError(f'{lst} lists nothing')
        if a.files is not None:
            changes = [{'old_path': None, 'new_path': f, 'old_lines': set(), 'new_lines': set()}
                       for f in a.files]
            reader = None
        else:
            base = _git('merge-base', a.base, a.head, cwd=repo).strip()
            changes = parse_diff(_git('diff', '-U0', '-M', '--no-color', base, a.head, cwd=repo))
            revs = {'old': base, 'new': a.head}

            def reader(side, path):
                try:
                    return _git('show', f'{revs[side]}:{path}', cwd=repo)
                except subprocess.CalledProcessError:
                    return None
        h = hits(changes, patterns, reader)
    except Exception as e:  # noqa: BLE001 -- any failure is "could not decide", which gates read as tier 3
        print(f'protected: could not decide ({e}); treat as PROTECTED', file=sys.stderr)
        return 2
    if h:
        t = tier_of(h)
        print('PROTECTED (tier 3):' if t == TIER3 else 'PROTECTED (tooling: two engines, no fleet canary):')
        for x in h:
            print('  ' + x)
        print(f'tier={t}')
        return 1
    print('not protected')
    return 0


if __name__ == '__main__':
    sys.exit(main())
