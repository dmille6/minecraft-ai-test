#!/usr/bin/env python3
"""Analysis 7 (deaths and danger), step 2: all tables for the report.
Run on 10.0.0.45 after 7_extract_slim.py: nice -n 10 ~/venv/bin/python 7_deaths.py > 7_deaths.out"""
import duckdb, os
H = os.path.expanduser('~/mcai')
c = duckdb.connect(); c.sql("set threads=3"); c.sql("set memory_limit='12GB'")
def P(title, q, n=60):
  try:
    r = c.sql(q); print(f'\n## {title}'); print(' | '.join(r.columns))
    for row in r.limit(n).fetchall(): print(' | '.join('' if v is None else str(v) for v in row))
    print(flush=True)
  except Exception as e: print(f'\n## {title}\nQUERY ERROR {e}', flush=True)
c.sql(f"create view ev as select * from read_parquet('{H}/work7/slim/*.parquet') where ts >= '2026-08-05' and ts::date <> '2026-10-07' and bot is not null")
# ---------- positive controls / totals
P('totals by source', "select src, count(*) rows, count(distinct bot) bots, min(ts), max(ts) from ev group by 1")
P('death-ish event names (positive control for the death query)',
  r"""select name, trig, count(*) n from ev where regexp_matches(lower(name),'death|drown|respawn|lava|fall|entomb|suffoc|air|escape|reflex|starv|hurt|health|rescue|fire|burn|mob|combat|flee|hostile|attack') group by all order by n desc""", 120)
# ---------- denominator
c.sql("""create table bh as select src, bot, any_value(pool) pool, date_trunc('hour', ts) h, count(*) n,
         count(distinct date_trunc('minute', ts)) mins from ev group by src, bot, h""")
P('bot-hour denominator', "select src, count(*) bot_hours_any_event, round(sum(mins)/60.0,0) active_minute_hours, sum(n) events from bh group by 1")
# ---------- deaths
c.sql(r"""create table d as select *, row_number() over (order by ts) did,
  lower(regexp_extract(detail, '^([^;|]*)', 1)) msg,
  regexp_extract(detail, 'was running ([a-zA-Z_]+)', 1) running,
  try_cast(regexp_extract(detail, 'hp ([0-9.]+)->', 1) as double) hp_from,
  try_cast(regexp_extract(detail, 'over ([0-9]+)s', 1) as int) hp_secs
  from ev where name = '_death'""")
P('raw _death rows + duplicate check', """select count(*) rows, count(distinct id) distinct_ids,
  count(distinct (bot, ts)) distinct_bot_ts,
  sum(case when gap_s < 10 then 1 else 0 end) within_10s_same_bot,
  sum(case when gap_s < 60 then 1 else 0 end) within_60s_same_bot
  from (select *, epoch(ts - lag(ts) over (partition by bot order by ts)) gap_s from d)""")
c.sql("""create table dd as select * from (select *, epoch(ts - lag(ts) over (partition by bot order by ts)) gap_s from d)
         where gap_s is null or gap_s >= 10""")  # dedupe: same bot within 10 s = one death
P('respawn events vs deaths', "select name, count(*) from ev where lower(name) like '%respawn%' or name='_death' group by 1")
c.sql(r"""create table dc as select *, case
  when msg like '%drown%' then 'drowning'
  when msg like '%lava%' or msg like '%burn%' or msg like '%fire%' or msg like '%flame%' then 'lava/fire'
  when msg like '%suffocat%' or msg like '%wall%' or msg like '%squash%' then 'suffocation'
  when msg like '%fell%' or msg like '%fall%' or msg like '%hit the ground%' or msg like '%impaled%' or msg like '%doomed%' then 'fall'
  when msg like '%slain%' or msg like '%shot%' or msg like '%blown%' or msg like '%killed by%' or msg like '%stung%' or msg like '%fireball%' then 'mob/entity'
  when msg like '%starv%' then 'starvation'
  when msg like '%cactus%' or msg like '%prick%' or msg like '%berry%' then 'cactus/berry'
  else 'other/unknown' end cause,
  case when y < 0 then 'a <0' when y < 40 then 'b 0-39' when y < 56 then 'c 40-55' when y < 63 then 'd 56-62'
       when y < 80 then 'e 63-79' when y < 120 then 'f 80-119' else 'g 120+' end yband
  from dd""")
