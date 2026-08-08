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
if command -v node >/dev/null 2>&1; then
  RUN_JS() { node "$1"; }
  SYNTAX() { node --check "$1"; }
elif [ -n "$NODE_HOST" ]; then
  KEY="${AGENT_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
  say "  (no local node; running JS checks on $NODE_HOST)"
  tar czf - -C bots src test 2>/dev/null | \
    ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" 'rm -rf /tmp/preflight && mkdir -p /tmp/preflight && tar xzf - -C /tmp/preflight && ln -sf /srv/mcbots/harness/node_modules /tmp/preflight/node_modules' || {
      echo "  FATAL: could not stage sources on $NODE_HOST"; exit 2; }
  RUN_JS() { ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" "cd /tmp/preflight && node $1"; }
  SYNTAX() { ssh -i "$KEY" -o BatchMode=yes "$NODE_HOST" "cd /tmp/preflight && node --check $1"; }
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
for f in bots/test/*.test.mjs; do
  b="test/$(basename "$f")"
  out=$(RUN_JS "$b" 2>&1)
  if [ $? -ne 0 ] || echo "$out" | grep -q "FAIL"; then
    echo "  FAIL  $b"
    echo "$out" | grep -E "FAIL|Error|assert" | head -4 | sed 's/^/        /'
    FAILED+=("$b")
  else
    say "  ok    $(basename "$f")  $(echo "$out" | grep -oE '[0-9]+ passed' | tail -1)"
  fi
done

say ""
say "  ---- supervisor ----"
if command -v python3 >/dev/null 2>&1; then
  for f in infra/guard/test_*.py; do
    [ -e "$f" ] || continue
    if out=$(python3 "$f" 2>&1); then
      say "  ok    $(basename "$f")  $(echo "$out" | tail -1)"
    else
      echo "  FAIL  $(basename "$f")"
      echo "$out" | grep -E "FAIL" | head -4 | sed 's/^/        /'
      FAILED+=("$(basename "$f")")
    fi
  done
fi

say ""
if [ ${#FAILED[@]} -eq 0 ]; then
  say "  PREFLIGHT PASS -- safe to deploy"
  exit 0
fi
echo "  PREFLIGHT FAIL (${#FAILED[@]}): ${FAILED[*]}"
echo "  Do not deploy. A fleet run is for endurance and emergence, not for finding this."
exit 1
