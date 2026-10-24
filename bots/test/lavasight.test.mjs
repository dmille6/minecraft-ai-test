// LAVASIGHT-01 (lavasight.mjs; index.mjs wiring; docs/reports/lavasight-01-design-2026-10-24.md).
//
// What is held here, by behaviour:
//   1. THE BINDING: a file binds to one world by the login packet's hashedSeed, recomputed from the file's seed STRING;
//      the three live pairs read off _plinth_mode rows are the positive control.
//   2. THE FILE: every state fails open; stale is judged on every refresh, not only on a new file.
//   3. THE FOOTPRINT IS THE GUARD'S: for every feet cell around a lava cell, on synthetic worlds with occlusion and drops,
//      the core price is set iff lavaguard.corridorSafe refuses that sample -- the guard itself is the oracle.
//   4. NEVER A WALL: on the INSTALLED pathfinder's own move generators, the wrapped profile yields exactly the base's
//      neighbour set (same cells, same order), with costs only raised; a filtering mutant is caught.
//   5. ROUTES: a real A* plans the detour the guard accepts where the base plans the edge the guard refuses; with no
//      detour it still plans (no dead end); a bot standing beside lava gets a path out.
//   6. SCOPE: no price while a reflex holds the body; eating does not hold it.
// Mutants assert their anchor present and unique (withMutant, as climb-escape.test.mjs).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const LS = await import('../src/lavasight.mjs')
const { corridorSafe } = await import('../src/lavaguard.mjs')
const LS_URL = new URL('../src/lavasight.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ------------------------------------------------------------------ 1. the binding
await t('hashedSeedOf reproduces the three live login seeds (board-a, placebo-a, hive-c _plinth_mode rows, 10-24)', () => {
  assert.equal(LS.hashedSeedOf('1239381899'), '-1909043226:-504800724')
  assert.equal(LS.hashedSeedOf('8948499624371160708'), '174057850:195548254')
  assert.equal(LS.hashedSeedOf('4394143238757369828'), '-23873500:595148475')
})
await t('hashedSeedOf refuses a number (a 64-bit seed does not survive one) and junk', () => {
  assert.equal(LS.hashedSeedOf(1239381899), null)
  assert.equal(LS.hashedSeedOf('12x'), null)
  assert.equal(LS.hashedSeedOf('99999999999999999999'), null, 'out of int64')
  assert.ok(LS.hashedSeedOf('-9223372036854775808'), 'int64 min is a seed')
  // a negative seed: the same bytes Python's struct.pack('<q') hashes (Claude design r1)
  assert.equal(LS.hashedSeedOf('-1'), (() => { const h = require_('node:crypto').createHash('sha256').update(Buffer.from('ffffffffffffffff', 'hex')).digest(); return `${h.readInt32LE(4)}:${h.readInt32LE(0)}` })())
})

// ------------------------------------------------------------------ 2. the file
const NOW = Date.parse('2026-10-24T12:00:00Z')
const W_A = '-1909043226:-504800724'
const file = (o = {}) => ({ schema: 'mcai.lavamap', schema_version: 1, world: 'board-a', seed: '1239381899',
  generated_at: '2026-10-24T08:56:43Z', stale_after: '2026-10-25T20:56:43Z', cells: [[396, 69, 109], [335, 35, 205]], ...o })
await t('parseLavaMap: ok binds world, label and clock; every other state carries NO cells (fail open)', () => {
  const ok = LS.parseLavaMap(file(), { worldId: W_A, pool: 'board-a', now: NOW })
  assert.equal(ok.state, 'ok'); assert.equal(ok.cells.length, 2)
  const cases = [
    [null, {}, 'absent'],
    [[], {}, 'bad_schema'],
    [file({ schema: 'mcai.hazardmap' }), {}, 'bad_schema'],
    [file({ schema_version: 2 }), {}, 'bad_schema'],
    [file({ seed: 1239381899 }), {}, 'bad_schema'],
    [file(), { worldId: '174057850:195548254' }, 'world_mismatch'],
    [file(), { worldId: '' }, 'world_unknown'],
    [file(), { pool: 'board-d' }, 'world_label'],
    [file({ stale_after: '2026-10-24T11:59:59Z' }), {}, 'stale'],
    [file({ stale_after: 'soon' }), {}, 'bad_schema'],
    [file({ cells: 'x' }), {}, 'bad_schema'],
  ]
  for (const [raw, o, want] of cases) {
    const r = LS.parseLavaMap(raw, { worldId: W_A, pool: 'board-a', now: NOW, ...o })
    assert.equal(r.state, want, JSON.stringify(o) + ' ' + JSON.stringify(raw)?.slice(0, 80))
    assert.equal(r.cells.length, 0, `${want} must carry no cells`)
  }
})
await t('parseLavaMap: bad cells are dropped and named, duplicates once, the cap holds', () => {
  const cells = [[1, 2, 3], [1, 2, 3], [1.5, 2, 3], ['a', 2, 3], [1, 999, 3]]
  for (let i = 0; i < LS.MAX_CELLS + 10; i++) cells.push([i, 60, 0])
  const r = LS.parseLavaMap(file({ cells }), { worldId: W_A, pool: 'board-a', now: NOW })
  assert.equal(r.state, 'ok')
  assert.equal(r.cells.length, LS.MAX_CELLS)
  assert.ok(r.bad.includes('cell2') && r.bad.includes('cell3') && r.bad.includes('cell4'))
  assert.ok(r.bad.includes(`over_${LS.MAX_CELLS}`))
})
await t('the reader: absent -> ok -> stale WITHOUT a new file; a broken rewrite fails open at once (no last-good)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lavasight-'))
  const f = path.join(dir, LS.LAVAMAP_FILE)
  let now = NOW
  const states = []
  const rd = LS.lavaMapReader({ file: () => f, worldId: () => W_A, pool: () => 'board-a', now: () => now, onChange: s => states.push(s.state) })
  rd.refresh(); assert.equal(rd.state(), 'absent')
  writeFileSync(f, JSON.stringify(file())); rd.refresh(); assert.equal(rd.state(), 'ok'); assert.equal(rd.map().cells.length, 2)
  now = Date.parse('2026-10-25T21:00:00Z'); rd.refresh()
  assert.equal(rd.state(), 'stale', 'the same bytes go stale on the clock'); assert.equal(rd.map().cells.length, 0)
  now = NOW
  writeFileSync(f, '{"schema": "mcai.lavamap", trunc'); utimesSync(f, new Date(NOW / 1000 + 5), new Date(NOW / 1000 + 5) / 1)
  rd.refresh(); assert.equal(rd.state(), 'unreadable'); assert.equal(rd.map().cells.length, 0, 'fail open, not the last good copy')
  assert.deepEqual(states, ['absent', 'ok', 'stale', 'unreadable'])
})

