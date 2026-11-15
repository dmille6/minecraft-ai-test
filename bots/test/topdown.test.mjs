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
const ENUM = ['      if (b.position && searchFrom && b.position.distanceTo(searchFrom) <= maxDistance && topDownHit(bot, b.position, b.name)) { roofSkipped++;', '      if (false) { roofSkipped++;']
const SAFE = ['      !topDownHit(bot, p, bot.blockAt(p)?.name) &&', '      true &&']
const SWING = ['  else if (topDownHit(bot, block.position, block.name)) {\n', '  else if (false) {\n']
// the follow-ups: the trap's count at the swing, the search's bound
const TRAPCOUNT = ['ZoneRefuses(gatherZoneNow(), block.position, block.name, bot?.entity?.position?.y))) bot.gatherTrap.left--\n  else if (topDownHit', 'ZoneRefuses(gatherZoneNow(), block.position, block.name, bot?.entity?.position?.y))) void 0\n  else if (topDownHit']
const GIVEUP = [' if (topDownGiveUp(++roofSearch)) throw TD_GIVE_UP;', '']
const TRAP = ['topDownRefuses(roofAt(bot), p, name) && !gatherTrapAllows(bot?.gatherTrap, p, Date.now())', 'topDownRefuses(roofAt(bot), p, name)']
// the two deep cases and the leaves exception in topdown.mjs
const DEEP_STRAIGHT = ["  if (n >= T.deep) return 'deep'\n", '']
const DEEP_FLOOR = ["    return t >= T.deep ? 'deep' : 'roofed'", "    return 'roofed'"]
const LEAVES = [" && !LEAVES.test(String(b.name ?? ''))", '']
const PIT_OFF = ["  return cover === 'open' && isPitted(solidAt, p, T)\n", "  return false\n"]
const PIT_5 = ['pit: 2,', 'pit: 5,']
const MADE_OFF = ['  if (isMadeGround(blockName)) return true\n', '']

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
await t('COST: at most 1 + air + deep reads per candidate in the cover; an open cell costs 1 + air, and 4 more for its sides (pitted)', () => {
  let n = 0
  const counting = s => (x, y, z) => { n++; return s(x, y, z) }
  TD.coverOf(counting(solidSet([])), P); assert.equal(n, 1 + TD.TOPDOWN.air, 'open'); n = 0
  TD.coverOf(counting(solidSet([[0, 61, 0]])), P); assert.equal(n, 2, 'the dirt under the grass: two reads'); n = 0
  TD.coverOf(counting(solidSet(col(0, 0, 61, 90))), P); assert.equal(n, TD.TOPDOWN.deep, 'deep straight above'); n = 0
  TD.coverOf(counting(solidSet(col(0, 0, 60 + 1 + TD.TOPDOWN.air, 120))), P); assert.ok(n <= 1 + TD.TOPDOWN.air + TD.TOPDOWN.deep, `worst case ${n}`); n = 0
  // the whole verdict: an open cell is also asked about its four sides; a roofed or deep one is not
  TD.topDownRefuses(counting(solidSet([])), P, 'dirt'); assert.equal(n, 1 + TD.TOPDOWN.air + 4, 'open: the cover, then the four sides'); n = 0
  TD.topDownRefuses(counting(solidSet([[0, 61, 0]])), P, 'dirt'); assert.equal(n, 2, 'roofed: the sides are not read'); n = 0
  TD.topDownRefuses(counting(solidSet(col(0, 0, 61, 90))), P, 'stone'); assert.equal(n, TD.TOPDOWN.deep, 'deep: the sides are not read'); n = 0
  TD.topDownRefuses(counting(solidSet([])), P, 'farmland'); assert.equal(n, 0, 'made ground: nothing read')
})
await t('NO SHAFTS (pitted): an open cell with 2+ of its 4 sides higher (a roof block at y+1) is refused; 0 or 1 is taken; a deep cell never is', () => {
  const side = [[1, 61, 0], [-1, 61, 0], [0, 61, 1], [0, 61, -1]]
  assert.equal(TD.TOPDOWN.pit, 2)
  for (let k = 0; k <= 4; k++) {
    const s = solidSet(side.slice(0, k))
    assert.equal(TD.hemmedIn(s, P), k)
    assert.equal(TD.topDownRefuses(s, P, 'dirt'), k >= 2, `${k} sides higher`)
  }
  assert.equal(TD.topDownRefuses(solidSet([[1, 61, 0], [-1, 61, 0], [0, 62, 1]]), P, 'dirt'), true, 'opposite sides count as well as corners (a trench floor)')
  assert.equal(TD.hemmedIn(solidSet([[1, 60, 0], [1, 62, 0], [1, 61, 1]]), P), 0, 'only y+1, only the four sides (not the level, not y+2, not diagonals)')
  // a 3x3 patch scraped off the plain (grass at y=61 around it, the patch's dirt at y=60): centre 0, edges 1, corners 2
  const grass = []
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) === 2 || Math.abs(z) === 2) grass.push([x, 61, z])
  const s = solidSet(grass)
  assert.equal(TD.topDownRefuses(s, { x: 0, y: 60, z: 0 }, 'dirt'), false, 'the centre')
  assert.equal(TD.topDownRefuses(s, { x: 1, y: 60, z: 0 }, 'dirt'), false, 'an edge')
  assert.equal(TD.topDownRefuses(s, { x: 1, y: 60, z: 1 }, 'dirt'), true, 'a corner')
  // the mine: the floor of a corridor 20 down has rock at y+1 on both sides; the deep verdict wins
  const corridor = solidSet([...col(0, 0, 63, 90), ...col(1, 0, 60, 90), ...col(-1, 0, 60, 90)])
  assert.equal(TD.coverOf(corridor, P), 'deep'); assert.equal(TD.topDownRefuses(corridor, P, 'stone'), false)
  assert.equal(TD.isPitted(corridor, P), true, 'positive control: hemmed in on two sides')
})
await t('MADE GROUND: farmland and dirt_path are never taken, open or not; dirt and grass open to the sky are', () => {
  for (const n of ['farmland', 'dirt_path']) { assert.equal(TD.topDownRefuses(solidSet([]), P, n), true, n); assert.equal(TD.isMadeGround(n), true) }
  for (const n of ['dirt', 'grass_block', 'coarse_dirt', 'podzol']) assert.equal(TD.topDownRefuses(solidSet([]), P, n), false, n)
  assert.equal(TD.isMadeGround(null), false)
})
await t('TRAP COUNT and GIVE-UP, pure: the swing counts a cell only the rule refuses and the trap lets through; a search is given up at 256', () => {
  assert.equal(TD.topDownTrapCounts(true, true, false), true)
  assert.equal(TD.topDownTrapCounts(true, true, true), false, 'the zone\'s line counted it already')
  assert.equal(TD.topDownTrapCounts(true, false, false), false, 'not refused here: nothing to count')
  assert.equal(TD.topDownTrapCounts(false, true, false), false, 'no trap')
  assert.equal(TD.TOPDOWN.giveUp, 256)
  assert.equal(TD.topDownGiveUp(255), false); assert.equal(TD.topDownGiveUp(256), true)
})
await t('SWITCH, ROW and WORDS: TOPDOWN=off turns it off; the remedy names what a bot can do (gather where it lies open, `mine`)', () => {
  for (const v of ['off', '0', 'false', 'no', 'OFF', ' off ']) assert.equal(TD.topDownOn({ TOPDOWN: v }), false, v)
  for (const v of [undefined, '', '1', 'on']) assert.equal(TD.topDownOn({ TOPDOWN: v }), true, String(v))
  assert.equal(TD.topDownModeDetail({}), 'op=mode on=1 deep=8 air=16 pit=2 give_up=256')
  assert.equal(TD.topDownModeDetail({ TOPDOWN: 'off' }), 'op=mode on=0 deep=8 air=16 pit=2 give_up=256')
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
  const two = solidSet([[1, 61, 0], [0, 61, 1]])
  assert.equal(TD.topDownRefuses(two, P, 'dirt'), true, 'positive control: the real rule refuses two sides higher')
  await withTopdownMutant([PIT_OFF], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt'), false, 'the pitted check removed') })
  await withTopdownMutant([PIT_5], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt'), false, 'the threshold 2 -> 5') })
  await withTopdownMutant([MADE_OFF], async M => { assert.equal(M.topDownRefuses(solidSet([]), P, 'farmland'), false, 'made ground taken') })
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
// `pickup`: a dig puts its drop in the bag (as the real pickup would), so `count` ends the run
const DROP = { grass_block: 'dirt', dirt: 'dirt', stone: 'cobblestone', farmland: 'dirt', dirt_path: 'dirt' }
function gatherWorld ({ cells, at = [100.5, 64, 100.5], items = [], pickup = false }) {
  const digs = [], searches = []
  const solid = (x, y, z) => TD.isRoofBlock(blockNamed(cells.get(key(x, y, z))))
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
      const fn0 = typeof matching === 'function' ? matching : (b => b && (Array.isArray(matching) ? matching.includes(b.type) : b.type === matching))
      const rec = { calls: 0 }; searches.push(rec)
      const fn = b => { rec.calls++; return fn0(b) }
      const kinds = new Set(cells.values())
      if (![...kinds].some(n => fn({ type: mcData.blocksByName[n].id, name: n }))) return []
      const from = bot.entity.position.floored()
      const out = []
      // nearest first: mineflayer walks the sections outward from the bot (an octahedron), so near cells are asked first; the
      // order matters once the search can be given up (TOPDOWN.giveUp)
      const ks = [...cells.keys()].map(k => k.split(',').map(Number)).sort((a, b) => new Vec3(...a).distanceTo(from) - new Vec3(...b).distanceTo(from))
      for (const xyz of ks) {
        const b = blk(...xyz)
        if (fn(b) && b.position.distanceTo(from) <= maxDistance) out.push(b.position)
      }
      return out.sort((a, b) => a.distanceTo(from) - b.distanceTo(from)).slice(0, count)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: { scafoldingBlocks: [mcData.itemsByName.dirt.id, mcData.itemsByName.cobblestone.id] }, setMovements () {}, stop () {}, isMining: () => false, setGoal () {}, async goto () {} },
    nearestEntity: () => null, entities: {},
    async dig (b) {
      const { x, y, z } = b.position
      const name = cells.get(key(x, y, z))
      digs.push({ x, y, z, name, open: openAbove(cells, x, y, z), straight: TD.isRoofBlock(blockNamed(cells.get(key(x, y + 1, z)))), refused: TD.topDownRefuses(solid, { x, y, z }, name), hem: TD.hemmedIn(solid, { x, y, z }) })
      cells.delete(key(x, y, z))
      const drop = DROP[name]
      if (pickup && drop) { const it = items.find(i => i.name === drop); if (it) it.count++; else items.push({ name: drop, count: 1, type: mcData.itemsByName[drop].id }) }
    },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  return { bot, digs, searches }
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
  assert.match(skip.skill.detail, /^op=skip block=dirt skipped=\d+ via=grass_block found=\d+ gave_up=1$/, 'this plain has 867 roofed dirt cells in range: the search is given up at 256')
  assert.ok(Number(/skipped=(\d+)/.exec(skip.skill.detail)[1]) > 0)
  assert.equal(rowsOf('gather_topdown').filter(r => /^op=skip /.test(r.skill.detail)).length, 1, 'one op=skip row a run')
})
await t('(2b) the op=mode row is written once per bot process, not per run', async () => {
  rows.length = 0
  const { bot } = gatherWorld({ cells: trench(plain()) })
  await run(SK, bot); await run(SK, bot)
  assert.equal(rowsOf('gather_topdown').filter(r => /^op=mode /.test(r.skill.detail)).length, 1)
  assert.equal(rowsOf('gather_topdown').find(r => /^op=mode /.test(r.skill.detail)).skill.detail, 'op=mode on=1 deep=8 air=16 pit=2 give_up=256')
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

// ---- the follow-ups (coordinator 11-15): no shafts, made ground, the trap's count, a bounded search --------------------
const col2 = d => `${d.x},${d.z}`
// NOTE (reported to the coordinator): the rule as specified (2+ higher sides) does NOT give "six different columns, nothing
// under a dug cell" for count=6. gather asks for dirt first and only falls back to the grass when no dirt may be taken, so the
// dirt under the first scraped column is taken as soon as three of its four sides are scraped (one side higher). What holds,
// and is asserted: the scrape widens before it deepens, no cell is taken with 2+ sides higher, and no column goes past 2 deep.
await t('(8) NO SHAFTS, CHAIN: on a flat grassy plain `gather dirt count=6` scrapes: the first five digs are tops of five columns, no cell is taken with 2+ sides higher, nothing deeper than 2', async () => {
  const { bot, digs } = gatherWorld({ cells: plain(), pickup: true })
  const r = await run(SK, bot, { block: 'dirt', count: 6 })
  assert.equal(r.status, 'success', show(r, digs))
  assert.equal(digs.length, 6, show(r, digs))
  assert.ok(digs.every(d => d.open && d.hem <= 1 && !d.refused), `every dig open, at most one side higher: ${JSON.stringify(digs)}`)
  assert.ok(digs.slice(0, 4).every(d => d.y === 63 && d.name === 'grass_block'), 'the scrape starts at the tops')
  assert.ok(new Set(digs.map(col2)).size >= 5, `five columns at least: ${JSON.stringify(digs)}`)
  assert.ok(digs.every(d => d.y >= 62), 'no column past 2 deep')
})
await t('(8) POSITIVE CONTROL: without the pitted check the same request sinks a shaft (a cell under a dug cell is taken)', async () => {
  await withTopdownMutant([PIT_OFF], async (TDm, SKm) => {
    const { bot, digs } = gatherWorld({ cells: plain(), pickup: true })
    await run(SKm, bot, { block: 'dirt', count: 6 })
    assert.ok(digs.some(d => digs.some(e => e !== d && col2(e) === col2(d) && e.y > d.y)), `the mutant digs down a column: ${JSON.stringify(digs)}`)
  })
})
await t('(9) A SCRAPED 3x3 PATCH, CHAIN: its centre and its four edges are taken, never its corners (two sides higher)', async () => {
  const cells = plain()
  for (let x = 99; x <= 101; x++) for (let z = 99; z <= 101; z++) cells.delete(key(x, 63, z))
  const { bot, digs } = gatherWorld({ cells, at: [100.5, 63, 100.5], pickup: true })
  const r = await run(SK, bot, { block: 'dirt', count: 5 })
  const want = ['100,62,100', '99,62,100', '101,62,100', '100,62,99', '100,62,101']
  assert.deepEqual(digs.map(d => `${d.x},${d.y},${d.z}`).sort(), want.slice().sort(), show(r, digs))
  assert.ok(!digs.some(d => Math.abs(d.x - 100) === 1 && Math.abs(d.z - 100) === 1), 'no corner')
})
await t('(10) MADE GROUND, CHAIN: dirt roofed under a field and a path, nothing else -> no farmland or path is dug; the run ends with the remedy', async () => {
  const field = () => plain({ capAt: (x, z) => x < 100 ? 'farmland' : 'dirt_path' })
  const { bot, digs } = gatherWorld({ cells: field(), pickup: true })
  const r = await run(SK, bot, { block: 'dirt', count: 2 })
  assert.equal(digs.length, 0, show(r, digs))
  assert.equal(r.failClass, 'nothing_found'); assert.match(String(r.detail), /open to the sky/)
  await withTopdownMutant([MADE_OFF], async (TDm, SKm) => {
    const m = gatherWorld({ cells: field(), pickup: true })
    await run(SKm, m.bot, { block: 'dirt', count: 2 })
    assert.ok(m.digs.some(d => d.name === 'farmland' || d.name === 'dirt_path'), `the mutant digs up the field: ${JSON.stringify(m.digs.slice(0, 3))}`)
  })
})
const trapRun = async (mod) => {
  const w = gatherWorld({ cells: trench(plain()), at: [101.5, 60, 100.5], pickup: true })
  w.bot.gatherTrap = CZ.gatherTrapOf({ x: 101, y: 60, z: 100 }, Date.now())
  const r = await run(mod, w.bot, { block: 'dirt', count: 16 })
  return { ...w, r }
}
await t('(11) THE TRAP\'S COUNT, CHAIN: a trapped bot takes at most trapMax cells that only this rule refuses, each counted at the swing', async () => {
  const { bot, digs, r } = await trapRun(SK)
  const refused = digs.filter(d => d.refused)
  assert.ok(refused.length > 0, `positive control: the trap let roofed cells through: ${show(r, digs)}`)
  assert.ok(refused.length <= CZ.GATHER_ZONE.trapMax, `${refused.length} refused cells taken`)
  assert.equal(bot.gatherTrap.left, CZ.GATHER_ZONE.trapMax - refused.length, 'each one counted')
})
await t('MUTANT KILLED: without the trap\'s count the trapped bot takes more than trapMax roofed cells', async () => {
  await withMutantsAll(SKILLS_URL, [TRAPCOUNT], async mod => {
    const { digs } = await trapRun(mod)
    assert.ok(digs.filter(d => d.refused).length > CZ.GATHER_ZONE.trapMax, `${digs.filter(d => d.refused).length}`)
  })
})
// (6b)'s twin: a grass-capped plain of 17 x 17 x 3 = 867 roofed dirt cells, all nearer than the open dirt at x = 112-113
const bigSlab = () => {
  const cells = plain()
  for (const x of [112, 113]) { for (let y = 58; y <= 62; y++) cells.set(key(x, y, 100), 'stone'); cells.set(key(x, 63, 100), 'dirt') }
  return cells
}
await t('(12) A BOUNDED SEARCH, CHAIN: past 256 roofed cells the search is given up -- the open dirt beyond is NOT reached, the grass on top is taken; the row says gave_up=1', async () => {
  rows.length = 0
  const cells = bigSlab(), total = cells.size
  const { bot, digs, searches } = gatherWorld({ cells })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs[0].name === 'grass_block', show(r, digs))
  assert.ok(!digs.some(d => d.x >= 112), 'the open dirt past the slab was not reached')
  const skip = rowsOf('gather_topdown').find(r => /^op=skip /.test(r.skill.detail))
  assert.match(skip.skill.detail, /^op=skip block=dirt skipped=256 via=grass_block found=\d+ gave_up=1$/)
  assert.ok(searches[0].calls < total / 2, `the first search stopped early: ${searches[0].calls} matcher calls of ${total} cells`)
})
await t('(6b) has no gave_up: a slab under 256 cells is searched to the end', async () => {
  rows.length = 0
  const cells = plain({ x0: 96, x1: 104, z0: 96, z1: 104, cap: 'stone' })
  for (const x of [112, 113]) { for (let y = 58; y <= 62; y++) cells.set(key(x, y, 100), 'stone'); cells.set(key(x, 63, 100), 'dirt') }
  const { bot } = gatherWorld({ cells })
  await run(SK, bot)
  const skip = rowsOf('gather_topdown').find(r => /^op=skip /.test(r.skill.detail))
  assert.ok(skip && !/gave_up/.test(skip.skill.detail), skip?.skill?.detail)
})
await t('MUTANT KILLED: without the bound the search walks every cell and reaches the open dirt', async () => {
  await withMutantsAll(SKILLS_URL, [GIVEUP], async mod => {
    const cells = bigSlab(), total = cells.size
    const { bot, digs, searches } = gatherWorld({ cells })
    await run(mod, bot)
    assert.ok(searches[0].calls >= total, `${searches[0].calls} matcher calls of ${total} cells`)
    assert.ok(digs.some(d => d.x >= 112), 'the open dirt was reached')
  })
})
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
