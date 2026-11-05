// STOREHUB-01 pieces A + B: THE SORTED HALL AND ITS CLERK (bots/src/storehub.mjs; blueprints/storehub@1.json; chestfull.mjs's
// registry; skills.mjs hubSiteFor / hubUpkeepVisit / hubClerkOne / disposeWell `via: 'clerk'` wiring).
// Behaviour: the hall sited by the real planner beside a storehouse on the fake flat world and built end to end by the real visit
// runner (every chest a single chest, its sign's wall a plank wall, its stand open aisle); the clerk's pure decisions (the section
// table, the route, the throw allowlist against well.mjs's own lists, the move-set, the refusal chain: full home -> more ->
// OVERFLOW -> never the well); the registry (inTown). STRUCTURAL source assertions only for the wiring (comments stripped, anchored
// on executable lines), each shown to fail by an anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { B, R, HOME, G, server, bot, plan, project } = await import('./helpers/buildfake.mjs')
const H = await import('../src/storehub.mjs')
const W = await import('../src/well.mjs')
const CF = await import('../src/chestfull.mjs')
const TP = await import('../src/townplan.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const HUB_PATH = new URL('../src/storehub.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const k3 = a => a.join(',')

const BP = B.loadBlueprint(H.HUB_BLUEPRINT)
console.log('THE BLUEPRINT')
await t('a 19 x 11 hall: 18 single chests (one cell apart, the layout exactly), a sign wall of planks behind each, 527 cells', () => {
  assert.deepStrictEqual(BP.footprint, { u: 19, v: 11 })
  assert.strictEqual(BP.cells.length, 527)
  const chests = BP.cells.filter(c => c.role === 'chest')
  assert.strictEqual(chests.length, 18)
  assert.deepStrictEqual(chests.map(c => `${c.u},${c.v}`).sort(), H.HALL_LAYOUT.map(c => `${c.u},${c.v}`).sort(), 'the layout names every chest cell')
  for (const a of chests) for (const b of chests) if (a !== b) assert.ok(Math.abs(a.u - b.u) + Math.abs(a.v - b.v) > 1, `side by side: ${a.u},${a.v} ${b.u},${b.v} would join`)
  const byCell = new Map(BP.cells.map(c => [`${c.u},${c.v},${c.y}`, c]))
  for (const c of chests) {
    const [wu, wv] = c.v === 8 ? [c.u, 9] : c.v === 2 ? [c.u, 1] : c.u === 2 ? [1, c.v] : [17, c.v]
    assert.strictEqual(byCell.get(`${wu},${wv},2`)?.role, 'wall', `the sign wall behind ${c.u},${c.v} is a plank wall, never glass`)
    assert.ok(!byCell.has(`${c.u},${c.v},2`), 'the sign cell above the chest is open')
  }
  const sections = new Set(H.HALL_LAYOUT.map(c => c.section))
  for (const s of ['stone', 'wood', 'metal', 'tools', 'food', 'plants', 'farming', 'build', 'overflow', 'unsorted']) assert.ok(sections.has(s), `the owner's ${s}`)
  for (const s of ['stone', 'wood', 'metal', 'tools', 'build']) assert.ok(H.HALL_LAYOUT.some(c => c.section === s && c.role === 'more'), `${s} has its own overflow`)
  for (const [id, s] of Object.entries(H.HUB_SECTIONS)) for (const l of s.label) assert.ok(l.length <= 15, `${id}: "${l}" fits a sign line`)
})

console.log('SITED BESIDE THE STOREHOUSE AND BUILT (the real planner and visit runner, the fake server)')
const STORE = { plot: 'storehouse', box: [-15, -4, -8, 3] }
const stepsOf = () => H.hubSitingPlan(HOME, STORE)
const SHOPM = await import('../src/shop.mjs')
// the storehouse is a record: its box + PROJECT_GAP is every later siting's zone (as skills.mjs hubSiteFor passes recordZones)
const siteWith = step => B.siteBlueprint(server().read, plan(), BP, { tries: 3, plot: H.HUB_PLOT, zones: SHOPM.recordZones([STORE]), sectors: [{ sector: null, source: step.source }], earth: step.earth, domain: step.domain, standDomain: step.standDomain, walkR: step.walkR, line: step.line, rankKey: step.rankKey })
const S0 = siteWith(stepsOf()[0])
const REC = S0.ok ? H.hubRecordOf(S0.record, BP, { band: 'store' }) : null
await t('the siting plan: beside the storehouse first (its pad within 12 of the storehouse box), then the town ring', () => {
  const st = stepsOf()
  assert.deepStrictEqual(st.map(s => s.source), ['store', 'ring'])
  assert.deepStrictEqual(H.hubSitingPlan(HOME, null).map(s => s.source), ['ring'], 'no storehouse: the ring alone')
  assert.ok(S0.ok, JSON.stringify(S0.sectors?.map(s => [s.sector, s.screened, s.tried, s.rejects, s.proofFails])))
  const pad = REC.cells.filter(c => c.role === 'base').map(c => [c.at[0], c.at[2]])
  assert.ok(st[0].beside({ pad }), `beside: gap ${H.boxGap(REC.box, STORE.box)}`)
  assert.strictEqual(REC.interior.open, REC.interior.reachable)
  assert.strictEqual(REC.chests.length, 18)
  assert.ok(!st[0].beside({ pad: [[60, 60]] }), 'a pad far off is not beside')
})
await t('the ring: Chebyshev >= 17 from home, within 72; a site far off is refused by the domain', () => {
  const ring = stepsOf()[1]
  assert.ok(ring.domain(30, 0) && ring.domain(65, 0) && !ring.domain(10, 10) && !ring.domain(73, 0))
  assert.ok(ring.walkR >= H.HUB_SITE.ringMax + 12, 'the walk reaches past the ring\'s edge')
})
await t('storehubsite-01 (LIVE 11-04: 21/21 no_site): the ring step honours the ziggurat apron (z0) and still sites the hall', () => {
  // the showcase's monument record box, near the north field the offline run (without z0) had picked
  const z0 = { box: [-55, -43, -26, -14] }
  const ring = stepsOf()[1]
  const s = B.siteBlueprint(server().read, plan(), BP, { tries: 3, plot: H.HUB_PLOT, zones: SHOPM.recordZones([STORE]), z0, sectors: [{ sector: null, source: 'ring' }], earth: ring.earth, domain: ring.domain, standDomain: ring.standDomain, walkR: ring.walkR, line: ring.line, rankKey: ring.rankKey })
  assert.ok(s.ok, JSON.stringify(s.sectors?.map(r => [r.screened, r.rejects, r.proofFails])))
  const ap = [z0.box[0] - 8, z0.box[1] - 8, z0.box[2] + 8, z0.box[3] + 8]
  assert.ok(s.record.cells.every(c => !(c.at[0] >= ap[0] && c.at[0] <= ap[2] && c.at[2] >= ap[1] && c.at[2] <= ap[3])), 'no hall cell on the apron')
  assert.ok((s.sectors[0].rejects.z0_apron ?? 0) > 0, 'positive control: the apron refused candidates')
})
const KIT = () => ({ cobblestone: 400, stone_bricks: 120, oak_planks: 160, glass_pane: 30, torch: 6, chest: 18 })
let BUILT = null
await t('the hall is built end to end: complete, 527 placements, each cell once; every chest a chest, its sign cell air, its stand open', async () => {
  const srv = server(), { p } = project(REC)
  const e = bot(srv, 'A', { inv: KIT() })
  const r = await R.runVisit({ ...p('A'), palette: BP.palette, ...H.hubVisitOpts(REC) }, e, { maxSteps: 6000 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why, placed: r.placed }))
  assert.strictEqual(r.placed, 527)
  assert.ok([...srv.placedAt.values()].every(n => n === 1))
  BUILT = srv
  for (const c of REC.chests) {
    assert.strictEqual(srv.read(...c.at).name, 'chest', `${c.section} at ${k3(c.at)}`)
    assert.strictEqual(srv.read(...c.sign).name, 'air', 'the label cell')
    assert.ok(/_planks$/.test(srv.read(...c.wall).name), `the sign's wall is planks: ${srv.read(...c.wall).name}`)
    assert.strictEqual(srv.read(...c.stand).name, 'air', 'the stand is open aisle')
    assert.strictEqual(srv.read(...c.stand.map((v, i) => (i === 1 ? v - 1 : v))).name, 'cobblestone', 'on the paved floor')
    assert.strictEqual(Math.abs(c.at[0] - c.stand[0]) + Math.abs(c.at[2] - c.stand[2]), 1, 'the stand faces the chest')
  }
})
await t('the labels: one spot per chest on its wall face, the section named, "(more)" on a section overflow', () => {
  const spots = H.hubSignSpots(REC)
  assert.strictEqual(spots.length, 18)
  for (const sp of spots) {
    assert.strictEqual(Math.abs(sp.face[0]) + Math.abs(sp.face[2]), 1)
    assert.deepStrictEqual(sp.wall.map((v, i) => v + sp.face[i]), sp.at, 'the sign hangs on the wall\'s face, in the cell above the chest')
    assert.ok(sp.lines.length >= 1 && sp.lines.every(l => l.length <= 15))
  }
  const more = spots.filter(sp => sp.lines.includes('(more)'))
  assert.strictEqual(more.length, 5)
})

