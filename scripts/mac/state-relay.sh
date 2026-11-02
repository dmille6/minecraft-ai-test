#!/bin/bash
# STATE RELAY (Mac LaunchAgent com.mcai.state-relay, hourly at :30): the canary host cannot push to GitHub, so this copies
# its generated ~/digest/STATE.md (scripts/host/stategen.py, cron :20) into docs/reports/STATE.md on main.
#   - main's own NOTES block is re-read at commit time and kept verbatim (a hand note written since the host's fetch wins)
#   - commits only when the GENERATED block changed apart from its timestamp, or the committed copy is > 6 h old
#   - fetch + rebase, never force; a refused push retries once after a fresh fetch, then gives up until the next hour
#   - a generated copy older than 3 h is NOT committed (the host job stopped): the log says so, main keeps its last copy
# Light: one scp, one git commit. Private clone ~/state-relay/repo (no hooks). Log ~/Library/Logs/state-relay.log.
set -u
HOSTA=mike@10.0.0.31
D=$HOME/state-relay; R=$D/repo; mkdir -p "$D"
log() { echo "$(date -u +%FT%TZ) $*"; }
[ -d "$R/.git" ] || git clone -q git@github.com:dmille6/minecraft-ai-test.git "$R" || { log "clone failed"; exit 1; }
scp -q -o BatchMode=yes -o ConnectTimeout=20 "$HOSTA:digest/STATE.md" "$D/STATE.gen.md" || { log "scp failed"; exit 1; }
for attempt in 1 2; do
  git -C "$R" fetch -q origin main && git -C "$R" checkout -q -B main origin/main || { log "fetch failed"; exit 1; }
  out=$(python3 - "$D/STATE.gen.md" "$R/docs/reports/STATE.md" <<'EOF'
import datetime as dt, re, sys
gen_path, cur_path = sys.argv[1], sys.argv[2]
B, E = '<!-- GENERATED:BEGIN -->', '<!-- GENERATED:END -->'
NB, NE = '<!-- NOTES:BEGIN (hand-written; stategen.py keeps this block verbatim) -->', '<!-- NOTES:END -->'
gen = open(gen_path).read()
cur = open(cur_path).read()
if B not in gen or E not in gen or NB not in gen:
    print('SKIP generated copy has no markers'); sys.exit()
m = re.search(r'_Generated (\S+)\._', gen)
t = dt.datetime.fromisoformat(m.group(1).replace('Z', '+00:00')) if m else None
now = dt.datetime.now(dt.timezone.utc)
if t is None or now - t > dt.timedelta(hours=3):
    print(f'SKIP generated copy is stale ({m.group(1) if m else "no time"}): stategen.py on the canary host stopped'); sys.exit()
block = lambda s: s.split(B, 1)[1].split(E, 1)[0] if B in s and E in s else ''
strip_t = lambda s: re.sub(r'_Generated \S+\._', '', s)
notes = cur.split(NB, 1)[1].split(NE, 1)[0] if NB in cur and NE in cur else None
if notes is None:
    print('SKIP main STATE.md has no NOTES block: add the markers by hand once (stategen.py render_page)'); sys.exit()
page = gen.split(NB, 1)[0] + NB + notes + NE + gen.split(NE, 1)[1]
mc = re.search(r'_Generated (\S+)\._', cur)
ct = dt.datetime.fromisoformat(mc.group(1).replace('Z', '+00:00')) if mc else None
if strip_t(block(cur)) == strip_t(block(page)) and ct and now - ct < dt.timedelta(hours=6) and page.split(E, 1)[1] == cur.split(E, 1)[1]:
    print('SAME'); sys.exit()
open(cur_path, 'w').write(page)
print('WRITE ' + m.group(1))
EOF
)
  case "$out" in
    SAME|SKIP*) log "$out"; exit 0 ;;
    WRITE*) ;;
    *) log "relay error: $out"; exit 1 ;;
  esac
  git -C "$R" add docs/reports/STATE.md
  git -C "$R" commit -q -F - <<EOF
STATE: generated ${out#WRITE } (stategen.py on the canary host, relayed by state-relay.sh)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
  if git -C "$R" push -q origin main 2>/dev/null; then log "pushed ${out#WRITE }"; exit 0; fi
  log "push refused (attempt $attempt): refetching"
done
log "gave up this hour"; exit 1
