// TOPDOWN-01 (topdown.mjs + skills.mjs gather; owner 2026-11-15 "Yes, authorize"): a bot standing on the ground takes that
// ground only FROM THE TOP. WHY: bots gathered dirt from under the grass and left roofed hollows -- 3,103 columns under the
// showcase lawn, a ring of 488 undermined columns just outside the town square on the rehearsal world
// (docs/reports/land-eval-2026-11-14/dirt-loop.md on main). Decided per CELL by one scan bounded by the bot's own feet: a cell
// is refused as roofed only when a cover over it tops out at or below the bot's feet, as pitted only when it lies below
// them; anything else is taken as the base takes it, and covered cells taken are counted (op=from_below). The rule is pure and tested as such; the chain is driven through the REAL gather skill over a fake world of
// named, layered cells WHERE THE BOTS LIVE: the surface at y 70 (home y 70), not below sea level, unless a test is about depth.
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
}// skills.mjs: the three conjuncts, the trap's one answer, the search's bound and its row, the kept cells, the second fallback
const ENUM = ['        const roofHit = topDownHit(bot, b.position, b.name, { feetY: tdFeetY })', '        const roofHit = false']
const SAFE = ['      !topDownHit(bot, p, bot.blockAt(p)?.name) &&   // topdown-01', '      true &&   // topdown-01']
const SWING = ['  if (topDownHit(bot, block.position, block.name, { trapLets: tdTrapLets })) {', '  if (false) {']
const SWING_REASK = ['  if (topDownHit(bot, block.position, block.name, { trapLets: tdTrapLets })) {', '  if (topDownHit(bot, block.position, block.name)) {']
const TRAP = ['trapLets: trapLets === undefined ? gatherTrapAllows(bot?.gatherTrap, p, Date.now()) : trapLets', 'trapLets: false']
const GIVEUP = ['        if (topDownGiveUp(roofSearch)) throw TD_GIVE_UP\n', '']
const GIVEUP_ROW = ['    if ((roofSkippedNow > 0 && !roofSaid) || (roofGaveUp && !roofGaveUpSaid)) {', '    if (roofSkippedNow > 0 && !roofSaid) {']
const REFILTER = ['        return bot.findBlocks({ matching: b => (b?.position ? ks.has(', '        return kept; return bot.findBlocks({ matching: b => (b?.position ? ks.has(']
const KEPT_NONE = ['        if (!kept.length) return []\n', '        return []\n']
const LEAK = ['        const found = findGround(altType.id, { count: false })', '        const found = findGround(altType.id)']
const INRANGE = ['      if (b.position && searchFrom && b.position.distanceTo(searchFrom) <= maxDistance) {\n        const roofHit', '      if (b.position) {\n        const roofHit']
// topdown.mjs: the scan's bound, the comparison, the pitted height, leaves, the pitted threshold, made ground
const SCAN_UNBOUNDED = [['  while (h <= F && !solidAt(x, h, z)) h++\n  if (h > F) return null\n', '  while (h <= F + 16 && !solidAt(x, h, z)) h++\n  if (h > F + 16) return null\n']]
const CMP_OFF = ["  if (c) return c.t <= F ? { kind: 'roofed', h: c.h, t: c.t } : { kind: 'under', h: c.h }", "  if (c) return { kind: 'roofed', h: c.h, t: c.t }"]
const CMP_MORE = ["  if (c) return c.t <= F ?", "  if (c) return c.t <= F + 1 ?"]
const CMP_LESS = ["  if (c) return c.t <= F ?", "  if (c) return c.t <= F - 1 ?"]
const PITH_OFF = ['  return F >= y + 1 && isPitted(groundAt, p) ?', '  return isPitted(groundAt, p) ?']
const PITH_MORE = ['  return F >= y + 1 && isPitted(groundAt, p) ?', '  return F >= y && isPitted(groundAt, p) ?']
const PITH_LESS = ['  return F >= y + 1 && isPitted(groundAt, p) ?', '  return F >= y + 2 && isPitted(groundAt, p) ?']
const LEAVES = [" && !LEAVES.test(String(b.name ?? ''))", '']
const PIT_5 = ['pit: 2,', 'pit: 5,']
const MADE_OFF = ["  if (isMadeGround(blockName)) return { kind: 'made' }\n", '']
const FEET_FLOOR = ['Math.floor(y + 0.2)', 'Math.floor(y)']
const GROUND_OFF = ['  const cell = topDownCell(roofAt(bot), p, name, feetY === undefined ? feetYOf(bot) : feetY, groundAt(bot))', '  const cell = topDownCell(roofAt(bot), p, name, feetY === undefined ? feetYOf(bot) : feetY)']
const MERGE_OFF = ['    if (!nextUp && roofGaveUp && !viaSource) {', '    if (false) {']
const MADE_LIFT = ["  if (cell.kind === 'made') return true\n  if (trapLets) return false\n", "  if (trapLets) return false\n  if (cell.kind === 'made') return true\n"]

// ---- pure ------------------------------------------------------------------------------------------------------------
const solidSet = cells => { const s = new Set(cells.map(c => c.join(','))); return (x, y, z) => s.has(`${x},${y},${z}`) }
const col = (x, z, y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) out.push([x, y, z]); return out }
const P = { x: 0, y: 60, z: 0 }
const blockNamed = name => name ? { name, boundingBox: mcData.blocksByName[name].boundingBox } : null
const S = 70

