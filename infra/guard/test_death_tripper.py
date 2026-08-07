#!/usr/bin/env python3
"""Regression tests for the tripper's version rule.

Run: python3 infra/guard/test_death_tripper.py

The rule that motivated these: on 2026-08-07 the tripper stopped Gather02 for
falling, the next deploy moved the other seven bots to a new digest, and
Gather02's *final log line* -- written before it was stopped -- then disagreed
with the live fleet on every subsequent tick. The tripper stopped all eight bots
every five minutes for an hour. The bot it had already killed kept voting.
"""
import importlib.util, json, os, sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("tripper", os.path.join(HERE, "death-tripper.py"))
tripper = importlib.util.module_from_spec(spec)
sys.argv = [sys.argv[0]]                       # no --apply: never act from a test
spec.loader.exec_module(tripper)

FAILED = []

def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILED.append(name)

def line(bot, version, age_min):
    ts = datetime.now(timezone.utc) - timedelta(minutes=age_min)
    return json.dumps({"@timestamp": ts.isoformat().replace("+00:00", "Z"),
                       "bot": {"name": bot}, "code": {"version": version}})

def feed(lines, manifest=None):
    """Point version_check at a synthetic log and manifest."""
    class R:
        def __init__(self, out): self.stdout = out
    def fake_ssh(host, cmd, user="agent"):
        if "trial-manifest" in cmd:
            return R(json.dumps(manifest or {}))
        return R("\n".join(lines))
    tripper.ssh = fake_ssh
    return tripper.version_check()

NEW, OLD = "64eb591+3a0d45", "64eb591+da0280"


def test_stopped_bot_does_not_outvote_the_living():
    out = feed([line("Scout01", NEW, 1), line("Hive01", NEW, 2),
                line("Gather02", OLD, 40)])          # stopped 40m ago, old code
    check("a stopped bot's stale version is ignored", out == [], f"got {out}")


def test_real_partial_deploy_still_trips():
    out = feed([line("Scout01", NEW, 1), line("Gather02", OLD, 2)])   # both live
    check("a genuine partial deploy still trips", len(out) == 1 and out[0][0] == "ALL", f"got {out}")


def test_agreement_is_quiet():
    check("a fleet in agreement trips nothing",
          feed([line("Scout01", NEW, 1), line("Hive01", NEW, 3)]) == [])


def test_all_stale_is_not_a_fault():
    out = feed([line("Scout01", NEW, 90), line("Gather02", OLD, 95)])
    check("a fully stopped fleet is not a version fault", out == [], f"got {out}")


def test_missing_timestamp_is_not_assumed_fresh():
    bad = json.dumps({"bot": {"name": "Ghost"}, "code": {"version": OLD}})
    out = feed([line("Scout01", NEW, 1), bad])
    check("a line with no timestamp cannot cast a vote", out == [], f"got {out}")


def test_fresh_line_rescues_a_bot_seen_stale_earlier():
    # Restarted bots have BOTH an old stale line and a new fresh one in the tail.
    out = feed([line("Gather02", OLD, 40), line("Gather02", NEW, 1),
                line("Scout01", NEW, 1)])
    check("a restarted bot is judged on its newest line", out == [], f"got {out}")


def test_undeclared_version_still_trips():
    out = feed([line("Scout01", NEW, 1)], manifest={"declared_code_version": "deadbee"})
    check("running code the manifest does not declare still trips",
          len(out) == 1 and "undeclared" in out[0][1], f"got {out}")


if __name__ == "__main__":
    print("version_check")
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'all passed'}")
    sys.exit(1 if FAILED else 0)
