# serve5080.sh <gguf path> <alias>: llama-server on :18090, 8 slots x 4096, q8 KV cache, thinking off (the tuned profile)
. /root/servea/env.sh
pkill -f "[l]lama-server.*18090"; sleep 3
LD_LIBRARY_PATH=$LLAMA_LIBS:$LLAMA_DIR nohup $LLAMA_DIR/llama-server -m "$1" --alias "$2" -ngl 99 -fa on -np 8 -c 32768 \
  --cache-type-k q8_0 --cache-type-v q8_0 --jinja --reasoning off --no-webui --metrics --host 0.0.0.0 --port 18090 > /root/mcai-bench/serve-$2.log 2>&1 &
for i in $(seq 1 90); do curl -s -m 2 localhost:18090/health | grep -q ok && { echo up $2; exit 0; }; sleep 2; done; echo FAIL; tail -5 /root/mcai-bench/serve-$2.log
