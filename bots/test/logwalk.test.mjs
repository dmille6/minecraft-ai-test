// LOGWALK-01show (showcase 11-20: 0 log gathers after 13Z; 117 of 117 failures "spruce_log found but all N candidate(s) are floors
// over a drop into a cave", under 1.4 s, 99 within ~12 blocks of the town centre): the nostock built-cell walk-out was guarded by
// `!caveInBorder().length`, and in town the logs that are not in a building are cave floors -- two guards composed into a dead end.
//   1. built cells and/or cave floors emptied the search -> the walk-out fires; the cave refusal comes only once the walks are spent
//      and then names a point further out;
//   2. the walk aims at the nearest live wood find of the atlas (outside town ground, zones and plan cells), capped; with none known,
//      the nostock 25-block step;
//   3. one `_gather_walk` row a try; an atlas walk that arrived and found nothing marks its find gone.
// This file runs AS THE SHOWCASE (MEMORY_POOL=showcase before any import), as nostock.test.mjs does.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
process.env.OLLAMA_MODEL ??= 'test'
process.env.MEMORY_POOL = 'showcase'
process.env.BOT_ROLE = 'gatherer'
process.env.HOME_X = '0'; process.env.HOME_Y = '30'; process.env.HOME_Z = '0'
process.env.LOG_DIR ??= mkdtempSync(join(tmpdir(), 'logwalk-test-'))
process.env.STATE_DIR ??= mkdtempSync(join(tmpdir(), 'logwalk-state-'))
const GB = await import('../src/gatherbuilt.mjs')
const SK = await import('../src/skills.mjs')
const AT = await import('../src/atlas.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const MC = createRequire(import.meta.url)('minecraft-data')('1.21.8')
const SK_URL = new URL('../src/skills.mjs', import.meta.url)

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
/** climb-escape.test.mjs's withMutant: the anchor present AND unique, or the mutant is refused (a mutant never written reads as killed). */
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-logwalk-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---------------------------------------------------------------- the pure decisions
await ta('walkOutDue: built and/or cave floors emptied the search -> due; spent walks, a found candidate, a collected log or nothing skipped -> not', () => {
  const d = o => GB.walkOutDue({ positions: 0, built: 0, cave: 0, collected: 0, walked: 0, ...o })
  assert.equal(d({ built: 40, cave: 3 }), true, 'built + cave floors (the showcase town): due -- the nostock guard refused this')
  assert.equal(d({ cave: 3 }), true, 'cave floors alone: due')
  assert.equal(d({ built: 40 }), true, 'built alone: due (nostock)')
  assert.equal(d({ built: 40, cave: 3, walked: GB.BUILT_WALKS }), false, 'walks spent: the refusal')
  assert.equal(d({ built: 40, positions: 1 }), false, 'a candidate: no walk')
  assert.equal(d({ built: 40, collected: 1 }), false, 'a log in hand: no walk')
  assert.equal(d({}), false, 'nothing skipped: nothing_found, no walk')
})
const F = (x, z, kind = 'spruce_log', y = 30) => ({ kind, cat: 'wood', x, y, z, last: 1, n: 1, by: ['b'] })
await ta('atlasWalkTarget: the nearest find of the kind that `ok` passes, beyond minDist; capped toward a far one', () => {
  const from = { x: 0, z: 0 }
  const finds = [F(10, 0), F(0, 78), F(-90, 0), F(50, 50, 'oak_log')]
  assert.deepEqual(GB.atlasWalkTarget({ from, finds, kind: 'spruce_log', minDist: 32 }), { x: 0, z: 78, dist: 78, find: finds[1], capped: false })
  assert.equal(GB.atlasWalkTarget({ from, finds, kind: 'spruce_log', minDist: 32, ok: f => f.z !== 78 }).x, -90, 'ok refuses the 78: the next')
  const far = GB.atlasWalkTarget({ from, finds: [F(200, 0)], kind: 'spruce_log', cap: 96 })
  assert.deepEqual([far.x, far.z, far.dist, far.capped], [96, 0, 96, true], 'capped: 96 blocks toward it')
  assert.equal(GB.atlasWalkTarget({ from, finds, kind: 'birch_log' }), null, 'no find of the kind')
  assert.equal(GB.atlasWalkTarget({ from, finds, kind: 'spruce_log', ok: () => { throw new Error('x') } }), null, 'an ok that throws refuses')
  assert.equal(GB.atlasWalkTarget({ from: null, finds, kind: 'spruce_log' }), null)
})
await ta('walkTargetFor: a known find -> via=atlas; none -> the nostock step (builtRemedyPoint) via=step', () => {
  const from = { x: 2, z: 0 }
  const cells = [{ x: 12, z: 0 }]
  assert.equal(GB.walkTargetFor({ from, home: { x: 0, z: 0 }, cells, finds: [F(0, 78)], kind: 'spruce_log', minDist: 32 }).via, 'atlas')
  const s = GB.walkTargetFor({ from, home: { x: 0, z: 0 }, cells, finds: [], kind: 'spruce_log', minDist: 32 })
  assert.deepEqual(s, { x: 37, z: 0, dist: 35, via: 'step' })
  assert.deepEqual({ x: s.x, z: s.z }, GB.builtRemedyPoint({ from, home: { x: 0, z: 0 }, cells }))
})
await ta('missIsGone / walkMsFor / walkSpentRemedy', () => {
  assert.equal(GB.missIsGone({ via: 'atlas', arrived: true, found: 0 }), true)
  assert.equal(GB.missIsGone({ via: 'atlas', arrived: false, found: 0 }), false, 'not arrived: unknown, not gone')
  assert.equal(GB.missIsGone({ via: 'atlas', arrived: true, found: 2 }), false)
  assert.equal(GB.missIsGone({ via: 'step', arrived: true, found: 0 }), false, 'a step walk has no find')
  assert.equal(GB.walkMsFor(25), GB.BUILT_WALK_MS); assert.equal(GB.walkMsFor(96), 57_600); assert.equal(GB.walkMsFor(1e6), GB.WALK_MS_MAX)
  assert.equal(GB.walkSpentRemedy({ block: 'spruce_log', walked: 0 }), '')
  assert.match(GB.walkSpentRemedy({ block: 'spruce_log', walked: 1, to: { x: 37, z: 0 }, next: { x: 62, z: 0 } }), /walked out 1 time\(s\) \(to 37,0\) .*goto x=62 z=0/)
})
await ta('atlas gone(find): installAtlas\'s bot.atlas.gone drops the find from every reader\'s view at once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logwalk-atlas-'))
  const other = AT.emptyDoc('other'); AT.mergeFind(other.finds, { kind: 'spruce_log', x: 0, y: 30, z: 78 }, 1000, 'other')
  AT.writeDoc(AT.atlasFile(dir, 'other'), other)
  const bot = Object.assign(new EventEmitter(), { username: 'me', entity: { position: new Vec3(0, 30, 0) }, blockAt: () => null, findBlocks: () => [], registry: MC })
  AT.dropViewCache()
  AT.installAtlas(bot, { on: true, dir, by: 'me', Vec3 })
  try {
    const f = bot.atlas.view().finds.find(q => q.kind === 'spruce_log')
    assert.ok(f, 'the other bot\'s find is in the view')
    assert.equal(bot.atlas.gone(f), true)
    assert.equal(bot.atlas.view().finds.filter(q => q.kind === 'spruce_log').length, 0, 'gone for every reader (the cache dropped)')
    assert.equal(bot.atlas.gone({ kind: 'nope', x: 1, y: 1, z: 1 }), false, 'not a find kind')
  } finally { bot.emit('end') }
})

