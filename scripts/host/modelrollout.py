#!/usr/bin/env python3
r"""modelrollout.py -- the STAGED ROLLOUT of a KEPT model-env canary (first user qwen35-01, 10-31). Tooling tier.

OWNER 2026-10-31 ~03:00Z: "If the tests pass roll out in stages 20 bots at a time". It runs only after the canary loop
journalled `recorded KEEP` and `torn-down` for the run (promotion "none": the loop tore the canary down).

    modelrollout.py plan     [--run qwen35-01]          the stages, rates and timings; changes nothing
    modelrollout.py run      [--run qwen35-01] [--dry-run] [--resume]
    modelrollout.py status
    modelrollout.py rollback --all | --stage N          by hand (takes the loop lock); proves the env is gone
    modelrollout.py release                             accept a STOPPED, partly rolled fleet: frees the slot

THE MECHANISM IS THE CANARY'S, MADE PERSISTENT. The canary put its env on a pool with mcai-canary-tree's drop-in
`10-canary.conf` (EnvironmentFile=canary.env, appended after the unit's own per-bot env file, so its keys win). Every
canary teardown deletes EVERY 10-canary.conf, and the scheduler (S4), the installers and the tripper treat one as "a
canary is live", so a rollout cannot use that file. It writes its own drop-in `05-model.conf` per bot:
    [Service]
    EnvironmentFile=/srv/mcbots/harness/model-<run>.env       (the registration's canary_env, KEY=VALUE lines)
`05` sorts BEFORE `10-canary.conf`: a later canary's canary.env still overrides it (a model canary on a rolled pool
stays that canary's model), and mcai-canary-tree's teardown never touches it (rmdir of a non-empty dir fails quietly).
Code and CODE_VERSION do not change, so the tripper's one-canary/two-version rules and the version census see nothing.

STAGES (pools of 5 bots). Stage 1 = the canary's own pools again + POOLS_PER_STAGE more; then POOLS_PER_STAGE at a
time (the last stage takes what is left). 16 pools: 10 -> 30 -> 50 -> 70 -> 80 bots on the model, four stages.

EACH STAGE
  1 busy check   PROBE_N sequential-ish decisions through the fleet client; median > the p50 gate = the Blackwell is
                 already busy (someone else's job, or the live stages): wait 10 min, 3 tries, then STOP.
  2 load test    qwen35load.mjs (the fleet's own client, real logged prompts, Poisson arrivals) at the stage's OWN rate
                 (its bots x 1.33 decisions/min) for LOAD_MIN, ON TOP of the bots already rolled -- so the synthetic
                 requests see the next stage's total load. Gate: p50 <= 2500 ms, p95 <= 5000 ms, schema-valid >= 99 %,
                 zero transport errors. An early abort stops it once the last 30 answers' p95 > 3x the gate (the live
                 bots see at most LOAD_MIN of next-stage latency). A fail STOPS before anything is applied.
  3 apply        drop-ins, daemon-reload, restart the stage's bots 12 s apart, settle 90 s, then PROVE every bot's live
                 /proc/<pid>/environ carries every KEY=VALUE (sudo cat). Unproven = roll the stage back, STOP.
                 A ledger row (rollout.py add, phase owner-direct, run <run>-roll-sN) per stage.
  4 watch        every 5 min: modelread's stall poll over ALL rolled bots (>= 2 with no schema-valid model decision for
                 10 min = REVERT; endpoint down -> roll back EVERY stage, since there is no fallback; endpoint up -> the
                 stage); the fleet's declared sha must not move (a deploy mid-rollout = STOP, nothing rolled back).
  5 read +60     modelread over ALL rolled bots, POST = apply + 15 .. apply + 60: stall <= 1, model_share >= 0.95,
                 schema-valid >= 0.99 (and gap to the control <= 1 pp while a control exists), p50 <= 2500, p95 <= 5000,
                 completion p95 <= 300, >= 200 rows. Fail = roll the stage back, STOP.
  6 ledger check rollout.py's 60-min check of the stage's row (tripper, deaths vs the 24 h baseline with the two-death
                 floor, crash loops; cron runs it every 10 min, this waits for it and runs it itself by +85 min).
                 FAIL/ERROR = roll the stage back, STOP. WATCH = STOP with the stage kept (a human decides).

ROLLBACK (the three steps, per stage or all): delete the stage's 05-model.conf + daemon-reload; drop its pools from the
state file (the rollout's config); restart its bots 12 s apart; then prove no live environ still carries a model
KEY=VALUE (values, not keys: the per-bot env sets the same keys -- loop v38's rule).

THE SLOT. One canary slot: a canary drawn from a part-rolled fleet would have a mixed-model control. The rollout claims
the scheduler's install-hold through holdtoken.py (own token, HOLD_MIN) and then holds /tmp/mcai-canary.lock (flock -n)
for its whole run, as installers do. COMPLETE releases both. A STOP with nothing left rolled releases both. A STOP that
leaves stages rolled KEEPS the hold (a stale hold BLOCKS the scheduler, it does not free it) and pages the two ways out:
`release` (the part-rolled fleet is the new baseline) or `rollback --all` (everything back, then release).
Pages go to ~/digest/page.jsonl (run <run>-roll); journal rows to ~/canary-journal.jsonl, phases `rollout-*` only
(never drawn/deployed/read-*/recorded/torn-down, so canary-sched never takes the rollout for a canary).
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import glob
import io
import json
import os
import re
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
UTC = dt.timezone.utc
H = os.path.expanduser('~')

DEC_PER_BOT_MIN = 1.33          # the fleet's measured decision rate (10-30)
POOLS_PER_STAGE = 4             # 20 bots (owner)
LOAD_MIN = 5
PROBE_N = 5
BUSY_TRIES, BUSY_WAIT_S = 3, 600
STAGGER_S, SETTLE_S, POLL_S = 12, 90, 300
READ_AT_MIN = 60
CHECK_BY_MIN = 85
HOLD_MIN = 600
LOAD_HARD_S = LOAD_MIN * 60 + 300  # a hung load test is killed
POLL_BLIND_MAX = 3               # unreadable stall polls in a row (15 min) = the guard is down: roll the stage back
# A stage whose env may be on any bot. `applying` is set BEFORE the first drop-in is written and `rollback-unproven`
# when a rollback could not prove the env gone: both count as rolled, so rollback retries them and no path frees
# the slot while they exist (both reviewers r1).
LIVE = ('applying', 'applied', 'passed', 'rollback-unproven')
# EXPERIMENT MODE (OWNER 2026-10-31 ~14:00Z: all 80 bots on qwen3.5:9b for 24 h, then compare; ~14:15Z: the Blackwell is
# for testing only, so the +24 h rollback is MANDATORY). Latency/load numbers are data, not stops. Stops (every one rolls
# back EVERY stage, frees the slot and pushes): endpoint down twice in a row, a fleet stall, crash loops on >= 2 units,
# the death gate, a tripper TRIP. After the rollout the install-hold is released (canaries go on: a later code canary keeps
# 05-model.conf, so both arms run the model) and `watch` (cron, every 5 min) holds the same stops for the 24 h, records
# hourly numbers, and at +24 h writes the comparison and rolls back -- unconditionally, also when the comparison fails.
EXP_POOLS_PER_STAGE = 4          # 20 bots a stage
EXP_CHECK_S = (360, 360)         # per stage: health checks at +6 and +12 min after the env proof (both past EXP_WARM_MIN)
EXP_WARM_MIN = 5                 # a bot's stall clock starts 5 min after ITS stage's env proof (modelread's 15 would hide
                                 # every stage's own bots from its own checks: Codex r1)
EXP_UNREAD_MAX = 3               # the same probe unreadable on 3 evaluations in a row = a stop (a guard that is down)
EXP_DRIVER_MAX_H = 3             # a `running` experiment whose driver process is gone this long after start = roll back
EXP_HOURS = 24
EXP_HARD_HOURS = 25              # past this the watch rolls back FIRST, before anything else
EXP_LOOP_UNITS = 2               # crash loops on this many units in the last hour = stop
EXP_STALL_FRAC = 0.25            # a FLEET stall: >= max(2, 25 % of active) bots with no valid decision for 10 min ...
EXP_STALL_POLLS = 2              # ... on two polls in a row
EXP_EP_FAILS = 2                 # endpoint /api/version failing on two polls in a row
DEATH_WINDOW_H = 6               # the death gate reads the trailing 6 h (a full file walk of 3 h takes ~28 s on .31)
DEATH_X, DEATH_Q = 1.25, 0.99    # deaths >= 2 AND > 1.25 x the 7-day rate x bot-h AND past its Poisson 99 % bound
TIMEOUT_MS = 45000               # LLM_TIMEOUT_MS in all 80 env files (10-31)
GATES = {'lat_p50_ms': 2500, 'lat_p95_ms': 5000, 'completion_p95': 300, 'model_share': 0.95, 'schema_valid': 0.99,
         'schema_gap_pp': 1.0, 'stall_bots': 1, 'min_rows': 200, 'load_valid': 0.99}
EARLY_ABORT_N, EARLY_ABORT_X = 30, 3
DROPIN = '05-model.conf'
KV_RE = re.compile(r'[A-Z_][A-Z0-9_]*=[^\s*?\[\]]+')
BOT_RE = re.compile(r'([a-z]+-[a-z])-[A-Z][a-z]+')
ARM_ORDER = ('board', 'hive', 'placebo', 'isolated')

P = {
    'journal': os.environ.get('ROLL_JOURNAL', os.path.join(H, 'canary-journal.jsonl')),
    'page': os.environ.get('ROLL_PAGE', os.path.join(H, 'digest', 'page.jsonl')),
    'home': os.environ.get('ROLL_HOME', os.path.join(H, 'qwen35-rollout')),
    'regdir': os.environ.get('ROLL_REG_DIR', os.path.join(H, 'mcai-analysis', 'registrations')),
    'manifest': os.environ.get('ROLL_MANIFEST', '/srv/mcbots/trial-manifest.json'),
    'unitdir': os.environ.get('ROLL_UNITDIR', '/etc/systemd/system'),
    'envdir': os.environ.get('ROLL_ENV_DIR', '/srv/mcbots/harness/env'),
    'harness': os.environ.get('ROLL_HARNESS', '/srv/mcbots/harness'),
    'lock': os.environ.get('ROLL_LOCK', '/tmp/mcai-canary.lock'),
    'items': os.environ.get('ROLL_ITEMS', os.path.join(H, 'learnloop', 'datasets', 'v0', 'm3-eval.jsonl')),
    'bots': os.environ.get('ROLL_BOTS', '/opt/minecraft-ai/bots'),
    'rollout_py': os.environ.get('ROLL_ROLLOUT_PY', os.path.join(H, 'w5alarms', 'scripts', 'host', 'rollout.py')),
    'heavyread': os.environ.get('ROLL_HEAVYREAD', os.path.join(H, 'mcai-analysis', 'heavyread.sh')),
}


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None


def read_jsonl(p):
    out = []
    if os.path.exists(p):
        with open(p, errors='replace') as f:
            for l in f:
                try:
                    out.append(json.loads(l))
                except ValueError:
                    pass
    return out


# ------------------------------------------------------------------------------------------------- pure decisions --
def parse_env(reg):
    """PURE. The registration's canary_env -> list of KEY=VALUE, or raises ValueError (the loop's own rule)."""
    kv = list(reg.get('canary_env') or [])
    if reg.get('class') != 'model-env' or not kv:
        raise ValueError('registration is not class model-env with a canary_env')
    bad = [x for x in kv if not KV_RE.fullmatch(x) or x.split('=', 1)[0] in ('CODE_VERSION', 'RUN_ID')]
    if bad:
        raise ValueError('canary_env entries not KEY=VALUE (or CODE_VERSION/RUN_ID): %s' % bad)
    if not any(x.startswith('OLLAMA_MODEL=') for x in kv):
        raise ValueError('canary_env sets no OLLAMA_MODEL')
    return kv


def model_of(kvs):
    return next(x.split('=', 1)[1] for x in kvs if x.startswith('OLLAMA_MODEL='))


def url_of(kvs):
    for x in kvs:
        if x.startswith('OLLAMA_BASE_URLS='):
            return x.split('=', 1)[1].split(',')[0].split('|')[0]
    return None


def pool_of(bot):
    m = BOT_RE.fullmatch(bot)
    return m.group(1) if m else None


def order_pools(pools):
    """PURE. Interleave the arms by letter: board-a, hive-a, placebo-a, isolated-a, board-b, ..."""
    def key(p):
        arm, letter = p.rsplit('-', 1)
        return (letter, ARM_ORDER.index(arm) if arm in ARM_ORDER else len(ARM_ORDER), arm)
    return sorted(pools, key=key)


def plan(all_pools, canary_pools, per_stage=POOLS_PER_STAGE):
    """PURE. -> [[pools of stage 1], ...]. Stage 1 = the canary's pools + per_stage more; then per_stage at a time."""
    canary = [p for p in order_pools(canary_pools) if p in all_pools]
    rest = [p for p in order_pools(all_pools) if p not in canary]
    stages = [canary + rest[:per_stage]]
    rest = rest[per_stage:]
    while rest:
        stages.append(rest[:per_stage]); rest = rest[per_stage:]
    return [s for s in stages if s]


