"""THE OVERSEER CALLER (cooperation tier s.3.2 / s.3.8): ONE frontier call for ONE town snapshot, through the spend guard.
Runs on the MAC MINI ONLY (the keys live there: ~/.config/mcai/anthropic.key, ~/.config/mcai/openai.key, mode 600; OWNER
10-23 "use the keys that are already there"). A key is read at call time into the SDK client and never printed, logged,
written to a snapshot or to the ledger.

    ~/learnloop/venv/bin/python scripts/overseer/caller.py call --model claude-sonnet-5-5 --snapshot s.json --out reply.json \
        [--purpose paper] [--run <id>] [--dry]

THE ORDER, every call (fail closed at each step; nothing is sent unless every step passed):
  1 the caller lock (one caller at a time);
  2 build the exact request (system prompt + the snapshot JSON + the reply schema), canonical JSON -> its sha256;
  3 COUNT it with the vendor's own counter (Anthropic messages.count_tokens; OpenAI responses.input_tokens.count). If counting
    fails, or the request is over INPUT_CEILING tokens, no call (exit 3, no reservation);
  4 RESERVE the worst case (counted input + MAX_TOKENS at the table price) in the guard's ledger, bound to the hash;
  5 check_send: the reservation is open and bound to these exact bytes; then send ONCE (max_retries=0, no server-side model
    fallback, effort low);
  6 SETTLE from the response's own usage. A timeout or crash after the send leaves the reservation OPEN (worst case counted).
Exit codes: 0 reply written (it may still be invalid JSON for the validator: `parsed` null), 2 the guard refused, 3 not counted
/ over the ceiling, 4 the vendor call failed after the send (reservation left open), 5 key problem.
"""
import argparse
import json
import os
import stat
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spendguard as SG  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = {'anthropic': '~/.config/mcai/anthropic.key', 'openai': '~/.config/mcai/openai.key'}
MODELS = {'claude-sonnet-5-5': 'anthropic', 'claude-haiku-5-5': 'anthropic', 'claude-opus-5-5': 'anthropic', 'gpt-6.1-sol': 'openai'}
INPUT_CEILING = 3000
MAX_TOKENS = 4000
REASONS = ['build_progress', 'idle_capacity', 'continuity', 'rebalance', 'stall_break', 'nothing_to_do']
WHY = ['none', 'nothing_to_do', 'no_change', 'safety_hold', 'budget_low']
REPLY_SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['gen', 'abstain', 'why', 'leases', 'unstaffed'],
    'properties': {
        'gen': {'type': 'integer'},
        'abstain': {'type': 'boolean'},
        'why': {'type': 'string', 'enum': WHY},
        'leases': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['bot', 'job', 'ttl_min', 'reason', 'evidence'],
            'properties': {'bot': {'type': 'string'}, 'job': {'type': 'string', 'enum': ['BUILD']}, 'ttl_min': {'type': 'integer'},
                           'reason': {'type': 'string', 'enum': REASONS}, 'evidence': {'type': 'array', 'items': {'type': 'string'}}}}},
        'unstaffed': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['job', 'why'],
            'properties': {'job': {'type': 'string'}, 'why': {'type': 'string'}}}},
    },
}


def read_key(vendor):
    p = os.path.expanduser(KEYS[vendor])
    try:
        st = os.stat(p)
    except OSError:
        raise SystemExit(5)
    if stat.S_IMODE(st.st_mode) != 0o600 or st.st_uid != os.getuid():
        raise SystemExit(5)
    with open(p) as fh:
        return fh.read().strip()


def build_request(model, snapshot, system):
    """-> (vendor, params). The params ARE the request (the SDK sends exactly these fields)."""
    vendor = MODELS[model]
    user = json.dumps(snapshot, sort_keys=True, separators=(',', ':'))
    if vendor == 'anthropic':
        return vendor, {'model': model, 'max_tokens': MAX_TOKENS, 'system': system,
                        'messages': [{'role': 'user', 'content': user}],
                        'output_config': {'effort': 'low', 'format': {'type': 'json_schema', 'schema': REPLY_SCHEMA}}}
    return vendor, {'model': model, 'instructions': system, 'input': user, 'max_output_tokens': MAX_TOKENS, 'store': False,
                    'reasoning': {'effort': 'low'},
                    'text': {'format': {'type': 'json_schema', 'name': 'leases', 'schema': REPLY_SCHEMA, 'strict': True}}}


def body_bytes(params):
    return json.dumps(params, sort_keys=True, separators=(',', ':')).encode()


def client_for(vendor):
    if vendor == 'anthropic':
        import anthropic
        return anthropic.Anthropic(api_key=read_key('anthropic'), max_retries=0, timeout=120)
    import openai
    return openai.OpenAI(api_key=read_key('openai'), max_retries=0, timeout=120)


