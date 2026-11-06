#!/usr/bin/env python3
"""trip_replay.py -- replay the showcase tripwire's REAL history through the phase 1 item 4 policy (stop only for harm, roll back
a release activated < 3 h ago). Reads copies of /srv/showcase/ops/trip.log and deploy.jsonl; optional: a `journalctl -o json
_PID=1` export (S7 crash loops per read window). Reads only; prints one line per read whose action changes, then the totals.

    python3 infra/showcase/trip_replay.py --trip-log trip.log --deploy deploy.jsonl [--journal pid1.json] [--since 2026-10-22]

Per read: the OLD verdict (as logged), each logged reason re-classed by showcase_trip's HARM_GATES / gate prefixes (the reasons
are the read's own words, so the classification is exact, not re-derived), the NEW verdict, and for a NEW TRIP the remedy
showcase_ops.remedy_plan would choose against the activations journalled before that read (AUTO_ROLLBACK on).
"""
import argparse, collections, datetime as dt, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.append(os.path.join(HERE, '..', '..', 'scripts', 'lib'))
import showcase_trip as TRIP  # noqa: E402
import showcase_ops as SO     # noqa: E402

UTC = dt.timezone.utc
RUN = re.compile(r'^===== (\S+) rc=(\d+)')
WINDOW = re.compile(r'^SHOWCASE TRIPWIRE \S+\s+window (\S+) \.\. ')
INFO = ('S3 DEEP below a village floor', 'H2 clear_outside tree debris', 'S6 H2 clear_outside tree debris', 'S6 g5_unjudged (blind)')
NO_SURVEY = re.compile(r'^EXPOSURE     shop: .*surveys False')


def reason_class(r, no_survey=False):
    """A logged VERDICT reason -> 'harm' | 'report' | 'watch' | 'info'. Pure; the same split as showcase_trip.classify.
    no_survey: the read's own EXPOSURE line says surveys False -- only then is conformance UNJUDGED counts-only (OWNER 11-06)."""
    r = r.strip()
    if any(r.startswith(x) for x in INFO) or (no_survey and r.startswith('S6 conformance UNJUDGED')):
        return 'info'
    p = r.split()
    if not p:
        return 'watch'
    if r.startswith('S0 no showcase bot wrote a row'):
        return 'harm'
    if p[0] == 'S1' and len(p) > 1 and p[1].isdigit():
        return 'harm' if int(p[1]) >= TRIP.DEATH_TRIP else 'watch'
    if r.startswith('S3 Z1 trapped'):
        return 'harm'
    if p[0] == 'S4' and 'BREACH' in r:
        return 'harm'
    if p[0] == 'S7' and 'crash loop' in r and 'not judged' not in r:
        return 'harm'
    if p[0] in ('S5', 'S6') and len(p) >= 4 and re.fullmatch(r'\d+', p[-1] if p[0] == 'S5' else p[3] if len(p) > 3 else ''):
        gate = ' '.join(p[1:3])
        if re.fullmatch(r'[DGH]\d', p[1]):
            return 'harm' if gate in TRIP.HARM_GATES else 'report'
    return 'watch'


def split_reasons(why):
    """The VERDICT line's '; '-joined reasons, without splitting inside a bracket. Pure."""
    out, depth, cur = [], 0, ''
    i = 0
    while i < len(why):
        c = why[i]
        depth += c in '[{('
        depth -= c in ']})'
        if depth == 0 and why.startswith('; ', i):
            out.append(cur)
            cur, i = '', i + 2
            continue
        cur += c
        i += 1
    if cur.strip():
        out.append(cur)
    return out


