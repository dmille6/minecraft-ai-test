#!/usr/bin/env python3
"""Frontier overseer, REPLAY ONLY: give recorded mayor snapshots to Claude and GPT, validate what
they propose, and write it in the shape mayor_score.py reads. Plan section "Frontier overseer".

    ANTHROPIC_API_KEY=... OPENAI_API_KEY=... python3 mayor_frontier.py \\
        --snaps '/var/lib/mcai-mayor/snap-*.jsonl' --det '/var/lib/mcai-mayor/assign-*.jsonl' \\
        --out-dir replay-2026-10-05 --engine both --max-snapshots 100 --budget-usd 10

    python3 mayor_frontier.py --dry-run ...     # a fake model: no key, no network, cost 0

Writes <out>/assign-claude-<world>.jsonl and <out>/assign-gpt-<world>.jsonl, plus
<out>/frontier-run-<engine>.json (calls, invalid rate, re-ask agreement, spend, budget flag).

DESIGN (plan): strict JSON output against mayor_core.OUTPUT_SCHEMA; every answer goes through
mayor_core.validate (unknown ids, invented places, infeasible candidates, broken caps are
rejected and the invalid rate is a metric); both vendors see the SAME snapshots; half the
snapshots are ANCHORED (the deterministic mayor's answer is shown) and half BLIND, chosen by a
hash of the snap_id so the split is identical for both vendors; ~10% are asked twice
(self-consistency). Temperature 0 is sent only to models that accept sampling parameters --
current Claude (sonnet-5 family, opus-5 family, fable) and GPT reasoning models reject it with a
400, so for them it is omitted and the output records `temperature_sent: false`.

KEYS come only from ANTHROPIC_API_KEY / OPENAI_API_KEY. They are put in a request header and
nowhere else: never logged, never written, never in an exception message.

COST. See Ledger: each attempt reserves an ESTIMATE (bytes/2 + a fixed overhead, plus the full
max_tokens); the hard stop is on ACTUAL billed usage (spent + next reservation > --budget-usd stops
the run, summary budget_hit). An unpriced model refuses to run (fail closed) unless
--price-in/--price-out are given.
"""
import argparse
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mayor_core as core  # noqa: E402
import mayor_io  # noqa: E402

# USD per 1M tokens. Same table and sources as mcai-playground/src/prices.mjs (verified 2026-09-30);
# claude-sonnet-5-5 from the claude-api model table (cached 2026-09-25). cacheWrite is not used here.
PRICES = {
    'claude-sonnet-5': (2.00, 10.00), 'claude-sonnet-5-5': (2.00, 10.00), 'claude-opus-5-5': (4.00, 20.00),
    'gpt-6.1-sol': (2.00, 10.00), 'gpt-6-astra': (10.00, 50.00), 'fake': (0.0, 0.0),
}
# Models that 400 on temperature/top_p (claude-api skill thinking table; OpenAI reasoning models).
NO_SAMPLING_PREFIXES = ('claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-fable',
                        'claude-mythos', 'gpt-5', 'gpt-6', 'o1', 'o3', 'o4')
ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
OPENAI_URL = 'https://api.openai.com/v1/responses'

SYSTEM = """You are the overseer ("mayor") of one Minecraft world worked by up to five autonomous bots.
You do not control the bots. You read one snapshot of the world and propose which bots should take
a TEMPORARY duty for the next 10 minutes, or say that nobody should.

Duties (the fleet's real bottlenecks):
- FREE_BAG: a bot's estimated slots >= 34 of 36. Only by a disposal method listed on the candidate.
- RESTORE_PICK: a bot's best pickaxe <= 10% or none. Only with ingredients the bot already holds.
- GET_WOOD: the world's held wood is short. Only to an observed log sighting near the bot.
- GET_IRON: the world's held iron is short. Only with a stone+ pickaxe with trip uses, near iron, with room.

Rules (an answer that breaks one is rejected):
- Assign only candidate ids (C...) from the snapshot whose "feasible" is true.
- "target" must be one of that candidate's "targets" (resource ids R...), or "" if it has none.
- At most 2 bots per duty and 3 bots in the world; one duty per bot; never the same target twice.
- "evidence" lists the snapshot ids (B..., R..., S..., C...) your reason rests on. Cite no other ids
  and invent no places or coordinates.
- confidence is a number from 0 to 1.
- Slot counts are estimates; bank contents are unknown (not zero).
- List shortages you would leave unstaffed in unmet_needs with the reason. Set abstain true (with no
  assignments) if you would not assign anyone at all.

Answer with the JSON object only."""


