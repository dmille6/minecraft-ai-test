#!/usr/bin/env python3
"""Throttled System One replay for a GPU shared with the showcase brain (owner 10-29: "lets let it run").
Python 3.9, stdlib only. Same records as `systemone_engine.py replay` (decide() is reused, resume by id), one item at a
time, with a pause between items that adapts to the showcase proxy's latency (studio_guard.proxy_window):

  - before each item: 5-min showcase p95 > --target-ms (10 s) -> gap x1.5 (cap --max-gap 120 s), at most once per --hold-s (300 s,
    the window's own length); p95 > --hot-ms (15 s) -> also cool off --hot-pause s first; p95 < --calm-ms (6 s) ->
    gap x0.85 (floor --min-gap)
  - each showcase decision appended to the proxy log since the last check that is non-200 or off the primary path (a fallback / 502 / timeout):
    pause --bad-pause s (600) and double the gap; 3 or more in any 30 min -> STOP (exit 4)
  - memory free < --min-free (35) -> STOP (exit 5); two failed samples running -> STOP (exit 6)
A record's latencyMs is the decision's own two rounds; the gaps are not in it. Logs every step to --log (jsonl).
"""
import argparse, json, os, sys, time
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import systemone_engine as E  # noqa: E402
import studio_guard as G  # noqa: E402


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0)


def bad_events(offset, path=G.PROXY):
    """Showcase decisions APPENDED to the proxy log after byte `offset` that were non-200 or not served by the
    primary. -> ([timestamps], new offset). Reading by offset counts each decision exactly once; a shrunken file
    (rotation) is read from 0."""
    out = []
    with open(path, 'rb') as fh:
        fh.seek(0, 2); size = fh.tell()
        if size < offset:
            offset = 0
        fh.seek(offset); data = fh.read()
    end = data.rfind(b'\n') + 1          # a line still being written waits for the next read
    for l in data[:end].decode('utf-8', 'replace').splitlines():
        try:
            r = json.loads(l)
        except Exception:
            continue
        if r.get('status') != 200 or r.get('path') != 'primary':
            try:
                out.append(datetime.strptime(r['t'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc))
            except Exception:
                out.append(now_utc())
    return out, offset + end


class Pacer:
    def __init__(self, a, log):
        self.a, self.log, self.gap = a, log, a.start_gap
        with open(G.PROXY, 'rb') as fh:  # bad decisions are counted from here on
            fh.seek(0, 2); self.offset = fh.tell()
        self.bad = []                # every bad decision seen during the run (timestamps)
        self.errs = 0
        self.last_raise = 0.0

    def raise_gap(self, factor):
        """Raise the gap at most once per --hold-s: the 5-min p95 lags, so re-reading the same slow window must not
        compound (run 2's first controller climbed to 153 s on one slow stretch)."""
        if time.time() - self.last_raise >= self.a.hold_s:
            self.gap = min(self.a.max_gap, self.gap * factor)
            self.last_raise = time.time()

    def note(self, **kw):
        kw['t'] = now_utc().strftime('%Y-%m-%dT%H:%M:%SZ')
        self.log.write(json.dumps(kw) + '\n'); self.log.flush()

    def check(self):
        """Before an item. -> None to go on, or an exit code to stop. Sleeps as the rules say."""
        a = self.a
        try:
            free = G.free_pct()
            if free is None:
                raise RuntimeError('memory_pressure gave no free percentage')
            w = G.proxy_window(5)
            cut = now_utc()
            new, off = bad_events(self.offset)
            self.errs = 0
        except Exception as e:
            self.errs += 1
            self.note(event='sample_error', error=str(e)[:200], errs=self.errs)
            if self.errs >= 2:
                return 6
            time.sleep(30)
            return None
        self.offset = off
        if free < a.min_free:
            self.note(event='STOP', why='free %d%% < %d' % (free, a.min_free)); return 5
        if new:
            self.bad.extend(new)
            recent = [t for t in self.bad if t >= cut - timedelta(minutes=30)]
            if len(recent) >= 3:
                self.note(event='STOP', why='%d bad showcase decisions in 30 min' % len(recent), bad=len(self.bad)); return 4
            self.gap = min(a.max_gap, self.gap * 2); self.last_raise = time.time()
            self.note(event='bad_pause', new=len(new), recent=len(recent), pause_s=a.bad_pause, gap=self.gap, **w)
            time.sleep(a.bad_pause)
            return self.check()
        p95 = w['p95'] or 0
        if p95 > a.hot_ms:
            self.raise_gap(1.5)
            self.note(event='hot_pause', pause_s=a.hot_pause, gap=self.gap, free=free, **w)
            time.sleep(a.hot_pause)
            return self.check()
        if p95 > a.target_ms:
            self.raise_gap(1.5)
        elif p95 < a.calm_ms:
            self.gap = max(a.min_gap, self.gap * 0.85)
        self.note(event='go', gap=round(self.gap, 1), free=free, **w)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--url', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--timeout', type=float, default=300)
    ap.add_argument('--log', required=True)
    ap.add_argument('--start-gap', type=float, default=30)
    ap.add_argument('--min-gap', type=float, default=10)
    ap.add_argument('--max-gap', type=float, default=120)
    ap.add_argument('--hold-s', type=float, default=300)
    ap.add_argument('--target-ms', type=int, default=10000)
    ap.add_argument('--calm-ms', type=int, default=6000)
    ap.add_argument('--hot-ms', type=int, default=15000)
    ap.add_argument('--hot-pause', type=int, default=120)
    ap.add_argument('--bad-pause', type=int, default=600)
    ap.add_argument('--min-free', type=int, default=35)
    a = ap.parse_args()
    items = [json.loads(l) for l in open(a.items) if l.strip()]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            if l.strip():
                r = json.loads(l)
                if not r.get('transport_error'):
                    done.add(r['id'])
    todo = [i for i in items if i['id'] not in done]
    be = E.HttpSystemOne(a.url, a.model, timeout=a.timeout)
    log, out = open(a.log, 'a'), open(a.out, 'a')
    pacer = Pacer(a, log)
    pacer.note(event='start', todo=len(todo), done=len(done))
    terr = 0
    for n, it in enumerate(todo, 1):
        rc = pacer.check()
        if rc is not None:
            sys.exit(rc)
        try:
            rec = E.decide(it, be)
            terr = 0
        except Exception as e:
            rec = {'id': it['id'], 'model': a.model, 'url': a.url, 'transport_error': True,
                   'error': '%s: %s' % (type(e).__name__, str(e)[:300])}
            terr += 1
        out.write(json.dumps(rec) + '\n'); out.flush()
        if terr >= 3:
            pacer.note(event='STOP', why='3 transport errors running: %s' % rec['error']); sys.exit(3)
        if n % 25 == 0:
            pacer.note(event='progress', n=n, of=len(todo))
        time.sleep(pacer.gap)
    pacer.note(event='done', n=len(todo))


if __name__ == '__main__':
    main()
