#!/usr/bin/env python3
"""The TEST WORLD on block2-bots: a disposable copy of the showcase town where a release soaks before the showcase gets it.
Plan: docs/reports/testworld-plan-2026-11-18.md. Runbook: docs/runbooks/testworld.md. Runs as root, ON THAT HOST ONLY.

    testworld.py setup-world <incoming>/showcase   stop everything, keep the old copy under old/, restore this one
    testworld.py adopt-bundle <dir>                 take a staged showcase release's policy file and dependency tree (digests checked)
    testworld.py load <sha40> --archive FILE|-      build releases/<sha8>-<policy8>-<deps8>/ from `git archive <sha> bots/src bots/package.json`
    testworld.py activate <release>                 switch the harness; restart running bots 12 s apart; verify the version
    testworld.py start | stop ["why"] | status      the 14 bots (start runs the gate first)
    testworld.py sample                             one memory row per bot (the 5-minute timer)
    testworld.py guard                              the showcase's model p95 over the last 30 min; exit 1 over the limit
    testworld.py squeeze --minutes 15 --share 0.4   cut the slice's CPU to a share of what it used; always undone
    testworld.py pauses --rounds 6 --seconds 50     pause each bot long enough to miss its keepalive (the 11-18 failure)
    testworld.py soak --run NAME [--hours 3]        the whole read: 3 h untouched, the load step, then soakread.py

WHY A THIN COPY and not showcase_ops.py at a second root: that file holds its root, the mcshow@ unit name and the log paths
as constants on 58 lines, binds stage and activate to gates that are the showcase's own, and is tooling-protected. What must
not drift is shared instead: the env files come from infra/showcase/make_env.py `build_env`, and `src_digest` here is held
equal to showcase_ops.src_digest by the test.

THE IN-WORLD NAMES ARE THE SHOWCASE'S (showcase-Alpha ...; pool `showcase`): 33 source files switch a feature on by that
pool name, and the copied bags and records belong to those names. So everything here refuses to run on any host but
block2-bots and refuses an env that points anywhere but the test server on this host.
"""
import argparse, datetime as dt, fcntl, glob, hashlib, json, os, re, secrets, shutil, socket, subprocess, sys, tarfile, time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'infra', 'showcase'))     # in the repo; on the host make_env.py sits beside this file
import make_env as ME   # noqa: E402

HOST = 'block2-bots'
ROOT = '/srv/testworld'
SERVER = f'{ROOT}/server'
STATE = f'{ROOT}/state'
LOGS = f'{ROOT}/log'
RELEASES = f'{ROOT}/releases'
ARTIFACTS = f'{ROOT}/artifacts'
HARNESS = f'{ROOT}/harness'
OPS = f'{ROOT}/ops'
DEPLOY = f'{OPS}/deploy.jsonl'
SOAK = f'{ROOT}/soak'
SAMPLES = f'{SOAK}/samples.jsonl'
SITE = f'{ROOT}/town-site.json'
BRAIN_FILE = f'{ROOT}/BRAIN.json'
SECRET = f'{ROOT}/secrets/rcon.json'
MC_HOST, MC_PORT, RCON_PORT = '127.0.0.1', 25560, 25660
VIEWER_BASE = 3300                      # the showcase's are 3200+i
UNIT = 'mctest@'
SLICE = 'testworld.slice'
PAPER = 'testworld-paper.service'
# The 14 the showcase runs (control session 11-18); Nova, make_env's 15th name, stays out.
RUN_NAMES = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno', 'Kite', 'Lumen', 'Maple', 'Onyx']
BOTS = [ME.PREFIX + n for n in RUN_NAMES]
MIN_FREE = 15 * 2 ** 30                 # the loader and the world restore refuse below 15 GiB free
STAGGER_S = 12
GUARD_LIMIT_MS = 6000                   # the showcase's 30-minute model p95 (the 11-15 capacity read's limit)
GUARD_MIN_CALLS = 60                    # fewer answered calls in 30 min than this is "cannot see", not "fine"
GUARD_BLIND_MAX = 3                     # three blind checks in a row (30 min) stop the bots too: no telemetry is not no harm
ES_KEY = '/home/mike/.config/mcai/es-readonly.key'


# ------------------------------------------------------------------------------------------------ pure
def host_refusal(hostname):
    """-> None, or why nothing here may run on this host. Pure."""
    if hostname != HOST:
        return (f'REFUSED: this is {hostname!r}, not {HOST}. The test world\'s bots carry the showcase\'s in-world names; '
                f'they run on {HOST} only.')
    return None


def fleet_refusal(active_fleet_units):
    """-> None, or why the bots do not start while fleet bots run. Pure. With the fleet's 80 bots on the 5080 there is no
    model room (11-18: showcase p95 9.0 s in the hour before the stop), and 80 fleet bots are allowed 80 of this host's 96 GB."""
    if active_fleet_units:
        return (f'REFUSED: {len(active_fleet_units)} fleet bot unit(s) are active ({", ".join(sorted(active_fleet_units)[:3])} ...). '
                f'No model room and no RAM for both. Tell the control session what started them; do not stop them here.')
    return None


