#!/usr/bin/env python3
"""Mutants for fleetstatus.frontier_line (E0's header line): each anchor must occur exactly once (comment lines
stripped and raw), and scripts/test_fleetstatus.py, run against the mutated copy (FLEETSTATUS_SRC), must fail on the
test the mutant was written against.

    python3 scripts/test_fleetstatus_frontier_mutants.py      (exit 1 if any mutant survives or misses its anchor)
"""
import os
import re
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, 'scripts/host/fleetstatus.py')
MUT = [
    ('stale ignored', "if age > FRONTIER_STALE:", "if False:", 'frontier_stale_tick_is_an_alarm'),
    ('void quiet', "elif st == 'void':", "elif False:", 'frontier_void_reads_void_never_zero'),
    ('behind ignored', "elif lag > FRONTIER_BEHIND:", "elif False:", 'frontier_error_instrument_behind_and_towns_are_alarms'),
    ('missing file reads healthy', "return f'!! frontier census (E0): NO HEARTBEAT", "return f'frontier census (E0): NO HEARTBEAT",
     'frontier_missing_heartbeat_is_an_alarm_not_silence'),
    ('towns ignored', "if hb.get('home_problems'):", "if False:", 'frontier_error_instrument_behind_and_towns_are_alarms'),
    ('never-raises dropped', "        return _frontier_line(now, p)\n    except Exception as e:",
     "        return _frontier_line(now, p)\n    except OSError as e:", 'frontier_malformed_heartbeat_never_raises'),
    ('not staging ignored', "if not ls or now - _ts(ls) > FRONTIER_NOT_STAGING:", "if False:",
     'frontier_warm_census_that_stops_staging_or_publishing_alarms'),
    ('publisher status ignored', "or lp.get('status') != 'ok':", ":", 'frontier_warm_census_that_stops_staging_or_publishing_alarms'),
    ('rehearsal ignored', "if (hb.get('last_publish') or {}).get('unusable'):", "if False:",
     'frontier_error_instrument_behind_and_towns_are_alarms'),
    ('silent warm-up publisher ignored', "    if not wu.get('complete'):              # the publisher must be alive",
     "    if False:              # the publisher must be alive", 'frontier_publisher_silent_during_warmup_alarms'),
    ('warm-up publisher age from now', "if not lp.get('at') or at - _ts(lp['at']) > FRONTIER_PUBLISHER or lp.get('status') not in ('warmup', 'ok') \\",
     "if not lp.get('at') or now - _ts(lp['at']) > FRONTIER_PUBLISHER or lp.get('status') not in ('warmup', 'ok') \\",
     'frontier_publisher_age_is_judged_against_the_tick_that_carried_it'),
    ('warm publisher age from now', "if not lp.get('at') or at - _ts(lp['at']) > FRONTIER_PUBLISHER or lp.get('status') != 'ok':",
     "if not lp.get('at') or now - _ts(lp['at']) > FRONTIER_PUBLISHER or lp.get('status') != 'ok':",
     'frontier_publisher_age_is_judged_against_the_tick_that_carried_it'),
    ('not in header', "    if rep.get('frontier'):\n        print(rep['frontier'])\n", "", 'frontier_line_is_in_the_header'),
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
