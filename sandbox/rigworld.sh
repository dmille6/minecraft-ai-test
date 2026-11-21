#!/usr/bin/env bash
# THE way to stop, swap, snap or restore a sandbox world (rigguard, 2026-11-21). Run it from the controller or a ci host,
# never on the worlds host: the locks live on 10.0.0.31 and the worlds host cannot reach them.
#
#   sandbox/rigworld.sh <server> <tag> load <src world dir on the worlds host>   stop, keep the world as world.pre-<tag>-<ts>, copy src in, start
#   sandbox/rigworld.sh <server> <tag> snap <out dir on the worlds host> [region files...]   save-all, copy region files out
#   sandbox/rigworld.sh <server> <tag> restore                                   stop, put the newest world.pre-<tag>-* back, start
#
# Every action first runs `sbxlock.sh assert <server> <tag>`, which exits 0 ONLY when <tag> holds that sandbox's lock.
# Anything else refuses before the worlds host is touched. A failed `take` piped into `tail` can no longer lead to
# another agent's server being stopped (11-21 01:56Z, sandbox3: that is exactly what happened with the per-piece
# copies of this recipe, which checked nothing). New rigs call this script instead of copying a recipe.
#
# RIGWORLD_DRYRUN=1 prints the remote script instead of running it (the tests use it with SBXLOCK_LOCAL + LOCK_ROOT).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMES="sandbox sandbox2 sandbox3 sandbox4 sandbox5 sandbox6 sandbox7 sandbox8"   # == sandbox/sandboxes.json (tested)
S="${1:-}"; TAG="${2:-}"; ACT="${3:-}"; shift 3 2>/dev/null || true
[[ " $NAMES " == *" $S "* ]] || { echo "rigworld: unknown server '$S' (one of: $NAMES)" >&2; exit 2; }
[[ -n "$TAG" ]] || { echo "rigworld: no tag" >&2; exit 2; }
[[ "$TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._]*(-[A-Za-z0-9._]+)*$ ]] || { echo "rigworld: bad tag '$TAG'" >&2; exit 2; }
case "$ACT" in load|snap|restore) ;; *) echo "usage: rigworld.sh <server> <tag> load <src> | snap <out> [files] | restore" >&2; exit 2 ;; esac

# The guard. Its exit code is checked directly (no pipe), and set -e alone would also stop here.
if ! out="$(bash "$HERE/sbxlock.sh" assert "$S" "$TAG" 2>&1)"; then
  echo "rigworld: REFUSED, nothing touched: $out" >&2; exit 1
fi
echo "rigworld: $out"

q() { printf '%q ' "$@"; }
REMOTE="set -euo pipefail
S=/srv/block2/$S; U=block2-$S; SV=$S
R() { python3 /home/mike/t11rcon.py \"\$SV\" \"\$@\"; }
up() { for i in \$(seq 1 90); do if R list >/dev/null 2>&1; then return 0; fi; sleep 2; done; echo \"\$SV RCON not up\" >&2; return 1; }
"
case "$ACT" in
  load)
    SRC="${1:?src world dir}"
    REMOTE+="src=$(q "$SRC")
[[ -d \"\$src\" ]] || { echo \"no \$src\" >&2; exit 2; }
sudo systemctl stop \$U
ts=\$(date -u +%Y%m%dT%H%MZ)
sudo mv \"\$S/world\" \"\$S/world.pre-$TAG-\$ts\"
sudo cp -a \"\$src\" \"\$S/world\"; sudo chown -R sandbox:sandbox \"\$S/world\"
sudo systemctl start \$U; up; echo \"loaded copy of \$src; previous world at world.pre-$TAG-\$ts\"
" ;;
  snap)
    OUT="${1:?out dir}"; shift
    FILES=("$@"); [[ ${#FILES[@]} -gt 0 ]] || FILES=(r.-1.-1.mca r.0.-1.mca r.-1.0.mca r.0.0.mca)
    REMOTE+="out=$(q "$OUT")
R 'save-all flush' >/dev/null; sleep 5; mkdir -p \"\$out\"
for f in $(q "${FILES[@]}"); do sudo cat \"\$S/world/region/\$f\" > \"\$out/\$f\"; done; ls -la \"\$out\"
" ;;
  restore)
    REMOTE+="pre=\$(ls -d \"\$S\"/world.pre-$TAG-* 2>/dev/null | tail -1); [[ -n \"\$pre\" && -d \"\$pre\" ]] || { echo \"no world.pre-$TAG-*\" >&2; exit 2; }
sudo systemctl stop \$U
sudo mv \"\$S/world\" \"\$S/world.$TAG-\$(date -u +%Y%m%dT%H%MZ)\"
sudo mv \"\$pre\" \"\$S/world\"
sudo systemctl start \$U; up; echo \"restored \$pre\"
" ;;
esac
if [[ -n "${RIGWORLD_DRYRUN:-}" ]]; then printf 'WOULD RUN on %s:\n%s' "${RIGWORLD_HOST:-mike@10.0.0.30}" "$REMOTE"; exit 0; fi
exec ssh -o BatchMode=yes "${RIGWORLD_HOST:-mike@10.0.0.30}" bash -s <<<"$REMOTE"