def src_digest_of(names_and_bytes):
    """showcase_ops.src_digest / config.mjs srcDigest(): sha256 over the sorted top-level *.mjs names + bytes, 6 hex. Pure."""
    h = hashlib.sha256()
    for name, data in sorted(names_and_bytes):
        h.update(name.encode())
        h.update(data)
    return h.hexdigest()[:6]


def src_digest(src):
    return src_digest_of((f, open(os.path.join(src, f), 'rb').read())
                         for f in os.listdir(src) if f.endswith('.mjs') and not f.startswith('.'))


def release_name(sha, policy, deps):
    return f'{sha[:8]}-{policy[:8]}-{deps[:8]}'


def env_rows(control, name, site, sha, brain):
    """The env file of one test bot -> [(key, value)]. make_env.build_env UNCHANGED, then the keys in OVERRIDES replaced:
    where it logs and keeps its records, its viewer port, and a RUN_ID that marks every row as the test world's. Refuses an
    env that points anywhere but the test server on this host. Pure."""
    i = ME.NAMES.index(name)
    rows = ME.build_env(control, i, site, sha, brain=brain)
    bot = ME.PREFIX + name
    over = {'LOG_DIR': f'{LOGS}/{bot}', 'STATE_DIR': f'{STATE}/{bot}', 'VIEWER_PORT': str(VIEWER_BASE + i),
            'RUN_ID': f'testworld-{sha[:8]}'}
    out = [(k, over.get(k, v)) for k, v in rows]
    got = dict(out)
    if set(over) - set(got):
        raise ValueError(f'make_env no longer writes {sorted(set(over) - set(got))}: the override table is stale')
    if got.get('MINECRAFT_HOST') != MC_HOST or got.get('MINECRAFT_PORT') != str(MC_PORT):
        raise ValueError(f'refusing: the env points at {got.get("MINECRAFT_HOST")}:{got.get("MINECRAFT_PORT")}, not the test '
                         f'server {MC_HOST}:{MC_PORT} (town-site.json must carry "port": {MC_PORT})')
    if got.get('MEMORY_POOL') != ME.LABEL or got.get('BOT_NAME') != bot:
        raise ValueError('refusing: pool or bot name is not the showcase\'s; the copied records would not be this bot\'s')
    return out


OVERRIDES = ('LOG_DIR', 'STATE_DIR', 'VIEWER_PORT', 'RUN_ID')


