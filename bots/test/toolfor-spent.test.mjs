// SPENT TOOLS GET USED UP (owner, 10-03: full bags are the root blocker; never toss or drop). Behaviour only, through
// the exported pure functions and the real harvest dig, against REAL 1.21 block data (prismarine-block digTime and
// canHarvest), because the decision turns on real dig times: a wooden axe takes a log in 1.5 s against the hand's 3.0 s,
// inside toolFor's SLACK, so the hand used to win even when the axe was not floor-reserved.
//
// Fleet 10-03 ~22:45Z, bots at >= 34/36 slots: ~118-170 dig-tool copies at 2-10 uses, overwhelmingly SOLE axes (74)
// and shovels (53), held forever -- toolFor reserved any copy at <= FLOOR uses for blocks that need its tier, and no
// block needs an axe or a shovel to drop.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { toolFor, travelTool, usableTools, spentPickaxeFor, hardStopFor, byCost, mostWornOfName, spentEquipOutcome, remaining, tier, FLOOR, HARD_STOP } from '../src/toolfor.mjs'
import { diffTools, spentTools } from '../src/toolwatch.mjs'
import { wearRefusals, slotObservation } from '../src/hygiene.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const require_ = createRequire(import.meta.url)
const VERSION = '1.21.11'
const mcData = require_('minecraft-data')(VERSION)
const Block = require_('prismarine-block')(VERSION)
const blk = (name, pos = null) => { const b = Block.fromStateId(mcData.blocksByName[name].defaultState, 0); if (pos) b.position = pos; return b }
let slotN = 9
const item = (name, left) => {
  const max = mcData.itemsByName[name].maxDurability
  return { name, type: mcData.itemsByName[name].id, count: 1, maxDurability: max, durabilityUsed: max - left, slot: slotN++ }
}
const tag = it => (it ? `${it.name}@${remaining(it)}` : 'hand')
const ICE = blk('ice'), LOG = blk('oak_log'), DIRT = blk('dirt'), STONE = blk('stone'), COAL = blk('coal_ore'), IRON_ORE = blk('iron_ore'), DIAMOND = blk('diamond_ore')
const HARVEST = { lastSwing: true }
const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]))

await t('INSTRUMENT: the real dig times this file depends on (a wooden axe is inside SLACK of the hand on a log)', () => {
  assert.equal(LOG.digTime(null, false, false, false), 3000)
  assert.equal(LOG.digTime(mcData.itemsByName.wooden_axe.id, false, false, false), 1500)
  assert.equal(LOG.digTime(mcData.itemsByName.stone_axe.id, false, false, false), 750)
  assert.equal(DIRT.digTime(mcData.itemsByName.wooden_shovel.id, false, false, false), 400)
  assert.equal(DIRT.digTime(null, false, false, false), 750)
})

// ---- PART 1: axes, shovels, hoes are used up ----------------------------------------------------------------------
await t('a SOLE spent axe IS swung on a log, and a sole spent shovel on dirt -- every tier, every dig at 2-10 uses', () => {
  for (const name of ['wooden_axe', 'stone_axe', 'iron_axe']) {
    for (const left of [10, 5, 2]) {
      for (const opts of [{}, HARVEST]) {
        const r = toolFor(LOG, [item(name, left)], opts)
        assert.equal(r.item?.name, name, `${name} at ${left} ${JSON.stringify(opts)}: ${r.reason}`)
      }
    }
  }
  for (const name of ['wooden_shovel', 'stone_shovel', 'iron_shovel']) {
    const r = toolFor(DIRT, [item(name, 3)])
    assert.equal(r.item?.name, name, `${name} at 3: ${r.reason}`)
  }
  assert.equal(toolFor(LOG, [item('wooden_axe', 5)]).reason, 'use_up', 'the wooden axe wins where the hand used to (inside SLACK)')
})

