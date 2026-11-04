// SHAFTTRAP-01: A STAIR VISIT ENDS AT THE COLLAR (bots/src/shaftgeom.mjs stairStepAt / egressNext / egressReserveMs,
// bots/src/shaftvisit.mjs runStairEgress, skills.mjs buildStair + visitEgress). LIVE 11-03: 11 of 16 showcase `_needs_rescue` rows
// (74 of 87 on the fleet) were bots in the town stair with `guard=record record=shaft`; 8 of the 11 came straight after a stair
// visit that handed the body back deep in the stair. THE CHAIN tested here, on the showcase stair's own site (origin 26,-25,
// away n, g 68, K 53): the visit ends at step k -> the maroon probe (a route to the same y, 8 off) cannot succeed in a spiral ->
// the escape's way up is the stair record's own rock (the escape guard refuses it) = the dead end; and the remedy: the egress
// walks the stair up (the REAL mineflayer-pathfinder A*, the town-deposit walk: no digs, no towers, no scaffold), digging a
// foreign block out of the stair's own air cells, and ends at the collar exit, where the probe succeeds.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as G from '../src/shaftgeom.mjs'
import { runStairVisit, runStairEgress } from '../src/shaftvisit.mjs'
import { guardOf, escapeDigDecision } from '../src/escapeguard.mjs'
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

// ---- the showcase stair (record 11-03: origin 26,-25 away n g 68 K 53, exit 25,69,-23) on a fake world ---------------------
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
/** reflex.mjs canStartAPath's question (a route to GoalNear(x+8, y, z+8, 3)), asked of the real A*. */
const probe = (w, feet) => astar(movesFor(w.blockAt), feet, new goals.GoalNear(feet[0] + 8, feet[1], feet[2] + 8, 3), 4_000).status === 'success'

console.log('1. WHERE THE BOT IS (stairStepAt)')
await t('every stand is its own step; a centre over the next step down still reads as its own step; ties go up', () => {
  for (let k = 0; k <= PLAN.K; k++) assert.strictEqual(G.stairStepAt(PLAN, G.standOf(PLAN, k)).k, k, `stand ${k}`)
  const s = G.standOf(PLAN, 37), lo = G.standOf(PLAN, 38)
  assert.strictEqual(G.stairStepAt(PLAN, [lo[0], s[1], lo[2]]).k, 37, 'edge stance: feet at step 37 height over step 38')
})
await t('a landing stub: the landing step, walking the stub feet cells back first; off the stair: null', () => {
  for (const l of PLAN.landings) {
    const end = G.stubEnd(l)
    const a = G.stairStepAt(PLAN, end)
    assert.strictEqual(a.k, l.k, `stub ${l.feet}`)
    assert.strictEqual(a.via.length, l.cols.length - 1, 'every column back to the first')
    assert.deepStrictEqual(a.via.at(-1), l.cols[0].air[0])
  }
  assert.strictEqual(G.stairStepAt(PLAN, [60, 40, 10]), null, 'POSITIVE CONTROL: a cave far off is not the stair')
  assert.strictEqual(G.stairStepAt(PLAN, null), null)
})

