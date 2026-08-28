#!/usr/bin/env python3
"""Assert that each arm's memory mechanism is actually DOING something.

WHY THIS EXISTS
---------------
This fleet ran for twenty days with its independent variable switched off.
MEMORY_SCOPE=shared named the belief store after the POOL and then placed it
in a PER-BOT directory, so five "hive" bots held five private stores that
agreed on nothing but a filename. worldfacts.mjs and board-visit.mjs had the
identical defect at two more call sites.

Nothing caught it. Every health check was green, telemetry flowed at full
rate, and the test suite asserted that the broken layout was correct. It was
found by accident, while looking for something else.

The lesson is not "add a test for that bug". It is that a treatment can be
inert while every downstream signal looks perfect, because health checks
measure whether the machinery RUNS, and no check measured whether the
machinery DIFFERED between arms. This does.

WHAT IT CHECKS, PER POOL
------------------------
  STRUCTURE   the shared store is where the pool can reach it, AND no
              per-bot copy of a pool-named file exists anywhere. The second
              half is the one that matters: the original bug's signature was
              a correctly-NAMED file in the wrong DIRECTORY, which every
              presence check passed.

  PROVENANCE  reporters on a pool's rules all belong to that pool. A store
              shared across pool boundaries would look like healthy sharing
              while destroying the experimental unit.

  OPPORTUNITY how often the admission gate fired at all, and how many rules
              exist that SOMEBODY in the pool could inherit. This is the
              denominator. Without it, a freshly wiped fleet reads as a dead
              treatment, and the check cries wolf on its first run.

  BEHAVIOUR   how often a bot was actually blocked by a belief it did not
              report itself. Storage that no bot ever acts on is not a
              treatment; it is a file.

VERDICTS
--------
  LIVE          the mechanism is both stored and consumed
  INERT         opportunity existed and nothing happened
  INSUFFICIENT  not enough opportunity yet to tell -- NOT a pass

The negative control is the point. `isolated` must come back INERT. A check
that only asserts "sharing happens" passes happily in the world where
everything shares with everything, which is a worse bug than the one we had.

WHAT THIS CANNOT PROVE
----------------------
It cannot prove the shared belief is correct, or useful, or that it improved
anything. It cannot prove the cited rule caused the final action -- only that
the gate reported using it. It cannot prove the arms differ ENOUGH to move an
outcome. It proves one thing: the independent variable is not switched off.

Note one real gap it inherits: only `avoid` rules carry `reporters`. The
`worked` section records successes with no provenance at all, so positive
lessons diffuse invisibly and this check is blind to half the sharing.
"""
import argparse, datetime, glob, json, os, re, sys
from collections import Counter, defaultdict

STATE = os.environ.get('MCAI_STATE', '/var/lib/mcai')
LOGS = os.environ.get('MCAI_LOGS', '/var/log/mcai')

# What each arm is SUPPOSED to do. The check compares against this, so an arm
# behaving correctly and an arm behaving identically to its control are
# different results.
# The two stores are scoped SEPARATELY in the code, and this is not an
# accident: worldfacts.mjs pools for every scope except `isolated`
# (`const pooled = config.memory.scope !== 'isolated'`), while lessons.mjs
# pools only for `shared`. So three arms already share the world model --
# where things are, what is unreachable -- and differ only in whether they
# share JUDGEMENTS. Checking one combined "does this arm share" verdict hides
# that, so the two are reported apart.
EXPECT = {
    #            lessons          world facts
    'hive':     {'lessons': True,  'wfacts': True},
    'board':    {'lessons': True,  'wfacts': True},   # lessons only via a walk
    'placebo':  {'lessons': False, 'wfacts': True},
    'isolated': {'lessons': False, 'wfacts': False},
}
MIN_GATE_FIRINGS = 200   # below this, absence of inheritance is not evidence

# Severity is ranked separately from the exit code, because the exit codes are
# not in severity order and taking max() over them let an INSUFFICIENT (3)
# mask a LEAK (2). Rank first, map second.
RANK = {'ok': 0, 'insufficient': 1, 'inert': 2, 'leak': 3}
RANK_EXIT = {'ok': 0, 'insufficient': 3, 'inert': 1, 'leak': 2}
HISTORY = os.environ.get('MCAI_LIVENESS_HISTORY',
                         '/var/lib/mcai/_liveness-history.jsonl')


