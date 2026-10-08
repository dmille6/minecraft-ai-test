#!/usr/bin/env python3
# withdraw2 mutants: each anchor must be present and UNIQUE; the source is restored after each; a mutant counts as
# KILLED only when the named test files go red against a baseline proven green first.
import subprocess, sys, os
# WD2_ROOT: the bots/ dir of the variant under test (10-08: wd2-on-c6e91a8 and wd2-on-92bc84f). The towndeposit
# mutants (TD) run only where src/towndeposit.mjs exists -- and there they are REQUIRED (anchors asserted as for any).
ROOT = os.environ.get('WD2_ROOT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wd2-cand', 'bots')
HAS_TD = os.path.exists(os.path.join(ROOT, 'src', 'towndeposit.mjs'))
W2 = ['withdraw2']
TD = ['withdraw2-towndeposit']
M = [
  # ranking
  ('rank: uses before tier', 'src/withdrawpick.mjs', "const copyKey = c => [tier(c.name), Math.min(remaining(c), 1e9), -(c.slot ?? 0)]", "const copyKey = c => [Math.min(remaining(c), 1e9), tier(c.name), -(c.slot ?? 0)]", W2),
  ('rank: a spent copy is a candidate', 'src/withdrawpick.mjs', "  const ok = (Array.isArray(copies) ? copies : []).filter(c => c?.name && usableTool(c))\n  return ok.sort(", "  const ok = (Array.isArray(copies) ? copies : []).filter(c => c?.name)\n  return ok.sort(", W2),
  ('rank: the held tier counts a spent pickaxe', 'src/withdrawpick.mjs', "export const pickTier = it => (it?.name && PICK_RE.test(it.name) && usableTool(it) ? tier(it.name) : -1)", "export const pickTier = it => (it?.name && PICK_RE.test(it.name) ? tier(it.name) : -1)", W2),
  # best-first
  ('best-first: only the first container ranked', 'src/skills.mjs', "  const cands = rankCopies(survey.flatMap(", "  const cands = rankCopies(survey.slice(0, 1).flatMap(", W2),
  ('best-first: a copy matched by name only at the take', 'src/skills.mjs', "it?.slot === want.slot && it.name === want.name && (it.durabilityUsed ?? 0) === (want.durabilityUsed ?? 0)", "it.name === want.name", W2),
  ('best-first: a gone copy stops the order', 'src/skills.mjs', "      gone.push(c)   // the planned copy is not there any more: proven gone\n", "      return { stopped: 'gone' }\n", W2),
  ('best-first: an unreachable copy counts as gone', 'src/skills.mjs', "      if (v.result) return { stopped: v.result }\n", "      if (v.result) { gone.push(c); continue }\n", W2),
  ('best-first: not better than held is taken', 'src/skills.mjs', "      if (tier(c.name) <= minTier) break\n", "", W2),
  # the trade
  ('trade: the worse pickaxe is not traded', 'src/skills.mjs', "  if (worse) return { swap: { name: worse.name, count: 1, used: worse.durabilityUsed ?? 0, tool: true }, tool: copy }\n", "", W2),
  # the gate
  ('gate: an upgrade ignores the iron branch', 'src/composter.mjs', "  if (upgradeReady && (!lazy(betterMiss) || !lazy(ironMiss))) {", "  if (upgradeReady && (!lazy(betterMiss))) {", W2),
  ('gate: an upgrade ignores its cooldown', 'src/composter.mjs', "now - (s.lastUpgradeAt ?? -Infinity) >= UPGRADE_COOLDOWN_MS &&", "true &&", W2),
  ('gate: no pickaxe ignores the iron branch', 'src/composter.mjs', "    if (!pickRuledOut || !lazy(ingredientMiss) || !lazy(ironMiss)) {", "    if (!pickRuledOut || !lazy(ingredientMiss)) {", W2),
  # iron plan
  ('plan: ingots first across two chests', 'src/withdrawpick.mjs', "steps: [{ key: P.key, takes: pre }, { key: I.key, takes: [ing] }]", "steps: [{ key: I.key, takes: [ing] }, { key: P.key, takes: pre }]", W2),
  ('plan: ingots first in one chest', 'src/withdrawpick.mjs', "takes: [...here, ing] }", "takes: [ing, ...here] }", W2),
  ('plan: split ingots accepted', 'src/withdrawpick.mjs', "  for (const I of survey.filter(c => ingotsIn(c) >= d.ingots)) {", "  for (const I of survey.filter(c => ingotsIn(c) > 0)) {", W2),
  ('plan: the table planks forgotten', 'src/withdrawpick.mjs', "  const tablePlanks = !tableCarried && !tableNear ? IRON_PICK.tablePlanks : 0\n", "  const tablePlanks = 0\n", W2),
  ('plan: the table judged at station reach, not the craft\'s search', 'src/skills.mjs', "  const tableNear = () => !!bot.findBlock?.({ matching: b => blockNameOf(bot, b) === 'crafting_table', maxDistance: CRAFT_TABLE_SEARCH })", "  const tableNear = () => !!bot.findBlock?.({ matching: b => blockNameOf(bot, b) === 'crafting_table', maxDistance: Math.ceil(STATION_REACH) + 1 })", W2),
  # iron path
  ('iron: the cooldown is never charged', 'src/skills.mjs', "  withdrawIronState.at = Date.now()   // CHARGED", "  void 0   // CHARGED", W2),
  ('iron: a claimed craft is trusted without the recount', 'src/skills.mjs', "if (st.ledger.craft === 'server' && Number(cr.produced) >= 1 && made >= 1) {", "if (st.ledger.craft === 'server' && Number(cr.produced) >= 1) {", W2),
  ('iron: the scoped holds are not released', 'src/skills.mjs', "    for (const [name, k] of heldBack) releaseWithdrawHold(name, k)\n", "", W2),
  ('iron: the new pickaxe is not held', 'src/skills.mjs', "    if (made > 0) setWithdrawHold('iron_pickaxe', made, Date.now() + HOLD_MS)", "    void made", W2),
  ('iron: no re-plan before the ingots', 'src/skills.mjs', "        stepTakes = last.takes\n", "", W2),
  ('iron: deposit banks the ingots of a bot below iron', 'src/bankable.mjs', "  const ironKeep = ironUpgradePending(items) ? IRON_UPGRADE_KEEP : 0\n", "  const ironKeep = 0\n", W2),
  # evidence
  ('evidence: no _pick_best written', 'src/skills.mjs', "notePickBest(e, keys, best); noteIngotsSeen(e, keys, ingots);", "noteIngotsSeen(e, keys, ingots);", W2),
  ('evidence: no _ingot_seen written', 'src/skills.mjs', "notePickBest(e, keys, best); noteIngotsSeen(e, keys, ingots);", "notePickBest(e, keys, best);", W2),
  ('evidence: a pickaxe miss skips a chest even for iron', 'src/skills.mjs', "skipIf: (mem, k) => containerPickMiss(mem, k) && (!ironOk || (containerIngotsNone(mem, k) && noWood(mem, k)))", "skipIf: (mem, k) => containerPickMiss(mem, k)", W2),
  ('evidence: complete coverage not needed for no-better', 'src/withdrawpick.mjs', "  keys.length > 0 && keys.every(k => containerPickBestAtMost(entries, k, held, now))", "  keys.length > 0 && keys.some(k => containerPickBestAtMost(entries, k, held, now))", W2),
  ('evidence: ingot quantities not summed', 'src/withdrawpick.mjs', "    sum += v.count ?? 0\n", "    sum = Math.max(sum, v.count ?? 0)\n", W2),
  # Codex code review round 1
  ('C1 iron: a missing prerequisite is dropped, the rest taken', 'src/skills.mjs', "    if (!stepTakes.every(t => haveIn(inChest, t.name) >= t.count)) return null\n", "", W2),
  ('C1 iron: room not simulated at the first chest', 'src/skills.mjs', "      if (a.leftover) { st.ledger.iron = 'declined:no room in the chest for the room-making deposit'; return null }\n", "", W2),
  ('C1 iron: the first visit makes room only for itself', 'src/skills.mjs', "      const roomTakes = i === 0 ? plan.steps.flatMap(s => s.takes) : stepTakes\n", "      const roomTakes = stepTakes\n", W2),
  ('C1 budget: the iron path ignores visits already spent', 'src/skills.mjs', "  if (plan.steps.length > TAKE_VISITS - st.takeVisits) {", "  if (plan.steps.length > TAKE_VISITS) {", W2),
  ('C1 inspection: a sticks-only chest is skipped', 'src/skills.mjs', "(!ironOk || (containerIngotsNone(mem, k) && noWood(mem, k)))", "(!ironOk || containerIngotsNone(mem, k))", W2),
  ('C1 iron: an abort after the craft skips the hold', 'src/skills.mjs', "    try { cr = await SKILLS.craft.run(ctx, { item: 'iron_pickaxe', count: 1 }, signal) } catch (e) { thrown = e;", "    try { cr = await SKILLS.craft.run(ctx, { item: 'iron_pickaxe', count: 1 }, signal) } catch (e) { if (e?.aborted) throw e; thrown = e;", W2),
  ('C1 ledger: transform not measured', 'src/skills.mjs', "      st.ledger.transform = [...names].filter(k => recipe(k) && n(after.bag, k) < n(pre.bag, k))\n", "      st.ledger.transform = []\n", W2),
  ('C1 ledger: gone not recorded', 'src/skills.mjs', "    L.gone = (st.gone ?? []).map(c => tierName(tier(c.name)))\n", "    L.gone = []\n", W2),
  ('C1 ledger: the taken copy\'s uses missing', 'src/skills.mjs', " st.ledger.took_uses = Number.isFinite(remaining(c)) ? remaining(c) : 'full';", "", W2),
  # Codex code review round 2
  ('C2 transfer: a short take does not stop the later ones', 'src/skills.mjs', "        if (left > 0 && take !== takes[takes.length - 1]) throw stop(", "        if (false) throw stop(", W2),
  ('C2 ledger: transform exempts any fall during the craft', 'src/skills.mjs', "      st.ledger.transform = [...names].filter(k => recipe(k) && n(after.bag, k) < n(pre.bag, k))", "      st.ledger.transform = [...names].filter(k => k !== 'iron_pickaxe' && n(after.bag, k) < n(pre.bag, k))", W2),
  ('C2 inspection: iron counted possible although the town ingots are ruled out', 'src/skills.mjs', "  const ironOk = held < TIER_IRON && ironAllowed(bot) && !townIronRuledOut(bot)", "  const ironOk = held < TIER_IRON && ironAllowed(bot)", ['withdraw-pick']),
  ('C3 ledger: an interrupted transfer is dropped from the thrown row', 'src/skills.mjs', "      for (const [k, v] of Object.entries(ws.took ?? {})) st.ledger.took[k] = (st.ledger.took[k] ?? 0) + v\n", "", ['withdraw2']),
  ('C4 ledger: a part-stack abort loses what was placed and rescued', 'src/skills.mjs', "    if (part.placed + rescued > 0) took[part.name] = (took[part.name] ?? 0) + part.placed + rescued\n", "", ['withdraw2']),
  ('C5 ledger: the cursor returned to the chest is counted taken', 'src/skills.mjs', "    const back = Math.max(0, chestCount(part.name) - chestBefore)\n", "    const back = 0\n", ['withdraw2']),
  ('C6 ledger: a placement counts the plan, not the cursor', 'src/skills.mjs', "            placed += d; part.placed += d\n", "            placed += (button === 0 ? m : 1); part.placed += (button === 0 ? m : 1)\n", ['withdraw2']),
  ('C6 evidence: the take subtracts from the stale inspection', 'src/skills.mjs', "        const left = (v.saw ?? []).reduce(", "        const left = (where.saw ?? []).reduce(", ['withdraw2']),
  ('C6 ledger: the leftover cursor closes the accounting before the settle', 'src/skills.mjs', "          if (win.selectedItem) throw stop(`the rest of the ${take.name} could not go back to chest slot ${src.slot}`)\n", "", ['withdraw2']),
  ('C2 ledger: a thrown order writes no ledger', 'src/skills.mjs', "      ledgerArgs(st.finalBag ?? null, e?.aborted ? 'aborted' : 'error'))", "      null)", W2),
  ('C2 ledger: the craft fields are set after the rethrow', 'src/skills.mjs', "    st.ledger.produced = made ?? '?'\n", "", W2),
  # ledger
  ('ledger: no cumulative server change', 'src/skills.mjs', "    if (st.base && finalBag) {", "    if (false) {", W2),
  # withdraw2 x towndeposit (92bc84f variant only): the town deposit's keeps that hold what the iron pull took
  # The ingots have TWO independent keeps (towndeposit IRON_LADDER; bankable iron_upgrade_reserve inside depositPlan's
  # allowance): either alone holds them, so the mutant removes both (a compound mutant: a list of edits).
  ('TD keep: the ingots lose both keeps', [('src/towndeposit.mjs', "  for (const n of IRON_LADDER) floor(n, Infinity, 'iron_ladder')\n", "  for (const n of IRON_LADDER) if (n !== 'iron_ingot') floor(n, Infinity, 'iron_ladder')\n"),
                                            ('src/bankable.mjs', "  const ironKeep = ironUpgradePending(items) ? IRON_UPGRADE_KEEP : 0\n", "  const ironKeep = 0\n")], None, None, TD),
  ('TD keep: the scaffold sticks are banked', 'src/bankable.mjs', "  if (counts.stick) keep.stick = Math.max(keep.stick ?? 0, Math.min(RESERVE_RECIPE, counts.stick))\n", "", TD),
  ('TD keep: the best copy of a pickaxe name is banked', 'src/towndeposit.mjs', "  return usable.slice(1, 1 + Math.max(0, allowance)).map(c => c.slot)\n", "  return usable.slice(0, Math.max(0, allowance)).map(c => c.slot)\n", TD),
]
M = [m for m in M if HAS_TD or m[4] != TD]
print(f'root={ROOT} towndeposit={HAS_TD} mutants={len(M)}', flush=True)
only = sys.argv[1:]
bad = 0
for t in sorted({t for m in M for t in m[4]}):
    r = subprocess.run(['node', 'scripts/run-tests.mjs', t], cwd=ROOT, capture_output=True, text=True, timeout=900)
    assert r.returncode == 0, f'BASELINE RED: {t} fails before any mutant -- every "killed" would be false'
