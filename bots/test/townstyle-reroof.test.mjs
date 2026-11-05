// TOWNSTYLE-03: THE RETROFIT (reroof.mjs; skills.mjs buildReroof): a standing flat-roofed building gets its pitched roof as a new record
// generation that KEEPS every old cell (nothing dug: the flat roof becomes the ceiling), one building at a time. Behaviour on the fake
// vanilla: house@1 built flat, then re-roofed -- the old cells untouched, every new stair as recorded; the planner's order and its waits.
import assert from 'node:assert'
const T = await import('../src/townstyle.mjs')
const C = await import('../src/cottage.mjs')
const RR = await import('../src/reroof.mjs')
const F = await import('./helpers/buildfake.mjs')
const { B, R, PJ, HOME, k3 } = F
const { STYLE, vanillaBot, kitFor, withSrcMutant } = await import('./helpers/townstylefake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}

console.log('THE PLANNER')
await t('reroofNext: one at a time, in order, complete and unstyled only, logs known and enough', () => {
  const done = (blueprint, extra = {}) => ({ blueprint, structure_complete: true, ...extra })
  const recs = { house1: done('house@1'), shop: done('workshop@1'), storehub: done('storehub@1'), hall: { blueprint: 'hall@1', structure_complete: false } }
  assert.strictEqual(RR.reroofNext(recs, { logs: 200 }).target.plot, 'house1')
  assert.strictEqual(RR.reroofNext({ ...recs, house1: done('house@1', { style: { wood: 'spruce' } }) }, { logs: 200 }).target.plot, 'shop', 'a styled one is done')
  assert.match(RR.reroofNext({ ...recs, cottage1: { style: {}, structure_complete: false } }, { logs: 200 }).why, /^styled_open:cottage1/, 'a styled build open: wait')
  assert.match(RR.reroofNext({ ...recs, house1: done('house@1', { style: {}, structure_complete: false }) }, { logs: 200 }).why, /^styled_open:house1/, 'its own earlier retrofit open: wait')
  assert.strictEqual(RR.reroofNext(recs, { logs: null }).why, 'stock_unknown')
  assert.match(RR.reroofNext(recs, { logs: 10 }).why, /^logs_10</)
  assert.strictEqual(RR.reroofNext({ hall: recs.hall }, { logs: 500 }).why, 'none', 'an open hall is not re-roofed (its build goes on)')
  assert.strictEqual(RR.reroofNext({ house1: done('house@2') }, { logs: 500 }).why, 'none', 'another blueprint: never')
  assert.strictEqual(RR.reroofSwitches({}, 'showcase').on, true); assert.strictEqual(RR.reroofSwitches({ REROOF: 'off' }, 'showcase').on, false)
  // a retrofit generation stays COMPLETE: while its added roof reads open (damaged) it is the open one (Claude r1 note 1)
  const rf = done('house@1', { style: {}, restyle: { id: 'house@1r' } })
  assert.match(RR.reroofNext({ ...recs, house1: rf }, { logs: 200, damaged: r => r === rf }).why, /^styled_open:house1/)
  assert.strictEqual(RR.reroofNext({ ...recs, house1: rf }, { logs: 200, damaged: () => false }).target.plot, 'shop', 'its roof done: the next')
  // a building whose added roof failed its proof 3 times is passed over (Claude r1 note 3)
  assert.strictEqual(RR.reroofNext(recs, { logs: 200, failed: { house1: 3 } }).target.plot, 'shop')
  assert.strictEqual(RR.reroofNext(recs, { logs: 200, failed: { house1: 2 } }).target.plot, 'house1')
})
await t('the retrofit blueprint keeps EVERY old cell (the flat roof the ceiling) and only adds above it', () => {
  for (const tg of RR.REROOF_TARGETS) {
    const old = B.loadBlueprint(tg.blueprint)
    const nw = RR.reroofBlueprint(old, tg.form)
    const at = c => `${c.u},${c.v},${c.y}`
    const oldSet = new Map(old.cells.map(c => [at(c), c.role]))
    for (const c of nw.cells) if (oldSet.has(at(c))) assert.strictEqual(c.role, oldSet.get(at(c)), `${tg.blueprint} ${at(c)}: the old cell's role`)
    assert.strictEqual(nw.cells.filter(c => oldSet.has(at(c))).length, old.cells.length, `${tg.blueprint}: every old cell kept`)
    const added = RR.reroofAdded(old, nw)
    assert.ok(added.length > 40 && added.every(c => c.y >= 3), `${tg.blueprint}: the roof only, above the flat one`)
  }
})

console.log('THE RETROFIT, BUILT (fake vanilla)')
async function reroofHouse (Mod = R, Bm = B) {
  const bp = B.loadBlueprint('house@1')
  const srv = F.server()
  const site = Bm.siteBlueprint(srv.read, F.plan(), bp, { tries: 3, plot: 'house1' })
  assert.ok(site.ok, site.why)
  const pr = F.project(site.record)
  const kit = kitFor({ ...bp, palette: { ...bp.palette, trim: ['$planks'] } })
  const added0 = RR.reroofAdded(bp, RR.reroofBlueprint(bp, 'gable'))
  const styled = T.stylePalette(RR.reroofBlueprint(bp, 'gable').palette, STYLE)
  for (const c of added0) { const n = R.roleFirst(styled, c.role); kit[n] = (kit[n] ?? 0) + 1 }
  const e = vanillaBot(srv, 'A', { inv: kit })
  const visit = async (rec, gen, palette) => Mod.runVisit({ ...pr.p('A'), record: rec, recordGen: gen, palette, walkR: 30 }, e, { maxSteps: 3000, barrierWaitMs: 50, deadline: Date.now() + 40_000 })
  let h = PJ.recordHead(pr.dir, pr.key), r = null
  for (let i = 0; i < 4 && r?.stop !== 'complete'; i++) r = await visit(h.head.rec, h.head.gen, bp.palette)
  assert.strictEqual(r.stop, 'complete', `the flat house: ${r.stop} ${r.why ?? ''}`)
  PJ.publishRecord(pr.dir, pr.key, cur => ({ ...cur, structure_complete: true, state: 'complete' }))
  const before = new Map(site.record.cells.map(c => [k3(c.at), srv.read(...c.at).name]))
  // THE PLANNER'S STEP (skills.mjs buildReroof): the added cells proven on the standing world, the new generation
  const bpNew = RR.reroofBlueprint(bp, 'gable')
  const added = RR.reroofAdded(bp, bpNew)
  const bpAdd = RR.reroofProofBlueprint(bp, bpNew, STYLE)
  h = PJ.recordHead(pr.dir, pr.key)
  const rec = h.head.rec
  const p = Bm.proveSite(srv.read, HOME, bpAdd, { anchor: { x: rec.anchor[0], z: rec.anchor[1] }, s: rec.s, orient: rec.orient, clear: [], fill: [] }, { walkR: 30 })
  assert.ok(p.ok, `the added roof proven on the standing house: ${p.why} ${p.detail ?? ''}`)
  const pub = PJ.publishRecord(pr.dir, pr.key, cur => RR.reroofRecord(cur, p.cells, bpNew, STYLE))
  assert.strictEqual(pub.result, 'accepted')
  h = PJ.recordHead(pr.dir, pr.key)
  r = null
  for (let i = 0; i < 4 && r?.stop !== 'complete'; i++) r = await visit(h.head.rec, h.head.gen, h.head.rec.palette)
  return { r, srv, before, rec2: h.head.rec, e }
}
await t('house@1 built FLAT, then re-roofed: complete, every old cell exactly as it stood, every new stair as recorded, nothing dug', async () => {
  const { r, srv, before, rec2, e } = await reroofHouse()
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
  for (const [k, n] of before) assert.strictEqual(srv.read(...k.split(',').map(Number)).name, n, `old cell ${k} unchanged`)
  for (const c of rec2.cells.filter(q => q.ws)) assert.ok(T.stateOk(srv.read(...c.at).props, c.ws), `${c.role}@${c.at}`)
  assert.ok(!e.logs.some(([k, d]) => k === '_build' && d.op === 'clear'), 'nothing dug')
  assert.ok(rec2.restyle?.id === 'house@1r' && rec2.blueprint === 'house@1' && rec2.structure_complete === true, 'the record keeps its blueprint id and stays complete (its open roof is damage); the generation is tagged')
  assert.ok(Math.max(...rec2.cells.map(c => c.at[1])) - rec2.s === 6, 'the ridge 6 above the pad')
})
await t('EVERY TARGET: its added roof is PROVEN on the standing building (chests, furnaces, tables inside: Claude r1 BLOCKER 1)', () => {
  for (const tg of RR.REROOF_TARGETS) {
    const bp = B.loadBlueprint(tg.blueprint)
    const srv = F.server()
    const site = B.siteBlueprint(srv.read, F.plan(), bp, { tries: 3, plot: tg.plot })
    assert.ok(site.ok, `${tg.blueprint}: ${site.why}`)
    // the building STANDS: every cell set in the world
    for (const c of site.record.cells) { let n = R.roleFirst(bp.palette, c.role) ?? 'stone'; if (n === 'oak_planks') n = 'spruce_planks'; if (c.role === 'fill') n = 'cobblestone'; srv.set(c.at, n) }
    for (const c of site.record.clear ?? []) if (!site.record.cells.some(q => k3(q.at) === k3(c.at))) srv.set(c.at, 'air')
    // the enchanting workshop's fit-out stands too (anvil, table, shelves: not record cells)
    for (const f of bp.fit ?? []) { const { dx, dz } = { E: { dx: f.u, dz: f.v }, S: { dx: -f.v, dz: f.u }, W: { dx: -f.u, dz: -f.v }, N: { dx: f.v, dz: -f.u } }[site.record.orient]; srv.set([site.record.anchor[0] + dx, site.record.s + f.y, site.record.anchor[1] + dz], f.item) }
    const rec = site.record
    const p = B.proveSite(srv.read, HOME, RR.reroofProofBlueprint(bp, RR.reroofBlueprint(bp, tg.form), STYLE), { anchor: { x: rec.anchor[0], z: rec.anchor[1] }, s: rec.s, orient: rec.orient, clear: [], fill: [] }, { walkR: 48 })
    assert.ok(p.ok, `${tg.blueprint}: ${p.why} ${p.detail ?? ''}`)
  }
})
await t('MUTANT the interior not filtered (reroof.mjs): the workshop\'s proof fails interior_unreachable', () => withSrcMutant('reroof.mjs',
  "    interior: (bpOld.interior ?? []).filter(([u, v, y]) => !filled.has(`${u},${v},${y}`)),", "    interior: bpOld.interior ?? [],", async Rm => {
    const bp = B.loadBlueprint('workshop@1')
    const srv = F.server()
    const site = B.siteBlueprint(srv.read, F.plan(), bp, { tries: 3, plot: 'shop' })
    for (const c of site.record.cells) { let n = R.roleFirst(bp.palette, c.role) ?? 'stone'; if (n === 'oak_planks') n = 'spruce_planks'; srv.set(c.at, n) }
    const rec = site.record
    const p = B.proveSite(srv.read, HOME, Rm.reroofProofBlueprint(bp, Rm.reroofBlueprint(bp, 'gable'), STYLE), { anchor: { x: rec.anchor[0], z: rec.anchor[1] }, s: rec.s, orient: rec.orient, clear: [], fill: [] }, { walkR: 48 })
    assert.strictEqual(p.why, 'interior_unreachable')
  }))
await t('WIRED: the planner waits during its town-wide wait (Claude r1 BLOCKER 2) and repairs-first builds the open roof', async () => {
  const fsm = await import('node:fs')
  const SK = fsm.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  assert.ok(/if \(p\.plot === REROOF_PLOT\) return \{[^\n]*waiting: Date\.now\(\) < siteWaitUntil\(REROOF_PLOT, dir\) \|\| !reroofDueNow\(b, dir\)\.target \}/.test(SK))
  assert.ok(/reroofNext\(records, \{ logs, damaged: r => !!bot && recordDamaged\(bot, r, \{ tidy: false \}\), failed: reroofFails\(dir\) \}\)/.test(SK))
})
await t('MUTANT the retrofit without the old cells kept (restyleRoof keepFlat ignored): the old flat roof is dropped from the record', () => withSrcMutant('townstyle.mjs',
  "  const keep = keepFlat ? bp.cells : bp.cells.filter(", "  const keep = false ? bp.cells : bp.cells.filter(", async Tm => {
    const old = B.loadBlueprint('house@1')
    const nw = Tm.restyleRoof(old, { id: 'x', form: 'gable', keepFlat: true })
    const at = c => `${c.u},${c.v},${c.y}`
    const kept = new Set(nw.cells.map(at))
    assert.ok(old.cells.some(c => !kept.has(at(c))), 'the mutant loses old cells')
  }))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
