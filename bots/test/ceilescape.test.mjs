// CEILESCAPE-01: A RAMP SWING THAT CANNOT FINISH IS NEVER STARTED (docs/reports/ceilescape-01-design-2026-10-24.md).
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: decisions extracted and driven, never matched as text):
//   A. the pure decisions (ceilescape.mjs), with the numbers that matter: the registry's prices and a 60 s firing;
//   B. the REAL `escapeStairUp` on board-a-Comet's column copied from the region file (fixtures/ceilescape-*.json), in a
//      virtual clock at the production timings, against a body physics with NO ledge impulse (ceilescape-world.mjs):
//      the base positive control reproduces the fleet's own stop string, and the candidate leaves east;
//   C. the composition: the float hold steering against the sidestep, the drowning yield, a fire column, the existing
//      flood sidestep left as it was, and the chain over repeated firings;
//   D. the arms' wiring (structural, comments stripped, each assertion seen to fail by a mutant);
//   E. anchored mutants (present AND unique) for the decision lines.
import assert from 'node:assert'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR && !process.env.LOG_DIR.startsWith('/srv') ? process.env.LOG_DIR : path.join(os.tmpdir(), `ce-test-${process.pid}`)
mkdirSync(process.env.LOG_DIR, { recursive: true })
const { virtualClock, makeWorldBot, fixtureCells, blockOf, Vec3 } = await import('./ceilescape-world.mjs')
const CE = await import('../src/ceilescape.mjs')
const R = await import('../src/reflex.mjs')
const { floodSidestep } = await import('../src/scaffold.mjs')
const { tapRecords } = await import('../src/logger.mjs')

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve().then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) })

