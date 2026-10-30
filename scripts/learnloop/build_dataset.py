#!/usr/bin/env python3
"""learning loop: build an IMMUTABLE dataset version from the nightly shards (design s.1.5, s.2.1, s.2.4, s.3.4).

    nice -n 19 ionice -c3 python3 -B build_dataset.py --name v0 --days 2026-10-08..2026-10-21 \
        [--days-dir ~/learnloop/days] [--out ~/learnloop/datasets]

Reads only local shards (days/<D>/triples-*.jsonl.gz + sysprompts-*.json, each checked against its MANIFEST.json
sha256 first). Writes <out>/<name>/ and refuses if that directory already exists (versions are immutable):

  MANIFEST.json          days, label rule, extractor, code versions, the held-out draw (worlds + the secrets-drawn
                         seed), counts per split cell, every exclusion with its count, lineage, sha256 of every file
  sysprompts.json        {"<version>:<hash>": {template, schema, skills}} for every (version, hash) referenced
  train-good.jsonl.gz    STAGE 1 candidates (s.2.1): label good, TRAIN cell (training worlds x older days), fleet model
                         qwen2.5 only (v0 is the frozen anchor, s.3.4), complete prompt, nonce ok, schema valid, a skill
                         that still exists at the newest code version; exact duplicates (prompt + action) dropped,
                         earliest kept; near-duplicates capped at k = 3 per (bot, near-key, action)
  pairs-natural.jsonl.gz STAGE 3 natural pairs (s.2.3), mined BEFORE dedupe: same bot, same near-key, a good and a bad
                         decision with different actions
  heldout-A/B/C.jsonl.gz every model decision of the three evaluation cells (A = held-out worlds x old days, B = training
                         worlds x new days, C = held-out x new: the headline), all labels
  pilot-1000.jsonl       the teacher pilot's 1,000 HARD decisions (s.2.4): TRAIN cell, complete prompt, refused or
                         executed failed/aborted, void excluded; stratified by refusal reason / failure class x skill
  m3-train-2000.jsonl    the M3 dry-run subset: 2,000 train-good examples, skill-balanced (sqrt allocation), each
                         MATERIALISED (system text + user + assistant) for the trainer
  m3-eval.jsonl          the M3 offline evaluation set from cell C (materialised): good decisions (agreement),
                         non-transient failures (repeats-the-failed-action, infeasible), and the decision right AFTER a
                         repeat_loop veto (post-veto: does it repeat the vetoed action?)

HELD-OUT RULE (s.1.5): the unit is the WORLD (its bots share a board and a town). Three worlds are drawn ONCE per dataset
version with secrets.SystemRandom: one board/hive, one placebo, one isolated; the newest 2 days are held out for every
world. Teacher labels inherit their source decision's split. PAID-TEACHER QUARANTINE (s.2.4): any example whose
provenance is a paid vendor is refused unless --owner-decision names that vendor AND the use 'train' (v0 has none:
every example here is the fleet's own).
"""
import argparse, collections, datetime as dt, glob, gzip, hashlib, io, json, math, os, random, re, secrets, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FLEET_MODEL = 'qwen2.5:7b-instruct'
TRANSIENT = ('cooldown', 'busy', 'paused', 'timeout')
PAID_PREFIX = ('teacher-paid:',)
K_NEAR = 3


def world_family(w):
    return 'board/hive' if w.startswith(('board-', 'hive-')) else 'placebo' if w.startswith('placebo-') else \
        'isolated' if w.startswith('isolated-') else 'other'


def draw_heldout(worlds, rng=None):
    """One board/hive, one placebo, one isolated world (s.1.5). rng: secrets.SystemRandom() in production."""
    rng = rng or secrets.SystemRandom()
    out = []
    for fam in ('board/hive', 'placebo', 'isolated'):
        cand = sorted(w for w in worlds if world_family(w) == fam)
        if not cand:
            raise SystemExit('no %s world among %s' % (fam, sorted(worlds)))
        out.append(rng.choice(cand))
    return out


def cell_of(world, day, heldout, new_days):
    hw, nd = world in heldout, day in new_days
    return 'C' if hw and nd else 'A' if hw else 'B' if nd else 'TRAIN'


def milestone_family(m):
    m = re.sub(r'#\d+$', '', str(m or ''))
    return re.sub(r'_\d+$', '', m) or '-'