await t('storehubstand-01 (LIVE 11-04 a7efcca2: 46 visits, 0 placed, every replant no_step): the visit stands where the siting stood', () => {
  // the live record's (g32) felled trees' replant cells lie outside the pad + 4; on the flat fake world each column is planted at
  // ground + 1 (soil under it) and asked for a step: the old pad-only domain finds none, the visit's domain now finds one
  const live = JSON.parse(readFileSync(new URL('./fixtures/storehub-record-1104.json', import.meta.url), 'utf8'))
  const dom = H.hubStandDomain(live)
  const b = live.box, p = H.HUB_SITE.standPad
  const old = (x, z) => x >= b[0] - p && x <= b[2] + p && z >= b[1] - p && z <= b[3] + p
  const srv = server()
  const nodes = new Map()
  for (const k of B.walkFrom(srv.read, HOME, new Set(), 60, { stood: [] })) { const [x, y, z] = k.split(',').map(Number); const c = `${x},${z}`; if (!nodes.has(c)) nodes.set(c, []); nodes.get(c).push(y) }
  const cells = live.replant.filter(r => r.state === 'pending').map(r => r.cell ?? r.at).filter(c => Math.abs(c[0]) <= 56 && Math.abs(c[2]) <= 56)
  assert.ok(cells.length >= 5, `the fixture's pending replants in the fake world: ${cells.length}`)
  let outside = 0, far = 0
  for (const c of cells) {
    const cell = [c[0], G + 1, c[2]]
    if (!old(c[0], c[2])) outside++
    assert.ok(B.stepFor(srv.read, HOME, cell, nodes, dom), `a stand for the replant at ${k3(cell)}`)
    // farther than a reach (5 columns) from the pad + 4: the old domain had no stand at all (the live no_step on every one)
    if (H.boxGap([c[0], c[2], c[0], c[2]], [b[0] - p, b[1] - p, b[2] + p, b[3] + p]) > 5) { far++; assert.strictEqual(B.stepFor(srv.read, HOME, cell, nodes, old), null, `positive control: the pad-only domain finds none for ${k3(cell)}`) }
  }
  assert.ok(outside >= 4 && far >= 2, `the live replants outside the pad + 4: ${outside}, beyond a reach of it: ${far}`)
  assert.ok(!dom(200, 0) && dom(b[0], b[1]), 'never beyond the ring, always the pad')
})

