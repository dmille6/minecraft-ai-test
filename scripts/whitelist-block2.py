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

NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]
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