// ------------------------------------------------------------------ 3. the footprint is the guard's
function makeWorld ({ floor = 60, lava = [], air = [], stone = [] } = {}) {
  const key = (x, y, z) => `${x},${y},${z}`
  const L = new Set(lava.map(c => key(...c))), A = new Set(air.map(c => key(...c))), S = new Set(stone.map(c => key(...c)))
  const nameAt = (x, y, z) => { const k = key(x, y, z); if (L.has(k)) return 'lava'; if (S.has(k)) return 'stone'; if (A.has(k)) return 'air'; return y <= floor ? 'stone' : 'air' }
  const at = (x, y, z) => { const n = nameAt(x, y, z); return { name: n, boundingBox: n === 'stone' ? 'block' : 'empty' } }
  const solidAt = (x, y, z) => nameAt(x, y, z) === 'stone'
  return { at, solidAt, nameAt }
}
function rng (seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }
function guardRefusesAt (at, F) { return !corridorSafe(at, [F, F]).safe }

await t('CORE == the corridor guard\'s refusal, cell by cell, on 60 synthetic worlds (occlusion, buried lava, pits, drops)', () => {
  const r = rng(7)
  let cells = 0, core = 0
  for (let w = 0; w < 60; w++) {
    const Lx = 0, Lz = 0, Ly = 50 + Math.floor(r() * 11)          // from 10 under the floor to the floor itself
    const air = [], stone = []
    // noise: carve pits and caves, drop slabs, around the lava cell
    for (let i = 0; i < 60; i++) {
      const c = [Math.floor(r() * 11) - 5, Ly - 2 + Math.floor(r() * 16), Math.floor(r() * 11) - 5]
      ;(r() < 0.6 ? air : stone).push(c)
    }
    // a guaranteed open shaft over the lava in half the worlds (the drop case)
    if (w % 2) for (let y = Ly + 1; y <= 61; y++) air.push([Lx + (w % 4 === 1 ? 0 : 1), y, Lz])
    const world = makeWorld({ floor: 60, lava: [[Lx, Ly, Lz]], air, stone })
    const idx = LS.buildPriceIndex([{ x: Lx, y: Ly, z: Lz }], world.solidAt)
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = Ly - 2; y <= Ly + 14; y++) {
      const g = guardRefusesAt(world.at, { x, y, z })
      const p = idx.has(LS.packKey(x, y, z))
      cells++; if (p) core++
      assert.equal(p, g, `world ${w} lava ${Lx},${Ly},${Lz}: feet ${x},${y},${z} guard=${g} core=${p}`)
    }
  }
  assert.ok(core > 1000 && core < cells / 2, `positive control: core ${core} of ${cells}`)
})
await t('MUTANT KILLED: dropping the occlusion test (lava under a roof priced) breaks the equivalence', async () => {
  await withMutant(LS_URL, '    if (!open(x, z, y + k - 1, y + 1)) break\n    for (let dx = -1;', '    for (let dx = -1;', async mod => {
    const world = makeWorld({ floor: 60, lava: [[0, 57, 0]] })
    const idx = mod.buildPriceIndex([{ x: 0, y: 57, z: 0 }], world.solidAt)
    assert.equal(guardRefusesAt(world.at, { x: 0, y: 59, z: 0 }), false, 'the guard accepts: a roof at 58 stops the scan')
    assert.equal(idx.has(mod.packKey(0, 59, 0)), true, 'the mutant prices it anyway')
  })
})
await t('MUTANT KILLED: dropping the 12-deep drop column misses a pit over lava', async () => {
  await withMutant(LS_URL, '    for (let k = 1; k <= DROP_DY; k++) {', '    for (let k = 1; k <= 0; k++) {', async mod => {
    const air = []; for (let y = 52; y <= 61; y++) air.push([1, y, 0])
    const world = makeWorld({ floor: 60, lava: [[0, 51, 0]], air })
    const idx = mod.buildPriceIndex([{ x: 0, y: 51, z: 0 }], world.solidAt)
    assert.equal(guardRefusesAt(world.at, { x: 1, y: 60, z: 0 }), true, 'the guard refuses: lava beside the drop 9 down')
    assert.equal(idx.has(mod.packKey(1, 60, 0)), false, 'the mutant misses it')
  })
})

