#!/usr/bin/env python3
"""usafegate.py -- the MEASURING half of the underground-safety death gate (gate v34). Part of the gate bundle.

verdict.py calls `measure()` for a registration of class underground-safety (both the 5-min poll and the scheduled
reads); the decisions are usaferule.py's (pure). CLI:
    usafegate.py check-registration <run_id>                       launch preflight -> USAFE OK|REFUSED
    usafegate.py window <pools> <cut-iso> <until-iso> [pre_h] [registration.json]  backtest a past window

WHAT IT MEASURES (one estimator, shared with the calibration):
  deaths      `_death` rows with cut <= @timestamp < until, deduplicated per bot on the timestamp;
  exposure    per bot, the gaps between consecutive rows capped at 120 s, summed (capped_gaps) -- the estimator the
              calibration uses too (scripts/host/usafe_bins.py imports this function), and ugsafe2_analyse's;
  own rows    the bot's rows of the kinds its link_rules name (time, kind, detail), for linkage (usaferule.link_reason);
  PRE         the same over [cut - pre_hours, cut), for both arms -- computed ONCE per canary and cached beside the
              verdict artifacts (<reads>/<run>-usafe-pre.json, keyed by declared_at, pre_hours and the canary roster),
              because PRE cannot change after declared_at;
  control     POST is scanned only at the two-death floor (below it the gate cannot trip), as verdict.py already does.
An unreadable log file is COUNTED (`errors`); verdict.py treats errors as UNREADABLE, never as zero deaths.
Every file is read whole (no calendar-date prefilter), so a 26-h extension spanning three dates sees the middle day.
"""
import sys, os, re, json, glob, gzip, zlib, hashlib, datetime as dt
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__))
# THIS file's own directory wins (it is inserted last, at 0): on the host that is ~/mcai-analysis anyway, and a staged or
# mutated copy then imports the usaferule beside it, never the live one (round 7, Claude)
for _p in ('/home/mike/mcai-analysis', HERE):
    if os.path.isdir(_p):
        if _p in sys.path:
            sys.path.remove(_p)
        sys.path.insert(0, _p)
import usaferule as U


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')


def epoch(ts):
    return dt.datetime.fromisoformat(ts[:19] + '+00:00').timestamp()


_TS = re.compile(r'^\{\s*"@timestamp":\s*"([^"]+)"')


def ts_of(line):
    """The logger writes compact JSON with @timestamp first; a spaced form is accepted too (a formatting change must
    not read as zero exposure)."""
    i = line.find('"@timestamp":"')
    if 0 <= i < 8:
        return line[i + 14:i + 38]
    m = _TS.match(line)
    return m.group(1) if m else ''


def _named(line, kind):
    """The row's OWN kind (skill.name), never a "name" elsewhere in the row (round 1, Claude)."""
    return ('"skill":{"name":"%s"' % kind) in line or ('"skill": {"name": "%s"' % kind) in line


_VER = re.compile(r'"version":\s*"([0-9a-f]{7})')


def files(root, bot, since):
    out = []
    for f in sorted(glob.glob(f'{root}/{bot}/skill-*.jsonl') + glob.glob(f'{root}/{bot}/skill-*.jsonl-*')):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < since:
                continue      # rotation-aware: a file last written before the window holds nothing in it
        except OSError:
            continue
        out.append(f)
    return out


CAP_S = 120.0       # an observation gap counts as exposure up to 120 s (ugsafe2_analyse.py's estimator): a bot that stops
                    # logging (crash, outage) stops accruing bot-hours, so an outage inside a window is not exposure


def _detail(line):
    try:
        return ((json.loads(line).get('skill') or {}).get('detail') or '')
    except ValueError:
        return None


