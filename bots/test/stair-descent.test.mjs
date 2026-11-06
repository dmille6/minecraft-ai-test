// STAIRUSE-01: THE TOWN STAIR'S WAY DOWN (bots/src/shaftgeom.mjs stairEntryClass / landingRoute / descentNext, bots/src/shaftvisit.mjs
// runStairDescent and runStairVisit's walk fallback). projectaudit 11-06: 13 of 14 finished stairs UNDERUSED. MEASURED (fleet 7 d,
// 13,827 `_shaft_use` rows): 3,702 of 7,164 descents started in a mine AWAY from the stair (no walk can leave a tunnel: 859 `walk`
// failures in 52 h at a median 30 ms); from the surface 78.0% arrived since shafttrap-02, the rest `walk` 11.6% (one long goto),
// `stepN:blocked` 7.9% (the whole descent refused for one foreign block in one air cell) and tread 2.6%; and 1,001 of 2,921 upkeep
// visits ended `walk_failed` on their one long walk to the work. THE REMEDY tested here on the showcase stair's own site (origin
// 26,-25, away n, g 68, K 53) with the REAL mineflayer-pathfinder A* on the town-deposit walk (no digs, no towers, no scaffold):
// the descent is offered from the surface or the stair only, walks down a few stands at a time, digs a foreign block out of the
// stair's own air cells on the way, and stops at a missing tread, a liquid or an unread cell.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as G from '../src/shaftgeom.mjs'
import { runStairVisit, runStairDescent } from '../src/shaftvisit.mjs'
const require_ = createRequire(import.meta.url)
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar')
const Move = require_('mineflayer-pathfinder/lib/move')
const { Vec3 } = require_('vec3')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const k3 = (x, y, z) => `${x},${y},${z}`

// ---- the showcase stair (record 11-03) on a fake world: stair-egress.test.mjs's fixtures, verbatim ------------------------------
const G0 = 68
const SITE = { origin: { x: 26, z: -25 }, away: 'n', g: G0 }
const PLAN = G.planStair(SITE)
const EXIT = [25, 69, -23]
const REC = { blueprint: G.SHAFT_BLUEPRINT, plot: 'shaft', state: 'complete', structure_complete: true, site: { ...SITE, center: [25, -26] }, K: PLAN.K,
  landings: [48, 32, 16], landings_built: [48, 32, 16], exit: EXIT, cells: PLAN.cells.map(c => ({ at: c.at, role: c.role })) }
