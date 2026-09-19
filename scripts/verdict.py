# verdict.py <run_id> <window_min> [--dryrun] -- the canary loop's decision (design v3): loads the registration and the
# bound evidence objects for this window, checks binding, applies the standing rules (readability, the owner's death
# gate, v15c movement guards, v11 guards, deposit skill_error, v12/v14c linkage with the death poll's own check) and the
# registration's own lines and exposure, and prints ONE verdict: NOT_YET | KEEP | REVERT | WATCH | INCONCLUSIVE |
# UNREADABLE | KEEP_ON_SAFETY. Writes ~/digest/reads/<run_id>-verdict-<M>.json. Never edits a rule.
import sys, os as _os
sys.path.insert(0, '/home/mike/mcai-analysis')
# ...AND THE DIRECTORY THIS FILE IS IN. The host path above is first and stays
# authoritative there. Without this line the repo copy of verdict.py cannot even
# be imported off the host: `singledeath.py` was never committed, so
# `scripts/verdict.py` has been carrying an unsatisfiable import since v23
# landed, while `scripts/test_singledeath.py` sat beside it testing a module
# that was not there. "The two copies are reconciled" was true of the text and
# false of the thing you can run.
sys.path.insert(1, _os.path.dirname(_os.path.abspath(__file__)))
import json, os, glob, gzip, hashlib, datetime as dt, collections
from deathgate import death_gate
from singledeath import licence_reverts


def license_change_rows(changerow, away, ctrl_at_death):
    """Which change rows in a canary death window may license a REVERT (v19).

    Pure, so it can be tested; the inline version of this could only ever be checked by
    burning a canary, and three were. A row licenses a REVERT only when it DISCRIMINATES:

      refused if the row appears in a CONTROL death window   -- it is baseline behaviour,
          not the change acting (recovery-ladder-13b, `flooded_pocket_rung`)
      refused if the row was never seen AWAY from a death     -- it may be written by the
          death itself (recovery-ladder-13, `death_site_recorded`)

    Returns (licensed, refused).
    """
    licensed, refused = [], []
    for b, tt, ch, d in changerow:
        for row in ch:
            if row in ctrl_at_death:
                refused.append(f'{row}: control deaths carry it too, so it is baseline behaviour')
            elif row not in away:
                refused.append(f'{row}: never seen away from a death, so it may be written by the death')
            else:
                licensed.append((b, tt, row, d))
    return licensed, refused

run_id, M = sys.argv[1], int(sys.argv[2]); DRY = '--dryrun' in sys.argv; POLL = '--poll' in sys.argv
# THREE PATHS, OVERRIDABLE ONLY BY THE ENVIRONMENT, SO THIS FILE CAN BE REPLAYED.
# The defaults are exactly what they were; nothing in production passes these.
# They exist because v23's acceptance suite has to drive THIS file -- the one the
# loop runs -- against fixtures built from incidents already on record. A suite
# that tests a copy tests a copy: `scripts/verdict.py` and `~/verdict.py` were
# found disagreeing about the death rule on 2026-09-18, which is the whole
# argument for replaying the real thing.
R   = os.environ.get('VERDICT_READS_DIR') or os.path.expanduser('~/digest/reads')
LOGROOT = os.environ.get('VERDICT_LOG_ROOT') or '/var/log/mcai'
_RD = os.environ.get('VERDICT_REG_DIR')   or os.path.expanduser('~/mcai-analysis/registrations')
if '/' in run_id or run_id in ('.', '..'):
    sys.exit(f'refusing: run_id {run_id!r} contains a path separator')   # os.path.join would let it escape _RD
REG = os.path.join(_RD, f'{run_id}.json')
# The /tmp fallback is for a registration staged by hand on the host. It must
# NOT apply when a directory was named explicitly, or a replay that means to
# fail on a missing fixture silently reads a stale one from /tmp instead.
if not os.path.exists(REG) and not os.environ.get('VERDICT_REG_DIR'):
    REG = f'/tmp/registrations/{run_id}.json'
