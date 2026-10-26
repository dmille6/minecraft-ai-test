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
    ('showcase_ops.py', "x.get('verdict') == 'APPROVE' and covers(x.get('sha'), psha) for x in rv):",
     "x.get('verdict') == 'APPROVE' for x in rv):", 'test_each_engine_must_approve_this_sha'),
    ('showcase_ops.py', "        return bool(HEX40.fullmatch(e)) and (e == psha or (is_anc(e, psha) and docs_only(e, psha)))",
     "        return bool(HEX40.fullmatch(e)) and is_anc(e, psha)", 'test_an_approval_covers_a_later_docs_only_record_and_nothing_else'),
    ('showcase_ops.py', "isinstance(p, dict) and p.get('result') in PAPER_OK and covers",
     "isinstance(p, dict) and 'PASS' in str(p.get('result')) and covers", 'test_paper_must_be_a_pass_of_this_sha'),
    ('showcase_ops.py', "        r = mine[-1]\n        psha, base, kind", "        r = mine[0]\n        psha, base, kind",
     'test_the_newest_line_of_a_run_speaks_for_it'),
    ('showcase_ops.py', "    bad = [x for x in (revoked or []) if is_anc(x, sha) or revoked_in(x, sha)]",
     "    bad = [x for x in (revoked or []) if is_anc(x, sha)]", 'test_a_revoked_sha_in_the_stack_is_refused'),
    ('showcase_ops.py', "    named = any(r.get('phase') == 'promoted' and any(resolve_hex(h) == psha for h",
     "    named = any(r.get('phase') == 'promoted' and any(resolve_hex(h) for h", 'test_bound_to_the_piece_sha'),
    ('showcase_ops.py', "        if not is_anc(base, sha):\n            return f'{run}: its base", "        if False:\n            return f'{run}: its base",
     'test_a_piece_base_off_the_stack_is_refused'),
    ('showcase_ops.py', "        if not extra and old.get('piece'):", "        if False:", 'test_a_plain_stage_never_reuses_a_piece_release'),
    ('showcase_ops.py', "'diff', '--no-renames', '--name-only'", "'diff', '--name-only'", 'test_code_moved_into_docs_is_not_docs_only'),
    ('showcase_ops.py', "'cherry', sha, x, f'{x}^']", "'cherry', sha, x]", 'test_a_revoked_commit_picked_alone_is_found'),
    ('showcase_ops.py', "    if not ok:\n        return refuse(out)", "    if not ok:\n        return 1", 'test_a_failed_stage_is_journalled'),
    ('showcase_ops.py', "    ok, missing = pieces_in(sha, journal)\n    if not ok:\n        return refuse(f'{sha[:8]} lacks",
     "    ok, missing = True, []\n    if not ok:\n        return refuse(f'{sha[:8]} lacks", 'test_required_kept_still_applies'),
    ('showcase_ops.py', "    if not is_anc(release_sha, sha):\n        return f'the current release", "    if False:\n        return f'the current release",
     'test_the_stack_must_build_on_the_current_release'),
    ('showcase_ops.py', "        if extra and any(old.get(k) != v for k, v in extra.items() if k in ('piece', 'prev', 'prev_release')):", "        if False:",
     'test_a_cached_plain_release_is_never_reused_as_a_piece_release'),
    ('showcase_ops.py', "if k in ('piece', 'prev', 'prev_release')):", "if k in ('piece', 'prev')):",
     'test_a_piece_release_from_another_predecessor_is_not_reused'),
    ('tl_showcase.py', "    bad = [s for s in staged if not exists(s) or size(s) < min_bytes or not content_ok(s)]",
     "    bad = [s for s in staged if not exists(s) or size(s) < min_bytes]", 'test_pair_publish_all_or_nothing'),
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
