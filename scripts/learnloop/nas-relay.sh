#!/usr/bin/env bash
# nas-relay.sh -- ON 10.0.0.30 (block2-worlds) as ~/bin/learnloop-relay.sh: the FORCED COMMAND of one restricted key
# from the bots host (10.0.0.31), so the learning loop's nightly archive reaches the NAS the way every other backup
# does -- through .30's EXISTING NAS key (~/.ssh/id_esbackup) -- with NO new key on the NAS and no NAS access on .31.
# The showcase backup set the precedent (scripts/host/showcase-pull.sh: "No new key on the NAS").
#
# authorized_keys line on .30 (installed by scripts/learnloop/install-m1.sh):
#   restrict,from="10.0.0.31",command="/home/mike/bin/learnloop-relay.sh" ssh-ed25519 AAAA... learnloop-relay-from-31
#
# VERBS (SSH_ORIGINAL_COMMAND; everything else is refused):
#   put <day> <name> <sha256>   stdin -> a local temp file (<= MAX_BYTES), hashed; must equal <sha256>; streamed to
#                               the NAS as <day>/.<name>.part; the NAS hashes what it STORED (read-back); equal ->
#                               renamed to <day>/<name>; prints "OK <sha256> <bytes>". An existing <name> with the same
#                               sha is "OK ... (already)"; with a different sha it is REPLACED while the day is unsealed
#                               (a run that failed before `seal`) and REFUSED once the day is sealed (immutable).
#   seal <day>                  <day>/MANIFEST.json must exist and every file it lists must be on the NAS with its
#                               sha256 (the NAS hashes them); then <day>/_OK and <base>/.last-good are written.
#   verify <day>                read-only: the day is sealed (_OK) AND every file its MANIFEST.json lists is on the NAS
#                               with that sha256 -> "OK verified <day> <n>". nightly.py asks this BEFORE re-processing a
#                               day it has no local record of (a seal whose acknowledgement was lost, a lost state.json),
#                               and after any refusal, so a sealed day is recorded from the NAS, never re-sent.
#   manifest <day>              read-only: the day's MANIFEST.json as stored.
#   members <day> <tar>         read-only: "<sha256>  <member path>" for every file in <day>/<tar> (raw-*.tar or
#                               repair-raw-*.tar), hashed HERE from the bytes the NAS returns -- the proof nightly.py
#                               uses before it prunes a held raw file (independent of tar headers and live copies).
#   status                      "LASTGOOD <stamp> <day>" (or NONE), "SEALED <n> <newest>", "UNSEALED <days...>".
#   list <day>                  "<name> <bytes>" per file in <day>.
# A sealed day accepts only NEW names that start with "repair-" (nightly.py --repair-raw: held raw files a failed raw
# control left out); every existing name on a sealed day is immutable.
# Day = YYYY-MM-DD; name = [A-Za-z0-9][A-Za-z0-9._-]*, no "..", <= 100 chars. Nothing is ever deleted on the NAS.
# The NAS (Synology) refuses rsync over ssh for this account, so bytes go with `cat` (world-backup.sh does the same).
set -uo pipefail
NAS=${LL_NAS:-mike@10.0.0.5}
KEY=${LL_NAS_KEY:-$HOME/.ssh/id_esbackup}
BASE=${LL_NAS_BASE:-/volume1/homes/mike/learnloop}
DAYS=$BASE/daily
MAX_BYTES=${LL_MAX_BYTES:-4294967296}
TMPD=${LL_TMP:-$HOME/learnloop-relay/tmp}
LOG=${LL_LOG:-$HOME/learnloop-relay/relay.log}
SSHN=${LL_SSH:-ssh}
mkdir -p "$TMPD" "$(dirname "$LOG")"
# STDIN: ssh forwards its stdin to the remote side whether or not the command reads it, so EVERY NAS call except the
# one upload reads /dev/null -- otherwise the first `mkdir` swallows the start of the file being relayed.
nas() { $SSHN -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=30 "$NAS" "$@" < /dev/null; }
nas_upload() { $SSHN -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=30 "$NAS" "$@"; }
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
out() { echo "$*"; log "$*"; }
fail() { out "FAIL $*"; exit 1; }
day_ok() { [[ "$1" =~ ^20[0-9]{2}-[01][0-9]-[0-3][0-9]$ ]]; }
name_ok() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] && [[ "$1" != *..* ]]; }
sha_ok() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }

