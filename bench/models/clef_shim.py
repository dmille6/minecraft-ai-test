#!/usr/bin/env python3
"""A local /v1/systemone server around Cloudflare/clef-flash's OWN reference code (joint_schema_model.py from the
model repo: load_release_model + systemone), so systemone_engine.py's `http` backend replays the brain set on it.

    # on the Mac Studio, in the isolated venv (torch 2.11, transformers 5.10.2 = the model card's tested pair)
    PYTORCH_ENABLE_MPS_FALLBACK=1 ~/clef1029/venv/bin/python clef_shim.py --model-dir ~/clef1029/clef-flash \
        --device mps --dtype bfloat16 --port 18765
    python3 systemone_engine.py replay --items m3-eval.jsonl --out clef.jsonl --backend http \
        --url http://127.0.0.1:18765 --model clef-flash --concurrency 1

Nothing here re-implements the head: the request body goes to the repo's `systemone()` unchanged and its response
body comes back unchanged. The only choices made here are the device and dtype (the reference default is cuda,
bfloat16), and one request at a time (a single-threaded server: one forward pass on the GPU at once). Binds
127.0.0.1 only. Each request is logged with its input tokens and forward time.
"""
import argparse, json, os, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer


def load(model_dir, device, dtype_name):
    import torch
    sys.path.insert(0, model_dir)
    import joint_schema_model as J  # the model repo's own code, pinned by the download revision
    dtype = getattr(torch, dtype_name)
    model, processor = J.load_release_model(model_dir, device=device, dtype=dtype)
    return J, model, processor


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model-dir', required=True)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--dtype', default='bfloat16')
    ap.add_argument('--port', type=int, default=18765)
    ap.add_argument('--log', default=None)
    a = ap.parse_args()
    t0 = time.time()
    J, model, processor = load(os.path.expanduser(a.model_dir), a.device, a.dtype)
    import torch
    p = next(model.parameters())
    info = {'device': str(p.device), 'dtype': str(p.dtype), 'load_s': round(time.time() - t0, 1),
            'torch': torch.__version__, 'mps_fallback': os.environ.get('PYTORCH_ENABLE_MPS_FALLBACK')}
    print('loaded %s' % json.dumps(info), file=sys.stderr, flush=True)
    logf = open(a.log, 'a') if a.log else None

    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code, obj):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            self._send(200, dict(info, ok=True)) if self.path == '/health' else self._send(404, {'error': 'not found'})

        def do_POST(self):
            if self.path != '/v1/systemone':
                return self._send(404, {'error': 'not found'})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)))
                t = time.time()
                out = J.systemone(model, processor, body)
                ms = int((time.time() - t) * 1000)
            except ValueError as e:
                return self._send(400, {'error': str(e)[:500]})
            except Exception as e:
                return self._send(500, {'error': '%s: %s' % (type(e).__name__, str(e)[:500])})
            if logf:
                logf.write(json.dumps({'t': time.time(), 'ms': ms, 'input_tokens': out['usage']['input_tokens'],
                                       'questions': len(body.get('questions') or {})}) + '\n'); logf.flush()
            self._send(200, out)

    HTTPServer(('127.0.0.1', a.port), H).serve_forever()


if __name__ == '__main__':
    main()
