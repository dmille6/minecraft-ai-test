#!/usr/bin/env python3
"""Rejection-loop analysis, step 3 (raw sample from rl_raw_extract.py). Read-only.
Same-args repeats after a rejection, and whether the next prompt carried the rejection reason.
"""
import duckdb
c = duckdb.connect(); c.execute("set threads=3")
def q(title, sql):
    print(f'\n### {title}'); r = c.execute(sql); print(' | '.join(d[0] for d in r.description))
    for row in r.fetchall(): print(' | '.join('' if v is None else (f'{v:.4g}' if isinstance(v, float) else str(v)) for v in row))
c.execute("""create temp table r as
with b as (select *, cast(ts as timestamp) t,
  case when err like 'all % llm endpoint%' then 'infra' when err is not null then 'rej'
       when ostatus in ('failed','no_effect') then 'fail' when ostatus='aborted' then 'cab'
       when ostatus='success' then 'ok' else 'unk' end k
  from read_parquet('/home/mike/rl/raw_sample.parquet') where bot is not null)
select *, lead(t) over w nt, lead(skill) over w nskill, lead(args_hash) over w nargs, lead(err) over w nerr,
  lead(k) over w nk, lead(la_rejected) over w nla_rej, lead(la_text) over w nla_text,
  lead(n_rejected_recent) over w nrecent
from b window w as (partition by src, bot order by t, id)""")
c.execute("delete from r where nt is null or nt - t > interval 10 minute")
q('Sample size', "select src, count(*) n, count(distinct bot) bots, sum((k='rej')::int) rej from r group by 1")
q('After decision class k: P(same skill), P(same skill AND same args)', """
select k, count(*) n, round(avg((nskill=skill)::int),3) p_same_skill,
  round(avg((nskill=skill and nargs=args_hash)::int),3) p_same_skill_args from r group by 1 order by n desc""")
q('After a rejection, by gate: same skill, same skill+args, same gate again', """
select err, count(*) n, round(avg((nskill=skill)::int),3) p_same_skill,
  round(avg((nskill=skill and nargs=args_hash)::int),3) p_same_args,
  round(avg((nerr=err)::int),3) p_same_gate,
  round(avg((nskill=skill and nargs=args_hash and nerr=err)::int),3) p_exact_repeat_rejected_again
from r where k='rej' group by 1 order by n desc limit 12""")
q('Did the NEXT prompt carry the rejection? (LAST ACTION line)', """
select k, count(*) n, round(avg(nla_rej::int),3) p_next_last_action_says_rejected,
  round(avg((nla_text like '%' || coalesce(err,'@@') || '%')::int),3) p_next_names_gate,
  round(avg(nrecent),2) mean_rejected_lines_in_recent_events
from r group by 1 order by n desc""")
q('After a rejection, P(exact repeat) when the next prompt shows it vs not', """
select nla_rej, count(*) n, round(avg((nskill=skill and nargs=args_hash)::int),3) p_exact_repeat
from r where k='rej' group by 1""")
q('Exact-repeat probability vs how many rejected lines the next prompt already shows', """
select least(nrecent,12) recent_rejected_lines, count(*) n, round(avg((nskill=skill and nargs=args_hash)::int),3) p_exact_repeat,
  round(avg((nskill=skill)::int),3) p_same_skill
from r where k='rej' group by 1 order by 1""")
q('Example LAST ACTION texts after a rejection (top 12)', """
select nla_text, count(*) n from r where k='rej' group by 1 order by n desc limit 12""")
