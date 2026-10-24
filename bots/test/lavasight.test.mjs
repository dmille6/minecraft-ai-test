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
import { EventEmitter } from 'node:events'
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
const { Movements, pathfinder, goals } = require_('mineflayer-pathfinder')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)
// ONE WORLD for the guard, the index and the pathfinder: prismarine blocks (name, boundingBox, shapes); `unknown` cells read null
function makeWorld ({ floor = 60, lava = [], air = [], stone = [], slab = [], carpet = [], water = [], unknown = [] } = {}) {
  const key = (x, y, z) => `${x},${y},${z}`
  const sets = [['lava', lava], ['smooth_stone_slab', slab], ['white_carpet', carpet], ['water', water], ['stone', stone], ['air', air]]
    .map(([n, l]) => [n, new Set(l.map(c => key(...c)))])
  const U = new Set(unknown.map(c => key(...c)))
  const nameAt = (x, y, z) => { const k = key(x, y, z); for (const [n, S] of sets) if (S.has(k)) return n; return y <= floor ? 'stone' : 'air' }
  const cache = new Map()
  const at = (x, y, z) => {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z)
    const k = key(x, y, z)
    if (U.has(k)) return null
    let b = cache.get(k)
    if (!b) { b = Block.fromStateId(registry.blocksByName[nameAt(x, y, z)].defaultState, 0); b.position = new Vec3(x, y, z); cache.set(k, b) }
    return b
  }
  const solidAt = (x, y, z) => { const b = at(x, y, z); return b == null ? null : b.boundingBox === 'block' }
  return { at, solidAt, nameAt }
}
function rng (seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }
// a refusal BECAUSE OF LAVA (an unknown cell is refused for being unknown: not this design's business)
const lavaRefused = (at, nodes) => { const v = corridorSafe(at, nodes); return !v.safe && !/unknown/.test(v.why) }
function guardRefusesAt (at, F) { return lavaRefused(at, [F, F]) }

await t('CORE == the corridor guard\'s lava refusal, cell by cell, on 80 synthetic worlds (occlusion, buried lava, pits, drops, unknown cells)', () => {
  const r = rng(7)
  let cells = 0, core = 0
  for (let w = 0; w < 80; w++) {
    const Lx = 0, Lz = 0, Ly = 50 + Math.floor(r() * 11)          // from 10 under the floor to the floor itself
    const air = [], stone = [], unknown = []
    for (let i = 0; i < 60; i++) {
      const c = [Math.floor(r() * 11) - 5, Ly - 2 + Math.floor(r() * 16), Math.floor(r() * 11) - 5]
      ;(r() < 0.6 ? air : stone).push(c)
    }
    if (w % 2) for (let y = Ly + 1; y <= 61; y++) air.push([Lx + (w % 4 === 1 ? 0 : 1), y, Lz])
    if (w % 5 === 0) for (let i = 0; i < 12; i++) unknown.push([Math.floor(r() * 5) - 2, Ly + 1 + Math.floor(r() * 10), Math.floor(r() * 5) - 2])
    const world = makeWorld({ floor: 60, lava: [[Lx, Ly, Lz]], air, stone, unknown })
    const idx = LS.buildPriceIndex([{ x: Lx, y: Ly, z: Lz }], world.solidAt)
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = Ly - 2; y <= Ly + 14; y++) {
      const g = guardRefusesAt(world.at, { x, y, z })
      const p = idx.has(LS.packKey(x, y, z))
      cells++; if (p) core++
      // with unknown cells about, the guard can refuse a cell for the unknown before it reaches the lava, so the oracle is
      // two implications: every lava refusal is in the core, and every core cell is one the guard refuses (for any reason)
      if (unknown.length) {
        if (g) assert.ok(p, `world ${w}: feet ${x},${y},${z} refused for lava but not in the core`)
        if (p) assert.ok(!corridorSafe(world.at, [{ x, y, z }, { x, y, z }]).safe, `world ${w}: feet ${x},${y},${z} in the core but the guard accepts it`)
      } else assert.equal(p, g, `world ${w} lava ${Lx},${Ly},${Lz}: feet ${x},${y},${z} guard=${g} core=${p}`)
    }
  }
  assert.ok(core > 1000 && core < cells / 2, `positive control: core ${core} of ${cells}`)
})
await t('MUTANT KILLED: dropping the occlusion test (lava under a roof priced) breaks the equivalence', async () => {
  await withMutant(LS_URL, '  const upL = openUp(x, z)\n', '  const upL = DROP_DY\n', async mod => {
    const world = makeWorld({ floor: 60, lava: [[0, 57, 0]] })
    const idx = mod.buildPriceIndex([{ x: 0, y: 57, z: 0 }], world.solidAt)
    assert.equal(guardRefusesAt(world.at, { x: 0, y: 59, z: 0 }), false, 'the guard accepts: a roof at 58 stops the scan')
    assert.equal(idx.has(mod.packKey(0, 59, 0)), true, 'the mutant prices it anyway')
  })
})
await t('MUTANT KILLED: dropping the 12-deep drop column misses a pit over lava', async () => {
  await withMutant(LS_URL, '    for (let k = 1; k <= DROP_DY && k - 1 <= up; k++) emit(', '    for (let k = 1; k <= 0 && k - 1 <= up; k++) emit(', async mod => {
    const air = []; for (let y = 52; y <= 61; y++) air.push([1, y, 0])
    const world = makeWorld({ floor: 60, lava: [[0, 51, 0]], air })
    const idx = mod.buildPriceIndex([{ x: 0, y: 51, z: 0 }], world.solidAt)
    assert.equal(guardRefusesAt(world.at, { x: 1, y: 60, z: 0 }), true, 'the guard refuses: lava beside the drop 9 down')
    assert.equal(idx.has(mod.packKey(1, 60, 0)), false, 'the mutant misses it')
  })
})
await t('MUTANT KILLED: treating an unknown cell as open prices a drop the guard stops safe at (Codex r2 P2)', async () => {
  const air = []; for (let y = 1; y <= 12; y++) air.push([0, y, 0])
  const world = makeWorld({ floor: 0, lava: [[0, 0, 0]], air, unknown: [[0, 6, 0]] })
  assert.equal(guardRefusesAt(world.at, { x: 0, y: 10, z: 0 }), false, 'positive control: the guard stops at the unknown cell 4 down, safe')
  assert.equal(LS.buildPriceIndex([{ x: 0, y: 0, z: 0 }], world.solidAt).has(LS.packKey(0, 10, 0)), false)
  await withMutant(LS_URL, '  const openUp = (cx, cz) => { let n = 0; while (n < DROP_DY - 1 && solidAt(cx, y + 1 + n, cz) === false) n++; return n }',
    '  const openUp = (cx, cz) => { let n = 0; while (n < DROP_DY - 1 && solidAt(cx, y + 1 + n, cz) !== true) n++; return n }', async mod => {
      assert.equal(mod.buildPriceIndex([{ x: 0, y: 0, z: 0 }], world.solidAt).has(mod.packKey(0, 10, 0)), true, 'the mutant prices it')
    })
})