await t('storehubwalk-01 (LIVE 8b4ea9cc: 0 placed, 23 of 33 aborts the runner\'s 180 s watchdog): the hall\'s visit ends inside the runner clock and commutes first', () => {
  assert.strictEqual(H.hubVisitBudget(180_000, 8 * 60_000), 140_000, 'the showcase: 180 s less the tail')
  assert.strictEqual(H.hubVisitBudget(600_000, 8 * 60_000), 8 * 60_000 - H.HUB_VISIT_TAIL_MS, 'a longer runner: the visit\'s own 8 min')
  assert.strictEqual(H.hubVisitBudget(undefined, undefined), 8 * 60_000)
  assert.ok(H.hubVisitBudget(20_000, 8 * 60_000) >= 30_000)
  const live = JSON.parse(readFileSync(new URL('./fixtures/storehub-record-1104.json', import.meta.url), 'utf8'))
  const rec = { ...live, blueprint: H.HUB_BLUEPRINT }
  const cm = H.hubCommute(rec, { x: -8.5, y: 71, z: 0.7 })   // the storehouse, where the live builders drew and wedged
  assert.ok(cm && cm.dist > 50, JSON.stringify(cm))
  const [x, y, z] = cm.target
  assert.ok(x >= live.box[0] && x <= live.box[2] && z >= live.box[1] && z <= live.box[3] && y === live.s + 1, 'the doorway\'s front: on the pad, one above it')
  const front = H.hubChestsOf(rec)   // sanity: the target is the doorway's column, not a chest's
  assert.ok(!front.some(c => c.at[0] === x && c.at[2] === z))
  assert.strictEqual(H.hubCommute(rec, { x: x + 3.5, y, z: z + 0.5 }), null, 'near the doorway: no commute')
  assert.strictEqual(H.hubCommute({ ...rec, blueprint: 'yard@1' }, { x: 0, y: 70, z: 0 }), null)
  const SKW = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const re of [/effects, \{ deadline: rec\.blueprint === HUB_BLUEPRINT \? t0 \+ hubVisitBudget\(config\.skills\?\.defaultTimeoutMs, SHOP_VISIT_MS\) : t0 \+ SHOP_VISIT_MS - 15_000 \}\)/,
    /const cm = hubCommute\(rec, bot\.entity\?\.position\)\n\s*if \(cm\) \{/,
    /await goto\(ctx, \{ x: cm\.target\[0\], y: cm\.target\[1\], z: cm\.target\[2\], range: 3 \}, signal, \{ until \}\)/]) assert.strictEqual((SKW.match(new RegExp(re.source, 'g')) ?? []).length, 1, re.source.slice(0, 60))
})

console.log('THE REGISTRY (chestfull.mjs inTown)')
await t('the hall\'s chests are town containers once registered; the box is unchanged; a bot\'s feet never match', () => {
  const keys = H.hubChestKeys(REC)
  assert.strictEqual(keys.size, 18)
  const far = { x: 0, y: G + 2, z: 40 }
  assert.ok(!CF.inTown(HOME, far))
  CF.setTownExtra(HOME, [k3([far.x, far.y, far.z])])
  assert.ok(CF.inTown(HOME, far), 'registered')
  assert.ok(!CF.inTown(HOME, { x: 0.5, y: G + 2, z: 40.5 }), 'a float position (a bot) never matches')
  assert.ok(!CF.inTownBox(HOME, far), 'the box alone is the old rule')
  assert.ok(CF.inTown(HOME, { x: 3, y: G, z: 3 }), 'the box still counts')
  CF.setTownExtra(HOME, [])
  assert.ok(!CF.inTown(HOME, far), 'cleared')
  assert.strictEqual(H.hubChestKeys(REC, { on: false }).size, 0, 'STOREHUB=off registers nothing')
})

