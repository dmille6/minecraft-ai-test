// COPPERHALL-01: the copper hall (bots/src/copperhall.mjs, blueprints/hall@1.json, shop.mjs PROJECTS / activeProject `waiting`,
// buildsite.mjs screenSite `domain` / `earth`). Behaviour: the bill; the opening rule (318 refuses, 319 opens); the order never
// offers a waiting hall and offers it once open; the hall sites and PROVES on a flat town at its plan plot, copper last too, and the
// control without the step ring fails; a deep bot pit is left as a covered void; a zone or a reservation sites nothing and says
// why; screenSite without the new options is unchanged; weathered copper reads as placed. Mutants assert their anchors.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const H = await import('../src/copperhall.mjs')
const S = await import('../src/shop.mjs')
const B = await import('../src/buildsite.mjs')
const BR = await import('../src/buildrun.mjs')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const HALL_PATH = new URL('../src/copperhall.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const G = 69
const HOME = { x: 0, y: G + 1, z: 0 }
const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
function world (cells = {}) {
  return (x, y, z) => {
    if (Math.abs(x) > 60 || Math.abs(z) > 60 || y < G - 20 || y > G + 40) return null
    const n = cells[`${x},${y},${z}`] ?? (y < G ? 'stone' : y === G ? 'grass_block' : 'air')
    return { name: n, boundingBox: box(n) }
  }
}
function plan (hallSector = 'SW') {
  return {
    v: 1, template: 'ring@1', gen: 3, prev: 2, home: HOME, s: G + 1, mode: 'retrofit', at: 1, world: 'w', orientation: 'W',
    plots: [
      { id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], y: G + 1, state: 'existing', keepout: false },
      { id: 'hall', kind: 'hall', sector: hallSector, state: 'planned' },
    ],
    paths: [], groups: {}, transitions: [],
  }
}
const BP = B.loadBlueprint('hall@1')

await t('the blueprint: 477 cells, 33 cut copper with NO fallback; the bill is the design\'s (section 4)', () => {
  assert.equal(BP.cells.length, 477)
  const roles = {}
  for (const c of BP.cells) roles[c.role] = (roles[c.role] ?? 0) + 1
  assert.equal(roles.copper, H.HALL_CUT_NEEDED)
  assert.deepEqual(BP.palette.copper, ['cut_copper'], 'no stone fallback: a placed cell is never rebuilt')
  const r = H.hallSite(world(), plan(), BP, {})
  assert.ok(r.ok, `${r.why} ${r.detail ?? ''}`)
  assert.deepEqual(r.record.bom, { stone_bricks: 306, $planks: 117, glass_pane: 13, cut_copper: 33, torch: 4, chest: 4 })
})

await t('the opening rule: 318 ingots with 10 cut refuses, 319 opens; an unknown count never opens', () => {
  assert.deepEqual([H.hallOpening({ ingots: 318, cut: 10 }).open, H.hallOpening({ ingots: 319, cut: 10 }).open], [false, true])
  assert.equal(H.hallOpening({ ingots: 319, cut: 10 }).need, 103 + 36 * 6)
  assert.equal(H.hallOpening({ ingots: 103, cut: 33 }).open, true, 'all the cut copper in town: the floor alone')
  assert.equal(H.hallOpening({ ingots: null, cut: 10 }).why, 'copper_unknown')
  // the stall case (design 4): once open, every batch's ingots sit above the project floor, inside one active window
  const o = H.hallOpening({ ingots: 319, cut: 10 })
  assert.ok(o.have - o.floor >= H.INGOTS_PER_BATCH * o.batches)
})

await t('r3 (LIVE 11-02: every gate row read 0): the town copper is each container\'s LATEST observation, fresh or stale; dirty and unobserved count nothing', () => {
  const obs = (ci, cc, at = 1) => ({ obs: { at, names: { ...(ci ? { copper_ingot: [ci, 3] } : {}), ...(cc ? { cut_copper: [cc, 1] } : {}), torch: [12, 1] } } })
  const entries = { '-9,71,2': obs(64), '-13,71,2': obs(66, 10), '-5,71,8': obs(0), '-7,71,8': obs(40), '1,71,1': { last: { t: 'dirty' } }, _ingredient_miss: { '-9,71,2': {} } }
  const state = e => (e === entries['-7,71,8'] ? 'dirty' : e === entries['-9,71,2'] ? 'stale' : 'known')
  assert.deepEqual(H.townCopperOf(entries, state), { ingots: 130, cut: 10, containers: 3, stale: 1, raw: 0, blocks: 0 })
  assert.deepEqual(H.townCopperOf(null), { unknown: true }, 'no index: unknown (never opens)')
  assert.deepEqual(H.townCopperOf({}, state), { unknown: true }, 'no observed container: unknown, not 0')
  assert.equal(H.hallOpening({ ingots: 130, cut: 10 }).open, false)
})

