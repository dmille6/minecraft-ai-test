#!/usr/bin/env python3
"""
REFUSE TO DEPLOY A CANARY THAT CANNOT PRODUCE A RESULT.

Six trials were spent in one day on avoidable setup errors: a pool chosen on a
baseline that was wrong by 16x, three windows typed into the future, a branch
cut from main instead of the deployed baseline, and a prediction ledger that has
existed since August and has never been used for a canary. Each was caught by a
human noticing. This is the mechanism that does not need anyone to notice.

    canary-preflight.py --pool hive-d --sha ece1608 \
        --endpoint drowning_aborts --my-rate 12.77

It computes the endpoint ITSELF from telemetry, and compares that against the
rate you computed your own way. Two computations of the number that picks the
pool, or the number does not get to pick the pool. It prints EVERY blocker, not
the first one.

Exit 0 clear, exit 1 blocked, exit 2 it could not tell -- which is blocked.
The decisions all live in lib/preflight.py as pure functions with behaviour
tests; this file only gathers facts.
"""
import argparse, collections, datetime, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
from preflight import (preflight, comparable_pools, reversion_fit,   # noqa: E402
                       expected_untreated_delta, prediction_sd,
                       effect_must_exceed, CHECKS, RATE_TOLERANCE)
from openloop import open_loop, canary_sha                 # noqa: E402

MANIFEST = os.environ.get('MCAI_MANIFEST', '/srv/mcbots/trial-manifest.json')
DECISIONS = os.environ.get('MCAI_DECISIONS', '/var/log/mcai/_canary-decisions.jsonl')
LEDGER = os.environ.get('MCAI_PREDICTIONS', os.path.join(HERE, '..', 'reports', 'predictions.jsonl'))
LOGS = os.environ.get('MCAI_LOGS', '/var/log/mcai/*/skill-*.jsonl')


# ---- the endpoints a pool can be chosen on ---------------------------------
#
# Each is (predicate over a telemetry row, denominator). Adding one here is the
# supported way to extend this; a hand-rolled query for pool selection is the
# thing that went 16x wrong.
ENDPOINTS = {
    'drowning_aborts': ('rows where the abort reason is drowning, per bot-hour',
                        lambda r, sk: r['detail'] == 'drowning', 'bot-hour'),
    'aborts':          ('all aborted skill runs, per bot-hour',
                        lambda r, sk: sk.get('status') in ('aborted', 'interrupted'), 'bot-hour'),
    'gather_failures': ('failed gather runs, per bot-hour',
                        lambda r, sk: r['name'] == 'gather' and sk.get('status') not in ('ok', 'success'),
                        'bot-hour'),
    'gather_success':  ('successful gather runs as a share of gather runs',
                        lambda r, sk: r['name'] == 'gather' and sk.get('status') in ('ok', 'success'),
                        'gather-run'),
    'no_path':         ('runs that failed with no_path, per bot-hour',
                        lambda r, sk: sk.get('fail_class') == 'no_path', 'bot-hour'),
}


