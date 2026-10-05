// CLIMB FLOOD (climbflood-01): THE ESCAPE CLIMB MUST NOT DIG ITSELF INTO A SEALED POCKET.
//
// MEASURED 2026-10-05 (docs/reports/underground-safety-design-2026-10-05.md): every drowning in 72 h (109) was a
// sealed pocket, and the largest single way in -- 30 deaths, 28% of drownings -- was the bot's own escape climb
// breaking the block over its head with no water check. Four upward-dig paths did it: `pillarOut`'s head dig,
// `digStraightUp` (which pillarOut falls into), the escape ramp's ceiling breach and step digs, and the skill climb
// `shaftAscend`, whose guard read the block and its sides but not the cell ABOVE it.
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: decisions extracted and driven, never matched as text):
//   A. the one predicate, cell by cell, with positive controls that a dry ceiling is still dug;
//   B. each of the four paths refuses water/lava above the block AND above that (the gravel case), digging nothing,
//      and digs a dry ceiling (the positive control for every refusal);
//   C. the refusal CHAIN end to end on the measured geometry: pillar refuses -> the ramp refuses the same cell ->
//      no prerequisite, a growing back-off, the bot dry and where it was, over repeated firings;
//   D. the wiring of both handlers (a structural source assertion, comments stripped, each seen to fail by a mutant);
//   E. anchored mutants (present AND unique, `withMutant`) for every decision line.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { overheadBreakRisk, isWaterCell, isLavaCell, headroomBreach, stairUpStep, floodSidestep,
         chooseFloodSidestep } from '../src/scaffold.mjs'
import { pillarOut, digStraightUp, escapeStairUp, upwardDigFloodRisk, refusalEscalation,
         climbNeedAbove, floodBranch, ceilingFloodRisk, shaftCapNeedsTool } from '../src/reflex.mjs'
import { FLOOD_RISK, FLOOD_REMEDY, climbOutcomeRoute, floodChainStep, watchClimbDig } from '../src/climbflood.mjs'
import { tapRecords } from '../src/logger.mjs'
import { shaftAscend } from '../src/skills.mjs'
const require_ = createRequire(import.meta.url)

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const SCAFFOLD_PATH = new URL('../src/scaffold.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)
const CLIMBFLOOD_PATH = new URL('../src/climbflood.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

// VERBATIM from escape-stair.test.mjs: a separate module, never src/ in place, and the anchor must be present AND
// unique -- a mutant that silently fails to apply reads as killed.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

/** Several anchored replacements in one mutant module; every anchor present AND unique, applied in order. */
async function withMutants (path, pairs, fn) {
  let src = readFileSync(path, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- terrain ---------------------------------------------------------------------------------------------------

const DIG_MS = { stone: 7500, cobblestone: 10_000, deepslate: 15_000, dirt: 750, gravel: 3000, sand: 2500 }
const BARE_HANDED = /^(dirt|sand|gravel)$/
const WATERLOGGED = { oak_stairs_wl: 'oak_stairs' }
function blk (name, pos) {
  if (name === null) return null                      // an unloaded chunk
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (/^(water|lava|flowing_lava|flowing_water|bubble_column|kelp)$/.test(name)) return { name, boundingBox: 'empty', position: pos }
  if (name === 'bedrock') return { name, boundingBox: 'block', position: pos, diggable: false, digTime: () => null }
  if (WATERLOGGED[name]) {
    return { name: WATERLOGGED[name], boundingBox: 'block', isWaterlogged: true, position: pos, diggable: true,
             digTime: () => 3000, canHarvest: () => true }
  }
  return { name, boundingBox: 'block', position: pos, diggable: true,
           digTime: () => DIG_MS[name] ?? 7500,
           canHarvest: type => (BARE_HANDED.test(name) ? true : type === 101) }
}
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), clone: () => V(x, y, z),
                          floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
function world (cells = {}, { fill = 'stone' } = {}) {
  const m = new Map(Object.entries(cells))
  return {
    get (x, y, z) { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : fill },
    set (x, y, z, name) { m.set(`${x},${y},${z}`, name) },
  }
}
/** `at` relative to the BLOCK TO BE BROKEN, from a world keyed on the bot's feet, for the pure predicate. */
const atCell = (w, cx, cy, cz) => (x, y, z) => blk(w.get(cx + x, cy + y, cz + z), V(cx + x, cy + y, cz + z))
const atFeet = w => (x, y, z) => blk(w.get(x, y, z), V(x, y, z))

/** The design's fixture (sandbox/fixtures/synthetic-entombed.json in shape): a 1x1 stone cell, ceiling at feet+2. */
const TOMB = (extra = {}) => world({ '0,0,0': 'air', '0,1,0': 'air', ...extra })
const WET_POCKET = { '0,3,0': 'water', '1,3,0': 'water', '0,4,0': 'water', '1,4,0': 'water',
                     '0,3,1': 'water', '1,3,1': 'water', '0,4,1': 'water', '1,4,1': 'water' }   // scene A: 2x2x2 above
const WET_ALL = {}                                                                              // scene C: 3x3x2 above
for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) for (const y of [3, 4]) WET_ALL[`${x},${y},${z}`] = 'water'
const rows = []
tapRecords(r => { if (/^_climb_flood_/.test(r?.skill?.name ?? '')) rows.push(r.skill) })

const Y0 = 40
const COBBLE = n => ({ name: 'cobblestone', count: n, type: 1 })
const PICK = (left = 100) => ({ name: 'stone_pickaxe', count: 1, type: 101, maxDurability: 131, durabilityUsed: 131 - left })
const BUCKET = { name: 'bucket', count: 1, type: 900 }

/** A bot that digs, pillars (a placed block lifts it one), and walks a ramp step when the geometry allows. */
function makeBot (w, { y = Y0, inv = [], held = null, canPath = false, onDig = null, onHand = null } = {}) {
  const digs = [], placed = []
  let yaw = 0
  const rel = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) - y, z: Math.floor(p.z) })
  const bot = {
    digs, placed, world: w, pendingPrereq: undefined,
    entity: { position: V(0, y, 0), get yaw () { return yaw }, onGround: true, isInWater: false },
    health: 20,
    heldItem: held,
    inventory: { items: () => inv.filter(i => i.count > 0), emptySlotCount: () => 36 - inv.length },
    blockAt (p) { const r = rel(p); return blk(w.get(r.x, r.y, r.z), V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) },
    async unequip () { bot.heldItem = null; onHand?.(w) },
    async equip (item) { bot.heldItem = item; onHand?.(w) },
    async dig (b) {
      const r = rel(b.position)
      digs.push({ cell: `${r.x},${r.y},${r.z}`, name: b.name, held: bot.heldItem?.name ?? null })
      w.set(r.x, r.y, r.z, 'air')
      onDig?.(`${r.x},${r.y},${r.z}`, w)
    },
    async placeBlock (below, face) {
      const r = rel(below.position ?? below)
      const it = inv.find(i => i.name === bot.heldItem?.name && i.count > 0)
      if (!it) throw new Error('nothing to place')
      it.count--
      w.set(r.x, r.y + 1, r.z, it.name)
      placed.push(`${r.x},${r.y + 1},${r.z}`)
      const p = bot.entity.position
      bot.entity.position = V(p.x, p.y + 1, p.z)
    },
    stopDigging () {}, clearControlStates () {},
    async look (a) { yaw = a }, async lookAt () {},
    setControlState (name, on) {
      if (name !== 'forward' || !on) return
      const bear = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4]
      const p = rel(bot.entity.position)
      const at = (dx, dy, dz) => blk(w.get(p.x + dx, p.y + dy, p.z + dz), null)
      const clear = b => b && b.boundingBox === 'empty'
      const q = bot.entity.position
      // a LEVEL step (the flood sidestep: tread below, feet and head clear) or a step UP (the ramp)
      if (at(bear.x, -1, bear.z)?.boundingBox === 'block' && clear(at(bear.x, 0, bear.z)) && clear(at(bear.x, 1, bear.z))) {
        bot.entity.position = V(q.x + bear.x, q.y, q.z + bear.z); return
      }
      if (at(bear.x, 0, bear.z)?.boundingBox !== 'block' || !clear(at(bear.x, 1, bear.z)) || !clear(at(bear.x, 2, bear.z))) return
      bot.entity.position = V(q.x + bear.x, q.y + 1, q.z + bear.z)
    },
    pathfinder: { thinkTimeout: 1000, setGoal () {}, stop () {},
                  getPathTo () { return canPath ? { path: [1, 2, 3] } : { path: [] } } },
  }
  return bot
}
const wetCells = (bot, w) => {
  const p = bot.entity.position
  return [0, 1].map(dy => w.get(Math.floor(p.x), Math.floor(p.y) - Y0 + dy, Math.floor(p.z))).filter(n => /water|lava/.test(n))
}

