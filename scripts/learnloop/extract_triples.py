#!/usr/bin/env python3
"""learning-loop prototype: extract (prompt, action, outcome-window) triples for ONE UTC day (read-only).

    nice -n 19 python3 extract_triples.py --day 2026-10-20 --out ~/learnloop-scratch-1021

Reads /var/log/mcai/<bot>/llm-<bot>.jsonl* (decisions) and skill-<bot>.jsonl* (outcomes), one bot at a time, so
memory stays at one bot-day (a few MB) -- this runs on the FLEET host and must never compete with the bots. Writes
<out>/triples/<bot>.jsonl.gz and <out>/summary.json. Never trains, never serves, never touches an endpoint.

A TRIPLE is one decision row:
  state   = the user prompt exactly as the model saw it (prompt.text; the system prompt is carried by its hash and is
            rebuilt per code version, as brain-01's replay did) + bot/pool/code/model tags
  action  = response.text (raw model output) and the parsed tool call (skill, args, reason)
  outcome = the gate (refused + reason, or the admission door), the executed status/detail, the joined skill row
            (duration, inventory_delta, distance_moved), the evidence value the bot itself computed (parsed back from
            the NEXT prompt's RECENT EVENTS line, because the llm log drops outcome.value), and windows of N s after the
            decision start: items gained, deaths, stagnation events, milestones completed.

Definitions follow brainread.py (the brain-01 read) so the labels can be validated against that read:
  model decision = llm.latency_ms > 0; refused = outcome aborted and admission null; success = outcome success;
  death = skill `_death`; stagnation = `_stagnation*` or STAGNANT in the detail; items = positive inventory_delta.
Every count in summary.json carries its denominator and a positive control (rows, bots, timestamps, the kinds found).
"""
import argparse, collections, glob, gzip, hashlib, json, os, re, statistics as st, sys
from datetime import datetime, timedelta, timezone

P = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
ROT = re.compile(r'-(\d{8})(?:\.gz)?$')
NONCE = re.compile(r'(saw_end:\s*)END-[A-Z0-9]+')
EVENT = re.compile(r'^\s*- (\w+) -> (\w+)(?: \((\w+)\))?:')


def files_for(path, day):
    """Live file + rotated generations that can hold `day` (a generation -YYYYMMDD holds the day BEFORE its suffix;
    keep [day, day+2] and let the timestamp filter decide -- brainread.files_for's rule)."""
    lo = day.strftime('%Y%m%d'); hi = (day + timedelta(days=3)).strftime('%Y%m%d')
    keep = [path] if os.path.exists(path) else []
    for f in glob.glob(path + '-*'):
        m = ROT.search(f)
        if m and lo <= m.group(1) <= hi:
            keep.append(f)
    return sorted(keep)


def read_rows(path, day, t0, t1):
    out = []
    for f in files_for(path, day):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for line in fh:
                    if not line.startswith('{"@timestamp"'):
                        continue
                    ts = line[15:39]
                    if ts[:19] < t0[:19] or ts[:19] >= t1[:19]:
                        continue
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        pass
        except (OSError, EOFError):
            continue
    out.sort(key=lambda r: r['@timestamp'])
    return out


def norm_prompt(text):
    return NONCE.sub(r'\1END-X', text or '')


