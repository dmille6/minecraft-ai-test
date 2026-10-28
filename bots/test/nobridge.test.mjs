// NOBRIDGE-01 (LIVE 10-27 showcase: 52 dirt blocks laid at y=62 across the lake by walking bots): no walk places a path block
// over or into water; the 1x1 tower stays; the bot swims. Behaviour on the REAL mineflayer-pathfinder Movements.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { overWater, installNoBridge, wetName, NOBRIDGE_DEPTH } from '../src/nobridge.mjs'
const require_ = createRequire(import.meta.url)
const { Movements } = require_('mineflayer-pathfinder')
const { Vec3 } = require_('vec3')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)
assert.strictEqual(require_('mineflayer-pathfinder/package.json').version, '2.4.5', 'the version this override was read against')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }

console.log('THE PREDICATE (pure)')
t('overWater: water in the priced cell, or under it before a block the column cannot pass; else dry', () => {
  assert.strictEqual(overWater(['air', 'water']), true, 'the bridge step: air over water')
  assert.strictEqual(overWater(['water']), true, 'into water')
  assert.strictEqual(overWater(['lily_pad', 'water']), true, 'a lily pad in the STEP cell does not hide the lake (r2 Codex P2)')
  assert.strictEqual(overWater(['air', 'air', 'air', 'air', 'air', 'water']), true, 'from a high bank (r2 Codex P2)')
  assert.strictEqual(overWater(['air', 'short_grass', 'air', 'kelp_plant']), true)
  assert.strictEqual(overWater(['air', 'stone', 'water']), false, 'a solid first')
  assert.strictEqual(overWater(['air', 'grass_block']), false, 'the tower on dry land')
  assert.strictEqual(overWater(['air', null]), false, 'unread')
  assert.strictEqual(overWater(['air', 'lava']), false, 'lava is not this rule')
  assert.strictEqual(overWater(Array(NOBRIDGE_DEPTH).fill('air').concat('water')), false, 'bounded')
  assert.strictEqual(overWater(Array(40).fill('air').concat('water')), true, 'a bank 40 above the water (r3 Codex P2)')
  assert.strictEqual(overWater(['air', 'air', 'lily_pad', 'water']), true, 'a lily pad BELOW the step (r3 Codex P2)')
  let reads = 0
  assert.strictEqual(overWater(i => { reads++; return i === 0 ? 'air' : 'stone' }), false); assert.strictEqual(reads, 2, 'lazy: stops at the first solid')
})
t('wetName: a waterlogged block reads as water', () => {
  assert.strictEqual(wetName({ name: 'oak_slab', getProperties: () => ({ waterlogged: true }) }), 'water')
  assert.strictEqual(wetName({ name: 'oak_slab', getProperties: () => ({ waterlogged: false }) }), 'oak_slab')
  assert.strictEqual(wetName(null), null)
})

