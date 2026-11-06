#!/usr/bin/env python3
r"""projectaudit.py -- is every project DOING ITS JOB? A daily (and on-demand) effectiveness check of every town project.

OWNER 11-06 ~13:50Z: "we need to add some kind of daily or scheduled check to see if projects are effective and useful. the
tree farm i assumed was working and effective, we never checked. we need to do that with all projects".
Why: the showcase tree farm completed 10-31 20:23Z; every harvest after it failed (245 `_build op=harvest kind=grown_failed
why=no_safe_target`, 0 grown logs felled), the last attempt was 11-02 12:36Z, and nothing visited it again. goalwatch checks
OPEN projects for progress; nothing checked that a FINISHED project is used.

WHAT IT JUDGES. Every project record (newest generation of /var/lib/mcai/_pool-<pool>/project-<home>.<plot>.gN.json) plus
the town infrastructure that has no project record (disposal well, town chests, composter), against its entry in
config/projectaudit-registry.json: the rows that show USE, the rows that show a FAILED attempt, the expected use per day and
the days without use that make a finished project DORMANT. Verdicts (judge(), pure; precedence top down):
  -            not finished (building / stuck / unsited / plan): goalwatch's job, reported, never judged here
  NOT JUDGED   the town's bots logged in < 50% of the judged hours (bots down, log gap)
  BROKEN       upkeep: >= 3 failed repair visits over >= 6 h and no intact check or repair after the first failure
  UNMEASURED   no row shows use (registry measured=false), or the deployed source cannot emit the use row (positive control)
  BROKEN       every attempt fails: >= 3 failed attempt visits over >= 6 h and no use at all. BROKEN rests on positive
               evidence of failure, so it is judged inside the 24 h grace too (Codex r1 B3: the order is now written down)
  NOT JUDGED   finished < 24 h ago with no use and no failed attempts yet (young)
  DORMANT      finished, and no use for dormant_days (with the town's bots up for >= 50% of that time)
  UNDERUSED    some use, but below the expected rate, or most attempts fail
  EFFECTIVE    use at or above the expected rate, and at least half the attempt visits succeed
A NOT JUDGED project keeps yesterday's BROKEN / DORMANT alarm (carry_forward): silence is not recovery.

OUTPUTS. <state-dir>/projectaudit-<label>.json (the fleetstatus header and STATE read it), the daily report
<state-dir>/projectaudit/<label>-<date>.md, BROKEN and DORMANT as tier-1 pages through lib/alarm (keys broken:/dormant:,
pushed when NEW, not re-pushed daily -- repush 7 d -- acked with `pager.py ack projectaudit-<label> 'dormant:*' why`),
UNDERUSED in the daily digest (tier 2), and on the weekly day (Monday) a plain-language owner summary
<state-dir>/digest-attach/projectaudit-weekly-<label>.txt that `pager.py digest` delivers with the digest.

DENOMINATORS + POSITIVE CONTROLS. The walk is FULL (every line of every bot's skill stream in the window, rotated .gz included,
via lib.telemetry.bot_files/open_log); only rows whose skill.name is a registry signal are parsed. It reports lines walked,
bots, rows matched, and per town the bot-hours and covered hours. A zero is judged only when (1) the town's bots were up,
(2) the deployed source can emit the use row (registry emitters, grepped in --src), and (3) the alarm line says how many
rows of that family the walk did find (host-wide), so "0 harvests" is never a silent walk failure.

    python3 projectaudit.py run --label fleet                    (.31, cron 12:05Z daily; --no-push for a dry look)
    python3 projectaudit.py run --label showcase --ship /var/log/showcase/heartbeat.jsonl --src /srv/showcase/harness/src
    python3 projectaudit.py run --label fleet --days 7 --print   (on demand: print only, no state, no alarms)
READ ONLY on the bots: record files and logs. Nice it (the fleet walk reads ~1.5 GB a day of logs).
"""
import argparse
import datetime as dt
import fnmatch
import glob
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402
from lib.telemetry import bot_files, open_log, TS_PREFIX  # noqa: E402

UTC = dt.timezone.utc
REC_RE = re.compile(r'_pool-(?P<pool>[^/]+)/project-(?P<home>-?\d+_-?\d+_-?\d+)\.(?P<plot>[A-Za-z0-9_-]+)\.g(?P<gen>\d+)\.json$')
SKILL_KEY = '"skill":{"name":"'
POS_KEY = '"pos":{"x":'
VERDICTS = ('BROKEN', 'DORMANT', 'UNDERUSED', 'EFFECTIVE', 'UNMEASURED', 'NOT JUDGED', '-')
PAGE_VERDICTS = ('BROKEN', 'DORMANT')
REPUSH = dt.timedelta(days=7)          # a daily check pages a finding ONCE (NEW), not every run; CLEARED always pushes
WEEKLY_DAY = 0                         # Monday: the owner's weekly summary rides that day's digest
# _build_visit outcomes that mean an upkeep (repair) attempt failed when nothing was placed or cleared
UPKEEP_FAIL = {'stuck_on_cell', 'no_material', 'cell_deferred', 'no_stand', 'deadline', 'unknown', 'deps_open', 'error',
               'walk_failed', 'blocked', 'attempts_spent', 'no_pickaxe', 'no_support', 'place_refused', 'dig_refused',
               'no_reach', 'no_tool'}
UNSITED_STATES = ('no_site', 'unsited')


def registry_path(arg=None):
    for p in ([arg] if arg else []) + [os.path.join(HERE, '..', '..', 'config', 'projectaudit-registry.json'),
                                       os.path.join(HERE, 'projectaudit-registry.json')]:
        if p and os.path.exists(p):
            return p
    raise FileNotFoundError('projectaudit-registry.json (pass --registry)')


