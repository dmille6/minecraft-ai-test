#!/usr/bin/env python3
"""learning-loop prototype: extract (prompt, action, outcome-window) triples for ONE UTC day (read-only).

    nice -n 19 ionice -c3 python3 extract_triples.py --day 2026-10-20 --out ~/learnloop-scratch-1021/day-20261020

Reads /var/log/mcai/<bot>/llm-<bot>.jsonl* (decisions) and skill-<bot>.jsonl* (outcomes) one bot at a time, so memory
stays at about one bot-day -- this runs on the FLEET host and must never compete with the bots. Writes
<out>/triples/<bot>.jsonl.gz and <out>/summary.json. Never trains, never serves, never touches an endpoint.

WHY NOT lib/telemetry.Events: Events.load() keeps only rows with skill.name, so it cannot read the decision stream
(memory: the-decision-stream-is-a-separate-file). This reader uses brainread.files_for's rotation rule and COUNTS
every unreadable file and unparseable line instead of skipping them silently.

A TRIPLE is one model decision (llm.latency_ms > 0) stamped in the day:
  state   = prompt.text (the user prompt as sent; the system prompt is carried by its hash and rebuilt per code version)
  action  = response.text (raw) + the parsed tool call; nonce_ok = the response's saw_end equals the prompt's nonce
  gate    = refused (outcome aborted, admission null -- brainread's definition) + reason, or the admission door
  own     = the EXECUTED skill row, joined by: same skill name, trigger llm:* / interrupt:*, start in
            [t, t + latency + 30 s] (the runner stamps its start AFTER inference; the decision row stamps BEFORE it),
            not already used by an earlier decision. Quality: `exact` = status equal AND the first 120 chars of the
            detail equal (both come from the same result object), `status` = status equal only, `ambiguous` = more
            than one exact candidate (the earliest is taken and flagged), `none`.
  value   = the bot's own evidence value (valuable/neutral/costly; the llm log drops it), parsed back from the next
            decision row's RECENT EVENTS line `<skill> -> <status> (<value>)`; next rows are read past midnight.
            Failures carry no value (recorded as 'none' = line found, no value).
  windows = for N in (120, 600) s after the decision start: items = positive inventory_delta of non-underscore skill
            rows that ENDED in the window (start + duration_ms), with the decision's own row counted separately
            (items_other excludes it -- the non-circular check); deaths/stagnation/milestones = event rows stamped in
            the window. observed = the bot has rows at or after the window end (else the window is CENSORED).
Per-bot totals (independent of the joins): items_all = brainread's items (positive inventory_delta of every skill row
started in the day), items_gathered = the same minus transfer skills (withdraws, town smelt/toolkit draws), bot_h from
decision rows. Every count in summary.json carries its denominator; the positive control is printed first.
"""
import argparse, bisect, collections, glob, gzip, hashlib, json, os, re, sys
from datetime import datetime, timedelta, timezone

P = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
ROT = re.compile(r'-(\d{8})(?:\.gz)?$')
NONCE_P = re.compile(r'saw_end:\s*(END-[A-Z0-9]+)')
NONCE_R = re.compile(r'"saw_end"\s*:\s*"([^"]*)"')
NORM = re.compile(r'(saw_end:\s*)END-[A-Z0-9]+')
EVENT = re.compile(r'^\s*- (\w+) -> (\w+)(?: \((\w+)\))?:')
# NOT PRODUCTION (Claude r2): moves items between bag and chest (transfers) or turns items into other items
# (conversions: 1 log -> +4 planks counts as a positive delta). On 10-20 these were 3.6% of all positive gains (3,367 of 92,826);
# gather 48.0%, mine 32.3%, goto 12.3%, surface 2.8% carry the rest. Underscore event rows carry no inventory_delta.
TRANSFER = {'withdraw', 'withdraw_pick', 'toolkit', 'smelt_town', 'furnace_drain', 'town_deposit', 'deposit',
            'craft', 'smelt', 'compost', 'wear_out', 'dispose_well', 'count_town'}
