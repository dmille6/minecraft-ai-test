#!/usr/bin/env python3
"""furnaceseen-01: THE FILED REGISTRATION through verdict.py (design 6.1(4) and 6.3 B3; Claude r1 P2-4). HOST ONLY: it loads the
host's verdict.py and its acceptance harness (~/verdict.py, ~/test_verdict_acceptance.py, the host lib), builds fixture worlds in
a temp dir (nothing on the host is touched) and asserts:
  the effect line's margin above / equal to the bar at +180 with every tier-2 prerequisite met -> KEEP (intended: tier 2 permits it);
  below -> NOT_YET at +180 (blocked, reads remain) and INCONCLUSIVE at the final (+2880): never KEEP, never REVERT;
  undefined (None) -> UNREADABLE; a D1 defect -> REVERT; the D1 positive control failing -> never KEEP.
  python3 -B test_furnaceseen_verdict.py [~/verdict.py] [~/gate-v36/test_verdict_acceptance.py]"""
import os, sys, json, tempfile, importlib.util, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from furnaceseen_reg import build, FINAL_MIN   # noqa: E402

VP = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/verdict.py')
AP = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/gate-v36/test_verdict_acceptance.py')
for cand in (os.path.join(os.path.dirname(VP), 'lib'), '/home/mike/mcai-analysis/lib', '/opt/minecraft-ai/scripts/lib'):
    if os.path.isdir(cand):
        sys.path.insert(1, cand); break
spec = importlib.util.spec_from_file_location('tva_fseen', AP); A = importlib.util.module_from_spec(spec); spec.loader.exec_module(A)
A.VERDICT = VP
CAN_POOLS = ['board-a', 'board-b', 'hive-a', 'hive-b']
CTL_POOLS = ['board-c', 'board-d', 'hive-c', 'hive-d', 'placebo-a', 'placebo-b']
BOTN = ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')
GOOD = {'d1_defects': 0, 'd1_instrument': 1, 'r_lb_minus_bar': 0.05, 'rows_control_post': 0, 'liveness': 1, 'instrument_control': 1,
        'skipped_walks': 30, 'r': 0.4, 'readable': True}
T = []


def run(tmp, M=180, fields=None):
    reg = build(A.SHA, 'base000')
    reg.pop('reads_md5', None)
    pools = ','.join(CAN_POOLS)
    cs = A.Case(tmp, reg_extra=reg, manifest_extra={'canary_pool': pools, 'declared_at': A.now(-M - 5)})
    cs.evidence('immobiledid', A.immobiledid(v15c='OK', canary_deaths=0, canary_bh=60.0, control_deaths=3, control_bh=240.0), M=M, pools=pools)
    cs.evidence('furnaceseenread', dict(GOOD, **(fields or {})), M=M, pools=pools)
    # the tier-2 clean baseline: every pool's bots on one build over max(240, M) minutes before the cut (test_tiers.py's world)
    decl = dt.datetime.fromisoformat(cs.man['declared_at'])
    L = max(240, M)
    rd = os.path.join(cs.d, 'wants'); os.makedirs(rd)
    for p in CAN_POOLS + CTL_POOLS:
        for nme in BOTN:
            open(os.path.join(rd, 'mcbot@%s-%s.service' % (p, nme)), 'w').write('')
            b = '%s-%s' % (p, nme); dd = os.path.join(cs.logs, b); os.makedirs(dd, exist_ok=True)
            with open(os.path.join(dd, 'skill-1.jsonl'), 'a') as f:
                for i in range(int(L / 4) + 2):
                    tt = decl - dt.timedelta(minutes=L + 2) + dt.timedelta(minutes=4 * i)
                    if tt >= decl:
                        break
                    f.write(json.dumps({'@timestamp': tt.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': 'base000+d1'},
                                        'bot': {'name': b}, 'skill': {'name': 'gather', 'detail': ''}}) + '\n')
    env = {'VERDICT_MODULE_DIR': os.path.dirname(os.path.abspath(VP)), 'VERDICT_ROSTER_DIR': rd}
    return cs.run(M=M, env_extra=env)


def t(name, got, ok):
    T.append(bool(ok)); print(('PASS' if ok else 'FAIL') + '  ' + name + '  -> ' + ' '.join(map(str, got))[:300])


with tempfile.TemporaryDirectory() as tmp:
    v, h = run(tmp); t('margin above the bar at +180, every tier-2 prerequisite met -> KEEP (tier 2 permits it)', (v, h), v == 'KEEP')
    v, h = run(tmp, fields={'r_lb_minus_bar': 0.0}); t('margin EQUAL to the bar at +180 -> KEEP', (v, h), v == 'KEEP')
    v, h = run(tmp, fields={'r_lb_minus_bar': -0.02}); t('margin below the bar at +180 -> NOT_YET (blocked; never KEEP, never REVERT)', (v, h), v == 'NOT_YET')
    v, h = run(tmp, M=FINAL_MIN, fields={'r_lb_minus_bar': -0.02}); t('margin below the bar at the FINAL -> INCONCLUSIVE', (v, h), v == 'INCONCLUSIVE')
    v, h = run(tmp, fields={'r_lb_minus_bar': None}); t('the effect line UNDEFINED -> UNREADABLE', (v, h), v == 'UNREADABLE')
    v, h = run(tmp, fields={'d1_defects': 1}); t('a D1 defect -> REVERT', (v, h), v == 'REVERT')
    v, h = run(tmp, fields={'d1_instrument': 0}); t('the D1 positive control failing -> never KEEP', (v, h), v in ('NOT_YET', 'INCONCLUSIVE'))
    v, h = run(tmp, fields={'skipped_walks': 5}); t('exposure short (5 < 20) at +180 -> NOT_YET (extends), never KEEP', (v, h), v == 'NOT_YET')
print('%d/%d' % (sum(T), len(T)))
sys.exit(0 if all(T) else 1)