console.log('2. THE NEXT MOVE (egressNext)')
await t('a clean stair: hop EGRESS_HOP stands up; step 0 is done', () => {
  const w = world()
  assert.deepStrictEqual(G.egressNext(w.read, PLAN, 40), { op: 'hop', to: 37 })
  assert.deepStrictEqual(G.egressNext(w.read, PLAN, 2), { op: 'hop', to: 0 })
  assert.deepStrictEqual(G.egressNext(w.read, PLAN, 0), { op: 'done' })
})
await t('a foreign block in an air cell within a step is dug; one farther is approached; the bot\'s own body never blocks', () => {
  const w = world()
  w.set(PLAN.steps[39].air[1], 'dirt')
  assert.deepStrictEqual(G.egressNext(w.read, PLAN, 40), { op: 'dig', at: PLAN.steps[39].air[1], k: 39 })
  const w2 = world()
  w2.set(PLAN.steps[40].air[2], 'dirt')
  assert.deepStrictEqual(G.egressNext(w2.read, PLAN, 40), { op: 'dig', at: PLAN.steps[40].air[2], k: 40 }, 'the head room over the bot')
  const w3 = world()
  w3.set(PLAN.steps[37].air[0], 'cobblestone')
  assert.deepStrictEqual(G.egressNext(w3.read, PLAN, 40), { op: 'hop', to: 38 }, 'two steps up: walk under it first')
  const w4 = world()
  w4.set(PLAN.steps[40].air[0], 'dirt')
  assert.deepStrictEqual(G.egressNext(w4.read, PLAN, 40, [PLAN.steps[40].air[0]]), { op: 'hop', to: 37 }, 'the body cell is skipped')
})
await t('a liquid in an air cell or a missing tread next to the bot stops it (never dug into, never stepped over)', () => {
  const w = world()
  w.set(PLAN.steps[39].air[2], 'water')
  assert.strictEqual(G.egressNext(w.read, PLAN, 40).why, 'wet')
  const w2 = world()
  w2.set(PLAN.steps[39].tread, 'air')
  assert.strictEqual(G.egressNext(w2.read, PLAN, 40).why, 'tread')
  const w3 = world()
  w3.set(PLAN.steps[36].air[1], 'water')
  assert.deepStrictEqual(G.egressNext(w3.read, PLAN, 40), { op: 'hop', to: 37 }, 'farther off: walk up to it first')
})
await t('Codex r1 blocker 1: dirt holding back lava or water beside it is never dug (the barrier stays; the way out stops)', () => {
  for (const liquid of ['lava', 'water']) {
    const w = world()
    w.set(PLAN.steps[39].air[0], 'dirt'); w.set(PLAN.steps[39].air[1], liquid)
    const op = G.egressNext(w.read, PLAN, 40)
    assert.strictEqual(op.op, 'stop', `${liquid}: ${JSON.stringify(op)}`); assert.strictEqual(op.why, 'wet')
    const w2 = world()
    w2.set(PLAN.steps[39].air[0], 'dirt')
    const side = PLAN.steps[39].lining.find(c => c[1] === PLAN.steps[39].air[0][1]) ?? PLAN.steps[39].lining[0]
    w2.set(side, liquid)
    assert.strictEqual(G.egressNext(w2.read, PLAN, 40).why, 'wet', `${liquid} in the lining beside the dirt`)
  }
  const w3 = world()
  w3.set(PLAN.steps[39].air[0], 'dirt')
  assert.strictEqual(G.egressNext(w3.read, PLAN, 40).op, 'dig', 'POSITIVE CONTROL: dry around it, it is dug')
  // Codex r2: water in the bot's OWN head cell beside the dirt -- the body cells are skipped as obstacles, never as liquids
  const w4 = world()
  const s40 = PLAN.steps[40]
  w4.set(PLAN.steps[39].air[0], 'dirt'); w4.set(s40.air[1], 'water')
  assert.strictEqual(G.egressNext(w4.read, PLAN, 40, [s40.air[0], s40.air[1]]).why, 'wet', 'water at the bot\'s head beside the dirt')
})
await t('egressReserveMs: 0 at the top, grows with depth; the bottom step fits in the skill budget with the work tail', () => {
  assert.strictEqual(G.egressReserveMs(0), 0)
  assert.ok(G.egressReserveMs(53) > G.egressReserveMs(10))
  assert.ok(G.egressReserveMs(53) < 180_000 - 25_000 - 4_000, 'a bottom-step reserve leaves work time in a 180 s visit')
})

console.log('3. THE DEAD END, AS IT WAS (the chain, before)')
await t('a visit that ends at step 40: the maroon probe cannot succeed in the spiral, and the escape\'s way up is the record\'s own rock', () => {
  const w = world()
  const s = G.standOf(PLAN, 40)
  assert.strictEqual(probe(w, s), false, 'the probe the maroon arm runs: no route to the same y 8 off (the arm then climbs out)')
  // the pillar/ramp's dig over the head: the cell 2 above the feet at every step is the record's (lining or another step's tread)
  const recordAt = c => { const x = PLAN.byKey.get(k3(c.x, c.y, c.z)); return x && x.role !== 'air' ? 'shaft' : false }
  const over = [s[0], s[1] + 3, s[2]]
  const g = guardOf({ cell: { x: over[0], y: over[1], z: over[2] }, name: 'stone', recordAt, home: { x: 0, y: 70, z: 0 } })
  assert.deepStrictEqual(g, { kind: 'record', what: 'shaft' }, 'the ceiling over the step is a record cell')
  assert.deepStrictEqual(escapeDigDecision({ guard: g }), { allow: false, why: 'record' }, 'the escape guard refuses it (correctly)')
  // ...and the stair walk the guard's remedy names ("walks out") IS there: the real A* finds the exit from the stand
  assert.strictEqual(astar(movesFor(w.blockAt), s, new goals.GoalBlock(...EXIT)).status, 'success', 'the walk out exists')
})
await t('POSITIVE CONTROL: the probe succeeds at the collar exit (the test can see a free bot)', () => {
  assert.strictEqual(probe(world(), EXIT), true)
})
await t('one dirt block pillared into an air cell above: the ascent plan is noPath (LIVE `_shaft_use dir=up why=no_plan`)', () => {
  const w = world()
  w.set(PLAN.steps[30].air[0], 'dirt')
  assert.notStrictEqual(astar(movesFor(w.blockAt), G.standOf(PLAN, 40), new goals.GoalBlock(...EXIT)).status, 'success')
})

