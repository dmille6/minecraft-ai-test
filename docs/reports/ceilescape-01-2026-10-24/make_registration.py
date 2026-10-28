#!/usr/bin/env python3
"""make_registration.py <primary_sha> <variant_sha> <out_dir> <ceilescaperead.py> <approved_note_file>

Writes the two registrations (ceilescape-01.<sha8>.json for the fleet 3cc5f14d and for ironsmelt-01's canary fb8de72f) and the
queue ENTRY FRAGMENT (ceilescape-01.queue-entry-fragment.json). An entry fragment only: no queue command is run by the build.
"""
import hashlib, json, sys, datetime as dt

P, V, OUT, READ, NOTE = sys.argv[1:6]
FLEET, IRONSMELT = '3cc5f14da2c7a2acd37d05360d999b47c52a7e9b', 'fb8de72f7369257d26c31ec974ec4b029cd29f65'
md5 = hashlib.md5(open(READ, 'rb').read()).hexdigest()
IMMOBILEDID = '53af289df12208901931dbeeb1ae325a'
approved = open(NOTE).read().strip()


def reg(sha, requires):
    return {
        'run_id': 'ceilescape-01', 'sha': sha,
        'registered_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'tier': 3, 'ladder_change': False, 'promotion': 'fleet-wide',
        'draw_require_pools': ['board-a'],
        'notes': ('ceilescape-01 (OWNER 2026-10-23 "do whatever you recommend": the board-a-Comet escape fix, a named exception '
                  'to the no-stuck-hunts rule). THE CHANGE: a ramp swing whose price (bot.digTime: the held item, eye water, '
                  'onGround -- mineflayer fixes the wait at dig start) does not fit the time left is never started. Under an '
                  'unaffordable ceiling the cheapest sidestep that fits is taken (floodSidestep, wet feet allowed for a submerged '
                  'start, cellFloods on the head cell, fire-column veto); a first step swing that fits no fresh firing escalates '
                  '(_needs_rescue, the fleetstatus line). CEILESCAPE=0 = the base exactly apart from the rows (tested trace for '
                  'trace against the base module). MEASURED 7 d to 10-24: 3 bots with ramp stops "dig exceeded" -- board-a-Comet 864 '
                  '(copper over a falling-water column, lateral exit east), placebo-c-Bravo 1,331 (sealed; placebo-c is never '
                  'drawable), placebo-a-Alpha 2. Record: docs/reports/ceilescape-01-design-2026-10-24.md. TIER 3: drawexposure '
                  '(6 h, entombed_ramp_cut ~ dig exceeded >= 2) finds board-a only.'),
        'lint': "eslint no-undef on this tip: exactly one hit, bots/src/reflex.mjs 'withinBody' -- the pre-existing guarded line.",
        'licence': {'class': 'kind', 'kind': '_ceilescape_mode', 'min_rows': 1,
                    'note': 'Only a ceilescape-01 build writes _ceilescape_mode (on=1 reserve_ms=3000 ...), once per spawn in index.mjs.'},
        'reads': ['ceilescaperead', 'immobiledid'],
        'read_minutes': [180, 360], 'deadline_min': 1080,
        'change_rows': ['ceilescape'], 'linkage_extra': ['needs_rescue'],
        'draw_exposure': {'hours': 6, 'require': [],
                          'note': 'draw_require_pools ["board-a"]: board-a-Comet is the one bot the fix can free. A kind-based '
                                  'requirement would make drawexposure refuse (one pool, two needed), as for poolescape-01.'},
        'exposure': {'read': 'ceilescaperead', 'field': 'exposure', 'min': 1,
                     'note': '>= 1 canary _ceilescape row with action != ceiling (Comet writes one at its first ramp firing).'},
        'own_lines': [
            {'read': 'ceilescaperead', 'field': 'primary_left', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'PRIMARY (BLOCKS KEEP, deterministic, n = 1): board-a-Comet leaves its column (x 359-360, z 186-188, y 38.5-41) '
                     'after the deploy and stays out >= 30 min of its own positions. Paper: candidate left in 168 s; base stayed.'},
            {'read': 'ceilescaperead', 'field': 'linked_deaths', 'op': '<=', 'value': 1, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G1: canary deaths within 120 s after a _ceilescape action=lateral row of the same bot -- the two-death floor (one is reported).'},
            {'read': 'ceilescaperead', 'field': 'unchanged_broken', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G2: a licence-on _ceilescape row with env_ms <= left_ms and action != ceiling (an affordable swing must take today\'s path).'},
            {'read': 'ceilescaperead', 'field': 'declined_swung', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G3: a firing whose own last _ceilescape row says wait|escalate and whose ramp_cut row reads dig exceeded.'},
            {'read': 'ceilescaperead', 'field': 'rows_control', 'op': '<=', 'value': 0, 'on_fail': 'REVERT',
             'note': 'ARMS: a control _ceilescape* / _needs_rescue row after the deploy. BLOCKS KEEP.'},
            {'read': 'ceilescaperead', 'field': 'licence_on', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'LIVENESS: a canary licence on=1. BLOCKS KEEP (INCONCLUSIVE).'},
            {'read': 'ceilescaperead', 'field': 'instrument', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'INSTRUMENT: board-a-Comet positions in >= 75% of its post 10-min buckets. BLOCKS KEEP.'},
        ],
        'primary': {'read': 'ceilescaperead', 'field': 'primary_left',
                    'note': 'REPORTED: actions by bot, _needs_rescue by cell, ceiling firings that still ended dig exceeded (near vs far; '
                            'far >= 2 is a WATCH on the price model), the no-air-route hold seam, every canary death.'},
        'harm': {'note': 'Unchanged: the two-death floor and gather_ratio < 0.43 of control (immobiledid). POST-PROMOTION TRIPWIRE '
                         '(both engines r2, step 0): run ceilescaperead.py --fleet 2880 48 h after promotion and report every '
                         '_ceilescape row with action != ceiling fleet-wide, by bot, plus G2/G3.'},
        'teardown': {'note': 'THREE STEPS: drop-ins, clear canary_pool, restart the pool\'s bots 12 s apart; then confirm the live '
                             'versions. World changes: the lateral exit\'s own digs (a ladder and dirt beside board-a-Comet), left. '
                             'Rollback without a canary: CEILESCAPE=0. Host-side: scripts/host/ceilescape/patch_fleetstatus.py '
                             '(the coordinator runs it; idempotent, anchored, backed up).'},
        'extension': {'until_exposure': True, 'extra_reads': [720], 'final_on_zero_exposure': 'INCONCLUSIVE',
                      'note': 'Tier 3 (the old behaviour): reads 180/360, KEEP from +360 when exposed, extend for exposure.'},
        'requires': requires,
        'reads_md5': {'ceilescaperead': md5},
    }


regs = {P: reg(P, f'The fleet must be {FLEET} (chatgate-01 KEPT and promoted).'),
        V: reg(V, f'The fleet must be {IRONSMELT} (ironsmelt-01 KEPT and promoted on 3cc5f14d).')}
variants = {}
for sha, base in ((P, FLEET), (V, IRONSMELT)):
    path = f'{OUT}/ceilescape-01.{sha[:8]}.json'
    body = json.dumps(regs[sha], indent=1) + '\n'
    open(path, 'w').write(body)
    variants[base] = {
        'registration': f'/home/mike/mcai-analysis/ceilescape-01.{sha[:8]}.json',
        'approved': approved + (' PRIMARY.' if sha == P else f' VARIANT: the same commits cherry-picked onto ironsmelt-01 {IRONSMELT[:8]} with NO conflict; bots/ and scripts/ +/- lines identical to the primary; npm test 295/295 on c488c3e3 (the ceilescape tests compare against 3cc5f14d, whose reflex.mjs and scaffold.mjs are byte-identical to those of fb8de72f). USE ONLY if ironsmelt-01 is KEPT and promoted.'),
        'canary_sha': sha, 'branch': 'ceilescape-on-3cc5f14d' if sha == P else 'ceilescape-on-fb8de72',
        'reads_src': '/home/mike/mcai-analysis',
        'reads': {'ceilescaperead': md5, 'immobiledid': IMMOBILEDID},
        'registration_sha256': hashlib.sha256(body.encode()).hexdigest(),
    }
frag = {'run': 'ceilescape-01', 'after': [], 'class': '', 'hold': None, 'not_before': None,
        'note': ('ENTRY FRAGMENT (the building agent ran no queue command). OWNER 2026-10-23: build the board-a-Comet escape fix. '
                 'TIER 3, draw_require_pools ["board-a"]. Install the drawn variant\'s registration as '
                 '~/mcai-analysis/registrations/ceilescape-01.json and ~/mcai-analysis/ceilescaperead.py (scripts/host/ceilescaperead.py '
                 'on the branch; md5 below). Host-side flag: scripts/host/ceilescape/patch_fleetstatus.py <installed fleetstatus.py> '
                 'scripts/host/ceilescape/rescue_line.py. The Paper driver is on branch ceilescape-sandbox-1024 (origin/main + the '
                 'driver + the registry test\'s wired count 19 -> 20): merge it with the canary at merge time. Record: '
                 'docs/reports/ceilescape-01-design-2026-10-24.md.'),
        'variants': variants}
open(f'{OUT}/ceilescape-01.queue-entry-fragment.json', 'w').write(json.dumps(frag, indent=1) + '\n')
print('wrote', list(variants), 'read md5', md5)
