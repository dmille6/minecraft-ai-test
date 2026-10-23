#!/usr/bin/env python3
"""drawsim.py -- the DRAW, reconstructed at any past instant from hostscan.py's buckets plus copies of the host's
ledger, journal and registrations. READ-ONLY; runs on the Mac. Used by replay_settle.py (design 1) and
replay_lookahead.py (design 2).

    sim = Sim(snapshot_dir, scan_jsonl, host_module_dir, patches_dir)
    sim.eligible(T, run, rule)  -> (eligible pools, why) exactly as drawrec.sh would have computed them at T

It stands in for drawrec.sh + poolrank2.py + immobiledid.py POOLS=1 + drawexposure.py + drawsteady.py, citing each.
The LEDGER decisions are run through the host's own pure functions (drawsteady.parse_ledger / candidates /
candidates_t2, tierrule.*), imported from a COPY of ~/mcai-analysis; only the log measurements are re-implemented over
5-minute buckets. The positive control (replay_settle.py --control) re-draws every actual draw since 10-12 and checks the
reconstruction against what the loop actually drew: for a draw of fewer than four pools the eligible set must EQUAL
the drawn set (drawrec takes all of them), for four it must CONTAIN them."""
import bisect, collections, datetime as dt, json, os, re, statistics, sys

UTC = dt.timezone.utc
T = lambda s: dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
ISO = lambda t: t.astimezone(UTC).strftime('%m-%dT%H:%MZ')
# rule epochs on the host (gate-installs.log, drawrec/drawsteady backups): v35 steady release staged 10-12 19:28Z but
# refused on every run until v35.1 (10-13 16:21Z); v36 tier-2 release from 10-19 16:27Z
V351 = T('2026-10-13T16:21:26Z')
V36 = T('2026-10-19T16:27:00Z')


