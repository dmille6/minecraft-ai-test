# immobiledid.py [post-min] -- recovery-ladder-01 read. PRIMARY: immobile bot-minutes share (a bot-minute is immobile
# when the bot's horizontal displacement over the trailing 60 min is < 6 blocks), ratio-DiD canary vs the 75, pre 180.
# Exposure: livelock_escape rows, entombed+marooned rows, bots immobile >= 30 min. Corroborating: livelock_escape success
# share. Guards: gather/explore runs per bot-h, climb firings per bot-h, blocks spent. Placebo per control pool.
# No canary declared: CANARY_DRYRUN=pool:sha:iso. Also prints the per-pool exposure table for the draw when POOLS=1.
import sys, json, os, re, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
from collections import defaultdict, Counter
from lib.telemetry import Events
man = json.load(open('/srv/mcbots/trial-manifest.json')); ovr = os.environ.get('CANARY_DRYRUN')
if ovr: CAN, CV, ISO = ovr.split(':', 2); CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else: CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}   # one pool or a comma-separated list (two pools of five, 2026-09-13)
now = dt.datetime.now(dt.timezone.utc); elapsed = (now - CUT).total_seconds() / 60
PRE = 180; W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180) if elapsed > 0 else 0
if not CAN: CAN = '__none__'; CUT = now; W = 0

# ROTATION-AWARE LOAD (2026-09-15 00:00 UTC: logrotate copytruncated the live files at midnight and the -07 reads lost
# their pre-period). The live files plus the rotated .gz generations whose date tag falls inside the window -- one
# narrow glob per date so the loader's size cap is judged per generation, never over 14 days of history.
def load_window(since_minutes):
    import glob as _g, datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc); start = now - _dt.timedelta(minutes=since_minutes)
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    d = start.date()
    while d <= now.date():
        tag = (d + _dt.timedelta(days=1)).strftime('%Y%m%d')   # the rows of day d rotate into skill-<bot>.jsonl-<d+1>.gz
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz', since_minutes=since_minutes).rows)
        d += _dt.timedelta(days=1)
    # A NORMALISED ROW HAS NO '@timestamp'. telemetry.py builds rows as
    # {'t','name','detail','fail_class','status','bot','raw'}, so this key was absent on
    # every row and sorted every one of them under '' -- a stable no-op that read as a
    # sort. Measured by the field audit: read 20,712 times, present 0 times.
    #
    # It was harmless, and the reason is worth keeping: the sequence-dependent work is
    # done per bot after an explicit `rs.sort(key=lambda r: r['t'])`, and everything here
    # is counters and min/max, which do not care about order. Fixed because a no-op that
    # looks like a sort is a trap for whoever next writes order-dependent code above it.
    ev.rows.sort(key=lambda r: r['t'])
    return ev

ev = load_window(int(max(elapsed, 0) + PRE) + 80)   # +60 for the trailing window
by = defaultdict(list)
for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated') or b.startswith('self-'): continue
    by[b].append(r)
