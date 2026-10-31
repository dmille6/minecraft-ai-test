#!/usr/bin/env python3
"""modelread.py -- the read for a MODEL-ENV canary (class model-env; first user qwen35-01, 10-30).

    modelread.py <M>            the +M read: prints a report, writes ~/digest/reads/<run>-modelread-<M>.json (readjson)
    modelread.py --poll         the loop's 5-min stall guard: ONE line `MODELPOLL <OK|REVERT|UNREADABLE> :: ...`

The canary changes only the bots' environment (OLLAMA_MODEL / OLLAMA_BASE_URLS, from the registration's canary_env),
so every question is about the decision stream (/var/log/mcai/<bot>/llm-<bot>.jsonl, which telemetry.Events does not
load) plus the items the bots took (skill rows' inventory_delta).

ARMS. canary = the manifest's canary pools; control = every other bot outside isolated-* (the population drawrec draws
from). PRE = the PRE_MIN minutes before declared_at; POST = declared_at + WARM_MIN .. declared_at + M (the restarts and
each bot's first decision are not the arm). Canary POST rows count only when their code.version is the canary build
(a restart-lag row is the baseline, not the canary).

FIELDS (own lines bind to these; all shares are 0..1, None = no denominator, never 0):
  stall_bots             canary bots (unit active) with no schema-valid decision served by the canary model in the last
                         STALL_MIN minutes. The fleet's own rate is 1.33 decisions/min/bot and its 6-h baseline had ZERO
                         10-min gaps on any of 80 bots (10-30), so >= 2 is a stall, not a quiet patch.
  model_share            canary POST model decisions answered (llm.endpoint set) by the canary model, no model_mismatch /
                         all canary POST model decisions (work-order rows excluded; an unserved decision counts against it)
  order_share_*          work-order rows / all llm rows (reported)
  schema_valid_canary / schema_valid_control / schema_gap_pp = (control - canary) * 100
  lat_p50_ms / lat_p95_ms (canary POST)   and control_lat_p50_ms / control_lat_p95_ms
  completion_p95         canary POST completion tokens p95 (a thinking model fills num_predict 512; no-think is ~60-90)
  decisions_bh_did       ratio-DiD of MODEL decisions per bot-hour (work orders excluded: is_order)
  items_bh_canary_pre/post, items_bh_control_pre/post, items_ratio_did   (sum of positive inventory_delta per bot-h)
  rep_fail_*             P(the decision repeats the previous decision's key | that one was admitted and FAILED,
                         non-transient); bench/models/score.py key_of -- the live form of the replay's rep_fail
  veto_repeat_*          P(the decision repeats the vetoed key | the previous decision was refused by repeat_loop)
  refused_share_*        refused (aborted with no admission) / all decisions
  readable               1 when model_share >= 0.95 on >= MIN_ROWS canary POST rows, else 0 (the exposure field)
"""
import datetime as dt
import glob
import gzip
import json
import os
import re
import subprocess
import sys

PRE_MIN = 180
WARM_MIN = 15
STALL_MIN = 10
MIN_ROWS = 200
MIN_CONTROL = int(os.environ.get('MODELREAD_MIN_CONTROL', '40'))   # control bots with rows (positive control); the
# staged rollout (modelrollout.py) lowers it, because its control shrinks to nothing by the last stage
LOG_ROOT = os.environ.get('MODELREAD_LOG_ROOT', '/var/log/mcai')
MANIFEST = os.environ.get('MODELREAD_MANIFEST', '/srv/mcbots/trial-manifest.json')
REG_DIR = os.environ.get('MODELREAD_REG_DIR', os.path.expanduser('~/mcai-analysis/registrations'))
ENV_DIR = os.environ.get('MODELREAD_ENV_DIR', '/srv/mcbots/harness/env')
UNITS_FILE = os.environ.get('MODELREAD_UNITS_FILE', '')
TRANSIENT = re.compile(r'cooldown|busy|paused|timed? ?out', re.I)   # build_dataset.py's transient classes
RUNNER_REFUSED = ('paused after repeated failures', 'busy with ')


def now():
    v = os.environ.get('MODELREAD_NOW')
    return dt.datetime.fromisoformat(v.replace('Z', '+00:00')) if v else dt.datetime.now(dt.timezone.utc)


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return None


