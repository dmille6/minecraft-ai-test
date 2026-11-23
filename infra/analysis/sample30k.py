"""Draw the 30k stratified sample from all 15.6M decisions (features table) in one pass, as 3 balanced 10k slices."""
import duckdb, json, random, collections, math, os
os.chdir(os.path.expanduser("~/mcai")); random.seed(30000)
old = [json.loads(l) for l in open("replay-1000.jsonl")] + [json.loads(l) for l in open("replay-5000.jsonl")]
con = duckdb.connect(); con.execute("set threads=14")
con.execute("create table old_ids as select unnest(?) as id", [[x["id"] for x in old]])
con.execute("create table sealed as select * from (select unnest(?) as bot, unnest(?) as run)",
            [[x["bot"] for x in old], [x["run"] for x in old]])     # Codex review: exclude ALL earlier sessions, not only final_test
con.execute("""create table d as select id, file, bot, run, ts,
  concat_ws('|', case when day < '2026-10-01' then 'aug-sep' when day < '2026-11-01' then 'oct' else 'nov' end, world, skill,
     coalesce(status,'none'), case when trigger='idle' then 'idle' else 'event' end,
     case when y is null then 'unk' when y < 0 then 'deep' when y < 60 then 'under' else 'surface' end,
     case when inv_kinds >= 30 then 'full' when inv_kinds >= 20 then 'busy' else 'light' end,
     (lava > 0 or water > 0)::varchar, (gate_error is not null)::varchar) as cell
  from read_parquet('parquet/decisions/*.parquet', union_by_name=true) where skill is not null""")
tot = con.execute("select count(*) from d").fetchone()[0]
cells = con.execute("select cell, count(*) from d group by 1").fetchall()
w = {c: math.sqrt(n) for c, n in cells}; W = sum(w.values())
alloc = {c: max(1, int(round(31000 * w[c] / W))) for c, n in cells}
alloc = {c: min(a, n) for (c, n), a in zip(cells, alloc.values())}
con.execute("create table alloc as select * from (select unnest(?) as cell, unnest(?) as a)", [list(alloc), list(alloc.values())])
rows = con.execute("""
  with x as (select d.*, a.a, row_number() over (partition by d.bot, substr(d.ts,1,16) order by hash(d.id||'m')) as rm
             from d join alloc a using (cell)
             where d.id not in (select id from old_ids) and (d.bot, d.run) not in (select bot, run from sealed)),
       y as (select *, row_number() over (partition by cell order by hash(id||'mcai30k')) as rn from x where rm = 1)
  select id, file, bot, run, cell from y where rn <= a""").fetchall()
pick = [dict(id=r[0], file=r[1], bot=r[2], run=r[3], cell=r[4]) for r in rows]
by_s = collections.defaultdict(list)
for p in pick: by_s[(p["bot"], p["run"])].append(p)
pick = [x for v in by_s.values() for x in (random.sample(v, 30) if len(v) > 30 else v)]
random.shuffle(pick); pick = pick[:30000]
by_c = collections.defaultdict(list)
for p in pick: by_c[p["cell"]].append(p)
for c in by_c:                          # random starting slice per cell (Codex review), then rotate
    random.shuffle(by_c[c]); k = random.randrange(3)
    for j, p in enumerate(by_c[c]): p["slice"] = (k + j) % 3 + 1
with open("sample30k-plan.jsonl", "w") as f:
    for p in pick: f.write(json.dumps(p) + "\n")
C = collections.Counter
# prevalence pool: simple random sample with known inclusion probability (Codex review)
srs = con.execute("""select id, file, bot, run, cell from d where (bot, run) not in (select bot, run from sealed)
                     using sample reservoir(1000 rows) repeatable (1122)""").fetchall()
eligible = con.execute("select count(*) from d where (bot, run) not in (select bot, run from sealed)").fetchone()[0]
with open("prevalence1000-plan.jsonl", "w") as f:
    for r in srs: f.write(json.dumps(dict(id=r[0], file=r[1], bot=r[2], run=r[3], cell=r[4], slice=0, incl_prob=1000/eligible)) + "\n")
print("prevalence SRS 1000 of eligible", f"{eligible:,}")
print("decisions with a skill:", f"{tot:,}", "cells:", len(cells), "| sampled", len(pick), "slices", dict(C(p["slice"] for p in pick)),
      "cells used", len(by_c), "sessions", len({(p['bot'],p['run']) for p in pick}),
      "era", dict(C(p["cell"].split("|")[0] for p in pick)), "world", dict(C(p["cell"].split("|")[1] for p in pick)),
      "status", dict(C(p["cell"].split("|")[3] for p in pick)), "skills", len(C(p["cell"].split("|")[2] for p in pick)))