// ================================================================================================================
// A. THE PREDICATE, CELL BY CELL. `at` is relative to the block to be broken.
// ================================================================================================================

await t('POSITIVE CONTROL: a dry stone ceiling under dry stone may be broken', () => {
  assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB(), 0, 2, 0) }), null)
})

await t('NOTHING TO BREAK, NOTHING TO FLOOD: an air cell is never refused, whatever surrounds it', () => {
  const w = TOMB({ '0,2,0': 'air', '0,3,0': 'water', '1,2,0': 'water' })
  assert.strictEqual(overheadBreakRisk({ at: atCell(w, 0, 2, 0) }), null,
    'refusing a step that breaks nothing is the 99.1% (561 of 566 pillar attempts frozen)')
})

await t('THE NEW CELL: water ABOVE the block (feet+3) refuses -- the face the old guard never read', () => {
  const r = overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'water' }), 0, 2, 0) })
  assert.match(String(r), /liquid above the block overhead \(water\)/)
})

await t('each of the four sides refuses water and lava', () => {
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const liq of ['water', 'lava']) {
      const r = overheadBreakRisk({ at: atCell(TOMB({ [`${x},2,${z}`]: liq }), 0, 2, 0) })
      assert.match(String(r), new RegExp(`liquid beside the block overhead \\(${liq}\\)`), `${liq} at ${x},${z}`)
    }
  }
})

await t('LAVA, ONE CLASSIFIER: lava, flowing_lava, and lava above all refuse', () => {
  for (const name of ['lava', 'flowing_lava']) {
    assert.ok(isLavaCell({ name }), name)
    assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': name }), 0, 2, 0) })), /liquid above/, name)
    assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,2,0': name }), 0, 2, 0) })), /liquid overhead/, name)
  }
})

await t('WATER IN EVERY FORM: flowing, bubble column, kelp, and a WATERLOGGED block refuse', () => {
  for (const name of ['flowing_water', 'bubble_column', 'kelp', 'oak_stairs_wl']) {
    assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': name }), 0, 2, 0) })), /liquid above/, name)
  }
  // the TARGET waterlogged: breaking it releases the source it holds
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,2,0': 'oak_stairs_wl' }), 0, 2, 0) })), /liquid overhead/)
})

await t('A WATERLOGGED BLOCK IS STILL A BLOCK: submerged, it is broken only if its neighbours pass (Codex r1)', () => {
  const at = atCell(TOMB({ '0,2,0': 'oak_stairs_wl', '1,2,0': 'lava' }), 0, 2, 0)
  assert.match(String(overheadBreakRisk({ at, submerged: true })), /lava/, 'lava beside a waterlogged target slipped through')
  const at2 = atCell(TOMB({ '0,2,0': 'oak_stairs_wl', '0,3,0': null }), 0, 2, 0)
  assert.match(String(overheadBreakRisk({ at: at2, submerged: true })), /not loaded/)
  assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB({ '0,2,0': 'oak_stairs_wl' }), 0, 2, 0), submerged: true }), null,
    'POSITIVE CONTROL: a submerged bot may still break a waterlogged block with dry neighbours')
})

await t('POSITIVE CONTROL ON THE REAL REGISTRY: prismarine-block\'s waterlogged state is what isWaterCell reads', () => {
  const registry = require_('prismarine-registry')('1.21.8')
  const Block = require_('prismarine-block')(registry)
  const st = { facing: 'north', half: 'bottom', shape: 'straight' }
  assert.strictEqual(isWaterCell(Block.fromProperties('oak_stairs', { ...st, waterlogged: true }, 0)), true)
  assert.strictEqual(isWaterCell(Block.fromProperties('oak_stairs', { ...st, waterlogged: false }, 0)), false)
  assert.strictEqual(isWaterCell(Block.fromProperties('stone', {}, 0)), false)
  assert.strictEqual(isWaterCell(Block.fromProperties('water', { level: 3 }, 0)), true)
  assert.strictEqual(isLavaCell(Block.fromProperties('lava', { level: 3 }, 0)), true,
    'flowing lava on 1.21 is `lava` with a level, and it must classify as lava')
})

await t('UNKNOWN IS A REFUSAL: an unloaded target, cell above, or side is never read as dry', () => {
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,2,0': null }), 0, 2, 0) })), /not loaded at the block/)
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': null }), 0, 2, 0) })), /not loaded above/)
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '1,2,0': null }), 0, 2, 0) })), /not loaded beside/)
})

await t('FALLING BLOCKS: gravel above the ceiling with water above the gravel refuses (scene G)', () => {
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'gravel', '0,4,0': 'water' }), 0, 2, 0) })),
    /liquid over the falling block above the block overhead \(water\)/)
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'sand', '1,4,0': 'water' }), 0, 2, 0) })),
    /over the falling block above/, 'and beside the cell the column opens')
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'gravel', '1,3,0': 'water' }), 0, 2, 0) })),
    /beside the falling block above/, 'the cell the gravel leaves is a face of the shaft too')
})

await t('POSITIVE CONTROL: feet+4 is read ONLY through a falling block, so stone above keeps the old answer', () => {
  assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB({ '0,4,0': 'water' }), 0, 2, 0) }), null,
    'stone above holds whatever is over it; refusing here would be a wider predicate than the design')
  assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'gravel' }), 0, 2, 0) }), null,
    'gravel over a dry column is not a flood')
})

await t('THE SUBMERGED EXEMPTION, FOR WATER ONLY (scene D)', () => {
  const w = TOMB({ '0,3,0': 'water', '1,2,0': 'water' })
  assert.strictEqual(overheadBreakRisk({ at: atCell(w, 0, 2, 0), submerged: true }), null,
    'a bot already under water may still dig toward air')
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'lava' }), 0, 2, 0), submerged: true })), /lava/,
    'lava refuses, submerged or not')
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': null }), 0, 2, 0), submerged: true })), /not loaded/,
    'and unknown is still unknown')
})

// ================================================================================================================
// B. EVERY UPWARD-DIG PATH, ON A WORLD: refuses wet, digs dry.
// ================================================================================================================

await t('PATH 1 pillarOut: water above the ceiling -> flood_risk, nothing dug, nothing placed', async () => {
  const w = TOMB({ '0,3,0': 'water' })
  const bot = makeBot(w, { inv: [COBBLE(64), PICK(), BUCKET] })
  const out = await pillarOut(bot, 3)
  assert.strictEqual(out, FLOOD_RISK)
  assert.deepStrictEqual(bot.digs, [], 'IT BROKE THE BLOCK UNDER THE WATER')
  assert.deepStrictEqual(bot.placed, [])
  assert.strictEqual(w.get(0, 2, 0), 'stone')
})