// ------------------------------------------------------------------ 4. never a wall
const { Movements } = require_('mineflayer-pathfinder')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)
function pfBot (world, pos = new Vec3(0.5, 61, 0.5), extra = {}) {
  const cache = new Map()
  const blockAt = p => {
    const k = `${p.x},${p.y},${p.z}`
    let b = cache.get(k)
    if (!b) { b = Block.fromStateId(registry.blocksByName[world.nameAt(p.x, p.y, p.z)].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); cache.set(k, b) }
    return b
  }
  return { registry, version: '1.21.8', blockAt, entity: { position: pos, effects: {}, onGround: true }, entities: {},
           inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 }, ...extra }
}
function profile (bot, { canDig = false } = {}) {
  const m = new Movements(bot); m.canDig = canDig; m.allowParkour = false; m.allowSprinting = false; m.placeCost = 5
  m.exclusionAreasStep = [b => (b?.liquid ? 1 : 0)]   // index.mjs's water entry price, so liquids are charged as on the fleet
  return m
}
const poolWorld = () => {
  const lava = []; for (let x = 2; x <= 8; x++) lava.push([x, 60, 1])      // a lava strip in the floor, beside the straight line
  return makeWorld({ floor: 60, lava })
}
await t('NEVER A WALL: the wrapped profile yields the base\'s neighbour set exactly; costs only rise, by 0 or CORE_MOVE', () => {
  const world = poolWorld(), bot = pfBot(world)
  const idx = LS.buildPriceIndex([2, 3, 4, 5, 6, 7, 8].map(x => ({ x, y: 60, z: 1 })), world.solidAt)
  for (const canDig of [false, true]) {
    const base = profile(bot, { canDig }), cand = profile(bot, { canDig })
    const counters = {}
    cand.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null }), counters)
    let priced = 0
    for (let x = -2; x <= 10; x++) for (let z = -3; z <= 4; z++) for (const y of [61, 62]) {
      const node = { x, y, z, remainingBlocks: 4, hash: `${x},${y},${z}` }
      const a = base.getNeighbors(node), b = cand.getNeighbors(node)
      assert.deepEqual(b.map(n => n.hash), a.map(n => n.hash), `node ${x},${y},${z}: the neighbour set moved`)
      for (let i = 0; i < a.length; i++) {
        const d = b[i].cost - a[i].cost
        assert.ok([0, LS.CORE_MOVE].includes(Math.round(d * 1000) / 1000), `cost diff ${d}`)
        if (d > 0) priced++
      }
    }
    assert.ok(priced > 20, `positive control: ${priced} moves priced`)
    assert.equal(counters.set_changed ?? 0, 0)
  }
})
await t('MUTANT KILLED: a wrapper that drops priced moves (a wall) is caught by the set test and by set_changed (G3)', async () => {
  await withMutant(LS_URL, '      ns[i].cost += s\n', '      ns[i].cost += s; if (s === CORE_MOVE) { ns.splice(i, 1); i-- }\n', async mod => {
    const world = poolWorld(), bot = pfBot(world)
    const idx = mod.buildPriceIndex([{ x: 4, y: 60, z: 1 }], world.solidAt)
    const counters = {}
    const cand = profile(bot); cand.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null }), counters)
    const base = profile(bot)
    const node = { x: 3, y: 61, z: 0, remainingBlocks: 0, hash: '3,61,0' }
    assert.notEqual(cand.getNeighbors(node).length, base.getNeighbors(node).length, 'the mutant deletes moves')
    assert.ok(counters.set_changed > 0, 'and G3 sees it')
  })
})

