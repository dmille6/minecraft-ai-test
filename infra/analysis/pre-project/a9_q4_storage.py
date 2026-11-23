"""a9 Q4: storage / chest flows. Skill rows from ~/mcai9/skill, gate rows from the decision table."""
import duckdb, os
G = os.environ.get('SKILLGLOB', '/home/mike/mcai9/skill/*.parquet')
c = duckdb.connect(); c.execute("set threads=8; set memory_limit='10GB'")
c.execute(f"create view k as select * from read_parquet('{G}', union_by_name=true)")
S = "('deposit','town_deposit','withdraw','withdraw_pick','mats_return','dispose_well','count_town','prune_town','toolkit','compost','wear_out','store','bank')"
print(c.sql(f"""select stream, name, count(*) n, round(100*avg((status='success')::int),1) succ, round(100*avg((status='no_effect')::int),1) no_eff,
   round(100*avg((status='failed')::int),1) fail, round(sum(coalesce(dur_ms,0))/3.6e6,0) hrs from k where name in {S} group by 1,2 order by 1, n desc"""))
print('top outcome texts per storage skill (numbers -> N)')
print(c.sql(f"""with t as (select name, status, left(regexp_replace(detail,'-?[0-9]+','N','g'),90) d, count(*) n from k where name in ('deposit','town_deposit','withdraw','dispose_well')
   group by 1,2,3), r as (select *, row_number() over (partition by name order by n desc) rk, sum(n) over (partition by name) tot from t)
   select name, status, d, n, round(100*n/tot,1) pct from r where rk<=8 order by name, rk""").fetchall())
print('items moved by storage skills (inventory_delta; negative = left the bag)')
c.execute(f"""create temp table mv as select name, stream, e.key item, try_cast(e.value as double) q from k, json_each(k.inv_delta::json) e
   where name in {S} and inv_delta is not null and inv_delta <> 'null'""")
print(c.sql("""select name, round(sum(case when q<0 then -q end)) out_of_bag, round(sum(case when q>0 then q end)) into_bag, count(*) rows from mv group by 1 order by 2 desc"""))
print(c.sql("""select item, round(sum(-q)) net_banked, round(sum(case when q<0 then -q end)) deposited, round(sum(case when q>0 then q end)) withdrawn
   from mv where name in ('deposit','town_deposit','mats_return','prune_town','withdraw','withdraw_pick','toolkit') group by 1 order by 2 desc limit 25""").fetchall())
print('disposed (dispose_well/compost/wear_out) top items:')
print(c.sql("""select item, round(sum(-q)) gone from mv where name in ('dispose_well','compost','wear_out') and q<0 group by 1 order by 2 desc limit 12""").fetchall())
print('chest-full and bag-full signals (denominator: all executed skill rows)')
print(c.sql("""select stream, count(*) filter (where name not like '\\_%' escape '\\') exec_rows,
  count(*) filter (where fail_class in ('town_storage_full','storage_full')) chest_full_fc,
  count(*) filter (where regexp_matches(lower(detail), 'chests? (in reach |here )?(are|is) full|no container here has room|storage (is )?full|chests full')) chest_full_text,
  count(*) filter (where fail_class='inventory_full') bag_full_fc,
  count(*) filter (where regexp_matches(lower(detail), 'inventory (is )?full|bag (is )?full|no free slot|no room in (the )?(bag|inventory)')) bag_full_text,
  count(*) filter (where name='_work_order' and detail like '%slots used%') bagfull_orders
  from k group by 1"""))
c.execute("""create temp table bf as select stream, bot, ts from k where fail_class='inventory_full'
  or regexp_matches(lower(detail), 'inventory (is )?full|bag (is )?full|no free slot|no room in (the )?(bag|inventory)')""")
print('bag-full episodes (same bot, signals <10 min apart merged):')
print(c.sql("""with g as (select *, case when lag(ts) over (partition by stream,bot order by ts) is null or ts - lag(ts) over (partition by stream,bot order by ts) > interval 10 minute then 1 else 0 end s from bf),
  e as (select stream, bot, sum(s) over (partition by stream,bot order by ts) eid, ts from g),
  ep as (select stream, bot, eid, count(*) sig, epoch(max(ts)-min(ts))/60 mins from e group by 1,2,3)
  select stream, count(*) episodes, count(distinct bot) bots, round(avg(sig),1) mean_signals, round(quantile_cont(mins,0.5),1) p50_min,
  round(quantile_cont(mins,0.9),1) p90_min, round(sum(mins)/60) total_hours from ep group by 1"""))
print('chest-full by month:')
print(c.sql("""select strftime(ts,'%Y-%m') m, count(*) filter (where fail_class in ('town_storage_full','storage_full') or regexp_matches(lower(detail), 'chests? (in reach |here )?(are|is) full|no container here has room|storage (is )?full')) chest_full,
  count(*) filter (where fail_class='inventory_full') bag_full, count(*) filter (where name in ('deposit','town_deposit')) deposit_rows from k group by 1 order by 1""").fetchall())
print('deposit gate rejections in the decision table, by month (denominator: all decisions / deposit decisions):')
print(c.sql("""select strftime(cast(ts as timestamp),'%Y-%m') m, count(*) decisions, count(*) filter (where skill='deposit') deposit_dec,
  count(*) filter (where gate_error='deposit_nothing_to_bank') nothing_to_bank, count(*) filter (where gate_error='deposit_not_worth_it') not_worth,
  count(*) filter (where gate_error='deposit_item_missing') item_missing
  from read_parquet('/home/mike/mcai/parquet/decisions/*.parquet', union_by_name=true) where day<>'2026-10-07' group by 1 order by 1""").fetchall())
