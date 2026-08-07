#!/usr/bin/env bash
# Create the two least-privilege Elasticsearch accounts the lab ships with.
#
# Extracted from scripts/bootstrap-mcelk.sh. The point is that NOTHING routine
# runs as `elastic`: a log shipper that can only append to mcai-* cannot drop an
# index or read anything else, and a dashboard query that can only read cannot
# mutate. Passwords are generated here and written to root-owned files -- they
# are never printed, so they cannot end up in a scrollback or a transcript.
set -euo pipefail
cd /opt/docker-elk
EP=$(grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
q() { curl -s -u "elastic:$EP" "$@"; }
ok(){ printf '   ok  %s\n' "$*"; }

q -XPUT "http://localhost:9200/_security/role/mcai_writer" -H 'Content-Type: application/json' -d '{
 "cluster":["monitor","manage_index_templates","read_ilm"],
 "indices":[{"names":["mcai-*"],"privileges":["create_doc","create_index","auto_configure","view_index_metadata"]}]}' >/dev/null
ok "role mcai_writer (append-only to mcai-*)"

q -XPUT "http://localhost:9200/_security/role/mcai_reader" -H 'Content-Type: application/json' -d '{
 "cluster":["monitor"],
 "indices":[{"names":["mcai-*"],"privileges":["read","view_index_metadata"]}]}' >/dev/null
ok "role mcai_reader (read-only)"

# Build the JSON with python from the environment rather than interpolating
# into a quoted string: generated passwords are alphanumeric today, but a
# function that only works for "easy" passwords is a trap for whoever changes
# the generator later. Written to a temp file and posted with --data-binary so
# the password never becomes a command-line argument visible in `ps`.
mk(){ # $1=user $2=role $3=file $4=description
  if [ -s "$3" ]; then ok "$1 already provisioned (password in $3)"; return 0; fi
  local pw tmp code
  pw=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 28)
  tmp=$(mktemp); chmod 600 "$tmp"
  PW="$pw" R="$2" D="$4" python3 -c 'import json,os,sys; json.dump({"password":os.environ["PW"],"roles":[os.environ["R"]],"full_name":os.environ["D"]}, sys.stdout)' > "$tmp"
  code=$(curl -s -o /tmp/mk.out -w '%{http_code}' -u "elastic:$EP" \
         -X POST "http://localhost:9200/_security/user/$1" \
         -H 'Content-Type: application/json' --data-binary @"$tmp")
  rm -f "$tmp"
  if [ "$code" = "200" ]; then
    printf '%s' "$pw" > "$3"; chmod 600 "$3"
    ok "$1 created (password in $3, mode 600)"
  else
    echo "   FAILED creating $1 (http $code): $(head -c 160 /tmp/mk.out)"; return 1
  fi
}
mk mcai_ship mcai_writer /root/.mcai_ship_password "log shipper (write-only)"
mk mcai_ro   mcai_reader /root/.mcai_ro_password   "read-only telemetry"
