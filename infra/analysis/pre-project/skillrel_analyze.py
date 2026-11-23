# Skill reliability audit over ~/mcai/parquet/skills (built by skillrel_build.py). Writes CSVs to ~/mcai/out/skillrel/.
import duckdb, os
OUT = os.path.expanduser('~/mcai/out/skillrel'); os.makedirs(OUT, exist_ok=True)
con = duckdb.connect(); con.execute("SET threads=3; SET memory_limit='12GB'")
con.execute("CREATE VIEW e AS SELECT * FROM read_parquet('~/mcai/parquet/skills/*.parquet') WHERE day <> '2026-10-07'")
def q(name, sql):
    if name in globals().get('SKIP',()): return
    con.execute(f"COPY ({sql}) TO '{OUT}/{name}.csv' (HEADER)"); print('==', name, flush=True)
SKIP={'totals','status_values','per_skill'}
q('totals', """SELECT src, count(*) rows, count(name) named, count(DISTINCT bot) bots, min(ts), max(ts),
  sum((name LIKE '\\_%' ESCAPE '\\')::int) internal FROM e GROUP BY src""")
q('status_values', "SELECT src, status, count(*) n FROM e WHERE name NOT LIKE '\\_%' ESCAPE '\\' GROUP BY ALL ORDER BY n DESC")
q('per_skill', """SELECT src, name, count(*) runs, count(DISTINCT bot) bots,
  avg((status='success')::int) p_success, avg((status='failed')::int) p_failed, avg((status='aborted')::int) p_aborted,
  avg((status='no_effect')::int) p_noeffect, avg((status='refused')::int) p_refused,
  avg((status IN ('unknown','unverified','no_measurable_change') OR status IS NULL)::int) p_unverified,
  avg((status='interrupted')::int) p_interrupted,
  median(dur) dur_p50, quantile_cont(dur,0.95) dur_p95, median(dist) dist_p50, avg((dist>0)::int) p_moved,
  avg((status='success' AND coalesce(dist,0)=0 AND dur<50)::int) p_success_instant
  FROM e WHERE name NOT LIKE '\\_%' ESCAPE '\\' AND name IS NOT NULL GROUP BY ALL ORDER BY runs DESC""")
q('fail_class', """SELECT * FROM (SELECT src, name, status, fail_class, count(*) n FROM e WHERE name NOT LIKE '\\_%' ESCAPE '\\'
  AND status <> 'success' GROUP BY ALL) QUALIFY row_number() OVER (PARTITION BY src,name,status ORDER BY n DESC) <= 6 ORDER BY src,name,n DESC""")
q('top_detail', """WITH d AS (SELECT src,name,status, regexp_replace(regexp_replace(detail,'-?[0-9]+(\\.[0-9]+)?','#','g'),'[a-z_]+_(log|planks|ore|sapling)','*_\\1','g') d FROM e
  WHERE name NOT LIKE '\\_%' ESCAPE '\\' AND status NOT IN ('success'))
  SELECT * FROM (SELECT src,name,status,left(d,160) detail,count(*) n FROM d GROUP BY ALL)
  QUALIFY row_number() OVER (PARTITION BY src,name,status ORDER BY n DESC) <= 4 ORDER BY src,name,status,n DESC""")
q('abort_trigger', """SELECT src, name, trig, status, count(*) n FROM e WHERE name NOT LIKE '\\_%' ESCAPE '\\' AND status IN ('aborted','interrupted')
  GROUP BY ALL ORDER BY n DESC""")
q('abort_detail', """SELECT src, left(regexp_replace(detail,'-?[0-9]+(\\.[0-9]+)?','#','g'),120) d, count(*) n FROM e
  WHERE name NOT LIKE '\\_%' ESCAPE '\\' AND status IN ('aborted','interrupted') GROUP BY ALL ORDER BY n DESC LIMIT 60""")