class BudgetExceeded(Exception):
    pass


SCHEMA_JSON = json.dumps(core.OUTPUT_SCHEMA)
OVERHEAD_TOKENS = 1000      # per request, on top of the bytes we send: message framing, tool/format scaffolding


class Ledger:
    """The budget. The per-attempt RESERVATION is an ESTIMATE, not a bound (tokenizers vary): the
    request's bytes (system + prompt + output schema) at one token per 2 UTF-8 bytes -- JSON runs ~3-4
    bytes a token, so ~1.5-2x over -- PLUS OVERHEAD_TOKENS, at the input rate, plus the full max_tokens
    (thinking included) at the output rate. The HARD STOP is on what was ACTUALLY BILLED: `spent` is
    the providers' reported usage, and before every attempt (retries included) the run stops if spent
    + the next reservation would pass the budget. So the overshoot is at most one call's actual cost
    beyond its own estimate. An attempt that timed out, dropped, or came back without usage (non-JSON
    200) may still have been billed and is charged its whole reservation; an HTTP error status is 0."""

    def __init__(self, budget_usd, price_in, price_out):
        self.budget, self.pin, self.pout = budget_usd, price_in, price_out
        self.spent = self.reserved = 0.0
        self.calls = self.attempts = 0

    def worst(self, request_bytes, max_tokens):
        return (request_bytes / 2.0 + OVERHEAD_TOKENS) * self.pin / 1e6 + max_tokens * self.pout / 1e6

    def reserve(self, prompt_bytes, max_tokens):
        w = self.worst(prompt_bytes, max_tokens)
        if self.spent + w > self.budget:
            raise BudgetExceeded('spent $%.4f + worst case $%.4f > budget $%.2f' % (self.spent, w, self.budget))
        self.attempts += 1
        self.reserved += w
        return w

    def charge(self, usd):
        self.spent += usd
        return usd

    def settle(self, tokens_in, tokens_out):
        self.calls += 1
        return self.charge(tokens_in * self.pin / 1e6 + tokens_out * self.pout / 1e6)


def sampling_allowed(model):
    return not model.startswith(NO_SAMPLING_PREFIXES)


def prompt_view(snap):
    """What the model sees: the snapshot with ids, minus internals it does not need."""
    keep_bot = ('id', 'name', 'fresh', 'age_s', 'pos', 'health', 'hunger', 'held', 'inventory', 'slots_est',
                'free_slots_est', 'pick_state', 'best_pick', 'stone_pick_uses', 'log_eq', 'iron_units', 'trapped',
                'trap_kind', 'trap_s_ago', 'milestone', 'last_skills')
    return {
        'snap_id': snap['snap_id'], 'world': snap['world'], 't': snap['t'], 'estimates': snap['estimates'],
        'bank': snap['bank'],
        'bots': [{k: b.get(k) for k in keep_bot} for b in snap['bots']],
        'resources': [{k: r[k] for k in ('id', 'kind', 'x', 'y', 'z', 'age_h')} for r in snap['resources']],
        'shortages': snap['shortages'],
        'candidates': [{k: c.get(k) for k in ('id', 'duty', 'bot', 'shortage', 'feasible', 'blockers', 'targets',
                                              'dist', 'methods', 'recipe')} for c in snap['candidates']],
    }


def build_prompt(snap, anchor=None):
    text = 'SNAPSHOT\n' + json.dumps(prompt_view(snap), separators=(',', ':'))
    if anchor is not None:
        text += ('\n\nA deterministic rule-based mayor proposed the following for this snapshot. You may agree '
                 'or disagree.\n' + json.dumps([{k: a.get(k) for k in ('candidate_id', 'duty', 'target', 'reason')}
                                                for a in anchor], separators=(',', ':')))
    return text


