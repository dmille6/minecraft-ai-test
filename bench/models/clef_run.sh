#!/bin/bash
# The Clef-flash 600-item replay on the Mac Studio: shim (MPS, BF16) -> engine (http, concurrency 1) -> guard.
# Resumes: the engine skips ids already answered in $OUT. Writes $D/RUN.state: running | done | killed.
D=$HOME/clef1029; OUT=$D/clef-flash.jsonl; cd $D || exit 1
echo running > RUN.state
PYTORCH_ENABLE_MPS_FALLBACK=1 ./venv/bin/python clef_shim.py --model-dir $D/clef-flash --device mps --dtype bfloat16 \
  --port 18765 --log shim-req.jsonl >> shim.log 2>&1 &
SHIM=$!; echo $SHIM > shim.pid
for i in $(seq 90); do curl -s -m 2 127.0.0.1:18765/health >/dev/null && break; sleep 2; done
/usr/bin/python3 systemone_engine.py replay --items m3-eval.jsonl --out $OUT --backend http --url http://127.0.0.1:18765 \
  --model clef-flash --concurrency 1 --timeout 300 >> engine.log 2>&1 &
ENG=$!; echo $ENG > engine.pid
/usr/bin/python3 studio_guard.py --pid $SHIM --also-pid $ENG --log guard.jsonl >> guard.log 2>&1 &
GUARD=$!
wait $ENG; RC=$?
kill $SHIM 2>/dev/null; kill $GUARD 2>/dev/null; wait
if grep -q KILL guard.log 2>/dev/null && [ $RC -ne 0 ]; then echo killed > RUN.state; else echo "done rc=$RC" > RUN.state; fi
