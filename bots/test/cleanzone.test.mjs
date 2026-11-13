// CLEANZONE-01 (cleanzone.mjs): in the town and its margin a route may not place a block; a bot the ban leaves no way is let
// through by the valve, and the place is written down. BEHAVIOUR over mineflayer-pathfinder 2.4.5's REAL Movements and REAL A*
// (scaftown.test.mjs's harness), with the ban installed exactly as index.mjs installs it. The source is read only for what
// behaviour cannot reach: that index.mjs installs it and which profiles it exempts (with mutants).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const CZ = await import('../src/cleanzone.mjs')
const PA = await import('../src/placeaudit.mjs')
const CZ_URL = new URL('../src/cleanzone.mjs', import.meta.url)
const INDEX_URL = new URL('../src/index.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const V = (x, y, z) => new Vec3(x, y, z)

// climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the mutant is never written
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- the world: REAL prismarine blocks, REAL Movements, REAL A* -------------------------------------------------------
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar.js')
const Move = require_('mineflayer-pathfinder/lib/move.js')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)

/** cells: { 'x,y,z': name }; y <= 69 is stone, the rest air, unless named. */
function world (cells = {}) {
  const nameAt = (x, y, z) => cells[`${x},${y},${z}`] ?? (y <= 69 ? 'stone' : 'air')
  const blockAt = p => {
    const b = Block.fromStateId(registry.blocksByName[nameAt(p.x, p.y, p.z)].defaultState, 0); b.position = V(p.x, p.y, p.z); return b
  }
  return { blockAt, nameAt }
}
const HOME = { x: 0, y: 70, z: 0 }
const FAR = { x: 5000, y: 70, z: 5000 }
/** A Movements as index.mjs's WALK profile has it (canDig false, towers on, no parkour, placeCost 5), and the ban when `ban`
 *  is given ({ home, mod, now, emit, on }). -> the movements, with `.__cz` the ban's object. */