def load_registry(path):
    reg = json.load(open(path))
    d = reg.get('defaults') or {}
    out = []
    for name, e in reg['kinds'].items():
        x = dict(d)
        x.update(e)
        x['name'] = name
        x.setdefault('use', [])
        x.setdefault('fail', [])
        x.setdefault('measured', bool(x['use']) or bool(x.get('use_presence')) or bool(x.get('one_off')))
        out.append(x)
    return out


def ms_to_dt(v):
    try:
        return dt.datetime.fromtimestamp(float(v) / 1000.0, UTC)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def iso_to_dt(v):
    try:
        t = dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return t if t.tzinfo else None
    except (TypeError, ValueError):
        return None


def any_time(v):
    return iso_to_dt(v) if isinstance(v, str) and not v.isdigit() else ms_to_dt(v)


def kv(detail):
    """'project=x op=harvest kind=grown' -> dict (values carry no spaces in these rows)."""
    out = {}
    for tok in str(detail or '').split():
        if '=' in tok:
            k, v = tok.split('=', 1)
            out.setdefault(k, v)
    return out


# ------------------------------------------------------------------------------------------------ pure: matching
def kind_for(plot, registry):
    """The registry entry for a plot name (first `plots` fnmatch wins), or None (UNMEASURED: nobody declared it)."""
    for e in registry:
        if any(fnmatch.fnmatchcase(plot, p) for p in e.get('plots') or []):
            return e
    return None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def value_ok(want, have, plot=None):
    """PURE. One where-clause value against the row's value (None = the key is absent)."""
    if isinstance(want, list):
        return any(value_ok(w, have, plot) for w in want)
    w = str(want)
    if w == '@plot':
        return have is not None and have == plot
    if w == '*':
        return have is not None
    if w.startswith('!~'):
        return have is not None and w[2:] not in have
    if w.startswith('~'):
        return have is not None and w[1:] in have
    if w.startswith('!'):
        return have is not None and have != w[1:]
    if w.startswith('>'):
        n, lim = _num(have), _num(w[1:])
        return n is not None and lim is not None and n > lim
    return have == w


def spec_matches(spec, name, status, d, plot=None):
    """PURE. Does this row (skill.name, skill.status, kv(detail)) satisfy the signal spec, for this plot?"""
    if spec.get('row') != name:
        return False
    for k, want in (spec.get('where') or {}).items():
        have = status if k == 'status' else d.get(k)
        if not value_ok(want, have, plot):
            return False
    return True


def project_scoped(spec):
    return (spec.get('where') or {}).get('project') == '@plot'


def qty_of(spec, d):
    """PURE. How much use one row carries: 1, a field's number, or the sum of its ':N' counts (dug=cobblestone:6)."""
    q = spec.get('qty', 1)
    if isinstance(q, (int, float)):
        return float(q)
    total = 0.0
    for f in (q if isinstance(q, list) else [q]):
        v = d.get(f)
        if v is None or v == '-':
            continue
        n = _num(v)
        if n is not None:
            total += n
            continue
        total += sum(float(x) for x in re.findall(r':(\d+)', v))
    return total


def group_visits(events, gap=dt.timedelta(minutes=20)):
    """PURE. events [(t, bot)] -> [(start, end, bot)]: one bot's rows closer than `gap` are one attempt visit (a harvest writes
    one row per log; a judge must count visits, not rows)."""
    out, last = [], {}
    for t, bot in sorted(events, key=lambda e: e[0]):
        i = last.get(bot)
        if i is not None and t - out[i][1] <= gap:
            out[i] = (out[i][0], t, bot)
        else:
            last[bot] = len(out)
            out.append((t, t, bot))
    return out


def upkeep_class(outcome, d, status):
    """PURE. A _build_visit row of a FINISHED project -> 'intact' (checked, nothing to do), 'repaired' (placed or cleared
    something), 'failed' (a repair attempt that did nothing) or None (not an upkeep attempt: aborted, slots_full, no_site...)."""
    work = sum(int(_num(d.get(k)) or 0) for k in ('placed', 'cleared', 'planted'))
    if work > 0:
        return 'repaired'
    if outcome == 'complete' or outcome == 'upkeep':
        return 'intact'
    if outcome in UPKEEP_FAIL or status == 'failed':
        return 'failed'
    return None


# ------------------------------------------------------------------------------------------------ pure: the verdict
def _h(td):
    return td.total_seconds() / 3600


