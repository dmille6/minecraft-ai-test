#!/usr/bin/env python3
# oretunnelread.py [window_min] -- the read for canary `oretunnel-01` (branch ore-tunnel).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: gather escalates a buried IRON target to a planned staircase tunnel to ore the bot already sees (anti-xray
# is off on every world), under hazard masks (liquid / falling / lava-corridor / home), with a pickaxe budget whose
# refusal adopts "craft a stone_pickaxe" as the task (owner: pickaxe first). Baseline, 5.6 h to 2026-09-29 05:40Z on 80
# bots: 483 gather rows mention iron, 474 failed, 2 succeeded; held iron fell 14 -> 2 fleet-wide (banked/smelted), so
# HELD STOCK IS THE WRONG INSTRUMENT -- this read counts iron COLLECTED from gather's own outcome rows.
#
# A CAPABILITY change, not a fix: the outcome is the primary line.
#   LIVENESS     canary `_ore_tunnel` rows by the CANARY build (>= 1); control 0 (the baseline has no such kind).
#   OUTCOME      iron ore collected (gather success, "collected N iron_ore|deepslate_iron_ore") per bot-hour, DiD vs the
#                same-length pre-window. Gate: canary collected >= 1 (the tunnel yields iron on the fleet) -- BLOCKS KEEP.
#   HARM         deaths within 120 s after an `_ore_tunnel` row (canary; REVERT at >= 2 -- the two-death floor, applied
#                to the deaths this change can cause); repeated pickaxe_short on one bot (a loop the chain test forbids;
#                REVERT at a bot with >= 6 in the window -- the prereq should have fixed it by then).
#   INSTRUMENT   positive control: control gather rows that mention iron >= 1 (the population query sees a presence).
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events

man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc)
elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)
COLLECTED = re.compile(r'collected (\d+) (?:deepslate_)?iron_ore\b')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def load(since_minutes):
    """Rotation-aware and deduped, as deathfixread: day D's rows live in -{D+1}.gz."""
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
    rows, seen = [], set()
    for r in ev.rows:
        if key(r) not in seen:
            rows.append(r); seen.add(key(r))
    start = now - dt.timedelta(minutes=since_minutes)
    for d in {(start + dt.timedelta(days=k)).date() for k in range(0, (now - start).days + 2)}:
        for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % (d + dt.timedelta(days=1)).strftime('%Y%m%d')):
            try:
                e2 = Events.load(paths=g, since_minutes=since_minutes, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since_minutes=since_minutes)
            for r in e2.rows:
                if key(r) not in seen:
                    rows.append(r); seen.add(key(r))
    return rows


# POSITIVE CONTROL for the parser: the sandbox's own rows.
assert COLLECTED.search('collected 3 iron_ore').group(1) == '3'
assert COLLECTED.search('collected 2 iron_ore (none left within 32)').group(1) == '2'
assert COLLECTED.search('collected 1 deepslate_iron_ore').group(1) == '1'
assert not COLLECTED.search('collected 3 iron_ore_block_x') and not COLLECTED.search('collected 5 cobblestone')

rows = load(int(elapsed + W + 60))
rows.sort(key=lambda r: r['t'])
bots_seen = {(r.get('bot') or {}).get('name') for r in rows if r.get('bot')}
print('rows walked %d  bots %d  |  canary %s  sha %s  cutoff %s  window +%d min'
      % (len(rows), len(bots_seen), CAN, CV, CUT.strftime('%H:%MZ'), W))

tunnels = Counter(); tunnel_ok = Counter(); offbuild = 0
collected = defaultdict(Counter)                  # [period][arm] ore collected
iron_rows = defaultdict(Counter)                  # [period][arm] gather rows mentioning iron
botsets = defaultdict(lambda: defaultdict(set))
last_tunnel = {}                                  # bot -> t of its last _ore_tunnel row
tunnel_deaths = Counter(); short_by_bot = Counter()
for r in rows:
    t = r.get('t'); name = (r.get('bot') or {}).get('name')
    if t is None or not name or not (PRE <= t < END):
        continue
    arm = 'canary' if pool_of(name) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(name)
    k, d = r.get('name'), (r.get('detail') or '')
    if k == '_ore_tunnel' and period == 'post':
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and CV and not ver.startswith(CV):
            offbuild += 1
            continue
        tunnels[arm] += 1
        if r.get('status') == 'success':
            tunnel_ok[arm] += 1
        if 'pickaxe_short' in d:
            short_by_bot[name] += 1
        last_tunnel[name] = t
    if k == 'gather' and 'iron' in d:
        iron_rows[period][arm] += 1
        m = COLLECTED.search(d)
        if m and r.get('status') == 'success':
            collected[period][arm] += int(m.group(1))
    if k == '_death' and period == 'post' and name in last_tunnel and (t - last_tunnel[name]).total_seconds() <= 120:
        tunnel_deaths[arm] += 1


def per_bh(c, period, arm):
    n = len(botsets[period][arm])
    return c[period][arm] / (n * W / 60) if n else float('nan')


v = {(p, a): per_bh(collected, p, a) for p in ('pre', 'post') for a in ('canary', 'control')}
did = (v[('post', 'canary')] - v[('pre', 'canary')]) - (v[('post', 'control')] - v[('pre', 'control')])
worst_short = max(short_by_bot.values(), default=0)
print('-' * 78)
print('%-46s %10s %10s' % ('', 'canary', 'control'))
print('%-46s %10d %10d' % ('_ore_tunnel rows (LIVENESS; control must be 0)', tunnels['canary'], tunnels['control']))
print('%-46s %10d %10d' % ('  ... reached the ore', tunnel_ok['canary'], tunnel_ok['control']))
print('%-46s %10d %10d' % ('iron ore collected (post)', collected['post']['canary'], collected['post']['control']))
print('%-46s %10d %10d' % ('gather rows mentioning iron (post)', iron_rows['post']['canary'], iron_rows['post']['control']))
print('%-46s %10d %10d' % ('deaths <= 120 s after a tunnel', tunnel_deaths['canary'], tunnel_deaths['control']))
print('canary-pool rows from another build %d;  most pickaxe_short refusals on one bot %d' % (offbuild, worst_short))
print('iron collected /bot-h  canary %.3f -> %.3f | control %.3f -> %.3f | DiD %+.3f'
      % (v[('pre', 'canary')], v[('post', 'canary')], v[('pre', 'control')], v[('post', 'control')], did))
print('-' * 78)
print('LIVENESS     canary tunnels %d (>= 1) | control %d (must be 0)' % (tunnels['canary'], tunnels['control']))
print('OUTCOME      canary iron collected %d (>= 1 to KEEP)' % collected['post']['canary'])
print('HARM         tunnel-linked deaths %d (REVERT at 2); worst pickaxe_short loop %d (REVERT at 6)' % (tunnel_deaths['canary'], worst_short))
print('INSTRUMENT   control iron gather rows %d (must be >= 1)' % iron_rows['post']['control'])

try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('oretunnelread', W, {
        'tunnels_canary': tunnels['canary'], 'tunnels_control': tunnels['control'], 'reached_canary': tunnel_ok['canary'],
        'collected_canary': collected['post']['canary'], 'collected_control': collected['post']['control'],
        'collected_did_per_bh': round(did, 4),
        'tunnel_deaths_canary': tunnel_deaths['canary'], 'worst_short_loop_canary': worst_short,
        'iron_rows_control': iron_rows['post']['control'], 'offbuild_canary': offbuild,
        'exposure_ready': int(tunnels['canary'] >= 3 and iron_rows['post']['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