K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)
imm = Counter(); mins = Counter(); ll = Counter(); llok = Counter(); climbs = Counter(); gath = Counter(); expl = Counter(); deaths = Counter(); exh = []; spent = []
pimm = Counter(); pmins = Counter(); pll = Counter(); pclimb = Counter(); pimmbots = defaultdict(set)
bots = defaultdict(set); pool = {}; posby = {}; invby = {}
for b, rs in by.items():
    rs.sort(key=lambda r: r['t']); p = b.rsplit('-', 1)[0]; pool[b] = p
    pos = [(r['t'], r['bot'].get('pos')) for r in rs if (r['bot'].get('pos') or {}).get('x') is not None]; posby[b] = pos; invby[b] = [(r['t'], sum((r['bot'].get('inventory') or {}).values())) for r in rs if r['bot'].get('inventory') is not None]
    # minute grid over [CUT-PRE, CUT+W]
    t0 = CUT - dt.timedelta(minutes=PRE); t1 = CUT + dt.timedelta(minutes=W); i = 0; j = 0; immrun = 0
    m = t0
    while m < t1 and pos:
        while j < len(pos) and pos[j][0] <= m: j += 1
        cur = pos[j - 1][1] if j > 0 else None
        back = m - dt.timedelta(minutes=60)
        while i < len(pos) and pos[i][0] < back: i += 1
        window = [q for _, q in pos[i:j]]
        if cur and window:
            far = max(((q['x'] - cur['x']) ** 2 + (q['z'] - cur['z']) ** 2) ** 0.5 for q in window)
            era = 'post' if m >= CUT else 'pre'; k = K(b, era); mins[k] += 1; pmins[(p, era)] += 1; bots[k].add(b)
            if far < 6:
                imm[k] += 1; pimm[(p, era)] += 1; immrun += 1
                if immrun >= 30: pimmbots[(p, era)].add(b)
            else: immrun = 0
        m += dt.timedelta(minutes=1)
    for r in rs:
        d = (r['t'] - CUT).total_seconds() / 60
        if d < -PRE or d > W: continue
        era = 'post' if d >= 0 else 'pre'; k = K(b, era); n = str(r['name']); det = r.get('detail') or ''; st = (r['raw'].get('skill') or {}).get('status')
        if n == '_livelock_escape':
            ll[k] += 1; pll[(p, era)] += 1; llok[k] += (st == 'success')
            mm = re.search(r'blocks spent (\d+)', det)
            if mm and k[0] == 'canary' and era == 'post': spent.append(int(mm.group(1)))
        if n in ('_entombed', '_marooned'): climbs[k] += 1; pclimb[(p, era)] += 1
        if n == 'gather': gath[k] += 1
        if n == 'explore': expl[k] += 1
        if n == '_death': deaths[k] += 1
        if n == '_recovery_exhausted' and k[0] == 'canary' and era == 'post': exh.append((r['t'].strftime('%H:%M'), b, det[:120], r['t']))   # POST only (a pre-cutoff row inflated -06's +90 read)
if os.environ.get('POOLS'):
    print("per-pool exposure, pre window (draw rule: >= 8 livelock_escape OR >= 20 entombed+marooned, AND >= 1 bot immobile >= 30 min):")
    for p in sorted({pool[b] for b in pool}):
        e = pll[(p, 'pre')] >= 8 or pclimb[(p, 'pre')] >= 20; i = len(pimmbots[(p, 'pre')]) >= 1
        print(f"  {p:12s} livelock {pll[(p, 'pre')]:3d} climbs {pclimb[(p, 'pre')]:3d} immobile>=30m {len(pimmbots[(p, 'pre')])} immobile-share {pimm[(p, 'pre')] / pmins[(p, 'pre')] * 100 if pmins[(p, 'pre')] else float('nan'):4.0f}% {'ELIGIBLE' if e and i else ''}")
    print("positive control: rows", len(ev.rows), "bots", len(pool)); sys.exit(0)
print(f"canary_pool={CAN} canary={CV} cutoff={CUT.strftime('%H:%M:%S')} elapsed={elapsed:.0f} min, pre {PRE} / post {W:.0f}; immobile = 60-min displacement < 6 blocks")
print(f"{'arm/era':14s}{'bots':>5}{'bot-h':>7}{'immob%':>8}{'livelock':>9}{'ok%':>5}{'climbs':>7}{'/bh':>6}{'gather/bh':>10}{'explore/bh':>11}{'deaths':>7}")
R = {}
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = mins[k] / 60
        R[k] = dict(imm=imm[k] / mins[k] if mins[k] else float('nan'), ok=llok[k] / ll[k] if ll[k] else float('nan'), cl=climbs[k] / h if h else float('nan'), g=gath[k] / h if h else float('nan'), e=expl[k] / h if h else float('nan'))
        print(f"{arm + '/' + era:14s}{len(bots[k]):>5}{h:>7.1f}{R[k]['imm'] * 100:>7.1f}%{ll[k]:>9}{R[k]['ok'] * 100:>5.0f}{climbs[k]:>7}{R[k]['cl']:>6.1f}{R[k]['g']:>10.1f}{R[k]['e']:>11.1f}{deaths[k]:>7}")
