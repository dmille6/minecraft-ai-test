// UPKEEP-01 (OWNER 11-09): THE UPKEEP CREW -- a standing maintenance loop, the lowest-priority always-available work (upkeep.mjs).
// MEASURED (showcase snapshot 11-09 12:10Z): repairs 19 cells on 3 of 17 finished records, 0 of 60 lights dark, 10 of 10 farmland --
// already the picker's repair tier and the farm's own upkeep; NEW: stray tables and furnaces outside every record, the remains of
// trees felled at the base (log groups no member of which rests on the ground), drops outside the walls. Behaviour first (the survey,
// the record, the state, the order's tier and the refusal chains it composes), then the wiring. Mutants anchored and unique.
import assert from 'node:assert'
import fs from 'node:fs'
const UK = await import('../src/upkeep.mjs')
const SHOP = await import('../src/shop.mjs')
const TW = await import('../src/townwork.mjs').catch(() => null)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const UK_PATH = new URL('../src/upkeep.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const MIN = 60_000, T0 = Date.parse('2026-11-09T12:00:00Z')
const HOME = { x: 0, y: 64, z: 0 }

// a flat grass world (ground y 64), with blocks set by `set` { 'x,y,z': name }
function world (set = {}, { R = 140 } = {}) {
  return (x, y, z) => {
    if (Math.abs(x) > R || Math.abs(z) > R) return null
    const n = set[`${x},${y},${z}`]
    if (n) return { name: n, boundingBox: /_leaves$/.test(n) ? 'block' : n === 'air' ? 'empty' : 'block' }
    if (y < 64) return { name: 'dirt', boundingBox: 'block' }
    if (y === 64) return { name: 'grass_block', boundingBox: 'block' }
    return { name: 'air', boundingBox: 'empty' }
  }
}
const column = (set, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) set[`${x},${y},${z}`] = name }

console.log('THE REMAINS (remainsIn): log groups no member of which rests on the ground')
await t('a trunk felled at its base is listed with the soil under it; a living tree (its trunk on the grass) never', async () => {
  const set = {}
  column(set, 20, 20, 65, 70, 'spruce_log')          // a living tree
  column(set, 30, 20, 67, 69, 'spruce_log')          // its base dug: logs over air at 65..66
  set['30,70,20'] = 'spruce_leaves'
  const read = world(set)
  const scenario = M => {
    const r = M.remainsIn(read, [0, 0, 60, 60], { yHi: 78, yLo: 50, bounds: [-100, -100, 100, 100] })
    assert.strictEqual(r.length, 1, JSON.stringify(r))
    assert.deepStrictEqual(r[0].logs.map(p => p[1]), [69, 68, 67])
    assert.deepStrictEqual(r[0].base, [30, 64, 20])
    assert.strictEqual(r[0].name, 'spruce_log')
  }
  await killedBy(UK_PATH, UK, '    if (grounded) continue\n', '', scenario)
})
await t('never: a group past UPKEEP.remainsMax, one at the reach\'s edge (it may go on, unread), one higher than a bot on the ground reaches', () => {
  const set = {}
  for (let x = 10; x < 40; x++) set[`${x},70,10`] = 'oak_log'           // a 30-log beam: past the cap
  column(set, 50, 50, 66, 67, 'spruce_log'); set['50,68,50'] = 'spruce_log'
  column(set, 99, 0, 66, 68, 'spruce_log')                               // on the bounds' edge (x 99)
  column(set, 60, -30, 72, 74, 'spruce_log')                             // top 74 = ground + 10
  const read = world(set)
  const skipped = {}
  const r = UK.remainsIn(read, [0, -60, 99, 60], { yHi: 78, yLo: 50, bounds: [-100, -100, 99, 100], skipped })
  assert.deepStrictEqual(r.map(g => g.logs[0].join(',')), ['50,68,50'])
  assert.strictEqual(skipped.remains_high, 1)
})

