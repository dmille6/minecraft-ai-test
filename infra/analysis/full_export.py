"""Full ELK export, one zstd NDJSON file per index per UTC day (resumable: finished days are skipped).
   python3 full_export.py <index> <first-day YYYY-MM-DD> <last-day YYYY-MM-DD>
Uses the read-only key via lib.estelemetry.http(). Days touching 10-07 are exported but flagged (known duplicates)."""
import sys, os, json, datetime as dt, time
sys.path.insert(0, os.path.expanduser("~/mcai/scripts"))
from lib.estelemetry import http
import zstandard
index, d0, d1 = sys.argv[1], dt.date.fromisoformat(sys.argv[2]), dt.date.fromisoformat(sys.argv[3])
out = os.path.expanduser(f"~/mcai/raw/{index}"); os.makedirs(out, exist_ok=True)
day = d0
while day <= d1:
    fn = f"{out}/{day}.ndjson.zst"
    if os.path.exists(fn):
        day += dt.timedelta(days=1); continue
    t0 = time.time(); n = 0
    pit = http("POST", f"{index}/_pit?keep_alive=5m")["id"]
    q = {"range": {"@timestamp": {"gte": f"{day}T00:00:00Z", "lt": f"{day + dt.timedelta(days=1)}T00:00:00Z"}}}
    after = None
    tmp = fn + ".part"
    with open(tmp, "wb") as fh, zstandard.ZstdCompressor(level=6).stream_writer(fh) as w:
        while True:
            body = {"size": 5000, "query": q, "pit": {"id": pit, "keep_alive": "5m"}, "sort": [{"_shard_doc": "asc"}]}
            if after: body["search_after"] = after
            r = http("POST", "_search", body, timeout=300)
            pit = r.get("pit_id", pit); hits = r["hits"]["hits"]
            if not hits: break
            for h in hits:
                s = h["_source"]; s["_id"] = h["_id"]; s["_index"] = h["_index"]
                w.write((json.dumps(s, separators=(",", ":")) + "\n").encode()); n += 1
            after = hits[-1]["sort"]
    try: http("DELETE", "_pit", {"id": pit})
    except Exception: pass
    os.rename(tmp, fn)
    print(f"{index} {day} {n:,} docs {time.time()-t0:.0f}s", flush=True)
    day += dt.timedelta(days=1)
print("done", index)
