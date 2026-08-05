#!/usr/bin/env bash
# sync-check.sh -- what the other agent has done since I last looked.
#
# Event-driven rather than on a timer: run it when starting work and before
# drawing conclusions. A clock-based poll notices changes at a random offset
# and still requires the pull; this notices them at the moment they matter.
set -uo pipefail
cd "$(dirname "$0")/.."

git fetch -q origin 2>/dev/null
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

printf '\n\033[1;36m== repo sync\033[0m\n'
printf '   %s behind · %s ahead · %s uncommitted\n' \
  "$BEHIND" "$AHEAD" "$(git status --porcelain | wc -l | tr -d ' ')"

if [ "$BEHIND" -gt 0 ]; then
  printf '\n   incoming:\n'
  git log --oneline HEAD..origin/main | sed 's/^/      /'
  FILES=$(git diff --name-only HEAD...origin/main)   # three dots: since the merge base

  # The schema is the contract between the harness and the mappings. A field
  # added on one side and not the other silently rejects whole documents.
  if echo "$FILES" | grep -qE 'schemas/|infra/elk/'; then
    printf '\n   \033[33m! TELEMETRY CONTRACT TOUCHED\033[0m — check field names before deploying:\n'
    echo "$FILES" | grep -E 'schemas/|infra/elk/' | sed 's/^/      /'
  fi
  if echo "$FILES" | grep -q '^bots/'; then
    printf '\n   \033[33m! bots/ changed upstream\033[0m (that is my area — read before overwriting):\n'
    echo "$FILES" | grep '^bots/' | sed 's/^/      /'
  fi
fi

if [ -f docs/IN-FLIGHT.md ]; then
  INF=$(git show origin/main:docs/IN-FLIGHT.md 2>/dev/null | grep -E '^[0-9]{4}-' || true)
  [ -n "$INF" ] && { printf '\n   work in flight elsewhere:\n'; echo "$INF" | sed 's/^/      /'; }
fi

printf '\n   %s\n\n' "$([ "$BEHIND" -gt 0 ] && echo 'run: git pull --ff-only' || echo 'up to date')"
