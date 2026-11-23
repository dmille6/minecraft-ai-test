"""Pull full decision docs for a sample slice from the raw export into the judge input format."""
import sys, os, json, io, glob, collections, zstandard, orjson
os.chdir(os.path.expanduser("~/mcai")); sl = int(sys.argv[1]); out = f"slice{sl}.jsonl"
plan = [json.loads(l) for l in open(sys.argv[2] if len(sys.argv) > 2 else "sample30k-plan.jsonl")]
want = collections.defaultdict(dict)
for p in plan:
    if p["slice"] == sl:                    # key by stream AND file: fleet and showcase share daily file names
        ix = "mcai-llm-showcase" if p["cell"].split("|")[1] == "showcase" else "mcai-llm-agents"
        want[(ix, p["file"])][p["id"]] = p
n = 0
with open(out, "w") as f:
    for (ix, fn), ids in want.items():
        for p in [f"raw/{ix}/{fn}"]:
            with open(p, "rb") as fh:
                for line in io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(fh), encoding="utf-8"):
                    if '"_id":"' not in line: continue
                    i = line[line.rfind('"_id":"') + 7:].split('"', 1)[0]
                    if i not in ids: continue
                    try: d = orjson.loads(line)
                    except orjson.JSONDecodeError: d = json.loads(line)
                    tc = (d.get("tool_calls") or [{}])[0] or {}; oc = d.get("outcome") or {}
                    if isinstance(oc, str): oc = {"detail": oc}
                    f.write(json.dumps(dict(id=i, cell=ids[i]["cell"], bot=ids[i]["bot"], run=ids[i]["run"], ts=d.get("@timestamp"),
                        model=(d.get("llm") or {}).get("model"), trigger=d.get("trigger"), prompt=(d.get("prompt") or {}).get("text") or "",
                        logged_skill=tc.get("skill"), logged_args=tc.get("args"), logged_reason=tc.get("reason"),
                        outcome_status=oc.get("status"), outcome_detail=str(oc.get("detail", ""))[:400])) + "\n"); n += 1
print("extracted", n, "of", sum(len(v) for v in want.values()), "->", out)