def failure_class(t):
    """Stratum for the pilot (s.2.4): the gate's refusal reason, or a coarse class of the executed failure."""
    if t['gate']['refused']:
        return 'refused:' + (t['gate']['reason'] or '?').split('(')[0].strip()
    d = (t['outcome']['detail'] or '').lower()
    for k, rx in (('unreachable', r'unreachable|no ?path|out of reach|cannot reach'), ('missing', r'missing|not enough|need|lack'),
                  ('timeout', r'timed? ?out|timeout'), ('blocked', r'blocked|lava|water|entomb|danger'),
                  ('not_found', r'not found|no .* (nearby|visible|in range)|none (found|seen)')):
        if re.search(rx, d):
            return '%s:%s' % (t['outcome']['status'], k)
    return '%s:other' % t['outcome']['status']


def is_transient(t):
    fc = failure_class(t)
    return any(x in fc for x in TRANSIENT) or t['label'] == 'void'


def action_key(t):
    return json.dumps([t['action']['skill'], t['action']['args']], sort_keys=True)


def nonce_of(prompt):
    m = re.search(r'saw_end:\s*(END-[A-Z0-9]+)', prompt[-60:])
    return m.group(1) if m else None


def paid_refusal(provenance, decision):
    """None if the example may enter a TRAINING set, else the reason. decision: {'vendors': {vendor: [uses]}}."""
    if not str(provenance).startswith(PAID_PREFIX):
        return None
    vendor = str(provenance).split(':', 2)[1] if ':' in str(provenance) else '?'
    uses = ((decision or {}).get('vendors') or {}).get(vendor) or []
    return None if 'train' in uses else 'paid vendor %s without a recorded owner decision for use=train' % vendor


def lineage_share(examples, lineage):
    n = len(examples)
    own = sum(1 for e in examples if e.get('provenance_model') in lineage)
    return (own / n) if n else 0.0


def sqrt_allocate(counts, total):
    """Quota per key proportional to sqrt(count), capped by availability; leftovers re-spread."""
    keys = [k for k in counts if counts[k] > 0]
    quota = {k: 0 for k in keys}
    left = total
    while left > 0 and keys:
        w = {k: math.sqrt(counts[k]) for k in keys}; s = sum(w.values())
        give = {k: max(1, int(left * w[k] / s)) for k in keys}
        progressed = False
        for k in sorted(keys, key=lambda k: -w[k]):
            g = min(give[k], counts[k] - quota[k], left)
            if g > 0:
                quota[k] += g; left -= g; progressed = True
            if left == 0:
                break
        keys = [k for k in keys if quota[k] < counts[k]]
        if not progressed:
            break
    return quota


def stratified(items_by_key, total, rng, floor=10):
    """Proportional allocation with a floor of min(available, floor) per stratum; deterministic given rng."""
    avail = {k: len(v) for k, v in items_by_key.items() if v}
    quota = {k: min(n, floor) for k, n in avail.items()}
    rest = total - sum(quota.values())
    if rest < 0:
        raise SystemExit('too many strata (%d) for %d items at floor %d' % (len(avail), total, floor))
    pool = {k: avail[k] - quota[k] for k in avail}
    tot = sum(pool.values()) or 1
    for k in sorted(pool, key=lambda k: -pool[k]):
        q = min(pool[k], int(round(rest * pool[k] / tot)))
        quota[k] += q
    diff = total - sum(quota.values())
    for k in sorted(avail, key=lambda k: -(avail[k] - quota[k])):
        if diff == 0:
            break
        step = 1 if diff > 0 else -1
        if (step > 0 and quota[k] < avail[k]) or (step < 0 and quota[k] > 0):
            quota[k] += step; diff -= step
    out = []
    for k in sorted(quota):
        v = sorted(items_by_key[k], key=lambda t: t['id'])
        out += rng.sample(v, quota[k])
    return out, quota


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def gz_writer(path):
    return io.TextIOWrapper(gzip.GzipFile(filename='', mode='wb', fileobj=open(path, 'wb'), mtime=0), encoding='utf-8')


def close_gz(fh):
    raw = fh.buffer.fileobj; fh.close(); raw.close()


def compact(t, cell):
    return {k: t[k] for k in ('id', 'ts', 'bot', 'world', 'pool', 'code_version', 'model', 'system_hash', 'trigger',
                              'milestone', 'prompt', 'response', 'action', 'gate', 'outcome', 'window', 'label',
                              'label_rule', 'prompt_complete', 'nonce_ok', 'schema_valid')} | {'cell': cell, 'day': t['ts'][:10]}


