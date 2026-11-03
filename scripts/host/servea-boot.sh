#!/bin/bash
# servea-boot.sh -- run once at boot on the 5080 by servea-boot.service (owner 11-02: "get everything running").
# Pid files from before the reboot are stale (the pids may now belong to other processes), so they are removed
# first; then, only if /root/servea/AUTOSTART exists (the waiter writes it after a healthy start and removes it on
# stop), the supervised llama-server is started again with the same model, alias, slots and context.
set -u
rm -f /root/servea/run/server.pid /root/servea/run/supervisor.pid /root/servea/run/stop
[ -f /root/servea/AUTOSTART ] || { echo "no AUTOSTART: leaving llama-server off"; exit 0; }
read -r G A NP CPS < /root/servea/AUTOSTART
source /root/servea/env.sh
exec /root/servea/servea-llama.sh start "$G" "$A" "$NP" "$CPS"
