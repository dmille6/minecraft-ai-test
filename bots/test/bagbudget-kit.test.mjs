// BAGBUDGET-01 x TOOLKIT-03 (the composition, tk3-on-31416ee): the bag allowance banks a full bag's chest rows at the town
// deposit; the kit and the smelt job draw from the same town. Two individually-correct layers meeting on one bag, so the
// test is the COMPOSITION, by behaviour over the real pure decisions (CLAUDE.md "test the refusal CHAIN"):
//   1. the allowance never banks what the kit or the smelt job draws or crafts with -- the kit's draw, its means (the carried
//      table, the wood for sticks) and every tool are the same before and after the allowance's steps leave the bag (seeded
//      random full bags, with a positive control that the allowance DID bank something in each);
//   2. a full bag the allowance frees (one worked fixture): the kit's room (withdrawpick roomPlan, the order's own check) goes
//      from no to yes with the same draw.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-bagbudget-kit'
process.env.BOT_NAME = process.env.BOT_NAME || 'BagKitBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'bbk-pool-'))
delete process.env.BAG_ALLOWANCE   // the shipped default (on)

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

const { townDepositPlan, TD_TRIGGER_SLOTS } = await import('../src/towndeposit.mjs')
const BA = await import('../src/bagallowance.mjs')
const { BAG_ALLOWANCE } = BA
const { kitDraw, kitMeans, TOWN_IRON_KEEP } = await import('../src/toolkit.mjs')
const { roomPlan, roomKeep } = await import('../src/withdrawpick.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')

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
const after = (bag, plan) => { const out = new Set(plan.steps.map(s => s.slot)); return bag.filter(it => !out.has(it.slot)) }
const allowOnly = plan => ({ steps: plan.steps.filter(s => s.allowance) })
const allowNames = plan => plan.steps.filter(s => s.allowance).map(s => s.name)
// what the kit and the smelt job read from a bag (toolkit.mjs kitDraw / kitMeans; the smelt job's fuel and copper)
const kitView = bag => ({ draw: kitDraw(bag), means: kitMeans(bag), means_table: kitMeans(bag, { tableNear: true }),
  tools: bag.filter(it => TOOL.test(it.name)).map(it => `${it.name}@${it.maxDurability - it.durabilityUsed}`).sort(),
  smelt: ['coal', 'charcoal', 'raw_copper', 'copper_ingot', 'raw_iron', 'iron_ingot'].map(n => bag.filter(it => it.name === n).reduce((a, b) => a + b.count, 0)),
  // a station is HELD or not (row K keeps one: a second furnace banked is no loss to any job)
  stations: ['crafting_table', 'furnace'].map(n => bag.some(it => it.name === n)) })

// a seeded PRNG (mulberry32): the bags are random but the run is reproducible
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296 }

await t('the shipped default: BAG_ALLOWANCE on (else every negative below is vacuous)', () => {
  assert.equal(BAG_ALLOWANCE.on, true)
})

await t('A FULL BAG AT TOWN: the allowance banks its chest rows; the kit\'s draw, means and tools and the smelt job\'s inputs are UNCHANGED', () => {
  clearWithdrawHolds()
  // the kit's view of this bag: no iron axe/shovel (the draw), 9 sticks, one carried table, planks; the smelt job's coal/copper;
  // the allowance's rows: torches, bone meal, a short ladder stack, a second crafting table and a second furnace in own slots
  const rows = [['stone_pickaxe', 1, 90], ['stick', 9], ['crafting_table', 1], ['crafting_table', 1], ['furnace', 1], ['furnace', 1],
    ['oak_planks', 12], ['coal', 20], ['raw_copper', 16], ['iron_ingot', 3], ['torch', 30], ['bone_meal', 20], ['ladder', 10]]
  while (rows.length < 36) rows.push(['oak_slab', 1 + (rows.length % 3)])
  const bag = bagOf(rows)
  assert.equal(bag.length, 36)
  const p = townDepositPlan(bag, { wanted: [], noSwords: false, fullBag: true, rows: true })
  // POSITIVE CONTROL: the allowance acted on this bag
  assert.deepEqual(allowNames(p).sort(), ['bone_meal', 'crafting_table', 'furnace', 'ladder', 'torch'], JSON.stringify(p.steps))
  const left = after(bag, allowOnly(p))
  assert.deepEqual(kitView(left), kitView(bag), 'the kit and the smelt job see the same bag')
  assert.equal(left.filter(it => it.name === 'crafting_table').length, 1, 'the kit\'s carried table stays (row K: one of each station)')
  assert.equal(left.filter(it => it.name === 'furnace').length, 1)
  // CONTROL for the plan's rows switch: rows=false (deletion first) banks none of the allowance's rows
  assert.deepEqual(allowNames(townDepositPlan(bag, { wanted: [], noSwords: false, fullBag: true, rows: false })), [])
})

