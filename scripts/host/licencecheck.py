#!/usr/bin/env python3
"""Pre-deploy guard: a canary must NAME the instrument that will read it, and its CLASS.

    licencecheck.py <run_id> [--hours 6] [--registrations DIR]

WHY THIS EXISTS. `changerowcheck.py` PASSES ITS OWN NULL CASE: a registration declaring no
`change_rows` and no `linkage_extra` prints "no change/linkage rows declared -- nothing to check"
and exits 0. Measured 2026-09-25: **9 of 18 registrations on file declare nothing, and all nine
pass.** So a canary could be declared with no way to tell whether the change did anything, and two
canaries died of exactly that:

  blindstep-01  reverted on `explore_blind_step_reverse`, a row the baseline cannot emit -- so its
                control rate is zero BY CONSTRUCTION and it discriminates nothing. Verified false:
                falls were 3 in control to the canary's 1.
  leaf-01       reverted on an uncalibrated rate line that false-trips 43% of no-change windows.

THE CLASS DECIDES WHAT THE INSTRUMENT MAY DO. That is the whole idea: the escape hatch is a
DOWNGRADE, not an exemption.

  kind  a row kind the baseline CANNOT emit. Verified here: the baseline window must be SILENT.
        May licence a REVERT together with linkage.
  text  a substring of an EXISTING row's detail that one arm logically cannot write. drop5-01 is
        the worked example: `stepLineSafe` interpolates its own constant into its own `why`, so the
        baseline writes "(limit 3)" and the canary "(limit 5)" and neither can write the other's
        string. Verified here: the baseline must not contain that substring in that row.
        May licence a REVERT together with linkage.
  rate  no arm-exclusive kind or text exists; only the RATE of a shared row moves.
        **REPORT-ONLY BY CONSTRUCTION -- such a canary may not revert on any instrument**, only on
        the calibrated catastrophe gates (the death gate, v15c, v11). Enforced in verdict.py.

Measured coverage over the 23 reverted shas: kind 16 (70%), text +1 (74%), rate 3 (13%), and 3
(13%) observable only as a continuous measurement -- the cooldown constants, source-read, never
interpolated into any row. So the honest ceiling for an instrument revert is ~74%, and the
remaining quarter is told so rather than pretending.

Exit 0 = the licence is valid. Exit 2 = refused, before the draw and before three hours of fleet
time.
"""
import argparse, collections, glob, gzip, json, os, sys, datetime as dt

MCAI = os.environ.get('LICENCE_LOG_ROOT', '/var/log/mcai')
CLASSES = ('kind', 'text', 'rate')


def scan(lo_iso, hi_iso, want_kinds, want_texts):
    """(kind counts, text hits, bots, rows) over the baseline window.

    `want_texts` is [(row_kind, substring)]; a hit means that substring appeared in the DETAIL of a
    row of that kind. changerowcheck.py counts `skill.name` only and so has no text capability at
    all -- that gap is why the `text` class needed its own checker rather than a flag.
    """
    days = {lo_iso[:10], hi_iso[:10]}
    kinds = collections.Counter(); texts = collections.Counter(); bots = set(); rows = 0
    for f in glob.glob(f'{MCAI}/*-*/skill-*.jsonl') + glob.glob(f'{MCAI}/*-*/skill-*.jsonl-*.gz'):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for l in fh:
                    if not any(d in l[:60] for d in days):
                        continue
                    try:
                        r = json.loads(l)
                    except ValueError:
                        continue
                    ts = r.get('@timestamp', '')
                    if not (lo_iso <= ts[:19] <= hi_iso):
                        continue
                    rows += 1
                    bots.add((r.get('bot') or {}).get('name', ''))
                    sk = r.get('skill') or {}
                    k = (sk.get('name') or '').lstrip('_')
                    kinds[k] += 1
                    if want_texts:
                        d = sk.get('detail') or ''
                        for (wk, sub) in want_texts:
                            if k == wk.lstrip('_') and sub in d:
                                texts[(wk, sub)] += 1
        except Exception:
            pass
    return kinds, texts, bots, rows


