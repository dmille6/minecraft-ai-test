#!/usr/bin/env python3
# mkreg.py <canary_sha> <branch> <base_sha> <npm_test_line> <out.json> -- the homefix-02 registration (TIER 3: no `tier`, no `class`)
import json, sys, datetime as dt
sha, branch, base, npm, out = sys.argv[1:6]
lines = []
def line(field, op, value, note, evidence=None, nullable=False):
    d = {'read': 'homefix2read', 'field': field, 'op': op, 'value': value, 'on_fail': 'REVERT'}
    if evidence:
        d['evidence'] = evidence
    if nullable:
        d['nullable'] = True
    d['note'] = note
    lines.append(d)

# DEFECTS first (evidence=defect: each REVERTS; the read's own selftest has a failing fixture for each)
line('g1_defects', '<=', 0, 'G1 ARRIVAL: an arm `home` row (trigger not interrupt:*, moved >= 2) ending in the H1 band (2 < horizontal <= 3, |dy| <= 6 of config.world home; counted only 0.08 inside each edge: bot.pos is rounded to 0.1) graded anything but success. D = 2 (pre-fix 224/240 = 93.3%).', 'defect')
line('g1b_defects', '<=', 0, 'G1b MIRROR: an arm `home` SUCCESS ending > 3.08 horizontally or |dy| > 6.08 (the fix must not over-accept; 0.08 = the rounding of bot.pos).', 'defect')
line('g2_defects', '<=', 0, 'G2 CLASSIFICATION: an arm `home`/`surface` row with an interrupt:* trigger filed failed/skill_error. D = 5, or the arm mix\'s own D (P(0|no fix) <= 0.05 at home 18.7% / surface 73.5%, h12).', 'defect')
line('g3_defects', '<=', 0, 'G3 RESCUE SURVIVES: a started `_watchdog_rescue` attempt (joined to its skill row, start +-1 s) cut by interrupt:stagnation from a verdict whose window_from precedes the rescue start (or with no verdict row); with no skill row the runner\'s own terminal phase stands in. D = 8 (proxy 34%).', 'defect')
line('g4_defects', '<=', 0, 'G4 RESCUE REACHABLE: a `requested` attempt (>= 260 s before the read boundary: the 230 s bound + margin) with no terminal phase (completed:*, interrupted:*, declined:*, reconnected); a respawn inside the bound CENSORS it (reported, not an opportunity). D = 20.', 'defect')
line('g4_reserve_lcb_fail', '<=', 0, 'G4 RATE DEFECT (the spec\'s reserve_expired > 8%, made robust at small n per Claude code r1 P3-7): the one-sided 95% Wilson LOWER bound of declined:reserve_expired / attempts is above 8%, judged from >= 20 attempts (needs >= 4 of 20; a true 4.1% reaches that 0.8% of the time).', 'defect')
# ARMS and LIVENESS (block KEEP; no evidence class -> INCONCLUSIVE)
line('rows_control', '<=', 0, 'ARMS: control `_watchdog_rescue` rows (only this build writes them). BLOCKS KEEP.')
line('licence_canary', '>=', 1, 'LIVENESS: canary `_watchdog_rescue` rows. BLOCKS KEEP (INCONCLUSIVE).')
# READABILITY and COVERAGE (Codex r1 P1): every enabled canary bot walked with post rows, homes readable, no unreadable log
line('readable', '>=', 1, 'READABLE: every enabled canary bot (systemd roster) has post-window rows on the canary build, every canary home is readable from its env file, no log file failed to load. BLOCKS KEEP.')
line('g3_unjoined', '<=', 0, 'G3 EVIDENCE: a started rescue with neither its skill row nor a terminal phase (past its 230 s bound, no respawn inside it) cannot be graded. BLOCKS KEEP.')
# POSITIVE CONTROLS: a gate whose control fails is VOID, not passed -> blocks KEEP
line('g1_control_ok', '>=', 1, 'G1 CONTROL: the same reader finds >= 1 G1 defect on the arm\'s own 24 h pre-period (old code). Dry run hive-c+placebo-b 10-20: 9 of 9. VOID -> BLOCKS KEEP.')
line('g1b_control_ok', '>=', 1, 'G1b CONTROL: fixtures (the two pre-fix dy -10 successes, h9) are flagged. VOID -> BLOCKS KEEP.')
line('g2_control_ok', '>=', 1, 'G2 CONTROL: the same reader finds >= 1 G2 defect on the arm\'s own 24 h pre-period. Dry run: 45 (22 home / 43 surface opportunities). VOID -> BLOCKS KEEP.')
line('g3_control_ok', '>=', 1, 'G3 CONTROL: (a) the historical proxy (watchdog-origin row <= 30 s after a `_stagnation`, cut by interrupt:stagnation < 150 s) finds >= 1 defect on the pre-period (dry run 27 of 221) AND (b) the new reader passes the good fixtures and fails the defective ones (cut at 15 s, delayed handoff cut 5 s later, cut before 10 s). VOID -> BLOCKS KEEP.')
line('g4_control_ok', '>=', 1, 'G4 CONTROL: fixtures only (no-terminal attempt flagged; reconnect with its row and a declined attempt pass). VOID -> BLOCKS KEEP.')
# THE RESERVE_EXPIRED BAR (engineering threshold, judged from >= 20 attempts): blocks KEEP, never reverts
line('g4_reserve_bar_fail', '<=', 0, 'G4 RATE BAR (point estimate): declined:reserve_expired > 8% of >= 20 attempts (2x the 4.1% unwind-latency proxy) BLOCKS KEEP (INCONCLUSIVE); only the lower-bound line above REVERTS. body_held / runner_paused rates are reported only (pre-fix rates unmeasured).')
# HOMEFIX-02 (docs/reports/homefix-02-design-2026-10-21.md §6, both engines APPROVE r6): the build's invariants (evidence=defect)
line('g5a_defects', '<=', 0, 'G5a (C3a): a watchdog `started` row with air_danger=1 or air_pocketing=1 and NOT air_capped=1: a rescue started into a drowning in progress / a running pocket rung below the per-kind cap.', 'defect')
line('g5b_defects', '<=', 0, 'G5b (C2): a level-1 relocation `requested` row without target_x / dry_tries (the dry-volume pick skipped), or a no_dry_relocation fallback whose dry_tries != 16.', 'defect')
line('g5c_defects', '<=', 0, 'G5c (C1, outcome): a `_drowning_route` `up` row whose head= cell is not swimmable -- the route answered through a solid head cell (homefix-01 death 1: up dist=1 under ice).', 'defect')
line('g5d_defects', '<=', 0, 'G5d (C3b, outcome): an `_air_rescue_yield` whose attempt has no terminal phase by its start + 230 s (the runner hard-stop bound, watchdog.mjs pendingBoundMs); > 60 s is reported only; a bound cut by the window or a respawn is censored.', 'defect')
line('g5dp_defects', '<=', 0, "G5d' (C3b, exact inputs): an `_air_danger` row (predicate recomputed from head_under / air_seconds <= 5 / health < health_3s_max, owner watchdog) with interrupt_issued=0, or the attempt's first such row with no yield at or before +1 s. Paired with G5d (the independent outcome).", 'defect')
line('g5g_defects', '<=', 0, 'G5g (C3 cap): a start with air_capped=1 after < 2 air_rescue declines of its kind since that kind\'s last start, or 3 air_rescue declines of one kind with no start between (segmented at each connect, `_cobblecap_mode`).', 'defect')
line('g6_revert', '<=', 0, 'G6 (rescue-adjacent drownings, both arms): REVERT only when canary drownings <= 180 s / <= 16 b after a `_stagnation` verdict are >= 2 AND the DiD per 1,000 verdicts is positive AND P(X >= n | lambda) < 0.05, lambda = max(0.68/1,000, the drawn pools\' registered old-code rate) x canary verdicts. Conditional estimates, not calibrated guarantees.', 'defect')
line('g6_canary', '<=', 0, 'G6 POLICY TRIPWIRE: ONE canary verdict-adjacent drowning BLOCKS KEEP (a human reads that death). Old-code canary-pool rate 0.68/1,000 verdicts: at ~430 verdicts (+540) P(block | no better than the old code) ~ 0.25 -- the cost of declaring rescue-adjacent drownings a gate (owner may make it report-only).')
line('g5_fields_missing', '<=', 0, 'G5 EVIDENCE: a row this build must write without its fields (started without air_danger; `_drowning_route` without head=; `_air_danger` without interrupt_issued / health_3s_max). BLOCKS KEEP.')
line('g5_fixtures_ok', '>=', 1, 'G5/G6 CONTROLS: the read\'s fixtures (each gate finds its defect and passes the legitimate case: capped starts, an unwinding run, decline/reconnect/decline/decline, death 1 counted and death 2 not). VOID -> BLOCKS KEEP.')
# COMPLETENESS: every gate has its D (else INCONCLUSIVE at the arm-size deadline)
line('gates_complete', '>=', 1, 'EVERY GATE HAS ITS D (G1 >= 2, G2 >= 5 and P(0|no fix) <= 0.05 on the arm mix, G3 >= 8, G4 >= 20). Before the arm-size deadline exposure_ready is 0 and the extension continues; AT the deadline exposure_ready is 1 and this line BLOCKS KEEP -> INCONCLUSIVE.')

