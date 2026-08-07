#!/usr/bin/env bash
# Apply the lab's Elasticsearch mappings, retention and ingest pipeline.
#
# Extracted verbatim from scripts/bootstrap-mcelk.sh lines 162-245 so it can be
# re-run against a rebuilt stack without re-running host provisioning. ELK is a
# disposable VIEW over the JSONL on the bot host, not the system of record
# (ADR-0001 D4) -- so rebuilding it must be cheap, and that means the mappings
# have to live somewhere re-appliable.
#
# ORDER MATTERS: these mappings are dynamic:strict, so any undeclared field is
# rejected outright, and the only symptom is one "events were dropped" line in
# the Filebeat log. The templates must exist BEFORE the first document.
#
# Run on the ELK host.
set -euo pipefail
cd /opt/docker-elk
EP=$(grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
q() { curl -s -u "elastic:$EP" "$@"; }
say(){ printf '\n== %s\n' "$*"; }
ok(){ printf '   ok  %s\n' "$*"; }

say "Index templates and retention"
# ORDER MATTERS. These mappings are dynamic:strict, so anything not declared
# here is rejected outright -- with the only symptom being one "events were
# dropped" line in the Filebeat log. The template must exist before ingest.
q -XPUT "http://localhost:9200/_ilm/policy/mcai-logs" -H 'Content-Type: application/json' -d '{
 "policy":{"phases":{
  "hot":{"min_age":"0ms","actions":{"rollover":{"max_primary_shard_size":"10gb","max_age":"7d"},
                                    "set_priority":{"priority":100}}},
  "delete":{"min_age":"180d","actions":{"delete":{}}}}}}' >/dev/null
ok "ILM: rollover 10gb/7d, delete at 180d"

COMMON='"@timestamp":{"type":"date"},"run_id":{"type":"keyword"},"trigger":{"type":"keyword"},
 "code":{"properties":{"version":{"type":"keyword"},"config_hash":{"type":"keyword"}}},
 "perception":{"type":"flattened"},
 "bot":{"properties":{"name":{"type":"keyword"},"role":{"type":"keyword"},
        "health":{"type":"float"},"hunger":{"type":"float"},
        "pos":{"properties":{"x":{"type":"float"},"y":{"type":"float"},"z":{"type":"float"}}}}},
 "game":{"properties":{"tick":{"type":"long"},"dimension":{"type":"keyword"},
        "day":{"type":"long"},"biome":{"type":"keyword"}}}'
SETTINGS='"index.lifecycle.name":"mcai-logs","index.number_of_shards":1,
 "index.number_of_replicas":0,"index.codec":"best_compression",
 "index.mapping.total_fields.limit":250,"index.refresh_interval":"5s"'

q -XPUT "http://localhost:9200/_index_template/mcai-skill" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-skill-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS},\"mappings\":{\"dynamic\":\"strict\",\"properties\":{$COMMON,
  \"skill\":{\"properties\":{\"name\":{\"type\":\"keyword\"},\"args\":{\"type\":\"flattened\"},
   \"status\":{\"type\":\"keyword\"},\"duration_ms\":{\"type\":\"long\"},\"detail\":{\"type\":\"text\"},
   \"fail_class\":{\"type\":\"keyword\"},\"distance_moved\":{\"type\":\"float\"},
   \"inventory_delta\":{\"type\":\"flattened\"}}}}}}}" >/dev/null
ok "mcai-skill-* template"

q -XPUT "http://localhost:9200/_index_template/mcai-llm" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-llm-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS},\"mappings\":{\"dynamic\":\"strict\",\"properties\":{$COMMON,
  \"llm\":{\"properties\":{\"model\":{\"type\":\"keyword\"},\"endpoint\":{\"type\":\"keyword\"},
   \"prompt_tokens\":{\"type\":\"long\"},\"completion_tokens\":{\"type\":\"long\"},
   \"latency_ms\":{\"type\":\"long\"},\"total_duration_ns\":{\"type\":\"long\"},
   \"load_duration_ns\":{\"type\":\"long\"},\"prompt_eval_duration_ns\":{\"type\":\"long\"},
   \"eval_duration_ns\":{\"type\":\"long\"},\"schema_valid\":{\"type\":\"boolean\"},
   \"error\":{\"type\":\"keyword\"},\"retry_count\":{\"type\":\"short\"}}},
  \"prompt\":{\"properties\":{\"system_hash\":{\"type\":\"keyword\"},\"text\":{\"type\":\"text\"}}},
  \"response\":{\"properties\":{\"text\":{\"type\":\"text\"}}},
  \"messages\":{\"type\":\"flattened\"},\"tool_calls\":{\"type\":\"flattened\"},
  \"outcome\":{\"properties\":{\"status\":{\"type\":\"keyword\"},\"detail\":{\"type\":\"text\"}}}}}}}" >/dev/null
