// COUNTRY-01 (OWNER 11-07 / 11-09): THE COUNTRYSIDE -- its own record chain, in rings out from the wall, worked by the grounds crew IN
// PARALLEL with the inside-the-wall stage; groves and flower drifts on the band's untouched grass (country.mjs).
// MEASURED (showcase snapshot 11-09 12:10Z, the bots' own siteStage offline): bands rim48/64/80 hold 633 + 986 + 964 fill cells and
// 224 + 498 + 420 cuts that today wait for the inside stage (2,601 cells) to close; ~38 flowers stand outside the wall in ~63k columns.
// Behaviour first (the stages, the cursor, the lane, the state the orders read, the plantings, the band survey off the wall), then the
// wiring. Mutants anchored and unique.
import assert from 'node:assert'
import fs from 'node:fs'
const CO = await import('../src/country.mjs')
const LP = await import('../src/landplan.mjs')
const TI = await import('../src/tidy.mjs')
const PK = await import('../src/park.mjs')
const SHOP = await import('../src/shop.mjs')

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
const CO_PATH = new URL('../src/country.mjs', import.meta.url)
const LP_PATH = new URL('../src/landplan.mjs', import.meta.url)
const MIN = 60_000, T0 = Date.parse('2026-11-09T12:00:00Z')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')

console.log('THE STAGES AND THE CURSOR (countryStages, countryNext, countryDemand)')
await t('the bands: everything outside the wall boxes out to 48, then 16-wide rings to COUNTRY.r; roads only inside the land plan\'s reach', () => {
  const st = CO.countryStages()
  assert.deepStrictEqual(st.map(s => s.id), ['c48', 'c64', 'c80', 'c96', 'c112', 'c128'])
  assert.deepStrictEqual(st.map(s => [s.rMin, s.rMax]), [[0, 48], [48, 64], [64, 80], [80, 96], [96, 112], [112, 128]])
  for (let i = 1; i < st.length; i++) assert.strictEqual(st[i].rMin, st[i - 1].rMax, 'contiguous: no ring of the countryside is never surveyed')
  assert.deepStrictEqual(st.map(s => s.roads), ['spokes', 'spokes', 'spokes', null, null, null])
  // the land plan's own band numbers within its reach (tidy.mjs stageRoadCols reads the band before by number)
  assert.deepStrictEqual(st.slice(0, 3).map(s => s.k), LP.landStages().filter(s => /^rim/.test(s.id)).map(s => s.k))
})
await t('the cursor: none -> c48; open -> nothing; complete c64 -> c80; the last band waits COUNTRY.cycleMs (2 h) then wraps; an unknown band -> c48', () => {
  assert.strictEqual(CO.countryNext(null, T0).id, 'c48')
  assert.strictEqual(CO.countryNext({ stageId: 'c64', structure_complete: false }, T0), null)
  assert.strictEqual(CO.countryNext({ stageId: 'c64', structure_complete: true, completeAt: T0 }, T0).id, 'c80')
  const last = { stageId: 'c128', structure_complete: true, completeAt: T0 }
  assert.strictEqual(CO.countryNext(last, T0 + 119 * MIN), null)
  assert.strictEqual(CO.countryNext(last, T0 + 120 * MIN).id, 'c48')
  assert.strictEqual(CO.countryNext({ stageId: 'rim48', structure_complete: true, completeAt: T0 }, T0).id, 'c48')
  assert.deepStrictEqual(CO.countryTryOrder(CO.countryStageOf('c96')).map(s => s.id), ['c96', 'c112', 'c128'])
})
await t('the demand: site (none, or the next band due) | open | null (quiet)', () => {
  assert.strictEqual(CO.countryDemand(null, T0), 'site')
  assert.strictEqual(CO.countryDemand({ stageId: 'c48', structure_complete: false }, T0), 'open')
  assert.strictEqual(CO.countryDemand({ stageId: 'c48', structure_complete: true, completeAt: T0 }, T0), 'site')
  assert.strictEqual(CO.countryDemand({ stageId: 'c128', structure_complete: true, completeAt: T0 }, T0 + MIN), null)
})

