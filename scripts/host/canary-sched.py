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
    canary-sched.py queue set-patch <run> <src_base> [<branch>]
                                                  declare the entry's change (AUTOREBASE source): the variant keyed on
                                                  <src_base>, its commits src_base..canary_sha, and their normalized diff
    canary-sched.py queue add-variant <run> <base> <registration> <approved...>
                                                  add ONE variant (validated as `queue add` validates it)
    canary-sched.py autorebase-clear <run> <why>  forget the head's refused/dead autorebase job: the next tick may build again
    canary-sched.py autorebase-build <run> <base> <tip>   (internal: the background build a tick starts)

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

AUTOREBASE (v39, 11-01). The queue used to need a variant pre-built for every fleet tip the entries ahead of it could
produce (fleetbuild-01 had 32). Now an entry may declare a PATCH SOURCE (`queue set-patch`): one of its variants, a linear
range src_base..tip, and the sha256 of its normalized diff. When the head has no variant for the live fleet base, the tick
starts ONE background build (`autorebase-build`, never more than one per (run, base, tip), never a retry) and waits (H2):
cherry-pick the range onto the base in a scratch worktree (~/autorebase), then ALL of: (a) no conflict, (b) the normalized
diff base..new is byte-identical to the reviewed one (index lines and hunk line numbers are the only things normalized
away), (c) `npm ci`, eslint (`npm run lint`), the movement-writer lint no worse than on the base, `npm test` in full,
(d) protected.py's tier unchanged. Only then: branch autorebase/<run>-on-<base8>, pushed (this host has no push
credential: a request file the Mac relay pushes, confirmed here by `git ls-remote`), fetched into the deploy repo,
registered (a copy of the source variant's registration), and added by `queue add-variant`; the NEXT tick launches it
normally (H3/H4 and every slot check still apply). Any failure pages the exact reason and leaves the head BLOCKED (never
skipped, never retried) until a human builds the variant or runs `autorebase-clear`. Every step is a sched-state row.

FUN MODE (v37, OWNER 2026-10-28, W4). A registration that does not say `"lab": true` is an ORDINARY run: R10
(drawexposure), H5 (NEXT-SLOT) and H6 (bag-fix 4-pool draw) are lab-only and do not apply to it. For a fun-mode run R11
EXPIRES 2 h after the run closed unless one of its deaths was CHANGE-LINKED (a rung-linked / change-row death, or an
artifact with extra.linked > 0 or verdict.py's licensed change-row `deaths`); a lab run keeps the hold; `continue` still
releases either at once. `approved` names the reviewer (any non-empty name); a canary
whose diff touches config/protected-paths.txt (decided by the BASE's scripts/lib/protected.py; undecidable = protected)
must name both engines (Claude and Codex).
"""
import os, sys, json, re, glob, hashlib, subprocess, fcntl, tempfile, shutil, time, datetime as dt

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
R11_EXPIRE_H = 2.0      # v37: an R11 hold whose deaths were not change-linked releases itself this long after the close
CHANGE_LINKED = re.compile(r'rung-linked death|linked death|death-linked|change row inside a death window', re.I)
HEX40 = re.compile(r'^[0-9a-f]{40}$')
AR_STALE_MIN = 20       # an autorebase job whose heartbeat (every 30 s) is older than this died
AR_PUSH_WAIT_MIN = 45   # the relay pushes within minutes; past this the job refuses (is the Mac relay running?)
AR_TEST_TIMEOUT_S = 45 * 60
AR_MAX_RERUN = 6         # full-run failures re-run alone (host-load flakes); more than this refuses outright
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
        'ar_home': g('SCHED_AR_HOME', os.path.join(H, 'autorebase')),
        'ar_origin': g('SCHED_AR_ORIGIN', 'https://github.com/dmille6/minecraft-ai-test.git'),
        'ar_push': g('SCHED_AR_PUSH', 'relay'),          # relay: a request file the Mac pushes | direct: git push (tests)
        'ar_sudo': g('SCHED_AR_SUDO', '1'),              # the deploy repo is root-owned: fetch into it with sudo -n
        'ar_npm': g('SCHED_AR_NPM', 'npm'),
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


def reg_is_lab(st, e):
    """v37: the head's registration (its variant for the fleet base) says `"lab": true`. Unreadable = lab (fail closed)."""
    v = (e.get('variants') or {}).get(st.get('base_full') or '') or {}
    try:
        with open(v['registration']) as f:
            return json.load(f).get('lab') is True
    except Exception:
        return True


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
        why, waiting, _ = ar_view(e, st)
        out.append(('H2', 'no variant for the fleet base %s (have: %s): %s'
                    % (base[:7], ', '.join(k[:7] for k in vs) or 'none', why), waiting))
    else:
        for code, why in (st.get('variant_checks') or []):
            out.append((code, why, False))
    lab = reg_is_lab(st, e)
    if lab and st.get('next_slot') and e.get('class') != 'underground-safety':
        out.append(('H5', 'NEXT-SLOT reserved for an underground-safety fix; head is class %r' % (e.get('class') or ''),
                    False))
    if lab and e.get('class') == 'bag-fix' and not st.get('drawrec_k4'):
        out.append(('H6', 'bag fix needs drawrec.sh TARGET_K >= 4', False))
    return out


# ------------------------------------------------------------------------------------------- autorebase (pure) --
def patch_problem(pt):
    """'' when a patch source has the shape `queue set-patch` writes, else why not."""
    if not isinstance(pt, dict):
        return 'patch is not an object'
    for k in ('base', 'tip'):
        if not HEX40.match(str(pt.get(k) or '')):
            return 'patch %s %r is not a full sha' % (k, pt.get(k))
    if not re.match(r'^[0-9a-f]{64}$', str(pt.get('diff_sha256') or '')):
        return 'patch has no diff_sha256'
    return ''


def ar_view(e, st):
    """PURE. The head has no variant for the fleet base: (why, waiting, start_a_build)."""
    pt = e.get('patch')
    if not pt:
        return ('no patch source, so no autorebase: build the variant by hand, or `queue set-patch %s <src_base>`'
                % e.get('run'), False, False)
    bad = patch_problem(pt)
    if bad:
        return ('autorebase cannot run: %s' % bad, False, False)
    job = st.get('ar_job')
    rng = '%s..%s' % (pt['base'][:8], pt['tip'][:8])
    if job is None:
        return ('autorebase will cherry-pick %s onto it (one background build, then a later tick launches)' % rng,
                True, True)
    s = job.get('state')
    clear = '`canary-sched.py autorebase-clear %s <why>` to build again' % e.get('run')
    if s == 'refused':
        return ('autorebase REFUSED at step %s: %s -- the head stays blocked: build the variant by hand (`queue '
                'add-variant`), or fix the cause and %s' % (job.get('step'), str(job.get('why'))[:400], clear), False, False)
    if s in ('starting', 'running'):
        hb = ts(job.get('hb') or job.get('at'))
        if hb is None or (st['now'] - hb).total_seconds() > AR_STALE_MIN * 60:
            return ('the autorebase job (pid %s) went silent at step %s (heartbeat %s): it died; %s'
                    % (job.get('pid'), job.get('step'), job.get('hb') or job.get('at'), clear), False, False)
        return ('autorebase of %s is building (step %s, pid %s, heartbeat %s)' % (rng, job.get('step'), job.get('pid'),
                                                                               job.get('hb')), True, False)
    if s == 'done':
        return ('autorebase built %s but the queue has no variant for this base (removed by hand?); %s'
                % (str(job.get('variant'))[:8], clear), False, False)
    return ('autorebase job state %r is unknown; %s' % (s, clear), False, False)


def ar_should_start(st):
    """PURE. Start the head's autorebase build now? Only when the fleet base is settled (no canary declared, no drop-in,
    no loop/chain/deploy/install process, no pause or install-hold) and the missing variant is the ONLY thing between
    the head and a launch."""
    e = head_entry(st)
    base = st.get('base_full')
    if e is None or not base or base in (e.get('variants') or {}) or entry_state(e, st) != 'ready':
        return False
    man = st.get('manifest')
    if not isinstance(man, dict) or man.get('canary_pool') or man.get('canary_code_version'):
        return False
    if st.get('procs') or st.get('dropins') or st.get('pause') or st.get('install_hold') is not None or st.get('death_hold'):
        return False
    if [b for b in head_blockers(e, st) if b[0] != 'H2']:
        return False
    return ar_view(e, st)[2]


def norm_diff(text):
    """PURE. A diff with the two things a rebase changes without changing the change removed: `index` lines (blob
    ids) and hunk-header line numbers (and the function-context text git appends to them). Everything else -- file
    headers, modes, every context, added and removed line, binary literals -- must be byte-identical."""
    out = []
    for l in text.split('\n'):
        if l.startswith('index '):
            continue
        if l.startswith('@@ ') and re.match(r'^@@ -\d+(,\d+)? \+\d+(,\d+)? @@', l):
            out.append('@@')
            continue
        out.append(l)
    return '\n'.join(out)


def movement_fails(out):
    """PURE. The file list after `FAIL:` in check-movement-writers output (empty set = no FAIL block)."""
    got, on = set(), False
    for l in out.splitlines():
        if l.startswith('FAIL:'):
            on = True
            continue
        if on:
            if not l.strip():
                break
            got.add(l.strip())
    return got


def tier_label(rc, out):
    """PURE. protected.py's answer as one word: none | 3 | tooling | undecidable."""
    if rc == 0:
        return 'none'
    if rc == 1:
        last = (out.strip().splitlines() or [''])[-1].strip()
        return {'tier=3': '3', 'tier=tooling': 'tooling'}.get(last, '3')
    return 'undecidable'


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
    """drawexposure.py for the head, against a temp registrations dir holding only its registration. '' = fine.
    v37: lab-only. A fun-mode registration (no `"lab": true`) is not exposure-checked; an unreadable one is (fail closed)."""
    try:
        with open(v['registration']) as f:
            if json.load(f).get('lab') is not True:
                return ''
    except Exception:
        pass
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


def r11_expired(linked, closed_at, t):
    """PURE (v37). An R11 hold releases itself R11_EXPIRE_H after the close unless a death was change-linked."""
    return (not linked) and closed_at is not None and (t - closed_at).total_seconds() >= R11_EXPIRE_H * 3600


def death_hold(P, st, run, closed_at=None):
    """R11: (run, why) when its closing decision was a death-driven REVERT and no `continue` followed, else None.
    v37: such a hold EXPIRES (st['r11_expired'] records it) R11_EXPIRE_H after `closed_at` unless a death was
    change-linked. A decision missing from the ledger never expires: whether a death was linked cannot be known."""
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
    hold = _death_reason(P, run, d)
    if hold is None:
        return None
    linked = hold[2]
    # LAB runs keep the old hold: only `continue` releases it (review r1, Codex). An unreadable registration counts as lab.
    try:
        with open(os.path.join(P['regdir'], '%s.json' % run)) as f:
            lab = json.load(f).get('lab') is True
    except Exception:
        lab = True
    if not lab and r11_expired(linked, closed_at, st['now']):
        st['r11_expired'] = (run, hold[1], iso(closed_at))
        return None
    return (run, hold[1] + ('; a death was CHANGE-LINKED: no 2-h expiry' if linked else '; lab run: no 2-h expiry' if lab else
                            '; expires %s (2 h after the close) unless `continue` first'
                            % (iso(closed_at + dt.timedelta(hours=R11_EXPIRE_H)) if closed_at else '?')))


def _death_reason(P, run, d):
    """(run, why, change_linked) when a REVERT decision was death-driven (or cannot be shown not to be), else None."""
    linked = bool(CHANGE_LINKED.search(str(d.get('note') or '')))
    arts = []
    for p in glob.glob(os.path.join(P['reads_out'], '%s-verdict-*.json' % run)):
        try:
            with open(p) as f:
                a = json.load(f)
            if str(a.get('verdict')) == 'REVERT':
                arts.append(a)
        except Exception:
            pass
    linked = linked or any(int((a.get('extra') or {}).get('linked') or 0) > 0 for a in arts
                           if isinstance((a.get('extra') or {}).get('linked'), (int, float)))
    # verdict.py's licensed change-row REVERT ({'deaths': n} without by=death_gate) IS a change-linked death (review r1)
    linked = linked or any('deaths' in (a.get('extra') or {}) and (a.get('extra') or {}).get('by') != 'death_gate'
                           for a in arts)
    if any(((a.get('extra') or {}).get('by') == 'death_gate') for a in arts):
        return (run, 'verdict artifact by=death_gate', linked)
    if any('deaths' in (a.get('extra') or {}) for a in arts):
        return (run, 'verdict artifact counts deaths (the licensed change-row REVERT)', linked)
    if DEATH_REVERT.search(str(d.get('note') or '')):
        return (run, 'the REVERT line is decided by a death', linked)
    if not arts:
        return (run, 'no REVERT verdict artifact found: holding (fail toward the hold)', linked)
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
    st['death_hold'] = death_hold(P, st, last, last_t) if last else None
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
    st['ar_job'] = None
    if e and st['base_full'] and st['base_full'] not in (e.get('variants') or {}) and not patch_problem(e.get('patch')):
        st['ar_job'] = ar_read_job(ar_job_path(P, e['run'], st['base_full'], e['patch']['tip']))
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
    if d[0] != 'launch' and ar_should_start(st):
        e = head_entry(st)
        print('%s AUTOREBASE %s: no variant for %s; %s' % (stamp, e['run'], st['base_full'][:7],
                                                           'NO-ACT' if no_act else 'starting the background build'))
        if not no_act:
            ar_start(P, st, e)
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


# ------------------------------------------------------------------------------------------ autorebase (impure) --
def gitx(gdir, *a, timeout=600, env_extra=None):
    """git with the user's and the system's config ignored (a diff must not depend on diff.* settings), never a prompt.
    -> (rc, stdout str, stderr str); stdout decoded with surrogateescape, so binary bytes survive a round trip."""
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0',
               GIT_ASKPASS='/bin/false', LC_ALL='C')
    env.update(env_extra or {})
    r = subprocess.run(['git', '-c', 'safe.directory=*', '-c', 'core.quotePath=true', '-C', gdir] + list(a),
                       capture_output=True, timeout=timeout, env=env)
    return (r.returncode, r.stdout.decode('utf-8', 'surrogateescape'),
            r.stderr.decode('utf-8', 'replace'))


DIFF_ARGS = ('diff', '--no-color', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', '-U3',
             '--diff-algorithm=myers', '--indent-heuristic', '--inter-hunk-context=0', '--src-prefix=a/',
             '--dst-prefix=b/', '--no-relative')


def diff_hash(gdir, a, b):
    """(sha256 of norm_diff(git diff a b), the changed paths) or raises."""
    rc, out, err = gitx(gdir, *DIFF_ARGS, a, b)
    if rc != 0:
        raise RuntimeError('git diff %s %s failed: %s' % (a[:8], b[:8], err.strip()[-200:]))
    rc2, names, err2 = gitx(gdir, 'diff', '--no-renames', '--name-only', a, b)
    if rc2 != 0:
        raise RuntimeError('git diff --name-only failed: %s' % err2.strip()[-200:])
    return (hashlib.sha256(norm_diff(out).encode('utf-8', 'surrogateescape')).hexdigest(),
            [x for x in names.splitlines() if x])


def linear_range(gdir, a, b):
    """(commits a..b oldest first, '' ) or ([], why not)."""
    if gitx(gdir, 'merge-base', '--is-ancestor', a, b)[0] != 0:
        return [], '%s is not an ancestor of %s' % (a[:8], b[:8])
    rc, out, err = gitx(gdir, 'rev-list', '--reverse', '--parents', '%s..%s' % (a, b))
    if rc != 0:
        return [], 'rev-list failed: %s' % err.strip()[-200:]
    rows = [l.split() for l in out.splitlines() if l.strip()]
    if not rows:
        return [], 'the range %s..%s is empty' % (a[:8], b[:8])
    merges = [r[0][:8] for r in rows if len(r) > 2]
    if merges:
        return [], 'the range %s..%s holds merge commits (%s): a patch source must be linear' % (a[:8], b[:8], ', '.join(merges))
    return [r[0] for r in rows], ''


def ar_job_path(P, run, base, tip):
    return os.path.join(P['ar_home'], 'jobs', '%s--%s--%s.json' % (run, base[:12], tip[:12]))


def ar_read_job(p):
    try:
        with open(p) as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except Exception as x:
        return {'state': 'refused', 'step': 'job-file', 'why': 'the job file %s is unreadable: %s' % (p, x)}


def ar_write_job(p, job):
    tmp = '%s.tmp-%d' % (p, os.getpid())
    with open(tmp, 'w') as f:
        json.dump(job, f, indent=1)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, p)


def ar_page(P, level, run, msg):
    os.makedirs(os.path.dirname(P['page']), exist_ok=True)
    with open(P['page'], 'a') as f:
        f.write(json.dumps({'ts': iso(now()), 'run': run, 'level': level, 'msg': 'canary-sched autorebase: ' + msg}) + '\n')


def ar_start(P, st, e):
    """Create the job file EXCLUSIVELY (a second tick can never start a second build, and a crash before the helper
    writes its pid leaves `starting`, which goes stale -> blocked, never retried), then start the helper detached."""
    run, base, tip = e['run'], st['base_full'], e['patch']['tip']
    p = ar_job_path(P, run, base, tip)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    job = {'state': 'starting', 'run': run, 'base': base, 'tip': tip, 'src_base': e['patch']['base'],
           'at': iso(now()), 'hb': iso(now()), 'step': 'start', 'steps': []}
    for q in glob.glob(os.path.join(P['ar_home'], 'jobs', '*.json')):
        j = ar_read_job(q) or {}
        hb = ts(j.get('hb') or j.get('at'))
        if j.get('state') in ('starting', 'running') and hb and (now() - hb).total_seconds() <= AR_STALE_MIN * 60:
            return None                     # one build at a time on this host (one repo, one npm)
    try:
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        return None
    with os.fdopen(fd, 'w') as f:
        json.dump(job, f, indent=1)
    append_state(P, {'state': 'autorebase', 'run': run, 'base': base, 'tip': tip, 'step': 'start', 'ok': True,
                     'detail': 'background build started for %s..%s onto %s' % (e['patch']['base'][:8], tip[:8], base[:8])})
    log = os.path.join(P['ar_home'], 'logs', '%s--%s.log' % (run, base[:12]))
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, 'a') as out:
        pr = subprocess.Popen([sys.executable, os.path.abspath(__file__), 'autorebase-build', run, base, tip],
                              stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, cwd=P['home'],
                              start_new_session=True, close_fds=True)
    return pr.pid


