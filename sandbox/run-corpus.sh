#!/usr/bin/env bash
# run-corpus.sh <candidate-root> [control-root] -- the trap corpus, control vs candidate, four sandbox servers in parallel.
# Each line of sandbox/corpus.tsv: <fixture path>\t<env>\t<script>\t<minutes>\t<label>. Every fixture runs on BOTH roots
# (control first on sandbox/sandbox2, candidate on sandbox3/sandbox4 -- two at a time per root). Scores per run: died,
# loader-escaped, rose>=4 dry, moved>=8, pickaxes lost (inventory before vs after). Appends to sandbox/corpus-results.tsv
# and prints a table. A change is fleet-eligible only when its candidate column is at least as good as control on every
# fixture and better on the ones it targets (the replay gate, reliability program step 1).
set -u; CAND="${1:?candidate root}"; CTRL="${2:-$HOME/Documents/mcai-base}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="$ROOT/sandbox/corpus.tsv"; OUT="$ROOT/sandbox/corpus-results.tsv"; RUN=$(date -u +%Y%m%dT%H%M)
score() {  # score <bot> <from-iso> <to-iso> <label> <arm> <root> <verdict-json>
  python3 - "$@" <<'PY'
import sys, json, glob
bot, a, b, label, arm, root, verdict = sys.argv[1:8]
died = 0; rows = []; first = None; last = None; inv0 = None; inv1 = None; maxrise = 0; maxmove = 0
for f in glob.glob(f'sandbox/log/{bot}/skill-*.jsonl'):
    for l in open(f, errors='replace'):
        try: r = json.loads(l)
        except Exception: continue
        t = r.get('@timestamp', '')
        if not (a <= t < b): continue
        sk = r.get('skill') or {}; n = sk.get('name') or ''
        if n == '_death': died += 1
        p = (r.get('bot') or {}).get('pos') or {}; inv = (r.get('bot') or {}).get('inventory')
        if p.get('x') is not None:
            if first is None: first = p
            wet = (r.get('bot') or {}).get('wet')
            if not wet: maxrise = max(maxrise, p['y'] - first['y'])
            maxmove = max(maxmove, ((p['x'] - first['x']) ** 2 + (p['z'] - first['z']) ** 2) ** 0.5)
        if isinstance(inv, dict):
            if inv0 is None: inv0 = inv
            inv1 = inv
picks = lambda inv: sum(v for k, v in (inv or {}).items() if k.endswith('_pickaxe'))
lost = max(0, picks(inv0) - picks(inv1))
try: esc = json.loads(verdict).get('escaped')
except Exception: esc = None
print('\t'.join(str(x) for x in [label, arm, root.split('/')[-1], 'DIED' if died else 'alive', 'escaped' if esc else 'not', f'rise{maxrise:.0f}', f'move{maxmove:.0f}', f'picks_lost{lost}']))
PY
}
one() {  # one <server> <root> <arm> <fixture> <env> <script> <minutes> <label>
  local SERVER=$1 ROOTB=$2 ARM=$3 FX=$4 ENV=$5 SCRIPT=$6 MIN=$7 LABEL=$8
  local T0=$(date -u +%FT%TZ); local BOT=$(grep '^BOT_NAME=' "$ROOT/$ENV" | cut -d= -f2); [[ "$SERVER" != sandbox ]] && BOT="$BOT-${SERVER#sandbox}"
  local V=$(cd "$ROOT" && SERVER=$SERVER BOT_ROOT=$ROOTB SCRIPT="$SCRIPT" sandbox/run-scenario.sh "$FX" "$ENV" "$MIN" 2>&1 | grep -E '^\{"fixture"' | tail -1)
  local T1=$(date -u +%FT%TZ)
  (cd "$ROOT" && score "$BOT" "$T0" "$T1" "$LABEL" "$ARM" "$ROOTB" "${V:-{}}") | tee -a "$OUT.tmp"
}
: > "$OUT.tmp"; i=0
while IFS=$'\t' read -r FX ENV SCRIPT MIN LABEL; do
  [[ -z "$FX" || "$FX" == \#* ]] && continue
  one sandbox  "$CTRL" control   "$FX" "$ENV" "$SCRIPT" "$MIN" "$LABEL" &
  one sandbox3 "$CAND" candidate "$FX" "$ENV" "$SCRIPT" "$MIN" "$LABEL" &
  wait
done < "$CORPUS"
echo "=== corpus $RUN candidate=$(git -C "$CAND" rev-parse --short HEAD) control=$(git -C "$CTRL" rev-parse --short HEAD)"; column -t "$OUT.tmp"; sed "s/^/$RUN\t/" "$OUT.tmp" >> "$OUT"; rm -f "$OUT.tmp"
