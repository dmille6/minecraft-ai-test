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
    canary-sched.py bundle plan [<run>...]        v41: the bundle checks for these runs (or a suggestion from the head);
                                                  writes nothing
    canary-sched.py bundle make <bundle_run> <run> <run> [<run>] --why <text> [--hold <text>]
                                                  v41: queue ONE bundle entry (at the first member's position) whose
                                                  members are reserved (`bundled_in`); the autorebase composes it
    canary-sched.py bundle split <bundle_run> <why> [--hold <run>=<why>]...
                                                  v41: a bundle that did not KEEP (or never deployed): its members
                                                  return to the queue as ordinary single runs

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

AUTOREBASE TEST STEP v40 (11-02). v39 judged each full-run failure on ONE alone run on the new tip and ONE on the base;
on .31 (80 bots, load 12-20 on 24 cores) timing-sensitive files fail alone at random, so cooldown15-01 (a config cap) was
refused onto c711879e ("fail alone on the new tip and NOT on the base: gather-reach, plinth-skill") and the slot sat idle
2.5 h. The same files passed on the Mac. v40 keeps every other check and judges each failing file by its KIND:
  touched  the change edits the test file itself, or a file every test runs through (bots/package*.json,
           bots/scripts/run-tests.mjs, bots/node_modules): ONE alone run on the new tip; it passes or the build refuses.
  imports  the change edits a file in the test's import closure (static and literal dynamic imports, require, any string
           literal that names a repo file or directory, followed transitively), OR that closure cannot be fully listed
           (a computed import, a child process, a Worker, any fs read or listing): no pass-once allowance. Alone runs alternate base / new (same
           load period), up to AR_RERUN_TRIES each; accepted only when the BASE fails it too on this host (it fails
           every run on both, or it flakes on both); a file that fails only on the new tip, or flakes on the new tip
           while the base passes every run, refuses.
  clear    nothing in its closure changed: up to AR_RERUN_TRIES alone runs on the new tip with backoff; passing once is
           a host flake (named in the registration). Failing every time, it is accepted only when it fails every alone
           run on the base too.
Alone runs are at normal priority (one file, TEST_JOBS=1; the full suite stays at nice 10), each output is kept in
~/autorebase/logs/<run>--<base>.rerun.out, and at most 3 files may be accepted as failing on the base.

