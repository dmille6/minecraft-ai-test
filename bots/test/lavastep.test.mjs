// lavastep-01 (F1 of docs/reports/mineshaft-safety-2026-10-23.md): the danger arm makes a verified, bounded move instead
// of the blind 1.5 s sprint-jump. BEHAVIOUR first (CLAUDE.md "extract the decision"): the pure decision (lavastep.mjs),
// then the executor (lavastepmove.mjs) on a fake bot with a small kinematic world, then the runner's one change, then the
// refusal CHAIN, then structural wiring (comments stripped, anchored, each with a mutant), then anchored unique mutants of
// the decision and executor lines that the gates in scripts/host/lavastepread.py are built to catch.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lavastep-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lavastep-state-'))
process.env.BOT_NAME = 'LavastepBot'
process.env.MEMORY_SCOPE = 'isolated'
process.env.LOG_LEVEL ??= 'error'

const { withMutant, withMutantsAll } = await import('./helpers/mutant.mjs')
const LS = await import('../src/lavastep.mjs')
const { dangerCase, stepPlan, evalStep, sealPlan, aimScores, chooseBearing, aimKey, stuckRelax, recordingAt, dangerMove, yawOf,
        facingIndex, BEARINGS, DANGER, lavastepOn, lavastepModeDetail, AIM_CELLS } = LS
const { makeDangerMover, attachLavastepGuard } = await import('../src/lavastepmove.mjs')
const { recoveryArmsMayRun, pillarOut } = await import('../src/reflex.mjs')
const { Runner } = await import('../src/runner.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { cellLavaSafe, LAVA_LIKE } = await import('../src/lavaguard.mjs')
const { Vec3 } = await import('vec3')
const runnerBot = () => ({ entity: { position: new Vec3(0, 64, 0), onGround: true, velocity: new Vec3(0, 0, 0), isInWater: false },
  health: 20, food: 20, version: '1.21.8', username: 'LavastepBot', registry: { blocksByName: {}, itemsByName: {}, blocks: {} },
  inventory: { items: () => [] }, blockAt: p => (p.y < 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }),
  findBlock: () => null, findBlocks: () => [], entities: {}, players: {}, time: { day: 1, age: 1 }, game: { dimension: 'overworld' },
  chat: () => {}, clearControlStates: () => {}, setControlState: () => {}, quit () {},
  pathfinder: { movements: {}, setMovements () {}, stop () {}, setGoal () {}, goto: async () => {}, getPathTo: () => ({ status: 'success', path: [1] }) } })

const LS_PATH = new URL('../src/lavastep.mjs', import.meta.url)
const MOVE_PATH = new URL('../src/lavastepmove.mjs', import.meta.url)
const RUNNER_PATH = new URL('../src/runner.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n        ')}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ------------------------------------------------------------------------------------------------ a tiny world
const EMPTY = new Set(['air', 'cave_air', 'water', 'lava', 'flowing_lava', 'fire', 'soul_fire', 'bubble_column', 'flowing_water', 'torch'])
const B = (name, x, y, z) => name == null ? null : { name, boundingBox: EMPTY.has(name) ? 'empty' : 'block', position: new Vec3(x, y, z) }
/** cells: { "x,y,z": name | null }; everything else is stone below y=64 and air from 64 up. */
function World (cells = {}) {
  const map = new Map(Object.entries(cells))
  const name = (x, y, z) => { const k = `${x},${y},${z}`; return map.has(k) ? map.get(k) : (y < 64 ? 'stone' : 'air') }
  const at = (x, y, z) => B(name(x, y, z), x, y, z)
  return { at, name, set: (x, y, z, n) => map.set(`${x},${y},${z}`, n), map }
}
const fill = (cells, x0, x1, y0, y1, z0, z1, n) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells[`${x},${y},${z}`] = n }

// THE SCENES (the Paper shapes, in miniature). Feet level is y=64, the floor y=63.
const SCENES = {
  // S1 a pool edge, facing the pool: lava replaces the floor for x >= 1; the bot's centre is over (1,63,0), its body on (0,63,0)
  poolEdge: () => { const c = {}; fill(c, 1, 6, 63, 63, -4, 4, 'lava'); return { cells: c, pos: [1.2, 64, 0.5], yaw: yawOf([1, 0]), onGround: true } },
  // S2 1-deep lava, 1 block from shore: the feet in lava at x=1..4 over a stone floor; the shore x <= 0
  oneDeep: () => { const c = {}; fill(c, 1, 4, 64, 64, -4, 4, 'lava'); return { cells: c, pos: [1.5, 64, 0.5], yaw: yawOf([1, 0]), onGround: true } },
  // S3 a 1-wide ledge (z = 0) over a lava lake level with it on both sides; the centre over the lake at z = 1
  ledge: () => { const c = {}; fill(c, -8, 8, 63, 63, 1, 5, 'lava'); fill(c, -8, 8, 63, 63, -5, -1, 'lava'); return { cells: c, pos: [0.5, 64, 1.2], yaw: yawOf([0, 1]), onGround: true } },
  // S4 a magma floor in a stone plain
  magma: () => ({ cells: { '0,63,0': 'magma_block' }, pos: [0.5, 64, 0.5], yaw: 0, onGround: true }),
  // S6 a campfire underfoot (the body is IN its cell: the feet cell is the campfire)
  campfire: () => ({ cells: { '0,64,0': 'campfire' }, pos: [0.5, 64.44, 0.5], yaw: 0, onGround: true }),
  // the enclosed unsealable floor: magma under a bot walled in on all four sides, roof on
  walledMagma: () => { const c = { '0,63,0': 'magma_block' }; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c[`${dx},64,${dz}`] = 'stone'; c[`${dx},65,${dz}`] = 'stone' } c['0,66,0'] = 'stone'; return { cells: c, pos: [0.5, 64, 0.5], yaw: 0, onGround: true } },
  // the same walls over LAVA under the centre (lava is never relaxed)
  walledLava: () => { const c = { '0,63,0': 'lava' }; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c[`${dx},64,${dz}`] = 'stone'; c[`${dx},65,${dz}`] = 'stone' } c['0,66,0'] = 'stone'; return { cells: c, pos: [0.5, 64, 0.5], yaw: 0, onGround: true } },
}

// ------------------------------------------------------------------------------------------------ A. the case
await t('A1 the trigger set is exactly the reflex arm\'s (recoveryArmsMayRun refuses exactly DANGER, at the feet or below)', () => {
  const names = ['air', 'cave_air', 'stone', 'water', 'bubble_column', 'lava', 'flowing_lava', 'fire', 'soul_fire', 'campfire', 'soul_campfire', 'magma_block', 'dirt']
  for (const n of names) {
    assert.equal(!recoveryArmsMayRun({ feetName: n, belowName: 'stone' }), DANGER.has(n), `feet ${n}`)
    assert.equal(!recoveryArmsMayRun({ feetName: 'air', belowName: n }), DANGER.has(n), `below ${n}`)
  }
})
await t('A2 dangerCase is exhaustive and exclusive over feet x below x onGround, with precedence in > airborne > edge', () => {
  const names = ['air', 'cave_air', 'stone', 'water', 'bubble_column', 'lava', 'fire', 'soul_fire', 'campfire', 'magma_block']
  for (const feet of names) for (const below of names) for (const onGround of [true, false]) {
    const k = dangerCase({ feet, below, onGround })
    const fires = DANGER.has(feet) || DANGER.has(below)
    if (!fires) { assert.equal(k, null); continue }
    assert.ok(['in', 'airborne', 'edge'].includes(k), `${feet}/${below}/${onGround} -> ${k}`)
    if (DANGER.has(feet)) assert.equal(k, 'in', 'feet in a DANGER block is in, airborne or not')
    else if (['water', 'bubble_column'].includes(feet)) assert.equal(k, 'in', 'a bot in water over DANGER is in, not edge')
    else assert.equal(k, onGround ? 'edge' : 'airborne')
  }
  assert.equal(dangerCase({ feet: 'fire', below: 'air', onGround: false }), 'in', 'an airborne bot with its feet in fire is in')
  assert.equal(dangerCase({ feet: 'water', below: 'magma_block', onGround: true }), 'in')
})

