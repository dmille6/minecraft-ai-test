#!/usr/bin/env python3
"""External anchored mutants for foldwatch-01 (the stagnation watchdog's bamboo-fold exemption).

    python3 scripts/mutants/mutants-foldwatch01.py <export-dir>

<export-dir> is a `git archive` export of the branch under test with bots/node_modules linked. Each mutant asserts its
anchor is present EXACTLY ONCE (CLAUDE.md), applies it, runs the named test files with the suite runner's env, and is
KILLED only if a file fails; the FAIL lines are printed, so a kill by the WIRED source check alone is visible. The
unmutated run must pass first.
"""
import os, subprocess, sys

ENV = dict(os.environ, SKILL_TIMEOUT_MS='300', SKILL_HARD_STOP_GRACE_MS='300', STOCK_WOOD_TARGET='64',
           OLLAMA_MODEL='qwen2.5:7b-instruct', OLLAMA_BASE_URL='http://127.0.0.1:11434')
WD, SK = 'bots/src/watchdog.mjs', 'bots/src/skills.mjs'
FW, BB = 'test/foldwatch.test.mjs', ['test/bamboo-abort.test.mjs', 'test/bamboo.test.mjs']
MUTS = [
    ('no stall check (a stalled fold stays exempt)', WD,
     '  return Number(until) > now && now - Number(progressAt) <= stallMs\n', '  return Number(until) > now\n', [FW]),
    ('the stall bound far past the window', WD,
     'export const FOLD_STALL_MS = 15_000\n', 'export const FOLD_STALL_MS = 900_000\n', [FW]),
    ('the judge ignores the fold (base)', WD,
     '    if (declaredSession(this.bot)) return\n', '    if (furnaceWindow(this.bot)) return\n', [FW]),
    ('the sample counts fold time as busy (base)', WD,
     '    const furnace = declaredSession(this.bot)   // a furnace session or a progressing fold (foldwatch-01)\n',
     '    const furnace = furnaceWindow(this.bot)\n', [FW]),
    ('the fold\'s booked loss not added back (base)', WD,
     '    const items = stagnationItems(inventorySummary(this.bot), this.bot.foldItemsSpent)\n',
     '    const items = stagnationItems(inventorySummary(this.bot), 0)\n', [FW]),
    ('the fold never stamps its progress', SK,
     'crafts++; booked++; bot.foldProgressAt = Date.now(); bot.foldItemsSpent', 'crafts++; booked++; bot.foldItemsSpent', BB),
    ('the fold books no loss', SK,
     '; bot.foldItemsSpent = (Number(bot.foldItemsSpent) || 0) + 1 } })\n', ' } })\n', BB),
    ('the fold window is never cleared', SK,
     '    if (stationary && bot.foldWindowUntil === stationary) bot.foldWindowUntil = 0\n', '', BB),
    ('the server\'s at-stop count books nothing', SK,
     '      if (crafts > booked) { bot.foldItemsSpent = (Number(bot.foldItemsSpent) || 0) + (crafts - booked); booked = crafts }\n', '', BB),
    ('the inferred in-flight craft is credited (booked after foldTally)', SK,
     '      if (crafts > booked) { bot.foldItemsSpent = (Number(bot.foldItemsSpent) || 0) + (crafts - booked); booked = crafts }\n      const tally = foldTally({ claimed: crafts, planned: plan.crafts, before, after, status })\n      crafts = tally.crafts\n',
     '      const tally = foldTally({ claimed: crafts, planned: plan.crafts, before, after, status })\n      crafts = tally.crafts\n      if (crafts > booked) { bot.foldItemsSpent = (Number(bot.foldItemsSpent) || 0) + (crafts - booked); booked = crafts }\n', BB),
]


def run(root, files):
    bad = []
    for f in files:
        r = subprocess.run(['node', f], cwd=os.path.join(root, 'bots'), env=ENV, capture_output=True, text=True, timeout=900)
        if r.returncode != 0:
            bad.append((f, [l.strip() for l in r.stdout.splitlines() if l.strip().startswith('FAIL')]))
    return bad


def main():
    root = sys.argv[1]
    base = run(root, [FW] + BB)
    print('UNMUTATED: %s' % ('PASS' if not base else 'FAIL %s' % base))
    if base:
        sys.exit(2)
    survived = 0
    for name, rel, old, new, files in MUTS:
        p = os.path.join(root, rel)
        src = open(p).read()
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE (%d): %s' % (src.count(old), name)
        try:
            open(p, 'w').write(src.replace(old, new, 1))
            bad = run(root, files)
        finally:
            open(p, 'w').write(src)
        survived += not bad
        print('%-8s %s' % ('KILLED' if bad else 'SURVIVED', name))
        for f, lines in bad:
            for l in lines:
                print('           %s: %s' % (f, l[:150]))
    print('%d of %d killed' % (len(MUTS) - survived, len(MUTS)))
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
