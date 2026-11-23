"""Pre-project analysis 4: which prompt features go with sensible decisions (Opus 5.5 v3 outcome-blind labels).

Pure Python (no numpy on the Mac or the analysis VM). Usage:
  python3 prompt_features.py <data_dir> [cellcounts.json]  > results.md
data_dir holds slice{0..3}.jsonl and opus-v3-slice{0..3}.labels.jsonl. cellcounts.json is {cell: N} over the
15.5M decisions (built on 10.0.0.45 with the same cell expression as sample30k.py), used only for design weights.
slice0 = simple random sample -> population rates. slices 1-3 = sqrt-allocated stratified -> within-stratum
associations (Mantel-Haenszel) and a fixed-effects logistic; weighted rates only as a cross-check.
"""
import json, re, sys, math, collections, os

D = sys.argv[1]
CC = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
SKILLS = set("""goto gather come follow home deposit withdraw wear_out compost build_composter withdraw_pick town_deposit
prune_town count_town smelt_town furnace_drain make_material build_shop village_unlock deep_mine mats_return toolkit
keepout_exit sky_descend dispose_well build_well close_well build_plinth found_store found_work explore mine craft smelt
place eat sleep swim_to bucket dig_up climb_out pillar_up tidy build idle wait attack flee fish farm plant breed
build_house build_road build_farm""".split())
SEC = ["TASK", "PROGRESS", "HINT", "TRIGGER", "STATE", "INVENTORY", "CAN CRAFT NOW", "CAN SMELT NOW", "CARRYING",
       "NEARBY", "BLOCK CHECKS", "ELEVATION", "KNOWN PLACES", "LAST ACTION", "LESSONS FROM PAST RUNS", "RECENT EVENTS",
       "IN WATER"]


def section(p, name):
    m = re.search(r"^" + re.escape(name) + r"[^\n]*(?:\n  ?- [^\n]*)*", p, re.M)
    return m.group(0) if m else ""


def feats(r):
    p = r["prompt"]; ch = r["logged_skill"] or ""
    f = {"chars": len(p), "tok": len(p) / 4}
    pos = {s: (m.start() if (m := re.search(r"^" + re.escape(s) + r"\b", p, re.M)) else -1) for s in SEC}
    for s in SEC: f["has_" + s] = pos[s] >= 0
    f["task_pos"] = pos["TASK"]; f["hint_pos"] = pos["HINT"]
    order = [s for s in sorted(SEC, key=lambda s: pos[s]) if pos[s] >= 0]
    f["order"] = ">".join(x.split()[0][:5] for x in order)
    hint = section(p, "HINT")
    hs = None
    for w in re.findall(r"[a-z_]+", hint[5:].lower()):
        if w in SKILLS: hs = w; break
    if hs is None and "run smelt" in hint: hs = "smelt"
    f["hint_skill"] = hs; f["hint_names_skill"] = hs is not None
    f["chose_hint"] = (hs == ch) if hs else None
    task = section(p, "TASK")
    f["task_nothing"] = "Nothing to do" in task
    rec = section(p, "RECENT EVENTS"); les = section(p, "LESSONS FROM PAST RUNS"); last = section(p, "LAST ACTION")
    recl = re.findall(r"^\s+- (.*)$", rec, re.M); lesl = re.findall(r"^\s+- (.*)$", les, re.M)
    f["n_recent"] = len(recl); f["n_lessons"] = len(lesl)
    f["n_rejected"] = sum(x.startswith("rejected") for x in recl)
    f["n_failed"] = sum("-> failed" in x for x in recl)
    f["n_repeat_loop"] = sum("repeat_loop" in x for x in recl)
    f["n_lesson_fail"] = sum("has failed" in x for x in lesl)
    rej_sk = [m.group(2) for x in recl if (m := re.match(r"rejected: (cooldown|learned_avoid) \((\w+) with", x))]
    f["rej_chosen"] = ch in rej_sk
    f["any_rej_skill"] = bool(rej_sk)
    f["lesson_fail_chosen"] = any(x.startswith(ch + "(") and "has failed" in x for x in lesl) if ch else False
    fail_sk = [m.group(1) for x in recl if (m := re.match(r"(\w+) -> failed", x))]
    f["recent_fail_chosen"] = ch in fail_sk
    f["last_same"] = bool(ch) and last.startswith("LAST ACTION: " + ch + " ")
    f["last_failed"] = "-> failed" in last or "rejected" in last
    # contradictions: hint names X while the same prompt shows X refused / failing
    f["contra_hint_rej"] = bool(hs) and hs in rej_sk
    f["contra_hint_lesson"] = bool(hs) and any(x.startswith(hs + "(") and "has failed" in x for x in lesl)
    f["contra_hint_recentfail"] = bool(hs) and hs in fail_sk
    f["contra_any"] = f["contra_hint_rej"] or f["contra_hint_lesson"] or f["contra_hint_recentfail"]
    f["carry_nudge_offtask"] = f["has_CARRYING"] and "deposit" in section(p, "CARRYING") and "deposit" not in task.lower() \
        and "home" not in task.lower()
    return f


