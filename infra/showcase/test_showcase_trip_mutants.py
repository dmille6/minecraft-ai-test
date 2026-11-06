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
    # the verdict: an S6 zone defect (H3) no longer HARM
    ("            (harm if k in HARM_GATES else report).append('S6 %s %d' % (k, v))", "            report.append('S6 %s %d' % (k, v))",
     'protected box is HARM'),
    # the verdict: every S6 defect HARM again (conformance stops the world)
    ("            (harm if k in HARM_GATES else report).append('S6 %s %d' % (k, v))", "            harm.append('S6 %s %d' % (k, v))",
     'REPORT'),
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
    # fun mode 10-28: tree debris no longer split out of H2 (a floating leaf is a defect again)
    ("    items, debris = h2_debris_split(defect_items(defects, items))", "    items, debris = defect_items(defects, items), []", 'tree debris is REPORTED'),
    # ---- phase 1 item 4 (stop only for harm; docs/reports/phase1-showcase-design-2026-11-06.md)
    # the Gale gap reopened: a row without a position restarts the spell
    ("        if not isinstance(p, dict) or any(p.get(k) is None for k in ('x', 'y', 'z')):\n            continue\n", "", 'Gale'),
    # S5 plan conformance HARM again
    ("            (harm if k in HARM_GATES else report).append('S5 %s %d' % (k, v))", "            harm.append('S5 %s %d' % (k, v))", 'a REPORT'),
    # G5 zone no longer HARM
    ("HARM_GATES = ('H3 zone', 'G5 zone')", "HARM_GATES = ('H3 zone',)", 'found placement inside a zone is HARM'),
    # Z1: one trapped bot stops the world again
    ("        if len(f['trapped']) >= ZONE_TRAP_WORLD:", "        if len(f['trapped']) >= 1:", 'QUARANTINED'),
    # Z1: no bot count ever stops the world
    ("        if len(f['trapped']) >= ZONE_TRAP_WORLD:", "        if False:", 'systemic'),
    # Z1: the trapped bot is not handed to the quarantine
    ("            quarantine.extend(sorted(f['trapped']))\n", "", 'QUARANTINED'),
    # S7: a crash loop is only a WATCH
    ("        harm.append('S7 crash loop", "        watch.append('S7 crash loop", 'crash loop is HARM'),
    # S7: an unreadable journal reads OK
    ("        watch.append('S7 crash loops not judged: %s' % cr['error'])", "        pass", 'unreadable journal'),
    # S7: the 60-min span ignored (spread-out restarts count)
    ("            while ts_[i] - ts_[j] > span_min * 60:", "            while ts_[i] - ts_[j] > span_min * 6000:", 'spread out'),
    # S7: FIXTURE counted
    ("        if not m or 'FIXTURE' in m.group(1):", "        if not m:", 'spread out'),
    # S0: an empty enabled roster still trips
    ("    elif f['live_bots'] == 0 and f['expect_running'] and expected > 0:", "    elif f['live_bots'] == 0 and f['expect_running']:",
     'no enabled unit'),
    # S0: the enabled roster ignored (a quarantined unit is a WATCH forever)
    ("    expected = f.get('expected_bots', len(NAMES))", "    expected = len(NAMES)", 'quarantined (disabled) unit'),
    # fun mode 10-28: EVERY H2 item treated as debris (a dirt clear outside the record no longer trips)
    ("TREE_DEBRIS.match(parts[-1]) else keep).append(x)", "True else keep).append(x)", 'still TRIPs'),
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
