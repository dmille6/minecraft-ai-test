"""Label the replay set with a local judge model (OpenAI-compatible server). Resumable: skips ids already labelled."""
import sys, json, time, re, urllib.request, os
base, model, inp, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
extra = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
done = set()
if os.path.exists(out):
    for l in open(out):
        try: done.add(json.loads(l)["id"])
        except Exception: pass
SYS = ("You grade decisions made by a Minecraft bot. The bot saw the PROMPT below and chose ONE skill with arguments. "
       "Judge whether the choice was sensible GIVEN WHAT THE BOT COULD SEE when it chose. The later OUTCOME is a hint only: "
       "an action can be right and still be aborted by a controller or fail for reasons the bot could not know. "
       "Reply with ONLY one compact JSON object: {\"acceptable_skills\": [skill names from the prompt that would be reasonable next actions], "
       "\"decision_ok\": \"yes\"|\"no\"|\"unclear\", \"args_ok\": \"yes\"|\"no\"|\"unclear\", \"why\": \"one short sentence\"}")
def ask(item):
    user = (f"PROMPT THE BOT SAW:\n{item['prompt']}\n\nBOT'S DECISION: skill={item['logged_skill']} args={json.dumps(item['logged_args'])} "
            f"reason={item.get('logged_reason')!r}\n\nOUTCOME (hint only): {item.get('outcome_status')} {item.get('outcome_detail','')[:300]}")
    body = {"model": model, "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": user}],
            "max_tokens": 400, "temperature": 0.0, **extra}
    t = time.time()
    d = json.load(urllib.request.urlopen(urllib.request.Request(base + "/v1/chat/completions", json.dumps(body).encode(),
                                                                {"Content-Type": "application/json"}), timeout=600))
    txt = d["choices"][0]["message"]["content"] or ""
    m = re.search(r"\{.*\}", txt, re.S)
    lab = json.loads(m.group(0)) if m else None
    return lab, txt, time.time() - t
n = 0
with open(out, "a") as f:
    for line in open(inp):
        item = json.loads(line)
        if item["id"] in done: continue
        lab = None; raw = ""; dt = 0
        for attempt in range(2):
            try:
                lab, raw, dt = ask(item)
                if lab: break
            except Exception as e:
                raw = f"ERROR {e}"; time.sleep(5)
        f.write(json.dumps({"id": item["id"], "judge": model, "label": lab, "raw": None if lab else raw[:500], "sec": round(dt, 1)}) + "\n"); f.flush()
        n += 1
        if n % 50 == 0: print(time.strftime("%H:%M:%S"), model, n, "labelled", flush=True)
print("finished", model, n)