class Sim:
    def __init__(self, snap, scan, hostmods, patches):
        sys.path.insert(0, hostmods)
        sys.path.insert(0, patches)
        import drawsteady, tierrule, settlerule
        self.DS, self.TR, self.SR = drawsteady, tierrule, settlerule
        self.snap = snap
        self.ledger_lines = open(os.path.join(snap, 'ledger.jsonl')).readlines()
        self.journal = [json.loads(l) for l in open(os.path.join(snap, 'canary-journal.jsonl')) if l.strip()]
        self.regdir = os.path.join(snap, 'regs')
        self.load_scan(scan)
        self.timeline()

    # ------------------------------------------------------------------------------------------------- data --
    def load_scan(self, path):
        self.B, self.deaths = {}, {}
        for l in open(path):
            d = json.loads(l)
            if 'meta' in d:
                self.A = T(d['meta']['from']); self.BS = d['meta']['bucket_s']; self.specs = [tuple(x) for x in d['meta']['specs']]
            elif 'bot' in d:
                self.B[d['bot']] = {int(k): v for k, v in d['b'].items()}
                self.deaths[d['bot']] = [(self.A + dt.timedelta(seconds=s), det) for s, det in d['deaths']]
            elif 'total' in d:
                self.total = d['total']
        self.bots = sorted(b for b in self.B if '-Charlie' not in b)
        self.pools = sorted({self.pool_of(b) for b in self.bots})
        self.full = {}
        for b in self.B.values():
            for c in b.values():
                for v in c['v']:
                    base = v.split('+')[0]
                    self.full.setdefault(base[:7], base)

    @staticmethod
    def pool_of(b):
        return '-'.join(b.split('-')[:2])

    def bi(self, t):
        return int((t - self.A).total_seconds() // self.BS)

    def cells(self, bot, t0, t1):
        bk = self.B.get(bot, {})
        for i in range(self.bi(t0), self.bi(t1)):
            c = bk.get(i)
            if c:
                yield i, c

    def reg(self, run):
        try:
            return json.load(open(os.path.join(self.regdir, run + '.json')))
        except Exception:
            return None

    def timeline(self):
        """fleet base over time (fleet-wide promotions), live canaries (deployed .. last close), run phases."""
        self.promos = []
        self.runs = collections.OrderedDict()
        for r in self.journal:
            self.runs.setdefault(r['run'], []).append(r)
            if r['phase'] == 'promoted' and 'fleet-wide' in str(r.get('note')):
                self.promos.append((T(r['ts']), str(r['note']).split()[0]))
        self.promos.sort()
        self.live = []
        for run, rs in self.runs.items():
            dep = [T(r['ts']) for r in rs if r['phase'] == 'deployed']
            if not dep:
                continue
            pools = str([r for r in rs if r['phase'] == 'deployed'][0]['note']).split()[0]
            cl = [T(r['ts']) for r in rs if r['phase'] == 'torn-down'] + \
                 [T(r['ts']) for r in rs if r['phase'] == 'promoted' and 'fleet-wide' in str(r.get('note'))]
            self.live.append((min(dep), max(cl) if cl else None, set(pools.split(',')), run))
        # a run with no close row (old manual runs; the live one) ends at the next run's deploy, never later
        deps = sorted(d for d, _c, _p, _r in self.live)
        self.live = [(d, c if c is not None else next((x for x in deps if x > d), None), p, r) for d, c, p, r in self.live]

    def base_at(self, t):
        i = bisect.bisect_right([p[0] for p in self.promos], t) - 1
        s = self.promos[i][1] if i >= 0 else None
        return self.full.get(s[:7], s) if s else None

    def declared_at(self, t):
        cands = [p[0] for p in self.promos if p[0] <= t] + [d for d, _c, _p, _r in self.live if d <= t]
        return max(cands) if cands else None

    def live_pools(self, t):
        out = set()
        ov = getattr(self, 'override', {})
        for d, c, ps, r in self.live:
            if d <= t and (c is None or t < c):
                out |= set(ov.get(r, ps))
        return out

    # ------------------------------------------------------------------------------------------ measurements --
    def band(self, t):
        """poolrank2.py: items/bh over [t-120, t) on rows of the declared build, isolated-*/self-* excluded."""
        BV = self.base_at(t)
        t0 = t - dt.timedelta(minutes=120)
        out = {}
        for p in self.pools:
            if p.startswith('isolated'):
                continue
            items, bots, lo, hi = 0, set(), None, None
            for b in self.bots:
                if self.pool_of(b) != p:
                    continue
                for _i, c in self.cells(b, t0, t):
                    for v, (n, it, s0, s1) in c['v'].items():
                        if v.split('+')[0] != BV:
                            continue
                        bots.add(b); items += it
                        lo = s0 if lo is None else min(lo, s0); hi = s1 if hi is None else max(hi, s1)
            if bots:
                h = (hi - lo) / 3600 * len(bots)
                out[p] = items / h if h else 0.0
        return out

    def expo(self, t):
        """immobiledid POOLS=1 as drawrec reads it: >= 8 livelock_escape OR >= 20 entombed+marooned in [t-180, t)."""
        t0 = t - dt.timedelta(minutes=180)
        ll, cl = collections.Counter(), collections.Counter()
        for b in self.bots:
            for _i, c in self.cells(b, t0, t):
                ll[self.pool_of(b)] += c['ll']; cl[self.pool_of(b)] += c['cl']
        return {p for p in self.pools if ll[p] >= 8 or cl[p] >= 20}

    def allowed(self, run, t):
        """drawexposure.py: None = no requirement declared; else the pools meeting EVERY requirement over its hours."""
        reg = self.reg(run) or {}
        de = reg.get('draw_exposure')
        if not de:
            return None
        t0 = t - dt.timedelta(hours=de.get('hours', 6))
        ok = []
        for p in self.pools:
            if p == 'placebo-c' or p.startswith('isolated'):
                continue
            good = True
            for rq in de['require']:
                key = (rq['kind'].lstrip('_'), rq.get('detail_contains') or '')
                if key not in self.specs:
                    raise KeyError('requirement %r was not scanned' % (key,))
                k = str(self.specs.index(key))
                n = sum(c['k'].get(k, 0) for b in self.bots if self.pool_of(b) == p for _i, c in self.cells(b, t0, t))
                if n < rq['min']:
                    good = False
            if good:
                ok.append(p)
        return ok

    def bot_hour(self, b, t, minutes=60):
        """drawsteady.bot_stats over the last hour: rows, builds (7-char), corrupt lines, mean bag over the hour and
        each half (None where a half has no bag reading); plus depth rows."""
        t0 = t - dt.timedelta(minutes=minutes)
        mid = self.bi(t0) + (minutes // 2) * 60 // self.BS
        rows = bad = 0; vs = set(); s = [0, 0, 0, 0, 0, 0]; pos = [0, 0]; last = None
        for i, c in self.cells(b, t0, t):
            n = sum(v[0] for v in c['v'].values())
            rows += n; bad += c['bad']
            vs |= {k[:7] for k, v in c['v'].items() if v[0]}
            j = 0 if i < mid else 2
            s[j] += c['bag'][0]; s[j + 1] += c['bag'][1]
            pos[0] += c['pos'][0]; pos[1] += c['pos'][1]
            if n:
                last = i
        mean = lambda a, n: a / n if n else None
        return {'rows': rows, 'versions': vs, 'bad': bad, 'm': mean(s[0] + s[2], s[1] + s[3]), 'h1': mean(s[0], s[1]),
                'h2': mean(s[2], s[3]), 'pos': pos, 'active': last is not None and last >= self.bi(t) - 3}

    def qualify(self, p, t, fv, build='single'):
        """drawsteady.qualify on the buckets; 'active' = a row in the last 15 min (the unit list is not historical)."""
        bots = [b for b in self.bots if self.pool_of(b) == p]
        st = {}
        for b in bots:
            s = self.bot_hour(b, t)
            if not s['active']:
                return None, '%s: no row in the last 15 min (unit down?)' % b
            if s['bad']:
                return None, '%s: %d corrupt line(s)' % (b, s['bad'])
            if s['rows'] < self.DS.MIN_ROWS:
                return None, '%s: %d rows in 60 min' % (b, s['rows'])
            if build == 'single' and s['versions'] != {fv}:
                return None, '%s: builds %s in the last 60 min (restart lag)' % (b, sorted(s['versions']))
            if s['h1'] is None or s['h2'] is None:
                return None, '%s: no bag reading in one half of the hour' % b
            st[b] = s
        if build == 'sym':
            # 240, not 60: the gate's transition allowance is capped at 10% of the window's rows, and a fleet-wide
            # restart (80 bots x 12 s = 16 min) fills two of six buckets of a 60-min window
            ok, why = self.sym_clean(p, t, 240)
            if not ok:
                return None, 'S2 (240 min): ' + why
        n = len(bots)
        m = sum(st[b]['m'] for b in bots) / n; h1 = sum(st[b]['h1'] for b in bots) / n; h2 = sum(st[b]['h2'] for b in bots) / n
        np_ = sum(st[b]['pos'][0] for b in bots); nd = sum(st[b]['pos'][1] for b in bots)
        return {'m': m, 'h1': h1, 'h2': h2, 'd': h2 - h1, 'bots': n, 'deep': self.SR.depth_share(np_, nd)}, 'qualified'

    def version_clean(self, p, t, minutes):
        """drawsteady.version_clean on the buckets over [t - minutes, t)."""
        fv = (self.base_at(t) or '')[:7]
        t0 = t - dt.timedelta(minutes=minutes)
        have = set()
        for b in [b for b in self.bots if self.pool_of(b) == p]:
            vs, first, lastb = set(), False, False
            for i, c in self.cells(b, t0, t):
                if c['bad']:
                    return False, '%s: corrupt lines' % b
                k = {x[:7] for x, v in c['v'].items() if v[0]}
                if not k:
                    continue
                vs |= k
                first |= i < self.bi(t0 + dt.timedelta(minutes=60)); lastb |= i >= self.bi(t - dt.timedelta(minutes=60))
                have.add((i - self.bi(t0)) // 2)
            if vs != {fv}:
                return False, '%s: builds %s in the last %d min' % (b, sorted(vs), minutes)
            if not (first and lastb):
                return False, '%s: no rows in the first or last hour' % b
        nb = minutes // 10
        if len(have) < nb:
            return False, 'rows in %d of %d 10-min buckets' % (len(have), nb)
        return True, 'one build %s for %d min' % (fv, minutes)

    def sym_clean(self, p, t, minutes):
        """S2 = settlerule.symmetric_build -> tierrule.asymmetric_rows over [t - minutes, t): the pool as the canary
        arm, every other non-isolated bot as the control arm, 10-min buckets of FULL code.version row counts."""
        t0 = t - dt.timedelta(minutes=minutes)
        i0 = self.bi(t0)
        bad = [0]

        def bk(b):
            out = {}
            for i, c in self.cells(b, t0, t):
                bad[0] += c['bad']
                cc = out.setdefault((i - i0) // 2, {})
                for v, x in c['v'].items():
                    if x[0]:
                        cc[v] = cc.get(v, 0) + x[0]
            return out
        mine = [b for b in self.bots if self.pool_of(b) == p]
        can = {b: bk(b) for b in mine}
        ctl = {b: bk(b) for b in self.bots if self.pool_of(b) != p and not b.startswith('isolated')}
        return self.SR.symmetric_build(lambda a, c2, r, s0, s1, _b: self.TR.asymmetric_rows(a, c2, r, s0, s1, bad[0]),
                                       can, ctl, mine, t0, t)

    # ----------------------------------------------------------------------------------------------- the draw --
    def ledger_rows(self, t):
        """The ledger as of t; a run in self.override (the CASCADE, Claude r1 P1) decided on its counterfactual pools."""
        rows, fleet = self.DS.parse_ledger(self.ledger_lines, t)
        ov = getattr(self, 'override', {})
        if ov:
            rows = [dict(r, canary_pool=','.join(sorted(ov[self.TR.run_of(r)])))
                    if self.TR.run_of(r) in ov else r for r in rows]
        return rows, fleet

    def journal_upto(self, t):
        return [r for r in self.journal if T(r['ts']) <= t]

    def steady_release(self, t, run, rule):
        """-> (released pools, notes). rule: 'today' | a settle variant dict for replay_settle.py."""
        rows, fleet = self.ledger_rows(t)
        notes = []
        if t < V351:
            return set(), ['before v35.1: 12 h for every pool']
        if fleet:
            return set(), ['fleet-wide row in 12 h: nothing released']
        jr = self.journal_upto(t)
        reg = self.reg(run) or {}
        t2 = t >= V36 and self.TR.tier_of(reg) == 2
        cand, held = (self.DS.candidates_t2 if t2 else self.DS.candidates)(rows, jr, t)
        touched = set(held) | set(cand) | self.live_pools(t)
        settle = {}
        tier = self.TR.tier_of(reg) if t >= V36 else 3
        if rule != 'today':
            # the replay DECLARES each run's settle.lookback_min (no past registration carries one), as its author would
            reg = dict(reg, settle={'lookback_min': rule['lookback'].get(run, 0)})
            table = rule['table'](reg) if callable(rule['table']) else rule['table']
            settle, sheld = self.SR.candidates_settle(rows, jr, t, reg, tier, self.DS.pools_in, self.TR.close_of,
                                                      self.TR.closes, self.TR.run_of, table, self.TR.ledger_tier)
            touched |= set(settle) | set(sheld)
            notes.append('settle path: %s; %d candidate(s)' % (self.SR.incoming_ok(reg)[1], len(settle)))
        fv = (self.base_at(t) or '')[:7]
        ctl = {}
        for p in self.pools:
            if p in touched or p == 'placebo-c' or p.startswith('isolated'):
                continue
            ctl[p] = self.qualify(p, t, fv)[0]
        rel = set()
        for p, c in cand.items():
            s, qwhy = self.qualify(p, t, fv)
            fd = c[3] if t2 and c[4] == 'torn-down' else self.declared_at(t)
            ok, why = self.DS.steady(c[:3], s, ctl, self.base_at(t), fd)
            if ok and t2:
                ok, vwhy = self.version_clean(p, t, 240); why += ' | ' + vwhy
            notes.append('today %s %s: %s' % ('REL' if ok else 'held', p, why if s else qwhy))
            if ok:
                rel.add(p)
        self.last_settle = {}
        sctl_all = {}
        if settle:
            # the settle path's own controls: S1 + the SYMMETRIC build test over the hour (not "one build")
            live = self.live_pools(t)
            for p in self.pools:
                if p in live or p == 'placebo-c' or p.startswith('isolated'):
                    continue
                if rule.get('controls', 'untouched') == 'untouched' and p in touched:
                    continue
                if p in sheld:
                    continue          # still inside a floor, or held for a reason the settle path keeps: not a reference
                sctl_all[p] = self.qualify(p, t, fv, build='sym')[0]
        for p, c in settle.items():
            if p in rel:
                continue
            # siblings-out: the reference is every settled pool EXCEPT this one and the pools of its own decision
            sibs = {q for r in rows if self.TR.run_of(r) == c[0] for q in self.DS.pools_in(r)}
            sctl = {q: v for q, v in sctl_all.items() if q != p and q not in sibs}
            floor = c[5]
            s, why = self.qualify(p, t, fv, build='sym')
            ok = s is not None
            if ok:
                ok, why = self.sym_clean(p, t, max(60, floor))
                why = 'S2 %d min: %s' % (max(60, floor), why)
            if ok:
                # steady()'s carryover bands (rule 3); its fleet-version test passes with the close as the build's
                # start, which S2 has just verified from the rows
                ok, bwhy = self.DS.steady(c[:3], s, sctl, self.base_at(t), c[3])
                why += ' | ' + bwhy
            if ok and rule.get('depth', True):
                ok, dwhy = self.SR.band_ok(s['deep'], [x['deep'] for x in sctl.values() if x], 'depth y<50 share')
                why += ' | ' + dwhy
            notes.append('settle %s %s (pred %s %s, closed %s, floor %d): %s' % (
                'REL' if ok else 'held', p, c[0], c[4], ISO(c[3]), floor, why))
            if ok:
                rel.add(p); self.last_settle[p] = c
        return rel, notes

    def eligible(self, t, run, rule='today'):
        """drawrec.sh at t for `run` -> (eligible list, info)."""
        rows, _f = self.ledger_rows(t)
        excl = set()
        for r in rows:
            if (t - T(r['ts'])).total_seconds() < 12 * 3600 and T(r['ts']) <= t:
                excl |= self.DS.pools_in(r)
        early, notes = self.steady_release(t, run, rule)
        excl -= early
        excl |= self.live_pools(t)
        band = self.band(t)
        _all = sorted(band.values())
        med = _all[len(_all) // 2] if _all else 0
        ex = self.expo(t)
        allowed = self.allowed(run, t) if run else None

        def elig(w):
            return [p for p, ibh in sorted(band.items()) if p != 'placebo-c' and not p.startswith('isolated')
                    and p not in excl and med and abs(ibh - med) / med <= w and p in ex
                    and (allowed is None or p in allowed)]
        e = elig(0.25)
        if len(e) < 4:
            e = elig(0.40)
        info = {'excl': sorted(excl), 'early': sorted(early), 'band': {p: round(v, 1) for p, v in band.items()},
                'median': round(med, 1), 'expo_ok': sorted(ex), 'allowed': allowed, 'notes': notes}
        reg = self.reg(run) or {}
        req = reg.get('draw_require_pools')
        if req:
            if any(p in excl or p not in band for p in req):
                info['require'] = 'required %s not drawable' % req
                return [], info
            e = sorted(set(req) | set(e))
        return e, info

    def attribute(self, t, run):
        """WHY each ledger-excluded pool was out of the draw at t, and whether it would have been eligible had it been
        released (band, exposure filter, draw_exposure). -> {pool: (category, detail, would_be_eligible)}."""
        e, info = self.eligible(t, run)
        rows, fleet = self.ledger_rows(t)
        reg = self.reg(run) or {}
        t2 = t >= V36 and self.TR.tier_of(reg) == 2
        jr = self.journal_upto(t)
        cl = self.TR.closes(jr)
        band, med = info['band'], info['median']
        out = {}
        live = self.live_pools(t)
        for p in sorted(set(info['excl']) - live):
            ibh = band.get(p)
            fits = (ibh is not None and med and abs(ibh - med) / med <= 0.40 and p in info['expo_ok']
                    and (info['allowed'] is None or p in info['allowed']) and p != 'placebo-c')
            decs = [r for r in rows if p in self.DS.pools_in(r)]
            cats = []
            for r in decs:
                run_ = self.TR.run_of(r)
                ct, how = self.TR.close_of(run_, str(r.get('canary_sha') or '')[:7], T(r['ts']), cl, t)
                age = (t - ct).total_seconds() / 60 if ct else None
                d = str(r.get('decision')).upper()
                if d == 'REVERT' and self.SR.kind_of(r, how) is None:
                    cats.append(('death-REVERT 12h', run_, age))
                elif d in ('REVERT', 'INCONCLUSIVE'):
                    cats.append(('%s 12h' % d, run_, age))
                elif d == 'KEEP' and how == 'promoted':
                    tier_pred = self.TR.ledger_tier(r)
                    need = (240 if tier_pred == 2 else 360) if t2 else 360
                    cats.append(('KEEP+promoted < %d min' % need if age is not None and age < need else
                                 'KEEP+promoted, timer passed, failed a steady check', run_, age))
                else:
                    cats.append(('KEEP not promoted / not closed', run_, age))
            note = [n for n in info['notes'] if (' %s:' % p) in n or (' %s ' % p) in n]
            out[p] = (cats, note[:1], fits)
        return e, info, out

    def k_target(self, run):
        reg = self.reg(run) or {}
        if reg.get('class') == 'model-env':
            return reg.get('draw_k') or 2, 1
        if reg.get('class') == 'bag-fix':
            return 4, 4
        return 4, 2
