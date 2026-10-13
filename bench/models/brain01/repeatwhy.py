import sys, json, glob, collections
for run in sys.argv[1:]:
    c = collections.Counter(); sk = collections.Counter()
    for f in glob.glob(run + "/*/llm-*.jsonl"):
        rows = sorted((json.loads(l) for l in open(f)), key=lambda d: d["@timestamp"])
        prev = []
        for d in rows:
            llm = d["llm"]; o = d.get("outcome") or {}
            tc = (d.get("tool_calls") or [{}])[0]; key = json.dumps([tc.get("skill"), tc.get("args")], sort_keys=True)
            if (llm.get("latency_ms") or 0) > 0 and o.get("status") == "aborted" and llm.get("admission") is None and "identical action" in (o.get("detail") or ""):
                same = [p for p in prev[-4:] if p[0] == key]
                st = [p[1] for p in same]
                c["vetoed"] += 1
                c["last identical one SUCCEEDED" if st and st[-1] == "success" else ("last identical one failed/aborted" if st else "no identical in last 4 rows")] += 1
                sk[tc.get("skill")] += 1
            prev.append((key, o.get("status")))
    print(run.split("/")[-1], dict(c), "skills", dict(sk.most_common(5)))