await t('control: a NON-spent wooden axe still yields to the hand on a log (the hand-within-SLACK rule is unchanged above FLOOR)', () => {
  assert.deepEqual(toolFor(LOG, [item('wooden_axe', FLOOR + 1)]), { item: null, hand: true, reason: 'hand' })
  assert.equal(toolFor(LOG, [item('stone_axe', 100)]).item.name, 'stone_axe', 'a stone axe is outside SLACK of the hand: it was always used')
})

await t('a spent tool is used only where it is FASTER than the hand -- including the `slow` branch: no axe on dirt, no shovel on a log', () => {
  assert.equal(toolFor(DIRT, [item('stone_axe', 3)]).hand, true)
  assert.equal(toolFor(LOG, [item('stone_shovel', 3)]).hand, true)
  // THE `slow` BRANCH: on ice a floor-reserved stone pickaxe (200 ms) pulls the cap to 400 ms, so the hand (750 ms) is
  // outside it; a spent shovel digs ice at hand speed and must not be the "slow" pick (it was, before item 6)
  const r = toolFor(ICE, [item('stone_pickaxe', 5), item('stone_shovel', 3)])
  assert.deepEqual([r.hand, r.reason], [true, 'hand'], `wrong-kind spent tool taken: ${r.reason} ${tag(r.item)}`)
})

await t('among copies of the SAME NAME the most-worn goes first (finish one before starting the next)', () => {
  const worn = item('stone_axe', 3), fresh = item('stone_axe', 120)
  assert.equal(toolFor(LOG, [fresh, worn]).item, worn)
  assert.equal(toolFor(LOG, [worn, fresh]).item, worn)
  const s1 = item('iron_shovel', 2), s2 = item('iron_shovel', 200)
  assert.equal(toolFor(DIRT, [s2, s1]).item, s1)
  const h1 = item('stone_axe', 40), h2 = item('stone_axe', 90)
  assert.equal(toolFor(LOG, [h2, h1]).item, h1, 'above FLOOR too: same-name copies are finished in order')
})

await t('ORDER-INDEPENDENT: every slot permutation of mixed-kind inventories picks the same copy (the comparator cycle, both reviews)', () => {
  const cases = [
    [LOG, () => [item('stone_axe', 90), item('stone_shovel', 50), item('stone_axe', 3)], 'stone_axe@3'],
    [LOG, () => [item('stone_axe', 3), item('stone_axe', 90), item('stone_pickaxe', 50)], 'stone_axe@3'],
    [LOG, () => [item('stone_axe', 90), item('stone_pickaxe', 50), item('stone_axe', 3)], 'stone_axe@3'],
    [LOG, () => [item('wooden_axe', 50), item('stone_axe', 3), item('stone_axe', 90)], 'wooden_axe@50'],
    [DIRT, () => [item('stone_axe', 90), item('stone_shovel', 50), item('stone_shovel', 4)], 'stone_shovel@4'],
    [DIRT, () => [item('stone_shovel', 2), item('stone_pickaxe', 50), item('stone_axe', 3)], 'stone_shovel@2'],
    [STONE, () => [item('stone_pickaxe', 20), item('stone_axe', 3), item('stone_pickaxe', 90)], 'stone_pickaxe@90'],
  ]
  for (const [b, make, want] of cases) {
    for (const opts of [{}, HARVEST]) {
      for (const p of perms(make())) {
        const got = tag(toolFor(b, p, opts).item)
        if (b === STONE && opts.lastSwing) continue   // part 2 has its own tests
        assert.equal(got, want, `${b.name} ${p.map(tag).join(',')} ${JSON.stringify(opts)}`)
      }
    }
  }
  // and exhaustively over a pool: the pick never depends on slot order
  const pool = [['stone_axe', 3], ['stone_axe', 90], ['stone_shovel', 50], ['stone_pickaxe', 50], ['wooden_axe', 5], ['iron_axe', 2], ['stone_shovel', 2]]
  for (const b of [LOG, DIRT]) {
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) for (let k = j + 1; k < pool.length; k++) {
      const make = () => [pool[i], pool[j], pool[k]].map(([n, l]) => item(n, l))
      const seen = new Set(perms(make()).map(p => tag(toolFor(b, p).item)))
      assert.equal(seen.size, 1, `${b.name} ${[pool[i], pool[j], pool[k]].join(' ')}: ${[...seen].join(' / ')}`)
    }
  }
})

