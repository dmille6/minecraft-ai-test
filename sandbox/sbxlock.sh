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
# Every take and release runs inside a short MUTEX ($LOCK_ROOT/mcai-sandbox.lock-mutex, held for milliseconds), so a
# release's "is this mine?" check and its rmdir cannot interleave with another take or release (Codex r1 P1: two
# releases of the same lock could otherwise delete the NEXT holder's lock). A mutex left by a killed run is reported,
# never broken: remove it by hand once `ps` shows no sbxlock.sh running.
#
# Runs locally on the lock host (or with SBXLOCK_LOCAL=1, which the tests use with LOCK_ROOT=<tmpdir>); from anywhere
# else it re-runs itself there over ssh.
#
# ADVENTURE MARKERS (2026-10-23, lavastep-01): a driver that sets a server's DEFAULT game mode to adventure (new players
# then cannot dig or place) first writes a marker to $HOME/mcai-sandbox-mode/<server>/<run> on this host -- not /tmp, so
# an outage does not erase it -- and removes it when it restores survival. `take` and `status` print a WARNING for every
# marker: a sandbox silently left in adventure makes every later harness's digs read as zero. To clear one by hand:
# RCON `defaultgamemode survival` on that server, then delete the marker.
set -euo pipefail
NAMES="sandbox sandbox2 sandbox3 sandbox4 sandbox5 sandbox6 sandbox7 sandbox8"   # == sandbox/sandboxes.json (tested)
if [[ -z "${SBXLOCK_LOCAL:-}" && "$(hostname)" != block2-bots ]]; then
  exec ssh -o BatchMode=yes "${SBXLOCK_HOST:-mike@10.0.0.31}" "SBXLOCK_LOCAL=1 bash -s -- $(printf '%q ' "$@")" < "${BASH_SOURCE[0]}"
fi
R="${LOCK_ROOT:-/tmp}"; G="$R/mcai-sandbox.lock"
if [[ -n "${SBXLOCK_MODE_ROOT:-}" ]]; then MR="$SBXLOCK_MODE_ROOT"; elif [[ -n "${LOCK_ROOT:-}" ]]; then MR="$LOCK_ROOT/mcai-sandbox-mode"; else MR="$HOME/mcai-sandbox-mode"; fi
mode_warn() {   # mode_warn <server|all>: one WARNING per adventure marker
  local n f
  for n in $NAMES; do
    [[ "$1" == all || "$1" == "$n" ]] || continue
    for f in "$MR/$n"/*; do
      [[ -f "$f" ]] && echo "WARNING: $n's default game mode may be ADVENTURE (new players cannot dig or place): $f: $(head -c 300 "$f" | tr '\n' ' ')"
    done
  done
  return 0
}
M="$R/mcai-sandbox.lock-mutex"
mutex() {
  local i; for i in $(seq 1 "${SBXLOCK_MUTEX_TRIES:-100}"); do
    if mkdir "$M" 2>/dev/null; then trap 'rmdir "$M" 2>/dev/null || true' EXIT; return 0; fi
    sleep 0.1
  done
  echo "MUTEX STUCK: $M has existed for ${SBXLOCK_MUTEX_TRIES:-100} x 0.1 s (a killed sbxlock.sh?). Remove it by hand if no sbxlock.sh is running."; exit 3
}
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
    [[ "$TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._]*(-[A-Za-z0-9._]+)*$ ]] || { echo "bad tag '$TAG' (letters, digits, . _, inner -)"; exit 2; }   # = sbxlock.cjs
    T="$(target_of "$S")"; mutex
    if ! mkdir "$T" 2>/dev/null; then echo "HELD $T: $(owner_of "$T")"; exit 1; fi
    # Claude r2 P3: a failed owner write must not leave an ownerless dir (read as held by everyone, owned by no one).
    if ! printf '%s %s since %s (%s)\n' "$TAG" "${NOTE:-}" "$(date -u +%FT%TZ)" "$S" > "$T/owner"; then
      if rm -f "$T/owner" && rmdir "$T"; then echo "FAILED: could not write $T/owner; nothing is held"
      else echo "FAILED: could not write $T/owner, and STUCK: $T could not be removed (NO owner file, blocks everyone); remove it by hand"; fi
      exit 1
    fi
    conflict=""
    if [[ "$S" == all ]]; then
      for n in $NAMES; do [[ -d "$G.$n" ]] && conflict+="$G.$n: $(owner_of "$G.$n"); "; done
    else
      [[ -d "$G" ]] && conflict="$G: $(owner_of "$G")"
    fi
    if [[ -n "$conflict" ]]; then
      # A STUCK back-out leaves $T WITHOUT an owner file: every driver and take then reads it as held. Remove it by hand.
      rm -f "$T/owner"; rmdir "$T" || echo "STUCK: could not back out of $T (it now has NO owner file and blocks everyone); remove it by hand"
      echo "REFUSED (backed out of $T): held by $conflict"; exit 1
    fi
    echo "TAKEN $T: $(owner_of "$T")"
    mode_warn "$S" ;;
  release)
    S="${1:?server|all}"; TAG="${2:?tag}"; T="$(target_of "$S")"; mutex
    [[ -d "$T" ]] || { echo "NOT HELD $T"; exit 1; }
    first="$(owner_of "$T" | awk '{print $1}')"
    [[ -z "${SBXLOCK_TEST_PAUSE:-}" ]] || sleep "$SBXLOCK_TEST_PAUSE"   # test hook only: widens the check->rmdir window
    [[ "$first" == "$TAG" ]] || { echo "REFUSED: $T is held by $(owner_of "$T")"; exit 1; }
    # Claude r1 P2: check for anything besides `owner` BEFORE touching it. Removing the owner and then failing the
    # rmdir would leave an ownerless dir, which every driver and every take reads as held: all sandboxes wedged.
    extra="$(ls -A "$T" | grep -vx owner | tr '\n' ' ' || true)"
    [[ -z "$extra" ]] || { echo "REFUSED: $T holds more than its owner file ($extra); remove those, then release again. Nothing changed."; exit 1; }
    rm -f "$T/owner"; rmdir "$T" || { echo "STUCK: $T lost its owner file but could not be removed; remove it by hand"; exit 1; }
    echo "RELEASED $T" ;;
  status)
    any=0
    for T in "$G" $(for n in $NAMES; do echo "$G.$n"; done); do
      [[ -d "$T" ]] && { echo "HELD $T: $(owner_of "$T")"; any=1; }
    done
    [[ "$any" == 1 ]] || echo "all sandbox locks free"
    mode_warn all ;;
  *) echo "usage: $0 take <server|all> <tag> [note] | release <server|all> <tag> | status"; exit 2 ;;
esac
