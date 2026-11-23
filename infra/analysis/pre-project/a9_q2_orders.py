"""a9 Q2: what did the hard-coded orders cost?
Source of every executed skill row (name not starting with _), from ~/mcai9/skill/*.parquet:
  order     a _work_order event for the same bot naming the same skill, start time within +-3 s
            (start = row ts - duration_ms; the gap distribution peaks at 0 / -500 ms)
  model     otherwise, trigger 'llm:*'
  interrupt otherwise, trigger 'interrupt:*' (skill cut by an interrupt; origin not logged)
  reflex    otherwise (livelock_escape*, watchdog_*, reflex, ...)
Reports rows, skill time (sum duration_ms) and success per source; per order kind."""
import duckdb, os
G = os.environ.get('SKILLGLOB', '/home/mike/mcai9/skill/*.parquet')
c = duckdb.connect(); c.execute("set threads=8; set memory_limit='10GB'")
c.execute(f"create view k as select * from read_parquet('{G}', union_by_name=true)")
c.execute("""create temp table wo as select stream, bot, ts wts, split_part(detail,' ',1) wsk,
   left(regexp_replace(trim(split_part(detail, '—', 2)), '[0-9]+', 'N', 'g'), 60) why from k where name='_work_order'""")
c.execute("""create temp table ex as select stream, day, bot, ts, name, status, coalesce(dur_ms,0) dur, trigger,
   ts - to_milliseconds(coalesce(dur_ms,0)::bigint) st from k where name not like '\\_%' escape '\\'""")
c.execute("""create temp table j as select e.*, w.wts, w.why,
   case when w.wts is not null and abs(epoch_ms(e.st)-epoch_ms(w.wts)) <= 3000 then 'order'
        when e.trigger like 'llm:%' then 'model' when e.trigger like 'interrupt:%' then 'interrupt' else 'reflex' end src
   from ex e asof left join wo w on e.stream=w.stream and e.bot=w.bot and e.name=w.wsk and w.wts <= e.st + interval 3 second""")
print('positive control: work orders logged vs matched to an execution')
print(c.sql("""select w.stream, count(*) orders, (select count(*) from j where src='order' and j.stream=w.stream) matched_exec,
   min(wts)::date first_day from wo w group by 1"""))
print(c.sql("""select stream, src, count(*) n, round(100*count(*)/sum(count(*)) over (partition by stream),1) pct_rows,
   round(sum(dur)/3.6e6,0) skill_hours, round(100*sum(dur)/sum(sum(dur)) over (partition by stream),1) pct_time,
   round(100*avg((status='success')::int),1) succ_pct, round(100*avg((status='failed')::int),1) fail_pct
   from j group by 1,2 order by 1,2"""))
print('since orders exist (day >= first _work_order day per stream):')
print(c.sql("""with f as (select stream, min(wts)::date d0 from wo group by 1)
   select j.stream, src, count(*) n, round(100*count(*)/sum(count(*)) over (partition by j.stream),1) pct_rows,
   round(100*sum(dur)/sum(sum(dur)) over (partition by j.stream),1) pct_time, round(100*avg((status='success')::int),1) succ_pct
   from j join f on j.stream=f.stream and j.ts::date >= f.d0 group by 1,2 order by 1,2"""))
print('by month (both streams):')
print(c.sql("""select strftime(ts,'%Y-%m') m, round(100*avg((src='order')::int),1) order_rows_pct,
   round(100*sum(case when src='order' then dur end)/sum(dur),1) order_time_pct, count(*) rows from j group by 1 order by 1"""))
print('same skill, order vs model success (skills with >=2000 order rows):')
print(c.sql("""with s as (select name from j where src='order' group by 1 having count(*)>=2000)
   select name, src, count(*) n, round(100*avg((status='success')::int),1) succ, round(100*avg((status='failed')::int),1) fail,
   round(100*avg((status='no_effect')::int),1) no_eff, round(avg(dur)/1000,1) mean_s
   from j where name in (select name from s) and src in ('order','model') group by 1,2 order by 1,2""").fetchall())
print('order kinds (top 30 by rows): skill, reason, n, success %, skill hours')
print(c.sql("""select name, why, count(*) n, round(100*avg((status='success')::int),1) succ,
   round(100*avg((status='no_effect')::int),1) no_eff, round(sum(dur)/3.6e6,1) hrs
   from j where src='order' group by 1,2 order by n desc limit 30""").fetchall())
print('pipeline: prefetched model answers dropped because an order took the turn')
print(c.sql("""select stream, count(*) pipeline_rows, count(*) filter (where detail like '%why=order%') dropped_for_order,
   count(*) filter (where detail like '%use=dropped%') dropped_any from k where name='_pipeline' group by 1"""))