await t('Codex r3 BLOCK: a single chest that became the other half of a double chest is counted once (the newer double observation)', () => {
  const entries = {
    '-9,71,2': { obs: { at: 5, h: ['-9,71,2', '-9,71,3'], names: { copper_ingot: [160, 3], cut_copper: [10, 1] } } },
    '-9,71,3': { obs: { at: 2, h: ['-9,71,3'], names: { copper_ingot: [160, 3], cut_copper: [10, 1] } } },
  }
  assert.deepEqual(H.townCopperOf(entries), { ingots: 160, cut: 10, containers: 1, stale: 0, raw: 0, blocks: 0 })
  // a half observed AFTER the double (it was split again): its own observation counts
  entries['-9,71,3'].obs.at = 9
  assert.equal(H.townCopperOf(entries).containers, 2)
})

await t('MUTANT KILLED: without the halves rule the double chest counts twice and the hall opens on 160', async () => {
  await withMutant(HALL_PATH, '    if (covered.has(k) && covered.get(k) >= (Number(e.obs.at) || 0)) continue\n', '', async M => {
    const entries = { a: null, '-9,71,2': { obs: { at: 5, h: ['-9,71,2', '-9,71,3'], names: { copper_ingot: [160, 3] } } }, '-9,71,3': { obs: { at: 2, names: { copper_ingot: [160, 3] } } } }
    assert.equal(M.townCopperOf(entries).ingots, 320)
  })
})

await t('MUTANT KILLED: a count of FRESH entries only (the live bug) reads the stale copper chest as nothing', async () => {
  await withMutant(HALL_PATH, "    if (st !== 'known' && st !== 'stale') continue\n", "    if (st !== 'known') continue\n", async M => {
    const entries = { '-9,71,2': { obs: { names: { copper_ingot: [130, 3] } } }, '-5,71,8': { obs: { names: { torch: [1, 1] } } } }
    assert.equal(M.townCopperOf(entries, e => (e === entries['-9,71,2'] ? 'stale' : 'known')).ingots, 0)
    assert.equal(H.townCopperOf(entries, e => (e === entries['-9,71,2'] ? 'stale' : 'known')).ingots, 130)
  })
})

await t('MUTANT KILLED: an opening rule without the project floor opens at 216, and the draws would lock themselves out', async () => {
  await withMutant(HALL_PATH, '  const need = floor + INGOTS_PER_BATCH * batches\n', '  const need = INGOTS_PER_BATCH * batches\n', async M => {
    assert.equal(M.hallOpening({ ingots: 216, cut: 10 }).open, true)
  })
  assert.equal(H.hallOpening({ ingots: 216, cut: 10 }).open, false)
})

const P = S.projectsOn(true, true, true, true, false, true, true, true, true, true)
const done = P.filter(p => !['hall', 'tidy'].includes(p.plot)).map(p => ({ plot: p.plot, exists: true, complete: true, damaged: false }))
await t('the order: a WAITING hall is never offered (the next project is); an open one is, after the storehouse', () => {
  assert.ok(P.some(p => p.plot === 'hall'))
  assert.equal(S.activeProject([...done, { plot: 'hall', exists: false, complete: false, damaged: false, waiting: true }], P).plot, 'tidy')
  assert.equal(S.activeProject([...done, { plot: 'hall', exists: false, complete: false, damaged: false }], P).plot, 'hall')
  assert.equal(S.activeProject([...done, { plot: 'hall', exists: true, complete: false, damaged: false, waiting: true }], P).plot, 'hall', 'a sited hall never waits')
  const noStore = done.map(s => (s.plot === 'storehouse' ? { ...s, complete: false } : s))
  assert.equal(S.activeProject([...noStore, { plot: 'hall', exists: false, complete: false, damaged: false }], P).plot, 'storehouse')
  assert.ok(!S.projectsOn(true, true, true, true, false, true, false, true, true, false).some(p => p.plot === 'hall'), 'COPPERHALL=off')
  assert.ok(!S.projectsOn(true, true, true, true, false, true, false, false, true, true).some(p => p.plot === 'hall'), 'never without the storehouse')
  assert.equal(H.copperhallOn({}, 'showcase'), true); assert.equal(H.copperhallOn({}, 'hive-a'), false); assert.equal(H.copperhallOn({ COPPERHALL: 'off' }, 'showcase'), false)
})

