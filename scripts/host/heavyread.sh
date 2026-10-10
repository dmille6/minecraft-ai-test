#!/bin/bash
# heavyread.sh <timeout_s> <out_file> -- <command...>      run ONE heavy read / calibration job, serialized and capped
# heavyread.sh --probe                                       print `HEAVYREAD scope cap <N>` (exit 0) or `HEAVYREAD UNAVAILABLE <why>` (exit 1)
#
#   Coordinator 10-10: the fleet host (now 94 GB + 8 GB swap; it was 46 GB, no swap) runs 80 bots (~17.6 GB); one +1440
#   read or a bagnull run peaks at 7-23 GB, so two at once can wake the OOM killer, which may pick a BOT.
#
#   ROLE   HEAVYREAD_ROLE=loop (canary-loop.sh's reads) or calibration (the default: bagnull, bagband3, usafe_null,
#          readcost...). THE CANARY HAS PRIORITY (gate v35 round 4, Claude: a loop read stuck behind a calibration job
#          stalls the death poll that shares its loop):
#            * a CALIBRATION job refuses to start (exit 76) while a canary is declared in the manifest or a canary loop
#              is running (an unreadable manifest also refuses);
#            * a LOOP read waits HEAVYREAD_WAIT s (default 120) for the lock; if a CALIBRATION job holds it, the loop
#              read PREEMPTS it -- the calibration's scope is killed (it is restartable; it records PREEMPTED) -- and
#              takes the lock within HEAVYREAD_WAIT more seconds. A lock held by another LOOP read is never preempted:
#              after the wait the read is NOT run (exit 75).
#          The holder is recorded in <lock>.holder (role, pid, scope unit) while it holds the lock.
#   LOCK   flock on /tmp/mcai-heavyread.lock (HEAVYREAD_LOCK). The command does not inherit the lock fd.
#   CAP    MemoryMax=<cap>, MemorySwapMax=0, on the WHOLE job (every process of it), in a transient SYSTEM scope named
#          heavyread-<role>-<pid>.scope: `sudo -n systemd-run --scope --uid=<me> --gid=<me>`. A user scope needs a user
#          manager, which a loop launched from cron does not have (Linger=no: "Failed to connect to bus").
#          Default cap min(32G, MemTotal - 24G); HEAVYREAD_MAX overrides and must be <digits><K|M|G|T> >= 256M.
#          NO FALLBACK (round 4, both engines: `ulimit -v` is per process -- three workers get three allowances -- and an
#          address-space cap can kill reads that fit by RSS). No scope, or no valid cap: the command is NOT run.
#          --expand-environment=no: values containing $ reach the command verbatim (round 4, Codex; systemd 255 here
#          does not expand scope arguments, the flag guards later versions).
#   EXIT   the command's own status; 137 = killed (the cap, timeout's kill, or a preemption), 124 = timed out,
#          75 = lock busy, 76 = calibration refused (canary active), 77 = no scope, 2 = usage / no valid cap.
#          `timeout --kill-after=60`: a read that ignores SIGTERM is SIGKILLed 60 s later (round 5, Codex).
#          canary-loop.sh journals any non-zero status as read-failed and removes that read's evidence for that minute,
#          so verdict.py answers UNREADABLE for it, never a pass.
set -u
LOCK=${HEAVYREAD_LOCK:-/tmp/mcai-heavyread.lock}; ROLE=${HEAVYREAD_ROLE:-calibration}
MAN=${HEAVYREAD_MANIFEST:-/srv/mcbots/trial-manifest.json}
_cap() {
  if [ -n "${HEAVYREAD_MAX:-}" ]; then
    python3 -c "import re,sys; m=re.fullmatch(r'(\d+)([KMGT])', sys.argv[1]); sys.exit(0 if m and int(m.group(1)) * {'K': 1, 'M': 1024, 'G': 1024**2, 'T': 1024**3}[m.group(2)] >= 256 * 1024 else 1)" "$HEAVYREAD_MAX" || return 1
    echo "$HEAVYREAD_MAX"; return 0
  fi
  local mt; mt=$(awk '/^MemTotal:/ {print int($2 / 1048576)}' "${HEAVYREAD_MEMINFO:-/proc/meminfo}" 2>/dev/null)   # MEMINFO: tests only
  [ -n "$mt" ] && [ "$mt" -gt 28 ] || return 1
  local c=$(( mt - 24 )); [ $c -gt 32 ] && c=32
  echo "${c}G"
}
_scope_ok() { sudo -n systemd-run --scope --quiet --expand-environment=no -p MemoryMax=64M --uid="$(id -u)" --gid="$(id -g)" /bin/true 7>&- 2>/dev/null; }
if [ "${1:-}" = "--probe" ]; then
  CAP=$(_cap) || { echo "HEAVYREAD UNAVAILABLE no valid cap (HEAVYREAD_MAX '${HEAVYREAD_MAX:-}', or MemTotal <= 28 GB)"; exit 1; }
  _scope_ok && { echo "HEAVYREAD scope cap $CAP"; exit 0; }
  echo "HEAVYREAD UNAVAILABLE sudo -n systemd-run --scope failed: reads will NOT run"; exit 1
fi
T=${1:?timeout_s}; OUT=${2:?out_file}; shift 2; [ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "usage: heavyread.sh <timeout_s> <out_file> -- <command...>" >&2; exit 2; }
case "$ROLE" in loop) WAIT=${HEAVYREAD_WAIT:-120};; calibration) WAIT=${HEAVYREAD_WAIT:-2700};;
  *) echo "heavyread: unknown HEAVYREAD_ROLE '$ROLE' -- NOT run" > "$OUT"; exit 2;; esac