def server_properties(text, password):
    """The copied server.properties with the test world's ports, localhost only, and a NEW RCON password. Pure."""
    want = {'server-port': str(MC_PORT), 'server-ip': MC_HOST, 'rcon.port': str(RCON_PORT), 'rcon.password': password,
            'enable-rcon': 'true', 'enable-query': 'false', 'query.port': str(MC_PORT)}
    out, seen = [], set()
    for line in text.splitlines():
        k = line.split('=', 1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else None
        if k in want:
            out.append(f'{k}={want[k]}')
            seen.add(k)
        else:
            out.append(line)
    out += [f'{k}={v}' for k, v in want.items() if k not in seen]
    return '\n'.join(out) + '\n'


SECRET_KEY = re.compile(r'^(\s*)(secret|password|mineskinAPIKey)(\s*:\s*)(.*)$')


def scrub_yaml(text, make=lambda: secrets.token_hex(16)):
    """Every secret / password / API-key value in a copied YAML settings file replaced by a new random one (an empty
    value stays empty). The showcase's values never start a test server. Pure given `make`."""
    out = []
    for line in text.splitlines():
        m = SECRET_KEY.match(line)
        if m and m.group(4).strip() not in ('', "''", '""'):
            line = f"{m.group(1)}{m.group(2)}{m.group(3)}'{make()}'"
        out.append(line)
    return '\n'.join(out) + '\n'


def parse_show(text):
    """`systemctl show -p ...` text -> dict. Pure."""
    return dict(l.split('=', 1) for l in text.splitlines() if '=' in l)


def sample_row(t, bot, show, rss_kb=None):
    """One memory sample from a unit's `systemctl show`. MemoryCurrent of a stopped unit reads '[not set]': mem_mb None,
    never 0 (a bot that is down is not a bot using no memory). Pure."""
    def mb(v):
        return round(int(v) / 1048576, 1) if str(v).isdigit() else None
    return {'t': t, 'bot': bot, 'active': show.get('ActiveState') == 'active', 'mem_mb': mb(show.get('MemoryCurrent')),
            'peak_mb': mb(show.get('MemoryPeak')), 'restarts': int(show['NRestarts']) if str(show.get('NRestarts', '')).isdigit() else None,
            'pid': int(show['MainPID']) if str(show.get('MainPID', '')).isdigit() else None,
            'rss_mb': round(rss_kb / 1024, 1) if rss_kb else None}


def quota_pct(cpu_seconds_used, wall_seconds, share, floor_pct=50):
    """The squeeze: CPUQuota% = share of the CPU the slice really used (100% = one core), never under floor_pct. Pure."""
    if wall_seconds <= 0 or cpu_seconds_used < 0:
        raise ValueError('need a positive wall time and a CPU reading')
    return max(floor_pct, int(round(100.0 * cpu_seconds_used / wall_seconds * share)))


def pause_plan(bots, rounds, seconds, stagger=STAGGER_S, gap=120):
    """[(offset_s, bot, 'STOP'|'CONT')] sorted by time. In a round each bot is paused `seconds`, the bots `stagger` apart;
    the next round starts `gap` after the last bot of the round continues. `seconds` must exceed 45: the server asks every
    15 s and drops a client silent for 30, so a shorter pause can slip between two keepalives. Pure."""
    if seconds <= 45:
        raise ValueError('a pause of 45 s or less can miss no keepalive (15 s interval + 30 s timeout)')
    out, t0 = [], 0
    for _ in range(rounds):
        for i, b in enumerate(bots):
            out.append((t0 + i * stagger, b, 'STOP'))
            out.append((t0 + i * stagger + seconds, b, 'CONT'))
        t0 += (len(bots) - 1) * stagger + seconds + gap
    return sorted(out, key=lambda r: (r[0], r[2] == 'STOP'))


def guard_verdict(calls, p95_ms, limit=GUARD_LIMIT_MS, min_calls=GUARD_MIN_CALLS):
    """The showcase's model latency, last 30 min -> ('OK'|'TRIP'|'BLIND', why). BLIND is never OK. Pure."""
    if calls is None or p95_ms is None or calls < min_calls:
        return 'BLIND', f'only {calls} answered showcase model calls in 30 min (need {min_calls}): cannot see the showcase'
    if p95_ms > limit:
        return 'TRIP', f'showcase model p95 {p95_ms / 1000:.2f} s over 30 min ({calls} calls) is past {limit / 1000:.0f} s'
    return 'OK', f'showcase model p95 {p95_ms / 1000:.2f} s over 30 min ({calls} calls)'


def archive_commit(pax_headers):
    """The commit a `git archive <commit>` tar names in its global header, or None. Pure."""
    c = (pax_headers or {}).get('comment')
    return c if c and re.fullmatch(r'[0-9a-f]{40}', c) else None


# ------------------------------------------------------------------------------------------------ host helpers
def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def iso(t=None):
    return (t or now_utc()).strftime('%Y-%m-%dT%H:%M:%SZ')


def journal(event, **fields):
    os.makedirs(OPS, exist_ok=True)
    with open(DEPLOY, 'a') as f:
        f.write(json.dumps({'t': iso(), 'event': event, **fields}) + '\n')


def sh(*cmd, check=True, **kw):
    return subprocess.run(list(cmd), capture_output=True, text=True, check=check, **kw)


def lock():
    f = open(f'{ROOT}/ops.lock', 'a')
    fcntl.flock(f, fcntl.LOCK_EX)
    return f


def guard_host():
    why = host_refusal(socket.gethostname())
    if why:
        print(why)
        sys.exit(2)
    if os.geteuid() != 0:
        print('REFUSED: run as root (sudo)')
        sys.exit(2)


def active_units(pattern):
    out = sh('systemctl', 'list-units', pattern, '--state=active', '--no-legend', '--plain', check=False).stdout
    return [l.split()[0] for l in out.splitlines() if l.strip()]


def running_bots():
    return [u[len(UNIT):-len('.service')] for u in active_units(f'{UNIT}*')]


def rcon(cmd):
    from rcon import Rcon
    s = json.load(open(SECRET))
    r = Rcon(MC_HOST, int(s['port']), s['password'])
    try:
        return r.run(cmd)
    finally:
        r.sock.close()


def players():
    """Who the SERVER says is connected (the one layer that cannot report itself healthy)."""
    out = rcon('list')
    names = out.split(':', 1)[1] if ':' in out else ''
    return sorted(n.strip() for n in names.split(',') if n.strip())


def current_release():
    try:
        return json.load(open(os.path.join(os.path.realpath(HARNESS), 'RELEASE.json')))
    except (OSError, ValueError):
        return None


def tree_digest(root):
    """infra/showcase/showcase-feed.py tree_digest (the content identity of an installed dependency tree), 16 hex."""
    h = hashlib.sha256()
    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fn in sorted(filenames + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]):
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root)
            if os.path.islink(p):
                h.update(f'L\0{rel}\0{os.readlink(p)}\n'.encode())
            else:
                fh = hashlib.sha256()
                with open(p, 'rb') as f:
                    for chunk in iter(lambda: f.read(1 << 20), b''):
                        fh.update(chunk)
                h.update(f'F\0{rel}\0{fh.hexdigest()}\n'.encode())
            n += 1
    return h.hexdigest()[:16] if n else None


def newest_row(path):
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 65536))
            for line in reversed(f.read().splitlines()):
                try:
                    return json.loads(line)
                except ValueError:
                    continue
    except OSError:
        return None


def row_time(r):
    try:
        return dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


def verify(bots, expected, since_epoch, wait_s=600):
    """Every bot: a skill row on the expected version and an llm row, both newer than `since_epoch`. -> {bot: why} of the bad."""
    deadline = time.time() + wait_s
    while True:
        bad = {}
        for b in bots:
            s, l = newest_row(f'{LOGS}/{b}/skill-{b}.jsonl'), newest_row(f'{LOGS}/{b}/llm-{b}.jsonl')
            if not s or (row_time(s) or 0) < since_epoch:
                bad[b] = 'no fresh skill row'
            elif (s.get('code') or {}).get('version') != expected:
                bad[b] = f'on {(s.get("code") or {}).get("version")}'
            elif not l or (row_time(l) or 0) < since_epoch:
                bad[b] = 'no fresh llm row'
        if not bad or time.time() > deadline:
            return bad
        time.sleep(15)


