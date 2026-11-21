// VILLAGESAFE-01SHOW (owner 11-21 "i approve", via the control session). Two S4 trips in 16 h, both from bots inside the taiga
// village (village-taiga-6_1, box x 49..157, z -59..45):
//   03:03:44Z showcase-Delta's maroon_escape cobblestone landed at 105,67,-8, over the baseline dirt_path 105,66,-8 (an S_COVER cell);
//   19:28-19:29Z showcase-Nova, stuck ON the worldgen spruce_trapdoor at 82,73,-5, ran pillar_out (reflex.mjs): its placement's
//     REFERENCE was the block under its feet -- the trapdoor. mineflayer's use-item-on toggled it three times; the update turned the
//     dirt_path 82,72,-5 under it to dirt. The guard gave a reference "mask 0: it changes nothing", and the packet passed the escape.
// The fix (protectzone.mjs): a block that toggles on a click (togglesOnUse) is never used nor a placement's reference inside a
// zone, whatever the purpose or hand -- at the guard (_genericPlace, activateBlock) and at the packet; and the packet itself
// refuses a destination on a baseline cell or a path's cover, whatever route reached it. Behaviour over the REAL cells of both
// incidents; anchored mutants; the refusal chain (another reference, a dig, the walk out still pass).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { Vec3 } from 'vec3'
import { digScoped } from '../src/digtown.mjs'
import { parseZones, withBaseline, parseBaseline, attachProtectZone, ProtectedZoneError, zoneDecision, togglesOnUse, zoneEscapePlace, overFootprint } from '../src/protectzone.mjs'