console.log('THE STRAYS (straysIn): tables and furnaces on the ground outside every record')
await t('listed: a table in the open; never on a record cell, beside a record\'s box, in a protected zone, under a roof', async () => {
  const set = { '40,65,0': 'crafting_table', '41,65,0': 'furnace', '60,65,0': 'crafting_table', '80,65,0': 'crafting_table', '90,65,5': 'furnace', '90,68,5': 'stone' }
  const read = world(set)
  const cells = new Set(['41,65,0'])
  const avoid = (x, z) => (x >= 62 && x <= 70 && z >= -5 && z <= 5 ? 'project:hall' : null)
  const zone = (x, y, z) => x >= 78 && x <= 82
  const scenario = M => {
    const s = M.straysIn(read, [0, -10, 100, 10], { yHi: 78, yLo: 50, cells, avoid, zone })
    assert.deepStrictEqual(s.map(q => q.at.join(',')), ['40,65,0'])
  }
  await killedBy(UK_PATH, UK, '      if (cells.has(`${x},${y},${z}`) || zone(x, y, z) || near(x, z)) break\n', '      if (cells.has(`${x},${y},${z}`)) break\n', scenario)
})

console.log('THE SURVEY (upkeepSurvey): the job list, nearest first, a replant a remains group')
await t('a remains group\'s logs are clears (kind remains) and one sapling stands at its soil; a stray is a clear (kind stray); capped', () => {
  const set = { '20,65,0': 'crafting_table' }
  column(set, 40, 0, 66, 68, 'spruce_log')
  column(set, 10, 10, 66, 67, 'birch_log')
  const read = world(set)
  const sv = UK.upkeepSurvey(read, { home: HOME, r: 100, box: [-100, -100, 100, 100] })
  assert.deepStrictEqual(sv.clear.map(c => `${c.kind}:${c.at.join(',')}`), ['remains:10,67,10', 'remains:10,66,10', 'stray:20,65,0', 'remains:40,68,0', 'remains:40,67,0', 'remains:40,66,0'])
  assert.deepStrictEqual(sv.cells.map(c => [c.at.join(','), c.role, c.sapling]), [['10,65,10', 'sapling', 'birch_sapling'], ['40,65,0', 'sapling', 'spruce_sapling']])
  assert.deepStrictEqual([sv.census.strays, sv.census.remains, sv.census.remainLogs, sv.census.replants], [1, 2, 5, 2])
  const capped = UK.upkeepSurvey(read, { home: HOME, r: 100, box: [-100, -100, 100, 100], U: { ...UK.UPKEEP, jobMax: 3 } })
  assert.deepStrictEqual(capped.clear.map(c => c.kind), ['remains', 'remains', 'stray'], 'the nearest jobs first, whole groups only')
})
await t('a replant never: on a record cell, on a refused column, without soil (the remains over water), without room above', () => {
  const set = {}
  column(set, 30, 0, 66, 67, 'spruce_log'); set['30,64,0'] = 'stone'
  column(set, 50, 0, 66, 67, 'spruce_log')
  column(set, 70, 0, 66, 67, 'spruce_log')
  const read = world(set)
  const sv = UK.upkeepSurvey(read, { home: HOME, r: 100, box: [-100, -100, 100, 100], cells: new Set(['50,65,0']), avoid: (x, z) => (x === 70 && z === 0 ? 'farm' : null) })
  assert.strictEqual(sv.cells.length, 0)
  assert.ok(sv.census.skipped.replant_no_soil >= 1 && sv.census.skipped.replant_refused >= 1, JSON.stringify(sv.census.skipped))
  assert.strictEqual(sv.census.skipped.remains_refused, 1, 'a group over a refused column is never listed at all')
})
await t('the tiles cover the reach exactly once (eight, no overlap)', () => {
  const seen = new Set()
  for (let i = 0; i < UK.UPKEEP_TILES; i++) {
    const b = UK.upkeepTile(HOME, i, 16)
    for (let x = b[0]; x <= b[2]; x++) for (let z = b[1]; z <= b[3]; z++) { const k = `${x},${z}`; assert.ok(!seen.has(k), `overlap ${k}`); seen.add(k) }
  }
  assert.strictEqual(seen.size, 33 * 33)
})