CMD=${SSH_ORIGINAL_COMMAND:-}
[[ "$CMD" =~ ^[A-Za-z0-9\ ._-]*$ ]] || { out "REFUSED: characters outside [A-Za-z0-9 ._-]"; exit 2; }
read -r -a A <<< "$CMD"
verb=${A[0]:-}
exec 9>"${LL_LOCKFILE:-/tmp/learnloop-relay.lock}"
flock -w 900 9 || { out "REFUSED: another relay call holds the lock"; exit 3; }

case "$verb" in
  put)
    [ "${#A[@]}" -eq 4 ] || { out "REFUSED: usage put <day> <name> <sha256>"; exit 2; }
    day=${A[1]}; name=${A[2]}; want=${A[3]}
    day_ok "$day" && name_ok "$name" && sha_ok "$want" || { out "REFUSED: bad day/name/sha"; exit 2; }
    dir=$DAYS/$day
    nas "mkdir -p '$dir'" || fail "$day/$name: NAS unreachable"
    have=$(nas "[ -f '$dir/$name' ] && sha256sum '$dir/$name' | cut -d' ' -f1 || echo NONE") || fail "$day/$name: NAS unreachable"
    if [ "$have" != NONE ]; then
      [ "$have" = "$want" ] && { out "OK $want $(nas "stat -c %s '$dir/$name'") (already)"; exit 0; }
      # A SEALED day is immutable. An unsealed one is staging (a run that failed before `seal`) and may be re-sent.
      if [ "$(nas "[ -e '$dir/_OK' ] && echo SEALED || echo OPEN")" != OPEN ]; then
        out "REFUSED: $day is sealed and $name exists with sha $have, not $want -- a sealed day is immutable"; exit 4
      fi
      log "replacing $day/$name in the UNSEALED day ($have -> $want)"
    elif [ "$(nas "[ -e '$dir/_OK' ] && echo SEALED || echo OPEN")" != OPEN ] && [[ "$name" != repair-* ]]; then
      out "REFUSED: $day is sealed; only a new repair-* file may be added"; exit 4
    fi
    tmp=$(mktemp "$TMPD/put.XXXXXX"); trap 'rm -f "$tmp"' EXIT
    head -c "$((MAX_BYTES + 1))" > "$tmp"
    bytes=$(stat -c %s "$tmp")
    [ "$bytes" -le "$MAX_BYTES" ] || fail "$day/$name: larger than $MAX_BYTES bytes"
    got=$(sha256sum < "$tmp" | cut -d' ' -f1)
    [ "$got" = "$want" ] || fail "$day/$name: received sha $got, declared $want ($bytes bytes)"
    nas_upload "cat > '$dir/.$name.part'" < "$tmp" || fail "$day/$name: stream to the NAS failed (.part left for inspection)"
    stored=$(nas "sha256sum '$dir/.$name.part' | cut -d' ' -f1; stat -c %s '$dir/.$name.part'") || fail "$day/$name: read-back failed"
    s_sha=$(echo "$stored" | sed -n 1p); s_bytes=$(echo "$stored" | sed -n 2p)
    [ "$s_sha" = "$want" ] && [ "$s_bytes" = "$bytes" ] || fail "$day/$name: NAS stored sha $s_sha / $s_bytes bytes, sent $want / $bytes"
    nas "mv -f '$dir/.$name.part' '$dir/$name'" || fail "$day/$name: rename failed"
    out "OK $want $bytes"
    ;;
  seal|verify)
    [ "${#A[@]}" -eq 2 ] && day_ok "${A[1]}" || { out "REFUSED: usage $verb <day>"; exit 2; }
    day=${A[1]}; dir=$DAYS/$day
    man=$(mktemp "$TMPD/man.XXXXXX"); trap 'rm -f "$man"' EXIT
    nas "cat '$dir/MANIFEST.json'" > "$man" 2>/dev/null || fail "$day: no MANIFEST.json on the NAS"
    want=$(python3 -c '
import json, re, sys
m = json.load(open(sys.argv[1]))
for n, f in sorted(m["files"].items()):
    assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", n) and ".." not in n and re.fullmatch(r"[0-9a-f]{64}", f["sha256"]), n
    print(f["sha256"] + "  " + n)' "$man") || fail "$day: MANIFEST.json unreadable or lists a bad name"
    [ -n "$want" ] || fail "$day: MANIFEST.json lists no files"
    got=$(nas "cd '$dir' && sha256sum $(echo "$want" | awk '{print $2}' | tr '\n' ' ')" 2>/dev/null) || fail "$day: a listed file is missing on the NAS"
    [ "$(echo "$want" | sort)" = "$(echo "$got" | sort)" ] || fail "$day: NAS hashes differ from MANIFEST.json"
    n=$(echo "$want" | wc -l)
    if [ "$verb" = verify ]; then
      [ "$(nas "[ -e '$dir/_OK' ] && echo SEALED || echo OPEN")" = SEALED ] || fail "$day: every file is there but the day is NOT sealed"
      out "OK verified $day $n files"; exit 0
    fi
    stamp=$(date -u +%FT%TZ)
    nas "echo '$stamp $n files' > '$dir/_OK' && echo '$stamp $day' > '$BASE/.last-good'" || fail "$day: could not write _OK"
    out "OK sealed $day $n files"
    ;;
  manifest)
    [ "${#A[@]}" -eq 2 ] && day_ok "${A[1]}" || { out "REFUSED: usage manifest <day>"; exit 2; }
    nas "cat '$DAYS/${A[1]}/MANIFEST.json'" || fail "${A[1]}: no MANIFEST.json"
    ;;
  members)
    [ "${#A[@]}" -eq 3 ] && day_ok "${A[1]}" && name_ok "${A[2]}" && [[ "${A[2]}" =~ ^(repair-)?raw-.*\.tar$ ]] \
      || { out "REFUSED: usage members <day> <raw-*.tar|repair-raw-*.tar>"; exit 2; }
    set -o pipefail
    nas "cat '$DAYS/${A[1]}/${A[2]}'" | python3 -c '
