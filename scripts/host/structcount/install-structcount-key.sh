#!/bin/bash
# install-structcount-key.sh -- owner Q8 (10-23): a dedicated, restricted, read-only key so 10.0.0.31 can fetch the newest
# structure count (and the newest chest census) from 10.0.0.30. THE OPERATOR RUNS THIS, in three steps, as mike, from a
# checkout of the branch on each host. Neither host can ssh to the other today, so the public key is carried by hand.
#
#   on 10.0.0.31:  bash scripts/host/structcount/install-structcount-key.sh --on-31
#                  -> creates ~/.ssh/id_structcount (ed25519, used ONLY by pull.py), installs pull.py + scread.py into
#                     ~/structcount/bin, and prints the ONE line to add on 10.0.0.30 (also saved to ~/structcount/key.line)
#   on 10.0.0.30:  bash scripts/host/structcount/install-structcount-key.sh --on-30 '<that line>'
#                  -> appends it to ~/.ssh/authorized_keys (backed up first; idempotent). The line is
#                     restrict,from="10.0.0.31",command="/usr/bin/python3 -I -B /home/mike/structcount/bin/serve.py" ssh-ed25519 ...
#                     `restrict` = no pty, no forwarding of any kind, no agent, no X11, no user rc; `command=` = whatever the
#                     client asks, sshd runs serve.py, which answers five fixed requests (serve.py's docstring) and nothing else.
#   on 10.0.0.31:  bash scripts/host/structcount/install-structcount-key.sh --verify
#                  -> pulls once, reads the mirror, proves a forbidden request is refused, then (with --install-cron) adds
#                     the hourly pull cron line and patches the installed fleetstatus (patch_fleetstatus.py, backed up) and
#                     goalboard (copied only if the installed copy is the pre-change main version).
set -u
MODE=${1:-}
SRC=$(cd "$(dirname "$0")" && pwd)
HOSTKEY=$HOME/.ssh/id_structcount
B=$HOME/structcount/bin
fail() { echo "!! STOPPED: $*"; exit 1; }
case "$MODE" in
--on-31)
  [ "$(hostname)" = block2-bots ] || fail "run --on-31 on 10.0.0.31 (block2-bots), not $(hostname)"
  mkdir -p "$B" "$HOME/structcount/in" "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  for f in pull.py scread.py; do cp -p "$SRC/$f" "$B/.$f.new" && mv -f "$B/.$f.new" "$B/$f" || fail "copy $f"; done
  [ -f "$HOSTKEY" ] || ssh-keygen -q -t ed25519 -N '' -C structcount-pull -f "$HOSTKEY" || fail "ssh-keygen"
  LINE="restrict,from=\"10.0.0.31\",command=\"/usr/bin/python3 -I -B /home/mike/structcount/bin/serve.py\" $(cat "$HOSTKEY.pub")"
  echo "$LINE" > "$HOME/structcount/key.line"
  echo "== on 10.0.0.30 run (one line, quoted):"
  echo "bash scripts/host/structcount/install-structcount-key.sh --on-30 '$LINE'"
  ;;
--on-30)
  [ "$(hostname)" = block2-worlds ] || fail "run --on-30 on 10.0.0.30 (block2-worlds), not $(hostname)"
  LINE=${2:-}
  case "$LINE" in *$'\n'*|*$'\r'*) fail "the line contains a newline (refusing: grep would check each line separately)";; esac
  echo "$LINE" | grep -Eq '^restrict,from="10\.0\.0\.31",command="/usr/bin/python3 -I -B /home/mike/structcount/bin/serve\.py" ssh-ed25519 [A-Za-z0-9+/]+={0,2} structcount-pull$' \
    || fail "that is not the line --on-31 printed (refusing anything else)"
  [ -f "$B/serve.py" ] || fail "serve.py is not installed in $B: run install-structcount.sh first"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"
  KEY=$(echo "$LINE" | awk '{print $(NF-1)}')
  if grep -qxF "$LINE" "$HOME/.ssh/authorized_keys"; then
    echo "== already present"; exit 0
  fi
  grep -qF "$KEY" "$HOME/.ssh/authorized_keys" && fail "this key is already in authorized_keys on a DIFFERENT line; remove that line by hand first"
  cp -p "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys.bak-structcount-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "$LINE" >> "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys" || fail "append"
  echo "== added. Now on 10.0.0.31: bash scripts/host/structcount/install-structcount-key.sh --verify [--install-cron]"
  ;;