def free_bytes(path=ROOT):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize


# ------------------------------------------------------------------------------------------------ world
def cmd_setup_world(a):
    guard_host()
    lk = lock()   # noqa: F841
    src = os.path.abspath(a.source)
    for need in ('world/level.dat', 'server.properties', 'state/_pool-showcase', 'meta/town-site.json'):
        if not os.path.exists(os.path.join(src, need)):
            print(f'REFUSED: {src} has no {need}: not a showcase nightly copy')
            return 1
    if free_bytes() < MIN_FREE:
        print(f'REFUSED: {free_bytes() / 2 ** 30:.1f} GiB free, under 15: nothing restored')
        return 1
    if running_bots():
        _stop('world refresh')
    sh('systemctl', 'stop', PAPER, check=False)
    stamp = now_utc().strftime('%Y%m%dT%H%M%SZ')
    kept = None
    if os.path.isdir(SERVER) or os.listdir(STATE):
        kept = f'{ROOT}/old/{stamp}'
        os.makedirs(kept)
        if os.path.isdir(SERVER):
            os.rename(SERVER, f'{kept}/server')
        os.rename(STATE, f'{kept}/state')
        os.makedirs(STATE)
    # the server folder: the copy minus the bots' records and the journals, plus the Paper runtime the backup leaves out
    sh('rsync', '-a', '--exclude=/state/', '--exclude=/meta/', src + '/', SERVER + '/')
    sh('rsync', '-a', f'{ROOT}/runtime/', SERVER + '/')
    sh('rsync', '-a', src + '/state/', STATE + '/')
    password = secrets.token_hex(24)
    p = f'{SERVER}/server.properties'
    open(p, 'w').write(server_properties(open(p).read(), password))
    for y in ('config/paper-global.yml', 'plugins/SkinsRestorer/config.yml'):
        if os.path.exists(f'{SERVER}/{y}'):
            open(f'{SERVER}/{y}', 'w').write(scrub_yaml(open(f'{SERVER}/{y}').read()))
    os.makedirs(os.path.dirname(SECRET), exist_ok=True)
    fd = os.open(SECRET, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'host': MC_HOST, 'port': RCON_PORT, 'password': password}, f)
    site = json.load(open(f'{src}/meta/town-site.json'))
    site['port'] = MC_PORT
    json.dump(site, open(SITE, 'w'))
    sh('chown', '-R', 'minecraft:minecraft', SERVER)
    sh('chmod', '-R', 'o-rwx', SERVER)
    sh('chown', '-R', 'mcbot:mcbot', STATE)
    for b in BOTS:
        os.makedirs(f'{LOGS}/{b}', exist_ok=True)
        shutil.chown(f'{LOGS}/{b}', 'mcbot', 'mcbot')
    level = dt.datetime.fromtimestamp(os.path.getmtime(f'{src}/world/level.dat'), dt.timezone.utc)
    sh('systemctl', 'start', PAPER)
    ok = False
    for _ in range(60):
        time.sleep(5)
        try:
            who = players()
            ok = True
            break
        except Exception:
            continue
    journal('world-restored', source=src, copy_saved_at=iso(level), kept_old=kept, server_up=ok)
    print(f'RESTORED the copy saved {iso(level)} into {SERVER}; old copy kept at {kept}; '
          + (f'server answering, {len(who)} players' if ok else 'SERVER NOT ANSWERING after 5 min: journalctl -u ' + PAPER))
    return 0 if ok else 1


# ------------------------------------------------------------------------------------------------ releases
def write_envs(release_dir, rel):
    control = ME.parse_env(open(f'{release_dir}/control.env').read())
    site = json.load(open(SITE))
    brain = ME.load_brain(BRAIN_FILE)
    built = [(n, env_rows(control, n, site, rel['sha'], brain)) for n in RUN_NAMES]     # all built before one is written
    os.makedirs(f'{release_dir}/env', exist_ok=True)
    for n, rows in built:
        p = f'{release_dir}/env/{ME.PREFIX}{n}.env'
        with open(p + '.tmp', 'w') as f:
            f.write('\n'.join(f'{k}={v}' for k, v in rows) + '\n')
        os.chmod(p + '.tmp', 0o644)
        os.replace(p + '.tmp', p)


