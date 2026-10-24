#!/usr/bin/env python3
"""make_registration.py <primary_sha> <variant_sha> <out_dir> <plugcutread.py> <approved_note_file>

Writes the two registrations (plugcut-01.<sha8>.json for the fleet fb8de72f and for ceilescape-01's fb8de72f variant
c488c3e3) and the queue ENTRY FRAGMENT (plugcut-01.queue-entry-fragment.json). An entry fragment only: no queue command is
run by the build.
"""
import hashlib, json, sys, datetime as dt

P, V, OUT, READ, NOTE = sys.argv[1:6]
FLEET, CEIL = 'fb8de72f7369257d26c31ec974ec4b029cd29f65', 'c488c3e3180773c049ec0476b966382415e74b4f'
md5 = hashlib.md5(open(READ, 'rb').read()).hexdigest()
IMMOBILEDID = '53af289df12208901931dbeeb1ae325a'
approved = open(NOTE).read().strip()


def reg(sha, requires):
    return {
        'run_id': 'plugcut-01', 'sha': sha,
        'registered_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'tier': 3, 'ladder_change': False, 'promotion': 'fleet-wide',
        'draw_require_pools': ['placebo-d'],
        'notes': ('plugcut-01 (OWNER 2026-10-24 through the coordinator: "plug the wet face first, then cut", reusing poolescape\'s '
                  'plug planner; a named exception to the no-stuck-hunts rule). THE CHANGE, licensed from the 4th consecutive flood '
                  'refusal AT ONE PLACE (a pinned bot): the ceiling refused for ONE wet face is plugged with the bot\'s own block and '
                  'cut through the unchanged flood check; a step refused the same way after the cut is plugged likewise; the licensed '
                  'ramp is not handed back below 2 blocks of climb, judges a step on the planned frame, spares its own plugs and '
                  'utility blocks, and has poolescape\'s 90 s. PLUGCUT=0 = the base. MEASURED (ES 3 d to 10-24 13:00Z): 51 of 76 '
                  'bots with a flood refusal reached a 4th; the acting shape (water BESIDE the ceiling) is placebo-d-Delta 657, '
                  'isolated-d-Bravo 638, isolated-c-Alpha 637, isolated-d-Alpha 448, scattered 1-13 elsewhere. Paper (failmine '
                  'scenes): the candidate ESCAPED all three named scenes where the base fb8de72f stayed. Record: '
                  'docs/reports/plugcut-01-design-2026-10-24.md. TIER 3 (design 7.1): the acting shape is confirmed in placebo-d '
                  'only; isolated-* are never drawable (read --fleet after promotion).'),
        'lint': "eslint no-undef on this tip: exactly one hit, bots/src/reflex.mjs 'withinBody' -- the pre-existing guarded line.",
        'licence': {'class': 'kind', 'kind': '_plugcut_mode', 'min_rows': 1,
                    'note': 'Only a plugcut-01 build writes _plugcut_mode (on=1 after_refusals=3 ...), once per spawn in index.mjs.'},
        'reads': ['plugcutread', 'immobiledid'],
        'read_minutes': [180, 360], 'deadline_min': 1080,
        'change_rows': ['plugcut'], 'linkage_extra': [],
        'draw_exposure': {'hours': 6, 'require': [],
                          'note': 'draw_require_pools ["placebo-d"]: placebo-d-Delta is the one drawable named bot. drawexposure '
                                  '(climb_flood_refused ~ "refusals=4 ", min 1) finds 8 pools in 6 h and 10 in 24 h -- an upper '
                                  'bound: it counts the arm counter, the licence counts one place.'},
        'exposure': {'read': 'plugcutread', 'field': 'exposure', 'min': 1,
                     'note': '>= 1 canary _plugcut row (placebo-d-Delta writes one at its 4th refusal, minutes after the restart).'},
        'own_lines': [
            {'read': 'plugcutread', 'field': 'primary_left', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'PRIMARY (BLOCKS KEEP, deterministic, n = 1): placebo-d-Delta, in its pit (x 197-199, z 186-188, y <= 36.5) at '
                     'the deploy, leaves it and stays out >= 30 min of its own positions; a death first is not leaving. Paper: '
                     'candidate escaped; base stayed.'},
            {'read': 'plugcutread', 'field': 'linked_deaths', 'op': '<=', 'value': 1, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G1: canary deaths within 120 s after a _plugcut result=placed row of the same bot -- the two-death floor (one is reported).'},
            {'read': 'plugcutread', 'field': 'placed_submerged', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G2: a _plugcut result=placed row with sub0=1 (the head under at the decision; the planner refuses it by construction).'},
            {'read': 'plugcutread', 'field': 'rows_control', 'op': '<=', 'value': 0, 'on_fail': 'REVERT',
             'note': 'ARMS: a control _plugcut* row after the deploy. BLOCKS KEEP.'},
            {'read': 'plugcutread', 'field': 'licence_on', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'LIVENESS: a canary licence on=1. BLOCKS KEEP (INCONCLUSIVE).'},
            {'read': 'plugcutread', 'field': 'instrument', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'INSTRUMENT: placebo-d-Delta positions in >= 75% of its post 10-min buckets. BLOCKS KEEP.'},
        ],
        'primary': {'read': 'plugcutread', 'field': 'primary_left',
                    'note': 'REPORTED: results by bot and for=, top refusal reasons, breaches at a plugged cell (>= 2 a WATCH), '
                            'licensed ramps that progressed, placements that sank after (sub0=0 sub=1), every canary death.'},
        'harm': {'note': 'Unchanged: the two-death floor and gather_ratio < 0.43 of control (immobiledid). POST-PROMOTION TRIPWIRE: '
                         'run plugcutread.py --fleet 2880 48 h after promotion and report every bot\'s _plugcut rows and LEFT state '
                         '(isolated-c-Alpha, isolated-d-Bravo and isolated-d-Alpha are read only there), plus G1/G2.'},
        'teardown': {'note': 'THREE STEPS: drop-ins, clear canary_pool, restart the pool\'s bots 12 s apart; then confirm the live '
                             'versions. World changes: the bots\' own plugs (dirt/cobble placed into water beside a cut) and the '
                             'cut/step cells, left. Rollback without a canary: PLUGCUT=0.'},
        'extension': {'until_exposure': True, 'extra_reads': [720], 'final_on_zero_exposure': 'INCONCLUSIVE',
                      'note': 'Tier 3 (the old behaviour): reads 180/360, KEEP from +360 when exposed, extend for exposure.'},
        'requires': requires,
        'reads_md5': {'plugcutread': md5},
    }


regs = {P: reg(P, f'The fleet must be {FLEET} (ironsmelt-01 KEPT and promoted on 3cc5f14d).'),
        V: reg(V, f'The fleet must be {CEIL} (ceilescape-01 KEPT and promoted as its fb8de72f variant).')}
variants = {}
for sha, base in ((P, FLEET), (V, CEIL)):
    path = f'{OUT}/plugcut-01.{sha[:8]}.json'
    body = json.dumps(regs[sha], indent=1) + '\n'
    open(path, 'w').write(body)
    variants[base] = {
        'registration': f'/home/mike/mcai-analysis/plugcut-01.{sha[:8]}.json',
        'approved': approved + (' PRIMARY.' if sha == P else f' VARIANT: the primary on ceilescape-01\'s fb8de72f variant {CEIL[:8]}; 7 conflicts resolved, bots/src +/- lines identical to the primary\'s; floodBranch keeps ceilescape\'s own ramp call; npm test 296/296 on the variant (plugcut 74, ceilescape 67). USE ONLY if ceilescape-01 is KEPT and promoted as {CEIL[:8]}.'),
        'canary_sha': sha, 'branch': 'plugcut-on-fb8de72' if sha == P else 'plugcut-on-c488c3e3',
        'reads_src': '/home/mike/mcai-analysis',
        'reads': {'plugcutread': md5, 'immobiledid': IMMOBILEDID},
        'registration_sha256': hashlib.sha256(body.encode()).hexdigest(),
    }
frag = {'run': 'plugcut-01', 'after': ['ceilescape-01'], 'class': '', 'hold': None, 'not_before': None,
        'note': ('ENTRY FRAGMENT (the building agent ran no queue command). OWNER 2026-10-24: plug the wet face first, then cut '
                 '(the climb-flood escape). TIER 3, draw_require_pools ["placebo-d"]. Queues after ceilescape-01: draw the variant '
                 'that matches the fleet then (primary on fb8de72f, variant on c488c3e3). Install the drawn variant\'s '
                 'registration as ~/mcai-analysis/registrations/plugcut-01.json and ~/mcai-analysis/plugcutread.py '
                 '(scripts/host/plugcutread.py on the branch; md5 below). The failmine library scene for isolated-d-Bravo is on '
                 'branch plugcut-sandbox-1024 (origin/main + the scene + INDEX.json): merge it with the canary at merge time. '
                 'Record: docs/reports/plugcut-01-design-2026-10-24.md.'),
        'variants': variants}
open(f'{OUT}/plugcut-01.queue-entry-fragment.json', 'w').write(json.dumps(frag, indent=1) + '\n')
print('wrote', list(variants), 'read md5', md5)
