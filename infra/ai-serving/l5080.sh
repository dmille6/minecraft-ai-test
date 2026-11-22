# usage: l5080.sh <np> <ctx_total> <kvtype>   start llama-server (Qwen3-8B Q4_K_M) on :18090
. /root/servea/env.sh
pkill -f "llama-server.*18090" ; sleep 2
cd /root/mcai-bench
LD_LIBRARY_PATH=$LLAMA_LIBS:$LLAMA_DIR nohup $LLAMA_DIR/llama-server -m Qwen3-8B-Q4_K_M.gguf --alias q8b -ngl 99 -fa on -np $1 -c $2 --cache-type-k $3 --cache-type-v $3 --jinja --reasoning off --no-webui --metrics --host 0.0.0.0 --port 18090 > l5080-$1-$3.log 2>&1 &
for i in $(seq 1 60); do curl -s -m 2 localhost:18090/health | grep -q ok && { echo up; nvidia-smi --query-gpu=memory.used --format=csv,noheader; exit 0; }; sleep 2; done; echo FAIL; tail -5 l5080-$1-$3.log