--verify)
  [ "$(hostname)" = block2-bots ] || fail "run --verify on 10.0.0.31"
  python3 -B "$B/pull.py" || fail "the pull failed"
  echo "== mirror: $(python3 "$B/scread.py" "$HOME/structcount/in" "$HOME/structcount/in/attempts" --mirror)"
  S="ssh -i $HOSTKEY -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 mike@10.0.0.30"
  # positive control first: the same key and channel answer an allowed request, so a refusal below is the forced command
  $S manifest | python3 -c 'import json,sys; json.load(sys.stdin)' || fail "the allowed request 'manifest' did not return JSON"
  echo "== allowed request answered (manifest parses)"
  for BAD in 'cat /etc/passwd' 'manifest; id' 'day ../../.ssh/authorized_keys' 'census ../.bashrc' ''; do
    $S "$BAD" > "$HOME/structcount/verify.out" 2>/dev/null; RC=$?; OUTB=$(wc -c < "$HOME/structcount/verify.out")
    [ "$RC" = 2 ] && [ "$OUTB" -eq 0 ] || fail "forbidden request [$BAD] was not refused (exit $RC, $OUTB bytes): check the authorized_keys line"
  done
  echo "== 5 forbidden requests refused (exit 2, no bytes)"
  # FORWARDING (Codex r1 P2, Claude r1 P2-1): a REMOTE forward is refused by the server at setup, so with
  # ExitOnForwardFailure the client exits at once and names it; allowed, the client stays up. (A local -L is only refused
  # when a channel opens, and `-L 0:...` is a client-side syntax error: the r1 probe could not fail.) The allowed manifest
  # request above is the positive control that this key and channel reach the server.
  $S -N -o ExitOnForwardFailure=yes -R 0:127.0.0.1:22 > /dev/null 2> "$HOME/structcount/verify.fwd" & FP=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$FP" 2>/dev/null || break; sleep 1; done
  if kill -0 "$FP" 2>/dev/null; then kill "$FP"; fail "remote port forwarding was ALLOWED: is 'restrict' on the line?"; fi
  grep -q 'remote port forwarding failed' "$HOME/structcount/verify.fwd" \
    || fail "the forwarding probe exited for another reason: $(head -2 "$HOME/structcount/verify.fwd")"
  echo "== port forwarding refused by the server (remote port forwarding failed)"
  if [ "${2:-}" = --install-cron ]; then
    MARK='# structcount mirror (owner Q8)'
    crontab -l > "$HOME/structcount/crontab.bak-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
    if ! crontab -l 2>/dev/null | grep -qF "$MARK"; then
      { crontab -l 2>/dev/null; echo "$MARK -- scripts/host/structcount/pull.py"; echo "20 * * * * /usr/bin/python3 -B $B/pull.py >> $HOME/structcount/pull.log 2>&1"; } | crontab - || fail "crontab"
    fi
    crontab -l | grep -A1 -F "$MARK"
    python3 -B "$SRC/patch_fleetstatus.py" "$HOME/estel/scripts/host/fleetstatus.py" "$SRC/../fleetstatus.py" || fail "fleetstatus patch refused"
    G=$HOME/goalboard/scripts/host/goalboard.py
    if [ "$(md5sum < "$G" | cut -c1-32)" = 10e2239e4ff5a16e4b1ec24410c29f6d ]; then
      cp -p "$G" "$G.bak-structcount-$(date -u +%Y%m%dT%H%M%SZ)" && cp "$SRC/../goalboard.py" "$G" && echo "== goalboard updated (BUILD: buildings_b5)"
    else
      echo "!! goalboard NOT updated: the installed copy is not the version this change was made on; patch it by hand"
    fi
    echo "== header line now: $(cd "$HOME/estel" && python3 -c 'import datetime as d,sys; sys.path.insert(0,"scripts/host"); sys.path.insert(0,"scripts"); import fleetstatus as f; print(f.structcount_line(d.datetime.now(d.timezone.utc)))')"
  fi
  ;;
*) echo "usage: $0 --on-31 | --on-30 '<line>' | --verify [--install-cron]"; exit 2;;
esac
