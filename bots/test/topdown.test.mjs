// TOPDOWN-01 (topdown.mjs + skills.mjs gather; owner 2026-11-15 "Yes, authorize"): a bot IN THE OPEN takes ground only FROM
// THE TOP. WHY: bots gathered dirt from under the grass and left roofed hollows -- 3,103 columns under the showcase lawn, a ring
// of 488 undermined columns just outside the town square on the rehearsal world (docs/reports/land-eval-2026-11-14/dirt-loop.md
// on main). A SHELTERED bot (under a roof, at the bottom of a hole) is exempt and gathers as the base does; what it still takes
// is counted (op=sheltered). The rule is pure and tested as such; the chain is driven through the REAL gather skill over a fake
// world of named, layered cells WHERE THE BOTS LIVE: the surface at y 70 (home y 70), not below sea level, unless a test is
// about depth.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
// home far away from the world at x,z ~100: neither the town's ground nor the clean zone reaches it (the zone test works at 3030)
process.env.HOME_X = '3000'; process.env.HOME_Y = '70'; process.env.HOME_Z = '3000'
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
const SURF = 70

const rows = []
LG.tapRecords(r => rows.push(r))
const rowsOf = kind => rows.filter(r => r?.skill?.name === `_${kind}`)
const tdRows = op => rowsOf('gather_topdown').filter(r => r.skill.detail.startsWith(`op=${op} `))

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
// skills.mjs: the three conjuncts, the trap's one answer, the exemption, the search's bound, the kept cells, the second fallback
const ENUM = ['        const roofHit = topDownHit(bot, b.position, b.name, { shelter: tdShelter, solid: tdSolid })', '        const roofHit = false']
const SAFE = ['      !topDownHit(bot, p, bot.blockAt(p)?.name) &&   // topdown-01', '      true &&   // topdown-01']
const SWING = ['  if (topDownHit(bot, block.position, block.name, { trapLets: tdTrapLets })) {', '  if (false) {']
const SWING_REASK = ['  if (topDownHit(bot, block.position, block.name, { trapLets: tdTrapLets })) {', '  if (topDownHit(bot, block.position, block.name)) {']
const TRAP = ['trapLets: trapLets === undefined ? gatherTrapAllows(bot?.gatherTrap, p, Date.now()) : trapLets', 'trapLets: false']
const EXEMPT_OFF = ['sheltered: !!(shelter === undefined ? shelterOf(bot) : shelter)', 'sheltered: false']
const EXEMPT_INV = ['sheltered: !!(shelter === undefined ? shelterOf(bot) : shelter)', 'sheltered: !(shelter === undefined ? shelterOf(bot) : shelter)']
// a remembered shelter: the first answer kept on the bot (what round two's B2 was)
const STALE = ['return f ? shelteredAt(roofAt(bot), f) : null } catch { return null } }', 'if (bot.__tdSeen === undefined) bot.__tdSeen = f ? shelteredAt(roofAt(bot), f) : null; return bot.__tdSeen } catch { return null } }']
const GIVEUP = ['        if (topDownGiveUp(roofSearch, TOPDOWN, roofReads)) throw TD_GIVE_UP\n', '']
const REFILTER = ['        return bot.findBlocks({ matching: b => (b?.position ? ks.has(', '        return kept; return bot.findBlocks({ matching: b => (b?.position ? ks.has(']
const KEPT_NONE = ['        if (!kept.length) return []\n', '        return []\n']
const LEAK = ['        const found = findGround(altType.id, { count: false })', '        const found = findGround(altType.id)']
const INRANGE = ['      if (b.position && searchFrom && b.position.distanceTo(searchFrom) <= maxDistance) {\n        const roofHit', '      if (b.position) {\n        const roofHit']
// topdown.mjs: the deep cases, leaves, the pitted check and threshold, made ground, its lifting, the read budget
const DEEP_STRAIGHT = ["  if (n >= T.deep) return 'deep'\n", '']
const DEEP_FLOOR = ["    return t >= T.deep ? 'deep' : 'roofed'", "    return 'roofed'"]
const LEAVES = [" && !LEAVES.test(String(b.name ?? ''))", '']
const PIT_OFF = ["  return cover === 'open' && isPitted(solidAt, p, T) ? 'cover' : null", '  return null']
const PIT_5 = ['pit: 2,', 'pit: 5,']
const MADE_OFF = ["  if (isMadeGround(blockName)) return 'made'\n", '']
const MADE_LIFT = ["verdict === 'made' || (verdict === 'cover' && !sheltered && !trapLets)", "(verdict === 'made' || verdict === 'cover') && !sheltered && !trapLets"]
const READS_OFF = ['skipped >= T.giveUp || reads >= T.readBudget', 'skipped >= T.giveUp']

// ---- pure ------------------------------------------------------------------------------------------------------------
const solidSet = cells => { const s = new Set(cells.map(c => c.join(','))); return (x, y, z) => s.has(`${x},${y},${z}`) }
const col = (x, z, y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) out.push([x, y, z]); return out }
const P = { x: 0, y: 60, z: 0 }
const blockNamed = name => name ? { name, boundingBox: mcData.blocksByName[name].boundingBox } : null
const roofOf = (isRoof, byY) => (x, y, z) => x === 0 && z === 0 && isRoof(blockNamed(byY[y]))

