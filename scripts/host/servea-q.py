#!/usr/bin/env python3
"""servea-q.py -- serving A (OWNER 11-02): ONE read-only JSON snapshot for the servea waiter (scripts/host/servea-waiter.sh,
which runs on the Mac because only the Mac can reach the 5080 as root). Runs on the canary host. Changes nothing.

    servea-q.py [--queue Q] [--journal J] [--sched S]

Prints {"entries": [{run, state, held}], "busy": bool, "decision": str, "head_ready": {run: bool},
        "journal": {run: [[phase, note], ...]}, "ab": {...}, "model_dropins": n, "roll": {...}}.
`head_ready[run]` is True when every entry BEFORE run is terminal (done/cancelled/abandoned) and run itself is `ready`:
the scheduler's next launch would be run once its hold is released (it never skips the head, so anything else
ahead, held or not, means not yet).
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys

H = os.path.expanduser('~')
TERMINAL = ('done', 'cancelled', 'abandoned')
RUNS = ('servea-01', 'llmoai-01')
LINE = re.compile(r'^(\S+)\s+(\S+)\s+(\S+)\s+hold=(\S+)')


def parse_status(text):
    """PURE. canary-sched.py status text -> (entries, busy, decision line)."""
    ents, dec = [], ''
    for l in text.splitlines():
        if l.startswith('DECISION:'):
            dec = l.strip()
            continue
        m = LINE.match(l)
        if m:                       # ANY state: an unknown one is not terminal, so it blocks head_ready (fail closed)
            ents.append({'run': m.group(1), 'state': m.group(2), 'held': m.group(4) != 'None'})
    return ents, dec.startswith('DECISION: busy') or not dec, dec


def head_ready(ents, run):
    """PURE. True when every entry before `run` is terminal and `run` is ready."""
    for e in ents:
        if e['run'] == run:
            return e['state'] == 'ready'
        if e['state'] not in TERMINAL:
            return False
    return False


def journal_of(path, runs):
    out = {r: [] for r in runs}
    try:
        with open(path, 'rb') as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if r.get('run') in out:
                    out[r['run']].append([r.get('phase'), str(r.get('note') or '')[:300]])
    except OSError:
        pass
    return out


def jload(p):
    try:
        return json.load(open(p))
    except Exception:
        return None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--journal', default=os.path.join(H, 'canary-journal.jsonl'))
    ap.add_argument('--sched', default=os.path.join(H, 'canary-sched.py'))
    a = ap.parse_args(argv)
    try:
        st = subprocess.run(['python3', a.sched, 'status'], capture_output=True, text=True, timeout=180).stdout
    except Exception as e:
        print(json.dumps({'error': 'status failed: %s' % e}))
        return 1
    ents, busy, dec = parse_status(st)
    ab = jload(os.path.join(H, 'qwen35-rollout', 'state.json')) or {}
    roll = jload(os.path.join(H, 'servea-rollout', 'state', 'state.json')) or {}
    print(json.dumps({
        'entries': ents, 'busy': busy, 'decision': dec[:300],
        'head_ready': {r: head_ready(ents, r) for r in RUNS},
        'journal': journal_of(a.journal, RUNS + ('servea-roll',)),
        'ab': {'run': ab.get('run'), 'status': ab.get('status'), 'experiment': ab.get('experiment'),
               'started': ab.get('started')},
        'model_dropins': len(glob.glob('/etc/systemd/system/mcbot@*.service.d/05-model.conf')),
        'roll': {'status': roll.get('status'), 'stages': [[s.get('status'), len(s.get('pools') or [])] for s in roll.get('stages') or []],
                 'pid_alive': bool(roll.get('pid')) and os.path.exists('/proc/%s' % roll.get('pid'))},
        'installed': os.path.exists(os.path.join(H, 'servea', 'installed-aa5d5130')),
    }))
    return 0


if __name__ == '__main__':
    sys.exit(main())
