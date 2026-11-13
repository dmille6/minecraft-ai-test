// HOMES-01SHOW (bots/src/homeplots.mjs, townlayout.json; cottage.mjs COTTAGE_PLOTS; shop.mjs PROJECTS / projectsGuarded; skills.mjs
// housePlotsNow / cottageSiteFor / projectHeads). LIVE showcase before it: `cottage2` answered `no_site` on every visit -- the siting
// took only the extension's first free house plot and came back to it after every wait; three cottage projects.
// BEHAVIOUR through the pure functions: the layout's parse and its pool/home check, the offer's order, the rotation past a failed plot
// and the return to it, a taken plot, the shift off a road corridor and the skip, the door rule (checked against the REAL siting), the
// project list with the switch on and off. THE CHAIN: the real cottage siting (buildsite.mjs siteBlueprint + cottage.mjs
// cottageSitingPlan, the family's own looks) over the fake world with two plots, the first unsiteable -> the second is sited; and the
// town's own files through skills.mjs (a child process a switch state: HOMEPLOTS=off answers exactly what it did before). Structural
// source assertions only for the wiring. Every mutant asserts its anchor present and unique BEFORE the assertion that expects a failure.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HOME0 = { x: 0, y: 70, z: 0 }
// ---- THE CHILD (one switch state; the env is set by the parent BEFORE any module loads) -------------------------------------
if (process.env.HOMEPLOTS_CHILD === 'lists') {
  const C = await import('../src/cottage.mjs'); const S = await import('../src/shop.mjs'); const H = await import('../src/homeplots.mjs')
  const T = await import('../src/tidy.mjs'); const P = await import('../src/planahead.mjs'); const G = await import('../src/glass.mjs')
  const cot = l => l.filter(p => /^cottage\d+$/.test(p.plot)).map(p => [p.plot, p.after, p.blueprint, p.builders])
  const st = (plot, exists, complete = false) => ({ plot, exists, complete, damaged: false })
  const done = n => [st('shop', true, true), st('enchantshop', true, true), ...C.COTTAGE_PLOTS.slice(0, n).map(p => st(p, true, true))]
  const PP = S.PROJECTS.filter(p => p.plot === 'shop' || C.isCottagePlot(p.plot))
  const waitingFrom = n => C.COTTAGE_PLOTS.slice(n).map(p => ({ plot: p, exists: false, complete: false, damaged: false, waiting: true }))
  console.log('\nJSON ' + JSON.stringify({
    on: H.HOMEPLOTS.on, sw: H.HOMEPLOTS.sw, layout: H.HOMEPLOTS.layout.length, plots: [...C.COTTAGE_PLOTS],
    projects: cot(S.PROJECTS), on_: S.projectsOn().map(p => p.plot), guarded: S.projectsGuarded().map(p => p.plot),
    after3: S.activeProject(done(3), PP, { noWait: false })?.plot ?? null, after7: S.activeProject(done(7), PP, { noWait: false })?.plot ?? null,
    // the rollback's two cases, as the status pass reports them: cottage4 SITED and open; cottage4 never sited (held: it waits)
    sited4: S.activeProject([...done(3), st('cottage4', true, false), ...waitingFrom(4)], PP, { noWait: false })?.plot ?? null,
    never4: S.activeProject([...done(3), ...waitingFrom(3)], PP, { noWait: false })?.plot ?? null,
    held: ['cottage1', 'cottage3', 'cottage4', 'cottage8'].map(p => H.laterHomeHeld(p)),
    claim: [...T.CLAIM_PLOTS], stand: [...P.STAND_PLOTS], glass: [...G.GLASS_PLOTS], isC5: C.isCottagePlot('cottage5'), mode: H.homePlotsModeDetail(),
  }))
  process.exit(0)
}
if (process.env.HOMEPLOTS_CHILD === 'town') {
  const dir = process.env.POOL_STATE_DIR
  const PJ = await import('../src/buildproj.mjs'); const LP = await import('../src/landplan.mjs')
  const key = plot => PJ.projKey(HOME0, plot)
  const pub = (plot, rec) => PJ.publishRecord(dir, key(plot), () => rec, { by: 't' })
  // the extension: a hall plot and three house plots, far east; the land plan: one road corridor through H7's drawn box (x 30..31)
  pub('wallext', { v: 1, plot: 'wallext', blueprint: 'wallext@1', zones: [], cells: [], structure_complete: true, plots: [{ id: 'X1', kind: 'hall', box: [40, 40, 58, 52] }, { id: 'X3', kind: 'house', box: [60, 40, 70, 50] }, { id: 'X4', kind: 'house', box: [60, 54, 70, 64] }, { id: 'X5', kind: 'house', box: [74, 40, 84, 50] }] })
  pub('land', { v: 1, plot: 'land', blueprint: LP.LAND_BLUEPRINT, home: HOME0, corridors: [{ box: [30, -64, -50, 31, 320, -30], why: 'land:road' }], roads: [], cells: [], structure_complete: true })
  pub('cottage1', { v: 1, plot: 'cottage1', blueprint: 'cottage@1s', plotId: 'X3', box: [62, 42, 68, 48], cells: [], structure_complete: true })
  const SK = await import('../src/skills.mjs')
  const HP = SK._homePlots
  const ext = PJ.recordHead(dir, key('wallext')).head.rec, land = PJ.recordHead(dir, key('land')).head.rec
  const landZones = () => SK.scafTownRecords().find(r => r.plot === 'land')?.zones ?? null
  const slim = o => ({ plots: o.plots.map(p => ({ id: p.id, box: p.box, shift: p.shift ?? null, why: p.why ?? null })), skipped: o.skipped, why: o.why })
  const out = { on: (await import('../src/homeplots.mjs')).HOMEPLOTS.on }
  out.house = HP.housePlotsNow(dir, 'cottage2')
  out.houseIsExt = JSON.stringify(out.house) === JSON.stringify(ext)
  out.landZones = landZones()
  out.landAsBefore = JSON.stringify(out.landZones) === JSON.stringify(LP.landReservation(land, ext).zones)
  out.open2 = HP.cottageOpenNow(dir, 'cottage2')
  out.open4 = HP.cottageOpenNow(dir, 'cottage4')   // a later home, never sited: opened only with the switch on
  out.site4 = out.on ? null : (await HP.cottageSiteFor({}, {}, {}, [], null, 'cottage4')).why   // ...and never sited with it off (answered before any read)
  if (out.on) {
    out.offer = slim(HP.homeOfferNow(dir, 'cottage2'))
    HP.homeFailNote(dir, 'H1', 'no_proven_site', 'cottage2', 'showcase-Alpha')
    out.fails = HP.homeFails(dir)
    out.afterFail = HP.housePlotsNow(dir, 'cottage2').plots.map(p => p.id)
    // cottage2 is sited on H2 (its pad): H2 is no longer free for cottage3, and its reservation is the record's, not the plan's
    pub('cottage2', { v: 1, plot: 'cottage2', blueprint: 'cottage@2-Csg0-', plotId: 'H2', box: [14, 12, 20, 18], cells: [], structure_complete: false })
    out.offer3 = slim(HP.homeOfferNow(dir, 'cottage3'))
    out.landZones3 = landZones()
    // the land plan moves (a generation without the corridor): the plots are placed again -- H7 is back where it is drawn
    PJ.publishRecord(dir, key('land'), cur => ({ ...cur, corridors: [] }), { by: 't' })
    out.landZones4 = landZones()
  }
  console.log('\nJSON ' + JSON.stringify(out))
  process.exit(0)
}
if (process.env.HOMEPLOTS_CHILD === 'pass') {
  // THE ORDER'S STATUS PASS over the town's own files (skills.mjs shopActive): what it reads, and the rollback's sequence
  const dir = process.env.POOL_STATE_DIR
  const PJ = await import('../src/buildproj.mjs'); const LP = await import('../src/landplan.mjs')
  const key = plot => PJ.projKey(HOME0, plot)
  const pub = (plot, rec) => PJ.publishRecord(dir, key(plot), () => rec, { by: 't' })
  pub('wallext', { v: 1, plot: 'wallext', blueprint: 'wallext@1', zones: [], cells: [], structure_complete: true, plots: [{ id: 'X1', kind: 'hall', box: [40, 40, 58, 52] }, { id: 'X3', kind: 'house', box: [60, 40, 70, 50] }, { id: 'X4', kind: 'house', box: [60, 54, 70, 64] }, { id: 'X5', kind: 'house', box: [74, 40, 84, 50] }] })
  pub('land', { v: 1, plot: 'land', blueprint: LP.LAND_BLUEPRINT, home: HOME0, corridors: [], roads: [], cells: [], structure_complete: true })
  pub('enchantshop', { v: 1, plot: 'enchantshop', blueprint: 'enchantshop@1', box: [42, 42, 56, 50], cells: [], structure_complete: true })
  pub('cottage1', { v: 1, plot: 'cottage1', blueprint: 'cottage@1s', plotId: 'X3', box: [62, 42, 68, 48], cells: [], structure_complete: true })
  const SK = await import('../src/skills.mjs'); const S = await import('../src/shop.mjs'); const C = await import('../src/cottage.mjs'); const RR = await import('../src/reroof.mjs')
  const walks = fn => { const w0 = PJ.recStats.walks; fn(); return PJ.recStats.walks - w0 }   // recordHead calls (buildproj.mjs recWalk: one a call)
  const cots = () => (SK.shopActiveStates() ?? []).filter(s => C.isCottagePlot(s.plot)).map(s => ({ plot: s.plot, exists: !!s.exists, complete: !!s.complete, damaged: false, waiting: s.waiting === true }))
  const pass = () => { SK.shopActiveForget(); const n = walks(() => SK.shopActive(null, Date.now())); return { n, cots: cots() } }
  const PP = S.PROJECTS.filter(p => C.isCottagePlot(p.plot))
  const active = st => S.activeProject(st, PP, { noWait: true })?.plot ?? null
  const reroof = () => RR.reroofNext(Object.fromEntries(SK.scafTownRecords().filter(r => r?.plot).map(r => [r.plot, r])), { logs: 999 }).why
  const out = { on: (await import('../src/homeplots.mjs')).HOMEPLOTS.on, projects: S.projectsOn().length, cottages: PP.length }
  // A. cottage1 stands; every later cottage unsited
  out.A = pass()
  out.heads = walks(() => SK.scafTownRecords())                      // ONE read of the town's records (projectHeads)
  const ent = plot => S.PROJECTS.find(p => p.plot === plot)
  out.w5 = walks(() => { out.st5 = SK.shopActive(null, Date.now(), { stateOf: ent('cottage5'), before: [{ plot: 'cottage4', exists: false, complete: false }] }) })
  out.w2 = walks(() => { out.st2 = SK.shopActive(null, Date.now(), { stateOf: ent('cottage2'), before: [{ plot: 'cottage1', exists: true, complete: true }] }) })
  out.w5alone = walks(() => SK.shopActive(null, Date.now(), { stateOf: ent('cottage5') }))   // its predecessor unknown: read as before
  // B. cottage2 and cottage3 stand too: cottage4 is next -- NEVER SITED
  pub('cottage2', { v: 1, plot: 'cottage2', blueprint: 'cottage@2-Csg0-', plotId: 'X4', box: [62, 56, 68, 62], cells: [], structure_complete: true })
  pub('cottage3', { v: 1, plot: 'cottage3', blueprint: 'cottage@2-Csg0-', plotId: 'X5', box: [76, 42, 82, 48], cells: [], structure_complete: true })
  out.B = pass(); out.activeB = active(out.B.cots); out.reroofB = reroof()
  // C. cottage4 SITED on a layout plot (while the switch was on) and still open: a styled record
  pub('cottage4', { v: 1, plot: 'cottage4', blueprint: 'cottage@2-Csg0-', plotId: 'H3', box: [-35, -60, -29, -54], cells: [], style: { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }, structure_complete: false })
  out.C = pass(); out.activeC = active(out.C.cots); out.reroofC = reroof()
  // D. ...and finished
  PJ.publishRecord(dir, key('cottage4'), cur => ({ ...cur, structure_complete: true }), { by: 't' })
  out.D = pass(); out.activeD = active(out.D.cots); out.reroofD = reroof()
  console.log('\nJSON ' + JSON.stringify(out))
  process.exit(0)
}

