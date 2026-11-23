#!/usr/bin/env python3
"""Analysis 7 (deaths and danger), step 1: slim per-day parquet of every skill event.
Run on the analysis VM (10.0.0.45): nice -n 10 ~/venv/bin/python 7_extract_slim.py
Reads ~/mcai/raw/mcai-skill-{agents,showcase}/*.ndjson.zst (read-only), skips 2026-10-07,
writes ~/mcai/work7/slim/<src>-<day>.parquet. Inventory JSON kept only on _death rows."""
import duckdb, glob, os, sys
H = os.path.expanduser('~/mcai')
OUT = f'{H}/work7/slim'; os.makedirs(OUT, exist_ok=True)
c = duckdb.connect(); c.sql("set threads=3"); c.sql("set memory_limit='8GB'")
for src in ['agents', 'showcase']:
    for f in sorted(glob.glob(f'{H}/raw/mcai-skill-{src}/*.ndjson.zst')):
        day = os.path.basename(f)[:10]
        if day == '2026-10-07': continue
        o = f'{OUT}/{src}-{day}.parquet'
        if os.path.exists(o): continue
        q = f"""
        copy (select '{src}' src,
          try_cast(j->>'$."@timestamp"' as timestamp) ts,
          j->>'$.bot.name' bot, j->>'$.exp.pool' pool, j->>'$.exp.arm' arm, j->>'$.run_id' run_id,
          j->>'$.code.version' ver, j->>'$.skill.name' name, j->>'$.skill.status' status,
          j->>'$.trigger' trig, j->>'$.skill.fail_class' fc,
          case when j->>'$.skill.name'='_death' then j->>'$.skill.detail' else left(j->>'$.skill.detail',300) end detail,
          try_cast(j->>'$.bot.health' as double) health, try_cast(j->>'$.bot.hunger' as double) hunger,
          try_cast(j->>'$.bot.pos.x' as double) x, try_cast(j->>'$.bot.pos.y' as double) y,
          try_cast(j->>'$.bot.pos.z' as double) z, j->>'$.game.dimension' dim,
          case when j->>'$.skill.name'='_death' then j->>'$.bot.inventory' end inv,
          j->>'$._id' id
        from read_json_objects('{f}', format='newline_delimited', compression='zstd', ignore_errors=true) t(j))
        to '{o}.tmp' (format parquet)"""
        try:
            c.sql(q); os.rename(o + '.tmp', o); print('ok', src, day, flush=True)
        except Exception as e:
            print('ERR', src, day, e, flush=True)
