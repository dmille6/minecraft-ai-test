// TOOL HYGIENE (owner 10-07; docs/reports/toolhygiene-design-2026-10-07.md): no redundant crafts at admission, the
// most-worn pickaxe first in toolFor. BEHAVIOUR, against the real modules: toolFor tables and random-bag invariants,
// the switch reproducing the deployed policy (a frozen copy of c6e91a8's toolfor.mjs), the refusal against the REAL
// ladder rungs (refused => the rung is already met), and the refusal CHAIN through the real AdmissionControl.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-toolhygiene'
process.env.BOT_NAME = process.env.BOT_NAME || 'HygieneBot'
delete process.env.TOOL_HYGIENE   // the production default: unset -> on

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')
const TF = await import('../src/toolfor.mjs')
const BASE = await import('./fixtures/toolfor-base-c6e91a8.mjs')
const { redundantCraft, craftCoverNeed, redundantRow, admitRow, pickRank, ESCAPE_PICK_NAMES } = await import('../src/toolhygiene.mjs')
const REFLEX = await import('../src/reflex.mjs')
const { MIN_TRIP_USES } = await import('../src/oretunnel.mjs')
const { usableTool } = await import('../src/withdrawpick.mjs')
const { SUSTAINING, MILESTONES_BY_ROLE } = await import('../src/milestones.mjs')
const { applyPrereq, prereqHave } = await import('../src/cognitive.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { craftableNow } = await import('../src/prompt.mjs')
const { toolFor, FLOOR, HARD_STOP, remaining, TOOL_HYGIENE, toolHygieneMode, applyToolPolicy, travelTool, takeWornFirst } = TF

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// ---- fixtures (the toolfor.test.mjs shapes: type ids keyed harvestTools, speed by tier) -------------------------
const ID = { wooden_pickaxe: 1, stone_pickaxe: 2, iron_pickaxe: 3, diamond_pickaxe: 4, wooden_shovel: 5, golden_pickaxe: 6, stone_axe: 7 }
const MAXD = { wooden_pickaxe: 59, stone_pickaxe: 131, iron_pickaxe: 250, diamond_pickaxe: 1561, wooden_shovel: 59, golden_pickaxe: 32, stone_axe: 131 }
const NAME = Object.fromEntries(Object.entries(ID).map(([n, i]) => [i, n]))
const SPEED = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 2, 6: 12, 7: 4 }
let uid = 0
const item = (name, left, max = MAXD[name]) => ({ name, type: ID[name], count: 1, maxDurability: max, durabilityUsed: max - left, slot: 9 + (uid++ % 27) })
const block = (name, hardness, ids, cls = 'pickaxe') => ({
  name, harvestTools: ids ? Object.fromEntries(ids.map(i => [i, true])) : undefined,
  digTime: (typeId) => typeId && SPEED[typeId] && NAME[typeId].endsWith('_' + cls) ? Math.round(1500 * hardness / SPEED[typeId]) : Math.round(1500 * hardness * (ids ? 5 : 1.5)),
})
const STONE = block('stone', 1.5, [1, 2, 3, 4, 6]), IRON_ORE = block('iron_ore', 3, [2, 3, 4]), DIAMOND_ORE = block('diamond_ore', 3, [3, 4])
const COAL = block('coal_ore', 3, [1, 2, 3, 4, 6]), DIRT = block('dirt', 0.5, undefined, 'shovel'), OBSIDIAN = block('obsidian', 50, [4])
const on = (b, inv, o = {}) => toolFor(b, inv, { ...o, hygiene: true })
const off = (b, inv, o = {}) => toolFor(b, inv, { ...o, hygiene: false })
const who = d => d.item ? `${d.item.name}@${remaining(d.item)}` : (d.hand ? 'hand' : 'none')

// ---- the switch ---------------------------------------------------------------------------------------------------
t('TOOL_HYGIENE: unset -> on (and says so); on/off read; anything else -> on with a note; the module default is on here', () => {
  assert.deepEqual(toolHygieneMode({}), { on: true, mode: 'on', note: 'TOOL_HYGIENE unset' })
  assert.equal(toolHygieneMode({ TOOL_HYGIENE: 'off' }).on, false)
  assert.equal(toolHygieneMode({ TOOL_HYGIENE: ' OFF ' }).on, false)
  assert.equal(toolHygieneMode({ TOOL_HYGIENE: 'on' }).on, true)
  const odd = toolHygieneMode({ TOOL_HYGIENE: 'banana' })
  assert.equal(odd.on, true); assert.match(odd.note, /unreadable, using on/)
  assert.equal(TOOL_HYGIENE.on, true)
})