def pool_of(bot):
    """`hive-a-Echo` -> `hive-a`. Bot names are <pool>-<Name>."""
    return bot.rsplit('-', 1)[0] if bot and '-' in bot else None


def read_stores():
    """Load every pool store, plus any STRAY per-bot copy of a pool-named file.

    The stray scan is the one that would have caught the original bug: the
    file was named correctly and simply lived in the wrong directory, so
    every check that asked "does lessons-hive-a.json exist" said yes.
    """
    pools, strays = {}, []
    for d in sorted(glob.glob(f'{STATE}/_pool-*')):
        pool = os.path.basename(d)[len('_pool-'):]
        pools[pool] = {}
        for f in glob.glob(f'{d}/*.json'):
            try:
                pools[pool][os.path.basename(f)] = json.load(open(f))
            except Exception as e:
                pools[pool][os.path.basename(f)] = {'_unreadable': str(e)}
    # A pool-named file living under any NON-pool state dir is the bug.
    known = set(pools)
    for f in glob.glob(f'{STATE}/*/*.json'):
        if '/_pool-' in f:
            continue
        m = re.match(r'(lessons|world-facts|board)-(.+)\.json$', os.path.basename(f))
        if m and m.group(2) in known:
            strays.append(f)
    return pools, strays


def read_decisions(hours):
    """Admission-gate firings, per pool, from the decision log."""
    cut = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    per = defaultdict(lambda: {
        'decisions': 0, 'gate_fired': 0, 'inherited': 0,
        'inheriting_bots': set(), 'bots': set(),
        'board_calls': 0, 'board_bots': set(), 'foreign': [], 'arm': None,
    })
    for f in glob.glob(f'{LOGS}/*/llm-*.jsonl'):
        try:
            fh = open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"@timestamp"' not in line:
                    continue
                try:
                    d = json.loads(line)
                    t = datetime.datetime.fromisoformat(
                        d['@timestamp'].replace('Z', '+00:00'))
                except Exception:
                    continue
                if t < cut:
                    continue
                bot = (d.get('bot') or {}).get('name')
                pool = pool_of(bot)      # NOT exp.pool -- see the note above
                if not pool:
                    continue
                arm = (d.get('exp') or {}).get('arm') or pool.rsplit('-', 1)[0]
                per[pool]['arm'] = arm
                p = per[pool]
                p['decisions'] += 1
                p['bots'].add(bot)
                tc = (d.get('tool_calls') or [{}])[0]
                if tc.get('skill') == 'board':
                    p['board_calls'] += 1
                    p['board_bots'].add(bot)
                mem = d.get('memory')
                if not mem:
                    continue
                p['gate_fired'] += 1
                reps = mem.get('cited_reporters') or []
                # Trust the computed flag, but recompute it too -- a treatment
                # check that believes the field it is auditing is not a check.
                if mem.get('inherited') or (reps and bot not in reps):
                    p['inherited'] += 1
                    p['inheriting_bots'].add(bot)
                for r in reps:
                    if pool_of(r) and pool_of(r) != pool:
                        p['foreign'].append((bot, r))
    return per


def inheritable(store, pool_bots):
    """Rules SOMEBODY in the pool could still inherit, and multi-reporter rules.

    A rule every bot already reported is not inheritable -- counting it would
    inflate the denominator with opportunities that cannot occur.
    """
    multi = n = 0
    foreign = []
    for fname, doc in store.items():
        if not isinstance(doc, dict):
            continue
        for k, v in (doc.get('avoid') or {}).items():
            reps = set(v.get('reporters') or [])
            if not reps:
                continue
            if len(reps) >= 2:
                multi += 1
            if pool_bots - reps:
                n += 1
            foreign += [r for r in reps if pool_of(r) and pool_of(r) != pool_of(next(iter(reps)))]
    return n, multi, foreign


def wfacts_sharing(store):
    """Distinct bots contributing to a pool's world model, and shared entries."""
    who, multi = set(), 0
    for fname, doc in store.items():
        if not fname.startswith('world-facts') or not isinstance(doc, dict):
            continue
        for sect, v in doc.items():
            if not isinstance(v, dict):
                continue
            for e in v.values():
                if not isinstance(e, dict):
                    continue
                r = e.get('reporters') or e.get('by') or e.get('seen_by')
                if isinstance(r, str):
                    r = [r]
                if r:
                    who.update(r)
                    if len(set(r)) >= 2:
                        multi += 1
    return who, multi


