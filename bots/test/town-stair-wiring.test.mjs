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
// stairuse-01: the descents below are the base's (STAIRUSE=off: one walk, verified from the top); stair-descent.test.mjs and the
// block after these have the step-by-step descent
const legacy = fn => async () => { process.env.STAIRUSE = 'off'; try { await fn() } finally { delete process.env.STAIRUSE } }
await t('mine 16 from the surface near the stair: walks down to the 16 landing\'s stub end, done', legacy(async () => {
  const bot = fakeBot(worldOf())
  const r = await K.stairDescend(ctx(bot), 16, null)
  assert.deepStrictEqual(r, { arrived: true, landing: 16, done: true })
  assert.deepStrictEqual(bot.walks, [stub(16)])
}))
await t('mine 0: down to 16, not done (mine digs on from the stub end); mine 40: the 48 landing', legacy(async () => {
  const b1 = fakeBot(worldOf()); assert.deepStrictEqual(await K.stairDescend(ctx(b1), 0, null), { arrived: true, landing: 16, done: false })
  const b2 = fakeBot(worldOf()); assert.deepStrictEqual(await K.stairDescend(ctx(b2), 40, null), { arrived: true, landing: 48, done: false })
}))
await t('declined (null, today\'s mine): a step-sized call, no pickaxe, far from the stair, a broken route', legacy(async () => {
  assert.strictEqual(await K.stairDescend(ctx(fakeBot(worldOf())), 66, null), null)
  assert.strictEqual(await K.stairDescend(ctx(fakeBot(worldOf(), { pick: false })), 16, null), null)
  assert.strictEqual(await K.stairDescend(ctx(fakeBot(worldOf(), { pos: { x: 200.5, y: 71, z: 0.5 } })), 16, null), null)
  const tread = plan.steps[10].tread
  const broken = (x, y, z) => (x === tread[0] && y === tread[1] && z === tread[2] ? 'air' : worldOf()(x, y, z))
  const b = fakeBot(broken)
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  assert.deepStrictEqual(b.walks, [], 'never walked')
}))
await t('a walk that does not arrive: null, and that landing is not tried again by this bot for 10 min', legacy(async () => {
  const b = fakeBot(worldOf(), { moves: false })
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  assert.strictEqual(b.walks.length, 1)
  const again = await K.stairDescend(ctx(b), 16, null)
  assert.ok(again === null || again.landing !== 16)
  assert.ok(b.walks.length <= 2 && b.walks.every(w => w.join() !== stub(16).join() || b.walks.indexOf(w) === 0), 'the 16 is backed off')
}))

