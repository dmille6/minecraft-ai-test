"""THE HARD SPEND GUARD for the frontier overseer (cooperation tier design s.3.8, OWNER 10-23: $150/month, software guard
required, the existing Mac keys). Deterministic, fixture-tested (test_spendguard.py) before any key is read.

ONE LEDGER, ONE LOCK. Every write takes flock(~/overseer/spend.lock) and appends one fsynced JSON line to
~/overseer/spend.jsonl. Rows:
  reserve  {rid, model, usd (the WORST CASE), in_tokens, max_tokens, request_hash, purpose, earmark|null, month, day}
  settle   {rid, usd (billed, from the response's own usage), usage, request_id}
  void     {rid, why}            only for a reservation whose request was provably never sent
  earmark  {eid, usd, month, purpose}         a reserved horizon (B6/B7); released with `earmark_close`
  earmark_close {eid}
  reconcile {month, day, ledger_usd, vendor_usd|null, source}
THE RULES (s.3.8):
  1 one process holds the caller lock (`CallerLock`); a second refuses to start.
  2 RESERVE BEFORE SENDING: the worst case (counted input tokens of the exact request + max_tokens, at the table price) is
    written and fsynced first; the send is allowed only if month-to-date billed + every open reservation + every open earmark
    + this one stays <= the monthly cap. A call outside an earmark must also fit the day's allowance (cap / days in month,
    unspent allowance carried at most 2 days, counting only unearmarked spend).
  3 settle from the response's usage; a timeout or crash keeps the reservation OPEN (counted at its worst case) until
    reconciliation.
  4 no hidden retries (the caller's SDK clients run with max_retries=0).
  5 reconciliation: `reconcile_required_h` (default 36): no reconcile row within it stops every call. Paper runs (B5) may
    pass None; that is recorded in each reservation's row (`reconcile: off`).
  6/7 at >= 80% of the cap only purpose 'live' may reserve (shadow and paper stop first); at 100% nothing.
  Any guard failure (missing or corrupt price table, unreadable ledger, a failed write) REFUSES (fail closed).
"""
import calendar
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
import uuid

CAP_USD = 150.0
SHADOW_STOP_SHARE = 0.80
CARRY_DAYS = 2
PURPOSES = ('live', 'shadow', 'paper')


class GuardRefused(Exception):
    """The guard says no (money, a stop rule, or a guard failure). The message names which."""


def request_hash(body_bytes):
    return hashlib.sha256(body_bytes).hexdigest()


def _utc(now):
    return now if now is not None else dt.datetime.now(dt.timezone.utc)


