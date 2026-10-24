#!/usr/bin/env python3
"""test_loop_tier2.py <PATCHED canary-loop.sh> <tierrule.py> <drawrequire.py> [--mutants] -- the loop's OWN tier-2
code, cut from the patched canary-loop.sh (its T2_DRAW_MAX_H line and its whole draw block, from the tier-2
classification to `journal drawn`) and run in bash with stubs for journal/page, a fake clock (`_now`, and `sleep`
advancing it) and a stub drawrec that draws nothing until a scripted clock value, then FIX_NPOOLS pools. Runs anywhere
bash and python3 exist (no flock/timeout: the bag-fix branch of the block is not entered). Nothing live is touched.
  ready / late / bound / bound-configured     the 4-or-wait rule and its 12-h bound
  tier3 / notier-notierrule                   positive controls: no tier = today's behaviour, nothing loaded
  pre: draw_k 2 / True, 5 required            refused before any draw (refused-tier2-pre), naming the field
  draw_k 0 / False / 4 / 5                    NOT refused (drawrec ignores them, or they allow 4)
  notierrule                                  a tier key, tierrule.py absent -> refused-tier2-tier, journalled
  count                                       drawrec returns 3 for a tier-2 run -> refused-tier2-count (interlock)"""
import json, os, re, shutil, subprocess, sys, tempfile

LOOP, TRM, DRQ = sys.argv[1:4]
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-700:]))


def cut(src):
    a = src.index('T2_DRAW_MAX_H=${')
    b = src.index('\n', a) + 1
    c = src.index('  # TIER 2 (OWNER POLICY 2026-10-24; tier2-four-pools')
    e = src.index('\n', src.index('  journal drawn "$P :: ')) + 1
    return src[a:b], src[c:e]


STUB_DRAWREC = r'''#!/bin/bash
now=$(cat "$FIX_CLK")
echo "drawrec calls" >> "$FIX_CALLS"
if [ "$now" -ge "$FIX_DRAW_AT" ]; then
  echo "eligible [...]"
  case "${FIX_NPOOLS:-4}" in
    3) echo "DRAW (3 pools = 15 bots, owner C): ['board-a', 'board-b', 'hive-a']";;
    *) echo "DRAW (4 pools = 20 bots, owner C): ['board-a', 'board-b', 'hive-a', 'hive-b']";;
  esac
else
  echo "eligible [...]"; echo "DRAW (none, owner C): NONE (fewer than 4 eligible)"
fi
'''


def run(src, reg, draw_at_s, tierrule=True, max_h=None, npools=4):
    d = tempfile.mkdtemp(prefix='looptier2-')
    try:
        ma = os.path.join(d, 'mcai-analysis'); os.makedirs(os.path.join(ma, 'registrations'))
        if tierrule:
            shutil.copy(TRM, os.path.join(ma, 'tierrule.py'))
        shutil.copy(DRQ, os.path.join(ma, 'drawrequire.py'))
        regp = os.path.join(ma, 'registrations', 'r1.json'); json.dump(dict({'sha': 'x'}, **reg), open(regp, 'w'))
        open(os.path.join(ma, 'drawrec.sh'), 'w').write(STUB_DRAWREC)
        clk = os.path.join(d, 'clock'); open(clk, 'w').write('1000000')
        top, draw_block = cut(src)
        harness = ('set -u\nH=%s; RUN=r1; REG=%s; J=%s/journal; PAGE=%s/page; touch $J $PAGE\n'
                   '_now() { cat "$FIX_CLK"; }\n'
                   'sleep() { echo $(( $(cat "$FIX_CLK") + $1 )) > "$FIX_CLK"; }\n'
                   'journal() { printf \'{"run":"%%s","phase":"%%s","note":%%s}\\n\' "$RUN" "$1" "$(python3 -c \'import json,sys; print(json.dumps(sys.argv[1]))\' "$2")" >> $J; }\n'
                   'page() { echo "$1 $2" >> $PAGE; }\n'
                   'BAGFIX=""\n%s\n%s\necho "DRAWN $P"\n') % (d, regp, d, d, top, draw_block)
        hp = os.path.join(d, 'h.sh'); open(hp, 'w').write(harness)
        env = dict(os.environ, HOME=d, FIX_CLK=clk, FIX_DRAW_AT=str(1000000 + draw_at_s), FIX_CALLS=os.path.join(d, 'calls'),
                   FIX_NPOOLS=str(npools), PYTHONDONTWRITEBYTECODE='1')
        env.pop('CANARY_T2_DRAW_MAX_H', None)
        if max_h is not None:
            env['CANARY_T2_DRAW_MAX_H'] = str(max_h)
        r = subprocess.run(['bash', hp], capture_output=True, text=True, env=env, timeout=120)
        J = [json.loads(l) for l in open(os.path.join(d, 'journal')) if l.strip()]
        pages = open(os.path.join(d, 'page')).read()
        calls = len(open(os.path.join(d, 'calls')).read().splitlines()) if os.path.exists(os.path.join(d, 'calls')) else 0
        return r.returncode, r.stdout + r.stderr, [x['phase'] for x in J], pages, calls, J
    finally:
        shutil.rmtree(d, ignore_errors=True)


