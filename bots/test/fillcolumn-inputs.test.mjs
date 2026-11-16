// FILLCOLUMN-01 r5 (Codex round 4): THE KEEP-OUT AND ITS REPORT COME FROM ONE PATH. The refresh's column repair adds cells only where
// the survey's keep-out (tidy.mjs siteStage `keepOff`) allows, and only when that keep-out is COMPLETE. r2-r4 judged completeness
// with strict readers of their own, which disagreed with the survey's lenient ones at the edges (a bridge sighting without its rows
// made the zone builder throw and every bridge reservation vanished; a line window counted differently). Now every reader and zone
// builder the keep-out is built from takes an optional report array and names there whatever it dropped, caught, cut off or fell
// back on, as it does so. Here: the REAL readers (skills.mjs through its `_fillcol` seam, the path tidyRefresh itself runs) over real
// files in a real town directory, the leaf builders one by one, a property over generated malformed variants of every file, and one
// switchable copy of each source file in which every recording site can be turned off alone (a site turned off must lose its test).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// the bot's config reads its environment at import: set before anything is imported
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-fcin-logs-'))
process.env.BOT_NAME = 'FcBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-fcin-pool-'))
process.env.RECCACHE = 'off'                                          // every run reads the files as they are now
for (const k of ['FILLCOLUMN', 'GROUNDSKEEPER', 'TIDY', 'LANDPLAN', 'SITEPREP', 'SINKS', 'COPPERHALL', 'STOREHOUSE', 'HOUSE']) delete process.env[k]
process.env.HOMEPLOTS = 'off'                                         // the layout's home plots are no keep-out of the tidy's (skills.mjs tidyInputs)

const { G, HOME, server, plan, PJ } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')
const FC = await import('../src/fillcolumn.mjs')
const SK = await import('../src/skills.mjs')
const PS = await import('../src/planstore.mjs')
const URL_OF = n => new URL(`../src/${n}`, import.meta.url)
const POOL = process.env.POOL_STATE_DIR

