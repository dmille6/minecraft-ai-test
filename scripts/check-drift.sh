#!/usr/bin/env bash
# check-drift.sh -- am I out of step with the other agent, the hosts, or reality?
#
# Run this before starting work, and after the other agent pushes anything.
#
# A timer would not catch the failure that actually matters. The two halves of
# this project couple in exactly one place: the harness EMITS telemetry records
# and the Elasticsearch mappings ACCEPT them. Those mappings are dynamic:strict,
# so one unexpected field rejects the entire document -- silently, with no
# symptom beyond a single "events were dropped" line in the Filebeat log. That
# break happens at DEPLOY time, not at commit time, so polling git would miss it.
#
# Checks, cheapest first:
#   1. repo vs origin            am I behind?
#   2. deployed vs committed     is the VM running what is in git?
#   3. emitted vs mapped         the silent killer
#   4. ingest health             are documents actually landing?

set -uo pipefail
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
BOT_HOST="${BOT_HOST:-192.168.192.199}"
ES_HOST="${ES_HOST:-192.168.192.194}"
ES_USER="${ES_USER:-mike}"   # `elastic` has a generated password; mike is the human account
SSH="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=8"
FAIL=0
say() { printf '%s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*"; FAIL=1; }
ok()  { printf '  ✓ %s\n' "$*"; }

say ""
say "── 1. repo vs origin ──────────────────────────────────────────"
git fetch -q origin 2>/dev/null
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')
if [ "$BEHIND" != "0" ]; then
  bad "$BEHIND commit(s) behind origin/main — pull before working"
  git log --oneline HEAD..origin/main 2>/dev/null | head -5 | sed 's/^/      /'
else
  ok "up to date with origin/main"
fi
[ "$AHEAD" != "0" ] && say "  · $AHEAD unpushed commit(s) of my own"
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
[ "$DIRTY" != "0" ] && say "  · $DIRTY uncommitted file(s) here"

say ""
say "── 2. deployed harness vs committed ───────────────────────────"
# Read EVERY env file, not just the first.
#
# 2026-08-05: this check printed a soft informational bullet while the fleet ran
# 18 commits behind, missing both entombment fixes. _entombed then fired 2,695
# times in three hours and success collapsed to 5%. Deploying dropped it to 0
# and lifted success to 70%. The check existed and said nothing useful.
#
# Two separate faults, both fixed here:
#   1. `head -1` read one env file, so it could not see that the three bots
#      disagreed with each other (gatherer/miner 884d053, scout f63abfb).
#   2. A version mismatch was reported as "expected", which is exactly the
#      sentence that let a real regression pass as normal.
# sudo: the env files are root-owned. Without it grep returns nothing and the
# whole check silently degrades to "not recorded" -- which is how it stayed
# green for its entire life while never once reading a version.
REMOTE_VS=$($SSH "mike@$BOT_HOST" 'sudo -n grep -h -oE "CODE_VERSION=.*" /srv/minecraft/bots/harness/env/*.env 2>/dev/null | cut -d= -f2' 2>/dev/null | tr -d "'\"" | sort -u)
LOCAL_V=$(git rev-parse --short HEAD)
NVER=$(printf '%s\n' "$REMOTE_VS" | grep -c . || true)
if [ -z "$REMOTE_VS" ]; then
  say "  · deployed version not recorded (agent may predate CODE_VERSION)"
elif [ "$NVER" -gt 1 ]; then
  bad "bots are running DIFFERENT builds: $(echo $REMOTE_VS | tr '\n' ' ')"
  say "        → a partial deploy; redeploy all three so they agree"
elif [ "$REMOTE_VS" = "$LOCAL_V" ]; then
  ok "VM is running $REMOTE_VS, matches HEAD"
else
  BEHIND_N=$(git rev-list --count "$REMOTE_VS".."$LOCAL_V" 2>/dev/null || echo '?')
  if [ "$BEHIND_N" = "0" ]; then
    say "  · VM runs $REMOTE_VS, ahead of or level with local HEAD $LOCAL_V"
  else
    bad "VM runs $REMOTE_VS — $BEHIND_N commit(s) BEHIND $LOCAL_V"
    git log --oneline "$REMOTE_VS".."$LOCAL_V" 2>/dev/null | head -6 | sed 's/^/        /'
    say "        → undeployed fixes are not fixes; redeploy"
  fi
fi

say ""
say "── 3. emitted fields vs Elasticsearch mapping ─────────────────"
say "     (the silent killer: dynamic:strict rejects unknown fields whole)"
for PAIR in "skill-*.jsonl:mcai-skill-agents" "llm-*.jsonl:mcai-llm-agents"; do
  GLOB="${PAIR%%:*}"; INDEX="${PAIR##*:}"
  EMITTED=$($SSH "mike@$BOT_HOST" "sudo tail -1 /srv/minecraft/bots/logs/$GLOB 2>/dev/null | head -1" 2>/dev/null \
    | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit()
def walk(o,p=''):
    for k,v in o.items():
        n=f'{p}.{k}' if p else k
        if isinstance(v,dict) and k not in ('args','inventory_delta','perception','messages','tool_calls'):
            walk(v,n)
        else: print(n)
walk(d)" 2>/dev/null | sort -u)
  MAPPED=$(curl -s -u "$ES_USER:${ES_PASS:-}" "http://$ES_HOST:9200/$INDEX/_mapping" 2>/dev/null \
    | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit()
out=set()
def walk(p,pre=''):
    for k,v in (p or {}).items():
        n=f'{pre}.{k}' if pre else k
        if isinstance(v,dict) and 'properties' in v: walk(v['properties'],n)
        else: out.add(n)
for idx in d.values(): walk(idx.get('mappings',{}).get('properties',{}))
print('\n'.join(sorted(out)))" 2>/dev/null | sort -u)

  if [ -z "$EMITTED" ] || [ -z "$MAPPED" ]; then
    say "  · $INDEX: could not compare (set ES_PASS, or no records yet)"
    continue
  fi
  UNKNOWN=$(comm -23 <(echo "$EMITTED") <(echo "$MAPPED") | grep -v '^$' || true)
  if [ -n "$UNKNOWN" ]; then
    bad "$INDEX will REJECT documents — fields emitted but not mapped:"
    echo "$UNKNOWN" | sed 's/^/        /'
    say "        → add these to infra/elk/index-template.json and roll the data stream"
  else
    ok "$INDEX: every emitted field is mapped"
  fi
done

say ""
say "── 4. is anything actually landing? ───────────────────────────"
for I in mcai-skill-agents mcai-llm-agents mcai-mc-paper; do
  N=$(curl -s -u "$ES_USER:${ES_PASS:-}" "http://$ES_HOST:9200/$I/_count" 2>/dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin).get('count','?'))" 2>/dev/null)
  RECENT=$(curl -s -u "$ES_USER:${ES_PASS:-}" "http://$ES_HOST:9200/$I/_count" \
      -H 'Content-Type: application/json' \
      -d '{"query":{"range":{"@timestamp":{"gte":"now-15m"}}}}' 2>/dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin).get('count','?'))" 2>/dev/null)
  printf '  · %-22s %s docs total, %s in the last 15m\n' "$I" "${N:-?}" "${RECENT:-?}"
done
# grep -c over multiple journal streams prints one count per stream, so sum them
DROPS=$($SSH "mike@$BOT_HOST" 'sudo journalctl -u filebeat --since "-30 min" -o cat 2>/dev/null | grep -ci "events were dropped"' 2>/dev/null | awk '{n+=$1} END{print n+0}')
DROPS=${DROPS:-0}
if [ "${DROPS:-0}" -gt 0 ]; then
  bad "Filebeat reported dropped events $DROPS time(s) in the last 30m — almost certainly a mapping rejection"
else
  ok "no dropped-event reports from Filebeat"
fi

say ""
[ "$FAIL" = "0" ] && say "no drift detected" || say "DRIFT DETECTED — see ✗ above"
exit "$FAIL"
