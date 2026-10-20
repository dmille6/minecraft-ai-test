#!/usr/bin/env python3
"""SHOWCASE brain proxy, ON THE STUDIO (127.0.0.1:11502). The showcase bots' Ollama /api/chat ->
   primary:  LM Studio's OpenAI API, model `brain` (gemma4 26B MLX 8-bit, the model brain-01's keeper keeps loaded)
   fallback: the Studio's own Ollama, a qwen2.5 7B instruct (never a bench GPU)
   paused:   503 at once while a pause file exists (a live brain canary, a GPU reservation, the operator's OFF).

Derived from brain-01's ~/brain01/brainproxy.py (10-12; translate() and served_name() are its code). brain-01's proxy,
plist, tunnel and key are NOT touched: this is a separate file, process (com.mcai.showcase.proxy) and port.
Design: docs/reports/showcase-2026-10-20.md section 2.

    python3 showcaseproxy.py --listen 127.0.0.1:11502 --upstream http://127.0.0.1:1234 --model brain \
        --serve-as gemma4:26b --fallback http://127.0.0.1:11434 --fallback-model qwen2.5:7b-instruct \
        --max-inflight 10 --log ~/showcase/proxy.jsonl --default-think false \
        --pause-file ~/mbench/out/GPU_RESERVED --pause-file ~/brain01/LIVE --pause-file ~/showcase/OFF \
        --pause-dir ~/showcase/pause.d --quiesced-file ~/showcase/QUIESCED

WHY PROXY-SIDE FALLBACK, NOT THE 3090. 10.0.0.16 is the PRIMARY of the 20 *-d bench bots and the fallback of the
other 60; it served 24 % of bench decisions in the 6 h to 12:3xZ 10-20. Ten showcase bots there would be a load change
that differs between canary arms. The bots list ONE endpoint (this proxy, through the tunnel) and this proxy falls
back on the Studio itself (the bench's own model, qwen2.5:7b-instruct, on the Studio's Ollama). When the Studio is
unreachable the showcase bots make no LLM decisions (reflexes still run); the bench is never touched.

PAUSED MEANS PAUSED. While any pause source holds -- a --pause-file (GPU_RESERVED: brain-01's keeper during a brain
canary, every mbench run since run_model.sh/lms_factor.sh hold it; the operator's OFF), an entry in --pause-dir, or a
benchmark worker process (run_bench/throughput/serving/cl_run/cl_series .py, started by hand) -- every request is
answered 503 before any model is called; the fallback is NOT used either (same GPU). In-flight work finishes (bounded
by --timeout + --fallback-timeout); BEFORE THE HANDOFF, after --quiesce-grace seconds idle, it requires Ollama's
/api/ps to show the fallback model gone (one keep_alive-0 unload per pause) and `lms ps` to show `brain` IDLE, then
writes --quiesced-file naming each reservation (`RESV <token>`). That first ack is the HANDOFF: until admission
resumes, a new reservation set is acknowledged at once (nothing on the GPU is the showcase's). Admission resuming
ends the handoff under the admission lock. A consumer accepts only an ack newer than its reservation that names it.

Response model names are honest: `--serve-as` only when LM Studio says it served --model; the fallback reports
Ollama's own `model`; so the bot's model_mismatch marks every non-gemma decision.
GET /healthz: 200 only when not paused AND LM Studio lists --model; the body says why not.
"""
import argparse, json, os, re, subprocess, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

A = None
LOCK = threading.RLock()     # re-entrant: logline() takes it too
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


def paused(pause_files, exists=os.path.exists, pause_dir=None, listdir=os.listdir):
    """The first pause file present (or the first entry of --pause-dir), or None. Pure given the fs callables
    (tested). A GPU consumer that is not the keeper (an mbench run) drops a file in the pause dir, waits for
    QUIESCED, and removes its file when done -- see infra/showcase/studio-gpu-guard.sh."""
    for p in pause_files or ():
        if exists(p):
            return p
    if pause_dir:
        try:
            names = sorted(n for n in listdir(pause_dir) if not n.startswith('.'))
        except OSError:
            names = []
        if names:
            return os.path.join(pause_dir, names[0])
    return None