def stage_rate(n_bots):
    return round(n_bots * DEC_PER_BOT_MIN, 1)


def pct(xs, q):
    xs = sorted(x for x in xs if isinstance(x, (int, float)))
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None


def load_stats(rows):
    """PURE. qwen35load.mjs rows -> stats (loadstats.py's arithmetic)."""
    ok = [r for r in rows if not r.get('transport_error')]
    lat = [r.get('latencyMs') for r in ok]
    return {'n': len(rows), 'transport_errors': len(rows) - len(ok),
            'valid_share': (sum(1 for r in ok if r.get('schemaValid')) / len(rows)) if rows else None,
            'p50': pct(lat, .5), 'p95': pct(lat, .95), 'max': max([x for x in lat if isinstance(x, (int, float))], default=None)}


def load_verdict(st, min_n):
    """PURE. -> (ok, why)."""
    why = []
    if st['n'] < min_n:
        why.append('only %d of %d answers (aborted or cut short)' % (st['n'], min_n))
    if st['transport_errors']:
        why.append('%d transport errors' % st['transport_errors'])
    if st['valid_share'] is None or st['valid_share'] < GATES['load_valid']:
        why.append('schema-valid %s < %s' % (st['valid_share'], GATES['load_valid']))
    if st['p50'] is None or st['p50'] > GATES['lat_p50_ms']:
        why.append('p50 %s ms > %d' % (st['p50'], GATES['lat_p50_ms']))
    if st['p95'] is None or st['p95'] > GATES['lat_p95_ms']:
        why.append('p95 %s ms > %d' % (st['p95'], GATES['lat_p95_ms']))
    return (not why), why


def early_abort(rows):
    """PURE. True once the last EARLY_ABORT_N answers' p95 is past EARLY_ABORT_X x the p95 gate."""
    lat = [r.get('latencyMs') for r in rows if not r.get('transport_error')]
    if sum(1 for r in rows if r.get('transport_error')) >= 3:
        return True
    if len(lat) < EARLY_ABORT_N:
        return False
    return (pct(lat[-EARLY_ABORT_N:], .95) or 0) > EARLY_ABORT_X * GATES['lat_p95_ms']


def read_verdict(f):
    """PURE. modelread fields over all rolled bots -> (ok, why)."""
    why = []
    def gate(k, op, v):
        x = f.get(k)
        if x is None or not (x <= v if op == '<=' else x >= v):
            why.append('%s %s (gate %s %s)' % (k, x, op, v))
    gate('stall_bots', '<=', GATES['stall_bots'])
    gate('model_share', '>=', GATES['model_share'])
    gate('schema_valid_canary', '>=', GATES['schema_valid'])
    if f.get('control_bots'):
        gate('schema_gap_pp', '<=', GATES['schema_gap_pp'])
    gate('lat_p50_ms', '<=', GATES['lat_p50_ms'])
    gate('lat_p95_ms', '<=', GATES['lat_p95_ms'])
    gate('completion_p95', '<=', GATES['completion_p95'])
    gate('canary_post_rows', '>=', GATES['min_rows'])
    return (not why), why


def poll_scope(line):
    """PURE. A MODELPOLL line -> None (go on) | 'stage' | 'all'. A REVERT with the endpoint down rolls back EVERY stage
    (no fallback: every rolled bot is stalled); with the endpoint up it is load or a stage fault: the stage."""
    parts = (line or '').split()
    if len(parts) < 2 or parts[0] != 'MODELPOLL' or parts[1] != 'REVERT':
        return None
    return 'all' if 'DOES NOT answer' in line else 'stage'


def check_action(verdict):
    """PURE. rollout.py's 60-min check verdict -> 'pass' | 'rollback' | 'hold'."""
    return {'PASS': 'pass', 'WATCH': 'hold'}.get(verdict, 'rollback')


def dropin_text(env_file):
    return '[Service]\n# modelrollout.py (staged model rollout): appended env, sorts before 10-canary.conf\nEnvironmentFile=%s\n' % env_file


def env_missing(envtxt, kvs):
    """PURE. The KEY=VALUE pairs of kvs absent from a live environ text (one pair per line)."""
    lines = set((envtxt or '').split('\n'))
    return [kv for kv in kvs if kv not in lines]


def env_present(envtxt, kvs):
    lines = set((envtxt or '').split('\n'))
    return [kv for kv in kvs if kv in lines]


