# vetob2read.py [post-min] -- the veto-feedback (B2) canary's read. Cutoff from the manifest.
# CANARY_DRYRUN=pool:sha:iso for dry runs.
#
# WHAT THIS CANARY CHANGES. Two halves, both aimed at the two biggest veto classes
# measured 2026-09-26 over 12 bots / 18 bot-h / 536 vetoes: repeat_loop 51.3%,
# cooldown 23.1%.
#   1. the prompt gains an OFF-LIMITS line naming what the gate currently refuses
#      (unexpired failed-cooldowns, longest first, capped at 6 entries / 240 chars)
#   2. the rejection the model reads names WHICH proposal was vetoed, args included
#      ("rejected gather block=oak_log: cooldown (...)"), where it said "rejected: cooldown"
#
# WHY THE PRIMARY ENDPOINT COMES FROM JOURNALD. There is NO veto event kind in the
# skill JSONL -- the rejection is `log('warn','decision rejected',...)`, which reaches
# journald and not /var/log/mcai. Verified: 117 distinct kinds in a 4 h window and the
# only veto-ish one is `_veto_faces`, which is gather target safety, a different thing.
# So vetoes/bot-h is scraped from journald per unit; the JSONL supplies the denominator,
# the arms, the settle points and the liveness row.
import sys, os, json, subprocess, re
import datetime as dt
from collections import defaultdict, Counter
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

man = json.load(open('/srv/mcbots/trial-manifest.json')); ovr = os.environ.get('CANARY_DRYRUN')
if ovr: CAN, CV, ISO = ovr.split(':', 2); CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else: CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc); elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
PRE = 180; W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
FEED = '_veto_feedback'


def load_window(since_minutes):
    """ROTATION-AWARE and deduped: day D's rows live in -{D+1}.gz, generations overlap, and a
    plain read of live files alone once returned a confident zero for an 8-hour-old event."""
    import glob as _g
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    start = now - dt.timedelta(minutes=since_minutes); d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz',
                                       since_minutes=since_minutes).rows)
        d += dt.timedelta(days=1)
    seen = set(); out = []
    for r in ev.rows:
        k = (str(r.get('t')), (r['bot'] or {}).get('name'), r['name'], r.get('detail'))
        if k in seen: continue
        seen.add(k); out.append(r)
    out.sort(key=lambda r: str(r['t'])); ev.rows = out
    return ev


ev = load_window(int(PRE + W + 10))
pool_of = lambda b: b.rsplit('-', 1)[0]
arm = lambda b: 'canary' if pool_of(b) in CANS else (None if pool_of(b).startswith('isolated') else 'control')
era = lambda t: 'pre' if t < CUT else ('post' if (t - CUT).total_seconds() / 60 <= W else None)
# THE WARM ERA, and it is not a refinement -- it is what the null actually calibrates.
# The deploy restarts ONLY the canary pool, and AdmissionControl's constructor clears BOTH
# `failedCooldowns` (admission.mjs:164) and `recent` (:165). `repeat_loop` cannot fire until
# the bot has chosen 4 IDENTICAL admitted actions (REPEAT_WINDOW = 4, :22, :701-703), so a
# restart MECHANICALLY suppresses repeat_loop and then refills cooldown as the map warms.
# That is exactly the +30 signature (repeat_loop DiD -11.78, cooldown DiD +9.39) and it is a
# cleared gate, not a treatment effect. The null was measured with BOTH arms undisturbed, so
# the estimator it calibrates is the uncontaminated one: WARM is the field to decide on.
WARM_MIN = 30
era_w = lambda t: ('pre' if t < CUT else
                   ('post' if WARM_MIN <= (t - CUT).total_seconds() / 60 <= W else None))

