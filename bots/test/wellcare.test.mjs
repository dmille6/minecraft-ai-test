// THE WELL CLEAN-UP BUNDLE (wellcare-01). Behaviour through the exported pure functions and the real skills on micro-worlds.
//
//   1. minewell-02 on a RAISED well: a plinth recorded the way plinth-02 records it (junkwell-plinth-<home>.json, read by the
//      real knownWellCells) is a shell `mine` never digs. The CHAIN: a bot on the plinth's stand runs `mine` -> every stair
//      from there digs the plinth -> it walks to a clear start and descends; the plinth is intact. The per-dig stop asks
//      wellCellAt (the one well/plinth cell test).
//   2. The well order's vertical reach: wellOutOfReach, and wellOrder holding an order (at no cost) for a bot too far below.
//      The loop chain (a real CognitiveLoop: deep -> no order, climbs -> the order) is in well.test.mjs, beside its town.
//   3. A station never on a well: stationKeepOut, and place() through the real skill -- the table goes off the well's cells
//      (another candidate), an explicit cell on the well is refused with an executable remedy, build_well's own table keeps
//      its plinth-ring cell, and the made-room dig never opens the shell.
// Mutants (anchors asserted present and unique) turn each red.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { V, AIR, STONE } from './helpers/microworld.mjs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-wellcare-${process.pid}`
process.env.BOT_NAME = 'TestBot'
// home 13 east of the scene's wells (as minewell.test.mjs), y 100 so the town's ground band sits above the scene
process.env.HOME_X = '213'; process.env.HOME_Y = '100'; process.env.HOME_Z = '201'
process.env.MEMORY_POOL = 'wellcaretest'
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'wellcare-store-'))
process.env.POOL_STATE_DIR = STORE
const here = path.dirname(fileURLToPath(import.meta.url))
const SKP = path.join(here, '../src/skills.mjs'), WCP = path.join(here, '../src/wellcare.mjs'), WP = path.join(here, '../src/well.mjs')
const S = await import('../src/skills.mjs')
const { SKILLS } = S
const WC = await import('../src/wellcare.mjs')
const W = await import('../src/well.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`) }
}
async function withMutants (file, pairs, fn) {
  let src = fs.readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY (ANCHOR MISSING): ${JSON.stringify(old.slice(0, 70))}`)
    assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = path.join(here, `.mutant-wellcare-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}