for name, f, old, new, tests in M:
    if only and not any(o in name for o in only): continue
    edits = f if isinstance(f, list) else [(f, old, new)]
    saved = {}
    for ef, eo, en in edits:
        ep = os.path.join(ROOT, ef)
        esrc = saved.setdefault(ep, open(ep).read())
        cur = open(ep).read()
        n = cur.count(eo)
        if n != 1:
            for sp, ss in saved.items(): open(sp, 'w').write(ss)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n}): {name} [{ef}]'
        open(ep, 'w').write(cur.replace(eo, en, 1))
    try:
        reds = []
        for t in tests:
            r = subprocess.run(['node', 'scripts/run-tests.mjs', t], cwd=ROOT, capture_output=True, text=True, timeout=900)
            fails = [l.strip() for l in r.stdout.splitlines() if 'FAIL ' in l and '.test.mjs' not in l]
            reds.append((t, r.returncode, fails[:2]))
        killed = all(rc != 0 for _, rc, _ in reds)
        print(('KILLED  ' if killed else 'SURVIVED') + f'  {name}', flush=True)
        for t, rc, fl in reds: print(f'          {t}: exit {rc}  {fl}', flush=True)
        if not killed: bad += 1
    finally:
        for sp, ss in saved.items():
            open(sp, 'w').write(ss)
            assert open(sp).read() == ss, 'source not restored'
print('all killed' if not bad else f'{bad} survived')
sys.exit(1 if bad else 0)