// ---- part 2: most-worn first ---------------------------------------------------------------------------------------
t('the design examples: worn copy first beside a keeper AND two deposit-proof others; iron spared; worn iron kept for diamond', () => {
  const s120 = item('stone_pickaxe', 120), s60 = item('stone_pickaxe', 60), s8 = item('stone_pickaxe', 8), s5 = item('stone_pickaxe', 5)
  assert.equal(on(STONE, [s120, s8, s5]).item, s5); assert.equal(off(STONE, [s120, s8, s5]).item, s120)
  assert.equal(on(STONE, [s120, s8]).item, s120, 'two copies: the worn one is the escape spare and stays reserved (mayDigForEscape)')
  assert.equal(on(STONE, [s120, s60, s8]).item, s60, 'a deposit would bank the 60, so the 8 is the spare: the more-worn OPEN copy digs')
  const i200 = item('iron_pickaxe', 200)
  assert.equal(on(STONE, [i200, s8, s5]).item, s5, 'the worn stone digs stone, not the iron'); assert.equal(off(STONE, [i200, s8, s5]).item, i200)
  assert.equal(on(STONE, [i200, s8]).item, i200, 'two copies: unchanged')
  const i5 = item('iron_pickaxe', 5), s100 = item('stone_pickaxe', 100)
  assert.equal(on(STONE, [i5, s100]).item, s100); assert.equal(on(IRON_ORE, [i5, s100]).item, s100)
  const dia = on(DIAMOND_ORE, [i5, s100]); assert.equal(dia.item, i5); assert.equal(dia.reason, 'reserved_required', 'the only means, unchanged')
  const r = on(STONE, [s8, s5]); assert.equal(r.item, s8); assert.equal(r.reason, 'reserved_required', 'all at or under FLOOR: the deployed fullest-first')
  const s50 = item('stone_pickaxe', 50)
  assert.equal(on(COAL, [item('stone_pickaxe', 120), s50]).item, s50, 'both above FLOOR: the more worn')
})
t('the keeper must be a SAME-OR-HIGHER tier copy above FLOOR: a worn iron beside wood stays reserved (iron retention)', () => {
  const i5 = item('iron_pickaxe', 5), w50 = item('wooden_pickaxe', 50)
  const r = on(STONE, [i5, w50]); assert.equal(r.item, w50, 'wooden is slow but open; the worn iron is not spent on stone'); assert.equal(r.reason, 'slow')
  const k = on(STONE, [i5, w50, item('iron_pickaxe', 11)])
  assert.equal(k.item, i5, 'an iron keeper above FLOOR (and two other usable copies) opens the worn iron, and it goes first')
  const nk = on(STONE, [i5, w50, item('iron_pickaxe', FLOOR)])
  assert.equal(nk.item, w50, `a keeper at FLOOR (${FLOOR}) is no keeper`)
  const s9 = item('stone_pickaxe', 9), s7 = item('stone_pickaxe', 7)
  const two = on(STONE, [s9, s7]); assert.equal(two.reason, 'reserved_required', 'two worn copies do not keep each other')
})
t(`the hard stop holds: a ${HARD_STOP}-use pickaxe is never picked outside last_swing/spend_spent; last_swing paths unchanged`, () => {
  const s1 = item('stone_pickaxe', 1), s120 = item('stone_pickaxe', 120)
  assert.equal(on(STONE, [s1, s120]).item, s120)
  assert.equal(on(STONE, [s1, s120], { lastSwing: true }).reason, 'spend_spent', 'existing: spend the spent copy while a working one is held')
  assert.equal(on(STONE, [s1], { lastSwing: true }).reason, 'last_swing')
  assert.equal(on(DIAMOND_ORE, [item('iron_pickaxe', 1)]).reason, 'none')
})
t('unknown durability counts as full: it is a keeper and the last to be chosen', () => {
  const unk = { name: 'stone_pickaxe', type: ID.stone_pickaxe, count: 1 }, s8 = item('stone_pickaxe', 8)
  assert.equal(on(STONE, [unk, item('stone_pickaxe', 9), s8]).item, s8)
  assert.equal(on(STONE, [unk, s8]).item, unk, 'two copies: the spare is kept')
})
t('the hand and axes/shovels are untouched: dirt by hand, a pickaxe never swapped onto the hand answer', () => {
  assert.equal(on(DIRT, [item('stone_pickaxe', 8), item('stone_pickaxe', 120)]).hand, true)
})

// random bags
const NAMES = ['wooden_pickaxe', 'stone_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe', 'wooden_shovel', 'stone_axe']
let seed = 12345
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const randomBag = () => {
  const k = rnd(6), bag = []
  for (let i = 0; i < k; i++) {
    const nm = NAMES[rnd(NAMES.length)], max = MAXD[nm]
    const left = [0, 1, 2, 3, 5, 9, 10, 11, 12, 25, 39, 40, 41, 80, max][rnd(15)]
    bag.push(item(nm, Math.min(left, max)))
  }
  return bag
}
const BLOCKS = [STONE, IRON_ORE, DIAMOND_ORE, COAL, DIRT, OBSIDIAN]
t('OFF IS THE DEPLOYED POLICY: hygiene off == c6e91a8 toolFor, 20,000 random bags x 6 blocks x lastSwing', () => {
  let n = 0
  for (let i = 0; i < 20000; i++) {
    const bag = randomBag(), b = BLOCKS[i % BLOCKS.length], ls = i % 3 === 0
    const a = off(b, bag, { lastSwing: ls }), z = BASE.toolFor(b, bag, { lastSwing: ls })
    assert.equal(a.item, z.item, `bag ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')} on ${b.name}`); assert.equal(a.reason, z.reason); assert.equal(a.hand, z.hand)
    n++
  }
  assert.equal(n, 20000)
})
t('ON, invariants over 20,000 random bags: same hand/none answers as base; never a higher tier than base (golden: rank); no <= HARD_STOP pickaxe outside last swings; a worn open pick always has a keeper', () => {
  let changed = 0, wornPicks = 0
  for (let i = 0; i < 20000; i++) {
    const bag = randomBag(), b = BLOCKS[i % BLOCKS.length], ls = i % 3 === 0
    const h = on(b, bag, { lastSwing: ls }), z = off(b, bag, { lastSwing: ls })
    const tag = `bag ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')} on ${b.name} -> ${who(h)} vs ${who(z)}`
    assert.equal(h.hand, z.hand, tag); assert.equal(!!h.item, !!z.item, tag)
    // HARVEST rank (golden = wooden): a worn golden copy opened by a keeper can be the only pick within SLACK where the
    // base dug slowly with wood -- a golden copy at 2 uses spent, nothing better. Every other tier is never raised.
    if (h.item && z.item && pickRank(h.item.name) != null && pickRank(z.item.name) != null) assert.ok(pickRank(h.item.name) <= pickRank(z.item.name), 'never spends a higher harvest rank than the base: ' + tag)
    if (h.item && z.item && !/^golden_/.test(h.item.name)) assert.ok(TF.tier(h.item.name) <= TF.tier(z.item.name), 'never a higher tier than the base (golden aside): ' + tag)
    if (h.item && TF.isPickaxe(h.item.name) && remaining(h.item) <= HARD_STOP) assert.ok(['last_swing', 'spend_spent'].includes(h.reason), tag)
    if (h.item && TF.isPickaxe(h.item.name) && remaining(h.item) > HARD_STOP && remaining(h.item) <= FLOOR && h.reason !== 'reserved_required') {
      wornPicks++
      assert.ok(bag.some(y => y !== h.item && TF.isPickaxe(y.name) && TF.tier(y.name) >= TF.tier(h.item.name) && remaining(y) > FLOOR), 'a worn copy opened without a keeper: ' + tag)
    }
    if (h.item !== z.item) changed++
  }
  assert.ok(changed > 500 && wornPicks > 200, `the generator exercises the change (changed ${changed}, worn picks ${wornPicks})`)
})
// The open rule restated over the whole bag (same name = same tier, so a keeper for the chosen copy's name is any pickaxe
// of that tier or higher above FLOOR; usable = above HARD_STOP, as mayDigForEscape counts).
const survivors = others => others.filter(k => TF.isPickaxe(k.name) && remaining(k) > HARD_STOP && remaining(k) <= FLOOR).length +
  new Set(others.filter(k => TF.isPickaxe(k.name) && remaining(k) > FLOOR).map(k => k.name)).size
