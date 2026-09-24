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
for _cand in (_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'lib'),
              '/home/mike/mcai-analysis/lib',
              '/opt/minecraft-ai/scripts/lib'):
    if _os.path.isdir(_cand):
        sys.path.insert(2, _cand)
        break
import json, os, glob, gzip, hashlib, datetime as dt, collections
from deathgate import death_gate
from arms import pool_of
from singledeath import licence_reverts


def license_change_rows(changerow, away, ctrl_at_death, ctrl_rate=None,
                        window_s=60, p_max=0.05, canary_rate=None):
    """Which change rows in a canary death window may license a REVERT (v25).

    Pure, so it can be tested; the inline version of this could only ever be checked by
    burning a canary, and three were. A row licenses a REVERT only when it DISCRIMINATES:

      refused if the row appears in a CONTROL death window   -- it is baseline behaviour,
          not the change acting (recovery-ladder-13b, `flooded_pocket_rung`)
      refused if the row was never seen AWAY from a death     -- it may be written by the
          death itself (recovery-ladder-13, `death_site_recorded`)
      refused if CONTROL EMITS IT OFTEN ENOUGH that landing in a 60 s window by chance is
          not rare (v25, below)

    V25: THE FIRST TEST IS PRESENCE, WHICH HAS ALMOST NO POWER.
    `ctrl_at_death` holds only the rows carried by control deaths that fall INSIDE this
    window. Deaths run ~0.05/bot-h, so a window routinely contains one or two control
    deaths and the set is nearly empty -- and then a row control emits CONSTANTLY still
    licenses a REVERT. Audited 2026-09-24 over all 23 reverts: `_entombed*` licensed
    rl-04 `6d843a1` while control emitted it at 6.16/bot-h, and `_marooned*` licensed
    rl-03 `612d1c8` at 4.77/bot-h. Asking "did a control death happen to carry it" is a
    test of how many control deaths there were, not of the row.

    So calibrate against the rate instead. If control emits row r at `lambda_r` per
    bot-hour, the chance of at least one coincidental emission inside a window of
    `window_s` seconds is

        P = 1 - exp(-lambda_r * window_s / 3600)

    and the row is refused when P > `p_max`. At the audit's 600 s linkage window that is
    64.2% for 6.16/bot-h and 54.8% for 4.77/bot-h, which is what the audit measured; at
    this file's 60 s window it is 9.8% and 7.7%, still above a 0.05 ceiling, so both of
    those reverts fall either way. A row control never emits has P=0 and is unaffected --
    `_fall_path` was 0 in 115.4 control bot-h and `_escape_rung` 0 in 178.0, so the two
    reverts that did discriminate still do.

    `ctrl_rate` maps row name (no leading underscore) to control emissions per bot-hour.
    Omitted or missing keys mean UNMEASURED, not zero: an unmeasured row keeps the old
    presence-only behaviour rather than being silently licensed, because a gate that
    reverts must not read a hole in its own instrument as a clean bill of health.

    Returns (licensed, refused).
    """
    import math
    licensed, refused = [], []
    for b, tt, ch, d in changerow:
        for row in ch:
            lam = (ctrl_rate or {}).get(row)
            if row in ctrl_at_death:
                refused.append(f'{row}: control deaths carry it too, so it is baseline behaviour')
            elif row not in away:
                refused.append(f'{row}: never seen away from a death, so it may be written by the death')
            elif lam is not None and lam > 0 and (1.0 - math.exp(-lam * window_s / 3600.0)) > p_max:
                _p = 1.0 - math.exp(-lam * window_s / 3600.0)
                refused.append(f'{row}: control emits it at {lam:.3f}/bot-h, so a coincidental '
                               f'link in {window_s}s has P={_p:.3f} > {p_max} -- not discriminating')
            else:
                # v27: THE COINCIDENCE THAT MATTERS IS THE CANARY'S OWN RATE, and the test
                # above does not measure it. Calibrating only on control means a row the old
                # code NEVER emits scores P = 0 and licenses freely -- but a chatty new row
                # lands beside a background death by chance at its OWN rate. Measured
                # 2026-09-24: `escape_rung` runs at 6.733/bot-h on the canary, which is a
                # 10.6% chance of falling inside a 60 s window with any death at all, above
                # the very ceiling this function enforces on control.
                #
                # REPORTED, NOT ENFORCED, and the reason is specific: refusing above
                # 3.0/bot-h would refuse `escape_rung` and make owner-01b `aa44514` -- a
                # revert the audit calls CORRECT, with 240 canary rows against 0 in 249.5
                # control bot-h -- unrevertable by this path. It can only become a veto
                # alongside a REVERT-capable calibrated own-line for the same canary.
                q = None
                if canary_rate is not None:
                    lamc = (canary_rate or {}).get(row)
                    if lamc:
                        q = 1.0 - math.exp(-lamc * window_s / 3600.0)
                licensed.append((b, tt, row, d) if q is None or q <= p_max
                                else (b, tt, row + ' [canary emits it at %.3f/bot-h: a '
                                      'coincidental link in %ds has q=%.3f > %.2f -- REPORTED, '
                                      'not refused]' % (lamc, window_s, q, p_max), d))
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
    # A REGISTRATION THAT OMITS immobiledid USED TO CRASH HERE, SILENTLY.
    #
    # `im = ev['immobiledid']` raised KeyError, and canary-loop.sh:54 captures stdout only
    # (`V=$(python3 verdict.py $RUN $M | tail -1)`), so the traceback went to stderr and V
    # became the EMPTY STRING. The loop then journalled `"phase":"read-180","note":""` and
    # carried on as though it had read something.
    #
    # FOUND LIVE 2026-09-23 on banktruth-01, whose registration lists reads:
    # ['banktruthread'] with no immobiledid. Its journal:
    #     {"phase":"read-30","note":""}
    #     {"phase":"read-90","note":""}
    #     {"phase":"read-180","note":""}
    # Three scheduled reads, three empty verdicts, four and a half hours into a canary with
    # a deadline that night. The loop was alive, the journal had entries, and not one of
    # them was a reading. [[page-jsonl-is-not-a-heartbeat]] is the same shape.
    #
    # immobiledid is not an optional read: it carries the death-gate evidence (harm), the
    # v15c movement guards, the v11 guards and the readability test. A canary registered
    # without it has no safety floor at all, so this refuses and says why instead of
    # dying in a way that reads as silence.
    if 'immobiledid' not in ev:
        why.append(f"immobiledid evidence is absent (registration reads: "
                   f"{reg.get('reads')}). It carries the death gate, the v15c movement "
                   f"guards and the readability test, so there is no safety floor to read "
                   f"-- this is a registration error, not a result.")
        (out('UNREADABLE'))
    im = ev['immobiledid']
    # 2. readability
    if not im.get('readable'): why.append(f"not readable yet ({im.get('canary_bot_h', 0):.1f} bot-h)"); (out('NOT_YET'))
