#!/usr/bin/env python3
"""bagband3.py <an.pkl> <val.pkl>  -- (c)'s null bands for a THREE-pool bag fix read at +1920 (32 h POST vs 32 h PRE).

Runs ugsafe2_gaterule2.py's part A UNCHANGED (its source, executed up to the line where part B starts), so the shipped
4 pools x 24 h bands must come out again first: NET_P025 -3.21, IRON_P025 -0.127 (the positive control; a mismatch
exits 1). Then the same null24() at 3 pools x 32 h with the same seed, and 3 x 24 / 4 x 32 for context.
Run where ugsafe2_gaterule2.py ran (~/bagfix-work): python3 bagband3.py ~/ugsafe2/an.pkl val4.pkl"""
import os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, 'ugsafe2_gaterule2.py')).read()
CUT = '\ntot_d = sum(len(R.dwin(w)) for w in R.WIN)'
assert SRC.count(CUT) == 1, 'ANCHOR: part B start not found once in ugsafe2_gaterule2.py'
g = {'__name__': 'ugsafe2_gaterule2_partA', '__file__': os.path.join(HERE, 'ugsafe2_gaterule2.py')}
exec(compile(SRC.split(CUT)[0], 'ugsafe2_gaterule2.py(part A)', 'exec'), g)
q = g['q']
ok = abs(g['VTHR'] - (-3.21)) < 0.005 and abs(g['ITHR'] - (-0.127)) < 0.0005
print('POSITIVE CONTROL 4 pools x 24 h: net p2.5 %+.2f (shipped -3.21), iron p2.5 %+.3f (shipped -0.127): %s'
      % (g['VTHR'], g['ITHR'], 'REPRODUCED' if ok else 'MISMATCH'))
if not ok:
    sys.exit(1)
for npools, hours in ((3, 32), (3, 24), (4, 32)):
    random.seed(12)
    NL = g['null24'](npools=npools, hours=hours)
    nv = [x[0] for x in NL]; ni = [x[1] for x in NL]
    print('%d pools x %d h: n=%d draws  net p2.5 %+.2f p50 %+.2f p97.5 %+.2f | iron p2.5 %+.3f p50 %+.3f p97.5 %+.3f'
          % (npools, hours, len(NL), q(nv, .025), q(nv, .5), q(nv, .975), q(ni, .025), q(ni, .5), q(ni, .975)), flush=True)