def materialise(t, sp, role='gatherer'):
    e = sp['%s:%s' % (t['code_version'], t['system_hash'])]
    system = e['template'].replace('<BOT>', t['bot']).replace('<ROLE>', role)
    return {'id': t['id'], 'bot': t['bot'], 'world': t['world'], 'day': t['ts'][:10], 'code_version': t['code_version'],
            'system_hash': t['system_hash'], 'system': system, 'user': t['prompt'], 'sentinel': nonce_of(t['prompt']),
            'schema': e['schema'], 'assistant': t['response'],
            'logged': {'skill': t['action']['skill'], 'args': t['action']['args'], 'label': t['label'],
                       'refused': t['gate']['refused'], 'reason': t['gate']['reason'], 'status': t['outcome']['status'],
                       'detail': t['outcome']['detail'], 'failure_class': failure_class(t)},
            'provenance': 'fleet:%s' % t['model']}


def day_range(s):
    a, b = s.split('..')
    d, e = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    out = []
    while d <= e:
        out.append(d.isoformat()); d += dt.timedelta(days=1)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', required=True)
    ap.add_argument('--days', required=True, help='YYYY-MM-DD..YYYY-MM-DD')
    ap.add_argument('--days-dir', default='~/learnloop/days')
    ap.add_argument('--out', default='~/learnloop/datasets')
    ap.add_argument('--new-days', type=int, default=2)
    ap.add_argument('--heldout', default=None, help='comma list: reuse a recorded draw instead of drawing')
    ap.add_argument('--owner-decision', default=None, help='JSON file {"vendors": {"anthropic": ["eval"]}}')
    ap.add_argument('--pilot-n', type=int, default=1000)
    ap.add_argument('--m3-train-n', type=int, default=2000)
    ap.add_argument('--m3-eval', default='good:200,fail:300,post_veto:100')
    a = ap.parse_args(argv)
    ddir = os.path.expanduser(a.days_dir); out = os.path.join(os.path.expanduser(a.out), a.name)
    if os.path.exists(out):
        raise SystemExit('REFUSED: %s exists -- dataset versions are immutable; pick a new --name' % out)
    days = day_range(a.days)
    new_days = set(days[-a.new_days:])
    decision = json.load(open(a.owner_decision)) if a.owner_decision else None
    # ---- inputs, each checked against the day's MANIFEST
    shards, sps, mans = {}, {}, {}
    for d in days:
        p = os.path.join(ddir, d)
        man = json.load(open(os.path.join(p, 'MANIFEST.json')))
        for n in ('triples-%s.jsonl.gz' % d.replace('-', ''), 'sysprompts-%s.json' % d.replace('-', '')):
            got = sha256_file(os.path.join(p, n))
            if got != man['files'][n]['sha256']:
                raise SystemExit('REFUSED: %s/%s sha256 %s differs from its MANIFEST %s' % (d, n, got, man['files'][n]['sha256']))
        shards[d] = os.path.join(p, 'triples-%s.jsonl.gz' % d.replace('-', ''))
        mans[d] = man
        for v, e in json.load(open(os.path.join(p, 'sysprompts-%s.json' % d.replace('-', '')))).items():
            for h, x in (e.get('hashes') or {}).items():
                sps['%s:%s' % (v, h)] = x
    worlds = set()
    # worlds and the newest code version come from a first light pass over the summaries
    for d in days:
        s = json.load(open(os.path.join(ddir, d, 'summary.json')))
        worlds |= {v['world'] for v in s['per_bot'].values()}
    # THE NEWEST CODE VERSION = the version of the latest decision row in the newest day (Claude r1 P3: the most
    # FREQUENT version of that day can be the one a promotion has just replaced). Read from the last shard's tail.
    newest_version, newest_ts = None, ''
    with gzip.open(shards[days[-1]], 'rt') as fh:
        for line in fh:
            t = json.loads(line)
            if t['ts'] > newest_ts:
                newest_ts, newest_version = t['ts'], t['code_version']
    cur_skills = set()
    for k, e in sps.items():
        if k.startswith(newest_version + ':'):
            cur_skills |= set(e.get('skills') or [])
    if not cur_skills:
        raise SystemExit('REFUSED: no rebuilt system prompt for the newest code version %s' % newest_version)
    if a.heldout:
        heldout = a.heldout.split(','); draw = {'method': 'reused (--heldout)', 'worlds': heldout}
    else:
        heldout = draw_heldout(worlds); draw = {'method': 'secrets.SystemRandom().choice per family', 'worlds': heldout}
    seed = secrets.randbits(63)
    rng = random.Random(seed)
    os.makedirs(out)
    C = collections.defaultdict(collections.Counter)
    seen_pa, near_n = set(), collections.Counter()
    pairs_idx = collections.defaultdict(dict)       # (bot, near) -> {(label, action): id}   (bounded per key)
    held = {c: gz_writer(os.path.join(out, 'heldout-%s.jsonl.gz' % c)) for c in 'ABC'}
    good = gz_writer(os.path.join(out, 'train-good.jsonl.gz'))
    # POOLS HOLD LIGHT REFERENCES (id + stratum); the chosen ids are materialised in a SECOND pass, so memory stays
    # at the size of the id sets, not of the prompts.
    pilot_pool = collections.defaultdict(list)
    eval_pool = {'good': collections.defaultdict(list), 'fail': collections.defaultdict(list), 'post_veto': []}
    m3_pool = collections.defaultdict(list)
    post_veto_logged = collections.Counter()      # the positive control: how often the FLEET repeated a vetoed action
    prev = {}                                      # bot -> its previous model decision in cell C (rows are bot-ordered)
    used_sp = set()
    train_pa, train_near = set(), set()             # LEAKAGE CONTROL (Claude r1 P3): keys of every TRAIN-cell decision
    held_keys = []                                   # (cell, prompt_action, near) of every held-out decision; compared
    leak = collections.Counter()                     # AFTER the pass, against the COMPLETE train sets (Codex r2 P3)
    for d in days:
        with gzip.open(shards[d], 'rt') as fh:
            for line in fh:
                t = json.loads(line)
                cell = cell_of(t['world'], d, heldout, new_days)
                C['cells'][cell] += 1; C['labels_by_cell']['%s:%s' % (cell, t['label'])] += 1
                C['models']['%s:%s' % (cell, t['model'])] += 1
                if cell != 'TRAIN':
                    held[cell].write(json.dumps(compact(t, cell)) + '\n')
                    held_keys.append((cell, t['dedupe']['prompt_action'], t['dedupe']['near']))
                    if cell == 'C':
                        usable = t['prompt_complete'] and t['nonce_ok'] and t['model'] == FLEET_MODEL \
                            and '%s:%s' % (t['code_version'], t['system_hash']) in sps
                        pv = prev.get(t['bot']); prev[t['bot']] = t if t['model'] == FLEET_MODEL else None
                        if usable and pv is not None and pv['gate']['refused'] and (pv['gate']['reason'] or '').startswith('repeat_loop'):
                            # POST-VETO (s.4a): the bot's next decision after a repeat_loop veto; does it repeat the vetoed action?
                            same = action_key(t) == action_key(pv)
                            post_veto_logged['decisions'] += 1; post_veto_logged['repeated'] += same
                            post_veto_logged['prompt_carries_rejection'] += ('repeat_loop' in t['prompt'] or 'identical action' in t['prompt'])
                            eval_pool['post_veto'].append({'id': t['id'], 'day': d, 'vetoed': json.loads(action_key(pv))})
                        elif usable and t['label'] == 'good':
                            eval_pool['good'][t['action']['skill']].append({'id': t['id'], 'day': d})
                        elif usable and t['label'] == 'bad' and not is_transient(t):
                            eval_pool['fail'][failure_class(t)].append({'id': t['id'], 'day': d})
                    continue
                # ---- TRAIN cell
                near = t['dedupe']['near']
                train_pa.add(t['dedupe']['prompt_action']); train_near.add(near)
                if t['label'] in ('good', 'bad') and t['prompt_complete']:
                    slot = pairs_idx[(t['bot'], near)]
                    if len(slot) < 8:
                        slot.setdefault((t['label'], action_key(t)), t['id'])
                if t['prompt_complete'] and t['label'] != 'void' and (t['gate']['refused'] or t['outcome']['status'] in ('failed', 'aborted')) \
                        and t['model'] == FLEET_MODEL and '%s:%s' % (t['code_version'], t['system_hash']) in sps:
                    pilot_pool[(failure_class(t), t['action']['skill'])].append({'id': t['id'], 'day': d})
                if t['label'] != 'good':
                    continue
                why = None
                if t['model'] != FLEET_MODEL: why = 'model %s (v0 is qwen2.5 only, s.3.4)' % t['model']
                elif not t['prompt_complete']: why = 'prompt incomplete'
                elif not t['nonce_ok']: why = 'nonce mismatch'
                elif not t['schema_valid']: why = 'schema invalid'
                elif t['action']['skill'] not in cur_skills: why = 'skill %s gone at %s' % (t['action']['skill'], newest_version)
                elif '%s:%s' % (t['code_version'], t['system_hash']) not in sps: why = 'system prompt not rebuilt'
                elif paid_refusal('fleet:%s' % t['model'], decision): why = 'paid quarantine'
                if why:
                    C['good_excluded'][why] += 1; continue
                kpa = t['dedupe']['prompt_action']
                if kpa in seen_pa:
                    C['good_excluded']['exact duplicate (prompt + action)'] += 1; continue
                seen_pa.add(kpa)
                nk = (t['bot'], near, action_key(t))
                if near_n[nk] >= K_NEAR:
                    C['good_excluded']['near-duplicate beyond k=%d' % K_NEAR] += 1; continue
                near_n[nk] += 1
                rec = compact(t, cell); rec['provenance'] = 'fleet:%s' % t['model']; rec['provenance_model'] = t['model']
                rec['stratum'] = '%s|%s' % (t['action']['skill'], milestone_family(t['milestone']))
                good.write(json.dumps(rec) + '\n')
                C['good_kept_by_skill'][t['action']['skill']] += 1; C['good_kept_by_stratum'][rec['stratum']] += 1
                C['good_kept_by_day'][d] += 1
                m3_pool[t['action']['skill']].append({'id': t['id'], 'day': d})
    for fh in list(held.values()) + [good]:
        close_gz(fh)
    for cell, kpa, kn in held_keys:
        leak['%s:decisions' % cell] += 1
        leak['%s:same prompt+action as a TRAIN decision' % cell] += kpa in train_pa
        leak['%s:same near-key as a TRAIN decision' % cell] += kn in train_near
    del held_keys, train_pa, train_near
    del seen_pa, near_n
    # ---- natural pairs
    np_ = 0
    pf = gz_writer(os.path.join(out, 'pairs-natural.jsonl.gz'))
    for (bot, near), slot in pairs_idx.items():
        g = [(ak, i) for (lab, ak), i in slot.items() if lab == 'good']
        b = [(ak, i) for (lab, ak), i in slot.items() if lab == 'bad']
        for ga, gi in g:
            for ba, bi in b:
                if ga != ba:
                    pf.write(json.dumps({'chosen': gi, 'rejected': bi, 'bot': bot, 'near': near}) + '\n'); np_ += 1
    close_gz(pf)
    del pairs_idx
    # ---- selections (recorded seed)
    pilot, pq = stratified(pilot_pool, a.pilot_n, rng)
    q = sqrt_allocate({k: len(v) for k, v in m3_pool.items()}, a.m3_train_n)
    m3 = []
    for k in sorted(q):
        m3 += rng.sample(sorted(m3_pool[k], key=lambda r: r['id']), q[k])
    want = dict(x.split(':') for x in a.m3_eval.split(','))
    eg, _ = stratified(eval_pool['good'], int(want['good']), rng, floor=5)
    ef, _ = stratified(eval_pool['fail'], int(want['fail']), rng, floor=5)
    epv = rng.sample(sorted(eval_pool['post_veto'], key=lambda r: r['id']), min(int(want['post_veto']), len(eval_pool['post_veto'])))
    sel = {}
    for kind, L in (('pilot', pilot), ('m3_train', m3), ('good', eg), ('fail', ef), ('post_veto', epv)):
        for r in L:
            sel.setdefault(r['id'], []).append((kind, r))
    # ---- second pass: materialise only the chosen ids
    outs = {'pilot': open(os.path.join(out, 'pilot-%d.jsonl' % a.pilot_n), 'w'),
            'm3_train': open(os.path.join(out, 'm3-train-%d.jsonl' % a.m3_train_n), 'w'),
            'eval': open(os.path.join(out, 'm3-eval.jsonl'), 'w')}
    got = collections.Counter()
    wanted_days = sorted({r['day'] for v in sel.values() for _, r in v})
    for d in wanted_days:
        with gzip.open(shards[d], 'rt') as fh:
            for line in fh:
                i = line[8:8 + 60].split('"', 1)[0] if line.startswith('{"id": "') else None
                if i not in sel:
                    continue
                t = json.loads(line)
                for kind, r in sel[t['id']]:
                    m = materialise(t, sps)
                    used_sp.add('%s:%s' % (t['code_version'], t['system_hash']))
                    m['prompt_tokens'] = t.get('prompt_tokens')
                    if kind in ('good', 'fail', 'post_veto'):
                        m['eval_kind'] = kind
                        if kind == 'post_veto':
                            m['vetoed'] = r['vetoed']
                        outs['eval'].write(json.dumps(m) + '\n')
                    else:
                        outs[kind].write(json.dumps(m) + '\n')
                    got[kind] += 1
    for fh in outs.values():
        fh.close()
    want_n = collections.Counter(k for v in sel.values() for k, _ in v)
    if got != want_n:
        raise SystemExit('REFUSED: materialised %s, selected %s -- an id was not found again in its shard' % (dict(got), dict(want_n)))
    with open(os.path.join(out, 'sysprompts.json'), 'w') as fh:
        json.dump({k: sps[k] for k in sorted(sps)}, fh)
    kept = sum(C['good_kept_by_skill'].values())
    man = {'name': a.name, 'made_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'days': days, 'new_days': sorted(new_days), 'heldout': draw, 'split_seed': seed,
           'label_rule': sorted({mans[d]['label_rule'] for d in days}), 'extractor': sorted({mans[d]['extractor'] for d in days}),
           'source_manifests': {d: hashlib.sha256(json.dumps(mans[d], sort_keys=True).encode()).hexdigest() for d in days},
           'code_versions': dict(sum((collections.Counter(mans[d]['code_versions']) for d in days), collections.Counter())),
           'newest_code_version': newest_version, 'current_skills': sorted(cur_skills),
           'cells': dict(C['cells']), 'labels_by_cell': dict(C['labels_by_cell']), 'models_by_cell': dict(C['models']),
           'train_good': {'kept': kept, 'excluded': dict(C['good_excluded']), 'by_skill': dict(C['good_kept_by_skill']),
                          'by_day': dict(C['good_kept_by_day']), 'strata': len(C['good_kept_by_stratum']),
                          'top_strata': dict(C['good_kept_by_stratum'].most_common(15)), 'near_k': K_NEAR},
           'lineage': {'provenance': {'fleet:%s' % FLEET_MODEL: kept}, 'rule': '<= 50% from the model being trained or '
                       'its fine-tuned ancestors; for the Qwen3-8B arm this is 0% (qwen2.5 is not its lineage)'},
           'paid_quarantine': 'refused without --owner-decision naming vendor + use=train; v0 has no paid example',
           'leakage': dict(leak), 'role_note': "system prompts are rebuilt with <ROLE> = gatherer: all 80 fleet env files say BOT_ROLE=gatherer (read 10-22)",
           'pairs_natural': np_, 'pilot': {'n': len(pilot), 'strata': len(pq), 'pool': sum(len(v) for v in pilot_pool.values()),
                                           'quota': {'%s|%s' % k: v for k, v in sorted(pq.items())}},
           'm3_train': {'n': len(m3), 'quota': q}, 'm3_eval': {'good': len(eg), 'fail': len(ef), 'post_veto': len(epv),
                                                             'pools': {'good': sum(len(v) for v in eval_pool['good'].values()),
                                                                       'fail': sum(len(v) for v in eval_pool['fail'].values()),
                                                                       'post_veto': len(eval_pool['post_veto'])},
                                                             'post_veto_logged_positive_control': dict(post_veto_logged)}}
    man['files'] = {n: {'sha256': sha256_file(os.path.join(out, n)), 'bytes': os.path.getsize(os.path.join(out, n))}
                    for n in sorted(os.listdir(out))}
    with open(os.path.join(out, 'MANIFEST.json'), 'w') as fh:
        json.dump(man, fh, indent=1)
    print(json.dumps({k: man[k] for k in ('name', 'heldout', 'cells', 'train_good', 'pairs_natural', 'pilot', 'm3_train', 'm3_eval')}, indent=1)[:6000])


if __name__ == '__main__':
    sys.exit(main())
