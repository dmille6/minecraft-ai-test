"""Mutants: each test edits ONE decision in a temp copy of mayor_core.py (never the source tree) and
asserts the behavioural check that guards it now FAILS. A mutant whose anchor is missing or not
unique raises instead of silently "killing" nothing (CLAUDE.md: mutants assert their anchor)."""
import importlib.util
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), 'mayor_core.py')
sys.path.insert(0, HERE)
import checks  # noqa: E402

_n = [0]


def load_mutant(old, new):
    with open(SRC) as f:
        src = f.read()
    assert old in src, 'ANCHOR MISSING: %r' % old
    assert src.count(old) == 1, 'ANCHOR NOT UNIQUE (%d): %r' % (src.count(old), old)
    d = tempfile.mkdtemp()
    try:
        with open(os.path.join(d, 'mayor_core.py'), 'w') as f:
            f.write(src.replace(old, new, 1))
        shutil.copy(os.path.join(os.path.dirname(SRC), 'stack_sizes.json'), d)
        _n[0] += 1
        spec = importlib.util.spec_from_file_location('mayor_core_mutant_%d' % _n[0], os.path.join(d, 'mayor_core.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod._stack_table()            # read stack_sizes.json before the temp dir goes
        return mod
    finally:
        shutil.rmtree(d)


MUTANTS = [
    # (name, anchor, replacement, the check that must now fail)
    ('eligibility: trapped bots allowed', "    if bot.get('trapped'):\n", "    if False:\n",
     checks.check_trapped_and_stale_are_excluded),
    ('eligibility: stale bots allowed', "    if not bot.get('fresh'):\n", "    if False:\n",
     checks.check_trapped_and_stale_are_excluded),
    ('eligibility: log height ignored', " and abs(r['y'] - pos['y']) <= cfg['log_v']]", "]",
     checks.check_wood_needs_a_near_log),
    ('eligibility: log age ignored', "LOG_RE.search(r['kind']) and r['age_h'] <= cfg['log_age_h']", "LOG_RE.search(r['kind'])",
     checks.check_wood_needs_a_near_log),
    ('eligibility: GET_WOOD room ignored', "if bot['free_slots_est'] < cfg['wood_min_free']:", "if False:",
     checks.check_wood_needs_a_near_log),
    ('eligibility: deposit without bank proof', "if dep_free > 0 and bank.get('accepts_recently'):", "if dep_free > 0:",
     checks.check_full_bag_gets_free_bag),
    ('eligibility: iron without a trip pick', "if bot['stone_pick_uses'] < cfg['iron_trip_uses']:", "if False:",
     checks.check_iron_needs_pick_near_ore_and_room),
    ('eligibility: no table needed', "need_table = 0 if bot['has_table'] else 4", "need_table = 0",
     checks.check_restore_pick_needs_ingredients),
    ('mayor: world cap removed', "        elif len(taken_bots) >= cfg['cap_per_world']:\n", "        elif False:\n",
     checks.check_caps_and_unique_targets),
    ('mayor: cooldown ignored', "        elif '%s|%s' % (c['bot_name'], c['duty']) in cool:\n", "        elif False:\n",
     checks.check_hysteresis_and_cooldown),
    ('mayor: no hysteresis (leases dropped)', "    for name in sorted(leases):\n", "    for name in []:\n",
     checks.check_hysteresis_and_cooldown),
    ('validator: unknown candidate accepted', "        if c is None:\n            why = 'unknown_candidate'",
     "        if c is None:\n            continue", checks.check_validator),
    ('validator: invented target accepted', "        elif tgt is not None and tgt not in c['targets']:", "        elif False:",
     checks.check_validator),
    ('validator: duplicate target accepted', "        elif tgt is not None and tgt in targets_used:", "        elif False:",
     checks.check_validator),
    ('validator: unknown evidence accepted', "        elif cited - known:", "        elif False:", checks.check_validator),
    ('validator: caps ignored',
     "        elif per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:\n            why = 'cap_duty'\n"
     "        elif len(bots_used) >= cfg['cap_per_world']:\n            why = 'cap_world'\n        if why:\n            rejected",
     "        if why:\n            rejected", checks.check_validator),
]


class Mutants(unittest.TestCase):
    def test_every_mutant_is_killed_by_its_check(self):
        import mayor_core as real
        for name, old, new, check in MUTANTS:
            with self.subTest(mutant=name):
                check(real)                                        # the check passes on the real code...
                mod = load_mutant(old, new)
                with self.assertRaises(AssertionError, msg='SURVIVED: %s' % name):
                    check(mod)                                     # ...and fails, by assertion, on the mutant

    def test_anchor_guard_raises(self):
        with self.assertRaises(AssertionError):
            load_mutant('this text is not in the file', 'x')
        with self.assertRaises(AssertionError):
            load_mutant("'FREE_BAG'", 'x')                        # appears many times: not unique


if __name__ == '__main__':
    unittest.main()
