# 3-time-accounting, step 4: tables for the report (markdown to stdout). Inputs: ~/mcai/parquet/ta3x/*.parquet.
import duckdb, os
X = os.path.expanduser('~/mcai/parquet/ta3x')
con = duckdb.connect(); con.execute("SET threads=3")
C = ['productive', 'travel', 'llm_wait', 'failed_nav', 'failed_interrupted', 'failed_other', 'stuck_escape', 'noop',
     'paused', 'dead', 'between', 'idle', 'offline']
con.execute(f"""CREATE VIEW bd AS SELECT *, substr(date,1,7) AS mon,
   CASE WHEN world='show' THEN 'showcase' ELSE coalesce(arm, split_part(pool,'-',1)) END grp,
   {'+'.join(C)} AS online_plus_offline, {'+'.join(c for c in C if c != 'offline')} AS observed FROM '{X}/botday.parquet'""")

def md(sql, pct_of=None):
    df = con.sql(sql).df()
    cols = list(df.columns)
    out = ['| ' + ' | '.join(cols) + ' |', '|' + '---|' * len(cols)]
    for r in df.itertuples(index=False):
        out.append('| ' + ' | '.join(f'{v:,.1f}' if isinstance(v, float) else str(v) for v in r) + ' |')
    print('\n'.join(out) + '\n')

def shares(group):
    sel = ', '.join(f"round(100*sum({c})/sum(observed),1) AS {c}" for c in C if c != 'offline')
    md(f"""SELECT {group}, round(sum(observed)/3600) obs_bot_h, round(100*sum(offline)/sum(online_plus_offline),1) offline_pct_of_up, {sel}
           FROM bd GROUP BY ALL ORDER BY ALL""")

print('## A. shares of OBSERVED bot-time by world (absent >=6h excluded; offline 10min-6h shown as % of observed+offline)')
shares('world')
print('## B. by world x month'); shares('world, mon')
print('## C. by world x arm/pool group'); shares('world, grp')
print('## C2. absent/offline totals')
md("SELECT world, round(sum(absent)/3600) absent_h, round(sum(offline)/3600) offline_h, round(sum(observed)/3600) observed_h, count(DISTINCT bot) bots, count(*) bot_days FROM bd GROUP BY 1")

# productivity
con.execute(f"""CREATE VIEW sk AS SELECT *, substr(strftime(to_timestamp(t0),'%Y-%m'),1,7) AS mon,
  CASE WHEN world='show' THEN 'showcase' ELSE coalesce(arm, split_part(pool,'-',1)) END grp FROM '{X}/skills.parquet'""")
con.execute("""CREATE VIEW prod AS SELECT world, mon, grp,
   sum(gain) FILTER (WHERE name IN ('gather','mine','deep_mine')) items_gathered,
   sum(gain) FILTER (WHERE name IN ('gather','mine','deep_mine') AND cls='productive') items_gathered_in_productive,
   sum(loss) FILTER (WHERE name LIKE 'build%' OR name='place') blocks_placed,
   count(*) FILTER (WHERE name='place' AND status='success') place_ok,
   sum(gain) FILTER (WHERE name IN ('craft','make_material','toolkit')) crafted_items,
   sum(gain) FILTER (WHERE name IN ('smelt','smelt_town','furnace_drain')) smelted_items,
   sum(loss) FILTER (WHERE name IN ('deposit','town_deposit','dispose_well')) deposited_items
   FROM sk GROUP BY ALL""")
con.execute("CREATE VIEW hrs AS SELECT world, mon, grp, sum(observed)/3600 h FROM bd GROUP BY ALL")
for g, title in [('world', 'D. productivity per OBSERVED bot-hour by world'), ('world, mon', 'E. by world x month'),
                 ('world, grp', 'F. by world x group')]:
    print('## ' + title)
    md(f"""WITH p AS (SELECT {g}, sum(items_gathered) ig, sum(items_gathered_in_productive) igp, sum(blocks_placed) bp, sum(place_ok) po,
                 sum(crafted_items) ci, sum(smelted_items) si, sum(deposited_items) di FROM prod GROUP BY ALL),
             h AS (SELECT {g}, sum(h) h FROM hrs GROUP BY ALL)
           SELECT {g}, round(h) obs_bot_h, round(ig/h,1) gathered_per_h, round(igp/h,1) gathered_prod_per_h, round(bp/h,1) blocks_placed_per_h,
                  round(ci/h,1) crafted_per_h, round(si/h,1) smelted_per_h, round(di/h,1) deposited_per_h
           FROM p JOIN h USING ({g}) ORDER BY ALL""")

