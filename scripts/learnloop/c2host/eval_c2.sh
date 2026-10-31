#!/bin/bash
# eval_c2.sh -- candidate 2 on the 600-item m3-eval replay, run on 10.0.0.31 against the 3090's Ollama (eval config).
# SAME instrument as replay-cands-01 / blackwell-base-01: v0 m3-eval.jsonl, the fleet's own client (replay_client.mjs,
# bots-d014ec2cbd8b), T=0, concurrency 2, eval_offline.py. Every model goes through ONE think:false proxy (nothing
# else rewritten: this is what Ollama 0.33.2 does for qwen3.5 when think is unset, i.e. how the qwen35-01 canary and a
# candidate canary are served; blackwell-base-01 measured qwen3.5:9b this way). Coverage gate as run31.sh.
#   MODELS default: the fleet ref, the stock qwen3.5:9b (Q4_K_M, = the canary) and its q8_0, the untuned base through
#   OUR converter (q8_0), the candidate q8_0 (the artifact that would ship, owner A1) and bf16, and the candidate q8_0
#   AGAIN (the determinism control of the export check).
set -u
C=$HOME/learnloop/c2; H=$C/app/scripts/learnloop/train; B=$HOME/learnloop/replay/bots-d014ec2cbd8b/bots
I=$HOME/learnloop/datasets/v0/m3-eval.jsonl; O=${O:-$C/replay-c2-01}; U=http://10.0.0.16:11434
MODELS=${MODELS:-"qwen2.5:7b-instruct qwen3.5:9b qwen3.5:9b-q8_0 qwen35-9b-baseconv-q8 cand-qwen35-9b-c2-q8 cand-qwen35-9b-c2-bf16 cand-qwen35-9b-c2-q8@rep"}
mkdir -p "$O"; say(){ echo "$(date -u +%FT%TZ) $*"; }
cat > "$O/nothink.py" <<'PY'
import json, sys, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
UP = sys.argv[2]
class H(BaseHTTPRequestHandler):
    def _go(self, body=None):
        if body is not None and self.path.startswith('/api/chat'):
            j = json.loads(body); j['think'] = False; body = json.dumps(j).encode()
        req = urllib.request.Request(UP + self.path, data=body, method=self.command, headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r: code, data = r.status, r.read()
        except urllib.error.HTTPError as e: code, data = e.code, e.read()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self): self._go()
    def do_POST(self): self._go(self.rfile.read(int(self.headers.get('Content-Length', 0))))
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY
python3 "$O/nothink.py" 18450 "$U" & PX=$!; sleep 1; trap "kill $PX" EXIT
tags(){ curl -sf -m 10 $U/api/tags | python3 -c "import json,sys; print('\n'.join(m['name'] for m in json.load(sys.stdin)['models']))"; }
RUNS=(); REP=""
for spec in $MODELS; do
  m=${spec%@*}; suf=""; [ "$spec" != "$m" ] && suf="-${spec#*@}"
  tags | grep -qx "$m" || tags | grep -qx "$m:latest" || { say "MISSING $m on the 3090 -- not scored"; continue; }
  f=$O/$(echo "$m" | tr ':/' '__')-t0$suf.jsonl
  say "== replay $m$suf T=0 -> $f"
  LLM_TEMPERATURE=0 nice -n 19 node $H/replay_client.mjs "$B" "$I" "$f" http://127.0.0.1:18450 "$m" 2 > "$f.log" 2>&1 || { say "EXCLUDED $m: replay exit $?"; continue; }
  curl -sf -m 10 $U/api/ps | python3 -c "import json,sys; [print('  loaded', x['name'], 'vram %.1f/%.1f GiB' % (x.get('size_vram',0)/2**30, x.get('size',0)/2**30), '' if x.get('size_vram')==x.get('size') else 'PARTLY ON CPU') for x in json.load(sys.stdin)['models']]"
  python3 -c "
import json,sys
ids={json.loads(l)['id'] for l in open(sys.argv[2]) if l.strip()}
r={}
for l in open(sys.argv[1]):
    if l.strip():
        x=json.loads(l); r[x['id']]=x          # the client appends on resume: the last row per id counts
ok={i for i,x in r.items() if not x.get('transport_error')}
print('  answered', len(ok & ids), 'of', len(ids))
sys.exit(0 if ids <= ok else 1)" "$f" "$I" || { say "EXCLUDED $m$suf: incomplete coverage"; continue; }
  if [ -n "$suf" ]; then REP=$f; else RUNS+=("$f"); fi
done
[ ${#RUNS[@]} -ge 2 ] || { say "STOP: fewer than 2 runs"; exit 4; }
python3 "$H/eval_offline.py" --items "$I" --runs "${RUNS[@]}" --ref qwen2.5:7b-instruct --json "$O/scores.json" > "$O/scores.txt" 2>&1 \
  || { say "scoring FAILED"; exit 5; }
say "SCORED -> $O/scores.json"; say ALL-DONE
