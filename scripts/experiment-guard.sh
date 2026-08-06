#!/usr/bin/env bash
# experiment-guard.sh -- watch for the failure modes that silently waste a run.
#
# READ-ONLY BY DESIGN. It restarts nothing and changes nothing, so it cannot
# perturb an experiment in flight. It only decides whether something is wrong
# and says so loudly, to journald -- which now ships to Elasticsearch, so an
# alert is queryable rather than trapped on a host.
#
# WHY THIS EXISTS: every defect found on 2026-08-06 was found because a human
# asked a question. The admission gate froze shut over sixteen hours, climbing
# 23% -> 72%, while every dashboard looked fine. All five bots ran with empty
# goal stacks. A Paper ingest pipeline never processed one of 15,377 documents.
# None of it announced itself. Dashboards need someone to look; an invariant
# does not.
#
# Each check below is a condition that WAS true during a real failure and would
# have caught it hours earlier. Add to this list every time something is missed.
#
#   ./scripts/experiment-guard.sh          run once, print findings
#   ./scripts/experiment-guard.sh --quiet  only print when something is wrong
#
# Exit 0 = healthy, 1 = at least one alert.

set -uo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
SSH="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=10"
BOTS="${BOT_HOST:-10.0.0.187}"
ES="${ES_HOST:-10.0.0.186}"
QUIET=0; [ "${1:-}" = "--quiet" ] && QUIET=1
# Overridable so the checks can be replayed against a window where a failure is
# KNOWN to have happened. A guard nobody has seen fail is not a tested guard.
WINDOW="${WINDOW:-now-15m}"

ALERTS=0
say()   { [ "$QUIET" -eq 1 ] || printf '   %s\n' "$*"; }
alert() { ALERTS=$((ALERTS+1)); printf '   \033[31mALERT\033[0m %s\n' "$*"; }
ok()    { [ "$QUIET" -eq 1 ] || printf '   \033[32mok\033[0m    %s\n' "$*"; }

# --- pull one aggregate covering every check, so this is a single round trip --
cat > /tmp/guard-q.sh <<'SH'
cd /opt/docker-elk
EP=$(sudo grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
curl -s -u "elastic:$EP" "http://localhost:9200/mcai-llm-agents/_search" -H 'Content-Type: application/json' -d '{
 "size":0,"query":{"range":{"@timestamp":{"gte":"WINDOW_START","lt":"WINDOW_END"}}},
 "aggs":{"n":{"value_count":{"field":"llm.latency_ms"}},
         "veto":{"filter":{"exists":{"field":"llm.error"}}},
         "bots":{"terms":{"field":"bot.name","size":10}},
         "models":{"terms":{"field":"llm.model","size":5}}}}'
echo '@@@'
curl -s -u "elastic:$EP" "http://localhost:9200/mcai-skill-agents/_count" -H 'Content-Type: application/json' \
 -d '{"query":{"range":{"@timestamp":{"gte":"WINDOW_START","lt":"WINDOW_END"}}}}'
echo '@@@'
curl -s -u "elastic:$EP" "http://localhost:9200/mcai-gpu-metrics/_search?size=1" -H 'Content-Type: application/json' \
 -d '{"sort":[{"@timestamp":"desc"}],"_source":["@timestamp","ollama"]}'
SH
sed -i.bak "s|WINDOW_START|$WINDOW|g; s|WINDOW_END|${WINDOW_END:-now}|g" /tmp/guard-q.sh
scp -i "$SSH_KEY" -o BatchMode=yes -q /tmp/guard-q.sh "mike@$ES:/tmp/" 2>/dev/null
RAW=$($SSH "mike@$ES" 'bash /tmp/guard-q.sh' 2>/dev/null)

python3 - "$RAW" <<'PY' > /tmp/guard-out.txt 2>/dev/null || true
import json, sys
llm, skills, gpu = (sys.argv[1].split('@@@') + ['', '', ''])[:3]
out = {}
try:
    a = json.loads(llm)['aggregations']
    out['decisions'] = int(a['n']['value'] or 0)
    out['vetoes']    = a['veto']['doc_count']
    out['bots']      = {b['key']: b['doc_count'] for b in a['bots']['buckets']}
    out['models']    = {b['key']: b['doc_count'] for b in a['models']['buckets']}
except Exception: pass
try: out['skill_docs'] = json.loads(skills)['count']
except Exception: pass
try:
    h = json.loads(gpu)['hits']['hits']
    if h: out['ollama'] = h[0]['_source'].get('ollama', {}); out['gpu_at'] = h[0]['_source']['@timestamp']