q('month', """SELECT src, name, strftime(ts,'%Y-%m') m, count(*) runs, avg((status='success')::int) p_success,
  avg((status='failed')::int) p_failed, avg((status='aborted')::int) p_aborted FROM e
  WHERE name NOT LIKE '\\_%' ESCAPE '\\' GROUP BY ALL ORDER BY src,name,m""")
# code version eras: order versions by first seen, bucket into eras of ~equal time
q('ver_era', """WITH v AS (SELECT ver, min(ts) f FROM e WHERE ver IS NOT NULL GROUP BY ver),
  r AS (SELECT ver, f, ntile(6) OVER (ORDER BY f) era FROM v)
  SELECT e.src, name, era, min(r.f) era_start, count(*) runs, count(DISTINCT e.ver) vers, avg((status='success')::int) p_success,
  avg((status='failed')::int) p_failed FROM e JOIN r USING(ver) WHERE name NOT LIKE '\\_%' ESCAPE '\\'
  GROUP BY ALL ORDER BY e.src,name,era""")
# bot-hours: distinct (bot, hour) with any row
q('bot_hours', """SELECT src, count(DISTINCT (bot, date_trunc('hour', ts))) bot_hours FROM e WHERE bot IS NOT NULL GROUP BY src""")
q('internal', """WITH bh AS (SELECT src, count(DISTINCT (bot, date_trunc('hour', ts))) h FROM e WHERE bot IS NOT NULL GROUP BY src)
  SELECT e.src, name, count(*) n, count(DISTINCT bot) bots, round(count(*)/any_value(bh.h),3) per_bot_hour,
  count(DISTINCT (bot, date_trunc('hour',ts))) hours_with FROM e JOIN bh USING(src)
  WHERE name LIKE '\\_%' ESCAPE '\\' GROUP BY ALL ORDER BY n DESC""")
q('internal_month', """WITH bh AS (SELECT src, strftime(ts,'%Y-%m') m, count(DISTINCT (bot, date_trunc('hour', ts))) h FROM e WHERE bot IS NOT NULL GROUP BY ALL)
  SELECT e.src, m, name, count(*) n, round(count(*)/any_value(bh.h),3) per_bot_hour FROM (SELECT *, strftime(ts,'%Y-%m') m FROM e) e JOIN bh USING(src,m)
  WHERE name IN ('_path_noPath','_path_no_legal_move','_entombed','_watchdog_rescue','_stuck','_path_reset','_loop_break','_unstick')
   OR name ILIKE '%stuck%' OR name ILIKE '%entomb%' OR name ILIKE '%watchdog%' OR name ILIKE '%nopath%' OR name ILIKE '%loop%' OR name ILIKE '%rescue%'
  GROUP BY ALL ORDER BY e.src, name, m""")
q('internal_detail', """SELECT * FROM (SELECT src,name,left(regexp_replace(detail,'-?[0-9]+(\\.[0-9]+)?','#','g'),120) d,count(*) n FROM e
  WHERE name ILIKE '%stuck%' OR name ILIKE '%entomb%' OR name ILIKE '%watchdog%' OR name ILIKE '%nopath%' OR name ILIKE '%no_legal%' OR name ILIKE '%loop%'
  GROUP BY ALL) QUALIFY row_number() OVER (PARTITION BY src,name ORDER BY n DESC)<=3 ORDER BY src,name,n DESC""")
# repeated-failure streaks: same bot, same skill failing back-to-back (loop signal)
q('fail_streaks', """WITH s AS (SELECT src,bot,name,status,ts, lag(name) OVER w pn, lag(status) OVER w ps FROM e
  WHERE name NOT LIKE '\\_%' ESCAPE '\\' AND bot IS NOT NULL WINDOW w AS (PARTITION BY src,bot ORDER BY ts))
  SELECT src,name, count(*) fails, avg((pn=name AND ps<>'success')::int) p_repeat_after_fail FROM s WHERE status<>'success' GROUP BY ALL ORDER BY fails DESC""")
