// CIVICROOF-01SHOW (showcase 11-19: civicP's roof stopped `no_material` on every visit -- 16 of 35 roof cells open, the bill asking 13
// dark_oak_stairs, the town, the bags and the bots' map holding no dark oak, the town 102 spruce stairs). The rule (palchoice.mjs): a
// course whose palette's first name has no source takes the next name that has one, the whole course; the bill draws it; the visit
// places only it; a `_palette_choice` row says why. Behaviour through the composed chain on the fake server: the pavilion sited by the
// bots' own siting, its roof in the live state (8 dark oak stairs, 3 spruce stairs, 8 of 9 underside planks), the choice ->
// shop.mjs billOf -> buildrun.mjs runVisit with the small vanilla (stair states judged). Anchored mutants in palchoice.mjs, shop.mjs
// and buildrun.mjs; the skills.mjs wiring by STRUCTURAL source assertions (comments stripped), each with its own mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const F = await import('./helpers/buildfake.mjs')
const { B, R, G, HOME, k3, server, plan, project } = F
const { vanillaBot } = await import('./helpers/townstylefake.mjs')
const C = await import('../src/civic.mjs')
const PC = await import('../src/palchoice.mjs')
const SH = await import('../src/shop.mjs')
const SRC = f => new URL(`../src/${f}`, import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
/** A mutant of one src file (its anchor present and unique), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(SRC(file), 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-civicroof-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** The scenario passes on the real modules and fails ITS OWN ASSERTION on the mutant (never a crash). */
const kills = async (file, old, neu, scenario, real) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- THE PAVILION (civic@1-Pd: roof ['dark_oak_stairs', 'spruce_stairs']) sited beside home, as civicvisit.test.mjs sites a plaza ----
const BP = B.loadBlueprint('civic@1-Pd')
const NEAR = [12, 0], SPEC = C.civicStandSpec(NEAR)
const cheb = (x, z, c) => Math.max(Math.abs(x - c[0]), Math.abs(z - c[1]))
const LINE = cheb(HOME.x, HOME.z, NEAR) + C.CIVIC_SITE.r + 2, WALK = Math.max(C.CIVIC_WALK_R, LINE + 12)
const SITE = B.siteBlueprint(server().read, plan(), BP, { sectors: [{ sector: null, source: 'civic' }], plot: 'civicP', tries: C.CIVIC_SITE.tries, line: LINE, walkR: WALK,
  domain: (x, z) => x >= 6 && x <= 18 && z >= -6 && z <= 6, standDomain: C.civicStandDomain(SPEC) })
assert.ok(SITE.ok, `the pavilion sites beside home (${SITE.why})`)
const REC = { ...SITE.record, palette: BP.palette, civic: { kind: 'P', look: BP.look.code }, walkR: WALK, standDom: SPEC }
const PAL = BP.palette
const [X0, Z0] = REC.box
const ROOF = REC.cells.filter(c => c.seg === 'roof')
const Y1 = Math.min(...ROOF.map(c => c.at[1]))
// THE LIVE ROOF (the showcase's intents, 11-19 12:45Z), by the box-relative column: first course 8 dark oak + 3 spruce stairs, 5 open;
// underside 1 dark oak + 7 spruce planks, (3,3) open; the upper course, its underside and the cap open
const DO = ['0,0', '1,0', '2,0', '0,1', '0,2', '0,3', '0,4', '1,4'], SP = ['3,0', '4,0', '4,1']
const UNDER_SP = ['2,1', '3,1', '1,2', '2,2', '3,2', '1,3', '2,3']
const rel = c => `${c.at[0] - X0},${c.at[2] - Z0}`
const liveName = c => {
  if (c.seg !== 'roof') return SH.roleNames(PAL, c.role, 'spruce_planks')[0]
  if (c.at[1] !== Y1) return null
  if (c.role === 'roof') return DO.includes(rel(c)) ? 'dark_oak_stairs' : SP.includes(rel(c)) ? 'spruce_stairs' : null
  if (c.role === 'under') return rel(c) === '1,1' ? 'dark_oak_planks' : UNDER_SP.includes(rel(c)) ? 'spruce_planks' : null
  return null
}
/** The fake server with the live state: every cell below the roof done, the roof as the showcase holds it (states as recorded). */
function liveWorld () {
  const srv = server()
  const props = (srv.props = new Map())
  const read0 = srv.read
  srv.read = (x, y, z) => { const b = read0(x, y, z); return b ? { ...b, props: props.get(k3([x, y, z])) ?? null } : b }
  for (const c of REC.cells) {
    if (c.seg === 'lights') continue
    const n = liveName(c)
    if (!n) continue
    srv.set(c.at, n)
    if (c.ws) props.set(k3(c.at), { ...c.ws })
  }
  return srv
}
const TOWN = { spruce_stairs: 102, dark_oak_planks: 4, dark_oak_slab: 5, lantern: 175, spruce_planks: 353, spruce_log: 400 }
const choose = (M, { town = TOWN, bag = {}, finds = [], jobs = [], read = liveWorld().read, townCoverage = 1 } = {}) => M.paletteChoice(REC, {
  townCoverage,
  names: role => SH.roleNames(PAL, role, 'spruce_planks'),
  read,
  done: (b, c) => R.cellDone(b, PAL, c.role, c.ws),
  source: (name, n, used) => M.sourceOf(name, n, { held: x => (bag[x] ?? 0) + (town[x] ?? 0) - (used?.[x] ?? 0), finds, home: HOME, jobs }),
})

console.log('THE FIXTURE (the live roof on the fake server)')
await t('the sited pavilion is the live record\'s shape: 35 roof cells (24 stairs, 10 underside planks, 1 cap); 16 open in the live state', () => {
  assert.strictEqual(ROOF.length, 35)
  assert.strictEqual(ROOF.filter(c => c.role === 'roof').length, 24); assert.strictEqual(ROOF.filter(c => c.role === 'under').length, 10)
  const read = liveWorld().read
  const open = ROOF.filter(c => !R.cellDone(read(...c.at), PAL, c.role, c.ws))
  assert.strictEqual(open.length, 16, 'the shortage report: roof 16 of 35 open')
  assert.strictEqual(open.filter(c => c.role === 'roof').length, 13, '13 stairs, as the bill asked')
  assert.strictEqual(ROOF.filter(c => read(...c.at)?.name === 'dark_oak_stairs').length, 8, 'POSITIVE CONTROL: 8 dark oak stairs placed')
})

console.log('THE CHOICE (palchoice.mjs paletteChoice)')
const liveChoice = M => {
  const { choice, rows } = choose(M)
  const roofOpen = ROOF.filter(c => c.role === 'roof' && !R.cellDone(liveWorld().read(...c.at), PAL, c.role, c.ws))
  assert.strictEqual(choice.size, 13, 'every open roof stair, and nothing else')
  for (const c of roofOpen) assert.strictEqual(choice.get(k3(c.at)), 'spruce_stairs', `${c.at}`)
  assert.deepStrictEqual(rows.map(r => [r.role, r.y, r.open, r.took]), [['roof', Y1, 5, 'spruce_stairs'], ['roof', Y1 + 1, 8, 'spruce_stairs']], 'one row a course')
  assert.match(rows[0].firstWhy, /^none\(held=0\/5\)$/); assert.match(rows[0].why, /^held:102$/)
  assert.deepStrictEqual(rows[0].placed, { dark_oak_stairs: 8, spruce_stairs: 3 }, 'the row names what the course already holds')
  for (const r of rows) assert.ok(PC.paletteChoiceDetail('civicP', r).length <= 300, 'the row fits the logger')
}
await t('the live roof: dark oak has no source -> both stair courses take spruce, every open stair; the underside and the cap keep dark oak (the town holds it)', () => liveChoice(PC))
await t('MUTANT the first name taken whenever nothing was placed in the alternative: no choice', () => kills('palchoice.mjs', '    if (!cont && first.ok) { take', '    if (!cont) { take', liveChoice, PC))
await t('a SOURCE for dark oak: the craft of 6 town logs (24 planks -> 16 stairs) keeps the design; 1 log does not', () => {
  assert.strictEqual(choose(PC, { town: { ...TOWN, dark_oak_log: 6 } }).choice.size, 0, '6 logs: the first name, no choice, no row')
  assert.strictEqual(choose(PC, { town: { ...TOWN, dark_oak_log: 6 } }).rows.length, 0)
  // the craft source is per course, by its recipe: 5 open -> 2 crafts -> 12 planks; 8 open -> 12 planks; the town's 4 planks count
  assert.strictEqual(choose(PC, { town: { ...TOWN, dark_oak_log: 1 } }).choice.size, 13, 'POSITIVE CONTROL: 1 log + the town\'s 4 dark oak planks (8) cover neither course (12 a course)')
})
await t('a SOURCE on the map (a live dark oak log find within a trip) or a refill job keeps the design; a find beyond the trip does not', () => {
  assert.strictEqual(choose(PC, { finds: [{ kind: 'dark_oak_log', x: 150, z: -90 }] }).choice.size, 0, 'a find 175 out')
  assert.strictEqual(choose(PC, { finds: [{ kind: 'dark_oak_log', x: 900, z: 0 }] }).choice.size, 13, 'a find 900 out is no source')
  assert.strictEqual(choose(PC, { finds: [{ kind: 'spruce_log', x: 10, z: 0 }] }).choice.size, 13, 'another species\' log is no source')
  assert.strictEqual(choose(PC, { jobs: [{ kind: 'dark_oak_log' }] }).choice.size, 0, 'a refill job bringing the log')
})
await t('NO SOURCE AT ALL (no spruce either): nothing is constrained (the base\'s behaviour) and each course\'s row says `none`', () => {
  const { choice, rows } = choose(PC, { town: { dark_oak_planks: 4, dark_oak_slab: 5, lantern: 175 } })
  assert.strictEqual(choice.size, 0)
  assert.deepStrictEqual(rows.map(r => [r.took, r.why]), [['-', 'none'], ['-', 'none']], JSON.stringify(rows))
})
const continued = M => {
  // a course begun in the alternative is finished in it: the upper course with 3 spruce stairs, dark oak now in town
  const srv = liveWorld()
  const up = ROOF.filter(c => c.role === 'roof' && c.at[1] === Y1 + 1)
  for (const c of up.slice(0, 3)) { srv.set(c.at, 'spruce_stairs'); srv.props.set(k3(c.at), { ...c.ws }) }
  const { choice, rows } = choose(M, { read: srv.read, town: { ...TOWN, dark_oak_stairs: 64 } })
  for (const c of up.slice(3)) assert.strictEqual(choice.get(k3(c.at)), 'spruce_stairs', `${c.at}: the course stays spruce`)
  assert.strictEqual(rows.find(r => r.y === Y1 + 1)?.why, 'course:held:102')
  assert.strictEqual(rows.some(r => r.y === Y1), false, 'the mixed first course with dark oak in town: the first name, no row')
}
await t('a course begun in the alternative stays in it when the first name comes back (never patched back to a mix)', () => continued(PC))
await t('MUTANT the continuation dropped', () => kills('palchoice.mjs', '    const cands = cont ? [cont, ...list.filter(n => n !== cont)] : list', '    const cands = list', continued, PC))

const unread = M => {
  // the rig, 11-20: a copied index too old to know any container read every name as 0 -> spruce planks and a spruce slab chosen
  const low = choose(M, { town: {}, bag: { spruce_log: 19 }, townCoverage: 0 })
  assert.strictEqual(low.choice.size, 0, 'an unread town: nothing chosen')
  assert.ok(low.rows.length >= 2 && low.rows.every(r => r.took === '-' && /^town_unread\(cov=0\.00\)$/.test(r.why)), JSON.stringify(low.rows.map(r => r.why)))
  assert.strictEqual(choose(M, { town: {}, bag: { spruce_log: 19 }, townCoverage: 1 }).choice.size > 0, true, 'POSITIVE CONTROL: the same bag with a read town chooses')
  assert.strictEqual(choose(M, { townCoverage: 0.8 }).choice.size, 13, 'at the floor: the live choice')
}
await t('AN UNREAD TOWN (index coverage under 0.8) proves no zero: nothing is chosen, each course\'s row says town_unread', () => unread(PC))
await t('MUTANT the coverage floor ignored', () => kills('palchoice.mjs', '  const trusted = Number(townCoverage) >= MIN_TOWN_COVERAGE', '  const trusted = true', unread, PC))

console.log('THE BILL (shop.mjs billOf)')
const bill = Sh => {
  const read = liveWorld().read
  const { choice } = choose(PC, { read })
  const opts = { done: R.cellDone, inTown: SH.billInTown(TOWN), planks: 'spruce_planks' }
  const roofOnly = { cells: ROOF }
  assert.deepStrictEqual(Sh.billOf(roofOnly, PAL, read, opts), { dark_oak_stairs: 13, dark_oak_planks: 2, dark_oak_slab: 1 }, 'POSITIVE CONTROL: the base bill is the live one')
  assert.deepStrictEqual(Sh.billOf(roofOnly, PAL, read, { ...opts, choice }), { spruce_stairs: 13, dark_oak_planks: 2, dark_oak_slab: 1 }, 'the chosen courses draw spruce')
}
await t('the bill: 13 spruce stairs (the base asked 13 dark oak the town cannot give), 2 dark oak planks, 1 dark oak slab', () => bill(SH))
await t('MUTANT the bill ignores the choice', () => kills('shop.mjs', "(choice?.get?.(`${c.at[0]},${c.at[1]},${c.at[2]}`) ?? resolve(palette, c.role, inTown, planks))", 'resolve(palette, c.role, inTown, planks)', bill, SH))

console.log('THE VISIT (buildrun.mjs runVisit, the small vanilla judging every stair\'s state)')
// the bag after the draw: the bill, the lantern, AND two dark oak stairs from somewhere else -- the bag holding both names
const BAG = () => ({ spruce_stairs: 13, dark_oak_planks: 2, dark_oak_slab: 1, lantern: 1, dark_oak_stairs: 2, cobblestone: 32, dirt: 16 })
async function roofVisit (Mod, { withChoice = true } = {}) {
  const srv = liveWorld(), pr = project(REC)
  const { choice } = choose(PC, { read: srv.read })
  const e = vanillaBot(srv, 'A', { inv: BAG(), feet: [2, G + 1, 0] })
  const before = new Map(ROOF.map(c => [k3(c.at), srv.read(...c.at)?.name]))
  let r = null
  for (let i = 0; i < 3 && r?.stop !== 'complete'; i++) r = await Mod.runVisit({ ...pr.p('A'), record: REC, palette: PAL, ...C.civicVisitOpts(REC, {}), ...(withChoice ? { choice } : {}) }, e, { maxSteps: 3000, barrierWaitMs: 50, tempStand: false, deadline: Date.now() + 60_000 })
  const fresh = ROOF.filter(c => before.get(k3(c.at)) !== srv.read(...c.at)?.name)
  return { r, srv, e, fresh }
}
const finished = async Mod => {
  const { r, srv, e, fresh } = await roofVisit(Mod)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why}`)
  for (const c of ROOF) assert.ok(R.cellDone(srv.read(...c.at), PAL, c.role, c.ws), `${c.at} ${c.role} done in its state`)
  const stairs = fresh.filter(c => c.role === 'roof')
  assert.strictEqual(stairs.length, 13)
  assert.deepStrictEqual([...new Set(stairs.map(c => srv.read(...c.at).name))], ['spruce_stairs'], 'every stair placed is spruce')
  assert.strictEqual(e.inv.dark_oak_stairs, 2, 'the two dark oak stairs in the bag were never placed into a spruce course')
  // the upper course reads as one block; the cap and the underside as designed
  assert.deepStrictEqual([...new Set(ROOF.filter(c => c.role === 'roof' && c.at[1] === Y1 + 1).map(c => srv.read(...c.at).name))], ['spruce_stairs'])
  assert.strictEqual(srv.read(...ROOF.find(c => c.role === 'capslab').at).name, 'dark_oak_slab')
}
await t('THE ROOF FINISHES: complete, every cell in its state, the 13 new stairs all spruce, the bag\'s 2 dark oak stairs left, the cap dark oak', () => finished(R))
await t('POSITIVE CONTROL (the base: no choice): the same bag places dark oak into the open courses -- the cell-by-cell mix', async () => {
  const { srv, fresh } = await roofVisit(R, { withChoice: false })
  assert.ok(fresh.filter(c => c.role === 'roof').some(c => srv.read(...c.at).name === 'dark_oak_stairs'), 'the instrument sees a mix')
})
await t('MUTANT the visit ignores the choice (any name the bag holds)', () => kills('buildrun.mjs', 'const placeFor = c => { const ch = p.choice?.get?.(kOf(c.at));', 'const placeFor = c => { const ch = null;', finished, R))

console.log('THE WIRING (skills.mjs; structural: the building visit computes the choice, bills with it and hands it to the visit)')
const wiring = src => {
  const s = strip(src)
  const at = s.indexOf('const palChoice = PALCHOICE.on ? visitPaletteChoice(bot, recB, pal, read, { town, bag: held0, planks, plot }) : null')
  assert.ok(at > 0, 'the choice is computed in the building visit')
  const bill = s.indexOf('const bill = billOf(recB, pal, read, { done: buildCellDone, inTown: billInTown(town), planks, choice: palChoice })', at)
  assert.ok(bill > at, 'the bill takes it')
  assert.ok(s.indexOf('{ done: buildCellDone, inTown: billInTown(town), planks, choice: palChoice })', bill + 10) > bill, 'the wood parts\' bill takes it')
  assert.ok(s.indexOf('palette: pal, choice: palChoice, res, resFailed,', bill) > bill, 'the visit takes it')
  assert.ok(s.includes('try { townCoverage = Number(matsTownStock(bot)?.coverage) || 0 } catch { townCoverage = 0 }') && s.includes('      townCoverage,\n    })'), 'the index coverage reaches the choice')
}
const SK = readFileSync(SRC('skills.mjs'), 'utf8')
await t('skills.mjs: the choice is computed before the bill, and the bill, the parts\' bill and runVisit all take it', () => wiring(SK))
await t('MUTANT (source): runVisit not handed the choice -- the assertion sees it', () => {
  const old = 'palette: pal, choice: palChoice, res, resFailed,'
  assert.strictEqual(SK.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(SK.replace(old, 'palette: pal, res, resFailed,')), assert.AssertionError)
})
await t('the switch: PALCHOICE=off is read at import (on by default here)', () => { assert.strictEqual(PC.PALCHOICE.on, process.env.PALCHOICE ? !['off', '0', 'false', 'no'].includes(process.env.PALCHOICE.toLowerCase()) : true) })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