def parse(text):
    """trip.log -> [(t, rc, verdict, [reasons], window start | None, no survey source)]. Pure. A block's lines come BEFORE its '=====' line
    trip-cron writes '===== <t> rc=N' and then the read's output, so its header and VERDICT follow that line."""
    out, cur, win, nos = [], None, None, False
    for line in text.splitlines():
        m = RUN.match(line)
        if m:
            cur, win, nos = (TRIP.ts(m.group(1)), int(m.group(2))), None, False
            continue
        if NO_SURVEY.match(line):
            nos = True
        w = WINDOW.match(line)
        if w and cur:
            win = TRIP.ts(w.group(1))
        if line.startswith('VERDICT') and cur:
            v, _, why = line[len('VERDICT'):].strip().partition(' -- ')
            out.append((cur[0], cur[1], v.strip(), split_reasons(why.strip()), win, nos))
            cur = None
    return out


def crash_by_read(journal_lines, reads, span_min=180):
    """{read t: ({bot: peak}, {bot: [iso]})} for every (read t, window start), from a journalctl json export: the read's own
    window (its RUN_SINCE epoch cut included), as crash_facts reads it. Pure."""
    rows = []
    for l in journal_lines:
        try:
            j = json.loads(l)
            rows.append((int(j['__REALTIME_TIMESTAMP']) / 1e6, l))
        except (ValueError, KeyError):
            continue
    out = {}
    for t, w in reads:
        hi, lo = t.timestamp(), (w or (t - dt.timedelta(minutes=span_min))).timestamp()
        tt = {}
        loops = TRIP.crash_loops([l for s, l in rows if lo <= s <= hi], times_out=tt)[0]
        out[t] = (loops, {b: v for b, v in tt.items() if b in loops})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--trip-log', required=True)
    ap.add_argument('--deploy', required=True)
    ap.add_argument('--journal')
    ap.add_argument('--since', default='2026-10-22')
    a = ap.parse_args(argv)
    since = TRIP.ts(a.since + ('T00:00:00Z' if 'T' not in a.since else ''))
    reads = [r for r in parse(open(a.trip_log, errors='replace').read()) if r[0] >= since]
    deploy = [json.loads(l) for l in open(a.deploy) if l.strip().startswith('{')]
    crash = crash_by_read(open(a.journal).read().splitlines(), [(r[0], r[4]) for r in reads]) if a.journal else {}
    tot = collections.Counter()
    print('reads %d from %s (positive control: verdicts %s)' % (len(reads), since.date(), dict(collections.Counter(r[2] for r in reads))))
    for t, rc, old, reasons, _win, nos in reads:
        cls = collections.defaultdict(list)
        for r in reasons:
            cls[reason_class(r, nos)].append(r)
        loops, ctimes = crash.get(t) or ({}, {})
        if loops:
            cls['harm'].append('S7 crash loop (>= %d restarts in %d min) %s' % (TRIP.CRASH_RESTARTS, TRIP.CRASH_SPAN_MIN, loops))
        new = 'TRIP' if cls['harm'] else 'REPORT' if cls['report'] else 'WATCH' if cls['watch'] else 'OK'
        tot[(old, new)] += 1
        if old == new and old != 'TRIP':
            continue
        line = '%s  %-6s -> %-6s' % (t.strftime('%m-%d %H:%MZ'), old, new)
        if new == 'TRIP':
            prior = [r for r in deploy if TRIP.ts(r.get('t')) <= t]
            acts = [r for r in prior if r.get('event') == 'activated']
            cur = acts[-1]['release'] if acts else None
            plan = SO.remedy_plan({'t': t.strftime('%FT%TZ'), 'verdict': 'TRIP', 'harm': cls['harm'], 'why': cls['harm'],
                                   'harm_evidence': {'S7': ctimes}},
                                  prior, cur, t, True)
            line += '  harm %s  REMEDY %s (%s)' % ([x[:70] for x in cls['harm']], plan['action'], plan['why'][:120])
            tot['remedy ' + plan['action']] += 1
        elif new == 'REPORT':
            line += '  report %s' % [x[:60] for x in cls['report']]
        elif old == 'WATCH' and new == 'OK':
            line = None
            tot['watch->ok (noise only)'] += 1
        if line:
            print(line)
    print('TOTALS', dict(sorted(tot.items(), key=str)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