# 3. rung-linked deaths (the death poll's rule, recomputed here from the pools' logs since declared_at)
M_LIST = set('entombed marooned maroon_wall entombed_ramp_cut marooned_ramp_cut livelock_escape pillar_no_gain stuck unstick_oscillation'.split()) | set(reg.get('linkage_extra', []))
C_ROWS = set(reg.get('change_rows', []))
linked = []; changerow = []; ndeaths = 0; pending_watch = []; by = {}
if not DRY:
    cut = man['declared_at'][:19]; pools = [p.strip() for p in str(man['canary_pool']).split(',')]
    # THE DEATH SCAN GLOBBED BY POOL PREFIX, AND A SPLIT CANARY MATCHES NOTHING.
    #
    # `canary_pool` for a within-world canary is the sentinel `split:<run_id>`, and no bot
    # directory begins with that. VERIFIED on the fleet rather than reasoned about:
    #     canary_pool='hive-a'            -> 6 log files matched
    #     canary_pool='split:wwtest-01'   -> 0 log files matched
    # Zero files means zero rows means ndeaths=0, so the owner's death gate would have reported a
    # clean canary however many bots died -- a cheap negative in the one place this project can
    # least afford one. The control scan was the mirror image: `[p for p in allp if p not in
    # pools]` excluded nothing, so the treated bots were counted as their own control.
    #
    # Membership is now resolved PER BOT through canary_manifest.members_of, which hands back a
    # Roster for a split declaration and the legacy pool string otherwise, and in_canary_pool
    # accepts both. Scanning by bot rather than by pool is what makes the two cases one code path:
    # for a legacy canary it selects exactly the same bots the prefix glob did, and for a split one
    # it selects the declared roster and leaves its world-mates in control, which is the design.
    from canary_manifest import members_of
    from version_split import in_canary_pool
    MEMBERS = members_of(man)
    ALLBOTS = sorted({os.path.basename(b.rstrip('/')) for b in glob.glob(f'{LOGROOT}/*-*/')})
    CANARY_BOTS = [b for b in ALLBOTS if in_canary_pool(b, MEMBERS)]
    def _scan(botlist):
        d = collections.defaultdict(list)
        for bot in botlist:
            for f in glob.glob(f'{LOGROOT}/{bot}/skill-*.jsonl') + glob.glob(f'{LOGROOT}/{bot}/skill-*.jsonl-*'):
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
    by = _scan(CANARY_BOTS)
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
_by_ctrl = {}


def _exposure(scanned, since):
    """Measured bot-hours: the summed per-bot observed span, since `since`.

    This is DELIBERATELY the same estimator immobiledid.py uses for canary_bot_h, so the
    poll and the scheduled read cannot disagree about the denominator of the same window.
    A bot with fewer than two rows contributes nothing, which understates exposure slightly
    and therefore OVERstates a death rate -- an error in the conservative direction for a
    gate that reverts.
    """
    tot = 0.0
    for _b, rs in (scanned or {}).items():
        ts = [t for t, _k, _d in rs if t >= since]
        if len(ts) >= 2:
            a = dt.datetime.fromisoformat(min(ts).replace('Z', '+00:00'))
            z = dt.datetime.fromisoformat(max(ts).replace('Z', '+00:00'))
            tot += (z - a).total_seconds() / 3600.0
    return tot


def _control_scan():
    """Scan the non-canary pools once per run, memoised. ~33s over 12 pools, which is why
    the death gate only asks for it once the canary is AT the owner's two-death floor --
    below the floor the gate returns False whatever control says, so paying for it would buy
    nothing."""
    global _by_ctrl
    if not _by_ctrl:
        # CONTROL IS EVERY BOT THAT IS NOT TREATED, which for a split canary deliberately
        # includes the treated bots' own world-mates -- that is the whole point of the design, and
        # excluding their worlds (as the old pool-level complement did) would throw away the
        # matched controls it exists to create.
        _ctrl_bots = [b for b in ALLBOTS if b not in set(CANARY_BOTS)]
        _by_ctrl = _scan(_ctrl_bots) or {'__empty__': []}
    return _by_ctrl


