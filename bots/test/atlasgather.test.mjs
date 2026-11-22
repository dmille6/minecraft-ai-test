// ATLASGATHER-01show (showcase 11-22 00:40-03:40Z: gather failed 387 of 572; 102 "sand found but all N candidates are beside water or under
// falling blocks", 63 "spruce_log: all N candidate(s) in range refused -- could not stand within reach", 23 stone beside water, 18 dirt
// protected / built, 17 iron buried): the SAME refused spots were tried again and again, visit after visit (gatherRun's `excluded` set lives
// for one run). A refusal is now a per-bot record (gatherrefused.mjs): the enumeration skips it, a search emptied by records walks out
// (logwalk's walk), and only then refuses -- naming a goto the bot can make, never the same spots.
//   1. the pure decisions: classes, strikes, TTL, re-asking the live cell, the bound, the refusal text;
//   2. gatherRun on a fake shore: BASE (memory off) retries the same 32 shore cells forever; HEAD skips them and takes the fresh sand;
//   3. the composed chain: every cell in range remembered -> the walk-out -> a gather that succeeds elsewhere; no walk left -> a refusal
//      that names a goto point, no dig at the remembered spots;
//   4. anchored mutants (each asserts its anchor is present and unique).
// Runs AS THE SHOWCASE (MEMORY_POOL=showcase before any import), as logwalk.test.mjs does.
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
process.env.HOME_X = '2000'; process.env.HOME_Y = '30'; process.env.HOME_Z = '0'   // the town is far: sand at the origin is not town ground
process.env.LOG_DIR ??= mkdtempSync(join(tmpdir(), 'atlasgather-test-'))
process.env.STATE_DIR ??= mkdtempSync(join(tmpdir(), 'atlasgather-state-'))
const GR = await import('../src/gatherrefused.mjs')
const GB = await import('../src/gatherbuilt.mjs')
const SK = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const MC = createRequire(import.meta.url)('minecraft-data')('1.21.8')
const SK_URL = new URL('../src/skills.mjs', import.meta.url)
const GR_URL = new URL('../src/gatherrefused.mjs', import.meta.url)

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
/** climb-escape.test.mjs's withMutant: the anchor present AND unique, or the mutant is refused. */
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-atlasgather-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const P = (x, y, z) => new Vec3(x, y, z)
const H = 3_600_000

