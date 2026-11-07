// GKFOREVER-01: THE GROUNDS NEVER RUN OUT (gkforever.mjs; tidy.mjs LEVEL + DEAD; groundskeeper.mjs CREW; idlework.mjs + milestones.mjs
// the grounds lap; skills.mjs buildTidy / shopActive / groundsMeansFor). Behaviour on buildfake's flat world (stone below G, grass at
// G) and on the pure deciders; structural assertions only for wiring; every mutant asserts its anchor is present and unique.
import assert from 'node:assert'
// roughground-01: these tests pin tidy-01's and gkforever's own rules; the rough survey (on by default) is roughground.test.mjs's
process.env.ROUGH = 'off'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const F = await import('../src/gkforever.mjs')
const GKM = await import('../src/groundskeeper.mjs')
const IW = await import('../src/idlework.mjs')
const SH = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const GKF_PATH = new URL('../src/gkforever.mjs', import.meta.url)
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const IW_PATH = new URL('../src/idlework.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const MS_PATH = new URL('../src/milestones.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
const H = 3_600_000, M = 60_000
const NOW = 1_800_000_000_000

console.log('THE SWITCHES')
await t('every part is on by default; GKFOREVER=0 turns all off; GKF_<PART>=0 one', async () => {
  for (const p of F.GKF_PARTS) assert.strictEqual(F.gkfOn(p, {}), true, p)
  for (const p of F.GKF_PARTS) assert.strictEqual(F.gkfOn(p, { GKFOREVER: '0' }), false, p)
  assert.strictEqual(F.gkfOn('crew', { GKF_CREW: 'off' }), false)
  assert.strictEqual(F.gkfOn('clock', { GKF_CREW: 'off' }), true)
})

console.log('THE PERPETUAL CLOCK (gkfDue)')
const rec = (o = {}) => ({ blueprint: 'tidy@1', structure_complete: true, completeAt: NOW - 5 * M, stage: 0, ...o })
await t('an open record is never due; a completion in the future (a bad clock) is not due', async () => {
  assert.strictEqual(F.gkfDue({ ...rec(), structure_complete: false }, { now: NOW, lastK: 4 }).due, false)
  assert.strictEqual(F.gkfDue(rec({ completeAt: NOW + 10 * M }), { now: NOW, lastK: 4 }).due, false)
})
await t('a completed band before the last: due AT ONCE from the next band while the interior audit is fresh', async () => {
  const d = F.gkfDue(rec({ stage: 2 }), { now: NOW, lastK: 7, interiorAt: NOW - 10 * M })
  assert.deepStrictEqual([d.due, d.from, d.why], [true, 3, 'next_band'])
})
await t('the INTERIOR first: a completed band with the interior audit GKF.interiorMs old starts the survey at stage 0', async () => {
  const d = F.gkfDue(rec({ stage: 2 }), { now: NOW, lastK: 7, interiorAt: NOW - F.GKF.interiorMs })
  assert.deepStrictEqual([d.due, d.from, d.why], [true, 0, 'interior_audit'])
  assert.strictEqual(F.gkfDue(rec({ stage: 2 }), { now: NOW, lastK: 7, interiorAt: null }).from, 0, 'never audited: the interior first')
})
await t('the LAST band (and a no-land-plan town at stage 0): due GKF.cycleMs after completion, from 0 -- never 48 h', async () => {
  assert.strictEqual(F.gkfDue(rec({ stage: 7, completeAt: NOW - F.GKF.cycleMs + M }), { now: NOW, lastK: 7 }).due, false)
  const d = F.gkfDue(rec({ stage: 7, completeAt: NOW - F.GKF.cycleMs }), { now: NOW, lastK: 7 })
  assert.deepStrictEqual([d.due, d.from], [true, 0])
  assert.ok(F.GKF.cycleMs < T.TIDY_RESURVEY_MS, 'shorter than tidy-01\'s 48 h')
  assert.strictEqual(F.gkfDue(rec({ stage: 0, completeAt: NOW - F.GKF.cycleMs }), { now: NOW, lastK: 0 }).due, true)
})
await t('MUTANT KILLED: a completed band that never goes back to the interior', async () => {
  await withMutant(GKF_PATH, 'return { due: true, from: interiorStale ? 0 : k + 1,', 'return { due: true, from: k + 1,', async m => {
    assert.strictEqual(m.gkfDue(rec({ stage: 2 }), { now: NOW, lastK: 7, interiorAt: null }).from, 3, 'the mutant skips the interior')
  })
})
await t('the bands reach GKF.radius (128): more stages than groundskeeper-01\'s 80', async () => {
  const LP = await import('../src/landplan.mjs')
  const a = LP.landStages(LP.LAND), b = LP.landStages(F.gkfLand(LP.LAND))
  assert.strictEqual(a.at(-1).rMax, 80)
  assert.strictEqual(b.at(-1).rMax, F.GKF.radius)
  assert.ok(b.length > a.length)
  assert.deepStrictEqual(b.slice(0, a.length - 1).map(s => s.id), a.slice(0, a.length - 1).map(s => s.id), 'the inner stages unchanged')
})

console.log('THE DEAD-CELL CARRY')
await t('a waived cell is carried into the next generation; older than GKF.deadMs it is tried again; bad keys dropped', async () => {
  const prev = { waived: { '1,2,3': { why: 'no_stand', at: NOW - H }, '4,5,6': { why: 'no_stand', at: NOW - F.GKF.deadMs } }, gkfDead: { '7,8,9': { why: 'waived', at: NOW - 2 * H }, 'x,y': { at: NOW } } }
  const d = F.gkfDeadCarry(prev, { now: NOW })
  assert.deepStrictEqual(Object.keys(d).sort(), ['1,2,3', '7,8,9'])
  assert.strictEqual(F.gkfDeadCarry({ waived: { '1,2,3': { at: NOW + H } } }, { now: NOW })['1,2,3'].at, NOW, 'a future stamp is now')
})
await t('MUTANT KILLED: a carry that never ages out (the cell is never tried again)', async () => {
  await withMutant(GKF_PATH, '    if (now - at >= G.deadMs) return\n', '', async m => {
    assert.ok(m.gkfDeadCarry({ waived: { '4,5,6': { at: NOW - F.GKF.deadMs } } }, { now: NOW })['4,5,6'], 'the mutant keeps it')
  })
})
await t('a re-survey never lists a dead cell again (siteTidy `dead`), and counts it in skipped.dead', async () => {
  const srv = server(); col(srv, 10, 10, G - 1, G, 'air')   // a 1x1 pit two deep
  const a = T.siteTidy(srv.read, { home: HOME, now: NOW })
  const keys = a.record.cells.map(c => c.at.join(','))
  assert.ok(keys.length >= 2, `the pit is listed: ${keys}`)
  const dead = { [keys[0]]: { why: 'no_stand', at: NOW } }
  const b = T.siteTidy(srv.read, { home: HOME, now: NOW, dead })
  assert.ok(!b.record.cells.some(c => c.at.join(',') === keys[0]), 'the dead cell is gone')
  assert.strictEqual(b.survey.skipped.dead, 1)
  const c = T.siteTidy(srv.read, { home: HOME, now: NOW })
  assert.strictEqual(c.record.cells.length, keys.length, 'control: without `dead` the cell is listed')
})

await t('Codex r1 BLOCKER 2: a road LIGHT given up on is not listed again (siteStage `dead`)', async () => {
  const LP = await import('../src/landplan.mjs')
  const SMALL = Object.freeze({ ...LP.LAND, workR: 44, rimR: 20, rimStep: 12 })
  const cols = []
  for (let x = 22; x <= 40; x++) cols.push([x, 0, G])
  const land = { home: HOME, roads: [{ id: 'ring', kind: 'ring', cols }], corridors: [], zones: {}, ringR: 20, workR: 44, inner: 6 }
  const srv = server()
  const a = T.siteStage(srv.read, { home: HOME, land, stage: LP.stageOf(1, SMALL), lights: 2, L: SMALL })
  const lights = (a.record?.cells ?? []).filter(c => c.role === 'light')
  assert.ok(lights.length >= 1, `control: lights listed (${lights.length})`)
  const dead = Object.fromEntries(lights.map(l => [l.at.join(','), { why: 'no_stand', at: NOW }]))
  const b = T.siteStage(srv.read, { home: HOME, land, stage: LP.stageOf(1, SMALL), lights: 2, L: SMALL, dead })
  assert.strictEqual((b.record?.cells ?? []).filter(c => c.role === 'light').length, 0, 'the dead lights are gone')
  assert.strictEqual(b.why, 'nothing', 'and with nothing else the stage has no work')
})
await t('MUTANT KILLED: the lights without the dead filter re-list a given-up light', async () => {
  const LP = await import('../src/landplan.mjs')
  const SMALL = Object.freeze({ ...LP.LAND, workR: 44, rimR: 20, rimStep: 12 })
  const cols = []
  for (let x = 22; x <= 40; x++) cols.push([x, 0, G])
  const land = { home: HOME, roads: [{ id: 'ring', kind: 'ring', cols }], corridors: [], zones: {}, ringR: 20, workR: 44, inner: 6 }
  const srv = server()
  const lights = (T.siteStage(srv.read, { home: HOME, land, stage: LP.stageOf(1, SMALL), lights: 2, L: SMALL }).record?.cells ?? []).filter(c => c.role === 'light')
  const dead = Object.fromEntries(lights.map(l => [l.at.join(','), { why: 'no_stand', at: NOW }]))
  await withMutant(TIDY_PATH, "  const lightAt = dead ? lightAt0.filter(l => !Object.prototype.hasOwnProperty.call(dead, l.at.join(','))) : lightAt0\n", '  const lightAt = lightAt0\n', async m => {
    const b = m.siteStage(srv.read, { home: HOME, land, stage: LP.stageOf(1, SMALL), lights: 2, L: SMALL, dead })
    assert.ok((b.record?.cells ?? []).some(c => c.role === 'light'), 'the mutant re-lists it')
  })
})
await t('Codex r1 BLOCKER 1: tidySameGen tells one siting from the next (an old crew visit never completes a newer stage)', async () => {
  const SK = await import('../src/skills.mjs')
  const a = { sitedAt: NOW, stage: 2, cells: [1, 2], cut: [1] }
  assert.strictEqual(SK.tidySameGen(a, { ...a, waived: { x: 1 } }), true, 'a waiver is the same generation')
  assert.strictEqual(SK.tidySameGen(a, { ...a, sitedAt: NOW + 1 }), false)
  assert.strictEqual(SK.tidySameGen(a, { ...a, stage: 3 }), false)
  assert.strictEqual(SK.tidySameGen(a, { ...a, cells: [1] }), false)
  assert.strictEqual(SK.tidySameGen(a, null), false)
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/cur && !cur\.structure_complete && tidySameGen\(cur, rec\) \? \{ \.\.\.cur, structure_complete: true/.test(src), 'the completion is fenced')
  assert.ok(/cur\.cells\.length !== rec\.cells\.length \|\| !tidySameGen\(cur, rec\)\) return null/.test(src), 'the waiver is fenced')
  assert.ok(/completed = pub\.result === 'accepted' \|\|/.test(src), 'complete only when it is')
})
console.log('LEVEL INSIDE THE WALLS (tidy.mjs surveyTidy `level`)')
await t('a lone dirt STEP one block over its neighbours is cut with `level`, left without (pillarMin 2)', async () => {
  const srv = server(); col(srv, 8, 8, G + 1, G + 1, 'dirt')
  assert.strictEqual(T.surveyTidy(srv.read, { home: HOME }).cut.length, 0, 'control: tidy-01 leaves it')
  const s = T.surveyTidy(srv.read, { home: HOME, level: true })
  assert.deepStrictEqual(s.cut.map(c => c.at), [[8, G + 1, 8]])
})
await t('a natural stone step is never cut; a terrace edge (a row one up) is not a step', async () => {
  const srv = server(); col(srv, 8, 8, G + 1, G + 1, 'stone')
  for (let x = -20; x <= 20; x++) for (let z = 12; z <= 20; z++) col(srv, x, z, G + 1, G + 1, 'dirt')   // a terrace: z 12..20 one up
  const s = T.surveyTidy(srv.read, { home: HOME, level: true })
  assert.strictEqual(s.cut.length, 0, `cut ${JSON.stringify(s.cut.map(c => c.at))}`)
  assert.ok((s.skipped.pillar_natural ?? 0) >= 1)
})
await t('a one-deep 1x1 HOLE is filled to its lowest neighbour with `level`; tidy-01 (pitMin 2) passes over it', async () => {
  const srv = server(); col(srv, -9, 7, G, G, 'air')
  assert.strictEqual(T.surveyTidy(srv.read, { home: HOME }).fill.length, 0, 'control')
  const s = T.surveyTidy(srv.read, { home: HOME, level: true })
  assert.deepStrictEqual(s.fill.map(c => c.at), [[-9, G, 7]])
  assert.ok(s.pits.some(p => p.dip))
})
await t('a dip beside water is left (water is terrain); a slope is not a dip', async () => {
  const srv = server(); col(srv, -9, 7, G, G, 'air'); srv.set([-8, G, 7], 'water')
  assert.strictEqual(T.surveyTidy(srv.read, { home: HOME, level: true }).fill.filter(c => c.at[0] === -9).length, 0)
  const sl = server()
  for (let x = -20; x <= 20; x++) for (let z = 4; z <= 30; z++) if (z >= 10) col(sl, x, z, G + 1, G + Math.min(4, z - 9), 'dirt')
  const s2 = T.surveyTidy(sl.read, { home: HOME, level: true })
  assert.strictEqual(s2.pits.filter(p => p.dip).length, 0, 'a ramp of one-block rises has no dip')
})
await t('MUTANT KILLED: `level` without the step rule; `level` without the dip pass', async () => {
  await withMutant(TIDY_PATH, '    if (h < (level ? 1 : T.pillarMin)) continue', '    if (h < T.pillarMin) continue', async m => {
    const srv = server(); col(srv, 8, 8, G + 1, G + 1, 'dirt')
    assert.strictEqual(m.surveyTidy(srv.read, { home: HOME, level: true }).cut.length, 0)
  })
  await withMutant(TIDY_PATH, '  if (level) {\n    const inPit', '  if (false) {\n    const inPit', async m => {
    const srv = server(); col(srv, -9, 7, G, G, 'air')
    assert.strictEqual(m.surveyTidy(srv.read, { home: HOME, level: true }).fill.length, 0)
  })
})

