# 3-time-accounting: positive controls on the time-attribution assumptions. Sample days given as args (default 3).
# 1) real skill rows are stamped at START: the next real skill of the same bot should start at or after t+d.
# 2) model-call rows are stamped at the START of the call: the llm-triggered skill that follows should start ~ t+lat.
# 3) '_' rows with a duration are sub-steps stamped at their END and lie inside a real skill.
import duckdb, os, sys
H = os.path.expanduser('~/mcai/parquet')
days = sys.argv[1:] or ['2026-09-15', '2026-10-25', '2026-11-12']
con = duckdb.connect(); con.execute("SET threads=3")
for day in days:
    fs = [f'{H}/ta3/mcai-skill-agents-{day}.parquet', f'{H}/ta3/mcai-skill-showcase-{day}.parquet']
    fs = [f for f in fs if os.path.exists(f)]
    con.execute(f"CREATE OR REPLACE VIEW r AS SELECT *, epoch(ts) t FROM read_parquet({fs!r})")
    con.execute("CREATE OR REPLACE TEMP TABLE s AS SELECT world, bot, t, least(coalesce(dur,0),3600000)/1000 d, trig, name FROM r WHERE name NOT LIKE '\\_%' ESCAPE '\\'")
    print('==', day)
    print(' 1 start-stamp: rows, next-starts-before-end(>1s), overlap hours, total skill hours:', con.sql("""
      WITH x AS (SELECT *, lead(t) OVER (PARTITION BY world, bot ORDER BY t) nt FROM s)
      SELECT count(*), count(*) FILTER (WHERE nt < t + d - 1), round(sum(greatest(0, t + d - nt)) FILTER (WHERE nt < t+d)/3600,1),
             round(sum(d)/3600,1) FROM x""").fetchall())
    print('   ...same if row were END-stamped (prev end after this start-d):', con.sql("""
      WITH x AS (SELECT *, lag(t) OVER (PARTITION BY world, bot ORDER BY t) pt FROM s)
      SELECT count(*) FILTER (WHERE t - d < pt - 1) FROM x""").fetchall())
    con.execute(f"""CREATE OR REPLACE TEMP TABLE l AS SELECT CASE WHEN world='showcase' THEN 'show' ELSE 'fleet' END world, bot,
       epoch(try_cast(ts AS TIMESTAMP)) t, latency_ms/1000.0 lat FROM read_parquet('{H}/decisions/*.parquet', union_by_name=true) WHERE day='{day}'""")
    print(' 2 llm: n, median(next llm-skill start - (t+lat)), p10, p90, share within +-2s:', con.sql("""
      SELECT count(*), median(gapv), quantile_cont(gapv,.1), quantile_cont(gapv,.9), avg((abs(gapv)<2)::int) FROM (
        SELECT l.t + l.lat AS e, (SELECT min(s.t) FROM s WHERE s.world=l.world AND s.bot=l.bot AND s.t >= l.t AND s.trig LIKE 'llm:%') - (l.t + l.lat) gapv
        FROM (SELECT * FROM (SELECT * FROM l) USING SAMPLE 3000 ROWS) l) WHERE gapv IS NOT NULL""").fetchall())
    print(' 3 sub-steps with duration: n, hours, share of their END inside a real skill [t, t+d]:', con.sql("""
      WITH u0 AS (SELECT world, bot, t, dur/1000 d FROM r WHERE name LIKE '\\_%' ESCAPE '\\' AND dur > 0), u AS (SELECT * FROM u0 USING SAMPLE 3000 ROWS)
      SELECT count(*), round(sum(d)/3600,1), avg((EXISTS (SELECT 1 FROM s WHERE s.world=u.world AND s.bot=u.bot AND s.t <= u.t - u.d + 1 AND s.t + s.d >= u.t - 1))::int) FROM u""").fetchall())
