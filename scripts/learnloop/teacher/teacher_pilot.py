#!/usr/bin/env python3
"""learning loop: the paid-teacher PILOT client (design s.2.4). Runs on the MAC MINI ONLY -- the keys live there.

    python3 teacher_pilot.py plan   --pilot ~/learnloop/teacher/pilot-1000.jsonl            # DRY RUN (default verb)
    python3 teacher_pilot.py submit --pilot ... --arm B --condition blind --i-will-spend     # owner-run, spends money
    python3 teacher_pilot.py poll   --arm B                                                  # status of open batches
    python3 teacher_pilot.py fetch  --arm B                                                  # results -> quarantine

ARMS (s.2.4): B = Claude Opus 5.5 (claude-opus-5-5) via the Anthropic Message Batches API; C = OpenAI gpt-6.1-sol via
the OpenAI Batch API. Arm A (gemma4:26b on the Studio) is local and free and is not run by this client.
CONDITIONS: blind (scored) = the rebuilt system prompt + the logged user prompt, exactly what the fleet model saw, the
fleet's JSON schema as the output format; informed (label generation only, the 200 judged items) = the same plus the
logged action, its outcome and a teacher instruction.
REQUEST SHAPE: Anthropic -- thinking is not configurable on Opus 5.5 (it cannot be disabled), so effort is set to
`low` in output_config, with output_config.format = the fleet schema; NO server-side model fallback (a refusal stays a
refusal of THIS arm -- a fallback model's answer would contaminate the arm). OpenAI -- chat completions body with
response_format json_schema (strict) and reasoning_effort `low`. Schema compatibility with each vendor's structured-
output subset is NOT assumed: `submit` refuses until a 5-item probe of that arm has been fetched and every probe answer
parsed (`--probe` sends exactly 5 requests).

MONEY (s.2.4 "Monthly cap"). Caps: $100 / month / vendor (owner). Ledger ~/learnloop/spend.jsonl (append-only):
  estimate rows at submit, actual rows from every fetched result's usage. Month-to-date = actuals + the estimates of
  batches not yet fetched. A batch is REFUSED if month-to-date + its estimate > 80% of the vendor cap (room for the
  vendors' enforcement lag). Batches are split to <= $10 each. A 429 is never retried. Prices are batch list prices
  (50% of standard), per million tokens: claude-opus-5-5 $2 in / $10 out; gpt-6.1-sol $1 in / $5 out.
ESTIMATE: input = the item's own qwen prompt_tokens (system + user, as Ollama counted them) x 1.35 (other tokenizers;
  Anthropic documents ~1.0-1.35x for its newer tokenizer) + 600 for the informed condition's instruction and logged
  outcome; output = 1,500 per item including thinking (generous; the visible answer is ~80). No caching is assumed,
  so the estimate is an upper bound.
KEYS: ~/.config/mcai/anthropic.key and ~/.config/mcai/openai.key, mode 600. `plan` checks that each exists with mode
  600 and NEVER opens it. Only submit/poll/fetch read a key, at call time, into the SDK client; it is never printed,
  logged, written or put on a command line.
QUARANTINE: results go to ~/learnloop/teacher-paid/<arm>/ with provenance teacher-paid:<vendor>:<model>; the dataset
  builder refuses them for training until a recorded owner decision names the vendor and the use (build_dataset.py).
"""
import argparse, datetime as dt, hashlib, json, math, os, random, stat, sys

HOME = os.path.expanduser('~/learnloop')
LEDGER = os.path.join(HOME, 'spend.jsonl')
KEYS = {'anthropic': '~/.config/mcai/anthropic.key', 'openai': '~/.config/mcai/openai.key'}
ARMS = {'B': {'vendor': 'anthropic', 'model': 'claude-opus-5-5', 'in': 2.0, 'out': 10.0},
        'C': {'vendor': 'openai', 'model': 'gpt-6.1-sol', 'in': 1.0, 'out': 5.0}}
