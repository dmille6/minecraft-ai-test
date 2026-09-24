#!/usr/bin/env python3
"""
test_verdict_acceptance.py -- v23's REPLAY ACCEPTANCE SUITE.

Every case below is an incident that already happened on this fleet. Each one
states what the harness DID, what it SHOULD have done, and drives the real
`scripts/verdict.py` -- the file the canary loop runs, not a copy -- against
fixtures reconstructed from the ledger and the registration document.

WHY THE REAL FILE. `scripts/verdict.py` and `~/verdict.py` were found
disagreeing about the death rule on 2026-09-18, one carrying the point-ratio
test and the other the lower bound. A suite that exercises a copy proves
nothing about the copy that decides. `verdict.py` takes three environment
overrides for exactly this, and nothing in production sets them.

WHAT A PASS MEANS, AND WHAT IT DOES NOT. These cases pin the VERDICT, not the
prose. They are regression tests against six specific ways this harness has
already been wrong. They are not a proof that it is right in general, and a
green suite is not licence to let an uncalibrated rule revert anything.

Run: python3 scripts/test_verdict_acceptance.py
"""
import json, os, subprocess, sys, tempfile, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
# The file under test is overridable so the mutant runner can point this suite
# at a COPY. Mutants never write into the source: one that did, on this project,
# survived a SIGKILL on disk and was read as the real thing.
VERDICT = os.environ.get('ACCEPTANCE_VERDICT_PY') or os.path.join(HERE, 'verdict.py')
SHA, POOLS, RUN = 'abc1234', 'board-b,hive-a', 'acceptance-01'


def now(delta_min=0):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=delta_min)).isoformat()


def harm(canary_deaths=0, canary_bh=30.0, control_deaths=1, control_bh=210.0):
    """Since v24 verdict.py reads MEASURED exposure instead of reconstructing it by
    dividing counts by rates, so the fixture carries the bot-hours directly -- which is
    what immobiledid.py:200 actually emits, and always did.

    The rates are still carried, because they are printed and because a fixture that
    dropped them would stop replaying the producer. They are derived from the same
    exposure, never set independently: an earlier draft let the two disagree and the
    one-death case announced 30 bot-hours while its count and rate reconstructed 15."""
    return {'canary_deaths': canary_deaths,
            'canary_rate': (canary_deaths / canary_bh) if canary_bh else 0.0,
            'control_deaths': control_deaths,
            'control_rate': (control_deaths / control_bh) if control_bh else None,
            'canary_bot_h': canary_bh,
            'control_bot_h': control_bh}


def immobiledid(readable=True, v15c='OK', v11=None, **hk):
    # ONE DENOMINATOR. An earlier draft set the top-level `canary_bot_h` to a
    # default of 30 independently of `harm(canary_bh=...)`, so the one-death
    # case announced 30 bot-hours while its count and rate reconstructed 15.
    # The producer derives both from the same exposure; a fixture that does not
    # is not a replay of anything. (Codex, 2026-09-19.)
    bh = hk.get('canary_bh', 30.0)
    kbh = hk.get('control_bh', 210.0)
    return {'readable': readable, 'canary_bot_h': bh, 'control_bot_h': kbh,
            'harm': harm(**hk), 'v15c': {'verdict': v15c},
            'v11': v11 or {'climbs': 0.0, 'livelock': 0.0, 'ladders_p90': 8}}


