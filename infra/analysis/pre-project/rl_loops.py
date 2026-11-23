#!/usr/bin/env python3
"""Rejection-loop anatomy, step 2 (all 15.6M decisions, feature parquet). Read-only.

Run on the analysis VM: nice -n 10 ~/venv/bin/python rl_loops.py > rl_loops.out
Definitions (per bot, ordered by ts, id; a SESSION BREAK is a run change or a gap > 10 min):
  rej   = gate_error set and not an LLM-endpoint failure (the admission gate refused the model's choice)
  infra = gate_error is an LLM-endpoint failure ("all N llm endpoint(s) failed")
  fail  = admitted, outcome failed / no_effect
  cab   = admitted, outcome aborted (controller reflex interrupted it: entombed, stuck, stagnation...)
  ok    = admitted, outcome success
A REJECTION RUN = maximal stretch of consecutive rej decisions of one bot inside one session.
A SAME-SKILL RUN = maximal stretch of consecutive rej decisions with the same skill.
A TROUBLE RUN = maximal stretch of consecutive rej-or-fail decisions with the same skill.
Cost of a run = decisions in it, and wall time from its first decision to the decision that breaks it
(or to its last decision when a session break ends it).
"""
import duckdb, os
c = duckdb.connect()
c.execute("set threads=8; set memory_limit='14GB'; set preserve_insertion_order=false")
P = os.path.expanduser('~/mcai/parquet/decisions/*.parquet')

def q(title, sql):
    print(f'\n### {title}')
    r = c.execute(sql)
    names = [d[0] for d in r.description]
    print(' | '.join(names))
    for row in r.fetchall():
        print(' | '.join('' if v is None else (f'{v:.4g}' if isinstance(v, float) else str(v)) for v in row))

c.execute(f"""
create temp table s as
with b as (
  select id, bot, run, world, model, trigger, skill, status, gate_error, fail_detail_head, day,
         substr(day,1,7) as month, cast(ts as timestamp) as t, y, health, water, lava, has_pick,
         case when gate_error like 'all % llm endpoint%' then 'infra'
              when gate_error is not null then 'rej'
              when status in ('failed','no_effect') then 'fail'
              when status = 'aborted' then 'cab'
              when status = 'success' then 'ok' else 'unk' end as k
  from read_parquet('{P}', union_by_name=true) where bot is not null and ts is not null)
select *,
  lag(t) over w as pt, lag(run) over w as prun,
  lead(t) over w as nt, lead(run) over w as nrun, lead(k) over w as nk, lead(skill) over w as nskill,
  lead(trigger) over w as ntrigger, lead(gate_error) over w as ngate, lead(status) over w as nstatus
from b window w as (partition by bot order by t, id)
""")
c.execute("""
create temp table s2 as select *,
  (pt is null or prun is distinct from run or t - pt > interval 10 minute) as sbreak_before,
  (nt is null or nrun is distinct from run or nt - t > interval 10 minute) as sbreak_after
from s""")
c.execute("create temp table s3 as select *, sum(sbreak_before::int) over (partition by bot order by t, id) as sess from s2")

q('Totals (positive control: every class present)', "select k, count(*) n, round(100.0*count(*)/sum(count(*)) over (),2) pct from s3 group by k order by n desc")
q('Bots, sessions, days', "select count(distinct bot) bots, count(distinct bot||sess) sessions, count(distinct day) n_days, min(t), max(t) from s3")

# ---- Q1 next-decision transition probabilities -----------------------------------------
q('P(next decision same skill) by class of current decision (within session)', """
select k, count(*) n, round(avg((nskill=skill)::int),3) p_same_skill,
  round(avg((nk='rej')::int),3) p_next_rej, round(avg((nk='ok')::int),3) p_next_ok,
  round(avg((nk='rej' and nskill=skill)::int),3) p_next_rej_same_skill
from s3 where not sbreak_after group by k order by n desc""")
q('After a rejection: P(next same skill), P(next rejected again with the same gate) by gate_error', """
select gate_error, count(*) n, round(avg((nskill=skill)::int),3) p_same_skill,
  round(avg((ngate=gate_error)::int),3) p_same_gate_again, round(avg((nk='ok')::int),3) p_next_ok,
  round(avg((ntrigger<>'idle')::int),3) p_next_reflex
from s3 where k='rej' and not sbreak_after group by 1 order by n desc limit 16""")

