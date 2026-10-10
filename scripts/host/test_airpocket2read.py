#!/usr/bin/env python3
"""test_airpocket2read.py -- BEHAVIOUR tests for scripts/host/airpocket2read.py (airpocket-02): every correctness gate is driven on a
fixture log tree (AIRPOCKET_LOG_ROOT + CANARY_DRYRUN) and must FIRE on its own defect and stay SILENT on a clean
attempt (the positive control for every negative the read reports). Runs anywhere: python3 scripts/host/test_airpocketread.py
"""
import json, os, re, subprocess, sys, tempfile, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
READ = os.path.join(HERE, 'airpocket2read.py')
CUT = dt.datetime(2026, 10, 1, 0, 0, tzinfo=dt.timezone.utc)
SHA = 'cand123'


def ts(sec):
    return (CUT + dt.timedelta(seconds=sec)).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def row(sec, bot, kind, detail, ver=SHA):
    return json.dumps({'@timestamp': ts(sec), 'code': {'version': ver + '+x'}, 'bot': {'name': bot, 'pos': {'x': 0, 'y': 50, 'z': 0}},
                       'skill': {'name': kind, 'detail': detail, 'status': 'success'}})


def end(aid, outcome='success', health='19->19.5', env='0.5', diff='peaceful', trig='sealed:-1', kind='pocket'):
    return (f'id={aid} outcome={outcome} kind={kind} cell=1,2,3 block=stone tool=stone_pickaxe predicted_ms=14100 dig_ms=14150 ms=17000 '
            f'envelope={env} health={health} eye=air -- x | required_ms=24150 budget_ms=30000 difficulty={diff} trigger_route={trig} held_ms=100')


def start(aid):
    return f'id={aid} kind=pocket cell=1,2,3 block=stone health=19 difficulty=peaceful hunger=0 envelope=0.5 trigger_route=sealed:-1 held_ms=100'


def start2(aid, trig='sealed:-1', blocked='none', pose='stand', kind='pocket', block='stone'):
    return (f'id={aid} kind={kind} cell=1,62,3 block={block} health=19 difficulty=peaceful hunger=0 envelope=0.5 pose={pose} blocked={blocked} '
            f'trigger_route={trig} held_ms=8100')


CONTROL = [row(t, 'pc-c-Alpha', k, d, 'base') for t, k, d in (
    (100, '_drowning_route', 'sealed dist=-1 at 1,2,3 scoop=no'), (130, '_drowning_ceiling_no_air', 'held 20s and never reached air (oxygen 0, health 15) — sealed'),
    (200, 'gather', 'ok'), (19000, 'gather', 'ok'))]
FILL = [row(t, 'pa-a-Alpha', 'gather', 'ok') for t in range(0, 21000, 600)]


def run(canary_rows, control_extra=(), window=360):
    with tempfile.TemporaryDirectory() as root:
        for bot, rows in (('pa-a-Alpha', FILL + list(canary_rows)), ('pc-c-Alpha', CONTROL + list(control_extra))):
            os.makedirs(os.path.join(root, bot))
            with open(os.path.join(root, bot, f'skill-{bot}.jsonl'), 'w') as f:
                f.write('\n'.join(rows) + '\n')
        env = dict(os.environ, AIRPOCKET_LOG_ROOT=root, CANARY_DRYRUN=f'pa-a:{SHA}:{CUT.isoformat()}')
        out = subprocess.run([sys.executable, READ, str(window)], capture_output=True, text=True, env=env, timeout=120)
        txt = out.stdout + out.stderr
        m = re.search(r'CORRECTNESS  breaches (\d+): (.*)', txt)
        assert m, txt[-2000:]
        live = re.search(r'LIVENESS .*= (\d+) .*control airpocket-02 rows (\d+)', txt)
        att = re.search(r'ATTEMPTS     (\d+) mature \(\+(\d+) immature\)', txt)
        return int(m.group(1)), m.group(2), int(live.group(1)), int(live.group(2)), int(att.group(1)), int(att.group(2)), txt


passed = failed = 0


