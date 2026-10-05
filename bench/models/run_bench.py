#!/usr/bin/env python3
"""Replay benchmark runner: the SAME real prompts to one model, one record per item. Runs ON the Studio
(python3.9, stdlib only). Scoring is separate (score.py), so a run is never re-done to change a metric.

    python3 run_bench.py --engine ollama --model qwen3.6:35b-a3b --label q36-35b \
        --sets brain,stuck,overseer --concurrency 4 --think false [--stuck-think true] [--limit N]
    python3 run_bench.py --engine openai --url http://127.0.0.1:1234 --model <lmstudio id> ...

SETS
  brain     the fleet's own system prompt (rebuilt from the deployed source, matched by system_hash),
            the logged user prompt verbatim, the fleet's JSON schema as a grammar, temperature 0.7,
            num_ctx 8192, num_predict 512 -- exactly what the bot sends (bots/src/llm.mjs).
  stuck     the same, plus an ESCALATION addendum and the bot's last 25 body-log rows, and a
            `diagnosis` field first in the schema; num_ctx 16384; thinking per --stuck-think.
  overseer  the shadow mayor's frontier replay prompt (mayor_frontier.SYSTEM + build_prompt, blind),
            OUTPUT_SCHEMA as the grammar; num_ctx 16384; thinking per --overseer-think.

Timing fields are Ollama's own (prompt_eval/eval durations); for the OpenAI engine only wall time and
usage counts exist. load_s > 0.5 marks a reload (eviction) and is excluded from latency stats.
"""
import argparse, concurrent.futures as cf, copy, json, os, sys, threading, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'mayor'))

ESCALATION = """

ESCALATION MODE. This bot has been flagged as STUCK: it has stayed in about the same place for many
minutes and its usual decisions have not freed it. You are the senior advisor called in for this hard
case. Besides the usual observation you also get its RECENT BODY LOG: its last reflex and skill rows,
oldest first, with the game's own failure details.
1. In `diagnosis`, say briefly why it is stuck: what blocks it, what it carries, what it lacks.
2. Choose the ONE next action most likely to get it moving again. It must be performable FROM WHERE
   THE BOT IS, with what it CARRIES now. Do not repeat an action the log shows failing again and again
   here unless you change what makes it fail (different args, a different block, a different place)."""


def load_jsonl(p):
    with open(p) as fh:
        return [json.loads(l) for l in fh if l.strip()]


def brain_messages(item, sysp):
    sp = sysp[item['system_hash']]
    system = sp['template'].replace('<BOT>', item['bot']).replace('<ROLE>', item['role'] or 'gatherer')
    return [{'role': 'system', 'content': system}, {'role': 'user', 'content': item['prompt_text']}], sp['schema']


NOISE = ('_affordance_scan', '_chunks_evicted', '_plant_spot', '_store_sample', '_memory_sample')


def compact_rows(rows, t_ref, max_lines=30):
    """Oldest first. Consecutive rows with the same name+status+detail prefix collapse to one line with
    a count (reflex rows repeat dozens of times a minute); the newest `max_lines` lines are kept."""
    import re
    groups = []
    for r in rows:
        if r.get('name') in NOISE:
            continue
        k = (r.get('name'), r.get('status'), re.sub(r'\d+', 'N', r.get('detail') or '')[:40])
        if groups and groups[-1][0] == k:
            groups[-1][1].append(r)
        else:
            groups.append((k, [r]))
    out = []
    for _, g in groups[-max_lines:]:
        line = _one_row(g[-1], t_ref)
        if len(g) > 1:
            line += '  (x%d since %+ds)' % (len(g), _dt(g[0]['t'], t_ref))
        out.append(line)
    return '\n'.join(out)


def _dt(t, t_ref):
    try:
        return int(time.mktime(time.strptime(t[:19], '%Y-%m-%dT%H:%M:%S')) -
                   time.mktime(time.strptime(t_ref[:19], '%Y-%m-%dT%H:%M:%S')))
    except Exception:
        return 0


def _one_row(r, t_ref):
    out = []
    for r in [r]:
        try:
            dt = (time.mktime(time.strptime(r['t'][:19], '%Y-%m-%dT%H:%M:%S')) -
                  time.mktime(time.strptime(t_ref[:19], '%Y-%m-%dT%H:%M:%S')))
        except Exception:
            dt = 0
        pos = r.get('pos') or {}
        p = ' @%d,%d,%d' % (pos['x'], pos['y'], pos['z']) if all(isinstance(pos.get(k), (int, float)) for k in 'xyz') else ''
        args = r.get('args') or {}
        a = (' ' + json.dumps(args, separators=(',', ':'))) if args else ''
        out.append('  %+5ds %s%s -> %s: %s%s' % (dt, r.get('name'), a[:80], r.get('status'), (r.get('detail') or '')[:200], p))
    return out[0]


