// ZONEPLANT-01SHOW (11-18). The showcase tripwire's S4 BREACH at 15:13:54Z: Alpha, marooned inside village-taiga-6_1 at
// 123,68,-6, had its pillar refused (a baseline cell); then the plant work order, run while the reflex held the body (digPurpose
// answers `survival` for any skill under a holder), placed a spruce_sapling at 121,67,-8. The tree grew; its leaves covered
// the village's dirt_path at 120..122,67,-6 and S4 saw 4 cells removed. Two holes, two fixes:
//   1. plantableSpotNear never offers a cell in a zone's box grown by GROWTH_MARGIN (the canopy's reach).
//   2. the guard refuses EVERY placement in a zone, survival included; a survival `use` passes only with a hand that cannot
//      change the block (bone meal grows, a sapling or a block in hand is placed).
// And the chain: marooned in the zone, sapling in hand -- the place is refused with a walk-out that ends outside the zone, the
// survival DIG the ramp needs still passes, and the planner never offers the spot to begin with.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { Vec3 } from 'vec3'
import { digScoped } from '../src/digtown.mjs'
import { parseZones, attachProtectZone, ProtectedZoneError, zoneDecision, plantNearZone, GROWTH_MARGIN, overFootprint, zoneEscapePlace } from '../src/protectzone.mjs'
import { plantableSpotNear } from '../src/skills.mjs'

const V = (x, y, z) => new Vec3(x, y, z)
const PZ_URL = new URL('../src/protectzone.mjs', import.meta.url)
const SK_URL = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// the showcase village's box (as protectzone.test.mjs); the incident's cells are inside it
const VILLAGE = { id: 'village-taiga-6_1', kind: 'village', label: 'the taiga village', box: [49, 54, -59, 157, 98, 45] }
const Z = parseZones({ version: 1, zones: [VILLAGE] }).zones
const ALPHA = V(123.5, 68, -5.5)
const blk = (x, y, z, name) => ({ name, position: V(x, y, z) })

function maroonedBot ({ held = 'spruce_sapling', zones = Z, mod = null } = {}) {
  const calls = []
  const rec = name => async (...a) => { calls.push(name); return `${name}-ok` }
  const bot = { entity: { position: ALPHA }, heldItem: held ? { name: held } : null,
    dig: rec('dig'), _genericPlace: rec('place'), activateBlock: rec('use'), pathfinder: { isMining: () => false, movements: {} } }
  const refusals = []
  ;(mod?.attachProtectZone ?? attachProtectZone)(bot, { zones: () => zones, context: () => ({ holder: 'marooned', skill: 'place' }), onRefuse: r => refusals.push(r) })
  return { bot, calls, refusals }
}
const plantIt = bot => bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0))

test('THE INCIDENT: a sapling placed under the marooned reflex inside the village is REFUSED, naming a walk out past its side', async () => {
  const { bot, calls, refusals } = maroonedBot()
  await assert.rejects(plantIt(bot), e => {
    assert.ok(e instanceof ProtectedZoneError && e.op === 'place', e.message)
    const m = /walk out first \(goto (-?\d+) (-?\d+) (-?\d+)/.exec(e.message)
    assert.ok(m, `the remedy names a goto: ${e.message}`)
    assert.equal(overFootprint(Z[0], { x: +m[1], z: +m[3] }), false, 'the goto ends outside the zone')
    return true
  })
  assert.deepEqual(calls, [], 'nothing reached mineflayer')
  assert.equal(refusals[0].purpose, 'survival', 'POSITIVE CONTROL: the purpose was survival, as in the incident')
})

test('THE CHAIN DOES NOT DEAD-END: the same marooned bot may still DIG (the ramp, the air) and use a block with an empty hand', async () => {
  const { bot, calls } = maroonedBot()
  assert.equal(await bot.dig(blk(123, 69, -6, 'dirt')), 'dig-ok', 'a survival dig in the zone still passes (not a baseline cell)')
  const empty = maroonedBot({ held: null })
  assert.equal(await empty.bot.activateBlock(blk(123, 68, -7, 'stone')), 'use-ok', 'an empty-handed survival use of an ordinary block passes')
  // VILLAGESAFE-01SHOW (owner 11-21): a door, trapdoor, gate or lever in a zone is never used, empty hand or not (Nova's trapdoor)
  await assert.rejects(empty.bot.activateBlock(blk(123, 68, -7, 'spruce_door')), ProtectedZoneError, 'a door in the zone: refused')
  assert.deepEqual(calls, ['dig'])
})

test('BONE MEAL, SEEDS, A BLOCK: a survival use with any of them in hand inside the zone is refused; outside it passes', async () => {
  for (const held of ['bone_meal', 'wheat_seeds', 'spruce_sapling', 'cobblestone', 'iron_hoe', 'water_bucket']) {
    const { bot } = maroonedBot({ held })
    await assert.rejects(bot.activateBlock(blk(121, 67, -8, 'spruce_sapling')), ProtectedZoneError, held)
    assert.ok(zoneDecision({ zones: Z, op: 'use', cell: { x: 121, y: 67, z: -8 }, purpose: 'survival', held }), held)
  }
  assert.equal(zoneDecision({ zones: Z, op: 'use', cell: { x: 10, y: 67, z: -8 }, purpose: 'survival', held: 'bone_meal' }), null, 'outside: allowed')
  assert.equal(zoneDecision({ zones: Z, op: 'use', cell: { x: 121, y: 67, z: -8 }, purpose: 'survival', held: 'stone_pickaxe' }), null, 'a pickaxe changes nothing')
})

test('AIR FIRST (Claude r1): a DROWNING bot\'s survival air-pocket block in the zone passes; a sapling or seeds never do; dry, refused', async () => {
  const wet = (held, oxygen) => { const m = maroonedBot({ held }); m.bot.oxygenLevel = oxygen; return m }
  assert.equal(await wet('cobblestone', 8).bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0)), 'place-ok', 'short of breath: the air pocket places')
  await assert.rejects(wet('spruce_sapling', 8).bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0)), ProtectedZoneError, 'never a sapling')
  await assert.rejects(wet('wheat_seeds', 8).bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0)), ProtectedZoneError, 'never seeds')
  await assert.rejects(wet('cobblestone', 20).bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0)), ProtectedZoneError, 'full breath, dry: refused')
  const dry = maroonedBot({ held: 'cobblestone' }); dry.bot.oxygenLevel = 20
  dry.bot.blockAt = p => ({ name: p.y >= 68 ? 'water' : 'air', position: p })
  assert.equal(await dry.bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0)), 'place-ok', 'head in water: the air pocket places')
})