if changerow or linked:
    for b, rs in _control_scan().items():
        rs.sort()
        for ts, k, _ in rs:
            if k == '_death' and ts > cut:
                ctrl_deaths += 1
                lo = (dt.datetime.fromisoformat(ts.replace('Z', '+00:00')) - dt.timedelta(seconds=60)).isoformat().replace('+00:00', 'Z')
                ctrl_at_death |= {q[1].lstrip('_') for q in rs if lo <= q[0] < ts and q[1].lstrip('_') in C_ROWS}
# v25: the CONTROL EMISSION RATE for every licensing row, which is what makes the
# discrimination test a test. Counted over the same scan and the same estimator the death
# rates use, so the two cannot disagree about the denominator. A row absent from this dict
# is UNMEASURED and keeps the old presence-only behaviour; a row present with 0.0 is
# measured-absent and licenses freely.
_ctrl_rate = {}
if changerow:
    _cscan = _control_scan()
    _cbh_rows = _exposure(_cscan, cut)
    if _cbh_rows > 0:
        _cnt = collections.Counter(k.lstrip('_') for _b, rs in _cscan.items()
                                   for ts, k, _d in rs if ts > cut and k.lstrip('_') in C_ROWS)
        _ctrl_rate = {r: _cnt.get(r, 0) / _cbh_rows for r in C_ROWS}
        why.append('control emission rates for licensing rows over %.1f control bot-h: %s'
                   % (_cbh_rows, ', '.join(f'{r}={_ctrl_rate[r]:.3f}/bh' for r in sorted(C_ROWS)) or '(none registered)'))
_can_rate = {}
if changerow:
    _cbh_can = _exposure(by, cut)
    if _cbh_can > 0:
        _cnt_can = collections.Counter(k.lstrip('_') for _b, rs in (by or {}).items()
                                       for ts, k, _d in rs if ts > cut and k.lstrip('_') in C_ROWS)
        _can_rate = {r: _cnt_can.get(r, 0) / _cbh_can for r in C_ROWS}
licensed, refused = license_change_rows(changerow, away, ctrl_at_death,
                                        ctrl_rate=_ctrl_rate, canary_rate=_can_rate)
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
# v24 (2026-09-23): THE DEATH GATE WAS RUNNING ON INVENTED DENOMINATORS while measured ones
# sat in the same evidence file. Three defects, all confirmed by reading and all live:
#
#   1. `and h.get('control_rate')` meant the poll's independently scanned deaths only
#      reached the gate when the SAVED control rate was truthy. Line 74's no-read default
#      sets control_rate=None, so for the whole early life of a canary -- before its first
#      scheduled read -- the death poll was BLIND. Replayed independently: 20 synthetic
#      canary deaths against a clean control returned POLL_OK. Harm continued precisely
#      when the control arm was healthy, which is the worst possible time to be blind.
#
#   2. canary_rate was ndeaths / (elapsed_h * 10) -- TEN canary bots, hardcoded. MEASURED
#      2026-09-23 on the live canary (banktruth-01, four pools): 20 canary bots and 56.8
#      measured bot-h, against the 30.8 the constant implies. The death rate was inflated
#      1.85x, biasing toward a FALSE REVERT. This is the same defect CLAUDE.md records for
#      Events.rate(), which "used to default to 40 against an 80-bot fleet"; the fix there
#      was to remove the default, and that is the fix here.
#
#   3. exposure was reconstructed by DIVIDING deaths by the rate -- algebraically fine while
#      the rate is non-zero, and 0 or invented when it is not. Control exposure fell back to
#      canary x 7.0. Replayed: 2 canary deaths in 20 bot-h HELD at a 0.58x bound with
#      control at 40 bot-h, and REVERTED at 2.02x with 140. The invented denominator decides
#      the verdict.
#
# What the same measurement says about the live canary, and why this matters today: canary
# 1 death / 56.8 bot-h = 0.018/bh, control 5 deaths / 170.7 bot-h = 0.029/bh. The canary arm
# is SAFER than control. The buggy denominators moved it toward the wrong answer.
#
# So: deaths and exposure now come from the same scan over the same window, and when
# exposure is not measured the gate REFUSES rather than inventing -- death_gate already
# says "no control exposure to compare against", which is the correct outcome.
_cd = h['canary_deaths']
_kd = h.get('control_deaths', 0)
_cbh = im.get('canary_bot_h') or 0.0          # measured, emitted by immobiledid.py:200
_kbh = im.get('control_bot_h') or 0.0
_expo_note = 'exposure from the scheduled read'
if POLL and not DRY:
    _cd = ndeaths                              # the scan is the truth during a poll
    _cbh = _exposure(by, cut)
    _expo_note = f'exposure measured over {len(by)} canary bots since declared_at'
    if _cd >= 2:
        # Only at the floor is control worth 33s of scanning; below it the gate cannot fire.
        _kd = sum(1 for _b, rs in _control_scan().items() for ts, k, _d in rs
                  if k == '_death' and ts > cut)
        _kbh = _exposure(_control_scan(), cut)
        _expo_note += f'; control over {len(_control_scan())} bots'
    else:
        _kbh = 0.0                             # unmeasured, and the gate will say so
        _kd = 0