P('deaths and rate by source', """select dc.src, count(*) deaths, b.bh bot_hours, round(1000.0*count(*)/b.bh,2) per_1000_bh
  from dc join (select src, count(*) bh from bh group by 1) b using (src) group by dc.src, b.bh""")
P('by cause', """select cause, src, n, round(100.0*n/sum(n) over (partition by src),1) pct from (select cause, src, count(*) n from dc group by all) order by src, n desc""")
P('fail_class vs cause', "select fc, cause, count(*) n from dc group by all order by n desc", 40)
P('top raw death messages', "select regexp_replace(msg,'[0-9]+','N','g') m, count(*) n from dc group by 1 order by n desc", 40)
P('mob deaths detail', "select ts, src, bot, msg from dc where cause='mob/entity' order by ts", 50)
P('by month x source', """select strftime(d.ts,'%Y-%m') mo, d.src, count(*) deaths, any_value(b.bh) bh, round(1000.0*count(*)/any_value(b.bh),2) per_1000_bh,
  sum((cause='drowning')::int) drown, sum((cause='fall')::int) fall, sum((cause='lava/fire')::int) lava,
  sum((cause='suffocation')::int) suff, sum((cause='mob/entity')::int) mob, sum((cause='other/unknown')::int) oth
  from dc d join (select src, strftime(h,'%Y-%m') mo, count(*) bh from bh group by all) b on b.src=d.src and b.mo=strftime(d.ts,'%Y-%m') group by all order by 2,1""")
P('by week (rate)', """select date_trunc('week', b.h) wk, b.src, count(distinct (b.bot,b.h)) bh, count(d.did) deaths,
  round(1000.0*count(d.did)/count(distinct (b.bot,b.h)),2) per_1000_bh from bh b left join dc d on d.bot=b.bot and date_trunc('hour',d.ts)=b.h group by all order by 2,1""", 40)
P('by code version (top 25 by bot-hours)', """with v as (select bot, date_trunc('hour',ts) h, any_value(ver) ver from ev group by all),
  vb as (select ver, count(*) bh from v group by 1)
  select vb.ver, vb.bh, count(dc.did) deaths, round(1000.0*count(dc.did)/vb.bh,2) per_1000_bh,
  min(v2.mn) first_seen from vb left join dc on dc.ver=vb.ver
  left join (select ver, min(ts)::date mn from ev group by 1) v2 on v2.ver=vb.ver group by vb.ver, vb.bh order by vb.bh desc""", 25)
P('by pool family (top 30 by bot-hours)', r"""with p as (select regexp_replace(coalesce(pool,'(none)'),'-[a-z]$|-[A-Z][a-z]+$','') fam, src, count(*) bh from bh group by all)
  select p.fam, p.src, p.bh, count(dc.did) deaths, round(1000.0*count(dc.did)/p.bh,2) per_1000_bh from p left join dc
  on regexp_replace(coalesce(dc.pool,'(none)'),'-[a-z]$|-[A-Z][a-z]+$','')=p.fam and dc.src=p.src group by p.fam, p.src, p.bh order by p.bh desc""", 30)
P('by y band x cause', "select yband, count(*) n, sum((cause='drowning')::int) drown, sum((cause='fall')::int) fall, sum((cause='lava/fire')::int) lava, sum((cause='suffocation')::int) suff, sum((cause not in ('drowning','fall','lava/fire','suffocation'))::int) oth from dc group by 1 order by 1")
P('time-at-y denominator (bot-hours by y band of events) and rate', """with t as (select case when y < 0 then 'a <0' when y < 40 then 'b 0-39' when y < 56 then 'c 40-55' when y < 63 then 'd 56-62'
       when y < 80 then 'e 63-79' when y < 120 then 'f 80-119' else 'g 120+' end yband, count(*) n from ev where y is not null and dim='overworld' group by 1)
  select t.yband, round(100.0*t.n/sum(t.n) over (),1) pct_of_events, count(dc.did) deaths, round(100.0*count(dc.did)/(select count(*) from dc),1) pct_deaths
  from t left join dc on dc.yband=t.yband group by t.yband, t.n order by 1""")
