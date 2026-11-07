// gathermem-01: a bot remembers the gather targets that just failed it and the places a gather just found nothing takeable.
//
// Behaviour: the pure rules (gathermem.mjs); the REAL gather skill over a small fake world (the keepout harness): the second
// run tries the cell it has not yet failed, an interruption writes nothing, every candidate remembered -> the run ends
// without walking and the area entry is written; the REAL AdmissionControl refuses that (gather, block) there with a remedy
// and admits the remedy (mine, another block, the same block elsewhere, after expiry); the observation line; anchored mutants
// (each anchor present and unique; each mutant imported under a unique URL).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-gathermem'
process.env.BOT_NAME = process.env.BOT_NAME || 'MemBot'
process.env.LOG_LEVEL = 'error'
delete process.env.GATHERMEM

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const GM = await import('../src/gathermem.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { gatherAreaLine } = await import('../src/prompt.mjs')
const SRC = new URL('../src/', import.meta.url)

async function withMutant (file, pairs, fn) {
  let src = readFileSync(new URL(file, SRC), 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 80))}`)
    assert.equal(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 80))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-gathermem-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}
const withEnv = async (v, fn) => {
  const was = process.env.GATHERMEM
  if (v == null) delete process.env.GATHERMEM; else process.env.GATHERMEM = v
  try { return await fn() } finally { if (was == null) delete process.env.GATHERMEM; else process.env.GATHERMEM = was }
}

// ---- the pure rules -------------------------------------------------------------------------------------------------
const T = 1_000_000
const here = { x: 400.5, y: 64, z: 200.5 }
test('TARGETS: a failed cell is remembered from about here for 6 min; moving 8+ blocks, expiry or a success forget it', () => {
  let m = GM.noteTargetFailure([], { block: 'iron_ore', cell: { x: 405, y: 60, z: 200 }, from: here, why: 'threw', now: T })
  assert.ok(GM.rememberedTarget(m, { block: 'iron_ore', cell: { x: 405.4, y: 60.2, z: 200.9 }, pos: here, now: T + 1 }), 'cells are floored')
  assert.equal(GM.rememberedTarget(m, { block: 'coal_ore', cell: { x: 405, y: 60, z: 200 }, pos: here, now: T + 1 }), null, 'another block')
  assert.equal(GM.rememberedTarget(m, { block: 'iron_ore', cell: { x: 406, y: 60, z: 200 }, pos: here, now: T + 1 }), null, 'another cell')
  assert.ok(GM.rememberedTarget(m, { block: 'iron_ore', cell: { x: 405, y: 60, z: 200 }, pos: { ...here, x: here.x + 7.9 }, now: T + 1 }), '7.9 blocks away: still')
  assert.equal(GM.rememberedTarget(m, { block: 'iron_ore', cell: { x: 405, y: 60, z: 200 }, pos: { ...here, x: here.x + 8.1 }, now: T + 1 }), null, 'moved 8+: forgotten')
  assert.equal(GM.rememberedTarget(m, { block: 'iron_ore', cell: { x: 405, y: 60, z: 200 }, pos: here, now: T + GM.TARGET_TTL_MS }), null, 'expired')
  m = GM.clearTarget(m, { block: 'iron_ore', cell: { x: 405, y: 60, z: 200 }, now: T + 2 })
  assert.equal(m.length, 0, 'a success forgets it')
  let big = []
  for (let i = 0; i < 300; i++) big = GM.noteTargetFailure(big, { block: 'dirt', cell: { x: i, y: 60, z: 0 }, from: here, now: T })
  assert.equal(big.length, GM.TARGET_CAP, 'bounded')
  assert.equal(GM.noteTargetFailure(m, { block: 'dirt', cell: { x: 1, y: 2, z: 3 }, from: here, now: T }).length, 1)
  assert.equal(GM.noteTargetFailure(GM.noteTargetFailure([], { block: 'dirt', cell: { x: 1, y: 2, z: 3 }, from: here, now: T }), { block: 'dirt', cell: { x: 1, y: 2, z: 3 }, from: here, now: T + 5 }).length, 1, 'a repeat replaces')
})
test('RANK, NEVER DROP: fresh first in the given order, remembered after them; allRemembered only on a first, empty round', () => {
  const r = GM.rankByMemory(['a', 'b', 'c', 'd'], q => q === 'a' || q === 'c')
  assert.deepEqual(r, { list: ['b', 'd', 'a', 'c'], fresh: 2, remembered: 2 })
  assert.equal(GM.allRemembered({ fresh: 0, remembered: 3, collected: 0, rounds: 1 }), true)
  assert.equal(GM.allRemembered({ fresh: 1, remembered: 3, collected: 0, rounds: 1 }), false, 'a fresh one is tried')
  assert.equal(GM.allRemembered({ fresh: 0, remembered: 3, collected: 2, rounds: 1 }), false, 'something collected')
  assert.equal(GM.allRemembered({ fresh: 0, remembered: 3, collected: 0, rounds: 2 }), false, 'a later round tries them (bounded by the run)')
  assert.equal(GM.allRemembered({ fresh: 0, remembered: 0, collected: 0, rounds: 1 }), false, 'an empty scan is the scan\'s answer, not this')
})
test('AREAS: only facts about HERE write one; 16 blocks, 4 min; the remedy names mine for an ore', () => {
  for (const fc of ['no_path', 'interrupted', 'inventory_full', 'collect_budget', 'keepout', undefined, null])
    assert.equal(GM.noteAreaRefusal([], { block: 'iron_ore', pos: here, failClass: fc, now: T }).length, 0, String(fc))
  for (const fc of ['no_safe_target', 'unreachable', 'nothing_found', 'remembered'])
    assert.equal(GM.noteAreaRefusal([], { block: 'iron_ore', pos: here, failClass: fc, now: T }).length, 1, fc)
  const a = GM.noteAreaRefusal([], { block: 'iron_ore', pos: here, failClass: 'unreachable', now: T })
  assert.ok(GM.areaRefusal(a, { block: 'iron_ore', pos: { ...here, z: here.z + 15.9 }, now: T + 1 }))
  assert.equal(GM.areaRefusal(a, { block: 'iron_ore', pos: { ...here, z: here.z + 16.1 }, now: T + 1 }), null, 'walked away')
  assert.equal(GM.areaRefusal(a, { block: 'coal_ore', pos: here, now: T + 1 }), null, 'another block')
  assert.equal(GM.areaRefusal(a, { block: 'iron_ore', pos: here, now: T + GM.AREA_TTL_MS }), null, 'expired: tried again')
  assert.match(GM.areaRemedy('deepslate_iron_ore'), /^use mine/)
  assert.doesNotMatch(GM.areaRemedy('oak_log'), /mine/)
  assert.match(GM.areaRefusalDetail(a[0], T + 30_000), /found nothing it could take here 30s ago .*use mine.*\(210s left\)/)
  assert.equal(GM.noteAreaRefusal(a, { block: 'iron_ore', pos: here, failClass: 'no_safe_target', now: T + 9 }).length, 1, 'a repeat replaces')
  assert.equal(GM.gatherMemOn({}), true); assert.equal(GM.gatherMemOn({ GATHERMEM: '0' }), false)
})

// ---- the REAL gather over a fake world (keepout.test.mjs's harness, plus cells whose dig fails) ------------------------
function gatherWorld ({ dirt, bad = [], at = [400.5, 64, 200.5] }) {
  const D = mcData.blocksByName.dirt, AIRT = mcData.blocksByName.air
  const set = new Set(dirt.map(([x, y, z]) => `${x},${y},${z}`))
  const badSet = new Set(bad.map(([x, y, z]) => `${x},${y},${z}`))
  const rock = new Set(dirt.map(([x, y, z]) => `${x},${y - 1},${z}`))
  const digs = [], tried = [], bag = []   // a dug cell drops into the bag (the pickup the fake does not model)
  const blk = (x, y, z) => {
    const isDirt = set.has(`${x},${y},${z}`)
    const isRock = !isDirt && rock.has(`${x},${y},${z}`)
    const t = isDirt ? D : isRock ? mcData.blocksByName.stone : AIRT
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: (isDirt || isRock) ? 'block' : 'empty', diggable: isDirt,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/shovel', hardness: isDirt ? 0.5 : 0 }
  }
  let abortOn = null
  const bot = {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => bag, emptySlotCount: () => 30 },
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && (Array.isArray(matching) ? matching.includes(b.type) : b.type === matching))
      if (!fn({ type: D.id, name: 'dirt' })) return []
      return dirt.map(([x, y, z]) => blk(x, y, z)).filter(b => set.has(`${b.position.x},${b.position.y},${b.position.z}`) && b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, async goto () {} },
    nearestEntity: () => null, entities: {},
    async dig (b) {
      const k = `${b.position.x},${b.position.y},${b.position.z}`
      tried.push(k)
      if (abortOn) { const e = new Error('aborted by the reflex'); e.aborted = true; abortOn = null; throw e }
      if (badSet.has(k)) throw new Error('Digging aborted: no line of sight')
      digs.push(k); set.delete(k); bag.push({ name: 'dirt', count: 1, slot: 9 + bag.length })
    },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
    fireSitesNow: () => [],
  }
  return { bot, digs, tried, abortNext: () => { abortOn = true } }
}
const NEAR = [[402, 63, 200], [403, 63, 200], [403, 63, 201]]    // the three nearest: every dig of them fails
const FAR = [[410, 63, 200]]                                       // one more, further, that would yield
const run = (bot, sk = SKILLS) => sk.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', aborted: !!e.aborted, detail: e.message }))

test('CHAIN (the measured repeat): run 1 fails on the nearest cells; run 2 from the same spot tries the one it has not failed and takes it', async () => {
  const { bot, digs, tried } = gatherWorld({ dirt: [...NEAR, ...FAR], bad: NEAR })
  const r1 = await run(bot)
  assert.notEqual(r1.status, 'success', `run 1 fails on the bad cells: ${JSON.stringify(r1).slice(0, 200)}`)
  assert.ok((bot.gatherTargets ?? []).length >= 3, `the failed cells are remembered: ${JSON.stringify(bot.gatherTargets)}`)
  const before = tried.length
  const r2 = await run(bot)
  assert.equal(r2.status, 'success', JSON.stringify(r2).slice(0, 200))
  assert.equal(tried[before], '410,63,200', `run 2's FIRST dig is the fresh cell: ${tried.slice(before)}`)
  assert.deepEqual(digs, ['410,63,200'])
  // the control: GATHERMEM=0 walks the same failing cells first again
  const c = gatherWorld({ dirt: [...NEAR, ...FAR], bad: NEAR })
  await withEnv('0', async () => {
    await run(c.bot); const b2 = c.tried.length; await run(c.bot)
    assert.notEqual(c.tried[b2], '410,63,200', `the control re-tries a failed cell first: ${c.tried.slice(b2)}`)
    assert.equal(c.bot.gatherTargets ?? null, null, 'and remembers nothing')
  })
})