# v21 (2026-09-18, PROSPECTIVE): the owner's TWO-death floor is untouched; the 1.25x test now
# runs on the one-sided 95% LOWER BOUND of the rate ratio, not the point estimate. The gate is
# polled every 5 min for up to 9 h -- ~108 looks at an event with a null expectation under one
# per canary -- so the point ratio clears 1.25x on ordinary Poisson noise. Calibrated by
# simulation over the measured fleet death process (~/mcai-analysis/calibrate_deathgate.py):
# false revert 43.7% -> 5.0%, detection at swim_to scale (10x) 100% -> 99.9%, at 3x 95% -> 51%.
# The 43.7% reproduces the 46% measured on 2026-09-13, which is the positive control for the
# simulation. It reverted falls-01 -- a REPORT-ONLY instrument -- on 2 idle deaths (one drowning,
# one unknown, no falls) while all 3 CONTROL deaths in the same window were idle drownings.
# v27 (2026-09-24): SAY WHEN LINKAGE WAS NOT AVAILABLE.
#
# The gate has two paths to a revert and always has: the LINKED one (>= 2 canary deaths AND
# a licensed change row, `licence_reverts` in singledeath.py) and the RATE one (>= 2 deaths
# AND the lower bound clears 1.25x). The linked path is the sensitive one -- it fires at two
# deaths without needing the rate to prove anything, which is exactly what a small canary can
# supply. The rate path is the blunt backstop for gross harm.
#
# Measured 2026-09-24: only 7 of 15 registrations declare `change_rows` at all, and the ones
# that do not include falls-01 and the whole rl-08 family. So for more than half of canaries
# the sensitive path was INERT, and every death decision fell to the rate -- which then had
# its threshold tightened on 09-18 to stop the false alarms, leaving the gate tripping on 0
# of 15 historical death reverts. The deafness is the two facts together, not the bound alone.
#
# This does not invent a verdict. It makes the hole visible on the verdict line, because
# "linkage said no" and "there was nothing for linkage to check" are opposite states and the
# old output could not tell them apart -- the exact confusion this project keeps paying for.
if _cd >= 2 and not C_ROWS:
    why.append('LINKAGE UNAVAILABLE: this registration declares no `change_rows`, so the '
               'licensed-row path could not run and this death decision rests on the RATE '
               'alone. A canary that can kill should declare the rows its own change emits; '
               'without them, an unrelated death and a caused one look identical here.')
if _cd >= 2 and _kbh <= 0:
    why.append(f'canary is AT the two-death floor ({_cd} deaths in {_cbh:.1f} measured bot-h) '
               f'but control exposure is UNMEASURED -- there is nothing to compare against, '
               f'and "cannot decide" is not KEEP. Removing the invented control denominator '
               f'(canary x 7.0) must not convert a false REVERT into a false clean.')
    (out('UNREADABLE'))
# v26 (OWNER DECISION 2026-09-24): the trip also needs an IN-WINDOW RANDOMIZATION p.
# The lower bound above is a PARAMETRIC Poisson bound, and deaths are not Poisson across
# worlds: bots in a world share terrain, a seed and a server, so one hazard puts several
# deaths in one pool. Measured on the fixtures in test_deathgate.py, five pools carrying
# three deaths each with the canary holding two of them clears the bound at 1.65x while
# the ranked p is 0.083 -- the bound cannot see clustering and permuting whole pools can.
#
# The unit of randomization is the unit of ASSIGNMENT. A pool-split canary randomizes
# pools; a within-world canary randomizes BOTS inside their worlds, and using pools there
# would put treated and control bots in the same unit and destroy the contrast.
_units = None
_treat = None
if _cd >= 2 and _kbh > 0:
    _within = (man.get('canary_split') == 'within-world')
    _unit_of = (lambda b: b) if _within else pool_of
    _dh = collections.defaultdict(lambda: [0, 0.0])
    for _scan, _isc in ((by, True), (_control_scan(), False)):
        for _b, _rs in (_scan or {}).items():
            if _b == '__empty__':
                continue
            _u = _unit_of(_b)
            _dh[_u][0] += sum(1 for ts, k, _d in _rs if k == '_death' and ts > cut)
            _dh[_u][1] += _exposure({_b: _rs}, cut)
    _units = {u: tuple(v) for u, v in _dh.items()}
    _treat = sorted({_unit_of(b) for b in CANARY_BOTS})
    why.append('randomization units: %d %s, %d treated'
               % (len(_units), 'bots (within-world split)' if _within else 'pools', len(_treat)))
_rev, _why = death_gate(_cd, _cbh, _kd, _kbh, units=_units, treat=_treat)
if _rev: why.append(_why + f' [{_expo_note}]'); (out('REVERT'))
elif _cd >= 2: why.append(_why + f' [{_expo_note}]'); pending_watch.append('death gate held (v21)')
why.append(f"deaths {_cd} ({(_cd / _cbh) if _cbh else 0:.3f}/bh over {_cbh:.1f} measured bot-h) "
           f"vs control {_kd} ({(_kd / _kbh) if _kbh else 0:.3f}/bh over {_kbh:.1f})")