console.log('THE INSIDE CHAIN ENDS AT THE WALL (landplan.mjs nextStageCycle `inner`)')
await t('a complete inside-the-wall stage: inner -> nothing until the cycle, then the terrace; without it -> rim48 (the old ring order)', async () => {
  const scenario = M => {
    const rec = { stageId: 'inwall', terraceV: 1, structure_complete: true, completeAt: T0 }
    assert.strictEqual(M.nextStageCycle(rec, T0 + MIN, { inner: true }), null)
    assert.strictEqual(M.nextStageCycle(rec, T0 + 31 * MIN, { inner: true })?.id, 'terrace')
    assert.strictEqual(M.nextStageCycle(rec, T0 + MIN)?.id, 'rim48', 'COUNTRY=off: the bands after the inside, as before')
    assert.strictEqual(M.nextStageCycle({ stageId: 'roads', terraceV: 1, structure_complete: true, completeAt: T0 }, T0, { inner: true })?.id, 'inwall', 'the stages before the wall go on')
  }
  await killedBy(LP_PATH, LP, '  if (n && !(inner && n.k > lastInnerK(L))) return n\n', '  if (n) return n\n', scenario)
})

console.log('THE CREW\'S LANE (countrySide, groundsLane)')
await t('the country side: the upper half of the helper leases under the cap', () => {
  assert.deepStrictEqual(['helper1', 'helper2', 'helper3', 'helper4'].map(n => CO.countrySide(n, 4)), ['inside', 'inside', 'country', 'country'])
  assert.deepStrictEqual(['helper1', 'helper2'].map(n => CO.countrySide(n, 2)), ['inside', 'country'])
  assert.deepStrictEqual(['helper1', 'helper2', 'helper3'].map(n => CO.countrySide(n, 3)), ['inside', 'inside', 'country'])
  assert.strictEqual(CO.countrySide('helper1', 1), 'inside', 'one helper: it stays inside')
  assert.strictEqual(CO.countrySide('keeper', 4), 'inside')
})
await t('the keeper: the inside, the country when it wants siting or the keeper has been away COUNTRY.keeperEveryMs, the country when the inside is quiet', async () => {
  const scenario = M => {
    const L = o => M.groundsLane({ role: 'keeper', now: T0, ...o }).lane
    assert.strictEqual(L({ inside: { open: true }, country: { demand: null } }), 'inside')
    assert.strictEqual(L({ inside: { open: true }, country: { demand: 'site' }, lastCountryAt: T0 - 61 * MIN }), 'country')
    assert.strictEqual(L({ inside: { open: true }, country: { demand: 'site' }, lastCountryAt: T0 - MIN }), 'country', 'the next band sited at once')
    assert.strictEqual(L({ inside: { open: true }, country: { demand: 'open' }, lastCountryAt: T0 - 61 * MIN }), 'country', 'an open band: the keeper\'s hourly turn')
    assert.strictEqual(L({ inside: { open: true }, country: { demand: 'open' }, lastCountryAt: T0 - 10 * MIN }), 'inside', 'bounded: the inside keeps its keeper')
    assert.strictEqual(L({ inside: {}, country: { demand: 'open' }, lastCountryAt: T0 - MIN }), 'country', 'a quiet inside: the country at once')
    assert.strictEqual(M.groundsLane({ on: false, role: 'keeper', inside: {}, country: { demand: 'site' } }).lane, 'inside', 'COUNTRY=off')
  }
  await killedBy(CO_PATH, CO, '    if (!inWork) return { lane: \'country\', why: `inside_quiet:${cDemand}` }\n', '', scenario)
})
await t('a helper: its side while that lane has open work, the other lane\'s open work borrowed, never the country to site it', async () => {
  const scenario = M => {
    const L = (helper, cap, inside, demand) => M.groundsLane({ role: 'helper', helper, cap, inside, country: { demand }, now: T0 }).lane
    assert.strictEqual(L('helper4', 4, { open: true }, 'open'), 'country')
    assert.strictEqual(L('helper1', 4, { open: true }, 'open'), 'inside')
    assert.strictEqual(L('helper1', 4, { open: false }, 'open'), 'country', 'borrowed: the inside has nothing open')
    assert.strictEqual(L('helper4', 4, { open: true }, 'site'), 'inside', 'a band to site is the keeper\'s: the helper works the inside meanwhile')
    assert.strictEqual(L('helper4', 4, { open: true }, null), 'inside', 'a quiet country: borrowed by the inside')
  }
  await killedBy(CO_PATH, CO, '  if (open[other]) return { lane: other, why: `borrow:${other}` }\n', '', scenario)
})

