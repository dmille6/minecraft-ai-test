#!/bin/bash
# Model-selection benchmark tunnel (controller-only: one ssh process). Exposes the Studio to the bots host:
#   10.0.0.70:11502 -> Studio 127.0.0.1:11434 (Ollama)   10.0.0.70:11501 -> Studio 127.0.0.1:11501 (LM Studio proxy)
# launchd (com.mbench.tunnel, KeepAlive) restarts it; every start and exit is logged with a timestamp.
LOG=~/Library/Logs/mbench-tunnel.log
echo "$(date -u +%FT%TZ) start" >> $LOG
/usr/bin/ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  -o ConnectTimeout=10 -g -N -L 11502:127.0.0.1:11434 -L 11501:127.0.0.1:11501 mike@ai.ticrcorp.com < /dev/null
echo "$(date -u +%FT%TZ) DROP exit=$?" >> $LOG
sleep 2