// ------------------------------------------------------------------------------------------------ B. the search
// An INDEPENDENT checker of a plan's steps (G1's rule): every executed step's destination body and floor, and its swept
// lateral cells, are known and DANGER-free; only the first step's origin (and, in `in`, its laterals) is exempt.
function g1Violations (at, origin, plan, kase) {
  const bad = []
  let from = origin
  plan.forEach((st, i) => {
    const to = st.to, dx = Math.sign(to[0] - from[0]), dz = Math.sign(to[2] - from[2])
    const lat = dx ? [[0, -1], [0, 0], [0, 1]] : [[-1, 0], [0, 0], [1, 0]]
    const cells = [[to[0], to[1], to[2]], [to[0], to[1] + 1, to[2]], [to[0], to[1] - 1, to[2]]]
    for (const [lx, lz] of lat) {
      if (!(i === 0 && (kase === 'in' || (lx === 0 && lz === 0)))) cells.push([from[0] + lx, from[1], from[2] + lz])
      cells.push([to[0] + lx, to[1], to[2] + lz])
    }
    for (const c of cells) { const b = at(...c); if (b == null || DANGER.has(b.name) || LAVA_LIKE.has(b.name)) bad.push({ i, c, n: b?.name ?? null }) }
    from = to
  })
  return bad
}
await t('B1 S4 magma floor (edge): one verified step onto stone, lava-safe; nothing DANGER in its sweep', () => {
  const s = SCENES.magma(); const w = World(s.cells)
  const r = stepPlan(w.at, [0, 64, 0], 'edge')
  assert.ok(r.plan, JSON.stringify(r.candidates)); assert.equal(r.plan.length, 1)
  assert.equal(cellLavaSafe(w.at, ...r.plan[0].to).safe, true)
  assert.deepEqual(g1Violations(w.at, [0, 64, 0], r.plan, 'edge'), [])
})
await t('B2 S2 feet in 1-deep lava (in): two steps -- the shore cell beside the lava, then a lava-safe one; origin laterals exempt', () => {
  const s = SCENES.oneDeep(); const w = World(s.cells)
  const r = stepPlan(w.at, [1, 64, 0], 'in')
  assert.ok(r.plan, JSON.stringify(r.candidates.slice(0, 6)))
  assert.deepEqual(r.plan.map(p => p.to), [[0, 64, 0], [-1, 64, 0]])
  assert.equal(cellLavaSafe(w.at, 0, 64, 0).safe, false, 'the first step is an intermediate: lava beside it')
  assert.equal(cellLavaSafe(w.at, -1, 64, 0).safe, true, 'the goal is lava-safe')
  assert.deepEqual(g1Violations(w.at, [1, 64, 0], r.plan, 'in'), [])
  const asEdge = stepPlan(w.at, [1, 64, 0], 'edge')
  assert.equal(asEdge.plan, null, 'the same origin as an edge (laterals not exempt) has no plan')
})
await t('B3 S1 pool edge (edge): no plan (the origin\'s lateral cells hang over the pool), every candidate recorded with a reason', () => {
  const s = SCENES.poolEdge(); const w = World(s.cells)
  const r = stepPlan(w.at, [1, 64, 0], 'edge')
  assert.equal(r.plan, null)
  assert.ok(r.candidates.length >= 4 && r.candidates.every(c => typeof c.why === 'string' && c.why.length), JSON.stringify(r.candidates))
  assert.ok(r.candidates.some(c => /sweep unsupported/.test(c.why)))
})
await t('B4 unknown cells refuse; a 1-up step needs jump room and a 1-down step needs room overhead', () => {
  const s = SCENES.magma(); const w = World({ ...s.cells, '1,64,0': null, '-1,64,0': null, '0,64,1': null, '0,64,-1': null })
  assert.equal(stepPlan(w.at, [0, 64, 0], 'edge').plan, null, 'every neighbour unknown -> no plan')
  // a 1-up step: the cell at x=1 is a stone block with air above; with stone over the origin's head it is refused
  const up = World({ '0,63,0': 'magma_block', '-1,64,0': 'stone', '-1,65,0': 'stone', '0,64,1': 'stone', '0,65,1': 'stone', '0,64,-1': 'stone', '0,65,-1': 'stone', '1,64,0': 'stone' })
  const a = evalStep(up.at, [0, 64, 0], 1, 0, { first: true, kase: 'edge' })
  assert.equal(a.ok, true); assert.equal(a.dy, 1); assert.deepEqual(a.to, [1, 65, 0])
  up.set(0, 66, 0, 'stone')
  const b = evalStep(up.at, [0, 64, 0], 1, 0, { first: true, kase: 'edge' })
  assert.equal(b.ok, false); assert.equal(b.why, 'body blocked', 'with no jump room the 1-up is refused and dy 0 is reported')
})
await t('B5 the search is bounded (<= 3 steps, <= ~70 step evaluations) and returns the shortest plan', () => {
  // a corridor: lava floor everywhere except a stone strip along x from the origin; the goal is 3 steps away
  const c = {}; fill(c, -6, 6, 63, 63, -6, 6, 'lava'); fill(c, 0, 6, 63, 63, -1, 1, 'stone'); c['0,63,0'] = 'magma_block'
  fill(c, 0, 2, 64, 64, -1, -1, 'lava')
  const w = World(c)
  const r = stepPlan(w.at, [0, 64, 0], 'edge')
  assert.ok(r.candidates.length <= 70, `${r.candidates.length}`)
  if (r.plan) assert.ok(r.plan.length <= 3)
  const far = stepPlan(w.at, [0, 64, 0], 'edge', { maxSteps: 1 })
  assert.ok(!far.plan || far.plan.length === 1)
})
await t('B6 PROPERTY: over 400 random worlds no returned plan has a DANGER or unknown cell where G1 forbids it', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  let plans = 0
  for (let i = 0; i < 400; i++) {
    const c = {}
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      const r = rnd(); c[`${x},63,${z}`] = r < 0.25 ? 'lava' : r < 0.3 ? 'magma_block' : r < 0.33 ? null : 'stone'
      const h = rnd(); c[`${x},64,${z}`] = h < 0.08 ? 'stone' : h < 0.12 ? 'lava' : h < 0.14 ? 'fire' : 'air'
    }
    c['0,63,0'] = rnd() < 0.5 ? 'lava' : 'magma_block'; c['0,64,0'] = rnd() < 0.5 ? 'air' : 'lava'
    const w = World(c)
    const kase = dangerCase({ feet: w.name(0, 64, 0), below: w.name(0, 63, 0), onGround: true })
    const r = stepPlan(w.at, [0, 64, 0], kase)
    if (r.plan) {
      plans++
      assert.deepEqual(g1Violations(w.at, [0, 64, 0], r.plan, kase), [], JSON.stringify(c))
      assert.equal(cellLavaSafe(w.at, ...r.plan.at(-1).to).safe, true, 'the goal is strictly lava-safe')
      // every intermediate is lava-safe with ONLY the origin's feet cell masked (the one exemption)
      const masked = (x, y, z) => (x === 0 && y === 64 && z === 0) ? { name: 'air', boundingBox: 'empty' } : w.at(x, y, z)
      for (const st of r.plan.slice(0, -1)) assert.equal(cellLavaSafe(masked, ...st.to).safe, true, `intermediate ${st.to}`)
    }
  }
  assert.ok(plans > 20, `the generator must produce plans (${plans}) or the property proves nothing`)
})

// ------------------------------------------------------------------------------------------------ C. seal, aim, stuck
await t('C1 seal: lava under the centre + cobble -> the block below as reference, face up; magma/campfire never; no cobble -> none; a chest is never the reference', () => {
  const s = SCENES.poolEdge(); const w = World(s.cells)
  const ok = sealPlan(w.at, [1, 64, 0], ['dirt', 'cobblestone'])
  assert.equal(ok.ok, true); assert.deepEqual(ok.cell, [1, 63, 0]); assert.deepEqual(ok.ref, [1, 62, 0]); assert.deepEqual(ok.face, [0, 1, 0]); assert.equal(ok.item, 'cobblestone')
  assert.equal(sealPlan(w.at, [1, 64, 0], ['cobbled_deepslate']).item, 'cobbled_deepslate')
  assert.equal(sealPlan(w.at, [1, 64, 0], ['dirt', 'oak_log']).ok, false)
  assert.match(sealPlan(World(SCENES.magma().cells).at, [0, 64, 0], ['cobblestone']).why, /not replaceable/)
  const chest = World({ ...s.cells, '1,62,0': 'chest' })
  const c2 = sealPlan(chest.at, [1, 64, 0], ['cobblestone'])
  assert.equal(c2.ok, true); assert.deepEqual(c2.ref, [0, 63, 0], 'the side block, not the chest'); assert.deepEqual(c2.face, [1, 0, 0])
  const fire = World({ '0,63,0': 'fire' })
  assert.equal(sealPlan(fire.at, [0, 64, 0], ['cobblestone']).ok, true, 'fire is replaceable')
})
await t('C2 aim: facing the pool, the chosen bearing is the fully supported one away from it, never the facing one', () => {
  const s = SCENES.poolEdge(); const w = World(s.cells)
  const sc = aimScores(w.at, [1, 64, 0])
  const ch = chooseBearing(sc, s.yaw)
  assert.deepEqual(ch.b, [-1, 0])
  assert.notEqual(ch.index, facingIndex(s.yaw))
  assert.equal(sc[ch.index].support, AIM_CELLS); assert.equal(sc[ch.index].collision, 0)
})
await t('C3 aim ordering: full support beats partial; with none full, collision-free first, then most support, then fewest DANGER; ties go to a CARDINAL bearing, then away from the facing', () => {
  const mk = (support, collision, danger) => ({ b: [0, 0], support, collision, danger })
  const sc = [mk(3, 0, 2), mk(6, 0, 1), mk(6, 0, 0), mk(5, 1, 0), mk(0, 6, 0), mk(6, 1, 0), mk(2, 0, 0), mk(6, 0, 0)]
  sc.forEach((s, i) => { s.b = BEARINGS[i] })
  assert.equal(chooseBearing(sc, yawOf(BEARINGS[7])).index, 2, 'tie between 2 (cardinal) and 7 (diagonal): the cardinal')
  assert.equal(chooseBearing(sc, yawOf(BEARINGS[2])).index, 2, 'facing 2: still the cardinal, never the diagonal')
  const cards = BEARINGS.map(b => ({ b, support: 6, collision: 0, danger: 0 }))
  assert.equal(chooseBearing(cards, yawOf(BEARINGS[2])).index, 6, 'all tied: the cardinal farthest from the facing')
  const none = [mk(3, 0, 2), mk(4, 1, 0), mk(3, 0, 1), mk(0, 6, 0), mk(5, 2, 0), mk(1, 0, 0), mk(3, 0, 1), mk(2, 0, 0)]
  none.forEach((s, i) => { s.b = BEARINGS[i] })
  assert.equal(chooseBearing(none, 0).index, 2, 'collision-free, most support (3), fewest DANGER (1)')
  assert.ok(aimKey(mk(6, 0, 5)) < aimKey(mk(5, 0, 0)) || aimKey(mk(6, 0, 5))[0] === 0)
})
await t('C3b the 1-wide ledge between two lakes, no cobble (Paper 10-23): S, SE and SW tie, and the CARDINAL S is the aim -- the diagonal crossing of a lake is 41% more lava', () => {
  const s = SCENES.ledge(); const w = World(s.cells)
  const sc = aimScores(w.at, [0, 64, 1])
  const keys = [3, 4, 5].map(i => JSON.stringify(aimKey(sc[i])))
  assert.equal(new Set(keys).size, 1, `S, SE, SW tie: ${keys}`)
  assert.equal(chooseBearing(sc, s.yaw).index, 4, 'S, the cardinal')
})
await t('C4 stuck: three firings under 0.5 block on magma or a campfire relax it; lava and fire never; one real move resets it', () => {
  assert.equal(stuckRelax([0.1, 0.2, 0.0], 'magma_block'), true)
  assert.equal(stuckRelax([0.1, 0.2, 0.0], 'campfire'), true)
  assert.equal(stuckRelax([0.1, 0.2, 0.0], 'lava'), false)
  assert.equal(stuckRelax([0.1, 0.2, 0.0], 'fire'), false)
  assert.equal(stuckRelax([0.1, 0.9, 0.0], 'magma_block'), false)
  assert.equal(stuckRelax([0.1, 0.2], 'magma_block'), false)
})
await t('C5 the recorder keeps the FIRST read of each cell relative to the origin, null for unknown, and the boxes', () => {
  const w = World({ '1,64,0': null })
  const rec = recordingAt(w.at, [0, 64, 0])
  rec(1, 64, 0); rec(0, 63, 0); rec(0, 63, 0)
  assert.deepEqual(rec.cells, { '1,0,0': null, '0,-1,0': 'stone' }); assert.equal(rec.boxes.stone, 'block')
})
await t('C6 the whole decision: magma -> plan; pool edge + cobble -> seal and an aim fallback; pool edge, no cobble -> aim; airborne -> nothing to plan', () => {
  const m = SCENES.magma(), mw = World(m.cells)
  assert.ok(dangerMove({ at: mw.at, origin: [0, 64, 0], feet: 'air', below: 'magma_block', onGround: true }).plan)
  const p = SCENES.poolEdge(), pw = World(p.cells)
  const d1 = dangerMove({ at: pw.at, origin: [1, 64, 0], feet: 'air', below: 'lava', onGround: true, items: ['cobblestone'], yaw0: p.yaw })
  assert.equal(d1.kase, 'edge'); assert.equal(d1.plan, null); assert.equal(d1.seal.ok, true); assert.deepEqual(d1.aim.choice.b, [-1, 0])
  const d2 = dangerMove({ at: pw.at, origin: [1, 64, 0], feet: 'air', below: 'lava', onGround: true, items: [], yaw0: p.yaw })
  assert.equal(d2.seal.ok, false)
  assert.equal(dangerMove({ at: pw.at, origin: [1, 64, 0], feet: 'air', below: 'lava', onGround: false }).kase, 'airborne')
  assert.equal(dangerMove({ at: pw.at, origin: [1, 64, 0], feet: 'oneDeep' === 'x' ? 'air' : 'lava', below: 'stone', onGround: true }).seal, null, '`in` never seals')
})
await t('C7 LAVASTEP=0 is the rollback; the licence row names it', () => {
  assert.equal(lavastepOn({}), true); assert.equal(lavastepOn({ LAVASTEP: '0' }), false); assert.equal(lavastepOn({ LAVASTEP: '1' }), true)
  assert.match(lavastepModeDetail({}), /^on=1 .*rollback=LAVASTEP=0$/); assert.match(lavastepModeDetail({ LAVASTEP: '0' }), /^on=0 /)
})

