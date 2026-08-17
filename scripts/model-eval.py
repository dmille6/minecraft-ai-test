#!/usr/bin/env python3
"""
model-eval.py -- choose a model using the lab's OWN outcome history.

The naive way to compare models is to write down what you think the right
answer is and see which model agrees with you. That measures agreement with
the author, not competence, and the author is exactly the person who has been
wrong about this system a dozen times.

We have something better: ~176,000 logged decisions, each paired with what
ACTUALLY HAPPENED when it was executed. So the grader is empirical -- a
proposal is scored by how that action really turned out, historically, for
bots standing in a comparable situation. No rubric, no hypothesis.

Two modes, because there are two different questions:

  replay  -- ONE-SHOT competence. Given a real situation, what does the model
             propose, and how did that proposal historically fare? Reports
             latency alongside, because a model that reasons beautifully at
             40s/decision cannot drive twenty bots (cadence >= N * sec/decision).

  fixate  -- MULTI-TURN recovery, which is the defect we actually have.
             Scout01 did not make one bad decision; it made 126 identical ones,
             each after being told the last had failed. So: propose, feed back
             the real failure text that action produced, propose again. A
             fixated model repeats itself. This is the measurement that matters.

Usage (run somewhere that can reach BOTH Elasticsearch and the model host):

    export ES_URL=http://10.0.0.186:9200 ES_USER=elastic ES_PASS=...
    ./model-eval.py corpus --n 400 --out /tmp/corpus.jsonl
    ./model-eval.py replay --corpus /tmp/corpus.jsonl --n 60 \
        --ollama http://10.0.0.72:11434 --models qwen2.5:7b-instruct,qwen2.5:14b-instruct
    ./model-eval.py fixate --corpus /tmp/corpus.jsonl --n 25 --turns 4 \
        --ollama http://10.0.0.72:11434 --models qwen2.5:7b-instruct
"""
import argparse, base64, collections, json, os, random, re, sys, time, urllib.error, urllib.request

SCAFFOLD = {'dirt', 'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
            'gravel', 'netherrack', 'deepslate', 'cobbled_deepslate'}


# ---------------------------------------------------------------- transport --

def _post(url, payload, timeout, auth=None):
    body = json.dumps(payload).encode()
    headers = {'Content-Type': 'application/json'}
    if auth:
        headers['Authorization'] = 'Basic ' + base64.b64encode(auth.encode()).decode()
    req = urllib.request.Request(url, body, headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def es_search(query, size=0, aggs=None, source=None, index='mcai-llm-agents'):
    url = f"{os.environ['ES_URL']}/{index}/_search"
    payload = {'query': query, 'size': size}
    if aggs: payload['aggs'] = aggs
    if source: payload['_source'] = source
    auth = f"{os.environ.get('ES_USER','elastic')}:{os.environ['ES_PASS']}"
    return _post(url, payload, 120, auth)


def ollama_chat(base, model, messages, timeout=600):
    """Returns (text, seconds). Retries transient socket errors; those are the
    local machine running out of ephemeral ports, not the model failing."""
    payload = {'model': model, 'stream': False, 'format': 'json',
               'options': {'num_ctx': 4096, 'temperature': 0.3},
               'messages': messages}
    last = None
    for attempt in range(3):
        try:
            t0 = time.time()
            out = _post(f'{base}/api/chat', payload, timeout)
            return out['message']['content'], time.time() - t0
        except (urllib.error.URLError, OSError, KeyError) as e:
            last = e
            time.sleep(3)
    raise RuntimeError(f'chat failed after retries: {last}')


# ------------------------------------------------------------- the corpus --

def signature(src):
    """A coarse description of the SITUATION, deliberately excluding anything
    about the agent's identity or arm -- those are treatments, not context, and
    putting them in the signature would let the grader reward an arm rather
    than an action."""
    y = (src.get('bot', {}).get('pos', {}) or {}).get('y')
    y = -999 if y is None else y
    band = ('deep' if y < 0 else 'underground' if y < 45 else
            'surface' if y <= 70 else 'high')
    inv = src.get('bot', {}).get('inventory', {}) or {}
    blocks = sum(v for k, v in inv.items() if k in SCAFFOLD)
    per = (src.get('perception', {}) or {}).get('blocks', {}) or {}
    return '|'.join([
        band,
        'pick' if any('pickaxe' in k for k in inv) else 'nopick',
        'blocks' if blocks >= 8 else 'noblocks',
        'water' if per.get('water') else 'dry',
        'hurt' if (src.get('bot', {}).get('health') or 20) < 12 else 'ok',
    ])


def proposal_of(text):
    """(skill, key-arg) from a model's JSON reply. Reasoning models emit a
    chain first; strip it, or every one of them scores as unparseable and we
    would 'conclude' reasoning models cannot do this from a parser bug."""
    if not text:
        return None
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.S)
    d = None
    try:
        d = json.loads(text)
    except Exception:
        m = re.search(r'\{.*\}', text, re.S)
        if m:
            try: d = json.loads(m.group(0))
            except Exception: return None
    if not isinstance(d, dict) or not d.get('skill'):
        return None
    args = d.get('args') or {}
    key = args.get('block') or args.get('item') or ''
    return (str(d['skill']), str(key))


