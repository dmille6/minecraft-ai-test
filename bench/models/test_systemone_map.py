#!/usr/bin/env python3
"""Unit tests for systemone_map.py (pure).   python3 bench/models/test_systemone_map.py"""
import math, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import systemone_map as SM  # noqa: E402

SYSTEM = 'Choose exactly ONE next skill to run.\nRules...\n\nYou are board-a-Alpha, an autonomous gatherer agent in Minecraft.'
USER = """TASK: Collect 16 dirt. Hand-mineable building material.
PROGRESS: 0/16 dirt
HINT: gather with block=dirt.
TRIGGER: idle
STATE: health 20/20, hunger 20/20, position 292,62,161, day, day 4169
INVENTORY: wooden_pickaxe x1, bucket x1, oak_log x135, cobblestone x598, stick x3
CAN CRAFT NOW: stick, oak_planks (you carry a crafting_table — place it first for the 3x3 recipes)
CAN SMELT NOW: cobbled_deepslate -> deepslate, oak_log -> charcoal (smelt item=<the raw one>; you have a furnace and fuel). This is the ONLY way to get an ingot.
NEARBY: grass_block@4m, stone@3m, iron_ore@8m
BLOCK CHECKS (reachability NOT checked): dirt visible=8 exposed_safe=0 unsafe=1; coal_ore visible=8 exposed_safe=0
ELEVATION: y=62. Surface terrain here is y=62-90; keep goto targets near your current elevation. To mine you must pass y=60 or lower (mine descends to an elevation; it cannot dig a single block).
KNOWN PLACES: home(355,73,147)
LESSONS FROM PAST RUNS:
  - sand seen at x=290 y=62 z=162 (2 blocks away, reported by board-a-Alpha)
  - board-a-Delta and board-a-Echo hit entombed 28x near 334,46,150 — avoid it
saw_end: END-KJ7EYS"""
SCHEMA = {'properties': {'skill': {'enum': ['goto', 'gather', 'home', 'deposit', 'craft', 'smelt', 'mine', 'explore',
                                            'bucket', 'build', 'place', 'surface']},
                         'args': {'properties': {'plan': {'enum': ['shelter', 'wall', 'pillar']}}}}}


class Facts(unittest.TestCase):
    def setUp(self):
        self.f = SM.parse_prompt(USER, SYSTEM)

    def test_lists_in_prompt_order(self):
        f = self.f
        self.assertEqual(f['craftable'], ['stick', 'oak_planks'])
        self.assertEqual(f['smeltable'], ['cobbled_deepslate', 'oak_log'])
        self.assertEqual(f['inventory'], ['wooden_pickaxe', 'bucket', 'oak_log', 'cobblestone', 'stick'])
        # HINT block first, then NEARBY, BLOCK CHECKS, seen-at; no duplicates
        self.assertEqual(f['blocks'], ['dirt', 'grass_block', 'stone', 'iron_ore', 'coal_ore', 'sand'])
        self.assertEqual((f['y'], f['mine_cap'], f['home'], f['task_item']), (62, 60, (355, 73, 147), 'dirt'))
        self.assertEqual(f['sentinel'], 'END-KJ7EYS')

    def test_players_exclude_self(self):
        self.assertEqual(self.f['players'], ['board-a-Delta', 'board-a-Echo'])

    def test_missing_lines_give_empty_lists(self):
        f = SM.parse_prompt('TASK: Scout.\nINVENTORY: \nSTATE: position 1,70,2', '')
        self.assertEqual((f['craftable'], f['smeltable'], f['inventory'], f['blocks'], f['home']), ([], [], [], [], None))
        self.assertEqual(f['mine_cap'], 69)


class Admitted(unittest.TestCase):
    def test_skills_without_options_are_excluded(self):
        f = SM.parse_prompt(USER.replace('CAN CRAFT NOW: stick, oak_planks', 'CAN CRAFT NOW: ')
                            .replace(', bucket x1', ''), SYSTEM)
        ok, out = SM.admitted_skills(SCHEMA, f)
        self.assertIn('craft', out)
        self.assertIn('bucket', out)
        self.assertNotIn('craft', ok)
        self.assertIn('gather', ok)
        self.assertEqual(sorted(ok + out), sorted(SCHEMA['properties']['skill']['enum']))

    def test_empty_bag_excludes_deposit_place_build(self):
        f = SM.parse_prompt(USER.replace('INVENTORY: wooden_pickaxe x1, bucket x1, oak_log x135, cobblestone x598, stick x3',
                                         'INVENTORY: '), SYSTEM)
        _, out = SM.admitted_skills(SCHEMA, f)
        for s in ('deposit', 'place', 'build'):
            self.assertIn(s, out)

    def test_goto_needs_home_or_player(self):
        u = USER.replace('KNOWN PLACES: home(355,73,147)', 'KNOWN PLACES: ').replace('board-a-Delta and board-a-Echo', 'two bots')
        _, out = SM.admitted_skills(SCHEMA, SM.parse_prompt(u, SYSTEM))
        self.assertIn('goto', out)

    def test_skill_question_is_one_choice_over_admitted(self):
        q = SM.skill_question(['gather', 'mine'])
        self.assertEqual(q['type'], 'choice')
        self.assertEqual(list(q['criteria']), ['gather', 'mine'])
        self.assertTrue(q['criteria']['mine'].startswith('mine: '))


