#!/usr/bin/env python3
"""fmserve.py -- the FORCED COMMAND of the failmine read-only key on 10.0.0.30 (block2-worlds).

authorized_keys (installed by install-failmine.sh --on-30):
    restrict,from="10.0.0.31",command="/usr/bin/python3 -I -B /home/mike/failmine/bin/fmserve.py" ssh-ed25519 AAAA... failmine-pull

Whatever the client asks, sshd runs THIS with the request in SSH_ORIGINAL_COMMAND. It answers exactly two requests and
writes to stdout; anything else exits 2 with nothing written. It never writes, deletes or runs anything but `sudo -n cat`
and `sudo -n ls` on the nightly backup's STAGED COPY (/srv/world-backup/staging, root-only, so sudo), never a live world:
    meta                          JSON: the staging's backup day and, per world, seed, spawn, home and gamerules
    region <world> <rx> <rz> <gen> the staged copy of <world>/world/region/r.<rx>.<rz>.mca, byte for byte, where <gen> is
                                  meta's `backup_done` (the good line's timestamp): a region of any other night is refused
Both refuse (exit 4, nothing written) unless the newest `start <day>` line of the backup log is followed by its
`good <day>:` line: while a backup is writing the staging, a copy could be half of two nights. The state is read again
AFTER the bytes are read and before any is written (Codex r1 P1: a backup starting between the check and the read): a
changed state writes nothing.
"""
import gzip, json, os, re, struct, subprocess, sys

STAGING = '/srv/world-backup/staging'
LOG = '/var/log/mcai-monitor/world-backup.log'
WORLD_RE = re.compile(r'^(board|hive|isolated|placebo)-[a-d]$')
INT_RE = re.compile(r'^-?\d{1,3}$')          # region coordinates: |r| <= 999 (the border is 1950 blocks = r +-4)
GEN_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')


def sudo(args):
    r = subprocess.run(['sudo', '-n'] + args, capture_output=True, timeout=120)
    if r.returncode:
        raise OSError(f'sudo {args[0]} exited {r.returncode}')
    return r.stdout


def backup_state(log=LOG):
    """-> (day, good_iso) when the newest run is complete, else None."""
    try:
        lines = open(log, encoding='utf-8', errors='replace').read().splitlines()
    except OSError:
        return None
    start = None
    for i, ln in enumerate(lines):
        m = re.match(r'^(\S+) start (\d{4}-\d{2}-\d{2}):', ln)
        if m:     # ANY start, whatever world count it names, may be rewriting the staging (Codex r2 P1): it voids the last good
            start = (i, m.group(2))
    if not start:
        return None
    for ln in lines[start[0] + 1:]:
        m = re.match(r'^(\S+) good (\d{4}-\d{2}-\d{2}):', ln)
        if m and m.group(2) == start[1]:
            return start[1], m.group(1)
    return None


def read_nbt(b):
    i = 0

    def payload(t):
        nonlocal i
        if t == 1: v = struct.unpack_from('>b', b, i)[0]; i += 1; return v
        if t == 2: v = struct.unpack_from('>h', b, i)[0]; i += 2; return v
        if t == 3: v = struct.unpack_from('>i', b, i)[0]; i += 4; return v
        if t == 4: v = struct.unpack_from('>q', b, i)[0]; i += 8; return v
        if t == 5: v = struct.unpack_from('>f', b, i)[0]; i += 4; return v
        if t == 6: v = struct.unpack_from('>d', b, i)[0]; i += 8; return v
        if t == 7: n = struct.unpack_from('>i', b, i)[0]; i += 4; i += n; return None
        if t == 8: n = struct.unpack_from('>H', b, i)[0]; i += 2; v = b[i:i + n].decode('utf-8', 'replace'); i += n; return v
        if t == 9:
            et = b[i]; i += 1; n = struct.unpack_from('>i', b, i)[0]; i += 4
            return [payload(et) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = b[i]; i += 1
                if tt == 0: return d
                n = struct.unpack_from('>H', b, i)[0]; i += 2; k = b[i:i + n].decode('utf-8', 'replace'); i += n
                d[k] = payload(tt)
        if t == 11: n = struct.unpack_from('>i', b, i)[0]; i += 4 + 4 * n; return None
        if t == 12: n = struct.unpack_from('>i', b, i)[0]; i += 4 + 8 * n; return None
        raise ValueError(t)
    t = b[i]; i += 1
    n = struct.unpack_from('>H', b, i)[0]; i += 2 + n
    return payload(t)


def worlds():
    return sorted(w for w in sudo(['ls', STAGING]).decode().split() if WORLD_RE.match(w))


def meta(state):
    out = {'backup_day': state[0], 'backup_done': state[1], 'staging': STAGING, 'worlds': {}}
    for w in worlds():
        d = read_nbt(gzip.decompress(sudo(['cat', f'{STAGING}/{w}/world/level.dat'])))['Data']
        town = json.loads(sudo(['cat', f'{STAGING}/{w}/TOWN-PLACED.json']))
        out['worlds'][w] = {'seed': d['WorldGenSettings']['seed'], 'spawn': [d.get('SpawnX'), d.get('SpawnY'), d.get('SpawnZ')],
                            'home': town.get('home'), 'gamerules': town.get('gamerules') or {},
                            'version': (d.get('Version') or {}).get('Name'), 'data_version': d.get('DataVersion')}
    return out


def serve(req, out=None, state_fn=backup_state, worlds_fn=None, cat=None):
    out = out or sys.stdout.buffer
    parts = (req or '').split()
    if parts == ['meta']:
        st = state_fn()
        if not st:
            return 4
        body = json.dumps(meta(st)).encode()
        if state_fn() != st:
            return 4
        out.write(body)
        return 0
    if len(parts) == 5 and parts[0] == 'region' and WORLD_RE.match(parts[1]) and INT_RE.match(parts[2]) and INT_RE.match(parts[3]) \
            and GEN_RE.match(parts[4]):
        st = state_fn()
        if not st:
            return 4
        if st[1] != parts[4]:
            return 4                      # the staging is another night's now
        if parts[1] not in (worlds_fn or worlds)():
            return 2
        data = (cat or (lambda p: sudo(['cat', p])))(f'{STAGING}/{parts[1]}/world/region/r.{int(parts[2])}.{int(parts[3])}.mca')
        if state_fn() != st:
            return 4                      # a backup began (or finished) while we read: these bytes may be two nights
        out.write(data)
        return 0
    return 2


if __name__ == '__main__':
    try:
        code = serve(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    except Exception:
        code = 3
    sys.exit(code)