await t('THE MOVE IS PRICED IFF THE GUARD WOULD REFUSE IT (either node form), over every neighbour on 20 noisy worlds', () => {
  const r = rng(11)
  let moves = 0, priced = 0
  for (let w = 0; w < 20; w++) {
    const lava = [[Math.floor(r() * 5) - 2, 57 + Math.floor(r() * 4), Math.floor(r() * 5) - 2]]
    const air = [], stone = []
    for (let i = 0; i < 40; i++) (r() < 0.5 ? air : stone).push([Math.floor(r() * 13) - 6, 58 + Math.floor(r() * 5), Math.floor(r() * 13) - 6])
    const world = makeWorld({ floor: 60, lava, air, stone })
    const idx = LS.buildPriceIndex(lava.map(([x, y, z]) => ({ x, y, z })), world.solidAt)
    const m = profile(pfBot(world), { canDig: true })
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (const y of [59, 60, 61, 62]) {
      for (const n of m.getNeighbors({ x, y, z, remainingBlocks: 2, hash: `${x},${y},${z}` })) {
        const g = !corridorSafe(world.at, [{ x, y, z }, { x: n.x, y: n.y, z: n.z }]).safe ||
                  !corridorSafe(world.at, [{ x: x + 0.5, y, z: z + 0.5 }, { x: n.x + 0.5, y: n.y, z: n.z + 0.5 }]).safe
        const p = LS.moveSurcharge(idx, { x, y, z }, n) > 0
        moves++; if (p) priced++
        assert.equal(p, g, `world ${w}: move ${x},${y},${z} -> ${n.hash} guard=${g} priced=${p}`)
      }
    }
  }
  assert.ok(priced > 100 && priced < moves, `positive control: ${priced} of ${moves} moves priced`)
})
// ------------------------------------------------------------------ 5. routes on a real A*
const AStar = require_('mineflayer-pathfinder/lib/astar.js')
const Move = require_('mineflayer-pathfinder/lib/move.js')
const { goals } = require_('mineflayer-pathfinder')
function plan (m, from, goal) {
  const a = new AStar(new Move(from.x, from.y, from.z, 0, 0), m, goal, 5000, 5000, -1)
  let r = a.compute(); while (r.status === 'partial') r = a.compute()
  return r
}
const nodesOf = (from, r) => [{ x: from.x, y: from.y, z: from.z }, ...r.path.map(n => ({ x: n.x, y: n.y, z: n.z }))]
await t('ROUTE: the base plans the pool edge the guard refuses; the candidate plans a detour the guard accepts', () => {
  const world = poolWorld(), bot = pfBot(world)
  const from = { x: 0, y: 61, z: 0 }, goal = new goals.GoalBlock(10, 61, 0)
  const base = profile(bot)
  const rb = plan(base, from, goal)
  assert.equal(rb.status, 'success')
  assert.equal(corridorSafe(world.at, nodesOf(from, rb)).safe, false, 'positive control: the base route is refused by the guard')
  const idx = LS.buildPriceIndex([2, 3, 4, 5, 6, 7, 8].map(x => ({ x, y: 60, z: 1 })), world.solidAt)
  const cand = profile(bot); cand.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null }), {})
  const rc = plan(cand, from, goal)
  assert.equal(rc.status, 'success')
  assert.equal(corridorSafe(world.at, nodesOf(from, rc)).safe, true, 'the candidate route passes the guard')
})
await t('ROUTE, NO DETOUR: a sealed 1-wide tunnel beside lava -- the candidate still plans the only way (no dead end)', () => {
  // solid rock to y 62; the tunnel is (0..10, 61..62, 0); lava sits in the tunnel's side wall at (2..8, 61, 1)
  const lava = [], air = []
  for (let x = 0; x <= 10; x++) air.push([x, 61, 0], [x, 62, 0])
  for (let x = 2; x <= 8; x++) lava.push([x, 61, 1])
  const world = makeWorld({ floor: 62, lava, air })
  const bot = pfBot(world)
  const from = { x: 0, y: 61, z: 0 }, goal = new goals.GoalBlock(10, 61, 0)
  const idx = LS.buildPriceIndex(lava.map(([x, y, z]) => ({ x, y, z })), world.solidAt)
  const rb = plan(profile(bot), from, goal)
  const cand = profile(bot); cand.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null }), {})
  const rc = plan(cand, from, goal)
  assert.equal(rb.status, 'success'); assert.equal(rc.status, 'success', 'the candidate is never worse at reaching the goal')
  assert.deepEqual(rc.path.map(n => n.hash), rb.path.map(n => n.hash), 'the only way, the same way')
  assert.ok(rc.cost > rb.cost, 'positive control: the candidate did price it')
})
await t('NOPATH IS THE BASE\'S: an unreachable goal is noPath for both, a reachable one reached by both (same graph)', () => {
  // a fenced plot (stone walls 3 high, no digging, no scaffold) makes the search finite
  const stone = []
  for (let x = -5; x <= 13; x++) for (const z of [-5, 6]) for (const y of [61, 62, 63]) stone.push([x, y, z])
  for (let z = -5; z <= 6; z++) for (const x of [-5, 13]) for (const y of [61, 62, 63]) stone.push([x, y, z])
  const lava = []; for (let x = 2; x <= 8; x++) lava.push([x, 60, 1])
  const fenced = makeWorld({ floor: 60, lava, stone })
  const fb = pfBot(fenced)
  const fidx = LS.buildPriceIndex(lava.map(([x, y, z]) => ({ x, y, z })), fenced.solidAt)
  const fw = profile(fb); fw.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx: fidx, live: true, reflex: null }), {})
  const outside = new goals.GoalBlock(20, 61, 0)
  assert.equal(plan(profile(fb), { x: 0, y: 61, z: 0 }, outside).status, 'noPath', 'positive control: the base cannot leave the plot')
  assert.equal(plan(fw, { x: 0, y: 61, z: 0 }, outside).status, 'noPath')
  assert.equal(plan(fw, { x: 0, y: 61, z: 0 }, new goals.GoalBlock(10, 61, 0)).status, 'success')
})
await t('ROUTE, EGRESS: a bot standing on the pool edge gets a path out, and the first step leaves the core', () => {
  const world = poolWorld(), bot = pfBot(world, new Vec3(5.5, 61, 0.5))
  const idx = LS.buildPriceIndex([2, 3, 4, 5, 6, 7, 8].map(x => ({ x, y: 60, z: 1 })), world.solidAt)
  const cand = profile(bot); cand.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null }), {})
  const r = plan(cand, { x: 5, y: 61, z: 0 }, new goals.GoalBlock(5, 61, -8))
  assert.equal(r.status, 'success')
  assert.ok(r.path[0].z < 0, `the first step leaves the edge (to ${r.path[0].hash})`)
})

