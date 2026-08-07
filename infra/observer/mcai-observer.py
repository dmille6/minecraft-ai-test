#!/usr/bin/env python3
"""Independent ground truth about where the bots actually are.

WHY IT EXISTS
    This project's recurring defect is a value REPORTED rather than MEASURED. A
    skill said "no route exists" when its own wrapper had timed out. A version
    stamp claimed a commit that was not running. A success rate counted calls
    that returned cleanly rather than work that got done. Each was believed
    because nothing independent contradicted it.

    This is the something independent. It asks the SERVER where each bot is and
    how it is doing, and computes displacement itself. When the skill layer
    reports "goto success, moved 40 blocks" and this says the bot moved three,
    the disagreement is the finding.

WHY RCON AND NOT A MINEFLAYER BOT
    The original plan called for an observer bot with its own account. A bot
    only sees entities inside render distance -- with view-distance 8 it would
    be blind to any bot more than ~128 blocks away, which is exactly the
    long-range travel we most need to measure. It would also occupy a player
    slot, load chunks, and perturb the world it is measuring.

    Server-side entity data has none of those limits and no effect on the world.
    A measuring instrument that changes what it measures is not one.
"""
import json, os, re, socket, struct, subprocess, sys, time
from datetime import datetime, timezone

ES        = os.environ.get("ES_HOST", "192.168.193.30")
INTERVAL  = int(os.environ.get("OBSERVE_INTERVAL", "10"))
RCON_ENV  = "/srv/minecraft/server/.rcon.env"
SHIP_PW   = "/root/.mcai_ship_password"

def rcon(cmd, host="127.0.0.1", port=25575):
    pw = re.search(r'RCON_PASSWORD=(.*)', open(RCON_ENV).read()).group(1).strip()
    def pkt(rid, typ, body):
        p = struct.pack('<ii', rid, typ) + body.encode('utf8') + b'\x00\x00'
        return struct.pack('<i', len(p)) + p
    def recv(s):
        ln = struct.unpack('<i', s.recv(4))[0]
        d = b''
        while len(d) < ln:
            d += s.recv(ln - len(d))
        return d[8:-2].decode('utf8', 'replace')
    s = socket.create_connection((host, port), timeout=10)
    try:
        s.sendall(pkt(1, 3, pw)); recv(s)
        s.sendall(pkt(2, 2, cmd)); return recv(s)
    finally:
        s.close()

def online():
    m = re.search(r'online:\s*(.*)$', rcon("list").replace('\r', ''))
    return [n.strip() for n in m.group(1).split(',') if n.strip()] if m else []

NUM = r'(-?[\d.]+)d?'
def sample(name):
    out = {}
    try:
        p = re.search(rf'\[{NUM},\s*{NUM},\s*{NUM}\]', rcon(f"data get entity {name} Pos"))
        if p:
            out.update(x=float(p.group(1)), y=float(p.group(2)), z=float(p.group(3)))
    except Exception:
        return None
    # `data get entity <n> Health` answers with a BARE value --
    #   "Scout01 has the following entity data: 20.0f"
    # not "Health: 20.0". Matching on the field name silently returned nothing
    # and every sample shipped health=null, which would have looked like a
    # missing feature rather than a parse bug.
    for field, key in (("Health", "health"), ("foodLevel", "food")):
        try:
            r = rcon(f"data get entity {name} {field}")
            v = re.search(r'entity data:\s*' + NUM, r)
            if v:
                out[key] = float(v.group(1))
        except Exception:
            pass
    return out or None

def ship(docs):
    try:
        pw = open(SHIP_PW).read().strip()
    except Exception:
        return
    body = "".join(json.dumps({"create": {}}) + "\n" + json.dumps(d) + "\n" for d in docs)
    try:
        subprocess.run(["curl", "-s", "-o", "/dev/null", "-u", f"mcai_ship:{pw}",
                        "-X", "POST", f"http://{ES}:9200/mcai-observer-lab/_bulk",
                        "-H", "Content-Type: application/x-ndjson", "--data-binary", "@-"],
                       input=body, text=True, timeout=25)
    except Exception as e:
        print(f"ship failed: {e}", file=sys.stderr)

def main():
    last, batch = {}, []
    while True:
        now = datetime.now(timezone.utc)
        for name in online():
            s = sample(name)
            if not s:
                continue
            prev = last.get(name)
            moved = None
            if prev and (now - prev["at"]).total_seconds() < INTERVAL * 4:
                moved = round(((s["x"] - prev["x"]) ** 2 + (s["z"] - prev["z"]) ** 2) ** 0.5, 2)
            last[name] = {**s, "at": now}
            batch.append({
                "@timestamp": now.isoformat().replace("+00:00", "Z"),
                "run_id": "observer",
                "bot": {"name": name},
                "obs": {"x": s.get("x"), "y": s.get("y"), "z": s.get("z"),
                        "health": s.get("health"), "food": s.get("food"),
                        # Displacement THIS process computed from two server-side
                        # samples. Nothing in the agent stack contributed to it,
                        # which is the entire point.
                        "moved": moved, "interval_s": INTERVAL},
            })
        if len(batch) >= 12:
            ship(batch); batch = []
        time.sleep(INTERVAL)

if __name__ == "__main__":
    sys.exit(main())
