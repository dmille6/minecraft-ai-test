#!/usr/bin/env python3
"""testworld.py, the test world's loader (11-18). Its decisions are pure functions and are tested on what they DO: where it may
run, what an env file may point at, what a pause must outlast, when the showcase guard speaks. Each "allowed" sits beside the
same input refused, and the mutants at the end prove each rule binds (anchor present and unique). The unit files are checked
for what behaviour cannot reach here: the host assertion, the env check, and the showcase's memory envelope."""
import json, os, re, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..', '..')
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(REPO, 'infra', 'showcase'))
import testworld as TW      # noqa: E402
import make_env as ME       # noqa: E402

fails = 0
def check(ok, msg):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    fails += 0 if ok else 1
def raises(fn, text=''):
    try:
        fn()
    except Exception as e:      # noqa: BLE001
        return text in str(e)
    return False

CONTROL = ME.parse_env('\n'.join([
    'BOT_ROLE=gatherer', 'LLM_ENABLED=true', 'LLM_TIMEOUT_MS=30000', 'LLM_DECISION_COOLDOWN_MS=2000', 'OLLAMA_NUM_CTX=8192',
    'SKILL_TIMEOUT_MS=60000', 'MINECRAFT_VERSION=1.21.8', 'MINECRAFT_AUTH=offline', 'RECONNECT_DELAY_MS=8000',
    'BOT_NAME=board-a-Alpha', 'LOG_DIR=/var/log/mcai/board-a-Alpha', 'MINECRAFT_HOST=10.9.9.9', 'MINECRAFT_PORT=25570']))
SITE = {'home': [0, 70, 0], 'board': [1, 70, 1], 'border_radius': 512, 'port': TW.MC_PORT}
SHA = 'efee8b5fa4f836349afd9d4bde8d13e1afdf5e57'
BRAIN = ME.brain_of({'url': 'http://10.0.0.72:11434', 'model': 'qwen2.5:7b-instruct', 'kind': 'ollama', 'owner': 'owner 2026-11-16 perm choice'})

# ---- where it may run
check(TW.host_refusal('block2-bots') is None, 'block2-bots: allowed')
check('REFUSED' in (TW.host_refusal('vm-showcase') or ''), 'the showcase VM: refused')
check('REFUSED' in (TW.host_refusal('') or ''), 'an empty hostname: refused')
check(TW.fleet_refusal([]) is None, 'no fleet bot running: the bots may start')
check('REFUSED' in (TW.fleet_refusal(['mcbot@board-a-Alpha.service']) or ''), 'one fleet bot running: refused, and it says to tell the control session')

# ---- the roster
check(len(TW.BOTS) == 14 and len(set(TW.BOTS)) == 14, '14 distinct bots')
check(all(n in ME.NAMES for n in TW.RUN_NAMES) and 'Nova' not in TW.RUN_NAMES, 'every name is one of make_env\'s, and Nova stays out')
check(all(b.startswith('showcase-') and len(b) <= 16 for b in TW.BOTS), 'the in-world names are the showcase\'s (the copied bags are theirs)')

# ---- the env files: make_env's own, with four keys replaced
rows = TW.env_rows(CONTROL, 'Alpha', SITE, SHA, BRAIN)
got, base = dict(rows), dict(ME.build_env(CONTROL, 0, SITE, SHA, brain=BRAIN))
check([k for k, _ in rows] == [k for k, _ in ME.build_env(CONTROL, 0, SITE, SHA, brain=BRAIN)], 'same keys in the same order as make_env.build_env')
check(sorted(k for k in got if got[k] != base[k]) == sorted(TW.OVERRIDES), f'only {sorted(TW.OVERRIDES)} differ from the showcase\'s env')
check(got['MINECRAFT_HOST'] == '127.0.0.1' and got['MINECRAFT_PORT'] == '25560', 'it points at the test server on this host')
check(got['LOG_DIR'] == '/srv/testworld/log/showcase-Alpha' and got['STATE_DIR'] == '/srv/testworld/state/showcase-Alpha',
      'logs and records under /srv/testworld (the log shipper takes /var/log/mcai, the pool cleaner /var/lib/mcai)')