// ------------------------------------------------------------------ 6. scope
await t('SCOPE: priceLive is off under every body-moving reflex, on while eating, off with LAVASIGHT=0', () => {
  for (const reflex of ['drown_rescue', 'escape', 'flooded_pocket', 'marooned']) assert.equal(LS.priceLive({ on: true, reflex }), false, reflex)
  assert.equal(LS.priceLive({ on: true, reflex: 'eat' }), true)
  assert.equal(LS.priceLive({ on: true, reflex: null }), true)
  assert.equal(LS.priceLive({ on: false, reflex: null }), false)
  assert.equal(LS.lavasightOn({ LAVASIGHT: '0' }), false); assert.equal(LS.lavasightOn({}), true)
})
await t('SCOPE on the wrapper: a reflex-held search is not priced, and G2 counts what WOULD have been (held_seen), never held_priced', () => {
  const world = poolWorld(), bot = pfBot(world)
  const idx = LS.buildPriceIndex([{ x: 4, y: 60, z: 1 }], world.solidAt)
  const counters = {}
  const reflex = 'drown_rescue'
  const cand = profile(bot); cand.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: LS.priceLive({ on: true, reflex }), reflex }), counters)
  const base = profile(bot)
  const node = { x: 3, y: 61, z: 0, remainingBlocks: 0, hash: '3,61,0' }
  assert.deepEqual(cand.getNeighbors(node).map(n => n.cost), base.getNeighbors(node).map(n => n.cost), 'held: the base costs')
  assert.ok(counters.held_seen > 0, 'positive control: the moves were in the footprint')
  assert.equal(counters.held_priced ?? 0, 0)
})
await t('MUTANT KILLED: a wrapper that ignores live (prices under a reflex) trips G2 (held_priced > 0)', async () => {
  await withMutant(LS_URL, '      if (!c.live) continue\n', '', async mod => {
    const world = poolWorld(), bot = pfBot(world)
    const idx = mod.buildPriceIndex([{ x: 4, y: 60, z: 1 }], world.solidAt)
    const counters = {}
    const cand = profile(bot); cand.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: false, reflex: 'escape' }), counters)
    cand.getNeighbors({ x: 3, y: 61, z: 0, remainingBlocks: 0, hash: '3,61,0' })
    assert.ok(counters.held_priced > 0)
  })
})

