#!/usr/bin/env bash
# Apply the lab's Elasticsearch mappings, retention and ingest pipeline.
#
# Extracted verbatim from scripts/bootstrap-mcelk.sh lines 162-245 so it can be
# re-run against a rebuilt stack without re-running host provisioning. ELK is a
# disposable VIEW over the JSONL on the bot host, not the system of record
# (ADR-0001 D4) -- so rebuilding it must be cheap, and that means the mappings
# have to live somewhere re-appliable.
#
# llm.args_cleaned_fields, 2026-09-23: THE SAME BUG, THIRD TIME, AND IT COST EIGHT DAYS.
#
# logger.mjs:222 writes `args_cleaned_fields: (...).map(c => c.field).join(',') || null` -- a
# STRING when args were scrubbed, null when they were not. It was never declared here, and the
# llm template is `dynamic: strict`, which rejects the WHOLE DOCUMENT for one unknown field.
#
# MEASURED 2026-09-23 from the cluster and git:
#   09-07 08:24  d121f63 adds the field to the logger
#   09-07 23:30  the last llm document reaches Elasticsearch
#   09-16        0e4bd05 declares args_cleaned (but NOT args_cleaned_fields) and shipping
#                resumes at 23:46 -- because by then the grammar `pattern` fix had made the
#                value null on every call, and ES ignores null for dynamic mapping
#   result: EIGHT DAYS, 2026-09-08..15, ZERO llm documents. ~1.4M decisions absent.
#           mcai-skill-agents had zero empty days throughout, so the fleet was fine.
# Confirmed absent cluster-wide, not misrouted: no index holds a document with llm.latency_ms
# in that window, while the same query returns 177,421 for 09-17..18.
#
# It is declared now because the field is a LOADED GUN, not because it is currently lossy:
# today all 130,559 rows carry it as null and nothing is dropped. The moment the grammar
# regresses and an arg gets scrubbed, the whole stream goes dark again, silently.
#
# bot.tools (iron retention, 16 Sep 2026) and llm.args_cleaned were the next two: 349 and 51 of 400 sampled
# skill/llm documents rejected with strict_dynamic_mapping_exception, found only because the license fix
# made someone read the filebeat drop counter. Every new snapshot field needs a line here.
# bot.inventory and bot.held were added to the state snapshot in the harness and
# NOT here, so every skill document was rejected whole with
# strict_dynamic_mapping_exception -- and the only symptom was one line in the
# Filebeat log reading "events were dropped". Telemetry that fails closed is
# right; telemetry that fails closed QUIETLY is how a fleet runs for hours
# producing nothing anyone can see.
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
 "exp":{"properties":{"memory_scope":{"type":"keyword"},"arm":{"type":"keyword"},
        "instance":{"type":"keyword"},"block":{"type":"keyword"},
        "pool":{"type":"keyword"}}},
 "perception":{"type":"flattened"},
 "bot":{"properties":{"name":{"type":"keyword"},"role":{"type":"keyword"},
        "health":{"type":"float"},"hunger":{"type":"float"},
        "held":{"type":"keyword"},
        "inventory":{"type":"flattened"},
        "tools":{"type":"flattened"},
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
   \"inventory_delta\":{\"type\":\"flattened\"}}},
  \"board\":{\"properties\":{\"id\":{\"type\":\"keyword\"},\"event\":{\"type\":\"keyword\"},
   \"claim\":{\"type\":\"keyword\"},\"state\":{\"type\":\"keyword\"},
   \"reporters\":{\"type\":\"short\"},\"credit\":{\"type\":\"float\"},
   \"carried_ms\":{\"type\":\"long\"},\"distance\":{\"type\":\"float\"}}}}}}}" >/dev/null
ok "mcai-skill-* template"

q -XPUT "http://localhost:9200/_index_template/mcai-llm" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-llm-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS},\"mappings\":{\"dynamic\":\"strict\",\"properties\":{$COMMON,
  \"llm\":{\"properties\":{\"args_cleaned\":{\"type\":\"integer\"},\"args_cleaned_fields\":{\"type\":\"keyword\"},\"model_mismatch\":{\"type\":\"keyword\"},\"model\":{\"type\":\"keyword\"},\"endpoint\":{\"type\":\"keyword\"},
   \"prompt_tokens\":{\"type\":\"long\"},\"completion_tokens\":{\"type\":\"long\"},
   \"latency_ms\":{\"type\":\"long\"},\"total_duration_ns\":{\"type\":\"long\"},
   \"load_duration_ns\":{\"type\":\"long\"},\"prompt_eval_duration_ns\":{\"type\":\"long\"},
   \"eval_duration_ns\":{\"type\":\"long\"},\"schema_valid\":{\"type\":\"boolean\"},
   \"error\":{\"type\":\"keyword\"},\"retry_count\":{\"type\":\"short\"},
   \"admission\":{\"type\":\"keyword\"}}},
  \"memory\":{\"properties\":{\"cited_rule\":{\"type\":\"keyword\"},
   \"cited_fails\":{\"type\":\"integer\"},\"cited_reporters\":{\"type\":\"short\"},
   \"inherited\":{\"type\":\"boolean\"}}},
  \"prompt\":{\"properties\":{\"system_hash\":{\"type\":\"keyword\"},\"text\":{\"type\":\"text\"}}},
  \"response\":{\"properties\":{\"text\":{\"type\":\"text\"}}},
  \"messages\":{\"type\":\"flattened\"},\"tool_calls\":{\"type\":\"flattened\"},
  \"outcome\":{\"properties\":{\"status\":{\"type\":\"keyword\"},\"detail\":{\"type\":\"text\"}}}}}}}" >/dev/null
ok "mcai-llm-* template"

# DRIFT FOUND 2026-09-23, and this line is the fix. The LIVE mcai-mc template carried
# "index.default_pipeline":"mcai-paper" and this script did not -- nothing in the repo
# set it anywhere. So re-running this script, whose entire purpose is that rebuilding
# ELK is cheap, would have produced a cluster where every Paper document arrives
# UNPARSED: no mc.event, no mc.player, no mc.world, just `message`. And because these
# mappings are dynamic:false, nothing would have errored. mcai-mc is the only template
# with a default_pipeline -- the skill/llm/sys streams ship pre-structured JSONL and
# need none -- so this drift is scoped to exactly this one line.
q -XPUT "http://localhost:9200/_index_template/mcai-mc" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-mc-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS,\"index.default_pipeline\":\"mcai-paper\"},
  \"mappings\":{\"dynamic\":\"false\",\"properties\":{
  \"@timestamp\":{\"type\":\"date\"},\"message\":{\"type\":\"text\"},
  \"log\":{\"properties\":{\"level\":{\"type\":\"keyword\"},\"thread\":{\"type\":\"keyword\"}}},
  \"mc\":{\"properties\":{\"event\":{\"type\":\"keyword\"},\"player\":{\"type\":\"keyword\"},
   \"world\":{\"type\":\"keyword\"},\"time\":{\"type\":\"keyword\"},
   \"x\":{\"type\":\"float\"},\"y\":{\"type\":\"float\"},\"z\":{\"type\":\"float\"},
   \"dx\":{\"type\":\"float\"},\"dy\":{\"type\":\"float\"},\"dz\":{\"type\":\"float\"},
   \"death_cause\":{\"type\":\"keyword\"},
   \"lag_ms\":{\"type\":\"long\"},\"ticks_behind\":{\"type\":\"long\"},
   \"reason\":{\"type\":\"text\"},\"chat\":{\"type\":\"text\"}}},
  \"host\":{\"properties\":{\"name\":{\"type\":\"keyword\"}}}}}}}" >/dev/null
ok "mcai-mc-* template"

# Paper thread names contain slashes, so the level must be matched greedily
# from the RIGHT -- dissect splits on the first slash and mangles every record.
#
# The pipeline body lives in pipeline-mcai-paper.json rather than inline here,
# for two reasons. (1) It contains "Can't keep up!" -- an apostrophe, which the
# single-quoted `-d '...'` form this script uses for every other pipeline cannot
# carry. (2) It is now 30 processors and is TESTED: infra/elk/test-paper-pipeline.py
# replays a real corpus of Paper log lines through it via _ingest/pipeline/_simulate,
# which only works if the definition is a file both the applier and the test read.
#
# Measured 2026-09-23, why the classifiers exist. Across 829,661 archived log lines
# from 20 worlds (2026-08-21 -> 09-23) the events that were reaching Elasticsearch
# as an undifferentiated mc.event="warn"/"other" were: moved wrongly 50,260;
# "was kicked for floating too long" 3,638; deaths 3,193 across 10 distinct causes;
# moved too quickly 120; "Can't keep up" 102. None of those had a player attached
# and none had a WORLD attached, so on a 16-world fleet they were unattributable.
PIPE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
q -XPUT "http://localhost:9200/_ingest/pipeline/mcai-paper" \
  -H 'Content-Type: application/json' \
  --data-binary "@${PIPE_DIR}/pipeline-mcai-paper.json" >/dev/null
ok "mcai-paper ingest pipeline"