class Case:
    """One incident, as a temporary world: a manifest, a registration and a set
    of evidence objects. Nothing touches the real host."""

    def __init__(self, tmp, reg_extra=None, manifest_extra=None):
        self.d = tempfile.mkdtemp(dir=tmp)
        self.reads = os.path.join(self.d, 'reads'); os.makedirs(self.reads)
        self.logs = os.path.join(self.d, 'logs'); os.makedirs(self.logs)
        self.regs = os.path.join(self.d, 'regs'); os.makedirs(self.regs)
        self.man = dict({'run_id': RUN, 'canary_pool': POOLS, 'canary_code_version': SHA,
                         'declared_code_version': 'base000',
                         'declared_at': now(-200)}, **(manifest_extra or {}))
        self.manp = os.path.join(self.d, 'manifest.json')
        json.dump(self.man, open(self.manp, 'w'))
        self.reg = dict({'sha': SHA, 'reads': ['immobiledid'], 'read_minutes': [30, 180],
                         'own_lines': [], 'change_rows': [], 'exposure': None}, **(reg_extra or {}))
        json.dump(self.reg, open(os.path.join(self.regs, f'{RUN}.json'), 'w'))

    def evidence(self, name, fields, M=180, **override):
        o = dict({'sha': SHA, 'pools': POOLS, 'run_id': RUN,
                  'declared_at': self.man['declared_at'], 'window_min': M,
                  'emitted_at': now(-2), 'fields': fields}, **override)
        json.dump(o, open(os.path.join(self.reads, f'{RUN}-{name}-{M}.json'), 'w'))
        return self

    def log(self, bot, rows):
        """Write a bot's skill log. THE LINKAGE RULES DO NOT READ THE EVIDENCE
        OBJECTS -- verdict.py rescans the pools' own logs since declared_at, so
        a case about a change row or a rung-linked death is not testing anything
        unless those logs exist. The first draft of this suite got a green
        `one canary death` case with no logs at all, and its mutant survived."""
        d = os.path.join(self.logs, bot); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'skill-1.jsonl'), 'a') as f:
            for ts, kind, detail in rows:
                f.write(json.dumps({'@timestamp': ts, 'bot': {'name': bot},
                                    'skill': {'name': kind, 'detail': detail}}) + '\n')
        return self

    def run(self, M=180, poll=False):
        env = dict(os.environ, VERDICT_READS_DIR=self.reads, VERDICT_LOG_ROOT=self.logs,
                   VERDICT_REG_DIR=self.regs, VERDICT_MANIFEST=self.manp)
        cmd = [sys.executable, VERDICT, RUN, str(M)] + (['--poll'] if poll else [])
        r = subprocess.run(cmd, capture_output=True, text=True, env=env,
                           cwd=HERE, timeout=120)
        line = (r.stdout or r.stderr).strip().splitlines()
        if not line:
            return 'NO_OUTPUT', (r.stderr or '')[-400:]
        head = line[-1]
        if not head.startswith('VERDICT '):
            return 'CRASH', head
        # THE EXIT STATUS AND THE ARTIFACT ARE PART OF THE ANSWER. `verdict.py`
        # exits 0 and writes <run>-verdict-<M>.json; the canary loop reads both.
        # Checking only the stdout token would let a stub that printed the right
        # word and exited 1 pass every case below. (Codex, 2026-09-19.)
        if r.returncode != 0:
            return f'EXIT{r.returncode}', head
        # ...AND THE ARTIFACT IS PARSED, NOT MERELY COUNTED. Existence alone
        # would accept an empty file, a `{}`, or the same object written for
        # every case -- and the canary loop reads this object, not the stdout
        # line. It must agree with stdout and be bound to this run and window.
        ap = os.path.join(self.reads, f'{RUN}-verdict-{M}.json')
        try:
            a = json.load(open(ap))
        except Exception as e:
            return f'BAD_ARTIFACT({type(e).__name__})', head
        v = head.split()[1]
        if a.get('verdict') != v or a.get('run_id') != RUN or a.get('window_min') != M:
            return 'ARTIFACT_MISMATCH', f"{head} :: artifact {a.get('run_id')}/{a.get('window_min')}={a.get('verdict')}"
        return v, head


RESULTS = []


def check(name, got, want, note, detail=''):
    ok = got == want
    RESULTS.append(ok)
    print(f"CASE\t{name}\t{got}\t{want}")          # machine-readable, for the mutant runner
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: got {got}, want {want}")
    print(f"         {note}")
    if not ok:
        print(f"         OUTPUT: {detail}")


