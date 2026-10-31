#!/usr/bin/env python3
"""stallcheck.py -- has anything the owner approved silently stopped? (OWNER 2026-10-31: "Let's build a monitoring check so
this doesn't happen again.")

The 10-31 audit found 13 owner-approved items that had stopped with nobody noticing: a whole lane never started, approved and
reviewed branches never queued, queue entries parked on dead variants, a trigger whose cron never existed, showcase work on
main never brought to the fleet, the survival lane empty for 3 days, STUCK project alarms with no owner, monitors broken but
shown OK, and main missing the fleet's promotions. Every one of them was visible in a file somebody could have compared. This
compares them, hourly, and puts the result where the operator reads every session.

INPUTS (on 10.0.0.31, the canary host):
  config/owner-commitments.json   THE LEDGER, read from origin/main of a private clone (~/stallcheck/repo), so a row added on
                                  main is seen within the hour without reinstalling. One row per owner-approved item.
  config/monitors.json            every cron/launchd job: what it writes, how fresh that must be, and WHO READS IT.
  ~/canary-sched.py               imported read-only for the queue and entry states (gather(full=False); never tick).
  git (the clone)                 branches, commit greps, main vs the fleet sha, promotions vs main.
  ~/digest/goalwatch-fleet.json   the STUCK project alarms.
  crontab -l                      the jobs that actually exist.
  ~/digest/owner-memories.json    the owner-decision memory list and the Mac's launchd labels, pushed daily from the Mac by
                                  opsaudit.sh (the memory dir lives only on the Mac).

DETECTORS (each returns findings; scripts/host/test_stallcheck.py makes every one FIRE on a seeded case, stay quiet on a clean
case, and fail under a mutant):
  L  the ledger itself is invalid (bad enum, missing field, unknown dependency, parked with no date ...)
  a  an open item is past max_quiet_hours with no new evidence; a parked item is past its date; an open item the fleet
     already carries (its fleet_paths) is probably done
  b  a dependency is satisfied (run KEPT/closed, item done) but the dependent has not moved within DEP_GRACE_H; or it waits
     on a run that does not exist / was cancelled, or on a cron trigger that is not in the crontab
  c  a queue entry that can never launch: no variant for the fleet sha, `after` names a cancelled / unknown / dead entry, or
     its hold names a run that is already done or cancelled
  d  a canary-shaped branch (<name>-on-<sha>) carrying a review APPROVE, with no queue entry or journal run after
     BRANCH_GRACE_H
  e  the progress or survival lane has nothing runnable in the queue (owner 10-25: P,S alternation) for LANE_GRACE_H
  f  bots/src commits on main that the fleet does not carry after UNSHIPPED_D days, grouped by feature; fleet promotions
     not on main after PROMO_GRACE_H
  g  STUCK project alarms older than STUCK_OWNER_H that no open ledger row covers (covers_alarms)
  h  monitor liveness: a registered job missing from cron, its output stale, or NO CONSUMER; a cron line nobody registered
  m  an owner-*.md memory with no ledger row (a new owner decision gets a row in the same session); the Mac list stale

SURFACES: ~/digest/stallcheck-fleet.json (alarmhead.py prints it in the fleetstatus header: '!! STALLED: n items -- top 3
...'), ~/digest/stallcheck-latest.md (the report; the daily Codex ops audit's prompt includes it), and one push a day through
lib/alarm.py (the death tripper's /etc/mcai-alert.conf channel). Missing inputs are '!! ' lines, never a quiet zero.

    python3 -B scripts/host/stallcheck.py run [--no-push] [--no-fetch]       # the hourly cron
    python3 -B scripts/host/stallcheck.py run --print                        # also print the report
"""
import argparse
import datetime as dt
import fnmatch
import glob
import importlib.util
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

UTC = dt.timezone.utc
KINDS = ('canary', 'direct', 'showcase', 'host', 'design')
LANES = ('progress', 'survival', 'ops')
STATES = ('open', 'done', 'parked', 'dropped')
DEP_GRACE_H = 24          # a satisfied dependency: the dependent should have moved within a day
BRANCH_GRACE_H = 12       # an approved canary branch should be in the queue within half a day
BRANCH_RECENT_D = 14      # older branches are history, not pending work
LANE_GRACE_H = 2          # a lane may be empty for a launch or a rebuild; longer is a stall
UNSHIPPED_D = 2           # bots/src on main but not on the fleet (showcase first, then the fleet)
PROMO_GRACE_H = 6         # a promotion the coordinator has not merged to main (it merges within 1-25 min)
PROMO_RECENT_D = 14
STUCK_OWNER_H = 6         # a STUCK project alarm with no ledger owner
MEMORY_LIST_STALE_H = 50  # opsaudit.sh pushes the list daily
DEFAULT_QUIET_H = 48
# detector order in the header: the ledger first (nothing else is trustworthy without it), then work that is blocked by a
# decision nobody took, then plain quiet, then hygiene.
WEIGHT = {'L': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4, 'a': 5, 'g': 6, 'f': 7, 'm': 8, 'h': 9}
CANARY_BRANCH = re.compile(r'^(?P<name>[a-z][a-z0-9-]*?)-on-[0-9a-f]{7,40}$')
APPROVE = re.compile(r'\bAPPROVE[SD]?\b')
STUCK = re.compile(r'STUCK (\d+(?:\.\d+)?) h')


# ------------------------------------------------------------------------------------------------------------ helpers --
def ts(s):
    """ISO time, YYYY-MM-DD (midnight UTC) or unix seconds -> aware datetime; None if unreadable."""
    if s is None or s == '':
        return None
    if isinstance(s, (int, float)):
        return dt.datetime.fromtimestamp(s, UTC)
    try:
        s = str(s)
        if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
            return dt.datetime.fromisoformat(s).replace(tzinfo=UTC)
        t = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
        return t if t.tzinfo else t.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        return None


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def hours(a, b):
    return (a - b).total_seconds() / 3600