P('dimension', "select dim, count(*) from dc group by 1")
P('skill running at death', "select coalesce(nullif(running,''), case when detail like '%idle at the moment%' then '(idle)' else '(?)' end) running, count(*) n, sum((cause='drowning')::int) drown, sum((cause='fall')::int) fall, sum((cause='lava/fire')::int) lava, sum((cause='suffocation')::int) suff from dc group by 1 order by n desc", 25)
P('damage window (hp from -> 0 over s)', """select cause, count(*) n, round(median(hp_from),1) med_hp_from, median(hp_secs) med_secs,
  sum((hp_secs <= 5)::int) under_5s, sum((hp_secs > 60)::int) over_60s from dc group by 1 order by n desc""")
P('hunger at death', "select cause, round(avg(hunger),1) avg_hunger, sum((hunger<=6)::int) hunger_le6, count(*) n from dc group by 1")
# ---------- preceding events (2 min)
c.sql("""create table pre as select dc.did, dc.cause, e.name, e.trig, e.status, e.ts, e.health, epoch(dc.ts - e.ts) before_s
  from dc join ev e on e.bot = dc.bot and e.ts < dc.ts and e.ts >= dc.ts - interval 2 minute and e.name <> '_death'""")
P('deaths with any event in the 2 min before', "select count(distinct did) with_events, (select count(*) from dc) deaths from pre")
P('most common preceding event names (share of deaths with >=1 in 2 min)', """select name, count(distinct did) deaths_with, round(100.0*count(distinct did)/(select count(*) from dc),1) pct_deaths, count(*) rows from pre group by 1 order by 2 desc""", 45)
c.sql(r"""create table refl as select did, cause,
  max((regexp_matches(name,'drown|_air|water_no_air|breath'))::int) air_reflex,
  max((regexp_matches(name,'escape|entomb|stranded|livelock'))::int) escape_reflex,
  max((regexp_matches(name,'lava|danger_block|fire'))::int) lava_reflex,
  max((name like '_reflex_low_health%' or name like '%low_health%'))::int lowhp_reflex,
  max((trig='reflex')::int) any_reflex_trigger
  from pre group by all""")
P('reflexes fired in 2 min before death, by cause', """select dc.cause, count(*) deaths, sum(coalesce(air_reflex,0)) air, sum(coalesce(escape_reflex,0)) esc,
  sum(coalesce(lava_reflex,0)) lava_r, sum(coalesce(lowhp_reflex,0)) lowhp, sum(coalesce(any_reflex_trigger,0)) any_trig_reflex
  from dc left join refl using (did) group by 1 order by 2 desc""")
P('trigger values (positive control for trig=reflex)', "select trig, count(*) from ev group by 1 order by 2 desc", 20)
# ---------- time since last LLM decision
c.sql(f"create view dec as select bot, try_cast(ts as timestamp) ts, pool from read_parquet('{H}/parquet/decisions/*.parquet', union_by_name=true)")
P('decisions positive control', "select count(*), min(ts), max(ts), count(distinct bot) from dec")
c.sql("""create table lastdec as select dc.did, dc.cause, dc.src, epoch(any_value(dc.ts) - max(dec.ts)) since_s from dc left join dec on dec.bot=dc.bot
  and dec.ts <= dc.ts and dec.ts > dc.ts - interval 6 hour group by dc.did, dc.cause, dc.src""")
P('time since last LLM decision', """select src, cause, count(*) n, count(since_s) with_dec_6h, median(since_s) med_s, quantile_cont(since_s,0.9) p90_s from lastdec group by all order by n desc""")
# decision-side water/lava context at last decision
c.sql(f"create view decf as select bot, try_cast(ts as timestamp) ts, lava, water, y from read_parquet('{H}/parquet/decisions/*.parquet', union_by_name=true)")
P('water/lava visible at the last decision within 10 min', """with x as (select dc.did, dc.cause, arg_max(f.water, f.ts) water, arg_max(f.lava, f.ts) lava from dc join decf f on f.bot=dc.bot and f.ts<=dc.ts and f.ts > dc.ts - interval 10 minute group by dc.did, dc.cause)
  select cause, count(*) n_with_dec, sum((water>0)::int) water_seen, sum((lava>0)::int) lava_seen from x group by 1 order by 2 desc""")