await t('ROOF: leaves are not a roof, a log is; an unread cell is not; no-collision blocks are not', () => {
  assert.equal(TD.isRoofBlock(blockNamed('oak_leaves')), false); assert.equal(TD.isRoofBlock(blockNamed('oak_log')), true)
  assert.equal(TD.isRoofBlock(null), false)
  for (const n of ['air', 'water', 'short_grass', 'snow', 'torch']) assert.equal(TD.isRoofBlock(blockNamed(n)), false, n)
})
await t('THE SCAN: bounded by the feet; h the lowest roof block, t the top of its run (F + 1 when it rises above the feet)', () => {
  assert.deepEqual(TD.coverFor(solidSet([[0, 61, 0]]), P, 61), { h: 61, t: 61 })
  assert.deepEqual(TD.coverFor(solidSet(col(0, 0, 61, 64)), P, 62), { h: 61, t: 63 }, 'rises above the feet: t = F + 1')
  assert.deepEqual(TD.coverFor(solidSet([[0, 63, 0]]), P, 65), { h: 63, t: 63 }, 'air, then a roof')
  assert.equal(TD.coverFor(solidSet([[0, 63, 0]]), P, 62), null, 'the roof is above the feet: nothing in the span')
  assert.equal(TD.coverFor(solidSet([[0, 61, 0]]), P, 60), null, 'a cell at the feet: nothing to scan')
  assert.equal(TD.coverFor(solidSet([]), P, null), null)
  let n = 0; TD.coverFor((x, y, z) => { n++; return false }, P, 70); assert.equal(n, 10, 'reads at most F - c.y (+1 for the run)')
})
await t('VERDICT and REFUSAL: made always; roofed (cover tops out at or below the feet) and pitted (below the feet) unless the trap; under and open never', () => {
  for (const n of ['farmland', 'dirt_path']) { assert.deepEqual(TD.topDownCell(solidSet([]), P, n, 61), { kind: 'made' }); assert.equal(TD.topDownRefusal({ kind: 'made' }, { trapLets: true }), true) }
  for (const n of ['iron_ore', 'oak_log', 'oak_leaves', 'wheat']) assert.equal(TD.topDownCell(solidSet([[0, 61, 0]]), P, n, 62), null, n)
  assert.equal(TD.topDownVerdict(solidSet([[0, 61, 0]]), P, 'dirt', 62), 'roofed', 'on the lawn (feet over the grass)')
  assert.equal(TD.topDownVerdict(solidSet(col(0, 0, 61, 62)), P, 'dirt', 61), 'under', 'the cover rises above the feet')
  assert.equal(TD.topDownVerdict(solidSet([[1, 61, 0], [0, 61, 1]]), P, 'dirt', 61), 'pitted', 'below the feet, 2 sides higher')
  assert.equal(TD.topDownVerdict(solidSet([[1, 61, 0], [0, 61, 1]]), P, 'dirt', 60), null, 'at the feet: a recess, taken')
  assert.equal(TD.topDownVerdict(solidSet([[0, 61, 0]]), P, 'dirt', null), null, 'feet unknown: fails open')
  assert.equal(TD.topDownRefusal({ kind: 'roofed' }), true); assert.equal(TD.topDownRefusal({ kind: 'roofed' }, { trapLets: true }), false)
  assert.equal(TD.topDownRefusal({ kind: 'under' }), false); assert.equal(TD.topDownRefusal(null), false)
})
// WHAT IS PROVEN, about HEIGHTS (not that the bot can leave: a pathfinder step up needs the rim at most 1.2 above the floor,
// two blocks of headroom, and the walk profile cannot dig; a bot boxed in by non-terrain blocks relies on the escape reflexes)
await t('THE HEIGHT CLAIMS, over a grid (every column of roof blocks over 12 cells, with and without two ground sides, feet 55-75): (i) roofed only when the cover tops out at or below the feet; (ii) pitted only below the feet with 2+ ground sides; (iii) terrain at or above the feet is never refused', () => {
  let roofed = 0, pitted = 0, atOrAbove = 0, checked = 0
  for (let mask = 0; mask < (1 << 12); mask++) {
    const colCells = []; for (let i = 0; i < 12; i++) if (mask & (1 << i)) colCells.push([0, 61 + i, 0])
    for (const sides of [[], [[1, 61, 0], [0, 61, 1]]]) {
      const solid = solidSet([...colCells, ...sides])
      for (let F = 55; F <= 75; F++) {
        checked++
        const cell = TD.topDownCell(solid, P, 'dirt', F)
        const refused = TD.topDownRefusal(cell)
        if (P.y >= F) { atOrAbove++; assert.equal(refused, false, `(iii) refused terrain at or above the feet (mask ${mask}, F ${F})`); continue }
        if (!refused) continue
        if (cell.kind === 'roofed') {
          roofed++
          let top = cell.h; while (solid(0, top + 1, 0)) top++
          assert.ok(top <= F, `(i) the cover tops out at ${top}, above the feet ${F} (mask ${mask})`)
        } else {
          assert.equal(cell.kind, 'pitted'); pitted++
          assert.ok(P.y < F && TD.hemmedIn(solid, P) >= 2, `(ii) mask ${mask}, F ${F}`)
        }
      }
    }
  }
  assert.ok(roofed > 1000 && pitted > 100 && atOrAbove > 1000, `positive control: ${roofed} roofed, ${pitted} pitted refusals, ${atOrAbove} cases at or above the feet, of ${checked}`)
})
await t('FEET LEVEL: floor(y + 0.2) -- path and farmland (70.9375), soul sand and mud (70.875) and a full block (71.0) give 71; a slab (70.5) gives 70 (left one lower: looser, never stricter)', () => {
  for (const y of [70.9375, 70.875, 71.0]) assert.equal(TD.feetLevel(y), 71, String(y))
  assert.equal(TD.feetLevel(70.5), 70); assert.equal(TD.feetLevel(null), null)
})
await t('GROUND SIDES ONLY: a fence, planks or glass beside a cell is not a higher side (groundAt); two terrain sides are', () => {
  const sides = [[1, 61, 0], [-1, 61, 0], [0, 61, 1], [0, 61, -1]]
  const solid = solidSet(sides)
  assert.equal(TD.topDownVerdict(solid, P, 'dirt', 61, () => false), null, 'four fences: not pitted')
  assert.equal(TD.topDownVerdict(solid, P, 'dirt', 61), 'pitted', 'four ground sides (the default reader)')
})
// the case table (lawn top S = 70): the cell, the column over it, the bot's feet -> refused?
const CASES = [
  ['on the lawn (feet S+1): the dirt under the grass', S - 1, col(0, 0, S, S), S + 1, true],
  ['on the lawn (feet S+1): dirt 10 down (any depth)', S - 10, col(0, 0, S - 9, S), S + 1, true],
  ['in a 1-deep scrape (feet S): the dirt under the neighbouring grass', S - 1, col(0, 0, S, S), S, true],
  ['in a hole 2 deep (feet S-1): its wall at its feet', S - 1, col(0, 0, S, S), S - 1, false],
  ['in a hole 2 deep (feet S-1): its wall a block lower', S - 2, col(0, 0, S - 1, S), S - 1, false],
  ['in a hole 5 deep (feet S-4): its wall below its feet', S - 5, col(0, 0, S - 4, S), S - 4, false],
  ['a cave 5 down (feet S-6): its wall', S - 6, col(0, 0, S - 5, S), S - 6, false],
  ['a cave 5 down (feet S-6): under its floor', S - 8, col(0, 0, S - 7, S - 7), S - 6, true],
  ['on the lawn right above the cave (feet S+1): the cave floor', S - 7, [...col(0, 0, S - 4, S)], S + 1, true],
  ['a miner (feet 40): the rock at its own level', 40, col(0, 0, 41, 60), 40, false],
]
await t('THE CASE TABLE', () => {
  for (const [what, y, over, feet, want] of CASES) assert.equal(TD.topDownRefuses(solidSet(over), { x: 0, y, z: 0 }, 'dirt', feet), want, what)
})
await t('THE SLOPE (one block a column, the bot at its foot on the lawn, feet S+1): column 1 refused at every depth; from column 2 on every cell taken -- a bot can tunnel into a hillside', () => {
  const hill = (x, y, z) => x >= 1 && x <= 8 && y <= S + x
  for (let k = 1; k <= 5; k++) for (const depth of [1, 2, 4, 6]) {
    const refused = TD.topDownRefuses(hill, { x: k, y: S + k - depth, z: 0 }, 'dirt', S + 1)
    assert.equal(refused, k === 1, `column ${k}, ${depth} under its grass`)
  }
})
await t('NO SHAFTS (pitted): 2+ sides higher, only below the feet; the scraped 3x3 patch; the recess at the bot\'s level is taken', () => {
  const side = [[1, 61, 0], [-1, 61, 0], [0, 61, 1], [0, 61, -1]]
  for (let k = 0; k <= 4; k++) assert.equal(TD.topDownRefuses(solidSet(side.slice(0, k)), P, 'dirt', 61), k >= 2, `${k} sides`)
  const grass = []
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) === 2 || Math.abs(z) === 2) grass.push([x, 61, z])
  const s = solidSet(grass)
  assert.equal(TD.topDownRefuses(s, { x: 0, y: 60, z: 0 }, 'dirt', 61), false); assert.equal(TD.topDownRefuses(s, { x: 1, y: 60, z: 0 }, 'dirt', 61), false)
  assert.equal(TD.topDownRefuses(s, { x: 1, y: 60, z: 1 }, 'dirt', 61), true, 'a corner')
  assert.equal(TD.topDownRefuses(solidSet(side), P, 'dirt', 60), false, 'at its own level')
})
await t('SWITCH, BOUND, ROW, WORDS', () => {
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.equal(TD.topDownOn({ TOPDOWN: v }), false, v)
  for (const v of [undefined, '', '1', 'on']) assert.equal(TD.topDownOn({ TOPDOWN: v }), true, String(v))
  assert.equal(TD.topDownGiveUp(255), false); assert.equal(TD.topDownGiveUp(256), true)
  assert.equal(TD.topDownModeDetail({}), 'op=mode on=1 scan=feet pit=2 give_up=256')
  assert.match(TD.topDownRemedy('dirt', 12, 32), /^no dirt open to the sky within 32 blocks \(12 under the ground you stand on left: taking them hollows it\)\. Take ground from the top: gather where it lies open, or `mine` to go down for rock \(mine digs nothing within 12 blocks of home: walk out at least 20 blocks from home first\)$/)
  assert.equal(TD.roofOverY(solidSet([[0, 64, 0]]), P), 64); assert.equal(TD.roofOverY(solidSet([]), P), null)
})
await t('MUTANTS KILLED (pure): the comparison off / +1 / -1, the pitted height off / +1 / -1, leaves, pitted 2 -> 5, made ground off and lifted', async () => {
  const lawn = solidSet([[0, 61, 0]]), scrape = { solid: lawn, feet: 61 }
  await withTopdownMutant([CMP_OFF], async M => { assert.equal(M.topDownRefuses(solidSet(col(0, 0, 61, 62)), P, 'dirt', 61), true, 'the hole wall refused') })
  await withTopdownMutant([CMP_MORE], async M => { assert.equal(M.topDownRefuses(solidSet(col(0, 0, 61, 62)), P, 'dirt', 61), true, 'a 2-deep hole\'s lower wall refused') })
  await withTopdownMutant([CMP_LESS], async M => { assert.equal(M.topDownRefuses(scrape.solid, P, 'dirt', scrape.feet), false, 'the scrape undermined') })
  const two = solidSet([[1, 61, 0], [0, 61, 1]])
  await withTopdownMutant([PITH_OFF], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt', 60), true, 'the recess refused') })
  await withTopdownMutant([PITH_MORE], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt', 60), true, 'the recess refused') })
  await withTopdownMutant([PITH_LESS], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt', 61), false, 'the shaft under the bot') })
  await withTopdownMutant([LEAVES], async M => { assert.equal(M.isRoofBlock(blockNamed('oak_leaves')), true) })
  await withTopdownMutant([PIT_5], async M => { assert.equal(M.topDownRefuses(two, P, 'dirt', 61), false) })
  await withTopdownMutant([MADE_OFF], async M => { assert.equal(M.topDownRefuses(solidSet([]), P, 'farmland', 61), false) })
  await withTopdownMutant([MADE_LIFT], async M => { assert.equal(M.topDownRefusal({ kind: 'made' }, { trapLets: true }), false) })
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
// `pickup`: a dig puts its drop in the bag ONLY when the drop rests inside the vanilla pickup box of where the bot stands when
// the dig ends, with no walking (review r4, C3: production walks GoalNear(drop, 1) on the travel profile; this harness does
// not model that walk, so a drop it would walk to is NOT credited). The drop falls to the first solid block under the dug cell
// and rests there as an item entity 0.25 x 0.25 x 0.25. The box: the player's (0.6 wide, 1.8 tall) grown by 1.0 sideways and
// 0.5 up and down -- vanilla Player.aiStep's `getBoundingBox().inflate(1.0, 0.5, 1.0)` for touching items (from the game's
// code as I know it; not read in this repo).
function inPickupBox (pos, x, rest, z) {
  const bx0 = pos.x - 0.3 - 1.0, bx1 = pos.x + 0.3 + 1.0, bz0 = pos.z - 0.3 - 1.0, bz1 = pos.z + 0.3 + 1.0
  const by0 = pos.y - 0.5, by1 = pos.y + 1.8 + 0.5
  const ix0 = x + 0.375, ix1 = x + 0.625, iz0 = z + 0.375, iz1 = z + 0.625, iy0 = rest, iy1 = rest + 0.25
  return ix1 > bx0 && ix0 < bx1 && iz1 > bz0 && iz0 < bz1 && iy1 > by0 && iy0 < by1
}
const DROP = { grass_block: 'dirt', dirt: 'dirt', stone: 'cobblestone', cobblestone: 'cobblestone', farmland: 'dirt', dirt_path: 'dirt', sand: 'sand' }
function gatherWorld ({ cells, at = [100.5, SURF + 1, 100.5], items = [], pickup = false, reach = false, onDig = null }) {
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
      const feet = Math.floor(bot.entity.position.y)
      digs.push({ x, y, z, name, open: openAbove(cells, x, y, z), straight: TD.isRoofBlock(blockNamed(cells.get(key(x, y + 1, z)))), refused: TD.topDownRefuses(solid, { x, y, z }, name, feet), covered: TD.roofOverY(solid, { x, y, z }) != null, over: TD.roofOverY(solid, { x, y, z }), feet, kind: TD.topDownVerdict(solid, { x, y, z }, name, feet) })
      cells.delete(key(x, y, z))
      const drop = DROP[name]
      if (!pickup || !drop) return
      let rest = y
      while (rest > -64 && !solid(x, rest - 1, z)) rest--
      if (inPickupBox(bot.entity.position, x, rest, z)) { const it = items.find(i => i.name === drop); if (it) it.count++; else items.push({ name: drop, count: 1, type: mcData.itemsByName[drop].id }) }
      else uncollected.push({ x, y, z, name, rest })
    },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  // `reach`: mineflayer's canDigBlock (digging.js 220-226): diggable and the block centre within 5.1 of the eye -- no line of sight
  // `onDig(bot, n)`: called after each dig (and its pickup), e.g. to move the bot
  if (onDig) { const d0 = bot.dig; bot.dig = async b => { await d0.call(bot, b); onDig(bot, digs.length) } }
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
const keyOf = d => `${d.x},${d.y},${d.z}:${d.name}`
const DIRT8 = () => [{ name: 'dirt', count: 8, type: mcData.itemsByName.dirt.id }]
async function bothWays (makeCells, at, args, items = () => [], attach = null) {
  process.env.TOPDOWN = 'off'
  let off
  try { const w = gatherWorld({ cells: makeCells(), at, pickup: true, reach: true, items: items() }); attach?.(w.bot); const r = await run(SK, w.bot, args); off = { ...w, r } } finally { delete process.env.TOPDOWN }
  rows.length = 0
  const w = gatherWorld({ cells: makeCells(), at, pickup: true, reach: true, items: items() })
  attach?.(w.bot)
  const r = await run(SK, w.bot, args)
  return { off, on: { ...w, r } }
}
function assertSame ({ off, on }, what) {
  assert.deepEqual(on.digs.map(keyOf), off.digs.map(keyOf), `${what}: the same cells as the base (on ${JSON.stringify(on.digs.map(keyOf))} off ${JSON.stringify(off.digs.map(keyOf))})`)
  assert.deepEqual(on.bag(), off.bag(), `${what}: the same bag`)
}
// the run's one op=from_below row: n = covered terrain cells taken (the rule stood aside), lowest_gap = the smallest distance
// from the bot's feet up to the first roof block over one of them
function assertFromBelow (w, block = 'dirt') {
  const below = w.digs.filter(d => d.covered && !d.refused)
  assert.ok(below.length > 0, 'positive control: covered cells were taken')
  const r = tdRows('from_below')
  assert.equal(r.length, 1, 'one op=from_below row a run')
  assert.equal(r[0].skill.detail, `op=from_below n=${below.length} block=${block} lowest_gap=${Math.min(...below.map(d => d.over - d.feet))}`)
}
// a bot below the ground: takes what the base takes, nothing this rule refuses, ends holding (its walls lie in its pickup box)
function assertBelowHolds (w, what) {
  assert.ok(w.digs.length > 0 && w.digs.every(d => !d.refused), `${what}: ${JSON.stringify(w.digs.slice(0, 5))}`)
  assert.ok(w.held() > 0, `${what}: ends holding (${w.held()})`)
  assert.ok(w.digs.some(d => d.covered), `${what}: it took covered cells (its walls)`)
}
const holeAt = (W, D, cells = plain(), x0 = 100, z0 = 100) => { for (let x = x0; x < x0 + W; x++) for (let z = z0; z < z0 + W; z++) for (let y = SURF - D + 1; y <= SURF; y++) cells.delete(key(x, y, z)); return cells }
// first the exact base (one dig, the same cell and bag as TOPDOWN=off), then a longer run's properties
// `holds`: false where the bot's walls lie outside its pickup box (it stands 2+ from them): production walks to the drop,
// which the harness does not model, so there only what was dug is asserted
async function belowLikeBase (makeCells, at, block, what, items = () => [], attach = null, { holds = true } = {}) {
  assertSame(await bothWays(makeCells, at, { block, count: 1 }, items, attach), what)
  rows.length = 0
  const w = gatherWorld({ cells: makeCells(), at, pickup: true, reach: true, items: items() })
  attach?.(w.bot)
  const r = await run(SK, w.bot, { block, count: 4 })
  if (holds) assertBelowHolds(w, `${what}: ${show(r, w.digs)}`)
  else assert.ok(w.digs.length > 0 && w.digs.every(d => !d.refused) && w.digs.some(d => d.covered), `${what}: ${show(r, w.digs)}`)
  assertFromBelow(w, block === 'cobblestone' ? 'cobblestone' : block)
  return w
}

// ---- the chain ----------------------------------------------------------------------------------------------------------
await t('(1) POSITIVE CONTROL, TOPDOWN=off: on the plain the base digs dirt from under the grass (the harness can see an under-roof dig)', async () => {
  process.env.TOPDOWN = 'off'
  try { const { bot, digs } = gatherWorld({ cells: trench(plain()) }); const r = await run(SK, bot); assert.ok(digs.some(d => d.name === 'dirt' && d.straight && !d.open), show(r, digs)) } finally { delete process.env.TOPDOWN }
})
await t('(a) THE FLAT LAWN (feet 71): grass tops only, nothing covered, nothing deeper than the tops -- pickup of these drops needs the walk the harness does not model', async () => {
  rows.length = 0
  const { bot, digs } = gatherWorld({ cells: trench(plain()), pickup: true, reach: true })
  const r = await run(SK, bot, { block: 'dirt', count: 3 })
  assert.ok(digs.length > 0 && digs.every(d => d.name === 'grass_block' && d.y === SURF && !d.covered && !d.refused), show(r, digs))
  assert.equal(tdRows('from_below').length, 0)
})
await t('(scrape) A BOT IN ITS OWN 1x1 1-DEEP HOLE (feet 70): no shaft under itself, nothing from under the neighbouring grass; it takes the grass beside it and ends holding', async () => {
  const w = gatherWorld({ cells: holeAt(1, 1), at: [100.5, SURF, 100.5], pickup: true, reach: true })
  const r = await run(SK, w.bot, { block: 'dirt', count: 3 })
  assert.ok(w.digs.length > 0 && w.digs.every(d => d.name === 'grass_block' && !d.refused), show(r, w.digs))
  assert.ok(!w.digs.some(d => d.x === 100 && d.z === 100), 'never the cell under itself')
  assert.ok(w.held() > 0, `holds ${w.held()}`)
})
await t('MUTANT KILLED: the pitted height one less strict (F >= y + 2) -> the bot in its 1-deep hole digs the shaft under itself', async () => {
  await withTopdownMutant([PITH_LESS], async (TDm, SKm) => {
    const w = gatherWorld({ cells: holeAt(1, 1), at: [100.5, SURF, 100.5], pickup: true, reach: true })
    await run(SKm, w.bot, { block: 'dirt', count: 3 }); assert.ok(w.digs.some(d => d.x === 100 && d.z === 100 && d.y < SURF), JSON.stringify(w.digs.slice(0, 3)))
  })
})
// a 1-deep scrape (x 100-101, z 100) beside a 2-deep trench (x 102): the dirt under the grass past the trench is exposed
const scrapeByTrench = () => { const c = plain(); for (const x of [100, 101]) c.delete(key(x, SURF, 100)); for (let z = 95; z <= 105; z++) for (const y of [SURF - 1, SURF]) c.delete(key(102, y, z)); return c }
await t('(scrape2) A BOT IN A 1-DEEP SCRAPE beside a 2-deep trench: the dirt under the grass past the trench is refused (the rule applies)', async () => {
  const w = gatherWorld({ cells: scrapeByTrench(), at: [100.5, SURF, 100.5], pickup: true, reach: true })
  const r = await run(SK, w.bot, { block: 'dirt', count: 3 })
  assert.ok(w.digs.length > 0 && w.digs.every(d => !d.refused && !(d.name === 'dirt' && d.straight)), show(r, w.digs))
})
await t('MUTANT KILLED: the comparison one looser (t <= F - 1) -> the 1-deep scrape is undermined (dirt under the neighbouring grass)', async () => {
  await withTopdownMutant([CMP_LESS], async (TDm, SKm) => {
    const w = gatherWorld({ cells: scrapeByTrench(), at: [100.5, SURF, 100.5], pickup: true, reach: true })
    await run(SKm, w.bot, { block: 'dirt', count: 3 }); assert.ok(w.digs.some(d => d.name === 'dirt' && d.straight), JSON.stringify(w.digs.slice(0, 3)))
  })
})
await t('(b) THE SCRAPED 3x3 PATCH (the bot at its centre, feet 70): its centre and edges are taken, never its corners -- pickup needs the walk the harness does not model', async () => {
  const w = gatherWorld({ cells: holeAt(3, 1, plain(), 99, 99), at: [100.5, SURF, 100.5], pickup: true, reach: true })
  const r = await run(SK, w.bot, { block: 'dirt', count: 5 })
  const ok = new Set(['100,69,100', '99,69,100', '101,69,100', '100,69,99', '100,69,101'])
  assert.ok(w.digs.length > 0 && w.digs.every(d => ok.has(`${d.x},${d.y},${d.z}`)), show(r, w.digs))
})
for (const D of [2, 3, 5]) {
  await t(`(c) A 1x1 HOLE ${D} DEEP, empty bag (feet ${SURF - D + 1}): the first cell and bag exactly as TOPDOWN=off; it takes its walls and ends holding; the row`, async () => {
    await belowLikeBase(() => holeAt(1, D), [100.5, SURF - D + 1, 100.5], 'dirt', `hole ${D}`)
  })
}
await t('(c) A 1x1 HOLE 3 DEEP holding 8: as TOPDOWN=off', async () => { await belowLikeBase(() => holeAt(1, 3), [100.5, SURF - 2, 100.5], 'dirt', 'hole 3 holding', DIRT8) })
for (const W of [2, 3]) {
  for (const [where, at] of [['corner', [100.5, SURF - 3, 100.5]], ['centre', [100 + W / 2, SURF - 3, 100 + W / 2]]]) {
    await t(`(c) A ${W}x${W} HOLE 4 DEEP at its ${where}: as TOPDOWN=off, ${where === 'corner' ? 'ends holding (round three\'s stranded case)' : 'takes its walls -- pickup from the centre needs the walk the harness does not model'}`, async () => {
      await belowLikeBase(() => holeAt(W, 4), at, 'dirt', `${W}x${W} ${where}`, () => [], null, { holds: where === 'corner' })
    })
  }
}
await t('MUTANT KILLED: the comparison removed (any cover refuses) -> the 2x2 hole bot ends holding nothing', async () => {
  await withTopdownMutant([CMP_OFF], async (TDm, SKm) => {
    const w = gatherWorld({ cells: holeAt(2, 4), at: [100.5, SURF - 3, 100.5], pickup: true, reach: true })
    await run(SKm, w.bot, { block: 'dirt', count: 4 })
    assert.ok(!w.digs.some(d => d.covered && d.y < w.digs[0]?.feet), 'no wall below its feet')
  })
})
// C1 (Codex, Claude): a 2-deep hole whose rim cannot be taken -- the old rule refused the walls, the bot got nothing
const rimAround = (cells, name) => { for (let x = 99; x <= 101; x++) for (let z = 99; z <= 101; z++) if (!(x === 100 && z === 100)) cells.set(key(x, SURF, z), name); return cells }
const PZ = await import('../src/protectzone.mjs')
const rimZone = bot => PZ.attachProtectZone(bot, { zones: () => PZ.parseZones({ version: 1, zones: [{ id: 'rim', kind: 'fixture', label: 'the rim', box: [99, SURF, 99, 101, SURF, 101] }] }).zones, context: () => ({ skill: 'gather', args: null, reflex: null, holder: null }), onRefuse: () => {} })
await t('C1: a 2-DEEP HOLE WITH A RIM THAT CANNOT BE TAKEN (protected, a path, stone): as TOPDOWN=off, ends holding its walls', async () => {
  await belowLikeBase(() => holeAt(1, 2), [100.5, SURF - 1, 100.5], 'dirt', 'protected rim', () => [], rimZone)
  await belowLikeBase(() => rimAround(holeAt(1, 2), 'dirt_path'), [100.5, SURF - 1, 100.5], 'dirt', 'path rim')
  await belowLikeBase(() => rimAround(holeAt(1, 2), 'stone'), [100.5, SURF - 1, 100.5], 'dirt', 'stone rim')
})
// (the comparison one stricter, t <= F + 1, is killed by the pure MUTANTS test: the cells it newly refuses -- below the feet
// with their cover's top exactly one above them -- are buried in every hole scene, so the chain cannot reach them)
// C2 (Codex): sand in side recesses at the bot's level, each open with 2+ solid sides above
const beach = () => { const c = new Map(); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) { for (let y = 62; y <= 64; y++) c.set(key(x, y, z), 'stone'); for (let y = 65; y <= SURF; y++) c.set(key(x, y, z), 'sand') } return c }
const recess = () => { const c = holeAt(1, 3, beach()); for (const [x, z] of [[101, 100], [99, 100]]) for (const y of [SURF - 1, SURF]) c.delete(key(x, y, z)); return c }
await t('C2: SAND IN THE RECESSES at the bot\'s level (feet 68): as TOPDOWN=off', async () => {
  assertSame(await bothWays(recess, [100.5, SURF - 2, 100.5], { block: 'sand', count: 1 }), 'recess')
  const w = gatherWorld({ cells: recess(), at: [100.5, SURF - 2, 100.5], pickup: true, reach: true })
  await run(SK, w.bot, { block: 'sand', count: 2 })
  assert.ok(w.digs.some(d => d.y === SURF - 2 && (d.x === 101 || d.x === 99) && d.z === 100), `a recess taken: ${JSON.stringify(w.digs.map(keyOf))}`)
  assert.ok(w.held() > 0)
})
await t('MUTANTS KILLED: the pitted height removed or one stricter -> the recesses are refused', async () => {
  for (const m of [PITH_OFF, PITH_MORE]) {
    await withTopdownMutant([m], async (TDm, SKm) => {
      const w = gatherWorld({ cells: recess(), at: [100.5, SURF - 2, 100.5], pickup: true, reach: true })
      await run(SKm, w.bot, { block: 'sand', count: 2 })
      assert.ok(!w.digs.some(d => d.y === SURF - 2 && (d.x === 101 || d.x === 99) && d.z === 100), JSON.stringify(w.digs.map(keyOf)))
    })
  }
})
const hollow = () => { const c = plain(); for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [67, 68]) c.delete(key(x, y, z)); return c }
await t('(d) A ROOFED HOLLOW 2 HIGH under the lawn, empty and holding 8: as TOPDOWN=off (its walls 3 away: pickup needs the walk the harness does not model)', async () => {
  await belowLikeBase(hollow, [100.5, 67, 100.5], 'dirt', 'hollow', () => [], null, { holds: false })
  await belowLikeBase(hollow, [100.5, 67, 100.5], 'dirt', 'hollow holding', DIRT8, null, { holds: false })
})
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
await t('(e) A CAVE FLOOR 5 BELOW under a 2-block ceiling, dirt and cobblestone; Codex\'s buried cobblestone: as TOPDOWN=off (the walls 3 away: pickup needs the walk the harness does not model)', async () => {
  await belowLikeBase(() => caveWorld('dirt'), [100.5, 64, 100.5], 'dirt', 'cave dirt', () => [], null, { holds: false })
  await belowLikeBase(() => caveWorld('stone'), [100.5, 64, 100.5], 'cobblestone', 'cave cobblestone', () => [], null, { holds: false })
  const buried = () => { const c = caveWorld('stone'); c.set(key(100, 58, 100), 'cobblestone'); return c }
  assertSame(await bothWays(buried, [100.5, 64, 100.5], { block: 'cobblestone', count: 1 }), 'buried cobblestone')
})
await t('(e3) ON THE LAWN RIGHT ABOVE THE CAVE: the cave\'s walls and floor are refused; it takes the grass -- pickup needs the walk the harness does not model', async () => {
  const w = gatherWorld({ cells: caveWorld(), at: [100.5, SURF + 1, 100.5], pickup: true, reach: true })
  const r = await run(SK, w.bot, { block: 'dirt', count: 2 })
  assert.equal(w.digs[0]?.name, 'grass_block', show(r, w.digs)); assert.ok(w.digs.every(d => !d.covered))
})
await t('(f) MOVED FROM A HOLE ONTO THE LAWN: in a 3-deep hole it takes its walls; set on the lawn it gathers again at once and the rule applies', async () => {
  const w = gatherWorld({ cells: holeAt(1, 3), at: [100.5, SURF - 2, 100.5], pickup: true, reach: true })
  await run(SK, w.bot, { block: 'dirt', count: 2 })
  assert.ok(w.digs.some(d => d.covered), 'positive control: in the hole it took covered walls')
  const before = w.digs.length
  w.bot.entity.position = new Vec3(103.5, SURF + 1, 103.5)
  const r = await run(SK, w.bot, { block: 'dirt', count: 2 })
  const after = w.digs.slice(before)
  assert.ok(after.length > 0 && after[0].name === 'grass_block' && after.every(d => !d.covered), show(r, after))
})
await t('(g) A 1-WIDE TRENCH 2 DEEP, middle and end: as TOPDOWN=off, ends holding', async () => {
  const tr = () => { const c = plain(); for (let z = 95; z <= 105; z++) for (const y of [SURF - 1, SURF]) c.delete(key(101, y, z)); return c }
  await belowLikeBase(tr, [101.5, SURF - 1, 100.5], 'dirt', 'trench middle')
  await belowLikeBase(tr, [101.5, SURF - 1, 95.5], 'dirt', 'trench end')
})
await t('(h) SAND: on the beach only the top sand; from a 2-deep and a 3-deep sand hole as TOPDOWN=off', async () => {
  const open = gatherWorld({ cells: beach(), pickup: true, reach: true })
  const ro = await run(SK, open.bot, { block: 'sand', count: 3 })
  assert.ok(open.digs.length > 0 && open.digs.every(d => d.name === 'sand' && d.y === SURF && !d.covered), show(ro, open.digs))
  await belowLikeBase(() => holeAt(1, 2, beach()), [100.5, SURF - 1, 100.5], 'sand', 'sand 2')
  await belowLikeBase(() => holeAt(1, 3, beach()), [100.5, SURF - 2, 100.5], 'sand', 'sand 3')
})
const stoneHollowWith = (extra) => { const c = new Map(); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) for (let y = 60; y <= SURF; y++) c.set(key(x, y, z), 'stone'); for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) for (const y of [67, 68]) c.delete(key(x, y, z)); extra(c); return c }
await t('MADE GROUND: a path beside a bot below the ground, at its own level, is never taken; the ONLY source -> the base\'s not-found ending; with dirt too, as the base', async () => {
  const onlyPath = () => stoneHollowWith(c => c.set(key(97, 67, 100), 'dirt_path'))
  process.env.TOPDOWN = 'off'
  let off
  try { off = gatherWorld({ cells: onlyPath(), at: [100.5, 67, 100.5], pickup: true, reach: true }); await run(SK, off.bot, { block: 'dirt', count: 1 }) } finally { delete process.env.TOPDOWN }
  assert.ok(off.digs.some(d => d.name === 'dirt_path'), 'positive control: the base takes the path')
  const on = gatherWorld({ cells: onlyPath(), at: [100.5, 67, 100.5], pickup: true, reach: true })
  const r = await run(SK, on.bot, { block: 'dirt', count: 1 })
  assert.equal(on.digs.length, 0, show(r, on.digs)); assert.equal(r.failClass, 'nothing_found'); assert.match(String(r.detail), /^no dirt within 32 blocks/)
  assertSame(await bothWays(() => stoneHollowWith(c => { c.set(key(97, 67, 100), 'dirt_path'); c.set(key(101, 67, 100), 'dirt') }), [100.5, 67, 100.5], { block: 'dirt', count: 1 }), 'path + dirt (the dirt beside it, collected)')
  await withTopdownMutant([MADE_OFF], async (TDm, SKm) => {
    const m = gatherWorld({ cells: onlyPath(), at: [100.5, 67, 100.5], pickup: true, reach: true })
    await run(SKm, m.bot, { block: 'dirt', count: 1 }); assert.ok(m.digs.some(d => d.name === 'dirt_path'))
  })
})

// ---- K1 (Claude r3): a miner in a 1-wide 2-high tunnel along z, solid stone round it -------------------------------------
const tunnel = (tx) => { const c = new Map(); for (let x = -4; x <= 31; x++) for (let z = -4; z <= 24; z++) for (let y = 30; y <= 50; y++) c.set(key(x, y, z), 'stone'); for (let z = 0; z <= 16; z++) for (const y of [40, 41]) c.delete(key(tx, y, z)); return c }
const K1 = {}
for (const tx of [12, 2, 9, 14]) {
  await t(`K1: the miner in a tunnel at x=${tx} (local x ${tx}), y 40-41, at z 8.5: \`gather cobblestone\` and \`gather stone\` take its walls exactly as TOPDOWN=off, and hold them`, async () => {
    for (const block of ['cobblestone', 'stone']) {
      const res = await bothWays(() => tunnel(tx), [tx + 0.5, 40, 8.5], { block, count: 1 })
      assertSame(res, `tunnel ${tx} ${block}`)
      assert.ok(res.on.held() > 0 && res.on.digs.every(d => d.y >= 40), `holds its wall: ${JSON.stringify(res.on.digs.map(keyOf))}`)
      const sum = w => w.searches.reduce((n, x) => n + (x.reads ?? 0), 0)
      K1[`${tx}/${block}`] = { on: sum(res.on), off: sum(res.off) }
    }
  })
}
await t('K1 READS, and MUTANT KILLED: the scan\'s upper bound removed reads the miner\'s own level too', async () => {
  console.log(`  K1 READS first search (on/off): ${Object.entries(K1).map(([k, v]) => `${k} ${v.on}/${v.off}`).join('  ')} (was 22,965 on the stone mass at bb96f0825)`)
  await withTopdownMutant(SCAN_UNBOUNDED, async (TDm, SKm) => {
    const w = gatherWorld({ cells: tunnel(12), at: [12.5, 40, 8.5], pickup: true, reach: true })
    await run(SKm, w.bot, { block: 'stone', count: 1 })
    const reads = w.searches.reduce((n, x) => n + (x.reads ?? 0), 0)
    assert.ok(reads > K1['12/stone'].on, `the mutant reads ${reads}, the real ${K1['12/stone'].on}`)
  })
})

// ---- review r5 ----------------------------------------------------------------------------------------------------------
// Codex 1 / Claude 1: a bot boxed in by fences, planks or glass on a small platform -- those are not ground, so its floor is
// not pitted, and it takes it as the base does
const boxedIn = (ring, heights) => () => { const c = plain(); for (let x = 99; x <= 101; x++) for (let z = 99; z <= 101; z++) if (!(x === 100 && z === 100)) for (const y of heights) c.set(key(x, y, z), ring) ; return c }
const fencedPlatform = () => { const c = boxedIn('oak_fence', [SURF + 1])(); for (let x = 98; x <= 102; x++) for (let z = 98; z <= 102; z++) if (Math.abs(x - 100) === 2 || Math.abs(z - 100) === 2) for (const y of [SURF + 1, SURF + 2]) c.set(key(x, y, z), 'glass'); return c }
for (const [what, make] of [['Codex: a 3x3 platform, fences on its eight perimeter cells, glass round them', fencedPlatform], ['Claude: oak planks at y 71-72 on all four sides', boxedIn('oak_planks', [SURF + 1, SURF + 2])], ['Claude: oak fences at y 71', boxedIn('oak_fence', [SURF + 1])]]) {
  await t(`BOXED IN BY BLOCKS THAT ARE NOT GROUND (${what}): the first cell dug is TOPDOWN=off's -- the grass under its feet`, async () => {
    const res = await bothWays(make, [100.5, SURF + 1, 100.5], { block: 'dirt', count: 1 })
    assert.deepEqual(res.on.digs.slice(0, 1).map(keyOf), res.off.digs.slice(0, 1).map(keyOf), `${JSON.stringify(res.on.digs.map(keyOf))} vs ${JSON.stringify(res.off.digs.map(keyOf))}`)
    assert.equal(res.on.digs[0]?.y, SURF, 'the block under its feet')
  })
}
await t('MUTANT KILLED: the ground condition removed (any roof block a higher side) -> the fenced bot is refused its floor', async () => {
  await withMutantsAll(SKILLS_URL, [GROUND_OFF], async mod => {
    const w = gatherWorld({ cells: boxedIn('oak_fence', [SURF + 1])(), at: [100.5, SURF + 1, 100.5], pickup: true, reach: true })
    await run(mod, w.bot, { block: 'dirt', count: 1 })
    assert.ok(!w.digs.some(d => d.x === 100 && d.z === 100 && d.y === SURF), JSON.stringify(w.digs.map(keyOf)))
  })
})
await t('MUTANT KILLED: feet floored without the 0.2 -> a bot on a path (y 70.9375) is judged a level lower and the dirt under the grass beside it is taken', async () => {
  // the bot stands on dirt_path at (100,70,100) (surface 70.9375); the dirt under the neighbouring grass lies in a trench's wall
  // and a 1-high bump past the trench (dirt at 70, grass at 71): its cover tops out at 71, the bot's real feet level
  const road = () => { const c = trench(plain(), 101, SURF, SURF - 1); c.set(key(100, SURF, 100), 'dirt_path'); c.set(key(102, SURF, 100), 'dirt'); c.set(key(102, SURF + 1, 100), 'grass_block'); return c }
  const real = gatherWorld({ cells: road(), at: [100.5, SURF + 0.9375, 100.5] })
  await run(SK, real.bot, { block: 'dirt', count: 1 })
  assert.ok(real.digs.every(d => !(d.name === 'dirt' && d.straight)), `real: ${JSON.stringify(real.digs.map(keyOf))}`)
  await withTopdownMutant([FEET_FLOOR], async (TDm, SKm) => {
    const w = gatherWorld({ cells: road(), at: [100.5, SURF + 0.9375, 100.5] })
    await run(SKm, w.bot, { block: 'dirt', count: 1 })
    assert.ok(w.digs.some(d => d.name === 'dirt' && d.straight), JSON.stringify(w.digs.map(keyOf)))
  })
})
// Codex 2 / Claude 4: a given-up exact search kept one accepted but unreachable cell -- a dirt block floating one over the lawn,
// 6.4 from the bot's eye (beyond canDigBlock's 5.1; the harness does not walk). Codex placed it 8 over the lawn at (96,78,96):
// there cavefall.mjs already refuses it as a floor over a harmful drop, so the base's second fallback takes the grass anyway;
// one block up it is a safe target, accepted, kept, and unusable
const floating = () => { const c = plain(); c.set(key(96, SURF + 2, 105), 'dirt'); return c }
await t('A GIVEN-UP SEARCH ALSO ASKS THE FALLBACK: a floating dirt block kept, unreachable -> the grass is taken, as TOPDOWN=off takes it; rows: op=skip gave_up=1 and gather_via_source grass_block -- holding the drop needs the walk the harness does not model', async () => {
  const res = await bothWays(floating, [100.5, SURF + 1, 100.5], { block: 'dirt', count: 2 })
  assert.ok(res.off.digs.some(d => d.name === 'grass_block'), 'positive control: the base takes the grass')
  assert.ok(res.on.digs.some(d => d.name === 'grass_block'), `${JSON.stringify(res.on.digs.map(keyOf))} ${JSON.stringify(res.on.r).slice(0, 160)}`)
  assert.ok(tdRows('skip').some(x => /gave_up=1$/.test(x.skill.detail)), JSON.stringify(tdRows('skip').map(x => x.skill.detail)))
  assert.ok(rowsOf('gather_via_source').some(x => /grass_block yields it/.test(x.skill.detail)), JSON.stringify(rowsOf('gather_via_source').map(x => x.skill.detail)))
})
await t('MUTANT KILLED: the merge removed -> the floating block alone, the run ends unreachable with nothing dug', async () => {
  await withMutantsAll(SKILLS_URL, [MERGE_OFF], async mod => {
    const w = gatherWorld({ cells: floating(), at: [100.5, SURF + 1, 100.5], pickup: true, reach: true })
    const r = await run(mod, w.bot, { block: 'dirt', count: 2 })
    assert.ok(!w.digs.some(d => d.name === 'grass_block'), JSON.stringify(w.digs.map(keyOf)))
    assert.notEqual(r.status, 'success')
  })
})

// ---- the clean zone's trap: a 1-deep trench (the bot's feet at the lawn), where this rule still refuses its walls --------
const zoneTrench = (cells = plain({ ox: 2930, oz: 2900 })) => { for (let z = 2992; z <= 3008; z++) cells.delete(key(3031, SURF, z)); return cells }
async function zoneTrapDigs (mod, cells = zoneTrench()) {
  const w = gatherWorld({ cells, at: [3031.5, SURF, 3000.5], pickup: true })
  const trap = CZ.gatherTrapOf({ x: 3031, y: SURF, z: 3000 }, Date.now())
  w.bot.gatherTrap = trap
  let withTrap = 0
  const dig0 = w.bot.dig.bind(w.bot)
  w.bot.dig = async b => { if (w.bot.gatherTrap === trap) withTrap++; return dig0(b) }
  for (let i = 0; i < 6 && w.bot.gatherTrap === trap; i++) await run(mod, w.bot, { block: 'dirt', count: 16 }, { trapOk: true })
  return { ...w, trap, withTrap }
}
await t('(i) THE ZONE\'S TRAP: in the zone, cells both rules refuse: exactly trapMax are taken while the trap lasts (runs repeated: no pickup without the walk)', async () => {
  const { trap, withTrap, digs } = await zoneTrapDigs(SK)
  assert.equal(withTrap, CZ.GATHER_ZONE.trapMax, JSON.stringify(digs.map(keyOf)))
  assert.equal(trap.left, 0)
})
await t('MUTANT KILLED: the swing re-asks the trap after the zone counted it down -> trapMax - 1', async () => {
  await withMutantsAll(SKILLS_URL, [SWING_REASK], async mod => { const { withTrap } = await zoneTrapDigs(mod); assert.equal(withTrap, CZ.GATHER_ZONE.trapMax - 1) })
})
await t('MADE GROUND, zone trap: farmland in the trap\'s reach is never taken', async () => {
  const field = () => zoneTrench(plain({ ox: 2930, oz: 2900, cap: 'farmland', dirt: 0 }))   // no dirt: farmland is the only source
  const { digs } = await zoneTrapDigs(SK, field())
  assert.ok(!digs.some(d => d.name === 'farmland'), JSON.stringify(digs.map(keyOf)))
  await withTopdownMutant([MADE_LIFT], async (TDm, SKm) => { const m = await zoneTrapDigs(SKm, field()); assert.ok(m.digs.some(d => d.name === 'farmland')) })
})
await t('(5) a cell the trap lets through is taken although refused (outside the zone, the trap set by hand); TRAP mutant refuses it', async () => {
  const go = async mod => {
    const w = gatherWorld({ cells: holeAt(1, 1), at: [100.5, SURF, 100.5] })
    w.bot.gatherTrap = CZ.gatherTrapOf({ x: 100, y: SURF, z: 100 }, Date.now())
    await run(mod, w.bot, { block: 'dirt', count: 1 }, { trapOk: true }); return w
  }
  const w = await go(SK)
  assert.ok(w.digs.some(d => d.refused), `the trap's cell taken: ${JSON.stringify(w.digs.map(keyOf))}`)
  await withMutantsAll(SKILLS_URL, [TRAP], async mod => { const m = await go(mod); assert.ok(m.digs.every(d => !d.refused)) })
})

// ---- the layers, the bound, the whole chain ---------------------------------------------------------------------------
await t('(7) LAYERS: enumeration and target removed -> the swing holds; enumeration and swing removed -> the target holds; all three -> the plain is hollowed', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE], async mod => { const w = gatherWorld({ cells: trench(plain()) }); await run(mod, w.bot); assert.ok(w.digs.every(d => !d.refused)) })
  await withMutantsAll(SKILLS_URL, [ENUM, SWING], async mod => { const w = gatherWorld({ cells: trench(plain()) }); await run(mod, w.bot); assert.ok(w.digs.every(d => !d.refused)) })
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE, SWING], async mod => { const w = gatherWorld({ cells: trench(plain()) }); await run(mod, w.bot); assert.ok(w.digs.some(d => d.refused && d.name === 'dirt')) })
})
await t('(6b) open dirt beyond a slab of 243 refused cells is reached (no give-up)', async () => {
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
await t('(12) A BOUNDED SEARCH: past 256 refusals the search is given up -- the open dirt beyond is not reached, the grass is taken; gave_up=1', async () => {
  rows.length = 0
  const { bot, digs, searches } = gatherWorld({ cells: bigSlab() })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs[0].name === 'grass_block' && !digs.some(d => d.x >= 112), show(r, digs))
  assert.match(tdRows('skip')[0].skill.detail, /^op=skip block=dirt skipped=256 via=grass_block found=\d+ gave_up=1$/)
  REAL12.calls = searches[0].calls
})
await t('MUTANT KILLED: without the bound the search walks on and reaches the open dirt', async () => {
  await withMutantsAll(SKILLS_URL, [GIVEUP], async mod => { const { bot, digs, searches } = gatherWorld({ cells: bigSlab() }); await run(mod, bot); assert.ok(searches[0].calls > REAL12.calls && digs.some(d => d.x >= 112)) })
})
await t('THE GIVE-UP ROW: a search given up in a LATER round of the run is still written (gave_up=1), not only the run\'s first skip', async () => {
  // round 1: the bot stands on a small island with one open dirt cell at its own level and a few refused cells; it takes it and
  // is moved onto the big plain, where round 2's search is given up
  const scene = () => { const c = bigSlab(); for (let x = 140; x <= 142; x++) for (let z = 98; z <= 102; z++) { c.set(key(x, SURF - 1, z), 'dirt'); c.set(key(x, SURF, z), 'grass_block') } c.set(key(141, SURF + 1, 100), 'dirt'); return c }
  const go = async mod => {
    rows.length = 0
    const w = gatherWorld({ cells: scene(), at: [140.5, SURF + 1, 100.5], pickup: true, onDig: (bot, n) => { if (n === 1) bot.entity.position = new Vec3(100.5, SURF + 1, 100.5) } })
    await run(mod, w.bot, { block: 'dirt', count: 3 }); return { ...w, gave: tdRows('skip').filter(x => /gave_up=1/.test(x.skill.detail)) }
  }
  const real = await go(SK)
  assert.ok(real.digs.length >= 2, JSON.stringify(real.digs.map(keyOf)))
  assert.ok(real.gave.length >= 1, `a gave_up row: ${JSON.stringify(tdRows('skip').map(x => x.skill.detail))}`)
  await withMutantsAll(SKILLS_URL, [GIVEUP_ROW], async mod => { const m = await go(mod); assert.equal(m.gave.length, 0) })
})
const bareBeside = (x, z) => (x >= 99 && x <= 101 && z >= 99 && z <= 101) ? 'dirt' : null
await t('KEPT CELLS: a search given up after accepting open cells returns them (the patch is dug, not the grass)', async () => {
  rows.length = 0
  const { bot, digs } = gatherWorld({ cells: plain({ capAt: bareBeside }) })
  const r = await run(SK, bot)
  assert.ok(tdRows('skip').some(x => /gave_up=1/.test(x.skill.detail)))
  assert.ok(digs.length > 0 && digs.every(d => d.name === 'dirt' && d.y === SURF), show(r, digs))
  await withMutantsAll(SKILLS_URL, [KEPT_NONE], async mod => { const w = gatherWorld({ cells: plain({ capAt: bareBeside }) }); await run(mod, w.bot); assert.equal(w.digs[0]?.name, 'grass_block') })
})
const pzRun = async (mod) => {
  rows.length = 0
  const w = gatherWorld({ cells: plain({ capAt: bareBeside }) })
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
  await withMutantsAll(SKILLS_URL, [REFILTER], async mod => { const m = await pzRun(mod); assert.ok(m.refused.some(x => x.op === 'dig') || m.digs.some(inPatch)) })
})
await t('THE IN-RANGE GUARD: refused dirt only beyond the search -> no skip row, the base\'s "no dirt within 32"; without the guard -> skipped, the remedy', async () => {
  const far = () => new Map([...plain({ ox: 36 })].filter(([k]) => Number(k.split(',')[0]) >= 133))
  rows.length = 0
  const w = gatherWorld({ cells: far() })
  const r = await run(SK, w.bot)
  assert.equal(w.digs.length, 0); assert.match(String(r.detail), /^no dirt within 32 blocks/, show(r, w.digs)); assert.equal(tdRows('skip').length, 0)
  await withMutantsAll(SKILLS_URL, [INRANGE], async mod => { rows.length = 0; const m = gatherWorld({ cells: far() }); const rm = await run(mod, m.bot); assert.match(String(rm.detail), /open to the sky/) })
})
await t('THE SECOND FALLBACK\'S SKIPS do not leak into the next round', async () => {
  const leakWorld = () => { const c = new Map(); for (let x = 92; x <= 108; x++) for (let z = 92; z <= 108; z++) { for (let y = 62; y < SURF; y++) c.set(key(x, y, z), 'stone'); c.set(key(x, SURF, z), 'grass_block') } for (const x of [99, 100]) c.set(key(x, SURF, 100), 'dirt'); for (let x = 104; x <= 106; x++) c.set(key(x, SURF + 1, 100), 'stone'); return c }
  const go = async mod => { rows.length = 0; const w = gatherWorld({ cells: leakWorld() }); w.bot.collectBlock.movements.safeToBreak = b => b?.name !== 'dirt'; const r = await run(mod, w.bot, { block: 'dirt', count: 2 }); return { ...w, r, skip: tdRows('skip') } }
  const real = await go(SK)
  assert.ok(real.digs.some(d => d.name === 'grass_block'), show(real.r, real.digs)); assert.deepEqual(real.skip, [])
  await withMutantsAll(SKILLS_URL, [LEAK], async mod => { const m = await go(mod); assert.ok(m.skip.length > 0) })
})
await t('CLAUDE r3 NOTE, A MEASURED TENDENCY (not a guarantee): on the plain an open 3x3 scrape 2-4 blocks from the bot is widened in at least 16 of 24 placements (19 measured); every run digs', async () => {
  let kept = 0, lost = 0
  const where = []
  for (const dx of [-4, -2, 0, 2, 4]) for (const dz of [-4, -2, 0, 2, 4]) {
    if (!dx && !dz) continue
    const c = plain(); for (let x = 99 + dx; x <= 101 + dx; x++) for (let z = 99 + dz; z <= 101 + dz; z++) c.delete(key(x, SURF, z))
    const w = gatherWorld({ cells: c })
    await run(SK, w.bot)
    const d = w.digs[0]
    assert.ok(d, `the run at ${dx},${dz} dug nothing`)
    if (d && d.y === SURF - 1 && Math.abs(d.x - (100 + dx)) <= 1 && Math.abs(d.z - (100 + dz)) <= 1) kept++; else { lost++; where.push(`${dx},${dz}`) }
  }
  console.log(`  CLAUDE NOTE: of 24 open 3x3 scrapes 2-4 blocks from the bot, the first dig was in the scrape ${kept} times; ${lost} times it began a new one (${where.join(' ')})`)
  assert.equal(kept + lost, 24); assert.ok(kept >= 16, `widened ${kept} of 24`)
})
console.log(`
${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
