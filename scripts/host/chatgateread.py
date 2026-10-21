#!/usr/bin/env python3
# chatgateread.py [window_min] [--selftest] -- the read for canary `chatgate-01` (chat commands only from OWNER_CHAT_NAMES, empty
# on the bench; read-only verbs only; peer `[fleet]` ingestion retired). Design: docs/reports/comms-design-2026-10-21.md 5.3,
# 5.6 (T6), 8 row 1, 9 C4/C7. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM.
#
# Run from ~/mcai-analysis (lib/telemetry.py: the file reads, rotation-aware).
#
# WHY. Until chatgate-01 any player name could `!stop`, `!goto`, `<bot> come` every bot on a server (a name is not authentication
# on an offline-mode server). Measured cost of closing it: 0 chat commands in 24 h in 12 journals; 0 skill rows with
# trigger=chat. NOTHING CAN BE EXPOSED ON THE BENCH: chat commands run 0 times a day, and mineflayer's `chat` event never fires
# for the fleet's hyphenated names (Paper 10-22, docs/reports/chatgate-01-paper-2026-10-22.jsonl), so `_chat_ignored` will
# read about 0 here and that is NOT evidence the gate saw anything (Claude r2/r3). The exposure is therefore the gate's
# ACTIVE TIME (canary bot-h with a `_chatgate_mode` row), as the design registers it; the evidence of the gate is Paper.
#
# THE CHANGE (what only this build writes):
#   _chatgate_mode   once per spawn: phase=mode commands=none|allowlist grants=... dropped_entries=N dropped_verbs=N ...
#   _chat_ignored    at most one per minute per bot, only when a line from an unlisted name was ignored
# GATES (each deterministic; each has a failing fixture in --selftest)
#   D1 chat_rows_canary    canary skill rows with trigger=chat after the deploy (a command reached the runner): must be 0
#   D2 grants_canary       canary `_chatgate_mode` rows with commands!=none (the bench allowlist must be EMPTY): must be 0
#   D3 talk_rows_canary    T6: canary `_say` rows (TALK is not in this build; with it off there are none): must be 0
#   ARMS rows_control_post control `_chatgate_mode` / `_chat_ignored` rows after the deploy: must be 0
#   LIVENESS               canary `_chatgate_mode` >= 1
#   INSTRUMENT             the same walk sees decisions on both arms (rows with an llm:* trigger), so a 0 above is a 0 of a
#                          walk that could see rows (CLAUDE.md: every negative claim carries a positive control)
# EXPOSURE   canary bot-h with the gate active (bots that wrote `_chatgate_mode`, x window) >= 48
# REPORTED   `_chat_ignored` counts (ignored / addressed) on each arm; chat-triggered rows on control (the base still obeys).
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict

KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
KEEP = ('_chatgate_mode', '_chat_ignored', '_say')
EXPOSURE_BH = 48


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def judge(rows, W=180):
    """rows: dicts {t, per, arm, name, trigger, detail, bot}. -> fields (pure)."""
    c = Counter()
    lic_bots = defaultdict(set)
    ign = Counter()
    for r in rows:
        a, p, n = r['arm'], r['per'], r['name']
        trig = r.get('trigger') or ''
        if trig.startswith('llm:'):
            c[('llm', p, a)] += 1
        if trig == 'chat' and not (n or '').startswith('_'):
            c[('chat', p, a)] += 1
        if n == '_chatgate_mode':
            c[('lic', p, a)] += 1
            lic_bots[(p, a)].add(r['bot'])
            if kv(r['detail']).get('commands', 'none') != 'none':
                c[('grant', p, a)] += 1
        elif n == '_chat_ignored':
            c[('ign_rows', p, a)] += 1
            f = kv(r['detail'])
            try:
                ign[('ignored', a)] += int(f.get('ignored', 0)); ign[('addressed', a)] += int(f.get('addressed', 0))
            except ValueError:
                pass
        elif n == '_say':
            c[('say', p, a)] += 1
    out = {}
    out['chat_rows_canary'] = c[('chat', 'post', 'canary')]
    out['chat_rows_control'] = c[('chat', 'post', 'control')]
    out['grants_canary'] = c[('grant', 'post', 'canary')]
    out['talk_rows_canary'] = c[('say', 'post', 'canary')]
    out['rows_control_post'] = c[('lic', 'post', 'control')] + c[('ign_rows', 'post', 'control')]
    out['licence_canary'] = c[('lic', 'post', 'canary')]
    out['liveness'] = int(out['licence_canary'] >= 1)
    out['instrument_control'] = int(c[('llm', 'post', 'canary')] >= 1 and c[('llm', 'post', 'control')] >= 1)
    out['llm_rows_canary'] = c[('llm', 'post', 'canary')]; out['llm_rows_control'] = c[('llm', 'post', 'control')]
    out['gate_bots_canary'] = len(lic_bots[('post', 'canary')])
    out['gate_bh_canary'] = round(out['gate_bots_canary'] * W / 60, 1)
    out['exposure_ready'] = int(out['gate_bh_canary'] >= EXPOSURE_BH and out['liveness'] == 1)
    out['ignored_canary'] = ign[('ignored', 'canary')]; out['addressed_canary'] = ign[('addressed', 'canary')]
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail='', bot='hive-a-Alpha', arm='canary', per='post', trigger='reflex': {
        't': T0, 'per': per, 'arm': arm, 'name': name, 'trigger': trigger, 'detail': detail, 'bot': bot}
    LIC = 'phase=mode commands=none grants=- dropped_entries=0 dropped_verbs=0 grantable=status|help peer_ingest=retired'
    base = [R('gather', trigger='llm:idle'), R('gather', trigger='llm:idle', arm='control', bot='hive-c-Alpha')]
    lic = [R('_chatgate_mode', LIC, bot='hive-a-%s' % b) for b in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
    lic += [R('_chatgate_mode', LIC, bot='board-a-%s' % b) for b in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
    lic += [R('_chatgate_mode', LIC, bot='board-b-%s' % b) for b in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
    lic += [R('_chatgate_mode', LIC, bot='hive-b-%s' % b) for b in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
    ok = judge(base + lic, W=180)
    for k in ('chat_rows_canary', 'grants_canary', 'talk_rows_canary', 'rows_control_post'):
        assert ok[k] == 0, (k, ok)
    assert ok['liveness'] == 1 and ok['instrument_control'] == 1, ok
    assert ok['gate_bots_canary'] == 20 and ok['gate_bh_canary'] == 60.0 and ok['exposure_ready'] == 1, ok
    assert judge(base + lic[:10], W=180)['exposure_ready'] == 0, '10 bots x 3 h = 30 bot-h < 48'
    # D1: a command reached the canary runner
    assert judge(base + lic + [R('goto', trigger='chat')])['chat_rows_canary'] == 1, 'D1'
    assert judge(base + lic + [R('goto', trigger='chat', arm='control', bot='hive-c-Alpha')])['chat_rows_canary'] == 0, 'D1 control: the base still obeys (reported only)'
    assert judge(base + lic + [R('_chatgate_mode', LIC, trigger='chat')])['chat_rows_canary'] == 0, 'an event row is never a dispatched skill'
    # D2: a bench grant
    assert judge(base + lic + [R('_chatgate_mode', LIC.replace('commands=none grants=-', 'commands=allowlist grants=mike:status'))])['grants_canary'] == 1, 'D2'
    # D3: T6
    assert judge(base + lic + [R('_say', 'line=x')])['talk_rows_canary'] == 1, 'D3'
    # ARMS
    assert judge(base + lic + [R('_chatgate_mode', LIC, arm='control', bot='hive-c-Alpha')])['rows_control_post'] == 1, 'ARMS'
    assert judge(base + lic + [R('_chatgate_mode', LIC, arm='control', bot='hive-c-Alpha', per='pre')])['rows_control_post'] == 0, 'ARMS: pre rows are not post'
    # LIVENESS / INSTRUMENT
    assert judge(base)['liveness'] == 0
    assert judge(lic)['instrument_control'] == 0, 'no decisions seen: blind'
    ig = judge(base + lic + [R('_chat_ignored', 'ignored=4 addressed=2 secs=60')])
    assert ig['ignored_canary'] == 4 and ig['addressed_canary'] == 2, ig
    assert pool_of('self-isolated-b-Comet') == 'isolated-b'
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lib.telemetry import Events
    ovr = os.environ.get('CANARY_DRYRUN')
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
    else:
        man = json.load(open('/srv/mcbots/trial-manifest.json'))
        CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 180)
    END, PRE = CUT + dt.timedelta(minutes=W), CUT - dt.timedelta(minutes=W)

    def load_window(since, until):
        """Rotation-aware: day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    raw = load_window(PRE, END)
    rows, walked, offbuild = [], 0, 0
    bots = defaultdict(set)
    for r in raw:
        b = (r.get('bot') or {}).get('name')
        t = r.get('t')
        if not b or t is None:
            continue
        walked += 1
        arm = 'canary' if pool_of(b) in CANS else 'control'
        per = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and per == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(per, arm)].add(b)
        name = (((r.get('raw') or {}).get('skill') or {}).get('name')) or r.get('name')
        trig = (r.get('raw') or {}).get('trigger') or ''
        if name in KEEP or trig == 'chat' or trig.startswith('llm:'):
            rows.append({'t': t, 'per': per, 'arm': arm, 'name': name, 'trigger': trig, 'detail': r.get('detail') or '', 'bot': b})
    res = judge(rows, W=W)
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, offbuild, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0)))
    print('INSTRUMENT   decisions seen (llm:* rows) canary %d control %d -> %s' % (res['llm_rows_canary'], res['llm_rows_control'], 'ok' if res['instrument_control'] else 'BLIND'))
    print('DEFECTS      D1 chat-triggered skill rows on the canary %d (control %d, reported: the base still obeys) | D2 bench grants %d | D3 T6 `_say` rows %d | ARMS control rows %d'
          % (res['chat_rows_canary'], res['chat_rows_control'], res['grants_canary'], res['talk_rows_canary'], res['rows_control_post']))
    print('LIVENESS     licence rows %d on %d canary bots -> %s' % (res['licence_canary'], res['gate_bots_canary'], 'ok' if res['liveness'] else 'NOT LIVE'))
    print('EXPOSURE     gate-active canary bot-h %.1f (need %d) -> %s' % (res['gate_bh_canary'], EXPOSURE_BH, 'READY' if res['exposure_ready'] else 'NOT YET'))
    print('REPORTED     `_chat_ignored` canary ignored %d addressed %d (expected ~0: fleet names never raise `chat`; not evidence either way)'
          % (res['ignored_canary'], res['addressed_canary']))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('chatgateread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
