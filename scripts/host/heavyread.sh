#!/bin/bash
# heavyread.sh <timeout_s> <out_file> -- <command...>
#   Run ONE heavy read (or calibration job) SERIALIZED and under a MEMORY CAP. canary-loop.sh runs every registered read
#   through this; calibration jobs (bagnull, bagband3, usafe_null, readcost...) must too.
#   (Coordinator 10-10: the fleet host has 46 GB and no swap; the bots use ~17.6 GB; one +1440 read or bagnull peaks at
#   7-18 GB, so two at once can wake the OOM killer, which may pick a BOT.)
#
#   LOCK   flock on /tmp/mcai-heavyread.lock (HEAVYREAD_LOCK), waiting up to HEAVYREAD_WAIT s (default 2700). Not
#          acquired -> exit 75 and the command never runs. The command itself does NOT inherit the lock fd, so an
#          orphan cannot keep the lock.
#   CAP    MemoryMax=HEAVYREAD_MAX, MemorySwapMax=0, in a transient SYSTEM scope. The default follows the host:
#          min(32G, MemTotal - 24G), with 24G kept for the bots (~17.6 GB) and the OS. On the 46-GB VM that is 22G; on
#          96 GB it is 32G. Measured 10-10 at W=1920: peacefulkitread 23.0 GB, wellread > 23.6 GB, immobiledid 12.8 GB --
#          so on 46 GB those reads are KILLED (fail closed), which is the point: a read never takes a bot's memory.
#          `sudo -n systemd-run --scope --uid=<me> --gid=<me>`. A user scope needs a user manager, which a loop
#          launched from cron does not have (Linger=no; measured 10-10: "Failed to connect to bus"). The command runs
#          as the caller, with the caller's full environment and cwd. If the scope cannot be created (probe), the
#          fallback is `ulimit -v` at the SAME number: a cap on address space, which is never looser than one on
#          resident memory, so a read can only die earlier, never run uncapped. HEAVYREAD_MODE=scope|ulimit forces one
#          (tests).
#   EXIT   the command's own status. 137 (SIGKILL: the cap, or timeout's kill) is reported as "killed". Any non-zero
#          status means the read's evidence is absent or partial, and canary-loop.sh treats it as a failed read; a
#          read that emitted nothing is UNREADABLE at verdict.py, never a pass.
set -u
T=${1:?timeout_s}; OUT=${2:?out_file}; shift 2; [ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "usage: heavyread.sh <timeout_s> <out_file> -- <command...>" >&2; exit 2; }
LOCK=${HEAVYREAD_LOCK:-/tmp/mcai-heavyread.lock}; WAIT=${HEAVYREAD_WAIT:-2700}
if [ -z "${HEAVYREAD_MAX:-}" ]; then
  _MT=$(awk '/^MemTotal:/ {print int($2 / 1048576)}' "${HEAVYREAD_MEMINFO:-/proc/meminfo}" 2>/dev/null)   # MEMINFO: tests only
  if [ -z "$_MT" ] || [ "$_MT" -le 28 ]; then
    echo "heavyread: cannot size the cap (MemTotal '${_MT:-?}' GB <= 28) -- NOT run" > "$OUT"; exit 2
  fi
  _C=$(( _MT - 24 )); [ $_C -gt 32 ] && _C=32
  CAP=${_C}G
else
  CAP=$HEAVYREAD_MAX
fi
MODE=${HEAVYREAD_MODE:-}
exec 7>>"$LOCK"
if ! flock -w "$WAIT" 7; then
  echo "heavyread: the heavy-read lock $LOCK was not free within ${WAIT}s -- NOT run (another heavy read or calibration job)" > "$OUT"
  exit 75
fi
if [ -z "$MODE" ]; then
  if sudo -n systemd-run --scope --quiet -p MemoryMax=64M --uid="$(id -u)" --gid="$(id -g)" /bin/true 7>&- 2>/dev/null; then MODE=scope; else MODE=ulimit; fi
fi
_kb() {   # 20G / 512M / 1048576K / bytes -> KiB
  python3 -c "import re,sys; m=re.fullmatch(r'(\d+)([KMGT]?)', sys.argv[1].upper()); n=int(m.group(1)); print(n * {'':1,'K':1024,'M':1024**2,'G':1024**3,'T':1024**4}[m.group(2)] // 1024)" "$1"
}
START=$(date +%s)
case "$MODE" in
  scope)
    mapfile -d '' _ENV < <(env -0)
    sudo -n systemd-run --scope --quiet -p MemoryMax="$CAP" -p MemorySwapMax=0 --uid="$(id -u)" --gid="$(id -g)" \
      /usr/bin/env -i "${_ENV[@]}" timeout "$T" "$@" > "$OUT" 2>&1 7>&-
    RC=$?;;
  ulimit)
    ( ulimit -v "$(_kb "$CAP")"; exec timeout "$T" "$@" ) > "$OUT" 2>&1 7>&-
    RC=$?;;
  *) echo "heavyread: unknown HEAVYREAD_MODE '$MODE' -- NOT run" > "$OUT"; exit 2;;
esac
EL=$(( $(date +%s) - START ))
echo "heavyread: exit $RC after ${EL}s, cap $CAP via $MODE" >> "$OUT"
if [ $RC -eq 137 ] || [ $RC -eq 9 ]; then
  echo "heavyread: KILLED after ${EL}s (memory cap $CAP via $MODE, or the ${T}s timeout's kill) -- evidence absent or partial" >> "$OUT"
elif [ $RC -eq 124 ]; then
  echo "heavyread: TIMED OUT after ${T}s" >> "$OUT"
elif [ $RC -ne 0 ] && [ "$MODE" = ulimit ] && grep -qa "MemoryError\|Cannot allocate memory" "$OUT"; then
  echo "heavyread: out of memory under the $CAP ulimit (exit $RC) -- evidence absent or partial" >> "$OUT"
fi
exit $RC
