# verdict.py <run_id> <window_min> [--dryrun] -- the canary loop's decision (design v3): loads the registration and the
# bound evidence objects for this window, checks binding, applies the standing rules (readability, the owner's death
# gate, v15c movement guards, v11 guards, deposit skill_error, v12/v14c linkage with the death poll's own check) and the
# registration's own lines and exposure, and prints ONE verdict: NOT_YET | KEEP | REVERT | WATCH | INCONCLUSIVE |
# UNREADABLE | KEEP_ON_SAFETY. Writes ~/digest/reads/<run_id>-verdict-<M>.json. Never edits a rule.
import sys, json, os, glob, gzip, hashlib, datetime as dt, collections
run_id, M = sys.argv[1], int(sys.argv[2]); DRY = '--dryrun' in sys.argv; POLL = '--poll' in sys.argv
R = os.path.expanduser('~/digest/reads'); REG = os.path.expanduser(f'~/mcai-analysis/registrations/{run_id}.json')
if not os.path.exists(REG): REG = f'/tmp/registrations/{run_id}.json'
reg = json.load(open(REG)); man = json.load(open('/srv/mcbots/trial-manifest.json'))
why = []; verdict = None
def out(v, extra=None):
    o = {'run_id': run_id, 'window_min': M, 'verdict': v, 'why': why, 'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'extra': extra or {}}
    os.makedirs(R, exist_ok=True); json.dump(o, open(os.path.join(R, f'{run_id}-verdict-{M}.json'), 'w'), indent=1, default=str)
    print(f"VERDICT {v} (+{M}) :: " + ' | '.join(why)); sys.exit(0)
# 1. evidence, bound
ev = {}
if POLL:
    latest = sorted(glob.glob(os.path.join(R, f'{run_id}-immobiledid-*.json')), key=os.path.getmtime)
    im = json.load(open(latest[-1]))['fields'] if latest else {'harm': {'canary_deaths': 0, 'control_rate': None, 'canary_rate': 0}}
    reg['reads'] = []
for name in reg['reads']:
    p = os.path.join(R, f'{run_id}-{name}-{M}.json')
    if not os.path.exists(p): why.append(f'{name}: no evidence object for +{M}'); continue
    o = json.load(open(p))
    if not DRY:
        if o.get('sha') != man.get('canary_code_version') or o.get('pools') != man.get('canary_pool') or o.get('run_id') != man.get('run_id') or o.get('declared_at') != man.get('declared_at') or o.get('window_min') != M:
            why.append(f'{name}: evidence not bound to the active canary'); continue
        if o.get('sha') != reg['sha']: why.append(f'{name}: evidence sha {o.get("sha")} != registration sha {reg["sha"]}'); continue
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(o['emitted_at'])).total_seconds() / 60
        if age > 90: why.append(f'{name}: evidence stale ({age:.0f} min)'); continue
    ev[name] = o['fields']
if len(ev) < len(reg['reads']): (out('UNREADABLE'))
if not POLL:
    im = ev['immobiledid']
    # 2. readability
    if not im.get('readable'): why.append(f"not readable yet ({im.get('canary_bot_h', 0):.1f} bot-h)"); (out('NOT_YET'))
# 3. rung-linked deaths (the death poll's rule, recomputed here from the pools' logs since declared_at)
M_LIST = set('entombed marooned maroon_wall entombed_ramp_cut marooned_ramp_cut livelock_escape pillar_no_gain stuck unstick_oscillation'.split()) | set(reg.get('linkage_extra', []))
C_ROWS = set(reg.get('change_rows', []))
linked = []; changerow = []; ndeaths = 0
if not DRY:
    cut = man['declared_at'][:19]; pools = [p.strip() for p in str(man['canary_pool']).split(',')]
    by = collections.defaultdict(list)
    for pool in pools:
        for f in glob.glob(f'/var/log/mcai/{pool}-*/skill-*.jsonl') + glob.glob(f'/var/log/mcai/{pool}-*/skill-*.jsonl-*.gz'):
            op = gzip.open if f.endswith('.gz') else open
            try:
                with op(f, 'rt', errors='replace') as fh:
                    for l in fh:
                        if cut[:10] not in l[:60] and dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d') not in l[:60] and '"_death"' not in l: continue
                        try: r = json.loads(l)
                        except Exception: continue
                        by[r['bot']['name']].append((r['@timestamp'], (r.get('skill') or {}).get('name', ''), ((r.get('skill') or {}).get('detail') or '')[:70]))
            except Exception: pass
    for b, rs in by.items():
        rs.sort()
        for ts, k, d in rs:
            if k == '_death' and ts > cut:
                ndeaths += 1; t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00')); lo = (t - dt.timedelta(seconds=60)).isoformat().replace('+00:00', 'Z')
                win = [q for q in rs if lo <= q[0] < ts]
                lk = sorted({q[1].lstrip('_') for q in win if q[1].lstrip('_') in M_LIST and not any((not z[1].startswith('_')) and q[0] < z[0] < ts for z in win)})
                ch = sorted({q[1].lstrip('_') for q in win if q[1].lstrip('_') in C_ROWS})
                if lk: linked.append((b, ts[11:19], lk, d))
                if ch: changerow.append((b, ts[11:19], ch, d))