// ------------------------------------------------------------------ live re-read and the ring
await t('liveConfirm: loaded lava active, loaded non-lava removed, unloaded kept inactive, far cells not read', () => {
  const read = (x, y, z) => (x === 1 ? { name: 'lava' } : x === 2 ? { name: 'cobblestone' } : x === 3 ? null : { name: 'lava' })
  const r = LS.liveConfirm([{ x: 1, y: 60, z: 0 }, { x: 2, y: 60, z: 0 }, { x: 3, y: 60, z: 0 }, { x: 900, y: 60, z: 0 }], read, { x: 0, y: 61, z: 0 })
  assert.deepEqual(r.active.map(c => c.x), [1]); assert.deepEqual(r.removed.map(c => c.x), [2]); assert.deepEqual(r.unloaded.map(c => c.x), [3, 900])
})
await t('SightRing keeps the newest RING_MAX; cellFromDetail parses the guard rows', () => {
  const ring = new LS.SightRing(3)
  for (let i = 0; i < 5; i++) ring.add({ x: i, y: 60, z: 0 })
  assert.deepEqual(ring.cells().map(c => c.x), [2, 3, 4])
  assert.deepEqual(LS.cellFromDetail('lava_corridor: lava beside at 334,35,204 after 95 samples; the leg is refused'), { x: 334, y: 35, z: 204 })
  assert.deepEqual(LS.cellFromDetail('blind_step: lava below at -12,-3,40: the fallback walk is refused'), { x: -12, y: -3, z: 40 })
  assert.equal(LS.cellFromDetail('no cell here'), null)
})
await t('relocationLavaForbidden: the 7x7 (-1..+3) around an active cell; nothing active -> nothing forbidden', () => {
  const a = [{ x: 0, y: 60, z: 0 }]
  assert.equal(LS.relocationLavaForbidden(a, 3, 61, -3), true)
  assert.equal(LS.relocationLavaForbidden(a, 4, 61, 0), false)
  assert.equal(LS.relocationLavaForbidden(a, 0, 64, 0), false)
  assert.equal(LS.relocationLavaForbidden([], 0, 61, 0), false)
})