class ArRefuse(Exception):
    pass


class ArJob:
    """The job file, a heartbeat thread, and one sched-state row per step."""

    def __init__(self, P, run, base, tip):
        import threading
        self.P, self.run, self.base, self.tip = P, run, base, tip
        self.p = ar_job_path(P, run, base, tip)
        self.lk = threading.Lock()
        self.job = ar_read_job(self.p)
        self.stop = threading.Event()
        self.t = threading.Thread(target=self._beat, daemon=True)

    def _beat(self):
        while not self.stop.wait(30):
            with self.lk:
                self.job['hb'] = iso(now())
                ar_write_job(self.p, self.job)

    def begin(self):
        with self.lk:
            self.job.update({'state': 'running', 'pid': os.getpid(), 'hb': iso(now())})
            ar_write_job(self.p, self.job)
        self.t.start()

    def step(self, name, detail='', ok=True):
        print('%s [%s] %s %s' % (iso(now()), name, 'ok' if ok else 'FAIL', detail), flush=True)
        with self.lk:
            self.job['step'] = name
            self.job['hb'] = iso(now())
            self.job.setdefault('steps', []).append({'step': name, 'ok': ok, 'at': iso(now()), 'detail': detail[:600]})
            ar_write_job(self.p, self.job)
        append_state(self.P, {'state': 'autorebase', 'run': self.run, 'base': self.base, 'tip': self.tip, 'step': name,
                              'ok': ok, 'detail': detail[:600]})

    def end(self, state, **kw):
        self.stop.set()
        with self.lk:
            self.job.update(kw)
            self.job.update({'state': state, 'hb': iso(now()), 'ended': iso(now())})
            ar_write_job(self.p, self.job)


