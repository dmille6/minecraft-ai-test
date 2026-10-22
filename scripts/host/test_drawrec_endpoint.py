#!/usr/bin/env python3
"""test_drawrec_endpoint.py <drawrec.sh> [<old drawrec.sh>] -- the draw's endpoint lines (10-22) on the REAL drawrec.sh Python
block run against a fixture, as test_patch_drawrec.py and test_drawrequire.py do: /tmp/drawrec.txt is rewritten to a fixture
file, HOME points at a fixture tree (a stub drawsteady.py), DRAWREC_ENV_DIR at fixture env files. Nothing live is read or
written. The pick is parsed by the LOOP'S OWN pipeline, cut from canary-loop.sh, on the last four lines exactly as the loop
reads them.

With <old drawrec.sh> (the installer passes the LIVE copy) it also proves byte-compatibility: with the same seeded RNG, the old
and new outputs are identical except the three endpoint lines, the DRAW line is byte-identical, and the number of lines after
it is the same. Mutants on copies (anchors asserted present and unique) after the unmutated cases pass."""
import os, re, sys, json, shutil, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
NEW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'drawrec.sh')
OLD = sys.argv[2] if len(sys.argv) > 2 else None
LOOP = next(p for p in (os.path.join(HERE, 'canary-loop.sh'), os.path.expanduser('~/canary-loop.sh')) if os.path.exists(p))
T = []
POOLS = {'board-a': 60.0, 'board-b': 61.0, 'board-c': 59.5, 'board-d': 60.2, 'hive-a': 59.0, 'hive-b': 60.5, 'hive-c': 61.5,
         'hive-d': 60.3, 'placebo-a': 60.1, 'placebo-c': 60.0, 'isolated-a': 60.0}
BOTS = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo']
A72, A16 = 'http://10.0.0.72:11434', 'http://10.0.0.16:11434'
E72, E16 = A72, A16          # the printed (normalized) form


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-900:]))


def txt(label_d='3090', pools=POOLS):
    # the band table carries poolrank2.py's STATIC half label; the fixture can make it disagree with the env either way
    L = ['%s %s bots 5 items/bh %.1f' % (p, label_d if p.endswith('-d') else '5080', v) for p, v in pools.items()]
    L.append('5080-half median items/bh: 60.0')
    L += ['  %s   livelock 9 climbs 30 immobile>=30m 0' % p for p in pools]
    L += ['=== LEDGER', '=== MANIFEST', json.dumps({'canary_pool': None})]
    return '\n'.join(L) + '\n'


def envs(d, first=lambda pool, bot: A72 + ',' + A16, extra=None):
    os.makedirs(d, exist_ok=True)
    for p in POOLS:
        for b in BOTS:
            v = first(p, b)
            open(os.path.join(d, '%s-%s.env' % (p, b)), 'w').write('BOT_NAME=%s-%s\nOLLAMA_BASE_URL=%s\n%s' % (
                p, b, A72, '' if v is None else 'OLLAMA_BASE_URLS=%s\n' % v))
    for name, body in (extra or {}).items():
        open(os.path.join(d, name), 'w').write(body)


def loop_pipeline():
    m = re.search(r'P=\$\(echo "\$D" \| grep -o "DRAW \(\.\*owner C\): \\\[\.\*\\\]"[^\n]*?paste -sd, -\)', open(LOOP).read())
    assert m, "the loop's pick pipeline was not found in " + LOOP
    return m.group(0)


PIPE = loop_pipeline()


def run(src, env_setup=None, label_d='3090', seed=None, pools=POOLS):
    d = tempfile.mkdtemp(prefix='drawrec-ep-')
    try:
        os.makedirs(os.path.join(d, 'mcai-analysis')); os.makedirs(os.path.join(d, 'digest'))
        open(os.path.join(d, 'mcai-analysis', 'drawsteady.py'), 'w').write('print("STEADY RELEASE []")\n')
        tf = os.path.join(d, 'drawrec.txt'); open(tf, 'w').write(txt(label_d, pools))
        ed = os.path.join(d, 'env')
        if env_setup:
            env_setup(ed)
        py = src.split("python3 - <<'PY'\n", 1)[1].split('\nPY', 1)[0].replace('/tmp/drawrec.txt', tf)
        if seed is not None:       # the same draw from both copies: a seeded RNG in place of SystemRandom
            py = 'import random as _R, secrets as _S\n_S.SystemRandom = lambda: _R.Random(%d)\n' % seed + py
        open(os.path.join(d, 'block.py'), 'w').write(py)
        r = subprocess.run([sys.executable, os.path.join(d, 'block.py')], capture_output=True, text=True,
                           env=dict(os.environ, HOME=d, DRAW_RUN='', DRAWREC_ENV_DIR=ed), timeout=120)
        out = r.stdout + r.stderr
        tail4 = '\n'.join(out.strip().splitlines()[-4:])      # the loop reads `2>&1 | tail -4`
        p = subprocess.run(['bash', '-c', 'D=$(cat); ' + PIPE + '; echo "$P"'], input=tail4, capture_output=True, text=True).stdout.strip()
        return (p.split(',') if p else []), out
    finally:
        shutil.rmtree(d, ignore_errors=True)


