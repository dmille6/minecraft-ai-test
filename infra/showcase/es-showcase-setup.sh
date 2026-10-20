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
SIMD=$(mktemp -d)
for n in "${NAMES[@]}" mcai-skill-agents mcai-llm-agents mcai-sys-journal mcai-mc-paper; do
  q -XPOST "http://localhost:9200/_index_template/_simulate_index/$n" > "$SIMD/$n.json"
done
python3 - "$SIMD" "${NAMES[@]}" <<'PY'
import json, os, sys
d, names = sys.argv[1], sys.argv[2:]
def show(n, tag=''):
    r = json.load(open(os.path.join(d, n + '.json')))
    if 'error' in r:
        print(f"   {tag}{n}: ERROR {json.dumps(r['error'])[:200]}")
        return None
    t = r.get('template', {}); s = t.get('settings', {}).get('index', {}); m = t.get('mappings', {})
    ov = [o.get('name') for o in (r.get('overlapping') or [])]
    print(f"   {tag}{n}: overlapping={ov} dynamic={m.get('dynamic')} data_stream={'data_stream' in t or bool(r.get('template', {}).get('data_stream'))} "
          f"ilm={s.get('lifecycle', {}).get('name')} replicas={s.get('number_of_replicas')} top_fields={sorted(m.get('properties', {}))[:12]}")
    return m
maps = {n: show(n) for n in names}
for b, sc in (('mcai-skill-agents', 'mcai-skill-showcase'), ('mcai-llm-agents', 'mcai-llm-showcase'),
              ('mcai-mc-paper', 'mcai-mc-showcase'), ('mcai-sys-journal', 'mcai-sys-showcase')):
    bm = show(b, 'bench ')
    same = (json.dumps(bm, sort_keys=True) == json.dumps(maps.get(sc), sort_keys=True)) if bm is not None else None
    print(f"   mapping of {sc} == {b}: {same}")
PY
rm -rf "$SIMD"
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

echo "== catch-all template (mcai-misc-showcase: anything filebeat could not route; kept, never mapped, alarmed on)"
q -XPUT "http://localhost:9200/_index_template/mcai-misc-showcase" -H 'Content-Type: application/json' -d '{
 "index_patterns": ["mcai-misc-showcase"], "data_stream": {}, "priority": 600,
 "template": {"settings": {"number_of_replicas": 0, "index.lifecycle.name": "mcai-logs"},
              "mappings": {"dynamic": false, "properties": {"@timestamp": {"type": "date"}}}}}' \
  | grep -q '"acknowledged":true' && ok "template mcai-misc-showcase" || { echo "   FAILED: misc template"; exit 1; }

echo "== mcai-sys-showcase: the bench journal's template, copied, if nothing else matches"
q -XPOST "http://localhost:9200/_index_template/_simulate_index/mcai-sys-showcase" > /tmp/sys-sim.json
q "http://localhost:9200/_data_stream/mcai-sys-journal" > /tmp/sys-ds.json || true
python3 - "$EP" <<'PY'
import json, subprocess, sys
ep = sys.argv[1]
sim = json.load(open('/tmp/sys-sim.json'))
if sim.get('overlapping') is not None and 'error' not in sim and sim.get('template', {}).get('mappings'):
    print('   mcai-sys-showcase already matches a template with mappings; left alone'); sys.exit(0)
try:
    ds = json.load(open('/tmp/sys-ds.json'))['data_streams'][0]
    name = ds['template']
except Exception:
    print('   mcai-sys-journal is not a templated data stream: mcai-sys-showcase is created as a dynamic data stream '
          'by the shipper (its documents are journald entries; nothing in the bench reads it)'); sys.exit(0)
src = json.loads(subprocess.run(['curl', '-s', '-u', 'elastic:' + ep, f'http://localhost:9200/_index_template/{name}'],
                                capture_output=True, text=True).stdout)['index_templates'][0]['index_template']
body = {'index_patterns': ['mcai-sys-showcase'], 'data_stream': {}, 'priority': 600,
        'template': src.get('template', {})}
r = subprocess.run(['curl', '-s', '-u', 'elastic:' + ep, '-XPUT', 'http://localhost:9200/_index_template/mcai-sys-showcase',
                    '-H', 'Content-Type: application/json', '-d', json.dumps(body)], capture_output=True, text=True).stdout
print('   copied template', name, '->', 'mcai-sys-showcase', r[:80])
PY
rm -f /tmp/sys-sim.json /tmp/sys-ds.json

echo "== writer role: the showcase names ONLY"
q -XPUT "http://localhost:9200/_security/role/mcai_showcase_writer" -H 'Content-Type: application/json' -d '{
 "cluster": ["monitor", "read_ilm"],
 "indices": [{"names": ["mcai-skill-showcase", "mcai-llm-showcase", "mcai-sys-showcase", "mcai-mc-showcase",
                        "mcai-misc-showcase", "mcai-showcase-*"],
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

echo "== the boundary, proved WITHOUT writing to the bench (_has_privileges as mcai_showcase_ship)"
SP=$(cat "$F")
curl -s -u "mcai_showcase_ship:$SP" -X GET "http://localhost:9200/_security/user/_has_privileges" \
  -H 'Content-Type: application/json' -d '{"index": [{"names": ["mcai-skill-agents", "mcai-llm-agents",
   "mcai-mc-paper", "mcai-sys-journal", "mcai-skill-showcase", "mcai-llm-showcase", "mcai-sys-showcase",
   "mcai-mc-showcase", "mcai-misc-showcase", "mcai-showcase-ops"], "privileges": ["create_doc"]}]}' > /tmp/hp.json
show=$(curl -s -o /dev/null -w '%{http_code}' -u "mcai_showcase_ship:$SP" -X POST \
  "http://localhost:9200/mcai-showcase-ops/_doc?op_type=create" -H 'Content-Type: application/json' \
  -d "{\"@timestamp\":\"$(date -u +%FT%TZ)\",\"kind\":\"es_setup_probe\",\"ok\":true}")
unset SP
python3 - "$show" <<'PY'
import json, sys
d = json.load(open('/tmp/hp.json'))['index']
bench = ['mcai-skill-agents', 'mcai-llm-agents', 'mcai-mc-paper', 'mcai-sys-journal']
bad = [n for n in bench if d[n]['create_doc']] + [n for n in d if n not in bench and not d[n]['create_doc']]
for n in sorted(d):
    print(f"   create_doc on {n:22s} -> {d[n]['create_doc']}  ({'must be False' if n in bench else 'must be True'})")
print(f'   positive control: a real write to mcai-showcase-ops -> HTTP {sys.argv[1]} (must be 201)')
if bad or sys.argv[1] != '201':
    print('   BOUNDARY CHECK FAILED:', bad); sys.exit(1)
print('   ok  boundary proved')
PY
rm -f /tmp/hp.json
