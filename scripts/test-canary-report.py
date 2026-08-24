#!/usr/bin/env python3
"""The report that decides whether a change ships gets tested like anything else.

Its whole reason to exist is that event COUNTS misled me into reverting on
2026-08-24, so the first thing to prove is that it distinguishes "louder" from
"worse" -- a change that triples the event volume while improving every outcome
must PASS, and a change that quietly halves gathering must FAIL.
"""
import datetime, importlib.util, json, os, sys, tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("cr", Path(__file__).parent / "canary-report.py")
cr = importlib.util.module_from_spec(spec); spec.loader.exec_module(cr)

P = F = 0
def t(name, fn):
    global P, F
    try:
        fn(); P += 1; print(f"  PASS  {name}")
    except AssertionError as e:
        F += 1; print(f"  FAIL  {name}\n        {e}")

NOW = datetime.datetime(2026, 8, 25, 12, 0, tzinfo=datetime.timezone.utc)

def ev(bot, kind, sec, x=0, y=64, z=0, status="success"):
    return (NOW + datetime.timedelta(seconds=sec),
            {"bot": {"name": bot, "pos": {"x": x, "y": y, "z": z}},
             "skill": {"name": "_" + kind, "status": status}})

def world(bots, per_bot):
    """{bot: [(t, doc)]} built by calling per_bot(bot, i)."""
    return {b: sorted(per_bot(b, i), key=lambda r: r[0]) for i, b in enumerate(bots)}