CAP_USD = {'anthropic': 100.0, 'openai': 100.0}
CAP_FRAC = 0.80
BATCH_USD = 10.0
TOK_FACTOR = 1.35
INFORMED_EXTRA = 600
OUT_PER_ITEM = 1500
MAX_TOKENS = 4096
INFORMED_N = 200
TEACHER_INSTRUCTION = ("You are reviewing a decision a smaller model made for this Minecraft bot. The logged decision "
                       "and what happened are below. Choose the ONE action you would take instead, from the same "
                       "observation, as the JSON the schema asks for. Do not repeat an action that was refused or "
                       "failed for a non-transient reason.")


def load(p):
    return [json.loads(l) for l in open(os.path.expanduser(p)) if l.strip()]


def informed_ids(items, n=INFORMED_N, seed=20261022):
    ids = sorted(i['id'] for i in items)
    return set(random.Random(seed).sample(ids, min(n, len(ids))))


def est_tokens(item, condition):
    pt = item.get('prompt_tokens') or int((len(item['system']) + len(item['user'])) / 3.5)
    return int(math.ceil(pt * TOK_FACTOR)) + (INFORMED_EXTRA if condition == 'informed' else 0), OUT_PER_ITEM


def usd(arm, tin, tout):
    a = ARMS[arm]
    return tin / 1e6 * a['in'] + tout / 1e6 * a['out']


def user_text(item, condition):
    if condition == 'blind':
        return item['user']
    lg = item['logged']
    return (item['user'] + '\n\n' + TEACHER_INSTRUCTION + '\nLOGGED DECISION: ' +
            json.dumps({'skill': lg['skill'], 'args': lg['args']}) + '\nWHAT HAPPENED: ' +
            ('refused by the gate: %s' % lg['reason'] if lg['refused'] else '%s: %s' % (lg['status'], (lg['detail'] or '')[:300])))


def anthropic_request(item, condition, arm='B'):
    """One Message Batches request (custom_id, params). Shape per the Anthropic SDK docs (claude-api skill)."""
    return {'custom_id': '%s-%s-%s' % (arm, condition, hashlib.sha1(item['id'].encode()).hexdigest()[:20]),
            'params': {'model': ARMS[arm]['model'], 'max_tokens': MAX_TOKENS, 'system': item['system'],
                       'messages': [{'role': 'user', 'content': user_text(item, condition)}],
                       'output_config': {'effort': 'low', 'format': {'type': 'json_schema', 'schema': item['schema']}}}}


def openai_request(item, condition, arm='C'):
    """One OpenAI Batch API line (/v1/chat/completions)."""
    return {'custom_id': '%s-%s-%s' % (arm, condition, hashlib.sha1(item['id'].encode()).hexdigest()[:20]),
            'method': 'POST', 'url': '/v1/chat/completions',
            'body': {'model': ARMS[arm]['model'], 'max_completion_tokens': MAX_TOKENS, 'reasoning_effort': 'low',
                     'messages': [{'role': 'system', 'content': item['system']},
                                  {'role': 'user', 'content': user_text(item, condition)}],
                     'response_format': {'type': 'json_schema', 'json_schema': {'name': 'decision', 'strict': True,
                                                                                'schema': item['schema']}}}}


def plan_batches(items, arm, condition):
    """-> list of batches, each {'items': [...], 'tin', 'tout', 'usd'}, each <= BATCH_USD."""
    sel = items if condition == 'blind' else [i for i in items if i['id'] in informed_ids(items)]
    out, cur = [], {'items': [], 'tin': 0, 'tout': 0, 'usd': 0.0}
    for it in sorted(sel, key=lambda i: i['id']):
        tin, tout = est_tokens(it, condition); c = usd(arm, tin, tout)
        if cur['items'] and cur['usd'] + c > BATCH_USD:
            out.append(cur); cur = {'items': [], 'tin': 0, 'tout': 0, 'usd': 0.0}
        cur['items'].append(it); cur['tin'] += tin; cur['tout'] += tout; cur['usd'] += c
    if cur['items']:
        out.append(cur)
    return out


def ledger_rows(path=LEDGER):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path) if l.strip()]