CAP=$(_cap) || { echo "heavyread: no valid cap (HEAVYREAD_MAX '${HEAVYREAD_MAX:-}' must be <n><K|M|G|T> >= 256M, or MemTotal <= 28 GB) -- NOT run" > "$OUT"; exit 2; }
if [ "$ROLE" = calibration ] && [ -z "${HEAVYREAD_IGNORE_CANARY:-}" ]; then
  _cp=$(python3 -c "import json,sys; m=json.load(open(sys.argv[1])); print('yes' if (m.get('canary_pool') or m.get('canary_code_version')) else 'no')" "$MAN" 2>/dev/null || echo "unreadable")
  _lp=$(pgrep -f "${HEAVYREAD_LOOP_RE:-^bash /home/mike/canary-loop.sh}" 2>/dev/null | head -1)   # _RE: tests only
  # the loop's own lock too (round 5, Claude: a loop launched other than by `bash <path>` is invisible to pgrep)
  _ll=""; flock -n "${HEAVYREAD_LOOP_LOCK:-/tmp/mcai-canary.lock}" true 2>/dev/null || _ll="held"   # _LOCK: tests only
  if [ "$_cp" != "no" ] || [ -n "$_lp" ] || [ -n "$_ll" ]; then
    echo "heavyread: calibration REFUSED -- a canary is declared or a canary loop is running (manifest canary: ${_cp}; loop pid: ${_lp:-none}; loop lock: ${_ll:-free}); calibrate between canaries" > "$OUT"
    exit 76
  fi
fi
if ! _scope_ok; then
  echo "heavyread: a MemoryMax scope could not be created (sudo -n systemd-run --scope) -- NOT run, never uncapped" > "$OUT"; exit 77
fi
exec 7>>"$LOCK"
if ! flock -w "$WAIT" 7; then
  H0=$(cat "$LOCK.holder" 2>/dev/null)
  _hrole=$(echo "$H0" | awk '{print $1}'); _hpid=$(echo "$H0" | awk '{print $2}'); _hunit=$(echo "$H0" | awk '{print $3}')
  # PREEMPT ONLY A WELL-FORMED, LIVE CALIBRATION RECORD (round 5, Codex): role calibration, a numeric pid that is a running
  # heavyread.sh, and exactly its own unit name heavyread-calibration-<pid>.scope. Anything else is not signalled.
  if [ "$ROLE" = loop ] && [ "$_hrole" = calibration ] && [[ "$_hpid" =~ ^[0-9]+$ ]] \
     && [ "$_hunit" = "heavyread-calibration-$_hpid.scope" ] && grep -qa heavyread "/proc/$_hpid/cmdline" 2>/dev/null; then
    echo "$_hunit" > "$LOCK.preempted"
    echo "heavyread: PREEMPTED the calibration job holding the lock ($H0): the canary's read has priority" > "${OUT}.preempt"
    sudo -n systemctl kill --signal=KILL "$_hunit" 2>/dev/null
    # THE SCOPE MUST BE GONE BEFORE THIS READ RUNS (round 5, Codex: a failed kill must never leave two heavy jobs): the
    # calibration wrapper is NOT signalled -- it releases the lock itself once its scope's process has died. If the
    # scope is still active after HEAVYREAD_WAIT, this read is not run.
    _dead=""
    for _i in $(seq 1 "$WAIT"); do
      systemctl is-active --quiet "$_hunit" 2>/dev/null || { _dead=1; break; }
      sleep 1
    done
    if [ -z "$_dead" ] || ! flock -w "$WAIT" 7; then
      echo "heavyread: the preempted calibration scope $_hunit did not stop, or the lock was not freed -- NOT run" > "$OUT"
      rm -f "${OUT}.preempt"; exit 75
    fi
  else
    echo "heavyread: the heavy-read lock $LOCK was not free within ${WAIT}s (holder: ${H0:-unknown}) -- NOT run" > "$OUT"; exit 75
  fi
fi
UNIT=heavyread-$ROLE-$$
echo "$ROLE $$ $UNIT.scope" > "$LOCK.holder"
trap 'rm -f "$LOCK.holder"' EXIT
START=$(date +%s)
mapfile -d '' _ENV < <(env -0)
sudo -n systemd-run --scope --quiet --expand-environment=no --unit="$UNIT" -p MemoryMax="$CAP" -p MemorySwapMax=0 \
  --uid="$(id -u)" --gid="$(id -g)" /usr/bin/env -i "${_ENV[@]}" timeout --kill-after=60 "$T" "$@" > "$OUT" 2>&1 7>&- &
wait $!; RC=$?
[ -f "${OUT}.preempt" ] && { cat "${OUT}.preempt" >> "$OUT"; rm -f "${OUT}.preempt"; }
if [ "$(cat "$LOCK.preempted" 2>/dev/null)" = "$UNIT.scope" ]; then
  rm -f "$LOCK.preempted"; echo "heavyread: PREEMPTED by a canary read -- rerun this calibration job" >> "$OUT"
fi
EL=$(( $(date +%s) - START ))
echo "heavyread: exit $RC after ${EL}s, cap $CAP via scope, role $ROLE" >> "$OUT"
if [ $RC -eq 137 ] || [ $RC -eq 9 ]; then
  echo "heavyread: KILLED after ${EL}s (memory cap $CAP, the ${T}s timeout's kill, or a preemption) -- evidence absent or partial" >> "$OUT"
elif [ $RC -eq 124 ]; then
  echo "heavyread: TIMED OUT after ${T}s" >> "$OUT"
fi
exit $RC
