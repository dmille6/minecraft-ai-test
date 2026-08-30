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

# CANARY MODE: --pool <name> sends the change to ONE pool and leaves the other
# thirty-five bots on the baseline, in identical worlds, running right now.
#
# On 2026-08-24 six fleet-wide deploys and two reverts cost roughly 80 bot-hours
# of degraded fleet -- two of those changes looked correct, passed a full test
# suite, and one was validated offline against a recorded packet trace before it
# went out. Neither could have been caught by inspection; both were obvious
# within twenty minutes of telemetry. Caught on one five-bot pool that is under
# two bot-hours, a ~47x reduction in the cost of being wrong.
#
# The split is DECLARED in the manifest, and the tripper's canary rule checks
# membership in both directions before allowing it. See canary_split_ok.
USAGE="usage: deploy-fleet.sh <sha> <run_id> [notes] [--pool <pool>]"
POOL=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pool) POOL="${2:?$USAGE}"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]}"
SHA="${1:?$USAGE}"
RUN="${2:?$USAGE}"
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

# TARGET is who gets the new code; LIVE stays the whole fleet, because the
# verifier has to reason about the bots being LEFT BEHIND as well.
if [ -n "$POOL" ]; then
  mapfile -t TARGET < <(printf '%s\n' "${LIVE[@]}" | grep -E "^${POOL}-" || true)
  [ "${#TARGET[@]}" -gt 0 ] || { bad "pool '$POOL' matches no active bot"; exit 1; }
  [ "${#TARGET[@]}" -lt "${#LIVE[@]}" ] || {
    bad "pool '$POOL' matches EVERY active bot -- that is a fleet deploy, not a canary"; exit 1; }
  ok "CANARY: ${#TARGET[@]} of ${#LIVE[@]} bots -- ${TARGET[*]}"
  ok "control: the other $(( ${#LIVE[@]} - ${#TARGET[@]} )) stay on the current build"
else
  TARGET=("${LIVE[@]}")
fi

mapfile -t IDLE < <(ls /etc/systemd/system/multi-user.target.wants/mcbot@*.service 2>/dev/null \
                    | sed 's|.*mcbot@||; s|\.service$||' \
                    | grep -vxF -f <(printf '%s\n' "${LIVE[@]}") || true)
[ "${#IDLE[@]}" -eq 0 ] || ok "enabled but stopped, left alone: ${IDLE[*]}"