if POLL: why.append(f'poll: {ndeaths} canary deaths since declared_at, {len(linked)} rung-linked, {len(changerow)} with a change row'); (out('POLL_OK', {'deaths': ndeaths}))
# 5. v15c movement guards
v = im['v15c']
# An UNREADABLE v15c string previously matched neither the REVERT nor the WATCH prefix and
# fell through to KEEP. immobiledid emits it when every movement guard is undefined, which is
# exactly when the calibrated decision does not exist.
if v['verdict'].startswith('UNREADABLE'): why.append('v15c ' + v['verdict']); (out('UNREADABLE'))
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
#
# V25: A TYPED THRESHOLD IS NOT EVIDENCE, AND FALLING THROUGH TO KEEP IS NOT A FIX.
# Audited 2026-09-24 over all 23 reverts: 7 were confirmed false and 5 more suspect, and
# the largest single cause was this section -- an `on_fail: REVERT` line reverting on the
# typed comparison ALONE. leaf-01's registered `-0.5` is crossed by 36-49% of its own
# window's null assignments and has no recorded derivation; three reverts sat within
# 1.13-1.31x of their line, which is what the measured 0.0%-12.8% false-positive swing
# produces. 11 of 23 canaries were single-pool, where C(12,1)=12 same-shape assignments is
# below in_window_p's 20-draw minimum, so those could not calibrate a threshold at all.
#
# But demoting to `watch` would be WORSE THAN THE BUG: `watch` is only printed, and control
# falls through to out('KEEP') at the end of this file, so a demoted line would have KEPT
# the change. A Codex pass found that, and it also found that in_window_p RAISES
# DegenerateBlock on 14c662d's shape (three all-zero cells, because the statistic takes
# logs of group rates) -- so "require a p" would not have demoted that correct revert, it
# would have made its p unavailable and KEPT a change whose own instrument misfired 268
# times out of 278.
#
# So a deciding line must now DECLARE what kind of evidence it rests on, and an
# undeclared or unsupported one BLOCKS KEEP instead of deciding either way:
#
#   evidence: 'defect'          -- reverts on the comparison alone. For a reproducible
#                                  implementation fault in the change's own new code, where
#                                  the baseline cell is structurally empty and no noise
#                                  model applies (rl-08 14c662d: 278 refusals, 268 of them
#                                  ordinary terrain, against a clean zero in canary-pre and
#                                  in control in both eras).
#   support: {read, field, max} -- reverts only if that randomization p is PRESENT and <= max.
#                                  For a statistical harm claim (leaf-01, rl-08c).
#   neither                     -- the line still FAILS and is reported, but the verdict is
#                                  INCONCLUSIVE. Not REVERT, because the threshold is not
#                                  evidence; not KEEP, because the line did fail.
#
# Three problems this does NOT solve, named so they are not mistaken for solved (Codex):
# a sign check does not rescue rl-08d, whose registered harmful direction was simply the
# wrong endpoint (explore calls fell significantly while gather ROSE significantly);
# same_shape_assignments enumerates pool combinations without the historical draws' own
# eligibility restrictions; and a per-line, per-read 5% is not a whole-canary 5%.
blocked = []


_CAL_RATIONED = False   # set from the registration before section 8 runs
CAL_MAX_FTR = float(os.environ.get('VERDICT_CAL_MAX_FTR', '0.05'))
# MEASURED 2026-09-24, no longer a placeholder. 19 read anchors (5 of 24 refused as
# unresolved: fewer than 6 pools on a single code version), 200 application draws per anchor,
# 300 calibration draws per cell, statistic = max over the four reads, DiD form. Forward
# transfer, pooled, with cluster-bootstrap 95% CI:
#     0 h 5.7% [3.7, 7.7] | 12 h 6.0% [4.1, 7.9] | 24 h 6.1% [4.4, 7.8]
#    48 h 7.3% [5.3, 9.5] | 72 h 8.0% [5.7, 10.7] | 96 h 5.9% [3.8, 8.5]
# Criterion: the largest lag such that every lag up to it keeps the pooled rate AND its CI
# upper bound under 2x nominal. 48 h passes at 9.5%; 72 h is the first to cross, at 10.7%.
#
# REGISTERED WITH THE CONSTANT: IT BUYS LESS THAN IT LOOKS LIKE. At ZERO age the worst anchor
# realises 14.5%, and six independent fresh calibrations there give 12.0-15.5% -- a property
# of the hours the canary ran in, not of the calibration. Variance: calibration sampling
# 1.7 pp, era of the calibration 3.3 pp (all an age limit can reach), era of the READ 3.5 pp
# (it cannot). Tightening 48 -> 24 -> 12 h moves 6.1% -> 6.0% against 5.7% fresh: nothing.
# The read-window component is what v25's `support: {read, field, max}` already measures.
# The backward cell deliberately does NOT bind: a calibration is only ever applied forward,
# and measured over 19 anchors the two directions are indistinguishable. A drift statistic was
# tested and rejected -- corr(drift, realised false-trip) = -0.097 over 114 cells, no
# relationship and the wrong sign, and matched on how much it admits it equals an age.
CAL_MAX_AGE_H = float(os.environ.get('VERDICT_CAL_MAX_AGE_H', '48'))