reg = json.load(open(REG)); man = json.load(open(os.environ.get('VERDICT_MANIFEST') or '/srv/mcbots/trial-manifest.json'))
why = []; verdict = None
def out(v, extra=None):
    o = {'run_id': run_id, 'window_min': M, 'verdict': v, 'why': why, 'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'extra': extra or {}}
    os.makedirs(R, exist_ok=True); json.dump(o, open(os.path.join(R, f'{run_id}-verdict-{M}.json'), 'w'), indent=1, default=str)
    print(f"VERDICT {v} (+{M}) :: " + ' | '.join(why)); sys.exit(0)
# 1. evidence, bound
ev = {}
if POLL:
    latest = sorted(glob.glob(os.path.join(R, f'{run_id}-immobiledid-*.json')), key=os.path.getmtime)
    im = json.load(open(latest[-1]))['fields'] if latest else {'harm': {'canary_deaths': 0, 'control_rate': None, 'canary_rate': 0}}
    reg['reads'] = []
for name in reg['reads']:
    p = os.path.join(R, f'{run_id}-{name}-{M}.json')
    if not os.path.exists(p): why.append(f'{name}: no evidence object for +{M}'); continue
    o = json.load(open(p))
    if not DRY:
        if o.get('sha') != man.get('canary_code_version') or o.get('pools') != man.get('canary_pool') or o.get('run_id') != man.get('run_id') or o.get('declared_at') != man.get('declared_at') or o.get('window_min') != M:
            why.append(f'{name}: evidence not bound to the active canary'); continue
        if o.get('sha') != reg['sha']: why.append(f'{name}: evidence sha {o.get("sha")} != registration sha {reg["sha"]}'); continue
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(o['emitted_at'])).total_seconds() / 60
        if age > 90: why.append(f'{name}: evidence stale ({age:.0f} min)'); continue
    ev[name] = o['fields']
if len(ev) < len(reg['reads']): (out('UNREADABLE'))
if not POLL:
    im = ev['immobiledid']
    # 2. readability
    if not im.get('readable'): why.append(f"not readable yet ({im.get('canary_bot_h', 0):.1f} bot-h)"); (out('NOT_YET'))
# 3. rung-linked deaths (the death poll's rule, recomputed here from the pools' logs since declared_at)
M_LIST = set('entombed marooned maroon_wall entombed_ramp_cut marooned_ramp_cut livelock_escape pillar_no_gain stuck unstick_oscillation'.split()) | set(reg.get('linkage_extra', []))
C_ROWS = set(reg.get('change_rows', []))
linked = []; changerow = []; ndeaths = 0; pending_watch = []; by = {}
if not DRY:
    cut = man['declared_at'][:19]; pools = [p.strip() for p in str(man['canary_pool']).split(',')]
    def _scan(poollist):
        d = collections.defaultdict(list)
        for pool in poollist:
            for f in glob.glob(f'{LOGROOT}/{pool}-*/skill-*.jsonl') + glob.glob(f'{LOGROOT}/{pool}-*/skill-*.jsonl-*.gz'):
                op = gzip.open if f.endswith('.gz') else open
                try:
                    with op(f, 'rt', errors='replace') as fh:
                        for l in fh:
                            if cut[:10] not in l[:60] and dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d') not in l[:60] and '"_death"' not in l: continue
                            try: r = json.loads(l)
                            except Exception: continue
                            d[r['bot']['name']].append((r['@timestamp'], (r.get('skill') or {}).get('name', ''), ((r.get('skill') or {}).get('detail') or '')[:70]))
                except Exception: pass
        return d
    by = _scan(pools)
    for b, rs in by.items():
        rs.sort()
        for ts, k, d in rs:
            if k == '_death' and ts > cut:
                ndeaths += 1; t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00')); lo = (t - dt.timedelta(seconds=60)).isoformat().replace('+00:00', 'Z')
                win = [q for q in rs if lo <= q[0] < ts]
                lk = sorted({q[1].lstrip('_') for q in win if q[1].lstrip('_') in M_LIST and not any((not z[1].startswith('_')) and q[0] < z[0] < ts for z in win)})
                ch = sorted({q[1].lstrip('_') for q in win if q[1].lstrip('_') in C_ROWS})
                if lk: linked.append((b, ts[11:19], lk, d))
                if ch: changerow.append((b, ts[11:19], ch, d))
# ---- v19: a change row only licenses a REVERT if it can DISCRIMINATE. Two canaries were
# lost to rows that could not, and both failures look identical from inside the old test:
#   -13  `death_site_recorded`  -- written BY the death handler, so every death carried it.
#   -13b `flooded_pocket_rung`  -- fleet-wide on the baseline, so control emits it too; a
#        control bot (isolated-a-Echo, 00:01:45, "drowned; idle") carried it into its own
#        death window while the canary was being reverted for exactly that.
# So: (a) no CONTROL death in the same window may carry the row, and (b) the row must have
# been seen on the canary at least once AWAY from a death. (a) is the difference-in-
# differences this test never had; (b) is what separates a cause from a consequence.
deathwins = [(b, (dt.datetime.fromisoformat(ts.replace('Z', '+00:00')) - dt.timedelta(seconds=60)).isoformat().replace('+00:00', 'Z'), ts)
             for b, rs in by.items() for ts, k, _ in rs if k == '_death' and ts > cut]