def judge(p, e, now, since):
    """PURE. p: one project's facts (see collect_project); e: its registry entry (None = undeclared kind).
    -> (verdict, why). The rules and their precedence are the module docstring's."""
    st = p.get('state')
    judge_open = bool(e and e.get('judge_open'))
    if st in UNSITED_STATES:
        return '-', f'unsited ({p.get("why") or st})'
    if not p.get('complete') and not judge_open:
        return '-', f'{st or "open"}: not finished (goalwatch watches open projects)'
    if e is None:
        return 'UNMEASURED', f'no registry entry for plot {p.get("plot")!r}: nobody declared what it is for'
    if e.get('one_off'):
        return 'EFFECTIVE', 'one-off: finishing it was the purpose'
    start = since if judge_open or not p.get('complete_at') else max(since, p['complete_at'])
    span_h = max(0.0, _h(now - start))
    cov = p.get('coverage') or {}
    hrs, cov_h = cov.get('hours', 0), cov.get('covered_hours', 0)
    min_cov = e.get('min_coverage', 0.5)
    if span_h >= 1 and (hrs == 0 or cov_h / hrs < min_cov):
        return 'NOT JUDGED', (f'bots down: the town logged in {cov_h} of {hrs} hours since {start:%m-%d %H:%MZ} '
                              f'({cov.get("bot_hours", 0):.0f} bot-h)')
    # upkeep BROKEN: a finished project whose every repair attempt fails (any kind, measured or not)
    up = p.get('upkeep') or {}
    fv = up.get('failed_visits') or []
    if p.get('complete') and len(fv) >= e.get('broken_min_fail_visits', 3):
        first = fv[0][0]
        span_f = _h(fv[-1][1] - first)
        ok_after = [t for t in (up.get('intact_t') or []) + (up.get('repaired_t') or []) if t >= first]
        if span_f >= e.get('broken_min_span_hours', 6) and not ok_after:
            use = (f'; use since it finished: {p.get("use_qty", 0):g} {e.get("unit")}' if e.get('measured', True) and e.get('use')
                   else '')
            return 'BROKEN', (f'upkeep: {len(fv)} repair visits failed over {span_f:.1f} h since {first:%m-%d %H:%MZ} '
                              f'({", ".join(f"{k} x{v}" for k, v in Counter(up.get("failed_outcomes") or {}).most_common(3))})'
                              f' and no visit found it intact or repaired it since{use}')
    if not e.get('measured', True):
        return 'UNMEASURED', (e.get('note') or 'no row shows use')[:200]
    if p.get('complete') and e.get('complete_note'):     # tidy: finished = the ground is done; nothing logs that it stays so
        return 'UNMEASURED', e['complete_note'][:200]
    if p.get('emitters_missing'):
        return 'UNMEASURED', f'the deployed bot source cannot log its use (missing: {", ".join(p["emitters_missing"])[:120]})'
    uses = p.get('use_qty', 0.0)
    use_v, fail_v = len(p.get('use_visits') or []), len(p.get('fail_visits') or [])
    last_use = p.get('last_use')
    if fail_v >= e.get('broken_min_fail_visits', 3) and uses == 0:
        fvv = p['fail_visits']
        span_f = _h(fvv[-1][1] - fvv[0][0])
        if span_f >= e.get('broken_min_span_hours', 6):
            lv = p.get('last_visit')
            tail = (f'; nothing has visited since {lv:%m-%d %H:%MZ} ({_h(now - lv) / 24:.1f} d)' if lv and now - lv > dt.timedelta(days=1) else '')
            return 'BROKEN', (f'every attempt fails: {fail_v} failed visits ({p.get("fail_rows", 0)} rows: '
                              f'{", ".join(f"{k} x{v}" for k, v in Counter(p.get("fail_reasons") or {}).most_common(3))}) '
                              f'over {span_f:.1f} h, 0 {e.get("unit", "use")}{tail}')
    if span_h < e.get('grace_hours', 24) and uses == 0:
        return 'NOT JUDGED', f'young: finished {span_h:.0f} h ago (< {e.get("grace_hours", 24)} h) and no use yet'
    dd = e.get('dormant_days')
    if dd:
        idle_from = last_use or start
        idle = now - idle_from
        if idle >= dt.timedelta(days=dd):
            cov_d = p.get('dormant_coverage')
            if cov_d is not None and cov_d < min_cov:
                return 'NOT JUDGED', f'no use for {_h(idle) / 24:.1f} d, but the bots were up only {cov_d:.0%} of it'
            since_txt = (f'last use {last_use:%m-%d %H:%MZ}' if last_use else
                         f'no use in the {_h(now - since) / 24:.0f}-day window' if start == since else
                         f'no use since it finished {start:%m-%d %H:%MZ}')
            lv = p.get('last_visit')
            return 'DORMANT', (f'{since_txt} ({_h(idle) / 24:.1f} d >= {dd} d); '
                               f'last visit {lv:%m-%d %H:%MZ}' if lv else f'{since_txt} ({_h(idle) / 24:.1f} d >= {dd} d); no visit in the window')
    days = max(span_h / 24, 1 / 24)
    rate = uses / days
    att = use_v + fail_v
    ratio = use_v / att if att else 1.0
    exp_ = e.get('expect_per_day')
    unit = e.get('unit', 'use')
    rtxt = f'{rate:.1f} {unit}/day over {days:.1f} d' + (f' (expected >= {exp_})' if exp_ else '')
    if att and ratio < e.get('min_success_ratio', 0.5):
        return 'UNDERUSED', f'most attempts fail: {use_v} of {att} attempt visits succeeded; {rtxt}'
    if exp_ and rate < exp_:
        return 'UNDERUSED', f'below the expected rate: {rtxt}'
    if uses == 0:
        return 'UNDERUSED', f'no use yet: {rtxt}'
    return 'EFFECTIVE', rtxt


def judge_project(p, e, now, since):
    """PURE. judge() plus the open-project rule: an OPEN project the registry judges while open (tidy) that has gone idle is
    UNDERUSED, never a DORMANT page -- an idle open project is goalwatch's stuck goal (digest), not a finished project failing."""
    v, why = judge(p, e, now, since)
    if v == 'DORMANT' and not p.get('complete'):
        return 'UNDERUSED', f'open and idle (goalwatch tracks open projects): {why}'
    return v, why


def alarm_key(label, p, verdict):
    return f'{verdict.lower()}:{label}/{p["pool"]}/{p["plot"]}@{p["home"]}'


def alarms_for(label, results):
    """PURE. {key: line} for BROKEN / DORMANT (tier 1 pages) and UNDERUSED (tier 2 digest)."""
    out = {}
    for r in results:
        v = r['verdict']
        if v in PAGE_VERDICTS or v == 'UNDERUSED':
            out[alarm_key(label, r, v)] = (f'{v}: {r["pool"]}/{r["plot"]}@{r["home"]} ({r.get("purpose") or "?"}) -- '
                                           f'{r["why"]}{r.get("control") or ""}')[:600]
    return out


