#!/usr/bin/env bash
# fleet-craft-report.sh -- what each bot has actually MADE, and how far it walked.
#
# Run this whenever someone asks how the bots are doing. Aggregate health numbers
# (success rate, veto rate, decisions/hour) describe the harness; this describes
# the agents. The two answer different questions and the second one is usually
# what was meant.
#
# It reads measured inventory deltas from successful craft/build events, so the
# counts are trustworthy in a way success RATES from the same period are not --
# the rates span the pre- and post-ADR-0003 eras and mix a measured with an
# unmeasured definition of success. Item counts never changed definition.
#
#   ./scripts/fleet-craft-report.sh            all time
#   ./scripts/fleet-craft-report.sh now-24h    since a point
set -uo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
ES="${ES_HOST:-10.0.0.186}"
SINCE="${1:-}"
RANGE='{"match_all":{}}'
[ -n "$SINCE" ] && RANGE="{\"range\":{\"@timestamp\":{\"gte\":\"$SINCE\"}}}"

cat > /tmp/craft-q.sh <<SH
cd /opt/docker-elk
EP=\$(sudo grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
echo '===TRAVEL==='
curl -s -u "elastic:\$EP" "http://localhost:9200/mcai-skill-agents/_search" -H 'Content-Type: application/json' \\
 -d '{"size":0,"query":$RANGE,"aggs":{"b":{"terms":{"field":"bot.name","size":12},
      "aggs":{"dist":{"sum":{"field":"skill.distance_moved"}},
              "deaths":{"filter":{"term":{"skill.name":"_death"}}}}}}}'
echo '===CRAFTS==='
curl -s -u "elastic:\$EP" "http://localhost:9200/mcai-skill-agents/_search?size=5000" -H 'Content-Type: application/json' \\
 -d '{"query":{"bool":{"must":[{"terms":{"skill.name":["craft","build","place"]}},
      {"term":{"skill.status":"success"}},$RANGE]}},"_source":["bot.name","skill.inventory_delta"]}'
SH

scp -i "$SSH_KEY" -o BatchMode=yes -q /tmp/craft-q.sh "mike@$ES:/tmp/" 2>/dev/null
ssh -i "$SSH_KEY" -o BatchMode=yes "mike@$ES" 'bash /tmp/craft-q.sh' 2>/dev/null \
  | SINCE="${SINCE:-all time}" python3 "$(dirname "$0")/lib/craft_report.py"
