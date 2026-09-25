#!/usr/bin/env python3
"""v30: refuse a canary whose last registered read minute is not strictly inside its deadline.

Exit 0 = the schedule can be read. Non-zero with a reason on stderr = refuse to launch.

MEASURED 2026-09-25 on drop5-01: read_minutes [30,90,180,360] with deadline_min 360. The loop's
deadline test lives inside its read loop, so it arrived at the +360 read at 362 min elapsed, fired
containment, and recorded INCONCLUSIVE -- no drop5read-360.json, no immobiledid-360.json, primary
never evaluated, while exposure (101 vs a floor of 60), linkage and safety were all clean.

A read is a FULL WALK, not an instant: the +180 read landed 7 min after its minute. So `deadline >
last` alone still races the walk, and the grace margin is ~4x the largest observed lag. The deadline
exists to contain a HUNG loop, not to clip a working one, so 30 min costs nothing.
"""
import json, os, sys

if len(sys.argv) < 3:
    sys.exit("usage: v30check.py <registration.json> <deadline_min>")

reg = json.load(open(sys.argv[1]))
dl = int(sys.argv[2])
rm = [int(x) for x in (reg.get('read_minutes') or [])]
# HOLE 1: THE EXTENSION'S READS ARE READS. `read_minutes` is not the schedule -- canary-loop.sh
# also runs `extension.extra_reads` when `until_exposure` is set, and verdict.py's own final_M
# takes the max of BOTH. Measured 2026-09-25: digwatch-01 and digwatch-02 declare
# read_minutes [30,90,180,360] with deadline_min 420 -- which passes a read_minutes-only check --
# and extra_reads [540]. That read sits 120 min PAST the deadline and can never be taken. It has
# not bitten only because digwatch-02 happened to conclude at +360.
_ext = reg.get('extension') or {}
if _ext.get('until_exposure'):
    rm += [int(x) for x in (_ext.get('extra_reads') or [])]
# HOLE 2: THE GRACE MUST SCALE WITH THE NUMBER OF READS. Each registered read script gets up to
# 900 s and they run SEQUENTIALLY (canary-loop.sh), so a registration with R reads can spend
# R x 15 min on its final read alone. A fixed 30 min is right for two reads and wrong for four.
_nreads = max(1, len(reg.get('reads') or []))
grace = max(int(os.environ.get('VERDICT_READ_GRACE_MIN', '30')), 15 * _nreads)

# No reads or no deadline is not this guard's business: verdict.py defaults the deadline to 780 when
# unset, and a registration with no reads is caught by the immobiledid rule. Firing here would flag
# every replay fixture and train the reader to ignore the line.
if not rm:
    sys.exit(0)

last = max(rm)
_sched = 'read_minutes + extension.extra_reads' if _ext.get('until_exposure') else 'read_minutes'
if dl <= last:
    sys.exit("REFUSING TO LAUNCH (v30): deadline_min %d <= last read minute %d -- the loop would "
             "reach that read AFTER the deadline and record INCONCLUSIVE with the read never taken "
             "(drop5-01, 2026-09-25). Schedule read from %s; %d read script(s) x 15 min each. Set deadline_min >= %d." % (dl, last, _sched, _nreads, last + grace))
if dl < last + grace:
    sys.exit("REFUSING TO LAUNCH (v30): deadline_min %d is inside the %d min read grace of last read "
             "minute %d; a full walk has landed up to 7 min late. Set deadline_min >= %d."
             % (dl, grace, last, last + grace))
sys.exit(0)