def _calibration_ok(rule, now=None):
    """(ok, why) -- may this own-line revert on the strength of a recorded calibration? (v28)

    OWNER DECISION 2026-09-24: a change's OWN alarm may stop its canary. The measured
    argument is owner-01b `aa44514`, whose `refused_actuator_per_bh_canary <= 30` read
    **102.4 at +90 min** -- two hours before the revert and before two of its three deaths --
    and whose `hold_share_canary <= 0.5` read 0.794 at +180. Both were registered
    `on_fail: WATCH`, so the change's own instrument saw the harm first and was gagged.
    That class needs this: 36% of changes emit no new event kind at all, so the
    death-linkage path cannot reach them and an own-line is the only instrument left.

    But a typed threshold is not evidence -- that is what v25 established, after leaf-01's
    `-0.5` was found to be crossed by 36-49% of its own window's null assignments. So a line
    may revert only with a calibration that has been MEASURED on pseudo-canaries: real pools,
    real windows, NO code change, where every trip is by definition false.

    Required, and each absence is a REFUSAL rather than a default, because a missing
    calibration and a passing one must never look alike:

      tool             what measured it (`guardcal.py` draws random two-pool pseudo-canaries)
      draws            how many; too few cannot bound a 5% rate
      at_threshold     MUST EQUAL the registered `value`. A calibration of a different
                       threshold is a calibration of a different rule -- this is the
                       rubber-stamp hole, and equality is the mechanical check that closes it.
      false_trip_rate  <= CAL_MAX_FTR (0.05)
      over_reads       true. THE READ SCHEDULE IS PART OF THE RULE. A rate quoted from a
                       SINGLE read understates the canary's, exactly as
                       calibrate_deathgate.py records for the death gate: it is polled ~108
                       times, and "any false-positive figure quoted from a SINGLE read
                       understates it badly".
      measured_at      not older than CAL_MAX_AGE_H. Calibrations go stale here: wood
                       availability moved 38% -> 9% on identical code, and pools moved -45%
                       to +77% in six hours with no code change.
    """
    cal = rule.get('calibration')
    if not isinstance(cal, dict):
        return False, 'declares evidence=calibrated but carries no `calibration` object'
    miss = [k for k in ('tool', 'draws', 'at_threshold', 'false_trip_rate', 'measured_at')
            if cal.get(k) is None]
    if miss:
        return False, 'calibration is missing ' + ', '.join(miss)
    if cal.get('at_threshold') != rule.get('value'):
        return False, ('calibration is for threshold %r but the line is registered at %r -- '
                       'a calibration of a different threshold is a calibration of a '
                       'different rule' % (cal.get('at_threshold'), rule.get('value')))
    ftr = cal.get('false_trip_rate')
    if not isinstance(ftr, (int, float)) or ftr != ftr:
        return False, 'calibration false_trip_rate is not a number (%r)' % (ftr,)
    # THE POINT ESTIMATE CANNOT FAIL THIS TEST, WHICH MAKES IT NOT A TEST.
    # Found by the closing measurement, 2026-09-24: a registration naturally sets
    # `at_threshold` to its calibration's own 95th percentile, and then the false-trip rate
    # IS 0.0500 by construction -- exactly the ceiling, every time, for any metric. So
    # `ftr > 0.05` can never fire, and the guard that was supposed to reject a line that
    # cries wolf would have waved through every line ever calibrated that way.
    #
    # So the CONFIDENCE BOUND must clear the ceiling, not the estimate. At 800 draws the p95
    # threshold's realised rate was 0.0500 with a 95% CI of [0.037, 0.067] -- refused, as it
    # should be -- while the p97 threshold gave 0.0288 with [0.019, 0.043], which clears.
    # An absent bound is a REFUSAL, not a pass: a calibration that does not say how precise
    # it is has not said anything a gate can act on.
    ub = cal.get('false_trip_rate_ci_upper')
    if ub is None:
        return False, ('calibration reports false_trip_rate %.4f with no '
                       '`false_trip_rate_ci_upper` -- a registration that sets its threshold '
                       'at its own p95 gets 0.0500 BY CONSTRUCTION, so the point estimate '
                       'cannot fail this check and is not evidence of precision' % (ftr,))
    if not isinstance(ub, (int, float)) or ub != ub:
        return False, 'calibration false_trip_rate_ci_upper is not a number (%r)' % (ub,)
    if ub < ftr:
        return False, ('calibration false_trip_rate_ci_upper %.4f is BELOW the point estimate '
                       '%.4f -- that is not an upper bound' % (ub, ftr))
    if ub > CAL_MAX_FTR:
        return False, ('calibration false-trip 95%% upper bound %.4f > %.2f (point estimate '
                       '%.4f) -- this line cries wolf too often to stop a canary, and the '
                       'point estimate alone cannot show otherwise' % (ub, CAL_MAX_FTR, ftr))
    # (no separate point-estimate ceiling: `ub >= ftr` and `ub <= CAL_MAX_FTR` together give
    #  `ftr <= CAL_MAX_FTR`, so a point-estimate check here would be provably unreachable --
    #  a guard that can never fire reads as protection and is not.)
    # A ZERO-HEAVY CALIBRATION IS NOT A CALIBRATION (Codex, 2026-09-24). The pseudo-canaries
    # run the OLD code, so a line measuring something only the NEW code can produce scores a
    # 0% false-trip rate FOR FREE -- and that is exactly the class this change was made for.
    # owner-01b's `refused_actuator_per_bh_canary` counts refusals by an attributed gate the
    # baseline does not have, so no pseudo-canary can ever breach it and the ceiling above is
    # satisfied vacuously. It is the same trap as a treatment-introduced change row having
    # lambda = 0 on control by construction.
    #
    # So the calibration must say how many draws produced a DEFINED, NON-ZERO baseline value.
    # If the metric does not exist on the baseline, the honest class is `evidence: defect` --
    # "the new code does a dangerous thing N times against a structurally empty baseline",
    # which is rl-08 14c662d's shape and which reverts on the comparison alone. Dressing that
    # up as a statistical calibration claims power it does not have.
    # A CANARY-ONLY LEVEL MAY NEVER REVERT (measured 2026-09-24, 800 pseudo-canary draws).
    # A level threshold is a bet that the FLEET does not drift, and this fleet drifts. The one
    # registered level line that could be reconstructed, `nopath_per_bh_canary <= 24` (rl-13,
    # -13b, -13c), false-tripped 11.2-19.8% over 09-16..09-20 and 48.8-53.0% over
    # 09-20..09-24 -- IDENTICAL CODE, the fleet's no-path rate simply doubled in four days and
    # the threshold never moved. A level threshold also fails a 48 h transfer (up to 21.0%,
    # 4.2x nominal) where a DiD holds (<= 12.0%, mostly 3-7%).
    #
    # And a DiD costs nothing for the case this class exists for: owner-01b's own quantity was
    # 102.4 canary-post against zero in canary-pre and in control both eras, so its DiD is
    # +102.4 -- numerically identical to the level. The level form buys nothing and bets on
    # stationarity the fleet does not have.
    if cal.get('form') != 'did':
        return False, ('calibration form is %r, and only `did` may revert. A canary-only '
                       'LEVEL is a bet that the fleet does not drift: measured, the one '
                       'registered level line false-tripped 11-20%% one week and 49-53%% the '
                       'next on IDENTICAL code, because the fleet no-path rate doubled. A DiD '
                       'is numerically identical for a change-introduced quantity, so nothing '
                       'is lost by requiring it.' % (cal.get('form'),))
    nz = cal.get('nonzero_draws')
    if nz is None:
        return False, ('calibration does not report `nonzero_draws` -- a line measuring '
                       'something only the NEW code emits gets a 0%% false-trip rate for '
                       'free, so the ceiling above proves nothing without it')
    try:
        nzf = float(nz) / float(cal['draws']) if float(cal['draws']) else 0.0
    except Exception:
        return False, 'calibration draws/nonzero_draws are not numbers (%r/%r)' % (cal.get('draws'), nz)
    if nzf < 0.10:
        return False, ('calibration is DEGENERATE: only %s of %s pseudo-canary draws produced '
                       'a defined non-zero baseline value (%.1f%%), so this metric barely '
                       'exists on the old code and its 0%% false-trip rate is vacuous. A line '
                       'the baseline cannot produce belongs in `evidence: defect`, which '
                       'reverts on the comparison against a structurally empty baseline.'
                       % (nz, cal.get('draws'), 100 * nzf))
    if not cal.get('over_reads'):
        return False, ('calibration does not claim `over_reads` -- a rate from a SINGLE read '
                       'understates the canary, which is polled at every registered read')
    try:
        mt = dt.datetime.fromisoformat(str(cal['measured_at']).replace('Z', '+00:00'))
        age = ((now or dt.datetime.now(dt.timezone.utc)) - mt).total_seconds() / 3600.0
    except Exception as e:
        return False, 'calibration measured_at is unreadable (%r: %s)' % (cal.get('measured_at'), e)
    if age > CAL_MAX_AGE_H:
        return False, ('calibration is %.1f h old (limit %.0f h) -- pools moved -45%% to '
                       '+77%% in six hours with no code change, so a stale calibration is '
                       'not a calibration' % (age, CAL_MAX_AGE_H))
    return True, ('calibration: %s, %s draws, false-trip %.4f <= %.2f at threshold %r, over '
                  'the read schedule, %.1f h old' % (cal.get('tool'), cal.get('draws'), ftr,
                                                     CAL_MAX_FTR, cal.get('at_threshold'), age))


