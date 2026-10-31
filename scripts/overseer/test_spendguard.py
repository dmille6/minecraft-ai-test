"""Fixtures for the spend guard (design s.3.8 rule 10). python3 -m unittest scripts/overseer/test_spendguard.py"""
import datetime as dt
import json
import multiprocessing as mp
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spendguard as SG  # noqa: E402

T0 = dt.datetime(2026, 10, 31, 12, 0, tzinfo=dt.timezone.utc)
PRICES = {'models': {'m': {'in': 2.0, 'out': 10.0}, 'cheap': {'in': 0.1, 'out': 0.5}}}


def guard(root=None, **kw):
    root = root or tempfile.mkdtemp(prefix='sg-')
    with open(os.path.join(root, 'prices.json'), 'w') as f:
        json.dump(PRICES, f)
    g = SG.Guard(root, reconcile_required_h=None, **kw)
    g.init()
    return g


def _worker(root, n, q):
    g = SG.Guard(root, cap=31.0, reconcile_required_h=None)
    ok = 0
    for _ in range(n):
        try:
            g.reserve('m', 3000, 4000, 'h', now=T0)
            ok += 1
        except SG.GuardRefused:
            pass
    q.put(ok)


class SpendGuard(unittest.TestCase):
    def test_reserve_settle_and_worst_case(self):
        g = guard()
        r = g.reserve('m', 3000, 4000, 'h1', now=T0)
        self.assertAlmostEqual(r['usd_worst'], 3000 * 2e-6 + 4000 * 10e-6)   # $0.046, the design's Sonnet worst case
        self.assertAlmostEqual(g.status(T0)['open'], 0.046)
        usd = g.settle(r['rid'], 'm', {'input_tokens': 2500, 'output_tokens': 1200}, now=T0)
        self.assertAlmostEqual(usd, 0.017)
        st = g.status(T0)
        self.assertAlmostEqual(st['billed'], 0.017); self.assertEqual(st['open'], 0.0)
        with self.assertRaises(SG.GuardRefused):
            g.settle(r['rid'], 'm', {'input_tokens': 1, 'output_tokens': 1}, now=T0)       # never twice

    def test_send_is_bound_to_the_reserved_bytes(self):
        g = guard()
        body = b'{"exact":"request"}'
        r = g.reserve('m', 100, 100, SG.request_hash(body), now=T0)
        self.assertTrue(g.check_send(r['rid'], body))
        with self.assertRaises(SG.GuardRefused):
            g.check_send(r['rid'], b'{"exact":"request "}')
        g.void(r['rid'], 'not sent', now=T0)
        with self.assertRaises(SG.GuardRefused):
            g.check_send(r['rid'], body)                                                     # a retry is a new reservation

    def test_timeout_without_usage_stays_open_and_survives_a_restart(self):
        root = tempfile.mkdtemp(prefix='sg-')
        g = guard(root)
        g.reserve('m', 3000, 4000, 'h', now=T0)                       # sent, then the process died: no settle
        g2 = SG.Guard(root, reconcile_required_h=None)                # a restart reads the same ledger
        self.assertEqual(g2.status(T0)['open_reservations'], 1)
        self.assertAlmostEqual(g2.status(T0)['open'], 0.046)          # counted at its worst case

    def test_month_at_99_9_percent_refuses_a_call_that_would_cross(self):
        g = guard(cap=1.0)
        e = g.earmark(0.999 - 0.0, 'live', now=T0)                    # 99.9% committed by an earmark
        with self.assertRaises(SG.GuardRefused) as c:
            g.reserve('m', 3000, 4000, 'h', purpose='live', now=T0)
        self.assertIn('money', str(c.exception))
        r = g.reserve('m', 3000, 4000, 'h', purpose='live', earmark=e, now=T0)   # drawn FROM the earmark: fits
        self.assertTrue(r['rid'])
        self.assertAlmostEqual(g.status(T0)['open'] + g.status(T0)['earmarked'], 0.999)   # never counted twice

    def test_shadow_and_paper_stop_at_80_percent_live_does_not(self):
        g = guard(cap=1.0)
        g.earmark(0.79, 'live', now=T0)
        with self.assertRaises(SG.GuardRefused):
            g.reserve('m', 3000, 4000, 'h', purpose='paper', now=T0)
        with self.assertRaises(SG.GuardRefused):
            g.reserve('m', 3000, 4000, 'h', purpose='shadow', now=T0)
        # live is held only by the cap and the day's allowance ($1/31 + 2 carried days = $0.097 > $0.046): it goes through
        g.reserve('m', 3000, 4000, 'h', purpose='live', now=T0)

    def test_day_allowance_and_carry(self):
        g = guard(cap=31.0)                                            # $1/day in October
        f0 = g.fold(g._rows(), '2026-10')
        self.assertAlmostEqual(g.allowance_today(f0, T0), 3.0)         # today + 2 unspent days carried (never 3)
        self.assertAlmostEqual(g.allowance_today(f0, T0.replace(day=1)), 1.0)   # no carry across a month start
        self.assertAlmostEqual(g.allowance_today(f0, T0.replace(day=2)), 2.0)
        n = 0
        while True:
            try:
                g.reserve('m', 3000, 4000, 'h', now=T0); n += 1
            except SG.GuardRefused as e:
                self.assertIn('day allowance', str(e)); break
        self.assertEqual(n, int(3.0 // 0.046))
        # spending on a day uses up its own allowance for the carry: the next day carries only what was unspent
        f = g.fold(g._rows(), '2026-10')
        self.assertTrue(f['by_day'][T0.date().isoformat()] > 2.9)

    def test_month_rollover(self):
        g = guard(cap=1.0)
        r = g.reserve('cheap', 1000, 1000, 'h', now=T0)
        g.settle(r['rid'], 'cheap', {'input_tokens': 1000, 'output_tokens': 1000}, now=T0)
        nov = dt.datetime(2026, 11, 1, 0, 1, tzinfo=dt.timezone.utc)
        self.assertEqual(g.status(nov)['billed'], 0.0)                 # a new month starts empty
        self.assertGreater(g.status(T0)['billed'], 0.0)

    def test_missing_ledger_and_corrupt_or_missing_prices_refuse(self):
        root = tempfile.mkdtemp(prefix='sg-')
        g = SG.Guard(root, reconcile_required_h=None)
        with open(os.path.join(root, 'prices.json'), 'w') as f:
            json.dump(PRICES, f)
        with self.assertRaises(SG.GuardRefused):
            g.reserve('m', 10, 10, 'h', now=T0)                        # no ledger: fail closed
        g.init()
        with open(os.path.join(root, 'prices.json'), 'w') as f:
            f.write('{"models": {"m": {"in": 2.0}}')
        with self.assertRaises(SG.GuardRefused):
            g.reserve('m', 10, 10, 'h', now=T0)
        os.remove(os.path.join(root, 'prices.json'))
        with self.assertRaises(SG.GuardRefused):
            g.reserve('m', 10, 10, 'h', now=T0)
        with open(g.ledger, 'a') as f:
            f.write('{not json\n')
        with open(os.path.join(root, 'prices.json'), 'w') as f:
            json.dump(PRICES, f)
        with self.assertRaises(SG.GuardRefused):
            g.reserve('m', 10, 10, 'h', now=T0)                        # an unreadable ledger line

    def test_uncounted_request_and_unknown_model_refuse(self):
        g = guard()
        for args in [('m', None, 4000), ('m', 0, 4000), ('m', 100, 0), ('nope', 100, 100)]:
            with self.assertRaises(SG.GuardRefused):
                g.reserve(args[0], args[1], args[2], 'h', now=T0)

    def test_reconcile_stop(self):
        g = guard()
        g.reconcile_required_h = 36
        with self.assertRaises(SG.GuardRefused) as c:
            g.reserve('cheap', 10, 10, 'h', now=T0)
        self.assertIn('reconciliation', str(c.exception))
        g.reconcile(now=T0 - dt.timedelta(hours=10))
        g.reserve('cheap', 10, 10, 'h', now=T0)
        with self.assertRaises(SG.GuardRefused):
            g.reserve('cheap', 10, 10, 'h', now=T0 + dt.timedelta(hours=27))

    def test_concurrent_submissions_never_cross_the_cap(self):
        root = tempfile.mkdtemp(prefix='sg-')
        guard(root, cap=1.0)
        # no daily cap issue: cap 1.0 -> $0.032/day, so the DAY rule binds first; use a big cap and test the month cap via earmark
        g = SG.Guard(root, cap=31 * 1.0, reconcile_required_h=None)
        q = mp.Queue()
        ps = [mp.Process(target=_worker, args=(root, 25, q)) for _ in range(4)]
        [p.start() for p in ps]; [p.join() for p in ps]
        ok = sum(q.get() for _ in ps)
        st = g.status(T0)
        self.assertLessEqual(st['open'], st['allowance_today'] + 1e-9)
        self.assertEqual(ok, int(st['allowance_today'] // 0.046 + 1e-9))   # exactly as many as fit, whatever the interleaving

    def test_caller_lock_is_single_instance(self):
        root = tempfile.mkdtemp(prefix='sg-')
        with SG.CallerLock(root):
            with self.assertRaises(SG.GuardRefused):
                with SG.CallerLock(root):
                    pass
        with SG.CallerLock(root):
            pass

    def test_settle_without_usage_keeps_the_reservation_open(self):
        g = guard()
        r = g.reserve('m', 3000, 4000, 'h', now=T0)
        for bad in [{}, {'input_tokens': None, 'output_tokens': 5}, {'input_tokens': 0, 'output_tokens': 0}, None]:
            with self.assertRaises(SG.GuardRefused):
                g.settle(r['rid'], 'm', bad, now=T0)
        self.assertAlmostEqual(g.status(T0)['open'], 0.046)

    def test_vendor_total_counts_and_a_mismatch_stops(self):
        g = guard(cap=31.0)
        r = g.reserve('m', 3000, 4000, 'h', now=T0)
        g.settle(r['rid'], 'm', {'input_tokens': 2500, 'output_tokens': 1200}, now=T0)
        self.assertFalse(g.reconcile(vendor_usd=0.0171, now=T0))              # within 5%: fine
        g.reserve('cheap', 10, 10, 'h', now=T0)
        self.assertTrue(g.reconcile(vendor_usd=30.0, now=T0))                 # the vendor says far more: stop
        with self.assertRaises(SG.GuardRefused) as c:
            g.reserve('cheap', 10, 10, 'h', now=T0)
        self.assertIn('reconciliation', str(c.exception))
        f = g.fold(g._rows(), '2026-10')
        self.assertEqual(f['vendor_usd'], 30.0)


if __name__ == '__main__':
    unittest.main()
