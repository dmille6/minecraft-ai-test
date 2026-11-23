# Build compact parquet of skill events (one file per day per source). Read-only on raw.
import duckdb, glob, os, sys
OUT = os.path.expanduser('~/mcai/parquet/skills')
os.makedirs(OUT, exist_ok=True)
con = duckdb.connect(); con.execute("SET threads=3; SET memory_limit='8GB'")
for src in ['mcai-skill-agents', 'mcai-skill-showcase']:
    for f in sorted(glob.glob(os.path.expanduser(f'~/mcai/raw/{src}/*.ndjson.zst'))):
        day = os.path.basename(f)[:10]
        if day == '2026-10-07': continue
        out = f'{OUT}/{src}-{day}.parquet'
        if os.path.exists(out): continue
        con.execute(f"""COPY (SELECT '{src}' AS src, '{day}' AS day,
          try_cast(j->>'$."@timestamp"' AS TIMESTAMP) ts,
          j->>'$.skill.name' name, j->>'$.skill.status' status, j->>'$.skill.fail_class' fail_class,
          left(j->>'$.skill.detail', 240) detail, try_cast(j->>'$.skill.duration_ms' AS DOUBLE) dur,
          try_cast(j->>'$.skill.distance_moved' AS DOUBLE) dist,
          coalesce(j->>'$.bot.name', j->>'$.bot_name') bot, j->>'$.run_id' run_id,
          left(j->>'$.code.version', 9) ver, j->>'$.trigger' trig, j->>'$.exp.pool' pool, j->>'$.world' world
          FROM read_json_objects('{f}', compression='zstd', format='newline_delimited', ignore_errors=true) t(j))
          TO '{out}' (FORMAT parquet, COMPRESSION zstd)""")
        print(out, flush=True)