console.log('THE STATE THE ORDERS READ (groundsState) AND THE REFUSAL CHAIN IT COMPOSES')
await t('a quiet inside reads DUE while the country wants siting, OPEN while a band is worked; an inside with work of its own is untouched', () => {
  const quiet = { plot: 'tidy', exists: true, complete: true, damaged: false, due: false }
  assert.deepStrictEqual(CO.groundsState(quiet, 'site'), { ...quiet, due: true, country: 'site' })
  assert.deepStrictEqual(CO.groundsState(quiet, 'open'), { ...quiet, complete: false, country: 'open' })
  assert.strictEqual(CO.groundsState(quiet, null), quiet)
  const open = { plot: 'tidy', exists: true, complete: false }
  assert.strictEqual(CO.groundsState(open, 'site'), open)
  const due = { plot: 'tidy', exists: true, complete: true, damaged: false, due: true }
  assert.strictEqual(CO.groundsState(due, 'open'), due)
})
await t('COMPOSED: a country to site never makes the grounds every bot\'s REPAIR (a damaged tidy would come before every open project)', async () => {
  const scenario = M => {
    const states = [{ plot: 'shop', exists: true, complete: true, damaged: false, due: false }, { plot: 'house1', exists: true, complete: false, free: true },
      M.groundsState({ plot: 'tidy', exists: true, complete: true, damaged: false, due: false }, 'site')]
    const list = [{ plot: 'shop' }, { plot: 'house1' }, { plot: 'tidy' }]
    assert.strictEqual(SHOP.activeProject(states, list).plot, 'house1', 'the open house first: the grounds are an upkeep (`due`), not a repair')
  }
  await killedBy(CO_PATH, CO, "  return { ...st, exists: true, complete: true, damaged: false, due: true, country: demand }\n", "  return { ...st, exists: true, complete: true, damaged: true, due: false, country: demand }\n", scenario)
})

