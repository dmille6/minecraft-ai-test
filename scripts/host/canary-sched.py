#!/usr/bin/env python3
"""canary-sched.py -- the canary SCHEDULER: launch the owner's next queued canary into an EMPTY slot, or say why not.

    canary-sched.py tick [--no-act]               one decision (cron */5); --no-act prints it, writes and launches nothing
    canary-sched.py status                        each queue entry's state, and what the next tick would decide
    canary-sched.py queue add <entry.json>        append (validated against the files NOW; hashes computed if absent)
    canary-sched.py queue hold <run> <why> | release <run> | not-before <run> <ISO> | replace-variant <run> <entry.json>
    canary-sched.py rearm <run> <why>             a BLOCKED entry whose run never deployed may launch again
    canary-sched.py closed <run> <why> [--sha S]  a DEPLOYED run finished by hand: refuses without its ledger decision;
                                                  --sha picks one of the run's recorded sha sources when they disagree
                                                  (the ledger row for it must still exist: not a waiver)
    canary-sched.py abandon <run> <why>           a NEVER-deployed run (refused, stopped in its draw) resolved: frees
                                                  the slot, never satisfies `after`
    canary-sched.py cancel <run> <why>            owner-authorised: the run leaves the queue; NOT a completion.
                                                  FINAL: to run it later, queue it under a NEW run id
    canary-sched.py continue <run> <why>          release the hold that follows a death-driven REVERT (R11)
    canary-sched.py install-hold <owner> <minutes> | install-release
                                                  stop NEW launches for an installer; exits 2 unless the slot is free now

DESIGN: docs/reports/canary-throughput-2026-10-08.md (Codex + Claude, four review rounds). The owner asked for more
canary throughput (10-08 ~02:30Z). Both engines rejected concurrent lanes for now and agreed on this: chain-after.sh
relaunches 2-3 min after a terminal phase, but only for the one pair an operator set up by hand; this generalises it to
the owner's whole ordered queue. It launches the loop exactly as chain-after does and changes no other file except one
fail-closed line in drawrec.sh (see the design doc, section F).

WHAT IT WILL NEVER DO
  * launch while any sign of a canary, deploy, teardown, install or chain is present (S1-S8);
  * look past the HEAD of the queue: no variant, a hold, a refusal or an unmet dependency BLOCKS and pages;
  * retry by itself: a launch that refused, or whose loop died, waits for a human `rearm`;
  * take, or probe by acquiring, the loop's lock. That lock IS the exclusion: the loop and the v33/v34 installers each
    ACQUIRE it (flock -n) for their whole run, so whichever is second refuses before touching anything;
  * overwrite a read in /tmp, or edit a registration, the manifest, the loop or a drop-in.

THE CHECKS
  S1 manifest parses and declares no canary          S2 no loop/chain/launch/install/fleet-deploy/d.sh/drawrec process
  S3 nobody holds the loop's lock (/proc/locks)      S4 no canary drop-in; the unit directory is readable
  S5 every ACTIVE unit has a row newer than max(15 min ago, the last close) on the ONE declared build; an inactive
     enabled unit passes only without a drop-in; >= MIN_FRESH fresh as the positive control
  S6 openloop.open_loop says nothing is open
  S7 no run is `open` (drawn or later, not closed, no live loop) -- closed = promoted|torn-down + recorded + a ledger row
     for its sha and pools at/after its deploy, or a human `closed`
  S8 no SCHED-PAUSE, no INSTALL-HOLD                  R11 the last closed run was not a death-driven REVERT (or `continue`)
  H1 head not held, not_before passed, every `after` run DONE      H2 one variant keyed by the FULL base sha
  H3 registration bytes/sha/class = queued, descends from base, run never deployed, staged copy absent or identical
  H4 every read in /tmp has the queued md5 (an ABSENT one is staged from reads_src; a different one is never overwritten)
  H5 NEXT-SLOT.json admits only underground-safety    H6 a bag fix needs drawrec TARGET_K >= 4
  R10 drawexposure.py answers for the head
"""
import os, sys, json, re, glob, hashlib, subprocess, fcntl, tempfile, shutil, datetime as dt

UTC = dt.timezone.utc
CLOSED_PHASES = ('promoted', 'torn-down')
REFUSAL_PREFIXES = ('refused', 'preflight-refused')
IGNORED_PHASES = ('operator-note',)
min_fresh = lambda: int(os.environ.get('SCHED_MIN_FRESH', '75'))   # read per call (a fixture sets it)
FRESH_MIN = 15
SETTLE_MIN = 30
PAGE_EVERY_H = 3.0
STALL_H = 3.0
LAUNCH_PAGE_MIN = 15
# the death-driven REVERT wordings of verdict.py (the trip, not the "deaths N (...)" header every line carries, nor the
# "death gate HELD (reported, not a verdict)" advisory): chestfull-01 "death gate: 3 canary deaths", junkwell-01
# "rung-linked death on a non-ladder change", the change-row licence "linked death"
DEATH_REVERT = re.compile(r'death gate:|death gate trip|rung-linked death|linked death|death-linked|death window', re.I)
ABANDON_AFTER_DRAWN_MIN = 20
HEX40 = re.compile(r'^[0-9a-f]{40}$')
SLOT_PROCS = (  # basename of argv[0] or argv[1]; never a substring of the whole command line (pgrep -f self-matches)
    ('canary-loop.sh', lambda b: b == 'canary-loop.sh'),
    ('chain-*.sh', lambda b: bool(re.match(r'^chain-.*\.sh$', b))),
    ('launch-*.sh', lambda b: bool(re.match(r'^launch-.*\.sh$', b))),
    ('install-*.sh', lambda b: bool(re.match(r'^install-.*\.sh$', b))),
    ('fleet-deploy', lambda b: b == 'fleet-deploy'),
    ('deploy-fleet.sh', lambda b: b == 'deploy-fleet.sh'),
    ('mcai-canary-tree', lambda b: b in ('mcai-canary-tree', 'canary-tree.sh')),
    ('drawrec.sh', lambda b: b == 'drawrec.sh'),
)


# ------------------------------------------------------------------------------------------------ configuration --
def paths():
    """Every path the scheduler touches, from ONE place, so a replay can point all of them at a fixture tree."""
    H = os.environ.get('SCHED_HOME', '/home/mike')
    g = lambda k, d: os.environ.get(k, d)
    D = os.path.join(H, 'digest')
    return {
        'home': H,
        'manifest': g('SCHED_MANIFEST', '/srv/mcbots/trial-manifest.json'),
        'journal': g('SCHED_JOURNAL', os.path.join(H, 'canary-journal.jsonl')),
        'ledger': g('SCHED_LEDGER', '/var/log/mcai/_canary-decisions.jsonl'),
        'queue': g('SCHED_QUEUE', os.path.join(H, 'canary-queue.json')),
        'queue_lock': g('SCHED_QUEUE_LOCK', os.path.join(H, 'canary-queue.lock')),
        'state': g('SCHED_STATE', os.path.join(D, 'sched-state.jsonl')),
        'page': g('SCHED_PAGE', os.path.join(D, 'page.jsonl')),
        'reads_out': g('SCHED_READS_OUT', os.path.join(D, 'reads')),
        'pause': os.path.join(D, 'SCHED-PAUSE'),
        'install_hold': os.path.join(D, 'INSTALL-HOLD'),
        'next_slot': os.path.join(D, 'NEXT-SLOT.json'),
        'unread': os.path.join(D, 'CANARY-UNREAD.txt'),
        'regdir': g('SCHED_REGDIR', os.path.join(H, 'mcai-analysis', 'registrations')),
        'readdir': g('SCHED_READ_DIR', '/tmp'),
        'unitdir': g('SCHED_UNIT_DIR', '/etc/systemd/system'),
        'units_file': g('SCHED_UNITS_FILE', ''),          # fixture: `systemctl list-units --plain` lines; live: systemctl
        'unit_enter_file': g('SCHED_UNIT_ENTER_FILE', ''), # fixture: {bot: ActiveEnterTimestamp ISO}
        'canary_tree': g('SCHED_CANARY_TREE', '/srv/mcbots/harness-canary/'),
        'logs': g('SCHED_LOG_GLOB', '/var/log/mcai/*/skill-*.jsonl'),
        'loop_lock': g('SCHED_LOOP_LOCK', '/tmp/mcai-canary.lock'),
        'proc_locks': g('SCHED_PROC_LOCKS', '/proc/locks'),
        'tick_lock': g('SCHED_TICK_LOCK', os.path.join(H, 'sched.lock')),
        'git': g('SCHED_GIT_DIR', '/opt/minecraft-ai'),
        'loop': g('SCHED_LOOP', os.path.join(H, 'canary-loop.sh')),
        'drawrec': g('SCHED_DRAWREC', os.path.join(H, 'mcai-analysis', 'drawrec.sh')),
        'drawexposure': g('SCHED_DRAWEXPOSURE', os.path.join(H, 'mcai-analysis', 'drawexposure.py')),
        'openloop_lib': g('SCHED_OPENLOOP_LIB', os.path.join(H, 'mcai-analysis', 'lib')),
        'proc': g('SCHED_PROC', '/proc'),
        'out': g('SCHED_OUT_DIR', H),
    }