FUN MODE (v37, OWNER 2026-10-28, W4). A registration that does not say `"lab": true` is an ORDINARY run: R10
(drawexposure), H5 (NEXT-SLOT) and H6 (bag-fix 4-pool draw) are lab-only and do not apply to it. For a fun-mode run R11
EXPIRES 2 h after the run closed unless one of its deaths was CHANGE-LINKED (a rung-linked / change-row death, or an
artifact with extra.linked > 0 or verdict.py's licensed change-row `deaths`); a lab run keeps the hold; `continue` still
releases either at once. `approved` names the reviewer (any non-empty name); a canary
whose diff touches config/protected-paths.txt (decided by the BASE's scripts/lib/protected.py; undecidable = protected)
must name both engines (Claude and Codex).

BUNDLES AND THE FAST READ PLAN (v41, OWNER 2026-11-03 item 2: "faster path for small changes AND bundling of unrelated
changes"; designs by Codex and an independent Claude agent, reconciled; blocker review by both). Measured 10-28..11-03:
a canary takes 3.3-3.85 h (draw <= 0.67 h, +180 read, promotion); 26 canaries in 5.5 days.
  BUNDLE  ONE canary sha carrying 2..BUNDLE_MAX reviewed changes, so it fits the one slot. Formed by an operator
          (`bundle make`, never automatically), placed at its first member's queue position. A member must be READY
          and unheld, class '', fun mode, carry a patch source (set-patch) whose variant names a reviewer, be protected
          tier `none` on its own reviewed range, NOT STACKED (its patch base is an ancestor of the live fleet base), no
          bots/package*.json, its registration only BUNDLE_REG_KEYS (no own reads, env, poll, bag-fix ...), and declare
          change rows (a linked death must be attributable). Pairwise: disjoint FOOTPRINTS -- (file, top-level
          declaration | table row | import block) from the BASE's protected.py lexer on both sides of the -U0 diff,
          test files excepted (the per-member diff identity proves they touch different lines, the composed suite runs
          them); no CROSS-REFERENCE (no changed source line of one names a declaration the other changes or adds);
          disjoint change rows / linkage rows / licence kinds (verdict.py's '_' normalisation); not in each other's
          `couples_with`. A later member may jump only entries that are ready, unheld, tier none and class '' (each is
          delayed one run); never a held, tier-3, model-env or bundle entry, so the P,S order and the servea waiter's
          head are kept. `after` between members is ordering; outside ones go on the bundle entry (H1).
          The AUTOREBASE composes it on the live base: each member's range picked in queue order, each incremental
          normalized diff byte-identical to that member's reviewed one, the footprints re-checked on the incremental
          diffs, the composed tier `none`, eslint, movement lint, the full suite (v40 adjudication over the union of
          files), then a bundle registration (`bundle_registration`: union change rows, each member's licence and
          `effect` kept under bundle.members -- no top-level effect) and `queue add-variant`. A refusal pages and
          blocks; never retried.
          Close: KEEP + promoted -> every member DONE (dependents proceed). Anything else (REVERT, death trip,
          INCONCLUSIVE, a KEEP not promoted) -> the whole bundle was torn down by the loop, R11 applies as for any run,
          and every member is BUNDLE-FAILED (H8, blocks, pages) until a human `bundle split`, which prints the verdict
          lines and each member's change rows for the attribution and returns the members as single runs. NO LIVE
          BISECTION (bors-ng/GitHub merge queues bisect a failed batch because their oracle is cheap, parallel and
          deterministic; ours is a noisy death gate with one slot, and world edits survive a code rollback): with <= 3
          members, singles cost at most 3 runs and cannot be misled by a false trip.
  FAST    `fun_reads` "45 90" (deadline 150) instead of "90 180" (deadline 240); the 5-min death poll is unchanged.
          Decided MECHANICALLY (`fast_problem`, never a declared label): a single run (not a bundle), class '', not
          lab, protected tier none, no bots/package*.json, no added/deleted bots/src file, <= FAST_MAX_LINES changed
          executable lines under bots/src -- fun mode's own tier-1 definition, which the owner lets go owner-direct
          with a 60-min tripwire, so a 90-min 20-bot canary is the stricter path. The autorebase writes it; `queue add`
          refuses an unjustified one; H7 re-checks it at launch; ~/digest/FAST-OFF turns it off. canary-loop.sh v39
          and funread.py accept only the two plans in READ_PLANS.
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
AR_RERUN_TRIES = 3       # v40: at most this many alone runs of one file on each side (the new tip, the base)
AR_RERUN_TIMEOUT_S = 900
AR_RERUN_BUDGET_S = 80 * 60   # v40: all re-runs of one build; past it no new run starts and an undecided file refuses
BUNDLE_MAX = 3           # v41: members per bundle (Codex: start with pairs; Claude: up to four) -- three
STD_READS, FAST_READS = '90 180', '45 90'
READ_PLANS = {STD_READS: 240, FAST_READS: 150}   # fun_reads -> deadline_min; canary-loop.sh and funread.py hold the same
FAST_MAX_LINES = 150     # v41: changed executable lines under bots/src for the fast plan (fun mode's tier-1 bound)
# v41: a bundle member's registration may hold only these keys (anything else -- canary_env, poll_read, draw_k, own
# reads/lines/exposure, bag_fix, read_minutes ... -- has per-run machinery a bundle does not carry: not bundleable)
BUNDLE_REG_KEYS = frozenset('run_id sha registered_at promotion notes reads teardown licence change_rows linkage_extra '
                            'effect class lab known_residuals fun_reads'.split())
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
        'fast_off': os.path.join(D, 'FAST-OFF'),         # v41: present = no fast read plan
        'skip_off': os.path.join(D, 'SKIP-OFF'),         # v42: present = never skip a blocked head (strict head order)
        'autorel_off': os.path.join(D, 'AUTORELEASE-OFF'),  # v42: present = never auto-release an install-hold
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
        'ar_backoff': g('SCHED_AR_BACKOFF_S', '60,180'),  # v40: the sleep before the 2nd, 3rd re-run alone on the new tip
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
    """done | cancelled | running | launching | blocked | ready (design r4 section B); v41 also bundled (reserved by a
    pending bundle) | bundle-failed (its bundle closed without KEEP+promotion, or a dangling reservation)."""
    run = e.get('run')
    mb = member_bundle_state(e, st)
    if mb is not None:
        return mb
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
    """The PHYSICAL head: the first entry not done / cancelled / bundled. decide() launches select_entry(st) instead."""
    for e in (st.get('queue') or {}).get('entries') or []:
        if entry_state(e, st) not in ('done', 'cancelled', 'bundled'):
            return e
    return None


def target_entry(st):
    """v42: the entry this tick works on -- the one gather() selected past skipped heads (st['target']), else the head."""
    return st['target'] if st.get('target') is not None else head_entry(st)


def waited_on(run, st):
    """PURE. Unfinished entries whose `after` names `run` (OWNER 11-06: never skip past an entry another waits on)."""
    return [x.get('run') for x in (st.get('queue') or {}).get('entries') or []
            if run in (x.get('after') or []) and entry_state(x, st) not in ('done', 'cancelled')]


def skip_kind(code, reason, st, e):
    """PURE. One blocker -> its skippable kind, or None. Only these four (OWNER 11-06; Codex: typed subtypes, never a
    whole code): H1 HELD (not a not_before, not a dependency), H3 a blocked attempt that never deployed, H2 an autorebase
    that REFUSED or whose job died (pid gone), R10 an exposure wait/refusal."""
    run = e.get('run')
    r = reason.split(': ', 1)[1] if reason.startswith('%s: ' % run) else reason
    if code == 'H1' and r.startswith('held: '):
        return 'held'
    if code == 'H3' and r.startswith('blocked since its last attempt') and journal_status(run, st) not in ('open', 'live'):
        return 'blocked-attempt'
    if code == 'H2' and e.get('bundle') is None:
        if 'autorebase REFUSED at step' in r:
            return 'autorebase-refused'
        job = st.get('ar_job') or {}
        if 'went silent' in r and str(job.get('pid') or '') not in (st.get('pid_alive') or {}):
            return 'autorebase-dead'
    if code == 'R10':
        return 'exposure'
    return None


def skip_reason(e, blockers, st):
    """PURE. blockers [(code, reason)] of entry e -> '' (do not skip) or why it is skipped. Every blocker must be a
    skippable kind, and nothing unfinished may wait on e."""
    if not blockers or e.get('bundle') is not None:
        return ''
    kinds = [skip_kind(c, r, st, e) for c, r in blockers]
    if any(k is None for k in kinds):
        return ''
    if waited_on(e.get('run'), st):
        return ''
    return '%s skipped (%s): %s' % (e.get('run'), ', '.join(sorted(set(kinds))), blockers[0][1][:200])


def hold_release(st):
    """PURE. -> (release?, why). v42 (OWNER 11-06): an install-hold is released by the scheduler only when it EXPIRED (or
    the pid it declared with --pid is gone) AND the fleet shows no installer and the baseline everywhere: every other slot
    check (S1-S7) passes with the hold removed -- no slot process, the loop lock free, no canary drop-in, no canary
    declared, one build on every active unit and it is the declared one, enough fresh bots, no open run -- and no
    model-rollout process runs. Otherwise it stays, and the reason is said."""
    ih = st.get('install_hold')
    if ih is None:
        return False, ''
    until = ts(ih.get('until'))
    expired = until is not None and until < st['now']
    pid = str(ih.get('pid') or '')
    dead = bool(pid) and (pid not in (st.get('pid_alive') or {}) or
                          (ih.get('start') is not None and (st.get('pid_alive') or {}).get(pid) != ih.get('start')))
    if not (expired or dead):
        return False, ''
    st2 = dict(st, install_hold=None, death_hold=None, pause=False)
    busy, block = slot_blockers(st2)
    bad = ['%s %s' % (c, r) for c, r in busy + block]
    if st.get('rollout_procs'):
        bad.append('a model rollout is running: %s' % '; '.join(st['rollout_procs'][:2]))
    if bad:
        return False, 'not released: ' + ' | '.join(bad)[:400]
    return True, ('expired %s' % ih.get('until')) if expired else ('its holder pid %s is gone' % pid)


def patch_repair_problem(pt, src):
    """PURE. '' when a patch whose stored diff_sha256 disagrees with git may have it RECOMPUTED (v42, OWNER 11-06: dropdig's
    hand-set hash idled the slot 4 h on 11-05): base and tip are full shas AND they are exactly the variant the reviewers
    approved (the variant keyed on patch.base has canary_sha == patch.tip and names its reviewers). Both commits are
    immutable, so the diff between them is what was reviewed; the stored hash is only derived from it."""
    if not HEX40.match(str(pt.get('base') or '')) or not HEX40.match(str(pt.get('tip') or '')):
        return 'base/tip are not full shas'
    if (src or {}).get('canary_sha') != pt.get('tip'):
        return 'the variant keyed on the patch base is not the patch tip'
    if not str((src or {}).get('approved') or '').strip():
        return 'that variant names no reviewer'
    return ''


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
        hr = (st.get('hold_release') or (False, ''))[1]
        (block if stale else busy).append(('S8', 'INSTALL-HOLD by %s until %s%s' % (
            ih.get('owner'), ih.get('until'), (' -- STALE: the installer must release it' + (' (auto-release %s)' % hr
                                                                                         if hr else '')) if stale else '')))
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
        if ds == 'done':
            continue                             # v41: a member of a bundle that was KEPT and promoted
        if ds in ('cancelled', 'blocked', 'predeploy', 'abandoned', 'bundle-failed'):
            out.append(('H1', 'depends on %s, which is %s (not a completion): edit the queue' % (a, ds), False))
        else:
            out.append(('H1', 'waits for %s to close (%s)' % (a, ds), True))
    es = entry_state(e, st)
    if es == 'bundle-failed':
        b = e.get('bundled_in')
        be = bundle_entries(st).get(b)
        if be is None or run not in ((be.get('bundle') or {}).get('members') or []):
            why = 'it is reserved by bundle %s, which is not queued or does not list it (a dangling reservation)' % b
        else:
            dec = run_decision(st, b)
            prom = any(r.get('phase') == 'promoted' for r in run_rows(st.get('journal') or [], b))
            why = 'its bundle %s closed %s (whole-bundle rollback; nothing of it is on the fleet)' % (
                b, '%s without a promotion' % dec if dec and not prom else dec or 'without a ledger decision')
        out.append(('H8', '%s: diagnose offline, then `canary-sched.py bundle split %s <why>` to run the members singly'
                    % (why, b), False))
        return out
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


def ar_token(e):
    """The job key's third part: a single run's patch tip, or (v41) a bundle's plan hash (first 40 hex). None = no source."""
    if e.get('bundle') is not None:
        return None if bundle_problem(e) else e['bundle']['plan_sha256'][:40]
    pt = e.get('patch')
    return None if (not pt or patch_problem(pt)) else pt['tip']


def ar_view(e, st):
    """PURE. The head has no variant for the fleet base: (why, waiting, start_a_build)."""
    if e.get('bundle') is not None:
        bad = bundle_problem(e)
        if bad:
            return ('the bundle cannot be composed: %s' % bad, False, False)
        rng = 'bundle %s' % ' + '.join(e['bundle']['members'])
        pt = {'base': '', 'tip': ''}
    else:
        pt = e.get('patch')
        rng = None
    if not pt:
        return ('no patch source, so no autorebase: build the variant by hand, or `queue set-patch %s <src_base>`'
                % e.get('run'), False, False)
    bad = patch_problem(pt) if rng is None else ''
    if bad:
        return ('autorebase cannot run: %s' % bad, False, False)
    job = st.get('ar_job')
    rng = rng or '%s..%s' % (pt['base'][:8], pt['tip'][:8])
    if job is None:
        return ('autorebase will cherry-pick %s onto it (one background build, then a later tick launches)' % rng,
                True, True)
    s = job.get('state')
    clear = '`canary-sched.py autorebase-clear %s <why>` to build again' % e.get('run')
    if s == 'refused':
        if e.get('bundle') is not None:
            return ('the bundle autorebase REFUSED at step %s: %s -- the head stays blocked: `canary-sched.py bundle split %s '
                    '<why>` runs the members singly (or fix the cause and %s)' % (job.get('step'), str(job.get('why'))[:400],
                                                                                 e.get('run'), clear), False, False)
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
    the head and a launch. v42: 'the head' is the SELECTED entry (past skipped ones), never the physical head."""
    e = target_entry(st)
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


# --------------------------------------------------------------------------------- v41 bundles + fast plan (pure) --
def read_plan(reg):
    """PURE. A fun-mode registration's read plan -> (reads, deadline_min, '') or (None, None, why). Absent/null/'' = the
    standard plan; anything outside READ_PLANS is refused (canary-loop.sh and funread.py hold the same two plans)."""
    v = reg.get('fun_reads') if isinstance(reg, dict) else None
    if v in (None, ''):
        v = STD_READS
    if not isinstance(v, str) or v not in READ_PLANS:
        return None, None, 'fun_reads %r is not one of %s' % (v, sorted(READ_PLANS))
    return v, READ_PLANS[v], ''


def comment_only(body):
    """PURE (Codex review r1 BLOCKER 1). True only for a line that is NOTHING BUT a comment: blank, `// ...`, a `/* ... */`
    (or an unclosed `/* ...`) with only comments after it, or a JSDoc-style `* prose` line holding none of ; = ( ) { }.
    Code after a closing `*/` counts; when unsure, a line is code (the fast plan is then refused, never granted)."""
    b = body.strip()
    if '${' in b:
        return False                  # Codex r2: inside a multi-line template a `// ${f()}` line still runs f
    if not b or b.startswith('//'):
        return True
    if b.startswith('/*'):
        end = b.find('*/', 2)
        return end < 0 or comment_only(b[end + 2:])
    if b.startswith('*/'):
        return comment_only(b[2:])
    if re.match(r'^\*(\s|$)', b) and not re.search(r'[;=(){}]', b) and '*/' not in b:
        return True
    return False


def fast_problem(diff_text, tier, reg, is_bundle):
    """PURE. '' when base..canary (`git diff`, full context or -U0) may run the FAST plan, else why not."""
    if is_bundle:
        return 'a bundle runs the standard plan (v41)'
    if not isinstance(reg, dict) or reg.get('lab') is True:
        return 'not a fun-mode registration'
    if (reg.get('class') or '') or reg.get('canary_env') or reg.get('poll_read'):
        return 'class %r / an env or poll canary' % (reg.get('class') or '')
    if tier != 'none':
        return 'protected tier %s' % tier
    n, cur, hunk, bad = 0, None, False, []
    for l in diff_text.split('\n'):
        if l.startswith('diff --git '):
            m = re.match(r'^diff --git a/(.*) b/(.*)$', l)
            cur, hunk = (m.group(2) if m else '?'), False
            if cur.startswith('bots/package') or (m and m.group(1).startswith('bots/package')):
                bad.append('changes %s' % cur)
            continue
        if cur is None:
            continue
        if not hunk:
            if cur.startswith('bots/src/') and (l.startswith(('new file mode', 'deleted file mode', 'rename ', 'Binary files',
                                                              'GIT binary patch'))):
                bad.append('adds, deletes, renames or binary-patches %s' % cur)
            if l.startswith('@@'):
                hunk = True
            continue
        if l.startswith('@@'):
            continue
        if cur.startswith('bots/src/') and l[:1] in ('+', '-') and not comment_only(l[1:]):
            n += 1
    if bad:
        return '; '.join(sorted(set(bad)))
    if n > FAST_MAX_LINES:
        return '%d changed executable lines under bots/src (the fast plan allows %d)' % (n, FAST_MAX_LINES)
    return ''


def row_names(reg):
    """PURE. The rows a registration links deaths by (change_rows, linkage_extra, licence kind), in verdict.py's form
    (leading '_' stripped, empty names dropped). Non-strings are kept as their repr (never silently dropped)."""
    out = set()
    if not isinstance(reg, dict):
        return out
    names = list(reg.get('change_rows') or []) + list(reg.get('linkage_extra') or [])
    lic = reg.get('licence') if isinstance(reg.get('licence'), dict) else {}
    names += [lic.get('kind')] if lic.get('kind') else []
    names += list(lic.get('kinds') or [])
    for n in names:
        if isinstance(n, str):
            if n.lstrip('_'):
                out.add(n.lstrip('_'))
        else:
            out.add(repr(n))
    return out


def fp_tokens(changes, read, prot):
    """PURE given read(side, path) -> text|None and the BASE's protected module. The FOOTPRINT of one -U0 diff (protected.py
    parse_diff changes): a set of tokens
        ('FILE', path)                      a non-JS file, an added/deleted/renamed file, an unreadable or unlexable side
        ('TEST', path)                      bots/test/** (allowed to overlap: see pair_problems)
        ('IMPORTS', path) / ('IMPORTS+', path)   a removed/changed import line / an added one (or an anchor beside one)
        ('ROW', path, table, frozenset(row names))   a row of a top-level object-literal table (SKILLS ...)
        ('DECL', path, name)                the top-level declaration (or table structure) a changed line is in"""
    toks = set()
    for c in changes:
        op, np_ = c.get('old_path'), c.get('new_path')
        path = np_ or op or '?'
        if path.startswith('bots/test/') and (op is None or op.startswith('bots/test/')):
            toks.add(('TEST', path))
            continue
        if op is None or np_ is None or op != np_ or not path.endswith(('.mjs', '.js', '.cjs')):
            toks.add(('FILE', path))
            continue
        # a changed line's own declaration; a PURE insertion (or deletion) also claims both neighbours of its gap
        hk = c.get('hunks') or []
        ins_old = {x for a, b_, _c, _d in hk if b_ == 0 for x in (a, a + 1) if x >= 1}
        ins_new = {x for _a, _b, c_, d in hk if d == 0 for x in (c_, c_ + 1) if x >= 1}
        for side, lines, anchors in (('old', c.get('old_lines') or set(), ins_old),
                                     ('new', c.get('new_lines') or set(), ins_new)):
            text = read(side, path)
            if text is None:
                toks.add(('FILE', path)); break
            lex = prot.scan_js(text)
            if not lex[0]:
                toks.add(('FILE', path)); break
            owners = prot.decl_owners(text)
            rows, tabs = prot.table_rows(text, lex)
            tlines = text.split('\n')

            def row_key(n):
                # the row's KEY (its first line's 2-space key), stable across sides; every row shares names like `run`
                k = n
                while k > 1 and k - 1 < len(rows) and rows[k - 1] is rows[n]:
                    k -= 1
                m = prot._ROW_KEY.match(tlines[k - 1]) if k - 1 < len(tlines) else None
                return m.group(2) if m else 'odd:' + ','.join(sorted(rows[n]))
            for n in sorted(set(lines) | set(anchors)):
                own = owners[min(n, len(owners) - 1)]
                tab = tabs[n] if n < len(tabs) else None
                row = rows[n] if n < len(rows) else None
                if own == prot.IMPORTS:
                    toks.add(('IMPORTS' if (side == 'old' and n in lines) else 'IMPORTS+', path))
                elif tab is not None and row:
                    toks.add(('ROW', path, tab, frozenset([row_key(n)])))
                elif tab is not None:
                    toks.add(('DECL', path, tab))
                else:
                    toks.add(('DECL', path, own or '(top)'))
    return toks


def fp_overlaps(fa, fb):
    """PURE. The footprint tokens two members share (descriptions); [] = disjoint."""
    out = []
    for ta in sorted(fa, key=repr):
        for tb in sorted(fb, key=repr):
            if 'TEST' in (ta[0], tb[0]) or ta[1] != tb[1]:
                continue
            k = {ta[0], tb[0]}
            if 'FILE' in k:
                out.append('%s (whole file)' % ta[1])
            elif k == {'IMPORTS+'}:
                continue                                  # both only ADD imports: ESM refuses a duplicate binding
            elif k & {'IMPORTS', 'IMPORTS+'}:
                if k <= {'IMPORTS', 'IMPORTS+'}:
                    out.append('%s import block (a changed or removed import)' % ta[1])
            elif k == {'ROW'}:
                if ta[2] == tb[2] and ta[3] & tb[3]:
                    out.append('%s %s row %s' % (ta[1], ta[2], ','.join(sorted(ta[3] & tb[3]))))
            elif k == {'DECL'}:
                if ta[2] == tb[2]:
                    out.append('%s::%s' % (ta[1], ta[2]))
            else:                                         # DECL (a table's structure) vs a ROW of the same table
                d, r = (ta, tb) if ta[0] == 'DECL' else (tb, ta)
                if d[2] == r[2]:
                    out.append('%s %s (table structure vs a row)' % (ta[1], d[2]))
    return sorted(set(out))


_DECL_LINE = re.compile(r'^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)')
_IDENT_RE = re.compile(r'[A-Za-z_$][\w$]*')


def diff_names(diff_text):
    """PURE. From a -U0 diff: (top-level names its +/- source lines DECLARE, identifiers its +/- source lines USE),
    bots/src only, `//` comments and string literals stripped."""
    decl, used, cur, hunk = set(), set(), None, False
    for l in diff_text.split('\n'):
        if l.startswith('diff --git '):
            m = re.match(r'^diff --git a/(.*) b/(.*)$', l)
            cur, hunk = (m.group(2) if m else '?'), False
            continue
        if l.startswith('@@'):
            hunk = True
            continue
        if not hunk or not cur or not cur.startswith('bots/src/') or l[:1] not in ('+', '-'):
            continue
        body = l[1:]
        m = _DECL_LINE.match(body)
        if m:
            decl.add(m.group(1))
        # CONSERVATIVE (Codex review r1 BLOCKER 2, r2): EVERY changed source line counts, comments included (a line that
        # looks like a comment can sit inside a multi-line template), and nothing is stripped from it -- not strings (a template's
        # ${...}, a SKILLS['name'] lookup), not a trailing comment: a name there counts as used (a false "related" only
        # costs a bundle; a missed one ships two coupled changes as "unrelated")
        used.update(_IDENT_RE.findall(body))
    return decl, used


def changed_decls(fp):
    """PURE. The declaration names a footprint changes (not '(top)', not table structure rows)."""
    return {t[2] for t in fp if t[0] == 'DECL' and t[2] not in (None, '(top)')}


def member_problem(m, now_t=None):
    """PURE. m = {'entry', 'state', 'reg', 'tier', 'stacked', 'files'}: '' when this queue entry may be a bundle member."""
    e, reg = m.get('entry') or {}, m.get('reg')
    if m.get('state') != 'ready':
        return 'state %s (a member must be ready)' % m.get('state')
    if e.get("hold"):
        return 'held: %s' % str(e['hold'])[:120]
    if e.get('not_before') and now_t is not None and (ts(e['not_before']) or now_t) > now_t:
        return 'not before %s' % e['not_before']
    if e.get('bundled_in'):
        return 'already in bundle %s' % e['bundled_in']
    if e.get('bundle'):
        return 'is itself a bundle'
    if (e.get('class') or ''):
        return 'class %r (only ordinary changes bundle)' % e['class']
    pt = e.get('patch')
    if not pt or patch_problem(pt):
        return 'no patch source (`queue set-patch`): %s' % (patch_problem(pt) if pt else 'none')
    src = (e.get('variants') or {}).get(pt['base']) or {}
    if src.get('canary_sha') != pt['tip'] or approval_problem(src.get('approved'), False):
        return 'its source variant on %s is not the patch tip, or names no reviewer' % pt['base'][:8]
    if not isinstance(reg, dict):
        return 'registration unreadable'
    if reg.get('lab') is True:
        return 'a lab registration'
    extra = sorted(k for k, v in reg.items() if k not in BUNDLE_REG_KEYS and v not in (None, [], {}, ''))
    if extra:
        return 'registration keys a bundle does not carry (v41): %s' % ', '.join(extra)
    if reg.get('reads'):
        return 'it has its own reads %s (a bundle reads generically only, v41)' % reg['reads']
    if (reg.get('promotion') or 'fleet-wide') != 'fleet-wide':
        return 'promotion %r' % reg.get('promotion')
    lic = reg.get('licence') if isinstance(reg.get('licence'), dict) else {}
    if lic.get('class') not in (None, 'kind'):
        return 'licence class %r (a rate licence would make the whole bundle report-only)' % lic.get('class')
    if not row_names(reg):
        return 'declares no change_rows / licence kind: a linked death could not be pinned to it'
    if m.get('tier') != 'none':
        return 'protected tier %s on its reviewed range (only tier none bundles)' % m.get('tier')
    if m.get('stacked'):
        return 'STACKED: its patch base %s is not in the live fleet base (it depends on an unshipped change)' % pt['base'][:8]
    pk = [f for f in (m.get('files') or pt.get('files') or []) if f.startswith('bots/package')]
    if pk:
        return 'changes %s' % ', '.join(pk)
    return ''


def pair_problems(a, b):
    """PURE. a, b = member facts {'run', 'entry', 'reg', 'fp', 'decl', 'used'} -> list of reasons they are related."""
    out = []
    ov = fp_overlaps(a['fp'], b['fp'])
    if ov:
        out.append('shared footprint: %s' % '; '.join(ov[:6]))
    for x, y in ((a, b), (b, a)):
        hit = sorted((changed_decls(x['fp']) | x.get('decl', set())) & y.get('used', set()))
        if hit:
            out.append('%s changes/declares %s, which %s\'s changed lines use' % (x['run'], ', '.join(hit[:6]), y['run']))
    rows = row_names(a['reg']) & row_names(b['reg'])
    if rows:
        out.append('shared change rows / licence kinds: %s' % ', '.join(sorted(rows)))
    for x, y in ((a, b), (b, a)):
        if y['run'] in ((x.get('entry') or {}).get('couples_with') or []):
            out.append('%s declares couples_with %s' % (x['run'], y['run']))
    return out


def jump_problem(e, state):
    """PURE. '' when a bundle member may be moved ahead of queue entry e (in state `state`)."""
    if state in ('done', 'cancelled', 'bundled'):
        return ''
    if state != 'ready' or e.get('hold') or (e.get('class') or '') or e.get('bundle') or e.get('bundled_in'):
        return 'it is %s%s%s' % (state, ', held' if e.get('hold') else '', ', class %s' % e['class'] if e.get('class') else '')
    vs = e.get('variants') or {}
    if not vs or any(v.get('protected') is not False for v in vs.values()):
        return 'it is (or may be) protected tier 3'
    return ''


def plan_bundle(runs, facts, entries, states, now_t=None):
    """PURE. -> (problems, notes, ordered runs, outside `after`). runs: the requested members; facts[run]: member facts
    (pair_problems + member_problem fields); entries: the queue in order; states: {run: entry_state}."""
    probs, notes = [], []
    pos = {e.get('run'): i for i, e in enumerate(entries)}
    if len(set(runs)) != len(runs):
        probs.append('a member is named twice')
    if not 2 <= len(set(runs)) <= BUNDLE_MAX:
        probs.append('a bundle has 2..%d members, not %d' % (BUNDLE_MAX, len(set(runs))))
    miss = [r for r in runs if r not in pos or r not in facts]
    if miss:
        return probs + ['not queued: %s' % ', '.join(miss)], notes, [], []
    ordered = sorted(set(runs), key=pos.get)
    for r in ordered:
        p = member_problem(facts[r], now_t)
        if p:
            probs.append('%s: %s' % (r, p))
    for i, a in enumerate(ordered):
        for b in ordered[i + 1:]:
            for p in pair_problems(facts[a], facts[b]):
                probs.append('%s + %s: %s' % (a, b, p))
            sh = sorted(t[1] for t in facts[a]['fp'] & facts[b]['fp'] if t[0] == 'TEST')
            if sh:
                notes.append('%s + %s share test file(s) %s: allowed (diff identity + the composed suite)' % (a, b, ', '.join(sh)))
    for e in entries[pos[ordered[0]]:pos[ordered[-1]] + 1]:
        if e.get('run') in ordered:
            continue
        jp = jump_problem(e, states.get(e.get('run')))
        if jp:
            probs.append('a member would jump %s, but %s (members may jump only ready, unheld, tier-none singles)'
                         % (e.get('run'), jp))
        elif states.get(e.get('run')) == 'ready':
            notes.append('%s waits one run behind the bundle' % e.get('run'))
    after = sorted({a for r in ordered for a in ((facts[r].get('entry') or {}).get('after') or []) if a not in ordered})
    return probs, notes, ordered, after


def plan_hash(members):
    """PURE. members: [{'run', 'base', 'tip', 'diff_sha256', 'registration_sha256', 'couples_with'}] in order."""
    keep = [{k: m.get(k) for k in ('run', 'base', 'tip', 'diff_sha256', 'registration_sha256', 'couples_with')} for m in members]
    return hashlib.sha256(json.dumps(keep, sort_keys=True).encode()).hexdigest()


def bundle_problem(e):
    """'' when a queue entry's `bundle` block has the shape `bundle make` writes, else why not."""
    b = e.get('bundle')
    if not isinstance(b, dict):
        return 'bundle is not an object'
    ms = b.get('members')
    if not isinstance(ms, list) or not 2 <= len(ms) <= BUNDLE_MAX or len(set(ms)) != len(ms) or \
            not all(isinstance(x, str) for x in ms):
        return 'bundle members %r malformed' % (ms,)
    if not re.match(r'^[0-9a-f]{64}$', str(b.get('plan_sha256') or '')):
        return 'bundle has no plan_sha256'
    return ''


def bundle_registration(run, sha, base, plan, members, at):
    """PURE. The bundle's ONE registration. members (in pick order): [{'run', 'reg', 'diff_sha256', 'tip_in_bundle',
    'approved', 'registration_sha256', 'files'}]. The union of change rows keeps every member's linked-death test; each
    member's licence and `effect` stay under bundle.members (no top-level effect: a post-promotion checker iterates them)."""
    rows, link, kinds = [], [], []
    for m in members:
        r = m['reg']
        rows += [x for x in r.get('change_rows') or [] if x not in rows]
        link += [x for x in r.get('linkage_extra') or [] if x not in link]
        k = (r.get('licence') or {}).get('kind') if isinstance(r.get('licence'), dict) else None
        if k and k not in kinds:
            kinds.append(k)
    return {
        'run_id': run, 'sha': sha, 'registered_at': at, 'promotion': 'fleet-wide', 'class': '', 'reads': [],
        'fun_reads': STD_READS, 'change_rows': rows, 'linkage_extra': link,
        'licence': {'class': 'kind', 'kinds': kinds, 'note': 'v41 bundle: each member\'s own licence is under bundle.members'},
        'bundle': {'schema': 1, 'base': base, 'plan_sha256': plan, 'members': [
            {'run': m['run'], 'diff_sha256': m['diff_sha256'], 'tip_in_bundle': m['tip_in_bundle'],
             'registration_sha256': m['registration_sha256'], 'files': m.get('files') or [],
             'change_rows': m['reg'].get('change_rows') or [], 'linkage_extra': m['reg'].get('linkage_extra') or [],
             'licence': m['reg'].get('licence'), 'effect': m['reg'].get('effect'), 'approved': m.get('approved') or '',
             'notes': str(m['reg'].get('notes') or '')[:2000]} for m in members]},
        'notes': '[BUNDLE v41] %s = %s on fleet base %s; whole-bundle rollback; members return as singles on any '
                 'outcome but KEEP+promoted (`bundle split`).' % (run, ' + '.join(m['run'] for m in members), base[:8]),
        'teardown': {'note': 'THREE STEPS (the loop\'s _teardown): drop-ins, clear canary_pool, restart the pool\'s bots '
                             '12 s apart; then confirm the live versions.'},
    }


def bundle_entries(st):
    return {e.get('run'): e for e in (st.get('queue') or {}).get('entries') or [] if e.get('bundle')}


def run_decision(st, run):
    """The ledger decision word of a DEPLOYED run's own deployment, or None."""
    rows = run_rows(st.get('journal') or [], run)
    dts, pools = deployment(rows)
    d = ledger_row(st.get('ledger'), (st.get('reg_sha') or {}).get(run), pools, dts)
    return str(d.get('decision')).upper() if d else None


def bundle_outcome(be, st):
    """'void' (cancelled) | 'keep' (closed, ledger KEEP and promoted) | 'failed' (closed any other way) | 'pending'."""
    s = entry_state(be, st)
    if s == 'cancelled':
        return 'void'
    if s == 'done':
        promoted = any(r.get('phase') == 'promoted' for r in run_rows(st.get('journal') or [], be.get('run')))
        return 'keep' if promoted and run_decision(st, be.get('run')) == 'KEEP' else 'failed'
    return 'pending'


def member_bundle_state(e, st):
    """None for an entry not (validly) in a bundle; else 'done' | 'bundle-failed' | 'bundled' (v41)."""
    b = e.get('bundled_in')
    if not b:
        return None
    be = bundle_entries(st).get(b)
    if be is None or e.get('run') not in ((be.get('bundle') or {}).get('members') or []):
        return 'bundle-failed'                  # dangling reservation: H8 names it
    o = bundle_outcome(be, st)
    return {'keep': 'done', 'failed': 'bundle-failed', 'pending': 'bundled'}.get(o)


def decide(st):
    """('launch', entry, variant) | (kind, reasons), kind in busy|block|wait|idle|launching. PURE."""
    busy, block = slot_blockers(st)
    if block:
        return ('block', block + busy)
    if busy:
        return ('busy', busy)
    e = target_entry(st)
    skipped = [('K', w) for _, w in st.get('skipped') or []]
    if e is None:
        if skipped:
            return ('block', [('Q', 'nothing in the queue can run: every entry is skipped')] + skipped)
        return ('idle', [('Q', 'queue empty, or every entry done/cancelled')])
    if entry_state(e, st) in ('launching', 'running'):
        return ('launching', [('L4', '%s: launched, waiting for its first journal line' % e.get('run'))])
    hb = head_blockers(e, st)
    if hb:
        return ('wait' if all(w for _, _, w in hb) else 'block', [(c, '%s: %s' % (e.get('run'), r)) for c, r, _ in hb]
                + skipped)
    if st.get('r10'):
        return ('wait' if st['r10'].startswith('WAIT') else 'block', [('R10', '%s: %s' % (e.get('run'), st['r10']))] + skipped)
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
        if e.get('bundle') is not None or r.get('bundle') is not None:
            rb, qb = r.get('bundle') or {}, e.get('bundle') or {}
            ents = {x.get('run'): x for x in (st.get('queue') or {}).get('entries') or []}
            if rb.get('plan_sha256') != qb.get('plan_sha256') or [m.get('run') for m in rb.get('members') or []] != qb.get('members'):
                out.append(('H3', 'the registration\'s bundle block is not the queued bundle (plan/members differ)'))
            lost = [m for m in qb.get('members') or [] if (ents.get(m) or {}).get('bundled_in') != run]
            meta, held = [], []
            for mrun in qb.get('members') or []:
                me = ents.get(mrun) or {}
                mpt = me.get('patch') or {}
                msrc = (me.get('variants') or {}).get(mpt.get('base')) or {}
                try:
                    mreg = sha256(msrc.get('registration') or '/nonexistent')
                except Exception:
                    mreg = None
                if mreg != msrc.get('registration_sha256'):
                    mreg = 'CHANGED'
                meta.append({'run': mrun, 'base': mpt.get('base'), 'tip': mpt.get('tip'), 'diff_sha256': mpt.get('diff_sha256'),
                             'registration_sha256': mreg, 'couples_with': me.get('couples_with') or []})
                if me.get('hold') or last_human(st, mrun, ('cancel',))[0]:
                    held.append(mrun)
            if plan_hash(meta) != qb.get('plan_sha256'):
                out.append(('H3', 'a member\'s patch, registration or couples_with changed since `bundle make` (plan %s): '
                                  '`bundle split %s <why>`, then make a new bundle' % (plan_hash(meta)[:12], run)))
            if held:
                out.append(('H3', 'bundle member(s) %s are held or cancelled: `bundle split %s <why>`' % (', '.join(held), run)))
            if lost:
                out.append(('H3', 'bundle member(s) %s are no longer reserved by %s: `bundle split` and make a new one'
                            % (', '.join(lost), run)))
            if v.get('protected') is not False:
                out.append(('H3', 'a bundle variant must be protected tier none (%s)' % v.get('protected_why')))
        if r.get('lab') is not True and cs and cs == v.get('canary_sha'):
            for why in plan_problems(P, base, cs, r, v.get('protected'), e.get('bundle') is not None):
                out.append(('H7', why))
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
    st['rollout_procs'] = rollout_procs(P)
    st['skip_on'] = not os.path.exists(P['skip_off'])
    st['autorel_on'] = not os.path.exists(P['autorel_off'])
    st['hold_release'] = hold_release(st) if st['autorel_on'] else (False, '')
    st['skipped'], st['target'] = [], None
    # v42 (OWNER 11-06): the queue is walked in order; an entry whose blockers are ALL skippable kinds and that nothing
    # waits on is skipped (skip_reason), and the next one gets the facts. Anything else stops the walk there, as before.
    cands = [x for x in (st['queue'].get('entries') or []) if entry_state(x, st) not in ('done', 'cancelled', 'bundled')]
    for i, e in enumerate(cands):
        _entry_facts(P, st, e, full, r10)
        if not st['skip_on'] or i == len(cands) - 1 or entry_state(e, st) in ('launching', 'running'):
            break
        hb = [(c, '%s: %s' % (e.get('run'), r)) for c, r, _ in head_blockers(e, st)]
        if not hb and st.get('r10'):
            hb = [('R10', '%s: %s' % (e.get('run'), st['r10']))]
        why = skip_reason(e, hb, st)
        if not why:
            break
        st['skipped'].append((e.get('run'), why))
    if st['skipped']:
        st['target'] = next((x for x in cands if x.get('run') not in {r for r, _ in st['skipped']}), None)
        if st['target'] is None:
            _entry_facts(P, st, None, full, r10)
    return st


def _entry_facts(P, st, e, full, r10):
    """The per-entry facts decide() needs (the autorebase job, the variant checks + staging, R10), for entry e."""
    st['stage'], st['variant_checks'], st['r10'] = [], [], ''
    st['ar_job'] = None
    st.pop('r10_ran', None); st.pop('r10_key', None)
    if e is None:
        return
    if st['base_full'] and st['base_full'] not in (e.get('variants') or {}) and ar_token(e):
        st['ar_job'] = ar_read_job(ar_job_path(P, e['run'], st['base_full'], ar_token(e)))
    if full and st['base_full'] and st['base_full'] in (e.get('variants') or {}):
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


ROLLOUT_PROCS = ('modelrollout.py', 'matset-rollout.sh', 'servea-waiter.sh')


def rollout_procs(P):
    """v42: model-rollout processes (an install-hold is never auto-released while one runs). '' entries = none."""
    out = []
    for d in glob.glob(os.path.join(P['proc'], '[0-9]*')):
        try:
            with open(os.path.join(d, 'cmdline'), 'rb') as f:
                argv = [x for x in f.read().decode('utf-8', 'replace').split('\0') if x]
        except Exception:
            continue
        if any(os.path.basename(x) in ROLLOUT_PROCS for x in argv[:3]):
            out.append('pid %s: %s' % (os.path.basename(d), ' '.join(argv)[:80]))
    return out


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


def note_skips(P, st):
    """v42: every skipped entry gets a state row (when its reason changed) and a flag page (deduplicated 3 h): the
    owner's digest shows each skip; a skip never pages the phone (the queue is moving)."""
    tgt = (target_entry(st) or {}).get('run')
    for run, why in st.get('skipped') or []:
        seen = [r for r in st.get('state_rows') or [] if r.get('state') == 'skipped' and r.get('run') == run]
        if not seen or seen[-1].get('why') != why[:400] or seen[-1].get('target') != tgt:
            append_state(P, {'state': 'skipped', 'run': run, 'why': why[:400], 'target': tgt})
        page(P, st, 'flag', 'skip|%s|%s' % (run, why.split(':', 1)[0][-60:]), 'SKIPPED %s; the queue goes on with %s'
             % (why, tgt or 'nothing'))


def release_hold(P, st):
    """v42: the scheduler releases an expired / ownerless install-hold that hold_release() cleared: the file is renamed aside
    (kept as evidence), a state row and a page say why. Under the tick lock, like every tick write."""
    ih = st.get('install_hold') or {}
    why = st['hold_release'][1]
    aside = '%s.auto-released-%s' % (P['install_hold'], iso(st['now']).replace(':', ''))
    try:
        os.replace(P['install_hold'], aside)
    except OSError as x:
        print('%s HOLD-RELEASE failed: %s' % (iso(st['now']), x))
        return False
    append_state(P, {'state': 'hold-auto-released', 'owner': ih.get('owner'), 'until': ih.get('until'), 'why': why,
                     'aside': aside, 'evidence': 'S1-S7 clear with the hold removed; no rollout process; builds %s'
                     % dict(sorted((st.get('active_builds') or {}).items())[:3])})
    page(P, st, 'flag', 'holdrelease|%s|%s' % (ih.get('owner'), ih.get('until')), 'INSTALL-HOLD by %s until %s AUTO-RELEASED '
         '(%s): no installer, no rollout, the fleet on the declared build everywhere' % (ih.get('owner'), ih.get('until'), why))
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
    if st.get('hold_release', (False, ''))[0]:
        ih = st['install_hold']
        print('%s HOLD-RELEASE: INSTALL-HOLD by %s until %s -- %s; the fleet is on the baseline%s' % (
            stamp, ih.get('owner'), ih.get('until'), st['hold_release'][1], ' -- NO-ACT' if no_act else ''))
        if not no_act:
            release_hold(P, st)
            st = gather(P, full=True)
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
        e = target_entry(st)
        print('%s AUTOREBASE %s: no variant for %s; %s' % (stamp, e['run'], st['base_full'][:7],
                                                           'NO-ACT' if no_act else 'starting the background build'))
        if not no_act:
            ar_start(P, st, e)
    if d[0] == 'launch':
        e, v = d[1], d[2]
        print('%s LAUNCH %s (variant on %s, canary %s)%s%s' % (stamp, e['run'], st['base_full'][:7],
                                                              str(v.get('canary_sha'))[:7],
                                                              ' past %s' % ', '.join(r for r, _ in st['skipped'])
                                                              if st.get('skipped') else '', ' -- NO-ACT' if no_act else ''))
        if not no_act:
            note_skips(P, st)
            launch(P, st, e, v)
        return 0
    print('%s %s: %s' % (stamp, d[0].upper(), ' | '.join('%s %s' % (c, r) for c, r in d[1])))
    if st.get('inactive_units'):
        print('%s note: enabled but inactive units (no drop-in, so they start on baseline): %s'
              % (stamp, ', '.join(st['inactive_units'])))
    for run, why in st.get('skipped') or []:
        print('%s SKIP %s' % (stamp, why))
    if no_act:
        return 0
    note_skips(P, st)
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
    run, base, tip = e['run'], st['base_full'], ar_token(e)
    p = ar_job_path(P, run, base, tip)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    src_base = (e.get('patch') or {}).get('base') or ''
    job = {'state': 'starting', 'run': run, 'base': base, 'tip': tip, 'src_base': src_base,
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
                     'detail': 'background build started for %s onto %s' % (
                         'bundle %s' % '+'.join(e['bundle']['members']) if e.get('bundle') else
                         '%s..%s' % (src_base[:8], tip[:8]), base[:8])})
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


# a file every test runs through: a change to one of these touches every test (no flake allowance for any)
def is_global_test_input(path):
    """PURE."""
    return (path.startswith('bots/package') or path == 'bots/scripts/run-tests.mjs' or path.startswith('bots/node_modules/')
            or path == 'bots/.npmrc')


_CL_SPEC = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\w*\s*\(\s*)(['"])([^'"\n]+)\1''')
_CL_LIT = re.compile(r'''(?=(['"`])([^'"`\n\\$]{1,300})\1)''')      # every literal, overlapping (a mis-paired quote cannot hide one)
_CL_FILE = re.compile(r'^[\w@.~/-]*[\w-]\.(?:mjs|cjs|js|json|jsonl|py|sh|txt|md)$')
_CL_DYN = re.compile(r'''\b(?:import|require\w*)\s*\(\s*(?!(['"])[^'"\n]*\1\s*[,)]|`[^`$\n]*`\s*[,)])''')
_CL_CHILD = re.compile(r'''(?<![.\w$])(?:spawn|spawnSync|fork|execFile|execFileSync|execSync|exec)\s*\(|\bWorker\s*\(|child_process|worker_threads''')
# a filesystem read or listing whose path may be computed: the file read may be one no literal names (comments too)
_CL_FS = re.compile(r'''\b(?:readFileSync|readFile|createReadStream|readdirSync|readdir|opendirSync|opendir|globSync|glob|existsSync|'''
                    r'''statSync|lstatSync|accessSync|openSync)\s*\(|['"`](?:node:)?fs(?:/promises)?['"`]''')   # any use of the fs module (Codex r1: an alias)
_CL_ESC = re.compile(r'''(['"`])(?:\.{1,2}/|[\w@.-]+/)[^'"`\n\s]*\\''')     # a path-like literal with an escape (Codex r1: '../src/\u0078.mjs')
_CL_BARE_DIRS = ('bots', 'bots/src', 'bots/test', 'bots/test/helpers', 'bots/test/fixtures', 'bots/scripts', '', 'config',
                 'scripts', 'scripts/host', 'scripts/lib')
CODE_EXT = ('.mjs', '.cjs', '.js')


def import_closure(read, listdir, rel):
    """PURE given its readers. Every repo file the test file `rel` can reach: static imports, literal dynamic imports and
    requires, and ANY string literal that names an existing repo file (relative to the file, or a bare name under the
    usual dirs) or directory (all files under it), followed transitively through code files. Comments are NOT stripped:
    a path in a comment only makes the closure bigger, which is the safe direction. read(rel) -> text | None (missing),
    listdir(rel) -> [repo-relative files under that directory] | None (not a directory).
    -> (set of repo-relative paths, [why the closure is OPEN: a computed import, a child process, a Worker, or any
    filesystem read/listing -- its path may be built from parts no literal names; measured 11-02 on main this costs 3 of
    the 35 'clear' files for a config.mjs change]).
    An import edge the change REMOVED cannot hide a file: the file that held the edge is changed and still reachable."""
    seen, opens, stack = set(), [], [rel]
    while stack:
        r = stack.pop()
        if r in seen:
            continue
        s = read(r)
        if s is None:
            continue
        seen.add(r)
        if not r.endswith(CODE_EXT):
            continue
        if _CL_DYN.search(s):
            opens.append('%s: a computed import/require' % r)
        if _CL_CHILD.search(s):
            opens.append('%s: a child process or Worker' % r)
        if _CL_FS.search(s):
            opens.append('%s: a filesystem read or listing (the fs module)' % r)
        if _CL_ESC.search(s):
            opens.append('%s: a path-like string literal with an escape' % r)
        d = os.path.dirname(r)
        specs = set(m.group(2) for m in _CL_SPEC.finditer(s))
        if any('\\' in x for x in specs):                 # Claude r2: '\x2e./src/a.mjs' is '../src/a.mjs' to node
            opens.append('%s: an import specifier with an escape' % r)
        cands = specs | set(m.group(2) for m in _CL_LIT.finditer(s))
        for c in cands:
            c = c.strip()
            if not c or c.startswith(('node:', 'http:', 'https:')) or c in ('.', '..', '/', './', '../'):
                continue
            if c.startswith('.'):
                bases = (d,)
            elif '/' in c:
                bases = (d, 'bots', '')
            elif _CL_FILE.match(c):
                bases = (d,) + _CL_BARE_DIRS
            else:
                continue
            for b in bases:
                q = os.path.normpath(os.path.join(b, c))
                if q.startswith('..') or q == '.' or os.path.isabs(q):
                    continue
                tries = [q] + ([q + x for x in CODE_EXT] if c.startswith('.') and not q.endswith(CODE_EXT) else [])
                hit = False
                for t in tries:
                    if read(t) is not None:
                        stack.append(t); hit = True
                        break
                if not hit:
                    under = listdir(q)
                    if under is not None:
                        stack.extend(under); hit = True
                if hit:
                    break
            else:
                if c in specs and c.startswith('.'):
                    opens.append('%s: the relative import %r does not resolve' % (r, c[:80]))
    return seen, opens


def rerun_kind(f, changed, closure):
    """PURE. f: a failing test file's basename; changed: the change's paths; closure(rel) -> (paths, opens).
    -> ('touched' | 'imports' | 'clear', why)."""
    rel = 'bots/test/' + f
    if any(t == rel or t.endswith('/' + f) or t == f for t in changed):
        return 'touched', 'the change edits it'
    g = sorted(t for t in changed if is_global_test_input(t))
    if g:
        return 'touched', 'the change edits %s, which every test runs through' % ', '.join(g[:3])
    clos, opens = closure(rel)
    hit = sorted(set(clos) & set(changed))
    if hit:
        return 'imports', 'the change edits %s in its import closure (%d files)' % (', '.join(hit[:3]), len(clos))
    if opens:
        return 'imports', 'its import closure cannot be fully listed (%s)' % opens[0]
    return 'clear', 'none of the %d files in its import closure changed' % len(clos)


def next_rerun(kind, new, base, tries=AR_RERUN_TRIES):
    """PURE. The next alone run for one failing file: 'new' (the rebased tip), 'base', or None (decided).
    new / base: the results so far, each 'ok' | 'FAIL' | '?' (no completed answer)."""
    if '?' in new or '?' in base:
        return None
    if not new:
        return 'new'
    if new[0] == 'ok':
        return None
    if kind == 'touched':
        return None
    if kind == 'clear':
        if 'ok' in new:
            return None
        if len(new) < tries:
            return 'new'
        if 'ok' in base or len(base) >= tries:
            return None
        return 'base'
    if 'FAIL' in base and 'ok' in new:              # imports: flaky on both sides -- decided
        return None
    if len(base) >= tries:
        return None
    return 'base' if len(base) < len(new) else 'new'


def file_verdict(kind, new, base, tries=AR_RERUN_TRIES):
    """PURE. -> (status, text); status: 'pass' (ok alone at once), 'flake' (clear, passed alone on a retry), 'base' (the
    base fails it on this host too), 'refuse'."""
    rn = lambda xs: '%d/%d' % (xs.count('ok'), len(xs))
    if not new:
        return 'refuse', 'never re-run alone'
    if '?' in new or '?' in base:
        return 'refuse', 'no completed answer when re-run alone (timeout, crash or no result line): new %s, base %s' % (
            ','.join(new), ','.join(base) or '-')
    if new[0] == 'ok':
        return 'pass', 'ok alone'
    if kind == 'touched':
        return 'refuse', 'fails alone and the change touches it (no retry for a file the change touches)'
    if kind == 'clear' and 'ok' in new:
        return 'flake', 'host flake: passed alone on try %d of %d (the change touches nothing it imports)' % (
            new.index('ok') + 1, len(new))
    if len(base) >= tries and len(new) >= tries and set(base) == {'FAIL'} and set(new) == {'FAIL'}:
        return 'base', 'fails every alone run on the new tip (%d) AND on the base (%d)' % (len(new), len(base))
    if kind == 'imports' and 'FAIL' in base and 'ok' in new:
        return 'base', 'flaky on the base too: alone the new tip passed %s, the base %s' % (rn(new), rn(base))
    if not base:
        return 'refuse', 'fails alone on the new tip (passed %s) and was never run on the base' % rn(new)
    if 'ok' in new:
        return 'refuse', ('flaky alone on the new tip only (passed %s) while the base passed %s, and the change touches '
                          'what it imports' % (rn(new), rn(base)))
    return 'refuse', 'fails alone on the new tip (passed %s) and NOT on the base (passed %s)' % (rn(new), rn(base))


def test_verdict(full_rc, full, reruns, expected=None, max_base_fail=3):
    """PURE. Did the suite pass, base-relatively? full: {file: ok|FAIL} of the full run on the new tip; reruns: for each
    full-run failure {'kind', 'why', 'new': [...], 'base': [...], 'spent': bool} (the alone runs, see next_rerun);
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
    res, bad = {}, []
    for f in fails:
        r = reruns.get(f) or {}
        st, txt = file_verdict(r.get('kind') or 'touched', list(r.get('new') or []), list(r.get('base') or []))
        if st == 'refuse' and r.get('spent'):
            txt += ' [the re-run budget of %d min ran out]' % (AR_RERUN_BUDGET_S // 60)
        res[f] = (st, txt)
        if st == 'refuse':
            bad.append(f)
    summary = 'npm test %d/%d in the full run; re-run alone: %s' % (len(full) - len(fails), len(full), '; '.join(
        '%s [%s] new %s base %s -> %s' % (f, (reruns.get(f) or {}).get('kind', '?'), ','.join((reruns.get(f) or {}).get('new') or []) or '-',
                                         ','.join((reruns.get(f) or {}).get('base') or []) or '-', res[f][0]) for f in fails))
    if bad:
        return '; '.join('%s %s (%s)' % (f, res[f][1], (reruns.get(f) or {}).get('why', '')) for f in bad[:3]), summary
    based = [f for f in fails if res[f][0] == 'base']
    if len(based) > max_base_fail:
        return '%d files fail alone on both the new tip and the base (> %d): the host is not fit to judge' % (
            len(based), max_base_fail), summary
    flakes = [f for f in fails if res[f][0] == 'flake']
    out = summary
    if flakes:
        out += '; host flakes (passed alone on a retry, nothing they import changed): %s' % ', '.join(flakes)
    if based:
        out += '; failing on the BASE too on this host (not the change): %s' % ', '.join(based)
    if not flakes and not based:
        out += ' (all pass alone)'
    return '', out


def ar_backoff(P):
    try:
        return [max(0, int(x)) for x in str(P.get('ar_backoff') or '').split(',') if x.strip()] or [0]
    except ValueError:
        return [60, 180]


def ar_put(W, sha):
    if gitx(W, 'checkout', '-q', '--detach', sha)[0] != 0 or gitx(W, 'rev-parse', 'HEAD')[1].strip() != sha:
        raise ArRefuse('the worktree could not be put on %s for an alone re-run' % sha[:8])


def ar_reruns(P, job, run, base, nt, W, B, npm, fails, changed):
    """Each full-run failure re-run ALONE (TEST_JOBS=1, normal priority) as next_rerun plans it. The KIND of every file is
    decided first, on the new tip's tree. -> {file: {'kind', 'why', 'new', 'base', 'spent'}}."""
    ar_put(W, nt)

    def read(rel):
        q = os.path.join(W, rel)
        if not os.path.isfile(q):
            return None
        try:
            with open(q, encoding='utf-8', errors='replace') as fh:
                return fh.read()
        except OSError:
            return None

    def listdir(rel):
        q = os.path.join(W, rel)
        if not rel or not os.path.isdir(q):
            return None
        out = []
        for dp, dns, fns in os.walk(q):
            dns[:] = [x for x in dns if x not in ('node_modules', '.git')]
            out += [os.path.relpath(os.path.join(dp, x), W) for x in fns]
            if len(out) > 20000:
                break
        return out

    kinds = {}
    for f in fails:
        kinds[f] = rerun_kind(f, changed, lambda rel: import_closure(read, listdir, rel))
    logp = os.path.join(P['ar_home'], 'logs', '%s--%s.rerun.out' % (run, base[:12]))
    back = ar_backoff(P)
    t_end = time.time() + AR_RERUN_BUDGET_S
    out = {}

    def alone(f, sha):
        ar_put(W, sha)
        rc1, o1 = run_cmd([npm, 'test', '--', f], B, AR_RERUN_TIMEOUT_S, {'TEST_JOBS': '1'})
        r1 = test_results(o1).get(f, '?')
        # the file's own result line decides (the runner's filter is a substring: well.test.mjs also runs minewell);
        # 'FAIL' needs a completed failing run (non-zero exit, not this kill), anything else is no answer ('?')
        ans = 'ok' if r1 == 'ok' else ('FAIL' if r1 == 'FAIL' and rc1 not in (0, 124) else '?')
        with open(logp, 'a') as fh:
            fh.write('\n===== %s %s alone on %s (%s): rc %s -> %s\n' % (iso(now()), f, sha[:8],
                                                                      'new tip' if sha == nt else 'base', rc1, ans))
            fh.write(o1[-200000:])
        return ans

    for f in fails:
        kind, why = kinds[f]
        r = {'kind': kind, 'why': why, 'new': [], 'base': [], 'spent': False}
        while True:
            side = next_rerun(kind, r['new'], r['base'])
            if side is None:
                break
            if time.time() > t_end:
                r['spent'] = True
                break
            if side == 'new' and r['new']:
                time.sleep(back[min(len(r['new']) - 1, len(back) - 1)])
            r[side].append(alone(f, nt if side == 'new' else base))
        st, txt = file_verdict(kind, r['new'], r['base'])
        job.step('rerun', '%s [%s: %s] new %s base %s -> %s: %s' % (f, kind, why, ','.join(r['new']) or '-',
                                                                    ','.join(r['base']) or '-', st, txt))
        out[f] = r
    ar_put(W, nt)
    return out


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


def _ar_repo(P, S, shas):
    """Step 2: the scratch repo (a bare clone of origin, plus the deploy repo for anything origin lacks) holding shas."""
    R = os.path.join(P['ar_home'], 'repo.git')
    if not os.path.isdir(R):
        rc, _, err = gitx(P['ar_home'], 'clone', '-q', '--bare', P['ar_origin'], R, timeout=1800)
        if rc != 0:
            raise ArRefuse('clone of %s failed: %s' % (P['ar_origin'], err.strip()[-200:]))
    rc, _, err = gitx(R, 'fetch', '-q', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*', timeout=1800)
    if rc != 0:
        raise ArRefuse('fetch from %s failed: %s' % (P['ar_origin'], err.strip()[-200:]))
    have = lambda x: gitx(R, 'cat-file', '-e', '%s^{commit}' % x)[0] == 0
    if not all(have(x) for x in shas):
        # the deploy repo is root-owned: a local fetch runs upload-pack with the -c config cleared, so name it there
        gitx(R, 'fetch', '-q', '--upload-pack=git -c safe.directory=* upload-pack', P['git'], '+HEAD:refs/deploy/HEAD',
             '+refs/remotes/origin/*:refs/deploy/origin/*', timeout=1800)
    miss = [x[:8] for x in shas if not have(x)]
    if miss:
        raise ArRefuse('commits %s are in neither origin nor the deploy repo' % ', '.join(miss))
    S('repo', R)
    return R


def _ar_worktree(P, S, R, run, base):
    """Step 4: a scratch worktree on the live base; npm ci; the movement lint on the base."""
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
    return W, B, npm, nice, rc_mb, out_mb


def _ar_suite(P, job, run, base, nt, W, B, npm, nice, files, rc_mb, out_mb):
    """Step 8: eslint, the movement lint no worse than the base, the full suite with v40's adjudication -> summary."""
    S = job.step
    rc, out = run_cmd(nice + [npm, 'run', 'lint'], B, 900)
    if rc != 0:
        raise ArRefuse('eslint (npm run lint, no-undef) fails on the new tip: %s' % ' '.join(out.split())[-300:])
    rc_mv, out_mv = run_cmd(nice + [npm, 'run', 'lint:movement'], B, 600)
    if rc_mv != 0 and (rc_mb == 0 or not movement_fails(out_mv) or not movement_fails(out_mv) <= movement_fails(out_mb)):
        raise ArRefuse('the movement-writer lint is worse on the new tip (rc %s, FAIL %s) than on the base (rc %s, FAIL %s)'
                       % (rc_mv, sorted(movement_fails(out_mv)), rc_mb, sorted(movement_fails(out_mb))))
    S('lint', 'eslint ok; movement lint rc %s (base rc %s)' % (rc_mv, rc_mb))
    S('full-suite', 'npm test (full, nice 10) starting on %s' % nt[:8])
    rc_t, out_t = run_cmd(nice + [npm, 'test'], B, AR_TEST_TIMEOUT_S)
    with open(os.path.join(P['ar_home'], 'logs', '%s--%s.npmtest.out' % (run, base[:12])), 'w') as f:
        f.write(out_t)
    full = test_results(out_t)
    fails = sorted(f for f, r in full.items() if r != 'ok')
    reruns = {}
    if fails and len(fails) <= AR_MAX_RERUN:
        reruns = ar_reruns(P, job, run, base, nt, W, B, npm, fails, files)
    expected = len(glob.glob(os.path.join(B, 'test', '*.test.mjs')))
    why, summary = test_verdict(rc_t, full, reruns, expected)
    if why:
        raise ArRefuse('npm test: %s (%s)' % (why, summary))
    S('tests', summary)
    return summary


def _ar_publish(P, S, R, run, base, nt):
    """Steps 9-10: branch autorebase/<run>-on-<base8>, pushed (relay or direct), on origin, fetched into the deploy repo."""
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
    return branch


def _ar_add_variant(P, S, run, base, nt, regp, approved, reads_src):
    """Step 12: `queue add-variant`, through the same validation as a hand-added variant."""
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = cmd_queue(P, ['add-variant', '--reads-src', reads_src, run, base, regp, approved])
    if rc != 0:
        raise ArRefuse('queue add-variant refused: %s' % ' '.join(buf.getvalue().split())[-400:])
    S('variant', 'queued %s for %s' % (nt[:8], base[:8]))


def ar_read_plan(P, gdir, base, nt, tier, reg):
    """(plan, why it is not fast | '') for base..nt in repo gdir."""
    if os.path.exists(P['fast_off']):
        return STD_READS, '%s present' % P['fast_off']
    rc, txt, err = gitx(gdir, *DIFF_ARGS, base, nt)
    if rc != 0:
        return STD_READS, 'git diff failed: %s' % err.strip()[-120:]
    why = fast_problem(txt, tier, reg, bool(reg.get('bundle')))
    return (STD_READS, why) if why else (FAST_READS, '')


def load_prot(gdir, rev):
    """The scripts/lib/protected.py OF `rev` (git show), imported from a temp copy: the base decides, never the change."""
    rc, txt, err = gitx(gdir, 'show', '%s:scripts/lib/protected.py' % rev)
    if rc != 0:
        raise RuntimeError('scripts/lib/protected.py is absent at %s: %s' % (rev[:8], err.strip()[-120:]))
    d = tempfile.mkdtemp(prefix='sched-protmod-')
    try:
        fp = os.path.join(d, 'protected_at_%s.py' % rev[:12])
        with open(fp, 'w') as f:
            f.write(txt)
        import importlib.util
        spec = importlib.util.spec_from_file_location('protected_at_%s' % rev[:12], fp)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    finally:
        shutil.rmtree(d, ignore_errors=True)


def member_footprint(gdir, prot, a, b):
    """(footprint, declared names, used names) of the change a..b in repo gdir, read with the base's protected module."""
    rc, txt, err = gitx(gdir, 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', a, b)
    if rc != 0:
        raise RuntimeError('git diff -U0 %s %s failed: %s' % (a[:8], b[:8], err.strip()[-160:]))
    revs = {'old': a, 'new': b}

    def read(side, path):
        rc2, out, _ = gitx(gdir, 'show', '%s:%s' % (revs[side], path))
        return out if rc2 == 0 else None
    fp = fp_tokens(prot.parse_diff(txt), read, prot)
    decl, used = diff_names(txt)
    return fp, decl, used


def _ar_bundle_steps(P, job, q, e, base, token):
    """v41: compose a BUNDLE on the live base (see the module docstring). Every refusal raises ArRefuse."""
    S = job.step
    run, b = e['run'], e.get('bundle') or {}
    bad = bundle_problem(e)
    if bad or b['plan_sha256'][:40] != token:
        raise ArRefuse('the bundle entry changed or is malformed (%s)' % (bad or 'plan %s, job %s' % (b.get('plan_sha256'), token)))
    if base in (e.get('variants') or {}):
        raise ArRefuse('a variant for %s already exists: nothing to build' % base[:8])
    ents = q.get('entries') or []
    ms = []
    for r in b['members']:
        hit = [x for x in ents if x.get('run') == r]
        if len(hit) != 1:
            raise ArRefuse('member %s is not queued exactly once' % r)
        m = hit[0]
        if m.get('bundled_in') != run:
            raise ArRefuse('member %s is not reserved by %s (bundled_in %r)' % (r, run, m.get('bundled_in')))
        pt = m.get('patch') or {}
        if patch_problem(pt):
            raise ArRefuse('member %s: %s' % (r, patch_problem(pt)))
        src = (m.get('variants') or {}).get(pt['base']) or {}
        if src.get('canary_sha') != pt['tip'] or approval_problem(src.get('approved'), False):
            raise ArRefuse('member %s: its source variant is not the patch tip or names no reviewer' % r)
        if src.get('reads'):
            raise ArRefuse('member %s pins reads %s: a bundle reads generically only (v41)' % (r, sorted(src['reads'])))
        try:
            if sha256(src['registration']) != src.get('registration_sha256'):
                raise ArRefuse('member %s: its registration changed since it was queued' % r)
            with open(src['registration']) as f:
                reg = json.load(f)
        except ArRefuse:
            raise
        except Exception as x:
            raise ArRefuse('member %s: registration unreadable: %s' % (r, x))
        ms.append({'run': r, 'entry': m, 'pt': pt, 'src': src, 'reg': reg})
    plan = plan_hash([{'run': m['run'], 'base': m['pt']['base'], 'tip': m['pt']['tip'], 'diff_sha256': m['pt']['diff_sha256'],
                       'registration_sha256': m['src'].get('registration_sha256'),
                       'couples_with': m['entry'].get('couples_with') or []} for m in ms])
    if plan != b['plan_sha256']:
        raise ArRefuse('the members changed since `bundle make` (plan %s, queued %s): make a new bundle' % (plan[:12], b['plan_sha256'][:12]))
    S('entry', 'bundle %s = %s (plan %s)' % (run, ' + '.join(b['members']), plan[:16]))
    R = _ar_repo(P, S, [base] + [x for m in ms for x in (m['pt']['base'], m['pt']['tip'])])
    PR = dict(P, git=R)
    for m in ms:
        pt = m['pt']
        m['commits'], why = linear_range(R, pt['base'], pt['tip'])
        if why:
            raise ArRefuse('member %s: %s' % (m['run'], why))
        h0, m['files'] = diff_hash(R, pt['base'], pt['tip'])
        if h0 != pt['diff_sha256']:
            raise ArRefuse('member %s: the source range no longer has the queued diff (%s vs %s)' % (m['run'], h0[:12], pt['diff_sha256'][:12]))
        m['tier'] = tier_label(*protected_run(PR, pt['base'], pt['tip']))
        m['stacked'] = gitx(R, 'merge-base', '--is-ancestor', pt['base'], base)[0] != 0
        mp = member_problem({'entry': {k: v for k, v in m['entry'].items() if k != 'bundled_in'}, 'state': 'ready', 'reg': m['reg'], 'tier': m['tier'],
                             'stacked': m['stacked'], 'files': m['files']})
        if mp:
            raise ArRefuse('member %s is not bundleable: %s' % (m['run'], mp))
    S('reviewed-diff', '; '.join('%s %d commit(s) tier %s' % (m['run'], len(m['commits']), m['tier']) for m in ms))
    W, B, npm, nice, rc_mb, out_mb = _ar_worktree(P, S, R, run, base)
    cur = base
    for m in ms:
        _, cd, _ = gitx(R, 'log', '-1', '--format=%ct', m['pt']['tip'])
        if not re.match(r'^\d+$', cd.strip()):
            raise ArRefuse('cannot read the committer time of %s' % m['pt']['tip'][:8])
        env_pin = {'GIT_COMMITTER_NAME': 'canary-sched autorebase', 'GIT_COMMITTER_EMAIL': 'autorebase@mcai.invalid',
                   'GIT_COMMITTER_DATE': '@' + cd.strip() + ' +0000'}
        rcp, o1, e1 = gitx(W, '-c', 'user.name=canary-sched autorebase', '-c', 'user.email=autorebase@mcai.invalid',
                           '-c', 'commit.gpgsign=false', '-c', 'rerere.enabled=false', 'cherry-pick', '-x',
                           '--allow-empty-message', *m['commits'], timeout=600, env_extra=env_pin)
        if rcp:
            _, um, _ = gitx(W, 'diff', '--name-only', '--diff-filter=U')
            gitx(W, 'cherry-pick', '--abort')
            raise ArRefuse('member %s does not apply cleanly on top of %s: conflict in %s'
                           % (m['run'], ' + '.join(x['run'] for x in ms[:ms.index(m)]) or 'the base', ', '.join(um.split()) or '?'))
        nt = gitx(W, 'rev-parse', 'HEAD')[1].strip()
        picked, why = linear_range(R, cur, nt)
        if why or len(picked) != len(m['commits']):
            raise ArRefuse('member %s: %d commits picked, %d in its source (%s)' % (m['run'], len(picked), len(m['commits']), why or 'an empty pick?'))
        hi, _ = diff_hash(R, cur, nt)
        if hi != m['pt']['diff_sha256']:
            raise ArRefuse('member %s: its diff inside the bundle is NOT its reviewed diff (%s vs %s): an earlier member or the '
                           'base changed lines in or beside it' % (m['run'], hi[:12], m['pt']['diff_sha256'][:12]))
        m['prev'], m['tip_in_bundle'] = cur, nt
        cur = nt
    S('compose', 'picked in order onto %s -> %s; every member diff identical to its reviewed one' % (base[:8], cur[:8]))
    tc = tier_label(*protected_run(PR, base, cur))
    if tc != 'none':
        raise ArRefuse('the COMPOSED bundle is protected tier %s on %s (each member was none): the members together touch '
                       'protected scope' % (tc, base[:8]))
    try:
        prot = load_prot(R, base)
        for m in ms:
            m['fp'], m['decl'], m['used'] = member_footprint(R, prot, m['prev'], m['tip_in_bundle'])
    except Exception as x:
        raise ArRefuse('the footprints could not be computed (fail closed): %s: %s' % (type(x).__name__, x))
    probs = []
    for i, a in enumerate(ms):
        for c in ms[i + 1:]:
            probs += ['%s + %s: %s' % (a['run'], c['run'], p) for p in pair_problems(a, c)]
    if probs:
        raise ArRefuse('the members are related in the composed tree: %s' % '; '.join(probs)[:600])
    S('footprints', 'composed tier none; pairwise disjoint on the incremental diffs (%s)'
      % '; '.join('%s %d token(s)' % (m['run'], len(m['fp'])) for m in ms))
    files = diff_hash(R, base, cur)[1]
    summary = _ar_suite(P, job, run, base, cur, W, B, npm, nice, files, rc_mb, out_mb)
    branch = _ar_publish(P, S, R, run, base, cur)
    reg = bundle_registration(run, cur, base, plan, [
        {'run': m['run'], 'reg': m['reg'], 'diff_sha256': m['pt']['diff_sha256'], 'tip_in_bundle': m['tip_in_bundle'],
         'approved': m['src'].get('approved'), 'registration_sha256': m['src'].get('registration_sha256'),
         'files': m['files']} for m in ms], iso(now()))
    reg['notes'] += (' Composed by canary-sched v41 on branch %s: each member picked in order with its normalized diff '
                     'identical; composed tier none; footprints disjoint; eslint ok; %s. Why it composes (operator): %s'
                     % (branch, summary, str(b.get('why') or '')[:600]))
    regp = os.path.join(os.path.dirname(os.path.abspath(ms[0]['src']['registration'])), '%s.%s.json' % (run, cur[:8]))
    if os.path.exists(regp):
        raise ArRefuse('%s already exists: reconcile it by hand' % regp)
    with open(regp + '.tmp', 'w') as f:
        json.dump(reg, f, indent=1); f.write('\n')
    os.replace(regp + '.tmp', regp)
    S('registration', regp)
    approved = 'BUNDLE (canary-sched v41) of %s onto %s, each member reviewed alone: %s' % (
        ' + '.join(m['run'] for m in ms), base[:8], ' || '.join('%s [%s]' % (m['run'], str(m['src'].get('approved'))[:300]) for m in ms))
    _ar_add_variant(P, S, run, base, cur, regp, approved, os.path.join(P['home'], 'mcai-analysis'))
    gitx(R, 'worktree', 'remove', '--force', W)
    shutil.rmtree(W, ignore_errors=True)
    return {'variant': cur, 'branch': branch, 'registration': regp, 'tests': summary}


def _ar_steps(P, job, run, base, tip):
    S = job.step
    # 1. the entry and its declared change
    q = load_queue(P)
    hit = [e for e in q.get('entries') or [] if e.get('run') == run]
    if len(hit) != 1:
        raise ArRefuse('%s is not queued exactly once' % run)
    e = hit[0]
    if e.get('bundle') is not None:
        return _ar_bundle_steps(P, job, q, e, base, tip)
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
    R = _ar_repo(P, S, (pt['base'], tip, base))
    # 3. the change is linear and is the one reviewed
    commits, why = linear_range(R, pt['base'], tip)
    if why:
        raise ArRefuse(why)
    h0, files = diff_hash(R, pt['base'], tip)
    if h0 != pt['diff_sha256']:
        bad = patch_repair_problem(pt, src)
        if bad:
            raise ArRefuse('the source range %s..%s no longer has the queued diff (sha256 %s, queued %s), and it cannot be '
                           'recomputed: %s' % (pt['base'][:8], tip[:8], h0[:12], pt['diff_sha256'][:12], bad))
        old = pt['diff_sha256']

        def fix(q):
            hit = [x for x in q.get('entries') or [] if x.get('run') == run and (x.get('patch') or {}).get('tip') == tip
                   and (x.get('patch') or {}).get('diff_sha256') == old]
            for x in hit:
                x['patch']['diff_sha256'] = h0
                x['patch']['repaired'] = {'at': iso(now()), 'old': old, 'by': 'canary-sched v42 autorebase'}
            return len(hit)
        if with_queue(P, fix) != 1:
            raise ArRefuse('the queued patch changed while its hash was being repaired: nothing written')
        append_state(P, {'state': 'patch-hash-repaired', 'run': run, 'base': pt['base'], 'tip': tip, 'old': old, 'new': h0})
        ar_page(P, 'flag', run, '%s patch diff_sha256 RECOMPUTED %s -> %s from the approved variant %s..%s (the '
                'stored hash was not git\'s); the rebased diff must still equal it' % (run, old[:12], h0[:12],
                                                                                     pt['base'][:8], tip[:8]))
        S('reviewed-diff-repaired', 'stored %s, git %s: recomputed (approved variant %s..%s)' % (old[:12], h0[:12],
                                                                                               pt['base'][:8], tip[:8]))
    S('reviewed-diff', '%d commit(s), %d file(s), normalized diff sha256 %s' % (len(commits), len(files), h0[:16]))
    # 4. a scratch worktree on the live base; node modules; the movement lint on the base (its own known state)
    W, B, npm, nice, rc_mb, out_mb = _ar_worktree(P, S, R, run, base)
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
    summary = _ar_suite(P, job, run, base, nt, W, B, npm, nice, files, rc_mb, out_mb)
    # 9. the branch, pushed (relay or direct), confirmed by ls-remote; 10. the deploy repo resolves it
    branch = _ar_publish(P, S, R, run, base, nt)
    # 11. the registration: the source variant's, re-pointed
    with open(src['registration']) as f:
        reg = json.load(f)
    reg['sha'] = nt
    reg['registered_at'] = iso(now())
    note = ('[AUTOREBASE] %s @ %s on fleet base %s (branch %s): canary-sched cherry-picked %s..%s (%d commit(s), the '
            'reviewed variant on %s) with no conflicts; normalized diff identical (sha256 %s); protected tier %s '
            'unchanged; eslint ok; %s. ' % (run, nt[:8], base[:8], branch, pt['base'][:8], tip[:8], len(commits),
                                            pt['base'][:8], h1[:16], t1, summary))
    if reg.get('lab') is not True:
        # v41: the read plan is decided HERE, mechanically, on the diff that will deploy (H7 re-checks it at launch)
        plan, pwhy = ar_read_plan(P, R, base, nt, t1, reg)
        reg['fun_reads'] = plan
        note += 'Read plan %s (%s). ' % ('FAST +45/+90' if plan == FAST_READS else 'standard +90/+180',
                                         pwhy or 'fast_problem: eligible')
    reg['notes'] = note + str(reg.get('notes') or '')
    regp = os.path.join(os.path.dirname(os.path.abspath(src['registration'])), '%s.%s.json' % (run, nt[:8]))
    if os.path.exists(regp):
        raise ArRefuse('%s already exists: reconcile it by hand' % regp)
    with open(regp + '.tmp', 'w') as f:
        json.dump(reg, f, indent=1); f.write('\n')
    os.replace(regp + '.tmp', regp)
    S('registration', regp)
    # 12. the variant, through the same validation as a hand-added one
    approved = '%s || AUTOREBASE (canary-sched v40) onto %s: %s' % (src.get('approved') or '', base[:8], note.strip())
    _ar_add_variant(P, S, run, base, nt, regp, approved, reads_src)
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


def plan_problems(P, base, cs, reg, protected, is_bundle):
    """v41: the fun-mode read plan of a registration for base..cs: the value is one of READ_PLANS, a FAST plan is
    justified by fast_problem on the diff that will deploy, and a bundle runs the standard plan."""
    plan, _, why = read_plan(reg)
    if why:
        return [why]
    if plan != FAST_READS:
        return []
    if is_bundle or reg.get('bundle'):
        return ['a bundle must run the standard plan %r, not %r' % (STD_READS, plan)]
    if os.path.exists(P['fast_off']):
        return ['the FAST plan is off (%s present): re-register with fun_reads %r' % (P['fast_off'], STD_READS)]
    rc, txt, err = gitx(P['git'], *DIFF_ARGS, base, cs)
    if rc != 0:
        return ['git diff %s..%s failed (%s): the fast plan cannot be justified' % (base[:7], cs[:7], err.strip()[-120:])]
    fp = fast_problem(txt, 'none' if protected is False else '3 or undecidable', reg, False)
    return ['fun_reads %r is not justified: %s' % (plan, fp)] if fp else []


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
                bad += ['variant %s: %s' % (k[:7], x) for x in plan_problems(P, k, cs, r, prot, bool(e.get('bundle')))]
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


def reserved_problem(P, run):
    """v41 (Claude review r1 BLOCKER): a member reserved by a bundle (`bundled_in`) is FROZEN -- a hold, not-before,
    cancel, replace-variant or set-patch on it would not reach the bundle that ships it. '' = not reserved."""
    q = load_queue(P)
    hit = [x for x in q.get('entries') or [] if x.get('run') == run and x.get('bundled_in')]
    if hit:
        return ('REFUSED: %s is reserved by bundle %s: `canary-sched.py bundle split %s <why>` first (then edit it as a '
                'single run)' % (run, hit[0]['bundled_in'], hit[0]['bundled_in']))
    return ''


def _cmd_queue(P, args):
    sub = args[0] if args else ''
    if sub in ('replace-variant', 'set-patch', 'hold', 'not-before') and len(args) >= 2 and reserved_problem(P, args[1]):
        print(reserved_problem(P, args[1])); return 2
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
        if hit[0].get('bundle') is not None:
            e2['bundle'] = hit[0]['bundle']
            try:
                with open(reg) as f:
                    rb = (json.load(f).get('bundle') or {})
            except Exception as x:
                print('REFUSED: registration unreadable: %s' % x); return 2
            if rb.get('plan_sha256') != hit[0]['bundle'].get('plan_sha256') or \
                    [m.get('run') for m in rb.get('members') or []] != hit[0]['bundle'].get('members'):
                print('REFUSED: %s is a bundle: the registration\'s bundle block (plan %s, members %s) is not the queued one '
                      '(plan %s, members %s)' % (run, str(rb.get('plan_sha256'))[:12], [m.get('run') for m in rb.get('members') or []],
                                                 str(hit[0]['bundle'].get('plan_sha256'))[:12], hit[0]['bundle'].get('members')))
                return 2
        if rs:
            e2['variants'][base]['reads_src'] = rs
        bad = validate_entry(P, e2, st['journal'])
        if e2.get('bundle') is not None and e2['variants'][base].get('protected') is not False:
            bad.append('a bundle variant must be protected tier none (%s)' % e2['variants'][base].get('protected_why'))
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
    if how in ('cancel', 'rearm', 'abandon') and reserved_problem(P, run):
        print(reserved_problem(P, run)); return 2
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
        pid = None
        if len(args) == 4 and args[2] == '--pid' and args[3].isdigit():
            pid, args = int(args[3]), args[:2]
        if len(args) != 2:
            print('usage: install-hold <owner> <minutes> [--pid <installer pid>]'); return 2
        owner, minutes = args[0], int(args[1])
        until = iso(now() + dt.timedelta(minutes=minutes))
        tmp = P['install_hold'] + '.tmp'
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        row = {'owner': owner, 'until': until, 'at': iso(now())}
        if pid:      # v42: the installer's own long-lived pid; the scheduler may release the hold once it is gone
            row.update(pid=pid, start=starttime(P, pid))
        with open(tmp, 'w') as f:
            json.dump(row, f)
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


# ----------------------------------------------------------------------------------------------- v41 bundles --
def bundle_facts(P, st, runs, prot=None):
    """Member facts for plan_bundle, from the deploy repo: each run's entry, state, registration, protected tier of its
    reviewed range (the source base's protected.py), stacked or not, and its footprint read with the LIVE base's lexer."""
    base = st.get('base_full')
    ents = {e.get('run'): e for e in (st.get('queue') or {}).get('entries') or []}
    if prot is None:
        prot = load_prot(P['git'], base)
    out = {}
    for r in runs:
        e = ents.get(r)
        if e is None:
            continue
        f = {'run': r, 'entry': e, 'state': entry_state(e, st), 'reg': None, 'tier': '?', 'stacked': True,
             'fp': set(), 'decl': set(), 'used': set(), 'files': []}
        pt = e.get('patch') or {}
        if not patch_problem(pt):
            src = (e.get('variants') or {}).get(pt['base']) or {}
            try:
                with open(src.get('registration') or '/nonexistent') as fh:
                    f['reg'] = json.load(fh)
            except Exception:
                f['reg'] = None
            f['tier'] = tier_label(*protected_run(P, pt['base'], pt['tip']))
            f['stacked'] = git(P, 'merge-base', '--is-ancestor', pt['base'], base)[0] != 0
            f['files'] = pt.get('files') or []
            try:
                f['fp'], f['decl'], f['used'] = member_footprint(P['git'], prot, pt['base'], pt['tip'])
            except Exception as x:
                f['fp'] = {('FILE', 'footprint unreadable: %s' % x)}
        out[r] = f
    return out


def bundle_suggest(st, facts_for):
    """A suggestion for status/plan: the first ready entry from the head that is bundleable, then each later ready entry
    that pairs with all chosen, stopping at the first entry a member may not jump. facts_for(runs) -> facts."""
    ents = (st.get('queue') or {}).get('entries') or []
    states = {e.get('run'): entry_state(e, st) for e in ents}
    cand = [e.get('run') for e in ents if states[e.get('run')] not in ('done', 'cancelled', 'bundled')]
    facts = facts_for(cand[:8])
    chosen = []
    for r in cand[:8]:
        if r not in facts:
            break
        if member_problem(facts[r], st.get('now')):
            if chosen and not jump_problem(facts[r]['entry'], states[r]):
                continue
            break
        if all(not pair_problems(facts[c], facts[r]) for c in chosen):
            chosen.append(r)
        if len(chosen) == BUNDLE_MAX:
            break
    return chosen if len(chosen) >= 2 else []


def _cmd_bundle(P, args):
    sub = args[0] if args else ''
    st = gather(P, full=False)
    if not st.get('base_full'):
        print('REFUSED: the fleet base cannot be resolved to a full sha'); return 2
    ents = (st.get('queue') or {}).get('entries') or []
    states = {e.get('run'): entry_state(e, st) for e in ents}
    if sub == 'plan':
        runs = args[1:]
        prot = load_prot(P['git'], st['base_full'])
        if not runs:
            runs = bundle_suggest(st, lambda rs: bundle_facts(P, st, rs, prot))
            if not runs:
                print('no bundle suggested from the head (fleet base %s): no two adjacent ready entries pass the checks; '
                      '`bundle plan <run> <run>` says why for a given pair' % st['base_full'][:8]); return 0
            print('SUGGESTED from the head: %s' % ' + '.join(runs))
        facts = bundle_facts(P, st, runs, prot)
        probs, notes, ordered, after = plan_bundle(runs, facts, ents, states, st['now'])
        for r in ordered:
            f = facts[r]
            print('  %s: tier %s, %s, %d footprint token(s): %s' % (r, f['tier'], 'STACKED' if f['stacked'] else 'on the fleet base',
                  len(f['fp']), ', '.join(sorted('%s:%s' % (t[1], t[2] if len(t) > 2 else t[0]) for t in f['fp'] if t[0] != 'TEST'))[:300]))
        for n in notes:
            print('  note: %s' % n)
        if probs:
            print('NOT BUNDLEABLE:\n  ' + '\n  '.join(probs)); return 1
        print('BUNDLEABLE: %s (outside after: %s); `bundle make <id> %s --why "<why they compose>"`'
              % (' + '.join(ordered), after or 'none', ' '.join(ordered))); return 0
    if sub == 'make' and len(args) >= 4:
        rest = args[1:]
        why = hold = None
        for flag in ('--why', '--hold'):
            if flag in rest:
                i = rest.index(flag)
                nxt = [j for j in range(i + 1, len(rest)) if rest[j].startswith('--')]
                val = ' '.join(rest[i + 1:nxt[0] if nxt else len(rest)])
                rest = rest[:i] + rest[nxt[0] if nxt else len(rest):]
                if flag == '--why':
                    why = val
                else:
                    hold = val or 'held'
        if not why or not why.strip():
            print('REFUSED: --why "<why these changes compose>" is required (it goes into the registration)'); return 2
        if len(rest) < 3:
            print('usage: bundle make <bundle_run> <run> <run> [<run>] --why <text> [--hold <text>]'); return 2
        brun, runs = rest[0], rest[1:]
        if not re.match(r'^[a-z0-9][a-z0-9._-]*$', brun) or brun in states or deployment(run_rows(st['journal'], brun))[0]:
            print('REFUSED: %r is not a new plain run id' % brun); return 2
        facts = bundle_facts(P, st, runs)
        probs, notes, ordered, after = plan_bundle(runs, facts, ents, states, st['now'])
        if probs:
            print('REFUSED (not bundleable):\n  ' + '\n  '.join(probs)); return 2
        meta = []
        for r in ordered:
            e = facts[r]['entry']
            pt = e['patch']
            meta.append({'run': r, 'base': pt['base'], 'tip': pt['tip'], 'diff_sha256': pt['diff_sha256'],
                         'registration_sha256': ((e.get('variants') or {}).get(pt['base']) or {}).get('registration_sha256'),
                         'couples_with': e.get('couples_with') or []})
        plan = plan_hash(meta)
        snap = {m['run']: json.dumps(facts[m['run']]['entry'], sort_keys=True) for m in meta}

        def mk(q):
            es = q['entries']
            if any(x.get('run') == brun for x in es):
                raise SystemExit('REFUSED: %s is already queued' % brun)
            for r in ordered:
                h = [x for x in es if x.get('run') == r]
                if len(h) != 1 or json.dumps(h[0], sort_keys=True) != snap[r]:
                    raise SystemExit('REFUSED: %s changed while the bundle was checked; run `bundle make` again' % r)
            first = min(i for i, x in enumerate(es) if x.get('run') in ordered)
            for x in es:
                if x.get('run') in ordered:
                    x['bundled_in'] = brun
            es.insert(first, {'run': brun, 'class': '', 'after': after, 'not_before': None, 'hold': hold,
                              'note': 'v41 BUNDLE of %s, made %s by %s: %s' % (' + '.join(ordered), iso(now()),
                                                                             os.environ.get('USER', '?'), why),
                              'variants': {},
                              'bundle': {'schema': 1, 'members': ordered, 'plan_sha256': plan, 'why': why,
                                         'made_at': iso(now()), 'base_at_make': st['base_full'], 'notes': notes}})
            return first
        try:
            at = with_queue(P, mk)
        except SystemExit as x:
            print(str(x)); return 2
        append_state(P, {'state': 'human', 'run': brun, 'how': 'bundle-make', 'why': why, 'members': ordered,
                         'plan': plan, 'by': os.environ.get('USER', '?')})
        print('queued bundle %s = %s at position %d (plan %s)%s; the autorebase composes it when it is the head'
              % (brun, ' + '.join(ordered), at + 1, plan[:16], ', HELD: %s' % hold if hold else '')); return 0
    if sub == 'split' and len(args) >= 3:
        rest = args[1:]
        holds = {}
        while '--hold' in rest:
            i = rest.index('--hold')
            if i + 1 >= len(rest) or '=' not in rest[i + 1]:
                print('usage: --hold <run>=<why>'); return 2
            r, w = rest[i + 1].split('=', 1)
            holds[r] = w or 'held'
            rest = rest[:i] + rest[i + 2:]
        brun, why = rest[0], ' '.join(rest[1:])
        be = bundle_entries(st).get(brun)
        if not why.strip():
            print('REFUSED: no <why>'); return 2
        if be is None:
            dang = [x.get('run') for x in ents if x.get('bundled_in') == brun]
            if not dang:
                print('REFUSED: %s is not a queued bundle and reserves nothing' % brun); return 2

            def clr(q):
                for x in q['entries']:
                    if x.get('bundled_in') == brun:
                        x.pop('bundled_in', None)
                        x.setdefault('bundle_history', []).append({'bundle': brun, 'outcome': 'dangling', 'split_at': iso(now()), 'why': why})
            with_queue(P, clr)
            append_state(P, {'state': 'human', 'run': brun, 'how': 'bundle-split', 'why': why, 'by': os.environ.get('USER', '?'),
                             'dangling': dang})
            print('split %s (not queued): cleared the dangling reservation of %s' % (brun, ', '.join(dang))); return 0
        o = bundle_outcome(be, st)
        js = journal_status(brun, st)
        deployed = deployment(run_rows(st['journal'], brun))[0] is not None
        if o == 'keep':
            print('REFUSED: %s was KEPT and promoted: its members are done' % brun); return 2
        if js == 'live' or entry_state(be, st) in ('running', 'launching') or (deployed and js != 'closed'):
            print('REFUSED: %s is live or deployed and not closed: close it first (its loop, or `closed`)' % brun); return 2
        if js == 'open':
            print('REFUSED: %s drew and is not resolved: `abandon %s <why>` first' % (brun, brun)); return 2
        members = (be.get('bundle') or {}).get('members') or []
        bad = [r for r in holds if r not in members]
        if bad:
            print('REFUSED: --hold names non-members %s' % bad); return 2
        for line in [r.get('note') for r in run_rows(st['journal'], brun) if str(r.get('phase', '')).startswith(('read-', 'poll-revert', 'contained', 'recorded'))]:
            print('  %s verdict: %s' % (brun, str(line)[:400]))
        for r in members:
            e = next((x for x in ents if x.get('run') == r), {})
            reg = None
            pt = e.get('patch') or {}
            try:
                with open(((e.get('variants') or {}).get(pt.get('base')) or {}).get('registration')) as f:
                    reg = json.load(f)
            except Exception:
                pass
            print('  member %s: change rows %s' % (r, sorted(row_names(reg)) if reg else '?'))

        def sp(q):
            for x in q['entries']:
                if x.get('run') in members and x.get('bundled_in') == brun:
                    x.pop('bundled_in', None)
                    x.setdefault('bundle_history', []).append({'bundle': brun, 'outcome': o, 'decision': run_decision(st, brun),
                                                               'split_at': iso(now()), 'why': why})
                    if x['run'] in holds:
                        x['hold'] = holds[x['run']]
        with_queue(P, sp)
        append_state(P, {'state': 'human', 'run': brun, 'how': 'bundle-split', 'why': why, 'by': os.environ.get('USER', '?'),
                         'holds': holds})
        if not deployed and o != 'void':
            append_state(P, {'state': 'human', 'run': brun, 'how': 'cancel', 'why': 'bundle split (never deployed): ' + why,
                             'by': os.environ.get('USER', '?')})
        print('split %s (%s): %s return as single runs%s' % (brun, o if deployed else 'never deployed', ', '.join(members),
                                                             '; held: %s' % holds if holds else '')); return 0
    print(__doc__); return 2


def cmd_bundle(P, args):
    return with_tick_lock(P, _cmd_bundle, args)


def cmd_status(P):
    st = gather(P, full=True)
    for e in (st.get('queue') or {}).get('entries') or []:
        pt = e.get('patch') or {}
        print('%-20s %-10s %-18s hold=%s not_before=%s after=%s variants=%s%s' % (
            e.get('run'), entry_state(e, st), e.get('class') or '-', e.get('hold'), e.get('not_before'), e.get('after'),
            ','.join(k[:7] for k in e.get('variants') or {}),
            ' patch=%s..%s' % (str(pt.get('base'))[:7], str(pt.get('tip'))[:7]) if pt else '') +
            (' bundled_in=%s' % e['bundled_in'] if e.get('bundled_in') else '') +
            (' bundle=%s' % '+'.join((e.get('bundle') or {}).get('members') or []) if e.get('bundle') is not None else ''))
    reserving = {e.get('bundled_in') for e in (st.get('queue') or {}).get('entries') or [] if e.get('bundled_in')}
    for b, be in sorted(bundle_entries(st).items()):
        o = bundle_outcome(be, st)
        if o in ('pending', 'failed') and b in reserving:
            print('BUNDLE %s: %s, members %s%s' % (b, o, ' + '.join((be.get('bundle') or {}).get('members') or []),
                                                  ' -- `bundle split %s <why>` returns them as singles' % b if o == 'failed' else ''))
    if st.get('ar_job'):
        j = st['ar_job']
        print('AUTOREBASE %s on %s: %s at step %s%s' % (j.get('run'), str(j.get('base'))[:8], j.get('state'), j.get('step'),
                                                       (' -- ' + str(j.get('why'))[:300]) if j.get('why') else ''))
    if st.get('r11_expired'):
        print('R11 EXPIRED (v37): %s closed %s on an unlinked death-driven REVERT (%s); >= %.0f h ago, so no hold'
              % (st['r11_expired'][0], st['r11_expired'][2], st['r11_expired'][1], R11_EXPIRE_H))
    for run, why in st.get('skipped') or []:
        print('SKIP %s' % why)
    if st.get('install_hold') is not None:
        print('INSTALL-HOLD auto-release: %s' % ('YES, ' + st['hold_release'][1] if st['hold_release'][0]
                                                 else (st['hold_release'][1] or 'no (live)')))
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
    if cmd == 'bundle':
        return cmd_bundle(P, argv[1:])
    if cmd == 'autorebase-clear':
        return with_tick_lock(P, _cmd_ar_clear, argv[1:])
    if cmd == 'autorebase-build' and len(argv) == 4:
        return ar_build(P, argv[1], argv[2], argv[3])
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