console.log('STAIRUSE-01: THE DESCENT STEP BY STEP (fake bot, the same finished stair)')
const { tapRecords } = await import('../src/logger.mjs')
const TAPPED = []
tapRecords(rec => TAPPED.push(rec))
const rowsOf = kind => TAPPED.filter(r => r.skill?.name === `_${kind}`)
const recNow = () => K.stairRecordNow()
await t('from the surface: the collar exit first, then hops down the stair to the 16 stub end, done; one _shaft_use row with entry=surface', async () => {
  const n0 = rowsOf('shaft_use').length
  const bot = fakeBot(worldOf())
  const r = await K.stairDescend(ctx(bot), 16, null)
  assert.deepStrictEqual(r, { arrived: true, landing: 16, done: true })
  assert.deepStrictEqual(bot.walks[0], recNow().exit, 'the collar exit first')
  assert.deepStrictEqual(bot.walks.at(-1), stub(16), 'the stub end last')
  assert.ok(bot.walks.length > 10, `hops (${bot.walks.length} walks), not one long goto`)
  const rows = rowsOf('shaft_use').slice(n0)
  assert.strictEqual(rows.length, 1)
  assert.match(rows[0].skill.detail, /dir=down ok=1 why=arrived landing=16 .* entry=surface cleared=0/)
})
await t('from the 48 landing\'s stub end (on the stair): down to 16 from its own step (no collar walk), entry=stair', async () => {
  const s = stub(48)
  const bot = fakeBot(worldOf(), { pos: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 } })
  const r = await K.stairDescend(ctx(bot), 16, null)
  assert.deepStrictEqual(r, { arrived: true, landing: 16, done: true })
  assert.ok(!bot.walks.some(w => w.join() === recNow().exit.join()), 'never back up to the exit')
  assert.match(rowsOf('shaft_use').at(-1).skill.detail, /entry=stair/)
})
await t('from a MINE near the stair (y 40, off it): no attempt -- null, no _shaft_use row, a _shaft_skip row, no landing backed off; then from the surface it descends (COMPOSED)', async () => {
  const n0 = rowsOf('shaft_use').length, s0 = rowsOf('shaft_skip').length
  const world = (x, y, z) => (y >= 40 && y <= 41 && Math.abs(z) <= 1 && x >= 4 && x <= 12 ? 'air' : worldOf()(x, y, z))   // a tunnel west of the stair's box
  const bot = fakeBot(world, { pos: { x: 8.5, y: 40, z: 0.5 } })
  assert.strictEqual(await K.stairDescend(ctx(bot), 16, null), null)
  assert.deepStrictEqual(bot.walks, [], 'never walked')
  assert.strictEqual(rowsOf('shaft_use').length, n0, 'no attempt row')
  assert.match(rowsOf('shaft_skip').slice(s0)[0]?.skill.detail ?? '', /dir=down why=away landing=16 from=40/)
  assert.ok(!(bot.stairFails?.get(16) > 0), 'the 16 is not backed off')
  Object.assign(bot.entity.position, { x: 10.5, y: 71, z: 0.5 })
  assert.deepStrictEqual(await K.stairDescend(ctx(bot), 16, null), { arrived: true, landing: 16, done: true }, 'the same bot at the surface uses the stair')
})
await t('a missing tread on the route: refused before any walk (landingRoute), the step named; a liquid the same', async () => {
  const tread = plan.steps[10].tread
  const broken = (x, y, z) => (x === tread[0] && y === tread[1] && z === tread[2] ? 'air' : worldOf()(x, y, z))
  const b = fakeBot(broken)
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  assert.deepStrictEqual(b.walks, [])
  assert.match(rowsOf('shaft_use').at(-1).skill.detail, /why=step10:tread/)
})
await t('the collar walk that does not arrive: null, why=approach, and the landing is NOT backed off (an approach is no stair fault)', async () => {
  const b = fakeBot(worldOf(), { moves: false })
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  assert.match(rowsOf('shaft_use').at(-1).skill.detail, /why=approach/)
  assert.ok(!(b.stairFails?.get(16) > 0))
})
await t('after a failed approach this bot waits 2 min before the next collar walk (no 90 s walk every mine call); the landing stays open', async () => {
  const b = fakeBot(worldOf(), { moves: false })
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  const n = b.walks.length
  assert.strictEqual(await K.stairDescend(ctx(b), 16, null), null)
  assert.strictEqual(b.walks.length, n, 'no second walk inside the wait')
  b.stairApproachFail = Date.now() - 2 * 60_000 - 1
  await K.stairDescend(ctx(b), 16, null)
  assert.ok(b.walks.length > n, 'asked again after it')
})
await t('MUTANT KILLED: an approach failure backs the landing off again (as the base did for every walk)', async () => {
  await withSkillsMutant("    if (r?.why !== 'approach') bot.stairFails.set(feet, Date.now()); else bot.stairApproachFail = Date.now()", '    bot.stairFails.set(feet, Date.now())', async M => {
    const b = fakeBot(worldOf(), { moves: false })
    assert.strictEqual(await M.stairDescend(ctx(b), 16, null), null)
    assert.ok(b.stairFails.get(16) > 0, 'the mutant backs it off')
  })
})
await t('MUTANT KILLED: without the entry class a bot in a mine walks for the stair again (an attempt that cannot succeed)', async () => {
  await withSkillsMutant("  if (entry !== 'stair' && entry !== 'surface') {", '  if (false) {', async M => {
    const world = (x, y, z) => (y >= 40 && y <= 41 && Math.abs(z) <= 1 && x >= 4 && x <= 12 ? 'air' : worldOf()(x, y, z))   // a tunnel west of the stair's box
    const b = fakeBot(world, { pos: { x: 8.5, y: 40, z: 0.5 } })
    await M.stairDescend(ctx(b), 16, null)
    assert.ok(b.walks.length > 0, 'the mutant walks')
  })
})
await t('surface from the 32 stub end (under rock), SHAFTTRAP=off (the base): plans, walks up to the collar exit', async () => {
  process.env.SHAFTTRAP = 'off'
  try {
    const s = stub(32)
    const b = fakeBot(worldOf(), { pos: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 } })
    const r = await K.stairAscend(ctx(b), null)
    assert.ok(r?.ok, JSON.stringify(r))
    const rec = K.stairRecordNow()
    assert.deepStrictEqual(b.walks, [rec.exit])
  } finally { delete process.env.SHAFTTRAP }
})
await t('shafttrap-02: surface from ON the stair walks it up with the egress (stub back to its step, stands, the exit), no plan asked', async () => {
  const s = stub(32)
  const b = fakeBot(worldOf(), { pos: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 }, plan: 'noPath' })
  let planned = 0
  const gp = b.pathfinder.getPathFromTo; b.pathfinder.getPathFromTo = function (...a) { planned++; return gp.apply(this, a) }
  const r = await K.stairAscend(ctx(b), null)
  assert.ok(r?.ok, JSON.stringify(r))
  const rec = K.stairRecordNow()
  assert.deepStrictEqual(b.walks.at(-1), rec.exit, 'ends at the collar exit')
  assert.ok(b.walks.length > 2, 'hops, not one plan')
  assert.strictEqual(planned, 0, 'the plan that answers no_plan on one dirt block is not asked')
})
await t('surface declined: in the open (not roofed), or (SHAFTTRAP=off) the plan finds no path', async () => {
  assert.strictEqual(await K.stairAscend(ctx(fakeBot(worldOf(), { pos: { x: 200.5, y: 50, z: 0.5 } })), null), null, 'far')
  const s = stub(32)
  process.env.SHAFTTRAP = 'off'
  try {
    const b = fakeBot(worldOf(), { pos: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 }, plan: 'noPath' })
    assert.strictEqual(await K.stairAscend(ctx(b), null), null)
    assert.deepStrictEqual(b.walks, [])
  } finally { delete process.env.SHAFTTRAP }
  const open = (x, y, z) => 'air'
  const b2 = fakeBot(open, { pos: { x: 20.5, y: 50, z: 0.5 } })
  assert.strictEqual(await K.stairAscend(ctx(b2), null), null, 'nothing over its head')
})

