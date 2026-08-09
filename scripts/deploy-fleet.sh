#!/usr/bin/env bash
# deploy-fleet.sh -- move a running fleet to a new commit, on the fleet host.
#
#   sudo ./deploy-fleet.sh <sha> <run_id> [notes]
#
# This exists because deploying by hand went wrong in three ways on 2026-08-09,
# and all three are the same mistake: changing one of the things that must move
# together and not the others.
#
#   1. src/ was copied but CODE_VERSION was not updated, so every bot reported a
#      commit it was not running. The trial manifest, the tripper's version rule
#      and any analysis that attributes an outcome to a commit all read that
#      label. A stale label is worse than no deploy: the fleet looks declared.
#
#   2. Five units were restarted by name. Solo01 and the hive bots stayed up on
#      the old source. The fleet ran two versions of the harness for eleven
#      minutes and its aggregates were a blend of both.
#
#   3. Both were invisible in the obvious places -- the bots were healthy, the
#      world had them all connected, telemetry flowed. The only thing that saw
#      it was the tripper, via `srcDigest`, and the tripper was overruled.
#
# So: the unit list comes from systemd, not from memory; CODE_VERSION moves with
# the source; and the deploy verifies that every live bot converged before it
# claims to have finished.
set -euo pipefail

SHA="${1:?usage: deploy-fleet.sh <sha> <run_id> [notes]}"
RUN="${2:?usage: deploy-fleet.sh <sha> <run_id> [notes]}"
NOTES="${3:-}"
REPO=/opt/minecraft-ai
H=/srv/mcbots/harness
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m*\033[0m %s\n' "$*"; }
bad() { printf '   \033[31m!\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------- the code --
say "Code"
git config --global --add safe.directory "$REPO" 2>/dev/null || true
git -C "$REPO" fetch -q origin main
git -C "$REPO" reset -q --hard "$SHA"
ok "repo at $(git -C "$REPO" rev-parse --short HEAD)"

# ------------------------------------------------------------ the fleet is --
# WHATEVER IS RUNNING, not whatever I remember running. A bot left up on the old
# source is a partial deploy, and it is the quietest failure in this system.
say "Fleet"
mapfile -t LIVE < <(systemctl list-units 'mcbot@*' --state=active --no-legend \
                    | awk '{print $1}' | sed 's/^mcbot@//; s/\.service$//')
[ "${#LIVE[@]}" -gt 0 ] || { bad "no active mcbot units; nothing to deploy to"; exit 1; }
ok "active: ${LIVE[*]}"

mapfile -t IDLE < <(ls /etc/systemd/system/multi-user.target.wants/mcbot@*.service 2>/dev/null \
                    | sed 's|.*mcbot@||; s|\.service$||' \
                    | grep -vxF -f <(printf '%s\n' "${LIVE[@]}") || true)
[ "${#IDLE[@]}" -eq 0 ] || ok "enabled but stopped, left alone: ${IDLE[*]}"

# ------------------------------------------------------------ declare first --
# The tripper grants a grace period keyed to declared_at, so the declaration has
# to move before the restarts, not after.
say "Declaration"
cat > /srv/mcbots/trial-manifest.json <<JSON
{
  "trial": "instance-1",
  "run_id": "$RUN",
  "declared_code_version": "$SHA",
  "declared_at": "$(date -u +%Y-%m-%dT%H:%M:%S.%6NZ)",
  "notes": "$NOTES"
}
JSON
ok "declared $RUN / $SHA"

# ------------------------------------------------------------------ install --
say "Harness"
cp -r "$REPO/bots/src" "$H/"
cp "$REPO/bots/package.json" "$H/"
chown -R mcbot:mcbot "$H/src" "$H/package.json"
install -m 0755 "$REPO/infra/guard/death-tripper.py" /usr/local/bin/mcai-tripper
ok "source and tripper installed"

for f in "$H"/env/*.env; do
  grep -q '^CODE_VERSION=' "$f" && sed -i "s/^CODE_VERSION=.*/CODE_VERSION=$SHA/" "$f" \
                               || echo "CODE_VERSION=$SHA" >> "$f"
  grep -q '^RUN_ID=' "$f"       && sed -i "s/^RUN_ID=.*/RUN_ID=$RUN/" "$f" \
                               || echo "RUN_ID=$RUN" >> "$f"
done
ok "CODE_VERSION=$SHA RUN_ID=$RUN across $(ls "$H"/env/*.env | wc -l) env files"

# ------------------------------------------------------------------ restart --
# Paper throttles new connections; a tighter stagger gets bots rejected.
say "Restart"
# Everything before this instant is the OLD process talking. See Verify.
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for u in "${LIVE[@]}"; do
  systemctl restart "mcbot@$u"
  ok "$u"
  sleep 6
done

# ------------------------------------------------------------------- verify --
# A deploy that cannot show convergence has not finished. `srcDigest` is the
# evidence here: CODE_VERSION is a claim this script itself just wrote, so
# checking it would only prove the script can write a file.
say "Verify"
sleep 45
# Read the SAME evidence the tripper reads: the JSONL skill logs. The version
# never appears on stdout, so a journal scrape finds nothing and reports it as
# agreement -- a verifier that passes when it can see nothing is worse than none.
#
# Only lines written AFTER the restarts began count. A bot that has not spoken
# yet still has a pre-restart line sitting in its log, and taking that as its
# current version reported a converged fleet as split -- the same mistake the
# tripper had to be taught not to make, where a stopped bot's final line
# outvoted the living. Silence is "not reporting yet", never "still on the old
# code".
DIGESTS=$(tail -q -n 200 /srv/mcbots/logs/skill-*.jsonl 2>/dev/null \
  | T0="$T0" LIVE_N="${#LIVE[@]}" python3 -c '
import sys, os, json
from datetime import datetime, timezone
since = datetime.fromisoformat(os.environ["T0"].replace("Z", "+00:00"))
seen = {}
for line in sys.stdin:
    try: d = json.loads(line)
    except Exception: continue
    v = (d.get("code") or {}).get("version"); b = (d.get("bot") or {}).get("name")
    if not (v and b): continue
    try: ts = datetime.fromisoformat(d["@timestamp"].replace("Z", "+00:00"))
    except Exception: continue
    if ts < since: continue
    if b not in seen or ts > seen[b][0]: seen[b] = (ts, v)
quiet = int(os.environ["LIVE_N"]) - len(seen)
if quiet > 0: sys.stderr.write(f"{quiet} bot(s) have not logged since the restart yet\n")
for v in sorted({v for _, v in seen.values()}): print(v)
')
N=$(printf '%s\n' "$DIGESTS" | grep -c . || true)
[ "$N" -gt 0 ] || bad "no bot has logged since the restart; cannot verify yet"

if [ "$N" -eq 1 ]; then
  ok "all live bots on $DIGESTS"
else
  bad "live bots report $N versions: $DIGESTS"
  bad "the fleet is split -- do not trust aggregates until this is one line"
fi

printf '\n'
/usr/local/bin/mcai-tripper 2>&1 | sed 's/^/   /'
