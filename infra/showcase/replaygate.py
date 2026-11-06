#!/usr/bin/env python3
"""replaygate.py -- THE PRE-ACTIVATION REPLAY, made a mechanical gate of `showcase_ops.py stage` (codeeval 11-06 phase 1 item 4;
docs/reports/phase1-showcase-design-2026-11-06.md). Until 11-06 the showcase release agent did this by hand ("new-kind grep ...
PRE-ACTIVATION REPLAY ..."); the two 11-05 false trips (retired wall cells, kind=cover) are what it is for.

A candidate release is REFUSED when:
  R1 NEW SHAPE   the candidate's bots/src logs a row the reader judges (a kind in the reader's ROW_KINDS) with a field, or an
                 op / kind value, that the release it replaces never logged AND the candidate reader's source never names. The
                 reader has never seen it, so it would judge it by its fallback (off_record / clear_outside ...). Remedy: the
                 reader rule (main's docs/reports/shop-01-2026-10-25/shopread.py.txt, installed with `--reader`), or
                 `--reader-ok 'kind:field=value'` naming why it is no defect.
  R2 NEW DEFECT  the candidate reader, replayed over the live history (the town epoch to now, the same rows the hourly read
                 judges) plus the candidate's own rows (`--rows FILE`, optional: Paper / offline runs), lists a defect item
                 the installed reader does not (multisets: two identical items need two). A defect that DISAPPEARS is fine.
  R3 BROKEN      the candidate reader fails the tripwire's own selftest (a reader that judges nothing cannot pass: the
                 selftest plants an off-record placement, a zone placement and a bag loss), or the replay cannot run.
The gate never touches a bot, the world or /srv/showcase/trip: it copies the trip files into a temp dir per reader.

    replaygate.py shapes --old-src DIR --new-src DIR --reader FILE     (R1 only, local trees; prints the unknown shapes)
    replaygate.py selftest
"""
import argparse, collections, json, os, re, shutil, subprocess, sys, tempfile

LOG_CALL = re.compile(r"\.log\(\s*'(_[a-z0-9_]+)'\s*,\s*\{")
PAIR = re.compile(r"(?:^|[,{\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:'([a-z0-9_]+)'|\"([a-z0-9_]+)\"|`([a-z0-9_]+)`)?")
VALUE_KEYS = ('op', 'kind', 'seg', 'outcome', 'stop', 'phase', 'result', 'role')


def _object_body(text, i):
    """text[i] is just after the '{' of a log object -> the body up to the matching '}' (nested braces, strings skipped). Pure."""
    depth, j, q = 1, i, None
    while j < len(text) and depth:
        c = text[j]
        if q:
            if c == '\\':
                j += 2
                continue
            if c == q:
                q = None
        elif c in '\'"`':
            q = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        j += 1
    return text[i:j - 1]


def _top_level(body):
    """The body with nested {...} / [...] / (...) and template ${...} removed, so only the object's own keys remain. Pure."""
    out, depth, q = [], 0, None
    i = 0
    while i < len(body):
        c = body[i]
        if q:
            if depth == 0:
                out.append(c)
            if c == '\\':
                if depth == 0 and i + 1 < len(body):
                    out.append(body[i + 1])
                i += 2
                continue
            if c == q:
                q = None
        elif c in '\'"`':
            q = c
            if depth == 0:
                out.append(c)
        elif c in '{[(':
            depth += 1
        elif c in '}])':
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(c)
        i += 1
    return ''.join(out)


def shapes(texts, kinds):
    """texts: {file: source}; kinds: the row kinds the reader judges. -> set of shapes: ('kind', row_kind, field) for every
    top-level field of an `e.log('<kind>', { ... })` object, and ('value', row_kind, field, literal) for a literal value of
    op / kind / seg / ... Pure. A computed value (a variable) is not a shape: the reader cannot be checked against it."""
    out = set()
    for _, src in sorted(texts.items()):
        for m in LOG_CALL.finditer(src):
            k = m.group(1)
            if k not in kinds:
                continue
            body = _top_level(_object_body(src, m.end()))
            for pm in PAIR.finditer(body):
                key = pm.group(1)
                val = pm.group(2) or pm.group(3) or pm.group(4)
                out.add(('kind', k, key))
                if val and key in VALUE_KEYS:
                    out.add(('value', k, key, val))
    return out


def shape_str(s):
    return '%s:%s' % (s[1], s[2]) if s[0] == 'kind' else '%s:%s=%s' % (s[1], s[2], s[3])


def reader_names(reader_src, s):
    """Does the reader's source name this shape? A field: the word as a quoted string or 'field=' in a pattern; a value: the
    literal quoted, or 'field=value'. Pure (text only: a name the reader never mentions is a name it cannot judge)."""
    word = s[2] if s[0] == 'kind' else s[3]
    pats = [r"""['"]%s['"]""" % re.escape(word), r'\b%s=' % re.escape(word)]
    if s[0] == 'value':
        pats.append(r'\b%s=%s\b' % (re.escape(s[2]), re.escape(s[3])))
    return any(re.search(p, reader_src) for p in pats)