def month_to_date(rows, vendor, now=None):
    """Actual spend this UTC month + estimates of batches with no actual yet."""
    now = now or dt.datetime.now(dt.timezone.utc)
    ym = now.strftime('%Y-%m')
    mine = [r for r in rows if r['vendor'] == vendor and r['ts'][:7] == ym]
    actual_batches = {r['batch'] for r in mine if r['kind'] == 'actual'}
    return round(sum(r['usd'] for r in mine if r['kind'] == 'actual') +
                 sum(r['usd'] for r in mine if r['kind'] == 'estimate' and r['batch'] not in actual_batches), 4)


def cap_check(rows, vendor, est, now=None):
    mtd = month_to_date(rows, vendor, now)
    limit = CAP_FRAC * CAP_USD[vendor]
    return {'ok': mtd + est <= limit, 'mtd': mtd, 'estimate': round(est, 4), 'limit_80pct': limit, 'cap': CAP_USD[vendor]}


def key_status(vendor):
    """Exists + mode 600 + owned by us. NEVER reads the contents."""
    p = os.path.expanduser(KEYS[vendor])
    try:
        st = os.stat(p)
    except OSError:
        return {'present': False, 'path': p}
    return {'present': True, 'path': p, 'mode': oct(stat.S_IMODE(st.st_mode)), 'mode_ok': stat.S_IMODE(st.st_mode) == 0o600,
            'owner_ok': st.st_uid == os.getuid(), 'bytes': st.st_size}


def read_key(vendor):
    ks = key_status(vendor)
    if not (ks['present'] and ks['mode_ok'] and ks['owner_ok']):
        raise SystemExit('REFUSED: %s key %s is missing or not mode 600 / ours' % (vendor, ks['path']))
    with open(ks['path']) as fh:
        return fh.read().strip()


def cmd_plan(a):
    items = load(a.pilot)
    rows = ledger_rows()
    print('teacher pilot DRY RUN (no network, no key read): %d hard decisions in %s' % (len(items), a.pilot))
    strata = {}
    for i in items:
        strata[i['logged']['failure_class']] = strata.get(i['logged']['failure_class'], 0) + 1
    print('  strata (failure class): %d; largest %s' % (len(strata), sorted(strata.items(), key=lambda kv: -kv[1])[:6]))
    tot = {}
    for arm in ('B', 'C'):
        v = ARMS[arm]['vendor']
        ks = key_status(v)
        print('\n  arm %s = %s (%s); key %s' % (arm, ARMS[arm]['model'], v,
              'present, mode %s%s' % (ks['mode'], '' if ks['mode_ok'] else ' -- NOT 600') if ks['present'] else 'MISSING at ' + ks['path']))
        for cond in ('blind', 'informed'):
            bs = plan_batches(items, arm, cond)
            n = sum(len(b['items']) for b in bs); tin = sum(b['tin'] for b in bs); tout = sum(b['tout'] for b in bs)
            cost = sum(b['usd'] for b in bs)
            tot.setdefault(v, 0.0); tot[v] += cost
            print('    %-8s %4d requests in %d batch(es) <= $%.0f; est. %.2f M in + %.2f M out tokens = $%.2f' % (
                cond, n, len(bs), BATCH_USD, tin / 1e6, tout / 1e6, cost))
        cc = cap_check(rows, v, tot[v])
        print('    month-to-date %s $%.2f + this arm $%.2f vs 80%% of the $%.0f cap ($%.0f): %s' % (
            v, cc['mtd'], cc['estimate'], cc['cap'], cc['limit_80pct'], 'FITS' if cc['ok'] else 'REFUSED'))
    grand = sum(tot.values())
    print('\n  TOTAL planned (B + C, blind 1,000 + informed %d): $%.2f at batch list prices, no caching (upper bound)' % (INFORMED_N, grand))
    print('  blind only: $%.2f' % sum(sum(b['usd'] for b in plan_batches(items, arm, 'blind')) for arm in ('B', 'C')))
    print('  NOTHING WAS SENT. submit needs: --i-will-spend, a fetched 5-item --probe per arm, and the cap check.')
    sample = items[0]
    ar = anthropic_request(sample, 'blind'); orq = openai_request(sample, 'blind')
    print('\n  request shapes (first item; system/user/schema elided):')
    for name, r in (('anthropic', ar), ('openai', orq)):
        body = r.get('params') or r.get('body')
        print('   ', name, json.dumps({k: (v if k not in ('system', 'messages', 'output_config', 'response_format') else '<%s>' % k)
                                       for k, v in body.items()}))
    return 0


