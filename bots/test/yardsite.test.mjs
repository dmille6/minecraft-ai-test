// YARDSITE-01: THE STOCK YARD ON A CROWDED TOWN (bots/src/yard.mjs yardSitingPlan / yardSectors / yardVisitOpts; buildsite.mjs
// siteBlueprint's domain, line, walkR, standDomain, sectorBy, rankKey and siteBlueprintAsync; skills.mjs yardSiteFor wiring).
// Behaviour: on the fake flat world with the whole town ring reserved (the showcase's case: wall, paths, house, ziggurat apron),
// stockyard-01's call finds no site and the yard's siting plan finds one beyond the ring, proven; the cooperative search returns
// the identical record; the real visit runner builds that far floor end to end with the record's stands domain and walk radius,
// and cannot without them. Pure: the size setting, the blueprints, the sectors, the bands. STRUCTURAL source assertions only for
// the wiring (comments stripped, anchored on executable lines), each shown to fail by an anchored mutant.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const { B, R, HOME, server, bot, plan, project } = await import('./helpers/buildfake.mjs')
const Y = await import('../src/yard.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const cheb = c => Math.max(Math.abs(c.at[0] - HOME.x), Math.abs(c.at[2] - HOME.z))

console.log('THE SETTING AND THE BLUEPRINTS')
await t('YARD_SIZE: 1, 2, else auto (2x first, then 1x)', () => {
  assert.strictEqual(Y.yardSize({}), 'auto')
  assert.strictEqual(Y.yardSize({ YARD_SIZE: '1' }), 1)
  assert.strictEqual(Y.yardSize({ YARD_SIZE: '2' }), 2)
  assert.strictEqual(Y.yardSize({ YARD_SIZE: 'big' }), 'auto')
  assert.deepStrictEqual(Y.yardBlueprintsFor('auto'), ['yard@2', 'yard@1'])
  assert.deepStrictEqual(Y.yardBlueprintsFor(1), ['yard@1'])
  assert.deepStrictEqual(Y.yardBlueprintsFor(2), ['yard@2'])
  assert.ok(Y.isYardBlueprint('yard@1') && Y.isYardBlueprint('yard@2') && !Y.isYardBlueprint('workshop@1') && !Y.isYardBlueprint(null))
})
await t('yard@2 is yard@1 with bays twice as long: 18 x 26, four 2 x 22 bays, 656 pile slots (304 for yard@1)', () => {
  const b1 = B.loadBlueprint('yard@1'), b2 = B.loadBlueprint('yard@2')
  assert.deepStrictEqual(b2.footprint, { u: 18, v: 26 })
  for (let i = 0; i < 4; i++) assert.strictEqual(b2.cells.filter(c => c.y === 0 && c.role === `bay${i}`).length, 44)
  assert.deepStrictEqual(b2.palette, b1.palette)
  const rec = { anchor: [0, 0], orient: 'N', s: 70 }
  assert.strictEqual(Y.pileSlots(rec, b1).reduce((n, b) => n + b.slots.length, 0), 304)
  assert.strictEqual(Y.pileSlots(rec, b2).reduce((n, b) => n + b.slots.length, 0), 656)
  assert.deepStrictEqual(Y.yardEarthFor(b1), { col: 4, fill: 120, cut: 120 })
  assert.ok(Y.yardEarthFor(b2).fill > 120 && Y.yardEarthFor(b2).col === 4)
})

console.log('THE SECTORS AND THE BANDS')
await t('the land plan\'s yard zone first, then wild, then homes; never farms, the tree farm, the monument or industry', () => {
  const land = { zones: { E: 'yard', N: 'wild', SE: 'homes', SW: 'homes', NW: 'monument', NE: 'industry', S: 'farms', W: 'treefarm' } }
  assert.deepStrictEqual(Y.yardSectors(land, [{ sector: 'S', source: 'beside' }]).map(s => `${s.sector}:${s.source}`), ['E:land:yard', 'N:land:wild', 'SE:land:homes', 'SW:land:homes'])
})
await t('no land plan (or one with none of those zones): the workshop\'s sectors, as before', () => {
  const fb = [{ sector: 'S', source: 'beside' }, { sector: 'W', source: 'free' }]
  assert.deepStrictEqual(Y.yardSectors(null, fb), fb)
  assert.deepStrictEqual(Y.yardSectors({ zones: { E: 'farms' } }, fb), fb)
})
await t('the bands: from the town ring\'s inner edge out to 80; a site ranks by the nearest band its pad lies in', () => {
  const d = Y.yardDomain(HOME, 80)
  assert.ok(!d(10, 10) && d(22, 0) && d(79, 0) && !d(81, 0) && !d(60, 60), 'Chebyshev >= 22, Euclidean <= 80')
  assert.strictEqual(Y.yardBandOf(HOME, [[30, 0], [40, 5]]), 0)
  assert.strictEqual(Y.yardBandOf(HOME, [[50, 0], [57, 5]]), 1)
  assert.strictEqual(Y.yardBandOf(HOME, [[79, 0]]), 3)
  assert.strictEqual(Y.yardBandOf(HOME, [[90, 0]]), 4)
  const p = Y.yardSitingPlan(HOME, { size: 'auto', bpOf: id => B.loadBlueprint(id) })
  assert.deepStrictEqual(p.map(s => [s.blueprint, s.band, s.line, s.walkR, s.sectorBy]), [['yard@2', 80, 80, 92, 'centre'], ['yard@1', 80, 80, 92, 'centre']])
  assert.ok(p[0].standDomain(86, 0) && !p[0].standDomain(89, 0), 'the stands may stand 8 beyond the band')
})

console.log('A CROWDED TOWN (the fake flat world, the whole ring reserved: x, z in -40..40)')
const RING = [{ box: [-40, -64, -40, 40, 320, 40], why: 'test:the town ring is full' }]
const pl = plan()
const fb = B.projectSectors(pl, null)
const step1 = Y.yardSitingPlan(HOME, { size: 1, bpOf: id => B.loadBlueprint(id) })[0]
const yctx = { zones: RING, plot: Y.YARD_PLOT, sectors: Y.yardSectors(null, fb), earth: step1.earth, domain: step1.domain, standDomain: step1.standDomain, walkR: step1.walkR, line: step1.line, sectorBy: step1.sectorBy, rankKey: step1.rankKey, tries: 3 }
const BP1 = B.loadBlueprint('yard@1')
const FAR = B.siteBlueprint(server().read, pl, BP1, yctx)
await t('the control: stockyard-01\'s call (the town ring 22..44, every cell in one sector) finds no site', () => {
  const s = B.siteBlueprint(server().read, pl, BP1, { zones: RING, plot: Y.YARD_PLOT, earth: Y.YARD_EARTH, sectors: fb, tries: 3 })
  assert.strictEqual(s.ok, false, JSON.stringify(s.record?.anchor))
})
await t('the yard\'s siting plan sites it beyond the ring, clear of the reservation, every aisle proven reachable from town', () => {
  assert.ok(FAR.ok, JSON.stringify(FAR.sectors?.map(s => [s.sector, s.screened, s.tried, s.rejects, s.proofFails, s.proofEx])))
  const r = FAR.record
  assert.ok(r.cells.every(c => cheb(c) > 40), 'no cell on the reserved ring')
  assert.strictEqual(r.interior.open, r.interior.reachable)
  assert.strictEqual(r.walkR, 92, 'the record carries its walk radius')
})
await t('the cooperative search returns the identical record and hands the event loop back while it runs', async () => {
  let beats = 0
  const iv = setInterval(() => { beats++ }, 1)
  const s = await B.siteBlueprintAsync(server().read, pl, BP1, yctx, { sliceMs: 5 })
  clearInterval(iv)
  assert.deepStrictEqual(s.record, FAR.record)
  assert.ok(beats > 0, 'a timer fired during the search')
  const ab = await B.siteBlueprintAsync(server().read, pl, BP1, yctx, { sliceMs: 0, aborted: () => true })
  assert.strictEqual(ab.why, 'aborted')
})
await t('the defaults are unchanged: without a domain the search is the ring\'s (same record as the synchronous call, async or not)', async () => {
  const a = B.siteBlueprint(server().read, pl, BP1, { plot: Y.YARD_PLOT, earth: Y.YARD_EARTH, tries: 2 })
  const b = await B.siteBlueprintAsync(server().read, pl, BP1, { plot: Y.YARD_PLOT, earth: Y.YARD_EARTH, tries: 2 })
  assert.ok(a.ok)
  assert.deepStrictEqual(b.record, a.record)
  assert.ok(a.record.cells.every(c => cheb(c) >= 22 && Math.hypot(c.at[0], c.at[2]) <= 45), 'the ring 22..44')
  assert.ok(!('walkR' in a.record), 'no walk radius on a ring record')
})
await t('the visit builds the far floor end to end with the record\'s stands domain and walk radius -- and cannot without them', async () => {
  const rec = { ...FAR.record, band: 80 }
  const opts = Y.yardVisitOpts(rec, HOME)
  assert.ok(typeof opts.domain === 'function' && opts.walkR === 92)
  assert.deepStrictEqual(Y.yardVisitOpts({ ...rec, band: undefined }, HOME), {}, 'an older (ring) record: the visit\'s defaults')
  const run = async more => {
    const srv = server(), { p } = project(rec)
    const e = bot(srv, 'A', { inv: { cobblestone: 600, torch: 8 }, feet: [2, HOME.y, 0] })
    return R.runVisit({ ...p('A'), palette: BP1.palette, ...more }, e, { maxSteps: 3000 })
  }
  const without = await run({})
  assert.notStrictEqual(without.stop, 'complete', 'the control: the ring\'s stands and walk do not reach the far yard')
  const r = await run(opts)
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why, placed: r.placed }))
  assert.strictEqual(r.placed, rec.cells.length)
})