await t('PATH 1 pillarOut POSITIVE CONTROL: the same climb under a dry ceiling digs it first', async () => {
  const bot = makeBot(TOMB(), { inv: [COBBLE(64), PICK(), BUCKET] })
  const out = await pillarOut(bot, 3)
  assert.notStrictEqual(out, FLOOD_RISK)
  assert.ok(bot.digs.length > 0 && bot.digs[0].cell === '0,2,0', `expected the ceiling first, got ${JSON.stringify(bot.digs)}`)
  assert.ok(bot.placed.length > 0, 'and it climbed')
})

await t('PATH 1 pillarOut IN-LOOP: a climb that REACHES a wet ceiling stops there (the marooned shape)', async () => {
  // Head open at the start, so the pre-check has nothing to ask; the loop pillars two blocks and meets stone with
  // water above it. Only the in-loop check can stop this one.
  const w = TOMB({ '0,2,0': 'air', '0,3,0': 'air', '0,5,0': 'water' })
  const bot = makeBot(w, { inv: [COBBLE(64), PICK()] })
  const out = await pillarOut(bot, 6)
  assert.strictEqual(out, FLOOD_RISK)
  assert.strictEqual(bot.placed.length, 2, `expected two placements before the ceiling, got ${bot.placed}`)
  assert.deepStrictEqual(bot.digs, [], 'it broke the block under the water')
  assert.strictEqual(w.get(0, 4, 0), 'stone')
})

await t('A WET CEILING IS NOT A SHORTAGE: too few blocks under water -> flood_risk, not needs_blocks', async () => {
  const wet = makeBot(TOMB({ '0,3,0': 'water' }), { inv: [COBBLE(2)] })
  assert.strictEqual(await pillarOut(wet, 24), FLOOD_RISK,
    'asking for 26 blocks sends the bot for a remedy that cannot help')
  const dry = makeBot(TOMB(), { inv: [COBBLE(2)] })
  assert.strictEqual(await pillarOut(dry, 24), 'needs_blocks', 'POSITIVE CONTROL: dry, the block count still decides')
})

await t('PATH 2 digStraightUp: a wet ceiling -> flood_risk BEFORE the last-pickaxe refusal', async () => {
  const wet = makeBot(TOMB({ '0,3,0': 'water' }), { inv: [PICK()] })
  assert.strictEqual(await digStraightUp(wet, Y0, 2), FLOOD_RISK,
    'a second pickaxe cannot make this dig safe, so "needs_pickaxe" is the wrong remedy')
  assert.deepStrictEqual(wet.digs, [])
  const dryOne = makeBot(TOMB(), { inv: [PICK()] })
  assert.strictEqual(await digStraightUp(dryOne, Y0, 2), 'needs_pickaxe', 'POSITIVE CONTROL: dry, the pickaxe rule still decides')
})

await t('PATH 2 digStraightUp: refuses mid-climb at a wet ceiling, digs a dry one (positive control)', async () => {
  const w = TOMB({ '0,2,0': 'air', '0,4,0': 'water' })
  const bot = makeBot(w, { inv: [PICK(), PICK(), COBBLE(10)] })
  assert.strictEqual(await digStraightUp(bot, Y0, 4), FLOOD_RISK)
  assert.deepStrictEqual(bot.digs, [], 'it broke the block under the water')
  const dry = makeBot(TOMB(), { inv: [PICK(), PICK(), COBBLE(10)] })
  await digStraightUp(dry, Y0, 1)
  assert.deepStrictEqual(dry.digs.map(d => d.cell), ['0,2,0'])
})

await t('PATH 3a the ramp never re-breaches the refused ceiling; scene A: it steps sideways and climbs from a dry column', async () => {
  const w = TOMB(WET_POCKET)
  const bot = makeBot(w)
  const r = await escapeStairUp(bot, { maxSteps: 3, budgetMs: 30_000 })
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'), 'the ramp re-breached the cell the pillar refused')
  assert.strictEqual(r.sidestepped, 1, `no sidestep: ${r.stopped}`)
  assert.strictEqual(r.flood, null)
  assert.ok(r.steps > 0, `the ramp did not climb from the side column: ${r.stopped}`)
  for (const d of bot.digs) {
    const [x, y, z] = d.cell.split(',').map(Number)
    assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB(WET_POCKET), x, y, z) }), null, `it dug ${d.cell}, which the check refuses`)
  }
  assert.deepStrictEqual(wetCells(bot, w), [])
})

await t('SCENE C: every side column under water too -> no sidestep, nothing dug, refused as ramp_breach', async () => {
  const w = TOMB(WET_ALL)
  const bot = makeBot(w)
  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 20_000 })
  assert.strictEqual(r.steps, 0)
  assert.strictEqual(r.sidestepped, 0)
  assert.strictEqual(r.flood, 'ramp_breach')
  assert.match(r.stopped, /no dry side column/)
  assert.deepStrictEqual(bot.digs, [])
  const dry = makeBot(TOMB())
  const rd = await escapeStairUp(dry, { maxSteps: 4, budgetMs: 20_000 })
  assert.strictEqual(rd.breached, 1, `POSITIVE CONTROL: a dry tomb's ceiling is breached (${rd.stopped})`)
  assert.strictEqual(rd.sidestepped, 0, 'a dry ceiling must not provoke a sidestep')
})

await t('SCENE B: water beside the ceiling -> the sidestep avoids the wet side and the bot climbs', async () => {
  const w = TOMB({ '1,2,0': 'water' })
  const bot = makeBot(w)
  const r = await escapeStairUp(bot, { maxSteps: 2, budgetMs: 30_000 })
  assert.strictEqual(r.sidestepped, 1, r.stopped)
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0' || d.cell === '1,1,0' || d.cell === '1,0,0'), JSON.stringify(bot.digs))
  assert.ok(r.steps > 0, r.stopped)
})

await t('THE SIDESTEP, PURE: tread, dry cells, no lava face, a dry column above -- or no step', () => {
  const E = { x: 1, z: 0 }
  assert.deepStrictEqual(floodSidestep({ at: atFeet(TOMB()), bear: E }), { ok: true, dig: [[1, 1, 0], [1, 0, 0]] }, 'top first')
  assert.match(floodSidestep({ at: atFeet(TOMB({ '1,-1,0': 'air' })), bear: E }).reason, /no dry floor/)
  assert.match(floodSidestep({ at: atFeet(TOMB({ '1,-1,0': 'water' })), bear: E }).reason, /no dry floor/)
  assert.match(floodSidestep({ at: atFeet(TOMB({ '1,0,0': 'air', '1,1,0': 'water' })), bear: E }).reason, /water in the head/)
  assert.match(floodSidestep({ at: atFeet(TOMB({ '2,0,0': 'lava' })), bear: E }).reason, /lava against/)
  assert.match(floodSidestep({ at: atFeet(TOMB({ '1,3,0': 'water' })), bear: E }).reason, /side column floods/)
  assert.match(floodSidestep({ at: atFeet(TOMB({ '2,1,0': 'water' })), bear: E }).reason, /flood risk in the head/)
  assert.strictEqual(floodSidestep({ at: atFeet(TOMB({ '1,2,0': 'bedrock' })), bear: E, canBreak: b => b.name !== 'bedrock' }).ok, false)
  const c = chooseFloodSidestep({ at: atFeet(TOMB(WET_ALL)), bearings: [E, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }] })
  assert.strictEqual(c.ok, false); assert.strictEqual(c.flood, true)
})

