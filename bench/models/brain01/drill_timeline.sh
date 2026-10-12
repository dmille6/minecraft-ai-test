#!/bin/bash
# brain-01 failure drills on the Studio, timed from the drill run's start (meta.json on the bots host).
# Each step is logged to the timeline file the analysis reads. Sandbox only: the proxy's --drill-dir hooks and
# a real proxy kill / LM Studio unload. Usage: drill_timeline.sh <run_id> <timeline.jsonl>
RUN=$1; OUT=$2; S='ssh -o BatchMode=yes mike@ai.ticrcorp.com'
until ssh -o BatchMode=yes mike@10.0.0.31 "test -f ~/mbench-cl/runs/$RUN/meta.json" </dev/null; do sleep 10; done
T0=$(date +%s)
mark() { echo "{\"t\":\"$(date -u +%FT%TZ)\",\"min\":$(( ($(date +%s)-T0)/60 )),\"event\":\"$1\"}" >> "$OUT"; }
at() { local w=$(( T0 + $1*60 - $(date +%s) )); [ $w -gt 0 ] && sleep $w; }
D='~/brain01/drill'
PROXY='cd ~/mbench && (nohup python3 brainproxy.py --listen 127.0.0.1:11501 --upstream http://127.0.0.1:1234 --model brain --serve-as gemma4:26b --max-inflight 12 --log ~/brain01/proxy.jsonl --drill-dir ~/brain01/drill > ~/brain01/proxy.out 2>&1 &)'
mark start
at 8;  $S "touch $D/hang" </dev/null;                         mark hang_on
at 11; $S "rm -f $D/hang" </dev/null;                         mark hang_off
at 14; $S "echo 20 > $D/delay" </dev/null;                    mark delay20_on
at 17; $S "rm -f $D/delay" </dev/null;                        mark delay20_off
at 20; $S "echo 8 > $D/delay" </dev/null;                     mark delay8_on
at 23; $S "rm -f $D/delay" </dev/null;                        mark delay8_off
at 26; $S "touch $D/fail" </dev/null;                         mark fail502_on
at 29; $S "rm -f $D/fail" </dev/null;                         mark fail502_off
at 32; $S "pkill -f '[b]rainproxy.py'" </dev/null;            mark proxy_killed
at 35; $S "$PROXY" </dev/null;                                mark proxy_restarted
at 37; $S "~/.lmstudio/bin/lms unload brain" </dev/null;     mark model_unloaded
at 40; $S "~/.lmstudio/bin/lms load gemma-4-26b-a4b-it@8bit -y --context-length 16384 --parallel 12 --identifier brain" </dev/null; mark model_reloaded
mark end
