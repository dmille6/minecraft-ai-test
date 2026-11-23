"""a9 Q3 baseline + Q5 without zero-latency rows.
Q3b: same next-decision classification for UNGATED decisions (by own status) -> baseline for
'redirect_ok' etc. Q5b: latency quintiles excluding latency_ms=0 (6.7% of decisions; no completion
tokens -> not a fresh model answer)."""
import duckdb
c = duckdb.connect(); c.execute("set threads=2; set memory_limit='8GB'")
c.execute("""create temp table s as select bot, cast(ts as timestamp) t, skill, status, gate_error g,
   lead(cast(ts as timestamp)) over w nt, lead(skill) over w ns, lead(status) over w nst, lead(gate_error) over w ng
   from read_parquet('~/mcai/parquet/decisions/*.parquet', union_by_name=true) where day <> '2026-10-07'
   window w as (partition by bot order by ts)""")
print(c.sql("""select status, count(*) n,
  round(100*avg((ng is not null)::int),1) next_gated,
  round(100*avg((ng is null and ns<>skill and nst='success')::int),1) redirect_ok,
  round(100*avg((ng is null and ns<>skill and nst<>'success')::int),1) redirect_bad,
  round(100*avg((ng is null and ns=skill and nst='success')::int),1) same_ok,
  round(100*avg((ng is null and ns=skill and nst<>'success')::int),1) same_bad
  from s where g is null and nt is not null and nt-t <= interval 5 minute group by 1 order by n desc"""))
# Q5b
L = 'read_parquet(\'/home/mike/mcai9/labels.parquet\')'
print(c.sql(f"""with r as (select *, ntile(5) over (partition by model order by latency_ms) q from {L}
   where latency_ms>0 and model in ('qwen2.5:7b-instruct','gemma4:26b','r3-qwen35-4b-q8'))
   select model, q, count(*) n, min(latency_ms) lo, max(latency_ms) hi, sum((decision_ok='yes')::int) ok,
   round(avg((decision_ok='yes')::int),3) rate from r group by 1,2 order by 1,2""").fetchall())
print(c.sql(f"""with r as (select *, ntile(5) over (order by latency_ms) q from {L} where latency_ms>0 and slice=0)
   select q, count(*) n, min(latency_ms), max(latency_ms), sum((decision_ok='yes')::int) ok, round(avg((decision_ok='yes')::int),3)
   from r group by 1 order by 1""").fetchall())
print(c.sql(f"""select (latency_ms=0) zero, count(*) n, sum((decision_ok='yes')::int) ok from {L} where slice=0 group by 1""").fetchall())
# within-cell slow-vs-fast among nonzero, via duckdb: per (model,cell) mean ok by quintile 5 vs 1
print(c.sql(f"""with r as (select *, ntile(5) over (partition by model order by latency_ms) q from {L} where latency_ms>0),
  g as (select model, cell, avg(case when q=5 then (decision_ok='yes')::int end) s, avg(case when q=1 then (decision_ok='yes')::int end) f,
   count(case when q=5 then 1 end) ns from r group by 1,2)
  select sum(ns*(s-f))/sum(ns) adj_diff_slow_minus_fast, sum(ns) matched_slow, count(*) cells from g where s is not null and f is not null"""))
