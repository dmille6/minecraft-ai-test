#!/bin/bash
# lat_c2.sh -- the serving-latency comparison for candidate 2: the qwen35-01 capacity test (qwen35load.mjs: open-loop
# Poisson arrivals, the fleet's client and settings, T=0.7) at 20/min (1.5x the measured 10-bot rate) on the SAME 3090
# Ollama for the candidate q8_0 and the stock qwen3.5:9b tags, behind the same think:false proxy as the replay. The 3090
# shares its GPU with ethan-gpu, so absolute numbers are pessimistic next to the Blackwell (where qwen35-01 measured
# p50 1.44 s / p95 2.55 s live); the comparison that matters is candidate vs base on one server. 300 items each.
set -u
C=$HOME/learnloop/c2; O=$C/lat-c2-01; B=$HOME/learnloop/replay/bots-d014ec2cbd8b/bots; U=http://10.0.0.16:11434
mkdir -p $O; head -300 $HOME/learnloop/datasets/v0/m3-eval.jsonl > $O/items300.jsonl
python3 $C/replay-c2-01/nothink.py 18451 $U & PX=$!; sleep 1; trap "kill $PX" EXIT
for m in ${MODELS:-cand-qwen35-9b-c2-q8 qwen3.5:9b-q8_0 qwen3.5:9b}; do
  curl -s -m 120 http://127.0.0.1:18451/api/chat -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"stream\":false,\"options\":{\"num_predict\":1}}" >/dev/null   # warm load, not timed
  f=$O/$(echo $m | tr ':/' '__').jsonl
  echo "== $m $(date -u +%FT%TZ)"
  nice -n 10 node $C/qwen35load.mjs $B $O/items300.jsonl $f http://127.0.0.1:18451 $m 20 1031 2>&1 | tail -1
  python3 - "$f" <<'PY'
import json, sys, statistics
r = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
ok = [x for x in r if not x.get('transport_error') and x.get('schemaValid')]
L = sorted(x['latencyMs'] for x in ok); q = lambda p: L[min(len(L) - 1, int(p * len(L)))]
ct = sorted(x.get('completion_tokens') or 0 for x in ok)
print('  n %d valid %d transport_err %d | p50 %d p95 %d p99 %d ms | completion p95 %d' % (
    len(r), len(ok), sum(1 for x in r if x.get('transport_error')), q(.5), q(.95), q(.99), ct[int(.95 * len(ct))]))
PY
done