def key_of(skill, args):
    """bench/models/score.py key_of, copied so the read runs from /tmp alone (test_modelread.py checks they agree)."""
    args = args or {}
    if skill in ('gather',):
        return (skill, args.get('block'))
    if skill in ('craft', 'smelt', 'deposit', 'place', 'withdraw', 'eat', 'compost', 'dispose_well'):
        return (skill, args.get('item'))
    if skill == 'mine':
        return (skill, args.get('y'))
    if skill == 'goto':
        if args.get('player'):
            return (skill, 'player:' + str(args.get('player')))
        return (skill, tuple(args.get(k) for k in ('x', 'y', 'z')))
    if skill == 'bucket':
        return (skill, args.get('action'))
    if skill == 'build':
        return (skill, args.get('plan'))
    return (skill,)


def canary_model(reg):
    for kv in reg.get('canary_env') or []:
        if kv.startswith('OLLAMA_MODEL='):
            return kv.split('=', 1)[1]
    return None


def served_by(row, model):
    """Served by the canary model: an endpoint ANSWERED (llm.endpoint set) with that model and no mismatch. A decision
    nothing served logs the CONFIGURED model (cognitive.mjs `res.model ?? config.llm.model`) with endpoint null, so the
    model name alone would count an outage as served (both reviewers, r1)."""
    L = row.get('llm') or {}
    m = str(L.get('model') or '')
    return bool(model) and bool(L.get('endpoint')) and (m == model or m.startswith(model + '-')) and not L.get('model_mismatch')


def is_order(row):
    """A WORK ORDER, not a model decision: cognitive.mjs runs a deterministic order without calling the model and still
    writes an llm row -- latency 0, schema_valid true, no endpoint, and the CONFIGURED model name (10-30: ~10-15% of
    rows). Counting them would credit the canary model with decisions it never made (and hide an outage)."""
    L = row.get('llm') or {}
    return not L.get('endpoint') and not L.get('latency_ms') and bool(L.get('schema_valid'))


def roster(pools):
    bots = []
    for p in pools:
        for e in sorted(glob.glob(os.path.join(ENV_DIR, '%s-*.env' % p))):
            b = os.path.basename(e)[:-4]
            if b[len(p) + 1:] and '-' not in b[len(p) + 1:]:
                bots.append(b)
    return bots


def all_bots():
    out = []
    for e in sorted(glob.glob(os.path.join(ENV_DIR, '*.env'))):
        b = os.path.basename(e)[:-4]
        if re.fullmatch(r'[a-z]+-[a-z]-[A-Z][a-z]+', b):
            out.append(b)
    return out


def units_active(bots):
    if UNITS_FILE:
        d = json.load(open(UNITS_FILE))
        return {b: d.get(b, 'unknown') == 'active' for b in bots}
    out = {}
    for b in bots:
        r = subprocess.run(['systemctl', 'show', '-p', 'ActiveState', '--value', 'mcbot@%s.service' % b],
                           capture_output=True, text=True, timeout=30)
        out[b] = r.stdout.strip() == 'active'
    return out


def read_stream(bot, kind, since, until):
    """Rows of llm-/skill-<bot>.jsonl in [since, until], the live file plus the rotated .gz of each day in the window."""
    d = os.path.join(LOG_ROOT, bot)
    paths = [os.path.join(d, '%s-%s.jsonl' % (kind, bot))]
    day = since.date()
    while day <= until.date():
        paths.append(os.path.join(d, '%s-%s.jsonl-%s.gz' % (kind, bot, (day + dt.timedelta(days=1)).strftime('%Y%m%d'))))
        day += dt.timedelta(days=1)
    rows = []
    for p in paths:
        if not os.path.exists(p):
            continue
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rb') as f:
            for l in f:
                try:
                    r = json.loads(l)
                except Exception:
                    continue
                t = ts(r.get('@timestamp'))
                if t and since <= t <= until:
                    r['_t'] = t
                    rows.append(r)
    rows.sort(key=lambda r: r['_t'])
    return rows