def cmd_submit(a):
    if not a.i_will_spend:
        raise SystemExit('REFUSED: submit spends money; pass --i-will-spend (owner only)')
    arm = a.arm; v = ARMS[arm]['vendor']
    items = load(a.pilot)
    probe_ok = os.path.join(HOME, 'teacher-paid', arm, 'PROBE-OK')
    if a.probe:
        items = sorted(items, key=lambda i: i['id'])[:5]; batches = [{'items': items, 'tin': 0, 'tout': 0,
                                                                      'usd': sum(usd(arm, *est_tokens(i, 'blind')) for i in items)}]
    else:
        if not os.path.exists(probe_ok):
            raise SystemExit('REFUSED: no fetched, fully parsed 5-item probe for arm %s (%s)' % (arm, probe_ok))
        batches = plan_batches(items, arm, a.condition)
    rows = ledger_rows()
    for b in batches:
        cc = cap_check(rows, v, b['usd'])
        if not cc['ok']:
            raise SystemExit('REFUSED by the ledger: %s' % cc)
        bid = submit_batch(arm, b['items'], 'blind' if a.probe else a.condition)
        row = {'ts': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'vendor': v, 'arm': arm,
               'batch': bid, 'kind': 'estimate', 'usd': round(b['usd'], 4), 'requests': len(b['items']),
               'condition': 'probe' if a.probe else a.condition}
        os.makedirs(HOME, exist_ok=True)
        with open(LEDGER, 'a') as fh:
            fh.write(json.dumps(row) + '\n')
        rows.append(row)
        print('submitted', row)
    return 0


def submit_batch(arm, items, condition):
    v = ARMS[arm]['vendor']
    if v == 'anthropic':
        import anthropic                         # the official SDK; only here, never in plan
        client = anthropic.Anthropic(api_key=read_key('anthropic'), max_retries=0)    # never retry into a 429
        reqs = [anthropic_request(i, condition, arm) for i in items]
        return client.messages.batches.create(requests=reqs).id
    import io, openai                            # the official SDK; only here
    client = openai.OpenAI(api_key=read_key('openai'), max_retries=0)
    buf = io.BytesIO(''.join(json.dumps(openai_request(i, condition, arm)) + '\n' for i in items).encode())
    f = client.files.create(file=('batch.jsonl', buf), purpose='batch')
    return client.batches.create(input_file_id=f.id, endpoint='/v1/chat/completions', completion_window='24h').id


def open_batches(arm, rows=None):
    rows = rows if rows is not None else ledger_rows()
    done = {r['batch'] for r in rows if r['kind'] == 'actual'}
    return [r for r in rows if r['arm'] == arm and r['kind'] == 'estimate' and r['batch'] not in done]


def parse_answer(text):
    try:
        d = json.loads(text)
        return d if isinstance(d, dict) else None
    except (TypeError, ValueError):
        return None


def cmd_poll(a):
    v = ARMS[a.arm]['vendor']
    for r in open_batches(a.arm):
        if v == 'anthropic':
            import anthropic
            b = anthropic.Anthropic(api_key=read_key('anthropic'), max_retries=0).messages.batches.retrieve(r['batch'])
            print(r['batch'], b.processing_status, b.request_counts)
        else:
            import openai
            b = openai.OpenAI(api_key=read_key('openai'), max_retries=0).batches.retrieve(r['batch'])
            print(r['batch'], b.status, b.request_counts)
    return 0


