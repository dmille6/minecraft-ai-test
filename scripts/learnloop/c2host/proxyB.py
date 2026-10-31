#!/usr/bin/env python3
# learnloop c2 teacher proxy -> the 3090 Ollama; adds num_ctx 4096 + num_gpu 999 (27B fully on the GPU beside ethan-gpu).
# Forwards to the Blackwell Ollama; on /api/chat injects think:false (Ollama-native no-think, equivalent to the
# enable_thinking=False render nothink_template.py forces) and keep_alive 10m (client sends 30m). Nothing else changed.
import json, sys, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
UP = "http://ai.ticrcorp.com:11438"
class H(BaseHTTPRequestHandler):
    def _go(self, body=None):
        if body is not None and self.path.startswith("/api/chat"):
            j = json.loads(body); j["think"] = False; j.setdefault("options", {}); j["options"]["num_ctx"] = 4096; j["options"]["num_gpu"] = 999; j["keep_alive"] = "30m"; body = json.dumps(j).encode()
        req = urllib.request.Request(UP + self.path, data=body, method=self.command, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r: code, data = r.status, r.read()
        except urllib.error.HTTPError as e: code, data = e.code, e.read()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self): self._go()
    def do_POST(self): self._go(self.rfile.read(int(self.headers.get("Content-Length", 0))))
    def log_message(self, *a): pass
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
