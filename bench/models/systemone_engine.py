#!/usr/bin/env python3
"""The third bench engine: System One decision models (`/v1/systemone`: state + named choice questions in, a
probability per option out). Python 3.9, stdlib only. The question mapping is systemone_map.py (pure, tested).

    # replay the learning loop's 600-item m3-eval set; records are replay_client.mjs's shape, so
    # scripts/learnloop/train/eval_offline.py scores them unchanged
    python3 systemone_engine.py replay --items m3-eval.jsonl --out d1.jsonl \
        --backend ollama-logprobs --url http://ai.ticrcorp.com:11438 --model hf.co/LiquidAI/d1-3B-GGUF:Q8_0
    python3 systemone_engine.py replay ... --backend http --url http://127.0.0.1:8080 --model clef-flash

BACKENDS
  http             POST <url>/v1/systemone {model, state, questions} -> {answers: {name: {choice, confidence,
                   probabilities}}}: llama-server builds that expose it, Clef-flash's SGLang image, or a local
                   transformers shim around d1's `system_one` / Clef's `joint_schema_model.systemone`.
  ollama-logprobs  d1-3B ONLY: d1 has no extra head (LiquidAI/d1-3B runner.py reads the vocabulary log-softmax at
                   the answer slot), so its readout is reproduced on a stock Ollama with raw /api/generate,
                   num_predict 1 and top_logprobs 20: prompt.py's render (systemone_map.render_d1) and readout.
                   Each question is its own request on the shared state prefix (d1's own packing gives the same
                   per-question math; Ollama's prefix cache reads the state once). NOT valid for Clef-flash,
                   whose joint head is separate weights.

A decision is two rounds: the skill question, then the chosen skill's arg questions (one request per question on
ollama-logprobs, one request for all of them on http). Latency is the wall time of both rounds.
"""
import argparse, concurrent.futures as cf, json, os, sys, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import systemone_map as SM  # noqa: E402