reg = {
    'run_id': 'homefix-02',
    'sha': sha,
    'registered_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'ladder_change': False,
    'promotion': 'fleet-wide',
    'notes': ('[homefix-02 on %s: branch %s @ %s] OWNER APPROVED 2026-10-21 ~01:20Z (the X1 exception extended to homefix-02). '
              'homefix-01 (a52d075e) REVERTED 10-21 00:57Z (v23: two hive-d-Echo drownings). Design docs/reports/homefix-02-design-2026-10-21.md, both '
              'engines APPROVE r6: C1 the drowning route reads its own head cell (no `up` through ice; the air-pocket ice dig at dy 1); C2 a level-1 '
              'relocation only to a standable surface cell whose whole goto arrival volume (Chebyshev 5, dy -8..+7) is dry, else level-2 home now; C3 no '
              'watchdog rescue starts into a drowning in progress (head under, <= 5 s air, health fell within 3 s) or a running pocket rung, capped at 2 '
              'declines per kind; a running watchdog rescue is interrupted on every danger tick. homefix-01 H1-H4 unchanged -- spec docs/reports/expansion-plan-2026-10-19.md section 2 (H1, H2a, H2b, the H2 contract, H3, H4) and section 5 (E1), '
              'both engines APPROVE r7. H1 home grades arrival with goto\'s own final test (arrivedAt: <= 3 h, |dy| <= 6); H2 the watchdog rescue contract '
              '(pending from the verdict, Runner.reserve cancel-and-reserve -> runner_reserved, current always cleared, level held + 180 s backoff on a rescue '
              'that did not start, capped at 2 reserve_expired -> level 3 reconnect, window reset at rescue start, _watchdog_rescue attempt rows, '
              '_stagnation args.window_from); one declined set (declined.mjs) every outcome handler imports; H3 the runner files any throw under its own '
              'aborted signal as aborted/interrupted; H4 HOME_BUDGET_MS 170 s and `until` into nested goto/surface. TIER 3 (no tier field, no class): reads '
              '180 / 360, extension until exposure to 540 / 720 / 1080; the read\'s arm-size deadline is +540 at 4 pools, +720 at 3, +1080 at 2 (r6 h13: '
              'P(G1 reaches D) 0.93 by +540 at 20 bots, by +1080 at 10). THE OWNER\'S 10-15 EARLY CLOSE DOES NOT APPLY AT +360 ON A 2-POOL ARM '
              '(P(G1 by then) = 0.42: it would close a correct fix INCONCLUSIVE by design). Fleet-wide, skill_error counts for other skills fall (H3): a '
              'classification change, not an effect.') % (base[:8], branch, sha[:8]),
    'lint': 'eslint no-undef on bots/src: exactly ONE hit, the pre-existing reflex.mjs:2384 withinBody (as on the base).',
    'licence': {'class': 'kind', 'kind': '_watchdog_rescue', 'min_rows': 1,
                'note': 'Only the homefix builds write _watchdog_rescue (rescuerow.mjs logRescueRow). homefix-01 is torn down (10-21 01:03Z, 20 on 9e7d998), so the baseline is silent again; run licencecheck before the draw. homefix-02-only rows (_relocate_landed, _air_danger, _air_rescue_yield) are read by G5.'},
    'reads': ['homefix2read', 'immobiledid'],
    'read_minutes': [180, 360],
    'deadline_min': 1140,
    'change_rows': ['watchdog_rescue'],
    'change_rows_note': ('Written WITHOUT the underscore on purpose: verdict.py compares skill.name.lstrip("_") against the raw change_rows set '
                         '(verdict.py:531, :546, :593), and changerowcheck.py the same way, so "_watchdog_rescue" would never match a death window.'),
    'linkage_extra': [],
    'draw_exposure': {
        'hours': 12,
        'require': [
            {'name': 'stagnation verdicts (rescues: G3/G4)', 'kind': 'stagnation', 'min': 20},
            {'name': 'home runs (G1)', 'kind': 'home', 'min': 5},
        ],
        'note': 'Dry run 10-20 (hive-c + placebo-b, 24 h): 501 level-1 _stagnation verdicts and 52 home rows on 10 bots. Every shared pool escalates; G1 is the slow gate.',
    },
    'exposure': {'read': 'homefix2read', 'field': 'exposure_ready', 'min': 1,
                 'note': 'exposure_ready = gates_complete OR the arm-size deadline (+540 at >= 4 pools, +720 at 3, +1080 at <= 2) reached. Before it the extension continues (NOT_YET); at it, gates_complete 0 blocks KEEP -> INCONCLUSIVE.'},
    'own_lines': lines,
    'primary': {'read': 'homefix2read', 'field': 'g1_opps',
                'note': 'REPORTED, NOT GATED: G5f landing consistency (_relocate_landed wet), the G5c old-build proxy, C2/C3 exposure (relocations, fallback home, air_rescue declines, air_capped, interrupted:drowning, air-pocket ice starts, head-capped routes), dry_reasons (bots near the world floor always fall back: the volume reaches below the world), home success all rows and an S0-like filter (canary/control x pre/post), relocation outcomes, reserve_expired / body_held / runner_paused rates.'},
    'harm': {'note': ('Unchanged: the two-death floor (OWNER 2026-09-11) and gather_ratio < 0.43 of control, from immobiledid. REPORTED by homefix2read (DiD, '
                      'never a verdict there): deaths, canary deaths within 120 s after a _watchdog_rescue start, _stranded* per bot-h, level-1 _stagnation per '
                      'bot-h, _stagnation_reconnect per bot-h (NOT expected to fall: item 4 keeps the reconnect for wedged skills), relocation outcomes (H2a turns '
                      'on ~7.6k level-1 relocations a week that never started before; they must not raise deaths or strandings).')},
    'teardown': {'note': 'THREE STEPS: drop-ins, clear canary_pool, restart the pool\'s bots 12 s apart; then confirm the live versions. Nothing in the world to undo.'},
    'extension': {'until_exposure': True, 'extra_reads': [540, 720, 1080], 'final_on_zero_exposure': 'INCONCLUSIVE',
                  'note': 'G1 is the slow gate: 1.43 opportunities per 3 h at 20 bots (h13). The read sets exposure_ready at its arm-size deadline, so a 4-pool arm closes at +540 and a 3-pool arm at +720.'},
    'variant_prep': {'branch': branch, 'head': sha, 'base': base, 'npm_test': npm},
}
json.dump(reg, open(out, 'w'), indent=2)
print(out)