# --------------------------------------------------------------------------------------------- pure decisions --
def stall_bots(llm_by_bot, active, model, canary_prefix, t_now, decl):
    """PURE. Canary bots whose unit is active and whose newest schema-valid canary-model row on the canary build is
    older than STALL_MIN (or absent), once WARM_MIN has passed since the deploy. -> sorted list of bot names."""
    if (t_now - decl).total_seconds() < WARM_MIN * 60:
        return []
    out = []
    for b, rows in llm_by_bot.items():
        if not active.get(b):
            continue
        last = None
        for r in rows:
            if str((r.get('code') or {}).get('version') or '')[:7] != canary_prefix[:7]:
                continue
            if (r.get('llm') or {}).get('schema_valid') and served_by(r, model):
                last = r['_t'] if last is None or r['_t'] > last else last
        if last is None or (t_now - last).total_seconds() > STALL_MIN * 60:
            out.append(b)
    return sorted(out)


def poll_decision(stalled, n_active, endpoint_ok):
    """PURE. -> (word, why)."""
    if n_active == 0:
        return 'UNREADABLE', 'no active canary unit'
    if len(stalled) >= 2:
        return 'REVERT', 'stall: %d of %d active canary bots have had no schema-valid decision by the canary model for %d min (%s); endpoint %s' % (
            len(stalled), n_active, STALL_MIN, ', '.join(stalled), 'answers' if endpoint_ok else 'DOES NOT answer')
    return 'OK', '%d of %d active canary bots stalled (REVERT at 2); endpoint %s' % (
        len(stalled), n_active, 'answers' if endpoint_ok else 'does not answer')


def pct(xs, q):
    xs = sorted(x for x in xs if isinstance(x, (int, float)))
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None


def share(n, d):
    return None if not d else n / d


def repeat_rates(rows):
    """PURE. rows: one bot's llm rows in time order. -> counters for rep_fail and veto_repeat."""
    c = {'fail_n': 0, 'fail_rep': 0, 'veto_n': 0, 'veto_rep': 0, 'n': 0, 'refused': 0}
    prev = None
    for r in rows:
        L = r.get('llm') or {}
        tc = (r.get('tool_calls') or [{}])[0] if r.get('tool_calls') else {}
        o = r.get('outcome') or {}
        k = key_of(tc.get('skill'), tc.get('args')) if tc.get('skill') else None
        refused = o.get('status') == 'aborted' and L.get('admission') is None and bool(tc.get('skill'))
        model_made = not is_order(r)
        c['n'] += model_made
        c['refused'] += refused and model_made
        if prev is not None and k is not None and model_made:
            pk, prefused, pstatus, pdetail, perr = prev
            if not prefused and pstatus == 'failed' and not TRANSIENT.search(pdetail) \
                    and not pdetail.startswith(RUNNER_REFUSED):
                c['fail_n'] += 1
                c['fail_rep'] += k == pk
            if prefused and (perr or '').startswith('repeat_loop'):
                c['veto_n'] += 1
                c['veto_rep'] += k == pk
        prev = (k, refused, o.get('status'), str(o.get('detail') or ''), str(L.get('error') or '')) if k is not None else prev
    return c


def items_of(skill_rows):
    n = 0
    for r in skill_rows:
        for v in ((r.get('skill') or {}).get('inventory_delta') or {}).values():
            if isinstance(v, (int, float)) and v > 0:
                n += v
    return n


def bot_hours(rows_by_bot, since, until):
    """Bot-hours over which bots actually wrote rows (first..last row, clipped), not the nominal window."""
    h = 0.0
    for rows in rows_by_bot.values():
        if rows:
            a, b = max(rows[0]['_t'], since), min(rows[-1]['_t'], until)
            h += max(0.0, (b - a).total_seconds() / 3600)
    return h


def ratio_did(cpre, cpost, kpre, kpost):
    try:
        return (cpost / cpre) / (kpost / kpre) - 1
    except (ZeroDivisionError, TypeError):
        return None


# ------------------------------------------------------------------------------------------------------ gather --
def context():
    man = json.load(open(MANIFEST))
    run = man.get('run_id') or ''
    reg = json.load(open(os.path.join(REG_DIR, '%s.json' % run)))
    pools = [p.strip() for p in str(man.get('canary_pool') or '').split(',') if p.strip()]
    decl = ts(man.get('declared_at'))
    return man, run, reg, pools, decl