def verdict(should_share, live, opportunity, gate_fired):
    """LIVE / INERT / INSUFFICIENT / LEAK, with the cold-start gate applied."""
    if should_share:
        if live:
            return 'LIVE'
        if not opportunity or gate_fired < MIN_GATE_FIRINGS:
            return 'INSUFFICIENT'
        return 'INERT'
    # Negative control: for an arm that must NOT share, evidence of sharing is
    # the failure. Without this branch the check passes in the world where
    # everything shares with everything -- a worse bug than the one we had.
    return 'LEAK' if live else 'INERT'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=float, default=6.0)
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--record', action='store_true',
                    help='append this run to the history the gate reads')
    ap.add_argument('--gate', type=float, metavar='HOURS',
                    help='exit 0 only if EVERY recorded run in the last HOURS '
                         'was green, and there are enough of them. One green '
                         'run proves nothing: the twenty-day bug would have '
                         'shown green on any single hour where no bot happened '
                         'to be blocked by a sibling.')
    a = ap.parse_args()

    # NO LOGS IS NOT A PASS.
    #
    # LOGS defaults to /var/log/mcai, which exists on the fleet host and nowhere
    # else. Run from a laptop checkout the globs matched nothing, every loop
    # below iterated over an empty set, `sev` stayed 'ok', and the gate exited 0
    # under an EMPTY TABLE. That is the shape of every confident-zero bug this
    # lab has shipped: a detector that answers the same whether or not it can
    # see. It would have green-lit a canary deploy from the wrong machine.
    if not glob.glob(f'{LOGS}/*/llm-*.jsonl'):
        print(f"\n  NO DATA: {LOGS}/*/llm-*.jsonl matched nothing.\n"
              f"  This check reads the fleet host's logs directly. Run it there,\n"
              f"  or point MCAI_LOGS at a mirror. An empty table is NOT a pass.\n")
        return 4

    pools, strays = read_stores()
    dec = read_decisions(a.hours)
    rows, sev, notes = [], 'ok', []

    def raise_to(level):
        nonlocal sev
        if RANK[level] > RANK[sev]:
            sev = level

    for pool in sorted(set(pools) | set(dec)):
        d = dec.get(pool) or {}
        arm = d.get('arm') or pool.rsplit('-', 1)[0]
        exp = EXPECT.get(arm)
        if not exp:
            notes.append(f'{pool}: unknown arm {arm!r} -- not checked')
            continue
        store = pools.get(pool, {})
        bots = d.get('bots', set())
        inh_n, multi, sforeign = inheritable(store, bots)
        wf_who, wf_multi = wfacts_sharing(store)

        # LESSONS: judgements. Live when a rule carries two reporters, or when
        # a bot was blocked by a belief it did not report itself.
        l_live = multi > 0 or d.get('inherited', 0) > 0
        l_v = verdict(exp['lessons'], l_live, inh_n > 0, d.get('gate_fired', 0))

        # WORLD FACTS: where things are. Live when two or more bots have
        # written into the same pool file. No cold-start gate is needed --
        # a second contributor either exists on disk or does not.
        wf_live = len(wf_who) >= 2 or wf_multi > 0
        # A second contributor cannot appear in a pool where only one bot has
        # been running. Without this, a pool with one live bot reports its
        # world model as INERT, which is a fact about the roster, not the
        # mechanism.
        # World facts are written by skill outcomes rather than gate firings,
        # so the volume floor is decisions, not citations. A pool six decisions
        # old with one contributor is young, not broken.
        wf_v = verdict(exp['wfacts'], wf_live, len(bots) >= 2,
                       d.get('decisions', 0))

        foreign = list(d.get('foreign', [])) + [(None, x) for x in sforeign]
        foreign += [(None, w) for w in wf_who if pool_of(w) != pool]

        for v, mech in ((l_v, 'lessons'), (wf_v, 'wfacts')):
            if v == 'LEAK':
                raise_to('leak')
            elif v == 'INERT' and exp[mech]:
                raise_to('inert')
            elif v == 'INSUFFICIENT':
                raise_to('insufficient')
        if foreign:
            raise_to('leak')

        rows.append({
            'pool': pool, 'arm': arm,
            'lessons': l_v, 'wfacts': wf_v,
            'bots': len(bots), 'decisions': d.get('decisions', 0),
            'gate_fired': d.get('gate_fired', 0), 'inherited': d.get('inherited', 0),
            'multi_reporter_rules': multi, 'inheritable_rules': inh_n,
            'wf_contributors': len(wf_who), 'wf_shared_entries': wf_multi,
            'board_calls': d.get('board_calls', 0),
            'foreign_reporters': len(foreign),
        })

    if strays:
        raise_to('leak')
    worst = RANK_EXIT[sev]

    if a.json:
        print(json.dumps({'rows': rows, 'strays': strays, 'notes': notes,
                          'severity': sev, 'exit': worst}, indent=1))
        return worst

    print(f"\n  TREATMENT LIVENESS -- last {a.hours:g}h, gate floor "
          f"{MIN_GATE_FIRINGS} firings\n")
    print("  %-11s %-13s %-13s %5s %6s %7s %8s %6s" % (
        "POOL", "LESSONS", "WORLD FACTS", "GATE", "INHER", "2-REP", "WF-BOTS",
        "BOARD"))
    for r in rows:
        flag = ''
        if 'LEAK' in (r['lessons'], r['wfacts']) or r['foreign_reporters']:
            flag = '  XX'
        elif (r['lessons'] == 'INERT' and EXPECT[r['arm']]['lessons']) or \
             (r['wfacts'] == 'INERT' and EXPECT[r['arm']]['wfacts']):
            flag = '  !!'
        elif 'INSUFFICIENT' in (r['lessons'], r['wfacts']):
            flag = '  ..'
        print("  %-11s %-13s %-13s %5d %6d %7d %8d %6d%s" % (
            r['pool'], r['lessons'], r['wfacts'], r['gate_fired'],
            r['inherited'], r['multi_reporter_rules'], r['wf_contributors'],
            r['board_calls'], flag))
        if r['foreign_reporters']:
            print(f"       CROSS-POOL reporters: {r['foreign_reporters']}")

    if strays:
        print(f"\n  STRAY PER-BOT COPIES OF POOL-NAMED FILES ({len(strays)}) "
              f"-- the original bug's exact signature:")
        for x in strays[:10]:
            print(f"       {x}")
    for n in notes:
        print(f"       note: {n}")

    print("\n  " + {
        'ok': "every arm shares exactly what it is declared to share.",
        'insufficient': "INSUFFICIENT signal -- not yet gateable. NOT a pass.",
        'inert': "an arm that should share is INERT despite opportunity.",
        'leak': "LEAK, cross-pool reporter, or stray store -- arms are contaminated.",
    }[sev])
    print("  Proves the variable is not switched off. Proves nothing about whether\n"
          "  it helps, and is blind to `worked` rules, which carry no reporters.\n")
    return worst


