#!/bin/bash
# drop16.sh -- learning loop M2b (OWNER 10-21: "Remove .16 from every endpoint list BEFORE training starts").
# Removes the 3090 (10.0.0.16) from OLLAMA_BASE_URLS in all 80 bot env files, so no bot request can land on the GPU
# that is about to train. Since 10-21 13:42Z (~/dmove.sh) every bot reads
#     OLLAMA_BASE_URLS=http://10.0.0.72:11434,http://10.0.0.16:11434      (5080 first, 3090 fallback)
#     OLLAMA_BASE_URL=http://10.0.0.72:11434
# and after this it reads OLLAMA_BASE_URLS=http://10.0.0.72:11434 (OLLAMA_BASE_URL is already .72 and is not touched).
# Design: docs/reports/learning-loop-design-2026-10-21.md s.5.2 (option A) and its mechanical exclusion (i)-(ii).
# Env-only: no code, unit, drop-in, queue, scheduler or manifest change. 10.0.0.72 is never contacted.
#
# RUN IT IN A CANARY GAP, FROM A COPY OUTSIDE ANY REPO (the owner runs it; an agent never does):
#     cp drop16.sh ~/drop16.sh && bash ~/drop16.sh                 # DRY RUN (default): checks + the plan, changes nothing
#     bash ~/drop16.sh --apply                                    # backups, edit, restart 80 bots 12 s apart, verify
#     bash ~/drop16.sh --verify <since ISO, e.g. 2026-10-23T10:00:00Z>   # read-only: environ + llm rows since then
#     bash ~/drop16.sh --rollback <stamp> [--hold-token <T>]      # restore *.bak-drop16-<stamp>, restart 12 s apart
#       (--hold-token: ADOPT the install-hold a failed --apply kept -- it prints the exact command -- instead of
#        claiming a new one, so the slot never reopens to the scheduler while the fleet is half-applied)
#
# INSTALLER PROTOCOL (CLAUDE.md "Deploys"): --apply / --rollback take the scheduler's install-hold through
# holdtoken.py claim (refuses unless the slot is free, checked under the scheduler's own tick lock) and
# /tmp/mcai-canary.lock (flock -n) for the whole run, refuse on a declared canary, any canary drop-in, a running canary
# loop or chain, and release their own hold on exit. NEVER wrap canary-sched.py in flock ~/sched.lock (it deadlocks).
# The restart takes ~16 min (80 x 12 s); the hold is claimed for HOLD_MIN (default 45) minutes.
#
# REFUSES (before touching anything) unless: exactly 80 env files; each has exactly ONE OLLAMA_BASE_URLS line, equal to
# the 5080-first line above, and OLLAMA_BASE_URL equal to .72; no env file or mcbot drop-in mentions 10.0.0.16 anywhere
# else. After the edit each file must differ from its backup in exactly that one line, or everything is restored.
#
# VERIFY (after --apply, and by itself with --verify): every running bot's /proc/<pid>/environ has the new line and no
# 10.0.0.16 (exclusion (ii)); the bot llm rows since the restart: model rows by served endpoint (gate: all on .72,
# 0 on .16, 0 without an endpoint), latency p50/p95/p99 (gates 2.5 / 5 / 10 s), retry_count > 0, and the code versions
# live (must be the one version that was live before). Exclusion (i) -- 0 fleet rows on .16 for 24 h -- is the same
# --verify run 24 h later; only then may training start on .16.
set -u
E=${ENV_DIR:-/srv/mcbots/harness/env}
# Paths are overridable ONLY so scripts/host/test_drop16.py can run the script against a sandbox; the defaults are
# the fleet's.
H=${DROP16_HOME:-/home/mike}
MAN=${DROP16_MANIFEST:-/srv/mcbots/trial-manifest.json}
PROC=${DROP16_PROC:-/proc}
UNITS=${DROP16_UNITS:-/etc/systemd/system}
LOGROOT=${DROP16_LOGROOT:-/var/log/mcai}
WAIT=${DROP16_WAIT:-180}
LOCKF=${DROP16_LOCK:-/tmp/mcai-canary.lock}
HOLDTOKEN=${HOLDTOKEN:-$H/gate-v36/holdtoken.py}
HOLD_MIN=${HOLD_MIN:-45}
EXPECT=${EXPECT:-80}
STAGGER=${STAGGER:-12}
OLD_URLS="OLLAMA_BASE_URLS=http://10.0.0.72:11434,http://10.0.0.16:11434"
NEW_URLS="OLLAMA_BASE_URLS=http://10.0.0.72:11434"
URL1="OLLAMA_BASE_URL=http://10.0.0.72:11434"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MODE=dry; ARG=""; ADOPT=""
case "${1:-}" in
  "") ;;
  --apply) MODE=apply;;
  --verify) MODE=verify; ARG=${2:?--verify needs a since ISO time};;
  --rollback) MODE=rollback; ARG=${2:?--rollback needs the backup stamp}
              if [ "${3:-}" = --hold-token ]; then ADOPT=${4:?--hold-token needs the token}; fi;;
  *) echo "usage: $0 [--apply | --verify <since ISO> | --rollback <stamp> [--hold-token <token>]]"; exit 2;;
