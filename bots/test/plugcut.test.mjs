// PLUGCUT-01: PLUG THE WET FACE, THEN CUT (docs/reports/plugcut-01-design-2026-10-24.md).
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: decisions extracted and driven, never matched as text):
//   A. the pure planners (plugcut.mjs) on the three named bots' columns, cut from the failmine library scenes
//      (fixtures/plugcut-scenes.json), each with the positive control that the shared flood check refuses the cut first;
//      and every refusal the planner owes (lava, ice, waterlogged, plants, the climb's own cells, no face, too many, no blocks);
//   B. the REAL `escapeStairUp` in a virtual clock on those columns (plugcut-world.mjs: ceilescape-01's world + placeBlock):
//      the base positive control (plug off) stops where the fleet stops, the candidate plugs, cuts and climbs; a rejected
//      placement never leads to the cut;
//   C. the refusal CHAIN over repeated firings through `floodBranch` (the 4th consecutive refusal licenses the rung, the
//      rollback switch), and its composition with the drowning yield, lava, the scaffold-only bag rule and protectzone;
//   D. the licence row's wiring (structural, comments stripped, seen to fail on a mutant);
//   E. anchored mutants (present AND unique) for the decision lines.
import assert from 'node:assert'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR && !process.env.LOG_DIR.startsWith('/srv') ? process.env.LOG_DIR : path.join(os.tmpdir(), `pc-test-${process.pid}`)
mkdirSync(process.env.LOG_DIR, { recursive: true })
const { virtualClock, makeWorldBot, sceneCells, blockOf, Vec3, reg } = await import('./plugcut-world.mjs')
const PC = await import('../src/plugcut.mjs')
const R = await import('../src/reflex.mjs')
const S = await import('../src/scaffold.mjs')
const PZ = await import('../src/protectzone.mjs')
const { digPurpose } = await import('../src/digtown.mjs')
const { tapRecords } = await import('../src/logger.mjs')

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve().then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) })

const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)
const PC_PATH = new URL('../src/plugcut.mjs', import.meta.url)
const INDEX_PATH = new URL('../src/index.mjs', import.meta.url)

