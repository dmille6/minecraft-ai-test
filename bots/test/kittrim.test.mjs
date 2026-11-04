// kittrim-01 (kittrim.mjs / kittrimbank.mjs): the carried tool kit trimmed to the best pickaxe + one spare and the best axe,
// shovel and hoe -- usable surplus banked at the town deposit, 1-use surplus junked by use (the wear-out) outside town.
//
// Behaviour only for the decisions (every one a pure export, driven with bags), the REFUSAL CHAIN through the real
// townDepositPlan and wearOutPlan (the composed layers, not the single guard), and a property test over random bags that no
// trim lowers any guard and no trim ever leaves a bag without its best working pickaxe. Each guard has an anchored, unique
// mutant that must fail for the reason it exists (withMutant asserts the anchor is present and unique; the import URL is
// unique, so a cached module can never stand in for the mutant). The wiring into skills.mjs / cognitive.mjs / features.mjs
// is structural (a call site exists), asserted on comment-stripped source, each with its own mutant.
process.env.LOG_DIR = process.env.LOG_DIR || `/tmp/mcbot-test-logs-kittrim-${process.pid}`
process.env.BOT_NAME = process.env.BOT_NAME || 'KitBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
delete process.env.KITTRIM

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

const K = await import('../src/kittrim.mjs')
const KB = await import('../src/kittrimbank.mjs')
const TD = await import('../src/towndeposit.mjs')
const H = await import('../src/hygiene.mjs')
const { FLOOR, HARD_STOP, remaining } = await import('../src/toolfor.mjs')
const { tripKit, tripTarget } = await import('../src/deepmine.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}
const SRC = n => new URL(`../src/${n}`, import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.equal(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} -- the mutant is ambiguous`)
  const out = new URL(`./_mutant-kittrim-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}
/** A mutant must FAIL the behaviour: run `check` against it and require that it throws. */
async function killed (path, old, neu, check, why) {
  await withMutant(path, old, neu, async m => {
    let threw = false
    try { await check(m) } catch { threw = true }
    assert.ok(threw, `MUTANT SURVIVED: ${why}`)
  })
}
// comment-stripped source, for the structural wiring assertions only
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')

// ---- fixtures ---------------------------------------------------------------------------------------------------------
let slotN = 9
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$/
function it (name, count = 1, extra = {}) {
  const def = mcData.itemsByName[name]
  assert.ok(def, `unknown item ${name}`)
  const x = { name, count, slot: extra.slot ?? slotN++, type: def.id, stackSize: def.stackSize, ...extra }
  if (TOOL.test(name)) { x.maxDurability = def.maxDurability; x.durabilityUsed = extra.durabilityUsed ?? 0 }
  return x
}
const tool = (name, uses, extra = {}) => it(name, 1, { durabilityUsed: mcData.itemsByName[name].maxDurability - uses, ...extra })
const fill = n => Array.from({ length: n }, (_, i) => it('dirt', 1, { slot: 60 + i }))
const names = xs => xs.map(s => `${s.name}@${remaining(s)}`).sort()
const kitSteps = p => p.steps.filter(s => s.kittrim)
const NOROOM = () => Infinity   // no stock reader: bankable's own tool cap is off then too

// ---- the switch ---------------------------------------------------------------------------------------------------------
await t('KITTRIM: unset and on are on, off is off, anything else is on with a note', async () => {
  assert.equal(K.kittrimMode({}).on, true)
  assert.equal(K.kittrimMode({ KITTRIM: 'on' }).on, true)
  assert.equal(K.kittrimMode({ KITTRIM: ' OFF ' }).on, false)
  const odd = K.kittrimMode({ KITTRIM: 'maybe' })
  assert.equal(odd.on, true); assert.match(odd.note, /unreadable/)
  assert.match(K.kittrimModeDetail({ on: false, mode: 'off', note: null }), /^phase=mode on=0 mode=off keep=pickaxe:2,axe:1,shovel:1,hoe:1 /)
})

// ---- the kept pickaxe pair ----------------------------------------------------------------------------------------------
await t('kitPickKeep: beside an iron best the spare is the best STONE copy (toolkit-01), not a fuller iron or wooden one', async () => {
  const iron = tool('iron_pickaxe', 200), iron2 = tool('iron_pickaxe', 180), s1 = tool('stone_pickaxe', 60), s2 = tool('stone_pickaxe', 100), w = tool('wooden_pickaxe', 59)
  const k = K.kitPickKeep([w, s1, iron2, s2, iron])
  assert.equal(k.best, iron); assert.equal(k.spare, s2)
})
await t('kitPickKeep: a stone best takes the next working copy by tier and uses; no working pickaxe keeps nothing', async () => {
  const s = tool('stone_pickaxe', 100), s2 = tool('stone_pickaxe', 30), w = tool('wooden_pickaxe', 59)
  const k = K.kitPickKeep([w, s2, s])
  assert.equal(k.best, s); assert.equal(k.spare, s2)
  const none = K.kitPickKeep([tool('stone_pickaxe', 9), tool('stone_pickaxe', 1)])
  assert.equal(none.best, null); assert.equal(none.spare, null)
})
await t('kitPickKeep: with one working copy the spare is the fullest WORN copy above HARD_STOP', async () => {
  const s = tool('stone_pickaxe', 100), worn = tool('stone_pickaxe', 7), one = tool('stone_pickaxe', 1)
  const k = K.kitPickKeep([one, worn, s])
  assert.equal(k.best, s); assert.equal(k.spare, worn)
})

// ---- the bank half ------------------------------------------------------------------------------------------------------
await t('kitTrimBank: banks the usable surplus by KIND -- the lower-tier axe beside the iron one, pickaxes past the pair', async () => {
  const iron = tool('iron_pickaxe', 200), s1 = tool('stone_pickaxe', 100), s2 = tool('stone_pickaxe', 80), w = tool('wooden_pickaxe', 50)
  const ia = tool('iron_axe', 200), sa = tool('stone_axe', 100), wa = tool('wooden_axe', 50), is = tool('iron_shovel', 200), ws = tool('wooden_shovel', 40)
  const r = KB.kitTrimBank([iron, s1, s2, w, ia, sa, wa, is, ws, it('cobblestone', 64)], { room: NOROOM })
  assert.deepEqual(r.steps.map(s => `${s.name}@${s.uses}`).sort(), ['stone_axe@100', 'stone_pickaxe@80', 'wooden_axe@50', 'wooden_pickaxe@50', 'wooden_shovel@40'])
  assert.deepEqual(r.kept, [iron.slot, s1.slot, ia.slot, is.slot].sort((a, b) => a - b))
  assert.ok(r.steps.every(s => s.count === 1 && Number.isInteger(s.slot)))
})
await t('kitTrimBank: NEVER a worn copy (<= FLOOR) -- spent copies are the wear-out\'s, not the bank\'s', async () => {
  const r = KB.kitTrimBank([tool('iron_pickaxe', 200), tool('stone_pickaxe', 100), tool('stone_pickaxe', FLOOR), tool('stone_pickaxe', 1), tool('iron_axe', 100), tool('stone_axe', 5)], { room: NOROOM })
  assert.deepEqual(r.steps, [])
})
await t('kitTrimBank: a lone pickaxe, a lone axe: nothing moves (the only copy of its kind stays)', async () => {
  assert.deepEqual(KB.kitTrimBank([tool('stone_pickaxe', 100), tool('stone_axe', 100), tool('wooden_shovel', 50)], { room: NOROOM }).steps, [])
})
await t('kitTrimBank: a withdraw hold keeps every copy of its name', async () => {
  const bag = [tool('iron_pickaxe', 200), tool('stone_pickaxe', 100), tool('stone_pickaxe', 90), tool('iron_axe', 100), tool('stone_axe', 100)]
  const r = KB.kitTrimBank(bag, { room: NOROOM, holds: { stone_pickaxe: 1 } })
  assert.deepEqual(r.steps.map(s => s.name), ['stone_axe'])
  assert.equal(r.held.withdraw_hold, 1)
})
await t('kitTrimBank: the town\'s room per name (better copies first), less what the plan already moves; unknown = none', async () => {
  const bag = [tool('iron_pickaxe', 200), tool('stone_pickaxe', 120), tool('stone_pickaxe', 100), tool('stone_pickaxe', 90), tool('stone_pickaxe', 70)]
  const one = KB.kitTrimBank(bag, { room: n => (n === 'stone_pickaxe' ? 1 : Infinity) })
  assert.deepEqual(one.steps.map(s => s.uses), [100], 'room 1: the best surplus copy goes, the spare (120) stays')
  assert.equal(one.held.town_stock_target, 2)
  const planned = KB.kitTrimBank(bag, { room: () => 2, planned: { stone_pickaxe: 1 } })
  assert.equal(planned.steps.length, 1, 'one copy already planned by the base rule spends one of the two')
  const unknown = KB.kitTrimBank(bag, { room: () => null })
  assert.deepEqual(unknown.steps, []); assert.equal(unknown.held.town_stock_unknown, 3)
  const zero = KB.kitTrimBank([tool('iron_axe', 200), tool('wooden_axe', 50)], { room: n => (n === 'wooden_axe' ? 0 : Infinity) })
  assert.deepEqual(zero.steps, [], 'a target-0 name (wooden axe) stays in the bag')
})
await t('GUARD deep_trip: a bag paying for a DIAMOND trip keeps the stone copies the descent needs', async () => {
  const bag = [tool('iron_pickaxe', 60), tool('stone_pickaxe', 131), tool('stone_pickaxe', 131)]
  assert.equal(tripTarget(tripKit(bag)), 'diamond')
  const r = KB.kitTrimBank(bag, { room: NOROOM })
  assert.deepEqual(r.steps, []); assert.equal(r.held.guard_deep_trip, 1)
  // with iron to spare the second stone copy is not needed: it goes
  const rich = [tool('iron_pickaxe', 250), tool('stone_pickaxe', 131), tool('stone_pickaxe', 131)]
  assert.equal(KB.kitTrimBank(rich, { room: NOROOM }).steps.length, 1)
})
await t('GUARD kit_need: a worn-but-usable iron axe beside a fuller stone axe stays (no town iron spent on a new one)', async () => {
  const r = KB.kitTrimBank([tool('iron_axe', 15), tool('stone_axe', 100)], { room: NOROOM })
  assert.deepEqual(r.steps, []); assert.equal(r.held.guard_kit_need, 1)
})
await t('GUARD craft_cover: the copy that makes a wooden-pickaxe craft redundant stays (no bank-then-craft churn)', async () => {
  // two iron copies are the pair; an iron copy never covers a wooden/stone craft (toolhygiene: iron retention), the wooden one does
  const r = KB.kitTrimBank([tool('iron_pickaxe', 207), tool('iron_pickaxe', 159), tool('wooden_pickaxe', 30)], { room: NOROOM })
  assert.deepEqual(r.steps, []); assert.equal(r.held.guard_craft_cover, 1)
  // and a bag paying for a diamond trip is held by deep_trip first (iron@200 + stone@20 + wooden@50: 230 low-equivalent uses)
  assert.equal(KB.kitTrimBank([tool('iron_pickaxe', 200), tool('stone_pickaxe', 20), tool('wooden_pickaxe', 50)], { room: NOROOM }).held.guard_deep_trip, 1)
})
await t('GUARD trip_pickaxe: the only stone-or-better copy with 40+ uses stays beside a worn diamond best', async () => {
  const r = KB.kitTrimBank([tool('diamond_pickaxe', 20), tool('iron_pickaxe', 50), tool('stone_pickaxe', 30)], { room: NOROOM })
  assert.deepEqual(r.steps, []); assert.equal(r.held.guard_trip_pickaxe, 1)
})
await t('kitGuardBroken: each guard names itself when its measure falls', async () => {
  const two = [tool('stone_pickaxe', 100), tool('stone_pickaxe', 100)]
  assert.equal(KB.kitGuardBroken(two, two.slice(0, 1), { escape_reserve: KB.KIT_GUARDS.escape_reserve }), 'escape_reserve')
  assert.equal(KB.kitGuardBroken([tool('iron_pickaxe', 100), tool('stone_pickaxe', 100)], [tool('stone_pickaxe', 100)], { harvest_tier: KB.KIT_GUARDS.harvest_tier }), 'harvest_tier')
  assert.equal(KB.kitGuardBroken([tool('stone_pickaxe', 100)], [], { usable_pickaxe: KB.KIT_GUARDS.usable_pickaxe }), 'usable_pickaxe')
  assert.equal(KB.kitGuardBroken(two, two), null)
})

// ---- the property: no trim lowers a guard, the best working pickaxe always stays ----------------------------------------
await t('PROPERTY (2,000 random bags): every guard holds, no worn copy moves, the best working pickaxe and one of each kind stay', async () => {
  let seed = 7
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  const NAMES = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe', 'wooden_axe', 'stone_axe', 'iron_axe', 'wooden_shovel', 'stone_shovel', 'iron_shovel', 'stone_hoe']
  let moved = 0
  for (let i = 0; i < 2000; i++) {
    slotN = 9
    const bag = Array.from({ length: 1 + rnd(9) }, () => { const n = NAMES[rnd(NAMES.length)]; return tool(n, 1 + rnd(mcData.itemsByName[n].maxDurability)) })
    const r = KB.kitTrimBank(bag, { room: NOROOM })
    const gone = new Set(r.steps.map(s => s.slot))
    const left = bag.filter(x => !gone.has(x.slot))
    moved += r.steps.length
    assert.equal(KB.kitGuardBroken(bag, left), null, `bag ${i}: ${names(bag)} -> ${names(left)}`)
    assert.ok(r.steps.every(s => s.uses > FLOOR), 'a worn copy moved')
    const { best } = K.kitPickKeep(bag)
    if (best) assert.ok(left.includes(best), 'the best working pickaxe left the bag')
    for (const k of ['pickaxe', 'axe', 'shovel', 'hoe']) {
      if (bag.some(x => K.kindOf(x.name) === k && remaining(x) > FLOOR)) assert.ok(left.some(x => K.kindOf(x.name) === k && remaining(x) > FLOOR), `the last working ${k} left`)
    }
  }
  assert.ok(moved > 500, `the property must see trims happen (positive control): ${moved}`)
})

// ---- the composed chain: the real town deposit plan -----------------------------------------------------------------------
await t('CHAIN townDepositPlan (tail visit): the kit steps are planned, flagged, after the base stacks, and free a slot each', async () => {
  slotN = 9
  const bag = [tool('iron_pickaxe', 200), tool('stone_pickaxe', 100), tool('wooden_pickaxe', 50), tool('iron_axe', 200), tool('stone_axe', 100), ...fill(10)]
  const p = TD.townDepositPlan(bag, { tail: 'only', noSwords: true, kitRoom: NOROOM })
  assert.deepEqual(kitSteps(p).map(s => s.name).sort(), ['stone_axe', 'wooden_pickaxe'])
  assert.equal(p.freed, p.steps.filter(s => !s.half).length)
  assert.equal(p.why.stone_axe, 'kittrim')
  const off = TD.townDepositPlan(bag, { tail: 'only', noSwords: true, kittrim: false })
  assert.equal(kitSteps(off).length, 0, 'the kill switch: no kit step')
  // the order fires for it: a not-full visit at town with only kit surplus
  const o = TD.tailOrder({ now: 1e9, slots: bag.length, pos: { x: 1, y: 70, z: 1 }, home: { x: 0, y: 70, z: 0 }, plan: () => p, container: true, on: true, myName: 'KitBot' })
  assert.equal(o.order?.skill, 'town_deposit'); assert.equal(o.order.args.tail, true)
})
await t('CHAIN townDepositPlan (full bag): the trim never lists a slot the base plan or row P already moves', async () => {
  slotN = 9
  const bag = [tool('iron_pickaxe', 200), tool('iron_pickaxe', 150), tool('stone_pickaxe', 120), tool('stone_pickaxe', 100), tool('stone_pickaxe', 90), tool('stone_pickaxe', 80),
               tool('wooden_pickaxe', 50), tool('iron_axe', 200), tool('stone_axe', 100), ...fill(27)]
  const p = TD.townDepositPlan(bag, { noSwords: true, kitRoom: NOROOM })
  const slots = p.steps.map(s => s.slot)
  assert.equal(new Set(slots).size, slots.length, `a slot planned twice: ${slots}`)
  assert.ok(kitSteps(p).length >= 1, 'the trim adds copies the base rule keeps (the lower-tier ones)')
  const left = bag.filter(x => !slots.includes(x.slot))
  assert.ok(left.some(x => x.name === 'iron_pickaxe' && remaining(x) === 200), 'the best pickaxe stays')
  assert.ok(left.some(x => x.name === 'stone_pickaxe' && remaining(x) > FLOOR), 'a working stone spare stays beside the iron one (toolkit-01)')
})

// ---- the wear half --------------------------------------------------------------------------------------------------------
await t('kitWearList: 1-use pickaxes only beside TWO working pickaxes; never a 0-use phantom; a lone 1-use axe stays', async () => {
  const one = tool('stone_pickaxe', 1), zero = tool('stone_pickaxe', 0)
  assert.deepEqual(K.kitWearList([tool('iron_pickaxe', 200), tool('stone_pickaxe', 100), one, zero]), [one])
  assert.deepEqual(K.kitWearList([tool('iron_pickaxe', 200), tool('stone_pickaxe', 9), one]), [], 'one working + a worn spare: the deployed last-swing keeps decide')
  const ax1 = tool('stone_axe', 1)
  assert.deepEqual(K.kitWearList([tool('iron_axe', 100), ax1]), [ax1])
  assert.deepEqual(K.kitWearList([tool('stone_axe', 1)]), [], 'the only copy of its kind: toolFor uses it up on a harvest dig')
})
await t('kitWearEarly: outside the town ground square at any depth, a known home, KT_WEAR_SLOTS slots, the switch', async () => {
  const home = { x: 0, y: 70, z: 0 }
  assert.equal(K.kitWearEarly({ on: true, pos: { x: 200, y: 64, z: 5 }, home, slots: 24 }), true)
  assert.equal(K.kitWearEarly({ on: true, pos: { x: 10, y: 70, z: -12 }, home, slots: 30 }), false, 'in town')
  assert.equal(K.kitWearEarly({ on: true, pos: { x: 19, y: 70, z: 0 }, home, slots: 30 }), false, 'inside the instrument margin')
  assert.equal(K.kitWearEarly({ on: true, pos: { x: 2, y: 20, z: 3 }, home, slots: 30 }), false, 'the town stair, 50 blocks under the square')
  assert.equal(K.kitWearEarly({ on: true, pos: { x: 21, y: 70, z: -21 }, home, slots: 30 }), true, 'just past the square + margin')
  assert.equal(K.kitWearEarly({ on: true, pos: { x: 200, y: 64, z: 5 }, home: null, slots: 30 }), false, 'unknown home fails closed')
  assert.equal(K.kitWearEarly({ on: true, pos: { x: 200, y: 64, z: 5 }, home, slots: 23 }), false)
  assert.equal(K.kitWearEarly({ on: false, pos: { x: 200, y: 64, z: 5 }, home, slots: 30 }), false)
})
await t('CHAIN wearOutPlan: early (outside town) lists the kit copies from 24 slots; in town a full bag lists exactly the deployed set', async () => {
  slotN = 9
  const iron = tool('iron_pickaxe', 200), wood = tool('wooden_pickaxe', 50), o1 = tool('wooden_pickaxe', 1), o2 = tool('iron_pickaxe', 1)
  const bag = [iron, wood, o1, o2, ...fill(22)]
  const early = H.wearOutPlan(bag, { early: true })
  assert.deepEqual(names(early.tools), names([o1, o2])); assert.equal(early.kittrim, 2)
  assert.deepEqual(H.wearOutPlan(bag, { early: false }).tools, [], 'not early: below TRIGGER_SLOTS nothing, as deployed')
  assert.deepEqual(H.wearOutPlan(bag.slice(0, 20), { early: true }).tools, [], 'below KT_WEAR_SLOTS')
  const full = [iron, wood, o1, o2, ...fill(31)]
  assert.ok(full.length >= H.TRIGGER_SLOTS)
  const town = H.wearOutPlan(full, { early: false }), base = H.wearOutPlan(full, { kittrim: false })
  assert.deepEqual(town.tools, base.tools, 'in town (no early) the full bag wears out the deployed list exactly'); assert.equal(town.kittrim, 0)
  const away = H.wearOutPlan(full, { early: true })
  assert.ok(away.tools.length >= base.tools.length && base.tools.every(x => away.tools.includes(x)), 'outside town: the deployed list first, the kit extras after')
  assert.equal(away.kitTools.length, away.kittrim)
})
await t('rows: the bank and wear details stay under 300 and carry the counts the read needs', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: 'stone_pickaxe', tag: `stone_pickaxe@${100 + i}` }))
  const b = K.kittrimBankDetail({ mode: 'tail', planned: many, banked: many.slice(0, 3), slotsBefore: 30, slotsAfter: 27, held: 'town_stock_target:2' })
  assert.ok(b.length <= 300); assert.match(b, /^phase=bank mode=tail planned=40 banked=3 freed=3 slots=30->27 held=town_stock_target:2 tools=/)
  const w = K.kittrimWearDetail({ early: true, listed: 2, worn: 1, of: 2, slotsBefore: 26, slotsAfter: 25, tools: ['stone_pickaxe@1', 'iron_pickaxe@1'] })
  assert.equal(w, 'phase=wear early=1 listed=2 worn=1 of=2 freed=1 slots=26->25 tools=stone_pickaxe@1,iron_pickaxe@1')
})

