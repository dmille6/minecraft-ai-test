#!/usr/bin/env python3
"""shakedown-gate.py -- the pre-registered stop/go check for Block 2.

    export ES_URL=http://localhost:9200 ES_USER=mcai_ro ES_PASS=...
    ./shakedown-gate.py --block block2 --hours 24
    echo $?          # 0 = GO, 1 = NO-GO, 2 = INSUFFICIENT DATA

THE GATE, as amended 2026-08-18 (before any Block 2 data existed):

    Across a full shakedown day, no arm's MOBILE fraction may exceed another's
    by more than 2x, AND every arm must be at least 30% mobile. If the worlds
    cannot meet that, the terrain or the spawn placement is changed before the
    block, not after.

The threshold is the originally pre-registered 2x. What changed is the
statistic it binds on, because the original could not reject the case it was
written for: a ratio of IMMOBILE fractions compresses toward 1 precisely when
both arms are badly stuck. Block 1's fixed-arms-01b reads 1.36x on immobile
fractions and PASSES at every slack value tried; the same data as working time
reads 2.43x and fails at every slack value. The mobile form is also the one
that matches the primary endpoint, whose denominator is mobile bot-hours.

This exists as a program rather than a judgement because the judgement gets
made at midnight on the day the hardware arrives, by someone who wants to start
the block. Entrapment already ate Block 1: the isolated arm spent 55% of it
below y=45 against the shared arm's 12% and was out-gathered 4.2:1, then the
ranking INVERTED during interim once the trapped bots were freed. Neither ratio
measured memory. Both measured mobility. A gate that can be talked out of is
the same as no gate, so this one returns an exit code.

Definitions are taken verbatim from the pre-registration, not invented here:

  immobile   no net position change over a 10-MINUTE window. Net, not range:
             a bot that wanders and returns has achieved nothing, which is the
             quantity of interest. --slack sets how many blocks of net
             displacement still counts as immobile; it is printed on every run
             because it is the one number here that is a judgement call.
  below-y45  the second covariate the pre-registration requires alongside it.
  exposure   published BOTH ways -- raw bot-hours and mobile bot-hours -- since
             "if they disagree, the disagreement is the finding".

INSUFFICIENT is a distinct outcome from GO. A gate that passes because an arm
shipped no telemetry is worse than no gate at all, so a thin or lopsided
corpus exits 2 and says which arm is thin.
"""
import argparse, json, os, sys, urllib.request, base64
from collections import defaultdict

WINDOW_MIN = 10          # pre-registered, do not tune
DEEP_Y = 45              # pre-registered


def es(path, body):
    url = f"{os.environ['ES_URL']}/{path}"
    auth = base64.b64encode(
        f"{os.environ.get('ES_USER','elastic')}:{os.environ['ES_PASS']}".encode()).decode()
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': f'Basic {auth}',
                                          'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def arms_and_bots(block, hours):
    """Which arms and bots actually reported, so a silent arm cannot pass."""
    r = es('mcai-skill-*/_search?size=0', {
        'query': {'bool': {'filter': [
            {'term': {'exp.block': block}},
            {'range': {'@timestamp': {'gte': f'now-{hours}h'}}}]}},
        'aggs': {'arm': {'terms': {'field': 'exp.arm', 'size': 20},
                         'aggs': {'bot': {'terms': {'field': 'bot.name', 'size': 40}}}}}})
    out = {}
    for a in r['aggregations']['arm']['buckets']:
        out[a['key']] = {b['key']: b['doc_count'] for b in a['bot']['buckets']}
    return out