// ---- THE TEST -----------------------------------------------------------------------------------------------------------------
const F = await import('./helpers/buildfake.mjs')
const { B } = F
const C = await import('../src/cottage.mjs')
const H = await import('../src/homeplots.mjs')
const S = await import('../src/shop.mjs')
const HP_PATH = new URL('../src/homeplots.mjs', import.meta.url)
const SK_SRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** A mutant of homeplots.mjs: its anchor present and unique (asserted BEFORE the mutant is written or run), imported from this directory. */
async function mutantOf (old, neu) {
  const src = readFileSync(HP_PATH, 'utf8')
  assert.strictEqual(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-homeplots-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await import(out.href) } finally { try { unlinkSync(out) } catch { /* gone */ } }
}
const childMemo = new Map()
const child = (mode, env) => {
  const k = mode === 'lists' || mode === 'pass' ? `${mode}|${JSON.stringify(env)}` : null   // the lists and the pass: one child an env
  if (k && childMemo.has(k)) return childMemo.get(k)
  const r = childRun(mode, env)
  if (k) childMemo.set(k, r)
  return r
}
const childRun = (mode, env) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'homeplots-'))
  const e = { ...process.env, HOMEPLOTS_CHILD: mode, POOL_STATE_DIR: path.join(tmp, 'pool'), LOG_DIR: tmp, STATE_DIR: tmp, ...env }
  for (const k of ['HOMEPLOTS', 'HOMEPLOTS_POOLS', 'HOME_X', 'HOME_Y', 'HOME_Z', 'COTTAGE', 'COTTAGE2', 'MEMORY_POOL']) if (!(k in env)) delete e[k]
  fs.mkdirSync(e.POOL_STATE_DIR, { recursive: true })
  const txt = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
  const line = txt.split('\n').filter(l => l.startsWith('JSON ')).pop()
  assert.ok(line, `the child answered: ${txt.slice(-300)}`)
  return JSON.parse(line.slice(5))
}
const DATA = H.readTownLayout()
const PADS = [[13, -20, 19, -14], [14, 12, 20, 18], [-35, -60, -29, -54], [-34, -85, -28, -79], [-23, -84, -17, -78], [-24, -60, -18, -54], [24, -44, 30, -38], [-24, -22, -18, -16]]
const LAYOUT = H.layoutPlotsOf(DATA, 'showcase', HOME0)
const zone = (b, why, id) => ({ box: [b[0], -64, b[1], b[2], 320, b[3]], why, ...(id ? { id } : {}) })
const meets = (b, q) => b[0] <= q[2] && b[2] >= q[0] && b[1] <= q[3] && b[3] >= q[1]
/** A flat world with no edge (the layout's far plots lie beyond the fake server's 60 blocks). */
const flat = (x, y, z) => { if (y < F.G - 20 || y > F.G + 40) return null; const n = y < F.G ? 'stone' : y === F.G ? 'grass_block' : 'air'; return { name: n, boundingBox: n === 'air' ? 'empty' : 'block' } }
const STYLE = { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }
/** The real siting of one blueprint on one plot (what skills.mjs cottageSiteOn gives siteBlueprint for the plot). */
const siteOn = (read, plot, id, zones = [], plan = { ...F.plan(), plots: [] }) => {
  const sp = C.cottageSitingPlan(F.HOME, plot, zones)
  const bp = C.styledBlueprint(B.loadBlueprint(id), STYLE)
  return { bp, sp, s: B.siteBlueprint(read, plan, bp, { zones: sp.zones, stood: [], sectors: sp.sectors, plot: 'cottage2', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, tries: 3 }) }
}

console.log('1. THE LAYOUT AS DATA')
await t('townlayout.json: the showcase entry is the eight approved 7 x 7 pads at home 0,70,0; each plot is its pad widened by 2 (11 x 11)', () => {
  assert.deepStrictEqual(DATA.pools.showcase.home, HOME0)
  assert.deepStrictEqual(DATA.pools.showcase.homes, PADS)
  assert.strictEqual(LAYOUT.length, 8)
  assert.deepStrictEqual(LAYOUT.map(p => p.id), ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'])
  for (const [i, p] of LAYOUT.entries()) {
    assert.deepStrictEqual(p.pad, PADS[i]); assert.strictEqual(p.kind, 'house'); assert.strictEqual(p.layout, true)
    assert.deepStrictEqual(p.box, [PADS[i][0] - 2, PADS[i][1] - 2, PADS[i][2] + 2, PADS[i][3] + 2])
    assert.deepStrictEqual([p.pad[2] - p.pad[0] + 1, p.pad[3] - p.pad[1] + 1], [7, 7], 'the approved pad is 7 x 7')
    assert.strictEqual(C.cottageOpening({ plots: [p] }).open, true, `${p.id}: the cottage opens on it (at least 9 x 9)`)
  }
  for (const a of LAYOUT) for (const b of LAYOUT) if (a !== b) assert.ok(!meets(a.box, b.box), `${a.id} and ${b.id} do not overlap as drawn`)
  assert.strictEqual(H.HOMEPLOT.widens[0], 2)
})
await t('the pool and the home are checked (townsectors.json\'s rule): another pool, a re-homed pool, no file, a bad box -> no plots', () => {
  assert.deepStrictEqual(H.layoutPlotsOf(DATA, 'hive-a', HOME0), [], 'a pool with no entry')
  assert.deepStrictEqual(H.layoutPlotsOf(DATA, 'showcase', { x: 0, y: 71, z: 0 }), [], 'the home moved')
  assert.deepStrictEqual(H.layoutPlotsOf(DATA, 'showcase', { x: 5, y: 70, z: 0 }), [])
  assert.deepStrictEqual(H.layoutPlotsOf(null, 'showcase', HOME0), [])
  assert.deepStrictEqual(H.layoutPlotsOf(DATA, 'showcase', null), [])
  const bad = { pools: { p: { home: HOME0, homes: [[0, 0, 6, 6], [5, 5, 1, 1], 'x', [1.5, 0, 7, 6], [20, 20, 26, 26]] } } }
  assert.deepStrictEqual(H.layoutPlotsOf(bad, 'p', HOME0).map(p => p.id), ['H1', 'H5'], 'a bad box is left out; the ids are the file\'s positions')
  assert.strictEqual(H.readTownLayout(new URL('./no-such-layout.json', import.meta.url)), null, 'a missing file is no layout, never a throw')
  assert.strictEqual(LAYOUT.length, 8, 'POSITIVE CONTROL: the same reader finds the showcase\'s eight')
})
await t('the switch: HOMEPLOTS=on|off; unset = on only in HOMEPLOTS_POOLS (default showcase); `on` at load needs a layout too', () => {
  assert.deepStrictEqual(H.homePlotsSwitches({}, 'showcase'), { on: true })
  assert.deepStrictEqual(H.homePlotsSwitches({}, 'hive-a'), { on: false })
  assert.deepStrictEqual(H.homePlotsSwitches({ HOMEPLOTS: 'off' }, 'showcase'), { on: false })
  assert.deepStrictEqual(H.homePlotsSwitches({ HOMEPLOTS: 'on' }, 'hive-a'), { on: true })
  assert.deepStrictEqual(H.homePlotsSwitches({ HOMEPLOTS_POOLS: 'hive-a' }, 'showcase'), { on: false })
  const at = env => { const h = H.homePlotsAtLoad(env, DATA); return [h.sw, h.on, h.layout.length] }
  assert.deepStrictEqual(at({ MEMORY_POOL: 'showcase' }), [true, true, 8])
  assert.deepStrictEqual(at({ MEMORY_POOL: 'showcase', HOMEPLOTS: 'off' }), [false, false, 8], 'off: the layout is still known (the guard\'s names)')
  assert.deepStrictEqual(at({ MEMORY_POOL: 'showcase', HOME_X: '12' }), [true, false, 0], 'a re-homed showcase has no layout: as before')
  assert.deepStrictEqual(at({ MEMORY_POOL: 'hive-a', HOMEPLOTS: 'on' }), [true, false, 0], 'on with no entry: as before')
  assert.deepStrictEqual(at({}), [false, false, 0])
})

console.log('2. THE OFFER: THE LAYOUT\'S PLOTS FIRST, THEN THE EXTENSION\'S HOUSE PLOTS')
const EXT = { plots: [{ id: 'X1', kind: 'hall', box: [40, 40, 58, 52] }, { id: 'X3', kind: 'house', box: [60, 40, 70, 50] }, { id: 'X4', kind: 'house', box: [60, 54, 70, 64] }, { id: 'X5', kind: 'house', box: [74, 40, 84, 50] }] }
const RES = H.resolveHomePlots(LAYOUT, [], { home: HOME0 })
await t('the order: H1..H8, then X3, X4, X5 as cottagePlotOf gave them; a hall plot is never a house plot; cottagePlotOf takes the first', () => {
  const o = H.houseOffer({ layout: RES, ext: EXT, now: 1e9 })
  assert.deepStrictEqual(o.plots.map(p => p.id), ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'X3', 'X4', 'X5'])
  assert.strictEqual(o.why, 'ok')
  assert.strictEqual(C.cottagePlotOf({ plots: o.plots }).id, 'H1')
  assert.strictEqual(C.cottageOpening({ plots: o.plots }).plot.id, 'H1')
  assert.deepStrictEqual(H.houseOffer({ layout: [], ext: EXT, now: 1e9 }).plots.map(p => p.id), ['X3', 'X4', 'X5'], 'no layout: the extension\'s, in its order')
  assert.strictEqual(H.houseOffer({ layout: [], ext: null }).why, 'no_extension')
  assert.strictEqual(H.houseOffer({ layout: [], ext: { plots: [EXT.plots[0]] } }).why, 'no_house_plot')
  assert.strictEqual(H.houseOffer({ layout: RES, ext: null, now: 1e9 }).plots.length, 8, 'the layout alone opens a cottage (no extension needed)')
})
await t('NOT FREE: a plot another record holds, a plot under 9 on a side (each named); the rest still offered', () => {
  const small = { id: 'X9', kind: 'house', box: [0, 0, 7, 7] }
  const o = H.houseOffer({ layout: RES, ext: { plots: [...EXT.plots, small] }, taken: ['X3', 'H2'], now: 1e9 })
  assert.deepStrictEqual(o.plots.map(p => p.id), ['H1', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'X4', 'X5'])
  assert.deepStrictEqual(o.skipped, [{ id: 'H2', why: 'taken' }, { id: 'X3', why: 'taken' }, { id: 'X9', why: 'plot_8x8' }])
  const all = H.houseOffer({ layout: RES, ext: EXT, taken: [...RES.map(p => p.id), 'X3', 'X4', 'X5'], now: 1e9 })
  assert.deepStrictEqual([all.plots.length, all.why], [0, 'no_house_plot'], 'every plot taken: the project WAITS (plot_wait), the order moves on')
})
await t('MUTANT the taken test dropped: a plot another cottage holds is offered again', async () => {
  const M = await mutantOf("    if (held.has(String(p.id))) { skipped.push({ id: p.id, why: 'taken' }); continue }\n", '')
  assert.ok(M.houseOffer({ layout: RES, ext: EXT, taken: ['H1'], now: 1e9 }).plots.some(p => p.id === 'H1'), 'the mutant offers the taken plot')
  assert.ok(!H.houseOffer({ layout: RES, ext: EXT, taken: ['H1'], now: 1e9 }).plots.some(p => p.id === 'H1'), 'the real offer does not')
})
await t('MUTANT the extension\'s plots put first: the layout is no longer offered first', async () => {
  const M = await mutantOf('  for (const p of ext?.plots ?? []) if (p?.kind === HOMEPLOT.kind && okBox(p.box)) cands.push(p)', '  for (const p of ext?.plots ?? []) if (p?.kind === HOMEPLOT.kind && okBox(p.box)) cands.unshift(p)')
  assert.notStrictEqual(M.houseOffer({ layout: RES, ext: EXT, now: 1e9 }).plots[0].id, 'H1')
  assert.strictEqual(H.houseOffer({ layout: RES, ext: EXT, now: 1e9 }).plots[0].id, 'H1')
})