await t('Claude r1 BLOCK: in the SHOWCASE switch set (tidy and stair off) a waiting hall is not the fallback: the order reads the storehouse complete and the expeditions are asked', () => {
  const SC = S.projectsOn(true, true, true, true, false, true, false, true, true, true)
  assert.equal(SC.at(-1).plot, 'hall', 'the hall is the showcase list\'s last')
  const doneSC = SC.filter(p => p.plot !== 'hall').map(p => ({ plot: p.plot, exists: true, complete: true, damaged: false }))
  const pick = S.activeProject([...doneSC, { plot: 'hall', exists: false, complete: false, damaged: false, waiting: true }], SC)
  assert.equal(pick.plot, 'storehouse')
  S.setExpeditionAsk(() => ({ ok: true, phase: 'trip' }))
  try {
    const r = S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: 1e12, complete: true, record: { plot: 'storehouse', structure_complete: true }, state: {} })
    assert.equal(r.order?.args?.expedition, true, 'the idle builder may go out')
  } finally { S.setExpeditionAsk(null) }
  // the open hall is offered as before
  assert.equal(S.activeProject([...doneSC, { plot: 'hall', exists: false, complete: false, damaged: false }], SC).plot, 'hall')
})

await t('MUTANT KILLED: the old fallback makes the waiting hall the showcase\'s active project', async () => {
  await withMutant(SHOP_PATH, '  for (let i = list.length - 1; i >= 0; i--) { const s = st(list[i]); if (!list[i].sink && !(!s.exists && s.waiting === true)) return list[i] }\n', '', async M => {
    const SC = M.projectsOn(true, true, true, true, false, true, false, true, true, true)
    const doneSC = SC.filter(p => p.plot !== 'hall').map(p => ({ plot: p.plot, exists: true, complete: true, damaged: false }))
    assert.equal(M.activeProject([...doneSC, { plot: 'hall', exists: false, complete: false, damaged: false, waiting: true }], SC).plot, 'hall')
  })
})

await t('MUTANT KILLED: an order blind to `waiting` offers the hall before the copper is there', async () => {
  await withMutant(SHOP_PATH, '    if (!s.exists && s.waiting === true) continue\n', '', async M => {
    assert.equal(M.activeProject([...done, { plot: 'hall', exists: false, complete: false, damaged: false, waiting: true }], P).plot, 'hall')
  })
})

await t('the site: the plan\'s SW hall plot, pad x -21..-7 z 21..33, proven (every placement a stand, the interior walked to); copper last proves too', () => {
  const r = H.hallSite(world(), plan(), BP, {})
  assert.ok(r.ok)
  assert.deepEqual(r.record.box, [-21, 21, -7, 33])
  assert.equal(r.record.plot, 'hall'); assert.equal(r.record.s, G + 1)
  assert.equal(r.record.interior.reachable, r.record.interior.open)
  // copper last: the shell, roof and fit-out first, then the trim, then the lintel (the order when copper arrives late)
  const segs = BP.segments.filter(s => !/^copper/.test(s.seg))
  const late = { ...BP, segments: [...segs, BP.segments.find(s => s.seg === 'copper-trim'), BP.segments.find(s => s.seg === 'copper-lintel')] }
  const site = B.screenSite(world(), HOME, late, { x: -21, z: 21 }, 'E', B.reservations(plan(), {}), { domain: H.hallDomain([-21, 21, -7, 33], [], { reach: 1, gap: 0 }), earth: H.HALL_EARTH })
  assert.ok(site.ok, site.why)
  const p = B.proveSite(world(), HOME, late, site, { domain: H.hallDomain([-21, 21, -7, 33], []) })
  assert.ok(p.ok, `${p.why} ${p.detail ?? ''}`)
  // the control: without the step ring, the first copper cap at s+3 has no stand
  const noRing = { ...late, cells: late.cells.filter(c => c.seg !== 'ring'), segments: late.segments.filter(s => s.seg !== 'ring').map(s => ({ ...s, deps: s.deps.filter(d => d !== 'ring') })) }
  const p2 = B.proveSite(world(), HOME, noRing, site, { domain: H.hallDomain([-21, 21, -7, 33], []) })
  assert.equal(p2.ok, false); assert.equal(p2.why, 'no_step')
})