const openByRule = (y, bag) => remaining(y) > FLOOR || (remaining(y) > HARD_STOP &&
  bag.some(k => k !== y && TF.isPickaxe(k.name) && TF.tier(k.name) >= TF.tier(y.name) && remaining(k) > FLOOR) &&
  survivors(bag.filter(k => k !== y)) >= 2)
t('travelTool ON, random bags: never a pickaxe at <= HARD_STOP; a pick that differs from the base is the same name, more worn', () => {
  let differ = 0
  for (let i = 0; i < 20000; i++) {
    const bag = randomBag(), b = BLOCKS[i % BLOCKS.length]
    if (rnd(3) === 0) bag.push({ name: 'cobblestone', count: 5 })
    const held = bag.length ? bag[rnd(bag.length)] : null
    const h = travelTool(b, bag, held, { hygiene: true }), z = travelTool(b, bag, held, { hygiene: false })
    const tag = `bag ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')} on ${b.name}`
    if (h && TF.isPickaxe(h.name)) assert.ok(remaining(h) > HARD_STOP, tag)
    if (h !== z) {
      differ++
      assert.ok(h && z, tag)
      if (pickRank(h.name) != null && pickRank(z.name) != null) assert.ok(pickRank(h.name) <= pickRank(z.name), 'never a higher harvest rank: ' + tag)
      if (!toolFor(b, bag, { hygiene: true }).item) assert.ok(h.name === z.name && remaining(h) <= remaining(z), 'the fallback swaps within a name only: ' + tag)
    }
  }
  assert.ok(differ > 100, `exercised ${differ}`)
})
t('pocketPlanFor (flooded-pocket rung) takes a pickaxe above HARD_STOP first; the first by slot only when none is', () => {
  const s1 = item('stone_pickaxe', 1), s90 = item('stone_pickaxe', 90)
  const bot = inv => ({ entity: { position: { x: 0.5, y: 60, z: 0.5 } }, inventory: { items: () => inv } })
  assert.equal(REFLEX.pocketPlanFor(bot([s1, s90]), { blockAt: () => null }).tool, s90)
  assert.equal(REFLEX.pocketPlanFor(bot([s1]), { blockAt: () => null }).tool, s1)
})
t('SAME NAME => MOST WORN: whenever on picks a pickaxe (outside reserved_required/last swings), no more-worn same-name copy is open by the rule', () => {
  let checked = 0
  for (let i = 0; i < 20000; i++) {
    const bag = randomBag(), b = BLOCKS[i % BLOCKS.length]
    const h = on(b, bag)
    if (!h.item || !TF.isPickaxe(h.item.name) || ['reserved_required', 'last_swing', 'spend_spent'].includes(h.reason)) continue
    checked++
    const lower = bag.filter(y => y !== h.item && y.name === h.item.name && openByRule(y, bag) && remaining(y) < remaining(h.item))
    assert.equal(lower.length, 0, `bag ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')} on ${b.name} picked ${who(h)}`)
  }
  assert.ok(checked > 3000, `exercised ${checked}`)
})
t('THE ESCAPE RESERVE: a dig the change redirected never leaves fewer than two usable pickaxes where the base dig would have left two', () => {
  const usable = bag => bag.filter(x => TF.isPickaxe(x.name) && remaining(x) > HARD_STOP).length
  let redirected = 0
  for (let i = 0; i < 20000; i++) {
    const bag = randomBag(), b = BLOCKS[i % BLOCKS.length]
    const h = on(b, bag), z = off(b, bag)
    if (!h.item || h.item === z.item) continue
    redirected++
    const after = it => bag.map(x => x === it ? { ...x, durabilityUsed: x.durabilityUsed + 1 } : x)
    if (usable(after(z.item)) >= 2) assert.ok(usable(after(h.item)) >= 2, `bag ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')} on ${b.name}: ${who(h)} vs ${who(z)}`)
  }
  assert.ok(redirected > 300, `exercised ${redirected}`)
})
t('the actuators carry it: applyToolPolicy and travelTool return the most-worn copy and tally the changed pick', () => {
  takeWornFirst()
  const s120 = item('stone_pickaxe', 120), s8 = item('stone_pickaxe', 8), s5 = item('stone_pickaxe', 5)
  const bot = { heldItem: null, inventory: { items: () => [s120, s8, s5], emptySlotCount: () => 5 } }
  assert.equal(applyToolPolicy(bot, STONE), s5)
  assert.equal(travelTool(STONE, [s120, s8, s5], null), s5)
  const w = takeWornFirst(); assert.equal(w.n, 1, 'harvest/reflex digs only: the pathfinder also calls travelTool while PLANNING'); assert.match(w.last, /stone_pickaxe@5 over stone_pickaxe@120 on stone/)
  assert.deepEqual(w.ctx, { block: 'stone', chosen: 'stone_pickaxe@5', base: 'stone_pickaxe@120', reason: 'cheapest', mode: 'dig', picks: 'stone_pickaxe@120,stone_pickaxe@8,stone_pickaxe@5' })
  assert.equal(takeWornFirst().n, 0, 'read resets')
  applyToolPolicy({ heldItem: null, inventory: { items: () => [s120], emptySlotCount: () => 5 } }, STONE)
  assert.equal(takeWornFirst().n, 0, 'the same pick as the base is not tallied')
})

