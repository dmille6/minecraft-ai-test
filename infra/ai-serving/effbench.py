"""Efficiency bench: one server config, concurrency 1/4/8/16, real prompts, compact JSON schema, max_tokens 96."""
import sys, json, time, random, statistics, threading, urllib.request
sys.path.insert(0, sys.argv[1]); label, url, model = sys.argv[2], sys.argv[3], sys.argv[4]
extra = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
from lib.estelemetry import EsEvents
import os
cache = os.path.expanduser("~/claude-survey/prompts.json")
if os.path.exists(cache): P = json.load(open(cache))
else:
    ev = EsEvents.load('showcase-llm', since_minutes=3*24*60)
    r = ev._search({"size": 600, "query": ev._query(), "_source": ["prompt.text"], "sort": [{"@timestamp": "desc"}]})
    P = [h["_source"]["prompt"]["text"] for h in r["hits"]["hits"] if h["_source"].get("prompt", {}).get("text")]
    random.seed(5); random.shuffle(P); json.dump(P, open(cache, "w"))
S = {"type": "object", "properties": {"skill": {"type": "string", "maxLength": 24},
     "args": {"type": "object", "maxProperties": 4, "additionalProperties": {"type": ["string", "integer"], "maxLength": 40}},
     "reason": {"type": "string", "maxLength": 80}}, "required": ["skill", "args", "reason"], "additionalProperties": False}
def call(p):
    b = {"model": model, "messages": [{"role": "user", "content": p}], "max_tokens": 96, "temperature": 0.2,
         "response_format": {"type": "json_schema", "json_schema": {"name": "d", "schema": S}}, **extra}
    t = time.time()
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(url, json.dumps(b).encode(), {"Content-Type": "application/json"}), timeout=180))
        ch = d["choices"][0]
        try: json.loads(ch["message"]["content"]); v = 1
        except Exception: v = 0
        return time.time() - t, 1, v, ch.get("finish_reason") == "length"
    except Exception: return time.time() - t, 0, 0, 0
for conc in (1, 4, 8, 16):
    n = max(24, conc * 6); it = iter(P[:n]); res = []; lk = threading.Lock()
    def w():
        while True:
            with lk: p = next(it, None)
            if p is None: return
            x = call(p)
            with lk: res.append(x)
    t0 = time.time(); th = [threading.Thread(target=w) for _ in range(conc)]; [t.start() for t in th]; [t.join() for t in th]; wall = time.time() - t0
    lat = sorted(x[0] for x in res if x[1])
    print(json.dumps(dict(config=label, conc=conc, n=len(res), ok=sum(x[1] for x in res), valid=sum(x[2] for x in res), trunc=sum(x[3] for x in res),
          p50=round(lat[len(lat)//2], 2), p95=round(lat[int(.95*(len(lat)-1))], 2), per_min=round(60*len(lat)/wall, 1))), flush=True)
