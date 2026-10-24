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

await t('THE STEP NEVER PLUGS OR CLICKS A CELL THE CLIMB USES: its only solid neighbour is the step cell -> no plan', () => {
  const { cells } = afterCut(ISOC)
  // the W step's wet face (-1,1,1): take away every solid neighbour but the W step cell (-1,1,0) itself
  Object.assign(cells, { '0,1,1': 'air', '-2,1,1': 'air', '-1,1,2': 'air', '-1,2,1': 'air', '-1,0,1': 'water[0]' })
  const r = PC.stepPlugPlan({ at: atOf(cells), bear: W, blocks: 64 })
  assert.strictEqual(r.ok, false, JSON.stringify(r.plugs))
  assert.match(r.reason, /no face to click for the plug at -1,1,1/)
  cells['-2,1,1'] = 'stone'
  assert.ok(PC.stepPlugPlan({ at: atOf(cells), bear: W, blocks: 64 }).ok, 'POSITIVE CONTROL: one free solid neighbour plans')
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
  assert.strictEqual(PC.plugCutModeDetail({}), 'on=1 after_refusals=3 max_plugs=3 rounds=3')
  assert.strictEqual(PC.plugCutModeDetail({ PLUGCUT: '0' }), 'on=0 after_refusals=3 max_plugs=3 rounds=3')
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
// THE SWIMMER: Paper's jump from water clears a one-block ledge (probe 2, 10-24: the plugged W step taken); this world's
// default 0.1/tick rise reaches the tread's top on the jump's last tick and falls back, so the swimmer rises 0.15/tick.
const botFor = (name, opts = {}) => {
  const s = scene(name)
  return makeWorldBot(s.cells, { feetY: s.feetY, items: [COBBLE(64)], rise: 0.15, onDig: popSapling, ...opts })
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
  const r = await ramp(bot, { plug: true })
  assert.deepStrictEqual(bot.places.filter(p => p.ok).map(p => p.cell), ['0,2,-1', '-1,1,1'])
  const dug = bot.digs.map(d => d.cell)
  assert.ok(dug.indexOf('0,2,0') >= 0 && dug.indexOf('-1,1,0') > dug.indexOf('0,2,0'), `digs: ${dug}`)
  assert.ok(!dug.includes('0,2,-1') && !dug.includes('-1,1,1'), 'a plug was dug back out')
  assert.strictEqual(r.plugged, 2)
  assert.ok(r.steps >= 1 && r.climbed >= 0.85, `${r.stopped} steps=${r.steps} climbed=${r.climbed}`)
  assert.ok(Math.floor(bot.entity.position.x) <= -1, `the bot did not go W: ${cellOf(bot)}`)
  const placed = pcRows().filter(x => / result=placed /.test(x.detail))
  assert.deepStrictEqual(placed.map(x => / for=(\S+) /.exec(x.detail)[1]), ['ceiling', 'step:-1,0'])
  for (const x of placed) assert.ok(x.detail.length <= 300)
})

await t('CANDIDATE on isolated-d: the ceiling\'s face, then the S step\'s three; the ceiling plug is the S headroom, cut only once dry', async () => {
  const DIRT = { name: 'dirt', count: 32, type: reg.itemsByName.dirt.id }
  const bot = botFor(ISOD, { items: [DIRT, COBBLE(64)] })
  let r = await ramp(bot, { plug: true })
  // THE RE-DIG IS DEAR (dirt from water, airborne: 18.75 s): when one firing's 60 s run out mid-dig, the next firing resumes
  // against a world that is already dry -- it places nothing more
  const firstPlaces = bot.places.filter(p => p.ok).length
  if (r.steps < 1) { r = await ramp(bot, { plug: true }); assert.strictEqual(bot.places.filter(p => p.ok).length, firstPlaces, 'the 2nd firing plugged again') }
  const ok = bot.places.filter(p => p.ok).map(p => p.cell)
  assert.strictEqual(ok[0], '0,2,1')
  assert.strictEqual(ok.length, 4, `${ok} -- ${r.stopped}`)
  // the S step digs its headroom (0,2,1) -- the ceiling's plug -- and the step cell (0,1,1); the step's own plugs all stay
  for (const c of ok.slice(1)) assert.notStrictEqual(bot.world.get(...c.split(',').map(Number)), 'air', `${c} was dug back out`)
  const redig = bot.digs.find(d => d.cell === '0,2,1')
  const lastPlug = Math.max(...bot.places.filter(p => p.ok).map(p => p.at))
  assert.ok(redig && redig.at >= lastPlug, 'the ceiling plug was re-dug before the S step\'s faces were plugged (or never)')
  assert.ok(r.steps >= 1, r.stopped)
})

await t('CANDIDATE on placebo-d: the ceiling is plugged and cut; the stop is no longer the wet ceiling', async () => {
  const bot = botFor(PLD)
  const r = await ramp(bot, { plug: true })
  assert.deepStrictEqual(bot.places.filter(p => p.ok).map(p => p.cell), ['0,2,-1'])
  assert.ok(bot.digs.some(d => d.cell === '0,2,0'), 'the ceiling was not cut')
  assert.notStrictEqual(r.flood, 'ramp_breach', r.stopped)
})

await t('A REJECTED PLACEMENT (the server says no, silently): read back as failed; the ceiling is never cut', async () => {
  const bot = botFor(ISOC, { placeFails: true })
  const r = await ramp(bot, { plug: true })
  assert.ok(bot.places.length >= 1, 'POSITIVE CONTROL: the rung never tried')
  assert.strictEqual(r.plugged, 0)
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'), 'cut without the plug')
  assert.strictEqual(r.flood, 'ramp_breach')
  assert.match(r.stopped, /plug: the plug did not take at 0,2,-1/)
  assert.ok(pcRows().some(x => / result=failed /.test(x.detail) && / plugged=0 /.test(x.detail)))
})

await t('A PLUG THAT WASHES OUT (the cell is water again after the place): failed, never cut', async () => {
  const bot = botFor(ISOC, { onPlace: (k, w) => { if (k === '0,2,-1') w.set(0, 2, -1, 'water[1]') } })
  const r = await ramp(bot, { plug: true })
  assert.strictEqual(r.plugged, 0)
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'))
})

await t('THE BOT MOVES DURING THE PLUGS: stopped, nothing placed from a shifted frame', async () => {
  let moved = false
  const bot = botFor(ISOC)
  const equip = bot.equip
  bot.equip = async (it) => { await equip(it); if (!moved) { moved = true; bot.entity.position = bot.entity.position.offset(0, -1, 0) } }
  const r = await ramp(bot, { plug: true })
  assert.ok(moved, 'POSITIVE CONTROL: the equip never ran')
  assert.deepStrictEqual(bot.places, [])
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'))
  assert.ok(pcRows().some(x => / result=stopped /.test(x.detail)), pcRows().map(x => x.detail).join(' | '))
  assert.strictEqual(r.plugged, 0)
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
  assert.match(ramp4.detail, / plugged=2 /)
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
  const r = await ramp(bot, { plug: true, yieldTo: () => (equippedAt >= 0 ? 'drowning' : null) })
  assert.ok(equippedAt >= 0, 'POSITIVE CONTROL: the rung never reached the equip')
  assert.strictEqual(r.yielded, 'drowning')
  assert.deepStrictEqual(bot.places, [])
  assert.ok(!bot.controls.slice(equippedAt).includes('clear'), 'the controls were wiped under the new owner')
})

await t('A BAG OF TOOLS AND TORCHES ONLY: no plug (never a tool, never a non-scaffold block); the base refusal stands', async () => {
  const items = [{ name: 'stone_pickaxe', count: 1, type: reg.itemsByName.stone_pickaxe.id }, { name: 'torch', count: 12, type: reg.itemsByName.torch.id }]
  const bot = botFor(ISOC, { items })
  const r = await ramp(bot, { plug: true })
  assert.deepStrictEqual(bot.places, [])
  assert.match(r.stopped, /plug: needs 1 block\(s\) to plug, holds 0/)
})

await t('LAVA BESIDE THE CEILING: never plugged, never cut (the rung adds no move near lava)', async () => {
  const s = scene(ISOC)
  s.cells['0,2,1'] = 'lava'
  const bot = makeWorldBot(s.cells, { feetY: s.feetY, items: [COBBLE(64)], rise: 0.15 })
  const r = await ramp(bot, { plug: true })
  assert.deepStrictEqual(bot.places, [])
  assert.deepStrictEqual(bot.digs, [])
  assert.match(r.stopped, /lava/)
})

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
      const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], rise: 0.15 })
      await ramp(bot, {}, m)
      assert.ok(bot.places.length > 0, 'the mutant did not change behaviour')
    })
  // POSITIVE CONTROL: the real module, same world, places nothing
  const { cells } = afterCut(ISOC)
  const bot = makeWorldBot(cells, { feetY: 0.1, items: [COBBLE(64)], rise: 0.15 })
  await ramp(bot, {})
  assert.deepStrictEqual(bot.places, [])
})

await t('MUTANT KILLED: no read-back of the placed cell -> a rejected placement is counted and the ceiling is cut', async () => {
  await withMutant(REFLEX_PATH, "if (!got || got.boundingBox !== 'block') {", 'if (false) {', async m => {
    const bot = botFor(ISOC, { placeFails: true })
    const r = await ramp(bot, { plug: true }, m)
    assert.ok(r.plugged > 0, 'the mutant did not change behaviour')
  })
})

await t('MUTANT KILLED: floodBranch licenses every firing -> the 1st firing places', async () => {
  await withMutant(REFLEX_PATH, 'const stair = await ramp(bot, { yieldTo, plug: plugDue(refusals) })',
    'const stair = await ramp(bot, { yieldTo, plug: true })', async m => {
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

await t('MUTANT KILLED: the licence one refusal late (>) -> the 4th firing does not plug', async () => {
  await withMutant(PC_PATH, 'Number(refusals) >= PLUG_AFTER_REFUSALS', 'Number(refusals) > PLUG_AFTER_REFUSALS', async m => {
    assert.strictEqual(m.plugDue(3, {}), false, 'the mutant did not change behaviour')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
