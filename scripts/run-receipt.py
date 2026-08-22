#!/usr/bin/env python3
"""Emit a machine-readable RECEIPT for the fleet as it stands right now.

WHY THIS EXISTS

Every dispute this project has had about its own past has been archaeology:
which seed was that world on, was the code committed when the env files were
written, did all eight arms really share a site, how many bots were actually
playing as opposed to how many units were green. Each answer took a shell
session and some of them were wrong.

A receipt is that session, run once, written down, and cheap enough to emit on
every start. It records what the world says, not what the config claims -- the
distinction that most of the failure taxonomy turns on. Two fields in particular
are asked FROM THE SERVER and not from a file: the seed and the roster, because
a server running defaults reports a different seed than the server.properties
sitting next to it, and systemd reports units rather than players.

It answers questions; it does not judge. Nothing here is a gate. A receipt that
refuses to be written is a receipt nobody emits.

  ./scripts/run-receipt.py --out docs/receipts/            # write a timestamped receipt
  ./scripts/run-receipt.py --print                          # to stdout, write nothing
  ./scripts/run-receipt.py --compare docs/receipts/a.json   # diff against an earlier one

Requires SSH to the worlds and bots hosts as the lab user.
"""
import argparse
import json
import re
import subprocess
import sys
import datetime
import pathlib

WORLDS_HOST = "mike@10.0.0.30"
BOTS_HOST = "mike@10.0.0.31"
KEY = "~/.ssh/id_ed25519_aiservers"
ARMS = ["hive-a", "hive-b", "board-a", "board-b",
        "isolated-a", "isolated-b", "placebo-a", "placebo-b"]


def sh(cmd, host=None, timeout=60):
    """Run a command locally or over SSH. Returns stdout, or '' on any failure.

    Deliberately swallowing errors: a receipt that aborts because one host is
    briefly unreachable is a receipt that does not get written on the day it
    would have mattered. A missing field is recorded as null and is itself
    information.
    """
    import os
    if host:
        full = ["ssh", "-i", os.path.expanduser(KEY), "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no", host, cmd]
    else:
        full = ["bash", "-lc", cmd]
    try:
        r = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def rcon_script(arm, command):
    """Ask the SERVER, not the config file. See module docstring."""
    py = (
        "import socket,struct,subprocess;"
        f"P=subprocess.run(['sudo','grep','-h','^rcon.port','/srv/block2/{arm}/server.properties'],"
        "capture_output=True,text=True).stdout.split('=')[1].strip();"
        f"W=subprocess.run(['sudo','grep','-h','^rcon.password','/srv/block2/{arm}/server.properties'],"
        "capture_output=True,text=True).stdout.split('=')[1].strip();"
        "pkt=lambda i,t,b:(lambda x:struct.pack('<i',len(x))+x)(struct.pack('<ii',i,t)+b.encode()+b'\\x00\\x00');"
        "s=socket.create_connection(('127.0.0.1',int(P)),timeout=15);"
        "s.send(pkt(1,3,W));"
        "rv=lambda: (lambda ln: (lambda d: d[8:-2].decode('utf-8','replace'))"
        "(b''.join(iter(lambda: s.recv(ln), b'')) if False else s.recv(ln)))"
        "(struct.unpack('<i',s.recv(4))[0]);"
        "rv();"
        f"s.send(pkt(2,2,{command!r}));print(rv())"
    )
    return sh(f"python3 -c {json.dumps(py)}", host=WORLDS_HOST)


