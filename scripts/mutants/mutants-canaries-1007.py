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
         ['craftsync-window-bind']),
    ],
    'cobble': [
        ('no reserve: cobble banked to zero', 'bots/src/bankable.mjs',
         '    if (left - x.n < reserve) break                       // smallest first: no bigger stack fits either\n',
         '', ['cobble-rule']),
        ('largest stack first (fewer kept per slot)', 'bots/src/bankable.mjs',
         '  for (const x of list.sort((a, b) => a.n - b.n || (a.it.slot ?? a.i) - (b.it.slot ?? b.i))) {',
         '  for (const x of list.sort((a, b) => b.n - a.n || (a.it.slot ?? a.i) - (b.it.slot ?? b.i))) {',
         ['cobble-rule']),
        ('bankableInventory ignores the rule (old partial allowance)', 'bots/src/bankable.mjs',
         '    if (COBBLE_SET.has(name)) {\n      const whole = cobbleWhole[name] ?? 0\n',
         '    if (false) {\n      const whole = cobbleWhole[name] ?? 0\n',
         ['cobble-rule']),
        ('the slot prediction walks slot order for cobble', 'bots/src/craftroom.mjs',
         '    if (isCobble(name)) stacks.sort(', '    if (false) stacks.sort(', ['cobble-rule']),
        ('the transfer ignores the room check (a partial stack goes)', 'bots/src/skills.mjs',
         '          if (cobbleRoom(chest, name) < s.count) { row.noRoom++; continue }\n', '', ['cobble-rule']),
        ('cobble-only leftovers go to the chest-full recovery (a new chest for cobble)', 'bots/src/skills.mjs',
         '  if (!cursorLost && moved === 0 && eligible > 0 && cobbleEligible === eligible) {',
         '  if (false) {', ['cobble-rule']),
        ('depositDue at 30+ slots with nothing bankable', 'bots/src/bankable.mjs',
         '  if (!(bankable > 0)) return false\n', '', ['cobble-rule']),
        ('moved credits another depositor\'s gain (uncapped)', 'bots/src/skills.mjs',
         'const got = Math.max(0, Math.min(s.count, inChest(chest, name) - had))   // capped',
         'const got = Math.max(0, inChest(chest, name) - had)   // capped', ['cobble-rule']),
        ('cap: an incomplete count below the cap admits (overshoot on a partial count)', 'bots/src/cobblecap.mjs',
         "  if (!view?.complete) return 'unknown'\n", '', ['cobble-rule']),
        ('cap: reservations ignored (this bot\'s own earlier stacks too)', 'bots/src/cobblecap.mjs',
         '  const base = (Number(view?.lb) || 0) + (Number(view?.reserved) || 0)\n', '  const base = (Number(view?.lb) || 0)\n', ['cobble-rule']),
        ('cap: an expired, never-released claim gives the capacity back (no recount)', 'bots/src/cobblecap.mjs',
         '    } else if (!(obs[c.k] && obs[c.k].at >= c.at + RES_TTL_MS)) dirty.add(c.k)', '    } else if (false) dirty.add(c.k)', ['cobble-rule']),
        ('cap: a count between a claim and its expiry resolves a crash (Codex r2 P1)', 'bots/src/cobblecap.mjs',
         '    } else if (!(obs[c.k] && obs[c.k].at >= c.at + RES_TTL_MS)) dirty.add(c.k)', '    } else if (!(obs[c.k] && obs[c.k].at > c.at)) dirty.add(c.k)', ['cobble-rule']),
        ('cap: the append order, not the capture time, picks the count (a delayed snapshot overwrites)', 'bots/src/cobblecap.mjs',
         '      if (!o || r.cap > o.at || (r.cap === o.at && n > o.n)) state.obs[r.k] = { n, at: r.cap }', '      if (true) state.obs[r.k] = { n, at: r.cap }', ['cobble-rule']),
        ('cap: equal capture times take the later append, not the larger count (Codex r2 P1)', 'bots/src/cobblecap.mjs',
         '      if (!o || r.cap > o.at || (r.cap === o.at && n > o.n)) state.obs[r.k] = { n, at: r.cap }', '      if (!o || r.cap >= o.at) state.obs[r.k] = { n, at: r.cap }', ['cobble-rule']),
        ('cap: a claim is not decided at its own place in the journal', 'bots/src/cobblecap.mjs',
         '      if (upto != null && r.id === upto) return { state, decision, view }\n', '', ['cobble-rule']),
        ('cap: a release without its count (the rel never written)', 'bots/src/cobblecap.mjs',
         "  if (release.length) recs.push({ t: 'rel', ids: release, at: Date.now() })\n", '', ['cobble-rule']),
        ('cap: a refused claim is never released', 'bots/src/cobblecap.mjs',
         "  if (decision !== 'bank') appendJournal(dir, key, world, [{ t: 'rel', ids: [id], at: Date.now() }])\n", '', ['cobble-rule']),
        ('cap scan: hitting the scan cap still counts as coverage', 'bots/src/skills.mjs',
         '    if (ps.length >= COBBLE_SCAN_CAP) coverage = false\n', '', ['cobble-rule']),
        ('cap scan: an unloaded chunk column still counts as coverage', 'bots/src/skills.mjs',
         'home.z + STORAGE_NEAR)))) coverage = false', 'home.z + STORAGE_NEAR)))) void 0', ['cobble-rule']),
        ('cap scan: a counted cell that is no longer a container still counts', 'bots/src/skills.mjs',
         "      if (!CONTAINER_RE.test(blockNameOf(bot, b) ?? '')) { gone.push(k0); continue }", "      if (!CONTAINER_RE.test(blockNameOf(bot, b) ?? '')) { continue }", ['cobble-rule']),
        ('cap scan: a counted container the scan missed is dropped', 'bots/src/skills.mjs',
         '      keys.add(k)                                                                 // the scan missed a counted container\n', '', ['cobble-rule']),
        ('cap scan: a single chest that became a double keeps its old key', 'bots/src/skills.mjs',
         '      if (k !== k0) gone.push(k0)', '      if (false) gone.push(k0)', ['cobble-rule']),
        ('cap view: no stand-in scan from away', 'bots/src/skills.mjs',
         '  if (!sc.coverage && st.scan && now - st.scan.at < OBS_TTL_MS && !inTown(homeVec(), bot.entity?.position)) sc = ', '  if (false) sc = ', ['cobble-rule']),
        ('cap view: the stand-in scan used in town too (Codex r2)', 'bots/src/skills.mjs',
         '  if (!sc.coverage && st.scan && now - st.scan.at < OBS_TTL_MS && !inTown(homeVec(), bot.entity?.position)) sc = ', '  if (!sc.coverage && st.scan && now - st.scan.at < OBS_TTL_MS) sc = ', ['cobble-rule']),
        ('cap: the transfer skips the authoritative admission', 'bots/src/skills.mjs',
         "          if (adm.decision !== 'bank') { eligible -= s.count;", "          if (false) { eligible -= s.count;", ['cobble-rule']),
        ('cap: cobble into a chest outside town', 'bots/src/skills.mjs',
         "  if (!pos || !inTown(homeVec(), pos)) return { decision: 'outside', view: null, id: null, at: Date.now() }\n", '', ['cobble-rule']),
        ('cap: no reconciliation before the plan', 'bots/src/skills.mjs',
         'cobbleReconcilable(v).length) await reconcileCobble(bot, signal, msLeft)\n', 'cobbleReconcilable(v).length) void 0\n', ['cobble-rule']),
        ('cap: reconciliation walks while the town is proven at the cap (Claude r2 P3)', 'bots/src/skills.mjs',
         "      if (cobbleAdmit(v, Math.min(...surplus.map(x => x.count))) === 'unknown' && cobbleReconcilable(v).length)", "      if (cobbleReconcilable(v).length)", ['cobble-rule']),
        ('cap: reconciliation ignores the deadline (Codex r2 P2)', 'bots/src/skills.mjs',
         '      if (msLeft(RECONCILE_WALK_MS) < 2_000) break\n', '', ['cobble-rule']),
        ('cap: no backoff for a container that could not be counted (Claude r2 P2)', 'bots/src/skills.mjs',
         '  return (view?.unknown ?? []).filter(k => !((reconcileFailed.get(failKey(k))?.until ?? 0) > now))', '  return (view?.unknown ?? []).filter(k => true)', ['cobble-rule']),
        ('cap: an empty plan after counting still targets the nearest container (Claude r2 probe B)', 'bots/src/skills.mjs',
         '      if (!depositPlan(bot.inventory.items(), item, { wants: wantsNow }).length) {', '      if (false) {', ['cobble-rule']),
        ('cap: a cobble-only plan takes the nearest chest outside town (Claude r2 P1, probe A)', 'bots/src/skills.mjs',
         ' && depositTargetOk(hv, b.position) && (!cobbleOnly || inTown(hv, b.position)))\n', ' && depositTargetOk(hv, b.position))\n', ['cobble-rule']),
        ('cap: admission bypasses for reconciliation where nothing can be counted (Claude r2 P2)', 'bots/src/admission.mjs',
         " === 'town_cobble_unknown') && cobbleReconcileProbe().can\n", " === 'town_cobble_unknown')\n", ['cobble-rule']),
        ('cap: the probe ignores the town boundary (Claude r2 P2, probe C)', 'bots/src/skills.mjs',
         '    const can = here && cobbleReconcilable(v).length > 0\n', '    const can = cobbleReconcilable(v).length > 0\n', ['cobble-rule']),
        ('cap: admission refuses the reconciliation', 'bots/src/admission.mjs',
         "      if (!depositPlan(items, args?.item ?? null, { wants }).length && !reconcile) {", "      if (!depositPlan(items, args?.item ?? null, { wants }).length) {", ['cobble-rule']),
        ('cap: the plan ignores the town view', 'bots/src/bankable.mjs',
         '  const admitted = town ? admitStacks(town, cobbleStacks.map(s => s.count)) : null\n', '  const admitted = null\n', ['cobble-rule']),
        ('cap: the deposit never observes on open', 'bots/src/skills.mjs',
         '  await cobbleObserve(bot, chestBlock.position, chest)\n', '', ['cobble-rule']),
        ('cap (town deposit, 92bc84f only): a batch ignores its own earlier reservation', 'bots/src/cobblecap.mjs',
         '  const base = (Number(view?.lb) || 0) + (Number(view?.reserved) || 0)\n', '  const base = (Number(view?.lb) || 0)\n', ['towndeposit'], 'only:bots/src/skills.mjs:const capRefused = {'),
        ('cap (town deposit, 92bc84f only): its transfer skips the admission', 'bots/src/skills.mjs',
         "          if (adm.decision !== 'bank') { capRefused[", "          if (false) { capRefused[", ['towndeposit'], 'optional'),
        ('admission walks an empty requested plan', 'bots/src/admission.mjs',
         '      if (!depositPlan(items, args?.item ?? null, { wants }).length && !reconcile) {',
         '      if (false) {', ['cobble-rule']),
        ('the transfer falls back to chest.deposit for cobble', 'bots/src/skills.mjs',
         '      if (isCobble(name)) {\n        const chosen = cobbleBankStacks(', '      if (false) {\n        const chosen = cobbleBankStacks(',
         ['cobble-rule']),
    ],
}


