"""a9 Q3: per-gate value. For every decision rejected by a gate (gate_error not null, LLM endpoint
failures excluded), look at the SAME bot's next decision (ordered by ts, within 5 min):
  loop_same      next is rejected by the same gate
  other_gate     next is rejected by a different gate
  redirect_ok    next ungated, different skill, status success
  redirect_bad   next ungated, different skill, not success
  same_ok/same_bad next ungated, same skill (gate passed on retry)
  none           no next decision within 5 min
Also: ungated success rate of the same skill (same bot-day) as a rough counterfactual for what the
gate blocked, and the Opus label rate on gated decisions where available."""
import duckdb
c = duckdb.connect(); c.execute("set threads=2; set memory_limit='8GB'")
c.execute("""create temp table d as select bot, world, cast(ts as timestamp) t, skill, status, gate_error g, day
  from read_parquet('~/mcai/parquet/decisions/*.parquet', union_by_name=true) where day <> '2026-10-07'""")
c.execute("""create temp table s as select *, lead(t) over w nt, lead(skill) over w ns, lead(status) over w nst,
   lead(g) over w ng from d window w as (partition by bot order by t)""")
c.execute("""create temp table gg as select g, world, skill,
   case when nt is null or nt - t > interval 5 minute then 'none'
        when ng = g then 'loop_same'
        when ng is not null then 'other_gate'
        when ns <> skill and nst='success' then 'redirect_ok'
        when ns <> skill then 'redirect_bad'
        when nst='success' then 'same_ok' else 'same_bad' end nxt
   from s where g is not null and g not like 'all % llm endpoint%'""")
print(c.sql("select count(*) total_decisions, count(g) gated from d"))
q = c.sql("""select g, count(*) n,
  round(100*avg((nxt='loop_same')::int),1) loop_same, round(100*avg((nxt='other_gate')::int),1) other_gate,
  round(100*avg((nxt='redirect_ok')::int),1) redirect_ok, round(100*avg((nxt='redirect_bad')::int),1) redirect_bad,
  round(100*avg((nxt='same_ok')::int),1) same_ok, round(100*avg((nxt='same_bad')::int),1) same_bad,
  round(100*avg((nxt='none')::int),1) none
  from gg group by 1 having count(*)>=500 order by n desc""")
print(q.to_arrow_table().to_pylist() and q)
q.write_csv('/home/mike/mcai9/q3_gates.csv')
# blocked skill: which skills each gate blocks, and that skill's ungated success rate overall
print(c.sql("""with b as (select g, skill, count(*) n from d where g is not null and g not like 'all %' group by 1,2),
  base as (select skill, count(*) n_ungated, round(100*avg((status='success')::int),1) ungated_succ from d where g is null group by 1),
  top as (select *, row_number() over (partition by g order by n desc) rk, sum(n) over (partition by g) tot from b)
  select g, skill, n, round(100*n/tot,1) pct_of_gate, ungated_succ, n_ungated from top join base using(skill)
  where rk<=2 and tot>=5000 order by tot desc, rk""").fetchall())
# streak lengths: consecutive rejections by the same gate per bot
c.execute("""create temp table st as select bot, t, g, sum(case when g is distinct from pg then 1 else 0 end) over (partition by bot order by t) grp
  from (select bot,t,g, lag(g) over (partition by bot order by t) pg from d)""")
print(c.sql("""select g, count(*) streaks, round(avg(n),2) mean_len, quantile_cont(n,0.5) p50, quantile_cont(n,0.9) p90, max(n) mx,
  round(100*avg((n>=10)::int),1) pct_ge10
  from (select bot, grp, g, count(*) n from st where g is not null and g not like 'all %' group by 1,2,3) group by 1 having count(*)>=500 order by streaks desc""").fetchall())
# answer key on gated decisions
print(c.sql("""select gate_error, count(*) n, sum((decision_ok='yes')::int) ok, round(avg((decision_ok='yes')::int),3) rate,
   sum((failure_category='repeated_rejected_action')::int) rep from read_parquet('/home/mike/mcai9/labels.parquet')
   group by 1 order by n desc limit 16""").fetchall())
