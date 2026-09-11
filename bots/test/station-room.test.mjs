// A TABLE NEEDS A CELL, NOT HEADROOM.
//
// First fleet-wide hour of the carried-table fix (2026-09-11 03:00-03:49):
// 38 far-table craft refusals; 18 had tried to place the carried table and
// read "no solid block with a free space above it -- no_support=2
// blocked_above=22 [stone,cobblestone...]": a bot in a one-wide mine tunnel,
// rock on every side, a pickaxe in its hand. 20 more carried no table but did
// carry wood. Both remedies are executable from where the bot stands.
import assert from 'node:assert'
import { Vec3 } from 'vec3'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { SKILLS, STATION_ITEMS, roomVeto } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const V = (x, y, z) => new Vec3(x, y, z)
const sig = () => new AbortController().signal

// A one-wide tunnel along x at y=12: stone everywhere except the bot's own
// column (feet at 12, head at 13). `liquidAt` puts water beside one side cell.
function tunnelBot ({ item, liquidAt = null, sandAbove = null, held = { name: 'stone_pickaxe', type: 9 } }) {
  const world = new Map()
  const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
  const set = (x, y, z, name) => world.set(`${x},${y},${z}`, name)
  for (let x = -3; x <= 3; x++) for (let y = 9; y <= 15; y++) for (let z = -3; z <= 3; z++) set(x, y, z, 'stone')
  set(0, 12, 0, 'air'); set(0, 13, 0, 'air')
  if (liquidAt) set(...liquidAt, 'water')
  if (sandAbove) set(...sandAbove, 'sand')
  const seen = { dug: [], placed: [] }
  const blockAt = p => {
    const n = world.get(key(p)) ?? 'air'
    return { name: n, position: V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), diggable: n !== 'air' && n !== 'water',
             boundingBox: (n === 'air' || n === 'water') ? 'empty' : 'block' }
  }
  const bot = {
    entity: { position: V(0.5, 12, 0.5), onGround: true, velocity: V(0, 0, 0) },
    health: 20, food: 20, version: '1.21.8',
    registry: { blocks: {}, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => [{ name: item, type: 1, count: 1 }, held] },
    heldItem: held,
    blockAt,
    equip: async () => {},
    dig: async b => { seen.dug.push(b.name + '@' + key(b.position)); world.set(key(b.position), 'air') },
    placeBlock: async (ref, face) => {
      const at = ref.position.offset(face.x, face.y, face.z); seen.placed.push(key(at)); world.set(key(at), item)
    },
    setControlState () {}, lookAt: async () => {}, waitForTicks: async () => {},
    pathfinder: { movements: null, setMovements () {}, setGoal () {}, stop () {}, goto: async () => {} },
    on () {}, off () {}, once () {}, removeListener () {}, chat () {},
  }
  return { bot, seen, world }
}

await t('a crafting table in a one-wide tunnel: one cell is dug and the table goes into it', async () => {
  const { bot, seen } = tunnelBot({ item: 'crafting_table' })
  const r = await SKILLS.place.run({ bot }, { item: 'crafting_table' }, sig())
  assert.equal(r.status, 'success', r.detail)
  assert.equal(seen.dug.length, 1, `exactly one cell dug: ${seen.dug}`)
  assert.match(r.detail, /made room by digging stone/)
  assert.equal(seen.placed.length, 1)
})

await t('scaffold never digs for room: dirt in the same tunnel is still no_space', async () => {
  const { bot, seen } = tunnelBot({ item: 'dirt' })
  const r = await SKILLS.place.run({ bot }, { item: 'dirt' }, sig())
  assert.equal(r.failClass, 'no_space', r.detail)
  assert.equal(seen.dug.length, 0)
})

await t('a cell beside water is never dug, the next dry one is', async () => {
  const { bot, seen } = tunnelBot({ item: 'furnace', liquidAt: [2, 12, 0] })   // beside the +x cell (1,12,0)
  const r = await SKILLS.place.run({ bot }, { item: 'furnace' }, sig())
  assert.equal(r.status, 'success', r.detail)
  assert.ok(!seen.dug.some(d => d.includes('@1,12,0')), `the wet side was dug: ${seen.dug}`)
  assert.equal(seen.dug.length, 1)
})

await t('a cell under sand is never dug', async () => {
  const { bot, seen } = tunnelBot({ item: 'chest', sandAbove: [1, 13, 0] })
  await SKILLS.place.run({ bot }, { item: 'chest' }, sig())
  assert.ok(!seen.dug.some(d => d.includes('@1,12,0')), `dug under sand: ${seen.dug}`)
})

await t('a dig that never finishes is cancelled, and no second cell is tried', async () => {
  const { bot, seen } = tunnelBot({ item: 'crafting_table' })
  let stopped = 0
  bot.stopDigging = () => { stopped++ }
  bot.dig = async b => { seen.dug.push(b.name + '@' + b.position); return new Promise(() => {}) }   // the server never answers
  const t0 = Date.now()
  const r = await SKILLS.place.run({ bot }, { item: 'crafting_table' }, sig())
  assert.ok(Date.now() - t0 < 12000, 'bounded by the 8 s dig budget')
  assert.equal(stopped, 1, 'the timed-out dig must be cancelled, or it outlives the skill')
  assert.equal(seen.dug.length, 1, 'ONE excavation per call, not one per wall')
  assert.equal(r.failClass, 'no_space')
})

await t('a cell whose neighbour cannot be read is never dug', async () => {
  const { bot, seen } = tunnelBot({ item: 'crafting_table' })
  const real = bot.blockAt
  bot.blockAt = p => (Math.floor(p.x) === 2 && Math.floor(p.y) === 12 && Math.floor(p.z) === 0) ? null : real(p)   // behind the +x cell: unloaded
  await SKILLS.place.run({ bot }, { item: 'crafting_table' }, sig())
  assert.ok(!seen.dug.some(d => d.includes('@(1, 12, 0)')), `dug toward an unreadable cell: ${seen.dug}`)
  assert.equal(roomVeto(bot, V(1, 12, 0)), 'unknown')
})

await t('explicit coordinates never make room', async () => {
  const { bot, seen } = tunnelBot({ item: 'crafting_table' })
  await SKILLS.place.run({ bot }, { item: 'crafting_table', x: 1, y: 12, z: 0 }, sig())
  assert.equal(seen.dug.length, 0, 'a caller that named a cell gets that cell or a refusal, never a hole somewhere else')
})

await t('roomVeto answers liquid/falling from blockAt when the pathfinder cannot be asked', () => {
  const { bot } = tunnelBot({ item: 'crafting_table', liquidAt: [1, 12, 1] })
  assert.equal(roomVeto(bot, V(1, 12, 0)), 'liquid')
  const dry = tunnelBot({ item: 'crafting_table' }).bot
  assert.equal(roomVeto(dry, V(1, 12, 0)), null)
  assert.ok(STATION_ITEMS.has('crafting_table') && STATION_ITEMS.has('furnace') && !STATION_ITEMS.has('dirt'))
})



// ---------------------------------------------------------- observability ---
// The canary of this change could not be read: the branches left no mark.
import { readFileSync } from 'node:fs'
const CODE = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
await t('craft says on its success line when it made a table from wood, placed the carried one, or made room', async () => {
  assert.match(CODE, /stationDid\.push\('made a crafting_table from wood'\)/)
  assert.match(CODE, /stationDid\.push\(\/made room by digging/)
  assert.match(CODE, /crafted \$\{count\}x \$\{item\}\$\{stationDid\.length \? ` \(\$\{stationDid\.join\('; '\)\}\)` : ''\}/)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