console.log('4. THE WAY OUT (runStairEgress on the real A*)')
await t('a clean stair from step 44: arrives at the collar exit; the probe then succeeds', async () => {
  const w = world()
  const { st, e } = body(w, G.standOf(PLAN, 44))
  const r = await runStairEgress(PLAN, e, { exit: EXIT })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.why, 'arrived')
  assert.strictEqual(r.from, 44)
  assert.ok(r.hops >= 15 && r.hops <= 44, `hops ${r.hops}`)
  assert.strictEqual(r.cleared, 0)
  assert.deepStrictEqual(st.feet, EXIT)
  assert.strictEqual(probe(w, st.feet), true)
  assert.strictEqual(st.rows.filter(x => x.op === 'egress').length, 1, 'one egress row')
})
await t('dirt pillared into four air cells (one over the bot\'s head): every one dug, nothing else, the exit reached', async () => {
  const w = world()
  const blocks = [PLAN.steps[44].air[2], PLAN.steps[40].air[0], PLAN.steps[30].air[1], PLAN.steps[12].air[2]]
  for (const c of blocks) w.set(c, 'dirt')
  const { st, e } = body(w, G.standOf(PLAN, 44))
  const r = await runStairEgress(PLAN, e, { exit: EXIT })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.cleared, 4)
  assert.deepStrictEqual(new Set(st.digs.map(c => c.join(','))), new Set(blocks.map(c => c.join(','))), 'only the foreign blocks')
  for (const c of st.digs) assert.strictEqual(PLAN.byKey.get(k3(...c))?.role, 'air', 'every dig is a planned AIR cell of the record')
  assert.strictEqual(st.rows.filter(x => x.op === 'egress_dig').length, 4)
})
await t('from a landing stub end (feet 32): back along the stub, then up', async () => {
  const w = world()
  const l = PLAN.landings.find(q => q.feet === 32)
  const { st, e } = body(w, G.stubEnd(l))
  const r = await runStairEgress(PLAN, e, { exit: EXIT })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.from, l.k)
  assert.deepStrictEqual(st.feet, EXIT)
})
await t('water in an air cell on the way: stops below it, never digs into it', async () => {
  const w = world()
  w.set(PLAN.steps[30].air[1], 'water')
  const { st, e } = body(w, G.standOf(PLAN, 40))
  const r = await runStairEgress(PLAN, e, { exit: EXIT })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.why, 'wet')
  assert.strictEqual(st.digs.length, 0)
  assert.ok(r.to === 31 || r.to === 30, `stopped at ${r.to}`)
})
await t('bounded: a refused dig twice ends it; a spent deadline ends it; an abort throws; at the surface it is a no-op', async () => {
  const w = world()
  w.set(PLAN.steps[39].air[0], 'dirt')
  const a = body(w, G.standOf(PLAN, 40), { digRefuse: () => true })
  const r = await runStairEgress(PLAN, a.e, { exit: EXIT })
  assert.strictEqual(r.why, 'dig_refused'); assert.strictEqual(a.st.digs.length, 2)
  const b = body(world(), G.standOf(PLAN, 40), { now: () => 10 })
  assert.strictEqual((await runStairEgress(PLAN, b.e, { exit: EXIT, deadline: 5 })).why, 'time')
  const c = body(world(), G.standOf(PLAN, 40), { aborted: () => true })
  await assert.rejects(runStairEgress(PLAN, c.e, { exit: EXIT }), err => err.aborted === true)
  const d = body(world(), EXIT)
  const rd = await runStairEgress(PLAN, d.e, { exit: EXIT })
  assert.strictEqual(rd.why, 'surface'); assert.strictEqual(rd.ok, true); assert.strictEqual(d.st.walks.length, 0)
})

