#!/usr/bin/env python3
"""hr_one_mutant.py <dir with test_heavyread.py + heavyread.sh> <mutant name> -- section A of test_heavyread on the
unmutated heavyread.sh and on ONE mutant (by name), for a quick targeted check. The full suite is test_heavyread.py."""
import importlib.util, os, shutil, sys, tempfile
D, NAME = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location('thr', os.path.join(D, 'test_heavyread.py'))
M = importlib.util.module_from_spec(spec); spec.loader.exec_module(M)
tmp = tempfile.mkdtemp(prefix='hr1-')
res = M.section_a(os.path.join(D, 'heavyread.sh'), tmp)
bad = [n for n, ok, _d in res if not ok]
print('unmutated section A: %d/%d pass%s' % (len(res) - len(bad), len(res), ('; FAIL: ' + '; '.join(bad)) if bad else ''))
mut = [m for m in M.MUTANTS if m[1] == NAME]
assert len(mut) == 1, 'no such mutant'
f, _n, old, new = mut[0]
src = open(os.path.join(D, f)).read(); assert src.count(old) == 1
md = tempfile.mkdtemp(dir=tmp); mp = os.path.join(md, 'heavyread.sh'); open(mp, 'w').write(src.replace(old, new, 1))
r2 = M.section_a(mp, tmp)
killed = [n for n, ok, _d in r2 if not ok]
print('mutant "%s": %s by %s' % (NAME, 'KILLED' if killed else 'SURVIVED', killed[:3]))
r3 = M.section_a(os.path.join(D, 'heavyread.sh'), tmp)          # no contamination: the unmutated file passes again
bad3 = [n for n, ok, _d in r3 if not ok]
print('unmutated section A AFTER the mutant: %d/%d pass%s' % (len(r3) - len(bad3), len(r3), ('; FAIL: ' + '; '.join(bad3)) if bad3 else ''))
shutil.rmtree(tmp, ignore_errors=True)