def load(k):
    lab = {}
    for l in open(f"{D}/opus-v3-slice{k}.labels.jsonl"):
        x = json.loads(l); lab[x["id"]] = x["label"]
    out = []
    for l in open(f"{D}/slice{k}.jsonl"):
        r = json.loads(l)
        L = lab.get(r["id"])
        if not L or not r.get("prompt"): continue
        f = feats(r); c = r["cell"].split("|")
        f.update(id=r["id"], slice=k, cell=r["cell"], era=c[0], world=c[1], skill=r["logged_skill"] or c[2],
                 model=r["model"] or "?", ok=L["decision_ok"] == "yes", unclear=L["decision_ok"] == "unclear",
                 fc=L.get("failure_category") or "none", acc=L.get("acceptable_skills") or [])
        f["ign"] = (not f["ok"]) and f["fc"] == "ignored_task_or_hint"
        f["rep"] = (not f["ok"]) and f["fc"] == "repeated_rejected_action"
        out.append(f)
    return out


S0 = load(0); S = load(1) + load(2) + load(3)
if CC:
    n30 = collections.Counter(x["cell"] for x in S)
    for x in S: x["w"] = CC.get(x["cell"], 0) / n30[x["cell"]]
P = print


def pct(a, b): return f"{100*a/b:.1f}%" if b else "-"


def wilson(k, n):
    if not n: return "-"
    z = 1.96; ph = k / n; d = 1 + z*z/n; c = (ph + z*z/(2*n)) / d; h = z*math.sqrt(ph*(1-ph)/n + z*z/(4*n*n)) / d
    return f"{100*(c-h):.0f}-{100*(c+h):.0f}"


def rate_table(rows, keyf, title, minn=10):
    P(f"\n#### {title}\n\n| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |\n|---|---|---|---|---|---|")
    g = collections.defaultdict(list)
    for x in rows: g[keyf(x)].append(x)
    for k in sorted(g, key=lambda k: str(k)):
        v = g[k]
        if len(v) < minn: continue
        n = len(v); o = sum(x["ok"] for x in v)
        P(f"| {k} | {n} | {pct(o,n)} | {wilson(o,n)} | {pct(sum(x['ign'] for x in v),n)} | {pct(sum(x['rep'] for x in v),n)} |")


def bins(v, cuts):
    for c in cuts:
        if v < c: return f"<{c}"
    return f">={cuts[-1]}"


def strat(x): return (x["model"], x["era"], x["skill"])


def mh(rows, feat, y="ok"):
    """Mantel-Haenszel risk difference (feature true minus false) within model x era x skill strata."""
    g = collections.defaultdict(lambda: [0, 0, 0, 0])
    for x in rows:
        v = x[feat]
        if v is None: continue
        s = g[strat(x)]
        if v: s[0] += 1; s[1] += x[y]
        else: s[2] += 1; s[3] += x[y]
    num = den = 0; used = 0; n1 = 0
    for a, ay, b, by in g.values():
        if a and b:
            w = a*b/(a+b); num += w*(ay/a - by/b); den += w; used += a+b; n1 += a
    return (num/den if den else float("nan")), used, n1


