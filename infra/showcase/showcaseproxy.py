#!/usr/bin/env python3
"""SHOWCASE brain proxy, ON THE STUDIO (127.0.0.1:11502). The showcase bots' Ollama /api/chat ->
   primary:  LM Studio's OpenAI API, model `brain` (gemma4 26B MLX 8-bit, the model brain-01's keeper keeps loaded)
   fallback: the Studio's own Ollama, a qwen2.5 7B instruct (never a bench GPU)
   paused:   503 at once while a pause file exists (a live brain canary, a GPU reservation, the operator's OFF).

Derived from brain-01's ~/brain01/brainproxy.py (10-12; translate() and served_name() are its code). brain-01's proxy,
plist, tunnel and key are NOT touched: this is a separate file, process (com.mcai.showcase.proxy) and port.
Design: docs/reports/showcase-2026-10-20.md section 2.

    python3 showcaseproxy.py --listen 127.0.0.1:11502 --upstream http://127.0.0.1:1234 --model brain \
        --serve-as gemma4:26b --fallback http://127.0.0.1:11434 --fallback-model qwen2.5-7b-base:q8_0 \
        --max-inflight 10 --log ~/showcase/proxy.jsonl --default-think false \
        --pause-file ~/brain01/LIVE --pause-file ~/mbench/out/GPU_RESERVED --pause-file ~/showcase/OFF \
        --quiesced-file ~/showcase/QUIESCED

WHY PROXY-SIDE FALLBACK, NOT THE 3090. All 80 bench bots fall back to 10.0.0.16; it served 4,869 of 19,808 bench
decisions in the 3 h to 12:5xZ 10-20 (25 %). Ten showcase bots there would be a load change inside every canary's
control arm. The bots therefore list ONE endpoint (this proxy, through the tunnel) and this proxy falls back on the
Studio itself. When the Studio is unreachable the showcase bots make no LLM decisions (reflexes still run); the
bench is never touched.

PAUSED MEANS PAUSED. While any --pause-file exists every request is answered 503 before any model is called -- the
fallback is NOT used either, because the fallback runs on the same GPU a brain canary or a benchmark is measuring.
Requests already in flight finish (bounded by --timeout + --fallback-timeout). Once paused AND nothing is in flight,
the proxy writes --quiesced-file (removed when it resumes or work is in flight): the handshake a brain canary's
launch waits for (touch ~/brain01/LIVE, wait for ~/showcase/QUIESCED, then deploy).

Response model names are honest: `--serve-as` only when LM Studio says it served --model; the fallback reports
Ollama's own `model`; so the bot's model_mismatch marks every non-gemma decision.
GET /healthz: 200 only when not paused AND LM Studio lists --model; the body says why not.
"""
import argparse, json, os, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

A = None
LOCK = threading.Lock()
STATE = {'inflight': 0}


def logline(**kw):
    if not A or not A.log:
        return
    kw['t'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with LOCK:
        with open(A.log, 'a') as f:
            f.write(json.dumps(kw) + '\n')


def translate(req, model='brain', default_think=None):
    """Ollama /api/chat body -> OpenAI chat body. Pure (tested). default_think applies only when the request
    carries no boolean `think`."""
    opt = req.get('options') or {}
    body = {'model': model, 'messages': req.get('messages') or [], 'stream': False,
            'temperature': opt.get('temperature', 0.7), 'max_tokens': opt.get('num_predict', 512)}
    if isinstance(req.get('format'), dict):
        body['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': req['format']}}
    elif req.get('format') == 'json':
        body['response_format'] = {'type': 'json_object'}
    if isinstance(req.get('think'), bool):
        body['chat_template_kwargs'] = {'enable_thinking': req['think']}
    elif isinstance(default_think, bool):
        body['chat_template_kwargs'] = {'enable_thinking': default_think}
    return body


