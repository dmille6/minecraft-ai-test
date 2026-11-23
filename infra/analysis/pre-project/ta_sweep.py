# 3-time-accounting, step 3: per-bot priority sweep. Every second of a bot's span (first row .. last row) gets exactly
# ONE class; overlapping intervals are resolved by PRIORITY (first listed wins), so nothing is counted twice.
# Output: ~/mcai/parquet/ta3x/botday.parquet  (world, bot, pool, day, class seconds..., asserted to sum to the span).
#
# Interval sources (see ta_extract.py):
#   real skill rows  [t, t+d]  stamped at START by logSkill (verified: ta_controls.py); class from ta_extract cls
#   model calls      [t, t+lat] stamped at start of the call -> llm_wait (only where no skill is running)
#   pausewait        [t, t+N]  runner failure pause -> paused
#   _death           [t, next row]  -> dead
#   between          [t_llm-45, t_llm] uncovered decision cooldown/tick wait
#   gaps             consecutive-row gaps (either stream) > 600 s: offline if < 6 h, absent (not deployed) if >= 6 h
#   idle             anything else
# '_' sub-step rows that carry a duration (_build_visit, _craft_sync ...) are NOT used: they sit inside a real skill;
# ta_controls.py measures how much of them is covered by one.
import duckdb, os, numpy as np, pandas as pd
X = os.path.expanduser('~/mcai/parquet/ta3x')
CLASSES = ['productive', 'stuck_escape', 'failed_nav', 'failed_interrupted', 'failed_other', 'travel', 'noop',
           'llm_wait', 'paused', 'dead', 'between', 'absent', 'offline', 'idle']
P = {c: i for i, c in enumerate(CLASSES)}
OFFLINE_MAX = 6 * 3600
con = duckdb.connect(); con.execute("SET threads=3; SET memory_limit='12GB'")
q = lambda s: con.sql(s).df()
sk = q(f"SELECT world, bot, t0 a, t0+d b, cls FROM '{X}/skills.parquet' WHERE d > 0")
sk['p'] = sk.cls.map(P).astype(np.int8)
ll = q(f"SELECT world, bot, t a, t+lat b FROM '{X}/llm.parquet' WHERE lat > 0")
pa = q(f"SELECT world, bot, t a, t+s b FROM '{X}/pauses.parquet' WHERE s > 0")
gp = q(f"SELECT * FROM read_parquet('{X}/gaps-*.parquet')")
ed = q(f"SELECT * FROM '{X}/edges.parquet'")
de = q(f"SELECT world, bot, t FROM '{X}/deaths.parquet'")
pool = q(f"SELECT world, bot, any_value(pool) pool, any_value(arm) arm FROM '{X}/skills.parquet' GROUP BY ALL")
# llm-only bots/rows outside the skill span extend the span
lle = q(f"SELECT world, bot, min(t) f, max(t+lat) l FROM '{X}/llm.parquet' GROUP BY ALL")
ed = ed.merge(lle, on=['world', 'bot'], how='left')
ed['first'] = np.fmin(ed['first'], ed['f']); ed['last'] = np.fmax(ed['last'], ed['l'])

def grp(df):
    return {k: v for k, v in df.groupby(['world', 'bot'], sort=False)}
G = {n: grp(d) for n, d in [('sk', sk), ('ll', ll), ('pa', pa), ('gp', gp), ('de', de)]}
rows = []
for r in ed.itertuples():
    key = (r.world, r.bot); lo, hi = float(r.first), float(r.last)
    if hi <= lo: continue
    A, B, C = [], [], []
    def add(a, b, c):
        A.append(np.asarray(a, float)); B.append(np.asarray(b, float)); C.append(np.full(len(A[-1]), c, np.int8) if np.isscalar(c) else np.asarray(c, np.int8))
    if key in G['sk']:
        d = G['sk'][key]; add(d.a.values, d.b.values, d.p.values)
    if key in G['ll']:
        d = G['ll'][key]; add(d.a.values, d.b.values, P['llm_wait']); add(d.a.values - 45, d.a.values, P['between'])
    if key in G['pa']:
        d = G['pa'][key]; add(d.a.values, d.b.values, P['paused'])
    if key in G['gp']:
        d = G['gp'][key]; g = (d.b - d.a).values
        add(d.a.values, d.b.values, np.where(g >= OFFLINE_MAX, P['absent'], P['offline']))
    if key in G['de']:
        # dead: from the death row to the next row of any kind; approximated by the next skill/llm start, capped 600 s
        t = np.sort(G['de'][key].t.values)
        starts = np.sort(np.concatenate([x for x in A[:1]] + [np.array([hi])]))
        nxt = starts[np.minimum(np.searchsorted(starts, t, 'right'), len(starts) - 1)]
        add(t, np.minimum(nxt, t + 600), P['dead'])
    if not A:
        A, B, C = [np.array([lo])], [np.array([hi])], [np.array([P['idle']], np.int8)]
    a = np.clip(np.concatenate(A), lo, hi); b = np.clip(np.concatenate(B), lo, hi); c = np.concatenate(C)
    m = b > a; a, b, c = a[m], b[m], c[m]
    days = np.arange(np.floor(lo / 86400) * 86400, hi + 86400, 86400)
    bounds = np.unique(np.concatenate([a, b, [lo, hi], days[(days > lo) & (days < hi)]]))
    n = len(bounds) - 1
    cnt = np.zeros((n + 1, len(CLASSES)), np.int32)
    ia = np.searchsorted(bounds, a); ib = np.searchsorted(bounds, b)
    np.add.at(cnt, (ia, c), 1); np.add.at(cnt, (ib, c), -1)
    cov = np.cumsum(cnt, axis=0)[:n] > 0
    cov[:, P['idle']] = True
    win = cov.argmax(axis=1)
    seg = np.diff(bounds); day = np.floor(bounds[:-1] / 86400).astype(np.int64)
    df = pd.DataFrame({'day': day, 'c': win, 's': seg}).groupby(['day', 'c']).s.sum().unstack(fill_value=0)
    assert abs(df.values.sum() - (hi - lo)) < 1e-3 * max(1, hi - lo), key
    for dd, vals in df.iterrows():
        rec = {'world': r.world, 'bot': r.bot, 'day': int(dd)}
        rec.update({CLASSES[int(k)]: float(v) for k, v in vals.items()})
        rows.append(rec)
out = pd.DataFrame(rows).fillna(0.0)
for cl in CLASSES:
    if cl not in out: out[cl] = 0.0
out['date'] = pd.to_datetime(out.day * 86400, unit='s').dt.strftime('%Y-%m-%d')
out = out.merge(pool, on=['world', 'bot'], how='left')
out = out[out.date != '2026-10-07']
out.to_parquet(f'{X}/botday.parquet')
print(len(out), 'bot-days', out[CLASSES].sum().sum() / 3600, 'bot-hours incl absent')