if changerow: why.append(f'change row inside a death window: {changerow[0][:3]}'); (out('REVERT', {'deaths': ndeaths}))
if linked and reg.get('ladder_change', False): why.append(f'rung-linked canary death (ladder change, v12): {linked[0][:3]}'); (out('REVERT', {'deaths': ndeaths}))
if linked: why.append(f'rung-linked death on a non-ladder change (v14c: report unless the four conditions fail; operator reviews): {linked[0][:3]}')
# 4. the owner's death gate
h = im['harm']
if POLL and ndeaths >= 2 and h.get('control_rate'): h = dict(h, canary_deaths=ndeaths, canary_rate=ndeaths / max(0.1, ((dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))).total_seconds() / 3600) * 10))
if h['canary_deaths'] >= 2 and h.get('control_rate') is not None and h['canary_rate'] > 1.25 * (h['control_rate'] or 0): why.append(f"death gate: {h['canary_deaths']} canary deaths, {h['canary_rate']:.3f} vs control {h['control_rate']:.3f}/bh"); (out('REVERT'))
why.append(f"deaths {h['canary_deaths']} ({h['canary_rate']:.3f}) vs control {(h['control_rate'] or 0):.3f}/bh")
if POLL: why.append(f'poll: {ndeaths} canary deaths since declared_at, {len(linked)} rung-linked, {len(changerow)} with a change row'); (out('POLL_OK', {'deaths': ndeaths}))
# 5. v15c movement guards
v = im['v15c']
if v['verdict'].startswith('REVERT'): why.append('v15c ' + v['verdict']); (out('REVERT'))
watch = [v['verdict']] if v['verdict'].startswith('WATCH') else []
# 6. v11 guards
g = im['v11']
for nm, val, lim in (('climbs', g['climbs'], 1.0), ('livelock', g['livelock'], 1.0)):
    if val == val and val > lim: why.append(f'v11 {nm} {val:+.0%} > +100%'); (out('REVERT'))
if g['ladders_p90'] is not None and g['ladders_p90'] > 32: why.append(f"ladders p90 {g['ladders_p90']} > 32"); (out('REVERT'))
# 7. deposit skill_error
d = ev.get('depositread', {})
if d.get('skill_error_share_canary') is not None and d.get('skill_error_share_control') is not None and d['skill_error_share_canary'] > d['skill_error_share_control']: why.append('deposit skill_error share above control'); (out('REVERT'))
# 8. own lines
for ln in reg.get('own_lines', []):
    val = ev.get(ln['read'], {}).get(ln['field'])
    if val is None:
        if ln.get('nullable'): continue
        why.append(f"own line {ln['read']}.{ln['field']} missing"); (out('UNREADABLE'))
    ok = {'<=': val <= ln['value'], '>=': val >= ln['value'], '==': val == ln['value']}[ln['op']]
    if not ok:
        why.append(f"own line {ln['read']}.{ln['field']} = {val} fails {ln['op']} {ln['value']}")
        if ln['on_fail'] == 'REVERT': (out('REVERT'))
        watch.append(f"{ln['field']}")
# 9. exposure
ex = reg.get('exposure'); exposed = True
if ex:
    val = ev.get(ex['read'], {}).get(ex['field']) or 0; exposed = val >= ex['min']; why.append(f"exposure {ex['read']}.{ex['field']} = {val} (min {ex['min']})")
final_M = max(reg['read_minutes'] + (reg.get('extension', {}).get('extra_reads', []) if reg.get('extension', {}).get('until_exposure') else []))
if watch: why.append('WATCH: ' + ', '.join(watch))
if M < max(reg['read_minutes']): (out('NOT_YET'))
if not exposed:
    if reg.get('extension', {}).get('until_exposure') and M < final_M: why.append('zero exposure: the registered extension continues'); (out('NOT_YET'))
    why.append('zero exposure at the final read'); (out(reg.get('extension', {}).get('final_on_zero_exposure', 'INCONCLUSIVE')))
(out('KEEP'))