def run(root, files):
    bad = []
    for f in files:
        r = subprocess.run(['node', 'scripts/run-tests.mjs', f], cwd=os.path.join(root, 'bots'), env=ENV, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            bad.append(f)
    return bad


def main():
    root, which = sys.argv[1], sys.argv[2]
    killed = survived = 0
    baseline = {}
    for entry in SETS[which]:
        name, rel, old, new, files = entry[:5]
        optional = len(entry) > 5 and entry[5] == 'optional'   # an anchor that exists in one base's variant only
        path = os.path.join(root, rel)
        src = open(path).read()
        n = src.count(old)
        if n == 0 and optional:
            print(f'SKIPPED   {name}  (not in this variant)')
            continue
        if len(entry) > 5 and entry[5].startswith('only:'):   # 'only:<file>:<text>' -- runs only where that text exists
            _, ofile, otext = entry[5].split(':', 2)
            if otext not in open(os.path.join(root, ofile)).read():
                print(f'SKIPPED   {name}  (not in this variant)')
                continue
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE (%d)" % n}: {name}'
        for f in files:   # the unmutated tree must pass each file once, or a mutant cannot be judged
            if f not in baseline:
                baseline[f] = not run(root, [f])
            assert baseline[f], f'baseline already fails {f}: the mutant cannot be judged'
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