def _deciding_evidence(rule, kind):
    """Can this failed `on_fail: REVERT` rule license a REVERT? (v25)

    Returns (may_revert, note). Pure apart from `ev`, so the reason is always printed.
    """
    if rule.get('evidence') == 'defect':
        return True, f'{kind} declares evidence=defect: the typed comparison decides'
    if rule.get('evidence') == 'calibrated':
        # THE RATION IS CHECKED HERE, not only reported. The first draft appended to
        # `blocked` before the loop and the FIRST failing line still reverted, because
        # out('REVERT') exits the process before `blocked` is ever read. A guard that runs
        # after the decision is not a guard.
        if _CAL_RATIONED:
            return False, (f'{kind} evidence=calibrated, but this registration declares MORE '
                           f'THAN ONE calibrated REVERT line -- the reads multiply, so none of '
                           f'them may decide')
        _ok, _cw = _calibration_ok(rule)
        return _ok, f'{kind} evidence=calibrated -- {_cw}'
    sup = rule.get('support')
    if not sup:
        return False, (f'{kind} declares no evidence class (no `evidence: defect`, no '
                       f'`support: {{read, field, max}}`): a typed threshold is not evidence, '
                       f'so this blocks KEEP rather than reverting')
    pv = ev.get(sup['read'], {}).get(sup['field'])
    if pv is None or (isinstance(pv, float) and pv != pv):
        return False, (f"{kind} support {sup['read']}.{sup['field']} is {pv!r} -- the "
                       f'randomization p is unavailable, so harm is not established')
    if pv > sup['max']:
        return False, (f"{kind} support {sup['read']}.{sup['field']} = {pv} > {sup['max']}: "
                       f'the move is inside its own window\'s null spread')
    return True, f"{kind} support {sup['read']}.{sup['field']} = {pv} <= {sup['max']}"


