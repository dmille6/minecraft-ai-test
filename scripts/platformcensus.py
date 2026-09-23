#!/usr/bin/env python3
"""platformcensus -- is every data stream we believe we have actually being written, by
every source we believe is writing it?

WHY THIS EXISTS. Three separate times this project has believed it had data it did not
have: `mcai-mc-paper` was named `mcai-mc-server` in my own notes and read as "never
shipped" when it had 25,782 documents; a script covered 12 worlds and 60 bots while the
fleet ran 16 and 80, so every total was 30% low; and filebeat on the worlds host is
INACTIVE with no config at all, so a log source we discuss as if it were shipping is not.
Each was found by accident. This finds them on purpose.

THE DESIGN RULE THAT MATTERS: no expected count is hardcoded anywhere in this file.
Hardcoded fleet sizes are exactly how the 12-vs-16-world error happened, and a constant
that was true when it was typed is the single most common defect in this repo's tooling.
Instead, every stream is judged against ITS OWN RECENT PAST: sources seen in the trailing
7 days but silent in the last 24h are LOST, and that comparison needs no constant to be
correct. It cannot tell you about a source that never reported once -- nothing internal
can -- so that gap is named in the output rather than hidden.

Every verdict carries its positive control in the same line, because a zero here is
usually a query bug (CLAUDE.md), and a census that cannot distinguish "nothing happened"
from "I asked the wrong question" is worse than no census.

Run on the ELK host: sudo python3 platformcensus.py
"""
import os
import sys
import datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import es  # noqa: E402

# Candidate identifier fields, in preference order. The script DISCOVERS which one a stream
# actually has from the mapping rather than assuming -- assuming a field name is how
# "84 of 84 bots immobile" got read off a `snapshot` field that does not exist.
ID_CANDIDATES = ['bot.name', 'host.name', 'agent.name', 'host.hostname']

STREAMS = ['mcai-skill-agents', 'mcai-llm-agents', 'mcai-sys-journal',
           'mcai-mc-paper', 'mcai-gpu-metrics', 'mcai-supervisor-lab']

# DELIBERATELY RETIRED SOURCES, with the reason and the date, so a correct death is not
# reported as a problem forever. This is not a way to silence inconvenient findings: each
# entry names a decision that was actually made, and the stream is still PRINTED with its
# real numbers -- it is only excluded from the problem list. The distinction matters because
# a permanently red alarm is an absent alarm, which this project has already paid for once
# (997 consecutive false alarms on mcai-guard from 2026-08-26).
#
# VERIFIED, not assumed: mcai-supervisor-lab had exactly one writer ever, mc2-ctl01-dm, and
# its last document is 2026-08-20T17:11:44Z -- which is the day instance #2's five VMs were
# stopped. The stream died because its source was switched off on purpose.
RETIRED = {
    'mcai-supervisor-lab': 'instance #2 retired 2026-08-20; sole writer mc2-ctl01-dm was '
                           'switched off, last doc 2026-08-20T17:11:44Z',
}


def _affected_share(idx, diffs):
    """Share of documents living in backing indices that do NOT map the differing fields.

    Presence of a mapping difference says nothing about how much data it touches. This turns
    it into a denominator, which is the only form in which it can be acted on.
    """
    d = es.request(f'{idx}/_mapping')
    bad, tot_bad, tot = [], 0, 0
    for name, body in d.items():
        props = body['mappings'].get('properties', {})
        missing = False
        for f in diffs:
            cur, ok = props, True
            for part in f.split('.'):
                cur = (cur or {}).get(part) if isinstance(cur, dict) else None
                if cur is None:
                    ok = False
                    break
                cur = cur.get('properties', cur)
            if not ok:
                missing = True
                break
        n = es.count(name)
        tot += n
        if missing:
            bad.append(f'{name.split("-")[-2] if "-" in name else name} ({n:,} docs)')
            tot_bad += n
    return (100.0 * tot_bad / tot if tot else 0.0), ', '.join(bad) or 'none'


def ident_field(idx, mapped):
    """The identifier field this stream actually has, and whether it is aggregatable."""
    for c in ID_CANDIDATES:
        t = mapped.get(c)
        if t == 'keyword':
            return c, None
        if t == 'text':
            # A text field cannot be aggregated. If it has a .keyword multifield, use that.
            if mapped.get(c + '.keyword') == 'keyword':
                return c + '.keyword', f'{c} is text; used {c}.keyword'
            return None, f'{c} is text with no keyword multifield -- cannot count sources'
    return None, 'no identifier field in the mapping'


def distinct(idx, field, q):
    a = es.agg(idx, {'n': {'cardinality': {'field': field}},
                     'top': {'terms': {'field': field, 'size': 200}}}, q)
    return a['n']['value'], {b['key'] for b in a['top']['buckets']}


