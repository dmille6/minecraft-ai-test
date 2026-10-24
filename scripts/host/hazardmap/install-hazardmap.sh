#!/bin/bash
# install-hazardmap.sh -- the per-seed hazard map's daily refresh (OWNER 2026-10-24: host data first). THE OPERATOR RUNS THIS,
# as mike, from a checkout of the branch on each host, in this order. Nothing here touches a bot, a world, the queue, the
# scheduler, the manifest or an env file. Neither host can ssh to the other, so the public key is carried by hand, exactly as
# install-structcount-key.sh does.
#
#   1. on 10.0.0.31:  bash scripts/host/hazardmap/install-hazardmap.sh --on-31
#        copies the tool + lib/estelemetry into ~/hazardmap/app, runs its test suite, creates ~/.ssh/id_hazardmap (ed25519,
#        used ONLY by the refresh) and prints the ONE line to add on 10.0.0.30 (also saved to ~/hazardmap/key.line)
#   2. on 10.0.0.30:  bash scripts/host/hazardmap/install-hazardmap.sh --on-30 '<that line>' [--install-cron]
#        copies hazardmap.py + serve.py into ~/hazardmap/bin, runs the suite, appends the line to ~/.ssh/authorized_keys
#        (backed up first; idempotent), runs ONE verify now (seeds + terrain control; it refuses unless today's backup logged
#        `good`), and with --install-cron adds:  30 4 * * *  verify  (after the 03:15Z backup)
#        The line is  restrict,from="10.0.0.31",command="/usr/bin/python3 -I -B /home/mike/hazardmap/bin/serve.py" ssh-ed25519 ...
#        `restrict` = no pty / forwarding / agent / X11 / user rc; serve.py answers verify | status | request, nothing else,
#        never runs sudo, and writes only ~/hazardmap/in/request.json after validating it.
#   3. on 10.0.0.31:  bash scripts/host/hazardmap/install-hazardmap.sh --verify [--install-cron]
#        pulls once (positive control), proves forbidden requests and port forwarding are refused, runs ONE refresh (the
#        first backfills the ES day cache from 2026-08-22: ~6 min at nice 19), and with --install-cron adds:
#        10 5 * * *  refresh  (the test gate, pull verify, fetch, build, push the next request), and patches the INSTALLED
#        fleetstatus (backed up) with the map's `check` line: OK, or HAZARDMAP ALARM naming why
#
# Rollback: remove the cron lines ending '# hazardmap' (and their comment line), the authorized_keys line on .30 (a .bak is
# beside it), take the header line out with
#   python3 -B ~/hazardmap/app/scripts/host/hazardmap/patch_fleetstatus.py ~/estel/scripts/host/fleetstatus.py --revert
# (the exact inverse of the three edits: a later structcount patch is kept), and remove ~/hazardmap on both hosts. No bot reads the map yet (lavasight-01 is mineshaft F5b). Both hosts run cron in UTC (date +%z = +0000, 10-24).
set -u
MODE=${1:-}
SRC=$(cd "$(dirname "$0")" && pwd)
REPO_SCRIPTS=$(cd "$SRC/../.." && pwd)
H=$HOME/hazardmap
KEY=$HOME/.ssh/id_hazardmap
MARK='# hazardmap (per-seed hazard map, OWNER 2026-10-24)'
fail() { echo "!! STOPPED: $*"; exit 1; }
put() { cp -p "$1" "$2.new.$$" && mv -f "$2.new.$$" "$2" || fail "copy $1"; }
case "$MODE" in
--on-31)
  [ "$(hostname)" = block2-bots ] || fail "run --on-31 on 10.0.0.31 (block2-bots), not $(hostname)"
  [ "$(id -u)" != 0 ] || fail "run as mike, not root"
  A=$H/app/scripts
  mkdir -p "$A/host/hazardmap" "$A/lib" "$H/in" "$H/out" "$H/cache" "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  for f in hazardmap.py test_hazardmap.py serve.py patch_fleetstatus.py; do put "$SRC/$f" "$A/host/hazardmap/$f"; done
  for f in estelemetry.py telemetry.py; do put "$REPO_SCRIPTS/lib/$f" "$A/lib/$f"; done
  python3 -B "$A/host/hazardmap/test_hazardmap.py" > "$H/selftest.out" 2>&1 || { tail -5 "$H/selftest.out"; fail "the test suite failed (see $H/selftest.out)"; }
  echo "== test suite: $(tail -1 "$H/selftest.out")"
  [ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C hazardmap -f "$KEY" || fail "ssh-keygen"
  LINE="restrict,from=\"10.0.0.31\",command=\"/usr/bin/python3 -I -B /home/mike/hazardmap/bin/serve.py\" $(cat "$KEY.pub")"
  echo "$LINE" > "$H/key.line"
  echo "== on 10.0.0.30 run (one line, quoted):"
  echo "bash scripts/host/hazardmap/install-hazardmap.sh --on-30 '$LINE' --install-cron"
  ;;
--on-30)
  [ "$(hostname)" = block2-worlds ] || fail "run --on-30 on 10.0.0.30 (block2-worlds), not $(hostname)"
  [ "$(id -u)" != 0 ] || fail "run as mike, not root"
  LINE=${2:-}
  case "$LINE" in *$'\n'*|*$'\r'*) fail "the line contains a newline";; esac
  echo "$LINE" | grep -Eq '^restrict,from="10\.0\.0\.31",command="/usr/bin/python3 -I -B /home/mike/hazardmap/bin/serve\.py" ssh-ed25519 [A-Za-z0-9+/]+={0,2} hazardmap$' \
    || fail "that is not the line --on-31 printed (refusing anything else)"
  mkdir -p "$H/bin" "$H/in" "$H/out" "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  for f in hazardmap.py serve.py test_hazardmap.py patch_fleetstatus.py; do put "$SRC/$f" "$H/bin/$f"; done
  python3 -B "$H/bin/test_hazardmap.py" > "$H/selftest.out" 2>&1 || { tail -5 "$H/selftest.out"; fail "the test suite failed (see $H/selftest.out)"; }
  echo "== test suite: $(tail -1 "$H/selftest.out")"
  touch "$HOME/.ssh/authorized_keys"
  K=$(echo "$LINE" | awk '{print $(NF-1)}')
  if grep -qxF "$LINE" "$HOME/.ssh/authorized_keys"; then
    echo "== key line already present"
  else
    grep -qF "$K" "$HOME/.ssh/authorized_keys" && fail "this key is already in authorized_keys on a DIFFERENT line; remove that line by hand first"
    cp -p "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys.bak-hazardmap-$(date -u +%Y%m%dT%H%M%SZ)"
    echo "$LINE" >> "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys" || fail "append"
    echo "== key line added"
  fi
  ( cd "$H" && nice -n 19 ionice -c3 python3 -B bin/hazardmap.py verify --request in/request.json --out out ) \
    || echo "!! the first verify did not run (today's backup not logged good yet?): the 04:30Z cron will make it"
  if [ "${3:-}" = --install-cron ]; then
    crontab -l > "$H/crontab.bak-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
    if ! crontab -l 2>/dev/null | grep -qF "$MARK"; then
      { crontab -l 2>/dev/null; echo "$MARK -- verify against the staged backup"
        echo "30 4 * * * cd $H && /usr/bin/flock -n $H/.lock /usr/bin/nice -n 19 /usr/bin/ionice -c3 /usr/bin/python3 -B bin/hazardmap.py verify --request in/request.json --out out >> out/verify.log 2>&1 # hazardmap"; } | crontab - || fail "crontab"
    fi
    crontab -l | grep -A1 -F "$MARK"
  fi
  echo "== now on 10.0.0.31: bash scripts/host/hazardmap/install-hazardmap.sh --verify --install-cron"
  ;;
