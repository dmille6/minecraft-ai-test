#!/usr/bin/env python3
"""
DOES THIS DIFF TOUCH PROTECTED PATHS? (fun mode, docs/PROCESS-fun-mode.md § Tiers; OWNER 2026-10-28)

THREAT MODEL: honest changes by our own agents, classified correctly -- not deliberate obfuscation (computed
keys, multi-declarator shadowing, lexer-desync tricks); review is the guard against those.

The one decider for tier 3. The showcase gate and the canary loop both call it; neither should
re-implement the match. Stdlib only, so it can be copied to a host that has no checkout.

The list is config/protected-paths.txt:
    <glob>                    every line of every matching file
    <glob>::<function glob>   only lines inside those top-level declarations of that file
    tooling: <entry>          either form above, tier TOOLING: host scripts that never run on a bot
                              (two engines, no fleet canary)

Pure parts (tested in scripts/test_protected.py): parse_patterns, glob_match, decl_owners/decl_at,
scan_js, table_rows, import_bindings, parse_diff, hits, tier_of. The CLI wraps them in git:

    python3 scripts/lib/protected.py                       # origin/main...HEAD
    python3 scripts/lib/protected.py --base A --head B
    python3 scripts/lib/protected.py --files a.mjs b.py    # path-only; a `::` entry counts as hit
    exit 0 = not protected, 1 = protected (hits printed), 2 = could not decide

Exit 1 covers BOTH protected tiers. The last stdout line says which: `tier=3` when any hit is tier 3,
else `tier=tooling`. A gate that reads only the exit code treats tooling as tier 3: the safe side.
Exit 2 is never "not protected": a gate that cannot run this must treat the change as tier 3.

What a `::` entry covers beyond the lines inside the named declaration (each closes a fail-open a
review found; scripts/test_protected.py has every repro):
  - HUNK ANCHORS. Every `@@ -a,b +c,d @@` hunk also attributes old-side lines a and a+1 (and new-side
    c and c+1). A pure-add hunk (`-a,0`) has no old lines of its own, so without this a column-0
    declaration inserted inside a protected function re-labels the lines after it on the new side and
    the change reads as clean. Such a declaration is reported as inserted inside the old region.
  - STILL TOP-LEVEL. Each protected declaration must still start at bracket depth 0 on the new side
    (a light JS lexer, scan_js, checked against acorn on every bots/src file). Wrapping it in a new
    scope from unprotected lines around it is a change to it. A file the lexer cannot close is protected.
  - REBOUND ELSEWHERE. A changed line that BINDS a protected declaration's name outside it -- the left
    side of a const/let/var (destructuring included, and a multi-line binding list), a function/class
    name, an assignment target -- is protected; a call or a value use is not. Any changed line naming a
    protected TABLE (below) outside it is protected, reads included.
  - GLOBALS. A changed line that binds a JS global (Date, Math, setTimeout, ...) that a protected
    declaration uses -- const/let/var/function/class/import, an assignment, or a binding-list line -- is
    protected: it would shadow the global under the protected code.
  - IMPORTS. A changed or deleted import (old side) is protected when a name it binds appears in a
    protected declaration of that file; an added side-effect-only import (`import 'x'`) is protected
    always. An ADDED named/default import is not, unless it binds a global as above: ESM refuses a
    binding that duplicates an existing one, so it cannot rebind a module name a protected function uses.
  - TABLES. In a top-level object-literal table (SKILLS, SKILL_CONTRACTS, ...), a row whose key or
    `run:` target names a protected symbol is protected (any indent, any key on the line; compared
    case-insensitively with `_` removed, so the row `keepout_exit` names `keepoutExit`). A table that
    holds such a row is a PROTECTED TABLE: every code line of it outside an unprotected row (its header,
    its closing brace, a key at an odd indent) is protected; comment-only lines are not.
Not covered, by construction: unprotected code in the same process can still change shared state or
monkeypatch the bot at runtime, and an unlisted helper a listed function calls is protected only if it is
listed too. Path-based tiers cannot see those; review does.
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
_ANY_KEY = re.compile(r"""(?:^|[{,])\s*(['"]?)([A-Za-z_$][\w$]*)\1\s*:(?!:)""")
_BINDERS = {'const', 'let', 'var', 'function', 'class', 'import'}
_BINDING_LIST = re.compile(r'^[\s\w$,:{}\[\]]*$')
GLOBALS = frozenset('''Date Math JSON Promise Number String Boolean Array Object Set Map WeakMap WeakSet Symbol
    BigInt Error TypeError RangeError SyntaxError ReferenceError Reflect Proxy Intl RegExp Function
    setTimeout setInterval setImmediate clearTimeout clearInterval clearImmediate queueMicrotask
    structuredClone process console Buffer globalThis performance AbortController AbortSignal URL
    URLSearchParams TextEncoder TextDecoder EventTarget Event fetch crypto isFinite isNaN parseInt
    parseFloat Infinity NaN undefined require module exports __dirname __filename'''.split())
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


_REGEX_AFTER_WORDS = {'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
                      'else', 'yield', 'await'}
_REGEX_AFTER_CHARS = set('(,=:[!&|?{};+-*%<>~^')


def scan_js(text):
    """A light JS lexer, enough to tell CODE from strings, comments, template text and regex literals, and to
    count bracket depth at the top level. Per 1-based line i:
        depth[i]  the top-level ({[ depth at the line's start (None if the line starts inside a string,
                  comment, template text or regex)
        toks[i]   [(identifier, preceded_by_dot, next two chars after any spaces, column)] for identifiers in CODE
        code[i]   the line with every non-code character blanked (keys and keywords stay readable)
    ok is False when the file does not close cleanly (depth != 0 or a literal left open at EOF): the caller
    fails closed."""
    lines = text.split('\n')
    depth, toks, code = [None], [[]], ['']
    # frames: ('code', depth) or ('tmpl',). The bottom frame is the top-level code.
    frames = [['code', 0]]
    state = None          # None (in the top frame kind), 'line', 'block', "'", '"', 'regex', 'regex_class'
    prev_sig, prev_word = '', ''
    ok = True
    for line in lines:
        f = frames[-1]
        at_code = state is None and f[0] == 'code'
        depth.append(frames[0][1] if (at_code and len(frames) == 1) else None)
        lt, buf = [], []
        i, n = 0, len(line)
        while i < n:
            c = line[i]
            f = frames[-1]
            if state == 'block':
                if line.startswith('*/', i):
                    state = None; buf.append('  '); i += 2; continue
                buf.append(' '); i += 1; continue
            if state in ("'", '"'):
                if c == '\\':
                    buf.append('  '); i += 2; continue
                if c == state:
                    state = None; prev_sig = 'x'; prev_word = ''
                buf.append(' '); i += 1; continue
            if state == 'regex' or state == 'regex_class':
                if c == '\\':
                    buf.append('  '); i += 2; continue
                if state == 'regex_class':
                    if c == ']':
                        state = 'regex'
                elif c == '[':
                    state = 'regex_class'
                elif c == '/':
                    state = None; prev_sig = 'x'; prev_word = ''
                    i += 1
                    while i < n and (line[i].isalnum()):   # flags
                        buf.append(' '); i += 1
                    buf.append(' '); continue
                buf.append(' '); i += 1; continue
            if f[0] == 'tmpl':
                if c == '\\':
                    buf.append('  '); i += 2; continue
                if c == '`':
                    frames.pop(); prev_sig = 'x'; prev_word = ''
                    buf.append(' '); i += 1; continue
                if line.startswith('${', i):
                    frames.append(['code', 0]); prev_sig = '{'; prev_word = ''
                    buf.append('  '); i += 2; continue
                buf.append(' '); i += 1; continue
            # ---- code
            if line.startswith('//', i):
                buf.append(' ' * (n - i)); break
            if line.startswith('/*', i):
                state = 'block'; buf.append('  '); i += 2; continue
            if c in ("'", '"'):
                state = c; buf.append(' '); i += 1; continue
            if c == '`':
                frames.append(['tmpl']); buf.append(' '); i += 1; continue
            if c == '/':
                if prev_sig == '' or prev_sig in _REGEX_AFTER_CHARS or prev_word in _REGEX_AFTER_WORDS:
                    state = 'regex'; buf.append(' '); i += 1; continue
                prev_sig, prev_word = '/', ''; buf.append(c); i += 1; continue
            if c.isalpha() or c in '_$':
                j = i
                while j < n and (line[j].isalnum() or line[j] in '_$'):
                    j += 1
                word = line[i:j]
                k = j
                while k < n and line[k] == ' ':
                    k += 1
                nxt = line[k:k + 2]
                dot = prev_sig == '.'
                lt.append((word, dot, nxt, i))
                buf.append(word)
                prev_sig, prev_word = 'w', word
                i = j; continue
            if c.isdigit():
                j = i
                while j < n and (line[j].isalnum() or line[j] in '._'):
                    j += 1
                buf.append(line[i:j]); prev_sig, prev_word = '0', ''; i = j; continue
            if c in '{([':
                f[1] += 1
            elif c in '})]':
                if c == '}' and f[1] == 0 and len(frames) > 1:
                    frames.pop()          # the end of a ${ } inside a template
                    buf.append(' '); i += 1; continue
                f[1] -= 1
                if f[1] < 0:
                    ok = False
            if not c.isspace():
                prev_sig, prev_word = c, ''
            buf.append(c); i += 1
        if state in ("'", '"', 'regex', 'regex_class') and not line.endswith('\\'):
            # A quoted string or a regex literal cannot span lines in JS: if the lexer thinks one does, it has
            # desynchronised (e.g. a regex it read as division). Fail closed: the caller treats the file as protected.
            ok = False
            state = None
        toks.append(lt)
        code.append(''.join(buf))
    if state is not None or len(frames) != 1 or frames[0][1] != 0:
        ok = False
    return ok, depth, toks, code


def table_rows(text, lexed=None):
    """rows[i] = the identifiers naming 1-based line i's ROW of a top-level object-literal table, or None
    outside any row; tables[i] = the table's name for every line from its header to its closing brace
    (None elsewhere). A row starts at a 2-space-indented key and runs through the deeper-indented lines
    after it; a blank, a comment, or anything at indent <= 2 that is not a key ends it. Every key on a
    line (any indent, several per line) and every `run:` target joins the row's names -- so a duplicate
    key at an odd indent, which JS lets override the earlier row, is seen."""
    _ok, _depth, _toks, code = lexed if lexed is not None else scan_js(text)
    lines = text.split('\n')
    row_of, names, cur, table, tab_of = [None], [], None, None, [None]
    for n, line in enumerate(lines, 1):
        if table is None:
            m = _TABLE.match(line)
            if m:
                table = _DECL.match(line).group(1)
            row_of.append(None)
            tab_of.append(table)
            cur = None
            continue
        tab_of.append(table)
        if line.startswith('}'):
            table, cur = None, None
            row_of.append(None)
            continue
        ccode = code[n] if n < len(code) else line
        m = _ROW_KEY.match(line)
        if m:
            names.append({m.group(2)})
            cur = len(names) - 1
        elif not ccode.strip() or not line.startswith('   '):
            cur = None
        keys = {k for _q, k in _ANY_KEY.findall(line)} | set(_RUN.findall(line))
        if cur is not None:
            names[cur].update(keys)
            row_of.append(cur)
        elif keys and ccode.strip():
            names.append(keys)        # a key outside any 2-space row (column 0, odd indent): its own row
            row_of.append(len(names) - 1)
        else:
            row_of.append(None)
    rows = [None if r is None else names[r] for r in row_of]
    return rows, tab_of


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
    """One side of one file, read once: its lines, lexer view, declaration owners and table rows."""

    def __init__(self, text):
        self.lines = [''] + text.split('\n')
        self.owners = decl_owners(text)
        self.lex_ok, self.depth, self.toks, self.code = scan_js(text)
        self.rows, self.tables = table_rows(text, (self.lex_ok, self.depth, self.toks, self.code))
        self.headers = {}
        for n in range(1, len(self.lines)):
            m = _DECL.match(self.lines[n])
            if m:
                self.headers.setdefault(m.group(1), []).append(n)
        self._words, self._ptab, self._by_owner = {}, {}, None

    def owner(self, n):
        return self.owners[n] if 0 <= n < len(self.owners) else self.owners[-1]

    def row(self, n):
        return self.rows[n] if 0 <= n < len(self.rows) else None

    def table(self, n):
        return self.tables[n] if 0 <= n < len(self.tables) else None

    def tokens(self, n):
        return self.toks[n] if 0 <= n < len(self.toks) else []

    def code_of(self, n):
        return self.code[n] if 0 <= n < len(self.code) else ''

    def import_stmt(self, n):
        """The whole import statement holding line n (lines are IMPORTS-owned)."""
        lo = n
        while lo > 1 and self.owners[lo - 1] == IMPORTS and not _IMPORT.match(self.lines[lo]):
            lo -= 1
        hi = n
        while hi + 1 < len(self.owners) and self.owners[hi + 1] == IMPORTS and not _IMPORT.match(self.lines[hi + 1]):
            hi += 1
        return '\n'.join(self.lines[lo:hi + 1])

    def decls(self, sym):
        """Names of the top-level declarations matching `sym`."""
        return {nm for nm in self.headers if glob_match(nm, sym)}

    def words_in(self, sym):
        """Identifiers used in CODE inside the declarations matching `sym` (cached)."""
        if self._by_owner is None:
            self._by_owner = {}
            for i in range(1, min(len(self.owners), len(self.lines))):
                o = self.owners[i]
                if o and o != IMPORTS:   # code identifiers only: not comments, strings or `.property` names
                    self._by_owner.setdefault(o, set()).update(t[0] for t in self.tokens(i) if not t[1])
        if sym not in self._words:
            w = set()
            for o, ws in self._by_owner.items():
                if glob_match(o, sym):
                    w |= ws
            self._words[sym] = w
        return self._words[sym]

    def protected_tables(self, sym):
        """Names of the tables holding a row that names `sym`."""
        if sym not in self._ptab:
            ns = _norm(sym)
            self._ptab[sym] = {self.tables[i] for i in range(1, len(self.rows))
                               if self.rows[i] and any(glob_match(_norm(x), ns) for x in self.rows[i])}
        return self._ptab[sym]


_FILES = {}


def _file_for(text):
    """One _File per distinct text (a 16k-line file lexes once per process, not once per call)."""
    key = (len(text), hash(text))
    f = _FILES.get(key)
    if f is None:
        if len(_FILES) > 64:
            _FILES.clear()
        f = _FILES[key] = _File(text)
    return f


_ASSIGN = re.compile(r'(?<![=!<>])=(?![=>])')
_KEYWORDS = frozenset('''break case catch class const continue debugger default delete do else export extends finally
    for function if import in instanceof let new return super switch this throw try typeof var void while with yield
    await async of static get set true false null'''.split())


def _binds(toks, k, code_line):
    """Is token k of a line in a BINDING position? The left-hand side of a const/let/var on the line (up to
    its first `=`, or `of` / `in` in a for head), the name right after `function`/`class`, an assignment target (`x =`, `x +=`), or a
    line that is only a binding list (`  Date,` inside a multi-line destructuring or import)."""
    w, _dot, nxt, col = toks[k]
    for j in range(k - 1, -1, -1):
        bw, _bd, _bn, bcol = toks[j]
        if bw in ('const', 'let', 'var'):
            m = _ASSIGN.search(code_line, bcol)
            end = m.start() if m else len(code_line)
            for t in toks[j + 1:]:          # `for (const x of xs)`: the left-hand side ends at of / in
                if t[0] in ('of', 'in') and t[3] < end:
                    end = t[3]
                    break
            if col < end:
                return True
            break
    if k and toks[k - 1][0] in ('function', 'class'):
        return True
    if nxt.startswith('=') and not nxt.startswith('==') and not nxt.startswith('=>'):
        return True
    if len(nxt) >= 2 and nxt[1] == '=' and nxt[0] in '+-*/%&|^?':
        return True
    return bool(_BINDING_LIST.match(code_line)) and not any(t[0] in _KEYWORDS for t in toks)


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
                files[(side, path)] = None if text is None else _file_for(text)
            return files[(side, path)]

        sides = (('old', ch.get('old_path'), ch.get('old_lines') or set(), ch.get('old_anchors') or set()),
                 ('new', ch.get('new_path'), ch.get('new_lines') or set(), ch.get('new_anchors') or set()))
        for side, path, lines, anchors in sides:
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
                if side == 'new' and not f.lex_ok:
                    add(f'{path}::{sym} (structure unreadable: the lexer cannot close the file)', tier)
                other = get('old' if side == 'new' else 'new', ch.get('new_path' if side == 'old' else 'old_path')) \
                    if ch.get('new_path' if side == 'old' else 'old_path') else None
                names = f.decls(sym) | (other.decls(sym) if other else set())
                tables = f.protected_tables(sym) | (other.protected_tables(sym) if other else set())
                gwords = (f.words_in(sym) | (other.words_in(sym) if other else set())) & GLOBALS
                ns = _norm(sym)
                for n in sorted(lines):
                    o = f.owner(n)
                    if o == IMPORTS:
                        stmt = f.import_stmt(n)
                        b = import_bindings(stmt)
                        if b is None:
                            add(f'{path}::{IMPORTS} (unreadable import, line {n})', tier)
                        elif not b and _SIDE_EFFECT_IMPORT.match(stmt.strip()):
                            add(f'{path}::{IMPORTS} (side-effect import)', tier)
                        else:
                            if side == 'old':
                                used = sorted(b & f.words_in(sym))
                                if used:
                                    add(f'{path}::{IMPORTS} (binds {", ".join(used)}, used in {sym})', tier)
                            for gname in sorted(b & gwords):
                                add(f'{path}::{IMPORTS} (binds the global {gname}, used in {sym})', tier)
                        continue
                    if o and glob_match(o, sym):
                        add(f'{path}::{o}', tier)
                    r = f.row(n)
                    if r and any(glob_match(_norm(x), ns) for x in r):
                        add(f'{path}::{f.table(n) or o} row naming {sym}', tier)
                    code_line = f.code_of(n)
                    if f.table(n) in tables and code_line.strip() and not r:
                        add(f'{path}::{f.table(n)} (protected table structure, line {n})', tier)
                    toks = f.tokens(n)
                    for k, (w, dot, nxt, _col) in enumerate(toks):
                        if dot:
                            continue
                        if w in names and not (o and glob_match(o, sym)) and _binds(toks, k, code_line):
                            add(f'{path}::{w} (rebound outside its declaration, line {n})', tier)
                        if w in tables and f.table(n) != w:
                            add(f'{path}::{w} (protected table named, line {n})', tier)
                        if w in gwords and _binds(toks, k, code_line):
                            add(f'{path}::{sym} (binds the global {w} it uses, line {n})', tier)
                for n in sorted(anchors - lines):   # anchors attribute regions only: not imports, not rows
                    o = f.owner(n)
                    if o and o != IMPORTS and glob_match(o, sym):
                        add(f'{path}::{o}', tier)
        old_p, new_p = ch.get('old_path'), ch.get('new_path')
        if old_p and new_p and ch.get('hunks') and read:
            for g, sym, tier in patterns:
                if sym is None or not glob_match(old_p, g):
                    continue
                fo, fn = get('old', old_p), get('new', new_p)
                if fo is None or fn is None:
                    continue
                # A NEW COLUMN-0 DECLARATION INSIDE AN OLD PROTECTED REGION: named for the reader (the anchors
                # above already make it a hit; this says why).
                for a, b, c, d in ch['hunks']:
                    for k in range(c, c + d):
                        m = _DECL.match(fn.lines[k]) if 0 < k < len(fn.lines) else None
                        if not m:
                            continue
                        for o in {fo.owner(x) for x in (a, a + 1)}:
                            if o and o != IMPORTS and glob_match(o, sym):
                                add(f'{old_p}::{o} (new declaration {m.group(1)} inserted inside it)', tier)
                # STILL TOP-LEVEL: a protected declaration wrapped in a new scope by unprotected lines around it
                if fn.lex_ok:
                    for nm in fo.decls(sym):
                        for k in fn.headers.get(nm, []):
                            if fn.depth[k] != 0:
                                add(f'{new_p}::{nm} (no longer a top-level declaration, line {k})', tier)
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
