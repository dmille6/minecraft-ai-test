#!/usr/bin/env bash
# Restore Kibana data views and dashboards from version control.
#
# Kibana saved objects live only inside Kibana, so a stack rebuild silently
# loses every dashboard. Discovered the hard way: after a full night of the
# fleet running, Kibana held ZERO dashboards, ZERO visualisations and ZERO data
# views, while the coordination notes discussed "the Kibana dashboards" as
# though they existed. Everything had been done through raw ES queries.
#
# Run on the ELK host. Idempotent -- overwrites by id.
set -euo pipefail
cd /opt/docker-elk
EP=$(sudo grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
SRC="${1:-$(dirname "$0")/kibana-objects.ndjson}"
[ -f "$SRC" ] || { echo "no such file: $SRC"; exit 1; }

curl -s -m 60 -u "elastic:$EP" -X POST \
  'http://localhost:5601/api/saved_objects/_import?overwrite=true' \
  -H 'kbn-xsrf: true' -F file=@"$SRC" -o /tmp/kb-import.json

# Report from a file rather than a pipeline: the inline reporter used to be a
# python -c one-liner whose escaped quotes broke inside the shell heredoc, so a
# working import printed a SyntaxError traceback. A restore script that looks
# like it failed is nearly as bad as one that did.
if command -v jq >/dev/null 2>&1; then
  jq -r '"imported \(.successCount // 0) object(s), success=\(.success)",
         (.errors // [] | .[] | "  ERROR: \(.type)/\(.id): \(.error.type // .error)")' /tmp/kb-import.json
else
  cat /tmp/kb-import.json
fi

# Verify by reading Kibana back, not by trusting the response.
echo -n "verified in kibana: "
curl -s -u "elastic:$EP" 'http://localhost:9200/.kibana*/_count' \
  -H 'Content-Type: application/json' \
  -d '{"query":{"terms":{"type":["dashboard","index-pattern"]}}}' \
| jq -r '"\(.count) dashboard/data-view object(s) present"'