const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)
const CE_PATH = new URL('../src/ceilescape.mjs', import.meta.url)
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
  const out = new URL(`./_mutant-ce-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const withMutant = (file, old, neu, fn) => withMutants(file, [[old, neu]], fn)

const rows = []
tapRecords(r => { const k = r?.skill?.name ?? ''; if (/^_(ceilescape|needs_rescue)/.test(k)) rows.push({ kind: k, ...r.skill }) })
const ceRows = () => rows.filter(r => r.kind === '_ceilescape')

/** Run one ramp in virtual time. `env` sets CEILESCAPE for the run only. */
async function ramp (bot, { mod = R, off = false, opts = {} } = {}) {
  const prev = process.env.CEILESCAPE
  if (off) process.env.CEILESCAPE = '0'; else delete process.env.CEILESCAPE
  rows.length = 0
  const clock = virtualClock().install()
  const t0 = Date.now()
  bot.start()
  try {
    const r = await clock.run(() => mod.escapeStairUp(bot, opts))
    return { ...r, virtualMs: Date.now() - t0 }
  } finally {
    bot.stop(); clock.uninstall()
    if (prev === undefined) delete process.env.CEILESCAPE; else process.env.CEILESCAPE = prev
  }
}
const COMET = () => fixtureCells('board-a-comet')
const BRAVO = () => fixtureCells('placebo-c-bravo')
const cellOf = bot => { const p = bot.entity.position; return `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` }
const E = { x: 1, z: 0 }, S = { x: 0, z: 1 }, N = { x: 0, z: -1 }, W = { x: -1, z: 0 }
/** A pure `at` over fixture cells, relative to an origin. */
const atOf = (cells, o = [0, 0, 0]) => (x, y, z) => { const k = `${o[0] + x},${o[1] + y},${o[2] + z}`; return blockOf(k in cells ? cells[k] : 'stone', new Vec3(o[0] + x, o[1] + y, o[2] + z)) }

// ================================================================================================================
// A. THE PURE DECISIONS
// ================================================================================================================

await t('the cost constants are the reflex\'s own settles (a duplicated number must not drift)', () => {
  assert.strictEqual(CE.CE_FLOW_SETTLE_MS, R.FLOW_SETTLE_MS)
  assert.strictEqual(CE.CE_FALLING_SETTLE_MS, R.FALLING_SETTLE_MS)
})

await t('swingFits: unknown is "try it"; a known price fits only inside the time left', () => {
  assert.strictEqual(CE.swingFits(null, 10), true)
  assert.strictEqual(CE.swingFits(Infinity, 10), true, 'Infinity is not a finite price: planDig/canBreak own that refusal')
  assert.strictEqual(CE.swingFits(375_000, 60_000), false)
  assert.strictEqual(CE.swingFits(60_000, 60_000), true)
})

const E_CAND = { bear: E, digMs: [15_000, 18_750], newCeilMs: 0, wet: false }   // Comet's east: ladder + dirt at both penalties
await t('sidestepCostMs: Comet\'s east is 33.75 s of digs plus the settles and the move; unknown is null', () => {
  assert.strictEqual(CE.sidestepCostMs(E_CAND), 33_750 + 2 * (250 + 300) + 500 + 4500)
  assert.strictEqual(CE.sidestepCostMs({ digMs: [null] }), null)
  assert.strictEqual(CE.sidestepCostMs({ digMs: [], newCeilMs: 15_000 }), 4500 + 15_000 + 250 + 300 + 500, 'the new ceiling pays its own settles')
})

await t('THE UNCHANGED CASE: a ceiling that fits the time left, or cannot be priced, is today\'s swing', () => {
  assert.deepStrictEqual(CE.ceilingEscapeDecision({ ceilingMs: 15_000, leftMs: 60_000, candidates: [E_CAND] }), { action: 'ceiling' })
  assert.deepStrictEqual(CE.ceilingEscapeDecision({ ceilingMs: null, leftMs: 1, candidates: [E_CAND] }), { action: 'ceiling' })
  assert.deepStrictEqual(CE.ceilingEscapeDecision({ ceilingMs: 60_000, leftMs: 60_000 }), { action: 'ceiling' }, 'no reserve on this comparison')
})

await t('COMET: copper at 375 s against 59 s -> the east sidestep', () => {
  const d = CE.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 59_000, candidates: [E_CAND] })
  assert.strictEqual(d.action, 'lateral'); assert.deepStrictEqual(d.bear, E)
})

await t('RANKED BY THE FULL COST: a geometrically-first bearing whose NEW CEILING is copper loses to a later dirt one', () => {
  const first = { bear: S, digMs: [3_750], newCeilMs: 75_000 / 5, wet: false }   // cheap cells, copper above (15 s grounded)
  const late = { bear: E, digMs: [18_750], newCeilMs: 0, wet: false }
  const d = CE.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 59_000, candidates: [first, late] })
  assert.ok(CE.sidestepCostMs(first) < 59_000 - 3000, 'POSITIVE CONTROL: the first bearing alone would fit')
  assert.deepStrictEqual(d.bear, E, JSON.stringify(d.ranked?.map(c => [CE.dirName(c.bear), c.costMs])))
})

await t('ties go dry-first, then facing order', () => {
  const wet = { bear: N, digMs: [1000], newCeilMs: 0, wet: true }, dry = { bear: W, digMs: [1000], newCeilMs: 0, wet: false }
  assert.deepStrictEqual(CE.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 59_000, candidates: [wet, dry] }).bear, W)
  const d1 = { ...dry, bear: S }
  assert.deepStrictEqual(CE.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 59_000, candidates: [d1, dry] }).bear, S)
})

await t('an unknown candidate price is never affordable', () => {
  const d = CE.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 59_000, candidates: [{ bear: E, digMs: [null], newCeilMs: 0 }] })
  assert.strictEqual(d.action, 'escalate')
})

await t('WAIT, NOT ESCALATE, when a FULL firing would fit (time spent is not a dead end; Claude r1 P1-3)', () => {
  const ceil = CE.ceilingEscapeDecision({ ceilingMs: 37_500, leftMs: 20_000, fullMs: 60_000, candidates: [] })
  assert.strictEqual(ceil.action, 'wait', ceil.reason)
  const side = CE.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 20_000, fullMs: 60_000, candidates: [E_CAND] })
  assert.strictEqual(side.action, 'wait', 'the east sidestep fits a fresh firing')
  const after = CE.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 50_000, fullMs: 60_000, candidates: [E_CAND], moved: true })
  assert.strictEqual(after.action, 'wait', 'never a second sidestep, and never an escalation for a bot that just moved')
})

await t('ESCALATE only when nothing fits even a full firing, with the reason worded for a human', () => {
  const d = CE.ceilingEscapeDecision({ ceilingMs: 187_500, leftMs: 59_000, fullMs: 60_000, candidates: [],
                                       refusals: [{ bear: N, reason: 'no dry floor to step onto (water)' }], block: 'stone' })
  assert.strictEqual(d.action, 'escalate')
  assert.match(d.reason, /no affordable ramp exit: stone 187\.5s against 59\.0s left; no side column, and nothing fits a fresh firing \(55\.0s\) \(N: no dry floor/)
})

await t('firstSwingEscalation: the chooser\'s bearing decides; a free step is a move; others are named, not counted', () => {
  const all = CE.firstSwingEscalation({ chosen: { bear: N, priceMs: 187_500 }, others: [{ bear: E, priceMs: 187_500 }], leftMs: 55_000, block: 'stone' })
  assert.strictEqual(all.escalate, true, all.reason)
  const one = CE.firstSwingEscalation({ chosen: { bear: N, priceMs: 187_500 }, others: [{ bear: E, priceMs: 37_500 }], leftMs: 30_000 })
  assert.strictEqual(one.escalate, true, 'the loop picks the same bearing again (Codex r2 P2-5)')
  assert.match(one.reason, /E could start but is not the chooser's/)
  const free = CE.firstSwingEscalation({ chosen: { bear: N, priceMs: 187_500 }, others: [{ bear: E, priceMs: 0 }], leftMs: 30_000 })
  assert.strictEqual(free.escalate, false, 'a step that needs no swing is a move (Claude r2 P2-2)')
  const self = CE.firstSwingEscalation({ chosen: { bear: N, priceMs: 45_000 }, others: [], leftMs: 30_000 })
  assert.strictEqual(self.escalate, false, 'the chosen swing itself fits a fresh firing')
  const edge = CE.firstSwingEscalation({ chosen: { bear: N, priceMs: 57_000 }, others: [], leftMs: 30_000 })
  assert.strictEqual(edge.escalate, true, 'a swing that fits 60 s but not 60 s after its settle never fits (Claude r2 P3-1)')
})

await t('envSettled: two agreeing samples a second apart, or five seconds', () => {
  assert.deepStrictEqual(CE.envSettled([{ t: 0, onGround: false, inWater: true }]), { done: false, stable: false })
  assert.strictEqual(CE.envSettled([{ t: 0, onGround: false, inWater: true }, { t: 1000, onGround: false, inWater: true }]).stable, true)
  assert.strictEqual(CE.envSettled([{ t: 0, onGround: false }, { t: 1000, onGround: true }]).done, false)
  assert.strictEqual(CE.envSettled([{ t: 0, onGround: false }, { t: 1000, onGround: true }, { t: 5000, onGround: false }]).done, true)
})

await t('rescueRowDue: once per cell per 30 min, per cell (a bot alternating two cells is not reset by each change)', () => {
  const seen = new Map(), a = { x: 1, y: 2, z: 3 }, b = { x: 1, y: 0, z: 3 }
  assert.strictEqual(CE.rescueRowDue(seen, a, 0), true)
  assert.strictEqual(CE.rescueRowDue(seen, b, 1000), true)
  assert.strictEqual(CE.rescueRowDue(seen, a, 2000), false, 'back to the first cell inside 30 min')
  assert.strictEqual(CE.rescueRowDue(seen, b, 29 * 60_000), false)
  assert.strictEqual(CE.rescueRowDue(seen, a, 30 * 60_000), true)
  for (let i = 0; i < 20; i++) CE.rescueRowDue(seen, { x: i, y: 9, z: 9 }, 31 * 60_000)
  assert.ok(seen.size <= 8, 'bounded')
})

await t('cellFloods, vanilla\'s spread rule cell by cell', () => {
  const at = cells => (x, y, z) => { const k = `${x},${y},${z}`; return blockOf(k in cells ? cells[k] : 'stone', new Vec3(x, y, z)) }
  assert.strictEqual(CE.cellFloods(at({ '0,0,0': 'air', '0,1,0': 'air' })), null, 'POSITIVE CONTROL: dry stone all round')
  assert.match(String(CE.cellFloods(at({ '0,1,0': 'water[3]' }))), /above/)
  assert.match(String(CE.cellFloods(at({ '1,0,0': 'water[0]' }))), /source/)
  assert.match(String(CE.cellFloods(at({ '1,0,0': 'water[8]', '1,-1,0': 'stone' }))), /spreads in/, 'falling water resting on stone spreads')
  assert.strictEqual(CE.cellFloods(at({ '1,0,0': 'water[8]', '1,-1,0': 'water[8]' })), null, 'falling water over water flows down')
  assert.strictEqual(CE.cellFloods(at({ '1,0,0': 'water[2]', '1,-1,0': 'water[8]' })), null, "Comet's own head water")
  assert.match(String(CE.cellFloods(at({ '1,0,0': 'water[3]', '1,-1,0': 'air' }))), /spreads in/, 'only water over WATER is exempt (conservative, Codex r2 P1-3)')
  assert.match(String(CE.cellFloods(at({ '1,0,0': 'water[3]', '1,-1,0': 'oak_stairs[wl]' }))), /spreads in/, 'a waterlogged block below takes no flow (Claude r2 P3-4)')
  assert.match(String(CE.cellFloods(at({ '1,0,0': 'water[2]', '1,-1,0': 'water[8]', '2,0,0': 'water[0]' }))), /source beside it/, 'a source beside the neighbour')
  assert.strictEqual(CE.cellFloods(at({ '1,0,0': 'water[7]', '1,-1,0': 'stone' })), null, 'level 7 spreads nowhere')
  assert.match(String(CE.cellFloods(at({ '1,0,0': 'oak_stairs[wl]' }))), /source/, 'a waterlogged block holds a source')
  assert.match(String(CE.cellFloods((x, y, z) => (x === 0 && y === 1 ? null : blockOf('stone', new Vec3(x, y, z))))), /not loaded/)
})

await t('cellFloods ON THE LIVE COLUMN: Comet\'s east head cell stays dry, its west head cell floods', () => {
  const c = COMET()
  assert.strictEqual(CE.cellFloods(atOf(c, [1, 1, 0])), null)
  assert.match(String(CE.cellFloods(atOf(c, [-1, 1, 0]))), /spreads in \(level 8 over stone\)/)
})

await t('floodSidestep `wetFeet`: feet water only with it; the head must still breathe; default unchanged', () => {
  const base = { '1,-1,0': 'stone', '1,0,0': 'water[1]', '1,1,0': 'air', '1,2,0': 'air' }
  assert.match(floodSidestep({ at: atOf(base), bear: E, submerged: true }).reason, /water in the feet cell/, 'the default is today\'s')
  assert.deepStrictEqual(floodSidestep({ at: atOf(base), bear: E, submerged: true, wetFeet: true }), { ok: true, dig: [] })
  assert.match(floodSidestep({ at: atOf({ ...base, '1,1,0': 'water[1]' }), bear: E, submerged: true, wetFeet: true }).reason, /head cell would be wet/)
  assert.match(floodSidestep({ at: atOf({ ...base, '1,1,0': 'oak_stairs[wl]' }), bear: E, submerged: true, wetFeet: true }).reason, /head cell would be wet/)
})

// ================================================================================================================
// B. THE REAL escapeStairUp ON COMET'S COLUMN (virtual clock, production timings, no ledge impulse)
// ================================================================================================================

await t('BASE POSITIVE CONTROL (CEILESCAPE=0): one copper swing for the whole firing, the fleet\'s own stop string', async () => {
  const bot = makeWorldBot(COMET())
  const r = await ramp(bot, { off: true })
  assert.strictEqual(r.stopped, 'ceiling dig failed on copper_ore: dig exceeded 60000ms')
  assert.deepStrictEqual(bot.digs.map(d => [d.cell, d.name, d.waitMs, !!d.aborted]), [['0,2,0', 'copper_ore', 375_000, true]])
  assert.strictEqual(r.ceil, null, 'the rollback leaves no decision on the result')
  const row = ceRows()[0]
  assert.ok(row && / action=off /.test(row.detail) && /env_ms=375000/.test(row.detail), `the observe row says what it WOULD do: ${row?.detail}`)
  assert.match(row.detail, /cands=E:/, 'the rollback still prices the east exit')
})

await t('CANDIDATE: digs the ladder and the dirt, never the copper, and steps east with its head dry', async () => {
  const bot = makeWorldBot(COMET())
  const r = await ramp(bot)
  assert.deepStrictEqual(bot.digs.map(d => [d.cell, d.name]), [['1,1,0', 'ladder'], ['1,0,0', 'dirt']])
  assert.ok(!bot.digs.some(d => d.name === 'copper_ore'), 'it swung at the copper')
  assert.strictEqual(r.sidestepped, 1, r.stopped)
  assert.strictEqual(r.ceil?.moved, true)
  assert.strictEqual(R.rampStatus(r), 'success')
  assert.strictEqual(cellOf(bot), '1,0,0')
  assert.ok(!/water/.test(bot.world.get(1, 1, 0)), 'the head cell is dry')
  const lat = ceRows().find(x => / action=lateral /.test(x.detail))
  assert.ok(lat, `no lateral row: ${ceRows().map(x => x.detail).join(' | ')}`)
  assert.ok(r.fire && ceRows().every(x => x.detail.includes(` fire=${r.fire} `)), 'every decision row names the firing the result returns (the read pairs ramp_cut rows by it)')
  assert.ok(r.virtualMs < 60_000)
})

await t('WATER FLOWS INTO THE DUG FEET CELL before the first recheck: still steps (wet feet, dry head)', async () => {
  const bot = makeWorldBot(COMET(), { onDig: (k, w) => { if (k === '1,0,0') w.set(1, 0, 0, 'water[1]') } })
  const r = await ramp(bot)
  assert.strictEqual(r.sidestepped, 1, r.stopped)
  assert.strictEqual(cellOf(bot).split(',').slice(0, 3).filter((v, i) => i !== 1).join(','), '1,0')
})

await t('WATER INTO THE HEAD CELL before the recheck: refused, no step, and still no copper swing', async () => {
  const bot = makeWorldBot(COMET(), { onDig: (k, w) => { if (k === '1,0,0') w.set(1, 1, 0, 'water[1]') } })
  const r = await ramp(bot)
  assert.strictEqual(r.sidestepped, 0)
  assert.match(String(r.stopped), /side cell changed before the step: the head cell would be wet/)
  assert.strictEqual(cellOf(bot), '0,0,0')
  assert.ok(!bot.digs.some(d => d.name === 'copper_ore'))
})

/** A SLOW SWIMMER that sinks a full cell on the LAST dig (Claude code r1 P1): the falling settles cannot restore its height,
 *  so the frame's sank-one branch and the swim-up wait really run. `firstForwardY` is the body's height at the first stroke. */
const sinker = () => {
  const s = { firstForwardY: null }
  s.bot = makeWorldBot(COMET(), {
    rise: 0.015,
    onDig: (k, w, b) => { if (k === '1,0,0') { const p = b.entity.position; b.entity.position = new Vec3(p.x, -1.0, p.z) } },
    onTick: (w, b) => { if (s.firstForwardY === null && b.ctl.forward) s.firstForwardY = b.entity.position.y },
  })
  return s
}
await t('SINKING DURING THE LAST DIG (one cell): the frame stands, the bot swims up BEFORE the stroke, then enters', async () => {
  const s = sinker()
  const r = await ramp(s.bot)
  assert.ok(s.firstForwardY !== null && s.firstForwardY < -0.1, `POSITIVE CONTROL: the body was still sunk when the stroke began (${s.firstForwardY}): the swim-up ran to its cap`)
  assert.strictEqual(r.sidestepped, 1, r.stopped)
  assert.strictEqual(cellOf(s.bot), '1,0,0')
})
await t('MUTANT KILLED: no swim-up -> the sunk slow swimmer never enters the target', async () => {
  await withMutant(REFLEX_PATH, '        while (bot.entity.position.y < top && Date.now() < until) {', '        while (false) {', async mod => {
    const s = sinker()
    const r = await ramp(s.bot, { mod })
    assert.strictEqual(r.sidestepped, 0, `the mutant still arrived: ${r.stopped}`)
  })
})

await t('DISPLACED during the digs: re-planned from where the body is, at most once, never dug from a shifted frame', async () => {
  let moved = false
  const bot = makeWorldBot(COMET(), { onDig: (k, w, b) => { if (k === '1,1,0' && !moved) { moved = true; b.entity.position = new Vec3(0.5, 0.2, -0.5) } } })
  const r = await ramp(bot)
  const plans = ceRows().filter(x => /^where=ceiling /.test(x.detail))
  assert.ok(plans.length >= 2, `the breach was not planned again: ${plans.map(x => x.detail).join(' | ')}`)
  assert.notStrictEqual(/ at=(\S+)/.exec(plans[1].detail)[1], /at=(\S+)/.exec(plans[0].detail)[1], 'the second plan is from where the body is')
  assert.ok(!bot.digs.some(d => d.cell === '1,0,-1'), 'an offset of the old frame was applied to the new origin')
  assert.ok(!bot.digs.some(d => d.name === 'copper_ore'), r.stopped)
})

await t('A DECOY FIRST IN FACING ORDER (dearer dirt to the south): the cheaper east is taken', async () => {
  const cells = { ...COMET(), '0,-1,1': 'stone', '0,0,1': 'dirt', '0,1,1': 'dirt', '0,2,1': 'air', '-1,1,1': 'stone' }
  const bot = makeWorldBot(cells)
  bot.entity.yaw = Math.PI          // escapeBearings(pi) = S, E, W, N
  const r = await ramp(bot)
  const row = ceRows().find(x => / action=lateral /.test(x.detail))
  assert.match(String(row?.detail), /cands=E:\d+,S:\d+/, 'both priced, east cheapest first')
  assert.strictEqual(cellOf(bot), '1,0,0', r.stopped)
})

await t('LAVA beside the east feet cell: refused at the plan, nothing dug, escalated', async () => {
  const bot = makeWorldBot({ ...COMET(), '2,0,0': 'lava' })
  const r = await ramp(bot)
  assert.deepStrictEqual(bot.digs, [])
  assert.strictEqual(r.ceil?.action, 'escalate', r.stopped)
  assert.match(String(r.stopped), /no affordable ramp exit: copper_ore 375\.0s/)
})

await t('A SOURCE BESIDE THE EAST HEAD CELL: cellFloods refuses it (the flood check exempts a submerged bot)', async () => {
  const bot = makeWorldBot({ ...COMET(), '1,1,1': 'water[0]' })
  const r = await ramp(bot)
  assert.deepStrictEqual(bot.digs, [], r.stopped)
  assert.match(String(r.stopped), /E: a water source beside the head cell/)
})

await t('A LIVE FIRE COLUMN over the east cell: the destination is vetoed (keepout), nothing dug', async () => {
  const bot = makeWorldBot(COMET())
  bot.fireSitesNow = () => [{ kind: 'death:fire', x: 5, y: -2, z: 0 }]
  const r = await ramp(bot)
  assert.deepStrictEqual(bot.digs, [], r.stopped)
  assert.match(String(r.stopped), /E: a live fire column/)
})

await t('placebo-c-BRAVO, ENTOMBED (y 37.2): escalated with no swing at all', async () => {
  const bot = makeWorldBot(BRAVO(), { feetY: 2.2 })
  const r = await ramp(bot)
  assert.deepStrictEqual(bot.digs, [], r.stopped)
  assert.strictEqual(r.ceil?.action, 'escalate', r.stopped)
  assert.match(String(r.stopped), /stone 187\.5s/)
  assert.ok(r.virtualMs <= 6000, `an escalated firing must be cheap: ${r.virtualMs} ms`)
})

await t('placebo-c-BRAVO, MAROONED (y 35.4): the first step swing is priced and escalated, nothing swung', async () => {
  const bot = makeWorldBot(BRAVO(), { feetY: 0.4 })
  const r = await ramp(bot)
  assert.deepStrictEqual(bot.digs, [], r.stopped)
  assert.strictEqual(r.ceil?.where, 'step', 'the step admission must have run (Claude code r1 P2-4)')
  assert.strictEqual(r.ceil?.action, 'escalate', r.stopped)
  assert.ok(ceRows().some(x => /^where=step /.test(x.detail) && / action=escalate /.test(x.detail)), 'the step decision row')
  assert.match(String(r.stopped), /no affordable first swing: stone [NESW] 187\.5s/)
})

const TOMB = (block) => { const c = { '0,0,0': 'air', '0,1,0': 'air' }; for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = -2; y <= 4; y++) if (!c[`${x},${y},${z}`]) c[`${x},${y},${z}`] = block; return c }

await t('A DRY AIRBORNE BOT (a jump): settles, reprices grounded, and digs -- a transient price decides nothing', async () => {
  const bot = makeWorldBot(TOMB('deepslate'), { feetY: 0.5 })
  const r = await ramp(bot, { opts: { maxSteps: 0 } })
  assert.strictEqual(bot.digs[0]?.cell, '0,2,0', r.stopped)
  assert.strictEqual(bot.digs[0]?.waitMs, 15_000, 'priced grounded after the landing')
  const row = ceRows()[0]
  assert.match(String(row?.detail), /first_ms=75000 env_ms=15000/)
  assert.doesNotMatch(String(row?.detail), /settled=-/)
})

await t('AN AFFORDABLE CEILING: the same digs as the rollback, and no settle', async () => {
  const on = makeWorldBot(TOMB('stone'), { feetY: 0 }), off = makeWorldBot(TOMB('stone'), { feetY: 0 })
  on.entity.onGround = true; off.entity.onGround = true
  const a = await ramp(on, { opts: { maxSteps: 2 } }), b = await ramp(off, { off: true, opts: { maxSteps: 2 } })
  assert.deepStrictEqual(on.digs.map(d => [d.cell, d.name]), off.digs.map(d => [d.cell, d.name]))
  assert.ok(on.digs.length > 0, 'POSITIVE CONTROL: it dug')
  assert.strictEqual(a.ceil, null); assert.strictEqual(a.stopped, b.stopped)
})

await t('A HELD TOOL (emptyHand kept it): the swing is priced with the tool', async () => {
  const pick = { name: 'wooden_pickaxe', type: (await import('./ceilescape-world.mjs')).reg.itemsByName.wooden_pickaxe.id, count: 1 }
  const bot = makeWorldBot(COMET(), { held: pick, stuckHand: true, items: [pick] })
  await ramp(bot)
  assert.match(String(ceRows()[0]?.detail), /held=wooden_pickaxe .*env_ms=187500/)
})

await t('A DROWNING YIELD mid-sidestep: the body is given up at once and its controls are left alone', async () => {
  let bot = null
  bot = makeWorldBot(COMET())
  const yieldTo = () => (bot.digs[0]?.done ? 'the drowning rescue' : null)
  const r = await ramp(bot, { opts: { yieldTo } })
  assert.strictEqual(r.yielded, 'the drowning rescue')
  assert.strictEqual(bot.digs.length, 1, 'it dug on after the yield')
  const i = bot.controls.lastIndexOf('jump:true')
  assert.ok(!bot.controls.slice(i).includes('clear') && !bot.controls.slice(i).includes('jump:false'), `the new owner's stroke was wiped: ${bot.controls.slice(i)}`)
})

