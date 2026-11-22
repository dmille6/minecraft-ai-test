"""Replay real showcase bot prompts against OpenAI-compatible servers at rising concurrency."""
import sys, json, time, random, statistics, threading, urllib.request
sys.path.insert(0, sys.argv[1])
from lib.estelemetry import EsEvents
ev = EsEvents.load('showcase-llm', since_minutes=3*24*60)
r = ev._search({"size": 400, "query": ev._query(), "_source": ["prompt.text", "trigger"],
                "sort": [{"@timestamp": "desc"}]})
prompts = [h["_source"]["prompt"]["text"] for h in r["hits"]["hits"] if h["_source"].get("prompt", {}).get("text")]
random.seed(7); random.shuffle(prompts)
print("prompts", len(prompts), "median chars", statistics.median(len(p) for p in prompts))
SCHEMA = {"type": "object", "properties": {"skill": {"type": "string"}, "args": {"type": "object"},
          "reason": {"type": "string"}}, "required": ["skill", "args", "reason"]}
TARGETS = {"3090-vllm-qwen3-8b-awq": ("http://10.0.0.16:8000/v1/chat/completions", "executive", {"chat_template_kwargs": {"enable_thinking": False}}),
           "5080-llamacpp-qwen35-4b-q8": ("http://10.0.0.72:18080/v1/chat/completions", "r3-qwen35-4b-q8", {})}
def call(url, model, extra, p):
    body = {"model": model, "messages": [{"role": "user", "content": p}], "max_tokens": 120, "temperature": 0.2,
            "response_format": {"type": "json_schema", "json_schema": {"name": "decision", "schema": SCHEMA}}, **extra}
    t = time.time()
    try:
        req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
        d = json.load(urllib.request.urlopen(req, timeout=120))
        txt = d["choices"][0]["message"]["content"]; ok = True
        try: json.loads(txt); valid = True
        except Exception: valid = False
        return time.time() - t, ok, valid, d.get("usage", {}).get("completion_tokens", 0)
    except Exception as e:
        return time.time() - t, False, False, 0
out = {}
for name, (url, model, extra) in TARGETS.items():
    for conc in (1, 4, 8, 16):
        n = max(16, conc * 4); batch = prompts[:n]; res = []; lock = threading.Lock(); it = iter(batch)
        def worker():
            while True:
                with lock:
                    p = next(it, None)
                if p is None: return
                x = call(url, model, extra, p)
                with lock: res.append(x)
        t0 = time.time(); th = [threading.Thread(target=worker) for _ in range(conc)]
        [t.start() for t in th]; [t.join() for t in th]; wall = time.time() - t0
        lat = sorted(x[0] for x in res if x[1]); toks = sum(x[3] for x in res)
        row = dict(n=len(res), ok=sum(x[1] for x in res), valid_json=sum(x[2] for x in res),
                   p50=round(statistics.median(lat), 2) if lat else None,
                   p95=round(lat[int(0.95 * (len(lat) - 1))], 2) if lat else None,
                   decisions_per_min=round(60 * len(lat) / wall, 1), out_tok_per_s=round(toks / wall, 1))
        out[f"{name} c={conc}"] = row; print(name, "conc", conc, row, flush=True)
json.dump(out, open("bench-result.json", "w"), indent=1)
