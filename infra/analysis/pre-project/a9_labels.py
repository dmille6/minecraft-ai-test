"""a9: join Opus v3 answer-key labels to slice metadata and the decision table.
Output ~/mcai9/labels.parquet (one row per labeled decision)."""
import duckdb, json, os
H = os.path.expanduser('~/mcai')
rows = []
for s in range(4):
    meta = {}
    for l in open(f'{H}/slice{s}.jsonl'):
        r = json.loads(l); r.pop('prompt', None); meta[r['id']] = r
    for l in open(f'{H}/opus-v3-slice{s}.labels.jsonl'):
        r = json.loads(l); m = meta.get(r['id'], {}); lab = r.get('label') or {}
        rows.append(dict(id=r['id'], slice=s, cell=m.get('cell'), mbot=m.get('bot'), mrun=m.get('run'),
                         mts=m.get('ts'), mmodel=m.get('model'), logged_skill=m.get('logged_skill'),
                         outcome_status=m.get('outcome_status'),
                         decision_ok=lab.get('decision_ok'), args_ok=lab.get('args_ok'),
                         failure_category=lab.get('failure_category')))
c = duckdb.connect(); c.execute("set threads=2")
import pyarrow as pa
c.register('lab', pa.Table.from_pylist(rows))
c.execute(f"""copy (select l.*, d.code, d.run, d.world, d.latency_ms, d.prompt_tokens, d.completion_tokens,
   d.gate_error, d.status, d.trigger, d.model, d.day
   from lab l left join read_parquet('{H}/parquet/decisions/*.parquet', union_by_name=true) d using(id))
   to '{os.path.expanduser('~/mcai9/labels.parquet')}' (format parquet)""")
print(c.sql(f"select slice,count(*),count(code),count(latency_ms), sum((decision_ok='yes')::int), sum((decision_ok='no')::int) from read_parquet('{os.path.expanduser('~/mcai9/labels.parquet')}') group by 1 order by 1"))