def gain(delta):
    return sum(v for v in (delta or {}).values() if isinstance(v, (int, float)) and v > 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--day', required=True)
    ap.add_argument('--logroot', default='/var/log/mcai')
    ap.add_argument('--roster', default='/srv/mcbots/harness/env')
    ap.add_argument('--out', required=True)
    ap.add_argument('--windows', default='120,600')
    ap.add_argument('--no-write', action='store_true', help='summary only')
    a = ap.parse_args()
    day = datetime.strptime(a.day, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    W = [int(x) for x in a.windows.split(',')]
    t0 = day.strftime('%Y-%m-%dT%H:%M:%S'); t1 = (day + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S')
    t1s = (day + timedelta(days=1, seconds=max(W) + 60)).strftime('%Y-%m-%dT%H:%M:%S')
    os.makedirs(os.path.join(a.out, 'triples'), exist_ok=True)

    logbots = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob(a.logroot + '/*-*/'))
    roster = {f[:-4] for f in os.listdir(a.roster) if f.endswith('.env')} if os.path.isdir(a.roster) else set(logbots)
    bots = [b for b in logbots if b in roster]

    S = collections.Counter()               # population counters
    acts = collections.Counter(); refuse = collections.Counter(); status = collections.Counter()
    labels = collections.Counter(); lab_by_skill = collections.defaultdict(collections.Counter)
    per_pool = collections.Counter(); per_ep = collections.Counter(); versions = collections.Counter()
    sys_hash = collections.Counter(); models = collections.Counter(); kinds_seen = collections.Counter()
    prompt_tok = []; resp_tok = []; seen = set(); dup = 0
    tmin, tmax = None, None

    for b in bots:
        L = read_rows('%s/%s/llm-%s.jsonl' % (a.logroot, b, b), day, t0, t1)
        if not L:
            S['bots_without_rows'] += 1
            continue
        K = read_rows('%s/%s/skill-%s.jsonl' % (a.logroot, b, b), day, t0, t1s)
        S['bots'] += 1
        tmin = min(tmin or L[0]['@timestamp'], L[0]['@timestamp']); tmax = max(tmax or L[-1]['@timestamp'], L[-1]['@timestamp'])
        # skill-side event times
        kt = [(P(r['@timestamp']).timestamp(), r) for r in K]
        for _, r in kt:
            n = (r.get('skill') or {}).get('name', '')
            if n == '_death' or n.startswith('_stagnation') or n == '_milestone_complete':
                if r['@timestamp'] < t1:
                    kinds_seen[n.split(':')[0]] += 1
        S['skill_rows'] += sum(1 for _, r in kt if r['@timestamp'] < t1)
        out = None if a.no_write else gzip.open(os.path.join(a.out, 'triples', b + '.jsonl.gz'), 'wt')
        lt = [P(r['@timestamp']).timestamp() for r in L]
        j = 0                                                   # sweeping index into kt
        for i, r in enumerate(L):
            llm = r.get('llm') or {}; S['llm_rows'] += 1
            model = (llm.get('latency_ms') or 0) > 0
            if not model:
                S['deterministic_rows'] += 1
                continue
            S['model_rows'] += 1
            t = lt[i]
            pool = (r.get('exp') or {}).get('pool'); per_pool[pool] += 1
            per_ep[llm.get('endpoint')] += 1; models[llm.get('model')] += 1
            ver = ((r.get('code') or {}).get('version') or '').split('+')[0][:8]; versions[ver] += 1
            ph = (r.get('prompt') or {}).get('system_hash'); sys_hash[ph] += 1
            ptxt = (r.get('prompt') or {}).get('text') or ''
            rtxt = (r.get('response') or {}).get('text') or ''
            complete = 'saw_end:' in ptxt[-40:] and len(ptxt) < 6000
            S['prompt_complete'] += complete; S['response_present'] += bool(rtxt)
            S['schema_valid'] += bool(llm.get('schema_valid'))
            if llm.get('prompt_tokens'): prompt_tok.append(llm['prompt_tokens'])
            if llm.get('completion_tokens'): resp_tok.append(llm['completion_tokens'])
            key = hashlib.sha1((str(ph) + norm_prompt(ptxt)).encode()).hexdigest()
            if key in seen: dup += 1
            seen.add(key)
            tc = (r.get('tool_calls') or [{}])[0] if r.get('tool_calls') else {}
            skill = tc.get('skill'); acts[skill] += 1
            o = r.get('outcome') or {}; ost = o.get('status')
            refused = ost == 'aborted' and llm.get('admission') is None
            if refused: refuse[llm.get('error') or '?'] += 1
            else: status[ost] += 1
            # the executed skill row: same name, stamped at the decision start (rows stamp START)
            while j < len(kt) and kt[j][0] < t - 5: j += 1
            own = None
            if not refused and skill:
                for k in range(j, min(len(kt), j + 400)):
                    if kt[k][0] > t + 10: break
                    if (kt[k][1].get('skill') or {}).get('name') == skill:
                        own = kt[k][1].get('skill'); break
            S['admitted'] += (not refused); S['own_row_joined'] += bool(own)
            # windows
            win = {}
            for w in W:
                g = d = sg = ms = 0
                for k in range(j, len(kt)):
                    tk, rk = kt[k]
                    if tk < t: continue
                    if tk >= t + w: break
                    sk = rk.get('skill') or {}; n = sk.get('name', '')
                    if n == '_death': d += 1
                    elif n.startswith('_stagnation') or 'STAGNANT' in (sk.get('detail') or ''): sg += 1
                    elif n == '_milestone_complete': ms += 1
                    if not n.startswith('_'): g += gain(sk.get('inventory_delta'))
                win[str(w)] = {'items': g, 'deaths': d, 'stagnation': sg, 'milestones': ms}
            # the bot's own evidence value, from the next row's RECENT EVENTS (the llm log drops outcome.value)
            value = None
            if not refused and skill and i + 1 < len(L):
                nxt = ((L[i + 1].get('prompt') or {}).get('text') or '')
                if 'RECENT EVENTS' in nxt:
                    for line in reversed(nxt.split('RECENT EVENTS', 1)[1].splitlines()):
                        m = EVENT.match(line)
                        if m and m.group(1) == skill and m.group(2) == ost:
                            value = m.group(3) or 'none'; break
            S['value_recovered'] += (value is not None and not refused)
            nxt_gap = (lt[i + 1] - t) if i + 1 < len(L) else None
            w0, w1 = win[str(W[0])], win[str(W[-1])]
            if refused or ost in ('failed', 'aborted') or w0['deaths'] or w0['stagnation']:
                lab = 'bad'
            elif ost == 'success' and (value == 'valuable' or gain((own or {}).get('inventory_delta')) > 0
                                       or w0['milestones']) and not w1['deaths']:
                lab = 'good'
            else:
                lab = 'neutral'
            labels[lab] += 1; lab_by_skill[skill][lab] += 1
            if out:
                out.write(json.dumps({
                    'id': key[:16] + ':' + r['@timestamp'], 'ts': r['@timestamp'], 'bot': b, 'pool': pool,
                    'code_version': ver, 'model': llm.get('model'), 'endpoint': llm.get('endpoint'),
                    'system_hash': ph, 'trigger': r.get('trigger'),
                    'milestone': ((r.get('messages') or [{}])[0] or {}).get('milestone'),
                    'prompt': ptxt, 'prompt_complete': complete, 'response': rtxt,
                    'action': {'skill': skill, 'args': tc.get('args'), 'reason': tc.get('reason')},
                    'schema_valid': llm.get('schema_valid'), 'args_cleaned': llm.get('args_cleaned'),
                    'prompt_tokens': llm.get('prompt_tokens'), 'completion_tokens': llm.get('completion_tokens'),
                    'latency_ms': llm.get('latency_ms'),
                    'gate': {'refused': refused, 'reason': llm.get('error') if refused else None,
                             'admission': llm.get('admission')},
                    'outcome': {'status': ost, 'detail': o.get('detail'), 'value': value,
                                'duration_ms': (own or {}).get('duration_ms'),
                                'inventory_delta': (own or {}).get('inventory_delta'),
                                'distance_moved': (own or {}).get('distance_moved'), 'next_decision_s': nxt_gap},
                    'window': win, 'label': lab}) + '\n')
        if out: out.close()

    q = lambda xs, p: sorted(xs)[int(p * (len(xs) - 1))] if xs else None
    summ = {
        'day': a.day, 'positive_control': {'bots': S['bots'], 'roster': len(bots), 'bots_without_rows': S['bots_without_rows'],
                                           'llm_rows': S['llm_rows'], 'skill_rows': S['skill_rows'], 'first': tmin, 'last': tmax,
                                           'skill_kinds_found': dict(kinds_seen)},
        'rows': {k: S[k] for k in ('llm_rows', 'model_rows', 'deterministic_rows', 'admitted', 'own_row_joined',
                                   'prompt_complete', 'response_present', 'schema_valid', 'value_recovered')},
        'exact_duplicate_prompts': dup, 'distinct_prompts': len(seen),
        'prompt_tokens': {'p50': q(prompt_tok, .5), 'p95': q(prompt_tok, .95), 'n': len(prompt_tok), 'sum': sum(prompt_tok)},
        'completion_tokens': {'p50': q(resp_tok, .5), 'p95': q(resp_tok, .95), 'n': len(resp_tok), 'sum': sum(resp_tok)},
        'labels': dict(labels), 'actions': dict(acts.most_common()), 'refused_by_reason': dict(refuse.most_common()),
        'admitted_status': dict(status.most_common()),
        'labels_by_skill': {k: dict(v) for k, v in sorted(lab_by_skill.items(), key=lambda kv: -sum(kv[1].values()))[:20]},
        'per_pool': dict(per_pool), 'per_endpoint': dict(per_ep), 'models': dict(models), 'code_versions': dict(versions),
        'system_hashes': dict(sys_hash),
    }
    json.dump(summ, open(os.path.join(a.out, 'summary.json'), 'w'), indent=1)
    print(json.dumps(summ, indent=1))


if __name__ == '__main__':
    main()