def cmd_load(a):
    guard_host()
    lk = lock()   # noqa: F841
    sha = a.sha
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        print('REFUSED: the sha must be 40 hex')
        return 1
    pol = json.load(open(f'{OPS}/policy.json'))          # {"policy": <16 hex>, "deps": <16 hex>, "package_sha256": ...}
    name = release_name(sha, pol['policy'], pol['deps'])
    dst = f'{RELEASES}/{name}'
    if os.path.exists(f'{dst}/RELEASE.json'):
        print(f'ALREADY LOADED {dst}')
        return 0
    if free_bytes() < MIN_FREE:
        print(f'REFUSED: {free_bytes() / 2 ** 30:.1f} GiB free, under 15')
        return 1
    tmp = f'{RELEASES}/.load-{os.getpid()}'
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    try:
        tf = tarfile.open(fileobj=sys.stdin.buffer if a.archive == '-' else open(a.archive, 'rb'), mode='r|*')
        members = []
        for m in tf:
            if not (m.name == 'bots/package.json' or m.name.startswith('bots/src/') or m.name in ('bots', 'bots/src')):
                raise ValueError(f'the archive holds {m.name}: expected only bots/src and bots/package.json')
            if m.issym() or m.islnk() or '..' in m.name.split('/'):
                raise ValueError(f'the archive holds a link or a path that climbs: {m.name}')
            m.name = m.name[len('bots/'):] if m.name.startswith('bots/') else m.name
            if m.name and m.name != 'bots':
                tf.extract(m, tmp, filter='data')
                members.append(m.name)
        got = archive_commit(tf.pax_headers)
        if got != sha:
            raise ValueError(f'the archive is of commit {got}, not {sha} (make it with `git archive {sha} bots/src bots/package.json`)')
        pkg = hashlib.sha256(open(f'{tmp}/package.json', 'rb').read()).hexdigest()
        if pkg != pol['package_sha256']:
            raise ValueError('bots/package.json differs from the one the dependency bundle was built for: this candidate '
                             'needs its own bundle (ask the control session for the staged release\'s node_modules)')
        os.symlink(f'{ARTIFACTS}/node_modules-{pol["deps"]}', f'{tmp}/node_modules')
        shutil.copy(f'{OPS}/policy-{pol["policy"]}.env', f'{tmp}/control.env')
        rel = {'sha': sha, 'policy': pol['policy'], 'deps': pol['deps'], 'expected_version': f'{sha}+{src_digest(tmp + "/src")}',
               'loaded_at': iso(), 'files': len(members)}
        write_envs(tmp, rel)
        json.dump(rel, open(f'{tmp}/RELEASE.json', 'w'), indent=1)
        sh('chmod', '-R', 'a+rX', tmp)
        os.rename(tmp, dst)
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        journal('load-failed', sha=sha, error=str(e)[:300])
        print(f'FAILED: {e}')
        return 1
    journal('loaded', release=name, **rel)
    print(f'LOADED {dst} expected_version {rel["expected_version"]}')
    return 0


def policy_digest(control):
    """followrule.digest of the policy knobs (the control env minus the keys the showcase sets itself), 16 hex. Pure."""
    pol = ME.policy_of(control)
    return hashlib.sha256('\n'.join(f'{k}={v}' for k, v in sorted(pol.items())).encode()).hexdigest()[:16]


def cmd_adopt_bundle(a):
    """Take the policy file and the dependency tree of a release the showcase staged (a folder holding its RELEASE.json,
    control.env, package.json and node_modules/), after checking both against the digests that release recorded."""
    guard_host()
    lk = lock()   # noqa: F841
    d = os.path.abspath(a.dir)
    rel = json.load(open(f'{d}/RELEASE.json'))
    got_pol = policy_digest(ME.parse_env(open(f'{d}/control.env').read()))
    if got_pol != rel['policy']:
        print(f'REFUSED: control.env digests to {got_pol}, the release recorded {rel["policy"]}')
        return 1
    got_deps = tree_digest(f'{d}/node_modules')
    if got_deps != rel['deps']:
        print(f'REFUSED: node_modules digests to {got_deps}, the release recorded {rel["deps"]}')
        return 1
    dst = f'{ARTIFACTS}/node_modules-{rel["deps"]}'
    if not os.path.isdir(dst):
        sh('rsync', '-a', f'{d}/node_modules/', dst + '.part/')
        sh('chown', '-R', 'root:root', dst + '.part')
        sh('chmod', '-R', 'a+rX,go-w', dst + '.part')
        os.rename(dst + '.part', dst)
    shutil.copy(f'{d}/control.env', f'{OPS}/policy-{rel["policy"]}.env')
    os.chmod(f'{OPS}/policy-{rel["policy"]}.env', 0o644)
    pkg = hashlib.sha256(open(f'{d}/package.json', 'rb').read()).hexdigest()
    json.dump({'policy': rel['policy'], 'deps': rel['deps'], 'package_sha256': pkg, 'from_release': rel.get('sha'), 'adopted_at': iso()},
              open(f'{OPS}/policy.json', 'w'), indent=1)
    journal('bundle-adopted', policy=rel['policy'], deps=rel['deps'], from_release=rel.get('sha'))
    print(f'ADOPTED policy {rel["policy"]} and dependency tree {rel["deps"]} (both match the release\'s record)')
    return 0


