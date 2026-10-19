#!/usr/bin/env python3
"""External anchored mutants for bamboo-03 (the in-flight craft at a stop: bamboo.mjs foldTally, the fold's row, and
bambooread.py's corrected G3).

    python3 scripts/mutants/mutants-bamboo03.py <export-dir> code     # bots/ mutants: runs test/bamboo.test.mjs
    python3 scripts/mutants/mutants-bamboo03.py <export-dir> read     # the read's own asserts (needs 10.0.0.31's lib)

<export-dir> is a `git archive` export of the branch under test with bots/node_modules linked. Each mutant asserts its
anchor is present EXACTLY ONCE (a mutant that silently fails to apply reads as killed -- CLAUDE.md), applies it, runs,
and is KILLED only if the run fails. The file is restored either way. The unmutated run must PASS first (a suite that
is already red kills every mutant).
"""
import os, subprocess, sys

ENV = dict(os.environ, SKILL_TIMEOUT_MS='300', SKILL_HARD_STOP_GRACE_MS='300', STOCK_WOOD_TARGET='64',
           OLLAMA_MODEL='qwen2.5:7b-instruct', OLLAMA_BASE_URL='http://127.0.0.1:11434')
SHA = 'dffd97e43de90f6beb92d7e94da0a1c462a4d598'

CODE = [
    ('the fold row ignores foldTally (the fleet\'s one-short tally)', 'bots/src/skills.mjs',
     '      crafts = tally.crafts\n', ''),
    ('a made == claimed bag is credited (a stranded in-flight craft counted as made)', 'bots/src/bamboo.mjs',
     '  const inflight = made > c && c < Number(planned) ? 1 : 0\n', '  const inflight = made >= c && c < Number(planned) ? 1 : 0\n'),
    ('sticks alone decide (a stick pickup credits a craft)', 'bots/src/bamboo.mjs',
     '  const made = Math.min(Math.floor(spent / 2), gained)\n', '  const made = gained\n'),
    ('everything the bag shows is credited (not at most one)', 'bots/src/bamboo.mjs',
     '  return { crafts: c + inflight, inflight }\n', '  return { crafts: Math.max(c, made), inflight }\n'),
    ('a success is reconciled too', 'bots/src/bamboo.mjs',
     "  if (status === 'success') return { crafts: c, inflight: 0 }\n", ''),
    ('credited past the plan', 'bots/src/bamboo.mjs',
     '  const inflight = made > c && c < Number(planned) ? 1 : 0\n', '  const inflight = made > c ? 1 : 0\n'),
]
READ = [
    ('the read never credits the in-flight craft (bamboo-02\'s REVERT)', 'scripts/host/bambooread.py',
     '    return 1 if min((b0 - b1) // 2, s1 - s0) > c and c < pl else 0\n', '    return 0\n'),
    ('unverified evidence credits too (the bag alone trusted)', 'scripts/host/bambooread.py',
     "CREDITED = ('server',)\n", "CREDITED = ('server', 'unverified')\n"),
    ('the excusal covers any G3 (not only a row the credit alone would pass)', 'scripts/host/bambooread.py',
     "    shy = evidence in EXCUSABLE and inflight(a, st) == 1 and 'G3_bamboo' not in breaches(a, st, 'server')\n",
     "    shy = evidence in EXCUSABLE and inflight(a, st) == 1\n"),
    ('the read trusts the bot\'s own credit (args.inflight)', 'scripts/host/bambooread.py',
     "    return max(0, (num(a, 'crafts') or 0) - (1 if num(a, 'inflight') == 1 else 0))\n", "    return num(a, 'crafts') or 0\n"),
    ('sticks alone decide the shape', 'scripts/host/bambooread.py',
     '    return 1 if min((b0 - b1) // 2, s1 - s0) > c and c < pl else 0\n', '    return 1 if (s1 - s0) > c and c < pl else 0\n'),
    ('credited past the plan', 'scripts/host/bambooread.py',
     '    return 1 if min((b0 - b1) // 2, s1 - s0) > c and c < pl else 0\n', '    return 1 if min((b0 - b1) // 2, s1 - s0) > c else 0\n'),
    ('any craft in the run with grid_clear yes is server evidence (not the stopped one)', 'scripts/host/bambooread.py',
     "    if inrun and inrun[-1] == 'yes':\n", "    if 'yes' in inrun:\n"),
    ('a craft outside the run window counts', 'scripts/host/bambooread.py',
     "    inrun = [g for (s_, g) in syncs_b if t0 - S1 <= s_ <= t + S1]\n", "    inrun = [g for (s_, g) in syncs_b]\n"),
    ('the server\'s grid_clear no is not stranded (Claude r2)', 'scripts/host/bambooread.py',
     "    if inrun and inrun[-1] == 'no':     # the server's window still held items in the 2x2 grid or on the cursor\n        return 'stranded'\n", ''),
    ('stranded is excusable', 'scripts/host/bambooread.py',
     "EXCUSABLE = ('unverified',)\n", "EXCUSABLE = ('unverified', 'stranded')\n"),
    ('a success is credited', 'scripts/host/bambooread.py',
     "    if st == 'success':\n        return 0\n    s0, s1, b0, b1", "    s0, s1, b0, b1"),
]


def run(root, which):
    if which == 'code':
        r = subprocess.run(['node', 'test/bamboo.test.mjs'], cwd=os.path.join(root, 'bots'), env=ENV,
                           capture_output=True, text=True, timeout=900)
    else:
        # the read's asserts run at import, before any row is read; a 1-minute window keeps the walk small
        env = dict(ENV, CANARY_DRYRUN='hive-a,hive-b:%s:2026-10-19T02:05:45Z' % SHA)
        r = subprocess.run(['python3', os.path.join(root, 'scripts/host/bambooread.py'), '1'], env=env,
                           capture_output=True, text=True, timeout=900)
    return r.returncode, (r.stdout + r.stderr)[-600:]


def main():
    root, which = sys.argv[1], sys.argv[2]
    muts = CODE if which == 'code' else READ
    code, tail = run(root, which)
    print('UNMUTATED: %s' % ('PASS' if code == 0 else 'FAIL'))
    if code != 0:
        print(tail); sys.exit(2)
    survived = 0
    for name, rel, old, new in muts:
        p = os.path.join(root, rel)
        src = open(p).read()
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE (%d): %s' % (src.count(old), name)
        try:
            open(p, 'w').write(src.replace(old, new, 1))
            code, tail = run(root, which)
        finally:
            open(p, 'w').write(src)
        killed = code != 0
        survived += not killed
        print('%-8s %s' % ('KILLED' if killed else 'SURVIVED', name))
        if not killed:
            print(tail)
    print('%d of %d killed' % (len(muts) - survived, len(muts)))
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