// ------------------------------------------------------------------ 4. the REAL pathfinder: the plugin, postProcessPath included
// A fake bot carrying the installed mineflayer-pathfinder plugin, so getPathFromTo returns exactly the nodes index.mjs's
// corridor hook hands the guard: [floor(bot position), ...result.path] after postProcessPath.
function harness (world, pos = new Vec3(0.5, 61, 0.5)) {
  const bot = new EventEmitter()
  Object.assign(bot, { registry, version: '1.21.8', entity: { position: pos, onGround: true, effects: {}, velocity: new Vec3(0, 0, 0), height: 1.8, width: 0.6 },
    entities: {}, inventory: { items: () => [] }, game: { minY: -64, height: 384 }, world: {} })
  bot.blockAt = p => world.at(p.x, p.y, p.z)
  pathfinder(bot)
  bot.pathfinder.bestHarvestTool = () => null
  const profile = ({ canDig = false } = {}) => {
    const m = new Movements(bot); m.canDig = canDig; m.allowParkour = false; m.allowSprinting = false; m.placeCost = 5
    m.exclusionAreasStep = [b => (b?.liquid ? 1 : 0)]   // index.mjs's water entry price
    return m
  }
  const ids = { water: registry.blocksByName.water.id, ladder: registry.blocksByName.ladder.id, vine: registry.blocksByName.vine.id }
  const env = () => ({ start: { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) },
                       blockAt: (x, y, z) => world.at(x, y, z), ids })
  const wrap = (m, idx, counters = {}, ctx = {}) => { m.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null, env: env(), ...ctx }), counters); return m }
  const plan = (m, goal, searchRadius = -1) => {
    const g = bot.pathfinder.getPathFromTo(m, bot.entity.position, goal, { timeout: 10000, tickTimeout: 10000, searchRadius })
    let v = g.next().value; while (v.result.status === 'partial') v = g.next().value
    return v.result
  }
  const guardNodes = r => { const p = bot.entity.position; return [{ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, ...r.path.map(n => ({ x: n.x, y: n.y, z: n.z }))] }
  return { bot, profile, wrap, plan, guardNodes }
}
const poolWorld = (o = {}) => {
  const lava = []; for (let x = 2; x <= 8; x++) lava.push([x, 60, 1])      // a lava strip in the floor, beside the straight line
  return makeWorld({ floor: 60, lava, ...o })
}
const poolIdx = world => LS.buildPriceIndex([2, 3, 4, 5, 6, 7, 8].map(x => ({ x, y: 60, z: 1 })), world.solidAt)

