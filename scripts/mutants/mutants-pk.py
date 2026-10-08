#!/usr/bin/env python3
# peacefulkit mutants (10-07): each anchor must be present and UNIQUE; the source is restored after each; a mutant counts
# as KILLED only when the named test files go red against a baseline proven green first.
#   python3 scripts/mutants/mutants-pk.py <bots dir of a COPY of the candidate> [name filter...]
# Run it on a copy (cp -R src test scripts package.json eslint.config.mjs + a node_modules symlink), never the live tree.
import subprocess, sys, os
ROOT = sys.argv[1]
only = sys.argv[2:]
PK, CO, OR, SM = ['peacefulkit.test'], ['composter.test'], ['peacefulkit-order'], ['peacefulkit-smelt']
M = [
  # the craft
  ('craft: admission refusal deleted', 'src/admission.mjs', "      if (noSword) return { ok: false, reason: 'peaceful_no_sword', detail: noSword }\n", "", PK),
  ('craft: admission reads the switch as off', 'src/admission.mjs', "swordCraftRefusal(args.item, foodSkipNow(bot).active)", "swordCraftRefusal(args.item, false)", PK),
  ('craft: the skill-level refusal deleted', 'src/skills.mjs', "  if (noSword) return { status: 'no_effect', detail: noSword }\n", "", PK),
  ('craft: the refusal ignores the switch', 'src/peacefulkit.mjs', "  if (!active || !isSword(item)) return null", "  if (!isSword(item)) return null", PK),
  ('craft: the prompt still offers a sword', 'src/prompt.mjs', "      if (peaceful && isSword(name)) continue\n", "", PK),
  # the bank: no sword ever while on (owner 10-07 ~19:50Z)
  ('bank: a sword is banked while on', 'src/bankable.mjs', "    if (m && unwantedSword({ name }, noSwords)) { junk += n; excluded[name] = 'peaceful_sword'; continue }\n", "", PK),
  ('bank: the deposit forgets the switch', 'src/skills.mjs', "depositPlan(planItems, item, { wants: bot.currentWants ?? [], noSwords })", "depositPlan(planItems, item, { wants: bot.currentWants ?? [], noSwords: false })", PK),
  ('bank: the default excludes swords (off is not today)', 'src/bankable.mjs', "reserveScaffold = 8, noSwords = peacefulFoodActive() } = {}) {", "reserveScaffold = 8, noSwords = true } = {}) {", PK),
  ('bank: the default ignores the switch (spare swords count while peaceful)', 'src/bankable.mjs', "reserveScaffold = 8, noSwords = peacefulFoodActive() } = {}) {", "reserveScaffold = 8, noSwords = false } = {}) {", PK),
  ('bank: admission counts spare swords (a deposit due from swords)', 'src/admission.mjs', "      const bank = bankableInventory(items, { wants, noSwords: foodSkipNow(bot).active })\n", "      const bank = bankableInventory(items, { wants, noSwords: false })\n", PK),
  ('bank: depositWorthIt counts spare swords', 'src/skills.mjs', "    return depositDue({ bankable: bankableInventory(items, { wants, noSwords: foodSkipNow(bot).active }).count,", "    return depositDue({ bankable: bankableInventory(items, { wants, noSwords: false }).count,", PK),
  ('sword: unwantedSword ignores the switch', 'src/peacefulkit.mjs', "export const unwantedSword = (item, peacefulActive) => !!peacefulActive && isSword(item?.name)", "export const unwantedSword = (item, peacefulActive) => isSword(item?.name)", PK + SM),
  # the furnace
  ('fuel: stone swords burn too', 'src/peacefulkit.mjs', "unwantedSword(item, peacefulActive) && item?.name === 'wooden_sword'", "unwantedSword(item, peacefulActive)", PK),
  ('fuel: the skill never offers swords', 'src/skills.mjs', "swordFuel: swordFuelCount(bot.inventory?.items?.() ?? [], foodSkipNow(bot).active) })", "swordFuel: 0 })", SM),
  ('fuel: the switch is not re-read at the burn', 'src/skills.mjs', "        const active = foodSkipNow(bot).active\n        const copy", "        const active = true\n        const copy", SM),
  ('fuel: no refuel when a sword ignites', 'src/skills.mjs', "      if (queue.length && inp && slot('fuelItem') === null) await loadNext()\n", "", SM),
  ('fuel: a skipped sword is not replaced by ordinary fuel', 'src/skills.mjs', "    if (alt) queue.push({ name: alt.name, count: Math.min(", "    if (false) queue.push({ name: alt.name, count: Math.min(", SM),
  ('fuel: the substitution keeps the queued ordinary load (double count)', 'src/skills.mjs', "  const substitute = () => {\n    queue.length = 0\n", "  const substitute = () => {\n    const keep = queue.filter(q => !q.sword); queue.length = 0; queue.push(...keep)\n", SM),
  ('fuel: a sword into a warm furnace', 'src/skills.mjs', "        if (!(fslot('fuelItem') === null && h === 'cold')) return false\n", "        if (!(fslot('fuelItem') === null)) return false\n", SM),
  ('fuel: the heat ignores the block lit state', 'src/skills.mjs', "    if (f > 0 || lit === true) return 'warm'\n    if (f === 0 || lit === false) return 'cold'\n", "    if (f > 0) return 'warm'\n    if (f === 0) return 'cold'\n", SM),
  ('fuel: an unknown burn reading stalls the swords', 'src/skills.mjs', "        if (h === 'unknown' && ++unknownFuel > SWORD_UNKNOWN_POLLS) { substitute(); continue }\n", "", SM),
  ('fuel: a full bag takes the sword back (tossed)', 'src/skills.mjs', "      if (slot === 'fuelItem' && furnace.fuelItem()?.name === 'wooden_sword' &&", "      if (false &&", SM),
  ('fuel: the sword is taken whatever the room', 'src/skills.mjs', "          (furnace.emptySlotCount?.() ?? 0) === 0) { furnace.swordKept = true; noteSword('wooden_sword', 'kept_full'); continue }", "          (furnace.emptySlotCount?.() ?? 0) < 0) { furnace.swordKept = true; noteSword('wooden_sword', 'kept_full'); continue }", SM),
  ('fuel: the room read from the frozen bot.inventory', 'src/skills.mjs', "export async function drainFurnace (furnace, ms = SMELT_RECOVERY_MS, bot = null) {", "export async function drainFurnace (furnace, ms = SMELT_RECOVERY_MS, bot = null) {\n  const frozen = furnace?.emptySlotCount?.() ?? 0; if (furnace) furnace.emptySlotCount = () => frozen", SM),
  ('fuel: burn rows written mid-job (frozen snapshot)', 'src/skills.mjs', "  const swordRow = (status, what, active) => { swordRows.push({ status, what, active }) }", "  const swordRow = (status, what, active) => { swordRows.push({ status, what, active }); writeSwordRows() }", SM),
  ('fuel: a sword left by an earlier call is not taken back first', 'src/skills.mjs', "    if (fslot('fuelItem')?.name === 'wooden_sword') {\n      if ((furnace.emptySlotCount?.() ?? 0) === 0) {", "    if (false) {\n      if ((furnace.emptySlotCount?.() ?? 0) === 0) {", SM),
  ('fuel: an earlier sword taken back into a full bag', 'src/skills.mjs', "      if ((furnace.emptySlotCount?.() ?? 0) === 0) {\n        return { status: 'failed', failClass: 'inventory_full',", "      if (false) {\n        return { status: 'failed', failClass: 'inventory_full',", SM),
  ('fuel: a failed take-back still loads the input', 'src/skills.mjs', "      if (after !== null) {", "      if (false) {", SM),
  ('fuel: a sword on the cursor is ignored', 'src/skills.mjs', "      if (cursor) {\n        const back = await returnCursor(bot, furnace)", "      if (false) {\n        const back = await returnCursor(bot, furnace)", SM),
  ('fuel: the cursor sword is not put back', 'src/skills.mjs', "        const back = await returnCursor(bot, furnace)\n", "        const back = { returned: false, reason: 'skipped' }\n", SM),
  ('fuel: the drain never settles its cursor', 'src/skills.mjs', "      const c = await settleFurnaceCursor(bot, furnace, slot === 'outputItem' ? null : slot, bounded)\n", "      const c = 'empty'\n", SM),
  ('fuel: a cursor the bag refuses is not put back in the furnace', 'src/skills.mjs', "    try { if (furnace[origin]() == null) await bounded(bot.clickWindow(index, 0, 0)) } catch { /* judged by the cursor below */ }", "    try { void 0 } catch { /* judged by the cursor below */ }", SM),
  ('fuel: the cursor is not returned to the bag first', 'src/skills.mjs', "  try { const back = await bounded(returnCursor(bot, furnace)); if (back?.returned && !furnace.selectedItem) return 'bag' } catch { /* the slot it came from next */ }", "  try { void 0 } catch { /* the slot it came from next */ }", SM),
  ('fuel: a loaded cursor at the drain start is ignored', 'src/skills.mjs', "    const c = await settleFurnaceCursor(bot, furnace, null, bounded)\n", "    const c = 'empty'\n", SM),
  ('fuel: a dropped sword writes no row', 'src/skills.mjs', "  if (fate === 'cursor_lost') return { outcome: 'failed',", "  if (false) return { outcome: 'failed',", SM),
  ('fuel: an earlier sword put back is credited again', 'src/skills.mjs', "what: 'wooden_sword put back into the furnace fuel slot from the cursor (left by an earlier call)'", "what: 'wooden_sword left in the furnace fuel slot (the cursor could not be emptied into the bag)'", SM),
  ('fuel: the restage mark is never written', 'src/skills.mjs', "      if (SINK_ROW.test(what) && retrieved > 0) { retrieved -= 1; mark = ' restaged=1' }", "      if (false) { retrieved -= 1; mark = ' restaged=1' }", SM),
  ('fuel: a take-back is not counted for the restage mark', 'src/skills.mjs', "      retrieved += 1\n", "", SM),
  ('fuel: a stuck cursor with room is called a drop', 'src/skills.mjs', "  const stuckFate = () => { try { return (furnace?.emptySlotCount?.() ?? 0) > 0 ? 'cursor_server_returns' : 'cursor_lost' } catch { return 'cursor_lost' } }", "  const stuckFate = () => 'cursor_lost'", SM),
  ('fuel: a stuck cursor does not end the drain', 'src/skills.mjs', "      else if (c === 'stuck') { stuck = name ?? '?'; break }", "      else if (c === 'stuck') { stuck = name ?? '?' }", SM),
  ('fuel: a timed-out take is called taken', 'src/skills.mjs', "{ timedOut = true; noteSword(name, 'timed_out') } else noteSword(name, 'taken')", "{ timedOut = true; noteSword(name, 'taken') } else noteSword(name, 'taken')", SM),
  ('fuel: a timed-out take skips the cursor settle', 'src/skills.mjs', "{ timedOut = true; noteSword(name, 'timed_out') } else", "{ timedOut = true; noteSword(name, 'timed_out'); break } else", SM),
  ('fuel: a timed-out sword is credited as burned', 'src/skills.mjs', "  if (fate === 'timed_out') return {", "  if (false) return {", SM),
  ('fuel: a sword that burned in the drain gap says returned', 'src/skills.mjs', "  return { outcome: 'success', what: 'burned wooden_sword (unconfirmed)' }", "  return { outcome: 'no_effect', what: 'wooden_sword returned unburned' }", SM),
  ('fuel: a drain that never reached the sword says returned', 'src/skills.mjs', "  if (inSlot === true) return", "  if (false) return", SM),
  ('fuel: an unreadable furnace claims a burn', 'src/skills.mjs', "    if (staged && fuelNow === undefined) {", "    if (false) {", SM),
  ('fuel: a late-reported burn writes no row', 'src/skills.mjs', "    if (staged && !left) {", "    if (false) {", SM),
  ('fuel: a burn counted without confirmation', 'src/skills.mjs', "    if (staged && fslot('fuelItem') === null && (heat() === 'warm' || (fslot('inputItem')?.count ?? 0) < staged.input)) {", "    if (staged) {", SM),
  ('bank: admission admits a named sword deposit', 'src/admission.mjs', "      if (arg.item && unwantedSword({ name: arg.item }, foodSkipNow(bot).active)) {", "      if (false) {", PK),
  ('fuel: the plan puts swords last', 'src/smelting.mjs', "  const queue = [...Array.from({ length: swordsUsed }, () => ({ name: 'wooden_sword', count: 1, sword: true })),\n                 ...(fuelCount > 0 ? [{ name: usable.name, count: fuelCount }] : [])]",
   "  const queue = [...(fuelCount > 0 ? [{ name: usable.name, count: fuelCount }] : []),\n                 ...Array.from({ length: swordsUsed }, () => ({ name: 'wooden_sword', count: 1, sword: true }))]", SM),
  ('fuel: a sword covers two items', 'src/smelting.mjs', "    swordsUsed = Math.min(swords, batch)            // a sword smelts exactly one item", "    swordsUsed = Math.min(swords, Math.ceil(batch / 2))", SM),
  ('fuel: a sword can start a smelt', 'src/skills.mjs', "  const dry = smeltPlan({ held: heldMap(bot), item, count,", "  const dry = smeltPlan({ held: heldMap(bot), item, count, swordFuel: swordFuelCount(bot.inventory?.items?.() ?? [], true),", SM),
  ('fuel: no _sword_fuel row', 'src/skills.mjs', "    try { logEvent({ kind: 'sword_fuel', status, snapshot: snapshot(bot),", "    try { void ({ kind: 'sword_fuel', status, snapshot: snapshot(bot),", SM),
  # the sweep
  ('sweep: the sword filter deleted', 'src/skills.mjs', "      !skipSwordDrop(e, food.active) &&                                // nor a sword (peacefulkit.mjs, the same switch)\n", "", PK),
  ('sweep: skipSwordDrop never skips', 'src/peacefulkit.mjs', "  try { return isSword(entity?.getDroppedItem?.()?.name) } catch { return false }", "  return false", PK),
  # the switch
  ('switch: the packet does not refresh the decision', 'src/foodskip.mjs', "if (d) { bot.serverDifficulty = d; setPeacefulFood(foodSkipActive(mode, d)) }", "if (d) { bot.serverDifficulty = d }", PK),
  ('switch: no decision at attach (on mode)', 'src/foodskip.mjs', "  setPeacefulFood(foodSkipActive(mode, difficultyOf(bot)))\n", "", PK),
  ('switch: the kit row is never written', 'src/skills.mjs', "    try { logEvent({ kind: 'peaceful_kit', status: 'success', detail: peacefulKitDetail({ mode: FOOD_SKIP.mode, difficulty, active }) }) } catch { /* never break a pickup */ }\n", "", PK),
  # the composter
  ('compost: the allowance drops the plants clause', 'src/composter.mjs', "(plants && isPeacefulCompost(it.name) && !NEVER_COMPOST.test(it.name))", "false", PK + CO),
  ('compost: the list loses wildflowers', 'src/peacefulkit.mjs', "  wildflowers: 0.3, pink_petals: 0.3, cactus_flower: 0.3,", "  pink_petals: 0.3, cactus_flower: 0.3,", PK + CO),
  ('compost: the list loses bread', 'src/peacefulkit.mjs', "firefly_bush: 0.3, bush: 0.3, bread: 0.85,", "firefly_bush: 0.3, bush: 0.3,", PK + CO),
  ('compost: the list gains carrot', 'src/peacefulkit.mjs', "  melon_slice: 0.5, kelp: 0.3,", "  melon_slice: 0.5, kelp: 0.3, carrot: 0.65,", PK + CO),
  ('saplings: every species keeps 16 while on', 'src/composter.mjs', "(plants ? peacefulSaplingReserve(name, SAPLING_RESERVE) : SAPLING_RESERVE)", "SAPLING_RESERVE", PK + CO),
  ('saplings: oak and birch keep none while on', 'src/peacefulkit.mjs', "  return KEPT_SAPLINGS.includes(name) ? base : 0", "  return 0", PK + CO),
  ('saplings: other species keep 16 while on', 'src/peacefulkit.mjs', "  return KEPT_SAPLINGS.includes(name) ? base : 0", "  return base", PK + CO),
  ('compost: the skill never passes plants', 'src/skills.mjs', "const apples = foodSkipNow(bot).active, plants = apples", "const apples = foodSkipNow(bot).active, plants = false", CO),
  ('compost: the insert loop drops plants', 'src/skills.mjs', "nextInsert(items(), { room, apples, plants })", "nextInsert(items(), { room, apples })", CO),
  ('compost: the skill composts plants while OFF', 'src/skills.mjs', "const apples = foodSkipNow(bot).active, plants = apples", "const apples = foodSkipNow(bot).active, plants = true", CO),
  ('compost: the row loses its complete map', 'src/skills.mjs', "args: { items: { ...(f?.items ?? {}) }, peaceful,", "args: { peaceful,", CO),
  ('compost: the kit plants lose their rank', 'src/composter.mjs', ": (peacefulRank(name) ?? 5)", ": 5", PK),
  ('compost: startable ignores a full bag', 'src/composter.mjs', "  if (!plan.junk || boneMealRoom(items)) return plan.junk\n", "  return plan.junk\n", PK),
  ('compost: startable counts a bag with nothing to start', 'src/composter.mjs', "  if (!nx) return 0\n", "  if (!nx) return plan.junk\n", PK),
  ('compost: startable ignores the level', 'src/composter.mjs', "  return fillDecision({ level: Number.isInteger(L) ? L : 0, room: false, smallest: nx.n }) === 'insert' ? plan.junk : 0", "  return nx.n <= 7 ? plan.junk : 0", PK),
  ('guard: only while the switch is on (not general)', 'src/cognitive.mjs', "junk: startableJunk(items, { apples: peaceful, plants: peaceful,", "junk: !peaceful ? plan.junk : startableJunk(items, { apples: peaceful, plants: peaceful,", OR),
  ('compost: the town order drops plants', 'src/cognitive.mjs', "startableJunk(items, { apples: peaceful, plants: peaceful,", "startableJunk(items, { apples: peaceful, plants: false,", OR),
  ('compost: the town order counts plants while OFF', 'src/cognitive.mjs', "startableJunk(items, { apples: peaceful, plants: peaceful,", "startableJunk(items, { apples: peaceful, plants: true,", OR),
  ('compost: an interrupted visit writes no row', 'src/skills.mjs', "      row('aborted', { levelBefore,", "      void ({ levelBefore,", CO),
  ('compost: a death mid-insert is credited to the composter', 'src/skills.mjs', "      if (before - after > 1) {", "      if (false) {", CO),
  ('compost: the in-flight name is not written', 'src/skills.mjs', "inflight: inflight?.name ?? null,", "inflight: null,", CO),
  ('compost: the classifier ignores lost plants', 'src/skills.mjs', "((k === 'apple' || isPeacefulCompost(k)) && peacefulFoodActive())", "(k === 'apple' && peacefulFoodActive())", PK),
  ('compost: the classifier counts plants while OFF', 'src/skills.mjs', "((k === 'apple' || isPeacefulCompost(k)) && peacefulFoodActive())", "(isPeacefulCompost(k) || (k === 'apple' && peacefulFoodActive()))", PK),
  ('compost: the sapling reserve halved', 'src/composter.mjs', "export const SAPLING_RESERVE = 16", "export const SAPLING_RESERVE = 8", PK + CO),
  ('compost: the apple reserve dropped', 'src/composter.mjs', "export const APPLE_RESERVE = 4", "export const APPLE_RESERVE = 0", PK + CO),
]
# THE 92bc84f VARIANT (towndeposit): PK_VARIANT=1 adds these (their anchors exist only there).
TD = ['towndeposit']
if os.environ.get('PK_VARIANT'):
    M += [
  ('td: the town-deposit trigger counts spare swords', 'src/cognitive.mjs', "townDepositPlan(items, { wanted, noSwords: foodSkipNow(bot).active })", "townDepositPlan(items, { wanted, noSwords: false })", TD),
  ('td: the skill plans swords into the chest', 'src/skills.mjs', "townDepositPlan(bag, { wanted, already, noSwords: foodSkipNow(bot).active })", "townDepositPlan(bag, { wanted, already, noSwords: false })", TD),
  ('td: the plan default ignores the switch', 'src/towndeposit.mjs', "noSwords = peacefulFoodActive() } = {}) {", "noSwords = false } = {}) {", TD),
    ]