def F(det, key, line, item=None, age_h=0.0):
    return {'det': det, 'key': f'{det}:{key}', 'item': item, 'age_h': round(float(age_h or 0), 1), 'line': line}


def fmt_h(h):
    return f'{h:.0f} h' if h < 72 else f'{h / 24:.1f} d'


# ------------------------------------------------------------------------------------------------------------- ledger --
def validate(ledger):
    """PURE. -> (items, findings). Items keep every row with an id; every problem is an 'L' finding."""
    out = []
    items = ledger.get('items') if isinstance(ledger, dict) else None
    if not isinstance(items, list) or not items:
        return [], [F('L', 'empty', 'the ledger has NO items (config/owner-commitments.json) -- nothing can be checked')]
    ids, seen = {i.get('id') for i in items if isinstance(i, dict)}, set()
    good = []
    for n, i in enumerate(items):
        if not isinstance(i, dict) or not i.get('id'):
            out.append(F('L', f'row{n}', f'ledger row {n} has no id'))
            continue
        iid = i['id']
        bad = []
        if iid in seen:
            bad.append('duplicate id')
        seen.add(iid)
        if i.get('kind') not in KINDS:
            bad.append(f'kind {i.get("kind")!r} not in {KINDS}')
        if i.get('lane') not in LANES:
            bad.append(f'lane {i.get("lane")!r} not in {LANES}')
        st = i.get('state')
        if st not in STATES:
            bad.append(f'state {st!r} not in {STATES}')
        if not ts(i.get('owner_date')):
            bad.append('owner_date unreadable')
        if not isinstance(i.get('memory'), list) or not i.get('memory'):
            bad.append('no memory file named')
        if st == 'open' and not i.get('next_step'):
            bad.append('open with no next_step')
        if st == 'parked':
            p = i.get('parked') or {}
            if not ts(p.get('until')) or not p.get('why'):
                bad.append('parked needs parked.until (a real date) and parked.why -- an undated park is the silence this '
                           'check exists to catch')
        if st == 'dropped' and not (i.get('dropped') or {}).get('why'):
            bad.append('dropped needs dropped.why')
        if st == 'done' and not ts((i.get('done') or {}).get('when')):
            bad.append('done needs done.when')
        for k in ('evidence', 'parked', 'done', 'dropped'):
            if i.get(k) is not None and not isinstance(i.get(k), dict):
                bad.append(f'{k} must be an object')
        ev = i.get('evidence') if isinstance(i.get('evidence'), dict) else {}
        for k in ('runs', 'branches', 'grep', 'paths', 'fleet_paths'):
            if ev.get(k) is not None and not (isinstance(ev[k], list) and all(isinstance(x, str) for x in ev[k])):
                bad.append(f'evidence.{k} must be a list of strings')
        for k in ('depends_on', 'covers_alarms', 'memory'):
            if i.get(k) is not None and not isinstance(i.get(k), list):
                bad.append(f'{k} must be a list')
        if i.get('max_quiet_hours') is not None and (isinstance(i['max_quiet_hours'], bool) or
                                                     not isinstance(i['max_quiet_hours'], (int, float))):
            bad.append('max_quiet_hours must be a number')
        for d in (i.get('depends_on') if isinstance(i.get('depends_on'), list) else []):
            if not isinstance(d, dict) or not ({'run', 'item', 'cron'} & set(d)):
                bad.append(f'depends_on entry {d!r} names no run / item / cron')
            elif 'item' in d and d['item'] not in ids:
                bad.append(f'depends_on item {d["item"]!r} is not a ledger row')
        if bad:
            # a malformed row is reported and left OUT of every detector (one bad hand edit must not stop the check)
            out.append(F('L', iid, f'ledger row {iid}: ' + '; '.join(bad) + ' -- row skipped until fixed', item=iid))
            continue
        good.append(i)
    return good, out


# ---------------------------------------------------------------------------------------------------------- run facts --
def run_info(run, queue_states, journal, state_rows):
    """PURE. One run's facts from the queue states ({run: state}), the canary journal and the scheduler state rows.
    -> {'exists', 'state', 'kept_at', 'closed_at', 'last_ts'}; state is the queue's (done|cancelled|ready|...) or, for a
    run only in the journal, 'done' (a decision recorded or promoted) / 'journal'."""
    rows = [r for r in journal if r.get('run') == run]
    kept = closed = last = None
    for r in rows:
        t = ts(r.get('ts'))
        if t is None:
            continue
        last = t if last is None or t > last else last
        ph, note = r.get('phase') or '', str(r.get('note') or '')
        if (ph == 'recorded' and note.upper().startswith('KEEP')) or ph == 'promoted':
            kept = t if kept is None or t < kept else kept
        if ph in ('promoted', 'torn-down', 'recorded', 'operator-close'):
            closed = t if closed is None or t < closed else closed
    for r in state_rows:
        if r.get('run') == run:
            t = ts(r.get('at') or r.get('t0'))
            if t is not None:
                last = t if last is None or t > last else last
    st = queue_states.get(run)
    if st is None and rows:
        st = 'done' if closed else 'journal'
    return {'exists': st is not None, 'state': st, 'kept_at': kept, 'closed_at': closed, 'last_ts': last}


def last_evidence(item, ev):
    """PURE. (newest evidence time, what it was) for an item, or (None, None). ev holds the gathered lookups:
    runs {run: info}, branch_ts {glob: ts}, grep_ts {pattern: ts}, path_ts {tuple(paths): ts}."""
    e = item.get('evidence') or {}
    cands = []
    for r in e.get('runs') or []:
        t = (ev['runs'].get(r) or {}).get('last_ts')
        if t:
            cands.append((t, f'run {r}'))
    for b in e.get('branches') or []:
        t = ev['branch_ts'].get(b)
        if t:
            cands.append((t, f'branch {b}'))
    for g in e.get('grep') or []:
        t = ev['grep_ts'].get(g)
        if t:
            cands.append((t, f'commit ~{g!r}'))
    p = tuple(e.get('paths') or [])
    if p and ev['path_ts'].get(p):
        cands.append((ev['path_ts'][p], 'main ' + ','.join(p)[:60]))
    if not cands:
        return None, None
    return max(cands, key=lambda c: c[0])


