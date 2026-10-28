// NOBRIDGE-01 (LIVE 10-27 showcase: 52 dirt blocks laid at y=62 across the lake by walking bots): no walk places a path block
// over or into water; the 1x1 tower stays; the bot swims. Behaviour on the REAL mineflayer-pathfinder Movements.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { overWater, noBridgeCost, NOBRIDGE_COST, NOBRIDGE_PROFILES } from '../src/nobridge.mjs'
const require_ = createRequire(import.meta.url)
const { Movements } = require_('mineflayer-pathfinder')
const { Vec3 } = require_('vec3')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)
assert.strictEqual(require_('mineflayer-pathfinder/package.json').version, '2.4.5', 'the version this override was read against')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }

console.log('THE PREDICATE (pure)')
t('overWater: water in or under the priced cell before a solid; a solid first, or an unread column, is dry', () => {
  assert.strictEqual(overWater(['air', 'water']), true, 'the bridge step: air over water')
  assert.strictEqual(overWater(['water']), true, 'into water')
  assert.strictEqual(overWater(['air', 'air', 'water']), true, 'one above water')
  assert.strictEqual(overWater(['air', 'air', 'air', 'kelp_plant']), true)
  assert.strictEqual(overWater(['air', 'stone', 'water']), false, 'a solid first')
  assert.strictEqual(overWater(['air', 'grass_block']), false, 'the tower on dry land')
  assert.strictEqual(overWater(['air', 'air', 'air', 'air', 'water']), false, 'deeper than NOBRIDGE_DEPTH')
  assert.strictEqual(overWater(['air', null]), false, 'unread')
  assert.strictEqual(overWater(['air', 'lava']), false, 'lava is not this rule')
})
t('noBridgeCost: walking profiles only; the escapes keep their placements', () => {
  const read = (x, y) => (y <= 62 ? 'water' : 'air')
  const blk = { name: 'air', position: { x: 0, y: 63, z: 0 } }
  for (const p of NOBRIDGE_PROFILES) assert.strictEqual(noBridgeCost(read, () => p)(blk), NOBRIDGE_COST, p)
  for (const p of ['ascend', 'descend', 'water', 'tunnel', undefined]) assert.strictEqual(noBridgeCost(read, () => p)(blk), 0, String(p))
  assert.strictEqual(noBridgeCost(() => 'grass_block', () => 'walk')(blk), 0, 'dry ground')
})

console.log('THE REAL PATHFINDER (mineflayer-pathfinder 2.4.5 Movements)')
// a lake: water at y <= 62 for x >= 1, stone shore at x <= 0 (top y 62), bot standing on the shore at y 63
const world = (lake = true) => p => {
  let name = 'air'
  if (p.y <= 62) name = (lake && p.x >= 1) ? 'water' : (p.y === 62 ? 'grass_block' : 'stone')
  const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b
}
const movesFor = (blockAt, profile) => {
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(0.5, 63, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
    pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = true; m.placeCost = 5
  m.exclusionAreasPlace = [...m.exclusionAreasPlace, noBridgeCost((x, y, z) => blockAt(new Vec3(x, y, z))?.name ?? null, () => profile)]
  return m
}
const node = (x, y, z) => ({ x, y, z, remainingBlocks: 64 })
const placing = ns => ns.filter(n => n.toPlace?.length)
t('POSITIVE CONTROL: without the rule the real pathfinder offers the bridge step east over the lake', () => {
  const m = movesFor(world(), 'ascend')
  const n = placing(m.getNeighbors(node(0, 63, 0))).find(x => x.x === 1 && x.y === 63)
  assert.ok(n, 'the library bridges: this is what laid the 52 dirt')
  assert.deepStrictEqual([n.toPlace[0].x + n.toPlace[0].dx, n.toPlace[0].y + n.toPlace[0].dy], [1, 62], 'into the water at y 62')
})
t('on a walk the bridge step over water is gone, and the swim (into the lake) is still offered', () => {
  const m = movesFor(world(), 'walk')
  const ns = m.getNeighbors(node(0, 63, 0))
  assert.ok(!placing(ns).some(x => x.toPlace.some(tp => tp.x + tp.dx >= 1)), `no placement over the lake (${JSON.stringify(placing(ns).map(x => [x.x, x.y, x.z]))})`)
  // a bot already standing on a laid bridge block cannot extend it either
  const m2 = movesFor(p => (p.x === 1 && p.y === 62 ? world()(new Vec3(0, 62, 0)) : world()(p)), 'walk')
  assert.ok(!placing(m2.getNeighbors(node(1, 63, 0))).some(x => x.x === 2), 'no extension from a laid block')
  // from the water (swimming), forward through water stays a move
  const sw = m.getNeighbors(node(2, 62, 0))
  assert.ok(sw.some(x => x.x === 3 && x.y === 62 && !x.toPlace.length), 'swimming forward is a move')
})
t('the 1x1 TOWER is still offered on dry land on a walk (pillaring kept)', () => {
  const m = movesFor(world(false), 'walk')
  const up = m.getNeighbors(node(0, 63, 0)).find(x => x.x === 0 && x.y === 64 && x.z === 0)
  assert.ok(up && up.toPlace.length === 1, 'getMoveUp places one block under the bot')
  // and the bridge over a DRY gap is unchanged (only water is refused)
  const gap = p => (p.x === 1 && p.y === 62 && p.z === 0 ? (() => { const b = Block.fromStateId(registry.blocksByName.air.defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b })() : world(false)(p))
  assert.ok(placing(movesFor(gap, 'walk').getNeighbors(node(0, 63, 0))).some(x => x.x === 1 && x.y === 63), 'a dry one-block gap is still bridged')
})

console.log('WIRING (structural: the entry is on the base walk profile before the clones copy it)')
t('index.mjs appends noBridgeCost to moves.exclusionAreasPlace before setMovements(moves)', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const at = src.indexOf('moves.exclusionAreasPlace = moves.exclusionAreasPlace.concat(noBridgeCost(')
  assert.ok(at > 0, 'wired'); assert.strictEqual(src.split('concat(noBridgeCost(').length, 2, 'once')
  assert.ok(at < src.indexOf('bot.pathfinder.setMovements(moves)'), 'before the walk profile is set and cloned')
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