// ---------------------------------------------------------------- 1. the pure decisions
await ta('classOfVeto: liquid/both -> liquid, falling, built -> protected, unknown -> unsafe, entity -> not recorded', () => {
  assert.equal(GR.classOfVeto('liquid'), 'liquid'); assert.equal(GR.classOfVeto('both'), 'liquid')
  assert.equal(GR.classOfVeto('falling'), 'falling'); assert.equal(GR.classOfVeto('built'), 'protected')
  assert.equal(GR.classOfVeto('unknown'), 'unsafe'); assert.equal(GR.classOfVeto('entity'), null)
})
await ta('each refusal class: a record refuses that cell of that kind, and only it (positive control: a fresh cell and another kind are not refused)', () => {
  for (const cls of ['liquid', 'falling', 'unsafe', 'protected', 'buried']) {
    const m = GR.newMemory()
    assert.equal(GR.noteRefusal(m, { kind: 'sand', pos: P(5, 30, 2), cls, now: 0 }), cls, `${cls}: one failure stands`)
    assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(5, 30, 2), now: 1 }), cls)
    assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(6, 30, 2), now: 1 }), null, 'a fresh cell')
    assert.equal(GR.isRefused(m, { kind: 'gravel', pos: P(5, 30, 2), now: 1 }), null, 'another kind at the cell')
  }
  assert.equal(GR.noteRefusal(GR.newMemory(), { kind: 'sand', pos: P(0, 0, 0), cls: 'nonsense' }), null, 'an unknown class is not recorded')
})
await ta('no_stand: one weak failure is not yet a record; the second, or a strong one, is', () => {
  const m = GR.newMemory()
  assert.equal(GR.noteRefusal(m, { kind: 'spruce_log', pos: P(1, 30, 1), cls: 'no_stand', now: 0 }), null)
  assert.equal(GR.isRefused(m, { kind: 'spruce_log', pos: P(1, 30, 1), now: 1 }), null, 'one strike: still offered')
  assert.equal(GR.noteRefusal(m, { kind: 'spruce_log', pos: P(1, 30, 1), cls: 'no_stand', now: 2 }), 'no_stand')
  assert.equal(GR.isRefused(m, { kind: 'spruce_log', pos: P(1, 30, 1), now: 3 }), 'no_stand')
  assert.equal(GR.noteRefusal(m, { kind: 'spruce_log', pos: P(2, 30, 1), cls: 'no_stand', now: 0, strong: true }), 'no_stand')
})
await ta('TTL expiry: a record stands for its class\'s TTL (2 h; no_stand 1 h) and is then gone, and dropped', () => {
  const m = GR.newMemory()
  GR.noteRefusal(m, { kind: 'sand', pos: P(1, 30, 1), cls: 'liquid', now: 0 })
  GR.noteRefusal(m, { kind: 'spruce_log', pos: P(2, 30, 1), cls: 'no_stand', now: 0, strong: true })
  assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(1, 30, 1), now: 2 * H - 1 }), 'liquid')
  assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(1, 30, 1), now: 2 * H }), null, 'expired at 2 h')
  assert.equal(GR.isRefused(m, { kind: 'spruce_log', pos: P(2, 30, 1), now: H - 1 }), 'no_stand')
  assert.equal(GR.isRefused(m, { kind: 'spruce_log', pos: P(2, 30, 1), now: H }), null, 'no_stand: 1 h')
  assert.equal(m.size, 0, 'expired records are dropped on read')
})
await ta('the block changed: `still` false drops the record at once (water drained); a throwing `still` keeps it (the TTL bounds it)', () => {
  const m = GR.newMemory()
  GR.noteRefusal(m, { kind: 'sand', pos: P(1, 30, 1), cls: 'liquid', now: 0 })
  assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(1, 30, 1), now: 1, still: () => { throw new Error('x') } }), 'liquid')
  assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(1, 30, 1), now: 1, still: cls => cls !== 'liquid' }), null)
  assert.equal(m.size, 0)
})
await ta('bounded: more than MAX_RECORDS drops the oldest', () => {
  const m = GR.newMemory()
  for (let i = 0; i < GR.MAX_RECORDS + 20; i++) GR.noteRefusal(m, { kind: 'sand', pos: P(i, 30, 0), cls: 'liquid', now: i })
  assert.equal(m.size, GR.MAX_RECORDS)
  assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(0, 30, 0), now: 1000 }), null, 'the oldest went')
  assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(GR.MAX_RECORDS + 19, 30, 0), now: 1000 }), 'liquid')
})
await ta('refusalDue / walkOutDue(refused) / refusedRefusal: the walk first; the refusal names a goto and the classes', () => {
  assert.equal(GR.refusalDue({ positions: 0, refused: 5, collected: 0 }), true)
  assert.equal(GR.refusalDue({ positions: 1, refused: 5 }), false, 'a fresh candidate: no refusal')
  assert.equal(GR.refusalDue({ positions: 0, refused: 0 }), false, 'nothing remembered: the base\'s nothing_found')
  assert.equal(GR.refusalDue({ positions: 0, refused: 5, collected: 2 }), false)
  assert.equal(GB.walkOutDue({ positions: 0, refused: 5 }), true, 'a search emptied by records walks out')
  assert.equal(GB.walkOutDue({ positions: 0, refused: 5, walked: GB.BUILT_WALKS }), false, 'the walk spent: the refusal')
  assert.equal(GB.walkOutDue({ positions: 2, refused: 5 }), false)
  const t = GR.refusedRefusal({ block: 'sand', n: 32, classes: { liquid: 30, falling: 2 }, point: { x: 40, z: -3 }, walked: 1, to: { x: 37, z: 0 } })
  assert.match(t, /^goto x=40 z=-3 \(25\+ blocks away\) and gather sand there -- all 32 sand within 32 blocks refused this bot before \(liquid:30 falling:2\)/)
  assert.match(t, /walked out 1 time\(s\) \(to 37,0\)/)
  assert.match(GR.refusedRefusal({ block: 'sand', n: 3 }), /^explore 25\+ blocks away, then gather sand/)
})

