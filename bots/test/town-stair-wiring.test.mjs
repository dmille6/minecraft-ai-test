// SHAFT-02 AT RUNTIME (skills.mjs + shop.mjs): the town stair as the second project, on real record files in a temp pool dir and
// the real skills module. The order picks it after the workshop (one builder: a second bot goes on to the house); its cells are
// gather's target exclusion, the walks' footprint (no halo) and mine's own 'stair' keep-out part, never shopKeepOut's bottom; SHAFT=off
// stops the build but keeps the protection; its damage test is its own; and the use: mine's descent and surface's ascent on a fake
// bot over a finished stair -- taken when verified, declined (today's code) when the route is broken, the walk fails or the call
// is step-sized.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stair-rt-'))
process.env.POOL_STATE_DIR = dir
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stair-rt-logs-'))
process.env.BOT_NAME = 'StairBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '71'; process.env.HOME_Z = '0'
delete process.env.SHAFT; delete process.env.SHAFT_POOLS; delete process.env.HOUSE
process.env.MONUMENT = 'off'; process.env.PATHS = 'off'; process.env.WALL = 'off'
const { config } = await import('../src/config.mjs')
const P = await import('../src/buildproj.mjs')
const K = await import('../src/skills.mjs')
const G = await import('../src/shaftgeom.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
const key = plot => P.projKey(home, plot)
const shopRec = { v: 1, blueprint: 'workshop@1', plot: 'shop', box: [5, 5, 7, 7], structure_complete: true, state: 'complete', completeAt: 1,
  cells: [{ at: [5, 71, 5], role: 'base', seg: 'pad' }, { at: [7, 72, 7], role: 'base', seg: 'pad' }] }
// a finished stair at pillar (22, 0), ground 70, away east
const G0 = 70
const site = { origin: G.originFor(22, 0, 'e'), away: 'e', g: G0, center: [22, 0] }
const plan = G.planStair(site)
const k3 = (x, y, z) => `${x},${y},${z}`
function worldOf ({ broken = null } = {}) {
  const open = new Set(plan.cells.filter(c => c.role === 'air').map(c => k3(...c.at)))
  if (broken) open.add(k3(...broken))
  const shop = new Set(shopRec.cells.map(c => k3(...c.at)))
  return (x, y, z) => (shop.has(k3(x, y, z)) ? 'stone' : y > G0 || open.has(k3(x, y, z)) ? 'air' : 'stone')
}
const FULL = [[0, 0, 0, 1, 1, 1]]
function fakeBot (world, { pos = { x: 10.5, y: 71, z: 0.5 }, pick = true, moves = true, plan = 'success' } = {}) {
  const b = {
    username: 'T', entity: { position: { ...pos, floored () { return { x: Math.floor(this.x), y: Math.floor(this.y), z: Math.floor(this.z) } } } },
    blockAt: v => { const n = world(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); return { name: n, boundingBox: n === 'air' ? 'empty' : 'block', shapes: n === 'air' ? [] : FULL, getProperties: () => ({}) } },
    inventory: { items: () => (pick ? [{ name: 'iron_pickaxe', count: 1, maxDurability: 250, durabilityUsed: 10 }] : []) },
    withTownDepositWalk: async fn => fn(),
    walks: [],
    pathfinder: {
      movements: {},
      setGoal () {}, stop () {},
      goto: async goal => { b.walks.push([goal.x, goal.y, goal.z]); if (moves) Object.assign(b.entity.position, { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 }) },
      getPathFromTo: function * () { yield { result: { status: plan } } },
    },
  }
  return b
}
const ctx = bot => ({ bot })

console.log('THE ORDER AND THE PROTECTION ON FILES')
await t('the workshop stands: the stair is the project (no record yet); a second bot, with its one slot held, goes on to the house', () => {
  assert.strictEqual(P.publishRecord(dir, key('shop'), () => shopRec).result, 'accepted')
  const bot = { username: 'T', blockAt: () => null }   // unloaded: the workshop's own damage test says nothing (house-runtime's bot)
  assert.strictEqual(K.shopActive(bot).plot, 'shaft')
  assert.ok(P.takeSlot(dir, key('shaft'), 'Other', 1).ok, 'another builder holds the stair\'s one slot')
  assert.strictEqual(K.shopActive(bot, Date.now() + 61_000).plot, 'house1', 'the stair full: the next open project')
})
await t('a sited stair: gather excludes its cells, the footprint prices exactly them (no halo), mine gets them from the STAIR part', () => {
  const rec = { ...G.stairRecord({ site, K: plan.K, landings: [48, 32, 16], lining: 0, digs: 0, stopK: null, exit: G.collarExit((x, y, z) => ({ name: worldOf()(x, y, z), boundingBox: worldOf()(x, y, z) === 'air' ? 'empty' : 'block' }), site) }, { home }), landings_built: [48, 32, 16], structure_complete: true, state: 'complete' }
  assert.strictEqual(P.publishRecord(dir, key('shaft'), () => rec).result, 'accepted')
  const cell = plan.steps[30].tread
  const c = K.shopCellsNow()
  assert.ok(c.cells.has(k3(...cell)), 'a gather target never')
  assert.strictEqual(c.bottom, 71, 'the buildings\' bottom, not the stair\'s 15')
  assert.strictEqual(K.shopKeepOut().forbid({ x: cell[0], y: cell[1], z: cell[2] }), null, 'not the workshop part\'s')
  assert.strictEqual(G.stairKeepOut(K.stairRecordNow(Date.now() + 30_000)).forbid({ x: cell[0], y: cell[1], z: cell[2] }), 'stair')
  const bot = fakeBot(worldOf())
  K.shopFootprintRefresh(bot)
  assert.ok(bot.shopFootprint.has(k3(...cell)))
  const out = plan.box.x1 + 1
  assert.ok(!bot.shopFootprint.has(k3(out, 40, plan.steps[0].tread[2])), 'no halo')
})
await t('SHAFT=off: no stair project, but its cells stay protected (gather and the footprint)', () => {
  const run = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const K = await import('./src/skills.mjs'); const S = await import('./src/shop.mjs'); const c = K.shopCellsNow(); console.log(JSON.stringify({ on: S.projectsOn().map(p => p.plot), n: c?.stair?.size ?? 0 }))"],
  { cwd: new URL('..', import.meta.url), env: { ...process.env, SHAFT: 'off' }, encoding: 'utf8' }).trim().split('\n').pop()
  const j = JSON.parse(run)
  assert.ok(!j.on.includes('shaft'))
  assert.strictEqual(j.n, plan.cells.length)
})
await t('the stair\'s own damage test: a finished stair stands; a tread gone reads damaged (repairs first)', () => {
  const rec = P.recordHead(dir, key('shaft')).head.rec
  assert.strictEqual(K.shopDamaged(fakeBot(worldOf()), rec), false)
  const t30 = plan.steps[30].tread
  const w = worldOf({ broken: t30 })
  assert.strictEqual(K.shopDamaged({ ...fakeBot(w), shopDamage: null }, { ...rec, plot: 'shaft2' }), true)
})

