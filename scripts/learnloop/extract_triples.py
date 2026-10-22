#!/usr/bin/env python3
"""learning loop M1: extract (prompt, action, outcome-window) triples for ONE UTC day (read-only).

    nice -n 19 ionice -c3 python3 extract_triples.py --day 2026-10-20 --out ~/learnloop/days/2026-10-20
    (the nightly job, nightly.py, calls extract_day() directly)

Reads /var/log/mcai/<bot>/llm-<bot>.jsonl* (decisions) and skill-<bot>.jsonl* (outcomes) one bot at a time, so memory
stays at about one bot-day -- this runs on the FLEET host and must never compete with the bots. Writes ONE shard
<out>/triples-YYYYMMDD.jsonl.gz (bots in roster order, rows in time order; written to a temp name, then renamed) and
<out>/summary.json. Never trains, never serves, never touches an endpoint.

PRODUCTION CHANGES vs the 10-21 prototype (design docs/reports/learning-loop-design-2026-10-21.md s.1, both engines
APPROVE). The decision logic -- join, value, windows, labels -- is unchanged and is pinned by test_learnloop.py, and the
10-20 summary must reproduce docs/reports/learning-loop-1021/triples-summary-20261020.json:
  * one shard per day instead of one file per bot; each triple carries `label_rule` and `extractor`;
  * `dedupe.near`: the near-duplicate key (s.1.5) -- prompt with nonce, positions, coordinates, distances and the
    day clock normalised; the cap (k = 3 per bot x near-key x action) is applied by build_dataset.py, not here;
  * `rawhold`: a second log root holding copies of rotated generations (logs on .31 rotate after 14 days); a
    generation present in both is read once, from the live root;
  * summary.rows.llm_rows_raw: the day's decision lines counted by their timestamp PREFIX before any JSON parse --
    the independent row total the nightly positive control compares (parsed + unparseable must equal it);
  * the reader-reject counter is per call (it was a module global).

WHY NOT lib/telemetry.Events: Events.load() keeps only rows with skill.name, so it cannot read the decision stream
(memory: the-decision-stream-is-a-separate-file). This reader uses brainread.files_for's rotation rule and COUNTS
every unreadable file and unparseable line instead of skipping them silently.

A TRIPLE is one model decision (llm.latency_ms > 0) stamped in the day:
  state   = prompt.text (the user prompt as sent; the system prompt is carried by its hash and rebuilt per code version)
  action  = response.text (raw) + the parsed tool call; nonce_ok = the response's saw_end equals the prompt's nonce
  gate    = refused (outcome aborted, admission null -- brainread's definition) + reason, or the admission door
  own     = the EXECUTED skill row, joined by: same skill name, trigger llm:* / interrupt:*, start in
            [t - 1 s, t + latency + 30 s] (the runner stamps its start AFTER inference; the decision row stamps BEFORE
            it; -1 s absorbs millisecond stamp skew), not already used by an earlier decision. Quality: `exact` = status
            equal AND the first 120 chars of the detail equal (both come from the same result object), `ambiguous` =
            more than one exact candidate (the earliest is taken and flagged), `none`. Status-only candidates are
            counted and never used (round 3).
  value   = the bot's own evidence value (valuable/neutral/costly; the llm log drops it), parsed back from the next
            decision row's RECENT EVENTS line `<skill> -> <status> (<value>)`; next rows are read past midnight.
            Failures carry no value (recorded as 'none' = line found, no value).
  windows = for N in (120, 600) s after the decision start: items = positive inventory_delta of non-underscore skill
            rows that ENDED in the window (start + duration_ms), with the decision's own row counted separately
            (items_other excludes it -- the non-circular check); deaths/stagnation/milestones = event rows stamped in
            the window. observed = the bot has rows at or after the window end (else the window is CENSORED).
LABELS (rule L1, s.1.3): void = admitted but the runner refused to start (paused / busy): no evidence, never a negative;
  bad = refused, or executed failed/aborted, or a death or stagnation within 120 s; good = executed success AND (own
  value valuable OR own skill gained items OR a milestone within 120 s) AND no death within 600 s AND the 600 s window
  observed; neutral = everything else.
Per-bot totals (independent of the joins): items_all = brainread's items (positive inventory_delta of every skill row
started in the day), items_gathered = the same minus transfer and conversion skills, bot_h from decision rows.
"""
import argparse, bisect, collections, glob, gzip, hashlib, io, json, os, re, sys
from datetime import datetime, timedelta, timezone