await t('the comparator is TRANSITIVE (tier, then fuller); the same-name swap only ever trades for a more-worn copy of that name', () => {
  const x = (name, r) => ({ name, r, tier: tier(name), spend: !/_pickaxe$/.test(name) })
  const set = [x('stone_axe', 3), x('stone_axe', 90), x('stone_pickaxe', 50), x('stone_shovel', 50), x('wooden_axe', 5), x('iron_axe', 2)]
  for (const a of set) for (const b of set) for (const c of set) {
    if (byCost(a, b) < 0 && byCost(b, c) < 0) assert.ok(byCost(a, c) < 0, `${a.name}@${a.r} < ${b.name}@${b.r} < ${c.name}@${c.r} but not a < c`)
  }
  assert.ok(byCost(x('stone_pickaxe', 3), x('stone_pickaxe', 90)) > 0, 'the fuller copy first, as before')
  assert.ok(byCost(x('iron_axe', 300), x('stone_axe', 2)) > 0, 'never iron over stone for being fuller')
  assert.equal(byCost(x('stone_axe', Infinity), x('stone_axe', Infinity)), 0, 'two unknown durabilities tie, never NaN')
  assert.equal(mostWornOfName(set[1], set).r, 3)
  assert.equal(mostWornOfName(set[2], set), set[2], 'a pickaxe with no more-worn copy of its name stays')
})

await t('ACROSS tiers the cheapest adequate tier still goes first: a fuller cheaper tool is not displaced, iron is never preferred for being fuller', () => {
  assert.equal(toolFor(LOG, [item('stone_axe', 3), item('wooden_axe', 50)]).item.name, 'wooden_axe')
  assert.equal(toolFor(LOG, [item('iron_axe', 250), item('stone_axe', 90)]).item.name, 'stone_axe')
  assert.equal(toolFor(LOG, [item('iron_axe', 3), item('stone_axe', 90)]).item.name, 'stone_axe', 'a spent iron does not jump the tier order')
  assert.equal(toolFor(DIRT, [item('iron_shovel', 250), item('stone_shovel', 2)]).item.name, 'stone_shovel')
})

await t('HARD STOP: 0 for an axe/shovel/hoe ONLY on a harvest dig; travel and reflex digs keep HARD_STOP for every kind', () => {
  for (const name of ['stone_axe', 'wooden_hoe', 'stone_shovel']) {
    assert.equal(hardStopFor(item(name, 5), HARVEST), 0, name)
    assert.equal(hardStopFor(item(name, 5)), HARD_STOP, `${name}: not on travel/reflex digs`)
  }
  assert.equal(toolFor(LOG, [item('stone_axe', 1)], HARVEST).item.name, 'stone_axe', 'harvest: a 1-use axe is swung and breaks')
  assert.equal(toolFor(DIRT, [item('wooden_shovel', 1)], HARVEST).item.name, 'wooden_shovel')
  assert.deepEqual(toolFor(LOG, [item('stone_axe', 1)]), { item: null, hand: true, reason: 'hand' }, 'reflex/any non-harvest dig: the hand')
  assert.equal(travelTool(DIRT, [item('stone_shovel', 1)], null), null, 'the pathfinder is never handed a 1-use shovel')
  assert.equal(travelTool(DIRT, [item('stone_shovel', 4)], null)?.name, 'stone_shovel', 'but the FLOOR removal holds on travel digs')
})

await t('a 0-use axe/shovel/hoe is NEVER chosen (the server already broke it), even on a harvest dig', () => {
  assert.deepEqual(toolFor(LOG, [item('stone_axe', 0)], HARVEST), { item: null, hand: true, reason: 'hand' })
  assert.equal(remaining(toolFor(LOG, [item('stone_axe', 0), item('stone_axe', 1)], HARVEST).item), 1)
})

