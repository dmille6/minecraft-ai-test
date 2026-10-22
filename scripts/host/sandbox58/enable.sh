#!/bin/bash
# ONE-SHOT: enable and start sandbox5..8 on the worlds host 10.0.0.30, AFTER the worlds VM has its RAM (48 -> 80 GB).
# Installed at ~/sandbox58/enable.sh by the sandbox58-1020 branch. The coordinator runs it; nothing else does.
#
#   sudo bash ~/sandbox58/enable.sh --check    precheck only: prints the memory math and every server's state, changes nothing
#   sudo bash ~/sandbox58/enable.sh            precheck, then enable + start each pending server in turn
#
# THE PRECHECK (refuses with exit 2, before touching anything):
#   MemAvailable >= PENDING x HEAP + 8 GiB, HEAP being the -Xmx in each unit's ExecStart (2 GiB today), PENDING the
#   servers not yet active (4 on the first run, so 4 x 2 + 8 = 16 GiB). On the 46 GiB VM today MemAvailable is ~14 GiB,
#   so it refuses -- by design, the RAM is not there yet. The same inequality is re-checked before EACH start with the
#   servers still to go, so a VM that loses headroom half way stops with the started ones up and the rest untouched.
# Also refuses: a missing dir/unit/server.properties, a port in server.properties other than the planned one, or a
# planned port that something else already listens on.
#
# STAGGER: one server at a time; each must answer RCON `list` (up to 600 s -- the first start generates the world)
# before the next starts, then 12 s more. A server that never answers is stopped and disabled again, and the script
# exits 1 without starting the rest.
#
# It never touches the 16 fleet worlds, sandbox..sandbox4, the bots, or the canary machinery.
set -uo pipefail
NAMES=(sandbox5 sandbox6 sandbox7 sandbox8)
RESERVE_KB=$((8 * 1024 * 1024))            # 8 GiB for the kernel, page cache and the fleet worlds' heap growth
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1
[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash $0 ${1:-}"; exit 1; }

idx() { local n=${1#sandbox}; echo "$n"; }
game_port() { echo $((25598 + $(idx "$1"))); }      # sandbox5 -> 25603 ... sandbox8 -> 25606
rcon_port() { echo $((25698 + $(idx "$1"))); }      # sandbox5 -> 25703 ... sandbox8 -> 25706
unit() { echo "block2-$1.service"; }
prop() { grep -h "^$2=" "/srv/block2/$1/server.properties" | head -1 | cut -d= -f2-; }
MEMINFO=${MEMINFO:-/proc/meminfo}          # overridable ONLY so --check can be shown passing and refusing on the real host
[ "$MEMINFO" = /proc/meminfo ] || [ "$CHECK_ONLY" = 1 ] || { echo "MEMINFO override is for --check only"; exit 1; }
memavail_kb() { awk '/^MemAvailable:/ {print $2}' "$MEMINFO"; }
to_kb() { local v=$1 num=${1%?}; case "${v: -1}" in g|G) echo $((num * 1048576));; m|M) echo $((num * 1024));; k|K) echo "$num";; *) echo 0;; esac; }
heap_kb() {   # -Xmx from the unit's ExecStart, in kB
  local x; x=$(grep -h '^ExecStart=' "/etc/systemd/system/$(unit "$1")" | grep -oE -- '-Xmx[0-9]+[gGmM]' | head -1)
  [ -n "$x" ] || { echo 0; return; }
  to_kb "${x#-Xmx}"
}
listening() { ss -ltnH "sport = :$1" | grep -q .; }
active() { systemctl is-active --quiet "$(unit "$1")"; }
gib() { awk -v k="$1" 'BEGIN { printf "%.1f GiB", k / 1048576 }'; }
rcon_list() {   # prints the reply to `list`, or nothing; the password never leaves this host and is never printed
  timeout 20 python3 - "/srv/block2/$1/server.properties" <<'PY' 2>/dev/null   # hard bound per probe (Codex r2 P3)
import socket, struct, sys
p = dict(l.rstrip('\n').split('=', 1) for l in open(sys.argv[1]) if '=' in l and not l.startswith('#'))
s = socket.create_connection(('127.0.0.1', int(p['rcon.port'])), timeout=10)
def send(t, body):
    pk = struct.pack('<ii', 7, t) + body.encode() + b'\0\0'; s.sendall(struct.pack('<i', len(pk)) + pk)
    ln = struct.unpack('<i', s.recv(4))[0]; b = b''
    while len(b) < ln:
        c = s.recv(ln - len(b))
        if not c: raise SystemExit(1)
        b += c
    return struct.unpack('<i', b[:4])[0], b[8:-2].decode(errors='replace')
rid, _ = send(3, p['rcon.password'])
if rid == -1: raise SystemExit(1)
print(send(2, 'list')[1].strip())
PY
}