def gate(hours, sev):
    """Has the fleet been green CONTINUOUSLY, not merely green right now?"""
    cut = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    runs = []
    try:
        for line in open(HISTORY):
            try:
                r = json.loads(line)
                t = datetime.datetime.fromisoformat(r['t'])
            except Exception:
                continue
            if t >= cut:
                runs.append((t, r['severity']))
    except OSError:
        pass
    runs.append((datetime.datetime.now(datetime.timezone.utc), sev))
    bad = sorted({s for _, s in runs} - {'ok'})
    # Demand enough coverage that a quiet gap cannot pass for a green window.
    want = max(2, int(hours))
    print(f"\n  GATE: {len(runs)} recorded run(s) in the last {hours:g}h, "
          f"need >= {want}")
    if len(runs) < want:
        print(f"  BLOCKED -- too few runs to call the window green.\n")
        return 3
    if bad:
        print(f"  BLOCKED -- window contains: {', '.join(bad)}\n")
        return RANK_EXIT[max(bad, key=lambda x: RANK[x])]
    span = (runs[-1][0] - runs[0][0]).total_seconds() / 3600
    print(f"  OPEN -- green across {span:.1f}h. The measurement block may start.\n")
    return 0


if __name__ == '__main__':
    rc = main()
    if '--gate' in sys.argv or '--record' in sys.argv:
        # Re-derive severity from the exit code so the history records what the
        # run actually concluded rather than a second, independent judgement.
        sev = {v: k for k, v in RANK_EXIT.items()}[rc]
        if '--record' in sys.argv:
            try:
                with open(HISTORY, 'a') as fh:
                    fh.write(json.dumps({
                        't': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        'severity': sev}) + '\n')
            except OSError as e:
                print(f'  (history not written: {e})')
        for i, x in enumerate(sys.argv):
            if x == '--gate':
                rc = gate(float(sys.argv[i + 1]), sev)
    sys.exit(rc)
