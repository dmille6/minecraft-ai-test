#!/usr/bin/env python3
"""stage-bagfix-regs.py <out-dir> [--rev <commit>]  -- build the staging directory install-bagfix-regs.py runs from, at ONE
commit: every <run>.<base>.json of the bag-fix runs, bagread.py, the installer, and BASE-MD5.txt -- the md5 of EVERY
version of each registration ever committed up to that commit (git log), which lets the installer replace a host copy
staged from an older commit while refusing content main never had. Then:
    scp -r <out-dir> mike@10.0.0.31:/home/mike/bagfix-regs
Every file is read from the commit (git show <sha>:path), never from the filesystem; the commit is resolved ONCE and that
sha is used for every git read and recorded in STAGED-FROM.txt (round 4, Codex). Without --rev it is HEAD, and the tree
must be clean (no changes, no untracked files under docs/reports or scripts/host)."""
import subprocess, hashlib, os, shutil, sys
WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = sys.argv[1]
REV = sys.argv[sys.argv.index('--rev') + 1] if '--rev' in sys.argv else 'HEAD'
RUNS = ('toolhygiene-01', 'peacefulkit-01', 'junkwell-02', 'gridfix-01', 'stonecap-01')   # bamboo-01, bamboocraft-01: ordinary canaries (operator + Codex 10-08)


def git(*args, text=True):
    return subprocess.run(['git'] + list(args), cwd=WT, capture_output=True, text=text, check=True).stdout


SHA = git('rev-parse', '--verify', REV + '^{commit}').strip()
if REV == 'HEAD':
    if subprocess.run(['git', 'diff', '--quiet', SHA, '--', 'docs/reports', 'scripts/host'], cwd=WT).returncode != 0:
        sys.exit('refusing: docs/reports or scripts/host differ from HEAD -- commit first')
    _untracked = git('ls-files', '--others', '--exclude-standard', '--', 'docs/reports', 'scripts/host').split()
    if _untracked:
        sys.exit('refusing: untracked files under docs/reports or scripts/host (%s) -- commit or remove them' % ', '.join(_untracked[:5]))
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
show = lambda path: git('show', SHA + ':' + path, text=False)
base = []
for f in sorted(git('ls-tree', '--name-only', SHA, 'docs/reports/').split()):
    n = os.path.basename(f)
    if n.endswith('.json') and n.rsplit('.', 2)[0] in RUNS and len(n.split('.')) == 3:
        open(os.path.join(OUT, n), 'wb').write(show('docs/reports/' + n))
        for sha in git('log', '--format=%H', SHA, '--', 'docs/reports/' + n).split():
            old = subprocess.run(['git', 'show', '%s:docs/reports/%s' % (sha, n)], cwd=WT, capture_output=True).stdout
            if old:
                base.append('%s %s' % (n, hashlib.md5(old).hexdigest()))
for f in ('scripts/host/bagread.py', 'scripts/host/install-bagfix-regs.py'):
    open(os.path.join(OUT, os.path.basename(f)), 'wb').write(show(f))
open(os.path.join(OUT, 'BASE-MD5.txt'), 'w').write('\n'.join(base) + '\n')
open(os.path.join(OUT, 'STAGED-FROM.txt'), 'w').write(SHA + '\n')
print(len(os.listdir(OUT)), 'files staged in', OUT, 'from', SHA)