test('CHAIN (all remembered -> a different job, never a stall): no walk, unreachable, the area written; admission refuses it here with the remedy and admits the remedy', async () => {
  const { bot, tried } = gatherWorld({ dirt: NEAR, bad: NEAR })
  await run(bot)
  const before = tried.length
  const r = await run(bot)
  assert.equal(tried.length, before, 'run 2 digs nothing: every candidate just failed it')
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'unreachable'); assert.equal(r.memoClass, 'remembered')
  assert.match(r.detail, /failed you in the last few minutes/)
  assert.equal(bot.gatherAreas?.length, 1, 'the area entry is written')
  const gate = new AdmissionControl(null)
  const g = gate.check({ skill: 'gather', args: { block: 'dirt', count: 4 } }, bot)
  assert.equal(g.ok, false); assert.equal(g.reason, 'gather_area')
  assert.match(g.detail, /gather another block, or walk 16\+ blocks/)
  assert.equal(gate.memoryRefuses('gather', { block: 'dirt', count: 4 }), 'gather_area', 'no order is issued into it either')
  // the remedies are admitted from where it stands
  assert.notEqual(gate.check({ skill: 'gather', args: { block: 'oak_log', count: 4 } }, bot).reason, 'gather_area', 'another block')
  assert.notEqual(gate.check({ skill: 'explore', args: {} }, bot).reason, 'gather_area', 'explore (walk away)')
  bot.entity.position = new Vec3(430.5, 64, 200.5)
  assert.notEqual(gate.check({ skill: 'gather', args: { block: 'dirt', count: 4 } }, bot).reason, 'gather_area', 'the same block 30 blocks away')
  bot.entity.position = new Vec3(400.5, 64, 200.5)
  bot.gatherAreas = bot.gatherAreas.map(e => ({ ...e, until: Date.now() - 1 }))
  assert.notEqual(gate.check({ skill: 'gather', args: { block: 'dirt', count: 4 } }, bot).reason, 'gather_area', 'after expiry it is tried again')
})

