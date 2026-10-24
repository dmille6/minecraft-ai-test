#!/usr/bin/env python3
"""make_registration.py <canary_sha> <base_sha> <out_dir> <lavasightread.py> <approved_note_file> [<variant_sha> <variant_base>]

Writes lavasight-01.<sha8>.json (one per variant) and the queue ENTRY FRAGMENT (lavasight-01.queue-entry-fragment.json).
An entry fragment only: the build runs no queue, scheduler, manifest or env command.
"""
import hashlib, json, sys, datetime as dt

args = sys.argv[1:]
SHA, BASE, OUT, READ, NOTE = args[:5]
VARIANTS = [(SHA, BASE)] + ([(args[5], args[6])] if len(args) >= 7 else [])
md5 = hashlib.md5(open(READ, 'rb').read()).hexdigest()
IMMOBILEDID = '53af289df12208901931dbeeb1ae325a'
approved = open(NOTE).read().strip()


def reg(sha, base):
    return {
        'run_id': 'lavasight-01', 'sha': sha,
        'registered_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'tier': 3, 'ladder_change': False, 'promotion': 'fleet-wide',
        'notes': ('lavasight-01 (mineshaft-safety F5b; OWNER 2026-10-24: right after lavastep-01, fed from the per-seed hazard map '
                  'from day one). THE CHANGE: the walk profile (and every clone of it) carries a move wrapper that adds 50 to the '
                  'cost of any move the corridor guard would refuse for a remembered lava cell -- the move judged in the form the '
                  'guard is handed (postProcessPath\'s support tops, raw after a dig, the floored start). The move graph is the '
                  'base\'s (nothing deleted, nothing added). Memory = the per-world lava-map.json the host publisher writes from '
                  '~/hazardmap/out/hazardmap.json (bound by hashedSeed and pool name; stale_after honoured; fail open) + the bot\'s '
                  'own guard-named cells; re-read live every 20 s. Off while a body-moving reflex holds the body. homefix '
                  'relocation never targets beside live remembered lava. LAVASIGHT=0 = the base apart from the licence row. '
                  'MEASURED out of sample 10-24: 219 of 224 distinct guard-refused lava cells (97.8%) within 1 of a map cell '
                  '(null 0.0%). Record: docs/reports/lavasight-01-design-2026-10-24.md. TIER 3: routing-wide.'),
        'lint': "eslint no-undef on this tip: exactly one hit, bots/src/reflex.mjs 'withinBody' -- the pre-existing guarded line.",
        'licence': {'class': 'kind', 'kind': '_lavasight_mode', 'min_rows': 1,
                    'note': 'Only a lavasight-01 build writes _lavasight_mode (on=1 state=...), at spawn and on every file-state change.'},
        'reads': ['lavasightread', 'immobiledid'],
        'read_minutes': [180, 360], 'deadline_min': 1440,
        'change_rows': ['lavasight_mode', 'lavasight'],
        'linkage_extra': [],
        'draw_exposure': {'hours': 24, 'require': [{'name': 'guard lava refusals in 24 h', 'kind': 'lava_corridor', 'min': 50}],
                          'note': 'Design 7: worlds whose bots the corridor guard refuses for lava (10-24: 13 of 16 worlds pass in '
                                  '4.5 h). REQUIRES the publisher installed before the draw (install-lavamap.sh --install): the '
                                  'read\'s mapped gate needs a lava-map.json in each canary pool.'},
        'exposure': {'read': 'lavasightread', 'field': 'exposure', 'min': 1,
                     'note': 'canary priced moves >= 200, >= 30 canary lava refusal episodes, and >= 80% of canary bots mapped.'},
        'own_lines': [
            {'read': 'lavasightread', 'field': 'held_priced', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G2 (tripwire): a surcharge applied while a body-moving reflex held the body. 0 by construction; a mutant shows it fires.'},
            {'read': 'lavasightread', 'field': 'set_changed', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G3 (tripwire): a wrapped generator returned a different neighbour count than the base (a wall).'},
            {'read': 'lavasightread', 'field': 'malformed', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect',
             'note': 'G5: a canary _lavasight row without its gate fields (never a pass).'},
            {'read': 'lavasightread', 'field': 'rows_control', 'op': '<=', 'value': 0, 'on_fail': 'REVERT',
             'note': 'G4 ARMS: a control _lavasight* row after the deploy. BLOCKS KEEP.'},
            {'read': 'lavasightread', 'field': 'licence_on', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'LIVENESS: a canary licence on=1. BLOCKS KEEP.'},
            {'read': 'lavasightread', 'field': 'mapped', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'MAPPED: >= 80% of ALL canary bots with newest mode state ok (the publisher reached them). BLOCKS KEEP.'},
            {'read': 'lavasightread', 'field': 'instrument', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
             'note': 'INSTRUMENT: liveness coverage >= 0.75 of the canary\'s observed 10-min slots, both arms present. BLOCKS KEEP.'},
            {'read': 'lavasightread', 'field': 'episode_did', 'op': '<=', 'value': 0, 'on_fail': 'REVERT',
             'note': 'PRIMARY (pre-declared, Claude r2 P2-2): lava refusal episodes per bot-h, DiD canary v control, must not RISE. '
                     'Null (4 base-build dry runs): -0.48 .. +0.96 on rates of ~1-2/bot-h, so this line alone is close to a coin '
                     'flip; it blocks a KEEP on a rise, it does not prove a fall. BLOCKS KEEP (INCONCLUSIVE, not REVERT).'},
            {'read': 'lavasightread', 'field': 'timeout_did', 'op': '<=', 'value': 6, 'on_fail': 'REVERT',
             'note': 'NO-HARM: path_timeout per bot-h DiD <= +6. Null (4 base-build dry runs, 180 min, 4 pools): -4.5 .. +2.3; base ~19/bot-h. BLOCKS KEEP.'},
            {'read': 'lavasightread', 'field': 'nopath_did', 'op': '<=', 'value': 50, 'on_fail': 'REVERT',
             'note': 'NO-HARM: path_noPath per bot-h DiD <= +50. Null -44.6 .. +24.7 (noPath is noisy); base ~60/bot-h. BLOCKS KEEP.'},
            {'read': 'lavasightread', 'field': 'move_ok_did', 'op': '>=', 'value': -6, 'on_fail': 'REVERT',
             'note': 'NO-HARM: goto/explore/gather successes per bot-h DiD >= -6. Null -4.0 .. +2.9; base ~16/bot-h. BLOCKS KEEP.'},
        ],
        'primary': {'read': 'lavasightread', 'field': 'episode_did',
                    'note': 'REPORTED: danger-block episodes DiD (co-primary), guard refusals per check on the canary (unsampled), '
                            'priced moves, deaths by family per arm (TWO-DEATH FLOOR: one death is named, never a verdict), deaths at '
                            'map hazards by kind per arm (the warn-only treatment of drowning, cave falls and dripstone).'},
        'harm': {'note': 'Unchanged: the death gate (two deaths and > 1.25x control) and immobiledid gather_ratio.'},
        'teardown': {'note': 'THREE STEPS: drop-ins, clear canary_pool, restart the pool\'s bots 12 s apart; then confirm the live versions. '
                             'The lava-map.json files stay (base builds never read them); install-lavamap.sh --rollback removes them '
                             'and the cron and header line if the change is abandoned. Rollback without a canary: LAVASIGHT=0.'},
        'extension': {'until_exposure': True, 'extra_reads': [540, 720, 1080], 'final_on_zero_exposure': 'INCONCLUSIVE',
                      'note': 'Tier 3: reads 180/360, KEEP from +360 when exposed, extend for exposure.'},
        'requires': 'The fleet must be %s. The publisher (scripts/host/lavasight/install-lavamap.sh --install) must have run.' % base,
        'reads_md5': {'lavasightread': md5},
    }


def main():
    variants = {}
    for sha, base in VARIANTS:
        r = reg(sha, base)
        p = '%s/lavasight-01.%s.json' % (OUT, sha[:8])
        b = (json.dumps(r, indent=1) + '\n').encode()
        open(p, 'wb').write(b)
        variants[base] = {'registration': '/home/mike/mcai-analysis/lavasight-01.%s.json' % sha[:8], 'approved': approved,
                          'canary_sha': sha, 'branch': 'lavasight-on-%s' % base[:7], 'reads_src': '/home/mike/mcai-analysis',
                          'reads': {'lavasightread': md5, 'immobiledid': IMMOBILEDID},
                          'registration_sha256': hashlib.sha256(b).hexdigest()}
        print(p)
    frag = {'run': 'lavasight-01', 'after': ['lavastep-01'], 'class': '', 'hold': None, 'not_before': None,
            'note': ('ENTRY FRAGMENT (the building agent ran no queue command). OWNER 2026-10-24: lavasight-01 runs right after '
                     'lavastep-01, fed from the per-seed hazard map. TIER 3. BEFORE THE DRAW: install the publisher on .31 '
                     '(bash scripts/host/lavasight/install-lavamap.sh --rehearse, then --install, from a checkout of the branch) and '
                     'confirm the fleetstatus line reads "lavamap OK: 16 of 16". Install the drawn variant\'s registration as '
                     '~/mcai-analysis/registrations/lavasight-01.json and ~/mcai-analysis/lavasightread.py (md5 below). Record: '
                     'docs/reports/lavasight-01-design-2026-10-24.md. Paper driver hooks (FM_TAG, FM_POOL_HOOK) are on branch '
                     'lavasight-sandbox-1024: merge with the canary at merge time.'),
            'variants': variants}
    p = '%s/lavasight-01.queue-entry-fragment.json' % OUT
    open(p, 'w').write(json.dumps(frag, indent=1) + '\n')
    print(p)


if __name__ == '__main__':
    main()