await t('NEVER A WALL: the wrapped profile yields the base\'s neighbour set exactly; costs only rise, by 0 or CORE_MOVE', () => {
  const world = poolWorld(), H = harness(world), idx = poolIdx(world)
  for (const canDig of [false, true]) {
    const base = H.profile({ canDig }), counters = {}, cand = H.wrap(H.profile({ canDig }), idx, counters)
    let priced = 0
    for (let x = -2; x <= 10; x++) for (let z = -3; z <= 4; z++) for (const y of [61, 62]) {
      const node = { x, y, z, remainingBlocks: 4, hash: `${x},${y},${z}`, toBreak: [], toPlace: [], _lsGen: true }
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
    const world = poolWorld(), H = harness(world)
    const idx = mod.buildPriceIndex([{ x: 4, y: 60, z: 1 }], world.solidAt)
    const counters = {}
    const cand = H.profile(); cand.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null }), counters)
    const node = { x: 3, y: 61, z: 0, remainingBlocks: 0, hash: '3,61,0', toBreak: [], toPlace: [], _lsGen: true }
    assert.notEqual(cand.getNeighbors(node).length, H.profile().getNeighbors(node).length, 'the mutant deletes moves')
    assert.ok(counters.set_changed > 0, 'and G3 sees it')
  })
})

