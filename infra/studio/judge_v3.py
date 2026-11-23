"""Local judge with rubric v3 (outcome-blind, skill reference): same instructions as the Claude referee. Resumable."""
import sys, json, time, re, os, urllib.request
base, model, inp, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
extra = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
R = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rubric-v3.json")))
SYS = R["system"] + "\n\nReply with ONLY one compact JSON object with exactly these keys: " + ", ".join(R["schema"]["required"]) + "."
done = set()
if os.path.exists(out):
    for l in open(out):
        r = json.loads(l)
        if r.get("label"): done.add(r["id"])
def ask(item):
    body = {"model": model, "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": item["user_text"]}],
            "max_tokens": int(os.environ.get("JUDGE_MAX_TOKENS", "800")), "temperature": 0.0, **extra}
    t = time.time()
    d = json.load(urllib.request.urlopen(urllib.request.Request(base + "/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=900))
    txt = d["choices"][0]["message"]["content"] or ""
    if "<|channel|>final<|message|>" in txt: txt = txt.split("<|channel|>final<|message|>", 1)[1]
    txt = re.sub(r"<think>.*?</think>", "", txt, flags=re.S)
    m = re.search(r"\{.*\}", txt, re.S); lab = None
    if m:
        try: lab = json.loads(m.group(0))
        except Exception: lab = None
    return lab, txt, time.time() - t
with open(out, "a") as f:
    for line in open(inp):
        item = json.loads(line)
        if item["id"] in done: continue
        lab, raw, dt = None, "", 0
        for _ in range(2):
            try:
                lab, raw, dt = ask(item)
                if lab: break
            except Exception as e: raw = f"ERROR {e}"; time.sleep(5)
        f.write(json.dumps({"id": item["id"], "judge": model, "rubric": R["rubric"], "mode": "blind", "label": lab, "raw": None if lab else raw[:400], "sec": round(dt, 1)}) + "\n"); f.flush()
print("finished", model)
