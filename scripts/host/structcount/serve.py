#!/usr/bin/env python3
"""serve.py -- the FORCED COMMAND of the structcount read-only key on 10.0.0.30 (owner Q8, 10-23).

authorized_keys (installed by install-structcount-key.sh --on-30):
    restrict,from="10.0.0.31",command="/usr/bin/python3 -I -B /home/mike/structcount/bin/serve.py" ssh-ed25519 AAAA... structcount-pull

Whatever the client asks, sshd runs THIS, with the request in SSH_ORIGINAL_COMMAND. It answers exactly five requests and
writes the named file's bytes to stdout; anything else exits 2 with nothing written. It never writes, deletes or runs anything.
    manifest            ~/structcount/out/manifest.json
    attempt             ~/structcount/attempts/attempt.json
    day <gen>           ~/structcount/out/<gen>/structcount-day.json, only for the manifest's generation or its last_good
    census-name         the basename of the newest ~/chestclear3/census-goal-*.json
    census <name>       that file, only if it is one of the two newest census-goal files
"""
import glob
import json
import os
import re
import sys

HOME = os.path.expanduser('~')
OUT = os.path.join(HOME, 'structcount', 'out')
ATT = os.path.join(HOME, 'structcount', 'attempts')
CENSUS = os.path.join(HOME, 'chestclear3')
GEN_RE = re.compile(r'^gen-\d{8}T\d{6}\.\d{3}Z-\d+$')
CENSUS_RE = re.compile(r'^census-goal-\d{8}T\d{4}Z\.json$')


def emit(path):
    with open(path, 'rb') as f:
        sys.stdout.buffer.write(f.read())
    return 0


def serve(req, out=OUT, att=ATT, census=CENSUS):
    parts = (req or '').split()
    if parts == ['manifest']:
        return emit(os.path.join(out, 'manifest.json'))
    if parts == ['attempt']:
        return emit(os.path.join(att, 'attempt.json'))
    if len(parts) == 2 and parts[0] == 'day' and GEN_RE.match(parts[1]):
        m = json.load(open(os.path.join(out, 'manifest.json')))
        allowed = {m.get('generation'), (m.get('last_good') or {}).get('generation')} - {None}
        if parts[1] in allowed:
            return emit(os.path.join(out, parts[1], 'structcount-day.json'))
        return 2
    files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(census, 'census-goal-*.json'))
                   if CENSUS_RE.match(os.path.basename(p)))
    if parts == ['census-name'] and files:
        sys.stdout.write(files[-1] + '\n')
        return 0
    if len(parts) == 2 and parts[0] == 'census' and CENSUS_RE.match(parts[1]) and parts[1] in files[-2:]:
        return emit(os.path.join(census, parts[1]))
    return 2


if __name__ == '__main__':
    try:
        code = serve(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    except Exception:
        code = 3
    sys.exit(code)