console.log('THE WIRING (skills.mjs)')
const SKP = new URL('../src/skills.mjs', import.meta.url)
const SK = strip(readFileSync(SKP, 'utf8'))
const W1 = /\} else if \(plot === YARD_PLOT\) \{\s*const ss = await yardSiteFor\(bot, \{ \.\.\.h\.head\.plan, gen: h\.head\.gen \}, c, stood, signal\)/
const W2 = /: isYardBlueprint\(rec\.blueprint\) \? yardVisitOpts\(rec, home\) : \{\}/
const W3 = /beat: true, placedBy, \.\.\.yardVisitOpts\(rec, home\) \}/
const W4 = /const s = await siteBlueprintAsync\(read, plan, blueprintOf\(step\.blueprint\), \{ zones, wells: c\.wells, farm: c\.farm, z0: c\.z0, stood, sectors, plot: YARD_PLOT,/
const W5 = /const zones = \[\.\.\.c\.zones, \.\.\.recordZones\(others\), \.\.\.hallPadZones\(plan\), \.\.\.townMarkerZones\(\)\]/
await t('the yard sites through yardSiteFor (cooperative, every reservation), and both of its visits stand and walk out to its band', () => {
  for (const re of [W1, W2, W3, W4, W5]) assert.ok(re.test(SK), String(re))
})
await t('mutants: each wiring line, once broken, fails its assertion (each anchor present and unique)', () => {
  for (const re of [W1, W2, W3, W4, W5]) {
    const m = SK.match(re)
    assert.ok(m && SK.split(m[0]).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${re}`)
    assert.ok(!re.test(SK.replace(m[0], m[0].replace(/[A-Za-z]/, '#'))), String(re))
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
