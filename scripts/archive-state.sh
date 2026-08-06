#!/usr/bin/env bash
# archive-state.sh -- snapshot the agents' accumulated experience into git.
#
# WHY GIT AND NOT A DATABASE. This data is 96K of already pretty-printed JSON.
# Committed as text it gives something a binary store cannot:
#
#     git log -p state-archive/lessons-Miner01.json
#
# a readable history of what the fleet came to believe and when -- which avoid
# rules formed, which counts decayed, when a judgement was cleared. For a
# project whose product is evidence about learning, that history is a finding,
# not merely a safety copy. A .duckdb file would store a fresh opaque blob every
# time and throw the diffs away. DuckDB is the right tool for the telemetry
# archive (millions of events, Parquet, analytical queries); it is the wrong
# tool for 96K of precious text.
#
# It also closes a real gap: there is no inter-host ssh and no NAS mounted
# anywhere, so until today the only copy of 285 accumulated judgements lived on
# the machine that generates them. GitHub is an off-box target that already
# exists.
#
# EXACT, NOT NORMALISED. The archived JSON is byte-faithful to what the agents
# read at startup, so it can actually be restored. Keys are sorted for stable
# diffs, but timestamps are NOT rounded -- the decay logic in lessons.mjs reads
# them in milliseconds, and a prettier diff is not worth an archive that
# restores to subtly wrong behaviour.
#
# To keep that from producing a commit every day with nothing but clock churn,
# the decision to commit is made on a SEMANTIC hash that ignores volatile
# fields. A commit appearing at all therefore means something was actually
# learned.
#
#   ./scripts/archive-state.sh            snapshot, commit and push if changed
#   ./scripts/archive-state.sh --dry-run  show what would change, touch nothing
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$REPO/state-archive"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
BOTS="${BOT_HOST:-10.0.0.187}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Pull live state. Tar rather than scp per-file so a file appearing or vanishing
# mid-copy cannot produce a half-set.
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 "mike@$BOTS" \
    'sudo tar -C /srv/mcbots -czf - state 2>/dev/null' > "$TMP/state.tar.gz" 2>/dev/null
[ -s "$TMP/state.tar.gz" ] || { echo "archive-state: could not read state from $BOTS" >&2; exit 1; }
tar -xzf "$TMP/state.tar.gz" -C "$TMP" || { echo "archive-state: archive unreadable" >&2; exit 1; }

mkdir -p "$DEST"
python3 - "$TMP/state" "$DEST" "$DRY" <<'PY'
import hashlib, json, os, sys

src, dest, dry = sys.argv[1], sys.argv[2], sys.argv[3] == '1'

# Fields that move on their own. Excluded from the CHANGE decision only -- they
# are still written to disk, because the archive has to be restorable.
VOLATILE = {'last', 'at', 'lastSeen', 'updated'}

def semantic(o):
    """The content with self-moving fields removed, for change detection."""
    if isinstance(o, dict):
        return {k: semantic(v) for k, v in sorted(o.items()) if k not in VOLATILE}
    if isinstance(o, list):
        return [semantic(x) for x in o]
    return o

changed, written, skipped = [], 0, 0
for name in sorted(os.listdir(src)):
    if not name.endswith('.json'):
        continue
    try:
        data = json.load(open(os.path.join(src, name)))
    except Exception as e:
        # A file caught mid-write is not a reason to archive corruption.
        print(f'   SKIP {name}: unreadable ({e})')
        skipped += 1
        continue

    out = os.path.join(dest, name)
    new_text = json.dumps(data, indent=1, sort_keys=True) + '\n'
    new_sem = hashlib.sha256(
        json.dumps(semantic(data), sort_keys=True).encode()).hexdigest()

    old_sem = None
    if os.path.exists(out):
        try:
            old_sem = hashlib.sha256(
                json.dumps(semantic(json.load(open(out))), sort_keys=True).encode()).hexdigest()
        except Exception:
            pass

    if old_sem != new_sem:
        changed.append(name)
    if not dry:
        open(out, 'w').write(new_text)
        written += 1

print(f'   {written} file(s) written, {skipped} skipped, {len(changed)} semantically changed')
if changed:
    print('   changed: ' + ', '.join(changed))
# Exit 10 == nothing meaningful changed, so the caller can skip the commit.
sys.exit(0 if changed else 10)
PY
RC=$?

if [ "$DRY" -eq 1 ]; then
  echo "archive-state: dry run, nothing written"
  exit 0
fi

if [ "$RC" -eq 10 ]; then
  # Discard clock-only churn rather than committing it.
  git -C "$REPO" checkout -- state-archive 2>/dev/null || true
  echo "archive-state: no semantic change, nothing committed"
  exit 0
fi
[ "$RC" -ne 0 ] && { echo "archive-state: export failed rc=$RC" >&2; exit 1; }

cd "$REPO"
git add state-archive
if git diff --cached --quiet; then
  echo "archive-state: no file changes staged"
  exit 0
fi
git commit -q -m "chore(state): agent experience snapshot $(date -u +%Y-%m-%d)

Automated. What the fleet believed at this point, byte-faithful so it restores.
Committed only because the semantic content changed -- timestamp churn alone
does not produce a commit."
git push -q origin HEAD && echo "archive-state: committed and pushed"
