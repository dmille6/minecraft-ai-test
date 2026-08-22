#!/usr/bin/env python3
"""Whitelist each world's own five bots, and verify it took.

online-mode=false is unavoidable (mineflayer bots have no Microsoft accounts),
which makes the whitelist the ONLY thing stopping anyone on the LAN from joining
as any username -- including as a bot, mid-block.
"""
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("pt", Path("/home/mike/scripts/place-town.py"))
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
