#!/usr/bin/env bash
# Take, release or show the sandbox locks (2026-10-20). The locks live in /tmp on the bots host 10.0.0.31.
#
#   sandbox/sbxlock.sh take    <server|all> <tag> [note...]   e.g. take sandbox6 kitshrink "agent-ac33 Paper drill"
#   sandbox/sbxlock.sh release <server|all> <tag>
#   sandbox/sbxlock.sh status
#
# <server> takes ONE sandbox: /tmp/mcai-sandbox.lock.<server>. `all` takes the GLOBAL lock /tmp/mcai-sandbox.lock,
# which is exactly what every agent and driver has used since September and still means "every sandbox".
# The owner file's first word is <tag>; drivers match it (sandbox/lib/sbxlock.cjs). Release refuses another tag's lock.
#
# Announce-then-check: take mkdirs its own lock FIRST and only then looks for the other kind (a per-server take looks
# for the global lock; a global take looks for any per-server lock), backing out if it finds one. Two concurrent
# takers can both back out; they cannot both hold the same server. It never waits and never breaks a lock.
#
# Runs locally on the lock host (or with SBXLOCK_LOCAL=1, which the tests use with LOCK_ROOT=<tmpdir>); from anywhere
# else it re-runs itself there over ssh.
set -euo pipefail
NAMES="sandbox sandbox2 sandbox3 sandbox4 sandbox5 sandbox6 sandbox7 sandbox8"   # == sandbox/sandboxes.json (tested)
if [[ -z "${SBXLOCK_LOCAL:-}" && "$(hostname)" != block2-bots ]]; then
  exec ssh -o BatchMode=yes "${SBXLOCK_HOST:-mike@10.0.0.31}" "SBXLOCK_LOCAL=1 bash -s -- $(printf '%q ' "$@")" < "${BASH_SOURCE[0]}"
fi
R="${LOCK_ROOT:-/tmp}"; G="$R/mcai-sandbox.lock"
owner_of() { if [[ -f "$1/owner" ]]; then tr '\n' ' ' < "$1/owner"; else echo "(no owner file)"; fi; }
known() { [[ " $NAMES " == *" $1 "* ]]; }
target_of() {
  if [[ "$1" == all ]]; then echo "$G"; elif known "$1"; then echo "$G.$1"
  else echo "unknown server '$1' (one of: $NAMES, or all)" >&2; exit 2; fi
}
CMD="${1:-}"; shift || true
case "$CMD" in
  take)
    S="${1:?server|all}"; TAG="${2:?tag}"; shift 2; NOTE="$*"
    [[ "$TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "bad tag '$TAG' (letters, digits, . _ -)"; exit 2; }
    T="$(target_of "$S")"
    if ! mkdir "$T" 2>/dev/null; then echo "HELD $T: $(owner_of "$T")"; exit 1; fi
    printf '%s %s since %s (%s)\n' "$TAG" "${NOTE:-}" "$(date -u +%FT%TZ)" "$S" > "$T/owner"
    conflict=""
    if [[ "$S" == all ]]; then
      for n in $NAMES; do [[ -d "$G.$n" ]] && conflict+="$G.$n: $(owner_of "$G.$n"); "; done
    else
      [[ -d "$G" ]] && conflict="$G: $(owner_of "$G")"
    fi
    if [[ -n "$conflict" ]]; then
      rm -f "$T/owner"; rmdir "$T"
      echo "REFUSED (backed out of $T): held by $conflict"; exit 1
    fi
    echo "TAKEN $T: $(owner_of "$T")" ;;
  release)
    S="${1:?server|all}"; TAG="${2:?tag}"; T="$(target_of "$S")"
    [[ -d "$T" ]] || { echo "NOT HELD $T"; exit 1; }
    first="$(owner_of "$T" | awk '{print $1}')"
    [[ "$first" == "$TAG" ]] || { echo "REFUSED: $T is held by $(owner_of "$T")"; exit 1; }
    rm -f "$T/owner"; rmdir "$T"; echo "RELEASED $T" ;;
  status)
    any=0
    for T in "$G" $(for n in $NAMES; do echo "$G.$n"; done); do
      [[ -d "$T" ]] && { echo "HELD $T: $(owner_of "$T")"; any=1; }
    done
    [[ "$any" == 1 ]] || echo "all sandbox locks free" ;;
  *) echo "usage: $0 take <server|all> <tag> [note] | release <server|all> <tag> | status"; exit 2 ;;
esac