def endpoint_ok(reg):
    for kv in reg.get('canary_env') or []:
        if kv.startswith('OLLAMA_BASE_URLS='):
            url = kv.split('=', 1)[1].split(',')[0].split('|')[0]
            try:
                import urllib.request
                urllib.request.urlopen(url + '/api/version', timeout=5).read()
                return True
            except Exception:
                return False
    return None


def do_poll():
    try:
        man, run, reg, pools, decl = context()
        if not pools or not decl or (reg.get('class') or '') != 'model-env':
            print('MODELPOLL UNREADABLE :: no model-env canary declared (manifest run %r, pools %r)' % (man.get('run_id'), pools)); return
        model, csha, t = canary_model(reg), str(man.get('canary_code_version') or ''), now()
        bots = roster(pools)
        act = units_active(bots)
        since = t - dt.timedelta(minutes=STALL_MIN + 5)
        llm = {b: read_stream(b, 'llm', since, t) for b in bots}
        st = stall_bots(llm, act, model, csha, t, decl)
        w, why = poll_decision(st, sum(1 for v in act.values() if v), endpoint_ok(reg) if st else True)
        print('MODELPOLL %s :: %s %s on %s: %s' % (w, run, model, ','.join(pools), why))
    except Exception as x:
        print('MODELPOLL UNREADABLE :: %s: %s' % (type(x).__name__, x))


