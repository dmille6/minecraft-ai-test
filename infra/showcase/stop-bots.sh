#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: stop the 10 showcase bots 12 s apart, disable them, turn AUTO_FOLLOW off.
#   sudo /srv/showcase/bin/stop-bots.sh "<why>"
set -uo pipefail
WHY=${1:-operator}
rm -f /srv/showcase/AUTO_FOLLOW
for n in Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno; do
  if systemctl is-active --quiet "mcshow@showcase-$n" || systemctl is-enabled --quiet "mcshow@showcase-$n" 2>/dev/null; then
    systemctl disable --now "mcshow@showcase-$n" >/dev/null 2>&1 && echo "   stopped showcase-$n"
    sleep 12
  fi
done
printf '{"t": "%s", "event": "stop-bots", "why": %s}\n' "$(date -u +%FT%TZ)" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$WHY")" \
  >> /srv/showcase/ops/deploy.jsonl
echo "stopped; AUTO_FOLLOW off ($WHY)"
