// CANEFARM-01: THE SUGAR CANE BED (bots/src/canefarm.mjs; shop.mjs PROJECTS; skills.mjs buildCaneFarm / caneDueFor wiring).
// Behaviour: the water-edge cell rule (soil, water beside at its level, headroom, a dry stand), the siting by the module on the fake
// flat world with a water channel (the most cells, off every reservation -- a positive control for the refusal), the cell states
// (open, growing, ripe, dry, blocked), the harvest (the SECOND block, never the bottom), the due test, the bank rule (the bag's own
// cane -- the park's -- never banked), the bed planted end to end by the real visit runner. STRUCTURAL checks only for the wiring
// (comments stripped, anchored on executable lines), each shown to fail by an anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, HOME, G, server, bot, project } = await import('./helpers/buildfake.mjs')
const C = await import('../src/canefarm.mjs')
const SHOPM = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const CF_PATH = new URL('../src/canefarm.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// THE WORLD: a water channel at the ground's level along z = -30, x -24..-10 (the grass at G is replaced by water), a sand bank north
// of it (z -31) and grass south (z -29) -- both banks are water edges
const WORLD = () => {
  const cells = {}
  for (let x = -24; x <= -10; x++) { cells[`${x},${G},-30`] = 'water'; cells[`${x},${G},-31`] = 'sand' }
  return cells
}
const read0 = server(WORLD()).read
const blockedNone = () => null

console.log('THE CELL RULE')
await t('a water-edge soil cell with air above and a dry stand beside is a cane cell; dry ground, wrong soil, a cover or no headroom is not', () => {
  const ok = C.caneCell(read0, [-15, G, -29])
  assert.ok(ok.ok, ok.why)
  assert.deepStrictEqual(ok.cell, [-15, G + 1, -29])
  assert.ok(ok.stand && ok.stand[1] === G + 1 && read0(ok.stand[0], G, ok.stand[2]).name !== 'water', 'the stand stands on dry ground')
  assert.strictEqual(C.caneCell(read0, [-15, G, -26]).why, 'dry', 'two from the water')
  assert.strictEqual(C.caneCell(read0, [-15, G - 1, -29]).why, 'soil', 'under the grass: dirt is soil, but... ')
})
await t('cover and headroom: a log above the cell or two above refuses; a small plant above is a listed clear', () => {
  const s1 = server({ ...WORLD(), [`-15,${G + 1},-29`]: 'oak_log' }).read
  assert.strictEqual(C.caneCell(s1, [-15, G, -29]).why, 'cover')
  const s2 = server({ ...WORLD(), [`-15,${G + 3},-29`]: 'oak_leaves' }).read
  assert.strictEqual(C.caneCell(s2, [-15, G, -29]).why, 'headroom')
  const s3 = server({ ...WORLD(), [`-15,${G + 1},-29`]: 'short_grass' }).read
  const r = C.caneCell(s3, [-15, G, -29])
  assert.ok(r.ok)
  assert.deepStrictEqual(r.clear, [{ at: [-15, G + 1, -29], kind: 'plant', name: 'short_grass' }])
})

console.log('THE SITING')
await t('the bed: up to 16 cells in one 12 x 12 cluster on the channel\'s banks, off every reservation; no cane cell is another\'s stand', () => {
  const s = C.siteCaneFarm(read0, { home: HOME, blocked: blockedNone })
  assert.ok(s.ok, s.why)
  const r = s.record
  assert.strictEqual(r.cells.length, 16)
  const cells = new Set(r.cells.map(c => `${c.at[0]},${c.at[2]}`))
  for (const st of r.stands) assert.ok(!cells.has(`${st.stand[0]},${st.stand[2]}`), 'a stand is never a cane cell')
  for (const c of r.cells) assert.strictEqual(C.caneState(read0, c), 'open')
  assert.ok(r.box[2] - r.box[0] <= C.CANE.span && r.box[3] - r.box[1] <= C.CANE.span)
  assert.deepStrictEqual(r.bom, { sugar_cane: 16 })
  // a refusal: the grass bank reserved -> only the sand bank's cells (positive control: they were taken before)
  const s2 = C.siteCaneFarm(read0, { home: HOME, blocked: (x, z) => (z === -29 || z === -28 ? 'zone' : null) })
  assert.ok(s2.ok)
  assert.ok(s2.record.cells.every(c => c.at[2] !== -29 && c.at[2] !== -28), JSON.stringify(s2.record.cells.map(c => c.at)))
  assert.ok(s2.record.cells.filter(c => c.at[2] === -31).length >= 10, 'the sand bank (and the channel\'s end)')
  assert.ok(s2.record.stands.every(q => q.stand[2] !== -29 && q.stand[2] !== -28), 'never a stand in a reservation')
  // no water at all: no site
  const s3 = C.siteCaneFarm(server().read, { home: HOME })
  assert.strictEqual(s3.ok, false)
  assert.match(s3.why, /^no_water_edge/)
})

console.log('THE BED, READ')
const REC = C.siteCaneFarm(read0, { home: HOME }).record
const c0 = REC.cells[0]
await t('the states: open, growing (1 tall), ripe (2+), dry (the water gone), blocked', () => {
  const at = (dy, n) => ({ [`${c0.at[0]},${c0.at[1] + dy},${c0.at[2]}`]: n })
  assert.strictEqual(C.caneState(server({ ...WORLD(), ...at(0, 'sugar_cane') }).read, c0), 'growing')
  assert.strictEqual(C.caneState(server({ ...WORLD(), ...at(0, 'sugar_cane'), ...at(1, 'sugar_cane') }).read, c0), 'ripe')
  assert.strictEqual(C.caneState(server({ ...WORLD(), ...at(0, 'cobblestone') }).read, c0), 'blocked')
  const dry = WORLD(); for (let x = -24; x <= -10; x++) dry[`${x},${G},-30`] = 'dirt'
  assert.strictEqual(C.caneState(server(dry).read, c0), 'dry')
})
await t('THE HARVEST cuts the SECOND block (the bottom one stays and regrows); only ripe cells; the due test', () => {
  const w = { ...WORLD() }
  for (const c of REC.cells.slice(0, 3)) { w[`${c.at[0]},${c.at[1]},${c.at[2]}`] = 'sugar_cane'; w[`${c.at[0]},${c.at[1] + 1},${c.at[2]}`] = 'sugar_cane' }
  w[`${REC.cells[3].at.join(',')}`] = 'sugar_cane'
  const rd = server(w).read
  const h = C.caneHarvest(rd, REC)
  assert.strictEqual(h.length, 3)
  for (const c of h) assert.deepStrictEqual(C.cutCell(c), [c.at[0], c.at[1] + 1, c.at[2]])
  assert.strictEqual(C.caneDue(rd, REC, { cane: 0, townCane: 0, freeSlots: 20 }), 'harvest')
  assert.strictEqual(C.caneDue(rd, REC, { cane: 0, townCane: C.CANE.townCap, freeSlots: 20 }), null, 'the town cap')
  assert.strictEqual(C.caneDue(rd, REC, { cane: 5, townCane: C.CANE.townCap, freeSlots: 20 }), 'replant', 'open cells with cane to plant')
  assert.strictEqual(C.caneDue(read0, REC, { cane: 0, townCane: 0 }), null, 'nothing ripe, no cane: quiet')
})
await t('THE BANK: the bag\'s own cane (the park\'s) is never banked; the harvest and an unplanted draw are', () => {
  assert.deepStrictEqual(C.caneBankable({ own0: 4, now: 4 + 9, drawn: 0, placed: 0 }), { ownLeft: 4, bank: 9 }, 'a harvest of 9')
  assert.deepStrictEqual(C.caneBankable({ own0: 4, now: 0, drawn: 0, placed: 4 }), { ownLeft: 0, bank: 0 }, 'the first planting took the bag\'s own')
  assert.deepStrictEqual(C.caneBankable({ own0: 4, now: 4 + 2, drawn: 6, placed: 4 }), { ownLeft: 4, bank: 2 }, 'the draw is spent first')
})

console.log('PLANTED END TO END (the real visit runner, the fake server)')
await t('the bed is planted: one cane on every cell, from its stands; the bottom block reads growing', async () => {
  const srv = server(WORLD()), { p } = project(REC)
  const e = bot(srv, 'A', { inv: { sugar_cane: 20 } })
  const rd = srv.read
  const r = await R.runVisit({ ...p('A'), palette: C.CANE_PALETTE, foreign: C.CANE_FOREIGN, domain: () => true, openRole: role => role === 'cane', alsoDone: (q, rr) => C.caneAlsoDone(q, rr ?? rd, { noCane: false }) }, e, { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why, placed: r.placed }))
  assert.strictEqual(r.placed, REC.cells.length)
  for (const c of REC.cells) assert.strictEqual(C.caneState(rd, c), 'growing')
  // with no cane, an open cell is passed (never a no_material stop)
  const srv2 = server(WORLD()), pr2 = project(REC)
  const r2 = await R.runVisit({ ...pr2.p('A'), palette: C.CANE_PALETTE, foreign: C.CANE_FOREIGN, domain: () => true, openRole: role => role === 'cane', alsoDone: (q, rr) => C.caneAlsoDone(q, rr ?? srv2.read, { noCane: true }) }, bot(srv2, 'A', { inv: {} }), { maxSteps: 200 })
  assert.strictEqual(r2.stop, 'complete')
  assert.strictEqual(r2.placed, 0)
})