console.log('THE PLANTINGS (countryPlantings): groves and drifts on the band\'s untouched grass')
// a flat grass world: ground y 64 everywhere in +-90, air above; logs where `logs` says; water where `water` says
function world ({ logs = new Set(), water = new Set(), y = 64, R = 90, stone = () => false } = {}) {
  return (x, yy, z) => {
    if (Math.abs(x) > R || Math.abs(z) > R) return null
    const k = `${x},${z}`
    if (water.has(k)) return yy <= y ? { name: 'water', boundingBox: 'empty' } : { name: 'air', boundingBox: 'empty' }
    if (logs.has(k) && yy > y && yy <= y + 5) return { name: 'spruce_log', boundingBox: 'block' }
    if (yy < y) return { name: 'dirt', boundingBox: 'block' }
    if (yy === y) return { name: stone(x, z) ? 'stone' : 'grass_block', boundingBox: 'block' }
    return { name: 'air', boundingBox: 'empty' }
  }
}
const HOME = { x: 0, y: 64, z: 0 }
const band = CO.countryStageOf('c64')
await t('groves of 3-5 saplings COUNTRY.groveGap apart with room above, drifts of one role, all on grass in the band, the species the band grows', () => {
  const logs = new Set(); for (let x = -80; x <= -76; x++) logs.add(`${x},0`)   // a few spruce trunks far off: the band's species
  const read = world({ logs })
  const p = CO.countryPlantings(read, { home: HOME, band, seed: 7 })
  assert.ok(p.census.eligible > 1000, `eligible ${p.census.eligible}`)
  assert.ok(p.census.groves >= 2 && p.census.drifts >= 4, JSON.stringify(p.census))
  const roles = new Set(p.cells.map(c => c.role))
  for (const r of roles) assert.ok(PK.PARK_PLACE_ROLES.has(r), `a park planting role (never a blocker: terraceSkip): ${r}`)
  const groves = p.cells.filter(c => c.plant === 'grove')
  assert.ok(groves.every(c => c.role === 'sapling3'), 'spruce first: the band grows spruce')
  for (const c of p.cells) {
    const d = Math.max(Math.abs(c.at[0]), Math.abs(c.at[2]))
    assert.ok(d > band.rMin && d <= band.rMax, 'in the band')
    assert.strictEqual(c.at[1], 65, 'on the ground')
    assert.strictEqual(read(c.at[0], 64, c.at[2]).name, 'grass_block')
  }
  for (let i = 0; i < groves.length; i++) for (let j = i + 1; j < groves.length; j++) {
    const a = groves[i].at, b = groves[j].at
    assert.ok(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2])) >= CO.COUNTRY.groveGap, 'never two saplings closer than the gap (no 2x2 mega spruce)')
  }
  assert.ok(p.cells.length <= CO.COUNTRY.plantMax)
  assert.ok(p.segments.every(s => /^C-P\d+$/.test(s.seg)) && p.cells.every(c => p.segments.some(s => s.seg === c.seg)))
})
await t('never: inside the wall, on the band\'s earthwork or beside it, on a refusal or a road and their edge, on water\'s edge, by a standing tree', async () => {
  const logs = new Set(['55,0'])
  const water = new Set(); for (let z = -10; z <= 10; z++) water.add(`-56,${z}`)
  const read = world({ logs, water })
  const busy = new Set(); for (let x = -64; x <= 64; x++) for (let z = -64; z <= 64; z += 4) busy.add(`${x},${z}`)   // the earthwork's rows
  const inWall = (x, z) => Math.abs(x) <= 52 && Math.abs(z) <= 20
  const avoid = (x, z) => (x >= 0 && x <= 10 && z >= 50 && z <= 64 ? 'project:hall' : null)
  const corridor = (x, z) => (z === -55 ? 'land:road' : null)
  const scenario = M => {
    const p = M.countryPlantings(read, { home: HOME, band, inWall, busy, avoid, corridor, seed: 3 })
    assert.ok(p.cells.length > 0)
    const near = (c, f, r) => { for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (f(c.at[0] + dx, c.at[2] + dz)) return true; return false }
    for (const c of p.cells) {
      assert.ok(!near(c, inWall, M.COUNTRY.edge), `off the wall boxes ${c.at}`)
      assert.ok(!near(c, (x, z) => busy.has(`${x},${z}`), 1), `off the earthwork ${c.at}`)
      assert.ok(!near(c, avoid, M.COUNTRY.edge) && !near(c, corridor, M.COUNTRY.edge), `off refusals and roads ${c.at}`)
      assert.ok(!near(c, (x, z) => water.has(`${x},${z}`), 1), `not beside water ${c.at}`)
    }
  }
  await killedBy(CO_PATH, CO, "      if (worked(x, z)) { skip('worked'); continue }\n", '', scenario)
})
await t('a grove centre never within COUNTRY.groveLogR of a standing log (groves where the trees are not)', async () => {
  const logs = new Set(); for (let x = -64; x <= 64; x += 4) for (let z = -64; z <= 64; z += 4) if (Math.max(Math.abs(x), Math.abs(z)) > 48) logs.add(`${x},${z}`)
  const scenario = M => {
    const p = M.countryPlantings(world({ logs }), { home: HOME, band, seed: 11 })
    assert.strictEqual(p.census.groves, 0, 'a band full of trees gets no grove')
  }
  await killedBy(CO_PATH, CO, '    if (!far(x, z, C.groveSep) || logNear(x, z, C.groveLogR)) continue\n', '    if (!far(x, z, C.groveSep)) continue\n', scenario)
})
await t('THE SUPPLY CHAIN: a grove or drift cell with nothing in the bag is passed (park.mjs terraceSkip), never a blocker; with a sapling it is placed', () => {
  const read = world()
  const p = CO.countryPlantings(read, { home: HOME, band, seed: 7 })
  const g = p.cells.find(c => c.plant === 'grove'), d = p.cells.find(c => c.plant === 'drift')
  assert.strictEqual(PK.terraceSkip(g, read, { has: () => false }), 'no_trees')
  assert.strictEqual(PK.terraceSkip(d, read, { has: () => false }), 'no_flowers')
  assert.strictEqual(PK.terraceSkip(g, read, { has: n => n === 'spruce_sapling' }), null)
  assert.strictEqual(PK.PARK_PALETTE.sapling3[0], 'spruce_sapling')
  assert.ok(TI.TIDY_PALETTE.sapling3, 'the tidy visit\'s palette knows the grove role')
})
await t('snow: a snow layer is the ground\'s cover (one layer replaceable), never the top that hides the grass; groves on it', async () => {
  const base = world()
  const read = (x, y, z) => (y === 65 ? { name: 'snow', boundingBox: 'block', props: { layers: '1' } } : base(x, y, z))
  const g = CO.groundAt(read, 60, 0, { yHi: 78, yLo: 50 })
  assert.deepStrictEqual([g.y, g.name, g.open], [64, 'grass_block', true])
  const read2 = (x, y, z) => (y === 65 ? { name: 'snow', boundingBox: 'block', props: { layers: '3' } } : base(x, y, z))
  assert.strictEqual(CO.groundAt(read2, 60, 0, { yHi: 78, yLo: 50 }).open, false, 'deep snow: covered')
  // Paper proof 11-09 (sandbox6): groves never sited on a snowy band -- the room above counted the snow layer as a block
  const snowy = (x, y, z) => (y === 65 ? { name: 'snow', boundingBox: 'block', props: { layers: '1' } } : base(x, y, z))
  const scenario = M => assert.ok(M.countryPlantings(snowy, { home: HOME, band, seed: 7 }).census.groves >= 2, 'groves on one-layer snow')
  await killedBy(CO_PATH, CO, " || replaceableCell(b) || (d > 2 && LEAVES.test(n)))) return false }", " || (d > 2 && LEAVES.test(n)))) return false }", scenario)
})