// ---------------------------------------------------------------- 2/3. gatherRun on a fake shore
// Home 0,30,0. A stone floor at y=29 under every column. SAND cells at y=30; WATER above a cell is the veto (breakVeto: liquid). The bot
// teleports to a reached goal (2.5 east of its column) or answers noPath. `shore`: refused sand; `fresh`: takeable sand; `logs`: spruce logs;
// `badDig`: cells whose dig throws (no stand).
const key = (x, y, z) => `${x},${y},${z}`
function world ({ shore = [], fresh = [], logs = [], badDig = [], at = [0.5, 30, 0.5], walkTo = 'arrive', finds = null, memoryOff = false }) {
  const kinds = new Map()
  for (const p of shore) kinds.set(key(...p), 'sand')
  for (const p of fresh) kinds.set(key(...p), 'sand')
  for (const p of logs) kinds.set(key(...p), 'spruce_log')
  const water = new Set(shore.map(([x, y, z]) => key(x, y + 1, z)))
  const bad = new Set(badDig.map(p => key(...p)))
  const taken = []
  const blk = (x, y, z) => {
    const k = key(x, y, z), kind = kinds.get(k)
    const name = kind ?? (water.has(k) ? 'water' : y === 29 ? 'stone' : 'air')
    const t = MC.blocksByName[name]
    const solid = !!kind || name === 'stone'
    return { name, type: t.id, position: new Vec3(x, y, z), boundingBox: solid ? 'block' : 'empty', diggable: !!kind, canHarvest: () => true, digTime: () => 50, material: name === 'sand' ? 'mineable/shovel' : 'mineable/axe', hardness: 1 }
  }
  const dec = b => { b.liquid = b.name === 'water'; b.canFall = b.name === 'sand' || b.name === 'gravel'; return b }
  const moves = {
    exclusionBreak: () => 0,
    getBlock: (p, dx, dy, dz) => dec(blk(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz)),
    safeToBreak (b) {   // dontCreateFlow + dontMineUnderFallingBlock, as the profile's
      const x = b.position.x, y = b.position.y, z = b.position.z
      if (dec(blk(x, y + 1, z)).liquid || dec(blk(x, y + 1, z)).canFall) return false
      return ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => dec(blk(x + dx, y, z + dz)).liquid)
    },
  }
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => { const out = {}; for (const n of taken) out[n] = (out[n] ?? 0) + 1; return Object.entries(out).map(([name, count]) => ({ name, count, type: MC.itemsByName[name].id })) }, emptySlotCount: () => 30 },
    registry: { blocksByName: MC.blocksByName, blocks: MC.blocks, itemsByName: MC.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && b.type === matching)
      return [...kinds.keys()].map(k => blk(...k.split(',').map(Number))).filter(b => b.position.distanceTo(bot.entity.position.floored()) <= maxDistance && fn(b))   // mineflayer measures from the floored position
        .sort((a, b) => a.position.distanceTo(bot.entity.position.floored()) - b.position.distanceTo(bot.entity.position.floored())).slice(0, count).map(b => b.position)
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
    walks: [], digAt: [],
    nearestEntity: () => null, entities: {},
    async dig (b) {
      bot.digAt.push([b.position.x, b.position.y, b.position.z])
      if (bad.has(key(b.position.x, b.position.y, b.position.z))) throw new Error('no path to a stance')
      taken.push(kinds.get(key(b.position.x, b.position.y, b.position.z))); kinds.delete(key(b.position.x, b.position.y, b.position.z))
    },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
    fireSitesNow: () => [], protectZones: () => [],
  })
  if (finds) bot.atlas = { view: () => ({ finds }), gone: () => true }
  return { bot, taken }
}
const run = (S, bot, block = 'sand') => S.SKILLS.gather.run({ bot }, { block, count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) }))
/** 40 shore sand cells (water above each) 3..10 east, z 0..4: nearer than the fresh sand 30 out, so the search's 32 are all shore. */
const SHORE = []; for (let x = 3; x <= 10; x++) for (let z = 0; z <= 4; z++) SHORE.push([x, 30, z])
const FRESH = [[0, 30, 30]]
const rowsOf = name => { const rows = []; const untap = tapRecords(r => { if (r?.skill?.name === name) rows.push(`${r.skill.status} ${r.skill.detail}`) }); return { rows, untap } }
const noMemory = fn => withMutant(SK_URL, 'isRefused(refMem, { kind: b.name, pos: b.position, still: cls => refStill(cls, b.position, b) })', 'false', fn)