console.log('THE ORDER (shop.mjs)')
await t('the project after the tree farm (beside the crop farm), one builder; on only in the showcase pool; guarded whatever its switch', () => {
  const p = SHOPM.PROJECTS.find(q => q.plot === C.CANEFARM_PLOT)
  assert.ok(p && p.after === 'treefarm' && p.builders === 1)
  assert.strictEqual(C.canefarmOn({}, 'showcase'), true)
  assert.strictEqual(C.canefarmOn({}, 'hive-a'), false)
  assert.strictEqual(C.canefarmOn({ CANEFARM: 'off' }, 'showcase'), false)
  assert.ok(SHOPM.projectsGuarded([]).some(q => q.plot === C.CANEFARM_PLOT))
})

console.log('MUTANTS ON THE MODULE (anchors present and unique)')
await t('the second-block cut, the water rule, the bank rule, the stand rule: each mutant fails its behaviour', async () => {
  await withMutant(CF_PATH, 'export const cutCell = cell => [cell.at[0], cell.at[1] + 1, cell.at[2]]', 'export const cutCell = cell => [cell.at[0], cell.at[1], cell.at[2]]', async M => {
    assert.deepStrictEqual(M.cutCell(c0), c0.at, 'the mutant cuts the bottom block')
  })
  await withMutant(CF_PATH, "  if (!CARD.some(([dx, dz]) => isWater(read(x + dx, y, z + dz)))) return { ok: false, why: 'dry' }", '', async M => {
    assert.ok(M.caneCell(read0, [-15, G, -26]).ok, 'the mutant takes dry ground')
  })
  await withMutant(CF_PATH, '  const fromOwn = Math.max(0, (Number(placed) || 0) - (Number(drawn) || 0))', '  const fromOwn = 0', async M => {
    assert.deepStrictEqual(M.caneBankable({ own0: 4, now: 0, drawn: 0, placed: 4 }).ownLeft, 4)
  })
  await withMutant(CF_PATH, '    if (isCane(sx, sz) || !standOk(sx, sz)) continue\n', '', async M => {
    const s2 = M.siteCaneFarm(read0, { home: HOME, blocked: (x, z) => (z === -29 || z === -28 ? 'zone' : null) })
    assert.ok(s2.record.stands.some(q => q.stand[2] === -28 || q.stand[2] === -29 || s2.record.cells.some(c => c.at[0] === q.stand[0] && c.at[2] === q.stand[2])), 'the mutant stands in a reservation or on a cane cell')
  })
})