def rows(root, bot, since, until, kinds=(), errors=None, baseline=None, other=None):
    """One bot's rows in [since, until): sorted unique timestamps (epoch), deaths [(epoch, text)], own-kind rows
    [(epoch, kind, detail)]. Every failure to read is COUNTED in errors[0] -- an unreadable or corrupt file (incl. a gz
    whose body is corrupt: zlib.error), a malformed timestamp, a death or own row whose JSON does not parse -- never a
    crash and never a silent skip (round 1, Claude). `baseline` + `other` (a Counter): rows written by another build."""
    errors = errors if errors is not None else [0]
    lo, hi = iso(since), iso(until)
    ts_all = set(); deaths = {}; own = []
    for f in files(root, bot, since):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for l in fh:
                    ts = ts_of(l)
                    if not ts or not (lo <= ts[:19] < hi):
                        continue
                    try:
                        e = epoch(ts)
                    except ValueError:
                        errors[0] += 1
                        continue
                    ts_all.add(e)
                    if baseline and other is not None:
                        mv = _VER.search(l)
                        if mv and mv.group(1) != baseline[:7]:
                            other[mv.group(1)] += 1
                    if _named(l, '_death'):
                        d = _detail(l)
                        if d is None:
                            if not l.endswith('\n'):
                                continue        # the bot is mid-write: the next poll reads it whole (round 2, Claude)
                            errors[0] += 1
                            d = ''
                        deaths[e] = (deaths.get(e) or '') + d
                    elif kinds:
                        k = next((k for k in kinds if _named(l, k)), None)
                        if k:
                            d = _detail(l)
                            if d is None:
                                if l.endswith('\n'):
                                    errors[0] += 1
                                continue
                            own.append((e, k, d))
        except (OSError, EOFError, gzip.BadGzipFile, zlib.error, UnicodeDecodeError) as ex:
            errors[0] += 1
            sys.stderr.write('usafegate: unreadable %s: %s\n' % (f, ex))
    return sorted(ts_all), sorted(deaths.items()), sorted(own)


def capped_gaps(ts):
    """THE exposure estimator (shared with the calibration, scripts/host/usafe_bins.py): for each row, the gap to the
    next row capped at CAP_S, credited at the row's time. -> [(t, seconds)]."""
    return [(ts[i], min(ts[i + 1] - ts[i], CAP_S)) for i in range(len(ts) - 1)]


def scan(root, bot, since, until, kinds=(), errors=None, baseline=None, other=None):
    """-> (exposure_h, deaths [(epoch, text)], own [(epoch, kind, detail)]) for one bot in [since, until)."""
    ts, ds, own = rows(root, bot, since, until, kinds, errors, baseline, other)
    return sum(s for _t, s in capped_gaps(ts)) / 3600.0, ds, own


def pool_of(bot):
    return '-'.join(bot.split('-')[:2])