def count_tokens(vendor, client, params):
    """The vendor's own count of THIS request -> int. Raises on any failure (the caller fails closed)."""
    if vendor == 'anthropic':
        r = client.messages.count_tokens(model=params['model'], system=params['system'], messages=params['messages'],
                                         output_config=params['output_config'])
        return int(r.input_tokens)
    r = client.responses.input_tokens.count(model=params['model'], instructions=params['instructions'], input=params['input'],
                                            reasoning=params['reasoning'], text=params['text'])
    return int(r.input_tokens)


def send(vendor, client, params):
    """-> (text, usage dict, request_id, stop)."""
    if vendor == 'anthropic':
        m = client.messages.create(**params)
        text = ''.join(b.text for b in m.content if getattr(b, 'type', '') == 'text')
        u = m.usage
        usage = {'input_tokens': u.input_tokens, 'output_tokens': u.output_tokens,
                 'cache_read_input_tokens': getattr(u, 'cache_read_input_tokens', 0) or 0,
                 'cache_creation_input_tokens': getattr(u, 'cache_creation_input_tokens', 0) or 0}
        return text, usage, m.id, m.stop_reason
    r = client.responses.create(**params)
    u = r.usage
    return r.output_text or '', {'input_tokens': u.input_tokens, 'output_tokens': u.output_tokens}, r.id, r.status


def call(model, snapshot, out, purpose='paper', run=None, root=None, dry=False, reconcile_required_h='default', wait_lock_s=0):
    with open(os.path.join(HERE, 'system_prompt.txt')) as f:
        system = f.read()
    # the 36 h reconciliation stop holds for shadow and live; a Paper run (B5) has no vendor export to wait for (it settles
    # every call from its own usage, and its reservations record `reconcile: off`)
    if reconcile_required_h == 'default':
        reconcile_required_h = None if purpose == 'paper' else 36
    g = SG.Guard(root, reconcile_required_h=reconcile_required_h)
    meta = {'model': model, 'purpose': purpose, 'run': run, 'gen': snapshot.get('gen'), 'ts': time.time()}
    try:
        lock = SG.CallerLock(g.root, wait_s=wait_lock_s).__enter__()
    except SG.GuardRefused as e:
        meta.update(outcome='guard_refused', why=str(e))
        _write(out, None, meta)
        return 2
    try:
        vendor, params = build_request(model, snapshot, system)
        body = body_bytes(params)
        h = SG.request_hash(body)
        client = client_for(vendor)
        try:
            n = count_tokens(vendor, client, params)
        except Exception as e:
            meta.update(outcome='not_counted', error=type(e).__name__)
            _write(out, None, meta)
            return 3
        meta['in_tokens_counted'] = n
        if n > INPUT_CEILING:
            meta.update(outcome='over_ceiling')
            _write(out, None, meta)
            return 3
        if dry:
            meta.update(outcome='dry')
            _write(out, None, meta)
            return 0
        try:
            res = g.reserve(model, n, MAX_TOKENS, h, purpose=purpose, run=run)
        except SG.GuardRefused as e:
            meta.update(outcome='guard_refused', why=str(e))
            _write(out, None, meta)
            return 2
        meta.update(rid=res['rid'], usd_worst=res['usd_worst'])
        g.check_send(res['rid'], body_bytes(params))
        t0 = time.time()
        try:
            text, usage, req_id, stop = send(vendor, client, params)
        except Exception as e:
            meta.update(outcome='send_failed', error=type(e).__name__, latency_s=round(time.time() - t0, 2))
            _write(out, None, meta)
            return 4                                   # the reservation stays OPEN: reconciliation settles it
        try:
            usd = g.settle(res['rid'], model, usage, request_id=req_id)
        except SG.GuardRefused as e:
            meta.update(outcome='unsettled', why=str(e))     # the reservation stays OPEN at its worst case
            _write(out, None, meta, raw=text)
            return 4
        parsed = None
        try:
            parsed = json.loads(text)
        except Exception:
            pass
        meta.update(outcome='ok', usd=usd, usage=usage, stop=stop, latency_s=round(time.time() - t0, 2), request_id=req_id)
        _write(out, parsed, meta, raw=text)
        return 0
    finally:
        lock.__exit__()


def _write(out, parsed, meta, raw=None):
    tmp = out + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'reply': parsed, 'meta': meta, 'raw': raw[:4000] if raw else None}, f)
    os.replace(tmp, out)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['call'])
    ap.add_argument('--model', required=True, choices=sorted(MODELS))
    ap.add_argument('--snapshot', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--purpose', default='paper', choices=SG.PURPOSES)
    ap.add_argument('--run', default=None)
    ap.add_argument('--root', default=None)
    ap.add_argument('--dry', action='store_true', help='count only: no reservation, no send')
    ap.add_argument('--wait-lock', type=float, default=0, help='wait up to S seconds for another caller to finish (B5 runs in parallel)')
    a = ap.parse_args(argv)
    with open(a.snapshot) as f:
        snap = json.load(f)
    return call(a.model, snap, a.out, purpose=a.purpose, run=a.run, root=a.root, dry=a.dry, wait_lock_s=a.wait_lock)


if __name__ == '__main__':
    sys.exit(main())