def cases(src):
    rc, o, ph, pg, n, J = run(src, {'tier': 2}, 0)
    t('ready: tier 2, 4 pools at once -> drawn, no draw-short', rc == 0 and 'DRAWN board-a' in o and 'draw-short' not in ph
      and ph[-1] == 'drawn', (rc, o, ph))
    t('ready: the draw row says it waits for exactly four (tier 2)', 'exactly four pools' in J[0]['note'], J[:1])
    rc, o, ph, pg, n, J = run(src, {'tier': 2}, 3600)
    t('late: tier 2, pools after 1 h -> draw-short rows, then drawn', rc == 0 and ph.count('draw-short') >= 2
      and ph[-1] == 'drawn', (rc, o, ph))
    rc, o, ph, pg, n, J = run(src, {'tier': 2}, 10 ** 9)
    t('bound: tier 2, never -> refused-tier2-draw, exit 2, nothing drawn', rc == 2 and ph[-1] == 'refused-tier2-draw'
      and 'drawn' not in ph, (rc, o, ph))
    t('bound: refused at the first unsuccessful draw at or past 12 h (36-38 draws at 20 min; a hung drawrec is not '
      'bounded here -- the scheduler pages it at 3 h)', 36 <= n <= 38, n)
    t('bound: the page names both remedies and when each applies', 'replace-variant' in pg and 'rearm' in pg
      and 'NOT deployed' in pg and '4-pool floor' in pg and 'another refusal' in pg, pg)
    rc, o, ph, pg, n, J = run(src, {'tier': 2}, 10 ** 9, max_h=1)
    t('bound is the configured T2_DRAW_MAX_H (1 h in this fixture -> 3-5 draws)', rc == 2 and 3 <= n <= 5, (rc, n))
    rc, o, ph, pg, n, J = run(src, {}, 3600)
    t('tier3 positive control: no tier -> drawn after 1 h, NO draw-short, "two pools" as today', rc == 0
      and 'draw-short' not in ph and ph[-1] == 'drawn' and J[0]['note'] == 'waiting for two pools', (rc, o, ph, J[:1]))
    rc, o, ph, pg, n, J = run(src, {}, 0, npools=3)
    t('tier3 positive control: no tier, drawrec gives 3 -> drawn on 3 (as today)', rc == 0 and ph[-1] == 'drawn', (rc, o, ph))
    rc, o, ph, pg, n, J = run(src, {'tier': 2}, 0, npools=3)
    t('count interlock: drawrec returns 3 for a tier-2 run -> refused-tier2-count, nothing drawn', rc == 2
      and ph[-1] == 'refused-tier2-count' and 'drawn' not in ph and 'same bundle' in pg, (rc, o, ph, pg))
    for k in (2, True):
        rc, o, ph, pg, n, J = run(src, {'tier': 2, 'draw_k': k}, 0)
        t('pre: tier 2 with draw_k %r -> refused-tier2-pre before any draw' % (k,), rc == 2 and ph == ['refused-tier2-pre']
          and n == 0 and 'draw_k' in pg, (rc, ph, n, pg))
    for k in (0, False, 4, 5):
        rc, o, ph, pg, n, J = run(src, {'tier': 2, 'draw_k': k}, 0)
        t('pre: tier 2 with draw_k %r is not refused (drawrec ignores it or allows 4) -> drawn' % (k,), rc == 0
          and ph[-1] == 'drawn', (rc, ph, n))
    req5 = ['board-a', 'board-b', 'board-c', 'hive-a', 'hive-b']
    rc, o, ph, pg, n, J = run(src, {'tier': 2, 'draw_require_pools': req5}, 0)
    t('pre: tier 2 requiring 5 pools -> refused-tier2-pre before any draw', rc == 2 and ph == ['refused-tier2-pre']
      and n == 0 and 'draw_require_pools' in pg, (rc, ph, n, pg))
    rc, o, ph, pg, n, J = run(src, {'tier': 2, 'draw_require_pools': 'hive-b'}, 0)
    t('pre: tier 2 with a malformed draw_require_pools (a string) -> refused-tier2-pre', rc == 2
      and ph == ['refused-tier2-pre'] and n == 0 and 'malformed' in pg, (rc, ph, n, pg))
    rc, o, ph, pg, n, J = run(src, {'draw_require_pools': 'hive-b'}, 0)
    t('positive control: the same malformed field untiered -> no preflight (drawrec decides, as today)', n >= 1
      and 'refused-tier2-pre' not in ph, (rc, ph, n))
    rc, o, ph, pg, n, J = run(src, {'tier': 2, 'draw_require_pools': ['hive-b']}, 0)
    t('pre: tier 2 requiring 1 pool -> not refused, drawn', rc == 0 and ph[-1] == 'drawn', (rc, ph, n))
    rc, o, ph, pg, n, J = run(src, {'tier': 2}, 0, tierrule=False)
    t('notierrule: a tier key with tierrule.py absent -> refused-tier2-tier, journalled, before the draw', rc == 2 and n == 0
      and ph == ['refused-tier2-tier'] and 'restore tierrule.py' in pg, (rc, o, ph, n))
    rc, o, ph, pg, n, J = run(src, {}, 0, tierrule=False)
    t('positive control: no tier key, tierrule.py absent -> drawn as today', rc == 0 and ph[-1] == 'drawn', (rc, o, ph))