console.log('THE USE (fake bot over a finished stair)')
const stub = feet => G.stubEnd(plan.landings.find(l => l.feet === feet))
await t('mine 16 from the surface near the stair: walks down to the 16 landing\'s stub end, done', async () => {
  const bot = fakeBot(worldOf())
  const r = await K.stairDescend(ctx(bot), 16, null)
  assert.deepStrictEqual(r, { arrived: true, landing: 16, done: true })
  assert.deepStrictEqual(bot.walks, [stub(16)])
})
await t('mine 0: down to 16, not done (mine digs on from the stub end); mine 40: the 48 landing', async () => {
  const b1 = fakeBot(worldOf()); assert.deepStrictEqual(await K.stairDescend(ctx(b1), 0, null), { arrived: true, landing: 16, done: false })
  const b2 = fakeBot(worldOf()); assert.deepStrictEqual(await K.stairDescend(ctx(b2), 40, null), { arrived: true, landing: 48, done: false })
})
await t('declined (null, today\'s mine): a step-sized call, no pickaxe, far from the stair, a broken route', async () => {
  assert.strictEqual(await K.stairDescend(ctx(fakeBot(worldOf())), 66, null), null)
  assert.strictEqual(await K.stairDescend(ctx(fakeBot(worldOf(), { pick: false })), 16, null), null)
  assert.strictEqual(await K.stairDescend(ctx(fakeBot(worldOf(), { pos: { x: 200.5, y: 71, z: 0.5 } })), 16, null), null)
  const tread = plan.steps[10].tread
  const broken = (x, y, z) => (x === tread[0] && y === tread[1] && z === tread[2] ? 'air' : worldOf()(x, y, z))
  const b = fakeBot(broken)
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  assert.deepStrictEqual(b.walks, [], 'never walked')
})
await t('a walk that does not arrive: null, and that landing is not tried again by this bot for 10 min', async () => {
  const b = fakeBot(worldOf(), { moves: false })
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  assert.strictEqual(b.walks.length, 1)
  const again = await K.stairDescend(ctx(b), 16, null)
  assert.ok(again === null || again.landing !== 16)
  assert.ok(b.walks.length <= 2 && b.walks.every(w => w.join() !== stub(16).join() || b.walks.indexOf(w) === 0), 'the 16 is backed off')
})
await t('surface from the 32 stub end (under rock): plans, walks up to the collar exit', async () => {
  const s = stub(32)
  const b = fakeBot(worldOf(), { pos: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 } })
  const r = await K.stairAscend(ctx(b), null)
  assert.ok(r?.ok, JSON.stringify(r))
  const rec = K.stairRecordNow()
  assert.deepStrictEqual(b.walks, [rec.exit])
})
await t('surface declined: in the open (not roofed), or the plan finds no path', async () => {
  assert.strictEqual(await K.stairAscend(ctx(fakeBot(worldOf(), { pos: { x: 200.5, y: 50, z: 0.5 } })), null), null, 'far')
  const s = stub(32)
  const b = fakeBot(worldOf(), { pos: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 }, plan: 'noPath' })
  assert.strictEqual(await K.stairAscend(ctx(b), null), null)
  assert.deepStrictEqual(b.walks, [])
  const open = (x, y, z) => 'air'
  const b2 = fakeBot(open, { pos: { x: 20.5, y: 50, z: 0.5 } })
  assert.strictEqual(await K.stairAscend(ctx(b2), null), null, 'nothing over its head')
})

