#!/usr/bin/env python3
"""Pre-deploy guard: prove every declared change/linkage row can actually discriminate.

    changerowcheck.py <run_id> [--hours 6] [--registrations DIR]

A "change row" is what licenses a REVERT from a SINGLE canary death (v12 linkage): the
claim is "this row shows the change acted on the bot that died". That claim is false for
two kinds of row, and both have now cost a canary:

  recovery-ladder-13  (16 Sep 23:20Z)  `death_site_recorded` -- written BY the death
      handler, so every canary death carried it. A consequence, not a cause.
  recovery-ladder-13b (17 Sep 04:13Z)  `flooded_pocket_rung` -- the rung is fleet-wide on
      1d6c97d, so the BASELINE emits it. Measured over that canary's own window: 10 rows
      on 10 canary bots, 12 rows on 70 control bots, and a control death (isolated-a-Echo
      00:01:45, "drowned; idle") carried the row inside its own 60 s window. The test,
      applied to control, would have reverted control.

This script is the mechanical half of the fix (CLAUDE.md: prefer a mechanism to a rule).
It runs BEFORE deploy, while the whole fleet is still on the baseline, so every pool is a
control. A declared row the baseline already emits cannot show that the change acted, and
is refused here rather than three hours into a canary.

The other half is in verdict.py at read time, where canary rows exist: a change row may
only license a REVERT if (a) no CONTROL death in the same window carries it, and (b) it
has been seen at least once on the canary OUTSIDE a death window. (b) is what catches a
consequence row like `death_site_recorded`, which this preflight cannot see because it is
new code and the baseline is correctly silent on it.

Exit 0 = every declared row is clean. Exit 2 = at least one is refused.
"""
import argparse, collections, glob, gzip, json, os, sys, datetime as dt

MCAI = '/var/log/mcai'


def pools():
    return sorted({os.path.basename(p.rstrip('/')).rsplit('-', 1)[0]
                   for p in glob.glob(f'{MCAI}/*-*/')})


def scan(lo_iso, hi_iso):
    """Row-kind counts and the set of bots seen, over every pool, for the window."""
    days = {lo_iso[:10], hi_iso[:10]}
    kinds = collections.Counter(); bots = set(); rows = 0
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
                    # logEvent kind 'x' lands in skill.name as '_x'
                    kinds[((r.get('skill') or {}).get('name') or '').lstrip('_')] += 1
        except Exception:
            pass
    return kinds, bots, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_id')
    ap.add_argument('--hours', type=float, default=6.0)
    ap.add_argument('--registrations', default=os.path.expanduser('~/mcai-analysis/registrations'))
    a = ap.parse_args()

    reg_path = os.path.join(a.registrations, f'{a.run_id}.json')
    if not os.path.exists(reg_path):
        reg_path = f'/tmp/registrations/{a.run_id}.json'
    reg = json.load(open(reg_path))

    now = dt.datetime.now(dt.timezone.utc)
    lo, hi = now - dt.timedelta(hours=a.hours), now
    lo_iso, hi_iso = lo.strftime('%Y-%m-%dT%H:%M:%S'), hi.strftime('%Y-%m-%dT%H:%M:%S')

    kinds, bots, rows = scan(lo_iso, hi_iso)

    # Positive control FIRST: a silent instrument would pass every row for the wrong
    # reason, which is the exact failure this guard exists to stop.
    print(f'baseline window {lo_iso}Z .. {hi_iso}Z  ({a.hours:g} h)')
    print(f'positive control: {rows} rows, {len(bots)} bots, {len(kinds)} distinct row kinds')
    if rows == 0 or len(bots) < 40 or len(kinds) < 20:
        print('REFUSED: the baseline read found too little to prove anything '
              '(this is an instrument failure, not a clean bill of health)')
        return 2

    declared = sorted(set(reg.get('change_rows', [])) | set(reg.get('linkage_extra', [])))
    if not declared:
        print('no change/linkage rows declared — nothing to check')
        return 0

    bad = []
    print(f"\n{'declared row':44s}{'baseline':>10s}   verdict")
    for row in declared:
        n = kinds.get(row, 0)
        if n:
            bad.append((row, n))
            print(f'{row:44s}{n:10d}   REFUSED — the baseline emits it')
        else:
            print(f'{row:44s}{n:10d}   ok — baseline silent')

    if bad:
        print('\nREFUSED: these rows cannot license a REVERT from one death, because a bot '
              'on the OLD code emits them too:')
        for row, n in bad:
            print(f'  {row}: {n} occurrences fleet-wide on the baseline in the last {a.hours:g} h')
        print('Remove them from change_rows and linkage_extra, or name a row that only the '
              'new code can write. They stay legitimate as REPORT lines.')
        return 2

    print('\nall declared rows are silent on the baseline; the consequence-row half of the '
          'test runs in verdict.py at the first read')
    return 0


if __name__ == '__main__':
    sys.exit(main())
