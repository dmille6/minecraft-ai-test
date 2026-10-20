// BAGBUDGET-01 x IRONPICK-01 (the composition, ironpick-on-<tk3 x bagbudget>): the bag allowance (last-swing keeps NO spent
// pickaxe while the bag holds a stone pickaxe's stone; a full bag at town banks the chest rows) meets the kit's iron pickaxe (the
// worn copy is kept and dug down first; the room plan reserves one slot per crafted tool). Behaviour over the real pure
// decisions -- the refusal CHAIN, not each guard alone (CLAUDE.md):
//   1. WEAR-OUT x THE WORN COPY: the allowance's wear-out lists only exactly-1-use copies -- never the worn iron copy the kit
//      replaced (30 uses), never the fresh one; and it never changes what the kit decides (ironPickNeed / kitDraw before == after);
//   2. THE CRAFT'S MAKE-ROOM x THE KIT'S PICKAXE CRAFT: craftRoomRemedy (it reads the wear-out plan) frees a 1-use copy, never
//      the worn iron copy and never the last digging pickaxe, allowance on or off;
//   3. A FULL BAG AT TOWN whose only surplus is the allowance's rows: the kit's room plan (draw + tools) says no; the town
//      deposit's allowance frees exactly those slots; then the kit's order is issued (no dead end between the two).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-bagbudget-ironpick'
process.env.BOT_NAME = process.env.BOT_NAME || 'BagPickBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'bbi-pool-'))
delete process.env.BAG_ALLOWANCE      // the shipped defaults (on)
delete process.env.TOOLKIT_IRONPICK

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

const { BAG_ALLOWANCE, ALLOWANCE } = await import('../src/bagallowance.mjs')
const { wearOutPlan, TRIGGER_SLOTS } = await import('../src/hygiene.mjs')
const { craftRoomRemedy } = await import('../src/craftroom.mjs')
const { townDepositPlan } = await import('../src/towndeposit.mjs')
const { ironPickNeed, kitDraw, kitRoomTakes, toolkitOrder, TOOLKIT_IRONPICK, IRONPICK_TRIP_USES } = await import('../src/toolkit.mjs')
const { roomPlan, roomKeep } = await import('../src/withdrawpick.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { remaining } = await import('../src/toolfor.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$/
function item (name, count = 1, slot = 9, uses = null) {
  const def = mcData.itemsByName[name]
  assert.ok(def, `unknown item ${name}`)
  const it = { name, count, slot, type: def.id, stackSize: def.stackSize }
  if (TOOL.test(name)) { it.maxDurability = def.maxDurability; it.durabilityUsed = uses == null ? 0 : def.maxDurability - uses }
  return it
}
const bagOf = rows => rows.map(([name, count, uses], i) => item(name, count, 9 + i, uses ?? null))
const fill = (rows, n = 36) => { const r = [...rows]; while (r.length < n) r.push(['oak_slab', 1 + (r.length % 3)]); return bagOf(r) }
const tag = it => `${it.name}@${remaining(it)}`
const listed = (bag, o) => wearOutPlan(bag, o).tools.map(tag).sort()
const without = (bag, gone) => bag.filter(it => !gone.includes(it))
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296 }

await t('the shipped defaults: BAG_ALLOWANCE on, TOOLKIT_IRONPICK on (else the compositions below are vacuous)', () => {
  assert.equal(BAG_ALLOWANCE.on, true); assert.equal(TOOLKIT_IRONPICK.on, true)
  assert.equal(ALLOWANCE.lastSwingCobble, 3); assert.equal(IRONPICK_TRIP_USES, 40); assert.equal(TRIGGER_SLOTS, 34)
})