span = defaultdict(dict); feed = Counter(); held = []; chars = []; capped_n = 0
spanw = defaultdict(dict); decisionsw = Counter()
settled_at = {}; decisions = Counter(); kinds = Counter(); allbots = set()
FEEDRE = re.compile(r'held=(\d+) chars=(\d+)')
for r in ev.rows:
    b = (r['bot'] or {}).get('name')
    if not b: continue
    allbots.add(b); kinds[r['name']] += 1
    a = arm(b)
    if a is None: continue
    t = r['t']; e = era(t)
    if e is None: continue
    k = (a, e)
    s = span[k].get(b); span[k][b] = (t if s is None else min(s[0], t), t if s is None else max(s[1], t))
    ew = era_w(t)
    if ew is not None:
        kw = (a, ew)
        sw = spanw[kw].get(b); spanw[kw][b] = (t if sw is None else min(sw[0], t), t if sw is None else max(sw[1], t))
        if r['name'] == '_affordance_scan': decisionsw[kw] += 1
    # THE SETTLE POINT, not the pool label. Teardown/deploy restarts the assigned bots on a
    # 12 s stagger, so for the first minutes a canary pool legitimately contains bots still
    # running the BASELINE -- blindstep-01's first 8 canary-arm rows were exactly that.
    if a == 'canary' and e == 'post':
        _v = ((r.get('raw') or {}).get('code') or {}).get('version') or ''
        if CV and _v.startswith(CV) and b not in settled_at: settled_at[b] = t
    if r['name'] == '_affordance_scan': decisions[k] += 1     # ~1 per decision; the denominator
    if r['name'] == FEED:
        feed[k] += 1
        m = FEEDRE.search(r.get('detail') or '')
        if m:
            held.append(int(m.group(1))); chars.append(int(m.group(2)))
            if int(m.group(2)) > 240: capped_n += 1

bh = lambda k: sum((v[1] - v[0]).total_seconds() / 3600.0 for v in span[k].values() if v[1] > v[0])
CP, CTL, CPRE, KPRE = ('canary', 'post'), ('control', 'post'), ('canary', 'pre'), ('control', 'pre')
per = lambda c, k: (c[k] / bh(k)) if bh(k) else None
fmt = lambda x: 'n/a' if x is None else f'{x:.2f}'


def did(f):
    v = [f(x) for x in (CP, CPRE, CTL, KPRE)]
    return None if any(x is None for x in v) else (v[0] - v[1]) - (v[2] - v[3])


# ---- POSITIVE CONTROL FIRST -------------------------------------------------
print(f"positive control: {len(ev.rows)} rows, {len(allbots)} bots, {len(kinds)} distinct kinds, "
      f"window {int(PRE + W + 10)} min")
print(f"WINDOW  cut {CUT.isoformat()}  post {W:.0f} min  canary pools {sorted(CANS)}  base {CV or '(none)'}")
print(f"        bot-h  canary post {bh(CP):.1f}  control post {bh(CTL):.1f}  "
      f"canary pre {bh(CPRE):.1f}  control pre {bh(KPRE):.1f}")
print(f"        bots   canary {len(span[CP])}  control {len(span[CTL])}")

# ---- LIVENESS / LINKAGE ----------------------------------------------------
print(f"LIVENESS {FEED} rows: canary {feed[CP]}  control {feed[CTL]}   "
      f"(control MUST be 0 -- the kind does not exist on the baseline)")
print(f"        settled bots: {len(settled_at)} of {len(span[CP])} canary bots have a canary-build row")
if held:
    held.sort(); chars.sort()
    print(f"        off-limits table: held entries median {held[len(held)//2]} max {held[-1]}; "
          f"rendered chars median {chars[len(chars)//2]} max {chars[-1]}  "
          f"(cap 240; over-cap rows {capped_n} -- MUST be 0)")
    print(f"        saturation: {100*sum(1 for h in held if h>=6)/len(held):.1f}% of decisions held the full 6 entries")
else:
    print("        off-limits table: NO PARSED ROWS -- treat every number below as unread")

# ---- THE PRIMARY ENDPOINT: vetoes/bot-h from journald ----------------------
UNITS = subprocess.run(['systemctl', 'list-units', 'mcbot@*', '--no-legend', '--plain'],
                       capture_output=True, text=True).stdout.split()