away = {k.lstrip('_') for b, rs in by.items() for ts, k, _ in rs
        if k.lstrip('_') in C_ROWS and not any(bb == b and lo <= ts < hi for bb, lo, hi in deathwins)}
ctrl_at_death = set(); ctrl_deaths = 0
if changerow or linked:
    allp = sorted({os.path.basename(p.rstrip('/')).rsplit('-', 1)[0] for p in glob.glob(f'{LOGROOT}/*-*/')})
    for b, rs in _scan([p for p in allp if p not in pools]).items():
        rs.sort()
        for ts, k, _ in rs:
            if k == '_death' and ts > cut:
                ctrl_deaths += 1
                lo = (dt.datetime.fromisoformat(ts.replace('Z', '+00:00')) - dt.timedelta(seconds=60)).isoformat().replace('+00:00', 'Z')
                ctrl_at_death |= {q[1].lstrip('_') for q in rs if lo <= q[0] < ts and q[1].lstrip('_') in C_ROWS}
licensed, refused = license_change_rows(changerow, away, ctrl_at_death)
if refused: why.append(f'change rows in a canary death window REFUSED as non-discriminating ({ctrl_deaths} control deaths in the window): ' + '; '.join(sorted(set(refused))))
# v23 (2026-09-19): NO SINGLE CANARY DEATH MAY LICENCE A REVERT BY ANY PATH.
# This branch reverted owner-01b at +0 on ONE death at 16:38:45Z while the
# aggregate gate below -- the owner's two-death floor plus v21's lower bound --
# was at that same moment correctly HOLDING a 10.00x point ratio at a 0.78x
# lower bound. Two rules about the same question in one file, and the stricter
# one never ran. The floor now has ONE implementation that every path calls.
_v23_rev, _v23_why = licence_reverts(licensed, ndeaths)
if _v23_rev:
    why.append(f'change row inside a death window, discriminating: {licensed[0][:3]}'); (out('REVERT', {'deaths': ndeaths}))
elif licensed:
    why.append(_v23_why); pending_watch.append('licensed change row held below the death floor (v23)')
# v19: the single-death rung-linkage override bypassed the owner's own calibrated death
# gate (TWO canary deaths AND > 1.25x control). It has now ended three canaries on one
# death each -- -08c (`marooned_ramp_cut`, whose ledger note already says "present in both
# arms; not the change"), -13 and -13b -- and it has never been calibrated, which v16
# requires of anything that can revert. The base M_LIST rungs are fleet-wide code, so a
# rung firing before a death is baseline behaviour unless the CONTROL arm says otherwise.
# Demoted to a reported WATCH. Real harm still reverts: the owner's death gate below, the
# v15c movement guards, the v11 guards, and a change row that does discriminate.
if linked and reg.get('ladder_change', False):
    _shared = ctrl_at_death & set(linked[0][2])
    why.append(f"rung-linked canary death REPORTED, not reverted (v19: 1 death is below the owner's two-death gate; "
               f"{'control deaths carry the same rung rows: ' + ','.join(sorted(_shared)) if _shared else 'no control death in the window carries these rows'}; "
               f"{ctrl_deaths} control deaths in the window): {linked[0][:3]}")
    pending_watch.append('rung-linked death (reported)')
