"""Export ~5,000 more decisions from ELK (10-08 onward, weighted to recent weeks), deduplicated (1 per bot per minute),
stratified by skill x outcome x trigger, sessions disjoint from replay-1000 and between the two new pools."""
import sys, json, random, collections
sys.path.insert(0, sys.argv[1])
from lib.estelemetry import EsEvents
random.seed(2211)
old = [json.loads(l) for l in open(sys.argv[2])]
old_ids = {x["id"] for x in old}; old_sess = {(x["bot"], x["run"]) for x in old}
WIN = [("2026-10-08T00:00:00Z", "2026-10-22T00:00:00Z", 2500), ("2026-10-22T00:00:00Z", "2026-11-05T00:00:00Z", 3500),
       ("2026-11-05T00:00:00Z", "2026-11-15T00:00:00Z", 5000), ("2026-11-15T00:00:00Z", "2026-11-22T16:00:00Z", 7000)]
rows = []; seen = set()
for stream in ("showcase-llm", "llm"):
    for a, b, size in WIN:
        try: ev = EsEvents.load(stream, since=a, until=b)
        except Exception as e: print("skip", stream, a, e); continue
        body = {"size": min(size, 10000), "query": {"function_score": {"query": ev._query(), "random_score": {"seed": 2211, "field": "_seq_no"}}},
                "_source": ["@timestamp", "bot.name", "run_id", "trigger", "prompt.text", "tool_calls", "outcome", "code.version",
                            "llm.model", "llm.error", "messages.milestone"]}
        for h in ev._search(body)["hits"]["hits"]:
            s = h["_source"]; tc = (s.get("tool_calls") or [{}])[0]
            if h["_id"] in old_ids or not (s.get("prompt") or {}).get("text") or not tc.get("skill"): continue
            bot = (s.get("bot") or {}).get("name") if isinstance(s.get("bot"), dict) else None
            key = (bot, s["@timestamp"][:16])          # one per bot per minute
            if key in seen: continue
            seen.add(key)
            oc = s.get("outcome") or {}
            if isinstance(oc, str): oc = {"raw": oc}
            rows.append(dict(id=h["_id"], stream=stream, ts=s["@timestamp"], bot=bot, run=s.get("run_id"),
                             code=(s.get("code") or {}).get("version"), trigger=s.get("trigger"),
                             milestone=((s.get("messages") or [{}])[0]).get("milestone"), model=(s.get("llm") or {}).get("model"),
                             gate_error=(s.get("llm") or {}).get("error"), prompt=s["prompt"]["text"], logged_skill=tc.get("skill"),
                             logged_args=tc.get("args"), logged_reason=tc.get("reason"), outcome_status=oc.get("status"),
                             outcome_detail=str(oc.get("detail", ""))[:400]))
print("candidates after dedup", len(rows))
rows = [x for x in rows if (x["bot"], x["run"]) not in old_sess]
print("after removing replay-1000 sessions", len(rows))
# cap per session so no one session dominates
by_s = collections.defaultdict(list)
for x in rows: by_s[(x["bot"], x["run"])].append(x)
rows = [y for v in by_s.values() for y in random.sample(v, min(len(v), 40))]
# stratify skill x outcome x trigger-kind
def cell(x): return (x["logged_skill"], x["outcome_status"], "idle" if x["trigger"] == "idle" else "event")
cells = collections.defaultdict(list)
for x in rows: cells[cell(x)].append(x)
for v in cells.values(): random.shuffle(v)
keys = sorted(cells, key=lambda k: -len(cells[k])); pick = []
while len(pick) < 5000 and any(cells[k] for k in keys):
    for k in keys:
        if cells[k] and len(pick) < 5000: pick.append(cells[k].pop())
# split sessions: ~60% of rows to final_test, ~40% to train, sessions disjoint
sess = collections.Counter((x["bot"], x["run"]) for x in pick); order = list(sess); random.shuffle(order)
test, acc = set(), 0
for s_ in order:
    if acc < 0.6 * len(pick): test.add(s_); acc += sess[s_]
for x in pick: x["split"] = "final_test" if (x["bot"], x["run"]) in test else "train"
random.shuffle(pick)
with open("replay-5000.jsonl", "w") as f:
    for x in pick: f.write(json.dumps(x) + "\n")
C = collections.Counter
print("picked", len(pick), "splits", dict(C(x["split"] for x in pick)), "skills", len(C(x["logged_skill"] for x in pick)),
      "outcomes", dict(C(x["outcome_status"] for x in pick)), "event-triggered", sum(x["trigger"] != "idle" for x in pick),
      "by window", dict(C(x["ts"][:7] for x in pick)), "sessions", len(sess), "code versions", len(C(x["code"] for x in pick)))