# ---------------------------------------------------------------------------------------------------------- detectors --
def det_quiet(items, ev, now):
    """(a) open past max_quiet_hours with no new evidence; parked past its date; open but the fleet carries it."""
    out = []
    for i in items:
        iid, st = i['id'], i.get('state')
        if st == 'parked':
            until = ts((i.get('parked') or {}).get('until'))
            if until and now > until:
                out.append(F('a', iid, f'{iid}: PARK EXPIRED {fmt_h(hours(now, until))} ago ({(i.get("parked") or {}).get("why", "")[:120]}) '
                                       f'-- revive it, re-park with a new date, or drop it', iid, hours(now, until)))
            continue
        if st != 'open':
            continue
        fp = (i.get('evidence') or {}).get('fleet_paths') or []
        if fp and all(ev['fleet_has'].get(p) for p in fp):
            out.append(F('a', iid + ':onfleet', f'{iid}: ledger says open but the fleet sha carries {", ".join(fp)[:120]} -- '
                                                 f'mark it done with evidence, or say what is left', iid, 0))
        t, what = last_evidence(i, ev)
        start = t or ts(i.get('owner_date'))
        q = float(i.get('max_quiet_hours') or DEFAULT_QUIET_H)
        h = hours(now, start) if start else 0
        if start and h > q:
            who = 'waits on the OWNER' if (i.get('owner') or '').lower() == 'owner' else 'QUIET'
            since = (f'last evidence {what} {iso(t)[:16]}Z' if t else
                     f'NO evidence at all since the owner said yes {i.get("owner_date")}')
            out.append(F('a', iid, f'{iid}: {who} {fmt_h(h)} (limit {q:.0f} h; {since}) -- next: {(i.get("next_step") or "")[:160]}',
                         iid, h - q))
    return out


def det_deps(items, ev, crontab, now, done_at):
    """(b) a satisfied dependency the dependent has not moved on; a dependency that can never be satisfied."""
    out = []
    for i in items:
        if i.get('state') != 'open' or not i.get('depends_on'):
            continue
        iid, sat, never = i['id'], [], []
        for d in i['depends_on']:
            if 'cron' in d:
                if d['cron'] not in crontab:
                    never.append(f'a cron trigger {d["cron"]!r} that is NOT in the crontab')
                continue
            if 'run' in d:
                info = ev['runs'].get(d['run']) or {}
                if not info.get('exists'):
                    never.append(f'run {d["run"]} which does not exist (not in the queue or the journal)')
                elif info.get('state') == 'cancelled':
                    never.append(f'run {d["run"]} which was CANCELLED')
                else:
                    want = d.get('until') or 'kept'
                    t = info.get('kept_at') if want == 'kept' else info.get('closed_at')
                    sat.append((t, f'{d["run"]} {want.upper()}'))
                continue
            sat.append((done_at.get(d.get('item')), f'{d.get("item")} DONE'))
        if never:
            out.append(F('b', iid + ':never', f'{iid}: waits on {"; ".join(never)} -- it can never move: re-point or drop the '
                                               f'dependency', iid, 0))
            continue
        if not sat or any(t is None for t, _ in sat):
            continue
        t_sat, what = max(sat, key=lambda s: s[0])
        t_ev, _ = last_evidence(i, ev)
        h = hours(now, t_sat)
        if h > DEP_GRACE_H and (t_ev is None or t_ev < t_sat):
            out.append(F('b', iid, f'{iid}: {what} at {iso(t_sat)[:16]}Z, and {iid} has NOT moved in the {fmt_h(h)} since -- '
                                   f'next: {(i.get("next_step") or "")[:140]}', iid, h - DEP_GRACE_H))
    return out


def det_queue(entries, fleet, parked_runs, journal_runs):
    """(c) queue entries that can never launch. entries: [{run, state, hold, after, variants: [base shas]}];
    parked_runs: {run: ledger id} of rows parked with a future date or dropped (accounted for, not stalls);
    journal_runs: every run id the journal knows (an `after` on a journal-only run is not 'unknown')."""
    out = []
    by = {e['run']: e for e in entries}
    live = {e['run']: bool(fleet and fleet in (e.get('variants') or [])) for e in entries}
    for e in entries:
        if e.get('state') in ('done', 'cancelled', 'running', 'launching'):
            continue
        run, why = e['run'], []
        if not live[run]:
            why.append(f'NO variant for the fleet sha {str(fleet)[:8]} (variants keyed on '
                       f'{", ".join(v[:8] for v in e.get("variants") or []) or "none"}) -- it can never launch')
        for a in e.get('after') or []:
            o = by.get(a)
            if o is None:
                if a not in journal_runs:
                    why.append(f'after {a}, which is not a queue entry or a journal run')
            elif o.get('state') == 'cancelled':
                why.append(f'after {a}, which is CANCELLED')
            elif o.get('state') not in ('done', 'running', 'launching') and not live.get(a):
                why.append(f'after {a}, which itself has no live variant')
        hold = e.get('hold') or ''
        for other, o in by.items():
            if other != run and o.get('state') in ('done', 'cancelled') and \
                    re.search(r'(?<![\w-])' + re.escape(other) + r'(?![\w-])', hold) and other not in (e.get('after') or []):
                why.append(f'its hold names {other}, which is {o["state"].upper()}')
        if why and run not in parked_runs:
            out.append(F('c', run, f'queue {run}: ' + '; '.join(why)))
    return out