def now():
    f = os.environ.get('SCHED_FAKE_NOW')
    return dt.datetime.fromisoformat(f.replace('Z', '+00:00')) if f else dt.datetime.now(UTC)


def ts(s):
    try:
        t = dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
        return t if t.tzinfo else t.replace(tzinfo=UTC)
    except Exception:
        return None


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def pools_set(s):
    return frozenset(p.strip() for p in str(s or '').split(',') if p.strip())


def sha_match(a, b):
    a, b = str(a or ''), str(b or '')
    return len(a) >= 7 and len(b) >= 7 and (a.startswith(b) or b.startswith(a))


# --------------------------------------------------------------------------------------------- pure decisions --
def humans(state_rows):
    h = {}
    for r in state_rows:
        if r.get('state') == 'human':
            h.setdefault(r.get('run'), []).append((r.get('how'), ts(r.get('at'))))
    return h


def last_human(st, run, hows):
    for how, at in reversed((st.get('humans') or {}).get(run, [])):
        if how in hows:
            return how, at
    return None, None


def run_rows(journal, run):
    return [r for r in journal if r.get('run') == run and r.get('phase') not in IGNORED_PHASES]


DEPLOYED_EVIDENCE = ('recorded', 'promoted', 'torn-down', 'poll-revert', 'deadline', 'contained', 'keep-unpromoted')


def deployment(rows):
    """(deployed ts, pools) from the run's FIRST `deployed` line ('<pools> <declared_at>'); or, for a run whose loop
    never journalled `deployed` but READ or DECIDED it (deathfix-02, 09-30: drawn -> read-180 -> recorded -> promoted),
    from its `drawn` line ('<pools> :: ...'). (None, None) = it never deployed."""
    for r in rows:
        if r.get('phase') == 'deployed':
            parts = str(r.get('note') or '').split()
            return ts(r.get('ts')), pools_set(parts[0] if parts else '')
    ev = [i for i, r in enumerate(rows) if str(r.get('phase', '')).startswith('read-') or r.get('phase') in DEPLOYED_EVIDENCE]
    if ev:
        # the LAST draw before the first read/decision: an earlier, abandoned attempt's draw is not this deployment
        dr = [r for r in rows[:ev[0]] if r.get('phase') == 'drawn']
        if dr:
            return ts(dr[-1].get('ts')), pools_set(str(dr[-1].get('note') or '').split(' ', 1)[0])
    return None, None


def ledger_row(ledger, sha, pools, since):
    """R1: the newest ledger decision for THIS deployment (sha prefix, same pools, at/after its deploy), or None."""
    if not sha or not pools or since is None:
        return None
    for d in reversed(ledger or []):
        if not isinstance(d, dict) or not sha_match(d.get('canary_sha'), sha):
            continue
        if pools_set(d.get('canary_pool')) != pools:
            continue
        w = ts(d.get('ts'))
        if w is None or w < since:
            continue
        if str(d.get('decision') or '').upper() in ('KEEP', 'REVERT', 'INCONCLUSIVE'):
            return d
    return None


def loop_alive_for(st, run):
    """A canary-loop.sh process whose argv names this run."""
    return any(p['name'] == 'canary-loop.sh' and run in p['argv'][p['argv'].index(p['script']) + 1:][:1]
               for p in st.get('procs') or [] if p.get('script'))


def journal_status(run, st):
    """'closed' | 'live' | 'predeploy' | 'abandoned' | 'open' | 'never' -- design r4 B + r5 V1.

    closed     promoted|torn-down + recorded + the R1 ledger row; or a human `closed` (which itself demands that row)
    live       a loop for this run is alive
    abandoned  a human `abandon`ed it (never deployed) and nothing was journalled since: frees the slot, not a completion
    predeploy  no `drawn`, no `deployed`, no live loop: refused or stopped before the draw -- touched nothing
    open       drew or deployed, not closed, no live loop: blocks the slot until `closed` (deployed) or `abandon`
    """
    how, _ = last_human(st, run, ('closed', 'historical'))
    if how in ('closed', 'historical'):
        return 'closed'
    rows = run_rows(st.get('journal') or [], run)
    if not rows:
        return 'never'
    phases = [r.get('phase', '') for r in rows]
    dts, pools = deployment(rows)
    if any(p in CLOSED_PHASES for p in phases) and 'recorded' in phases and dts is not None and \
            ledger_row(st.get('ledger'), (st.get('reg_sha') or {}).get(run), pools, dts) is not None:
        return 'closed'
    if loop_alive_for(st, run):
        return 'live'
    _, ab = last_human(st, run, ('abandon',))
    if ab is not None:
        # `abandon` (V1) resolves every row journalled up to it: only a NEVER-deployed run can be abandoned
        rows = [r for r in rows if (ts(r.get('ts')) or ab) > ab]
        if not rows:
            return 'abandoned'
        phases = [r.get('phase', '') for r in rows]
        dts, pools = deployment(rows)
    if 'drawn' not in phases and dts is None:
        return 'predeploy'
    return 'open'


def attempts(st, run):
    """This run's scheduler attempts since its last `rearm` (by ORDER in sched-state, not by timestamp: a rearm and a
    launch can share a second), newest last: [{'t0', 'pid', 'start'}]."""
    out = []
    for r in st.get('state_rows') or []:
        if r.get('run') != run:
            continue
        if r.get('state') == 'human' and r.get('how') == 'rearm':
            out = []
        elif r.get('state') == 'launching':
            out.append({'t0': ts(r.get('t0')), 'pid': None, 'start': None})
        elif r.get('state') == 'launched-pid' and out:
            out[-1]['pid'], out[-1]['start'] = r.get('pid'), r.get('start')
    return out


def attempt_rows(st, run, att):
    t0 = att['t0']
    return [r for r in run_rows(st.get('journal') or [], run) if t0 and (ts(r.get('ts')) or t0) >= t0]


def entry_state(e, st):
    """done | cancelled | running | launching | blocked | ready (design r4 section B)."""
    run = e.get('run')
    js = journal_status(run, st)
    if js == 'closed':
        return 'done'
    how, _ = last_human(st, run, ('cancel',))
    if how == 'cancel':
        return 'cancelled'
    if js == 'live':
        return 'running'
    att = attempts(st, run)
    if att:
        a = att[-1]
        if attempt_rows(st, run, a):
            return 'blocked'                     # it journalled, is not live and not closed: predeploy or open
        alive = st.get('pid_alive') or {}
        if a['pid'] and str(a['pid']) in alive and a.get('start') is not None and alive[str(a['pid'])] == a['start']:
            return 'launching'
        return 'blocked'                         # died with no line, or crashed before the Popen (no pid)
    _, rearm_at = last_human(st, run, ('rearm',))
    _, ab_at = last_human(st, run, ('abandon',))
    if js in ('open',):
        return 'blocked'
    if js in ('predeploy', 'abandoned') and not (rearm_at and (ab_at is None or rearm_at >= ab_at)):
        return 'blocked'                         # refused or abandoned and not rearmed since: a human decides
    return 'ready'


def head_entry(st):
    for e in (st.get('queue') or {}).get('entries') or []:
        if entry_state(e, st) not in ('done', 'cancelled'):
            return e
    return None