def cmd_activate(a):
    guard_host()
    lk = lock()   # noqa: F841
    rd = a.release if os.path.isabs(a.release) else f'{RELEASES}/{a.release}'
    rel = json.load(open(f'{rd}/RELEASE.json'))
    write_envs(rd, rel)                       # the env files follow the brain setting and the site file as they are now
    prev = os.path.realpath(HARNESS) if os.path.islink(HARNESS) else None
    tmp = HARNESS + '.new'
    if os.path.lexists(tmp):
        os.remove(tmp)
    os.symlink(rd, tmp)
    os.replace(tmp, HARNESS)
    bots = running_bots()
    journal('activated', release=os.path.basename(rd), previous=os.path.basename(prev) if prev else None, running_bots=len(bots))
    if not bots:
        print(f'ACTIVATED {os.path.basename(rd)} (no bot running: `start` verifies them)')
        return 0
    t0 = time.time()
    for b in bots:
        sh('systemctl', 'restart', f'{UNIT}{b}', check=False)
        time.sleep(STAGGER_S)
    bad = verify(bots, rel['expected_version'], t0)
    journal('activate-verified' if not bad else 'activate-failed', release=os.path.basename(rd), bad=bad)
    print(f'ACTIVATED + VERIFIED on {len(bots)} bots' if not bad else f'ACTIVATED but NOT VERIFIED: {bad}')
    return 1 if bad else 0


def brain_health():
    b = ME.load_brain(BRAIN_FILE)
    try:
        with urllib.request.urlopen(b['url'] + '/api/tags', timeout=15) as r:
            tags = json.load(r)
        names = [m.get('name') for m in tags.get('models') or []]
        return (b['model'] in names), f"{b['url']} lists {b['model']}: {b['model'] in names}"
    except Exception as e:
        return False, f"{b['url']} did not answer ({type(e).__name__})"


def gate():
    """-> [why ...], empty when the bots may start."""
    bad = []
    f = fleet_refusal(active_units('mcbot@*'))
    if f:
        bad.append(f)
    rel = current_release()
    if not rel:
        bad.append('no release is active: `load` then `activate` one')
    else:
        rd = os.path.realpath(HARNESS)
        for b in BOTS:
            env = ME.parse_env(open(f'{rd}/env/{b}.env').read()) if os.path.exists(f'{rd}/env/{b}.env') else {}
            if env.get('MINECRAFT_HOST') != MC_HOST or env.get('MINECRAFT_PORT') != str(MC_PORT) or env.get('LOG_DIR') != f'{LOGS}/{b}':
                bad.append(f'{b}: its env file is missing or does not point at the test server and the test folders')
                break
    try:
        who = players()
        stray = [p for p in who if p not in BOTS]
        if stray:
            bad.append(f'the server lists players that are not test bots: {stray}')
    except Exception as e:
        bad.append(f'the test server does not answer RCON ({type(e).__name__}): systemctl status {PAPER}')
    ok, why = brain_health()
    if not ok:
        bad.append('model: ' + why)
    if free_bytes() < MIN_FREE:
        bad.append(f'{free_bytes() / 2 ** 30:.1f} GiB free, under 15')
    return bad


def _stop(why):
    for b in BOTS:
        if sh('systemctl', 'is-active', '--quiet', f'{UNIT}{b}', check=False).returncode == 0:
            # a paused bot would never see the stop: continue it first
            sh('systemctl', 'kill', '--signal=SIGCONT', f'{UNIT}{b}', check=False)
            sh('systemctl', 'disable', '--now', f'{UNIT}{b}', check=False)
    journal('stop-bots', why=why)


def cmd_stop(a):
    guard_host()
    lk = lock()   # noqa: F841
    _stop(a.why)
    print(f'stopped ({a.why}); running now: {len(running_bots())}')
    return 0


def cmd_start(a):
    guard_host()
    lk = lock()   # noqa: F841
    bad = gate()
    if bad:
        for w in bad:
            print('GATE: ' + w)
        journal('start-refused', why=bad)
        return 1
    rel = current_release()
    t0 = time.time()
    journal('start-requested', release=os.path.basename(os.path.realpath(HARNESS)))
    for b in BOTS:
        sh('systemctl', 'start', f'{UNIT}{b}', check=False)        # start, never enable: a reboot does not bring the bots back by itself
        print(f'   started {b}', flush=True)
        time.sleep(STAGGER_S)
    bad = verify(BOTS, rel['expected_version'], t0)
    try:
        who = players()
    except Exception:
        who = []
    missing = [b for b in BOTS if b not in who]
    if bad or missing:
        journal('start-failed', bad=bad, not_in_world=missing)
        print(f'START NOT VERIFIED: rows {bad}; not in the world {missing}')
        return 1
    journal('start-verified', release=os.path.basename(os.path.realpath(HARNESS)), expected_version=rel['expected_version'], bots=len(BOTS))
    print(f'STARTED + VERIFIED: {len(BOTS)} bots in the world on {rel["expected_version"]}')
    return 0


def cmd_status(a):
    rel = current_release()
    print(f'host {socket.gethostname()}  release {os.path.basename(os.path.realpath(HARNESS)) if rel else None}  '
          f'expected {rel["expected_version"] if rel else None}')
    print(f'paper {sh("systemctl", "is-active", PAPER, check=False).stdout.strip()}  bots active {len(running_bots())}/{len(BOTS)}  '
          f'fleet bots active {len(active_units("mcbot@*"))}  free {free_bytes() / 2 ** 30:.1f} GiB')
    print('slice CPUQuota: ' + sh('systemctl', 'show', SLICE, '-p', 'CPUQuotaPerSecUSec', '--value', check=False).stdout.strip())
    try:
        who = players()
        print(f'in the world {len(who)}: {" ".join(who)}')
    except Exception as e:
        print(f'server not answering ({type(e).__name__})')
    return 0