await t('HOMEFIX CHAIN: the composed forbid answers fire as keepout did, lava as `lavasight`; all forbidden -> no target -> home', async () => {
  const KO = await import('../src/keepout.mjs')
  const RL = await import('../src/relocate.mjs')
  const fire = [{ kind: 'death:fire', x: 100, y: 60, z: 100, count: 1, weight: 1, last: Date.now() }]
  assert.equal(LS.composeRelocationForbid([], [], KO.relocationForbidden), null, 'nothing to forbid: the base rule (no forbid passed)')
  const onlyFire = LS.composeRelocationForbid(fire, [], KO.relocationForbidden)
  for (const [x, y, z] of [[100, 61, 100], [104, 66, 100], [120, 61, 100], [100, 80, 100]]) {
    assert.equal(!!onlyFire(x, y, z), KO.relocationForbidden(fire, x, y, z), `fire alone at ${x},${y},${z}: the old answer`)
  }
  const both = LS.composeRelocationForbid(fire, [{ x: 0, y: 60, z: 0 }], KO.relocationForbidden)
  assert.equal(both(1, 61, 1), 'lavasight'); assert.equal(both(30, 61, 30), false)
  // the chain: a flat dry world whose every candidate is beside live lava -> no_dry_target (the watchdog's fallback is home)
  const read = (x, y) => ({ name: y <= 60 ? 'stone' : 'air', boundingBox: y <= 60 ? 'block' : 'empty' })
  const lavaEverywhere = []; for (let x = -75; x <= 75; x += 3) for (let z = -75; z <= 75; z += 3) lavaEverywhere.push({ x, y: 60, z })
  const f = LS.composeRelocationForbid([], lavaEverywhere, KO.relocationForbidden)
  const pick = RL.pickRelocationTarget({ p: { x: 0.5, y: 61, z: 0.5 }, read, forbid: f })
  assert.equal(pick.ok, false); assert.equal(pick.why, 'no_dry_target')
  assert.ok(pick.reasons.lavasight > 0, `named in the reasons: ${JSON.stringify(pick.reasons)}`)
  const free = RL.pickRelocationTarget({ p: { x: 0.5, y: 61, z: 0.5 }, read, forbid: LS.composeRelocationForbid([], [{ x: 0, y: 60, z: 0 }], KO.relocationForbidden) })
  assert.equal(free.ok, true, 'positive control: one lava cell leaves targets')
})

