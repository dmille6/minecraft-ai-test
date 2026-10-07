#!/usr/bin/env python3
"""External anchored mutants for the 10-07 queued canaries (gridfix / bamboo rebase fixes, the cobble rule).

    python3 scripts/mutants/mutants-canaries-1007.py <export-dir> <set>

<export-dir> is a `git archive` export of the branch under test with bots/node_modules linked. Each mutant asserts its
anchor is present EXACTLY ONCE (a mutant that silently fails to apply reads as killed -- CLAUDE.md), applies it, runs the
named test files with the suite runner's env, and is KILLED only if a file fails. The file is restored either way.
In-suite mutants (withMutant in the test files) cover the rest; this runner is for anchors in code a test imports
indirectly, where an in-file withMutant cannot reach.
"""
import os, subprocess, sys

ENV = dict(os.environ, SKILL_TIMEOUT_MS='300', SKILL_HARD_STOP_GRACE_MS='300',
           OLLAMA_MODEL='qwen2.5:7b-instruct', OLLAMA_BASE_URL='http://127.0.0.1:11434')

SETS = {
    'gridfix': [
        ('stop invalidates before validate (lockstep in the cooldown)', 'bots/src/craftsync.mjs',
         '      if (stopReason(st)) stopIssued(st, stopReason(st))\n      const v = inflight.validate(',
         '      const v = inflight.validate(',
         ['test/craftsync-window-bind.test.mjs']),
    ],
    'cobble': [
        ('no reserve: cobble banked to zero', 'bots/src/bankable.mjs',
         '    if (left - x.n < reserve) break                       // smallest first: no bigger stack fits either\n',
         '', ['test/cobble-rule.test.mjs']),
        ('largest stack first (fewer kept per slot)', 'bots/src/bankable.mjs',
         '  for (const x of list.sort((a, b) => a.n - b.n || (a.it.slot ?? a.i) - (b.it.slot ?? b.i))) {',
         '  for (const x of list.sort((a, b) => b.n - a.n || (a.it.slot ?? a.i) - (b.it.slot ?? b.i))) {',
         ['test/cobble-rule.test.mjs']),
        ('bankableInventory ignores the rule (old partial allowance)', 'bots/src/bankable.mjs',
         '    if (COBBLE_SET.has(name)) {\n      const whole = cobbleWhole[name] ?? 0\n',
         '    if (false) {\n      const whole = cobbleWhole[name] ?? 0\n',
         ['test/cobble-rule.test.mjs']),
        ('the slot prediction walks slot order for cobble', 'bots/src/craftroom.mjs',
         '    if (isCobble(name)) stacks.sort(', '    if (false) stacks.sort(', ['test/cobble-rule.test.mjs']),
        ('the transfer ignores the room check (a partial stack goes)', 'bots/src/skills.mjs',
         '          if (cobbleRoom(chest, name) < s.count) { row.noRoom++; continue }\n', '', ['test/cobble-rule.test.mjs']),
        ('cobble-only leftovers go to the chest-full recovery (a new chest for cobble)', 'bots/src/skills.mjs',
         '  if (!cursorLost && moved === 0 && eligible > 0 && cobbleEligible === eligible) {',
         '  if (false) {', ['test/cobble-rule.test.mjs']),
        ('depositDue at 30+ slots with nothing bankable', 'bots/src/bankable.mjs',
         '  if (!(bankable > 0)) return false\n', '', ['test/cobble-rule.test.mjs']),
        ('moved credits another depositor\'s gain (uncapped)', 'bots/src/skills.mjs',
         'const got = Math.max(0, Math.min(s.count, inChest(chest, name) - had))   // capped',
         'const got = Math.max(0, inChest(chest, name) - had)   // capped', ['test/cobble-rule.test.mjs']),
        ('cap: an incomplete count below the cap admits (overshoot on a partial count)', 'bots/src/cobblecap.mjs',
         "  if (!view?.complete) return 'unknown'\n", '', ['test/cobble-rule.test.mjs']),
        ('cap: others\' reservations ignored', 'bots/src/cobblecap.mjs',
         '  const base = (Number(view?.lb) || 0) + (Number(view?.reservedOthers) || 0)\n', '  const base = (Number(view?.lb) || 0)\n', ['test/cobble-rule.test.mjs']),
        ('cap: no lock (a racing read-modify-write)', 'bots/src/cobblecap.mjs',
         "    try { fd = fs.openSync(lock, 'wx') } catch (e) {", "    try { fd = fs.openSync(lock, 'w') } catch (e) {", ['test/cobble-rule.test.mjs']),
        ('cap: the transfer skips the authoritative admission', 'bots/src/skills.mjs',
         "          if (adm.decision !== 'bank') {", "          if (false) {", ['test/cobble-rule.test.mjs']),
        ('cap: the plan ignores the town view', 'bots/src/bankable.mjs',
         '  const admitted = town ? admitStacks(town, cobbleStacks.map(s => s.count)) : null\n', '  const admitted = null\n', ['test/cobble-rule.test.mjs']),
        ('cap: the deposit never observes on open', 'bots/src/skills.mjs',
         '  cobbleObserve(bot, chestBlock.position, chest)\n', '', ['test/cobble-rule.test.mjs']),
        ('admission walks an empty requested plan', 'bots/src/admission.mjs',
         '      if (!depositPlan(items, args?.item ?? null, { wants }).length) {',
         '      if (false) {', ['test/cobble-rule.test.mjs']),
        ('the transfer falls back to chest.deposit for cobble', 'bots/src/skills.mjs',
         '      if (isCobble(name)) {\n        const chosen = cobbleBankStacks(', '      if (false) {\n        const chosen = cobbleBankStacks(',
         ['test/cobble-rule.test.mjs']),
    ],
}


def run(root, files):
    bad = []
    for f in files:
        r = subprocess.run(['node', f], cwd=os.path.join(root, 'bots'), env=ENV, capture_output=True, text=True, timeout=900)
        if r.returncode != 0:
            bad.append(f)
    return bad


def main():
    root, which = sys.argv[1], sys.argv[2]
    killed = survived = 0
    for name, rel, old, new, files in SETS[which]:
        path = os.path.join(root, rel)
        src = open(path).read()
        n = src.count(old)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE (%d)" % n}: {name}'
        base_bad = run(root, files)
        assert not base_bad, f'baseline already fails {base_bad}: the mutant cannot be judged'
        try:
            open(path, 'w').write(src.replace(old, new, 1))
            bad = run(root, files)
        finally:
            open(path, 'w').write(src)
        if bad:
            killed += 1; print(f'KILLED    {name}  ({", ".join(bad)})')
        else:
            survived += 1; print(f'SURVIVED  {name}')
    print(f'{which}: {killed} killed, {survived} survived')
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