// ------------------------------------------------------------------------------------------------ D. the executor on a fake bot
// A kinematic fake: forward moves the body along its yaw (0.2 b / 50 ms walking, 0.28 sprinting, half in lava); the AABB
// (half-width 0.3) rests on any solid floor under a corner; with none it falls; a solid feet cell blocks (a jump over a
// 1-high block steps up). Health: lava 8/s, fire/campfire 2/s, magma underfoot 2/s unless sneaking.
const EventEmitter = (await import('node:events')).EventEmitter
function fakeBot (scene, { items = [], health = 20, physics = true, placeWorks = true, arc = false } = {}) {
  const w = World(scene.cells)
  const bot = new EventEmitter()
  const V = (x, y, z) => ({ x, y, z, offset (a, b, c) { return V(this.x + a, this.y + b, this.z + c) }, clone () { return V(this.x, this.y, this.z) },
                            floored () { return V(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) } })
  bot.world = w
  bot.entity = { position: V(...scene.pos), yaw: scene.yaw ?? 0, pitch: 0, onGround: scene.onGround !== false, isInWater: false, eyeHeight: 1.62 }
  bot.health = health
  bot.controls = { forward: false, sprint: false, jump: false, sneak: false, back: false }
  bot.writes = []
  bot.setControlState = (n, v) => { bot.controls[n] = v; bot.writes.push([n, v, Date.now()]) }
  bot.clearControlStates = () => { for (const k of Object.keys(bot.controls)) bot.controls[k] = false }
  bot.looks = []
  bot.look = (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; bot.looks.push([yaw, Date.now()]); return Promise.resolve() }
  bot.lookAt = async () => {}
  bot.blockAt = v => w.at(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z))
  bot.pathfinder = { goal: null, setGoal (g) { this.goal = g; bot.clearControlStates() }, isMoving: () => false }
  bot.targetDigBlock = null; bot.stopped = 0
  bot.stopDigging = () => { bot.stopped++; bot.targetDigBlock = null }
  bot.inv = items.map(n => ({ name: n, count: 64 }))
  bot.inventory = { items: () => bot.inv }
  bot.heldItem = null
  bot.equipHang = false
  bot.equip = it => bot.equipHang ? new Promise(() => {}) : (bot.heldItem = it, Promise.resolve())
  bot.places = []
  bot.dig = (b) => { bot.digs++; if (b?.position && bot.digOpens) w.set(b.position.x, b.position.y, b.position.z, 'air'); return Promise.resolve('dug') }; bot.digs = 0; bot.digOpens = false
  bot._genericPlace = async (ref, face) => {
    const c = [ref.position.x + face.x, ref.position.y + face.y, ref.position.z + face.z]
    bot.places.push(c)
    if (placeWorks && bot.heldItem) setTimeout(() => { const old = w.at(...c); w.set(...c, bot.heldItem.name); bot.emit('blockUpdate', old, w.at(...c)) }, 60)
  }
  const solidAt = (x, y, z) => w.at(x, y, z)?.boundingBox === 'block'
  const supported = p => {
    const y = Math.floor(p.y + 1e-6)
    if (p.y - y > 1e-6 && !(w.name(Math.floor(p.x), y, Math.floor(p.z)) === 'campfire')) return false
    if (w.name(Math.floor(p.x), y, Math.floor(p.z)) === 'campfire') return true
    for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) if (solidAt(Math.floor(p.x + ox), y - 1, Math.floor(p.z + oz))) return true
    return false
  }
  let tickN = 0, vy = 0, cool = 0
  const standY = (x, z, y) => { for (let yy = Math.floor(y + 1e-6); yy >= Math.floor(y) - 3; yy--) if (supported({ x, y: yy, z })) return yy; return -Infinity }
  bot._timer = setInterval(() => {
    if (!physics || bot.health <= 0) return
    tickN++
    if (arc) {
      const p = bot.entity.position
      if (bot.controls.forward) {
        const sp = (bot.controls.sprint ? 0.28 : 0.2) * (bot.controls.sneak ? 0.3 : 1)
        const nx = p.x - Math.sin(bot.entity.yaw) * sp, nz = p.z - Math.cos(bot.entity.yaw) * sp
        const free = [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].every(([ox, oz]) => !solidAt(Math.floor(nx + ox), Math.floor(p.y), Math.floor(nz + oz)) && !solidAt(Math.floor(nx + ox), Math.floor(p.y) + 1, Math.floor(nz + oz)))
        if (free) { p.x = nx; p.z = nz }
      }
      cool--
      if (bot.entity.onGround && bot.controls.jump && cool <= 0) { vy = 0.42; bot.entity.onGround = false; cool = 10; bot.jumps = (bot.jumps ?? 0) + 1 }
      if (!bot.entity.onGround) {
        let ny = p.y + vy; vy = (vy - 0.08) * 0.98
        if (vy > 0 && solidAt(Math.floor(p.x), Math.floor(ny + 1.8), Math.floor(p.z))) { vy = 0; ny = p.y }
        const g = standY(p.x, p.z, p.y)
        if (vy <= 0 && ny <= g) { p.y = g; bot.entity.onGround = true; vy = 0 } else p.y = ny
      } else if (!supported(p)) { bot.entity.onGround = false; vy = 0 }
      const b2 = w.name(Math.floor(p.x), Math.floor(p.y + 1e-6) - 1, Math.floor(p.z))
      if (b2 === 'magma_block' && bot.entity.onGround && !bot.controls.sneak && tickN % 10 === 0) bot.health -= 1
      return
    }
    const p = bot.entity.position
    const feetN = w.name(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const inLava = feetN === 'lava'
    if (bot.controls.forward) {
      const sp = (bot.controls.sprint ? 0.28 : 0.2) * (inLava ? 0.5 : 1) * (bot.controls.sneak ? 0.3 : 1)
      const nx = p.x - Math.sin(bot.entity.yaw) * sp, nz = p.z - Math.cos(bot.entity.yaw) * sp
      const fx = Math.floor(nx), fz = Math.floor(nz), fy = Math.floor(p.y)
      const boxFree = (x, z, y) => [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].every(([ox, oz]) => !solidAt(Math.floor(x + ox), y, Math.floor(z + oz)) && !solidAt(Math.floor(x + ox), y + 1, Math.floor(z + oz)))
      if (boxFree(nx, nz, fy)) { p.x = nx; p.z = nz }
      else if ((bot.controls.jump || true) && solidAt(fx, fy, fz) && !solidAt(fx, fy + 1, fz) && !solidAt(fx, fy + 2, fz) && !solidAt(Math.floor(p.x), fy + 2, Math.floor(p.z))) { p.x = nx; p.z = nz; p.y = fy + 1 }
    }
    if (supported(p)) { bot.entity.onGround = true; p.y = w.name(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === 'campfire' ? p.y : Math.floor(p.y + 1e-6) }
    else {
      const below = w.name(Math.floor(p.x), Math.floor(p.y + 1e-6) - 1, Math.floor(p.z))
      if (feetN === 'lava' && solidAt(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))) { bot.entity.onGround = true; p.y = Math.floor(p.y) }
      else { bot.entity.onGround = false; p.y = Math.max(Math.floor(p.y + 1e-6) - 1, p.y - 0.25); if (below === 'lava') { bot.entity.onGround = false } }
    }
    const f2 = w.name(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), b2 = w.name(Math.floor(p.x), Math.floor(p.y + 1e-6) - 1, Math.floor(p.z))
    if (f2 === 'lava') bot.health -= 0.4
    else if ((f2 === 'fire' || f2 === 'campfire') && tickN % 10 === 0) bot.health -= 1
    else if (b2 === 'magma_block' && bot.entity.onGround && !bot.controls.sneak && tickN % 10 === 0) bot.health -= 1
  }, 50)
  bot.done = () => clearInterval(bot._timer)
  return bot
}
// an OPEN-TOPPED pit: magma floor, walls two high on all four sides, nothing overhead (a 1x1 shaft dug down onto magma)
SCENES.openPit = () => { const c = { '0,63,0': 'magma_block' }; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c[`${dx},64,${dz}`] = 'stone'; c[`${dx},65,${dz}`] = 'stone'; c[`${dx},66,${dz}`] = 'stone' } return { cells: c, pos: [0.5, 64, 0.5], yaw: 0, onGround: true } }
const fakeRunner = () => {
  const calls = []
  return { calls, res: null, gen: 0,
    reserve (owner, ms, reason) { calls.push(['reserve', owner, ms, reason]); this.res = { owner, gen: ++this.gen, until: Date.now() + ms }; return { gen: this.gen } },
    releaseReservation (g) { calls.push(['release', g]); if (this.res?.gen === g) this.res = null },
    interrupt (r) { calls.push(['interrupt', r]) }, activeReservation () { return this.res && Date.now() < this.res.until ? this.res : null } }
}
const feetBelow = bot => { const p = bot.entity.position; return { feet: bot.blockAt({ x: p.x, y: p.y, z: p.z }), below: bot.blockAt({ x: p.x, y: p.y - 1, z: p.z }) } }
function harness (sceneName, opts = {}) {
  const scene = SCENES[sceneName]()
  const bot = fakeBot(scene, opts)
  const runner = opts.runner ?? fakeRunner()
  const rows = []
  let air = false
  const mover = makeDangerMover(bot, runner, { airHolds: () => air, emit: r => rows.push(r), timing: { after: 0, ...(opts.timing ?? {}) } })
  return { bot, runner, rows, mover, setAir: v => { air = v }, fire: () => mover.maybeFire(feetBelow(bot)) }
}
const firing = rows => rows.filter(r => r.args?.phase === 'firing')