// ================================================================================================================
// C. COMPOSITION
// ================================================================================================================

/** The reflex tick's float hold, as it behaves for Comet (no_air_route) -- unless the body is owned -- plus a surface_out
 *  steer, which turns the bot north toward an air target. EVERY TICK: a stress model (the real hold runs every 500 ms, so a hold that fights every tick can only be harsher). */
const floatHold = (owned) => {
  let n = 0
  return (w, bot) => { if (++n % 1 === 0 && !owned()) { bot.ctl.forward = false; bot.ctl.jump = true; bot.entity.yaw = 0 } }
}
await t('THE FLOAT HOLD stands aside while the sidestep steers (steering wired): the bot lands east', async () => {
  let owned = false
  const bot = makeWorldBot(COMET(), { onTick: floatHold(() => owned) })
  const r = await ramp(bot, { opts: { steering: v => { owned = v } } })
  assert.strictEqual(cellOf(bot), '1,0,0', r.stopped)
  assert.strictEqual(owned, false, 'the flag was not put down')
})
await t('POSITIVE CONTROL: with no steering flag the hold turns the body and the step fails', async () => {
  const bot = makeWorldBot(COMET(), { onTick: floatHold(() => false) })
  const r = await ramp(bot)
  assert.notStrictEqual(cellOf(bot), '1,0,0', 'the hold model could not have seen the defect')
  assert.match(String(r.stopped), /could not step into the side cell/)
})

