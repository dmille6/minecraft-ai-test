#!/usr/bin/env bash
# Everything that must pass before code reaches a fleet.
#
#     scripts/preflight.sh            # run it
#     scripts/preflight.sh --quiet    # only failures
#
# WHY THIS EXISTS
#
# On 2026-08-07 six defects were found by deploying to eight live bots and
# reading logs. Five were pure properties of the code -- water counted as a
# wall, a rescue gated behind a log throttle, an escape that graded itself on
# the wrong postcondition, a coordinate rendered with two numbers for a
# three-slot argument, a gate that could block every producer of what its own
# milestone needed. Each cost a deploy, a fleet restart, and a measurement
# window, and the restarts perturbed the very trial they were meant to measure.
#
# Every one of them is now an assertion that runs in milliseconds. The rule this
# encodes: a fleet run tests ENDURANCE AND EMERGENCE. It is not where you
# discover that a branch is unreachable.
set -uo pipefail
cd "$(dirname "$0")/.."

QUIET=0; [ "${1:-}" = "--quiet" ] && QUIET=1
say() { [ $QUIET -eq 1 ] || echo "$@"; }
FAILED=()

# Node lives on the lab hosts, not necessarily here.
NODE_HOST="${PREFLIGHT_NODE_HOST:-}"
KEY="${AGENT_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
if command -v node >/dev/null 2>&1; then
  # Paths arrive as src/x.mjs and test/x.mjs -- relative to bots/, because the
  # remote branch below stages those two directories at the root of a scratch
  # dir and runs there. The local branch must enter bots/ to match, or every
  # check fails with "Cannot find module" and preflight reports a 63-item
  # DO NOT DEPLOY that says nothing about the code. A gate that cries wolf on
  # every local run is worse than no gate: it teaches you to skip it.
  RUN_JS() { (cd bots && node "$1"); }
  SYNTAX() { (cd bots && node --check "$1"); }
  RUN_TESTS() { (cd bots && node scripts/run-tests.mjs); }