await t('D1 S4 magma (edge plan): walks to the safe cell, never sprints, no jump on a level step; reservation taken and released; one row', async () => {
  const h = harness('magma')
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.case, 'edge'); assert.equal(r.outcome, 'plan'); assert.equal(r.ended, 'done')
  assert.ok(r.steps[0].post, JSON.stringify(r.steps))
  assert.ok(!r.controls.some(([c, v]) => c === 'sprint' && v), 'never sprint on an edge plan step')
  assert.ok(!r.controls.some(([c, v]) => c === 'jump' && v), 'no jump on a level step')
  assert.equal(h.runner.calls[0][0], 'reserve'); assert.equal(h.runner.calls[0][1], 'lavastep')
  assert.ok(h.runner.calls.some(c => c[0] === 'release'), 'released by generation')
  assert.equal(DANGER.has(h.bot.blockAt(h.bot.entity.position.offset(0, -1, 0)).name), false, 'off the magma')
  assert.equal(h.mover.moving(), false)
})
await t('D2 S1 pool edge facing the pool, no cobble: the aimed escape sprints AWAY from the pool (the base sprint faces it)', async () => {
  const h = harness('poolEdge')
  const yaw0 = h.bot.entity.yaw
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.outcome, 'aim'); assert.deepEqual(r.path, ['aim'])
  assert.equal(BEARINGS[r.aim.chosen][0], -1, 'west, away from the pool'); assert.notEqual(r.aim.chosen, facingIndex(yaw0))
  assert.ok(h.bot.entity.position.x < 1, `the bot is on the shore: x=${h.bot.entity.position.x}`)
  assert.ok(h.bot.health > 19, `no burn: ${h.bot.health}`)
  assert.equal(h.bot.controls.forward || h.bot.controls.sprint || h.bot.controls.jump, false, 'controls cleared at the end')
})
await t('D3 S1 with cobble: the seal is witnessed, the case re-classified at once, and the bot no longer stands over lava', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'] })
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.seal.witnessed, true); assert.equal(r.seal.next, 'reclassify'); assert.equal(r.seal.item, 'cobblestone')
  assert.equal(r.outcome, 'sealed'); assert.equal(h.bot.world.name(1, 63, 0), 'cobblestone')
  assert.deepEqual(h.bot.places, [[1, 63, 0]])
  assert.deepEqual(r.items, ['cobblestone'], 'the seal items the decision saw')
  assert.equal(r.seal.held, 'cobblestone'); assert.equal(r.seal.placeHeld, 'cobblestone'); assert.equal(r.seal.update.name, 'cobblestone')
  assert.equal(r.seal.cellName, 'lava', 'the cell as read before the place')
  assert.equal(r.reclass, null, 're-classified: no danger left'); assert.ok(r.replan && r.replan.cells, 'the re-classification observation is recorded')
})
await t('D4 S1 with cobble but the server never places it: unwitnessed -> the aimed escape, never a re-classification', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'], placeWorks: false })
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.seal.witnessed, false); assert.equal(r.seal.next, 'aim'); assert.equal(r.outcome, 'seal_failed_aim')
  assert.deepEqual(r.path, ['seal', 'aim'])
})
await t('D5 S2 feet in lava (in plan): first step sprint+jump, second a walk; the bot ends on the lava-safe cell', async () => {
  const h = harness('oneDeep')
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.case, 'in'); assert.equal(r.outcome, 'plan', JSON.stringify(r.steps))
  assert.equal(r.steps[0].sprint, true); assert.equal(r.steps[0].jump, true)
  assert.equal(r.steps[1].sprint, false); assert.equal(r.steps[1].jump, false)
  const c = h.bot.entity.position.floored(); assert.deepEqual([c.x, c.y, c.z], [-1, 64, 0])
  assert.ok(r.steps.every(s => s.plan === 'decision' && s.origin.join() === '1,64,0'), 'each step names its plan and origin')
})
await t('D6 `in` with a step that does not arrive (the body cannot move): straight to the aimed escape, no wait for the next firing', async () => {
  const h = harness('oneDeep', { physics: false })
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.deepEqual(r.path, ['plan', 'aim']); assert.equal(r.outcome, 'plan_missed_aim'); assert.equal(r.steps[0].post, false)
  assert.ok(r.aim && r.aim.chosen != null)
})
await t('D7 airborne: forward, sprint and jump released; no look written; the skill stopped and no run starts mid-fall', async () => {
  const s = SCENES.poolEdge(); s.onGround = false; s.pos = [3.5, 64.6, 0.5]
  const bot = fakeBot({ ...s, cells: s.cells }, { physics: false }); bot.entity.onGround = false
  bot.controls.forward = bot.controls.sprint = bot.controls.jump = true
  const runner = fakeRunner(); const rows = []
  const mover = makeDangerMover(bot, runner, { emit: r => rows.push(r), timing: { after: 0 } })
  const out = mover.maybeFire(feetBelow(bot))
  bot.done(); await sleep(10)
  assert.equal(out.kase, 'airborne'); assert.equal(bot.controls.forward || bot.controls.sprint || bot.controls.jump, false)
  assert.equal(bot.looks.length, 0, 'no steering'); assert.equal(runner.calls[0][1], 'lavastep'); assert.equal(mover.moving(), false)
  assert.equal(mover.maybeFire(feetBelow(bot)), null, 'one airborne firing per tick (450 ms), not per call')
})
await t('D8 overlapping ticks during an `in` sprint-jump: no re-classification and no airborne release mid-arc', async () => {
  const h = harness('oneDeep')
  const p = h.fire()
  await sleep(120)
  h.bot.entity.onGround = false
  const again = [h.fire(), h.fire(), h.fire()]
  assert.deepEqual(again, [null, null, null], 'in flight: the arm does not re-classify')
  assert.equal(h.bot.controls.forward, true, 'the move still holds forward')
  await p; h.bot.done()
  assert.equal(firing(h.rows).length, 1)
})
await t('D9 an entombed pillarOut running when a move starts stops at its next ownership check and places nothing after', async () => {
  const h = harness('oneDeep')
  // a pillar bot in a dry shaft (airpocket.test K7's fixture shape), alive = the reflex's ownsBody: !dangerMovingNow()
  const pbot = fakeBot({ cells: { '0,63,0': 'stone' }, pos: [10.5, 64, 10.5], yaw: 0 }, { physics: false, items: [] })
  pbot.inv = [{ name: 'cobblestone', count: 64, type: 2 }]
  let placed = 0; pbot.placeBlock = async () => { placed++ }
  pbot.entity.position = Object.assign(pbot.entity.position, { distanceTo: () => 0 })
  let calls = 0
  const alive = () => { calls++; if (calls === 3) h.fire(); return !h.mover.moving() }
  const r = await pillarOut(pbot, 3, { alive }).catch(e => 'threw:' + e.message)
  pbot.done(); await sleep(2600); h.bot.done()
  assert.equal(r, 'preempted'); assert.equal(placed, 0)
  // POSITIVE CONTROL: the same climb with no move does reach a placement (else this test proves nothing)
  const cbot = fakeBot({ cells: { '0,63,0': 'stone' }, pos: [10.5, 64, 10.5], yaw: 0 }, { physics: false, items: [] })
  cbot.inv = [{ name: 'cobblestone', count: 64, type: 2 }]
  let cplaced = 0; cbot.placeBlock = async () => { cplaced++ }
  await pillarOut(cbot, 1, { alive: () => true }).catch(() => {}); cbot.done()
  assert.ok(cplaced >= 1, 'the fixture never reaches a placement')
})
await t('D10 a skill finally that clears controls 200 ms in, and a lookAt from an unwinding dig: both overridden within 50 ms', async () => {
  const h = harness('poolEdge')
  const p = h.fire()
  await sleep(200)
  h.bot.clearControlStates(); h.bot.entity.yaw = 2.5
  await sleep(70)
  assert.equal(h.bot.controls.forward, true, 'forward re-asserted'); assert.equal(h.bot.controls.sprint, true, 'sprint re-asserted')
  assert.ok(Math.abs(h.bot.entity.yaw - yawOf([-1, 0])) < 1e-9, `look re-asserted: ${h.bot.entity.yaw}`)
  h.bot.pathfinder.goal = { x: 9 }
  await sleep(70)
  assert.equal(h.bot.pathfinder.goal, null, 'a late pathfinder goal is cleared')
  await p; h.bot.done()
})
await t('D11 the air rescue takes the body mid-move: the move ends at once and leaves the rescue\'s controls alone', async () => {
  const h = harness('poolEdge')
  const p = h.fire()
  await sleep(250)
  h.setAir(true)
  h.bot.setControlState('forward', true); h.bot.setControlState('jump', true)   // the rescue's stroke
  const mark = h.bot.writes.length
  await p; await sleep(80); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.ended, 'air')
  assert.equal(h.bot.writes.slice(mark).length, 0, 'the move wrote nothing after the rescue took the body')
  assert.equal(h.bot.controls.forward, true); assert.equal(h.mover.moving(), false)
  assert.equal(h.mover.maybeFire(feetBelow(h.bot)), null, 'and no move starts while the air rescue holds the body')
})
await t('D12 a hung await past the deadline: the move ends by its deadline (controls cleared, reservation released) and never steers again', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'], timing: { move: 500 } })
  h.bot.equipHang = true
  const p = h.fire()
  await sleep(650)
  assert.equal(h.mover.moving(), false)
  assert.ok(h.runner.calls.some(c => c[0] === 'release'))
  const mark = h.bot.writes.length
  await sleep(200); h.bot.done()
  assert.equal(h.bot.writes.length, mark, 'nothing written after the deadline')
  assert.equal(firing(h.rows)[0].args.ended, 'deadline')
  void p
})
await t('D13 a death mid-move ends it; after the respawn the next firing is a fresh move', async () => {
  const h = harness('poolEdge')
  const p = h.fire()
  await sleep(150); h.bot.health = 0
  await p
  assert.equal(firing(h.rows)[0].args.ended, 'dead'); assert.equal(h.mover.moving(), false)
  h.bot.health = 20; h.bot.entity.position.x = 1.2; h.bot.entity.position.z = 0.5; h.bot.entity.yaw = yawOf([1, 0])
  await sleep(2600)
  const p2 = h.fire()
  assert.ok(p2 && typeof p2.then === 'function', 'a fresh move'); await p2; h.bot.done()
  assert.equal(firing(h.rows).length, 2); assert.equal(firing(h.rows)[1].args.ended, 'done')
})
await t('D14 the in-flight guard: dig and other placements refused during a move, the seal\'s own placement passes, all pass after', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'] })
  const refused = []
  attachLavastepGuard(h.bot, h.mover, { onRefuse: op => refused.push(op) })
  assert.equal(await h.bot.dig({}), 'dug', 'no move: a dig passes')
  const p = h.fire()
  await sleep(10)
  await assert.rejects(h.bot.dig({}), /lavastep/); await assert.rejects(h.bot._genericPlace({ position: { x: 5, y: 63, z: 5 } }, { x: 0, y: 1, z: 0 }), /lavastep/)
  await p; h.bot.done()
  assert.deepEqual(h.bot.places, [[1, 63, 0]], 'only the seal was placed'); assert.deepEqual(refused, ['dig', '_genericPlace'])
  assert.equal(await h.bot.dig({}), 'dug', 'after the move a dig passes')
})
await t('D15 cadence: one ground firing per 2.5 s; rows carry the episode and its count', async () => {
  const h = harness('walledLava', { physics: false, timing: { aim: 100 } })
  const a = h.fire(); await a
  assert.equal(h.fire(), null, 'within 2.5 s: no new firing')
  await sleep(2550)
  const b = h.fire(); await b; h.bot.done()
  const rs = firing(h.rows)
  assert.equal(rs.length, 2); assert.equal(rs[0].args.episode, rs[1].args.episode); assert.deepEqual(rs.map(r => r.args.n), [1, 2])
})