console.log('THE CLERK: WHERE A STACK GOES')
await t('the section table: the owner\'s groups, food and plants split from farm, the unknown to UNSORTED', () => {
  const want = { cobblestone: 'stone', stone_bricks: 'stone', spruce_log: 'wood', oak_planks: 'wood', iron_ingot: 'metal', raw_gold: 'metal', copper_ingot: 'metal',
    coal: 'fuel', diamond: 'valuable', lapis_lazuli: 'valuable', iron_pickaxe: 'tools', bucket: 'tools', torch: 'build', glass_pane: 'build', sand: 'earth', dirt: 'earth',
    bread: 'food', apple: 'food', cooked_beef: 'food', wheat_seeds: 'farming', bone_meal: 'farming', wheat: 'farming', oak_sapling: 'plants', bamboo: 'plants', poppy: 'plants',
    name_tag: 'unsorted', '': 'unsorted' }
  for (const [n, s] of Object.entries(want)) assert.strictEqual(H.hubSectionOf(n), s, n)
})
await t('the throw allowlist IS well.mjs\'s owner list + scaffold decorations; every name passes isWellJunk; no kept kind ever', () => {
  assert.deepStrictEqual([...H.HUB_THROWABLE].sort(), [...W.OWNER_JUNK_1004, ...W.SCAFFOLD_DECORATIONS].sort())
  for (const n of H.HUB_THROWABLE) assert.ok(H.hubThrowable(n, W.isWellJunk), `${n} is throwable`)
  for (const n of W.DECORATIONS) assert.ok(!H.hubThrowable(n, W.isWellJunk), `${n}: a decoration is building material in entrusted cargo`)
  for (const n of ['iron_pickaxe', 'diamond_sword', 'iron_ore', 'raw_iron', 'iron_ingot', 'copper_ingot', 'oak_log', 'spruce_planks', 'coal', 'cobblestone', 'stone_bricks',
    'glass', 'cut_copper', 'bread', 'oak_sapling', 'bamboo', 'poppy', 'diamond', 'torch', 'name_tag']) {
    assert.ok(!H.hubThrowable(n, () => true), `${n} is never thrown`)
    assert.ok(H.hubKept(n), `${n} is a kept kind`)
  }
  assert.ok(!H.hubKept('flint') && !H.hubKept('andesite'))
  assert.ok(!H.hubThrowable('flint', () => false), 'the well\'s own rule has the last word')
})
await t('the route: junk to the well (UNSORTED with the well off), a plant at its cap stays, the rest to its section', () => {
  assert.deepStrictEqual(H.clerkRoute('flint'), { to: 'well', section: null, why: 'junk' })
  assert.deepStrictEqual(H.clerkRoute('flint', { well: false }), { to: 'hall', section: 'unsorted', why: 'junk_well_off' })
  assert.strictEqual(H.clerkRoute('iron_pickaxe').section, 'tools')
  assert.strictEqual(H.clerkRoute('white_wool').section, 'build', 'a decoration is stored, never thrown')
  assert.deepStrictEqual(H.clerkRoute('name_tag'), { to: 'hall', section: 'unsorted', why: 'unknown' })
  assert.strictEqual(H.clerkRoute('oak_sapling', { plantsHeld: 64 }).to, 'stay')
  assert.strictEqual(H.clerkRoute('oak_sapling', { plantsHeld: 63 }).to, 'hall')
  assert.strictEqual(H.plantCap('bamboo'), 128); assert.strictEqual(H.plantCap('poppy'), 32); assert.strictEqual(H.plantCap('cobblestone'), null)
})

