#!/usr/bin/env python3
"""cc_clear3.py -- the executor for the ONE-TIME stock-target chest clear (owner 10-10/10-12; stocktarget-01 KEPT 10-13).
Runs on the worlds host 10.0.0.30 as root (RCON passwords are read from each world's server.properties and never leave
the host). DRY RUN BY DEFAULT: without --execute nothing but read-only commands is ever sent.

  cc_clear3.py check    <census> <plan>                 offline: the plan matches the census slot for slot; prints every
                                                        command class it would send; refuses on any inconsistency
  cc_clear3.py validate <census> <plan>                 READ-ONLY RCON: nobody online; EVERY planned predicate passes
                                                        with the census count; negative controls must all fail
  cc_clear3.py trial    <census> <plan> <trial.json> [--execute]   one remove + one reduce, then read the containers back
  cc_clear3.py run      <census> <plan> <trial.json> <result.json> [--execute]   every other action, worlds in parallel
  cc_clear3.py verify   <census-before> <plan> <census-after> [<result.json> <trial.json>]   offline: kept slots
                                                        unchanged, removed slots empty, reduced slots at exactly `keep`, no
                                                        new slot anywhere; with a result + trial (an ABORTED run; result `-`
                                                        when only the trial ran): only the actions they list as done may
                                                        have changed anything

ONE ACTION = ONE COMMAND, ATOMIC IN ITS TICK. The test and the edit name the same block and slot (enforced by the
grammar's back-references):
  remove: execute if items block X Y Z container.S <pred> run item replace block X Y Z container.S with minecraft:air
  reduce: execute if items block X Y Z container.S <pred> run item modify block X Y Z container.S
              {function:"minecraft:set_count",count:K}                                         (K < census count)
  <pred> = minecraft:ID[count=N]                    the exact census count (sandbox 10-13: [count=63] fails on 64)
         + ,minecraft:damage~{damage:D,durability:{max:10}}   a spent tool: its exact damage AND the spent bound
         + ,minecraft:damage~{damage:D,durability:{min:11}}   a usable tool: its exact damage AND the usable bound
If anything about the slot changed since the census the test fails, nothing is edited, and the run ABORTS everywhere
(the bots are stopped, so a change is a fault, not a race). Abbreviated elements, incomplete containers and
iron/diamond/netherite tools are never in a plan (plan3.py pins them); `check` refuses a plan that names one.
"""
import hashlib, json, os, re, sys, threading, time
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rcon3, census3

N = r'-?\d{1,6}'
PRED = r'minecraft:[a-z0-9_]{1,64}\[count=\d{1,2}(,minecraft:damage~\{damage:\d{1,4},durability:\{(max:10|min:11)\}\})?\]'
POS = r'(?P<x>%s) (?P<y>%s) (?P<z>%s) container\.(?P<s>\d{1,2})' % (N, N, N)
SAME = r'(?P=x) (?P=y) (?P=z) container\.(?P=s)'
TEST = r'execute if items block %s %s' % (POS, PRED)
GRAMMAR = re.compile(r'^(list|data get block %s %s %s (id|Items\[\d{1,2}\])|%s( run (item replace block %s with minecraft:air'
                     r'|item modify block %s \{function:"minecraft:set_count",count:\d{1,2}\}))?)$'
                     % (N, N, N, TEST, SAME, SAME))
EDITS = re.compile(r' run item (replace|modify) ')
TOOLS = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')
EXECUTE = '--execute' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]


def key(w, pos, slot): return (w, tuple(pos), int(slot))


def index(census):
    ix = {}
    for w, v in census['worlds'].items():
        for c in v['containers']:
            for it in c['items']:
                ix[key(w, c['pos'], it['slot'])] = (c, it)
    return ix


def pred(a, count=None, ident=None):
    p = 'minecraft:%s[count=%d' % (ident or a['id'], a['count'] if count is None else count)
    if a['why'] == 'spent_tool': p += ',minecraft:damage~{damage:%d,durability:{max:10}}' % a['damage']
    elif a['why'] == 'surplus_tool': p += ',minecraft:damage~{damage:%d,durability:{min:11}}' % a['damage']
    return p + ']'


