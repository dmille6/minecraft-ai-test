#!/usr/bin/env python3
"""affordance-funnel.py -- where a capability stops being used, not whether.

    scripts/affordance-funnel.py --minutes 120 [--version b9436d5] [--arm hive-a]

WHY A FUNNEL AND NOT A COUNT

The obvious check on a newly shipped skill is "did anyone use it". I proposed
exactly that and it is the wrong instrument, for the reason a zero is always the
wrong instrument: it is one number covering five different failures.

    eligible -> prompted -> selected -> admitted -> started -> succeeded

swim_to had zero uses. So would a swim_to that no bot was ever in water for, one
the prompt never mentioned, one the model saw and declined, one the admission
gate vetoed, and one that crashed on every call. Those are five different days
of work. The count cannot tell them apart; the first broken EDGE names which
one, immediately, on the deploy that broke it.

Measured against the four failures that produced this script:

    swim_to shipped        eligible 400+, prompted 0     -> the renderer
    IN WATER without a     prompted N, selected N,       -> the wording
      destination            admitted N, succeeded 0
    deposit_surplus        eligible 0                    -> the gate is unreachable
    tool equivalence       eligible N, prompted 0        -> the renderer

ELIGIBILITY COMES FROM THE SNAPSHOT, NOT THE PROMPT

This is the part that makes the first edge mean anything. Every record carries
both the rendered prompt text and an independent snapshot of the bot -- position,
inventory, held item -- plus a perception scan taken by different code. So
`eligible` is recomputed here from the snapshot, and `prompted` is read from the
prompt. When the two disagree, that disagreement is the finding, and it is only
visible because the two answers do not come from the same function. Deriving
eligibility from the prompt line would make every edge pass by construction.

The rules are approximate on purpose and the report says so: `in_water` reads a
perception scan that also fires standing on a beach, so it OVER-counts. That is
the safe direction. An over-counted eligible makes "eligible 400, prompted 0"
slightly noisy and still unmistakable; an under-counted one hides the bug.

The contracts come from bots/src/affordances.json, which is also what
bots/test/affordance-contract.test.mjs renders prompts against, so a skill
cannot be measured here under a marker the prompt never emits.
"""
import argparse, datetime, glob, json, sys
from pathlib import Path

import gzip as _gzip
def _openlog(p):
    """Rotated telemetry is gzipped; a plain open() would parse compressed bytes
    as text and silently yield nothing. See scripts/lib/telemetry.py:open_log."""
    return _gzip.open(p, 'rt', errors='replace') if p.endswith('.gz') else open(p, errors='replace')

ROOT = Path(__file__).resolve().parent.parent
REG = json.loads((ROOT / "bots/src/affordances.json").read_text())

EDGES = ["eligible", "prompted", "selected", "admitted", "started", "succeeded"]

# Above this share of records the rule could not classify, the funnel reports
# nothing rather than something. See the comment at the check itself.
MAX_UNKNOWN = 0.20

HINTS = {
    "bankable_surplus": "pass --home x,z (the town centre from /srv/block2/town-<arm>.json).",
}


# ---------------------------------------------------------- eligibility ----
#
# Each rule answers "was this bot, at this decision, in a state where the
# affordance applies" using ONLY the snapshot and perception -- never the prompt.
# Returning None means "cannot tell from this record", which is counted
# separately and never folded into False. Same rule as lib/probe.py: a source
# that can say "I don't know" may not be typed as a boolean.

def _inv(rec):
    return (rec.get("bot") or {}).get("inventory") or {}


def in_water(rec):
    """Standing in or at the edge of water.

    perception.blocks is a findBlock sweep run by state.mjs, entirely separate
    from prompt.mjs's blockAt read -- which is the point. OVER-counts: a bot on a
    shoreline reads distance 0-1 without being in the water.
    """
    per = rec.get("perception")
    if not per or "blocks" not in per:
        return None
    d = (per.get("blocks") or {}).get("water")
    return d is not None and d <= 1


# Any cobblestone-family block works for the stone tier in 1.21.8, which is the
# fact isolated-a-Alpha spent ten hours not knowing.
_COBBLE = ("cobblestone", "cobbled_deepslate", "blackstone", "andesite",
           "diorite", "granite", "tuff", "stone")


