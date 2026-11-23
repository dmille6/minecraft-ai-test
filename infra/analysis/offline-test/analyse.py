"""Score the offline test: sensible-decision rate per model x prompt variant, paired v3-v0 uplift with a bootstrap CI.
   python3 analyse.py <items.jsonl> <judge_items.jsonl.refs.json> <labels.jsonl> <offline-*.jsonl ...>"""
import sys, json, random, collections as C
items = {json.loads(l)["id"]: json.loads(l) for l in open(sys.argv[1])}
refs = json.load(open(sys.argv[2]))
lab = {}
for l in open(sys.argv[3]):
    r = json.loads(l)
    if r.get("label"): lab[r["id"]] = r["label"]
lat = C.defaultdict(list)
for f in sys.argv[4:]:
    for l in open(f):
        r = json.loads(l); lat[(r["model"], r["variant"])].append(r["sec"])
score = C.defaultdict(dict)          # (who, variant) -> item -> (sensible 0/1, both 0/1, answered skill)
for r in refs:
    who, v, it = r["who"], r["variant"], r["item"]
    if r.get("invalid"):
        score[(who, v)][it] = (0, 0, None, "invalid"); continue
    L = lab.get(r["key"])
    if not L: continue
    s = 1 if L["decision_ok"] == "yes" else 0
    b = 1 if (L["decision_ok"] == "yes" and L["args_ok"] == "yes") else 0
    score[(who, v)][it] = (s, b, None, L.get("failure_category"))
def rate(d, k=0): return sum(x[k] for x in d.values()) / max(len(d), 1)
def boot(a, b, n=2000):
    ids = [i for i in a if i in b]; random.seed(7); diffs = []
    for _ in range(n):
        smp = [random.choice(ids) for _ in ids]
        diffs.append(sum(b[i][0] - a[i][0] for i in smp) / len(smp))
    diffs.sort(); return sum(b[i][0] - a[i][0] for i in ids) / len(ids), diffs[int(.025 * n)], diffs[int(.975 * n)], len(ids)
base = score[("logged", "v0")]
print(f"BASELINE logged old-bot decisions (Sonnet-graded): sensible {100*rate(base):.1f}%  both-sound {100*rate(base,1):.1f}%  n={len(base)}\n")
models = sorted({w for (w, v) in score if w != "logged"})
print(f"{'model':14} {'old prompt':>11} {'new prompt':>11} {'uplift (95% CI)':>22} {'both-sound old/new':>20} {'sec':>5}")
rows = []
for m in models:
    a, b = score[(m, "v0")], score[(m, "v3")]
    d, lo, hi, n = boot(a, b)
    rows.append((rate(b), m))
    print(f"{m:14} {100*rate(a):10.1f}% {100*rate(b):10.1f}% {100*d:+7.1f} [{100*lo:+.1f},{100*hi:+.1f}] {100*rate(a,1):8.1f}% / {100*rate(b,1):.1f}% {sum(lat[(m,'v3')])/max(len(lat[(m,'v3')]),1):5.1f}")
print("\nfailure categories, new prompt (poor decisions only):")
for m in models:
    c = C.Counter(x[3] for x in score[(m, "v3")].values() if x[0] == 0)
    n = sum(c.values()); print(f"  {m:14}", ", ".join(f"{k} {100*v/n:.0f}%" for k, v in c.most_common(4)))
c = C.Counter(x[3] for x in base.values() if x[0] == 0); n = sum(c.values())
print(f"  {'logged':14}", ", ".join(f"{k} {100*v/n:.0f}%" for k, v in c.most_common(4)))
print("\nbest on the new prompt:", max(rows)[1])
