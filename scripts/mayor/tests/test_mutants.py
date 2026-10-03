"""Mutants, run against the WHOLE SUITE. Each mutant edits one decision in a temp copy of
scripts/mayor (never the source tree), runs every test there in a subprocess, and must turn the
suite red. A mutant whose anchor is missing or not unique raises instead of silently "killing"
nothing (CLAUDE.md: mutants assert their anchor).

    python3 scripts/mayor/tests/test_mutants.py --report     # every mutant and the tests it broke
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
IN_MUTANT = os.environ.get('MAYOR_IN_MUTANT') == '1'

C, SH, SC, FR, IO = 'mayor_core.py', 'mayor_shadow.py', 'mayor_score.py', 'mayor_frontier.py', 'mayor_io.py'
MUTANTS = [
    # eligibility
    ('trapped bots eligible', C, "    if bot.get('trapped'):\n", "    if False:\n"),
    ('stale bots eligible', C, "    if not bot.get('fresh'):\n", "    if False:\n"),
    ('log height ignored', C, " and abs(r['y'] - pos['y']) <= cfg['log_v']]", "]"),
    ('log age ignored', C, "LOG_RE.search(r['kind']) and r['age_h'] <= cfg['log_age_h']", "LOG_RE.search(r['kind'])"),
    ('GET_WOOD room ignored', C, "if bot['free_slots_est'] < cfg['wood_min_free']:", "if False:"),
    ('deposit without bank proof', C, "if dep_free > 0 and bank.get('accepts_recently'):", "if dep_free > 0:"),
    ('iron without a trip pick', C, "if bot['stone_pick_uses'] < cfg['iron_trip_uses']:", "if False:"),
    ('no table needed', C, "need_table = 0 if bot['has_table'] else 4", "need_table = 0"),
    # freshness, lookahead, certainty
    ('fresh from any row', C, "'fresh': st.full is not None and pos_age is not None and -MAX_SKEW_MS / 1000 <= pos_age <= cfg['stale_s'],",
     "'fresh': st.full is not None and age is not None and age <= cfg['stale_s'],"),
    ('future rows accepted', C, "    if now_ms is not None and t > now_ms + MAX_SKEW_MS:", "    if False:"),
    ('facts lookahead', C, "if not r.get('last') or r['last'] > now_ms:", "if not r.get('last'):"),
    ('iron shortage definite', C, "'unknown-bank' if s['duty'] == 'GET_IRON' else 'definite'", "'definite'"),
    # deterministic mayor
    ('world cap removed', C, "        elif len(taken_bots) >= cfg['cap_per_world']:\n            why = 'cap_world'", "        elif False:\n            why = 'cap_world'"),
    ('per-duty cap removed', C, "        elif per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:\n            why = 'cap_duty'\n        elif c['targets']:",
     "        elif c['targets']:"),
    ('cooldown ignored', C, "        elif '%s|%s' % (c['bot_name'], c['duty']) in cool:\n", "        elif False:\n"),
    ('no hysteresis', C, "    for name in sorted(leases, key=lambda n: (leases[n].get('since_ms', 0), n)):", "    for name in []:"),
    ('lease never expires', C, "        if now - L['since_ms'] >= cfg['lease_s'] * 1000:\n            release(name, L, 'expired')",
     "        if False:\n            release(name, L, 'expired')"),
    ('duty_done always False', C, "    if duty == 'FREE_BAG':\n        return bot['slots_est'] < cfg['full_slots']",
     "    return False\n    if duty == 'FREE_BAG':\n        return bot['slots_est'] < cfg['full_slots']"),
    ('distance ranking reversed', C, "(DUTY_RANK[c['duty']], c['dist'] if c['dist'] is not None else 0.0,",
     "(DUTY_RANK[c['duty']], -c['dist'] if c['dist'] is not None else 0.0,"),
    ('lease keeps its R-id, not its place', C, "tgt = id_of_key.get(L.get('target_key'))", "tgt = L.get('target')"),
    ('held leases may share a target', C, "            if tgt in taken_targets:\n                release(name, L, 'conflict')",
     "            if False:\n                release(name, L, 'conflict')"),
    ('held leases ignore caps', C, "        if len(taken_bots) >= cfg['cap_per_world'] or per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:\n            release(name, L, 'over_cap')",
     "        if False:\n            release(name, L, 'over_cap')"),
    # validator
    ('validator: unknown candidate accepted', C, "        if c is None:\n            why = 'unknown_candidate'", "        if c is None:\n            continue"),
    ('validator: invented target accepted', C, "        elif tgt is not None and tgt not in c['targets']:", "        elif False:"),
    ('validator: duplicate target accepted', C, "        elif tgt is not None and tgt in targets_used:", "        elif False:"),
    ('validator: unknown evidence accepted', C, "        elif cited - known:", "        elif False:"),
    ('validator: caps ignored', C, "        elif per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:\n            why = 'cap_duty'\n        elif len(bots_used)",
     "        elif False:\n            why = 'cap_duty'\n        elif len(bots_used)"),
    ('validator: world cap ignored', C, "        elif len(bots_used) >= cfg['cap_per_world']:\n            why = 'cap_world'", "        elif False:\n            why = 'cap_world'"),
    ('validator: item schema skipped', C, "        bad = schema_errors(a, item_schema, '$.assignments[]')", "        bad = []"),
    ('validator: extra keys allowed', C, "        if sch.get('additionalProperties') is False:", "        if False:"),
    # shadow process
    ('tail: no first-bytes fingerprint', SH, "                if not rotated and self.head:", "                if False:"),
    ('replay by start, not availability', SH, "    return t + (int(d.group(1)) if d else 0)", "    return t"),
    ('replay snapshots unmarked', SH, "        if replay:\n            snap['replay'] = True", "        if False:\n            snap['replay'] = True"),
    ('vanished files never evicted', SH, "            if tail.missing_ms is not None and wall - tail.missing_ms > a.evict_file_min * 60000:", "            if False:"),
    ('output cap off', SH, "        if used > cap:", "        if False:"),
    ('out dir: bot trees allowed', IO, "            if _under(real, b):", "            if False:"),
    ('out dir: symlinks followed', IO, "_FLAGS_APPEND = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)",
     "_FLAGS_APPEND = os.O_WRONLY | os.O_APPEND | os.O_CREAT"),
    # scorer
    ('scorer: silence counted as failure', SC, "            if not done30 and not observed(seq, t, t + 30 * MIN, gap):", "            if False:"),
    ('scorer: eligibility through not required', SC, "            if not through:", "            if False:"),
    ('scorer: unknown-bank in the gap', SC, "            if sh.get('certainty', 'definite') != 'definite':", "            if False:"),
    ('scorer: rejections not in exec denominator', SC, "            m['rejected'] += 1\n            m['exec_n'] += 1", "            m['rejected'] += 1"),
    ('scorer: replay not refused', SC, "    if args.replay_only and not n_replay or not args.replay_only and not n_live:", "    if False:"),
    ('scorer: ratio not against random', SC, "            m['x_random'] = (ds / rr) if ds is not None and rr else None", "            m['x_random'] = ds"),
    # frontier
    ('frontier: timeouts not charged', FR, "                    cost += ledger.charge(worst)", "                    pass"),
    ('frontier: error body persisted', FR, "        raise ProviderError(e.code, _error_code(raw)) from None",
     "        raise ProviderError(e.code, raw.decode()) from None"),
]


def apply(root, fname, old, new):
    path = os.path.join(root, fname)
    with open(path) as f:
        src = f.read()
    assert old in src, 'ANCHOR MISSING in %s: %r' % (fname, old)
    assert src.count(old) == 1, 'ANCHOR NOT UNIQUE in %s (%d): %r' % (fname, src.count(old), old)
    with open(path, 'w') as f:
        f.write(src.replace(old, new, 1))


def run_suite(root):
    env = dict(os.environ, MAYOR_IN_MUTANT='1', PYTHONDONTWRITEBYTECODE='1')
    p = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', os.path.join(root, 'tests')],
                       env=env, capture_output=True, text=True, timeout=300, cwd=root)
    broke = sorted(set(re.findall(r'^(?:FAIL|ERROR): (\w+)', p.stderr, re.M)))
    return p.returncode, broke, p.stderr


def mutant_copy(fname, old, new):
    d = tempfile.mkdtemp()
    root = os.path.join(d, 'mayor')
    shutil.copytree(PKG, root, ignore=shutil.ignore_patterns('__pycache__'))
    apply(root, fname, old, new)
    return d, root


@unittest.skipIf(IN_MUTANT, 'inside a mutant run')
class Mutants(unittest.TestCase):
    def test_the_unmutated_copy_is_green(self):
        d = tempfile.mkdtemp()
        try:
            root = os.path.join(d, 'mayor')
            shutil.copytree(PKG, root, ignore=shutil.ignore_patterns('__pycache__'))
            rc, broke, err = run_suite(root)
            self.assertEqual(rc, 0, 'positive control: the suite is green on an unmutated copy\n' + err[-2000:])
        finally:
            shutil.rmtree(d)

    def test_every_mutant_turns_the_suite_red(self):
        for name, fname, old, new in MUTANTS:
            with self.subTest(mutant=name):
                d, root = mutant_copy(fname, old, new)
                try:
                    rc, broke, _ = run_suite(root)
                finally:
                    shutil.rmtree(d)
                self.assertNotEqual(rc, 0, 'SURVIVED: %s' % name)
                self.assertTrue(broke, 'red without a named failing test: %s' % name)

    def test_anchor_guard_raises(self):
        d = tempfile.mkdtemp()
        try:
            shutil.copytree(PKG, os.path.join(d, 'm'), ignore=shutil.ignore_patterns('__pycache__'))
            with self.assertRaises(AssertionError):
                apply(os.path.join(d, 'm'), C, 'this text is not in the file', 'x')
            with self.assertRaises(AssertionError):
                apply(os.path.join(d, 'm'), C, "'FREE_BAG'", 'x')            # many times: not unique
        finally:
            shutil.rmtree(d)


if __name__ == '__main__' and '--report' in sys.argv:
    dead = 0
    for name, fname, old, new in MUTANTS:
        d, root = mutant_copy(fname, old, new)
        try:
            rc, broke, _ = run_suite(root)
        finally:
            shutil.rmtree(d)
        dead += rc != 0
        print('%-8s %-44s %s' % ('KILLED' if rc else 'SURVIVED', name, ', '.join(broke)))
    print('%d of %d killed' % (dead, len(MUTANTS)))
    sys.exit(0 if dead == len(MUTANTS) else 1)
elif __name__ == '__main__':
    unittest.main()