await t('THE EXISTING FLOOD SIDESTEP is unchanged: a dry bot\'s side cell that fills is still refused', async () => {
  // climbflood scene A: a wet pocket over the ceiling, the bot dry. The side feet cell floods after its dig.
  const c = TOMB('stone')
  for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (const y of [3, 4]) c[`${x},${y},${z}`] = 'water[0]'
  c['-1,0,0'] = 'stone'; c['-1,1,0'] = 'stone'
  const bot = makeWorldBot(c, { feetY: 0, onDig: (k, w) => { if (k === '-1,0,0') w.set(-1, 0, 0, 'water[1]') } })
  bot.entity.onGround = true
  bot.entity.yaw = Math.PI / 2      // W first
  const r = await ramp(bot)
  assert.strictEqual(r.sidestepped, 0, r.stopped)
  assert.ok(r.flood, 'POSITIVE CONTROL: the flood path ran')
  assert.strictEqual(r.ceil, null, 'the ceiling escape never ran on the flood path')
})

await t('THE CHAIN over repeated firings: Comet leaves on the first ramp and its next firing never prices the copper', async () => {
  const bot = makeWorldBot(COMET())
  const esc = R.refusalEscalation({ refusals: 4, streak: 4 })
  assert.ok(esc.due && esc.ramp, 'POSITIVE CONTROL: the 4th refusal in one hole buys the ramp')
  const first = await ramp(bot)
  assert.strictEqual(R.rampStatus(first), 'success')
  const second = await ramp(bot)
  assert.ok(!bot.digs.some(d => d.name === 'copper_ore'), second.stopped)
  assert.notStrictEqual(second.ceil?.action, 'escalate')
})
await t('THE CHAIN for Bravo: every firing escalates without a swing, and the prerequisite the arm writes is unchanged', async () => {
  const bot = makeWorldBot(BRAVO(), { feetY: 2.2 })
  for (let i = 0; i < 3; i++) {
    const r = await ramp(bot)
    assert.strictEqual(r.ceil?.action, 'escalate', `firing ${i}: ${r.stopped}`)
    assert.strictEqual(R.rampStatus(r), 'failed')
  }
  assert.deepStrictEqual(bot.digs, [])
  assert.deepStrictEqual(R.climbPrereqFor('needs_blocks').items.length > 0, true, 'the ask the arm still makes')
})