def keep_closed(journal, run):
    """PURE. (ok, why): the canary loop recorded KEEP and finished its teardown (torn-down after the last
    teardown-incomplete), and nothing says REVERT/INCONCLUSIVE."""
    rows = [r for r in journal if r.get('run') == run]
    rec = [r for r in rows if r.get('phase') == 'recorded']
    if not rec:
        return False, '%s has no `recorded` row (not decided yet)' % run
    if str(rec[-1].get('note') or '').split()[:1] != ['KEEP']:
        return False, '%s recorded %r, not KEEP' % (run, rec[-1].get('note'))
    idx = [i for i, r in enumerate(rows) if r.get('phase') == 'torn-down']
    bad = [i for i, r in enumerate(rows) if r.get('phase') == 'teardown-incomplete']
    if not idx:
        return False, '%s has no `torn-down` row (teardown not finished)' % run
    if bad and bad[-1] > idx[-1]:
        return False, '%s: teardown-incomplete after the last torn-down' % run
    return True, 'KEEP recorded and torn down'


def canary_pools_of(journal, run):
    """PURE. The canary's pools from its `deployed` row ('<pools> <declared_at>'), else its last `drawn` row."""
    for ph in ('deployed', 'drawn'):
        rows = [r for r in journal if r.get('run') == run and r.get('phase') == ph]
        if rows:
            first = str(rows[0 if ph == 'deployed' else -1].get('note') or '').split()
            return [p for p in (first[0] if first else '').split(',') if p]
    return []


def est_minutes(stages):
    """PURE. Wall-clock estimate per stage: probe 1 + load LOAD_MIN + 1 drain + restarts + settle + read + ledger wait."""
    out = []
    for s in stages:
        bots = 5 * len(s)
        out.append(round(1 + LOAD_MIN + 1 + bots * STAGGER_S / 60 + SETTLE_S / 60 + READ_AT_MIN + 10))
    return out


def fleet_stall_trip(n_stalled, n_active):
    """PURE. A FLEET stall (the model is not serving the fleet), not one slow bot: >= max(2, 25 % of active)."""
    import math
    return n_active > 0 and n_stalled >= max(2, math.ceil(EXP_STALL_FRAC * n_active))


def poisson_upper(mu, q):
    """PURE. Smallest k with P(X <= k) >= q, X ~ Poisson(mu) (rollout.py's)."""
    import math
    if mu <= 0:
        return 0
    k, p = 0, math.exp(-mu)
    cdf = p
    while cdf < q and k < 100000:
        k += 1; p *= mu / k; cdf += p
    return k


def death_trip(deaths, bot_h, rate):
    """PURE. -> (trip, why). The two-death floor, > DEATH_X x the 7-day baseline, and past its Poisson DEATH_Q bound (two
    deaths in the first hour of 80 bots is ~44 % likely at the baseline rate: 1.25x alone would roll back on noise)."""
    if rate is None or not bot_h:
        return False, 'deaths %s over %.1f bot-h; no baseline rate: not judged' % (deaths, bot_h or 0)
    mu = rate * bot_h
    trip = deaths >= 2 and deaths > DEATH_X * mu and deaths > poisson_upper(mu, DEATH_Q)
    return trip, 'deaths %d over %.1f bot-h vs %.2f expected at the 7-day rate %.4f/bot-h (trip at > %.2f and > %d)' % (
        deaths, bot_h, mu, rate, DEATH_X * mu, poisson_upper(mu, DEATH_Q))


def exp_reasons(f, w):
    """PURE. Health facts f + the watch counters w (updated in place) -> the stop reasons ([] = go on)."""
    why = []
    w['ep_fail'] = 0 if f.get('endpoint_ok') else w.get('ep_fail', 0) + 1
    if w['ep_fail'] >= EXP_EP_FAILS:
        why.append('endpoint %s down on %d polls in a row' % (f.get('url'), w['ep_fail']))
    if f.get('stall') is not None:
        n, act = f['stall']
        w['stall_hits'] = w.get('stall_hits', 0) + 1 if fleet_stall_trip(n, act) else 0
        if w['stall_hits'] >= EXP_STALL_POLLS:
            why.append('fleet stall: %d of %d active bots with no valid %s decision for 10 min, %d polls in a row' % (
                n, act, f.get('model'), w['stall_hits']))
    for k in ('stall', 'crash_loops', 'tripper', 'death'):
        if k not in f:
            continue                       # not evaluated this time: the count stands
        if k in (f.get('unread_keys') or []):
            w['unread_' + k] = w.get('unread_' + k, 0) + 1
            if w['unread_' + k] >= EXP_UNREAD_MAX:
                why.append('the %s probe was unreadable %d evaluations in a row: the guard is down' % (k, w['unread_' + k]))
        else:
            w['unread_' + k] = 0
    loops = f.get('crash_loops') or {}
    if len(loops) >= EXP_LOOP_UNITS:
        why.append('crash loops on %d units: %s' % (len(loops), ', '.join(sorted(loops)[:5])))
    if f.get('death') and f['death'][0]:
        why.append('death gate: ' + f['death'][1])
    if (f.get('tripper') or {}).get('verdict') == 'TRIP':
        why.append('tripper TRIP: ' + '; '.join(f['tripper'].get('trips') or [])[:200])
    return why


def is_timeout(L):
    return bool(re.search(r'time ?out|timed out|abort', str(L.get('error') or ''), re.I)) or (L.get('latency_ms') or 0) >= TIMEOUT_MS


def hour_stats(rows_by_bot, model, minutes):
    """PURE. One window of llm rows -> the hourly record (work orders excluded: modelread's is_order)."""
    import modelread as mr
    rows = [r for v in rows_by_bot.values() for r in v if not mr.is_order(r)]
    L = [r.get('llm') or {} for r in rows]
    lat = [x.get('latency_ms') for x in L if x.get('schema_valid')]
    n = len(rows)
    return {'bots_with_rows': sum(1 for v in rows_by_bot.values() if v), 'decisions': n,
            'decisions_per_min': round(n / minutes, 2) if minutes else None,
            'lat_p50_ms': pct(lat, .5), 'lat_p95_ms': pct(lat, .95), 'lat_p99_ms': pct(lat, .99),
            'timeouts': sum(1 for x in L if is_timeout(x)), 'invalid_share': round(sum(1 for x in L if not x.get('schema_valid')) / n, 4) if n else None,
            'model_share': round(sum(1 for r in rows if mr.served_by(r, model)) / n, 4) if n else None,
            'unserved': sum(1 for x in L if not x.get('endpoint'))}