t('OFF IS THE DEPLOYED POLICY for travel digs too: travelTool off == c6e91a8 travelTool (random bags, random held)', () => {
  for (let i = 0; i < 20000; i++) {
    const bag = randomBag(), b = BLOCKS[i % BLOCKS.length]
    if (rnd(4) === 0) bag.push({ name: 'cobblestone', count: 5 })
    const held = bag.length ? bag[rnd(bag.length)] : null
    assert.equal(travelTool(b, bag, held, { hygiene: false }), BASE.travelTool(b, bag, held), `bag ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')} on ${b.name}`)
  }
})
t('the travel fallback (hand answer, no filler) follows the rules too: the worn copy beside a keeper, not the fullest', () => {
  const s120 = item('stone_pickaxe', 120), s60 = item('stone_pickaxe', 60), s8 = item('stone_pickaxe', 8), s5 = item('stone_pickaxe', 5)
  assert.equal(travelTool(DIRT, [s120, s8, s5], s120, { hygiene: true }), s5)
  assert.equal(travelTool(DIRT, [s120, s8, s5], s120, { hygiene: false }), s120)
  assert.equal(travelTool(DIRT, [s120, s60, s8], s120, { hygiene: true }), s60, 'the 8 is the deposit-proof spare; the more-worn open copy')
  const ax = item('stone_axe', 100)
  assert.equal(travelTool(DIRT, [ax, item('wooden_pickaxe', 5), item('stone_pickaxe', 100), item('iron_pickaxe', 100)], ax, { hygiene: true }), ax, 'Claude round 2: no shift onto a worn wooden pickaxe')
  const s1 = item('stone_pickaxe', 1), i100 = item('iron_pickaxe', 100)
  assert.notEqual(travelTool(DIRT, [s120, s8, s1, i100], s120, { hygiene: true }), s1, 'never a 1-use copy')
  assert.equal(travelTool(DIRT, [ax, item('stone_pickaxe', 15)], ax, { hygiene: true }).name, 'stone_axe', 'no shift across kinds onto the pickaxe (fullest-first between kinds, as deployed)')
  const i5 = item('iron_pickaxe', 5), w30 = item('wooden_pickaxe', 30)
  assert.equal(travelTool(DIRT, [i5, w30], i5, { hygiene: true }), w30, 'no keeper for the iron: it stays out of the hand')
})
// SEQUENCES (Codex round 1): dig N times, wearing the chosen copy and removing it at 0.
const simulate = (bag0, blk, n, o) => {
  const bag = bag0.map(x => ({ ...x }))
  let dug = 0
  for (; dug < n; dug++) {
    const d = toolFor(blk, bag, o)
    if (!d.item) break
    d.item.durabilityUsed++
    if (remaining(d.item) <= 0) bag.splice(bag.indexOf(d.item), 1)
  }
  return { bag, dug }
}
t('SEQUENCE, harvest on stone: the worn copy goes 3->2->1->gone (spend_spent) before the keeper; the bag drains to TWO usable, never one', () => {
  const bag = [item('stone_pickaxe', 120), item('stone_pickaxe', 8), item('stone_pickaxe', 3)]
  const h = simulate(bag, STONE, 30, { hygiene: true, lastSwing: true }), z = simulate(bag, STONE, 30, { hygiene: false, lastSwing: true })
  assert.equal(h.dug, 30); assert.equal(z.dug, 30)
  assert.deepEqual(h.bag.map(remaining), [93, 8], '3 uses from the worn copy (one slot freed), 27 from the keeper; the 8 is the escape spare')
  assert.deepEqual(z.bag.map(remaining), [90, 8, 3])
})
t('SEQUENCE, travel digs: worn copies stop at 1 (HARD_STOP), the keeper digs on; a sole worn iron is never opened beside wood', () => {
  const h = simulate([item('stone_pickaxe', 40), item('stone_pickaxe', 9), item('stone_pickaxe', 6)], STONE, 20, { hygiene: true })
  assert.deepEqual(h.bag.map(remaining).sort((a, b) => a - b), [1, 9, 25], '6 -> 1 (5 digs; the 9 and the 40 survive any deposit), then the keeper')
  const h2 = simulate([item('stone_pickaxe', 40), item('stone_pickaxe', 30), item('stone_pickaxe', 6)], STONE, 20, { hygiene: true })
  assert.deepEqual(h2.bag.map(remaining).sort((a, b) => a - b), [6, 10, 40], 'the 6 is the deposit-proof spare: the more-worn open copy 30 -> 10, then reserved')
  const z = simulate([item('stone_pickaxe', 40), item('stone_pickaxe', 30), item('stone_pickaxe', 6)], STONE, 20, { hygiene: false })
  assert.deepEqual(z.bag.map(remaining).sort((a, b) => a - b), [6, 25, 25], 'base: fullest first, equalising')
  const iw = simulate([item('iron_pickaxe', 5), item('wooden_pickaxe', 30)], STONE, 10, { hygiene: true })
  assert.deepEqual(iw.bag.map(x => `${x.name}@${remaining(x)}`), ['iron_pickaxe@5', 'wooden_pickaxe@20'])
  const solo = simulate([item('iron_pickaxe', 5)], DIAMOND_ORE, 10, { hygiene: true })
  assert.equal(solo.dug, 4, 'the only means: dug to 1 use, never broken by a travel dig'); assert.deepEqual(solo.bag.map(remaining), [1])
})
const { pickaxeUses, canContinueDescent, descentPickNeed } = await import('../src/exit-contract.mjs')
t('SEQUENCE, aggregate exit capacity: after N travel digs pickaxeUses is the same on and off (random bags)', () => {
  let compared = 0
  for (let i = 0; i < 4000; i++) {
    const bag = randomBag().filter(x => /_pickaxe$/.test(x.name)), n = 1 + rnd(40)
    const h = simulate(bag, STONE, n, { hygiene: true }), z = simulate(bag, STONE, n, { hygiene: false })
    if (h.dug !== n || z.dug !== n) continue
    compared++
    assert.equal(pickaxeUses(h.bag), pickaxeUses(z.bag), bag.map(x => `${x.name}@${remaining(x)}`).join(','))
  }
  assert.ok(compared > 1000, `exercised ${compared}`)
})