def main():
    tmp = tempfile.mkdtemp(prefix='verdict-acceptance-')
    print(f"replaying into {tmp}\n")

    # ---- POSITIVE CONTROL, FIRST. A clean canary must reach KEEP. Without it
    # every "did not revert" below could be a harness that cannot reach any
    # verdict at all, which is precisely the failure this suite exists to catch.
    print("0. POSITIVE CONTROL -- a clean canary reaches a verdict")
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid())
    got, out = c.run()
    check('clean canary', got, 'KEEP',
          'If this is not KEEP, nothing below means anything: every other case '
          'asserts a verdict, and a harness that always says UNREADABLE would pass most of them.',
          out)

    # ---- 1. owner-01, 2026-09-18 12:59Z. SHIPPED INERT.
    # OWNER=1 never reached the process; 97 minutes ran the baseline under a new
    # sha with every other signal green (sha split confirmed, suite 192/192,
    # preflight passed, 0 canary deaths). The only tell was exposure = 0 against
    # an expectation of ~22 episodes. An inert build must not be able to reach
    # KEEP -- a KEEP here would promote a change that never ran.
    print("\n1. INERT DEPLOYMENT (owner-01) -- an invalid experiment, not an efficacy result")
    c = Case(tmp, reg_extra={'reads': ['immobiledid', 'ownerread'],
                             'exposure': {'read': 'ownerread', 'field': 'episodes_canary', 'min': 1}})
    c.evidence('immobiledid', immobiledid())
    c.evidence('ownerread', {'episodes_canary': 0})
    got, out = c.run()
    check('zero exposure', got, 'INCONCLUSIVE',
          'owner-01 ran 97 min inert with every other check green. Zero exposure closes the '
          'experiment as invalid; it must never read as a clean KEEP.', out)

    # ---- 1b. UNDEFINED MOVEMENT GUARDS (2026-09-23). immobiledid builds its breach list
    # with `if v == v and v < lim`, where `v == v` is the NaN test -- so a guard that could
    # not be computed was SKIPPED, the breach list came back empty, and the verdict string
    # was 'all within'. verdict.py matched neither REVERT nor WATCH on an UNREADABLE string
    # and fell through to KEEP. A guard that cannot be computed cannot fail.
    #
    # rdid() divides canary post/pre by control post/pre, and `readable` only checks the
    # canary POST cell, so a canary declared just after a fleet restart can be readable with
    # all three guards undefined.
    #
    # Calibrated before the change: 37 immobiledid evidence objects on disk, ZERO with an
    # undefined guard. Reachable by construction, never observed to fire -- fixed because it
    # is latent, and this case exists so it stays fixed.
    print("\n1b. UNDEFINED MOVEMENT GUARDS -- not computable is not within limits")
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(
        v15c='UNREADABLE (v15c: all of blocks moved/bh, working share, items gathered/bh '
             'are undefined -- a guard that cannot be computed cannot fail, so this is not '
             '"all within")'))
    got, out = c.run()
    check('v15c guards all undefined', got, 'UNREADABLE',
          'Three undefined guards used to produce the string "all within" and reach KEEP. '
          'When none of the calibrated decision is available the verdict must say so.', out)

    # ---- 1c. A REGISTERED FRICTION RULE (2026-09-23). The registration format has allowed
    # a `friction` section since it existed, and verdict.py never contained the string --
    # so every friction rule ever written silently did not run. recovery-ladder-1011b
    # registered one (pocketread hold_release canary vs control, pp>= -0.3, on_fail WATCH)
    # and that canary was read as though a registered guard had passed.
    #
    # The deeper problem was invisibility: nothing in a KEEP said which registered sections
    # it did NOT cover, so an unimplemented section looked exactly like a passing one.
    print("\n1c. A REGISTERED FRICTION RULE -- a declared guard must actually run")
    c = Case(tmp, reg_extra={'reads': ['immobiledid', 'pocketread'],
                             'friction': [{'read': 'pocketread',
                                           'field': 'hold_release_canary_post',
                                           'vs': 'hold_release_control_post',
                                           'op': 'pp>=', 'value': -0.3,
                                           'on_fail': 'REVERT'}]})
    c.evidence('immobiledid', immobiledid())
    c.evidence('pocketread', {'hold_release_canary_post': 0.10,
                              'hold_release_control_post': 0.80})
    got, out = c.run()
    # v25 (2026-09-24): the rule still RUNS and still FAILS -- that is what this case was
    # written to prove and it still proves it. What changed is the verdict. A typed
    # threshold that declares no evidence class no longer reverts, because that section was
    # the largest single cause of the 7 confirmed-false reverts in the ledger audit; it now
    # BLOCKS KEEP instead, which is the outcome the old code could not express. The REVERT
    # branch is case 1c-bis below, so both directions are covered.
    check('registered friction rule fails, with no evidence class', got, 'INCONCLUSIVE',
          'canary 0.10 against control 0.80 is -0.70, far past the registered -0.3 floor. '
          'Before this the section was simply not read and the canary reached KEEP; now it '
          'reaches neither KEEP nor REVERT.', out)
    check('  and the reason names the missing evidence class',
          'declares no evidence class' in out, True,
          'The verdict has to say WHY it did not revert, or this is indistinguishable '
          'from the section being unimplemented again.', out)

    # ---- 1c-bis. THE SAME RULE, WITH ITS EVIDENCE DECLARED, MUST STILL REVERT.
    # Two branches: a reproducible implementation defect (rl-08 14c662d, whose own new
    # instrument misfired 268 times out of 278 against a structurally empty baseline), and
    # a statistical harm claim carrying a randomization p inside its registered ceiling.
    print("\n1c-bis. THE SAME FRICTION RULE WITH A DECLARED EVIDENCE CLASS -- must revert")
    for extra, label in (({'evidence': 'defect'}, 'evidence=defect'),
                         ({'support': {'read': 'gatep', 'field': 'hold_p', 'max': 0.05}},
                          'support p=0.01 <= 0.05')):
        reads = ['immobiledid', 'pocketread'] + (['gatep'] if 'support' in extra else [])
        c = Case(tmp, reg_extra={'reads': reads,
                                 'friction': [dict({'read': 'pocketread',
                                                    'field': 'hold_release_canary_post',
                                                    'vs': 'hold_release_control_post',
                                                    'op': 'pp>=', 'value': -0.3,
                                                    'on_fail': 'REVERT'}, **extra)]})
        c.evidence('immobiledid', immobiledid())
        c.evidence('pocketread', {'hold_release_canary_post': 0.10,
                                  'hold_release_control_post': 0.80})
        if 'support' in extra: c.evidence('gatep', {'hold_p': 0.01})
        got, out = c.run()
        check(f'declared {label} still reverts', got, 'REVERT',
              'The fix must not cost the gate its ability to reject a change that is '
              'genuinely broken -- that is the failure mode that would make it worse '
              'than the bug it fixes.', out)

    # ---- 1c-ter. A SUPPORT p ABOVE ITS CEILING, OR MISSING, MUST NOT REVERT.
    print("\n1c-ter. A SUPPORT p OUTSIDE ITS CEILING -- INCONCLUSIVE, never REVERT")
    for pv, label in ((0.18, 'p=0.18 (leaf-01\'s measured value)'), (None, 'p absent')):
        c = Case(tmp, reg_extra={'reads': ['immobiledid', 'pocketread', 'gatep'],
                                 'friction': [{'read': 'pocketread',
                                               'field': 'hold_release_canary_post',
                                               'vs': 'hold_release_control_post',
                                               'op': 'pp>=', 'value': -0.3,
                                               'on_fail': 'REVERT',
                                               'support': {'read': 'gatep', 'field': 'hold_p',
                                                           'max': 0.05}}]})
        c.evidence('immobiledid', immobiledid())
        c.evidence('pocketread', {'hold_release_canary_post': 0.10,
                                  'hold_release_control_post': 0.80})
        c.evidence('gatep', {'hold_p': pv} if pv is not None else {})
        got, out = c.run()
        check(f'{label} does not revert', got, 'INCONCLUSIVE',
              "leaf-01's -0.5 line was crossed by 36-49% of its own window's null "
              'assignments at a measured p of 0.18. A threshold is not evidence.', out)

    # ---- 1d. A REGISTRATION WITHOUT immobiledid (2026-09-23). `im = ev['immobiledid']`
    # raised KeyError, and canary-loop.sh:54 captures stdout only, so the traceback went to
    # stderr and the loop journalled an EMPTY verdict and carried on.
    #
    # FOUND LIVE on banktruth-01, reads: ['banktruthread']. Its journal held
    # {"phase":"read-30","note":""}, {"phase":"read-90","note":""} and
    # {"phase":"read-180","note":""} -- three scheduled reads, three empty verdicts, four
    # and a half hours into a canary due that night. A loop that is alive and journalling
    # nothing looks exactly like a loop that is working.
    print("\n1d. A REGISTRATION MISSING immobiledid -- a crash must not read as silence")
    c = Case(tmp, reg_extra={'reads': ['ownerread']})
    c.evidence('ownerread', {'episodes_canary': 5})
    got, out = c.run()
    check('registration omits immobiledid', got, 'UNREADABLE',
          'immobiledid carries the death gate, the v15c movement guards and the readability '
          'test. Without it there is no safety floor -- a registration error, which must be '
          'said out loud rather than raised as a KeyError into a discarded stderr.', out)

    # ---- 2. evidence bound to the wrong run / gone stale.
    # The tier-1 analyst spent two days serving reads from FINISHED trials under
    # the heading "latest canary reads" (16 Sep - 18 Sep), and again on 19 Sep
    # through the manifest's stale run_id. verdict.py's own binding check is the
    # thing that must never make that mistake.
    print("\n2. WRONG-RUN AND STALE EVIDENCE -- unreadable, never a verdict on someone else's data")
    # Two separate checks guard this, and they must be separated or a mutant on
    # either survives behind the other. (a) the manifest binding: evidence that
    # does not match the LIVE canary.
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(), sha='deadbee')
    got, out = c.run()
    check('evidence not bound to the live canary', got, 'UNREADABLE',
          'Evidence whose sha does not match the manifest is not evidence about this canary.', out)

    # (b) the REGISTRATION binding: evidence that matches the live canary
    # perfectly but was produced against a different registered build. This is
    # the redeploy case -- owner-01 and owner-01b shared a sha, and a canary is
    # redeployed routinely after a flag fix, an env fix or a bad draw.
    c = Case(tmp, reg_extra={'sha': 'otherbuild'})
    c.evidence('immobiledid', immobiledid())
    got, out = c.run()
    check('evidence sha != registration sha', got, 'UNREADABLE',
          'The evidence is bound to the live canary and still describes a different '
          'registered build. Only the registration check catches this one.', out)

    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(), emitted_at=now(-240))   # four hours old
    got, out = c.run()
    check('evidence 240 min old', got, 'UNREADABLE',
          'A read taken four hours ago describes a window that has since closed.', out)

    # ---- 3. owner-01b, 2026-09-18. The primary endpoint was UNDEFINED.
    # The draw took board-b and hive-a at a 0.0% immobile pre-share, so the
    # primary ratio-DiD divided by zero and printed `+nan% FAIL`. A metric that
    # cannot be computed is not a metric that failed.
    print("\n3. UNDEFINED PRIMARY ENDPOINT (owner-01b's +nan%) -- unreadable, NOT an efficacy failure")
    c = Case(tmp, reg_extra={'reads': ['immobiledid', 'ownerread'],
                             'own_lines': [{'read': 'ownerread', 'field': 'primary_did',
                                            'op': '<=', 'value': 0.0, 'on_fail': 'REVERT'}]})
    c.evidence('immobiledid', immobiledid())
    c.evidence('ownerread', {'primary_did': None})
    got, out = c.run()
    check('primary endpoint missing', got, 'UNREADABLE',
          'A registered endpoint with no value is not an endpoint that failed.', out)

    # ...AND THE INCIDENT WAS NaN, NOT None. owner-01b's ratio-DiD printed
    # `+nan% FAIL`, and until today verdict.py only recognised None: NaN reached
    # the comparison, every comparison against NaN is False, and an
    # `on_fail: REVERT` line therefore REVERTED on an arithmetic hole. The
    # original case here used None and so tested missing data rather than the
    # incident it named. Found by a Codex pass on this suite.
    for bad, label in ((float('nan'), 'nan'), (float('inf'), 'inf')):
        c = Case(tmp, reg_extra={'reads': ['immobiledid', 'ownerread'],
                                 'own_lines': [{'read': 'ownerread', 'field': 'primary_did',
                                                'op': '<=', 'value': 0.0, 'on_fail': 'REVERT'}]})
        c.evidence('immobiledid', immobiledid())
        c.evidence('ownerread', {'primary_did': bad})
        got, out = c.run()
        check(f'primary endpoint is {label}', got, 'UNREADABLE',
              'You cannot reduce immobility from zero. A divide-by-zero endpoint is '
              'undefined, not a change that made things worse.', out)

    # ---- 4. owner-01b, 16:38:45Z, and falls-01 before it.
    # One canary death in a window whose control arm was dying the same way:
    # board-c-Bravo drowned identically four minutes earlier, and all three
    # fleet deaths that window were drownings-while-idle across both arms. Every
    # rung inside the fatal episode was `refused` or `preempted blocks=0` -- the
    # change placed nothing and moved nothing. v23: no single death reverts by
    # any path.
    print("\n4. BACKGROUND DROWNING + AN IRRELEVANT RUNG (owner-01b) -- report, never an automatic revert")
    c = Case(tmp, reg_extra={'change_rows': ['escape_rung']})
    c.evidence('immobiledid', immobiledid(canary_deaths=1, canary_bh=15.0,
                                          control_deaths=1, control_bh=150.0))
    # The actual shape of 18 Sep 16:33-16:38Z, reconstructed: the change's own row
    # fires on the canary both AWAY from the death and inside the fatal window, no
    # control death carries it, and the bot drowns. That combination is what v19
    # LICENSES and what v23 must then refuse, because it is one death.
    t = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=30)
    def stamp(sec):
        return (t + dt.timedelta(seconds=sec)).isoformat().replace('+00:00', 'Z')
    c.log('board-b-Bravo', [(stamp(0), '_escape_rung', 'rung refused: body held by air'),
                            (stamp(120), 'gather', 'ok'),
                            (stamp(300), '_escape_rung', 'rung refused: body held by air'),
                            (stamp(340), '_death', 'drowned; idle at the moment of death')])
    got, out = c.run()
    check('one canary death', got, 'KEEP',
          "owner-01b was reverted on exactly this. One death is below the owner's two-death "
          'floor, and v23 closes every path around it. It is reported, not decided on.', out)

    # THE OTHER PATH TO THE SAME MISTAKE. v19 demoted the single-death
    # RUNG-LINKAGE override to a WATCH after it ended -08c, -13 and -13b on one
    # death each. It is a different branch from the change-row one above -- it
    # fires on M_LIST rungs with `ladder_change` set -- and the first draft of
    # this suite left it unexercised, so restoring an automatic revert there
    # would have kept every case green. (Codex, 2026-09-19.)
    c = Case(tmp, reg_extra={'ladder_change': True})
    c.evidence('immobiledid', immobiledid(canary_deaths=1, canary_bh=15.0,
                                          control_deaths=1, control_bh=150.0))
    t = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=25)
    def stamp2(sec):
        return (t + dt.timedelta(seconds=sec)).isoformat().replace('+00:00', 'Z')
    c.log('board-b-Comet', [(stamp2(0), '_marooned_ramp_cut', 'ramp cut refused'),
                            (stamp2(40), '_death', 'drowned; idle at the moment of death')])
    got, out = c.run()
    check('rung-linked single death', got, 'KEEP',
          '-08c was reverted on `marooned_ramp_cut`, a rung whose own ledger note says '
          '"present in both arms; not the change". The base rungs are fleet-wide code, so '
          'one firing before a death is baseline behaviour. Reported, not decided on.', out)

    # THE QUEUED AMENDMENT, NOW MADE (v24, 2026-09-23). This case previously pinned the
    # invented denominator -- `control_bot_h = canary_bot_h * 7` -- as CURRENT BEHAVIOUR,
    # NOT ENDORSED, and said the change had to be prospective rather than slipped in beside
    # a test. It is now prospective and deliberate, and the reason it could not wait is that
    # the same three lines carried two further defects measured on a LIVE canary: the poll's
    # scanned deaths never reached the gate unless a saved control rate was truthy, and the
    # canary rate was computed against TEN hardcoded bots where the canary had twenty.
    #
    # The outcome deliberately changes from REVERT to UNREADABLE, not to KEEP. Dropping an
    # invented denominator must not convert a false REVERT into a false clean, which is the
    # worse of the two because nobody returns to check it. Control is scanned whenever the
    # canary reaches the floor, so arriving here with no control exposure means the
    # instrument failed -- and that is a refusal to decide, not a pass.
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(canary_deaths=3, canary_bh=30.0,
                                          control_deaths=0, control_bh=0))
    got, out = c.run()
    check('control has no measured exposure', got, 'UNREADABLE',
          'v24: with no MEASURED control exposure the gate refuses instead of assuming 7x '
          'the canary bot-hours. 3 canary deaths against an unmeasurable control is not a '
          'KEEP and not a REVERT -- it is a broken instrument, and the verdict says so.', out)

    # falls-01, 04:39:10Z: TWO deaths, but the rate ratio's lower bound is 0.58x.
    # The change was report-only -- a log row at a fall -- and both its deaths
    # were idle (one drowning, one unknown, zero falls), while all three control
    # deaths in the same window were idle drownings.
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(canary_deaths=2, canary_bh=23.9,
                                          control_deaths=3, control_bh=168.0))
    got, out = c.run()
    check('two deaths, lower bound 0.58x', got, 'KEEP',
          'falls-01 was reverted here on a 4.7x point ratio. v21 puts the 1.25x test on the '
          'lower bound: 0.58x does not clear it, and the change could not cause a fall death '
          'because it only wrote a log row.', out)

    # ---- 5. THE HARM SIGNAL MUST SURVIVE ALL OF THAT.
    # owner-01b's real defect, found in the read rather than by the gate: the
    # owner took a drowning bot's body at escape priority and held it until the
    # bot died. A refusal that blocks an executable rescue is harm, and the
    # movement guards must still revert on it. Calibrated: 2% false revert,
    # 97% detection.
    print("\n5. A CHANGED REFUSAL BLOCKING AN EXECUTABLE RESCUE -- the harm signal is retained")
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(v15c='REVERT: blocks moved -41% vs control'))
    got, out = c.run()
    check('v15c REVERT is forwarded', got, 'REVERT',
          "This pins that verdict.py FORWARDS an upstream REVERT from the calibrated "
          "movement guard -- it does not re-derive it, and this case is not evidence that "
          "-41% is itself detected (immobiledid's own severe threshold is beyond -50%). "
          "Loosening the death gate must not loosen this path.", out)

    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(v11={'climbs': 1.9, 'livelock': 0.1, 'ladders_p90': 8}))
    got, out = c.run()
    check('v11 climbs +190%', got, 'REVERT',
          'A change that doubles climb attempts is thrashing, whatever the death count says.', out)

    # ---- 6. AN INJECTED KNOWN REGRESSION.
    # swim_to shipped and TRIPLED drowning deaths. At that scale the gate is
    # calibrated to fire 99.9% of the time, and it must: a suite that only ever
    # proves the harness does not revert has tested one direction of one rule.
    print("\n6. AN INJECTED KNOWN REGRESSION (swim_to scale) -- REVERT")
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(canary_deaths=9, canary_bh=30.0,
                                          control_deaths=3, control_bh=210.0))
    got, out = c.run()
    check('9 deaths in 30 bot-h vs 3 in 210', got, 'REVERT',
          '0.300 vs 0.014/bot-h -- a 21x ratio, lower bound 6.27x. This pins detection of '
          'gross harm only: a threshold raised from 1.25 to 5 would still pass it.', out)

    # ...so pin the calibration where it actually lives. 3x is the ratio the
    # gate was calibrated at (51% detection at 95% confidence), and its lower
    # bound is 1.40x -- just past 1.25x. A threshold quietly raised to 5 passes
    # the 21x case above and fails here. (Codex, 2026-09-19.)
    c = Case(tmp)
    c.evidence('immobiledid', immobiledid(canary_deaths=9, canary_bh=30.0,
                                          control_deaths=21, control_bh=210.0))
    got, out = c.run()
    check('3x regression, lower bound 1.40x', got, 'REVERT',
          'A true 3x with enough deaths to prove it must revert. It BOUNDS the threshold '
          'below 1.40x -- it does not pin 1.25 exactly, and a threshold of 1.0 or 1.39 '
          'would still pass. What it catches is the 21x case above silently accepting a '
          'threshold raised to 5.', out)

    print(f"\n{'=' * 72}")
    n, k = len(RESULTS), sum(RESULTS)
    print(f"{k}/{n} acceptance cases pass")
    return 0 if k == n else 1


if __name__ == '__main__':
    sys.exit(main())
