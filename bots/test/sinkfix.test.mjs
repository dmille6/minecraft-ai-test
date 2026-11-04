// SINKFIX-01 (LIVE showcase 11-03 18:40-21:25Z, fold cbd2f51b-6dd0ded8-fdd64ead): 158 `_sink op=pick` rows (p 0.98-1, every kind
// `ok`), ZERO `op=sited`, ZERO sink visits; the build visits went to the finished town stair (80: `complete`, nothing dug or placed),
// the sited copper hall waiting on copper (11, 0 placed), the tidy (31) and house1 (1). Reproduced from that state: the picker's own
// order (shop.mjs activeProject) with the per-bot repair back-off it runs under (repairBackoff / noteRepair), one pick every 10 min a
// bot -- the old order never reaches a sink; with sinkfix-01's idle marks (noteIdle / idleMarks: a visit that changed nothing makes
// its plot yield to a wanted sink for IDLE_MS) the sink is picked by the third order and the stair at most once per IDLE_MS (an hour). With no
// sink wanted the order is exactly as before. Anchored mutants for each rule the test leans on.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const SH = await import('../src/shop.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SHOP_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// the showcase's list at the fold (projectsOn in the showcase pool) and its states as the logs show them
const PLOTS = ['shop', 'shaft', 'house1', 'monument', 'paths', 'wall', 'treefarm', 'shopchest', 'storehouse', 'hall', 'yard', 'road', 'tower', 'shrine', 'tidy']
const LIST = SH.PROJECTS.filter(p => PLOTS.includes(p.plot))
const LOGGED = (want = true) => LIST.map(p => {
  if (p.sink) return { plot: p.plot, exists: false, complete: false, damaged: false, sink: true, sinkNext: want }
  if (p.plot === 'shaft') return { plot: 'shaft', exists: true, complete: true, damaged: true }        // read damaged, visits find nothing
  if (p.plot === 'hall') return { plot: 'hall', exists: true, complete: false, damaged: false }        // sited, waiting on copper
  if (p.plot === 'tidy') return { plot: 'tidy', exists: true, complete: false, damaged: false, free: false }   // the keeper's
  return { plot: p.plot, exists: true, complete: true, damaged: false }
})
// what each visit did in the window (the `_build_visit` rows): the stair and the hall nothing, a sink would build
const OUTCOME = { shaft: { status: 'no_effect', stop: 'complete' }, hall: { status: 'no_effect', stop: 'replanned' }, tidy: { status: 'no_effect', stop: 'keeper_held' } }
function run (M, { idle = true, want = true, n = 12 } = {}) {
  const rmem = new Map(), mem = idle ? new Map() : null, picks = []
  let now = Date.parse('2026-11-03T18:40:00Z')
  for (let i = 0; i < n; i++, now += 10 * 60_000) {
    const states = M.repairBackoff(LOGGED(want), rmem, now)
    const pick = M.activeProject(idle ? M.idleMarks(states, mem, now) : states, LIST)
    M.noteRepair(rmem, pick, states, now)
    picks.push(pick.plot)
    if (idle) M.noteIdle(mem, pick.plot, OUTCOME[pick.plot] ?? { status: 'success', placed: 40 }, now)
  }
  return picks
}
await t('THE LOGGED STATE, the old order: stair repairs and the waiting hall, never a sink (the live 2.75 h)', () => {
  const picks = run(SH, { idle: false })
  assert.ok(!picks.some(p => ['road', 'tower', 'shrine'].includes(p)), picks.join(','))
  assert.deepStrictEqual([...new Set(picks)].sort(), ['hall', 'shaft'])
  assert.strictEqual(picks.filter(p => p === 'shaft').length, 6, '3 repair tries an hour (REPAIR_TRIES), as the logs: 80 / 10 bots / 2.75 h')
})
await t('with sinkfix-01: the sink by the third order; the stair and the hall each at most once per IDLE_MS', () => {
  const picks = run(SH)
  assert.ok(picks.slice(0, 3).includes('road'), picks.join(','))
  assert.ok(picks.filter(p => p === 'shaft').length <= 2 && picks.filter(p => p === 'hall').length <= 2, picks.join(','))
  assert.ok(picks.filter(p => ['road', 'tower', 'shrine'].includes(p)).length >= 8, picks.join(','))
})
await t('POSITIVE CONTROL: with no sink wanted the marks change nothing (the order exactly as before)', () => {
  assert.deepStrictEqual(run(SH, { want: false }), run(SH, { want: false, idle: false }))
})
await t('noteIdle: a no-effect visit marks, a working one clears, bookkeeping stops and sinks never mark; idleMarks reads the mark', () => {
  const m = new Map(), T = 1000
  SH.noteIdle(m, 'hall', { status: 'no_effect', stop: 'replanned' }, T); assert.strictEqual(m.get('hall'), T + SH.IDLE_MS)
  SH.noteIdle(m, 'hall', { status: 'success', placed: 3 }, T); assert.ok(!m.has('hall'))
  for (const stop of ['slots_full', 'room', 'off', 'aborted']) { SH.noteIdle(m, 'hall', { status: 'no_effect', stop }, T); assert.ok(!m.has('hall'), stop) }
  SH.noteIdle(m, 'hall', { status: 'failed', stop: 'error' }, T); assert.ok(!m.has('hall'))
  SH.noteIdle(m, 'tower', { status: 'no_effect', stop: 'no_site' }, T); assert.ok(!m.has('tower'))
  SH.noteIdle(m, 'shaft', { status: 'no_effect', stop: 'complete' }, T)
  assert.strictEqual(SH.idleMarks([{ plot: 'shaft' }], m, T + 1)[0].idle, true)
  assert.strictEqual(SH.idleMarks([{ plot: 'shaft' }], m, T + SH.IDLE_MS + 1)[0].idle, undefined, 'the mark lapses')
})
await t('MUTANT KILLED: a repair that ignores the mark sends every order back to the finished stair', async () => {
  await withMutant('if (s.exists && s.complete && s.damaged && !yields(s)) return p', 'if (s.exists && s.complete && s.damaged) return p', async M => {
    assert.ok(run(M).filter(p => p === 'shaft').length > run(SH).filter(p => p === 'shaft').length)
  })
})
await t('MUTANT KILLED: an open project that ignores the mark keeps the sink behind the waiting hall', async () => {
  await withMutant('const freeOpen = open.find(p => st(p).free !== false && !yields(st(p)))', 'const freeOpen = open.find(p => st(p).free !== false)', async M => {
    assert.ok(!run(M).some(p => ['road', 'tower', 'shrine'].includes(p)))
  })
})
await t('showcase batch 2: a crop farm visit that changed nothing is idle-marked like any finite project, and yields to a wanted sink', () => {
  const CL = SH.PROJECTS.filter(p => [...PLOTS, 'cropfarm'].includes(p.plot))
  assert.ok(CL.some(p => p.plot === 'cropfarm'), 'the crop farm is in PROJECTS')
  // the sited farm, open (unplanted for want of seed), everything else standing; a road sink wanted
  const states = CL.map(p => p.sink ? { plot: p.plot, exists: false, complete: false, damaged: false, sinkNext: true }
    : p.plot === 'cropfarm' ? { plot: 'cropfarm', exists: true, complete: false, damaged: false }
      : { plot: p.plot, exists: true, complete: true, damaged: false })
  const m = new Map(), T = Date.parse('2026-11-04T02:00:00Z')
  assert.strictEqual(SH.activeProject(SH.idleMarks(states, m, T), CL).plot, 'cropfarm', 'the open farm first')
  // buildCropFarm's no-effect returns: { status: 'no_effect', stop: <the build's stop | 'complete' | 'no_site'> }
  SH.noteIdle(m, 'cropfarm', { status: 'no_effect', stop: 'no_material' }, T)
  assert.strictEqual(m.get('cropfarm'), T + SH.IDLE_MS)
  assert.strictEqual(SH.activeProject(SH.idleMarks(states, m, T + 1), CL).plot, 'road', 'the idle farm yields to the sink')
  // a harvest or a gather (cleared > 0) is a success: the mark clears and the farm is first again
  SH.noteIdle(m, 'cropfarm', { status: 'success', stop: 'complete' }, T + 2)
  assert.strictEqual(SH.activeProject(SH.idleMarks(states, m, T + 3), CL).plot, 'cropfarm')
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