def runnable(e, entries, fleet):
    """PURE. Could the scheduler launch this entry once the slot is free?"""
    if e.get('state') != 'ready' or (e.get('hold') or '').strip() or fleet not in (e.get('variants') or []):
        return False
    by = {x['run']: x for x in entries}
    return all((by.get(a) or {}).get('state') == 'done' for a in e.get('after') or [])


def det_lanes(entries, fleet, lane_of, since, now):
    """(e) the progress or survival lane with nothing runnable for LANE_GRACE_H (since: {finding key: first seen}).
    Inside the grace the finding is returned with grace=True (kept in `since`, not counted as a stall)."""
    out = []
    for lane in ('progress', 'survival'):
        mine = [e for e in entries if lane_of.get(e['run']) == lane and e.get('state') not in ('done', 'cancelled')]
        if any(runnable(e, entries, fleet) for e in mine):
            continue
        first = ts(since.get(f'e:{lane}')) or now
        h = hours(now, first)
        waiting = ', '.join(f'{e["run"]} ({e.get("state")}{", held" if e.get("hold") else ""})' for e in mine[:4]) or 'no entry at all'
        f = F('e', lane, f'{lane} lane: NOTHING RUNNABLE for {fmt_h(h)} (owner 10-25: P,S alternation); in the queue: '
                         f'{waiting} -- queue the next {lane} item', None, h)
        if h < LANE_GRACE_H:
            f['grace'] = True
        out.append(f)
    return out


def feature_of(subject):
    m = re.match(r'^\s*([A-Za-z][\w.]*(?:-[\w.]+)*)', subject or '')
    return (m.group(1).rstrip(':,.') if m else '?').lower()


def det_unshipped(commits, promotions, now, fleet_on_main, suppress):
    """(f) commits: [(sha, ts, subject)] on main touching bots/src and not on the fleet; promotions: [(run, sha, ts, on_main)].
    suppress: {feature: ledger id} from parked/dropped/fleet:false ledger rows (their grep patterns)."""
    out = []
    groups = {}
    for sha, t, subj in commits:
        groups.setdefault(feature_of(subj), []).append((sha, t, subj))
    for feat, cs in sorted(groups.items()):
        oldest = min(cs, key=lambda c: c[1])
        h = hours(now, oldest[1])
        if h > UNSHIPPED_D * 24 and feat not in suppress:
            out.append(F('f', 'unshipped:' + feat, f'{feat}: {len(cs)} bots/src commit(s) on main NOT on the fleet for {fmt_h(h)} '
                                                    f'(oldest {oldest[0][:8]} {iso(oldest[1])[:10]}) -- bring it to the fleet or park it',
                         None, h - UNSHIPPED_D * 24))
    for run, sha, t, on_main in promotions:
        h = hours(now, t)
        if not on_main and h > PROMO_GRACE_H:
            out.append(F('f', 'promo:' + str(run), f'promotion {run} {sha[:8]} ({iso(t)[:16]}Z) is NOT on main after {fmt_h(h)} -- '
                                                   f'merge it (fetch, rebase, never force-push)', None, h - PROMO_GRACE_H))
    if fleet_on_main is False:
        out.append(F('f', 'fleet-not-on-main', 'the FLEET sha is not on main -- main does not track the fleet'))
    return out


def det_branches(branches, run_ids, owned_globs, now, reached=frozenset()):
    """(d) branches: [{name, approve_ts, approve_sha}] (canary-shaped, approved, recent); run_ids: every queue/journal run;
    owned_globs: branch globs the ledger accounts for (rows parked/dropped/done, and branches_accounted); reached: commits
    reachable from a queued variant's canary sha, a promotion or main (an approved commit there WAS queued, under any name).
    One finding per branch name (its newest approve), so five re-stacks of one change are one stall, not five."""
    best = {}
    for b in branches:
        m = CANARY_BRANCH.match(b['name'])
        if not m or '-show' in b['name'] or not b.get('approve_ts'):
            continue
        name = m.group('name')
        if any(r == name or r.startswith(name + '-') or name.startswith(r + '-') for r in run_ids):
            continue
        if any(fnmatch.fnmatch(b['name'], g) for g in owned_globs) or b.get('approve_sha') in reached:
            continue
        if name not in best or b['approve_ts'] > best[name]['approve_ts']:
            best[name] = dict(b, n=(best.get(name) or {}).get('n', 0) + 1)
        else:
            best[name]['n'] += 1
    out = []
    for name, b in sorted(best.items()):
        h = hours(now, b['approve_ts'])
        if h > BRANCH_GRACE_H:
            more = f' (+{b["n"] - 1} older re-stack(s))' if b['n'] > 1 else ''
            out.append(F('d', name, f'branch {b["name"]}{more}: review APPROVE at {iso(b["approve_ts"])[:16]}Z ({b.get("approve_sha", "")[:8]}), '
                                    f'NO queue entry or run after {fmt_h(h)} -- queue it, or park/drop its ledger row',
                         None, h - BRANCH_GRACE_H))
    return out


def det_goals(alarms, items):
    """(g) STUCK project alarms older than STUCK_OWNER_H that no OPEN ledger row covers."""
    out = []
    pats = [p for i in items if i.get('state') == 'open' for p in i.get('covers_alarms') or []]
    for key, line in sorted((alarms or {}).items()):
        m = STUCK.search(str(line))
        if not m:
            continue
        h = float(m.group(1))
        if h <= STUCK_OWNER_H or any(fnmatch.fnmatch(key, p) for p in pats):
            continue
        out.append(F('g', key, f'{key}: STUCK {fmt_h(h)} and NO ledger row owns it (covers_alarms) -- give it an owner and a '
                               f'next step', None, h - STUCK_OWNER_H))
    return out


