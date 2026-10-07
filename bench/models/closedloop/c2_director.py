#!/usr/bin/env python3
"""Stage C2 director (runs ON THE BOTS HOST next to the bench bots; bench-only). One process per run.

    python3 c2_director.py --run-dir ~/mbench-cl/runs/<run_id> --arm none|det|ov|esc|ov+esc \
        --world mbench-<run_id> --endpoint http://10.0.0.70:11502 --ov-model gpt-oss:120b --ov-think medium \
        --esc-model gpt-oss:120b --esc-think medium --outbox ~/mbench-c2/<run_id>/outbox.jsonl

What it does (C2-DESIGN-DRAFT.md rev 2):
  * runs the shadow mayor's own live loop (pinned deployed code, /home/mike/mcai-mayor/scripts/mayor) over THIS run's
    logs -> a snapshot + the deterministic assignment every 5 min (outside the run dir: the run dir holds bots only);
  * OVERSEER (arm det: the deterministic assignment; arm ov / ov+esc: the LLM with the mayor's frontier prompt and
    schema, validated by mayor_core.validate) -> NEW assignments become directives (duty -> skill steps), at most one
    model request in flight, leases 10 min;
  * STUCK ESCALATION: the trigger is computed IN EVERY ARM (shadow, intent-to-treat): within 8 blocks of the window
    start for 5 min AND >= 3 failed / rejected / unknown decisions in the window; 5-min cooldown; at most 3 per
    episode; an episode ends when the bot is 8+ blocks from where it started. Only arms esc / ov+esc act on it: the
    stuck prompt of Stage B1 (the bot's own latest observation + its collapsed body log + the ESCALATION addendum)
    to the escalation model -> one directive step.
  * every decision, model call (latency, validity), trigger and directive is a JSON line in --log.
Directives go to --outbox; c2_chat.mjs (the `mbench-Mayor` client in the world) says them in chat.
"""
import argparse, calendar, glob, json, math, os, signal, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MAYOR = '/home/mike/mcai-mayor/scripts/mayor'
sys.path.insert(0, MAYOR)
sys.path.insert(0, HERE)
import mayor_core as core            # noqa: E402
import mayor_frontier as F           # noqa: E402
import run_bench as R                # noqa: E402  (stuck prompt construction, identical to Stage B1)

LEASE_S = 600


def _pick(recipe):
    """The pickaxe a RESTORE_PICK candidate's recipe names (the mayor only marks it feasible with the ingredients held)."""
    txt = json.dumps(recipe) if recipe is not None else ''
    for item in ('iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'):
        if item in txt:
            return item
    return 'stone_pickaxe'
DUTY_STEPS = {
    'FREE_BAG': lambda c, res: [{'skill': 'deposit', 'args': {}}],
    'RESTORE_PICK': lambda c, res: [{'skill': 'craft', 'args': {'item': _pick(c.get('recipe')), 'count': 1}}],
    'GET_WOOD': lambda c, res: ([{'skill': 'goto', 'args': {k: int(res[k]) for k in 'xyz'}}] if res else []) +
                                [{'skill': 'gather', 'args': {'block': (res or {}).get('kind', 'oak_log'), 'count': 16}}],
    'GET_IRON': lambda c, res: ([{'skill': 'goto', 'args': {k: int(res[k]) for k in 'xyz'}}] if res else []) +
                                [{'skill': 'gather', 'args': {'block': (res or {}).get('kind', 'iron_ore'), 'count': 3}}],
}


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