BENCH_PROC = re.compile(r'\b(run_bench|throughput|serving|cl_run|cl_series)\.py\b')


def bench_procs(ps_text, own_pid):
    """The first Studio benchmark worker in `ps -axo pid=,command=` output, or None. Pure (tested). The proxy's own
    process and anything mentioning showcaseproxy are never a match, so the matcher cannot match itself."""
    for line in ps_text.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit():
            continue
        pid, cmd = int(parts[0]), parts[1]
        if pid == own_pid or 'showcaseproxy' in cmd:
            continue
        if BENCH_PROC.search(cmd):
            return f'pid {pid}: {cmd[:120]}'
    return None


def quiesce_state(is_paused, inflight, idle_s, grace_s, fallback_resident, upstream_idle):
    """What the quiesce loop must do now. Pure (tested). -> 'resume' | 'wait' | 'unload' | 'ack'.
    FAIL CLOSED: QUIESCED is acknowledged only when paused, nothing in flight for >= grace_s, the fallback model the
    showcase loaded is CONFIRMED gone from Ollama's /api/ps (fallback_resident False), and LM Studio reports the
    `brain` model IDLE (`lms ps`: nothing generating -- an upstream generation the proxy gave up on is still work on the
    GPU). Unknown (None) counts as not confirmed."""
    if not is_paused:
        return 'resume'
    if inflight or idle_s < grace_s:
        return 'wait'
    if fallback_resident is not False:
        return 'unload'
    if upstream_idle is not True:
        return 'wait'
    return 'ack'


def lms_brain_idle(lms_ps_text, model='brain'):
    """From `lms ps` output: True if the row for `model` says IDLE, False if it shows another status, None if the
    model is not listed or the table is unreadable. A model that is NOT LOADED is idle by definition. Pure (tested)."""
    lines = [l for l in lms_ps_text.splitlines() if l.strip()]
    hdr = next((l for l in lines if l.split()[:1] == ['IDENTIFIER']), None)
    if hdr is None:
        return True if 'No models are currently loaded' in lms_ps_text else None
    for l in lines:
        f = l.split()
        if f and f[0] == model:
            return f[2] == 'IDLE' if len(f) > 2 else None
    return True


def ollama_resident(ps_json, model):
    """From Ollama's /api/ps: is `model` loaded? True / False, or None for a malformed answer (no `models` list) --
    unknown never acknowledges. Pure (tested)."""
    if not isinstance(ps_json, dict) or not isinstance(ps_json.get('models'), list):
        return None
    return any(isinstance(m, dict) and (m.get('name') == model or m.get('model') == model) for m in ps_json['models'])


def _head(p):
    try:
        with open(p, 'rb') as f:
            return f.read(256)
    except OSError:
        return None


def pause_signature(pause_files, pause_dir, bench_proc, stat=os.stat, listdir=os.listdir, head=_head):
    """Identity of the CURRENT reservations: each present file's (path, mtime_ns, size, first bytes) -- so a
    replacement reservation at the same path (`run-B` written 0.1 s after `run-A` was removed) is a new one -- plus
    the pause-dir entries the same way, plus the benchmark process. Pure given the fs callables (tested)."""
    def ident(p):
        try:
            s = stat(p)
            return (p, s.st_mtime_ns, s.st_size, head(p))
        except OSError:
            return None
    files = tuple(x for x in (ident(p) for p in pause_files or ()) if x)
    entries = ()
    if pause_dir:
        try:
            entries = tuple(x for x in (ident(os.path.join(pause_dir, n))
                                        for n in sorted(listdir(pause_dir)) if not n.startswith('.')) if x)
        except OSError:
            entries = ()
    return (files, entries, bench_proc)


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


def is_paused():
    return paused(A.pause_file, pause_dir=A.pause_dir) or STATE.get('bench_proc')