// ------------------------------------------------------------------------------- 1. WEAR-OUT x THE WORN COPY ---
async function wearScene (HY = { wearOutPlan }) {
  // a full bag after a kit run: the fresh iron copy (250), the worn copy it replaced (30), the worn copy dug down to 1, a spent
  // stone copy; 64 cobble (>= lastSwingCobble: the allowance keeps no spent pickaxe for last-swing)
  const bag = fill([['iron_pickaxe', 1, 250], ['iron_pickaxe', 1, 30], ['iron_pickaxe', 1, 1], ['stone_pickaxe', 1, 1], ['cobblestone', 64], ['stick', 6]])
  assert.deepEqual(HY.wearOutPlan(bag).tools.map(tag).sort(), ['iron_pickaxe@1', 'stone_pickaxe@1'], 'the allowance: both spent copies go, the worn and the fresh copy never')
  // CONTROL: no stone in the bag -> last-swing keeps its three spent copies (the base rule)
  const noStone = bag.map(it => (it.name === 'cobblestone' ? item('oak_slab', 2, it.slot) : it))
  assert.deepEqual(HY.wearOutPlan(noStone).tools.map(tag), [], 'without the stone the spent copies are last-swing\'s')
  assert.deepEqual(HY.wearOutPlan(bag, { allowance: false }).tools.map(tag), [], 'and BAG_ALLOWANCE=off keeps them too')
}
await t('WEAR-OUT x THE KIT\'S WORN COPY: with cobble the allowance wears out the 1-use copies only -- the worn iron@30 and the fresh iron@250 stay', () => wearScene())
await t('SEEDED RANDOM FULL BAGS (300): the allowance\'s wear-out never removes a copy above 1 use, and never changes the kit\'s decision', () => {
  const r = rng(20261020)
  const picks = ['iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe', 'diamond_pickaxe', 'golden_pickaxe']
  let acted = 0
  for (let i = 0; i < 300; i++) {
    const rows = []
    for (let k = 0; k < 1 + Math.floor(r() * 5); k++) {
      const n = picks[Math.floor(r() * picks.length)], max = mcData.itemsByName[n].maxDurability
      const u = [1, 1, 2, 5, 30, 40, 41, max][Math.floor(r() * 8)]
      rows.push([n, 1, Math.min(u, max)])
    }
    if (r() < 0.5) rows.push(['iron_axe', 1, 1 + Math.floor(r() * 250)])
    if (r() < 0.7) rows.push(['cobblestone', 1 + Math.floor(r() * 64)])
    if (r() < 0.5) rows.push(['stick', 1 + Math.floor(r() * 9)])
    const bag = fill(rows, TRIGGER_SLOTS + Math.floor(r() * 3))
    const gone = wearOutPlan(bag).tools
    if (gone.length) acted++
    assert.ok(gone.every(it => remaining(it) === 1), `bag ${i}: a copy above 1 use was listed: ${gone.map(tag)}`)
    const left = without(bag, gone)
    assert.equal(ironPickNeed(left), ironPickNeed(bag), `bag ${i}: the kit's need changed: ${rows.map(String)}`)
    assert.deepEqual(kitDraw(left).needs, kitDraw(bag).needs, `bag ${i}`)
  }
  assert.ok(acted >= 60, `the wear-out acted in only ${acted} of 300 bags: the property would be vacuous`)
})

// ------------------------------------------------------------- 2. THE CRAFT'S MAKE-ROOM x THE KIT'S PICKAXE CRAFT ---
async function makeRoomScene (CR = { craftRoomRemedy }) {
  // the kit's iron_pickaxe craft into a full bag holding the worn iron copy, a spent iron copy and cobble
  const bag = fill([['iron_pickaxe', 1, 30], ['iron_pickaxe', 1, 1], ['cobblestone', 64], ['iron_ingot', 3], ['stick', 4]])
  for (const allowance of [true, false]) {
    const r = CR.craftRoomRemedy(bag, 'iron_pickaxe', { allowance })
    assert.equal(r && tag(r.tool), 'iron_pickaxe@1', `allowance=${allowance}: the 1-use copy makes the room, never the worn copy: ${JSON.stringify(r && tag(r.tool))}`)
    // on: the allowance's wear-out plan lists it ('spent'); off: last-swing keeps it, the pickaxe craft's own one-copy rule ('replaced')
    assert.equal(r.why, allowance ? 'spent' : 'replaced', `allowance=${allowance}: which path freed it`)
  }
  // the worn copy dug all the way down: two 1-use copies and nothing above -- no make-room may take the last digging pickaxe
  const last = fill([['iron_pickaxe', 1, 1], ['stone_pickaxe', 1, 1], ['cobblestone', 64], ['iron_ingot', 3], ['stick', 4]])
  assert.equal(CR.craftRoomRemedy(last, 'iron_pickaxe'), null, 'no survivor with 2+ uses: nothing is worn out')
}
await t('MAKE-ROOM x THE KIT\'S CRAFT: craftRoomRemedy frees the 1-use copy (allowance on or off), never the worn iron@30; never the last pickaxe', () => makeRoomScene())

