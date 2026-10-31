#!/bin/bash
# Guarded Blackwell worker (learnloop c2): qwen3.8:27b labels the relabel pool from its END (relabel-pool.rev.jsonl)
# while the 3090 works from the start. It must never load the Blackwell during the qwen35-01 work (its load tests or
# its canary, which may be served from the Blackwell). Every 20 s it stops itself if ANY of these holds:
#   a qwen35load / nothinkproxy process runs on this host; the scheduler shows a running entry other than shaft-02;
#   the clock passes DEADLINE (default 02:15Z, before shaft-02 can close and free the slot); a STOPB file exists.
set -u
C=$HOME/learnloop/c2; H=$C/app/scripts/learnloop/train; B=$HOME/learnloop/replay/bots-d014ec2cbd8b/bots
DEADLINE=${DEADLINE:-2026-10-31T02:15:00Z}; DL=$(date -u -d "$DEADLINE" +%s)
say(){ echo "$(date -u +%FT%TZ) $*"; }
blocked(){
  [ -e $C/STOPB ] && { echo "STOPB file"; return 0; }
  [ "$(date -u +%s)" -ge "$DL" ] && { echo "deadline $DEADLINE"; return 0; }
  ps -eo args | grep -E "[q]wen35load|[n]othinkproxy|[q]wen35-01" >/dev/null && { echo "qwen35-01 test/proxy process running"; return 0; }
  # FAIL CLOSED (Claude review B2): an unreadable scheduler is a stop, not a clear
  local st; st=$(python3 $HOME/canary-sched.py status 2>/dev/null) || { echo "scheduler status failed"; return 0; }
  echo "$st" | grep -q "^DECISION:" || { echo "scheduler status has no DECISION line"; return 0; }
  r=$(echo "$st" | awk '$2=="running"||$2=="launching"{print $1}' | grep -v -x "shaft-02" | tr "\n" " ")
  [ -n "$r" ] && { echo "scheduler entry running/launching: $r"; return 0; }
  # the qwen35-01 model canary (served BY the Blackwell): any journal row for it at all is a stop
  grep -q '"run":"qwen35' $HOME/canary-journal.jsonl 2>/dev/null && { echo "qwen35 canary in the journal"; return 0; }
  [ -r $HOME/canary-journal.jsonl ] || { echo "journal unreadable"; return 0; }
  return 1
}
why=$(blocked) && { say "NOT STARTED: $why"; exit 0; }
python3 $C/proxyB.py 18442 & PX=$!
LLM_TEMPERATURE=0 nice -n 19 node $H/replay_client.mjs $B $C/data/v1/relabel-pool.rev.jsonl $C/labels-qwen3_8_27b-poolB.jsonl http://127.0.0.1:18442 qwen3.8:27b 2 > $C/poolB.client.log 2>&1 & W=$!
say "started worker $W proxy $PX deadline $DEADLINE"
while kill -0 $W 2>/dev/null; do
  if why=$(blocked); then say "STOP: $why"; kill $W; sleep 2; break; fi
  sleep 20
done
kill $PX 2>/dev/null
curl -s -m 10 http://ai.ticrcorp.com:11438/api/generate -d "{\"model\":\"qwen3.8:27b\",\"keep_alive\":0}" >/dev/null && say "asked the Blackwell to unload qwen3.8:27b"
say "done; labels $(wc -l < $C/labels-qwen3_8_27b-poolB.jsonl 2>/dev/null)"