def run_cmd(argv, cwd, timeout, env_extra=None):
    """-> (rc, combined output). A timeout kills the whole process group and returns rc 124."""
    env = dict(os.environ); env.update(env_extra or {})
    pr = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          env=env, start_new_session=True)
    try:
        out, _ = pr.communicate(timeout=timeout)
        return pr.returncode, out.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        import signal
        try:
            os.killpg(pr.pid, signal.SIGKILL)
        except Exception:
            pass
        out, _ = pr.communicate()
        return 124, out.decode('utf-8', 'replace') + '\n[killed after %d s]' % timeout


def test_results(out):
    """PURE. {file: 'ok'|'FAIL'} from run-tests.mjs lines (`ok   x.test.mjs ...`, `FAIL x.test.mjs ...`)."""
    res = {}
    for l in out.splitlines():
        m = re.match(r'^(ok|FAIL)\s+(\S+\.test\.mjs)\b', l)
        if m:
            res[m.group(2)] = m.group(1)
    return res


def test_verdict(full_rc, full, alone_new, alone_base, touched, expected=None, max_base_fail=3):
    """PURE. Did the suite pass, base-relatively? full: {file: ok|FAIL} of the full run on the new tip; alone_new: the
    same for each full-run failure re-run ALONE on the new tip; alone_base: each still-failing file re-run alone on the
    BASE. A file passes when it passed in the full run, or alone. A file that fails alone on the new tip is accepted only
    when it ALSO fails alone on the base, the change does not touch it, and at most max_base_fail files are like that.
    expected: how many test files the worktree holds -- the full run must have reported every one of them.
    -> ('', summary) or (why refused, summary)."""
    if not full:
        return 'the full run printed no per-file results (rc %s)' % full_rc, ''
    if full_rc == 124:
        return 'the full run was killed at the timeout after %d files' % len(full), ''
    if expected is not None and len(full) != expected:
        return 'the full run reported %d files, the worktree has %d' % (len(full), expected), ''
    fails = sorted(f for f, r in full.items() if r != 'ok')
    if full_rc == 0 and not fails:
        return '', 'npm test %d/%d in the full run' % (len(full), len(full))
    if full_rc != 0 and not fails:
        return 'npm test exited %s with no failing file named' % full_rc, ''
    if len(fails) > AR_MAX_RERUN:
        return '%d files failed in the full run (more than %d are not re-run)' % (len(fails), AR_MAX_RERUN), ''
    still = sorted(f for f in fails if alone_new.get(f) != 'ok')
    flaky = [f for f in fails if f not in still]
    summary = 'npm test %d/%d in the full run; re-run alone: %s' % (
        len(full) - len(fails), len(full), ', '.join('%s %s' % (f, alone_new.get(f, '?')) for f in fails))
    if not still:
        return '', summary + ' (all pass alone)'
    unknown = [f for f in still if alone_new.get(f) != 'FAIL']
    if unknown:
        return 'no completed answer when re-run alone on the new tip (timeout, crash or no result line): %s' % (
            ', '.join(unknown)), summary
    mine = [f for f in still if any(t.endswith('/' + f) or t == f for t in touched)]
    if mine:
        return 'test file(s) the change touches fail alone: %s' % ', '.join(mine), summary
    new_only = [f for f in still if alone_base.get(f) != 'FAIL']
    if new_only:
        return 'fail alone on the new tip and NOT on the base: %s' % ', '.join(new_only), summary
    if len(still) > max_base_fail:
        return '%d files fail alone on both the new tip and the base (> %d): the host is not fit to judge' % (
            len(still), max_base_fail), summary
    return '', summary + '; failing on the BASE too on this host (not the change): %s' % ', '.join(still)