# ---------------------------------------------------------------- precheck
bad=0; PENDING=(); HEAP=0
for s in "${NAMES[@]}"; do
  d=/srv/block2/$s; u=/etc/systemd/system/$(unit "$s")
  [ -d "$d" ] && [ -f "$d/server.properties" ] && [ -f "$d/paper.jar" ] || { echo "REFUSE $s: $d is not a prepared server dir"; bad=1; continue; }
  [ -f "$u" ] || { echo "REFUSE $s: $u missing"; bad=1; continue; }
  gp=$(prop "$s" server-port); rp=$(prop "$s" rcon.port)
  [ "$gp" = "$(game_port "$s")" ] && [ "$rp" = "$(rcon_port "$s")" ] \
    || { echo "REFUSE $s: server.properties ports $gp/$rp, planned $(game_port "$s")/$(rcon_port "$s")"; bad=1; continue; }
  h=$(heap_kb "$s"); [ "$h" -gt 0 ] || { echo "REFUSE $s: no -Xmx in $u"; bad=1; continue; }
  [ "$h" -gt "$HEAP" ] && HEAP=$h
  if active "$s"; then echo "  $s already active -- skipped"; continue; fi
  for p in "$gp" "$rp"; do listening "$p" && { echo "REFUSE $s: port $p already has a listener"; bad=1; }; done
  PENDING+=("$s")
