#!/usr/bin/env python3
"""test_loop_tier2.py <PATCHED canary-loop.sh> <tierrule.py> [--mutants] -- the loop's OWN tier-2 code, cut from the
patched canary-loop.sh (its TIER2 classification block and its whole draw block, from the draw_k preflight to `journal
drawn`) and run in bash with stubs for journal/page, a fake clock (`_now`, and `sleep` advancing it) and a stub drawrec
that draws nothing until a scripted clock value. Runs anywhere bash and python3 exist (no flock/timeout needed: the
bag-fix branch of the block is not entered). Nothing live is read or written.
  ready      tier 2, 4 pools at once        -> drawn, no draw-short
  late       tier 2, pools after 1 h        -> draw-short rows, then drawn
  bound      tier 2, never                  -> refused-tier2-draw at 12 h, exit 2, page names replace-variant + rearm
  tier3      no tier, pools after 1 h       -> drawn, NO draw-short (today's behaviour, positive control)
  drawk      tier 2 with draw_k 2           -> refused-tier2-k before any draw, exit 2
  notierrule a tier key, tierrule absent    -> refused before the draw (exit 2)"""
import json, os, re, shutil, subprocess, sys, tempfile

LOOP, TRM = sys.argv[1:3]
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-700:]))


def cut(src):
    a = src.index('TIER2=$(python3')
    b = src.index('\n', src.index('T2_DRAW_MAX_H=')) + 1
    c = src.index('  # a tier-2 registration that caps')
    e = src.index('\n', src.index('  journal drawn "$P :: ')) + 1
    return src[a:b], src[c:e]


STUB_DRAWREC = r'''#!/bin/bash
now=$(cat "$FIX_CLK")
echo "drawrec calls" >> "$FIX_CALLS"
if [ "$now" -ge "$FIX_DRAW_AT" ]; then
  echo "eligible [...]"; echo "DRAW (4 pools = 20 bots, owner C): ['board-a', 'board-b', 'hive-a', 'hive-b']"
else
  echo "eligible [...]"; echo "DRAW (none, owner C): NONE (fewer than 4 eligible)"
fi
'''


def run(src, reg, draw_at_s, tierrule=True, max_h=None):
    d = tempfile.mkdtemp(prefix='looptier2-')
    try:
        ma = os.path.join(d, 'mcai-analysis'); os.makedirs(os.path.join(ma, 'registrations'))
        if tierrule:
            shutil.copy(TRM, os.path.join(ma, 'tierrule.py'))
        regp = os.path.join(ma, 'registrations', 'r1.json'); json.dump(dict({'sha': 'x'}, **reg), open(regp, 'w'))
        open(os.path.join(ma, 'drawrec.sh'), 'w').write(STUB_DRAWREC)
        clk = os.path.join(d, 'clock'); open(clk, 'w').write('1000000')
        tier_block, draw_block = cut(src)
        harness = ('set -u\nH=%s; RUN=r1; REG=%s; J=%s/journal; PAGE=%s/page; touch $J $PAGE\n'
                   '_now() { cat "$FIX_CLK"; }\n'
                   'sleep() { echo $(( $(cat "$FIX_CLK") + $1 )) > "$FIX_CLK"; }\n'
                   'journal() { printf \'{"run":"%%s","phase":"%%s","note":%%s}\\n\' "$RUN" "$1" "$(python3 -c \'import json,sys; print(json.dumps(sys.argv[1]))\' "$2")" >> $J; }\n'
                   'page() { echo "$1 $2" >> $PAGE; }\n'
                   'BAGFIX=""\n%s\n%s\necho "DRAWN $P"\n') % (d, regp, d, d, tier_block, draw_block)
        hp = os.path.join(d, 'h.sh'); open(hp, 'w').write(harness)
        env = dict(os.environ, HOME=d, FIX_CLK=clk, FIX_DRAW_AT=str(1000000 + draw_at_s), FIX_CALLS=os.path.join(d, 'calls'),
                   PYTHONDONTWRITEBYTECODE='1')
        if max_h is not None:
            env['CANARY_T2_DRAW_MAX_H'] = str(max_h)
        r = subprocess.run(['bash', hp], capture_output=True, text=True, env=env, timeout=120)
        J = [json.loads(l) for l in open(os.path.join(d, 'journal')) if l.strip()]
        pages = open(os.path.join(d, 'page')).read()
        calls = len(open(os.path.join(d, 'calls')).read().splitlines()) if os.path.exists(os.path.join(d, 'calls')) else 0
        return r.returncode, r.stdout + r.stderr, [x['phase'] for x in J], pages, calls
    finally:
        shutil.rmtree(d, ignore_errors=True)