def ar_build(P, run, base, tip):
    job = ArJob(P, run, base, tip)
    if not job.job or job.job.get('state') != 'starting':
        print('REFUSED: job %s is %s, not `starting` (a build runs only once)' % (job.p, (job.job or {}).get('state')))
        return 2
    job.begin()
    try:
        res = _ar_steps(P, job, run, base, tip)
        job.end('done', **res)
        ar_page(P, 'info', run, 'built %s for fleet base %s (%s); the next free-slot tick launches it'
                % (res['variant'][:8], base[:8], res['branch']))
        return 0
    except ArRefuse as x:
        why = str(x)
        job.step(job.job.get('step') or '?', 'REFUSED: ' + why, ok=False)
        job.end('refused', why=why)
        ar_page(P, 'error', run, '%s BLOCKED: no variant for fleet base %s and the autorebase refused at step %s: %s -- '
                'build it by hand (`queue add-variant`) or fix and `canary-sched.py autorebase-clear %s <why>`'
                % (run, base[:8], job.job.get('step'), why[:400], run))
        return 3
    except Exception as x:
        import traceback
        why = 'crashed: %s: %s | %s' % (type(x).__name__, x, ' '.join(traceback.format_exc().split())[-300:])
        job.step(job.job.get('step') or '?', why, ok=False)
        job.end('refused', why=why)
        ar_page(P, 'error', run, '%s BLOCKED: the autorebase for fleet base %s %s' % (run, base[:8], why[:400]))
        return 3