def rdid(f):
    try: return (R[('canary', 'post')][f] / R[('canary', 'pre')][f]) / (R[('control', 'post')][f] / R[('control', 'pre')][f]) - 1
    except ZeroDivisionError: return float('nan')
ci, ki = R[('canary', 'pre')]['imm'], R[('canary', 'post')]['imm']; cc, kc = R[('control', 'pre')]['imm'], R[('control', 'post')]['imm']
print(f"\nPRIMARY immobile share (pp): canary {ci * 100:.1f}% -> {ki * 100:.1f}% ({(ki - ci) * 100:+.1f} pp; KEEP needs <= -10 pp with a pre share >= 15%)   control {cc * 100:.1f}% -> {kc * 100:.1f}% ({(kc - cc) * 100:+.1f} pp; must stay within 3 pp)   [ratio-DiD {rdid('imm'):+.0%}, descriptive]")
# per-bot: who was immobile >= 30 min at the cutoff, and were they freed (displaced by the postcondition, then not immobile again for 30 min)?
ladder_rows = lambda rs, t: [(r['t'].strftime('%H:%M'), str(r['name']), (r.get('detail') or '')[:60]) for r in rs if t - dt.timedelta(minutes=10) <= r['t'] <= t and (
    (str(r['name']) == '_livelock_escape' and '(dig' in (r.get('detail') or '') and (r['raw'].get('skill') or {}).get('status') == 'success') or
    str(r['name']) in ('_entombed', '_marooned', '_entombed_ramp_cut', '_marooned_ramp_cut') or
    (str(r['name']) == 'surface' and re.search(r'climbed (\d+)', r.get('detail') or '') and int(re.search(r'climbed (\d+)', r.get('detail') or '').group(1)) >= 4))]
tally = {'canary': [0, 0], 'control': [0, 0]}   # [trapped at cutoff, freed]
for b in sorted(pool):
    arm = 'canary' if pool[b] in CANS else 'control'
    rs = by[b]; pos = [(r['t'], r['bot'].get('pos')) for r in rs if (r['bot'].get('pos') or {}).get('x') is not None]
    at = [q for t, q in pos if t <= CUT][-1:] if pos else []
    if not at: continue
    back = [q for t, q in pos if CUT - dt.timedelta(minutes=30) <= t <= CUT]
    far0 = max((((q['x'] - at[0]['x']) ** 2 + (q['z'] - at[0]['z']) ** 2) ** 0.5 for q in back), default=99)
    if far0 >= 6 or len(back) < 5: continue
    freed = None
    for t, q in pos:
        if t <= CUT: continue
        if ((q['x'] - at[0]['x']) ** 2 + (q['z'] - at[0]['z']) ** 2) ** 0.5 >= 8 or (q['y'] - at[0]['y'] >= 4):
            later = [w for u, w in pos if t < u <= t + dt.timedelta(minutes=30)]
            held = later and max(((w['x'] - q['x']) ** 2 + (w['z'] - q['z']) ** 2) ** 0.5 for w in later) >= 6
            freed = (t.strftime('%H:%M'), q, 'held' if held else 're-trapped', ladder_rows(rs, t)); break
    tally[arm][0] += 1; tally[arm][1] += bool(freed and freed[2] == 'held')
    tag = 'TRAPPED AT DEPLOY' if arm == 'canary' else 'control trapped'
    print(f"  {tag} {b} at {round(at[0]['x'])},{round(at[0]['y'])},{round(at[0]['z'])}: " + (f"FREED {freed[0]} -> {({k: round(v) for k, v in freed[1].items()})} ({freed[2]}; ladder rows within 10 min: {freed[3] if freed[3] else 'NONE -> spontaneous'})" if freed else 'still immobile'))