class ArgsAndProposal(unittest.TestCase):
    def setUp(self):
        self.f = SM.parse_prompt(USER, SYSTEM)

    def test_gather_questions_and_bucketed_count(self):
        qs = SM.arg_questions('gather', self.f, SCHEMA)
        self.assertEqual(list(qs), ['gather.block', 'gather.count'])
        self.assertEqual(list(qs['gather.block']['criteria'])[0], 'dirt')
        self.assertEqual(list(qs['gather.count']['criteria']), ['1', '4', '8', '16', '32', '64'])
        p, d = SM.to_proposal('gather', {'block': 'dirt', 'count': '16'}, self.f)
        self.assertEqual(p['args'], {'block': 'dirt', 'count': 16})
        self.assertEqual(p['saw_end'], 'END-KJ7EYS')
        self.assertEqual(d, {'skill': 'model', 'block': 'model', 'count': 'model'})

    def test_goto_home_coordinates_come_from_code(self):
        self.assertEqual(list(SM.arg_questions('goto', self.f)['goto.dest']['criteria']), ['home', 'board-a-Delta', 'board-a-Echo'])
        p, d = SM.to_proposal('goto', {'dest': 'home'}, self.f)
        self.assertEqual(p['args'], {'x': 355, 'y': 73, 'z': 147})
        self.assertEqual((d['x'], d['y'], d['z'], d['dest']), ('code', 'code', 'code', 'model'))
        self.assertTrue(SM.coordinate_key('goto', p['args']))

    def test_goto_player_is_a_model_choice(self):
        p, d = SM.to_proposal('goto', {'dest': 'board-a-Echo'}, self.f)
        self.assertEqual(p['args'], {'player': 'board-a-Echo'})
        self.assertFalse(SM.coordinate_key('goto', p['args']))

    def test_mine_y_is_code_below_the_ceiling(self):
        self.assertEqual(SM.arg_questions('mine', self.f), {})
        p, d = SM.to_proposal('mine', {}, self.f)
        self.assertEqual((p['args'], d['y']), ({'y': 16}, 'code'))
        self.assertEqual(SM.mine_y({'mine_cap': 10}), 10)
        self.assertEqual(SM.mine_y({'mine_cap': -70}), -58)
        self.assertTrue(SM.coordinate_key('mine', p['args']))

    def test_deposit_everything_omits_item(self):
        self.assertEqual(list(SM.arg_questions('deposit', self.f)['deposit.item']['criteria'])[0], 'everything')
        p, _ = SM.to_proposal('deposit', {'item': 'everything'}, self.f)
        self.assertEqual(p['args'], {})
        p, _ = SM.to_proposal('deposit', {'item': 'oak_log'}, self.f)
        self.assertEqual(p['args'], {'item': 'oak_log'})

    def test_craft_and_smelt_choices_are_the_can_lists(self):
        self.assertEqual(list(SM.arg_questions('craft', self.f)['craft.item']['criteria']), ['stick', 'oak_planks'])
        self.assertEqual(list(SM.arg_questions('smelt', self.f)['smelt.item']['criteria']), ['cobbled_deepslate', 'oak_log'])

    def test_build_blocks_exclude_tools_and_items(self):
        qs = SM.arg_questions('build', self.f, SCHEMA)
        self.assertEqual(list(qs['build.plan']['criteria']), ['shelter', 'wall', 'pillar'])
        self.assertEqual(list(qs['build.block']['criteria']), ['oak_log', 'cobblestone'])

    def test_no_arg_skills(self):
        for s in ('home', 'status', 'eat', 'board', 'surface'):
            self.assertEqual(SM.arg_questions(s, self.f), {})
            self.assertEqual(SM.to_proposal(s, {}, self.f)[0]['args'], {})

    def test_options_capped_at_26(self):
        f = dict(self.f, blocks=['b%d' % i for i in range(40)])
        self.assertEqual(len(SM.arg_options('gather', f)[0][1]), 26)