done
[ "$bad" = 0 ] || { echo "PRECHECK FAILED (nothing changed)"; exit 2; }
AVAIL=$(memavail_kb); NEED=$(( ${#PENDING[@]} * HEAP + RESERVE_KB ))
TOTAL=$(awk '/^MemTotal:/ {print $2}' "$MEMINFO")
# Information only: the summed MemoryHigh (the cgroup throttle point) of every ACTIVE block2 unit plus the pending ones'
# (read from their unit files, which systemd has not loaded yet), against MemTotal.
HIGH=$(for u in $(systemctl list-units --no-legend --state=active 'block2*' | awk '{print $1}'); do systemctl show "$u" -p MemoryHigh --value; done \
       | awk '$1 ~ /^[0-9]+$/ { s += $1 } END { printf "%d", s / 1024 }')
for s in "${PENDING[@]}"; do
  HIGH=$(( HIGH + $(to_kb "$(grep -h '^MemoryHigh=' "/etc/systemd/system/$(unit "$s")" | cut -d= -f2)") ))
done
echo "memory: MemTotal $(gib "$TOTAL"), MemAvailable $(gib "$AVAIL"); need ${#PENDING[@]} x heap $(gib "$HEAP") + 8 GiB = $(gib "$NEED")"
echo "        (info) summed MemoryHigh of all block2 units incl. these: $(gib "$HIGH") of $(gib "$TOTAL")"
if [ "${#PENDING[@]}" = 0 ]; then echo "nothing pending: all four are active"; elif [ "$AVAIL" -lt "$NEED" ]; then
  echo "REFUSED: MemAvailable $(gib "$AVAIL") < $(gib "$NEED"). Add the RAM first (planned 48 -> 80 GB); nothing changed."; exit 2
else echo "precheck OK: pending ${PENDING[*]}"; fi
[ "$CHECK_ONLY" = 1 ] && exit 0

# ---------------------------------------------------------------- enable + start, staggered
systemctl daemon-reload || { echo "FAIL: systemctl daemon-reload; nothing started"; exit 1; }
left=${#PENDING[@]}
for s in "${PENDING[@]}"; do
  a=$(memavail_kb); n=$(( left * HEAP + RESERVE_KB ))
  [ "$a" -ge "$n" ] || { echo "STOPPED before $s: MemAvailable $(gib "$a") < $left x heap + 8 GiB = $(gib "$n")"; exit 2; }
  echo "$(date -u +%FT%TZ) starting $s (game $(game_port "$s"), rcon $(rcon_port "$s"))"
  # Codex r1 P2: every systemctl step is checked, and so is the clean-up of a server that never answers.
  backout() {   # stop + disable $1 and SAY whether that worked
    systemctl disable --now "$(unit "$1")" >/dev/null 2>&1
    echo "  backout $1: now $(systemctl is-active "$(unit "$1")") / $(systemctl is-enabled "$(unit "$1")" 2>/dev/null)" \
         "(want inactive / disabled; if not, run: sudo systemctl disable --now $(unit "$1"))"
    journalctl -u "$(unit "$1")" -n 15 --no-pager
  }
  systemctl enable "$(unit "$s")" >/dev/null 2>&1 || { echo "FAIL $s: systemctl enable; the rest are NOT started"; backout "$s"; exit 1; }
  systemctl start "$(unit "$s")" || { echo "FAIL $s: systemctl start; the rest are NOT started"; backout "$s"; exit 1; }
  ok=""; deadline=$((SECONDS + 600))     # wall-clock bound (+ at most one sleep and one 20 s probe)
  while [ "$SECONDS" -lt "$deadline" ]; do
    sleep 5; r=$(rcon_list "$s"); case "$r" in "There are"*) ok=$r; break;; esac
  done
  if [ -z "$ok" ]; then
    echo "FAIL $s: no RCON answer to list in 600 s -- stopping and disabling it; the rest are NOT started"
    backout "$s"; exit 1
  fi
  [ "$(systemctl is-enabled "$(unit "$s")" 2>/dev/null)" = enabled ] || { echo "FAIL $s: answers but is not enabled at boot"; exit 1; }
  echo "$(date -u +%FT%TZ) $s answers: $ok"
  left=$((left - 1)); [ "$left" -gt 0 ] && sleep 12
done

# /tmp does not survive the VM restart that adds the RAM: put back the RCON helper the drivers call, if it is gone or old.
if [ -f "$HERE/sbx-rcon.py" ] && ! grep -q "sandbox8" /tmp/sbx-rcon.py 2>/dev/null; then
  install -m 644 -o mike -g mike "$HERE/sbx-rcon.py" /tmp/sbx-rcon.py && echo "installed /tmp/sbx-rcon.py (knows sandbox..sandbox8)"
fi

# ---------------------------------------------------------------- result
echo; printf '%-9s %-8s %-9s %-6s %-6s %-9s %s\n' server active enabled game rcon rss list
for s in "${NAMES[@]}"; do
  pid=$(systemctl show "$(unit "$s")" -p MainPID --value); rss=$( [ "${pid:-0}" -gt 0 ] 2>/dev/null && ps -o rss= -p "$pid" | awk '{printf "%.1fG", $1/1048576}' || echo -)
  printf '%-9s %-8s %-9s %-6s %-6s %-9s %s\n' "$s" "$(systemctl is-active "$(unit "$s")")" "$(systemctl is-enabled "$(unit "$s")" 2>/dev/null)" \
    "$(game_port "$s")" "$(rcon_port "$s")" "$rss" "$(rcon_list "$s" | head -c 60)"
done
echo "MemAvailable now $(gib "$(memavail_kb)")"