def can_craft_stone_tier(rec):
    """Carrying the ingredients for the next rung, computed from raw counts.

    Deliberately NOT bot.recipesFor -- that is what the prompt uses. Counting
    blocks and sticks by hand is cruder and independent, and the crudeness is
    visible in the report rather than hidden in an agreement.
    """
    inv = _inv(rec)
    if not inv:
        return None
    rock = sum(int(v) for k, v in inv.items() if k in _COBBLE)
    sticks = int(inv.get("stick", 0))
    planks = sum(int(v) for k, v in inv.items() if k.endswith("_planks"))
    logs = sum(int(v) for k, v in inv.items() if k.endswith("_log"))
    if rock >= 3 and sticks >= 2:
        return True
    # The wooden rung counts too: the observation covers the whole ladder.
    return (planks >= 3 or logs >= 1) and (sticks >= 2 or planks >= 2)


_JUNK = {"crafting_table", "leaf_litter", "brown_egg", "bamboo", "oak_sapling",
         "short_grass", "seagrass", "dirt", "rooted_dirt", "poppy", "dandelion"}


def bankable_surplus(rec):
    """Carrying enough real output that banking it is worth doing.

    Mirrors bankable.mjs's SHAPE (junk excluded, one tool per family kept, 8
    climb-out blocks reserved) without calling it, and applies depositDue's
    distance clause. This is the rule that would have said `eligible 0` about
    deposit_surplus in its first hour instead of six bot-hours later.
    """
    inv = _inv(rec)
    if not inv:
        return None
    pos = (rec.get("bot") or {}).get("pos")
    real = sum(int(v) for k, v in inv.items()
               if k not in _JUNK and not k.endswith(("_pickaxe", "_axe", "_sword", "_shovel", "_hoe")))
    real = max(0, real - 8)                      # the climb-out reserve is not surplus
    if real < 12:
        return False
    if pos is None:
        return None
    home = (rec.get("_home") or {})
    hx, hz = home.get("x"), home.get("z")
    if hx is None:
        return None
    dist = ((pos["x"] - hx) ** 2 + (pos["z"] - hz) ** 2) ** 0.5
    return dist <= 96


RULES = {
    "in_water": in_water,
    "can_craft_stone_tier": can_craft_stone_tier,
    "bankable_surplus": bankable_surplus,
}

APPROXIMATION = {
    "in_water": "over-counts: a shoreline reads water at distance 0-1",
    "can_craft_stone_tier": "counts blocks and sticks by hand, not the recipe book",
    "bankable_surplus": "needs a home position; records without one count as unknown",
}


# --------------------------------------------------------------- reading ----

def load(paths, since, version=None, arm=None, home=None):
    rows, newest = [], None
    for f in glob.glob(paths):
        try:
            fh = _openlog(f)
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                try:
                    t = datetime.datetime.fromisoformat(
                        d.get("@timestamp", "").replace("Z", "+00:00"))
                except Exception:
                    continue
                if newest is None or t > newest:
                    newest = t
                if since and t < since:
                    continue
                if version and (d.get("code") or {}).get("version", "").split("+")[0] != version:
                    continue
                if arm and (d.get("exp") or {}).get("arm") != arm:
                    continue
                if home:
                    d["_home"] = home
                rows.append(d)
    # telemetry.py's lesson, restated: a window that cannot contain anything is a
    # clock bug, not a finding, and it costs nothing to say so before the report.
    if since and newest and since > newest:
        raise SystemExit(
            f"window starts {since:%H:%M:%S}Z but the newest record on disk is "
            f"{newest:%H:%M:%S}Z — the window is in the future")
    return rows, newest


def funnel(rows, contract):
    rule = RULES[contract["eligibility"]]
    marker, skill = contract["observation"], contract["skill"]
    n = dict.fromkeys(EDGES, 0)
    unknown = 0
    for r in rows:
        e = rule(r)
        if e is None:
            unknown += 1
            continue
        if not e:
            continue
        n["eligible"] += 1
        text = ((r.get("prompt") or {}).get("text") or "")
        if marker not in text:
            continue
        n["prompted"] += 1
        calls = r.get("tool_calls") or []
        if not calls or calls[0].get("skill") != skill:
            continue
        n["selected"] += 1
        # `llm.admission` is the door the decision came through and is null when
        # nothing was admitted -- the gate's own record, not an inference.
        if (r.get("llm") or {}).get("admission") is None:
            continue
        n["admitted"] += 1
        status = (r.get("outcome") or {}).get("status")
        if status is None:
            continue
        n["started"] += 1
        if status == "success":
            n["succeeded"] += 1
    return n, unknown


def first_broken_edge(n):
    """The edge where the population collapses, which is the actionable one.

    A drop is 'broken' at zero, or when it loses more than 90% -- the second
    catches "the model sees it and almost never picks it", which is a wording
    problem and looks nothing like a plumbing problem.
    """
    prev_name, prev = EDGES[0], n[EDGES[0]]
    if prev == 0:
        return EDGES[0], None, 0.0
    for name in EDGES[1:]:
        cur = n[name]
        if cur == 0 or cur < prev * 0.10:
            return prev_name, name, (cur / prev if prev else 0.0)
        prev_name, prev = name, cur
    return None, None, 1.0


