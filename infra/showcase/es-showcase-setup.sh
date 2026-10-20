#!/usr/bin/env bash
# ON THE ELK HOST (10.0.0.186), as root: the showcase's Elasticsearch side. Idempotent.
#   sudo bash es-showcase-setup.sh            # simulate + role + user + ops template; prints NO secret
#   sudo bash es-showcase-setup.sh --simulate # only the template simulation report
#
# Design: docs/reports/showcase-2026-10-20.md section 4. The pattern is infra/elk/create-service-accounts.sh:
# nothing routine runs as `elastic`; the generated password goes to a root-owned file and is never printed.
#
# WHY A SEPARATE WRITER. mcai_ship can write every mcai-* index, so one stray filebeat route would put showcase
# rows into mcai-skill-agents -- the stream fleetstatus, goalboard and staffcensus read. mcai_showcase_ship can
# write ONLY the showcase names; a misroute is a 403, not a contaminated bench.
set -euo pipefail
cd /opt/docker-elk
EP=$(grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
q() { curl -s -u "elastic:$EP" "$@"; }
ok(){ printf '   ok  %s\n' "$*"; }
NAMES=(mcai-skill-showcase mcai-llm-showcase mcai-sys-showcase mcai-mc-showcase mcai-showcase-ops)

echo "== template simulation (which template, data stream or not, ILM, replicas, strict or not)"
for n in "${NAMES[@]}"; do
  q -XPOST "http://localhost:9200/_index_template/_simulate_index/$n" | python3 -c '
import json, sys
d = json.load(sys.stdin); n = sys.argv[1]
if "error" in d:
    print(f"   {n}: ERROR {json.dumps(d[\"error\"])[:200]}"); sys.exit(0)
t = d.get("template", {}); s = t.get("settings", {}).get("index", {}); m = t.get("mappings", {})
ov = d.get("overlapping") or []
print(f"   {n}: matched={[o.get(\"name\") for o in ov] or \"(the winning template only)\"} "
      f"dynamic={m.get(\"dynamic\")} ilm={s.get(\"lifecycle\", {}).get(\"name\")} replicas={s.get(\"number_of_replicas\")} "
      f"top_fields={sorted(m.get(\"properties\", {}))[:14]}")' "$n"
done
for n in mcai-sys-journal; do
  q "http://localhost:9200/_data_stream/$n?filter_path=data_streams.name,data_streams.template" | python3 -c '
import json,sys; print("   bench", sys.argv[1], "->", json.load(sys.stdin))' "$n" || true
  q "http://localhost:9200/$n/_settings?filter_path=*.settings.index.lifecycle,*.settings.index.number_of_replicas" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   bench", sys.argv[1], "settings", list(d.values())[:1])' "$n" || true
done
[ "${1:-}" = --simulate ] && exit 0

echo "== ops template (heartbeat rows; explicit types, 0 replicas, ILM mcai-logs)"
q -XPUT "http://localhost:9200/_index_template/mcai-showcase-ops" -H 'Content-Type: application/json' -d '{
 "index_patterns": ["mcai-showcase-*"], "data_stream": {}, "priority": 500,
 "template": {
  "settings": {"number_of_replicas": 0, "index.lifecycle.name": "mcai-logs"},
  "mappings": {"dynamic": false, "properties": {
   "@timestamp": {"type": "date"}, "t": {"type": "date"}, "frame0_t": {"type": "date"},
   "kind": {"type": "keyword"}, "stamp": {"type": "keyword"}, "step": {"type": "keyword"},
   "why": {"type": "text"}, "event": {"type": "keyword"}, "ok": {"type": "boolean"},
   "capture_min": {"type": "integer"}, "regions": {"type": "integer"}, "frames": {"type": "integer"},
   "bytes": {"type": "long"}, "render_s": {"type": "float"}, "render_cpu_s": {"type": "float"},
   "capture_s": {"type": "float"}, "capture_cpu_s": {"type": "float"}, "snapshot_s": {"type": "float"},
   "disk_free_gb": {"type": "float"}, "missing_24h": {"type": "integer"}, "expected_24h": {"type": "integer"},
   "render_rc": {"type": "keyword"}, "capture_rc": {"type": "keyword"}}}}}' | grep -q '"acknowledged":true' \
  && ok "template mcai-showcase-ops" || { echo "   FAILED: ops template"; exit 1; }

echo "== writer role: the showcase names ONLY"
q -XPUT "http://localhost:9200/_security/role/mcai_showcase_writer" -H 'Content-Type: application/json' -d '{
 "cluster": ["monitor", "read_ilm"],
 "indices": [{"names": ["mcai-skill-showcase", "mcai-llm-showcase", "mcai-sys-showcase", "mcai-mc-showcase",
                        "mcai-showcase-*"],
              "privileges": ["create_doc", "create_index", "auto_configure", "view_index_metadata"]}]}' \
  | grep -q '"role"' && ok "role mcai_showcase_writer" || { echo "   FAILED: role"; exit 1; }

F=/root/.mcai_showcase_ship_password
if [ -s "$F" ]; then
  ok "mcai_showcase_ship already provisioned (password in $F)"
else
  pw=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 28)
  tmp=$(mktemp); chmod 600 "$tmp"
  PW="$pw" python3 -c 'import json,os,sys; json.dump({"password":os.environ["PW"],"roles":["mcai_showcase_writer"],"full_name":"showcase log shipper (showcase streams only)"}, sys.stdout)' > "$tmp"
  code=$(curl -s -o /tmp/mk.out -w '%{http_code}' -u "elastic:$EP" -X POST \
         "http://localhost:9200/_security/user/mcai_showcase_ship" -H 'Content-Type: application/json' --data-binary @"$tmp")
  rm -f "$tmp"
  [ "$code" = 200 ] || { echo "   FAILED creating mcai_showcase_ship (http $code): $(head -c 160 /tmp/mk.out)"; exit 1; }
  ( umask 077; printf '%s' "$pw" > "$F" ); unset pw
  ok "mcai_showcase_ship created (password in $F, mode 600)"
fi

echo "== the boundary, both ways (a bench write must be REFUSED, a showcase write accepted)"
SP=$(cat "$F")
now=$(date -u +%FT%TZ)
bench=$(curl -s -o /dev/null -w '%{http_code}' -u "mcai_showcase_ship:$SP" -X POST \
  "http://localhost:9200/mcai-skill-agents/_doc?op_type=create" -H 'Content-Type: application/json' \
  -d "{\"@timestamp\":\"$now\"}")
show=$(curl -s -o /tmp/sc.out -w '%{http_code}' -u "mcai_showcase_ship:$SP" -X POST \
  "http://localhost:9200/mcai-showcase-ops/_doc?op_type=create" -H 'Content-Type: application/json' \
  -d "{\"@timestamp\":\"$now\",\"kind\":\"es_setup_probe\",\"ok\":true}")
unset SP
echo "   write to mcai-skill-agents as mcai_showcase_ship -> HTTP $bench (must be 403)"
echo "   write to mcai-showcase-ops  as mcai_showcase_ship -> HTTP $show (must be 201)"
[ "$bench" = 403 ] && [ "$show" = 201 ] || { echo "   BOUNDARY CHECK FAILED"; exit 1; }
ok "boundary proved"
