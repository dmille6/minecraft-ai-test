#!/usr/bin/env python3
"""furnaceseen_reg.py <sha> <base sha> <out.json> [read md5] [immobiledid md5] -- furnaceseen-01's REGISTRATION, one builder, so the
verdict-path fixtures (test_furnaceseen_verdict.py) run the registration that is actually filed (Claude r1 P2-4)."""
import datetime as dt
import json
import sys

FINAL_MIN = 1440               # the registered FINAL read: the schedule with the most power (r3 simulation: 0.72 at full removal)


def build(sha, base, md5_read='-', md5_imm='-', tier=2):
    own = [
        {'read': 'furnaceseenread', 'field': 'd1_defects', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect',
         'note': 'D1: the skip function REPLAYED on the logged inputs (the Python port bound to smeltjob.mjs seenSkip by the golden table): '
                 'a canary drain that walked to a furnace whose logged inputs say skip, or a skip row whose inputs say walk. Unresolved '
                 'inputs, appends racing the pick, unread ledgers and lit-released walks are reported, not counted.'},
        {'read': 'furnaceseenread', 'field': 'd1_instrument', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
         'note': 'D1 POSITIVE CONTROL: the replay resolved >= 1 walk or skip and unresolved <= 5% of what it tried. BLOCKS KEEP.'},
        {'read': 'furnaceseenread', 'field': 'r_lb_minus_bar', 'op': '>=', 'value': 0, 'on_fail': 'REVERT',
         'note': 'THE EFFECT LINE (design 6.3 B3; no evidence class: a failure BLOCKS KEEP, never reverts): R = (control change) - (canary '
                 'change) in repeat empty drains per bot-h over a FROZEN 24 h pre-period; its lower bound by randomization over towns (every '
                 'relabelling of the 4 canary pools among the frozen eligible set; alpha 0.025 one-sided = Bonferroni over the k = 2 reads '
                 'that can KEEP, +180 and the final; no extension reads) minus the bar 0.25 x the canary pools\' pre-period rate. Undefined '
                 '(a canary town without both rates, < 2 controls) -> UNREADABLE.'},
        {'read': 'furnaceseenread', 'field': 'rows_control_post', 'op': '<=', 'value': 0, 'on_fail': 'REVERT',
         'note': 'ARMS: a control _furnace_seen_skip or _furnace_seen_mode row after the deploy. BLOCKS KEEP.'},
        {'read': 'furnaceseenread', 'field': 'liveness', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
         'note': 'LIVENESS: canary _furnace_seen_mode on=on >= 1 and canary drains >= 1. BLOCKS KEEP.'},
        {'read': 'furnaceseenread', 'field': 'instrument_control', 'op': '>=', 'value': 1, 'on_fail': 'REVERT',
         'note': 'POSITIVE CONTROL: control repeat empty drains >= 1 (the instrument sees what the change removes) and control '
                 '_ledger_station rows >= 1 (ledger-01 is on the fleet). BLOCKS KEEP.'},
    ]
    reg = {
        'run_id': 'furnaceseen-01', 'sha': sha,
        'registered_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'tier': tier, 'ladder_change': False, 'promotion': 'fleet-wide',
        'notes': 'furnaceseen-01 (cooperation tier B3; docs/reports/cooperation-tier-2026-10-23.md 6.3 B3, 6.4; build record '
                 'docs/reports/furnaceseen-01/README.md). The furnace drain skips the walk to a furnace a TOWNMATE found empty < 60 min '
                 'ago (the town ledger, ledger-01), unless newer contrary evidence exists; the order and the skill share one pick. '
                 'FURNACE_SEEN=off = the base. Requires ledger-01 KEPT and promoted. RECORDED IN ADVANCE (design 6.3 B3): the pre-launch '
                 'power simulation gives at most 0.72 (+180/+1440, full removal) < 80%%, so as registered this run closes INCONCLUSIVE: '
                 'underpowered unless the owner changes the design (docs/reports/furnaceseen-01/README.md).',
        'licence': {'class': 'kind', 'kind': '_furnace_seen_skip', 'min_rows': 1,
                    'note': 'Only a furnaceseen-01 build writes _furnace_seen_skip (one per skipped furnace and entry).'},
        'reads': ['furnaceseenread', 'immobiledid'],
        'read_minutes': [180, 360, FINAL_MIN],      # verdict.py's final = max(read_minutes) (Claude r2 P2-1)
        'deadline_min': FINAL_MIN + 180,
        'change_rows': [], 'linkage_extra': [],
        'draw_exposure': {'hours': 24, 'require': [{'name': 'furnace drains', 'kind': 'furnace_drain', 'min': 40}],
                          'note': 'The read\'s own control eligibility (>= 40 drains in the frozen 24 h pre-period).'},
        'exposure': {'read': 'furnaceseenread', 'field': 'skipped_walks', 'min': 20,
                     'note': 'Skips that CHANGED the pick (changed=1: the base pick would have walked to the skipped furnace).'},
        'own_lines': own,
        'primary': {'read': 'furnaceseenread', 'field': 'r',
                    'note': 'R and its bound; drain body-s per bot-h DiD by stop class (the saving measured, the unreachable loop its own class).'},
        'harm': {'note': 'The default gate: the two-death floor and gather_ratio (immobiledid).'},
        'teardown': {'note': 'THREE STEPS: drop-ins, clear canary_pool, restart the pool\'s bots 12 s apart; confirm the live versions. '
                             'No world change. Rollback without a canary: FURNACE_SEEN=off.'},
        'extension': {'until_exposure': False, 'extra_reads': [],
                      'note': 'NO extension reads: only +180 and the final (+%d) can KEEP, so the Bonferroni k = 2 holds.' % FINAL_MIN},
        'requires': 'The fleet must be %s (ledger-01 promoted).' % base,
        'reads_md5': {'furnaceseenread': md5_read},
    }
    return reg


if __name__ == '__main__':
    sha, base, out = sys.argv[1:4]
    r = build(sha, base, *(sys.argv[4:6] + ['-', '-'])[:2])
    json.dump(r, open(out, 'w'), indent=1)
    print('written', out)
