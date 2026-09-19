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
    """`verdict.py` reconstructs bot-hours by dividing counts by rates, so the
    fixture has to carry rates that divide back to the bot-hours intended.
    A rate of 0 with deaths > 0 would silently give 0 bot-h and an infinite
    ratio, which is how a fixture lies."""
    return {'canary_deaths': canary_deaths,
            'canary_rate': (canary_deaths / canary_bh) if canary_bh else 0.0,
            'control_deaths': control_deaths,
            'control_rate': (control_deaths / control_bh) if control_bh else None,
            'canary_bot_h': canary_bh}


def immobiledid(readable=True, v15c='OK', v11=None, **hk):
    return {'readable': readable, 'canary_bot_h': hk.pop('bot_h', 30.0),
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
        return (head.split()[1] if head.startswith('VERDICT ') else 'CRASH'), head


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
          'You cannot reduce immobility from zero. A divide-by-zero endpoint must not be '
          'scored as a change that made things worse.', out)

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
    check('v15c movement guard', got, 'REVERT',
          'Loosening the death gate must not loosen this. The guard that catches a bot held '
          'still by its own owner is calibrated and still decides.', out)

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
          '0.300 vs 0.014/bot-h. If this does not revert, the death gate has been loosened '
          'past the thing it exists for.', out)

    print(f"\n{'=' * 72}")
    n, k = len(RESULTS), sum(RESULTS)
    print(f"{k}/{n} acceptance cases pass")
    return 0 if k == n else 1


if __name__ == '__main__':
    sys.exit(main())