// THE WORLDS for the executed-form tests: slabs and carpets (postProcessPath moves a node onto a partial top: Codex r2 P1),
// water, pits, and lava at and under the floor
function noisyWorld (r) {
  const lava = [], air = [], stone = [], slab = [], carpet = [], water = []
  for (let i = 0; i < 3; i++) lava.push([Math.floor(r() * 9) - 4, 59 + Math.floor(r() * 3), Math.floor(r() * 9) - 4])
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(r() * 17) - 8, z = Math.floor(r() * 17) - 8, u = r()
    if (u < 0.3) slab.push([x, 60, z])
    else if (u < 0.45) carpet.push([x, 61, z])
    else if (u < 0.55) water.push([x, 60, z])
    else if (u < 0.75) air.push([x, 60, z])
    else stone.push([x, 61, z])
  }
  return { world: makeWorld({ floor: 60, lava, air, stone, slab, carpet, water }), lava }
}
const spot = (world, r) => {
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(r() * 13) - 6, z = Math.floor(r() * 13) - 6
    if (world.nameAt(x, 61, z) === 'air' && world.nameAt(x, 62, z) === 'air' && world.solidAt(x, 60, z) && world.nameAt(x, 60, z) === 'stone') return new Vec3(x + 0.5, 61, z + 0.5)
  }
  return null
}
await t('THE MOVE IS PRICED IFF THE GUARD REFUSES IT AS EXECUTED: every segment of real planned paths (slabs, carpets, water, digs)', () => {
  const r = rng(11)
  let segs = 0, priced = 0, planned = 0
  for (let w = 0; w < 40; w++) {
    const { world, lava } = noisyWorld(r)
    const idx = LS.buildPriceIndex(lava.map(([x, y, z]) => ({ x, y, z })), world.solidAt)
    for (let k = 0; k < 6; k++) {
      const pos = spot(world, r); if (!pos) continue
      const H = harness(world, pos)
      const res = H.plan(H.wrap(H.profile({ canDig: k % 2 === 1 }), idx), new goals.GoalNear(Math.floor(r() * 17) - 8, 61, Math.floor(r() * 17) - 8, 1))
      if (!res.path.length) continue
      planned++
      const nodes = H.guardNodes(res)
      for (let i = 0; i < res.path.length; i++) {
        const g = lavaRefused(world.at, [nodes[i], nodes[i + 1]])
        const p = (res.path[i]._lsS ?? 0) > 0
        segs++; if (p) priced++
        assert.equal(p, g, `world ${w} path ${k}: segment ${JSON.stringify(nodes[i])} -> ${JSON.stringify(nodes[i + 1])} guard=${g} priced=${p}`)
      }
    }
  }
  assert.ok(planned >= 100 && priced > 10 && priced < segs, `positive control: ${priced} of ${segs} executed segments priced, ${planned} paths`)
})
await t('A SLAB FLOOR: the guard floors a node on a bottom slab a cell lower, and the move is priced for it (Codex r2 P1, r3 P2)', async () => {
  // a sealed slab corridor (rock to y 62; air at y 61-62; slabs at y 60) with lava BURIED at (2,60,2): a guard sample at the
  // slab's own level (y 60, the floor of 60.5) has it beside within 2 and refuses; a sample at y 61 (the raw cell) does not
  const air = [], slab = []
  for (let x = -1; x <= 6; x++) { air.push([x, 61, 0], [x, 62, 0]); slab.push([x, 60, 0]) }
  const world = makeWorld({ floor: 62, air, slab, lava: [[2, 60, 2]] })
  const H = harness(world, new Vec3(-0.5, 60.5, 0.5))
  const idx = LS.buildPriceIndex([{ x: 2, y: 60, z: 2 }], world.solidAt)
  const res = H.plan(H.wrap(H.profile(), idx), new goals.GoalBlock(5, 61, 0))
  assert.equal(res.status, 'success')
  const nodes = H.guardNodes(res)
  assert.ok(nodes.slice(1).some(n => n.y === 60.5), 'positive control: postProcessPath put the nodes on the slab tops')
  let refused = 0
  for (let i = 0; i < res.path.length; i++) {
    const g = lavaRefused(world.at, [nodes[i], nodes[i + 1]])
    if (g) refused++
    assert.equal((res.path[i]._lsS ?? 0) > 0, g, `segment ${i}`)
  }
  assert.ok(refused >= 1, `positive control: ${refused} slab segments the guard refuses, each priced`)
  assert.equal(lavaRefused(world.at, [{ x: 2, y: 61, z: 0 }, { x: 2, y: 61, z: 0 }]), false, 'control: the raw cell is accepted (the r2 code priced nothing here)')
  // MUTANT: the raw cell instead of the support top misses every refused slab segment
  await withMutant(LS_URL, '  return { forms: [top], climb: false }\n}', '  return { forms: [{ x: n.x + 0.5, y: n.y, z: n.z + 0.5 }], climb: false }\n}', async mod => {
    const H2 = harness(world, new Vec3(-0.5, 60.5, 0.5))
    const m = H2.profile(); m.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null, env: { start: { x: -1, y: 60, z: 0 }, blockAt: (x, y, z) => world.at(x, y, z), ids: { water: registry.blocksByName.water.id, ladder: registry.blocksByName.ladder.id, vine: registry.blocksByName.vine.id } } }), {})
    const r2 = H2.plan(m, new goals.GoalBlock(5, 61, 0))
    assert.ok(r2.path.every(n => !(n._lsS > 0)), 'the mutant prices none of them')
  })
})
// a ladder column against a wall at (0, 61..64, 0) with an open top room; lava at (2,65,1) beside the top (Codex r3 P1, r4 P1)
function ladderWorld () {
  const ladderBlocks = [], air = []
  for (let y = 61; y <= 66; y++) air.push([0, y, 0])
  for (let y = 61; y <= 64; y++) ladderBlocks.push([0, y, 0])
  for (let x = -2; x <= 3; x++) for (let z = -2; z <= 3; z++) for (let y = 65; y <= 67; y++) air.push([x, y, z])
  const base = makeWorld({ floor: 64, air, lava: [[2, 65, 1]] })
  const lad = new Set(ladderBlocks.map(c => c.join(',')))
  const world = { ...base, at: (x, y, z) => { const k = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`; if (lad.has(k)) { const b = Block.fromStateId(registry.blocksByName.ladder.defaultState, 0); b.position = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)); return b } return base.at(x, y, z) } }
  world.solidAt = (x, y, z) => { const b = world.at(x, y, z); return b == null ? null : b.boundingBox === 'block' }
  return world
}
// the charge of a whole path against the guard's verdict on each executed segment: exact, except that a path ENDING on a
// climbable may under-charge its last segment (never over-charge)
function pathCharges (world, H, res) {
  const nodes = H.guardNodes(res)
  let refused = 0, lastIntoClimbRefused = false
  for (let i = 0; i < res.path.length; i++) {
    const g = lavaRefused(world.at, [nodes[i], nodes[i + 1]])
    if (g) refused++
    if (i === res.path.length - 1) { const b = world.at(res.path[i].x, res.path[i].y, res.path[i].z); lastIntoClimbRefused = g && b?.name === 'ladder' }
  }
  const charged = res.path.reduce((a, n) => a + (n._lsS ?? 0), 0)
  return { refused, charged, lastIntoClimbRefused }
}
await t('A LADDER, UP: a climb past lava beside the ladder\'s top is charged exactly for the segments the guard refuses (Codex r3 P1)', () => {
  const world = ladderWorld(), H = harness(world, new Vec3(0.5, 61, 0.5))
  const idx = LS.buildPriceIndex([{ x: 2, y: 65, z: 1 }], world.solidAt)
  const res = H.plan(H.wrap(H.profile(), idx), new goals.GoalBlock(0, 65, 0))
  assert.equal(res.status, 'success', 'the climb plans')
  const c = pathCharges(world, H, res)
  assert.ok(c.refused >= 1, `positive control: the guard refuses ${c.refused} segment(s) of the climb`)
  assert.equal(c.charged, LS.CORE_MOVE * c.refused, `charged ${c.charged} for ${c.refused} refused segment(s)`)
})
await t('A LADDER, DOWN: a descent the guard accepts costs exactly the base, and a capped search still passes (Codex r4 P1)', () => {
  const world = ladderWorld(), H = harness(world, new Vec3(0.5, 65, 0.5))
  const idx = LS.buildPriceIndex([{ x: 2, y: 65, z: 1 }], world.solidAt)
  const goal = new goals.GoalBlock(0, 63, 0)
  const rb = H.plan(H.profile(), goal), rc = H.plan(H.wrap(H.profile(), idx), goal)
  assert.equal(rb.status, 'success'); assert.equal(rc.status, 'success')
  assert.equal(lavaRefused(world.at, H.guardNodes(rc)), false, 'positive control: the guard accepts the whole descent')
  assert.equal(rc.cost, rb.cost, `an accepted route is never priced (${rc.cost} vs ${rb.cost})`)
  assert.equal(H.plan(H.wrap(H.profile(), idx), goal, 1).status, 'success', 'capped at 1: the candidate passes where the base does')
  assert.equal(H.plan(H.profile(), goal, 1).status, 'success', 'control: the base passes at that cap')
})
await t('MUTANT KILLED: charging a move into a climbable on EITHER form (r4) over-prices the accepted descent', async () => {
  await withMutant(LS_URL, '    own = B0.forms.every(b => hits(from, b)) ? CORE_MOVE : 0\n', '    own = B0.forms.some(b => hits(from, b)) ? CORE_MOVE : 0\n', async mod => {
    const world = ladderWorld(), H = harness(world, new Vec3(0.5, 65, 0.5))
    const idx = mod.buildPriceIndex([{ x: 2, y: 65, z: 1 }], world.solidAt)
    const ids = { water: registry.blocksByName.water.id, ladder: registry.blocksByName.ladder.id, vine: registry.blocksByName.vine.id }
    const m = H.profile(); m.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null, env: { start: { x: 0, y: 65, z: 0 }, blockAt: (x, y, z) => world.at(x, y, z), ids } }), {})
    assert.notEqual(H.plan(m, new goals.GoalBlock(0, 63, 0), 1).status, 'success', 'the mutant walls the capped descent off')
  })
})
await t('MUTANT KILLED: never settling the climbable\'s charge on its child under-prices the refused climb', async () => {
  await withMutant(LS_URL, '    if (inc) settle = Math.max(0, (hits(inc.from, from) ? CORE_MOVE : 0) - inc.charged)\n', '', async mod => {
    const world = ladderWorld(), H = harness(world, new Vec3(0.5, 61, 0.5))
    const idx = mod.buildPriceIndex([{ x: 2, y: 65, z: 1 }], world.solidAt)
    const ids = { water: registry.blocksByName.water.id, ladder: registry.blocksByName.ladder.id, vine: registry.blocksByName.vine.id }
    const m = H.profile(); m.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null, env: { start: { x: 0, y: 61, z: 0 }, blockAt: (x, y, z) => world.at(x, y, z), ids } }), {})
    const res = H.plan(m, new goals.GoalBlock(0, 65, 0))
    const c = pathCharges(world, H, res)
    assert.ok(c.charged < LS.CORE_MOVE * c.refused, `the mutant under-charges (${c.charged} for ${c.refused})`)
  })
})
const Move = require_('mineflayer-pathfinder/lib/move.js')
await t('RESUMED SEARCHES: partial slices (postProcessPath moves the A* nodes in place) charge the final path exactly (Codex r5 P2)', () => {
  // tickTimeout ~0: every compute() yields a partial, which getPathFromTo post-processes IN PLACE before the search resumes
  let sliced = 0
  for (const [world, pos, goal, idxCells] of [
    [ladderWorld(), new Vec3(0.5, 61, 0.5), new goals.GoalBlock(0, 65, 0), [{ x: 2, y: 65, z: 1 }]],
    [poolWorld(), new Vec3(0.5, 61, 0.5), new goals.GoalBlock(10, 61, 0), [2, 3, 4, 5, 6, 7, 8].map(x => ({ x, y: 60, z: 1 }))],
  ]) {
    const H = harness(world, pos)
    const idx = LS.buildPriceIndex(idxCells, world.solidAt)
    const m = H.wrap(H.profile(), idx)
    const g = H.bot.pathfinder.getPathFromTo(m, H.bot.entity.position, goal, { timeout: 10000, tickTimeout: 0.2 })   // below ~0.05 ms the base pathfinder itself never finishes
    let v = g.next().value, n = 1
    while (v.result.status === 'partial') { v = g.next().value; n++ }
    assert.equal(v.result.status, 'success', `status after ${n} slices`)
    if (n > 1) sliced++
    const c = pathCharges(world, H, v.result)
    assert.equal(c.charged, LS.CORE_MOVE * c.refused, `after ${n} slices: charged ${c.charged} for ${c.refused} refused segment(s)`)
  }
  assert.ok(sliced >= 1, `positive control: ${sliced} searches actually resumed`)
})
await t('MUTANT KILLED: reading the A* node\'s mutable x/y/z (no recorded search cell) mis-charges a resumed climb', async () => {
  await withMutant(LS_URL, 'export const cellOf = n => n._lsC ?? {', 'export const cellOf = n => null ?? {', async mod => {
    let wrong = 0
    for (let rep = 0; rep < 6; rep++) {
      const world = ladderWorld(), H = harness(world, new Vec3(0.5, 61, 0.5))
      const idx = mod.buildPriceIndex([{ x: 2, y: 65, z: 1 }], world.solidAt)
      const ids = { water: registry.blocksByName.water.id, ladder: registry.blocksByName.ladder.id, vine: registry.blocksByName.vine.id }
      const m = H.profile(); m.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: true, reflex: null, env: { start: { x: 0, y: 61, z: 0 }, blockAt: (x, y, z) => world.at(x, y, z), ids } }), {})
      const g = H.bot.pathfinder.getPathFromTo(m, H.bot.entity.position, new goals.GoalBlock(0, 65, 0), { timeout: 10000, tickTimeout: 0.2 })
      let v = g.next().value; while (v.result.status === 'partial') v = g.next().value
      const c = pathCharges(world, H, v.result)
      if (c.charged !== LS.CORE_MOVE * c.refused) wrong++
    }
    assert.ok(wrong > 0, 'the mutant charged every resumed climb exactly: the test cannot see the mutation')
  })
})
await t('A LATE INDEX: a ladder generated while the index was empty still settles its incoming segment once lava is indexed (Codex r5 P3)', () => {
  const world = ladderWorld()
  const idx = LS.buildPriceIndex([{ x: 2, y: 65, z: 1 }], world.solidAt)
  const ids = { water: registry.blocksByName.water.id, ladder: registry.blocksByName.ladder.id, vine: registry.blocksByName.vine.id }
  const env = { start: { x: 0, y: 63, z: 0 }, blockAt: (x, y, z) => world.at(x, y, z), ids }
  const chain = (firstIdx) => {
    const start = new Move(0, 63, 0, 0, 0)
    const a = new Move(0, 64, 0, 0, 1), b = new Move(0, 65, 0, 0, 1)
    const s1 = LS.moveSurcharge(firstIdx, start, a, env)
    const s2 = LS.moveSurcharge(idx, a, b, env)
    return s1 + s2
  }
  const full = chain(idx), late = chain(new Set())
  assert.ok(full > 0, `positive control: the climb past the lava is charged (${full})`)
  assert.equal(late, full, 'the segment into the ladder is settled on its child even though it was generated unpriced')
})
await t('CAPPED SEARCHES: wherever the base reaches a goal within a cost cap by a route the guard accepts, the candidate does too (Codex r2 P1, r3 P2)', () => {
  // GoalBlock, so the base's cost >= h(start) and the cap is a real cap (searchRadius >= 0); one slice per search (the
  // property holds per slice; a time-sliced base is itself nondeterministic by about a move -- Claude r3 P3-1)
  const r = rng(23)
  let checked = 0, binding = 0
  for (let w = 0; w < 60; w++) {
    const { world, lava } = noisyWorld(r)
    const idx = LS.buildPriceIndex(lava.map(([x, y, z]) => ({ x, y, z })), world.solidAt)
    for (let k = 0; k < 6; k++) {
      const pos = spot(world, r); if (!pos) continue
      const H = harness(world, pos)
      const gx = Math.floor(r() * 17) - 8, gz = Math.floor(r() * 17) - 8
      if (world.nameAt(gx, 61, gz) !== 'air' || !world.solidAt(gx, 60, gz)) continue
      const goal = new goals.GoalBlock(gx, 61, gz)
      const rb = H.plan(H.profile(), goal)
      if (rb.status !== 'success' || !rb.path.length || lavaRefused(world.at, H.guardNodes(rb))) continue
      const start = { x: Math.floor(pos.x), y: 61, z: Math.floor(pos.z) }
      const cap = rb.cost - goal.heuristic(start) + 1e-6
      assert.ok(cap >= 0, `a real cap (${cap})`)
      if (cap > 0.01 && H.plan(H.profile(), goal, cap / 2).status !== 'success') binding++   // the cap binds: half of it fails the base
      const rc = H.plan(H.wrap(H.profile(), idx), goal, cap)
      checked++
      assert.equal(rc.status, 'success', `world ${w}: capped at ${cap.toFixed(2)} the candidate failed where the base passed by a guard-accepted route`)
      assert.ok(rc.cost <= rb.cost + 1e-6, `and no dearer (${rc.cost} vs ${rb.cost})`)
    }
  }
  assert.ok(checked >= 40 && binding >= 10, `positive control: ${checked} capped cases, the cap binding the base in ${binding}`)
})
// ------------------------------------------------------------------ 5. routes on the real pathfinder
await t('ROUTE: the base plans the pool edge the guard refuses; the candidate plans a detour the guard accepts', () => {
  const world = poolWorld(), H = harness(world), goal = new goals.GoalBlock(10, 61, 0)
  const rb = H.plan(H.profile(), goal)
  assert.equal(rb.status, 'success')
  assert.equal(lavaRefused(world.at, H.guardNodes(rb)), true, 'positive control: the base route is refused by the guard')
  const rc = H.plan(H.wrap(H.profile(), poolIdx(world)), goal)
  assert.equal(rc.status, 'success')
  assert.equal(lavaRefused(world.at, H.guardNodes(rc)), false, 'the candidate route passes the guard')
})
await t('ROUTE, NO DETOUR: a sealed 1-wide tunnel beside lava -- the candidate still plans the only way (no dead end)', () => {
  const lava = [], air = []
  for (let x = 0; x <= 10; x++) air.push([x, 61, 0], [x, 62, 0])
  for (let x = 2; x <= 8; x++) lava.push([x, 61, 1])
  const world = makeWorld({ floor: 62, lava, air }), H = harness(world), goal = new goals.GoalBlock(10, 61, 0)
  const idx = LS.buildPriceIndex(lava.map(([x, y, z]) => ({ x, y, z })), world.solidAt)
  const rb = H.plan(H.profile(), goal), rc = H.plan(H.wrap(H.profile(), idx), goal)
  assert.equal(rb.status, 'success'); assert.equal(rc.status, 'success', 'the candidate is never worse at reaching the goal')
  assert.deepEqual(rc.path.map(n => n.hash), rb.path.map(n => n.hash), 'the only way, the same way')
  assert.ok(rc.cost > rb.cost, 'positive control: the candidate did price it')
})
await t('NOPATH IS THE BASE\'S: an unreachable goal is noPath for both, a reachable one reached by both (same graph)', () => {
  const stone = []
  for (let x = -5; x <= 13; x++) for (const z of [-5, 6]) for (const y of [61, 62, 63]) stone.push([x, y, z])
  for (let z = -5; z <= 6; z++) for (const x of [-5, 13]) for (const y of [61, 62, 63]) stone.push([x, y, z])
  const world = poolWorld({ stone }), H = harness(world)
  const outside = new goals.GoalBlock(20, 61, 0)
  assert.equal(H.plan(H.profile(), outside).status, 'noPath', 'positive control: the base cannot leave the plot')
  assert.equal(H.plan(H.wrap(H.profile(), poolIdx(world)), outside).status, 'noPath')
  assert.equal(H.plan(H.wrap(H.profile(), poolIdx(world)), new goals.GoalBlock(10, 61, 0)).status, 'success')
})
await t('ROUTE, EGRESS: a bot standing on the pool edge gets a path out, and the first step leaves the footprint', () => {
  const world = poolWorld(), H = harness(world, new Vec3(5.5, 61, 0.5)), idx = poolIdx(world)
  const r = H.plan(H.wrap(H.profile(), idx), new goals.GoalBlock(5, 61, -8))
  assert.equal(r.status, 'success')
  assert.ok(r.path[0].z < 0.5, `the first step leaves the edge (to ${r.path[0].x},${r.path[0].z})`)
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
  const world = poolWorld(), H = harness(world)
  const idx = LS.buildPriceIndex([{ x: 4, y: 60, z: 1 }], world.solidAt)
  const counters = {}
  const reflex = 'drown_rescue'
  const cand = H.profile(); cand.getNeighbors = LS.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: LS.priceLive({ on: true, reflex }), reflex }), counters)
  const base = H.profile()
  const node = { x: 3, y: 61, z: 0, remainingBlocks: 0, hash: '3,61,0', toBreak: [], toPlace: [], _lsGen: true }
  assert.deepEqual(cand.getNeighbors(node).map(n => n.cost), base.getNeighbors(node).map(n => n.cost), 'held: the base costs')
  assert.ok(counters.held_seen > 0, 'positive control: the moves were in the footprint')
  assert.equal(counters.held_priced ?? 0, 0)
})
await t('MUTANT KILLED: a wrapper that ignores live (prices under a reflex) trips G2 (held_priced > 0)', async () => {
  await withMutant(LS_URL, '      if (!c.live) continue\n', '', async mod => {
    const world = poolWorld(), H = harness(world)
    const idx = mod.buildPriceIndex([{ x: 4, y: 60, z: 1 }], world.solidAt)
    const counters = {}
    const cand = H.profile(); cand.getNeighbors = mod.wrapNeighbors(Movements.prototype.getNeighbors, () => ({ idx, live: false, reflex: 'escape' }), counters)
    cand.getNeighbors({ x: 3, y: 61, z: 0, remainingBlocks: 0, hash: '3,61,0', toBreak: [], toPlace: [], _lsGen: true })
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
  return w > 0 && clones.every(c => c > w) && /return \{ idx, live: priceLive\(\{ on: LS_ON, reflex \}\), reflex,/.test(s) && /const idx = lsOverworld\(\) \? lsIdx : null/.test(s) &&
         /const reflex = stopReflexes\?\.activeReflex\?\.\(\) \?\? null/.test(s)
}
await t('WIRED: the wrapper is installed on the walk profile BEFORE every clone, gated on the reflex; MUTANT KILLED when moved after', () => {
  assert.equal(wiredOrder(INDEX), true)
  // THE MUTANT MOVES the whole installation block to after the last clone (Claude r2 P3-9: a deletion proves less)
  const A = '    // LAVASIGHT-01: THE MOVE WRAPPER', Z = '}, lsCounters)\n    }\n', AFTER = '    const waterMoves = Object.create(Object.getPrototypeOf(moves))\n'
  for (const k of [A, Z, AFTER]) assert.ok(INDEX.split(k).length === 2, `ANCHOR MISSING or not unique: ${k.slice(0, 40)}`)
  const i = INDEX.indexOf(A), j = INDEX.indexOf(Z, i) + Z.length
  const block = INDEX.slice(i, j), rest = INDEX.slice(0, i) + INDEX.slice(j)
  const moved = rest.replace(AFTER, AFTER + block)
  assert.ok(moved.includes(block) && moved.length === INDEX.length, 'the mutant moved, not deleted')
  assert.equal(wiredOrder(moved), false)
})
await t('WIRED: the corridor hook counts and rings; the blind step rings lava only; the rows exist', () => {
  const s = strip(INDEX)
  assert.match(s, /lsCounters\.corridor_checks = \(lsCounters\.corridor_checks \?\? 0\) \+ 1/)
  // and CALLED on both of the guard's outcomes (Claude r3 P3-4): inside the refusal block, after the goal is cleared, and after it
  assert.equal(s.split('if (LS_ON) lsGuardSeen(v, r.status, nodes)').length - 1, 2, 'the hook is called on refusal and on acceptance')
  assert.match(s, /if \(!v\.safe\) \{\s*try \{ bot\.pathfinder\.setGoal\(null\) \} catch \{ *\}\s*if \(LS_ON\) lsGuardSeen\(v, r\.status, nodes\)/)
  assert.match(s, /if \(\/lava\/\.test\(v\.why \?\? ''\) && !\/unknown\/\.test\(v\.why \?\? ''\) && Array\.isArray\(v\.at\)\) bot\.lavasightNote\(/)
  assert.match(s, /kind: 'lavasight_route'/); assert.match(s, /kind: 'lavasight'/); assert.match(s, /kind: 'lavasight_mode'/)
  assert.match(strip(SKILLS), /if \(\/lava\/\.test\(v\.why \?\? ''\) && !\/unknown\/\.test\(v\.why \?\? ''\) && Array\.isArray\(v\.at\)\) bot\.lavasightNote\?\.\(/)
})

console.log(`\nlavasight: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
