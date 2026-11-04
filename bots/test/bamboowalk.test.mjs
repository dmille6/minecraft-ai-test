// BAMBOOWALK-01 (fleet 11-01..11-04): THE CLIENT'S BAMBOO POST IS WHERE THE SERVER'S IS.
// minecraft-data bakes block (0,0)'s XZ offset (-0.25,-0.25) into every bamboo's collision box; the server moves each post by its
// own block's offset. A client that walks into a post it cannot see is teleported back by the server, every tick, forever:
// board-d's monument dig walk stopped 71 times at exactly (338.0, 71, 114.0), 0.023 south of the REAL post of (337,71,113).
//   1. the offset is vanilla's: vectors from Paper 1.21.8's own net.minecraft.util.Mth.getSeed (run on the sandbox host 11-04)
//   2. the shapes: block (0,0) is unchanged, (337,113) is the post the server has, registry arrays are never written
//   3. the plugin: wraps bot.blockAt once, passes everything through, BAMBOOWALK=0 installs nothing, index.mjs loads it
//   4. THE CHAIN on board-d's live grove (test/fixtures/bamboowalk-boardd-1103.json, the 11-03 03:16Z backup's region copy):
//      prismarine-physics as the client, a server that refuses a move into anything new (Paper's handleMovePlayer), the body at
//      the wedge walking to the gravel top beside it. Base client: every move refused, the body never leaves. Candidate: no
//      refusal, the body slides round the post and arrives. Each killed by an anchored, unique mutant.
import assert from 'node:assert'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const { Physics, PlayerState } = require('prismarine-physics')
const mcData = require('minecraft-data')('1.21.8')
const Block = require('prismarine-block')('1.21.8')
const SRC = new URL('../src/bamboowalk.mjs', import.meta.url)
const BW = await import(SRC.href)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** A mutant of src/bamboowalk.mjs: the anchor present and unique, imported under a fresh URL (never the cached module). */
async function withMutant (old, neu, fn) {
  const src = fs.readFileSync(SRC, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))}`)
  assert.strictEqual(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-bamboowalk-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (old, neu, scenario) => {
  await scenario(BW)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

// ---- 1. the offset ------------------------------------------------------------------------------------------------------------
// java -cp paper-1.21.8.jar:libraries V.java on 10.0.0.30: Mth.getSeed(x,0,z), then vanilla's float/double expression and clamp
const JAVA = [
  [0, 0, 0n, -0.25, -0.25], [337, 113, -23934311605507n, 0.18333333730697632, 0.0833333432674408],
  [339, 113, 71203528422726n, -0.04999999701976776, -0.0833333283662796], [-1, -1, 60165349410229n, -0.0833333283662796, -0.0833333283662796],
  [-337, -113, -23934311605507n, 0.18333333730697632, 0.0833333432674408], [2147483, -2147483, 72628066440346n, 0.0833333432674408, -0.11666665971279144],
  [-30000000, 29999999, 140254595706080n, -0.25, 0.15000000596046448], [12345, -6789, -138183053188242n, 0.21666666865348816, -0.14999999850988388],
  [360, 85, 75385867607470n, 0.21666666865348816, 0.18333333730697632], [376, 41, 80524506432857n, 0.050000011920928955, -0.0833333283662796],
  [-5, 7, -113315081188586n, -0.04999999701976776, 0.11666667461395264], [100000, 100000, -11021779752170n, -0.04999999701976776, 0.11666667461395264],
]
const offsetsMatchJava = M => {
  for (const [x, z, seed, dx, dz] of JAVA) {
    assert.strictEqual(M.blockSeed(x, z), seed, `seed ${x},${z}`)
    const [ox, oz] = M.xzOffset(x, z)
    assert.strictEqual(ox, dx, `dx ${x},${z}`); assert.strictEqual(oz, dz, `dz ${x},${z}`)
  }
}
await t('the seed and the offset are vanilla\'s: twelve vectors from Paper 1.21.8\'s own Mth.getSeed (negative, large, int-overflowing x)', () => offsetsMatchJava(BW))
await t('MUTANT KILLED: x multiplied as a long (no int overflow) breaks the large-x vectors', () =>
  killedBy('BigInt(Math.imul(x | 0, 3129871))', 'BigInt(x) * 3129871n', offsetsMatchJava))
await t('MUTANT KILLED: dx and dz read from the same nibble', () =>
  killedBy('return [c((f(0n) - 0.5) * 0.5), c((f(8n) - 0.5) * 0.5)]', 'return [c((f(0n) - 0.5) * 0.5), c((f(0n) - 0.5) * 0.5)]', offsetsMatchJava))

// ---- 2. the shapes ------------------------------------------------------------------------------------------------------------
const bambooBlock = (x, y, z) => { const b = Block.fromStateId(mcData.blocksByName.bamboo.minStateId + 3, 0); b.position = new Vec3(x, y, z); return b }
const BAKED = JSON.parse(JSON.stringify(bambooBlock(0, 0, 0).shapes))
await t('minecraft-data\'s bamboo box IS the vanilla post at block (0,0)\'s offset: 6.5/16 - 0.25 = 0.15625 (the defect this fixes)', () => {
  assert.deepStrictEqual(BAKED, [[0.15625, 0, 0.15625, 0.34375, 1, 0.34375]])
  const [dx, dz] = BW.xzOffset(0, 0)
  assert.ok(near(6.5 / 16 + dx, BAKED[0][0]) && near(9.5 / 16 + dz, BAKED[0][5]))
})
const postAt = M => {
  assert.deepStrictEqual(M.trueShapes('bamboo', BAKED, 0, 0), BAKED, 'block (0,0) keeps the baked box')
  const [[x0, y0, z0, x1, y1, z1]] = M.trueShapes('bamboo', BAKED, 337, 113)
  // the live wedge: (337,71,113)'s post on the server spans x 337.590..337.777, z 113.490..113.677 (cell-local + 337/113)
  assert.ok(near(x0, 0.59 + 1 / 3000, 1e-3) && near(x1, 0.777, 1e-3) && near(z0, 0.49, 1e-3) && near(z1, 0.677, 1e-3), JSON.stringify([x0, z0, x1, z1]))
  assert.strictEqual(y0, 0); assert.strictEqual(y1, 1)
}
await t('(337,113)\'s post is the server\'s: x .590-.777, z .490-.677; y untouched (the pathfinder\'s heights)', () => postAt(BW))
await t('MUTANT KILLED: the shapes not moved in x', () => killedBy('s => [s[0] + dx, s[1], s[2] + dz, s[3] + dx, s[4], s[5] + dz]', 's => [s[0], s[1], s[2] + dz, s[3], s[4], s[5] + dz]', postAt))
await t('MUTANT KILLED: the true offset used without removing the baked one', () => killedBy('v = [tx - bx, tz - bz]', 'v = [tx, tz]', postAt))

await t('the registry is never written: a fixed block gets FRESH outer and inner arrays; the next read is the baked box again', () => {
  const reg = mcData.blockCollisionShapes
  const before = JSON.stringify(reg.shapes)
  const raw = bambooBlock(337, 71, 113); const shared = raw.shapes; const inner = shared[0]
  const b = BW.fixBlock(raw)
  assert.notStrictEqual(b.shapes, shared); assert.notStrictEqual(b.shapes[0], inner)
  assert.deepStrictEqual(shared, BAKED)
  assert.deepStrictEqual(bambooBlock(337, 71, 113).shapes, BAKED)
  assert.strictEqual(JSON.stringify(reg.shapes), before)
})
await t('only bamboo moves: stone, sugar cane, pointed dripstone (not in this canary) keep their own array; null and junk pass, nothing throws', () => {
  for (const n of ['stone', 'sugar_cane', 'pointed_dripstone', 'gravel']) {
    const b = Block.fromStateId(mcData.blocksByName[n].minStateId, 0); b.position = new Vec3(337, 71, 113)
    const s = b.shapes
    assert.strictEqual(BW.fixBlock(b).shapes, s, n)
  }
  assert.strictEqual(BW.fixBlock(null), null)
  const noPos = bambooBlock(1, 1, 1); noPos.position = null
  assert.deepStrictEqual(BW.fixBlock(noPos).shapes, BAKED)
  const bad = { name: 'bamboo', position: { x: 1, z: 1 }, get shapes () { throw new Error('boom') } }
  assert.strictEqual(BW.fixBlock(bad), bad)
  assert.strictEqual(BW.trueShapes('bamboo', [], 3, 3), null)
})

// ---- 3. the plugin ------------------------------------------------------------------------------------------------------------
await t('the plugin wraps bot.blockAt once, passes every argument and `this` through, and BAMBOOWALK=0 installs nothing', () => {
  const calls = []
  const mk = () => ({ blockAt (p, extra) { calls.push([this, p, extra]); return bambooBlock(p.x, p.y, p.z) } })
  const bot = mk(); const orig = bot.blockAt
  assert.strictEqual(BW.bambooWalkPlugin(bot, {}, { BAMBOOWALK: '' }), true)
  assert.notStrictEqual(bot.blockAt, orig); assert.strictEqual(bot.blockAt.bambooWalk, true)
  const once = bot.blockAt
  BW.bambooWalkPlugin(bot, {}, {})
  assert.strictEqual(bot.blockAt, once, 'idempotent: never wrapped twice')
  const b = bot.blockAt(new Vec3(337, 71, 113), false)
  assert.strictEqual(calls[0][0], bot); assert.strictEqual(calls[0][2], false)
  assert.ok(near(b.shapes[0][0], 0.59 + 1 / 3000, 1e-3))
  for (const v of ['0', 'off', 'false', 'no', ' OFF ']) {
    const b2 = mk(); const o2 = b2.blockAt
    assert.strictEqual(BW.bambooWalkPlugin(b2, {}, { BAMBOOWALK: v }), false, v)
    assert.strictEqual(b2.blockAt, o2, `BAMBOOWALK=${v} leaves blockAt exactly the base's`)
  }
  assert.strictEqual(BW.bambooWalkPlugin({}, {}, {}), false, 'no blockAt yet: nothing installed, nothing thrown')
  assert.match(BW.bambooWalkModeDetail(bot, {}), /^on=1 wrapped=1 blocks=bamboo rollback=BAMBOOWALK=0$/)
})
const INDEX = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
const wired = src => {
  const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.strictEqual(code.split('bot.loadPlugin(bambooWalkPlugin)').length, 2, 'loaded exactly once')
  assert.ok(code.indexOf('mineflayer.createBot(') < code.indexOf('bot.loadPlugin(bambooWalkPlugin)'), 'after createBot')
  assert.match(code, /import \{ bambooWalkPlugin, bambooWalkModeDetail \} from '\.\/bamboowalk\.mjs'/)
}
await t('index.mjs loads the plugin on the bot it creates, after createBot (comment-stripped, executable lines only)', () => wired(INDEX))
await t('MUTANT KILLED: index.mjs with the load line commented out (the comment still names it) fails the wiring check', () => {
  const line = '  bot.loadPlugin(bambooWalkPlugin)\n'
  assert.strictEqual(INDEX.split(line).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wired(INDEX.replace(line, '  // bot.loadPlugin(bambooWalkPlugin)\n')), assert.AssertionError)
})

