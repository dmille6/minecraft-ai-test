#!/usr/bin/env python3
"""Turn a real production failure into a test fixture.

    # what is failing, ranked -- start here
    scripts/fixture-from-telemetry.py --survey

    # capture one class as a fixture
    scripts/fixture-from-telemetry.py --match "no pickaxe" --name mine_without_pickaxe

THE LOOP THIS CLOSES

A failure appears in the fleet. Today the response is: read logs, form a theory,
edit code, deploy, restart eight bots, wait, measure. That is how all six defects
on 2026-08-07 were found, and three of them took two or three rounds of it --
each round perturbing the trial it was meant to measure.

With this, the response is: capture the exact state that produced the failure,
write one assertion against it, and it can never come back silently. The suite
only grows. `scripts/preflight.sh` runs it before anything reaches a fleet.

WHAT IT CAPTURES

The bot state at the moment of failure -- position, inventory, health, what was
nearby, the skill and args attempted, the failure detail. That is enough to
rebuild a micro-world (see bots/test/helpers/microworld.mjs) and assert on the
decision, with no server and no model.

WHAT IT DOES NOT CAPTURE

The surrounding blocks. Telemetry records where the bot was, not what was around
it -- so a fixture is a starting point for a micro-world, not the world itself.
For the shaft that killed 134 bots the fixture gives you x=28,y=31,z=0 and
"fell 45 blocks"; you still write `shaft(...)` by hand. That is the honest
boundary, and it is why the geometry helpers are hand-built.
"""
import argparse, collections, json, os, re, subprocess, sys, textwrap

DEFAULT_HOSTS = ["mike@10.0.0.187", "mike@192.168.193.40"]
KEY = os.environ.get("AGENT_KEY", os.path.expanduser("~/.ssh/id_ed25519_aiservers"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bots", "test", "fixtures")


def pull(host, lines):
    r = subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host,
         f"sudo tail -q -n {lines} /srv/mcbots/logs/skill-*.jsonl 2>/dev/null"],
        capture_output=True, text=True, timeout=120)
    out = []
    for l in r.stdout.splitlines():
        try:
            out.append(json.loads(l))
        except Exception:
            continue
    return out


def normalise(detail):
    """Group failures by SHAPE, so coordinates and counts do not fragment them."""
    return re.sub(r"-?\d+(\.\d+)?", "N", detail or "")[:90]


def survey(docs):
    shapes = collections.Counter()
    for d in docs:
        sk = d.get("skill") or {}
        if sk.get("status") in ("failed", "aborted") or sk.get("name") == "_death":
            shapes[(sk.get("name"), normalise(sk.get("detail")))] += 1
    print(f"  {len(docs)} records; {sum(shapes.values())} failures\n")
    print(f"  {'count':>6}  {'skill':<12} shape")
    for (skill, shape), n in shapes.most_common(25):
        print(f"  {n:>6}  {str(skill):<12} {shape}")
    print("\n  Pick one and re-run with --match '<substring>' --name <fixture_name>")


def capture(docs, match, name, limit):
    hits = []
    for d in docs:
        sk = d.get("skill") or {}
        if match.lower() not in (sk.get("detail") or "").lower():
            continue
        b = d.get("bot") or {}
        hits.append({
            "ts": d.get("@timestamp"),
            "bot": b.get("name"),
            "skill": sk.get("name"),
            "args": sk.get("args") or {},
            "status": sk.get("status"),
            "detail": sk.get("detail"),
            "fail_class": sk.get("fail_class"),
            "pos": b.get("pos") or {},
            "health": b.get("health"),
            "food": b.get("hunger"),
            "inventory": b.get("inventory") or {},
            "nearby": (d.get("perception") or {}).get("blocks") or {},
            "code_version": (d.get("code") or {}).get("version"),
        })
        if len(hits) >= limit:
            break
    if not hits:
        print(f"  no records matching {match!r}")
        return 1

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.json")
    with open(path, "w") as fh:
        json.dump({"match": match, "captured": len(hits), "cases": hits}, fh, indent=2)
    print(f"  wrote {os.path.relpath(path)}  ({len(hits)} cases)\n")

    ex = hits[0]
    print("  first case:")
    print(f"    {ex['bot']} {ex['skill']}({json.dumps(ex['args'])}) -> {ex['status']}")
    print(f"    {ex['detail']}")
    print(f"    at {ex['pos'].get('x')},{ex['pos'].get('y')},{ex['pos'].get('z')} "
          f"hp={ex['health']} inv={dict(list(ex['inventory'].items())[:5])}")
    print(f"\n  --- test skeleton (bots/test/{name}.test.mjs) ---\n")
    print(textwrap.dedent(f'''\
        /**
         * Captured from production: {ex['detail']}
         * {len(hits)} occurrences, first seen {ex['ts']}, on {ex['code_version']}.
         */
        import assert from 'node:assert'
        import {{ readFileSync }} from 'node:fs'
        import {{ makeBot, V, plain }} from './helpers/microworld.mjs'

        const fx = JSON.parse(readFileSync(new URL('./fixtures/{name}.json', import.meta.url)))

        for (const c of fx.cases) {{
          const bot = makeBot({{
            pos: new V(c.pos.x, c.pos.y, c.pos.z),
            blocks: plain(),                      // <-- build the real geometry here
            health: c.health, inventory: c.inventory,
          }})
          // ASSERT THE PROPERTY THAT WAS VIOLATED, not that the code runs.
          // e.g. assert.equal(admissible(c.skill, c.args, bot), false)
        }}
    ''').rstrip())
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", action="store_true", help="rank current failure shapes")
    ap.add_argument("--match", help="substring of the failure detail to capture")
    ap.add_argument("--name", help="fixture name (also the test file name)")
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--lines", type=int, default=8000)
    ap.add_argument("--hosts", nargs="*", default=DEFAULT_HOSTS)
    a = ap.parse_args()

    docs = []
    for h in a.hosts:
        try:
            got = pull(h, a.lines)
            print(f"  {h}: {len(got)} records")
            docs += got
        except Exception as e:
            print(f"  {h}: unreachable ({e})")
    if not docs:
        print("  no telemetry reachable")
        return 2
    print()

    if a.survey or not a.match:
        survey(docs)
        return 0
    if not a.name:
        print("  --name is required with --match")
        return 2
    return capture(docs, a.match, a.name, a.limit)


if __name__ == "__main__":
    sys.exit(main())
