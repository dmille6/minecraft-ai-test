#!/usr/bin/env python3
"""test_replay_min4.py [--mutants] -- the replay's waiting-world eligibility (replay_min4.eligible_waiting) on a stub
simulator, as behaviour. The regression case is Codex round 1 P1-1: a run whose REQUIRED pool is one of its own pools,
with its own real deployment live in the logs, has its 4th pool discarded by the round-1 method (sim.eligible, then add
its pools back). The round-1 method is run on the same stub as the positive control that this test can see the bug."""
import datetime as dt, io, contextlib, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
T = []
NOW = dt.datetime(2026, 10, 23, 3, 0, tzinfo=dt.timezone.utc)


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-500:]))


class Stub:
    """Only what drawsim.Sim.eligible and eligible_waiting read. band: on the declared build only (own pools ran the
    canary build in reality, so the real band holds them only when `own_in_band`, at far-out values)."""
    def __init__(self, req=None, ledger=(), other_live=(), own_in_band=False, others=('board-a',)):
        self.own = {'board-d', 'hive-b', 'placebo-a'}
        self.live = [(NOW - dt.timedelta(hours=1), None, set(self.own), 'pe-01')]
        self.live += [(NOW - dt.timedelta(hours=1), None, set(ps), 'other-01') for ps in other_live]
        self._band = {p: 60.0 for p in others}
        self._band.update({'board-b': 60.0})              # in band, but fails the exposure filter (expo below)
        if own_in_band:
            self._band.update({p: 5.0 for p in self.own})  # treated, far below: would drag the median if counted
        self._ledger = list(ledger)
        self._reg = {'tier': 2, 'draw_require_pools': req} if req else {'tier': 2}
        self.DS = types.SimpleNamespace(pools_in=lambda r: set(r['pools']))
        self.release_c = False

    def ledger_rows(self, t_):
        return [{'ts': (t_ - dt.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'pools': ps} for ps in self._ledger], False

    def steady_release(self, t_, run, rule):
        # stands for drawsim's: it reads the live set (touched pools, the declared-at instant). Here: board-c, a
        # ledger-excluded pool, is released only when no canary is live -- true in the waiting world
        return ({'board-c'} if self.release_c and not self.live_pools(t_) else set()), []

    def live_pools(self, t_):
        out = set()
        for d, c, ps, r in self.live:
            if d <= t_ and (c is None or t_ < c):
                out |= ps
        return out

    def band(self, t_):
        return dict(self._band)

    def qualify(self, p, t_, fv, build='single'):
        return None, 'stub'

    def expo(self, t_):
        return (set(self._band) - {'board-b'}) | self.own

    def allowed(self, run, t_):
        return None

    def reg(self, run):
        return self._reg


def cases(ew):
    import drawsim
    s = Stub(req=['board-d'])
    old = sorted(set(drawsim.Sim.eligible(s, NOW, 'pe-01')[0]) | s.own)
    t('positive control: the ROUND-1 method on the regression stub loses the 4th pool (3)', len(old) == 3, old)
    e, info = ew(s, NOW, 'pe-01', s.own)
    t('regression (Codex r1 P1-1): required own pool + own live deploy -> 4 eligible incl. board-a',
      e == ['board-a', 'board-d', 'hive-b', 'placebo-a'], (e, info))
    t('the simulator\'s live set is restored afterwards', len(s.live) == 1 and s.band(NOW).get('board-b') == 60.0, s.live)
    s = Stub(req=['board-d'], ledger=[['board-a']])
    e, _i = ew(s, NOW, 'pe-01', s.own)
    t('a ledger-excluded other pool is still excluded (3 -> waits)', 'board-a' not in e and len(e) == 3, e)
    s = Stub(other_live=[['board-a']])
    e, _i = ew(s, NOW, 'pe-01', s.own)
    t('ANOTHER run\'s live deployment still excludes its pools', 'board-a' not in e, e)
    s = Stub(own_in_band=True)
    e, info = ew(s, NOW, 'pe-01', s.own)
    t('own pools\' treated telemetry is kept out of the band median (A2): board-a stays in band', 'board-a' in e
      and info['median'] == 60.0, (e, info))
    s = Stub(ledger=[['board-c']], others=('board-a', 'board-c')); s.release_c = True
    e, _i = ew(s, NOW, 'pe-01', s.own)
    t('steady release is decided in the WAITING world (the run\'s own deploy not live): board-c released -> 5',
      'board-c' in e and len(e) == 5, e)
    s = Stub(ledger=[['board-c']], others=('board-a', 'board-c'))
    e, _i = ew(s, NOW, 'pe-01', s.own)
    t('positive control: not released -> board-c stays excluded (4)', 'board-c' not in e and len(e) == 4, e)
    s = Stub(req=['hive-c'])
    e, info = ew(s, NOW, 'pe-01', s.own)
    t('a required pool that is NOT one of its own and not drawable -> nothing', e == [] and 'require' in info, (e, info))


MUTANTS = [
    ("    sim.live = [x for x in saved_live if x[3] != run]\n", "    sim.live = list(saved_live)\n"),
    ("    sim.band = lambda tt: {p: v for p, v in saved_band(tt).items() if p not in own}\n",
     "    sim.band = saved_band\n"),
    ("            if any(p not in own and (p in excl or p not in band) for p in req):",
     "            if any((p in excl or p not in band) for p in req):"),
]


def main():
    import replay_min4
    cases(replay_min4.eligible_waiting)
    ok = all(T)
    print('test_replay_min4: %d/%d pass' % (sum(T), len(T)))
    if '--mutants' not in sys.argv:
        sys.exit(0 if ok else 1)
    src = open(replay_min4.__file__).read()
    surv = 0
    for old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r (%d)' % (old, src.count(old))
        ns = {'__name__': 'replay_min4_mut', '__file__': replay_min4.__file__}
        exec(compile(src.replace(old, new, 1), 'replay_min4_mut', 'exec'), ns)
        del T[:]
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                cases(ns['eligible_waiting'])
            except Exception:
                T.append(False)
        killed = not all(T)
        print('  mutant %-70r %s' % (old.strip()[:70], 'killed' if killed else 'SURVIVED'))
        surv += not killed
    print('mutants: %d of %d killed' % (len(MUTANTS) - surv, len(MUTANTS)))
    sys.exit(0 if ok and not surv else 1)


if __name__ == '__main__':
    main()
