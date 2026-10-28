#!/usr/bin/env python3
"""
DOES THIS DIFF TOUCH PROTECTED PATHS? (fun mode, docs/PROCESS-fun-mode.md § Tiers; OWNER 2026-10-28)

The one decider for tier 3. The showcase gate and the canary loop both call it; neither should
re-implement the match. Stdlib only, so it can be copied to a host that has no checkout.

The list is config/protected-paths.txt:
    <glob>                    every line of every matching file
    <glob>::<function glob>   only lines inside those top-level declarations of that file

Pure parts (tested in scripts/test_protected.py): parse_patterns, glob_match, decl_owners/decl_at,
parse_diff, hits. The CLI wraps them in git:

    python3 scripts/lib/protected.py                       # origin/main...HEAD
    python3 scripts/lib/protected.py --base A --head B
    python3 scripts/lib/protected.py --files a.mjs b.py    # path-only; a `::` entry counts as hit
    exit 0 = not protected, 1 = protected (hits printed), 2 = could not decide

Exit 2 is never "not protected": a gate that cannot run this must treat the change as tier 3.
"""
import argparse
import os
import re
import subprocess
import sys

DEFAULT_LIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                            'config', 'protected-paths.txt')

# A top-level declaration starts at column 0. Nested functions are indented in this codebase,
# so column 0 is the boundary of the region a changed line belongs to.
_DECL = re.compile(r'^(?:export\s+(?:default\s+)?)?(?:async\s+)?'
                   r'(?:function\s*\*?\s*|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)')


def parse_patterns(text):
    """[(path_glob, symbol_glob_or_None)] from the list file's text. Comments and blanks skipped."""
    out = []
    for raw in text.splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        if '::' in line:
            p, s = line.split('::', 1)
            out.append((p.strip(), s.strip() or None))
        else:
            out.append((line, None))
    return out


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
    the first). One pass, so a 16k-line file costs one scan, not one per changed line."""
    owners, name = [None], None
    for line in text.splitlines():
        m = _DECL.match(line)
        if m:
            name = m.group(1)
        owners.append(name)
    return owners


def decl_at(text, line_no):
    """Name of the top-level declaration whose region holds 1-based line_no, or None above the first."""
    owners = decl_owners(text)
    return owners[min(line_no, len(owners) - 1)]


_HUNK = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def parse_diff(diff_text):
    """Changes from a `git diff -U0` text: [{old_path, new_path, old_lines, new_lines}].
    A path is None on the side where the file does not exist (added / deleted)."""
    changes, cur = [], None
    for line in diff_text.splitlines():
        if line.startswith('diff --git '):
            cur = {'old_path': None, 'new_path': None, 'old_lines': set(), 'new_lines': set()}
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
    return changes


def hits(changes, patterns, read=None):
    """Sorted list of human-readable hits. `read(side, path)` returns that file's text on side
    'old' or 'new' (None if unknown); with no reader, or no text, a `::` entry on a matching
    path counts as a hit -- unknown is protected, never the reverse."""
    found = set()
    for ch in changes:
        for side, path, lines in (('old', ch.get('old_path'), ch.get('old_lines') or set()),
                                  ('new', ch.get('new_path'), ch.get('new_lines') or set())):
            if not path:
                continue
            text, names = None, None
            for g, sym in patterns:
                if not glob_match(path, g):
                    continue
                if sym is None:
                    found.add(path)
                    continue
                if names is None:
                    text = read(side, path) if read else None
                    owners = None if text is None else decl_owners(text)
                    names = None if owners is None else {owners[min(n, len(owners) - 1)] for n in lines}
                if names is None:
                    found.add(f'{path}::{sym} (function not checked)')
                    continue
                for n in names:
                    if n and glob_match(n, sym):
                        found.add(f'{path}::{n}')
    return sorted(found)


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
        print('PROTECTED (tier 3):')
        for x in h:
            print('  ' + x)
        return 1
    print('not protected')
    return 0


if __name__ == '__main__':
    sys.exit(main())