await t('EVERY ACTUAL DIG IS RE-CHECKED: water arriving after the plan stops the next dig of the step (Codex r1)', async () => {
  // Headroom open, the step east planned dry: (1,3,0) then (1,2,0) then (1,1,0). The moment (1,3,0) is dug, water
  // appears in it (from somewhere the plan could not see). The next dig, (1,2,0), now has water above it.
  const cells = { '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air' }
  for (const [x, z] of [[-1, 0], [0, 1], [0, -1]]) { cells[`${x},1,${z}`] = 'bedrock'; cells[`${x},2,${z}`] = 'bedrock' }
  const w = world(cells)
  const bot = makeBot(w, { onDig: (cell, ww) => { if (cell === '1,3,0') ww.set(1, 3, 0, 'water') } })
  const r = await escapeStairUp(bot, { maxSteps: 1, budgetMs: 20_000 })
  assert.deepStrictEqual(bot.digs.map(d => d.cell), ['1,3,0'], 'it kept digging under the new water')
  assert.strictEqual(r.flood, 'ramp_step')
  assert.match(r.stopped, /flood risk/)
})

await t('PATH 3a the ramp, gravel over water (scene G): the settle dig is refused too, and the bot leaves sideways', async () => {
  const bot = makeBot(TOMB({ '0,3,0': 'gravel', '0,4,0': 'water' }))
  const r = await escapeStairUp(bot, { maxSteps: 2, budgetMs: 30_000 })
  assert.ok(!bot.digs.some(d => d.cell === '0,3,0' || d.cell === '0,2,0'), `it dug the gravel or its ceiling: ${JSON.stringify(bot.digs)}`)
  assert.strictEqual(r.sidestepped, 1, r.stopped)
  const dry = makeBot(TOMB({ '0,3,0': 'gravel' }))
  await escapeStairUp(dry, { maxSteps: 1, budgetMs: 20_000 })
  assert.strictEqual(dry.digs[0]?.cell, '0,3,0', 'POSITIVE CONTROL: dry gravel is still taken first, top down')
})

await t('PATH 3b the ramp\'s STEP digs: every bearing wet -> refused as ramp_step, nothing dug', async () => {
  // Headroom already open; each cardinal's jump clearance is stone with water above it.
  const cells = { '0,2,0': 'air', '0,3,0': 'air' }
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cells[`${x},4,${z}`] = 'water'
  const bot = makeBot(world({ '0,0,0': 'air', '0,1,0': 'air', ...cells }))
  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 20_000 })
  assert.strictEqual(r.steps, 0)
  assert.strictEqual(r.flood, 'ramp_step')
  assert.match(r.stopped, /flood risk/)
  assert.deepStrictEqual(bot.digs, [])
})

await t('PATH 3b POSITIVE CONTROL: one dry bearing among wet ones is taken, and only it is dug', async () => {
  const cells = { '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air' }
  for (const [x, z] of [[-1, 0], [0, 1], [0, -1]]) cells[`${x},4,${z}`] = 'water'
  const bot = makeBot(world(cells))
  const r = await escapeStairUp(bot, { maxSteps: 1, budgetMs: 20_000 })
  assert.strictEqual(r.steps, 1, r.stopped)
  assert.deepStrictEqual(r.bearing, { x: 1, z: 0 }, 'the dry bearing (east) must be the one taken')
  assert.ok(bot.digs.every(d => d.cell.startsWith('1,')), JSON.stringify(bot.digs))
})

const SHAFT = (extra = {}) => world({ '0,0,0': 'air', '0,1,0': 'air', ...extra })
function shaftBot (w) {
  const bot = makeBot(w, { inv: [COBBLE(24)] })
  bot.registry = require_('prismarine-registry')('1.21.8')
  bot.health = 20; bot.food = 20
  return bot
}
await t('PATH 4 shaftAscend: water above the ceiling (the face the old guard skipped) refuses, digs nothing', async () => {
  const bot = shaftBot(SHAFT({ '0,3,0': 'water' }))
  const r = await shaftAscend(bot, Y0 + 20, new AbortController().signal, { deadline: Date.now() + 6000 })
  assert.match(String(r.stopped), /liquid above the block overhead \(water\)/)
  assert.deepStrictEqual(bot.digs, [], 'the skill climb broke into the bottom of the pocket')
})

await t('PATH 4 shaftAscend POSITIVE CONTROL: a dry ceiling is dug', async () => {
  const bot = shaftBot(SHAFT())
  await shaftAscend(bot, Y0 + 1, new AbortController().signal, { deadline: Date.now() + 6000 })
  assert.strictEqual(bot.digs[0]?.cell, '0,2,0', JSON.stringify(bot.digs))
})

await t('SCENE D: a SUBMERGED bot still digs up through its ceiling (pillarOut)', async () => {
  const w = TOMB({ '0,0,0': 'water', '0,1,0': 'water', '1,2,0': 'water' })
  const bot = makeBot(w, { inv: [COBBLE(64), PICK()] })
  const out = await pillarOut(bot, 3)
  assert.notStrictEqual(out, FLOOD_RISK, 'the exemption is gone: a flooded bot cannot dig toward air')
  assert.strictEqual(bot.digs[0]?.cell, '0,2,0')
})

await t('SCENE E: lava above refuses on every path, submerged or not', async () => {
  for (const wet of [false, true]) {
    const base = wet ? { '0,0,0': 'water', '0,1,0': 'water' } : {}
    const a = makeBot(TOMB({ ...base, '0,3,0': 'lava' }), { inv: [COBBLE(64), PICK(), PICK()] })
    assert.strictEqual(await pillarOut(a, 3), FLOOD_RISK)
    const b = makeBot(TOMB({ ...base, '0,3,0': 'lava' }), { inv: [PICK(), PICK()] })
    assert.strictEqual(await digStraightUp(b, Y0, 2), FLOOD_RISK)
    for (const x of [a, b]) assert.deepStrictEqual(x.digs, [], `submerged=${wet}: something dug under lava`)
    const c = makeBot(TOMB({ ...base, '0,3,0': 'lava' }))
    await escapeStairUp(c, { maxSteps: 2, budgetMs: 20_000 })
    assert.ok(!c.digs.some(d => d.cell === '0,2,0'), `submerged=${wet}: the ramp broke the block under the lava`)
  }
})

await t('upwardDigFloodRisk names its caller in the guard decision it returns', () => {
  const bot = makeBot(TOMB({ '0,3,0': 'water' }))
  assert.match(String(upwardDigFloodRisk(bot, 'pillar_out')), /liquid above/)
  assert.strictEqual(upwardDigFloodRisk(makeBot(TOMB()), 'pillar_out'), null)
})

// ================================================================================================================
// C. THE CHAIN, NOT THE GUARD.
// ================================================================================================================

await t('ROUTE: a flood refusal has its own branch -- never the failure counter, never a material refusal', () => {
  assert.strictEqual(climbOutcomeRoute(FLOOD_RISK), 'flood')
  assert.strictEqual(climbOutcomeRoute('needs_blocks'), 'refusal')
  assert.strictEqual(climbOutcomeRoute('needs_pickaxe'), 'refusal')
  assert.strictEqual(climbOutcomeRoute('preempted'), 'preempted')
  for (const o of [undefined, null, 'exhausted', 'threw']) assert.strictEqual(climbOutcomeRoute(o), 'attempt', String(o))
})

