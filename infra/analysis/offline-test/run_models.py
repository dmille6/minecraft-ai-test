"""Ask one served model for a decision on every item, in both variants (v0 old prompt + full menu, v3 new design).
   python3 run_models.py <items.jsonl> <base_url> <model_alias> <out.jsonl>   (resumable)"""
import sys, json, os, time, threading, urllib.request
items_p, base, alias, out = sys.argv[1:5]
done = set()
if os.path.exists(out):
    for l in open(out):
        r = json.loads(l)
        if r.get("ok"): done.add((r["id"], r["variant"]))
items = [json.loads(l) for l in open(items_p)]
jobs = [(x, v) for x in items for v in ("v0", "v3") if (x["id"], v) not in done]
lock = threading.Lock(); it = iter(jobs); fh = open(out, "a")
def schema(menu):
    return {"type": "object", "properties": {"reason": {"type": "string", "maxLength": 80}, "skill": {"type": "string", "enum": menu},
            "args": {"type": "object", "maxProperties": 4, "additionalProperties": {"type": ["string", "integer"], "maxLength": 40}}},
            "required": ["reason", "skill", "args"], "additionalProperties": False}
def call(x, v):
    p = x[v]
    body = {"model": alias, "messages": [{"role": "system", "content": p["system"]}, {"role": "user", "content": p["user"]}],
            "max_tokens": 128, "temperature": 0.2, "response_format": {"type": "json_schema", "json_schema": {"name": "d", "schema": schema(p["menu"])}},
            "chat_template_kwargs": {"enable_thinking": False}}
    t = time.time()
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(base + "/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=180))
        ch = d["choices"][0]; txt = ch["message"]["content"] or ""
        try: j = json.loads(txt); ok = j.get("skill") in p["menu"]
        except Exception: j, ok = None, False
        return dict(id=x["id"], variant=v, model=alias, ok=ok, answer=j, raw=None if ok else txt[:300], finish=ch.get("finish_reason"),
                    sec=round(time.time() - t, 2), tokens=d.get("usage", {}).get("completion_tokens"))
    except Exception as e:
        return dict(id=x["id"], variant=v, model=alias, ok=False, answer=None, raw=f"ERROR {e}"[:300], sec=round(time.time() - t, 2))
def w():
    while True:
        with lock: j = next(it, None)
        if j is None: return
        r = call(*j)
        with lock: fh.write(json.dumps(r) + "\n"); fh.flush()
ts = [threading.Thread(target=w) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
print("done", alias, len(jobs))