// ---- pickaxes: unchanged --------------------------------------------------------------------------------------------
await t('PICKAXES UNCHANGED: FLOOR reserve, HARD_STOP=1, iron retention, the fuller copy first, never "used up" on dirt', () => {
  assert.equal(HARD_STOP, 1)
  assert.equal(hardStopFor(item('stone_pickaxe', 5), HARVEST), HARD_STOP)
  assert.equal(toolFor(STONE, [item('stone_pickaxe', 5)]).reason, 'reserved_required', 'a lone spent pickaxe is still only swung when nothing else can')
  assert.equal(toolFor(STONE, [item('stone_pickaxe', 1)]).reason, 'none', 'a 1-use pickaxe is still hard-stopped (no lastSwing)')
  assert.equal(remaining(toolFor(STONE, [item('stone_pickaxe', 20), item('stone_pickaxe', 90)]).item), 90)
  assert.equal(toolFor(IRON_ORE, [item('iron_pickaxe', FLOOR), item('stone_pickaxe', 100)]).item.name, 'stone_pickaxe', 'iron retention')
  assert.equal(toolFor(DIAMOND, [item('iron_pickaxe', FLOOR), item('stone_pickaxe', 100)]).reason, 'reserved_required')
  assert.equal(toolFor(DIRT, [item('stone_pickaxe', 5)]).hand, true, 'a spent pickaxe is never "used up" on dirt')
  assert.deepEqual(usableTools(STONE, [item('stone_pickaxe', 1)]), [], 'the exit contract still honours HARD_STOP')
  assert.equal(usableTools(LOG, [item('stone_axe', 1)]).length, 0, 'usableTools is untouched (HARD_STOP for every kind)')
  assert.notEqual(travelTool(STONE, [item('stone_pickaxe', 1)], null)?.name, 'stone_pickaxe', 'never a 1-use pickaxe on a travel dig')
})

// ---- PART 2: a spent pickaxe is spent while a working one is held ----------------------------------------------------
await t('PART 2: on stone, a harvest dig swings the 1-use pickaxe when ANOTHER pickaxe with > FLOOR uses is held', () => {
  const spent = item('stone_pickaxe', 1), working = item('stone_pickaxe', 90)
  const r = toolFor(STONE, [working, spent], HARVEST)
  assert.equal(r.item, spent); assert.equal(r.reason, 'spend_spent')
  assert.equal(toolFor(STONE, [working, spent]).item, working, 'not on a travel or reflex dig (no lastSwing)')
  assert.equal(toolFor(blk('deepslate'), [item('iron_pickaxe', 200), item('wooden_pickaxe', 1)], HARVEST).item.name, 'wooden_pickaxe')
  assert.equal(spentPickaxeFor(STONE, [working, spent]), spent)
})

await t('PART 2 never fires otherwise: no working pickaxe above FLOOR, off the stone family, or only a 0-use phantom', () => {
  const spent = item('stone_pickaxe', 1)
  for (const left of [FLOOR, 5, 2]) {
    const other = item('stone_pickaxe', left)
    const r = toolFor(STONE, [other, spent], HARVEST)
    assert.equal(r.item, other, `with a ${left}-use other pickaxe the 1-use copy must not be chosen (${r.reason})`)
    assert.equal(spentPickaxeFor(STONE, [other, spent]), null)
  }
  const working = item('stone_pickaxe', 90)
  assert.equal(toolFor(COAL, [working, spent], HARVEST).item, working, 'coal ore buys no pickaxe')
  assert.equal(toolFor(IRON_ORE, [working, item('stone_pickaxe', 1)], HARVEST).item, working)
  assert.equal(toolFor(STONE, [working, item('stone_pickaxe', 0)], HARVEST).item, working, 'a 0-use copy is a phantom')
  assert.equal(toolFor(STONE, [spent, item('stone_pickaxe', 1)], HARVEST).reason, 'last_swing', 'all spent: the old last swing, unchanged')
  assert.equal(spentPickaxeFor(STONE, [item('stone_axe', 90), spent]), null, 'a working AXE is not a working pickaxe')
})