console.log('3. THE ROTATION')
const P3 = [{ id: 'A', box: [0, 0, 10, 10] }, { id: 'B', box: [20, 0, 30, 10] }, { id: 'C', box: [40, 0, 50, 10] }]
const ids = l => l.map(p => p.id).join('')
await t('a failed plot goes behind the others; every plot failed: the OLDEST failure first; nothing is ever dropped', () => {
  const now = 100 * 3_600_000
  assert.strictEqual(ids(H.rotatePlots(P3, {}, now)), 'ABC')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: now - 60_000 } }, now)), 'BCA', 'the next attempt takes the NEXT plot')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: now - 120_000 }, B: { at: now - 60_000 } }, now)), 'CAB')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: now - 180_000 }, B: { at: now - 120_000 }, C: { at: now - 60_000 } }, now)), 'ABC', 'all failed: back to the first, the oldest')
  assert.strictEqual(ids(H.rotatePlots(P3, { B: { at: now - 180_000 }, A: { at: now - 120_000 }, C: { at: now - 60_000 } }, now)), 'BAC')
  for (const f of [{}, { A: { at: now } }, { A: { at: now }, B: { at: now }, C: { at: now } }]) assert.strictEqual(H.rotatePlots(P3, f, now).length, 3, 'never a dead end: a failed plot is moved, not removed')
})
await t('the return BY TIME: after retryMs (6 h: over one full rotation of ten plots at the 30-min wait) a failed plot is back in its place', () => {
  const now = 100 * 3_600_000
  assert.strictEqual(H.HOMEPLOT.retryMs, 6 * 3_600_000)
  assert.ok(H.HOMEPLOT.retryMs > 10 * 30 * 60_000, 'longer than every other plot\'s turn')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: now - H.HOMEPLOT.retryMs + 1 } }, now)), 'BCA', 'inside the wait: still last')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: now - H.HOMEPLOT.retryMs } }, now)), 'ABC', 'the wait over: first again')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: now + 3_600_000 } }, now)), 'ABC', 'a stamp from the future never benches a plot')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: 'x' }, B: null }, now)), 'ABC', 'an unreadable entry is no failure')
})
await t('the memory: a failure is noted with its reason, project and bot; a second counts; entries past the wait are dropped', () => {
  const now = 100 * 3_600_000
  const f1 = H.failNoted({}, 'H1', { why: 'no_proven_site', project: 'cottage2', by: 'showcase-Alpha', now })
  assert.deepStrictEqual(f1, { H1: { at: now, why: 'no_proven_site', n: 1, project: 'cottage2', by: 'showcase-Alpha' } })
  const f2 = H.failNoted(f1, 'H1', { why: 'no_site', project: 'cottage2', by: 'b', now: now + 1000 })
  assert.deepStrictEqual([f2.H1.n, f2.H1.why, f2.H1.at], [2, 'no_site', now + 1000])
  const f3 = H.failNoted(f2, 'H2', { why: 'no_site', now: now + H.HOMEPLOT.retryMs + 2000 })
  assert.deepStrictEqual(Object.keys(f3), ['H2'], 'H1\'s failure is older than the wait: forgotten')
  assert.strictEqual(f1.H1.n, 1, 'the memory given is never changed')
  const o = H.houseOffer({ layout: RES, ext: EXT, fails: f1, now: now + 60_000 })
  assert.deepStrictEqual([o.plots[0].id, o.plots.at(-1).id, o.plots.length], ['H2', 'H1', 11], 'the offer reads it: H1 behind the extension\'s plots too')
})
await t('MUTANT the rotation dropped (the plots in the order given): the failed plot is first again -- the live bug', async () => {
  const M = await mutantOf('  return [...fresh, ...failed]\n', '  return plots\n')
  const now = 100 * 3_600_000
  assert.strictEqual(ids(M.rotatePlots(P3, { A: { at: now - 60_000 } }, now)), 'ABC', 'the mutant comes back to the failed plot')
  assert.strictEqual(ids(H.rotatePlots(P3, { A: { at: now - 60_000 } }, now)), 'BCA')
})

