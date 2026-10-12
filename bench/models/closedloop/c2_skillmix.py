import sys,json,collections
from datetime import datetime,timedelta
t0=datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")); t1=t0+timedelta(minutes=70)
c=collections.Counter(); fails=collections.Counter()
for l in sys.stdin:
    try: d=json.loads(l)
    except Exception: continue
    ts=d.get("@timestamp")
    if not ts: continue
    t=datetime.fromisoformat(ts.replace("Z","+00:00"))
    if not (t0<=t<t1): continue
    sk=d.get("skill") or {}; n=sk.get("name","")
    if n.startswith("_"):
        if n=="_milestone_complete": c["milestone_complete"]+=1
        continue
    a=sk.get("args") or {}
    key=n+(":"+str(a.get("block") or a.get("item") or "") if n in ("gather","craft") else "")
    src="directive" if str(d.get("trigger","")).startswith("directive") else "own"
    c[key]+=1; c[key+"|"+str(sk.get("status"))]+=1; c[key+"@"+src]+=1
    if key=="gather:oak_log" and sk.get("status")!="success": fails[(sk.get("detail") or "")[:40]]+=1
print(json.dumps({"counts":c,"oak_log_fail_reasons":fails.most_common(5)}))