// ---- mutants: each guard fails for the reason it exists ----------------------------------------------------------------------
const KP = SRC('kittrim.mjs'), KBP = SRC('kittrimbank.mjs'), HP = SRC('hygiene.mjs'), TDP = SRC('towndeposit.mjs')
await t('MUTANT KILLED: two working pickaxes -> one lets the wear-out take a bag\'s last-swing copies', async () => {
  await killed(KP, 'if (picks.filter(working).length >= 2) out.push', 'if (picks.filter(working).length >= 1) out.push', m => {
    assert.deepEqual(m.kitWearList([tool('iron_pickaxe', 200), tool('stone_pickaxe', 9), tool('stone_pickaxe', 1)]), [])
  }, 'one working pickaxe would lose its 1-use copies')
})
await t('MUTANT KILLED: without the town box test the early wear-out digs the town\'s ground', async () => {
  await killed(KP, 'if (Math.abs(Math.floor(pos.x) - Math.floor(home.x)) <= KT_TOWN_HALF && Math.abs(Math.floor(pos.z) - Math.floor(home.z)) <= KT_TOWN_HALF) return false', '', m => {
    assert.equal(m.kitWearEarly({ on: true, pos: { x: 3, y: 20, z: 3 }, home: { x: 0, y: 70, z: 0 }, slots: 30 }), false)
  }, 'a bot in the town stair ran the early wear-out')
})
await t('MUTANT KILLED: without the stone preference the iron best\'s spare is a second iron (toolkit-01 broken)', async () => {
  await killed(KP, "const stone = tier(best.name) >= IRON ? rest.filter(it => it.name === 'stone_pickaxe').sort(byUses)[0] : null", 'const stone = null', m => {
    const iron = tool('iron_pickaxe', 200), iron2 = tool('iron_pickaxe', 180), s = tool('stone_pickaxe', 60)
    assert.equal(m.kitPickKeep([iron2, s, iron]).spare, s)
  }, 'the stone spare was not kept')
})
await t('MUTANT KILLED: without the working filter a worn pickaxe is banked', async () => {
  await killed(KBP, "cand.push(...list.filter(it => isPickaxe(it.name) && !keep.has(it) && working(it)))", "cand.push(...list.filter(it => isPickaxe(it.name) && !keep.has(it)))", m => {
    assert.deepEqual(m.kitTrimBank([tool('iron_pickaxe', 200), tool('stone_pickaxe', 100), tool('stone_pickaxe', 5)], { room: () => Infinity }).steps, [])
  }, 'a worn copy reached the chest')
})
await t('MUTANT KILLED: without the hold check a just-withdrawn pickaxe goes straight back', async () => {
  await killed(KBP, "if ((holds?.[it.name] ?? 0) > 0) { hold('withdraw_hold'); continue }", '', m => {
    const r = m.kitTrimBank([tool('iron_pickaxe', 200), tool('stone_pickaxe', 100), tool('stone_pickaxe', 90)], { room: () => Infinity, holds: { stone_pickaxe: 1 } })
    assert.deepEqual(r.steps, [])
  }, 'a held name moved')
})
await t('MUTANT KILLED: without the planned subtraction the trim overshoots the town\'s room', async () => {
  await killed(KBP, '- Math.max(0, Number(planned?.[it.name]) || 0)', '', m => {
    const bag = [tool('iron_pickaxe', 200), tool('stone_pickaxe', 120), tool('stone_pickaxe', 100), tool('stone_pickaxe', 90)]
    assert.equal(m.kitTrimBank(bag, { room: () => 1, planned: { stone_pickaxe: 1 } }).steps.length, 0)
  }, 'the base plan\'s copy was not charged')
})
await t('MUTANT KILLED: without the deep_trip guard a diamond-trip bag is trimmed to an iron trip', async () => {
  await killed(KBP, '  deep_trip: b => TRIP_RANK[tripTarget(tripKit(b))] ?? 0,\n', '', m => {
    assert.deepEqual(m.kitTrimBank([tool('iron_pickaxe', 60), tool('stone_pickaxe', 131), tool('stone_pickaxe', 131)], { room: () => Infinity }).steps, [])
  }, 'the deep miner lost its descent')
})
await t('MUTANT KILLED: without the add-back loop no guard is enforced', async () => {
  await killed(KBP, '    if (!broken) break\n', '    break\n', m => {
    assert.deepEqual(m.kitTrimBank([tool('iron_axe', 15), tool('stone_axe', 100)], { room: () => Infinity }).steps, [])
  }, 'a guard was named and ignored')
})
await t('MUTANT KILLED: dropping `early` from the wear list wears out kit copies in town at a full bag', async () => {
  await killed(HP, 'const kit = kittrim && early ? kitWearList(list) : []', 'const kit = kittrim ? kitWearList(list) : []', m => {
    slotN = 9
    const full = [tool('iron_pickaxe', 200), tool('wooden_pickaxe', 50), tool('wooden_pickaxe', 1), tool('iron_pickaxe', 1), ...fill(31)]
    assert.deepEqual(m.wearOutPlan(full, { early: false }).tools, m.wearOutPlan(full, { kittrim: false }).tools)
  }, 'the in-town full bag listed more than deployed')
})
await t('MUTANT KILLED: without the moving-slot filter the trim plans a slot the base rule already moves', async () => {
  await killed(TDP, 'kitTrimBank(list.filter(it => !moving.has(it.slot)),', 'kitTrimBank(list.filter(it => true),', m => {
    slotN = 9
    const bag = [tool('iron_pickaxe', 200), tool('iron_pickaxe', 150), tool('stone_pickaxe', 120), tool('stone_pickaxe', 100), tool('stone_pickaxe', 90), tool('stone_pickaxe', 80),
                 tool('wooden_pickaxe', 50), tool('iron_axe', 200), tool('stone_axe', 100), ...fill(27)]
    const slots = m.townDepositPlan(bag, { noSwords: true, kitRoom: () => Infinity }).steps.map(s => s.slot)
    assert.equal(new Set(slots).size, slots.length)
  }, 'a slot was planned twice')
})