def slot_blockers(st):
    """S1-S8 + R11 -> (busy, block). busy = something is running or settling; block = a human must act."""
    busy, block = [], []
    man = st.get('manifest')
    if not isinstance(man, dict):
        block.append(('S1', 'manifest unreadable: %s' % st.get('manifest_error')))
    elif man.get('canary_pool') or man.get('canary_code_version'):
        busy.append(('S1', 'canary declared: %s on %s' % (man.get('canary_code_version'), man.get('canary_pool'))))
    if st.get('procs'):
        busy.append(('S2', 'running: ' + '; '.join(p['desc'] for p in st['procs'][:4])))
    lk = st.get('loop_lock')
    if lk is None:
        block.append(('S3', 'cannot read /proc/locks or stat the loop lock: lock state unknown'))
    elif lk:
        busy.append(('S3', 'the loop lock is held (%s)' % lk))
    if not st.get('unitdir_ok'):
        block.append(('S4', 'the unit directory is unreadable (no mcbot@.service seen): drop-ins cannot be ruled out'))
    elif st.get('dropins'):
        busy.append(('S4', 'canary drop-ins present: ' + ', '.join(st['dropins'][:4])))
    s5 = []
    declared = (man or {}).get('declared_code_version') if isinstance(man, dict) else None
    if st.get('fresh_bots', 0) < min_fresh():
        s5.append('only %d bots fresh (need %d): restarts in progress, or an outage' % (st.get('fresh_bots', 0), min_fresh()))
    if st.get('units') is None:
        s5.append('the unit list (systemctl list-units mcbot@* --all) could not be read')
    else:
        builds = st.get('active_builds') or {}
        if len(builds) != 1:
            s5.append('%d builds on the active units: %s' % (len(builds), dict(sorted(builds.items())[:4])))
        elif not declared or not sha_match(list(builds)[0].split('+')[0], declared):
            s5.append('the active units run %s, not the declared %s' % (list(builds)[0], declared))
        if st.get('stale_units'):
            s5.append('%d active unit(s) have no row since %s and did not start after the last decision: %s'
                      % (len(st['stale_units']), st.get('fresh_since'), ', '.join(st['stale_units'][:5])))
        if st.get('transitional_units'):
            s5.append('unit(s) in transition: %s' % ', '.join(st['transitional_units'][:5]))
        if st.get('stopped_with_dropin'):
            s5.append('stopped unit(s) still carrying a canary drop-in: %s' % ', '.join(st['stopped_with_dropin'][:5]))
        nb, na = st.get('bot_procs', 0), len([1 for a, _ in st['units'].values() if a == 'active'])
        if nb < max(1, na - 5):
            s5.append('process scan sees %d bot processes for %d active units: /proc unreadable? (no proof that no '
                      'canary process survives)' % (nb, na))
    if st.get('canary_procs') and isinstance(man, dict) and not man.get('canary_pool'):
        s5.append('%d process(es) still run from the canary tree with no canary declared: %s'
                  % (len(st['canary_procs']), '; '.join(st['canary_procs'][:3])))
    if s5:
        settling = st.get('last_close') and (st['now'] - st['last_close']).total_seconds() < SETTLE_MIN * 60
        (busy if (settling or busy) else block).extend(('S5', x) for x in s5)
    if st.get('openloop'):
        # a declared canary with no decision yet IS the live canary (busy); anything else is a fault a human must see
        live = isinstance(man, dict) and (man.get('canary_pool') or man.get('canary_code_version'))
        (busy if live else block).append(('S6', 'open loop: %s' % st['openloop']))
    for run in st.get('runs') or []:
        js = journal_status(run, st)
        if js == 'live':
            busy.append(('S7', '%s is live' % run))
        elif js == 'open':
            (busy if busy else block).append(
                ('S7', 'run %s drew or deployed and is not closed (no promoted|torn-down + recorded + ledger row, no live '
                       'loop): finish its three-step teardown and ledger by hand, then `canary-sched.py closed %s <why>`'
                 % (run, run)))
    if st.get('pause'):
        block.append(('S8', 'SCHED-PAUSE present'))
    ih = st.get('install_hold')
    if ih is not None:
        stale = (ts(ih.get('until')) or st['now']) < st['now']
        (block if stale else busy).append(('S8', 'INSTALL-HOLD by %s until %s%s' % (
            ih.get('owner'), ih.get('until'), ' -- STALE: the installer must release it' if stale else '')))
    if st.get('death_hold'):
        block.append(('R11', 'the last closed run %s was a death-driven REVERT (%s); the owner held after one before: '
                             '`canary-sched.py continue %s <why>` to go on' % (st['death_hold'][0], st['death_hold'][1],
                                                                               st['death_hold'][0])))
    return busy, block


def head_blockers(e, st):
    """H1-H6 for the head -> list of (code, reason, waiting?)."""
    out = []
    run = e.get('run')
    if e.get('hold'):
        out.append(('H1', 'held: %s' % e['hold'], False))
    if e.get('not_before'):
        nb = ts(e['not_before'])
        if nb is None:
            out.append(('H1', 'not_before %r unparseable' % e['not_before'], False))
        elif nb > st['now']:
            out.append(('H1', 'not before %s' % e['not_before'], True))
    entries = {x.get('run'): x for x in (st.get('queue') or {}).get('entries') or []}
    for a in e.get('after') or []:
        if journal_status(a, st) == 'closed':
            continue
        dep = entries.get(a)
        hw, _ = last_human(st, a, ('cancel', 'abandon'))
        ds = entry_state(dep, st) if dep else ({'cancel': 'cancelled', 'abandon': 'abandoned'}.get(hw) or journal_status(a, st))
        if ds in ('cancelled', 'blocked', 'predeploy', 'abandoned'):
            out.append(('H1', 'depends on %s, which is %s (not a completion): edit the queue' % (a, ds), False))
        else:
            out.append(('H1', 'waits for %s to close (%s)' % (a, ds), True))
    es = entry_state(e, st)
    if es == 'blocked':
        out.append(('H3', 'blocked since its last attempt (%s): fix it, then `rearm %s <why>` or `cancel %s <why>`'
                    % (journal_status(run, st), run, run), False))
    base = st.get('base_full')
    vs = e.get('variants') or {}
    if not base:
        out.append(('H2', 'the fleet base could not be resolved to a full sha', False))
    elif base not in vs:
        out.append(('H2', 'no variant for the fleet base %s (have: %s)' % (base[:7], ', '.join(k[:7] for k in vs) or 'none'),
                    False))
    else:
        for code, why in (st.get('variant_checks') or []):
            out.append((code, why, False))
    if st.get('next_slot') and e.get('class') != 'underground-safety':
        out.append(('H5', 'NEXT-SLOT reserved for an underground-safety fix; head is class %r' % (e.get('class') or ''),
                    False))
    if e.get('class') == 'bag-fix' and not st.get('drawrec_k4'):
        out.append(('H6', 'bag fix needs drawrec.sh TARGET_K >= 4', False))
    return out


def decide(st):
    """('launch', entry, variant) | (kind, reasons), kind in busy|block|wait|idle|launching. PURE."""
    busy, block = slot_blockers(st)
    if block:
        return ('block', block + busy)
    if busy:
        return ('busy', busy)
    e = head_entry(st)
    if e is None:
        return ('idle', [('Q', 'queue empty, or every entry done/cancelled')])
    if entry_state(e, st) in ('launching', 'running'):
        return ('launching', [('L4', '%s: launched, waiting for its first journal line' % e.get('run'))])
    hb = head_blockers(e, st)
    if hb:
        return ('wait' if all(w for _, _, w in hb) else 'block', [(c, '%s: %s' % (e.get('run'), r)) for c, r, _ in hb])
    if st.get('r10'):
        return ('wait' if st['r10'].startswith('WAIT') else 'block', [('R10', '%s: %s' % (e.get('run'), st['r10']))])
    return ('launch', e, e['variants'][st['base_full']])


# ------------------------------------------------------------------------------------------------------ gather --
def read_jsonl(p):
    rows = []
    try:
        with open(p) as f:
            for l in f:
                l = l.strip()
                if l:
                    try:
                        rows.append(json.loads(l))
                    except Exception:
                        pass
    except FileNotFoundError:
        pass
    return rows


