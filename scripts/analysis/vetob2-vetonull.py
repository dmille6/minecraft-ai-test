# THE NULL AT THE SHAPE ACTUALLY DRAWN: 2 pools of 5, C(12,2)=66, EXHAUSTIVE.
# Measured on data ENDING AT THE DEPLOY INSTANT so no canary code contaminates it.
# Also: where do HIVE-ONLY pairs fall in that null? The draw was hive-a+hive-c, and
# hive pools run 109-185 learned_avoid vetoes per 1k decisions against 3-16 elsewhere,
# so a hive-only treatment arm could sit in a tail of the pooled null.
import sys, os, re, subprocess, itertools, statistics
import datetime as dt
from collections import defaultdict, Counter
sys.path.insert(0,"/srv/mcb-analysis-lib")
from lib.telemetry import Events
END = dt.datetime.fromisoformat("2026-09-26T06:02:47+00:00")   # the deploy instant
HOURS = 6.0
CUT = END - dt.timedelta(hours=HOURS/2); PRE0 = END - dt.timedelta(hours=HOURS)
now = dt.datetime.now(dt.timezone.utc)
back = int((now - PRE0).total_seconds()/60) + 5
ev = Events.load(since_minutes=back)
span=defaultdict(dict)
for r in ev.rows:
    b=(r["bot"] or {}).get("name"); t=r.get("t")
    if not b or not t or t<PRE0 or t>=END: continue
    e="pre" if t<CUT else "post"
    s=span[e].get(b); span[e][b]=(t if s is None else min(s[0],t), t if s is None else max(s[1],t))
print("positive control: %d rows loaded, %d bots pre, %d bots post; window ends %s (deploy)"%(
  len(ev.rows), len(span["pre"]), len(span["post"]), END.isoformat()))
UNITS=[u for u in subprocess.run(["systemctl","list-units","mcbot@*","--no-legend","--plain"],
        capture_output=True,text=True).stdout.split() if u.startswith("mcbot@") and u.endswith(".service")]
REASON=re.compile(r"why=([a-z_]+)")
vet=defaultdict(Counter); tot=Counter()
for u in UNITS:
    b=u[len("mcbot@"):-len(".service")]
    out=subprocess.run(["sudo","journalctl","-u",u,"--since",f"-{back}min","--no-pager","-o","short-iso"],
                       capture_output=True,text=True).stdout
    for line in out.splitlines():
        if "decision rejected" not in line: continue
        try: t=dt.datetime.fromisoformat(line.split(" ",1)[0])
        except Exception: continue
        if t.tzinfo is None: t=t.replace(tzinfo=dt.timezone.utc)
        if t<PRE0 or t>=END: continue
        e="pre" if t<CUT else "post"
        m=REASON.search(line); vet[(b,e)][m.group(1) if m else "(unparsed)"]+=1; tot[(b,e)]+=1
print("journald: %d units, %d veto lines strictly BEFORE the deploy"%(len(UNITS), sum(tot.values())))
assert sum(tot.values())>0, "zero veto lines -- reader failure"
pool_of=lambda b: b.rsplit("-",1)[0]
pools=sorted({pool_of(b) for b in span["post"] if not pool_of(b).startswith("isolated")})
def bh(bots,era):
    s=0.0
    for b in bots:
        v=span[era].get(b)
        if v and v[1]>v[0]: s+=(v[1]-v[0]).total_seconds()/3600.0
    return s
def did_for(treat, reason=None):
    tb={b for b in span["post"] if pool_of(b) in treat}
    cb={b for b in span["post"] if pool_of(b) in set(pools)-set(treat)}
    o=[]
    for bots,era in ((tb,"post"),(tb,"pre"),(cb,"post"),(cb,"pre")):
        h=bh(bots,era)
        if h<=0: return None
        o.append(sum((vet[(b,era)][reason] if reason else tot[(b,era)]) for b in bots)/h)
    return (o[0]-o[1])-(o[2]-o[3])
combos=list(itertools.combinations(pools,2))
print("pools %d; same-shape assignments C(%d,2)=%d, EXHAUSTIVE"%(len(pools),len(pools),len(combos)))
DRAWN=("hive-a","hive-c")
for label,reason in (("all vetoes",None),("repeat_loop","repeat_loop"),("cooldown","cooldown"),("learned_avoid","learned_avoid"),("bad_args","bad_args")):
    pairs=[(t,did_for(t,reason)) for t in combos]
    pairs=[(t,d) for t,d in pairs if d is not None]
    vals=sorted(d for _,d in pairs); n=len(vals)
    q=lambda p: vals[min(n-1,int(p*n))]
    print("  %-11s n=%d mean %+.2f sd %.2f | p5 %+.2f MEDIAN %+.2f p95 %+.2f | min %+.2f max %+.2f"%(
      label,n,statistics.mean(vals),statistics.pstdev(vals),q(.05),q(.5),q(.95),vals[0],vals[-1]))
    hv=[d for t,d in pairs if all(x.startswith("hive") for x in t)]
    nh=[d for t,d in pairs if not any(x.startswith("hive") for x in t)]
    if hv:
        print("      HIVE-ONLY pairs (n=%d): mean %+.2f  median %+.2f  range %+.2f..%+.2f"%(
          len(hv),statistics.mean(hv),statistics.median(hv),min(hv),max(hv)))
        print("      NO-HIVE   pairs (n=%d): mean %+.2f  median %+.2f"%(len(nh),statistics.mean(nh),statistics.median(nh)) if nh else "")
        print("      -> a one-sided 5%% gate using ONLY hive-only pairs would be DiD <= %+.2f"%sorted(hv)[max(0,int(.05*len(hv))-0)])
