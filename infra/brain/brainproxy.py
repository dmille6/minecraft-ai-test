#!/usr/bin/env python3
"""brain-01 proxy, ON THE STUDIO: the fleet bots' Ollama /api/chat -> LM Studio's OpenAI API (gemma4 MLX 8-bit).

    python3 brainproxy.py --listen 127.0.0.1:11501 --upstream http://127.0.0.1:1234 --model brain \
        --serve-as gemma4:26b --max-inflight 12 --log ~/brain01/proxy.jsonl

Request:  {model, messages, format: <json schema>, options: {temperature, num_predict}, think?}
       -> {model: --model, messages, temperature, max_tokens: num_predict,
           response_format: {type: json_schema, json_schema: {strict: true, schema: format}},
           chat_template_kwargs: {enable_thinking: <think>} when think is a boolean}
Response: the Ollama fields llm.mjs reads. `model` is --serve-as ONLY when LM Studio says it served --model; anything
else is reported as `lmstudio:<what served>` so the bot's model_mismatch fires -- the row never claims gemma4 for
a decision some other model answered.

FAIL FAST, so the bot's fallback is deterministic: more than --max-inflight requests at once -> 503 at once (the
bot falls back to its local model instead of queueing behind the Studio); an upstream error or timeout -> 502.
Every request is one line in --log: t, status, ms, prompt/completion tokens, reasoning length, inflight, error.
GET /healthz answers 200 only when LM Studio lists --model as loaded.
DRILLS (sandbox only; inert unless --drill-dir is given): a file `hang` in that directory holds every request open
while it exists (a blackholed network, as the bot sees it), `delay` holds it for the number of seconds the file contains, `fail`
answers 502 (the model unloaded).
"""
import argparse, json, os, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

A = None
LOCK = threading.Lock()
STATE = {'inflight': 0}


def logline(**kw):
    if not A.log:
        return
    kw['t'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with LOCK:
        with open(A.log, 'a') as f:
            f.write(json.dumps(kw) + '\n')


def translate(req):
    """Ollama /api/chat body -> OpenAI chat body. Pure (tested)."""
    opt = req.get('options') or {}
    body = {'model': A.model if A else 'brain', 'messages': req.get('messages') or [], 'stream': False,
            'temperature': opt.get('temperature', 0.7), 'max_tokens': opt.get('num_predict', 512)}
    if isinstance(req.get('format'), dict):
        body['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': req['format']}}
    elif req.get('format') == 'json':
        body['response_format'] = {'type': 'json_object'}
    if isinstance(req.get('think'), bool):
        body['chat_template_kwargs'] = {'enable_thinking': req['think']}
    return body


def served_name(upstream_model, model, serve_as):
    """What the bot is told served it. Pure (tested). The pinned name ONLY on a positive match: an upstream reply that
    names no model is `lmstudio:unknown`, so the bot's model_mismatch fires (Codex r1: a missing identity was
    certified as gemma4)."""
    if upstream_model == model:
        return serve_as
    return 'lmstudio:%s' % (upstream_model or 'unknown')


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith('/api/version'):
            return self._send(200, {'version': 'brainproxy'})
        if self.path.startswith('/api/tags'):
            return self._send(200, {'models': [{'name': A.serve_as}]})
        if self.path.startswith('/healthz'):
            try:
                d = json.loads(urllib.request.urlopen(A.upstream.rstrip('/') + '/v1/models', timeout=5).read())
                ok = any(m.get('id') == A.model for m in d.get('data') or [])
            except Exception as e:
                return self._send(503, {'ok': False, 'error': str(e)[:200]})
            return self._send(200 if ok else 503, {'ok': ok, 'model': A.model})
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        try:
            req = json.loads(self.rfile.read(n))
        except ValueError:
            return self._send(400, {'error': 'bad json'})
        if not self.path.startswith('/api/chat'):
            return self._send(404, {'error': 'only /api/chat is proxied'})
        with LOCK:
            if STATE['inflight'] >= A.max_inflight:
                full = True
            else:
                full = False
                STATE['inflight'] += 1
            inflight = STATE['inflight']
        if full:
            logline(status=503, ms=0, inflight=inflight, error='saturated')
            return self._send(503, {'error': 'brainproxy saturated (%d in flight)' % A.max_inflight})
        t0 = time.time()
        if A.drill_dir:
            try:
                if os.path.exists(os.path.join(A.drill_dir, 'fail')):
                    with LOCK:
                        STATE['inflight'] -= 1
                    logline(status=502, ms=0, inflight=inflight, error='drill: fail')
                    return self._send(502, {'error': 'drill: model unloaded'})
                while os.path.exists(os.path.join(A.drill_dir, 'hang')):   # held until the drill ends
                    time.sleep(0.5)
                dp = os.path.join(A.drill_dir, 'delay')
                if os.path.exists(dp):
                    time.sleep(float(open(dp).read().strip() or 0))
            except (BrokenPipeError, ConnectionResetError):
                pass
        try:
            r = urllib.request.urlopen(urllib.request.Request(A.upstream.rstrip('/') + '/v1/chat/completions',
                                                              data=json.dumps(translate(req)).encode(),
                                                              headers={'Content-Type': 'application/json'}), timeout=A.timeout)
            d = json.loads(r.read())
        except Exception as e:
            logline(status=502, ms=int((time.time() - t0) * 1000), inflight=inflight, error=str(e)[:200])
            return self._send(502, {'error': 'upstream: %s' % str(e)[:200]})
        finally:
            with LOCK:
                STATE['inflight'] -= 1
        dt = time.time() - t0
        ch = (d.get('choices') or [{}])[0]
        msg = ch.get('message') or {}
        u = d.get('usage') or {}
        st = d.get('stats') or {}
        ttft = st.get('time_to_first_token') or 0
        served = served_name(d.get('model'), A.model, A.serve_as)
        logline(status=200, ms=int(dt * 1000), inflight=inflight, served=served, prompt_tokens=u.get('prompt_tokens'),
                completion_tokens=u.get('completion_tokens'), reasoning_len=len(msg.get('reasoning_content') or ''),
                finish=ch.get('finish_reason'), think=req.get('think'))
        self._send(200, {'model': served, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                         'message': {'role': 'assistant', 'content': msg.get('content') or ''},
                         'done': True, 'done_reason': ch.get('finish_reason') or 'stop',
                         'prompt_eval_count': u.get('prompt_tokens'), 'eval_count': u.get('completion_tokens'),
                         'total_duration': int(dt * 1e9), 'load_duration': 0,
                         'prompt_eval_duration': int(ttft * 1e9), 'eval_duration': int(max(0.0, dt - ttft) * 1e9)})


def main():
    global A
    ap = argparse.ArgumentParser()
    ap.add_argument('--listen', default='127.0.0.1:11501')
    ap.add_argument('--upstream', default='http://127.0.0.1:1234')
    ap.add_argument('--model', default='brain', help='the LM Studio identifier the model was loaded under')
    ap.add_argument('--serve-as', default='gemma4:26b', help='the name the bots pin (OLLAMA_BASE_URLS url|<this>|gemma4|ms)')
    ap.add_argument('--max-inflight', type=int, default=12)
    ap.add_argument('--timeout', type=float, default=60)
    ap.add_argument('--log', default=None)
    ap.add_argument('--drill-dir', default=None, help='SANDBOX DRILLS ONLY: see the module doc')
    A = ap.parse_args()
    host, port = A.listen.rsplit(':', 1)
    ThreadingHTTPServer((host, int(port)), H).serve_forever()


if __name__ == '__main__':
    main()
