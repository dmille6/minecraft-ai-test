#!/usr/bin/env python3
"""bagfixgate.py -- the BAG-FIX death rule's loop half (OWNER DECISION 2026-10-07). Part of the gate bundle.

    bagfixgate.py extend-check <run_id> <M>   the loop's verdict at minute M (0 = the death poll) was REVERT:
                                              may this bag fix EXTEND instead?          -> BAGFIX EXTEND|REVERT
    bagfixgate.py poll <run_id>               one poll during the extension, (a)/(b)    -> BAGFIX CONTINUE|REVERT|UNREADABLE
    bagfixgate.py final <run_id>              at +1440: (a)/(b) again, then (c), coverage, exposure, the bag metric
                                                                        -> BAGFIX KEEP|REVERT|INCONCLUSIVE (NOT_YET early)
    bagfixgate.py check-registration <run_id> launch preflight for a bag-fix registration -> BAGFIX OK|REFUSED
    bagfixgate.py window <pools> <from-iso> <until-iso> <kind,kind> [<ctl-deaths> <ctl-bot-h>]
                                              backtest helper: deaths, linkage and the at-trip answer for a past window

ONE LINE ON STDOUT, LAST: `BAGFIX <WORD> (+M) :: reasons`. The loop takes `awk '$1=="BAGFIX"{print $2}'` -- the
field, never a substring of the line (the 09-29 `*KEEP*` lesson). Every decision is in bagfixrule.py (pure, tested);
this file only measures. A JSON artifact is written to <reads>/<run>-bagfix-<cmd>-<M>.json.

WHAT IT MEASURES, AND WITH WHAT ESTIMATOR.
  deaths / exposure  canary = bots in the manifest's canary membership, control = every other bot; deaths are `_death`
                     rows after declared_at; exposure is the summed per-bot observed span since declared_at --
                     DELIBERATELY verdict.py's `_exposure` estimator, so the gate that tripped and this rule cannot
                     disagree about a denominator. A log file that cannot be read is COUNTED (`errors`) and makes the
                     measurement unreadable -- never a silent zero.
  linkage            a death is LINKED when the same bot has a row of the fix's own kinds (registration
                     bag_fix.own_kinds, else its change_rows) whose [start, start + duration] meets the 120 s before
                     the death. POSITIVE CONTROL: own rows on >= 2 canary bots, else "0 linked" is not evidence.
  p_link             own rows per canary bot-h, counting only rows OUTSIDE the 120 s before any canary death.
  value (final)      bagfixrule.accumulate() -- the SAME estimator the null band was computed with -- over 24 h POST vs
                     24 h PRE, canary vs control, net of what was carried into deaths, per bot-h; a coverage check
                     (inventory snapshots per bot-h, bags on deaths) turns missing telemetry into INCONCLUSIVE.

Overrides (tests and replays only; production passes none): BAGFIX_LOG_ROOT, BAGFIX_MANIFEST, BAGFIX_REG_DIR,
BAGFIX_READS_DIR, BAGFIX_JOURNAL, BAGFIX_NOW (ISO, or @file for a replay's fake clock).
"""
import sys, os, json, glob, gzip, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
# Resolution order, highest first: THIS file's directory (on the host that is ~/mcai-analysis, where the loop runs
# it, so the decision module beside it is the one the gate digest hashed), then ~/mcai-analysis, then the first lib
# directory verdict.py would pick (canary_manifest / version_split).
_lib = next((p for p in (os.path.join(HERE, 'lib'), '/home/mike/mcai-analysis/lib', '/opt/minecraft-ai/scripts/lib')
             if os.path.isdir(p)), None)
for _p in reversed([HERE, '/home/mike/mcai-analysis', _lib]):
    if _p and os.path.isdir(_p):
        if _p in sys.path:
            sys.path.remove(_p)
        sys.path.insert(0, _p)
import bagfixrule as BR
from deathgate import death_gate, ratio_lower_bound

LOGROOT = os.environ.get('BAGFIX_LOG_ROOT') or '/var/log/mcai'
MANIFEST = os.environ.get('BAGFIX_MANIFEST') or '/srv/mcbots/trial-manifest.json'
REGDIR = os.environ.get('BAGFIX_REG_DIR') or os.path.expanduser('~/mcai-analysis/registrations')
READS = os.environ.get('BAGFIX_READS_DIR') or os.path.expanduser('~/digest/reads')
JOURNAL = os.environ.get('BAGFIX_JOURNAL') or os.path.expanduser('~/canary-journal.jsonl')
LEAD_S = 6 * 3600  # the value walk starts this long before a window and runs TAIL_S past its end, so the previous
TAIL_S = 600       # snapshot and the next observation are seen as in the continuous calibration walk (round 1 found a
                   # 10 log-eq edge mismatch; round 2 a 16-min gap still mismatched at 15 min). A bot silent for > 6 h
                   # before a window starts that window with no predecessor -- in both walks alike only if the
                   # calibration also had none, which the boundary test pins for gaps under 6 h.


