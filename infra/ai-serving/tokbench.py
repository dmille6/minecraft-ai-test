"""Token-limit sweep: prompt sizes, natural answer length, and truncation vs max_tokens / reason maxLength, on both servers."""
import sys, json, time, random, statistics, urllib.request, concurrent.futures as cf
sys.path.insert(0, sys.argv[1])
from lib.estelemetry import EsEvents
SK = "goto gather come follow home deposit withdraw wear_out compost build_composter withdraw_pick town_deposit prune_town count_town smelt_town furnace_drain make_material build_shop village_unlock deep_mine mats_return toolkit keepout_exit sky_descend dispose_well build_well close_well build_plinth found_store found_work status eat craft place bucket build explore mine smelt sleep board surface".split()
ev = EsEvents.load('showcase-llm', since_minutes=3*24*60)
r = ev._search({"size": 600, "query": ev._query(), "_source": ["prompt.text"], "sort": [{"@timestamp": "desc"}]})
P = [h["_source"]["prompt"]["text"] for h in r["hits"]["hits"] if h["_source"].get("prompt", {}).get("text")]
random.seed(11); random.shuffle(P); P = P[:96]
T = {"3090-vllm-8b": ("http://10.0.0.16:8000", "executive", {"chat_template_kwargs": {"enable_thinking": False}}),
     "5080-llamacpp-4b": ("http://10.0.0.72:18080", "r3-qwen35-4b-q8", {})}
def post(url, body, timeout=120):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=timeout))
def schema(maxlen):
    reason = {"type": "string"}
    if maxlen: reason["maxLength"] = maxlen
    return {"type": "object", "properties": {"skill": {"enum": SK}, "args": {"type": "object"}, "reason": reason},
            "required": ["skill", "args", "reason"], "additionalProperties": False}
def one(base, model, extra, p, mt, maxlen):
    b = {"model": model, "messages": [{"role": "user", "content": p}], "max_tokens": mt, "temperature": 0.2,
         "response_format": {"type": "json_schema", "json_schema": {"name": "decision", "schema": schema(maxlen)}}, **extra}
    t = time.time(); d = post(base + "/v1/chat/completions", b); dt = time.time() - t
    ch = d["choices"][0]; txt = ch["message"]["content"] or ""
    try: j = json.loads(txt); ok = j.get("skill") in SK
    except Exception: ok = False
    u = d.get("usage", {})
    return dict(dt=dt, fin=ch.get("finish_reason"), ok=ok, ct=u.get("completion_tokens", 0), pt=u.get("prompt_tokens", 0))
out = {}
for name, (base, model, extra) in T.items():
    # natural length: generous cap
    rows = list(cf.ThreadPoolExecutor(4).map(lambda p: one(base, model, extra, p, 512, None), P[:48]))
    ct = sorted(x["ct"] for x in rows); pt = sorted(x["pt"] for x in rows)
    out[f"{name} natural"] = dict(prompt_tokens_p50=pt[len(pt)//2], prompt_tokens_p95=pt[int(.95*(len(pt)-1))], prompt_tokens_max=pt[-1],
                                  answer_tokens_p50=ct[len(ct)//2], answer_tokens_p95=ct[int(.95*(len(ct)-1))], answer_tokens_max=ct[-1],
                                  truncated=sum(x["fin"] == "length" for x in rows), n=len(rows))
    print(name, "natural", out[f"{name} natural"], flush=True)
    for maxlen in (None, 120, 80):
        for mt in (64, 96, 128, 192):
            rows = list(cf.ThreadPoolExecutor(4).map(lambda p: one(base, model, extra, p, mt, maxlen), P))
            lat = sorted(x["dt"] for x in rows)
            row = dict(n=len(rows), truncated=sum(x["fin"] == "length" for x in rows), valid=sum(x["ok"] for x in rows),
                       answer_tokens_mean=round(statistics.mean(x["ct"] for x in rows), 1),
                       p50=round(lat[len(lat)//2], 2), p95=round(lat[int(.95*(len(lat)-1))], 2))
            out[f"{name} reasonMax={maxlen} max_tokens={mt}"] = row
            print(name, "reasonMax", maxlen, "max_tokens", mt, row, flush=True)
json.dump(out, open("tokbench-result.json", "w"), indent=1)