def bot_windows(bot, block, hours):
    """Per 10-minute window: net displacement, and mean depth.

    first/last position via top_hits rather than min/max, because min/max gives
    the RANGE a bot covered and the pre-registration asks for NET change.
    """
    r = es('mcai-skill-*/_search?size=0', {
        'query': {'bool': {'filter': [
            {'term': {'bot.name': bot}}, {'term': {'exp.block': block}},
            {'range': {'@timestamp': {'gte': f'now-{hours}h'}}},
            {'exists': {'field': 'bot.pos.x'}}]}},
        'aggs': {'w': {'date_histogram': {'field': '@timestamp',
                                          'fixed_interval': f'{WINDOW_MIN}m',
                                          'min_doc_count': 1},
                       'aggs': {
                           'first': {'top_hits': {'size': 1, 'sort': [{'@timestamp': 'asc'}],
                                                  '_source': ['bot.pos.x', 'bot.pos.z']}},
                           'last': {'top_hits': {'size': 1, 'sort': [{'@timestamp': 'desc'}],
                                                 '_source': ['bot.pos.x', 'bot.pos.z']}},
                           'y': {'avg': {'field': 'bot.pos.y'}}}}}})
    out = []
    for w in r['aggregations']['w']['buckets']:
        try:
            f = w['first']['hits']['hits'][0]['_source']['bot']['pos']
            l = w['last']['hits']['hits'][0]['_source']['bot']['pos']
        except (IndexError, KeyError):
            continue
        net = ((l['x'] - f['x']) ** 2 + (l['z'] - f['z']) ** 2) ** 0.5
        out.append({'net': net, 'y': w['y']['value'], 'n': w['doc_count']})
    return out


# ---------------------------------------------------------------------------
# OPERATIONAL READINESS — amendment 2026-08-20, before any Block 2 data.
#
# The mobility gate above protects COMPARABILITY: it stops one arm being more
# trapped than another. It cannot detect that every arm is equally broken, and
# by construction it never will -- eight equally-crippled worlds pass it exactly
# as eight healthy ones do.
#
# On the live fleet that gap was not hypothetical. Gather ran at 12% success,
# path failures outnumbered productive work five to one, and the prerequisite
# loop closed 22 times out of 479. A block started on those numbers measures
# mobility pathology and recovery pathology and calls the residue memory.
#
# These are START/NO-START operational gates. They are NOT analysis endpoints
# and must never be reported as results. Their only job is to answer "is the
# apparatus measuring anything at all" before the seven-day clock starts.
# ---------------------------------------------------------------------------

# Labels that are HONEST TERMINAL FAILURES or REQUESTS, not rescues that never
# work. A 0% success rate on these is correct reporting, and gating on it would
# punish the telemetry for being truthful: `_drowning_no_shore` means the bot is
# in open water with no land in reach, which is a fact about the world, and
# `_prereq_adopted` records an intention whose outcome is `_prereq_satisfied`.
#
# Anything NOT on this list with many firings and no successes is a defect. That
# is exactly how `_livelock_escape` was caught -- 2,296 firings, 0 successes,
# because its status was hardcoded before the action it reported on had run.
#
# THE DISCRIMINATOR IS NOT "is the status hardcoded to failed". It is: DOES THIS
# EVENT REPORT ON AN ACTION IT PERFORMED?
#
#   - An OBSERVATION ("I notice I am stagnating", "no shore is reachable", "I am
#     asking for scaffold") has no success available to it. 0% is the only honest
#     number and gating on it would punish correct reporting.
#   - An ACTION REPORT ("I relocated", "I deposited") must carry the outcome of
#     the thing it did. 0% across thousands of firings means either the action
#     never works or the report is fabricated.
#
# `_livelock_escape` sat on the wrong side of that line: it reported a
# relocation, so it owed an outcome, and instead hardcoded failure before the
# goto ran. That is why it is NOT on this list.
#
# This list is a DECLARED, AUDITABLE SET. Adding a label to it is a claim that
# the label is an observation, and must be justified -- it is not a way to
# silence the gate.
TERMINAL_LABELS = {
    # water and entrapment: facts about the world, not attempts
    '_drowning_no_shore', '_drowning_released_timeout',
    '_marooned', '_marooned_needs_scaffold', '_marooned_needs_pickaxe',
    '_entombed', '_entombed_unrecoverable',
    '_stranded_underground', '_trapped_in_canopy',
    # detections raised by the watchdog and the cognitive loop
    '_stagnation', '_loop_restart', '_milestone_skipped',
    # bookkeeping: adoption is an intention, closure is `_prereq_satisfied`
    '_prereq_adopted', '_prereq_abandoned', '_rule_contradicted',
}

PATH_FAILURE = {'_path_noPath', '_path_reset', '_path_timeout'}
PRODUCTIVE = {'gather', 'goto', 'explore', 'craft', 'mine', 'deposit'}


