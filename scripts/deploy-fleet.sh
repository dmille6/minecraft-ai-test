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
#
# WITHIN-WORLD MODE: --roster <bot,bot,...> treats NAMED BOTS instead of whole pools.
#
# One pool is one Minecraft world, so --pool puts the entire between-world difference inside every
# comparison. Measured 2026-09-23: 86.7% of items/bot-hour variance is within-bot hour-to-hour,
# world level 4.0% and world drift 5.2%, so pool assignment reaches about 9% of the noise. Treating
# 2 of the 5 bots in EVERY world instead takes the items MDE from +146% to +121% at 3h and from +92%
# to +50% at 24h/arm, and it removes a resolution floor that no sample size can fix: with C(16,2)=120
# possible two-pool assignments the smallest attainable randomization p is 1/120.
#
# The deployment has always supported it -- canary-tree.sh takes BOT NAMES and writes a per-bot
# drop-in. What was missing is everything around it: a manifest shape that a prefix-matching reader
# cannot misread, a selector that does not silently target nobody, and a verifier that checks
# identity rather than a count. See scripts/lib/canary_manifest.py for the contract.
USAGE="usage: deploy-fleet.sh <sha> <run_id> [notes] [--pool <pool> | --roster <bot,...>]"
POOL=""
ROSTER=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pool) POOL="${2:?$USAGE}"; shift 2 ;;
    --roster) ROSTER="${2:?$USAGE}"; shift 2 ;;
    --roster-file) ROSTER=$(tr '\n' ',' < "${2:?$USAGE}"); shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
# A canary has ONE membership. Accepting both would leave two disagreeing answers to "who is
# treated", which is the shape that produced every version-label fault in this file's history.
#
# BOTH TESTS ARE `if` BLOCKS DELIBERATELY. This file runs under `set -e`, so a bare
# `[ -n "$A" ] && [ -n "$B" ] && { ... }` as a top-level statement EXITS THE SCRIPT when $A is
# empty -- the compound's status is the failed test's. Written that way, the common case (no
# --roster) would abort the deploy at argument parsing with no message at all.
if [ -n "$POOL" ] && [ -n "$ROSTER" ]; then
  echo "--pool and --roster are exclusive: $USAGE"; exit 1