EXTRACTOR_VERSION = 'x2-2026-10-22'
LABEL_RULE = 'L1'          # s.1.3 of the design; any change to label() below needs a new name

P = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
ROT = re.compile(r'-(\d{8})(?:\.gz)?$')
NONCE_P = re.compile(r'saw_end:\s*(END-[A-Z0-9]+)')
NONCE_R = re.compile(r'"saw_end"\s*:\s*"([^"]*)"')
NORM = re.compile(r'(saw_end:\s*)END-[A-Z0-9]+')
EVENT = re.compile(r'^\s*- (\w+) -> (\w+)(?: \((\w+)\))?:')
# NEAR-DUPLICATE KEY (s.1.5): strip positions and clock, keep everything else (inventory counts stay: they are state)
NEAR = [(re.compile(r'-?\d+,-?\d+,-?\d+'), '#,#,#'),
        (re.compile(r'\b([xyz])=-?\d+'), r'\1=#'),
        (re.compile(r'\bday \d+'), 'day #'),
        (re.compile(r'@\d+m\b'), '@#m'),
        (re.compile(r'\(\d+ blocks? away'), '(# blocks away'),
        (re.compile(r'\b\d+(\.\d+)? blocks\b'), '# blocks'),
        (re.compile(r'\bmoved \d+(\.\d+)?'), 'moved #')]
# NOT PRODUCTION (Claude r2): moves items between bag and chest (transfers) or turns items into other items
# (conversions: 1 log -> +4 planks counts as a positive delta). On 10-20 these were 3.6% of all positive gains (3,367 of 92,826);
# gather 48.0%, mine 32.3%, goto 12.3%, surface 2.8% carry the rest. Underscore event rows carry no inventory_delta.
TRANSFER = {'withdraw', 'withdraw_pick', 'toolkit', 'smelt_town', 'furnace_drain', 'town_deposit', 'deposit',
            'craft', 'smelt', 'compost', 'wear_out', 'dispose_well', 'count_town'}
RUNNER_REFUSED = ('paused after repeated failures', 'busy with ')


def near_key(system_hash, prompt):
    t = NORM.sub(r'\1END-X', prompt or '')
    for rx, rep in NEAR:
        t = rx.sub(rep, t)
    return hashlib.sha1((str(system_hash) + t).encode()).hexdigest()


def files_for(path, lo_day, hi_day, rawhold_path=None):
    """Live file + rotated generations that can hold [lo_day, hi_day]. A generation -YYYYMMDD is rotated ~00:00Z at the
    START of its suffix day, so it holds the day before; a row written just after a rotation lands one generation later,
    so keep suffixes in [lo_day, hi_day + 2 days] and let the timestamp filter decide (brainread.files_for's rule).
    Plain and .gz both. A generation missing from the live root is taken from rawhold_path (same basename)."""
    lo = lo_day.strftime('%Y%m%d'); hi = (hi_day + timedelta(days=2)).strftime('%Y%m%d')
    keep = [path] if os.path.exists(path) else []
    have = set()
    for f in glob.glob(path + '-*'):
        m = ROT.search(f)
        if m and lo <= m.group(1) <= hi:
            keep.append(f); have.add(m.group(1))
    if rawhold_path:
        for f in glob.glob(rawhold_path + '-*'):
            m = ROT.search(f)
            if m and lo <= m.group(1) <= hi and m.group(1) not in have:
                keep.append(f); have.add(m.group(1))
    return sorted(keep, key=lambda f: (ROT.search(f).group(1) if ROT.search(f) else '99999999', f))


def read_rows(path, t0, t1, bad, rawhold_path=None, count_lo=None, count_hi=None, raw_count=None):
    """Rows stamped in [t0, t1), sorted by time. With count_lo/count_hi, raw_count[0] += the lines whose timestamp
    PREFIX lies in [count_lo, count_hi), counted before any parse (the independent row total)."""
    out = []
    for f in files_for(path, P(t0 + 'Z'), P(t1 + 'Z'), rawhold_path):
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for line in fh:
                    if not line.startswith('{"@timestamp"'):
                        bad['line_without_timestamp_prefix'] += 1
                        continue
                    ts = line[15:34]
                    if count_lo is not None and count_lo <= ts < count_hi:
                        raw_count[0] += 1
                    if ts < t0 or ts >= t1:
                        continue
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        bad['unparseable_line'] += 1
        except (OSError, EOFError) as e:
            bad['unreadable_file'] += 1
            print('UNREADABLE', f, e, file=sys.stderr)
    out.sort(key=lambda r: r['@timestamp'])
    return out