// ------------------------------------------- 3. A FULL BAG AT TOWN: the allowance's slots are the kit's room ---
await t('FULL BAG AT TOWN (the ironpickfull bag with the allowance\'s rows, nothing else bankable): kit room NO -> the allowance banks 3 stacks -> the kit\'s order is issued', () => {
  clearWithdrawHolds()
  const bag = fill([['iron_pickaxe', 1, 30], ['iron_axe', 1, 200], ['stick', 9], ['crafting_table', 1], ['torch', 30], ['bone_meal', 20], ['ladder', 10]])
  assert.equal(bag.length, 36)
  const keep = [...roomKeep([]), 'iron_ingot']
  const order = items => toolkitOrder({ now: 1e9, atTown: true, items, container: true, townMiss: false, tableNear: () => true, state: {},
    room: d => roomPlan(items, kitRoomTakes(d), { keep }).ok }).order
  const d = kitDraw(bag)
  assert.deepEqual(d.needs, ['iron_pickaxe', 'iron_shovel'])
  assert.equal(roomPlan(bag, kitRoomTakes(d), { keep }).ok, false, 'CONTROL: the kit\'s own room plan cannot bank the allowance\'s rows')
  assert.equal(order(bag), null, 'so no kit order into this bag')
  const p = townDepositPlan(bag, { wanted: [], noSwords: false, fullBag: true, rows: true })
  assert.deepEqual(p.steps.filter(s => s.allowance).map(s => s.name).sort(), ['bone_meal', 'ladder', 'torch'])
  assert.ok(p.steps.every(s => !TOOL.test(s.name) && s.name !== 'stick' && s.name !== 'crafting_table'), 'never the kit\'s tools, sticks or table')
  const out = new Set(p.steps.map(s => s.slot))
  const left = bag.filter(it => !out.has(it.slot))
  assert.equal(left.length, 33)
  assert.deepEqual(kitDraw(left), d, 'the same draw after the visit')
  assert.equal(order(left)?.skill, 'toolkit', 'the allowance\'s three slots are the room for the 4 ingots and the two tools')
  // CONTROL: deletion first (rows=false) frees nothing for the kit here
  const held = townDepositPlan(bag, { wanted: [], noSwords: false, fullBag: true, rows: false })
  assert.equal(held.steps.length, 0)
})

// ------------------------------------------------------------------------------------------------ mutants ---
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }   // a crash is not a kill
await t('MUTANTS: the wear-out listing worn (not only spent) copies, or the make-room ignoring the survivor rule, is seen by the scenes above', async () => {
  const HY_PATH = new URL('../src/hygiene.mjs', import.meta.url)
  const CR_PATH = new URL('../src/craftroom.mjs', import.meta.url)
  const kills = {
    // the allowance's 0-kept rule applied to every pickaxe up to the trip line: the worn copy the kit replaced is worn out
    wornListed: await withMutant(HY_PATH, 'const keepSpent = allowance && cobble >= ALLOWANCE.lastSwingCobble ? 0 : SPENT_PICKAXES_KEPT',
      'const keepSpent = allowance && cobble >= ALLOWANCE.lastSwingCobble ? 0 : SPENT_PICKAXES_KEPT; rest.push(...list.filter(it => /_pickaxe$/.test(it.name) && (it.maxDurability - (it.durabilityUsed ?? 0)) > 1 && (it.maxDurability - (it.durabilityUsed ?? 0)) <= 40))',
      M => killedBy(() => wearScene(M))),
    // the make-room without the survivor rule: the last digging pickaxe goes
    noSurvivor: await withMutant(CR_PATH, 'const planned = wearOutPlan(list, { allowance }).tools.find(t => !/_pickaxe$/.test(t.name) || survives(t))',
      'const planned = wearOutPlan(list, { allowance }).tools[0]', M => killedBy(() => makeRoomScene(M))),
  }
  const survived = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(survived, [], `mutants survived: ${survived.join(', ')}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