def now():
    """The clock. BAGFIX_NOW=<iso> freezes it (a backtest window); BAGFIX_NOW=@<file> reads epoch seconds from the
    file canary-loop.sh's CANARY_FAKE_CLOCK advances (an end-to-end replay). Production sets neither."""
    s = os.environ.get('BAGFIX_NOW')
    if s and s.startswith('@'):
        return dt.datetime.fromtimestamp(float(open(s[1:]).read().strip()), dt.timezone.utc)
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00')) if s else dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')


def epoch(ts):
    return dt.datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()


def ts_of(line):
    """'@timestamp' is the first key the logger writes: {"@timestamp":"2026-10-07T19:46:11.908Z",...}"""
    i = line.find('"@timestamp":"')
    return line[i + 14:i + 38] if 0 <= i < 8 else ''


def all_bots():
    return sorted({os.path.basename(b.rstrip('/')) for b in glob.glob(f'{LOGROOT}/*-*/')})


def files(bot, since):
    out = []
    for f in sorted(glob.glob(f'{LOGROOT}/{bot}/skill-*.jsonl') + glob.glob(f'{LOGROOT}/{bot}/skill-*.jsonl-*')):
        try:
            # rotation-aware: a rotated file cannot hold rows newer than its mtime
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < since:
                continue
        except OSError:
            continue
        out.append(f)
    return out


def lines(bot, since, until, errors):
    """Every raw line of one bot's skill logs with since <= @timestamp < until; a file that cannot be read adds to
    errors[0] instead of vanishing."""
    lo, hi = iso(since), iso(until)
    for f in files(bot, since):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for l in fh:
                    ts = ts_of(l)
                    if ts and lo <= ts[:19] < hi:
                        yield ts, l
        except (OSError, EOFError, gzip.BadGzipFile) as e:
            errors[0] += 1
            sys.stderr.write('bagfixgate: unreadable %s: %s\n' % (f, e))


def scan(bot, since, until, kinds=(), errors=None):
    """-> (first_ts, last_ts, deaths [ts], own [(t_epoch, dur_s)]) for one bot in [since, until)."""
    errors = errors if errors is not None else [0]
    needles = ['"name":"%s"' % k for k in kinds]
    first = last = None; deaths = []; own = []; seen = set()
    for ts, l in lines(bot, since, until, errors):
        if first is None or ts < first: first = ts
        if last is None or ts > last: last = ts
        if '"name":"_death"' in l:
            if ts not in seen:
                seen.add(ts); deaths.append(ts)
        elif needles and any(n in l for n in needles):
            try:
                r = json.loads(l)
            except ValueError:
                continue
            sk = r.get('skill') or {}
            if sk.get('name') in kinds:
                own.append((epoch(ts), (sk.get('duration_ms') or 0) / 1000.0))
    return first, last, sorted(deaths), sorted(set(own))


def span_h(first, last):
    if not first or not last:
        return 0.0
    return max(0.0, (epoch(last) - epoch(first)) / 3600.0)


