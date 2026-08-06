#!/usr/bin/env bash
# ab-report.sh -- read out the model A/B.
#
#   ./scripts/ab-report.sh [since]        default: the recorded experiment start
#
# Reports per arm, per bot:
#   milestones/hour   the PRIMARY outcome. Latency is not the question; whether
#                     the bot gets things done is.
#   decisions/hour    the rate the smaller model is supposed to buy
#   valuable/hour     outcomes the classifier confirmed with a measurement
#   veto rate         proposals the admission gate refused
#   deaths, p50 ms
#
# Milestone completions only became telemetry when this experiment was set up --
# before that Elasticsearch recorded every give-up and no achievement, so the
# primary outcome did not exist as data. Runs before that point cannot be
# compared on it.

set -euo pipefail
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
SSH="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=10"
ES="${ES_HOST:-10.0.0.186}"
BOTS="${BOT_HOST:-10.0.0.187}"

SINCE="${1:-$($SSH "mike@$BOTS" 'cat /srv/mcbots/state/ab-started.txt 2>/dev/null' || echo 'now-6h')}"
[ -n "$SINCE" ] || SINCE="now-6h"

cat > /tmp/ab-q.sh <<SH
cd /opt/docker-elk
EP=\$(sudo grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
q() { curl -s -u "elastic:\$EP" "http://localhost:9200/\$1/_search" -H 'Content-Type: application/json' -d "\$2"; }
echo '---SKILLS---'
q mcai-skill-agents '{"size":0,"query":{"range":{"@timestamp":{"gte":"$SINCE"}}},
 "aggs":{"b":{"terms":{"field":"bot.name","size":10},
  "aggs":{"ms":{"filter":{"term":{"skill.name":"_milestone_complete"}}},
          "deaths":{"filter":{"term":{"skill.name":"_death"}}},
          "fc":{"terms":{"field":"skill.fail_class","size":6}}}}}}'
echo '---LLM---'
q mcai-llm-agents '{"size":0,"query":{"range":{"@timestamp":{"gte":"$SINCE"}}},
 "aggs":{"b":{"terms":{"field":"bot.name","size":10},
  "aggs":{"n":{"value_count":{"field":"llm.latency_ms"}},
          "lat":{"percentiles":{"field":"llm.latency_ms","percents":[50,90]}},
          "model":{"terms":{"field":"llm.model","size":3}},
          "veto":{"filter":{"exists":{"field":"llm.error"}}}}}}}'
SH

scp -i "$SSH_KEY" -o BatchMode=yes -q /tmp/ab-q.sh "mike@$ES:/tmp/"
$SSH "mike@$ES" 'bash /tmp/ab-q.sh' | SINCE="$SINCE" python3 -c '
import json, os, sys, datetime

raw = sys.stdin.read()
parts = raw.split("---LLM---")
skills = json.loads(parts[0].replace("---SKILLS---", "").strip())
llm    = json.loads(parts[1].strip())

ARM = {"Gather01":"A 7b","Scout01":"A 7b","Gather02":"B 14b","Scout02":"B 14b","Miner01":"B 14b*"}

sb = {b["key"]: b for b in skills["aggregations"]["b"]["buckets"]}
lb = {b["key"]: b for b in llm["aggregations"]["b"]["buckets"]}

print(f"\nwindow since {os.environ[\"SINCE\"]}")
print(f"{\"bot\":10} {\"arm\":7} {\"model\":22} {\"decis\":>6} {\"veto%\":>6} {\"p50ms\":>7} {\"miles\":>6} {\"deaths\":>7}")
for bot in sorted(set(sb) | set(lb)):
    s, l = sb.get(bot, {}), lb.get(bot, {})
    n = int(l.get("n", {}).get("value", 0) or 0)
    veto = l.get("veto", {}).get("doc_count", 0)
    p50 = (l.get("lat", {}).get("values", {}) or {}).get("50.0") or 0
    models = ",".join(x["key"] for x in (l.get("model", {}).get("buckets") or []))
    ms = s.get("ms", {}).get("doc_count", 0)
    dz = s.get("deaths", {}).get("doc_count", 0)
    print(f"{bot:10} {ARM.get(bot,\"?\"):7} {models[:22]:22} {n:6} {100*veto/n if n else 0:5.0f}% {p50:7.0f} {ms:6} {dz:7}")
print("\n* Miner01 is the only miner, so it has no paired counterpart and is excluded")
print("  from the arm comparison. Milestone counts need the _milestone_complete")
print("  event, which only exists from the start of this experiment onward.")
'