console.log('THE CLERK: THE MOVE-SET')
const HOMES = H.hubHomes(REC)
const keyOf = (section, role = 'home') => k3(REC.chests.find(c => c.section === section && c.role === role).at)
const SRC = '-9,71,-2', SRC2 = '-13,71,0'
const ent = (names, used = null) => ({ names, used: used ?? Object.values(names).reduce((t, v) => t + v[1], 0), size: 27 })
const FULL = () => ent({ cobblestone: [64 * 27, 27] }, 27)
await t('one source, the one with the most movable slots; never a hall chest; each stack to its section\'s home', () => {
  const entries = { [SRC]: ent({ stone_bricks: [883, 14], iron_ingot: [3, 1], cobblestone: [640, 10] }), [SRC2]: ent({ coal: [83, 2] }), [keyOf('stone')]: ent({ spruce_log: [64, 1] }) }
  const m = H.clerkMoves(HOMES, entries, { hubKeys: H.hubChestKeys(REC), held: {}, maxSlots: 6 })
  assert.strictEqual(m.from, SRC, 'a town chest first, the most movable slots')
  const by = Object.fromEntries(m.moves.map(x => [x.name, x]))
  assert.strictEqual(by.stone_bricks.to, keyOf('stone'))
  assert.strictEqual(by.stone_bricks.slots, 6, 'the budget: 6 stacks a visit, the biggest first')
  assert.strictEqual(by.stone_bricks.count, Math.floor(883 * 6 / 14), 'a part of a kind: its share of the count')
  assert.strictEqual(m.moves.length, 1, 'the budget is spent on the bricks')
  assert.ok(!by.cobblestone && m.skipped.leave === 1, 'cobblestone stays (the builders\' and the yard\'s bulk stone)')
  const m2 = H.clerkMoves(HOMES, { [SRC2]: ent({ coal: [83, 2], iron_ingot: [3, 1], flint: [10, 1] }) }, { hubKeys: H.hubChestKeys(REC), held: {}, maxSlots: 6 })
  const by2 = Object.fromEntries(m2.moves.map(x => [x.name, x]))
  assert.deepStrictEqual([by2.coal.to, by2.iron_ingot.to, by2.flint], [keyOf('fuel'), keyOf('metal'), undefined], 'one destination class a visit: the hall (3 slots) over the well (1)')
  const m3 = H.clerkMoves(HOMES, { [SRC2]: ent({ coal: [5, 1], flint: [128, 2] }) }, { hubKeys: H.hubChestKeys(REC) })
  assert.deepStrictEqual(m3.moves.map(x => [x.name, x.to]), [['flint', 'well']], 'the well (2 slots) over the hall (1)')
  const inHall = H.clerkMoves(HOMES, { [keyOf('stone')]: ent({ spruce_log: [64, 1], stone_bricks: [64, 1] }) }, { hubKeys: H.hubChestKeys(REC) })
  assert.deepStrictEqual(inHall.moves.map(x => [x.name, x.to]), [['spruce_log', keyOf('wood')]], 'a misplaced stack in a hall chest goes to its own section; the in-place one stays')
  const ov = H.clerkMoves(HOMES, { [keyOf('overflow')]: ent({ coal: [64, 1] }), [keyOf('fuel')]: FULL() }, { hubKeys: H.hubChestKeys(REC) })
  assert.strictEqual(ov, null, 'out of OVERFLOW only into its own homes: full, it stays')
  assert.strictEqual(H.clerkMoves(HOMES, { [keyOf('stone')]: ent({ stone_bricks: [64, 1] }) }, { hubKeys: H.hubChestKeys(REC) }), null, 'a sorted hall is idle')
})
await t('no merge: a stackable kind the clerk\'s bag holds is never taken (Codex review blocker 3); nor a tool it holds', () => {
  const entries = { [SRC]: ent({ stone_bricks: [883, 14], iron_pickaxe: [1, 1], coal: [10, 1] }) }
  const m = H.clerkMoves(HOMES, entries, { hubKeys: H.hubChestKeys(REC), held: { stone_bricks: 5, iron_pickaxe: 1 } })
  assert.deepStrictEqual(m.moves.map(x => x.name), ['coal'])
  assert.strictEqual(m.skipped.held, 2)
})
await t('THE REFUSAL CHAIN: a full home -> its own overflow -> the general OVERFLOW -> skipped (hall_full); a kept kind never goes to the well', () => {
  const hk = H.hubChestKeys(REC)
  const src = { [SRC]: ent({ iron_ingot: [640, 10] }) }
  let m = H.clerkMoves(HOMES, { ...src, [keyOf('metal')]: FULL() }, { hubKeys: hk })
  assert.ok(m.moves.every(x => x.to === keyOf('metal', 'more')), 'the section\'s own overflow next')
  m = H.clerkMoves(HOMES, { ...src, [keyOf('metal')]: FULL(), [keyOf('metal', 'more')]: FULL() }, { hubKeys: hk })
  assert.ok(m.moves.every(x => x.to === keyOf('overflow')), 'then the general OVERFLOW')
  m = H.clerkMoves(HOMES, { ...src, [keyOf('metal')]: FULL(), [keyOf('metal', 'more')]: FULL(), [keyOf('overflow')]: FULL() }, { hubKeys: hk })
  assert.strictEqual(m, null, 'all full: nothing moves (a full hall is a backlog, never a reason to throw)')
  for (const st of [{}, { [keyOf('metal')]: FULL() }]) {
    const mm = H.clerkMoves(HOMES, { ...src, ...st }, { hubKeys: hk, well: true })
    assert.ok(mm.moves.every(x => x.to !== 'well'))
  }
  const u = H.clerkMoves(HOMES, { [SRC]: ent({ name_tag: [3, 1] }) }, { hubKeys: hk })
  assert.strictEqual(u.moves[0].to, keyOf('unsorted'), 'an unknown item to UNSORTED')
  const u2 = H.clerkMoves(HOMES, { [SRC]: ent({ name_tag: [3, 1] }), [keyOf('unsorted')]: FULL() }, { hubKeys: hk })
  assert.strictEqual(u2.moves[0].to, keyOf('overflow'), 'UNSORTED full: OVERFLOW, never the well')
})
await t('the sources filter, the back-off and the plants cap hold a stack where it is', () => {
  const hk = H.hubChestKeys(REC)
  const entries = { [SRC]: ent({ coal: [10, 1] }), [SRC2]: ent({ oak_sapling: [20, 1], coal: [5, 1] }), [keyOf('plants')]: ent({ oak_sapling: [64, 1] }) }
  assert.strictEqual(H.clerkMoves(HOMES, entries, { hubKeys: hk, sources: new Set([SRC]) }).from, SRC)
  const m = H.clerkMoves(HOMES, entries, { hubKeys: hk, sources: new Set([SRC2]) })
  assert.deepStrictEqual(m.moves.map(x => x.name), ['coal'], 'the sapling at its cap stays')
  assert.ok(m.skipped.plant_cap >= 1)
  assert.strictEqual(H.clerkMoves(HOMES, entries, { hubKeys: hk, sources: new Set([SRC]), skip: (f, n) => n === 'coal' }), null)
})
await t('the cargo: owed is the file clamped to the bag; its keeps leave out only the clerk\'s own junk at its own throw', () => {
  assert.deepStrictEqual(H.cargoOwed({ iron_ingot: 40, flint: 10, coal: 5 }, { iron_ingot: 30, flint: 10 }), { iron_ingot: 30, flint: 10 })
  assert.deepStrictEqual(H.cargoKeeps({ iron_ingot: 30, flint: 10 }).sort(), ['flint', 'iron_ingot'])
  assert.deepStrictEqual(H.cargoKeeps({ iron_ingot: 30, flint: 10 }, { forWell: true, isJunk: W.isWellJunk }), ['iron_ingot'])
  assert.strictEqual(H.clerkWork({ owed: { coal: 1 } }), 'cargo', 'owed cargo first, whatever the gap')
  assert.strictEqual(H.clerkWork({ plan: {}, lastAt: Date.now() }), null, 'within the gap')
  assert.strictEqual(H.clerkWork({ plan: {}, lastAt: 0 }), 'move')
  assert.strictEqual(H.clerkWork({ on: false, owed: { coal: 1 } }), null)
})
await t('the clerk\'s throw (well.mjs disposePlan with clerkKeepOf): only its cargo\'s junk, never a decoration picked up on the walk', () => {
  const bag = [{ slot: 9, name: 'flint', count: 10 }, { slot: 10, name: 'white_stained_glass', count: 5 }, { slot: 11, name: 'iron_ingot', count: 3 }, { slot: 12, name: 'granite', count: 20 }, { slot: 13, name: 'cobblestone', count: 64 }, { slot: 14, name: 'cobblestone', count: 64 }]
  const p = W.disposePlan(bag, { keep: H.clerkKeepOf(bag, ['flint'], W.isWellJunk) })
  assert.deepStrictEqual(p.stacks.map(x => x.name), ['flint'])
  const p0 = W.disposePlan(bag, {})
  assert.ok(p0.stacks.some(x => x.name === 'white_stained_glass'), 'the positive control: the plain plan WOULD throw the decoration')
  const p2 = W.disposePlan(bag, { keep: H.clerkKeepOf(bag, ['flint', 'iron_ingot', 'white_stained_glass'], W.isWellJunk) })
  assert.deepStrictEqual(p2.stacks.map(x => x.name), ['flint'], 'a kept kind passed as `only` is still kept (the allowlist is re-checked)')
  const p3 = W.disposePlan(bag, { keep: H.clerkKeepOf(bag, ['granite'], W.isWellJunk) })
  assert.deepStrictEqual(p3.stacks.map(x => x.name), ['granite'], 'a scaffold decoration goes, above the well\'s 64 stone guard')
})
await t('the switches: on in the showcase pool; STOREHUB=off, STOREHUB_CLERKS=0, STOREHUB_WELL=off each stop their part', () => {
  assert.strictEqual(H.hubSwitches({}, 'showcase').on, true)
  assert.strictEqual(H.hubSwitches({}, 'hive-a').on, false)
  assert.deepStrictEqual(H.hubSwitches({ STOREHUB: 'off' }, 'showcase'), { on: false, clerks: 0, clerk: false, well: false, signs: false })
  assert.strictEqual(H.hubSwitches({ STOREHUB_CLERKS: '0' }, 'showcase').clerk, false)
  assert.strictEqual(H.hubSwitches({ STOREHUB_CLERKS: '3' }, 'showcase').clerks, 1, 'one clerk (owner O4)')
  assert.strictEqual(H.hubSwitches({ STOREHUB_WELL: 'off' }, 'showcase').well, false)
  assert.ok(/clerk=1 clerks=1 well=1 signs=1 plot=storehub blueprint=storehub@1 chests=18/.test(H.hubModeDetail(H.hubSwitches({}, 'showcase'))))
})
await t('the clerk row names every throw first (junked=), the tripwire\'s field', () => {
  const d = H.clerkRowDetail({ junked: { flint: 10 }, took: { flint: 10, iron_ingot: 3 }, src: SRC, stop: 'done' })
  assert.ok(/^phase=visit junked=flint:10 src=/.test(d), d)
})