def moving(bot, base, n, kinds, span=1200):
    """n events spread over `span` seconds, moving far enough each 5-minute
    bucket to count as exposed.

    SPAN IS EXPLICIT because the first version of this helper derived the
    duration from the event COUNT, so a fixture with three times the events
    also covered three times the wall clock and therefore three times the
    exposure. That made the two arms incomparable and failed the very test that
    exists to prove volume and outcome are different things -- the fixture
    reproducing the bug it was written to catch.
    """
    out = []
    for i in range(n):
        sec = base + (i * span // max(n - 1, 1))
        # x tracks the clock, so displacement inside any 5-minute bucket is
        # always well past the 8-block exposure threshold regardless of how many
        # events the fixture contains. Deriving position from the event INDEX
        # made exposure depend on event density, which is the confound this
        # whole script exists to avoid.
        out.append(ev(bot, kinds[i % len(kinds)], sec, x=sec))
    return out

# --- it must not call "louder" "worse" ---------------------------------------

def louder_but_better():
    """3x the water events, but episodes end on land and gathering is unchanged.
    This is the exact shape that made me revert a change on event counts alone."""
    def canary(b, i):
        out = moving(b, 0, 60, ["oxygen_critical_state", "drowning_up", "drowning_escaped"], span=1200)
        out += [ev(b, "gather", 5 + j * 30) for j in range(30)]
        return out
    def ctrl(b, i):
        out = moving(b, 0, 20, ["oxygen_critical_state", "drowning_surfaced_stranded"])
        out += [ev(b, "gather", 5 + j * 30) for j in range(30)]
        return out
    rows = {**world(["hive-a-A", "hive-a-B"], canary), **world(["hive-b-A", "hive-b-B"], ctrl)}
    c = cr.summarise(rows, ["hive-a-A", "hive-a-B"])
    k = cr.summarise(rows, ["hive-b-A", "hive-b-B"])
    assert c["water_events"] > k["water_events"] * 2, "fixture is not actually louder"
    assert c["escape_rate"] > k["escape_rate"], (
        f"escape rate {c['escape_rate']} vs {k['escape_rate']} — the report cannot "
        f"see that the noisy arm is the one reaching land")
    assert abs(c["gather_per_exp"] - k["gather_per_exp"]) < 0.5 * k["gather_per_exp"], (
        f"gathering differs ({c['gather_per_exp']:.1f} vs {k['gather_per_exp']:.1f}) — "
        f"the two arms are not comparable, so the test proves nothing")

t("A LOUDER CHANGE THAT REACHES LAND MORE OFTEN IS NOT A WORSE CHANGE", louder_but_better)


def quieter_but_worse():
    """Half the water events and half the gathering. Volume says better,
    the outcome says worse, and the outcome is what the gates read."""
    def canary(b, i):
        out = moving(b, 0, 10, ["oxygen_critical_state"])
        out += [ev(b, "gather", 5 + j * 30) for j in range(8)]
        return out
    def ctrl(b, i):
        out = moving(b, 0, 20, ["oxygen_critical_state"])
        out += [ev(b, "gather", 5 + j * 30) for j in range(30)]
        # FAILED gathers, which are not harvest. The control tries far more
        # often and succeeds no more; a report that counted attempts would call
        # this arm productive on the strength of its flailing.
        out += [ev(b, "gather", 12 + j * 30, status="failed") for j in range(60)]
        return out
    rows = {**world(["hive-a-A"], canary), **world(["hive-b-A"], ctrl)}
    c = cr.summarise(rows, ["hive-a-A"]); k = cr.summarise(rows, ["hive-b-A"])
    assert c["water_events"] < k["water_events"], "fixture is not quieter"
    ratio = c["gather_per_exp"] / k["gather_per_exp"]
    assert ratio < 0.9, f"gather ratio {ratio:.2f} — a halved harvest read as fine"
    assert k["gathers"] == 30, (
        f"control harvest counted as {k['gathers']} from 30 successes and 60 "
        f"failures — attempts are not output")

t("A QUIETER CHANGE THAT HALVES THE HARVEST STILL FAILS", quieter_but_worse)

# --- episodes, not events ----------------------------------------------------

def episodes_group():
    def one(b, i):
        # two episodes: a burst, a 5-minute silence, another burst
        # Tight spacing: events inside one episode arrive far closer together
        # than EPISODE_GAP_S, which is what makes them one episode.
        return (moving(b, 0, 12, ["drowning_up"], span=120)
                + moving(b, 600, 12, ["drowning_up"], span=120)
                + [ev(b, "gather", 900)])
    rows = world(["hive-a-A"], one)
    s = cr.summarise(rows, ["hive-a-A"])
    assert s["episodes"] == 2, f"{s['water_events']} events became {s['episodes']} episodes"

t("contiguous trouble is ONE episode, not twenty-four", episodes_group)


def gap_splits():
    def one(b, i):
        return (moving(b, 0, 4, ["drowning_up"], span=60)
                + moving(b, 5000, 4, ["drowning_up"], span=60))
    s = cr.summarise(world(["hive-a-A"], one), ["hive-a-A"])
    assert s["episodes"] == 2, f"a long silence did not split the episodes ({s['episodes']})"

t("a long quiet gap splits episodes", gap_splits)

# --- denominators and refusals ----------------------------------------------

def refuses_thin_data():
    def one(b, i): return [ev(b, "drowning_up", 0)]
    s = cr.summarise(world(["hive-a-A"], one), ["hive-a-A"])
    assert s["exposure"] == 0, "a bot that never moved was counted as exposed"

t("a bot that never moved contributes no exposure", refuses_thin_data)


def exposure_is_3d():
    """A bot climbing a shaft moves 0 horizontally. Block 1 caught this with a
    control bot that moved 6 blocks vertically and 0.00 horizontally."""
    def one(b, i):
        return [(NOW + datetime.timedelta(seconds=s),
                 {"bot": {"name": b, "pos": {"x": 0, "y": 64 + s // 10, "z": 0}},
                  "skill": {"name": "_gather", "status": "success"}}) for s in range(0, 200, 10)]
    s = cr.summarise(world(["hive-a-A"], one), ["hive-a-A"])
    assert s["exposure"] > 0, "a climbing bot was scored as motionless"

t("exposure is measured in 3D", exposure_is_3d)


def gates_are_declared():
    keys = {g[1] for g in cr.GATES}
    assert "escape_rate" in keys and "gather_ratio" in keys, "the gates lost an outcome"
    assert len(cr.GATES) >= 5, "gates were quietly dropped"

t("the acceptance gates are declared in the file, not argued afterwards", gates_are_declared)

print(f"\n  {P} passed, {F} failed")
sys.exit(1 if F else 0)