# --------------------------------------------------------------------------------------------------- the host --
class Host:
    """Every side effect, so the driver can be run against a fake in the tests."""

    def now(self):
        return dt.datetime.now(UTC).replace(microsecond=0)

    def sleep(self, s):
        time.sleep(s)

    def sh(self, args, inp=None, timeout=300):
        r = subprocess.run(args, input=inp, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout + r.stderr

    def write_root(self, path, text):
        rc, out = self.sh(['sudo', 'mkdir', '-p', os.path.dirname(path)])
        if rc == 0:
            rc, out = self.sh(['sudo', 'tee', path + '.tmp'], inp=text)
        if rc == 0:
            rc, out = self.sh(['sudo', 'mv', '-f', path + '.tmp', path])
        if rc != 0:
            raise RuntimeError('write %s: %s' % (path, out[-200:]))

    def remove_root(self, path):
        rc, out = self.sh(['sudo', 'rm', '-f', path])
        if rc != 0:
            raise RuntimeError('rm %s: %s' % (path, out[-200:]))
        self.sh(['sudo', 'rmdir', os.path.dirname(path)])      # fails quietly while other drop-ins remain

    def exists(self, path):
        return os.path.exists(path)

    def daemon_reload(self):
        rc, out = self.sh(['sudo', 'systemctl', 'daemon-reload'])
        if rc != 0:
            raise RuntimeError('daemon-reload: ' + out[-200:])

    def restart(self, bot):
        return self.sh(['sudo', 'systemctl', 'restart', 'mcbot@%s.service' % bot])[0] == 0

    def environ(self, bot):
        rc, pid = self.sh(['systemctl', 'show', '-p', 'MainPID', '--value', 'mcbot@%s.service' % bot])
        pid = pid.strip()
        if rc != 0 or not pid.isdigit() or pid == '0':
            return None
        rc, txt = self.sh(['sudo', 'cat', '/proc/%s/environ' % pid])
        return txt.replace('\0', '\n') if rc == 0 and txt else None

    def canary_dropins(self):
        return sorted(glob.glob(os.path.join(P['unitdir'], 'mcbot@*.service.d', '10-canary.conf')))

    def model_dropins(self):
        return sorted(glob.glob(os.path.join(P['unitdir'], 'mcbot@*.service.d', DROPIN)))

    def loop_running(self):
        rc, out = self.sh(['ps', '-eo', 'args'])
        return [l for l in out.splitlines() if re.search(r'canary-loop\.sh|fleet-deploy|/root/d\.sh|deploy-fleet\.sh', l)
                and 'modelrollout' not in l]

    def manifest(self):
        return json.load(open(P['manifest']))

    def hold_claim(self, token, minutes):
        rc, out = self.sh(['python3', os.path.join(HERE, 'holdtoken.py'), 'claim', token, str(minutes)], timeout=1200)
        return rc == 0, out.strip()

    def hold_release(self, token):
        return self.sh(['python3', os.path.join(HERE, 'holdtoken.py'), 'release', token], timeout=1200)[1].strip()

    def hold_owner(self):
        return self.sh(['python3', os.path.join(HERE, 'holdtoken.py'), 'owner'])[1].strip()

    def take_lock(self):
        self._lockfd = os.open(P['lock'], os.O_RDWR | os.O_CREAT, 0o666)
        try:
            fcntl.flock(self._lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            os.close(self._lockfd); self._lockfd = None
            return False

    def loadtest(self, url, model, rate, n, out, seed):
        """qwen35load.mjs at `rate`/min for n items (a slice of the replay items), killed early by early_abort."""
        items = [l for l in open(P['items']) if l.strip()]
        sl = os.path.join(os.path.dirname(out), 'items-%d.jsonl' % seed)
        with open(sl, 'w') as f:
            for i in range(n):
                f.write(items[(seed * 97 + i) % len(items)])
        err = open(out + '.err', 'w')
        pr = subprocess.Popen(['node', os.path.join(HERE, 'qwen35load.mjs'), P['bots'], sl, out, url, model, str(rate), str(seed)],
                              stdout=err, stderr=err)
        aborted, t0 = False, time.time()
        while pr.poll() is None:
            time.sleep(10)
            if early_abort(read_jsonl(out)) or time.time() - t0 > LOAD_HARD_S:
                pr.kill(); aborted = True
        pr.wait()
        return read_jsonl(out), aborted

    def modelpoll(self, ctxdir):
        mr = _modelread(ctxdir)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            mr.do_poll()
        return buf.getvalue().strip().splitlines()[-1] if buf.getvalue().strip() else ''

    def stage_read(self, ctxdir, M):
        """modelread's +M read in a memory-capped scope (heavyread.sh, the loop's own wrapper) -> fields or raises."""
        out = os.path.join(ctxdir, 'read-%d.txt' % M)
        cmd = ['python3', os.path.abspath(__file__), '_read', ctxdir, str(M)]
        if os.path.exists(P['heavyread']):
            cmd = ['bash', P['heavyread'], '900', out, '--'] + cmd
            env = dict(os.environ, HEAVYREAD_ROLE='loop')
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=1200, env=env)
            txt = open(out).read() if os.path.exists(out) else r.stdout
        else:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)
            txt = r.stdout
        last = [l for l in txt.splitlines() if l.startswith('ROLLREAD ')]
        if r.returncode != 0 or not last:
            raise RuntimeError('read failed rc %s: %s' % (r.returncode, (txt + r.stderr)[-300:]))
        return json.loads(last[-1][len('ROLLREAD '):])

    def rollout_add(self, run, sha, at, note):
        rc, out = self.sh(['python3', '-B', P['rollout_py'], 'add', '--env', 'fleet', '--run', run, '--sha', sha, '--prev', sha,
                           '--tier', '3', '--reviewer', 'canary KEEP + claude/codex (tooling)', '--at', at, '--note', note],
                          timeout=120)
        if rc != 0:
            raise RuntimeError('rollout.py add: ' + out[-200:])

    def endpoint_ok(self, url):
        import urllib.request
        try:
            urllib.request.urlopen(url + '/api/version', timeout=10).read()
            return True
        except Exception:
            return False

    def stall(self, ctxdir):
        """(stalled, active) over the ctx's pools, modelread's own stall rule (WARM_MIN after the ctx's declared_at)."""
        mr = _modelread(ctxdir)
        mr.WARM_MIN = EXP_WARM_MIN
        man, run, reg, pools, decl = mr.context()
        pd = man.get('pool_decl') or {}
        t = mr.now()
        n_st, n_act = 0, 0
        for p in pools:                    # each pool's stall clock from ITS stage's env proof
            bots = mr.roster([p])
            act = mr.units_active(bots)
            llm = {b: mr.read_stream(b, 'llm', t - dt.timedelta(minutes=mr.STALL_MIN + 5), t) for b in bots}
            n_st += len(mr.stall_bots(llm, act, mr.canary_model(reg), str(man.get('canary_code_version') or ''), t,
                                      ts(pd.get(p)) or decl))
            n_act += sum(1 for v in act.values() if v)
        return n_st, n_act

    def crash_loops(self, t0, t1):
        f = _w5().crash_facts('mcbot@*.service', t0, t1)
        loops = f.get('crash_loops') or {}
        if '<journal unreadable>' in loops or not f.get('unit_lines'):
            raise RuntimeError('systemd journal unreadable or no mcbot unit lines in the window (positive control)')
        return loops

    def tripper(self):
        return _w5().tripper_fleet()

    def deaths(self, t0, t1):
        """(_death rows, active bot-h) of the fleet's bots (showcase excluded), a full file walk."""
        w = _w5()
        from lib.logwindow import load_window
        rows = [r for r in load_window(t0, t1).rows if not str((r.get('bot') or {}).get('name') or '').startswith('showcase')]
        f = w.window_facts(rows, '', start=t0)
        return f['deaths'], f['bot_hours']

    def baseline_7d(self, t0):
        """The 7-day death rate per active bot-h before t0 (Elasticsearch: a wide window)."""
        w = _w5()
        from lib.estelemetry import EsEvents
        ev = EsEvents.load('skill', since=t0 - dt.timedelta(days=7), until=t0, gaps='allow')
        if not ev.total():
            return None, 0.0
        bh = w.es_slot_bot_hours(ev)
        d = ev.count('_death', allow_zero=True)
        return (d / bh if bh else None), bh

    def hourly(self, t0, t1, model):
        sys.path.insert(0, HERE)
        import modelread as mr
        mr.LOG_ROOT = os.environ.get('MODELREAD_LOG_ROOT', '/var/log/mcai')
        rows = {}
        for e in sorted(glob.glob(os.path.join(P['envdir'], '*.env'))):
            b = os.path.basename(e)[:-4]
            if pool_of(b):
                rows[b] = mr.read_stream(b, 'llm', t0, t1)
        return hour_stats(rows, model, (t1 - t0).total_seconds() / 60)

    def notify(self, subject, body):
        try:
            _w5()
            from lib import alarm as AL
            AL.one_shot('qwen35-roll', {subject: body}, self.now())
        except Exception as x:
            print('notify failed: %s' % x)

    def compare(self, timeout_s=2400):
        """modelcompare.py -> (ok, text). Never raises: the rollback after it is unconditional."""
        try:
            r = subprocess.run(['nice', '-n', '10', 'python3', os.path.join(HERE, 'modelcompare.py')], capture_output=True,
                               text=True, timeout=timeout_s)
            return r.returncode == 0, (r.stdout + r.stderr)[-3000:]
        except Exception as x:
            return False, '%s: %s' % (type(x).__name__, x)

    def pid_alive(self, pid):
        try:
            os.kill(int(pid), 0); return True
        except (OSError, ValueError, TypeError):
            return False

    def own_lock(self):
        self._ownfd = os.open(os.path.join(P['home'], 'watch.lock'), os.O_RDWR | os.O_CREAT, 0o664)
        try:
            fcntl.flock(self._ownfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def rollout_check(self, run):
        return self.sh(['python3', '-B', P['rollout_py'], 'check', '--env', 'fleet', '--run', run], timeout=1800)[1]


def _w5():
    """rollout.py (the W5 ledger: tripper_fleet, crash_facts, es_slot_bot_hours) and its lib, from their install."""
    import importlib.util
    d = os.path.dirname(os.path.dirname(P['rollout_py']))
    if d not in sys.path:
        sys.path.insert(0, d)
    spec = importlib.util.spec_from_file_location('rollout_w5', P['rollout_py'])
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sigterm(signum, frame):
    raise SystemExit(128 + signum)


def _modelread(ctxdir):
    import importlib.util
    spec = importlib.util.spec_from_file_location('modelread_roll', os.path.join(HERE, 'modelread.py'))
    mr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mr)
    mr.MANIFEST = os.path.join(ctxdir, 'manifest.json')
    mr.REG_DIR = ctxdir
    mr.ENV_DIR = P['envdir']
    mr.MIN_CONTROL = 0
    os.environ['MODELREAD_NO_EMIT'] = '1'
    return mr


# ------------------------------------------------------------------------------------------------- the driver --
class Stop(Exception):
    pass