def carry_forward(prev_alarms, results, label):
    """PURE. A project NOT JUDGED today keeps yesterday's BROKEN / DORMANT key (bots down is not a recovery). -> {key: line}."""
    nj = {(r['pool'], r['plot'], r['home']) for r in results if r['verdict'] == 'NOT JUDGED'}
    out = {}
    for k, line in (prev_alarms or {}).items():
        m = re.match(r'^(broken|dormant):([^/]+)/([^/]+)/(.+)@(.+)$', k)
        if m and m.group(2) == label and (m.group(3), m.group(4), m.group(5)) in nj:
            out[k] = (line if '(carried' in line else line + ' (carried: not judged today)')
    return out


def town_lines(label, results):
    """PURE. One short line per town: counts by verdict, BROKEN / DORMANT named. '!! ' when a town has either."""
    by = defaultdict(list)
    for r in results:
        by[r['pool']].append(r)
    out = []
    for pool in sorted(by):
        rs = by[pool]
        c = Counter(r['verdict'] for r in rs)
        bad = [f'{r["plot"]} {r["verdict"]}' for r in rs if r['verdict'] in PAGE_VERDICTS]
        parts = [f'{c[v]} {v.lower()}' for v in VERDICTS if c.get(v) and v != '-']
        if c.get('-'):
            parts.append(f'{c["-"]} not finished')
        line = f'projects {label}/{pool}: {len(rs)}: ' + ', '.join(parts)
        if bad:
            line = '!! ' + line + ' -- ' + '; '.join(bad)
        out.append(line)
    return out


def weekly_text(label, results, now, rep):
    """PURE. The owner's weekly summary: plain language, one table."""
    by = defaultdict(Counter)
    for r in results:
        by[r['pool']][r['verdict']] += 1
    lines = [f'Weekly project check, {label}, week to {now:%m-%d} ({rep.get("days")} days of logs, '
             f'{rep.get("bots", 0)} bots, {rep.get("lines", 0):,} log lines read).',
             'Is each finished project doing its job? Working = EFFECTIVE; Under = UNDERUSED; Idle = DORMANT (no use for days);',
             'Broken = every attempt fails; No signal = nothing in the logs can show use; Building = not finished yet.', '',
             'town         | working | under | idle | broken | no signal | building | not judged']
    for pool in sorted(by):
        c = by[pool]
        lines.append(f'{pool:<12} | {c["EFFECTIVE"]:>7} | {c["UNDERUSED"]:>5} | {c["DORMANT"]:>4} | {c["BROKEN"]:>6} | '
                     f'{c["UNMEASURED"]:>9} | {c["-"]:>8} | {c["NOT JUDGED"]:>10}')
    bad = [r for r in results if r['verdict'] in PAGE_VERDICTS]
    if bad:
        lines += ['', 'Needs a look:']
        lines += [f'  {r["pool"]} {r["plot"]}: {r["verdict"].lower()} -- {r["why"][:150]}' for r in bad[:12]]
        if len(bad) > 12:
            lines.append(f'  ... and {len(bad) - 12} more (daily report)')
    return '\n'.join(lines)


# ------------------------------------------------------------------------------------------------ inventory (files)
def newest_records(root):
    best = {}
    for p in glob.glob(os.path.join(root, '_pool-*', 'project-*.g*.json')):
        m = REC_RE.search(p)
        if not m or '.pre-reseed' in p:
            continue
        k, g = (m.group('pool'), m.group('home'), m.group('plot')), int(m.group('gen'))
        if k not in best or g > best[k][0]:
            best[k] = (g, p)
    return best


def columns(cells):
    """{(x, z): (ymin, ymax)} of a record's cells (a bot stands on y+1 of a path cell; +-2 for slopes and roofs)."""
    out = {}
    for c in cells or []:
        at = c.get('at') if isinstance(c, dict) else c
        if not (isinstance(at, (list, tuple)) and len(at) >= 3):
            continue
        try:
            x, y, z = int(at[0]), int(at[1]), int(at[2])
        except (TypeError, ValueError):
            continue
        lo, hi = out.get((x, z), (y, y))
        out[(x, z)] = (min(lo, y), max(hi, y))
    return out


def inventory(root, registry):
    """-> [project dict] for every newest project record and every infrastructure file the registry declares."""
    projects = []
    for (pool, home, plot), (gen, path) in sorted(newest_records(root).items()):
        e = kind_for(plot, registry)
        try:
            rec = json.load(open(path))
        except (OSError, ValueError) as ex:
            projects.append({'pool': pool, 'home': home, 'plot': plot, 'gen': gen, 'state': 'unreadable',
                             'why': type(ex).__name__, 'kind': e and e['name'], 'complete': False})
            continue
        state = rec.get('state')
        complete = (bool(rec.get('structure_complete')) or state == 'complete') and state not in UNSITED_STATES
        cells = rec.get('cells') if isinstance(rec.get('cells'), list) else []
        projects.append({'pool': pool, 'home': home, 'plot': plot, 'gen': gen, 'state': state, 'kind': e and e['name'],
                         'complete': complete, 'complete_at': ms_to_dt(rec.get('completeAt')) if complete else None,
                         'record_at': ms_to_dt(rec.get('at')), 'why': str(rec.get('why') or '')[:80] or None,
                         'n_cells': len(cells),
                         'columns': columns(cells) if e and e.get('presence') else {}})
    for e in registry:
        pat = e.get('inventory')
        if not pat:
            continue
        rx = re.compile(re.escape(pat).replace(re.escape('{home}'), r'(?P<home>-?\d+_-?\d+_-?\d+)').replace(r'\*', r'.*') + '$')
        best = {}
        for p in glob.glob(os.path.join(root, '_pool-*', pat.replace('{home}', '*'))):
            pool = os.path.basename(os.path.dirname(p))[len('_pool-'):]
            m = rx.search(os.path.basename(p))
            if not m or '.pre-reseed' in p or pool.startswith('self-'):
                continue
            k = (pool, m.group('home'))
            if k not in best or p > best[k]:
                best[k] = p
        for (pool, home), p in sorted(best.items()):
            try:
                rec = json.load(open(p))
            except (OSError, ValueError):
                rec = {}
            at = any_time(rec.get('at')) if isinstance(rec, dict) else None
            # infrastructure is judged over the whole window: its file is re-written when it is re-sited or re-counted, so
            # its time is not a completion time (11-06: the chests' containers.json was 0 h old, the well moved at 01:55Z)
            projects.append({'pool': pool, 'home': home, 'plot': e['plots'][0], 'gen': None, 'state': 'complete',
                             'kind': e['name'], 'complete': True, 'complete_at': None,
                             'record_at': at, 'why': None, 'n_cells': 0, 'columns': {}, 'infra': os.path.basename(p)})
    return projects