# ------------------------------------------------------------------------------------------------ sampling and the load step
def slice_cpu_seconds():
    for line in open(f'/sys/fs/cgroup/{SLICE}/cpu.stat'):
        if line.startswith('usage_usec'):
            return int(line.split()[1]) / 1e6
    raise RuntimeError('no usage_usec in the slice cpu.stat')


def cmd_sample(a):
    why = host_refusal(socket.gethostname())
    if why:
        print(why)
        return 2
    t = iso()
    rows = []
    for b in BOTS:
        show = parse_show(sh('systemctl', 'show', f'{UNIT}{b}', '-p', 'ActiveState,MemoryCurrent,MemoryPeak,NRestarts,MainPID', check=False).stdout)
        rss = None
        try:
            for line in open(f'/proc/{int(show.get("MainPID", 0))}/status'):
                if line.startswith('VmRSS:'):
                    rss = int(line.split()[1])
        except (OSError, ValueError):
            pass
        rows.append(sample_row(t, b, show, rss))
    try:
        cpu = slice_cpu_seconds()
    except (OSError, RuntimeError):
        cpu = None
    pshow = parse_show(sh('systemctl', 'show', PAPER, '-p', 'ActiveState,MemoryCurrent,MemoryPeak,NRestarts,MainPID', check=False).stdout)
    rows.append({**sample_row(t, '_paper', pshow), 'slice_cpu_s': cpu})
    os.makedirs(SOAK, exist_ok=True)
    with open(SAMPLES, 'a') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')
    return 0


def unsqueeze():
    sh('systemctl', 'set-property', '--runtime', SLICE, 'CPUQuota=', check=False)


