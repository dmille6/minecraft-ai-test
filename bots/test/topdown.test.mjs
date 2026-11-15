// TOPDOWN-01 (topdown.mjs + skills.mjs gather; owner 2026-11-15 "Yes, authorize"): gather takes ground only FROM THE TOP.
// WHY: bots gathered dirt from under the grass and left roofed hollows -- 3,103 columns under the showcase lawn, a ring of
// 488 undermined columns just outside the town square on the rehearsal world (docs/reports/land-eval-2026-11-14/dirt-loop.md
// on main). The rule is pure and tested as such; the refusal chain is driven through the REAL gather skill over a fake world
// of named, layered cells (gatherzone.test.mjs's harness, adapted: grass_block over dirt over stone).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
// home far away: neither the town's ground (townground.mjs) nor the clean zone (cleanzone.mjs) reaches this test's world
process.env.HOME_X = '3000'; process.env.HOME_Y = '65'; process.env.HOME_Z = '3000'
// a border wide enough that the town at 3000 is inside it (the BLOCKER-2 test works inside the clean zone there)
process.env.WORLD_BORDER_RADIUS = '100000'

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
const t = async (name, fn) => { try { await fn(); pass++; if (process.env.TEST_VERBOSE) console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.message).slice(0, 600)}`) } }
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const TOPDOWN_URL = new URL('../src/topdown.mjs', import.meta.url)

const rows = []
LG.tapRecords(r => rows.push(r))
const rowsOf = kind => rows.filter(r => r?.skill?.name === `_${kind}`)
const trappedRows = () => rowsOf('gather_topdown').filter(r => /^op=trapped /.test(r.skill.detail))
const near = (d, at, r = CZ.GATHER_ZONE.trapR) => Math.abs(d.x - Math.floor(at[0])) <= r && Math.abs(d.y - Math.floor(at[1])) <= r && Math.abs(d.z - Math.floor(at[2])) <= r

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
const ENUM = ['        const roofHit = topDownHit(bot, b.position, b.name, tdShelter, tdSolid)', '        const roofHit = false']
const SAFE = ['      !topDownHit(bot, p, bot.blockAt(p)?.name, tdShelter) &&', '      true &&']
const SWING = ['  if (tdVerdict) {\n', '  if (false) {\n']
// the follow-ups: the trap's count at the swing, the search's bound
const TRAPCOUNT = ['bot?.entity?.position?.y))) bot.gatherTrap.left--\n    } else {', 'bot?.entity?.position?.y))) void 0\n    } else {']
const GIVEUP = ['        if (topDownGiveUp(roofSearch, TOPDOWN, roofReads)) throw TD_GIVE_UP\n', '']
const TRAP = ["(v === 'refused' && !gatherTrapAllows(bot?.gatherTrap, p, Date.now()))", "v === 'refused'"]
// review r1: the trap asked once at the swing; the sheltered bot's trap; kept cells through the whole chain; the second fallback
const SWING_REASK = ["    if (tdVerdict === 'refused' && tdTrapLets) {\n", "    if (tdVerdict === 'refused' && gatherTrapAllows(bot.gatherTrap, block.position, Date.now())) {\n"]
const TRAP_INSTALL = ['        bot.gatherTrap = { ...gatherTrapOf(at, Date.now()), shelter: tdShelter }\n', '        void 0\n']
const REFILTER = ['        return bot.findBlocks({ matching: b => (b?.position ? ks.has(', '        return kept; return bot.findBlocks({ matching: b => (b?.position ? ks.has(']
const KEPT_NONE = ['        if (!kept.length) return []\n', '        return []\n']
const LEAK = ['        const found = findGround(altType.id, { count: false })', '        const found = findGround(altType.id)']
const INRANGE = ['      if (b.position && searchFrom && b.position.distanceTo(searchFrom) <= maxDistance) {\n        const roofHit', '      if (b.position) {\n        const roofHit']
// the two deep cases and the leaves exception in topdown.mjs
const DEEP_STRAIGHT = ["  if (n >= T.deep) return 'deep'\n", '']
const DEEP_FLOOR = ["    return t >= T.deep ? 'deep' : 'roofed'", "    return 'roofed'"]
const LEAVES = [" && !LEAVES.test(String(b.name ?? ''))", '']
const PIT_OFF = ["  return cover === 'open' && isPitted(solidAt, p, T)\n", "  return false\n"]
const PIT_5 = ['pit: 2,', 'pit: 5,']
const MADE_OFF = ['  if (isMadeGround(blockName)) return true\n', '']
const SHELTER_OFF = ["  if (coverOf(solidAt, f, T) !== 'open') return { kind: 'roofed', feetY: f.y }\n  if (hemmedIn(solidAt, f) >= T.hole) return { kind: 'pit', feetY: f.y }\n", '']
const SHORT_OFF = ["  return (Number(held) || 0) < need ? 'trap' : 'climb'", "  return 'trap'"]
const BELOW_OFF = ["  return Math.floor(p.y) >= shelter.feetY + 1 && coverOf(solidAt, p, T) === 'open'", '  return false']
const READS_OFF = ['skipped >= T.giveUp || reads >= T.readBudget', 'skipped >= T.giveUp']

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
  assert.equal(TD.topDownModeDetail({}), 'op=mode on=1 deep=8 air=16 pit=2 hole=3 give_up=256 reads=16384')
  assert.equal(TD.topDownModeDetail({ TOPDOWN: 'off' }), 'op=mode on=0 deep=8 air=16 pit=2 hole=3 give_up=256 reads=16384')
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
// A world of NAMED cells (key -> block name; air elsewhere). findBlocks is mineflayer 4.37.1's own walk (blocks.js 156-206):
// sections of 16x16x16 visited by prismarine-world's OctahedronIterator outward from the bot's section, a palette pre-check
// per section with position-less blocks, then every cell of the section in x, y, z order through bot.blockAt -- and it
// stops once a layer is finished with `count` found. A dig records what lay over the cell at that moment.
const { OctahedronIterator } = require_('prismarine-world').iterators
const key = (x, y, z) => `${x},${y},${z}`
function openAbove (cells, x, y, z) {
  for (let yy = y + 1; yy <= y + 60; yy++) { const n = cells.get(key(x, yy, z)); if (n && TD.isRoofBlock(blockNamed(n))) return false }
  return true
}
// `pickup`: a dig puts its drop in the bag only when the bot could collect it: the drop falls to the first solid block under
// the dug cell, and is collected when it rests from three below the bot's feet (a safe drop into a scrape) to two above (vanilla's
// pickup box: the body, 1.8 tall, expanded 0.5 up), within gather's own pickup walk (radius 8). A drop resting higher -- the lawn
// over a cave, a deep pit's rim -- is NOT collected: the bot cannot climb to it.
const DROP = { grass_block: 'dirt', dirt: 'dirt', stone: 'cobblestone', cobblestone: 'cobblestone', farmland: 'dirt', dirt_path: 'dirt' }
function gatherWorld ({ cells, at = [100.5, 64, 100.5], items = [], pickup = false, reach = false }) {
  const digs = [], searches = [], uncollected = []
  const counts = { reads: 0 }
  const solid = (x, y, z) => TD.isRoofBlock(blockNamed(cells.get(key(x, y, z))))
  const blk = (x, y, z) => {
    const name = cells.get(key(x, y, z)) ?? 'air'
    const t = mcData.blocksByName[name]
    return { name, type: t.id, position: new Vec3(x, y, z), boundingBox: t.boundingBox, diggable: name !== 'air',
             canHarvest: () => true, digTime: () => 50, material: t.material, hardness: name === 'air' ? 0 : (t.hardness ?? 1) }
  }
  const sectionKinds = () => {
    const m = new Map()
    for (const k of cells.keys()) {
      const [x, y, z] = k.split(',').map(Number)
      const sk = key(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16))
      if (!m.has(sk)) m.set(sk, new Set(['air']))
      m.get(sk).add(cells.get(k))
    }
    return m
  }
  const bot = {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20, game: { minY: -64, height: 384 },
    inventory: { items: () => items, emptySlotCount: () => 30 },
    // `items` too, as mineflayer's registry has it: drops.mjs reads drop ids through it (without it no block yields dirt)
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName, items: mcData.items },
    blockAt: p => { counts.reads++; return blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) },
    findBlocks (options) {
      const m0 = options.matching
      const fn0 = typeof m0 === 'function' ? m0 : (b => b && (Array.isArray(m0) ? m0.includes(b.type) : b.type === m0))
      const rec = { calls: 0, readsAtStart: counts.reads }; searches.push(rec)
      const matcher = b => { rec.calls++; return fn0(b) }
      const point = (options.point || bot.entity.position).floored()
      const maxDistance = options.maxDistance || 16
      const count = options.count || 1
      const start = new Vec3(Math.floor(point.x / 16), Math.floor(point.y / 16), Math.floor(point.z / 16))
      const it = new OctahedronIterator(start, Math.ceil((maxDistance + 8) / 16))
      const visited = new Set(), kinds = sectionKinds()
      let blocks = [], startedLayer = 0, next = start
      try {
        while (next) {
          const sk = key(next.x, next.y, next.z)
          const pal = kinds.get(sk)
          if (pal && !visited.has(sk) && [...pal].some(n => matcher({ type: mcData.blocksByName[n].id, name: n, position: null }))) {
            const begin = new Vec3(next.x * 16, next.y * 16, next.z * 16)
            const cursor = begin.clone()
            for (cursor.x = begin.x; cursor.x < begin.x + 16; cursor.x++) {
              for (cursor.y = begin.y; cursor.y < begin.y + 16; cursor.y++) {
                for (cursor.z = begin.z; cursor.z < begin.z + 16; cursor.z++) {
                  if (matcher(bot.blockAt(cursor)) && cursor.distanceTo(point) <= maxDistance) blocks.push(cursor.clone())
                }
              }
            }
          }
          visited.add(sk)
          if (startedLayer !== it.apothem && blocks.length >= count) break
          startedLayer = it.apothem
          next = it.next()
        }
      } finally { rec.reads = counts.reads - rec.readsAtStart }
      blocks.sort((a, b) => a.distanceTo(point) - b.distanceTo(point))
      return blocks.slice(0, count)
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
      if (!pickup || !drop) return
      let rest = y
      while (rest > -64 && !solid(x, rest - 1, z)) rest--
      const f = bot.entity.position.floored()
      const near = Math.hypot(x + 0.5 - bot.entity.position.x, z + 0.5 - bot.entity.position.z) <= 8
      if (near && rest >= f.y - 3 && rest <= f.y + 2) { const it = items.find(i => i.name === drop); if (it) it.count++; else items.push({ name: drop, count: 1, type: mcData.itemsByName[drop].id }) }
      else uncollected.push({ x, y, z, name, rest })
    },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  // `reach`: mineflayer's canDigBlock (digging.js 220-226): diggable and the block centre within 5.1 of the eye -- no line of sight
  if (reach) bot.canDigBlock = b => !!b && b.diggable && b.position.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.65, 0)) <= 5.1
  const held = () => items.reduce((n, i) => n + (['dirt', 'cobblestone'].includes(i.name) ? i.count : 0), 0)
  return { bot, digs, searches, uncollected, counts, held }
}
// A plain: stone, then `dirt` layers, then the cap (grass_block) at `top`, over [x0..x1] x [z0..z1]
function plain ({ x0 = 92, x1 = 108, z0 = 92, z1 = 108, top = 63, dirt = 3, floor = 58, cap = 'grass_block', capAt = null, ox = 0, oz = 0 } = {}) {
  const cells = new Map()
  for (let x = x0 + ox; x <= x1 + ox; x++) for (let z = z0 + oz; z <= z1 + oz; z++) {
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
  assert.equal(rowsOf('gather_topdown').find(r => /^op=mode /.test(r.skill.detail)).skill.detail, 'op=mode on=1 deep=8 air=16 pit=2 hole=3 give_up=256 reads=16384')
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
  // 5 down is near the surface: the room's rock is refused. Holding what a climb needs, the bot digs nothing and is told to
  // climb; with an empty bag it is a sheltered bot short of blocks (review r1): the trap's few cells beside it, no more
  const shallow = gatherWorld({ cells: rock(56), at: [100.5, 56, 100.5], items: [{ name: 'cobblestone', count: 8, type: mcData.itemsByName.cobblestone.id }] })
  const rs = await run(SK, shallow.bot, { block: 'stone', count: 1 })
  assert.equal(shallow.digs.length, 0, `5 down, holding a climb: ${show(rs, shallow.digs)}`)
  assert.match(String(rs.detail), /`surface`/)
  const empty = gatherWorld({ cells: rock(56), at: [100.5, 56, 100.5] })
  const re = await run(SK, empty.bot, { block: 'stone', count: 16 })
  assert.ok(empty.digs.length <= CZ.GATHER_ZONE.trapMax && empty.digs.every(d => near(d, [100.5, 56, 100.5])), `5 down, empty bag: the trap only: ${show(re, empty.digs)}`)
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
    // the mutant reads the canopy as a roof over the GRASS (refused) and over the bot itself (sheltered: the trap's cells)
    assert.ok(!digs.some(d => d.name === 'grass_block'), JSON.stringify(digs.slice(0, 4)))
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
  rows.length = 0
  const real = gatherWorld({ cells: rock(), at: [100.5, 40, 100.5] })
  const r = await run(SK, real.bot, { block: 'stone', count: 1 })
  assert.ok(real.digs.some(d => d.name === 'stone'), `positive control: the walls are taken: ${show(r, real.digs)}`)
  assert.equal(trappedRows().length, 0, 'the real rule takes them as a mine: no trap needed')
  await withTopdownMutant([DEEP_STRAIGHT], async (TDm, SKm) => {
    rows.length = 0
    const { bot } = gatherWorld({ cells: rock(), at: [100.5, 40, 100.5] })
    await run(SKm, bot, { block: 'stone', count: 1 })
    // the mutant refuses the walls of the mine; only the sheltered bot's trap gets the miner its rock
    assert.equal(trappedRows().length, 1)
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
const REAL12 = {}
await t('(12) A BOUNDED SEARCH, CHAIN: past 256 roofed cells the search is given up -- the open dirt beyond is NOT reached, the grass on top is taken; the row says gave_up=1', async () => {
  rows.length = 0
  const cells = bigSlab(), total = cells.size
  const { bot, digs, searches } = gatherWorld({ cells })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs[0].name === 'grass_block', show(r, digs))
  assert.ok(!digs.some(d => d.x >= 112), 'the open dirt past the slab was not reached')
  const skip = rowsOf('gather_topdown').find(r => /^op=skip /.test(r.skill.detail))
  assert.match(skip.skill.detail, /^op=skip block=dirt skipped=256 via=grass_block found=\d+ gave_up=1$/)
  REAL12.calls = searches[0].calls; REAL12.total = total
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
    assert.ok(searches[0].calls > REAL12.calls, `the mutant's first search asked the matcher ${searches[0].calls} times, the real one ${REAL12.calls}`)
    assert.ok(digs.some(d => d.x >= 112), 'the open dirt was reached')
  })
})