await t('THE BRANCH NEVER ASKS FOR A PREREQUISITE, and backs off on the EXISTING curve without spinning', () => {
  let prev = 0
  for (let n = 1; n <= 60; n++) {
    const s = floodChainStep({ refusals: n, stair: { steps: 0 } })
    assert.strictEqual(s.prereq, null, `refusal ${n} asked for something`)
    assert.strictEqual(s.refused, true)
    assert.strictEqual(s.remedy, FLOOD_REMEDY)
    assert.ok(s.backoffMs >= prev, `the back-off fell at refusal ${n}`)
    assert.ok(s.backoffMs > 0 && s.backoffMs <= 10 * 60_000)
    assert.strictEqual(s.backoffMs, refusalEscalation({ refusals: n }).backoffMs,
      'not the same curve the material refusals use')
    prev = s.backoffMs
  }
  const ok = floodChainStep({ refusals: 7, stair: { steps: 2 } })
  assert.deepStrictEqual([ok.progressed, ok.refused, ok.backoffMs, ok.prereq], [true, false, 0, null],
    'a ramp that cut a step is progress: no row, no back-off')
})

await t('THE REMEDY IS ONE THE BOT CAN PERFORM FROM WHERE IT IS: sideways/down or wait, never "get" anything', () => {
  assert.match(FLOOD_REMEDY, /sideways|down/)
  assert.doesNotMatch(FLOOD_REMEDY, /pickaxe|gather|craft|blocks/)
})

/** One firing of the handlers' flood path, as the handlers run it: the pillar, its route, then `floodBranch`. */
async function firing (bot, refusals) {
  const out = await pillarOut(bot, climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position))
  if (climbOutcomeRoute(out) !== 'flood') return { route: climbOutcomeRoute(out), out }
  return { route: 'flood', ...(await floodBranch(bot, { handler: 'entombed', refusals })) }
}

await t('THE CHAIN, SCENE C (six firings): dry, in place, nothing dug, no prerequisite, a growing back-off, one row each', async () => {
  // The kit the drowned bots carried: 100 of 109 held a pickaxe, 98 held >= 8 blocks, 89 an empty bucket.
  const w = TOMB(WET_ALL)
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64), BUCKET] })
  const p0 = { ...bot.entity.position }
  rows.length = 0
  let refusals = 0, last = 0
  for (let k = 0; k < 6; k++) {
    const f = await firing(bot, refusals)
    assert.strictEqual(f.route, 'flood', `firing ${k}: ${f.out}`)
    assert.strictEqual(f.progressed, false); assert.strictEqual(f.preempted, false)
    assert.strictEqual(f.prereq, null)
    assert.strictEqual(f.refusals, refusals + 1)
    assert.strictEqual(f.dry, true, 'the refusal row would claim dry for a wet bot')
    assert.ok(f.backoffMs >= last && f.backoffMs > 0, 'spin: the back-off shrank or vanished')
    refusals = f.refusals; last = f.backoffMs
  }
  assert.strictEqual(bot.pendingPrereq, undefined, 'something in the chain asked the goal layer for an item')
  assert.deepStrictEqual(bot.digs, [], 'the chain dug into the pocket')
  assert.deepStrictEqual(bot.placed, [])
  assert.strictEqual(w.get(0, 2, 0), 'stone', 'the refused cell was breached')
  assert.deepStrictEqual(wetCells(bot, w), [], 'the bot is wet')
  assert.deepStrictEqual([bot.entity.position.x, bot.entity.position.y, bot.entity.position.z], [p0.x, p0.y, p0.z])
  const refused = rows.filter(r => r.name === '_climb_flood_refused')
  assert.strictEqual(refused.length, 6, 'one refusal row per back-off')
  for (const r of refused) {
    assert.ok(r.detail.length <= 300)
    assert.match(r.detail, /prereq=none dry=1/)
    assert.ok(r.detail.includes(FLOOD_REMEDY), `the remedy was cut by the 300-char cap: ${r.detail}`)
  }
  assert.strictEqual(rows.filter(r => r.name === '_climb_flood_ramp').length, 6)
})

await t('THE CHAIN, SCENE A: the same kit leaves the wet cell sideways and climbs out dry; the refused cell is never dug', async () => {
  const w = TOMB(WET_POCKET)
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64), BUCKET] })
  const f = await firing(bot, 0)
  assert.strictEqual(f.route, 'flood')
  assert.strictEqual(f.progressed, true, `the ramp did not move the bot: ${f.stair?.stopped}`)
  assert.strictEqual(f.refusals, 0)
  assert.ok(f.stair.sidestepped === 1 && f.stair.steps > 0, JSON.stringify(f.stair))
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'))
  assert.ok(bot.entity.position.y > Y0, 'no height gained')
  assert.deepStrictEqual(wetCells(bot, w), [])
  assert.strictEqual(bot.pendingPrereq, undefined)
})

await t('PREEMPTED IS NOT A REFUSAL: the drowning rescue taking the body counts nothing and backs nothing off (Codex r1)', async () => {
  rows.length = 0
  const bot = makeBot(TOMB(WET_ALL), { inv: [PICK(), COBBLE(64)] })
  const f = await floodBranch(bot, { handler: 'entombed', refusals: 3, yieldTo: () => 'drowning' })
  assert.deepStrictEqual([f.preempted, f.progressed, f.refusals, f.backoffMs, f.prereq], [true, false, 3, 0, null])
  assert.strictEqual(rows.filter(r => r.name === '_climb_flood_refused').length, 0, 'a yielded ramp was logged as "stayed dry"')
})

await t('THE GIVE-UP ARM AND THE MAROON STATE SEE A WET CEILING AS NOT-A-TOOL-PROBLEM', async () => {
  const wet = makeBot(TOMB({ '0,3,0': 'water' }), { inv: [] })
  assert.match(String(ceilingFloodRisk(wet)), /liquid above/)
  assert.strictEqual(ceilingFloodRisk(makeBot(TOMB(), { inv: [] })), null)
  // an open shaft capped by stone 3 above, no tool: a dry cap asks for a pickaxe; a wet cap does not
  const shaft = extra => TOMB({ '0,2,0': 'air', ...extra })
  assert.ok(shaftCapNeedsTool(makeBot(shaft({}), { inv: [] })), 'POSITIVE CONTROL: a dry stone cap with no tool is a tool problem')
  assert.strictEqual(shaftCapNeedsTool(makeBot(shaft({ '0,4,0': 'water' }), { inv: [] })), null,
    'a wet cap was reported as needing a pickaxe')
})

await t('THE OUTCOME WATCH: a breach row only for the same live body, labelled exempt when submerged (Codex r1)', async () => {
  const w = TOMB({ '0,2,0': 'water' })
  const cell = V(0, Y0 + 2, 0)
  rows.length = 0
  const a = makeBot(w); watchClimbDig(a, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 })
  const b = makeBot(w); watchClimbDig(b, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 }); b.entity = { ...b.entity }
  const c = makeBot(w); watchClimbDig(c, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 }); c.health = 0
  const d = makeBot(w); watchClimbDig(d, { caller: 'pillar_out', cell, before: 'stone', submerged: true, delayMs: 5 })
  const e = makeBot(TOMB()); watchClimbDig(e, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 })
  await new Promise(r => setTimeout(r, 40))
  const br = rows.filter(r => r.name === '_climb_flood_breach' && r.detail.includes(`cell=0,${Y0 + 2},0 `)).map(r => r.detail)
  assert.strictEqual(br.length, 2, JSON.stringify(br))
  assert.match(br[0], /caller=pillar_out .*before=stone liquid=water submerged=0 exempt=0/)
  assert.match(br[1], /submerged=1 exempt=1/)
})

await t('POSITIVE CONTROL FOR THE CHAIN: the same kit under a DRY ceiling climbs (the regression arm, scene F)', async () => {
  const bot = makeBot(TOMB(), { inv: [PICK(100), COBBLE(64), BUCKET] })
  const out = await pillarOut(bot, 3)
  assert.notStrictEqual(climbOutcomeRoute(out), 'flood')
  assert.ok(bot.entity.position.y > Y0, 'it did not climb')
})