def t(name, fn):
    global passed, failed
    try:
        fn(); passed += 1; print('  PASS ', name)
    except AssertionError as e:
        failed += 1; print('  FAIL ', name, '\n       ', str(e)[:600])


def clean():
    n, which, live, ctl, mature, imm, txt = run([row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1'))])
    assert n == 0 and live == 1 and ctl == 0 and mature == 1, (n, which, live, ctl, mature)
    assert 'INSTRUMENT   control capped rescues (post) 1' in txt and 'no-air sealed ceilings (post) 1' in txt, txt[-800:]


def fires(gate, rows, control_extra=()):
    def f():
        n, which, *_ = run(rows, control_extra)
        assert gate in which, (gate, which)
    return f


t('POSITIVE CONTROL: a clean attempt is read (1 mature), no breach, the instrument sees the control', clean)
t('C1 fires: a success followed by the same bot drowning 60 s later',
  fires('C1_false_success', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1')),
                             row(1078, 'pa-a-Alpha', '_death', 'drowned; idle at the moment of death')]))
t('C2 fires: a lava death DURING the attempt (before the end row)',
  fires('C2_dug_into_danger', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1010, 'pa-a-Alpha', '_death', 'tried to swim in lava'),
                               row(1018, 'pa-a-Alpha', '_air_pocket', end('a1', 'failed', '6->0'))]))
t('C2 fires: a start row, then a suffocation death and no end row',
  fires('C2_dug_into_danger', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1020, 'pa-a-Alpha', '_death', 'suffocated in a wall')]))
t('C3 fires: a failed attempt ending at 2 HP',
  fires('C3_reserve_spent', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1', 'aborted', '9->2'))]))
t('C3 fires: a drowning between the start and the end row',
  fires('C3_reserve_spent', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1012, 'pa-a-Alpha', '_death', 'drowned'),
                             row(1018, 'pa-a-Alpha', '_air_pocket', end('a1', 'failed', '1->0'))]))
