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


def version_of(r):
    """The 7-char sha a row was written by, or '' when the row carries none."""
    return str(((r.get('code') or {}).get('version')) or '').split('+')[0][:7]


def tally(records, baseline):
    """PURE. Split row-kind counts by WHO wrote them: the declared baseline, or another build.

    `records` yields parsed rows already inside the window; `baseline` is the manifest's
    declared_code_version. Returns (base_kinds, other_kinds, unknown_kinds, base_bots, rows): base_kinds
    counts kind -> rows written by the baseline, other_kinds (kind, sha7) -> rows from any other build,
    unknown_kinds kind -> rows that carry NO version, and base_bots the bots seen on the baseline build
    (the positive control counts THOSE, not every bot -- round 1: 39 other-build bots must not vouch
    for a baseline read).

    WHY (2026-10-07 19:46Z): the 6 h window after a canary's teardown still holds that canary's
    own rows. towndeposit-02 was REFUSED because 40 `town_deposit` rows came from the previous
    canary (towndeposit-01 on 92bc84f, board-b + placebo-a, 13:06-16:15Z) and none from the
    baseline c6e91a8. "The baseline emits it" was false of the baseline and true of the window.
    A row with NO version is neither: it is reported separately, and a declared row seen ONLY there is
    refused for that stated reason (it cannot be shown not to be the baseline's).
    """
    want = str(baseline or '').split('+')[0][:7]
    base, other, unknown = collections.Counter(), collections.Counter(), collections.Counter()
    base_bots = set(); rows = 0
    for r in records:
        rows += 1
        # logEvent kind 'x' lands in skill.name as '_x'
        k = ((r.get('skill') or {}).get('name') or '').lstrip('_')
        v = version_of(r)
        if not v:
            unknown[k] += 1
        elif v == want:
            base[k] += 1
            base_bots.add((r.get('bot') or {}).get('name', ''))
        else:
            other[(k, v)] += 1
    return base, other, unknown, base_bots, rows


def _records(lo_iso, hi_iso):
    days = {lo_iso[:10], hi_iso[:10]}
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
                    yield r
        except Exception:
            pass


def scan(lo_iso, hi_iso, baseline):
    """Row-kind counts split by build, and the set of bots seen, over every pool, for the window."""
    return tally(_records(lo_iso, hi_iso), baseline)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_id')
    ap.add_argument('--hours', type=float, default=6.0)
    ap.add_argument('--registrations', default=os.path.expanduser('~/mcai-analysis/registrations'))
    ap.add_argument('--manifest', default='/srv/mcbots/trial-manifest.json')
    a = ap.parse_args()

    reg_path = os.path.join(a.registrations, f'{a.run_id}.json')
    if not os.path.exists(reg_path):
        reg_path = f'/tmp/registrations/{a.run_id}.json'
    reg = json.load(open(reg_path))

    now = dt.datetime.now(dt.timezone.utc)
    lo, hi = now - dt.timedelta(hours=a.hours), now
    lo_iso, hi_iso = lo.strftime('%Y-%m-%dT%H:%M:%S'), hi.strftime('%Y-%m-%dT%H:%M:%S')

    try:
        baseline = str(json.load(open(a.manifest)).get('declared_code_version') or '')
    except Exception as e:
        baseline = ''
        print(f'manifest unreadable: {type(e).__name__}: {e}')
    if not baseline:
        # NO BASELINE, NO TEST: without a declared version every row would count as "baseline",
        # which refuses -- but saying so is better than refusing for a reason it does not name.
        print('REFUSED: the trial manifest declares no declared_code_version, so the baseline '
              'cannot be told apart from other builds. Fix the manifest, then rerun.')
        return 2
    kinds, other, unknown, bots, rows = scan(lo_iso, hi_iso, baseline)
    base_rows = sum(kinds.values())

    # Positive control FIRST: a silent instrument would pass every row for the wrong
    # reason, which is the exact failure this guard exists to stop.
    print(f'baseline window {lo_iso}Z .. {hi_iso}Z  ({a.hours:g} h); baseline build {baseline[:7]}')
    print(f'positive control: {rows} rows; {base_rows} rows from the baseline build on {len(bots)} bots '
          f'({len(kinds)} distinct row kinds), {sum(other.values())} from other builds, '
          f'{sum(unknown.values())} with no version')
    if base_rows == 0 or len(bots) < 40 or len(kinds) < 20:
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
        u = unknown.get(row, 0)
        if n:
            bad.append((row, n))
            print(f'{row:44s}{n:10d}   REFUSED — the baseline emits it')
        elif u:
            bad.append((row, u))
            print(f'{row:44s}{n:10d}   REFUSED — {u} row(s) carry no version, so they cannot be shown not to be the baseline\'s')
        else:
            print(f'{row:44s}{n:10d}   ok — baseline silent')
        for (k, v), m in sorted(other.items()):
            if k == row:
                print(f'  note: {row}: {m} row(s) from build {v} (NOT the baseline {baseline[:7]}; '
                      f'a previous canary or restart lag) -- reported, not counted')

    if bad:
        print('\nREFUSED: these rows cannot license a REVERT from one death, because a bot '
              'on the OLD code emits them too:')
        for row, n in bad:
            print(f'  {row}: {n} occurrences fleet-wide from the baseline build {baseline[:7]} (or with no version) in the last {a.hours:g} h')
        print('Remove them from change_rows and linkage_extra, or name a row that only the '
              'new code can write. They stay legitimate as REPORT lines.')
        return 2

    print('\nall declared rows are silent on the baseline; the consequence-row half of the '
          'test runs in verdict.py at the first read')
    return 0


if __name__ == '__main__':
    sys.exit(main())