console.log('THE CREW (groundskeeper.mjs keeperOrderPure)')
const LIST = [{ plot: 'shop' }, { plot: 'monument' }, { plot: 'tidy' }]
const ST = (tidy = {}, shop = { exists: true, complete: true }) => [{ plot: 'shop', ...shop }, { plot: 'monument', exists: true, complete: true }, { plot: 'tidy', exists: true, complete: false, ...tidy }]
await t('without the crew another bot sees the tidy FULL (groundskeeper-01); with it the tidy is as it is (LAST, its slots)', async () => {
  assert.strictEqual(GKM.keeperOrderPure(ST(), LIST, { d: 'other' }).states[2].free, false)
  const r = GKM.keeperOrderPure(ST(), LIST, { d: 'other', crew: true })
  assert.notStrictEqual(r.states[2].free, false)
  assert.deepStrictEqual(r.order.map(p => p.plot), ['shop', 'monument', 'tidy'], 'never ahead of the other projects')
})
await t('a bot on a GROUNDS lap works the tidy first, a due stage reading open, as the keeper does', async () => {
  const r = GKM.keeperOrderPure(ST({ complete: true, due: true }), LIST, { d: 'other', crew: true, grounds: true })
  assert.strictEqual(r.order[0].plot, 'tidy')
  assert.strictEqual(r.states[2].complete, false)
  assert.strictEqual(GKM.keeperOrderPure(ST(), LIST, { d: 'other', crew: false, grounds: true }).order[0].plot, 'shop', 'crew off: no')
})
await t('an UNSITED workshop never holds the grounds back with the crew (board-c); a missing one still does', async () => {
  const uns = ST({}, { exists: false, complete: false, unsited: true })
  assert.strictEqual(GKM.keeperWanted(uns, { crew: true }), true)
  assert.strictEqual(GKM.keeperWanted(uns, {}), false, 'control: groundskeeper-01 waits for the workshop')
  assert.strictEqual(GKM.keeperOrderPure(uns, LIST, { d: 'mine', crew: true }).order[0].plot, 'tidy')
  assert.strictEqual(GKM.keeperWanted(ST({}, { exists: false, complete: false }), { crew: true }), false, 'not yet tried: the town builds its workshop first')
})
await t('MUTANT KILLED: the crew without its "as it is" branch reads full again', async () => {
  await withMutant(GK_PATH, '  if (crew) return { order: list, states: out }\n', '', async m => {
    assert.strictEqual(m.keeperOrderPure(ST(), LIST, { d: 'other', crew: true }).states[2].free, false)
  })
})
await t('the tidy\'s builders: the crew (GKF.crew) with it, the keeper alone without', async () => {
  assert.strictEqual(F.gkfBuilders(true), F.GKF.crew)
  assert.strictEqual(F.gkfBuilders(false), 1)
})