elif [ -n "$NODE_HOST" ]; then
  say "  (no local node; running JS checks on $NODE_HOST)"
  tar czf - -C bots src test scripts/run-tests.mjs 2>/dev/null | \
    ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" 'rm -rf /tmp/preflight && mkdir -p /tmp/preflight && tar xzf - -C /tmp/preflight && ln -sf /srv/mcbots/harness/node_modules /tmp/preflight/node_modules' || {
      echo "  FATAL: could not stage sources on $NODE_HOST"; exit 2; }
  RUN_JS() { ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" "cd /tmp/preflight && node $1"; }
  SYNTAX() { ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" "cd /tmp/preflight && node --check $1"; }
  RUN_TESTS() { ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" "cd /tmp/preflight && node scripts/run-tests.mjs"; }
else
  echo "  FATAL: no node, and PREFLIGHT_NODE_HOST is unset"; exit 2
fi

say ""
say "  ---- syntax ----"
for f in bots/src/*.mjs; do
  b="src/$(basename "$f")"
  if ! SYNTAX "$b" >/dev/null 2>&1; then
    echo "  SYNTAX FAIL  $b"; FAILED+=("syntax:$b")
  fi
done
say "  $(ls bots/src/*.mjs | wc -l | tr -d ' ') source files parse"

say ""
say "  ---- behaviour (micro-worlds and replays) ----"
# THE CANONICAL RUNNER, not a loop of our own. This used to be a bash loop
# running each file with none of the runner's env -- no SKILL_TIMEOUT_MS=300,
# no OLLAMA_MODEL, no STOCK_WOOD_TARGET -- so preflight and `npm test` could
# disagree about the same tree, and a homegrown loop once reported green for a
# whole session while the runner was red (CLAUDE.md). The runner owns the env,
# the per-file timeout, the parallelism, and the anchored FAIL-line belt this
# loop used to carry; its exit code is the verdict.
out=$(RUN_TESTS 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  echo "  FAIL  test suite (scripts/run-tests.mjs exit $rc)"
  echo "$out" | grep -E "^FAIL |^FAILED|files passed|\[killed" | head -40 | sed 's/^/        /'
  FAILED+=("tests")
else
  say "  ok    $(echo "$out" | grep -E 'files passed' | tail -1)  ($(echo "$out" | grep -E '^wall ' | tail -1))"
fi

say ""
say "  ---- supervisor and tooling ----"
# scripts/test-*.py was not in this loop, so test-place-town.py -- the only
# thing standing between a bad siting run and eight unusable worlds -- ran only
# when someone remembered to run it. A gate nobody executes is not a gate.
if command -v python3 >/dev/null 2>&1; then
  # THE TRIPPER'S RULES, by name: they are `test_*.py`, which the globs below do
  # not match, so the library the death tripper imports (version_split) went red
  # on main for five weeks -- four suites could not even import it -- with this
  # gate green. Named rather than globbed: scripts/test_*.py holds ~40 suites,
  # several of which need a fleet host, and a gate people learn to skip is worse.
  for f in infra/guard/test_*.py \
           scripts/test_version_split.py scripts/test_canary_split.py \
           scripts/test_death_tripper_adapter.py scripts/test_split_roster.py \
           scripts/test_canary_manifest.py scripts/test_deployverify.py \
           scripts/test_verdict_membership.py \
           scripts/test-*.py scripts/test-*.sh; do
    [ -e "$f" ] || continue
    case "$f" in *.sh) RUN="bash";; *) RUN="python3";; esac
    if out=$($RUN "$f" 2>&1); then
      say "  ok    $(basename "$f")  $(echo "$out" | tail -1)"
    else
      echo "  FAIL  $(basename "$f")"
      echo "$out" | grep -E "^  FAIL[[:space:]]|^FAILED" | head -4 | sed 's/^/        /'
      FAILED+=("$(basename "$f")")
    fi
  done
fi

say ""
say "  ---- live server movement (opt-in) ----"
# NOTHING ABOVE THIS LINE CAN CATCH A SERVER THAT REFUSES TO MOVE BOTS.
#
# Instance #1 ran three days at `goto` 3/240 because its server was upgraded to
# native Paper 1.21.11, which mineflayer 4.37.1 cannot drive -- the server
# re-teleported every bot to byte-identical coordinates twenty times a second.
# Every assertion above passed throughout, correctly: none of our code was wrong.
# Nine agent-side defects were found and fixed underneath that outage before
# anyone thought to reproduce it with a bare client.
#
# Set SMOKE_HOST to gate a deploy on the target server actually being drivable.
if [ -z "${SMOKE_HOST:-}" ]; then
  say "  skipped -- set SMOKE_HOST=<addr> to gate on a live server"
else
  # THE PROBE MUST NOT BORROW A FLEET MEMBER'S NAME.
  #
  # This defaulted to Hive02. Minecraft permits one session per name, so every
  # preflight run logged in as Hive02 and the server kicked the real bot off
  # with duplicate_login. It went unnoticed for as long as it did because Hive02
  # happened to be stopped -- the shared arm had been dark since Aug 8 -- so the
  # name was genuinely free. Restarting that arm turned a silent collision into
  # a visible one, and the failure surfaced as `write EPIPE` in the probe.
  #
  # A gate that only works while part of the fleet is down is not a gate.
  # SmokeProbe belongs to nothing and is whitelisted on the server.
  SMOKE_ENV="MINECRAFT_HOST=$SMOKE_HOST MINECRAFT_PORT=${SMOKE_PORT:-25565} PROBE_NAME=${SMOKE_NAME:-SmokeProbe}"
  [ -n "${SMOKE_VERSION:-}" ] && SMOKE_ENV="$SMOKE_ENV MINECRAFT_VERSION=$SMOKE_VERSION"
  # The probe needs mineflayer, which lives with the harness -- prefer the lab host.
  #
  # IT MUST BE *THIS* COPY OF THE PROBE. The old destination was inside
  # /srv/mcbots/harness, which is root-owned; scp as the login user failed with
  # "Permission denied", the error was swallowed by 2>/dev/null, and the gate
  # then ran whatever stale copy happened to be there. On 2026-08-10 that copy
  # was two days old, so an entire evening of "live server movement: ok" was
  # produced by code nobody had edited in two days -- including runs that were
  # supposed to be verifying edits to the probe itself.
  #
  # Now: a writable directory, a node_modules symlink so imports resolve, no
  # error suppression, and a checksum comparison so a silently-stale probe is
  # impossible rather than merely unlikely.
  if [ -n "$NODE_HOST" ]; then
    if ! scp -q -i "$KEY" scripts/movement-smoke.mjs "$NODE_HOST:/tmp/movement-smoke.mjs"; then
      echo "  FAIL  could not copy the probe to $NODE_HOST"
      FAILED+=("movement-smoke")
      smoke=""
    fi
    want=$(md5 -q scripts/movement-smoke.mjs 2>/dev/null || md5sum scripts/movement-smoke.mjs | cut -d' ' -f1)
    got=$(ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" 'md5sum /tmp/movement-smoke.mjs 2>/dev/null | cut -d" " -f1')
    if [ "$want" != "$got" ]; then
      echo "  FAIL  the probe on $NODE_HOST is not the one in this working tree"
      FAILED+=("movement-smoke")
      smoke=""
    fi
    smoke=$(ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" \
      "mkdir -p /tmp/smoke && cp /tmp/movement-smoke.mjs /tmp/smoke/ && \
       ln -sfn /srv/mcbots/harness/node_modules /tmp/smoke/node_modules && \
       cd /tmp/smoke && env $SMOKE_ENV node movement-smoke.mjs" 2>&1)
  else
    smoke=$(env $SMOKE_ENV node scripts/movement-smoke.mjs 2>&1)
  fi
  if echo "$smoke" | grep -q "PASS: movement is healthy"; then
    say "  ok    movement  $(echo "$smoke" | grep -oE 'furthest from start: *[0-9.]+ blocks' | tr -s ' ')"
  else
    echo "  FAIL  movement-smoke against $SMOKE_HOST"
    echo "$smoke" | grep -E "FAIL|teleport|travelled" | head -5 | sed 's/^/        /'
    FAILED+=("movement-smoke")
  fi
fi

say ""
if [ ${#FAILED[@]} -eq 0 ]; then
  say "  PREFLIGHT PASS -- safe to deploy"
  exit 0
fi
echo "  PREFLIGHT FAIL (${#FAILED[@]}): ${FAILED[*]}"
echo "  Do not deploy. A fleet run is for endurance and emergence, not for finding this."
exit 1