// ---- review r1 (Codex + Claude): the sheltered bot, the trap asked once, the whole chain, the reads, the library's walk -----
const NEED = 8   // skills.mjs climbPrerequisite('no scaffold').count, what the trap and the climb are measured against
await t('SHELTER, pure: roofed or deep feet -> roofed; open with 3+ sides solid at head height -> pit; a 1-deep scrape, a trench, open ground -> none', () => {
  const at = { x: 0, y: 60, z: 0 }
  assert.deepEqual(TD.shelteredAt(solidSet([[0, 63, 0]]), at), { kind: 'roofed', feetY: 60 }, 'a cave: a ceiling two over the head')
  assert.deepEqual(TD.shelteredAt(solidSet(col(0, 0, 62, 90)), at), { kind: 'roofed', feetY: 60 }, 'deep in a mine')
  const sides = y => [[1, y, 0], [-1, y, 0], [0, y, 1], [0, y, -1]]
  assert.equal(TD.shelteredAt(solidSet(sides(60)), at), null, 'a 1-deep scrape: the sides end at the feet')
  assert.deepEqual(TD.shelteredAt(solidSet([...sides(60), ...sides(61)]), at), { kind: 'pit', feetY: 60 }, 'a 1x1 pit 2 deep')
  assert.deepEqual(TD.shelteredAt(solidSet([...sides(61)].slice(0, 3)), at), { kind: 'pit', feetY: 60 }, 'three sides is the bottom of a hole')
  assert.equal(TD.shelteredAt(solidSet([[1, 61, 0], [-1, 61, 0]]), at), null, 'a 1-wide trench (two sides): it can walk along it')
  assert.equal(TD.shelteredAt(solidSet([]), at), null)
  assert.equal(TD.shelteredAt(solidSet([]), null), null)
  assert.equal(TD.pitRimY(solidSet([...sides(61), ...sides(62), ...sides(63)]), at), 63 + 1, 'the rim: on top of the walls (feet 64)')
})
await t('FROM BELOW, pure: for a sheltered bot an OPEN terrain cell at or above its head is refused; at its feet, roofed, deep, or an ore is the old rule; no shelter, no effect', () => {
  const sh = { kind: 'roofed', feetY: 57 }
  assert.equal(TD.fromBelow(solidSet([]), { x: 0, y: 63, z: 0 }, 'grass_block', sh), true, 'the lawn over the cave')
  assert.equal(TD.fromBelow(solidSet([]), { x: 0, y: 58, z: 0 }, 'dirt', sh), true, 'at head height')
  assert.equal(TD.fromBelow(solidSet([]), { x: 0, y: 57, z: 0 }, 'dirt', sh), false, 'at the feet: not from below')
  assert.equal(TD.fromBelow(solidSet(col(0, 0, 64, 90)), { x: 0, y: 63, z: 0 }, 'stone', sh), false, 'deep: not open')
  assert.equal(TD.fromBelow(solidSet([]), { x: 0, y: 63, z: 0 }, 'iron_ore', sh), false, 'an ore')
  assert.equal(TD.fromBelow(solidSet([]), { x: 0, y: 63, z: 0 }, 'grass_block', null), false, 'no shelter')
  assert.equal(TD.topDownRefusesFor(solidSet([]), { x: 0, y: 63, z: 0 }, 'grass_block', null), false)
  assert.equal(TD.topDownRefusesFor(solidSet([]), { x: 0, y: 63, z: 0 }, 'grass_block', sh), true)
})
await t('DECISION and WORDS, pure: short of a climb -> trap; holding it -> climb; the sheltered remedy names surface (roofed) or a goto onto the rim (pit), never "gather where it lies open" as the first step', () => {
  assert.equal(TD.shelterDecision(null, 0, NEED), null)
  assert.equal(TD.shelterDecision({ kind: 'roofed', feetY: 1 }, NEED - 1, NEED), 'trap')
  assert.equal(TD.shelterDecision({ kind: 'roofed', feetY: 1 }, NEED, NEED), 'climb')
  const roofed = TD.topDownShelterRemedy('dirt', { kind: 'roofed', feetY: 57 }, 12, NEED)
  assert.match(roofed, /under a roof .* You hold 12 blocks, a climb needs 8: `surface`/)
  const pit = TD.topDownShelterRemedy('dirt', { kind: 'pit', feetY: 60 }, 9, NEED, { x: 101, y: 64, z: 100 })
  assert.match(pit, /at the bottom of a hole .* `goto 101 64 100`/)
  assert.ok(!/^no dirt open to the sky/.test(roofed) && !/Take ground from the top: gather where it lies open/.test(roofed), 'differs from the open-ground remedy')
  assert.match(TD.topDownShelterRemedy('dirt', { kind: 'roofed', feetY: 57 }, 0, NEED), /you hold 0 of the 8 blocks a climb needs/)
})
await t('THE NEED: the trap and the climb are measured against climbPrerequisite("no scaffold").count, not a second number', () => {
  assert.equal(SK.climbPrerequisite('no scaffold').count, NEED)
})
await t('MUTANTS KILLED (pure): shelter off, shortage off, from-below off, read budget off', async () => {
  await withTopdownMutant([SHELTER_OFF], async M => { assert.equal(M.shelteredAt(solidSet([[0, 63, 0]]), { x: 0, y: 60, z: 0 }), null) })
  await withTopdownMutant([SHORT_OFF], async M => { assert.equal(M.shelterDecision({ kind: 'roofed', feetY: 1 }, NEED, NEED), 'trap') })
  await withTopdownMutant([BELOW_OFF], async M => { assert.equal(M.fromBelow(solidSet([]), { x: 0, y: 63, z: 0 }, 'grass_block', { kind: 'roofed', feetY: 57 }), false) })
  await withTopdownMutant([READS_OFF], async M => { assert.equal(M.topDownGiveUp(0, M.TOPDOWN, M.TOPDOWN.readBudget), false) })
  assert.equal(TD.topDownGiveUp(0, TD.TOPDOWN, TD.TOPDOWN.readBudget), true, 'positive control: the real budget gives up')
})

