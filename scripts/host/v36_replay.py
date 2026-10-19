#!/usr/bin/env python3
"""v36_replay.py <installed verdict.py> <staged verdict.py> <staged rules> [max_cases] [min_same]  -- READ-ONLY.
A positive control.

Gate v36 (canary tiers) claims that a registration WITHOUT a tier reads exactly as before. This replays the recorded
evidence of past canaries (~/digest/reads/<run>-<read>-<M>.json for every registered read, registrations from
~/mcai-analysis/registrations) through BOTH verdict.py copies with --dryrun, each against a COPY of the reads dir
(dryrun still writes its artifact) and its own rules record, and requires the verdict LINE to be identical, byte for
byte. Also asserts that no replayed registration carries a tier (so this is the tier-3 path) and that it replayed
something (a zero is a query bug). Exit 0 = identical on every case.

KNOWN, PRE-EXISTING: the INSTALLED gate raises in --dryrun when a read has >= 2 canary deaths (the death gate's
randomization reaches _control_scan, whose ALLBOTS/cut are only defined outside a dry run). Such a case cannot be
replayed. It is counted as BOTH-CRASH only when BOTH copies exit non-zero with EXACTLY that error -- final line
`NameError: name 'ALLBOTS' is not defined`, raised under `_control_scan` (round 7, Codex: matching error text alone does
not establish the known failure); any other missing verdict, on either side, is a FAIL. A crash is never a match (round 5, Codex): the run must also compare at least
`min_same` (default 30) real verdict lines, all SAME."""
import glob, json, os, shutil, subprocess, sys, tempfile

inst, staged, staged_rules = sys.argv[1:4]
cap = int(sys.argv[4]) if len(sys.argv) > 4 else 60
min_same = int(sys.argv[5]) if len(sys.argv) > 5 else 30
KNOWN_DRYRUN_ERROR = "NameError: name 'ALLBOTS' is not defined"
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
diff = 0; nsame = 0; both = 0
for run, M, reads in cases:
    outs = []; errl = []
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
        known = (p.returncode != 0 and ((p.stderr or '').strip().splitlines() or [''])[-1] == KNOWN_DRYRUN_ERROR
                 and 'in _control_scan' in (p.stderr or ''))
        errl.append(known if outs[-1] is None else False)
        shutil.rmtree(d, ignore_errors=True)
    if outs == [None, None] and errl[0] and errl[1]:
        both += 1
        print('BOTH-CRASH %s +%d  (pre-existing --dryrun limitation: %s under _control_scan, both copies)' % (run, M, KNOWN_DRYRUN_ERROR))
        continue
    if None in outs:
        diff += 1
        print('FAIL %s +%d  no verdict line from %s: %s' % (run, M, 'installed' if outs[0] is None else 'staged', errs))
        continue
    same = outs[0] == outs[1]
    diff += 0 if same else 1
    nsame += 1 if same else 0
    print('%s %s +%d  %s' % ('SAME' if same else 'DIFF', run, M, outs[0][:110]))
    if not same:
        print('   installed: %s\n   staged:    %s' % (outs[0][:400], outs[1][:400]))
print('REPLAY %d cases: %d SAME, %d different, %d both-crash (unreplayable, identical error)' % (len(cases), nsame, diff, both))
if diff == 0 and nsame < min_same:
    print('REPLAY REFUSED: only %d real verdict lines compared (< %d): not a positive control' % (nsame, min_same))
sys.exit(0 if diff == 0 and nsame >= min_same else 1)