# ---- runs ----------------------------------------------------------------------------
def runs(name, cond, same_skill):
    key = "bot, sess" + (", skill" if same_skill else "")
    c.execute(f"""
    create temp table {name} as
    with m as (select *, ({cond}) as inrun from s3),
    g as (select *, row_number() over (partition by bot, sess order by t, id)
             - row_number() over (partition by bot, sess, inrun{', skill' if same_skill else ''} order by t, id) as grp
          from m)
    select bot, sess, grp, {'skill' if same_skill else 'arg_max(skill, t) as skill'}, count(*) n,
      count(distinct skill) n_skills,
      arg_min(gate_error, t) first_gate, mode(gate_error) main_gate,
      arg_min(model, t) as model, arg_min(month, t) as "month", arg_min(day, t) as "day", arg_min(world, t) as world,
      arg_min(trigger, t) as "trigger", min(t) t0, max(t) t1,
      arg_max(nt, t) bt, arg_max(nk, t) bk, arg_max(nskill, t) bskill, arg_max(ntrigger, t) btrigger,
      arg_max(sbreak_after::int, t) = 1 as ended_by_break,
      arg_min(y, t) as y, arg_min(water, t) water, arg_min(has_pick, t) has_pick
    from g where inrun group by bot, sess, grp{', skill' if same_skill else ''}""")
    c.execute(f"""alter table {name} add column secs double;
      update {name} set secs = epoch(case when ended_by_break then t1 else bt end) - epoch(t0);
      alter table {name} add column breaker varchar;
      update {name} set breaker = case
        when ended_by_break then 'session break (restart / gap>10m)'
        when btrigger in ('startup','liveness_restart') then 'restart trigger'
        when btrigger <> 'idle' then 'reflex/trigger '
        when bskill = skill and bk = 'ok' then 'same skill admitted -> success'
        when bskill = skill then 'same skill admitted -> ' || bk
        when bk = 'ok' then 'different skill -> success'
        else 'different skill -> ' || bk end""")

runs('rr', "k='rej'", False)
runs('sr', "k='rej'", True)
runs('tr', "k in ('rej','fail')", True)

for name, label in [('rr', 'REJECTION RUNS (any skill)'), ('sr', 'SAME-SKILL REJECTION RUNS'), ('tr', 'SAME-SKILL TROUBLE RUNS (rej or fail)')]:
    q(f'{label}: length distribution', f"""
    select count(*) runs, sum(n) decisions, round(avg(n),2) mean_len,
      quantile_cont(n,0.5) p50, quantile_cont(n,0.9) p90, quantile_cont(n,0.99) p99, max(n) max_len,
      round(avg((n=1)::int),3) frac_len1, round(avg((n>=3)::int),3) frac_ge3, round(avg((n>=5)::int),3) frac_ge5,
      round(avg((n>=10)::int),3) frac_ge10, round(avg((n>=50)::int),4) frac_ge50,
      round(sum(case when n>=5 then n end)*1.0/sum(n),3) share_decisions_in_len_ge5,
      round(quantile_cont(secs,0.5),1) p50_secs, round(quantile_cont(secs,0.9),1) p90_secs,
      round(sum(secs)/3600,0) total_hours
    from {name}""")
    q(f'{label}: length buckets', f"""
    select case when n=1 then '1' when n=2 then '2' when n<=4 then '3-4' when n<=9 then '5-9'
      when n<=19 then '10-19' when n<=49 then '20-49' when n<=199 then '50-199' else '200+' end b,
      count(*) runs, sum(n) decisions, round(sum(secs)/3600,1) n_hours, round(avg(secs),1) mean_secs
    from {name} group by 1 order by min(n)""")
    q(f'{label}: what breaks it', f"""
    select breaker, count(*) runs, round(100.0*count(*)/sum(count(*)) over (),1) pct_runs,
      round(avg(n),2) mean_len, round(100.0*sum(n)/sum(sum(n)) over (),1) pct_decisions
    from {name} group by 1 order by runs desc""")
    q(f'{label}: breaker for runs of length >=5', f"""
    select breaker, count(*) runs, round(100.0*count(*)/sum(count(*)) over (),1) pct
    from {name} where n>=5 group by 1 order by runs desc""")

