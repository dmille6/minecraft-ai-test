// CLIMB FLOOD -- THE MUTANTS (section E of climb-flood.test.mjs, split out 10-06 so neither file reaches the runner's
// 120 s per-file limit under load; the shared fixtures below are a verbatim copy).
//
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
         climbNeedAbove, floodBranch, ceilingFloodRisk, shaftCapNeedsTool, targetFloodRisk, unburyDigFor,
         unburySelf } from '../src/reflex.mjs'
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
function makeBot (w, { y = Y0, inv = [], held = null, canPath = false, onDig = null, onHand = null, onLook = null,
                         digThrows = null } = {}) {
  const digs = [], placed = [], controls = []
  let yaw = 0
  const rel = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) - y, z: Math.floor(p.z) })
  const bot = {
    digs, placed, controls, world: w, pendingPrereq: undefined,
    entity: { position: V(0, y, 0), get yaw () { return yaw }, onGround: true, isInWater: false },
    health: 20,
    heldItem: held,
    inventory: { items: () => inv.filter(i => i.count > 0), emptySlotCount: () => 36 - inv.length },
    blockAt (p) { const r = rel(p); return blk(w.get(r.x, r.y, r.z), V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) },
    async unequip () { bot.heldItem = null; onHand?.(w, bot) },
    async equip (item) { bot.heldItem = item; onHand?.(w, bot) },
    async dig (b) {
      const r = rel(b.position)
      if (digThrows?.(`${r.x},${r.y},${r.z}`, bot)) throw new Error('Digging aborted')
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
    stopDigging () {}, clearControlStates () { controls.push('clear') },
    async look (a) { yaw = a; onLook?.(w, bot) }, async lookAt () {},
    setControlState (name, on) {
      controls.push(`${name}:${on}`)
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

const SHAFT = (extra = {}) => world({ '0,0,0': 'air', '0,1,0': 'air', ...extra })
function shaftBot (w) {
  const bot = makeBot(w, { inv: [COBBLE(24)] })
  bot.registry = require_('prismarine-registry')('1.21.8')
  bot.health = 20; bot.food = 20
  return bot
}

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

const M_SUB = '  const wet = b => (isWaterCell(b) || isMeltingIce(b)) && !submerged'
await t('MUTANT KILLED: removing the submerged exemption traps a flooded bot (the 2026-09-07 dead end)', async () => {
  await withMutant(SCAFFOLD_PATH, M_SUB, '  const wet = b => (isWaterCell(b) || isMeltingIce(b))', async mod => {
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
const M_PILLAR2 = "      const atSwing = targetFloodRisk(bot, head, 'pillar_out')\n      if (atSwing.reason) return FLOOD_RISK"
await t('MUTANT KILLED: pillarOut\'s two in-loop checks removed -> the marooned climb digs into the pocket', async () => {
  await withMutants(REFLEX_PATH, [[M_PILLAR, '      const opened'], [M_PILLAR2, '      const atSwing = { reason: null, submerged: false }']], async mod => {
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
  await withMutant(REFLEX_PATH, M_PILLAR2, '      const atSwing = { reason: null, submerged: false }', async mod => {
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
const M_DSU_LOOP2 = "      const atSwing = targetFloodRisk(bot, above, 'dig_straight_up')   // again after the hand change, of `above` itself (Codex r2/r3)"
await t('MUTANT KILLED: digStraightUp\'s two in-loop checks removed -> it digs into the pocket', async () => {
  await withMutants(REFLEX_PATH, [[M_DSU_LOOP, '      const opened'], [M_DSU_LOOP2, '      const atSwing = { reason: null, submerged: false }']], async mod => {
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
  await withMutant(REFLEX_PATH, M_DSU_LOOP2, '      const atSwing = { reason: null, submerged: false }', async mod => {
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
const M_SHAFT2 = '        const again = overheadBreakRisk({ at: (dx, dy, dz) => bot.blockAt(cell.offset(dx, dy, dz)), submerged: wetNow })'
const BLIND = "(dy === 1 && !dx && !dz ? { name: 'stone', boundingBox: 'block' } : bot.blockAt(%.offset(dx, 2 + dy, dz)))"
await t('MUTANT KILLED: shaftAscend asking about the wrong cell (no p+3), both checks -> digs into the pocket', async () => {
  await withMutants(SKILLS_PATH, [
    [M_SHAFT, `    const flood = overheadBreakRisk({ at: (dx, dy, dz) => ${BLIND.replace('%', 'p')}, submerged })`],
    [M_SHAFT2, `        const again = overheadBreakRisk({ at: (dx, dy, dz) => (dy === 1 && !dx && !dz ? { name: 'stone', boundingBox: 'block' } : bot.blockAt(cell.offset(dx, dy, dz))), submerged: wetNow })`],
  ], async mod => {
    const bot = shaftBot(SHAFT({ '0,3,0': 'water' }))
    await mod.shaftAscend(bot, Y0 + 20, new AbortController().signal, { deadline: Date.now() + 4000 })
    assert.ok(bot.digs.some(d => d.cell === '0,2,0'), JSON.stringify(bot.digs))
  })
})
function shaftEquipBot (onPick) {
  const bot = shaftBot(SHAFT())
  bot.inventory.items = () => [COBBLE(24), PICK()]
  const realEquip = bot.equip
  bot.equip = async (item) => { await realEquip(item); if (/pickaxe/.test(item?.name)) onPick(bot) }
  return bot
}
await t('THE SECOND CHECK IS LOAD BEARING in shaftAscend: water during the equip stops the dig (and its own mutant digs)', async () => {
  const flood = b => b.world.set(0, 3, 0, 'water')
  const bot = shaftEquipBot(flood)
  const r = await shaftAscend(bot, Y0 + 20, new AbortController().signal, { deadline: Date.now() + 4000 })
  assert.match(String(r.stopped), /liquid above/)
  assert.deepStrictEqual(bot.digs, [])
  await withMutant(SKILLS_PATH, '        if (again) {', '        if (false) {', async mod => {
    const m = shaftEquipBot(flood)
    await mod.shaftAscend(m, Y0 + 20, new AbortController().signal, { deadline: Date.now() + 4000 })
    assert.strictEqual(m.digs[0]?.cell, '0,2,0', 'the second check is not what stopped it')
  })
})

await t('THE SWING\'S OWN TARGET: a bot that drifts a cell during the hand change cannot approve a dry neighbour (Codex r3)', async () => {
  // pillarOut: during the unequip/equip the bot slides one cell east (open there) while water arrives over the
  // ORIGINAL target. Asked of the bot's new position the overhead is dry; asked of the target, it is not.
  const drift = (ww, b) => { if (!b._drifted) { b._drifted = true; ww.set(1, 0, 0, 'air'); ww.set(1, 1, 0, 'air'); ww.set(0, 3, 0, 'water'); b.entity.position = V(1, Y0, 0) } }
  const bot = makeBot(TOMB(), { inv: [COBBLE(64), PICK()], held: PICK(), onHand: drift })
  assert.strictEqual(await pillarOut(bot, 3), FLOOD_RISK)
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'), 'it broke the original, now-wet target')
  await withMutant(REFLEX_PATH, M_PILLAR2, "      const atSwing = { reason: upwardDigFloodRisk(bot, 'pillar_out'), submerged: false }\n      if (atSwing.reason) return FLOOD_RISK", async mod => {
    const m = makeBot(TOMB(), { inv: [COBBLE(64), PICK()], held: PICK(), onHand: drift })
    await mod.pillarOut(m, 3)
    assert.ok(m.digs.some(d => d.cell === '0,2,0'), `the position-anchored mutant did not dig the wet target: ${JSON.stringify(m.digs)}`)
  })
})

await t('SIDESTEP: a takeover during the look -> no stroke, and the new owner\'s controls are not cleared (Codex r3)', async () => {
  let taken = false
  const bot = makeBot(TOMB(WET_POCKET), { onLook: () => { taken = true } })
  const r = await escapeStairUp(bot, { maxSteps: 2, budgetMs: 20_000, yieldTo: () => (taken ? 'drowning' : null) })
  assert.strictEqual(r.yielded, 'drowning')
  const after = bot.controls.slice(bot.controls.findIndex(c => c === 'clear') + 1)
  assert.ok(!bot.controls.includes('forward:true'), `it stroked forward under the new owner: ${bot.controls}`)
  assert.deepStrictEqual(after.filter(c => c === 'clear' || c === 'forward:false'), [], `it cleared the new owner's controls: ${bot.controls}`)
  assert.deepStrictEqual([bot.entity.position.x, bot.entity.position.z], [0, 0], 'it moved')
})

await t('SIDESTEP: the side cell flooding during the look -> no step into it', async () => {
  const bot = makeBot(TOMB(WET_POCKET), { onLook: (ww, b) => { if (!b._f) { b._f = true; ww.set(-1, 1, 0, 'water'); ww.set(0, 1, -1, 'water'); ww.set(0, 1, 1, 'water'); ww.set(1, 1, 0, 'water') } } })
  const r = await escapeStairUp(bot, { maxSteps: 2, budgetMs: 20_000 })
  assert.match(String(r.stopped), /side cell changed/)
  assert.deepStrictEqual([bot.entity.position.x, bot.entity.position.z], [0, 0], 'it walked into the flooded side cell')
})

await t('BURIED UNDER A WET COLUMN: a refused overhead dig still lets the bot dig its OWN head cell out (Codex r3)', async () => {
  // A gravel column has landed in the bot's head cell and at feet+2, with water above it. unburySelf (the real one)
  // takes feet+2 first: the flood check refuses it; the head cell must still be dug, and feet+2 never.
  const w = TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel', '0,3,0': 'water' })
  const bot = makeBot(w)
  let flooded = null
  const digWithin = async b => { await bot.dig(b); return null }
  const digChecked = async (b, caller) => (targetFloodRisk(bot, b, caller).reason ? { flood: 'refused' } : digWithin(b))
  const u = await unburySelf(bot, { digWithin: unburyDigFor(bot, { digChecked, digWithin, onFlood: f => { flooded = f } }) })
  const cells = bot.digs.map(d => d.cell)
  assert.ok(cells.includes('0,1,0'), `the bot did not dig its own head cell out: ${cells} (${u.stopped})`)
  assert.ok(!cells.includes('0,2,0'), `the wet gravel overhead was dug: ${cells}`)
  assert.strictEqual(flooded, 'refused')
  assert.match(String(u.stopped), /flood risk/, 'the overhead refusal must still be reported once the body is clear')
  // POSITIVE CONTROL: the same column with a DRY top is dug top down, overhead included
  const dry = makeBot(TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel' }))
  const dw = async b => { await dry.dig(b); return null }
  await unburySelf(dry, { digWithin: unburyDigFor(dry, { digChecked: async (b, c) => (targetFloodRisk(dry, b, c).reason ? { flood: 'x' } : dw(b)), digWithin: dw }) })
  assert.deepStrictEqual(dry.digs.map(d => d.cell), ['0,2,0', '0,1,0'])
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

await t('BURIED UNDER A WET COLUMN, THROUGH THE REAL RAMP AND BRANCH, every side wet: the head cell is dug before the refusal (Codex r4)', async () => {
  const w = TOMB({ ...WET_ALL, '0,1,0': 'gravel', '0,2,0': 'gravel' })
  const bot = makeBot(w, { inv: [PICK(), COBBLE(64)] })
  const f = await floodBranch(bot, { handler: 'entombed', refusals: 0 })
  const cells = bot.digs.map(d => d.cell)
  assert.ok(cells.includes('0,1,0'), `the buried head cell was left: ${cells} (${f.stair.stopped})`)
  assert.ok(!cells.includes('0,2,0'), 'the wet overhead was dug')
  assert.strictEqual(f.stair.flood, 'ramp_breach')
  assert.strictEqual(f.progressed, false); assert.strictEqual(f.prereq, null)
  // POSITIVE CONTROL: the same buried bot under a DRY column breaches normally (the head cell is the ramp's own business there)
  const dry = makeBot(TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel' }))
  await escapeStairUp(dry, { maxSteps: 1, budgetMs: 20_000 })
  assert.ok(dry.digs.some(d => d.cell === '0,2,0'), 'POSITIVE CONTROL: a dry overhead is taken')
})

const M_UNBURY_FIRST = "        if (buriedAt() && !openSide) {"
await t('MUTANT KILLED: the flood refusal exit without unburying the body first', async () => {
  await withMutant(REFLEX_PATH, M_UNBURY_FIRST, '        if (false) {', async mod => {
    const bot = makeBot(TOMB({ ...WET_ALL, '0,1,0': 'gravel', '0,2,0': 'gravel' }))
    await mod.escapeStairUp(bot, { maxSteps: 1, budgetMs: 20_000 })
    assert.ok(!bot.digs.some(d => d.cell === '0,1,0'), 'the mutant still dug the head cell')
  })
})

await t('SIDESTEP: a takeover that ABORTS a sidestep dig is preemption -- no refusal, no back-off, the new owner\'s controls untouched (Codex r4)', async () => {
  let taken = false
  const bot = makeBot(TOMB(WET_POCKET), { digThrows: (c, b) => { if (!taken) b._takenAt = b.controls.length; taken = true; return true } })
  const f = await floodBranch(bot, { handler: 'entombed', refusals: 2, yieldTo: () => (taken ? 'drowning' : null) })
  assert.strictEqual(f.preempted, true, JSON.stringify(f.stair))
  assert.strictEqual(f.refusals, 2); assert.strictEqual(f.backoffMs, 0)
  const after = bot.controls.slice(bot._takenAt)
  assert.ok(Number.isInteger(bot._takenAt), 'the takeover was never injected')
  assert.ok(!after.includes('clear') && !after.includes('forward:false'), `it cleared the new owner's controls: ${after}`)
})

const M_SIDE_DIG_YIELD = "      if ((yielded = yieldTo())) return `yielded the body to ${yielded}`   // before any failure is handled (Codex r4)"
const M_FINISH_YIELD = '    if (!yielded) yielded = yieldTo() || null'
await t('MUTANT KILLED: without the ownership checks after the dig and at finish(), an aborted dig clears the new owner', async () => {
  await withMutants(REFLEX_PATH, [[M_SIDE_DIG_YIELD, ''], [M_FINISH_YIELD, '']], async mod => {
    let taken = false
    const bot = makeBot(TOMB(WET_POCKET), { digThrows: (c, b) => { if (!taken) b._takenAt = b.controls.length; taken = true; return true } })
    const f = await mod.floodBranch(bot, { handler: 'entombed', refusals: 2, yieldTo: () => (taken ? 'drowning' : null) })
    assert.ok(!f.preempted || bot.controls.slice(bot._takenAt).includes('clear'), 'the mutant still recognised the takeover and kept its hands off')
  })
})

const M_UNBURY_OWN = "    for (const dy of [1, 0]) {\n      const own = bot.blockAt(bot.entity.position.offset(0, dy, 0))\n      if (own && isFallingBlock(own) && !bodyPassable(own)) return digWithin(own)\n    }"
await t('MUTANT KILLED: a refused overhead dig that blocks the body\'s own unburying', async () => {
  await withMutant(REFLEX_PATH, M_UNBURY_OWN, '', async mod => {
    const w = TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel', '0,3,0': 'water' })
    const bot = makeBot(w)
    const digWithin = async b => { await bot.dig(b); return null }
    const digChecked = async (b, caller) => (mod.targetFloodRisk(bot, b, caller).reason ? { flood: 'refused' } : digWithin(b))
    await mod.unburySelf(bot, { digWithin: mod.unburyDigFor(bot, { digChecked, digWithin }) })
    assert.ok(!bot.digs.some(d => d.cell === '0,1,0'), 'the mutant still dug the head cell')
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