def collect():
    now = datetime.datetime.now(datetime.timezone.utc)
    r = {
        "receipt_version": 1,
        "captured_at_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "code": {},
        "protocol": {},
        "worlds": {},
        "roster": {},
        "inference": {},
        "notes": [],
    }

    # --- code provenance: what is committed, and is the tree dirty? -----------
    r["code"]["git_sha"] = sh("git rev-parse --short HEAD")
    r["code"]["git_branch"] = sh("git rev-parse --abbrev-ref HEAD")
    dirty = sh("git status --porcelain")
    r["code"]["dirty_files"] = [l[3:] for l in dirty.splitlines()] if dirty else []
    r["code"]["is_dirty"] = bool(dirty)
    if dirty:
        r["notes"].append(
            "working tree is DIRTY: the running fleet may not match any commit")

    # --- protocol provenance: the frozen doc is the git object ---------------
    prereg = "docs/block2-preregistration.md"
    r["protocol"]["preregistration_path"] = prereg
    r["protocol"]["preregistration_sha"] = sh(
        f"git log -1 --format=%h -- {prereg}")
    r["protocol"]["amendments"] = int(sh(
        f"grep -ci '^## AMENDMENT' {prereg} || echo 0") or 0)

    # --- per-arm truth, asked of the server ---------------------------------
    for arm in ARMS:
        a = {}
        seed = rcon_script(arm, "seed")
        m = re.search(r"\[(-?\d+)\]", seed or "")
        a["seed_reported_by_server"] = int(m.group(1)) if m else None
        a["seed_in_config"] = None
        cfg = sh(f"sudo grep -h '^level-seed' /srv/block2/{arm}/server.properties",
                 host=WORLDS_HOST)
        if "=" in cfg:
            try: a["seed_in_config"] = int(cfg.split("=")[1])
            except ValueError: pass
        a["seed_matches_config"] = (
            a["seed_reported_by_server"] is not None
            and a["seed_reported_by_server"] == a["seed_in_config"])

        ver = sh(f"grep -ohm1 'This server is running Paper version [^ ]*' "
                 f"/srv/block2/{arm}/logs/latest.log", host=WORLDS_HOST)
        a["paper_version"] = ver.split()[-1] if ver else None

        lst = rcon_script(arm, "list")
        pm = re.search(r"There are (\d+) of", lst or "")
        a["players_online"] = int(pm.group(1)) if pm else None
        a["player_names"] = sorted(
            [n.strip() for n in (lst.split("online:")[-1].split(",") if lst and "online:" in lst else []) if n.strip()])

        town = sh(f"sudo cat /srv/block2/{arm}/TOWN-PLACED.json", host=WORLDS_HOST)
        try:
            t = json.loads(town)
            a["town_home"] = t.get("home")
            a["town_board"] = t.get("board")
        except Exception:
            a["town_home"] = a["town_board"] = None

        rf = sh(f"sudo find /srv/block2/{arm}/world/region -name '*.mca' | wc -l",
                host=WORLDS_HOST)
        a["region_files"] = int(rf) if rf.isdigit() else None
        r["worlds"][arm] = a

    # --- parity checks: the thing that is expensive to notice late -----------
    seeds = {a["seed_reported_by_server"] for a in r["worlds"].values()}
    towns = {json.dumps(a["town_home"]) for a in r["worlds"].values()}
    vers = {a["paper_version"] for a in r["worlds"].values()}
    regions = [a["region_files"] for a in r["worlds"].values() if a["region_files"] is not None]
    r["parity"] = {
        "distinct_seeds": len(seeds),
        "distinct_town_sites": len(towns),
        "distinct_paper_versions": len(vers),
        "region_file_min": min(regions) if regions else None,
        "region_file_max": max(regions) if regions else None,
    }
    for key, msg in (("distinct_seeds", "arms do NOT share a seed"),
                     ("distinct_town_sites", "arms do NOT share a town site"),
                     ("distinct_paper_versions", "arms run DIFFERENT Paper builds")):
        if r["parity"][key] > 1:
            r["notes"].append(msg)
    if regions and max(regions) > min(regions) * 1.25:
        r["notes"].append(
            f"terrain divergence: region files {min(regions)}..{max(regions)} "
            "-- an arm exploring fresh chunks pays tick time another arm does not")

    # --- roster: three sources that must agree ------------------------------
    units = sh("systemctl list-units --type=service --state=active --no-pager "
               "--plain | grep -c 'mcbot@'", host=BOTS_HOST)
    procs = sh("pgrep -f 'src/index.mjs' | wc -l", host=BOTS_HOST)
    playing = sum(a["players_online"] or 0 for a in r["worlds"].values())
    r["roster"] = {
        "systemd_active_units": int(units) if units.isdigit() else None,
        "node_processes": int(procs) if procs.isdigit() else None,
        "players_in_world": playing,
        "per_arm": {k: v["players_online"] for k, v in r["worlds"].items()},
    }
    counts = [v for v in r["roster"]["per_arm"].values() if v is not None]
    if counts and len(set(counts)) > 1:
        r["notes"].append(
            f"ARM ASYMMETRY: players per arm {sorted(set(counts))} -- "
            "arms of different sizes are not comparable")
    if r["roster"]["systemd_active_units"] != playing:
        r["notes"].append(
            f"systemd says {r['roster']['systemd_active_units']} active, the "
            f"servers say {playing} playing -- a unit can be green with no bot in it")

    # --- inference endpoint, as the bots are actually configured ------------
    ep = sh("grep -h '^OLLAMA_BASE_URL=' /srv/mcbots/harness/env/*.env | sort -u",
            host=BOTS_HOST)
    r["inference"]["endpoints_declared"] = sorted(
        {l.split("=", 1)[1] for l in ep.splitlines() if "=" in l})
    mv = sh("grep -h '^MINECRAFT_VERSION=' /srv/mcbots/harness/env/*.env | sort -u",
            host=BOTS_HOST)
    r["inference"]["client_versions_declared"] = sorted(
        {l.split("=", 1)[1] for l in mv.splitlines() if "=" in l})
    cv = sh("grep -h '^CODE_VERSION=' /srv/mcbots/harness/env/*.env | sort -u",
            host=BOTS_HOST)
    r["code"]["code_version_in_env"] = sorted(
        {l.split("=", 1)[1] for l in cv.splitlines() if "=" in l})
    if (r["code"]["code_version_in_env"]
            and r["code"]["git_sha"]
            and r["code"]["git_sha"] not in r["code"]["code_version_in_env"]):
        r["notes"].append(
            f"env files declare CODE_VERSION {r['code']['code_version_in_env']} "
            f"but HEAD is {r['code']['git_sha']} -- the roster was written "
            "against different code than is checked out")
    # client/server version mismatch is the fault that cost a whole afternoon
    declared = set(r["inference"]["client_versions_declared"])
    served = {v for v in vers if v}
    if declared and served and not any(d in s for d in declared for s in served):
        r["notes"].append(
            f"client declares {sorted(declared)} but servers run {sorted(served)} "
            "-- bots will fail to join on a protocol mismatch")
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="directory to write a timestamped receipt into")
    ap.add_argument("--print", action="store_true", dest="to_stdout")
    ap.add_argument("--compare", help="an earlier receipt to diff against")
    a = ap.parse_args()

    r = collect()

    if a.compare:
        try:
            old = json.loads(pathlib.Path(a.compare).read_text())
        except Exception as e:
            print(f"could not read {a.compare}: {e}", file=sys.stderr)
            return 2
        print(f"comparing {a.compare} -> now")
        for path in ("code.git_sha", "protocol.preregistration_sha",
                     "parity.distinct_seeds", "parity.distinct_town_sites",
                     "parity.distinct_paper_versions", "roster.players_in_world"):
            cur, prev = r, old
            for k in path.split("."):
                cur = (cur or {}).get(k) if isinstance(cur, dict) else None
                prev = (prev or {}).get(k) if isinstance(prev, dict) else None
            flag = "  " if cur == prev else "CHANGED"
            print(f"  {flag} {path}: {prev!r} -> {cur!r}")
        return 0

    if a.to_stdout or not a.out:
        print(json.dumps(r, indent=2))
    if a.out:
        d = pathlib.Path(a.out)
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"receipt-{r['captured_at_utc'].replace(':', '').replace('-', '')}.json"
        p.write_text(json.dumps(r, indent=2) + "\n")
        print(f"wrote {p}", file=sys.stderr)
    if r["notes"]:
        print("\nNOTES:", file=sys.stderr)
        for n in r["notes"]:
            print(f"  - {n}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