def poll_bench_procs():
    """A benchmark worker started outside run_model.sh (by hand) holds no reservation: pause on the process too."""
    try:
        out = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True, text=True, timeout=10).stdout
        STATE['bench_proc'] = bench_procs(out, os.getpid())
    except Exception:
        pass


def probe_upstreams():
    """-> (fallback_resident, upstream_idle); None where it could not be read (which never acknowledges). Ollama is
    ALWAYS probed: after a proxy restart nothing in memory says whether a fallback model is still loaded."""
    res = None
    if A.fallback:
        try:
            d = json.loads(urllib.request.urlopen(A.fallback.rstrip('/') + '/api/ps', timeout=5).read())
            res = ollama_resident(d, A.fallback_model)
        except urllib.error.URLError as e:
            # connection REFUSED = no Ollama server = nothing loaded; a timeout or other error stays unknown
            res = False if isinstance(getattr(e, 'reason', None), ConnectionRefusedError) else None
        except ConnectionRefusedError:
            res = False
        except Exception:
            res = None
    else:
        res = False
    idle = None
    try:
        p = subprocess.run([os.path.expanduser(A.lms), 'ps'], capture_output=True, text=True, timeout=15)
        idle = lms_brain_idle(p.stdout + p.stderr, A.model)
    except Exception:
        idle = None
    return res, idle


def ack_text(sig, now_s):
    """The acknowledgement, built FROM THE VALIDATED SIGNATURE (never from a fresh read of the files): one
    `RESV <token>` line per reservation in that signature (a pause file's first line; a pause-dir entry's name) and
    `PROC <process>`, so a consumer accepts only an ack that names ITS reservation, and a reservation that appeared
    after validation can never be named. Pure (tested)."""
    files, entries, proc = sig
    out = ['%s quiesced' % time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now_s))]
    for (_p, _m, _s, h) in files:
        first = (h or b'').decode(errors='replace').splitlines()
        out.append('RESV ' + (first[0].strip() if first else ''))
    for (p, _m, _s, _h) in entries:
        out.append('RESV ' + os.path.basename(p))
    if proc:
        out.append('PROC ' + proc)
    return '\n'.join(out) + '\n'


def withdraw_ack():
    try:
        if os.path.exists(A.quiesced_file):
            os.remove(A.quiesced_file)
    except OSError:
        pass


def mark_quiesced(now=None):
    """Keep --quiesced-file true to the state (see quiesce_state). Tested through its transitions."""
    if not A.quiesced_file:
        return
    now = now or time.time()
    sig = pause_signature(A.pause_file, A.pause_dir, STATE.get('bench_proc'))
    p = is_paused()
    with LOCK:
        if not p:
            # The pause is OVER: the next pause is a new epoch, with its own (single) unload.
            STATE['sig'], STATE['epoch_unloaded'], STATE['handed_off'] = None, False, False
            save_handoff(False)
            withdraw_ack()
            return
        changed = sig != STATE.get('sig')
        if changed:
            STATE['sig'], STATE['sig_t'] = sig, now
            withdraw_ack()
        inflight = STATE['inflight']
        idle_s = now - max(STATE.get('last_done', 0), STATE.get('sig_t', 0))
        if os.path.exists(A.quiesced_file) and not changed and not inflight:
            return    # acknowledged for THIS set of reservations; nothing of the showcase's has run since
        if STATE.get('handed_off') and not inflight:
            # The GPU was already handed over in THIS uninterrupted pause and admission has refused every request
            # since, so nothing on the GPU is the showcase's: a new reservation set (the next queue line, the final
            # Stage C tag, a new benchmark process) is acknowledged at once -- no grace, no probe, never an unload.
            publish_ack(sig, p)
            return
        if inflight or idle_s < A.quiesce_grace:
            return
    resident, idle = probe_upstreams()          # slow; outside the lock (requests are refused while paused anyway)
    act = quiesce_state(True, inflight, idle_s, A.quiesce_grace, resident, idle)
    if act == 'unload':
        # ONCE per uninterrupted PAUSE (not per reservation set: a pending -> final Stage C tag or a newly detected
        # benchmark process must not re-authorise it). A model still or again resident afterwards is someone else's:
        # it is never unloaded again, and no ack is given -- fail closed.
        if resident and not STATE.get('epoch_unloaded'):
            STATE['epoch_unloaded'] = True
            try:
                post_json(A.fallback.rstrip('/') + '/api/generate', {'model': A.fallback_model, 'keep_alive': 0}, 30)
                logline(status='unload', model=A.fallback_model, paused_by=p)
            except Exception as e:
                logline(status='unload-failed', model=A.fallback_model, error=str(e)[:200])
        elif resident:
            logline(status='ack-withheld', reason='fallback model resident after this pause\'s one unload: '
                                                  'another client loaded it', model=A.fallback_model)
        return
    if act != 'ack':
        return
    # FINAL VALIDATION AND PUBLICATION UNDER THE ADMISSION LOCK: a request is admitted (inflight += 1) only under this
    # lock and only after it re-checks the pause, so nothing can start between this check and the rename; and the ack
    # names exactly the validated signature.
    publish_ack(sig, p)