const V = (x, y, z) => new Vec3(x, y, z)
const PZ_URL = new URL('../src/protectzone.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// the showcase village and the baseline's own cells around both incidents (read from /srv/showcase/trip/zones-baseline.json 11-21)
const VILLAGE = { id: 'village-taiga-6_1', kind: 'village', label: 'the taiga village', box: [49, -64, -59, 157, 90, 45] }
const BASE = { zones: { 'village-taiga-6_1': { box: [49, -64, -59, 157, 90, 45], cells: {
  '105,66,-8': 'minecraft:dirt_path', '82,72,-5': 'minecraft:dirt_path', '82,73,-5': 'minecraft:spruce_trapdoor' } } } }
const Z = withBaseline(parseZones({ version: 1, zones: [VILLAGE] }).zones, parseBaseline(BASE)).zones
const NOVA = V(82.5, 74, -4.3)   // her rows: standing over the trapdoor
const DELTA = V(105.5, 67, -7.5)
const blk = (x, y, z, name) => ({ name, position: V(x, y, z) })

function botAt (feet, { held = 'cobbled_deepslate', mod = null, sneak = false } = {}) {
  const calls = [], sent = [], refusals = []
  const rec = name => async (...a) => { calls.push(name); return `${name}-ok` }
  const world = new Map([['82,73,-5', 'spruce_trapdoor'], ['82,72,-5', 'dirt_path'], ['105,66,-8', 'dirt_path'], ['60,70,0', 'oak_door'], ['82,73,-6', 'stone']])
  const bot = {
    entity: { position: feet }, heldItem: held ? { name: held } : null,
    dig: rec('dig'), _genericPlace: rec('place'), activateBlock: rec('use'), pathfinder: { isMining: () => false, movements: {} },
    blockAt: v => ({ name: world.get(`${v.x},${v.y},${v.z}`) ?? 'air', position: v }),
    getControlState: k => (k === 'sneak' ? sneak : false),
    _client: { write: (n, p) => { sent.push(`${n}@${p?.location ? `${p.location.x},${p.location.y},${p.location.z}` : '-'}`); return true } }
  }
  ;(mod?.attachProtectZone ?? attachProtectZone)(bot, { zones: () => Z, context: () => ({ holder: 'marooned', skill: 'reflex' }), onRefuse: r => refusals.push(r) })
  return { bot, calls, sent, refusals }
}
const survival = fn => digScoped({ purpose: 'survival', by: 'reflex' }, fn)()   // digScoped returns the scoped function

test('togglesOnUse: doors, trapdoors, gates, levers, buttons ... yes; iron doors, stone, chests (their own op), a path no', () => {
  for (const n of ['spruce_trapdoor', 'minecraft:oak_door', 'birch_fence_gate', 'lever', 'stone_button', 'oak_button', 'repeater', 'bell', 'note_block', 'cake', 'white_candle', 'candle_cake', 'composter'])
    assert.equal(togglesOnUse(n), true, n)
  for (const n of ['iron_door', 'iron_trapdoor', 'stone', 'cobblestone', 'dirt_path', 'chest', 'oak_planks', 'spruce_slab', '', null])
    assert.equal(togglesOnUse(n), false, String(n))
})

test('zoneDecision: a toggling block in a zone is never a reference nor used -- every purpose, every hand; outside, as before', () => {
  const tdoor = { x: 82, y: 73, z: -5, name: 'spruce_trapdoor' }
  for (const purpose of ['survival', 'build', null]) {
    const r = zoneDecision({ zones: Z, op: 'place', cell: tdoor, role: 'ref', name: 'spruce_trapdoor', purpose, held: 'cobbled_deepslate', escape: true })
    assert.ok(r?.toggle, `place ref ${purpose}`)
    const u = zoneDecision({ zones: Z, op: 'use', cell: tdoor, name: 'spruce_trapdoor', purpose, held: null })
    assert.ok(u?.toggle, `use, empty hand, ${purpose}`)
  }
  // POSITIVE CONTROLS: the same escape placement with an ordinary reference still passes; a trapdoor OUTSIDE the zone is no matter
  assert.equal(zoneDecision({ zones: Z, op: 'place', cell: { x: 82, y: 73, z: -6 }, role: 'ref', name: 'stone', purpose: 'survival', held: 'cobbled_deepslate', escape: true }), null)
  assert.equal(zoneDecision({ zones: Z, op: 'use', cell: { x: 20, y: 70, z: 0 }, name: 'spruce_trapdoor', purpose: null }), null)
  // and a survival use of an ordinary block with an empty hand, as before
  assert.equal(zoneDecision({ zones: Z, op: 'use', cell: { x: 60, y: 70, z: 1 }, name: 'stone', purpose: 'survival', held: null }), null)
})

test('NOVA (19:28Z): pillar_out\'s placement against the trapdoor under her feet is refused at the guard -- nothing reaches mineflayer', async () => {
  const { bot, calls, refusals } = botAt(NOVA)
  await survival(() => zoneEscapePlace(async () => {
    await assert.rejects(bot._genericPlace(blk(82, 73, -5, 'spruce_trapdoor'), V(0, 1, 0)), e => e instanceof ProtectedZoneError && e.op === 'place')
  }))
  assert.deepEqual(calls, [])
  assert.equal(refusals[0].struct, true)
  assert.equal(refusals[0].purpose, 'survival', 'POSITIVE CONTROL: survival, the escape -- the case the old rule let through')
})

test('NOVA at the PACKET: a block_place AT the trapdoor is never sent, from the escape, with any hand', () => {
  for (const held of ['cobbled_deepslate', null, 'stick']) {
    const { bot, sent } = botAt(NOVA, { held })
    survival(() => zoneEscapePlace(() => bot._client.write('block_place', { location: V(82, 73, -5), direction: 1 })))
    assert.deepEqual(sent, [], `held ${held}`)
  }
  // POSITIVE CONTROLS: an ordinary reference beside it, from the escape, holding stone: sent; outside the zone: sent
  const { bot, sent } = botAt(NOVA)
  survival(() => zoneEscapePlace(() => bot._client.write('block_place', { location: V(82, 73, -6), direction: 1 })))
  bot._client.write('block_place', { location: V(20, 70, 0), direction: 1 })
  bot._client.write('position', { x: 1 })
  assert.deepEqual(sent, ['block_place@82,73,-6', 'block_place@20,70,0', 'position@-'])
})

test('activateBlock on the village door: refused even with an empty hand under the reflex (the old survival-use pass)', async () => {
  const { bot, calls } = botAt(V(60.5, 70, 1.5), { held: null })
  await survival(async () => { await assert.rejects(bot.activateBlock(blk(60, 70, 0, 'oak_door')), e => e instanceof ProtectedZoneError) })
  assert.deepEqual(calls, [])
  // POSITIVE CONTROL: the same empty-hand survival use of an ordinary block still passes
  await survival(() => bot.activateBlock(blk(60, 71, 0, 'stone')))
  assert.deepEqual(calls, ['use'])
})

test('DELTA (03:03Z) at the PACKET: a block onto the path\'s cover 105,67,-8 is never sent, whatever route reached the packet', () => {
  const { bot, sent, refusals } = botAt(DELTA, { held: 'cobblestone' })
  // the reference is the path itself, face up: the destination is the S_COVER cell
  survival(() => zoneEscapePlace(() => bot._client.write('block_place', { location: V(105, 66, -8), direction: 1 })))
  assert.deepEqual(sent, [])
  assert.equal(refusals[0]?.struct, true)
  // POSITIVE CONTROL: the escape's same block one cell aside, on no baseline cell, is sent (the walk-out's bridge keeps working)
  survival(() => zoneEscapePlace(() => bot._client.write('block_place', { location: V(107, 66, -8), direction: 1 })))
  assert.deepEqual(sent, ['block_place@107,66,-8'])
})

test('THE CHAIN DOES NOT DEAD-END: at Nova\'s spot the escape keeps a dig, another reference, and a walk-out that leaves the zone', async () => {
  const { bot, calls } = botAt(NOVA)
  let remedy = ''
  await survival(() => zoneEscapePlace(async () => {
    await bot._genericPlace(blk(82, 73, -5, 'spruce_trapdoor'), V(0, 1, 0)).catch(e => { remedy = e.message })
    await bot.dig(blk(83, 75, -5, 'stone'))                                   // the dig up / out: survival, ordinary rock
    await bot._genericPlace(blk(83, 73, -5, 'stone'), V(0, 1, 0))             // another reference beside it
  }))
  assert.deepEqual(calls, ['dig', 'place'])
  const m = /walk out first \(goto (-?\d+) (-?\d+) (-?\d+)/.exec(remedy)
  assert.ok(m, `the refusal names a walk out: ${remedy}`)
  assert.equal(overFootprint(Z[0], { x: +m[1], z: +m[3] }), false, 'the goto ends outside the zone')
})

test('Codex r1: SNEAKING with an empty hand still uses the block -- the packet at the trapdoor is not sent; a DEEP village door is still the village\'s', () => {
  const { bot, sent } = botAt(NOVA, { held: null, sneak: true })
  bot._client.write('block_place', { location: V(82, 73, -5), direction: 1 })
  assert.deepEqual(sent, [], 'sneaking, empty hand: not sent')
  // the deep exemption (feet AND cell under floor_y) opens ordinary cells -- never a toggling block's use
  const ZD = [{ ...Z[0], floorY: 54 }]
  assert.ok(zoneDecision({ zones: ZD, op: 'use', cell: { x: 82, y: 30, z: -5 }, name: 'oak_door', purpose: 'survival', feet: { x: 82.5, y: 30, z: -4.5 }, held: null })?.toggle)
  // POSITIVE CONTROL: the same deep cell, an ordinary block, an empty-hand survival use: the exemption still opens it
  assert.equal(zoneDecision({ zones: ZD, op: 'use', cell: { x: 82, y: 30, z: -5 }, name: 'stone', purpose: 'survival', feet: { x: 82.5, y: 30, z: -4.5 }, held: null }), null)
})

test('MUTANTS (anchored): the toggle rule cut from zoneDecision; the packet\'s toggle check cut; the packet\'s struct check cut', async () => {
  await withMutant(PZ_URL, "  if ((op === 'use' || (op === 'place' && role === 'ref')) && togglesOnUse(name)) {", '  if (false) {', async M => {
    const r = M.zoneDecision({ zones: Z, op: 'place', cell: { x: 82, y: 73, z: -5 }, role: 'ref', name: 'spruce_trapdoor', purpose: 'survival', held: 'cobbled_deepslate', escape: true })
    assert.equal(r, null, 'the mutant lets Nova\'s placement through')
  })
  await withMutant(PZ_URL, "            const tz = togglesOnUse(refName) ? blocked(list, L.x, L.y, L.z, null, true) : null", '            const tz = null', async M => {
    const { bot, sent } = botAt(NOVA, { mod: M })
    survival(() => M.zoneEscapePlace(() => bot._client.write('block_place', { location: V(82, 73, -5), direction: 1 })))
    assert.deepEqual(sent, ['block_place@82,73,-5'], 'the mutant sends the toggle')
  })
  await withMutant(PZ_URL, "            const sz = (sneak || !OPENS.test(refName)) ? structAt(list, dx, dy, dz, PLACE_MASK) : null", '            const sz = null', async M => {
    const { bot, sent } = botAt(DELTA, { held: 'cobblestone', mod: M })
    survival(() => M.zoneEscapePlace(() => bot._client.write('block_place', { location: V(105, 66, -8), direction: 1 })))
    assert.deepEqual(sent, ['block_place@105,66,-8'], 'the mutant sends Delta\'s block')
  })
})