# ---------- pure-python logistic (Newton / IRLS) ----------
def logit(rows, cols, fe, y="ok", ridge=1e-3):
    lv = {k: sorted({x[k] for x in rows}) for k in fe}
    names = ["const"] + cols + [f"{k}={v}" for k in fe for v in lv[k][1:]]
    def xrow(x):
        r = [1.0] + [float(x[c]) for c in cols]
        for k in fe: r += [1.0 if x[k] == v else 0.0 for v in lv[k][1:]]
        return r
    X = [xrow(x) for x in rows]; Y = [1.0 if x[y] else 0.0 for x in rows]; p = len(names); b = [0.0]*p
    for _ in range(25):
        H = [[0.0]*p for _ in range(p)]; g = [0.0]*p
        for xi, yi in zip(X, Y):
            eta = sum(bi*xv for bi, xv in zip(b, xi)); eta = max(-30, min(30, eta)); mu = 1/(1+math.exp(-eta))
            wt = mu*(1-mu); r = yi - mu
            nz = [j for j, v in enumerate(xi) if v]
            for j in nz:
                g[j] += r*xi[j]; xj = xi[j]*wt; Hj = H[j]
                for k in nz: Hj[k] += xj*xi[k]
        for j in range(p): H[j][j] += ridge; g[j] -= ridge*b[j]
        step = solve(H, g); b = [bi+si for bi, si in zip(b, step)]
        if max(abs(s) for s in step) < 1e-6: break
    inv = invert(H)
    return names, b, [math.sqrt(max(inv[j][j], 0)) for j in range(p)]


def solve(A, v):
    n = len(v); M = [row[:] + [v[i]] for i, row in enumerate(A)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c])); M[c], M[piv] = M[piv], M[c]
        d = M[c][c] or 1e-12
        for r in range(n):
            if r != c and M[r][c]:
                f = M[r][c]/d; Mr = M[r]; Mc = M[c]
                for k in range(c, n+1): Mr[k] -= f*Mc[k]
    return [M[i][n]/(M[i][i] or 1e-12) for i in range(n)]


def invert(A):
    n = len(A); return list(map(list, zip(*[solve(A, [1.0 if i == j else 0.0 for i in range(n)]) for j in range(n)])))


# ================= OUTPUT =================
P("# Results: prompt features vs Opus v3 grades\n")
P(f"slice0 (SRS) rows with prompt+label: {len(S0)}; slices 1-3 (stratified): {len(S)}")
o = sum(x["ok"] for x in S0)
P(f"\nPopulation (slice0): sensible {o}/{len(S0)} = {pct(o,len(S0))} (CI {wilson(o,len(S0))}); unclear {sum(x['unclear'] for x in S0)}; "
  f"ignored task/hint {sum(x['ign'] for x in S0)}; repeated rejected {sum(x['rep'] for x in S0)}")
if CC:
    W = sum(x["w"] for x in S); P(f"Design-weighted slices 1-3 sensible: {100*sum(x['w']*x['ok'] for x in S)/W:.1f}% (cross-check of slice0)")

P("\n## A. What the prompts look like (slice0 = population)\n")
def q(vals, ps=(.1, .5, .9)):
    v = sorted(vals); return " / ".join(f"{v[int(p*(len(v)-1))]:.0f}" for p in ps)
P("| feature | p10 / median / p90 |\n|---|---|")
for k in ["chars", "tok", "task_pos", "hint_pos", "n_recent", "n_rejected", "n_failed", "n_repeat_loop", "n_lessons", "n_lesson_fail"]:
    P(f"| {k} | {q([x[k] for x in S0 if x[k] is not None and x[k] >= 0])} |")
P("\n| flag | share of slice0 |\n|---|---|")
for k in ["has_HINT", "hint_names_skill", "task_nothing", "has_CARRYING", "has_IN WATER", "any_rej_skill", "rej_chosen",
          "lesson_fail_chosen", "recent_fail_chosen", "last_same", "contra_hint_rej", "contra_hint_lesson",
          "contra_hint_recentfail", "contra_any", "carry_nudge_offtask"]:
    P(f"| {k} | {pct(sum(bool(x[k]) for x in S0), len(S0))} ({sum(bool(x[k]) for x in S0)}) |")