await t('SEEDED RANDOM FULL BAGS (200): the allowance never changes the kit\'s or the smelt job\'s view; it banks in most of them (positive control)', () => {
  clearWithdrawHolds()
  const r = rng(20261020)
  const pick = a => a[Math.floor(r() * a.length)]
  const kitish = [['stick', () => 1 + Math.floor(r() * 20)], ['oak_planks', () => 1 + Math.floor(r() * 12)], ['oak_log', () => 1 + Math.floor(r() * 8)],
    ['crafting_table', () => 1], ['iron_ingot', () => 1 + Math.floor(r() * 9)], ['coal', () => 1 + Math.floor(r() * 30)], ['raw_copper', () => 1 + Math.floor(r() * 20)],
    ['furnace', () => 1], ['raw_iron', () => 1 + Math.floor(r() * 10)]]
  const allowish = [['torch', () => 1 + Math.floor(r() * 40)], ['bone_meal', () => 1 + Math.floor(r() * 30)], ['ladder', () => 1 + Math.floor(r() * 20)],
    ['crafting_table', () => 1], ['furnace', () => 1], ['stone_bricks', () => 1 + Math.floor(r() * 20)], ['cooked_beef', () => 1 + Math.floor(r() * 10)],
    ['bread', () => 1 + Math.floor(r() * 10)]]
  const tools = [['stone_pickaxe', 131], ['iron_pickaxe', 250], ['iron_axe', 250], ['iron_shovel', 250], ['stone_axe', 131], ['wooden_pickaxe', 59]]
  let banked = 0
  for (let i = 0; i < 200; i++) {
    const rows = []
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) { const [n, u] = pick(tools); rows.push([n, 1, 1 + Math.floor(r() * u)]) }
    for (let k = 0; k < 6 + Math.floor(r() * 6); k++) { const [n, c] = pick(kitish); rows.push([n, c()]) }
    for (let k = 0; k < 2 + Math.floor(r() * 6); k++) { const [n, c] = pick(allowish); rows.push([n, c()]) }
    while (rows.length < TD_TRIGGER_SLOTS + Math.floor(r() * 3)) rows.push(['oak_slab', 1 + Math.floor(r() * 3)])
    const bag = bagOf(rows.slice(0, 36))
    const p = townDepositPlan(bag, { wanted: [], noSwords: false, fullBag: true, rows: true })
    if (allowNames(p).length) banked++
    const left = after(bag, allowOnly(p))   // the base plan's own stacks (coal, raw iron: cobblekeep) are the base's
    assert.deepEqual(kitView(left), kitView(bag), `bag ${i}: ${JSON.stringify(rows)} -> ${JSON.stringify(allowNames(p))}`)
  }
  assert.ok(banked >= 150, `the allowance banked in only ${banked} of 200 bags: the property would be vacuous`)
})

await t('THE KIT\'S ROOM after the allowance\'s visit (one fixture): no room for the kit\'s draw before, room after, the same draw', () => {
  clearWithdrawHolds()
  // a 36/36 bag with nothing the base plan banks (oak_slab is row R, kept whole) and three allowance rows
  const rows = [['stone_pickaxe', 1, 90], ['stick', 9], ['crafting_table', 1], ['torch', 30], ['bone_meal', 20], ['ladder', 10]]
  while (rows.length < 36) rows.push(['oak_slab', 1 + (rows.length % 3)])
  const bag = bagOf(rows)
  const d = kitDraw(bag)
  const takes = [{ name: 'iron_ingot', count: d.ingots }, { name: 'stick', count: d.sticks }].filter(x => x.count > 0)
  const keep = [...roomKeep([]), 'iron_ingot']
  assert.equal(roomPlan(bag, takes, { keep }).ok, false, 'CONTROL: before the visit the kit has no room (nothing the room plan may bank)')
  const p = townDepositPlan(bag, { wanted: [], noSwords: false, fullBag: true, rows: true })
  assert.deepEqual(allowNames(p).sort(), ['bone_meal', 'ladder', 'torch'])
  const left = after(bag, p)
  assert.equal(left.length, 33)
  assert.equal(roomPlan(left, takes, { keep }).ok, true, 'the allowance\'s three slots are the kit\'s room')
  assert.deepEqual(kitDraw(left), d, 'and the same draw')
  assert.equal(TOWN_IRON_KEEP, 4)
})

// THE ALLOWLIST IS THE GUARANTEE: even with NO other layer claiming a name (owned = nothing), the allowance's own rows never
// take the kit's or the smelt job's inputs, and leave one of each station. Run over the real module and over a mutant.
const KIT_BAG = () => bagOf([['stick', 9], ['oak_planks', 12], ['oak_log', 3], ['iron_ingot', 7], ['coal', 20], ['raw_copper', 16], ['raw_iron', 5],
  ['crafting_table', 1], ['furnace', 1], ['torch', 30]])
async function allowlistScene (BAm) {
  const steps = BAm.allowanceSteps(KIT_BAG(), { owned: () => false })
  assert.deepEqual(steps.map(s => s.name), ['torch'], `the allowance alone took ${JSON.stringify(steps)}`)
}
await t('THE ALLOWLIST (owned = nothing): the allowance alone takes the torches and nothing the kit or the smelt job uses', () => allowlistScene(BA))
const { readFileSync, writeFileSync, unlinkSync } = await import('node:fs')
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
await t('MUTANTS: the station row keeping none, or the default row keeping none, takes a kit input -- and the scene above sees it', async () => {
  const BA_PATH = new URL('../src/bagallowance.mjs', import.meta.url)
  const kills = {
    stationNone: await withMutant(BA_PATH, "case 'station': return ALLOWANCE.station", "case 'station': return 0", M => killedBy(() => allowlistScene(M))),
    defaultNone: await withMutant(BA_PATH, "default: return Infinity      // 'kept', 'unlisted'", "default: return 0", M => killedBy(() => allowlistScene(M))),
  }
  const survived = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(survived, [], `mutants survived: ${survived.join(', ')}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