--verify)
  [ "$(hostname)" = block2-bots ] || fail "run --verify on 10.0.0.31"
  [ -f "$KEY" ] || fail "no $KEY: run --on-31 first"
  S="ssh -i $KEY -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new mike@10.0.0.30"
  # positive control first: the allowed requests answer, so a refusal below is the forced command, not a dead channel
  $S status | python3 -c 'import json,sys; json.load(sys.stdin)' || fail "the allowed request 'status' did not return JSON"
  $S verify | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["schema"]=="mcai.hazardmap.verify"; print("== verify file: backup", d["backup_day"], len(d["worlds"]), "worlds")' \
    || fail "the allowed request 'verify' did not return a verify file (did --on-30's first verify run?)"
  for BAD in 'cat /etc/passwd' 'verify; id' 'verify x' 'request ../../.ssh/authorized_keys' 'status x' ''; do
    $S "$BAD" < /dev/null > "$H/verify.probe" 2>/dev/null; RC=$?; OUTB=$(wc -c < "$H/verify.probe")
    [ "$RC" = 2 ] && [ "$OUTB" -eq 0 ] || fail "forbidden request [$BAD] was not refused (exit $RC, $OUTB bytes): check the authorized_keys line"
  done
  echo '{"schema":"x"}' | $S request > "$H/verify.probe" 2>/dev/null; RC=$?
  [ "$RC" = 2 ] && [ ! -s "$H/verify.probe" ] || fail "an invalid request document was not refused (exit $RC)"
  echo "== 7 forbidden requests refused (exit 2, no bytes)"
  $S -N -o ExitOnForwardFailure=yes -R 0:127.0.0.1:22 > /dev/null 2> "$H/verify.fwd" & FP=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$FP" 2>/dev/null || break; sleep 1; done
  if kill -0 "$FP" 2>/dev/null; then kill "$FP"; fail "remote port forwarding was ALLOWED: is 'restrict' on the line?"; fi
  grep -q 'remote port forwarding failed' "$H/verify.fwd" || fail "the forwarding probe exited for another reason: $(head -2 "$H/verify.fwd")"
  echo "== port forwarding refused by the server"
  ( cd "$H" && nice -n 19 python3 -B app/scripts/host/hazardmap/hazardmap.py refresh --home "$H" > "$H/first-refresh.out" 2>&1 ) \
    || { tail -20 "$H/first-refresh.out"; fail "the first refresh failed (see $H/first-refresh.out)"; }
  grep -E '^VALUE|^SEED|request pushed|FAILED' "$H/first-refresh.out" | cut -c1-200
  if [ "${2:-}" = --install-cron ]; then
    crontab -l > "$H/crontab.bak-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
    if ! crontab -l 2>/dev/null | grep -qF "$MARK"; then
      { crontab -l 2>/dev/null; echo "$MARK -- refresh: gate, pull verify, fetch ES, build, push request"
        echo "10 5 * * * cd $H && /usr/bin/flock -n $H/.lock /usr/bin/nice -n 19 /usr/bin/python3 -B app/scripts/host/hazardmap/hazardmap.py refresh --home $H >> $H/refresh.log 2>&1 # hazardmap"; } | crontab - || fail "crontab"
    fi
    crontab -l | grep -A1 -F "$MARK"
    # the alarm must surface where it is read (memory: an alarm log nobody reads): the fleetstatus header gets the check line
    python3 -B "$H/app/scripts/host/hazardmap/patch_fleetstatus.py" "$HOME/estel/scripts/host/fleetstatus.py" || fail "fleetstatus patch refused"
    echo "== header line now: $(python3 -B "$H/app/scripts/host/hazardmap/hazardmap.py" check --home "$H")"
  fi
  echo "== the map: $H/out/hazardmap.json (stale_after inside); report: $H/out/report-<day>.txt; heartbeat: $H/out/heartbeat.json"
  ;;
*) echo "usage: $0 --on-31 | --on-30 '<line>' [--install-cron] | --verify [--install-cron]"; exit 2;;
esac