def publish_ack(sig, p):
    with LOCK:                                   # RLock: safe when called with the lock already held
        if STATE['inflight'] or pause_signature(A.pause_file, A.pause_dir, STATE.get('bench_proc')) != sig:
            return
        tmp = A.quiesced_file + '.tmp'
        with open(tmp, 'w') as f:
            f.write(ack_text(sig, time.time()))
        os.replace(tmp, A.quiesced_file)         # atomic: a consumer never reads half an acknowledgement
        # The GPU is handed over: from now until this pause ends, nothing the proxy sees on Ollama is the showcase's,
        # so unload eligibility CLOSES here even if no unload was needed (Codex r6).
        STATE['epoch_unloaded'] = True
        STATE['handed_off'] = True
        save_handoff(True)
    logline(status='quiesced', paused_by=p)


def handoff_path():
    return (A.quiesced_file + '.handoff') if A and A.quiesced_file else None


def save_handoff(on):
    """The handoff SURVIVES A PROXY RESTART: a file beside QUIESCED exists from the first ack of a pause until the
    pause ends (or admission resumes). Without it, a restart mid-pause would forget that the GPU was handed over and
    could unload a benchmark's model after the grace (Codex r8)."""
    hp = handoff_path()
    if not hp:
        return
    try:
        if on:
            with open(hp, 'w') as f:
                f.write(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
        elif os.path.exists(hp):
            os.remove(hp)
    except OSError:
        pass


def restore_handoff(paused_now):
    """At startup: a handoff file + a pause still in place = the GPU is still handed over -> fail closed (never
    unload; acknowledge new reservations at once). A handoff file with no pause = stale -> removed. Tested."""
    hp = handoff_path()
    if not hp or not os.path.exists(hp):
        return False
    if paused_now:
        STATE['handed_off'], STATE['epoch_unloaded'] = True, True
        logline(status='handoff-restored', paused_by=paused_now)
        return True
    save_handoff(False)
    return False


def admit():
    """ADMISSION: the pause check and the in-flight increment happen under ONE lock, the same lock under which
    mark_quiesced() validates and publishes an acknowledgement -- so a request can never start after an ack, and an
    admitted request always blocks the ack until it finishes. -> (paused_by, full, inflight). Tested."""
    with LOCK:
        p = is_paused()
        full = (not p) and STATE['inflight'] >= A.max_inflight
        if not p and STATE.get('handed_off'):
            # ADMISSION RESUMED: the pause is over even if the 2-s poll has not seen it yet. The handoff, the unload
            # epoch and the old acknowledgement all end HERE, under the admission lock, so a reservation that appears
            # before the next poll gets a fresh grace and fresh probes (Codex r7).
            STATE['handed_off'], STATE['epoch_unloaded'], STATE['sig'] = False, False, None
            save_handoff(False)
            withdraw_ack()
        if not p and not full:
            STATE['inflight'] += 1
        return p, full, STATE['inflight']


def finish():
    with LOCK:
        STATE['inflight'] -= 1
        STATE['last_done'] = time.time()


def quiesce_loop():
    while True:
        poll_bench_procs()
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
            p = is_paused()
            with LOCK:
                inflight = STATE['inflight']
            if p:
                since = STATE.get('sig_t')
                return self._send(503, {'ok': False, 'paused_by': p, 'inflight': inflight,
                                        'paused_since': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(since))
                                        if since else None,
                                        'quiesced': bool(A.quiesced_file and os.path.exists(A.quiesced_file))})
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
        p, full, inflight = admit()
        if p:
            logline(status=503, ms=0, inflight=inflight, error='paused by %s' % p)
            return self._send(503, {'error': 'showcase brain paused (%s present)' % p})
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
            p = is_paused()
            if p or not A.fallback:
                logline(status=502, path='primary', ms=int((time.time() - t0) * 1000), inflight=inflight,
                        error=primary_err, fallback='paused by %s' % p if p else 'none configured')
                return self._send(502, {'error': 'upstream: %s' % primary_err})
            t1 = time.time()
            with LOCK:
                STATE['fallback_loaded_by_us'] = True  # the showcase now holds the fallback model in memory
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
                STATE['last_done'] = time.time()