def unknown_shapes(old_texts, new_texts, reader_src, kinds, ok=()):
    """R1. -> sorted [shape string] logged by the candidate, never by the release it replaces, not named by the candidate
    reader, and not declared in `ok`. Pure."""
    new = shapes(new_texts, kinds) - shapes(old_texts, kinds)
    return sorted(shape_str(s) for s in new if not reader_names(reader_src, s) and shape_str(s) not in set(ok))


def new_defects(installed, candidate):
    """R2. {gate: [item]} x2 -> {gate: [item]} the candidate lists beyond the installed reader (multisets). Pure."""
    out = {}
    for g, items in candidate.items():
        extra = collections.Counter(items) - collections.Counter(installed.get(g) or [])
        if extra:
            out[g] = sorted(extra.elements())
    return out


def admission(unknown, defects, broken):
    """-> (ok, [why]). Pure. Any R1 / R2 / R3 finding refuses; each names its remedy."""
    why = []
    if broken:
        why.append('R3 the candidate reader is broken: %s -- fix it before staging' % broken)
    if unknown:
        why.append('R1 new row shapes the reader never names %s -- add the reader rule (shopread.py.txt on main, stage with '
                   '--reader <file>) or declare each with --reader-ok \'kind:field=value\' and a why' % unknown[:8])
    if defects:
        why.append('R2 the candidate reader lists new defect items over the live history %s -- the reader change would trip '
                   'or report the live showcase; fix the rule' % {g: v[:3] for g, v in defects.items()})
    return not why, why


# ------------------------------------------------------------------------------------------------ the impure side (VM)
def git_texts(repo, sha, prefix='bots/src/'):
    """{path: text} of the *.mjs under prefix at sha (git, read-only)."""
    names = subprocess.run(['git', '-C', repo, 'ls-tree', '-r', '--name-only', sha, prefix], capture_output=True, text=True,
                           check=True).stdout.split()
    out = {}
    for n in names:
        if n.endswith('.mjs'):
            out[n] = subprocess.run(['git', '-C', repo, 'show', '%s:%s' % (sha, n)], capture_output=True, text=True, check=True).stdout
    return out


def reader_kinds(reader_path):
    """The reader's own ROW_KINDS (imported in a child: a broken reader is a reason, never a crash here)."""
    code = ('import importlib.util,importlib.machinery as M,json,sys; l=M.SourceFileLoader("sr",sys.argv[1]); '
            's=importlib.util.spec_from_loader("sr",l); m=importlib.util.module_from_spec(s); l.exec_module(m); '
            'print(json.dumps(sorted(set(m.ROW_KINDS) | set(m.BUILD_KINDS))))')
    p = subprocess.run([sys.executable, '-c', code, reader_path], capture_output=True, text=True, timeout=120,
                       cwd=os.path.dirname(os.path.abspath(reader_path)))
    if p.returncode:
        raise RuntimeError('reader import failed: ' + (p.stderr.strip().splitlines() or ['?'])[-1][:200])
    return set(json.loads(p.stdout))