def _ar_steps(P, job, run, base, tip):
    S = job.step
    # 1. the entry and its declared change
    q = load_queue(P)
    hit = [e for e in q.get('entries') or [] if e.get('run') == run]
    if len(hit) != 1:
        raise ArRefuse('%s is not queued exactly once' % run)
    e = hit[0]
    pt = e.get('patch') or {}
    if patch_problem(pt) or pt.get('tip') != tip:
        raise ArRefuse('the queued patch source changed or is malformed (%s)' % (patch_problem(pt) or 'tip %s' % pt.get('tip')))
    if base in (e.get('variants') or {}):
        raise ArRefuse('a variant for %s already exists: nothing to build' % base[:8])
    src = (e.get('variants') or {}).get(pt['base']) or {}
    if src.get('canary_sha') != tip:
        raise ArRefuse('the source variant keyed on %s does not have canary_sha %s' % (pt['base'][:8], tip[:8]))
    reads_src = src.get('reads_src') or os.path.join(P['home'], 'mcai-analysis')
    for name, want in sorted((src.get('reads') or {}).items()):
        rp = os.path.join(reads_src, '%s.py' % name)
        if not os.path.exists(rp) or md5(rp) != want:
            raise ArRefuse('read %s in %s is not the md5 the source variant pinned (%s): the reviewed reads changed'
                           % (name, reads_src, want[:8]))
    S('entry', 'patch %s..%s (%s), template registration %s' % (pt['base'][:8], tip[:8], pt.get('branch') or '-',
                                                                  src.get('registration')))
    # 2. the scratch repo: a bare clone of origin, plus the deploy repo for anything origin lacks
    R = os.path.join(P['ar_home'], 'repo.git')
    if not os.path.isdir(R):
        rc, _, err = gitx(P['ar_home'], 'clone', '-q', '--bare', P['ar_origin'], R, timeout=1800)
        if rc != 0:
            raise ArRefuse('clone of %s failed: %s' % (P['ar_origin'], err.strip()[-200:]))
    rc, _, err = gitx(R, 'fetch', '-q', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*', timeout=1800)
    if rc != 0:
        raise ArRefuse('fetch from %s failed: %s' % (P['ar_origin'], err.strip()[-200:]))
    have = lambda x: gitx(R, 'cat-file', '-e', '%s^{commit}' % x)[0] == 0
    if not all(have(x) for x in (pt['base'], tip, base)):
        # the deploy repo is root-owned: a local fetch runs upload-pack with the -c config cleared, so name it there
        gitx(R, 'fetch', '-q', '--upload-pack=git -c safe.directory=* upload-pack', P['git'], '+HEAD:refs/deploy/HEAD',
             '+refs/remotes/origin/*:refs/deploy/origin/*', timeout=1800)
    miss = [x[:8] for x in (pt['base'], tip, base) if not have(x)]
    if miss:
        raise ArRefuse('commits %s are in neither origin nor the deploy repo' % ', '.join(miss))
    S('repo', R)
    # 3. the change is linear and is the one reviewed
    commits, why = linear_range(R, pt['base'], tip)
    if why:
        raise ArRefuse(why)
    h0, files = diff_hash(R, pt['base'], tip)
    if h0 != pt['diff_sha256']:
        raise ArRefuse('the source range %s..%s no longer has the queued diff (sha256 %s, queued %s)'
                       % (pt['base'][:8], tip[:8], h0[:12], pt['diff_sha256'][:12]))
    S('reviewed-diff', '%d commit(s), %d file(s), normalized diff sha256 %s' % (len(commits), len(files), h0[:16]))
    # 4. a scratch worktree on the live base; node modules; the movement lint on the base (its own known state)
    gitx(R, 'worktree', 'prune')
    W = os.path.join(P['ar_home'], 'work', '%s--%s' % (run, base[:8]))
    if os.path.exists(W):
        gitx(R, 'worktree', 'remove', '--force', W)
        shutil.rmtree(W, ignore_errors=True)
    os.makedirs(os.path.dirname(W), exist_ok=True)
    rc, _, err = gitx(R, 'worktree', 'add', '-q', '--detach', W, base)
    if rc != 0:
        raise ArRefuse('worktree add failed: %s' % err.strip()[-200:])
    B = os.path.join(W, 'bots')
    npm = P['ar_npm']
    nice = ['nice', '-n', '10']
    rc, out = run_cmd(nice + [npm, 'ci', '--no-audit', '--no-fund', '--prefer-offline'], B, 1200)
    if rc != 0:
        raise ArRefuse('npm ci failed on the base (rc %s): %s' % (rc, ' '.join(out.split())[-300:]))
    rc_mb, out_mb = run_cmd(nice + [npm, 'run', 'lint:movement'], B, 600)
    S('worktree', '%s at %s; npm ci ok; movement lint on the base rc %s' % (W, base[:8], rc_mb))
    # 5. (a) cherry-pick, no conflict
    # REPRODUCIBLE: committer pinned (name, email, the source tip's committer time), so a rebuild after
    # `autorebase-clear` makes the SAME sha and finds its own branch (and any push of it) instead of refusing on it
    _, cdate, _ = gitx(R, 'log', '-1', '--format=%ct', tip)
    if not re.match(r'^\d+$', cdate.strip()):
        raise ArRefuse('cannot read the committer time of %s (%r)' % (tip[:8], cdate.strip()[:40]))
    pin = {'GIT_COMMITTER_NAME': 'canary-sched autorebase', 'GIT_COMMITTER_EMAIL': 'autorebase@mcai.invalid',
           'GIT_COMMITTER_DATE': '@%s +0000' % cdate.strip()}
    rc, out, err = gitx(W, '-c', 'user.name=canary-sched autorebase', '-c', 'user.email=autorebase@mcai.invalid',
                        '-c', 'commit.gpgsign=false', '-c', 'rerere.enabled=false', 'cherry-pick', '-x',
                        '--allow-empty-message', *commits, timeout=600, env_extra=pin)
    if rc != 0:
        _, unmerged, _ = gitx(W, 'diff', '--name-only', '--diff-filter=U')
        gitx(W, 'cherry-pick', '--abort')
        raise ArRefuse('the cherry-pick of %s..%s onto %s does not apply cleanly: conflict in %s (%s)'
                       % (pt['base'][:8], tip[:8], base[:8], ', '.join(unmerged.split()) or '(no unmerged path)',
                          ' '.join((out + err).split())[-240:]))
    rc, nt, _ = gitx(W, 'rev-parse', 'HEAD')
    nt = nt.strip()
    picked, why = linear_range(R, base, nt)
    if why or len(picked) != len(commits):
        raise ArRefuse('the picked range %s..%s has %d commits, the source %d (%s)'
                       % (base[:8], nt[:8], len(picked), len(commits), why or 'an empty pick was skipped?'))
    S('cherry-pick', '%d commit(s) onto %s -> %s, no conflicts' % (len(commits), base[:8], nt[:8]))
    # 6. (b) the diff is the reviewed diff
    h1, files1 = diff_hash(R, base, nt)
    if h1 != h0:
        raise ArRefuse('the rebased diff is NOT the reviewed diff (normalized sha256 %s vs %s; files %s): the base changed '
                       'lines in or beside the change, so it needs a human rebase and a review'
                       % (h1[:12], h0[:12], ', '.join(files1)[:200]))
    S('diff-identical', 'normalized diff sha256 %s == the reviewed one' % h1[:16])
    # 7. (d) protected.py's tier is unchanged
    PR = dict(P, git=R)
    t0 = tier_label(*protected_run(PR, pt['base'], tip))
    t1 = tier_label(*protected_run(PR, base, nt))
    if t0 != t1:
        raise ArRefuse('protected.py tier changed: %s on the source base, %s on %s -- needs the review that tier asks for'
                       % (t0, t1, base[:8]))
    S('tier', 'protected.py tier %s on both bases' % t1)
    if any(f.startswith('bots/package') for f in files):
        rc, out = run_cmd(nice + [npm, 'ci', '--no-audit', '--no-fund', '--prefer-offline'], B, 1200)
        if rc != 0:
            raise ArRefuse('npm ci failed on the new tip (a dependency change, rc %s): %s' % (rc, ' '.join(out.split())[-300:]))
    # 8. (c) lint, movement lint (no worse than the base), the full suite (base-relative for host-load failures)
    rc, out = run_cmd(nice + [npm, 'run', 'lint'], B, 900)
    if rc != 0:
        raise ArRefuse('eslint (npm run lint, no-undef) fails on the new tip: %s' % ' '.join(out.split())[-300:])
    rc_mv, out_mv = run_cmd(nice + [npm, 'run', 'lint:movement'], B, 600)
    if rc_mv != 0 and (rc_mb == 0 or not movement_fails(out_mv) or not movement_fails(out_mv) <= movement_fails(out_mb)):
        raise ArRefuse('the movement-writer lint is worse on the new tip (rc %s, FAIL %s) than on the base (rc %s, FAIL %s)'
                       % (rc_mv, sorted(movement_fails(out_mv)), rc_mb, sorted(movement_fails(out_mb))))
    S('lint', 'eslint ok; movement lint rc %s (base rc %s)' % (rc_mv, rc_mb))
    rc_t, out_t = run_cmd(nice + [npm, 'test'], B, AR_TEST_TIMEOUT_S)
    with open(os.path.join(P['ar_home'], 'logs', '%s--%s.npmtest.out' % (run, base[:12])), 'w') as f:
        f.write(out_t)
    full = test_results(out_t)
    alone_new, alone_base = {}, {}
    fails = sorted(f for f, r in full.items() if r != 'ok')
    if fails and len(fails) <= AR_MAX_RERUN:
        def alone(f):
            rc1, o1 = run_cmd(nice + [npm, 'test', '--', f], B, 900, {'TEST_JOBS': '1'})
            r1 = test_results(o1).get(f, '?')
            # 'FAIL' only for a COMPLETED failing run (a FAIL line, a non-zero exit, not the timeout kill); '?' is no answer
            return 'ok' if r1 == 'ok' and rc1 == 0 else ('FAIL' if r1 == 'FAIL' and rc1 not in (0, 124) else '?')
        for f in fails:
            alone_new[f] = alone(f)
        still = [f for f in fails if alone_new.get(f) != 'ok']
        if still:
            if gitx(W, 'checkout', '-q', '--detach', base)[0] != 0 or gitx(W, 'rev-parse', 'HEAD')[1].strip() != base:
                raise ArRefuse('npm test failed (%s) and the worktree could not be put on the base to compare' % still)
            for f in still:
                alone_base[f] = alone(f)
            if gitx(W, 'checkout', '-q', '--detach', nt)[0] != 0 or gitx(W, 'rev-parse', 'HEAD')[1].strip() != nt:
                raise ArRefuse('the worktree could not be put back on %s after the base comparison' % nt[:8])
    if any(f.startswith('bots/package') for f in files):
        alone_base = {}                     # a dependency change: the base's node modules are not the base's -- no allowance
    expected = len(glob.glob(os.path.join(B, 'test', '*.test.mjs')))
    why, summary = test_verdict(rc_t, full, alone_new, alone_base, files, expected)
    if why:
        raise ArRefuse('npm test: %s (%s)' % (why, summary))
    S('tests', summary)
    # 9. the branch, pushed (relay or direct), confirmed by ls-remote
    branch = 'autorebase/%s-on-%s' % (run, base[:8])
    rc, cur, _ = gitx(R, 'rev-parse', '--verify', '--quiet', 'refs/heads/%s' % branch)
    if rc == 0 and cur.strip() != nt:
        raise ArRefuse('branch %s already exists here at %s' % (branch, cur.strip()[:8]))
    if rc != 0:
        rc, _, err = gitx(R, 'update-ref', 'refs/heads/%s' % branch, nt, '')
        if rc != 0:
            raise ArRefuse('update-ref %s failed: %s' % (branch, err.strip()[-200:]))
    remote = lambda: (gitx(R, 'ls-remote', P['ar_origin'], 'refs/heads/%s' % branch, timeout=120)[1].split() or [''])[0]
    r0 = remote()
    if r0 and r0 != nt:
        raise ArRefuse('origin already has %s at %s (not %s)' % (branch, r0[:8], nt[:8]))
    if not r0:
        if P['ar_push'] == 'direct':
            rc, _, err = gitx(R, 'push', '-q', P['ar_origin'], '%s:refs/heads/%s' % (nt, branch), timeout=600)
            if rc != 0:
                raise ArRefuse('git push failed: %s' % err.strip()[-200:])
        else:
            d = os.path.join(P['ar_home'], 'push')
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, branch.replace('/', '__') + '.req'), 'w') as f:
                f.write('%s %s\n' % (branch, nt))
        S('push-request', '%s %s via %s' % (branch, nt[:8], P['ar_push']))
        t_end = time.time() + AR_PUSH_WAIT_MIN * 60
        while True:
            r0 = remote()
            if r0:
                break
            if time.time() > t_end:
                raise ArRefuse('origin does not show %s after %d min: is the Mac relay (launchd com.mcai.autorebase-relay) '
                               'running?' % (branch, AR_PUSH_WAIT_MIN))
            time.sleep(20)
        if r0 != nt:
            raise ArRefuse('origin shows %s at %s, not %s' % (branch, r0[:8], nt[:8]))
    S('pushed', '%s at %s on origin' % (branch, nt[:8]))
    # 10. the deploy repo can resolve it (H3, fleet-deploy)
    cmd = (['sudo', '-n'] if P['ar_sudo'] == '1' else []) + [
        'git', '-C', P['git'], 'fetch', '-q', 'origin', '+refs/heads/%s:refs/remotes/origin/%s' % (branch, branch)]
    rc, out = run_cmd(cmd, P['home'], 600)
    if rc != 0 or full_sha(P, nt) != nt:
        raise ArRefuse('the deploy repo %s cannot resolve %s after the fetch (rc %s): %s' % (P['git'], nt[:8], rc,
                                                                                            ' '.join(out.split())[-200:]))
    S('deploy-repo', '%s resolves %s' % (P['git'], nt[:8]))
    # 11. the registration: the source variant's, re-pointed
    with open(src['registration']) as f:
        reg = json.load(f)
    reg['sha'] = nt
    reg['registered_at'] = iso(now())
    note = ('[AUTOREBASE] %s @ %s on fleet base %s (branch %s): canary-sched cherry-picked %s..%s (%d commit(s), the '
            'reviewed variant on %s) with no conflicts; normalized diff identical (sha256 %s); protected tier %s '
            'unchanged; eslint ok; %s. ' % (run, nt[:8], base[:8], branch, pt['base'][:8], tip[:8], len(commits),
                                            pt['base'][:8], h1[:16], t1, summary))
    reg['notes'] = note + str(reg.get('notes') or '')
    regp = os.path.join(os.path.dirname(os.path.abspath(src['registration'])), '%s.%s.json' % (run, nt[:8]))
    if os.path.exists(regp):
        raise ArRefuse('%s already exists: reconcile it by hand' % regp)
    with open(regp + '.tmp', 'w') as f:
        json.dump(reg, f, indent=1); f.write('\n')
    os.replace(regp + '.tmp', regp)
    S('registration', regp)
    # 12. the variant, through the same validation as a hand-added one
    approved = '%s || AUTOREBASE (canary-sched v39) onto %s: %s' % (src.get('approved') or '', base[:8], note.strip())
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = cmd_queue(P, ['add-variant', '--reads-src', reads_src, run, base, regp, approved])
    if rc != 0:
        raise ArRefuse('queue add-variant refused: %s' % ' '.join(buf.getvalue().split())[-400:])
    S('variant', 'queued %s for %s' % (nt[:8], base[:8]))
    gitx(R, 'worktree', 'remove', '--force', W)
    shutil.rmtree(W, ignore_errors=True)
    return {'variant': nt, 'branch': branch, 'registration': regp, 'tests': summary}


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