def measure(canary_bots, control_bots, since, until, kinds, fresh=False):
    """Deaths, exposure and linkage for both arms over [since, until). fresh=True also reports, per arm, the share of
    bots seen in the window whose last row is within FRESH_S of `until` (stale telemetry, round 2)."""
    err = [0]
    cd = 0; cbh = 0.0; linked = []; own_n = 0; free_own = 0; own_bots = 0
    seen_c = fresh_c = seen_k = fresh_k = 0
    edge = until.timestamp() - BR.FRESH_S
    for b in canary_bots:
        f, l, ds, own = scan(b, since, until, kinds, err)
        cbh += span_h(f, l); cd += len(ds); own_n += len(own); own_bots += bool(own)
        if l:
            seen_c += 1; fresh_c += epoch(l) >= edge
        dts = [epoch(x) for x in ds]
        for x, t in zip(ds, dts):
            if BR.death_linked(t, own):
                linked.append((b, x[11:19]))
        # own rows OUTSIDE the 120 s before any of this bot's deaths: the death-free emission rate
        free_own += sum(1 for (t, _d) in own if not any(0 <= dd - t <= BR.LINK_WINDOW_S for dd in dts))
    kd = 0; kbh = 0.0
    for b in control_bots:
        f, l, ds, _ = scan(b, since, until, (), err)
        kbh += span_h(f, l); kd += len(ds)
        if l:
            seen_k += 1; fresh_k += epoch(l) >= edge
    pl = BR.p_link(free_own / cbh) if cbh > 0 else None
    return {'cd': cd, 'cbh': cbh, 'kd': kd, 'kbh': kbh, 'linked': len(linked), 'linked_at': linked, 'own_rows': own_n,
            'own_bots': own_bots, 'own_rows_free': free_own, 'p_link': pl, 'errors': err[0],
            'fresh_canary': (fresh_c / seen_c if seen_c else 0.0) if fresh else None,
            'fresh_control': (fresh_k / seen_k if seen_k else 0.0) if fresh else None,
            'n_canary_bots': len(canary_bots), 'n_control_bots': len(control_bots)}


def own_kinds(reg):
    bf = reg.get('bag_fix') if isinstance(reg.get('bag_fix'), dict) else {}
    ks = bf.get('own_kinds') or reg.get('change_rows') or []
    # a declared change row may be a skill (no underscore) or an event ('_x'); accept both spellings
    out = set()
    for k in ks:
        out.add(k); out.add(k.lstrip('_')); out.add('_' + k.lstrip('_'))
    return tuple(sorted(out))


def membership(man):
    """verdict.py's membership (canary_manifest.members_of + version_split.in_canary_pool). Off the host the repo's
    lib may predate in_canary_pool; then ONLY a legacy pool-list declaration is read, by the same exact-prefix rule,
    and a within-world split is refused rather than guessed."""
    bots = all_bots()
    try:
        from canary_manifest import members_of
        from version_split import in_canary_pool
        mem = members_of(man)
        can = [b for b in bots if in_canary_pool(b, mem)]
    except ImportError:
        if man.get('canary_split'):
            raise RuntimeError('split canary declared but canary_manifest/version_split are not importable here')
        ps = [p.strip() for p in str(man.get('canary_pool') or '').split(',') if p.strip()]
        can = [b for b in bots if any(b.startswith(p + '-') for p in ps)]
    return can, [b for b in bots if b not in set(can)]


def emit(run, cmd, M, word, why, extra):
    o = {'run_id': run, 'cmd': cmd, 'window_min': M, 'word': word, 'why': why, 'at': now().isoformat(), 'extra': extra}
    try:
        os.makedirs(READS, exist_ok=True)
        json.dump(o, open(os.path.join(READS, f'{run}-bagfix-{cmd}-{M}.json'), 'w'), indent=1, default=str)
    except Exception as e:
        why = why + ' | artifact not written: %s' % e
    print('BAGFIX %s (+%d) :: %s' % (word, M, why.replace('\n', ' ')))
    return 0


def load(run):
    reg = json.load(open(os.path.join(REGDIR, f'{run}.json')))
    man = json.load(open(MANIFEST))
    return reg, man


def bound(reg, man, run):
    """The manifest must be THIS canary: same run, same sha. Anything else is refused, never guessed."""
    if man.get('run_id') != run or (man.get('canary_code_version') or '')[:7] != str(reg.get('sha', ''))[:7]:
        return 'manifest is not this canary (run %r sha %r vs %r %r)' % (man.get('run_id'), man.get('canary_code_version'),
                                                                         run, reg.get('sha'))
    if not man.get('canary_pool'):
        return 'manifest declares no canary_pool'
    return None


def declared(man):
    return dt.datetime.fromisoformat(str(man['declared_at']).replace('Z', '+00:00'))


def extended(run):
    """True when the journal records this run's extension (the loop writes phase `bagfix-extend`)."""
    try:
        for l in open(JOURNAL):
            if '"run":"%s"' % run in l and '"phase":"bagfix-extend"' in l:
                return True
    except OSError:
        pass
    return False


def _summary(m, lb):
    return ('%d canary deaths in %.1f bot-h vs %d control in %.1f; lower bound %s; linked %s; own rows %d on %d bots '
            '(%d death-free), p_link %s; %d log error(s)'
            % (m['cd'], m['cbh'], m['kd'], m['kbh'], 'n/a' if lb is None else '%.2fx' % lb, m['linked_at'] or 'none',
               m['own_rows'], m['own_bots'], m['own_rows_free'], 'n/a' if m['p_link'] is None else '%.3f' % m['p_link'],
               m['errors']))


