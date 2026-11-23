"""Offline prompt test: rebuild each logged situation as V0 (old prompt, full menu) and V3 (new design).

V3 = the analysis-driven design, approximated from what the logged prompt contains:
  - the menu drops skills that are broken or not real actions (skill-reliability report), and drops a skill that was
    refused 2+ times in the recent events (with Codex's escape rule: the menu is never empty; navigation fallbacks stay);
  - refusals are collapsed into one BLOCKED section (latest reason per skill, with a remedy) instead of repeated lines;
  - the hint is withheld when it names a blocked skill, otherwise rewritten as a recommended call, and moved to the top;
  - lessons capped at 5 (failures first), recent events de-duplicated and capped at 6, rejected lines removed from them.
  python3 build_items.py <slice0.jsonl> <skill-reference.txt> <out.jsonl>
"""
import json
import re
import sys

DROP = {"bucket", "swim_to", "build", "follow", "come", "status"}       # broken or not actions (report 1)
FALLBACK = ["explore", "home", "surface"]                              # never leave the menu empty (Codex review)
SECTION_ORDER = ["TASK", "RECOMMENDED", "PROGRESS", "BLOCKED", "STATE", "IN WATER", "ELEVATION", "REACHABLE Y RANGE",
                 "INVENTORY", "CAN CRAFT NOW", "CAN SMELT NOW", "CARRYING", "CARRYING A BUCKET", "NEARBY", "BLOCK CHECKS",
                 "KNOWN PLACES", "TOWN WOOD", "MINING", "ACTIONABLE", "LAST ACTION", "RECENT EVENTS", "LESSONS", "TRIGGER"]


def parse(prompt):
    """Split the old user prompt into (head line before sections, {SECTION: [lines]}) keeping multi-line sections."""
    secs, cur = {}, None
    for line in prompt.splitlines():
        if line.startswith("saw_end:"):
            continue
        m = re.match(r"^([A-Z][A-Z /]+?)(?: \([^)]*\))?:\s?(.*)$", line)   # e.g. "RECENT EVENTS (oldest first):"
        if m and not line.startswith(" "):
            cur = m.group(1).strip()
            secs.setdefault(cur, [])
            if m.group(2):
                secs[cur].append(m.group(2))
        elif cur:
            secs[cur].append(line.strip())
    return secs


def refused_skill(line, last_skill):
    s = line
    m = re.search(r"\b([a-z_]+) with these args", s)
    if m:
        return m.group(1)
    m = re.search(r"bad_args \(([a-z_]+) only", s)
    if m:
        return m.group(1)
    if "bad_args" in s:
        return last_skill
    if "unreachable_elevation" in s:
        return "goto"
    if "deposit_" in s:
        return "deposit"
    if "water_blocks_land_travel" in s:
        return "explore"
    if "repeat_loop" in s:
        return last_skill
    return None


def hint_call(hint):
    """Turn the common hint shapes into (skill, args) or (skill, None)."""
    m = re.match(r"(gather|mine|craft|smelt|deposit|withdraw|place|goto|explore) with ([a-z_]+)=([a-z0-9_\-]+)", hint)
    if m:
        return m.group(1), {m.group(2): m.group(3)}
    m = re.search(r"use (?:the )?(?:skill )?([a-z_]+)(?: skill)?\b", hint)
    if m:
        return m.group(1), None
    m = re.match(r"(goto|explore|deposit|mine|surface|home|craft|smelt)\b", hint)
    if m:
        return m.group(1), None
    return None, None