TWO_ENGINES = (re.compile(r'claude', re.I), re.compile(r'codex|chatgpt|gpt', re.I))


def protected_run(P, base, canary):
    """(rc, output) of the BASE's scripts/lib/protected.py against the BASE's config/protected-paths.txt (git show), so
    a canary cannot edit its own protection. rc 0 not protected, 1 protected, 2 undecidable (also: it could not run)."""
    d = tempfile.mkdtemp(prefix='sched-prot-')
    try:
        got = {}
        for rel in ('scripts/lib/protected.py', 'config/protected-paths.txt'):
            rc, out = git(P, 'show', '%s:%s' % (base, rel))
            if rc != 0:
                return 2, '%s is absent at the base %s: undecidable, so protected' % (rel, base[:7])
            got[rel] = os.path.join(d, os.path.basename(rel))
            with open(got[rel], 'w') as f:
                f.write(out + '\n')
        r = subprocess.run(['python3', got['scripts/lib/protected.py'], '--repo', P['git'], '--base', base, '--head', canary,
                            '--list', got['config/protected-paths.txt']], capture_output=True, text=True, timeout=180)
        if r.returncode in (0, 1):
            return r.returncode, r.stdout
        return 2, 'protected.py could not decide (exit %d): %s' % (r.returncode, ' '.join((r.stdout + r.stderr).split())[-200:])
    except Exception as x:
        return 2, 'protected check could not run: %s' % x
    finally:
        shutil.rmtree(d, ignore_errors=True)