def trip_dir(trip_home, reader_path):
    """A temp copy of the installed tripwire with `reader_path` as its shopread.py."""
    d = tempfile.mkdtemp(prefix='replaygate-')
    for f in ('showcase_trip.py', 'townplanread.py', 'foundread.py', 'structcount.py'):
        if os.path.exists(os.path.join(trip_home, f)):
            shutil.copy(os.path.join(trip_home, f), d)
    shutil.copytree(os.path.join(trip_home, 'lib'), os.path.join(d, 'lib'), ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy(reader_path, os.path.join(d, 'shopread.py'))
    return d


def run_items(d, extra_rows=None, timeout=900):
    """`showcase_trip.py items` in d -> {gate: [item]} (raises with the tail on failure)."""
    cmd = [sys.executable, '-B', 'showcase_trip.py', 'items'] + (['--extra-rows', extra_rows] if extra_rows else [])
    p = subprocess.run(['nice', '-n', '19'] + cmd, cwd=d, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError('items rc %d: %s' % (p.returncode, (p.stdout + p.stderr).strip()[-300:]))
    return json.loads(p.stdout.strip().splitlines()[-1])['items']


def run_selftest(d):
    p = subprocess.run([sys.executable, '-B', 'showcase_trip.py', 'selftest'], cwd=d, capture_output=True, text=True, timeout=600)
    ok = p.returncode == 0 and 'selftest ok' in p.stdout and 'S6 shop checked' in p.stdout
    return None if ok else 'selftest rc %d: %s' % (p.returncode, (p.stdout + p.stderr).strip()[-200:])


def gate(repo, old_sha, new_sha, installed_reader, candidate_reader, trip_home, extra_rows=None, reader_ok=()):
    """THE GATE (impure: git, child processes). -> (ok, record). record: what was replayed, every finding, the denominators."""
    rec = {'old': old_sha, 'new': new_sha, 'installed_reader': installed_reader, 'candidate_reader': candidate_reader,
           'extra_rows': extra_rows, 'reader_ok': list(reader_ok)}
    dirs = []
    try:
        try:
            kinds = reader_kinds(candidate_reader)
        except Exception as e:
            ok, why = admission([], {}, str(e)[:200])
            return ok, dict(rec, why=why)
        unknown = unknown_shapes(git_texts(repo, old_sha), git_texts(repo, new_sha), open(candidate_reader).read(), kinds, reader_ok)
        dc = trip_dir(trip_home, candidate_reader)
        di = trip_dir(trip_home, installed_reader)
        dirs = [dc, di]
        broken = run_selftest(dc)
        defects, n_items = {}, None
        if not broken:
            try:
                cand = run_items(dc, extra_rows)
                inst = run_items(di, None)
                defects = new_defects(inst, cand)
                n_items = {'installed': sum(len(v) for v in inst.values()), 'candidate': sum(len(v) for v in cand.values())}
            except Exception as e:
                broken = 'the replay could not run: %s' % str(e)[:200]
        ok, why = admission(unknown, defects, broken)
        return ok, dict(rec, unknown=unknown, new_defects=defects, items=n_items, kinds=len(kinds), why=why)
    finally:
        for d in dirs:
            shutil.rmtree(d, ignore_errors=True)


# ------------------------------------------------------------------------------------------------ selftest
def selftest():
    old = {'a.mjs': "e.log('_build', { op: 'place', cell: at, block: name })\ne.log('_other', { op: 'zzz' })\n"}
    new = {'a.mjs': old['a.mjs'] + "e.log('_build', { op: 'clear', cell: at, kind: 'cover', why: `x ${y}` })\n"
                                   "e.log('_build', {\n  op: 'clear',\n  first: 1,\n  meta: { inner: 'nested' },\n  block: n })\n"
                                   "e.log('_other', { op: 'never_judged' })\n"}
    kinds = {'_build'}
    sh = shapes(new, kinds)
    assert ('value', '_build', 'kind', 'cover') in sh and ('kind', '_build', 'first') in sh, sh
    assert ('kind', '_build', 'inner') not in sh, 'a nested object\'s keys are not the row\'s fields'
    assert not any(s[1] == '_other' for s in sh), 'a kind the reader does not judge is not a shape'
    reader = "ROW_KINDS = ('_build',)\nif f.get('op') == 'clear': pass\nWHY = 'why'\n"
    u = unknown_shapes(old, new, reader, kinds)
    assert u == ['_build:first', '_build:kind', '_build:kind=cover', '_build:meta'], u
    assert unknown_shapes(old, new, reader + "K = ('cover', 'kind')\nF = 'first'\nM = 'meta'\n", kinds) == [], 'the reader names them: known'
    assert unknown_shapes(old, new, reader, kinds, ok=('_build:first', '_build:kind', '_build:kind=cover', '_build:meta')) == [], 'declared: known'
    assert unknown_shapes(old, old, reader, kinds) == [], 'no new shape: nothing to judge (control)'
    assert reader_names("rx = re.compile(r'kind=cover')", ('value', '_build', 'kind', 'cover'))
    assert new_defects({'H1': ['a', 'b']}, {'H1': ['a', 'b', 'b'], 'H2': ['c']}) == {'H1': ['b'], 'H2': ['c']}, 'multisets'
    assert new_defects({'H1': ['a', 'b']}, {'H1': ['a']}) == {}, 'a defect that disappears is fine'
    assert new_defects({'H1': ['a']}, {'H1': ['x']}) == {'H1': ['x']}, 'equal counts, a different item: new'
    assert admission([], {}, None) == (True, [])
    assert not admission(['_build:first'], {}, None)[0] and not admission([], {'H1': ['x']}, None)[0]
    assert not admission([], {}, 'selftest rc 1')[0]
    print('replaygate selftest ok')
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('shapes')
    s.add_argument('--old-src', required=True)
    s.add_argument('--new-src', required=True)
    s.add_argument('--reader', required=True)
    sp.add_parser('selftest')
    a = ap.parse_args(argv)
    if a.cmd == 'selftest':
        return selftest()
    rd = lambda d: {f: open(os.path.join(d, f)).read() for f in os.listdir(d) if f.endswith('.mjs')}
    u = unknown_shapes(rd(a.old_src), rd(a.new_src), open(a.reader).read(), reader_kinds(a.reader))
    print(json.dumps(u))
    return 1 if u else 0


if __name__ == '__main__':
    sys.exit(main())