// ================================================================================================================
// D. WIRING. Behaviour cannot reach the two handlers: they live inside startReflexes' 500 ms interval behind
//    throttles and a live path search. Structural assertions, comments stripped (this codebase's comments quote the
//    code), anchored on executable lines, each seen to fail by a mutant below.
// ================================================================================================================

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
const ENT_FLOOD = "          else if (climbOutcomeRoute(climbed) === 'flood') {"
const GIVEUP = 'if (escapeFailures >= ESCAPE_GIVE_UP_AFTER && !ceilingFloodRisk(bot)) {'
const MAR_FLOOD = "          } else if (climbOutcomeRoute(pillarOutcome) === 'flood') {"
function branch (code, open, closeAt) {
  const i = code.indexOf(open)
  if (i < 0) return null
  const j = code.indexOf(closeAt, i + open.length)
  return code.slice(i, j < 0 ? i + 4000 : j)
}
function assertEntombedWired (code) {
  const b = branch(code, ENT_FLOOD, "else if (climbed === 'preempted')")
  assert.ok(b, 'the entombed handler has no flood branch: flood_risk falls into the failure counter and the pickaxe ask')
  assert.match(b, /await floodBranch\(bot, \{ handler: 'entombed'/, 'the flood branch does not run floodBranch')
  assert.match(b, /lastEscapeAt = Date\.now\(\) \+ fb\.backoffMs/, 'no back-off: the branch would spin')
  assert.match(b, /else if \(!fb\.preempted\)/, 'a preempted ramp is backed off as if refused')
  assert.doesNotMatch(b, /pendingPrereq/, 'the flood branch asks the goal layer for an item')
  assert.doesNotMatch(b, /escapeFailures\+\+/, 'the flood branch feeds the failure counter (four of those ask for a pickaxe)')
  assert.ok(code.indexOf(ENT_FLOOD) < code.indexOf("isEntombed(bot))) escapeFailures++"),
    'the flood branch must be decided before the failure counter')
  assert.ok(code.includes(GIVEUP), 'the give-up arm asks for a pickaxe even under a wet ceiling')
}
function assertMaroonedWired (code) {
  const b = branch(code, MAR_FLOOD, "noteReflexInventory(bot, invBefore, 'maroon_escape')")
  assert.ok(b, 'the marooned handler has no flood branch: the refusal is silently dropped')
  assert.match(b, /await floodBranch\(bot, \{ handler: 'marooned'/)
  assert.match(b, /lastMaroonCheck = Date\.now\(\) \+ fb\.backoffMs/)
  assert.doesNotMatch(b, /pendingPrereq/)
}

await t('WIRED: the entombed handler routes flood_risk to its own branch (ramp, back-off, no ask)', () => {
  assertEntombedWired(strip(readFileSync(REFLEX_PATH, 'utf8')))
})
await t('WIRED: the marooned handler routes flood_risk to the same branch', () => {
  assertMaroonedWired(strip(readFileSync(REFLEX_PATH, 'utf8')))
})
await t('MUTANT KILLED: unwiring the entombed flood branch is caught, for the right reason', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(ENT_FLOOD), 'ANCHOR MISSING'); assert.strictEqual(src.split(ENT_FLOOD).length, 2, 'anchor not unique')
  const mutated = strip(src.replace(ENT_FLOOD, '          else if (false) {'))
  assert.throws(() => assertEntombedWired(mutated), /no flood branch/)
})
await t('MUTANT KILLED: unwiring the marooned flood branch is caught', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(MAR_FLOOD), 'ANCHOR MISSING'); assert.strictEqual(src.split(MAR_FLOOD).length, 2, 'anchor not unique')
  assert.throws(() => assertMaroonedWired(strip(src.replace(MAR_FLOOD, '          } else if (false) {'))), /no flood branch/)
})
await t('MUTANT KILLED: a prerequisite ask inside the entombed flood branch is caught', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const A = '            else if (!fb.preempted) { escapeFailures = 0; lastEscapeAt = Date.now() + fb.backoffMs }'
  assert.ok(src.includes(A), 'ANCHOR MISSING'); assert.strictEqual(src.split(A).length, 2, 'anchor not unique')
  const mutated = strip(src.replace(A, A + "\n            bot.pendingPrereq = { items: ['stone_pickaxe'], count: 2 }"))
  assert.throws(() => assertEntombedWired(mutated), /asks the goal layer/)
})
await t('MUTANT KILLED: the give-up arm without the wet-ceiling skip is caught', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(GIVEUP), 'ANCHOR MISSING'); assert.strictEqual(src.split(GIVEUP).length, 2, 'anchor not unique')
  assert.throws(() => assertEntombedWired(strip(src.replace(GIVEUP, 'if (escapeFailures >= ESCAPE_GIVE_UP_AFTER) {'))), /give-up arm/)
})

// ================================================================================================================
// E. MUTANTS ON THE DECISIONS. Each must change the answer of a test above.
// ================================================================================================================

const M_ABOVE = "  const faces = [[0, 1, 0, 'above'], ...SIDES.map(([x, z]) => [x, 0, z, 'beside'])]"
await t('MUTANT KILLED: dropping the cell ABOVE from the predicate lets the climb break into the pocket', async () => {
  await withMutant(SCAFFOLD_PATH, M_ABOVE, "  const faces = [...SIDES.map(([x, z]) => [x, 0, z, 'beside'])]", async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'water' }), 0, 2, 0) }), null,
      'the mutant still refused: the p+3 test is not what proves the new cell')
  })
})

const M_FALL = '  if (isFallingBlock(target) || isFallingBlock(above)) {'
await t('MUTANT KILLED: dropping the falling-column extension reopens scene G', async () => {
  await withMutant(SCAFFOLD_PATH, M_FALL, '  if (false) {', async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'gravel', '0,4,0': 'water' }), 0, 2, 0) }), null)
  })
})

const M_UNKNOWN = '    if (!c) return `terrain not loaded ${where} the block overhead`'
await t('MUTANT KILLED: reading an unloaded cell as dry', async () => {
  await withMutant(SCAFFOLD_PATH, M_UNKNOWN, '    if (!c) continue', async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': null }), 0, 2, 0) }), null)
  })
})

const M_LAVA = "export function isLavaCell (b) {\n  return !!b && /lava/.test(b.name ?? '')"
await t('MUTANT KILLED: narrowing the lava classifier to `name === \'lava\'` misses flowing_lava', async () => {
  await withMutant(SCAFFOLD_PATH, M_LAVA, "export function isLavaCell (b) {\n  return !!b && b.name === 'lava'", async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'flowing_lava' }), 0, 2, 0) }), null)
  })
})

const M_WL = "  return WATER_CELL.test(b.name ?? '') || b.isWaterlogged === true"
await t('MUTANT KILLED: ignoring waterlogged blocks', async () => {
  await withMutant(SCAFFOLD_PATH, M_WL, "  return WATER_CELL.test(b.name ?? '')", async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'oak_stairs_wl' }), 0, 2, 0) }), null)
  })
})

const M_SUB = '  const wet = b => isWaterCell(b) && !submerged'
await t('MUTANT KILLED: removing the submerged exemption traps a flooded bot (the 2026-09-07 dead end)', async () => {
  await withMutant(SCAFFOLD_PATH, M_SUB, '  const wet = b => isWaterCell(b)', async mod => {
    assert.ok(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'water' }), 0, 2, 0), submerged: true }))
  })
})