console.log('THE WIRING (structural: the hooks exist, in order)')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const SRC = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
await t('build_shop dispatches the stair to its own visit; mine asks the stair BEFORE its home refusal; surface BEFORE already_surfaced', () => {
  assert.strictEqual(SRC.split('if (proj.plot === SHAFT_PLOT) return buildStair(ctx, args, signal)').length, 2)
  const mineAt = SRC.indexOf('async function mine(ctx, { y: targetY = 12 }, signal, ko = null) {')
  const hop = SRC.indexOf('const hop = await stairDescend(ctx, goalY, signal)', mineAt)
  const refusal = SRC.indexOf('if (dHome <= 12 && goalY < bot.entity.position.y - 1) {', mineAt)
  assert.ok(mineAt > 0 && hop > mineAt && refusal > hop, `${mineAt} ${hop} ${refusal}`)
  const surf = SRC.indexOf('async function surfaceClimb(ctx, args, signal, { until = null } = {}) {')
  const up = SRC.indexOf('const up = await stairAscend(ctx, signal)', surf)
  const already = SRC.indexOf('if (startY >= TOP) {', surf)
  assert.ok(surf > 0 && up > surf && already > up, `${surf} ${up} ${already}`)
  assert.strictEqual(SRC.split('stairKeepOut(stairRecordNow())').length, 2, 'mine composes the stair part')
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