def cases(src):
    rc, o, ph, pg, n = run(src, {'tier': 2}, 0)
    t('ready: tier 2, 4 pools at once -> drawn, no draw-short', rc == 0 and 'DRAWN board-a' in o and 'draw-short' not in ph
      and ph[-1] == 'drawn', (rc, o, ph))
    rc, o, ph, pg, n = run(src, {'tier': 2}, 3600)
    t('late: tier 2, pools after 1 h -> draw-short rows, then drawn', rc == 0 and ph.count('draw-short') >= 2
      and ph[-1] == 'drawn', (rc, o, ph))
    rc, o, ph, pg, n = run(src, {'tier': 2}, 10 ** 9)
    t('bound: tier 2, never -> refused-tier2-draw, exit 2, nothing drawn', rc == 2 and ph[-1] == 'refused-tier2-draw'
      and 'drawn' not in ph, (rc, o, ph))
    t('bound: the refusal waited the full 12 h (>= 36 draws at 20 min) and not much more', 36 <= n <= 38, n)
    t('bound: the page names both remedies (re-register tier 3 via replace-variant; rearm)',
      'replace-variant' in pg and 'rearm' in pg and 'NOT deployed' in pg, pg)
    rc, o, ph, pg, n = run(src, {'tier': 2}, 10 ** 9, max_h=1)
    t('bound is the configured T2_DRAW_MAX_H (1 h in this fixture -> 3-4 draws)', rc == 2 and 3 <= n <= 5, (rc, n))
    rc, o, ph, pg, n = run(src, {}, 3600)
    t('tier3 positive control: no tier -> drawn after 1 h, NO draw-short (as today)', rc == 0 and 'draw-short' not in ph
      and ph[-1] == 'drawn', (rc, o, ph))
    rc, o, ph, pg, n = run(src, {'tier': 2, 'draw_k': 2}, 0)
    t('drawk: tier 2 with draw_k 2 -> refused before any draw', rc == 2 and ph == ['refused-tier2-k'] and n == 0, (rc, ph, n))
    rc, o, ph, pg, n = run(src, {'tier': 2}, 0, tierrule=False)
    t('notierrule: a tier key with tierrule.py absent -> refused before the draw', rc == 2 and n == 0 and ph == [], (rc, o, ph, n))
    rc, o, ph, pg, n = run(src, {}, 0, tierrule=False)
    t('positive control: no tier key, tierrule.py absent -> drawn as today', rc == 0 and ph[-1] == 'drawn', (rc, o, ph))


MUTANTS = [
    ('      journal draw-short "tier 2 needs exactly 4 pools', '      true || journal draw-short "tier 2 needs exactly 4 pools'),
    ('      if [ $(( $(_now) - _DRAW_T0 )) -ge $(( T2_DRAW_MAX_H * 3600 )) ]; then',
     '      if [ $(( $(_now) - _DRAW_T0 )) -ge $(( T2_DRAW_MAX_H * 3600 * 2 )) ]; then'),
    ('        exit 2\n      fi\n    fi', '        true\n      fi\n    fi'),
    ('  if [ -n "$TIER2" ] && python3 -c', '  if false && python3 -c'),
    ("    import tierrule; print('1' if tierrule.tier_of(r) == 2 else '')", "    print('')"),
    ('T2_DRAW_MAX_H=${CANARY_T2_DRAW_MAX_H:-12}', 'T2_DRAW_MAX_H=${CANARY_T2_DRAW_MAX_H:-24}'),
]


def main():
    src = open(LOOP).read()
    cases(src)
    ok = all(T)
    print('test_loop_tier2: %d/%d pass' % (sum(T), len(T)))
    if '--mutants' not in sys.argv:
        sys.exit(0 if ok else 1)
    surv = 0
    import io, contextlib
    for old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r (%d)' % (old, src.count(old))
        del T[:]
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                cases(src.replace(old, new, 1))
            except Exception as e:
                T.append(False)
        killed = not all(T)
        print('  mutant %-72r %s' % (old.strip()[:72], 'killed' if killed else 'SURVIVED'))
        surv += not killed
    print('mutants: %d of %d killed' % (len(MUTANTS) - surv, len(MUTANTS)))
    sys.exit(0 if ok and not surv else 1)


if __name__ == '__main__':
    main()