/** A separate module, never src/ in place; the anchor present AND unique, or the mutant reads as killed when it never ran. */
async function withMutants (file, pairs, fn) {
  let src = readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))}`)
    assert.strictEqual(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
    src = src.replace(old, neu)
  }
  src = src.replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-pc-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const withMutant = (file, old, neu, fn) => withMutants(file, [[old, neu]], fn)

const rows = []
tapRecords(r => { const k = r?.skill?.name ?? ''; if (/^_(plugcut|climb_flood_)/.test(k)) rows.push({ kind: k, ...r.skill }) })
const pcRows = () => rows.filter(r => r.kind === '_plugcut')

const N = { x: 0, z: -1 }, W = { x: -1, z: 0 }, E = { x: 1, z: 0 }, So = { x: 0, z: 1 }
const BEARS = R.escapeBearings(0)                       // N, W, E, S: the order the ramp asks them in at yaw 0
const ISOC = 'isolated-c-Alpha', PLD = 'placebo-d-Delta', ISOD = 'isolated-d-Bravo'
/** The scene's cells (a fresh copy) and the bot's fractional feet height in its cell. */
const scene = name => { const s = sceneCells(name); return { cells: { ...s.cells }, feetY: s.bot_pos[1] - Math.floor(s.bot_pos[1]) } }
/** A pure `at` over fixture cells (outside the window reads stone, as the tests' world does). */
const atOf = cells => (x, y, z) => { const k = `${x},${y},${z}`; return blockOf(k in cells ? cells[k] : 'stone', new Vec3(x, y, z)) }
const COBBLE = n => ({ name: 'cobblestone', count: n, type: reg.itemsByName.cobblestone.id })
const key = c => c.join(',')
/** The world after the ceiling's plugs and the cut (what the probe's rows show happened), for the step planner. */
function afterCut (name) {
  const { cells } = scene(name)
  const plan = PC.ceilingPlugPlan({ at: atOf(cells), blocks: 64 })
  assert.ok(plan.ok, plan.reason)
  for (const p of plan.plugs) cells[key(p.cell)] = 'cobblestone'
  cells['0,2,0'] = 'air'
  if (/sapling/.test(cells['0,3,0'])) cells['0,3,0'] = 'air'
  return { cells, plan }
}
/** isolated-c's sapling pops when the dirt under it is dug (the probe's `_junk_pickup oak_sapling` row). */
const popSapling = (k, w) => { if (k === '0,2,0' && /sapling/.test(String(w.get(0, 3, 0)))) w.set(0, 3, 0, 'air') }

// ================================================================================================================
// A. THE PURE PLANNERS
// ================================================================================================================

const CEILING_FACE = { [ISOC]: [0, 2, -1], [PLD]: [0, 2, -1], [ISOD]: [0, 2, 1] }
for (const name of [ISOC, PLD, ISOD]) {
  await t(`THE CEILING, ${name}: ONE wet face, plugged; the shared flood check refused the cut before and allows it after`, () => {
    const { cells } = scene(name)
    const at = atOf(cells)
    const before = S.overheadBreakRisk({ at: (x, y, z) => at(x, 2 + y, z) })
    assert.match(String(before), /liquid beside the block overhead/, 'POSITIVE CONTROL: the fixture is not the refused ceiling')
    const plan = PC.ceilingPlugPlan({ at, blocks: 64 })
    assert.ok(plan.ok, plan.reason)
    assert.deepStrictEqual(plan.plugs.map(p => p.cell), [CEILING_FACE[name]])
    const ref = at(...plan.plugs[0].ref)
    assert.strictEqual(ref.boundingBox, 'block', 'the plug is clicked against a solid block')
    assert.deepStrictEqual(plan.plugs[0].ref.map((v, i) => v + plan.plugs[0].face[i]), plan.plugs[0].cell, 'ref + face is the plug cell')
    cells[key(plan.plugs[0].cell)] = 'cobblestone'
    assert.strictEqual(S.overheadBreakRisk({ at: (x, y, z) => atOf(cells)(x, 2 + y, z) }), null, 'still refused after the plug')
  })
}

/** isolated-c's column with one change -> the planner's answer. */
const isocWith = (patch, opts = {}) => {
  const { cells } = scene(ISOC)
  Object.assign(cells, patch)
  const at = atOf(cells)
  return PC.ceilingPlugPlan({ at: opts.at ? opts.at(at) : at, blocks: opts.blocks ?? 64, submerged: !!opts.submerged })
}
await t('THE CEILING REFUSES what a block cannot make dry, and says which', () => {
  const cases = [
    [{}, { submerged: true }, /submerged/],
    [{ '0,2,1': 'lava' }, {}, /lava beside the cut/],
    [{ '0,2,1': 'ice' }, {}, /ice beside the cut/],
    [{ '0,2,1': 'oak_stairs[wl]' }, {}, /waterlogged/],
    [{ '0,2,1': 'kelp' }, {}, /water plant or bubble column/],
    [{ '0,2,1': 'bubble_column' }, {}, /water plant or bubble column/],
    [{ '0,3,0': 'water[0]' }, {}, /0,3,0 is a cell the climb needs open/],
    [{ '0,2,0': 'crafting_table', '0,1,-1': 'barrel', '-1,2,-1': 'air', '0,2,-2': 'air', '0,3,-1': 'air' }, {}, /no face to click for the plug at 0,2,-1/],
    [{ '0,2,1': 'water[0]', '-1,2,0': 'water[0]', '1,2,0': 'water[0]' }, {}, /4 wet faces, more than 3/],
    [{}, { blocks: 0 }, /needs 1 block\(s\) to plug, holds 0/],
    [{ '0,2,0': 'gravel' }, {}, /falling block in or on the cut \(gravel\)/],
    [{ '0,3,0': 'sand' }, {}, /falling block in or on the cut \(sand\)/],
    [{ '0,2,0': 'water[0]' }, {}, /not a solid dry block/],
    [{ '0,2,0': 'ice' }, {}, /the cut is ice/],
    [{}, { at: at => (x, y, z) => (x === 0 && y === 2 && z === -1 ? null : at(x, y, z)) }, /not loaded beside the cut/],
  ]
  for (const [patch, opts, want] of cases) {
    const r = isocWith(patch, opts)
    assert.strictEqual(r.ok, false, `${JSON.stringify(patch)} ${JSON.stringify(Object.keys(opts))}: planned ${JSON.stringify(r.plugs)}`)
    assert.deepStrictEqual(r.plugs, [])
    assert.match(r.reason, want)
  }
  // POSITIVE CONTROL for the "too many" and "no face" rows: one fewer wet face, or one clickable face, plans
  assert.ok(isocWith({ '0,2,1': 'water[0]', '-1,2,0': 'water[0]' }).ok, 'three wet faces must still plan')
  assert.ok(isocWith({ '0,2,0': 'crafting_table', '0,1,-1': 'barrel', '-1,2,-1': 'air', '0,2,-2': 'air', '0,3,-1': 'stone' }).ok, 'one clickable face (0,3,-1) plans')
  // the cut cell itself is a legal reference for its side faces (the plug stays when the cut is dug): isolated-c with no other
  const side = isocWith({ '0,1,-1': 'air', '-1,2,-1': 'air', '0,2,-2': 'air', '0,3,-1': 'air' })
  assert.ok(side.ok && key(side.plugs[0].ref) === '0,2,0', JSON.stringify(side))
})

await t('THE STEP CELL MAY BE THE REFERENCE (Codex r1 P2): the wet face\'s only solid neighbour is the W step cell -> clicked, not refused', () => {
  const { cells } = afterCut(ISOC)
  // the W step's wet face (-1,1,1): take away every solid neighbour but the W step cell (-1,1,0) itself
  Object.assign(cells, { '0,1,1': 'air', '-2,1,1': 'air', '-1,1,2': 'air', '-1,2,1': 'air', '-1,0,1': 'water[0]' })
  const r = PC.stepPlugPlan({ at: atOf(cells), bear: W, blocks: 64 })
  assert.ok(r.ok, r.reason)
  assert.deepStrictEqual(r.plugs.map(q => [q.cell, q.ref]), [[[-1, 1, 1], [-1, 1, 0]]])
  // ...and a placement INTO a climb cell is still refused: water in the W step's own headroom (see the next tests)
})

await t('A THREE-CELL STEP (Codex r1 P2): one wet face beside each of the step\'s three cells -> three plugs, and the planner accepts', () => {
  const cells = { '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'stone', '1,0,0': 'stone', '1,1,0': 'stone', '1,2,0': 'stone', '1,3,0': 'stone',
                  '2,1,0': 'water[0]', '2,2,0': 'water[0]', '2,3,0': 'water[0]', '1,4,0': 'stone' }
  const at = atOf(cells)
  assert.ok(S.stairUpStep({ at, bear: E }).flood, 'POSITIVE CONTROL: the step is refused for water first')
  const r = PC.stepPlugPlan({ at, bear: E, blocks: 64 })
  assert.ok(r.ok, r.reason)
  assert.deepStrictEqual(r.plugs.map(q => key(q.cell)).sort(), ['2,1,0', '2,2,0', '2,3,0'])
  assert.deepStrictEqual(r.cells, [[1, 3, 0], [1, 2, 0], [1, 1, 0]])
  for (const q of r.plugs) cells[key(q.cell)] = 'cobblestone'
  assert.ok(S.stairUpStep({ at: atOf(cells), bear: E }).ok)
})

await t('THE LICENCE\'S OWN STREAK (Codex r1 P1): refusals at ONE place; another place, a lapse or progress starts again; a bob is the same place', () => {
  const T = 1_000_000
  let st = null
  for (let k = 0; k < 3; k++) st = PC.plugStreak(st, { at: [10, 40, 10], now: T + k * 60_000, refused: true })
  assert.strictEqual(PC.plugSoFar(st, [10, 40, 10], T + 200_000), 3)
  assert.strictEqual(PC.plugDue(PC.plugSoFar(st, [10, 40, 10], T + 200_000), {}), true)
  assert.strictEqual(PC.plugSoFar(st, [10, 42, 10], T + 200_000), 3, 'a bob of two blocks is the same place')
  assert.strictEqual(PC.plugSoFar(st, [10, 43, 10], T + 200_000), 0, 'three blocks up is another place')
  assert.strictEqual(PC.plugSoFar(st, [11, 40, 10], T + 200_000), 0, 'the next column is another place')
  assert.strictEqual(PC.plugSoFar(st, [10, 40, 10], T + 120_000 + PC.PLUG_STREAK_GAP_MS + 1), 0, 'a lapsed streak')
  assert.strictEqual(PC.plugStreak(st, { at: [10, 40, 10], now: T + 300_000, refused: false }).n, 0, 'progress resets')
  const moved = PC.plugStreak(st, { at: [50, 40, 50], now: T + 300_000, refused: true })
  assert.deepStrictEqual([moved.n, moved.at], [1, [50, 40, 50]], 'a refusal elsewhere starts a new streak')
})

await t('THE TEST WORLD\'S LEDGE IMPULSE IS VANILLA\'S: no impulse when the raised box holds water or meets a block (negative fixtures)', async () => {
  // a body in water against a one-block ledge, forward held for 20 ticks, no jump: the impulse alone lifts it onto the ledge
  const run = async cells => {
    const bot = makeWorldBot(cells, { feetY: 0.4, ledge: true })
    const clock = virtualClock().install()
    bot.ended = false; bot.start()
    try {
      await clock.run(async () => { await bot.look(Math.PI / 2); bot.setControlState('forward', true); await new Promise(r => setTimeout(r, 1000)) })
    } finally { bot.stop(); clock.uninstall() }
    return bot.entity.position
  }
  const base = { '0,0,0': 'water[0]', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air', '-1,0,0': 'stone', '-1,1,0': 'air', '-1,2,0': 'air', '-1,3,0': 'air', '0,-1,0': 'stone' }
  const up = await run(base)
  assert.ok(up.y >= 1 && up.x < 0, `POSITIVE CONTROL: the free ledge was not climbed: ${up}`)
  const wet = await run({ ...base, '-1,1,0': 'water[0]' })
  assert.ok(wet.y < 1, `an impulse with water in the raised box: ${wet}`)
  const roof = await run({ ...base, '-1,2,0': 'stone' })
  assert.ok(roof.y < 1, `an impulse with a block in the raised box: ${roof}`)
})

await t('THE STEP, isolated-c after the cut: every first step refused; ONE plug at the W step\'s wet face makes W a 4-step runway', () => {
  const { cells, plan } = afterCut(ISOC)
  const at = atOf(cells)
  const c0 = S.chooseStairUpBearing({ at, bearings: BEARS, depth: 4 })
  assert.strictEqual(c0.runway, 0, 'POSITIVE CONTROL: the probe\'s stop (every bearing refused) is not reproduced')
  const w0 = S.stairUpStep({ at, bear: W })
  assert.ok(w0.flood && key(w0.cell) === '-1,1,0', JSON.stringify(w0))
  const sp = PC.chooseStepPlug({ at, bearings: BEARS, blocks: 64, placed: plan.plugs.map(p => p.cell) })
  assert.ok(sp.ok, sp.reason)
  assert.deepStrictEqual(sp.bear, W)
  assert.deepStrictEqual(sp.plugs.map(p => [p.cell, p.ref]), [[[-1, 1, 1], [0, 1, 1]]])
  for (const p of sp.plugs) cells[key(p.cell)] = 'cobblestone'
  assert.ok(S.stairUpStep({ at: atOf(cells), bear: W }).ok, 'the step planner itself must accept the plugged step')
  assert.strictEqual(S.chooseStairUpBearing({ at: atOf(cells), bearings: BEARS, depth: 4 }).runway, 4)
})

await t('THE STEP RANK: with no plug placed N (first in order) is taken; with the ceiling\'s plug placed, the step that digs it out ranks last', () => {
  const { cells, plan } = afterCut(ISOC)
  // AND A RE-DIG OUTRANKS A PLUG: give W a second wet face (two plugs); of N and W, W still beats N's one plug + re-dig
  const two = { ...cells, '-1,1,-1': 'water[0]' }
  const w2 = PC.stepPlugPlan({ at: atOf(two), bear: W, blocks: 64 })
  assert.ok(w2.ok && w2.plugs.length === 2, JSON.stringify(w2))
  assert.deepStrictEqual(PC.chooseStepPlug({ at: atOf(two), bearings: [N, W], blocks: 64, placed: plan.plugs.map(p => p.cell) }).bear, W)
  const at = atOf(cells)
  const blind = PC.chooseStepPlug({ at, bearings: BEARS, blocks: 64 })
  assert.deepStrictEqual(blind.bear, N, 'POSITIVE CONTROL: N must be a 1-plug candidate for the tie-break to decide anything')
  assert.ok(blind.dig.some(c => key(c) === key(plan.plugs[0].cell)), 'N digs the ceiling\'s plug back out')
  const seen = PC.chooseStepPlug({ at, bearings: BEARS, blocks: 64, placed: plan.plugs.map(p => p.cell) })
  assert.deepStrictEqual(seen.bear, W)
  assert.strictEqual(seen.redig, 0)
})

await t('THE STEP, isolated-d after the cut: the S step needs three plugs over two cells; the planner asks stairUpStep after each', () => {
  const { cells } = afterCut(ISOD)
  const at = atOf(cells)
  const sp = PC.chooseStepPlug({ at, bearings: BEARS, blocks: 64 })
  assert.ok(sp.ok, sp.reason)
  assert.deepStrictEqual(sp.bear, So)
  assert.strictEqual(sp.plugs.length, 3)
  assert.deepStrictEqual(sp.cells, [[0, 2, 1], [0, 1, 1]])
  assert.strictEqual(PC.stepPlugPlan({ at, bear: So, blocks: 2 }).ok, false, 'two blocks cannot make three plugs')
})

await t('THE STEP REFUSES a refusal that is not a wet face, a wet face in the climb\'s own cells, and lava', () => {
  const { cells } = afterCut(PLD)
  const tread = PC.stepPlugPlan({ at: atOf(cells), bear: E, blocks: 64 })
  assert.strictEqual(tread.ok, false)
  assert.match(tread.reason, /not a wet refusal: no tread to stand on/)
  const c = afterCut(ISOC).cells
  c['-1,2,0'] = 'water[0]'                                           // water in the W step's own headroom, over its dig cell
  const own = PC.stepPlugPlan({ at: atOf(c), bear: W, blocks: 64 })
  assert.strictEqual(own.ok, false)
  assert.match(own.reason, /-1,2,0 is a cell the climb needs open/)
  const l = afterCut(ISOC).cells
  l['-2,1,0'] = 'lava'
  const lava = PC.stepPlugPlan({ at: atOf(l), bear: W, blocks: 64 })
  assert.strictEqual(lava.ok, false)
  assert.match(lava.reason, /not a wet refusal: lava against the step/)
  assert.strictEqual(PC.stepPlugPlan({ at: atOf(afterCut(ISOC).cells), bear: W, blocks: 64, submerged: true }).ok, false)
})

await t('THE LICENCE: due from the 3rd consecutive refusal counted (the 4th firing); PLUGCUT=0 turns it off; the mode row', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 9].map(n => PC.plugDue(n, {})), [false, false, false, true, true])
  assert.strictEqual(PC.plugDue(5, { PLUGCUT: '0' }), false)
  assert.strictEqual(PC.plugDue(5, { PLUGCUT: '1' }), true)
  assert.strictEqual(PC.plugCutModeDetail({}), 'on=1 after_refusals=3 max_plugs=3 rounds=3 clear_up=2 budget_s=90 step_retries=2 surface_ms=1500')
  assert.strictEqual(PC.plugCutModeDetail({ PLUGCUT: '0' }), 'on=0 after_refusals=3 max_plugs=3 rounds=3 clear_up=2 budget_s=90 step_retries=2 surface_ms=1500')
})

// ================================================================================================================
// B. THE REAL escapeStairUp ON THE NAMED COLUMNS (virtual clock, production timings)
// ================================================================================================================

/** Run one ramp in virtual time. */
async function ramp (bot, opts = {}, mod = R) {
  rows.length = 0
  const clock = virtualClock().install()
  bot.ended = false
  bot.start()
  try { return await clock.run(() => mod.escapeStairUp(bot, opts)) } finally { bot.stop(); clock.uninstall() }
}
// THE SWIMMER: Paper's jump from water clears a one-block ledge (probe 2, 10-24: the plugged W step taken). The world's
// `ledge` option models the one vanilla rule that does it (the fluid jump-out impulse); without it no step from water lands.
const botFor = (name, opts = {}) => {
  const s = scene(name)
  return makeWorldBot(s.cells, { feetY: s.feetY, items: [COBBLE(64)], ledge: true, onDig: popSapling, ...opts })
}
const cellOf = bot => { const p = bot.entity.position; return `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` }

await t('BASE POSITIVE CONTROL (plug off) on isolated-c: the fleet\'s stop -- the ceiling refused for water, no dry side, nothing dug or placed', async () => {
  const bot = botFor(ISOC)
  const r = await ramp(bot)
  assert.strictEqual(r.flood, 'ramp_breach')
  assert.match(r.stopped, /flood risk: liquid beside the block overhead \(water\); no dry side column/)
  assert.deepStrictEqual(bot.digs, [])
  assert.deepStrictEqual(bot.places, [])
  assert.strictEqual(r.plugged, 0)
  assert.strictEqual(cellOf(bot), '0,0,0')
})

await t('CANDIDATE on isolated-c: plugs the ceiling\'s face, cuts the ceiling, plugs the W step\'s face, and climbs W', async () => {
  const bot = botFor(ISOC)
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.deepStrictEqual(bot.places.filter(p => p.ok).map(p => p.cell), ['0,2,-1', '-1,1,1'])
  const dug = bot.digs.map(d => d.cell)
  assert.ok(dug.indexOf('0,2,0') >= 0 && dug.indexOf('-1,1,0') > dug.indexOf('0,2,0'), `digs: ${dug}`)
  assert.ok(!dug.includes('0,2,-1') && !dug.includes('-1,1,1'), 'a plug was dug back out')
  assert.strictEqual(r.plugged, 2)
  assert.ok(r.steps >= 1 && r.climbed >= 0.85, `${r.stopped} steps=${r.steps} climbed=${r.climbed}`)
  assert.ok(Math.floor(bot.entity.position.x) <= -1, `the bot did not go W: ${cellOf(bot)}`)
  const placed = pcRows().filter(x => / result=placed /.test(x.detail))
  assert.deepStrictEqual(placed.map(x => / for=(\S+) /.exec(x.detail)[1]), ['ceiling', 'step:-1,0'])
  for (const x of placed) { assert.ok(x.detail.length <= 300); assert.match(x.detail, / sub0=0 sub=[01] /, 'a placement row must say the head was in air at the decision') }
})

await t('CANDIDATE on isolated-d: the ceiling\'s face, then the S step\'s three; the ceiling plug is the S headroom, cut only once dry', async () => {
  const DIRT = { name: 'dirt', count: 32, type: reg.itemsByName.dirt.id }
  const bot = botFor(ISOD, { items: [DIRT, COBBLE(64)] })
  let r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  // ONE LICENSED FIRING (90 s) does it: the re-dig of the ceiling plug from water is dear (dirt, airborne: 18.75 s) but fits
  assert.ok(r.steps >= 1, `the first licensed firing took no step: ${r.stopped}`)
  const ok = bot.places.filter(p => p.ok).map(p => p.cell)
  assert.strictEqual(ok[0], '0,2,1')
  assert.ok(ok.length >= 4 && ok.length <= PC.PLUG_ROUNDS * PC.PLUG_MAX, `${ok} -- ${r.stopped}`)
  assert.deepStrictEqual(ok.slice(1, 4).sort(), ['-1,2,1', '0,2,2', '1,1,1'], 'the S step\'s three')
  // the S step digs its headroom (0,2,1) -- the ceiling's plug -- and the step cell (0,1,1); the next step may dig a step-1
  // plug that lies on its own path (0,2,2), through the same flood check. (Where the body ends after the 2nd step is this
  // world's crude airborne drift, not the ramp's: Paper decides that.) What must hold: the first step was taken.
  assert.ok(r.climbed >= 0.85, `climbed ${r.climbed}: ${r.stopped}`)
  const redig = bot.digs.find(d => d.cell === '0,2,1')
  const lastPlug = bot.places.filter(p => p.ok)[3].at
  assert.ok(redig && redig.at >= lastPlug, 'the ceiling plug was re-dug before the S step\'s faces were plugged (or never)')
  assert.ok(r.steps >= 1, r.stopped)
})

await t('CANDIDATE on placebo-d: the ceiling is plugged and cut; the stop is no longer the wet ceiling', async () => {
  const bot = botFor(PLD)
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.deepStrictEqual(bot.places.filter(p => p.ok).map(p => p.cell), ['0,2,-1'])
  assert.ok(bot.digs.some(d => d.cell === '0,2,0'), 'the ceiling was not cut')
  assert.notStrictEqual(r.flood, 'ramp_breach', r.stopped)
})

await t('A REJECTED PLACEMENT (the server says no, silently): read back as failed; the ceiling is never cut', async () => {
  const bot = botFor(ISOC, { placeFails: true })
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(bot.places.length >= 1, 'POSITIVE CONTROL: the rung never tried')
  assert.strictEqual(r.plugged, 0)
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'), 'cut without the plug')
  assert.strictEqual(r.flood, 'ramp_breach')
  assert.match(r.stopped, /plug: the plug did not take at 0,2,-1/)
  assert.ok(pcRows().some(x => / result=failed /.test(x.detail) && / plugged=0 /.test(x.detail)))
})

await t('A PLUG THAT WASHES OUT (the cell is water again after the place): failed, never cut', async () => {
  const bot = botFor(ISOC, { onPlace: (k, w) => { if (k === '0,2,-1') w.set(0, 2, -1, 'water[1]') } })
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.strictEqual(r.plugged, 0)
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'))
})

await t('THE BOT MOVES DURING THE PLUGS: stopped, nothing placed from a shifted frame', async () => {
  let moved = false
  const bot = botFor(ISOC)
  const equip = bot.equip
  bot.equip = async (it) => { await equip(it); if (!moved) { moved = true; bot.entity.position = bot.entity.position.offset(0, -1, 0) } }
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(moved, 'POSITIVE CONTROL: the equip never ran')
  assert.deepStrictEqual(bot.places, [])
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'))
  assert.ok(pcRows().some(x => / result=stopped /.test(x.detail)), pcRows().map(x => x.detail).join(' | '))
  assert.strictEqual(r.plugged, 0)
})

/** isolated-c after the cut AND the W step's plug: a dry ramp both builds can climb (the licence's two ramp changes isolated). */
const preplugged = () => { const { cells } = afterCut(ISOC); cells['-1,1,1'] = 'cobblestone'; return cells }

await t('SPARE THE PLUGS (pure): bearings whose first step digs a placed plug are left out; none placed -> all; all dig one -> none', () => {
  const firstDig = b => ({ '0,-1': [[0, 3, -1], [0, 1, -1]], '-1,0': [[-1, 1, 0]], '1,0': [], '0,1': [[0, 1, 1]] })[`${b.x},${b.z}`]
  assert.deepStrictEqual(PC.sparePlugs({ bearings: BEARS, placed: [[0, 3, -1]], firstDig }), [W, E, So])
  assert.deepStrictEqual(PC.sparePlugs({ bearings: BEARS, placed: [], firstDig }), BEARS)
  assert.deepStrictEqual(PC.sparePlugs({ bearings: [N], placed: [[0, 3, -1]], firstDig }), [])
})

/** isolated-c, licensed: plugged and cut, then the body SINKS to the pool floor (head under: the flood check's exemption). */
const DIRT_BAG = () => [{ name: 'dirt', count: 32, type: reg.itemsByName.dirt.id }, COBBLE(64)]
// `stuck: true`: a body that cannot swim up (rise 0), so the licensed surfacing fails and the plans read the submerged
// exemption -- the case where sparing is what keeps the plug (Paper probe 3, before r5's surfacing)
const sinker = ({ stuck = false } = {}) => botFor(ISOC, { items: DIRT_BAG(), ...(stuck ? { rise: 0 } : {}), onDig: (k, w, b) => { popSapling(k, w); if (k === '0,2,0') b.entity.position = new Vec3(0.5, -0.9, 0.5) } })
await t('SUBMERGED AFTER THE CUT (Paper probe 3): the ramp does not dig the ceiling\'s plug back out; it takes a bearing that spares it', async () => {
  const bot = sinker({ stuck: true })
  await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.deepStrictEqual(bot.places.filter(p => p.ok).map(p => p.cell), ['0,2,-1'], 'POSITIVE CONTROL: the ceiling was not plugged')
  assert.ok(bot.digs.some(d => d.cell === '0,2,0'), 'POSITIVE CONTROL: the ceiling was not cut')
  assert.ok(!bot.digs.some(d => d.cell === '0,2,-1'), `the plug was dug out: ${bot.digs.map(d => d.cell)}`)
})

await t('NOT HANDED BACK AT THE LIP: with a route after one step, the base stops there; the licensed ramp climbs on to 2 blocks', async () => {
  const base = makeWorldBot(preplugged(), { feetY: 0.1, items: [COBBLE(64)], ledge: true, canPath: true })
  const rb = await ramp(base, { budgetMs: PC.PLUG_BUDGET_MS })
  assert.strictEqual(rb.stopped, 'a route exists again', 'POSITIVE CONTROL: the base does not stop at the lip here')
  assert.ok(rb.climbed < PC.PLUG_CLEAR_UP, `base climbed ${rb.climbed}`)
  const lic = makeWorldBot(preplugged(), { feetY: 0.1, items: [COBBLE(64)], ledge: true, canPath: true })
  const rl = await ramp(lic, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(rl.climbed >= PC.PLUG_CLEAR_UP - 0.15, `licensed climbed ${rl.climbed}: ${rl.stopped}`)
  assert.strictEqual(rl.stopped, 'a route exists again')
  assert.deepStrictEqual(lic.places, [], 'a dry ramp needed no plug')
})

await t('A BOBBING START: a step taken from the top of the bob reads as taken with the licence, refused without (raw 0.5)', async () => {
  const base = makeWorldBot(preplugged(), { feetY: 0.6, items: [COBBLE(64)], ledge: true })
  const rb = await ramp(base, { maxSteps: 1 })
  assert.match(rb.stopped, /cut a step at y=\d+ but could not stand in it/, `POSITIVE CONTROL: ${rb.stopped} climbed=${rb.climbed}`)
  assert.strictEqual(Math.floor(base.entity.position.y), 1, 'the base\'s body IS on the step: the raw check misread it')
  const lic = makeWorldBot(preplugged(), { feetY: 0.6, items: [COBBLE(64)], ledge: true })
  const rl = await ramp(lic, { plug: true, maxSteps: 1 })
  assert.strictEqual(rl.steps, 1, rl.stopped)
})

await t('STEP TAKEN (pure): one up AND one along the bearing from the planned frame; a bob, a drift or a fall back is not', () => {
  const p = { x: 0.5, y: 60.4, z: 0.5 }
  assert.strictEqual(R.stepTaken({ x: 0.5, y: 61.0, z: 1.5 }, p, So), true)
  assert.strictEqual(R.stepTaken({ x: 0.5, y: 61.9, z: 1.5 }, p, So), true, 'anywhere in the step cell')
  assert.strictEqual(R.stepTaken({ x: 0.5, y: 61.2, z: 0.5 }, p, So), false, 'a bob up in its own column is not a step')
  assert.strictEqual(R.stepTaken({ x: 1.5, y: 61.0, z: 1.5 }, p, So), false, 'a drift into the next column over')
  assert.strictEqual(R.stepTaken({ x: 0.5, y: 60.9, z: 1.5 }, p, So), false, 'still at the frame\'s height')
})

await t('A PLUG THAT LETS WATER ROUND IT LATER (Claude r1 P2): the faces are asked again PLUG_SETTLE_MS on; a face that fills meanwhile is plugged before the cut', async () => {
  // isolated-c: once the ceiling's N face is plugged, water reaches its W face a second later
  let filled = false
  const bot = botFor(ISOC, { onPlace: (k, w) => { if (k === '0,2,-1' && !filled) { filled = true; setTimeout(() => w.set(-1, 2, 0, 'water[1]'), 600) } } })
  await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(filled, 'POSITIVE CONTROL: the late flow never happened')
  const ok = bot.places.filter(p => p.ok).map(p => p.cell)
  assert.deepStrictEqual(ok.slice(0, 2), ['0,2,-1', '-1,2,0'], `the late face was not plugged before the cut: ${ok}`)
  const cut = bot.digs.find(d => d.cell === '0,2,0')
  assert.ok(cut && cut.at >= bot.places.filter(p => p.ok)[1].at, 'the ceiling was cut before the late face was plugged')
})

await t('NEVER MORE THAN PLUG_MAX PLACEMENTS IN ONE RUNG (Claude r1 P2): a face that refills after every plug ends the rung, uncut', async () => {
  // every plug washes out to water again, yet reads as a block for the read-back: the rung must stop at PLUG_MAX
  let n = 0
  const bot = botFor(ISOC, { onPlace: (k, w) => { n++; setTimeout(() => w.set(...k.split(',').map(Number), 'water[1]'), 400) } })
  await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(n >= 1, 'POSITIVE CONTROL: nothing was placed')
  assert.ok(pcRows().filter(x => / for=ceiling /.test(x.detail) && / result=placed /.test(x.detail)).length <= PC.PLUG_MAX, `${n} placements`)
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'), 'cut while the face kept refilling')
})

await t('THE STEP RUNG WRITES ITS REFUSAL (Claude r1 P3): a licensed ramp whose steps cannot be plugged leaves one refused for=step row', async () => {
  const { cells } = afterCut(ISOC)
  cells['-1,1,1'] = 'lava'                                               // the W/S steps' wet face is now lava: never plugged
  cells['1,2,-1'] = 'lava'                                               // ...and N's (beside the ceiling plug) too
  const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], ledge: true })
  await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  const r = pcRows().filter(x => / for=step /.test(x.detail) && / result=refused /.test(x.detail))
  assert.strictEqual(r.length, 1, pcRows().map(x => x.detail).join(' | '))
  assert.deepStrictEqual(bot.places, [])
})

await t('SPARE A UTILITY BLOCK (Claude r1 P3): a licensed ramp prefers a bearing whose first step digs no furnace or table; the base does not', async () => {
  const { cells } = afterCut(ISOC)
  cells['-1,1,1'] = 'cobblestone'                                         // dry the W step (as its plug would)
  cells['-1,1,0'] = 'furnace'                                             // ...and make the W step cell a furnace
  const lic = makeWorldBot({ ...cells }, { feetY: 0.1, items: [COBBLE(64)], ledge: true })
  await ramp(lic, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(!lic.digs.some(d => d.name === 'furnace'), `the licensed ramp dug the furnace: ${lic.digs.map(d => d.cell + ':' + d.name)}`)
  const base = makeWorldBot({ ...cells }, { feetY: 0.1, items: [COBBLE(64)], ledge: true })
  await ramp(base, { budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(base.digs.some(d => d.name === 'furnace'), `POSITIVE CONTROL: the base did not choose the furnace step: ${base.digs.map(d => d.cell + ':' + d.name)}`)
})

await t('A YIELD DURING THE SETTLE (both engines r2): the rung returns yielded, and the step loop digs nothing after it', async () => {
  // the step rung on isolated-c after the cut: the drowning rescue takes the body during the settle that follows the plug
  const { cells } = afterCut(ISOC)
  let placedAt = null
  const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], ledge: true, onPlace: () => { placedAt = Date.now() } })
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS,
    yieldTo: () => (placedAt != null && Date.now() >= placedAt + 300 + 600 ? 'drowning' : null) })
  assert.ok(placedAt != null, 'POSITIVE CONTROL: no step plug was placed')
  assert.strictEqual(r.yielded, 'drowning')
  assert.deepStrictEqual(bot.digs, [], `dug after the owner changed: ${bot.digs.map(d => d.cell)}`)
})

await t('THE DEADLINE (Claude r2 P3-2, Codex r2 P2): a deadline that passes during the equip places nothing, and says so', async () => {
  // the equip takes 2 s of a firing with 1.5 s left at the rung (virtual time moves only on timers, so the equip is the clock)
  const b2 = botFor(ISOC)
  const equip = b2.equip
  b2.equip = async it => { await new Promise(r => setTimeout(r, 2000)); return equip(it) }
  await ramp(b2, { plug: true, budgetMs: 1500 })
  assert.deepStrictEqual(b2.places, [], 'placed after the deadline')
  assert.ok(pcRows().some(x => / result=stopped /.test(x.detail) && /budget spent/.test(x.detail)), pcRows().map(x => x.detail).join(' | '))
})

/** preplugged, with the FIRST forward stroke swallowed (the jump from a bob that does not carry): a step cut and not taken. */
const missFirst = ({ cut = false } = {}) => {
  const cells = preplugged()
  if (cut) cells['-1,1,0'] = 'air'                                    // the W step already cut: no dig, only the jumps
  const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], ledge: true })
  const set = bot.setControlState.bind(bot)
  let missed = false
  bot.setControlState = (n, on) => { if (n === 'forward' && on && !missed) { missed = true; return set('jump', true) } return set(n, on) }
  return bot
}
await t('A STEP CUT BUT NOT TAKEN (Paper gate, isolated-d): the licensed ramp jumps again from its own column; the base stops', async () => {
  const base = missFirst()
  const rb = await ramp(base, { budgetMs: PC.PLUG_BUDGET_MS })
  assert.match(rb.stopped, /could not stand in it/, `POSITIVE CONTROL: ${rb.stopped}`)
  const lic = missFirst()
  const rl = await ramp(lic, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(rl.steps >= 1, `the licensed ramp did not retry: ${rl.stopped}`)
  const digsW = lic.digs.filter(d => d.cell === '-1,1,0').length
  assert.strictEqual(digsW, 1, 'the step cell was cut again (a widened ledge)')
})

await t('THE RETRY YIELDS (Codex r3 P2): an owner that takes the body after the missed jump gets no control write from the retry', async () => {
  const bot = missFirst()
  let firstAt = null
  const set = bot.setControlState
  bot.setControlState = (n, on) => { if (n === 'jump' && on && firstAt == null) firstAt = Date.now(); return set(n, on) }
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (firstAt != null && Date.now() >= firstAt + 900 ? 'drowning' : null) })
  assert.ok(firstAt != null, 'POSITIVE CONTROL: no jump was made')
  assert.strictEqual(r.yielded, 'drowning')
  const writes = bot.controls.filter(c => /^(forward|jump):true$/.test(c))
  assert.strictEqual(writes.length, 2, `the retry wrote controls under the new owner: ${bot.controls.join(' ')}`)   // the first stroke's jump (forward swallowed into jump) + its jump
})

await t('THE RETRY RE-ASKS THE STEP (Claude r3 P3-1): a step cell that refills between jumps ends the retries, nothing dug', async () => {
  const bot = missFirst()
  const set = bot.setControlState
  let refilled = false
  bot.setControlState = (n, on) => { if (n === 'jump' && !on && !refilled) { refilled = true; bot.world.set(-1, 1, 0, 'gravel') } return set(n, on) }
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(refilled, 'POSITIVE CONTROL: no refill')
  assert.strictEqual(r.stepRetries, 0, `retried into a refilled step: ${r.stopped}`)
  assert.match(r.stopped, /could not stand in it/)
})

await t('MUTANT KILLED: the retry blind to the owner -> it writes controls under the drowning rescue', async () => {
  await withMutant(REFLEX_PATH, '    const gone = () => (yielded = yieldTo())\n', '    const gone = () => null\n', async m => {
    const bot = missFirst()
    let firstAt = null
    const set = bot.setControlState
    bot.setControlState = (n, on) => { if (n === 'jump' && on && firstAt == null) firstAt = Date.now(); return set(n, on) }
    await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (firstAt != null && Date.now() >= firstAt + 900 ? 'drowning' : null) }, m)
    assert.ok(bot.controls.filter(c => /^(forward|jump):true$/.test(c)).length > 2, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: the retry not re-asking the step -> it jumps into the refilled step', async () => {
  await withMutant(REFLEX_PATH, '      if (!still.ok || still.dig.length || !inColumn()) break\n', '', async m => {
    const bot = missFirst()
    const set = bot.setControlState
    let refilled = false
    bot.setControlState = (n, on) => { if (n === 'jump' && !on && !refilled) { refilled = true; bot.world.set(-1, 1, 0, 'gravel') } return set(n, on) }
    const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
    assert.ok(r.stepRetries > 0, 'the mutant did not change behaviour')
  })
})

await t('NO RETRY THE DEADLINE CANNOT HOLD (both engines r5): a missed step with under 1050 ms left is not jumped again, and says why', async () => {
  const probe = missFirst()
  const r0 = await ramp(probe, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(r0.stepRetries >= 1, 'POSITIVE CONTROL: the retry runs with time left')
  // a budget that ends inside the window of a second jump (the first stroke spends 1050 ms of 1500)
  const tight = missFirst({ cut: true })
  const rt = await ramp(tight, { plug: true, budgetMs: 1500 })
  assert.strictEqual(rt.stepRetries, 0, `retried past the deadline: ${rt.stopped}`)
  assert.match(rt.stopped, /budget spent before a step retry/, rt.stopped)
})

await t('MUTANT KILLED: the retry reason overwritten -> the stop reads "could not stand"', async () => {
  await withMutant(REFLEX_PATH, "      stopped = retryStop ?? `cut a step at y=${Math.round(before.y)} but could not stand in it`\n",
    "      stopped = `cut a step at y=${Math.round(before.y)} but could not stand in it`\n", async m => {
      const rt = await ramp(missFirst({ cut: true }), { plug: true, budgetMs: 1500 }, m)
      assert.doesNotMatch(rt.stopped, /budget spent before a step retry/, 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: no retry -> the licensed ramp stops at the missed jump', async () => {
  await withMutant(REFLEX_PATH, '    while (!taken && plug && stepRetry < PLUG_STEP_RETRIES && inColumn()) {',
    '    while (false) {', async m => {
      const r = await ramp(missFirst(), { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
      assert.match(r.stopped, /could not stand in it/, 'the mutant did not change behaviour')
    })
})

// ================================================================================================================
// C. THE CHAIN AND ITS COMPOSITION
// ================================================================================================================

/** One firing of floodBranch, as the entombed arm runs it, in virtual time. */
async function firing (bot, refusals, mod = R) {
  rows.length = 0
  const clock = virtualClock().install()
  bot.start()
  bot.ended = false                                       // the world's stop() is one-way; each firing gets its ticks back
  try { return await clock.run(() => mod.floodBranch(bot, { handler: 'entombed', refusals })) } finally { bot.stop(); clock.uninstall() }
}

await t('THE CHAIN ACROSS A RECOVERY (Codex r1 P1): three refusals in one pit, a recovery by another route, then a refusal in the next pit is NOT licensed', async () => {
  const seen = []
  const fake = async (_bot, o) => { seen.push(!!o.plug); return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' } }
  const bot = botFor(ISOC)
  let refusals = 0
  for (let k = 0; k < 3; k++) refusals = (await R.floodBranch(bot, { handler: 'entombed', refusals, ramp: fake })).refusals
  bot.entity.position = new Vec3(40.5, 70.1, 40.5)                     // poolescape / a pillar took it out: the arm's counter is NOT reset
  await R.floodBranch(bot, { handler: 'marooned', refusals, ramp: fake })
  assert.deepStrictEqual(seen, [false, false, false, false], 'the first refusal in a new place was licensed')
  // POSITIVE CONTROL: the same four firings in ONE place license the 4th
  const seen2 = []
  const fake2 = async (_bot, o) => { seen2.push(!!o.plug); return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' } }
  const b2 = botFor(ISOC)
  for (let k = 0; k < 4; k++) await R.floodBranch(b2, { handler: 'entombed', refusals: k, ramp: fake2 })
  assert.deepStrictEqual(seen2, [false, false, false, true])
})

await t('A RECOVERY BACK TO THE SAME PIT (Codex r2 P1): a body that LEFT the place forgets the streak; re-entry is a new one', async () => {
  const seen = []
  const fake = async (_bot, o) => { seen.push(!!o.plug); return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' } }
  const bot = botFor(ISOC)
  const home = bot.entity.position
  for (let k = 0; k < 3; k++) await R.floodBranch(bot, { handler: 'entombed', refusals: k, ramp: fake })
  bot.entity.position = new Vec3(40.5, 70.1, 40.5)                     // out by another route...
  R.plugStreakTouch(bot)                                               // ...seen by a reflex tick
  bot.entity.position = home                                           // ...and back into the same pit
  await R.floodBranch(bot, { handler: 'entombed', refusals: 3, ramp: fake })
  assert.deepStrictEqual(seen, [false, false, false, false])
  // POSITIVE CONTROL: a tick while it is still at the place (a bob within 2) keeps the streak
  const s2 = []
  const fake2 = async (_bot, o) => { s2.push(!!o.plug); return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' } }
  const b2 = botFor(ISOC)
  for (let k = 0; k < 3; k++) { await R.floodBranch(b2, { handler: 'entombed', refusals: k, ramp: fake2 }); R.plugStreakTouch(b2) }
  b2.entity.position = b2.entity.position.offset(0, 1.5, 0); R.plugStreakTouch(b2); b2.entity.position = b2.entity.position.offset(0, -1.5, 0)
  await R.floodBranch(b2, { handler: 'entombed', refusals: 3, ramp: fake2 })
  assert.deepStrictEqual(s2, [false, false, false, true])
  // the entombed arm's own success clears it too
  const b3 = botFor(ISOC)
  for (let k = 0; k < 3; k++) await R.floodBranch(b3, { handler: 'entombed', refusals: k, ramp: fake2 })
  R.plugStreakClear(b3)
  s2.length = 0
  await R.floodBranch(b3, { handler: 'entombed', refusals: 3, ramp: fake2 })
  assert.deepStrictEqual(s2, [false])
})

await t('A STREAK FORGOTTEN DURING THE RAMP STAYS FORGOTTEN (Codex r3 P1): the 4th ramp leaves A, a tick sees it, it returns -> not licensed next', async () => {
  const seen = []
  let k = 0
  const fake = async (b, o) => {
    seen.push(!!o.plug)
    if (++k === 4) { const home = b.entity.position; b.entity.position = new Vec3(40.5, 70.1, 40.5); R.plugStreakTouch(b); b.entity.position = home }
    return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' }
  }
  const bot = botFor(ISOC)
  for (let i = 0; i < 5; i++) await R.floodBranch(bot, { handler: 'entombed', refusals: i, ramp: fake })
  assert.deepStrictEqual(seen, [false, false, false, true, false], 'the 5th firing was licensed from a resurrected streak')
})

await t('MUTANT KILLED: the streak rebuilt from the pre-ramp copy -> the 5th firing is licensed', async () => {
  await withMutant(REFLEX_PATH, '  const live = plugStreaks.get(bot) === prevStreak ? prevStreak : null\n', '  const live = prevStreak\n', async m => {
    const seen = []
    let k = 0
    const fake = async (b, o) => {
      seen.push(!!o.plug)
      if (++k === 4) { const home = b.entity.position; b.entity.position = new Vec3(40.5, 70.1, 40.5); m.plugStreakTouch(b); b.entity.position = home }
      return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' }
    }
    const bot = botFor(ISOC)
    for (let i = 0; i < 5; i++) await m.floodBranch(bot, { handler: 'entombed', refusals: i, ramp: fake })
    assert.strictEqual(seen[4], true, 'the mutant did not change behaviour')
  })
})

await t('WIRED (structural): the reflex tick touches the streak, and the entombed success clears it (each seen to fail on a mutant)', () => {
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l.replace(/(^|\s)\/\/.*$/, '$1'))).join('\n')
  const wired = src => { const c = strip(src); return /healthBeforeTick = bot\.health \?\? null\n\s*plugStreakTouch\(bot\)\n\s*if \(airPocketing\) return/.test(c.replace(/\n\s*\n/g, '\n')) && /floodRefusals = 0; plugStreakClear\(bot\) \}/.test(c) }
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(wired(src))
  const a = '      plugStreakTouch(bot)\n', b = 'floodRefusals = 0; plugStreakClear(bot) }'
  assert.strictEqual(src.split(a).length, 2, 'ANCHOR a'); assert.strictEqual(src.split(b).length, 2, 'ANCHOR b')
  assert.strictEqual(wired(src.replace(a, '')), false)
  assert.strictEqual(wired(src.replace(b, 'floodRefusals = 0 }')), false)
})

await t('THE CHAIN on isolated-c: three refusals as today (nothing placed, a growing back-off), the 4th firing plugs, cuts and climbs', async () => {
  const bot = botFor(ISOC)
  let refusals = 0, last = 0
  for (let k = 0; k < 3; k++) {
    const f = await firing(bot, refusals)
    assert.strictEqual(f.progressed, false, `firing ${k + 1}`)
    assert.strictEqual(f.refusals, refusals + 1)
    assert.ok(f.backoffMs > last)
    assert.deepStrictEqual(bot.places, [], `firing ${k + 1} placed before the licence`)
    refusals = f.refusals; last = f.backoffMs
  }
  const f4 = await firing(bot, refusals)
  assert.strictEqual(f4.progressed, true, f4.stair?.stopped)
  assert.strictEqual(f4.refusals, 0, 'progress resets the counter')
  assert.strictEqual(f4.stair.plugged, 2)
  const ramp4 = rows.find(x => x.kind === '_climb_flood_ramp')
  assert.match(ramp4.detail, / plugged=2 retries=\d+ surfaced=\d+ /)
})

await t('ROLLBACK (PLUGCUT=0): the 4th firing and every one after refuse exactly as the base, nothing placed', async () => {
  const prev = process.env.PLUGCUT
  process.env.PLUGCUT = '0'
  try {
    const bot = botFor(ISOC)
    for (const n of [3, 4, 7]) {
      const f = await firing(bot, n)
      assert.strictEqual(f.progressed, false)
      assert.deepStrictEqual(bot.places, [])
      assert.deepStrictEqual(bot.digs, [])
    }
  } finally { if (prev === undefined) delete process.env.PLUGCUT; else process.env.PLUGCUT = prev }
})

await t('THE DROWNING RESCUE OUTRANKS THE PLUG: a yield after the equip places nothing and leaves the controls alone', async () => {
  const bot = botFor(ISOC)
  const equip = bot.equip
  let equippedAt = -1
  bot.equip = async (it) => { await equip(it); if (equippedAt < 0) equippedAt = bot.controls.length }
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (equippedAt >= 0 ? 'drowning' : null) })
  assert.ok(equippedAt >= 0, 'POSITIVE CONTROL: the rung never reached the equip')
  assert.strictEqual(r.yielded, 'drowning')
  assert.deepStrictEqual(bot.places, [])
  assert.ok(!bot.controls.slice(equippedAt).includes('clear'), 'the controls were wiped under the new owner')
})

// PLUGCUT-01 x LAVASTEP-01 (JIT 10-24, Codex P2): the owner changes DURING the placement's look (a danger move takes the
// body). The plug looks first, asks the owner again, and only then places without a look -- so nothing is placed.
await t('A NEW OWNER DURING THE LOOK: the plug is not placed (the look comes first, the owner is asked again, the placement has no look of its own)', async () => {
  const bot = botFor(ISOC)
  let took = false
  bot.onLookAt = async () => { took = true }
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (took ? 'lavastep' : null) })
  assert.ok(bot.lookCalls >= 1, 'POSITIVE CONTROL: the rung reached the plug\'s look')
  assert.strictEqual(r.yielded, 'lavastep')
  assert.deepStrictEqual(bot.places, [])
})
await t('CONTROL: no new owner -> the same rung looks once per plug and places (the look-then-place path is live)', async () => {
  const bot = botFor(ISOC)
  await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(bot.places.length >= 1, JSON.stringify(bot.places))
  assert.ok(bot.lookCalls >= bot.places.length, `one look per placement: ${bot.lookCalls} looks, ${bot.places.length} places`)
})
await t('MUTANT KILLED: the owner not asked after the look -> the plug goes out under the new owner', async () => {
  await withMutant(REFLEX_PATH, "      if (yieldTo()) return out(false, 'yielded')\n      if (Date.now() > deadline) { row(q, 'stopped', 'budget spent at the look'); return out(false, 'budget spent plugging') }\n",
    "      if (Date.now() > deadline) { row(q, 'stopped', 'budget spent at the look'); return out(false, 'budget spent plugging') }\n", async m => {
    const bot = botFor(ISOC)
    let took = false
    bot.onLookAt = async () => { took = true }
    await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (took ? 'lavastep' : null) }, m)
    assert.ok(bot.places.length >= 1, 'mutant: placed under the new owner')
  })
})

await t('A BAG OF TOOLS AND TORCHES ONLY: no plug (never a tool, never a non-scaffold block); the base refusal stands', async () => {
  const items = [{ name: 'stone_pickaxe', count: 1, type: reg.itemsByName.stone_pickaxe.id }, { name: 'torch', count: 12, type: reg.itemsByName.torch.id }]
  const bot = botFor(ISOC, { items })
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.deepStrictEqual(bot.places, [])
  assert.match(r.stopped, /plug: needs 1 block\(s\) to plug, holds 0/)
})

await t('LAVA BESIDE THE CEILING: never plugged, never cut (the rung adds no move near lava)', async () => {
  const s = scene(ISOC)
  s.cells['0,2,1'] = 'lava'
  const bot = makeWorldBot(s.cells, { feetY: s.feetY, items: [COBBLE(64)], ledge: true })
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.deepStrictEqual(bot.places, [])
  assert.deepStrictEqual(bot.digs, [])
  assert.match(r.stopped, /lava/)
})

// PURE, BY DESIGN (Claude r1 P3): the purpose is chosen here, not driven through attachProtectZone's runtime context; it pins
// the two facts the plug relies on -- a reflex's place is `survival`, and a zone lets a survival place through.
await t('PROTECTZONE COMPOSES: a plug is a survival placement under the entombed reflex, which a zone allows (and refuses for a skill)', () => {
  const { zones } = PZ.parseZones({ version: 1, zones: [{ id: 'z', kind: 'village', box: [-10, -10, -10, 10, 10, 10] }] })
  assert.strictEqual(zones.length, 1)
  const cell = { x: 0, y: 2, z: -1 }
  assert.strictEqual(PZ.zoneDecision({ zones, op: 'place', cell, purpose: digPurpose({ reflex: 'entombed' }).purpose }), null)
  assert.ok(PZ.zoneDecision({ zones, op: 'place', cell, purpose: digPurpose({ skill: 'gather' }).purpose }), 'POSITIVE CONTROL: the zone refuses a non-survival place')
})

// ================================================================================================================
// D. WIRING (structural: the licence row has no behaviour this file can drive without booting a bot)
// ================================================================================================================

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l.replace(/(^|\s)\/\/.*$/, '$1'))).join('\n')
const modeRowWired = src => /logEvent\(\{ kind: 'plugcut_mode', status: 'success', snapshot: snapshot\(bot\), detail: plugCutModeDetail\(\) \}\)/.test(strip(src)) &&
  /import \{ plugCutModeDetail \} from '\.\/plugcut\.mjs'/.test(strip(src))
await t('WIRED: the licence row is written once per spawn (and the assertion fails on a mutant)', () => {
  const src = readFileSync(INDEX_PATH, 'utf8')
  assert.ok(modeRowWired(src))
  const line = "    try { logEvent({ kind: 'plugcut_mode', status: 'success', snapshot: snapshot(bot), detail: plugCutModeDetail() }) } catch {}\n"
  assert.strictEqual(src.split(line).length, 2, 'ANCHOR')
  assert.strictEqual(modeRowWired(src.replace(line, `    // ${line.trim()}\n`)), false, 'a commented-out row still reads as wired')
})

