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
  -H 'kbn-xsrf: true' -F file=@"$SRC" \
| python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"imported {d.get(\"successCount\",0)} object(s), success={d.get(\"success\")}"); [print("  ERROR:", e) for e in d.get("errors",[])]'