def emitters_missing(src_dir, registry):
    """{kind: [its emitter strings] when NONE of them is in any *.mjs of the deployed source, else []} -- the positive control
    for a zero (one emitter present is enough: the fleet tidy logs `kind: 'tidy'` clears but has no showcase `op: 'sweep'`).
    A missing source dir is reported (None), not assumed."""
    if not src_dir or not os.path.isdir(src_dir):
        return None
    text = ''
    for p in glob.glob(os.path.join(src_dir, '*.mjs')):
        try:
            text += open(p, errors='replace').read()
        except OSError:
            pass
    out = {}
    for e in registry:
        em = e.get('emitters') or []
        out[e['name']] = list(em) if em and not any(s in text for s in em) else []
    return out


# ------------------------------------------------------------------------------------------------ the walk (logs)
def signal_names(registry):
    names = {'_build_visit', '_structure_complete'}
    for e in registry:
        for s in (e.get('use') or []) + (e.get('fail') or []) + (e.get('elsewhere') or []):
            names.add(s['row'])
    return names


def bot_pool(bot):
    """'hive-b-Alpha' -> 'hive-b'; 'showcase-Alpha' -> 'showcase' (checked against exp.pool on every parsed row)."""
    return bot.rsplit('-', 1)[0] if '-' in bot else bot


def parse_pos(line):
    i = line.find(POS_KEY)
    if i < 0:
        return None
    j = line.find('}', i)
    try:
        parts = line[i + 7:j].split(',')
        v = {}
        for part in parts:
            k, x = part.split(':', 1)
            v[k.strip('"')] = float(x)
        return v['x'], v['y'], v['z']
    except (ValueError, KeyError):
        return None


def walk(log_root, since, until, names, footprints):
    """FULL walk of every bot's skill stream in [since, until). footprints: {pool: {(x, z): [(pid, ymin, ymax)]}}.
    -> dict(events, coverage {pool: {hour: set(bots)}}, slots {pool: set((bot, 10-min slot))}, presence {pid: set((bot,
    minute))}, lines, bots, pool_mismatch)."""
    lo, hi = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    events, lines, mismatch, parse_err = [], 0, 0, 0
    cov = defaultdict(lambda: defaultdict(set))
    slots = defaultdict(set)
    presence = defaultdict(set)
    bots = sorted(d for d in os.listdir(log_root) if os.path.isdir(os.path.join(log_root, d))
                  and glob.glob(os.path.join(log_root, d, 'skill-*.jsonl*')) and 'FIXTURE' not in d)
    for bot in bots:
        pool = bot_pool(bot)
        fp = footprints.get(pool) or {}
        for f in bot_files(log_root, bot, 'skill'):
            try:
                if dt.datetime.fromtimestamp(os.path.getmtime(f), UTC) < since:
                    continue
            except OSError:
                continue
            try:
                with open_log(f) as fh:
                    for line in fh:
                        if line.startswith(TS_PREFIX):
                            ts = line[len(TS_PREFIX):len(TS_PREFIX) + 19]
                        else:
                            try:
                                ts = str(json.loads(line).get('@timestamp', ''))[:19]
                            except ValueError:
                                parse_err += 1
                                continue
                        if ts < lo or ts >= hi:
                            continue
                        lines += 1
                        cov[pool][ts[:13]].add(bot)
                        slots[pool].add((bot, ts[:15]))
                        if fp:
                            pos = parse_pos(line)
                            if pos:
                                hit = fp.get((math.floor(pos[0]), math.floor(pos[2])))
                                if hit:
                                    for pid, ymin, ymax in hit:
                                        if ymin - 2 <= pos[1] <= ymax + 3:
                                            presence[pid].add((bot, ts[:16]))
                        i = line.find(SKILL_KEY)
                        if i < 0:
                            continue
                        n = line[i + len(SKILL_KEY):line.find('"', i + len(SKILL_KEY))]
                        if n not in names:
                            continue
                        try:
                            r = json.loads(line)
                        except ValueError:
                            parse_err += 1
                            continue
                        s = r.get('skill') or {}
                        rp = (r.get('exp') or {}).get('pool')
                        if rp and rp != pool:
                            mismatch += 1
                        t = iso_to_dt(r.get('@timestamp'))
                        if t is None:
                            parse_err += 1
                            continue
                        events.append({'t': t, 'bot': bot, 'pool': rp or pool, 'name': n, 'status': s.get('status'),
                                       'd': kv(s.get('detail'))})
            except (OSError, EOFError):
                continue
    return {'events': events, 'coverage': cov, 'slots': slots, 'presence': presence, 'lines': lines, 'bots': len(bots),
            'pool_mismatch': mismatch, 'parse_errors': parse_err}


