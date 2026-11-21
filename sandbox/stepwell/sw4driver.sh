#!/usr/bin/env bash
# SANDBOX-ONLY (stepwell-04show rig), Mac side, light (ssh and RCON only), under the caller's sandbox3 lock (sandbox/sbxlock.sh take
# sandbox3 stepwell ...). One run of one code tree: load a COPY of the stepwell-03show rig's end world into sandbox3, set the y 62 rim
# back to LIVE's (the trim, its posts and torches air: clear62.cmds from the record), a fresh copy of that rig's pool, one bot
# (showcase-Lumen) on ci2 with LUMEN'S BAG at the tank's exit (scene setup only: tp, clear, give), the visit loop, then the world restored.
#   sandbox/stepwell/sw4driver.sh <base|head> [minutes]
set -uo pipefail
TAG="$1"; MIN="${2:-15}"
W30=mike@10.0.0.30; CI=mike@10.0.0.34
SRC=/srv/block2/sandbox3/world.stepwell03-20261120T1448Z
RUN=/home/mike/sw4rig/run-$TAG
# world loads and restores go through main's sandbox/rigworld.sh (rigguard 11-21: it asserts this run holds the sandbox3 lock);
# RIGWORLD=<path> when this checkout predates it
RW="${RIGWORLD:-sandbox/rigworld.sh}"
[[ -f "$RW" ]] || { echo "no rigworld.sh at $RW" >&2; exit 2; }
R() { ssh -o BatchMode=yes $W30 "python3 /home/mike/t11rcon.py sandbox3 $(printf '%q ' "$@")"; }
echo "== load"; bash "$RW" sandbox3 stepwell load "$SRC" || exit 3
R "forceload add -70 -90 -38 -56" >/dev/null; sleep 6
echo "== clear the y 62 rim"
# the loop runs ON the worlds host (its bash has mapfile; the Mac's bash 3 does not)
ssh -o BatchMode=yes $CI "cat /home/mike/sw4rig/clear62.cmds" | ssh -o BatchMode=yes $W30 'cat > /tmp/sw4-clear62.cmds; mapfile -t c < /tmp/sw4-clear62.cmds; ok=0
  for ((i = 0; i < ${#c[@]}; i += 25)); do o=$(python3 /home/mike/t11rcon.py sandbox3 "${c[@]:i:25}"); ok=$((ok + $(grep -c "Changed the block" <<< "$o" || true))); done
  echo "cleared $ok of ${#c[@]}"'

R "kill @e[type=item,x=-70,y=55,z=-90,dx=32,dy=20,dz=34]" "save-all flush" >/dev/null
echo "== pool + bot"
ssh -o BatchMode=yes $CI "rm -rf $RUN && mkdir -p $RUN && cp -a /home/mike/swrig/run2/pool $RUN/pool && cd $RUN/pool && rm -f project-0_70_0.stepwell.stuck.* project-0_70_0.stepwell.aside.* && for f in project-0_70_0.stepwell.*.lease.*.json; do [ -f \"\$f\" ] && rm -f \"\$f\"; done; python3 /home/mike/sw4rig/freshindex.py $RUN/pool && cp /home/mike/sw4rig/probe62.json $RUN/ && cd /home/mike/sw4rig/tree-$TAG && (SW_MIN=$MIN SW_VISITS=4 nohup node ../sw4rig.mjs showcase-Lumen $RUN > $RUN/out.txt 2>&1 &) ; echo started"
for i in $(seq 1 120); do ssh -o BatchMode=yes $CI "test -f $RUN/ready-showcase-Lumen" && break; sleep 3; done
echo "== Lumen's bag at the exit"
R "gamemode survival showcase-Lumen" "tp showcase-Lumen -53.5 62 -61.5" "clear showcase-Lumen" "effect clear showcase-Lumen" \
  "give showcase-Lumen minecraft:cobblestone 64" "give showcase-Lumen minecraft:cobblestone 34" "give showcase-Lumen minecraft:iron_pickaxe 1" "give showcase-Lumen minecraft:torch 2"
sleep 4; ssh -o BatchMode=yes $CI "touch $RUN/go"
for i in $(seq 1 $(( (MIN + 8) * 12 ))); do ssh -o BatchMode=yes $CI "test -f $RUN/done-showcase-Lumen" && break; sleep 5; done
ssh -o BatchMode=yes $CI "touch $RUN/stop; sleep 2; tail -8 $RUN/out.txt"
echo "== restore"; bash "$RW" sandbox3 stepwell restore