check('/var/log/mcai' not in json.dumps(rows) and '/var/lib/mcai' not in json.dumps(rows), 'no fleet or showcase folder anywhere in the env')
check(got['RUN_ID'] == 'testworld-efee8b5f', 'every row is marked testworld-<sha8>')
check(got['MEMORY_POOL'] == 'showcase' and got['BOT_NAME'] == 'showcase-Alpha', 'pool and name stay the showcase\'s (33 source files switch on the pool name)')
check(got['VIEWER_PORT'] == '3300' and dict(TW.env_rows(CONTROL, 'Onyx', SITE, SHA, BRAIN))['VIEWER_PORT'] == '3314', 'viewer ports 3300-3314, clear of the showcase\'s 3200-3214')
check(got['CODE_VERSION'] == SHA and got['OLLAMA_BASE_URL'] == 'http://10.0.0.72:11434', 'the sha and the brain setting pass through')
check(raises(lambda: TW.env_rows(CONTROL, 'Alpha', dict(SITE, port=25565), SHA, BRAIN), 'not the test'), 'a site file with the showcase\'s port 25565: refused')
check(raises(lambda: TW.env_rows(CONTROL, 'Alpha', {k: v for k, v in SITE.items() if k != 'port'}, SHA, BRAIN), 'not the test'), 'a site file with no port (make_env defaults to 25565): refused')
check(raises(lambda: TW.env_rows(CONTROL, 'Nobody', SITE, SHA, BRAIN)), 'a name make_env does not know: refused')

# ---- the release identity
with tempfile.TemporaryDirectory() as td:
    for n, b in (('b.mjs', b'two'), ('a.mjs', b'one'), ('.hidden.mjs', b'x'), ('note.txt', b'y')):
        open(os.path.join(td, n), 'wb').write(b)
    import showcase_ops as SO   # noqa: E402
    check(TW.src_digest(td) == SO.src_digest(td), 'src_digest equals showcase_ops.src_digest on the same folder (dotfiles and non-mjs left out)')
    open(os.path.join(td, 'a.mjs'), 'wb').write(b'ONE')
    check(TW.src_digest(td) == SO.src_digest(td) and TW.src_digest(td) != TW.src_digest_of([('a.mjs', b'one'), ('b.mjs', b'two')]), 'and moves with one changed byte')
check(TW.release_name(SHA, '6dd0ded8756a68e2', 'fdd64eadd8a504fb') == 'efee8b5f-6dd0ded8-fdd64ead', 'the release folder is named as the showcase names it')
check(TW.archive_commit({'comment': SHA}) == SHA, 'a git archive names its commit')
check(TW.archive_commit({}) is None and TW.archive_commit({'comment': 'hello'}) is None and TW.archive_commit(None) is None, 'a tar that names no commit is not one')
check(TW.policy_digest(CONTROL) == SO.FR.digest(ME.policy_of(CONTROL)), 'policy_digest equals followrule.digest of the policy knobs')

# ---- the copied settings: new ports, localhost, new secrets
PROPS = 'server-port=25565\nrcon.port=25575\nrcon.password=SHOWCASE-SECRET\nenable-rcon=true\nview-distance=8\n#server-ip=9.9.9.9\nserver-ip=\nmotd=a=b\n'
out = TW.server_properties(PROPS, 'NEWPASS')
kv = dict(l.split('=', 1) for l in out.splitlines() if '=' in l and not l.startswith('#'))
check(kv['server-port'] == '25560' and kv['rcon.port'] == '25660' and kv['server-ip'] == '127.0.0.1', 'the test world\'s ports, localhost only')
check('SHOWCASE-SECRET' not in out and kv['rcon.password'] == 'NEWPASS', 'the showcase\'s RCON password is gone')
check(kv['view-distance'] == '8' and kv['motd'] == 'a=b' and '#server-ip=9.9.9.9' in out, 'every other line is kept as it was')
check(kv['enable-query'] == 'false', 'a key the copy lacked is added')
Y = "proxies:\n  velocity:\n    secret: 'abc123'\n    enabled: false\nmineskinAPIKey: ''\npassword: hunter2\n# password: in a comment\nname: secretive\n"
ys = TW.scrub_yaml(Y, make=lambda: 'NEW')
check('abc123' not in ys and 'hunter2' not in ys and ys.count("'NEW'") == 2, 'both secret values replaced')
check("mineskinAPIKey: ''" in ys and 'name: secretive' in ys and '# password: in a comment' in ys and '    enabled: false' in ys, 'an empty value, a comment and other keys are left alone')

with tempfile.TemporaryDirectory() as td:
    f = os.path.join(td, 'server.properties')
    open(f, 'w').write(PROPS)
    os.chmod(f, 0o640)
    TW.rewrite(f, lambda t: TW.server_properties(t, 'NEWPASS'))
    after = open(f).read()
    check('view-distance=8' in after and 'motd=a=b' in after and 'server-port=25560' in after, 'rewrite reads the file BEFORE it writes: every setting survives (review 11-18: the first restore lost them all)')
    check(oct(os.stat(f).st_mode & 0o777) == '0o640' and not os.path.exists(f + '.tmp'), 'the file keeps its mode and no temp file is left')