def cmd_fetch(a):
    """Ended batches -> ~/learnloop/teacher-paid/<arm>/<batch>.jsonl (quarantined) + an ACTUAL ledger row from usage."""
    arm = a.arm; v = ARMS[arm]['vendor']; qdir = os.path.join(HOME, 'teacher-paid', arm)
    os.makedirs(qdir, exist_ok=True)
    for r in open_batches(arm):
        recs = []
        if v == 'anthropic':
            import anthropic
            c = anthropic.Anthropic(api_key=read_key('anthropic'), max_retries=0)
            if c.messages.batches.retrieve(r['batch']).processing_status != 'ended':
                print(r['batch'], 'not ended'); continue
            for res in c.messages.batches.results(r['batch']):          # any order: keyed by custom_id
                rec = {'custom_id': res.custom_id, 'type': res.result.type}
                if res.result.type == 'succeeded':
                    m = res.result.message
                    rec.update({'stop_reason': m.stop_reason, 'text': next((x.text for x in m.content if x.type == 'text'), ''),
                                'in': m.usage.input_tokens, 'out': m.usage.output_tokens})
                recs.append(rec)
        else:
            import openai
            c = openai.OpenAI(api_key=read_key('openai'), max_retries=0)
            b = c.batches.retrieve(r['batch'])
            if b.status != 'completed':
                print(r['batch'], b.status); continue
            for line in c.files.content(b.output_file_id).text.splitlines():
                d = json.loads(line); body = (d.get('response') or {}).get('body') or {}
                u = body.get('usage') or {}
                recs.append({'custom_id': d['custom_id'], 'type': 'succeeded' if (d.get('response') or {}).get('status_code') == 200 else 'errored',
                             'text': ((body.get('choices') or [{}])[0].get('message') or {}).get('content'),
                             'in': u.get('prompt_tokens', 0), 'out': u.get('completion_tokens', 0)})
        for x in recs:
            x['provenance'] = 'teacher-paid:%s:%s' % (v, ARMS[arm]['model']); x['parsed'] = parse_answer(x.get('text'))
        with open(os.path.join(qdir, '%s.jsonl' % r['batch']), 'w') as fh:
            for x in recs:
                fh.write(json.dumps(x) + '\n')
        spent = sum(usd(arm, x.get('in') or 0, x.get('out') or 0) for x in recs)
        row = {'ts': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'vendor': v, 'arm': arm,
               'batch': r['batch'], 'kind': 'actual', 'usd': round(spent, 4), 'requests': len(recs),
               'tokens_in': sum(x.get('in') or 0 for x in recs), 'tokens_out': sum(x.get('out') or 0 for x in recs)}
        with open(LEDGER, 'a') as fh:
            fh.write(json.dumps(row) + '\n')
        print('fetched', row, 'parsed %d of %d' % (sum(1 for x in recs if x['parsed']), len(recs)))
        if r.get('condition') == 'probe' and recs and len(recs) == r['requests'] and all(x['parsed'] for x in recs):
            open(os.path.join(qdir, 'PROBE-OK'), 'w').write(row['ts'] + ' ' + r['batch'] + '\n')
            print('probe OK: every probe answer parsed -- full submits for arm %s are now allowed' % arm)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('verb', nargs='?', default='plan', choices=('plan', 'submit', 'poll', 'fetch'))
    ap.add_argument('--pilot', default='~/learnloop/teacher/pilot-1000.jsonl')
    ap.add_argument('--arm', choices=('B', 'C'))
    ap.add_argument('--condition', choices=('blind', 'informed'), default='blind')
    ap.add_argument('--probe', action='store_true')
    ap.add_argument('--i-will-spend', action='store_true')
    a = ap.parse_args(argv)
    if a.verb == 'plan':
        return cmd_plan(a)
    if a.verb == 'submit':
        if not a.arm:
            raise SystemExit('--arm B|C')
        return cmd_submit(a)
    if not a.arm:
        raise SystemExit('--arm B|C')
    return cmd_poll(a) if a.verb == 'poll' else cmd_fetch(a)


if __name__ == '__main__':
    sys.exit(main())
