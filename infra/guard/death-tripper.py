#!/usr/bin/env python3
"""Stop bots that are repeatedly dying the same way. No LLM, no judgement.

WHY THIS EXISTS
    The fleet once ran 16 hours unattended and produced 81 deaths, 80 of them
    falls, all at y20-39, while every liveness invariant reported healthy --
    telemetry flowing, decisions happening, all five bots alive. Liveness is not
    health. A fleet enthusiastically killing itself every twelve minutes passes
    every check that asks "is the machinery running?".

WHY IT READS RAW EVENTS AND NOT LABELS
    The same run proved this system can generate false evidence, persist it, and
    enforce it as policy: goto classified its own failures by regexing its error
    prose, matched its OWN wrapper timeout, and recorded 393 expired budgets as
    "no route exists" -- a verdict the pathfinder never returned. Those labels
    reached the lessons store and the admission gate blocked `home` on all five
    bots. Any supervisor built on derived labels would have agreed with all of
    it.

    So this reads only what cannot be faked by a broken classifier: the death
    events themselves, the server's own death message, position, and time.

WHY IT ONLY STOPS
    Stopping is the safe asymmetry. A stopped bot costs you data. A looping,
    dying bot costs you the day AND poisons the lessons store with failures that
    will gate its future behaviour. This never tunes, never edits config, never
    deploys -- those change the experiment, and a change mid-trial makes the
    trial uninterpretable, which is worse than losing it cleanly.
"""
import json, os, re, subprocess, sys, time
from collections import defaultdict
from datetime import datetime, timezone, timedelta

EVD       = os.environ.get("EVD_HOST", "192.168.193.21")
LAB       = os.environ.get("LAB_HOST", "192.168.193.40")
KEY       = os.environ.get("AGENT_KEY", "/root/.ssh/id_ed25519_agent")
ARCHIVE   = "/srv/evidence/raw/lab01"
INCIDENTS = "/var/lib/mcai-tripper"
DRY       = "--apply" not in sys.argv

# Thresholds. Deliberately tight: a fall costs the bot its inventory and its
# progress, so two is already a pattern, not bad luck.
BOT_FALLS_30M    = 2
FLEET_FALLS_30M  = 5
DEPTH_FALLS_60M  = 4      # y20-39, the band the historical run died in
DEPTH_BAND       = (20, 39)

def ssh(host, cmd, user="agent"):
    return subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
         "-o", "StrictHostKeyChecking=accept-new", f"{user}@{host}", cmd],
        capture_output=True, text=True, timeout=90)

def unit_map():
    """Bot display name -> systemd instance, READ from the host, never assumed.

    Restarting `mcbot@Scout01` instead of `mcbot@scout` creates a phantom unit
    that fails forever while the real bot keeps running. That has happened twice,
    so lab01 PUBLISHES the mapping in a world-readable manifest rather than
    having the supervisor infer it -- and the supervisor cannot read the env
    files anyway, since those hold the Elasticsearch shipper password and a
    least-privilege account has no business with them.
    """
    r = ssh(LAB, "cat /srv/mcbots/bot-manifest.json")
    try:
        return json.loads(r.stdout)["bots"]
    except Exception as e:
        print(f"    cannot read bot manifest ({e}) -- refusing to stop units I cannot name")
        return {}

def load_deaths(minutes):
    """Death events from the archive, newest window only."""
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    r = ssh(EVD, f"grep -h '\"_death\"' {ARCHIVE}/*.jsonl 2>/dev/null | tail -2000")
    deaths = []
    for line in r.stdout.splitlines():
        try:
            d = json.loads(line)
        except Exception:
            continue
        if (d.get("skill") or {}).get("name") != "_death":
            continue
        try:
            ts = datetime.fromisoformat(d["@timestamp"].replace("Z", "+00:00"))
        except Exception:
            continue
        if ts < since:
            continue
        sk = d.get("skill") or {}
        bot = (d.get("bot") or {}).get("name")
        pos = (d.get("bot") or {}).get("pos") or {}
        detail = (sk.get("detail") or "").lower()
        # fail_class when present; otherwise the SERVER'S OWN death message.
        # That message is ground truth from the game, not a label this codebase
        # derived -- the distinction that makes it safe to read here.
        is_fall = sk.get("fail_class") == "fall" or "fell from a high place" in detail
        deaths.append({"ts": ts, "bot": bot, "y": pos.get("y"),
                       "fall": is_fall, "detail": sk.get("detail", "")})
    return deaths