// ---- the planner -----------------------------------------------------------------------------------------------------
// a flat grass world at y 66 with air above; the bot stands at feet y 67
function plainsBot (pos, zones) {
  return { entity: { position: pos }, protectZones: () => zones,
    blockAt: p => ({ name: p.y <= 66 ? 'grass_block' : 'air', position: V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: p.y <= 66 ? 'block' : 'empty' }) }
}
test(`PLANNER: no plant spot inside a zone or within GROWTH_MARGIN (${GROWTH_MARGIN}) of it; POSITIVE CONTROL: the same ground offers one with no zone`, () => {
  assert.ok(plantableSpotNear(plainsBot(V(121.5, 67, -7.5), []), 2, 'spruce_sapling'), 'POSITIVE CONTROL: this ground is plantable')
  assert.equal(plantableSpotNear(plainsBot(V(121.5, 67, -7.5), Z), 2, 'spruce_sapling'), null, 'inside the village: none (the incident)')
  // just west of the box (x0 49): 4 blocks out is in the margin, 12 blocks out is not
  assert.equal(plantableSpotNear(plainsBot(V(45.5, 67, 0.5), Z), 2, 'spruce_sapling'), null, 'within the margin: none')
  const far = plantableSpotNear(plainsBot(V(37.5, 67, 0.5), Z), 2, 'spruce_sapling')
  assert.ok(far && far.x < 49 - GROWTH_MARGIN, `beyond the margin: a spot (${JSON.stringify(far)})`)
  assert.ok(GROWTH_MARGIN >= 6, 'the margin covers a 2x2 spruce from its corner and an acacia lean')
  assert.ok(plantNearZone(Z, 49 - GROWTH_MARGIN, 0) && !plantNearZone(Z, 48 - GROWTH_MARGIN, 0), 'the margin is inclusive')
})