test('AN INTERRUPTION IS NEVER REMEMBERED: a reflex abort mid-dig writes no target and no area', async () => {
  const { bot, abortNext } = gatherWorld({ dirt: [...NEAR, ...FAR] })
  abortNext()
  const r = await run(bot)
  assert.equal(r.aborted, true, JSON.stringify(r))
  assert.equal((bot.gatherTargets ?? []).length, 0)
  assert.equal((bot.gatherAreas ?? []).length, 0)
})

test('OBSERVATION: the refused gathers are named before the decision, with the remedy; nothing when none or off', async () => {
  const bot = { entity: { position: new Vec3(400.5, 64, 200.5) }, gatherAreas: GM.noteAreaRefusal([], { block: 'iron_ore', pos: here, failClass: 'unreachable' }) }
  assert.match(gatherAreaLine(bot), /^GATHER REFUSED HERE \(for a few minutes\): iron_ore -- use mine/)
  assert.equal(gatherAreaLine({ ...bot, entity: { position: new Vec3(440.5, 64, 200.5) } }), '', 'away from it')
  await withEnv('0', () => assert.equal(gatherAreaLine(bot), ''))
  assert.equal(gatherAreaLine({ entity: bot.entity }), '')
})

test('MUTANT: gather does not rank by memory -> run 2 walks a failed cell first', async () => {
  await withMutant('skills.mjs', [['        reachable = ranked.list\n', '']], async (M) => {
    const { bot, tried } = gatherWorld({ dirt: [...NEAR, ...FAR], bad: NEAR })
    await run(bot, M.SKILLS); const b = tried.length; await run(bot, M.SKILLS)
    assert.notEqual(tried[b], '410,63,200', 'the CHAIN test kills this mutant')
  })
})
test('MUTANT: a failed target is not remembered -> run 2 walks a failed cell first', async () => {
  // both writes go (a failed dig both throws and leaves the round barren, so either alone still remembers the cell)
  await withMutant('skills.mjs', [["      noteFailed('barren')   // gathermem-01: ...nor first, on the next run from about here\n", ''],
                                  ["      noteFailed('threw')   // gathermem-01 (an abort rethrew above: an interruption is never remembered)\n", '']], async (M) => {
    const { bot, tried } = gatherWorld({ dirt: [...NEAR, ...FAR], bad: NEAR })
    await run(bot, M.SKILLS); const b = tried.length; await run(bot, M.SKILLS)
    assert.notEqual(tried[b], '410,63,200', 'the CHAIN test kills this mutant')
  })
})
test('MUTANT: admission ignores the area -> the repeat is admitted', async () => {
  await withMutant('admission.mjs', [["      if (hit) return { ok: false, reason: 'gather_area', detail: areaRefusalDetail(hit) }\n", '']], async (M) => {
    const { bot } = gatherWorld({ dirt: NEAR, bad: NEAR })
    await run(bot); await run(bot)
    assert.notEqual(new M.AdmissionControl(null).check({ skill: 'gather', args: { block: 'dirt', count: 4 } }, bot).reason, 'gather_area', 'the CHAIN test kills this mutant')
  })
})
test('MUTANT: interruptions written as areas -> the AREAS test sees one', async () => {
  await withMutant('gathermem.mjs', [["new Set(['no_safe_target', 'unreachable', 'nothing_found'])", "new Set(['no_safe_target', 'unreachable', 'nothing_found', 'interrupted'])"]], async (M) => {
    assert.equal(M.noteAreaRefusal([], { block: 'iron_ore', pos: here, failClass: 'interrupted', now: T }).length, 1, 'the AREAS test kills this mutant')
  })
})
