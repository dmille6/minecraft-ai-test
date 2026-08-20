#!/usr/bin/env python3
"""Ground-truth fleet health: ask the SERVER who is playing, not systemd.

    ./fleet-doctor.py --once            # report
    ./fleet-doctor.py --once --repair   # report and restart what is missing

WHY THIS EXISTS.

A forty-bot fleet spent fifteen hours degrading to eleven bots and NOTHING
reported it. All forty units were `active` with NRestarts=0. The reason is that
every health signal in the stack was self-reported by the layer being asked:

  - systemd knows a PROCESS is running. It cannot know the bot is playing.
  - the unit's memory ceiling throttled instead of killing, so the process was
    stalled 57% of the time and never crashed. Restart=always never fired.
  - the bot's own logs said "connecting" every couple of minutes, which reads as
    activity rather than as failure.

THE ONE LAYER THAT CANNOT LIE IS THE MINECRAFT SERVER. It knows exactly who is
connected. This checks that, compares it against the roster, and treats any
difference as a fault -- which is the check that would have caught the four bots
whose usernames were too long, the twenty-nine dropped by memory pressure, and
every future variant of "the unit is green and the bot is gone".

The same principle applies to the telemetry: a bot connected but silent for
longer than a few decision cycles is not healthy either.
"""
import argparse, importlib.util, json, re, subprocess, sys, time
from pathlib import Path

_spec = importlib.util.spec_from_file_location("pt", Path(__file__).parent / "place-town.py")
_pt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pt)
Rcon, ARMS, ROOT, BASE_RCON = _pt.Rcon, _pt.ARMS, _pt.ROOT, _pt.BASE_RCON

NAMES = ["Alpha", "Bravo", "Comet", "Delta", "Echo"]


def in_world(world):
    """Who the SERVER says is connected. This is the only non-self-reported signal."""
    props = ROOT / world / "server.properties"
    conf = dict(l.split("=", 1) for l in props.read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    r = Rcon("127.0.0.1", int(conf.get("rcon.port", BASE_RCON + ARMS[world])),
             conf["rcon.password"].strip())
    out = _pt.re.sub(r"§.", "", r.run("list"))
    # "There are N of a max of M players online: a, b, c"
    names = []
    if ":" in out:
        names = [n.strip() for n in out.split(":", 1)[1].split(",") if n.strip()]
    return set(names)


def unit_state(bot, host=None):
    # NOT `--value` with several -p: systemd returns them in ITS order, not the
    # order asked for, so positional parsing silently mislabels the fields --
    # this printed MemoryCurrent as the restart count (restarts=143060992).
    # Ask for key=value and read them by name.
    cmd = ["systemctl", "show", f"mcbot@{bot}",
           "-p", "ActiveState", "-p", "NRestarts", "-p", "MemoryCurrent"]
    if host:
        cmd = ["ssh", "-o", "BatchMode=yes", host] + cmd
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
        kv = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
        mem = kv.get("MemoryCurrent", "")
        return {"active": kv.get("ActiveState", "?"),
                "restarts": kv.get("NRestarts", "?"),
                "mem_mb": int(mem) // 1048576 if mem.isdigit() else None}
    except Exception:
        return {"active": "?", "restarts": "?", "mem_mb": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bots-host", default="10.0.0.31",
                    help="host running the mcbot@ units; '' if local")
    ap.add_argument("--repair", action="store_true",
                    help="restart units whose bot is not in the world")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=300)
    a = ap.parse_args()
    host = a.bots_host or None

    while True:
        missing, present, faults = [], 0, []
        for world in sorted(ARMS):
            if not (ROOT / world / "server.properties").exists():
                continue
            expect = {f"{world}-{n}" for n in NAMES}
            try:
                actual = in_world(world)
            except Exception as e:
                faults.append(f"{world}: server unreachable ({str(e)[:40]})")
                continue
            present += len(actual & expect)
            for bot in sorted(expect - actual):
                st = unit_state(bot, host)
                missing.append((bot, st))

        total = len(ARMS) * len(NAMES)
        print(f"  {time.strftime('%H:%M:%S')}  in world {present}/{total}"
              + (f"   MISSING {len(missing)}" if missing else "   all present"))
        for f in faults:
            print(f"    !! {f}")
        for bot, st in missing:
            # The tell: unit says active, bot is not playing. systemd's view and
            # the world's view disagree, and the world is the one that counts.
            print(f"    {bot:<20} unit={st['active']:<8} restarts={st['restarts']:<4} "
                  f"mem={st['mem_mb'] if st['mem_mb'] is not None else '?'}MB")
            if a.repair:
                cmd = ["sudo", "-n", "systemctl", "restart", f"mcbot@{bot}"]
                if host:
                    cmd = ["ssh", "-o", "BatchMode=yes", host] + cmd
                subprocess.run(cmd, capture_output=True, timeout=30)
                print(f"      -> restarted")

        if a.once:
            return 1 if (missing or faults) else 0
        time.sleep(a.interval)


if __name__ == "__main__":
    sys.exit(main())