def arm(root, bots, since, until, rules=(), errors=None, baseline=None, other=None):
    """Totals for an arm plus per-pool (deaths, bot-h), per-bot bot-h, and, when link rules are given, linked deaths."""
    kinds = tuple(sorted({k for r in rules for k in (r.get('kind'), r.get('until_kind')) if k}))
    d = 0; h = 0.0; per = {}; linked = []; per_bot = {}
    for b in bots:
        bh, ds, own = scan(root, b, since, until, kinds, errors, baseline, other)
        d += len(ds); h += bh; per_bot[b] = bh
        pd, ph = per.get(pool_of(b), (0, 0.0)); per[pool_of(b)] = (pd + len(ds), ph + bh)
        for t, text in (ds if rules else []):
            why = U.link_reason(t, text, own, rules)
            if why:
                linked.append((b, dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%H:%M:%S'), why))
    return d, h, per, linked, per_bot


MIN_BOT_SHARE = 0.25   # coverage: every canary bot must log >= 25% of the window's hours (PRE, and POST once > 1 h in)


def coverage(per_bot, window_h, roster):
    """PURE-ish. Names canary bots that are missing or nearly silent in a window: the gate is blind to them, so their
    absence must not read as 'no deaths there' (round 1, Codex)."""
    short = [b for b in roster if per_bot.get(b, 0.0) < MIN_BOT_SHARE * window_h]
    return short


def pre_counts(root, canary_bots, control_bots, cut, pre_h, cache_path=None, baseline=None):
    """PRE for both arms, cached once per (declared_at, pre_h, roster) -- only when complete (no errors, full coverage)."""
    key = hashlib.md5(json.dumps([iso(cut), pre_h, sorted(canary_bots), sorted(control_bots), 'capped120']).encode()).hexdigest()
    if cache_path and os.path.exists(cache_path):
        try:
            c = json.load(open(cache_path))
            if c.get('key') == key and not c.get('errors'):
                return _with_roster(c, cache_path)
        except Exception:
            pass
    err = [0]
    since = cut - dt.timedelta(hours=pre_h)
    other = Counter()
    b, tb, pb, _, perb = arm(root, canary_bots, since, cut, errors=err, baseline=baseline, other=other)
    d, td, pd, _, _ = arm(root, control_bots, since, cut, errors=err)
    # THE ROSTER the POST is held to: canary bots that logged >= 25% of the PRE. A bot directory with no PRE (a unit that
    # is enabled but stopped -- 8 Charlies on 10-07) is not part of the canary; one that ran in PRE and goes silent in
    # POST is a blind spot and makes the gate UNREADABLE (round 1, Codex).
    short = coverage(perb, pre_h, canary_bots)
    active = sorted(x for x in canary_bots if x not in set(short))
    c = {'key': key, 'b': b, 'tb': tb, 'd': d, 'td': td, 'per': {**pb, **pd}, 'errors': err[0], 'pre_h': pre_h, 'short': short,
         'active': active, 'pre_other_builds': dict(other)}
    if cache_path and not err[0]:
        try:
            json.dump(c, open(cache_path, 'w'))
        except OSError:
            pass
    return _with_roster(c, cache_path)


def _with_roster(c, cache_path):
    """THE ROSTER NEVER SHRINKS (round 2, Codex): the first active roster this canary was measured with is written once
    beside the PRE cache and never rewritten; every later poll holds the POST to the UNION of it and today's. A bot whose
    directory disappears (or that a later discovery no longer lists) is therefore still owed rows, and its absence is
    UNREADABLE -- not a smaller canary that happens to HOLD."""
    # FAILS CLOSED (round 3, Codex): an established roster file that cannot be read, or a first roster that cannot be
    # written, is `roster_error` -> UNREADABLE, never an empty roster. The first write is atomic (temp file + rename).
    c = dict(c)
    first = []; c.pop('roster_error', None)
    if cache_path:
        rp = cache_path + '.roster'
        if os.path.exists(rp):
            try:
                first = json.load(open(rp))['active']
                if not isinstance(first, list) or not all(isinstance(x, str) for x in first):
                    raise ValueError('not a list of bot names')
            except (OSError, ValueError, KeyError, TypeError) as e:
                first = []
                c['roster_error'] = 'the canary roster file %s is unreadable (%s)' % (rp, type(e).__name__)
        elif c.get('active'):
            try:
                tmp = rp + '.tmp-%d' % os.getpid()
                with open(tmp, 'w') as fh:
                    json.dump({'active': c['active']}, fh)
                os.replace(tmp, rp)
            except OSError as e:
                c['roster_error'] = 'the canary roster could not be recorded at %s (%s)' % (rp, type(e).__name__)
    c['roster'] = sorted(set(first) | set(c.get('active') or []))
    return c


def frozen_matched(cache_path, candidates, canary_pools, create=False):
    """THE MATCHED CONTROL IS FROZEN (Codex launch condition 2, 10-08): the candidates the draw did not take, decided at
    the draw and BEFORE the deploy (canary-loop.sh runs `usafegate.py freeze`) and written once, atomically, beside the PRE cache; every
    later poll and read uses that record. -> (pools, error). An unreadable record, or a record that disagrees with this
    canary's pools, is an error (fails closed); with no cache path (a replay) the set is computed, not frozen."""
    canary_pools = sorted({str(p).strip() for p in canary_pools if str(p).strip()})   # one spelling: manifest, $P, bots
    want = sorted(set(candidates) - set(canary_pools))
    if not cache_path:
        return want, None
    mp = cache_path + '.matched'
    if os.path.exists(mp):
        try:
            rec = json.load(open(mp))
            pools = rec['pools']
            if not isinstance(pools, list) or not all(isinstance(x, str) for x in pools):
                raise ValueError('not a list of pools')
            if sorted(rec.get('canary_pools') or []) != sorted(canary_pools):
                return pools, 'the frozen matched control %s was recorded for canary pools %s, not %s' % (
                    mp, rec.get('canary_pools'), sorted(canary_pools))
            return pools, None
        except (OSError, ValueError, KeyError, TypeError) as e:
            return [], 'the frozen matched-control record %s is unreadable (%s)' % (mp, type(e).__name__)
    if not create:
        # the gate only LOADS the record the loop froze before the deploy (round 1, Codex): a missing record is not a
        # first use, it is a lost one -- never re-derived from today's candidates
        return [], 'no frozen matched-control record at %s (frozen by the loop before the deploy)' % mp
    try:
        tmp = mp + '.tmp-%d' % os.getpid()
        with open(tmp, 'w') as fh:
            json.dump({'pools': want, 'candidates': sorted(candidates), 'canary_pools': sorted(canary_pools),
                       'frozen_at': dt.datetime.now(dt.timezone.utc).isoformat()}, fh)
        os.replace(tmp, mp)
    except OSError as e:
        return want, 'the matched control could not be frozen at %s (%s)' % (mp, type(e).__name__)
    return want, None


def measure(root, reg, canary_bots, control_bots, cut, now, cache_path=None, expected_pools=None, baseline=None):
    """Everything the gate needs at one poll or read. Control POST only at the floor.
    `expected_pools`: the declared canary pools; a declared pool with no bot on disk is a roster error."""
    s = U.spec(reg)
    err = [0]
    a, ta, pa, linked, perb = arm(root, canary_bots, cut, now, s['link_rules'], err)
    pre = pre_counts(root, canary_bots, control_bots, cut, s['pre_hours'], cache_path, baseline)
    post_h = max(0.0, (now - cut).total_seconds() / 3600.0)
    active = pre.get('roster', pre.get('active', []))
    vanished = sorted(set(active) - set(canary_bots))
    short_post = coverage(perb, post_h, active) if post_h > 1.0 else []
    missing_pools = sorted(set(expected_pools or []) - {pool_of(b) for b in active})
    m = {'a': a, 'ta': ta, 'b': pre['b'], 'tb': pre['tb'], 'd': pre['d'], 'td': pre['td'], 'c': 0, 'tc': 0.0,
         'linked': linked, 'errors': err[0] + pre.get('errors', 0), 'control_scanned': False, 'pre_h': s['pre_hours'],
         'p': None, 'p_n': 0, 'short_pre': pre.get('short', []), 'short_post': short_post, 'missing_pools': missing_pools,
         'n_canary_bots': len(canary_bots), 'pre_other_builds': pre.get('pre_other_builds', {}), 'vanished': vanished,
         'roster_error': pre.get('roster_error')}
    # THE MATCHED-POOL ARM (HYB), every poll: few bots, and an unusable control must be seen before it is needed
    canary_pools = sorted({pool_of(b) for b in canary_bots} | set(expected_pools or []))
    mpools, merr = frozen_matched(cache_path, s['matched_candidates'], canary_pools)
    mbots = [b for b in control_bots if pool_of(b) in set(mpools)]
    cm, tm, pm, _, _ = arm(root, mbots, cut, now, errors=err)
    m.update(cm=cm, tm=tm, matched_pools=mpools, matched_error=merr, errors=err[0] + pre.get('errors', 0))
    gone = sorted(set(mpools) - {pool_of(b) for b in mbots})
    # every frozen matched pool must have MEASURED POST exposure at every poll (round 1, Codex: a pool silent through POST
    # was masked by the others' exposure inside the first hour); the relative 25% rule below keeps its one-hour grace
    unmeasured = sorted(p for p in mpools if p not in gone and pm.get(p, (0, 0.0))[1] <= 0) if post_h > 0 else []
    quiet = []
    if post_h > 1.0:
        # a matched pool must keep logging: its POST exposure rate >= 25% of its PRE rate (pool level)
        for p in mpools:
            _qd, qh = pre['per'].get(p, (0, 0.0))
            ph = pm.get(p, (0, 0.0))[1]
            if qh <= 0 or ph < MIN_BOT_SHARE * post_h * (qh / s['pre_hours']):
                quiet.append(p)
    if not mpools:
        m['matched_error'] = merr or 'no matched control: every candidate pool %s was drawn' % s['matched_candidates']
    m['matched_gone'] = gone; m['matched_quiet'] = sorted(set(quiet) | set(unmeasured))
    if a >= U.FLOOR:
        c, tc, pc, _, _ = arm(root, control_bots, cut, now, errors=err)
        m.update(c=c, tc=tc, control_scanned=True, errors=err[0] + pre.get('errors', 0))
        rk = U.control_ratio(c, tc, pre['d'], pre['td'])
        if rk:
            try:
                # REPORT-ONLY randomization p on the per-pool DiD excess; it can never stop a decision
                post = {**pa, **pc}; units = {}
                for p, (pd_, ph_) in post.items():
                    qd, qh = pre['per'].get(p, (0, 0.0))
                    units[p] = (pd_ - (qd + 0.5) / qh * ph_ * rk) if qh > 0 else None
                m['p'], m['p_n'] = U.randomization_p(units, sorted(pa))
            except Exception as e:
                m['p'], m['p_n'] = None, 0
                sys.stderr.write('usafegate: randomization p unavailable: %s\n' % e)
    return m


def decide(m, lower_bound, linkage_report_only=False):
    """-> (word, why): 'REVERT' | 'HOLD' | 'UNREADABLE'.
    Linkage FIRST and regardless of read errors: positively observed linked harm at the floor reverts even if some
    other file is unreadable (round 1, Codex). Then data completeness (errors, roster, coverage) -- incomplete data is
    UNREADABLE, never HOLD. Then the DiD.
    `linkage_report_only` (verdict.py passes v31's rate licence): linkage is an INSTRUMENT of the change, and a
    rate-class canary may not revert on any instrument -- its linked deaths are REPORTED and the decision falls through
    to completeness and the statistical gate, which still revert (round 4, Codex)."""
    lrev, lwhy = U.linked_reverts(len(m['linked']), m['a'])
    if lrev and linkage_report_only:
        lrev = False
        lwhy = 'REPORT ONLY under a rate licence (v31): ' + lwhy
    if lrev:
        extra = (' (and %d unreadable file(s))' % m['errors']) if m['errors'] else ''
        return 'REVERT', 'MECHANISM-LINKED: %s %s%s' % (lwhy, m['linked'][:4], extra)
    gaps = []
    if m['errors']:
        gaps.append('%d log file(s) unreadable' % m['errors'])
    if m.get('missing_pools'):
        gaps.append('declared canary pool(s) with no bot running in the PRE: %s' % ', '.join(m['missing_pools']))
    if m.get('roster_error'):
        gaps.append(m['roster_error'])
    if m.get('vanished'):
        gaps.append('canary bot(s) in the roster no longer on disk: %s' % ', '.join(m['vanished'][:6]))
    if m.get('short_post'):
        gaps.append('canary bot(s) logging < %d%% of the POST: %s' % (100 * MIN_BOT_SHARE, ', '.join(m['short_post'][:6])))
    if m.get('matched_error'):
        gaps.append(m['matched_error'])
    if m.get('matched_gone'):
        gaps.append('matched control pool(s) with no bot on disk: %s' % ', '.join(m['matched_gone']))
    if m.get('matched_quiet'):
        gaps.append('matched control pool(s) logging < %d%% of their PRE rate: %s' % (100 * MIN_BOT_SHARE, ', '.join(m['matched_quiet'])))
    rev, lb, why = U.hyb_gate(m['a'], m['ta'], m['b'], m['tb'], m['c'], m['tc'], m['d'], m['td'],
                              m.get('cm', 0), m.get('tm', 0.0), lower_bound)
    why += ' | matched control (frozen): %s' % (m.get('matched_pools') or 'NONE')
    if m['p'] is not None:
        why += '; randomization p %.3f over %d same-size pool assignments (REPORT ONLY)' % (m['p'], m['p_n'])
    if m['linked']:
        why += ' | ' + lwhy
    if m.get('pre_other_builds'):
        why += ' | REPORTED: the canary PRE holds rows of other builds %s (a previous canary or restart lag)' % m['pre_other_builds']
    if m.get('short_pre'):
        why += ' | not in the roster (logged < %d%% of the PRE): %s' % (100 * MIN_BOT_SHARE, ', '.join(m['short_pre'][:8]))
    if gaps:
        # a TRIP on incomplete data is still a trip (the deaths it saw are real); a HOLD on it is not evidence
        if rev:
            return 'REVERT', why + ' | data incomplete: ' + '; '.join(gaps)
        return 'UNREADABLE', 'the underground-safety gate cannot vouch for this canary: ' + '; '.join(gaps) + ' | ' + why
    if rev is None:
        return 'UNREADABLE', why
    return ('REVERT' if rev else 'HOLD'), why


def main(argv):
    from deathgate import ratio_lower_bound
    if len(argv) >= 3 and argv[1] == 'check-registration':
        regdir = os.environ.get('USAFE_REG_DIR') or os.path.expanduser('~/mcai-analysis/registrations')
        reg = json.load(open(os.path.join(regdir, argv[2] + '.json')))
        bad = U.registration_problems(reg)
        print('USAFE %s :: %s' % ('REFUSED' if bad else 'OK', '; '.join(bad) if bad else (
            'underground-safety registration well-formed' if U.is_underground_safety(reg) else 'not an underground-safety registration')))
        return 2 if bad else 0
    if len(argv) >= 4 and argv[1] == 'freeze':
        # FREEZE BEFORE THE DEPLOY (canary-loop.sh, after the draw; a failure refuses the deploy): the matched control is recorded
        # once, where the gate reads it; an existing record for these pools is reported, never rewritten
        regdir = os.environ.get('USAFE_REG_DIR') or os.path.expanduser('~/mcai-analysis/registrations')
        reads = os.environ.get('USAFE_READS_DIR') or os.path.expanduser('~/digest/reads')
        reg = json.load(open(os.path.join(regdir, argv[2] + '.json')))
        pools = sorted({p.strip() for p in argv[3].split(',') if p.strip()})
        cache = os.path.join(reads, '%s-usafe-pre.json' % argv[2])
        # a run id is ONE declaration (v33): state left by an earlier one (its PRE cache or roster) is never reused
        # under a new freeze, even on the same pools (round 1, Claude)
        stale = [x for x in (cache, cache + '.roster') if os.path.exists(x)]
        # ANY measurement state means a declaration already got past its deploy: refuse, whether or not a .matched exists
        # (round 2, Codex + Claude). A retry after a FAILED deploy has none, and reuses its own record idempotently.
        if stale:
            print('USAFE FREEZE-FAILED :: state from an earlier declaration of %s exists (%s); a re-run needs a new run id'
                  % (argv[2], ', '.join(stale)))
            return 2
        mp, err = frozen_matched(os.path.join(reads, '%s-usafe-pre.json' % argv[2]), U.spec(reg)['matched_candidates'], pools, create=True)
        if err or not mp:
            print('USAFE FREEZE-FAILED :: %s' % (err or 'no matched control: every candidate %s was drawn' % U.spec(reg)['matched_candidates']))
            return 2
        print('USAFE FROZEN %s :: matched control for canary pools %s' % (','.join(mp), ','.join(pools)))
        return 0
    if len(argv) >= 5 and argv[1] == 'window':
        root = os.environ.get('USAFE_LOG_ROOT') or '/var/log/mcai'
        ps = [p for p in argv[2].split(',') if p]
        cut = dt.datetime.fromisoformat(argv[3].replace('Z', '+00:00')); until = dt.datetime.fromisoformat(argv[4].replace('Z', '+00:00'))
        reg = {'underground_safety': {'pre_hours': float(argv[5]) if len(argv) > 5 else 24}}
        if len(argv) > 6:      # a registration file: its underground_safety block (link_rules) is used
            reg = json.load(open(argv[6]))
        bots = sorted({os.path.basename(b.rstrip('/')) for b in glob.glob(f'{root}/*-*/')})
        can = [b for b in bots if pool_of(b) in ps]
        m = measure(root, reg, can, [b for b in bots if b not in set(can)], cut, until, expected_pools=ps)
        w, why = decide(m, ratio_lower_bound, linkage_report_only=U.licence_report_only(reg))
        print(json.dumps({k: v for k, v in m.items()}, default=str))
        print('USAFE %s :: %s' % (w, why))
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