def _skill_stats(block, hours):
    body = {
        'query': {'bool': {'filter': [
            {'range': {'@timestamp': {'gte': f'now-{hours}h'}}},
            {'term': {'exp.block': block}}]}},
        'aggs': {'arm': {'terms': {'field': 'exp.arm', 'size': 20},
                         'aggs': {'n': {'terms': {'field': 'skill.name', 'size': 80},
                                        'aggs': {'s': {'terms': {'field': 'skill.status', 'size': 6}}}}}}},
    }
    d = es('mcai-skill-*/_search?size=0', body)
    per_arm, overall = {}, defaultdict(lambda: {'total': 0, 'success': 0})
    for ab in d.get('aggregations', {}).get('arm', {}).get('buckets', []):
        per_arm[ab['key']] = {}
        for nb in ab['n']['buckets']:
            st = {x['key']: x['doc_count'] for x in nb['s']['buckets']}
            rec = {'total': nb['doc_count'], 'success': st.get('success', 0)}
            per_arm[ab['key']][nb['key']] = rec
            overall[nb['key']]['total'] += rec['total']
            overall[nb['key']]['success'] += rec['success']
    return dict(overall), per_arm


def _llm_stats(block, hours):
    body = {
        'query': {'bool': {'filter': [
            {'range': {'@timestamp': {'gte': f'now-{hours}h'}}},
            {'term': {'exp.block': block}},
            {'exists': {'field': 'llm.latency_ms'}}]}},
        'aggs': {'arm': {'terms': {'field': 'exp.arm', 'size': 20},
                         'aggs': {'p': {'percentiles': {'field': 'llm.latency_ms',
                                                        'percents': [50, 95, 99]}},
                                  'bots': {'cardinality': {'field': 'bot.name'}}}}},
    }
    d = es('mcai-llm-agents*/_search?size=0', body)
    out = {}
    for ab in d.get('aggregations', {}).get('arm', {}).get('buckets', []):
        v = ab['p']['values']
        out[ab['key']] = {'decisions': ab['doc_count'],
                          'bots': ab['bots']['value'] or 1,
                          'p50': v.get('50.0'), 'p95': v.get('95.0'), 'p99': v.get('99.0')}
    return out