# ---------- items lost
c.sql(r"""create table inv as select did, cause, src, k.key item, try_cast(k.value as int) n from dc, json_each(dc.inv) k where inv is not null""")
P('items lost: totals', "select count(distinct did) deaths_with_inv, sum(n) items, round(sum(n)/count(distinct did),0) per_death, median_items from inv, (select median(s) median_items from (select sum(n) s from inv group by did)) group by median_items")
P('items lost: top kinds', "select item, sum(n) n, count(distinct did) deaths from inv group by 1 order by 2 desc", 25)
P('items lost: valuable', r"""select item, sum(n) n, count(distinct did) deaths from inv where regexp_matches(item,'diamond|iron|_pickaxe|_sword|_axe|_shovel|bucket|chest|gold|emerald|torch|bed|armor|helmet|chestplate') group by 1 order by 2 desc""", 30)
# ---------- scenarios
P('top scenarios (cause x running x y band)', "select cause, coalesce(nullif(running,''),'(idle/?)') running, yband, count(*) n from dc group by all order by n desc", 25)
P('per-bot concentration', "select bot, src, count(*) deaths from dc group by all order by 3 desc", 15)
P('deaths: how many bots ever died / repeated same place (within 8 blocks, 24h)', """select count(*) repeat_site from (select a.did from dc a join dc b on a.bot=b.bot and b.ts<a.ts and b.ts>a.ts - interval 1 day
  and abs(a.x-b.x)<8 and abs(a.z-b.z)<8 and abs(a.y-b.y)<8 group by a.did)""")
# ---------- near misses
c.sql("""create table hp as select src, bot, ts, health, lag(health) over (partition by bot order by ts) ph, lag(ts) over (partition by bot order by ts) pts from ev where health is not null""")
P('low-health episodes (health crosses <=6 from >6) and their outcome within 5 min', """with ep as (select src, bot, ts from hp where health <= 6 and ph > 6 and ts - pts < interval 2 minute)
  , j as (select ep.src, ep.bot, ep.ts, count(dc.did) k from ep left join dc on dc.bot=ep.bot and dc.ts>=ep.ts and dc.ts<ep.ts+interval 5 minute group by all)
  select src, count(*) episodes, sum((k>0)::int) died_5min, round(100.0*sum((k>0)::int)/count(*),1) pct_died from j group by 1""")
P('health-drop episodes >=4 hp within 2 events', """select src, count(*) drops, sum((health<=0)::int) to_zero from hp where ph - health >= 4 and ts-pts < interval 30 second group by 1""")
P('near-miss / rescue event rates per 1000 bot-hours', r"""with n as (select src, name, count(*) k from ev where regexp_matches(name,'^_(drowning|air|water_no_air|entombed|escape|reflex|stranded|descent_escape|livelock|lava|fire)') group by all)
  select n.src, name, k, round(1000.0*k/b.bh,1) per_1000_bh from n join (select src, count(*) bh from bh group by 1) b using (src) order by n.src, k desc""", 70)
P('drowning: rescues completed vs deaths', r"""select src, sum((name='_drowning_to_air')::int) to_air, sum((name='_drowning_breathing')::int) breathing,
  sum((name='_water_no_air_route')::int) no_route, sum((name='_drowning_ceiling_no_air')::int) ceiling_no_air from ev group by 1""")
P('difficulty / hostile mentions in details (positive control: count rows mentioning zombie|skeleton|creeper|spider)',
  r"""select src, count(*) from ev where regexp_matches(lower(detail),'zombie|skeleton|creeper|spider|hostile|difficulty') group by 1""")
P('sample hostile-mention rows', r"""select ts, src, name, left(detail,160) d from ev where regexp_matches(lower(detail),'zombie|skeleton|creeper|hostile|difficulty') using sample 15""")