class Rollout:
    def __init__(self, host, run, dry=False, out=print, experiment=False):
        self.h, self.run, self.dry, self.say, self.exp = host, run, dry, out, experiment
        self.rid = run.rsplit('-', 1)[0] + '-roll' if re.search(r'-\d+$', run) else run + '-roll'   # qwen35-01 -> qwen35-roll
        self.statep = os.path.join(P['home'], 'state.json')
        self.reg = json.load(open(os.path.join(P['regdir'], '%s.json' % run)))
        self.kvs = parse_env(self.reg)
        self.model, self.url = model_of(self.kvs), url_of(self.kvs)
        self.envfile = os.path.join(P['harness'], 'model-%s.env' % run)
        self.st = None

    # -- records
    def journal(self, phase, note, **kw):
        row = dict({'ts': iso(self.h.now()), 'run': self.rid, 'phase': phase, 'note': note}, **kw)
        with open(P['journal'], 'a') as f:
            f.write(json.dumps(row) + '\n')

    def page(self, level, msg):
        os.makedirs(os.path.dirname(P['page']), exist_ok=True)
        with open(P['page'], 'a') as f:
            f.write(json.dumps({'ts': iso(self.h.now()), 'run': self.rid, 'level': level, 'msg': msg}) + '\n')
        self.say('PAGE[%s] %s' % (level, msg))

    def save(self):
        os.makedirs(P['home'], exist_ok=True)
        tmp = self.statep + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.st, f, indent=1)
        os.replace(tmp, self.statep)

    def load(self):
        self.st = json.load(open(self.statep)) if os.path.exists(self.statep) else None
        return self.st

    # -- roster
    def all_pools(self):
        return sorted({pool_of(os.path.basename(e)[:-4]) for e in glob.glob(os.path.join(P['envdir'], '*.env'))} - {None})

    def bots(self, pools):
        out = []
        for e in sorted(glob.glob(os.path.join(P['envdir'], '*.env'))):
            b = os.path.basename(e)[:-4]
            if pool_of(b) in pools:
                out.append(b)
        return out

    def rolled_pools(self):
        return [p for s in self.st['stages'] if s['status'] in LIVE for p in s['pools']]

    def unproven(self):
        return [i for i, s in enumerate(self.st['stages'], 1) if s['status'] in ('applying', 'rollback-unproven')]

    def dropin(self, bot):
        return os.path.join(P['unitdir'], 'mcbot@%s.service.d' % bot, DROPIN)

    # -- plan
    def make_plan(self, journal):
        cp = canary_pools_of(journal, self.run)
        stages = plan(self.all_pools(), [], EXP_POOLS_PER_STAGE) if self.exp else plan(self.all_pools(), cp)
        return cp, stages

    def describe_plan(self, journal):
        cp, stages = self.make_plan(journal)
        mins = est_minutes(stages)
        cum = len(self.bots(cp)) if cp else 0
        lines = ['%s staged rollout: %s @ %s; canary pools %s; %d pools in %d stages' % (
            self.run, self.model, self.url, ','.join(cp) or '?', len(self.all_pools()), len(stages))]
        cum = 0
        for i, (s, m) in enumerate(zip(stages, mins), 1):
            n = len(self.bots(s)); cum += n
            lines.append('  stage %d: %-60s +%2d bots -> %2d on the model; load test %.1f/min synthetic on top of the '
                         'rolled bots (total %.1f/min); ~%d min' % (i, ','.join(s), n, cum, stage_rate(n), stage_rate(cum), m))
        lines.append('  total ~%d min (%.1f h); install-hold %d min' % (sum(mins), sum(mins) / 60, HOLD_MIN))
        return cp, stages, '\n'.join(lines)

    # -- preflight
    def preflight(self, journal, resume):
        why = []
        ok, w = keep_closed(journal, self.run)
        if not ok:
            why.append(w)
        man = self.h.manifest()
        if man.get('canary_pool') or man.get('canary_code_version'):
            why.append('the manifest declares a canary (%s %s)' % (man.get('canary_pool'), man.get('canary_code_version')))
        if self.h.canary_dropins():
            why.append('canary drop-ins exist: %s' % self.h.canary_dropins()[:3])
        if self.h.loop_running():
            why.append('a loop/deploy runs: %s' % self.h.loop_running()[:2])
        if not resume and self.h.model_dropins():
            why.append('%s drop-ins already exist (%d): a rollout ran before; `status`, or --resume' % (DROPIN, len(self.h.model_dropins())))
        if not man.get('declared_code_version'):
            why.append('the manifest declares no fleet sha')
        return why, man

    # -- the stage steps
    def ctxdir(self, i):
        return os.path.join(P['home'], 'stage-%s' % i)

    def write_ctx(self, i, at):
        d = self.ctxdir(i); os.makedirs(d, exist_ok=True)
        run = '%s-s%s' % (self.rid, i)
        pool_decl = {p: (s.get('t_apply') or at) for s in self.st['stages'] if s['status'] in LIVE for p in s['pools']}
        json.dump({'run_id': run, 'canary_pool': ','.join(self.rolled_pools()), 'declared_at': at, 'pool_decl': pool_decl,
                   'canary_code_version': self.st['fleet_sha'], 'declared_code_version': self.st['fleet_sha']},
                  open(os.path.join(d, 'manifest.json'), 'w'))
        json.dump({'run_id': run, 'class': 'model-env', 'canary_env': self.kvs}, open(os.path.join(d, '%s.json' % run), 'w'))
        return d

    def busy_check(self, i):
        for k in range(1, BUSY_TRIES + 1):
            rows, _ = self.h.loadtest(self.url, self.model, 6, PROBE_N, os.path.join(self.ctxdir(i), 'probe-%d.jsonl' % k), 900 + i * 10 + k)
            s = load_stats(rows)
            if s['n'] >= PROBE_N and not s['transport_errors'] and s['p50'] is not None and s['p50'] <= GATES['lat_p50_ms']:
                self.journal('rollout-busycheck', 'stage %d: probe p50 %s ms over %d (not busy)' % (i, s['p50'], s['n']))
                return
            self.journal('rollout-busycheck', 'stage %d try %d: BUSY or failing: %s' % (i, k, s))
            if k < BUSY_TRIES:
                self.h.sleep(BUSY_WAIT_S)
        raise Stop('stage %d: the Blackwell is busy or failing before the load test (%d probes): %s' % (i, BUSY_TRIES, s))

    def load_test(self, i, n_bots):
        rate = stage_rate(n_bots)
        n = int(round(rate * LOAD_MIN))
        rows, aborted = self.h.loadtest(self.url, self.model, rate, n, os.path.join(self.ctxdir(i), 'load.jsonl'), 1031 + i)
        s = load_stats(rows)
        ok, why = load_verdict(s, n)
        self.journal('rollout-loadtest', 'stage %d: %.1f/min synthetic (+%d bots) on top of %d rolled bots: %s%s -> %s' % (
            i, rate, n_bots, len(self.bots(self.rolled_pools())), json.dumps(s), ' (EARLY ABORT)' if aborted else '',
            'PASS' if ok else 'FAIL: ' + '; '.join(why)))
        if not ok:
            raise Stop('stage %d load test FAILED at %.1f/min on top of %d rolled bots (nothing applied): %s' % (
                i, rate, len(self.bots(self.rolled_pools())), '; '.join(why)))

    def restart_all(self, bots):
        bad = []
        for b in bots:
            if not self.h.restart(b):
                bad.append(b)
            self.h.sleep(STAGGER_S)
        return bad

    def apply(self, i):
        s = self.st['stages'][i - 1]
        bots = self.bots(s['pools'])
        s['status'] = 'applying'; s['t_apply'] = iso(self.h.now()); self.save()     # BEFORE any write: rollback knows
        for b in bots:
            self.h.write_root(self.dropin(b), dropin_text(self.envfile))
        self.h.daemon_reload()
        self.journal('rollout-applying', 'stage %d: %s drop-ins on %d bots (%s); restarting 12 s apart' % (i, DROPIN, len(bots), ','.join(s['pools'])))
        failed = self.restart_all(bots)
        self.h.sleep(SETTLE_S)
        bad = ['%s:restart-failed' % b for b in failed]
        for b in bots:
            e = self.h.environ(b)
            if e is None:
                bad.append('%s:no-process' % b)
            elif env_missing(e, self.kvs):
                bad.append('%s:missing %s' % (b, ','.join(k.split('=')[0] for k in env_missing(e, self.kvs))))
        if bad:
            raise Stop('stage %d: env NOT proven on %d bot(s): %s' % (i, len(bad), ' '.join(bad[:8])), 'stage')
        s['status'] = 'applied'; s['t_apply'] = iso(self.h.now()); self.save()
        self.journal('rollout-stage-applied', 'stage %d: %s proven in the live environ of %d bots (%s); %d bots on %s' % (
            i, ' '.join(self.kvs), len(bots), ','.join(s['pools']), len(self.bots(self.rolled_pools())), self.model))
        self.h.rollout_add('%s-s%d' % (self.rid, i), self.st['fleet_sha'], s['t_apply'],
                           '%s stage %d: %s on %s (env only, drop-in %s; rollback = modelrollout.py rollback --stage %d)' % (
                               self.run, i, self.model, ','.join(s['pools']), DROPIN, i))

    def watch_and_read(self, i):
        s = self.st['stages'][i - 1]
        t0 = ts(s['t_apply'])
        d = self.write_ctx(i, s['t_apply'])
        blind = 0
        while (self.h.now() - t0).total_seconds() < READ_AT_MIN * 60:
            self.h.sleep(POLL_S)
            man = self.h.manifest()
            if man.get('declared_code_version') != self.st['fleet_sha'] or man.get('canary_pool'):
                raise Stop('stage %d: the fleet moved under the rollout (declared %s, canary %r): stopped, nothing rolled back' % (
                    i, str(man.get('declared_code_version'))[:8], man.get('canary_pool')))
            line = self.h.modelpoll(d)
            scope = poll_scope(line)
            self.journal('rollout-poll', 'stage %d: %s' % (i, line))
            if scope:
                raise Stop('stage %d stall poll: %s' % (i, line), scope)
            # ONLY AN EXPLICIT OK IS A WORKING GUARD (Codex r1): UNREADABLE, empty or garbage is a stall guard that is down
            blind = 0 if (line.split()[:2] == ['MODELPOLL', 'OK']) else blind + 1
            if blind == 1:
                self.page('error', 'ROLLOUT %s stage %d: the stall poll is not deciding (%s); rollback at %d in a row' % (self.run, i, line or 'EMPTY', POLL_BLIND_MAX))
            if blind >= POLL_BLIND_MAX:
                raise Stop('stage %d: the stall poll did not decide %d times in a row (last: %s)' % (i, blind, line or 'EMPTY'), 'stage')
        f = self.h.stage_read(d, READ_AT_MIN)
        ok, why = read_verdict(f)
        keep = {k: f.get(k) for k in ('lat_p50_ms', 'lat_p95_ms', 'model_share', 'schema_valid_canary', 'schema_gap_pp',
                                       'completion_p95', 'stall_bots', 'canary_post_rows', 'canary_bots', 'control_bots',
                                       'control_lat_p50_ms', 'decisions_bh_did', 'items_ratio_did')}
        self.journal('rollout-read', 'stage %d +%d: %s -> %s' % (i, READ_AT_MIN, json.dumps(keep), 'PASS' if ok else 'FAIL: ' + '; '.join(why)))
        if not ok:
            raise Stop('stage %d read +%d FAILED: %s' % (i, READ_AT_MIN, '; '.join(why)), 'stage')

    def ledger_check(self, i):
        s = self.st['stages'][i - 1]
        run, t0 = '%s-s%d' % (self.rid, i), ts(s['t_apply'])
        def found():
            for r in reversed(read_jsonl(P['journal'])):
                if r.get('run') == run and r.get('phase') == 'owner-direct-check' and r.get('of_ts') == s['t_apply']:
                    return r
            return None
        while found() is None and (self.h.now() - t0).total_seconds() < CHECK_BY_MIN * 60:
            self.h.sleep(60)
        r = found()
        if r is None:
            self.journal('rollout-check-run', 'stage %d: no cron check by +%d; running rollout.py check' % (i, CHECK_BY_MIN))
            self.h.rollout_check(run)
            r = found()
        v = (r or {}).get('verdict') or 'ERROR'
        act = check_action(v)
        self.journal('rollout-check', 'stage %d: rollout.py 60-min check %s -> %s :: %s' % (i, v, act, str((r or {}).get('note'))[:400]))
        if act == 'rollback':
            raise Stop('stage %d 60-min check %s: %s' % (i, v, str((r or {}).get('note'))[:300]), 'stage')
        if act == 'hold':
            raise Stop('stage %d 60-min check WATCH (stage kept, a human decides): %s' % (i, str((r or {}).get('note'))[:300]), None)

    # -- experiment mode
    def health(self, ctxdir, since, tripper=False, deaths=False):
        """The stop facts. Each probe is caught: an unreadable probe is recorded, never a pass for its own gate."""
        f = {'url': self.url, 'model': self.model, 'endpoint_ok': self.h.endpoint_ok(self.url)}
        now = self.h.now()
        for k, fn in (('stall', lambda: self.h.stall(ctxdir)),
                      ('crash_loops', lambda: self.h.crash_loops(now - dt.timedelta(minutes=60), now))):
            try:
                f[k] = fn()
            except Exception as x:
                f[k] = None; f.setdefault('unreadable', []).append('%s: %s: %s' % (k, type(x).__name__, str(x)[:120]))
                f.setdefault('unread_keys', []).append(k)
        if tripper:
            try:
                f['tripper'] = self.h.tripper()
            except Exception as x:
                f['tripper'] = {'verdict': 'UNREAD', 'why': str(x)[:120]}
            if f['tripper'].get('verdict') not in ('OK', 'TRIP'):
                f.setdefault('unreadable', []).append('tripper: %s' % f['tripper'].get('why'))
                f.setdefault('unread_keys', []).append('tripper')
        if deaths:
            b = self.st.get('death_baseline') or {}
            if b.get('rate') is None:          # recover the baseline; a gate without one is a probe that is down
                try:
                    rate, bh = self.h.baseline_7d(ts(self.st['started']))
                    b = self.st['death_baseline'] = {'rate': rate, 'bot_h': bh}; self.save()
                except Exception:
                    pass
            try:
                d, bh = self.h.deaths(max(ts(since), now - dt.timedelta(hours=DEATH_WINDOW_H)), now)
                f['death'] = death_trip(d, bh, b.get('rate'))
            except Exception as x:
                f['death'] = (False, 'deaths unreadable: %s: %s' % (type(x).__name__, str(x)[:120]))
                f.setdefault('unreadable', []).append(f['death'][1])
            if b.get('rate') is None or 'unreadable' in f['death'][1]:
                f.setdefault('unread_keys', []).append('death')
        return f

    def exp_stage_watch(self, i):
        s = self.st['stages'][i - 1]
        d = self.write_ctx(i, s['t_apply'])
        w = self.st.setdefault('stagewatch', {})
        for k, wait in enumerate(EXP_CHECK_S):
            self.h.sleep(wait)
            last = k == len(EXP_CHECK_S) - 1
            f = self.health(d, self.st['started'], tripper=last, deaths=True)
            why = exp_reasons(f, w)
            self.save()
            self.journal('rollout-health', 'stage %d check %d: %s' % (i, k + 1, json.dumps(f, default=str)[:900]))
            if f.get('unreadable'):
                self.page('error', 'ROLLOUT %s stage %d: health probe(s) unreadable: %s' % (self.run, i, '; '.join(f['unreadable'])))
            if why:
                raise Stop('stage %d health: %s' % (i, '; '.join(why)), 'all')

    def watch(self):
        """cron, every 5 min, for the 24 h after an experiment completed. Never wraps canary-sched.py."""
        if not self.load() or not self.st.get('experiment'):
            return 0
        status = self.st.get('status')
        live = self.bots(self.rolled_pools())
        if status not in ('complete', 'running') and not live:
            return 0                                       # ended, or never moved anything
        if not self.h.own_lock():
            self.say('another watch holds the lock'); return 0
        now = self.h.now()
        wp = os.path.join(P['home'], 'watch.json')
        try:
            w = json.load(open(wp))
            if not isinstance(w, dict):
                w = {}
        except (OSError, ValueError):
            w = {}                                         # a torn file must never block the rollback (Codex r1)
        def wsave():
            with contextlib.suppress(Exception):
                with open(wp + '.tmp', 'w') as fh:
                    json.dump(w, fh)
                os.replace(wp + '.tmp', wp)
        def end(why, compare):
            # ROLLBACK FIRST, UNCONDITIONALLY (owner 10-31 14:15Z: the Blackwell is for testing only); the comparison reads
            # the fixed window [completed, completed + 24 h] afterwards, and its failure changes nothing
            ok = self.rollback(list(range(1, len(self.st['stages']) + 1)))
            self.st['status'] = 'rolled-back' if ok else 'stopped'; self.st['stop'] = why; self.save()
            self.journal('rollout-ended', '%s :: rollback %s' % (why, 'PROVEN' if ok else 'INCOMPLETE'))
            if compare:
                cok, text = self.h.compare()                     # never raises
                self.journal('rollout-compare', ('OK' if cok else 'FAILED') + ' :: ' + text[-600:])
            msg = '%s: %s. Rollback to the baseline env %s.%s' % (self.run, why, 'PROVEN' if ok else 'INCOMPLETE -- fix by hand',
                                                                    (' Report: %s' % os.path.join(P['home'], 'compare-24h.md')) if compare else '')
            self.page('verdict', msg); self.h.notify('ROLLOUT ENDED', msg)
            return 0 if ok else 1
        # 0 a stopped experiment whose rollback was not proven: retry it every tick until it is
        if status not in ('complete', 'running'):
            return end('retrying an unproven rollback (status %s, %d bots still listed)' % (status, len(live)), False)
        # 0b a running experiment whose driver died: nothing reads its stages any more
        if status == 'running':
            pid = self.st.get('pid')
            alive = (bool(pid) and os.path.exists('/proc/%s' % pid)) if os.path.isdir('/proc') else self.h.pid_alive(pid)
            if not alive and now >= ts(self.st['started']) + dt.timedelta(hours=EXP_DRIVER_MAX_H):
                return end('the rollout driver (pid %s) is gone %d h after the start' % (pid, EXP_DRIVER_MAX_H), False)
            return 0
        t0 = ts(self.st['completed'])
        # 1 the hard deadline, FIRST: nothing may keep the fleet on the test endpoint past it
        if now >= t0 + dt.timedelta(hours=EXP_HARD_HOURS):
            return end('past the +%d h hard deadline' % EXP_HARD_HOURS, not w.get('compared'))
        if now >= t0 + dt.timedelta(hours=EXP_HOURS):
            w['compared'] = True; wsave()
            return end('+%d h: the experiment window is over (mandatory rollback)' % EXP_HOURS, True)
        # 2 the stops
        f = self.health(os.path.join(P['home'], 'stage-watch'), self.st['completed'],
                        tripper=now.minute % 15 < 5, deaths=now.minute % 30 < 5)
        why = exp_reasons(f, w)
        wsave()
        with open(os.path.join(P['home'], 'watch.jsonl'), 'a') as fh:
            fh.write(json.dumps({'ts': iso(now), 'facts': f, 'why': why}, default=str) + '\n')
        if f.get('unreadable'):
            self.page('error', 'ROLLOUT %s watch: probe(s) unreadable: %s' % (self.run, '; '.join(f['unreadable'])))
        if why:
            return end('STOP: ' + '; '.join(why), False)
        # 3 the hourly record (the last full hour, once)
        hr = now.replace(minute=0, second=0)
        key = iso(hr)
        if w.get('last_hour') != key and hr - dt.timedelta(hours=1) >= t0 - dt.timedelta(minutes=5):
            try:
                rec = dict(self.h.hourly(hr - dt.timedelta(hours=1), hr, self.model), hour=iso(hr - dt.timedelta(hours=1)))
            except Exception as x:
                rec = {'hour': iso(hr - dt.timedelta(hours=1)), 'error': '%s: %s' % (type(x).__name__, x)}
            with open(os.path.join(P['home'], 'hourly.jsonl'), 'a') as fh:
                fh.write(json.dumps(rec, default=str) + '\n')
            self.journal('rollout-hourly', json.dumps(rec, default=str)[:600])
            w['last_hour'] = key; wsave()
        return 0

    # -- rollback (three steps + proof)
    def rollback(self, idxs):
        bots, pools = [], []
        for i in idxs:
            s = self.st['stages'][i - 1]
            if s['status'] not in LIVE:
                continue
            bots += self.bots(s['pools']); pools += s['pools']
        if not bots:
            return True
        todo = [i for i in idxs if self.st['stages'][i - 1]['status'] in LIVE]
        # 2 the config FIRST, as unproven: a crash anywhere below leaves stages that rollback retries and that hold the slot
        for i in todo:
            self.st['stages'][i - 1]['status'] = 'rollback-unproven'
        self.save()
        bad = []
        try:
            for b in bots:                                               # 1 the drop-ins
                if self.h.exists(self.dropin(b)):
                    self.h.remove_root(self.dropin(b))
            self.h.daemon_reload()
            self.journal('rollout-rollback', 'stages %s: drop-ins removed on %d bots (%s); restarting 12 s apart' % (todo, len(bots), ','.join(pools)))
            failed = self.restart_all(bots)                              # 3 the restarts
            self.h.sleep(SETTLE_S)
            bad = ['%s:restart-failed' % b for b in failed]
            for b in bots:
                e = self.h.environ(b)
                if e is None:
                    bad.append('%s:no-process' % b)
                elif env_present(e, self.kvs):
                    bad.append('%s:%s' % (b, ','.join(k.split('=')[0] for k in env_present(e, self.kvs))))
                elif self.h.exists(self.dropin(b)):
                    bad.append('%s:drop-in-still-there' % b)
        except Exception as x:
            bad.append('rollback crashed: %s: %s' % (type(x).__name__, str(x)[:160]))
        if bad:
            self.journal('rollout-rollback-incomplete', 'stages %s left rollback-unproven: %s' % (todo, ' '.join(bad)))
            self.page('error', 'ROLLBACK INCOMPLETE %s (stages %s): model env not proven cleared on %s -- fix those units, then '
                      '`python3 %s rollback --all` (retries them); the slot stays held' % (self.run, todo, ' '.join(bad[:10]), os.path.abspath(__file__)))
            return False
        for i in todo:
            self.st['stages'][i - 1]['status'] = 'rolled-back'
        self.save()
        self.journal('rollout-rolled-back', 'stages %s: %s proven absent on %d bots' % (todo, ' '.join(self.kvs), len(bots)))
        return True

    def finish_stop(self, why, scope, cur):
        try:
            self._finish_stop(why, scope, cur)
        except BaseException as x:      # never exit silently with a stage applied and unread (Claude r1; SIGTERM too, Codex r2)
            with contextlib.suppress(Exception):
                self.st['status'] = 'stopped'; self.st['stop'] = why; self.save()
            with contextlib.suppress(Exception):
                self.journal('rollout-stop-failed', '%s :: the stop itself failed: %s: %s' % (why, type(x).__name__, x))
                self.page('error', 'ROLLOUT %s STOP FAILED (%s: %s) after: %s -- state %s; the slot stays held; run `python3 %s rollback --all`' % (
                    self.run, type(x).__name__, x, why, self.statep, os.path.abspath(__file__)))
            if not isinstance(x, Exception):
                raise

    def _finish_stop(self, why, scope, cur):
        self.journal('rollout-stopping', why)
        ok = True
        if scope == 'stage' and cur:
            ok = self.rollback([cur])
        elif scope == 'all':
            ok = self.rollback(list(range(1, len(self.st['stages']) + 1)))
        rolled = self.bots(self.rolled_pools())
        self.st['status'] = 'stopped'; self.st['stop'] = why; self.save()
        if not rolled and ok:
            self.h.hold_release(self.st['token'])
            self.journal('rollout-stopped', '%s :: nothing left rolled; install-hold released' % why)
            self.page('verdict', 'ROLLOUT STOPPED %s: %s. Nothing is left on %s; the slot is free.' % (self.run, why, self.model))
        else:
            self.journal('rollout-stopped', '%s :: %d bots still on %s (%s); install-hold KEPT' % (why, len(rolled), self.model, ','.join(self.rolled_pools())))
            self.page('verdict', 'ROLLOUT STOPPED %s: %s. %d bots stay on %s (%s); the canary slot stays HELD. Either '
                      '`python3 %s release` (the part-rolled fleet is the baseline) or `python3 %s rollback --all`.' % (
                          self.run, why, len(rolled), self.model, ','.join(self.rolled_pools()), os.path.abspath(__file__), os.path.abspath(__file__)))

    # -- run
    def go(self, resume=False):
        journal = read_jsonl(P['journal'])
        cp, stages, text = self.describe_plan(journal)
        self.say(text)
        if not cp:
            self.say('REFUSED: no canary pools found in the journal for %s' % self.run); return 2
        why, man = self.preflight(journal, resume)
        if resume:
            if not self.load() or self.st.get('status') != 'running':
                self.say('REFUSED: --resume needs a state file with status running (%s)' % self.statep); return 2
            why = [w for w in why if 'drop-ins already exist' not in w]
            self.exp = bool(self.st.get('experiment'))      # resume keeps the mode it started in (Codex r1)
            self.st['pid'] = os.getpid()
        if why:
            self.say('REFUSED:\n  ' + '\n  '.join(why)); return 2
        if self.dry:
            self.say('DRY RUN: preflight passed; would claim the install-hold (%d min), take %s, write %s and run the stages above.' % (
                HOLD_MIN, P['lock'], self.envfile)); return 0
        if resume:
            token = self.st['token']
            if self.h.hold_owner() != token:
                ok, out = self.h.hold_claim(token, HOLD_MIN)
                if not ok:
                    self.say('REFUSED: install-hold: ' + out); return 2
        else:
            token = '%s-%d-%d' % (self.rid, os.getpid(), time.time_ns())
            ok, out = self.h.hold_claim(token, HOLD_MIN)
            if not ok:
                self.say('REFUSED: install-hold not claimed: ' + out); return 2
            self.st = {'run': self.run, 'token': token, 'fleet_sha': man['declared_code_version'], 'model': self.model,
                       'url': self.url, 'started': iso(self.h.now()), 'status': 'running', 'experiment': self.exp,
                       'pid': os.getpid(),
                       'stages': [{'pools': s, 'status': 'pending'} for s in stages]}
            if self.exp:
                try:
                    rate, bh = self.h.baseline_7d(self.h.now())
                except Exception as x:
                    rate, bh = None, 0.0
                    self.say('7-day death baseline unreadable: %s' % x)
                self.st['death_baseline'] = {'rate': rate, 'bot_h': bh}
            self.save()
        if not self.h.take_lock():
            if not resume:
                self.h.hold_release(token); self.st['status'] = 'refused'; self.save()
            self.say('REFUSED: %s is held by another loop/installer' % P['lock']); return 2
        self.h.write_root(self.envfile, '\n'.join(self.kvs) + '\n')
        self.journal('rollout-start', '%s %s: %s; hold %s; env file %s' % ('resume' if resume else 'start', self.run, text.splitlines()[0], token, self.envfile))
        self.page('info', 'ROLLOUT %s %s started: %d stages; ~%.1f h' % (self.run, self.model, len(stages), sum(est_minutes(stages)) / 60))
        cur = None
        signal.signal(signal.SIGTERM, _sigterm)
        try:
            for i, s in enumerate(self.st['stages'], 1):
                if s['status'] == 'passed':
                    continue
                if s['status'] in ('rolled-back', 'rollback-unproven', 'applying'):
                    raise Stop('stage %d is %s: not resumable; `rollback --all`, then a new rollout' % (i, s['status']), None)
                cur = i
                os.makedirs(self.ctxdir(i), exist_ok=True)
                if s['status'] == 'pending':
                    if not self.exp:              # experiment: the load gates are data, not stops (owner 10-31)
                        self.busy_check(i)
                        self.load_test(i, len(self.bots(s['pools'])))
                    try:
                        self.apply(i)
                    except Stop as e:
                        raise Stop(str(e.args[0]), 'stage')
                    except Exception as e:
                        raise Stop('stage %d apply failed: %s: %s' % (i, type(e).__name__, e), 'stage')
                if self.exp:
                    self.exp_stage_watch(i)
                else:
                    self.watch_and_read(i)
                    self.ledger_check(i)
                s['status'] = 'passed'; self.save()
                self.journal('rollout-stage-passed', 'stage %d PASSED: %d bots on %s' % (i, len(self.bots(self.rolled_pools())), self.model))
                self.page('info', 'ROLLOUT %s stage %d of %d passed: %d bots on %s' % (self.run, i, len(self.st['stages']), len(self.bots(self.rolled_pools())), self.model))
        except Stop as e:
            scope = 'all' if self.exp else (e.args[1] if len(e.args) > 1 else None)    # experiment: every stop is ALL
            self.finish_stop(str(e.args[0]), scope, cur)
            if self.exp:
                self.h.notify('ROLLOUT STOPPED', '%s experiment stopped and rolled back: %s' % (self.run, e.args[0]))
            return 1
        except Exception as e:     # an unexpected crash: roll the CURRENT stage back (it was never read) and stop
            self.finish_stop('crash in stage %s: %s: %s' % (cur, type(e).__name__, e), 'all' if self.exp else 'stage', cur)
            return 1
        except BaseException as e:  # SIGTERM (a reboot, a kill) or ^C: no rollback here, but never silent
            with contextlib.suppress(Exception):
                self.journal('rollout-interrupted', 'stage %s: %s; state left %s' % (cur, type(e).__name__, self.st.get('status')))
                self.page('error', 'ROLLOUT %s INTERRUPTED at stage %s (%s): the slot stays held; `python3 %s run --resume` '
                          'or `python3 %s rollback --all`' % (self.run, cur, type(e).__name__, os.path.abspath(__file__), os.path.abspath(__file__)))
            raise
        self.st['status'] = 'complete'; self.st['completed'] = iso(self.h.now()); self.save()
        self.h.hold_release(self.st['token'])
        if self.exp:
            self.write_ctx('watch', self.st['completed'])
            self.journal('rollout-experiment', '%d bots on %s from %s; the watch (cron) holds the stops; MANDATORY rollback at +%d h (%s)' % (
                len(self.bots(self.rolled_pools())), self.model, self.st['completed'], EXP_HOURS,
                iso(ts(self.st['completed']) + dt.timedelta(hours=EXP_HOURS))))
            self.h.notify('ROLLOUT COMPLETE', '%s: %d bots on %s; rollback at +%d h' % (self.run, len(self.bots(self.rolled_pools())), self.model, EXP_HOURS))
        self.journal('rollout-complete', 'all %d stages passed: %d bots on %s via %s; install-hold released' % (
            len(self.st['stages']), len(self.bots(self.rolled_pools())), self.model, DROPIN))
        self.page('verdict', 'ROLLOUT %s COMPLETE: %d bots on %s; the slot is free. Update STATE.md.' % (self.run, len(self.bots(self.rolled_pools())), self.model))
        return 0


