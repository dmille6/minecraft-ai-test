"""After a repeat_loop veto, what does the bot do NEXT (its next model decision, same bot), and does the next prompt
carry the rejection text? Denominator: repeat_loop vetoes that have a following model decision in the same run."""
import sys, json, glob, collections
for run in sys.argv[1:]:
    c = collections.Counter(); ex = {}
    for f in glob.glob(run + "/*/llm-*.jsonl"):
        rows = sorted((json.loads(l) for l in open(f)), key=lambda d: d["@timestamp"])
        rows = [d for d in rows if (d["llm"].get("latency_ms") or 0) > 0]     # model decisions only
        for d, nx in zip(rows, rows[1:]):
            o = d.get("outcome") or {}
            if not ("identical action" in (o.get("detail") or "") and d["llm"].get("admission") is None):
                continue
            key = lambda r: json.dumps([(r.get("tool_calls") or [{}])[0].get("skill"), (r.get("tool_calls") or [{}])[0].get("args")], sort_keys=True)
            c["vetoes with a next decision"] += 1
            same = key(nx) == key(d)
            c["next is IDENTICAL"] += same
            t = (nx.get("prompt") or {}).get("text") or ""
            carried = "repeat_loop" in t or "identical action" in t
            c["next prompt carries the rejection"] += carried
            c["identical AND carried"] += same and carried
            k = ("carried" if carried else "not carried")
            if k not in ex:
                i = t.find("LAST ACTION"); ex[k] = t[i:i+160].replace("\n", " | ") if i >= 0 else "(no LAST ACTION line) " + t[:120].replace("\n", " | ")
    n = c["vetoes with a next decision"] or 1
    print(run.split("/")[-1])
    print("   vetoes followed by a decision: %d | next identical %d (%.0f%%) | next prompt carries the rejection %d (%.0f%%) | identical despite carried %d" % (
        c["vetoes with a next decision"], c["next is IDENTICAL"], 100 * c["next is IDENTICAL"] / n, c["next prompt carries the rejection"], 100 * c["next prompt carries the rejection"] / n, c["identical AND carried"]))
    for k, v in ex.items(): print("   e.g. %s: %s" % (k, v))