// A cave 5 below a grassy plain: base stone 50-55, the cave's layer (y 56-58) of `layer`, a 2-block stone ceiling (59-60),
// dirt 61-62, grass 63. The cave is the air at x 98-102, z 98-102, y 57-58; the bot stands on its floor at (100, 57, 100).
// The lawn right over it is 4.85 from the bot's eye: canDigBlock says yes, through the rock.
function caveWorld (layer = 'dirt', { ox = 0, oz = 0 } = {}) {
  const cells = new Map()
  for (let x = 92 + ox; x <= 108 + ox; x++) for (let z = 92 + oz; z <= 108 + oz; z++) {
    for (let y = 50; y <= 55; y++) cells.set(key(x, y, z), 'stone')
    for (let y = 56; y <= 58; y++) cells.set(key(x, y, z), layer)
    for (const y of [59, 60]) cells.set(key(x, y, z), 'stone')
    for (const y of [61, 62]) cells.set(key(x, y, z), 'dirt')
    cells.set(key(x, 63, z), 'grass_block')
  }
  for (let x = 98 + ox; x <= 102 + ox; x++) for (let z = 98 + oz; z <= 102 + oz; z++) for (const y of [57, 58]) cells.delete(key(x, y, z))
  return cells
}
const CAVE_AT = [100.5, 57, 100.5]
const caveRun = async (mod, { layer = 'dirt', block = 'dirt', items = [], ox = 0, oz = 0 } = {}) => {
  rows.length = 0
  const w = gatherWorld({ cells: caveWorld(layer, { ox, oz }), at: [CAVE_AT[0] + ox, CAVE_AT[1], CAVE_AT[2] + oz], pickup: true, reach: true, items })
  const r = await run(mod, w.bot, { block, count: 16 })
  return { ...w, r }
}
await t('(13) POSITIVE CONTROL, TOPDOWN=off: the bot in the cave takes the ground beside it and ends holding blocks', async () => {
  process.env.TOPDOWN = 'off'
  try {
    for (const [layer, block] of [['dirt', 'dirt'], ['stone', 'cobblestone']]) {
      const { digs, held, r } = await caveRun(SK, { layer, block })
      assert.ok(held() > 0, `${block}: holds ${held()}: ${show(r, digs)}`)
      assert.ok(!digs.some(d => d.y >= 61), `${block}: the base does not reach the lawn either here (the cave's own ground is nearer)`)
    }
  } finally { delete process.env.TOPDOWN }
})
for (const [layer, block] of [['dirt', 'dirt'], ['stone', 'cobblestone']]) {
  await t(`(13) CHAIN, ${block}: the bot in a cave under a 2-block ceiling with an empty bag gets the trap, takes at most trapMax cells beside it, ends holding the climb's ${NEED}, the lawn untouched, one op=trapped row`, async () => {
    const { digs, held, uncollected, r } = await caveRun(SK, { layer, block })
    assert.ok(digs.length > 0 && digs.length <= CZ.GATHER_ZONE.trapMax, `${digs.length} digs: ${show(r, digs)}`)
    assert.ok(digs.every(d => near(d, CAVE_AT)), `only within the trap's reach: ${JSON.stringify(digs)}`)
    assert.ok(!digs.some(d => d.y >= 61), 'the lawn and the ground under it untouched')
    assert.deepEqual(uncollected, [], 'nothing dug that it could not collect')
    assert.ok(held() >= NEED, `ends holding ${held()} (need ${NEED})`)
    assert.equal(trappedRows().length, 1)
    assert.match(trappedRows()[0].skill.detail, new RegExp(`^op=trapped at=100,57,100 kind=roofed holds=0 need=${NEED} block=`))
  })
}
await t('(14) CHAIN: the same bot already holding what a climb needs: nothing dug, the lawn untouched, no trap; the remedy names `surface`', async () => {
  const { digs, r } = await caveRun(SK, { items: [{ name: 'dirt', count: NEED, type: mcData.itemsByName.dirt.id }] })
  assert.equal(digs.length, 0, show(r, digs))
  assert.equal(trappedRows().length, 0)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'no_safe_target')
  assert.match(String(r.detail), /under a roof .* You hold 8 blocks, a climb needs 8: `surface`/)
})
await t('(15) CHAIN: a 1x1 pit 4 deep, empty bag: it ends holding blocks from the pit\'s walls; no rim grass is dug out of its reach', async () => {
  rows.length = 0
  const cells = plain()
  for (let y = 60; y <= 63; y++) cells.delete(key(100, y, 100))
  const { bot, digs, held, uncollected } = gatherWorld({ cells, at: [100.5, 60, 100.5], pickup: true, reach: true })
  const r = await run(SK, bot, { block: 'dirt', count: 16 })
  assert.ok(held() > 0, `holds ${held()}: ${show(r, digs)}`)
  assert.ok(!digs.some(d => d.y === 63), 'no rim grass')
  assert.deepEqual(uncollected, [], 'nothing dug out of its reach')
  assert.match(trappedRows()[0]?.skill?.detail ?? '', /kind=pit/)
})
await t('(16) CHAIN: with no home set at all (no town, no clean zone), the cave bot still gets the trap and its blocks', async () => {
  const saved = { x: process.env.HOME_X, y: process.env.HOME_Y, z: process.env.HOME_Z }
  delete process.env.HOME_X; delete process.env.HOME_Y; delete process.env.HOME_Z
  try {
    const { digs, held, r } = await caveRun(SK)
    assert.ok(held() >= NEED && digs.every(d => near(d, CAVE_AT)), `${held()}: ${show(r, digs)}`)
    assert.equal(trappedRows().length, 1)
  } finally { process.env.HOME_X = saved.x; process.env.HOME_Y = saved.y; process.env.HOME_Z = saved.z }
})
await t('(17) CHAIN: a bot standing in the open on the lawn over the cave is not sheltered: it takes the grass as before, no trap', async () => {
  rows.length = 0
  const { bot, digs } = gatherWorld({ cells: caveWorld(), at: [100.5, 64, 100.5], pickup: true, reach: true })
  const r = await run(SK, bot, { block: 'dirt', count: 1 })
  assert.equal(digs[0]?.name, 'grass_block', show(r, digs)); assert.equal(digs[0].y, 63)
  assert.equal(trappedRows().length, 0)
})
await t('MUTANT KILLED (13 without the shelter): no trap, and the lawn is dug from below where the drop cannot be collected', async () => {
  await withTopdownMutant([SHELTER_OFF], async (TDm, SKm) => {
    const { digs, held, uncollected } = await caveRun(SKm)
    assert.ok(digs.some(d => d.y === 63) && uncollected.length > 0 && held() === 0, JSON.stringify({ digs: digs.slice(0, 3), held: held() }))
  })
})
await t('MUTANT KILLED (14 without the shortage): the bot holding a climb is exempted too and digs', async () => {
  await withTopdownMutant([SHORT_OFF], async (TDm, SKm) => {
    const { digs } = await caveRun(SKm, { items: [{ name: 'dirt', count: NEED, type: mcData.itemsByName.dirt.id }] })
    assert.ok(digs.length > 0)
  })
})
await t('MUTANT KILLED (13 without from-below): the lawn is dug from under the rock and lies out of reach', async () => {
  await withTopdownMutant([BELOW_OFF], async (TDm, SKm) => {
    const { digs, uncollected } = await caveRun(SKm)
    assert.ok(digs.some(d => d.y === 63 && d.name === 'grass_block') && uncollected.length > 0, JSON.stringify(digs.slice(0, 3)))
  })
})
await t('MUTANT KILLED (13 without the trap install): the stranded bot ends with nothing', async () => {
  await withMutantsAll(SKILLS_URL, [TRAP_INSTALL], async mod => {
    const { digs, held, r } = await caveRun(mod)
    assert.equal(held(), 0, show(r, digs)); assert.equal(digs.length, 0)
  })
})