def cmd_corpus(a):
    """Pull decisions that carry BOTH a proposal and its real outcome."""
    q = {'bool': {'filter': [{'exists': {'field': 'outcome.status'}},
                             {'exists': {'field': 'response.text'}}]}}
    got, rows = 0, []
    # Sample across time rather than taking the newest N, or the corpus is one
    # hour of one fleet state and every signature looks identical.
    for days_ago in range(0, 7):
        r = es_search({'bool': {'filter': q['bool']['filter'] + [
            {'range': {'@timestamp': {'gte': f'now-{days_ago+1}d', 'lt': f'now-{days_ago}d'}}}]}},
            size=max(60, a.n // 7),
            source=['@timestamp', 'bot.name', 'bot.pos.y', 'bot.health',
                    'bot.inventory', 'perception.blocks', 'prompt.text',
                    'response.text', 'outcome.status', 'outcome.detail',
                    'llm.model', 'exp.arm'])
        for h in r['hits']['hits']:
            s = h['_source']
            p = proposal_of((s.get('response') or {}).get('text'))
            if not p:
                continue
            rows.append({
                'ts': s['@timestamp'], 'bot': s['bot']['name'],
                'sig': signature(s), 'skill': p[0], 'arg': p[1],
                'status': (s.get('outcome') or {}).get('status'),
                'detail': ((s.get('outcome') or {}).get('detail') or '')[:200],
                'prompt': (s.get('prompt') or {}).get('text', ''),
            })
            got += 1
    with open(a.out, 'w') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')
    sigs = collections.Counter(r['sig'] for r in rows)
    print(f'wrote {got} decisions to {a.out}')
    print(f'  distinct situations: {len(sigs)}')
    for s, n in sigs.most_common(6):
        print(f'    {s}: {n}')


# ------------------------------------------------------------- the grader --

def build_table(rows):
    """(signature, skill, arg) -> (successes, attempts) from real outcomes."""
    t = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        k = (r['sig'], r['skill'], r['arg'])
        t[k][1] += 1
        if r['status'] == 'success':
            t[k][0] += 1
    return t


def score(table, sig, prop, min_n=3):
    """Empirical success rate of this proposal in this situation.
    Returns (rate, n) or (None, 0) when history has never tried it -- which is
    NOT a failing grade. A better model should sometimes propose things the 7B
    never thought of; those are reported separately as novelty, because
    scoring them zero would punish exactly the behaviour we are hunting for."""
    if prop is None:
        return (None, -1)
    s, n = table.get((sig, prop[0], prop[1]), [0, 0])
    if n < min_n:
        # fall back to the skill alone, ignoring the argument
        agg = [0, 0]
        for (sg, sk, _a), (ss, nn) in table.items():
            if sg == sig and sk == prop[0]:
                agg[0] += ss; agg[1] += nn
        s, n = agg
    return (s / n, n) if n >= min_n else (None, 0)


def cmd_replay(a):
    rows = [json.loads(l) for l in open(a.corpus)]
    table = build_table(rows)
    random.seed(a.seed)
    # Balance by bot so one chatty bot in one hole cannot dominate the verdict.
    by_bot = collections.defaultdict(list)
    for r in rows:
        if r['prompt']:
            by_bot[r['bot']].append(r)
    sample = []
    while len(sample) < a.n and any(by_bot.values()):
        for b in list(by_bot):
            if by_bot[b] and len(sample) < a.n:
                sample.append(by_bot[b].pop(random.randrange(len(by_bot[b]))))
    sysmsg = open(a.sysprompt).read() if a.sysprompt else ''

    for model in a.models.split(','):
        tally = collections.Counter()
        scored, lat, novel = [], [], 0
        for r in sample:
            msgs = ([{'role': 'system', 'content': sysmsg}] if sysmsg else []) + \
                   [{'role': 'user', 'content': r['prompt']}]
            try:
                txt, secs = ollama_chat(a.ollama, model, msgs)
                lat.append(secs)
            except Exception as e:
                tally['error'] += 1
                continue
            prop = proposal_of(txt)
            if prop is None:
                tally['unparseable'] += 1
                continue
            tally[prop[0]] += 1
            if prop[0] == 'gather' and prop[1] in SCAFFOLD:
                tally['_scaffold_gather'] += 1
            rate, n = score(table, r['sig'], prop)
            if rate is None:
                novel += 1
            else:
                scored.append(rate)
            time.sleep(0.3)
        n_ok = sum(v for k, v in tally.items() if not k.startswith('_') and k not in ('error', 'unparseable'))
        med = sorted(lat)[len(lat)//2] if lat else 0
        print(f'\n{model}   (n={len(sample)})')
        print(f'  parsed a valid proposal:   {n_ok}/{len(sample)}')
        if scored:
            print(f'  empirical success of its proposals: {100*sum(scored)/len(scored):.0f}% '
                  f'(over {len(scored)} with >=3 historical precedents)')
        print(f'  novel proposals (no precedent):     {novel}  <- inspect these by hand')
        print(f'  median latency: {med:.1f}s -> ~{int(a.cadence/med) if med else 0} bots at {a.cadence}s cadence')
        top = [f'{k}:{v}' for k, v in tally.most_common(6) if not k.startswith('_')]
        print(f'  proposals: {", ".join(top)}')
        print(f'  of which scaffold-gathers: {tally["_scaffold_gather"]}')


# ------------------------------------------------------- the fixation probe --

def cmd_fixate(a):
    """The real defect, reproduced in a test tube.

    Give the model a situation. Take its proposal. Tell it -- truthfully, using
    the failure text that action really produced in the logs -- that it failed.
    Ask again. Repeat. Then count how many DISTINCT actions it was willing to
    try. Scout01 scored 1 across 126 turns.

    KNOWN DIVERGENCE FROM PRODUCTION, read the number with it in mind: this
    probe builds a CONVERSATION (assistant turn, then feedback), while the real
    loop is stateless -- every tick rebuilds one user prompt whose only memory
    of the last attempt is a single `LAST ACTION:` line plus a droppable
    `RECENT EVENTS` block. A conversation is therefore a STRONGER signal than
    the fleet ever gives, so this probe measures "can the model escape a loop
    when it can see its own attempts", not "does it escape in production".
    Measured 2026-08-17: qwen2.5:7b scored 4.00/4 distinct here while the same
    model fixated for four days in the field. That gap is the point -- it says
    the fixation was the PROMPT's fault, not the model's. A production-faithful
    version would re-render the whole prompt each turn with LAST ACTION
    updated; worth building before any model is blamed again."""
    rows = [json.loads(l) for l in open(a.corpus)]
    fails = collections.defaultdict(list)
    for r in rows:
        if r['status'] != 'success' and r['detail']:
            fails[(r['skill'], r['arg'])].append(r['detail'])
    random.seed(a.seed)
    sample = random.sample([r for r in rows if r['prompt']], min(a.n, len(rows)))
    sysmsg = open(a.sysprompt).read() if a.sysprompt else ''

    for model in a.models.split(','):
        distinct_counts, repeats, lat = [], 0, []
        for r in sample:
            msgs = ([{'role': 'system', 'content': sysmsg}] if sysmsg else []) + \
                   [{'role': 'user', 'content': r['prompt']}]
            seen, last = [], None
            for turn in range(a.turns):
                try:
                    txt, secs = ollama_chat(a.ollama, model, msgs)
                    lat.append(secs)
                except Exception:
                    break
                prop = proposal_of(txt)
                if prop is None:
                    break
                if prop == last:
                    repeats += 1
                seen.append(prop); last = prop
                # Truthful feedback: what that action really produced, if known.
                real = fails.get(prop)
                why = random.choice(real) if real else 'it failed and nothing changed'
                msgs += [{'role': 'assistant', 'content': txt},
                         {'role': 'user',
                          'content': f'That action failed: {why}\n'
                                     f'Choose the next single skill to run, as JSON.'}]
                time.sleep(0.3)
            if seen:
                distinct_counts.append(len(set(seen)))
        med = sorted(lat)[len(lat)//2] if lat else 0
        avg_distinct = sum(distinct_counts)/len(distinct_counts) if distinct_counts else 0
        print(f'\n{model}   fixation probe ({len(distinct_counts)} situations x {a.turns} turns)')
        print(f'  distinct actions tried per situation: {avg_distinct:.2f} / {a.turns}')
        print(f'  immediate repeats after being told it failed: {repeats}')
        print(f'  (1.00 distinct = total fixation, which is what Scout01 did for four days)')
        print(f'  median latency: {med:.1f}s')


# --------------------------------------------------------------------- cli --

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)

    c = sub.add_parser('corpus', help='pull decisions+outcomes from Elasticsearch')
    c.add_argument('--n', type=int, default=400)
    c.add_argument('--out', default='/tmp/corpus.jsonl')
    c.set_defaults(func=cmd_corpus)

    for name, fn in (('replay', cmd_replay), ('fixate', cmd_fixate)):
        s = sub.add_parser(name)
        s.add_argument('--corpus', default='/tmp/corpus.jsonl')
        s.add_argument('--models', required=True, help='comma-separated ollama tags')
        s.add_argument('--ollama', default='http://10.0.0.72:11434')
        s.add_argument('--sysprompt', default='/tmp/sysprompt.txt')
        s.add_argument('--n', type=int, default=40)
        s.add_argument('--seed', type=int, default=7)
        s.add_argument('--cadence', type=int, default=30)
        if name == 'fixate':
            s.add_argument('--turns', type=int, default=4)
        s.set_defaults(func=fn)

    a = p.parse_args()
    a.func(a)


if __name__ == '__main__':
    main()