def det_monitors(registry, crontab_lines, mtimes, now, launchd=None, host='31'):
    """(h) registry: [{id, host, cron, launchd, outputs, fresh_hours, consumer, kind, until}]; crontab_lines: active lines;
    mtimes: {output glob: newest mtime or None}; launchd: labels loaded on the Mac (None = unknown)."""
    out = []
    regs = [r for r in registry if (r.get('host') or '31') == host]
    for r in regs:
        if r.get('until') and ts(r['until']) and now > ts(r['until']):
            out.append(F('h', r['id'] + ':until', f'monitor {r["id"]}: its temporary registration ended {r["until"]} -- '
                                                  f'remove the job or extend it'))
        if r.get('cron') and not any(r['cron'] in line for line in crontab_lines):
            out.append(F('h', r['id'] + ':cron', f'monitor {r["id"]}: registered but its cron line ({r["cron"]!r}) is NOT in '
                                                 f'the crontab -- reinstall it or retire the registration'))
            continue
        if (r.get('kind') or 'monitor') == 'monitor' and not (r.get('consumer') or '').strip():
            out.append(F('h', r['id'] + ':consumer', f'monitor {r["id"]}: NO CONSUMER -- nothing reads {", ".join(r.get("outputs") or [])[:120]}; '
                                                     f'wire it into fleetstatus/the digest, or retire the job'))
        fresh = r.get('fresh_hours')
        if fresh:
            newest = [t for t in (mtimes.get(o) for o in r.get('outputs') or []) if t]
            if not newest:
                out.append(F('h', r['id'] + ':missing', f'monitor {r["id"]}: NO output at {", ".join(r.get("outputs") or [])[:120]}'))
            else:
                h = hours(now, max(newest))
                if h > float(fresh):
                    out.append(F('h', r['id'] + ':stale', f'monitor {r["id"]}: output STALE {fmt_h(h)} (expected every '
                                                          f'{fresh} h) -- the job is failing or not running', None, h - float(fresh)))
    for line in crontab_lines:
        if not any(r.get('cron') and r['cron'] in line for r in regs):
            out.append(F('h', 'unregistered:' + re.sub(r'\W+', '_', line)[:60], f'cron line NOT REGISTERED in config/monitors.json '
                                                                                  f'(who reads its output?): {line[:160]}'))
    if launchd is not None:
        for r in registry:
            if r.get('host') == 'mac' and r.get('launchd') and r['launchd'] not in launchd:
                out.append(F('h', r['id'] + ':launchd', f'monitor {r["id"]}: launchd job {r["launchd"]} is not loaded on the Mac'))
    return out


def det_memories(items, memlist, no_row, now):
    """(m) memlist: {'generated_at', 'files': {name: mtime}} pushed from the Mac, or None; no_row: memories that need no row."""
    if not memlist:
        return [F('m', 'list-missing', 'the owner-memory list from the Mac (~/digest/owner-memories.json, pushed by opsaudit.sh) '
                                       'is MISSING -- new owner decisions without a ledger row cannot be seen')]
    out = []
    age = hours(now, ts(memlist.get('generated_at')) or now - dt.timedelta(days=99))
    if age > MEMORY_LIST_STALE_H:
        out.append(F('m', 'list-stale', f'the owner-memory list from the Mac is STALE ({fmt_h(age)}) -- opsaudit.sh is not pushing it',
                     None, age - MEMORY_LIST_STALE_H))
    named = {m for i in items for m in i.get('memory') or []}
    files = memlist.get('files') or {}
    for name in sorted(files):
        if name.startswith('owner-') and name.endswith('.md') and name not in named and name not in no_row:
            out.append(F('m', name, f'{name}: an owner decision with NO ledger row -- add one (or list it under memory_no_row '
                                    f'with why)'))
    for name in sorted(named - set(files)):
        out.append(F('m', 'gone:' + name, f'{name}: named by the ledger but NOT in the Mac memory dir'))
    return out


# --------------------------------------------------------------------------------------------------------- the report --
def rank(findings):
    real = [f for f in findings if not f.get('grace')]
    return sorted(real, key=lambda f: (WEIGHT.get(f['det'], 99), -f['age_h'], f['key']))


def header(findings, counts, input_errors):
    """-> ({key: line} alarms for alarmhead, which prints each with '!! '; the summary line used when there are none)."""
    al = {}
    r = rank(findings)
    if input_errors:
        al['inputs'] = 'stallcheck INPUT MISSING: ' + '; '.join(input_errors)[:300] + ' -- the check is partial'
    if r:
        by = {}
        for f in r:
            by[f['det']] = by.get(f['det'], 0) + 1
        top = ' | '.join(f['line'][:110] for f in r[:3])
        al['stalled'] = (f'STALLED: {len(r)} items ({" ".join(f"{k}{v}" for k, v in sorted(by.items(), key=lambda kv: WEIGHT[kv[0]]))}) '
                         f'-- top 3: {top} -- read ~/digest/stallcheck-latest.md')
    summary = (f'stallcheck: 0 stalled ({counts.get("open", 0)} open items of {counts.get("items", 0)}, '
               f'{counts.get("queue", 0)} queue entries, {counts.get("refs", 0)} refs, {counts.get("cron", 0)} cron lines checked)')
    return al, summary


DET_TITLE = {'L': 'L. ledger problems', 'a': 'a. quiet past its limit / park expired', 'b': 'b. dependency met, dependent not moving',
             'c': 'c. queue entries that can never launch', 'd': 'd. approved branches never queued',
             'e': 'e. lanes with nothing runnable', 'f': 'f. main vs the fleet', 'g': 'g. STUCK alarms with no owner',
             'h': 'h. monitors', 'm': 'm. owner decisions vs the ledger'}