await t('D16 the air rescue taking the body ends the move AT ONCE for whoever asks: its first dig passes the guard in the same instant', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'] })
  attachLavastepGuard(h.bot, h.mover)
  const p = h.fire()
  await sleep(20)
  await assert.rejects(h.bot.dig({}), /lavastep/, 'control: mid-move a dig is refused')
  h.setAir(true)
  assert.equal(await h.bot.dig({}), 'dug', 'no re-assertion period: the rescue digs at once')
  assert.equal(h.mover.moving(), false)
  await p; h.bot.done()
  assert.equal(firing(h.rows)[0].args.ended, 'air')
})
await t('D17 no overlap at the deadline: a firing at the deadline ends the old move first, and the old one never clears the new one\'s controls', async () => {
  const h = harness('walledLava', { physics: false, timing: { move: 300, aim: 2000, ground: 0 } })
  const p1 = h.fire()
  await sleep(310)
  const p2 = h.fire()
  assert.ok(p2 && typeof p2.then === 'function', 'a fresh move starts once the old one is ended')
  assert.equal(firing(h.rows).length >= 0, true)
  await sleep(60)
  assert.equal(h.bot.controls.forward, true, 'the new move holds forward; the old move\'s end did not clear it')
  await p1; await p2; h.bot.done()
  const rs = firing(h.rows)
  assert.equal(rs[0].args.ended, 'deadline')
})
await t('D18 WET firings never relax (Claude code r1 P1): three stationary firings with the feet in water over magma -> no relaxation, no sneak', async () => {
  const s = { cells: { '0,63,0': 'magma_block', '0,64,0': 'water', '1,64,0': 'stone', '-1,64,0': 'stone', '0,64,1': 'stone', '0,64,-1': 'stone', '1,65,0': 'stone', '-1,65,0': 'stone', '0,65,1': 'stone', '0,65,-1': 'stone' }, pos: [0.5, 64, 0.5], yaw: 0 }
  SCENES.__wet = () => s
  const h = harness('__wet', { physics: false, timing: { ground: 0, aim: 60 } })
  h.bot.entity.isInWater = true
  for (let k = 0; k < 4; k++) { await h.fire(); h.mover.tick() }
  h.bot.done(); delete SCENES.__wet
  assert.equal(h.mover.state().relax, null); assert.equal(h.bot.writes.some(([c, v]) => c === 'sneak' && v), false)
  assert.ok(firing(h.rows).length >= 3, 'the arm did fire (positive control)')
})
await t('D19 a firing ended by the air rescue writes no sneak and starts no relaxation, even as the third stationary one', async () => {
  const h = harness('walledMagma', { physics: false, timing: { ground: 0, aim: 150 } })
  await h.fire(); await h.fire()
  const p = h.fire(); await sleep(40); h.setAir(true); const mark = h.bot.writes.length
  await p; await sleep(30); h.bot.done()
  assert.equal(h.mover.state().relax, null)
  assert.equal(h.bot.writes.slice(mark).some(([c, v]) => c === 'sneak' && v), false, 'no sneak after the rescue took the body')
  h.setAir(false)
})
await t('D20 a relaxation ends when the air rescue takes the body or the bot is in water (its sneak dropped)', async () => {
  const h = harness('walledMagma', { physics: false, timing: { ground: 0, aim: 60 } })
  for (let k = 0; k < 3; k++) await h.fire()
  assert.ok(h.mover.state().relax); assert.equal(h.bot.controls.sneak, true)
  h.setAir(true); h.mover.tick()
  assert.equal(h.mover.state().relax, null); assert.equal(h.bot.controls.sneak, false)
  h.setAir(false)
  for (let k = 0; k < 3; k++) await h.fire()
  assert.ok(h.mover.state().relax)
  h.bot.entity.isInWater = true; h.mover.tick()
  assert.equal(h.mover.state().relax, null); h.bot.done()
})
await t('D21 a move holds every movement control it does not use false: an unwinding skill\'s `back`/`left` does not survive it', async () => {
  const h = harness('poolEdge')
  h.bot.controls.back = true; h.bot.controls.left = true
  const p = h.fire()
  await sleep(20)
  assert.equal(h.bot.controls.back, false); assert.equal(h.bot.controls.left, false)
  h.bot.controls.right = true
  await sleep(70)
  assert.equal(h.bot.controls.right, false, 're-asserted false within 50 ms')
  await p; h.bot.done()
})
await t('D22 the +1.5 s observation is taken at +1.5 s from the FIRING even when the move runs longer; its end state separately', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'], placeWorks: false, timing: { after: 300 } })
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.ok(r.after && r.end, 'both recorded'); assert.ok(r.after.ms >= 280 && r.after.ms < 600, `after at ${r.after.ms} ms`)
  assert.ok(r.end.ms > r.after.ms, `the move ran on: end at ${r.end.ms} ms`)
})
// one synchronous step: the injected clock crosses the deadline AND the air rescue seizes, before any check can run
async function deadlineMeetsAir (mod) {
  let off = 0, air = false
  const scene = SCENES.poolEdge(); const bot = fakeBot(scene); const rows = []
  const mv = mod.makeDangerMover(bot, fakeRunner(), { airHolds: () => air, emit: r => rows.push(r), now: () => Date.now() + off, timing: { after: 0, aim: 3000 } })
  const p = mv.maybeFire(feetBelow(bot))
  await sleep(150)
  assert.equal(mv.moving(), true, 'the move is live, sprinting')
  off = 7000; air = true
  bot.setControlState('forward', true); bot.setControlState('jump', true)   // the rescue's stroke
  const mark = bot.writes.length
  const live = mv.moving()
  await p; await sleep(80); bot.done()
  return { live, ended: firing(rows)[0].args.ended, cleared: bot.writes.slice(mark).filter(([, v]) => !v).map(([c]) => c), forward: bot.controls.forward }
}
await t('D23 a deadline that coincides with the air rescue\'s seize is the rescue\'s: ended `air`, and the move clears nothing (Codex code r2 P1, r3 P2)', async () => {
  const r = await deadlineMeetsAir({ makeDangerMover })
  assert.equal(r.live, false); assert.equal(r.ended, 'air')
  assert.deepEqual(r.cleared, [], 'no control cleared after the rescue took the body'); assert.equal(r.forward, true)
})
await t('D23b MUTANT KILLED: the r2 order (deadline first, cleanup keyed on the recorded reason) clears the rescue\'s stroke (D23 catches it)', () =>
  withMutantsAll(MOVE_PATH, [
    ["    me.check = () => airHolds() ? 'air' : !bot.entity ? 'no entity' : (bot.health ?? 20) <= 0 ? 'dead' : now() >= me.deadline ? 'deadline' : null\n",
     "    me.check = () => now() >= me.deadline ? 'deadline' : !bot.entity ? 'no entity' : (bot.health ?? 20) <= 0 ? 'dead' : airHolds() ? 'air' : null\n"],
    ["      if (why !== 'air' && !airHolds()) { for (const c of me.set)", "      if (why !== 'air') { for (const c of me.set)"],
  ], async m => {
    const r = await deadlineMeetsAir(m)
    assert.equal(r.ended, 'deadline'); assert.ok(r.cleared.length > 0, 'the old logic clears the rescue\'s controls')
  }))
