#!/usr/bin/env python3
"""patch_drawrec_exposure.py <drawrec.sh in> <drawrec.sh out> -- make drawrec.sh's exposure filter FAIL CLOSED.

WHY (Codex r2/r4 on the canary scheduler, docs/reports/canary-throughput-2026-10-08.md section F). drawrec.sh runs
drawexposure.py for the run and, when no `eligible on exposure:` line comes back, prints "no requirement declared ...
v8 filter only" -- so a CRASH of drawexposure.py (or an unreadable registration) silently removes the exposure
restriction of a registration that DECLARED one, and the canary draws pools that cannot expose its change. That is the
recovery-ladder-13c failure the exposure guard exists to prevent.

THE PATCH (anchored, applied to whatever drawrec.sh is LIVE at install time, so another agent's edits elsewhere survive):
  * an `eligible on exposure:` line counts only with drawexposure's exit status 0 or 2 (its two answering exits);
  * no usable answer + the registration DECLARES draw_exposure (or cannot be read) -> ALLOWED = [] (no pool eligible:
    the loop keeps redrawing every 20 min and the scheduler pages the stall), printing why;
  * no usable answer + the registration declares none -> exactly today's behaviour.
Nothing else changes; the `TARGET_K = 4` line (grepped by the loop's bag-fix preflight) is asserted byte-identical.
"""
import sys

OLD = """    _l = [x for x in _r.stdout.splitlines() if x.startswith('eligible on exposure:')]
    if _l:
        _v = _l[0].split(':', 1)[1].strip()
        ALLOWED = [] if _v == 'NONE' else _ast.literal_eval(_v)
        print('draw_exposure:', RUN, 'pools able to expose this change:', ALLOWED)
    else:
        print('draw_exposure: no requirement declared for', RUN, '-- v8 filter only')
"""
NEW = """    _l = [x for x in _r.stdout.splitlines() if x.startswith('eligible on exposure:')]
    # FAIL CLOSED (2026-10-08, canary scheduler review): a crash used to read as "no requirement".
    try:
        _rp = os.path.expanduser('~/mcai-analysis/registrations/%s.json' % RUN)
        if not os.path.exists(_rp):
            _rp = '/tmp/registrations/%s.json' % RUN
        _declared = bool(json.load(open(_rp)).get('draw_exposure'))
    except Exception:
        _declared = True
    if _l and _r.returncode in (0, 2):
        _v = _l[0].split(':', 1)[1].strip()
        ALLOWED = [] if _v == 'NONE' else _ast.literal_eval(_v)
        print('draw_exposure:', RUN, 'pools able to expose this change:', ALLOWED)
    elif _declared:
        ALLOWED = []
        print('draw_exposure: REFUSED for', RUN, '-- it declares draw_exposure (or its registration is unreadable) and '
              'drawexposure.py gave no usable answer (exit %s): %s' % (_r.returncode, ' '.join((_r.stdout + _r.stderr).split())[-200:]))
    else:
        print('draw_exposure: no requirement declared for', RUN, '-- v8 filter only')
"""
MARK = '# FAIL CLOSED (2026-10-08, canary scheduler review)'


def patch(src):
    if MARK in src:
        return src, 'already patched'
    n = src.count(OLD)
    if n != 1:
        raise SystemExit('ANCHOR %s in drawrec.sh (%d matches): not patching -- re-merge by hand'
                         % ('MISSING' if n == 0 else 'NOT UNIQUE', n))
    if 'import json' not in src.split(OLD)[0]:
        raise SystemExit('json is not imported before the exposure block: not patching')
    out = src.replace(OLD, NEW, 1)
    k0 = [l for l in src.splitlines() if l.startswith('TARGET_K = ')]
    k1 = [l for l in out.splitlines() if l.startswith('TARGET_K = ')]
    assert k0 == k1 and len(k1) == 1, 'TARGET_K line changed'
    return out, 'patched'


if __name__ == '__main__':
    src = open(sys.argv[1]).read()
    out, what = patch(src)
    open(sys.argv[2], 'w').write(out)
    print(what)