def do_read(M):
    man, run, reg, pools, decl = context()
    model, csha, t = canary_model(reg), str(man.get('canary_code_version') or ''), now()
    post_end = min(t, decl + dt.timedelta(minutes=M))
    post_start, pre_start = decl + dt.timedelta(minutes=WARM_MIN), decl - dt.timedelta(minutes=PRE_MIN)
    can = roster(pools)
    ctl = [b for b in all_bots() if b not in can and not b.startswith('isolated-')]
    L, S = {}, {}
    for b in can + ctl:
        L[b] = read_stream(b, 'llm', pre_start, post_end)
        S[b] = read_stream(b, 'skill', pre_start, post_end)
    total_rows = sum(len(v) for v in L.values())
    assert total_rows > 1000 and sum(1 for b in ctl if L[b]) >= MIN_CONTROL, \
        'positive control failed: %d llm rows, %d control bots with rows' % (total_rows, sum(1 for b in ctl if L[b]))

    def part(rows, a, z, canary):
        out = [r for r in rows if a <= r['_t'] <= z]
        if canary and a >= decl:
            out = [r for r in out if str((r.get('code') or {}).get('version') or '')[:7] == csha[:7]]
        return out
    arms = {}
    for arm, bots in (('canary', can), ('control', ctl)):
        for ph, a, z in (('pre', pre_start, decl), ('post', post_start, post_end)):
            lr = {b: part(L[b], a, z, arm == 'canary') for b in bots}
            sr = {b: part(S[b], a, z, arm == 'canary') for b in bots}
            allrows = [r for v in lr.values() for r in v]
            rows = [r for r in allrows if not is_order(r)]          # MODEL decisions only (served or failed)
            bh = bot_hours(sr, a, z)
            rc = {'fail_n': 0, 'fail_rep': 0, 'veto_n': 0, 'veto_rep': 0, 'n': 0, 'refused': 0}
            for v in lr.values():
                for k, x in repeat_rates(v).items():
                    rc[k] += x
            arms[(arm, ph)] = {
                'rows': len(rows), 'all_rows': len(allrows), 'bh': bh,
                'model_rows': sum(1 for r in rows if served_by(r, model)),
                'valid': sum(1 for r in rows if (r.get('llm') or {}).get('schema_valid')),
                'lat': [(r.get('llm') or {}).get('latency_ms') for r in rows if (r.get('llm') or {}).get('schema_valid')],
                'ctok': [(r.get('llm') or {}).get('completion_tokens') for r in rows],
                'items': sum(items_of(v) for v in sr.values()), 'rc': rc}
    cp, cq, kp, kq = arms[('canary', 'pre')], arms[('canary', 'post')], arms[('control', 'pre')], arms[('control', 'post')]
    per_bh = lambda a, k: (a[k] / a['bh']) if a['bh'] else None
    act = units_active(can)
    st = stall_bots({b: part(L[b], post_end - dt.timedelta(minutes=STALL_MIN + 5), post_end, True) for b in can},
                    act, model, csha, post_end, decl)
    f = {
        'order_share_canary_post': share(cq['all_rows'] - cq['rows'], cq['all_rows']),
        'order_share_control_post': share(kq['all_rows'] - kq['rows'], kq['all_rows']),
        'model': model, 'canary_bots': len(can), 'control_bots': len(ctl),
        'canary_post_rows': cq['rows'], 'canary_post_bot_h': round(cq['bh'], 2),
        'stall_bots': len(st), 'stalled': st,
        'model_share': share(cq['model_rows'], cq['rows']),
        'control_model_share': share(kq['model_rows'], kq['rows']),
        'schema_valid_canary': share(cq['valid'], cq['rows']), 'schema_valid_control': share(kq['valid'], kq['rows']),
        'lat_p50_ms': pct(cq['lat'], .5), 'lat_p90_ms': pct(cq['lat'], .9), 'lat_p95_ms': pct(cq['lat'], .95),
        'control_lat_p50_ms': pct(kq['lat'], .5), 'control_lat_p95_ms': pct(kq['lat'], .95),
        'completion_p50': pct(cq['ctok'], .5), 'completion_p95': pct(cq['ctok'], .95),
        'decisions_bh_canary_pre': per_bh(cp, 'rows'), 'decisions_bh_canary_post': per_bh(cq, 'rows'),
        'decisions_bh_control_pre': per_bh(kp, 'rows'), 'decisions_bh_control_post': per_bh(kq, 'rows'),
        'items_bh_canary_pre': per_bh(cp, 'items'), 'items_bh_canary_post': per_bh(cq, 'items'),
        'items_bh_control_pre': per_bh(kp, 'items'), 'items_bh_control_post': per_bh(kq, 'items'),
    }
    f['schema_gap_pp'] = None if f['schema_valid_canary'] is None or f['schema_valid_control'] is None else \
        round((f['schema_valid_control'] - f['schema_valid_canary']) * 100, 3)
    f['decisions_bh_did'] = ratio_did(f['decisions_bh_canary_pre'], f['decisions_bh_canary_post'],
                                      f['decisions_bh_control_pre'], f['decisions_bh_control_post'])
    f['items_ratio_did'] = ratio_did(f['items_bh_canary_pre'], f['items_bh_canary_post'],
                                     f['items_bh_control_pre'], f['items_bh_control_post'])
    for nm, a in (('canary_pre', cp), ('canary_post', cq), ('control_pre', kp), ('control_post', kq)):
        rc = a['rc']
        f['rep_fail_' + nm] = share(rc['fail_rep'], rc['fail_n']); f['rep_fail_n_' + nm] = rc['fail_n']
        f['veto_repeat_' + nm] = share(rc['veto_rep'], rc['veto_n']); f['veto_repeat_n_' + nm] = rc['veto_n']
        f['refused_share_' + nm] = share(rc['refused'], rc['n'])
    f['readable'] = int(bool(f['model_share'] is not None and f['model_share'] >= 0.95 and cq['rows'] >= MIN_ROWS))
    r3 = lambda v: None if v is None else (round(v, 4) if isinstance(v, float) else v)
    print('MODELREAD %s +%d  %s on %s (%d canary bots, %d control)  post %s..%s' % (
        run, M, model, ','.join(pools), len(can), len(ctl), post_start.strftime('%H:%MZ'), post_end.strftime('%H:%MZ')))
    for k in sorted(f):
        print('  %-28s %s' % (k, r3(f[k])))
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); sys.path.insert(0, '/opt/minecraft-ai/scripts')
    if not os.environ.get('MODELREAD_NO_EMIT'):
        from readjson import emit
        emit('modelread', M, {k: r3(v) for k, v in f.items()})
    return f


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--poll':
        do_poll()
    else:
        do_read(int(float(sys.argv[1])) if len(sys.argv) > 1 else 180)