def build(x, all_skills):
    secs = parse(x["prompt"])
    last = (secs.get("LAST ACTION") or [""])[0]
    last_skill = (re.match(r"([a-z_]+)", last) or [None, None])[1] if last else None
    events = secs.get("RECENT EVENTS", [])
    # refusals per skill, latest reason kept
    refusals, latest = {}, {}
    prev_skill = None                                  # repeat_loop names no skill: it is the action proposed just before
    for e in events:
        m = re.match(r"^-?\s*([a-z_]+) -> ", e)
        if m:
            prev_skill = m.group(1)
        # Codex review: an exclusion clears when the world state changes. A later successful move or a relocation
        # means the bot is somewhere else, so earlier refusals no longer apply.
        if ("-> success" in e and "moved" in e) or "relocated toward" in e:
            refusals, latest = {}, {}
            continue
        if "rejected:" in e:
            sk = refused_skill(e, prev_skill or last_skill)
            if sk == "rejected":                       # "...rejected with these args" phrasing names no skill
                sk = prev_skill or last_skill
            if sk:
                refusals[sk] = refusals.get(sk, 0) + 1
                latest[sk] = re.sub(r"^-?\s*rejected:\s*", "", e).strip()[:220]
    menu = [s for s in all_skills if s not in DROP and not (s in refusals and refusals[s] >= 2)]
    hunger = re.search(r"hunger (\d+)/", " ".join(secs.get("STATE", [])))
    if hunger and int(hunger.group(1)) >= 14 and "eat" in menu:
        menu.remove("eat")                                                  # eat only offered when hungry
    for f in FALLBACK:
        if f not in menu and f in all_skills:
            menu.append(f)
    # hint
    hint = " ".join(secs.get("HINT", []))
    hs, ha = hint_call(hint) if hint else (None, None)
    rec = []
    if hint:
        if hs and hs not in menu:
            rec = [f"(The usual next step, {hs}, is blocked right now; choose another way toward the task.)"]
        elif hs and ha:
            rec = [f"{hs} {json.dumps(ha)} -- {hint}"]
        else:
            rec = [hint]
    blocked = []
    for sk, why in latest.items():
        state = "off the menu for now" if sk not in menu else "allowed only with DIFFERENT arguments"
        blocked.append(f"- {sk}: {state}. Last refusal: {why}")
    # events: drop rejected lines, de-duplicate consecutive repeats, keep last 6
    ev, prev = [], None
    for e in events:
        if "rejected:" in e or e == prev:
            continue
        ev.append(e)
        prev = e
    ev = ev[-6:]
    lessons = secs.get("LESSONS FROM PAST RUNS", [])
    fails = [l for l in lessons if "failed" in l or "avoid" in l][:3]
    works = [l for l in lessons if "worked" in l][:2]
    out = {"TASK": secs.get("TASK", []), "RECOMMENDED": rec, "PROGRESS": secs.get("PROGRESS", []), "BLOCKED": blocked,
           "RECENT EVENTS": ev, "LESSONS": fails + works}
    for k in SECTION_ORDER:
        if k not in out and k in secs:
            out[k] = secs[k]
    lines = []
    for k in SECTION_ORDER:
        v = [l for l in out.get(k, []) if l]
        if not v:
            continue
        if len(v) == 1 and k not in ("BLOCKED", "RECENT EVENTS", "LESSONS"):
            lines.append(f"{k}: {v[0]}")
        else:
            lines.append(f"{k}:")
            lines += [("  " + l if not l.startswith("-") else "  " + l) for l in v]
    return "\n".join(lines), menu, {"refusals": refusals, "hint_skill": hs, "hint_withheld": bool(hint and hs and hs not in menu)}


def system_prompt(ref_lines, menu):
    sel = [l for l in ref_lines if any(l.startswith(f"- {s}:") for s in menu)]
    return ("You are an autonomous Minecraft bot. Choose exactly ONE next skill from the menu and its arguments.\n"
            "Reply with one compact JSON object: {\"reason\": short why, \"skill\": name, \"args\": {...}}.\n"
            "SKILLS ON THE MENU (args are a JSON object keyed by the names listed):\n" + "\n".join(sel))


if __name__ == "__main__":
    src, ref, out = sys.argv[1:4]
    ref_lines = [l.rstrip() for l in open(ref) if l.startswith("- ")]
    all_skills = [re.match(r"- ([a-z_]+):", l).group(1) for l in ref_lines]
    n = 0
    with open(out, "w") as f:
        for line in open(src):
            x = json.loads(line)
            u3, m3, meta = build(x, all_skills)
            old_user = "\n".join(l for l in x["prompt"].splitlines() if not l.startswith("saw_end:"))
            f.write(json.dumps({"id": x["id"], "model_logged": x.get("model"), "logged_skill": x["logged_skill"],
                                "logged_args": x.get("logged_args"), "v0": {"system": system_prompt(ref_lines, all_skills), "user": old_user, "menu": all_skills},
                                "v3": {"system": system_prompt(ref_lines, m3), "user": u3, "menu": m3}, "meta": meta}) + "\n")
            n += 1
    print("items", n)