// THE DEPOSIT CHAIN (Codex round 2): dig, then a deposit (the real depositPlan and the transfer's worst-usable-first
// selection, skills.mjs depositSkill), then the escape reflex. The policy must not leave one usable pickaxe where the
// deployed one kept two.
const { depositPlan } = await import('../src/bankable.mjs')
const deposit = bag0 => {
  let bag = bag0.map(x => ({ ...x }))
  for (const { name, count } of depositPlan(bag, null, { wants: [] })) {
    if (!/_pickaxe$/.test(name)) continue
    const usable = bag.filter(x => x.name === name && remaining(x) > FLOOR).sort((a, b) => remaining(a) - remaining(b))
    const go = usable.slice(0, Math.max(0, Math.min(count, usable.length - 1)))
    bag = bag.filter(x => !go.includes(x))
  }
  return bag
}
const usableN = bag => bag.filter(x => TF.isPickaxe(x.name) && remaining(x) > HARD_STOP).length
t('THE DEPOSIT CHAIN: {120, 60, 8} dug 7 then deposited keeps two usable on AND off (Codex round 2 counterexample); the depositSurvivors count matches the real deposit', () => {
  const bag = [item('stone_pickaxe', 120), item('stone_pickaxe', 60), item('stone_pickaxe', 8)]
  const h = deposit(simulate(bag, STONE, 7, { hygiene: true }).bag), z = deposit(simulate(bag, STONE, 7, { hygiene: false }).bag)
  assert.equal(usableN(z), 2, 'positive control: the deployed policy keeps two')
  assert.equal(usableN(h), 2, `on: ${h.map(x => remaining(x)).join(',')}`)
  assert.ok(REFLEX.mayDigForEscape(h, { name: 'stone', boundingBox: 'block' }))
  for (let i = 0; i < 3000; i++) {
    const b = randomBag().filter(x => TF.isPickaxe(x.name))
    assert.equal(TF.depositSurvivors(b), usableN(deposit(b)), `survivors of ${b.map(x => `${x.name}@${remaining(x)}`).join(',')}`)
  }
})
// The guarantee is about what the CHANGE does: while a copy above FLOOR remains (the keeper the rule needs), the
// hygiene bag holds at least min(2, deployed) deposit-proof pickaxes. Once every copy is at or under FLOOR the deployed
// reserved_required rules apply to whatever hoard is left (draining the hoard is the owner's goal; the reserve it
// keeps is two survivors, not every spare the deployed policy would have carried).
const simulateWhileKeeper = (bag0, blk, n, o) => {
  const bag = bag0.map(x => ({ ...x }))
  let dug = 0
  for (; dug < n; dug++) {
    if (!bag.some(x => TF.isPickaxe(x.name) && remaining(x) > FLOOR)) break
    const d = toolFor(blk, bag, o)
    if (!d.item) break
    d.item.durabilityUsed++
    if (remaining(d.item) <= 0) bag.splice(bag.indexOf(d.item), 1)
  }
  return { bag, dug }
}
t('THE DEPOSIT CHAIN, random: while a keeper above FLOOR remains, after N digs and a deposit on holds >= min(2, off) usable pickaxes', () => {
  let n = 0
  for (let i = 0; i < 6000; i++) {
    const bag = randomBag().filter(x => TF.isPickaxe(x.name)), k = 1 + rnd(30), b = [STONE, COAL, IRON_ORE][rnd(3)], ls = rnd(2) === 0
    const h = simulateWhileKeeper(bag, b, k, { hygiene: true, lastSwing: ls }), z = simulateWhileKeeper(bag, b, k, { hygiene: false, lastSwing: ls })
    if (h.dug !== k || z.dug !== k) continue
    n++
    const uh = usableN(deposit(h.bag)), uz = usableN(deposit(z.bag))
    assert.ok(uh >= Math.min(2, uz), `${bag.map(x => `${x.name}@${remaining(x)}`).join(',')} x${k} on ${b.name}${ls ? ' harvest' : ''}: on ${h.bag.map(x => `${x.name}@${remaining(x)}`).join(',')} -> ${uh}, off -> ${uz}`)
  }
  assert.ok(n > 2000, `exercised ${n}`)
})

// ---- part 1: no redundant crafts -----------------------------------------------------------------------------------
const P = (name, left) => item(name, left)
t('stone: refused beside a stone-or-better copy with >= MIN_TRIP_USES; admitted at 39; iron covers at 40', () => {
  assert.equal(MIN_TRIP_USES, 40); assert.equal(craftCoverNeed('stone_pickaxe'), 40); assert.equal(craftCoverNeed('iron_pickaxe'), FLOOR + 1)
  const W = P('wooden_pickaxe', 30)   // a second usable pickaxe: the escape reserve (below) is met
  const r = redundantCraft('stone_pickaxe', [P('stone_pickaxe', 52), W])
  assert.equal(r.held, 'stone_pickaxe'); assert.equal(r.uses, 52)
  assert.match(r.detail, /stone_pickaxe with 52 uses left/); assert.match(r.detail, /dig with it/)
  assert.equal(redundantCraft('stone_pickaxe', [P('stone_pickaxe', 39), P('stone_pickaxe', 30)]), null)
  assert.equal(redundantCraft('stone_pickaxe', [P('iron_pickaxe', 40), W]), null, 'iron never covers a stone craft (iron retention, Claude round 2)')
  assert.equal(redundantCraft('stone_pickaxe', [P('iron_pickaxe', 200), P('stone_pickaxe', 5), P('wooden_pickaxe', 4)]), null, 'the probe bag: worn stone + iron -> the stone craft is admitted')
  assert.equal(redundantCraft('wooden_pickaxe', [P('iron_pickaxe', 200), P('wooden_pickaxe', 4)]), null)
  assert.ok(redundantCraft('iron_pickaxe', [P('diamond_pickaxe', 900), W]), 'iron and better: same rank or higher covers')
  assert.equal(redundantCraft('stone_pickaxe', [P('iron_pickaxe', 39), P('wooden_pickaxe', 59)]), null)
  assert.equal(redundantCraft('stone_pickaxe', [P('golden_pickaxe', 32), W]), null, 'gold harvests like wood')
  assert.equal(redundantCraft('stone_pickaxe', [P('stone_pickaxe', 45), P('stone_pickaxe', 120)]).uses, 120, 'the fullest cover is named')
})
t('THE ESCAPE RESERVE: one usable pickaxe is never "enough" -- a craft beside a single copy is admitted, whatever its uses', () => {
  const { ESCAPE_PICKAXES_NEEDED } = REFLEX
  assert.equal(TF.ESCAPE_RESERVE, ESCAPE_PICKAXES_NEEDED, 'toolfor restates reflex.mjs ESCAPE_PICKAXES_NEEDED')
  assert.deepEqual([...ESCAPE_PICK_NAMES].sort(), [...REFLEX.pickaxePrereq('x').items].sort(), 'the names the escape ask counts')
  assert.equal(redundantCraft('stone_pickaxe', [P('stone_pickaxe', 131)]), null)
  assert.equal(redundantCraft('stone_pickaxe', [P('stone_pickaxe', 131), P('wooden_pickaxe', 1)]), null, 'a 1-use copy is not usable')
  assert.ok(redundantCraft('stone_pickaxe', [P('stone_pickaxe', 131), P('wooden_pickaxe', 2)]))
})
t('iron stays craftable beside stone/wooden (the upgrade path); refused beside iron-or-better above FLOOR', () => {
  const S = P('stone_pickaxe', 131)
  assert.equal(redundantCraft('iron_pickaxe', [S, P('wooden_pickaxe', 59)]), null)
  assert.equal(redundantCraft('iron_pickaxe', [P('iron_pickaxe', FLOOR), S]), null)
  assert.equal(redundantCraft('iron_pickaxe', [P('iron_pickaxe', FLOOR + 1), S]).held, 'iron_pickaxe')
  assert.equal(redundantCraft('iron_pickaxe', [P('diamond_pickaxe', 900), S]).held, 'diamond_pickaxe')
})
t('wooden: refused beside wooden/golden/stone above FLOOR (never iron); usable = withdraw\'s usableTool (> FLOOR)', () => {
  const G = P('wooden_pickaxe', 2)   // usable (> HARD_STOP) but covers nothing: the second copy for the escape reserve
  assert.equal(redundantCraft('wooden_pickaxe', [P('iron_pickaxe', 200), G, P('wooden_pickaxe', 3)]), null, 'iron never covers a wooden craft')
  for (const nm of ['wooden_pickaxe', 'golden_pickaxe', 'stone_pickaxe']) {
    const G3 = P('wooden_pickaxe', 3)   // gold is not in the escape ask's names, so a golden cover needs two other usable copies
    assert.ok(redundantCraft('wooden_pickaxe', [P(nm, FLOOR + 1), G, G3]), nm)
    assert.equal(redundantCraft('wooden_pickaxe', [P(nm, FLOOR), G, G3]), null, nm)
    assert.equal(!!redundantCraft('wooden_pickaxe', [P(nm, FLOOR + 1), G, G3]), usableTool(P(nm, FLOOR + 1)))
  }
})
t('stations: a carried crafting_table/furnace refuses a second, naming the skill that places it; nothing else is touched', () => {
  const tb = redundantCraft('crafting_table', [{ name: 'crafting_table', count: 1 }])
  assert.equal(tb.kind, 'station'); assert.match(tb.detail, /place item=crafting_table/)
  assert.match(redundantCraft('furnace', [{ name: 'furnace', count: 2 }]).detail, /smelt places a carried furnace/)
  assert.equal(redundantCraft('furnace', [{ name: 'crafting_table', count: 1 }]), null)
  assert.equal(redundantCraft('chest', [{ name: 'chest', count: 1 }]), null)
  assert.equal(redundantCraft('stick', [{ name: 'stick', count: 64 }]), null)
  assert.equal(redundantCraft('stone_axe', [P('stone_axe', 120)]), null)
})
t('NEVER WHAT THE TASK WANTS; never when off', () => {
  const bag = [P('stone_pickaxe', 131), P('wooden_pickaxe', 30), { name: 'crafting_table', count: 1 }]
  assert.equal(redundantCraft('stone_pickaxe', bag, { wanted: new Set(['stone_pickaxe', 'cobblestone']) }), null)
  assert.equal(redundantCraft('crafting_table', bag, { wanted: ['crafting_table'] }), null)
  assert.ok(redundantCraft('stone_pickaxe', bag, { wanted: new Set(['dirt']) }))
  assert.equal(redundantCraft('stone_pickaxe', bag, { on: false }), null)
})
t('the row the read parses: detail and structured args', () => {
  const v = redundantCraft('stone_pickaxe', [P('stone_pickaxe', 52), P('wooden_pickaxe', 30)], { y: 70 })
  const row = redundantRow(v, { taskId: 'gather_dirt_16', wanted: false, source: 'model', wantedSet: new Set(['dirt']) })
  assert.equal(row.detail, 'item=stone_pickaxe held=stone_pickaxe:52 need=40 kind=pickaxe task=gather_dirt_16 wanted=0 source=model pick_uses=80 exit_need=2')
  assert.deepEqual(row.args, { item: 'stone_pickaxe', held: 'stone_pickaxe', uses: 52, need: 40, kind: 'pickaxe', task: 'gather_dirt_16', wanted: 0, source: 'model', pick_uses: 80, exit_need: 2, wants: 'dirt' })
  assert.deepEqual(admitRow('iron_pickaxe', { taskId: 't', wantedSet: new Set(['stick', 'iron_ingot']), count: 2 }).args, { item: 'iron_pickaxe', count: 2, task: 't', source: 'model', wants: 'iron_ingot|stick' })
  assert.match(redundantRow(redundantCraft('furnace', [{ name: 'furnace', count: 1 }])).detail, /held=furnace:carried need=1 kind=station/)
})