ok "mcai-llm-* template"

q -XPUT "http://localhost:9200/_index_template/mcai-mc" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-mc-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS},\"mappings\":{\"dynamic\":\"false\",\"properties\":{
  \"@timestamp\":{\"type\":\"date\"},\"message\":{\"type\":\"text\"},
  \"log\":{\"properties\":{\"level\":{\"type\":\"keyword\"},\"thread\":{\"type\":\"keyword\"}}},
  \"mc\":{\"properties\":{\"event\":{\"type\":\"keyword\"},\"player\":{\"type\":\"keyword\"},
   \"x\":{\"type\":\"float\"},\"y\":{\"type\":\"float\"},\"z\":{\"type\":\"float\"},
   \"reason\":{\"type\":\"text\"},\"chat\":{\"type\":\"text\"}}},
  \"host\":{\"properties\":{\"name\":{\"type\":\"keyword\"}}}}}}}" >/dev/null
ok "mcai-mc-* template"

# Paper thread names contain slashes, so the level must be matched greedily
# from the RIGHT -- dissect splits on the first slash and mangles every record.
q -XPUT "http://localhost:9200/_ingest/pipeline/mcai-paper" -H 'Content-Type: application/json' -d '{
 "description":"Parse Paper server logs.",
 "processors":[
  {"grok":{"field":"message","ignore_failure":true,
    "patterns":["\\[%{TIME:mc.time}\\] \\[%{GREEDYDATA:log.thread}/%{LOGLEVEL:log.level}\\]: %{GREEDYDATA:_msg}"]}},
  {"set":{"field":"message","copy_from":"_msg","ignore_empty_value":true}},
  {"remove":{"field":"_msg","ignore_missing":true}},
  {"drop":{"if":"ctx.log?.thread != null && ctx.log.thread.contains(\"RCON\")"}},
  {"grok":{"field":"message","ignore_failure":true,
    "patterns":["%{USERNAME:mc.player}\\[/%{IP}:%{NUMBER}\\] logged in with entity id %{NUMBER} at \\(\\[%{DATA}\\]%{NUMBER:mc.x:float}, %{NUMBER:mc.y:float}, %{NUMBER:mc.z:float}\\)"]}},
  {"set":{"field":"mc.event","value":"join","if":"ctx.message != null && ctx.message.contains(\"logged in with entity id\")"}},
  {"grok":{"field":"message","ignore_failure":true,
    "patterns":["%{USERNAME:mc.player} \\(/%{IP}:%{NUMBER}\\) lost connection: %{GREEDYDATA:mc.reason}",
                "%{USERNAME:mc.player} lost connection: %{GREEDYDATA:mc.reason}"]}},
  {"set":{"field":"mc.event","value":"disconnect","if":"ctx.message != null && ctx.message.contains(\"lost connection\")"}},
  {"grok":{"field":"message","ignore_failure":true,"patterns":["<%{USERNAME:mc.player}> %{GREEDYDATA:mc.chat}"]}},
  {"set":{"field":"mc.event","value":"chat","if":"ctx.mc?.chat != null"}},
  {"set":{"field":"mc.event","value":"warn","if":"ctx.log?.level == \"WARN\""}},
  {"set":{"field":"mc.event","value":"error","if":"ctx.log?.level == \"ERROR\""}},
  {"set":{"field":"mc.event","value":"other","override":false}}
 ],
 "on_failure":[{"set":{"field":"mc.event","value":"parse_failed"}}]}' >/dev/null
ok "mcai-paper ingest pipeline"
