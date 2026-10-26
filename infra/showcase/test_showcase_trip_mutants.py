#!/usr/bin/env python3
"""Mutants for the tripwire's S6 SHOP section (showcase_trip.py): each must make `showcase_trip.py selftest` FAIL BY ASSERTION.
The selftest needs the reads beside the file, as installed: townplanread.py, foundread.py (scripts/host), lib/telemetry.py, and
shopread.py -- the workshop's read, which lives on the shop branch, not on main: pass its path, or a git ref holding it.
Every anchor is asserted present and unique before it is replaced (CLAUDE.md: a mutant that silently fails to apply reads as
killed). A control run (no mutant) must pass first.

    python3 infra/showcase/test_showcase_trip_mutants.py --shopread <path to shopread.py>
    python3 infra/showcase/test_showcase_trip_mutants.py --shopread-ref <git ref>     (docs/reports/shop-01-2026-10-25/shopread.py.txt)
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SHOPREAD_DOC = 'docs/reports/shop-01-2026-10-25/shopread.py.txt'

MUTANTS = [
    # the verdict: an S6 defect no longer trips
    ("            trip.append('S6 %s %d' % (k, v))", "            watch.append('S6 %s %d' % (k, v))", 'an off-record placement TRIPs'),
    # the verdict: the WATCH lines are dropped
    ("            watch.append('S6 %s %s' % (k, v))", "            pass", 'STALLED'),
    # the run window: every stuck row ever is a WATCH
    ("    recent = [r for r in rows if r['name'] == '_build' and r['t'] >= run_since]",
     "    recent = [r for r in rows if r['name'] == '_build']", 'not judged again'),
    # the stall flag ignored
    ("        if f.get('op') == 'stuck_on_cell' and f.get('stalled') == 'true':", "        if False:", 'stuck_on_cell'),
    # a gate dropped from the TRIP set
    ("('H6 bag_loss', 'bag_loss'),\n", "\n", 'H6'),
    # H8: a failing survey not counted
    ("    conf = [x for x in lists.get('conformance', []) if ': newest survey F1 ' in x]", "    conf = []", 'survey that fails F1'),
    # an unjudged workshop reads OK
    ("    if unjudged:\n        watch['conformance UNJUDGED'] = unjudged[:3]\n", "", 'UNJUDGED'),
    # the plan's zones not handed to the shop read
    ("{POOL: list(zones)}", "{POOL: []}", 'protected box'),
    # plan_rows: the shop kinds not streamed
    ("    kinds = set(TP.ROW_KINDS) | set(FD.ROW_KINDS) | shop_kinds()", "    kinds = set(TP.ROW_KINDS) | set(FD.ROW_KINDS)", 'plan_rows'),
    # plan_rows: no feet on the shop rows (G6 blind)
    ("                    row['feet'] = feet_of((d.get('bot') or {}).get('pos'))", "                    row['feet'] = None", 'plan_rows'),
    # the shared pool not applied to shopread (every bot its own pool: the record never matches)
    ("    with showcase_pools(TP, SR):", "    with showcase_pools(TP):", 'record cell'),
    # r2 (Codex + Claude S6 r1): a failed shop read prunes the shop acks
    ("                report['items'] = dict(report['items'], **{g: list(ackd.get(g, [])) for g in SHOP_GATES if ackd.get(g)})",
     "                pass", 'keeps the shop acks'),
    # r2: feet by a plain floor, not shopread's pos_of
    ("        return SR.pos_of({'pos': pos}) if SR else None",
     "        return [math.floor(float(pos[k])) for k in ('x', 'y', 'z')] if SR and isinstance(pos, dict) else None", 'feet'),
    # r2: only ImportError isolated (a SyntaxError in shopread takes the S5 read down)
    ("    except BaseException as e:          # noqa: B036", "    except ImportError as e:          # noqa: B036", 'must not abort the S5 read'),
    # r2: ack no longer refuses on a broken shopread
    ("    if shop_module()[0] is None:\n        print('REFUSED: shopread unusable", "    if False:\n        print('REFUSED: shopread unusable", 'ack refuses LOUDLY'),
]


def env(shopread):
    d = tempfile.mkdtemp(prefix='tripmut-')
    os.makedirs(os.path.join(d, 'lib'))
    shutil.copy(os.path.join(HERE, 'showcase_trip.py'), d)
    for f in ('townplanread.py', 'foundread.py'):
        shutil.copy(os.path.join(ROOT, 'scripts', 'host', f), d)
    shutil.copy(os.path.join(ROOT, 'scripts', 'lib', 'telemetry.py'), os.path.join(d, 'lib'))
    open(os.path.join(d, 'lib', '__init__.py'), 'a').close()
    shutil.copy(shopread, os.path.join(d, 'shopread.py'))
    return d


def run(d):
    p = subprocess.run([sys.executable, 'showcase_trip.py', 'selftest'], cwd=d, capture_output=True, text=True, timeout=300)
    return p.returncode, p.stdout + p.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shopread')
    ap.add_argument('--shopread-ref')
    a = ap.parse_args()
    tmp = None
    if a.shopread:
        sr = a.shopread
    elif a.shopread_ref:
        tmp = tempfile.mkdtemp(prefix='shopread-')
        sr = os.path.join(tmp, 'shopread.py')
        with open(sr, 'w') as f:
            f.write(subprocess.run(['git', '-C', ROOT, 'show', '%s:%s' % (a.shopread_ref, SHOPREAD_DOC)], capture_output=True,
                                   text=True, check=True).stdout)
    else:
        ap.error('--shopread or --shopread-ref is required (shopread.py is not on main)')
    d = env(sr)
    rc, out = run(d)
    assert rc == 0 and 'S6 shop checked' in out, 'CONTROL: the selftest must pass with S6 checked:\n' + out[-1500:]
    src = open(os.path.join(d, 'showcase_trip.py')).read()
    killed = 0
    for old, new, want in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR missing or not unique: %r' % old[:80]
        open(os.path.join(d, 'showcase_trip.py'), 'w').write(src.replace(old, new))
        rc, out = run(d)
        ok = rc != 0 and 'AssertionError' in out and want in out
        killed += ok
        print('  %s  %s  (expected: %s)' % ('KILLED ' if ok else 'SURVIVED', old.strip()[:70], want))
        if not ok:
            print(out[-800:])
    open(os.path.join(d, 'showcase_trip.py'), 'w').write(src)
    shutil.rmtree(d, ignore_errors=True)
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
    print('%d of %d mutants killed' % (killed, len(MUTANTS)))
    return 0 if killed == len(MUTANTS) else 1


if __name__ == '__main__':
    sys.exit(main())