await t('COVER: open; roofed under one block; the floor of a shallow hollow; deep under 8 straight; a cave floor under an 8-thick roof; only the column above counts', () => {
  assert.equal(TD.coverOf(solidSet([]), P), 'open')
  assert.equal(TD.coverOf(solidSet([[0, 61, 0]]), P), 'roofed', 'the dirt under the grass')
  assert.equal(TD.coverOf(solidSet([[0, 63, 0]]), P), 'roofed', 'the floor of a hollow')
  assert.equal(TD.coverOf(solidSet([[0, 60 + 1 + TD.TOPDOWN.air, 0]]), P), 'roofed', 'a roof at the edge of the look-up')
  assert.equal(TD.coverOf(solidSet([[0, 60 + 2 + TD.TOPDOWN.air, 0]]), P), 'open')
  assert.equal(TD.coverOf(solidSet(col(0, 0, 61, 68)), P), 'deep'); assert.equal(TD.coverOf(solidSet(col(0, 0, 61, 67)), P), 'roofed')
  assert.equal(TD.coverOf(solidSet(col(0, 0, 63, 70)), P), 'deep'); assert.equal(TD.coverOf(solidSet(col(0, 0, 63, 69)), P), 'roofed')
  assert.equal(TD.coverOf(solidSet([[1, 61, 0], [0, 61, 1]]), P), 'open')
})
await t('ROOF: leaves are not a roof, a log is; an unread cell is not; no-collision blocks are not', () => {
  assert.equal(TD.isRoofBlock(blockNamed('oak_leaves')), false); assert.equal(TD.isRoofBlock(blockNamed('oak_log')), true)
  assert.equal(TD.isRoofBlock(null), false)
  for (const n of ['air', 'water', 'short_grass', 'snow', 'torch']) assert.equal(TD.isRoofBlock(blockNamed(n)), false, n)
  assert.equal(TD.coverOf(roofOf(TD.isRoofBlock, { 64: 'oak_leaves', 65: 'oak_leaves' }), P), 'open')
  assert.equal(TD.coverOf(roofOf(TD.isRoofBlock, { 61: 'oak_log' }), P), 'roofed')
})
await t('VERDICT: terrain under a roof or at the bottom of a hole is cover; farmland and dirt_path are made; ores, logs, crops nothing; open level and deep ground nothing', () => {
  const roof = solidSet([[0, 61, 0]])
  for (const n of ['dirt', 'grass_block', 'stone', 'sand', 'gravel', 'clay']) assert.equal(TD.topDownVerdict(roof, P, n), 'cover', n)
  for (const n of ['iron_ore', 'deepslate_iron_ore', 'oak_log', 'oak_leaves', 'wheat', 'crafting_table']) assert.equal(TD.topDownVerdict(roof, P, n), null, n)
  for (const n of ['farmland', 'dirt_path']) { assert.equal(TD.topDownVerdict(solidSet([]), P, n), 'made', n); assert.equal(TD.isMadeGround(n), true) }
  assert.equal(TD.topDownVerdict(solidSet([]), P, 'dirt'), null)
  assert.equal(TD.topDownVerdict(solidSet(col(0, 0, 61, 70)), P, 'stone'), null, 'deep')
  assert.equal(TD.topDownRefuses(roof, P, 'dirt'), true); assert.equal(TD.topDownRefuses(roof, null, 'dirt'), false)
})
await t('REFUSAL: made ground is refused for EVERY bot (sheltered, trap); cover is lifted by shelter or by the trap; nothing else is refused', () => {
  for (const o of [{}, { sheltered: true }, { trapLets: true }, { sheltered: true, trapLets: true }]) assert.equal(TD.topDownRefusal('made', o), true, JSON.stringify(o))
  assert.equal(TD.topDownRefusal('cover', {}), true)
  assert.equal(TD.topDownRefusal('cover', { sheltered: true }), false); assert.equal(TD.topDownRefusal('cover', { trapLets: true }), false)
  assert.equal(TD.topDownRefusal(null, {}), false)
})
await t('NO SHAFTS (pitted): an open cell with 2+ of its 4 sides higher is cover; 0 or 1 is taken; a deep cell never is; the scraped 3x3 patch', () => {
  const side = [[1, 61, 0], [-1, 61, 0], [0, 61, 1], [0, 61, -1]]
  for (let k = 0; k <= 4; k++) { const s = solidSet(side.slice(0, k)); assert.equal(TD.hemmedIn(s, P), k); assert.equal(TD.topDownRefuses(s, P, 'dirt'), k >= 2, `${k}`) }
  assert.equal(TD.hemmedIn(solidSet([[1, 60, 0], [1, 62, 0], [1, 61, 1]]), P), 0, 'only y+1, only the four sides')
  const grass = []
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) === 2 || Math.abs(z) === 2) grass.push([x, 61, z])
  const s = solidSet(grass)
  assert.equal(TD.topDownRefuses(s, { x: 0, y: 60, z: 0 }, 'dirt'), false); assert.equal(TD.topDownRefuses(s, { x: 1, y: 60, z: 0 }, 'dirt'), false)
  assert.equal(TD.topDownRefuses(s, { x: 1, y: 60, z: 1 }, 'dirt'), true, 'a corner')
  const corridor = solidSet([...col(0, 0, 63, 90), ...col(1, 0, 60, 90), ...col(-1, 0, 60, 90)])
  assert.equal(TD.topDownRefuses(corridor, P, 'stone'), false); assert.equal(TD.isPitted(corridor, P), true)
})
await t('SHELTER: roofed or deep feet -> roofed; open with 3+ sides solid at head height -> pit; a 1-deep scrape, a 1-wide trench, open ground -> none', () => {
  const at = { x: 0, y: 60, z: 0 }
  const sides = y => [[1, y, 0], [-1, y, 0], [0, y, 1], [0, y, -1]]
  assert.deepEqual(TD.shelteredAt(solidSet([[0, 63, 0]]), at), { kind: 'roofed', feetY: 60 })
  assert.deepEqual(TD.shelteredAt(solidSet(col(0, 0, 62, 90)), at), { kind: 'roofed', feetY: 60 })
  assert.equal(TD.shelteredAt(solidSet(sides(60)), at), null, 'a 1-deep scrape')
  assert.deepEqual(TD.shelteredAt(solidSet([...sides(60), ...sides(61)]), at), { kind: 'pit', feetY: 60 })
  assert.deepEqual(TD.shelteredAt(solidSet(sides(61).slice(0, 3)), at), { kind: 'pit', feetY: 60 })
  assert.equal(TD.shelteredAt(solidSet([[1, 61, 0], [-1, 61, 0]]), at), null, 'a trench: two sides')
  assert.deepEqual(TD.shelteredAt(solidSet([...sides(62), [1, 61, 0]]), at), { kind: 'pit', feetY: 60 }, 'notches cut at head height under solid ground are still walls')
  assert.equal(TD.shelteredAt(solidSet(sides(63)), at), null, 'solid only from feet + 3 up: not a wall at the step')
  assert.equal(TD.shelteredAt(solidSet([]), at), null); assert.equal(TD.shelteredAt(solidSet([]), null), null)
})
await t('COST: an open cell costs 1 + air + 4 reads, a roofed one 2, a deep one 8, made ground 0; the cover alone at most 1 + air + deep', () => {
  let n = 0
  const counting = s => (x, y, z) => { n++; return s(x, y, z) }
  TD.topDownVerdict(counting(solidSet([])), P, 'dirt'); assert.equal(n, 1 + TD.TOPDOWN.air + 4); n = 0
  TD.topDownVerdict(counting(solidSet([[0, 61, 0]])), P, 'dirt'); assert.equal(n, 2); n = 0
  TD.topDownVerdict(counting(solidSet(col(0, 0, 61, 90))), P, 'stone'); assert.equal(n, TD.TOPDOWN.deep); n = 0
  TD.topDownVerdict(counting(solidSet([])), P, 'farmland'); assert.equal(n, 0); n = 0
  TD.coverOf(counting(solidSet(col(0, 0, 60 + 1 + TD.TOPDOWN.air, 120))), P); assert.ok(n <= 1 + TD.TOPDOWN.air + TD.TOPDOWN.deep)
})
await t('SWITCH, BOUND, ROW, WORDS: TOPDOWN=off; give up at 256 skips or the read budget; the mode row; the open-ground remedy, true for a bot on a plain near home', () => {
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.equal(TD.topDownOn({ TOPDOWN: v }), false, v)
  for (const v of [undefined, '', '1', 'on']) assert.equal(TD.topDownOn({ TOPDOWN: v }), true, String(v))
  assert.equal(TD.topDownGiveUp(255), false); assert.equal(TD.topDownGiveUp(256), true)
  assert.equal(TD.topDownGiveUp(0, TD.TOPDOWN, 16383), false); assert.equal(TD.topDownGiveUp(0, TD.TOPDOWN, 16384), true)
  assert.equal(TD.topDownModeDetail({}), 'op=mode on=1 deep=8 air=16 pit=2 hole=3 give_up=256 reads=16384')
  const r = TD.topDownRemedy('dirt', 12, 32)
  assert.match(r, /^no dirt open to the sky within 32 blocks \(12 under a roof/)
  assert.match(r, /gather where it lies open, or `mine` to go down for rock \(mine digs nothing within 12 blocks of home: walk out at least 20 blocks from home first\)$/)
  assert.match(TD.topDownRemedy('dirt', 1, 0), /^no dirt open to the sky here \(/)
})
await t('MUTANTS KILLED (topdown.mjs, pure): both deep cases, leaves, pitted off, pitted 2 -> 5, made ground off, made ground lifted, read budget off', async () => {
  await withTopdownMutant([DEEP_STRAIGHT], async M => { assert.equal(M.coverOf(solidSet(col(0, 0, 61, 68)), P), 'roofed') })
  await withTopdownMutant([DEEP_FLOOR], async M => { assert.equal(M.coverOf(solidSet(col(0, 0, 63, 70)), P), 'roofed') })
  await withTopdownMutant([LEAVES], async M => { assert.equal(M.isRoofBlock(blockNamed('oak_leaves')), true) })
  const two = solidSet([[1, 61, 0], [0, 61, 1]])
  await withTopdownMutant([PIT_OFF], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt'), false) })
  await withTopdownMutant([PIT_5], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt'), false) })
  await withTopdownMutant([MADE_OFF], async M => { assert.equal(M.topDownRefuses(solidSet([]), P, 'farmland'), false) })
  await withTopdownMutant([MADE_LIFT], async M => { assert.equal(M.topDownRefusal('made', { sheltered: true }), false) })
  await withTopdownMutant([READS_OFF], async M => { assert.equal(M.topDownGiveUp(0, M.TOPDOWN, M.TOPDOWN.readBudget), false) })
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
const DROP = { grass_block: 'dirt', dirt: 'dirt', stone: 'cobblestone', cobblestone: 'cobblestone', farmland: 'dirt', dirt_path: 'dirt', sand: 'sand' }
function gatherWorld ({ cells, at = [100.5, SURF + 1, 100.5], items = [], pickup = false, reach = false }) {
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
  const held = () => items.reduce((n, i) => n + (['dirt', 'cobblestone', 'sand'].includes(i.name) ? i.count : 0), 0)
  const bag = () => Object.fromEntries(items.map(i => [i.name, i.count]).sort())
  return { bot, digs, searches, uncollected, counts, held, bag }
}
// A plain: stone, then `dirt` layers, then the cap (grass_block) at `top`, over [x0..x1] x [z0..z1]
function plain ({ x0 = 92, x1 = 108, z0 = 92, z1 = 108, top = SURF, dirt = 3, floor = 62, cap = 'grass_block', capAt = null, ox = 0, oz = 0 } = {}) {
  const cells = new Map()
  for (let x = x0 + ox; x <= x1 + ox; x++) for (let z = z0 + oz; z <= z1 + oz; z++) {
    for (let y = floor; y < top - dirt; y++) cells.set(key(x, y, z), 'stone')
    for (let y = top - dirt; y < top; y++) cells.set(key(x, y, z), 'dirt')
    cells.set(key(x, top, z), capAt?.(x, z) ?? cap)
  }
  return cells
}
// a trench along x = 101 down to the stone: the dirt either side is EXPOSED from the side and roofed by the grass
function trench (cells, x = 101, top = SURF, bottom = SURF - 3) {
  for (const k of [...cells.keys()]) { const [cx, cy] = k.split(',').map(Number); if (cx === x && cy >= bottom && cy <= top) cells.delete(k) }
  return cells
}
// every run outside the zone asserts this rule created no trap (bot.gatherTrap is the clean zone's alone)
const run = async (mod, bot, args = { block: 'dirt', count: 1 }, { trapOk = false } = {}) => {
  const r = await mod.SKILLS.gather.run({ bot }, args, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  if (!trapOk) assert.equal(bot.gatherTrap, undefined, 'this rule never creates a trap')
  return r
}
const show = (r, digs) => `${JSON.stringify(r).slice(0, 220)} digs=${JSON.stringify(digs.slice(0, 6))}`
// ---- chain helpers ----------------------------------------------------------------------------------------------------
const LAWN = [100.5, SURF + 1, 100.5]
const keyOf = d => `${d.x},${d.y},${d.z}:${d.name}`
const DIRT8 = () => [{ name: 'dirt', count: 8, type: mcData.itemsByName.dirt.id }]
// the same world and request with TOPDOWN=off and with the rule: dug cells (in order) and the bag
async function bothWays (makeCells, at, args, items = () => []) {
  process.env.TOPDOWN = 'off'
  let off
  try { const w = gatherWorld({ cells: makeCells(), at, pickup: true, reach: true, items: items() }); const r = await run(SK, w.bot, args); off = { ...w, r } } finally { delete process.env.TOPDOWN }
  rows.length = 0
  const w = gatherWorld({ cells: makeCells(), at, pickup: true, reach: true, items: items() })
  const r = await run(SK, w.bot, args)
  return { off, on: { ...w, r } }
}
function assertSame ({ off, on }, what) {
  assert.deepEqual(on.digs.map(keyOf), off.digs.map(keyOf), `${what}: the same cells as the base (on ${JSON.stringify(on.digs.map(keyOf))} off ${JSON.stringify(off.digs.map(keyOf))})`)
  assert.deepEqual(on.bag(), off.bag(), `${what}: the same bag`)
}
function assertShelteredRow ({ on }, kind) {
  const took = on.digs.filter(d => d.refused)
  assert.ok(took.length > 0, 'positive control: the sheltered bot took cells this rule refuses in the open')
  const r = tdRows('sheltered')
  assert.equal(r.length, 1, 'one op=sheltered row a run')
  assert.match(r[0].skill.detail, new RegExp(`^op=sheltered kind=${kind} block=\\w+ pos=-?\\d+,-?\\d+,-?\\d+$`))
}
const pitAt = (D) => { const c = plain(); for (let y = SURF - D + 1; y <= SURF; y++) c.delete(key(100, y, 100)); return c }

// ---- the chain, in the open ---------------------------------------------------------------------------------------------
await t('(1) POSITIVE CONTROL, TOPDOWN=off: on the plain the base digs dirt from under the grass (the harness can see an under-roof dig)', async () => {
  process.env.TOPDOWN = 'off'
  try {
    const { bot, digs } = gatherWorld({ cells: trench(plain()) })
    const r = await run(SK, bot)
    assert.ok(digs.some(d => d.name === 'dirt' && d.straight && !d.open), show(r, digs))
  } finally { delete process.env.TOPDOWN }
})
await t('(a) IN THE OPEN: `gather dirt count=6` on the plain at y 70 scrapes the grass tops, takes nothing under a roof or pitted, and holds 6 dirt; the row says sheltered=0', async () => {
  rows.length = 0
  const { bot, digs, held } = gatherWorld({ cells: plain(), pickup: true, reach: true })
  const r = await run(SK, bot, { block: 'dirt', count: 6 })
  assert.equal(r.status, 'success', show(r, digs)); assert.equal(held(), 6)
  assert.ok(digs.every(d => d.open && !d.refused), JSON.stringify(digs))
  assert.ok(digs.slice(0, 4).every(d => d.y === SURF && d.name === 'grass_block'))
  assert.ok(new Set(digs.map(d => `${d.x},${d.z}`)).size >= 5)
  assert.ok(digs.every(d => d.y >= SURF - 1), 'nothing deeper than 2')
  assert.match(tdRows('skip')[0].skill.detail, / sheltered=0$/)
})
await t('(b) THE SCRAPED 3x3 PATCH: its centre and four edges are taken, never its corners', async () => {
  const cells = plain()
  for (let x = 99; x <= 101; x++) for (let z = 99; z <= 101; z++) cells.delete(key(x, SURF, z))
  const { bot, digs, held } = gatherWorld({ cells, at: [100.5, SURF, 100.5], pickup: true })
  const r = await run(SK, bot, { block: 'dirt', count: 5 })
  assert.deepEqual(digs.map(d => `${d.x},${d.y},${d.z}`).sort(), ['100,69,100', '99,69,100', '101,69,100', '100,69,99', '100,69,101'].sort(), show(r, digs))
  assert.equal(held(), 5)
})
await t('(3) open dirt lying on the surface is taken as before, with no fallback', async () => {
  rows.length = 0
  const bare = (x, z) => (x >= 99 && x <= 101 && z >= 99 && z <= 101) ? 'dirt' : null
  const { bot, digs } = gatherWorld({ cells: plain({ capAt: bare }), pickup: true })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs.every(d => d.name === 'dirt' && d.open), show(r, digs))
  assert.equal(rowsOf('gather_via_source').length, 0)
})
await t('(j) THE REMEDY IN THE OPEN: a stone plain over soil, nothing open -> nothing_found with the open-ground text, nothing dug', async () => {
  const { bot, digs } = gatherWorld({ cells: plain({ cap: 'stone' }) })
  const r = await run(SK, bot)
  assert.equal(digs.length, 0); assert.equal(r.failClass, 'nothing_found')
  assert.match(String(r.detail), /^no dirt open to the sky within 32 blocks \(\d+ under a roof .* walk out at least 20 blocks from home first\)/)
})
await t('(2b) the op=mode row is written once per bot process', async () => {
  rows.length = 0
  const { bot } = gatherWorld({ cells: plain() })
  await run(SK, bot); await run(SK, bot)
  assert.equal(tdRows('mode').length <= 1, true)
})

// ---- the sheltered bot gathers as the base does -------------------------------------------------------------------------
for (const D of [2, 3, 5]) {
  for (const holding of [false, true]) {
    await t(`(c) A 1x1 PIT ${D} DEEP, ${holding ? 'holding 8' : 'empty bag'}: exactly what TOPDOWN=off digs and holds; one op=sheltered row`, async () => {
      const res = await bothWays(() => pitAt(D), [100.5, SURF - D + 1, 100.5], { block: 'dirt', count: 8 }, holding ? DIRT8 : () => [])
      assertSame(res, `pit ${D}`)
      assert.ok(res.on.digs.length > 0, 'positive control: something was dug')
      assertShelteredRow(res, 'pit')
    })
  }
}
await t('MUTANT KILLED: without the exemption the empty-handed pit bot ends holding nothing (round one\'s blocker returns)', async () => {
  await withMutantsAll(SKILLS_URL, [EXEMPT_OFF], async mod => {
    const w = gatherWorld({ cells: pitAt(4), at: [100.5, SURF - 3, 100.5], pickup: true, reach: true })
    await run(mod, w.bot, { block: 'dirt', count: 8 })
    assert.equal(w.held(), 0, JSON.stringify(w.digs.slice(0, 4)))
  })
})
await t('MUTANT KILLED: the exemption inverted -> the bot in the open hollows the plain (dirt under grass taken)', async () => {
  await withMutantsAll(SKILLS_URL, [EXEMPT_INV], async mod => {
    const w = gatherWorld({ cells: trench(plain()), pickup: true })
    await run(mod, w.bot, { block: 'dirt', count: 4 })
    assert.ok(w.digs.some(d => d.refused), JSON.stringify(w.digs.slice(0, 4)))
  })
})
// a roofed hollow 2 high under the lawn: air at y 67-68 (x,z 98-102) under dirt 69 and grass 70; the bot on its floor (dirt 66)
const hollow = () => { const c = plain(); for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [67, 68]) c.delete(key(x, y, z)); return c }
for (const holding of [false, true]) {
  await t(`(d) A ROOFED HOLLOW 2 HIGH under the lawn at y 70, ${holding ? 'holding 8' : 'empty bag'}: exactly what TOPDOWN=off does`, async () => {
    const res = await bothWays(hollow, [100.5, 67, 100.5], { block: 'dirt', count: 8 }, holding ? DIRT8 : () => [])
    assertSame(res, 'hollow')
    assert.ok(res.on.digs.length > 0)
    assertShelteredRow(res, 'roofed')
  })
}
// a cave floor 5 below the lawn under a 2-block stone ceiling: grass 70, dirt 68-69, stone 66-67, air 64-65, the cave's layer
// (y 63-65) of `layer`, stone below
function caveWorld (layer = 'dirt') {
  const cells = new Map()
  for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) {
    for (let y = 56; y <= 62; y++) cells.set(key(x, y, z), 'stone')
    for (let y = 63; y <= 65; y++) cells.set(key(x, y, z), layer)
    for (const y of [66, 67]) cells.set(key(x, y, z), 'stone')
    for (const y of [68, 69]) cells.set(key(x, y, z), 'dirt')
    cells.set(key(x, SURF, z), 'grass_block')
  }
  for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [64, 65]) cells.delete(key(x, y, z))
  return cells
}
for (const [layer, block] of [['dirt', 'dirt'], ['stone', 'cobblestone']]) {
  await t(`(e) A CAVE FLOOR 5 BELOW under a 2-block ceiling, ${block}: exactly what TOPDOWN=off does`, async () => {
    const res = await bothWays(() => caveWorld(layer), [100.5, 64, 100.5], { block, count: 8 })
    assertSame(res, 'cave')
    assert.ok(res.on.held() > 0, 'it ends holding blocks')
  })
}
await t('(e2) CODEX r2 B3: a shallow stone hollow asking for cobblestone with ONE buried cobblestone deeper nearby: as TOPDOWN=off', async () => {
  const scene = () => { const c = caveWorld('stone'); c.set(key(100, 58, 100), 'cobblestone'); return c }
  const res = await bothWays(scene, [100.5, 64, 100.5], { block: 'cobblestone', count: 8 })
  assertSame(res, 'stone hollow + buried cobblestone')
  assert.ok(res.on.held() > 0, `it ends holding ${res.on.held()}`)
})
await t('(f) NO STALE STATE: a bot that gathered in a pit is moved onto the lawn and gathers at once: the rule applies again (grass tops, not the pit\'s walls)', async () => {
  const w = gatherWorld({ cells: pitAt(3), at: [100.5, SURF - 2, 100.5], pickup: true, reach: true })
  await run(SK, w.bot, { block: 'dirt', count: 2 })
  const before = w.digs.length
  w.bot.entity.position = new Vec3(103.5, SURF + 1, 103.5)
  const r = await run(SK, w.bot, { block: 'dirt', count: 2 })
  const after = w.digs.slice(before)
  assert.ok(after.length > 0 && after[0].name === 'grass_block' && after.every(d => !d.refused), show(r, after))
})
await t('MUTANT KILLED: a remembered shelter (the first answer kept) -> on the lawn the bot still takes cells the rule refuses', async () => {
  await withMutantsAll(SKILLS_URL, [STALE], async mod => {
    const w = gatherWorld({ cells: pitAt(3), at: [100.5, SURF - 2, 100.5], pickup: true, reach: true })
    await run(mod, w.bot, { block: 'dirt', count: 2 })
    const before = w.digs.length
    w.bot.entity.position = new Vec3(103.5, SURF + 1, 103.5)
    await run(mod, w.bot, { block: 'dirt', count: 2 })
    assert.ok(w.digs.slice(before).some(d => d.refused), JSON.stringify(w.digs.slice(before, before + 3)))
  })
})
await t('(g) A 1-WIDE TRENCH 2 DEEP: in its middle the bot is not sheltered (the rule applies); at its end it is (as TOPDOWN=off)', async () => {
  const tr = () => { const c = plain(); for (let z = 95; z <= 105; z++) for (const y of [SURF - 1, SURF]) c.delete(key(101, y, z)); return c }
  const mid = gatherWorld({ cells: tr(), at: [101.5, SURF - 1, 100.5], pickup: true, reach: true })
  const rm = await run(SK, mid.bot, { block: 'dirt', count: 4 })
  assert.ok(mid.digs.length > 0 && mid.digs.every(d => !d.refused), `the middle: the rule applies: ${show(rm, mid.digs)}`)
  const res = await bothWays(tr, [101.5, SURF - 1, 95.5], { block: 'dirt', count: 4 })
  assertSame(res, 'trench end')
  assertShelteredRow(res, 'pit')
})
await t('(h) SAND: on a beach in the open only the top sand (a scrape); from inside a 2-deep sand hole as TOPDOWN=off, with the row; no trap', async () => {
  // a beach: sand 66-70 on stone
  const beach = () => { const c = new Map(); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) { for (let y = 62; y <= 65; y++) c.set(key(x, y, z), 'stone'); for (let y = 66; y <= SURF; y++) c.set(key(x, y, z), 'sand') } return c }
  const open = gatherWorld({ cells: beach(), pickup: true, reach: true })
  const ro = await run(SK, open.bot, { block: 'sand', count: 4 })
  assert.ok(open.digs.length > 0 && open.digs.every(d => d.name === 'sand' && d.open && !d.refused), show(ro, open.digs))
  assert.ok(open.digs.slice(0, 4).every(d => d.y === SURF), 'the tops')
  const hole = () => { const c = beach(); for (const y of [SURF - 1, SURF]) c.delete(key(100, y, 100)); return c }
  const res = await bothWays(hole, [100.5, SURF - 1, 100.5], { block: 'sand', count: 4 })
  assertSame(res, 'sand hole')
  assertShelteredRow(res, 'pit')
})
// MADE GROUND for every bot (Codex r2 addendum 1)
const stoneHollowWith = (extra) => { const c = new Map(); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) for (let y = 60; y <= SURF; y++) c.set(key(x, y, z), 'stone'); for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [67, 68]) c.delete(key(x, y, z)); extra(c); return c }
await t('MADE GROUND, sheltered: a path beside the bot at its own height is never taken; with it the ONLY source, the base\'s not-found ending', async () => {
  const onlyPath = () => stoneHollowWith(c => c.set(key(97, 67, 100), 'dirt_path'))
  process.env.TOPDOWN = 'off'
  let off
  try { off = gatherWorld({ cells: onlyPath(), at: [100.5, 67, 100.5], pickup: true, reach: true }); await run(SK, off.bot, { block: 'dirt', count: 1 }) } finally { delete process.env.TOPDOWN }
  assert.ok(off.digs.some(d => d.name === 'dirt_path'), 'positive control: the base takes the path through its fallback')
  const on = gatherWorld({ cells: onlyPath(), at: [100.5, 67, 100.5], pickup: true, reach: true })
  const r = await run(SK, on.bot, { block: 'dirt', count: 1 })
  assert.equal(on.digs.length, 0, show(r, on.digs))
  assert.equal(r.failClass, 'nothing_found'); assert.match(String(r.detail), /^no dirt within 32 blocks/, 'the base\'s ending, not the open-ground remedy')
  // and with dirt beside it too, the sheltered bot takes what the base takes
  const both = () => stoneHollowWith(c => { c.set(key(97, 67, 100), 'dirt_path'); c.set(key(103, 67, 100), 'dirt') })
  assertSame(await bothWays(both, [100.5, 67, 100.5], { block: 'dirt', count: 1 }), 'path + dirt')
  await withTopdownMutant([MADE_LIFT], async (TDm, SKm) => {
    const m = gatherWorld({ cells: onlyPath(), at: [100.5, 67, 100.5], pickup: true, reach: true })
    await run(SKm, m.bot, { block: 'dirt', count: 1 })
    assert.ok(m.digs.some(d => d.name === 'dirt_path'), 'the mutant lifts made ground for a sheltered bot')
  })
})
await t('(4) DEPTH: a bot 20 down in a stone mass takes the rock of its room, exactly as TOPDOWN=off', async () => {
  const mass = () => { const c = new Map(); for (let x = 94; x <= 106; x++) for (let z = 94; z <= 106; z++) { for (let y = 40; y < SURF; y++) c.set(key(x, y, z), 'stone'); c.set(key(x, SURF, z), 'grass_block') } for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [50, 51]) c.delete(key(x, y, z)); return c }
  const res = await bothWays(mass, [100.5, 50, 100.5], { block: 'stone', count: 2 })
  assertSame(res, 'mass'); assert.ok(res.on.digs.length > 0)
})