// ---- composition: refused => the REAL rung is already met; a prerequisite's own task is never refused --------------
const bagBot = items => ({ inventory: { items: () => items }, registry: mcData, findBlock: () => null, entity: { position: { x: 0, y: 70, z: 0 } } })
const RUNGS = {}
for (const m of [...SUSTAINING, ...Object.values(MILESTONES_BY_ROLE).flat()]) {
  const mm = /^craft_(stone_pickaxe|wooden_pickaxe|iron_pickaxe|crafting_table|furnace)_1$/.exec(m?.id ?? '')
  if (mm && !RUNGS[mm[1]]) RUNGS[mm[1]] = m
}
t('every item the refusal covers has a real ladder rung to compose with (positive control for the property below)', () => {
  assert.deepEqual(Object.keys(RUNGS).sort(), ['crafting_table', 'furnace', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'])
})
t('REFUSED => THE RUNG IS MET (real milestones.mjs done/fulfilled), 20,000 random bags x 5 items', () => {
  let refused = 0
  const STN = ['crafting_table', 'furnace']
  for (let i = 0; i < 20000; i++) {
    const bag = randomBag()
    if (rnd(3) === 0) bag.push({ name: STN[rnd(2)], count: 1 + rnd(2) })
    for (const it of Object.keys(RUNGS)) {
      if (!redundantCraft(it, bag)) continue
      refused++
      const m = RUNGS[it], met = (m.fulfilled ?? m.done)(bagBot(bag))
      assert.ok(met, `refused ${it} while the rung ${m.id} is NOT met: ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')}`)
      if (/_pickaxe$/.test(it)) {
        assert.ok(REFLEX.mayDigForEscape(bag, { name: 'stone', boundingBox: 'block' }), `refused ${it} while the escape reflex would refuse to dig stone: ${bag.map(x => `${x.name}@${remaining(x)}`).join(',')}`)
        const pre = REFLEX.pickaxePrereq('test')
        assert.ok(prereqHave(bag, pre) >= pre.count, `refused ${it} while the escape's two-pickaxe ask is unmet`)
      }
    }
  }
  assert.ok(refused > 2000, `the property was exercised (${refused} refusals)`)
})
t('A PREREQUISITE IS NEVER REFUSED: the ore tunnel\'s pickaxe_short detour (minUses 81) with a 60-use stone pickaxe', () => {
  const bag = [P('stone_pickaxe', 60), P('wooden_pickaxe', 30)]
  assert.ok(redundantCraft('stone_pickaxe', bag), 'without the detour it would be refused')
  const prereq = { items: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'], count: 1, minUses: 81, since: Date.now(), because: 'tunnel' }
  const { task } = applyPrereq({ id: 'gather_dirt_16', wants: 'dirt' }, prereq, 0)
  const wanted = new Set([task.wants, ...(task.wantsAny ?? [])])
  assert.equal(redundantCraft('stone_pickaxe', bag, { wanted }), null)
})

// ---- the refusal CHAIN through the real admission gate --------------------------------------------------------------
function botWith (inv) {
  const items = inv.map((x, slot) => ({ ...x, slot, type: mcData.itemsByName[x.name]?.id }))
  const held = id => items.filter(i => i.type === Number(id)).reduce((s, i) => s + i.count, 0)
  return {
    entity: { position: { x: 0, y: 70, z: 0 } }, health: 20, food: 20, players: {},
    inventory: { items: () => items }, registry: mcData,
    recipesFor: (id, meta, min, table) => Recipe.find(id, meta).filter(r => {
      if (r.requiresTable && !table) return false
      const need = {}
      for (const d of r.delta) if (d.count < 0) need[d.id] = (need[d.id] ?? 0) - d.count
      return Object.entries(need).every(([rid, n]) => held(rid) >= n)
    }),
    recipesAll: () => [], findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
  }
}
let seq = 0
const gate = () => { const L = new Lessons(`/tmp/mcai-toolhygiene-${process.pid}-${seq++}.json`); L.data.avoid = {}; L.data.worked = {}; return new AdmissionControl(L) }
const MATS = [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }, { name: 'crafting_table', count: 1 }]
const pk = (name, left) => ({ name, count: 1, maxDurability: MAXD[name], durabilityUsed: MAXD[name] - left })
t('THE CHAIN: stone@52 + materials, task gather dirt -> craft stone_pickaxe refused naming the held copy; the remedy (dig/gather/mine) is admitted next', () => {
  const g = gate(), bot = botWith([pk('stone_pickaxe', 52), pk('wooden_pickaxe', 30), ...MATS, { name: 'dirt', count: 3 }])
  const wanted = new Set(['dirt'])
  const r = g.check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, bot, wanted)
  assert.equal(r.ok, false); assert.equal(r.reason, 'redundant_craft'); assert.match(r.detail, /stone_pickaxe with 52 uses left -?.*dig with it/)
  assert.equal(g.check({ skill: 'gather', args: { block: 'stone', count: 3 }, reason: 'x' }, bot, wanted).ok, true, 'the remedy runs')
  assert.equal(g.check({ skill: 'gather', args: { block: 'dirt', count: 3 }, reason: 'x' }, bot, wanted).ok, true, 'and the task runs')
})
t('THE CHAIN, stations: a carried table refuses `craft crafting_table`; `place crafting_table` (the remedy named) is admitted', () => {
  const g = gate(), bot = botWith([pk('stone_pickaxe', 52), pk('wooden_pickaxe', 30), ...MATS, { name: 'oak_planks', count: 8 }])
  const r = g.check({ skill: 'craft', args: { item: 'crafting_table' }, reason: 'x' }, bot, new Set(['dirt']))
  assert.equal(r.reason, 'redundant_craft')
  assert.equal(g.check({ skill: 'place', args: { item: 'crafting_table' }, reason: 'x' }, bot, new Set(['dirt'])).ok, true)
})
t('THE RUNG\'S OWN WORK ORDER IS ADMITTED: craft_stone_pickaxe_1 active with a 25-use copy (the 3,123/day population)', () => {
  const g = gate(), bot = botWith([pk('stone_pickaxe', 25), ...MATS])
  const rung = RUNGS.stone_pickaxe
  assert.equal(rung.fulfilled(bot), false, 'premise: the rung is not met at 25 uses')
  assert.equal(g.check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'work order' }, bot, new Set(['stone_pickaxe', 'cobblestone', 'stick'])).ok, true)
  assert.equal(g.check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, botWith([pk('stone_pickaxe', 25), ...MATS]), new Set(['dirt'])).ok, true, 'and by the model under another task: 25 < 40')
})
t('THE UPGRADE: craft iron_pickaxe beside a full stone pickaxe is admitted', () => {
  const g = gate(), bot = botWith([pk('stone_pickaxe', 131), { name: 'iron_ingot', count: 3 }, { name: 'stick', count: 2 }, { name: 'crafting_table', count: 1 }])
  assert.equal(g.check({ skill: 'craft', args: { item: 'iron_pickaxe' }, reason: 'x' }, bot, new Set(['dirt'])).ok, true)
})
t('THE SWITCH IS WIRED: with TOOL_HYGIENE=off in the environment the same refusal admits (a fresh process)', () => {
  const code = `
    process.env.OLLAMA_MODEL ??= 'q'
    const { AdmissionControl } = await import(${JSON.stringify(new URL('../src/admission.mjs', import.meta.url).href)})
    const { TOOL_HYGIENE } = await import(${JSON.stringify(new URL('../src/toolfor.mjs', import.meta.url).href)})
    const mcData = (await import('node:module')).createRequire(${JSON.stringify(import.meta.url)})('minecraft-data')('1.21.8')
    const items = [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'wooden_pickaxe', count: 1, maxDurability: 59, durabilityUsed: 0 }]
    const bot = { entity: { position: { x: 0, y: 70, z: 0 } }, inventory: { items: () => items }, registry: mcData, recipesFor: () => [], recipesAll: () => [], findBlock: () => null }
    const r = new AdmissionControl(null).check({ skill: 'craft', args: { item: 'stone_pickaxe' } }, bot, null)
    console.log(JSON.stringify({ on: TOOL_HYGIENE.on, reason: r.reason ?? null }))`
  const run = env => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim().split('\n').pop())
  assert.deepEqual(run({ TOOL_HYGIENE: 'on' }), { on: true, reason: 'redundant_craft' }, 'positive control: the probe sees the refusal')
  const o = run({ TOOL_HYGIENE: 'off' })
  assert.equal(o.on, false); assert.notEqual(o.reason, 'redundant_craft')
})