await t('a bot pit 2 x 2 and 3 deep under the pad: its bottom fill cells are left as a covered void (the cell above is placed off its sides)', () => {
  const pit = {}
  for (const y of [G, G - 1, G - 2]) for (const x of [-14, -13]) for (const z of [27, 28]) pit[`${x},${y},${z}`] = 'air'   // a 2 x 2 pit, 3 deep
  const r = H.hallSite(world(pit), plan(), BP, {})
  assert.ok(r.ok, `${r.why} ${r.detail ?? ''}`)
  assert.equal(r.record.voids.length, 4, JSON.stringify(r.record.voids))
  assert.ok(r.record.voids.every(v => v[1] === G - 2), 'only the bottom layer')
  assert.ok(r.record.fill.some(f => f[0] === -14 && f[1] === G && f[2] === 27), 'the top fill cell is placed')
})

await t('MUTANT KILLED: without the void rule the pit leaves the hall unsited (no_step earth)', async () => {
  await withMutant(HALL_PATH, '    if (!fill.some(f => f[0] === x && f[2] === z && f[1] > y)) return { ...p, voids, fill }\n', '    return { ...p, voids, fill }\n', async M => {
    const pit = {}
    for (const y of [G, G - 1, G - 2]) for (const x of [-14, -13]) for (const z of [27, 28]) pit[`${x},${y},${z}`] = 'air'   // a 2 x 2 pit, 3 deep
    const r = M.hallSite(world(pit), plan(), BP, {})
    assert.equal(r.ok, false); assert.equal(r.why, 'no_step')
  })
})

await t('siting refuses and says why: a protected zone on the pad, a reservation (another record), no hall plot, the wrong sector', () => {
  const z = H.hallSite(world(), plan(), BP, { zones: [{ id: 'z', box: [-15, -64, 25, -10, 320, 30] }] })
  assert.equal(z.ok, false); assert.equal(z.why, 'zone')
  const o = H.hallSite(world(), plan(), BP, { others: [{ plot: 'treefarm', box: [-30, 15, -15, 25] }] })
  assert.equal(o.ok, false)
  assert.equal(H.hallSite(world(), { ...plan(), plots: [] }, BP, {}).why, 'no_hall_plot')
  assert.equal(H.hallSite(world(), plan('NE'), BP, {}).why, 'hall_sector_NE')
  // the tree farm's real box (x -39..-23, z 4..20) is one column clear of the ring: it sites
  assert.ok(H.hallSite(world(), plan(), BP, { others: [{ plot: 'treefarm', box: [-39, 4, -23, 20] }] }).ok)
})

await t('screenSite without the new options is unchanged: the hall pad is outside the workshop ring (inDomain) and the house EARTH holds', () => {
  const res = B.reservations(plan(), {})
  assert.equal(B.screenSite(world(), HOME, BP, { x: -21, z: 21 }, 'E', res).why, 'domain')
  // a sloped pad the hall's limits take and the house's refuse
  const slope = {}
  for (let x = -21; x <= -7; x++) for (let z = 21; z <= 33; z++) if (x > -14) { slope[`${x},${G + 1},${z}`] = 'dirt'; slope[`${x},${G + 2},${z}`] = 'grass_block'; slope[`${x},${G},${z}`] = 'dirt' }
  const dom = H.hallDomain([-21, 21, -7, 33], [], { reach: 1, gap: 0 })
  assert.equal(B.screenSite(world(slope), HOME, BP, { x: -21, z: 21 }, 'E', res, { domain: dom }).ok, false, 'EARTH: fill 40 / cut 30')
  assert.equal(B.screenSite(world(slope), HOME, BP, { x: -21, z: 21 }, 'E', res, { domain: dom, earth: H.HALL_EARTH }).ok, true)
})

await t('weathered and waxed copper read as the placed cut copper (the builder never re-places an aged pilaster)', () => {
  for (const n of ['exposed_cut_copper', 'weathered_cut_copper', 'oxidized_cut_copper', 'waxed_weathered_cut_copper']) assert.equal(BR.blockFamily(n), 'cut_copper')
})