// ---------------------------------------------------------------- the refusal chain, on a fake town (nostock.test.mjs logWorld, plus
// cave floors and the atlas): home 0,30,0; a stone floor at y=29; a two-storey house of logs (x 3..12, z 0..1) the profile prices 100;
// CAVE logs at y=30 over open columns (no floor for 32+ blocks: a floor over a drop); trees out where `trees` says. The fake
// pathfinder teleports to a reached goal (2 blocks east of its column, on the floor) or answers noPath.
const key = (x, y, z) => `${x},${y},${z}`
function townWorld ({ house = [], cave = [], trees = [], planned = [], at = [2.5, 30, 0.5], walkTo = 'arrive', finds = null }) {
  const L = MC.blocksByName.spruce_log
  const logs = new Set([...house, ...cave, ...trees].map(p => key(...p)))
  const priced = new Set([...house, ...planned].map(p => key(...p)))
  const holes = new Set(cave.map(([x, , z]) => `${x},${z}`))
  const digs = []
  const blk = (x, y, z) => {
    const isLog = logs.has(key(x, y, z)), isFloor = !isLog && y === 29 && !holes.has(`${x},${z}`)
    const t = isLog ? L : isFloor ? MC.blocksByName.stone : MC.blocksByName.air
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: (isLog || isFloor) ? 'block' : 'empty', diggable: isLog,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/axe', hardness: isLog ? 2 : 0 }
  }
  const moves = { exclusionBreak: b => (priced.has(key(b.position.x, b.position.y, b.position.z)) ? 100 : 0) }
  moves.safeToBreak = b => moves.exclusionBreak(b) < 100
  const gone = []
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    // the bag holds what was dug (gather grades the drop it holds)
    inventory: { items: () => (digs.length ? [{ name: 'spruce_log', count: digs.length, type: MC.itemsByName.spruce_log.id }] : []), emptySlotCount: () => 30 },
    registry: { blocksByName: MC.blocksByName, blocks: MC.blocks, itemsByName: MC.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && b.type === matching)
      if (!fn({ type: L.id, name: 'spruce_log' })) return []
      return [...logs].map(k => blk(...k.split(',').map(Number))).filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: moves },
    pathfinder: { movements: moves, goal: null, setMovements () {}, stop () {}, isMining: () => false, async goto () {},
      setGoal (g) {
        bot.pathfinder.goal = g
        if (!g) return
        setTimeout(() => {
          if (walkTo === 'arrive') { bot.entity.position = new Vec3(g.x + 2.5, 30, g.z + 0.5); bot.walks.push([g.x, g.z]); bot.emit('goal_reached', g) } else bot.emit('path_update', { status: 'noPath', path: [] })
        }, 5)
      } },
    walks: [],
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); logs.delete(key(b.position.x, b.position.y, b.position.z)) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
    fireSitesNow: () => [], protectZones: () => [],
  })
  if (finds) bot.atlas = { view: () => ({ finds }), gone: f => { gone.push(f); return true } }
  return { bot, digs, gone }
}
const HOUSE = []; for (let x = 3; x <= 12; x++) for (let z = 0; z <= 1; z++) for (let y = 30; y <= 31; y++) HOUSE.push([x, y, z])
/** Four cave-floor logs, in range from the start AND from the nostock step's point (37,0). */
const CAVE = [[25, 30, 6], [26, 30, 6], [27, 30, 6], [28, 30, 6]]
/** The forest: 78 blocks SOUTH of home, off the bearing the step walks (east, through the bot). */
const TREE = [[0, 30, 80], [0, 31, 80]]
const FIND = F(0, 80)
const runGather = (S, bot) => S.SKILLS.gather.run({ bot }, { block: 'spruce_log', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) }))
const rowsOf = name => { const rows = []; const untap = tapRecords(r => { if (r?.skill?.name === name) rows.push(`${r.skill.status} ${r.skill.detail}`) }); return { rows, untap } }

