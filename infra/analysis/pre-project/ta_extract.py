# 3-time-accounting, step 2: from ~/mcai/parquet/ta3 (ta_build.py) + decisions parquet, write the small inputs the
# sweep needs into ~/mcai/parquet/ta3x/:
#   skills.parquet   one row per REAL skill (name without '_'), with its interval class code
#   llm.parquet      one row per model call (decisions table): start ts + latency
#   pauses.parquet   `_decision_skipped rule=pausewait ... wake in Ns` -> [t, t+N]
#   deaths.parquet   `_death` rows
#   gaps.parquet     consecutive-row gaps > 600 s per bot, over EVERY row of both streams (positive presence proof)
#   edges.parquet    first/last row per bot
#   events.parquet   counts of point events per (world, bot, day, name) for nav/stuck markers
# Read-only on the data. DuckDB threads=3, run under nice.
import duckdb, os, glob
H = os.path.expanduser('~/mcai/parquet')
OUT = f'{H}/ta3x'; os.makedirs(OUT, exist_ok=True)
files = [f for f in sorted(glob.glob(f'{H}/ta3/*.parquet')) if os.path.getsize(f) > 1000]
con = duckdb.connect(); con.execute("SET threads=3; SET memory_limit='14GB'; SET preserve_insertion_order=false")
con.execute(f"CREATE VIEW raw AS SELECT * FROM read_parquet({files!r}) WHERE ts IS NOT NULL AND bot IS NOT NULL")

TRAVEL = "('goto','explore','home','surface','sky_descend','wander','return_home','follow','come','flee','stair_walk','travel','keepout_exit')"
META = "('status','count_town','board','say','chat','eat','wear_out')"
BUILDISH = "(name LIKE 'build%' OR name IN ('place','prune_town','dispose_well','compost'))"
# navigation failure classes (explicit list; anything else is 'other'). 'interrupted' is its own bucket.
NAVFC = ("('no_path','unreachable','stranded','travel_incomplete','path_budget','path_timeout','wrong_elevation',"
         "'goal_changed','no_stand','no_safe_target','marooned','entombed','no_route','unreachable_target','stuck',"
         "'path_interrupted','well_unreachable','composter_unreachable')")
# rescue trigger: a skill the runner/watchdog fired, or the model chose, BECAUSE the bot was in trouble.
# NOT 'interrupt:X': runner.mjs:586 stamps that on the ORIGINAL skill when reflex X cut it short (it is classified by
# its own outcome; an 'interrupted' abort is failed_interrupted).
RESCUE = ("(trig LIKE 'livelock_escape%' OR trig LIKE 'watchdog_%' OR "
          "(trig LIKE 'llm:%' AND trig NOT IN ('llm:idle','llm:startup','llm:chat','llm:milestone','llm:task')))")

con.execute(f"""COPY (
  SELECT world, bot, any_value(pool) OVER (PARTITION BY world, bot) pool, arm, ts, epoch(ts) t0,
    least(greatest(coalesce(dur,0),0), 3600000)/1000.0 d, name, status, fail_class, trig, gain, loss, has_delta,
    CASE
      WHEN {RESCUE} THEN 'stuck_escape'
      WHEN name IN {TRAVEL} AND status='success' THEN 'travel'
      WHEN name IN {TRAVEL} AND fail_class='interrupted' THEN 'failed_interrupted'
      WHEN name IN {TRAVEL} AND status IN ('failed','aborted','unknown') THEN 'failed_nav'
      WHEN name IN {TRAVEL} THEN 'noop'
      WHEN status IN ('failed','aborted') AND fail_class='interrupted' THEN 'failed_interrupted'
      WHEN status IN ('failed','aborted') AND fail_class IN {NAVFC} THEN 'failed_nav'
      WHEN status IN ('failed','aborted') THEN 'failed_other'
      WHEN status='unknown' AND fail_class IN {NAVFC} AND gain+loss=0 THEN 'failed_nav'
      WHEN name IN {META} THEN 'noop'
      WHEN status IN ('success','unknown') AND (gain>0 OR loss>0) THEN 'productive'
      WHEN status='success' AND {BUILDISH} THEN 'productive'
      ELSE 'noop' END AS cls
  FROM raw WHERE name NOT LIKE '\\_%' ESCAPE '\\') TO '{OUT}/skills.parquet' (FORMAT parquet)""")
print('skills', flush=True)

con.execute(f"""COPY (
  SELECT world, bot, epoch(ts) t, least(coalesce(try_cast(regexp_extract(detail,'wake in ([0-9.]+)s',1) AS DOUBLE),0),600) s
  FROM raw WHERE name='_decision_skipped' AND detail LIKE '%pausewait%') TO '{OUT}/pauses.parquet' (FORMAT parquet)""")
con.execute(f"""COPY (SELECT world, bot, epoch(ts) t FROM raw WHERE name='_death') TO '{OUT}/deaths.parquet' (FORMAT parquet)""")
print('pauses/deaths', flush=True)

dec = f"read_parquet('{H}/decisions/*.parquet', union_by_name=true)"
con.execute(f"""COPY (
  SELECT CASE WHEN world='showcase' THEN 'show' ELSE 'fleet' END world, bot,
         epoch(try_cast(ts AS TIMESTAMP)) t, least(greatest(coalesce(latency_ms,0),0),600000)/1000.0 lat,
         skill, status, trigger
  FROM {dec} WHERE day <> '2026-10-07' AND bot IS NOT NULL AND try_cast(ts AS TIMESTAMP) IS NOT NULL)
  TO '{OUT}/llm.parquet' (FORMAT parquet)""")
print('llm', flush=True)

for w in ['fleet', 'show']:
    con.execute(f"""COPY (
      WITH st AS (SELECT DISTINCT bot, floor(epoch(ts)) s FROM raw WHERE world='{w}'
                  UNION SELECT DISTINCT bot, floor(t) FROM read_parquet('{OUT}/llm.parquet') WHERE world='{w}'),
      l AS (SELECT bot, s, lag(s) OVER (PARTITION BY bot ORDER BY s) p FROM st)
      SELECT '{w}' world, bot, p a, s b FROM l WHERE s - p > 600) TO '{OUT}/gaps-{w}.parquet' (FORMAT parquet)""")
    print('gaps', w, flush=True)

con.execute(f"""COPY (SELECT world, bot, min(epoch(ts)) first, max(epoch(ts)) last, count(*) rows FROM raw GROUP BY ALL)
  TO '{OUT}/edges.parquet' (FORMAT parquet)""")
con.execute(f"""COPY (SELECT world, bot, day, name, status, count(*) n FROM raw WHERE name LIKE '\\_%' ESCAPE '\\' GROUP BY ALL)
  TO '{OUT}/events.parquet' (FORMAT parquet)""")
print('done', flush=True)