const M_BREACH = '  const risk = floodAt(2)\n  if (risk) return { ok: false, reason: `flood risk: ${risk}`, flood: true, cell: [0, 2, 0] }'
await t('MUTANT KILLED: the ceiling breach without the flood check re-breaches the refused cell', async () => {
  await withMutant(SCAFFOLD_PATH, M_BREACH, '  const risk = null', async mod => {
    const r = mod.headroomBreach({ at: atFeet(TOMB({ '0,3,0': 'water' })) })
    assert.deepStrictEqual(r.dig, [[0, 2, 0]], 'the mutant did not dig: the breach test is passing on another line')
  })
  assert.strictEqual(headroomBreach({ at: atFeet(TOMB({ '0,3,0': 'water' })) }).ok, false)
})

const M_SETTLE = '    const risk = floodAt(3)\n    if (risk) return { ok: false, reason: `flood risk: ${risk}`, flood: true, cell: [0, 3, 0] }'
await t('MUTANT KILLED: the gravel settle dig without the flood check opens scene G from the ramp', async () => {
  await withMutant(SCAFFOLD_PATH, M_SETTLE, '    const risk = null', async mod => {
    const r = mod.headroomBreach({ at: atFeet(TOMB({ '0,3,0': 'gravel', '0,4,0': 'water' })) })
    assert.deepStrictEqual(r.dig, [[0, 3, 0]])
  })
})

const M_STEP = '    if (risk) return { ok: false, reason: `flood risk in the ${what}: ${risk}`, flood: true, cell: [bx, dy, bz] }'
await t('MUTANT KILLED: ramp step digs without the flood check', async () => {
  const w = world({ '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air', '1,4,0': 'water' })
  assert.strictEqual(stairUpStep({ at: atFeet(w), bear: { x: 1, z: 0 } }).flood, true)
  await withMutant(SCAFFOLD_PATH, M_STEP, '    if (false) return null', async mod => {
    const r = mod.stairUpStep({ at: atFeet(w), bear: { x: 1, z: 0 } })
    assert.strictEqual(r.ok, true, 'the mutant still refused')
    assert.deepStrictEqual(r.dig[0], [1, 3, 0], 'the mutant would break the clearance under the water')
  })
})

const M_PILLAR = "      if (upwardDigFloodRisk(bot, 'pillar_out')) return FLOOD_RISK\n      const opened"
const M_PILLAR2 = "      // must still be true at the swing, read with the submerged state as it is now.\n      if (upwardDigFloodRisk(bot, 'pillar_out')) return FLOOD_RISK"
await t('MUTANT KILLED: pillarOut\'s two in-loop checks removed -> the marooned climb digs into the pocket', async () => {
  await withMutants(REFLEX_PATH, [[M_PILLAR, '      const opened'], [M_PILLAR2, '      // (mutant)']], async mod => {
    const w = TOMB({ '0,2,0': 'air', '0,3,0': 'air', '0,5,0': 'water' })
    const bot = makeBot(w, { inv: [COBBLE(64), PICK()] })
    await mod.pillarOut(bot, 6)
    assert.ok(bot.digs.some(d => d.cell === '0,4,0'), `the mutant did not dig the wet ceiling: ${JSON.stringify(bot.digs)}`)
  })
})
await t('THE SECOND CHECK IS LOAD BEARING: water arriving during the hand change stops pillarOut (and its mutant digs)', async () => {
  const flood = ww => ww.set(0, 3, 0, 'water')
  const bot = makeBot(TOMB(), { inv: [COBBLE(64), PICK()], held: PICK(), onHand: flood })
  assert.strictEqual(await pillarOut(bot, 3), FLOOD_RISK)
  assert.deepStrictEqual(bot.digs, [])
  const dry = makeBot(TOMB(), { inv: [COBBLE(64), PICK()], held: PICK() })
  await pillarOut(dry, 3)
  assert.strictEqual(dry.digs[0]?.cell, '0,2,0', 'POSITIVE CONTROL: no water, the same hand change digs')
  await withMutant(REFLEX_PATH, M_PILLAR2, '      // (mutant)', async mod => {
    const m = makeBot(TOMB(), { inv: [COBBLE(64), PICK()], held: PICK(), onHand: flood })
    await mod.pillarOut(m, 3)
    assert.strictEqual(m.digs[0]?.cell, '0,2,0', 'the mutant still refused: the second check is not what stops it')
  })
})

const M_PRE = "    if (head0 && head0.name !== 'air' && head0.name !== 'water' &&\n        upwardDigFloodRisk(bot, 'pillar_out')) return FLOOD_RISK"
await t('MUTANT KILLED: pillarOut\'s pre-check removed -> a wet ceiling reads as a block shortage', async () => {
  await withMutant(REFLEX_PATH, M_PRE, '    void head0', async mod => {
    const bot = makeBot(TOMB({ '0,3,0': 'water' }), { inv: [COBBLE(2)] })
    assert.strictEqual(await mod.pillarOut(bot, 24), 'needs_blocks')
  })
})

const M_DSU_PRE = "  if (blocking && blocking.name !== 'air' && upwardDigFloodRisk(bot, 'dig_straight_up')) return FLOOD_RISK"
await t('MUTANT KILLED: digStraightUp\'s pre-check removed -> the wrong remedy (needs_pickaxe)', async () => {
  await withMutant(REFLEX_PATH, M_DSU_PRE, '', async mod => {
    const bot = makeBot(TOMB({ '0,3,0': 'water' }), { inv: [PICK()] })
    assert.strictEqual(await mod.digStraightUp(bot, Y0, 2), 'needs_pickaxe')
  })
})

const M_DSU_LOOP = "      if (upwardDigFloodRisk(bot, 'dig_straight_up')) return FLOOD_RISK\n      const opened"
const M_DSU_LOOP2 = "      if (upwardDigFloodRisk(bot, 'dig_straight_up')) return FLOOD_RISK   // again after the hand change (Codex r2)"
await t('MUTANT KILLED: digStraightUp\'s two in-loop checks removed -> it digs into the pocket', async () => {
  await withMutants(REFLEX_PATH, [[M_DSU_LOOP, '      const opened'], [M_DSU_LOOP2, '']], async mod => {
    const w = TOMB({ '0,2,0': 'air', '0,4,0': 'water' })
    const bot = makeBot(w, { inv: [PICK(), PICK(), COBBLE(10)] })
    await mod.digStraightUp(bot, Y0, 4)
    assert.ok(bot.digs.some(d => d.cell === '0,3,0'), JSON.stringify(bot.digs))
  })
})
await t('THE SECOND CHECK IS LOAD BEARING in digStraightUp: water during the equip stops the dig (and its mutant digs)', async () => {
  const flood = ww => ww.set(0, 3, 0, 'water')
  const bot = makeBot(TOMB(), { inv: [PICK(), PICK()], onHand: flood })
  assert.strictEqual(await digStraightUp(bot, Y0, 1), FLOOD_RISK)
  assert.deepStrictEqual(bot.digs, [])
  await withMutant(REFLEX_PATH, M_DSU_LOOP2, '', async mod => {
    const m = makeBot(TOMB(), { inv: [PICK(), PICK()], onHand: flood })
    await mod.digStraightUp(m, Y0, 1)
    assert.strictEqual(m.digs[0]?.cell, '0,2,0')
  })
})

const M_RAMP_SUB = '    const plan = headroomBreach({ at, canBreak, submerged })'
await t('MUTANT KILLED: the ramp ignoring the submerged exemption refuses a flooded bot its way out', async () => {
  const w = () => TOMB({ '0,0,0': 'water', '0,1,0': 'water', '0,3,0': 'water' })
  const rb = makeBot(w())
  const real = await escapeStairUp(rb, { maxSteps: 1, budgetMs: 10_000 })
  assert.ok(rb.digs.some(d => d.cell === '0,2,0'), `POSITIVE CONTROL: a submerged bot breaches its own ceiling (${real.stopped})`)
  assert.strictEqual(real.sidestepped, 0)
  await withMutant(REFLEX_PATH, M_RAMP_SUB, '    const plan = headroomBreach({ at, canBreak, submerged: false })', async mod => {
    const mb = makeBot(w())
    await mod.escapeStairUp(mb, { maxSteps: 1, budgetMs: 20_000 })
    assert.ok(!mb.digs.some(d => d.cell === '0,2,0'), 'the mutant still breached: the exemption is not what lets it')
  })
})