console.log('MUTANTS (each anchor present and unique)')
await t('MUTANT KILLED: the allowlist without its never-throw guard throws a kept kind on a widened list', async () => {
  await withMutant(HUB_PATH, "=> typeof name === 'string' && THROWABLE.has(name) && !HUB_NEVER_THROW.test(name) && !!isJunk(name)",
    "=> typeof name === 'string' && (THROWABLE.has(name) || /_ingot$/.test(name)) && !!isJunk(name)", async M => {
      assert.ok(M.hubThrowable('iron_ingot', () => true), 'the mutant throws an ingot')
    })
  assert.ok(!H.hubThrowable('iron_ingot', () => true))
})
await t('MUTANT KILLED: dropping the no-merge rule takes a kind the bag holds', async () => {
  const entries = { [SRC]: ent({ stone_bricks: [883, 14] }) }
  await withMutant(HUB_PATH, "if ((Number(held?.[name]) || 0) > 0) { skipped.held = (skipped.held ?? 0) + 1; continue }", '', async M => {
    assert.ok(M.clerkMoves(M.hubHomes(REC), entries, { hubKeys: M.hubChestKeys(REC), held: { stone_bricks: 5 } }), 'the mutant moves it')
  })
  assert.strictEqual(H.clerkMoves(HOMES, entries, { hubKeys: H.hubChestKeys(REC), held: { stone_bricks: 5 } }), null)
})
await t('MUTANT KILLED: an in-place stack in a hall chest moved (the clerk churning the sorted hall)', async () => {
  const entries = { [keyOf('stone')]: ent({ stone_bricks: [64, 1] }) }
  await withMutant(HUB_PATH, "if (r.to === 'hall' && r.section === own.section) continue", '', async M => {
    assert.ok(M.clerkMoves(M.hubHomes(REC), entries, { hubKeys: M.hubChestKeys(REC) }), 'the mutant moves a sorted stack')
  })
})
await t('MUTANT KILLED: cobblestone moved', async () => {
  const entries = { [SRC]: ent({ cobblestone: [640, 10] }) }
  await withMutant(HUB_PATH, "if (CLERK_LEAVE.has(name)) { skipped.leave = (skipped.leave ?? 0) + 1; continue }", '', async M => {
    assert.ok(M.clerkMoves(M.hubHomes(REC), entries, { hubKeys: M.hubChestKeys(REC) }))
  })
  assert.strictEqual(H.clerkMoves(HOMES, entries, { hubKeys: H.hubChestKeys(REC) }), null)
})
await t('MUTANT KILLED: the overflow order (the general OVERFLOW before the section\'s own)', async () => {
  const entries = { [SRC]: ent({ iron_ingot: [64, 1] }), [keyOf('metal')]: FULL() }
  await withMutant(HUB_PATH, "return [...(homes.homeOf.get(section) ?? []), ...homes.overflow]", "return [...homes.overflow, ...(homes.homeOf.get(section) ?? [])]", async M => {
    assert.strictEqual(M.clerkMoves(M.hubHomes(REC), entries, { hubKeys: M.hubChestKeys(REC) }).moves[0].to, keyOf('overflow'))
  })
  assert.strictEqual(H.clerkMoves(HOMES, entries, { hubKeys: H.hubChestKeys(REC) }).moves[0].to, keyOf('metal', 'more'))
})