UNITS = [u for u in UNITS if u.startswith('mcbot@') and u.endswith('.service')]
botof = lambda u: u[len('mcbot@'):-len('.service')]
REASON = re.compile(r'why=([a-z_]+)')
vet = defaultdict(Counter); vtot = Counter()
vetw = defaultdict(Counter); vtotw = Counter()
for u in UNITS:
    b = botof(u); a = arm(b)
    if a is None or b not in span[CP] and b not in span[CTL] and b not in span[CPRE] and b not in span[KPRE]:
        if a is None: continue
    out = subprocess.run(['sudo', 'journalctl', '-u', u, '--since', f'-{int(PRE+W+10)}min',
                          '--no-pager', '-o', 'short-iso'], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if 'decision rejected' not in line: continue
        try: t = dt.datetime.fromisoformat(line.split(' ', 1)[0])
        except Exception: continue
        if t.tzinfo is None: t = t.replace(tzinfo=dt.timezone.utc)
        e = era(t)
        if e is None: continue
        k = (a, e)
        m = REASON.search(line)
        reason_ = m.group(1) if m else '(unparsed)'
        vet[k][reason_] += 1
        vtot[k] += 1
        ew = era_w(t)
        if ew is not None:
            vetw[(a, ew)][reason_] += 1; vtotw[(a, ew)] += 1
print(f"JOURNALD scanned {len(UNITS)} units; veto lines post: canary {vtot[CP]} control {vtot[CTL]}; "
      f"pre: canary {vtot[CPRE]} control {vtot[KPRE]}")
if vtot[CP] == 0:
    print("  ZERO CANARY VETO LINES -- that is a reader failure, not a result. Do not decide on this read.")
print()
print("  PRIMARY  all vetoes / bot-h        canary %s  control %s   DiD %s"
      % (fmt(per(vtot, CP)), fmt(per(vtot, CTL)), fmt(did(lambda k: per(vtot, k)))))
for reason in ('repeat_loop', 'cooldown', 'learned_avoid', 'bad_args', 'deposit_not_worth_it'):
    f = lambda k, _r=reason: (vet[k][_r] / bh(k)) if bh(k) else None
    print("           %-22s canary %s  control %s   DiD %s"
          % (reason + '/bot-h', fmt(f(CP)), fmt(f(CTL)), fmt(did(f))))
print()
print("  admitted decisions / bot-h         canary %s  control %s   DiD %s"
      % (fmt(per(decisions, CP)), fmt(per(decisions, CTL)), fmt(did(lambda k: per(decisions, k)))))
print()
bhw = lambda k: sum((v[1] - v[0]).total_seconds() / 3600.0 for v in spanw[k].values() if v[1] > v[0])
perw = lambda c, k: (c[k] / bhw(k)) if bhw(k) else None


def didw(f):
    v = [f(x) for x in (CP, CPRE, CTL, KPRE)]
    return None if any(x is None for x in v) else (v[0] - v[1]) - (v[2] - v[3])


print()
print("  ==== WARM WINDOW (post-deploy minute %d onward): THE DECIDING NUMBERS ====" % WARM_MIN)
print("     the canary pool was RESTARTED and control was not; AdmissionControl clears failedCooldowns")
print("     AND `recent` on construction, and repeat_loop needs 4 identical admitted actions to fire,")
print("     so the first minutes suppress repeat_loop and refill cooldown MECHANICALLY. The null was")
print("     measured with both arms undisturbed, so it calibrates THIS estimator, not the raw one.")
print("     bot-h  canary post %.1f  control post %.1f  canary pre %.1f  control pre %.1f"
      % (bhw(CP), bhw(CTL), bhw(CPRE), bhw(KPRE)))
if bhw(CP) <= 0:
    print("     WARM WINDOW EMPTY -- not yet %d min past the deploy. No deciding number exists." % WARM_MIN)
else:
    print("  WARM all vetoes / bot-h   canary %s  control %s   DiD %s   (gate: KEEP <= -5.03, REVERT >= +5.17)"
          % (fmt(perw(vtotw, CP)), fmt(perw(vtotw, CTL)), fmt(didw(lambda k: perw(vtotw, k)))))
    for reason in ('repeat_loop', 'cooldown', 'learned_avoid'):
        f = lambda k, _r=reason: (vetw[k][_r] / bhw(k)) if bhw(k) else None
        print("       %-16s canary %s  control %s   DiD %s"
              % (reason, fmt(f(CP)), fmt(f(CTL)), fmt(didw(f))))
    print("  WARM admitted decisions / bot-h  canary %s  control %s   DiD %s"
          % (fmt(perw(decisionsw, CP)), fmt(perw(decisionsw, CTL)), fmt(didw(lambda k: perw(decisionsw, k)))))
print()
print("READ RULE (pre-registered, AMENDED against a MEASURED null -- see the registration):")
print("  THE GATE IS NOT ZERO. Exhaustive same-shape null on IDENTICAL code, C(12,2)=66, pre-deploy data:")
print("    all vetoes  mean 0.00  sd 3.31  p5 -5.03  p95 +5.17   -> KEEP needs vetoes_did <= -5.03")
print("    hive-only subset (n=6, the drawn stratum): repeat_loop null MEAN +3.01, cooldown null MEAN -1.27")
print("    repeat_loop null  p5 -7.03  p95 +4.91 | hive-only MEAN +3.01, range +1.40..+4.63")
print("    cooldown null     p5 -2.21  p95 +2.54 | hive-only MEAN -1.27, range -2.29..-0.25")
print("    learned_avoid null p5 -6.61 p95 +3.66 | MAX over all 66 assignments +4.90 (hive-only -7.14..+4.90)")
print("  KEEP needs vetoes_did <= -5.03 AND a component beating ITS OWN STRATUM centre:")
print("    repeat_loop_did <= +1.40 OR cooldown_did <= -2.29  (hive-only RANGE ENDPOINTS, n=6, not percentiles)")
print("  REVERT needs vetoes_did >= +5.17. Otherwise INCONCLUSIVE, which is the honest close at this noise.")
print("  ONLY +180 AND +240 DECIDE. The null was measured on a 180-min post window, and the canary pool was")
print("  RESTARTED while control was not -- that transient is ~10-15% of a +30 window and ~3% of +180.")
print("  verdict.py puts `primary` in _ADVISORY (verdict.py:906), so THE GATE NEVER TESTS THE EFFECT: a")
print("  verdict.py KEEP means exposure, linkage and the death gate were clean, nothing more. The effect")
print("  call is the analyst's and must be reported separately.")
print("  WATCH learned_avoid: B2 does not touch it, so a large learned_avoid DiD is evidence the aggregate")
print("  is being driven by something other than the treatment (restart, or hive store churn).")
print(f"  Liveness is a gate, not a result: control {FEED} > 0 or canary == 0 means the arms are wrong.")

try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    _hm = held[len(held) // 2] if held else None
    _cm = chars[len(chars) // 2] if chars else None
    _sat = (sum(1 for h in held if h >= 6) / len(held)) if held else None
    _rl = lambda k: (vet[k]['repeat_loop'] / bh(k)) if bh(k) else None
    _cd = lambda k: (vet[k]['cooldown'] / bh(k)) if bh(k) else None
    emit('vetob2read', W, {
        # exposure + mechanism: the instrument actually speaking
        'feedback_rows_canary': feed[CP],
        # linkage: structurally impossible on the baseline
        'feedback_rows_control': feed[CTL],
        'settled_bots': len(settled_at),
        'over_cap_rows': capped_n,
        'held_median': _hm, 'chars_median': _cm, 'saturation_share': _sat,
        # primary
        'vetoes_per_bh_canary': per(vtot, CP), 'vetoes_per_bh_control': per(vtot, CTL),
        'vetoes_did': did(lambda k: per(vtot, k)),
        'repeat_loop_per_bh_canary': _rl(CP), 'repeat_loop_per_bh_control': _rl(CTL),
        'repeat_loop_did': did(_rl),
        'cooldown_per_bh_canary': _cd(CP), 'cooldown_per_bh_control': _cd(CTL),
        'cooldown_did': did(_cd),
        'decisions_per_bh_canary': per(decisions, CP), 'decisions_per_bh_control': per(decisions, CTL),
        'decisions_did': did(lambda k: per(decisions, k)),
        # reader-failure guards: a zero here is an instrument fault, not a finding
        'journald_units_scanned': len(UNITS),
        'veto_lines_canary_post': vtot[CP], 'veto_lines_control_post': vtot[CTL],
        'vetoes_did_warm': didw(lambda k: perw(vtotw, k)),
        'repeat_loop_did_warm': didw(lambda k: (vetw[k]['repeat_loop'] / bhw(k)) if bhw(k) else None),
        'cooldown_did_warm': didw(lambda k: (vetw[k]['cooldown'] / bhw(k)) if bhw(k) else None),
        'learned_avoid_did_warm': didw(lambda k: (vetw[k]['learned_avoid'] / bhw(k)) if bhw(k) else None),
        'decisions_did_warm': didw(lambda k: perw(decisionsw, k)),
        'warm_canary_bot_h': bhw(CP), 'warm_min': WARM_MIN,
        'canary_bot_h': bh(CP), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
