#!/usr/bin/env python3
"""stage-bagfix-regs.py stages ONE commit: in a throwaway repo, commit A then B; staging --rev A must stage A's content and
record A, never B's (round 4, Codex), and plain staging refuses a dirty tree and untracked files. Plus a mutant: the script
reading symbolic HEAD instead of the resolved sha must fail the first case."""
import os, sys, subprocess, tempfile, shutil, json
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'host', 'stage-bagfix-regs.py')
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print(('PASS' if ok else 'FAIL') + '  ' + n + ('' if ok else '\n        -> ' + str(d)[-400:]))


def g(repo, *a):
    return subprocess.run(['git', '-C', repo] + list(a), capture_output=True, text=True, check=True).stdout.strip()


def cases(script):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    repo = tempfile.mkdtemp(prefix='stagetest-')
    os.makedirs(os.path.join(repo, 'docs', 'reports')); os.makedirs(os.path.join(repo, 'scripts', 'host'))
    shutil.copy(script, os.path.join(repo, 'scripts', 'host', 'stage-bagfix-regs.py'))
    for f in ('bagread.py', 'install-bagfix-regs.py'):
        open(os.path.join(repo, 'scripts', 'host', f), 'w').write('# %s\n' % f)
    reg = os.path.join(repo, 'docs', 'reports', 'gridfix-01.92bc84f.json')
    g(repo, 'init', '-q'); g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't')
    json.dump({'revision': 'A'}, open(reg, 'w')); g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'A')
    A = g(repo, 'rev-parse', 'HEAD')
    json.dump({'revision': 'B'}, open(reg, 'w')); g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'B')
    out_dir = os.path.join(repo, 'out')
    run = lambda *a: subprocess.run([sys.executable, os.path.join(repo, 'scripts', 'host', 'stage-bagfix-regs.py'), out_dir] + list(a),
                                    capture_output=True, text=True)
    p = run('--rev', A)
    staged = json.load(open(os.path.join(out_dir, 'gridfix-01.92bc84f.json'))) if p.returncode == 0 else {}
    c('--rev A stages A\'s content and records A, though HEAD is B', p.returncode == 0 and staged.get('revision') == 'A'
      and open(os.path.join(out_dir, 'STAGED-FROM.txt')).read().strip() == A, (p.stdout + p.stderr, staged))
    p = run()
    staged = json.load(open(os.path.join(out_dir, 'gridfix-01.92bc84f.json'))) if p.returncode == 0 else {}
    c('plain staging on a clean tree stages HEAD (B), BASE-MD5 lists both committed versions', p.returncode == 0 and staged.get('revision') == 'B'
      and len(open(os.path.join(out_dir, 'BASE-MD5.txt')).read().split('\n')) >= 3, p.stdout + p.stderr)
    json.dump({'revision': 'dirty'}, open(reg, 'w'))
    p = run()
    c('a dirty registration is refused', p.returncode != 0 and 'commit first' in (p.stdout + p.stderr), p.stdout + p.stderr)
    g(repo, 'checkout', '-q', '--', 'docs/reports')
    open(os.path.join(repo, 'docs', 'reports', 'stonecap-01.abc1234.json'), 'w').write('{}')
    p = run()
    c('an untracked registration is refused', p.returncode != 0 and 'untracked' in (p.stdout + p.stderr), p.stdout + p.stderr)
    shutil.rmtree(repo, ignore_errors=True)
    return out


if __name__ == '__main__':
    for n, ok, d in cases(SRC):
        t(n, ok, d)
    src = open(SRC).read()
    old = "show = lambda path: git('show', SHA + ':' + path, text=False)"
    assert src.count(old) == 1, 'ANCHOR'
    md = tempfile.mkdtemp(); mp = os.path.join(md, 'stage-bagfix-regs.py')
    open(mp, 'w').write(src.replace(old, "show = lambda path: git('show', 'HEAD:' + path, text=False)", 1))
    ctl = cases(SRC)
    res = cases(mp)
    t('mutant killed: staging reads symbolic HEAD (after an unmutated control passes)', all(ok for _n, ok, _d in ctl)
      and not all(ok for _n, ok, _d in res), 'SURVIVED')
    print('\n%d/%d pass' % (sum(T), len(T)))
    sys.exit(0 if all(T) else 1)