function moves (w, { ban = null } = {}) {
  const bot = { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(0.5, 71, 0.5), effects: {} }, entities: {},
                inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot)
  m.canDig = false; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = true; m.maxDropDown = 6
  m.placeCost = 5
  if (ban) {
    const mod = ban.mod ?? CZ
    const zone = mod.cleanZoneOf('home' in ban ? ban.home : HOME)
    const cz = mod.makeCleanZone({ zone: () => zone, on: ban.on ?? true, now: ban.now ?? (() => 0), emit: ban.emit ?? null })
    mod.installCleanZoneFilter(m, cz)
    m.__cz = cz
  }
  return m
}
const clone = (m, patch = {}) => Object.assign(Object.assign(Object.create(Object.getPrototypeOf(m)), m), patch)
const placedOf = path => path.flatMap(n => (n.toPlace ?? []).filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`))
/** The REAL A* from a node -> { status, placed, cost }. */
function plan (m, from, goal, { blocks = 64, radius = -1, timeout = 4000 } = {}) {
  const r = new AStar(new Move(from[0], from[1], from[2], blocks, 0), m, goal, timeout, timeout, radius).compute()
  return { status: r.status, path: r.path, placed: placedOf(r.path), cost: r.cost }
}
/** THE LEDGE: a stone shelf x 4..9 across z -20..20, top y 72 (stand y 73); a staircase at z = +14 (one-high steps). The goal
 *  stands on the shelf at 6,73,0, 3 blocks above the bot at 0,70,0. */
function ledgeCells () {
  const c = {}
  for (let x = 4; x <= 9; x++) for (let z = -20; z <= 20; z++) for (let y = 70; y <= 72; y++) c[`${x},${y},${z}`] = 'stone'
  c['1,70,14'] = 'stone'; c['2,70,14'] = 'stone'; c['2,71,14'] = 'stone'; c['3,70,14'] = 'stone'; c['3,71,14'] = 'stone'; c['3,72,14'] = 'stone'
  return c
}
/** A 1x1 pit dug in the town: floor 66 (bot feet 67), walls to 69 (the ground), nothing to climb. */
function pitCells () {
  const c = {}
  for (let y = 67; y <= 69; y++) c[`0,${y},0`] = 'air'
  return c
}
const PIT = [0, 67, 0]
const OUT = new goals.GoalBlock(5, 70, 0)
/** A pathfinder whose getPathFromTo is mineflayer-pathfinder 2.4.5's generator protocol over the REAL A* (index.js:70-101). */
function fakePathfinder () {
  return {
    searchRadius: -1,
    getPathFromTo: function * (movements, startPos, goal, options = {}) {
      const ctx = new AStar(new Move(startPos.x, startPos.y, startPos.z, 64, 0), movements, goal, options.timeout ?? 4000, options.tickTimeout ?? 4000, options.searchRadius ?? this.searchRadius)
      let result = ctx.compute()
      yield { result, astarContext: ctx }
      while (result.status === 'partial') { result = ctx.compute(); yield { result, astarContext: ctx } }
    },
  }
}
const runSearch = (pf, m, from, goal, options = {}) => { let last = null; for (const v of pf.getPathFromTo(m, V(from[0], from[1], from[2]), goal, options)) last = v.result; return last }

// ---- the zone ---------------------------------------------------------------------------------------------------------
test('ZONE: exactly the cells the `_place_town` instrument calls town or margin (the rule and its measure cannot drift apart)', () => {
  const zone = CZ.cleanZoneOf(HOME)
  let inside = 0, outside = 0
  for (let x = -70; x <= 70; x += 2) for (let z = -70; z <= 70; z += 3) for (const y of [40, 57, 58, 59, 62, 70, 90, 200]) {
    const want = PA.placeZone([x, y, z], HOME) != null
    assert.equal(CZ.inCleanZone(zone, x, y, z), want, `cell ${x},${y},${z}`)
    want ? inside++ : outside++
  }
  assert.ok(inside > 1000 && outside > 1000, `the grid covers both sides (${inside} in, ${outside} out)`)
  assert.equal(CZ.inCleanZone(zone, 64, 58, -64), true, 'the margin\'s corner at the depth limit is in')
  assert.equal(CZ.inCleanZone(zone, 65, 70, 0), false)
  assert.equal(CZ.inCleanZone(zone, 0, 57, 0), false, 'a tunnel or a mine under the town is not the zone')
  assert.equal(CZ.cleanZoneOf(null), null, 'no home: no zone')
  assert.equal(CZ.inCleanZone(null, 0, 70, 0), false, 'no zone: nothing is in it (fails open)')
})
test('LANDS IN ZONE: the block lands at ref + face, or in the reference cell; either one in the zone counts; useOne places nothing', () => {
  const zone = CZ.cleanZoneOf(HOME)
  assert.equal(CZ.landsInZone([{ x: 0, y: 69, z: 0, dx: 0, dy: 1, dz: 0 }], zone), true)
  assert.equal(CZ.landsInZone([{ x: 65, y: 70, z: 0, dx: -1, dy: 0, dz: 0 }], zone), true, 'the reference is outside, the block lands inside')
  assert.equal(CZ.landsInZone([{ x: 64, y: 70, z: 0, dx: 1, dy: 0, dz: 0 }], zone), true, 'the reference cell itself is inside (a replaceable reference takes the block)')
  assert.equal(CZ.landsInZone([{ x: 66, y: 70, z: 0, dx: 1, dy: 0, dz: 0 }], zone), false)
  assert.equal(CZ.landsInZone([{ x: 0, y: 70, z: 0, dx: 0, dy: 1, dz: 0, useOne: true }], zone), false)
  assert.equal(CZ.landsInZone([{ x: 200, y: 70, z: 0, dx: 0, dy: 1, dz: 0 }, { x: 0, y: 69, z: 0, dx: 0, dy: 1, dz: 0 }], zone), true, 'any one placement is enough')
  assert.equal(CZ.landsInZone([], zone), false)
  assert.equal(CZ.landsInZone(null, zone), false)
  assert.equal(CZ.landsInZone([{ x: 0, y: 69, z: 0, dx: 0, dy: 1, dz: 0 }], null), false)
})
test('SWITCH: CLEANZONE=off|0|false|no turns it off; anything else, or nothing, is on', () => {
  for (const v of ['off', 'OFF', '0', 'false', 'no', ' off ']) assert.equal(CZ.cleanZoneOn({ CLEANZONE: v }), false, v)
  for (const v of [undefined, '', 'on', '1', 'yes']) assert.equal(CZ.cleanZoneOn({ CLEANZONE: v }), true, String(v))
})

// ---- the real A* --------------------------------------------------------------------------------------------------------
test('POSITIVE CONTROL: the base walk towers out of the pit and up the ledge (so "places nothing" below means the ban)', () => {
  const pit = plan(moves(world(pitCells())), PIT, OUT)
  assert.equal(pit.status, 'success')
  assert.ok(pit.placed.length >= 2, `the base places its way out of the pit (${pit.placed.join(' ')})`)
  const ledge = plan(moves(world(ledgeCells())), [0, 70, 0], new goals.GoalBlock(6, 73, 0))
  assert.equal(ledge.status, 'success')
  assert.ok(ledge.placed.length >= 1, 'the base climbs the ledge by placing: the staircase 14 away loses to a tower')
})
test('THE BAN: the same walk takes the staircase and places nothing; a flat walk is the base\'s walk exactly', () => {
  const w = world(ledgeCells())
  const m = moves(w, { ban: {} })
  const r = plan(m, [0, 70, 0], new goals.GoalBlock(6, 73, 0))
  assert.equal(r.status, 'success', 'the staircase is there: the walk arrives')
  assert.deepEqual(r.placed, [], 'and places nothing')
  assert.ok(m.__cz.vetoed > 0, 'the ban removed neighbours (it is why the route changed)')
  const flatBase = plan(moves(world()), [0, 70, 0], new goals.GoalBlock(12, 70, 5))
  const mf = moves(world(), { ban: {} })
  const flat = plan(mf, [0, 70, 0], new goals.GoalBlock(12, 70, 5))
  assert.equal(flat.status, 'success')
  assert.equal(flat.cost, flatBase.cost, 'a walk that places nothing costs what it cost')
  assert.equal(flat.path.length, flatBase.path.length)
})
test('THE BAN IN THE PIT: no route places a block in the zone, so the search ends noPath (the valve below is the remedy)', () => {
  const m = moves(world(pitCells()), { ban: {} })
  const r = plan(m, PIT, OUT)
  assert.equal(r.status, 'noPath')
  assert.deepEqual(r.placed, [])
  assert.ok(m.__cz.vetoed > 0)
})
test('OUTSIDE THE ZONE and WITH NO HOME the walk is the base\'s: it towers as before', () => {
  const base = plan(moves(world(pitCells())), PIT, OUT)
  const far = moves(world(pitCells()), { ban: { home: FAR } })
  const rf = plan(far, PIT, OUT)
  assert.equal(rf.status, 'success'); assert.deepEqual(rf.placed, base.placed); assert.equal(rf.cost, base.cost)
  assert.equal(far.__cz.vetoed, 0)
  const none = moves(world(pitCells()), { ban: { home: null } })
  const rn = plan(none, PIT, OUT)
  assert.equal(rn.status, 'success'); assert.deepEqual(rn.placed, base.placed)
  const off = moves(world(pitCells()), { ban: { on: false } })
  assert.deepEqual(plan(off, PIT, OUT).placed, base.placed, 'on = false removes nothing')
})
test('EXEMPT PROFILES: a clone that says cleanZone = false (the escapes) keeps every placement; a plain clone (gather) is banned', () => {
  const m = moves(world(pitCells()), { ban: {} })
  const base = plan(moves(world(pitCells())), PIT, OUT)
  const escape = clone(m, { cleanZone: false })
  const re = plan(escape, PIT, OUT)
  assert.equal(re.status, 'success'); assert.deepEqual(re.placed, base.placed)
  const gather = clone(m, { canDig: false })
  assert.equal(plan(gather, PIT, OUT).status, 'noPath', 'index.mjs clones gather from the walk profile: it inherits the ban')
})
test('MUTANT KILLED: without the profile check the escape clone is banned too', async () => {
  await withMutant(CZ_URL, '    if (this.cleanZone === false) return ns\n', '', async (mod) => {
    const m = moves(world(pitCells()), { ban: { mod } })
    assert.equal(plan(clone(m, { cleanZone: false }), PIT, OUT).status, 'noPath')
  })
})
test('INSTALL: idempotent; the library\'s own array comes back untouched when nothing is removed', () => {
  const m = moves(world(), { ban: {} })
  const g = m.getNeighbors
  CZ.installCleanZoneFilter(m, m.__cz)
  assert.equal(m.getNeighbors, g, 'a second install does not wrap again')
  assert.equal(m.cleanZone, true)
  const far = moves(world(), { ban: { home: FAR } })
  const node = new Move(0, 70, 0, 64, 0)
  const inner = Object.getPrototypeOf(far).getNeighbors.call(far, node)
  assert.deepEqual(far.getNeighbors(node).map(n => n.hash), inner.map(n => n.hash))
  const banned = m.getNeighbors(node)
  assert.ok(banned.length < inner.length, 'in the zone the placing neighbours are gone')
  assert.ok(banned.every(n => !(n.toPlace ?? []).some(p => !p.useOne)), 'and only they')
  assert.deepEqual(banned.map(n => n.hash), inner.filter(n => !(n.toPlace ?? []).some(p => !p.useOne)).map(n => n.hash), 'order kept')
})

// ---- the refusal chain: ban -> noPath -> the valve -> the tower ---------------------------------------------------------
test('THE VALVE (the refusal chain): two searches the ban fails from the same spot lift it there; the third towers out', () => {
  let t = 0
  const rows = []
  const m = moves(world(pitCells()), { ban: { now: () => t, emit: d => rows.push(d) } })
  const cz = m.__cz
  const pf = fakePathfinder()
  CZ.installCleanZoneSearch(pf, cz)
  const base = plan(moves(world(pitCells())), PIT, OUT)
  assert.equal(runSearch(pf, m, PIT, OUT).status, 'noPath', 'first: banned')
  assert.equal(cz.releases, 0, 'one failure is not a trap yet')
  t += 5000
  assert.equal(runSearch(pf, m, PIT, OUT).status, 'noPath', 'second: banned')
  assert.equal(cz.releases, 1, 'the valve opened')
  assert.equal(rows.length, 1)
  assert.match(rows[0], /^op=release why=no_path pos=0,67,0 goal=GoalBlock@5,70,0 /)
  t += 1000
  const third = runSearch(pf, m, PIT, OUT)
  assert.equal(third.status, 'success', 'third: the bot is let out')
  assert.deepEqual(placedOf(third.path), base.placed, 'by the base\'s own tower')
  assert.equal(cz.freed, 1)
  assert.equal(cz.failed, 2); assert.equal(cz.touched, 2)
  // the release is for that spot only, and it ends
  assert.equal(cz.freeAt([0, 67, 0], t), true)
  assert.equal(cz.freeAt([3, 67, 0], t), true, 'within releaseR')
  assert.equal(cz.freeAt([4, 67, 0], t), false)
  t += CZ.CLEAN_ZONE.releaseMs
  assert.equal(runSearch(pf, m, PIT, OUT).status, 'noPath', 'after releaseMs the ban is back')
})
test('MUTANT KILLED: a ban that ignores the release never lets the bot out of the pit', async () => {
  await withMutant(CZ_URL, '    if (s && s.free) return false\n', '', async (mod) => {
    let t = 0
    const m = moves(world(pitCells()), { ban: { mod, now: () => t } })
    const pf = fakePathfinder()
    mod.installCleanZoneSearch(pf, m.__cz)
    runSearch(pf, m, PIT, OUT); t += 1000; runSearch(pf, m, PIT, OUT); t += 1000
    assert.equal(m.__cz.releases, 1)
    assert.equal(runSearch(pf, m, PIT, OUT).status, 'noPath', 'the dead end this piece must not build')
  })
})
test('THE VALVE needs the SAME spot and the window: failures apart in place or in time do not add up', () => {
  let t = 0
  const cz = CZ.makeCleanZone({ zone: () => CZ.cleanZoneOf(HOME), now: () => t })
  const fail = (start, status = 'noPath', patch = {}) => { const s = { ...cz.begin({ start: V(...start) }), vetoed: 3, ...patch }; cz.settle(s, { status }); return s }
  fail([0, 67, 0]); fail([10, 67, 0])
  assert.equal(cz.releases, 0, 'two different pits')
  fail([10, 67, 1])
  assert.equal(cz.releases, 1, 'the second failure within sameR of the last one')
  t += 10 * 60_000
  fail([30, 67, 0]); t += CZ.CLEAN_ZONE.failMs + 1; fail([30, 67, 0])
  assert.equal(cz.releases, 1, 'the first failure had expired')
  fail([30, 67, 0])
  assert.equal(cz.releases, 2)
})
test('THE VALVE counts only searches the ban TOUCHED, never a capped probe, never a success', () => {
  let t = 0
  const cz = CZ.makeCleanZone({ zone: () => CZ.cleanZoneOf(HOME), now: () => t })
  const end = (status, patch = {}) => { const s = { ...cz.begin({ start: V(0, 67, 0), radius: patch.radius ?? -1 }), vetoed: 3, ...patch }; delete s.radius; cz.settle(s, { status }) }
  for (let i = 0; i < 6; i++) end('noPath', { vetoed: 0 })
  assert.equal(cz.releases, 0, 'a search the ban removed nothing from failed on its own')
  assert.equal(cz.failed, 0)
  for (let i = 0; i < 6; i++) end('noPath', { radius: 96 })
  assert.equal(cz.releases, 0, 'a capped probe running out of its radius is not an enclosed bot')
  assert.equal(cz.failed, 6, 'it is still counted as a search the ban failed')
  for (let i = 0; i < 6; i++) end('success')
  assert.equal(cz.releases, 0)
  assert.equal(cz.touched, 12)
  end('noPath'); end('noPath')
  assert.equal(cz.releases, 1, 'POSITIVE CONTROL: the same helper does open the valve')
})
test('MUTANT KILLED: without the capped check, probes open the valve', async () => {
  await withMutant(CZ_URL, '    if (s.capped || !s.start) return\n', '', async (mod) => {
    const cz = mod.makeCleanZone({ zone: () => mod.cleanZoneOf(HOME), now: () => 0 })
    for (let i = 0; i < 2; i++) { const s = { ...cz.begin({ start: V(0, 67, 0), radius: 96 }), vetoed: 1 }; cz.settle(s, { status: 'noPath' }) }
    assert.equal(cz.releases, 1)
  })
})
test('THE VALVE on timeouts: timeoutN touched timeouts within timeoutMs lift the ban where the last one started', () => {
  let t = 0
  const rows = []
  const T = CZ.CLEAN_ZONE
  const cz = CZ.makeCleanZone({ zone: () => CZ.cleanZoneOf(HOME), now: () => t, emit: d => rows.push(d) })
  const timeout = (start) => { const s = { ...cz.begin({ start: V(...start), goal: new goals.GoalNear(40, 75, 0, 2) }), vetoed: 9 }; cz.settle(s, { status: 'timeout' }) }
  for (let i = 0; i < T.timeoutN - 1; i++) { timeout([i * 8, 70, 0]); t += 5000 }
  assert.equal(cz.releases, 0)
  t += T.timeoutMs
  timeout([50, 70, 0])
  assert.equal(cz.releases, 0, 'the earlier ones fell out of the window')
  for (let i = 0; i < T.timeoutN - 1; i++) { t += 5000; timeout([20 + i, 70, 9]) }
  assert.equal(cz.releases, 1)
  assert.match(rows[0], new RegExp(`^op=release why=timeouts pos=${20 + T.timeoutN - 2},70,9 goal=GoalNear@40,75,0 `))
  assert.equal(cz.freeAt([20 + T.timeoutN - 2, 70, 9], t), true)
  assert.equal(cz.freeAt([50, 70, 0], t), false)
})
test('SEARCH SCOPE: the generator yields what it always did; continuations through astarContext.compute() are counted in the same search, once', () => {
  const m = moves(world(ledgeCells()), { ban: {} })
  const cz = m.__cz
  const pf = fakePathfinder()
  const origGen = pf.getPathFromTo
  CZ.installCleanZoneSearch(pf, cz)
  assert.notEqual(pf.getPathFromTo, origGen)
  const again = pf.getPathFromTo; CZ.installCleanZoneSearch(pf, cz)
  assert.equal(pf.getPathFromTo, again, 'idempotent')
  // goto's shape: take the first slice, then drive the context directly
  const g = pf.getPathFromTo(m, V(0, 70, 0), new goals.GoalBlock(6, 73, 0), { tickTimeout: 1, timeout: 8000 })
  const first = g.next().value
  assert.ok(first && first.result && first.astarContext, 'the protocol is unchanged: { result, astarContext }')
  let r = first.result, n = 0
  while (r.status === 'partial' && n++ < 100000) r = first.astarContext.compute()
  assert.equal(r.status, 'success')
  assert.deepEqual(placedOf(r.path), [])
  assert.equal(cz.searches, 1); assert.equal(cz.touched, 1, 'settled once, however many slices')
  assert.equal(cz.failed, 0)
  assert.equal(cz.cur, null, 'no scope leaks out of a search')
})
test('SEARCH SCOPE: an exempt profile\'s failed search is not the ban\'s: it neither counts toward the valve nor is counted', () => {
  const m = moves(world(pitCells()), { ban: {} })
  const pf = fakePathfinder()
  CZ.installCleanZoneSearch(pf, m.__cz)
  const sealed = world({ ...pitCells(), '0,70,0': 'bedrock', '0,71,0': 'bedrock' })
  const esc = clone(moves(sealed, { ban: {} }), { cleanZone: false })
  const pf2 = fakePathfinder(); CZ.installCleanZoneSearch(pf2, esc.__cz)
  for (let i = 0; i < 3; i++) runSearch(pf2, esc, PIT, new goals.GoalBlock(5, 70, 0), { timeout: 300 })
  assert.equal(esc.__cz.searches, 0); assert.equal(esc.__cz.releases, 0)
})
test('ROWS: the licence and the positive control say what is installed and what it did', () => {
  const zone = CZ.cleanZoneOf(HOME)
  assert.equal(CZ.cleanZoneModeDetail({}, zone), 'on=1 r=64 y_min=58 home=0,70,0 fail_n=2 fail_ms=180000 timeout_n=4 timeout_ms=180000 release_ms=120000 release_r=3')
  assert.match(CZ.cleanZoneModeDetail({ CLEANZONE: 'off' }, null), /^on=0 r=- y_min=- home=- /)
  const cz = CZ.makeCleanZone({ zone: () => zone })
  const prev = CZ.cleanZoneSnap(cz)
  cz.vetoed = 7; cz.searches = 3; cz.touched = 2; cz.failed = 1; cz.releases = 1; cz.freed = 1
  assert.equal(CZ.cleanZoneHitsDetail(cz, prev), 'vetoed=7 searches=3 touched=2 failed=1 releases=1 freed=1 total_vetoed=7 total_releases=1')
  assert.equal(CZ.cleanZoneHitsDetail(cz, CZ.cleanZoneSnap(cz)), 'vetoed=0 searches=0 touched=0 failed=0 releases=0 freed=0 total_vetoed=7 total_releases=1')
})

// ---- the wiring (structural: behaviour cannot reach index.mjs's bot construction) ------------------------------------------
function wiringProblems (src) {
  const code = strip(src)
  const out = []
  const once = (re, what) => { const n = (code.match(re) ?? []).length; if (n !== 1) out.push(`${what}: found ${n}, want 1`) }
  once(/installCleanZoneFilter\(moves, cleanZone\)/g, 'the filter is installed on the walk profile')
  once(/installCleanZoneSearch\(bot\.pathfinder, cleanZone\)/g, 'the search scope is installed on the pathfinder')
  once(/cleanZoneOn\(process\.env\)/g, 'the switch is read')
  once(/kind: 'cleanzone_mode'/g, 'the licence row')
  for (const p of ['ascendMoves', 'descendMoves', 'deckMoves', 'waterMoves']) once(new RegExp(`\\b${p}\\.cleanZone = false`, 'g'), `${p} is exempt`)
  if (/\bgatherMoves\.cleanZone\s*=/.test(code)) out.push('gatherMoves sets cleanZone: the gather profile must inherit the ban (42% of the placements)')
  const iInstall = code.indexOf('installCleanZoneFilter(moves, cleanZone)'), iGather = code.indexOf('const gatherMoves = ')
  if (!(iInstall > 0 && iGather > iInstall)) out.push('the filter must be installed BEFORE the profiles are cloned from the walk profile')
  return out
}
test('WIRING: index.mjs installs the ban before it clones the profiles, exempts the four escapes and not gather', () => {
  assert.deepEqual(wiringProblems(readFileSync(INDEX_URL, 'utf8')), [])
})
test('WIRING MUTANTS: each missing piece is named', () => {
  const src = readFileSync(INDEX_URL, 'utf8')
  const mut = (old, neu) => { assert.ok(src.split(old).length === 2, `ANCHOR MISSING or not unique: ${old}`); return wiringProblems(src.replace(old, neu)).join(' | ') }
  assert.match(mut('      installCleanZoneFilter(moves, cleanZone)\n', ''), /the filter is installed on the walk profile: found 0/)
  assert.match(mut('      installCleanZoneSearch(bot.pathfinder, cleanZone)\n', ''), /the search scope is installed/)
  assert.match(mut('    ascendMoves.cleanZone = false ', '    ascendMoves.cleanZoneX = false '), /ascendMoves is exempt: found 0/)
  assert.match(mut('    waterMoves.cleanZone = false ', '    waterMoves.cleanZoneX = false '), /waterMoves is exempt: found 0/)
  assert.match(mut('    gatherMoves.scafTown = false ', '    gatherMoves.cleanZone = false; gatherMoves.scafTown = false '), /gatherMoves sets cleanZone/)
})