def sha256(p):
    with open(p, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def md5(p):
    with open(p, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def starttime(P, pid):
    try:
        with open(os.path.join(P['proc'], str(pid), 'stat')) as f:
            return f.read().rsplit(')', 1)[1].split()[19]       # field 22 overall, counted after "(comm)"
    except Exception:
        return None


def procs(P):
    """Processes that own the slot, from /proc/<pid>/cmdline; {pid: starttime} for every process; every process running
    from the canary tree (a canary process that outlived its teardown); and how many bot processes it could see at all
    (the positive control: an unreadable /proc would otherwise read as 'no canary process')."""
    hits, alive, tree, nbot, me = [], {}, [], [0], os.getpid()
    for d in glob.glob(os.path.join(P['proc'], '[0-9]*')):
        try:
            pid = int(os.path.basename(d))
            with open(os.path.join(d, 'cmdline'), 'rb') as f:
                argv = [x for x in f.read().decode('utf-8', 'replace').split('\0') if x]
        except Exception:
            continue
        alive[str(pid)] = starttime(P, pid)
        if pid == me or not argv:
            continue
        if any(x.endswith('src/index.mjs') for x in argv):
            nbot[0] += 1
        if any(P['canary_tree'] in x for x in argv):
            tree.append('pid %d: %s' % (pid, ' '.join(argv)[:80]))
        hit, script = None, None
        for x in argv[:2]:
            b = os.path.basename(x)
            n = next((n for n, pred in SLOT_PROCS if pred(b)), None)
            if n:
                hit, script = n, x
                break
        if hit is None and '/root/d.sh' in argv[:4]:
            hit = '/root/d.sh'
        if hit:
            hits.append({'name': hit, 'pid': pid, 'argv': argv, 'script': script,
                         'desc': '%s (pid %d: %s)' % (hit, pid, ' '.join(argv)[:90])})
    return hits, alive, tree, nbot[0]


def ancestors(P, pid):
    """{pid and every parent up to init}, from /proc/<pid>/stat field 4."""
    out = set()
    while pid and pid not in out:
        out.add(pid)
        try:
            with open(os.path.join(P['proc'], str(pid), 'stat')) as f:
                pid = int(f.read().rsplit(')', 1)[1].split()[1])
        except Exception:
            break
    return out


def loop_lock_holder(P):
    """'' nobody holds it, 'pid N' someone does, None unknowable. NEVER acquires it (a probe that takes the lock even
    for a microsecond can make a loop starting at that instant exit 3)."""
    try:
        ino = os.stat(P['loop_lock']).st_ino
    except FileNotFoundError:
        return ''
    except Exception:
        return None
    try:
        with open(P['proc_locks']) as f:
            lines = f.read().splitlines()
    except Exception:
        return None
    for l in lines:
        parts = [x for x in l.split() if x != '->']
        if len(parts) < 6:
            return None
        try:
            if int(parts[5].split(':')[-1]) == ino:
                return 'pid %s' % parts[4]
        except ValueError:
            return None
    return ''


def telemetry(P):
    """{bot: (newest ts, full version)} from the last 64 KB of each bot's live skill log."""
    newest = {}
    for f in glob.glob(P['logs']):
        try:
            with open(f, 'rb') as fh:
                fh.seek(0, 2); n = fh.tell(); fh.seek(max(0, n - 65536))
                tail = fh.read().decode('utf-8', 'replace').splitlines()
        except Exception:
            continue
        for line in reversed(tail):
            try:
                d = json.loads(line)
            except Exception:
                continue
            b = (d.get('bot') or {}).get('name'); v = (d.get('code') or {}).get('version'); w = ts(d.get('@timestamp'))
            if b and v and w:
                if b not in newest or w > newest[b][0]:
                    newest[b] = (w, v)
                break
    return newest


def unit_states(P):
    """{bot: (ActiveState, SubState)} for EVERY loaded mcbot unit (--all: transitional and stopped ones too), or None."""
    try:
        if P['units_file']:
            with open(P['units_file']) as f:
                lines = f.read().splitlines()
        else:
            r = subprocess.run(['systemctl', 'list-units', 'mcbot@*', '--all', '--no-legend', '--plain'],
                               capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                return None
            lines = r.stdout.splitlines()
        out = {}
        for l in lines:
            f = l.split()
            if len(f) >= 4 and f[0].startswith('mcbot@') and f[0].endswith('.service'):
                out[f[0][len('mcbot@'):-len('.service')]] = (f[2], f[3])
        return out if out else None
    except Exception:
        return None


def parse_systemd_ts(v):
    """`Wed 2026-10-07 23:53:11 UTC` (systemctl show, run with TZ=UTC) -> aware datetime; anything else -> None."""
    v = (v or '').strip()
    try:
        return dt.datetime.strptime(v, '%a %Y-%m-%d %H:%M:%S UTC').replace(tzinfo=UTC) if v.endswith(' UTC') else None
    except ValueError:
        return None


def unit_enter(P, bot):
    """The unit's ActiveEnterTimestamp (when its current process started), or None."""
    try:
        if P['unit_enter_file']:
            with open(P['unit_enter_file']) as f:
                return ts(json.load(f).get(bot))
        r = subprocess.run(['systemctl', 'show', '-p', 'ActiveEnterTimestamp', '--value', 'mcbot@%s.service' % bot],
                           capture_output=True, text=True, timeout=30, env=dict(os.environ, TZ='UTC'))
        return parse_systemd_ts(r.stdout)
    except Exception:
        return None


def git(P, *a):
    r = subprocess.run(['git', '-C', P['git']] + list(a), capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def full_sha(P, s):
    if not s or not re.match(r'^[0-9a-f]{4,40}$', str(s)):
        return None
    rc, out = git(P, 'rev-parse', '--verify', '--quiet', '%s^{commit}' % s)
    return out if rc == 0 and HEX40.match(out) else None


def variant_checks(P, e, v, base, st):
    """H3 + H4 (impure) -> (list of (code, why), the /tmp staging plan of ABSENT reads)."""
    out, stage = [], []
    run = e.get('run')
    reg = v.get('registration')
    try:
        if sha256(reg) != v.get('registration_sha256'):
            out.append(('H3', 'registration %s changed since it was queued (sha256)' % reg))
        with open(reg) as f:
            r = json.load(f)
        cs = full_sha(P, r.get('sha'))
        if not cs or cs != v.get('canary_sha'):
            out.append(('H3', 'registration sha %s is not the queued canary %s' % (r.get('sha'), str(v.get('canary_sha'))[:7])))
        elif git(P, 'merge-base', '--is-ancestor', base, cs)[0] != 0:
            out.append(('H3', 'canary %s does not descend from the fleet base %s' % (cs[:7], base[:7])))
        if (r.get('class') or '') != (e.get('class') or ''):
            out.append(('H3', 'queued class %r != registration class %r' % (e.get('class') or '', r.get('class') or '')))
        if sorted(r.get('reads') or []) != sorted((v.get('reads') or {}).keys()):
            out.append(('H3', 'registered reads %s are not the queued reads %s' % (r.get('reads'), sorted(v.get('reads') or {}))))
    except Exception as x:
        out.append(('H3', 'registration unreadable: %s' % x))
    dst = os.path.join(P['regdir'], '%s.json' % run)
    if os.path.exists(dst):
        try:
            if sha256(dst) != v.get('registration_sha256'):
                out.append(('H3', '%s exists with other content: reconcile it by hand (or `queue replace-variant`)' % dst))
        except Exception as x:
            out.append(('H3', '%s unreadable: %s' % (dst, x)))
    if deployment(run_rows(st.get('journal') or [], run))[0] is not None:
        out.append(('H3', 'the journal shows %s DEPLOYED before: a run id is one deployment; queue a new id' % run))
    for name, want in sorted((v.get('reads') or {}).items()):
        live = os.path.join(P['readdir'], '%s.py' % name)
        src = os.path.join(v.get('reads_src') or '/nonexistent', '%s.py' % name)
        try:
            if os.path.exists(live):
                got = md5(live)
                if got != want:
                    out.append(('H4', 'read %s: %s has md5 %s, the queued one is %s -- never overwritten (a /tmp copy is '
                                      'often deliberately newer): re-queue with it, or restore by hand' % (name, live, got[:8], want[:8])))
                continue
            if os.path.exists(src) and md5(src) == want:
                stage.append((src, live))
                continue
        except Exception:
            pass
        out.append(('H4', 'read %s: %s is absent and %s does not have the queued md5 %s' % (name, live, src, want[:8])))
    return out, stage


def r10_check(P, e, v):
    """drawexposure.py for the head, against a temp registrations dir holding only its registration. '' = fine."""
    d = tempfile.mkdtemp(prefix='sched-r10-')
    try:
        shutil.copy(v['registration'], os.path.join(d, '%s.json' % e['run']))
        r = subprocess.run(['python3', P['drawexposure'], e['run'], '--registrations', d], capture_output=True, text=True,
                           timeout=900)
        txt = r.stdout + r.stderr
        with open(v['registration']) as f:
            declared = bool(json.load(f).get('draw_exposure'))
        # V3: declaration, exit status and output TOGETHER
        if not declared and r.returncode == 0 and 'declares no draw_exposure' in txt:
            return ''
        if declared and 'eligible on exposure:' in txt and 'REFUSED: the exposure read found' not in txt:
            if r.returncode == 0:
                return ''
            if r.returncode == 2:
                # fewer than two pools can expose it TODAY: wait here rather than park a loop in `draw` holding the
                # loop lock (which shuts installers out) for hours
                elig = next((l for l in txt.splitlines() if l.startswith('eligible on exposure:')), '')
                return 'WAIT fewer than two pools can expose it now (%s); re-checked every tick' % elig.strip()
        return 'drawexposure.py did not answer for a %s registration (exit %s): %s' % (
            'declared' if declared else 'undeclared', r.returncode, ' '.join(txt.split())[-240:])
    except Exception as x:
        return 'drawexposure.py could not run: %s' % x
    finally:
        shutil.rmtree(d, ignore_errors=True)


def death_hold(P, st, run):
    """R11: (run, why) when its closing decision was a death-driven REVERT and no `continue` followed, else None."""
    rows = run_rows(st['journal'], run)
    dts, pools = deployment(rows)
    d = ledger_row(st.get('ledger'), (st.get('reg_sha') or {}).get(run), pools, dts)
    how, _ = last_human(st, run, ('continue',))
    if how == 'continue':
        return None
    if not d:
        return (run, 'its decision cannot be found in the ledger (sha sources %s): holding (fail toward the hold)'
                % ((st.get('sha_sources') or {}).get(run) or 'none'))
    if str(d.get('decision')).upper() != 'REVERT':
        return None
    arts = []
    for p in glob.glob(os.path.join(P['reads_out'], '%s-verdict-*.json' % run)):
        try:
            with open(p) as f:
                a = json.load(f)
            if str(a.get('verdict')) == 'REVERT':
                arts.append(a)
        except Exception:
            pass
    if any(((a.get('extra') or {}).get('by') == 'death_gate') for a in arts):
        return (run, 'verdict artifact by=death_gate')
    if any('deaths' in (a.get('extra') or {}) for a in arts):
        return (run, 'verdict artifact counts deaths (the licensed change-row REVERT)')
    if DEATH_REVERT.search(str(d.get('note') or '')):
        return (run, 'the REVERT line is decided by a death')
    if not arts:
        return (run, 'no REVERT verdict artifact found: holding (fail toward the hold)')
    return None


def load_queue(P):
    try:
        fd = os.open(P['queue_lock'], os.O_RDWR | os.O_CREAT, 0o664)
    except Exception as x:
        return {'version': 1, 'entries': [], 'error': 'queue lock: %s' % x}
    try:
        fcntl.flock(fd, fcntl.LOCK_SH)
        with open(P['queue']) as f:
            return json.load(f)
    except FileNotFoundError:
        return {'version': 1, 'entries': []}
    except Exception as x:
        return {'version': 1, 'entries': [], 'error': str(x)}
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)


def gather(P, full=True, r10=None):
    t = now()
    st = {'now': t}
    try:
        with open(P['manifest']) as f:
            st['manifest'] = json.load(f)
    except Exception as x:
        st['manifest'] = None; st['manifest_error'] = x
    st['procs'], st['pid_alive'], st['canary_procs'], st['bot_procs'] = procs(P)
    st['loop_lock'] = loop_lock_holder(P)
    st['unitdir_ok'] = os.path.exists(os.path.join(P['unitdir'], 'mcbot@.service'))
    st['dropins'] = sorted(glob.glob(os.path.join(P['unitdir'], 'mcbot@*.service.d', '10-canary.conf')))
    st['journal'] = read_jsonl(P['journal'])
    st['ledger'] = read_jsonl(P['ledger']) if os.path.exists(P['ledger']) else None
    st['state_rows'] = read_jsonl(P['state'])
    st['humans'] = humans(st['state_rows'])
    runs = []
    for r in st['journal']:
        if r.get('run') and r.get('phase') not in IGNORED_PHASES and r['run'] not in runs:
            runs.append(r['run'])
    st['runs'] = runs
    regsha, st['sha_sources'] = {}, {}
    for run in runs:
        srcs = {}
        la = [r.get('canary_sha') for r in st['state_rows'] if r.get('run') == run and r.get('state') == 'launching'
              and r.get('canary_sha')]
        if la:
            srcs['scheduler launching row'] = str(la[-1])
        pr = [str(r.get('note') or '').split()[0] for r in run_rows(st['journal'], run)
              if r.get('phase') == 'promoted' and str(r.get('note') or '').split()]
        if pr:
            srcs['journal promoted note'] = pr[-1]
        try:
            with open(os.path.join(P['regdir'], '%s.json' % run)) as f:
                srcs['registration (now)'] = str(json.load(f).get('sha') or '')
        except Exception:
            pass
        srcs = {k: v for k, v in srcs.items() if v}
        st['sha_sources'][run] = srcs
        # RANKED. The scheduler's launching row and the journal's promoted note were written at deploy/decision time and
        # cannot be edited by re-registering; they decide when present and agreeing. A registration that disagrees with
        # them is paged as edited-after-deploy, not fatal. The registration decides alone only when neither exists
        # (operator launches, history). Immutable sources that disagree with EACH OTHER -> no sha; a human resolves it
        # with `closed <run> <why> --sha <one of the listed sources>` (its ledger row must exist).
        imm = [v for k, v in srcs.items() if k != 'registration (now)']
        hum = [r.get('sha') for r in st['state_rows'] if r.get('run') == run and r.get('state') == 'human'
               and r.get('how') == 'closed' and r.get('sha')]
        if hum:
            regsha[run] = hum[-1]
        elif imm:
            regsha[run] = imm[0] if all(sha_match(imm[0], x) for x in imm) else ''
            reg = srcs.get('registration (now)')
            if regsha[run] and reg and not sha_match(regsha[run], reg):
                st.setdefault('reg_edited', []).append((run, reg, regsha[run]))
        else:
            regsha[run] = srcs.get('registration (now)', '')
    st['reg_sha'] = regsha
    # the most recently CLOSED deployed run: its close time bounds S5's freshness; its decision drives R11
    last, last_t = None, None
    for run in runs:
        rows = run_rows(st['journal'], run)
        if deployment(rows)[0] is None or journal_status(run, st) != 'closed':
            continue
        ct = max((ts(r.get('ts')) for r in rows if r.get('phase') in CLOSED_PHASES and ts(r.get('ts'))), default=None)
        hw, hat = last_human(st, run, ('closed',))
        if hw == 'closed' and hat and (ct is None or hat > ct):
            ct = hat
        if ct and (last_t is None or ct > last_t):
            last, last_t = run, ct
    st['last_close'] = last_t
    last_rows = run_rows(st['journal'], last) if last else []
    last_rec = max((ts(r.get('ts')) for r in last_rows if r.get('phase') == 'recorded' and ts(r.get('ts'))), default=None)
    last_pools = deployment(last_rows)[1] or frozenset()
    st['death_hold'] = death_hold(P, st, last) if last else None
    # S5
    newest = telemetry(P)
    since = t - dt.timedelta(minutes=FRESH_MIN)
    if last_t and last_t > since:
        since = last_t
    st['fresh_since'] = iso(since)
    st['fresh_bots'] = sum(1 for w, _ in newest.values() if t - dt.timedelta(minutes=FRESH_MIN) <= w)
    units = unit_states(P)
    st['units'] = units
    st['active_builds'], st['stale_units'], st['transitional_units'], st['stopped_with_dropin'] = {}, [], [], []
    st['inactive_units'], st['silent_started_after'] = [], []
    if units is not None:
        dropin = lambda b: os.path.exists(os.path.join(P['unitdir'], 'mcbot@%s.service.d' % b, '10-canary.conf'))
        for b, (active, sub) in sorted(units.items()):
            if active == 'active':
                w, v = newest.get(b, (None, None))
                if w is not None and w >= since:
                    st['active_builds'][v] = st['active_builds'].get(v, 0) + 1
                    continue
                # SILENT. It passes only if it cannot be running canary code from memory: no drop-in, AND either its
                # process started after the last decision was RECORDED (written before the teardown/promotion
                # restarts begin), or it is outside that run's pools while no process runs from the canary tree.
                ent = unit_enter(P, b)
                if not dropin(b) and ((last_rec and ent and ent > last_rec) or
                                      (b.rsplit('-', 1)[0] not in last_pools and not st['canary_procs'])):
                    st['silent_started_after'].append(b)
                else:
                    st['stale_units'].append(b)
            elif active in ('activating', 'deactivating', 'reloading', 'refreshing'):
                st['transitional_units'].append('%s (%s)' % (b, active))
            else:
                st['inactive_units'].append(b)
                if dropin(b):
                    st['stopped_with_dropin'].append(b)
    try:
        if P['openloop_lib'] not in sys.path:
            sys.path.insert(0, P['openloop_lib'])
        from openloop import open_loop
        st['openloop'] = open_loop(st['manifest'], st['ledger'])
    except Exception as x:
        st['openloop'] = 'openloop check could not run: %s' % x
    st['pause'] = os.path.exists(P['pause'])
    st['install_hold'] = None
    if os.path.exists(P['install_hold']):
        try:
            with open(P['install_hold']) as f:
                st['install_hold'] = json.load(f)
        except Exception:
            st['install_hold'] = {'owner': '?', 'until': None}
    st['next_slot'] = os.path.exists(P['next_slot'])
    try:
        with open(P['drawrec']) as f:
            st['drawrec_k4'] = bool(re.search(r'(?m)^TARGET_K = [4-9]', f.read()))
    except Exception:
        st['drawrec_k4'] = False
    st['queue'] = load_queue(P)
    man = st['manifest'] if isinstance(st['manifest'], dict) else {}
    st['base_full'] = full_sha(P, man.get('declared_code_version'))
    st['stage'], st['variant_checks'], st['r10'] = [], [], ''
    e = head_entry(st)
    if full and e and st['base_full'] and st['base_full'] in (e.get('variants') or {}):
        v = e['variants'][st['base_full']]
        st['variant_checks'], st['stage'] = variant_checks(P, e, v, st['base_full'], st)
        busy, block = slot_blockers(st)
        if not busy and not block and not head_blockers(e, st) and entry_state(e, st) == 'ready':
            key = (e.get('run'), st['base_full'], v.get('registration_sha256'))
            if r10 is None or r10[0] != key:
                st['r10'] = r10_check(P, e, v)      # the expensive check, only when it is the last thing standing
                st['r10_ran'] = True
            else:
                st['r10'] = r10[1]
            st['r10_key'] = key
    return st


# ------------------------------------------------------------------------------------------------------ act --
def append_state(P, row):
    os.makedirs(os.path.dirname(P['state']), exist_ok=True)
    row = dict(row); row.setdefault('at', iso(now()))
    with open(P['state'], 'a') as f:
        f.write(json.dumps(row) + '\n')
        f.flush(); os.fsync(f.fileno())


def page(P, st, level, key, msg):
    """Deduplicated by key for PAGE_EVERY_H, so the operator's feed does not become wallpaper."""
    t = st['now']
    for r in reversed(st.get('state_rows') or []):
        if r.get('state') == 'paged' and r.get('key') == key:
            w = ts(r.get('at'))
            if w and (t - w).total_seconds() < PAGE_EVERY_H * 3600:
                return False
            break
    os.makedirs(os.path.dirname(P['page']), exist_ok=True)
    with open(P['page'], 'a') as f:
        f.write(json.dumps({'ts': iso(t), 'run': key.split('|')[0], 'level': level, 'msg': 'canary-sched: ' + msg}) + '\n')
    append_state(P, {'state': 'paged', 'key': key, 'msg': msg[:300]})
    st.setdefault('state_rows', []).append({'state': 'paged', 'key': key, 'at': iso(t)})
    return True


def atomic_copy(src, dst):
    tmp = '%s.sched-tmp-%d' % (dst, os.getpid())
    shutil.copyfile(src, tmp)                     # the copy is verified against the queued hash before any launch
    os.chmod(tmp, 0o644)
    os.replace(tmp, dst)


def launch(P, st, e, v):
    """L1-L3. `launching` is written BEFORE anything is touched (a crash before the Popen leaves an attempt with no pid:
    blocked on the next tick, recoverable by `rearm`). The pid IS the loop (no setsid binary), recorded with its
    /proc starttime so a reused pid can never pass for it."""
    run = e['run']
    t0 = iso(now())                 # whole seconds, like the journal: a same-second first line counts
    append_state(P, {'state': 'launching', 'run': run, 't0': t0, 'base': st['base_full'], 'canary_sha': v.get('canary_sha')})
    for src, dst in st.get('stage') or []:
        if not os.path.exists(dst):                     # never overwrite (R9), even if one appeared since gather
            atomic_copy(src, dst)
    dst = os.path.join(P['regdir'], '%s.json' % run)
    if not os.path.exists(dst):
        atomic_copy(v['registration'], dst)
    # LAST CHECK BEFORE THE POPEN: every read in /tmp and the staged registration are the queued bytes NOW (a copy
    # can race a writer; a read can appear between gather and here)
    bad = []
    for name, want in sorted((v.get('reads') or {}).items()):
        live = os.path.join(P['readdir'], '%s.py' % name)
        got = md5(live) if os.path.exists(live) else 'ABSENT'
        if got != want:
            bad.append('read %s is %s, queued %s' % (name, got[:8], want[:8]))
    if not os.path.exists(dst) or sha256(dst) != v.get('registration_sha256'):
        bad.append('staged registration %s is not the queued bytes' % dst)
    if bad:
        append_state(P, {'state': 'launched-pid', 'run': run, 'pid': None, 'start': None})
        append_state(P, {'state': 'blocked', 'run': run, 'why': 'pre-launch verify: ' + '; '.join(bad)})
        page(P, st, 'error', '%s|preverify|%s' % (run, t0), '%s NOT launched: %s -- fix, then `rearm %s <why>`'
             % (run, '; '.join(bad), run))
        return None
    with open(os.path.join(P['out'], 'canary-loop-%s.out' % run), 'a') as out:
        p = subprocess.Popen(['bash', P['loop'], run], stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                             cwd=P['home'], start_new_session=True)
    append_state(P, {'state': 'launched-pid', 'run': run, 'pid': p.pid, 'start': starttime(P, p.pid)})
    page(P, st, 'info', '%s|launch|%s' % (run, t0), 'launched %s (canary %s on base %s, pid %d)'
         % (run, str(v.get('canary_sha'))[:7], st['base_full'][:7], p.pid))
    return p.pid


def settle(P, st):
    """L4, each tick, for every entry with an open attempt: page the outcome once (the state itself is derived)."""
    for e in (st.get('queue') or {}).get('entries') or []:
        run = e.get('run')
        att = attempts(st, run)
        if not att:
            continue
        a = att[-1]
        key = '%s|attempt|%s' % (run, iso(a['t0']) if a['t0'] else '?')
        es = entry_state(e, st)
        rows = attempt_rows(st, run, a)
        if es == 'blocked':
            first = rows[0].get('phase') if rows else None
            why = ('refused at launch: %s %s' % (first, str(rows[0].get('note'))[:160])) if first and \
                first.startswith(REFUSAL_PREFIXES) else ('its loop ended at phase %s without closing' % rows[-1].get('phase')
                                                         if rows else 'the loop exited with no journal line (lock held? see '
                                                         '%s)' % os.path.join(P['out'], 'canary-loop-%s.out' % run))
            page(P, st, 'error', key + '|blocked', '%s BLOCKED: %s -- not relaunched; fix it, then `rearm %s <why>` or '
                 '`cancel %s <why>` (journal status %s)' % (run, why, run, run, journal_status(run, st)))
        elif es == 'launching' and a['t0'] and (st['now'] - a['t0']).total_seconds() > LAUNCH_PAGE_MIN * 60:
            page(P, st, 'flag', key + '|slow', '%s: loop pid %s alive %d min with no journal line yet'
                 % (run, a['pid'], (st['now'] - a['t0']).total_seconds() // 60))
        rr = run_rows(st['journal'], run)
        if journal_status(run, st) == 'closed' and rr and rr[-1].get('phase') not in CLOSED_PHASES + ('recorded',):
            page(P, st, 'flag', '%s|lateline' % run, '%s is closed but journalled %s after its close (a relaunch?): it '
                 'does not reopen the run' % (run, rr[-1].get('phase')))


def watch(P, st):
    """W, through closure, for the run the scheduler launched last: draw stall (from the FIRST draw line of the attempt),
    read md5 drift, and canarywatch's unread marker (matched by the run's canary sha, which is what the marker holds)."""
    att_rows = [r for r in st.get('state_rows') or [] if r.get('state') == 'launching' and r.get('t0')]
    if not att_rows:
        return
    run = att_rows[-1]['run']
    t0 = ts(att_rows[-1]['t0'])
    if journal_status(run, st) == 'closed':
        return
    rows = [r for r in run_rows(st['journal'], run) if (ts(r.get('ts')) or t0) >= t0]
    draws = [r for r in rows if r.get('phase') in ('draw', 'draw-short')]
    if rows and rows[-1].get('phase') in ('draw', 'draw-short') and draws:
        h = (st['now'] - ts(draws[0]['ts'])).total_seconds() / 3600
        if h > STALL_H:
            page(P, st, 'flag', '%s|drawstall' % run, '%s has waited %.1f h for its draw (last: %s). The scheduler never '
                 'swaps: to move on, stop the loop by PID (the entry becomes blocked), then `rearm` after reordering or '
                 '`cancel`' % (run, h, str(rows[-1].get('note'))[:140]))
    e = next((x for x in (st.get('queue') or {}).get('entries') or [] if x.get('run') == run), None)
    v = ((e or {}).get('variants') or {}).get(att_rows[-1].get('base') or '', {})
    for name, want in (v.get('reads') or {}).items():
        p = os.path.join(P['readdir'], '%s.py' % name)
        try:
            got = md5(p) if os.path.exists(p) else 'ABSENT'
        except Exception:
            got = 'UNREADABLE'
        if got != want:
            page(P, st, 'error', '%s|readdrift|%s|%s' % (run, name, got[:8]), '%s: read %s is now %s (queued %s) while '
                 'the canary is open -- restore it, or the read refuses' % (run, p, got[:8], want[:8]))
    cs = str(v.get('canary_sha') or '')[:7]
    try:
        if cs and os.path.exists(P['unread']):
            with open(P['unread']) as f:
                txt = f.read()
            if cs in txt:
                page(P, st, 'error', '%s|unread' % run, '%s: canarywatch reports its canary UNREAD (%s). Restore the reads '
                     'and relaunch the loop, or tear it down by hand (three steps) and `closed %s <why>`'
                     % (run, ' '.join(txt.split())[:160], run))
    except Exception:
        pass


def tick(P, no_act=False):
    fd = os.open(P['tick_lock'], os.O_RDWR | os.O_CREAT, 0o664)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        print('%s another tick (or an install-hold) holds the scheduler lock' % iso(now())); return 0
    try:
        return _tick(P, no_act)
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)


def _tick(P, no_act):
    st = gather(P, full=True)
    stamp = iso(st['now'])
    if st['queue'].get('error'):
        print('%s QUEUE UNREADABLE: %s' % (stamp, st['queue']['error']))
        if not no_act:
            page(P, st, 'error', 'queue|unreadable', 'the queue file does not parse: %s' % st['queue']['error'])
        return 2
    d = decide(st)
    if d[0] == 'launch' and st.get('r10_ran') and not no_act:
        # R10 ran drawexposure (up to 15 min): re-gather everything cheap and decide again with its answer carried over
        r10 = (st['r10_key'], st['r10'])        # bound to (run, base, registration sha256): another variant re-checks
        st = gather(P, full=True, r10=r10)
        d = decide(st)
        if d[0] != 'launch':
            print('%s RE-CHECK after the exposure check changed the decision: %s' % (stamp, d[0]))
        elif st.get('r10_ran'):
            # the identity changed during the check, so R10 ran AGAIN on the re-gather and nothing has re-checked the
            # fleet since that second check: never launch on it -- the next tick starts over (Codex IMPL-3)
            print('%s RE-CHECK: the head/base changed during the exposure check; deferring to the next tick' % stamp)
            return 0
    if d[0] == 'launch':
        e, v = d[1], d[2]
        print('%s LAUNCH %s (variant on %s, canary %s)%s' % (stamp, e['run'], st['base_full'][:7],
                                                            str(v.get('canary_sha'))[:7], ' -- NO-ACT' if no_act else ''))
        if not no_act:
            launch(P, st, e, v)
        return 0
    print('%s %s: %s' % (stamp, d[0].upper(), ' | '.join('%s %s' % (c, r) for c, r in d[1])))
    if st.get('inactive_units'):
        print('%s note: enabled but inactive units (no drop-in, so they start on baseline): %s'
              % (stamp, ', '.join(st['inactive_units'])))
    if no_act:
        return 0
    settle(P, st)
    for run, reg, sha in st.get('reg_edited') or []:
        page(P, st, 'flag', '%s|regedited' % run, '%s: registrations/%s.json now names %s but it deployed %s (launch row / '
             'promoted note): the registration was edited after the deploy; closure uses the deployed sha'
             % (run, run, reg, sha))
    if d[0] == 'wait' and any(c == 'R10' for c, _ in d[1]):
        # W4: an exposure wait pages like a draw stall -- at STALL_H and every STALL_H -- naming the head, so a head that
        # can never expose does not stall the queue silently
        run = d[1][0][1].split(':')[0]
        seen = [r for r in st.get('state_rows') or [] if r.get('run') == run and r.get('state') in ('r10wait', 'launching')]
        if not seen or seen[-1].get('state') != 'r10wait':
            append_state(P, {'state': 'r10wait', 'run': run})
        else:
            h = (st['now'] - (ts(seen[-1].get('at')) or st['now'])).total_seconds() / 3600
            if h > STALL_H:
                page(P, st, 'flag', '%s|r10wait' % run, '%s has waited %.1f h because fewer than two pools can expose it '
                     '(%s). The scheduler never skips the head: `queue hold`/reorder, or edit its draw_exposure'
                     % (run, h, d[1][0][1][:200]))
    if d[0] == 'block' and head_entry(st) is not None:     # an empty queue blocks nothing: print, do not page
        c, r = d[1][0]
        page(P, st, 'error', 'block|%s|%s' % (c, r[:60]), 'BLOCKED %s %s' % (c, r))
    watch(P, st)
    return 0


# ------------------------------------------------------------------------------------------------------ queue --
def with_queue(P, fn):
    fd = os.open(P['queue_lock'], os.O_RDWR | os.O_CREAT, 0o664)
    fcntl.flock(fd, fcntl.LOCK_EX)
    try:
        try:
            with open(P['queue']) as f:
                q = json.load(f)
        except FileNotFoundError:
            q = {'version': 1, 'entries': []}
        res = fn(q)
        tmp = P['queue'] + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(q, f, indent=1)
        os.replace(tmp, P['queue'])
        return res
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)


def validate_entry(P, e, journal):
    """`queue add` refusals (empty list = valid). Fills computed hashes in place."""
    bad = []
    run = e.get('run') or ''
    if not re.match(r'^[a-z0-9][a-z0-9._-]*$', run):
        bad.append('run id %r is not a plain id' % run)
    if deployment(run_rows(journal, run))[0] is not None:
        bad.append('the journal shows %s already DEPLOYED: a run id is one deployment' % run)
    if (e.get('class') or '') not in ('', 'bag-fix', 'underground-safety'):
        bad.append('class %r unknown' % e.get('class'))
    if not e.get('variants'):
        bad.append('no variants')
    for k, v in (e.get('variants') or {}).items():
        if not HEX40.match(k):
            bad.append('variant key %r is not a full 40-hex sha (chain-after matched prefixes and the last match won)' % k)
            continue
        if not v.get('approved'):
            bad.append('variant %s carries no `approved` (who reviewed it, where recorded)' % k[:7])
        reg = v.get('registration')
        try:
            with open(reg) as f:
                r = json.load(f)
        except Exception as x:
            bad.append('variant %s: registration unreadable: %s' % (k[:7], x)); continue
        h = sha256(reg)
        if v.get('registration_sha256') and v['registration_sha256'] != h:
            bad.append('variant %s: registration sha256 differs from the one given' % k[:7])
        v['registration_sha256'] = h
        if (r.get('class') or '') != (e.get('class') or ''):
            bad.append('variant %s: registration class %r != queued class %r' % (k[:7], r.get('class') or '', e.get('class') or ''))
        cs = full_sha(P, r.get('sha'))
        if not cs:
            bad.append('variant %s: registration sha %r does not resolve' % (k[:7], r.get('sha')))
        elif v.get('canary_sha') and v['canary_sha'] != cs:
            bad.append('variant %s: canary_sha given %s, registration says %s' % (k[:7], v['canary_sha'][:7], cs[:7]))
        else:
            v['canary_sha'] = cs
            if git(P, 'merge-base', '--is-ancestor', k, cs)[0] != 0:
                bad.append('variant %s: canary %s does not descend from its base' % (k[:7], cs[:7]))
        reads = v.get('reads') or {}
        src = v.get('reads_src') or os.path.join(P['home'], 'mcai-analysis')
        v['reads_src'] = src
        for name in r.get('reads') or []:
            p = os.path.join(src, '%s.py' % name)
            if not os.path.exists(p):
                bad.append('variant %s: read %s missing from %s' % (k[:7], name, src)); continue
            m = md5(p)
            if reads.get(name) and reads[name] != m:
                bad.append('variant %s: read %s md5 %s != given %s' % (k[:7], name, m[:8], reads[name][:8]))
            reads[name] = m
        extra = set(reads) - set(r.get('reads') or [])
        if extra:
            bad.append('variant %s: reads %s are not in the registration' % (k[:7], sorted(extra)))
        v['reads'] = reads
    return bad


def _cmd_queue(P, args):
    sub = args[0] if args else ''
    if sub == 'add' and len(args) == 2:
        with open(args[1]) as f:
            e = json.load(f)
        bad = validate_entry(P, e, read_jsonl(P['journal']))
        if bad:
            print('REFUSED:\n  ' + '\n  '.join(bad)); return 2

        def add(q):
            if any(x.get('run') == e['run'] for x in q['entries']):
                raise SystemExit('REFUSED: %s is already queued' % e['run'])
            q['entries'].append(e)
            return len(q['entries'])
        print('queued %s at position %d' % (e['run'], with_queue(P, add))); return 0
    if sub == 'replace-variant' and len(args) == 3:
        run = args[1]
        with open(args[2]) as f:
            e2 = json.load(f)
        st = gather(P, full=False)
        if deployment(run_rows(st['journal'], run))[0] is not None:
            print('REFUSED: %s has deployed; a deployed run is never re-registered' % run); return 2
        if journal_status(run, st) == 'live':
            print('REFUSED: a loop for %s is running' % run); return 2
        e2['run'] = run
        bad = validate_entry(P, e2, st['journal'])
        if bad:
            print('REFUSED:\n  ' + '\n  '.join(bad)); return 2

        def rep(q):
            hit = [x for x in q['entries'] if x.get('run') == run]
            if not hit:
                raise SystemExit('REFUSED: %s is not queued' % run)
            hit[0]['variants'] = e2['variants']; hit[0]['class'] = e2.get('class', '')
        with_queue(P, rep)
        dst = os.path.join(P['regdir'], '%s.json' % run)
        if os.path.exists(dst):
            os.replace(dst, '%s.replaced-%s' % (dst, iso(now())))   # never deployed: moved aside, kept for the record
        print('replaced the variants of %s (a staged registration was moved aside)' % run); return 0
    if sub in ('hold', 'release', 'not-before') and len(args) >= 2:
        run = args[1]

        def edit(q):
            hit = [x for x in q['entries'] if x.get('run') == run]
            if not hit:
                raise SystemExit('REFUSED: %s is not queued' % run)
            if sub == 'hold':
                hit[0]['hold'] = ' '.join(args[2:]) or 'held'
            elif sub == 'release':
                hit[0]['hold'] = None
            else:
                if len(args) < 3 or not ts(args[2]):
                    raise SystemExit('REFUSED: not-before needs an ISO time')
                hit[0]['not_before'] = args[2]
        with_queue(P, edit); print('%s %s' % (sub, run)); return 0
    print(__doc__); return 2


def fleet_shows_canary(st, run):
    """Why a human verb that frees the slot must refuse now ('' = it may proceed)."""
    man = st.get('manifest') or {}
    why = []
    if not isinstance(man, dict) or man.get('canary_pool') or man.get('canary_code_version'):
        why.append('the manifest still declares a canary (%r)' % (man.get('canary_pool') if isinstance(man, dict) else man))
    if st.get('dropins'):
        why.append('%d canary drop-in(s) remain' % len(st['dropins']))
    if journal_status(run, st) == 'live':
        why.append('a loop for %s is alive' % run)
    if st.get('canary_procs'):
        why.append('%d process(es) still run from the canary tree' % len(st['canary_procs']))
    return '; '.join(why)


def ledger_recipe(P, st, run):
    rows = run_rows(st['journal'], run)
    dts, pools = deployment(rows)
    sha = (st.get('reg_sha') or {}).get(run)
    if not sha:
        return ('no recipe: the canary sha of %s cannot be established -- its sources disagree or are missing: %s. '
                'Establish the deployed sha by hand (the deploy log ~/digest/deploy-%s.log) before writing any ledger row.'
                % (run, (st.get('sha_sources') or {}).get(run) or 'none', run))
    row = {'canary_sha': sha[:7], 'canary_pool': ','.join(sorted(pools or [])), 'decision': '<KEEP|REVERT|INCONCLUSIVE>',
           'note': '%s: <the verdict line> (recorded by hand)' % run, 'ts': iso(now())}
    return ('the ledger has no decision for %s (sha %s, pools %s, deployed %s). Append it, then retry:\n'
            "  python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])))' '%s' > /tmp/row.json && "
            "sudo sh -c 'cat /tmp/row.json >> %s'\n"
            '(check-open-loop.py --record cannot write it once the manifest is cleared -- a pre-existing gap)'
            % (run, sha[:7], ','.join(sorted(pools or [])), iso(dts) if dts else '?', json.dumps(row), P['ledger']))


def _cmd_human(P, how, args):
    sha_arg = None
    if '--sha' in args:
        i = args.index('--sha')
        sha_arg = args[i + 1] if i + 1 < len(args) else ''
        args = args[:i] + args[i + 2:]
        if how != 'closed':
            print('REFUSED: --sha is only for `closed`'); return 2
    if len(args) < 2:
        print('usage: %s <run> <why>' % how); return 2
    run, why = args[0], ' '.join(args[1:])
    st = gather(P, full=False)
    if sha_arg is not None:
        srcs = (st.get('sha_sources') or {}).get(run) or {}
        if not any(sha_match(sha_arg, v) for v in srcs.values()):
            print('REFUSED: --sha %s is none of the recorded sources for %s: %s' % (sha_arg, run, srcs)); return 2
        st['reg_sha'][run] = sha_arg
    rows = run_rows(st['journal'], run)
    deployed = deployment(rows)[0] is not None
    if how == 'rearm':
        if deployed:
            print('REFUSED: %s DEPLOYED; rearm is only for a run that never deployed. Close it by hand, `closed %s`, and '
                  'queue a new run id.' % (run, run)); return 2
        if journal_status(run, st) == 'open':
            print('REFUSED: %s drew and is not resolved; `abandon %s <why>` first (it checks the fleet)' % (run, run)); return 2
        if journal_status(run, st) == 'live':
            print('REFUSED: a loop for %s is running' % run); return 2
    if how == 'closed':
        # a COMPLETED experiment: only with its decision in the ledger (V1) -- a failed ledger write cannot be waived
        if not deployed:
            print('REFUSED: %s never deployed, so there is no experiment to close; use `abandon %s <why>`' % (run, run)); return 2
        f = fleet_shows_canary(st, run)
        if f:
            print('REFUSED: finish the three-step teardown first: %s' % f); return 2
        dts, pools = deployment(rows)
        if ledger_row(st.get('ledger'), (st.get('reg_sha') or {}).get(run), pools, dts) is None:
            print('REFUSED: ' + ledger_recipe(P, st, run)); return 2
    if how == 'abandon':
        if deployed:
            print('REFUSED: %s DEPLOYED -- an experiment that ran is closed with its decision (`closed`), never abandoned'
                  % run); return 2
        f = fleet_shows_canary(st, run)
        if f:
            print('REFUSED: the fleet is not clean: %s' % f); return 2
        # a deploy outlives a killed loop (fleet-deploy -> nohup sudo /root/d.sh &): no deploy-class process, and
        # ABANDON_AFTER_DRAWN_MIN past the `drawn` line (fleet-deploy polls up to 120 x 10 s)
        dep = [p['desc'] for p in st.get('procs') or [] if p['name'] in ('fleet-deploy', '/root/d.sh', 'deploy-fleet.sh',
                                                                            'mcai-canary-tree')]
        if dep:
            print('REFUSED: a deploy is still running: %s' % '; '.join(dep)); return 2
        drawn = [ts(r.get('ts')) for r in rows if r.get('phase') == 'drawn' and ts(r.get('ts'))]
        if drawn and (st['now'] - max(drawn)).total_seconds() < ABANDON_AFTER_DRAWN_MIN * 60:
            print('REFUSED: %s drew at %s; wait until %d min after it (an orphaned deploy can still land)'
                  % (run, iso(max(drawn)), ABANDON_AFTER_DRAWN_MIN)); return 2
    row = {'state': 'human', 'run': run, 'how': how, 'why': why, 'by': os.environ.get('USER', '?')}
    if how == 'closed':
        row['sha'] = (st.get('reg_sha') or {}).get(run)           # the sha its ledger row was matched on
    append_state(P, row)
    print('%s %s: %s' % (how, run, why)); return 0


def with_tick_lock(P, fn, *a):
    """Queue edits and human verbs take the scheduler lock, so a tick can never act on a decision made before them."""
    fd = os.open(P['tick_lock'], os.O_RDWR | os.O_CREAT, 0o664)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print('waiting for a tick in progress (it may be running the exposure check, up to 15 min)...', flush=True)
            fcntl.flock(fd, fcntl.LOCK_EX)
        return fn(P, *a)
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)


def cmd_queue(P, args):
    return with_tick_lock(P, _cmd_queue, args)


def cmd_human(P, how, args):
    return with_tick_lock(P, _cmd_human, how, args)


def cmd_install_hold(P, args):
    fd = os.open(P['tick_lock'], os.O_RDWR | os.O_CREAT, 0o664)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('waiting for a tick in progress (it may be running the exposure check, up to 15 min)...', flush=True)
        fcntl.flock(fd, fcntl.LOCK_EX)        # waits for a tick in progress to finish its launch
    try:
        if args[:1] == ['release']:
            if os.path.exists(P['install_hold']):
                os.remove(P['install_hold'])
            print('install hold released'); return 0
        if len(args) != 2:
            print('usage: install-hold <owner> <minutes>'); return 2
        owner, minutes = args[0], int(args[1])
        until = iso(now() + dt.timedelta(minutes=minutes))
        tmp = P['install_hold'] + '.tmp'
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        with open(tmp, 'w') as f:
            json.dump({'owner': owner, 'until': until, 'at': iso(now())}, f)
        os.replace(tmp, P['install_hold'])
        st = gather(P, full=False)
        # the installer that called us (and its shell ancestors) is not "another" slot owner
        anc = ancestors(P, os.getpid())
        st['procs'] = [x for x in st['procs'] if x['pid'] not in anc]
        busy, block = slot_blockers(st)
        live = [x for x in busy + block if x[0] in ('S1', 'S2', 'S3', 'S4', 'S5', 'S7')]
        if live:
            print('INSTALL-HOLD written (no NEW launch while it exists), but the slot is NOT free -- do not install:')
            for c, r in live:
                print('  %s %s' % (c, r))
            return 2
        print('INSTALL-HOLD by %s until %s; the slot is free now. Acquire /tmp/mcai-canary.lock (flock -n) before '
              'touching any file, and `install-release` when done.' % (owner, until))
        return 0
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)


def cmd_status(P):
    st = gather(P, full=True)
    for e in (st.get('queue') or {}).get('entries') or []:
        print('%-20s %-10s %-18s hold=%s not_before=%s after=%s variants=%s' % (
            e.get('run'), entry_state(e, st), e.get('class') or '-', e.get('hold'), e.get('not_before'), e.get('after'),
            ','.join(k[:7] for k in e.get('variants') or {})))
    d = decide(st)
    print('DECISION: %s %s' % (d[0], d[1].get('run') if d[0] == 'launch' else ' | '.join('%s %s' % x for x in d[1])))
    return 0


def main(argv):
    P = paths()
    cmd = argv[0] if argv else ''
    if cmd == 'tick':
        return tick(P, no_act='--no-act' in argv)
    if cmd == 'status':
        return cmd_status(P)
    if cmd == 'queue':
        return cmd_queue(P, argv[1:])
    if cmd in ('rearm', 'closed', 'cancel', 'continue', 'abandon'):
        return cmd_human(P, cmd, argv[1:])
    if cmd == 'install-hold':
        return cmd_install_hold(P, argv[1:])
    if cmd == 'install-release':
        return cmd_install_hold(P, ['release'])
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
