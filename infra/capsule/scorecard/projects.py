#!/usr/bin/env python3
# Read-only: the newest record of every town project in a pool directory -> one row per plot. Usage: projects.py <pool dir>
import glob, json, os, re, sys, collections
D = sys.argv[1]
best = {}
for f in glob.glob(os.path.join(D, "project-0_70_0.*.json")):
    m = re.match(r"project-0_70_0\.([A-Za-z0-9_]+)\.g(\d+)\.json$", os.path.basename(f))
    if m and int(m.group(2)) >= best.get(m.group(1), (-1, ""))[0]:
        best[m.group(1)] = (int(m.group(2)), f)
rows = []
for plot, (g, f) in sorted(best.items()):
    d = json.load(open(f))
    rows.append({"plot": plot, "blueprint": d.get("blueprint"), "gen": g, "state": d.get("state"), "structure_complete": d.get("structure_complete"),
                 "cells": len(d.get("cells") or []), "completeAt": d.get("completeAt"), "at": d.get("at")})
out = {"files": len(glob.glob(os.path.join(D, "project-0_70_0.*.json"))), "plots": len(rows),
       "by_state": collections.Counter(str(r["state"]) for r in rows), "structure_complete": sum(1 for r in rows if r["structure_complete"]), "rows": rows}
json.dump(out, sys.stdout, indent=1)