def protected_check(P, base, canary):
    """v37: (protected, why) for base..canary (protected_run). Undecidable = protected (protected.py's own rule: exit 2
    is never "not protected")."""
    rc, out = protected_run(P, base, canary)
    if rc == 0:
        return False, 'not protected'
    if rc == 1:
        return True, ' '.join(out.split())[:300]
    return True, out


def approval_problem(approved, protected):
    """PURE (v37). `approved` NAMES THE REVIEWER: any non-empty name is enough for an ordinary change; a protected one
    (tier 3) must name both engines. '' = fine."""
    if not isinstance(approved, str) or not approved.strip():
        return 'carries no `approved` (the reviewer\'s name)'
    if protected and not all(rx.search(approved) for rx in TWO_ENGINES):
        return 'touches protected paths (tier 3), so `approved` must name both engines (Claude and Codex): %r' % approved[:120]
    return ''


def validate_entry(P, e, journal):
    """`queue add` refusals (empty list = valid). Fills computed hashes in place."""
    bad = []
    run = e.get('run') or ''
    if not re.match(r'^[a-z0-9][a-z0-9._-]*$', run):
        bad.append('run id %r is not a plain id' % run)
    if deployment(run_rows(journal, run))[0] is not None:
        bad.append('the journal shows %s already DEPLOYED: a run id is one deployment' % run)
    if (e.get('class') or '') not in ('', 'bag-fix', 'underground-safety', 'model-env'):
        bad.append('class %r unknown' % e.get('class'))
    if not e.get('variants'):
        bad.append('no variants')
    for k, v in (e.get('variants') or {}).items():
        if not HEX40.match(k):
            bad.append('variant key %r is not a full 40-hex sha (chain-after matched prefixes and the last match won)' % k)
            continue
        if approval_problem(v.get('approved'), False):
            bad.append('variant %s %s' % (k[:7], approval_problem(v.get('approved'), False)))
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
        # brain-01: a MODEL/ENV canary must say what env it sets, how many pools it may take (the Studio serves ~10-12
        # bots, not 20), and that a KEEP keeps it on that subset -- never a fleet-wide model swap.
        if (r.get('class') or '') == 'model-env':
            ce = r.get('canary_env') or []
            if not ce or not all(isinstance(x, str) and re.fullmatch(r'[A-Z_][A-Z0-9_]*=[^\s*?\[\]]+', x) for x in ce):
                bad.append('variant %s: model-env needs canary_env as KEY=VALUE strings without spaces or glob characters' % k[:7])
            if not isinstance(r.get('draw_k'), int) or not 1 <= r['draw_k'] <= 2:
                bad.append('variant %s: model-env needs draw_k 1..2 (pools; the Studio serves ~10-12 bots)' % k[:7])
            if r.get('promotion') not in ('keep-subset', 'none'):
                bad.append('variant %s: model-env promotion must be keep-subset or none, not %r' % (k[:7], r.get('promotion')))
        cs = full_sha(P, r.get('sha'))
        if not cs:
            bad.append('variant %s: registration sha %r does not resolve' % (k[:7], r.get('sha')))
        elif v.get('canary_sha') and v['canary_sha'] != cs:
            bad.append('variant %s: canary_sha given %s, registration says %s' % (k[:7], v['canary_sha'][:7], cs[:7]))
        else:
            v['canary_sha'] = cs
            if git(P, 'merge-base', '--is-ancestor', k, cs)[0] != 0:
                bad.append('variant %s: canary %s does not descend from its base' % (k[:7], cs[:7]))
            elif r.get('lab') is not True:
                # v37 fun mode: tier by the protected-path list; the result is recorded on the variant
                prot, pwhy = protected_check(P, k, cs)
                v['protected'] = prot; v['protected_why'] = pwhy
                ap = approval_problem(v.get('approved'), prot)
                if ap:
                    bad.append('variant %s %s (%s)' % (k[:7], ap, pwhy[:160]))
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
    if sub == 'set-patch' and len(args) in (3, 4):
        run, sb = args[1], args[2]
        branch = args[3] if len(args) == 4 else ''
        q = load_queue(P)
        hit = [x for x in q.get('entries') or [] if x.get('run') == run]
        if len(hit) != 1:
            print('REFUSED: %s is not queued exactly once' % run); return 2
        v = (hit[0].get('variants') or {}).get(sb)
        if not HEX40.match(sb) or not v or not HEX40.match(str(v.get('canary_sha') or '')):
            print('REFUSED: %s has no variant keyed on the full sha %s (have: %s)' % (
                run, sb, ', '.join(k[:8] for k in hit[0].get('variants') or {}))); return 2
        tip = v['canary_sha']
        commits, why = linear_range(P['git'], sb, tip)
        if why:
            print('REFUSED: %s' % why); return 2
        try:
            h, files = diff_hash(P['git'], sb, tip)
        except Exception as x:
            print('REFUSED: %s' % x); return 2
        pt = {'base': sb, 'tip': tip, 'branch': branch, 'commits': len(commits), 'files': files, 'diff_sha256': h,
              'set_at': iso(now())}

        def setp(q):
            h2 = [x for x in q['entries'] if x.get('run') == run]
            if len(h2) != 1 or (h2[0].get('variants') or {}).get(sb, {}).get('canary_sha') != tip:
                raise SystemExit('REFUSED: %s changed while the patch was computed' % run)
            h2[0]['patch'] = pt
        with_queue(P, setp)
        print('patch source of %s: %s..%s (%d commit(s), %d file(s), normalized diff sha256 %s)'
              % (run, sb[:8], tip[:8], len(commits), len(files), h[:16])); return 0
    rs = None
    if sub == 'add-variant' and len(args) >= 3 and args[1] == '--reads-src':
        rs, args = args[2], args[:1] + args[3:]
    if sub == 'add-variant' and len(args) >= 5:
        run, base, reg, approved = args[1], args[2], args[3], ' '.join(args[4:])
        if not HEX40.match(base):
            print('REFUSED: base %r is not a full sha' % base); return 2
        st = gather(P, full=False)
        if deployment(run_rows(st['journal'], run))[0] is not None:
            print('REFUSED: %s has deployed; a deployed run is never re-registered' % run); return 2
        if journal_status(run, st) == 'live':
            print('REFUSED: a loop for %s is running' % run); return 2
        hit = [x for x in (st.get('queue') or {}).get('entries') or [] if x.get('run') == run]
        if len(hit) != 1:
            print('REFUSED: %s is not queued exactly once' % run); return 2
        e2 = {'run': run, 'class': hit[0].get('class', ''),
              'variants': {base: {'registration': os.path.abspath(reg), 'approved': approved}}}
        if rs:
            e2['variants'][base]['reads_src'] = rs
        bad = validate_entry(P, e2, st['journal'])
        if bad:
            print('REFUSED:\n  ' + '\n  '.join(bad)); return 2

        def addv(q):
            h2 = [x for x in q['entries'] if x.get('run') == run]
            if len(h2) != 1:
                raise SystemExit('REFUSED: %s is not queued exactly once' % run)
            if base in (h2[0].get('variants') or {}):
                raise SystemExit('REFUSED: %s already has a variant for %s' % (run, base[:8]))
            h2[0].setdefault('variants', {})[base] = e2['variants'][base]
        with_queue(P, addv)
        print('added variant %s of %s for base %s' % (e2['variants'][base]['canary_sha'][:8], run, base[:8])); return 0
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