def line(out, prefix):
    return next((l for l in out.splitlines() if l.startswith(prefix)), '')


def drawn(out):
    l = line(out, 'drawn endpoints:')
    import ast
    return ast.literal_eval(l.split(':', 1)[1].strip()) if l else None


def cases(src):
    res = []
    c = lambda n, ok, d='': res.append((n, bool(ok), d))
    # A. today's fleet: every bot .72 first, .16 fallback; the band table still labels -d pools 3090
    P, o = run(src, envs)
    mix = line(o, 'endpoint mix on offer:')
    c('A all on .72 (band label still 3090): no covariate instructed, the true mix printed',
      "{'http://10.0.0.72:11434': " in mix and 'every pool (11) asks http://10.0.0.72:11434 first: no endpoint covariate to record' in mix
      and 'RECORD' not in o and 'half mix' not in o, o)
    c('A the drawn endpoints are the env\'s, and the loop\'s own pipeline parses the same 4 pools', len(P) == 4
      and drawn(o) == {p: E72 for p in P}, (P, o))
    c('A the eligible line names the endpoint, not the static half', "'http://10.0.0.72:11434', " in line(o, 'eligible') and "'3090'" not in line(o, 'eligible'), o)
    # B. the -d pools on .16 first (the fleet before 10-21 13:42Z) while the band table says 5080 for them
    P, o = run(src, lambda d: envs(d, lambda p, b: (A16 + ',' + A72) if p.endswith('-d') else A72 + ',' + A16), label_d='5080')
    mix = line(o, 'endpoint mix on offer:')
    c('B two endpoints: the covariate IS instructed, with the fleet mix from the env (not the 5080 label)',
      'RECORD THE FIRST ENDPOINT OF EACH DRAWN POOL AS A READ COVARIATE' in mix and "{'http://10.0.0.16:11434': 2, 'http://10.0.0.72:11434': 9}" in mix, o)
    dd = drawn(o) or {}
    c('B each drawn pool carries its own first endpoint', dd and all(v == (E16 if p.endswith('-d') else E72) for p, v in dd.items()), o)
    # C. one bot of hive-b disagrees
    P, o = run(src, lambda d: envs(d, lambda p, b: A16 if (p, b) == ('hive-b', 'Comet') else A72))
    c('C a pool whose bots disagree is mixed, and the covariate is instructed',
      "'mixed:http://10.0.0.16:11434+http://10.0.0.72:11434'" in line(o, 'eligible') and 'RECORD THE FIRST ENDPOINT' in o, o)
    # D. no env dir at all: unknown, the covariate is instructed (fail toward recording), the draw is untouched
    P, o = run(src, None)
    c('D env unreadable: every pool unknown, the covariate instructed, and the draw still happens (DRAW parsed)',
      'unknown:FileNotFoundError' in o and 'RECORD THE FIRST ENDPOINT' in o and len(P) == 4, (P, o))
    # E. the config.mjs resolution: empty OLLAMA_BASE_URLS -> OLLAMA_BASE_URL; quotes, export, a trailing slash, last
    #    assignment wins; .env.bak-* backups and ._ junk are not bots
    def e_env(d):
        envs(d, lambda p, b: '', extra={'hive-b-Comet.env.bak-dmove-20261021T1338Z': 'OLLAMA_BASE_URLS=%s\n' % A16, 'hive-b-Comet.env.bak': 'OLLAMA_BASE_URLS=%s\n' % A16,
                                         '._hive-b-Comet.env': 'OLLAMA_BASE_URLS=%s\n' % A16})
        open(os.path.join(d, 'hive-c-Alpha.env'), 'w').write('OLLAMA_BASE_URLS=%s\nexport OLLAMA_BASE_URLS="%s/ , %s"\n' % (A16, A72, A16))
    P, o = run(src, e_env)
    c('E fallback, quoting, export, last-wins, backups and junk ignored: one endpoint, no covariate',
      'every pool (11) asks http://10.0.0.72:11434 first' in o, o)
    # G. (Codex r1) two services on ONE host are two endpoints
    P, o = run(src, lambda d: envs(d, lambda p, b: 'http://10.0.0.72:11435' if p == 'hive-a' else 'HTTP://10.0.0.72:11434/'))
    c('G same host, different port: the covariate is instructed; scheme/case/slash normalized',
      'RECORD THE FIRST ENDPOINT' in o and "'http://10.0.0.72:11435'" in line(o, 'eligible') and "'http://10.0.0.72:11434'" in line(o, 'eligible'), o)
    # H. (Codex r1) a pool with four env files is not five bots agreeing
    def h_env(d):
        envs(d); os.remove(os.path.join(d, 'board-b-Echo.env'))
    P, o = run(src, h_env)
    c('H a missing bot env makes the pool unknown, and the covariate is instructed', "'unknown:4-of-5-env'" in line(o, 'eligible')
      and 'RECORD THE FIRST ENDPOINT' in o, o)
    # I. (Codex r1) systemd joins a trailing-backslash line; an unbalanced quote is unknown, never guessed
    def i_env(d):
        envs(d)
        open(os.path.join(d, 'hive-a-Alpha.env'), 'w').write('OLLAMA_BASE_URLS=http://10.0.0.\\\n72:11434,http://10.0.0.16:11434\n')
    P, o = run(src, i_env)
    c('I a continuation line is joined as systemd joins it', 'every pool (11) asks http://10.0.0.72:11434 first' in o, o)
    def q_env(d):
        envs(d)
        open(os.path.join(d, 'hive-a-Alpha.env'), 'w').write('OLLAMA_BASE_URLS="http://10.0.0.16:11434\n')
    P, o = run(src, q_env)
    c('I an unbalanced quote is unknown (mixed with the others), never a guessed endpoint',
      "mixed:http://10.0.0.72:11434+unknown:ValueError" in line(o, 'eligible') and 'RECORD THE FIRST ENDPOINT' in o, o)
    # J. (Claude r1 P3-10) an empty OLLAMA_BASE_URL present and no _URLS: the bot has NO endpoint, not studio.lan
    def j_env(d):
        envs(d)
        open(os.path.join(d, 'hive-a-Alpha.env'), 'w').write('OLLAMA_BASE_URL=\nOLLAMA_BASE_URLS=\n')
    P, o = run(src, j_env)
    c('J empty URL and URLS: unknown:empty, as config.mjs gives [] (never the studio.lan default)',
      'unknown:empty' in line(o, 'eligible') and 'studio.lan' not in o, o)
    # F. no pick: the DRAW none line is still the last line and parses to nothing
    P, o = run(src, envs, pools={'board-a': 60.0})
    c('F no pick: DRAW none is parsed as nothing, endpoint lines still printed', P == [] and 'DRAW (none, owner C)' in o
      and 'endpoint mix on offer:' in o, (P, o))
    return res