// ---- the equip check ------------------------------------------------------------------------------------------------
await t('EQUIP CHECK: name AND uses; a pickaxe mismatch is refused, an axe/shovel/hoe falls back to the hand where the hand harvests', () => {
  const pick = { name: 'stone_pickaxe', left: 1 }, axe = { name: 'stone_axe', left: 1 }
  assert.equal(spentEquipOutcome({ chosen: pick, held: item('stone_pickaxe', 1) }), 'swing')
  assert.equal(spentEquipOutcome({ chosen: pick, held: item('stone_pickaxe', 100) }), 'refuse', 'a same-name WORKING copy in hand is not the chosen one')
  assert.equal(spentEquipOutcome({ chosen: pick, held: null }), 'refuse')
  assert.equal(spentEquipOutcome({ chosen: axe, held: item('stone_axe', 100), handOk: true }), 'hand')
  assert.equal(spentEquipOutcome({ chosen: axe, held: null, handOk: true }), 'hand')
  assert.equal(spentEquipOutcome({ chosen: { name: 'stone_shovel', left: 1 }, held: null, handOk: false }), 'refuse', 'snow needs the shovel')
  assert.equal(spentEquipOutcome({ chosen: null, held: null }), 'swing')
})

// ---- liveness rows (pure) -------------------------------------------------------------------------------------------
await t('LIVENESS: tool_spent names a copy that reached 1 use BY USE (largest-first matching); tool_broke names an axe/shovel/hoe broken in use', () => {
  const at = (...lefts) => lefts.map(l => item('stone_axe', l))
  assert.deepEqual(spentTools(at(2), at(1)), [{ name: 'stone_axe', spent: 1, from: 2 }])
  assert.deepEqual(spentTools(at(1), at(1)), [], 'already spent: not again')
  assert.deepEqual(spentTools([], at(1)), [], 'picked up or crafted spent: not by use')
  assert.deepEqual(spentTools(at(5), at(4, 1)), [], '[5] -> [4, 1]: one copy used once, one picked up spent (both reviews)')
  assert.deepEqual(spentTools(at(1, 5), at(1, 1)), [{ name: 'stone_axe', spent: 1, from: 5 }])
  assert.deepEqual(spentTools(at(2, 5), at(1, 4)), [{ name: 'stone_axe', spent: 1, from: 2 }])
  for (const name of ['stone_axe', 'iron_shovel', 'wooden_hoe']) {
    const d = diffTools([item(name, 1)], [])
    assert.equal(d.length, 1); assert.equal(d[0].broke, true, `${name} breaking at 1 use is tool_broke`)
  }
})