class Validity(unittest.TestCase):
    def setUp(self):
        self.f = SM.parse_prompt(USER, SYSTEM)

    def test_valid_choice_needs_an_offered_option(self):
        q = SM.skill_question(['gather', 'mine'])
        self.assertTrue(SM.valid_choice(q, {'choice': 'mine'}))
        self.assertFalse(SM.valid_choice(q, {'choice': 'INVALID'}))
        self.assertFalse(SM.valid_choice(q, None))

    def test_representable(self):
        f = self.f
        self.assertTrue(SM.representable('craft', {'item': 'stick'}, f, SCHEMA))
        self.assertFalse(SM.representable('craft', {'item': 'iron_pickaxe'}, f, SCHEMA))   # not in CAN CRAFT NOW
        self.assertTrue(SM.representable('gather', {'block': 'dirt', 'count': 99}, f, SCHEMA))
        self.assertFalse(SM.representable('gather', {'block': 'diamond_ore'}, f, SCHEMA))
        self.assertTrue(SM.representable('deposit', {}, f, SCHEMA))
        self.assertFalse(SM.representable('deposit', {'item': 'diamond'}, f, SCHEMA))
        self.assertTrue(SM.representable('goto', {'x': 1, 'y': 2, 'z': 3}, f, SCHEMA))   # coordinates: code's
        self.assertTrue(SM.representable('goto', {'player': 'board-a-Echo'}, f, SCHEMA))
        self.assertFalse(SM.representable('goto', {'player': 'nobody-x-Here'}, f, SCHEMA))
        self.assertFalse(SM.representable('status', {}, f, SCHEMA))                       # not in this schema
        self.assertTrue(SM.representable('explore', {'blocks': 60}, f, SCHEMA))


class InvalidAnswerIsScoredInvalid(unittest.TestCase):
    def test_decide_marks_an_out_of_list_choice_invalid(self):
        import systemone_engine as SE

        class BE:
            model, url, name = 'test', 'test', 'http'

            def ask(self, state, qs):
                return {n: {'choice': 'INVALID', 'confidence': 1.0, 'probabilities': {}} for n in qs}, {}
        r = SE.decide({'id': 'x', 'system': SYSTEM, 'user': USER, 'schema': SCHEMA}, BE())
        self.assertFalse(r['schemaValid'])
        self.assertFalse(r['transport_error'])
        self.assertTrue(r['error'].startswith('invalid_choice'))

    def test_decide_marks_a_bad_arg_choice_invalid(self):
        import systemone_engine as SE

        class BE:
            model, url, name = 'test', 'test', 'http'

            def ask(self, state, qs):
                if 'skill' in qs:
                    return {'skill': {'choice': 'gather', 'confidence': 0.9, 'probabilities': {}}}, {}
                return {n: {'choice': 'nope', 'confidence': 1.0, 'probabilities': {}} for n in qs}, {}
        r = SE.decide({'id': 'x', 'system': SYSTEM, 'user': USER, 'schema': SCHEMA}, BE())
        self.assertFalse(r['schemaValid'])

    def test_decide_valid_path(self):
        import systemone_engine as SE

        class BE:
            model, url, name = 'test', 'test', 'http'

            def ask(self, state, qs):
                pick = {'skill': 'gather', 'gather.block': 'dirt', 'gather.count': '16'}
                return {n: {'choice': pick[n], 'confidence': 0.6, 'probabilities': {}} for n in qs}, {}
        r = SE.decide({'id': 'x', 'system': SYSTEM, 'user': USER, 'schema': SCHEMA}, BE())
        self.assertTrue(r['schemaValid'])
        self.assertEqual(r['proposal']['args'], {'block': 'dirt', 'count': 16})
        self.assertEqual(r['confidence'], 0.6)


class D1Port(unittest.TestCase):
    def test_render_matches_prompt_py_layout(self):
        q = {'type': 'choice', 'instructions': 'Which team?', 'criteria': {'billing': 'Charges', 'tech_team': None}}
        self.assertEqual(SM.render_d1('STATE', q),
                         '<|startoftext|><|im_start|>user\nSTATE\n\n\nQUESTION:\nWhich team?\n\nOptions:\nA Charges\n'
                         'B tech team\n\nReply with the option code only.<|im_end|>\n<|im_start|>assistant\n')

    def test_option_codes(self):
        self.assertEqual(SM.option_codes(['x', 'y']), ['x', 'y'])          # labels that already are letters
        self.assertEqual(SM.option_codes(['gather', 'mine']), ['A', 'B'])
        self.assertEqual(SM.option_codes([str(i) for i in range(27)])[:2], ['00', '01'])

    def test_readout_best_form_and_softmax(self):
        top = {'A': math.log(0.2), ' A': math.log(0.3), 'B': math.log(0.1), 'The': math.log(0.4)}
        p, miss = SM.readout(top, ['gather', 'mine'])
        self.assertEqual(miss, 0)
        self.assertAlmostEqual(p[0], 0.75)
        self.assertAlmostEqual(sum(p), 1.0)

    def test_readout_missing_option_gets_the_floor(self):
        top = {'A': -0.1, 'B': -3.0, 'X': -9.0}
        p, miss = SM.readout(top, ['gather', 'mine', 'home'])
        self.assertEqual(miss, 1)
        self.assertAlmostEqual(p[2] / p[1], math.exp(-9.0 + 3.0))

    def test_answer(self):
        a = SM.answer(['gather', 'mine'], [0.25, 0.75])
        self.assertEqual((a['choice'], a['confidence']), ('mine', 0.75))

    def test_state_drops_the_sentinel_line(self):
        s = SM.state_text(SYSTEM, USER)
        self.assertNotIn('saw_end', s)
        self.assertTrue(s.startswith('Choose exactly ONE'))
        self.assertIn('KNOWN PLACES: home(355,73,147)', s)


if __name__ == '__main__':
    unittest.main()