def _cmd_ar_clear(P, args):
    if len(args) < 2:
        print('usage: autorebase-clear <run> <why>'); return 2
    run, why = args[0], ' '.join(args[1:])
    jobs = sorted(glob.glob(os.path.join(P['ar_home'], 'jobs', '%s--*.json' % glob.escape(run))))
    if not jobs:
        print('nothing to clear: no autorebase job for %s' % run); return 0
    t = now()
    for p in jobs:
        j = ar_read_job(p) or {}
        hb = ts(j.get('hb') or j.get('at'))
        if j.get('state') in ('starting', 'running') and hb and (t - hb).total_seconds() <= AR_STALE_MIN * 60:
            print('REFUSED: the job %s is still running (pid %s, heartbeat %s)' % (p, j.get('pid'), j.get('hb'))); return 2
    d = os.path.join(P['ar_home'], 'jobs', 'cleared')
    os.makedirs(d, exist_ok=True)
    for p in jobs:
        os.replace(p, os.path.join(d, '%s.cleared-%s' % (os.path.basename(p), iso(t))))
    append_state(P, {'state': 'human', 'run': run, 'how': 'autorebase-clear', 'why': why, 'by': os.environ.get('USER', '?'),
                     'jobs': [os.path.basename(p) for p in jobs]})
    print('autorebase-clear %s: %d job file(s) moved to %s; the next tick may build again' % (run, len(jobs), d)); return 0


def cmd_status(P):
    st = gather(P, full=True)
    for e in (st.get('queue') or {}).get('entries') or []:
        pt = e.get('patch') or {}
        print('%-20s %-10s %-18s hold=%s not_before=%s after=%s variants=%s%s' % (
            e.get('run'), entry_state(e, st), e.get('class') or '-', e.get('hold'), e.get('not_before'), e.get('after'),
            ','.join(k[:7] for k in e.get('variants') or {}),
            ' patch=%s..%s' % (str(pt.get('base'))[:7], str(pt.get('tip'))[:7]) if pt else ''))
    if st.get('ar_job'):
        j = st['ar_job']
        print('AUTOREBASE %s on %s: %s at step %s%s' % (j.get('run'), str(j.get('base'))[:8], j.get('state'), j.get('step'),
                                                       (' -- ' + str(j.get('why'))[:300]) if j.get('why') else ''))
    if st.get('r11_expired'):
        print('R11 EXPIRED (v37): %s closed %s on an unlinked death-driven REVERT (%s); >= %.0f h ago, so no hold'
              % (st['r11_expired'][0], st['r11_expired'][2], st['r11_expired'][1], R11_EXPIRE_H))
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
    if cmd == 'autorebase-clear':
        return with_tick_lock(P, _cmd_ar_clear, argv[1:])
    if cmd == 'autorebase-build' and len(argv) == 4:
        return ar_build(P, argv[1], argv[2], argv[3])
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