console.log('THE RECORD, THE STALE CLOCK AND THE STATE (upkeepRecord, upkeepStale, upkeepState)')
await t('a list with jobs is open; an empty one quiet and complete; stale after surveyMs, a quiet one after quietMs only once every tile came back quiet', async () => {
  const scenario = M => {
    const sv = { clear: [{ at: [1, 65, 1], kind: 'stray', name: 'crafting_table' }], cells: [{ at: [2, 65, 2], role: 'sapling', group: 0 }], census: {} }
    const r = M.upkeepRecord(sv, { home: HOME, now: T0, tile: 3, quietRun: 0 })
    assert.strictEqual(r.plot, 'upkeep'); assert.strictEqual(r.structure_complete, false); assert.strictEqual(r.tile, 3)
    assert.deepStrictEqual(r.segments, [{ seg: 'U-0', deps: [] }]); assert.strictEqual(r.palette.sapling[0], 'spruce_sapling')
    assert.strictEqual(M.upkeepStale(r, T0 + 29 * MIN), false); assert.strictEqual(M.upkeepStale(r, T0 + 30 * MIN), true)
    const q = M.upkeepRecord({ clear: [], cells: [] }, { home: HOME, now: T0, quietRun: 1 })
    assert.strictEqual(q.structure_complete, true); assert.strictEqual(q.state, 'quiet')
    assert.strictEqual(M.upkeepStale(q, T0 + 31 * MIN), true, 'one quiet tile: the next tile after surveyMs')
    const qq = { ...q, quietRun: M.UPKEEP_TILES }
    assert.strictEqual(M.upkeepStale(qq, T0 + 31 * MIN), false, 'every tile quiet in a row: quietMs')
    assert.strictEqual(M.upkeepStale(qq, T0 + 121 * MIN), true)
    assert.strictEqual(M.upkeepNextTile(r), 4); assert.strictEqual(M.upkeepNextTile(null), 0)
    assert.strictEqual(M.upkeepQuietRun(q, true), 2); assert.strictEqual(M.upkeepQuietRun(q, false), 0)
  }
  await killedBy(UK_PATH, UK, " && (Number(rec.quietRun) || 0) >= UPKEEP_TILES ? U.quietMs : U.surveyMs)", ' ? U.quietMs : U.surveyMs)', scenario)
})
await t('the state: always complete (never the finite order, never a repair), DUE while a job is open or the list stale', () => {
  const open = UK.upkeepRecord({ clear: [{ at: [1, 65, 1], kind: 'stray', name: 'crafting_table' }], cells: [] }, { home: HOME, now: T0 })
  assert.deepStrictEqual(UK.upkeepState(open, { now: T0 + MIN, open: () => 1 }).due, true)
  assert.deepStrictEqual(UK.upkeepState(open, { now: T0 + MIN, open: () => 0 }).due, false, 'every job read done: quiet until the survey')
  assert.strictEqual(UK.upkeepState(null, { now: T0 }).due, true, 'no list yet: the first survey')
  const s = UK.upkeepState(open, { now: T0 + MIN, open: () => 1 })
  assert.deepStrictEqual([s.exists, s.complete, s.damaged, s.upkeep], [true, true, false, true])
})
await t('ON THE WORK BOARD (townwork.mjs jobBlocked, when this build has it): a due upkeep is a job, a quiet one is not', () => {
  if (!TW) { console.log('        (no townwork.mjs on this branch: the board is workboard-01\'s; the state shape is asserted above)'); return }
  const due = { ...UK.upkeepState(null, { now: T0 }), free: true }
  assert.strictEqual(TW.jobBlocked(due), null)
  const quiet = { ...UK.upkeepState(UK.upkeepRecord({ clear: [], cells: [] }, { home: HOME, now: T0 }), { now: T0 + MIN }), free: true }
  assert.strictEqual(TW.jobBlocked(quiet), 'complete')
})