console.log('THE RECORD (countryRecord, countryNothing)')
await t('a band\'s record: the country chain\'s plot and blueprint, its stage, its plantings as their own segments; nothing -> null', () => {
  const plant = { cells: [{ at: [60, 65, 0], role: 'sapling3', seg: 'C-P0', plant: 'grove' }], segments: [{ seg: 'C-P0', deps: [] }], census: { groves: 1 } }
  const earth = { v: 1, cells: [{ at: [50, 64, 1], role: 'earth', seg: 'T-00-0' }], segments: [{ seg: 'T-00-0', deps: [] }], cut: [], clear: [], replant: [], r: 48 }
  const r = CO.countryRecord(earth, plant, { stage: band, home: HOME })
  assert.strictEqual(r.plot, 'country'); assert.strictEqual(r.blueprint, 'country@1'); assert.strictEqual(r.stageId, 'c64')
  assert.strictEqual(r.structure_complete, false); assert.strictEqual(r.builders_max, CO.COUNTRY.builders)
  assert.deepStrictEqual(r.segments.map(s => s.seg), ['T-00-0', 'C-P0'])
  assert.strictEqual(r.cells.length, 2); assert.strictEqual(r.r, 64 + 16)
  assert.strictEqual(CO.countryRecord(null, { cells: [], segments: [] }, { stage: band }), null)
  const n = CO.countryNothing({ stage: band, home: HOME, now: T0 })
  assert.strictEqual(n.structure_complete, true); assert.strictEqual(CO.countryNext(n, T0).id, 'c80')
})