console.log('THE GROUNDS LAP (idlework.mjs) -- the refusal chain composed')
await t('the GK rotation alternates grounds with the gathers; no grounds means -> the next gather; the scout stays 1 in 8', async () => {
  const R = IW.IDLE_ROTATION_GK
  assert.strictEqual(R.filter(k => k === 'grounds').length, 4)
  assert.strictEqual(R.filter(k => k === 'scout').length, 1)
  const all = { iron: true, logs: true, coal: true, grounds: true }
  assert.strictEqual(IW.idlePick(0, { means: all, rotation: R }), 'grounds')
  assert.strictEqual(IW.idlePick(0, { means: { ...all, grounds: false }, rotation: R }), 'iron')
  assert.strictEqual(IW.idlePick(0, { means: all }), 'iron', 'control: the plain rotation has no grounds lap')
  assert.ok(!IW.IDLE_KINDS.includes('grounds'), 'grounds is never a gather kind')
})
await t('a grounds batch is met by GKF.batchVisits visits that changed the ground, by GKF.batchMs, or by a no-work visit', async () => {
  let st = IW.idleStep(null, 5, 'grounds', 0, NOW)
  assert.strictEqual(IW.idleMet(st, { now: NOW + M }), false)
  st = IW.idleStep(st, 5, 'grounds', F.GKF.batchVisits, NOW + 2 * M)
  assert.strictEqual(IW.idleMet(st, { now: NOW + 2 * M }), true, 'visits')
  const s2 = IW.idleStep(null, 6, 'grounds', 7, NOW)
  assert.strictEqual(IW.idleMet(s2, { now: NOW + F.GKF.batchMs }), true, 'time')
  assert.strictEqual(IW.idleMet(s2, { now: NOW + M, noWorkAt: NOW + 30_000 }), true, 'no work: the lap ends at once')
  assert.strictEqual(IW.idleMet(s2, { now: NOW + M, noWorkAt: NOW - M }), false, 'an older no-work is not this lap\'s')
})
await t('COMPOSED: a grounds lap that finds no work ends, the next lap gathers (means false for GKF.barMs), then grounds again', async () => {
  const R = IW.IDLE_ROTATION_GK
  const noWorkAt = NOW + 30_000
  const st = IW.idleStep(null, 0, 'grounds', 0, NOW)
  assert.ok(IW.idleMet(st, { now: NOW + M, noWorkAt }))
  const g1 = F.gkfMeans({ work: true, slotFree: true, noWorkAt, now: NOW + M })
  assert.strictEqual(g1, false)
  const k1 = IW.idlePick(2, { means: { iron: true, logs: true, coal: true, grounds: g1 }, rotation: R })
  assert.notStrictEqual(k1, 'grounds'); assert.ok(['iron', 'logs', 'coal'].includes(k1), k1)
  const g2 = F.gkfMeans({ work: true, slotFree: true, noWorkAt, now: noWorkAt + F.GKF.barMs })
  assert.strictEqual(IW.idlePick(4, { means: { iron: true, logs: true, coal: true, grounds: g2 }, rotation: R }), 'grounds')
  assert.strictEqual(F.gkfMeans({ work: true, slotFree: false, now: NOW }), false, 'no slot: gather')
  assert.strictEqual(F.gkfMeans({ work: false, slotFree: true, now: NOW }), false, 'no work: gather')
})
await t('MUTANT KILLED: a grounds lap that never ends on a no-work visit (it would hold the bot GKF.batchMs for nothing)', async () => {
  await withMutant(IW_PATH, ' || (Number.isFinite(noWorkAt) && Number.isFinite(state.at) && noWorkAt >= state.at)', '', async m => {
    const s2 = m.idleStep(null, 6, 'grounds', 7, NOW)
    assert.strictEqual(m.idleMet(s2, { now: NOW + M, noWorkAt: NOW + 30_000 }), false)
  })
})
await t('the visit counters: placed/cleared/cut is work; complete/slots_full/keeper_held is no work', async () => {
  assert.ok(F.gkfVisitWorked({ placed: 1 })); assert.ok(F.gkfVisitWorked({ cleared: 2 })); assert.ok(!F.gkfVisitWorked({}))
  for (const s of ['complete', 'slots_full', 'keeper_held']) assert.ok(F.gkfNoWork(s), s)
  assert.ok(!F.gkfNoWork('deadline'))
})
await t('a bot on a grounds lap gets the tidy order back at the keeper\'s cooldown (shop.mjs orderCooldown)', async () => {
  SH.setKeeperNow(() => false)
  IW.setGroundsOpen(() => false)
  assert.strictEqual(SH.orderCooldown('tidy'), SH.SHOP_COOLDOWN_MS)
  IW.setGroundsOpen(() => true)
  assert.strictEqual(SH.orderCooldown('tidy'), GKM.GK.cooldownMs)
  assert.strictEqual(SH.orderCooldown('house1'), SH.SHOP_COOLDOWN_MS, 'only the tidy')
  IW.setGroundsOpen(() => false)
})