def read_json(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return None                                  # missing OR unreadable: fail closed


def read_jsonl(path):
    try:
        out = []
        with open(path, errors='replace') as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        continue
        return out
    except FileNotFoundError:
        return []
    except Exception:
        return None                                  # unreadable is not empty


def git(*args, cwd=None):
    try:
        r = subprocess.run(('git',) + args, cwd=cwd or os.path.join(HERE, '..'),
                           capture_output=True, text=True, timeout=30)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def rank_pools(endpoint, minutes):
    """
    Compute the endpoint for every pool, from telemetry, with the shared library.

    This is the SECOND computation. It is deliberately not the one the operator
    used -- two queries wrong the same way is a risk this cannot retire, but two
    queries wrong DIFFERENTLY is what actually happened.
    """
    try:
        sys.path.insert(0, HERE)
        from lib.telemetry import Events
    except Exception as e:
        return None, None, None, 'telemetry library unavailable (%s)' % e
    try:
        ev = Events.load(paths=LOGS, since_minutes=minutes)
    except Exception as e:
        return None, None, None, 'could not load telemetry: %s' % e

    desc, pred, denom = ENDPOINTS[endpoint]
    hit = collections.Counter()
    tot = collections.Counter()
    bots = collections.defaultdict(set)
    times = collections.defaultdict(list)

    # SPLIT THE BASELINE IN HALF so the reversion line can be fitted on data
    # containing no treatment at all. A pool's two halves are what says how much
    # a pool at a given level moves on its own.
    stamps = [r['t'] for r in ev.rows]
    mid = min(stamps) + (max(stamps) - min(stamps)) / 2 if len(stamps) > 1 else None
    half = collections.defaultdict(lambda: [0, 0, 0, 0])   # pool -> hitA,totA,hitB,totB
    halfbots = collections.defaultdict(lambda: (set(), set()))
    halftimes = collections.defaultdict(lambda: ([], []))

    for r in ev.rows:
        raw = r['raw']
        pool = (raw.get('exp') or {}).get('pool')
        if not pool:
            continue
        sk = raw.get('skill') or {}
        times[pool].append(r['t'])
        bots[pool].add((r['bot'] or {}).get('name'))
        if denom == 'gather-run':
            if r['name'] == 'gather':
                tot[pool] += 1
        got = bool(pred(r, sk))
        if got:
            hit[pool] += 1
        if mid is not None:
            i = 0 if r['t'] < mid else 1
            halfbots[pool][i].add((r['bot'] or {}).get('name'))
            halftimes[pool][i].append(r['t'])
            if denom == 'gather-run' and r['name'] == 'gather':
                half[pool][1 + 2 * i] += 1
            if got:
                half[pool][2 * i] += 1

    if not tot and denom == 'gather-run':
        return None, None, None, 'no gather runs found in the window at all — the instrument saw nothing'
    if not times:
        return None, None, None, 'no pooled rows found in the window — the instrument saw nothing'

    out = {}
    for pool, ts in times.items():
        if denom == 'gather-run':
            n = tot[pool]
            out[pool] = 100.0 * hit[pool] / n if n else 0.0
        else:
            span = (max(ts) - min(ts)).total_seconds() / 3600.0
            bh = span * max(len(bots[pool]), 1)
            out[pool] = hit[pool] / bh if bh > 0 else 0.0
    # Each pool's (first-half, second-half) rate, for the reversion fit.
    halves = {}
    for pool in out:
        vals = []
        for i in (0, 1):
            ts_i, bots_i = halftimes[pool][i], halfbots[pool][i]
            if len(ts_i) < 2 or not bots_i:
                vals = None
                break
            if denom == 'gather-run':
                n = half[pool][1 + 2 * i]
                vals.append(100.0 * half[pool][2 * i] / n if n else None)
            else:
                sp = (max(ts_i) - min(ts_i)).total_seconds() / 3600.0
                bh = sp * len(bots_i)
                vals.append(half[pool][2 * i] / bh if bh > 0 else None)
        if vals and all(v is not None for v in vals):
            halves[pool] = tuple(vals)

    return out, {p: len(b) for p, b in bots.items()}, halves, None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pool', required=True, help='the pool this canary would go to')
    ap.add_argument('--sha', required=True, help='the canary sha')
    ap.add_argument('--endpoint', required=True, choices=sorted(ENDPOINTS),
                    help='the pre-registered primary endpoint')
    ap.add_argument('--my-rate', type=float, required=True,
                    help='the rate YOU computed for this pool, your own way')
    ap.add_argument('--minutes', type=int, default=360, help='baseline window (default 6h)')
    ap.add_argument('--allow-rank', type=int, default=1,
                    help='accept a pool worse than the fleet max — type it deliberately')
    ap.add_argument('--tolerance', type=float, default=RATE_TOLERANCE)
    ap.add_argument('--manifest', default=MANIFEST)
    ap.add_argument('--decisions', default=DECISIONS)
    ap.add_argument('--predictions', default=LEDGER)
    a = ap.parse_args()

    man = read_json(a.manifest)
    facts = {
        'pool': a.pool, 'sha': a.sha, 'allow_rank': a.allow_rank,
        'tolerance': a.tolerance, 'rate_mine': a.my_rate,
        'now': datetime.datetime.now(datetime.timezone.utc),
        'predictions': read_jsonl(a.predictions),
        'open_loop': open_loop(man, read_jsonl(a.decisions)) if man is not None
                     else 'manifest missing or unreadable — cannot prove no canary is deployed',
    }

    # The cutoff a FUTURE read will use is the one this deploy is about to write.
    # It cannot be checked before it exists, so what is checked here is that the
    # manifest carries the field at all and that the last one was sane.
    if isinstance(man, dict) and man.get('declared_at'):
        try:
            facts['declared_at'] = datetime.datetime.fromisoformat(
                man['declared_at'].replace('Z', '+00:00'))
        except Exception:
            facts['declared_at'] = None
    facts['deployed_sha'] = (man or {}).get('declared_code_version')

    head = git('rev-parse', 'HEAD')
    facts['branch_head'] = head
    if facts['deployed_sha'] and head:
        facts['merge_base'] = git('merge-base', head, facts['deployed_sha'].split('+')[0])

    ranking, botcount, halves, err = rank_pools(a.endpoint, a.minutes)

    # RANK ONLY AGAINST POOLS OF A COMPARABLE SIZE.
    #
    # The isolated arm writes exp.pool as `self-isolated-<pool>-<Bot>`, so 20 of
    # its bots each read as their own pool. Ranking a 5-bot pool against 20
    # one-bot pools put hive-d at "rank 4 of 32" when among real pools it is
    # first -- a single bot's rate tops the list on noise alone.
    dropped = []
    if ranking and botcount:
        keep = comparable_pools(botcount, a.pool)
        if keep is None:
            err = err or ('cannot tell which pools are comparable to %s — '
                          'refusing to rank' % a.pool)
            ranking = None
        else:
            dropped = sorted(set(ranking) - keep)
            ranking = {p: v for p, v in ranking.items() if p in keep}

    facts['ranking'] = ranking
    if ranking:
        facts['rate_computed'] = ranking.get(a.pool)

    desc = ENDPOINTS[a.endpoint][0]
    print('CANARY PREFLIGHT  pool=%s sha=%s' % (a.pool, a.sha))
    print('  endpoint: %s (%s)' % (a.endpoint, desc))
    if err:
        print('  ENDPOINT NOT COMPUTED: %s' % err)
    elif ranking:
        order = sorted(ranking.items(), key=lambda kv: -kv[1])
        rank = [p for p, _ in order].index(a.pool) + 1 if a.pool in ranking else None
        print('  you computed %.2f; this run computes %.2f  (rank %s of %d)'
              % (a.my_rate, ranking.get(a.pool, float('nan')),
                 rank if rank else '?', len(order)))
        print('  fleet: ' + '  '.join('%s=%.2f' % (p, v) for p, v in order[:6])
              + (' ...' if len(order) > 6 else ''))
        if dropped:
            print('  (%d pool label(s) excluded as not comparable in size to %s: %s%s)'
                  % (len(dropped), a.pool, ', '.join(dropped[:3]),
                     ' ...' if len(dropped) > 3 else ''))

    # THE DO-NOTHING BAR.
    #
    # A pool is extreme partly because of noise, and noise does not persist, so
    # an extreme pool moves toward the middle whether or not anything was done
    # to it. hive-d was chosen as the fleet maximum on 2026-09-07 and fell 4.84
    # per bot-hour -- against a fitted expectation of 2.66 to 5.68 for doing
    # nothing at all. The trial could not distinguish its own headline from
    # inaction, and nothing in the setup had said so beforehand. This says so
    # beforehand.
    if ranking and halves:
        pairs = [v for p, v in halves.items() if p in ranking and p != a.pool]
        fit = reversion_fit(pairs)
        mine = ranking.get(a.pool)
        if fit is None:
            print('  REVERSION: only %d comparable control pools — cannot price '
                  'what this pool would do untreated' % len(pairs))
        elif mine is not None:
            pred = expected_untreated_delta(mine, fit)
            psd = prediction_sd(mine, fit)
            _, bar = effect_must_exceed(mine, fit)
            xs = [x for x, _ in pairs]
            print('  REVERSION: on %d control pools, delta = %+.2f %+.2f*pre '
                  '(resid sd %.2f)' % (fit.n, fit.intercept, fit.slope, fit.sd))
            print('    a pool at %.2f moves %+.2f +/- %.2f with NO treatment; '
                  'your effect must beat %+.2f to be distinguishable'
                  % (mine, pred, psd, bar))
            if not (min(xs) <= mine <= max(xs)):
                print('    WARNING: %.2f is OUTSIDE the fitted range %.2f..%.2f — '
                      'that prediction is an extrapolation and the interval above '
                      'is why picking the extreme pool costs you the read'
                      % (mine, min(xs), max(xs)))

    blockers = preflight(facts)
    print()
    if not blockers:
        print('CLEAR — %d checks passed. Deploy.' % len(CHECKS))
        return 0
    print('BLOCKED — %d of %d checks failed:' % (len(blockers), len(CHECKS)))
    for name, reason in blockers:
        print('  [%s] %s' % (name, reason))
    print('\nEvery one of these has cost this project a trial. Fix them, do not '
          'override them, unless you can say which measurement makes it safe.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