if linked: why.append(f'rung-linked death on a non-ladder change (v14c: report unless the four conditions fail; operator reviews): {linked[0][:3]}')
# 4. the owner's death gate
h = im['harm']
if POLL and ndeaths >= 2 and h.get('control_rate'): h = dict(h, canary_deaths=ndeaths, canary_rate=ndeaths / max(0.1, ((dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))).total_seconds() / 3600) * 10))
# v21 (2026-09-18, PROSPECTIVE): the owner's TWO-death floor is untouched; the 1.25x test now
# runs on the one-sided 95% LOWER BOUND of the rate ratio, not the point estimate. The gate is
# polled every 5 min for up to 9 h -- ~108 looks at an event with a null expectation under one
# per canary -- so the point ratio clears 1.25x on ordinary Poisson noise. Calibrated by
# simulation over the measured fleet death process (~/mcai-analysis/calibrate_deathgate.py):
# false revert 43.7% -> 5.0%, detection at swim_to scale (10x) 100% -> 99.9%, at 3x 95% -> 51%.
# The 43.7% reproduces the 46% measured on 2026-09-13, which is the positive control for the
# simulation. It reverted falls-01 -- a REPORT-ONLY instrument -- on 2 idle deaths (one drowning,
# one unknown, no falls) while all 3 CONTROL deaths in the same window were idle drownings.
_cbh = (h['canary_deaths'] / h['canary_rate']) if h.get('canary_rate') else 0.0
_kbh = (h.get('control_deaths', 0) / h['control_rate']) if h.get('control_rate') else (_cbh * 7.0)
_rev, _why = death_gate(h['canary_deaths'], _cbh, h.get('control_deaths', 0), _kbh)
if _rev: why.append(_why); (out('REVERT'))
elif h['canary_deaths'] >= 2: why.append(_why); pending_watch.append('death gate held (v21)')
why.append(f"deaths {h['canary_deaths']} ({h['canary_rate']:.3f}) vs control {(h['control_rate'] or 0):.3f}/bh")
if POLL: why.append(f'poll: {ndeaths} canary deaths since declared_at, {len(linked)} rung-linked, {len(changerow)} with a change row'); (out('POLL_OK', {'deaths': ndeaths}))
# 5. v15c movement guards
v = im['v15c']
if v['verdict'].startswith('REVERT'): why.append('v15c ' + v['verdict']); (out('REVERT'))
watch = [v['verdict']] if v['verdict'].startswith('WATCH') else []
watch.extend(pending_watch)
# 6. v11 guards
g = im['v11']
for nm, val, lim in (('climbs', g['climbs'], 1.0), ('livelock', g['livelock'], 1.0)):
    if val == val and val > lim: why.append(f'v11 {nm} {val:+.0%} > +100%'); (out('REVERT'))
if g['ladders_p90'] is not None and g['ladders_p90'] > 32: why.append(f"ladders p90 {g['ladders_p90']} > 32"); (out('REVERT'))
# 7. deposit skill_error
d = ev.get('depositread', {})
if d.get('skill_error_share_canary') is not None and d.get('skill_error_share_control') is not None and d['skill_error_share_canary'] > d['skill_error_share_control']: why.append('deposit skill_error share above control'); (out('REVERT'))
# 8. own lines
for ln in reg.get('own_lines', []):
    val = ev.get(ln['read'], {}).get(ln['field'])
    # NaN IS NOT A FAILING VALUE, IT IS AN ABSENT ONE -- and this branch only
    # caught None. owner-01b's primary ratio-DiD divided by zero (the draw took
    # two pools at a 0.0% immobile pre-share; you cannot reduce immobility from
    # zero) and printed `+nan% FAIL`. A NaN reaches the comparison below, every
    # comparison against NaN is False, so the line reads "fails <= 0" and an
    # `on_fail: REVERT` endpoint REVERTS -- scoring an arithmetic hole as a
    # change that made things worse. Infinities are the same class: a ratio
    # against a zero denominator is undefined, not extreme. Found by a Codex
    # pass on v23's acceptance suite, 2026-09-19, which caught that the suite's
    # own case used None and so tested missing data rather than the incident.
    if val is None or (isinstance(val, float) and val != val) or val in (float('inf'), float('-inf')):
        if ln.get('nullable'): continue
        why.append(f"own line {ln['read']}.{ln['field']} is {val!r} -- undefined, not a failure"); (out('UNREADABLE'))
    ok = {'<=': val <= ln['value'], '>=': val >= ln['value'], '==': val == ln['value']}[ln['op']]
    if not ok:
        why.append(f"own line {ln['read']}.{ln['field']} = {val} fails {ln['op']} {ln['value']}")
        if ln['on_fail'] == 'REVERT': (out('REVERT'))
        watch.append(f"{ln['field']}")
# 9. exposure
ex = reg.get('exposure'); exposed = True
if ex:
    val = ev.get(ex['read'], {}).get(ex['field']) or 0; exposed = val >= ex['min']; why.append(f"exposure {ex['read']}.{ex['field']} = {val} (min {ex['min']})")
final_M = max(reg['read_minutes'] + (reg.get('extension', {}).get('extra_reads', []) if reg.get('extension', {}).get('until_exposure') else []))
if watch: why.append('WATCH: ' + ', '.join(watch))
if M < max(reg['read_minutes']): (out('NOT_YET'))
if not exposed:
    if reg.get('extension', {}).get('until_exposure') and M < final_M: why.append('zero exposure: the registered extension continues'); (out('NOT_YET'))
    why.append('zero exposure at the final read'); (out(reg.get('extension', {}).get('final_on_zero_exposure', 'INCONCLUSIVE')))
(out('KEEP'))