console.log('WIRING (structural)')
await t('buildTidy: the clock decides fresh, the stages reach GKF.radius with level + dead; the census; the counters; the means hook', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const fresh = GKFS\.clock \? \(cur => !cur \|\| gkfDueOf\(cur\)\.due\)/.test(s), 'fresh')
  assert.ok(/walkFrom: townEdge\(I\.plan, I\.home\), L: gkLandL\(\), level: GKFS\.level, dead \}\)/.test(s), 'stage siting')
  assert.ok(/last = land \? landStages\(gkLandL\(\)\)\.at\(-1\)\.k : 0/.test(s), 'the last band')
  assert.ok(/if \(GKFS\.clock\) return r\?\.blueprint === TIDY_BLUEPRINT && gkfDueOf\(r\)\.due/.test(s), 'gkStageDue')
  assert.ok(/groundsCensus\(bot, \{ s, k0, sk,/.test(s), 'census')
  assert.ok(/if \(gkfVisitWorked\(extra\)\) bot\.gkfWorked = /.test(s), 'the counter')
  assert.ok(/setGroundsMeans\(b => groundsMeansFor\(b\)\)/.test(s), 'means')
  assert.ok(/grounds: GKFS\.idle && groundsBatchOpen\(\) \}\)/.test(s), 'keeperOrder reads the lap')
  assert.ok(/if \(k\.d === 'other' && !GKFS\.crew\) return out/.test(s), 'the helper passes the keeper refusal')
  const sh = strip(readFileSync(SHOP_PATH, 'utf8'))
  assert.ok(/builders: GROUNDS\.on \? gkfBuilders\(gkfOn\('crew'\)\) : TIDY_BUILDERS/.test(sh), 'builders')
  const ms = strip(readFileSync(MS_PATH, 'utf8'))
  assert.strictEqual((ms.match(/rotation: idleRotation\(\)/g) ?? []).length, 2, 'both picks use the rotation')
  assert.ok(/const n = kind === 'grounds' \? \(Number\(b\?\.gkfWorked\) \|\| 0\)/.test(ms), 'the lap counts visits')
  assert.ok(/coal: pick, grounds: groundsMeans\(b\) \}/.test(ms), 'the means')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
