#!/usr/bin/env python3
"""Whitelist each world's own five bots, and verify it took.

online-mode=false is unavoidable (mineflayer bots have no Microsoft accounts),
which makes the whitelist the ONLY thing stopping anyone on the LAN from joining
as any username -- including as a bot, mid-block.
"""
import importlib.util, sys
from pathlib import Path
# BESIDE THIS FILE, not in somebody's home directory. The absolute path here
# was /home/mike/scripts/place-town.py, so this script worked only from one
# checkout on one host and failed with an unhelpful import error anywhere else
# -- including from the repo clone the deploy script maintains. pregen-world.py
# next door already does it relatively; this is the same fix.
spec = importlib.util.spec_from_file_location(
    "pt", Path(__file__).resolve().parent / "place-town.py")
pt = importlib.util.module_from_spec(spec); spec.loader.exec_module(pt)

MC_NAME_MAX = 16
# "Charlie" (7) + "isolated-a-" (11) = 18 > 16, and Minecraft rejects the login
# as a protocol error. generate-roster.py was fixed to use "Comet"; THIS FILE WAS
# NOT, so it whitelisted a bot that does not exist and never whitelisted the one
# that does. Keep the two lists identical.
NAMES = ["Alpha", "Bravo", "Comet", "Delta", "Echo"]
bad = 0
for world, idx in sorted(pt.ARMS.items()):
    props = pt.ROOT / world / "server.properties"
    conf = dict(l.split("=", 1) for l in props.read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    r = pt.Rcon("127.0.0.1", int(conf["rcon.port"]), conf["rcon.password"].strip())
    want = [f"{world}-{n}" for n in NAMES]
    for b in want:
        r.run(f"whitelist add {b}")
    r.run("whitelist reload")
    listed = r.run("whitelist list")
    missing = [b for b in want if b not in listed]
    print(f"  {world:<12} {len(want)-len(missing)}/{len(want)} whitelisted"
          + (f"  MISSING {missing}" if missing else ""))
    bad += len(missing)
sys.exit(1 if bad else 0)
