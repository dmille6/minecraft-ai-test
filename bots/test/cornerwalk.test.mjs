// CORNERWALK-01 (cornermoves.mjs): a walk's diagonal step is kept only when BOTH side columns are open. Behaviour on the REAL
// mineflayer-pathfinder 2.4.5 Movements and its A* (the same library code the fleet runs), on the showcase's live corner
// geometry (shopwalls-02, buildcorner.test.mjs) and on open ground.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { sidesClear, installCornerRule } from '../src/cornermoves.mjs'
const require_ = createRequire(import.meta.url)
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar')
const { Vec3 } = require_('vec3')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)
assert.strictEqual(require_('mineflayer-pathfinder/package.json').version, '2.4.5', 'the version this override was read against')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }

const mk = (name, p) => { const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b }
/** A world from a set of solid cells over a floor at y <= floorY. */
const worldOf = (solid, floorY = 72) => p => mk(p.y <= floorY || solid.has(`${p.x},${p.y},${p.z}`) ? 'stone_bricks' : 'air', p)
// THE LIVE CORNER (buildcorner.test.mjs): the ring top (y 73) round the workshop, plank walls at x 21 / z 31 for y 73..74
const LIVE = new Set()
for (let x = 20; x <= 28; x++) { LIVE.add(`${x},73,32`); LIVE.add(`${x},73,26`) }
for (let z = 26; z <= 32; z++) { LIVE.add(`20,73,${z}`); LIVE.add(`28,73,${z}`) }
for (let x = 21; x <= 27; x++) for (const y of [73, 74]) { LIVE.add(`${x},${y},31`); LIVE.add(`${x},${y},27`) }
for (let z = 27; z <= 31; z++) for (const y of [73, 74]) { LIVE.add(`21,${y},${z}`); LIVE.add(`27,${y},${z}`) }
const movesFor = (blockAt, rule = true, mod = { installCornerRule }) => {
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(0.5, 64, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = false
  if (rule) mod.installCornerRule(m)
  return m
}
const node = (x, y, z) => ({ x, y, z, remainingBlocks: 0 })
const diag = (ns, x, z) => ns.find(n => n.x === x && n.z === z)
const plan = (m, from, goal) => {
  const start = new (require_('mineflayer-pathfinder/lib/move'))(from[0], from[1], from[2], 0, 0)
  // the library's 40 ms tick returns `partial` under a loaded suite (Codex r1 note): resume until it settles
  const a = new AStar(start, m, goal, 10_000, 40, -1)
  let r = a.compute()
  while (r.status === 'partial') r = a.compute()
  return r
}
/** Does the path take a diagonal step past a solid side cell (at the body's two heights)? */
const cutsCorner = (from, path, blockAt) => {
  let a = { x: from[0], y: from[1], z: from[2] }
  for (const b of path) {
    const dx = b.x - a.x, dz = b.z - a.z
    if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
      for (const [sx, sz] of [[a.x + dx, a.z], [a.x, a.z + dz]]) for (const y of [a.y, a.y + 1]) if (blockAt(new Vec3(sx, y, sz)).boundingBox !== 'empty') return `${a.x},${a.y},${a.z}->${b.x},${b.y},${b.z}`
    }
    a = b
  }
  return null
}

console.log('THE SIDE TEST (pure)')
await t('sidesClear: every cell safe or broken by the move; an unread cell fails', () => {
  const c = (safe, x = 0) => ({ safe, position: { x, y: 0, z: 0 } })
  assert.strictEqual(sidesClear([[c(true), c(true)], [c(true), c(true)]]), true)
  assert.strictEqual(sidesClear([[c(true), c(true)], [c(false, 5), c(true)]]), false, 'one side blocked')
  assert.strictEqual(sidesClear([[c(true), c(true)], [c(false, 5), c(true)]], new Set(['5,0,0'])), true, 'the move breaks it')
  assert.strictEqual(sidesClear([[c(true), null], [c(true)]]), false, 'unread')
})