let pass = 0, fail = 0
const NOTES = []
const t = async (name, fn) => {
  try { await fn(); pass++; if (process.env.TEST_VERBOSE) console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.stack ?? e).split('\n').slice(0, 3).join('\n        ').slice(0, 900)}`) }
}

// ---- ONE SWITCHABLE COPY OF A SOURCE FILE: every recording site (`report.push(`, `report?.push(`, a `headReport(report, ` call, and
// for buildsite.mjs each `bad('...')`) is numbered and can be turned off alone (globalThis.__fcOff = its id); `faults` are places made
// to throw on demand (globalThis.__fcFaultOn = name) -- the only way to reach a catch no file can trigger. -> { M, sites, cover }
async function switchable (file, { faults = [], bad = false } = {}) {
  let src = fs.readFileSync(URL_OF(file), 'utf8')
  for (const [old, neu] of faults) { assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE (${file}): ${old.slice(0, 60)}`); src = src.replace(old, neu) }
  const re = bad ? /report\?\.push\(|report\.push\(|headReport\(report, |\bbad\('/g : /report\?\.push\(|report\.push\(|headReport\(report, /g
  // a site's text: from its call to the next site's (170 characters at most) -- no two sites share a character
  const offs = [...src.matchAll(re)].map(m => m.index)
  const sites = offs.map((off, i) => ({ id: `${file}#${i}`, text: src.slice(off, Math.min(off + 170, offs[i + 1] ?? Infinity)), hit: 0 }))
  assert.ok(sites.length > 0, `${file}: no recording site found`)
  let n = 0
  const out = src.replace(re, m => {
    const id = sites[n++].id
    if (m.startsWith('headReport')) return `headReport(__fcSite('${id}', report), `
    if (m.startsWith('bad')) return `__fcSite('${id}', bad)?.('`
    return `__fcSite('${id}', report)?.push(`
  }) + `\nfunction __fcSite (id, r) { return globalThis.__fcOff === id ? null : r }\nfunction __fcFault (name, f) { if (globalThis.__fcFaultOn === name) throw Object.assign(new Error('fault ' + name), { code: 'EFAULT' }); return f() }\n`
  const p = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(p, out.replace(/from '\.\//g, "from '../src/"))
  let M
  try { M = await import(p.href) } finally { try { fs.unlinkSync(p) } catch {} }
  /** The one site whose source text holds `label` (present AND unique, or the mutant is no mutant). */
  const site = label => { const hit = sites.filter(s => s.text.includes(label)); assert.strictEqual(hit.length, 1, `ANCHOR MISSING OR NOT UNIQUE (${file}): ${label} -> ${hit.length} site(s)`); return hit[0] }
  return { M, sites, site }
}
const has = (report, input, why) => (report ?? []).some(r => r.input === input && why.test(String(r.why)))
/** A CASE: `run(M)` -> the report the real path wrote. On the real module and on the switchable copy the entry is there; with the
 *  case's site turned off it is gone -- that site's removal is caught by this case. */
async function siteCase (X, real, { label, input, why, run, fault = null }) {
  const s = X.site(label)
  if (!fault) assert.ok(has(await run(real), input, why), `the real module does not report ${input} ${why} for "${label}"`)
  globalThis.__fcFaultOn = fault
  try {
    globalThis.__fcOff = null
    const on = await run(X.M)
    assert.ok(has(on, input, why), `the switchable copy does not report ${input} ${why} (got ${JSON.stringify(on).slice(0, 300)})`)
    globalThis.__fcOff = s.id
    assert.ok(!has(await run(X.M), input, why), `MUTANT SURVIVED: site "${label}" turned off, ${input} ${why} is still reported`)
    s.hit++
  } finally { globalThis.__fcOff = null; globalThis.__fcFaultOn = null }
}
const covered = X => assert.deepStrictEqual(X.sites.filter(s => !s.hit).map(s => s.text.slice(0, 90)), [], 'a recording site no case turns off')

// =================================================================================================================================
// THE LEAF READERS AND ZONE BUILDERS, one by one: the result is the same with and without the report; a well-formed input reports
// nothing; each malformed entry is named
// =================================================================================================================================
const same = (f, ...args) => {   // f(...args, undefined) and f(...args, report): equal results (or the same throw) -> the report
  const report = []
  let a, b, ea = null, eb = null
  try { a = f(...args.map(v => (v === REPORT ? undefined : v))) } catch (e) { ea = String(e?.message) }
  try { b = f(...args.map(v => (v === REPORT ? report : v))) } catch (e) { eb = String(e?.message) }
  assert.strictEqual(ea, eb, 'the same throw with and without the report')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b ?? null)), JSON.parse(JSON.stringify(a ?? null)), 'the same result with and without the report')
  return report
}
const REPORT = Symbol('report')
const tmpDir = (files = {}) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fcin-')); for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(d, n), typeof v === 'string' ? v : JSON.stringify(v)); return d }

const LEAF = {
  'composter.mjs': {
    good: M => [same(M.readTownSite, tmpDir({}), 'k', REPORT), same(M.readTownSite, path.join(os.tmpdir(), `fcin-none-${process.pid}`), 'k', REPORT), same(M.readTownSite, tmpDir({ 'k.g1.json': '{', 'k.g2.json': { x: 1, y: 2, z: 3 } }), 'k', REPORT)],
    cases: [
      { label: 'the directory cannot be listed', input: 'townsite', why: /cannot be listed/, run: M => same(M.readTownSite, path.join(tmpDir({ f: 'x' }), 'f'), 'k', REPORT) },
      { label: 'names no place', input: 'townsite', why: /generation 2 names no place/, run: M => same(M.readTownSite, tmpDir({ 'k.g1.json': { x: 1, y: 2, z: 3 }, 'k.g2.json': { x: 1, y: 2 } }), 'k', REPORT) },
      { label: 'cannot be read` })', input: 'townsite', why: /generation 2 cannot be read/, run: M => same(M.readTownSite, tmpDir({ 'k.g1.json': { x: 1, y: 2, z: 3 }, 'k.g2.json': '{"x":1,' }), 'k', REPORT) },
    ],
  },
  'buildsite.mjs': {
    bad: true,
    good: M => [same(M.plinthCells, { plan: { steps: [{ c: [1, 2, 3] }], cap: { x: 1, y: 2, z: 3 }, stair: [[1, 2, 3]] }, prev: [{ x: 1, y: 2, z: 3, stair: [[4, 5, 6]] }] }, REPORT), same(M.plinthCells, { plan: null }, REPORT), same(M.plinthCells, {}, REPORT)],
    cases: [
      ['the plinth record: ${why}', []],
      ["bad('not a record')", []],
      ["bad('its plan is no plan')", { plan: 5 }],
      ["bad('its steps are no list')", { plan: { steps: 5 } }],
      ["bad('a step cell without a full place')", { plan: { steps: [{ c: [1, 2] }] } }],
      ["bad('a step without a cell')", { plan: { steps: [{ op: 'place' }] } }],
      ["bad('a cap without a full place')", { plan: { cap: { x: 1, y: 2 } } }],
      ["bad('a cap that is no place')", { plan: { cap: 0 } }],
      ["bad('its stair is no list')", { plan: { stair: 5 } }],
      ["bad('a stair cell without a full place')", { plan: { stair: [[1, 'a', 3]] } }],
      ["bad('a stair cell that is no cell')", { plan: { stair: [[1, 2]] } }],
      ["bad('its earlier columns are no list')", { prev: 5 }],
      ["bad('an earlier column without a full place')", { prev: [{ x: 1, y: 2 }] }],
      ["column\\'s stair is no list')", { prev: [{ x: 1, y: 2, z: 3, stair: 5 }] }],
      ["bad('an earlier stair cell without a full place')", { prev: [{ x: 1, y: 2, z: 3, stair: [[1, 'a', 3]] }] }],
      ["bad('an earlier stair cell that is no cell')", { prev: [{ x: 1, y: 2, z: 3, stair: [[1, 2]] }] }],
    ].map(([label, rec]) => ({ label, input: 'wells', why: label.startsWith('the plinth') ? /the plinth record: / : new RegExp(label.replace(/^bad\('|'\)$/g, '').replace(/^column\\'s/, "column's").replace(/[()]/g, '\\$&')), run: M => same(M.plinthCells, rec, REPORT) })),
  },
  'shop.mjs': {
    good: M => [same(M.recordZones, [{ plot: 'paths', zones: [{ box: [0, -64, 0, 1, 320, 1] }] }, { plot: 'shaft', box: [1, 2, 3, 4] }, { plot: 'tidy' }], 3, REPORT)],
    cases: [
      { label: 'a zone without a box', input: 'record:paths', why: /a zone without a box/, run: M => same(M.recordZones, [{ plot: 'paths', zones: [{ box: [1, 2, 3] }, { box: [0, -64, 0, 1, 320, 1] }] }], 3, REPORT) },
      { label: 'its box is no box', input: 'record:shaft', why: /its box is no box/, run: M => same(M.recordZones, [{ plot: 'shaft', box: [1, 2, 'x', 4] }], 3, REPORT) },
      { label: 'its zones are no list', input: 'record:paths', why: /its zones are no list/, run: M => same(M.recordZones, [{ plot: 'paths', zones: 5 }], 3, REPORT) },
    ],
  },
  'expedition.mjs': {
    good: M => [same(M.markerZones, [{ at: [1, 2, 3] }], 1, REPORT), same(M.markerZones, [], 1, REPORT)],
    cases: [{ label: 'a marker without a full place', input: 'markers', why: /without a full place/, run: M => same(M.markerZones, [{ at: [1, 2] }, { at: [1, 2, 3] }], 1, REPORT) }],
  },
  'landmark.mjs': {
    good: M => [same(M.landmarkZones, { landmark: { box: [1, 2, 3, 4] } }, REPORT), same(M.landmarkZones, {}, REPORT), same(M.landmarkZones, null, REPORT)],
    cases: [{ label: 'the landmark has no box', input: 'land', why: /landmark has no box/, run: M => same(M.landmarkZones, { landmark: { box: [1, 2] } }, REPORT) }],
  },
  'decorator.mjs': {
    good: M => [same(M.lawnZonesOf, [{ plot: 'decor', lawns: [{ box: [0, 0, 2, 2] }] }, { plot: 'x' }], REPORT)],
    cases: [{ label: 'a lawn without a box', input: 'record:decor', why: /a lawn without a box/, run: M => same(M.lawnZonesOf, [{ plot: 'decor', lawns: [{ box: [1, 2] }, { box: [0, 0, 2, 2] }] }], REPORT) }],
  },
  'bridge.mjs': {
    // every line a sound file holds says nothing: a repeat sighting (folded into its site), and each kind of state line -- complete,
    // failed, a design that did not fit, a material, a design named after the material (passed over: named once), a state for a site
    // the fold does not hold that names no design
    good: M => [same(M.bridgeSites, [SIGHT, { op: 'state', id: 'b1', complete: true }], REPORT), same(M.bridgeZones, M.bridgeSites([SIGHT]), 1, REPORT),
      same(M.bridgeSites, [SIGHT, { ...SIGHT, id: 'b1b', trip: 't2' }, { op: 'state', id: 'b1', complete: false, why: 'broken' }, { op: 'state', id: 'b1', failed: true, why: 'stand' }, { op: 'state', id: 'b1', nodesign: 'cell_stone' },
        { op: 'state', id: 'b1', mat: 'wood', species: 'oak' }, { op: 'state', id: 'b1', mat: 'cobble' }, { op: 'state', id: 'b1', design: { style: 'arch', v: {} } }, { op: 'state', id: 'gone-site', complete: true }, { op: 'state', id: 'gone-site', mat: 'cobble' }], REPORT)],
    cases: [
      { label: 'a sighting without its span', input: 'bridges', why: /a sighting without its span/, run: M => same(M.bridgeSites, [SIGHT, { op: 'sight', id: 'b2' }], REPORT) },
      { label: 'a designed site with no design zone', input: 'bridges', why: /no design zone/, run: M => { const s = M.bridgeSites([SIGHT])[0]; s.design = { style: 'none' }; s._plan = []; s._planKey = JSON.stringify([s.span.near, s.span.axis, s.span.w, s.design]); return same(M.bridgeZones, [s], 1, REPORT) } },
      { label: 'a point without a place', input: 'bridges', why: /a point without a place/, run: M => same(M.bridgeZones, M.bridgeSites([{ ...SIGHT, span: { ...SIGHT.span, far: ['x', 64, -22] } }]), 1, REPORT) },
      // Codex round 5 (2): a sighting whose op is missing, or is none the fold knows -- its reservation is gone
      { label: 'a line with no known op', input: 'bridges', why: /a line with no known op/, run: M => { const r = same(M.bridgeSites, [SIGHT, { id: 'b9', span: { ...SIGHT.span, near: [40, 64, 40], far: [40, 64, 44] } }], REPORT); assert.strictEqual(M.bridgeSites([SIGHT, { id: 'b9', span: SIGHT.span }]).length, 1, 'the control: the fold drops it'); return r } },
      { label: 'a line with no known op', input: 'bridges', why: /a line with no known op/, run: M => same(M.bridgeSites, [SIGHT, { ...SIGHT, op: 'sigth', id: 'b9' }], REPORT) },
      { label: 'a design named for no known site', input: 'bridges', why: /a design named for no known site/, run: M => same(M.bridgeSites, [SIGHT, { op: 'state', id: 'b7', design: { style: 'arch', v: {} } }], REPORT) },
      { label: 'a design named for no known site', input: 'bridges', why: /a design named for no known site/, run: M => same(M.bridgeSites, [SIGHT, { op: 'state', design: { style: 'arch', v: {} } }], REPORT) },
      { label: 'a design that names no style', input: 'bridges', why: /a design that names no style/, run: M => same(M.bridgeSites, [SIGHT, { op: 'state', id: 'b1', design: { v: {} } }], REPORT) },
      { label: 'a material that is neither wood nor cobble', input: 'bridges', why: /neither wood nor cobble/, run: M => same(M.bridgeSites, [SIGHT, { op: 'state', id: 'b1', mat: 'stone' }], REPORT) },
    ],
  },
  'paths.mjs': {
    // (the plan: a plot that is no keep-out, a boxed keep-out plot with a placed cell and a free one seen once, a keep-out plot with
    // no box at all -- an annex: its cells are its area -- and a plot with neither: each a sound plot, none named)
    good: M => [(() => { const report = []; M.pathAvoid({ zones: [{ box: [0, 0, 0, 1, 1, 1] }], caps: [[1, 70, 2]], plinth: [[1, 70, 2]], farm: [[1, 2]], composter: [1, 70, 2], records: [{ plot: 'p', cells: [{ at: [1, 70, 2] }] }], home: HOME, report,
      plan: { plots: [{ id: 'core', box: [-6, -6, 6, 6], keepout: false }, { id: 'store', box: [10, 10, 14, 13], keepout: true, cells: [{ at: [11, 70, 11], kind: 'chest', state: 'placed', stand: [11, 70, 12] }, { at: [12, 70, 11], kind: 'chest', state: 'free', seenSince: 5 }] }, { id: 'annex', keepout: true, cells: [{ at: [20, 70, 20], kind: 'chest', state: 'free' }] }, { id: 'farm', kind: 'farm', sector: 'N' }] } }); return report })()],
    cases: [
      ['a zone without a box', 'zones', { zones: [{ box: [1, 2, 3] }] }],
      ['a well cap without a place', 'wells', { caps: [[1, 70]] }],
      ['a well cell without a place', 'wells', { plinth: [[1, 70]] }],
      ['a farm column without a place', 'treefarm', { farm: [[1]] }],
      ['the composter has no place', 'townsite', { composter: [1, 70] }],
      ['a cell without a place', 'record:p', { records: [{ plot: 'p', cells: [{ at: [1, 70, 'z'] }] }] }],
      ['a cell without a place', 'record:q', { records: [{ plot: 'q', cells: 'ab' }] }],   // cells that are no list: named, and no throw the plain call does not make
      // Codex round 5 (1): a keep-out plot whose box has three numbers passes planRefusal and matches nothing
      ['a keep-out plot whose box is no box', 'plan', { plan: { plots: [{ id: 'a', box: [10, 10, 20], keepout: true }] } }],
      ['a keep-out plot whose box is no box', 'plan', { plan: { plots: [{ id: 'a', box: 5, keepout: true }] } }],
      ['a plot whose keep-out is no yes or no', 'plan', { plan: { plots: [{ id: 'a', box: [0, 0, 2, 2], keepout: 0 }] } }],
      ['a cell whose first sighting is no time', 'plan', { plan: { plots: [{ id: 'a', box: [0, 0, 2, 2], keepout: true, cells: [{ at: [1, 70, 1], kind: 'chest', state: 'free', seenSince: 'x' }] }] } }],
    ].map(([label, input, o]) => ({ label, input, why: new RegExp(label), run: M => {
      const report = []
      const a = M.pathAvoid({ ...o, home: HOME }), b = M.pathAvoid({ ...o, home: HOME, report })
      for (let x = -3; x <= 22; x++) for (let z = -3; z <= 22; z++) assert.strictEqual(b(x, z), a(x, z), 'the same refusals with and without the report')
      return report
    } })),
  },
  'tidy.mjs': {
    good: M => [(() => { const report = []; M.tidyAvoid(() => null, [{ box: [0, -64, 0, 1, 320, 1] }], report); M.inwallNoLitter([{ plot: 'yard', cells: [{ at: [1, 70, 2] }] }, { plot: 'shaft', cells: [{ at: null }] }], report); M.plotPrep(server().read, { plots: [{ id: 'X', box: [51, 51, 53, 53] }], home: HOME, report }); return report })()],
    cases: [
      { label: 'a reservation without a box', input: 'reservations', why: /a reservation without a box \(odd\)/, run: M => { const report = []; const a = M.tidyAvoid(() => null, [{ box: [1, 2, 3], why: 'odd' }, { box: [0, -64, 0, 1, 320, 1] }]), b = M.tidyAvoid(() => null, [{ box: [1, 2, 3], why: 'odd' }, { box: [0, -64, 0, 1, 320, 1] }], report); for (let x = -2; x <= 3; x++) assert.strictEqual(b(x, 0), a(x, 0)); return report } },
      { label: "'a plot without a box'", input: 'record:wallext', why: /a plot without a box/, run: M => { const report = []; const rd = server().read; const a = M.plotPrep(rd, { plots: [{ id: 'X', box: [1, 2] }], home: HOME }), b = M.plotPrep(rd, { plots: [{ id: 'X', box: [1, 2] }], home: HOME, report }); assert.deepStrictEqual({ ...b, cols: [...b.cols] }, { ...a, cols: [...a.cols] }); return report } },
      { label: "input: `record:${r.plot}`, why: 'a cell without a place'", input: 'record:yard', why: /a cell without a place/, run: M => { const report = []; const recs = [{ plot: 'yard', cells: [{ at: [1, 70, 2] }, { at: null }] }]; const a = M.inwallNoLitter(recs), b = M.inwallNoLitter(recs, report); for (let x = -3; x <= 5; x++) assert.strictEqual(b(x, 2), a(x, 2)); return report } },
    ],
  },
  'siteprep.mjs': {
    // (every state prepStep leaves a request in -- the two that reserve and the five that do not, each still carrying a zone -- says nothing)
    good: M => [same(M.prepZones, { requests: [{ id: 'r', state: 'prepared', zone: { box: [0, -64, 0, 1, 320, 1] } }, { id: 'q', state: 'filed' }] }, null, REPORT), same(M.prepZones, {}, null, REPORT), same(M.prepZones, null, null, REPORT),
      same(M.prepZones, { requests: M.PREP_STATES.map(st => ({ id: st, state: st, zone: { box: [0, -64, 0, 1, 320, 1] } })) }, null, REPORT)],
    cases: [
      { label: 'a reserved plot without its zone', input: 'siteprep', why: /without its zone/, run: M => same(M.prepZones, { requests: [{ id: 'r', state: 'prepared' }, { id: 'q', state: 'prepping', zone: { box: [0, -64, 0, 1, 320, 1] } }] }, null, REPORT) },
      { label: 'its requests are no list', input: 'siteprep', why: /its requests are no list/, run: M => same(M.prepZones, { requests: 5 }, null, REPORT) },
      // Codex round 5 (3): a request that keeps its zone and whose state is gone, or is none prepStep writes -- filtered out, zone and all
      { label: 'a request whose state is none of the known', input: 'siteprep', why: /state is none of the known/, run: M => { const rec = { requests: [{ id: 'm', zone: { box: [0, -64, 0, 1, 320, 1] } }] }; assert.deepStrictEqual(M.prepZones(rec), [], 'the control: the filter drops it'); return same(M.prepZones, rec, null, REPORT) } },
      { label: 'a request whose state is none of the known', input: 'siteprep', why: /state is none of the known/, run: M => same(M.prepZones, { requests: [{ id: 'm', state: 'prepard', zone: { box: [0, -64, 0, 1, 320, 1] } }] }, null, REPORT) },
      { label: 'a request that is no entry', input: 'siteprep', why: /a request that is no entry/, run: M => same(M.prepZones, { requests: [5, { id: 'q', state: 'prepping', zone: { box: [0, -64, 0, 1, 320, 1] } }] }, null, REPORT) },
    ],
  },
}
const SIGHT = { op: 'sight', id: 'b1', span: { near: [0, 64, -25], far: [0, 64, -22], axis: [0, 1], w: 3, rows: [{ sides: [{ deck: [0, 64, -24] }, { deck: [1, 64, -24] }] }] }, trip: 't1', t: 1 }

for (const [file, spec] of Object.entries(LEAF)) {
  await t(`${file}: the same result with and without the report; well-formed input reports nothing; each malformed entry is named; every recording site turned off alone loses its case`, async () => {
    const real = await import(URL_OF(file).href)
    for (const r of spec.good(real)) assert.deepStrictEqual(r, [], 'a well-formed (or absent) input reports nothing')
    const X = await switchable(file, { bad: !!spec.bad })
    for (const c of spec.cases) await siteCase(X, real, c)
    covered(X)
    NOTES.push(`${file}: ${X.sites.length} recording site(s), each turned off alone and caught`)
  })
}

// =================================================================================================================================
// THE REAL PATH: skills.mjs `_fillcol.keepInputs` (shopCtx + tidyInputs with one report: tidyRefresh's own call) and tidy.mjs siteStage
// over real files in the town's directory
// =================================================================================================================================
const INWALL = LP.landStages().find(q => q.id === 'inwall')
const ENV = { ROUGH: 'on', REGRADE: 'off' }
const BOT = { worldId: 'w', username: 'FcBot' }
const H = (o = {}) => ({ ok: true, head: { gen: 3, plan: plan() }, gens: [3], rejected: [], ...o })
const srv = server()
const RING = { ring: [42, 42, 48, 48] }                                  // the survey's box: a corner of flat ground (the keep-out is asked over the whole town)
const L = (...ls) => ls.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'
const KEY = plot => PJ.projKey({ x: 0, y: 70, z: 0 }, plot)
// the three records, published by the real writer into a scratch directory; their generation files are the town's
const REC = {}
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fcin-recs-'))
  const pub = (plot, body) => { const r = PJ.publishRecord(d, KEY(plot), () => body, { now: 1_700_000_000_000, by: 'T' }); assert.strictEqual(r.result, 'accepted', `publishing ${plot}`) }
  pub('shaft', { v: 1, blueprint: 'shaft@1', plot: 'shaft', box: [-30, 8, -26, 12], cells: [{ at: [-28, 70, 10], role: 'step' }], structure_complete: true })
  pub('land', { v: 1, blueprint: LP.LAND_BLUEPRINT, plot: 'land', seed: 1, home: { x: 0, y: 70, z: 0 }, corridors: [], roads: [], landmark: { box: [10, -32, 14, -28] } })
  pub('siteprep', { v: 1, blueprint: 'siteprep@1', plot: 'siteprep', requests: [{ id: 'r1', state: 'prepared', zone: { id: 'r1', box: [-16, -64, -34, -12, 320, -30], why: 'siteprep' } }] })
  // three more, each with ONE entry its reader drops (the hand-down cases below): never in the healthy town
  pub('decor', { v: 1, blueprint: 'decor@1', plot: 'decor', lawns: [{ box: [1, 2] }], cells: [] })
  pub('wallext', { v: 1, blueprint: 'wallext@1', plot: 'wallext', plots: [{ id: 'X', box: [1, 2] }], cells: [] })
  pub('yard', { v: 1, blueprint: 'yard@1', plot: 'yard', cells: [{ at: [30, 70, -30], role: 'slot' }, { at: ['x', 70, -30], role: 'slot' }] })
  // the old wall, held by its demolition (wall.mjs WALLDEMO_HOLD), and the demolition's record
  pub('wall', { v: 1, blueprint: 'wall@1', plot: 'wall', zones: [{ box: [-44, -64, -44, -40, 320, -40], why: 'hold:walldemo' }], cells: [] })
  pub('walldemo', { v: 1, blueprint: 'walldemo@1', plot: 'walldemo', structure_complete: false, cells: [] })
  for (const f of fs.readdirSync(d)) REC[f] = fs.readFileSync(path.join(d, f), 'utf8')
}
const recFile = plot => { const f = Object.keys(REC).filter(n => n.startsWith(`${KEY(plot)}.g`)); assert.strictEqual(f.length, 1, `one generation of ${plot}: ${Object.keys(REC).join(' ')}`); return f[0] }
const F = {
  zones: 'protected-zones.json', plinth: 'junkwell-plinth-0_70_0.json', site: 'junkwell-site-0_70_0.g1.json', farm: 'treefarm-0_70_0.g1.json',
  town: 'composter-site-0_70_0.g1.json', markers: 'expedition-0_70_0.markers.jsonl', bridges: 'expedition-0_70_0.bridges.jsonl',
  shaft: recFile('shaft'), land: recFile('land'), prep: recFile('siteprep'),
}
const g2 = name => name.replace(/\.g1\.json$/, '.g2.json')
const GOOD = {
  [F.zones]: { version: 1, hashed_seed: 'w', zones: [{ id: 'spawn', kind: 'village', box: [20, 60, 20, 22, 80, 22], floor_y: 64 }] },
  [F.plinth]: { plan: { steps: [{ op: 'place', c: [-20, 70, -20] }], cap: { x: -20, y: 72, z: -20 }, stair: [[-19, 70, -20]] }, prev: [{ x: -30, y: 70, z: -20, stair: [[-30, 70, -19]] }] },
  [F.site]: { x: -20, y: 70, z: -20, world: 'w' },
  [F.farm]: { record: { cells: [{ x: 20, z: -20 }, { x: 22, z: -20 }] } },
  [F.town]: { x: -10, y: 70, z: 20, world: 'w' },
  [F.markers]: L({ at: [25, 70, 0], t: 1 }),
  [F.bridges]: L(SIGHT, { op: 'state', id: 'b1', complete: false }),
  [F.shaft]: REC[F.shaft], [F.land]: REC[F.land], [F.prep]: REC[F.prep],
}
const text = v => (typeof v === 'string' ? v : JSON.stringify(v))
const wipe = () => { for (const f of fs.readdirSync(POOL)) fs.rmSync(path.join(POOL, f), { recursive: true, force: true }) }
/** THE TOWN, written as `files` ({ name: text | object | { dir: true } }), read by the real path -> its keep-out and its report. */
function keepOf (files, { h = H(), S = SK, TM = T, bot = BOT } = {}) {
  wipe()
  for (const [n, v] of Object.entries(files)) { if (v && v.dir) fs.mkdirSync(path.join(POOL, n)); else fs.writeFileSync(path.join(POOL, n), text(v)) }
  S.resetPlanZones()
  let K
  // tidyInputs throws on a record it cannot use at all (its doc: "Throws on an unreadable file"): tidyRefresh catches that and
  // writes nothing -- no refresh, so no repair
  try { K = S._fillcol.keepInputs(bot, h, POOL) } catch (e) { return { threw: String(e?.message ?? e), keep: null, n: 0, at: () => null, report: [], names: [], closed: 'threw' } }
  const s = TM.siteStage(srv.read, { home: K.I.home, avoid: K.I.avoid, cells: K.I.cells, plan: K.I.plan, land: { seed: 1 }, stage: INWALL, env: ENV, terrace: { records: K.I.records, wall: RING, wallext: K.I.wallext, climbs: [] }, reserved: K.I.reserved, report: K.report, now: 1 })
  assert.strictEqual(s.report, K.report, 'siteStage hands the report back with its keep-out')
  assert.strictEqual(typeof s.keepOff, 'function', `the survey hands its keep-out back (${s.why})`)
  const cols = []
  for (let x = -45; x <= 45; x++) for (let z = -45; z <= 45; z++) if (s.keepOff(x, z)) cols.push(`${x},${z}`)
  const names = FC.reportNames(K.report)
  return { keep: cols.join(' '), n: cols.length, at: (x, z) => s.keepOff(x, z), report: K.report, names, zonesN: K.c.zones.length, closed: FC.repairClosed({ keepOff: s.keepOff, unread: names }) }
}
// where each input's keep-out lies (one column of it)
const AT = { zones: [21, 21], plinth: [-30, -20], site: [-20, -20], farm: [20, -20], town: [-10, 20], markers: [25, 0], bridges: [0, -24], shaft: [-28, 10], land: [12, -30], prep: [-14, -32] }

let BASE = null
await t('THE HEALTHY TOWN, every file present and sound: the report is EMPTY (the repair is open) and every input\'s keep-out is there', () => {
  BASE = keepOf(GOOD)
  assert.deepStrictEqual(BASE.report, [], `nothing reported: ${JSON.stringify(BASE.report)}`)
  assert.strictEqual(BASE.closed, null)
  for (const [k, [x, z]] of Object.entries(AT)) assert.ok(BASE.at(x, z), `${k}: its keep-out holds ${x},${z}`)
  assert.strictEqual(BASE.at(40, 40), null, 'the control: open ground is no keep-out')
  NOTES.push(`healthy town: ${BASE.n} keep-out columns of 8281, report empty`)
})
await t('ABSENT -> EMPTY -> OPEN: a town with none of the files, and the healthy town less each one in turn, reports nothing (only that input\'s keep-out is gone)', () => {
  const none = keepOf({})
  assert.deepStrictEqual(none.report, [], JSON.stringify(none.report)); assert.strictEqual(none.closed, null)
  for (const [k, [x, z]] of Object.entries(AT)) {
    if (k === 'site') continue                                   // (the well's site column is the plinth's too)
    const files = { ...GOOD }
    delete files[F[k]]
    if (k === 'plinth') delete files[F.site]
    const r = keepOf(files)
    assert.deepStrictEqual(r.report, [], `${k} absent: nothing reported (${JSON.stringify(r.report)})`)
    assert.strictEqual(r.closed, null, `${k} absent: the repair is open`)
    assert.ok(!r.at(x, z), `${k} absent: its keep-out is gone (the control: the file is what put it there)`)
  }
})
await t('THE SAME KEEP-OUT WITH AND WITHOUT THE REPORT: tidyInputs and siteStage answer byte for byte the same (healthy and broken towns)', () => {
  const rough = server()
  for (let x = 43; x <= 47; x++) rough.set([x, G, 45], 'air')
  for (const files of [GOOD, {}, { ...GOOD, [F.bridges]: L(SIGHT) + '{"op":"sight"' + '\n', [F.plinth]: '{', [F.markers]: L({ gone: true }) }]) {
    wipe(); for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(POOL, n), text(v)); SK.resetPlanZones()
    const P0 = SK._fillcol.plainInputs(BOT, H(), POOL)
    const args = I => ({ home: I.home, avoid: I.avoid, cells: I.cells, plan: I.plan, land: { seed: 1 }, stage: INWALL, env: ENV, terrace: { records: I.records, wall: RING, wallext: I.wallext, climbs: [] }, reserved: I.reserved, now: 1 })
    const plain = T.siteStage(rough.read, args(P0.I))
    const report = []
    SK.resetPlanZones()
    const K = SK._fillcol.keepInputs(BOT, H(), POOL)
    const rep = T.siteStage(rough.read, { ...args(K.I), report })
    assert.ok(!('report' in plain), 'no report asked, none handed back')
    const strip = s => JSON.stringify({ ...s, keepOff: undefined, report: undefined })
    assert.strictEqual(strip(rep), strip(plain), 'the survey\'s result is the same')
    const cols = s => { const o = []; for (let x = -45; x <= 45; x++) for (let z = -45; z <= 45; z++) o.push(s.keepOff(x, z)); return JSON.stringify(o) }
    assert.strictEqual(cols(rep), cols(plain), 'the keep-out is the same')
  }
})

// ---- CODEX ROUND 4, THE TWO CASES ----
await t('BLOCKER 1: a bridge sighting with near and axis but NO ROWS -- the zone builder throws and every bridge reservation is gone: reported, the repair CLOSED (control: the sound file is open and reserved)', () => {
  const bad = keepOf({ ...GOOD, [F.bridges]: L({ ...SIGHT, span: { near: SIGHT.span.near, far: SIGHT.span.far, axis: SIGHT.span.axis, w: 3 } }) })
  assert.ok(!bad.at(...AT.bridges), 'the bridge\'s reservation is gone from the keep-out (the lenient reader\'s answer)')
  assert.ok(has(bad.report, 'bridges', /zone builder threw: no bridge is reserved/), JSON.stringify(bad.report))
  assert.strictEqual(bad.closed, 'excl_unread:bridges')
  assert.ok(BASE.at(...AT.bridges) && BASE.closed === null)
})
await t('BLOCKER 2: a marker pushed out of the reader\'s window of 2,000 lines by whitespace lines -- the survey never sees it: reported, CLOSED (control: the same file without the padding is open, the marker in the keep-out)', () => {
  const padded = keepOf({ ...GOOD, [F.markers]: L({ at: [25, 70, 0], t: 1 }) + ' \n'.repeat(2000) })
  assert.ok(!padded.at(...AT.markers), 'the marker is out of the window: not in the keep-out')
  assert.ok(has(padded.report, 'markers', /1 line\(s\) before the window of 2000 are not read/), JSON.stringify(padded.report.slice(0, 3)))
  assert.strictEqual(padded.closed, 'excl_unread:markers')
  const plain = keepOf({ ...GOOD, [F.markers]: L({ at: [25, 70, 0], t: 1 }) })
  assert.deepStrictEqual(plain.report, []); assert.strictEqual(plain.closed, null)
  assert.ok(plain.at(...AT.markers), 'the marker\'s column is in the keep-out')
  // empty lines are no line for that reader (it drops them before its window): 2,000 of them push nothing out
  const blank = keepOf({ ...GOOD, [F.markers]: L({ at: [25, 70, 0], t: 1 }) + '\n'.repeat(2000) })
  assert.deepStrictEqual(blank.report, []); assert.ok(blank.at(...AT.markers))
})

// ---- EVERY RECORDING SITE OF skills.mjs, turned off alone ----
const FAULTS = [
  ['z = markerZones(exMarkers(report), 1, report)', "z = __fcFault('markerZones', () => markerZones(exMarkers(report), 1, report))"],
  ['const z = hallPadZone(plan, blueprintOf(HALL_BLUEPRINT))', "const z = __fcFault('hallpad', () => hallPadZone(plan, blueprintOf(HALL_BLUEPRINT)))"],
  ['lmz = landmarkZones(landHead(dir, report), report)', "lmz = __fcFault('landmark', () => landmarkZones(landHead(dir, report), report))"],
  ["const h = recordHead(dir, projKeyOf(SITEPREP_PLOT)); headReport(report, 'siteprep'", "const h = __fcFault('siteprepHead', () => recordHead(dir, projKeyOf(SITEPREP_PLOT))); headReport(report, 'siteprep'"],
  ["const h = recordHead(dir, projKeyOf(LAND_PLOT)); headReport(report, 'land'", "const h = __fcFault('landHead', () => recordHead(dir, projKeyOf(LAND_PLOT))); headReport(report, 'land'"],
  ['const st = readTownSite(dir, townSiteKey(), report).site', "const st = __fcFault('townsite', () => readTownSite(dir, townSiteKey(), report)).site"],
  ['function treeFarmCells (report = null) {\n  const out = new Set()\n  try {\n', "function treeFarmCells (report = null) {\n  const out = new Set()\n  try {\n    __fcFault('farmdir', () => null)\n"],
]
const torn = name => ({ ...GOOD, [g2(name)]: '{"v":1,' })
const swap = (txt, old, neu) => { assert.strictEqual(txt.split(old).length, 2, `the record's text holds ${old} once`); return txt.replace(old, neu) }
// the old wall held by its demolition, the demolition's completion written as `v` (JSON text)
const DEMO = v => ({ ...GOOD, [recFile('wall')]: REC[recFile('wall')], [recFile('walldemo')]: swap(REC[recFile('walldemo')], '"structure_complete":false', `"structure_complete":${v}`) })
const YARD_OK = swap(REC[recFile('yard')], '"at":["x",70,-30]', '"at":[31,70,-30]')   // the yard, every cell sound
const NO_TOWN = (() => { const f = { ...GOOD }; delete f[F.town]; return f })()      // no composter site on file: the plan's own stands
const planWith = f => H({ head: { gen: 3, plan: { ...plan(), plots: plan().plots.map(f) } } })
const HALL_AT = sector => planWith(q => (q.id === 'hall' ? { ...q, sector } : q))
const FARM_AS = kind => planWith(q => (q.id === 'farm' ? { ...q, kind, composter: [15, 70, -12] } : q))
const town = (files, o = {}) => M => keepOf(files, { S: M, ...o }).report
const SKILL_CASES = [
  { label: 'lists no cells', input: 'treefarm', why: /generation 2 lists no cells/, run: town({ ...GOOD, [g2(F.farm)]: { record: {} } }) },
  { label: "input: 'treefarm', why: 'a cell without a place'", input: 'treefarm', why: /a cell without a place/, run: town({ ...GOOD, [g2(F.farm)]: { record: { cells: [{ x: 20, z: -20 }, { x: 22 }] } } }) },
  { label: 'cannot be read: an older one is tried', input: 'treefarm', why: /generation 2 cannot be read: an older one is tried/, run: town({ ...GOOD, [g2(F.farm)]: 'torn' }) },
  { label: "input: 'treefarm', why: 'the directory cannot be listed'", input: 'treefarm', why: /directory cannot be listed/, run: town(GOOD), fault: 'farmdir' },
  { label: "why: 'the record cannot be read'", input: 'x', why: /the record cannot be read/, run: M => { const r = []; M._fillcol.headReport(r, 'x', { ok: false, head: null, gens: [], rejected: [] }); M._fillcol.headReport(r, 'y', { ok: true, head: null, gens: [], rejected: [] }); assert.ok(!r.some(q => q.input === 'y'), 'a record never sited says nothing'); return r } },
  { label: 'its newest generation is rejected', input: 'record:shaft', why: /newest generation is rejected: an older one is the head/, run: town(torn(F.shaft)) },
  { label: 'a record of another blueprint', input: 'land', why: /another blueprint: read as none/, run: town({ ...GOOD, [F.land]: REC[F.land].replace('"blueprint":"land@1"', '"blueprint":"land@0"') }) },
  { label: 'headReport(report, `record:${p.plot}`, h)', input: 'record:shaft', why: /newest generation is rejected/, run: town(torn(F.shaft)) },
  { label: 'the heads read so far stand alone', input: 'records', why: /reader threw/, run: town({ ...GOOD, [F.land]: REC[F.land].replace('"corridors":[]', '"corridors":5') }) },
  { label: "headReport(report, 'siteprep'", input: 'siteprep', why: /newest generation is rejected/, run: town(torn(F.prep)) },
  { label: "input: 'siteprep', why: 'the record", input: 'siteprep', why: /record's reader threw/, run: town(GOOD), fault: 'siteprepHead' },
  { label: "headReport(report, 'land'", input: 'land', why: /newest generation is rejected/, run: town(torn(F.land)) },
  { label: "input: 'land', why: 'the record", input: 'land', why: /record's reader threw/, run: town(GOOD), fault: 'landHead' },
  { label: 'the protected zones are', input: 'zones', why: /the protected zones are unknown/, run: town({ ...GOOD, [F.zones]: { version: 1, zones: [{ id: 'a', box: [1, 2] }] } }) },
  { label: "why: 'the plinth file cannot be read' }", input: 'wells', why: /^the plinth file cannot be read$/, run: town({ ...GOOD, [F.plinth]: '{"plan":' }) },
  { label: 'site names no place', input: 'wells', why: /site names no place/, run: town({ ...GOOD, [F.site]: { x: -20, y: 70 } }) },
  { label: 'site cannot be read', input: 'wells', why: /site cannot be read/, run: town({ ...GOOD, [F.site]: '{"x":' }) },
  { label: 'the site reader threw: no site is read', input: 'bridges', why: /site reader threw/, run: town({ ...GOOD, [F.bridges]: L(SIGHT, { ...SIGHT, id: 'b2', span: { ...SIGHT.span, axis: 5 } }) }) },
  { label: 'before the window of', input: 'markers', why: /before the window of 2000/, run: town({ ...GOOD, [F.markers]: L({ at: [25, 70, 0] }) + ' \n'.repeat(2000) }) },
  { label: 'a line that holds no entry', input: 'markers', why: /a line that holds no entry/, run: town({ ...GOOD, [F.markers]: L({ at: [25, 70, 0] }, 'null') }) },
  { label: 'a line that does not parse', input: 'bridges', why: /a line that does not parse/, run: town({ ...GOOD, [F.bridges]: L(SIGHT) + '{"op":"sight","span":{"near":[40,64,' + '\n' }) },
  { label: 'the file cannot be read (', input: 'markers', why: /the file cannot be read \(EISDIR\)/, run: town({ ...GOOD, [F.markers]: { dir: true } }) },
  { label: 'a line without a place', input: 'markers', why: /a line without a place/, run: town({ ...GOOD, [F.markers]: L({ at: [25, 70, 0] }, { gone: true }) }) },
  { label: "headReport(report, 'plan'", input: 'plan', why: /newest generation is rejected/, run: town(GOOD, { h: H({ gens: [3, 4], rejected: [{ gen: 4, why: 'schema: plots' }] }) }) },
  { label: '(the cap)', input: 'wells', why: /the plinth file cannot be read \(the cap\)/, run: town({ ...GOOD, [F.plinth]: '{"plan":' }) },
  { label: 'cap names no place', input: 'wells', why: /the plinth's cap names no place/, run: town({ ...GOOD, [F.plinth]: { plan: { cap: { x: -20, y: 72 } } } }) },
  { label: "input: 'townsite', why: 'the site", input: 'townsite', why: /site's reader threw/, run: town(GOOD), fault: 'townsite' },
  { label: "s zone builder threw' }); lmz = []", input: 'land', why: /landmark's zone builder threw/, run: town(GOOD), fault: 'landmark' },
  { label: 'no marker is reserved', input: 'markers', why: /zone builder threw: no marker is reserved/, run: town(GOOD), fault: 'markerZones' },
  { label: 'no bridge is reserved', input: 'bridges', why: /zone builder threw: no bridge is reserved/, run: town({ ...GOOD, [F.bridges]: L({ ...SIGHT, span: { near: SIGHT.span.near, far: SIGHT.span.far, axis: SIGHT.span.axis } }) }) },
  { label: 'the pad is not reserved', input: 'hallpad', why: /zone builder threw: the pad is not reserved/, run: town(GOOD), fault: 'hallpad' },
  // r6 (Codex round 5, the audit's finds)
  { label: 'its completion is no yes or no', input: 'record:walldemo', why: /its completion is no yes or no/, run: town(DEMO('"yes"')) },
  { label: 'its body names another plot', input: 'record:yard', why: /its body names another plot/, run: town({ ...GOOD, [recFile('yard')]: swap(YARD_OK, '"plot":"yard"', '"plot":"yardx"') }) },
  { label: 'a line whose gone is no yes or no', input: 'markers', why: /gone is no yes or no/, run: town({ ...GOOD, [F.markers]: L({ at: [25, 70, 0] }, { at: [25, 70, 0], gone: 'no' }) }) },
  { label: 'sector is no sector', input: 'hallpad', why: /the hall plot's sector is no sector/, run: town(GOOD, { h: HALL_AT('XX') }) },
  { label: 'a composter on a plot that is no farm', input: 'plan', why: /a composter on a plot that is no farm/, run: town(NO_TOWN, { h: FARM_AS('frm') }) },
]
let SX = null
await t(`skills.mjs: every recording site (${SKILL_CASES.length} cases) -- reported on the real path, and gone when that one site is turned off; a throw inside any zone builder (markers, bridges, the hall's pad, the landmark) closes the repair, named`, async () => {
  SX = await switchable('skills.mjs', { faults: FAULTS })
  // the switchable copy is the real module while nothing is switched: the healthy town reads the same
  const same0 = keepOf(GOOD, { S: SX.M })
  assert.deepStrictEqual(same0.report, []); assert.strictEqual(same0.keep, BASE.keep)
  for (const c of SKILL_CASES) await siteCase(SX, SK, c)
  covered(SX)
  // a throw inside a zone builder: CLOSED and named (each of the four)
  for (const [fault, name] of [['markerZones', 'markers'], ['hallpad', 'hallpad'], ['landmark', 'land']]) {
    globalThis.__fcFaultOn = fault
    try { const r = keepOf(GOOD, { S: SX.M }); assert.ok(r.names.includes(name), `${fault}: ${JSON.stringify(r.names)}`); assert.ok(String(r.closed).startsWith('excl_unread:'), `${fault}: closed (${r.closed})`) } finally { globalThis.__fcFaultOn = null }
  }
  NOTES.push(`skills.mjs: ${SX.sites.length} recording sites, each turned off alone and caught`)
})

// ---- THE LEGITIMATE SKIPS SAY NOTHING (and each is a skip: its keep-out really goes), beside the malformed entry that takes the
// same branch and is named ----
await t('LEGITIMATE SKIPS on the real path say nothing: a finished demolition releases the wall\'s hold; a `gone` line retires its marker; a hall plot unsited or in another sector has no pad; a sound yard is found; the plan\'s farm names the composter', () => {
  const open = (r, what) => { assert.ok(!r.threw, `${what}: threw ${r.threw}`); assert.deepStrictEqual(r.report, [], `${what}: nothing named (${JSON.stringify(r.report)})`); assert.strictEqual(r.closed, null) }
  const closed = (r, input, what) => { assert.ok(r.names.includes(input), `${what}: ${input} named (${JSON.stringify(r.names)})`); assert.ok(String(r.closed).startsWith('excl_unread:'), `${what}: closed`) }
  // the demolition: open -> the hold is a keep-out; complete -> released, and nothing said; "yes" -> released AND named
  const held = keepOf(DEMO('false')), done = keepOf(DEMO('true')), odd = keepOf(DEMO('"yes"'))
  open(held, 'demolition open'); assert.ok(held.at(-42, -42), 'the hold is a keep-out')
  open(done, 'demolition complete'); assert.ok(!done.at(-42, -42), 'the hold is released')
  closed(odd, 'record:walldemo', 'a completion that is no yes or no'); assert.ok(!odd.at(-42, -42), 'the hold is released by it all the same')
  // a marker: `gone: true` retires it, and nothing said; `gone: "no"` retires it too -- named
  const gone = keepOf({ ...GOOD, [F.markers]: L({ at: [25, 70, 0] }, { at: [25, 70, 0], gone: true }) })
  open(gone, 'a marker gone'); assert.ok(!gone.at(...AT.markers))
  const goneOdd = keepOf({ ...GOOD, [F.markers]: L({ at: [25, 70, 0] }, { at: [25, 70, 0], gone: 'no' }) })
  closed(goneOdd, 'markers', 'gone: "no"'); assert.ok(!goneOdd.at(...AT.markers))
  // the hall's pad: in the pad's sector it is reserved; unsited (null) or in another sector there is none, and nothing said
  const sw = keepOf(GOOD, { h: HALL_AT('SW') })
  open(sw, 'the hall in SW'); assert.ok(sw.at(-15, 27), 'the pad is a keep-out'); assert.ok(!BASE.at(-15, 27), 'the control: unsited, no pad')
  open(keepOf(GOOD, { h: HALL_AT('E') }), 'the hall in another sector')
  closed(keepOf(GOOD, { h: HALL_AT('XX') }), 'hallpad', 'a sector that is no sector')
  // the yard: found by its body's plot -- its cells' box + 2 is the no-litter keep-out
  const yard = keepOf({ ...GOOD, [recFile('yard')]: YARD_OK })
  open(yard, 'a sound yard'); assert.strictEqual(yard.at(33, -28), 'no_litter')
  const yardx = keepOf({ ...GOOD, [recFile('yard')]: swap(YARD_OK, '"plot":"yard"', '"plot":"yardx"') })
  closed(yardx, 'record:yard', 'a yard whose body names another plot'); assert.notStrictEqual(yardx.at(33, -28), 'no_litter')
  // the plan's composter (no site on file): the farm plot's is a keep-out; on a plot of another kind it is passed over -- named
  const farm = keepOf(NO_TOWN, { h: FARM_AS('farm') })
  open(farm, 'the plan\'s farm'); assert.ok(farm.at(15, -12))
  const frm = keepOf(NO_TOWN, { h: FARM_AS('frm') })
  closed(frm, 'plan', 'a composter on no farm'); assert.ok(!frm.at(15, -12))
})
await t('THE ZONES\' WORLD: the file bound to this world is read (the showcase\'s own file, 0 named); bound to another world it reads as none -- named, the repair closed; the condition taken out loses it', async () => {
  const other = { ...GOOD, [F.zones]: { ...GOOD[F.zones], hashed_seed: 'another' } }
  const r = keepOf(other)
  assert.ok(has(r.report, 'zones', /none: the file names another world/), JSON.stringify(r.report)); assert.strictEqual(r.closed, 'excl_unread:zones'); assert.ok(!r.at(...AT.zones))
  // the bot's world unknown ('': no hashed seed at login): the file is honoured, as protectzone's guard honours it
  const unk = keepOf(other, { bot: { worldId: '', username: 'FcBot' } })
  assert.deepStrictEqual(unk.report, []); assert.ok(unk.at(...AT.zones))
  // the showcase's real file (test/fixtures), read by a bot in its world: every zone read, nothing named
  const real = JSON.parse(fs.readFileSync(new URL('./fixtures/protected-zones.showcase.json', import.meta.url), 'utf8'))
  const sc = keepOf({ ...GOOD, [F.zones]: real }, { bot: { worldId: String(real.hashed_seed), username: 'FcBot' } })
  assert.deepStrictEqual(sc.report, [], JSON.stringify(sc.report)); assert.strictEqual(sc.zonesN, real.zones.length); assert.ok(real.zones.length > 0)
  NOTES.push(`the showcase's zones file: ${real.zones.length} zones read, 0 named`)
  const M = await mutantOf('skills.mjs', " || zones.why === 'another world')) report.push(", ')) report.push(')
  assert.ok(!has(keepOf(other, { S: M }).report, 'zones', /another world/), 'MUTANT SURVIVED: the other world\'s file is still named')
})

// ---- EVERY HAND-DOWN OF THE REPORT: each leaf's entry is reached from the refresh's own path (keepInputs, then siteStage), and the
// hand-down that carries it there, taken out (a copy of the file with `report` dropped from that ONE call), loses it ----
/** A copy of src/`file` with `old` -> `neu` (present and unique). */
async function mutantOf (file, old, neu) {
  const src = fs.readFileSync(URL_OF(file), 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE (${file}): ${old.slice(0, 70)}`)
  const p = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(p, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await import(p.href) } finally { try { fs.unlinkSync(p) } catch {} }
}
const FAR_X = { ...GOOD, [F.bridges]: L({ ...SIGHT, span: { ...SIGHT.span, far: ['x', 64, -22] } }) }
const HAND = [
  // skills.mjs
  { name: 'keepInputs -> shopCtx', files: { ...GOOD, [F.zones]: { version: 1, zones: [{ id: 'a', box: [1, 2] }] } }, input: 'zones', why: /protected zones are unknown/, drop: ['skills.mjs', 'const c = shopCtx(bot, report)', 'const c = shopCtx(bot)'] },
  { name: 'keepInputs -> tidyInputs', files: { ...GOOD, [F.markers]: L({ at: [25, 70, 0] }, { gone: true }) }, input: 'markers', why: /a line without a place/, drop: ['skills.mjs', 'const I = tidyInputs(bot, c, h, dir, { report })', 'const I = tidyInputs(bot, c, h, dir, {})'] },
  { name: 'shopCtx -> plinthCells', files: { ...GOOD, [F.plinth]: { plan: { steps: [{ c: [-20, 70] }] } } }, input: 'wells', why: /the plinth record: a step cell without a full place/, drop: ['skills.mjs', "`junkwell-plinth-${hk}.json`), 'utf8')), report)) }", "`junkwell-plinth-${hk}.json`), 'utf8')))) }"] },
  { name: 'shopCtx -> treeFarmCells', files: { ...GOOD, [g2(F.farm)]: { record: {} } }, input: 'treefarm', why: /generation 2 lists no cells/, drop: ['skills.mjs', 'const farm = [...treeFarmCells(report)]', 'const farm = [...treeFarmCells()]'] },
  { name: 'tidyInputs -> pathsInputs', files: { ...GOOD, [F.plinth]: { plan: { cap: { x: -20, y: 72 } } } }, input: 'wells', why: /the plinth's cap names no place/, drop: ['skills.mjs', 'const P = pathsInputs(bot, c, h, dir, report)', 'const P = pathsInputs(bot, c, h, dir)'] },
  { name: 'pathsInputs -> readTownSite', files: { ...GOOD, [g2(F.town)]: { x: 1, y: 2 } }, input: 'townsite', why: /generation 2 names no place/, drop: ['skills.mjs', 'const st = readTownSite(dir, townSiteKey(), report).site', 'const st = readTownSite(dir, townSiteKey()).site'] },
  { name: 'tidyInputs -> pathAvoid', files: { ...GOOD, [F.shaft]: swap(REC[F.shaft], '"at":[-28,70,10]', '"at":[-28,70]') }, input: 'record:shaft', why: /a cell without a place/, drop: ['skills.mjs', 'farm: P.farm, records: recs, home, report })', 'farm: P.farm, records: recs, home })'] },
  { name: 'tidyInputs -> recordZones', files: { ...GOOD, [F.shaft]: swap(REC[F.shaft], '"box":[-30,8,-26,12]', '"box":[-30,8,-26]') }, input: 'record:shaft', why: /its box is no box/, drop: ['skills.mjs', '[...recordZones(recs, undefined, report).filter(z => !(prepExcept && z?.id === prepExcept)), ...hallPadZones(', '[...recordZones(recs).filter(z => !(prepExcept && z?.id === prepExcept)), ...hallPadZones('] },
  { name: 'tidyInputs -> tidyAvoid', files: FAR_X, input: 'reservations', why: /a reservation without a box \(expedition:bridge\)/, drop: ['skills.mjs', '...hallPadZones(P.plan, report), ...townMarkerZones(report)], report)', '...hallPadZones(P.plan, report), ...townMarkerZones(report)])'] },
  { name: 'townMarkerZones -> markerZones', files: { ...GOOD, [F.markers]: L({ at: [25, 70] }) }, input: 'markers', why: /a marker without a full place/, drop: ['skills.mjs', 'z = markerZones(exMarkers(report), 1, report)', 'z = markerZones(exMarkers(report), 1)'] },
  { name: 'townMarkerZones -> exMarkers', files: { ...GOOD, [F.markers]: L({ at: [25, 70, 0] }, { gone: true }) }, input: 'markers', why: /a line without a place/, drop: ['skills.mjs', 'z = markerZones(exMarkers(report), 1, report)', 'z = markerZones(exMarkers(), 1, report)'] },
  { name: 'exMarkers -> exLines', files: { ...GOOD, [F.markers]: L({ at: [25, 70, 0] }) + '{"at":[' + '\n' }, input: 'markers', why: /a line that does not parse/, drop: ['skills.mjs', "exLines(exMarkersFile(), 2000, report, 'markers')", 'exLines(exMarkersFile(), 2000)'] },
  { name: 'townMarkerZones -> bridgeZones', files: FAR_X, input: 'bridges', why: /a point without a place/, drop: ['skills.mjs', '...bridgeZones(exBridgeSites(report), 1, report)]', '...bridgeZones(exBridgeSites(report), 1)]'] },
  { name: 'townMarkerZones -> exBridgeSites', files: { ...GOOD, [F.bridges]: L(SIGHT, { op: 'sight', id: 'b2' }) }, input: 'bridges', why: /a sighting without its span/, drop: ['skills.mjs', '...bridgeZones(exBridgeSites(report), 1, report)]', '...bridgeZones(exBridgeSites(), 1, report)]'] },
  { name: 'exBridgeSites -> bridgeSites', files: { ...GOOD, [F.bridges]: L(SIGHT, { op: 'sight', id: 'b2' }) }, input: 'bridges', why: /a sighting without its span/, drop: ['skills.mjs', "bridgeSites(exLines(exBridgesFile(), 4000, report, 'bridges'), report)", "bridgeSites(exLines(exBridgesFile(), 4000, report, 'bridges'))"] },
  { name: 'exBridgeSites -> exLines', files: { ...GOOD, [F.bridges]: L(SIGHT) + '{"op":' + '\n' }, input: 'bridges', why: /a line that does not parse/, drop: ['skills.mjs', "bridgeSites(exLines(exBridgesFile(), 4000, report, 'bridges'), report)", 'bridgeSites(exLines(exBridgesFile(), 4000), report)'] },
  { name: 'tidyInputs -> landmarkZones', files: { ...GOOD, [F.land]: swap(REC[F.land], '"landmark":{"box":[10,-32,14,-28]}', '"landmark":{"box":[10,-32]}') }, input: 'land', why: /the landmark has no box/, drop: ['skills.mjs', 'lmz = landmarkZones(landHead(dir, report), report)', 'lmz = landmarkZones(landHead(dir, report))'] },
  { name: 'tidyInputs -> lawnZonesOf', files: { ...GOOD, [recFile('decor')]: REC[recFile('decor')] }, input: 'record:decor', why: /a lawn without a box/, drop: ['skills.mjs', 'rz.push(...lawnZonesOf(recs, report))', 'rz.push(...lawnZonesOf(recs))'] },
  { name: 'projectHeads -> siteprepHead', files: { ...GOOD, [g2(F.prep)]: '{"v":1,' }, input: 'siteprep', why: /newest generation is rejected/, drop: ['skills.mjs', 'const sp = siteprepHead(dir, report)', 'const sp = siteprepHead(dir)'] },
  { name: 'projectHeads -> prepReservation -> prepZones', files: { ...GOOD, [F.prep]: swap(REC[F.prep], ',"zone":{"id":"r1","box":[-16,-64,-34,-12,320,-30],"why":"siteprep"}', '') }, input: 'siteprep', why: /a reserved plot without its zone/, drop: ['skills.mjs', 'prepReservation(sp, null, report)', 'prepReservation(sp, null)'] },
  // tidy.mjs siteStage
  { name: 'siteStage -> plotPrep', files: { ...GOOD, [recFile('wallext')]: REC[recFile('wallext')] }, input: 'record:wallext', why: /a plot without a box/, drop: ['tidy.mjs', 'avoid, cells, noStair, report })', 'avoid, cells, noStair })'] },
  // (the yard's cell is named twice: once by pathAvoid, over every record, and once by the survey's own no-litter box)
  { name: 'siteStage -> inwallNoLitter', files: { ...GOOD, [recFile('yard')]: REC[recFile('yard')] }, input: 'record:yard', why: /a cell without a place/, count: 2, drop: ['tidy.mjs', 'const noLitterK = inwallNoLitter(terrace?.records ?? [], report)', 'const noLitterK = inwallNoLitter(terrace?.records ?? [])'] },
]
await t(`EVERY HAND-DOWN OF THE REPORT (${HAND.length}): the leaf's entry reaches the refresh's report through the real path, and is lost when that one hand-down drops \`report\``, async () => {
  const n = (r, c) => r.report.filter(q => q.input === c.input && c.why.test(String(q.why))).length
  for (const c of HAND) {
    const real = keepOf(c.files)
    assert.ok(!real.threw, `${c.name}: the real path threw (${real.threw})`)
    assert.strictEqual(n(real, c) >= (c.count ?? 1), true, `${c.name}: ${c.input} ${c.why} is not in the report (${JSON.stringify(real.report).slice(0, 300)})`)
    if (c.count) assert.strictEqual(n(real, c), c.count, `${c.name}: named ${c.count} times`)
    assert.ok(String(real.closed).startsWith('excl_unread:'), `${c.name}: the repair is closed (${real.closed})`)
    const M = await mutantOf(...c.drop)
    const mut = keepOf(c.files, c.drop[0] === 'tidy.mjs' ? { TM: M } : { S: M })
    assert.ok(!mut.threw, `${c.name}: the mutant threw (${mut.threw})`)
    assert.ok(n(mut, c) < (c.count ?? 1), `MUTANT SURVIVED: ${c.name} -- \`report\` dropped, ${c.input} ${c.why} is still named ${n(mut, c)} time(s)`)
  }
  NOTES.push(`hand-downs: ${HAND.length}, each reached on the real path and lost with its \`report\` dropped`)
})

// ---- A THROW NO CATCH HOLDS: a zone builder tidyInputs or siteStage calls bare throws through them -- tidyRefresh's own catch then
// writes nothing at all (no refresh, so no repair): never a smaller keep-out handed on as whole ----
await t('A THROW INSIDE A ZONE BUILDER NO CATCH HOLDS (pathAvoid, recordZones, lawnZonesOf; siteStage\'s plotPrep and inwallNoLitter) throws through tidyInputs / siteStage; tidyRefresh holds both in the try whose catch writes nothing', async () => {
  const SF = await switchable('skills.mjs', { faults: [
    ['pathAvoid({ plan: P.plan, zones: P.zones, caps: P.caps, plinth: P.plinth, composter: P.composter, farm: P.farm, records: recs, home, report })', "__fcFault('pathAvoid', () => pathAvoid({ plan: P.plan, zones: P.zones, caps: P.caps, plinth: P.plinth, composter: P.composter, farm: P.farm, records: recs, home, report }))"],
    ['[...recordZones(recs, undefined, report).filter(z => !(prepExcept && z?.id === prepExcept)), ...hallPadZones(', "[...__fcFault('recordZones', () => recordZones(recs, undefined, report)).filter(z => !(prepExcept && z?.id === prepExcept)), ...hallPadZones("],
    ['rz.push(...lawnZonesOf(recs, report))', "rz.push(...__fcFault('lawnZonesOf', () => lawnZonesOf(recs, report)))"],
  ] })
  assert.ok(!keepOf(GOOD, { S: SF.M }).threw, 'the control: no fault, no throw')
  for (const f of ['pathAvoid', 'recordZones', 'lawnZonesOf']) {
    globalThis.__fcFaultOn = f
    try { assert.match(String(keepOf(GOOD, { S: SF.M }).threw), new RegExp(`fault ${f}`), `${f}: tidyInputs throws`) } finally { globalThis.__fcFaultOn = null }
  }
  const TF = await switchable('tidy.mjs', { faults: [
    ['const noLitterK = inwallNoLitter(terrace?.records ?? [], report)', "const noLitterK = __fcFault('inwallNoLitter', () => inwallNoLitter(terrace?.records ?? [], report))"],
    ['const pp = plotPrep(read, {', "const pp = __fcFault('plotPrep', () => null) ?? plotPrep(read, {"],
  ] })
  assert.ok(keepOf(GOOD, { TM: TF.M }).n === BASE.n, 'the control: no fault, the same keep-out')
  for (const f of ['inwallNoLitter', 'plotPrep']) {
    globalThis.__fcFaultOn = f
    try { assert.throws(() => keepOf(GOOD, { TM: TF.M }), new RegExp(`fault ${f}`), `${f}: siteStage throws`) } finally { globalThis.__fcFaultOn = null }
  }
  // structural (what behaviour cannot reach without a live bot): in tidyRefresh both calls stand inside the try, and its catch
  // answers null -- nothing published. Proven to fail on a copy of the text whose catch falls through
  const holds = src => {
    const a = src.indexOf('async function tidyRefresh (bot, c, h, dir, key, rh, me, signal) {')
    const seq = ['  try {\n', 'const K = fillColumnOn() ? fcKeepInputs(bot, h, dir) : null', 's = await siteStage(read, {', '  } catch (e) {\n    if (e?.aborted || signal?.aborted) throw e\n    return null\n  }\n  if (!s?.ok) return null']
    let at = a
    for (const q of seq) { at = at < 0 ? -1 : src.indexOf(q, at + 1); if (at < 0) return false }
    return a >= 0 && at - a < 6000
  }
  const src = fs.readFileSync(URL_OF('skills.mjs'), 'utf8')
  assert.ok(holds(src), 'tidyRefresh: the inputs and the survey inside the try, the catch answers null')
  const old = '    if (e?.aborted || signal?.aborted) throw e\n    return null\n  }\n  if (!s?.ok) return null'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.ok(!holds(src.replace(old, '    if (e?.aborted || signal?.aborted) throw e\n  }\n  if (!s?.ok) return null')), 'MUTANT SURVIVED: the catch falls through')
})

// ---- THE PROPERTY: for generated malformed variants of every file, the keep-out is the well-formed file's, or the report is not
// empty -- never a smaller keep-out and an empty report ----
const kinds = { wrongLength: 0, missing: 0, unknown: 0, wrongType: 0 }   // how many of each of round 5's kinds the generator made
function variants (name, good) {
  const out = []
  const jsonl = name.endsWith('.jsonl')
  const add = (how, s) => { if (s !== good) out.push({ how, text: s }) }
  // cut off mid-way (a JSONL file inside a line: at a line's end it is a sound, shorter file)
  for (const f of [0.2, 0.45, 0.7, 0.95]) { let i = Math.max(1, Math.floor(good.length * f)); while (jsonl && i < good.length - 1 && (good[i - 1] === '\n' || good[i] === '\n')) i++; add(`cut@${i}`, good.slice(0, i)) }
  add('cut-last', good.slice(0, jsonl ? -2 : -1))
  // a document, or a line, of the wrong kind
  for (const d of ['null', '[]', '"x"', '0', 'garbage']) add(`doc:${d}`, jsonl ? good + d + '\n' : d)
  // a number that is no number any more (each one in turn), and one cut out
  const nums = [...good.matchAll(/-?\d+(?:\.\d+)?/g)].slice(0, 60)
  for (const m of nums) { add(`num@${m.index}->"x"`, good.slice(0, m.index) + '"x"' + good.slice(m.index + m[0].length)); add(`num@${m.index}->null`, good.slice(0, m.index) + 'null' + good.slice(m.index + m[0].length)) }
  // STRUCTURE (r6, Codex round 5: + the last four): an array of numbers one short; an entry's own key gone; a list or an entry that is a
  // number; an array of numbers one LONG (every box and place, both wrong lengths); an op / state / kind / role MISSING, and one (a
  // sector and a material too) of a value NO ONE WRITES; a scalar of the WRONG TYPE (a number true, a string 5, a yes-or-no "x" and 0)
  const ENUM = new Set(['op', 'state', 'kind', 'role']), UNK = new Set([...ENUM, 'sector', 'mat'])
  const REQ = new Set(['x', 'y', 'z', 'at', 'near', 'far', 'axis', 'rows', 'sides', 'deck', 'c', 'zone', 'span', ...(/treefarm/.test(name) ? ['cells'] : []), ...(/protected-zones|landmark|siteprep|\.land\.|junkwell|expedition/.test(name) ? ['box'] : [])])
  const walk = (v, edit, pathOf = []) => {
    if (v && typeof v === 'object' && pathOf.length) edit(pathOf, 'num')   // a list or an entry that is a number
    if (Array.isArray(v)) { if (v.length >= 2 && v.every(q => typeof q === 'number')) { edit(pathOf, 'pop'); edit(pathOf, 'push') } v.forEach((q, i) => walk(q, edit, [...pathOf, i])) } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (REQ.has(k) || (ENUM.has(k) && typeof v[k] === 'string')) edit([...pathOf, k], 'del')
        if (UNK.has(k) && typeof v[k] === 'string') edit([...pathOf, k], 'unk')
        walk(v[k], edit, [...pathOf, k])
      }
    } else if (pathOf.length) {
      if (typeof v === 'number') edit(pathOf, 'true'); else if (typeof v === 'string') edit(pathOf, 'five'); else if (typeof v === 'boolean') { edit(pathOf, 'str'); edit(pathOf, 'zero') }
    }
  }
  const mutate = (doc, pathOf, op) => {
    const c = JSON.parse(JSON.stringify(doc))
    let o = c
    for (const k of pathOf.slice(0, -1)) o = o[k]
    const last = pathOf.at(-1)
    if (op === 'pop') (pathOf.length ? o[last] : c).pop(); else if (op === 'push') (pathOf.length ? o[last] : c).push(0); else if (op === 'del') delete o[last]
    else o[last] = { num: 5, unk: 'zz-unknown', true: true, five: 5, str: 'x', zero: 0 }[op]
    // (one count a variant made, by round 5's kinds)
    if (op === 'pop' || op === 'push') kinds.wrongLength++; else if (op === 'unk') kinds.unknown++; else if (op === 'del' && ENUM.has(last)) kinds.missing++; else if (op !== 'del') kinds.wrongType++
    return c
  }
  if (jsonl) {
    const lines = good.split('\n').filter(Boolean)
    lines.forEach((l, li) => { const doc = JSON.parse(l); walk(doc, (p, op) => add(`line${li}:${op}:${p.join('.')}`, [...lines.slice(0, li), JSON.stringify(mutate(doc, p, op)), ...lines.slice(li + 1)].join('\n') + '\n')) })
    add('padded', good + ' \n'.repeat(name.includes('markers') ? 2000 : 4000))
  } else {
    const doc = JSON.parse(good)
    walk(doc, (p, op) => add(`${op}:${p.join('.')}`, JSON.stringify(mutate(doc, p, op))))
  }
  return out
}
await t('THE PROPERTY: every generated malformed variant of every file leaves the keep-out as the sound file\'s, or is REPORTED -- never another keep-out and an empty report (a variant tidyInputs throws on stops the refresh itself)', () => {
  const st = { variants: 0, reported: 0, equalSilent: 0, smallerReported: 0, threw: 0, files: 0 }
  const bad = []
  for (const name of Object.values(F)) {
    st.files++
    const good = text(GOOD[name])
    for (const v of variants(name, good)) {
      st.variants++
      const r = keepOf({ ...GOOD, [name]: v.text })
      if (r.threw) { st.threw++; continue }                      // the refresh stops: nothing is written, nothing repaired
      const equal = r.keep === BASE.keep
      if (r.report.length) { st.reported++; if (!equal) st.smallerReported++ } else if (equal) st.equalSilent++; else bad.push(`${name} ${v.how}: keep-out ${r.n} vs ${BASE.n}, report empty`)
    }
  }
  NOTES.push(`property, the files: ${JSON.stringify(st)}`)
  assert.deepStrictEqual(bad.slice(0, 12), [], `${bad.length} variant(s) with a different keep-out and an empty report`)
  // not vacuous: many variants did change the keep-out (and were reported), some changed nothing
  assert.ok(st.variants > 200 && st.smallerReported > 40 && st.equalSilent >= 3, JSON.stringify(st))
})

// ---- THE PROPERTY, THE PLAN (r6): the plan reaches the refresh as a head planstore.mjs planRefusal has passed -- which checks a plot's id
// and its cells, never its box, its keep-out, its kind or its sector. Every variant of a sound plan THAT STILL PASSES planRefusal is held
// to the same rule ----
const PLAN2 = { ...plan(), prev: null, prevSha: null, plots: [
  { id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], y: G, state: 'existing', keepout: false },
  { id: 'store', kind: 'storehouse', box: [30, 30, 34, 33], y: G, state: 'planned', keepout: true, cells: [{ at: [31, 70, 31], kind: 'chest', state: 'free', seenSince: 1_700_000_000_000, stand: [31, 70, 32] }] },
  { id: 'work', kind: 'workshop', box: [30, -42, 34, -40], y: G, state: 'planned', keepout: true, stations: [{ at: [31, 70, -41], kind: 'crafting_table', state: 'placed', stand: [31, 70, -40] }] },
  { id: 'farm', kind: 'farm', sector: 'N', composter: [15, 70, -12], state: 'planned' },
  { id: 'hall', kind: 'hall', sector: 'SW', state: 'unsited' },
] }
await t('THE PROPERTY, THE PLAN: every variant of a sound plan that planRefusal still passes leaves the keep-out as the sound plan\'s, or is REPORTED', () => {
  assert.strictEqual(PS.planRefusal(PLAN2), null, 'the control: the sound plan passes the schema')
  const hOf = p => H({ head: { gen: 3, plan: p } })
  const base = keepOf(NO_TOWN, { h: hOf(PLAN2) })
  assert.deepStrictEqual(base.report, [], JSON.stringify(base.report))
  // each of the plan's keep-outs is there: the store's box and its ring of 1 (committed: a cell seen once), the workshop's, the
  // farm's composter, the hall's pad
  for (const [what, x, z] of [['the store', 32, 31], ['the store\'s ring', 35, 34], ['the workshop\'s ring', 35, -39], ['the composter', 15, -12], ['the hall\'s pad', -15, 27]]) assert.ok(base.at(x, z), `${what}: ${x},${z} is a keep-out`)
  const st = { variants: 0, unparsed: 0, refused: 0, kept: 0, reported: 0, equalSilent: 0, smallerReported: 0, threw: 0 }
  const bad = []
  for (const v of variants('plan', JSON.stringify(PLAN2))) {
    st.variants++
    let p, refused
    try { p = JSON.parse(v.text) } catch { st.unparsed++; continue }
    try { refused = PS.planRefusal(p) } catch { refused = 'threw' }
    if (refused) { st.refused++; continue }                      // never a head: the plan's own reader refuses it
    st.kept++
    const r = keepOf(NO_TOWN, { h: hOf(p) })
    if (r.threw) { st.threw++; continue }
    const equal = r.keep === base.keep
    if (r.report.length) { st.reported++; if (!equal) st.smallerReported++ } else if (equal) st.equalSilent++; else bad.push(`plan ${v.how}: keep-out ${r.n} vs ${base.n}, report empty`)
  }
  NOTES.push(`property, the plan: ${JSON.stringify(st)}`)
  assert.deepStrictEqual(bad.slice(0, 12), [], `${bad.length} variant(s) with a different keep-out and an empty report`)
  assert.ok(st.kept > 40 && st.smallerReported > 8 && st.equalSilent >= 3 && st.refused > 10, JSON.stringify(st))
})
NOTES.push(`the generator's new kinds (files and plan together): ${JSON.stringify(kinds)}`)

for (const n of NOTES) console.log(`  NOTE  ${n}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