await t('D24 a witnessed seal re-classified as `in` whose plan step misses goes straight to the aimed escape (Codex code r2 P2)', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'], physics: false })
  // a 1-deep lava cell elsewhere, with shore around it; the place call carries the bot into it (as a slip would)
  h.bot.world.set(-3, 64, 0, 'lava')
  const place = h.bot._genericPlace
  h.bot._genericPlace = async (ref, face) => { const r = await place(ref, face); h.bot.entity.position.x = -2.5; h.bot.entity.position.y = 64; return r }
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.seal.witnessed, true); assert.equal(r.reclass, 'in')
  assert.deepEqual(r.path, ['seal', 'replan', 'aim'], r.path.join('>')); assert.equal(r.outcome, 'sealed_plan_missed_aim')
  assert.equal(r.aim.reason, 'in_step_missed'); assert.ok(r.steps.length && r.steps[0].plan === 'replan')
})
await t('D25 a missed `in` step that has already carried the bot onto safe ground does not sprint off it (Claude code r4 P2-1)', async () => {
  const h = harness('oneDeep', { physics: false })
  // the step "overshoots": the body lands one cell past its target, on stone, so the post-check misses
  const orig = h.bot.look
  let n = 0
  h.bot.look = (yaw, pitch) => { if (++n === 3) { h.bot.entity.position.x = -1.5 } return orig(yaw, pitch) }
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.steps[0].post, false, 'the step missed its target')
  assert.equal(r.outcome, 'plan_missed_safe'); assert.ok(!r.aim, 'no aimed sprint from a safe cell')
  // the verdict's own cells are in the row (Codex code r6 P1): the feet and the cell below, as read
  assert.ok('0,0,0' in r.missObs.cells && '0,-1,0' in r.missObs.cells, JSON.stringify(Object.keys(r.missObs.cells).slice(0, 8)))
  assert.equal(r.missObs.cells['0,-1,0'], 'stone')
})
await t('D25b the same after a witnessed seal: a re-classification `in` step that overshoots onto stone ends sealed_plan_missed_safe, no aim (Claude code r5 P3-2)', async () => {
  const h = harness('poolEdge', { items: ['cobblestone'], physics: false })
  h.bot.world.set(-3, 64, 0, 'lava')
  const place = h.bot._genericPlace
  h.bot._genericPlace = async (ref, face) => { const r = await place(ref, face); h.bot.entity.position.x = -2.5; h.bot.entity.position.y = 64; return r }
  const orig = h.bot.look; let armed = false
  h.bot.look = (yaw, pitch) => { if (h.mover.state().moving && h.bot.entity.position.x < -2 && !armed) { armed = true; setTimeout(() => { h.bot.entity.position.x = -5.5 }, 10) } return orig(yaw, pitch) }
  await h.fire(); await sleep(30); h.bot.done()
  const r = firing(h.rows)[0].args
  assert.equal(r.reclass, 'in'); assert.equal(r.outcome, 'sealed_plan_missed_safe', r.outcome); assert.ok(!r.aim, 'no aim from safe ground')
  assert.ok(r.missObs && r.missObs.case === null && r.missObs.cells, 'the safe verdict is recorded with its observation')
  assert.ok('0,0,0' in r.missObs.cells && '0,-1,0' in r.missObs.cells, 'with the feet and below cells it was decided on')
})
await t('D26 a move ended INSIDE runner.reserve() (the air rescue took the body during the abort unwind): no dig stop, no path halt, no timer, no control write, the reservation released', async () => {
  const scene = SCENES.poolEdge(); const bot = fakeBot(scene, { physics: false }); const rows = []
  let air = false, mv = null
  const calls = []
  const runner = { reserve (o) { calls.push('reserve'); air = true; mv.moving(); return { gen: 7 } }, releaseReservation (g) { calls.push('release:' + g) }, interrupt () {} }
  mv = makeDangerMover(bot, runner, { airHolds: () => air, emit: r => rows.push(r), timing: { after: 0 } })
  bot.targetDigBlock = { name: 'stone' }; bot.pathfinder.goal = { x: 1 }
  const mark = bot.writes.length
  await mv.maybeFire(feetBelow(bot)); await sleep(80); bot.done()
  assert.deepEqual(calls, ['reserve', 'release:7']); assert.equal(bot.stopped, 0, 'the rescue\'s dig is not stopped')
  assert.deepEqual(bot.pathfinder.goal, { x: 1 }, 'no path halt'); assert.equal(bot.writes.length, mark, 'no control write')
  assert.equal(firing(rows)[0].args.ended, 'air'); assert.equal(mv.moving(), false)
})
// ------------------------------------------------------------------------------------------------ E. the runner's one change
await t('E1 a live lavastep reservation is never replaced: the watchdog\'s reserve() is refused and its run declines runner_reserved; a model skill declines too', async () => {
  const ran = []
  SKILLS.__lsP = { run: async () => { ran.push(1); return { status: 'success', detail: 'ok' } } }
  const r = new Runner(runnerBot())
  const mine = r.reserve('lavastep', 2000, 'danger_block')
  assert.ok(mine.gen != null)
  const w = r.reserve('watchdog', 2000, 'stagnation')
  assert.equal(w.gen, null); assert.equal(w.refused, 'lavastep')
  assert.equal(r.activeReservation().owner, 'lavastep', 'still the danger move\'s')
  const wr = await r.run('__lsP', {}, { trigger: 'watchdog_home', owner: 'watchdog' })
  assert.equal(wr.failClass, 'runner_reserved')
  const llm = await r.run('__lsP', {}, { trigger: 'llm:danger_block' })
  assert.equal(llm.failClass, 'runner_reserved'); assert.equal(ran.length, 0)
  assert.equal(r.reserve('poolescape', 20000, 'poolescape').gen, null, 'poolescape is refused too')
  const again = r.reserve('lavastep', 2000, 'danger_block'); assert.ok(again.gen > mine.gen, 'the mover may renew its own')
  r.releaseReservation(again.gen)
  assert.ok(r.reserve('watchdog', 100, 'stagnation').gen != null, 'after release the watchdog reserves as before')
  delete SKILLS.__lsP
})
await t('E2 the watchdog\'s reservation is SUPERSEDED by a danger move: its pending owner run declines "a newer reservation replaced this one"', async () => {
  SKILLS.__lsSlow = { run: (_c, _a, signal) => new Promise(res => { const h = setTimeout(() => res({ status: 'success', detail: 'ok' }), 400); signal?.addEventListener?.('abort', () => { clearTimeout(h); res({ status: 'aborted', detail: 'aborted' }) }) }) }
  SKILLS.__lsOwner = { run: async () => ({ status: 'success', detail: 'ok' }) }
  const r = new Runner(runnerBot())
  const busy = r.run('__lsSlow', {}, { trigger: 'llm' })
  await sleep(20)
  r.reserve('watchdog', 3000, 'stagnation')
  const owner = r.run('__lsOwner', {}, { trigger: 'watchdog_home', owner: 'watchdog' })
  r.reserve('lavastep', 2000, 'danger_block')
  const res = await owner; await busy
  assert.equal(res.failClass, 'runner_reserved'); assert.match(res.detail, /newer reservation/)
  delete SKILLS.__lsSlow; delete SKILLS.__lsOwner
})

// ------------------------------------------------------------------------------------------------ F. the refusal CHAIN
// Each scene runs through to the next decision. Allowed ends: on a safe cell (no DANGER at the feet or below); after an
// aimed escape, re-classified by the next firing; airborne, re-evaluated on landing; or (magma/campfire, three firings
// without moving) handed over to the ordinary escape arms (recoveryArmsMayRun true on the relaxed cell). Nothing else.
async function chain (sceneName, opts = {}) {
  const h = harness(sceneName, { ...opts, timing: { ground: 0, ...(opts.timing ?? {}) } })
  const ends = []
  for (let k = 0; k < 6; k++) {
    const fb = feetBelow(h.bot); const eff = h.mover.effective(fb.feet, fb.below)
    if (!DANGER.has(eff.feet) && !DANGER.has(eff.below)) { ends.push(recoveryArmsMayRun({ feetName: eff.feet, belowName: eff.below }) ? (h.mover.state().relax ? 'handover' : 'safe') : 'stuck?'); break }
    const out = h.fire()
    if (out && out.kase === 'airborne') { ends.push('airborne'); await sleep(300); continue }
    if (!out) { ends.push('no-firing'); break }
    await out; ends.push(firing(h.rows).at(-1).args.outcome)
    h.mover.tick()
  }
  h.bot.done()
  return { ends, rows: firing(h.rows), health: h.bot.health, mover: h.mover }
}
await t('F1 CHAIN S1 pool edge (no cobble): aim -> safe', async () => { const c = await chain('poolEdge'); assert.equal(c.ends.at(-1), 'safe', c.ends.join(' > ')) })
await t('F2 CHAIN S1 pool edge (cobble): seal -> safe', async () => { const c = await chain('poolEdge', { items: ['cobblestone'] }); assert.deepEqual(c.ends, ['sealed', 'safe']) })
await t('F3 CHAIN S2 1-deep lava: plan -> safe', async () => { const c = await chain('oneDeep'); assert.deepEqual(c.ends, ['plan', 'safe']) })
await t('F4 CHAIN S4 magma: plan -> safe', async () => { const c = await chain('magma'); assert.deepEqual(c.ends, ['plan', 'safe']) })
await t('F5 CHAIN S6 campfire underfoot (in): a move every firing until off it', async () => {
  const c = await chain('campfire'); assert.ok(['safe', 'handover'].includes(c.ends.at(-1)), c.ends.join(' > '))
})
await t('F6 CHAIN the enclosed magma floor: three firings that do not move -> sneak + relaxation -> the ordinary escape arms may run', async () => {
  const c = await chain('walledMagma', { physics: false, timing: { aim: 60 } })
  assert.equal(c.ends.at(-1), 'handover', c.ends.join(' > '))
  const st = c.mover.state(); assert.equal(st.relax.name, 'magma_block'); assert.equal(st.relax.sneak, true)
})
await t('F7 CHAIN the enclosed LAVA floor is never relaxed: every firing acts (aims) and the arms keep standing down', async () => {
  const c = await chain('walledLava', { physics: false, timing: { aim: 60 } })
  assert.ok(c.ends.every(e => e === 'aim'), c.ends.join(' > ')); assert.equal(c.mover.state().relax, null)
})
await t('F8 the relaxation ends on a block update at the cell, and on moving off it (sneak dropped)', async () => {
  const c = await chain('walledMagma', { physics: false, timing: { aim: 60 } })
  const m = c.mover
  assert.ok(m.state().relax)
  // (the harness's bot is gone; drive a new one through the same relax by hand)
  const h = harness('walledMagma', { physics: false, timing: { ground: 0, aim: 60 } })
  for (let k = 0; k < 3; k++) await h.fire()
  assert.ok(h.mover.state().relax, 'relaxed after three'); assert.equal(h.bot.controls.sneak, true)
  h.bot.emit('blockUpdate', null, B('stone', 0, 63, 0))
  assert.equal(h.mover.state().relax, null, 'a block update at the cell ends it'); assert.equal(h.bot.controls.sneak, false)
  for (let k = 0; k < 3; k++) await h.fire()
  assert.ok(h.mover.state().relax)
  h.bot.entity.position.x += 1; h.mover.tick()
  assert.equal(h.mover.state().relax, null, 'moving off ends it'); h.bot.done()
})