def cmd_read(ctxdir, M):
    mr = _modelread(ctxdir)
    f = mr.do_read(M)
    print('ROLLREAD ' + json.dumps(f, default=str))
    return 0


def main(argv=None, host=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    sub = ap.add_subparsers(dest='cmd', required=True)
    for c in ('plan', 'run', 'status', 'rollback', 'release', 'watch'):
        p = sub.add_parser(c)
        p.add_argument('--run', default='qwen35-01')
        if c in ('run', 'plan'):
            p.add_argument('--experiment', action='store_true', help='owner-directed: load gates are data; every stop rolls back ALL')
        if c == 'run':
            p.add_argument('--dry-run', action='store_true'); p.add_argument('--resume', action='store_true')
        if c == 'rollback':
            g = p.add_mutually_exclusive_group(required=True)
            g.add_argument('--all', action='store_true'); g.add_argument('--stage', type=int)
    p = sub.add_parser('_read'); p.add_argument('ctxdir'); p.add_argument('M', type=int)
    a = ap.parse_args(argv)
    if a.cmd == '_read':
        return cmd_read(a.ctxdir, a.M)
    h = host or Host()
    r = Rollout(h, a.run, dry=getattr(a, 'dry_run', False), experiment=getattr(a, 'experiment', False))
    if a.cmd == 'plan':
        print(r.describe_plan(read_jsonl(P['journal']))[2]); return 0
    if a.cmd == 'run':
        return r.go(resume=a.resume)
    if a.cmd == 'watch':
        return r.watch()
    st = r.load()
    if a.cmd == 'status':
        print(json.dumps(st, indent=1) if st else 'no rollout state at %s' % r.statep)
        print('%s drop-ins: %d; install-hold owner: %s' % (DROPIN, len(h.model_dropins()), h.hold_owner() or '-'))
        return 0
    if not st:
        print('no rollout state at %s' % r.statep); return 2
    if st.get('status') == 'complete' and st.get('experiment'):
        # after a completed experiment the slot is free and canaries run: the canary lock is theirs; take the watch's own
        if not h.own_lock():
            print('REFUSED: the watch is running (its lock is held); retry in a few minutes'); return 2
    elif not h.take_lock():
        print('REFUSED: %s is held (a running rollout, a canary loop or an installer)' % P['lock']); return 2
    if a.cmd == 'release':
        if st.get('status') != 'stopped':
            print('REFUSED: release is for a STOPPED rollout (status %s)' % st.get('status')); return 2
        if r.unproven():
            print('REFUSED: stages %s are applying/rollback-unproven (their env is unknown): `rollback --all` first' % r.unproven()); return 2
        print(h.hold_release(st['token']))
        r.journal('rollout-released', 'operator: the part-rolled fleet is the baseline (%s on %s)' % (r.model, ','.join(r.rolled_pools())))
        return 0
    if a.cmd == 'rollback':
        idx = list(range(1, len(st['stages']) + 1)) if a.all else [a.stage]
        if not all(1 <= i <= len(st['stages']) for i in idx):
            print('REFUSED: stage must be 1..%d' % len(st['stages'])); return 2
        ok = r.rollback(idx)
        if ok and not r.bots(r.rolled_pools()):
            st['status'] = 'rolled-back'; r.save()
            print(h.hold_release(st['token']))
            r.journal('rollout-released', 'rollback %s complete: nothing left on %s; install-hold released' % (idx, r.model))
        print('rollback %s: %s' % (idx, 'proven' if ok else 'INCOMPLETE (see the page)'))
        return 0 if ok else 1
    return 2


if __name__ == '__main__':
    sys.exit(main())