# v28: AT MOST ONE CALIBRATED LINE MAY DECIDE. THE READS MULTIPLY.
#
# owner-01b declared THREE own-lines and the loop reads them at +30/+90/+180 -- nine chances
# to revert. Nine independent 5% tests is not a 5% canary; it is 1 - 0.95**9 = 37%. The death
# gate already encodes this lesson: calibrate_deathgate.py exists because the gate is polled
# ~108 times and "any false-positive figure quoted from a SINGLE read understates it badly".
#
# So the calibrated class is rationed rather than budgeted per line: exactly one line may
# carry `evidence: calibrated` with `on_fail: REVERT`, and it is the registration's ONE
# pre-declared deciding alarm. Declaring several is a registration error, not a stricter
# canary -- and it BLOCKS KEEP rather than picking one, because picking one silently would let
# the choice be made by dict order after the data was seen.
_cal_rev = [l for l in (reg.get('own_lines') or []) + (reg.get('friction') or [])
            if l.get('evidence') == 'calibrated' and l.get('on_fail') == 'REVERT']
_CAL_RATIONED = len(_cal_rev) > 1
if _CAL_RATIONED:
    why.append('MORE THAN ONE calibrated REVERT line declared (%s) -- the reads multiply, so '
               'nine 5%% tests is a 37%% canary. Declare ONE deciding alarm.'
               % ', '.join('%s.%s' % (l.get('read'), l.get('field')) for l in _cal_rev))
    blocked.append('multiple-calibrated-revert-lines')

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
        if ln['on_fail'] == 'REVERT':
            _may, _note = _deciding_evidence(ln, f"own line {ln['read']}.{ln['field']}")
            why.append(_note)
            if _may: (out('REVERT'))
            blocked.append(f"{ln['read']}.{ln['field']}")
        watch.append(f"{ln['field']}")
# 8b. FRICTION -- a registered comparison between two fields of the same read.
#
# This section has been declarable since the registration format existed and verdict.py
# never contained the string `friction`, so every friction rule ever written silently did
# not run. recovery-ladder-1011b registered one (pocketread hold_release canary vs control,
# pp>= -0.3, on_fail WATCH) and it was never evaluated; that canary was read as if a
# registered guard had passed. banktruth-01's friction is [] so nothing changes for the
# canary in flight.
#
# Undefined values take the SAME path as own_lines: absent is not failing. `pp>=` compares
# a difference in percentage points, which is what the registrations that use it mean --
# both fields are shares, and the rule asks that canary not fall more than `value` points
# below control.
for fr in reg.get('friction', []):
    a = ev.get(fr['read'], {}).get(fr['field'])
    b = ev.get(fr['read'], {}).get(fr['vs'])
    bad = [n for n, v in ((fr['field'], a), (fr['vs'], b))
           if v is None or (isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))))]
    if bad:
        if fr.get('nullable'): continue
        why.append(f"friction {fr['read']}.{'/'.join(bad)} is undefined, not a failure"); (out('UNREADABLE'))
    d = a - b
    ok = {'pp>=': d >= fr['value'], '>=': d >= fr['value'], '<=': d <= fr['value']}[fr['op']]
    if not ok:
        why.append(f"friction {fr['read']}.{fr['field']} - {fr['vs']} = {d:+.3f} "
                   f"fails {fr['op']} {fr['value']}")
        if fr.get('on_fail') == 'REVERT':
            _may, _note = _deciding_evidence(fr, f"friction {fr['read']}.{fr['field']}")
            why.append(_note)
            if _may: (out('REVERT'))
            blocked.append(f"friction:{fr['read']}.{fr['field']}")
        watch.append(f"friction:{fr['field']}")

# 8c. SAY WHAT THIS GATE DID NOT EVALUATE.
# A registration may declare sections that verdict.py does not act on -- `primary`, `watch`
# and `mechanism_check` are read by a human, by design. The failure mode is not that they
# exist, it is that their absence from the decision was invisible: nothing in a KEEP said
# which registered sections it did NOT cover, so `friction` going unimplemented for the
# format's whole life looked exactly like `friction` passing. Naming them on every verdict
# costs one line and makes that impossible.
_EVALUATED = {'reads', 'read_minutes', 'exposure', 'own_lines', 'friction', 'change_rows',
              'linkage_extra', 'ladder_change', 'sha', 'run_id', 'extension'}
_ADVISORY = {'primary', 'watch', 'mechanism_check', 'notes', 'note', 'registered_at',
             'promotion', 'deadline_min', 'teardown', 'known_residuals',
             'operator_note_loop_behaviour', 'timestamp_correction', 'notes_superseded',
             'manifest_note_is_stale'}
_unevaluated = sorted(k for k, v in reg.items()
                      if k not in _EVALUATED and v not in (None, [], {}, ''))
if _unevaluated:
    why.append('NOT evaluated by this gate (registered, decided elsewhere or not at all): '
               + ', '.join(_unevaluated))

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
if blocked:
    why.append('a deciding line FAILED but its evidence class does not license a REVERT: '
               + ', '.join(blocked) + ' -- INCONCLUSIVE, not KEEP')
    (out('INCONCLUSIVE'))
(out('KEEP'))