await ta('FIXTURE: 40 shore cells are all refused by the safety rule (water above), the fresh sand is takeable; the search\'s 32 nearest are shore', async () => {
  const { bot } = world({ shore: SHORE, fresh: FRESH })
  assert.ok(SHORE.every(p => SK.breakVetoAt(bot, P(...p)) === 'liquid'))
  assert.equal(SK.breakVetoAt(bot, P(...FRESH[0])), null)
  const near = bot.findBlocks({ matching: b => b.name === 'sand', maxDistance: 32, count: 32 })
  assert.ok(near.every(p => p.x >= 3 && p.x <= 10), 'the fresh sand is not among the 32')
})
await ta('BASE (memory off): visit 1 AND visit 2 both fail "beside water" on the same shore cells; the fresh sand is never reached', async () => {
  await noMemory(async S => {
    const { bot } = world({ shore: SHORE, fresh: FRESH })
    for (const visit of [1, 2]) {
      const r = await run(S, bot)
      assert.equal(r.failClass, 'no_safe_target', `visit ${visit}`)
      assert.match(r.detail, /^sand found but all 32 candidates are beside water or under falling blocks/, `visit ${visit}`)
    }
    assert.deepEqual(bot.digAt, [])
  })
})
const FRESH2 = [[0, 30, 30], [1, 30, 30]]
await ta('HEAD, visit 1: the 32 shore cells are remembered (a `_gather_refused op=note` row), the NEXT search takes the fresh sand -- one run, no failed visit', async () => {
  const { rows, untap } = rowsOf('_gather_refused')
  try {
    const { bot, taken } = world({ shore: SHORE, fresh: FRESH2 })
    const r = await run(SK, bot)
    assert.equal(r.status, 'success', JSON.stringify(r).slice(0, 220))
    assert.deepEqual(taken, ['sand'])
    assert.ok(bot.digAt.every(([x, , z]) => z === 30 && x <= 1), `only fresh sand was dug: ${JSON.stringify(bot.digAt)}`)
    assert.match(rows[0], /^no_effect op=note block=sand skipped=0 noted=32 classes=liquid:32$/)
    assert.deepEqual(GR.standing(GR.memoryOf(bot), 'sand').classes, { liquid: 40 })
  } finally { untap() }
})
await ta('HEAD, visit 2 (POSITIVE CONTROL): the remembered cells are skipped at enumeration (no re-noting) and the other fresh sand is taken', async () => {
  const { rows, untap } = rowsOf('_gather_refused')
  try {
    const { bot, taken } = world({ shore: SHORE, fresh: FRESH2 })
    await run(SK, bot)
    const before = rows.length
    const r = await run(SK, bot)
    assert.equal(r.status, 'success', JSON.stringify(r).slice(0, 220))
    assert.deepEqual(taken, ['sand', 'sand'])
    assert.equal(rows.length, before, 'visit 2 asked the cells nothing: they were skipped')
  } finally { untap() }
})
await ta('a refused cell whose cause is gone (the water drained) is offered again: the record is dropped, the cell taken', async () => {
  const w = world({ shore: SHORE, fresh: [] })
  await run(SK, w.bot)
  const drained = world({ shore: [], fresh: SHORE })   // the same cells, no water
  GR.memoryOf(drained.bot).clear(); for (const [k, v] of GR.memoryOf(w.bot)) GR.memoryOf(drained.bot).set(k, v)
  const r = await run(SK, drained.bot)
  assert.equal(r.status, 'success', JSON.stringify(r).slice(0, 200))
  assert.equal(drained.taken.length, 1)
})
await ta('HEAD: TTL expiry -- after the TTL the cells are asked again (noted again), not hidden', async () => {
  const { rows, untap } = rowsOf('_gather_refused')
  try {
    const w = world({ shore: SHORE, fresh: [] })
    await run(SK, w.bot)
    const n1 = rows.filter(r => /op=note/.test(r)).length
    for (const r of GR.memoryOf(w.bot).values()) r.until = Date.now() - 1
    await run(SK, w.bot)
    assert.ok(rows.filter(r => /op=note/.test(r)).length > n1, 'the expired cells were asked again and remembered again (the bot walked out in visit 1, so the count differs)')
    assert.equal(w.bot.digAt.length, 0)
  } finally { untap() }
})