function world (plan = PLAN) {
  const at = new Map()
  for (const c of plan.cells) at.set(k3(...c.at), c.role === 'air' ? 'air' : 'stone')
  const name = (x, y, z) => at.get(k3(x, y, z)) ?? (y <= plan.g ? 'stone' : 'air')
  const BB = n => (/^(air|cave_air|water|lava|torch|wall_torch)$/.test(n) ? 'empty' : 'block')
  const read = (x, y, z) => { const n = name(x, y, z); return { name: n, boundingBox: BB(n) } }
  const blockAt = p => { const b = Block.fromStateId(registry.blocksByName[name(p.x, p.y, p.z)].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b }
  return { at, name, read, blockAt, set: (c, n) => at.set(k3(...c), n) }
}
/** The town-deposit walk's movements (index.mjs moves + towndeposit.mjs townWalkMovements): no digs, no towers, no scaffold. */
function movesFor (blockAt) {
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(0.5, 64, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = false; m.scafoldingBlocks = []; m.maxDropDown = 6
  return m
}
function astar (m, from, goal, nodes = 20_000) {
  const a = new AStar(new Move(from[0], from[1], from[2], 0, 0), m, goal, 5_000, 40, -1)
  let r = a.compute(), n = 0
  while (r.status === 'partial' && n++ < 400) r = a.compute()
  return r
}
/** A body on the fake world: walkTo is the real A* (arrival = the path's success), dig sets the cell to air. */
function body (w, feet, { digRefuse = null, now = () => 0, aborted = () => false } = {}) {
  const st = { feet: [...feet], walks: [], digs: [], rows: [] }
  const e = {
    get read () { return w.read },
    feet: () => [...st.feet],
    walkTo: async c => {
      st.walks.push(c)
      const r = astar(movesFor(w.blockAt), st.feet, new goals.GoalBlock(c[0], c[1], c[2]))
      if (r.status !== 'success') return false
      st.feet = [...c]
      return true
    },
    dig: async c => { st.digs.push(c); if (digRefuse?.(c)) return 'refused'; w.set(c, 'air'); return 'confirmed' },
    now, aborted,
    log: (op, d) => st.rows.push({ op, ...d }),
  }
  return { st, e }
}

const L16 = PLAN.landings.find(l => l.feet === 16), L48 = PLAN.landings.find(l => l.feet === 48)
const down = (w, from, opts = {}) => { const b = body(w, from, opts); return { ...b, run: (o = {}) => runStairDescent(PLAN, b.e, { to: L16.k, landing: L16, exit: EXIT, ...o }) } }
const onStand = (st, c) => st.feet.join() === c.join()

console.log('1. WHERE A DESCENT STARTS (stairEntryClass)')
await t('the stair (a stand, a stub), the surface (at or above g - 6), away (a mine below that, off the stair), unknown', () => {
  assert.strictEqual(G.stairEntryClass(PLAN, G.standOf(PLAN, 30)), 'stair')
  assert.strictEqual(G.stairEntryClass(PLAN, G.stubEnd(L48)), 'stair')
  assert.strictEqual(G.stairEntryClass(PLAN, EXIT), 'surface')
  assert.strictEqual(G.stairEntryClass(PLAN, [EXIT[0] + 30, G0 + 1, EXIT[2] + 30]), 'surface', 'the open town')
  assert.strictEqual(G.stairEntryClass(PLAN, [EXIT[0] + 30, G0 - G.SURFACE_SLACK, EXIT[2]]), 'surface', 'a dip in the town (at the slack)')
  assert.strictEqual(G.stairEntryClass(PLAN, [EXIT[0] + 30, 40, EXIT[2]]), 'away', 'a mine 28 below, off the stair')
  assert.strictEqual(G.stairEntryClass(PLAN, [EXIT[0] + 30, G0 - G.SURFACE_SLACK - 1, EXIT[2]]), 'away', 'just under the slack')
  assert.strictEqual(G.stairEntryClass(PLAN, null), 'unknown')
})

console.log('2. THE ROUTE FROM WHERE THE BOT STANDS (landingRoute)')
await t('a foreign block in an air cell is no refusal (counted: the descent digs it); landingUsable refuses the same route (the base)', () => {
  const w = world()
  w.set(PLAN.steps[21].air[0], 'dirt')
  assert.deepStrictEqual(G.landingUsable(w.read, REC, 16).why, 'step21:blocked', 'CONTROL: the base refuses the whole descent')
  const r = G.landingRoute(w.read, REC, 16)
  assert.strictEqual(r.ok, true); assert.strictEqual(r.blocked, 1); assert.deepStrictEqual(r.stand, G.stubEnd(L16))
})
await t('a bad tread, a liquid or an unread cell IS a refusal, named; above the bot\'s own step nothing is read', () => {
  const w = world(); w.set(PLAN.steps[30].tread, 'air')
  assert.strictEqual(G.landingRoute(w.read, REC, 16).why, 'step30:tread')
  assert.strictEqual(G.landingRoute(w.read, REC, 16, 31).ok, true, 'from step 31 the broken tread is behind (above) it')
  const w2 = world(); w2.set(PLAN.steps[30].air[1], 'water')
  assert.strictEqual(G.landingRoute(w2.read, REC, 16).why, 'step30:wet')
  const w3 = world(); const r3 = (x, y, z) => (x === PLAN.steps[30].air[0][0] && y === PLAN.steps[30].air[0][1] && z === PLAN.steps[30].air[0][2] ? null : w3.read(x, y, z))
  assert.strictEqual(G.landingRoute(r3, REC, 16).why, 'step30:unknown')
  assert.strictEqual(G.landingRoute(world().read, REC, 48, L16.k).why, 'below', 'a landing above the bot')
  assert.strictEqual(G.landingRoute(world().read, { ...REC, landings_built: [48] }, 16).why, 'not_built')
})

console.log('3. THE NEXT MOVE DOWN (descentNext)')
await t('a clean stair: hop EGRESS_HOP stands down; at the goal done; from the exit (-1) the first stands', () => {
  const w = world()
  assert.deepStrictEqual(G.descentNext(w.read, PLAN, 10, 40), { op: 'hop', to: 13 })
  assert.deepStrictEqual(G.descentNext(w.read, PLAN, 39, 40), { op: 'hop', to: 40 })
  assert.deepStrictEqual(G.descentNext(w.read, PLAN, 40, 40), { op: 'done' })
  assert.deepStrictEqual(G.descentNext(w.read, PLAN, -1, 40), { op: 'hop', to: 2 })
})
await t('a foreign block in the next step\'s air is dug from here; one farther is approached; the body cell is skipped', () => {
  const w = world(); w.set(PLAN.steps[11].air[1], 'dirt')
  assert.deepStrictEqual(G.descentNext(w.read, PLAN, 10, 40), { op: 'dig', at: PLAN.steps[11].air[1], k: 11 })
  const w2 = world(); w2.set(PLAN.steps[13].air[0], 'cobblestone')
  assert.deepStrictEqual(G.descentNext(w2.read, PLAN, 10, 40), { op: 'hop', to: 12 }, 'two below: walk down to the step above it')
  const w3 = world(); w3.set(PLAN.steps[11].air[2], 'dirt')
  assert.deepStrictEqual(G.descentNext(w3.read, PLAN, 10, 40, [PLAN.steps[11].air[2]]), { op: 'hop', to: 13 }, 'the body cell is never blocked')
})
await t('a liquid or a missing tread in the next step stops it (never stepped into); farther, the bot walks down to it first', () => {
  const w = world(); w.set(PLAN.steps[11].air[0], 'water')
  assert.strictEqual(G.descentNext(w.read, PLAN, 10, 40).why, 'wet')
  const w2 = world(); w2.set(PLAN.steps[11].tread, 'air')
  assert.strictEqual(G.descentNext(w2.read, PLAN, 10, 40).why, 'tread')
  const w3 = world(); w3.set(PLAN.steps[13].tread, 'air')
  assert.deepStrictEqual(G.descentNext(w3.read, PLAN, 10, 40), { op: 'hop', to: 12 })
})
await t('the barrier rule (the egress\'s): dirt holding back lava or water beside it is never dug', () => {
  for (const liquid of ['lava', 'water']) {
    const w = world()
    w.set(PLAN.steps[11].air[0], 'dirt')
    const side = PLAN.steps[11].lining.find(c => c[1] === PLAN.steps[11].air[0][1]) ?? PLAN.steps[11].lining[0]
    w.set(side, liquid)
    const op = G.descentNext(w.read, PLAN, 10, 40)
    assert.deepStrictEqual([op.op, op.why], ['stop', 'wet'], liquid)
  }
})

console.log('4. THE WAY DOWN ON THE REAL A* (runStairDescent; walkTo = the town-deposit walk\'s A*)')
await t('from the surface beside the exit: the exit, then hops down to the 16 landing\'s stand; nothing dug', async () => {
  const d = down(world(), [EXIT[0], EXIT[1], EXIT[2] + 4])
  const r = await d.run()
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.why, 'arrived')
  assert.ok(onStand(d.st, G.stubEnd(L16)), `at ${d.st.feet}`)
  assert.deepStrictEqual(d.st.walks[0], EXIT)
  assert.ok(r.hops >= Math.ceil(L16.k / G.EGRESS_HOP), `${r.hops} hops`)
  assert.strictEqual(d.st.digs.length, 0)
})
await t('CONTROL (the base\'s one walk): the real A* reaches the deep stand from the exit on a CLEAN stair -- and not past one dirt block', async () => {
  const w = world()
  const m = movesFor(w.blockAt)
  assert.strictEqual(astar(m, EXIT, new goals.GoalBlock(...G.stubEnd(L16))).status, 'success', 'clean: one walk arrives too')
  w.set(PLAN.steps[21].air[0], 'dirt'); w.set(PLAN.steps[21].air[1], 'dirt')
  assert.notStrictEqual(astar(movesFor(w.blockAt), EXIT, new goals.GoalBlock(...G.stubEnd(L16))).status, 'success', 'blocked: the one walk cannot')
})
await t('a pillared stair (dirt in four air cells and one stub cell): each dug on the way, the stand reached, the cells air again', async () => {
  const w = world()
  const blocks = [PLAN.steps[5].air[0], PLAN.steps[21].air[1], PLAN.steps[21].air[0], PLAN.steps[40].air[2], L16.cols[1].air[0]]
  for (const c of blocks) w.set(c, 'dirt')
  const d = down(w, EXIT)
  const r = await d.run()
  assert.ok(r.ok, JSON.stringify(r))
  assert.strictEqual(r.cleared, blocks.length)
  for (const c of blocks) assert.strictEqual(w.name(...c), 'air', `${c} dug`)
  assert.ok(onStand(d.st, G.stubEnd(L16)))
  assert.ok(d.st.rows.filter(x => x.op === 'descent_dig').length === blocks.length, 'one descent_dig row a block')
})
await t('a missing tread: stops `tread` on the step above it, nothing stepped over; lava behind the dirt: `wet`, nothing dug', async () => {
  const w = world(); w.set(PLAN.steps[20].tread, 'air')
  const d = down(w, EXIT)
  const r = await d.run()
  assert.deepStrictEqual([r.ok, r.why, r.to], [false, 'tread', 19])
  const w2 = world()
  w2.set(PLAN.steps[30].air[0], 'dirt')
  const side = PLAN.steps[30].lining.find(c => c[1] === PLAN.steps[30].air[0][1]) ?? PLAN.steps[30].lining[0]
  w2.set(side, 'lava')
  const d2 = down(w2, EXIT)
  const r2 = await d2.run()
  assert.deepStrictEqual([r2.ok, r2.why], [false, 'wet'])
  assert.strictEqual(d2.st.digs.length, 0)
  assert.strictEqual(w2.name(...PLAN.steps[30].air[0]), 'dirt', 'the barrier stays')
})
await t('from the 48 landing\'s stub (on the stair): back to its step, down to 16 (no exit walk); a landing above the bot: `below`', async () => {
  const d = down(world(), G.stubEnd(L48))
  const r = await d.run()
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.from, L48.k)
  assert.ok(!d.st.walks.some(c => c.join() === EXIT.join()))
  const d2 = down(world(), G.stubEnd(L16))
  const r2 = await runStairDescent(PLAN, d2.e, { to: L48.k, landing: L48, exit: EXIT })
  assert.strictEqual(r2.why, 'below')
})
await t('a dig the server refuses twice: `dig_refused`; a body on the cell: `occupied`, never dug; the exit unreachable: `approach`', async () => {
  const w = world(); w.set(PLAN.steps[11].air[0], 'dirt')
  const d = down(w, EXIT, { digRefuse: () => true })
  assert.strictEqual((await d.run()).why, 'dig_refused')
  const w2 = world(); w2.set(PLAN.steps[11].air[0], 'dirt')
  const b = body(w2, EXIT)
  b.e.occupied = c => c.join() === PLAN.steps[11].air[0].join()
  const r2 = await runStairDescent(PLAN, b.e, { to: L16.k, landing: L16, exit: EXIT })
  assert.deepStrictEqual([r2.why, b.st.digs.length], ['occupied', 0])
  const b3 = body(world(), [EXIT[0], EXIT[1], EXIT[2] + 4])
  b3.e.walkTo = async () => false
  assert.strictEqual((await runStairDescent(PLAN, b3.e, { to: L16.k, landing: L16, exit: EXIT })).why, 'approach')
})
await t('the deadline and an abort: `time` between moves; an abort throws (the caller\'s yield)', async () => {
  let t0 = 0
  const d = down(world(), EXIT, { now: () => (t0 += 1_000) })
  const r = await d.run({ deadline: 5_000 })
  assert.strictEqual(r.why, 'time')
  const d2 = down(world(), EXIT, { aborted: () => true })
  await assert.rejects(d2.run(), e => e.aborted === true)
})

