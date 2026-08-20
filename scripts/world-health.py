#!/usr/bin/env python3
"""Per-world tick health for Block 2, sampled from the SERVER.

    ./world-health.py --out /var/log/mcai/world-health.jsonl [--interval 60]

WHY THIS EXISTS. All eight worlds share one host, which the pre-registration
requires: arms on different machines would turn every hardware difference into
an arm effect. The cost is that they now share a kernel, and eight Paper servers
can starve one another through GC, chunk generation or a disk stall. A world
that loses ticks gives its bots fewer opportunities per wall-clock hour -- an arm
effect arriving through the CPU scheduler rather than through memory, and one
that would be completely invisible in the skill telemetry.

provision-block2.sh pins each world to its own four CPUs with an identical
quota. This is the evidence that the pinning WORKED. Without it, "the arms had
equal compute" is an assumption; with it, it is a measurement that can be
reported alongside the result -- or that can void a repetition honestly.

TPS is read from Paper itself rather than inferred from the host, because what
matters is the tick rate the bots actually experienced.
"""
import argparse, importlib.util, json, re, sys, time
from pathlib import Path

# Reuse the vendored RCON client rather than keeping a third copy of it in sync.
_spec = importlib.util.spec_from_file_location("pt", Path(__file__).parent / "place-town.py")
_pt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pt)
Rcon, ARMS, ROOT, BASE_RCON = _pt.Rcon, _pt.ARMS, _pt.ROOT, _pt.BASE_RCON

TPS_RE = re.compile(r"([\d.]+),\s*([\d.]+),\s*([\d.]+)")
MSPT_RE = re.compile(r"([\d.]+)")


def strip_colour(s):
    return re.sub(r"§.", "", s or "")


def sample(world, port, password):
    r = Rcon("127.0.0.1", port, password)
    tps_raw = strip_colour(r.run("tps"))
    mspt_raw = strip_colour(r.run("mspt"))
    players = strip_colour(r.run("list"))
    m = TPS_RE.search(tps_raw)
    n = re.search(r"(\d+)\s*of a max", players) or re.search(r"are (\d+)", players)
    out = {"world": world, "arm": world.rsplit("-", 1)[0], "replicate": world.rsplit("-", 1)[-1],
           "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "players": int(n.group(1)) if n else None}
    if m:
        out["tps_1m"], out["tps_5m"], out["tps_15m"] = (float(g) for g in m.groups())
        # A world below 19 is dropping ticks its bots paid for in wall-clock time.
        out["degraded"] = out["tps_1m"] < 19.0
    ms = MSPT_RE.findall(mspt_raw)
    if ms:
        out["mspt"] = [float(x) for x in ms[:3]]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="-")
    ap.add_argument("--interval", type=int, default=60)
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()

    sinks = {}
    for world in ARMS:
        props = ROOT / world / "server.properties"
        if not props.exists():
            continue
        conf = dict(l.split("=", 1) for l in props.read_text().splitlines()
                    if "=" in l and not l.startswith("#"))
        sinks[world] = (int(conf.get("rcon.port", BASE_RCON + ARMS[world])),
                        conf["rcon.password"].strip())
    if not sinks:
        raise SystemExit(f"no provisioned worlds under {ROOT} -- run provision-block2.sh first")

    fh = sys.stdout if a.out == "-" else open(a.out, "a", buffering=1)
    while True:
        for world, (port, pw) in sorted(sinks.items()):
            try:
                rec = sample(world, port, pw)
            except Exception as e:
                # A world that cannot be reached is itself the finding.
                rec = {"world": world, "arm": world.rsplit("-", 1)[0],
                       "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "error": str(e)[:120], "degraded": True}
            fh.write(json.dumps(rec) + "\n")
        if a.once:
            return
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
