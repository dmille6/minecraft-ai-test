#!/bin/bash
# Per-bot craft + travel table, read from the SERVER.
# RCON splits payloads >4096 bytes across multiple packets; a single-packet read
# truncates a full inventory to its first item or two and silently under-reports.
rcpy() {
python3 - "$1" "$2" "$3" <<'PY'
import socket, struct, sys
port, pw, cmd = int(sys.argv[1]), sys.argv[2], sys.argv[3]
def pkt(i, t, b):
    x = struct.pack("<ii", i, t) + b.encode() + b"\x00\x00"
    return struct.pack("<i", len(x)) + x
s = socket.create_connection(("127.0.0.1", port), timeout=20)
def one():
    ln = struct.unpack("<i", s.recv(4))[0]; d = b""
    while len(d) < ln: d += s.recv(ln - len(d))
    return d[8:-2].decode(errors="replace")
try:
    s.send(pkt(1, 3, pw)); one()
    s.send(pkt(2, 2, cmd))
    body = one()
    s.settimeout(0.35)
    try:
        while True:
            more = one()
            if not more: break
            body += more
    except Exception:
        pass
    print(body.strip())
finally:
    s.close()
PY
}
declare -A PORT PW
for a in hive-a hive-b board-a board-b isolated-a isolated-b placebo-a placebo-b; do
  PORT[$a]=$(sudo grep -h '^rcon.port' /srv/block2/$a/server.properties | cut -d= -f2)
  PW[$a]=$(sudo grep -h '^rcon.password' /srv/block2/$a/server.properties | cut -d= -f2)
done
printf "%-22s %14s %8s  %s\n" "bot" "pos(x,z)" "from_home" "inventory"
echo "----------------------------------------------------------------------------------"
TOT=0; MOVED=0; N=0; LOGS=0; PICKS=0
for a in hive-a hive-b board-a board-b isolated-a isolated-b placebo-a placebo-b; do
  LIST=$(rcpy "${PORT[$a]}" "${PW[$a]}" "list")
  NAMES=$(echo "$LIST" | sed 's/.*online: //' | tr ',' ' ')
  for b in $NAMES; do
    [ -z "$b" ] && continue
    N=$((N+1))
    POS=$(rcpy "${PORT[$a]}" "${PW[$a]}" "data get entity $b Pos")
    INV=$(rcpy "${PORT[$a]}" "${PW[$a]}" "data get entity $b Inventory")
    X=$(echo "$POS" | grep -oE '\[-?[0-9.]+d' | head -1 | tr -d '[d')
    Z=$(echo "$POS" | grep -oE '\-?[0-9.]+d\]' | head -1 | tr -d 'd]')
    ITEMS=$(echo "$INV" | grep -oE 'id: "minecraft:[a-z_]+", count: [0-9]+' | sed 's/id: "minecraft://; s/", count: /x/' | tr '\n' ' ')
    CNT=$(echo "$INV" | grep -oE 'count: [0-9]+' | grep -oE '[0-9]+' | paste -sd+ - | bc 2>/dev/null); CNT=${CNT:-0}
    TOT=$((TOT+CNT))
    L=$(echo "$INV" | grep -oE 'id: "minecraft:[a-z_]*log", count: [0-9]+' | grep -oE '[0-9]+$' | paste -sd+ - | bc 2>/dev/null); LOGS=$((LOGS+${L:-0}))
    echo "$ITEMS" | grep -q pickaxe && PICKS=$((PICKS+1))
    D=$(python3 -c "import math;print(round(math.hypot(${X:-355}-355, ${Z:-147}-147),1))" 2>/dev/null)
    [ "$(python3 -c "print(1 if ${D:-0} > 5 else 0)" 2>/dev/null)" = "1" ] && MOVED=$((MOVED+1))
    printf "%-22s (%6.0f,%6.0f) %8s  %s\n" "$b" "${X:-0}" "${Z:-0}" "${D:-?}" "${ITEMS:-empty}"
  done
done
echo "----------------------------------------------------------------------------------"
echo "online=$N  moved>5=$MOVED  items=$TOT  logs=$LOGS  bots_with_pickaxe=$PICKS"