console.log('THE WIRING (structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const SH = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
const WIRES = {
  'the project': [SH, /Object\.freeze\(\{ plot: CANEFARM_PLOT, blueprint: CANEFARM_BLUEPRINT, after: FARM_AFTER, builders: CANEFARM_BUILDERS \}\)/],   // forest-01: FARM_AFTER is the tree farm unless the forest is on
  'its switch': [SH, /p\.plot === CANEFARM_PLOT \? cane && farm && paths && on :/],
  'the visit': [SK, /if \(proj\.plot === CANEFARM_PLOT\) return buildCaneFarm\(ctx, args, signal\)/],
  'the order sees the upkeep': [SK, /if \(r\.blueprint === CANEFARM_BLUEPRINT\) return tidy && !!caneDueFor\(bot, r\)/],
  'the cut re-reads the bottom block': [SK, /String\(read\(\.\.\.c\.at\)\?\.name \?\? ''\) !== 'sugar_cane' \|\| !digReachFrom\(e\.feet\(\), cut\)\) continue/],
  'the bank never takes the bag\'s own': [SK, /back = await matsBank\(ctx, \['sugar_cane'\], \{ sugar_cane: bk\.ownLeft \}, signal, \{ sugar_cane: bk\.bank \}/],
  'an unsited bed with no site WAITS town-wide (Codex r1 BLOCKER 1)': [SK, /if \(p\.plot === CANEFARM_PLOT && !rec && Date\.now\(\) < siteWaitUntil\(CANEFARM_PLOT, dir\)\) return \{ plot: p\.plot, exists: false, complete: false, damaged: false, due: false, dueFirst: false, waiting: true \}/],
  'no site sets the wait, stop site_wait': [SK, /if \(!s\.ok\) \{ siteWaitSet\(CANEFARM_PLOT, 30 \* 60_000, s\.why\); return out\('no_effect', 'no_site', `no cane bed site \(\$\{s\.why\}\)`\.slice\(0, 160\), \{ stop: 'site_wait' \}\) \}/],
  'no cane anywhere completes the bed (Codex r1 BLOCKER 2)': [SK, /\(x === 'open' && !caneAnywhere\)\)\) \{/],
}
await t('wiring: the project, its switch, the visit, the upkeep, the cut\'s re-read, the bank floor', () => {
  for (const [what, [src, re]] of Object.entries(WIRES)) assert.strictEqual((src.match(new RegExp(re.source, 'g')) ?? []).length, 1, what)
})
await t('MUTANTS KILLED: each wiring check fails on its line broken (anchor present and unique)', () => {
  const lines = {
    'the cut re-reads the bottom block': [SK, "String(read(...c.at)?.name ?? '') !== 'sugar_cane' || !digReachFrom(e.feet(), cut)) continue", '!digReachFrom(e.feet(), cut)) continue'],
    'the bank never takes the bag\'s own': [SK, "{ sugar_cane: bk.ownLeft }, signal, { sugar_cane: bk.bank }", '{ sugar_cane: 0 }, signal, {}'],
    'the visit': [SK, 'if (proj.plot === CANEFARM_PLOT) return buildCaneFarm(ctx, args, signal)', 'if (false) return null'],
    'an unsited bed with no site WAITS town-wide (Codex r1 BLOCKER 1)': [SK, 'if (p.plot === CANEFARM_PLOT && !rec && Date.now() < siteWaitUntil(CANEFARM_PLOT, dir)) return', 'if (false) return'],
    'no cane anywhere completes the bed (Codex r1 BLOCKER 2)': [SK, " || (x === 'open' && !caneAnywhere)))", '))'],
  }
  for (const [what, [src, old, neu]] of Object.entries(lines)) {
    assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${what}`)
    assert.notStrictEqual((src.replace(old, neu).match(new RegExp(WIRES[what][1].source, 'g')) ?? []).length, 1, `the check survives: ${what}`)
  }
})

console.log(`\ncanefarm: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