t('THE DESCENT CHAIN (Codex round 1): at y=15, stone@40 + wooden@10 is 48 swings against 62 -> mine refuses for a pickaxe; the craft is ADMITTED there, refused at the surface', () => {
  const inv = [pk('stone_pickaxe', 40), pk('wooden_pickaxe', 10), ...MATS, { name: 'cobblestone', count: 64 }, { name: 'dirt', count: 64 }]
  const exit = canContinueDescent({ y: 15, health: 20, items: inv })
  assert.equal(exit.ok, false); assert.equal(exit.reason, 'pickaxe', 'premise: the descent refuses for want of a pickaxe')
  assert.equal(descentPickNeed(15), 62); assert.equal(pickaxeUses(inv), 48)
  const deep = botWith(inv); deep.entity.position.y = 15
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, deep, new Set(['dirt'])).ok, true)
  assert.equal(redundantCraft('stone_pickaxe', inv, { y: 15 }), null)
  assert.ok(redundantCraft('stone_pickaxe', inv, { y: 70 }), 'at the surface the same bag is covered')
  const after = [...inv, pk('stone_pickaxe', 131)]
  assert.equal(canContinueDescent({ y: 15, health: 20, items: after }).ok, true, 'the admitted craft is the remedy: the descent proceeds')
  assert.ok(redundantCraft('stone_pickaxe', after, { y: 15 }), 'and a third is refused once the reserve is met')
})
t('THE DESCENT CHAIN AFTER THE CLIMB (Claude round 2): mine refuses at y=16 ("run surface first"); at the surface the craft is still admitted until the swings are met or the shortfall is 15 min old', async () => {
  const { noteExitShort, exitShortOpen, EXIT_SHORT_TTL_MS } = await import('../src/toolhygiene.mjs')
  const inv = [pk('stone_pickaxe', 52), pk('wooden_pickaxe', 10), ...MATS, { name: 'cobblestone', count: 64 }, { name: 'dirt', count: 64 }]
  const exit = canContinueDescent({ y: 16, health: 20, items: inv })
  assert.equal(exit.reason, 'pickaxe'); assert.equal(pickaxeUses(inv), 60)
  const surface = botWith(inv); surface.entity.position.y = 64
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, surface, new Set(['dirt'])).reason, 'redundant_craft', 'premise: without the memory the surface refuses')
  noteExitShort(surface, exit)
  assert.equal(surface.exitPickShort.want, exit.want)
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, surface, new Set(['dirt'])).ok, true, 'the remedy mine named is admitted at the surface')
  assert.equal(exitShortOpen(surface.exitPickShort, exit.want, Date.now()), false, 'met once the swings are held')
  assert.equal(exitShortOpen(surface.exitPickShort, 0, surface.exitPickShort.at + EXIT_SHORT_TTL_MS), false, 'and forgotten after the TTL')
  noteExitShort(surface, { ok: false, reason: 'scaffold', want: 99 })
  assert.equal(surface.exitPickShort.want, exit.want, 'a scaffold refusal records nothing')
})
t('THE ENTOMBED CHAIN (Claude round 1): one stone@52 -> the escape refuses to dig stone and asks for two; the craft is admitted, prompted or not; after it the escape may dig', () => {
  const inv = [pk('stone_pickaxe', 52), ...MATS]
  const STONEB = { name: 'stone', boundingBox: 'block' }
  assert.equal(REFLEX.mayDigForEscape(inv, STONEB), false, 'premise: exactly one usable pickaxe, the reserve rule refuses')
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, botWith(inv), new Set(['dirt'])).ok, true, 'no detour adopted (dropped): admitted')
  const pre = REFLEX.pickaxePrereq('entombed')
  const { task } = applyPrereq({ id: 'gather_dirt_16', wants: 'dirt' }, { ...pre, since: Date.now() }, prereqHave(inv, pre))
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, botWith(inv), new Set([task.wants, ...(task.wantsAny ?? [])])).ok, true, 'detour adopted: admitted')
  assert.equal(REFLEX.mayDigForEscape([...inv, pk('stone_pickaxe', 131)], STONEB), true, 'the craft was the remedy')
})
t('PREREQUISITES BY NAME AND COUNT (Codex round 1): netherite does not satisfy a stone/iron/diamond detour, count 2 needs two -- neither is refused', () => {
  const nether = [{ name: 'netherite_pickaxe', count: 1, maxDurability: 2031, durabilityUsed: 0 }, pk('wooden_pickaxe', 30), pk('stone_pickaxe', 5)]
  assert.ok(redundantCraft('iron_pickaxe', nether), 'premise: netherite covers an iron craft outside any detour')
  assert.equal(redundantCraft('iron_pickaxe', nether, { wanted: (() => { const { task } = applyPrereq({ id: 'm', wants: 'dirt' }, { items: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'], count: 1, minUses: 81, since: Date.now(), because: 'tunnel' }, 0); return new Set([task.wants, ...(task.wantsAny ?? [])]) })() }), null, 'inside the detour: admitted')
  const pre = { items: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'], count: 1, minUses: 81, since: Date.now(), because: 'tunnel' }
  const wantedOf = p => { const { task } = applyPrereq({ id: 'm', wants: 'dirt' }, p, 0); return new Set([task.wants, ...(task.wantsAny ?? [])]) }
  assert.equal(redundantCraft('stone_pickaxe', nether, { wanted: wantedOf(pre) }), null)
  const two = { items: ['furnace'], count: 2, since: Date.now(), because: 'x' }
  assert.equal(redundantCraft('furnace', [{ name: 'furnace', count: 1 }], { wanted: wantedOf(two) }), null)
})

// ---- the prompt never advertises what admission refuses ------------------------------------------------------------
t('CAN CRAFT NOW omits a pickaxe the gate refuses, keeps it when the task wants it or the copy is below the line', () => {
  const bot = inv => ({ ...botWith(inv), findBlock: () => null })
  const line = (inv, ms = null) => craftableNow(bot(inv), ms)
  const W = pk('wooden_pickaxe', 30)
  assert.match(line([pk('stone_pickaxe', 25), W, ...MATS]), /stone_pickaxe/, 'positive control: 25 uses, listed')
  assert.doesNotMatch(line([pk('stone_pickaxe', 52), W, ...MATS]), /stone_pickaxe/)
  assert.match(line([pk('stone_pickaxe', 52), ...MATS]), /stone_pickaxe/, 'one usable copy: listed (the escape reserve)')
  assert.match(line([pk('stone_pickaxe', 52), W, ...MATS], { wants: 'stone_pickaxe' }), /stone_pickaxe/)
  assert.match(line([pk('stone_pickaxe', 52), W, ...MATS], { wants: 'iron_ingot', wantsAny: ['stone_pickaxe', 'iron_pickaxe'] }), /stone_pickaxe/, 'a detour family keeps it')
  assert.match(craftableNow(bot([pk('stone_pickaxe', 52), W, ...MATS]), null, new Set(['stone_pickaxe'])), /stone_pickaxe/, 'the wanted set cognitive passes is the one used')
})
t('pickRank: golden ranks with wood; non-pickaxes are null', () => {
  assert.equal(pickRank('golden_pickaxe'), pickRank('wooden_pickaxe')); assert.equal(pickRank('stone_axe'), null)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