def main():
    global A
    ap = argparse.ArgumentParser()
    ap.add_argument('--listen', default='127.0.0.1:11502')
    ap.add_argument('--upstream', default='http://127.0.0.1:1234')
    ap.add_argument('--model', default='brain', help='the LM Studio identifier the keeper loads')
    ap.add_argument('--serve-as', default='gemma4:26b')
    ap.add_argument('--fallback', default=None, help='the Studio Ollama base URL; omit for no fallback')
    ap.add_argument('--fallback-model', default='qwen2.5:7b-instruct')
    ap.add_argument('--max-inflight', type=int, default=10)
    ap.add_argument('--timeout', type=float, default=20, help='primary upstream budget (s)')
    ap.add_argument('--fallback-timeout', type=float, default=20, help='fallback budget (s); the sum stays under '
                    "the bot's LLM_TIMEOUT_MS (45 s)")
    ap.add_argument('--log', default=None)
    ap.add_argument('--default-think', choices=['true', 'false'], default=None)
    ap.add_argument('--pause-file', action='append', default=[], help='503 everything while this file exists')
    ap.add_argument('--quiesced-file', default=None)
    ap.add_argument('--pause-dir', default=None, help='any entry in this directory pauses (mbench guard files)')
    ap.add_argument('--lms', default='~/.lmstudio/bin/lms', help='the LM Studio CLI (its `ps` shows IDLE/generating)')
    ap.add_argument('--quiesce-grace', type=float, default=30.0,
                    help='seconds with nothing in flight before QUIESCED is acknowledged')
    A = ap.parse_args()
    if A.default_think is not None:
        A.default_think = A.default_think == 'true'
    A.pause_file = [os.path.expanduser(p) for p in A.pause_file]
    if A.pause_dir:
        A.pause_dir = os.path.expanduser(A.pause_dir)
        os.makedirs(A.pause_dir, exist_ok=True)
    if A.quiesced_file:
        A.quiesced_file = os.path.expanduser(A.quiesced_file)
    if A.log:
        A.log = os.path.expanduser(A.log)
    if A.timeout + A.fallback_timeout >= 45:
        raise SystemExit('timeout + fallback-timeout must stay under the bot LLM_TIMEOUT_MS (45 s)')
    poll_bench_procs()
    restore_handoff(is_paused())
    threading.Thread(target=quiesce_loop, daemon=True).start()
    host, port = A.listen.rsplit(':', 1)
    ThreadingHTTPServer((host, int(port)), H).serve_forever()


if __name__ == '__main__':
    main()
