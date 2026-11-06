#!/usr/bin/env python3
"""test_drawpin.py -- the PINNED draw (draw_pin_pools + draw_pin_owner_ok; owner 11-06), on the REAL drawrec.sh Python block
against test_drawrequire.py's fixture (a rewritten /tmp/drawrec.txt, HOME = a fixture tree), the pick parsed by the LOOP'S
OWN pipeline cut from canary-loop.sh. Mutants on copies (anchors asserted present and unique) after an unmutated control.

    python3 scripts/test_drawpin.py          (exit 1 on any failure)
"""
import os, re, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_drawrequire as TD  # noqa: E402  (its harness: run(), POOLS, the loop pipeline)

DRAWREC, LOOP, DRQ = TD.DRAWREC, TD.LOOP, TD.DRQ
DPN = TD.find('drawpin.py')
T = []
OK = 'owner 11-06 ~14:00Z: "draw isolated-d for escdead-01" (the memory experiment is retired)'


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-700:]))


def run(drawrec, dpn, reg, **kw):
    h = tempfile.mkdtemp(prefix='drawpin-')
    try:
        os.makedirs(os.path.join(h, 'mcai-analysis'), exist_ok=True)
        shutil.copy(dpn, os.path.join(h, 'mcai-analysis', 'drawpin.py'))
        return TD.run(drawrec, DRQ, reg=reg, home=h, **kw)
    finally:
        shutil.rmtree(h, ignore_errors=True)