def report_md(now, findings, counts, input_errors, since):
    r = rank(findings)
    lines = [f'STALLCHECK {iso(now)} STALLED: {len(r)}', '',
             f'Inputs read: {counts.get("items", 0)} ledger rows ({counts.get("open", 0)} open, {counts.get("parked", 0)} parked, '
             f'{counts.get("done", 0)} done, {counts.get("dropped", 0)} dropped); {counts.get("queue", 0)} queue entries; '
             f'{counts.get("journal", 0)} journal rows; {counts.get("refs", 0)} git refs; {counts.get("cron", 0)} cron lines; '
             f'{counts.get("monitors", 0)} registered monitors; {counts.get("alarms", 0)} goal alarms; '
             f'{counts.get("memories", 0)} owner memories listed; fleet {counts.get("fleet", "?")}.']
    if input_errors:
        lines += ['', '!! INPUT MISSING (the result is partial): ' + '; '.join(input_errors)]
    for det in sorted(DET_TITLE, key=lambda d: WEIGHT[d]):
        fs = [f for f in r if f['det'] == det]
        lines += ['', f'## {DET_TITLE[det]}: {len(fs)}']
        for f in fs:
            first = since.get(f['key'])
            lines.append(f'- {f["line"]}' + (f' (flagged since {first[:16]}Z)' if first else ''))
    lines += ['', 'Fix a row: edit config/owner-commitments.json on main (fetch, rebase). Park only with a date. '
                  'The check reads main within the hour.']
    return '\n'.join(lines) + '\n'


def update_since(prev, findings, now):
    return {f['key']: prev.get(f['key']) or iso(now) for f in findings}