// ---- THE REAL HARVEST DIG: chains through collectManually, rows read as EMITTED ------------------------------------
process.env.LOG_DIR = `/tmp/mcbot-test-logs-toolfor-spent-${process.pid}`; process.env.BOT_NAME = 'TestBot'
const { collectManually } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const rows = []
tapRecords(r => { if (/^_(last_swing|spent_swing)$/.test(r?.skill?.name ?? '')) rows.push(`${r.skill.name.slice(1)}:${r.skill.detail.match(/with a (\S+ at \d+)/)?.[1]}`) })
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)) })
// A server that wears the held tool one use per broken block and removes it at 0 -- AFTER deciding the drop, as vanilla
// does. Cells of `name` in a row beside the bot; each dig turns its cell to air. `equipTakes(it)` false = the server
// rejected that equip and the hand keeps what it had.
function chainBot (name, tools, { held = null, equipTakes = () => true } = {}) {
  const inv = [...tools]
  const world = new Map()
  for (let x = 1; x <= 8; x++) world.set(`${x},64,0`, name)
  const bot = {
    heldItem: held, swings: [], drops: [],
    entity: { position: V(0.5, 64, 0.5), onGround: true, velocity: V(0, 0, 0) },
    entities: {},
    inventory: { items: () => inv, emptySlotCount: () => 5 },
    canDigBlock: () => true,
    blockAt: p => { const n = world.get(`${p.x},${p.y},${p.z}`); return n ? blk(n, V(p.x, p.y, p.z)) : { name: 'air', boundingBox: 'empty', position: p } },
    equip: async it => { if (equipTakes(it)) bot.heldItem = inv.includes(it) ? it : null },
    unequip: async () => { bot.heldItem = null },
    dig: async b => {
      const h = bot.heldItem
      bot.swings.push(tag(h))
      bot.drops.push(b.canHarvest(h?.type ?? null) ? b.name : 'nothing')   // the drop is decided BEFORE the damage
      world.delete(`${b.position.x},${b.position.y},${b.position.z}`)
      if (h) { h.durabilityUsed++; if (remaining(h) <= 0) { inv.splice(inv.indexOf(h), 1); bot.heldItem = null } }
    },
    nearestEntity: () => null, pathfinder: { goto: async () => {}, setGoal () {}, stop () {} },
  }
  return { bot, inv }
}
const snap = inv => inv.map(it => ({ ...it }))
async function chain (name, tools, digs, opts) {
  const { bot, inv } = chainBot(name, tools, opts)
  const live = { spent: [], broke: [] }, errs = []
  rows.length = 0
  for (let x = 1; x <= digs; x++) {
    const before = snap(inv)
    try { await collectManually(bot, bot.blockAt(V(x, 64, 0)), new AbortController().signal, { deadline: Date.now() + 2000 }) } catch (e) { errs.push(e.failClass ?? e.message) }
    for (const d of spentTools(before, inv)) live.spent.push(`${d.name}<-${d.from}`)
    for (const d of diffTools(before, inv)) if (d.broke) live.broke.push(`${d.name}@${d.least}`)
  }
  return { bot, inv, live, errs, rows: [...rows] }
}