await ta('FIXTURE: the cave logs are floors over a drop (the cave rule skips them) and the house is priced 100 -- the showcase\'s town', async () => {
  const { bot } = townWorld({ house: HOUSE, cave: CAVE })
  const cf = SK.caveFilter(bot)
  assert.ok(CAVE.every(p => cf.skip(new Vec3(...p))), 'every cave log is skipped')
  assert.ok(!cf.skip(new Vec3(3, 31, 0)), 'a house log is not a cave floor')
})
await ta('BASE SHAPE (no atlas, no walk possible): built + cave floors -> the cave refusal, no dig (what the showcase logged 117 times)', async () => {
  await withMutant(SK_URL, 'if (walkOutDue({ positions: positions.length, built: builtSkippedNow, cave: caveNow.length, collected, walked: builtWalked })) {',
    'if (walkOutDue({ positions: positions.length, built: builtSkippedNow, cave: caveNow.length, collected, walked: builtWalked }) && !caveNow.length) {', async S => {
      const { bot, digs } = townWorld({ house: HOUSE, cave: CAVE, trees: TREE, finds: [FIND] })
      const r = await runGather(S, bot)
      assert.equal(digs.length, 0); assert.deepEqual(bot.walks, [], 'no walk (the dead end)')
      assert.equal(r.failClass, 'no_safe_target')
      assert.match(r.detail, /^spruce_log found but all \d+ candidate\(s\) are floors over a drop into a cave/)
    })
})
await ta('CHAIN (a): built + cave floors + an atlas find 80 out -> ONE walk to the find -> the tree there taken; one _gather_walk row', async () => {
  const { rows, untap } = rowsOf('_gather_walk')
  try {
    const { bot, digs, gone } = townWorld({ house: HOUSE, cave: CAVE, trees: TREE, finds: [FIND] })
    const r = await runGather(SK, bot)
    assert.deepEqual(bot.walks, [[0, 80]], 'one walk, to the find\'s column')
    assert.ok(digs.length >= 1 && digs.every(p => p.x === 0 && p.z === 80), `the tree, nothing else: ${JSON.stringify(digs)} ${JSON.stringify(r).slice(0, 200)}`)
    assert.equal(r.status, 'success')
    assert.equal(rows.length, 1, rows.join(' | '))
    assert.match(rows[0], /^success via=atlas block=spruce_log from=2,30,0 to=0,80 dist=80 arrived=1 found=\d+ built=\d+ cave=4 find=0,30,80 ms=\d+$/)
    assert.deepEqual(gone, [], 'a hit is not gone')
  } finally { untap() }
})
await ta('MUTANT KILLED (1): the nostock guard restored (`!caveInBorder().length`) -> no walk, the cave refusal, the tree never reached', async () => {
  await withMutant(SK_URL, 'if (walkOutDue({ positions: positions.length, built: builtSkippedNow, cave: caveNow.length, collected, walked: builtWalked })) {',
    'if (walkOutDue({ positions: positions.length, built: builtSkippedNow, cave: caveNow.length, collected, walked: builtWalked }) && !caveInBorder().length) {', async S => {
      const { bot, digs } = townWorld({ house: HOUSE, cave: CAVE, trees: TREE, finds: [FIND] })
      const r = await runGather(S, bot)
      assert.equal(digs.length, 0); assert.deepEqual(bot.walks, [])
      assert.match(r.detail, /floors over a drop into a cave/)
    })
})
await ta('MUTANT KILLED (2): the atlas not asked (finds: []) -> the 25-block step east, the forest to the south never reached', async () => {
  await withMutant(SK_URL, 'finds, kind: blockName, ok: atlasOk,', 'finds: [], kind: blockName, ok: atlasOk,', async S => {
    const { bot, digs } = townWorld({ house: HOUSE, cave: CAVE, trees: TREE, finds: [FIND] })
    await runGather(S, bot)
    assert.deepEqual(bot.walks, [[37, 0]], 'the step, not the find')
    assert.equal(digs.length, 0)
  })
})
await ta('CHAIN (b): no atlas find -> the 25-block step -> nothing there -> the cave refusal names the walk and a goto point; from that point the gather succeeds', async () => {
  const { rows, untap } = rowsOf('_gather_walk')
  let next
  try {
    const { bot, digs } = townWorld({ house: HOUSE, cave: CAVE, trees: [[82, 30, 0], [82, 31, 0]] })
    const r = await runGather(SK, bot)
    assert.deepEqual(bot.walks, [[37, 0]], 'one walk: the nostock step past the house')
    assert.equal(digs.length, 0)
    assert.equal(r.failClass, 'no_safe_target')
    const m = r.detail.match(/^spruce_log found but all \d+ candidate\(s\) are floors over a drop into a cave.* -- walked out 1 time\(s\) \(to 37,0\) and found none there either: goto x=(-?\d+) z=(-?\d+) \(25 blocks further out\) and gather spruce_log there, or explore/)
    assert.ok(m, r.detail)
    next = { x: +m[1], z: +m[2] }
    assert.ok(Math.hypot(next.x - 37, next.z) >= 20, `further out: ${JSON.stringify(next)}`)
    assert.equal(rows.length, 1); assert.match(rows[0], /^failed via=step block=spruce_log from=2,30,0 to=37,0 dist=35 arrived=1 found=0 /)
  } finally { untap() }
  // the remedy, performed: the bot at the named point gathers the tree there
  const w2 = townWorld({ house: HOUSE, cave: CAVE, trees: [[82, 30, 0], [82, 31, 0]], at: [next.x + 0.5, 30, next.z + 0.5] })
  const r2 = await runGather(SK, w2.bot)
  assert.equal(r2.status, 'success', JSON.stringify(r2).slice(0, 200)); assert.ok(w2.digs.every(p => p.x === 82))
})
await ta('CHAIN (miss): an atlas walk that arrives where the tree was felled -> the find marked gone, the row says gone=1, then the refusal', async () => {
  const { rows, untap } = rowsOf('_gather_walk')
  try {
    const { bot, digs, gone } = townWorld({ house: HOUSE, cave: CAVE, trees: [], finds: [FIND] })
    const r = await runGather(SK, bot)
    assert.deepEqual(bot.walks, [[0, 80]]); assert.equal(digs.length, 0)
    assert.deepEqual(gone, [FIND], 'the find is gone for the next bot')
    assert.match(rows[0], /^failed via=atlas .* arrived=1 found=0 .* gone=1/)
    assert.equal(r.status, 'failed')
  } finally { untap() }
})
await ta('CHAIN (not arrived): the atlas walk finds no path -> not gone (unknown), the refusal', async () => {
  const { bot, gone } = townWorld({ house: HOUSE, cave: CAVE, trees: TREE, finds: [FIND], walkTo: 'noPath' })
  const r = await runGather(SK, bot)
  assert.deepEqual(gone, []); assert.equal(r.status, 'failed')
})
await ta('THE ATLAS FILTER: a find on a plan cell, inside town ground, or within the search just made is never the target -> the step', async () => {
  for (const [label, finds, planned] of [
    ['plan cell', [FIND], [[0, 30, 80]]],
    ['town ground', [F(10, 10)], []],
    ['inside the search', [F(2, 20)], []],
  ]) {
    const { bot } = townWorld({ house: HOUSE, cave: CAVE, finds, planned })
    await runGather(SK, bot)
    assert.deepEqual(bot.walks, [[37, 0]], `${label}: the step, not the find`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