# ------------------------------------------------------------------------------------------------ facts per project
def hours_between(a, b):
    out, t = [], a.replace(minute=0, second=0, microsecond=0)
    while t < b:
        out.append(t.strftime('%Y-%m-%dT%H'))
        t += dt.timedelta(hours=1)
    return out


def coverage_of(cov_pool, slots_pool, a, b):
    hrs = hours_between(a, b)
    covered = sum(1 for h in hrs if cov_pool.get(h))
    lo, hi = a.strftime('%Y-%m-%dT%H:%M')[:15], b.strftime('%Y-%m-%dT%H:%M')[:15]
    bh = sum(1 for (_, s) in slots_pool if lo <= s <= hi) / 6.0
    return {'hours': len(hrs), 'covered_hours': covered, 'bot_hours': bh}


def collect_project(p, e, evs_pool, walked, since, until):
    """Facts for one project from its pool's events (pure apart from the dict lookups)."""
    plot = p['plot']
    start = since if (e and e.get('judge_open')) or not p.get('complete_at') else max(since, p['complete_at'])
    use_ev, fail_ev, fail_reason, labels, elsewhere, empty = [], [], Counter(), Counter(), Counter(), Counter()
    use_qty, fail_rows, last_use, last_visit = 0.0, 0, None, None
    up = {'failed_visits': [], 'intact_t': [], 'repaired_t': [], 'failed_outcomes': Counter()}
    up_fail = []
    vis_outcomes = Counter()
    for r in evs_pool:
        d, n, st, t = r['d'], r['name'], r['status'], r['t']
        if n == '_build_visit' and d.get('project') == plot:
            last_visit = max(last_visit or t, t)
            if p.get('complete') and p.get('complete_at') and t >= p['complete_at']:
                c = upkeep_class(d.get('outcome'), d, st)
                vis_outcomes[d.get('outcome')] += 1
                if c == 'intact':
                    up['intact_t'].append(t)
                elif c == 'repaired':
                    up['repaired_t'].append(t)
                elif c == 'failed':
                    up_fail.append((t, r['bot']))
                    up['failed_outcomes'][d.get('outcome')] += 1
            continue
        if not e or t < start:
            continue
        for s in e.get('use') or []:
            if spec_matches(s, n, st, d, plot):
                q = qty_of(s, d)
                last_visit = max(last_visit or t, t)
                if q > 0:       # Codex r1 B1: a use row that moved nothing (yard stock placed=0) is a visit, not a use
                    use_qty += q
                    labels[s.get('label') or s['row']] += q
                    use_ev.append((t, r['bot']))
                    last_use = max(last_use or t, t)
                else:
                    empty['empty_' + (s.get('label') or s['row'])] += 1
                break
        else:
            for s in e.get('fail') or []:
                if spec_matches(s, n, st, d, plot):
                    fail_rows += 1
                    fail_ev.append((t, r['bot']))
                    fail_reason[f'{s.get("label") or s["row"]}:{d.get("why") or d.get("stop") or d.get("outcome") or "-"}'] += 1
                    last_visit = max(last_visit or t, t)
                    break
            else:
                for s in e.get('elsewhere') or []:
                    if spec_matches(s, n, st, d, plot):
                        elsewhere[s.get('label') or s['row']] += qty_of(s, d)
                        break
    gap = dt.timedelta(minutes=(e or {}).get('visit_gap_minutes', 20))
    up['failed_visits'] = [(a, b) for a, b, _ in group_visits(up_fail, gap)]
    pid = (p['pool'], p['plot'], p['home'])
    pres = walked['presence'].get(pid) or set()
    pres = {x for x in pres if x[1] >= start.strftime('%Y-%m-%dT%H:%M')}
    if e and e.get('use_presence'):
        use_qty = float(len(pres))
        labels['bot_minutes'] = use_qty
        mins = sorted(m for _, m in pres)
        last_use = iso_to_dt(mins[-1] + ':00Z') if mins else None
    cov_pool, slots_pool = walked['coverage'].get(p['pool']) or {}, walked['slots'].get(p['pool']) or set()
    f = dict(p)
    f.update({'use_qty': use_qty, 'use_labels': dict(labels), 'elsewhere': dict(elsewhere), 'empty_uses': dict(empty),
              'use_visits': [(a, b) for a, b, _ in group_visits(use_ev, gap)],
              'fail_visits': [(a, b) for a, b, _ in group_visits(fail_ev, gap)], 'fail_rows': fail_rows,
              'fail_reasons': dict(fail_reason), 'last_use': last_use, 'last_visit': last_visit, 'upkeep': up,
              'visit_outcomes': dict(vis_outcomes), 'presence_min': len(pres),
              'coverage': coverage_of(cov_pool, slots_pool, start, until)})
    dd = (e or {}).get('dormant_days')
    if dd:
        a = max(last_use or start, until - dt.timedelta(days=dd))
        c = coverage_of(cov_pool, slots_pool, a, until)
        f['dormant_coverage'] = c['covered_hours'] / c['hours'] if c['hours'] else None
    return f


def control_text(e, family, host_rows):
    """The positive control in the alarm line: what the same walk DID find."""
    if not e:
        return ''
    rows = sorted({s['row'] for s in e.get('use') or []} | {s['row'] for s in e.get('fail') or []})
    if not rows:
        return ''
    return (f' [control: this project/town has {family} rows of {"/".join(rows)} in the window; host-wide '
            f'{", ".join(f"{r} {host_rows.get(r, 0):,}" for r in rows)}]')