def cases(drawrec, dpn, loop_src):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    FUN = {'lab': False}
    PIN = dict(FUN, draw_pin_pools=['isolated-a', 'hive-c'], draw_pin_owner_ok=OK)
    for _ in range(2):
        P, o = run(drawrec, dpn, PIN)
        c('fun mode: the pin is the WHOLE draw (isolated-a + hive-c, nothing else)', sorted(P) == ['hive-c', 'isolated-a'], (P, o))
    P, o = run(drawrec, dpn, dict(PIN, draw_pin_owner_ok=None))
    c('isolated-* pinned WITHOUT the owner OK -> NO draw, refused', P == [] and 'draw_pin_pools REFUSED' in o and 'owner' in o, (P, o))
    P, o = run(drawrec, dpn, dict(PIN, draw_pin_owner_ok='ok'))
    c('an owner OK too short to be the owner\'s words -> NO draw', P == [] and 'REFUSED' in o, (P, o))
    P, o = run(drawrec, dpn, dict(FUN, draw_pin_pools=['placebo-c'], draw_pin_owner_ok=OK))
    c('placebo-c pinned with the owner OK -> drawn alone', P == ['placebo-c'], (P, o))
    P, o = run(drawrec, dpn, dict(FUN, draw_pin_pools=['board-b', 'hive-b', 'placebo-a']))
    c('treefarm-05 shape: board-b, hive-b, placebo-a need no owner OK -> exactly those three',
      sorted(P) == ['board-b', 'hive-b', 'placebo-a'], (P, o))
    P, o = run(drawrec, dpn, PIN, ledger=[('hive-c', 'KEEP', 2), ('isolated-a', 'KEEP', 3)])
    c('pinned pools inside their 12-h ledger window are still drawn (not a hard exclusion)', sorted(P) == ['hive-c', 'isolated-a'], (P, o))
    P, o = run(drawrec, dpn, PIN, manifest_pool='hive-c,board-a')
    c('a pinned pool is the LIVE canary -> NO draw (waits, never a substitute)', P == [] and 'excluded' in o, (P, o))
    P, o = run(drawrec, dpn, PIN, manual='isolated-a')
    c('a pinned pool is manually excluded -> NO draw', P == [] and 'excluded' in o, (P, o))
    P, o = run(drawrec, dpn, PIN, drop=('hive-c',))
    c('a pinned pool with no band row and no live logs -> NO draw', P == [] and 'not live' in o, (P, o))
    lg = tempfile.mkdtemp(prefix='drawpin-logs-')
    try:
        for b in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'):
            os.makedirs(os.path.join(lg, 'isolated-d-' + b))
            open(os.path.join(lg, 'isolated-d-' + b, 'skill-isolated-d-%s.jsonl' % b), 'w').write(
                '{"@timestamp": "%s"}\n' % TD.NOW.strftime('%Y-%m-%dT%H:%M:%S.000Z'))
        PD = dict(PIN, draw_pin_pools=['isolated-d', 'hive-c'])
        P, o = run(drawrec, dpn, PD, env={'DRAWREC_LOG_ROOT': lg})
        c('isolated-d (no band row: poolrank2 lists no isolated pool) with five fresh bot logs -> drawn', sorted(P) == ['hive-c', 'isolated-d'], (P, o))
        import datetime as _dt
        open(os.path.join(lg, 'isolated-d-Echo', 'skill-isolated-d-Echo.jsonl'), 'w').write(
            '{"@timestamp": "%s"}\n' % (TD.NOW - _dt.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))
        P, o = run(drawrec, dpn, PD, env={'DRAWREC_LOG_ROOT': lg})
        c('one bot\'s newest ROW an hour old (its file freshly touched, as a copytruncate rotation does) -> NO draw',
          P == [] and 'not live' in o, (P, o))
        shutil.rmtree(os.path.join(lg, 'isolated-d-Echo'))
        P, o = run(drawrec, dpn, PD, env={'DRAWREC_LOG_ROOT': lg})
        c('four bot dirs, not five -> NO draw', P == [] and 'not live' in o, (P, o))
    finally:
        shutil.rmtree(lg, ignore_errors=True)
    P, o = run(drawrec, dpn, PIN, env={'DRAW_FUN_FALLBACK': '1'})
    c('the fun fallback does not change a pinned draw', sorted(P) == ['hive-c', 'isolated-a'], (P, o))
    P, o = run(drawrec, dpn, dict(PIN, draw_pin_pools=['hive-d']))
    c('a pinned pool out of band and below the exposure filter is still drawn', P == ['hive-d'], (P, o))
    P, o = run(drawrec, dpn, dict(PIN, draw_require_pools=['hive-d']))
    c('pin AND require -> refused (one way to say the pools)', P == [] and 'draw_pin_pools REFUSED' in o, (P, o))
    P, o = run(drawrec, dpn, dict(FUN, draw_pin_pools='hive-c'))
    c('a malformed pin (a string) -> NO draw', P == [] and 'draw_pin_pools REFUSED' in o, (P, o))
    P, o = run(drawrec, dpn, dict(FUN, draw_pin_pools=['board-a', 'board-b', 'board-c', 'board-d', 'hive-a']))
    c('five pins (> the 4-pool cap) -> NO draw', P == [] and 'at most 4' in o, (P, o))
    P, o = run(drawrec, dpn, dict(PIN, draw_k=1))
    c('two pins under draw_k 1 -> NO draw', P == [] and 'at most 1' in o, (P, o))
    P, o = run(drawrec, dpn, dict(PIN, **{'class': 'model-env'}))
    c('a model-env registration without draw_k (cap 0) -> NO draw', P == [], (P, o))
    P, o = run(drawrec, dpn, dict(PIN, lab=True))
    c('lab mode honours the pin too', sorted(P) == ['hive-c', 'isolated-a'], (P, o))
    P, o = run(drawrec, dpn, dict(FUN))
    c('no pin: the ordinary draw, never isolated/placebo-c', P and not any(p.startswith('isolated') or p == 'placebo-c' for p in P), (P, o))
    # the loop: a pinned run never takes the 30-min fallback (it would exit `draw-failed` instead of waiting)
    code = re.sub(r'(?m)^\s*#.*$', '', loop_src)
    c('canary-loop.sh: the fallback is gated on no pin', re.search(
        r'\[ -n "\$FUN" \] && \[ -z "\$PIN" \] && \[ \$\(\( \$\(_now\) - _D0 \)\) -ge \$\(\( FUN_DRAW_CAP_MIN \* 60 \)\) \] && FB=1', code))
    m = re.search(r'(?m)^\s*PIN=\$\((python3 -c "[^\n]*")\)$', code)
    c('canary-loop.sh: PIN is read from the registration', m)
    if m:
        import json as _j, subprocess as _sp
        d = tempfile.mkdtemp(prefix='drawpin-loop-')
        try:
            for name, reg, want in (('null', {'draw_pin_pools': None}, ''), ('absent', {}, ''),
                                    ('set', {'draw_pin_pools': ['hive-c']}, "['hive-c']"),
                                    ('malformed empty string', {'draw_pin_pools': ''}, "''"),
                                    ('malformed empty list', {'draw_pin_pools': []}, '[]')):
                rp = os.path.join(d, 'r.json'); _j.dump(reg, open(rp, 'w'))
                got = _sp.run(['bash', '-c', 'REG=%s; echo "$(%s)"' % (rp, m.group(1))], capture_output=True, text=True).stdout.strip()
                c('canary-loop.sh: a pin %s reads as %r (null/absent keep the fun fallback; a malformed one waits, never falls back: Claude + Codex reviews)' % (name, want), got == want, got)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    return out