def squeeze(minutes, share, lookback_s=1800):
    """Cut the slice to `share` of the CPU it used over the last `lookback_s` (from the samples), for `minutes`. Always undone."""
    rows = [json.loads(l) for l in open(SAMPLES) if '"_paper"' in l][-(lookback_s // 300 + 1):]
    rows = [r for r in rows if r.get('slice_cpu_s') is not None]
    if len(rows) < 2:
        raise RuntimeError('fewer than two CPU samples: the 5-minute timer has not run long enough')
    t = [dt.datetime.fromisoformat(r['t'].replace('Z', '+00:00')).timestamp() for r in (rows[0], rows[-1])]
    used = rows[-1]['slice_cpu_s'] - rows[0]['slice_cpu_s']
    pct = quota_pct(used, t[1] - t[0], share)
    journal('squeeze-on', quota_pct=pct, share=share, used_cores=round(used / (t[1] - t[0]), 2), minutes=minutes)
    try:
        sh('systemctl', 'set-property', '--runtime', SLICE, f'CPUQuota={pct}%')
        time.sleep(minutes * 60)
    finally:
        unsqueeze()
        journal('squeeze-off')
    return pct


def pauses(rounds, seconds, gap):
    plan = pause_plan(BOTS, rounds, seconds, gap=gap)
    journal('pauses-start', rounds=rounds, seconds=seconds, bots=len(BOTS))
    t0 = time.time()
    try:
        for off, bot, sig in plan:
            time.sleep(max(0, t0 + off - time.time()))
            sh('systemctl', 'kill', '--signal=' + ('SIGSTOP' if sig == 'STOP' else 'SIGCONT'), f'{UNIT}{bot}', check=False)
            journal('pause' if sig == 'STOP' else 'continue', bot=bot)
    finally:
        for b in BOTS:                                # whatever happened, nobody stays paused
            sh('systemctl', 'kill', '--signal=SIGCONT', f'{UNIT}{b}', check=False)
        journal('pauses-end')


def cmd_squeeze(a):
    guard_host()
    print(f'squeezed to CPUQuota={squeeze(a.minutes, a.share)}% for {a.minutes} min; undone')
    return 0


def cmd_pauses(a):
    guard_host()
    pauses(a.rounds, a.seconds, a.gap)
    return 0


def showcase_p95(minutes=30):
    """(answered calls, p95 ms) of the SHOWCASE's model calls from the telemetry store. Nothing is read on the showcase VM."""
    os.environ.setdefault('MCAI_ES_KEYFILE', ES_KEY)
    sys.path.insert(0, os.path.join(HERE, '..'))
    from lib import estelemetry as E
    until = now_utc() - dt.timedelta(seconds=E.INGEST_LAG_S)
    q = {'bool': {'filter': [{'range': {'@timestamp': {'gte': (until - dt.timedelta(minutes=minutes)).isoformat(), 'lt': until.isoformat()}}},
                             {'exists': {'field': 'llm.latency_ms'}}]}}
    r = E.http('POST', f"/{E.STREAMS['showcase-llm']['index']}/_search",
               {'size': 0, 'track_total_hits': True, 'query': q,
                'aggs': {'p': {'percentiles': {'field': 'llm.latency_ms', 'percents': [50, 95]}}}})
    v = r['aggregations']['p']['values']
    return r['hits']['total']['value'], v.get('95.0'), v.get('50.0')


def guard_once():
    try:
        calls, p95, p50 = showcase_p95()
    except Exception as e:
        calls, p95, p50 = None, None, None
        err = f'{type(e).__name__}: {str(e)[:120]}'
    else:
        err = None
    verdict, why = guard_verdict(calls, p95)
    journal('guard', verdict=verdict, calls=calls, p95_ms=p95, p50_ms=p50, **({'error': err} if err else {}))
    return verdict, why


def cmd_guard(a):
    verdict, why = guard_once()
    print(f'{verdict}: {why}')
    return 0 if verdict == 'OK' else 1


def cmd_soak(a):
    """The whole read, meant for `systemd-run --unit testworld-soak-<run>` so it does not hang on an ssh session."""
    guard_host()
    rel = current_release()
    who = players()
    if sorted(who) != sorted(BOTS):
        print(f'REFUSED: the server lists {len(who)} of {len(BOTS)} bots; start and verify them first')
        return 1
    run_dir = f'{SOAK}/{a.run}'
    if os.path.exists(run_dir):
        print(f'REFUSED: {run_dir} exists; a run name is used once')
        return 1
    os.makedirs(run_dir)
    rcon('save-off'); rcon('save-all flush'); time.sleep(5)
    try:
        sh('rsync', '-a', f'{SERVER}/world/region/', f'{run_dir}/region-start/')
        sh('rsync', '-a', f'{SERVER}/world/stats/', f'{run_dir}/stats-start/')
    finally:
        rcon('save-on')
    cmd_sample(a)
    journal('soak-start', run=a.run, release=os.path.basename(os.path.realpath(HARNESS)), expected_version=rel['expected_version'],
            hours=a.hours, load_step=not a.no_load_step)
    end_quiet = time.time() + a.hours * 3600
    blind, stopped = 0, None
    while time.time() < end_quiet:
        time.sleep(min(600, max(1, end_quiet - time.time())))
        verdict, why = guard_once()
        blind = blind + 1 if verdict == 'BLIND' else 0
        if verdict == 'TRIP' or blind >= GUARD_BLIND_MAX:
            stopped = why if verdict == 'TRIP' else f'guard blind {blind} checks in a row: {why}'
            lk = lock()   # noqa: F841
            _stop('guard: ' + stopped)
            journal('guard-stop', run=a.run, why=stopped)
            break
    journal('quiet-end', run=a.run, stopped=stopped)
    if not stopped and not a.no_load_step:
        journal('load-step-start', run=a.run)
        try:
            squeeze(a.squeeze_minutes, a.share)
            time.sleep(120)
            pauses(a.rounds, a.pause_seconds, a.gap)
            time.sleep(a.recover_minutes * 60)
        finally:
            unsqueeze()
        journal('load-step-end', run=a.run)
    try:
        rcon('save-off'); rcon('save-all flush'); time.sleep(5)
        sh('rsync', '-a', f'{SERVER}/world/region/', f'{run_dir}/region-end/')
        sh('rsync', '-a', f'{SERVER}/world/stats/', f'{run_dir}/stats-end/')
    finally:
        rcon('save-on')
    cmd_sample(a)
    journal('soak-end', run=a.run, stopped=stopped)
    r = sh(sys.executable, '-B', f'{HERE}/soakread.py', '--run', a.run, check=False)
    print(r.stdout[-4000:] + r.stderr[-2000:])
    return r.returncode


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('setup-world'); s.add_argument('source'); s.set_defaults(fn=cmd_setup_world)
    s = sub.add_parser('adopt-bundle'); s.add_argument('dir'); s.set_defaults(fn=cmd_adopt_bundle)
    s = sub.add_parser('load'); s.add_argument('sha'); s.add_argument('--archive', required=True); s.set_defaults(fn=cmd_load)
    s = sub.add_parser('activate'); s.add_argument('release'); s.set_defaults(fn=cmd_activate)
    s = sub.add_parser('start'); s.set_defaults(fn=cmd_start)
    s = sub.add_parser('stop'); s.add_argument('why', nargs='?', default='operator'); s.set_defaults(fn=cmd_stop)
    s = sub.add_parser('status'); s.set_defaults(fn=cmd_status)
    s = sub.add_parser('sample'); s.set_defaults(fn=cmd_sample)
    s = sub.add_parser('guard'); s.set_defaults(fn=cmd_guard)
    s = sub.add_parser('squeeze'); s.add_argument('--minutes', type=float, default=15); s.add_argument('--share', type=float, default=0.4)
    s.set_defaults(fn=cmd_squeeze)
    s = sub.add_parser('pauses'); s.add_argument('--rounds', type=int, default=6); s.add_argument('--seconds', type=int, default=50)
    s.add_argument('--gap', type=int, default=120); s.set_defaults(fn=cmd_pauses)
    s = sub.add_parser('soak'); s.add_argument('--run', required=True); s.add_argument('--hours', type=float, default=3.0)
    s.add_argument('--no-load-step', action='store_true'); s.add_argument('--squeeze-minutes', type=float, default=15)
    s.add_argument('--share', type=float, default=0.4); s.add_argument('--rounds', type=int, default=6)
    s.add_argument('--pause-seconds', type=int, default=50); s.add_argument('--gap', type=int, default=120)
    s.add_argument('--recover-minutes', type=float, default=15); s.set_defaults(fn=cmd_soak)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == '__main__':
    sys.exit(main())
