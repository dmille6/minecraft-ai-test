#!/usr/bin/env python3
"""test_patch_drawrec.py <drawrec.sh> -- behaviour of the fail-closed exposure patch, on the REAL drawrec.sh's Python
block run against a fixture: the block's /tmp/drawrec.txt input is rewritten to a fixture file and HOME points at a
fixture tree holding a stub drawexposure.py and a registration. Nothing live is read or written."""
import os, sys, re, json, shutil, subprocess, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import patch_drawrec_exposure as PD

SRC = open(sys.argv[1] if len(sys.argv) > 1 else '/home/mike/mcai-analysis/drawrec.sh').read()
TXT = """board-a 5080 bots 5 items/bh 60.0
board-b 5080 bots 5 items/bh 61.0
hive-a 5080 bots 5 items/bh 59.0
hive-b 5080 bots 5 items/bh 60.5
5080-half median items/bh: 60.0
  board-a   livelock 9 climbs 30 immobile>=30m 0
  board-b   livelock 9 climbs 30 immobile>=30m 0
  hive-a    livelock 9 climbs 30 immobile>=30m 0
  hive-b    livelock 9 climbs 30 immobile>=30m 0
=== LEDGER
=== MANIFEST
{"canary_pool": null}
"""
T = []


def t(name, ok, detail=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', name, '' if ok else '\n        -> ' + str(detail)[-800:]))


def run_block(src, mode, declared):
    d = tempfile.mkdtemp(prefix='drawrec-fix-')
    try:
        os.makedirs(os.path.join(d, 'mcai-analysis', 'registrations'))
        reg = {'sha': 'x'}
        if declared:
            reg['draw_exposure'] = {'require': []}
        json.dump(reg, open(os.path.join(d, 'mcai-analysis', 'registrations', 'r1.json'), 'w'))
        open(os.path.join(d, 'mcai-analysis', 'drawexposure.py'), 'w').write(
            'import sys\nm = %r\n' % mode +
            'if m == "ok": print("eligible on exposure: [\'board-a\', \'hive-a\']"); sys.exit(0)\n'
            'if m == "none": print("r1 declares no draw_exposure block"); sys.exit(0)\n'
            'if m == "badexit": print("eligible on exposure: [\'board-a\', \'hive-a\']"); sys.exit(1)\n'
            'raise SystemExit("Traceback: crash")\n')
        txt = os.path.join(d, 'drawrec.txt'); open(txt, 'w').write(TXT)
        py = src.split("python3 - <<'PY'\n", 1)[1].split('\nPY', 1)[0].replace('/tmp/drawrec.txt', txt)
        open(os.path.join(d, 'block.py'), 'w').write(py)
        r = subprocess.run(['python3', os.path.join(d, 'block.py')], capture_output=True, text=True,
                           env=dict(os.environ, HOME=d, DRAW_RUN='r1'))
        return r.stdout + r.stderr
    finally:
        shutil.rmtree(d, ignore_errors=True)


new, what = PD.patch(SRC)
t('patch applies once', what == 'patched')
t('patch is idempotent', PD.patch(new)[1] == 'already patched')
t('TARGET_K line byte-identical', re.findall(r'(?m)^TARGET_K = .*$', SRC) == re.findall(r'(?m)^TARGET_K = .*$', new))
t('bash -n parses', subprocess.run(['bash', '-n', '/dev/stdin'], input=new, text=True).returncode == 0)
# positive controls: the UNPATCHED block shows the fail-open defect, the patched block does not
o = run_block(SRC, 'crash', True)
t('BEFORE: a crash on a declared registration reads as "no requirement" (the defect, reproduced)',
  'no requirement declared' in o and 'DRAW (' in o, o)
o = run_block(new, 'crash', True)
t('AFTER: crash + declared -> REFUSED, no pool eligible', 'REFUSED for r1' in o and 'NONE (fewer than' in o, o)
o = run_block(new, 'badexit', True)
t('AFTER: eligible line with exit 1 -> REFUSED', 'REFUSED for r1' in o, o)
o = run_block(new, 'ok', True)
t('AFTER: declared + answer -> unchanged draw over the eligible pools', "pools able to expose this change: ['board-a', 'hive-a']" in o and 'DRAW (2 pools' in o, o)
o = run_block(new, 'none', False)
t('AFTER: undeclared -> today\'s behaviour (v8 filter only)', 'no requirement declared' in o and 'DRAW (' in o, o)
o = run_block(new, 'crash', False)
t('AFTER: undeclared + crash -> today\'s behaviour', 'no requirement declared' in o, o)
print('\n%d/%d pass' % (sum(T), len(T)))
sys.exit(0 if all(T) else 1)