# ---- samples
r = TW.sample_row('2026-11-18T13:15:01Z', 'showcase-Alpha', TW.parse_show('ActiveState=active\nMemoryCurrent=524288000\nMemoryPeak=629145600\nNRestarts=2\nMainPID=4242\n'), 409600)
check(r['mem_mb'] == 500.0 and r['peak_mb'] == 600.0 and r['restarts'] == 2 and r['active'] and r['rss_mb'] == 400.0, 'a running unit: MB, peak, restarts, rss')
r = TW.sample_row('t', 'b', TW.parse_show('ActiveState=inactive\nMemoryCurrent=[not set]\nNRestarts=0\nMainPID=0\n'))
check(r['mem_mb'] is None and not r['active'], 'a stopped unit reads None, never 0 MB')

# ---- the load step
check(TW.quota_pct(1800 * 2.5, 1800, 0.4) == 100, '2.5 cores used, 40%: one core')
check(TW.quota_pct(1800 * 0.5, 1800, 0.4) == 50, 'never under the floor of half a core')
check(raises(lambda: TW.quota_pct(10, 0, 0.4)), 'no wall time: refused')
plan = TW.pause_plan(['a', 'b', 'c'], 2, 50, stagger=12, gap=120)
check(len(plan) == 12 and [p[0] for p in plan] == sorted(p[0] for p in plan), '2 rounds x 3 bots: 6 pauses and 6 continues, in time order')
stops = {(b, i): t for i, (t, b, s) in enumerate(plan) if s == 'STOP'}
check(all(any(t2 == t + 50 and b2 == b and s2 == 'CONT' for t2, b2, s2 in plan) for (b, _), t in stops.items()), 'every pause is continued exactly 50 s later')
check(plan[0] == (0, 'a', 'STOP') and (12, 'b', 'STOP') in plan and (24 + 50 + 120, 'a', 'STOP') in plan, 'bots 12 s apart; the next round 120 s after the last continue')
check(raises(lambda: TW.pause_plan(['a'], 1, 45), 'keepalive'), 'a 45 s pause can slip between two keepalives: refused')
check(not raises(lambda: TW.pause_plan(['a'], 1, 46)), 'POSITIVE CONTROL: 46 s is accepted')

# ---- the showcase guard
check(TW.guard_verdict(400, 5200)[0] == 'OK', 'p95 5.2 s: fine')
check(TW.guard_verdict(400, 6000)[0] == 'OK', 'exactly 6 s: fine')
check(TW.guard_verdict(400, 6001)[0] == 'TRIP', 'past 6 s: the test bots stop')
check(TW.guard_verdict(59, 1000)[0] == 'BLIND' and TW.guard_verdict(60, 1000)[0] == 'OK', 'under 60 answered calls in 30 min is blind, not fine')
check(TW.guard_verdict(None, None)[0] == 'BLIND' and TW.guard_verdict(400, None)[0] == 'BLIND', 'no reading is blind')
check(TW.guard_verdict(10, 9000)[0] == 'BLIND', 'ten slow calls are not a verdict on the showcase either')

# ---- the unit files (structure only: what behaviour cannot reach)
def unit(path):
    text = '\n'.join(l for l in open(os.path.join(REPO, path)).read().splitlines() if not l.lstrip().startswith('#'))
    return text
bot, show = unit('infra/testworld/mctest@.service'), unit('infra/showcase/files/mcshow@.service')
paper, spaper = unit('infra/testworld/testworld-paper.service'), unit('infra/showcase/files/showcase-paper.service')
def val(text, key):
    m = re.findall(r'^%s=(.*)$' % re.escape(key), text, re.M)
    return m[0] if len(m) == 1 else m