except Exception: pass
print(json.dumps(out))
PY
G=$(cat /tmp/guard-out.txt 2>/dev/null)
[ -z "$G" ] && { alert "could not read telemetry from $ES -- the guard itself is blind"; exit 1; }

val() { printf '%s' "$G" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1',''))"; }

DECISIONS=$(val decisions); SKILLDOCS=$(val skill_docs); VETOES=$(val vetoes)

# 1. TELEMETRY ALIVE. Zero documents means the agents are running blind and any
#    result from this window is worthless, whatever the bots are doing.
if [ "${SKILLDOCS:-0}" -eq 0 ] 2>/dev/null; then
  alert "no skill telemetry in 15 minutes -- shipping or Elasticsearch is down"
else ok "telemetry flowing ($SKILLDOCS skill docs / 15m)"; fi

# 2. THE FLEET IS DECIDING. A cognitive layer that stops producing decisions
#    looks identical to a healthy idle fleet from the outside.
if [ "${DECISIONS:-0}" -eq 0 ] 2>/dev/null; then
  alert "no LLM decisions in 15 minutes -- the cognitive loop is not running"
else ok "$DECISIONS decisions / 15m"; fi

# 3. THE GATE HAS NOT FROZEN. This is the sixteen-hour bug. A gate whose veto
#    rate can reach 100% is not a safety mechanism, it is the failure.
if [ "${DECISIONS:-0}" -gt 20 ] 2>/dev/null; then
  PCT=$(( 100 * VETOES / DECISIONS ))
  # 45, not 60. Calibrated by REPLAYING this check against the real freeze:
  # the four-hour average was 58% and the peak 72%, so a 60% threshold would
  # have stayed silent through the exact failure it exists to catch. Healthy is
  # 11-25%; 45% leaves margin above normal and still fires while the climb is
  # in its 48-59% stage, hours before the peak.
  if [ "$PCT" -ge 45 ]; then
    alert "admission gate vetoing ${PCT}% of proposals -- the fleet is freezing shut"
  else ok "veto rate ${PCT}%"; fi
fi

# 4. EVERY BOT IS PARTICIPATING. One silent bot in an A/B arm quietly halves the
#    sample and biases the comparison, without anything looking broken.
SILENT=$(printf '%s' "$G" | python3 -c "
import json,sys
d=json.load(sys.stdin); seen=d.get('bots',{})
expected={'Scout01','Scout02','Miner01','Gather01','Gather02'}
print(','.join(sorted(expected - set(seen))))")
if [ -n "$SILENT" ]; then alert "no decisions from: $SILENT"; else ok "all five bots deciding"; fi

# 5. BOTH ARMS ALIVE. If one model stops answering, the experiment silently
#    becomes a single-arm run that still produces a confident-looking report.
# Compare against how many distinct models are actually CONFIGURED, rather than
# assuming two. Outside an A/B the fleet runs one model, and a hardcoded "expect
# 2" makes the guard cry wolf every time -- which is how guards get ignored.
MODELS=$(printf '%s' "$G" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('models',{})))")
EXPECTED=$($SSH "mike@$BOTS" "sudo grep -h '^OLLAMA_MODEL=' /srv/mcbots/harness/env/*.env 2>/dev/null | sort -u | wc -l" 2>/dev/null | tr -d ' ')
EXPECTED=${EXPECTED:-1}
if [ "${MODELS:-0}" -lt "$EXPECTED" ] 2>/dev/null; then
  alert "$MODELS model(s) answering but $EXPECTED configured -- an arm may be dead"
else ok "$MODELS/$EXPECTED configured models answering"; fi

# 6. THE HONEYPOT STILL OWNS ITS GPU. A larger model can evict a pinned one;
#    this happened, and only model-residency telemetry makes it visible.
HP=$(printf '%s' "$G" | python3 -c "
import json,sys
o=json.load(sys.stdin).get('ollama',{})
print('MISSING' if o and 'qwen2.5-coder:7b' not in (o.get('models') or []) else 'ok')")
if [ "$HP" = "MISSING" ]; then
  alert "the honeypot's pinned model is NOT resident on the GPU host"
else ok "honeypot model resident"; fi

# --- report ------------------------------------------------------------------
if [ "$ALERTS" -gt 0 ]; then
  logger -t mcai-guard -p user.err "experiment-guard: $ALERTS alert(s)" 2>/dev/null || true
  exit 1
fi
[ "$QUIET" -eq 1 ] || printf '\n   \033[32mall clear\033[0m\n'
exit 0