def ship(trips, stopped, per_bot, falls30, depth, bundle=None):
    """Send the supervisor's own activity to Elasticsearch.

    EVERY run is shipped, not just the ones that trip. A dashboard that only
    shows interventions cannot distinguish "nothing is wrong" from "the
    supervisor has been dead for six hours" -- which is the same class of blind
    spot that let a fleet die 80 times while every liveness check reported
    healthy. The heartbeat IS the signal.

    Shipped as mcai_ship, an account that can append to mcai-* and do nothing
    else -- it cannot delete an index or read anything back.
    """
    try:
        pw = open("/root/.mcai_ship_password").read().strip()
    except Exception:
        return
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    docs = [{
        "@timestamp": now, "run_id": "supervisor",
        "host": {"name": os.uname().nodename},
        "supervisor": {
            "check": "death_tripper", "tripped": bool(trips),
            "reason": "; ".join(r for _, r in trips) or "no threshold tripped",
            "scope": sorted({sc for sc, _ in trips}) or ["none"],
            "action": "stop" if stopped else ("would_stop" if trips else "none"),
            "bots_stopped": stopped, "deaths_30m": len(falls30),
            "falls_30m": len(falls30), "falls_depth_60m": len(depth),
            "dry_run": DRY, "incident": os.path.basename(bundle) if bundle else "",
        }}]
    for bot, n in per_bot.items():
        docs.append({"@timestamp": now, "run_id": "supervisor",
                     "host": {"name": os.uname().nodename},
                     "bot": {"name": bot, "falls": n},
                     "supervisor": {"check": "per_bot_falls", "tripped": n >= BOT_FALLS_30M,
                                    "falls_30m": n, "dry_run": DRY}})
    body = "".join(json.dumps({"create": {}}) + "\n" + json.dumps(d) + "\n" for d in docs)
    try:
        subprocess.run(["curl", "-s", "-o", "/dev/null", "-u", f"mcai_ship:{pw}",
                        "-X", "POST", "http://192.168.193.30:9200/mcai-supervisor-lab/_bulk",
                        "-H", "Content-Type: application/x-ndjson", "--data-binary", "@-"],
                       input=body, text=True, timeout=20)
    except Exception as e:
        print(f"    (could not ship supervisor telemetry: {e})")

def main():
    os.makedirs(INCIDENTS, exist_ok=True)
    d30 = load_deaths(30)
    d60 = load_deaths(60)
    falls30 = [d for d in d30 if d["fall"]]
    falls60 = [d for d in d60 if d["fall"]]

    per_bot = defaultdict(int)
    for d in falls30:
        per_bot[d["bot"]] += 1
    depth = [d for d in falls60
             if d["y"] is not None and DEPTH_BAND[0] <= d["y"] <= DEPTH_BAND[1]]

    trips = []          # (scope, reason)
    for bot, n in per_bot.items():
        if n >= BOT_FALLS_30M:
            trips.append((bot, f"{n} fall deaths in 30m (limit {BOT_FALLS_30M})"))
    if len(falls30) >= FLEET_FALLS_30M:
        trips.append(("ALL", f"fleet: {len(falls30)} fall deaths in 30m (limit {FLEET_FALLS_30M})"))
    if len(depth) >= DEPTH_FALLS_60M:
        trips.append(("ALL", f"{len(depth)} fall deaths at y{DEPTH_BAND[0]}-{DEPTH_BAND[1]} in 60m "
                             f"(limit {DEPTH_FALLS_60M}) -- the historical signature"))

    print(f"  window: {len(d30)} deaths/30m ({len(falls30)} falls), "
          f"{len(depth)} falls at y{DEPTH_BAND[0]}-{DEPTH_BAND[1]}/60m")
    for b, n in sorted(per_bot.items(), key=lambda x: -x[1]):
        print(f"    {b:10} {n} falls/30m")
    if not trips:
        print("  no threshold tripped")
        ship([], [], per_bot, falls30, depth)
        return 0

    units = unit_map()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bundle = os.path.join(INCIDENTS, f"incident-{stamp}.json")
    targets = set()
    for scope, reason in trips:
        print(f"  TRIP  {scope}: {reason}")
        targets |= set(units) if scope == "ALL" else {scope}

    stopped = []
    for bot in sorted(targets):
        unit = units.get(bot)
        if not unit:
            print(f"    {bot}: no systemd instance found -- NOT stopping something I cannot name")
            continue
        if DRY:
            print(f"    would stop mcbot@{unit} ({bot})")
        else:
            r = ssh(LAB, f"sudo -n systemctl stop mcbot@{unit}")
            ok = r.returncode == 0
            print(f"    stop mcbot@{unit} ({bot}): {'ok' if ok else 'FAILED ' + r.stderr.strip()[:80]}")
            if ok:
                stopped.append(bot)

    # The incident bundle is the point: a fleet found stopped with no explanation
    # is barely better than one found dead.
    with open(bundle, "w") as f:
        json.dump({"at": stamp, "trips": trips, "stopped": stopped, "dry_run": DRY,
                   "falls_30m": [{"bot": d["bot"], "y": d["y"], "detail": d["detail"]}
                                 for d in falls30]}, f, indent=1, default=str)
    print(f"  incident: {bundle}")
    ship(trips, stopped, per_bot, falls30, depth, bundle)
    subprocess.run(["logger", "-t", "mcai-tripper", "-p", "user.err",
                    "TRIPPED: " + "; ".join(r for _, r in trips)], check=False)
    return 1

if __name__ == "__main__":
    sys.exit(main())
