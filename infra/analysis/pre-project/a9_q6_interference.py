"""a9 Q6: bot-on-bot interference. World key = stream + pool (bot name minus its last -Name part).
(a) explicit contention texts; (b) same exact target (args x,y,z or 'chest at X,Y,Z') by >=2 bots
in the same minute; (c) crowding: distinct bots working (gather/mine/place/deep_mine/build_shop)
in the same 8x8x8 cell in the same minute, and the failure rate by crowd size within skill."""
import duckdb, os
G = os.environ.get('SKILLGLOB', '/home/mike/mcai9/skill/*.parquet')
c = duckdb.connect(); c.execute("set threads=8; set memory_limit='10GB'")
c.execute(f"""create view k as select *, stream||':'||regexp_replace(bot,'-[^-]+$','') w, date_trunc('minute', ts) mi
   from read_parquet('{G}', union_by_name=true)""")
CT = r"another bot|other bot|claimed by|reserved by|in use by|someone else|one at a time|another bot.s"
print(c.sql(f"""select stream, count(*) filter (where name not like '\\_%' escape '\\') exec_rows,
  count(*) filter (where regexp_matches(lower(detail), '{CT}')) contention_rows from k group by 1"""))
print(c.sql(f"""select name, left(regexp_replace(detail,'-?[0-9]+','N','g'),90) d, count(*) n from k where regexp_matches(lower(detail), '{CT}')
  group by 1,2 order by 3 desc limit 15""").fetchall())
c.execute("""create temp table tg as select w, mi, bot, name, status,
  coalesce(nullif(regexp_extract(args,'"x":(-?[0-9.]+)',1)||','||regexp_extract(args,'"y":(-?[0-9.]+)',1)||','||regexp_extract(args,'"z":(-?[0-9.]+)',1),',,'),
           regexp_extract(detail,'chest at (-?[0-9]+,-?[0-9]+,-?[0-9]+)',1)) tgt
  from k where name not like '\\_%' escape '\\' and args is not null""")
c.execute("delete from tg where tgt is null or tgt=''")
print('(b) exact-target rows; groups (world,target,minute) by number of distinct bots:')
print(c.sql("""with g as (select w,tgt,mi, count(distinct bot) nb, count(*) n, avg((status='success')::int) s from tg group by 1,2,3)
  select least(nb,3) bots, count(*) groups, sum(n) rows, round(100*sum(s*n)/sum(n),1) succ_pct from g group by 1 order by 1"""))
print(c.sql("""with g as (select w,tgt,mi, count(distinct bot) nb from tg group by 1,2,3)
  select t.name, count(*) rows, count(*) filter (where nb>=2) shared_rows, round(100*avg((t.status='success')::int) filter (where nb=1),1) solo_succ,
  round(100*avg((t.status='success')::int) filter (where nb>=2),1) shared_succ
  from tg t join g using(w,tgt,mi) group by 1 having count(*)>=5000 order by shared_rows desc""").fetchall())
c.execute("""create temp table wk as select w, mi, bot, name, status, floor(x/8) cx, floor(y/8) cy, floor(z/8) cz from k
  where name in ('gather','mine','place','deep_mine','build_shop','deposit','town_deposit','withdraw') and x is not null""")
print('(c) crowding (same world, 8-block cell, minute) -> success rate by crowd size, per skill')
print(c.sql("""with g as (select w,mi,cx,cy,cz, count(distinct bot) nb from wk group by all)
  select name, least(nb,4) crowd, count(*) rows, round(100*avg((status='success')::int),1) succ, round(100*avg((status='failed')::int),1) fail
  from wk join g using(w,mi,cx,cy,cz) group by 1,2 order by 1,2""").fetchall())
print('workboard: issued jobs vs yields with no job (denominator: _workboard rows)')
print(c.sql("""select stream, count(*) n, count(*) filter (where detail like 'op=issue%') issue, count(*) filter (where detail like 'op=yield%') yield,
  count(*) filter (where detail like '%starved=0%') starved0 from k where name='_workboard' group by 1"""))