// ---- 4. THE CHAIN on board-d's live grove --------------------------------------------------------------------------------------
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/bamboowalk-boardd-1103.json', import.meta.url), 'utf8'))
const cells = (() => {
  const [ox, oy, oz] = FX.origin; const [sx, sy, sz] = FX.size; const m = new Map(); let i = 0
  for (let r = 0; r < FX.rle.length; r += 2) {
    for (let n = 0; n < FX.rle[r + 1]; n++, i++) {
      const x = ox + (i % sx), z = oz + (Math.floor(i / sx) % sz), y = oy + Math.floor(i / (sx * sz))
      m.set(`${x},${y},${z}`, FX.palette[FX.rle[r]])
    }
  }
  assert.strictEqual(i, sx * sy * sz, 'the fixture decodes to its whole box')
  return m
})()
const stateOf = s => {
  const [n, props] = s.split('['); const b = mcData.blocksByName[n]
  if (!b) throw new Error(`unknown block ${n}`)
  if (!props || !b.states?.length) return b.defaultState
  const want = Object.fromEntries(props.slice(0, -1).split(',').map(kv => kv.split('=')))
  let id = 0, mul = 1
  for (let k = b.states.length - 1; k >= 0; k--) {
    const st = b.states[k]; const v = want[st.name]
    const idx = v == null ? 0 : st.type === 'bool' ? (v === 'true' ? 0 : 1) : st.type === 'int' ? st.values?.indexOf(v) ?? Number(v) : st.values.indexOf(v)
    id += Math.max(0, idx) * mul; mul *= st.num_values
  }
  return b.minStateId + id
}
const rawAt = (x, y, z) => {
  const s = cells.get(`${x},${y},${z}`) ?? 'stone'
  const b = Block.fromStateId(stateOf(s), 0); b.position = new Vec3(x, y, z); return b
}
const worldOf = fix => ({ getBlock: p => { const b = rawAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return fix ? fix(b) : b } })
await t('the fixture is the wedge: gravel 338,70,113 under a slot between bamboo 337,71,113 and 339,71,113; air at 338,70,114', () => {
  assert.strictEqual(cells.get('338,70,113'), 'gravel')
  assert.match(cells.get('337,71,113'), /^bamboo/); assert.match(cells.get('339,71,113'), /^bamboo/)
  assert.strictEqual(cells.get('338,71,113'), 'air'); assert.strictEqual(cells.get('338,70,114'), 'air')
})
const AABB = (p) => ({ x0: p.x - 0.3, y0: p.y, z0: p.z - 0.3, x1: p.x + 0.3, y1: p.y + 1.8, z1: p.z + 0.3 })
const hits = (w, bb) => {
  const out = []
  for (let y = Math.floor(bb.y0) - 1; y <= Math.floor(bb.y1); y++) for (let z = Math.floor(bb.z0); z <= Math.floor(bb.z1); z++) for (let x = Math.floor(bb.x0); x <= Math.floor(bb.x1); x++) {
    const b = w.getBlock({ x, y, z })
    for (const s of b.shapes ?? []) {
      if (x + s[0] < bb.x1 && x + s[3] > bb.x0 && y + s[1] < bb.y1 - 1e-7 && y + s[4] > bb.y0 + 1e-7 && z + s[2] < bb.z1 && z + s[5] > bb.z0) out.push(`${x},${y},${z}#${s.join(':')}`)
    }
  }
  return out
}
/**
 * The client walks with prismarine-physics on `client`; the SERVER (true shapes) refuses a move whose box meets anything the old
 * box did not (Paper: isPlayerCollidingWithAnythingNew -> teleport back, velocity zeroed). -> { pos, refused, ticks }.
 */