# THE COBBLE-CAP COMPOSITION (stonecap-01 coupled on junkwell-02-on-peacefulkit, 10-08): admission reads the switch ONCE
# (const noSwords = foodSkipNow(bot).active) for the bank count AND the cap's empty-plan refusal. PK_COMPOSED=1 swaps the
# admission mutant for these (their anchors exist only there).
if os.environ.get('PK_COMPOSED'):
    M = [m for m in M if m[0] != 'bank: admission counts spare swords (a deposit due from swords)']
    M += [
  ('bank (composition): admission reads the switch as off for both checks', 'src/admission.mjs', "      const noSwords = foodSkipNow(bot).active\n      const bank = bankableInventory(items, { wants, noSwords })\n", "      const noSwords = false\n      const bank = bankableInventory(items, { wants, noSwords })\n", PK),
  ("bank (composition): the cap's empty-plan check counts spare swords", 'src/admission.mjs', "      if (!depositPlan(items, args?.item ?? null, { wants, noSwords }).length && !reconcile) {", "      if (!depositPlan(items, args?.item ?? null, { wants, noSwords: false }).length && !reconcile) {", PK),
    ]
bad = 0
if ROOT == '--read-only':   # the read's mutants only (PK_READ): python3 mutants-pk.py --read-only
    M = []