q('Same-skill runs by first gate_error', """
select first_gate, count(*) runs, sum(n) decisions, round(avg(n),2) mean_len, quantile_cont(n,0.9) p90, max(n) max_len,
  round(avg((n>=5)::int),3) frac_ge5, round(sum(secs)/3600,0) n_hours
from sr group by 1 order by decisions desc limit 14""")
q('Same-skill runs by skill', """
select skill, count(*) runs, sum(n) decisions, round(avg(n),2) mean_len, quantile_cont(n,0.9) p90, max(n) max_len,
  round(avg((n>=5)::int),3) frac_ge5, round(sum(secs)/3600,0) n_hours
from sr group by 1 order by decisions desc limit 14""")
q('Same-skill runs: top skill x gate pairs by decisions', """
select skill, first_gate, count(*) runs, sum(n) decisions, round(avg(n),2) mean_len, max(n) max_len
from sr group by 1,2 order by decisions desc limit 15""")
q('Same-skill runs by model', """
select model, count(*) runs, round(avg(n),2) mean_len, quantile_cont(n,0.9) p90, round(avg((n>=5)::int),3) frac_ge5
from sr group by 1 order by runs desc""")
q('Rejection rate and loop length by model (decision denominators)', """
select model, count(*) decisions, round(avg((k='rej')::int),3) rej_rate,
  round(avg(case when k='rej' and not sbreak_after then (nskill=skill)::int end),3) p_same_after_rej
from s3 group by 1 order by decisions desc""")
q('By month (era)', """
select month, count(*) decisions, round(avg((k='rej')::int),3) rej_rate,
  round(avg(case when k='rej' and not sbreak_after then (nskill=skill)::int end),3) p_same_after_rej,
  round(avg(case when k='rej' and not sbreak_after then (ngate=gate_error)::int end),3) p_same_gate_after_rej
from s3 group by 1 order by 1""")
q('Same-skill runs by month', """
select month, count(*) runs, round(avg(n),2) mean_len, quantile_cont(n,0.9) p90, round(avg((n>=5)::int),3) frac_ge5, round(sum(secs)/3600,0) n_hours
from sr group by 1 order by 1""")
q('Same-skill runs by trigger of first decision', """
select trigger, count(*) runs, round(avg(n),2) mean_len, round(avg((n>=5)::int),3) frac_ge5 from sr group by 1 order by runs desc limit 10""")
q('Same-skill runs by world', """
select world, count(*) runs, round(avg(n),2) mean_len, round(avg((n>=5)::int),3) frac_ge5, round(sum(secs)/3600,0) n_hours from sr group by 1 order by runs desc""")
q('Same-skill runs by situation', """
select case when y is null then '?' when y < 50 then 'underground y<50' else 'surface y>=50' end elev,
  case when water > 0 then 'water nearby' else 'no water' end wat, has_pick,
  count(*) runs, round(avg(n),2) mean_len, round(avg((n>=5)::int),3) frac_ge5
from sr group by all order by runs desc limit 12""")
q('Situation denominators: rejection rate by elevation band (all decisions)', """
select case when y is null then '?' when y < 50 then 'underground y<50' else 'surface y>=50' end elev,
  count(*) decisions, round(avg((k='rej')::int),3) rej_rate from s3 group by 1""")

# ---- controller vs model -------------------------------------------------------------
q('Controller aborts (cab) by detail head: these are reflex interrupts, not model choices', """
select split_part(fail_detail_head,' ',1) det, count(*) n, round(avg(case when not sbreak_after then (nskill=skill)::int end),3) p_same_next
from s3 where k='cab' group by 1 order by n desc limit 10""")