def audit(root, log_root, registry, now, days=7, src_dir=None):
    since = now - dt.timedelta(days=days)
    projects = inventory(root, registry)
    pids = {(p['pool'], p['plot'], p['home']) for p in projects}
    footprints = defaultdict(lambda: defaultdict(list))
    for p in projects:
        for (x, z), (ymin, ymax) in (p.get('columns') or {}).items():
            footprints[p['pool']][(x, z)].append(((p['pool'], p['plot'], p['home']), ymin, ymax))
    # unsited plots: _build_visit rows name a plot no record has (cottage1, reroof, townhall ...)
    walked = walk(log_root, since, now, signal_names(registry), footprints)
    by_pool = defaultdict(list)
    host_rows = Counter()
    for r in walked['events']:
        by_pool[r['pool']].append(r)
        host_rows[r['name']] += 1
    have = {(p['pool'], p['plot']) for p in projects}
    homes = {p['pool']: p['home'] for p in projects}
    unsited = Counter()
    for r in walked['events']:
        pl = r['d'].get('project')
        if r['name'] == '_build_visit' and pl and (r['pool'], pl) not in have and 'no_site' in str(r['d'].get('outcome')):
            unsited[(r['pool'], pl)] += 1
    for (pool, pl), n in sorted(unsited.items()):
        if pool in homes:
            projects.append({'pool': pool, 'home': homes[pool], 'plot': pl, 'gen': None, 'state': 'unsited',
                             'kind': (kind_for(pl, registry) or {}).get('name'), 'complete': False,
                             'why': f'{n} no_site visits, no record', 'columns': {}})
    miss = emitters_missing(src_dir, registry)
    results = []
    for p in projects:
        e = kind_for(p['plot'], registry)
        f = collect_project(p, e, by_pool.get(p['pool']) or [], walked, since, now)
        if miss is not None and e:
            f['emitters_missing'] = miss.get(e['name']) or []
        fam = sum(1 for r in by_pool.get(p['pool']) or [] if e and r['name'] in
                  {s['row'] for s in (e.get('use') or []) + (e.get('fail') or [])}
                  and (r['d'].get('project') in (None, p['plot'])))
        v, why = judge_project(f, e, now, since)
        f.update({'verdict': v, 'why': why, 'purpose': (e or {}).get('purpose'), 'family_rows': fam,
                  'control': control_text(e, fam, host_rows) if v in PAGE_VERDICTS else ''})
        results.append(f)
    rep = {'generated_at': AL._iso(now), 'since': AL._iso(since), 'days': days, 'lines': walked['lines'],
           'bots': walked['bots'], 'rows_matched': len(walked['events']), 'host_rows': dict(host_rows),
           'pool_mismatch': walked['pool_mismatch'], 'parse_errors': walked['parse_errors'],
           'records': len(pids), 'projects': len(results), 'src_checked': miss is not None,
           'verdicts': dict(Counter(r['verdict'] for r in results))}
    return results, rep


# ------------------------------------------------------------------------------------------------ report
def _t(t):
    return t.strftime('%m-%d %H:%MZ') if isinstance(t, dt.datetime) else '-'


def metric_text(r):
    lab = ', '.join(f'{k} {v:g}' for k, v in sorted((r.get('use_labels') or {}).items()))
    ew = ', '.join(f'{k} {v:g}' for k, v in sorted((r.get('elsewhere') or {}).items()))
    up = r.get('upkeep') or {}
    upk = (f'upkeep intact {len(up.get("intact_t") or [])} / repaired {len(up.get("repaired_t") or [])} / failed '
           f'{len(up.get("failed_visits") or [])}') if r.get('complete') else ''
    parts = [x for x in (lab and f'use: {lab}', f'attempts ok {len(r.get("use_visits") or [])} / failed '
                         f'{len(r.get("fail_visits") or [])}' if (r.get('use_visits') or r.get('fail_visits')) else '',
                         ew and f'elsewhere: {ew}', upk, r.get('presence_min') and f'presence {r["presence_min"]} bot-min') if x]
    return '; '.join(parts)


def report_md(label, results, rep, now):
    c = rep['verdicts']
    out = [f'# Project audit, {label}, {now:%Y-%m-%d %H:%MZ}', '',
           f'Window {rep["since"]} .. {rep["generated_at"]} ({rep["days"]} d). Denominators: {rep["lines"]:,} log lines walked '
           f'(full walk, rotated files included), {rep["bots"]} bots, {rep["rows_matched"]:,} signal rows parsed, '
           f'{rep["projects"]} projects ({rep["records"]} records + infrastructure + unsited plots); pool mismatches '
           f'{rep["pool_mismatch"]}, unparsable lines {rep["parse_errors"]}; deployed source checked for emitters: '
           f'{"yes" if rep["src_checked"] else "NO (--src missing: zeros are not controlled)"}.', '',
           'Verdicts: ' + ', '.join(f'{v} {c[v]}' for v in VERDICTS if c.get(v)), '',
           'Host-wide signal rows: ' + ', '.join(f'{k} {v:,}' for k, v in sorted(rep['host_rows'].items())), '']
    by = defaultdict(list)
    for r in results:
        by[r['pool']].append(r)
    for pool in sorted(by):
        rs = sorted(by[pool], key=lambda r: (VERDICTS.index(r['verdict']), r['plot']))
        cov = rs[0].get('coverage') or {}
        out += [f'## {pool}', '', '| project | state | verdict | why | metric | last visit | last use |', '|---|---|---|---|---|---|---|']
        for r in rs:
            out.append(f'| {r["plot"]}@{r["home"]} | {r.get("state") or "-"}{" (complete " + _t(r.get("complete_at")) + ")" if r.get("complete_at") else ""} '
                       f'| **{r["verdict"]}** | {str(r["why"]).replace("|", "/")[:220]} | {metric_text(r).replace("|", "/")[:220]} '
                       f'| {_t(r.get("last_visit"))} | {_t(r.get("last_use"))} |')
        out.append('')
    return '\n'.join(out) + '\n'