for n, ok, d in cases(open(NEW).read()):
    t(n, ok, d)

if OLD:
    old, new = open(OLD).read(), open(NEW).read()
    for env_setup, name in ((envs, 'all .72'), (lambda d: envs(d, lambda p, b: (A16 + ',' + A72) if p.endswith('-d') else A72), '-d on .16')):
        Po, oo = run(old, env_setup, seed=7); Pn, on = run(new, env_setup, seed=7)
        lo, ln = oo.strip().splitlines(), on.strip().splitlines()
        changed = ('eligible ', 'half mix on offer:', 'endpoint mix on offer:', 'drawn halves:', 'drawn endpoints:')
        keep = lambda L: [l for l in L if not l.startswith(changed)]
        do = next(i for i, l in enumerate(lo) if l.startswith('DRAW (')); dn = next(i for i, l in enumerate(ln) if l.startswith('DRAW ('))
        t('COMPAT (%s): same seed -> the same pick through the loop pipeline, DRAW line byte-identical' % name,
          Po == Pn and lo[do] == ln[dn] and len(Po) == 4, (Po, Pn, lo[do], ln[dn]))
        t('COMPAT (%s): every other line identical, same line count, same lines after DRAW' % name,
          keep(lo) == keep(ln) and len(lo) == len(ln) and len(lo) - do == len(ln) - dn, '\n'.join(lo) + '\n----\n' + '\n'.join(ln))
    t('COMPAT: the old copy really printed the stale covariate (positive control)', 'RECORD THE HALF OF EACH DRAWN POOL' in run(old, envs)[1])

if all(T):
    MUT = [
        ('the LAST endpoint read instead of the first', '    _u = _us(_first[0])\n', '    _u = _us(_first[-1])\n'),
        ('hostname only (the port dropped)', "    return '%s://%s:%s%s' % (_u.scheme.lower(), _u.hostname.lower(), _port, _u.path.rstrip('/'))\n",
         "    return _u.hostname\n"),
        ('any number of env files taken as the pool', '    if len(_fs) != POOL_BOTS:\n', '    if not _fs:\n'),
        ('no continuation join', "        if _ln.rstrip().endswith('\\\\'):\n            _acc += _ln.rstrip()[:-1]; continue\n", ''),
        ('every fleet called single-endpoint', "if len(_fleet_eps) == 1 and not _fleet_eps[0].startswith(('unknown:', 'mixed:')):", 'if len(_fleet_eps) >= 1:'),
        ('an unreadable env treated as one endpoint', " and not _fleet_eps[0].startswith(('unknown:', 'mixed:')):", ':'),
        ('backup env files counted as bots', " and f.endswith('.env')\n", '\n'),
    ]
    base = open(NEW).read()
    for name, a, b in MUT:
        ok = base.count(a) == 1
        t('MUTANT anchor present and unique: %s' % name, ok, base.count(a))
        if not ok:
            continue
        res = cases(base.replace(a, b, 1))
        t('MUTANT KILLED: %s' % name, not all(r[1] for r in res), [r[0] for r in res if not r[1]])
print('\n%d/%d pass' % (sum(T), len(T)))
sys.exit(0 if all(T) else 1)