def stuck_messages(item, sysp):
    msgs, schema = brain_messages(item, sysp)
    msgs[0]['content'] += ESCALATION
    text = item['prompt_text']
    cut = text.rfind('saw_end:')
    log = 'RECENT BODY LOG (seconds before this decision; oldest first):\n' + compact_rows(item.get('recent_rows') or [], item['t'])
    msgs[1]['content'] = text[:cut] + log + '\n' + text[cut:]
    schema = copy.deepcopy(schema)
    props = {'diagnosis': {'type': 'string', 'maxLength': 400}}
    props.update(schema['properties'])
    schema['properties'] = props
    schema['required'] = ['diagnosis'] + schema['required']
    return msgs, schema


def overseer_messages(item):
    import mayor_frontier as F, mayor_core as core
    return [{'role': 'system', 'content': F.SYSTEM},
            {'role': 'user', 'content': F.build_prompt(item['snap'])}], core.OUTPUT_SCHEMA


def think_value(s):
    if s in (None, '', 'none'):
        return None
    return {'true': True, 'false': False}.get(s, s)


def call_ollama(a, msgs, schema, num_ctx, num_predict, think):
    body = {'model': a.model, 'stream': False, 'keep_alive': '30m', 'messages': msgs, 'format': schema,
            'options': {'temperature': a.temperature, 'num_ctx': num_ctx, 'num_predict': num_predict}}
    if think is not None:
        body['think'] = think
    req = urllib.request.Request(a.url.rstrip('/') + '/api/chat', data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=a.timeout) as r:
        d = json.loads(r.read())
    m = d.get('message') or {}
    ns = lambda k: (d.get(k) or 0) / 1e9
    return {'content': m.get('content') or '', 'thinking_chars': len(m.get('thinking') or ''),
            'thinking_tail': (m.get('thinking') or '')[-600:],
            'served_model': d.get('model'), 'done_reason': d.get('done_reason'),
            'prompt_tokens': d.get('prompt_eval_count'), 'gen_tokens': d.get('eval_count'),
            'prompt_eval_s': ns('prompt_eval_duration'), 'eval_s': ns('eval_duration'), 'load_s': ns('load_duration'),
            'total_s': ns('total_duration')}