def test_cmd(a, **kw):
    x, y, z = a['pos']
    return 'execute if items block %d %d %d container.%d %s' % (x, y, z, a['slot'], pred(a, **kw))


def act_cmd(a):
    x, y, z = a['pos']; t = test_cmd(a)
    if a['why'] == 'reduce':
        return t + ' run item modify block %d %d %d container.%d {function:"minecraft:set_count",count:%d}' % (x, y, z, a['slot'], a['keep'])
    return t + ' run item replace block %d %d %d container.%d with minecraft:air' % (x, y, z, a['slot'])


def load(): return json.load(open(ARGS[1])), json.load(open(ARGS[2]))


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def census_ok(census, label):
    """A census with any error or incomplete read cannot certify anything (Codex r1 3)."""
    bad = []
    for w, v in census['worlds'].items():
        if v.get('error') or v.get('incomplete'):
            bad.append('%s census world %s: error %s incomplete %s' % (label, w, v.get('error'), (v.get('incomplete') or [])[:3]))
        for c in v.get('containers', []):
            sl = [i['slot'] for i in c['items']]
            if c.get('incomplete') or len(sl) != len(set(sl)):
                bad.append('%s census %s %s: incomplete or duplicate Slot' % (label, w, c['pos']))
    return bad


NORM = lambda raw: re.sub(r'\bcount: \d+', 'count: N', raw or '')


def check(census, plan, quiet=False):
    """Offline consistency. Returns a list of problems (empty = OK)."""
    bad = census_ok(census, 'the'); ix = index(census); seen = set()
    for a in plan:
        k = key(a['world'], a['pos'], a['slot'])
        if k in seen: bad.append('duplicate action %s' % (k,)); continue
        seen.add(k)
        if k not in ix: bad.append('no such slot in the census %s' % (k,)); continue
        c, it = ix[k]
        if (it['id'], it['count']) != (a['id'], a['count']): bad.append('plan/census differ %s: %s' % (k, (it['id'], it['count'], a['id'], a['count'])))
        if it.get('abbreviated') or c.get('incomplete') or not it.get('raw'): bad.append('abbreviated/incomplete targeted %s' % (k,))
        # the predicate tests id, count and (tools) damage only, so a planned item may carry NO other component:
        # a named, enchanted or otherwise special stack is never in a plan (Codex r1 4)
        if set(it.get('components') or []) - {'damage'}: bad.append('planned item carries components %s %s' % (it['components'], k))
        if a['why'] not in ('reduce', 'surplus', 'spent_tool', 'surplus_tool', 'junk'): bad.append('unknown why %s' % a['why'])
        if a['why'] == 'reduce' and not (0 < a['keep'] < a['count']): bad.append('reduce keep out of range %s' % (k,))
        if a['why'] in ('spent_tool', 'surplus_tool'):
            if not a['id'].endswith(TOOLS) or a['id'].split('_')[0] not in ('wooden', 'stone', 'golden') or it['damage'] is None:
                bad.append('tool action outside wooden/stone/golden or unknown damage %s' % (k,))
            if a['damage'] != it['damage']: bad.append('damage differs %s' % (k,))
        elif a['id'].endswith(TOOLS): bad.append('a tool planned as bulk %s' % (k,))
        for cmd in (test_cmd(a), act_cmd(a)):
            if not GRAMMAR.match(cmd): bad.append('command outside the grammar: %s' % cmd)
    if not quiet:
        print('plan actions %d (%s) over %d worlds; census %s; problems %d' % (
            len(plan), dict(Counter(a['why'] for a in plan)), len({a['world'] for a in plan}), census['started_utc'], len(bad)))
        for b in bad[:20]: print('  PROBLEM', b)
        if plan: print('  e.g.', act_cmd(plan[0]))
    return bad


FLEET = re.compile(r'\b(board|hive|placebo|isolated)-[a-d]-[A-Za-z]+\b')


def nobody_online(r):
    rep = r.cmd('list')
    return rep.startswith('There are 0 of a max'), rep