BAD = collections.Counter()


def files_for(path, lo_day, hi_day):
    """Live file + rotated generations that can hold [lo_day, hi_day]. A generation -YYYYMMDD is rotated ~23:59Z of
    the day BEFORE its suffix; a row written just after a rotation lands one generation later, so keep suffixes in
    [lo_day, hi_day + 2 days] and let the timestamp filter decide (brainread.files_for's rule). Plain and .gz both."""
    lo = lo_day.strftime('%Y%m%d'); hi = (hi_day + timedelta(days=2)).strftime('%Y%m%d')
    keep = [path] if os.path.exists(path) else []
    for f in glob.glob(path + '-*'):
        m = ROT.search(f)
        if m and lo <= m.group(1) <= hi:
            keep.append(f)
    return sorted(keep)


def read_rows(path, t0, t1):
    out = []
    for f in files_for(path, P(t0 + 'Z'), P(t1 + 'Z')):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for line in fh:
                    if not line.startswith('{"@timestamp"'):
                        BAD['line_without_timestamp_prefix'] += 1
                        continue
                    ts = line[15:34]
                    if ts < t0 or ts >= t1:
                        continue
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        BAD['unparseable_line'] += 1
        except (OSError, EOFError) as e:
            BAD['unreadable_file'] += 1
            print('UNREADABLE', f, e, file=sys.stderr)
    out.sort(key=lambda r: r['@timestamp'])
    return out