def gain(delta):
    return sum(v for v in (delta or {}).values() if isinstance(v, (int, float)) and v > 0)


def label(refused, ost, detail, value, own_gain, w0, w1):
    """Rule L1 (design s.1.3). Pure: test_learnloop.py pins every branch."""
    if not refused and ost == 'failed' and (detail or '').startswith(RUNNER_REFUSED):
        return 'void'      # the runner refused to start: no evidence about the action (Claude r2); never a negative
    if refused or ost in ('failed', 'aborted') or w0['deaths'] or w0['stagnation']:
        return 'bad'
    if ost == 'success' and (value == 'valuable' or own_gain > 0 or w0['milestones']) and not w1['deaths'] and w1['observed']:
        return 'good'
    return 'neutral'


def roster_of(roster_dir, logbots):
    if os.path.isdir(roster_dir):     # '._x.env' = macOS AppleDouble copies
        return sorted(x[:-4] for x in os.listdir(roster_dir) if x.endswith('.env') and not x.startswith('.'))
    return logbots


def extract_day(day, logroot='/var/log/mcai', roster_dir='/srv/mcbots/harness/env', out=None, windows=(120, 600),
                rawhold=None, write=True):
    """-> summary dict. Writes <out>/triples-YYYYMMDD.jsonl.gz (+ summary.json) unless write=False."""
    day = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc) if isinstance(day, str) else day
    W = list(windows)
    f = lambda d: d.strftime('%Y-%m-%dT%H:%M:%S')
    t0, t1 = f(day), f(day + timedelta(days=1))
    look = f(day + timedelta(days=1, seconds=max(W) + 3600))          # lookahead: next prompts, long skills, windows
    back = f(day - timedelta(hours=2))                                  # skills that started before t and end after it
    BAD = collections.Counter()
    shard = tmp = None
    if write:
        os.makedirs(out, exist_ok=True)
        shard = os.path.join(out, 'triples-%s.jsonl.gz' % day.strftime('%Y%m%d'))
        tmp = shard + '.part'
    logbots = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob(logroot + '/*-*/'))
    roster = roster_of(roster_dir, logbots)
    S = collections.Counter(); C = collections.defaultdict(collections.Counter)
    seen_p, seen_pa, seen_near = set(), set(), set(); per_bot = {}; tmin = tmax = None
    events_day = collections.Counter()
    # DETERMINISTIC bytes (mtime 0, no name in the header): re-extracting a day from the same rows gives the same sha256
    fh = io.TextIOWrapper(gzip.GzipFile(filename='', mode='wb', fileobj=open(tmp, 'wb'), compresslevel=6, mtime=0),
                          encoding='utf-8') if write else None
    raw_llm = [0]

    for b in roster:
        if b not in logbots:
            S['roster_bots_without_log_dir'] += 1; continue
        rh = (lambda kind: os.path.join(rawhold, b, '%s-%s.jsonl' % (kind, b))) if rawhold else (lambda kind: None)
        Lall = read_rows('%s/%s/llm-%s.jsonl' % (logroot, b, b), t0, look, BAD, rh('llm'), t0, t1, raw_llm)
        K = read_rows('%s/%s/skill-%s.jsonl' % (logroot, b, b), back, look, BAD, rh('skill'))
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
            kn = near_key(ph, ptxt)
            S['dup_prompt'] += kp in seen_p; S['dup_prompt_action'] += kpa in seen_pa; S['dup_near'] += kn in seen_near
            seen_p.add(kp); seen_pa.add(kpa); seen_near.add(kn)
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
                # EXACT-ONLY (Claude r3): a status-only pick was shown false (the decision said "paused") and it consumed
                # the NEXT decision's row; such candidates are counted, never used.
                if exact:
                    own = exact[0]; used.add(own)
                    quality = 'ambiguous' if len(exact) > 1 else 'exact'
                elif stat:
                    quality = 'none'; C['status_only_rejected'][skill] += 1
                S['admitted'] += 1; C['join'][quality] += 1
                if quality == 'none':
                    C['join_miss_skill'][skill] += 1; C['join_miss_endpoint'][ep] += 1
                    dd = o.get('detail') or ''
                    why = 'paused (runner refused to start)' if dd.startswith('paused after repeated failures') else \
                          'busy (runner refused to start)' if dd.startswith('busy with ') else 'OTHER: ' + re.sub(r'[0-9,.-]+', '#', dd)[:60]
                    C['join_miss_why'][why] += 1
            elif not refused:
                S['admitted_without_skill'] += 1
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
            lab = label(refused, ost, o.get('detail'), value, gain(ownsk.get('inventory_delta')), win[str(W[0])], win[str(W[-1])])
            C['labels'][lab] += 1; C['label_x_skill'][(skill, lab)] += 1
            C['endpoint'][ep] += 1; C['model'][llm.get('model')] += 1
            cv = ((r.get('code') or {}).get('version') or '').split('+')[0][:8]
            C['version'][cv] += 1; C['system_hash'][ph] += 1
            C['hash_x_version'][(cv, ph)] += 1
            if fh:
                fh.write(json.dumps({
                    'id': kp[:16] + ':' + r['@timestamp'], 'ts': r['@timestamp'], 'bot': b, 'world': pb['world'],
                    'pool': (r.get('exp') or {}).get('pool'),
                    'code_version': cv,
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
                    'window': win, 'label': lab, 'label_rule': LABEL_RULE, 'extractor': EXTRACTOR_VERSION,
                    'dedupe': {'prompt': kp, 'prompt_action': kpa, 'near': kn}}) + '\n')
                S['triples_written'] += 1
        per_bot[b] = dict(pb)
    if fh:
        raw = fh.buffer.fileobj
        fh.close(); raw.close()
        os.replace(tmp, shard)

    lxs = collections.defaultdict(dict)
    for (sk, lab), n in C['label_x_skill'].items(): lxs[str(sk)][lab] = n
    hxv = collections.defaultdict(dict)
    for (cv, ph), n in C['hash_x_version'].items(): hxv[cv][str(ph)] = n
    summ = {'day': day.strftime('%Y-%m-%d'), 'extractor': EXTRACTOR_VERSION, 'label_rule': LABEL_RULE,
            'positive_control': {'roster': len(roster), 'bots_with_rows': S['bots'], 'first': tmin, 'last': tmax,
                                 'llm_rows': S['llm_rows'], 'skill_rows_in_day': S['skill_rows_in_day'],
                                 'event_rows_in_day': dict(events_day), 'reader_rejects': dict(BAD),
                                 'roster_bots_without_log_dir': S['roster_bots_without_log_dir'],
                                 'roster_bots_without_rows': S['roster_bots_without_rows']},
            'rows': {k: S[k] for k in ('model_rows', 'deterministic_rows', 'admitted', 'prompt_complete',
                                       'response_present', 'nonce_ok', 'schema_valid', 'dup_prompt', 'dup_prompt_action')},
            'rows_extra': {'llm_rows_raw': raw_llm[0], 'triples_written': S['triples_written'], 'dup_near': S['dup_near'],
                           'admitted_without_skill': S['admitted_without_skill']},
            'max_skill_duration_s': round(S['max_skill_duration_s']), 'join': dict(C['join']), 'status_only_rejected': dict(C['status_only_rejected']), 'join_miss_skill': dict(C['join_miss_skill'].most_common(12)),
            'join_miss_endpoint': dict(C['join_miss_endpoint']), 'join_miss_why': dict(C['join_miss_why'].most_common()), 'value': {str(k): v for k, v in C['value'].items()},
            'labels': dict(C['labels']), 'labels_by_skill': lxs,
            'actions': {str(k): v for k, v in C['actions'].most_common()}, 'refused_by_reason': dict(C['refused'].most_common()),
            'admitted_status': dict(C['admitted_status'].most_common()), 'endpoint': {str(k): v for k, v in C['endpoint'].items()},
            'model': dict(C['model']), 'code_version': dict(C['version']), 'system_hash': dict(C['system_hash']),
            'system_hash_by_version': hxv, 'shard': os.path.basename(shard) if shard else None,
            'per_bot': per_bot}
    if write:
        with open(os.path.join(out, 'summary.json'), 'w') as fo:
            json.dump(summ, fo, indent=1)
    return summ


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--day', required=True)
    ap.add_argument('--logroot', default='/var/log/mcai')
    ap.add_argument('--rawhold', default=None, help='a second root of rotated generations (same layout)')
    ap.add_argument('--roster', default='/srv/mcbots/harness/env')
    ap.add_argument('--out', required=True)
    ap.add_argument('--windows', default='120,600')
    ap.add_argument('--no-write', action='store_true')
    a = ap.parse_args()
    summ = extract_day(a.day, a.logroot, a.roster, a.out, [int(x) for x in a.windows.split(',')], a.rawhold,
                       write=not a.no_write)
    print(json.dumps({k: v for k, v in summ.items() if k not in ('per_bot', 'labels_by_skill')}, indent=1))


if __name__ == '__main__':
    main()
