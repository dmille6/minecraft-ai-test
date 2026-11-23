#!/usr/bin/env python3
"""Analysis 7 follow-ups: what hostile mentions are; showcase reflex rates; drowning surface-adjacent share."""
import duckdb, os
H = os.path.expanduser('~/mcai'); c = duckdb.connect(); c.sql("set threads=3")
c.sql(f"create view ev as select * from read_parquet('{H}/work7/slim/*.parquet') where ts >= '2026-08-05' and ts::date <> '2026-10-07' and bot is not null")
def P(t,q):
    r=c.sql(q); print('\n##',t); print(' | '.join(r.columns))
    for row in r.fetchall(): print(' | '.join(str(v) for v in row))
P('hostile-mention rows by event name', r"select src, name, count(*) n, any_value(left(detail,200)) ex from ev where regexp_matches(lower(detail),'zombie|skeleton|creeper|spider|hostile|difficulty') group by all order by n desc limit 15")
P('showcase danger reflex rates', r"select name, count(*) n, round(1000.0*count(*)/8011,1) per_1000_bh from ev where src='showcase' and regexp_matches(name,'^_(drowning|air|lava|reflex|entombed|escape|stranded)') group by 1 order by 2 desc limit 25")
P('drowning deaths: detail fragments', r"select regexp_extract(detail,'leading up: ([^|]*)',1) lu, count(*) n from ev where name='_death' and skill.fail_class='drowning' group by 1 order by 2 desc limit 1") if False else None