/** A pathfinder that behaves like 2.4.5's where it matters here: goal/movements getters; setGoal and setMovements reset the path
 *  and CLEAR THE CONTROLS; goto stays pending until the goal changes. */
function livePathfinder (b) {
  const st = { goal: null, movements: 'walk', controls: {}, cleared: 0, reject: null }
  b.clearControlStates = () => { st.cleared++; st.controls = {} }
  b.setControlState = (k, v) => { st.controls[k] = v }
  const changed = () => { if (st.reject) { const r = st.reject; st.reject = null; r(new Error('goal changed')) } }
  b.pathfinder = {
    get goal () { return st.goal }, get movements () { return st.movements },
    setGoal (g) { st.goal = g; changed(); b.clearControlStates() },
    setMovements (m) { st.movements = m; b.clearControlStates() },
    goto (g) { changed(); st.goal = g; return new Promise((resolve, reject) => { st.reject = reject }) },
    stop () {},
  }
  // index.mjs's wrapper, line for line (its quiet branch is asserted against index.mjs below): the finally installs the DEFAULT
  // profile; with `quiet`, only over its own profile, and without clearing the controls once quiet() is true
  b.withTownDepositWalk = async (fn, { quiet = null } = {}) => {
    b.pathfinder.setMovements('town')
    try { return await fn() } finally {
      if (!quiet) b.pathfinder.setMovements('walk')
      else if (b.pathfinder.movements === 'town') {
        const keep = !!quiet(), clear = b.clearControlStates
        if (keep) b.clearControlStates = () => {}
        try { b.pathfinder.setMovements('walk') } finally { b.clearControlStates = clear }
      }
    }
  }
  return st
}
async function rescueMidHop (mod, { startProfile = 'walk' } = {}) {
  const s = G.standOf(plan, 44)
  const b = fakeBot(worldOf(), { pos: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 } })
  const st = livePathfinder(b)
  st.movements = startProfile   // 'gather': an interrupted gather walk whose own finally has not run yet
  let owned = true
  const rescueGoal = { rescue: true }
  setTimeout(() => { owned = false; b.pathfinder.setGoal(rescueGoal); b.setControlState('jump', true) }, 300)   // the rescue seizes and strokes
  const r = await mod.stairEgressReflex(b, { alive: () => owned, ms: 20_000 })
  await new Promise(res => setTimeout(res, 300))
  return { r, st, rescueGoal }
}
await t('shafttrap-02 (Codex r1 blocker 1): a rescue that takes the body mid-hop keeps its goal and its stroke; the walk profile is back', async () => {
  const { r, st, rescueGoal } = await rescueMidHop(K)
  assert.strictEqual(r.aborted, true, JSON.stringify(r))
  assert.strictEqual(st.goal, rescueGoal, 'the rescue\'s goal stands')
  assert.strictEqual(st.controls.jump, true, 'the rescue\'s jump stands')
  assert.strictEqual(st.movements, 'walk', 'the walk profile is restored')
})
await t('Claude r2 blocker: an egress that starts while an interrupted gather walk still holds its digging profile never re-installs it', async () => {
  const { st } = await rescueMidHop(K, { startProfile: 'gather' })
  assert.strictEqual(st.movements, 'walk', 'the default profile, not gather\'s')
})
async function withSkillsMutant (old, neu, fn) {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`../src/_mutant-skills-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch { /* gone */ } }
}
await t('MUTANT KILLED: a signal that only the 200 ms poll aborts lets the next hop take the rescue\'s goal back', async () => {
  await withSkillsMutant('const sig = { get aborted () { return lost() },', 'const sig = { get aborted () { return ac.signal.aborted },', async M => {
    const { st, rescueGoal } = await rescueMidHop(M)
    assert.notStrictEqual(st.goal, rescueGoal, 'the mutant walked over the rescue\'s goal')
  })
})
await t('index.mjs: the town walk\'s quiet restore is wired (only over its own profile; no control clear once the body is lost)', () => {
  const ix = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  for (const a of ['bot.withTownDepositWalk = async (fn, { quiet = null } = {}) => {',
    'if (!quiet) { bot.pathfinder.setMovements(moves); bot.movementProfile = \'walk\' }',
    'else if (bot.pathfinder.movements === townDepositMoves) {',
    'if (keep) bot.clearControlStates = () => {}']) assert.strictEqual(ix.split(a).length, 2, `missing or not unique: ${a}`)
  const sk = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  assert.ok(sk.includes("const walk = bot.withTownDepositWalk(() => bot.pathfinder.goto(goal), { quiet: () => !!signal?.aborted })"), 'the reflex hop asks for it')
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