def cmd_extend_check(run, M):
    reg, man = load(run)
    if not BR.is_bag_fix(reg):
        return emit(run, 'extend', M, 'REVERT', 'not a bag fix (registration class %r): the gate decides as before' % reg.get('class'), {})
    b = bound(reg, man, run)
    if b:
        return emit(run, 'extend', M, 'REVERT', 'REFUSED to extend: ' + b, {})
    vp = os.path.join(READS, f'{run}-verdict-{M}.json')
    try:
        v = json.load(open(vp))
        age = (now() - dt.datetime.fromisoformat(v['at'])).total_seconds() / 60
    except Exception as e:
        return emit(run, 'extend', M, 'REVERT', 'verdict artifact %s unreadable (%s): the gate stands' % (vp, e), {})
    if v.get('verdict') != 'REVERT' or v.get('run_id') != run or v.get('window_min') != M or not (0 <= age <= 15):
        return emit(run, 'extend', M, 'REVERT', 'verdict artifact is not a fresh REVERT for this run at +%d (%s, %.0f min '
                    'old): the gate stands' % (M, v.get('verdict'), age), {})
    ex = v.get('extra') or {}
    by = ex.get('by')
    gate = {k: ex.get(k) for k in ('cd', 'cbh', 'kd', 'kbh')} if 'cd' in ex else None
    can, ctl = membership(man)
    m = measure(can, ctl, declared(man), now(), own_kinds(reg))
    ceil = BR.ceiling_trips(m['cd'], m['cbh'], m['kd'], m['kbh'], ratio_lower_bound)
    word, why = BR.at_trip(reg, by, m, gate, ceil)
    why += ' | ' + _summary(m, ceil[1]) + (' | gate counted %s' % gate if gate else '')
    return emit(run, 'extend', M, word, why, dict(m, by=by, gate=gate, lb=ceil[1], kinds=own_kinds(reg)))


def poll_measure(reg, man, until, fresh=True):
    can, ctl = membership(man)
    m = measure(can, ctl, declared(man), until, own_kinds(reg), fresh=fresh)
    ceil = BR.ceiling_trips(m['cd'], m['cbh'], m['kd'], m['kbh'], ratio_lower_bound)
    return m, ceil, BR.extended_poll(m, ceil)


