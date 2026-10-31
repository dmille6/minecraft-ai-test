#!/usr/bin/env python3
"""Mutants for the M1 archive path: each anchor must occur exactly once (comment lines stripped AND raw), and
test_learnloop.py, run on a mutated copy of scripts/learnloop/, must fail on the test written against it.

    python3 scripts/learnloop/test_learnloop_mutants.py        (exit 1 if a mutant survives or misses its anchor)
"""
import os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MUT = [
    ('prune by day, not by proven member', 'nightly.py', "        if rel in mem and mem[rel] == sha256_file(f):",
     "        if day in archived:", 'prune_deletes_only_files_proven_on_the_nas'),
    ('no verify after a failed seal', 'nightly.py',
     "        vok, vout = relay.verify(day)            # a seal whose acknowledgement was lost is still a seal",
     "        vok, vout = False, 'mutant'", 'a_lost_seal_acknowledgement_is_recovered_by_verify_not_resent'),
    ('no reconcile from the NAS', 'nightly.py', "            if vok:\n                man = relay.manifest(day)",
     "            if False:\n                man = relay.manifest(day)", 'a_lost_seal_acknowledgement_is_recovered_by_verify_not_resent'),
    ('older failures forgotten', 'nightly.py', "        if not rec.get('controls_ok') and day not in (acknowledged or {}):",
     "        if False:", 'unresolved_keeps_older_failures_until_acknowledged'),
    ('MANIFEST sent first', 'nightly.py', "    for p in files + [manp]:", "    for p in [manp] + files:",
     'process_day_end_to_end_with_the_relay_contract'),
    ('clock back in the MANIFEST', 'nightly.py', "    man = {'day': day, 'extractor': X.EXTRACTOR_VERSION,",
     "    man = {'day': day, 'made_at': iso(now_utc()), 'extractor': X.EXTRACTOR_VERSION,",
     'process_day_end_to_end_with_the_relay_contract'),
    ('owner in tar headers', 'nightly.py', "    ti.uid = ti.gid = 0; ti.uname = ti.gname = ''; ti.mode = 0o644",
     "    pass", 'raw_tar_lists_missing_and_corrupt_generations'),
    ('a dry put counts as an upload', 'nightly.py', "        ok = rc == 0 and out.startswith('OK ' + sha)",
     "        ok = self.dry or (rc == 0 and out.startswith('OK ' + sha))", 'dry_run_never_records_an_archive'),
    ('dry-run may repair', 'nightly.py', "    if a.dry_run and (a.ack or a.adopt_raw or a.repair_raw):", "    if False:",
     'dry_run_never_records_an_archive'),
    ('adopt trusts a local rebuild', 'nightly.py', "        m = relay.members(day, n)", "        m = {}",
     'adopt_raw_proves_members_from_the_nas_bytes'),
    ('void becomes bad', 'extract_triples.py', "        return 'void'      # the runner refused to start",
     "        return 'bad'      # the runner refused to start", 'label_rule_every_branch'),
    ('nondeterministic shard', 'extract_triples.py', "compresslevel=6, mtime=0)", "compresslevel=6, mtime=None)",
     'shard_bytes_are_deterministic'),
]


def main():
    bad = 0
    for name, f, old, new, want in MUT:
        src = open(os.path.join(HERE, f)).read()
        code = '\n'.join('' if ln.lstrip().startswith('#') else ln for ln in src.split('\n'))
        if src.count(old) != 1 or code.count(old) != 1:
            print('ANCHOR %s: raw %d, stripped %d (must be 1 and 1)' % (name, src.count(old), code.count(old))); bad += 1
            continue
        with tempfile.TemporaryDirectory() as td:
            for g in os.listdir(HERE):
                p = os.path.join(HERE, g)
                if os.path.isfile(p):
                    shutil.copy2(p, td)
            open(os.path.join(td, f), 'w').write(src.replace(old, new))
            r = subprocess.run([sys.executable, '-B', 'test_learnloop.py'], cwd=td, capture_output=True, text=True, timeout=600)
            failed = re.findall(r'FAIL  (\S+)', r.stdout)
            print('%s %s: failed=%s' % ('KILLED  ' if want in failed else 'SURVIVED', name, failed))
            bad += want not in failed
    print('%d of %d mutants killed by their intended test' % (len(MUT) - bad, len(MUT)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