console.log('4. THE PLOTS AMONG THE TOWN\'S RESERVATIONS: THE SHIFT, THE SKIP, A TAKEN PLOT')
const H7 = LAYOUT.find(p => p.id === 'H7')   // drawn 22,-46 .. 32,-36 (the east quarter, where the unfinished ring road runs)
const at = (res, id) => res.find(p => p.id === id)
await t('the offsets: 80 of them within 4, nearest first, deterministic (z before x, the negative first), never [0,0]', () => {
  const o = H.shiftOffsets(4)
  assert.strictEqual(o.length, 80)
  assert.deepStrictEqual(o.slice(0, 8), [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
  for (let i = 1; i < o.length; i++) assert.ok(o[i][0] ** 2 + o[i][1] ** 2 >= o[i - 1][0] ** 2 + o[i - 1][1] ** 2, 'never nearer than the one before')
  assert.ok(o.every(([dx, dz]) => Math.abs(dx) <= 4 && Math.abs(dz) <= 4 && (dx || dz)))
  assert.deepStrictEqual(H.shiftOffsets(4), o)
})
await t('a road corridor through the plot\'s east edge: SHIFTED west by the least that clears it (3), the pad with it; the same answer every time', () => {
  const road = zone([30, -50, 31, -30], 'land:road')
  const r = H.resolveHomePlots(LAYOUT, [road], { home: HOME0 })
  const p = at(r, 'H7')
  assert.deepStrictEqual([p.shift, p.why, p.box, p.pad], [[-3, 0], 'road', [19, -46, 29, -36], [21, -44, 27, -38]])
  assert.ok(!meets(p.box, [30, -50, 31, -30]), 'clear of the corridor')
  assert.deepStrictEqual(H.resolveHomePlots(LAYOUT, [road], { home: HOME0 }), r, 'deterministic')
  assert.deepStrictEqual(at(H.resolveHomePlots(LAYOUT, [], { home: HOME0 }), 'H7').shift, [0, 0], 'POSITIVE CONTROL: with no corridor it stays as drawn')
  assert.deepStrictEqual(r.filter(q => !['H7', 'H1'].includes(q.id)).map(q => q.shift), [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], 'the other plots are not moved by it')
})
await t('the shift clears EVERY reservation: a second zone where the nearest offset would land sends it to the next', () => {
  const road = zone([30, -50, 31, -30], 'land:road'), yard = zone([10, -45, 18, -40], 'project:yard')   // west of H7: 19.. is the last free column
  const p = at(H.resolveHomePlots(LAYOUT, [road, yard], { home: HOME0 }), 'H7')
  assert.deepStrictEqual(p.shift, [-3, 0], 'x 19..29 fits exactly between them')
  const tight = at(H.resolveHomePlots(LAYOUT, [road, zone([10, -45, 19, -40], 'project:yard')], { home: HOME0 }), 'H7')
  assert.ok(!tight.skip && (tight.box[2] - tight.box[0] + 1) === 9, `one column less: the 11 x 11 fits nowhere, the 9 x 9 does (${JSON.stringify(tight.box)})`)
  for (const z of [[30, -50, 31, -30], [10, -45, 19, -40]]) assert.ok(!meets(tight.box, z))
  assert.strictEqual(C.cottageOpening({ plots: [tight] }).open, true, 'and a cottage still opens on it')
})
await t('a 3-wide corridor through the middle of the plot (no offset within 4 clears it, at 11 x 11 or 9 x 9): SKIPPED `road_no_shift` (named), never offered, never reserved', () => {
  const through = [zone([26, -60, 28, -20], 'land:road')]
  const r = H.resolveHomePlots(LAYOUT, through, { home: HOME0 })
  assert.deepStrictEqual(at(H.resolveHomePlots(LAYOUT, [zone([26, -60, 26, -20], 'land:road')], { home: HOME0 }), 'H7').shift.map(Math.abs), [4, 0], 'POSITIVE CONTROL: a 1-wide one IS cleared, at the limit of 4')
  assert.strictEqual(at(r, 'H7').skip, 'road_no_shift')
  const o = H.houseOffer({ layout: r, ext: null, now: 1e9 })
  assert.ok(!o.plots.some(p => p.id === 'H7')); assert.deepStrictEqual(o.skipped.find(k => k.id === 'H7'), { id: 'H7', why: 'road_no_shift' })
  assert.ok(!H.homePlotZones(r).some(z => z.id === 'H7'))
  assert.strictEqual(o.plots.length, 7, 'the seven other plots are still offered: the remedy is the next plot')
})
await t('A TAKEN PLOT: a cottage\'s record on it (its zone, pad + 3) is cleared by no shift -> `blocked:project:cottage2`, not offered', () => {
  const rec = { plot: 'cottage2', box: [14, 12, 20, 18] }   // on H2's pad
  const r = H.resolveHomePlots(LAYOUT, S.recordZones([rec]), { home: HOME0 })
  assert.strictEqual(at(r, 'H2').skip, 'blocked:project:cottage2')
  assert.ok(!H.houseOffer({ layout: r, ext: null, now: 1e9 }).plots.some(p => p.id === 'H2'))
  assert.strictEqual(H.houseOffer({ layout: r, ext: null, now: 1e9 }).plots.length, 7)
  // a NEIGHBOUR's record that only clips the box moves the plot instead (H3's cottage beside H6: its zone reaches into H6's box)
  const n = H.resolveHomePlots(LAYOUT, S.recordZones([{ plot: 'cottage3', box: [-34, -60, -28, -54] }]), { home: HOME0 })
  assert.strictEqual(at(n, 'H3').skip, 'blocked:project:cottage3')
  assert.deepStrictEqual([at(n, 'H6').shift, at(n, 'H6').why, at(n, 'H6').box], [[2, 0], 'project:cottage3', [-24, -62, -14, -52]], 'H6 moves two east (clear of the zone at x -25), still a full 11 x 11 plot')
})
await t('the layout\'s OWN reservation never counts against it; a sibling is never landed on; the zones are the placed plots\' (`land:plot`, id)', () => {
  const own = H.homePlotZones(RES)
  assert.strictEqual(own.length, 8)
  assert.deepStrictEqual(own[1], { box: [12, -64, 10, 22, 320, 20], why: 'land:plot', id: 'H2' })
  assert.deepStrictEqual(H.resolveHomePlots(LAYOUT, own, { home: HOME0 }), RES, 'read back through projectHeads, the answer is the same')
  // a road that pushes H3 east: it stops short of H6 (a later plot, as drawn) -- no offset lands on a sibling
  const r = H.resolveHomePlots(LAYOUT, [zone([-40, -70, -37, -40], 'land:road')], { home: HOME0 })
  const h3 = at(r, 'H3'), h6 = at(r, 'H6')
  assert.ok(!h3.skip && !meets(h3.box, h6.box) && !meets(h3.box, [-40, -70, -37, -40]), JSON.stringify([h3.box, h6.box]))
  // the cottage that takes a plot drops that plot's zone and only that one (cottage.mjs cottageSitingPlan)
  const sp = C.cottageSitingPlan(HOME0, RES[1], own)
  assert.deepStrictEqual(sp.zones.map(z => z.id), ['H1', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'])
})
await t('MUTANT the shift disabled (no offset accepted): the plot on the corridor is skipped instead of moved', async () => {
  const M = await mutantOf('        if (!clear(b) || !faces(b)) continue\n', '        if (dx || dz || !clear(b) || !faces(b)) continue\n')
  const road = zone([30, -50, 31, -30], 'land:road')
  assert.strictEqual(at(M.resolveHomePlots(LAYOUT, [road], { home: HOME0 }), 'H7').skip, 'road_no_shift')
  assert.deepStrictEqual(at(H.resolveHomePlots(LAYOUT, [road], { home: HOME0 }), 'H7').shift, [-3, 0])
})

console.log('5. THE DOOR RULE (buildsite.mjs facesHome), CHECKED AGAINST THE REAL SITING')
await t('homeFacing(box) is exactly "the real siting finds a square cottage a site in the box on flat ground" (9 x 9 and 11 x 11 boxes round home)', () => {
  let yes = 0, no = 0
  for (const side of [9, 11]) {
    for (const [x0, z0] of [[12, -21], [13, 11], [-36, -61], [22, -45], [-25, -23], [14, 14], [-20, -19], [18, -17], [-30, 29], [15, -13], [-13, -13], [25, 2], [-4, 24]]) {
      const box = [x0, z0, x0 + side - 1, z0 + side - 1]
      const want = H.homeFacing(box, HOME0)
      const { s } = siteOn(flat, { id: 'T', box }, 'cottage@1s')
      assert.strictEqual(s.ok, want, `${JSON.stringify(box)}: homeFacing ${want}, the siting ${s.ok ? 'sited' : s.why + ' ' + JSON.stringify(s.sectors?.[0]?.rejects?.door_not_toward_home ?? 0)}`)
      if (want) yes++; else no++
    }
  }
  assert.ok(yes >= 8 && no >= 5, `both answers are exercised (${yes} yes, ${no} no)`)
})
await t('MEASURED: at 9 x 9 three of the eight showcase plots (H1, H2, H8) take no cottage on any ground; placed by the resolver, all eight do', () => {
  const nine = H.layoutPlotsOf(DATA, 'showcase', HOME0, { widen: 1 })
  assert.deepStrictEqual(nine.filter(p => !H.homeFacing(p.box, HOME0)).map(p => p.id), ['H1', 'H2', 'H8'])
  assert.deepStrictEqual(LAYOUT.filter(p => !H.homeFacing(p.box, HOME0)).map(p => p.id), ['H1'], 'at 11 x 11 only H1 is left')
  assert.deepStrictEqual([at(RES, 'H1').shift, at(RES, 'H1').why, at(RES, 'H1').box], [[0, -1], 'door', [11, -23, 21, -13]], 'H1 moves one block north')
  assert.deepStrictEqual(RES.filter(p => p.id !== 'H1').map(p => p.shift.join()), Array(7).fill('0,0'))
  for (const p of RES) {
    assert.ok(!p.skip)
    for (const id of ['cottage@1s', 'cottage@2-Csl0c', 'cottage@2-Cfl0-']) { const { s } = siteOn(flat, p, id); assert.ok(s.ok, `${p.id} takes ${id} on flat ground: ${s.why}`) }
  }
  // the long bodies need the 11 x 11: none fits a 9 x 9 plot, on any of the eight
  for (const p of nine) for (const id of ['cottage@2-Lsg0-', 'cottage@2-Lfl0-']) assert.strictEqual(siteOn(flat, p, id).s.ok, false, `${p.id} 9 x 9 ${id}`)
  assert.ok(RES.filter(p => siteOn(flat, p, 'cottage@2-Lsg0-').s.ok).length >= 6, 'POSITIVE CONTROL: on the 11 x 11 plots the long body sites')
})
await t('MUTANT the door rule dropped from the resolver: H1 stays as drawn, and the REAL siting finds no site on it', async () => {
  const M = await mutantOf('    const faces = b => !home || homeFacing(b, home)\n', '    const faces = () => true\n')
  const h1 = at(M.resolveHomePlots(LAYOUT, [], { home: HOME0 }), 'H1')
  assert.deepStrictEqual(h1.shift, [0, 0])
  const { s } = siteOn(flat, h1, 'cottage@1s')
  assert.strictEqual(s.ok, false); assert.ok(s.sectors[0].rejects.door_not_toward_home > 0, JSON.stringify(s.sectors[0].rejects))
  assert.ok(siteOn(flat, at(RES, 'H1'), 'cottage@1s').s.ok, 'the real resolver\'s H1 is sited')
})

console.log('6. THE CHAIN: THE REAL COTTAGE SITING OVER TWO PLOTS, THE FIRST UNSITEABLE')
// two homes on the fake server (flat, 60 blocks): H1 east of home, H2 west; H1's ground is a pond
const FAKE = { pools: { fake: { home: F.HOME, homes: [[21, -3, 27, 3], [-27, -3, -21, 3]] } } }
const FL = H.resolveHomePlots(H.layoutPlotsOf(FAKE, 'fake', F.HOME), [], { home: F.HOME })
const pond = () => { const srv = F.server(); for (let x = 17; x <= 31; x++) for (let z = -7; z <= 7; z++) srv.set([x, F.G, z], 'water'); return srv }
const STOCK = { spruce_log: 505, oak_log: 76, stone_bricks: 358 }
/** skills.mjs cottageSiteOn's steps on the fake server: the family's ranked looks, each sited by the real planner on the plot. */
const siteOneOn = (srv, zones = [], others = []) => plot => {
  let last = null
  for (const cs of C.cottage2Styles(STOCK, { pool: 'fake', plot: 'cottage2', plotId: plot.id, others })) {
    const sp = C.cottageSitingPlan(F.HOME, plot, zones)
    const bp = C.styledBlueprint(B.loadBlueprint(cs.id), cs.style)
    const s = B.siteBlueprint(srv.read, F.plan(), bp, { zones: sp.zones, stood: [], sectors: sp.sectors, plot: 'cottage2', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, tries: 3 })
    if (!s.ok) { last = { ok: false, why: s.why, rejects: s.sectors?.[0]?.rejects }; continue }
    return { ok: true, why: 'ok', record: C.cottageRecordOf(s.record, bp, cs.style, { plotId: plot.id, walkR: sp.walkR }) }
  }
  return last ?? { ok: false, why: 'no_site' }
}
const visit = async (srv, plots, { left = () => Infinity, M = H, fails = {}, now = Date.now() } = {}) => {
  const rows = []
  let mem = fails
  const r = await M.siteOverPlots(plots, siteOneOn(srv), { left, row: f => rows.push(f), noteFail: (p, why) => { mem = H.failNoted(mem, p.id, { why, project: 'cottage2', by: 'A', now }) } })
  return { r, rows, fails: mem }
}
await t('POSITIVE CONTROL: on dry ground the first plot (H1) is sited -- the pond, not the harness, is what fails it below', async () => {
  assert.deepStrictEqual(FL.map(p => [p.id, p.box, p.shift]), [['H1', [19, -5, 29, 5], [0, 0]], ['H2', [-29, -5, -19, 5], [0, 0]]])
  const { r, rows, fails } = await visit(F.server(), FL)
  assert.ok(r.ok, r.why); assert.strictEqual(r.plotId, 'H1'); assert.strictEqual(r.record.plotId, 'H1')
  assert.deepStrictEqual(rows, [{ op: 'chosen', plot: 'H1' }]); assert.deepStrictEqual(fails, {})
})
await t('H1 is a pond: its siting fails `no_site` (liquid), it is noted, and THE SECOND PLOT IS SITED in the same visit', async () => {
  const one = siteOneOn(pond())(FL[0])
  assert.strictEqual(one.ok, false); assert.strictEqual(one.why, 'no_site'); assert.ok(one.rejects.liquid > 0, `the reason is the water: ${JSON.stringify(one.rejects)}`)
  const { r, rows, fails } = await visit(pond(), FL)
  assert.ok(r.ok, r.why)
  assert.strictEqual(r.plotId, 'H2'); assert.strictEqual(r.record.plotId, 'H2'); assert.strictEqual(r.record.plot, 'cottage2')
  assert.ok(r.record.box[0] >= -29 && r.record.box[2] <= -19 && r.record.box[1] >= -5 && r.record.box[3] <= 5, `the pad is inside H2: ${r.record.box}`)
  assert.ok(C.isCottageBlueprint(r.record.blueprint) && r.record.cells.length > 100, 'a whole cottage record')
  assert.deepStrictEqual(rows, [{ op: 'chosen', plot: 'H1' }, { op: 'failed', plot: 'H1', why: 'no_site' }, { op: 'chosen', plot: 'H2' }])
  assert.deepStrictEqual(Object.keys(fails), ['H1']); assert.strictEqual(fails.H1.why, 'no_site')
})
await t('ONE PLOT A VISIT (the search box spent after the first): visit 1 fails on H1; visit 2 starts at H2 and sites it; H2 is then taken', async () => {
  let n = 0
  const v1 = await visit(pond(), H.houseOffer({ layout: FL }).plots, { left: () => (n++ ? 0 : 1) })
  assert.strictEqual(v1.r.ok, false); assert.strictEqual(v1.r.why, 'no_site')
  assert.deepStrictEqual(v1.rows.map(f => `${f.op}:${f.plot}`), ['chosen:H1', 'failed:H1'], 'H2 was not reached in visit 1')
  const offer2 = H.houseOffer({ layout: FL, fails: v1.fails })
  assert.deepStrictEqual(offer2.plots.map(p => p.id), ['H2', 'H1'], 'the rotation: the next attempt takes the next plot')
  const v2 = await visit(pond(), offer2.plots, { fails: v1.fails })
  assert.ok(v2.r.ok); assert.strictEqual(v2.r.plotId, 'H2'); assert.deepStrictEqual(v2.rows, [{ op: 'chosen', plot: 'H2' }])
  // the next cottage: H2 holds a record (by its id and by its zone); only H1 is left, and it is offered though it failed (never a dead end)
  const rec = { ...v2.r.record, plot: 'cottage2' }
  const o3 = H.houseOffer({ layout: H.resolveHomePlots(H.layoutPlotsOf(FAKE, 'fake', F.HOME), S.recordZones([rec]), { home: F.HOME }), taken: [rec.plotId], fails: v1.fails })
  assert.deepStrictEqual(o3.plots.map(p => p.id), ['H1'])
  assert.strictEqual(o3.skipped.find(k => k.id === 'H2').why, 'blocked:project:cottage2')
})
await t('the TOWN\'s reasons end the visit and mark no plot (aborted, stock_unknown, no_wood, site_taken); a throw is the plot\'s `error`; a spent box tries nothing', async () => {
  for (const why of H.TOWN_WHYS) {
    const rows = [], noted = []
    const r = await H.siteOverPlots(FL, () => ({ ok: false, why }), { row: f => rows.push(f), noteFail: p => noted.push(p.id) })
    assert.strictEqual(r.why, why); assert.deepStrictEqual(noted, []); assert.deepStrictEqual(rows, [{ op: 'chosen', plot: 'H1' }], `${why}: no second plot`)
  }
  const noted = []
  const r = await H.siteOverPlots(FL, p => { if (p.id === 'H1') throw new Error('boom'); return { ok: true, record: {} } }, { noteFail: (p, why) => noted.push([p.id, why]) })
  assert.ok(r.ok); assert.strictEqual(r.plotId, 'H2'); assert.deepStrictEqual(noted, [['H1', 'error']])
  const t0 = []
  const st = await H.siteOverPlots(FL, () => ({ ok: false, why: 'search_time' }), { noteFail: p => t0.push(p.id) })
  assert.strictEqual(st.why, 'search_time'); assert.deepStrictEqual(t0, ['H1'], 'the plot whose search ran out is noted; the visit ends')
  let calls = 0
  assert.strictEqual((await H.siteOverPlots(FL, () => { calls++; return { ok: true } }, { left: () => 0 })).why, 'search_time'); assert.strictEqual(calls, 0)
  // a memory that cannot be written never stops the next plot being tried
  assert.strictEqual((await H.siteOverPlots(FL, p => ({ ok: p.id === 'H2', why: 'no_site' }), { noteFail: () => { throw new Error('disk') } })).plotId, 'H2')
})
await t('a plot placed over ground only the SITING refuses (a protected zone, the hall\'s pad, a marker: the placer reads record zones alone) fails `zone` there and the next plot is sited', async () => {
  // the placer is given no record zone: H1 stays as drawn and reserved; the cottage's own siting is given the protected zone across it
  const prot = [{ box: [17, -64, -7, 31, 320, 7], why: 'protected' }]
  assert.deepStrictEqual(FL[0].shift, [0, 0])
  const one = siteOneOn(F.server(), prot)(FL[0])
  assert.strictEqual(one.ok, false); assert.ok(one.rejects.zone > 0, `refused by the zone: ${JSON.stringify(one.rejects)}`)
  const rows = [], noted = []
  const r = await H.siteOverPlots(FL, siteOneOn(F.server(), prot), { row: f => rows.push(`${f.op}:${f.plot}`), noteFail: (p, why) => noted.push([p.id, why]) })
  assert.ok(r.ok); assert.strictEqual(r.plotId, 'H2'); assert.deepStrictEqual(noted, [['H1', 'no_site']]); assert.deepStrictEqual(rows, ['chosen:H1', 'failed:H1', 'chosen:H2'])
  // while H1 sits reserved it holds its own box and nothing more: the other plot, and the keeper's grading on H1, are untouched
  const zs = H.homePlotZones(FL)
  assert.deepStrictEqual(zs.map(z => [z.id, z.box[0], z.box[2], z.box[3], z.box[5]]), [['H1', 19, -5, 29, 5], ['H2', -29, -5, -19, 5]])
})
await t('MUTANT the visit stops at the first failed plot: with H1 a pond the second plot is never tried and nothing is sited', async () => {
  const M = await mutantOf("    row({ op: 'failed', plot: p.id, why: last.why })\n    if (last.why === 'search_time') return last\n", "    row({ op: 'failed', plot: p.id, why: last.why })\n    return last\n")
  const v = await visit(pond(), FL, { M })
  assert.strictEqual(v.r.ok, false); assert.deepStrictEqual(v.rows.map(f => `${f.op}:${f.plot}`), ['chosen:H1', 'failed:H1'])
  assert.ok((await visit(pond(), FL)).r.ok, 'the real driver sites H2')
})

console.log('7. THE COTTAGE PROJECTS')
await t('the names: three without a layout, one a home with one (eight in the showcase); the ninth look still has a style', () => {
  assert.deepStrictEqual([...H.cottagePlotNames(0)], ['cottage1', 'cottage2', 'cottage3'])
  assert.deepStrictEqual([...H.cottagePlotNames(2)], ['cottage1', 'cottage2', 'cottage3'], 'never fewer than before')
  assert.deepStrictEqual([...H.cottagePlotNames(8)], ['cottage1', 'cottage2', 'cottage3', 'cottage4', 'cottage5', 'cottage6', 'cottage7', 'cottage8'])
  assert.ok(Object.isFrozen(H.cottagePlotNames(8)))
  assert.deepStrictEqual([...C.COTTAGE_PLOTS], ['cottage1', 'cottage2', 'cottage3'], 'this process (no pool): as before')
  assert.deepStrictEqual(S.PROJECTS.filter(p => C.isCottagePlot(p.plot)).map(p => p.plot), ['cottage1', 'cottage2', 'cottage3'])
  // the blueprint choice with seven neighbours: every later project still gets a look and a blueprint that loads (cottage2.mjs cottageLooksFor)
  const others = []
  for (const [i, plot] of H.cottagePlotNames(8).slice(1).entries()) {
    const css = C.cottage2Styles(STOCK, { pool: 'showcase', plot, plotId: `H${i + 1}`, others })
    assert.ok(css.length >= 1, `${plot} has a look`)
    const bp = B.loadBlueprint(css[0].id)
    assert.ok(bp.cells.length > 100)
    others.push({ blueprint: css[0].id, style: css[0].style })
  }
  assert.strictEqual(new Set(others.map(o => `${o.blueprint}|${o.style.wood}`)).size, 7, 'seven later cottages, no two the same look and wood')
})
await t('IN THE SHOWCASE POOL (child): eight projects, each after the one before, offered and guarded; the plot lists follow', () => {
  const r = child('lists', { MEMORY_POOL: 'showcase' })
  assert.deepStrictEqual([r.on, r.sw, r.layout], [true, true, 8])
  assert.deepStrictEqual(r.plots, ['cottage1', 'cottage2', 'cottage3', 'cottage4', 'cottage5', 'cottage6', 'cottage7', 'cottage8'])
  assert.deepStrictEqual(r.projects, [['cottage1', 'enchantshop', 'cottage@1s', 2], ...[2, 3, 4, 5, 6, 7, 8].map(i => [`cottage${i}`, `cottage${i - 1}`, 'cottage@2-Csg0-', 2])])
  for (const p of r.plots) { assert.ok(r.on_.includes(p), `${p} offered`); assert.ok(r.guarded.includes(p), `${p} guarded`); assert.ok(r.claim.includes(p) && r.stand.includes(p) && r.glass.includes(p), `${p} claims its volume, its stands, its windows`) }
  assert.deepStrictEqual([r.after3, r.after7], ['cottage4', 'cottage8'], 'still one after another')
  assert.deepStrictEqual(r.held, [false, false, false, false], 'on: no home is held')
  assert.strictEqual(r.mode, 'on=1 switch=1 plots=8 projects=8 later=open shift=4 retry_h=6')
})
await t('HOMEPLOTS=off IN THE SHOWCASE POOL (child): the LIST is the layout\'s (review r1); a later home never sited is HELD, one already sited stays in the order', () => {
  const off = child('lists', { MEMORY_POOL: 'showcase', HOMEPLOTS: 'off' }), on = child('lists', { MEMORY_POOL: 'showcase' })
  assert.deepStrictEqual([off.on, off.sw, off.layout], [false, false, 8])
  assert.deepStrictEqual(off.plots, on.plots, 'the same eight names: a sited later home is still a project')
  assert.deepStrictEqual(off.projects, on.projects); assert.deepStrictEqual(off.on_, on.on_); assert.deepStrictEqual(off.guarded, on.guarded)
  assert.deepStrictEqual(off.held, [false, false, true, true], 'the first three as before; cottage4 .. cottage8 held while unsited')
  // SITED + OFF: cottage4 has a record and is open -> it is the order's project (it is finished)
  assert.strictEqual(off.sited4, 'cottage4'); assert.strictEqual(on.sited4, 'cottage4')
  // NEVER SITED + OFF: the status pass reports it waiting -> never offered, nor any after it; the order rests on what stands
  assert.ok(off.never4 && !/^cottage[4-8]$/.test(off.never4), `never an unsited later home (${off.never4})`); assert.strictEqual(on.after3, 'cottage4', 'POSITIVE CONTROL: on, the fourth follows the third')
  assert.strictEqual(off.mode, 'on=0 switch=0 plots=8 projects=8 later=sited_only shift=4 retry_h=6')
})
await t('A TOWN WITH NO ENTRY (a fleet pool with HOMEPLOTS=on; the showcase re-homed) (child): three projects, exactly as before', () => {
  for (const env of [{ MEMORY_POOL: 'hive-a', HOMEPLOTS: 'on', COTTAGE: 'on', COTTAGE2: 'on' }, { MEMORY_POOL: 'showcase', HOME_X: '400' }]) {
    const r = child('lists', env)
    assert.deepStrictEqual([r.on, r.layout, r.plots, r.isC5, r.held], [false, 0, ['cottage1', 'cottage2', 'cottage3'], false, [false, false, false, false]], JSON.stringify(env))
    assert.deepStrictEqual(r.projects, [['cottage1', 'enchantshop', 'cottage@1s', 2], ['cottage2', 'cottage1', 'cottage@2-Csg0-', 2], ['cottage3', 'cottage2', 'cottage@2-Csg0-', 2]])
    assert.deepStrictEqual(r.claim.filter(p => /^cottage/.test(p)), ['cottage1', 'cottage2', 'cottage3'])
    assert.ok(/ later=none /.test(r.mode), r.mode)
  }
})
await t('the switch\'s hold and the chain\'s wait (pure): a later home only, only while off; a cottage waits on a predecessor this pass saw not complete', () => {
  const names = H.cottagePlotNames(8)
  assert.deepStrictEqual(names.map(p => H.isLaterHome(p, names)), [false, false, false, true, true, true, true, true])
  assert.deepStrictEqual(['cottage3', 'cottage4'].map(p => H.laterHomeHeld(p, false, names)), [false, true])
  assert.deepStrictEqual(['cottage3', 'cottage4'].map(p => H.laterHomeHeld(p, true, names)), [false, false], 'on: nothing held')
  assert.strictEqual(H.laterHomeHeld('cottage4', false, H.cottagePlotNames(0)), false, 'a town with no layout has no later home')
  const p = (plot, after) => ({ plot, after })
  assert.strictEqual(H.chainWaits(p('cottage3', 'cottage2'), new Map([['cottage2', false]]), names), true)
  assert.strictEqual(H.chainWaits(p('cottage3', 'cottage2'), new Map([['cottage2', true]]), names), false, 'the predecessor stands: read as before')
  assert.strictEqual(H.chainWaits(p('cottage3', 'cottage2'), new Map(), names), false, 'the predecessor not seen this pass: read as before')
  assert.strictEqual(H.chainWaits(p('cottage1', 'enchantshop'), new Map([['enchantshop', false]]), names), false, 'the first cottage follows the workshop, not a cottage')
  assert.strictEqual(H.chainWaits(p('civicM', 'civicF'), new Map([['civicF', false]]), names), false, 'only the cottages')
})
await t('MUTANT the switch\'s hold dropped: with HOMEPLOTS off an unsited later home is opened and sited again', async () => {
  const M = await mutantOf("export const laterHomeHeld = (plot, on = HOMEPLOTS.on, names = COTTAGE_NAMES) => !on && isLaterHome(plot, names)", "export const laterHomeHeld = (plot, on = HOMEPLOTS.on, names = COTTAGE_NAMES) => false && !on && isLaterHome(plot, names)")
  assert.strictEqual(M.laterHomeHeld('cottage4', false, M.cottagePlotNames(8)), false)
  assert.strictEqual(H.laterHomeHeld('cottage4', false, H.cottagePlotNames(8)), true)
})
await t('MUTANT the chain\'s wait dropped: every unsited cottage is read again', async () => {
  const M = await mutantOf('done.has(p.after) && done.get(p.after) !== true', 'done.has(p.after) && done.get(p.after) === null')
  assert.strictEqual(M.chainWaits({ plot: 'cottage3', after: 'cottage2' }, new Map([['cottage2', false]]), M.cottagePlotNames(3)), false)
  assert.strictEqual(H.chainWaits({ plot: 'cottage3', after: 'cottage2' }, new Map([['cottage2', false]]), H.cottagePlotNames(3)), true)
})
await t('MUTANT the floor of three dropped from the names: a town with no layout loses its cottages', async () => {
  const M = await mutantOf('Array.from({ length: Math.max(HOMEPLOT.base, Math.floor(Number(n)) || 0) }', 'Array.from({ length: Math.floor(Number(n)) || 0 }')
  assert.deepStrictEqual([...M.cottagePlotNames(0)], [])
  assert.strictEqual(H.cottagePlotNames(0).length, 3)
})

console.log('8. THE TOWN\'S OWN FILES THROUGH skills.mjs (a child a switch state)')
await t('HOMEPLOTS=off: the house plots ARE the extension\'s record and the land reservation is landReservation(land, ext), byte for byte', () => {
  const r = child('town', { MEMORY_POOL: 'showcase', HOMEPLOTS: 'off' })
  assert.strictEqual(r.on, false)
  assert.strictEqual(r.houseIsExt, true, 'housePlotsNow answers the extension\'s own record')
  assert.deepStrictEqual(r.house.plots.map(p => p.id), ['X1', 'X3', 'X4', 'X5'], 'POSITIVE CONTROL: the record was read')
  assert.strictEqual(r.landAsBefore, true)
  assert.deepStrictEqual(r.landZones.map(z => z.id ?? z.why), ['land:road', 'X1', 'X3', 'X4', 'X5'], 'the corridor and the extension\'s plots, no home plot')
  assert.strictEqual(r.open2, true, 'cottage2 opens on X4, as before')
  assert.deepStrictEqual([r.open4, r.site4], [false, 'no_house_plot'], 'a later home never sited is neither opened nor sited (the visit\'s `plot_wait`)')
})
await t('HOMEPLOTS=on: the layout first then X4, X5 (X3 is cottage1\'s); H7 moved off the corridor; H1 for its door; the plots reserved; a failure rotates; a sited plot leaves', () => {
  const r = child('town', { MEMORY_POOL: 'showcase' })
  assert.strictEqual(r.on, true)
  assert.deepStrictEqual(r.offer.plots.map(p => p.id), ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'X4', 'X5'])
  assert.deepStrictEqual(r.offer.skipped, [{ id: 'X3', why: 'taken' }])
  const h7 = r.offer.plots.find(p => p.id === 'H7'), h1 = r.offer.plots.find(p => p.id === 'H1')
  assert.deepStrictEqual([h7.box, h7.shift, h7.why], [[19, -46, 29, -36], [-3, 0], 'road'])
  assert.deepStrictEqual([h1.box, h1.shift, h1.why], [[11, -23, 21, -13], [0, -1], 'door'])
  assert.deepStrictEqual(r.house.plots.map(p => p.id), r.offer.plots.map(p => p.id), 'cottageOpening is given the same plots in the same order')
  assert.strictEqual(r.open2, true)
  assert.strictEqual(r.open4, true, 'on: a later home opens (POSITIVE CONTROL for the hold)')
  // the reservation: what was there before, then one `land:plot` zone a placed plot, at its placed box
  assert.deepStrictEqual(r.landZones.map(z => z.id ?? z.why), ['land:road', 'X1', 'X3', 'X4', 'X5', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'])
  assert.deepStrictEqual(r.landZones.find(z => z.id === 'H7'), { box: [19, -64, -46, 29, 320, -36], why: 'land:plot', id: 'H7' })
  assert.strictEqual(r.landAsBefore, false)
  // the per-plot memory, through its file
  assert.deepStrictEqual([r.fails.H1.why, r.fails.H1.project, r.fails.H1.by, r.fails.H1.n], ['no_proven_site', 'cottage2', 'showcase-Alpha', 1])
  assert.deepStrictEqual(r.afterFail, ['H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'X4', 'X5', 'H1'])
  // cottage2 sited on H2: for cottage3 it is not free, and the plan no longer reserves it (the record does)
  assert.ok(!r.offer3.plots.some(p => p.id === 'H2'))
  assert.deepStrictEqual(r.offer3.skipped.map(k => k.id).sort(), ['H2', 'X3'])
  assert.strictEqual(r.offer3.skipped.find(k => k.id === 'H2').why, 'blocked:project:cottage2')
  assert.ok(!r.landZones3.some(z => z.id === 'H2') && r.landZones3.some(z => z.id === 'H3'))
  // the placing follows the records: with the corridor gone from the land plan's next generation, H7 is as drawn again
  assert.deepStrictEqual(r.landZones3.find(z => z.id === 'H7').box, [19, -64, -46, 29, 320, -36], 'still shifted while the corridor stands')
  assert.deepStrictEqual(r.landZones4.find(z => z.id === 'H7').box, [22, -64, -46, 32, 320, -36])
})

console.log('8b. REVIEW r1: THE PATHS\' ROUTER AND THE KEEPER\'S PERMANENT SITINGS KEEP OFF A RESERVED HOME')
const PATHS = await import('../src/paths.mjs')
const LM = await import('../src/landmark.mjs')
const TD = await import('../src/tidy.mjs')
const TR = await import('../src/terrace.mjs')
const { PARK_SAPLINGS } = await import('../src/park.mjs')
const inBox = (b, x, z, m = 0) => x >= b[0] - m && x <= b[2] + m && z >= b[1] - m && z <= b[3] + m
// one home due east of the core; the farm (the composter) beyond it: the leg's straight line runs through the plot
const ONE = { pools: { fake: { home: F.HOME, homes: [[15, -3, 21, 3]] } } }
const ONE_L = H.layoutPlotsOf(ONE, 'fake', F.HOME)
const ONE_R = H.resolveHomePlots(ONE_L, [], { home: F.HOME })
const corePlan = () => ({ ...F.plan(), plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: false }] })
const pathIn = () => ({ plan: corePlan(), composter: [32, F.G + 1, 0], place: B.placeBlueprint })
const pathCols = rec => [...new Set(rec.cells.map(c => `${c.at[0]},${c.at[2]}`))].map(k => k.split(',').map(Number))
await t('THE REAL ROUTER (paths.mjs sitePaths): a leg whose straight line crosses a reserved plot goes ROUND it; without the refusal it is laid across and the home reads `blocked:project:paths`', () => {
  assert.deepStrictEqual(ONE_R[0].box, [13, -5, 23, 5])
  // the reproduction (pathsInputs as it was: the reservation is the land pseudo-record's zones, and pathAvoid reads cells)
  const before = PATHS.sitePaths(F.server().read, pathIn())
  assert.ok(before.ok, before.why)
  assert.ok(pathCols(before.record).filter(([x, z]) => inBox(ONE_R[0].box, x, z)).length >= 10, 'POSITIVE CONTROL: the straight leg runs through the plot')
  assert.strictEqual(H.resolveHomePlots(ONE_L, S.recordZones([before.record]), { home: F.HOME })[0].skip, 'blocked:project:paths', 'and the home is lost to the path')
  // the router's inputs with the placed plots refused
  const inp = H.pathInputsWithHomes(pathIn(), ONE_R)
  const after = PATHS.sitePaths(F.server().read, inp)
  assert.ok(after.ok, `the farm is still reached: ${after.why}`)
  assert.ok(after.net.legs.find(l => l.id === 'farm').ok)
  assert.deepStrictEqual(pathCols(after.record).filter(([x, z]) => inBox(ONE_R[0].box, x, z, H.HOMEPLOT.pathGap)), [], 'no path column in the plot, nor within the paths\' own margin of it')
  assert.ok(pathCols(after.record).some(([x, z]) => x >= 13 && x <= 23 && (z < -6 || z > 6)), 'it runs along the plot\'s side')
  // ...so the paths\' own reservation (their columns + 1) leaves the plot where it is drawn
  assert.deepStrictEqual(H.resolveHomePlots(ONE_L, S.recordZones([after.record]), { home: F.HOME })[0].shift, [0, 0])
  // deterministic: the same inputs, the same record's columns
  assert.deepStrictEqual(pathCols(PATHS.sitePaths(F.server().read, H.pathInputsWithHomes(pathIn(), ONE_R)).record), pathCols(after.record))
})
await t('no placed plot (HOMEPLOTS off, no layout, every plot skipped): the router\'s inputs are THE SAME OBJECT, exactly as before', () => {
  const P = pathIn()
  assert.strictEqual(H.pathInputsWithHomes(P, null), P); assert.strictEqual(H.pathInputsWithHomes(P, []), P)
  assert.strictEqual(H.pathInputsWithHomes(P, [{ ...ONE_L[0], skip: 'road_no_shift' }]), P)
  const withHomes = H.pathInputsWithHomes({ ...P, zones: [{ box: [1, 0, 1, 2, 9, 2] }] }, ONE_R)
  assert.deepStrictEqual(withHomes.zones.map(z => z.box), [[1, 0, 1, 2, 9, 2], [12, -64, -6, 24, 320, 6]], 'the caller\'s zones kept, the plot\'s box + 1 added')
  assert.strictEqual(withHomes.plan, P.plan)
})
await t('MUTANT the router\'s inputs left as they were: the real router lays the leg across the reserved plot', async () => {
  const M = await mutantOf('  return zs.length ? { ...P, zones: [...(P?.zones ?? []), ...zs] } : P\n', '  return P\n')
  const s = PATHS.sitePaths(F.server().read, M.pathInputsWithHomes(pathIn(), ONE_R))
  assert.ok(s.ok && pathCols(s.record).some(([x, z]) => inBox(ONE_R[0].box, x, z)), 'the mutant\'s path crosses the plot')
})
// THE LANDMARK (landmark.mjs landmarkPlan, as skills.mjs gkPlanAdditions calls it: `taken` = the tidy's refusals, now with `homePlot`)
const LBOX = [-20, -20, 20, 20]
const lmCol = srv => (x, z) => { const c = TD.tidyColumn(srv.read, x, z, { yHi: F.HOME.y + 14, yLo: F.HOME.y - 14 }); return c.why || c.tree ? null : c.y }
const lmPlan = (taken = () => false) => { const srv = F.server(); return LM.landmarkPlan(srv.read, { box: LBOX, home: F.HOME, seed: 7, have: { spruce_sapling: 2 }, col: lmCol(srv), taken, saplings: PARK_SAPLINGS }) }
await t('THE LANDMARK is never sited on a reserved home plot (Codex\'s reproduction: the mound took the plot\'s centre and the home read `blocked:land:landmark`)', () => {
  const free = lmPlan()
  assert.ok(free?.landmark?.centre, 'POSITIVE CONTROL: with nothing taken the mound is sited')
  const [cx, cz] = free.landmark.centre
  const lay = H.layoutPlotsOf({ pools: { fake: { home: F.HOME, homes: [[cx - 3, cz - 3, cx + 3, cz + 3]] } } }, 'fake', F.HOME)
  const res = H.resolveHomePlots(lay, [], {})
  // the reproduction: the mound's reservation on the land plan blocks the home
  assert.strictEqual(H.resolveHomePlots(lay, LM.landmarkZones({ landmark: free.landmark }), {})[0].skip, 'blocked:land:landmark')
  const at = H.homePlotAt(res)
  assert.strictEqual(at(cx, cz), 'H1'); assert.strictEqual(at(res[0].box[2] + 1, cz), null, 'the box, not beyond it')
  const kept = lmPlan((x, z) => !!at(x, z))
  assert.ok(kept?.landmark?.centre, 'the mound is sited elsewhere')
  assert.deepStrictEqual(kept.cells.filter(c => at(c.at[0], c.at[2])), [], 'no cell of the mound on the plot')
  assert.ok(!meets(kept.landmark.box, res[0].box), `its reservation clear of the plot: ${kept.landmark.box} vs ${res[0].box}`)
  assert.deepStrictEqual(H.resolveHomePlots(lay, LM.landmarkZones({ landmark: kept.landmark }), {})[0].shift, [0, 0], 'the home stays')
  assert.strictEqual(H.homePlotAt([{ ...res[0], skip: 'door_no_shift' }])(cx, cz), null, 'a skipped plot reserves nothing')
  assert.strictEqual(H.homePlotAt([])(cx, cz), null, 'HOMEPLOTS off: nothing refused, as before')
})
await t('MUTANT the plot test answers nothing: the landmark is sited on the reserved home again', async () => {
  const M = await mutantOf('for (const b of bs) if (x >= b[1] && x <= b[3] && z >= b[2] && z <= b[4]) return b[0]; return null }', 'return null }')
  const free = lmPlan(); const [cx, cz] = free.landmark.centre
  const res = H.resolveHomePlots(H.layoutPlotsOf({ pools: { fake: { home: F.HOME, homes: [[cx - 3, cz - 3, cx + 3, cz + 3]] } } }, 'fake', F.HOME), [], {})
  const at = M.homePlotAt(res)
  assert.deepStrictEqual(lmPlan((x, z) => !!at(x, z)).landmark.centre, [cx, cz])
})
// THE PARK (terrace.mjs siteTerrace `keepOff`): a NEW park's site; the grading still works the plot
const tcol = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
const plateau = () => { const srv = F.server(); for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) { tcol(srv, x, z, F.G, F.G + 1, 'dirt'); srv.set([x, F.G + 2, z], 'grass_block') } return srv }
const TLAND = () => ({ home: F.HOME, seed: 7, ringR: 20, workR: 44, zones: { E: 'treefarm', SE: 'wild', S: 'wild', SW: 'wild', W: 'wild', NW: 'wild', N: 'wild', NE: 'wild' }, roads: [], corridors: [] })
const terrace = o => TR.siteTerrace(plateau().read, { home: F.HOME, land: TLAND(), records: [{ plot: 'a', floor: F.G }, { plot: 'b', floor: F.G + 1 }], have: { poppy: 64, oak_leaves: 64, bamboo: 9 }, now: 0, ...o })
await t('A NEW PARK is never sited on a reserved home plot; the terrace still grades the plot (cuts and fills on it are the keeper\'s ordinary work)', async () => {
  const free = await terrace({})
  assert.ok(free.record?.park?.box, 'POSITIVE CONTROL: the park is sited')
  const pb = free.record.park.box
  const res = H.resolveHomePlots(H.layoutPlotsOf({ pools: { fake: { home: F.HOME, homes: [[pb[0], pb[1], pb[0] + 6, pb[1] + 6]] } } }, 'fake', F.HOME), [], {})
  const at = H.homePlotAt(res)
  const kept = await terrace({ keepOff: at })
  assert.ok(kept.record, kept.why)
  const kb = kept.record.park?.box ?? null
  assert.ok(!kb || !meets(kb, res[0].box), `the park ${kb} off the plot ${res[0].box}`)
  assert.ok(kb, 'and there was room elsewhere')
  assert.ok([...kept.record.cut, ...kept.record.cells].filter(c => at(c.at[0], c.at[2])).length > 50, 'the grading still works the plot')
  // a park the land plan already has stays where it is (the reservation was the park's first)
  const prev = await terrace({ keepOff: at, land: { ...TLAND(), park: { box: pb, trees: [] } } })
  assert.deepStrictEqual(prev.record.park.box, pb)
})

console.log('8c. REVIEW r1: THE STATUS PASS -- WHAT IT READS, AND THE ROLLBACK\'S SEQUENCE (a child a switch state)')
const passOn = () => child('pass', { MEMORY_POOL: 'showcase' }), passOff = () => child('pass', { MEMORY_POOL: 'showcase', HOMEPLOTS: 'off' })
await t('READS A PASS (recordHead calls): a cottage behind an unfinished one reads NOTHING; the one that may be next reads the town\'s records ONCE; eight projects cost what three did', () => {
  const on = passOn(), off = passOff()
  console.log(`        reads a status pass, cottage1 standing and cottage2..8 unsited: on ${on.A.n} (${on.projects} projects, ${on.cottages} cottages), off ${off.A.n}; one read of the town's records ${on.heads}; cottage2 alone ${on.w2}, cottage5 alone ${on.w5}`)
  assert.deepStrictEqual([on.cottages, off.cottages], [8, 8])
  assert.ok(on.heads >= 40, `POSITIVE CONTROL: the counter sees the reads (${on.heads} for one read of every record)`)
  // the chain: cottage2 may be next (not waiting); cottage3..8 wait without a read
  assert.deepStrictEqual(on.A.cots.map(c => c.waiting), [false, false, true, true, true, true, true, true])
  assert.deepStrictEqual([on.w5, on.st5.waiting, on.st5.exists], [0, true, false], 'cottage5 behind an unsited cottage4: no recordHead call at all')
  assert.ok(on.w5alone >= 1, 'POSITIVE CONTROL: with its predecessor unknown it is read as before')
  assert.ok(on.w2 >= on.heads && on.w2 <= on.heads + 2, `cottage2: its own record and ONE read of the town's (${on.w2} vs ${on.heads}); it was two reads of the town's`)
  assert.strictEqual(on.st2.waiting, undefined, 'and it is open')
  assert.ok(off.w2 >= off.heads && off.w2 <= off.heads + 2, `off: the same (${off.w2})`)
  // the whole pass: measured 11-13 in this scenario -- the base release 213, the first homes commit 795 on / 233 off
  assert.strictEqual(on.A.n, off.A.n, 'the switch adds no read')
  assert.ok(on.A.n <= 213, `not above the base release's 213 (${on.A.n})`)
})
await t('THE ROLLBACK (Codex 3): cottage4 never sited + off -> not offered, the retrofit not held; cottage4 sited + off -> still the order\'s project, the hold ends when it is finished', () => {
  const on = passOn(), off = passOff()
  const c4 = r => r.cots.find(c => c.plot === 'cottage4')
  // B. cottage1..3 stand, cottage4 never sited
  assert.deepStrictEqual([c4(on.B).waiting, on.activeB], [false, 'cottage4'], 'on: cottage4 is next (POSITIVE CONTROL)')
  assert.deepStrictEqual([c4(off.B).exists, c4(off.B).waiting], [false, true], 'off: it waits')
  assert.ok(!/^cottage[4-8]$/.test(off.activeB), `off: never offered (${off.activeB})`)
  assert.ok(!/^styled_open/.test(off.reroofB), `off: the retrofit's planner is not held by it (${off.reroofB})`)
  // C. cottage4 SITED and open: with the switch OFF it is still the order's project (before: guarded, never offered, held for ever)
  for (const r of [on, off]) {
    assert.deepStrictEqual([c4(r.C).exists, c4(r.C).complete, c4(r.C).waiting], [true, false, false])
    assert.strictEqual(r.activeC, 'cottage4')
    assert.strictEqual(r.reroofC, 'styled_open:cottage4', 'the planner waits on it while it is open (the reproduction\'s hold)')
  }
  // D. ...finished: the hold ends by itself; off, no fifth cottage follows; on, it does
  for (const r of [on, off]) assert.ok(!/^styled_open/.test(r.reroofD), `the hold is over (${r.reroofD})`)
  assert.strictEqual(on.activeD, 'cottage5')
  assert.ok(!/^cottage[5-8]$/.test(off.activeD), `off: nothing new is started (${off.activeD})`)
  assert.deepStrictEqual(off.D.cots.filter(c => /^cottage[5-8]$/.test(c.plot)).map(c => c.waiting), [true, true, true, true])
})

console.log('9. THE ROWS')
await t('`_homeplot` rows: project, op, plot, why (and the shift, the box, the plots offered) survive the detail; the licence row', () => {
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'shifted', plot: 'H7', why: 'road', shift: [-3, 0], box: [19, -46, 29, -36] }), 'project=cottage2 op=shifted plot=H7 why=road shift=-3,0 box=19,-46,29,-36')
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'offered', plots: ['H1', 'H2', 'X4'], n: 3, skipped: 1 }), 'project=cottage2 op=offered plots=H1,H2,X4 n=3 skipped=1')
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'failed', plot: 'H1', why: 'no proven site' }), 'project=cottage2 op=failed plot=H1 why=no_proven_site')
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage3', op: 'skipped', plot: 'H2', why: 'blocked:project:cottage2' }), 'project=cottage3 op=skipped plot=H2 why=blocked:project:cottage2')
  const all = H.homePlotRowDetail({ project: 'cottage8', op: 'offered', plots: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'X4', 'X5'], n: 10, skipped: 0 })
  assert.ok(all.length <= 300 && all.includes('plots=H1,H2,H3,H4,H5,H6,H7,H8,X4,X5 n=10'), all)
  assert.strictEqual(H.homePlotsModeDetail({ on: false, sw: true, layout: [] }), 'on=0 switch=1 plots=0 projects=3 later=none shift=4 retry_h=6')
})
await t('rate-limited: the same row from one bot at most every 10 min; `shifted` / `skipped` every 6 h; another plot or reason is its own row', () => {
  const memo = new Map(), f = { project: 'cottage2', op: 'failed', plot: 'H1', why: 'no_site' }
  assert.strictEqual(H.homeRowDue(memo, f, 1_000_000), true)
  assert.strictEqual(H.homeRowDue(memo, f, 1_000_000 + 9 * 60_000), false)
  assert.strictEqual(H.homeRowDue(memo, { ...f, plot: 'H2' }, 1_000_000 + 9 * 60_000), true)
  assert.strictEqual(H.homeRowDue(memo, { ...f, why: 'no_proven_site' }, 1_000_000 + 9 * 60_000), true)
  assert.strictEqual(H.homeRowDue(memo, f, 1_000_000 + 10 * 60_000), true)
  const g = { project: 'cottage2', op: 'skipped', plot: 'H7', why: 'road_no_shift' }
  assert.strictEqual(H.homeRowDue(memo, g, 0), true); assert.strictEqual(H.homeRowDue(memo, g, 5 * 3_600_000), false); assert.strictEqual(H.homeRowDue(memo, g, 6 * 3_600_000), true)
  assert.strictEqual(H.homeRowDue(memo, { project: 'cottage2', op: 'offered', plots: ['H1'] }, 0), true)
  assert.strictEqual(H.homeRowDue(memo, { project: 'cottage2', op: 'offered', plots: ['H2'] }, 1), true, 'a different offer is a different row')
})