check(val(bot, 'AssertHost') == 'block2-bots' and val(paper, 'AssertHost') == 'block2-bots', 'bot and server units assert the host')
check('test "$MINECRAFT_HOST" = 127.0.0.1' in val(bot, 'ExecStartPre') and 'test "$MINECRAFT_PORT" = 25560' in val(bot, 'ExecStartPre'), 'the bot unit refuses an env that points elsewhere')
check(val(bot, 'MemoryMax') == val(show, 'MemoryMax') == '1536M', 'the bot\'s memory ceiling is the showcase\'s')
check(val(bot, 'ExecStart') == val(show, 'ExecStart'), 'the bot\'s node command is the showcase\'s, flag for flag')
check(all(val(bot, k) == val(show, k) for k in ('Restart', 'RestartSec', 'User', 'NoNewPrivileges', 'ProtectSystem', 'ProtectHome', 'PrivateTmp')), 'restart policy and hardening are the showcase\'s')
check(val(bot, 'ReadWritePaths') == '/srv/testworld/log /srv/testworld/state' and '/var/' not in bot, 'the bot can write only the test world\'s folders')
check(val(bot, 'Slice') == 'testworld.slice' and val(paper, 'Slice') == 'testworld.slice', 'both sit in the one slice the load step squeezes')
check(val(paper, 'ExecStart').split(' ', 1)[1] == val(spaper, 'ExecStart').split(' ', 1)[1] and val(paper, 'MemoryMax') == val(spaper, 'MemoryMax'), 'the server\'s Java options and ceiling are the showcase\'s')
slice_ = unit('infra/testworld/testworld.slice')
lo, hi = map(int, val(slice_, 'AllowedCPUs').split('-'))
plo, phi = map(int, val(paper, 'AllowedCPUs').split('-'))
slo, shi = map(int, val(spaper, 'AllowedCPUs').split('-'))
check(hi - lo + 1 == 10 and phi - plo == shi - slo and lo <= plo and phi <= hi, 'the slice is 10 CPUs and the server has as many of them as on the showcase')
for t in ('testworld-sample', 'testworld-leaseprune'):
    svc = unit(f'infra/testworld/{t}.service')
    check('/srv/testworld/' in val(svc, 'ExecStart') and 'ntfy' not in svc and 'digest' not in svc, f'{t} runs from and writes under /srv/testworld only')

# ---- mutants: each rule binds (the anchor must be present and unique)
SRC = open(os.path.join(HERE, 'testworld.py')).read()
def mutant(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'testworld_mutant', '__file__': os.path.join(HERE, 'testworld.py')}
    exec(compile(SRC.replace(old, new), 'testworld_mutant', 'exec'), ns)
    return ns
def killed(name, got):
    check(got, 'MUTANT KILLED: ' + name)
m = mutant("    if hostname != HOST:\n", "    if False:\n")
killed('any host may run it', m['host_refusal']('vm-showcase') is None)
m = mutant("    if active_fleet_units:\n", "    if False:\n")
killed('the bots start beside a running fleet', m['fleet_refusal'](['mcbot@x.service']) is None)
m = mutant("    if got.get('MINECRAFT_HOST') != MC_HOST or got.get('MINECRAFT_PORT') != str(MC_PORT):\n", "    if False:\n")
killed('an env pointing at port 25565 is written', not raises(lambda: m['env_rows'](CONTROL, 'Alpha', dict(SITE, port=25565), SHA, BRAIN)))
m = mutant("    out = [(k, over.get(k, v)) for k, v in rows]\n", "    out = list(rows)\n")
killed('the overrides are not applied (logs would go to /var/log/mcai)', dict(m['env_rows'](CONTROL, 'Alpha', SITE, SHA, BRAIN))['LOG_DIR'].startswith('/var/log/mcai'))
m = mutant("    if seconds <= 45:\n", "    if seconds <= 0:\n")
killed('a 30 s pause is planned', not raises(lambda: m['pause_plan'](['a'], 1, 30)))
m = mutant("    if calls is None or p95_ms is None or calls < min_calls:\n", "    if calls is None or p95_ms is None:\n")
killed('ten calls count as seeing the showcase', m['guard_verdict'](10, 1000)[0] == 'OK')
m = mutant("    if p95_ms > limit:\n", "    if p95_ms > limit * 10:\n")
killed('a 9 s showcase p95 does not trip', m['guard_verdict'](400, 9000)[0] == 'OK')
with tempfile.TemporaryDirectory() as td:
    f = os.path.join(td, 'p')
    open(f, 'w').write(PROPS)
    m = mutant("    text = open(path).read()\n    out = fn(text)\n    with open(path + '.tmp', 'w') as f:\n", "    with open(path, 'w') as f0:\n        pass\n    text = open(path).read()\n    out = fn(text)\n    with open(path + '.tmp', 'w') as f:\n")
    m['rewrite'](f, lambda t: m['server_properties'](t, 'X'))
    killed('the file is truncated before it is read', 'view-distance=8' not in open(f).read())
m = mutant("        return round(int(v) / 1048576, 1) if str(v).isdigit() else None\n", "        return round(int(v) / 1048576, 1) if str(v).isdigit() else 0\n")
killed('a stopped unit reads 0 MB', m['sample_row']('t', 'b', {'MemoryCurrent': '[not set]'})['mem_mb'] == 0)

print(f'\n{"OK" if not fails else "FAILED"}: {fails} failure(s)')
sys.exit(1 if fails else 0)