await ta('CHAIN (a): every sand cell in range remembered -> ONE walk out (the step, away from the town) -> sand there taken; one gather_walk row', async () => {
  const { rows, untap } = rowsOf('_gather_walk')
  try {
    const w = world({ shore: SHORE, fresh: [[-40, 30, 0]] })   // beyond the 32 from the start, in range from the step's point
    const r = await run(SK, w.bot)
    assert.equal(r.status, 'success', JSON.stringify(r).slice(0, 240))
    assert.equal(w.bot.walks.length, 1, `one walk: ${JSON.stringify(w.bot.walks)}`)
    assert.deepEqual(w.taken, ['sand'])
    assert.ok(w.bot.digAt.every(([x]) => x === -40), `the shore was never dug: ${JSON.stringify(w.bot.digAt)}`)
    assert.match(rows.join('|'), /^success via=step block=sand /)
  } finally { untap() }
})
await ta('CHAIN (b): remembered, the walk finds nothing -> a refusal that names a goto point and the classes, no dig, the walk made once', async () => {
  const { rows, untap } = rowsOf('_gather_refused')
  try {
    const w = world({ shore: SHORE, fresh: [] })
    const r = await run(SK, w.bot)
    assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'no_safe_target')
    assert.match(r.detail, /^goto x=(-?\d+) z=(-?\d+) \(25\+ blocks away\) and gather sand there -- all \d+ sand within 32 blocks refused this bot before \(liquid:40\).*walked out 1 time/, r.detail)
    assert.equal(w.bot.digAt.length, 0, 'never dug a remembered cell'); assert.equal(w.bot.walks.length, 1)
    assert.match(rows.join('|'), /refused op=refused block=sand skipped=\d+ found=0 classes=liquid:40/)
  } finally { untap() }
})
await ta('CHAIN (c): a walk that cannot reach (noPath) -> the refusal, no dig, no second walk', async () => {
  const w = world({ shore: SHORE, fresh: [[-40, 30, 0]], walkTo: 'noPath' })
  const r = await run(SK, w.bot)
  assert.equal(r.failClass, 'no_safe_target'); assert.match(r.detail, /^goto x=/); assert.equal(w.bot.digAt.length, 0)
})
await ta('NO_STAND (the 63 spruce failures): every candidate refused -> recorded at once; the next visit walks out to the atlas find and takes a tree there', async () => {
  const LOGS = [[3, 30, 0], [4, 30, 0]]
  const w = world({ logs: [...LOGS, [0, 30, 60], [0, 31, 60]], badDig: LOGS, finds: [{ kind: 'spruce_log', cat: 'wood', x: 0, y: 30, z: 60, last: 1, n: 1, by: ['b'] }] })
  w.bot.entity.position = new Vec3(0.5, 30, 0.5)
  // the fresh trees are out of range (60) from the start: only the two stumps are in the search
  const r1 = await run(SK, w.bot, 'spruce_log')
  assert.match(r1.detail, /^spruce_log: all 2 candidate\(s\) in range refused — could not stand within reach of any of them -- they are remembered and skipped next time: goto x=-?\d+ z=-?\d+ and gather spruce_log there/)
  assert.equal(GR.standing(GR.memoryOf(w.bot), 'spruce_log').classes.no_stand, 2)
  const digs1 = w.bot.digAt.length
  const r2 = await run(SK, w.bot, 'spruce_log')
  assert.equal(r2.status, 'success', JSON.stringify(r2).slice(0, 240))
  assert.deepEqual(w.bot.walks, [[0, 60]], 'the walk-out went to the known find')
  assert.ok(w.bot.digAt.slice(digs1).every(([x, , z]) => x === 0 && z === 60), `the stumps were not dug again: ${JSON.stringify(w.bot.digAt.slice(digs1))}`)
})
await ta('NO_STAND at the barren limit (3 attempts, "unreachable after 3 attempts"): the three are recorded; the next visit does not dig them', async () => {
  const LOGS = [[3, 30, 0], [4, 30, 0], [3, 30, 1]]
  const w = world({ logs: [...LOGS, [0, 30, 60], [0, 31, 60]], badDig: LOGS, finds: [{ kind: 'spruce_log', cat: 'wood', x: 0, y: 30, z: 60, last: 1, n: 1, by: ['b'] }] })
  const r1 = await run(SK, w.bot, 'spruce_log')
  assert.match(r1.detail, /unreachable after 3 attempts/)
  assert.equal(GR.standing(GR.memoryOf(w.bot), 'spruce_log').classes.no_stand, 3)
  const digs1 = w.bot.digAt.length
  const r2 = await run(SK, w.bot, 'spruce_log')
  assert.equal(r2.status, 'success', JSON.stringify(r2).slice(0, 240))
  assert.ok(w.bot.digAt.slice(digs1).every(([x, , z]) => x === 0 && z === 60))
})
await ta('NO_STAND without the memory (base): the next visit digs the same three stumps again', async () => {
  await noMemory(async S => {
    const LOGS = [[3, 30, 0], [4, 30, 0], [3, 30, 1]]
    const w = world({ logs: LOGS, badDig: LOGS })
    await run(S, w.bot, 'spruce_log'); const n1 = w.bot.digAt.length
    await run(S, w.bot, 'spruce_log')
    assert.equal(w.bot.digAt.length, 2 * n1, 'the same spots, tried again')
  })
})
await ta('BURIED ore is NOT remembered (the tunnel is its remedy); buried DIRT is', async () => {
  // a log-free fixture: sand cells walled in by stone on every face are buried
  for (const [block, remembered] of [['sand', true], ['iron_ore', false]]) {
    const cells = [[3, 30, 0], [4, 30, 0]]
    const w = world({ fresh: [] })
    const kind = block
    const blk0 = w.bot.blockAt
    const solid = new Set(); for (const [x, y, z] of cells) for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) solid.add(key(x + dx, y + dy, z + dz))
    const cellSet = new Set(cells.map(c => key(...c)))
    w.bot.blockAt = p => { const b = blk0(p); const k = key(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); if (cellSet.has(k)) { const t = MC.blocksByName[kind]; return { ...b, name: kind, type: t.id, boundingBox: 'block' } } if (solid.has(k)) { const t = MC.blocksByName.stone; return { ...b, name: 'stone', type: t.id, boundingBox: 'block' } } return b }
    w.bot.findBlocks = ({ matching, maxDistance = 16, count = 1 }) => cells.map(c => w.bot.blockAt(P(...c))).filter(b => matching(b)).map(b => b.position).slice(0, count)
    await run(SK, w.bot, block)
    assert.equal(GR.standing(GR.memoryOf(w.bot), kind).classes.buried ?? 0, remembered ? 2 : 0, `${block}: ${JSON.stringify(GR.standing(GR.memoryOf(w.bot), kind))}`)
  }
})