def _post(url, body, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'},
                                 method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


class OllamaLogprobs:
    name = 'ollama-logprobs'

    def __init__(self, url, model, num_ctx=8192, timeout=120, keep_alive='10m'):
        self.url, self.model, self.num_ctx, self.timeout, self.keep_alive = url.rstrip('/'), model, num_ctx, timeout, keep_alive
        self.tokens = 0

    def ask(self, state, questions):
        out, meta = {}, {'missing_options': 0, 'prompt_tokens': 0}
        for qn, q in questions.items():
            d = _post(self.url + '/api/generate', {
                'model': self.model, 'prompt': SM.render_d1(state, q), 'raw': True, 'stream': False,
                'logprobs': True, 'top_logprobs': 20, 'keep_alive': self.keep_alive,
                'options': {'temperature': 0, 'num_predict': 1, 'num_ctx': self.num_ctx}}, self.timeout)
            lp = d.get('logprobs') or []
            if not lp:
                raise RuntimeError('no logprobs in the response (Ollama too old for logprobs?)')
            top = {t['token']: t['logprob'] for t in lp[0].get('top_logprobs') or []}
            labels = list(q['criteria'])
            probs, miss = SM.readout(top, labels)
            out[qn] = SM.answer(labels, probs)
            meta['missing_options'] += miss
            meta['prompt_tokens'] = max(meta['prompt_tokens'], d.get('prompt_eval_count') or 0)
        return out, meta


class HttpSystemOne:
    name = 'http'

    def __init__(self, url, model, timeout=120):
        self.url, self.model, self.timeout = url.rstrip('/'), model, timeout

    def ask(self, state, questions):
        d = _post(self.url + '/v1/systemone', {'model': self.model, 'state': state, 'questions': questions}, self.timeout)
        ans = d.get('answers') or {}
        missing = [q for q in questions if q not in ans]
        if missing:
            raise RuntimeError('answers missing for %s' % missing)
        return ans, {'prompt_tokens': (d.get('usage') or {}).get('input_tokens')}


def decide(item, backend):
    """One replay item -> a replay_client.mjs-shaped record (+ confidence, decided, arg answers)."""
    f = SM.parse_prompt(item['user'], item.get('system') or '')
    admitted, excluded = SM.admitted_skills(item['schema'], f)
    state = SM.state_text(item.get('system') or '', item['user'])
    t0 = time.time()
    sq = SM.skill_question(admitted)
    a1, m1 = backend.ask(state, {'skill': sq})
    base = {'id': item['id'], 'model': backend.model, 'url': backend.url, 'engine': 'systemone/' + backend.name,
            'retryCount': 0, 'transport_error': False, 'admitted': admitted, 'excluded': excluded}
    if not SM.valid_choice(sq, a1.get('skill')):
        # an answer outside the offered options is an INVALID decision (scored), not a transport error
        return dict(base, proposal=None, schemaValid=False, error='invalid_choice: skill %r' % (a1.get('skill') or {}).get('choice'),
                    latencyMs=int((time.time() - t0) * 1000))
    skill = a1['skill']['choice']
    aqs = SM.arg_questions(skill, f, item['schema'])
    a2, m2 = backend.ask(state, aqs) if aqs else ({}, {})
    lat = int((time.time() - t0) * 1000)
    bad = [qn for qn, q in aqs.items() if not SM.valid_choice(q, a2.get(qn))]
    if bad:
        return dict(base, proposal=None, schemaValid=False, error='invalid_choice: %s' % bad, latencyMs=lat,
                    confidence=a1['skill']['confidence'])
    chosen = {qn.split('.', 1)[1]: a2[qn]['choice'] for qn in aqs}
    proposal, decided = SM.to_proposal(skill, chosen, f)
    return {'id': item['id'], 'model': backend.model, 'url': backend.url, 'engine': 'systemone/' + backend.name,
            'proposal': proposal, 'schemaValid': True, 'error': None, 'retryCount': 0, 'latencyMs': lat,
            'transport_error': False, 'confidence': a1['skill']['confidence'],
            'skill_probabilities': a1['skill']['probabilities'],
            'arg_answers': {qn: {'choice': a['choice'], 'confidence': a['confidence']} for qn, a in a2.items()},
            'decided': decided, 'admitted': admitted, 'excluded': excluded,
            'missing_options': (m1.get('missing_options') or 0) + (m2.get('missing_options') or 0),
            'prompt_tokens': m1.get('prompt_tokens')}


def make_backend(a):
    if a.backend == 'ollama-logprobs':
        return OllamaLogprobs(a.url, a.model, timeout=a.timeout)
    return HttpSystemOne(a.url, a.model, timeout=a.timeout)


def replay(a):
    items = [json.loads(l) for l in open(a.items) if l.strip()]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            if l.strip():
                r = json.loads(l)
                if not r.get('transport_error'):
                    done.add(r['id'])
    todo = [i for i in items if i['id'] not in done][:a.limit or None]
    be = make_backend(a)
    lock, fh = threading.Lock(), open(a.out, 'a')
    print('%s @ %s (%s): %d items (%d done)' % (a.model, a.url, a.backend, len(todo), len(done)), file=sys.stderr, flush=True)
    n = errs = 0

    def one(it):
        try:
            return decide(it, be)
        except Exception as e:  # a transport error is recorded, not scored (eval_offline drops it as missing)
            return {'id': it['id'], 'model': a.model, 'url': a.url, 'transport_error': True,
                    'error': '%s: %s' % (type(e).__name__, str(e)[:300])}

    with cf.ThreadPoolExecutor(max_workers=a.concurrency) as ex:
        for rec in ex.map(one, todo):
            n += 1; errs += bool(rec.get('transport_error'))
            with lock:
                fh.write(json.dumps(rec) + '\n'); fh.flush()
            if n % 50 == 0 or (rec.get('transport_error') and errs <= 3):
                print('  %d/%d transport errors %d %s' % (n, len(todo), errs, rec.get('error') or ''), file=sys.stderr, flush=True)
            if errs >= 20 and errs > n / 2:
                print('ABORT: the endpoint is failing', file=sys.stderr, flush=True)
                os._exit(3)
    print('%s: %d replayed, %d transport errors' % (a.model, n, errs), file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('replay')
    r.add_argument('--items', required=True)
    r.add_argument('--out', required=True)
    r.add_argument('--backend', choices=('ollama-logprobs', 'http'), required=True)
    r.add_argument('--url', required=True)
    r.add_argument('--model', required=True)
    r.add_argument('--concurrency', type=int, default=2)
    r.add_argument('--timeout', type=float, default=120)
    r.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    replay(a)


if __name__ == '__main__':
    main()