const withMutant = (file, old, neu, fn) => withMutants(file, [[old, neu]], fn)
const rowsNow = kind => { try { return fs.readFileSync(`${process.env.LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] } }
// the logger is a write stream: a row is on disk a moment after logEvent returns
const rows = async kind => { await new Promise(r => setTimeout(r, 150)); return rowsNow(kind) }
const key = (x, y, z) => `${x},${y},${z}`

// ---- a RAISED well: plinth-01's shell (k = 4 on a surface t = 63: g = 67), its cap and shaft open, an east stair --------
const PCAP = { x: 200, y: 67, z: 200 }
const STAIR = [[203, 65, 200]]   // a tread outside the 5x5 (ring 3), as board-b's [-247,70,138] beside -247,72,135
const PLINTH_FILE = path.join(STORE, 'junkwell-plinth-213_100_201.json')
const writePlinth = () => fs.writeFileSync(PLINTH_FILE, JSON.stringify({ v: 1, state: 'complete', id: 'p1', world: 'w1', at: Date.now(), by: 'peer',
  plan: { cap: PCAP, steps: [], stair: STAIR }, prev: [], left: 0, stuck: null, doneAt: Date.now(), doneBy: 'peer' }))
const dropPlinth = () => fs.rmSync(PLINTH_FILE, { force: true })
/** The plinth's 81 shell cells (plinth.mjs's layers) + the stair tread. */
const plinthCells = (() => {
  const out = new Set(), g = PCAP.y
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const r = Math.max(Math.abs(dx), Math.abs(dz)), x = PCAP.x + dx, z = PCAP.z + dz
    if (r === 1) out.add(key(x, g, z))                       // g: 3x3 minus the cap
    if (r >= 1) out.add(key(x, g - 1, z))                    // g-1: 5x5 minus the shaft
    out.add(key(x, g - 2, z))                                // g-2: 5x5, the floor included
    if (r >= 1) out.add(key(x, g - 3, z))                    // g-3: 5x5 minus the centre
  }
  for (const [x, y, z] of STAIR) out.add(key(x, y, z))
  return out
})()
const inPlinthBox = p => Math.abs(p.x - PCAP.x) <= 2 && Math.abs(p.z - PCAP.z) <= 2 && p.y >= PCAP.y - 3 && p.y <= PCAP.y
const onStair = p => STAIR.some(([x, y, z]) => p.x === x && p.y === y && p.z === z)

/** A micro-world: stone below y=64, the plinth (cobblestone) and its cap trapdoor; `wellCellsNow` OFF by default, so the
 *  real knownWellCells reads the plinth record from the pool's store. */
function plinthWorld ({ at = new V(200.5, 68, 201.5), yaw = Math.PI, cache = false } = {}) {
  const carved = new Set(), placed = new Map()
  const digs = [], gotos = []
  const raw = p => {
    const k = key(p.x, p.y, p.z)
    if (placed.has(k)) return placed.get(k)
    if (carved.has(k)) return AIR
    if (p.x === PCAP.x && p.z === PCAP.z && p.y === PCAP.y) return { name: 'oak_trapdoor', boundingBox: 'block' }
    if (plinthCells.has(k)) return { name: 'cobblestone', boundingBox: 'block' }
    return p.y < 64 ? STONE : AIR
  }
  const bot = {
    worldId: 'w1', username: 'TestBot',
    entity: { position: at, yaw, onGround: true }, health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...raw(p), position: new V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 100, harvestTools: undefined, material: 'rock', diggable: true }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }, { name: 'crafting_table', count: 1, slot: 20 }] },
    equip: async () => {},
    lookAt: async () => {},
    dig: async b => { digs.push({ x: b.position.x, y: b.position.y, z: b.position.z }); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    placeBlock: async (ref, face) => { const c = ref.position.offset(face.x, face.y, face.z); placed.set(key(c.x, c.y, c.z), { name: 'crafting_table', boundingBox: 'block' }) },
    pathfinder: {
      goto: async goal => {
        gotos.push({ x: goal.x, y: goal.y, z: goal.z })
        const c = new V(goal.x, goal.y, goal.z)
        if (raw(c).boundingBox !== 'empty' || raw(c.offset(0, 1, 0)).boundingBox !== 'empty') return
        bot.entity.position = new V(c.x + 0.5, c.y, c.z + 0.5)
        bot.entity.yaw += 0.9
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    _digs: digs, _gotos: gotos, _placed: placed,
  }
  if (cache) bot.wellCellsNow = () => S.knownWellCells(bot)
  return bot
}
const mine = (mod, bot, y = 50) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal)
const plinthTouched = bot => bot._digs.filter(d => plinthCells.has(key(d.x, d.y, d.z)) || inPlinthBox(d) || onStair(d))

// ======================================================================================================================
// 1. minewell-02 on a raised well
// ======================================================================================================================
await t('PLINTH RECORD -> WELL COLUMN: the real knownWellCells carries the recorded plinth and its stair; wellCellAt is its box + the tread', () => {
  writePlinth()
  const bot = plinthWorld()
  const cols = S.knownWellCells(bot)
  const c = cols.find(x => x.x === PCAP.x && x.y === PCAP.y && x.z === PCAP.z)
  assert.ok(c, `the plinth column is not known: ${JSON.stringify(cols)}`)
  assert.deepEqual(c.stair, STAIR)
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let y = 62; y <= 70; y++) {
    const p = { x: PCAP.x + dx, y, z: PCAP.z + dz }
    assert.equal(S.wellCellAt(bot, p), inPlinthBox(p) || onStair(p), JSON.stringify(p))
  }
  for (const k of plinthCells) { const [x, y, z] = k.split(',').map(Number); assert.equal(S.wellCellAt(bot, { x, y, z }), true, `plinth cell ${k}`) }
  dropPlinth()
  assert.equal(S.wellCellAt(plinthWorld(), { x: 200, y: 66, z: 201 }), false, 'positive control: no record, no column')
})
await t('THE CHAIN (real mine, raised well): a bot on the plinth\'s stand -> walks off to a clear start -> descends; no plinth cell, box cell or stair dug', async () => {
  writePlinth()
  const bot = plinthWorld()
  const n0 = (await rows('_mine_well_guard')).length
  const r = await mine({ SKILLS }, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.ok(bot._digs.length > 10, 'positive control: it dug a stair')
  assert.deepEqual(plinthTouched(bot), [], 'dug the plinth')
  assert.ok(bot._gotos.length >= 1, 'it walked off first')
  const g = (await rows('_mine_well_guard')).slice(n0).map(x => x.skill.detail)
  assert.ok(g.some(d => /^action=relocate at=200,67,200 from=200,68,201 to=/.test(d)), JSON.stringify(g))
  dropPlinth()
})
await t('THE CHAIN, the movement cache path (index.mjs bot.wellCellsNow over knownWellCells): the same walk-off, the plinth intact', async () => {
  writePlinth()
  const bot = plinthWorld({ cache: true })
  const r = await mine({ SKILLS }, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.deepEqual(plinthTouched(bot), [])
  dropPlinth()
})
await t('BESIDE THE PLINTH on the ground (ring 3, west; home\'s floor guard is east): mine starts on a clear bearing -- never through the shell', async () => {
  writePlinth()
  const bot = plinthWorld({ at: new V(197.5, 64, 201.5), yaw: -Math.PI / 2 })
  const r = await mine({ SKILLS }, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.deepEqual(plinthTouched(bot), [])
  dropPlinth()
})
await t('POSITIVE CONTROL: no plinth record -> the same stand\'s stair digs straight into the plinth (the defect this fixes)', async () => {
  dropPlinth()
  const bot = plinthWorld()
  await mine({ SKILLS }, bot)
  assert.ok(plinthTouched(bot).length > 0, 'the instrument cannot see a plinth dig')
})
await t('MUTANT (skills): knownWellCells without the plinth columns -> mine digs the plinth', async () => {
  writePlinth()
  await withMutant(SKP, '  for (const p of knownPlinthColumns(bot)) {\n', '  for (const p of []) {\n', async m => {
    const bot = plinthWorld()
    await mine(m, bot)
    assert.ok(plinthTouched(bot).length > 0, 'mutant inert')
  })
  dropPlinth()
})
await t('MUTANT (skills): the per-dig stop without wellCellAt and no plan -> the stair from the stand digs the plinth', async () => {
  writePlinth()
  await withMutants(SKP, [["      const inShell = wellCellAt(bot, pos)\n", "      const inShell = false\n"], ["  let wellPlan = planHere()\n", "  let wellPlan = { action: 'go', bearings: stairBearings(bot) }\n"]], async m => {
    const bot = plinthWorld()
    await mine(m, bot)
    assert.ok(plinthTouched(bot).length > 0, 'mutant inert')
  })
  dropPlinth()
})
await t('THE PER-DIG STOP IS wellCellAt: with the plan disabled, the stair from the stand stops at the plinth (nothing of it dug)', async () => {
  writePlinth()
  await withMutant(SKP, "  let wellPlan = planHere()\n", "  let wellPlan = { action: 'go', bearings: stairBearings(bot) }\n", async m => {
    const bot = plinthWorld()
    const r = await mine(m, bot)
    assert.equal(r.status, 'failed', `${r.status}: ${r.detail}`); assert.match(r.detail, /junk well's shell \(200,67,200\)/)
    assert.deepEqual(plinthTouched(bot), [])
  })
  dropPlinth()
})
await t('MONUMENT-01\'S INTERFACE KEPT: composeKeepOut is variadic and planMineStart still takes forbid/forbidBottom/far and returns kinds', async () => {
  const MW = await import('../src/minewell.mjs')
  const a = { forbid: c => (c.x === 1 ? 'farm' : null), bottom: 0 }, b = { forbid: c => (c.x === 2 ? 'monument' : null), bottom: -5 }, c = { forbid: c => (c.x === 3 ? 'town' : null), bottom: 10 }
  const k = MW.composeKeepOut(a, b, c)
  assert.equal(k.forbid({ x: 3, y: 0, z: 0 }), 'town', 'a third part is not dropped'); assert.equal(k.forbid({ x: 2, y: 0, z: 0 }), 'monument'); assert.equal(k.bottom, -5)
  const p = MW.planMineStart({ cols: [], p0: { x: 0, y: 64, z: 0 }, bearings: [{ x: 1, z: 0 }], standable: () => false, forbid: k.forbid, forbidBottom: k.bottom, far: () => [] })
  assert.ok(['go', 'refuse', 'relocate'].includes(p.action)); assert.ok(Array.isArray(p.kinds ?? []))
})

// ======================================================================================================================
// 2. the well order's vertical reach
// ======================================================================================================================
await t('wellOutOfReach: more than 12 below the stand is out of reach; 12 is in; above is in; an unknown height is never a refusal', () => {
  assert.equal(WC.WELL_REACH_BELOW, 12)
  assert.equal(WC.wellOutOfReach({ feetY: 62, standY: 74 }), null, '12 below: in reach')
  assert.deepEqual(WC.wellOutOfReach({ feetY: 61.5, standY: 74 }), { below: 12.5, standY: 74, feetY: 61.5, limit: 12 })
  assert.equal(WC.wellOutOfReach({ feetY: 33, standY: 74 }).below, 41, 'board-c-Alpha 10-17 04:11Z (y 33 under the 365,74,136 stand)')
  assert.equal(WC.wellOutOfReach({ feetY: 90, standY: 74 }), null, 'above the stand')
  for (const bad of [{ feetY: null, standY: 74 }, { feetY: 40, standY: null }, { feetY: NaN, standY: 74 }, {}]) assert.equal(WC.wellOutOfReach(bad), null, JSON.stringify(bad))
  assert.match(WC.wellDeepDetail({ skill: 'dispose_well', below: 19, standY: 74, feetY: 55, limit: 12 }), /^order=dispose below=19 stand_y=74 feet_y=55 limit=12 remedy=surface action=hold$/)
  assert.match(WC.wellDeepDetail({ skill: 'build_well', below: 20, standY: 90, feetY: 70, limit: 12 }), /^order=build .* remedy=walk_up action=hold$/, 'above sea level surface refuses')
})
const AT_TOWN = { now: 1e9, slots: 36, freeSlots: 0, junkStacks: 3, distHome: 5, well: () => ({ open: false, attended: false, breached: false }) }
await t('wellOrder HOLDS a deep bot\'s order at no cost: no order, `held` names it, no cooldown charged -> the first decision in reach gets it', () => {
  const surface = W.wellOrder({ ...AT_TOWN, depth: () => null })
  assert.equal(surface.order?.skill, 'dispose_well', 'positive control: at the surface the order is given')
  const deep = W.wellOrder({ ...AT_TOWN, depth: () => WC.wellOutOfReach({ feetY: 50, standY: 74 }) })
  assert.equal(deep.order, null); assert.equal(deep.held.skill, 'dispose_well'); assert.equal(deep.held.below, 24)
  assert.equal(deep.state.lastDisposeAt, undefined, 'a held order charged the dispose cooldown')
  assert.equal(deep.state.lastScanAt, AT_TOWN.now, 'the scan stamp is kept (no scan every decision)')
  const later = W.wellOrder({ ...AT_TOWN, now: AT_TOWN.now + W.WELL_SCAN_MS, state: deep.state, depth: () => null })
  assert.equal(later.order?.skill, 'dispose_well', 'in reach after the climb: given at once')
  // the build order and the close order are held the same way
  const build = W.wellOrder({ ...AT_TOWN, slots: 10, freeSlots: 26, junkStacks: 0, well: () => null, buildPlan: () => ({ slotsNeeded: 3, carried: true, wood: 0 }), myName: 'a', peers: [], depth: () => WC.wellOutOfReach({ feetY: 40, standY: 74 }) })
  assert.equal(build.order, null); assert.equal(build.held.skill, 'build_well'); assert.equal(build.state.lastBuildAt, undefined)
  const close = W.wellOrder({ ...AT_TOWN, well: () => ({ open: true, attended: false, breached: false }), depth: () => WC.wellOutOfReach({ feetY: 40, standY: 74 }) })
  assert.equal(close.order, null); assert.equal(close.held.skill, 'close_well')
  // no depth reader (another caller): unchanged
  assert.equal(W.wellOrder(AT_TOWN).order?.skill, 'dispose_well')
})
await t('the depth reader is asked only when an order would be given (the cheap reads first)', () => {
  let asked = 0
  W.wellOrder({ ...AT_TOWN, junkStacks: 0, slots: 10, well: () => ({ open: false, attended: false, breached: false }), depth: () => { asked++; return null } })
  W.wellOrder({ ...AT_TOWN, distHome: 99, depth: () => { asked++; return null } })
  assert.equal(asked, 0)
  W.wellOrder({ ...AT_TOWN, depth: () => { asked++; return null } })
  assert.equal(asked, 1, 'positive control')
})
await t('townWellStandY BY ORDER: the recorded plinth\'s cap + 1 when the town has no built well (each order kind); null with nothing known', () => {
  writePlinth()
  for (const k of ['dispose_well', 'build_well', 'close_well']) assert.equal(S.townWellStandY(plinthWorld(), k), PCAP.y + 1, k)
  dropPlinth()
  assert.equal(S.townWellStandY(plinthWorld()), null)
})
await t('MUTANT (well): the hold removed -> the deep bot is ordered to dispose', async () => {
  await withMutant(WP, '  if (!deep) return r\n', '  return r\n', async m => {
    assert.equal(m.wellOrder({ ...AT_TOWN, depth: () => WC.wellOutOfReach({ feetY: 50, standY: 74 }) }).order?.skill, 'dispose_well', 'mutant inert')
  })
})
await t('MUTANT (well): a held order that charges the cooldown -> the climb does not get the order', async () => {
  await withMutant(WP, "  return { order: null, state: { ...(args.state ?? {}), lastScanAt: r.state.lastScanAt }, held: { skill: r.order.skill, ...deep } }", "  return { order: null, state: r.state, held: { skill: r.order.skill, ...deep } }", async m => {
    const deep = m.wellOrder({ ...AT_TOWN, depth: () => WC.wellOutOfReach({ feetY: 50, standY: 74 }) })
    assert.equal(m.wellOrder({ ...AT_TOWN, now: AT_TOWN.now + W.WELL_SCAN_MS, state: deep.state, depth: () => null }).order, null, 'mutant inert')
  })
})
await t('MUTANT (wellcare): the limit compared the wrong way -> an in-reach bot is held', async () => {
  await withMutant(WCP, '  if (!(below > limit)) return null\n', '  if (below > limit) return null\n', async m => {
    assert.ok(m.wellOutOfReach({ feetY: 72, standY: 74 }), 'mutant inert')
  })
})

// ======================================================================================================================
// 3. a station never on a well
// ======================================================================================================================
const FCAP = { x: 100, y: 63, z: 100 }   // a dug (flat) well: cap at ground level, stands at 64
await t('stationKeepOut: the shaft, the four stands (feet and head), a plinth stair\'s headroom, the shell; never the rest', () => {
  const k = (c, shell = false, cols = [FCAP]) => WC.stationKeepOut(cols, c, { shell })
  for (let y = 61; y <= 66; y++) assert.equal(k({ x: 100, y, z: 100 }), 'shaft', `column ${y}`)
  assert.equal(k({ x: 100, y: 67, z: 100 }), null, 'above +3 the column is free')
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const y of [64, 65]) assert.equal(k({ x: 100 + dx, y, z: 100 + dz }), 'stand', `${dx},${y},${dz}`)
  assert.equal(k({ x: 101, y: 64, z: 101 }), null, 'a diagonal is not a stand')
  assert.equal(k({ x: 101, y: 66, z: 100 }), null, 'above a stand\'s head')
  const plinth = [{ ...PCAP, stair: STAIR }]
  assert.equal(k({ x: 203, y: 66, z: 200 }, false, plinth), 'stair'); assert.equal(k({ x: 203, y: 67, z: 200 }, false, plinth), 'stair')
  assert.equal(k({ x: 203, y: 68, z: 200 }, false, plinth), null)
  assert.equal(k({ x: 102, y: 63, z: 102 }, true), 'well', 'the shell answer is the caller\'s (wellCellAt)')
  assert.equal(k({ x: 102, y: 63, z: 102 }, null), 'unknown', 'unreadable cells: refused')
  assert.equal(k({ x: 105, y: 64, z: 100 }), null)
  assert.equal(WC.stationKeepOut([], { x: 100, y: 64, z: 100 }), null, 'no well known: nothing kept out')
  // THE BUILDER'S OWN TABLE: the outer ring of its own box, never its 3x3, never a stand or the shaft
  assert.equal(WC.stationKeepOut(plinth, { x: 200, y: 67, z: 202 }, { shell: false, own: PCAP }), null)
  assert.equal(WC.stationKeepOut(plinth, { x: 201, y: 67, z: 201 }, { shell: false, own: PCAP }), 'well')
  assert.equal(WC.stationKeepOut(plinth, { x: 200, y: 68, z: 201 }, { shell: false, own: PCAP }), 'stand')
})
await t('stationRefusalAt (the bot\'s cells): plinth-02\'s board-c table cell is the builder\'s only; any other caller is refused there', () => {
  writePlinth()
  const bot = plinthWorld()
  assert.equal(S.stationRefusalAt(bot, { x: 200, y: 67, z: 202 }), 'well', 'the ring top is in the shell box (wellCellAt)')
  assert.equal(S.stationRefusalAt(bot, { x: 200, y: 67, z: 202 }, { own: PCAP }), null, 'build_well\'s own table there (365,73,135 on board-c)')
  assert.equal(S.stationRefusalAt(bot, { x: 200, y: 68, z: 199 }, { own: PCAP }), 'stand')
  assert.equal(S.stationRefusalAt(bot, { x: 205, y: 64, z: 205 }), null, 'positive control: off the well')
  dropPlinth()
})

/** A flat dug well's town: grass at 63 (stone below), the cap trapdoor at 100,63,100 over an open shaft, the bot on its south
 *  stand. Cobblestone at 64 fills every cell around the bot except the well's own (stands, column) and one diagonal: the
 *  base's candidate order then reaches a well cell before the free one. */
function flatTown ({ at = new V(100.5, 64, 101.5), freeCell = { x: 101, y: 64, z: 102 } } = {}) {
  const placed = new Map(), dug = []
  // the well's own cells stay open at feet AND head height (64, 65); everything else around is two blocks of cobble
  const keep = new Set([key(freeCell.x, freeCell.y, freeCell.z)])
  for (const y of [64, 65]) for (const [x, z] of [[100, 100], [101, 100], [99, 100], [100, 99], [100, 101]]) keep.add(key(x, y, z))
  const raw = p => {
    const k = key(p.x, p.y, p.z)
    if (placed.has(k)) return placed.get(k)
    if (p.x === FCAP.x && p.z === FCAP.z && p.y === FCAP.y) return { name: 'oak_trapdoor', boundingBox: 'block' }
    if (p.x === FCAP.x && p.z === FCAP.z && (p.y === 62)) return AIR
    if ((p.y === 64 || p.y === 65) && Math.abs(p.x - 100) <= 3 && Math.abs(p.z - 101) <= 3 && !keep.has(k)) return { name: 'cobblestone', boundingBox: 'block' }
    if (p.y === 63) return { name: 'grass_block', boundingBox: 'block' }
    return p.y < 63 ? STONE : AIR
  }
  const bot = {
    worldId: 'w1', username: 'TestBot',
    entity: { position: at, yaw: 0, onGround: true }, health: 20, food: 20, heldItem: null,
    blockAt: p => { const q = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; return { ...raw(q), position: new V(q.x, q.y, q.z), diggable: true } },
    inventory: { items: () => [{ name: 'crafting_table', count: 1, slot: 20 }] },
    equip: async () => {}, lookAt: async () => {},
    dig: async b => { dug.push(key(b.position.x, b.position.y, b.position.z)) },
    placeBlock: async (ref, face) => { const c = ref.position.offset(face.x, face.y, face.z); placed.set(key(c.x, c.y, c.z), { name: 'crafting_table', boundingBox: 'block' }) },
    wellCellsNow: () => [FCAP],
    _placed: placed, _dug: dug,
  }
  return bot
}
const place = (mod, bot, args = { item: 'crafting_table' }) => mod.SKILLS.place.run({ bot }, args, new AbortController().signal)
const wellSpots = bot => [...bot._placed.keys()].filter(k => { const [x, y, z] = k.split(',').map(Number); return WC.stationKeepOut([FCAP], { x, y, z }, { shell: W.wellBreakCost([FCAP], { position: { x, y, z } }) > 0 }) })
await t('THE CHAIN (real place, a town craft on the stand): the table goes on the free diagonal, never the cap column or another stand; one _station_well row', async () => {
  const bot = flatTown()
  const n0 = (await rows('_station_well')).length
  const r = await place({ SKILLS }, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.deepEqual([...bot._placed.keys()], ['101,64,102'], 'the free cell off the well')
  assert.deepEqual(wellSpots(bot), [])
  const g = (await rows('_station_well')).slice(n0).map(x => x.skill.detail)
  assert.equal(g.length, 1); assert.match(g[0], /^action=skip item=crafting_table kind=(shaft|stand) n=\d+ by=-$/)
  const near = (await rows('_station_placed')).pop()
  assert.match(near.skill.detail, /^item=crafting_table at=101,64,102 cap=100,63,100 keep=none own=0 by=-$/)
})
await t('POSITIVE CONTROL / MUTANT (skills): no well test in the scan nor at the placement -> the base puts the table on the well (its cap column or a stand)', async () => {
  await withMutants(SKP, [["  const wellRefused = p => { const k = stationRefusalAt(bot, p); if (k) { wellSkip.n++; wellSkip.kind ??= k } return !!k }", "  const wellRefused = p => false"],
                          ["        if (wk) { wellRow('late', wk, 1, tgt); failures.push(`${tgt} is the town junk well's ${wk}: step 3+ blocks away from the well and place again`); continue } }", "      }"]], async m => {
    const bot = flatTown()
    const r = await place(m, bot)
    assert.equal(r.status, 'success')
    assert.ok(wellSpots(bot).length === 1, `mutant inert: placed at ${[...bot._placed.keys()]}`)
  })
})
await t('A WELL LEARNED DURING THE EQUIP (Codex r4 P2): the cells are read again right before the placement -- the table never lands on the now-known well', async () => {
  let known = []
  const bot = flatTown()
  bot.wellCellsNow = () => known
  bot.equip = async () => { known = [FCAP] }
  const r = await place({ SKILLS }, bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(wellSpots(bot), [], `placed on the well: ${[...bot._placed.keys()]}`)
  assert.match((await rows('_station_well')).pop().skill.detail, /^action=late item=crafting_table kind=(shaft|stand) n=1 at=/)
})
await t('MUTANT (skills): without the last read the table lands on the well learned during the equip', async () => {
  await withMutant(SKP, "        if (wk) { wellRow('late', wk, 1, tgt); failures.push(`${tgt} is the town junk well's ${wk}: step 3+ blocks away from the well and place again`); continue } }", "      }", async m => {
    let known = []
    const bot = flatTown()
    bot.wellCellsNow = () => known
    bot.equip = async () => { known = [FCAP] }
    await place(m, bot)
    assert.equal(wellSpots(bot).length, 1, `mutant inert: ${[...bot._placed.keys()]}`)
  })
})
await t('EVERY FREE CELL IS THE WELL\'S: the scan refuses them all, the made-room dig never opens a wall, and the refusal names the step away', async () => {
  const bot = flatTown({ freeCell: { x: 100, y: 64, z: 100 } })   // the "free" cell is the cap column itself
  const r = await place({ SKILLS }, bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'no_space')
  assert.match(r.detail, /the town junk well's (shaft|stand): step 3\+ blocks away from the well and place again/, r.detail)
  assert.equal(bot._placed.size, 0)
  for (const k of bot._dug) { const [x, y, z] = k.split(',').map(Number); assert.equal(S.stationRefusalAt(bot, { x, y, z }), null, `dug the well's ${k}`) }
  // the remedy, performed: three blocks south of the stand the same place lands
  const away = flatTown({ at: new V(100.5, 64, 105.5) })
  const r2 = await place({ SKILLS }, away)
  assert.equal(r2.status, 'success', r2.detail); assert.deepEqual(wellSpots(away), [])
})
await t('EXPLICIT COORDINATES: a stand or the cap column is refused with the move that works; a cell off the well is placed', async () => {
  const bot = flatTown()
  for (const c of [{ x: 101, y: 64, z: 100 }, { x: 100, y: 64, z: 100 }]) {
    const r = await place({ SKILLS }, bot, { item: 'crafting_table', ...c })
    assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'no_space')
    assert.match(r.detail, /the town junk well's (stand|shaft) -- place crafting_table at least 3 blocks from the well's column \(or give no coordinates/)
  }
  assert.equal(bot._placed.size, 0)
  const ok = await place({ SKILLS }, bot, { item: 'crafting_table', x: 101, y: 64, z: 102 })
  assert.equal(ok.status, 'success', ok.detail)
  assert.match((await rows('_station_well')).pop().skill.detail, /^action=refuse item=crafting_table kind=shaft n=1 at=100,64,100 by=-$/)
})
await t('BUILD_WELL\'S OWN TABLE (plinth-02 wellTableCell): its plinth-ring cell is kept for the builder only; a stand never', async () => {
  writePlinth()
  const bot = plinthWorld({ at: new V(200.5, 68, 201.5) })
  const place4 = (args, opts) => S.SKILLS.place.run({ bot }, args, new AbortController().signal, opts)
  // the registry's run passes three arguments: the model's `place` can never claim the exemption
  const plain = await place4({ item: 'crafting_table', x: 200, y: 67, z: 202 })
  assert.equal(plain.status, 'failed'); assert.match(plain.detail, /the town junk well's well/)
  const own = await place4({ item: 'crafting_table', x: 200, y: 67, z: 202 }, { wellOwn: PCAP, by: 'build_well' })
  assert.equal(own.status, 'success', own.detail)
  assert.match((await rows('_station_placed')).pop().skill.detail, /^item=crafting_table at=200,67,202 cap=200,67,200 keep=none own=1 by=build_well$/)
  const stand = await place4({ item: 'crafting_table', x: 199, y: 68, z: 200 }, { wellOwn: PCAP, by: 'build_well' })
  assert.equal(stand.status, 'failed'); assert.match(stand.detail, /stand/)
  dropPlinth()
})
await t('THE TABLE CELL CHOOSER skips a forbidden cell: composter tableCellFor takes another (plinth wellTableCell passes the same forbid to it)', async () => {
  const { tableCellFor } = await import('../src/composter.mjs')
  const flat = (x, y, z) => (y < 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  const first = tableCellFor({ site: { x: 0, y: 64, z: 0 }, stand: { x: 0, y: 64, z: 1 }, read: flat })
  assert.ok(first)
  const second = tableCellFor({ site: { x: 0, y: 64, z: 0 }, stand: { x: 0, y: 64, z: 1 }, read: flat, forbid: c => c.x === first.x && c.y === first.y && c.z === first.z })
  assert.ok(second && (second.x !== first.x || second.z !== first.z), 'the forbid gave the same cell')
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
try { fs.rmSync(STORE, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