def served_name(upstream_model, model, serve_as):
    """What the bot is told served it. Pure (tested). The pinned name ONLY on a positive match."""
    if upstream_model == model:
        return serve_as
    return 'lmstudio:%s' % (upstream_model or 'unknown')


def paused(pause_files, exists=os.path.exists):
    """The first pause file present, or None. Pure given `exists` (tested)."""
    for p in pause_files or ():
        if exists(p):
            return p
    return None


def fallback_body(req, model):
    """The bot's own Ollama body, re-pointed at the fallback model. Pure (tested): nothing else is changed, so the
    fallback sees exactly what the bench's qwen sees (format schema, options incl. num_ctx, keep_alive)."""
    b = dict(req)
    b['model'] = model
    b['stream'] = False
    return b


def post_json(url, body, timeout):
    r = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(),
                                                      headers={'Content-Type': 'application/json'}), timeout=timeout)
    return json.loads(r.read())


def mark_quiesced():
    """Keep --quiesced-file true to the state: present iff paused and nothing in flight."""
    if not A.quiesced_file:
        return
    with LOCK:
        idle = STATE['inflight'] == 0
    try:
        if paused(A.pause_file) and idle:
            if not os.path.exists(A.quiesced_file):
                with open(A.quiesced_file, 'w') as f:
                    f.write(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
        elif os.path.exists(A.quiesced_file):
            os.remove(A.quiesced_file)
    except OSError:
        pass


def quiesce_loop():
    while True:
        mark_quiesced()
        time.sleep(2)


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
            return self._send(200, {'version': 'showcaseproxy'})
        if self.path.startswith('/api/tags'):
            return self._send(200, {'models': [{'name': A.serve_as}]})
        if self.path.startswith('/healthz'):
            p = paused(A.pause_file)
            with LOCK:
                inflight = STATE['inflight']
            if p:
                return self._send(503, {'ok': False, 'paused_by': p, 'inflight': inflight})
            try:
                d = json.loads(urllib.request.urlopen(A.upstream.rstrip('/') + '/v1/models', timeout=5).read())
                ok = any(m.get('id') == A.model for m in d.get('data') or [])
            except Exception as e:
                return self._send(503, {'ok': False, 'error': str(e)[:200], 'inflight': inflight})
            return self._send(200 if ok else 503, {'ok': ok, 'model': A.model, 'inflight': inflight})
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        try:
            req = json.loads(self.rfile.read(n))
        except ValueError:
            return self._send(400, {'error': 'bad json'})
        if not self.path.startswith('/api/chat'):
            return self._send(404, {'error': 'only /api/chat is proxied'})
        p = paused(A.pause_file)
        if p:
            logline(status=503, ms=0, inflight=STATE['inflight'], error='paused by %s' % p)
            return self._send(503, {'error': 'showcase brain paused (%s present)' % p})
        with LOCK:
            full = STATE['inflight'] >= A.max_inflight
            if not full:
                STATE['inflight'] += 1
            inflight = STATE['inflight']
        if full:
            logline(status=503, ms=0, inflight=inflight, error='saturated')
            return self._send(503, {'error': 'showcaseproxy saturated (%d in flight)' % A.max_inflight})
        t0 = time.time()
        try:
            primary_err = None
            try:
                d = post_json(A.upstream.rstrip('/') + '/v1/chat/completions',
                              translate(req, A.model, A.default_think), A.timeout)
            except Exception as e:
                primary_err = str(e)[:200]
            if primary_err is None:
                dt_ = time.time() - t0
                ch = (d.get('choices') or [{}])[0]
                msg = ch.get('message') or {}
                u = d.get('usage') or {}
                ttft = (d.get('stats') or {}).get('time_to_first_token') or 0
                served = served_name(d.get('model'), A.model, A.serve_as)
                logline(status=200, path='primary', ms=int(dt_ * 1000), inflight=inflight, served=served,
                        prompt_tokens=u.get('prompt_tokens'), completion_tokens=u.get('completion_tokens'),
                        reasoning_len=len(msg.get('reasoning_content') or ''), finish=ch.get('finish_reason'))
                return self._send(200, {'model': served, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                        'message': {'role': 'assistant', 'content': msg.get('content') or ''},
                                        'done': True, 'done_reason': ch.get('finish_reason') or 'stop',
                                        'prompt_eval_count': u.get('prompt_tokens'), 'eval_count': u.get('completion_tokens'),
                                        'total_duration': int(dt_ * 1e9), 'load_duration': 0,
                                        'prompt_eval_duration': int(ttft * 1e9),
                                        'eval_duration': int(max(0.0, dt_ - ttft) * 1e9)})
            # A pause that began while the primary was failing still stops the fallback.
            p = paused(A.pause_file)
            if p or not A.fallback:
                logline(status=502, path='primary', ms=int((time.time() - t0) * 1000), inflight=inflight,
                        error=primary_err, fallback='paused by %s' % p if p else 'none configured')
                return self._send(502, {'error': 'upstream: %s' % primary_err})
            t1 = time.time()
            try:
                d = post_json(A.fallback.rstrip('/') + '/api/chat', fallback_body(req, A.fallback_model),
                              A.fallback_timeout)
            except Exception as e:
                logline(status=502, path='fallback', ms=int((time.time() - t0) * 1000), inflight=inflight,
                        error='primary: %s | fallback: %s' % (primary_err, str(e)[:200]))
                return self._send(502, {'error': 'primary and fallback failed'})
            logline(status=200, path='fallback', ms=int((time.time() - t0) * 1000),
                    fallback_ms=int((time.time() - t1) * 1000), inflight=inflight, served=d.get('model'),
                    primary_error=primary_err, prompt_tokens=d.get('prompt_eval_count'),
                    completion_tokens=d.get('eval_count'))
            return self._send(200, d)
        finally:
            with LOCK:
                STATE['inflight'] -= 1


def main():
    global A
    ap = argparse.ArgumentParser()
    ap.add_argument('--listen', default='127.0.0.1:11502')
    ap.add_argument('--upstream', default='http://127.0.0.1:1234')
    ap.add_argument('--model', default='brain', help='the LM Studio identifier the keeper loads')
    ap.add_argument('--serve-as', default='gemma4:26b')
    ap.add_argument('--fallback', default=None, help='the Studio Ollama base URL; omit for no fallback')
    ap.add_argument('--fallback-model', default='qwen2.5-7b-base:q8_0')
    ap.add_argument('--max-inflight', type=int, default=10)
    ap.add_argument('--timeout', type=float, default=20, help='primary upstream budget (s)')
    ap.add_argument('--fallback-timeout', type=float, default=20, help='fallback budget (s); the sum stays under '
                    "the bot's LLM_TIMEOUT_MS (45 s)")
    ap.add_argument('--log', default=None)
    ap.add_argument('--default-think', choices=['true', 'false'], default=None)
    ap.add_argument('--pause-file', action='append', default=[], help='503 everything while this file exists')
    ap.add_argument('--quiesced-file', default=None)
    A = ap.parse_args()
    if A.default_think is not None:
        A.default_think = A.default_think == 'true'
    A.pause_file = [os.path.expanduser(p) for p in A.pause_file]
    if A.quiesced_file:
        A.quiesced_file = os.path.expanduser(A.quiesced_file)
    if A.log:
        A.log = os.path.expanduser(A.log)
    if A.timeout + A.fallback_timeout >= 45:
        raise SystemExit('timeout + fallback-timeout must stay under the bot LLM_TIMEOUT_MS (45 s)')
    threading.Thread(target=quiesce_loop, daemon=True).start()
    host, port = A.listen.rsplit(':', 1)
    ThreadingHTTPServer((host, int(port)), H).serve_forever()


if __name__ == '__main__':
    main()
