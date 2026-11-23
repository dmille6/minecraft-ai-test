# 3-time-accounting: compact per-row parquet of the skill streams (read-only on raw).
# One file per (source, day) in ~/mcai/parquet/ta3/. Skips 2026-10-07 (duplicate docs).
# Keeps inventory_delta as gain/loss sums (not the whole inventory) to stay small.
import duckdb, glob, os, sys
OUT = os.path.expanduser('~/mcai/parquet/ta3'); os.makedirs(OUT, exist_ok=True)
con = duckdb.connect(); con.execute("SET threads=3; SET memory_limit='10GB'; SET preserve_insertion_order=false")
only = sys.argv[1:]  # optional day filter
for src in ['mcai-skill-showcase', 'mcai-skill-agents']:
    for f in sorted(glob.glob(os.path.expanduser(f'~/mcai/raw/{src}/*.ndjson.zst'))):
        day = os.path.basename(f)[:10]
        if day == '2026-10-07' or os.path.getsize(f) < 100: continue
        if only and day not in only: continue
        out = f'{OUT}/{src}-{day}.parquet'
        if os.path.exists(out): continue
        con.execute(f"""COPY (
          WITH r AS (SELECT j FROM read_json_objects('{f}', compression='zstd', format='newline_delimited', ignore_errors=true) t(j)),
          d AS (SELECT *, map_values(try_cast(json_extract(j,'$.skill.inventory_delta') AS MAP(VARCHAR,DOUBLE))) dv FROM r)
          SELECT '{'show' if 'showcase' in src else 'fleet'}' AS world, '{day}' AS day,
            try_cast(j->>'$."@timestamp"' AS TIMESTAMP) ts,
            j->>'$.skill.name' name, j->>'$.skill.status' status, j->>'$.skill.fail_class' fail_class,
            left(j->>'$.skill.detail', 160) detail, try_cast(j->>'$.skill.duration_ms' AS DOUBLE) dur,
            try_cast(j->>'$.skill.distance_moved' AS DOUBLE) dist,
            j->>'$.bot.name' bot, j->>'$.bot.role' role, j->>'$.exp.pool' pool, j->>'$.exp.arm' arm,
            j->>'$.run_id' run_id, left(j->>'$.code.version', 9) ver, j->>'$.trigger' trig,
            (json_extract(j,'$.skill.inventory_delta') IS NOT NULL) has_delta,
            coalesce(list_sum(list_filter(dv, lambda x: x > 0)), 0) gain,
            coalesce(-list_sum(list_filter(dv, lambda x: x < 0)), 0) loss,
            try_cast(j->>'$.bot.pos.y' AS DOUBLE) y
          FROM d) TO '{out}' (FORMAT parquet, COMPRESSION zstd)""")
        print(out, flush=True)