for t in sorted({t for m in M for t in m[4]}):
    r = subprocess.run(['node', 'scripts/run-tests.mjs', t], cwd=ROOT, capture_output=True, text=True, timeout=1200)
    assert r.returncode == 0, f'BASELINE RED: {t} fails before any mutant -- every "killed" would be false\n{r.stdout[-800:]}'
print('baseline green:', sorted({t for m in M for t in m[4]}), flush=True)
for name, f, old, new, tests in M:
    if only and not any(o in name for o in only):
        continue
    p = os.path.join(ROOT, f)
    src = open(p).read()
    n = src.count(old)
    assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n}): {name}'
    open(p, 'w').write(src.replace(old, new, 1))
    try:
        reds = []
        for t in tests:
            r = subprocess.run(['node', 'scripts/run-tests.mjs', t], cwd=ROOT, capture_output=True, text=True, timeout=1200)
            reds.append((t, r.returncode))
        killed = any(rc != 0 for _, rc in reds)
        print(('KILLED  ' if killed else 'SURVIVED') + f'  {name}  ' + ' '.join(f'{t}:exit{rc}' for t, rc in reds), flush=True)
        if not killed:
            bad += 1
    finally:
        open(p, 'w').write(src)
        assert open(p).read() == src, 'source not restored'