def validate(census, plan):
    """READ-ONLY. Every planned predicate must pass with the census count; every negative control must fail."""
    if check(census, plan, quiet=True): print('check failed; run `check` first'); return 1
    res = Counter(); bad = []
    byw = {}
    for a in plan: byw.setdefault(a['world'], []).append(a)
    ix = index(census)
    for w in sorted(census['worlds']):
        r = rcon3.Rcon(w, GRAMMAR)
        ok, rep = nobody_online(r)
        res['world_nobody_online' if ok else 'world_SOMEONE_ONLINE'] += 1
        if not ok: bad.append((w, 'online', rep[:100]))
        acts = byw.get(w, [])
        for a in acts:                                          # POSITIVE: every planned slot, exact count
            rep = r.cmd(test_cmd(a))
            if rep == 'Test passed, count: %d' % a['count']: res['planned_pass'] += 1
            else: res['planned_FAIL'] += 1; bad.append((w, a['pos'], a['slot'], a['id'], rep[:80]))
        for a in acts[::max(1, len(acts) // 8)][:8]:            # NEGATIVE: wrong count, wrong id
            for kw, lab in (({'count': a['count'] + 1 if a['count'] < 99 else a['count'] - 1}, 'wrong_count'), ({'ident': 'barrier'}, 'wrong_id')):
                rep = r.cmd(test_cmd(a, **kw))
                if rep == 'Test failed': res['neg_%s_fail(ok)' % lab] += 1
                else: res['neg_%s_PASSED' % lab] += 1; bad.append((w, a['pos'], a['slot'], lab, rep[:80]))
        planned = {key(w, a['pos'], a['slot']) for a in acts}
        kept_tools = [(c, it) for (ww, _, _), (c, it) in ix.items() if ww == w and key(w, c['pos'], it['slot']) not in planned
                      and it['id'].endswith(TOOLS) and it['id'].split('_')[0] in ('wooden', 'stone') and it['damage'] is not None][:4]
        for c, it in kept_tools:                                # NEGATIVE: a kept usable tool fails the SPENT predicate
            fake = {'id': it['id'], 'count': it['count'], 'pos': c['pos'], 'slot': it['slot'], 'damage': it['damage'], 'why': 'spent_tool'}
            rep = r.cmd(test_cmd(fake))
            if rep == 'Test failed': res['neg_kept_tool_spentpred_fail(ok)'] += 1
            else: res['neg_kept_tool_spentpred_PASSED'] += 1; bad.append((w, c['pos'], it['slot'], 'kept tool passed spent pred', rep[:80]))
            fake['why'] = 'surplus_tool'                        # ...and passes the USABLE one (the polarity is right)
            rep = r.cmd(test_cmd(fake))
            if rep == 'Test passed, count: 1': res['pos_kept_tool_usablepred_pass(ok)'] += 1
            else: res['pos_kept_tool_usablepred_FAIL'] += 1; bad.append((w, c['pos'], it['slot'], 'kept tool failed usable pred', rep[:80]))
        r.close()
    print(dict(sorted(res.items())))
    for b in bad[:20]: print('  BAD', b)
    print('VALIDATE', 'PASS' if not bad else 'FAIL (%d)' % len(bad))
    return 0 if not bad else 1


def readback(r, a):
    items, prob = census3.read_container(r, *a['pos'])
    if prob: return None, prob
    return {i['slot']: i for i in items}, None


def trial_picks(plan):
    picks = []
    for want_reduce in (True, False):
        cand = [a for a in plan if (a['why'] == 'reduce') == want_reduce]
        if cand: picks.append(sorted(cand, key=lambda a: (a['world'], a['pos'], a['slot']))[0])
    return picks


def expected_after(before, a):
    exp = {k: dict(v) for k, v in (before or {}).items()}
    if a['why'] == 'reduce': exp[a['slot']] = dict(exp[a['slot']], count=a['keep'], raw=re.sub(r'\bcount: \d+', 'count: %d' % a['keep'], exp[a['slot']]['raw']))
    else: exp.pop(a['slot'], None)
    return exp


def trial(census, plan):
    """One reduce and one remove. The receipt is BOUND to this census and plan (sha256) and written after every step;
    a failed read before the edit sends nothing, and the first failure stops the trial (Codex r1 6, 7)."""
    if check(census, plan, quiet=True): print('check failed'); return 1
    picks = trial_picks(plan)
    rec = {'at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'executed': EXECUTE,
           'census_sha256': sha(ARGS[1]), 'plan_sha256': sha(ARGS[2]), 'expected_cmds': [act_cmd(a) for a in picks], 'actions': []}
    save = lambda: json.dump(rec, open(ARGS[3], 'w'), indent=1) if EXECUTE else None
    if not EXECUTE:
        for a in picks: print('DRY RUN would send to %s: %s' % (a['world'], act_cmd(a)))
        print('TRIAL (dry run: nothing sent)'); return 0
    save()
    for a in picks:
        step = {'world': a['world'], 'pos': a['pos'], 'slot': a['slot'], 'why': a['why'], 'cmd': act_cmd(a), 'state': 'started', 'readback_ok': False}
        rec['actions'].append(step); save()
        try:
            r = rcon3.Rcon(a['world'], GRAMMAR)
            online, lrep = nobody_online(r)
            if not online: step['state'] = 'refused: online %s' % lrep[:80]; save(); print('REFUSED', step['state']); return 1
            before, p1 = readback(r, a)
            if p1 or a['slot'] not in (before or {}) or before[a['slot']].get('raw') != index(census)[key(a['world'], a['pos'], a['slot'])][1].get('raw'):
                step['state'] = 'refused: pre-read differs from the census %s' % (p1 or (before or {}).get(a['slot'])); save()
                print('REFUSED', step['state']); return 1
            step['state'] = 'sent'; save()
            rep = r.cmd(step['cmd']); step['reply'] = rep; save()
            after, p2 = readback(r, a); r.close()
        except Exception as e:
            step['state'] += ' / exception %s: %s' % (type(e).__name__, e); save(); print('TRIAL FAIL', step['state']); return 1
        good = rep.startswith('Replaced a slot at') and not p2 and after == expected_after(before, a)
        step['readback_ok'] = good; step['state'] = 'done'; save()
        print('TRIAL %s %s %s slot %d %s -> %r readback %s' % (a['world'], a['why'], a['pos'], a['slot'], a['id'], rep, 'OK' if good else 'MISMATCH'))
        if not good: print('TRIAL FAIL'); return 1
    print('TRIAL PASS'); return 0


ABORT = threading.Event()
SAVE_LOCK = threading.Lock()
SAVE = [None]          # run() sets it: writes the result file (Claude r2 S1: after every container and at the end)


def run_world(w, acts, out, ix):
    """Container by container: ONE read of the container first -- every planned slot must still be, element for
    element (full text, so a name or enchantment added since the census shows), what the census saw; any difference
    aborts the run before that container is edited (Codex r2: the predicate cannot see components other than damage;
    with the bots stopped and nobody online the read-then-edit interval is quiescent). Then one atomic command per slot.
    Every action that landed is listed in `done_keys`, so a partial run can be verified (Claude r1 6)."""
    rec = {'done': Counter(), 'items': Counter(), 'failed': [], 'other': [], 'sent': 0, 'done_keys': []}
    out[w] = rec
    try:
        r = rcon3.Rcon(w, GRAMMAR)
        online, lrep = nobody_online(r)
        if not online: rec['other'].append('someone online: ' + lrep[:100]); rec['aborted'] = 'someone online'; ABORT.set(); return
        bycont = {}
        for a in acts: bycont.setdefault(tuple(a['pos']), []).append(a)
        for pos, cacts in bycont.items():
            if ABORT.is_set(): rec['aborted'] = rec.get('aborted') or 'abort flag (another world failed)'; break
            live, prob = census3.read_container(r, *pos)
            livemap = {i['slot']: i for i in live}
            diff = [a['slot'] for a in cacts if prob or a['slot'] not in livemap
                    or livemap[a['slot']].get('raw') != ix[key(w, pos, a['slot'])][1].get('raw')]
            if diff:
                rec['failed'].append([list(pos), diff[:5], 'pre-read differs from the census' + (' (%s)' % prob if prob else '')])
                rec['aborted'] = 'pre-read differs'; ABORT.set(); break
            for a in cacts:
                if ABORT.is_set(): rec['aborted'] = rec.get('aborted') or 'abort flag (another world failed)'; break
                rep = r.cmd(act_cmd(a)); rec['sent'] += 1
                if rep.startswith('Replaced a slot at'):
                    rec['done'][a['why']] += 1; rec['done_keys'].append([list(a['pos']), a['slot']])
                    rec['items'][a['why']] += a['count'] - a.get('keep', 0) if a['why'] == 'reduce' else a['count']
                elif rep == '':                                 # the test failed: the slot changed since the census
                    rec['failed'].append([a['pos'], a['slot'], a['id'], a['count']]); rec['aborted'] = 'own predicate failed'
                    ABORT.set(); break
                else:
                    rec['other'].append([a['pos'], a['slot'], rep[:120]]); rec['aborted'] = 'own unexpected reply'; ABORT.set(); break
                lat = r.lat[-20:]
                if lat and sum(lat) / len(lat) > 0.5: rec['aborted'] = 'mean latency > 0.5 s'; ABORT.set(); break
            if SAVE[0]: SAVE[0]()
        r.close()
    except Exception as e:
        rec['other'].append('%s: %s' % (type(e).__name__, e)); rec['aborted'] = 'exception'; ABORT.set()


def run(census, plan):
    if check(census, plan, quiet=True): print('check failed'); return 1
    tr = json.load(open(ARGS[3])); picks = trial_picks(plan)
    if (not tr.get('executed') or tr.get('census_sha256') != sha(ARGS[1]) or tr.get('plan_sha256') != sha(ARGS[2])
            or [t['cmd'] for t in tr['actions']] != [act_cmd(a) for a in picks] or not all(t['readback_ok'] for t in tr['actions'])):
        print('REFUSED: the trial receipt does not belong to this census + plan, or did not pass'); return 1
    # ...and its postconditions still hold now (read-only), before those slots are skipped
    for a in picks:
        r = rcon3.Rcon(a['world'], GRAMMAR); now, p = readback(r, a); r.close()
        got = (now or {}).get(a['slot'])
        ok = not p and ((got is None) if a['why'] != 'reduce' else (got is not None and got['id'] == a['id'] and got['count'] == a['keep']))
        if not ok: print('REFUSED: trial slot %s %s %d no longer as the trial left it: %s' % (a['world'], a['pos'], a['slot'], got)); return 1
    done = {key(a['world'], a['pos'], a['slot']) for a in picks}
    byw = {}
    for a in plan:
        if key(a['world'], a['pos'], a['slot']) not in done: byw.setdefault(a['world'], []).append(a)
    if not EXECUTE:
        for w, acts in sorted(byw.items()): print('DRY RUN %-11s would send %4d commands, e.g. %s' % (w, len(acts), act_cmd(acts[0])))
        print('DRY RUN: nothing sent (%d commands; the trial covered %d)' % (sum(map(len, byw.values())), len(done))); return 0
    out = {}; t0 = time.time()
    ix = index(census)

    def snapshot(final=False):
        with SAVE_LOCK:
            res = {'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t0)), 'wall_s': round(time.time() - t0, 1),
                   'census_started_utc': census['started_utc'], 'aborted': ABORT.is_set(), 'final': final,
                   'worlds': {w: {k: (dict(v) if isinstance(v, Counter) else list(v) if isinstance(v, list) else v)
                                  for k, v in list(rec.items())} for w, rec in sorted(list(out.items()))}}
            tmp = ARGS[4] + '.tmp'
            json.dump(res, open(tmp, 'w'), indent=1); os.replace(tmp, ARGS[4])
            return res
    SAVE[0] = snapshot
    snapshot()                                                  # the file exists before the first edit
    th = [threading.Thread(target=run_world, args=(w, acts, out, ix)) for w, acts in sorted(byw.items())]
    try:
        for t in th: t.start()
        for t in th:
            while t.is_alive(): t.join(0.5)                     # a timed join, so Ctrl-C is seen while workers run
    except BaseException:
        # Ctrl-C / SIGTERM while waiting (Codex r4 1, Claude r3 6): stop every world, wait for the workers to finish
        # their current command, THEN publish the final snapshot
        ABORT.set()
        for t in th:
            if t.is_alive(): t.join()
        raise
    finally:
        res = snapshot(final=True)
    for w, rec in res['worlds'].items():
        print('%-11s sent %4d done %s failed %d other %s %s' % (w, rec['sent'], rec['done'], len(rec['failed']), rec['other'][:2], rec.get('aborted', '')))
    tot = Counter()
    for rec in res['worlds'].values(): tot.update(rec['items'])
    print('RUN', 'ABORTED' if res['aborted'] else 'COMPLETE', 'items', dict(tot), 'wall', res['wall_s'], 's')
    return 1 if res['aborted'] else 0


def verify(before, plan, after, result=None):
    """With a run result (an ABORTED run), only the actions it lists as done must have happened; every other planned
    slot must be unchanged, exactly like a kept one (Claude r1 6). The trial receipt's two actions count as done."""
    if result is not None:
        done = {key(w, p, s) for w, rec in ((result['run'] or {}).get('worlds') or {}).items() for p, s in rec.get('done_keys', [])}
        done |= {key(t['world'], t['pos'], t['slot']) for t in result['trial']['actions'] if t.get('readback_ok')}
        plan = [a for a in plan if key(a['world'], a['pos'], a['slot']) in done]
    bad = census_ok(before, 'before') + census_ok(after, 'after')
    if set(before['worlds']) != set(after['worlds']): bad.append('world sets differ: %s vs %s' % (sorted(before['worlds']), sorted(after['worlds'])))
    ib = index(before); ia = index(after); acts = {key(a['world'], a['pos'], a['slot']): a for a in plan}
    for w in before['worlds']:
        cb = {tuple(c['pos']) for c in before['worlds'][w]['containers']}
        ca = {tuple(c['pos']) for c in after['worlds'].get(w, {}).get('containers', [])}
        if cb != ca: bad.append('%s containers differ: lost %s new %s' % (w, sorted(cb - ca)[:3], sorted(ca - cb)[:3]))
    strip = lambda it: {k: it[k] for k in ('id', 'count', 'damage', 'max_damage', 'components', 'abbreviated', 'raw') if k in it}
    res = Counter()
    for k, (c, it) in ib.items():
        a = acts.get(k); got = ia.get(k)
        if a is None:
            if got is None or strip(got[1]) != strip(it): bad.append('KEPT slot changed %s: %s -> %s' % (k, strip(it), got and strip(got[1])))
            else: res['kept_unchanged'] += 1
        elif a['why'] == 'reduce':
            if (got is None or got[1]['id'] != it['id'] or got[1]['count'] != a['keep']
                    or NORM(got[1].get('raw')) != NORM(it.get('raw')) or got[1].get('abbreviated')):
                bad.append('reduce wrong %s: %s' % (k, got and strip(got[1])))
            else: res['reduced_exact'] += 1
        else:
            if got is not None: bad.append('removed slot still holds %s: %s' % (k, strip(got[1])))
            else: res['removed_empty'] += 1
    for k in ia:
        if k not in ib: bad.append('NEW slot after the clear %s: %s' % (k, strip(ia[k][1])))
    res['kept_abbreviated_partially_verified'] = sum(1 for k, (c, it) in ib.items() if k not in acts and it.get('abbreviated'))
    print(dict(res), 'problems', len(bad))
    for b in bad[:20]: print('  BAD', b)
    print('VERIFY', 'PASS' if not bad else 'FAIL')
    return 0 if not bad else 1


if __name__ == '__main__':
    mode = ARGS[0] if ARGS else ''
    if mode == 'check': c, p = load(); sys.exit(1 if check(c, p) else 0)
    if mode == 'validate': sys.exit(validate(*load()))
    if mode == 'trial': sys.exit(trial(*load()))
    if mode == 'run': sys.exit(run(*load()))
    if mode == 'verify':
        # result '-' = the run never started (a trial-only STOP-B): only the trial's actions may have changed anything
        res = {'run': None if ARGS[4] == '-' else json.load(open(ARGS[4])), 'trial': json.load(open(ARGS[5]))} if len(ARGS) > 5 else None
        sys.exit(verify(json.load(open(ARGS[1])), json.load(open(ARGS[2])), json.load(open(ARGS[3])), res))
    print(__doc__); sys.exit(2)