console.log('THE REAL PATHFINDER (mineflayer-pathfinder 2.4.5 Movements)')
// a lake: water at y <= 62 for x >= 1, stone shore at x <= 0 (top y 62), bot standing on the shore at y 63
const world = (lake = true) => p => {
  let name = 'air'
  if (p.y <= 62) name = (lake && p.x >= 1) ? 'water' : (p.y === 62 ? 'grass_block' : 'stone')
  const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b
}
const movesFor = (blockAt, noBridge = true) => {
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(0.5, 63, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
    pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = true; m.placeCost = 5
  installNoBridge(m, (x, y, z) => blockAt(new Vec3(x, y, z)))
  m.noBridge = noBridge
  return m
}
const node = (x, y, z) => ({ x, y, z, remainingBlocks: 64 })
const placing = ns => ns.filter(n => n.toPlace?.length)
t('POSITIVE CONTROL: without the rule the real pathfinder offers the bridge step east over the lake', () => {
  const m = movesFor(world(), false)
  const n = placing(m.getNeighbors(node(0, 63, 0))).find(x => x.x === 1 && x.y === 63)
  assert.ok(n, 'the library bridges: this is what laid the 52 dirt')
  assert.deepStrictEqual([n.toPlace[0].x + n.toPlace[0].dx, n.toPlace[0].y + n.toPlace[0].dy], [1, 62], 'into the water at y 62')
})
t('on a walk the bridge step over water is gone, and the swim (into the lake) is still offered', () => {
  const m = movesFor(world())
  const ns = m.getNeighbors(node(0, 63, 0))
  assert.ok(!placing(ns).some(x => x.toPlace.some(tp => tp.x + tp.dx >= 1)), `no placement over the lake (${JSON.stringify(placing(ns).map(x => [x.x, x.y, x.z]))})`)
  // a bot already standing on a laid bridge block cannot extend it either
  const m2 = movesFor(p => (p.x === 1 && p.y === 62 ? world()(new Vec3(0, 62, 0)) : world()(p)))
  assert.ok(!placing(m2.getNeighbors(node(1, 63, 0))).some(x => x.x === 2), 'no extension from a laid block')
  // from the water (swimming), forward through water stays a move
  const sw = m.getNeighbors(node(2, 62, 0))
  assert.ok(sw.some(x => x.x === 3 && x.y === 62 && !x.toPlace.length), 'swimming forward is a move')
})
t('a CLONE made the index.mjs way carries the rule with `this` the clone; noBridge=false on the clone exempts only it', () => {
  const base = movesFor(world())
  const walkClone = Object.assign(Object.create(Object.getPrototypeOf(base)), base)
  const escape = Object.assign(Object.create(Object.getPrototypeOf(base)), base); escape.noBridge = false
  const east = m => placing(m.getNeighbors(node(0, 63, 0))).some(x => x.x === 1 && x.y === 63)
  assert.strictEqual(east(walkClone), false, 'the walking clone refuses')
  assert.strictEqual(east(escape), true, 'the escape clone keeps the placement')
  assert.strictEqual(east(base), false, 'and the base is untouched by the clone\'s flag')
})
t('a lily pad on the lake does not hide it (the step cell is not the placed cell)', () => {
  const lily = p => (p.x === 1 && p.y === 63 && p.z === 0 ? (() => { const b = Block.fromStateId(registry.blocksByName.lily_pad.defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b })() : world()(p))
  const m = movesFor(lily)
  assert.ok(!placing(m.getNeighbors(node(0, 63, 0))).some(x => x.toPlace.some(tp => tp.x + tp.dx === 1 && tp.y + tp.dy === 62)), 'no dirt into the water under the pad')
  assert.ok(placing(movesFor(lily, false).getNeighbors(node(0, 63, 0))).some(x => x.toPlace.some(tp => tp.x + tp.dx === 1 && tp.y + tp.dy === 62)), 'positive control: the library would')
})
t('REAL: a bank 24 above the lake and a lily pad below the step are both refused (Codex r2 repros)', () => {
  const mk = name => { const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); return b }
  const high = p => { let n = 'air'; if (p.y <= 62) n = p.x >= 1 ? 'water' : 'stone'; else if (p.x <= 0 && p.y <= 85) n = 'stone'; const b = mk(n); b.position = new Vec3(p.x, p.y, p.z); return b }
  const east = (m, y) => placing(m.getNeighbors(node(0, y, 0))).filter(x => x.x === 1)
  assert.ok(east(movesFor(high, false), 86).length, 'positive control: the library bridges off the high bank')
  assert.strictEqual(east(movesFor(high), 86).length, 0, 'refused on a walk')
  const pad = p => { let n = 'air'; if (p.y <= 62) n = p.x >= 1 ? 'water' : 'stone'; else if (p.x <= 0 && p.y <= 64) n = 'stone'; else if (p.x >= 1 && p.y === 63) n = 'lily_pad'; const b = mk(n); b.position = new Vec3(p.x, p.y, p.z); return b }
  assert.ok(east(movesFor(pad, false), 65).some(x => x.y === 65), 'positive control: scaffold at 64 over the pad')
  assert.ok(!east(movesFor(pad), 65).some(x => x.toPlace.length), 'refused on a walk')
})
t('the 1x1 TOWER is still offered on dry land on a walk (pillaring kept)', () => {
  const m = movesFor(world(false))
  const up = m.getNeighbors(node(0, 63, 0)).find(x => x.x === 0 && x.y === 64 && x.z === 0)
  assert.ok(up && up.toPlace.length === 1, 'getMoveUp places one block under the bot')
  // and the bridge over a DRY gap is unchanged (only water is refused)
  const gap = p => (p.x === 1 && p.y === 62 && p.z === 0 ? (() => { const b = Block.fromStateId(registry.blocksByName.air.defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b })() : world(false)(p))
  assert.ok(placing(movesFor(gap).getNeighbors(node(0, 63, 0))).some(x => x.x === 1 && x.y === 63), 'a dry one-block gap is still bridged')
})

console.log('WIRING (structural: the entry is on the base walk profile before the clones copy it)')
t('index.mjs installs it on the walk before setMovements and clears it on ascend, descend, water and tunnel (structural)', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const at = src.indexOf('installNoBridge(moves,')
  assert.ok(at > 0, 'wired'); assert.strictEqual(src.split('installNoBridge(').length, 2, 'once')
  assert.ok(at < src.indexOf('bot.pathfinder.setMovements(moves)'), 'before the walk profile is set and cloned')
  for (const m of ['ascendMoves', 'descendMoves', 'waterMoves', 'bot.tunnelMovements']) assert.ok(new RegExp(`${m.replace('.', '\\.')}\\.noBridge = false`).test(src), `${m} exempt`)
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