oc = collections.Counter(x["order"] for x in S0)
P(f"\nSection orders seen: {len(oc)}; top: " + "; ".join(f"{k} ({v})" for k, v in oc.most_common(3)))
P(f"\nModels in slice0: {dict(collections.Counter(x['model'] for x in S0))}")

P("\n## B. Population rates by feature (slice0, raw, not adjusted)")
rate_table(S0, lambda x: bins(x["tok"], [850, 950, 1050, 1150]), "approx tokens (chars/4)")
rate_table(S0, lambda x: ("no hint" if not x["has_HINT"] else "hint, no skill" if not x["hint_names_skill"]
                          else "chose hint skill" if x["chose_hint"] else "chose other"), "hint and whether bot followed it")
rate_table(S0, lambda x: bins(x["n_rejected"], [1, 3, 6]), "rejection lines in RECENT EVENTS")
rate_table(S0, lambda x: "chosen skill rejected (cooldown/avoid) in recent" if x["rej_chosen"] else "not", "rejection names the chosen skill")
rate_table(S0, lambda x: "hint contradicted by history" if x["contra_any"] else "no contradiction", "hint vs history contradiction")
rate_table(S0, lambda x: x["era"], "era")
rate_table(S0, lambda x: x["model"], "model")

P("\n## C. Stratified slices 1-3: raw rates (NOT population; for within-stratum contrasts)")
rate_table(S, lambda x: bins(x["tok"], [850, 950, 1050, 1150]), "approx tokens")
rate_table(S, lambda x: ("no hint" if not x["has_HINT"] else "hint, no skill" if not x["hint_names_skill"]
                         else "chose hint skill" if x["chose_hint"] else "chose other"), "hint followed")
rate_table(S, lambda x: bins(x["n_rejected"], [1, 3, 6, 9]), "rejection lines in recent events")
rate_table(S, lambda x: bins(x["n_repeat_loop"], [1, 3, 6]), "repeat_loop rejection lines")
rate_table(S, lambda x: bins(x["n_failed"], [1, 2, 4]), "failed lines in recent events")
rate_table(S, lambda x: bins(x["n_lessons"], [10, 14]), "lesson lines")
rate_table(S, lambda x: ("rej" if x["rej_chosen"] else "") + ("+lesson" if x["lesson_fail_chosen"] else "") or "neither",
           "chosen skill shown as refused (recent) / failing (lessons)")
rate_table(S, lambda x: ("contra" if x["contra_any"] else "none") if x["hint_names_skill"] else "no skill hint",
           "hint contradicted by rejection/failure of same skill")
rate_table(S, lambda x: ("contra+" if x["contra_any"] else "clean+") + ("chose hint" if x["chose_hint"] else "other")
           if x["hint_names_skill"] else None, "contradiction x followed hint")
rate_table(S, lambda x: x["last_same"] and x["last_failed"], "chose same skill as a failed/rejected LAST ACTION")
rate_table(S, lambda x: bins(x["hint_pos"], [0, 100, 200, 300]) if x["has_HINT"] else "none", "HINT char offset")

P("\n## D. Mantel-Haenszel risk differences within model x era x skill (slices 1-3)\n")
P("| feature (true vs false) | RD sensible (pp) | RD repeated-rejected (pp) | RD ignored (pp) | rows in informative strata | n true |\n|---|---|---|---|---|---|")
for x in S:
    x["long"] = x["tok"] >= 1050; x["many_rej"] = x["n_rejected"] >= 3; x["any_fail"] = x["n_failed"] >= 1
    x["many_lessons"] = x["n_lessons"] >= 10; x["follow"] = x["chose_hint"] if x["hint_names_skill"] else None
    x["hint_late"] = x["hint_pos"] > 150 if x["has_HINT"] else None
for f in ["long", "has_HINT", "hint_names_skill", "follow", "hint_late", "many_rej", "any_fail", "many_lessons",
          "rej_chosen", "lesson_fail_chosen", "recent_fail_chosen", "contra_any", "carry_nudge_offtask", "task_nothing", "has_CARRYING"]:
    a, u, n1 = mh(S, f); b, _, _ = mh(S, f, "rep"); c, _, _ = mh(S, f, "ign")
    P(f"| {f} | {100*a:+.1f} | {100*b:+.1f} | {100*c:+.1f} | {u} | {n1} |")