def validate(lic):
    """(errors, class). PURE, so the tests can drive it without a fleet."""
    errs = []
    if not isinstance(lic, dict):
        return (['no `licence` block: a canary must NAME the instrument that will read it and its '
                 'class (one of %s). changerowcheck.py passes its own null case, which is how 9 of '
                 '18 registrations came to declare nothing at all.' % ', '.join(CLASSES)], None)
    cls = lic.get('class')
    if cls not in CLASSES:
        errs.append('licence.class is %r, must be one of %s' % (cls, ', '.join(CLASSES)))
        return (errs, None)
    if cls == 'kind' and not lic.get('kind'):
        errs.append('licence.class=kind requires `kind`: the row the baseline cannot emit')
    if cls == 'text':
        if not lic.get('row'):
            errs.append('licence.class=text requires `row`: the existing row whose detail carries it')
        if not lic.get('text'):
            errs.append('licence.class=text requires `text`: the substring one arm cannot write')
    if cls in ('kind', 'text'):
        mr = lic.get('min_rows')
        if mr is None:
            errs.append('licence.min_rows is required for class=%s: an instrument that never fires '
                        'is indistinguishable from one that found nothing, and 10 of 23 revert '
                        'windows had NO arm-exclusive row fire at all' % cls)
        elif not isinstance(mr, int) or mr < 1:
            errs.append('licence.min_rows must be a positive integer, got %r' % (mr,))
    return (errs, cls)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_id')
    ap.add_argument('--hours', type=float, default=6.0)
    ap.add_argument('--registrations', default=os.path.expanduser('~/mcai-analysis/registrations'))
    a = ap.parse_args()
    reg = json.load(open(os.path.join(a.registrations, '%s.json' % a.run_id)))
    lic = reg.get('licence')
    errs, cls = validate(lic)
    if errs:
        print('REFUSED (licence): %s' % a.run_id)
        for e in errs:
            print('  - %s' % e)
        return 2

    if cls == 'rate':
        print('licence class RATE for %s: no arm-exclusive kind or text exists.' % a.run_id)
        print('  This canary is REPORT-ONLY BY CONSTRUCTION. It may not revert on any instrument --')
        print('  only on the calibrated catastrophe gates (the death gate, v15c, v11). That is the')
        print('  honest reading of a change whose only signal is the rate of a row both arms emit:')
        print('  leaf-01 died on exactly this class with a line that false-trips 43% of no-change')
        print('  windows. Enforced at read time in verdict.py, not merely advised here.')
        return 0

    now = dt.datetime.now(dt.timezone.utc)
    lo = (now - dt.timedelta(hours=a.hours)).isoformat()[:19]
    hi = now.isoformat()[:19]
    wk = [lic['kind']] if cls == 'kind' else []
    wt = [(lic['row'], lic['text'])] if cls == 'text' else []
    kinds, texts, bots, rows = scan(lo, hi, wk, wt)

    # POSITIVE CONTROL FIRST. A silent baseline proves nothing if the scan saw nothing.
    print('baseline window %s .. %s : %d rows, %d bots, %d distinct kinds'
          % (lo, hi, rows, len(bots), len(kinds)))
    if rows < 1000 or len(bots) < 10:
        print('REFUSED: the baseline read found too little to prove anything (%d rows, %d bots). '
              'A silence that might be the instrument is not evidence.' % (rows, len(bots)))
        return 2

    if cls == 'kind':
        k = lic['kind'].lstrip('_')
        n = kinds.get(k, 0)
        print('  class=kind  %-40s baseline rows: %d' % (lic['kind'], n))
        if n:
            print('REFUSED: the baseline EMITS %s (%d rows in %.0f h), so it cannot show the change '
                  'acted -- that is recovery-ladder-13b exactly. Name a row only the new code can '
                  'write, or declare class=rate and accept report-only.' % (lic['kind'], n, a.hours))
            return 2
        # the row must also be one the change actually adds, which this cannot see; say so.
        print('  the baseline is silent on it. NOTE: this proves the baseline cannot emit it; it '
              'does NOT prove the canary will. licence.min_rows=%d is checked at the first read.'
              % lic['min_rows'])
        return 0

    row, sub = lic['row'], lic['text']
    present_row = kinds.get(row.lstrip('_'), 0)
    hits = texts.get((row, sub), 0)
    print('  class=text  row %-32s baseline rows: %d' % (row, present_row))
    print('              text %-31r baseline hits: %d' % (sub, hits))
    if not present_row:
        print('REFUSED: the baseline never emits %s at all, so a TEXT predicate on it is untestable '
              'here and the class is wrong -- if only the new code writes the row, declare '
              'class=kind.' % row)
        return 2
    if hits:
        print('REFUSED: the baseline already writes %r inside %s (%d hits), so both arms can produce '
              'it and it discriminates nothing.' % (sub, row, hits))
        return 2
    print('  the baseline emits the row %d times and NEVER writes %r in it, so the two arms cannot '
          'produce each other\'s string. licence.min_rows=%d is checked at the first read.'
          % (present_row, sub, lic['min_rows']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