await t('F9 CHAIN the relaxed magma floor hands over to a REAL ordinary escape (pillarOut): it runs, its seize does not cost the sneak for more than a tick, and the bot takes no magma damage', async () => {
  const h = harness('walledMagma', { timing: { ground: 0, aim: 60 } })
  h.bot.inv = [{ name: 'cobblestone', count: 64, type: 2 }]
  // the bot cannot move (walled), so stop the kinematic forward; damage stays on
  for (let k = 0; k < 3; k++) await h.fire()
  assert.ok(h.mover.state().relax, 'relaxed after three: ' + firing(h.rows).map(r => r.detail + ' end=' + JSON.stringify(r.args.end)).join(' | '))
  const hp0 = h.bot.health
  const ticker = setInterval(() => h.mover.tick(), 100)   // the reflex tick (every 500 ms on the fleet; faster here)
  let placed = 0; h.bot.placeBlock = async () => { placed++ }; h.bot.digOpens = true
  const fb = feetBelow(h.bot); const eff = h.mover.effective(fb.feet, fb.below)
  assert.equal(recoveryArmsMayRun({ feetName: eff.feet, belowName: eff.below }), true, 'the arms may run on the relaxed cell')
  const r = await pillarOut(h.bot, 2, { alive: () => !h.mover.moving() }).catch(e => 'threw:' + e.message)
  await sleep(300)
  clearInterval(ticker); h.bot.done()
  assert.notEqual(r, 'preempted', `the escape arm runs: ${r}`)
  assert.ok(placed >= 1, `it reached a placement (pillarOut -> ${r}, digs ${h.bot.digs})`)
  assert.equal(h.bot.controls.sneak, true, 'the sneak is re-asserted after the pillar\'s seize cleared it')
  assert.ok(h.bot.health >= hp0 - 1, `at most one magma tick lost while the seize had cleared the sneak: ${hp0} -> ${h.bot.health}`)
})
await t('F10 CHAIN (real jump arcs, open-topped magma pit): the aim settles before the move ends, the relaxation starts within 4 firings, and the handed-over pillar runs with the ARM ticking -- its own jump never ends the relaxation (Claude code r2 P1, P2-2)', async () => {
  const h = harness('openPit', { arc: true, timing: { ground: 0 } })
  let k = 0
  for (; k < 6 && !h.mover.state().relax; k++) { await h.fire(); h.mover.tick() }
  assert.ok(h.mover.state().relax, `relaxed within ${k} firings: ` + firing(h.rows).map(r => `${r.args.outcome}/end ${JSON.stringify(r.args.end?.pos)} ground=${r.args.end ? 'y' : '?'}`).join(' | '))
  assert.ok(k <= 4, `${k} firings`)
  assert.ok((h.bot.jumps ?? 0) > 0, 'the fake did jump (a real arc)')
  const ends = []
  const realEnd = h.rows.length
  const hp0 = h.bot.health
  h.bot.inv = [{ name: 'cobblestone', count: 64, type: 2 }]
  let placed = 0; h.bot.placeBlock = async () => { placed++ }
  // THE REFLEX TICK, as it runs: the mover's tick first, then the arm on the effective names
  const ticker = setInterval(() => { h.mover.tick(); const fb = feetBelow(h.bot); h.mover.maybeFire(fb) }, 100)
  const r = await pillarOut(h.bot, 2, { alive: () => !h.mover.moving() }).catch(e => 'threw:' + e.message)
  await sleep(400)
  clearInterval(ticker); h.bot.done()
  for (const row of h.rows.slice(realEnd)) ends.push(row.args?.phase === 'relax_end' ? `relax_end:${row.args.why}` : `firing:${row.args?.case}`)
  assert.notEqual(r, 'preempted', `the pillar ran: ${r} (${ends.join(', ')})`)
  assert.ok(placed >= 1, 'it reached a placement')
  assert.ok(!ends.includes('relax_end:moved off'), `the pillar's own jump did not end the relaxation: ${ends.join(', ')}`)
  assert.ok(!ends.some(e => e.startsWith('firing:')), `the arm did not fire on the relaxed floor: ${ends.join(', ')}`)
  assert.ok(h.bot.health >= hp0 - 1, `no magma damage while relaxed: ${hp0} -> ${h.bot.health}`)
})
await t('F11 a bot that alternates between two cells of one episode counts as stationary from its second firing (Claude code r2 P2-3)', async () => {
  const c = { '0,63,0': 'magma_block', '1,63,0': 'magma_block' }
  for (const [x, z] of [[-1, 0], [2, 0], [0, 1], [0, -1], [1, 1], [1, -1]]) { c[`${x},64,${z}`] = 'stone'; c[`${x},65,${z}`] = 'stone' }
  SCENES.__two = () => ({ cells: c, pos: [0.5, 64, 0.5], yaw: 0, onGround: true })
  const h = harness('__two', { physics: false, timing: { ground: 0, aim: 60 } })
  const cells = [[0.5, 0.5], [1.5, 0.5]]
  let k = 0
  for (; k < 7 && !h.mover.state().relax; k++) {
    const p = h.fire()
    const [x, z] = cells[(k + 1) % 2]; h.bot.entity.position.x = x; h.bot.entity.position.z = z   // the move carries it to the other cell
    await p; h.mover.tick()
  }
  h.bot.done(); delete SCENES.__two
  assert.ok(h.mover.state().relax, `alternating never relaxed (${k} firings)`); assert.ok(k <= 5, `${k}`)
})
// ------------------------------------------------------------------------------------------------ G. wiring (structural)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const RFX = strip(fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
const IDX = strip(fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
const once = (s, needle, what) => assert.equal(s.split(needle).length - 1, 1, `${what}: expected exactly one ${JSON.stringify(needle.slice(0, 80))}`)
const WIRES = [
  ['the move fires from the arm, never awaited', 'if (dangerHere && lavastepMover) lavastepMover.maybeFire({ feet, below })'],
  ['LAVASTEP=0 runs today\'s escape exactly', "if (!lavastepMover) {\n          runner.interrupt('danger_block')\n          await escape(bot)\n        }"],
  ['the arms stand down while a move holds the body', 'const inDanger = dangerHere || dangerMovingNow()'],
  ['every reflex helper\'s ownership check includes the move', 'const ownsBody = (grantOf) => () => !dangerMovingNow() && (!config.reflex.arbiter'],
  ['the air rescue outranks the move', 'airHolds: () => rescuing || airPocketing || airPocketWanted(),'],
  ['the stranded ladder stands down', 'longEnough && !poolEscaping && !dangerMovingNow() &&'],
  // re-anchored (ceilescape-01 x lavastep-01, JIT 10-24): ceilescape's steering flag rides on the same call
  ['the stranded ladder yields mid-run', "? await routine(bot, { yieldTo: bodyYield, steering: steerRamp })\n                  .catch(e => ({ ok: false, why: String(e?.message ?? e) }))"],
  ['the escape lattice yields mid-run', "? await routine(bot, { yieldTo: bodyYield, steering: steerRamp })\n                  .catch(e => ({ ok: false, why: `threw: ${e.message}` }))"],
  ['the pocket rung stands down', '!escaping && !marooned && !pocketing && !dangerMovingNow()) {'],
  ['the stand-off stands down', '!runner.isBusy() && !escaping && !marooned && !dangerMovingNow() && !standOffInWater'],
  ['the float hold stands down', 'if (!pocketing && !poolEscaping && !dangerMovingNow()) {'],
  ['the maroon check stands down', 'if (!escaping && !marooned && !dangerMovingNow() && !runner.isBusy()'],
  ['the mover is created only when on', 'if (lavastepOn()) {\n    lavastepMover = makeDangerMover(bot, runner, {'],
]
await t('G1 WIRED (reflex.mjs, comments stripped): the arm, the rollback, the stand-downs, ownership and air preemption -- each once', () => {
  for (const [what, needle] of WIRES) once(RFX, needle, what)
  const iTimer = RFX.indexOf("const timer = setInterval(digScoped({ purpose: 'survival', by: 'reflex' }, async () => {")
  const iTick = RFX.indexOf('lavastepMover?.tick()', iTimer), iEntity = RFX.indexOf('if (!bot.entity) return', iTimer)
  assert.ok(iTimer > 0 && iTick > iTimer && iTick < iEntity, `the relaxation's end conditions run first in the tick, before every early return (timer@${iTimer} tick@${iTick} entity-return@${iEntity})`)
  assert.equal(RFX.split('lavastepMover?.tick()').length - 1, 1, 'one call site')
})
await t('G3 WIRED (index.mjs): the licence row once per spawn, and the in-flight guard attached OUTERMOST (after protectzone)', () => {
  once(IDX, "logEvent({ kind: 'lavastep_mode', status: 'success', snapshot: snapshot(bot), detail: lavastepModeDetail() })", 'licence')
  const iZone = IDX.indexOf('attachProtectZone(bot, {'), iGuard = IDX.indexOf('attachLavastepGuard(bot, mover, {')
  assert.ok(iZone > 0 && iGuard > iZone, `protectzone@${iZone} < lavastep guard@${iGuard}`)
  const m = IDX.replace('attachLavastepGuard(bot, mover, {', 'void (bot, mover, {')
  assert.equal(m.indexOf('attachLavastepGuard(bot, mover, {'), -1, 'mutant: an unattached guard is detected')
})
await t('G4 the watchdog declines on a refused reserve: its rescue run is made with owner=watchdog after reserve() (structural, comments stripped)', () => {
  const WD = strip(fs.readFileSync(new URL('../src/watchdog.mjs', import.meta.url), 'utf8'))
  once(WD, "if (typeof this.runner.reserve === 'function') pd.gen = this.runner.reserve(RESCUE_OWNER, this.reserveMs, reason).gen", 'watchdog reserve')
  assert.ok(/const r = await this\.runner\.run\(skill, args, \{\s*trigger, owner: RESCUE_OWNER,/.test(WD), 'its run carries the owner, so a lavastep reservation declines it (E1)')
})

// ------------------------------------------------------------------------------------------------ P. cross-language parity
// The read (scripts/host/lavastepread.py) recomputes every gate with a PYTHON mirror of the decision. Its own self-test
// builds rows with that mirror, so it can never see where the mirror differs from the JS (Claude code r3 P1: the yaw of
// due south is -pi in JS and +pi in Python). Here the REAL executor writes the rows and the REAL read judges them.
const READ_PY = new URL('../../scripts/host/lavastepread.py', import.meta.url).pathname
const { spawnSync } = await import('node:child_process')
async function parityRows () {
  const worlds = []
  for (const k of Object.keys(SCENES).filter(n => !n.startsWith('__'))) worlds.push({ scene: SCENES[k](), items: ['cobblestone'] }, { scene: SCENES[k](), items: [] })
  // one corridor per bearing: lava everywhere but a stone floor along that bearing, so every aim bearing is exercised
  BEARINGS.forEach(([bx, bz]) => {
    const c = {}; fill(c, -8, 8, 63, 63, -8, 8, 'lava')
    for (let k = 1; k <= 7; k++) c[`${bx * k},63,${bz * k}`] = 'stone'
    worlds.push({ scene: { cells: c, pos: [0.5, 64, 0.5], yaw: 0 }, items: [] })
  })
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let i = 0; i < 60; i++) {
    const c = {}
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
      const r = rnd(); c[`${x},63,${z}`] = r < 0.3 ? 'lava' : r < 0.35 ? 'magma_block' : r < 0.37 ? null : 'stone'
      const h = rnd(); c[`${x},64,${z}`] = h < 0.1 ? 'stone' : h < 0.14 ? 'lava' : 'air'
    }
    c['0,63,0'] = rnd() < 0.5 ? 'lava' : 'magma_block'; c['0,64,0'] = rnd() < 0.5 ? 'air' : 'lava'
    worlds.push({ scene: { cells: c, pos: [0.5, 64, 0.5], yaw: rnd() * 6.28 - 3.14 }, items: rnd() < 0.5 ? ['cobblestone'] : [] })
  }
  const lines = []
  for (const { scene, items } of worlds) {
    const bot = fakeBot(scene, { items, physics: false }); const rows = []
    const mv = makeDangerMover(bot, fakeRunner(), { emit: r => rows.push(r), timing: { after: 0, aim: 20, stepIn: 60, stepEdge: 60, seal: 120 } })
    const fb = feetBelow(bot)
    const out = mv.maybeFire(fb)
    if (out && typeof out.then === 'function') await out
    await sleep(5); bot.done()
    for (const r of rows) lines.push(JSON.stringify({ '@timestamp': new Date().toISOString(), bot: { name: 'parity-a-A' }, skill: { name: '_lava_retreat', args: r.args, detail: r.detail } }))
  }
  return lines
}
function readRows (lines, py = READ_PY) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsparity-')), 'rows.jsonl')
  fs.writeFileSync(f, lines.join('\n') + '\n')
  const r = spawnSync('python3', [py, '--rows', f], { encoding: 'utf8' })
  assert.equal(r.status, 0, `python3 ${py} --rows failed (python3 is required): ${r.stderr || r.error}`)
  return JSON.parse(r.stdout)
}
const PARITY = await parityRows()
await t('P1 PARITY: the real executor\'s rows (every scene x bag, 8 single-bearing corridors, 60 seeded random worlds), judged by the real read: zero G1-G5, every ground decision replays', () => {
  const res = readRows(PARITY)
  assert.ok(res.firings_canary >= 80, `${res.firings_canary} firings`)
  for (const g of ['g1_step_unsafe', 'g2_aim_over_plan', 'g3_edge_sprint', 'g4_seal_bad', 'g5_aim_not_best']) assert.equal(res[g], 0, `${g}: ${JSON.stringify(res._examples)}`)
  assert.equal(res.replay_agree, 1, `replay ${res.replay_agree}, unverifiable ${res.replay_unverifiable}`)
  assert.equal(res.missing_reads, 0)
  const bearings = new Set(PARITY.map(l => JSON.parse(l).skill.args.aim?.chosen).filter(x => x != null))
  assert.equal(bearings.size, 8, `every aim bearing exercised: ${[...bearings]}`)
})
await t('P2 MUTANT KILLED: the read without the angular wrap grades every due-south aim a G5 defect (P1 catches it)', () => {
  const src = fs.readFileSync(READ_PY, 'utf8')
  const old = "            if ch is not None and ang_diff(float(aim.get('yaw', 99)), yaw_of(BEARINGS[ch])) > YAW_TOL:"
  assert.equal(src.split(old).length - 1, 1, 'ANCHOR MISSING or not unique')
  const mut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsparity-mut-')), 'lavastepread.py')
  fs.writeFileSync(mut, src.replace(old, "            if ch is not None and abs(float(aim.get('yaw', 99)) - yaw_of(BEARINGS[ch])) > YAW_TOL:"))
  const res = readRows(PARITY, mut)
  assert.ok(res.g5_aim_not_best > 0, 'the mutant read passes south aims, so P1 would prove nothing')
})