def mode_for(snap_id):
    return 'anchored' if core.stable_hash(snap_id, 'anchor') % 2 else 'blind'


def is_reask(snap_id, rate=10):
    return core.stable_hash(snap_id, 'reask') % 100 < rate


# ---------------------------------------------------------------- providers ---------

class ProviderError(Exception):
    """status + a sanitised code ONLY. A provider's error body can echo the prompt or carry account
    details, so it is never persisted, printed or put in an exception message."""

    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(('http_%d:%s' % (status, code)) if status is not None else 'connection:%s' % code)


_CODE = re.compile(r'^[a-z_]{1,40}$')


def _error_code(raw):
    try:
        t = (json.loads(raw.decode('utf-8', 'replace')).get('error') or {}).get('type')
    except (ValueError, AttributeError):
        return 'unparsed'
    return t if isinstance(t, str) and _CODE.match(t) else 'unparsed'


def _post(url, headers, body, timeout, opener):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method='POST')
    try:
        with opener(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        try:
            raw = e.read(4096)
        except Exception:
            raw = b''
        raise ProviderError(e.code, _error_code(raw)) from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        reason = getattr(e, 'reason', e)
        raise ProviderError(None, 'timeout' if isinstance(reason, TimeoutError) or 'timed out' in str(reason) else 'error') from None
    try:
        out = json.loads(raw.decode('utf-8', 'replace'))
    except ValueError:
        out = None
    if not isinstance(out, dict):
        raise ProviderError(200, 'non_json')           # billed or not, there is no usage: charged as reserved
    return out


def call_anthropic(model, prompt, key, args, opener=urllib.request.urlopen):
    body = {'model': model, 'max_tokens': args.max_tokens, 'system': SYSTEM,
            'messages': [{'role': 'user', 'content': prompt}],
            'output_config': {'effort': args.effort,
                              'format': {'type': 'json_schema', 'schema': core.OUTPUT_SCHEMA}}}
    if sampling_allowed(model):
        body['temperature'] = 0
    r = _post(ANTHROPIC_URL, {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
              body, args.timeout, opener)
    text = ''.join(b.get('text', '') for b in r.get('content') or [] if b.get('type') == 'text')
    u = r.get('usage')
    if not isinstance(u, dict):
        return text, None, None, r.get('stop_reason')
    tin = (u.get('input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0)
    return text, tin, u.get('output_tokens') or 0, r.get('stop_reason')


def call_openai(model, prompt, key, args, opener=urllib.request.urlopen):
    body = {'model': model, 'instructions': SYSTEM, 'input': prompt, 'store': False,
            'max_output_tokens': args.max_tokens, 'reasoning': {'effort': args.effort},
            'text': {'format': {'type': 'json_schema', 'name': 'mayor_assignments', 'strict': True,
                                'schema': core.OUTPUT_SCHEMA}}}
    if sampling_allowed(model):
        body['temperature'] = 0
    r = _post(OPENAI_URL, {'authorization': 'Bearer ' + key, 'content-type': 'application/json'},
              body, args.timeout, opener)
    text = ''.join(c.get('text', '') for o in r.get('output') or [] if o.get('type') == 'message'
                   for c in o.get('content') or [] if c.get('type') == 'output_text')
    u = r.get('usage')
    if not isinstance(u, dict):
        return text, None, None, r.get('status')
    return text, u.get('input_tokens') or 0, u.get('output_tokens') or 0, r.get('status')


def fake_model(snap, every_invalid=0, counter=[0]):
    """--dry-run: answer like an obedient model (feasible candidates, caps respected); every Nth
    answer also cites an unknown candidate so the validator path runs."""
    counter[0] += 1
    order = sorted(snap['candidates'], key=lambda c: (core.DUTY_RANK[c['duty']], c['dist'] or 0, c['bot_name']))
    picks = core.greedy(snap, order)
    out = {'assignments': [{'candidate_id': a['candidate_id'], 'target': a['target'] or '',
                            'reason': 'fake: feasible %s for %s' % (a['duty'], a['bot']),
                            'evidence': [a['candidate_id'], a['bot']] + ([a['target']] if a['target'] else []),
                            'confidence': 0.5} for a in picks],
           'unmet_needs': [], 'abstain': not picks, 'abstain_reason': '' if picks else 'nothing feasible'}
    if every_invalid and counter[0] % every_invalid == 0:
        out['assignments'].append({'candidate_id': 'C999', 'target': '', 'reason': 'invented', 'evidence': ['C999'],
                                   'confidence': 0.9})
    return json.dumps(out)


RETRYABLE = (408, 409, 429, 500, 502, 503, 504, 529)


def ask(engine, model, snap, prompt, key, args, ledger, opener):
    """One validated answer. Retries are capped (--max-retries) and only for retryable failures."""
    if args.dry_run:
        text, tin, tout, stop = fake_model(snap, args.fake_invalid_every), 0, 0, 'fake'
        latency, cost = 0, 0.0
        ledger.calls += 1
    else:
        fn = call_anthropic if engine == 'claude' else call_openai
        waits = [args.retry_base_s * k for k in (1, 4, 12)][:args.max_retries]
        nbytes = len((SYSTEM + prompt + SCHEMA_JSON).encode())
        t0, cost = time.time(), 0.0
        for i in range(len(waits) + 1):
            worst = ledger.reserve(nbytes, args.max_tokens)       # every attempt, retries included
            try:
                text, tin, tout, stop = fn(model, prompt, key, args, opener)
                break
            except ProviderError as e:
                if e.status is None or e.status == 200:
                    cost += ledger.charge(worst)                  # timed out / dropped / no usage: may have been billed
                if i >= len(waits) or (e.status is not None and e.status not in RETRYABLE):
                    raise
                time.sleep(waits[i])
        latency = round((time.time() - t0) * 1000)
        if tin is None:                                           # a 200 without usage: charge the estimate
            ledger.calls += 1
            cost += ledger.charge(worst)
        else:
            cost += ledger.settle(tin, tout)
    try:
        parsed = json.loads(text) if isinstance(text, str) else None
        parse_error = None if parsed is not None else 'json: not text'
    except ValueError as e:
        parsed, parse_error = None, 'json: %s' % str(e)[:80]
    # NORMALISE before anything consumes them: a model may put any type in any field
    p = parsed if isinstance(parsed, dict) else {}
    unmet = [u for u in p.get('unmet_needs') if isinstance(u, dict)] if isinstance(p.get('unmet_needs'), list) else []
    abstain = p.get('abstain') if isinstance(p.get('abstain'), bool) else None
    v = core.validate(snap, parsed) if parsed is not None else {'valid': False, 'accepted': [], 'rejected': [],
                                                                  'errors': [parse_error]}
    if stop not in ('end_turn', 'completed', 'fake'):
        v['errors'] = v['errors'] + ['stop:%s' % stop]
        v['valid'] = False
    return {'valid': v['valid'], 'assignments': v['accepted'], 'rejected': v['rejected'], 'errors': v['errors'],
            'unmet_needs': unmet, 'abstain': abstain,
            'usage': {'input_tokens': tin, 'output_tokens': tout}, 'cost_usd': round(cost, 6), 'latency_ms': latency,
            'stop': stop}


def load_det(pattern, wanted):
    """The deterministic mayor's answers, for the chosen snapshots only (bounded)."""
    det = {}
    for p in sorted(glob.glob(pattern or '')):
        with open(p) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if isinstance(r, dict) and r.get('engine') == 'deterministic' and r.get('snap_id') in wanted:
                    det[r['snap_id']] = r.get('assignments') or []
    return det


def index_snapshots(pattern, replay_only, worlds=None):
    """One streaming pass: (t_ms, world, path, offset) of every usable snapshot, and counts. A line that
    does not parse (a truncated last line) is skipped and counted. Live and replay are never mixed:
    replay snapshots are used only with replay_only, and then only they are."""
    idx, counts = [], {'live': 0, 'replay': 0, 'skipped_lines': 0}
    for p in sorted(glob.glob(pattern)):
        off = 0
        with open(p, 'rb') as f:
            for line in f:
                here, off = off, off + len(line)
                if not line.strip():
                    continue
                try:
                    s = json.loads(line)
                except ValueError:
                    counts['skipped_lines'] += 1
                    continue
                if not isinstance(s, dict) or s.get('schema') != core.SCHEMA or not isinstance(s.get('t_ms'), int):
                    counts['skipped_lines'] += 1
                    continue
                rep = bool(s.get('replay'))
                counts['replay' if rep else 'live'] += 1
                if rep == replay_only and (not worlds or s.get('world') in worlds):
                    idx.append((s['t_ms'], s.get('world'), s.get('snap_id'), p, here))
    return idx, counts


def load_at(path, offset):
    with open(path, 'rb') as f:
        f.seek(offset)
        return json.loads(f.readline())


def select(idx, n):
    """A deterministic stride over the time-ordered index, so a rerun picks the same snapshots."""
    pool = sorted(idx)
    if n <= 0 or len(pool) <= n:
        return pool
    step = len(pool) / n
    return [pool[int(i * step)] for i in range(n)]


def run(args, opener=urllib.request.urlopen, env=None):
    env = os.environ if env is None else env
    engines = ['claude', 'gpt'] if args.engine == 'both' else [args.engine]
    keys = {}
    for e in engines:
        var = 'ANTHROPIC_API_KEY' if e == 'claude' else 'OPENAI_API_KEY'
        if not args.dry_run:
            if not env.get(var):
                print('REFUSING: %s is not set (keys come only from the environment). Use --dry-run to test '
                      'without a key.' % var, file=sys.stderr)
                return 2
            keys[e] = env[var]
    models = {'claude': args.claude_model, 'gpt': args.gpt_model}
    for e in engines:
        m = 'fake' if args.dry_run else models[e]
        if m not in PRICES and (args.price_in is None or args.price_out is None):
            print('REFUSING: no price for model %r (fail closed). Add it to PRICES or pass --price-in/--price-out.' % m,
                  file=sys.stderr)
            return 2
    idx, counts = index_snapshots(args.snaps, args.replay_only, set(args.worlds.split(',')) if args.worlds else None)
    if not idx:
        print('REFUSING: no %s snapshots matched %s (%d live, %d replay, %d unreadable lines).%s' % (
            'replay' if args.replay_only else 'live', args.snaps, counts['live'], counts['replay'], counts['skipped_lines'],
            '' if args.replay_only else ' Replay snapshots are used only with --replay-only, never mixed with live.'),
            file=sys.stderr)
        return 2
    picked = select(idx, args.max_snapshots)
    det = load_det(args.det, {sid for _, _, sid, _, _ in picked})
    try:
        out_dir = mayor_io.safe_out_dir(args.out_dir, args.allow_out_root)
        mayor_io.make_dir(out_dir)
    except (mayor_io.UnsafeOutput, OSError) as e:
        print('REFUSING: %s' % e, file=sys.stderr)
        return 2
    rc = 0
    for e in engines:
        model = 'fake' if args.dry_run else models[e]
        pin, pout = PRICES.get(model, (args.price_in, args.price_out))
        if args.price_in is not None and args.price_out is not None:
            pin, pout = args.price_in, args.price_out
        ledger = Ledger(args.budget_usd, pin, pout)
        chosen = (load_at(p, off) for _, _, _, p, off in picked)       # streamed: one snapshot in memory at a time
        summary = {'engine': e, 'model': model, 'dry_run': bool(args.dry_run), 'snapshots': len(picked),
                   'replay': bool(args.replay_only), 'skipped_lines': counts['skipped_lines'],
                   'calls': 0, 'invalid': 0, 'errors': 0, 'reasks': 0, 'reask_agree': 0, 'budget_hit': False,
                   'budget_usd': args.budget_usd, 'temperature_sent': sampling_allowed(model) and not args.dry_run}
        try:
            for snap in chosen:
                mode = mode_for(snap['snap_id'])
                anchor = det.get(snap['snap_id']) if mode == 'anchored' else None
                if mode == 'anchored' and anchor is None:
                    mode = 'blind'            # no deterministic answer recorded for this snapshot
                prompt = build_prompt(snap, anchor)
                rounds = [None, 'reask'] if is_reask(snap['snap_id'], args.reask_pct) else [None]
                first = None
                for tag in rounds:
                    try:
                        res = ask(e, model, snap, prompt, keys.get(e), args, ledger, opener)
                    except ProviderError as err:
                        summary['errors'] += 1
                        res = {'valid': False, 'assignments': [], 'rejected': [], 'errors': [str(err)[:200]],
                               'usage': None, 'cost_usd': 0.0, 'latency_ms': None, 'stop': None}
                    summary['calls'] += 1
                    summary['invalid'] += not res['valid']
                    rec = dict(res, schema=core.SCHEMA, engine=e, model=model, dry_run=bool(args.dry_run), mode=mode,
                               replay=bool(snap.get('replay')),
                               snap_id=snap['snap_id'], world=snap['world'], t=snap['t'],
                               temperature_sent=summary['temperature_sent'],
                               reask_of=snap['snap_id'] if tag else None,
                               unstaffed=[{'duty': u.get('duty'), 'reason': u.get('reason')} for u in res.get('unmet_needs') or []
                                          if isinstance(u, dict)])
                    mayor_io.append_line(os.path.join(out_dir, 'assign-%s-%s.jsonl' % (e, snap['world'])),
                                         json.dumps(rec, separators=(',', ':')))
                    ids = sorted((a['candidate_id'], a['target'] or '') for a in res['assignments'])
                    if tag is None:
                        first = ids
                    else:
                        summary['reasks'] += 1
                        summary['reask_agree'] += ids == first
        except BudgetExceeded as b:
            summary['budget_hit'] = True
            summary['budget_detail'] = str(b)
            print('BUDGET: %s -- stopping %s' % (b, e), file=sys.stderr)
            rc = 5
        summary['spent_usd'] = round(ledger.spent, 6)
        summary['reserved_usd'] = round(ledger.reserved, 6)
        summary['attempts'] = ledger.attempts
        summary['invalid_rate'] = round(summary['invalid'] / summary['calls'], 4) if summary['calls'] else None
        mayor_io.write_atomic(os.path.join(out_dir, 'frontier-run-%s.json' % e), json.dumps(summary, indent=1))
        print(json.dumps(summary))
    return rc


def parser():
    ap = argparse.ArgumentParser(description='frontier overseer, replay only')
    ap.add_argument('--snaps', default='/var/lib/mcai-mayor/snap-*.jsonl')
    ap.add_argument('--det', default='/var/lib/mcai-mayor/assign-*.jsonl', help="deterministic mayor's answers (anchored half)")
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--allow-out-root', action='append', help='allowlisted root for --out-dir (default /var/lib/mcai-mayor)')
    ap.add_argument('--engine', choices=['claude', 'gpt', 'both'], default='both')
    ap.add_argument('--claude-model', default='claude-sonnet-5', help='playground default; current Sonnet is claude-sonnet-5-5')
    ap.add_argument('--gpt-model', default='gpt-6.1-sol', help='playground default')
    ap.add_argument('--effort', default='medium', help='output_config.effort / reasoning.effort')
    ap.add_argument('--max-tokens', type=int, default=8000)
    ap.add_argument('--max-snapshots', type=int, default=100)
    ap.add_argument('--worlds', help='comma list')
    ap.add_argument('--reask-pct', type=int, default=10)
    ap.add_argument('--budget-usd', type=float, default=5.0, help='HARD per-run, per-engine cap')
    ap.add_argument('--price-in', type=float), ap.add_argument('--price-out', type=float)
    ap.add_argument('--max-retries', type=int, default=2)
    ap.add_argument('--retry-base-s', type=float, default=5, help='retry waits are base x 1, 4, 12')
    ap.add_argument('--timeout', type=int, default=180)
    ap.add_argument('--dry-run', action='store_true', help='fake model, no key, no network')
    ap.add_argument('--replay-only', action='store_true', help='use ONLY replay snapshots (never mixed with live)')
    ap.add_argument('--fake-invalid-every', type=int, default=0)
    return ap


def main(argv=None):
    return run(parser().parse_args(argv))


if __name__ == '__main__':
    sys.exit(main())