import hashlib, sys, tarfile
t = tarfile.open(fileobj=sys.stdin.buffer, mode="r|")
n = 0
for m in t:
    if m.isfile():
        print(hashlib.sha256(t.extractfile(m).read()).hexdigest() + "  " + m.name); n += 1
sys.exit(0 if n else 3)' || fail "${A[1]}/${A[2]}: not readable as a tar on the NAS"
    ;;
  status)
    lg=$(nas "cat '$BASE/.last-good' 2>/dev/null || echo NONE") || fail "NAS unreachable"
    echo "LASTGOOD $lg"
    nas "cd '$DAYS' 2>/dev/null || { echo 'SEALED 0 NONE'; echo UNSEALED; exit 0; }; s=0; newest=NONE; un=''; for d in 20*; do [ -d \"\$d\" ] || continue; if [ -e \"\$d/_OK\" ]; then s=\$((s+1)); newest=\$d; else un=\"\$un \$d\"; fi; done; echo \"SEALED \$s \$newest\"; echo \"UNSEALED\$un\"" \
      || fail "NAS unreachable"
    ;;
  list)
    [ "${#A[@]}" -eq 2 ] && day_ok "${A[1]}" || { out "REFUSED: usage list <day>"; exit 2; }
    nas "cd '$DAYS/${A[1]}' 2>/dev/null && for f in *; do [ -f \"\$f\" ] && echo \"\$f \$(stat -c %s \"\$f\")\"; done; true" || fail "NAS unreachable"
    ;;
  *)
    out "REFUSED: unknown verb '${verb}'"; exit 2 ;;
esac