// BLOCKER 2: inside the clean zone (home 3000,65,3000: 30 out, past the town's 16-block box, inside the zone's 64), a trench
// wall cell is refused by BOTH rules; the trap's last cell must be taken, not counted and refused
const zoneTrapRun = async (mod) => {
  const w = gatherWorld({ cells: trench(plain({ ox: 2930, oz: 2900 }), 3031), at: [3031.5, 60, 3000.5], pickup: true })
  w.bot.gatherTrap = CZ.gatherTrapOf({ x: 3031, y: 60, z: 3000 }, Date.now())
  const r = await run(mod, w.bot, { block: 'dirt', count: 16 })
  return { ...w, r }
}
await t('BLOCKER 2, CHAIN: a trapped bot in the zone, cells both rules refuse: exactly trapMax are taken (the last is not counted and refused)', async () => {
  const { bot, digs, r } = await zoneTrapRun(SK)
  const both = digs.filter(d => d.refused && CZ.gatherZoneRefuses(CZ.cleanZoneOf({ x: 3000, y: 65, z: 3000 }), d, d.name, 60))
  assert.ok(both.length > 0, `positive control: cells both rules refuse were taken: ${show(r, digs)}`)
  assert.equal(digs.length, CZ.GATHER_ZONE.trapMax, show(r, digs))
  assert.equal(both.length, CZ.GATHER_ZONE.trapMax)
  assert.equal(bot.gatherTrap.left, 0)
})
await t('MUTANT KILLED: the swing re-asks the trap after the zone counted it -> trapMax - 1', async () => {
  await withMutantsAll(SKILLS_URL, [SWING_REASK], async mod => {
    const { digs } = await zoneTrapRun(mod)
    assert.equal(digs.length, CZ.GATHER_ZONE.trapMax - 1)
  })
})