console.log('5. THE UPKEEP VISIT\'S WALK (runStairVisit falls back to the way down)')
/** A visit's effects on the fake world: the visit's ONE long walk fails past `reach` steps below the bot (the LIVE `walk_failed`). */
function visitBody (w, feet, { reach = 6 } = {}) {
  const st = { feet: [...feet], digs: [], places: [], walks: [], descends: [] }
  const kOf = c => G.stairStepAt(PLAN, c)?.k ?? -1
  const e = {
    get read () { return w.read },
    feet: () => [...st.feet],
    walkTo: async c => { st.walks.push(c); if (kOf(c) - Math.max(0, kOf(st.feet)) > reach) return false; const r = astar(movesFor(w.blockAt), st.feet, new goals.GoalBlock(...c)); if (r.status !== 'success') return false; st.feet = [...c]; return true },
    dig: async c => { st.digs.push(c); w.set(c, 'air'); return 'confirmed' },
    place: async c => { st.places.push(c); w.set(c, 'stone'); return 'confirmed' },
    toolOk: () => true, fence: () => true, log: () => {}, now: () => 0, aborted: () => false,
  }
  e.descend = async k => { st.descends.push(k); const bb = { ...e, walkTo: async c => { const r = astar(movesFor(w.blockAt), st.feet, new goals.GoalBlock(...c)); if (r.status !== 'success') return false; st.feet = [...c]; return true } }; return runStairDescent(PLAN, bb, { to: k, exit: EXIT }) }
  return { st, e }
}
const visitP = () => ({ rec: REC, exit: EXIT, built: new Set([48, 32, 16]), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} })
await t('a deep repair (a missing tread at step 45): the long walk fails, the way down takes the bot to the stand, the tread is laid', async () => {
  const w = world(); w.set(PLAN.steps[45].tread, 'air')
  const v = visitBody(w, EXIT)
  const r = await runStairVisit(visitP(), v.e)
  assert.strictEqual(r.stop, 'complete', JSON.stringify(r))
  assert.deepStrictEqual(v.st.descends, [44])
  assert.ok(v.st.places.some(c => c.join() === PLAN.steps[45].tread.join()))
  assert.strictEqual(w.name(...PLAN.steps[45].tread), 'stone')
})
await t('CONTROL: without e.descend (STAIRUSE=off) the same visit ends `walk_failed` (the LIVE 1,001)', async () => {
  const w = world(); w.set(PLAN.steps[45].tread, 'air')
  const v = visitBody(w, EXIT)
  delete v.e.descend
  assert.strictEqual((await runStairVisit(visitP(), v.e)).stop, 'walk_failed')
})