def gain(delta):
    return sum(v for v in (delta or {}).values() if isinstance(v, (int, float)) and v > 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--day', required=True)
    ap.add_argument('--logroot', default='/var/log/mcai')
    ap.add_argument('--roster', default='/srv/mcbots/harness/env')
    ap.add_argument('--out', required=True)
    ap.add_argument('--windows', default='120,600')
    ap.add_argument('--no-write', action='store_true')
    a = ap.parse_args()
    day = datetime.strptime(a.day, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    W = [int(x) for x in a.windows.split(',')]
    f = lambda d: d.strftime('%Y-%m-%dT%H:%M:%S')
    t0, t1 = f(day), f(day + timedelta(days=1))
    look = f(day + timedelta(days=1, seconds=max(W) + 3600))          # lookahead: next prompts, long skills, windows
    back = f(day - timedelta(hours=2))                                  # skills that started before t and end after it
    os.makedirs(os.path.join(a.out, 'triples'), exist_ok=True)

    logbots = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob(a.logroot + '/*-*/'))
    roster = sorted(x[:-4] for x in os.listdir(a.roster) if x.endswith('.env') and not x.startswith('.')) if os.path.isdir(a.roster) else logbots   # '._x.env' = macOS AppleDouble copies
    S = collections.Counter(); C = collections.defaultdict(collections.Counter)
    seen_p, seen_pa = set(), set(); per_bot = {}; tmin = tmax = None
    events_day = collections.Counter()

    for b in roster:
        if b not in logbots:
            S['roster_bots_without_log_dir'] += 1; continue
        Lall = read_rows('%s/%s/llm-%s.jsonl' % (a.logroot, b, b), t0, look)
        K = read_rows('%s/%s/skill-%s.jsonl' % (a.logroot, b, b), back, look)
        L = [r for r in Lall if r['@timestamp'][:19] < t1]
        if not L:
            S['roster_bots_without_rows'] += 1; continue
        S['bots'] += 1
        tmin = min(tmin or L[0]['@timestamp'], L[0]['@timestamp']); tmax = max(tmax or L[-1]['@timestamp'], L[-1]['@timestamp'])
        last_seen = max(Lall[-1]['@timestamp'], K[-1]['@timestamp'] if K else '')
        last_seen_t = P(last_seen).timestamp()
        kt = []
        for r in K:
            sk = r.get('skill') or {}; st = P(r['@timestamp']).timestamp()
            kt.append((st, st + (sk.get('duration_ms') or 0) / 1000, r, sk))
        # COMPLETIONS BY END TIME (Codex r2): a skill that started long before t but ended inside the window must count
        ends = sorted((kt[i][1], i) for i in range(len(kt)) if not kt[i][3].get('name', '').startswith('_'))
        end_t = [e for e, _ in ends]
        S['max_skill_duration_s'] = max(S['max_skill_duration_s'], max([kt[i][1] - kt[i][0] for i in range(len(kt))] or [0]))
        # per-bot independent production (brainread items) over rows STARTED in the day
        pb = collections.Counter()
        for st, en, r, sk in kt:
            if not (t0 <= r['@timestamp'][:19] < t1): continue
            n = sk.get('name', ''); g = gain(sk.get('inventory_delta'))
            pb['items_all'] += g
            if n not in TRANSFER: pb['items_gathered'] += g
            if n == '_death': events_day['_death'] += 1; pb['deaths'] += 1
            elif n.startswith('_stagnation') or 'STAGNANT' in (sk.get('detail') or ''):
                events_day['stagnation_broad (_stagnation*, or STAGNANT in detail)'] += 1
                if n == '_stagnation': events_day['_stagnation (exact kind)'] += 1
            elif n == '_milestone_complete': events_day['_milestone_complete'] += 1
            S['skill_rows_in_day'] += 1
        pb['bot_h'] = (P(L[-1]['@timestamp']) - P(L[0]['@timestamp'])).total_seconds() / 3600
        pb['world'] = b.rsplit('-', 1)[0]
        used = set()
        out = None if a.no_write else gzip.open(os.path.join(a.out, 'triples', b + '.jsonl.gz'), 'wt')
        lt = [P(r['@timestamp']).timestamp() for r in Lall]
        j = 0
        for i, r in enumerate(L):
            llm = r.get('llm') or {}; S['llm_rows'] += 1
            if not (llm.get('latency_ms') or 0) > 0:
                S['deterministic_rows'] += 1; continue
            S['model_rows'] += 1; pb['model'] += 1
            t = lt[i]; lat = llm['latency_ms'] / 1000
            ptxt = (r.get('prompt') or {}).get('text') or ''; rtxt = (r.get('response') or {}).get('text') or ''
            complete = 'saw_end:' in ptxt[-40:] and len(ptxt) < 6000
            pn = NONCE_P.search(ptxt[-60:]); rn = NONCE_R.search(rtxt)
            nonce_ok = bool(pn and rn and pn.group(1) == rn.group(1))
            S['prompt_complete'] += complete; S['response_present'] += bool(rtxt); S['nonce_ok'] += nonce_ok
            S['schema_valid'] += bool(llm.get('schema_valid'))
            ph = (r.get('prompt') or {}).get('system_hash')
            tc = (r.get('tool_calls') or [{}])[0] if r.get('tool_calls') else {}
            skill = tc.get('skill'); args = tc.get('args')
            kp = hashlib.sha1((str(ph) + NORM.sub(r'\1END-X', ptxt)).encode()).hexdigest()
            kpa = hashlib.sha1((kp + json.dumps([skill, args], sort_keys=True)).encode()).hexdigest()
            S['dup_prompt'] += kp in seen_p; S['dup_prompt_action'] += kpa in seen_pa
            seen_p.add(kp); seen_pa.add(kpa)
            o = r.get('outcome') or {}; ost = o.get('status')
            refused = ost == 'aborted' and llm.get('admission') is None
            ep = llm.get('endpoint')
            C['actions'][skill] += 1
            if refused: C['refused'][(llm.get('error') or '?').split('(')[0].strip()] += 1
            else: C['admitted_status'][ost] += 1
            # ---- join the executed skill row
            while j < len(kt) and kt[j][0] < t - 1: j += 1
            own = None; quality = 'none'
            if not refused and skill:
                exact, stat = [], []
                for k in range(j, len(kt)):
                    st = kt[k][0]
                    if st > t + lat + 30: break
                    if k in used: continue
                    sk = kt[k][3]; trg = kt[k][2].get('trigger') or ''
                    if sk.get('name') != skill or not (trg.startswith('llm:') or trg.startswith('interrupt:')): continue
                    if sk.get('status') == ost:
                        if (sk.get('detail') or '')[:120] == (o.get('detail') or '')[:120]: exact.append(k)
                        else: stat.append(k)
                pick = exact or stat
                if pick:
                    own = pick[0]; used.add(own)
                    quality = 'ambiguous' if len(exact) > 1 else ('exact' if exact else 'status')
                S['admitted'] += 1; C['join'][quality] += 1
                if quality == 'none':
                    C['join_miss_skill'][skill] += 1; C['join_miss_endpoint'][ep] += 1
                    dd = o.get('detail') or ''
                    why = 'paused (runner refused to start)' if dd.startswith('paused after repeated failures') else \
                          'busy (runner refused to start)' if dd.startswith('busy with ') else 'OTHER: ' + re.sub(r'[0-9,.-]+', '#', dd)[:60]
                    C['join_miss_why'][why] += 1
            ownsk = kt[own][3] if own is not None else {}
            # ---- value from the next decision row (any row, read past midnight)
            value = None
            if not refused and skill and i + 1 < len(Lall):
                nxt = ((Lall[i + 1].get('prompt') or {}).get('text') or '')
                if 'RECENT EVENTS' in nxt:
                    for line in reversed(nxt.split('RECENT EVENTS', 1)[1].splitlines()):
                        m = EVENT.match(line)
                        if m and m.group(1) == skill and m.group(2) == ost:
                            value = m.group(3) or 'none'; break
            if not refused: C['value'][value] += 1
            # ---- windows
            win = {}
            for w in W:
                g = go = d = sg = ms = 0
                for _, k in ends[bisect.bisect_left(end_t, t):bisect.bisect_left(end_t, t + w)]:   # ended in [t, t+w)
                    gg = gain(kt[k][3].get('inventory_delta')); g += gg
                    if k != own: go += gg
                for k in range(j, len(kt)):                                                        # events stamped in [t, t+w)
                    st, en, rk, sk = kt[k]
                    if st >= t + w: break
                    if st < t: continue
                    n = sk.get('name', '')
                    if n == '_death': d += 1
                    elif n.startswith('_stagnation') or 'STAGNANT' in (sk.get('detail') or ''): sg += 1
                    elif n == '_milestone_complete': ms += 1
                win[str(w)] = {'items': g, 'items_other': go, 'deaths': d, 'stagnation': sg, 'milestones': ms,
                               'observed': last_seen_t >= t + w}
            w0, w1 = win[str(W[0])], win[str(W[-1])]
            dd0 = o.get('detail') or ''
            if not refused and ost == 'failed' and (dd0.startswith('paused after repeated failures') or dd0.startswith('busy with ')):
                lab = 'void'      # the runner refused to start: no evidence about the action (Claude r2); never a negative
            elif refused or ost in ('failed', 'aborted') or w0['deaths'] or w0['stagnation']:
                lab = 'bad'
            elif ost == 'success' and (value == 'valuable' or gain(ownsk.get('inventory_delta')) > 0 or w0['milestones']) \
                    and not w1['deaths'] and w1['observed']:
                lab = 'good'
            else:
                lab = 'neutral'
            C['labels'][lab] += 1; C['label_x_skill'][(skill, lab)] += 1
            C['endpoint'][ep] += 1; C['model'][llm.get('model')] += 1
            C['version'][((r.get('code') or {}).get('version') or '').split('+')[0][:8]] += 1; C['system_hash'][ph] += 1
            if out:
                out.write(json.dumps({
                    'id': kp[:16] + ':' + r['@timestamp'], 'ts': r['@timestamp'], 'bot': b, 'world': pb['world'],
                    'pool': (r.get('exp') or {}).get('pool'),
                    'code_version': ((r.get('code') or {}).get('version') or '').split('+')[0][:8],
                    'model': llm.get('model'), 'endpoint': ep, 'system_hash': ph, 'trigger': r.get('trigger'),
                    'milestone': ((r.get('messages') or [{}])[0] or {}).get('milestone'),
                    'prompt': ptxt, 'prompt_complete': complete, 'response': rtxt, 'nonce_ok': nonce_ok,
                    'action': {'skill': skill, 'args': args, 'reason': tc.get('reason')},
                    'schema_valid': llm.get('schema_valid'), 'args_cleaned': llm.get('args_cleaned'),
                    'prompt_tokens': llm.get('prompt_tokens'), 'completion_tokens': llm.get('completion_tokens'),
                    'latency_ms': llm.get('latency_ms'), 'retry_count': llm.get('retry_count'),
                    'gate': {'refused': refused, 'reason': llm.get('error') if refused else None, 'admission': llm.get('admission')},
                    'outcome': {'status': ost, 'detail': o.get('detail'), 'value': value, 'join': quality,
                                'duration_ms': ownsk.get('duration_ms'), 'inventory_delta': ownsk.get('inventory_delta'),
                                'distance_moved': ownsk.get('distance_moved'),
                                'next_decision_s': (lt[i + 1] - t) if i + 1 < len(Lall) else None},
                    'window': win, 'label': lab, 'dedupe': {'prompt': kp, 'prompt_action': kpa}}) + '\n')
        if out: out.close()
        per_bot[b] = dict(pb)

    lxs = collections.defaultdict(dict)
    for (sk, lab), n in C['label_x_skill'].items(): lxs[str(sk)][lab] = n
    summ = {'day': a.day,
            'positive_control': {'roster': len(roster), 'bots_with_rows': S['bots'], 'first': tmin, 'last': tmax,
                                 'llm_rows': S['llm_rows'], 'skill_rows_in_day': S['skill_rows_in_day'],
                                 'event_rows_in_day': dict(events_day), 'reader_rejects': dict(BAD),
                                 'roster_bots_without_log_dir': S['roster_bots_without_log_dir'],
                                 'roster_bots_without_rows': S['roster_bots_without_rows']},
            'rows': {k: S[k] for k in ('model_rows', 'deterministic_rows', 'admitted', 'prompt_complete',
                                       'response_present', 'nonce_ok', 'schema_valid', 'dup_prompt', 'dup_prompt_action')},
            'max_skill_duration_s': round(S['max_skill_duration_s']), 'join': dict(C['join']), 'join_miss_skill': dict(C['join_miss_skill'].most_common(12)),
            'join_miss_endpoint': dict(C['join_miss_endpoint']), 'join_miss_why': dict(C['join_miss_why'].most_common()), 'value': {str(k): v for k, v in C['value'].items()},
            'labels': dict(C['labels']), 'labels_by_skill': lxs,
            'actions': {str(k): v for k, v in C['actions'].most_common()}, 'refused_by_reason': dict(C['refused'].most_common()),
            'admitted_status': dict(C['admitted_status'].most_common()), 'endpoint': {str(k): v for k, v in C['endpoint'].items()},
            'model': dict(C['model']), 'code_version': dict(C['version']), 'system_hash': dict(C['system_hash']),
            'per_bot': per_bot}
    json.dump(summ, open(os.path.join(a.out, 'summary.json'), 'w'), indent=1)
    print(json.dumps({k: v for k, v in summ.items() if k not in ('per_bot', 'labels_by_skill')}, indent=1))


if __name__ == '__main__':
    main()