// ================================================================================================================
// D. WIRING (structural: behaviour cannot reach the arms' tick-gated branches; comments stripped; each seen to fail)
// ================================================================================================================

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l.replace(/(^|\s)\/\/.*$/, '$1'))).join('\n')
function assertWired (code) {
  const guard = code.indexOf('if (stair && stair.steps > 0) {')
  const moved = code.indexOf('} else if (stair?.ceil?.moved) {', guard)
  const plainElse = code.indexOf('} else {', moved)
  assert.ok(guard > 0 && moved > guard && plainElse > moved, 'the lateral-exit progress arm is not between the step guard and the no-progress arm')
  assert.match(code.slice(moved, plainElse), /climbRefusals = 0/, 'a lateral exit does not reset the escalation')
  const flood = code.indexOf("else if (climbOutcomeRoute(climbed) === 'flood')", plainElse)
  const noProgress = code.slice(plainElse, flood)
  assert.match(noProgress, /if \(stair\?\.ceil\?\.action === 'escalate'\) noteRescue\('entombed', stair\)/, 'the entombed escalation is not flagged')
  assert.match(noProgress, /bot\.pendingPrereq = \{ \.\.\.want,/, 'the prerequisite must still be written (both reviews r1)')
  const mar = code.indexOf("logEvent({ kind: 'marooned_ramp_cut',")
  assert.ok(mar > 0 && /if \(ramp\.ceil\?\.action === 'escalate'\) noteRescue\('marooned', ramp\)/.test(code.slice(mar, mar + 900)), 'the marooned escalation is not flagged')
  assert.match(code, /const ramp = await escapeStairUp\(bot, \{ yieldTo: [^\n]*, steering: steerRamp \}\)/, 'the marooned ramp cannot tell the hold')
  assert.match(code, /const stair = esc\.ramp \? await escapeStairUp\(bot, \{ yieldTo: [^\n]*, steering: steerRamp \}\)/, 'the entombed ramp cannot tell the hold')
  assert.match(code, /owned: rescuing \|\| rampSteering,/, 'the float hold does not stand aside')
  assert.match(code, /handler: 'marooned', refusals: floodRefusals,\s+yieldTo: [^\n]*, steering: steerRamp \}\)/, 'the marooned flood branch cannot tell the hold')
  assert.match(code, /handler: 'entombed', refusals: floodRefusals,\s+yieldTo: [^\n]*, steering: steerRamp \}\)/, 'the entombed flood branch cannot tell the hold')
  assert.match(code, /const stair = await ramp\(bot, \{ yieldTo, steering \}\)/, 'floodBranch drops the steering flag')
  assert.match(code, /climbed=\$\{stair\.climbed\.toFixed\(1\)\} fire=\$\{stair\.fire \?\? '-'\} — stopped because/, 'the entombed ramp_cut row does not name its firing')
  assert.match(code, /climbed=\$\{ramp\.climbed\.toFixed\(1\)\} fire=\$\{ramp\.fire \?\? '-'\} — stopped because/, 'the marooned ramp_cut row does not name its firing')
}
await t('WIRED: progress on a lateral exit, the flag on escalation, the prerequisite kept, the hold told', () => {
  assertWired(strip(readFileSync(REFLEX_PATH, 'utf8')))
})
await t('WIRED: the licence row is written once per spawn', () => {
  const code = strip(readFileSync(INDEX_PATH, 'utf8'))
  assert.match(code, /logEvent\(\{ kind: 'ceilescape_mode', status: 'success', snapshot: snapshot\(bot\), detail: ceilEscapeModeDetail\(\) \}\)/)
  assert.match(CE.ceilEscapeModeDetail({ CEILESCAPE: '0' }), /^on=0 /)
  assert.match(CE.ceilEscapeModeDetail({}), /^on=1 /)
})
for (const [name, old, neu] of [
  ['the flag removed from the entombed arm', "                if (stair?.ceil?.action === 'escalate') noteRescue('entombed', stair)", ''],
  ['the hold not told', '        owned: rescuing || rampSteering,', '        owned: rescuing,'],
  ['the lateral progress arm removed', "              } else if (stair?.ceil?.moved) {", '              } else if (false) {'],
]) {
  await t(`MUTANT KILLED (wiring): ${name}`, () => {
    const src = readFileSync(REFLEX_PATH, 'utf8')
    assert.ok(src.includes(old) && src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${old}`)
    assert.throws(() => assertWired(strip(src.replace(old, neu))), /./)
  })
}

// ================================================================================================================
// E. MUTANTS OF THE DECISION LINES (each must turn a named case red)
// ================================================================================================================

await t('MUTANT KILLED: no affordability branch -> the copper is swung again', async () => {
  await withMutant(REFLEX_PATH, '      const ce = await ceilingAdmission(b, p, at)', "      const ce = 'dig'", async mod => {
    const bot = makeWorldBot(COMET())
    const r = await ramp(bot, { mod })
    assert.ok(bot.digs.some(d => d.name === 'copper_ore'), 'the mutant did not swing')
    assert.match(String(r.stopped), /dig exceeded/)
  })
})
await t('MUTANT KILLED: escalate on the time left (no full-budget rule)', async () => {
  await withMutant(CE_PATH, '  if (swingFits(ceilingMs, fresh) || ranked.some(c => fitsIn(c, fresh))) {', '  if (false) {', async mod => {
    assert.strictEqual(mod.ceilingEscapeDecision({ ceilingMs: 37_500, leftMs: 20_000, fullMs: 60_000 }).action, 'escalate')
  })
})
await t('MUTANT KILLED: ranking by geometry only', async () => {
  await withMutant(CE_PATH, '    .sort((a, b) => (a.costMs ?? Infinity) - (b.costMs ?? Infinity) || (a.wet ? 1 : 0) - (b.wet ? 1 : 0) || a.i - b.i)', '    .sort((a, b) => a.i - b.i)', async mod => {
    const d = mod.ceilingEscapeDecision({ ceilingMs: 375_000, leftMs: 59_000, candidates: [{ bear: S, digMs: [3750], newCeilMs: 15_000 }, { bear: E, digMs: [18_750], newCeilMs: 0 }] })
    assert.deepStrictEqual(d.bear, S)
  })
})
await t('MUTANT KILLED: no wet feet at the recheck -> dig, then refuse', async () => {
  await withMutant(REFLEX_PATH, "      const again = floodSidestep({ at: (dx, dy, dz) => bot.blockAt(p.offset(dx, dy, dz)), bear: side.bear,\n                                    canBreak, submerged: submergedAt(bot), wetFeet: wetStart })",
    "      const again = floodSidestep({ at: (dx, dy, dz) => bot.blockAt(p.offset(dx, dy, dz)), bear: side.bear,\n                                    canBreak, submerged: submergedAt(bot) })", async mod => {
    const bot = makeWorldBot(COMET(), { onDig: (k, w) => { if (k === '1,0,0') w.set(1, 0, 0, 'water[1]') } })
    const r = await ramp(bot, { mod })
    assert.strictEqual(r.sidestepped, 0); assert.match(String(r.stopped), /water in the feet cell/)
  })
})
await t('MUTANT KILLED: no cellFloods -> the east is dug toward a flooding head', async () => {
  await withMutant(REFLEX_PATH, '        if (fl) { refusals.push({ bear, reason: fl }); continue }', '        void fl', async mod => {
    const bot = makeWorldBot({ ...COMET(), '1,1,1': 'water[0]' })
    await ramp(bot, { mod })
    assert.ok(bot.digs.length > 0, 'the mutant still refused')
  })
})
await t('MUTANT KILLED: no fire veto -> the live column is entered', async () => {
  await withMutant(REFLEX_PATH, '      if (veto) { refusals.push({ bear, reason: veto }); continue }', '      void veto', async mod => {
    const bot = makeWorldBot(COMET())
    bot.fireSitesNow = () => [{ kind: 'death:fire', x: 5, y: -2, z: 0 }]
    await ramp(bot, { mod })
    assert.ok(bot.digs.length > 0)
  })
})
await t('MUTANT KILLED: no settle -> a jump\'s transient price decides (no dig)', async () => {
  await withMutant(REFLEX_PATH, '      const st = await settledEnv()\n      if (!st) { stopped = `yielded the body to ${yielded}`; return \'stop\' }',
    "      const st = { env: digEnv(bot), settledMs: 0 }\n      if (!st) { stopped = `yielded the body to ${yielded}`; return 'stop' }", async mod => {
    const bot = makeWorldBot(TOMB('deepslate'), { feetY: 0.5 })
    await ramp(bot, { mod, opts: { maxSteps: 0 } })
    assert.notStrictEqual(bot.digs[0]?.waitMs, 15_000)
  })
})
await t('MUTANT KILLED: the steering flag never raised -> the float hold turns the body', async () => {
  await withMutant(REFLEX_PATH, '      if (wetStart) { try { steering(true) } catch { /* a caller\'s flag */ } bot.setControlState(\'jump\', true) }',
    "      if (wetStart) { bot.setControlState('jump', true) }", async mod => {
    let owned = false
    const bot = makeWorldBot(COMET(), { onTick: floatHold(() => owned) })
    await ramp(bot, { mod, opts: { steering: v => { owned = v } } })
    assert.notStrictEqual(cellOf(bot), '1,0,0')
  })
})
await t('LAVA APPEARS DURING THE SWIM-UP: the destination is asked again after the rise and refused (Codex code r1 P1)', async () => {
  let lava = false
  const bot = makeWorldBot(COMET(), {
    onDig: (k, w, b) => { if (k === '1,0,0') { const p = b.entity.position; b.entity.position = new Vec3(p.x, -1.0, p.z) } },
    onTick: (w, b) => { if (!lava && b.digs.length === 2 && b.digs[1].done && b.entity.position.y > -0.4 && b.entity.position.y < 0) { lava = true; w.set(2, 0, 0, 'lava') } },
    rise: 0.02,
  })
  const r = await ramp(bot)
  assert.ok(lava, 'POSITIVE CONTROL: the lava arrived while the body was rising')
  assert.strictEqual(r.sidestepped, 0, r.stopped)
  assert.match(String(r.stopped), /side cell changed before the step: lava against the feet cell/)
  assert.notStrictEqual(cellOf(bot).split(',')[0], '1', 'it walked in beside the lava')
})

await t('MUTANT KILLED: the destination checked BEFORE the rise (da0d07b0\'s order) walks in beside the lava', async () => {
  const LAST = "      const last = floodSidestep({ at: (dx, dy, dz) => bot.blockAt(p.offset(dx, dy, dz)), bear: side.bear,\n" +
               "                                   canBreak, submerged: submergedAt(bot), wetFeet: wetStart })\n" +
               "      if (!last.ok || last.dig.length) return `the side cell changed before the step: ${last.reason ?? 'a cell refilled'}`\n" +
               '      const fl = headFloods()\n' +
               '      if (fl) return `the side cell changed before the step: ${fl}`\n'
  const TAIL = "      if (ceChecked && !inFrame()) return 'displaced'\n      bot.setControlState('forward', true)\n"
  const SWIM = '      if (wetStart) {\n        // SWIM UP FIRST (ceilescape-01)'
  await withMutants(REFLEX_PATH, [[LAST + TAIL, TAIL], [SWIM, LAST + SWIM]], async mod => {
    let lava = false
    const bot = makeWorldBot(COMET(), {
      onDig: (k, w, b) => { if (k === '1,0,0') { const p = b.entity.position; b.entity.position = new Vec3(p.x, -1.0, p.z) } },
      onTick: (w, b) => { if (!lava && b.digs.length === 2 && b.digs[1].done && b.entity.position.y > -0.4 && b.entity.position.y < 0) { lava = true; w.set(2, 0, 0, 'lava') } },
    rise: 0.02,
    })
    const r = await ramp(bot, { mod })
    assert.ok(lava, 'POSITIVE CONTROL: the lava arrived while the body was rising')
    assert.strictEqual(r.sidestepped, 1, `the mutant still refused: ${r.stopped}`)
  })
})
await t('MUTANT KILLED: the wetStart default flipped changes the existing flood sidestep', async () => {
  await withMutant(REFLEX_PATH, '  const takeSidestep = async (side, { wetStart = false, frame = null } = {}) => {', '  const takeSidestep = async (side, { wetStart = true, frame = null } = {}) => {', async mod => {
    const c = TOMB('stone')
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (const y of [3, 4]) c[`${x},${y},${z}`] = 'water[0]'
    c['-1,0,0'] = 'stone'; c['-1,1,0'] = 'stone'
    const bot = makeWorldBot(c, { feetY: 0, onDig: (k, w) => { if (k === '-1,0,0') w.set(-1, 0, 0, 'water[1]') } })
    bot.entity.onGround = true
    bot.entity.yaw = Math.PI / 2
    const r = await ramp(bot, { mod })
    assert.strictEqual(r.sidestepped, 1, `the mutant left the flood sidestep as it was: ${r.stopped}`)
  })
})

// ================================================================================================================
// F. r2 REVIEW CASES
// ================================================================================================================

/** Turn the copper ceiling into dirt 300 ms into the firing: inside the settle, before any swing. */
const midSettle = (done, mark) => { let t0 = null; return (w) => { t0 ??= Date.now(); if (!done() && Date.now() - t0 >= 300) { mark(); w.set(0, 2, 0, 'dirt') } } }
await t('THE BLOCK PRICED IS THE BLOCK SWUNG AT: a ceiling that changes during the settle is planned again (Codex r2 P1-2)', async () => {
  let changed = false
  const bot = makeWorldBot(COMET(), { onTick: midSettle(() => changed, () => { changed = true }) })
  const r = await ramp(bot)
  assert.ok(changed, 'POSITIVE CONTROL: the ceiling changed during the firing')
  assert.ok(!bot.digs.some(d => d.name === 'copper_ore'), `the stale copper object was swung: ${JSON.stringify(bot.digs)}`)
  assert.ok(bot.digs.some(d => d.cell === '0,2,0' && d.name === 'dirt' && d.done), r.stopped)
})

await t('MUTANT KILLED: no same-block check -> the stale copper object is swung for the dirt\'s price', async () => {
  await withMutant(REFLEX_PATH, "      if (!sameBlock(bot.blockAt(b.position), b)) return 'replan'\n      env = digEnv(bot); settledMs = st.settledMs; envMs = digPriceOf(bot, block)",
    "      block = bot.blockAt(b.position) ?? b\n      env = digEnv(bot); settledMs = st.settledMs; envMs = digPriceOf(bot, block)", async mod => {
    let changed = false
    const bot = makeWorldBot(COMET(), { onTick: midSettle(() => changed, () => { changed = true }) })
    await ramp(bot, { mod })
    assert.ok(bot.digs.some(d => d.name === 'copper_ore'), JSON.stringify(bot.digs))
  })
})

await t('WIRED: the stranded lattice does not start while a sidestep steers (Claude r2 P2-1)', () => {
  const code = strip(readFileSync(REFLEX_PATH, 'utf8'))
  assert.match(code, /longEnough && !poolEscaping && !rampSteering &&/)
  const src = readFileSync(REFLEX_PATH, 'utf8'), old = 'longEnough && !poolEscaping && !rampSteering &&'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR NOT UNIQUE')
  assert.doesNotMatch(strip(src.replace(old, 'longEnough && !poolEscaping &&')), /longEnough && !poolEscaping && !rampSteering &&/, 'MUTANT: the assertion sees the removal')
})

await t('WIRED (meta): body-claim\'s re-anchored arm end really bounds the arm -- deleting the outer flood arm breaks it', () => {
  const code = strip(readFileSync(REFLEX_PATH, 'utf8'))
  const END = "else if (climbOutcomeRoute(climbed) === 'flood')"
  const i = code.indexOf("climbed === 'needs_blocks'")
  assert.ok(code.slice(i, i + 6000).includes(END), 'POSITIVE CONTROL: the anchor is inside body-claim\'s window')
  const cut = code.replace(END, 'else if (false)')
  assert.ok(!cut.slice(i, i + 6000).includes(END), 'the window check would not have failed')
})

/** The BASE reflex (the fleet's 3cc5f14d) as a module, to compare traces against CEILESCAPE=0 (Claude r2 P2-4). */
async function withBase (fn) {
  // THE BASE's reflex.mjs AND scaffold.mjs (Claude code r1 P3-2: the two files this change edits that the OFF path runs), over
  // the shared libs (other modules that import scaffold.mjs -- poolescape, ... -- still get the candidate's copy; the four OFF
  // scenes below never reach them: Claude code r2 P3-3). Needs 3cc5f14d in the local clone (it is the fleet's sha, so every working clone has it); a missing sha
  // FAILS this test rather than skipping it.
  const { execFileSync } = await import('node:child_process')
  const show = f => execFileSync('git', ['show', `3cc5f14d:bots/src/${f}`], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', maxBuffer: 64 << 20 })
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const scaf = new URL(`./_base-scaffold-${tag}.mjs`, import.meta.url)
  const out = new URL(`./_base-ce-${tag}.mjs`, import.meta.url)
  writeFileSync(scaf, show('scaffold.mjs').replace(/from '\.\//g, "from '../src/"))
  writeFileSync(out, show('reflex.mjs').replace(/from '\.\/scaffold\.mjs'/g, `from './_base-scaffold-${tag}.mjs'`).replace(/from '\.\/(?!_base-)/g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { for (const f of [out, scaf]) { try { unlinkSync(f) } catch {} } }
}
const FLOOD_SCENE = () => {
  const c = TOMB('stone')
  for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (const y of [3, 4]) c[`${x},${y},${z}`] = 'water[0]'
  c['-1,0,0'] = 'stone'; c['-1,1,0'] = 'stone'
  return c
}
const trace = bot => ({ digs: bot.digs.map(d => [d.cell, d.name, d.waitMs, !!d.aborted]), controls: bot.controls, at: cellOf(bot) })
for (const [name, mk] of [
  ['the flood sidestep (scene A, dry, side cell open after one dig)', () => { const b = makeWorldBot(FLOOD_SCENE(), { feetY: 0 }); b.entity.onGround = true; b.entity.yaw = Math.PI / 2; return b }],
  ['the flood sidestep whose side cell floods', () => { const b = makeWorldBot(FLOOD_SCENE(), { feetY: 0, onDig: (k, w) => { if (k === '-1,0,0') w.set(-1, 0, 0, 'water[1]') } }); b.entity.onGround = true; b.entity.yaw = Math.PI / 2; return b }],
  ['an affordable stone ceiling and steps', () => { const b = makeWorldBot(TOMB('stone'), { feetY: 0 }); b.entity.onGround = true; return b }],
  ['Comet under copper', () => makeWorldBot(COMET())],
]) {
  await t(`CEILESCAPE=0 IS THE BASE, trace for trace: ${name}`, async () => {
    await withBase(async base => {
      const a = mk(), b = mk()
      const ra = await ramp(a, { mod: base, opts: { maxSteps: 2 } }), rb = await ramp(b, { off: true, opts: { maxSteps: 2 } })
      assert.deepStrictEqual(trace(b), trace(a))
      assert.strictEqual(rb.stopped, ra.stopped)
      assert.ok(a.controls.length || a.digs.length, 'POSITIVE CONTROL: the scene did something')
    })
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