MUTANTS = [
    ('drawpin.py', 'no owner OK needed', "    if gated and not (isinstance(ok, str) and len(ok.strip()) >= OK_MIN_LEN):", "    if False:"),
    ('drawpin.py', 'hard exclusion ignored', "        if p in hard_excluded:\n", "        if False:\n"),
    ('drawpin.py', 'no band row accepted', "        if p not in band_pools:\n", "        if False:\n"),
    ('drawpin.py', 'a stale bot row counts as live', "            if t is None or now - t > dt.timedelta(minutes=fresh_min):", "            if t is None:"),
    ('drawpin.py', 'any number of bot dirs', "        if len(dirs) != bots:\n            return False", "        if not dirs:\n            return False"),
    ('drawpin.py', 'cap ignored', "    if cap < 1 or len(pins) > cap:", "    if False:"),
    ('drawpin.py', 'pin + require accepted', "    if reg.get('draw_require_pools') is not None:\n        return None", "    if False:\n        return None"),
    ('drawpin.py', 'malformed accepted', "    if not isinstance(v, list) or not v or not all(", "    if False and not all("),
    ('drawrec.sh', 'the pin never applied', "    if isinstance(_pr, dict) and _pr.get('draw_pin_pools') is not None:",
     "    if False:"),
    ('drawrec.sh', 'the 12-h window applied to pins', "            pick, _pwhy = _DPN.pick(_PIN, _hard, _live, TARGET_K)",
     "            pick, _pwhy = _DPN.pick(_PIN, excl, _live, TARGET_K)"),
    ('drawrec.sh', 'a log-live pool without a band row is never drawn', "            _live = set(band) | {p for p in _PIN if _DPN.pool_fresh(_LOGS, p, now)}",
     "            _live = set(band)"),
    ('drawrec.sh', 'a refused pin still draws', "        if _PIN is None:\n            pick = None;", "        if False:\n            pick = None;"),
    ('canary-loop.sh', 'a null pin reads as a pin', "print('' if v is None else (v or repr(v)))", "print(v)"),
    ('canary-loop.sh', 'a malformed empty pin reads as no pin', "print('' if v is None else (v or repr(v)))", "print('' if v is None else v)"),
    ('canary-loop.sh', 'a pinned run takes the fallback', '[ -n "$FUN" ] && [ -z "$PIN" ] && [ $(( $(_now)', '[ -n "$FUN" ] && [ $(( $(_now)'),
]

if __name__ == '__main__':
    for n, ok, d in cases(DRAWREC, DPN, open(LOOP).read()):
        t(n, ok, d)
    ok_all = all(T)
    FILES = {'drawrec.sh': DRAWREC, 'drawpin.py': DPN, 'canary-loop.sh': LOOP}
    tmp = tempfile.mkdtemp(prefix='drawpin-m-')
    for f, name, old, new in MUTANTS:
        src = open(FILES[f]).read()
        assert src.count(old) == 1, 'ANCHOR %s: %s (%d)' % (f, name, src.count(old))
        if not ok_all:
            t('mutant NOT SCORED: ' + name, False); continue
        mp = dict(FILES)
        mp[f] = os.path.join(tmp, f)
        open(mp[f], 'w').write(src.replace(old, new, 1))
        try:
            killed = not all(ok for _n, ok, _d in cases(mp['drawrec.sh'], mp['drawpin.py'], open(mp['canary-loop.sh']).read()))
        except Exception:
            killed = True
        t('mutant killed: %s: %s' % (f, name), killed, 'SURVIVED')
    shutil.rmtree(tmp, ignore_errors=True)
    print('\n%d/%d pass' % (sum(T), len(T)))
    sys.exit(0 if all(T) else 1)
