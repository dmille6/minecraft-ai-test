#!/bin/bash
# opsaudit.sh -- DAILY CODEX AUDIT OF THE OPERATOR'S DECISIONS (OWNER 2026-10-20 "yes").
# The operator session (Claude) runs the canary queue and the hosts alone; designs and code already get Codex + Claude
# review, day-to-day operating calls did not. Once a day Codex reads the last 26 h of decisions (main's commits and STATE
# entries, the canary journal, the queue, the owner-decision memory notes) against CLAUDE.md and the owner's rules, and
# writes FLAGS. Read-only: Codex runs with -s read-only on a private clone; this script only writes its own report.
# The report lands where the operator reads every session: 10.0.0.31 ~/digest/opsaudit-latest.md (fleetstatus.py prints
# its first line and age in the header; a missing or > 30 h old report is itself an alarm line there).
set -u
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
D=$HOME/opsaudit; R=$D/repo; OUT=$D/out; mkdir -p "$OUT"
DAY=$(date -u +%F); STAMP=$(date -u +%FT%H%MZ); P=$D/prompt-$STAMP.txt; F=$OUT/opsaudit-$DAY.md
SSH31="ssh -o BatchMode=yes -o ConnectTimeout=15 mike@10.0.0.31"
log() { echo "$(date -u +%FT%TZ) $*"; }
if [ ! -d "$R/.git" ]; then git clone -q git@github.com:dmille6/minecraft-ai-test.git "$R" || { log "clone failed"; exit 2; }; fi
git -C "$R" fetch -q origin && git -C "$R" checkout -q --detach origin/main || { log "fetch failed"; exit 2; }
SINCE=$(date -u -v-26H +%FT%H:%M:%SZ)
{
cat <<EOF
You are an INDEPENDENT AUDITOR of the operator's decisions for the minecraft-ai bot fleet. The operator is a Claude
session that runs the canary queue, deploys, host changes and agent work on the owner's behalf. Designs and code already
get Codex + Claude review; YOUR job is the operating calls: queue order and holds, early closes, KEEP/REVERT handling,
promotions and merges, infrastructure changes, what was told to the owner, and whether owner decisions were followed.

Read CLAUDE.md in this checkout first (the project's rules, each with its evidence). Then audit the window $SINCE .. now
using the material below and any file in this repo you need (docs/reports/STATE.md, docs/reports/*). You are read-only.

Report format (markdown, short, plain language for the owner):
  line 1 EXACTLY: "OPSAUDIT $DAY FLAGS: <n> (<k> high)"
  ## Flags -- numbered; each: severity (high / medium / low), what was done, which rule or owner decision it conflicts
     with or what risk it carries, the evidence (file/line or journal ts), and what you would have done instead.
  ## Agreed -- one line per significant decision you checked and agree with.
  ## Questions for the owner -- only if a decision is genuinely the owner's.
Do not invent problems; "FLAGS: 0" is a valid result. Do not flag the owner's own decisions; flag the operator's
execution of them. A claim the operator made to the owner that the evidence contradicts is HIGH.
EOF
echo; echo "=== commits on main since $SINCE"; git -C "$R" log --since="$SINCE" --format='%h %ad %s' --date=iso-strict origin/main | head -80
echo; echo "=== STATE.md changes since $SINCE (diff, capped)"; git -C "$R" log -p --since="$SINCE" --format='--- %h %ad' --date=iso-strict origin/main -- docs/reports/STATE.md | grep -E '^(\+|--- )' | grep -v '^+++' | head -c 60000
echo; echo "=== canary journal since $SINCE (10.0.0.31 ~/canary-journal.jsonl, capped)"
$SSH31 "python3 -c \"
import json,sys
for l in open('/home/mike/canary-journal.jsonl', errors='replace'):
  try: r=json.loads(l)
  except Exception: continue
  if r.get('ts','')>='$SINCE': print(r.get('ts'), r.get('run'), r.get('phase'), (r.get('note') or '')[:400])
\"" </dev/null | tail -c 50000
echo; echo "=== queue status now"; $SSH31 'python3 ~/canary-sched.py status 2>&1 | grep -v -E "^\S+ +(done|cancelled) " | cut -c1-260' </dev/null | head -40
echo; echo "=== owner-decision memory notes changed since $SINCE (the operator's record of what the owner said)"
find "$HOME/.claude/projects/-Users-darrellmiller-Documents-code-minecraft-ai/memory" -name 'owner-*.md' -newermt "$(date -v-26H '+%Y-%m-%d %H:%M:%S')" -print 2>/dev/null | while read -r m; do echo "--- $(basename "$m")"; sed -n '1,60p' "$m"; done | head -c 30000
} > "$P"
log "prompt $(wc -c < "$P") bytes"
( cd "$R" && codex exec --sandbox read-only - < "$P" > "$F.tmp" 2> "$D/codex-$STAMP.err" ) & pid=$!
( sleep 1500; kill $pid 2>/dev/null ) & wd=$!
wait $pid; rc=$?; kill $wd 2>/dev/null
L1=$(grep -m1 '^OPSAUDIT ' "$F.tmp" 2>/dev/null)
if [ $rc -ne 0 ] || [ -z "$L1" ]; then
  { echo "OPSAUDIT $DAY FAILED: codex rc=$rc, no report line (see ~/opsaudit/codex-$STAMP.err on the Mac mini)"; tail -20 "$F.tmp" 2>/dev/null; } > "$F"
else
  sed -n '/^OPSAUDIT /,$p' "$F.tmp" > "$F"
fi
rm -f "$F.tmp"
scp -q -o BatchMode=yes "$F" mike@10.0.0.31:digest/opsaudit-latest.md && log "published: $(head -1 "$F")" || log "publish to .31 FAILED"
find "$D" -maxdepth 1 -name 'prompt-*.txt' -mtime +14 -delete; find "$D" -maxdepth 1 -name 'codex-*.err' -mtime +14 -delete
