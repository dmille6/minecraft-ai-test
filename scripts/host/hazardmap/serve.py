#!/usr/bin/env python3
"""serve.py -- the FORCED COMMAND of the hazard map's key on 10.0.0.30 (install-hazardmap.sh --on-30).

authorized_keys line (installed by install-hazardmap.sh --on-30):
    restrict,from="10.0.0.31",command="/usr/bin/python3 -I -B /home/mike/hazardmap/bin/serve.py" ssh-ed25519 AAAA... hazardmap

Whatever the client asks, sshd runs THIS with the request in SSH_ORIGINAL_COMMAND. It answers three requests; anything else
exits 2 with nothing written. It never runs sudo, a shell or another program.
    verify     the bytes of ~/hazardmap/out/verify.json (the newest verify run's answers; 10.0.0.30's cron writes it)
    status     one JSON line: whether verify.json and in/request.json exist, their sizes and mtimes
    request    reads a request document on STDIN (at most MAX_BYTES), validates it with hazardmap.validate_request(), and
               ONLY THEN writes it atomically to ~/hazardmap/in/request.json -- the one file this key can write. A bad request
               writes nothing and exits 2.
"""
import json
import os
import sys

HOME = os.path.expanduser('~')
BIN = os.path.join(HOME, 'hazardmap', 'bin')
OUT = os.path.join(HOME, 'hazardmap', 'out', 'verify.json')
REQ = os.path.join(HOME, 'hazardmap', 'in', 'request.json')
MAX_BYTES = 16 * 1024 * 1024


def emit(path, out):
    with open(path, 'rb') as f:
        out.write(f.read())
    return 0


def serve(req, stdin, stdout, out=OUT, reqp=REQ, validate=None):
    parts = (req or '').split()
    if parts == ['verify']:
        if not os.path.isfile(out):
            return 2
        return emit(out, stdout)
    if parts == ['status']:
        st = {}
        for k, p in (('verify', out), ('request', reqp)):
            st[k] = {'size': os.path.getsize(p), 'mtime': int(os.path.getmtime(p))} if os.path.isfile(p) else None
        stdout.write(json.dumps(st, sort_keys=True).encode() + b'\n')
        return 0
    if parts == ['request']:
        data = stdin.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            return 2
        try:
            doc = json.loads(data)
            validate(doc)
        except Exception:
            return 2
        os.makedirs(os.path.dirname(reqp), exist_ok=True)
        tmp = reqp + '.tmp.%d' % os.getpid()
        with open(tmp, 'wb') as f:
            f.write(json.dumps(doc, sort_keys=True, separators=(',', ':')).encode())
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, reqp)
        stdout.write(b'ok\n')
        return 0
    return 2


def _validator():
    sys.path.insert(0, BIN)
    import hazardmap
    return hazardmap.validate_request


if __name__ == '__main__':
    try:
        code = serve(os.environ.get('SSH_ORIGINAL_COMMAND', ''), sys.stdin.buffer, sys.stdout.buffer, validate=_validator())
    except Exception:
        code = 3
    sys.exit(code)