def viability_gates(block, hours, a):
    """Operational start/no-start checks. Returns a list of failures."""
    fails = []
    print('\n  ' + '=' * 74)
    print('  OPERATIONAL READINESS (start/no-start; NOT analysis endpoints)')
    print('  ' + '=' * 74)

    overall, per_arm = _skill_stats(block, hours)
    if not overall:
        print('  INSUFFICIENT - no skill telemetry in the window')
        return ['no skill telemetry']

    g = overall.get('gather', {'total': 0, 'success': 0})
    rate = g['success'] / g['total'] if g['total'] else 0.0
    print(f"\n  gather: {g['success']}/{g['total']} = {rate*100:.1f}% "
          f"(fleet minimum {a.min_gather*100:.0f}%)")
    if not g['total']:
        fails.append('no gather attempts at all')
    elif rate < a.min_gather:
        fails.append(f'fleet gather {rate*100:.1f}% < {a.min_gather*100:.0f}%')
    for arm, sk in sorted(per_arm.items()):
        ag = sk.get('gather', {'total': 0, 'success': 0})
        ar = ag['success'] / ag['total'] if ag['total'] else 0.0
        low = ag['total'] and ar < a.min_gather_arm
        print(f"    {arm:<12} {ag['success']:>5}/{ag['total']:<7} {ar*100:>5.1f}%"
              + ('   <-- BELOW ARM FLOOR' if low else ''))
        if low:
            fails.append(f'arm {arm} gather {ar*100:.1f}% < {a.min_gather_arm*100:.0f}%')

    prod = sum(v['total'] for k, v in overall.items() if k in PRODUCTIVE)
    pathf = sum(v['total'] for k, v in overall.items() if k in PATH_FAILURE)
    ratio = prod / pathf if pathf else float('inf')
    print(f'\n  productive:path-failure = {prod}:{pathf} = {ratio:.2f} '
          f'(minimum {a.min_productive_ratio})')
    if ratio < a.min_productive_ratio:
        fails.append(f'productive:path ratio {ratio:.2f} < {a.min_productive_ratio}')

    print(f'\n  rescue paths with >={a.dead_rescue_min} firings and zero successes:')
    dead = [(k, v['total']) for k, v in sorted(overall.items())
            if v['total'] >= a.dead_rescue_min and v['success'] == 0
            and k not in TERMINAL_LABELS]
    if not dead:
        print('    none')
    for k, n in dead:
        print(f'    {k:<28} {n:>6} firings, 0 successes   <-- DEFECT OR MISLABEL')
        fails.append(f'{k} never succeeds ({n} firings)')

    # --- deposits: an INSTRUMENT CHECK, not a target to debug toward ----------
    #
    # The co-primary endpoint has 9 successes in 14 days fleet-wide and 0 of 211
    # attempts in the last day. The pre-registration's rule is >=30 fleet-wide
    # and >=1 per arm or the endpoint is reported unmeasurable.
    #
    # Applying that rule to SHAKEDOWN data, and declaring the consequence in
    # advance, is what keeps this honest: the estimand is not being changed
    # because the result was disliked, it is being checked that the measuring
    # instrument is alive before the seven-day block starts. `deposit` inherits
    # whatever `home()` achieves, so the fair test is the shakedown with the
    # repaired walk, not the already-failed live data.
    dep = overall.get('deposit', {'total': 0, 'success': 0})
    dep_arms = {arm: sk.get('deposit', {'success': 0})['success']
                for arm, sk in per_arm.items()}
    silent = [a_ for a_, n in dep_arms.items() if n == 0]
    print(f"\n  deposits: {dep['success']} of {dep['total']} attempts fleet-wide "
          f"(viability needs >= {a.min_deposits} and >= 1 per arm)")
    if dep_arms:
        print('    ' + ', '.join(f'{k}={v}' for k, v in sorted(dep_arms.items())))
    if dep['success'] < a.min_deposits or silent:
        why = (f"only {dep['success']} deposits" if dep['success'] < a.min_deposits
               else f"no deposits in {', '.join(sorted(silent))}")
        print(f"    -> {why}: retained-items is PREDECLARED UNMEASURABLE for\n"
              f"       confirmatory analysis. This does NOT block the start; successful\n"
              f"       gathers stand as the sole confirmatory primary, as the\n"
              f"       pre-registration provides for.")
        # deliberately NOT appended to fails -- a dead co-primary is reported,
        # not a reason to refuse to run.

    llm = _llm_stats(block, hours)
    if llm:
        print('\n  LLM latency and decision throughput per arm:')
        print(f"    {'arm':<12}{'decisions':>10}{'/bot-h':>9}{'p50':>8}{'p95':>8}{'p99':>8}")
        dbh = {}
        for arm, v in sorted(llm.items()):
            dbh[arm] = v['decisions'] / max(1e-9, v['bots'] * hours)
            slow = v['p95'] and v['p95'] > a.max_p95
            print(f"    {arm:<12}{v['decisions']:>10}{dbh[arm]:>9.1f}"
                  f"{(v['p50'] or 0):>8.0f}{(v['p95'] or 0):>8.0f}{(v['p99'] or 0):>8.0f}"
                  + ('  <--' if slow else ''))
            if slow:
                fails.append(f"arm {arm} p95 {v['p95']:.0f}ms > {a.max_p95:.0f}ms")
            if v['p99'] and v['p99'] > a.max_p99:
                fails.append(f"arm {arm} p99 {v['p99']:.0f}ms > {a.max_p99:.0f}ms")
        # THE CAPACITY CONFOUND. hive and board accumulate more memory, so their
        # prompts grow longer. If the endpoint saturates, those arms get FEWER
        # decisions per bot-hour than isolated -- an arm effect manufactured by
        # hardware rather than by memory, which would read as a treatment
        # difference in every downstream plot.
        if len(dbh) > 1:
            hi, lo = max(dbh.values()), min(dbh.values())
            spread = (hi - lo) / hi if hi else 0
            print(f'\n  decisions/bot-hour spread: {spread*100:.1f}% '
                  f'(maximum {a.max_decision_spread*100:.0f}%)')
            if spread > a.max_decision_spread:
                fails.append(f'decisions/bot-hour differ by {spread*100:.1f}% between arms '
                             f'- that is capacity, not memory')
    else:
        print('\n  (no llm.latency_ms telemetry in the window)')

    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--block', default='block2')
    ap.add_argument('--hours', type=int, default=24,
                    help='the pre-registration says a FULL shakedown day')
    # FIXED IN ADVANCE, 2026-08-18. Verdicts were stable at slack 2 and 4 and
    # began drifting at 8 and 16 (baseline's worst arm falls to 20.9% mobile at
    # 16, tripping the floor for the wrong reason). 4 blocks of net travel in
    # ten minutes is not movement. Pinning it now is what stops it being tuned
    # later to produce a wanted answer.
    ap.add_argument('--slack', type=float, default=4.0,
                    help='blocks of net displacement still counted as immobile')
    ap.add_argument('--ratio', type=float, default=2.0,
                    help='pre-registered threshold, now applied to MOBILE fraction')
    ap.add_argument('--floor', type=float, default=0.30,
                    help='every arm must be at least this mobile, regardless of ratio')
    # 4 arms x 5 bots x 144 windows/day is ~720 per arm when everything reports.
    # 100 was lenient enough for a mostly-dead arm to pass.
    # OPERATIONAL READINESS THRESHOLDS (amendment 2026-08-20, pre-data).
    # These gate the START of the block, not the analysis of it.
    ap.add_argument('--min-gather', type=float, default=0.20,
                    help='fleet-wide gather success floor')
    ap.add_argument('--min-gather-arm', type=float, default=0.10,
                    help='per-arm gather success floor')
    ap.add_argument('--min-productive-ratio', type=float, default=0.5,
                    help='productive skills : path failures')
    ap.add_argument('--max-p95', type=float, default=15000, help='LLM p95 ms, per arm')
    ap.add_argument('--max-p99', type=float, default=25000, help='LLM p99 ms, per arm')
    ap.add_argument('--max-decision-spread', type=float, default=0.10,
                    help='max relative gap in decisions/bot-hour between arms')
    ap.add_argument('--min-deposits', type=int, default=30,
                    help='fleet-wide deposit successes for retained-items to be measurable')
    ap.add_argument('--dead-rescue-min', type=int, default=100,
                    help='firings above which a 0%% success rate is a defect')
    ap.add_argument('--skip-viability', action='store_true',
                    help='mobility gate only, as it ran before this amendment')
    ap.add_argument('--min-windows', type=int, default=500,
                    help='per arm, below which the answer is INSUFFICIENT not GO')
    a = ap.parse_args()

    print(f"\n  SHAKEDOWN GATE — block={a.block} window={a.hours}h "
          f"immobile if net move < {a.slack}b over {WINDOW_MIN}m")
    print("  " + "=" * 74)

    fleet = arms_and_bots(a.block, a.hours)
    if not fleet:
        print(f"\n  INSUFFICIENT — no telemetry at all for exp.block={a.block}")
        return 2

    # Pseudo-arms are bookkeeping, not treatments. Left in, `unassigned` becomes
    # the "best" arm and flatters the ratio against a group that is not an arm.
    for pseudo in ('unassigned', 'all', 'none', ''):
        fleet.pop(pseudo, None)

    # A BOT IN TWO ARMS MEANS THE LABELS MOVED UNDER THE DATA.
    #
    # exp.arm is stamped per document, so a bot reassigned mid-window
    # contributes its windows to BOTH arms -- inflating one, diluting the other,
    # and double-counting the fleet. Seen for real on interim-01, where
    # Gather01, Scout01 and Miner01 each appeared under two arms in 24h. The
    # arms are then not disjoint and no ratio computed from them means anything,
    # so this refuses rather than reporting a number.
    seen = defaultdict(set)
    for arm, bots in fleet.items():
        for b in bots:
            seen[b].add(arm)
    straddlers = {b: sorted(arms) for b, arms in seen.items() if len(arms) > 1}
    if straddlers:
        print("\n  INSUFFICIENT — these bots report under more than one arm in the window:")
        for b, arms in sorted(straddlers.items()):
            print(f"    {b:<12} {', '.join(arms)}")
        print("  The arms are not disjoint, so an immobile-fraction ratio between\n"
              "  them is meaningless. Re-run over a window in which arm assignment\n"
              "  was stable, or fix the env files before starting the block.")
        return 2

    stats, insufficient = {}, []
    for arm, bots in sorted(fleet.items()):
        wins, deep, immo, mobile_h, raw_h = 0, 0, 0, 0.0, 0.0
        per_bot = {}
        for bot in sorted(bots):
            ws = bot_windows(bot, a.block, a.hours)
            b_im = sum(1 for w in ws if w['net'] < a.slack)
            b_deep = sum(1 for w in ws if (w['y'] or 99) < DEEP_Y)
            per_bot[bot] = (len(ws), b_im, b_deep)
            wins += len(ws); immo += b_im; deep += b_deep
            raw_h += len(ws) * WINDOW_MIN / 60
            mobile_h += (len(ws) - b_im) * WINDOW_MIN / 60
        if wins < a.min_windows:
            insufficient.append((arm, wins))
        stats[arm] = {'windows': wins, 'immobile': immo, 'deep': deep,
                      'raw_h': raw_h, 'mobile_h': mobile_h, 'bots': per_bot,
                      'frac': immo / wins if wins else None,
                      'deep_frac': deep / wins if wins else None}

    print(f"\n  {'arm':<12}{'bots':>5}{'windows':>9}{'immobile':>10}{'below y45':>11}"
          f"{'raw b-h':>10}{'mobile b-h':>12}")
    for arm, s in sorted(stats.items()):
        print(f"  {arm:<12}{len(s['bots']):>5}{s['windows']:>9}"
              f"{s['frac']*100 if s['frac'] is not None else 0:>9.1f}%"
              f"{s['deep_frac']*100 if s['deep_frac'] is not None else 0:>10.1f}%"
              f"{s['raw_h']:>10.1f}{s['mobile_h']:>12.1f}")

    print(f"\n  per bot (windows / immobile / below y45):")
    for arm, s in sorted(stats.items()):
        line = "  ".join(f"{b}={w}/{i}/{d}" for b, (w, i, d) in sorted(s['bots'].items()))
        print(f"    {arm:<10} {line}")

    # ---- the verdict ------------------------------------------------------
    print("\n  " + "=" * 74)
    if insufficient:
        for arm, n in insufficient:
            print(f"  INSUFFICIENT — arm '{arm}' has {n} windows, need >= {a.min_windows}")
        print("  A thin arm is a telemetry or fleet failure, NOT a passing gate.")
        return 2
    if len(stats) < 2:
        print(f"  INSUFFICIENT — only {len(stats)} arm reporting; the gate compares arms")
        return 2

    # ---- THE GATE BINDS ON MOBILE FRACTION -----------------------------
    #
    # Amended 2026-08-18, before any Block 2 data exists. The threshold is
    # unchanged at 2x; what it is computed on changed, because the original
    # statistic could not reject the case it was written for.
    #
    # A ratio of IMMOBILE fractions compresses toward 1 exactly when both arms
    # are badly stuck -- which is the situation the gate exists to catch. Block
    # 1's fixed-arms-01b reads 84.3% vs 61.9% immobile = 1.36x and PASSES at
    # every slack value tried (2, 4, 8, 16). The same data as WORKING time is
    # 15.7% vs 38.1% = 2.43x and fails at every slack value. Same measurements,
    # opposite verdict, and the mobile form is the one that matches the primary
    # endpoint, whose denominator is mobile bot-hours.
    mobile = {k: 1.0 - v['frac'] for k, v in stats.items()}
    lo_arm, lo = min(mobile.items(), key=lambda kv: kv[1])
    hi_arm, hi = max(mobile.items(), key=lambda kv: kv[1])

    imm = {k: v['frac'] for k, v in stats.items()}
    i_ratio = max(imm.values()) / min(imm.values()) if min(imm.values()) > 0 else float('inf')
    print(f"  immobile fraction (superseded statistic, reported for continuity): "
          f"{i_ratio:.2f}x")
    print(f"  MOBILE fraction: " + ", ".join(f"{k}={v*100:.1f}%" for k, v in sorted(mobile.items())))

    if lo <= 0:
        print(f"  spread: undefined — arm '{lo_arm}' was never mobile")
        ok_ratio, ratio = False, float('inf')
    else:
        ratio = hi / lo
        ok_ratio = ratio <= a.ratio
        print(f"  spread: best {hi_arm} {hi*100:.1f}% / worst {lo_arm} {lo*100:.1f}% "
              f"= {ratio:.2f}x (limit {a.ratio}x)")

    # THE FLOOR. A ratio alone passes when every arm is equally broken, and an
    # arm below roughly a third mobile is spending most of its exposure getting
    # unstuck -- the per-mobile-bot-hour denominator goes thin and noisy, and
    # what is being measured is recovery rather than memory. Block 1's worst arm
    # sat at 15.7%; baseline's at 38.1%.
    ok_floor = lo >= a.floor
    print(f"  floor: worst arm {lo*100:.1f}% mobile (minimum {a.floor*100:.0f}%)"
          + ("" if ok_floor else "   <-- BELOW FLOOR"))

    mh = {k: v['mobile_h'] for k, v in stats.items()}
    print(f"  mobile bot-hours: " + ", ".join(f"{k}={v:.1f}" for k, v in sorted(mh.items())))

    # Reported, never enforced: depth is partly a CONSEQUENCE of the treatment
    # (bots choose to mine), so hard-gating it would select for worlds that
    # suppress the behaviour under study.
    df = {k: v['deep_frac'] for k, v in stats.items()}
    d_ratio = max(df.values()) / min(df.values()) if min(df.values()) > 0 else float('inf')
    print(f"  below y45 (reported, not gated): "
          + ", ".join(f"{k}={v*100:.1f}%" for k, v in sorted(df.items()))
          + f"  spread {d_ratio:.2f}x")
    if d_ratio > a.ratio:
        print(f"  NOTE: depth spread exceeds {a.ratio}x. Not a NO-GO, but if the primary\n"
              f"  endpoint also differs, report the comparison as CONFOUNDED.")

    ok = ok_ratio and ok_floor

    # The mobility gate answers "are the arms comparable". It cannot answer "is
    # the apparatus measuring anything", and eight equally-broken worlds pass it.
    v_fails = [] if a.skip_viability else viability_gates(a.block, a.hours, a)

    if a.hours < 24:
        print(f"  NOTE: --hours {a.hours} is less than the pre-registered full day.")

    if v_fails:
        print("\n  " + "=" * 74)
        print("  OPERATIONAL NO-GO:")
        for f in v_fails:
            print(f"    - {f}")
        print("\n  These are apparatus faults, not results. Fix them and re-run the\n"
              "  shakedown; the seven-day clock has not started and nothing is lost.")

    if ok and not v_fails:
        print(f"\n  GO — every arm is at least {a.floor*100:.0f}% mobile and no arm's mobile\n"
              f"  fraction exceeds another's by more than {a.ratio}x.\n"
              "  Publish BOTH denominators in every confirmatory plot; if raw and mobile\n"
              "  bot-hours disagree, the disagreement is the finding.")
        return 0
    if ok and v_fails:
        print("\n  NO-GO — the arms are comparably mobile, but the apparatus is not\n"
              "  producing measurable work. Comparability without viability means a\n"
              "  clean comparison between two things that are both broken.")
        return 1
    if not ok_floor:
        print(f"\n  NO-GO — arm '{lo_arm}' is only {lo*100:.1f}% mobile, below the {a.floor*100:.0f}% floor.\n"
              "  Even matched arms cannot carry a block when most of the exposure is\n"
              "  spent getting unstuck; the endpoint would measure recovery, not memory.")
    else:
        print(f"\n  NO-GO — the arms are not comparably mobile ({ratio:.2f}x > {a.ratio}x).\n"
              "  Per the pre-registration, change the terrain or the spawn placement\n"
              "  BEFORE the block, not after. Starting anyway measures terrain luck\n"
              "  and calls it memory.")
    return 1


if __name__ == '__main__':
    sys.exit(main())