// ================================================================================================================
// E. MUTANTS
// ================================================================================================================

await t('MUTANT KILLED: the ceiling rung without its licence -> the base (plug off) places', async () => {
  await withMutant(REFLEX_PATH, "if (plug && !submerged && plugRounds < PLUG_ROUNDS && key3(plan.cell ?? [0, 2, 0]) === '0,2,0') {",
    "if (!submerged && plugRounds < PLUG_ROUNDS && key3(plan.cell ?? [0, 2, 0]) === '0,2,0') {", async m => {
      const bot = botFor(ISOC)
      await ramp(bot, {}, m)
      assert.ok(bot.places.length > 0, 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: the step rung without its licence -> an open-ceiling ramp with plug off places', async () => {
  await withMutant(REFLEX_PATH, 'if ((!choice || choice.runway === 0) && plug && !submerged && plugRounds < PLUG_ROUNDS) {',
    'if ((!choice || choice.runway === 0) && !submerged && plugRounds < PLUG_ROUNDS) {', async m => {
      const { cells } = afterCut(ISOC)
      const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], ledge: true })
      await ramp(bot, {}, m)
      assert.ok(bot.places.length > 0, 'the mutant did not change behaviour')
    })
  // POSITIVE CONTROL: the real module, same world, places nothing
  const { cells } = afterCut(ISOC)
  const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], ledge: true })
  await ramp(bot, {})
  assert.deepStrictEqual(bot.places, [])
})