print(f"FREED SHARE: canary {tally['canary'][1]}/{tally['canary'][0]} vs control (spontaneous base rate) {tally['control'][1]}/{tally['control'][0]} -- KEEP needs a canary freed bot WITH a ladder row, and the canary share above the control's")
print(f"corroborating livelock success share canary {R[('canary', 'pre')]['ok'] * 100:.0f}% -> {R[('canary', 'post')]['ok'] * 100:.0f}% (control {R[('control', 'pre')]['ok'] * 100:.0f}% -> {R[('control', 'post')]['ok'] * 100:.0f}%)")
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = mins[k] / 60; R[k]['llbh'] = ll[k] / h if h else float('nan')
p90 = sorted(spent)[int(len(spent) * 0.9)] if spent else 0
# RULE v10 guard 6 (prospective): an exhausted row counts only when the bot is STILL immobile 30 min later (-03: 9 rows, 0 immobile)
def still_immobile(b, t):
    # STUCK = no displacement AND no inventory progress in the next 30 min. Displacement alone reads a bot mining or
    # gathering in place as immobile (-03: 4-5 of the exhausted rows by displacement, all of them working in place).
    ps = [q for tt, q in posby.get(b, []) if t <= tt <= t + dt.timedelta(minutes=30)]
    iv = [n for tt, n in invby.get(b, []) if t <= tt <= t + dt.timedelta(minutes=30)]
    if len(ps) < 2: return True
    x0, z0 = ps[0]['x'], ps[0]['z']; far = max(((q['x'] - x0) ** 2 + (q['z'] - z0) ** 2) ** 0.5 for q in ps)
    gained = (max(iv) - iv[0]) if len(iv) >= 2 else 0
    return far < 6 and gained <= 0