console.log('10. THE WIRING (structural: comments stripped, anchored on executable lines, a mutant each)')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]+\/\/ .*$/gm, '')
const WIRES = {
  'HOMEPLOTS off: the house plots are the extension\'s record': ['  if (!HOMEPLOTS.on) return enchantExtNow(dir)\n', '  if (false) return enchantExtNow(dir)\n'],
  'the opening reads the offered plots, the town\'s records once': ['&& cottageOpening(housePlotsNow(dir, plot), HOMEPLOTS.on ? [] : plotsTaken(dir, plot)).open } catch { return false } }', '&& cottageOpening(enchantExtNow(dir), plotsTaken(dir, plot)).open } catch { return false } }'],
  'off never OPENS a later home that has no record': ['&& !laterHomeHeld(plot) && Date.now() >= siteWaitUntil(plot, dir) && cottageOpening(', '&& Date.now() >= siteWaitUntil(plot, dir) && cottageOpening('],
  'off never SITES a later home': ["    if (laterHomeHeld(plot)) return { ok: false, why: 'no_house_plot', tried }\n", "    if (false) return { ok: false, why: 'no_house_plot', tried }\n"],
  'the status pass: a cottage behind an unfinished one waits without a read': ['        if (chainWaits(p, cotDone)) { cotDone.set(p.plot, false); return { plot: p.plot, exists: false, complete: false, damaged: false, due: false, dueFirst: false, waiting: true } }\n        const h = recordHead(dir, projKeyOf(p.plot))\n', '        const h = recordHead(dir, projKeyOf(p.plot))\n'],
  'the status pass keeps each cottage\'s state for the next': ['        if (isCottagePlot(p.plot)) cotDone.set(p.plot, complete)', '        void complete'],
  'the prime hands the states so far to each project\'s turn': ['      const st = shopActive(null, now, { stateOf: p, before: states })', '      const st = shopActive(null, now, { stateOf: p })'],
  'the paths\' siting and extension route with the homes refused': ['  const inputs = () => pathsRouteInputs(bot, c, h, dir)\n', '  const inputs = () => pathsInputs(bot, c, h, dir)\n'],
  'the paths\' extension check uses the router\'s inputs': ['    const D = pathDests(pathsRouteInputs(bot, shopCtx(bot), h))\n', '    const D = pathDests(pathsInputs(bot, shopCtx(bot), h))\n'],
  'the router\'s inputs are pathsInputs with the placed plots': ['  return pathInputsWithHomes(P, P.homePlots ?? null)\n', '  return P\n'],
  'the landmark\'s site refuses a reserved home plot': ['|| !!I.reserved(x, z) || !!I.homePlot(x, z) || boxes.some(', '|| !!I.reserved(x, z) || boxes.some('],
  'a new park\'s site is given the home plots': ['.then(() => check(signal)), keepOff: I.homePlot ?? null }\n', '.then(() => check(signal)) }\n'],
  'the keeper\'s inputs carry the placed plots': ['  const homePlot = homePlotAt(P.homePlots ?? [])\n', '  const homePlot = () => null\n'],
  'HOMEPLOTS off: the siting is the extension\'s first free plot and only that': ["      const o = cottageOpening(enchantExtNow(), plotsTaken(townDir(), plot))\n      if (!o.open) return { ok: false, why: o.why, tried }\n      return await cottageSiteOn(bot, plan, c, stood, signal, plot, o, box, tried, () => cottageOpening(enchantExtNow(), plotsTaken(townDir(), plot)).plot?.id === o.plot.id)\n    }\n", '    }\n'],
  'HOMEPLOTS off decides which siting runs': ['    if (!HOMEPLOTS.on) {\n', '    if (false) {\n'],
  'the siting goes over the offered plots': ['    return await siteOverPlots(offer.plots, p => {\n', '    return await siteOverPlots(offer.plots.slice(0, 1), p => {\n'],
  'a failed plot is written to the town\'s memory': ['noteFail: (p, why) => homeFailNote(dir, p.id, why, plot, me)', 'noteFail: () => {}'],
  'the offer reads the memory and the other records\' plots': ["taken: heads.filter(x => x.plot !== plot).map(x => x.head?.rec?.plotId).filter(Boolean), fails: homeFails(dir) })", 'taken: [], fails: {} })'],
  'the plots are reserved in the land plan\'s pseudo-record': ["    if (HOMEPLOTS.on) out.homePlots = homePlotsReserve(out, `${land?.gen ?? '-'}|${sp?.gen ?? '-'}`)\n", '    if (false) out.homePlots = homePlotsReserve(out)\n'],
  'the reservation is placed again when any record moves': ["    if (homeResolvedMemo?.sig !== sig) homeResolvedMemo = { sig, resolved: homePlotsResolved(heads) }\n", '    homeResolvedMemo ??= { sig, resolved: homePlotsResolved(heads) }\n'],
  'the resolver is given every head\'s zones and the home': ['resolveHomePlots(HOMEPLOTS.layout, recordZones(heads.map(x => x.head?.rec).filter(Boolean)), { home: HOMEPLOTS.home })', 'resolveHomePlots(HOMEPLOTS.layout, [], { home: HOMEPLOTS.home })'],
  'the row is its own kind, never a `_build` row': ["logEvent({ kind: 'homeplot', status:", "logEvent({ kind: 'build', status:"],
}
const wired = src => { const c = strip(src); for (const [name, [line]] of Object.entries(WIRES)) assert.strictEqual(c.split(line).length - 1, 1, `not wired once: ${name}`) }
await t('skills.mjs is wired: the switch, the opening, the siting over the plots, the memory, the reservation, the row kind', () => {
  wired(SK_SRC)
  const c = strip(SK_SRC)
  // no `_build` row from the homes code: its section of skills.mjs never calls the `_build` formatter (the whole file does: the control)
  const a = c.indexOf('const homeFailFile ='), b = c.indexOf('async function cottageSiteOn (')
  assert.ok(a > 0 && b > a, 'the section is found')
  const sec = c.slice(a, b)
  assert.ok(sec.includes('homePlotRow(bot, {') && !sec.includes('buildRowDetail(') && !sec.includes("kind: 'build'"), 'the homes section writes `_homeplot` rows only')
  assert.ok(c.includes('buildRowDetail(') && c.includes("kind: 'build'"), 'POSITIVE CONTROL: the same search finds the `_build` writer elsewhere')
  const feat = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
  assert.strictEqual(feat.split("logEvent({ kind: 'homeplots_mode', status: 'success', snapshot: snapshot(bot), detail: homePlotsModeDetail() })").length - 1, 1, 'the licence row')
  // terrace.mjs: the park's site asks `keepOff` (behaviour: 8b); the anchor, with its mutant
  const ter = readFileSync(new URL('../src/terrace.mjs', import.meta.url), 'utf8'), anchor = 'near: (x, z) => near(x, z) || !!keepOff?.(x, z) || N8.some('
  assert.strictEqual(strip(ter).split(anchor).length - 1, 1, 'the park\'s site asks keepOff')
  assert.strictEqual(ter.split(anchor).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.strictEqual(strip(ter.replace(anchor, 'near: (x, z) => near(x, z) || N8.some(')).split(anchor).length - 1, 0, 'the mutant is seen')
})
for (const [name, [line, neu]] of Object.entries(WIRES)) {
  await t(`MUTANT (wiring) ${name}`, () => {
    assert.strictEqual(SK_SRC.split(line).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(line.slice(0, 70))}`)
    const mutant = SK_SRC.replace(line, neu)
    assert.notStrictEqual(mutant, SK_SRC, 'the mutant differs')
    assert.throws(() => wired(mutant), /not wired once/)
  })
}
await t('the layout\'s home is the one config.mjs reads (HOME_X/Y/Z, defaults 0, 70, 0): the two never disagree', async () => {
  const { config } = await import('../src/config.mjs')
  assert.deepStrictEqual(H.HOMEPLOTS.home, { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ })
  assert.deepStrictEqual(H.homePlotsAtLoad({ HOME_X: '7', HOME_Y: '64', HOME_Z: '-3' }, DATA).home, { x: 7, y: 64, z: -3 })
})

console.log(`\nhomeplots: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