// ---------------------------------------------------------------- 4. anchored mutants
await ta('MUTANT KILLED (1): the enumeration does not ask the memory -> visit 2 refuses the same 32 (the base)', async () => {
  const { bot } = world({ shore: SHORE, fresh: FRESH })
  await withMutant(SK_URL, 'isRefused(refMem, { kind: b.name, pos: b.position, still: cls => refStill(cls, b.position, b) })', 'false', async S => {
    await run(S, bot); const r = await run(S, bot)
    assert.match(r.detail, /beside water/); assert.equal(bot.digAt.length, 0)
  })
})
await ta('MUTANT KILLED (2): the walk-out does not count the memory (`refused` dropped) -> no walk, the refusal, the other sand never reached', async () => {
  await withMutant(SK_URL, 'cave: caveNow.length, refused: refSkippedNow, collected, walked: builtWalked }', 'cave: caveNow.length, collected, walked: builtWalked }', async S => {
    const w = world({ shore: SHORE, fresh: [[40, 30, 0]] })
    await run(S, w.bot); const r = await run(S, w.bot)
    assert.deepEqual(w.bot.walks, []); assert.equal(w.taken.length, 0); assert.equal(r.status, 'failed')
  })
})
await ta('MUTANT KILLED (3): the refusal branch removed -> a remembered-empty search ends as the base\'s nothing_found (no goto remedy)', async () => {
  await withMutant(SK_URL, "if (refusalDue({ positions: positions.length, refused: refSkippedNow, collected }) && !caveNow.length) {", 'if (false) {', async S => {
    const w = world({ shore: SHORE, fresh: [] })
    await run(S, w.bot); const r = await run(S, w.bot)
    assert.doesNotMatch(r.detail, /^goto x=.*refused this bot before/)
  })
})
await ta('MUTANT KILLED (4): the veto cells are not recorded -> visit 2 is visit 1', async () => {
  await withMutant(SK_URL, 'if (cls && b && noteRefusal(refMem, { kind: b.name, pos: q, cls })) noted++', 'if (cls && b) noted++', async S => {
    const w = world({ shore: SHORE, fresh: FRESH })
    await run(S, w.bot); const r = await run(S, w.bot)
    assert.match(r.detail, /beside water/)
  })
})
await ta('MUTANT KILLED (5): the all-refused ending records nothing (strong dropped) -> the next visit digs the stumps again', async () => {
  await withMutant(SK_URL, "noteRefusal(refMem, { kind: name, pos: b.position, cls: 'no_stand', strong: true })", 'void 0', async S => {
    const LOGS = [[3, 30, 0], [4, 30, 0], [3, 30, 1]]
    // a single failed visit leaves one weak strike per cell only when the catch records one: with it dropped too, nothing stands
    const w = world({ logs: LOGS, badDig: LOGS })
    await run(S, w.bot, 'spruce_log')
    const standingNow = GR.standing(GR.memoryOf(w.bot), 'spruce_log').n
    assert.equal(standingNow, 0, 'a weak strike is not a record: the strong ending was the one that stood')
  })
})
await ta('MUTANT KILLED (6): TTL never expires -> the expired record still refuses', async () => {
  await withMutant(GR_URL, 'if (r.until <= now) { mem.delete(k); return null }', '', async M => {
    const m = M.newMemory(); M.noteRefusal(m, { kind: 'sand', pos: P(1, 30, 1), cls: 'liquid', now: 0 })
    assert.equal(M.isRefused(m, { kind: 'sand', pos: P(1, 30, 1), now: 3 * H }), 'liquid')   // the mutant refuses past the TTL: the real one does not
  })
  const m = GR.newMemory(); GR.noteRefusal(m, { kind: 'sand', pos: P(1, 30, 1), cls: 'liquid', now: 0 })
  assert.equal(GR.isRefused(m, { kind: 'sand', pos: P(1, 30, 1), now: 3 * H }), null)
})
await ta('MUTANT KILLED (7): the live re-ask removed -> a drained cell stays refused', async () => {
  await withMutant(GR_URL, 'if (!keep) { mem.delete(k); return null }', '', async M => {
    const m = M.newMemory(); M.noteRefusal(m, { kind: 'sand', pos: P(1, 30, 1), cls: 'liquid', now: 0 })
    assert.equal(M.isRefused(m, { kind: 'sand', pos: P(1, 30, 1), now: 1, still: () => false }), 'liquid')
  })
})
await ta('MUTANT KILLED (8): the strikes ignored -> one weak no_stand failure already hides a cell', async () => {
  await withMutant(GR_URL, 'if (r.n < (NEED[r.cls] ?? 1)) return null', '', async M => {
    const m = M.newMemory(); M.noteRefusal(m, { kind: 'spruce_log', pos: P(1, 30, 1), cls: 'no_stand', now: 0 })
    assert.equal(M.isRefused(m, { kind: 'spruce_log', pos: P(1, 30, 1), now: 1 }), 'no_stand')
  })
})

await ta('Codex r1 BLOCKER 1: one memory per dimension -- an Overworld refusal never skips the Nether\'s same cell; the Overworld keeps its own', () => {
  const bot = { game: { dimension: 'overworld' } }
  GR.noteRefusal(GR.memoryOf(bot), { kind: 'gravel', pos: { x: 5, y: 40, z: 5 }, cls: 'liquid', now: 1000, strong: true })
  assert.ok(GR.isRefused(GR.memoryOf(bot), { kind: 'gravel', pos: { x: 5, y: 40, z: 5 }, now: 2000 }), 'POSITIVE CONTROL: refused in its own dimension')
  bot.game.dimension = 'minecraft:the_nether'
  assert.ok(!GR.isRefused(GR.memoryOf(bot), { kind: 'gravel', pos: { x: 5, y: 40, z: 5 }, now: 2000 }), 'the Nether: never refused by the Overworld')
  bot.game.dimension = 'overworld'
  assert.ok(GR.isRefused(GR.memoryOf(bot), { kind: 'gravel', pos: { x: 5, y: 40, z: 5 }, now: 2000 }), 'back home: its memory kept')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