def state_obj(label, results, rep, alarms):
    def slim(r):
        return {'pool': r['pool'], 'plot': r['plot'], 'home': r['home'], 'state': r.get('state'), 'verdict': r['verdict'],
                'why': r['why'], 'metric': metric_text(r), 'last_visit': r.get('last_visit') and AL._iso(r['last_visit']),
                'last_use': r.get('last_use') and AL._iso(r['last_use']),
                'complete_at': r.get('complete_at') and AL._iso(r['complete_at'])}
    c = rep['verdicts']
    bad = [f'{r["pool"]}/{r["plot"]} {r["verdict"]}' for r in results if r['verdict'] in PAGE_VERDICTS]
    summary = (f'project audit {label} ({rep["generated_at"][5:16]}Z, {rep["days"]} d, {rep["projects"]} projects, '
               f'{rep["lines"]:,} lines / {rep["bots"]} bots): ' + ', '.join(f'{c[v]} {v.lower()}' for v in VERDICTS if c.get(v))
               + (f' -- {"; ".join(bad[:6])}{" ..." if len(bad) > 6 else ""}' if bad else ''))
    return dict(rep, label=label, summary=summary, town_lines=town_lines(label, results), alarms=alarms,
                results=[slim(r) for r in results])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run'])
    ap.add_argument('--label', required=True, help='fleet | showcase')
    ap.add_argument('--root', default='/var/lib/mcai')
    ap.add_argument('--logs', default='/var/log/mcai')
    ap.add_argument('--src', help='deployed bot source dir (emitter control); default /opt/minecraft-ai/bots/src (fleet), '
                                  '/srv/showcase/harness/src (showcase)')
    ap.add_argument('--registry')
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--days', type=float, default=7)
    ap.add_argument('--ship', help='append a kind=<label>_projectaudit row to this filebeat-shipped file')
    ap.add_argument('--weekly', choices=['auto', 'yes', 'no'], default='auto')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--print', action='store_true', help='print the report only: no state, no alarms, no files')
    ap.add_argument('--now')
    a = ap.parse_args(argv)
    now = (dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else dt.datetime.now(UTC)).replace(microsecond=0)
    src = a.src or ('/srv/showcase/harness/src' if a.label == 'showcase' else '/opt/minecraft-ai/bots/src')
    sd = os.path.expanduser(a.state_dir)
    prev = {}
    try:
        prev = json.load(open(os.path.join(sd, f'projectaudit-{a.label}.json'))).get('alarms') or {}
    except (OSError, ValueError, AttributeError):
        pass
    try:
        registry = load_registry(registry_path(a.registry))
        results, rep = audit(a.root, a.logs, registry, now, a.days, src)
        alarms = alarms_for(a.label, results)
        alarms.update({k: v for k, v in carry_forward(prev, results, a.label).items() if k not in alarms})
        st = state_obj(a.label, results, rep, alarms)
        md = report_md(a.label, results, rep, now)
    except Exception as ex:      # a watcher that crashes must alarm, not go quiet
        import traceback
        traceback.print_exc()
        # Codex r1 B2: keep yesterday's findings while the audit is down (else raise_alarms CLEARs them, and they page as NEW
        # again on recovery)
        alarms = {k: v for k, v in prev.items() if not k.startswith('projectaudit:')}
        alarms[f'projectaudit:{a.label}'] = f'projectaudit {a.label} FAILED: {type(ex).__name__}: {str(ex)[:200]}'
        st = {'generated_at': AL._iso(now), 'label': a.label, 'error': f'{type(ex).__name__}: {str(ex)[:300]}',
              'summary': f'!! project audit {a.label}: CHECK FAILED ({type(ex).__name__})', 'alarms': alarms, 'town_lines': []}
        results, rep, md = [], None, None
    print(st['summary'])
    for line in st.get('town_lines') or []:
        print('  ' + line)
    if a.print:
        if md:
            print(md)
        return 0
    AL.write_json_atomic(os.path.join(sd, f'projectaudit-{a.label}.json'), st)
    if md:
        os.makedirs(os.path.join(sd, 'projectaudit'), exist_ok=True)
        with open(os.path.join(sd, 'projectaudit', f'{a.label}-{now:%Y-%m-%d}.md'), 'w') as fh:
            fh.write(md)
    AL.raise_alarms(f'projectaudit-{a.label}', alarms, now, os.path.join(sd, f'projectaudit-{a.label}.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push, repush=REPUSH)
    if rep and (a.weekly == 'yes' or (a.weekly == 'auto' and now.weekday() == WEEKLY_DAY)):
        os.makedirs(os.path.join(sd, 'digest-attach'), exist_ok=True)
        with open(os.path.join(sd, 'digest-attach', f'projectaudit-weekly-{a.label}.txt'), 'w') as fh:
            fh.write(weekly_text(a.label, results, now, rep) + '\n')
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_projectaudit', 't': AL._iso(now),
                             'ok': not any(k.startswith(('broken:', 'dormant:', 'projectaudit:')) for k in alarms),
                             'why': st['summary'], 'alarms': sorted(v for k, v in alarms.items() if not k.startswith('underused:')),
                             'town_lines': st.get('town_lines') or []})
    return 0


if __name__ == '__main__':
    sys.exit(main())
