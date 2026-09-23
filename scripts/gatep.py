# gatep.py [post-min] -- the in-window randomization p-value for a canary's own window.
# CANARY_DRYRUN=pool:sha:iso for dry runs, exactly like the other reads.
#
# WHY A NEW READ RATHER THAN A CHANGE TO AN EXISTING ONE. MEASURED 2026-09-23 on real single-build
# telemetry across 400 draws per direction, where there is NO treatment effect so every rejection
# is a false positive:
#
#   direction                        typed/transferred threshold    in-window randomization
#   calibrate early -> read late      0.0%  (CI 0.0-1.0%)           5.5%  (p=0.645 vs nominal)
#   calibrate late  -> read early     12.8%  (CI 9.8-16.4%)         4.0%  (p=0.422)
#   nominal                           5%                            5%
#
# The typed threshold is not biased by a fixed factor -- it is UNSTABLE, swinging 0.0% to 12.8% on
# nothing but which window calibrated which, both CIs excluding nominal in opposite directions. The
# randomization rule is indistinguishable from nominal in both directions and its p-values are
# uniform (medians 0.50 and 0.55), which is the signature that matters.
#
# This is additive and opt-in: a registration adds "gatep" to its `reads` and gets the honest p
# ALONGSIDE whatever typed lines it already has. No existing read changes behaviour, no existing
# verdict changes, and the two numbers can be compared on the same canary before anyone decides to
# trust one over the other. That sequencing is deliberate -- CLAUDE.md requires a gate be
# calibrated before it can revert, and this is how the calibration gets collected in the field.
#
# WHAT IT DOES NOT DO. It measures the THRESHOLD half only. beta (CUPED) must still come from a
# DISJOINT window; the threshold must come from this one. Conflating those was the original defect.
# It also cannot see treatment spillover: bots in one world share chests and merge learned rules,
# so for a shared-resource change a within-world contrast estimates the wrong quantity however
# exact its p-value is.
import sys, json, os, datetime as dt
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from collections import Counter
from lib.telemetry import Events
from lib.arms import arm_of, pool_of
from lib.exposure import Spans
from lib import cuped

man = json.load(open('/srv/mcbots/trial-manifest.json')); ovr = os.environ.get('CANARY_DRYRUN')
if ovr: CAN, CV, ISO = ovr.split(':', 2); CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else: CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc); elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
PRE = 180; W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)

ev = Events.load(since_minutes=int(elapsed + PRE) + 20)
items = {'pre': Counter(), 'post': Counter()}
runs = {'pre': Counter(), 'post': Counter()}
spans = {'pre': Spans(), 'post': Spans()}
for r in ev.rows:
    b = (r['bot'] or {}).get('name', '')
    if not b or b.startswith('isolated') or b.startswith('self-'): continue
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W: continue
    era = 'post' if d >= 0 else 'pre'
    spans[era].add(b, b, r['t'])
    runs[era][b] += 1
    dd = (r['raw'].get('skill') or {}).get('inventory_delta') or {}
    g = sum(v for v in dd.values() if v > 0)
    if g: items[era][b] += g

def rates(src, era):
    out = {}
    for b in spans[era].groups():
        h = spans[era].hours(b, allow_zero=True)
        if h > 0.05: out[b] = src[era][b] / h
    return out

def block(name, era, src, lo, hi):
    return cuped.Block(name, lo, hi, rates(src, era))

lo_pre, hi_pre = CUT - dt.timedelta(minutes=PRE), CUT
lo_post, hi_post = CUT, CUT + dt.timedelta(minutes=W)

fields = {}
print(f"canary_pool={CAN} cutoff={CUT:%H:%M:%S}Z  pre {PRE} / post {W:.0f} min -- IN-WINDOW RANDOMIZATION p")
for label, src in (('items', items), ('runs', runs)):
    pre_b = block(f'{label}_pre', 'pre', src, lo_pre, hi_pre)
    post_b = block(f'{label}_post', 'post', src, lo_post, hi_post)
    common = sorted(set(pre_b.rates) & set(post_b.rates))
    treat = [b for b in common if arm_of(b, CANS) == 'canary']
    ctrl = [b for b in common if b not in set(treat)]
    worlds = len({pool_of(b) for b in common})
    # POSITIVE CONTROL before any p is believed: a p computed over too few assignments, or with an
    # empty arm, is arithmetic rather than evidence.
    if len(treat) < 3 or len(ctrl) < 10 or worlds < 6:
        print(f"  {label:6s} NOT READABLE: treat {len(treat)}, control {len(ctrl)}, worlds {worlds}")
        fields[f'{label}_randomization_p'] = None
        continue
    try:
        p, n, realised = cuped.in_window_p(pre_b, post_b, treat, ctrl, pool_of)
    except Exception as e:
        print(f"  {label:6s} NOT READABLE: {type(e).__name__}: {e}")
        fields[f'{label}_randomization_p'] = None
        continue
    import math
    print(f"  {label:6s} DiD(log) {realised:+.4f} = {100*(math.exp(realised)-1):+.1f}%   "
          f"p = {p:.4f} over {n} same-shape assignments   "
          f"(treat {len(treat)} / control {len(ctrl)} bots, {worlds} worlds; smallest attainable p {1/n:.4f})")
    fields[f'{label}_did_log'] = realised
    fields[f'{label}_did_pct'] = 100 * (math.exp(realised) - 1)
    fields[f'{label}_randomization_p'] = p
    fields[f'{label}_p_assignments'] = n

print(f"positive control: rows {len(ev.rows)}, bots pre {len(spans['pre'].groups())} post {len(spans['post'].groups())}")
fields['positive_control_rows'] = len(ev.rows)
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('gatep', W, fields)
except Exception as _e: print('VERDICT_JSON failed:', _e)