function walk (client, start, target, ticks = 60) {
  const server = worldOf(b => BW.fixBlock(b))
  const physics = Physics(mcData, client)
  const bot = { version: '1.21.8', jumpTicks: 0, jumpQueued: false, inventory: { slots: [] },
    entity: { position: new Vec3(...start), velocity: new Vec3(0, 0, 0), onGround: true, effects: {}, attributes: {}, yaw: 0, pitch: 0 } }
  let refused = 0, n = 0
  for (; n < ticks; n++) {
    const p = bot.entity.position
    if (Math.hypot(target[0] - p.x, target[2] - p.z) < 0.15) break
    bot.entity.yaw = Math.atan2(-(target[0] - p.x), -(target[2] - p.z))   // prismarine yaw: 0 = -z, -pi/2 = +x
    const st = new PlayerState(bot, { forward: true, back: false, left: false, right: false, jump: false, sprint: false, sneak: false })
    physics.simulatePlayer(st, client)
    const before = new Set(hits(server, AABB(p)))
    const fresh = hits(server, AABB(st.pos)).filter(h => !before.has(h))
    if (fresh.length) { refused++; bot.entity.velocity = new Vec3(0, 0, 0); continue }
    st.apply(bot)
  }
  return { pos: bot.entity.position, refused, ticks: n }
}
const START = [338.0, 71, 114.0], SLOT = [338.5, 71, 113.5]
await t('BASE (the baked post): from the wedge toward the slot every move is refused by the server and the body never leaves -- the live 71', () => {
  const r = walk(worldOf(null), START, SLOT)
  if (process.env.BW_DEBUG) console.log('        base', r.refused, 'refused,', r.ticks, 'ticks, at', r.pos.toString())
  assert.ok(r.refused >= 50, `refused ${r.refused}`)
  assert.ok(Math.hypot(r.pos.x - START[0], r.pos.z - START[2]) < 0.05, `moved to ${r.pos}`)
})
const chain = M => {
  const r = walk(worldOf(b => M.fixBlock(b)), START, SLOT)
  if (process.env.BW_DEBUG) console.log('        cand', r.refused, 'refused,', r.ticks, 'ticks, at', r.pos.toString())
  assert.strictEqual(r.refused, 0, `refused ${r.refused}: the client and the server disagree`)
  assert.ok(Math.hypot(r.pos.x - SLOT[0], r.pos.z - SLOT[2]) < 0.15, `ended ${r.pos} after ${r.ticks} ticks`)
}
await t('CANDIDATE (the server\'s post): the body slides round (337,71,113)\'s post and reaches the slot, no move refused', () => chain(BW))
await t('MUTANT KILLED: fixBlock that leaves the shapes as read (the base) re-wedges the walk', () => killedBy('if (s) b.shapes = s', 'if (s) void s', chain))
await t('MUTANT KILLED: the post moved the wrong way (baked minus true) re-wedges the walk', () => killedBy('v = [tx - bx, tz - bz]', 'v = [bx - tx, bz - tz]', chain))
await t('every bamboo in the grove: candidate client and server agree on each post (the same boxes), base disagrees on almost all', () => {
  let n = 0, baseSame = 0
  for (const [k, s] of cells) {
    if (!s.startsWith('bamboo')) continue
    const [x, y, z] = k.split(',').map(Number); n++
    const srv = BW.fixBlock(rawAt(x, y, z)).shapes
    assert.deepStrictEqual(worldOf(b => BW.fixBlock(b)).getBlock({ x, y, z }).shapes, srv)
    if (JSON.stringify(rawAt(x, y, z).shapes) === JSON.stringify(srv)) baseSame++
  }
  assert.ok(n > 50, `bamboo cells in the fixture: ${n}`)
  assert.ok(baseSame < n / 10, `base agrees on ${baseSame} of ${n}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