// ITEM 3: the kept cells of a given-up search go through the whole matcher chain (protectzone.mjs's findBlocks wrapper)
const PZ = await import('../src/protectzone.mjs')
const bareBeside = (x, z) => (x >= 99 && x <= 101 && z >= 99 && z <= 101) ? 'dirt' : null
const pzRun = async (mod) => {
  rows.length = 0
  const w = gatherWorld({ cells: plain({ capAt: bareBeside }), pickup: true })
  const zones = PZ.parseZones({ version: 1, zones: [{ id: 'patch', kind: 'fixture', label: 'the zone patch', box: [99, 0, 99, 101, 90, 101] }] }).zones
  const refused = []
  PZ.attachProtectZone(w.bot, { zones: () => zones, context: () => ({ skill: 'gather', args: null, reflex: null, holder: null }), onRefuse: x => refused.push(x) })
  const r = await run(mod, w.bot, { block: 'dirt', count: 1 })
  return { ...w, r, refused }
}
await t('ITEM 3, CHAIN: a given-up search does not hand back the cells the protected-zone wrapper drops (the bare patch in a zone)', async () => {
  const { digs, refused, r } = await pzRun(SK)
  assert.ok(!digs.some(d => d.x >= 99 && d.x <= 101 && d.z >= 99 && d.z <= 101), show(r, digs))
  assert.equal(refused.filter(x => x.op === 'dig').length, 0, 'never even tried at the swing')
  assert.ok(rowsOf('gather_topdown').some(x => /gave_up=1/.test(x.skill.detail)), 'positive control: the search was given up')
})
await t('MUTANT KILLED: the kept cells returned without the whole chain -> the zone\'s cells are the targets', async () => {
  await withMutantsAll(SKILLS_URL, [REFILTER], async mod => {
    const { digs, refused } = await pzRun(mod)
    assert.ok(refused.some(x => x.op === 'dig') || digs.some(d => d.x >= 99 && d.x <= 101 && d.z >= 99 && d.z <= 101), JSON.stringify({ refused: refused.length, digs: digs.slice(0, 3) }))
  })
})
// ITEM 5: the kept cells are returned (explicit); the in-range guard
await t('ITEM 5, CHAIN: a search given up after accepting open cells returns them -- the bare patch is dug, not the grass, and the row says gave_up=1', async () => {
  rows.length = 0
  const { bot, digs } = gatherWorld({ cells: plain({ capAt: bareBeside }), pickup: true })
  const r = await run(SK, bot, { block: 'dirt', count: 1 })
  assert.ok(rowsOf('gather_topdown').some(x => /^op=skip .* gave_up=1$/.test(x.skill.detail)), 'given up')
  assert.ok(digs.length > 0 && digs.every(d => d.name === 'dirt' && d.y === 63), show(r, digs))
})
await t('MUTANT KILLED: a given-up search that returns nothing loses the patch beside the bot (the grass is taken instead)', async () => {
  await withMutantsAll(SKILLS_URL, [KEPT_NONE], async mod => {
    const { bot, digs } = gatherWorld({ cells: plain({ capAt: bareBeside }), pickup: true })
    await run(mod, bot, { block: 'dirt', count: 1 })
    assert.ok(digs.length > 0 && digs[0].name === 'grass_block', JSON.stringify(digs.slice(0, 3)))
  })
})
const INRANGE_READS = {}
const farOnly = () => plain({ ox: 36 })   // the plain at x 128-144: the bot at x 100 is 28+ away from its edge, 33+ from most cells
await t('ITEM 5, CHAIN: roofed dirt only BEYOND the search -> no rule reads for it, no skip row, the base\'s "no dirt within 32" (not the remedy)', async () => {
  rows.length = 0
  const cells = new Map([...farOnly()].filter(([k]) => Number(k.split(',')[0]) >= 133))
  const { bot, digs, searches } = gatherWorld({ cells })
  const r = await run(SK, bot)
  assert.equal(digs.length, 0)
  assert.match(String(r.detail), /^no dirt within 32 blocks/, show(r, digs))
  assert.ok(!rowsOf('gather_topdown').some(x => /^op=skip/.test(x.skill.detail)))
  assert.ok(searches[0].calls > 0, 'positive control: the far cells were offered to the matcher')
  INRANGE_READS.real = searches[0].reads
})
await t('MUTANT KILLED: without the in-range guard the far cells are read, skipped, and the run ends with the remedy', async () => {
  await withMutantsAll(SKILLS_URL, [INRANGE], async mod => {
    rows.length = 0
    const cells = new Map([...farOnly()].filter(([k]) => Number(k.split(',')[0]) >= 133))
    const { bot, searches } = gatherWorld({ cells })
    const r = await run(mod, bot)
    assert.match(String(r.detail), /open to the sky/)
    assert.ok(rowsOf('gather_topdown').some(x => /^op=skip block=dirt skipped=[1-9]/.test(x.skill.detail)), 'the far cells were read and skipped')
  })
})
// ITEM 4: a bot 20 down inside a deep stone mass gathering stone: every cell in its section is deep (8 reads each, accepted)
const stoneMass = () => {
  const cells = new Map()
  for (let x = 84; x <= 116; x++) for (let z = 84; z <= 116; z++) { for (let y = 24; y <= 62; y++) cells.set(key(x, y, z), 'stone'); cells.set(key(x, 63, z), 'grass_block') }
  for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [40, 41]) cells.delete(key(x, y, z))
  return cells
}
const massReads = async (mod, env = null) => {
  if (env) process.env.TOPDOWN = env
  try {
    const { bot, digs, searches } = gatherWorld({ cells: stoneMass(), at: [100.5, 40, 100.5] })
    const r = await run(mod, bot, { block: 'stone', count: 1 })
    return { reads: searches[0].reads, calls: searches[0].calls, digs, r }
  } finally { if (env) delete process.env.TOPDOWN }
}
await t('ITEM 4, CHAIN: the read budget bounds the extra reads of the first search (stone mass); the miner still takes the rock of its room', async () => {
  const off = await massReads(SK, 'off'), on = await massReads(SK)
  let mut = null
  await withTopdownMutant([READS_OFF], async (TDm, SKm) => { mut = await massReads(SKm) })
  console.log(`  READS first search: off=${off.reads} on=${on.reads} (extra ${on.reads - off.reads}) no-budget=${mut.reads} (extra ${mut.reads - off.reads}) budget=${TD.TOPDOWN.readBudget}`)
  assert.ok(on.digs.length > 0 && on.digs.every(d => d.y >= 39 && d.y <= 42), show(on.r, on.digs))
  assert.ok(on.reads - off.reads <= TD.TOPDOWN.readBudget + 64, `extra ${on.reads - off.reads}`)
  assert.ok(mut.reads - off.reads > TD.TOPDOWN.readBudget * 1.5, `the mutant reads ${mut.reads - off.reads} extra`)
})
// ITEM 7: the second fallback's skips do not leak into the next round
await t('ITEM 7, CHAIN: skips from the second fallback search are not counted in the next round (no op=skip row when the rule never emptied a search)', async () => {
  const leakWorld = () => {
    const cells = new Map()
    for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) { for (let y = 58; y <= 62; y++) cells.set(key(x, y, z), 'stone'); cells.set(key(x, 63, z), 'grass_block') }
    for (const x of [99, 100]) cells.set(key(x, 63, 100), 'dirt')                    // open dirt, unsafe to break (below)
    for (let x = 104; x <= 106; x++) cells.set(key(x, 64, 100), 'stone')            // three roofed grass cells
    return cells
  }
  const go = async mod => {
    rows.length = 0
    const w = gatherWorld({ cells: leakWorld(), pickup: true })
    w.bot.collectBlock.movements.safeToBreak = b => b?.name !== 'dirt'
    const r = await run(mod, w.bot, { block: 'dirt', count: 2 })
    return { ...w, r, skip: rowsOf('gather_topdown').filter(x => /^op=skip/.test(x.skill.detail)) }
  }
  const real = await go(SK)
  assert.ok(real.digs.some(d => d.name === 'grass_block'), `positive control: the second fallback took grass: ${show(real.r, real.digs)}`)
  assert.deepEqual(real.skip.map(x => x.skill.detail), [])
  await withMutantsAll(SKILLS_URL, [LEAK], async mod => {
    const m = await go(mod)
    assert.ok(m.skip.length > 0, 'the mutant counts the second fallback\'s skips into the next round')
  })
})
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
