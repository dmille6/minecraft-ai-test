#!/usr/bin/env bash
# SANDBOX-ONLY (logwalk-01show rig): the Mac-side driver that serves the rig bots' reset requests (lwrig.mjs toSpot) -- a reset-<bot>
# file on ci2 -> `spreadplayers <x> <z> 0 1 false <bot>` on sandbox2's RCON (the worlds host) -> the file removed. Until every bot is done.
#   sandbox/logwalk/lwdriver.sh <run dir on ci2> <bots>
set -uo pipefail
RUN="$1"; N="$2"
while :; do
  out=$(ssh -o BatchMode=yes mike@10.0.0.34 "cd $RUN && for f in reset-*; do [ -f \"\$f\" ] && echo \"\${f#reset-} \$(cat \$f)\"; done; echo DONE \$(ls done-* 2>/dev/null | wc -l)")
  while read -r b x z; do
    [[ -z "$b" || "$b" == DONE ]] && continue
    ssh -o BatchMode=yes mike@10.0.0.30 "python3 /home/mike/t11rcon.py sandbox2 'spreadplayers $x $z 0 1 false $b'" >/dev/null 2>&1
    ssh -o BatchMode=yes mike@10.0.0.34 "rm -f $RUN/reset-$b"
    echo "$(date -u +%H:%M:%S) reset $b -> $x $z"
  done <<< "$out"
  d=$(grep '^DONE' <<< "$out" | awk '{print $2}')
  [[ "${d:-0}" -ge "$N" ]] && { echo "all $N done"; exit 0; }
  sleep 3
done
