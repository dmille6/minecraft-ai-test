#!/usr/bin/env python3
"""Mutants for the showcase's load-bearing guards: each mutant must make test_showcase.py FAIL, for its own test.
Every anchor is asserted present and unique before it is replaced (CLAUDE.md: a mutant that silently fails to apply
reads as killed).

    python3 infra/showcase/test_showcase_mutants.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

MUTANTS = [
    # phase 1 item 4: the tripwire's remedies (showcase_ops.remedy_plan, follow_record)
    ('showcase_ops.py', "    if age < dt.timedelta(0) or age > window:", "    if age < dt.timedelta(0):", 'test_the_window_is_three_hours'),
    ('showcase_ops.py', "    if act.get('cause') == 'auto-rollback':", "    if False:", 'test_never_a_second_rollback'),
    ('showcase_ops.py', "    if any(r.get('event') == 'auto-rollback' and r.get('from') == current for r in deploy_rows):", "    if False:",
     'test_never_a_second_rollback'),
    ('showcase_ops.py', "    if not auto_on:\n", "    if False:\n", 'test_fail_closed'),
    ('showcase_ops.py', "    if pr and pr != target:", "    if False:", 'test_fail_closed'),
    ('showcase_ops.py', "    if damage:\n", "    if False:\n", 'test_the_10_31_breach_rolls_back_code_and_stays_stopped'),
    ('showcase_ops.py', "WORLD_DAMAGE = ('S4', 'S5 G5', 'S6 H3')", "WORLD_DAMAGE = ('S4',)", 'test_world_damage_classes'),
    ('showcase_ops.py', "        return _peak(after(ev.get('S1')), 180 * 60) >= DEATH_TRIP", "        return True",
     'test_deaths_before_the_switch_are_not_the_new_release'),
    ('showcase_ops.py', "        return any(len(after(v)) >= CRASH_RESTARTS for v in (ev.get('S7') or {}).values())", "        return True",
     'test_crash_loop_and_z1_attribution'),
    ('showcase_ops.py', "        return any(after(v) for v in (ev.get('Z1') or {}).values())", "        return True", 'test_crash_loop_and_z1_attribution'),
    ('showcase_ops.py', "    late = [c for c in classes if not attributable(", "    late = [c for c in [] if not attributable(",
     'test_deaths_before_the_switch_are_not_the_new_release'),
    ('showcase_ops.py', "    if have not in want:", "    if False:", 'test_the_approved_reader_must_be_installed'),
    ('showcase_ops.py', "    if not rok and replay_enforced():\n        return refuse('PRE-ACTIVATION REPLAY: ' + '; '.join(rrec.get('why') or ['refused']))\n    rec['replay'] = dict(rrec, ok=rok, enforced=replay_enforced())\n    if dry:\n        print(f'DRY RUN -- WOULD STAGE {sha[:8]} ({",
     "    if False:\n        return refuse('PRE-ACTIVATION REPLAY: ' + '; '.join(rrec.get('why') or ['refused']))\n    rec['replay'] = dict(rrec, ok=rok, enforced=replay_enforced())\n    if dry:\n        print(f'DRY RUN -- WOULD STAGE {sha[:8]} ({",
     'test_the_pre_activation_replay_gates_a_piece_and_a_main_release'),
    ('showcase_ops.py', "    if not observe or d.get('decision') not in ('DUE', 'ROLLBACK', 'STOP'):", "    if True:",
     'test_an_observe_only_follower_writes_no_rollback'),
    ('files/filebeat.yml', '    - index: "mcai-showcase-ops"\n', '    - index: "mcai-skill-agents"\n',
     'test_only_showcase_indices_and_the_scoped_credential'),
    ('studio-gpu-guard.sh', '    if [ -e "$SHOWCASE_QUIESCED" ] && grep -qxF "RESV $(head -n 1',
     '    if [ -e "$SHOWCASE_QUIESCED" ] && [ "$SHOWCASE_QUIESCED" -nt "$resv" ] && grep -qxF "RESV $(head -n 1',
     'test_ack_in_the_same_second_naming_the_token_is_accepted'),
    ('showcaseproxy.py', "        if not save_handoff(True):\n            logline(status='ack-withheld', reason='could not persist the handoff marker')\n            return\n",
     "        save_handoff(True)\n", 'test_marker_persistence_failure_means_no_ack'),
    ('showcaseproxy.py', "            if not save_handoff(False):\n                STATE['fault'] = 'handoff marker could not be removed'\n                return 'handoff marker could not be removed', False, STATE['inflight']\n",
     "            save_handoff(False)\n", 'test_marker_removal_failure_keeps_admission_closed'),
    ('showcaseproxy.py', "        STATE['handed_off'], STATE['epoch_unloaded'] = True, True\n        logline(status='handoff-restored'",
     "        pass\n        logline(status='handoff-restored'", 'test_restart_during_a_handed_off_pause_never_unloads'),
    ('showcaseproxy.py', "            STATE['handed_off'], STATE['epoch_unloaded'], STATE['sig'] = False, False, None\n            withdraw_ack()\n",
     "            pass\n", 'test_resumed_admission_ends_the_handoff'),
    ('showcaseproxy.py', "        STATE['handed_off'] = True\n        tmp = A.quiesced_file", "        tmp = A.quiesced_file",
     'test_no_unload_after_a_handoff_that_needed_none'),
    ('showcaseproxy.py', "        if STATE['inflight'] or pause_signature(A.pause_file, A.pause_dir, STATE.get('bench_proc')) != sig:",
     "        if STATE['inflight']:", 'test_reservation_replaced_during_the_probes_gets_no_ack'),
    ('showcaseproxy.py', "            return (p, s.st_mtime_ns, s.st_size, head(p))", "            return (p,)",
     'test_reservation_replaced_in_place_is_a_new_reservation'),
    ('showcaseproxy.py', "    if fallback_resident is not False:\n        return 'unload'",
     "    if fallback_resident is True:\n        return 'unload'", 'test_quiesce_is_fail_closed'),
    ('make_env.py', "FORBIDDEN_HOSTS = ('10.0.0.16', '10.0.0.72', '192.168.19')", "FORBIDDEN_HOSTS = ('10.0.0.72', '192.168.19')",
     'test_refuses_a_bench_host_smuggled_in_a_policy_key'),
    ('followrule.py', "    if not before:\n", "    if False:\n",
     'test_explained_rows_are_neutral_but_cannot_witness_the_boundary'),
    ('followrule.py', "            if unexplained_streak >= 2:", "            if unexplained_streak >= 99:",
     'test_two_consecutive_unexplained_break_the_run'),
    ('showcase_ops.py', "    stray = [c for c in commits if not any(c != b and is_anc(b, c) and is_anc(c, p) for p, b in pieces)]",
     "    stray = [c for c in commits if not any(is_anc(c, p) for p, b in pieces)]", 'test_a_piece_left_out_of_the_stack_is_refused'),
    ('showcase_ops.py', "    if not os.path.exists(LANE) or os.path.exists(AUTO):", "    if False:", 'test_outside_the_lane_nothing_is_staged'),
    ('showcase_ops.py', "if isinstance(x, dict) and x.get('verdict') == 'APPROVE' and covers(x.get('sha'), psha)} & set(ENGINES)",
     "if isinstance(x, dict) and x.get('verdict') == 'APPROVE'} & set(ENGINES)", 'test_a_review_must_be_named_approve_and_bound'),
    ('showcase_ops.py', "    if not (isinstance(t, dict) and t.get('result') in TESTS_OK and t.get('runner') == TESTS_RUNNER and covers(t.get('sha'), psha)):",
     "    if not (isinstance(t, dict) and t.get('result') in TESTS_OK and covers(t.get('sha'), psha)):", 'test_a_test_record_is_required_and_bound_to_the_sha'),
    ('showcase_ops.py', "        missing = [e for e in ENGINES if e not in engines]", "        missing = []",
     'test_protected_needs_both_engines_and_a_fleet_keep'),
    ('showcase_ops.py', "        ok, why = fleet_kept(psha)\n        if not ok:", "        ok, why = True, ''\n        if not ok:",
     'test_protected_main_release'),
    ('showcase_ops.py', "        hits = protected_hits(protected(base, psha) if protected else None, patterns)",
     "        hits = protected_hits(protected(release_sha, psha) if protected else None, patterns)", 'test_a_protected_piece_needs_both_engines_and_a_keep'),
    ('showcase_ops.py', "        return [f'(no {PROTECTED_LIST} readable: every change counts as protected)']", "        return []",
     'test_fail_closed'),
    ('showcase_ops.py', "    if hits is None:\n        return ['(the protected", "    if hits is None:\n        return []\n        return ['(the protected",
     'test_fail_closed'),
    ('showcase_ops.py', "        changes = PR.parse_diff(g('diff', '-U0', '-M', '--no-color', a or EMPTY_TREE, b))",
     "        changes = PR.parse_diff(g('diff', '-U0', '-M', '--no-color', b, b))", 'test_the_real_decider_over_a_real_repository'),
    ('showcase_ops.py', "        if not carries(release_sha, sha):", "        if False:", 'test_never_steps_back_over_the_showcase'),
    ('showcase_ops.py', "    if not is_anc(sha, main_tip):\n        return f'{sha[:8]} is not on main", "    if False:\n        return f'{sha[:8]} is not on main",
     'test_only_main'),
    ('showcase_ops.py', "    mine = [r for r in rows if isinstance(r, dict) and r.get('run') and covers(r.get('sha'), sha)]",
     "    mine = [r for r in rows if isinstance(r, dict) and r.get('run')]", 'test_the_release_log_must_name_this_sha'),
    ('showcase_ops.py', "    if isinstance(p, dict) and p.get('result') in PAPER_FAIL and covers(p.get('sha'), psha):",
     "    if False:", 'test_paper_is_optional_but_a_fail_refuses'),
    ('showcase_ops.py', "    return done[:-keep] if keep > 0 and len(done) > keep else []", "    return []", 'test_prune_rule'),
    ('showcase_ops.py', "            link = [f'--link-dest={os.path.join(root, prev[-1], sub)}'] if prev else []", "            link = []",
     'test_unchanged_files_are_hard_links_and_only_n_are_kept'),
    ('showcase_ops.py', "        if not ok:\n            append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'activate-refused'",
     "        if False:\n            append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'activate-refused'", 'test_a_failed_snapshot_switches_nothing'),
    ('showcase_ops.py', "    gated = bool((rel or {}).get('piece')) or (rel or {}).get('mode') == 'main'\n    d['auto']",
     "    gated = False\n    d['auto']", 'test_gated_release_is_observed_only'),
    ('showcase_ops.py', "    gated = bool(rel.get('piece')) or rel.get('mode') == 'main'", "    gated = False",
     'test_a_gated_showcase_release_is_a_rollback_target'),
    ('showcase_ops.py', "                if h is not None and not h:", "                if h is not None:",
     'test_kept_builds_and_content_identity'),
    ('showcase_ops.py', "    ok = r.get('pass') is True and age_h < 24 and bool(release_sha) and r.get('release') == release_sha",
     "    ok = r.get('pass') is True and age_h < 24", 'test_this_release_passing_under_24h'),
    ('showcase_ops.py', "        if not dry:\n            append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'piece-refused'",
     "        if True:\n            append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'piece-refused'", 'test_a_dry_run_stages_and_journals_nothing'),
    ('showcase_ops.py', "        return bool(HEX40.fullmatch(e)) and (e == psha or (is_anc(e, psha) and docs_only(e, psha)))",
     "        return bool(HEX40.fullmatch(e)) and is_anc(e, psha)", 'test_docs_only_after_the_evidence_is_covered_code_is_not'),
    ('showcase_ops.py', "        r = mine[-1]\n        psha, base = ", "        r = mine[0]\n        psha, base = ",
     'test_the_newest_line_of_a_run_speaks_for_it'),
    ('showcase_ops.py', "        hit = is_anc(x, sha) or revoked_in(x, sha)", "        hit = is_anc(x, sha)", 'test_a_revoked_sha_in_the_stack_is_refused'),
    ('showcase_ops.py', "    named = any(r.get('phase') == 'promoted' and any(resolve_hex(h) == psha for h",
     "    named = any(r.get('phase') == 'promoted' and any(resolve_hex(h) for h", 'test_bound_to_the_piece_sha'),
    ('showcase_ops.py', "        if not is_anc(base, sha):\n            return f'{run}: its base", "        if False:\n            return f'{run}: its base",
     'test_a_piece_base_off_the_stack_is_refused'),
    ('showcase_ops.py', "        if not extra and old.get('piece'):", "        if False:", 'test_a_plain_stage_never_reuses_a_piece_release'),
    ('showcase_ops.py', "'diff', '--no-renames', '--name-only', '-z', '--ignore-submodules=none', a, b]", "'diff', '--name-only', '-z', '--ignore-submodules=none', a, b]", 'test_code_moved_into_docs_is_not_docs_only'),
    ('showcase_ops.py', "    base = [parents[0], x] if parents else ['--root', x]", "    base = [parents[-1], x] if parents else ['--root', x]",
     'test_a_revoked_merge_picked_with_mainline_is_found'),
    ('showcase_ops.py', "    base = [parents[0], x] if parents else ['--root', x]", "    base = [f'{x}^', x]", 'test_a_revoked_root_picked_is_found'),
    ('showcase_ops.py', "    if par.returncode or not par.stdout.split():\n        return 'unreadable'", "    if par.returncode or not par.stdout.split():\n        return False",
     'test_an_unreadable_revoked_line_fails_closed'),
    ('showcase_ops.py', "    return bool(want & set(theirs))", "    return False", 'test_a_revoked_commit_picked_alone_is_found'),
    ('showcase_ops.py', "'--full-index', '--no-renames', '--diff-merges=first-parent'", "'--full-index', '--diff-merges=first-parent'",
     'test_a_revoked_rename_picked_is_found'),
    ('showcase_ops.py', "    if not ok:\n        return refuse(out)   # a conflicting", "    if not ok:\n        return 1   # a conflicting", 'test_a_failed_stage_is_journalled'),
    ('showcase_ops.py', "    ok, missing = pieces_in(sha, journal)   # REQUIRED_KEPT against the stack\n",
     "    ok, missing = True, []\n", 'test_required_kept_still_applies'),
    ('showcase_ops.py', "    if not is_anc(release_sha, sha):\n        return f'the current release", "    if False:\n        return f'the current release",
     'test_the_stack_must_build_on_the_current_release'),
    ('showcase_ops.py', "        if extra and any(old.get(k) != v for k, v in extra.items() if k in ('piece', 'prev', 'prev_release', 'mode')):", "        if False:",
     'test_a_cached_plain_release_is_never_reused_as_a_piece_release'),
    ('showcase_ops.py', "if k in ('piece', 'prev', 'prev_release', 'mode')):", "if k in ('piece', 'prev', 'mode')):",
     'test_a_piece_release_from_another_predecessor_is_not_reused'),
    ('tl_showcase.py', "    out, deferred, heavy = list(VIEWS), [], []\n", "    out, deferred, heavy = [], [], []\n",
     'test_plan_pair_first_due_by_interval_active_first_inside_budget'),
    ('tl_showcase.py', "        if age + 2 >= iv:\n", "        if age >= iv:\n",
     'test_plan_pair_first_due_by_interval_active_first_inside_budget'),
    ('tl_showcase.py', "                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)\n                break\n",
     "                break\n", 'test_renderer_lock_is_exclusive_and_names_its_holder'),
    ('tl_video.py', "        if '-event-' in s or s[:8] >= cut:\n", "        if s[:8] >= cut:\n",
     'test_raw_frame_retention_keeps_hourly_and_recent'),
    ('tl_video.py', "        keep = next((s for s in ss if usable(s)), ss[0])\n", "        keep = ss[0]\n",
     'test_raw_frame_retention_keeps_hourly_and_recent'),
    ('tl_showcase.py', "    bad = [s for s in staged if not exists(s) or size(s) < min_bytes or not content_ok(s)]",
     "    bad = [s for s in staged if not exists(s) or size(s) < min_bytes]", 'test_pair_publish_all_or_nothing'),
    # tlpolish-1106: 4K hero cameras one per slot, follow camera hysteresis, the smoothing deadline/fallback
    ('tl_showcase.py', "        if est(v) <= left and (not is_heavy or heavy_left > 0):", "        if est(v) <= left:",
     'test_heavy_cameras_one_per_slot_and_shot_last'),
    ('tl_showcase.py', "    return out + heavy, why, deferred", "    return out[:2] + heavy + out[2:], why, deferred",
     'test_heavy_cameras_one_per_slot_and_shot_last'),
    ('tl_showcase.py', "    if prev in cands and cands[prev] >= lim:\n        return prev", "    if False:\n        return prev",
     'test_follow_target_sticks_while_active_else_newest'),
    ('tl_showcase.py', "    cands = {n: progress[n] for n in sites if n not in excl and progress.get(n)}",
     "    cands = {n: progress[n] for n in sites if progress.get(n)}", 'test_follow_target_sticks_while_active_else_newest'),
    ('tl_showcase.py', "            cams[v] = dict(cam, off=True)", "            cams[v] = dict(cam)", 'test_resolve_cameras_and_sidecar'),
    ('tl_video.py', "    if fell_back:\n        return False, 'fallback: an earlier clip of this job fell back'", "    if False:\n        pass",
     'test_smoothing_choice_deadline_and_fallback'),
    ('tl_video.py', "    if est_s * margin > left:", "    if est_s > left:", 'test_smoothing_choice_deadline_and_fallback'),
    ('tl_video.py', "    who = ''.join(ch for ch in str(who) if ch.isalnum() or ch in ' -_')[:40] or view", "    who = str(who)",
     'test_smooth_encode_and_text_scale'),
]


def main():
    failed = 0
    for fn, old, new, test in MUTANTS:
        with tempfile.TemporaryDirectory() as d:
            dst = os.path.join(d, 'infra', 'showcase')
            shutil.copytree(HERE, dst, ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copytree(os.path.join(ROOT, 'scripts', 'lib'), os.path.join(d, 'scripts', 'lib'),
                            ignore=shutil.ignore_patterns('__pycache__'))
            p = os.path.join(dst, fn)
            src = open(p).read()
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE in {fn}: {old[:60]!r} ({src.count(old)})'
            open(p, 'w').write(src.replace(old, new, 1))
            r = subprocess.run([sys.executable, '-W', 'ignore', os.path.join(dst, 'test_showcase.py'), '-k', test],
                               capture_output=True, text=True, timeout=300)
            # KILLED only by the INTENDED assertion: the named test must FAIL (not error out for an unrelated reason)
            killed = r.returncode != 0 and f'FAIL: {test} ' in r.stderr
            print(f"  {'KILLED' if killed else 'SURVIVED'}  {fn}: {old.strip()[:70]}  (by {test})")
            failed += 0 if killed else 1
    print(f'{len(MUTANTS) - failed} of {len(MUTANTS)} mutants killed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
