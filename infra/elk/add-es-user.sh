#!/usr/bin/env bash
# Create (or update) an Elasticsearch/Kibana user with a password you type.
#
#   sudo /opt/docker-elk/add-es-user.sh mike superuser
#
# The password is read with `read -rs`, so it is never echoed, never appears in
# shell history, and never becomes a command-line argument visible in `ps`. It
# is handed to curl through a file descriptor rather than interpolated into a
# JSON string, so passwords containing quotes, backslashes or $ work correctly --
# naive "-d {\"password\":\"$P\"}" breaks on exactly those characters, and the
# failure looks like a wrong password rather than a quoting bug.
set -euo pipefail
USER_NAME="${1:?usage: add-es-user.sh <username> [role]}"
ROLE="${2:-superuser}"
cd /opt/docker-elk
EP=$(grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)

read -rs -p "Password for '$USER_NAME': " P1; echo
read -rs -p "Repeat: " P2; echo
[ "$P1" = "$P2" ] || { echo "passwords do not match"; exit 1; }
[ ${#P1} -ge 6 ] || { echo "elasticsearch requires at least 6 characters"; exit 1; }

BODY=$(P="$P1" U="$USER_NAME" R="$ROLE" python3 -c '
import json, os
print(json.dumps({"password": os.environ["P"],
                  "roles": [os.environ["R"]],
                  "full_name": os.environ["U"]}))')
unset P1 P2

code=$(printf '%s' "$BODY" | curl -s -o /tmp/es-user.out -w '%{http_code}' \
  -u "elastic:$EP" -X POST "http://localhost:9200/_security/user/$USER_NAME" \
  -H 'Content-Type: application/json' --data-binary @-)
unset BODY

if [ "$code" = "200" ]; then
  echo "  created/updated: $USER_NAME (role: $ROLE)"
  echo "  log in at http://192.168.193.30:5601 as $USER_NAME"
else
  echo "  FAILED (http $code): $(head -c 200 /tmp/es-user.out)"; exit 1
fi
rm -f /tmp/es-user.out
