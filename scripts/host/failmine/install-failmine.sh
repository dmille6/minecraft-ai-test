#!/bin/bash
# install-failmine.sh -- the weekly failure-mining run (OWNER 2026-10-24; docs/reports/failmine-2026-10-24.md section 6).
# THE OPERATOR RUNS THIS; it is never run by an agent. As mike, from a checkout of the branch on each host, in order:
#
#   on 10.0.0.31:  bash scripts/host/failmine/install-failmine.sh --on-31
#                  -> copies failmine.py + its tests + a PINNED copy of scripts/lib (estelemetry, telemetry) and
#                     test_estelemetry.py into ~/failmine/bin, the scene library into ~/failmine/library, runs the whole
#                     test suite there (behaviour, blind input, every mutant), creates ~/.ssh/id_failmine (ed25519, used ONLY
#                     by failmine.py) and prints the ONE authorized_keys line for 10.0.0.30 (also in ~/failmine/key.line)
#   on 10.0.0.30:  bash scripts/host/failmine/install-failmine.sh --on-30 '<that line>'
#                  -> installs fmserve.py into ~/failmine/bin, proves it reads the staging (meta parses, 16 worlds), then
#                     appends the line to ~/.ssh/authorized_keys (backed up first; idempotent). The line is
#                     restrict,from="10.0.0.31",command="/usr/bin/python3 -I -B /home/mike/failmine/bin/fmserve.py" ssh-ed25519 ...
#                     `restrict` = no pty, no forwarding, no agent, no X11, no user rc; `command=` = sshd runs fmserve.py
#                     whatever the client asks; fmserve answers `meta` and `region <world> <rx> <rz>` from the nightly
#                     backup's STAGED COPY (read-only sudo cat) and nothing else.
#   on 10.0.0.31:  bash scripts/host/failmine/install-failmine.sh --verify
#                  -> an allowed request answers (positive control), five forbidden ones are refused with no bytes,
#                     port forwarding is refused by the server, one region file arrives whole
#   on 10.0.0.31:  bash scripts/host/failmine/install-failmine.sh --dry-run
#                  -> one full weekly run into ~/failmine-trial (never ~/failmine/out); prints the cluster table
#   on 10.0.0.31:  bash scripts/host/failmine/install-failmine.sh --install-cron
#                  -> the weekly cron line (crontab backed up first; idempotent): Sundays 06:40Z, after the 03:15Z backup
#                     logged `good` and structcount's 03:45-05:45Z window. Output: ~/failmine/out/<gen>/{table.txt,
#                     clusters.json, meta.json, scenes/*.json}; ~/failmine/out/LATEST names the newest generation.
#
# READ-ONLY on the fleet: ES with the read-only key, region files from the staged backup copy. Nothing here touches a
# queue, the scheduler, a manifest, an env file, a bot, a live world or a sandbox. The weekly run writes only ~/failmine.
set -u
MODE=${1:-}
SRC=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$SRC/../../.." && pwd)
D=$HOME/failmine; B=$D/bin
KEYF=$HOME/.ssh/id_failmine
fail() { echo "!! STOPPED: $*"; exit 1; }
say() { echo "== $*"; }
case "$MODE" in
--on-31)
  [ "$(hostname)" = block2-bots ] || fail "run --on-31 on 10.0.0.31 (block2-bots), not $(hostname)"
  [ -f "$HOME/.config/mcai/es-readonly.key" ] || fail "the ES read-only key is not at ~/.config/mcai/es-readonly.key"
  mkdir -p "$B/lib" "$D/library" "$D/out" "$HOME/.ssh" && chmod 700 "$HOME/.ssh" || fail "mkdir"
  for f in failmine.py test_failmine.py fmserve.py; do cp -p "$SRC/$f" "$B/.$f.new" && mv -f "$B/.$f.new" "$B/$f" || fail "copy $f"; done
  for f in estelemetry.py telemetry.py; do cp -p "$REPO/scripts/lib/$f" "$B/lib/.$f.new" && mv -f "$B/lib/.$f.new" "$B/lib/$f" || fail "copy lib/$f"; done
  touch "$B/lib/__init__.py"
  cp -p "$REPO/scripts/test_estelemetry.py" "$B/test_estelemetry.py" || fail "copy test_estelemetry.py"
  cp -p "$REPO"/sandbox/scenes/*.json "$D/library/" || fail "copy the scene library"
  say "copied into $B: $(cd "$B" && md5sum failmine.py fmserve.py lib/estelemetry.py | tr '\n' ' ')"
  say "the test suite (behaviour, blind input, mutants)"
  ( cd "$B" && python3 -B test_failmine.py > "$D/install-tests.out" 2>&1 ) || { tail -20 "$D/install-tests.out"; fail "tests failed ($D/install-tests.out)"; }
  tail -2 "$D/install-tests.out"
  [ -f "$KEYF" ] || ssh-keygen -q -t ed25519 -N '' -C failmine-pull -f "$KEYF" || fail "ssh-keygen"
  LINE="restrict,from=\"10.0.0.31\",command=\"/usr/bin/python3 -I -B /home/mike/failmine/bin/fmserve.py\" $(cat "$KEYF.pub")"
  echo "$LINE" > "$D/key.line"
  say "on 10.0.0.30 run (one line, quoted):"
  echo "bash scripts/host/failmine/install-failmine.sh --on-30 '$LINE'"
  ;;
--on-30)
  [ "$(hostname)" = block2-worlds ] || fail "run --on-30 on 10.0.0.30 (block2-worlds), not $(hostname)"
  LINE=${2:-}
  case "$LINE" in *$'\n'*|*$'\r'*) fail "the line contains a newline";; esac
  echo "$LINE" | grep -Eq '^restrict,from="10\.0\.0\.31",command="/usr/bin/python3 -I -B /home/mike/failmine/bin/fmserve\.py" ssh-ed25519 [A-Za-z0-9+/]+={0,2} failmine-pull$' \
    || fail "that is not the line --on-31 printed (refusing anything else)"
  sudo -n true 2>/dev/null || fail "sudo -n is needed to read the backup staging (read-only cat)"
  mkdir -p "$B" || fail "mkdir $B"
  cp -p "$SRC/fmserve.py" "$B/.fmserve.py.new" && mv -f "$B/.fmserve.py.new" "$B/fmserve.py" || fail "copy fmserve.py"
  # POSITIVE CONTROL before any key is trusted: the forced command really reads the staging
  N=$(SSH_ORIGINAL_COMMAND=meta /usr/bin/python3 -I -B "$B/fmserve.py" | python3 -c 'import json,sys; m=json.load(sys.stdin); print(len(m["worlds"]), m["backup_day"])') \
    || fail "fmserve.py meta did not answer (a backup running? retry after 03:20Z)"
  say "fmserve meta: $N"
  case "$N" in 16\ *) ;; *) fail "want 16 worlds in the staging, got: $N";; esac
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"
  KEY=$(echo "$LINE" | awk '{print $(NF-1)}')
  if grep -qxF "$LINE" "$HOME/.ssh/authorized_keys"; then say "already present"; exit 0; fi
  grep -qF "$KEY" "$HOME/.ssh/authorized_keys" && fail "this key is already in authorized_keys on a DIFFERENT line; remove that line by hand first"
  cp -p "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys.bak-failmine-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "$LINE" >> "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys" || fail "append"
  say "added. Now on 10.0.0.31: bash scripts/host/failmine/install-failmine.sh --verify"
  ;;
--verify)
  [ "$(hostname)" = block2-bots ] || fail "run --verify on 10.0.0.31"
  S="ssh -i $KEYF -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 mike@10.0.0.30"
  $S meta | python3 -c 'import json,sys; m=json.load(sys.stdin); assert len(m["worlds"]) == 16, m.keys(); print("== allowed request answered:", m["backup_day"], len(m["worlds"]), "worlds")' \
    || fail "the allowed request 'meta' did not return 16 worlds"
  for BAD in 'cat /etc/passwd' 'meta; id' 'region ../../etc 0 0' 'region board-a 0 0; id' ''; do
    $S "$BAD" > "$D/verify.out" 2>/dev/null; RC=$?; OUTB=$(wc -c < "$D/verify.out")
    [ "$RC" = 2 ] && [ "$OUTB" -eq 0 ] || fail "forbidden request [$BAD] was not refused (exit $RC, $OUTB bytes): check the authorized_keys line"
  done
  say "5 forbidden requests refused (exit 2, no bytes)"
  $S -N -o ExitOnForwardFailure=yes -R 0:127.0.0.1:22 > /dev/null 2> "$D/verify.fwd" & FP=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$FP" 2>/dev/null || break; sleep 1; done
  if kill -0 "$FP" 2>/dev/null; then kill "$FP"; fail "remote port forwarding was ALLOWED: is 'restrict' on the line?"; fi
  grep -q 'remote port forwarding failed' "$D/verify.fwd" || fail "the forwarding probe exited for another reason: $(head -2 "$D/verify.fwd")"
  say "port forwarding refused by the server"
  $S region board-a 0 0 > "$D/verify.mca" || fail "region board-a 0 0 was not served"
  SZ=$(wc -c < "$D/verify.mca"); [ "$SZ" -gt 1000000 ] || fail "region board-a 0 0 is only $SZ bytes"
  rm -f "$D/verify.mca"; say "a region file arrived whole ($SZ bytes). Next: --dry-run"
  ;;
--dry-run)
  [ "$(hostname)" = block2-bots ] || fail "run --dry-run on 10.0.0.31"
  T=$HOME/failmine-trial; rm -rf "$T"; mkdir -p "$T"
  ( cd "$B" && nice -n 19 python3 -B failmine.py weekly --home "$T" --library "$D/library" ) > "$T/run.out" 2>&1 || { tail -20 "$T/run.out"; fail "the trial run failed ($T/run.out)"; }
  cat "$T/run.out"; G=$(cat "$T/out/LATEST"); ls -la "$T/out/$G/scenes"
  for f in "$T/out/$G"/scenes/*.json; do [ -e "$f" ] || continue; python3 -B "$B/failmine.py" validate "$f" || fail "$f does not validate"; done
  say "DRY RUN OK ($T/out/$G). Next: --install-cron"
  ;;
--install-cron)
  [ "$(hostname)" = block2-bots ] || fail "run --install-cron on 10.0.0.31"
  [ -f "$HOME/failmine-trial/out/LATEST" ] || fail "run --dry-run first"
  MARK='# failmine weekly (owner 10-24)'
  crontab -l > "$D/crontab.bak-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
  if crontab -l 2>/dev/null | grep -qF "$MARK"; then
    say "already installed"
  else
    { crontab -l 2>/dev/null; echo "$MARK -- docs/reports/failmine-2026-10-24.md; newest: cat ~/failmine/out/\$(cat ~/failmine/out/LATEST)/table.txt"
      echo "40 6 * * 0 cd $B && /usr/bin/nice -n 19 /usr/bin/python3 -B failmine.py weekly --library $D/library >> $D/weekly.log 2>&1"; } | crontab - || fail "crontab"
  fi
  crontab -l | grep -A1 -F "$MARK"
  ;;
*) echo "usage: $0 --on-31 | --on-30 '<line>' | --verify | --dry-run | --install-cron"; exit 2;;
esac