# THE READ's predicates (Codex r1: none of the mutants exercised the read): each must turn --selftest red.
READ = os.environ.get('PK_READ')   # scripts/host/peacefulkitread.py (a copy: it is mutated in place and restored)
RM = [
  ('read: a cut detail keeps its last pair', "        if cut:\n            pairs = pairs[:-1]\n", "        if cut:\n            pass\n"),
  ('read: args.items ignored', "    if isinstance(a.get('items'), dict):\n        out = {k", "    if False:\n        out = {k"),
  ('read: crafted accepts any sword gain', "    return item if pat.search(item) and isinstance(d, (int, float)) and d > 0 else None",
   "    return item if pat.search(item) or any(pat.search(n) and v > 0 for n, v in (sk.get('inventory_delta') or {}).items()) else None"),
  ('read: took ignores the bank rows', "    if (sk or {}).get('name') not in BANK_ROWS:\n        return []\n    return sorted(n for n, v", "    if False:\n        return []\n    return sorted(n for n, v"),
  ('read: burned_sword reads any row', "    if (sk or {}).get('name') != 'smelt':\n        return 0", "    if False:\n        return 0"),
  ('read: burned_fuel counts a sword', "    return any(FUEL_NAMES.match(n) and not is_input(n)", "    return any((FUEL_NAMES.match(n) or n == 'wooden_sword') and not is_input(n)"),
  ('read: burned_fuel counts the input logs', "    return any(FUEL_NAMES.match(n) and not is_input(n)", "    return any(FUEL_NAMES.match(n)"),
  ('read: a confirmed burn is not a sink', "    if sb and sb[0] in ('burned', 'in_furnace'):", "    if False:"),
  ('read: a smelt delta is a sink again', "    if name in BANK_ROWS:\n        L.bank(end, start, delta, kind='banked')", "    if name in BANK_ROWS or name == 'smelt':\n        L.bank(end, start, delta, kind='banked')"),
  ('read: sword_burn reads any row', "    if (sk or {}).get('name') != '_sword_fuel':\n        return None", "    if False:\n        return None"),
  ('read: a burn row\'s state ignored', "    kind = 'burned' if m.group(1).startswith('burned')", "    kind = 'returned' if m.group(1).startswith('burned')"),
  ('read: death_in never true', "    return any((start - d).total_seconds() <= 5 and (d - end).total_seconds() <= 5 for d in deaths)", "    return False"),
  ('read: other saplings keep 16 while on', "    return SAPLING_RESERVE if (name in KEPT_SAPLINGS or not active) else 0", "    return SAPLING_RESERVE"),
  ('read: oak keeps none while on', "    return SAPLING_RESERVE if (name in KEPT_SAPLINGS or not active) else 0", "    return SAPLING_RESERVE if not active else 0"),
  ('read: the sapling reserve check off by one', "int(inv.get(n, 0) or 0) < sapling_reserve(n, active)", "int(inv.get(n, 0) or 0) < sapling_reserve(n, active) - 1"),
  ('read: the apple reserve dropped', "        if n == 'apple' and int(inv.get('apple', 0) or 0) < APPLE_RESERVE:", "        if False:"),
  ('read: off_list allows everything', "    return sorted(n for n, c in items.items() if c > 0 and not (n in allowed or SAPLING.search(n)))", "    return []"),
  ('read: the ledger never credits the bank', "k = min(left, p[2]); p[2] -= k; left -= k; self.n[kind] += k", "k = 0; left = 0"),
  ('read: any later rise cancels a loss', "(t - p[0]).total_seconds() <= RESTORE_S", "True"),
  ('read: an empty bag is a fall', "        if not isinstance(inv, dict) or not inv:\n            return", "        if not isinstance(inv, dict):\n            return"),
  ('read: deaths explain nothing', "            if any(-DEATH_BEFORE_S <= (p[0] - d).total_seconds() <= DEATH_AFTER_S for d in self.deaths):", "            if False:"),
  ('read: skill rows timed at their start', "        return t, t + dt.timedelta(milliseconds=float(ms))", "        return t, t"),
  ('read: a respawn after 180 s is a loss', "                    self.n['death'] += -d   # a death since", "                    self.pending.append([t, name, -d]); 0   # a death since"),
  ('read: an interrupted row reads as complete', "            return out, False\n", "            return out, True\n"),
  ('read: the in-flight name is ignored', "                out[a['inflight']] = out.get(a['inflight'], 0) + 1\n", "                pass\n"),
  ('read: a reserve judged on an aborted visit', "complete and status != 'aborted' and inv", "complete and inv"),
  ('read: a reserve judged right after a death', "not (last_death is not None and (t - last_death).total_seconds() <= 120)", "True"),
  ('read: the calibration never fires', "                if any(nm == p[1] and 0 <= (p[0] - bt).total_seconds() <= 60 for bt, nm in self.banks):", "                if False:"),
  # (the main loop's own lines -- e.g. `ver = verified_items(sk)` -> `ver = items` -- are not reachable by --selftest,
  #  which tests the predicates; the loop calls them by name. Checked by the dry run and review, not by a mutant.)
  ('read: verified_items includes the in-flight name', "        return {k: int(v) for k, v in a['items'].items() if isinstance(v, (int, float)) and v > 0}\n    return compost_items(sk)[0]", "        return compost_items(sk)[0]\n    return compost_items(sk)[0]"),
  ('read: a sink credit is not kept for a later fall', "SINK_CARRY_S = 180", "SINK_CARRY_S = -1"),
  ('read: a sink credit kept forever', "0 <= (t - c[0]).total_seconds() <= SINK_CARRY_S", "0 <= (t - c[0]).total_seconds()"),
  ('read: a sword put back from the cursor is not credited', "^(burned wooden_sword|wooden_sword returned unburned|wooden_sword left in the furnace fuel slot)", "^(burned wooden_sword|wooden_sword returned unburned|wooden_sword left in the furnace fuel slot \\(the bag)"),
  ('read: an earlier sword put back is credited', "|wooden_sword left in the furnace fuel slot).* active=", "|wooden_sword left in the furnace fuel slot|wooden_sword put back).* active="),
  ('read: a restaged row is credited (double credit)', "        if RESTAGED in ((sk or {}).get('detail') or ''):", "        if False:"),
  ('read: every sink row is treated as restaged', "        if RESTAGED in ((sk or {}).get('detail') or ''):", "        if True:"),
  ('read: a cursor drop is not a K2 breach', "    return (sk or {}).get('name') == '_sword_fuel' and (sk.get('detail') or '').startswith('wooden_sword on the cursor at the close (the server drops it)')", "    return False"),
  ('read: a cursor the server returns to the bag is a breach', "startswith('wooden_sword on the cursor at the close (the server drops it)')", "startswith('wooden_sword on the cursor at the close')"),
  ('read: late falls count as lost', "            elif (end - p[0]).total_seconds() < LATE_S:", "            elif False:"),
]
if READ and not only:
    r = subprocess.run(['python3', READ, '--selftest'], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, 'READ BASELINE RED: ' + r.stderr[-400:]
    for name, old, new in RM:
        src = open(READ).read()
        n = src.count(old)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n}): {name}'
        open(READ, 'w').write(src.replace(old, new, 1))
        try:
            r = subprocess.run(['python3', READ, '--selftest'], capture_output=True, text=True, timeout=120)
            killed = r.returncode != 0
            print(('KILLED  ' if killed else 'SURVIVED') + f'  {name}  selftest:exit{r.returncode}', flush=True)
            if not killed:
                bad += 1
        finally:
            open(READ, 'w').write(src)
            assert open(READ).read() == src, 'read not restored'
print('all killed' if not bad else f'{bad} survived')
sys.exit(1 if bad else 0)
