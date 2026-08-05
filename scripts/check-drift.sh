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
REMOTE_V=$($SSH "mike@$BOT_HOST" 'grep -oE "CODE_VERSION=.*" /srv/minecraft/bots/harness/env/*.env 2>/dev/null | head -1 | cut -d= -f2' 2>/dev/null | tr -d "'\"")
LOCAL_V=$(git rev-parse --short HEAD)
if [ -z "$REMOTE_V" ]; then
  say "  · deployed version not recorded (agent may predate CODE_VERSION)"
elif [ "$REMOTE_V" = "$LOCAL_V" ]; then
  ok "VM is running $REMOTE_V, matches HEAD"
else
  say "  · VM runs $REMOTE_V, HEAD is $LOCAL_V — expected if the other agent deployed"
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