MUTANTS = [
    ('      journal draw-short "drawrec drew nothing;', '      true || journal draw-short "drawrec drew nothing;'),
    ('      if [ $(( $(_now) - _DRAW_T0 )) -ge $(( T2_DRAW_MAX_H * 3600 )) ]; then',
     '      if [ $(( $(_now) - _DRAW_T0 )) -ge $(( T2_DRAW_MAX_H * 3600 * 2 )) ]; then'),
    ('        exit 2\n      fi\n    fi\n    # v33', '        true\n      fi\n    fi\n    # v33'),
    ("if isinstance(k, int) and 1 <= k < 4: w.append", "if isinstance(k, int) and k < 4: w.append"),
    ("if q and len(q) > 4: w.append", "if False: w.append"),
    ("if q is None: w.append", "if False: w.append"),
    ("    import tierrule; print('1' if tierrule.tier_of(r) == 2 else '')", "    print('')"),
    ('T2_DRAW_MAX_H=${CANARY_T2_DRAW_MAX_H:-12}', 'T2_DRAW_MAX_H=${CANARY_T2_DRAW_MAX_H:-24}'),
    ('  if [ -n "$TIER2" ] && [ "$(echo "$P" | tr \',\' \'\\n\' | grep -c .)" -ne 4 ]; then',
     '  if false; then'),
    ('    journal refused-tier2-tier "', '    true "'),
    ('  if [ -n "$TIER2" ]; then _WFOR="exactly four pools (tier 2)"; else _WFOR="two pools"; fi',
     '  _WFOR="two pools"'),
]


def main():
    src = open(LOOP).read()
    cases(src)
    ok = all(T)
    print('test_loop_tier2: %d/%d pass' % (sum(T), len(T)))
    if '--mutants' not in sys.argv:
        sys.exit(0 if ok else 1)
    fired = 0
    try:
        assert src.count('this anchor is absent') == 1, 'ANCHOR MISSING'
    except AssertionError:
        fired = 1
    assert fired, 'the anchor assertion did not fire on an absent anchor'
    print('positive control: the anchor assertion fires on an absent anchor')
    surv = 0
    import io, contextlib
    for old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r (%d)' % (old, src.count(old))
        del T[:]
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                cases(src.replace(old, new, 1))
            except Exception:
                T.append(False)
        killed = not all(T)
        print('  mutant %-72r %s' % (old.strip()[:72], 'killed' if killed else 'SURVIVED'))
        surv += not killed
    print('mutants: %d of %d killed' % (len(MUTANTS) - surv, len(MUTANTS)))
    sys.exit(0 if ok and not surv else 1)


if __name__ == '__main__':
    main()