await t('MUTANT KILLED: no read-back of the placed cell -> a rejected placement is counted and the ceiling is cut', async () => {
  await withMutant(REFLEX_PATH, "if (!got || got.boundingBox !== 'block') {", 'if (false) {', async m => {
    const bot = botFor(ISOC, { placeFails: true })
    const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
    assert.ok(r.plugged > 0, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: floodBranch licenses every firing -> the 1st firing places', async () => {
  await withMutant(REFLEX_PATH, 'const due = plugDue(plugSoFar(prevStreak, here, Date.now()))', 'const due = true', async m => {
      const bot = botFor(ISOC)
      await firing(bot, 0, m)
      assert.ok(bot.places.length > 0, 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: the ceiling plan without the climb\'s next cell kept -> water over the ceiling is plugged', async () => {
  await withMutant(PC_PATH, 'const fp = facePlugs(at, cell, new Set([...OWN, [cell[0], cell[1] + 1, cell[2]]].map(key)))',
    'const fp = facePlugs(at, cell, new Set(OWN.map(key)))', async m => {
      const { cells } = scene(ISOC)
      cells['0,3,0'] = 'water[0]'
      assert.strictEqual(m.ceilingPlugPlan({ at: atOf(cells), blocks: 64 }).ok, true, 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: no re-dig rank -> isolated-c steps N through its own plug', async () => {
  await withMutant(PC_PATH, 'redig < best.redig || (redig === best.redig && r.plugs.length < best.plugs.length)', 'r.plugs.length < best.plugs.length', async m => {
    const { cells, plan } = afterCut(ISOC)
    const sp = m.chooseStepPlug({ at: atOf(cells), bearings: BEARS, blocks: 64, placed: plan.plugs.map(p => p.cell) })
    assert.deepStrictEqual(sp.bear, N, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: the step plan trusts its plugs without re-asking stairUpStep -> isolated-d plans one plug too few', async () => {
  await withMutant(PC_PATH, '    plugs.push(...fp.plugs)\n    cells.push(step.cell)\n',
    '    plugs.push(...fp.plugs)\n    cells.push(step.cell)\n    return { ok: true, plugs, cells, dig: [], reason: null }\n', async m => {
      const { cells } = afterCut(ISOD)
      const sp = m.stepPlugPlan({ at: atOf(cells), bear: So, blocks: 64 })
      assert.ok(sp.ok && sp.plugs.length < 3, 'the mutant did not change behaviour')
    })
})

await t('SURFACE BEFORE PLANNING (Paper gate, isolated-c): a licensed bot sunk after the cut swims up before it plans; the base plans sunk', async () => {
  const run = async (opts, mod = R) => {
    const bot = sinker()
    const trace = []
    const set = bot.setControlState
    bot.setControlState = (n, on) => { trace.push(`${n}:${on}:${R.submergedAt ? '' : ''}`); return set(n, on) }
    const r = await ramp(bot, opts, mod)
    return { bot, r }
  }
  const lic = await run({ plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  assert.ok(lic.r.surfaced >= 1, `the licensed ramp never surfaced: ${lic.r.stopped}`)
  const base = await run({ budgetMs: PC.PLUG_BUDGET_MS })
  assert.strictEqual(base.r.surfaced, 0, 'POSITIVE CONTROL: the unlicensed ramp surfaced')
})

await t('SURFACING YIELDS (Claude r4 P3-2): an owner taking the body during the hold gets no further control write and no dig', async () => {
  const bot = sinker({ stuck: true })                                     // cannot swim up: the hold runs its full length
  let held = null
  const set = bot.setControlState
  bot.setControlState = (n, on) => { if (n === 'jump' && on && held == null && bot.digs.length) held = Date.now(); return set(n, on) }
  const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (held != null && Date.now() >= held + 300 ? 'drowning' : null) })
  assert.ok(held != null, 'POSITIVE CONTROL: no surfacing hold after the cut')
  assert.strictEqual(r.yielded, 'drowning')
  const i = bot.controls.lastIndexOf('jump:true')
  assert.deepStrictEqual(bot.controls.slice(i + 1), [], `controls written under the new owner: ${bot.controls.slice(i + 1)}`)
  assert.ok(!bot.digs.some(d => d.at > held), 'dug under the new owner')
})

await t('MUTANT KILLED: surfacing blind to the owner -> it writes jump:false (and goes on) under the drowning rescue', async () => {
  await withMutant(REFLEX_PATH, "      await sleep(100)\n      if ((yielded = yieldTo())) return 'yielded'\n", '      await sleep(100)\n', async m => {
    const bot = sinker({ stuck: true })
    let held = null
    const set = bot.setControlState
    bot.setControlState = (n, on) => { if (n === 'jump' && on && held == null && bot.digs.length) held = Date.now(); return set(n, on) }
    await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (held != null && Date.now() >= held + 300 ? 'drowning' : null) }, m)
    const i = bot.controls.lastIndexOf('jump:true')
    assert.ok(bot.controls.slice(i + 1).length > 0, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: surfacing off -> the licensed sunk bot plans under the exemption', async () => {
  await withMutant(REFLEX_PATH, '    if (!plug || !submergedAt(bot)) return true\n', '    return true\n', async m => {
    const bot = sinker()
    const r = await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
    assert.strictEqual(r.surfaced, 0, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: no plug sparing -> the submerged bot digs the ceiling\'s plug out first (N, top down)', async () => {
  await withMutant(REFLEX_PATH, '      if (!plug) return any()\n', '      return any()\n', async m => {
    const bot = sinker({ stuck: true })
    await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
    assert.ok(bot.digs.some(d => d.cell === '0,2,-1'), `the mutant did not change behaviour: ${bot.digs.map(d => d.cell)}`)
  })
})

await t('MUTANT KILLED: the lip rule off -> the licensed ramp is handed back after one step', async () => {
  await withMutant(REFLEX_PATH, 'if ((!plug || Math.floor(bot.entity.position.y + 1e-6) - Math.floor(startY + 1e-6) >= PLUG_CLEAR_UP) && await canStartAPath(bot)) {',
    'if (await canStartAPath(bot)) {', async m => {
      const lic = makeWorldBot(preplugged(), { feetY: 0.1, items: [COBBLE(64)], ledge: true, canPath: true })
      const r = await ramp(lic, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
      assert.ok(r.climbed < PC.PLUG_CLEAR_UP - 0.15, 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: the floored step check off -> the licensed bobbing step is refused', async () => {
  await withMutant(REFLEX_PATH, 'let taken = plug ? stepTaken(bot.entity.position, p, bearing) : bot.entity.position.y - before.y >= 0.5',
    'let taken = bot.entity.position.y - before.y >= 0.5', async m => {
      const lic = makeWorldBot(preplugged(), { feetY: 0.6, items: [COBBLE(64)], ledge: true })
      const r = await ramp(lic, { plug: true, maxSteps: 1 }, m)
      assert.strictEqual(r.steps, 0, 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: the licensed firing on the base budget -> floodBranch hands the ramp 60 s', async () => {
  let seen = null
  const fake = async (_bot, o) => { seen = o; return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' } }
  rows.length = 0
  const pinned = async (mod = R) => { const b = botFor(ISOC); for (let k = 0; k < 4; k++) await mod.floodBranch(b, { handler: 'entombed', refusals: k, ramp: fake }) }
  await pinned()
  assert.deepStrictEqual([seen.plug, seen.budgetMs], [true, PC.PLUG_BUDGET_MS])
  await R.floodBranch(botFor(ISOC), { handler: 'entombed', refusals: 2, ramp: fake })
  assert.deepStrictEqual([!!seen.plug, seen.budgetMs], [false, undefined], 'an unlicensed firing keeps the ramp\'s own 60 s')
  await withMutant(REFLEX_PATH, 'ramp = (b, o) => plain(b, { ...o, plug: true, budgetMs: PLUG_BUDGET_MS })', 'ramp = (b, o) => plain(b, { ...o, plug: true })', async m => {
    await pinned(m)
    assert.deepStrictEqual([seen.plug, seen.budgetMs], [true, undefined], 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: the licence one refusal late (>) -> the 4th firing does not plug', async () => {
  await withMutant(PC_PATH, 'Number(soFar) >= PLUG_AFTER_REFUSALS', 'Number(soFar) > PLUG_AFTER_REFUSALS', async m => {
    assert.strictEqual(m.plugDue(3, {}), false, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: no settle before the cut -> the late flow is cut into', async () => {
  await withMutant(REFLEX_PATH, 'const settledClear = async () => { if (!clear() || deadline - Date.now() < PLUG_SETTLE_MS) return false; await sleep(PLUG_SETTLE_MS); return clear() }',
    'const settledClear = async () => clear()', async m => {
      let filled = false
      const bot = botFor(ISOC, { onPlace: (k, w) => { if (k === '0,2,-1' && !filled) { filled = true; setTimeout(() => w.set(-1, 2, 0, 'water[1]'), 600) } } })
      await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
      const ok = bot.places.filter(p => p.ok).map(p => p.cell)
      assert.notDeepStrictEqual(ok.slice(0, 2), ['0,2,-1', '-1,2,0'], 'the mutant did not change behaviour')
    })
})

// re-anchored (plugcut-01 x lavastep-01, JIT 10-24): the look added before the placement asks the deadline again, so a late
// equip is stopped there too -- the mutant removes BOTH deadline checks (each anchor present and unique)
await t('MUTANT KILLED: no deadline check after the equip -> the late equip still places', async () => {
  await withMutants(REFLEX_PATH, [["    if (Date.now() > deadline) { row(q, 'stopped', 'budget spent at the equip'); return out(false, 'budget spent plugging') }   // Codex r2 P2\n", ''],
    ["      if (Date.now() > deadline) { row(q, 'stopped', 'budget spent at the look'); return out(false, 'budget spent plugging') }\n", '']], async m => {
    const b2 = botFor(ISOC)
    const equip = b2.equip
    b2.equip = async it => { await new Promise(r => setTimeout(r, 2000)); return equip(it) }
    await ramp(b2, { plug: true, budgetMs: 1500 }, m)
    assert.ok(b2.places.length > 0, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: no owner check after the settle -> the step loop digs under the drowning rescue', async () => {
  await withMutant(REFLEX_PATH, "if (placed > 0 && await settledClear()) return yieldTo() ? out(false, 'yielded') : out(true, `plugged ${placed} (${what})`)",
    "if (placed > 0 && await settledClear()) return out(true, `plugged ${placed} (${what})`)", async m => {
      const { cells } = afterCut(ISOC)
      let placedAt = null
      const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], ledge: true, onPlace: () => { placedAt = Date.now() } })
      await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS, yieldTo: () => (placedAt != null && Date.now() >= placedAt + 300 + 600 ? 'drowning' : null) }, m)
      assert.ok(bot.digs.length > 0 || bot.controls.some(c => c === 'forward:true'), 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: no PLUG_MAX cap -> a refilling face takes more than PLUG_MAX placements', async () => {
  await withMutant(REFLEX_PATH, "    if (placed >= PLUG_MAX) { row(null, 'stopped', `${placed} plugs and the cut is still wet`); return out(false, `the ${what} stayed wet after ${placed} plugs`) }\n",
    '', async m => {
      const bot = botFor(ISOC, { onPlace: (k, w) => { setTimeout(() => w.set(...k.split(',').map(Number), 'water[1]'), 400) } })
      await ramp(bot, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
      assert.ok(pcRows().filter(x => / for=ceiling /.test(x.detail) && / result=placed /.test(x.detail)).length > PC.PLUG_MAX, 'the mutant did not change behaviour')
    })
})

await t('MUTANT KILLED: the licence on the arm\'s counter again -> the first refusal in a new pit is licensed', async () => {
  await withMutant(REFLEX_PATH, 'const due = plugDue(plugSoFar(prevStreak, here, Date.now()))', 'const due = plugDue(refusals)', async m => {
    const seen = []
    const fake = async (_bot, o) => { seen.push(!!o.plug); return { steps: 0, climbed: 0, stopped: 'fake', flood: 'ramp_breach' } }
    const bot = botFor(ISOC)
    let refusals = 0
    for (let k = 0; k < 3; k++) refusals = (await m.floodBranch(bot, { handler: 'entombed', refusals, ramp: fake })).refusals
    bot.entity.position = new Vec3(40.5, 70.1, 40.5)
    await m.floodBranch(bot, { handler: 'marooned', refusals, ramp: fake })
    assert.strictEqual(seen[3], true, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: no utility-block sparing -> the licensed ramp digs the furnace', async () => {
  await withMutant(REFLEX_PATH, 'avoid: c => isUtilityBlock(at(...c)?.name) })', 'avoid: () => false })', async m => {
    const { cells } = afterCut(ISOC)
    cells['-1,1,1'] = 'cobblestone'; cells['-1,1,0'] = 'furnace'
    const lic = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], ledge: true })
    await ramp(lic, { plug: true, budgetMs: PC.PLUG_BUDGET_MS }, m)
    assert.ok(lic.digs.some(d => d.name === 'furnace'), 'the mutant did not change behaviour')
  })
})

// ================================================================================================================
// F. THE CEILESCAPE-01 VARIANT ONLY (this branch is plugcut-01 on ceilescape-01's c488c3e3)
// ================================================================================================================

const ceRows = []
tapRecords(r => { if ((r?.skill?.name ?? '') === '_ceilescape') ceRows.push(r.skill.detail) })
await t('VARIANT: a licensed firing prices its swings against its own 90 s (ceilescape fullMs = the firing budget); unlicensed, 60 s', async () => {
  ceRows.length = 0
  await ramp(botFor(ISOC, { items: DIRT_BAG() }), { plug: true, budgetMs: PC.PLUG_BUDGET_MS })
  const lic = ceRows.filter(d => /^where=ceiling /.test(d))
  assert.ok(lic.length >= 1, 'POSITIVE CONTROL: no ceiling decision was priced')
  for (const d of lic) assert.match(d, / full_ms=90000 /, d)
  ceRows.length = 0
  const { cells } = afterCut(ISOC)
  cells['0,2,0'] = 'dirt'; cells['0,2,-1'] = 'cobblestone'          // a dry ceiling the base ramp swings at
  await ramp(makeWorldBot(cells, { feetY: 0.1, items: DIRT_BAG(), ledge: true }), {})
  const base = ceRows.filter(d => /^where=ceiling /.test(d))
  assert.ok(base.length >= 1, 'POSITIVE CONTROL: the unlicensed ramp priced no ceiling')
  for (const d of base) assert.match(d, / full_ms=60000 /, d)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
