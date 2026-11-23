"""Pass 1: one feature row per exported decision (no prompt text) -> Parquet, for full-population stats and sampling."""
import os, sys, glob, re, json, orjson, zstandard, io, pyarrow as pa, pyarrow.parquet as pq
RAW = os.path.expanduser("~/mcai/raw"); OUT = os.path.expanduser("~/mcai/parquet/decisions")
os.makedirs(OUT, exist_ok=True)
def task_kind(ms):
    if not ms: return None
    return re.split(r"[#_0-9]", ms, 1)[0] or ms
cols = ["id", "file", "ts", "day", "world", "bot", "run", "code", "model", "trigger", "task", "milestone", "skill", "args_n",
        "status", "fail_detail_head", "gate_error", "schema_valid", "latency_ms", "prompt_tokens", "completion_tokens",
        "y", "dim", "health", "hunger", "inv_kinds", "inv_items", "blocks_kinds", "lava", "water", "has_pick", "pool"]
for index in ("mcai-llm-agents", "mcai-llm-showcase"):
    for fn in sorted(glob.glob(f"{RAW}/{index}/*.ndjson.zst")):
        day = os.path.basename(fn)[:10]; outp = f"{OUT}/{index}-{day}.parquet"
        if os.path.exists(outp) or day == "2026-10-07": continue
        rows = {c: [] for c in cols}
        with open(fn, "rb") as fh:
            for line in io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(fh), encoding="utf-8"):
                try: d = orjson.loads(line)
                except orjson.JSONDecodeError: d = json.loads(line)     # lone surrogates in a few prompts
                b = d.get("bot") or {}; llm = d.get("llm") or {}; oc = d.get("outcome") or {}
                if isinstance(oc, str): oc = {"status": None, "detail": oc}
                if isinstance(b, str): b = {}
                tc = (d.get("tool_calls") or [{}])[0] or {}; inv = b.get("inventory") or {}; per = (d.get("perception") or {}).get("blocks") or {}
                ms = ((d.get("messages") or [{}])[0] or {}).get("milestone")
                pos = b.get("pos") or {}
                r = dict(id=d["_id"], file=os.path.basename(fn), ts=d.get("@timestamp"), day=day, world=d.get("world") or ("showcase" if "showcase" in index else "fleet"),
                         bot=b.get("name"), run=d.get("run_id"), code=(d.get("code") or {}).get("version"), model=llm.get("model"), trigger=d.get("trigger"),
                         task=task_kind(ms), milestone=ms, skill=tc.get("skill"), args_n=len(tc.get("args") or {}), status=oc.get("status"),
                         fail_detail_head=(str(oc.get("detail") or "")[:60]), gate_error=llm.get("error"), schema_valid=llm.get("schema_valid"),
                         latency_ms=llm.get("latency_ms"), prompt_tokens=llm.get("prompt_tokens"), completion_tokens=llm.get("completion_tokens"),
                         y=pos.get("y"), dim=(d.get("game") or {}).get("dimension"), health=b.get("health"), hunger=b.get("hunger"),
                         inv_kinds=len(inv), inv_items=sum(v for v in inv.values() if isinstance(v, (int, float))),
                         blocks_kinds=len(per), lava=per.get("lava", 0), water=per.get("water", 0),
                         has_pick=any(k.endswith("_pickaxe") for k in inv), pool=(d.get("exp") or {}).get("pool"))
                for c in cols: rows[c].append(r[c])
        pq.write_table(pa.table(rows), outp, compression="zstd")
        print(index, day, len(rows["id"]), flush=True)
print("features done")