// ------------------------------------------------------------------------------------------------ H. anchored mutants
// Each is the defect one read gate (scripts/host/lavastepread.py G1-G5) is built to catch; here the behaviour test catches it.
await t('H1 MUTANT KILLED (G1): allowing DANGER in the sweep plans past a fire cell beside the origin (B6\'s independent check catches it)', () =>
  withMutantsAll(LS_PATH, [
    ["      if (isDanger(o)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep danger at ${fx + lx},${fy},${fz + lz}` }\n", ''],
    ["    if (isDanger(d)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep danger at ${to[0] + lx},${to[1]},${to[2] + lz}` }\n", ''],
  ], m => {
    // a magma floor walled west and north; FIRE at feet level south of the bot (a lateral cell of the eastward step)
    const w = World({ '0,63,0': 'magma_block', '-1,64,0': 'stone', '-1,65,0': 'stone', '0,64,-1': 'stone', '0,65,-1': 'stone', '0,64,1': 'fire' })
    const good = stepPlan(w.at, [0, 64, 0], 'edge'); assert.equal(good.plan, null, 'control: the real search refuses it')
    const bad = m.stepPlan(w.at, [0, 64, 0], 'edge')
    assert.ok(bad.plan && g1Violations(w.at, [0, 64, 0], bad.plan, 'edge').length > 0, `the mutant plans past the fire: ${JSON.stringify(bad.plan)}`)
  }))
await t('H2 MUTANT KILLED (G2): a decision that skips its plan aims instead -- and the recorded cells still replay to the plan it skipped', () =>
  withMutant(LS_PATH, '  if (sp.plan) return { kase, plan: sp.plan, candidates: sp.candidates, seal: null, aim: null }\n',
    '  if (false) return { kase, plan: sp.plan, candidates: sp.candidates, seal: null, aim: null }\n', async m => {
      // the mutant decision, executed by the real executor (lavastepmove.mjs imports the real lavastep.mjs, so the
      // mutant is driven through dangerMove directly and its output handed to a recording replay)
      const scene = SCENES.oneDeep(); const w = World(scene.cells)
      const rec = recordingAt(w.at, [1, 64, 0])
      const d = m.dangerMove({ at: rec, origin: [1, 64, 0], feet: 'lava', below: 'stone', onGround: true, yaw0: scene.yaw })
      assert.equal(d.plan, null, 'the mutant skipped the plan'); assert.ok(d.aim && d.aim.choice, 'and chose an aim')
      // G2's input: the recorded cells alone, replayed by the REAL search, find the plan the mutant skipped
      const cells = rec.cells
      const replayAt = (x, y, z) => { const k = `${x - 1},${y - 64},${z}`; return k in cells ? (cells[k] == null ? null : { name: cells[k], boundingBox: rec.boxes[cells[k]] }) : null }
      const rp = stepPlan(replayAt, [1, 64, 0], 'in')
      assert.ok(rp.plan && rp.plan.length === 2, 'the replay finds the skipped plan')
      // control: the real decision returns that plan
      assert.deepEqual(dangerMove({ at: w.at, origin: [1, 64, 0], feet: 'lava', below: 'stone', onGround: true }).plan.map(p => p.to), rp.plan.map(p => p.to))
    }))
await t('H3 MUTANT KILLED (G3): sprinting on an edge plan step (D1 catches it)', () =>
  withMutant(MOVE_PATH, '      const sprint = inStep && i === 0\n', '      const sprint = true\n', async m => {
    const scene = SCENES.magma(); const bot = fakeBot(scene); const rows = []
    const mv = m.makeDangerMover(bot, fakeRunner(), { emit: r => rows.push(r), timing: { after: 0 } })
    await mv.maybeFire(feetBelow(bot)); await sleep(30); bot.done()
    assert.ok(firing(rows)[0].args.controls.some(([c, v]) => c === 'sprint' && v))
  }))
await t('H4 MUTANT KILLED (G4): accepting an unwitnessed seal re-classifies (D4 catches it)', () =>
  withMutant(MOVE_PATH, "        if (s === 'witnessed') {\n          const o = await afterSeal('sealed')", "        if (true) {\n          const o = await afterSeal('sealed')", async m => {
    const scene = SCENES.poolEdge(); const bot = fakeBot(scene, { items: ['cobblestone'], placeWorks: false }); const rows = []
    const mv = m.makeDangerMover(bot, fakeRunner(), { emit: r => rows.push(r), timing: { after: 0 } })
    await mv.maybeFire(feetBelow(bot)); await sleep(30); bot.done()
    const r = firing(rows)[0].args
    assert.equal(r.seal.witnessed, false); assert.notEqual(r.outcome, 'seal_failed_aim')
  }))
await t('H5 MUTANT KILLED (G5): aiming at the facing bearing sprints into the pool (D2 catches it)', () =>
  withMutant(MOVE_PATH, '      const yaw = yawOf(ob.choice.b)\n', '      const yaw = bot.entity.yaw ?? 0\n', async m => {
    const scene = SCENES.poolEdge(); const bot = fakeBot(scene); const rows = []
    const mv = m.makeDangerMover(bot, fakeRunner(), { emit: r => rows.push(r), timing: { after: 0 } })
    await mv.maybeFire(feetBelow(bot)); await sleep(30); bot.done()
    assert.ok(bot.entity.position.x > 1.2, `the mutant ran east into the pool: x=${bot.entity.position.x}`)
  }))
await t('H6 MUTANT KILLED: without the runner refusal the watchdog replaces the danger move\'s reservation (E1 catches it)', () =>
  withMutant(RUNNER_PATH, "    if (live && live.owner === Runner.DANGER_OWNER && owner !== Runner.DANGER_OWNER) return { gen: null, aborted: false, refused: Runner.DANGER_OWNER }\n", '', async m => {
    const r = new m.Runner(runnerBot())
    r.reserve('lavastep', 2000, 'danger_block')
    assert.ok(r.reserve('watchdog', 2000, 'stagnation').gen != null)
  }))
await t('H7 MUTANT KILLED: a guard that ignores the move lets a dig through mid-move (D14 catches it)', () =>
  withMutant(MOVE_PATH, '      if (mover.moving()) {\n        if (name', '      if (false) {\n        if (name', async m => {
    const h = harness('poolEdge', { items: ['cobblestone'] })
    m.attachLavastepGuard(h.bot, h.mover)
    const p = h.fire(); await sleep(10)
    assert.equal(await h.bot.dig({}), 'dug'); await p; h.bot.done()
  }))
await t('H8 MUTANT KILLED: without the air check in ownership the move keeps steering over the rescue (D11 catches it)', () =>
  withMutant(MOVE_PATH, "    me.check = () => airHolds() ? 'air' : !bot.entity ? 'no entity' : (bot.health ?? 20) <= 0 ? 'dead' : now() >= me.deadline ? 'deadline' : null\n",
    "    me.check = () => !bot.entity ? 'no entity' : (bot.health ?? 20) <= 0 ? 'dead' : now() >= me.deadline ? 'deadline' : null\n", async m => {
      const scene = SCENES.poolEdge(); const bot = fakeBot(scene); const rows = []; let air = false
      const mv = m.makeDangerMover(bot, fakeRunner(), { airHolds: () => air, emit: r => rows.push(r), timing: { after: 0 } })
      const p = mv.maybeFire(feetBelow(bot)); await sleep(250); air = true; const mark = bot.writes.length
      await p; bot.done()
      assert.ok(bot.writes.length > mark, 'the mutant kept writing controls')
    }))

for (const k of Object.keys(SKILLS)) if (k.startsWith('__ls')) delete SKILLS[k]
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