// ---- mutants ---------------------------------------------------------------------------------------------------------
test('MUTANT KILLED (protectzone.mjs): `place` back among the survival ops lets the incident\'s sapling through', async () => {
  await withMutant(PZ_URL, "export const SURVIVAL_OPS = new Set(['dig', 'use'])\n", "export const SURVIVAL_OPS = new Set(['dig', 'place', 'use'])\n", async mod => {
    const { bot } = maroonedBot({ mod })
    assert.equal(await plantIt(bot), 'place-ok', 'the mutant places the sapling')
  })
})
test('MUTANT KILLED (protectzone.mjs): no held-item check lets bone meal grow a sapling in the zone', async () => {
  await withMutant(PZ_URL, "(op !== 'use' || useHeldSafe(held))", 'true', async mod => {
    const { bot } = maroonedBot({ mod, held: 'bone_meal' })
    assert.equal(await bot.activateBlock(blk(121, 67, -8, 'spruce_sapling')), 'use-ok', 'the mutant bone-meals it')
  })
})
test('MUTANT KILLED (skills.mjs): without the zone check the planner offers the incident\'s spot', async () => {
  await withMutant(SK_URL, 'if (cell.position && plantNearZone(bot.protectZones?.() ?? [], cell.position.x, cell.position.z)) continue\n', '\n', async mod => {
    assert.ok(mod.plantableSpotNear(plainsBot(V(121.5, 67, -7.5), Z), 2, 'spruce_sapling'), 'the mutant plants in the village')
  })
})
test('MUTANT KILLED (protectzone.mjs): an air exception that ignores what grows lets a drowning bot plant in the zone', async () => {
  await withMutant(PZ_URL, 'export const airPlaceOk = held => !!held && !GROWS.test(bare(held))\n', 'export const airPlaceOk = held => !!held\n', async mod => {
    const { bot } = maroonedBot({ mod }); bot.oxygenLevel = 8
    assert.equal(await plantIt(bot), 'place-ok', 'the mutant plants the sapling')
  })
})
test('THE WALK-OUT\'S BRIDGE (Codex r1): marked by zoneEscapePlace, a survival bridge of ordinary ground passes in the zone; unmarked, refused; a sapling never', async () => {
  const bridge = maroonedBot({ held: 'dirt' })
  assert.equal(await zoneEscapePlace(() => bridge.bot._genericPlace(blk(121, 66, -8, 'dirt'), V(1, 0, 0))), 'place-ok', 'the escape bridges')
  await assert.rejects(maroonedBot({ held: 'dirt' }).bot._genericPlace(blk(121, 66, -8, 'dirt'), V(1, 0, 0)), ProtectedZoneError, 'a skill under the hold: refused')
  await assert.rejects(zoneEscapePlace(() => maroonedBot().bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0))), ProtectedZoneError, 'never a sapling, marked or not')
})
// THE REFLEXES' OWN PLACEMENTS (Codex r1-r3: the walk-out's bridge, the flood plug, the side-exit seal): every escape placement in
// reflex.mjs and airpocket.mjs runs inside zoneEscapePlace. A structural invariant -- a new unmarked one is a dead end in a zone.
const stripC = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l.replace(/(^|\s)\/\/.*$/, '$1'))).join('\n')
const unmarked = src => { const t = stripC(src); const out = []; const re = /bot\.(placeBlock|_placeBlockWithOptions)\(/g; let m
  while ((m = re.exec(t))) if (!t.slice(Math.max(0, m.index - 24), m.index).endsWith('zoneEscapePlace(() => ')) out.push(t.slice(m.index, m.index + 60)); return out }
test('WIRED: every placement in reflex.mjs and airpocket.mjs runs inside zoneEscapePlace (and the check fails on a mutant)', () => {
  for (const f of ['reflex.mjs', 'airpocket.mjs']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
    assert.ok(/bot\.(placeBlock|_placeBlockWithOptions)\(/.test(stripC(src)), `POSITIVE CONTROL: ${f} places`)
    assert.deepEqual(unmarked(src), [], f)
    assert.match(stripC(src), /import \{ zoneEscapePlace \} from '\.\/protectzone\.mjs'/, f)
  }
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  // Claude r4/r5: the escape routines (ladder.mjs, skills.mjs rideFloorDown) run inside the reflex tick, whose scope marks them
  // (reflexTickScope); the tick is the one digScoped survival/reflex interval
  const t = stripC(src)
  assert.equal(t.split("setInterval(digScoped({ purpose: 'survival', by: 'reflex' }, async () => {").length, 2, 'the tick runs in the survival/reflex scope')
  const old = 'zoneEscapePlace(() => bot.placeBlock(under, new Vec3(0, 1, 0)))'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.equal(unmarked(src.replace(old, 'bot.placeBlock(under, new Vec3(0, 1, 0))')).length, 1, 'the mutant (one unmarked pillar) is caught')
})
test('THE PACKET (Codex r4): a block_place at a zone cell is never SENT holding a thing that grows, whatever the guard approved earlier', () => {
  const sent = []
  const bot = { entity: { position: ALPHA }, heldItem: { name: 'dirt' }, _client: { write: (n, p) => { sent.push([n, p?.location]); return true } },
    _genericPlace: async () => 'place-ok', pathfinder: { isMining: () => false, movements: {} } }
  attachProtectZone(bot, { zones: () => Z, context: () => ({ holder: 'marooned', skill: 'place' }) })
  zoneEscapePlace(() => bot._client.write('block_place', { location: V(121, 66, -8), direction: 1 }))   // the escape's dirt: sent
  bot.heldItem = { name: 'spruce_sapling' }   // a skill equipped it in mineflayer's lookAt gap
  zoneEscapePlace(() => bot._client.write('block_place', { location: V(121, 66, -8), direction: 1 }))
  bot._client.write('block_place', { location: V(20, 66, -8), direction: 1 })   // outside: sent
  bot._client.write('position', { x: 1 })   // other packets: untouched
  assert.deepEqual(sent.map(([n, l]) => `${n}${l ? `@${l.x}` : ''}`), ['block_place@121', 'block_place@20', 'position'])
})
test('MUTANT KILLED (protectzone.mjs): without the packet check the sapling equipped in the gap is sent', async () => {
  await withMutant(PZ_URL, '              if (!ok) {\n', '              if (false) {\n', async mod => {
    const sent = []
    const bot = { entity: { position: ALPHA }, heldItem: { name: 'spruce_sapling' }, _client: { write: (n) => { sent.push(n); return true } }, pathfinder: { isMining: () => false, movements: {} } }
    mod.attachProtectZone(bot, { zones: () => Z })
    bot._client.write('block_place', { location: V(121, 66, -8), direction: 1 })
    assert.deepEqual(sent, ['block_place'], 'the mutant sends it')
  })
})
test('THE REFLEX TICK (Claude r5): a placement inside the reflex tick\'s scope is the escape\'s own; the same call from a skill chain is refused', async () => {
  const tick = maroonedBot({ held: 'cobblestone' })
  assert.equal(await digScoped({ purpose: 'survival', by: 'reflex' }, () => tick.bot._genericPlace(blk(121, 66, -8, 'dirt'), V(1, 0, 0)))(), 'place-ok', 'in the tick')
  await assert.rejects(maroonedBot({ held: 'cobblestone' }).bot._genericPlace(blk(121, 66, -8, 'dirt'), V(1, 0, 0)), ProtectedZoneError, 'a skill under the hold')
  await assert.rejects(digScoped({ purpose: 'survival', by: 'reflex' }, () => maroonedBot().bot._genericPlace(blk(121, 66, -8, 'dirt'), V(0, 1, 0)))(), ProtectedZoneError, 'never a sapling, even in the tick')
  for (const f of ['ladder.mjs', 'lavastepmove.mjs']) assert.deepEqual(unmarked(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).filter(x => !x.startsWith('bot._genericPlace(ref, new Vec3(seal') || true).filter(x => /placeBlock|_placeBlockWithOptions/.test(x)), [], f)
})
test('THE PACKET (Codex r5): a survival use judged with a stick is not SENT after the hand swaps to cobblestone, a hoe or a shovel; the stick is', () => {
  for (const swap of ['cobblestone', 'iron_hoe', 'stone_shovel']) {
    const sent = []
    const bot = { entity: { position: ALPHA }, heldItem: { name: 'stick' }, _client: { write: (n) => { sent.push(n); return true } }, pathfinder: { isMining: () => false, movements: {} } }
    attachProtectZone(bot, { zones: () => Z, context: () => ({ holder: 'marooned', skill: 'place' }) })
    bot._client.write('block_place', { location: V(121, 67, -6), direction: 1 })
    bot.heldItem = { name: swap }
    bot._client.write('block_place', { location: V(121, 67, -6), direction: 1 })
    assert.deepEqual(sent, ['block_place'], swap)
  }
})
test('THE PACKET (Claude r6): a chest just OUTSIDE the zone, clicked on its face toward the zone with cobblestone in hand, still opens; a dirt block there does not take a placement', () => {
  const sent = []
  const names = { '48,70,0': 'chest', '48,69,0': 'dirt' }
  const bot = { entity: { position: V(45.5, 70, 0.5) }, heldItem: { name: 'cobblestone' }, blockAt: p => ({ name: names[`${p.x},${p.y},${p.z}`] ?? 'air' }),
    _client: { write: (n, p) => { sent.push(`${p?.location?.y}`); return true } }, pathfinder: { isMining: () => false, movements: {} } }
  attachProtectZone(bot, { zones: () => Z, context: () => ({ skill: 'deposit' }) })
  bot._client.write('block_place', { location: V(48, 70, 0), direction: 5 })   // east face -> 49,70,0, inside the village (x0 49)
  bot._client.write('block_place', { location: V(48, 69, 0), direction: 5 })   // a placement into the village: dropped
  assert.deepEqual(sent, ['70'])
  bot.controlState = { sneak: true }   // Codex r6: a sneaking click on the chest places the cobblestone into the village
  bot._client.write('block_place', { location: V(48, 70, 0), direction: 5 })
  assert.deepEqual(sent, ['70'], 'sneaking: dropped')
  bot.controlState = { sneak: false }; names['48,70,0'] = 'iron_door'   // Codex r7: a hand click on an iron door PASSES and places
  bot._client.write('block_place', { location: V(48, 70, 0), direction: 5 })
  assert.deepEqual(sent, ['70'], 'an iron door: dropped')
})