console.log('6. MUTANTS (each anchor present and unique)')
const VISIT = new URL('../src/shaftvisit.mjs', import.meta.url)
const GEOM = new URL('../src/shaftgeom.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 70)}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: landingRoute refusing a blocked air cell (the base) refuses the descent the digs would make', async () => {
  await withMutant(GEOM, "if (st === 'blocked') { blocked++; continue } if (st !== 'open') return { ok: false, why: `step${k}:${st}` } }", "if (st !== 'open') return { ok: false, why: `step${k}:${st}` } }", async mod => {
    const w = world(); w.set(PLAN.steps[21].air[0], 'dirt')
    assert.strictEqual(mod.landingRoute(w.read, REC, 16).ok, false)
  })
})
await t('MUTANT KILLED: descentNext reading every air cell as open walks the bot into the dirt (a hop, not the dig)', async () => {
  await withMutant(GEOM, "      if (b.boundingBox === 'empty') continue   // open air: the next cell\n", '      continue\n', async mod => {
    const w = world(); w.set(PLAN.steps[11].air[1], 'dirt')
    assert.notStrictEqual(mod.descentNext(w.read, PLAN, 10, 40).op, 'dig')
  })
})
await t('MUTANT KILLED: a descent that never digs does not get down the pillared stair', async () => {
  await withMutant(VISIT, "    const r = await e.dig(op.at)\n    if (r === 'confirmed') { out.cleared++; e.log?.('descent_dig'", "    const r = 'refused'\n    if (r === 'confirmed') { out.cleared++; e.log?.('descent_dig'", async mod => {
    const w = world(); w.set(PLAN.steps[21].air[0], 'dirt')
    const b = body(w, EXIT)
    const r = await mod.runStairDescent(PLAN, b.e, { to: L16.k, landing: L16, exit: EXIT })
    assert.strictEqual(r.ok, false)
  })
})
await t('MUTANT KILLED: the barrier rule gone, the descent digs the dirt that holds the lava back', async () => {
  await withMutant(GEOM, "        if (isWet(nb)) return { op: 'stop', why: 'wet', at: n, k: j }\n      }\n      return { op: 'dig', at: c, k: j }", "      }\n      return { op: 'dig', at: c, k: j }", async mod => {
    const w = world(); w.set(PLAN.steps[11].air[0], 'dirt')
    const side = PLAN.steps[11].lining.find(c => c[1] === PLAN.steps[11].air[0][1]) ?? PLAN.steps[11].lining[0]
    w.set(side, 'lava')
    assert.strictEqual(mod.descentNext(w.read, PLAN, 10, 40).op, 'dig')
  })
})
await t('MUTANT KILLED: the visit without its fallback ends walk_failed again', async () => {
  await withMutant(VISIT, "        if (sk >= 0) { await e.descend(sk); if (!same(e.feet(), stand)) await e.walkTo(stand) }\n", '\n', async mod => {
    const w = world(); w.set(PLAN.steps[45].tread, 'air')
    const v = visitBody(w, EXIT)
    assert.strictEqual((await mod.runStairVisit(visitP(), v.e)).stop, 'walk_failed')
  })
})
await t('the switch: STAIRUSE=off|0|false|no is the rollback; unset is on', () => {
  assert.strictEqual(G.stairUseOn({}), true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(G.stairUseOn({ STAIRUSE: v }), false, v)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