def main():
    now = dt.datetime.now(dt.timezone.utc)
    print(f'platformcensus {now.strftime("%Y-%m-%dT%H:%M:%SZ")}  cluster {es.ES_URL}\n')
    rows, problems = [], []

    for idx in STREAMS:
        try:
            total = es.count(idx)
        except es.EsError as e:
            problems.append(f'{idx}: UNREADABLE -- {e}')
            print(f'{idx:22s} UNREADABLE  {e}')
            continue

        d24 = es.count(idx, es.last24h())
        newest = es.newest(idx)
        age_h = None
        if newest:
            t = dt.datetime.fromisoformat(newest.replace('Z', '+00:00'))
            age_h = (now - t).total_seconds() / 3600.0

        # MAPPING CONSISTENCY. ILM rolls at 10gb/7d, so a stream spans many backing indices
        # built under different template versions; a field missing from one of them shrinks
        # a bucket silently. This is the guard that found bot.held/bot.inventory absent from
        # 1 of 7 backing indices.
        n_backing, diffs = es.mapping_differs(idx)
        mapped = es.fields(idx)
        f, note = ident_field(idx, mapped)

        src24 = src7 = lost = None
        if f:
            n24, set24 = distinct(idx, f, es.last24h())
            n7, set7 = distinct(idx, f, es.window('now-7d', 'now'))
            src24, src7 = n24, n7
            lost = sorted(set7 - set24)

        rows.append((idx, total, d24, age_h, src24, src7, lost, n_backing, diffs, f, note))

        verdict = 'LIVE'
        if d24 == 0:
            verdict = 'DEAD-24h'
        elif age_h is not None and age_h > 2:
            verdict = f'STALE-{age_h:.1f}h'
        print(f'{idx:22s} {verdict:12s} total {total:>10,}  24h {d24:>9,}  '
              f'newest {("%.1fh" % age_h) if age_h is not None else "never":>7s}  '
              f'sources 24h/{"7d":<3s} {str(src24):>4s}/{str(src7):<4s}  backing {n_backing}')
        if note:
            print(f'{"":22s}   identifier: {note}')
        if diffs and idx not in RETIRED:
            share, affected = _affected_share(idx, diffs)
            head = (f'mapping differs across {n_backing} backing indices ({sorted(diffs)}); '
                    f'{share:.3f}% of documents sit in an index that does not map them')
            if share >= 1.0:
                print(f'{"":22s}   !! {head}')
                problems.append(f'{idx}: {head} -- an aggregation on those fields silently '
                                f'covers only part of its window')
            else:
                print(f'{"":22s}   info: {head}')
                print(f'{"":22s}         affected: {affected} -- immaterial, but an '
                      f'aggregation restricted to that period would be partial')
        if lost:
            print(f'{"":22s}   !! {len(lost)} source(s) reported in 7d but SILENT in 24h: '
                  f'{lost[:6]}{"..." if len(lost) > 6 else ""}')
            problems.append(f'{idx}: {len(lost)} sources lost ({lost[:3]})')
        if idx in RETIRED:
            print(f'{"":22s}   RETIRED ON PURPOSE: {RETIRED[idx]}')
        elif d24 == 0 and total > 0:
            problems.append(f'{idx}: {total:,} historical docs and ZERO in 24h -- shipping stopped')
        elif age_h is not None and 2 < age_h and d24 > 0:
            problems.append(f'{idx}: newest doc {age_h:.1f}h old')

    # POSITIVE CONTROL. If the whole census reads empty, the instrument is broken, not the
    # fleet idle. The busiest stream must be non-trivially alive or this refuses to be
    # believed -- a census that cannot see a running fleet has not measured one.
    live = [r for r in rows if r[2] > 0]
    print(f'\npositive control: {len(live)} of {len(rows)} readable streams had documents in '
          f'the last 24h; busiest = '
          f'{max(rows, key=lambda r: r[2])[0] if rows else "NONE"} '
          f'({max(r[2] for r in rows) if rows else 0:,} docs/24h)')
    if not live:
        raise SystemExit('NotAnInstrument: every stream reads zero for 24h. The fleet is '
                         'not this quiet -- fix the query or the credentials before '
                         'reporting an outage.')

    print(f'\nNOT COVERED BY THIS CENSUS, stated so it is not mistaken for a clean bill:')
    print('  - a source that has NEVER shipped once cannot appear as "lost"; only an')
    print('    external roster can catch that, and this file deliberately holds no roster.')
    print('  - documents rejected at ingest (dynamic:strict drops the whole document) are')
    print('    absent from both windows and so cancel out of the 24h-vs-7d comparison.')

    print(f'\n{len(problems)} problem(s):')
    for p in problems:
        print(f'  !! {p}')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