t('C4 fires: trigger_route=up',
  fires('C4_up_route_trigger', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1', trig='up:2'))]))
t('C5 fires: envelope 0.5 on an easy world',
  fires('C5_envelope', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1', diff='easy'))]))
t('C0 fires: an end row with no start row',
  fires('C0_malformed', [row(1018, 'pa-a-Alpha', '_air_pocket', end('a1'))]))
t('C0 fires: an end row with a missing health field',
  fires('C0_malformed', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1').replace(' health=19->19.5', ''))]))
t('C0 fires: a start row with no end row while the bot went on logging (unfinished)',
  fires('C0_malformed', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1'))]))


t('C0 fires: predicted_ms=NaN on an end row (strict numeric validation)',
  fires('C0_malformed', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1').replace('predicted_ms=14100', 'predicted_ms=NaN'))]))
t('C0 fires: a malformed START row (missing envelope)',
  fires('C0_malformed', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1').replace(' envelope=0.5', '')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1'))]))


t('C0 fires: a start row with a non-numeric health (19..5)',
  fires('C0_malformed', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1').replace('health=19', 'health=19..5')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1'))]))
t('C0 fires: an end row with an unknown trigger route word',
  fires('C0_malformed', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1', trig='banana:3'))]))
t('C0 fires: a negative budget',
  fires('C0_malformed', [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1').replace('budget_ms=30000', 'budget_ms=-5'))]))
t('C0 fires: the start row comes AFTER its end row',
  fires('C0_malformed', [row(1030, 'pa-a-Alpha', '_air_pocket_start', start('a1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('a1'))]))


def immature():
    W = 360 * 60
    n, which, live, ctl, mature, imm, _ = run([row(W - 80, 'pa-a-Alpha', '_air_pocket_start', start('a9')), row(W - 60, 'pa-a-Alpha', '_air_pocket', end('a9'))])
    assert mature == 0 and imm == 1 and 'C1' not in which, (mature, imm, which)
    assert 'mature successes 0' in _, 'an immature success must not count toward the KEEP condition'


t('IMMATURE: a success 60 s before the window end is counted immature and not judged for C1', immature)


def arms():
    # airpocket-01 rows in the control are LEGITIMATE on the KEEP base (fleet dbb4d78): not airpocket-02 rows
    n, which, live, ctl, *_ = run([], [row(500, 'pc-c-Alpha', '_air_pocket_refused', 'reason=x at=1,2,3 health=19 difficulty=peaceful trigger_route=sealed:-1 held_ms=1'),
                                      row(600, 'pc-c-Alpha', '_air_pocket_start', start('c1'))])
    assert ctl == 0, ctl
    # what ONLY airpocket-02 writes is counted: an upblocked row, a start row with pose=
    n, which, live, ctl, *_ = run([], [row(500, 'pc-c-Alpha', '_air_pocket_upblocked', 'the rescue\'s up dist=1 route crosses ice@62: pose=swim'),
                                      row(600, 'pc-c-Alpha', '_air_pocket_start', start2('c2'))])
    assert ctl == 2, ctl


t('ARMS: airpocket-01 rows in the control are not counted; airpocket-02 rows are (must be 0 in a real read)', arms)


def otherbuild():
    n, which, live, ctl, mature, imm, txt = run([row(1000, 'pa-a-Alpha', '_air_pocket_start', start('a1'), 'oldsha'),
                                                 row(1018, 'pa-a-Alpha', '_air_pocket', end('a1', trig='up:1'), 'oldsha')])
    assert n == 0 and 'other build 1' in txt, (n, which, txt[-600:])


t('OTHER BUILD: rows from a non-canary build in a canary pool are excluded and counted', otherbuild)
def stand():
    neg = end('s1').replace(' eye=air -- x', ' eye=air stand=stopped:y=-12 did not turn solid (0 placed) -- x')
    pos = end('s2').replace(' eye=air -- x', ' eye=air stand=placed:1 -- x')
    n, which, live, ctl, mature, imm, txt = run([row(1000, 'pa-a-Alpha', '_air_pocket_start', start('s1')), row(1018, 'pa-a-Alpha', '_air_pocket', neg),
                                                 row(2000, 'pa-a-Alpha', '_air_pocket_start', start('s2')), row(2018, 'pa-a-Alpha', '_air_pocket', pos)])
    line = re.search(r'STAND .*', txt).group(0)
    assert n == 0 and "'placed:1': 1" in line and "'stopped:y=-12 did not turn solid': 1" in line, (n, which, line)


t('STAND: stand outcomes (including a negative y) are parsed and reported, never gated', stand)


def airpocket_src(ref, marker='export function botPose'):
    """The bot's AIRPOCKET-02 airpocket.mjs (+ the two modules it imports). On an airpocket-02 checkout it is bots/src;
    elsewhere (main carries airpocket-01's file, without `marker`) it is taken from `ref` with git show. Missing either way
    is a FAILURE, never a skip: REAL ROWS must parse what the airpocket-02 bot actually writes."""
    local = os.path.join(HERE, '..', '..', 'bots', 'src', 'airpocket.mjs')
    if os.path.exists(local) and marker in open(local).read():
        return os.path.abspath(local)
    d = tempfile.mkdtemp(prefix='apsrc-')
    for f in ('airpocket.mjs', 'foodskip.mjs', 'toolfor.mjs'):
        out = subprocess.run(['git', '-C', HERE, 'show', f'{ref}:bots/src/{f}'], capture_output=True, text=True)
        assert out.returncode == 0, f'cannot read {ref}:bots/src/{f}: {out.stderr[-300:]}'
        open(os.path.join(d, f), 'w').write(out.stdout)
    return os.path.join(d, 'airpocket.mjs')


AP = airpocket_src(os.environ.get('AIRPOCKET_SRC_REF', 'origin/ap2-on-4970c91'))


def bot_rows():
    """THE BOT'S OWN ROW BUILDER (airPocketRow), cut at the logger's 300 characters exactly as logger.mjs does. The Paper
    562d9e7 logs showed hand-written fixtures can pass while every real row fails C0: the stand= field pushed the required
    tail past the cap. So this test parses what the bot actually writes."""
    js = ("import('" + os.path.abspath(AP) + "').then(m => { const base = { kind: 'pocket', cell: '-12345,-59,-12345', block: 'cobbled_deepslate', "
          "tool: 'netherite_pickaxe', standing: false, predictedMs: 14100, digMs: 14103, ms: 16381, envelope: 0.5, healthStart: 16.666677474975586, "
          "healthEnd: 17.000011444091797, eye: 'cave_air' }; const a = { requiredMs: 24150.4, budgetMs: 30000, difficulty: 'peaceful' }; "
          "console.log(JSON.stringify([m.airPocketRow({ ...a, id: 'w1', r: { ...base, outcome: 'success', stand: 'stopped:aborted: envelope breached (> 7 HP in 10 s) (2 placed)', why: 'breathing' } }), "
          "m.airPocketRow({ ...a, id: 'w2', r: { ...base, outcome: 'failed', stand: undefined, why: 'dig failed: dig exceeded 28200 ms' } })].map(s => String(s).slice(0, 300)))) })")
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr[-600:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def real_rows():
    w1, w2 = bot_rows()
    rows = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start('w1')), row(1018, 'pa-a-Alpha', '_air_pocket', w1),
            row(2000, 'pa-a-Alpha', '_air_pocket_start', start('w2')), row(2030, 'pa-a-Alpha', '_air_pocket', w2)]
    n, which, live, ctl, mature, imm, txt = run(rows)
    assert n == 0 and mature == 2, (n, which, txt[-900:])
    # the trigger lives on the START row: an `up` start must still fire C4 on the bot's real end row
    up = start('w3').replace('trigger_route=sealed:-1', 'trigger_route=up:1')
    n2, which2, *_ = run([row(1000, 'pa-a-Alpha', '_air_pocket_start', up), row(1018, 'pa-a-Alpha', '_air_pocket', w1.replace('id=w1 ', 'id=w3 '))])
    assert 'C4_up_route_trigger' in which2, which2


t("REAL ROWS: the bot's own airPocketRow output, cut at 300, parses clean; the start row's trigger still fires C4", real_rows)


def c6():
    # Paper freeze-probe trial 2: success, then the rescue's ceiling 22 s later with no breath between
    rows = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start2('f1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('f1')),
            row(1040, 'pa-a-Alpha', '_drowning_ceiling_no_air', 'held 20s and never reached air (oxygen 0, health 15) — sealed')]
    n, which, *_ = run(rows)
    assert 'C6_false_success_server' in which, which
    # positive control: the same success with the rescue's breathing row first is clean; so is a ceiling 40 s later
    ok1 = [rows[0], rows[1], row(1020, 'pa-a-Alpha', '_drowning_breathing', 'breathing after 7s (oxygen 6, health 20)'), rows[2]]
    ok2 = [rows[0], rows[1], row(1060, 'pa-a-Alpha', '_drowning_ceiling_no_air', 'held 20s and never reached air (oxygen 0, health 15) — sealed')]
    # a ceiling with AIR left (bobbing) is not a false success; a breathing row with no air does not clear one
    ok3 = [rows[0], rows[1], row(1040, 'pa-a-Alpha', '_drowning_ceiling_no_air', 'held 20s and never reached air (oxygen 12, health 20) — sealed')]
    bad2 = [rows[0], rows[1], row(1020, 'pa-a-Alpha', '_drowning_breathing', 'breathing after 2s (oxygen 0, health 15)'), rows[2]]
    assert 'C6_false_success_server' in run(bad2)[1]
    for ok in (ok1, ok2, ok3):
        n2, which2, *_ = run(ok)
        assert 'C6_false_success_server' not in which2, which2


t('C6 FALSE SUCCESS (server-grounded): a ceiling within 30 s of a success with no breath between fires; with a breath, or later, it does not', c6)


def row_hp(sec, bot, kind, detail, hp):
    r = json.loads(row(sec, bot, kind, detail)); r['bot']['health'] = hp
    return json.dumps(r)


def c6_health():
    # the server's health falls >= 2 below the success's ending health within 20 s: a false success, whatever the
    # breathing row says (Codex r1: that row is not independent evidence)
    base = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start2('h1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('h1', health='19->19.5'))]
    bad = base + [row_hp(1021, 'pa-a-Alpha', '_drowning_breathing', 'breathing after 3s (oxygen 6, health 18)', 17.5),
                  row(1030, 'pa-a-Alpha', '_air_drowning_observed', 'oxygen 8, head block water, health 17.5')]
    assert 'C6_false_success_server' in run(bad)[1]
    # PAPER 10-08 (control dbb4d78 T2:0, a real false success): a 2-HP hit 2 s after the success with the rescue steering
    # again (`_drowning_up`), and a CLIENT breathing row (oxygen 11) that the server contradicted -- C6(a) must fire
    paper = base + [row_hp(1020, 'pa-a-Alpha', '_drowning_up', 'phase up', 17.0),
                    row_hp(1034, 'pa-a-Alpha', '_drowning_breathing', 'breathing after 16s (oxygen 11, health 17)', 17.0)]
    assert 'C6_false_success_server' in run(paper)[1]
    # a drop with NO drowning evidence (another cause) is not this defect
    other = base + [row_hp(1021, 'pa-a-Alpha', 'gather', 'ok', 17.5)]
    n, which, live, ctl, mature, imm, txt = run(other)
    assert 'C6_false_success_server' not in which, which
    assert re.search(r'C6 HEALTH +[1-9]\d* health-bearing rows', txt), 'the health instrument must see the rows'
    ok = base + [row_hp(1021, 'pa-a-Alpha', 'gather', 'ok', 19.5), row_hp(1045, 'pa-a-Alpha', 'gather', 'ok', 15.0)]   # the drop is after 20 s
    assert 'C6_false_success_server' not in run(ok)[1]


t('C6 (health): a >= 2-HP drop in the server health within 20 s of a success fires even with a breathing row; a later drop does not', c6_health)


def c7():
    up = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start2('u1', trig='upblocked:1', blocked='ice@62', pose='swim', kind='ice', block='ice')),
          row(1018, 'pa-a-Alpha', '_air_pocket', end('u1', kind='ice'))]
    n, which, live, ctl, mature, imm, txt = run(up)
    assert n == 0 and mature == 1, (n, which)
    line = re.search(r'AIRPOCKET-02 .*', txt).group(0)
    assert 'upblocked attempts 1 mature (1 successes)' in line and "'swim': 1" in line and 'SUCCESS) READY' in line, line
    # an upblocked attempt that did not succeed is NOT exposure
    nf = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start2('u9', trig='upblocked:1', blocked='ice@62', pose='swim', kind='ice', block='ice')),
          row(1018, 'pa-a-Alpha', '_air_pocket', end('u9', kind='ice', outcome='failed', health='19->18'))]
    assert 'SUCCESS) NOT YET' in re.search(r'AIRPOCKET-02 .*', run(nf)[6]).group(0)
    for bad in ('none', 'water@62', 'air@63', 'unknown@62', 'kelp@62', 'banana', 'ice@NaN', 'ice@63', 'stone@62'):
        b = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start2('u2', trig='upblocked:1', blocked=bad, pose='swim', kind='ice', block='ice')),
             row(1018, 'pa-a-Alpha', '_air_pocket', end('u2', kind='ice'))]
        n2, which2, *_ = run(b)
        assert 'C7_upblocked_unproven' in which2, (bad, which2)
    # a plain `up` trigger is still C4
    u = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start2('u3', trig='up:1')), row(1018, 'pa-a-Alpha', '_air_pocket', end('u3'))]
    assert 'C4_up_route_trigger' in run(u)[1]


t('C7 UPBLOCKED: an attempt naming its solid blocking cell is clean and counted; none/water/air fires C7; plain up is C4', c7)


def ap2_real_rows():
    w1, w2 = bot_rows()
    rows = [row(1000, 'pa-a-Alpha', '_air_pocket_start', start2('w1', trig='upblocked:1', blocked='ice@62', pose='swim', kind='ice', block='ice')),
            row(1018, 'pa-a-Alpha', '_air_pocket', w1)]
    n, which, *_ = run(rows)
    assert n == 0, which


t("REAL ROWS (airpocket-02): the bot's own end row with an ap2 start row (pose, blocked, upblocked) parses clean", ap2_real_rows)
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