def cmd_poll(run):
    reg, man = load(run)
    b = bound(reg, man, run)
    if b:
        return emit(run, 'poll', 0, 'UNREADABLE', b, {})
    if not BR.is_bag_fix(reg) or not extended(run):
        return emit(run, 'poll', 0, 'UNREADABLE', 'no recorded bag-fix extension for %s: this poll does not apply' % run, {})
    m, ceil, (word, why) = poll_measure(reg, man, now())
    M = int((now() - declared(man)).total_seconds() // 60)
    why += ' | +%d of %d min | %s' % (M, BR.EXTEND_MIN, _summary(m, ceil[1]))
    return emit(run, 'poll', 0, word, why, dict(m, lb=ceil[1]))


# ---------------------------------------------------------------------------------------------- the value read
def value_obs(bot, since, until, errors):
    """One bot's observations for accumulate(), from LEAD_S before `since` to TAIL_S after `until`, through
    bagfixrule.to_obs (re-timing, transfer intervals) exactly as the calibration walk."""
    rows = []; seen = set()
    for ts, l in lines(bot, since - dt.timedelta(seconds=LEAD_S), until + dt.timedelta(seconds=TAIL_S), errors):
        try:
            r = json.loads(l)
        except ValueError:
            # a malformed DEATH row is a measurement error (its bag would vanish from (c); round 4, Codex). Other
            # malformed rows only lose one snapshot, which the net-change walk carries over: measured 15 in 2.36 M
            # rows over 10-06/07 on the fleet, all torn writes at the 10-06 outage -- tolerated, not fatal.
            if '"name":"_death"' in l and iso(since) <= ts[:19] < iso(until):   # only inside the measured span
                errors[0] += 1
            continue
        sk = r.get('skill') or {}; kind = sk.get('name') or ''
        t = epoch(ts)
        key = (t, kind, (sk.get('detail') or '')[:400])
        if key in seen:
            continue
        seen.add(key)
        dur = (sk.get('duration_ms') or 0) / 1000.0
        bt = r.get('bot') or {}
        inv = bt.get('inventory') if isinstance(bt.get('inventory'), dict) else None
        if inv is None or bt.get('health') is None:
            rows.append((t, kind, dur, None, None))
        else:
            tl = bt.get('tools') if isinstance(bt.get('tools'), dict) else {}
            rows.append((t, kind, dur, BR.bag_value(inv, tl), BR.iron_units(inv, tl)))
    return BR.to_obs(rows)


def arm_windows(bots, windows, errors):
    """{window name: totals} for one arm; each bot walked ONCE across all windows (continuous, as calibrated)."""
    lo = min(a for a, _z in windows.values()); hi = max(z for _a, z in windows.values())
    tot = {w: dict(sec=0.0, vg=0.0, vl=0.0, ig=0.0, il=0.0, deaths=0, deaths_with_inv=0, inv_obs=0) for w in windows}
    for b in bots:
        for (t, sec, dv, di, vl, il, death, dinv, invo) in BR.accumulate(value_obs(b, lo, hi, errors)):
            for w, (a, z) in windows.items():
                if a.timestamp() <= t < z.timestamp():
                    x = tot[w]
                    x['sec'] += sec; x['vg'] += dv; x['vl'] += vl; x['ig'] += di; x['il'] += il
                    x['deaths'] += death; x['deaths_with_inv'] += dinv; x['inv_obs'] += invo
    out = {}
    for w, x in tot.items():
        h = x['sec'] / 3600.0
        out[w] = dict(x, bot_h=h, net=(x['vg'] - x['vl']) / h if h else None, iron=(x['ig'] - x['il']) / h if h else None)
    return out


def did(a, b, c, d, key):
    xs = [a[key], b[key], c[key], d[key]]
    if any(x is None for x in xs):
        return None
    return (xs[0] - xs[1]) - (xs[2] - xs[3])


def primary_at_final(run, reg, man):
    """The registration's own bag metric from its read AT +1440 (run by the loop just before `final`), bound to this
    canary and fresh -- never a +360 file, never an unbound one. -> (moved True/False/None, why)."""
    spec = (reg.get('bag_fix') or {}).get('primary') if isinstance(reg.get('bag_fix'), dict) else None
    if not isinstance(spec, dict) or not spec.get('read'):
        return None, 'no bag_fix.primary registered'
    p = os.path.join(READS, f"{run}-{spec['read']}-{BR.EXTEND_MIN}.json")
    try:
        o = json.load(open(p))
        age = (now() - dt.datetime.fromisoformat(o['emitted_at'])).total_seconds() / 60
    except Exception as e:
        return None, 'primary evidence %s unreadable (%s)' % (p, type(e).__name__)
    ok, why = BR.evidence_bound(o, reg, man, BR.EXTEND_MIN, age)
    if not ok:
        return None, 'primary evidence not usable: ' + why
    moved = BR.primary_moved(o['fields'], spec)
    return moved, '%s = %r (edge %s %s)' % (spec.get('field'), o['fields'].get(spec.get('field')), spec.get('op'), spec.get('value'))


def cmd_final(run):
    reg, man = load(run)
    b = bound(reg, man, run)
    if b:
        return emit(run, 'final', BR.EXTEND_MIN, 'INCONCLUSIVE', b, {})
    if not BR.is_bag_fix(reg) or not extended(run):
        return emit(run, 'final', BR.EXTEND_MIN, 'INCONCLUSIVE', 'no recorded bag-fix extension for %s' % run, {})
    cut = declared(man); end = cut + dt.timedelta(minutes=BR.EXTEND_MIN); pre = cut - dt.timedelta(minutes=BR.EXTEND_MIN)
    if now() < end:
        # NOT terminal: the loop retries (clock skew must not close an extension early)
        return emit(run, 'final', BR.EXTEND_MIN, 'NOT_YET', 'final asked before +%d (now +%.0f): refusing a short read'
                    % (BR.EXTEND_MIN, (now() - cut).total_seconds() / 60), {})
    # (a)/(b) on the whole 24 h FIRST: deaths after the last poll are not skipped
    m, ceil, poll = poll_measure(reg, man, end, fresh=False)   # the window is closed: freshness is a live-poll test
    can, ctl = membership(man)
    err = [0]
    W = {'pre': (pre, cut), 'post': (cut, end)}
    ca, ka = arm_windows(can, W, err), arm_windows(ctl, W, err)
    cov = BR.coverage_ok({'canary PRE': ca['pre'], 'canary POST': ca['post'], 'control PRE': ka['pre'], 'control POST': ka['post']})
    if err[0]:
        cov = (False, '%d unreadable file(s) or malformed row(s) in the value walk' % err[0])
    elif ca['post']['deaths'] < m['cd'] or ka['post']['deaths'] < m['kd']:
        # the value walk must see every death the death scan counted, or bags carried into the missing ones vanish
        cov = (False, 'value walk saw %d/%d POST deaths, the death scan %d/%d (canary/control)'
               % (ca['post']['deaths'], ka['post']['deaths'], m['cd'], m['kd']))
    net, iron = did(ca['post'], ca['pre'], ka['post'], ka['pre'], 'net'), did(ca['post'], ca['pre'], ka['post'], ka['pre'], 'iron')
    moved, pwhy = primary_at_final(run, reg, man)
    word, why = BR.final(poll, ca['post']['bot_h'], cov, moved, net, BR.NET_P025, iron, BR.IRON_P025)
    why += (' | (a)/(b): %s | canary %.0f bot-h, net %s -> %s; control net %s -> %s (log-eq/bot-h, PRE -> POST) | '
            'primary: %s' % (poll[1], ca['post']['bot_h'], _f(ca['pre']['net']), _f(ca['post']['net']),
                             _f(ka['pre']['net']), _f(ka['post']['net']), pwhy))
    return emit(run, 'final', BR.EXTEND_MIN, word, why, {'deaths': m, 'canary': ca, 'control': ka, 'net_did': net,
                                                         'iron_did': iron, 'coverage': cov, 'primary_moved': moved,
                                                         'next_slot': BR.NEXT_SLOT if word == 'KEEP' else None})


def _f(x):
    return 'n/a' if x is None else '%+.2f' % x


def cmd_check_registration(run):
    reg = json.load(open(os.path.join(REGDIR, f'{run}.json')))
    bad = BR.registration_problems(reg)
    if bad:
        return emit(run, 'registration', 0, 'REFUSED', '; '.join(bad), {'problems': bad})
    return emit(run, 'registration', 0, 'OK', 'bag-fix registration well-formed' if BR.is_bag_fix(reg) else 'not a bag fix', {})


def cmd_window(pools, a, z, kinds, ctl_d=None, ctl_h=None):
    """Backtest helper: a past canary's window, read the way extend-check reads a live one."""
    since = dt.datetime.fromisoformat(a.replace('Z', '+00:00')); until = dt.datetime.fromisoformat(z.replace('Z', '+00:00'))
    ps = [p.strip() for p in pools.split(',') if p.strip()]
    bots = all_bots()
    can = [b for b in bots if any(b.startswith(p + '-') for p in ps)]
    ks = set()
    for k in kinds.split(','):
        if k:
            ks |= {k, k.lstrip('_'), '_' + k.lstrip('_')}
    m = measure(can, [] if ctl_d is not None else [b for b in bots if b not in set(can)], since, until, tuple(sorted(ks)))
    if ctl_d is not None:
        m['kd'], m['kbh'] = int(ctl_d), float(ctl_h)
    rev, gwhy = death_gate(m['cd'], m['cbh'], m['kd'], m['kbh'])
    ceil = BR.ceiling_trips(m['cd'], m['cbh'], m['kd'], m['kbh'], ratio_lower_bound)
    gate = {'cd': m['cd'], 'cbh': m['cbh'], 'kd': m['kd'], 'kbh': m['kbh']}
    word, why = BR.at_trip({'class': 'bag-fix'}, 'death_gate' if rev else None, m, gate, ceil)
    print(json.dumps(dict(m, gate_trips=rev, lb=ceil[1]), default=str))
    print('WINDOW gate %s; as a bag fix -> %s :: %s' % ('TRIPS' if rev else 'holds', word if rev else 'n/a (no trip)', why))
    return 0


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    c = argv[1]
    if c == 'extend-check': return cmd_extend_check(argv[2], int(argv[3]))
    if c == 'poll': return cmd_poll(argv[2])
    if c == 'final': return cmd_final(argv[2])
    if c == 'check-registration': return cmd_check_registration(argv[2])
    if c == 'window': return cmd_window(*argv[2:])
    print('unknown command %r' % c); return 2


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Exception as e:
        # A crash must not read as a quiet answer: the loop treats an ERROR or a missing line as a failed poll.
        print('BAGFIX ERROR (+0) :: %s: %s' % (type(e).__name__, str(e)[:300]))
        sys.exit(1)