class Director:
    def __init__(self, a):
        self.a = a
        self.log_f = open(a.log, 'a')
        self.sent = {}                     # bot -> (origin, expires_at)
        self.seq = 0
        self.last_snap = None
        self.esc = {}                      # bot -> {'start': pos, 'n': escalations, 'last': t, 'episode_t': t}
        self.sysp = json.load(open(os.path.join(HERE, 'system_prompts.json')))

    def log(self, **kw):
        kw['t'] = now(); self.log_f.write(json.dumps(kw) + '\n'); self.log_f.flush()

    def send(self, bot, origin, steps, why):
        if not steps:
            return
        self.seq += 1
        did = '%s%d' % ('o' if origin == 'overseer' else 'e', self.seq)
        d = {'bot': bot, 'id': did, 'o': origin, 's': steps, 'l': LEASE_S, 'w': why[:60]}
        with open(self.a.outbox, 'a') as fh:
            fh.write(json.dumps(d, separators=(',', ':')) + '\n')
        self.sent[bot] = (origin, time.time() + LEASE_S)
        self.log(kind='directive_sent', bot=bot, id=did, origin=origin, steps=steps, why=why[:120])

    # ---------------------------------------------------------------- overseer --------------------------------
    def latest(self, name):
        p = os.path.join(self.a.mayor_out, '%s-%s.jsonl' % (name, self.a.world))
        if not os.path.exists(p):
            return None
        last = None
        with open(p) as fh:
            for line in fh:
                last = line
        return json.loads(last) if last else None

    def ollama(self, model, think, msgs, schema, num_ctx, num_predict):
        body = {'model': model, 'stream': False, 'keep_alive': '30m', 'messages': msgs, 'format': schema,
                'options': {'temperature': 0.7, 'num_ctx': num_ctx, 'num_predict': num_predict}}
        if think not in (None, 'none'):
            body['think'] = {'true': True, 'false': False}.get(think, think)
        t0 = time.time()
        req = urllib.request.Request(self.a.endpoint.rstrip('/') + '/api/chat', data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=600) as r:
            d = json.loads(r.read())
        return (d.get('message') or {}).get('content') or '', time.time() - t0, d.get('eval_count')

    def overseer_tick(self):
        snap = self.latest('snap')
        if not snap or snap.get('snap_id') == (self.last_snap or {}).get('snap_id'):
            return
        self.last_snap = snap
        a = self.a
        names = {b['id']: b['name'] for b in snap.get('bots', [])}
        res = {r['id']: r for r in snap.get('resources', [])}
        cands = {c['id']: c for c in snap.get('candidates', [])}
        if a.arm == 'det':
            rec = self.latest('assign') or {}
            acc = [x for x in rec.get('assignments', []) if rec.get('snap_id') == snap['snap_id'] and x.get('lease') == 'new']
            self.log(kind='overseer_decision', engine='deterministic', snap_id=snap['snap_id'], n=len(acc))
        elif a.arm in ('ov', 'ov+esc'):
            msgs = [{'role': 'system', 'content': F.SYSTEM}, {'role': 'user', 'content': F.build_prompt(snap)}]
            try:
                content, dt, ntok = self.ollama(a.ov_model, a.ov_think, msgs, core.OUTPUT_SCHEMA, 16384, 8192)
                out = json.loads(content) if content.strip() else None
            except Exception as e:
                self.log(kind='overseer_call', ok=False, err=str(e)[:200]); return
            cfg = dict(core.DEFAULTS); cfg.update(snap.get('cfg') or {})
            v = core.validate(snap, out, cfg) if out is not None else {'valid': False, 'accepted': [], 'rejected': [], 'errors': ['no_json']}
            acc = v['accepted']
            self.log(kind='overseer_call', ok=True, s=round(dt, 1), gen_tokens=ntok, valid=v['valid'], accepted=len(acc),
                     rejected=[r['why'] for r in v['rejected']][:6], snap_id=snap['snap_id'])
        else:
            return
        for x in acc:
            c = cands.get(x.get('candidate_id')) or {}
            bot = names.get(c.get('bot') or x.get('bot'))
            if not bot:
                continue
            busy = self.sent.get(bot)
            if busy and busy[1] > time.time():
                continue                    # one directive per bot per lease
            steps = DUTY_STEPS.get(c.get('duty'), lambda *_: [])(c, res.get(x.get('target')))
            self.send(bot, 'overseer', steps, '%s %s' % (c.get('duty'), (x.get('reason') or '')[:40]))

    # ---------------------------------------------------------------- escalation ------------------------------
    def bot_rows(self, bot, minutes=6):
        rows = []
        cut = time.time() - minutes * 60
        for p in (os.path.join(self.a.run_dir, bot, 'skill-%s.jsonl' % bot), os.path.join(self.a.run_dir, bot, 'llm-%s.jsonl' % bot)):
            if not os.path.exists(p):
                continue
            with open(p, 'rb') as fh:
                fh.seek(0, 2); size = fh.tell(); fh.seek(max(0, size - 600_000))
                for line in fh.read().decode('utf-8', 'replace').splitlines()[1:]:
                    try:
                        r = json.loads(line)
                    except ValueError:
                        continue
                    ts = r.get('@timestamp', '')
                    try:
                        t = calendar.timegm(time.strptime(ts[:19], '%Y-%m-%dT%H:%M:%S'))
                    except ValueError:
                        continue
                    if t >= cut:
                        r['_t'] = t; r['_src'] = 'llm' if p.endswith('.jsonl') and '/llm-' in p else 'skill'
                        rows.append(r)
        return sorted(rows, key=lambda r: r['_t'])

    def esc_tick(self):
        a = self.a
        bots = [os.path.basename(d.rstrip('/')) for d in glob.glob(os.path.join(a.run_dir, '*/')) if not d.rstrip('/').endswith('-state')]
        tnow = time.time()
        for bot in bots:
            rows = self.bot_rows(bot, 5)
            pos = [(r['_t'], (r.get('bot') or {}).get('pos')) for r in rows if isinstance((r.get('bot') or {}).get('pos'), dict)]
            if len(pos) < 3 or tnow - pos[0][0] < 240:
                continue
            p0 = pos[0][1]
            far = max(math.dist([p[k] for k in 'xyz'], [p0[k] for k in 'xyz']) for _, p in pos if all(isinstance(p.get(k), (int, float)) for k in 'xyz'))
            bad = sum(1 for r in rows if r['_src'] == 'llm' and (r.get('outcome') or {}).get('status') in ('failed', 'aborted', 'unknown'))
            st = self.esc.get(bot)
            cur = pos[-1][1]
            if st and math.dist([cur[k] for k in 'xyz'], [st['start'][k] for k in 'xyz']) >= 8:
                self.log(kind='episode_end', bot=bot, minutes=round((tnow - st['episode_t']) / 60, 1), escalations=st['n'])
                self.esc.pop(bot); st = None
            if far > 8 or bad < 3:
                continue
            if st is None:
                st = self.esc[bot] = {'start': cur, 'n': 0, 'last': 0, 'episode_t': tnow}
                self.log(kind='episode_start', bot=bot, pos=cur, bad=bad)
            if tnow - st['last'] < 300 or st['n'] >= 3:
                continue
            st['last'] = tnow; st['n'] += 1
            self.log(kind='escalation_trigger', bot=bot, n=st['n'], bad=bad, acting=a.arm in ('esc', 'ov+esc'))
            if a.arm not in ('esc', 'ov+esc'):
                continue
            busy = self.sent.get(bot)
            if busy and busy[0] == 'escalation' and busy[1] > tnow:
                continue
            llm = [r for r in rows if r['_src'] == 'llm' and (r.get('prompt') or {}).get('text')]
            if not llm:
                llm = [r for r in self.bot_rows(bot, 30) if r['_src'] == 'llm' and (r.get('prompt') or {}).get('text')]
            if not llm:
                continue
            last = llm[-1]
            body = [{'t': r.get('@timestamp'), 'trigger': r.get('trigger'), 'name': (r.get('skill') or {}).get('name'),
                     'args': (r.get('skill') or {}).get('args'), 'status': (r.get('skill') or {}).get('status'),
                     'detail': ((r.get('skill') or {}).get('detail') or '')[:220], 'pos': (r.get('bot') or {}).get('pos')}
                    for r in self.bot_rows(bot, 12) if r['_src'] == 'skill']
            item = {'bot': bot, 'role': (last.get('bot') or {}).get('role') or 'gatherer', 'system_hash': '4245ef45b42e430b',
                    'prompt_text': last['prompt']['text'], 't': last['@timestamp'], 'recent_rows': body[-150:]}
            msgs, schema = R.stuck_messages(item, self.sysp)
            try:
                content, dt, ntok = self.ollama(a.esc_model, a.esc_think, msgs, schema, 16384, 8192)
                ans = json.loads(content) if content.strip() else None
            except Exception as e:
                self.log(kind='escalation_call', ok=False, bot=bot, err=str(e)[:200]); continue
            ok = isinstance(ans, dict) and isinstance(ans.get('skill'), str) and isinstance(ans.get('args'), dict)
            self.log(kind='escalation_call', ok=ok, bot=bot, s=round(dt, 1), gen_tokens=ntok,
                     diagnosis=(ans or {}).get('diagnosis', '')[:200] if ok else None, skill=(ans or {}).get('skill') if ok else None)
            if ok:
                args = {k: v for k, v in ans['args'].items() if k != 'player'}
                self.send(bot, 'escalation', [{'skill': ans['skill'], 'args': args}], (ans.get('diagnosis') or '')[:60])

    def run(self):
        last_ov = 0
        while True:
            try:
                if time.time() - last_ov > 30:
                    self.overseer_tick(); last_ov = time.time()
                self.esc_tick()
            except Exception as e:
                self.log(kind='director_error', err=str(e)[:300])
            time.sleep(30)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run-dir', required=True); ap.add_argument('--arm', required=True, choices=('none', 'det', 'ov', 'esc', 'ov+esc'))
    ap.add_argument('--world', required=True); ap.add_argument('--endpoint', default='http://10.0.0.70:11502')
    ap.add_argument('--ov-model', default='gpt-oss:120b'); ap.add_argument('--ov-think', default='medium')
    ap.add_argument('--esc-model', default='gpt-oss:120b'); ap.add_argument('--esc-think', default='medium')
    ap.add_argument('--outbox', required=True); ap.add_argument('--log', required=True); ap.add_argument('--mayor-out', required=True)
    ap.add_argument('--interval', type=int, default=300)
    a = ap.parse_args()
    os.makedirs(a.mayor_out, exist_ok=True)
    # the shadow mayor's own live loop over THIS run's logs (pinned deployed code); facts via per-bot links made by
    # the caller in <mayor_out>/../facts (outside the run dir, which must hold bots only)
    facts = os.path.join(os.path.dirname(a.mayor_out), 'facts')
    shadow = subprocess.Popen([sys.executable, os.path.join(MAYOR, 'mayor_shadow.py'), '--logs', os.path.join(a.run_dir, '*', 'skill-*.jsonl'),
                               '--facts-root', facts, '--out-dir', a.mayor_out, '--allow-out-root', os.path.dirname(a.mayor_out),
                               '--interval', str(a.interval), '--nice', '10', '--mem-limit-mb', '0'],
                              stdout=open(os.path.join(os.path.dirname(a.mayor_out), 'shadow.out'), 'a'), stderr=subprocess.STDOUT)

    def bye(*_):
        shadow.terminate(); sys.exit(0)
    signal.signal(signal.SIGTERM, bye)
    try:
        Director(a).run()
    finally:
        shadow.terminate()


if __name__ == '__main__':
    main()