// ---- wiring (structural: the call sites exist; each assertion has a mutant that fails it) -----------------------------------
const SK = SRC('skills.mjs'), CG = SRC('cognitive.mjs'), FE = SRC('features.mjs')
const WIRES = [
  [SK, 'wear_out re-reads the early test at the run', "const early = _args?.kittrim === true && kitWearEarly({ pos: bot.entity?.position, home: townHome(), slots: bot.inventory?.items?.()?.length ?? 0 })"],
  [SK, 'wear_out plans with that early flag', "const plan = wearOutPlan(bot.inventory?.items?.() ?? [], { early })"],
  [SK, 'the town deposit counts the server-verified kit steps', 'if (step.kittrim) kitBanked.push(step)'],
  [SK, 'the town deposit writes the bank row', "detail: kittrimBankDetail({ mode: tail ? 'tail' : 'full', planned: kitPlanned, banked: kitBanked, slotsBefore, slotsAfter, held: startPlan.kitHeld || null })"],
  [CG, 'the order asks the place test', 'const early = kitWearEarly({ pos: this.bot.entity?.position, home: configuredHome(config.world), slots: wearItems.length })'],
  [CG, 'the order carries it to the run', "args: early && plan.kittrim > 0 ? { kittrim: true } : {},"],
  [FE, 'the licence row', "logEvent({ kind: 'kittrim_mode', status: 'success', snapshot: snapshot(bot), detail: kittrimModeDetail() })"],
]
await t('WIRING: every call site is in the executable source (comments stripped)', async () => {
  for (const [p, what, line] of WIRES) {
    const code = strip(readFileSync(p, 'utf8'))
    assert.equal(code.split(line).length, 2, `${what}: not present exactly once in ${p.pathname}`)
  }
})
await t('WIRING MUTANTS: removing any one call site fails its assertion', async () => {
  for (const [p, what, line] of WIRES) {
    const src = readFileSync(p, 'utf8')
    assert.ok(src.includes(line), `ANCHOR MISSING: ${what}`); assert.equal(src.split(line).length, 2, `ANCHOR NOT UNIQUE: ${what}`)
    const mutated = strip(src.replace(line, '/* removed */'))
    assert.notEqual(mutated.split(line).length, 2, `MUTANT SURVIVED: ${what}`)
  }
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
