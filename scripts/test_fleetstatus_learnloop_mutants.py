#!/usr/bin/env python3
"""Mutants for fleetstatus.learnloop_line (the M1 archive's header line): each anchor must occur exactly once (comment lines
stripped and raw), and scripts/test_fleetstatus.py, run against the mutated copy (FLEETSTATUS_SRC), must fail on the
test the mutant was written against.

    python3 scripts/test_fleetstatus_learnloop_mutants.py      (exit 1 if any mutant survives or misses its anchor)
"""
import os
import re
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, 'scripts/host/fleetstatus.py')
MUT = [
    ('stale ignored', "if age > LEARNLOOP_STALE:", "if False:", 'learnloop_stale_run_is_an_alarm'),
    ('status ignored', "if st != 'ok':", "if False:", 'learnloop_every_bad_status_is_an_alarm'),
    ('missing file reads healthy', "return f'!! learning-loop archive (M1): NO HEARTBEAT",
     "return f'learning-loop archive (M1): NO HEARTBEAT", 'learnloop_missing_heartbeat_is_an_alarm_not_silence'),
    ('due day ignored', "if not newest or newest < due:", "if not newest:", 'learnloop_behind_when_the_due_day_is_missing'),
    ('grace dropped', "due = (now - LEARNLOOP_READY - LEARNLOOP_GRACE).date().isoformat()",
     "due = (now - LEARNLOOP_READY).date().isoformat()", 'learnloop_behind_when_the_due_day_is_missing'),
    ('failed controls ignored', "if rec and not rec.get('controls_ok'):", "if False:",
     'learnloop_failed_controls_and_unarchived_days_are_alarms'),
    ('unarchived run ignored', "        if not r.get('archived'):\n", "        if False:\n",
     'learnloop_failed_controls_and_unarchived_days_are_alarms'),
    ('at risk ignored', "if hb.get('at_risk'):", "if False:", 'learnloop_failed_controls_and_unarchived_days_are_alarms'),
    ('nas ignored', "if nas.get('newest') != newest or (nas.get('sealed') or 0) < (hb.get('archived_days') or 0):",
     "if False:", 'learnloop_nas_disagreement_is_an_alarm'),
    ('never-raises dropped', "        return _learnloop_line(now, p)\n    except Exception as e:",
     "        return _learnloop_line(now, p)\n    except OSError as e:", 'learnloop_malformed_heartbeat_never_raises'),
    ('older unresolved ignored', "    for u in (hb.get('unresolved') or [])[:4]:", "    for u in []:",
     'learnloop_older_unresolved_days_are_alarms'),
    ('not in header', "    if rep.get('learnloop'):\n        print(rep['learnloop'])\n", "", 'learnloop_line_is_in_the_header'),
]


def main():
    src = open(SRC).read()
    code = '\n'.join('' if ln.lstrip().startswith('#') else ln for ln in src.split('\n'))
    bad = 0
    for name, old, new, want in MUT:
        if code.count(old) != 1 or src.count(old) != 1:
            print(f'ANCHOR {name}: stripped {code.count(old)}, raw {src.count(old)} (must be 1 and 1)')
            bad += 1
            continue
        with tempfile.TemporaryDirectory() as td:
            with open(os.path.join(td, 'fleetstatus.py'), 'w') as fh:
                fh.write(src.replace(old, new))
            r = subprocess.run([sys.executable, 'scripts/test_fleetstatus.py'], cwd=REPO, capture_output=True, text=True,
                               env=dict(os.environ, FLEETSTATUS_SRC=td))
            failed = re.findall(r'FAIL\s+([^\s:]+)', r.stdout)
            print(f'{"KILLED " if want in failed else "SURVIVED"} {name}: failed={failed}')
            bad += want not in failed
    print(f'{len(MUT) - bad} of {len(MUT)} mutants killed by their intended test')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
