// TOPDOWN-01 (topdown.mjs + skills.mjs gather; owner 2026-11-15 "Yes, authorize"): gather takes ground only FROM THE TOP.
// WHY: bots gathered dirt from under the grass and left roofed hollows -- 3,103 columns under the showcase lawn, a ring of
// 488 undermined columns just outside the town square on the rehearsal world (docs/reports/land-eval-2026-11-14/dirt-loop.md
// on main). The rule is pure and tested as such; the refusal chain is driven through the REAL gather skill over a fake world
// of named, layered cells (gatherzone.test.mjs's harness, adapted: grass_block over dirt over stone).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
// home far away: neither the town's ground (townground.mjs) nor the clean zone (cleanzone.mjs) reaches this test's world
process.env.HOME_X = '3000'; process.env.HOME_Y = '65'; process.env.HOME_Z = '3000'

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const TD = await import('../src/topdown.mjs')
const CZ = await import('../src/cleanzone.mjs')
const LG = await import('../src/logger.mjs')
const SK = await import('../src/skills.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.message).slice(0, 600)}`) } }
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const TOPDOWN_URL = new URL('../src/topdown.mjs', import.meta.url)

const rows = []
LG.tapRecords(r => rows.push(r))
const rowsOf = kind => rows.filter(r => r?.skill?.name === `_${kind}`)

// gatherzone.test.mjs's helper: every anchor present and unique, or the test fails (a mutant that did not apply is not "killed")
function mutantSource (url, pairs) {
  let src = readFileSync(url, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
    assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  return src.replace(/from '\.\//g, "from '../src/")
}
async function withMutantsAll (url, pairs, fn) {
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, mutantSource(url, pairs))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// a mutant of topdown.mjs, and the real skills.mjs wired to it
async function withTopdownMutant (pairs, fn) {
  const tdOut = new URL(`./_mutant-td-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(tdOut, mutantSource(TOPDOWN_URL, pairs))
  try {
    const name = tdOut.pathname.split('/').pop()
    const TDm = await import(tdOut.href)
    return await withMutantsAll(SKILLS_URL, [["from './topdown.mjs'   // topdown-01", `from '../test/${name}'   // topdown-01`]], SKm => fn(TDm, SKm))
  } finally { try { unlinkSync(tdOut) } catch {} }
}
// the three conjuncts in skills.mjs, and the trap exception
const ENUM = ['      if (b.position && searchFrom && b.position.distanceTo(searchFrom) <= maxDistance && topDownHit(bot, b.position, b.name)) { roofSkipped++; return false }', '      if (false) { roofSkipped++; return false }']
const SAFE = ['      !topDownHit(bot, p, bot.blockAt(p)?.name) &&', '      true &&']
const SWING = ['  if (topDownHit(bot, block.position, block.name)) {\n', '  if (false) {\n']
const TRAP = ['topDownRefuses(roofAt(bot), p, name) && !gatherTrapAllows(bot?.gatherTrap, p, Date.now())', 'topDownRefuses(roofAt(bot), p, name)']
// the two deep cases and the leaves exception in topdown.mjs
const DEEP_STRAIGHT = ["  if (n >= T.deep) return 'deep'\n", '']
const DEEP_FLOOR = ["    return t >= T.deep ? 'deep' : 'roofed'", "    return 'roofed'"]
const LEAVES = [" && !LEAVES.test(String(b.name ?? ''))", '']

// ---- pure ------------------------------------------------------------------------------------------------------------
const solidSet = cells => { const s = new Set(cells.map(c => c.join(','))); return (x, y, z) => s.has(`${x},${y},${z}`) }
const col = (x, z, y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) out.push([x, y, z]); return out }
const P = { x: 0, y: 60, z: 0 }
const blockNamed = name => name ? { name, boundingBox: mcData.blocksByName[name].boundingBox } : null
const roofOf = (isRoof, byY) => (x, y, z) => x === 0 && z === 0 && isRoof(blockNamed(byY[y]))

await t('COVER: nothing above -> open; one block straight above -> roofed; the floor of a shallow hollow -> roofed', () => {
  assert.equal(TD.coverOf(solidSet([]), P), 'open')
  assert.equal(TD.coverOf(solidSet([[0, 61, 0]]), P), 'roofed', 'the dirt under the grass')
  assert.equal(TD.coverOf(solidSet(col(0, 0, 61, 63)), P), 'roofed', 'three under')
  assert.equal(TD.coverOf(solidSet([[0, 63, 0]]), P), 'roofed', 'the floor of a hollow: two air, then the grass left standing')
  assert.equal(TD.coverOf(solidSet([[0, 60 + 1 + TD.TOPDOWN.air, 0]]), P), 'roofed', 'a roof at the edge of the look-up')
  assert.equal(TD.coverOf(solidSet([[0, 60 + 2 + TD.TOPDOWN.air, 0]]), P), 'open', 'beyond it: open (a tall overhang far above is sky)')
  assert.equal(TD.coverOf(solidSet([[1, 61, 0], [0, 61, 1]]), P), 'open', 'only the column straight above counts')
})
await t('COVER: 8 solid straight above -> deep (a mine); 7 -> roofed; the floor of a cave under an 8-thick roof -> deep, 7-thick -> roofed', () => {
  assert.equal(TD.TOPDOWN.deep, 8)
  assert.equal(TD.coverOf(solidSet(col(0, 0, 61, 68)), P), 'deep')
  assert.equal(TD.coverOf(solidSet(col(0, 0, 61, 67)), P), 'roofed')
  assert.equal(TD.coverOf(solidSet(col(0, 0, 63, 70)), P), 'deep', 'cave floor: two air, an 8-thick roof')
  assert.equal(TD.coverOf(solidSet(col(0, 0, 63, 69)), P), 'roofed', 'a 7-thick roof is near the surface')
  assert.equal(TD.coverOf(solidSet(col(0, 0, 61, 63).concat(col(0, 0, 66, 90))), P), 'roofed', 'three solid then a gap: roofed, whatever lies past the gap (the rule as written)')
})
await t('ROOF: leaves are not a roof (ground under a canopy is open); a log is; an unread cell is not; a block with no collision is not', () => {
  assert.equal(TD.isRoofBlock(blockNamed('oak_leaves')), false)
  assert.equal(TD.isRoofBlock(blockNamed('spruce_leaves')), false)
  assert.equal(TD.isRoofBlock(blockNamed('oak_log')), true)
  assert.equal(TD.isRoofBlock(blockNamed('grass_block')), true)
  assert.equal(TD.isRoofBlock(null), false, 'unread: fails open')
  for (const n of ['air', 'water', 'short_grass', 'snow', 'torch']) assert.equal(TD.isRoofBlock(blockNamed(n)), false, n)
  assert.equal(TD.coverOf(roofOf(TD.isRoofBlock, { 64: 'oak_leaves', 65: 'oak_leaves', 66: 'oak_leaves' }), P), 'open', 'canopy over the ground')
  assert.equal(TD.coverOf(roofOf(TD.isRoofBlock, { 61: 'oak_log' }), P), 'roofed', 'a trunk on the dirt')
})
await t('REFUSES only terrain under a roof: never an ore, a log, leaves or a crop; never open or deep ground', () => {
  const roof = solidSet([[0, 61, 0]])
  for (const n of ['dirt', 'grass_block', 'stone', 'sand', 'gravel', 'coarse_dirt', 'deepslate', 'clay']) assert.equal(TD.topDownRefuses(roof, P, n), true, n)
  for (const n of ['iron_ore', 'coal_ore', 'deepslate_iron_ore', 'oak_log', 'oak_leaves', 'wheat', 'sugar_cane', 'crafting_table']) assert.equal(TD.topDownRefuses(roof, P, n), false, n)
  assert.equal(TD.topDownRefuses(solidSet([]), P, 'dirt'), false, 'open')
  assert.equal(TD.topDownRefuses(solidSet(col(0, 0, 61, 70)), P, 'stone'), false, 'deep')
  assert.equal(TD.topDownRefuses(roof, null, 'dirt'), false)
})
await t('COST: at most 1 + air + deep reads per candidate; an open cell costs 1 + air', () => {
  let n = 0
  const counting = s => (x, y, z) => { n++; return s(x, y, z) }
  TD.coverOf(counting(solidSet([])), P); assert.equal(n, 1 + TD.TOPDOWN.air, 'open'); n = 0
  TD.coverOf(counting(solidSet([[0, 61, 0]])), P); assert.equal(n, 2, 'the dirt under the grass: two reads'); n = 0
  TD.coverOf(counting(solidSet(col(0, 0, 61, 90))), P); assert.equal(n, TD.TOPDOWN.deep, 'deep straight above'); n = 0
  TD.coverOf(counting(solidSet(col(0, 0, 60 + 1 + TD.TOPDOWN.air, 120))), P); assert.ok(n <= 1 + TD.TOPDOWN.air + TD.TOPDOWN.deep, `worst case ${n}`)
})
await t('SWITCH, ROW and WORDS: TOPDOWN=off turns it off; the remedy names what a bot can do (gather where it lies open, `mine`)', () => {
  for (const v of ['off', '0', 'false', 'no', 'OFF', ' off ']) assert.equal(TD.topDownOn({ TOPDOWN: v }), false, v)
  for (const v of [undefined, '', '1', 'on']) assert.equal(TD.topDownOn({ TOPDOWN: v }), true, String(v))
  assert.equal(TD.topDownModeDetail({}), 'op=mode on=1 deep=8 air=16')
  assert.equal(TD.topDownModeDetail({ TOPDOWN: 'off' }), 'op=mode on=0 deep=8 air=16')
  const r = TD.topDownRemedy('dirt', 12, 32)
  assert.match(r, /^no dirt open to the sky within 32 blocks \(12 under a roof/)
  assert.match(r, /gather where it lies open/); assert.match(r, /`mine`/)
  assert.match(TD.topDownRemedy('dirt', 1, 0), /^no dirt open to the sky here \(/, 'the swing\'s refusal (no search distance) says "here", not "within 0 blocks"')
})
await t('MUTANTS KILLED (topdown.mjs): without either deep case a mine is "roofed"; without the leaves exception a canopy is a roof', async () => {
  await withTopdownMutant([DEEP_STRAIGHT], async M => {
    assert.equal(M.coverOf(solidSet(col(0, 0, 61, 68)), P), 'roofed')
  })
  await withTopdownMutant([DEEP_FLOOR], async M => {
    assert.equal(M.coverOf(solidSet(col(0, 0, 63, 70)), P), 'roofed')
  })
  await withTopdownMutant([LEAVES], async M => {
    assert.equal(M.isRoofBlock(blockNamed('oak_leaves')), true)
    assert.equal(M.coverOf(roofOf(M.isRoofBlock, { 64: 'oak_leaves' }), P), 'roofed')
  })
})

// ---- the refusal chain through the REAL gather -----------------------------------------------------------------------
// A world of NAMED cells (key -> block name; air elsewhere). findBlocks behaves like mineflayer's: a palette pre-check with no
// position for every kind present, then the matcher per cell, asked BEFORE the distance test (blocks.js), from the floored
// position. A dig records what lay over the cell at that moment.
const key = (x, y, z) => `${x},${y},${z}`
function openAbove (cells, x, y, z) {
  for (let yy = y + 1; yy <= y + 60; yy++) { const n = cells.get(key(x, yy, z)); if (n && TD.isRoofBlock(blockNamed(n))) return false }
  return true
}
function gatherWorld ({ cells, at = [100.5, 64, 100.5], items = [] }) {
  const digs = []
  const blk = (x, y, z) => {
    const name = cells.get(key(x, y, z)) ?? 'air'
    const t = mcData.blocksByName[name]
    return { name, type: t.id, position: new Vec3(x, y, z), boundingBox: t.boundingBox, diggable: name !== 'air',
             canHarvest: () => true, digTime: () => 50, material: t.material, hardness: name === 'air' ? 0 : (t.hardness ?? 1) }
  }
  const bot = {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => items, emptySlotCount: () => 30 },
    // `items` too, as mineflayer's registry has it: drops.mjs reads drop ids through it (without it no block yields dirt)
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName, items: mcData.items },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && (Array.isArray(matching) ? matching.includes(b.type) : b.type === matching))
      const kinds = new Set(cells.values())
      if (![...kinds].some(n => fn({ type: mcData.blocksByName[n].id, name: n }))) return []
      const from = bot.entity.position.floored()
      const out = []
      for (const k of cells.keys()) {
        const b = blk(...k.split(',').map(Number))
        if (fn(b) && b.position.distanceTo(from) <= maxDistance) out.push(b.position)
      }
      return out.sort((a, b) => a.distanceTo(from) - b.distanceTo(from)).slice(0, count)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: { scafoldingBlocks: [mcData.itemsByName.dirt.id, mcData.itemsByName.cobblestone.id] }, setMovements () {}, stop () {}, isMining: () => false, setGoal () {}, async goto () {} },
    nearestEntity: () => null, entities: {},
    async dig (b) {
      const { x, y, z } = b.position
      digs.push({ x, y, z, name: cells.get(key(x, y, z)), open: openAbove(cells, x, y, z), straight: TD.isRoofBlock(blockNamed(cells.get(key(x, y + 1, z)))) })
      cells.delete(key(x, y, z))
    },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  return { bot, digs }
}
// A plain: stone, then `dirt` layers, then the cap (grass_block) at `top`, over [x0..x1] x [z0..z1]
function plain ({ x0 = 92, x1 = 108, z0 = 92, z1 = 108, top = 63, dirt = 3, floor = 58, cap = 'grass_block', capAt = null } = {}) {
  const cells = new Map()
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    for (let y = floor; y < top - dirt; y++) cells.set(key(x, y, z), 'stone')
    for (let y = top - dirt; y < top; y++) cells.set(key(x, y, z), 'dirt')
    cells.set(key(x, top, z), capAt?.(x, z) ?? cap)
  }
  return cells
}
// a trench along x = 101 down to the stone: the dirt either side is EXPOSED from the side and roofed by the grass
function trench (cells, x = 101, top = 63, bottom = 60) {
  for (const k of [...cells.keys()]) { const [cx, cy] = k.split(',').map(Number); if (cx === x && cy >= bottom && cy <= top) cells.delete(k) }
  return cells
}
const run = (mod, bot, args = { block: 'dirt', count: 1 }) => mod.SKILLS.gather.run({ bot }, args, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
const show = (r, digs) => `${JSON.stringify(r).slice(0, 220)} digs=${JSON.stringify(digs.slice(0, 6))}`

await t('(1) POSITIVE CONTROL: with TOPDOWN=off, on a grassy plain the base digs dirt from under the grass (the harness can see an under-roof dig)', async () => {
  process.env.TOPDOWN = 'off'
  try {
    const { bot, digs } = gatherWorld({ cells: trench(plain()) })
    const r = await run(SK, bot)
    assert.ok(digs.some(d => d.name === 'dirt' && d.straight && !d.open), `the base hollows the ground: ${show(r, digs)}`)
  } finally { delete process.env.TOPDOWN }
})
await t('(2) CHAIN: the same request with the rule on digs the grass block on top first, and never a cell with a solid block over it', async () => {
  rows.length = 0
  const { bot, digs } = gatherWorld({ cells: trench(plain()) })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0, `something was dug: ${show(r, digs)}`)
  assert.equal(digs[0].name, 'grass_block', `the top of the ground first: ${show(r, digs)}`)
  for (const d of digs) assert.ok(d.open, `dug a roofed cell ${JSON.stringify(d)}`)
  assert.ok(rowsOf('gather_via_source').length > 0, 'the existing fallback took it (gather_via_source)')
  const skip = rowsOf('gather_topdown').find(r => /^op=skip /.test(r.skill.detail))
  assert.ok(skip, 'the run wrote its op=skip row')
  assert.match(skip.skill.detail, /^op=skip block=dirt skipped=\d+ via=grass_block found=\d+$/)
  assert.ok(Number(/skipped=(\d+)/.exec(skip.skill.detail)[1]) > 0)
  assert.equal(rowsOf('gather_topdown').filter(r => /^op=skip /.test(r.skill.detail)).length, 1, 'one op=skip row a run')
})
await t('(2b) the op=mode row is written once per bot process, not per run', async () => {
  rows.length = 0
  const { bot } = gatherWorld({ cells: trench(plain()) })
  await run(SK, bot); await run(SK, bot)
  assert.equal(rowsOf('gather_topdown').filter(r => /^op=mode /.test(r.skill.detail)).length, 1)
  assert.equal(rowsOf('gather_topdown').find(r => /^op=mode /.test(r.skill.detail)).skill.detail, 'op=mode on=1 deep=8 air=16')
})
await t('(3) CHAIN: dirt lying open to the sky is taken as before, with no fallback and no skip of it', async () => {
  rows.length = 0
  const bare = (x, z) => (x >= 99 && x <= 101 && z >= 99 && z <= 101) ? 'dirt' : null
  const { bot, digs } = gatherWorld({ cells: plain({ capAt: bare }) })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0, show(r, digs))
  assert.ok(digs.every(d => d.name === 'dirt' && d.open), `only open dirt: ${show(r, digs)}`)
  assert.ok(digs.some(d => d.y === 63), 'the bare dirt at the top')
  assert.equal(rowsOf('gather_via_source').length, 0, 'no fallback')
})
await t('(4) CHAIN: a bot 20 blocks down in rock takes the rock around it; the same room 5 down is left alone', async () => {
  const rock = (roomY) => {
    const cells = new Map()
    for (let x = 94; x <= 106; x++) for (let z = 94; z <= 106; z++) {
      for (let y = 30; y <= 62; y++) cells.set(key(x, y, z), 'stone')
      cells.set(key(x, 63, z), 'grass_block')
    }
    for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [roomY, roomY + 1]) cells.delete(key(x, y, z))
    return cells
  }
  const deep = gatherWorld({ cells: rock(40), at: [100.5, 40, 100.5] })
  const r = await run(SK, deep.bot, { block: 'stone', count: 1 })
  assert.ok(deep.digs.length > 0, `the miner takes the rock: ${show(r, deep.digs)}`)
  for (const d of deep.digs) assert.ok(d.name === 'stone' && d.y >= 39 && d.y <= 42 && d.x >= 97 && d.x <= 103 && d.z >= 97 && d.z <= 103, `the rock of its room: ${JSON.stringify(d)}`)
  const shallow = gatherWorld({ cells: rock(56), at: [100.5, 56, 100.5] })
  const rs = await run(SK, shallow.bot, { block: 'stone', count: 1 })
  assert.equal(shallow.digs.length, 0, `5 down is near the surface: ${show(rs, shallow.digs)}`)
  assert.notEqual(rs.status, 'success')
})
await t('(5) CHAIN: a cell the gather trap allows is taken although roofed (a bot that cannot leave keeps its way out); without the trap it is not', async () => {
  const at = [101.5, 60, 100.5]   // in the trench, on its stone floor
  const trapped = gatherWorld({ cells: trench(plain()), at })
  trapped.bot.gatherTrap = CZ.gatherTrapOf({ x: 101, y: 60, z: 100 }, Date.now())
  const r = await run(SK, trapped.bot)
  assert.ok(trapped.digs.some(d => d.name === 'dirt' && !d.open), `the trapped bot takes the wall beside it: ${show(r, trapped.digs)}`)
  for (const d of trapped.digs.filter(d => !d.open)) assert.ok(Math.abs(d.x - 101) <= CZ.GATHER_ZONE.trapR && Math.abs(d.z - 100) <= CZ.GATHER_ZONE.trapR && Math.abs(d.y - 60) <= CZ.GATHER_ZONE.trapR, `only beside it: ${JSON.stringify(d)}`)
  const free = gatherWorld({ cells: trench(plain()), at })
  const rf = await run(SK, free.bot)
  assert.ok(free.digs.every(d => d.open), `control, no trap: ${show(rf, free.digs)}`)
})
await t('MUTANT KILLED: without the trap exception the trapped bot is refused the wall beside it', async () => {
  await withMutantsAll(SKILLS_URL, [TRAP], async mod => {
    const { bot, digs } = gatherWorld({ cells: trench(plain()), at: [101.5, 60, 100.5] })
    bot.gatherTrap = CZ.gatherTrapOf({ x: 101, y: 60, z: 100 }, Date.now())
    await run(mod, bot)
    assert.ok(digs.every(d => d.open), JSON.stringify(digs.slice(0, 4)))
  })
})
await t('(6) CHAIN: every dirt cell roofed and nothing that yields dirt in reach -> the run fails with the remedy and digs nothing', async () => {
  const { bot, digs } = gatherWorld({ cells: trench(plain({ cap: 'stone' })) })
  const r = await run(SK, bot)
  assert.equal(digs.length, 0, show(r, digs))
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'nothing_found')
  assert.match(String(r.detail), /^no dirt open to the sky within 32 blocks \(\d+ under a roof near the surface left/)
  assert.match(String(r.detail), /Take ground from the top: gather where it lies open, or `mine`/)
})
await t('(6b) CHAIN: the 32 the search returns are the nearest that may be taken -- open dirt past a slab of roofed dirt is found', async () => {
  const cells = plain({ x0: 96, x1: 104, z0: 96, z1: 104, cap: 'stone' })
  for (const x of [112, 113]) { for (let y = 58; y <= 62; y++) cells.set(key(x, y, 100), 'stone'); cells.set(key(x, 63, 100), 'dirt') }
  const { bot, digs } = gatherWorld({ cells })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs.every(d => d.x >= 112 && d.open), show(r, digs))
})
await t('MUTANT KILLED: without the enumeration check the roofed dirt fills the search (the open dirt past it is never reached; no remedy)', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM], async mod => {
    const cells = plain({ x0: 96, x1: 104, z0: 96, z1: 104, cap: 'stone' })
    for (const x of [112, 113]) { for (let y = 58; y <= 62; y++) cells.set(key(x, y, 100), 'stone'); cells.set(key(x, 63, 100), 'dirt') }
    const a = gatherWorld({ cells })
    await run(mod, a.bot)
    assert.ok(!a.digs.some(d => d.x >= 112), 'the open dirt was not reached')
    const b = gatherWorld({ cells: trench(plain({ cap: 'stone' })) })
    const rb = await run(mod, b.bot)
    assert.doesNotMatch(String(rb.detail), /open to the sky/, 'and the failure no longer names the remedy')
  })
})
await t('(7) LAYERS: enumeration and target filters removed -> the swing still refuses; enumeration and swing removed -> the target filter holds; all three removed -> the roofed dirt is dug', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE], async mod => {
    const { bot, digs } = gatherWorld({ cells: trench(plain()) })
    await run(mod, bot)
    assert.ok(digs.every(d => d.open), `the swing-time conjunction holds on its own: ${JSON.stringify(digs.slice(0, 4))}`)
  })
  await withMutantsAll(SKILLS_URL, [ENUM, SWING], async mod => {
    const { bot, digs } = gatherWorld({ cells: trench(plain()) })
    await run(mod, bot)
    assert.ok(digs.every(d => d.open), `the target conjunction holds on its own: ${JSON.stringify(digs.slice(0, 4))}`)
  })
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE, SWING], async mod => {
    const { bot, digs } = gatherWorld({ cells: trench(plain()) })
    await run(mod, bot)
    assert.ok(digs.some(d => d.name === 'dirt' && !d.open), `all three layers gone: the ground IS hollowed (each mutant applied): ${JSON.stringify(digs.slice(0, 4))}`)
  })
})
await t('MUTANT KILLED (chain): without the leaves exception, the grass under a canopy is refused and nothing is dug', async () => {
  const canopy = () => { const c = trench(plain()); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) c.set(key(x, 66, z), 'oak_leaves'); return c }
  const real = gatherWorld({ cells: canopy() })
  const r = await run(SK, real.bot)
  assert.ok(real.digs.length > 0 && real.digs[0].name === 'grass_block', `positive control, real code: the grass under the canopy is taken: ${show(r, real.digs)}`)
  await withTopdownMutant([LEAVES], async (TDm, SKm) => {
    const { bot, digs } = gatherWorld({ cells: canopy() })
    await run(SKm, bot)
    assert.equal(digs.length, 0, JSON.stringify(digs.slice(0, 4)))
  })
})
await t('MUTANT KILLED (chain): without the straight-above deep case, the miner 20 down cannot take the walls of its room', async () => {
  const rock = () => {
    const cells = new Map()
    for (let x = 94; x <= 106; x++) for (let z = 94; z <= 106; z++) { for (let y = 30; y <= 62; y++) cells.set(key(x, y, z), 'stone'); cells.set(key(x, 63, z), 'grass_block') }
    // a one-wide corridor: its floor is the cave-floor case, its walls the straight-above case; the floor is made of ore-free
    // bedrock-like 'obsidian' here so only the walls can be taken
    for (let x = 96; x <= 104; x++) for (const y of [40, 41]) cells.delete(key(x, y, 100))
    for (let x = 96; x <= 104; x++) { cells.set(key(x, 39, 100), 'obsidian'); cells.set(key(x, 42, 100), 'obsidian') }
    return cells
  }
  const real = gatherWorld({ cells: rock(), at: [100.5, 40, 100.5] })
  const r = await run(SK, real.bot, { block: 'stone', count: 1 })
  assert.ok(real.digs.some(d => d.name === 'stone'), `positive control: the walls are taken: ${show(r, real.digs)}`)
  await withTopdownMutant([DEEP_STRAIGHT], async (TDm, SKm) => {
    const { bot, digs } = gatherWorld({ cells: rock(), at: [100.5, 40, 100.5] })
    await run(SKm, bot, { block: 'stone', count: 1 })
    assert.ok(!digs.some(d => d.name === 'stone'), JSON.stringify(digs.slice(0, 4)))
  })
})
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