// ---- the clean zone's trap ----------------------------------------------------------------------------------------------
// inside the zone (home 3000,70,3000: 30 out, past the town's 16-block box, inside its 64), a trench's wall cell is refused by
// BOTH rules; the trap's last cell is taken, not counted by the zone and then refused here (review r1 blocker 2)
const zoneTrapRun = async (mod, cells = trench(plain({ ox: 2930, oz: 2900 }), 3031)) => {
  const w = gatherWorld({ cells, at: [3031.5, SURF - 3, 3000.5], pickup: true })
  w.bot.gatherTrap = CZ.gatherTrapOf({ x: 3031, y: SURF - 3, z: 3000 }, Date.now())
  const r = await run(mod, w.bot, { block: 'dirt', count: 16 }, { trapOk: true })
  return { ...w, r }
}
await t('(i) THE ZONE\'S TRAP: a trapped bot in the zone, cells both rules refuse: exactly trapMax are taken', async () => {
  const { bot, digs, r } = await zoneTrapRun(SK)
  const both = digs.filter(d => d.refused && CZ.gatherZoneRefuses(CZ.cleanZoneOf({ x: 3000, y: SURF, z: 3000 }), d, d.name, SURF - 3))
  assert.equal(digs.length, CZ.GATHER_ZONE.trapMax, show(r, digs))
  assert.equal(both.length, CZ.GATHER_ZONE.trapMax); assert.equal(bot.gatherTrap.left, 0)
})
await t('MUTANT KILLED: the swing re-asks the trap after the zone counted it down -> trapMax - 1', async () => {
  await withMutantsAll(SKILLS_URL, [SWING_REASK], async mod => { const { digs } = await zoneTrapRun(mod); assert.equal(digs.length, CZ.GATHER_ZONE.trapMax - 1) })
})
await t('MADE GROUND, zone trap: a zone-trapped bot beside farmland does not take it (its only source in reach)', async () => {
  const field = () => { const c = new Map(); for (let x = 3022; x <= 3038; x++) for (let z = 2992; z <= 3008; z++) { for (let y = 60; y < SURF; y++) c.set(key(x, y, z), 'stone'); c.set(key(x, SURF, z), 'farmland') } for (let z = 2992; z <= 3008; z++) for (let y = SURF - 3; y <= SURF; y++) c.delete(key(3031, y, z)); return c }
  const { digs, r } = await zoneTrapRun(SK, field())
  assert.ok(!digs.some(d => d.name === 'farmland'), show(r, digs))
  await withTopdownMutant([MADE_LIFT], async (TDm, SKm) => {
    const m = await zoneTrapRun(SKm, field())
    assert.ok(m.digs.some(d => d.name === 'farmland'), 'the mutant lets the trap take the field')
  })
})
await t('(5) a cell the zone\'s trap lets through is taken although roofed; without the trap it is not (outside the zone, the trap set by hand)', async () => {
  const at = [101.5, SURF - 3, 100.5]
  const trapped = gatherWorld({ cells: trench(plain()), at, pickup: true })
  trapped.bot.gatherTrap = CZ.gatherTrapOf({ x: 101, y: SURF - 3, z: 100 }, Date.now())
  const r = await run(SK, trapped.bot, { block: 'dirt', count: 1 }, { trapOk: true })
  assert.ok(trapped.digs.some(d => d.name === 'dirt' && !d.open), show(r, trapped.digs))
  await withMutantsAll(SKILLS_URL, [TRAP], async mod => {
    const m = gatherWorld({ cells: trench(plain()), at, pickup: true })
    m.bot.gatherTrap = CZ.gatherTrapOf({ x: 101, y: SURF - 3, z: 100 }, Date.now())
    await run(mod, m.bot, { block: 'dirt', count: 1 }, { trapOk: true })
    assert.ok(m.digs.every(d => d.open), 'the mutant refuses the trap\'s cells')
  })
})