const M_PREREQ = '  if (progressed) return { progressed: true, refused: false, backoffMs: 0, prereq: null, remedy: null }\n  const n = Math.max(1, refusals)'
await t('MUTANT KILLED: a flood step that asks for a pickaxe is caught', async () => {
  await withMutant(CLIMBFLOOD_PATH, M_PREREQ,
    "  if (progressed) return { progressed: true, refused: false, backoffMs: 0, prereq: null, remedy: null }\n  const n = Math.max(1, refusals)\n  if (n >= 4) return { progressed: false, refused: true, backoffMs: 60000, prereq: { items: ['stone_pickaxe'] }, remedy: '' }",
    async mod => {
      assert.ok(mod.floodChainStep({ refusals: 4, stair: { steps: 0 } }).prereq, 'the mutant did not apply')
    })
})

const M_SHAFT = '    const flood = overheadBreakRisk({ at: (dx, dy, dz) => bot.blockAt(p.offset(dx, 2 + dy, dz)), submerged })'
const M_SHAFT2 = '        const again = overheadBreakRisk({ at: (dx, dy, dz) => bot.blockAt(q.offset(dx, 2 + dy, dz)), submerged: wetNow })'
const BLIND = "(dy === 1 && !dx && !dz ? { name: 'stone', boundingBox: 'block' } : bot.blockAt(%.offset(dx, 2 + dy, dz)))"
await t('MUTANT KILLED: shaftAscend asking about the wrong cell (no p+3), both checks -> digs into the pocket', async () => {
  await withMutants(SKILLS_PATH, [
    [M_SHAFT, `    const flood = overheadBreakRisk({ at: (dx, dy, dz) => ${BLIND.replace('%', 'p')}, submerged })`],
    [M_SHAFT2, `        const again = overheadBreakRisk({ at: (dx, dy, dz) => ${BLIND.replace('%', 'q')}, submerged: wetNow })`],
  ], async mod => {
    const bot = shaftBot(SHAFT({ '0,3,0': 'water' }))
    await mod.shaftAscend(bot, Y0 + 20, new AbortController().signal, { deadline: Date.now() + 4000 })
    assert.ok(bot.digs.some(d => d.cell === '0,2,0'), JSON.stringify(bot.digs))
  })
})
await t('THE SECOND CHECK IS LOAD BEARING in shaftAscend: water during the equip stops the dig', async () => {
  const bot = shaftBot(SHAFT())
  bot.inventory.items = () => [COBBLE(24), PICK()]
  const realEquip = bot.equip
  bot.equip = async (item) => { await realEquip(item); if (/pickaxe/.test(item?.name)) bot.world.set(0, 3, 0, 'water') }
  const r = await shaftAscend(bot, Y0 + 20, new AbortController().signal, { deadline: Date.now() + 4000 })
  assert.match(String(r.stopped), /liquid above/)
  assert.deepStrictEqual(bot.digs, [])
})

const M_WLSOLID = "  const solid = target.name !== 'air' && target.boundingBox !== 'empty'\n  if (!solid) return null"
await t('MUTANT KILLED: treating a waterlogged block as "nothing to break" skips its neighbours', async () => {
  await withMutant(SCAFFOLD_PATH, M_WLSOLID, "  const solid = target.name !== 'air' && target.boundingBox !== 'empty' && !isWaterCell(target)\n  if (!solid) return null", async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,2,0': 'oak_stairs_wl', '1,2,0': 'lava' }), 0, 2, 0), submerged: true }), null)
  })
})

const M_SIDECEIL = '    if (risk) return { ok: false, reason: `the side column floods too: ${risk}`, flood: true }'
await t('MUTANT KILLED: a sidestep that ignores the side column\'s own ceiling walks into scene C\'s trap', async () => {
  await withMutant(SCAFFOLD_PATH, M_SIDECEIL, '    void risk', async mod => {
    const c = mod.chooseFloodSidestep({ at: atFeet(TOMB(WET_ALL)), bearings: [{ x: 1, z: 0 }] })
    assert.strictEqual(c.ok, true, 'the mutant still refused the wet column')
  })
})

const M_SIDEDIG = '    if (risk) return { ok: false, reason: `flood risk in the ${what} cell: ${risk}`, flood: true }'
await t('MUTANT KILLED: a sidestep dig without the flood check', async () => {
  await withMutant(SCAFFOLD_PATH, M_SIDEDIG, '    void risk', async mod => {
    assert.strictEqual(mod.floodSidestep({ at: atFeet(TOMB({ '2,1,0': 'water' })), bear: { x: 1, z: 0 } }).ok, true)
  })
})

const M_RECHECK = '      if (risk) { logFloodGuard(bot, { caller, reason: risk, cell, submerged }); return { flood: risk } }'
await t('MUTANT KILLED: digging the plan without re-checking each cell digs under water that arrived mid-step', async () => {
  await withMutant(REFLEX_PATH, M_RECHECK, '      void risk', async mod => {
    const cells = { '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air' }
    for (const [x, z] of [[-1, 0], [0, 1], [0, -1]]) { cells[`${x},1,${z}`] = 'bedrock'; cells[`${x},2,${z}`] = 'bedrock' }
    const bot = makeBot(world(cells), { onDig: (cell, ww) => { if (cell === '1,3,0') ww.set(1, 3, 0, 'water') } })
    await mod.escapeStairUp(bot, { maxSteps: 1, budgetMs: 20_000 })
    assert.ok(bot.digs.some(d => d.cell === '1,2,0'), JSON.stringify(bot.digs))
  })
})

const M_PREEMPT = '  if (stair.yielded) return { progressed: step.progressed, preempted: true, refusals, backoffMs: 0, prereq: null, stair, dry: !wet }'
await t('MUTANT KILLED: a yielded ramp counted as a refusal', async () => {
  await withMutant(REFLEX_PATH, M_PREEMPT, '', async mod => {
    const f = await mod.floodBranch(makeBot(TOMB(WET_ALL)), { handler: 'entombed', refusals: 3, yieldTo: () => 'drowning' })
    assert.strictEqual(f.preempted, false); assert.strictEqual(f.refusals, 4)
  })
})

const M_CAP = '  if (ceilingFloodRisk(bot, cap.dy)) return null'
await t('MUTANT KILLED: a wet cap reported as needing a pickaxe', async () => {
  await withMutant(REFLEX_PATH, M_CAP, '', async mod => {
    assert.ok(mod.shaftCapNeedsTool(makeBot(TOMB({ '0,2,0': 'air', '0,4,0': 'water' }), { inv: [] })))
  })
})

const M_WATCH = '      if (bot.entity !== body || !(bot.health > 0)) return'
await t('MUTANT KILLED: the outcome watch without the same-body check reports a dead bot\'s cell', async () => {
  await withMutant(CLIMBFLOOD_PATH, M_WATCH, '', async mod => {
    rows.length = 0
    const c = makeBot(TOMB({ '0,2,0': 'water' }))
    mod.watchClimbDig(c, { caller: 'mutant', cell: V(0, Y0 + 2, 0), before: 'stone', delayMs: 5 }); c.health = 0
    await new Promise(r => setTimeout(r, 40))
    assert.ok(rows.some(r => r.name === '_climb_flood_breach' && /caller=mutant/.test(r.detail)))
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
