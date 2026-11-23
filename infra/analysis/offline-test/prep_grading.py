"""Turn model answers (+ the logged old decision as baseline) into judge items, de-duplicated by (variant prompt, skill, args).
The judge sees the prompt AND the menu the answer was chosen from (Codex review: grade against the offered menu).
   python3 prep_grading.py <items.jsonl> <out_judge.jsonl> <offline-*.jsonl ...>"""
import sys, json, hashlib
items = {json.loads(l)["id"]: json.loads(l) for l in open(sys.argv[1])}
out = sys.argv[2]
uniq, refs = {}, []
def key(item_id, variant, skill, args):
    return hashlib.sha1(json.dumps([item_id, variant, skill, args], sort_keys=True).encode()).hexdigest()[:16]
def add(item_id, variant, skill, args, reason, who):
    x = items[item_id]; p = x[variant]
    k = key(item_id, variant, skill, args)
    if k not in uniq:
        uniq[k] = {"id": k, "prompt": p["system"] + "\n\n" + p["user"], "logged_skill": skill, "logged_args": args,
                   "logged_reason": reason, "outcome_status": None, "outcome_detail": ""}
    refs.append({"key": k, "item": item_id, "variant": variant, "who": who})
for x in items.values():                                      # the old bot's own decision, graded on the old prompt
    add(x["id"], "v0", x["logged_skill"], x.get("logged_args") or {}, "", "logged")
bad = 0
for f in sys.argv[3:]:
    for l in open(f):
        r = json.loads(l)
        if not r.get("ok"):
            bad += 1; refs.append({"key": None, "item": r["id"], "variant": r["variant"], "who": r["model"], "invalid": True}); continue
        a = r["answer"]; add(r["id"], r["variant"], a["skill"], a.get("args") or {}, a.get("reason", ""), r["model"])
with open(out, "w") as fh:
    for v in uniq.values(): fh.write(json.dumps(v) + "\n")
json.dump(refs, open(out + ".refs.json", "w"))
print(f"answers {len(refs)}  unique to grade {len(uniq)}  invalid outputs {bad}")