def call_openai(a, msgs, schema, num_ctx, num_predict, think):
    body = {'model': a.model, 'messages': msgs, 'temperature': a.temperature, 'max_tokens': num_predict,
            'stream': False,
            'response_format': {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': schema}}}
    if isinstance(think, str):
        body['reasoning_effort'] = think
    req = urllib.request.Request(a.url.rstrip('/') + '/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=a.timeout) as r:
        d = json.loads(r.read())
    ch = (d.get('choices') or [{}])[0]
    m = ch.get('message') or {}
    u = d.get('usage') or {}
    st = d.get('stats') or {}
    return {'content': m.get('content') or '', 'thinking_chars': len(m.get('reasoning_content') or m.get('reasoning') or ''),
            'served_model': d.get('model'), 'done_reason': ch.get('finish_reason'),
            'prompt_tokens': u.get('prompt_tokens'), 'gen_tokens': u.get('completion_tokens'),
            'ttft_s': st.get('time_to_first_token'), 'gen_tps': st.get('tokens_per_second')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', choices=('ollama', 'openai'), default='ollama')
    ap.add_argument('--url', default=None)
    ap.add_argument('--model', required=True)
    ap.add_argument('--label', required=True)
    ap.add_argument('--sets', default='brain,stuck,overseer')
    ap.add_argument('--concurrency', type=int, default=4)
    ap.add_argument('--think', default='none', help='brain: none|false|true|low|medium|high')
    ap.add_argument('--stuck-think', default=None, help='default: same as --overseer-think')
    ap.add_argument('--overseer-think', default='none')
    ap.add_argument('--temperature', type=float, default=0.7)
    ap.add_argument('--timeout', type=float, default=900)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--ids', default='', help='comma list of item ids to run (subset)')
    ap.add_argument('--ids-file', default='', help='file with one item id per line (e.g. data/screen_ids.txt)')
    ap.add_argument('--extra', default='', help='extra sample file(s) under data/, comma list (e.g. mbench-sample-x.jsonl)')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    a.url = a.url or ('http://127.0.0.1:11434' if a.engine == 'ollama' else 'http://127.0.0.1:1234')
    if a.stuck_think is None:
        a.stuck_think = a.overseer_think
    out = a.out or os.path.join(HERE, 'out', a.label + '.jsonl')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    done = set()
    if os.path.exists(out):
        for r in load_jsonl(out):
            if not r.get('error'):
                done.add(r['id'])
    sysp = json.load(open(os.path.join(HERE, 'data', 'system_prompts.json')))
    items = load_jsonl(os.path.join(HERE, 'data', 'mbench-sample.jsonl')) + load_jsonl(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))
    for x in filter(None, a.extra.split(',')):
        items += load_jsonl(os.path.join(HERE, 'data', x))
    sets = a.sets.split(',')
    want = set(a.ids.split(',')) if a.ids else None
    if a.ids_file:
        want = (want or set()) | {l.strip() for l in open(os.path.join(HERE, a.ids_file)) if l.strip()}
    order = {s: i for i, s in enumerate(sets)}
    for x in sets:
        if x.startswith('b') and x != 'brain' and os.path.exists(os.path.join(HERE, 'data', 'stage-%s.jsonl' % x)):
            items += load_jsonl(os.path.join(HERE, 'data', 'stage-%s.jsonl' % x))
    items = sorted([i for i in items if i['set'] in sets and (want is None or i['id'] in want)], key=lambda i: (order[i['set']], i['id']))
    if a.limit:
        per = {}
        keep = []
        for i in items:
            per[i['set']] = per.get(i['set'], 0) + 1
            if per[i['set']] <= a.limit:
                keep.append(i)
        items = keep
    items = [i for i in items if i['id'] not in done]
    fn = call_ollama if a.engine == 'ollama' else call_openai
    lock = threading.Lock()
    fh = open(out, 'a')
    print('%s: %d items to run (%d already done) -> %s' % (a.label, len(items), len(done), out), flush=True)

    def run(item):
        s = item['set']
        if 'messages' in item:
            # Stage B suites ship their request prebuilt: messages, schema, and which role's settings apply.
            msgs, schema, ctx = item['messages'], item['schema'], item.get('num_ctx', 16384)
            if item.get('role') == 'brain':
                npred, think = 512, think_value(a.think)
            else:
                npred, think = 8192, think_value(a.stuck_think)
        elif s == 'brain':
            msgs, schema = brain_messages(item, sysp); ctx, npred, think = 8192, 512, think_value(a.think)
        elif s == 'stuck':
            msgs, schema = stuck_messages(item, sysp); ctx, npred, think = 16384, 8192, think_value(a.stuck_think)
        else:
            msgs, schema = overseer_messages(item); ctx, npred, think = 16384, 8192, think_value(a.overseer_think)
        role_brain = item.get('role') == 'brain' if 'messages' in item else s == 'brain'
        if think not in (None, False) and role_brain:
            npred = 4096
        if think in (None, False) and not role_brain:
            # Without thinking the answer is a few hundred tokens. A larger cap only lets a model that
            # pads JSON with endless whitespace (legal in the grammar) run for 15 minutes: measured on
            # qwen2.5:7b stuck items, 900 s timeouts. 1024 is ~3x the longest valid overseer answer.
            npred = 1024
        rec = {'id': item['id'], 'set': s, 'label': a.label, 'model': a.model, 'engine': a.engine,
               'think': think, 'concurrency': a.concurrency, 't_start': time.time()}
        try:
            try:
                rec.update(fn(a, msgs, schema, ctx, npred, think))
            except urllib.error.HTTPError as e:
                body = e.read(300).decode('utf-8', 'replace')
                # A model with no thinking mode rejects ANY think value on some Ollama builds: retry once
                # without it, and record that the setting was not applicable.
                if think is not None and 'think' in body.lower():
                    rec['think'] = 'n/a'
                    rec.update(fn(a, msgs, schema, ctx, npred, None))
                else:
                    raise urllib.error.HTTPError(e.url, e.code, body, e.hdrs, None)
            rec['error'] = None
        except urllib.error.HTTPError as e:
            rec['error'] = 'http_%d: %s' % (e.code, str(e.msg)[:300])
        except Exception as e:
            rec['error'] = '%s: %s' % (type(e).__name__, str(e)[:300])
        rec['t_end'] = time.time()
        rec['wall_s'] = rec['t_end'] - rec['t_start']
        with lock:
            fh.write(json.dumps(rec) + '\n'); fh.flush()
        return rec

    t0 = time.time()
    n = errs = 0
    with cf.ThreadPoolExecutor(max_workers=a.concurrency) as ex:
        for rec in ex.map(run, items):
            n += 1
            errs += bool(rec['error'])
            if n % 20 == 0 or rec['error']:
                print('  %d/%d  %.0fs  errors %d  last %s %.1fs %s' % (n, len(items), time.time() - t0, errs, rec['id'],
                      rec['wall_s'], (rec['error'] or '')[:120]), flush=True)
            if errs >= 25 and errs > n * 0.5:
                print('ABORT: too many errors', flush=True)
                os._exit(3)
    print('%s done: %d items in %.0fs, %d errors' % (a.label, n, time.time() - t0, errs), flush=True)


if __name__ == '__main__':
    main()
