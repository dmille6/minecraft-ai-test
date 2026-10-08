#!/bin/bash
# resume-chains.sh -- relaunch chains recorded by chain-start.sh that are neither finished nor running (a reboot kills
# plain background processes). A chain is FINISHED when ~/chain-<next>.out ends in "launched", "WARNING" or "STOP";
# then its .args file is removed. chain-after.sh itself refuses a second launch ("already registered"), so a relaunch
# can never deploy twice. Run @reboot and every 10 min by cron.
shopt -s nullglob
for a in /home/mike/chains.d/*.args; do
  next=$(basename "$a" .args); out=/home/mike/chain-$next.out
  if [ -f "$out" ] && tail -1 "$out" | grep -qE " (launched|WARNING|STOP)"; then rm -f "$a"; continue; fi
  pgrep -f "^bash /home/mike/chain-after.sh .* $next " >/dev/null && continue
  eval "set -- $(cat "$a")"
  cd /home/mike && setsid nohup bash /home/mike/chain-after.sh "$@" </dev/null >/dev/null 2>&1 &
  echo "$(date -u +%FT%TZ) resumed chain -> $next" >> /home/mike/digest/resume-chains.log
done
exit 0