console.log('THE REAL PATHFINDER (mineflayer-pathfinder 2.4.5 Movements)')
await t('POSITIVE CONTROL: without the rule the library offers 21,74,32 -> 20,74,31 across the wall corner 21,74,31', () => {
  assert.ok(diag(movesFor(worldOf(LIVE), false).getNeighbors(node(21, 74, 32)), 20, 31), 'the step that wedged 8 of 10 builders')
})
await t('with the rule that diagonal is gone, and the cardinal step round the clear side (20,74,32) is still offered', () => {
  const ns = movesFor(worldOf(LIVE)).getNeighbors(node(21, 74, 32))
  assert.strictEqual(diag(ns, 20, 31), undefined)
  assert.ok(ns.some(n => n.x === 20 && n.y === 74 && n.z === 32), 'west along the ring top')
})
await t('open ground: every diagonal is unchanged (the rule touches corners only)', () => {
  const flat = worldOf(new Set(), 63)
  const a = movesFor(flat, false).getNeighbors(node(0, 64, 0)).map(n => `${n.x},${n.y},${n.z}`).sort()
  const b = movesFor(flat).getNeighbors(node(0, 64, 0)).map(n => `${n.x},${n.y},${n.z}`).sort()
  assert.deepStrictEqual(b, a)
  assert.strictEqual(b.filter(s => { const [x, , z] = s.split(',').map(Number); return x && z }).length, 4, 'four diagonals')
})
await t('a head-height block on one side (the body is 1.8 high) refuses the diagonal too', () => {
  const head = worldOf(new Set(['1,65,0']), 63)
  assert.ok(diag(movesFor(head, false).getNeighbors(node(0, 64, 0)), 1, 1), 'control: the library cuts it')
  assert.strictEqual(diag(movesFor(head).getNeighbors(node(0, 64, 0)), 1, 1), undefined)
})
await t('a DIG-CAPABLE profile: the library breaks the cheaper side only -> the uncut side is still a corner: refused', () => {
  const one = worldOf(new Set(['1,64,0', '1,65,0']), 63)
  const dig = m => { m.canDig = true; return m }
  assert.ok(diag(dig(movesFor(one, false)).getNeighbors(node(0, 64, 0)), 1, 1), 'control')
  assert.strictEqual(diag(dig(movesFor(one)).getNeighbors(node(0, 64, 0)), 1, 1), undefined, 'the uncut side is still a corner')
})
await t('A*: the live walk from the ring corner to the stand plans round the corner, and still arrives', () => {
  const w = worldOf(LIVE)
  const goal = new goals.GoalBlock(20, 74, 29)
  const before = plan(movesFor(w, false), [21, 74, 32], goal)
  assert.strictEqual(before.status, 'success'); assert.ok(cutsCorner([21, 74, 32], before.path, w), 'control: the library path cuts the corner')
  const after = plan(movesFor(w), [21, 74, 32], goal)
  assert.strictEqual(after.status, 'success', 'still a path')
  assert.strictEqual(cutsCorner([21, 74, 32], after.path, w), null)
  assert.ok(after.path.length <= before.path.length + 2, `at most a step or two longer (${before.path.length} -> ${after.path.length})`)
})
await t('A* through a field of pillars: no path step clips a pillar corner; the walk still arrives', () => {
  const pil = new Set()
  for (let x = -8; x <= 8; x += 2) for (let z = -8; z <= 8; z += 3) if (x || z) { pil.add(`${x},64,${z}`); pil.add(`${x},65,${z}`) }
  const w = worldOf(pil, 63)
  const r = plan(movesFor(w), [0, 64, 0], new goals.GoalBlock(9, 64, 9))
  assert.strictEqual(r.status, 'success'); assert.strictEqual(cutsCorner([0, 64, 0], r.path, w), null)
})
await t('a CLONE made the index.mjs way carries the rule; cornerRule=false on an escape clone restores the library move', () => {
  const base = movesFor(worldOf(LIVE))
  const walk = Object.assign(Object.create(Object.getPrototypeOf(base)), base)
  const escape = Object.assign(Object.create(Object.getPrototypeOf(base)), base); escape.cornerRule = false
  assert.strictEqual(diag(walk.getNeighbors(node(21, 74, 32)), 20, 31), undefined)
  assert.ok(diag(escape.getNeighbors(node(21, 74, 32)), 20, 31))
  assert.strictEqual(diag(base.getNeighbors(node(21, 74, 32)), 20, 31), undefined, 'the base is untouched by the clone\'s flag')
})
await t('MUTANT KILLED: a rule that does not drop the move leaves the corner cut', async () => {
  const p = new URL('../src/cornermoves.mjs', import.meta.url)
  const src = readFileSync(p, 'utf8'); const old = '    neighbors.length = n0\n'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, ''))
  try {
    const mod = await import(out.href)
    assert.ok(diag(movesFor(worldOf(LIVE), true, mod).getNeighbors(node(21, 74, 32)), 20, 31), 'the mutant still dropped it: the tests prove nothing')
  } finally { try { unlinkSync(out) } catch {} }
})

console.log('WIRING (structural: on the walk before the clones; the escapes clear it)')
await t('index.mjs installs it on the walk before any clone and clears it on ascend, descend, deck and water', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const at = src.indexOf('installCornerRule(moves)')
  assert.ok(at > 0, 'wired'); assert.strictEqual(src.split('installCornerRule(').length, 2, 'once')
  assert.ok(at < src.indexOf('const gatherMoves = Object.create('), 'before the first clone')
  for (const m of ['ascendMoves', 'descendMoves', 'deckMoves', 'waterMoves']) assert.ok(new RegExp(`${m}\\.cornerRule = false`).test(src), `${m} exempt`)
  assert.ok(!/gatherMoves\.cornerRule = false/.test(src), 'gather keeps it')
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