exh_still = [e for e in exh if still_immobile(e[1], e[3])]
# ---- v15b MOVEMENT GUARDS (guardcal.py 2026-09-15, 200 pseudo-canaries): blocks moved/bh (-30%: 1% false trips),
# working share = minutes carrying a skill row that is not status/underscore (-20%: ~0%), immobile share DiD > +10 pp
# AND >= 2 distinct newly-immobile canary bots, items gathered/bh on gathering rows only (-50%: 4%). The v6 call counts
# (gather/bh, explore/bh) reverted -08c and -08d while the bots gathered and deposited more: they are REPORT lines now.
mv = Counter(); wk = Counter(); itg = Counter(); GATHERISH = ('gather', 'mine', 'collect', 'harvest')
for b in pool:
    arm = 'canary' if pool[b] in CANS else 'control'; last = {}; wmin = {'pre': set(), 'post': set()}
    for r in by[b]:
        d = (r['t'] - CUT).total_seconds() / 60
        if d < -PRE or d > W: continue
        era = 'post' if d >= 0 else 'pre'; k = (arm, era); n = str(r['name']); q = r['bot'].get('pos')
        if q and q.get('x') is not None:
            if era in last: mv[k] += min(20, ((q['x'] - last[era]['x']) ** 2 + (q['z'] - last[era]['z']) ** 2) ** 0.5)
            last[era] = q
        if not n.startswith('_') and n != 'status': wmin[era].add(int(d // 1))
        if n in GATHERISH: itg[k] += sum(v for v in ((r['raw'].get('skill') or {}).get('inventory_delta') or {}).values() if v > 0)
    for era in ('pre', 'post'): wk[(arm, era)] += len(wmin[era])
for k in list(R):
    h = mins[k] / 60; R[k]['mv'] = mv[k] / h if h else float('nan'); R[k]['wk'] = wk[k] / mins[k] if mins[k] else float('nan'); R[k]['it'] = itg[k] / h if h else float('nan')
newly = set().union(*(pimmbots[(p, 'post')] - pimmbots[(p, 'pre')] for p in CANS)) if CANS else set()
imm_pp = ((ki - ci) - (kc - cc)) * 100
v15 = [('blocks moved/bh', rdid('mv'), -0.30), ('working share', rdid('wk'), -0.20), ('items gathered/bh', rdid('it'), -0.50)]
breach = [nm for nm, v, lim in v15 if v == v and v < lim] + (['immobile'] if imm_pp > 10 and len(newly) >= 2 else [])
severe = [nm for nm, v, lim in zip(['blocks moved/bh', 'working share', 'items gathered/bh'], [rdid('mv'), rdid('wk'), rdid('it')], [-0.50, -0.40, -0.70]) if v == v and v < lim] + (['immobile'] if imm_pp > 20 and len(newly) >= 3 else [])
# UNDEFINED IS NOT WITHIN LIMITS (2026-09-23). The breach tests are written `if v == v and
# v < lim`, and `v == v` is the NaN check -- so a guard that could not be computed is SKIPPED,
# an empty breach list becomes the string 'all within', and verdict.py trusts that string. A
# guard that cannot be computed cannot fail, which is the definition of a false clean.
#
# rdid() divides canary post/pre by control post/pre, so any cell with zero exposure makes it
# NaN -- and `readable` only checks the canary POST cell, so a canary declared right after a
# fleet restart can be readable with all three guards undefined.
#
# CALIBRATED BEFORE CHANGING ANYTHING: 37 immobiledid evidence objects on disk, ZERO with an
# undefined guard (32 'all within', 5 WATCH, 0 REVERT). So this hole is reachable by
# construction and has NOT been observed to fire. It is fixed because it is latent, not
# because it has cost anything yet -- and the distinction is worth keeping in the record.
#
# All three undefined -> UNREADABLE, because none of the calibrated decision is available.
# One or two -> still decided on what IS defined, but named, so it can never read as a clean
# pass; blocking on a technicality when two calibrated guards are live would stop progress
# for no gain.
_undef = [nm for nm, v, lim in v15 if v != v]
if len(_undef) == len(v15):
    verdict = ('UNREADABLE (v15c: all of ' + ', '.join(_undef) + ' are undefined -- a guard '
               'that cannot be computed cannot fail, so this is not "all within")')
else:
    verdict = 'REVERT (two or more breaches)' if len(breach) >= 2 else ('REVERT (severe: ' + ', '.join(severe) + ')' if severe else ('WATCH: ' + ', '.join(breach) if breach else ('WATCH: undefined guard(s) ' + ', '.join(_undef) + '; the rest are within limits' if _undef else 'all within')))
print(f"GUARDS (v15c): blocks moved/bh {rdid('mv'):+.0%} (>= -30%);  working share {rdid('wk'):+.0%} (>= -20%);  immobile {imm_pp:+.1f} pp DiD with {len(newly)} newly-immobile canary bot(s) (> +10 pp AND >= 2);  items gathered/bh {rdid('it'):+.0%} (>= -50%)  ->  {verdict}  [one breach = WATCH; two, or one severe (-50/-40/-70/+20pp&3) = REVERT; a gathering-only loss of a third is judged on the fleet reads, not here];  REPORT: gather calls {rdid('g'):+.0%}, explore calls {rdid('e'):+.0%}")
print(f"GUARDS (v6): gather/bh {rdid('g'):+.0%}  explore/bh {rdid('e'):+.0%} (each within 30%);  climb firings/bh {rdid('cl'):+.0%} (<= +100%);  livelock rows/bh {rdid('llbh'):+.0%} (<= +100%);  blocks spent per ladder p90 {p90} (<= 32) over {len(spent)} ladders;  recovery_exhausted {len({e[1] for e in exh_still})} distinct bots still stuck 30 min after ({len(exh_still)} of {len(exh)} rows) (v10 guard 6: distinct bots <= trapped-at-deploy + 1)")
print(f"READABILITY: canary post livelock rows {ll[('canary', 'post')]} (>= 8) or climb firings {climbs[('canary', 'post')]} (>= 20); bot-h {mins[('canary', 'post')] / 60:.1f} (>= 15)")
cd = deaths[('canary', 'post')] / (mins[('canary', 'post')] / 60) if mins[('canary', 'post')] else float('nan'); kd = deaths[('control', 'post')] / (mins[('control', 'post')] / 60) if mins[('control', 'post')] else float('nan')
# RULE v9 (2026-09-13): a MECHANISM-LINKED canary death reverts at once; every death is reported with its mechanism.
# RULE v10 (prospective, 2026-09-13 21:20 UTC): linkage means a rung that MOVED the body in the 600 s before the death.
# Refusals (maroon_climb_refused, maroon_dig_refused, marooned_needs_pickaxe, maroon_pillar_declined) and terminal states
# (maroon_climb_exhausted, recovery_exhausted) move nothing and are reported, not linked. -03 was reverted on a refusal row.
MECH = set(['entombed', 'marooned', 'maroon_wall', 'entombed_ramp_cut', 'marooned_ramp_cut', 'livelock_escape', 'pillar_no_gain', 'stuck', 'unstick_oscillation'])   # v12: danger_block is the RESPONSE to lava, never a link

for b, rs in by.items():
    if b.rsplit('-', 1)[0] not in CANS: continue
    for r in rs:
        if str(r['name']) == '_death' and r['t'] >= CUT:
            # RULE v11: a rung within 60 s before the death AND no skill row (non-underscore kind) between it and the death.
            win = [q for q in rs if r['t'] - dt.timedelta(seconds=60) <= q['t'] < r['t']]
            linked = []
            for q in win:
                k = str(q['name'])
                if k.lstrip('_') in MECH and not any(not str(z['name']).startswith('_') for z in win if q['t'] < z['t'] < r['t']): linked.append(k.lstrip('_'))
            linked = sorted(set(linked))
            print(f"  CANARY DEATH {b} {r['t'].strftime('%H:%M:%S')} mechanism-linked={'YES -> REVERT' if linked else 'no'} rung-in-60s-and-no-skill-since={linked or 'none'} :: {(r.get('detail') or '')[:90]}")
print(f"HARM (v11: deaths are reported; only a rung-linked death reverts): canary deaths {deaths[('canary','post')]} ({deaths[('canary','post')]/max(0.01,mins[('canary','post')]/60):.3f}/bh) vs control {deaths[('control','post')]/max(0.01,mins[('control','post')]/60):.3f}/bh")
print("recovery_exhausted (canary post):", exh if exh else 'none')
pl = {}
for p in sorted({pool[b] for b in pool}):
    if p in CANS: continue
    try:
        oth = {era: sum(pimm[(q, era)] for q in {pool[b] for b in pool} if q not in (p, CAN)) / sum(pmins[(q, era)] for q in {pool[b] for b in pool} if q not in (p, CAN)) for era in ('pre', 'post')}
        own = {era: pimm[(p, era)] / pmins[(p, era)] for era in ('pre', 'post')}
        pl[p] = (own['post'] / own['pre']) / (oth['post'] / oth['pre']) - 1
    except ZeroDivisionError: pl[p] = float('nan')
canv = rdid('imm'); ok = all(canv < v for v in pl.values() if v == v)
print("PLACEBO (immobile-share ratio-DiD per control pool; KEEP needs the canary LOWER than every one): " + ", ".join(f"{p} {v:+.0%}" for p, v in sorted(pl.items(), key=lambda x: x[1])) + f" -> canary {canv:+.0%} {'PASS' if ok else 'FAIL'}")
print("positive control: rows", len(ev.rows), "bots", sum(len(v) for v in bots.values()))
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('immobiledid', W, {
        'readable': bool(mins[('canary', 'post')] / 60 >= 15 and (ll[('canary', 'post')] >= 8 or climbs[('canary', 'post')] >= 20)),
        'canary_bot_h': mins[('canary', 'post')] / 60, 'control_bot_h': mins[('control', 'post')] / 60,
        'harm': {'canary_deaths': deaths[('canary', 'post')], 'control_deaths': deaths[('control', 'post')], 'canary_rate': cd, 'control_rate': kd},
        'v15c': {'moved': rdid('mv'), 'work': rdid('wk'), 'imm_pp': imm_pp / 100, 'newly_immobile': len(newly), 'items': rdid('it'), 'breach': breach, 'severe': severe, 'verdict': verdict},
        'v11': {'gather': rdid('g'), 'explore': rdid('e'), 'climbs': rdid('cl'), 'livelock': rdid('llbh'), 'ladders_p90': p90, 'exhausted_distinct': len({e[1] for e in exh_still})},
        'immobile': {'canary_pre': ci, 'canary_post': ki, 'control_pre': cc, 'control_post': kc},
        'placebo_ok': bool(ok), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
