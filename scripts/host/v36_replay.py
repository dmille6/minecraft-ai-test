#!/usr/bin/env python3
"""v36_replay.py <installed verdict.py> <staged verdict.py> <staged rules> [max_cases]  -- READ-ONLY positive control.

Gate v36 (canary tiers) claims that a registration WITHOUT a tier reads exactly as before. This replays the recorded
evidence of past canaries (~/digest/reads/<run>-<read>-<M>.json for every registered read, registrations from
~/mcai-analysis/registrations) through BOTH verdict.py copies with --dryrun, each against a COPY of the reads dir
(dryrun still writes its artifact) and its own rules record, and requires the verdict LINE to be identical, byte for
byte. Also asserts that no replayed registration carries a tier (so this is the tier-3 path) and that it replayed
something (a zero is a query bug). Exit 0 = identical on every case."""
import glob, json, os, shutil, subprocess, sys, tempfile

inst, staged, staged_rules = sys.argv[1:4]
cap = int(sys.argv[4]) if len(sys.argv) > 4 else 60
H = os.path.expanduser('~')
REGS = os.path.join(H, 'mcai-analysis', 'registrations')
READS = os.path.join(H, 'digest', 'reads')
live_rules = os.path.join(H, 'digest', 'RULES-IN-FORCE.md')
cases = []
for rp in sorted(glob.glob(os.path.join(REGS, '*.json')), key=os.path.getmtime, reverse=True):
    run = os.path.basename(rp)[:-5]
    try:
        reg = json.load(open(rp))
    except Exception:
        continue
    if 'tier' in reg:
        print('SKIP %s: carries a tier' % run); continue
    reads = reg.get('reads') or []
    mins = reg.get('read_minutes') or []
    for M in mins:
        if reads and all(os.path.exists(os.path.join(READS, '%s-%s-%d.json' % (run, r, M))) for r in reads):
            cases.append((run, M, reads))
    if len(cases) >= cap:
        break
if not cases:
    print('REPLAY FOUND NOTHING: zero cases is a query bug, not a pass'); sys.exit(2)
diff = 0
for run, M, reads in cases:
    outs = []
    for vp, rules in ((inst, live_rules), (staged, staged_rules)):
        d = tempfile.mkdtemp(prefix='v36replay-')
        for r in reads:
            shutil.copy(os.path.join(READS, '%s-%s-%d.json' % (run, r, M)), d)
        env = dict(os.environ, VERDICT_READS_DIR=d, VERDICT_RULES=rules)
        env.pop('VERDICT_MODULE_DIR', None)
        p = subprocess.run([sys.executable, vp, run, str(M), '--dryrun'], capture_output=True, text=True, env=env, timeout=300)
        line = ((p.stdout or '').strip().splitlines() or [''])[-1]
        # A CRASH IS NOT A MATCH (round 5, Codex): two empty outputs with the same exit code would compare equal
        outs.append(line if (p.returncode == 0 and line.startswith('VERDICT ')) else None)
        errs = (p.stderr or '')[-300:]
        shutil.rmtree(d, ignore_errors=True)
    if None in outs:
        diff += 1
        print('FAIL %s +%d  no verdict line from %s: %s' % (run, M, 'installed' if outs[0] is None else 'staged', errs))
        continue
    same = outs[0] == outs[1]
    diff += 0 if same else 1
    print('%s %s +%d  %s' % ('SAME' if same else 'DIFF', run, M, outs[0][:110]))
    if not same:
        print('   installed: %s\n   staged:    %s' % (outs[0][:400], outs[1][:400]))
print('REPLAY %d cases, %d different' % (len(cases), diff))
sys.exit(0 if diff == 0 else 1)