# ------------------------------------------------------------------------------------------------------------- gather --
class Git:
    def __init__(self, repo):
        self.repo = repo

    def __call__(self, *a, timeout=60):
        r = subprocess.run(['git', '-C', self.repo] + list(a), capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout

    def show(self, ref, path):
        rc, out = self('show', f'{ref}:{path}')
        if rc != 0:
            raise FileNotFoundError(f'{ref}:{path}')
        return out

    def t(self, *a):
        rc, out = self(*a)
        s = out.strip().splitlines()
        return dt.datetime.fromtimestamp(int(s[0]), UTC) if rc == 0 and s and s[0].isdigit() else None

    def ancestor(self, a, b):
        return self('merge-base', '--is-ancestor', a, b)[0] == 0


def promotions_raw(journal):
    """PURE. [(run, sha, ts)] from the journal's promoted rows (the note's first token is the promoted sha)."""
    out = []
    for r in journal:
        sha = (str(r.get('note') or '').split() or [''])[0]
        if r.get('phase') == 'promoted' and re.match(r'^[0-9a-f]{7,40}$', sha) and ts(r.get('ts')):
            out.append((r.get('run'), sha, ts(r.get('ts'))))
    return out


def load_sched(path):
    spec = importlib.util.spec_from_file_location('canary_sched_ro', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def gather(a, errors):
    now = dt.datetime.now(UTC)
    g = Git(a.repo)
    if not a.no_fetch:
        rc, _ = g('fetch', '-q', '--prune', 'origin', timeout=180)
        if rc != 0:
            errors.append('git fetch failed (using the last fetched refs)')
    main = 'origin/main'
    try:
        ledger = json.loads(open(a.ledger).read() if a.ledger else g.show(main, 'config/owner-commitments.json'))
    except Exception as e:     # noqa: BLE001
        errors.append(f'ledger unreadable ({type(e).__name__})')
        ledger = {}
    try:
        registry = json.loads(open(a.monitors).read() if a.monitors else g.show(main, 'config/monitors.json')).get('monitors') or []
    except Exception as e:     # noqa: BLE001
        errors.append(f'monitors.json unreadable ({type(e).__name__})')
        registry = []
    # the queue and the journal through the scheduler's own reader (read-only: gather + entry_state, never tick)
    entries, journal, state_rows, fleet, canary_shas = [], [], [], None, set()
    try:
        S = load_sched(os.path.expanduser(a.sched))
        P = S.paths()
        sp = P.get('state')
        if not sp or not os.access(sp, os.R_OK):
            errors.append(f'scheduler state {sp} unreadable -- cancels/rearms are invisible, entry states are not trusted')
        st = S.gather(P, full=False)
        journal, state_rows = st.get('journal') or [], st.get('state_rows') or []
        man = st.get('manifest') if isinstance(st.get('manifest'), dict) else {}
        # the manifest may hold an abbreviated sha (deploy-fleet writes the registration's); queue variants are keyed on the
        # FULL sha: use the scheduler's own resolution, else resolve it in the clone below (Codex + Claude r1)
        fleet = st.get('base_full') or man.get('declared_code_version') or ''
        for e in (st.get('queue') or {}).get('entries') or []:
            entries.append({'run': e.get('run'), 'state': S.entry_state(e, st), 'hold': e.get('hold'),
                            'after': e.get('after') or [], 'variants': sorted((e.get('variants') or {}).keys())})
            canary_shas |= {str(v.get('canary_sha')) for v in (e.get('variants') or {}).values() if isinstance(v, dict)
                            and re.match(r'^[0-9a-f]{40}$', str(v.get('canary_sha')))}
        if not entries:
            errors.append('the queue has NO entries')
        if not journal:
            errors.append('the canary journal has NO rows')
    except Exception as e:     # noqa: BLE001
        errors.append(f'queue/journal unreadable via canary-sched.py ({type(e).__name__}: {str(e)[:80]})')
    if not fleet:
        errors.append('fleet sha unknown (manifest declared_code_version)')
        fleet = None
    else:
        rc, full = g('rev-parse', '--verify', '--quiet', fleet + '^{commit}')
        if rc != 0 or not re.match(r'^[0-9a-f]{40}$', full.strip()):
            errors.append(f'fleet sha {fleet[:8]} is not in the clone')
            fleet = None
        else:
            fleet = full.strip()
    items, lfind = validate(ledger)
    qstates = {e['run']: e['state'] for e in entries}
    runs_all = set(qstates) | {r.get('run') for r in journal if r.get('run')}
    want = set(runs_all)
    for i in items:
        want |= set((i.get('evidence') or {}).get('runs') or [])
        want |= {d['run'] for d in i.get('depends_on') or [] if isinstance(d, dict) and 'run' in d}
    runs = {r: run_info(r, qstates, journal, state_rows) for r in want}
    # git evidence
    rc, out = g('for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)%09%(objectname)', 'refs/remotes/origin')
    refs = []
    for line in out.splitlines():
        p = line.split('\t')
        if len(p) == 3 and p[0].startswith('origin/') and p[0] != 'origin/HEAD' and p[1].isdigit():
            refs.append((p[0][len('origin/'):], dt.datetime.fromtimestamp(int(p[1]), UTC), p[2]))
    if not refs:
        errors.append('the clone has NO origin refs')
    branch_ts, grep_ts, path_ts, fleet_has = {}, {}, {}, {}
    for i in items:
        e = i.get('evidence') or {}
        for b in e.get('branches') or []:
            if b not in branch_ts:
                hits = [t for n, t, _ in refs if fnmatch.fnmatch(n, b)]
                branch_ts[b] = max(hits) if hits else None
        for pat in e.get('grep') or []:
            if pat not in grep_ts:
                grep_ts[pat] = g.t('log', '--remotes=origin', '-i', '-F', f'--grep={pat}', '-1', '--format=%ct')
        p = tuple(e.get('paths') or [])
        if p and p not in path_ts:
            path_ts[p] = g.t('log', '-1', '--format=%ct', main, '--', *p)
        for fp in e.get('fleet_paths') or []:
            if fp not in fleet_has:
                fleet_has[fp] = bool(fleet) and g('cat-file', '-e', f'{fleet}:{fp}')[0] == 0
    ev = {'runs': runs, 'branch_ts': branch_ts, 'grep_ts': grep_ts, 'path_ts': path_ts, 'fleet_has': fleet_has}
    # canary-shaped recent branches carrying a review APPROVE in a commit main does not have
    branches = []
    for name, t, sha in refs:
        if not CANARY_BRANCH.match(name) or '-show' in name or hours(now, t) > BRANCH_RECENT_D * 24:
            continue
        rc, log = g('log', '-n', '80', '--format=%H%x09%ct%x09%s%n%b%x1e', f'{main}..origin/{name}')
        appr = None
        for blob in log.split('\x1e'):
            head, _, body = blob.strip().partition('\n')
            p = head.split('\t')
            if len(p) >= 3 and p[1].isdigit() and APPROVE.search(p[2] + '\n' + body):
                t2 = dt.datetime.fromtimestamp(int(p[1]), UTC)
                if appr is None or t2 > appr[0]:
                    appr = (t2, p[0])
        if appr:
            branches.append({'name': name, 'approve_ts': appr[0], 'approve_sha': appr[1]})
    reached = set()
    if branches:
        tips = {s for s in canary_shas | {p[1] for p in promotions_raw(journal)} if g('cat-file', '-e', s + '^{commit}')[0] == 0}
        rc, out2 = g('rev-list', '--since=%d' % int((now - dt.timedelta(days=BRANCH_RECENT_D + 7)).timestamp()), main, *sorted(tips),
                     timeout=120)
        reached = set(out2.split()) if rc == 0 else set()
    # main vs the fleet
    commits, promotions, fleet_on_main = [], [], None
    if fleet:
        rc, log = g('log', '--no-merges', '--cherry-pick', '--right-only', '--format=%H%x09%ct%x09%s',
                    f'{fleet}...{main}', '--', 'bots/src')
        for line in log.splitlines():
            p = line.split('\t', 2)
            if len(p) == 3 and p[1].isdigit():
                commits.append((p[0], dt.datetime.fromtimestamp(int(p[1]), UTC), p[2]))
        fleet_on_main = g.ancestor(fleet, main)
    for run, sha, t in promotions_raw(journal):
        if hours(now, t) <= PROMO_RECENT_D * 24:
            promotions.append((run, sha, t, g('cat-file', '-e', sha + '^{commit}')[0] == 0 and g.ancestor(sha, main)))
    # crontab, outputs, alarms, memories
    try:
        ct = (open(a.crontab).read() if a.crontab else
              subprocess.run(['crontab', '-l'], capture_output=True, text=True, timeout=20).stdout)
    except Exception:      # noqa: BLE001
        ct = ''
    cron_lines = [l.strip() for l in ct.splitlines() if l.strip() and not l.strip().startswith('#')]
    if not cron_lines:
        errors.append('crontab -l shows NO lines')
    mtimes = {}
    for r in registry:
        for o in r.get('outputs') or []:
            ps = glob.glob(os.path.expanduser(o))
            mtimes[o] = max((dt.datetime.fromtimestamp(os.path.getmtime(p), UTC) for p in ps), default=None)
    try:
        alarms = json.load(open(os.path.expanduser(a.goals))).get('alarms') or {}
    except Exception as e:     # noqa: BLE001
        errors.append(f'goalwatch state unreadable ({type(e).__name__})')
        alarms = {}
    try:
        memlist = json.load(open(os.path.expanduser(a.memories)))
    except Exception:      # noqa: BLE001
        memlist = None
    return {'now': now, 'items': items, 'lfind': lfind, 'ledger': ledger, 'ev': ev, 'entries': entries, 'fleet': fleet,
            'journal_n': len(journal), 'runs_all': runs_all, 'crontab': ct, 'cron_lines': cron_lines, 'registry': registry,
            'mtimes': mtimes, 'alarms': alarms, 'memlist': memlist, 'branches': branches, 'commits': commits,
            'promotions': promotions, 'fleet_on_main': fleet_on_main, 'refs_n': len(refs), 'reached': reached}


def evaluate(fx, since):
    """PURE given the gathered facts -> (findings, counts)."""
    now, items = fx['now'], fx['items']
    done_at = {i['id']: ts((i.get('done') or {}).get('when')) for i in items if i.get('state') == 'done'}
    parked_runs, lane_of, owned, suppress = {}, {}, [], {}
    for i in items:
        st, e = i.get('state'), i.get('evidence') or {}
        u = ts((i.get('parked') or {}).get('until')) if st == 'parked' else None
        if st == 'dropped' or (u and u > now):
            for r in e.get('runs') or []:
                parked_runs[r] = i['id']
        for r in e.get('runs') or []:
            lane_of.setdefault(r, i.get('lane'))
        if st in ('parked', 'dropped', 'done'):
            owned += e.get('branches') or []
        if st in ('parked', 'dropped') or i.get('fleet') is False:
            for gp in e.get('grep') or []:
                suppress[gp.lower()] = i['id']
    owned += list(((fx['ledger'] or {}).get('branches_accounted') or {}).keys())
    findings = list(fx['lfind'])
    findings += det_quiet(items, fx['ev'], now)
    findings += det_deps(items, fx['ev'], fx['crontab'], now, done_at)
    if fx['fleet']:            # with no fleet sha every entry would read 'no live variant' (INPUT MISSING already says why)
        findings += det_queue(fx['entries'], fx['fleet'], parked_runs, fx['runs_all'])
    findings += det_branches(fx['branches'], fx['runs_all'], owned, now, fx.get('reached') or frozenset())
    if fx['fleet']:
        findings += det_lanes(fx['entries'], fx['fleet'], lane_of, since, now)
    findings += det_unshipped(fx['commits'], fx['promotions'], now, fx['fleet_on_main'], suppress)
    findings += det_goals(fx['alarms'], items)
    findings += det_monitors(fx['registry'], fx['cron_lines'], fx['mtimes'], now, (fx['memlist'] or {}).get('launchd'))
    findings += det_memories(items, fx['memlist'], set((fx['ledger'] or {}).get('memory_no_row') or {}), now)
    c = {s: sum(1 for i in items if i.get('state') == s) for s in STATES}
    counts = dict(c, items=len(items), queue=len(fx['entries']), journal=fx['journal_n'], refs=fx['refs_n'],
                  cron=len(fx['cron_lines']), monitors=len(fx['registry']), alarms=len(fx['alarms']),
                  memories=len((fx['memlist'] or {}).get('files') or {}), fleet=(fx['fleet'] or '?')[:8])
    return findings, counts


def daily_push_due(state, now, hour=13):
    """PURE. One push a day, the first run at or after `hour` UTC (08:00 CDT)."""
    return now.hour >= hour and (state or {}).get('day') != now.strftime('%Y-%m-%d')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run'])
    ap.add_argument('--repo', default=os.path.expanduser('~/stallcheck/repo'))
    ap.add_argument('--ledger', help='a local ledger file instead of origin/main (trial runs)')
    ap.add_argument('--monitors', help='a local monitors.json instead of origin/main')
    ap.add_argument('--sched', default='~/canary-sched.py')
    ap.add_argument('--goals', default='~/digest/goalwatch-fleet.json')
    ap.add_argument('--memories', default='~/digest/owner-memories.json')
    ap.add_argument('--out-dir', default='~/digest')
    ap.add_argument('--crontab', help='a file instead of `crontab -l` (tests)')
    ap.add_argument('--no-fetch', action='store_true')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--print', action='store_true')
    a = ap.parse_args(argv)
    from lib import alarm as AL
    od = os.path.expanduser(a.out_dir)
    os.makedirs(od, exist_ok=True)
    errors = []
    sp = os.path.join(od, 'stallcheck-state.json')
    try:
        state = json.load(open(sp))
    except (OSError, ValueError):
        state = {}
    since = state.get('since') or {}
    try:
        fx = gather(a, errors)
        findings, counts = evaluate(fx, since)
    except Exception as e:      # noqa: BLE001 -- a crash is an alarm in the header, never a silently stale file
        now = dt.datetime.now(UTC)
        AL.write_json_atomic(os.path.join(od, 'stallcheck-fleet.json'),
                             {'generated_at': iso(now), 'summary': 'stallcheck crashed',
                              'alarms': {'crash': f'stallcheck CRASHED ({type(e).__name__}: {str(e)[:200]}) -- see ~/digest/stallcheck.log'}})
        raise
    since = update_since(since, findings, fx['now'])
    al, summary = header(findings, counts, errors)
    md = report_md(fx['now'], findings, counts, errors, since)
    tmp = os.path.join(od, 'stallcheck-latest.md.tmp')
    with open(tmp, 'w') as f:
        f.write(md)
    os.replace(tmp, os.path.join(od, 'stallcheck-latest.md'))
    AL.write_json_atomic(os.path.join(od, 'stallcheck-fleet.json'),
                         {'generated_at': iso(fx['now']), 'alarms': al, 'summary': summary, 'counts': counts,
                          'findings': rank(findings)})
    push = state.get('push') or {}
    if not a.no_push and al and daily_push_due(push, fx['now']):
        body = '\n'.join([al.get('inputs', '')] + [f'- {f["line"][:200]}' for f in rank(findings)[:12]]).strip()
        AL.one_shot('stallcheck', {f'daily {fx["now"]:%Y-%m-%d}: {len(rank(findings))} stalled': body}, fx['now'])
        push = {'day': fx['now'].strftime('%Y-%m-%d'), 'at': iso(fx['now'])}
    AL.write_json_atomic(sp, {'since': since, 'push': push})
    print(f'{iso(fx["now"])} ' + (al.get('stalled') or summary)[:300] + (f' | {al["inputs"][:200]}' if 'inputs' in al else ''))
    if a.print:
        print(md)
    return 0


if __name__ == '__main__':
    sys.exit(main())