// ---- the layers, the search's bound, the whole chain, the reads ---------------------------------------------------------
await t('(7) LAYERS: enumeration and target removed -> the swing holds; enumeration and swing removed -> the target holds; all three -> the plain is hollowed', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE], async mod => { const w = gatherWorld({ cells: trench(plain()) }); await run(mod, w.bot); assert.ok(w.digs.every(d => d.open)) })
  await withMutantsAll(SKILLS_URL, [ENUM, SWING], async mod => { const w = gatherWorld({ cells: trench(plain()) }); await run(mod, w.bot); assert.ok(w.digs.every(d => d.open)) })
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE, SWING], async mod => { const w = gatherWorld({ cells: trench(plain()) }); await run(mod, w.bot); assert.ok(w.digs.some(d => d.name === 'dirt' && !d.open)) })
})
await t('MUTANT KILLED (chain): without the leaves exception the canopy over the lawn is a roof over the bot too (sheltered: the base\'s dig under the grass)', async () => {
  const canopy = () => { const c = trench(plain()); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) c.set(key(x, SURF + 3, z), 'oak_leaves'); return c }
  const real = gatherWorld({ cells: canopy() })
  const r = await run(SK, real.bot)
  assert.equal(real.digs[0]?.name, 'grass_block', show(r, real.digs))
  await withTopdownMutant([LEAVES], async (TDm, SKm) => { const w = gatherWorld({ cells: canopy() }); await run(SKm, w.bot); assert.ok(!w.digs.some(d => d.name === 'grass_block'), JSON.stringify(w.digs.slice(0, 3))) })
})
await t('MUTANT KILLED (chain): without the pitted check the scrape sinks a shaft', async () => {
  await withTopdownMutant([PIT_OFF], async (TDm, SKm) => {
    const w = gatherWorld({ cells: plain(), pickup: true })
    await run(SKm, w.bot, { block: 'dirt', count: 6 })
    assert.ok(w.digs.some(d => w.digs.some(e => e !== d && e.x === d.x && e.z === d.z && e.y > d.y)), JSON.stringify(w.digs))
  })
})
await t('(6b) open dirt beyond a slab of 243 roofed cells is reached (no give-up)', async () => {
  rows.length = 0
  const cells = plain({ x0: 96, x1: 104, z0: 96, z1: 104, cap: 'stone' })
  for (const x of [112, 113]) { for (let y = 62; y < SURF; y++) cells.set(key(x, y, 100), 'stone'); cells.set(key(x, SURF, 100), 'dirt') }
  const { bot, digs } = gatherWorld({ cells })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs.every(d => d.x >= 112 && d.open), show(r, digs))
  assert.ok(!tdRows('skip').some(x => /gave_up/.test(x.skill.detail)))
})
const bigSlab = () => { const c = plain(); for (const x of [112, 113]) { for (let y = 62; y < SURF; y++) c.set(key(x, y, 100), 'stone'); c.set(key(x, SURF, 100), 'dirt') } return c }
const REAL12 = {}
await t('(12) A BOUNDED SEARCH: past 256 roofed cells the search is given up -- the open dirt beyond is not reached, the grass is taken; gave_up=1', async () => {
  rows.length = 0
  const { bot, digs, searches } = gatherWorld({ cells: bigSlab() })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs[0].name === 'grass_block' && !digs.some(d => d.x >= 112), show(r, digs))
  assert.match(tdRows('skip')[0].skill.detail, /^op=skip block=dirt skipped=256 via=grass_block found=\d+ gave_up=1 sheltered=0$/)
  REAL12.calls = searches[0].calls
})
await t('MUTANT KILLED: without the bound the search walks on and reaches the open dirt', async () => {
  await withMutantsAll(SKILLS_URL, [GIVEUP], async mod => {
    const { bot, digs, searches } = gatherWorld({ cells: bigSlab() })
    await run(mod, bot)
    assert.ok(searches[0].calls > REAL12.calls && digs.some(d => d.x >= 112))
  })
})
const bareBeside = (x, z) => (x >= 99 && x <= 101 && z >= 99 && z <= 101) ? 'dirt' : null
await t('KEPT CELLS: a search given up after accepting open cells returns them (the patch is dug, not the grass)', async () => {
  rows.length = 0
  const { bot, digs } = gatherWorld({ cells: plain({ capAt: bareBeside }), pickup: true })
  const r = await run(SK, bot)
  assert.ok(tdRows('skip').some(x => /gave_up=1/.test(x.skill.detail)))
  assert.ok(digs.length > 0 && digs.every(d => d.name === 'dirt' && d.y === SURF), show(r, digs))
  await withMutantsAll(SKILLS_URL, [KEPT_NONE], async mod => {
    const w = gatherWorld({ cells: plain({ capAt: bareBeside }), pickup: true }); await run(mod, w.bot)
    assert.equal(w.digs[0]?.name, 'grass_block')
  })
})
const PZ = await import('../src/protectzone.mjs')
const pzRun = async (mod) => {
  rows.length = 0
  const w = gatherWorld({ cells: plain({ capAt: bareBeside }), pickup: true })
  const zones = PZ.parseZones({ version: 1, zones: [{ id: 'patch', kind: 'fixture', label: 'the zone patch', box: [99, 0, 99, 101, 90, 101] }] }).zones
  const refused = []
  PZ.attachProtectZone(w.bot, { zones: () => zones, context: () => ({ skill: 'gather', args: null, reflex: null, holder: null }), onRefuse: x => refused.push(x) })
  const r = await run(mod, w.bot, { block: 'dirt', count: 1 })
  return { ...w, r, refused }
}
const inPatch = d => d.x >= 99 && d.x <= 101 && d.z >= 99 && d.z <= 101
await t('THE WHOLE CHAIN: a given-up search does not hand back cells the protected-zone wrapper drops', async () => {
  const { digs, refused, r } = await pzRun(SK)
  assert.ok(!digs.some(inPatch), show(r, digs)); assert.equal(refused.filter(x => x.op === 'dig').length, 0)
  assert.ok(tdRows('skip').some(x => /gave_up=1/.test(x.skill.detail)))
  await withMutantsAll(SKILLS_URL, [REFILTER], async mod => { const m = await pzRun(mod); assert.ok(m.refused.some(x => x.op === 'dig') || m.digs.some(inPatch)) })
})
await t('THE IN-RANGE GUARD: roofed dirt only beyond the search -> no skip row, the base\'s "no dirt within 32"; without the guard -> skipped, the remedy', async () => {
  const far = () => new Map([...plain({ ox: 36 })].filter(([k]) => Number(k.split(',')[0]) >= 133))
  rows.length = 0
  const w = gatherWorld({ cells: far() })
  const r = await run(SK, w.bot)
  assert.equal(w.digs.length, 0); assert.match(String(r.detail), /^no dirt within 32 blocks/, show(r, w.digs))
  assert.equal(tdRows('skip').length, 0); assert.ok(w.searches[0].calls > 0)
  await withMutantsAll(SKILLS_URL, [INRANGE], async mod => {
    rows.length = 0
    const m = gatherWorld({ cells: far() })
    const rm = await run(mod, m.bot)
    assert.match(String(rm.detail), /open to the sky/); assert.ok(tdRows('skip').some(x => /skipped=[1-9]/.test(x.skill.detail)))
  })
})
await t('THE READ BUDGET (stone mass, a miner 30 down asking for stone: every cell deep, 8 reads each): bounded; without it, not', async () => {
  const mass = () => { const c = new Map(); for (let x = 84; x <= 116; x++) for (let z = 84; z <= 116; z++) { for (let y = 34; y < SURF; y++) c.set(key(x, y, z), 'stone'); c.set(key(x, SURF, z), 'grass_block') } for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [40, 41]) c.delete(key(x, y, z)); return c }
  const go = async (mod, off = false) => {
    if (off) process.env.TOPDOWN = 'off'
    try { const w = gatherWorld({ cells: mass(), at: [100.5, 40, 100.5] }); const r = await run(mod, w.bot, { block: 'stone', count: 1 }); return { reads: w.searches[0].reads, digs: w.digs, r } } finally { if (off) delete process.env.TOPDOWN }
  }
  const off = await go(SK, true), on = await go(SK)
  let mut = null
  await withTopdownMutant([READS_OFF], async (TDm, SKm) => { mut = await go(SKm) })
  console.log(`  READS first search: off=${off.reads} on=${on.reads} (extra ${on.reads - off.reads}) no-budget=${mut.reads} (extra ${mut.reads - off.reads}) budget=${TD.TOPDOWN.readBudget}`)
  assert.ok(on.digs.length > 0 && on.digs.every(d => d.y >= 39 && d.y <= 42), show(on.r, on.digs))
  assert.ok(on.reads - off.reads <= TD.TOPDOWN.readBudget + 64)
  assert.ok(mut.reads - off.reads > TD.TOPDOWN.readBudget * 1.5, `${mut.reads - off.reads}`)
})
await t('THE SECOND FALLBACK\'S SKIPS do not leak into the next round (no op=skip row when the rule never emptied a search)', async () => {
  const leakWorld = () => { const c = new Map(); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) { for (let y = 62; y < SURF; y++) c.set(key(x, y, z), 'stone'); c.set(key(x, SURF, z), 'grass_block') } for (const x of [99, 100]) c.set(key(x, SURF, 100), 'dirt'); for (let x = 104; x <= 106; x++) c.set(key(x, SURF + 1, 100), 'stone'); return c }
  const go = async mod => { rows.length = 0; const w = gatherWorld({ cells: leakWorld(), pickup: true }); w.bot.collectBlock.movements.safeToBreak = b => b?.name !== 'dirt'; const r = await run(mod, w.bot, { block: 'dirt', count: 2 }); return { ...w, r, skip: tdRows('skip') } }
  const real = await go(SK)
  assert.ok(real.digs.some(d => d.name === 'grass_block'), show(real.r, real.digs)); assert.deepEqual(real.skip, [])
  await withMutantsAll(SKILLS_URL, [LEAK], async mod => { const m = await go(mod); assert.ok(m.skip.length > 0) })
})
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