# ---- cost --------------------------------------------------------------------------
c.execute("""create temp table act as select day, bot,
  sum(case when not sbreak_after then epoch(nt)-epoch(t) else 0 end)/3600 bot_hours,
  count(*) decisions, sum((k='rej')::int) rej from s3 group by 1,2""")
c.execute("""create temp table lossd as select day, sum(secs)/3600 sr_hours, sum(n) sr_dec,
  sum(case when n>=3 then secs end)/3600 sr_hours_ge3 from sr group by 1""")
c.execute("""create temp table lossr as select day, sum(secs)/3600 rr_hours, sum(n) rr_dec from rr group by 1""")
q('Per day: active bot-hours vs hours inside rejection runs (summary over days)', """
with a as (select day, sum(bot_hours) bh, sum(decisions) dec, count(distinct bot) bots from act group by 1)
select count(*) n_days, round(avg(bots),1) mean_bots, round(avg(bh),1) mean_active_bot_hours,
  round(avg(rr_hours),1) mean_rejrun_hours, round(avg(sr_hours),1) mean_sameskill_hours,
  round(avg(sr_hours_ge3),1) mean_sameskill_ge3_hours,
  round(sum(rr_hours)/sum(bh),3) frac_time_in_rejruns, round(sum(sr_hours)/sum(bh),3) frac_time_sameskill,
  round(sum(rr_dec)*1.0/sum(dec),3) frac_decisions_rejected
from a join lossr using(day) join lossd using(day)""")
q('Per month: bot-hours in rejection runs per day', """
with a as (select day, sum(bot_hours) bh, sum(decisions) dec from act group by 1)
select substr(day,1,7) m, count(*) n_days, round(avg(bh),0) active_bh_per_day, round(avg(rr_hours),1) rejrun_bh_per_day,
  round(sum(rr_hours)/sum(bh),3) frac, round(avg(rr_dec),0) rej_dec_per_day
from a join lossr using(day) group by 1 order by 1""")
q('Seconds per decision (median gap to next, within session) by class: the cost of one wasted decision', """
select k, round(quantile_cont(epoch(nt)-epoch(t),0.5),2) p50_s, round(avg(epoch(nt)-epoch(t)),2) mean_s
from s3 where not sbreak_after group by 1 order by 1""")

# ---- recovery ladder calibration: P(success within next j decisions | i-th consecutive rejection of same skill) ----
c.execute("""create temp table pos as
with m as (select *, (k='rej') inrun from s3),
g as (select *, row_number() over (partition by bot, sess order by t,id) - row_number() over (partition by bot, sess, inrun, skill order by t,id) grp from m)
select *, row_number() over (partition by bot, sess, skill, grp order by t,id) i from g where inrun""")
q('Hazard: given the i-th consecutive same-skill rejection, P(next decision is admitted) and P(next is a success)', """
select least(i,12) i, count(*) n, round(avg((nk not in ('rej','infra'))::int),3) p_next_admitted,
  round(avg((nk='ok')::int),3) p_next_ok, round(avg((nskill=skill and nk='rej')::int),3) p_next_same_rej
from pos where not sbreak_after group by 1 order by 1""")
c.execute("""create temp table fpos as
with m as (select *, (k='fail') inrun from s3),
g as (select *, row_number() over (partition by bot, sess order by t,id) - row_number() over (partition by bot, sess, inrun, skill order by t,id) grp from m)
select *, row_number() over (partition by bot, sess, skill, grp order by t,id) i from g where inrun""")
q('Admitted retries: after the i-th consecutive FAILED execution of a skill, P(the next decision, if the same skill, succeeds)', """
select least(i,10) i, count(*) n, round(avg((nskill=skill)::int),3) p_retry_same,
  round(avg(case when nskill=skill then (nk='ok')::int end),3) p_retry_ok,
  round(avg(case when nskill<>skill then (nk='ok')::int end),3) p_switch_ok
from fpos where not sbreak_after group by 1 order by 1""")

c.execute("copy (select * from sr) to '/home/mike/rl/sameskill_runs.parquet' (format parquet)")