DIAGNOSIS = {
    ("eligible", None):      "the situation never occurs — the precondition is unreachable in the fleet's real distribution (this is deposit_surplus)",
    ("eligible", "prompted"): "the state is real and the OBSERVATION never names it — the model cannot choose what it cannot see (this is swim_to)",
    ("prompted", "selected"): "the model is told and does not pick it — a wording or competing-affordance problem, not a plumbing one",
    ("selected", "admitted"): "the model picks it and the ADMISSION GATE vetoes it — check admission.mjs rules for this skill",
    ("admitted", "started"):  "admitted and never ran — a runner or arguments problem",
    ("started", "succeeded"): "it runs and never works — the skill itself",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paths", default="/var/log/mcai/*/llm-*.jsonl*")
    ap.add_argument("--minutes", type=int, default=120)
    ap.add_argument("--version")
    ap.add_argument("--arm")
    ap.add_argument("--home", help="x,z of town, needed by bankable_surplus")
    a = ap.parse_args()

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=a.minutes)
    home = None
    if a.home:
        hx, hz = a.home.split(",")
        home = {"x": float(hx), "z": float(hz)}
    rows, newest = load(a.paths, since, a.version, a.arm, home)

    # DENOMINATORS FIRST, ALWAYS. Every number below is meaningless without
    # them, and printing them after the conclusion is printing them too late.
    print(f"\n  decisions   {len(rows)}")
    print(f"  window      last {a.minutes}m"
          + (f", version {a.version}" if a.version else "")
          + (f", arm {a.arm}" if a.arm else ""))
    print(f"  newest      {newest:%Y-%m-%d %H:%M:%S}Z" if newest else "  newest      none")
    bots = {(r.get("bot") or {}).get("name") for r in rows}
    print(f"  bots        {len(bots - {None})}")
    if not rows:
        print("\n  NO RECORDS IN THE WINDOW — nothing below would mean anything.\n")
        return 2

    worst = 0
    for c in REG["contracts"]:
        n, unknown = funnel(rows, c)
        print(f"\n  {c['skill']}  ({c['observation'].strip()})")
        print(f"    eligibility {c['eligibility']} — {APPROXIMATION[c['eligibility']]}")
        # A DIAGNOSIS OVER MOSTLY-UNCLASSIFIABLE DATA IS THE BUG THIS SCRIPT
        # EXISTS TO CATCH, and this script committed it on its first live run.
        # With no --home the deposit rule could classify 658 of 4,564 records,
        # every one of them ineligible -- and the report announced "the
        # situation never occurs", which is a claim about the fleet made from
        # 14% of it. Same rule as Survey.report() in lib/probe.py: an
        # instrument that did not pass its own preconditions does not get to
        # publish a conclusion.
        share = unknown / len(rows)
        if unknown:
            print(f"    unknown     {unknown} of {len(rows)} records "
                  f"({100 * share:.0f}%) could not be classified")
        if share > MAX_UNKNOWN:
            print(f"    -> INSUFFICIENT: {100 * share:.0f}% unclassifiable "
                  f"(limit {100 * MAX_UNKNOWN:.0f}%). No edge is reportable. "
                  f"{HINTS.get(c['eligibility'], '')}")
            continue
        prev = None
        for e in EDGES:
            share = "" if prev in (None, 0) else f"  ({100.0 * n[e] / prev:.0f}% of previous)"
            print(f"    {e:<10} {n[e]:>6}{share}")
            prev = n[e]
        src, dst, ratio = first_broken_edge(n)
        if src is None:
            print("    -> no broken edge")
        else:
            worst = max(worst, 1)
            edge = f"{src} -> {dst}" if dst else f"{src} is zero"
            print(f"    -> FIRST BREAK AT {edge}: {DIAGNOSIS[(src, dst)]}")

    # The gaps, every run, so a known silence stays a known silence rather than
    # becoming a thing nobody looks at any more.
    print("\n  declared gaps (no observation exists; see bots/src/affordances.json)")
    for name, g in REG["gaps"].items():
        used = sum(1 for r in rows
                   if (r.get("tool_calls") or [{}])[0].get("skill") == name)
        print(f"    {name:<10} selected {used:>5} of {len(rows)} decisions — {g['watch']}")
    print()
    return worst


if __name__ == "__main__":
    sys.exit(main())
