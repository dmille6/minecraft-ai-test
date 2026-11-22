// wellbucket-01show (b): THE BUCKET FILLS ONLY AT SOURCE WATER A SCAN HAS SEEN.
// Showcase 11-22: 8 of 8 `bucket fill` runs ended "nothing within reach to fill from [not water (air) | not water (crafting_table) ...]":
// the bot stood where there was no water. Behaviour through the real skill with a fake bot (the world is a function of the cell, the
// pathfinder moves the body, a use at a source turns the bucket full), pure decisions through bucket.mjs, and an anchored mutant.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
process.env.LOG_DIR = `/tmp/mcbot-test-logs-wellbucket-${process.pid}`; process.env.BOT_NAME = 'TestBot'
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.11')
const { SKILLS } = await import('../src/skills.mjs')
const B = await import('../src/bucket.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`) } }
const SIG = () => new AbortController().signal

const WID = REG.blocksByName.water.id
const AIRB = { name: 'air', boundingBox: 'empty', metadata: 0 }
const STONE = { name: 'stone', boundingBox: 'block', metadata: 0 }
const TABLE = { name: 'crafting_table', boundingBox: 'block', metadata: 0 }
const SRC = { name: 'water', type: WID, boundingBox: 'empty', metadata: 0 }
const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`

/** A flat stone world at y 69 (feet at 70). `water`: cells holding a SEALED single source (stone beside it, air above: the scoop's rule). */
function fakeBot ({ at = [0.5, 70, 0.5], water = [], table = null } = {}) {
  const src = new Set(water.map(([x, y, z]) => `${x},${y},${z}`)), gone = new Set()
  const events = { goals: [], uses: 0 }
  const cell = v => {
    if (src.has(key(v))) return { ...SRC }
    if (gone.has(key(v))) return AIRB
    if (table && key(v) === table.join(',')) return TABLE
    return v.y <= 69 ? STONE : AIRB
  }
  const items = [{ name: 'bucket', count: 1 }]
  const bot = {
    registry: { blocksByName: REG.blocksByName },
    entity: { position: new Vec3(...at), yaw: 0, pitch: 0 }, entities: {}, version: '1.21.11', game: { minY: -64, height: 384 },
    inventory: { items: () => items.map(i => ({ ...i })), slots: [] },
    blockAt: p => { const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return { ...cell(v), position: v } },
    findBlocks: ({ matching, maxDistance }) => (matching === WID ? [...src].map(k => new Vec3(...k.split(',').map(Number))).filter(v => v.distanceTo(bot.entity.position) <= maxDistance) : []),
    pathfinder: { goto: async goal => { events.goals.push([goal.x, goal.y, goal.z]); bot.entity.position = new Vec3(goal.x, goal.y, goal.z) }, setGoal () {}, goal: null, stop () {} },
    protectZones: () => [], waitForTicks: async () => {}, equip: async () => {}, lookAt: async () => {}, setControlState () {}, clearControlStates () {},
    activateItem: () => {
      events.uses++
      const dx = Math.hypot(bot.entity.position.x - 0, 0)   // only the nearest source is hit
      void dx
      for (const k of [...src]) { const v = new Vec3(...k.split(',').map(Number)); if (v.distanceTo(bot.entity.position) <= B.REACH + 0.6) { src.delete(k); gone.add(k); items[0] = { name: 'water_bucket', count: 1 }; break } }
    },
    deactivateItem () {}, on () {}, removeListener () {}, once () {}, emit () {}, assertNav () {},
  }
  return { bot, events, bag: () => items.map(i => i.name) }
}
const fill = (fb, args = {}) => SKILLS.bucket.run({ bot: fb.bot }, { action: 'fill', ...args }, SIG())

await t('positive control: standing beside a sealed source, the fill takes it with no walk', async () => {
  const fb = fakeBot({ at: [0.5, 70, 0.5], water: [[1, 69, 0]] })
  const r = await fill(fb)
  assert.equal(r.status, 'success', r.detail); assert.deepEqual(fb.bag(), ['water_bucket']); assert.equal(fb.events.goals.length, 0)
})
await t('a dry spot with a source 12 blocks away: the bot walks to the SOURCE (not a dry cell) and fills', async () => {
  const fb = fakeBot({ at: [0.5, 70, 0.5], water: [[12, 69, 0]] })
  const r = await fill(fb)
  assert.equal(r.status, 'success', r.detail); assert.deepEqual(fb.bag(), ['water_bucket'])
  assert.equal(fb.events.goals.length, 1, 'one walk'); assert.deepEqual(fb.events.goals[0].map(Math.floor), [12, 70, 0], 'to the source column, standing at its surface')
})
await t('a dry spot with NO source known: refuses before any walk, names the remedy; positive control above', async () => {
  const fb = fakeBot({ at: [0.5, 70, 0.5], water: [], table: [1, 70, 0] })
  const r = await fill(fb)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'bucket_fill')
  assert.equal(fb.events.goals.length, 0, 'no walk'); assert.match(r.detail, /no scoopable source water within 24/); assert.match(r.detail, /pour a source|walk to a lake/)
  assert.match(r.detail, /not water \(air\)|not water \(crafting_table\)/, 'the reasons still ride')
})
await t('water beyond the scan radius is not known: refused, no walk', async () => {
  const fb = fakeBot({ at: [0.5, 70, 0.5], water: [[40, 69, 0]] })
  const r = await fill(fb)
  assert.equal(r.status, 'failed'); assert.equal(fb.events.goals.length, 0)
})
await t('pickFillSpot: only a cell the scoop itself would take (a source with a sealed pocket), nearest first; flowing, lake-interior and covered cells never', () => {
  const src = { name: 'water', metadata: 0 }, flow = { name: 'water', metadata: 3 }, stone = { name: 'stone', metadata: 0 }, air = { name: 'air', metadata: 0 }
  const cand = (pos, over = {}) => ({ pos, block: src, above: air, cardinals: [stone, stone, stone, stone], ...over })
  const from = { x: 0, y: 70, z: 0 }
  assert.deepEqual(B.pickFillSpot([cand({ x: 9, y: 69, z: 0 }), cand({ x: 5, y: 69, z: 0 })], from).pos, { x: 5, y: 69, z: 0 })
  assert.equal(B.pickFillSpot([cand({ x: 5, y: 69, z: 0 }, { block: flow })], from), null, 'flowing')
  assert.equal(B.pickFillSpot([cand({ x: 5, y: 69, z: 0 }, { cardinals: [src, src, stone, stone] })], from), null, 'refills at once (lake interior)')
  assert.equal(B.pickFillSpot([cand({ x: 5, y: 69, z: 0 }, { above: src })], from), null, 'water overhead')
  assert.equal(B.pickFillSpot([], from), null); assert.equal(B.pickFillSpot(null, from), null)
})
await t('a source just outside a protected zone (within the bucket\'s own 6 + the arrival) is not a walk target: refused, no walk', async () => {
  const zone = { x0: 20, x1: 60, y0: 54, y1: 98, z0: -59, z1: 45 }
  const near = fakeBot({ at: [0.5, 70, 0.5], water: [[16, 69, 0]] })   // 4 west of the zone's edge: the bucket would refuse there
  near.bot.protectZones = () => [zone]
  const r = await fill(near)
  assert.equal(r.status, 'failed'); assert.equal(near.events.goals.length, 0, 'no walk')
  const far = fakeBot({ at: [0.5, 70, 0.5], water: [[8, 69, 0]] })    // 12 clear: positive control
  far.bot.protectZones = () => [zone]
  assert.equal((await fill(far)).status, 'success'); assert.equal(far.events.goals.length, 1)
})
await t('the zone clearance holds on the vertical axis too: a source 10 below a zone\'s floor is refused (the arrival stands up to 4 above it)', async () => {
  const zone = { x0: 20, x1: 60, y0: 79, y1: 120, z0: -59, z1: 45 }
  const free = fakeBot({ at: [20.5, 70, 0.5], water: [[40, 69, 0]] })   // positive control: inside the scan radius, no zone: it walks and fills
  assert.equal((await fill(free)).status, 'success'); assert.equal(free.events.goals.length, 1)
  const fb = fakeBot({ at: [20.5, 70, 0.5], water: [[40, 69, 0]] }); fb.bot.protectZones = () => [zone]
  const r = await fill(fb)
  assert.equal(r.status, 'failed'); assert.equal(fb.events.goals.length, 0, 'no walk')
})
await t('MUTANT: the refusal before walking replaced by a walk to a dry cell: a dry spot with no source walks (the live fault)', async () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  let body = src
  for (const [old, neu] of [
    ['const spot = findFillSpot(', 'const spot = { pos: { x: p.x + 6, y: p.y - 1, z: p.z } } || findFillSpot('],
    ["    if (!spot) {\n      return { status: 'failed', failClass: 'bucket_fill'", "    if (false) {\n      return { status: 'failed', failClass: 'bucket_fill'"]]) {
    assert.equal(body.split(old).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old.slice(0, 40))
    body = body.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body.replace(/from '\.\//g, "from '../src/"))
  try {
    const m = await import(out.href)
    const fb = fakeBot({ at: [0.5, 70, 0.5], water: [], table: [1, 70, 0] })
    await m.SKILLS.bucket.run({ bot: fb.bot }, { action: 'fill' }, SIG())
    assert.ok(fb.events.goals.length > 0, 'mutant inert: it walked to a dry spot')
  } finally { try { unlinkSync(out) } catch {} }
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