await t('COMPOSTER: its clone calls the BASE profile\'s generator (the wrapper), not the prototype\'s (behaviour)', async () => {
  const C = await import('../src/composter.mjs')
  const proto = { getNeighbors () { return [{ hash: 'proto' }] } }
  const base = Object.create(proto); base.getNeighbors = function () { return [{ hash: 'wrapped' }] }
  assert.deepEqual(C.composterSafeMovements(base, () => true).getNeighbors({}).map(n => n.hash), ['wrapped'])
  const plain = Object.create(proto)
  assert.deepEqual(C.composterSafeMovements(plain, () => true).getNeighbors({}).map(n => n.hash), ['proto'], 'no wrapper: the base behaviour')
})

// WIRED (structural: behaviour cannot reach index.mjs's spawn handler without a server). Comments stripped; each anchor is the
// executable line, present and unique, and a mutant shows the assertion can fail.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const INDEX = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
const SKILLS = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
const wiredOrder = src => {
  const s = strip(src)
  const w = s.indexOf('moves.getNeighbors = wrapNeighbors(Movements.prototype.getNeighbors, () => {')
  const clones = ['const gatherMoves = Object.create(', 'const ascendMoves = Object.create(', 'const descendMoves = Object.create(', 'const waterMoves = Object.create(']
    .map(c => s.indexOf(c))
  return w > 0 && clones.every(c => c > w) && /return \{ idx: lsIdx, live: priceLive\(\{ on: LS_ON, reflex \}\), reflex \}/.test(s) &&
         /const reflex = stopReflexes\?\.activeReflex\?\.\(\) \?\? null/.test(s)
}
await t('WIRED: the wrapper is installed on the walk profile BEFORE every clone, gated on the reflex; MUTANT KILLED when moved after', () => {
  assert.equal(wiredOrder(INDEX), true)
  const anchor = '    if (LS_ON) {\n      moves.getNeighbors = wrapNeighbors('
  assert.ok(INDEX.split(anchor).length === 2, 'ANCHOR MISSING or not unique')
  const moved = INDEX.replace(anchor, '    if (LS_ON) {\n      const _x = wrapNeighbors(')
  assert.equal(wiredOrder(moved), false)
})
await t('WIRED: the corridor hook counts and rings; the blind step rings lava only; the rows exist', () => {
  const s = strip(INDEX)
  assert.match(s, /lsCounters\.corridor_checks = \(lsCounters\.corridor_checks \?\? 0\) \+ 1/)
  assert.match(s, /if \(\/lava\/\.test\(v\.why \?\? ''\) && !\/unknown\/\.test\(v\.why \?\? ''\) && Array\.isArray\(v\.at\)\) bot\.lavasightNote\(/)
  assert.match(s, /kind: 'lavasight_route'/); assert.match(s, /kind: 'lavasight'/); assert.match(s, /kind: 'lavasight_mode'/)
  assert.match(strip(SKILLS), /if \(\/lava\/\.test\(v\.why \?\? ''\) && !\/unknown\/\.test\(v\.why \?\? ''\) && Array\.isArray\(v\.at\)\) bot\.lavasightNote\?\.\(/)
})

console.log(`\nlavasight: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