fi
# CANARY is "is this a canary at all", asked once. Every branch below used to test -n "$POOL",
# and a --roster deploy must take every one of those branches: the baseline tree must stay
# untouched, the per-bot env labels must stand, and the manifest must declare a canary. A missed
# branch here is how a canary ships inert (owner-01, 2026-09-18: 97 minutes as the baseline).
CANARY=""
if [ -n "$POOL" ] || [ -n "$ROSTER" ]; then CANARY=1; fi
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
if [ -n "$ROSTER" ]; then
  # EXACT NAMES, and every one of them must be live. A pool selector degrades gracefully when a bot
  # is missing -- four of five is still a canary -- but a roster does not, for two reasons:
  #
  #  1. The fleet is 16 worlds x 5 live bots = 80, and there are 88 log directories. The 8 extra are
  #     DEAD `Charlie` bots in the -a/-b pools. A roster built by listing log directories draws a
  #     bot that does not exist; selecting it by prefix would quietly treat 1 bot in that world
  #     instead of 2, which under-treats exactly the world the design exists to pair within.
  #  2. The draw is the randomization. Silently dropping a drawn bot makes the realised assignment
  #     differ from the recorded one, and a randomization p-value computed against the recorded draw
  #     is then simply wrong. Refusing costs a redraw; proceeding costs the inference.
  mapfile -t WANT < <(printf '%s\n' "${ROSTER//,/$'\n'}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | sort -u)
  [ "${#WANT[@]}" -gt 0 ] || { bad "--roster is empty"; exit 1; }
  mapfile -t MISSING < <(printf '%s\n' "${WANT[@]}" | grep -vxF -f <(printf '%s\n' "${LIVE[@]}") || true)
  [ "${#MISSING[@]}" -eq 0 ] || {
    bad "${#MISSING[@]} drawn bot(s) are not active: ${MISSING[*]}"
    bad "a drawn bot that is not running makes the realised assignment differ from the recorded"
    bad "draw. Redraw from the ACTIVE unit list -- note the 8 dead Charlie log dirs are not bots."
    exit 1; }
  TARGET=("${WANT[@]}")
  [ "${#TARGET[@]}" -lt "${#LIVE[@]}" ] || {
    bad "the roster is EVERY active bot -- that is a fleet deploy, not a canary"; exit 1; }
  ok "WITHIN-WORLD CANARY: ${#TARGET[@]} of ${#LIVE[@]} bots -- ${TARGET[*]}"
  ok "control: the other $(( ${#LIVE[@]} - ${#TARGET[@]} )), including world-mates of the treated"
elif [ -n "$POOL" ]; then
  # POOL may be a comma-separated list (owner 2026-09-13: canaries run on two pools of five, "B and C")
  mapfile -t TARGET < <(printf '%s\n' "${LIVE[@]}" | grep -E "^(${POOL//,/|})-" || true)
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
if [ -n "$CANARY" ]; then
  BASE_SHA=$(grep -hoP '(?<=^CODE_VERSION=)[^ ]+' "$H"/env/*.env 2>/dev/null \
             | grep -vxF "$SHA" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  [ -n "$BASE_SHA" ] || { bad "cannot determine the baseline version to declare"; exit 1; }
  ok "baseline stays $BASE_SHA; canary is $SHA on ${POOL:-${#TARGET[@]} named bot(s)}"
fi
# THE MANIFEST IS WRITTEN BY ITS OWN CONTRACT, not by a heredoc.
#
# This was `cat > ... <<JSON` with the fields interpolated, and it is the only full writer of the
# manifest in the tree. A heredoc cannot express a within-world declaration (it needs a roster list
# and a sentinel that agree with each other), and more to the point it cannot CHECK one: the writer
# and the validator were separate, so a manifest this script emitted might be one no reader could
# interpret, and nothing would notice until the read. canary_manifest.declare() passes its own
# output through load() before returning it, so an unparseable declaration fails HERE -- before any
# bot restarts -- rather than three hours later with a deployed canary and no way to read it.
python3 - "$RUN" "$BASE_SHA" "$SHA" "$POOL" "$ROSTER" "$NOTES" <<'PY' > /srv/mcbots/trial-manifest.json.new
import json, sys
sys.path.insert(0, '/opt/minecraft-ai/scripts/lib')
import canary_manifest as cm
run, base, sha, pool, roster, notes = sys.argv[1:7]
bots = [b.strip() for b in roster.split(',') if b.strip()]
kw = {}
if bots:
    kw['roster'] = bots; kw['canary_sha'] = sha
elif pool:
    kw['pool'] = pool; kw['canary_sha'] = sha
json.dump(cm.declare(run, base, notes=notes, **kw), sys.stdout, indent=2)
PY
mv /srv/mcbots/trial-manifest.json.new /srv/mcbots/trial-manifest.json
ok "declared $RUN / $BASE_SHA${CANARY:+ (canary $SHA, $(python3 -c '
import json,sys; sys.path.insert(0,"/opt/minecraft-ai/scripts/lib")
import canary_manifest as cm
print(cm.load(json.load(open("/srv/mcbots/trial-manifest.json"))).describe())'))}"

# ------------------------------------------------------------------ install --
say "Harness"
install -m 0755 "$REPO/infra/guard/death-tripper.py" /usr/local/bin/mcai-tripper
if [ -n "$CANARY" ]; then
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
if [ -n "$CANARY" ]; then
  ok "canary labels come from harness-canary/canary.env; per-bot env untouched"
fi
for f in "$H"/env/*.env; do
  b=$(basename "$f" .env)
  V="$SHA"; R="$RUN"
  if [ -n "$CANARY" ]; then
    continue          # canary mode: every per-bot label stands; the canary
                      # tree's env file carries the canary version
  fi
  grep -q '^CODE_VERSION=' "$f" && sed -i "s/^CODE_VERSION=.*/CODE_VERSION=$V/" "$f" \
                               || echo "CODE_VERSION=$V" >> "$f"
  grep -q '^RUN_ID=' "$f"       && sed -i "s/^RUN_ID=.*/RUN_ID=$R/" "$f" \
                               || echo "RUN_ID=$R" >> "$f"
done
if [ -n "$CANARY" ]; then
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
# THE VERIFIER IS NOW A TESTED SCRIPT, not a heredoc inside a command substitution.
#
# What used to be here computed N = the number of DISTINCT VERSION STRINGS and compared it to 1, or
# to 2 for a canary. That count is blind to identity, and identity is the whole question for a
# canary: canary-tree.sh writes one drop-in per treated bot with no per-bot check, so if one drop-in
# of two silently fails the fleet still shows exactly two builds and the count passes. With a
# WITHIN-WORLD canary even the weak proxy is gone, because three bots per world are DELIBERATELY on
# baseline and a fourth one being there is invisible to any prefix rule. Only the declared roster can
# see it, which is why the check moved into scripts/lib/deployverify.py with cases.
#
# The log-glob derivation moved with it. It was open-coded here and AGAIN in canary-loop.sh -- the
# same fact in two places, and the copy here was wrong for the whole of Block 2.
printf '\n'
/usr/local/bin/mcai-tripper 2>&1 | sed 's/^/   /'
printf '\n'
set +e
VOUT=$(python3 "$REPO/scripts/deploy-verify.py" --since "$T0" --harness "$H" \
                --live "${LIVE[*]}" 2>&1)
VRC=$?
set -e
printf '%s\n' "$VOUT"
DIGESTS=$(printf '%s\n' "$VOUT" | sed -n 's/^VERSIONS //p')

if [ "$VRC" -eq 2 ]; then
  bad "no bot has logged since the restart -- convergence is UNKNOWN, not confirmed"
  exit 2
fi
[ "$VRC" -eq 0 ] || exit 1

# THE SUCCESS LINES ARE A CONTRACT WITH A POLLER TWO HOPS AWAY, so they are composed here and
# their wording is fixed. fleet-deploy.sh greps the deploy log for the literal
# "canary split confirmed:" (and requires the canary sha to appear on that same line) or for
# "all live bots on <sha>", and otherwise TIMES OUT after 30 minutes claiming the deploy state is
# unknown -- which it did once on a canary that had verified fine (2026-09-11 03:43). Changing
# these strings breaks the loop without breaking any test.
if [ -n "$CANARY" ]; then
  ok "canary split confirmed: $DIGESTS"
  ok "compare the ${#TARGET[@]} treated bot(s) against the other $(( ${#LIVE[@]} - ${#TARGET[@]} ))"
  if [ -n "$ROSTER" ]; then
    # A within-world canary must NOT be read with --pool: canary-report.py builds its own prefix
    # matcher from that flag, so the sentinel would select nobody and the three deliberate baselines
    # in each treated world would be counted as treated. The reads take the roster from the manifest.
    ok "then: the registered read scripts -- they resolve arms via lib/arms.arm_of from the manifest"
    ok "do NOT pass --pool for a within-world canary; that flag is a pool-prefix matcher"
  else
    ok "then: scripts/canary-report.py --pool $POOL --minutes 20"
  fi
else
  ok "all live bots on $DIGESTS"
fi