await t('wiring (structural): the order reads the gate, the visit sites the hall only open, its stands use the hall domain; no axe on copper', () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (re, what) => assert.equal((src.match(re) ?? []).length, 1, what)
  one(/const waiting = p\.plot === HALL_PLOT && !rec \? !hallOpenNow\(b\)\.open : false/g, 'the order state')
  one(/const c = bot \? townCopperOf\(townIndexEntries\(bot\), e => indexStateOf\(e\)\) : \{ unknown: true \}/g, 'the gate counts the index')
  one(/if \(!o\.open\) return out\('no_effect', 'copper_wait'/g, 'the visit gate')
  one(/: rec\.blueprint === HALL_BLUEPRINT \? \{ domain: hallRecordDomain\(rec, projectHeads\(\)\.map\(x => x\.head\.rec\)\) \}/g, 'the stand domain')
  one(/if \((plot !== COTTAGE_PLOT && )?plot !== STORE_PLOT && plot !== SHOPCHEST_PLOT && plot !== HALL_PLOT( && plot !== YARD_PLOT)?( && plot !== HUB_PLOT)?( && plot !== ENCHANT_PLOT)?\) \{/g, 'the generic siting skips the hall (and yardsite-01: the yard, sited by yardSiteFor; storehub-01: the storage hall, by hubSiteFor; enchantshop-01: the workshop, by enchantSiteFor; townstyle-01: the cottage, by cottageSiteFor)')
  for (const line of src.split('\n')) assert.ok(!(/_axe\b/.test(line) && /copper/.test(line)), `an axe near copper: ${line.trim().slice(0, 100)}`)
})

// ---- THE SHOWCASE'S OWN TERRAIN (fixtures/copperhall-01-terrain-20261102.json: a read-only region export of the SW terrace, the
// plan, the protected zones and the other records as they stood 11-02 00:41Z) -- the design's sandbox gate (section 6) --------------
const FX = JSON.parse(readFileSync(new URL('./fixtures/copperhall-01-terrain-20261102.json', import.meta.url), 'utf8'))
function fxRead () {
  const col = new Map()
  for (const [k, runs] of Object.entries(FX.cols)) { const a = []; for (const [i, n] of runs) for (let j = 0; j < n; j++) a.push(FX.pal[i]); col.set(k, a) }
  return (x, y, z) => {
    const a = col.get(`${x},${z}`)
    if (!a) return null
    if (y < FX.y0) return { name: 'stone', boundingBox: 'block' }
    const n = a[y - FX.y0]
    if (n == null) return { name: 'air', boundingBox: 'empty' }
    return n === 'unknown' ? null : { name: n, boundingBox: box(n) }
  }
}
await t('THE SHOWCASE TERRAIN: the hall sites and proves at floor 65 (s 66): fill <= 3 a column, the 2 pits left as covered voids, the interior walked to', () => {
  const r = H.hallSite(fxRead(), FX.plan, BP, { zones: [...FX.zones, ...FX.recordZones], others: FX.records, stood: B.planTownCells(FX.plan) })
  assert.ok(r.ok, `${r.why} ${r.detail ?? ''}`)
  const rec = r.record
  assert.equal(rec.s, 66); assert.equal(rec.floor, 65)
  const per = new Map(); for (const f of rec.fill) { const k = `${f[0]},${f[2]}`; per.set(k, (per.get(k) ?? 0) + 1) }
  assert.ok(Math.max(...per.values()) <= 3, 'the design gate: fill <= ~5 a column')
  assert.ok(rec.fill.length <= H.HALL_EARTH.fill && rec.earthwork.cut <= H.HALL_EARTH.cut)
  assert.ok(rec.voids.length >= 1 && rec.voids.length <= 6, `voids ${JSON.stringify(rec.voids)}`)
  assert.equal(rec.interior.reachable, rec.interior.open)
  assert.equal(rec.bom.cut_copper, 33)
})

await t('MUTANT KILLED: the house\'s EARTH on the hall refuses the showcase terrace (the reason the hall has its own limits)', async () => {
  await withMutant(HALL_PATH, ', earth: HALL_EARTH })', ' })', async M => {
    const r = M.hallSite(fxRead(), FX.plan, BP, { zones: [...FX.zones, ...FX.recordZones], others: FX.records, stood: B.planTownCells(FX.plan) })
    assert.equal(r.ok, false); assert.equal(r.why, 'earthwork')
  })
})

console.log(`\ncopperhall: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