esac
say() { echo "== $*"; }
die() { echo "REFUSED: $*"; exit 2; }
W() { if [ "$MODE" = dry ]; then echo "  (dry run) WOULD REFUSE: $*"; DRY_REFUSE=1; else die "$*"; fi; }
DRY_REFUSE=""

case "$(cd "$(dirname "$0")" && pwd)" in
  /opt/minecraft-ai*|*/code-minecraft-ai*|*/mcai-*) [ "$MODE" = verify ] || die "run this from a copy outside the repo (cp to ~/drop16.sh)";;
esac

files=$(ls "$E"/*.env 2>/dev/null | grep -v '/\._')
n=$(echo "$files" | grep -c . || true)

verify() {   # $1 = since ISO; $2 = the OLLAMA_BASE_URLS line every bot must run with (default: the new one)
  local want=${2:-$NEW_URLS}
  say "VERIFY: environ of every running bot (want '$want'), then the llm rows since $1"
  local bad=0 b pid envl
  for f in $files; do
    b=$(basename "$f" .env)
    pid=$(systemctl show -p MainPID --value "mcbot@$b.service" 2>/dev/null)
    if [ -z "$pid" ] || [ "$pid" = 0 ]; then echo "  !! $b: not running (MainPID $pid)"; bad=$((bad+1)); continue; fi
    envl=$(sudo -n cat "$PROC/$pid/environ" 2>/dev/null | tr '\0' '\n')
    if [ -z "$envl" ]; then echo "  !! $b: cannot read $PROC/$pid/environ"; bad=$((bad+1)); continue; fi
    if [ "$want" = "$NEW_URLS" ] && echo "$envl" | grep -q '10\.0\.0\.16'; then echo "  !! $b (pid $pid): environ still names 10.0.0.16: $(echo "$envl" | grep '10\.0\.0\.16' | head -2 | tr '\n' ' ')"; bad=$((bad+1)); continue; fi
    echo "$envl" | grep -qx "$want" || { echo "  !! $b (pid $pid): OLLAMA_BASE_URLS is $(echo "$envl" | grep '^OLLAMA_BASE_URLS=' | head -1)"; bad=$((bad+1)); }
  done
  echo "  environ: $((n - bad)) of $n bots run with '$want'"
  python3 - "$1" "$E" "$want" "$LOGROOT" <<'PY'
import datetime as dt, glob, gzip, json, os, statistics, sys
since = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
bots = sorted(os.path.basename(f)[:-4] for f in glob.glob(sys.argv[2] + '/*.env') if not os.path.basename(f).startswith('._'))
ep, lat, vers, retry, rows, nobot = {}, [], {}, 0, 0, []
for b in bots:
    lr = sys.argv[4]
    fs = ['%s/%s/llm-%s.jsonl' % (lr, b, b)] + sorted(glob.glob('%s/%s/llm-%s.jsonl-*' % (lr, b, b)))[-2:]
    newest = None; seen = 0
    for f in fs:
        if not os.path.exists(f):
            continue
        op = gzip.open if f.endswith('.gz') else open
        with op(f, 'rt', errors='replace') as fh:
            for line in fh:
                if line[15:34] < since.strftime('%Y-%m-%dT%H:%M:%S'):
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                L = r.get('llm') or {}
                if not (L.get('latency_ms') or 0) > 0:
                    continue
                rows += 1; seen += 1
                e = str(L.get('endpoint')); ep[e] = ep.get(e, 0) + 1
                lat.append(L['latency_ms']); retry += (L.get('retry_count') or 0) > 0
                if newest is None or r['@timestamp'] > newest[0]:
                    newest = (r['@timestamp'], ((r.get('code') or {}).get('version') or '?')[:8])
    if newest:
        vers[newest[1]] = vers.get(newest[1], 0) + 1
    if not seen:
        nobot.append(b)
lat.sort()
q = lambda p: lat[min(len(lat) - 1, int(p * len(lat)))] if lat else None
print('  llm model rows since %s: %d from %d of %d bots (silent: %s)' % (sys.argv[1], rows, len(bots) - len(nobot), len(bots), nobot or 'none'))
print('  served by: %s' % ep)
print('  latency ms p50 %s p95 %s p99 %s; retry_count > 0: %d' % (q(.5), q(.95), q(.99), retry))
print('  code versions live (newest row per bot): %s' % vers)
new_line = sys.argv[3].endswith('10.0.0.72:11434')       # after --rollback the fallback is back: rows on .16 are allowed
gates = [('rows seen', rows > 0), ('all on .72', rows > 0 and (ep.get('http://10.0.0.72:11434', 0) == rows or not new_line)),
         ('0 on .16', ep.get('http://10.0.0.16:11434', 0) == 0 or not new_line), ('0 without endpoint', ep.get('None', 0) == 0),
         ('p50 <= 2.5 s', lat and q(.5) <= 2500), ('p95 <= 5 s', lat and q(.95) <= 5000), ('p99 <= 10 s', lat and q(.99) <= 10000),
         ('one version live', len(vers) == 1), ('every bot decided', not nobot)]
for g, ok in gates:
    print('  %s %s' % ('ok  ' if ok else '!!  ', g))
sys.exit(0 if all(ok for _, ok in gates) else 1)
PY
  local rc=$?
  [ "$bad" -eq 0 ] && [ "$rc" -eq 0 ] && { echo "VERIFY OK"; return 0; }
  echo "VERIFY FAILED (environ bad $bad, row gates rc $rc) -- rollback: bash $0 --rollback <stamp>"; return 1
}

if [ "$MODE" = verify ]; then verify "$ARG"; exit $?; fi

say "1. the slot: no canary declared, no drop-in, no loop or chain"
_busy() {
  local D L C CP
  D=$(ls "$UNITS"/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
  [ -z "$D" ] || W "canary drop-ins present: $D"
  L=$(pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep || true)
  [ -z "$L" ] || W "a canary loop is running: $L"
  C=$(pgrep -af 'chain-[a-z0-9-]*\.sh|launch-[a-z0-9-]*\.sh|chain-after' | grep -v -e pgrep -e drop16 || true)
  [ -z "$C" ] || W "a chain/launch script is running: $C"
  CP=$(python3 -c "
import json, sys
m = json.load(open('$MAN'))
if not isinstance(m, dict) or 'canary_pool' not in m: sys.exit(3)
print('ACTIVE ' + str(m.get('canary_pool')) + ' ' + str(m.get('canary_code_version')) if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')" 2>&1) || CP="unreadable ($CP)"
  [ "$CP" = "INACTIVE" ] || W "a canary is declared or the manifest is unreadable ($CP)"
}
_busy
[ -f "$HOLDTOKEN" ] || W "holdtoken.py not found at $HOLDTOKEN (set HOLDTOKEN=)"
if [ "$MODE" = dry ]; then
  HO=$(python3 "$HOLDTOKEN" owner 2>&1); [ -z "$HO" ] || W "an install-hold exists (owner $HO)"
  flock -n "$LOCKF" true || W "/tmp/mcai-canary.lock is held"
else
  if [ -n "$ADOPT" ]; then
    # ADOPT the hold a failed --apply kept (Claude r2 P2): a fresh claim would be refused while it exists, and releasing
    # it first would reopen the slot to canary-sched while the fleet is half-applied
    HO=$(python3 "$HOLDTOKEN" owner 2>&1)
    [ "$HO" = "$ADOPT" ] || die "the current install-hold is '$HO', not '$ADOPT' -- nothing adopted"
    TOKEN=$ADOPT; CL="adopted the kept install-hold $TOKEN"
    ADOPTED=1
  else
    TOKEN="drop16:$MODE:$$:$(date +%s%N)"
    CL=$(python3 "$HOLDTOKEN" claim "$TOKEN" "$HOLD_MIN" 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-500)"
  fi
  # THE HOLD IS KEPT FROM THE FIRST MUTATION until a VERIFIED end (Codex r1 P1, r2 P1): any exit in between -- a
  # failed copy, an interruption, a failed restart or verify -- leaves it held, with the exact command to finish.
  # an ADOPTED hold belongs to a fleet that is already half-applied: it stays held through ANY refusal from here on
  # (a held lock, a bad stamp, a missing backup) until the rollback is verified (Codex r3 P1)
  KEEP_HOLD=${ADOPTED:-}; ROLLSTAMP=$STAMP; [ "$MODE" = rollback ] && ROLLSTAMP=$ARG
  trap '[ -n "$KEEP_HOLD" ] && echo "INSTALL-HOLD KEPT ($TOKEN). Roll back with: bash $0 --rollback $ROLLSTAMP --hold-token $TOKEN   (or fix by hand, then: python3 $HOLDTOKEN release $TOKEN)" || python3 "$HOLDTOKEN" release "$TOKEN" >/dev/null 2>&1' EXIT
  echo "  $(echo "$CL" | tail -1 | cut -c1-200)"
  exec 8>"$LOCKF"; flock -n 8 || die "$LOCKF is held"
  _busy      # re-checked UNDER the hold and the lock
fi

restart_all() {
  say "restart $n bots ${STAGGER} s apart (~$(( n * STAGGER / 60 )) min)"
  local i=0 fails=0 b
  for f in $files; do
    b=$(basename "$f" .env); i=$((i+1))
    if sudo -n systemctl restart "mcbot@$b.service"; then echo "  [$i/$n] restarted $b"; else echo "  [$i/$n] !! restart FAILED $b"; fails=$((fails+1)); fi
    [ "$i" -lt "$n" ] && sleep "$STAGGER"
  done
  return $fails
}

if [ "$MODE" = rollback ]; then
  say "ROLLBACK from *.bak-drop16-$ARG"
  [[ "$ARG" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "stamp looks like 20261023T101500Z"
  for f in $files; do [ -f "$f.bak-drop16-$ARG" ] || die "missing backup $f.bak-drop16-$ARG -- nothing restored"; done
  KEEP_HOLD=1
  for f in $files; do sudo -n cp -p "$f.bak-drop16-$ARG" "$f" && cmp -s "$f.bak-drop16-$ARG" "$f" || die "restore of $f failed -- fix by hand"; done
  echo "  restored $n files; verified byte-equal to their backups"
  restart_all; rfail=$?
  T1=$(date -u +%FT%TZ)
  say "wait 180 s after the LAST restart, then verify the restored line is what every bot runs"
  sleep "$WAIT"
  verify "$T1" "$OLD_URLS"; vrc=$?
  if [ "$rfail" != 0 ] || [ "$vrc" != 0 ]; then
    KEEP_HOLD=1; echo "ROLLBACK NOT VERIFIED ($rfail restart failure(s), verify rc $vrc) -- the install-hold is kept"; exit 4
  fi
  KEEP_HOLD=""; echo "ROLLED BACK $ARG and verified"; exit 0
fi

say "2. the $EXPECT env files are on the 5080-first lines"
[ "$n" = "$EXPECT" ] || die "expected $EXPECT env files in $E, found $n"
pre_bad=0
for f in $files; do
  c=$(grep -c '^OLLAMA_BASE_URLS=' "$f"); c1=$(grep -c '^OLLAMA_BASE_URL=' "$f")
  if [ "$c" != 1 ] || ! grep -qx "$OLD_URLS" "$f" || [ "$c1" != 1 ] || ! grep -qx "$URL1" "$f"; then
    echo "  !! $(basename "$f"): OLLAMA_BASE_URLS x$c $(grep '^OLLAMA_BASE_URLS=' "$f" | head -1) / OLLAMA_BASE_URL x$c1 $(grep '^OLLAMA_BASE_URL=' "$f" | head -1)"
    pre_bad=$((pre_bad+1)); continue
  fi
  o=$(grep -n '10\.0\.0\.16' "$f" | grep -v ":$OLD_URLS\$" || true)
  [ -z "$o" ] || { echo "  !! $(basename "$f"): 10.0.0.16 elsewhere: $o"; pre_bad=$((pre_bad+1)); }
done
[ "$pre_bad" = 0 ] || W "$pre_bad env file(s) are not on the expected lines (listed above): nothing changed"
DI=$(grep -l '10\.0\.0\.16' "$UNITS"/mcbot@*.service.d/*.conf "$UNITS"/mcbot@.service 2>/dev/null | tr '\n' ' ')
[ -z "$DI" ] || W "a unit or drop-in names 10.0.0.16: $DI"
echo "  $((n - pre_bad)) of $n files: exactly one '$OLD_URLS' and '$URL1', no other 10.0.0.16"

if [ "$MODE" = dry ]; then
  say "DRY RUN: would back up $n files as *.bak-drop16-<stamp>, set '$NEW_URLS' (one line each), restart $n bots ${STAGGER} s apart, verify"
  [ -z "$DRY_REFUSE" ] && echo "DRY RUN OK: --apply would proceed now" || echo "DRY RUN: --apply would REFUSE now (see WOULD REFUSE lines)"
  exit 0
fi

say "3. back up, edit, check each file changed in exactly one line"
KEEP_HOLD=1
for f in $files; do
  sudo -n cp -p "$f" "$f.bak-drop16-$STAMP" && cmp -s "$f" "$f.bak-drop16-$STAMP" || { KEEP_HOLD=""; die "backup of $f failed -- no env file edited yet; the hold is released"; }
done
echo "  backups: $E/*.env.bak-drop16-$STAMP"
for f in $files; do
  sudo -n sed -i "s#^$OLD_URLS\$#$NEW_URLS#" "$f"
  d=$(diff "$f.bak-drop16-$STAMP" "$f" | grep -c '^[<>]')
  if [ "$d" != 2 ] || ! grep -qx "$NEW_URLS" "$f" || grep -q '10\.0\.0\.16' "$f" || ! grep -qx "$URL1" "$f"; then
    echo "EDIT CHECK FAILED on $f (diff lines $d) -- restoring every file"
    rbad=0
    for g in $files; do
      [ -f "$g.bak-drop16-$STAMP" ] || continue
      sudo -n cp -p "$g.bak-drop16-$STAMP" "$g" && cmp -s "$g.bak-drop16-$STAMP" "$g" || rbad=$((rbad+1))
    done
    [ "$rbad" = 0 ] && KEEP_HOLD=""      # every file byte-equal to its backup and nothing restarted: safe to release
    die "nothing restarted; restore of $n files from *.bak-drop16-$STAMP: $rbad failure(s)"
  fi
done
echo "  $n files now read '$NEW_URLS'; each differs from its backup in that one line"
T_START=$(date -u +%FT%TZ)
restart_all; rfail=$?
[ "$rfail" = 0 ] || echo "  !! $rfail restart(s) failed -- verify will name them"
# THE WINDOW STARTS AFTER THE LAST RESTART (Claude r1 P3): rows from bots not yet restarted would otherwise count, and
# the last bot must get time to decide.
T0=$(date -u +%FT%TZ)
say "4. wait 180 s after the last restart, then verify"
sleep "$WAIT"
verify "$T0"; vrc=$?
[ "$rfail" = 0 ] && [ "$vrc" = 0 ] && KEEP_HOLD=""
grep -q . "$H/digest/gate-installs.log" 2>/dev/null && echo "$(date -u +%FT%TZ) drop16 (learning loop M2b) applied: 10.0.0.16 removed from OLLAMA_BASE_URLS in $n env files; backups *.bak-drop16-$STAMP; verify rc $vrc" >> "$H/digest/gate-installs.log"
echo "DONE $STAMP (restarts $T_START..$T0, verify rc $vrc). Rollback: bash $0 --rollback $STAMP"
[ "$vrc" = 0 ] && [ "$rfail" = 0 ] || { echo "NOT VERIFIED: the install-hold is kept until you fix or roll back"; exit 4; }
echo "NEXT: bash $0 --verify $T0 at +60 min and again at +24 h (exclusion (i)); training on .16 only after the +24 h verify is OK."
exit $vrc
