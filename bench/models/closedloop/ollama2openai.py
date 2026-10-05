#!/usr/bin/env python3
"""Thin translating proxy: Ollama /api/chat (what the v1 bots speak) -> an OpenAI-compatible server (LM Studio).
BENCH/SANDBOX ONLY: lets the unchanged bot brain use an LM Studio model in Stage C. Never in the fleet path.

    python3 ollama2openai.py --listen 127.0.0.1:11501 --upstream http://127.0.0.1:1234 --model bench

Request:  {model, messages, format: <json schema>, options: {temperature, num_predict, num_ctx}, think?}
       -> {model: --model, messages, temperature, max_tokens: num_predict,
           response_format: {type: json_schema, json_schema: {name, strict: true, schema: format}}}
Response: {model, message: {role, content}, done: true, prompt_eval_count, eval_count, total_duration (ns),
           load_duration: 0, prompt_eval_duration, eval_duration}  -- the fields llm.mjs reads.
The requested model name is IGNORED (the upstream serves whatever is loaded as --model); the reply's `model`
says so ("lmstudio:<id>"), so the bots' logs record what really served the decision.
"""
import argparse, json, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

A = None


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
            return self._send(200, {'version': 'lmstudio-proxy'})
        if self.path.startswith('/api/tags'):
            return self._send(200, {'models': [{'name': 'lmstudio:' + A.model}]})
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        try:
            req = json.loads(self.rfile.read(n))
        except ValueError:
            return self._send(400, {'error': 'bad json'})
        if not self.path.startswith('/api/chat'):
            return self._send(404, {'error': 'only /api/chat is proxied'})
        opt = req.get('options') or {}
        body = {'model': A.model, 'messages': req.get('messages') or [], 'stream': False,
                'temperature': opt.get('temperature', 0.7), 'max_tokens': opt.get('num_predict', 512)}
        if isinstance(req.get('format'), dict):
            body['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': req['format']}}
        elif req.get('format') == 'json':
            body['response_format'] = {'type': 'json_object'}
        t0 = time.time()
        try:
            r = urllib.request.urlopen(urllib.request.Request(A.upstream.rstrip('/') + '/v1/chat/completions',
                                                              data=json.dumps(body).encode(),
                                                              headers={'Content-Type': 'application/json'}), timeout=A.timeout)
            d = json.loads(r.read())
        except Exception as e:
            return self._send(502, {'error': 'upstream: %s' % str(e)[:200]})
        dt = time.time() - t0
        ch = (d.get('choices') or [{}])[0]
        u = d.get('usage') or {}
        st = d.get('stats') or {}
        ttft = st.get('time_to_first_token') or 0
        out = {'model': 'lmstudio:' + A.model, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
               'message': {'role': 'assistant', 'content': (ch.get('message') or {}).get('content') or ''},
               'done': True, 'done_reason': ch.get('finish_reason') or 'stop',
               'prompt_eval_count': u.get('prompt_tokens'), 'eval_count': u.get('completion_tokens'),
               'total_duration': int(dt * 1e9), 'load_duration': 0,
               'prompt_eval_duration': int(ttft * 1e9), 'eval_duration': int(max(0.0, dt - ttft) * 1e9)}
        self._send(200, out)


def main():
    global A
    ap = argparse.ArgumentParser()
    ap.add_argument('--listen', default='127.0.0.1:11501')
    ap.add_argument('--upstream', default='http://127.0.0.1:1234')
    ap.add_argument('--model', default='bench')
    ap.add_argument('--timeout', type=float, default=300)
    A = ap.parse_args()
    host, port = A.listen.rsplit(':', 1)
    ThreadingHTTPServer((host, int(port)), H).serve_forever()


if __name__ == '__main__':
    main()