# ------------------------------------------------------------ declare first --
# The tripper grants a grace period keyed to declared_at, so the declaration has
# to move before the restarts, not after.
say "Declaration"
# In canary mode the BASELINE stays the declared version -- most of the fleet is
# still running it -- and the canary is declared alongside. Declaring the canary
# as `declared_code_version` would make the thirty-five control bots look like
# undeclared code, which is exactly backwards.
BASE_SHA="$SHA"
if [ -n "$POOL" ]; then
  BASE_SHA=$(grep -hoP '(?<=^CODE_VERSION=)[^ ]+' "$H"/env/*.env 2>/dev/null \
             | grep -vxF "$SHA" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  [ -n "$BASE_SHA" ] || { bad "cannot determine the baseline version to declare"; exit 1; }
  ok "baseline stays $BASE_SHA; canary is $SHA on pool $POOL"
fi
cat > /srv/mcbots/trial-manifest.json <<JSON
{
  "trial": "instance-1",
  "run_id": "$RUN",
  "declared_code_version": "$BASE_SHA",
  "declared_at": "$(date -u +%Y-%m-%dT%H:%M:%S.%6NZ)",
  "canary_pool": "$POOL",
  "canary_code_version": "$([ -n "$POOL" ] && echo "$SHA")",
  "notes": "$NOTES"
}
JSON
ok "declared $RUN / $BASE_SHA${POOL:+ (canary $SHA on $POOL)}"

# ------------------------------------------------------------------ install --
say "Harness"
install -m 0755 "$REPO/infra/guard/death-tripper.py" /usr/local/bin/mcai-tripper
if [ -n "$POOL" ]; then
  # A CANARY MUST NOT WRITE WHERE A CONTROL LOOKS.
  #
  # This used to `cp -r bots/src $H/` for a canary too, and relied on the 75
  # controls never restarting. They restart: measured over 9 hours with a canary
  # live, board-b-Alpha and isolated-c-Bravo both came back running canary code
  # under a baseline label -- about one control every four hours. Stopping them
  # did not hold, because systemd restarts them onto whatever is in $H/src.
  #
  # Canary source now goes to its own tree and five per-instance drop-ins point
  # only the target units at it. Baseline src is untouched, so a control that
  # restarts at ANY moment during this deploy lands on baseline.
  /usr/local/sbin/mcai-canary-tree build "$REPO" "$SHA" "$RUN" "${TARGET[@]}"
  ok "canary source isolated; baseline tree untouched"
else
  # A FLEET DEPLOY OWNS THE BASELINE TREE, and ends any canary. Tearing the
  # drop-ins down FIRST matters: if they survived, the five canary units would
  # keep booting from harness-canary while the manifest said everyone was on the
  # new build -- a split that looks like a clean deploy from every angle.
  /usr/local/sbin/mcai-canary-tree teardown || true
  # rsync --delete, not cp: `cp -r` never removes, so $H/src accumulated three
  # orphan modules from past canaries and identical shas kept producing
  # different digests.
  rsync -a --delete "$REPO/bots/src/" "$H/src/"
  cp "$REPO/bots/package.json" "$H/"
  chown -R mcbot:mcbot "$H/src" "$H/package.json"
  ok "baseline source installed"
fi

# THE SOURCE NO LONGER MOVES FOR EVERYONE.
#
# This block used to be headed "the source moves for everyone, the label does
# not, and that is survivable", and argued that running two source trees was
# "more machinery than the risk deserves" because the tripper would catch any
# control that drifted. Both halves were wrong.
#
# The tripper did NOT catch it: canary_split_ok compared bare shas and threw
# away the digest that exists precisely to detect this, and separately the whole
# version guard was reading a manifest and logs from hosts decommissioned on
# 2026-08-20, so it returned "not a fault" on every run for weeks.
#
# And the risk was not hypothetical. Over 9 hours with a canary live, two
# controls came back on canary code. Stopping them did not hold. That is not a
# tolerable background rate; it is a control group dissolving while the
# experiment runs.
#
# A canary now writes only harness-canary, so a restarting control cannot load
# it. In canary mode the label comes from the canary tree's own env file, and
# these per-bot files are left alone entirely -- one place sets the version for
# canary bots, not two that can disagree.
if [ -n "$POOL" ]; then
  ok "canary labels come from harness-canary/canary.env; per-bot env untouched"
fi
for f in "$H"/env/*.env; do
  b=$(basename "$f" .env)
  V="$SHA"; R="$RUN"
  if [ -n "$POOL" ]; then
    continue          # canary mode: every per-bot label stands; the canary
                      # tree's env file carries the canary version
  fi
  grep -q '^CODE_VERSION=' "$f" && sed -i "s/^CODE_VERSION=.*/CODE_VERSION=$V/" "$f" \
                               || echo "CODE_VERSION=$V" >> "$f"
  grep -q '^RUN_ID=' "$f"       && sed -i "s/^RUN_ID=.*/RUN_ID=$R/" "$f" \
                               || echo "RUN_ID=$R" >> "$f"
done
if [ -n "$POOL" ]; then
  ok "CODE_VERSION=$SHA RUN_ID=$RUN via harness-canary/canary.env (${#TARGET[@]} unit(s))"
else
  ok "CODE_VERSION=$SHA RUN_ID=$RUN across ${#TARGET[@]} env file(s)"
fi

# ------------------------------------------------------------------ restart --
# Paper throttles new connections; a tighter stagger gets bots rejected.
say "Restart"
for u in "${TARGET[@]}"; do
  systemctl restart "mcbot@$u"
  ok "$u"
  sleep 6
done
# EVERYTHING BEFORE THIS INSTANT MAY BE THE OLD PROCESS TALKING.
#
# This mark used to be taken BEFORE the loop. Units restart one at a time with a
# gap the server's connection throttle requires, so a unit restarted 40s in can
# still be writing old-code records well after a fleet-wide start mark -- and a
# skill finishing during SIGTERM writes one on its way out. That reported a
# converged fleet as split on an otherwise clean deploy.
#
# Taken after the last restart, any record newer than this is unambiguously
# from a new process. The cost is that an early-restarted bot may not have
# spoken again yet, which the check below already reports as quiet rather than
# as disagreement.
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)

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
# THE VERIFIER HAS BEEN BLIND FOR THE WHOLE OF BLOCK 2.
#
# This read /srv/mcbots/logs/skill-*.jsonl, which is instance #1's layout. Block
# 2 writes to $LOG_DIR from each bot's env file -- /var/log/mcai/<bot>/ -- so the
# glob matched nothing, DIGESTS came back empty, and every deploy printed
# "40 bot(s) have not logged since the restart yet" and exited 2. I read past
# that line on six deploys in one day because I was verifying convergence by
# hand afterwards.
#
# It is the same stale path that had fleet-status printing "?" in its MOVED
# column for forty bots, and the same shape as everything else here: an
# observation that does not reach the decision it exists to inform.
LOGGLOB=$(grep -hoP '(?<=^LOG_DIR=).*' "$H"/env/*.env 2>/dev/null | sort -u \
          | sed 's|$|/skill-*.jsonl|' | tr '\n' ' ')
LOGGLOB=${LOGGLOB:-/var/log/mcai/*/skill-*.jsonl}
DIGESTS=$(tail -q -n 200 $LOGGLOB 2>/dev/null \
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

# A VERIFIER THAT DOES NOT FAIL IS A NARRATOR.
#
# `bad` prints in red and returns 0, so under `set -e` this block detected a
# split fleet, said so, and exited successfully anyway. It caught Miner01
# running the previous build on 2026-08-10 and the deploy still reported done.
#
# Same shape as everything else this file was written to prevent: an
# observation that does not reach the decision it exists to inform. Three
# distinct outcomes now, and only one of them is success.
printf '\n'
/usr/local/bin/mcai-tripper 2>&1 | sed 's/^/   /'

if [ "$N" -eq 0 ]; then
  bad "no bot has logged since the restart -- convergence is UNKNOWN, not confirmed"
  exit 2
fi

# A CANARY EXPECTS TWO VERSIONS. One would mean the split never happened.
EXPECT=1
[ -n "$POOL" ] && EXPECT=2
if [ "$N" -ne "$EXPECT" ]; then
  bad "live bots report $N version(s), expected $EXPECT: $DIGESTS"
  if [ -n "$POOL" ]; then
    bad "a canary that is not split is not a canary -- either the pool did not"
    bad "restart, or the controls restarted too. Check before trusting any"
    bad "comparison between them."
  else
    bad "the fleet is split -- aggregates blend two builds until this is one line"
  fi
  exit 1
fi
if [ -n "$POOL" ]; then
  ok "canary split confirmed: $(printf '%s' "$DIGESTS" | tr '\n' ' ')"
  ok "compare pool $POOL against the other $(( ${#LIVE[@]} - ${#TARGET[@]} )) bots"
  ok "then: scripts/canary-report.py --pool $POOL --minutes 20"
else
  ok "all live bots on $DIGESTS"
fi