console.log('CODEX r1 BLOCKERS 1-3: a grown replant, the replant obligation, the drops alone')
await t('BLOCKER 1: a replant that grew (a log in its cell) or stands is DONE -- never left, never a foreign block to dig', async () => {
  const scenario = M => {
    assert.strictEqual(M.replantDone({ name: 'spruce_sapling' }), true)
    assert.strictEqual(M.replantDone({ name: 'spruce_log' }), true, 'it grew')
    assert.strictEqual(M.replantDone({ name: 'air' }), false)
    const rec = { cells: [{ at: [1, 65, 1], role: 'sapling', group: 0 }], clear: [] }
    assert.strictEqual(M.upkeepLeft(rec, () => ({ name: 'spruce_log' })), 0, 'a grown tree is no job left')
  }
  await killedBy(UK_PATH, UK, "export const replantDone = b => !!b && (/_sapling$|^mangrove_propagule$/.test(nm(b)) || LOG.test(nm(b)))", "export const replantDone = b => !!b && /_sapling$|^mangrove_propagule$/.test(nm(b))", scenario)
})
await t('BLOCKER 2: without a sapling a remains group that owes a replant is HELD (its logs stand, its replant stays listed); strays and groups owing none go on', async () => {
  const rec = { cells: [{ at: [10, 65, 10], role: 'sapling', group: 0 }], clear: [{ at: [10, 67, 10], kind: 'remains', name: 'spruce_log', group: 0 }, { at: [20, 67, 0], kind: 'remains', name: 'spruce_log', group: 1 }, { at: [30, 65, 0], kind: 'stray', name: 'crafting_table' }] }
  const scenario = M => {
    const v = M.upkeepVisitJobs(rec, { haveSapling: false })
    assert.deepStrictEqual(v.record.clear.map(c => c.at.join(',')), ['20,67,0', '30,65,0'])
    assert.deepStrictEqual(v.record.cells, [])
    assert.strictEqual(v.held, 1)
    assert.strictEqual(M.upkeepVisitJobs(rec, { haveSapling: true }).record, rec, 'with a sapling: the whole list')
    const read = (x, y, z) => ({ name: x === 10 && y === 67 ? 'spruce_log' : 'air' })
    assert.strictEqual(M.upkeepLeft(rec, read, { canPlant: true }), 2, 'its log and its replant are left')
    assert.strictEqual(M.upkeepLeft(rec, read, { canPlant: false }), 0, 'not this bot\'s work while no sapling is near: never due for it')
  }
  await killedBy(UK_PATH, UK, "  const clear = (rec.clear ?? []).filter(c => !(c.kind === 'remains' && owe.has(c.group)))\n", "  const clear = (rec.clear ?? []).slice()\n", scenario)
})
await t('BLOCKER 3: drops worth a sweep (not junk, room for them) make the upkeep DUE on their own', async () => {
  const drops = [{ name: 'dirt', pos: { x: 10, y: 65, z: 10 } }, { name: 'rotten_flesh', pos: { x: 12, y: 65, z: 10 } }, { name: 'oak_log', pos: { x: 500, y: 65, z: 0 } }]
  assert.strictEqual(UK.dropsWorth(drops, { home: HOME, never: new Set(['rotten_flesh']), free: 10 }), 1)
  assert.strictEqual(UK.dropsWorth(drops, { home: HOME, never: new Set(['rotten_flesh']), free: 2 }), 0, 'no room: nothing worth it')
  assert.strictEqual(UK.dropsWorth(drops, { home: HOME, never: new Set(['rotten_flesh']), free: 2, stacks: [{ name: 'dirt', count: 10, stackSize: 64 }] }), 1, 'a stack with room')
  const quiet = UK.upkeepRecord({ clear: [], cells: [] }, { home: HOME, now: T0 })
  assert.strictEqual(UK.upkeepState(quiet, { now: T0 + MIN }).due, false)
  assert.strictEqual(UK.upkeepState(quiet, { now: T0 + MIN, drops: 1 }).due, true)
})
console.log('THE ORDER\'S TIER (shop.mjs activeProject `upkeep`) AND THE REFUSAL CHAINS IT COMPOSES')
const P = [{ plot: 'shop' }, { plot: 'house1' }, { plot: 'monument' }, { plot: 'road', sink: true }, { plot: 'upkeep', upkeep: true }, { plot: 'tidy' }]
const S = (o = {}) => [
  { plot: 'shop', exists: true, complete: true, damaged: false, due: false },
  { plot: 'house1', exists: true, complete: true, damaged: false, due: false, ...o.house1 },
  { plot: 'monument', exists: true, complete: true, damaged: false, due: false, ...o.monument },
  { plot: 'road', exists: true, complete: true, damaged: false, due: false, sink: true, ...o.road },
  { plot: 'upkeep', exists: true, complete: true, damaged: false, due: true, upkeep: true, free: true, ...o.upkeep },
  { plot: 'tidy', exists: true, complete: true, damaged: false, due: false, ...o.tidy },
]
await t('the LAST tier: a repair, an open project with a slot, a due record and a sink all come first', () => {
  assert.strictEqual(SHOP.activeProject(S({ house1: { damaged: true } }), P).plot, 'house1')
  assert.strictEqual(SHOP.activeProject(S({ house1: { complete: false, free: true } }), P).plot, 'house1')
  assert.strictEqual(SHOP.activeProject(S({ monument: { due: true } }), P).plot, 'monument')
  assert.strictEqual(SHOP.activeProject(S({ road: { sinkNext: true, free: true } }), P).plot, 'road')
  assert.strictEqual(SHOP.activeProject(S(), P).plot, 'upkeep', 'nothing else: the upkeep')
})
await t('COMPOSED: an open project this bot has no slot on is never its pick while upkeep is due (it would end slots_full)', async () => {
  const scenario = M => assert.strictEqual(M.activeProject(S({ house1: { complete: false, free: false } }), P).plot, 'upkeep')
  await killedBy(SHOP_PATH, SHOP, '  if (open.length && !sink && upk) return dueBefore() ?? upk\n', '', scenario)
})
await t('CODEX r1 BLOCKER 4: with the open project full, a due record (dueFirst first) still comes before the upkeep', async () => {
  const scenario = M => {
    assert.strictEqual(M.activeProject(S({ house1: { complete: false, free: false }, monument: { due: true, dueFirst: true } }), P).plot, 'monument')
    assert.strictEqual(M.activeProject(S({ house1: { complete: false, free: false }, monument: { due: true, idle: true } }), P).plot, 'upkeep', 'a due record idle for this bot yields')
  }
  await killedBy(SHOP_PATH, SHOP, '  if (open.length && !sink && upk) return dueBefore() ?? upk\n', '  if (open.length && !sink && upk) return upk\n', scenario)
})
await t('COMPOSED: a due record this bot found nothing to do at (idle) yields to the upkeep; with no upkeep it is the pick as before', async () => {
  const scenario = M => {
    assert.strictEqual(M.activeProject(S({ monument: { due: true, idle: true } }), P).plot, 'upkeep')
    assert.strictEqual(M.activeProject(S({ monument: { due: true, idle: true }, upkeep: { due: false } }), P).plot, 'monument')
  }
  await killedBy(SHOP_PATH, SHOP, '  for (const p of list) { const s = st(p); if (s.exists && s.complete && s.due && !p.upkeep && !idleDue(s)) return p }\n', '  for (const p of list) { const s = st(p); if (s.exists && s.complete && s.due && !p.upkeep) return p }\n', scenario)
})
await t('a quiet upkeep, a full one, one idle for this bot: never the pick, and never the fallback (the last real project, as before)', () => {
  for (const o of [{ due: false }, { free: false }, { idle: true }]) assert.strictEqual(SHOP.activeProject(S({ upkeep: o }), P).plot, 'tidy', JSON.stringify(o))
  const P0 = P.filter(p => !p.upkeep)
  assert.strictEqual(SHOP.activeProject(S().filter(s => s.plot !== 'upkeep'), P0).plot, 'tidy', 'no upkeep plot: exactly as before')
})
await t('the upkeep guards nothing (its jobs are the ground\'s) and draws as a light project (2 free bag slots)', () => {
  const L = [...P.filter(p => !p.sink), { plot: 'shaft' }]
  assert.ok(!SHOP.projectsGuarded(L).some(p => p.plot === 'upkeep'))
  assert.ok(SHOP.LIGHT_PLOTS.has('upkeep'))
  assert.ok(SHOP.PROJECTS.some(p => p.plot === 'upkeep' && p.upkeep === true))
  assert.strictEqual(SHOP.PROJECTS.at(-1).plot, 'tidy', 'the tidy stays the list\'s last')
  assert.strictEqual(UK.upkeepOn({}, ''), false); assert.strictEqual(UK.upkeepOn({}, 'showcase'), true); assert.strictEqual(UK.upkeepOn({ UPKEEP: 'off' }, 'showcase'), false)
})

console.log('THE WIRING (skills.mjs: structural invariants only)')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')
const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
await t('the build order dispatches the plot to its visit; the state is upkeep.mjs\'s; every row names project=upkeep', () => {
  assert.ok(/if \(proj\.plot === UPKEEP_PLOT\) return buildUpkeep\(ctx, args, signal\)/.test(SK))
  assert.ok(/if \(p\.plot === UPKEEP_PLOT\) return upkeepStateNow\(b, rec, now\)/.test(SK))
  const v = SK.slice(SK.indexOf('async function buildUpkeep ('), SK.indexOf('async function buildTidyVisit ('))
  assert.ok(v.length > 3000)
  assert.ok(!/project: (TIDY_PLOT|COUNTRY_PLOT)/.test(v), 'no other project named in the upkeep visit\'s rows')
  assert.ok(/gkSweep\(bot, signal, \{[^}]*plot: UPKEEP_PLOT/.test(v), 'the sweep row names the upkeep')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