await t('Codex r1 blocker 2: a block a body stands on is never dug (another bot on its pillar top)', async () => {
  const w = world()
  w.set(PLAN.steps[39].air[0], 'dirt')
  const b = body(w, G.standOf(PLAN, 40))
  b.e.occupied = c => c.join(',') === PLAN.steps[39].air[0].join(',')
  const r = await runStairEgress(PLAN, b.e, { exit: EXIT })
  assert.strictEqual(r.why, 'occupied'); assert.strictEqual(b.st.digs.length, 0)
  const b2 = body(w, G.standOf(PLAN, 40))
  b2.e.occupied = () => false
  assert.strictEqual((await runStairEgress(PLAN, b2.e, { exit: EXIT })).ok, true, 'POSITIVE CONTROL: nobody on it, it is dug and the bot leaves')
})
await t('bodyOnCell (skills.mjs, the live occupancy): a player on the cell or jumping off it yes; beside it, below it, or a non-player no', async () => {
  const { bodyOnCell } = await import('../src/skills.mjs')
  const P = (x, y, z, type = 'player') => ({ type, position: { x, y, z } })
  const me = P(10.5, 40, 10.5)
  const bot = e => ({ entity: me, entities: { 1: me, ...(e ? { 2: e } : {}) } })
  const c = [12, 40, 10]
  assert.strictEqual(bodyOnCell(bot(P(12.5, 41, 10.5)), c), true, 'standing on it')
  assert.strictEqual(bodyOnCell(bot(P(12.9, 41.8, 10.2)), c), true, 'its box over the edge, mid-jump')
  assert.strictEqual(bodyOnCell(bot(P(13.5, 41, 10.5)), c), false, 'the next column')
  assert.strictEqual(bodyOnCell(bot(P(12.5, 39, 10.5)), c), false, 'under it')
  assert.strictEqual(bodyOnCell(bot(P(12.5, 41, 10.5, 'object')), c), false, 'a dropped item is not a body')
  assert.strictEqual(bodyOnCell({ entity: P(12.5, 41, 10.5), entities: {} }, c), true, 'the bot itself counts')
})
console.log('5. THE COMPOSITION: a repair visit deep in the stair, then the egress (buildStair\'s order)')
await t('a visit repairs the dirt at step 41 and stops there; the egress takes the bot from that stand to the exit', async () => {
  const w = world()
  w.set(PLAN.steps[41].air[0], 'dirt')   // the escape pillar's leavings: LIVE `_shaft op=dig k=41 why=air`
  const st = { feet: [...EXIT] }
  const ve = {
    get read () { return w.read },
    feet: () => [...st.feet],
    walkTo: async c => { const r = astar(movesFor(w.blockAt), st.feet, new goals.GoalBlock(c[0], c[1], c[2])); if (r.status === 'success') st.feet = [...c]; return r.status === 'success' },
    dig: async c => { w.set(c, 'air'); return 'confirmed' },
    place: async c => { w.set(c, 'stone'); return 'confirmed' },
    toolOk: () => true, fence: () => true, log: () => {}, now: () => 0, aborted: () => false,
  }
  const v = await runStairVisit({ rec: REC, exit: EXIT, built: new Set([48, 32, 16]), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, ve, { reserve: G.egressReserveMs })
  assert.strictEqual(v.stop, 'complete'); assert.strictEqual(v.dug, 1)
  assert.ok(st.feet[1] < G0 - 20, `the visit ends deep in the stair (feet ${st.feet})`)
  assert.strictEqual(probe(w, st.feet), false, 'where it ends, the maroon probe fails: before shafttrap-01 the reflex took the body here')
  const b = body(w, st.feet)
  const r = await runStairEgress(PLAN, b.e, { exit: EXIT })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.deepStrictEqual(b.st.feet, EXIT)
  assert.strictEqual(probe(w, b.st.feet), true, 'at the exit the probe succeeds: no maroon, no pillar, no guard refusal')
})
await t('the reserve: a unit deep in the stair is not started when the way out would not fit (stop `time`, the way out kept)', async () => {
  const w = world()
  w.set(PLAN.steps[45].air[0], 'dirt')
  const st = { feet: [...EXIT] }
  let clock = 0
  const ve = {
    get read () { return w.read }, feet: () => [...st.feet],
    walkTo: async c => { st.feet = [...c]; return true }, dig: async c => { w.set(c, 'air'); return 'confirmed' }, place: async () => 'confirmed',
    toolOk: () => true, fence: () => true, log: () => {}, now: () => clock, aborted: () => false,
  }
  clock = 100_000
  const v = await runStairVisit({ rec: REC, exit: EXIT, built: new Set([48, 32, 16]), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, ve,
    { deadline: 100_000 + G.egressReserveMs(45) - 1, reserve: G.egressReserveMs })
  assert.strictEqual(v.stop, 'time'); assert.strictEqual(v.dug, 0); assert.deepStrictEqual(st.feet, EXIT, 'never walked down')
  const v2 = await runStairVisit({ rec: REC, exit: EXIT, built: new Set([48, 32, 16]), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, ve,
    { deadline: 100_000 + G.egressReserveMs(45) + 1, reserve: G.egressReserveMs })
  assert.strictEqual(v2.dug, 1, 'POSITIVE CONTROL: with the reserve in the budget the unit is worked')
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
await t('MUTANT KILLED: an egress that never digs does not leave the pillared stair', async () => {
  await withMutant(VISIT, "      const r = await e.dig(op.at)\n", "      const r = 'refused'\n", async mod => {
    const w = world()
    w.set(PLAN.steps[40].air[0], 'dirt')
    const { e } = body(w, G.standOf(PLAN, 44))
    const r = await mod.runStairEgress(PLAN, e, { exit: EXIT })
    assert.strictEqual(r.ok, false, 'the mutant must fail where the real code arrives')
  })
})
await t('MUTANT KILLED: egressNext reading every air cell as open sends the bot into the dirt (a hop, not the dig)', async () => {
  await withMutant(GEOM, "      if (b.boundingBox === 'empty') continue\n", '      continue\n', async mod => {
    const w = world()
    w.set(PLAN.steps[39].air[1], 'dirt')
    assert.notStrictEqual(mod.egressNext(w.read, PLAN, 40).op, 'dig')
  })
})
await t('MUTANT KILLED: without the reserve line the deep unit is started with no time for the way out', async () => {
  await withMutant(VISIT, "    if (typeof reserve === 'function' && e.now() >= deadline - (Number(reserve(w.k)) || 0)) return end('time', 'the way out is kept', w.k)\n", '', async mod => {
    const w = world()
    w.set(PLAN.steps[45].air[0], 'dirt')
    const st = { feet: [...EXIT] }
    const ve = { get read () { return w.read }, feet: () => [...st.feet], walkTo: async c => { st.feet = [...c]; return true }, dig: async c => { w.set(c, 'air'); return 'confirmed' }, place: async () => 'confirmed', toolOk: () => true, fence: () => true, log: () => {}, now: () => 100_000, aborted: () => false }
    const v = await mod.runStairVisit({ rec: REC, exit: EXIT, built: new Set([48, 32, 16]), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, ve,
      { deadline: 100_000 + G.egressReserveMs(45) - 1, reserve: G.egressReserveMs })
    assert.notStrictEqual(v.stop, 'time', 'the mutant works the unit')
  })
})

console.log('7. WIRED (structural: the call sites; behaviour is above)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
await t('buildStair runs the egress after the visit inside the same claim, keeps the reserve, and on the finished-stair return', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const a of ['}, e, { deadline: t0 + budget - STAIR_VISIT_TAIL_MS, reserve: egressReserveMs })',
    'egress = await visitEgress(bot, rec, signal, t0 + budget - EGRESS_TAIL_MS, e)',
    'const x = await withStairClaim(ctx.runner, () => visitEgress(bot, rec, signal, t0 + budget - EGRESS_TAIL_MS))',
    'const r = await runStairEgress(plan, {']) assert.strictEqual(src.split(a).length, 2, `missing or not unique: ${a}`)
  const i = src.indexOf('const r = await withStairClaim(ctx.runner, async () => { const v = await runStairVisit({')
  const j = src.indexOf('egress = await visitEgress(bot, rec, signal, t0 + budget - EGRESS_TAIL_MS, e)')
  const k = src.indexOf('      return v\n    })', j)
  assert.ok(i > 0 && j > i && k > j, 'the egress is inside the visit\'s claim, after the visit')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