P("\n## E. Logistic regression, slices 1-3, sensible ~ features + FE(model, era, top skills)\n")
top = {k for k, _ in collections.Counter(x["skill"] for x in S).most_common(14)}
for x in S:
    x["skillg"] = x["skill"] if x["skill"] in top else "other"; x["modelg"] = x["model"] if x["model"].startswith("qwen2.5:7b") else "other"
    x["tok_k"] = x["tok"] / 1000; x["rej_n"] = min(x["n_rejected"], 10); x["fail_n"] = min(x["n_failed"], 5)
    x["hint_skill_follow"] = bool(x["hint_names_skill"] and x["chose_hint"]); x["hint_skill_other"] = bool(x["hint_names_skill"] and not x["chose_hint"])
cols = ["tok_k", "rej_n", "fail_n", "rej_chosen", "lesson_fail_chosen", "hint_skill_follow", "hint_skill_other", "contra_any", "task_nothing"]
for yv in ["ok", "rep"]:
    names, b, se = logit(S, cols, ["modelg", "era", "skillg"], y=yv)
    P(f"\noutcome = {yv}; n = {len(S)}; SEs ignore clustering by session (optimistic)\n\n| term | odds ratio | 95% CI |\n|---|---|---|")
    for nm, bi, si in zip(names, b, se):
        if nm in cols: P(f"| {nm} | {math.exp(bi):.2f} | {math.exp(bi-1.96*si):.2f}-{math.exp(bi+1.96*si):.2f} |")

P("\n## F. Same model on slice0 (population, small n) as a direction check\n")
for x in S0:
    x["skillg"] = x["skill"] if x["skill"] in top else "other"; x["modelg"] = x["model"] if x["model"].startswith("qwen2.5:7b") else "other"
    x["tok_k"] = x["tok"] / 1000; x["rej_n"] = min(x["n_rejected"], 10); x["fail_n"] = min(x["n_failed"], 5)
    x["hint_skill_follow"] = bool(x["hint_names_skill"] and x["chose_hint"]); x["hint_skill_other"] = bool(x["hint_names_skill"] and not x["chose_hint"])
names, b, se = logit(S0, cols, ["modelg", "era"], y="ok")
P("| term | odds ratio | 95% CI |\n|---|---|---|")
for nm, bi, si in zip(names, b, se):
    if nm in cols: P(f"| {nm} | {math.exp(bi):.2f} | {math.exp(bi-1.96*si):.2f}-{math.exp(bi+1.96*si):.2f} |")

P("\n## G. When the hint names a skill and the bot did not take it: was the hint skill acceptable to the grader?\n")
v = [x for x in S if x["hint_names_skill"] and not x["chose_hint"]]
a = sum(x["hint_skill"] in x["acc"] for x in v); c = sum(x["hint_skill"] in x["acc"] and x["contra_any"] for x in v)
P(f"slices1-3: {len(v)} rows; hint skill in grader's acceptable list {a} ({pct(a,len(v))}); of which hint was contradicted by history {c}")
v = [x for x in S if x["hint_names_skill"] and x["chose_hint"]]
a = sum(x["ok"] for x in v); P(f"followed hint: {len(v)} rows, sensible {pct(a,len(v))}")
v = [x for x in S if x["hint_names_skill"] and x["chose_hint"] and x["contra_any"]]
P(f"followed a hint that history contradicts: {len(v)} rows, sensible {pct(sum(x['ok'] for x in v),len(v))}, repeated-rejected {pct(sum(x['rep'] for x in v),len(v))}")
v = [x for x in S if x["rep"]]
P(f"\nrepeated_rejected rows {len(v)}: chosen skill named in a rejection line {pct(sum(x['rej_chosen'] for x in v),len(v))}; "
  f"in a failing lesson {pct(sum(x['lesson_fail_chosen'] for x in v),len(v))}; in a recent failure {pct(sum(x['recent_fail_chosen'] for x in v),len(v))}; "
  f">=3 repeat_loop lines {pct(sum(x['n_repeat_loop']>=3 for x in v),len(v))}; chose hint skill {pct(sum(bool(x['chose_hint']) for x in v),len(v))}")