print('## G. failures: navigation share (real skill rows; count and RAW duration hours, before the sweep)')
md("""SELECT world, cls, count(*) n, round(sum(d)/3600) raw_h, round(100*count(*)/sum(count(*)) OVER (PARTITION BY world),1) pct_n,
      round(100*sum(d)/sum(sum(d)) OVER (PARTITION BY world),1) pct_h
      FROM sk WHERE cls LIKE 'failed%' GROUP BY 1, 2 ORDER BY 1,2""")
print('## G2. top failure classes (all non-success real skills incl. stuck_escape-trigger rows), by raw hours')
md("""SELECT world, coalesce(fail_class, '(none:'||status||')') fail_class, count(*) n, round(sum(d)/3600) raw_h FROM sk
      WHERE status <> 'success' GROUP BY 1, 2 QUALIFY row_number() OVER (PARTITION BY world ORDER BY sum(d) DESC) <= 18 ORDER BY 1, 4 DESC""")
print('## G3. interrupted skills: which reflex cut them (trigger interrupt:X), raw hours')
md("""SELECT world, trig, count(*) n, round(sum(d)/3600) raw_h, round(sum(gain)) gain_kept FROM sk WHERE trig LIKE 'interrupt:%'
      GROUP BY 1, 2 QUALIFY row_number() OVER (PARTITION BY world ORDER BY sum(d) DESC) <= 8 ORDER BY 1, 4 DESC""")
print('## G4. stuck_escape rows: trigger, raw hours, and items gained while escaping')
md("""SELECT world, trig, count(*) n, round(sum(d)/3600) raw_h, round(sum(gain)) gain FROM sk WHERE cls='stuck_escape'
      GROUP BY 1, 2 QUALIFY row_number() OVER (PARTITION BY world ORDER BY sum(d) DESC) <= 10 ORDER BY 1, 4 DESC""")
print('## H. nav/stuck point events per observed bot-hour')
md(f"""WITH e AS (SELECT world, name, sum(n) n FROM '{X}/events.parquet' WHERE name IN ('_path_noPath','_path_timeout','_path_no_legal_move',
       '_entombed','_stagnation','_watchdog_rescue','_marooned','_stranded_underground','_livelock_escape','_death','_loop_restart','_pathfinder_wedged',
       '_path_reset','_affordance_scan') GROUP BY ALL), h AS (SELECT world, sum(observed)/3600 h FROM bd GROUP BY 1)
      SELECT world, name, n, round(n/h,2) per_bot_h FROM e JOIN h USING (world) ORDER BY 1, 3 DESC""")
print('## I. double counting: raw interval hours vs swept (each second once)')
md(f"""WITH r AS (SELECT world, cls, sum(d)/3600 raw_h FROM sk GROUP BY ALL
          UNION ALL SELECT world, 'llm_wait', sum(lat)/3600 FROM '{X}/llm.parquet' GROUP BY ALL),
      s AS (UNPIVOT (SELECT world, {', '.join(f'sum({c})/3600 AS {c}' for c in C)} FROM bd GROUP BY 1) ON {', '.join(C)} INTO NAME cls VALUE swept_h)
      SELECT world, cls, round(raw_h) raw_h, round(swept_h) swept_h, round(100*(1-swept_h/raw_h),1) pct_removed
      FROM r JOIN s USING (world, cls) ORDER BY 1, 3 DESC""")
print('## J. model calls: latency and decision outcome (intent rows; not used as outcomes)')
md(f"""SELECT world, count(*) calls, round(median(lat),2) med_s, round(quantile_cont(lat,.9),2) p90_s, round(sum(lat)/3600) raw_h,
      round(100*avg((status='success')::int),1) pct_status_success FROM '{X}/llm.parquet' GROUP BY 1""")