{
  const sh = await chain('dirt', [item('stone_shovel', 5)], 6)
  await t('CHAIN: a sole stone_shovel at 5 digs five dirt through collectManually and breaks IN USE on the fifth; the sixth is by hand', () => {
    assert.deepEqual(sh.bot.swings, ['stone_shovel@5', 'stone_shovel@4', 'stone_shovel@3', 'stone_shovel@2', 'stone_shovel@1', 'hand'])
    assert.deepEqual(sh.bot.drops, ['dirt', 'dirt', 'dirt', 'dirt', 'dirt', 'dirt'], 'every dig dropped its block, the breaking one included')
    assert.equal(sh.inv.length, 0, 'the slot is free')
    assert.deepEqual(sh.live.spent, ['stone_shovel<-2'], 'one tool_spent, when it reached 1 use')
    assert.deepEqual(sh.live.broke, ['stone_shovel@1'], 'one tool_broke, at its last use')
    assert.deepEqual(sh.rows, ['spent_swing:stone_shovel at 1'], 'the breaking swing is logged as spent_swing, never last_swing')
  })
  const ax = await chain('oak_planks', [item('wooden_axe', 5)], 6)
  await t('CHAIN: a sole wooden_axe at 5 (inside SLACK of the hand) is worn to broken across five digs', () => {
    assert.deepEqual(ax.bot.swings, ['wooden_axe@5', 'wooden_axe@4', 'wooden_axe@3', 'wooden_axe@2', 'wooden_axe@1', 'hand'])
    assert.equal(ax.inv.length, 0)
    assert.deepEqual(ax.live.spent, ['wooden_axe<-2']); assert.deepEqual(ax.live.broke, ['wooden_axe@1'])
    assert.deepEqual(ax.rows, ['spent_swing:wooden_axe at 1'])
  })
  const three = await chain('stone', [item('stone_pickaxe', 1), item('stone_pickaxe', 1), item('stone_pickaxe', 1), item('stone_pickaxe', 50)], 5)
  await t('CHAIN (Codex): three spent pickaxes are spent on stone while the >10-use backup is KEPT; then the backup digs', () => {
    assert.deepEqual(three.bot.swings, ['stone_pickaxe@1', 'stone_pickaxe@1', 'stone_pickaxe@1', 'stone_pickaxe@50', 'stone_pickaxe@49'])
    assert.deepEqual(three.bot.drops, ['stone', 'stone', 'stone', 'stone', 'stone'], 'each last use still mined its cobblestone (stone drops cobblestone)')
    assert.deepEqual(three.inv.map(tag), ['stone_pickaxe@48'], 'the backup survives with its uses')
    assert.deepEqual(three.rows, ['spent_swing:stone_pickaxe at 1', 'spent_swing:stone_pickaxe at 1', 'spent_swing:stone_pickaxe at 1'])
    assert.deepEqual(three.errs, [])
  })
  const last = await chain('stone', [item('stone_pickaxe', 1)], 1)
  await t('ROWS: a genuine last swing (every pickaxe spent) is still logged as last_swing', () => {
    assert.deepEqual(last.bot.swings, ['stone_pickaxe@1'])
    assert.deepEqual(last.rows, ['last_swing:stone_pickaxe at 1'])
  })
  const pk = await chain('stone', [item('stone_pickaxe', 5)], 3)
  await t('CHAIN control: a sole stone_pickaxe at 5 digs stone (the block needs it); no spent row', () => {
    assert.deepEqual(pk.bot.swings, ['stone_pickaxe@5', 'stone_pickaxe@4', 'stone_pickaxe@3'])
    assert.equal(pk.inv.length, 1); assert.deepEqual(pk.rows, [])
  })
  // REJECTED EQUIP with a healthy same-name copy already in hand (both reviews, reproduced)
  {
    const spent = item('stone_pickaxe', 1), healthy = item('stone_pickaxe', 100)
    const r = await chain('stone', [spent, healthy], 1, { held: healthy, equipTakes: it => it !== spent })
    await t('EQUIP REJECTED (pickaxe): the 100-use copy in hand is NOT used; equip_failed, nothing dug, no spent_swing row', () => {
      assert.deepEqual(r.bot.swings, [], `dug with ${r.bot.swings}`)
      assert.deepEqual(r.errs, ['equip_failed'])
      assert.equal(remaining(healthy), 100); assert.deepEqual(r.rows, [])
    })
  }
  {
    const spent = item('stone_axe', 1), healthy = item('stone_axe', 100)
    const r = await chain('oak_planks', [spent, healthy], 1, { held: healthy, equipTakes: it => it !== spent })
    await t('EQUIP REJECTED (axe): falls back to the HAND -- the 100-use axe is taken out and not worn; no equip_failed, no spent_swing', () => {
      assert.deepEqual(r.bot.swings, ['hand'])
      assert.deepEqual(r.errs, [])
      assert.equal(remaining(healthy), 100); assert.equal(remaining(spent), 1); assert.deepEqual(r.rows, [])
    })
  }
}

// ---- PART 3: diagnosis strings (logging only) ---------------------------------------------------------------------
await t('PART 3: wear_out\'s refusal tally names each guard, most first; the late look reports what the slot SHOWS', () => {
  assert.equal(wearRefusals({ not_natural: 9, room_liquid: 2, occupied: 1, footprint: 0 }, 12), '12 cells: not_natural 9, room_liquid 2, occupied 1')
  assert.equal(wearRefusals({}, 0), '0 cells: none refused')
  assert.equal(slotObservation({ slotKnown: true, item: null, name: 'stone_axe' }), 'slot_empty')
  assert.equal(slotObservation({ slotKnown: true, item: item('stone_axe', 1), name: 'stone_axe' }), 'same_name_at_one_use')
  assert.equal(slotObservation({ slotKnown: true, item: item('dirt', 1), name: 'stone_axe' }), 'slot_changed')
  assert.equal(slotObservation({ slotKnown: false, item: null, name: 'stone_axe' }), 'unknown')
  assert.equal(slotObservation({ slotKnown: true, item: null, name: 'stone_axe', alive: false }), 'unknown', 'a dead or ended bot\'s empty slot says nothing')
})