class Guard:
    def __init__(self, root=None, cap=CAP_USD, prices_path=None, reconcile_required_h=36):
        self.root = os.path.expanduser(root or os.environ.get('OVERSEER_DIR', '~/overseer'))
        os.makedirs(self.root, exist_ok=True)
        self.ledger = os.path.join(self.root, 'spend.jsonl')
        self.lockf = os.path.join(self.root, 'spend.lock')
        self.prices_path = prices_path or os.path.join(self.root, 'prices.json')
        self.cap = float(cap)
        self.reconcile_required_h = reconcile_required_h

    # ---- storage ---------------------------------------------------------------------------------------------------------
    @contextlib.contextmanager
    def _locked(self):
        fd = os.open(self.lockf, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def _rows(self):
        if not os.path.exists(self.ledger):
            raise GuardRefused('guard failure: no ledger at %s (create it once with `spendguard.py init`)' % self.ledger)
        rows = []
        with open(self.ledger, 'rb') as f:
            for i, line in enumerate(f):
                if not line.strip():
                    continue
                try:
                    rows.append(json.loads(line))
                except Exception:
                    raise GuardRefused('guard failure: ledger line %d unreadable' % (i + 1))
        return rows

    def _append(self, row):
        data = (json.dumps(row, sort_keys=True) + '\n').encode()
        fd = os.open(self.ledger, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        try:
            n = os.write(fd, data)
            if n != len(data):
                raise GuardRefused('guard failure: short ledger write')
            os.fsync(fd)
        finally:
            os.close(fd)

    def prices(self):
        try:
            with open(self.prices_path) as f:
                t = json.load(f)
        except Exception as e:
            raise GuardRefused('guard failure: price table unreadable (%s)' % type(e).__name__)
        models = t.get('models') if isinstance(t, dict) else None
        if not isinstance(models, dict) or not models:
            raise GuardRefused('guard failure: price table has no models')
        for m, p in models.items():
            if not (isinstance(p, dict) and isinstance(p.get('in'), (int, float)) and isinstance(p.get('out'), (int, float))
                    and p['in'] > 0 and p['out'] > 0):
                raise GuardRefused('guard failure: price row for %s is not {in, out} > 0 per million' % m)
        return models

    def init(self):
        """Create the empty ledger once (never truncates an existing one)."""
        fd = os.open(self.ledger, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        os.close(fd)

    # ---- the fold --------------------------------------------------------------------------------------------------------
    @staticmethod
    def fold(rows, month):
        """-> dict: billed (settled, this month), open (worst case of open reservations, this month), earmarked (open earmark
        remaining), unearmarked spend per day, open reservation ids, last reconcile time."""
        res, done, earmarks, closed = {}, {}, {}, set()
        last_rec = None
        last_rec_row = None
        for r in rows:
            k = r.get('kind')
            if k == 'reserve':
                res[r['rid']] = r
            elif k in ('settle', 'void'):
                done[r['rid']] = r
            elif k == 'earmark':
                earmarks[r['eid']] = r
            elif k == 'earmark_close':
                closed.add(r['eid'])
            elif k == 'reconcile':
                last_rec = r['ts']
                if r.get('month') == month:
                    last_rec_row = r
        billed = open_ = 0.0
        by_day = {}
        drawn = {}
        for rid, r in res.items():
            if r.get('month') != month:
                continue
            d = done.get(rid)
            usd = (d.get('usd', 0.0) if d and d['kind'] == 'settle' else 0.0) if d else r['usd']
            if d:
                billed += usd
            else:
                open_ += usd
            if r.get('earmark'):
                drawn[r['earmark']] = drawn.get(r['earmark'], 0.0) + usd
            else:
                by_day[r['day']] = by_day.get(r['day'], 0.0) + usd
        earmarked = 0.0
        for eid, e in earmarks.items():
            if e.get('month') == month and eid not in closed:
                earmarked += max(0.0, e['usd'] - drawn.get(eid, 0.0))
        vendor = (last_rec_row or {}).get('vendor_usd')
        return {'vendor_usd': vendor, 'mismatch': bool((last_rec_row or {}).get('mismatch')), 'billed': billed, 'open': open_, 'earmarked': earmarked, 'by_day': by_day,
                'open_ids': [rid for rid in res if rid not in done], 'last_reconcile': last_rec,
                'earmarks': {eid: e for eid, e in earmarks.items() if eid not in closed}, 'drawn': drawn}

    def allowance_today(self, f, now):
        """cap / days in month, plus up to CARRY_DAYS of the previous days' unspent allowance (same month only)."""
        days = calendar.monthrange(now.year, now.month)[1]
        per = self.cap / days
        carry = 0.0
        for back in range(1, CARRY_DAYS + 1):
            d = now.date() - dt.timedelta(days=back)
            if d.month != now.month:
                break
            carry += max(0.0, per - f['by_day'].get(d.isoformat(), 0.0))
        return per + carry

    # ---- the operations ----------------------------------------------------------------------------------------------------
    def reserve(self, model, in_tokens, max_tokens, req_hash, purpose='paper', earmark=None, now=None, run=None):
        now = _utc(now)
        if purpose not in PURPOSES:
            raise GuardRefused('guard failure: unknown purpose %r' % purpose)
        if not (isinstance(in_tokens, int) and in_tokens > 0 and isinstance(max_tokens, int) and max_tokens > 0):
            raise GuardRefused('guard failure: the request was not counted (in=%r max=%r): fail closed' % (in_tokens, max_tokens))
        prices = self.prices()
        if model not in prices:
            raise GuardRefused('guard failure: no price for %s' % model)
        p = prices[model]
        worst = round(in_tokens * p['in'] / 1e6 + max_tokens * p['out'] / 1e6, 6)
        month, day = now.strftime('%Y-%m'), now.date().isoformat()
        with self._locked():
            f = self.fold(self._rows(), month)
            if self.reconcile_required_h is not None:
                last = f['last_reconcile']
                age_h = None if last is None else (now - dt.datetime.fromisoformat(last.replace('Z', '+00:00'))).total_seconds() / 3600
                if age_h is None or age_h > self.reconcile_required_h:
                    raise GuardRefused('stop: no reconciliation within %dh' % self.reconcile_required_h)
            if f['mismatch']:
                raise GuardRefused('stop: the last reconciliation disagrees with the vendor by more than 5%: the operator looks first')
            # the vendor's own total, when it is higher, is what was spent (a call the ledger never saw still cost money)
            committed = max(f['billed'], f['vendor_usd'] or 0.0) + f['open'] + f['earmarked']
            if earmark is not None:
                e = f['earmarks'].get(earmark)
                if not e or e.get('month') != month:
                    raise GuardRefused('guard failure: earmark %s not open this month' % earmark)
                left = e['usd'] - f['drawn'].get(earmark, 0.0)
                if worst > left + 1e-9:
                    raise GuardRefused('money: the earmark has $%.4f left, this call reserves $%.4f' % (left, worst))
                committed -= worst                       # it moves OUT of the earmark: never counted twice
            if purpose != 'live' and committed + worst > SHADOW_STOP_SHARE * self.cap + 1e-9:
                raise GuardRefused('money: %s stops at %d%% of the cap ($%.2f committed + $%.4f > $%.2f)'
                                   % (purpose, SHADOW_STOP_SHARE * 100, committed, worst, SHADOW_STOP_SHARE * self.cap))
            if committed + worst > self.cap + 1e-9:
                raise GuardRefused('money: month at $%.2f committed + $%.4f > cap $%.2f' % (committed, worst, self.cap))
            if earmark is None:
                allow = self.allowance_today(f, now)
                spent = f['by_day'].get(day, 0.0)
                if spent + worst > allow + 1e-9:
                    raise GuardRefused('money: today $%.4f + $%.4f > the day allowance $%.4f' % (spent, worst, allow))
            rid = 'r-%s-%s' % (now.strftime('%Y%m%dT%H%M%S'), uuid.uuid4().hex[:12])
            self._append({'ts': now.isoformat().replace('+00:00', 'Z'), 'kind': 'reserve', 'rid': rid, 'model': model, 'usd': worst,
                          'in_tokens': in_tokens, 'max_tokens': max_tokens, 'request_hash': req_hash, 'purpose': purpose,
                          'earmark': earmark, 'month': month, 'day': day, 'run': run,
                          'reconcile': 'off' if self.reconcile_required_h is None else 'on'})
            return {'rid': rid, 'usd_worst': worst, 'request_hash': req_hash}

    def check_send(self, rid, body_bytes):
        """The caller's last check before sending: the reservation is open and bound to THESE bytes."""
        with self._locked():
            rows = self._rows()
        r = next((x for x in rows if x.get('kind') == 'reserve' and x.get('rid') == rid), None)
        if not r:
            raise GuardRefused('guard failure: no reservation %s' % rid)
        if any(x.get('rid') == rid and x.get('kind') in ('settle', 'void') for x in rows):
            raise GuardRefused('guard failure: reservation %s is already closed (a retry is a new reservation)' % rid)
        if request_hash(body_bytes) != r['request_hash']:
            raise GuardRefused('guard failure: the request differs from the one reserved')
        return True

    def settle(self, rid, model, usage, request_id=None, now=None):
        """usage = {'input_tokens', 'output_tokens', 'cache_read_input_tokens'?, 'cache_creation_input_tokens'?}."""
        now = _utc(now)
        p = self.prices()[model]
        ok = isinstance(usage, dict) and all(isinstance(usage.get(k), int) and usage.get(k) >= 0 for k in ('input_tokens', 'output_tokens')) \
            and usage['input_tokens'] > 0
        if not ok:
            raise GuardRefused('guard failure: no usable usage for %s: the reservation stays OPEN at its worst case' % rid)
        tin = int(usage.get('input_tokens') or 0) + int(usage.get('cache_creation_input_tokens') or 0) + int(usage.get('cache_read_input_tokens') or 0)
        tout = int(usage.get('output_tokens') or 0)
        usd = round(tin * p['in'] / 1e6 + tout * p['out'] / 1e6, 6)
        with self._locked():
            rows = self._rows()
            if not any(x.get('kind') == 'reserve' and x.get('rid') == rid for x in rows):
                raise GuardRefused('guard failure: settle of unknown reservation %s' % rid)
            if any(x.get('rid') == rid and x.get('kind') in ('settle', 'void') for x in rows):
                raise GuardRefused('guard failure: %s settled twice' % rid)
            self._append({'ts': now.isoformat().replace('+00:00', 'Z'), 'kind': 'settle', 'rid': rid, 'usd': usd, 'usage': usage,
                          'request_id': request_id})
        return usd

    def void(self, rid, why, now=None):
        now = _utc(now)
        with self._locked():
            rows = self._rows()
            if any(x.get('rid') == rid and x.get('kind') in ('settle', 'void') for x in rows):
                raise GuardRefused('guard failure: %s already closed' % rid)
            self._append({'ts': now.isoformat().replace('+00:00', 'Z'), 'kind': 'void', 'rid': rid, 'why': why})

    def earmark(self, usd, purpose, now=None):
        now = _utc(now)
        month = now.strftime('%Y-%m')
        with self._locked():
            f = self.fold(self._rows(), month)
            if f['billed'] + f['open'] + f['earmarked'] + usd > self.cap + 1e-9:
                raise GuardRefused('money: the earmark $%.2f does not fit the month' % usd)
            eid = 'e-%s' % uuid.uuid4().hex[:12]
            self._append({'ts': now.isoformat().replace('+00:00', 'Z'), 'kind': 'earmark', 'eid': eid, 'usd': round(usd, 6),
                          'month': month, 'purpose': purpose})
            return eid

    def earmark_close(self, eid, now=None):
        now = _utc(now)
        with self._locked():
            self._append({'ts': now.isoformat().replace('+00:00', 'Z'), 'kind': 'earmark_close', 'eid': eid})

    def reconcile(self, vendor_usd=None, source='self', now=None):
        now = _utc(now)
        with self._locked():
            f = self.fold(self._rows(), now.strftime('%Y-%m'))
            ledger = f['billed'] + f['open']
            mismatch = vendor_usd is not None and abs(vendor_usd - f['billed']) > max(0.01, 0.05 * max(vendor_usd, f['billed']))
            self._append({'ts': now.isoformat().replace('+00:00', 'Z'), 'kind': 'reconcile', 'month': now.strftime('%Y-%m'),
                          'day': now.date().isoformat(), 'ledger_usd': round(f['billed'], 6), 'ledger_with_open_usd': round(ledger, 6),
                          'vendor_usd': vendor_usd, 'source': source, 'mismatch': mismatch})
            return mismatch

    def status(self, now=None):
        now = _utc(now)
        f = self.fold(self._rows(), now.strftime('%Y-%m'))
        return {'month': now.strftime('%Y-%m'), 'cap': self.cap, 'billed': round(f['billed'], 4), 'open': round(f['open'], 4),
                'earmarked': round(f['earmarked'], 4), 'open_reservations': len(f['open_ids']),
                'today': round(f['by_day'].get(now.date().isoformat(), 0.0), 4), 'allowance_today': round(self.allowance_today(f, now), 4)}


class CallerLock:
    """Rule 1: one caller. flock -n on ~/overseer/caller.lock; a second instance raises GuardRefused."""
    def __init__(self, root, wait_s=0):
        self.path = os.path.join(os.path.expanduser(root), 'caller.lock')
        self.fd = None
        self.wait_s = wait_s

    def __enter__(self):
        import time as _t
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        t0 = _t.time()
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if _t.time() - t0 >= self.wait_s:
                    os.close(self.fd)
                    self.fd = None
                    raise GuardRefused('another caller holds %s' % self.path)
                _t.sleep(0.5)

    def __exit__(self, *a):
        if self.fd is not None:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description='the overseer spend guard')
    ap.add_argument('cmd', choices=['init', 'status', 'reconcile'])
    ap.add_argument('--root', default=None)
    ap.add_argument('--vendor-usd', type=float, default=None)
    a = ap.parse_args(argv)
    g = Guard(a.root)
    if a.cmd == 'init':
        g.init()
    elif a.cmd == 'reconcile':
        g.reconcile(a.vendor_usd, source='vendor' if a.vendor_usd is not None else 'self')
    print(json.dumps(g.status(), sort_keys=True))


if __name__ == '__main__':
    main()