console.log('THE BAND SURVEY KEEPS OFF THE WALL (tidy.mjs siteStage `classic: false`)')
await t('a country band from 0: the strays outside the wall boxes are its work, the ones inside never (the inside chain\'s)', async () => {
  const base = world({ R: 70 })
  const pillars = new Set(['10,10', '40,0'])   // one inside the wall boxes (tidy.mjs inwallBoxes: +-32 here), one outside
  const read = (x, y, z) => (pillars.has(`${x},${z}`) && y >= 65 && y <= 67 ? { name: 'dirt', boundingBox: 'block' } : base(x, y, z))
  const land = { seed: 1, home: HOME, roads: [], corridors: [], zones: [], workR: 80 }
  const wall = { plot: 'wall', box: [-20, -20, 20, 20], cells: [] }
  const st = CO.countryStageOf('c48')
  const scenario = async M => {
    const s = await M.siteStage(read, { home: HOME, land, stage: { ...st, roads: null }, terrace: { wall, records: [], climbs: [] }, classic: false })
    const cols = new Set([...(s.record?.cut ?? []), ...(s.record?.cells ?? [])].map(q => `${q.at[0]},${q.at[2]}`))
    assert.ok(cols.has('40,0'), 'the pillar outside the wall is the band\'s')
    assert.ok(!cols.has('10,10'), 'the pillar inside the wall is never the country\'s')
  }
  await killedBy(new URL('../src/tidy.mjs', import.meta.url), TI, '  const survey = st.rMax > 0 && classic !== false ? surveyTidy(', '  const survey = st.rMax > 0 ? surveyTidy(', scenario)
})

console.log('THE WIRING (skills.mjs: structural invariants only)')
const SK = stripComments(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const visit = SK.slice(SK.indexOf('async function buildTidyVisit ('), SK.indexOf('function farmInputs ('))
await t('the grounds visit names its lane\'s plot on every row (no literal tidy plot left in a row) and takes the country\'s slots', () => {
  assert.ok(visit.length > 10_000, 'the visit body was found')
  assert.strictEqual((visit.match(/project: TIDY_PLOT/g) ?? []).length, 0, 'every _build row of the visit is project: plot')
  assert.ok(/buildBagDetail\(plot,/.test(visit))
  assert.ok(/takeSlot\(dir, key, me, lane === 'country' \? COUNTRY\.builders :/.test(visit))
  assert.ok(/if \(gkw && lane === 'inside' && keeperAfterVisit\(/.test(visit), 'a quiet country never releases a keeper the inside needs')
  assert.ok(/if \(SITEPREP\.on && caps\.site && lane === 'inside'\)/.test(visit))
})
await t('the gathers never pick a country planting: the park gather and the five decor guards read the country record', () => {
  assert.strictEqual((SK.match(/cellGuard\(guardRecsWithCountry\(projectHeads\(\)/g) ?? []).length, 5)
  const gg = SK.slice(SK.indexOf('function gatherGuard ('), SK.indexOf('function gatherGuard (') + 1500)
  assert.ok(/countryHeadNow\(dir\)/.test(gg))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
