#!/usr/bin/env python3
"""observe-fleet.py -- measure ANY Minecraft fleet from the server side.

    ./observe-fleet.py --rcon 127.0.0.1:25575 --password X \
                       --harness mindcraft --out /var/log/observe.jsonl

WHY THIS EXISTS RATHER THAN PARSING THEIR LOGS.

Comparing our fleet against mindcraft means comparing two harnesses that
disagree about what is worth recording. Ours writes structured skill outcomes,
positions, fail classes and timings into Elasticsearch. mindcraft writes prose
to a run.log and a conversation memory.json -- no positions over time, no
outcome status, no durations. Any comparison built by parsing that prose would
be fragile, and worse, it would be built on each harness's SELF-REPORT.

That is the thing this project refuses everywhere else. mindcraft logs
`Agent executed: !searchForBlock` for a command that took zero arguments and
changed nothing; we logged `drowning_escaped` for bots that never reached land.
Both are harnesses grading their own homework, and both were wrong in the same
direction -- toward claiming success.

So neither harness is the instrument. THE SERVER IS. It knows where every bot
actually is and what it actually holds, it answers the same way regardless of
who wrote the bot, and it cannot be talked into optimism. Polling it gives one
ruler for both fleets:

    mobility     net displacement per window, from real positions
    productivity inventory deltas, from real inventories
    survival     health, and disappearance from the player list

The output schema deliberately mirrors the fields our analysis already uses
(bot.name, bot.pos.x/y/z, @timestamp), plus a `harness` label, so the same
queries work on both without a second set of tooling.
"""
import argparse, json, socket, struct, sys, time, re
from datetime import datetime, timezone


class Rcon:
    def __init__(self, host, port, password, timeout=10):
        self.addr, self.password, self.timeout = (host, port), password, timeout
        self.sock = None
        self.rid = 0
        self.connect()

    def connect(self):
        self.sock = socket.create_connection(self.addr, self.timeout)
        if self._cmd(3, self.password) is None:
            raise SystemExit(f"rcon auth failed on {self.addr}")

    def _cmd(self, kind, body):
        self.rid += 1
        rid = self.rid
        payload = struct.pack("<ii", rid, kind) + body.encode() + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)
        size = struct.unpack("<i", self._read(4))[0]
        resp_id, _ = struct.unpack("<ii", self._read(8))
        data = self._read(size - 8)[:-2].decode(errors="replace")
        return None if resp_id == -1 else data

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("rcon closed mid-read")
            buf += chunk
        return buf

    def run(self, cmd):
        # A long observation run outlives any single TCP connection; reconnect
        # rather than losing the series.
        for attempt in (1, 2):
            try:
                return self._cmd(2, cmd) or ""
            except (ConnectionError, OSError, struct.error):
                if attempt == 2:
                    return ""
                try: self.sock.close()
                except Exception: pass
                time.sleep(2)
                self.connect()
        return ""


def players(r):
    m = re.search(r":\s*(.*)$", r.run("list"))
    if not m or not m.group(1).strip():
        return []
    return [p.strip() for p in m.group(1).split(",") if p.strip()]


def pos_of(r, name):
    m = re.findall(r"(-?\d+\.?\d*)d", r.run(f"data get entity {name} Pos"))
    return [float(v) for v in m[:3]] if len(m) >= 3 else None


DEATH_OBJ = "obsdeaths"


def ensure_death_counter(r):
    """A server-side deathCount objective, which is the only exact death signal.

    Polling `Health <= 0` at 30s intervals cannot work: Minecraft respawns in
    well under a second, so a death almost never coincides with a sample. The
    first version of this reported ZERO deaths for both fleets across 8.5 hours
    while our own telemetry recorded nine in two hours -- a column that was
    quietly, confidently wrong.

    `deathCount` is maintained by the server itself and is cumulative, so it
    cannot be missed between polls. Deltas of it are real deaths.
    """
    r.run(f"scoreboard objectives add {DEATH_OBJ} deathCount")   # no-op if it exists


def deaths_of(r, name):
    out = r.run(f"scoreboard players get {name} {DEATH_OBJ}")
    m = re.search(r"has (\d+) ", out)
    return int(m.group(1)) if m else 0


def health_of(r, name):
    m = re.search(r"(-?\d+\.?\d*)f", r.run(f"data get entity {name} Health"))
    return float(m.group(1)) if m else None


def inventory_of(r, name):
    """item -> count. Deltas of this are the only productivity measure that does
    not require either harness to tell the truth about what it achieved."""
    raw = r.run(f"data get entity {name} Inventory")
    inv = {}
    for item, cnt in re.findall(r'id:\s*"minecraft:(\w+)",\s*count:\s*(\d+)', raw):
        inv[item] = inv.get(item, 0) + int(cnt)
    # Older/newer formats put count before id; catch that shape too.
    for cnt, item in re.findall(r'count:\s*(\d+).*?id:\s*"minecraft:(\w+)"', raw):
        inv.setdefault(item, int(cnt))
    return inv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rcon", required=True, help="host:port")
    ap.add_argument("--password", required=True)
    ap.add_argument("--harness", required=True,
                    help="label for this fleet, e.g. mcai or mindcraft")
    ap.add_argument("--out", required=True)
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()

    host, _, port = a.rcon.partition(":")
    r = Rcon(host, int(port or 25575), a.password)
    ensure_death_counter(r)
    out = open(a.out, "a", buffering=1)

    while True:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        for name in players(r):
            p = pos_of(r, name)
            if not p:
                continue
            rec = {"@timestamp": now, "harness": a.harness,
                   "bot": {"name": name,
                           "pos": {"x": p[0], "y": p[1], "z": p[2]},
                           "health": health_of(r, name),
                           "deaths": deaths_of(r, name),
                           "inventory": inventory_of(r, name)}}
            out.write(json.dumps(rec) + "\n")
        if a.once:
            break
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
