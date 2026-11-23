"""a9: compact per-day extraction of the raw skill streams (agents + showcase).
Keeps executed skills (no leading _) and a few internal order/board events.
Output: ~/mcai9/skill/<stream>-<day>.parquet. Run with nice -n 15 on the analysis VM.
"""
import duckdb, glob, os, sys
OUT = os.path.expanduser('~/mcai9/skill'); os.makedirs(OUT, exist_ok=True)
KEEP_INTERNAL = ('_work_order','_pipeline','_decision_skipped','_workboard','_milestone_complete',
                 '_build_visit','_depositoffer_tally','_stock_refused')
c = duckdb.connect(); c.execute("set threads=2; set memory_limit='6GB'")
files = sorted(glob.glob(os.path.expanduser('~/mcai/raw/mcai-skill-*/*.ndjson.zst')))
if 'rev' in sys.argv: files = files[::-1]
for f in files:
    stream = f.split('/')[-2].replace('mcai-skill-',''); day = os.path.basename(f)[:10]
    if day == '2026-10-07' or os.path.getsize(f) < 100: continue
    out = f'{OUT}/{stream}-{day}.parquet'
    if os.path.exists(out) or os.path.exists(out+'.tmp'): continue
    open(out+'.tmp','w').close()
    keep = ",".join(f"'{k}'" for k in KEEP_INTERNAL)
    try:
        c.execute(f"""copy (select
          cast("@timestamp" as timestamp) ts, '{stream}' as "stream", '{day}' as "day",
          json_extract_string(to_json(bot),'$.name') bot, run_id run,
          json_extract_string(to_json(code),'$.version') code, trigger,
          json_extract_string(to_json(skill),'$.name') name,
          json_extract_string(to_json(skill),'$.status') status,
          try_cast(json_extract_string(to_json(skill),'$.duration_ms') as double) dur_ms,
          json_extract_string(to_json(skill),'$.fail_class') fail_class,
          left(json_extract_string(to_json(skill),'$.detail'),400) detail,
          left(json_extract(to_json(skill),'$.args')::varchar,300) args,
          left(json_extract(to_json(skill),'$.inventory_delta')::varchar,600) inv_delta,
          try_cast(json_extract_string(to_json(bot),'$.pos.x') as double) x,
          try_cast(json_extract_string(to_json(bot),'$.pos.y') as double) y,
          try_cast(json_extract_string(to_json(bot),'$.pos.z') as double) z
        from read_ndjson('{f}', compression='zstd', ignore_errors=true, union_by_name=true, sample_size=20000, maximum_object_size=67108864)
        where json_extract_string(to_json(skill),'$.name') not like '\\_%' escape '\\'
           or json_extract_string(to_json(skill),'$.name') in ({keep}))
        to '{out}.p' (format parquet)""")
        os.rename(out+'.p', out); os.remove(out+'.tmp')
        print(day, stream, 'ok', flush=True)
    except Exception as e:
        print(day, stream, 'ERR', str(e)[:200], flush=True)