// ---- MUTANTS: each must turn a test above red. Anchors asserted present and unique; the mutant is a temp copy. -------
const TOOLFOR = new URL('../src/toolfor.mjs', import.meta.url)
async function withMutant (edits, fn) {
  let src = readFileSync(TOOLFOR, 'utf8')
  for (const [old, neu] of edits) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} -- a mutant never written reads as killed`)
    assert.equal(src.split(old).length, 2, `the mutation anchor is not unique: ${JSON.stringify(old.slice(0, 60))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (label, edits, probe) => t(`MUTANT KILLED: ${label}`, () => withMutant(edits, async m => {
  let survived = true
  try { probe(m) } catch { survived = false }
  assert.equal(survived, false, 'the mutant passed the probe: the test above cannot see this defect')
}))
await killed('the FLOOR reserve restored for axes/shovels/hoes',
  [['const open = timed.filter(x => x.r > FLOOR || (x.spend && x.t < handT)).sort(byCost)', 'const open = timed.filter(x => x.r > FLOOR).sort(byCost)']],
  m => { assert.equal(m.toolFor(LOG, [item('stone_axe', 5)]).item?.name, 'stone_axe') })
await killed('a spent axe/shovel/hoe admitted to `open` where it is no faster than the hand (the `slow` branch)',
  [['const open = timed.filter(x => x.r > FLOOR || (x.spend && x.t < handT)).sort(byCost)', 'const open = timed.filter(x => x.r > FLOOR || x.spend).sort(byCost)']],
  m => { assert.equal(m.toolFor(ICE, [item('stone_pickaxe', 5), item('stone_shovel', 3)]).hand, true) })
await killed('the wear comparator reversed for every kind',
  [['const d = (a.tier - b.tier) || (b.r - a.r)', 'const d = (a.tier - b.tier) || (a.r - b.r)']],
  m => { assert.equal(remaining(m.toolFor(STONE, [item('stone_pickaxe', 20), item('stone_pickaxe', 90)]).item), 90) })
await killed('the comparator CYCLE restored (wear reversed within a name inside the sort, no same-name swap)',
  [['const d = (a.tier - b.tier) || (b.r - a.r)', 'const d = (a.tier - b.tier) || (a.name === b.name && a.spend ? a.r - b.r : b.r - a.r)'],
   ['const pick = (x, pool) => (x.spend ? mostWornOfName(x, pool) : x).it', 'const pick = x => x.it']],
  m => {
    for (const p of perms([item('stone_axe', 90), item('stone_pickaxe', 50), item('stone_axe', 3)])) assert.equal(tag(m.toolFor(LOG, p).item), 'stone_axe@3', p.map(tag).join(','))
  })
await killed('part 2 without the working-pickaxe (> FLOOR) check',
  [['  if (!picks.some(it => remaining(it) > FLOOR)) return null\n', '']],
  m => { const other = item('stone_pickaxe', 5); assert.equal(m.toolFor(STONE, [other, item('stone_pickaxe', 1)], HARVEST).item, other) })
await killed('hard stop 0 applied to pickaxes too',
  [['export const hardStopFor = (it, { lastSwing = false } = {}) => (lastSwing && isConsumable(it?.name) ? 0 : HARD_STOP)', 'export const hardStopFor = () => 0']],
  m => { assert.equal(m.toolFor(STONE, [item('stone_pickaxe', 1)]).reason, 'none') })
await killed('hard stop 0 on travel digs (lastSwing ignored)',
  [['export const hardStopFor = (it, { lastSwing = false } = {}) => (lastSwing && isConsumable(it?.name) ? 0 : HARD_STOP)', 'export const hardStopFor = it => (isConsumable(it?.name) ? 0 : HARD_STOP)']],
  m => { assert.equal(m.travelTool(DIRT, [item('stone_shovel', 1)], null), null) })
await killed('the equip check by NAME only',
  [['if (held && held.name === chosen.name && remaining(held) === chosen.left) return \'swing\'', 'if (held && held.name === chosen.name) return \'swing\'']],
  m => { assert.equal(m.spentEquipOutcome({ chosen: { name: 'stone_pickaxe', left: 1 }, held: item('stone_pickaxe', 100) }), 'refuse') })

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
