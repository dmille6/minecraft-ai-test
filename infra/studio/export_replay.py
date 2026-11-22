"""Export a stratified replay set of real bot decisions from ELK (showcase + fleet, last 7 days)."""
import sys, json, random, collections
sys.path.insert(0, sys.argv[1])
from lib.estelemetry import EsEvents
random.seed(1122)
rows = []
for stream in ("showcase-llm", "llm"):
    ev = EsEvents.load(stream, since_minutes=7*24*60)
    # sample across the window: random_score
    body = {"size": 4000, "query": {"function_score": {"query": ev._query(), "random_score": {"seed": 1122, "field": "_seq_no"}}},
            "_source": ["@timestamp", "bot.name", "run_id", "trigger", "prompt.text", "response.text", "tool_calls", "outcome",
                        "llm.model", "llm.error", "llm.admission", "messages.milestone", "exp.pool"]}
    r = ev._search(body)
    for h in r["hits"]["hits"]:
        s = h["_source"]; tc = (s.get("tool_calls") or [{}])[0]
        if not (s.get("prompt") or {}).get("text") or not tc.get("skill"): continue
        oc = s.get("outcome") or {}
        if isinstance(oc, str): oc = {"raw": oc}
        rows.append(dict(id=h["_id"], stream=stream, ts=s["@timestamp"], bot=(s.get("bot") or {}).get("name") if isinstance(s.get("bot"), dict) else None,
                         run=s.get("run_id"), trigger=s.get("trigger"), milestone=((s.get("messages") or [{}])[0]).get("milestone"),
                         model=(s.get("llm") or {}).get("model"), gate_error=(s.get("llm") or {}).get("error"),
                         prompt=s["prompt"]["text"], logged_skill=tc.get("skill"), logged_args=tc.get("args"),
                         logged_reason=tc.get("reason"), outcome_status=oc.get("status"), outcome_detail=str(oc.get("detail", ""))[:400]))
print("candidates", len(rows))
# stratify: skill x outcome, cap per cell, until 1000
cells = collections.defaultdict(list)
for x in rows: cells[(x["logged_skill"], x["outcome_status"])].append(x)
for v in cells.values(): random.shuffle(v)
pick = []; keys = sorted(cells, key=lambda k: -len(cells[k]))
while len(pick) < 1000 and any(cells[k] for k in keys):
    for k in keys:
        if cells[k] and len(pick) < 1000: pick.append(cells[k].pop())
random.shuffle(pick)
# split by bot+run (session) into screen (first) / final pools
sess = sorted({(x["bot"], x["run"]) for x in pick}); random.shuffle(sess); half = set(sess[: len(sess)//2])
for x in pick: x["split"] = "screen" if (x["bot"], x["run"]) in half else "final"
with open("replay-1000.jsonl", "w") as f:
    for x in pick: f.write(json.dumps(x) + "\n")
c = collections.Counter(x["logged_skill"] for x in pick); o = collections.Counter(x["outcome_status"] for x in pick)
print("picked", len(pick), "skills", len(c), dict(c.most_common(12)), "outcomes", dict(o), "splits", collections.Counter(x["split"] for x in pick))