console.log('THE WIRING (structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const SH = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
const WIRES = {
  'the project, after the storehouse': /Object\.freeze\(\{ plot: HUB_PLOT, blueprint: HUB_BLUEPRINT, after: STORE_PLOT, builders: HUB_BUILDERS \}\)/,
  'its switch': /p\.plot === HUB_PLOT \? hub && store && on/,
  'the registry in the town scan': /for \(const k0 of townExtraKeys\(home\)\) \{\n\s*const c = keyVec\(k0\)\n\s*const b = bot\.blockAt\?\.\(c\)\n\s*if \(!b\) \{ coverage = false; continue \}\s*\n\s*if \(CONTAINER_RE\.test\(blockNameOf\(bot, b\) \?\? ''\) && depositTargetOk\(home, c\)\) keys\.add\(containerKey\(bot, c\)\)/,
  'the siting': /const ss = await hubSiteFor\(bot, \{ \.\.\.h\.head\.plan, gen: h\.head\.gen \}, c, stood, signal\)/,
  'the upkeep visit': /if \(plot === HUB_PLOT && rec\.structure_complete && !recordDamaged\(bot, rec, \{ tidy: false \}\) && hubUpkeepDue\(bot, rec\)\) return hubUpkeepVisit\(ctx, rec, signal, out\)/,
  'the stands': /const storeOpts = rec\.blueprint === ENCHANT_BLUEPRINT \? enchantVisitOpts\(rec\) : rec\.blueprint === HUB_BLUEPRINT \? hubVisitOpts\(rec\) :/,   // enchantshop-01: the workshop's opts first on the same line
  'the order sees the upkeep': /if \(tidy && r\.blueprint === HUB_BLUEPRINT && hubUpkeepDue\(bot, r\)\) return true/,
  'the cargo intent before the take': /if \(!hubCargoWrite\(bot, Object\.fromEntries\(want\.map\(w => \[w\.name, w\.count\]\)\)\)\) \{/,
  'the clerk\'s throw is listed-only': /const clerk = _args\?\.via === 'clerk' && !pruned\n(?:.*\n){0,6}?\s*const visit = \(_args\?\.visit === true \|\| clerk\) && !pruned/,
  'every dispose keeps the cargo': /const cargoKeep = hubCargoKeeps\(bot, \{ forWell: clerk \}\)/,
  // the showcase batch4 fold: the yard's reserve on the same line (yarduse-01), the bag read once (bagNow)
  'the throw plan reads the keep': /stock: out\.stock, keep: keepOf \? keepOf\(bagNow\) : keep, cobbleReserve \}\)/,
  'the clerk throws ONLY its junk names, judged on the bag at the throw': /const r = await disposeWell\(ctx, \{ via: 'clerk', only: junk \}, signal\)/,
  'an unverified take keeps its intent': /hubCargoWrite\(bot, took \?\? hubOwed\(bot\)\)/,
  'the pit throw keeps the cargo': /signal, keep: hubCargoKeeps\(bot\) \}\)/,
  'the clerk\'s well row names what went down FIRST (the logger\'s cut never reaches it)': /const detail = \(viaOf\(ph\.account\?\.lost\) \+ phaseDetail\(ph, cap, stop, capEndOf\(bot, cap\)\)\)\.slice\(0, 300\)/,
  'the clerk throws only its junk': /const junk = Object\.keys\(owed\)\.filter\(n => wellOn && hubThrowable\(n, isWellJunk\) && \(!routes\.size \|\| routes\.get\(n\)\?\.to === 'well'\)\)/,
}
await t('wiring: the project, its switch, the registry, the siting, the upkeep, the stands, the cargo, the clerk\'s throw', () => {
  for (const [what, re] of Object.entries(WIRES)) {
    const n = ((what.startsWith('the project') || what === 'its switch' ? SH : SK).match(new RegExp(re.source, 'g')) ?? []).length
    assert.strictEqual(n, 1, `${what}: ${n} matches`)
  }
})
await t('MUTANTS KILLED: each wiring check fails on its line broken (anchor present and unique)', () => {
  const lines = {
    'the cargo intent before the take': ['if (!hubCargoWrite(bot, Object.fromEntries(want.map(w => [w.name, w.count])))) {', 'if (false) {'],
    'every dispose keeps the cargo': ['const cargoKeep = hubCargoKeeps(bot, { forWell: clerk })', 'const cargoKeep = []'],
    'the throw plan reads the keep': ['stock: out.stock, keep: keepOf ? keepOf(bagNow) : keep, cobbleReserve })', 'stock: out.stock, keep, cobbleReserve })'],
    'an unverified take keeps its intent': ['hubCargoWrite(bot, took ?? hubOwed(bot))', 'hubCargoWrite(bot, took ?? {})'],
    'the clerk throws only its junk': ["const junk = Object.keys(owed).filter(n => wellOn && hubThrowable(n, isWellJunk) && (!routes.size || routes.get(n)?.to === 'well'))", 'const junk = Object.keys(owed)'],
  }
  for (const [what, [old, neu]] of Object.entries(lines)) {
    assert.strictEqual(SK.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${what}`)
    const mut = SK.replace(old, neu)
    assert.notStrictEqual((mut.match(new RegExp(WIRES[what].source, 'g')) ?? []).length, 1, `the check survives the mutant: ${what}`)
  }
})

await t('the tripwire\'s copy of the lists (shopread.py.txt SH1) is this module\'s, when the read is on this branch', () => {
  let src = null
  try { src = readFileSync(new URL('../../docs/reports/shop-01-2026-10-25/shopread.py.txt', import.meta.url), 'utf8') } catch { src = null }
  if (!src || !/HUB_THROWABLE = frozenset\(/.test(src)) { console.log('        (shopread.py.txt on this branch has no SH1 yet: the read\'s own selftest checks the copy)'); return }
  const m = /HUB_THROWABLE = frozenset\(\[([\s\S]*?)\]\)/.exec(src)
  assert.deepStrictEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort(), [...H.HUB_THROWABLE].sort())
  const n = /HUB_NEVER_THROW = re\.compile\(r'(.*)'\)\n/.exec(src)
  assert.strictEqual(n?.[1], H.HUB_NEVER_THROW.source)
})

console.log(`\nstorehub: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
