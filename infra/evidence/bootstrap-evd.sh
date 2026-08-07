#!/usr/bin/env bash
# bootstrap-evd.sh -- the evidence host. DuckDB over NDJSON, pulled from the
# hosts that produce it.
#
# This is the SYSTEM OF RECORD; Elasticsearch is a disposable view (ADR-0001 D4).
# The distinction is load-bearing: today the proof-of-concept demonstrated that a
# telemetry pipeline can generate false labels, persist them, and enforce them as
# policy. When that happens you need an archive that was never derived from the
# thing that was wrong -- raw NDJSON, exactly as the agents wrote it, on a host
# that runs none of their code.
#
#   sudo LAB_HOST=192.168.193.40 MC_HOST=192.168.193.100 ./bootstrap-evd.sh
set -euo pipefail
LAB_HOST="${LAB_HOST:?set LAB_HOST}"
MC_HOST="${MC_HOST:?set MC_HOST}"
EVD=/srv/evidence
say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){ printf '   \033[32m✓\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say "Runtime"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get update -qq
apt-get install -y -qq rsync curl unzip zstd jq python3-pip ufw >/dev/null
if ! command -v duckdb >/dev/null; then
  curl -sSL https://install.duckdb.org | sh >/dev/null 2>&1 || true
  [ -x /root/.duckdb/cli/latest/duckdb ] && ln -sf /root/.duckdb/cli/latest/duckdb /usr/local/bin/duckdb
fi
command -v duckdb >/dev/null && ok "duckdb $(duckdb --version 2>/dev/null | head -1)" || ok "duckdb: install pending"

say "Layout"
id evidence >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$EVD" evidence
# raw/  is append-only truth, never edited. db/ is derived and rebuildable.
mkdir -p "$EVD"/{raw/lab01,raw/mc01,db,bin}
chown -R evidence:evidence "$EVD"
chmod 750 "$EVD"
ok "$EVD/{raw,db,bin}"

say "Pull key"
# A key that exists ONLY to read logs. It is installed on the source hosts with
# a forced command, so possession of it cannot be used to run anything else.
if [ ! -f /root/.ssh/id_ed25519_evd ]; then
  ssh-keygen -q -t ed25519 -N '' -C 'evd01-pull' -f /root/.ssh/id_ed25519_evd
fi
ok "pull key: $(cut -d' ' -f3 /root/.ssh/id_ed25519_evd.pub)"

say "Collector"
install -m 755 /dev/stdin "$EVD/bin/collect.sh" <<COLLECT
#!/usr/bin/env bash
# Pull raw NDJSON from the producing hosts. Never transforms, never deletes on
# the source: a collector that can delete is a collector that can lose the only
# copy of an experiment.
set -uo pipefail
K=/root/.ssh/id_ed25519_evd
O="-i \$K -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
# Paths are relative to the rrsync-confined root on each source host, not
# absolute: the forced command chroots the transfer to /srv/mcbots (lab01) and
# /srv/minecraft/server/logs (mc01).
rsync -az --timeout=60 -e "ssh \$O" mike@$LAB_HOST:/logs/  $EVD/raw/lab01/ 2>/dev/null
rsync -az --timeout=60 -e "ssh \$O" mike@$LAB_HOST:/state/ $EVD/raw/lab01/state/ 2>/dev/null
rsync -az --timeout=60 -e "ssh \$O" mike@$MC_HOST:/ $EVD/raw/mc01/ 2>/dev/null
chown -R evidence:evidence $EVD/raw
echo "collected \$(find $EVD/raw -type f | wc -l) files, \$(du -sh $EVD/raw | cut -f1)"
COLLECT
chown evidence:evidence "$EVD/bin/collect.sh"
ok "collect.sh (pull-only, never deletes on the source)"

say "DuckDB views"
install -m 755 /dev/stdin "$EVD/bin/rebuild-db.sh" <<'DB'
#!/usr/bin/env bash
# Rebuild the queryable view. Derived and disposable -- delete db/ and re-run.
set -euo pipefail
EVD=/srv/evidence
duckdb "$EVD/db/lab.duckdb" <<SQL
INSTALL json; LOAD json;
CREATE OR REPLACE VIEW skills AS
  SELECT * FROM read_ndjson_auto('$EVD/raw/lab01/**/*.jsonl', ignore_errors=true, union_by_name=true);
SQL
echo "rebuilt: $(duckdb "$EVD/db/lab.duckdb" -noheader -list 'SELECT count(*) FROM skills' 2>/dev/null || echo 0) rows"
DB
chown evidence:evidence "$EVD/bin/rebuild-db.sh"
ok "rebuild-db.sh"

say "Timer"
cat > /etc/systemd/system/evd-collect.service <<UNIT
[Unit]
Description=Collect raw agent evidence
[Service]
Type=oneshot
ExecStart=$EVD/bin/collect.sh
Nice=10
IOSchedulingClass=idle
UNIT
cat > /etc/systemd/system/evd-collect.timer <<'UNIT'
[Unit]
Description=Collect agent evidence every 30 minutes
[Timer]
OnBootSec=10min
OnUnitActiveSec=30min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload && systemctl enable evd-collect.timer >/dev/null 2>&1
ok "evd-collect.timer every 30min"

say "Firewall"
ufw allow 22/tcp comment 'ssh' >/dev/null
ufw allow from 192.168.193.0/24 to any port 61208 proto tcp comment 'glances' >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | grep -c ALLOW) allow rules"

say "Done"
cat <<NOTE
   Install the pull key on each source host with a FORCED COMMAND. Plain
   'restrict' is NOT sufficient -- it disables ptys and forwarding but leaves
   command execution open, verified here: the key could run 'id' and got a full
   shell context. rrsync -ro confines it to read-only rsync beneath one path.

   On lab01:
     echo 'command="/usr/bin/rrsync -ro /srv/mcbots",restrict $(cat /root/.ssh/id_ed25519_evd.pub)' >> ~/.ssh/authorized_keys
   On mc01:
     echo 'command="/usr/bin/rrsync -ro /srv/minecraft/server/logs",restrict $(cat /root/.ssh/id_ed25519_evd.pub)' >> ~/.ssh/authorized_keys

   Verify the restriction is real before trusting it:
     ssh -i /root/.ssh/id_ed25519_evd mike@<host> id     # must be REFUSED
NOTE
