// THE TREE FARM ON THE CURRENT FLEET (treefarm-01 revived on 5e663860): every town structure and order that landed after
// 1918bb5, composed with the farm. Behaviour only, through the real functions: the well's and the raised well's site
// search, chest-full's chest site, the town floor's band, the _dig_town instrument, and the REAL CognitiveLoop deciding
// against a fake town whose server is separate from the client (treefarm-fixtures.mjs). Every keep-out is tested from
// BOTH sides, and every refusal as a chain: what the bot does next must be something it can do from where it stands.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Vec3 } from 'vec3'
import { createRequire } from 'node:module'

const LOG_DIR = `/tmp/mcbot-test-logs-treefarm-compose-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LLM_DECISION_COOLDOWN_MS = '20'
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'treefarm-compose-'))
const TF = await import('../src/treefarm.mjs')
const SK = await import('../src/skills.mjs')
const CF = await import('../src/chestfull.mjs')
const DT = await import('../src/digtown.mjs')
const TG = await import('../src/townground.mjs')
const { world, fakeTown, S, K } = await import('./treefarm-fixtures.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 5).join('\n        ')}`)
  }
}
const HOME = { x: 0, y: 64, z: 0 }
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const plotsOf = rec => (rec?.cells ?? []).filter(c => c.role === 'plot')
const homeKey = `${HOME.x}_${HOME.y}_${HOME.z}`
const writeFarm = (dir, rec, gen = 1, worldId = 'w1') => { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, `treefarm-${homeKey}.g${gen}.json`), JSON.stringify({ ...rec, world: worldId, at: new Date().toISOString() })) }
const writeWellSite = (dir, cap, worldId = 'w1') => { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, `junkwell-site-${homeKey}.g1.json`), JSON.stringify({ ...cap, world: worldId, at: new Date().toISOString() })) }
const pool = tag => mkdtempSync(path.join(tmpdir(), `tfc-${tag}-`))
const REG_ID = name => (createRequire(import.meta.url))('minecraft-data')('1.21.8').itemsByName[name].id

// ================================================================ the junk well <-> the farm =================================

await t('WELL -> FARM: a farm founded in a town that has a junk well site keeps every plot FARM_WELL_DISTANCE from its cap', async () => {
  const dir = pool('well-first')
  // the well's site where the farm's own canonical answer would put a plot (positive control: without the well it does)
  const free = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const target = plotsOf(free)[0]
  assert.ok(target, 'the bare world has a farm')
  const cap = { x: target.x, y: 63, z: target.z }
  writeWellSite(dir, cap)
  const { bot } = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  const farm = SK.townFarm(bot)
  assert.ok(farm.record, farm.why)
  const near = plotsOf(farm.record).filter(p => flat(p, cap) < TF.FARM_WELL_DISTANCE)
  assert.deepEqual(near, [], 'no plot near the recorded well')
  assert.ok(TF.torchesOf(farm.record).every(c => flat(c, cap) >= TF.FARM_TORCH_WELL_DISTANCE))
  // AND THE WELL STAYS VALID: the farm's own entries in the well search's avoid list never refuse the cap that was there first
  const avoid = TF.farmWellAvoid(farm.record)
  assert.ok(avoid.length >= TF.MIN_PLOTS)
  assert.equal(avoid.find(a => flat(a, cap) < a.r) ?? null, null, 'neither side can invalidate the other')
})

await t('FARM -> WELL: the well site search (townWellSite, the plinth plans through the same wellAvoid) never picks a cap within FARM_WELL_DISTANCE of a plot', async () => {
  const dir0 = pool('well-ctrl')
  const ctrl = fakeTown({ items: [], storeDir: dir0 })
  const bare = SK.townWellSite(ctrl.bot)
  assert.ok(bare.site, `positive control: a well can be sited in this world (${bare.why})`)
  // a farm whose first plot sits on the cell the well search would pick
  const dir = pool('farm-first')
  const away = v => (v >= 0 ? 4 : -4)   // the bare site is the farm's corner plot nearest home
  const anchor = { x: bare.site.x + away(bare.site.x), y: 64, z: bare.site.z + away(bare.site.z) }
  const fit = TF.fitFarm({ read: world().read, anchor, home: HOME })
  assert.ok(fit.record, fit.why)
  assert.ok(plotsOf(fit.record).some(p => flat(p, bare.site) < TF.FARM_WELL_DISTANCE), 'the farm covers the bare answer')
  writeFarm(dir, fit.record)
  const { bot } = fakeTown({ items: [], storeDir: dir })
  const w = SK.townWellSite(bot)
  assert.ok(w.site, `the well still finds a site (${w.why})`)
  assert.deepEqual(plotsOf(fit.record).filter(p => flat(p, w.site) < TF.FARM_WELL_DISTANCE), [], `cap ${JSON.stringify(w.site)}`)
  // the entry that refuses the bare answer names the farm (wellSiteRefusal prints `${a.what} is within ${r}`)
  assert.match(TF.farmWellAvoid(fit.record).find(a => flat(a, bare.site) < a.r)?.what ?? '', /tree-farm plot/)
})

await t('PRECEDENCE (Codex r1 P2): a well site recorded in a race with the farm stays valid; the FARM yields -- its record is refused and it re-founds away', async () => {
  // the race's outcome on disk: a farm record AND a well site within FARM_WELL_DISTANCE of one of its plots
  const dir = pool('race')
  const farm0 = TF.canonicalFarm({ home: HOME, read: world().read }).record
  writeFarm(dir, farm0)
  const p0 = plotsOf(farm0)[4]
  const cap = { x: p0.x + 2, y: 63, z: p0.z }
  writeWellSite(dir, cap)
  const { bot } = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  // THE WELL: its recorded site is judged without the farm -- it is kept, generation 1, not moved
  const w = SK.townWellSite(bot)
  assert.deepEqual(w.site, cap, `the recorded well stays (${w.why})`); assert.equal(w.gen, 1)
  // THE FARM: the cheap order view schedules a re-founding, and the skill's resolution writes generation 2 away from the well
  const plan = SK.townFarmPlan(bot)
  assert.equal(plan?.actions?.[0]?.role, 'refound', JSON.stringify(plan?.actions))
  const farm = SK.townFarm(bot)
  assert.ok(farm.record, farm.why); assert.equal(farm.gen, 2)
  assert.deepEqual(plotsOf(farm.record).filter(p => flat(p, cap) < TF.FARM_WELL_DISTANCE), [])
  assert.equal(TF.farmYields(farm.record, [{ x: cap.x, z: cap.z, r: TF.FARM_WELL_DISTANCE, what: 'junk_well' }]), null, 'stable: the new farm does not yield again')
  // and the well still stands where it was
  assert.deepEqual(SK.townWellSite(bot).site, cap)
})

await t('CHEST CLAIM IN FLIGHT (Codex r1 P2): a farm founded while a new chest is claimed but not yet placed keeps its distance; a claim that lands after the farm makes the farm yield', async () => {
  const dir = pool('claim')
  const free = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const p0 = plotsOf(free)[0]
  const CFm = await import('../src/chestfull.mjs')
  const key = CFm.townKey(HOME)
  const site = { x: p0.x + 1, y: 64, z: p0.z }
  const c = CFm.claimNewChest({ dir, key, site, world: 'w1' })
  assert.ok(c.ok, c.why)
  const { bot } = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  const farm = SK.townFarm(bot)
  assert.ok(farm.record, farm.why)
  assert.deepEqual(farm.record.cells.filter(q => flat(q, site) <= TF.FARM_CONTAINER_DISTANCE), [], 'no farm cell within 3 of the claimed chest')
  // the reverse order: the farm first, then a claim beside a plot (the chest re-check lost the race) -> the farm yields
  const dir2 = pool('claim2')
  writeFarm(dir2, free)
  assert.ok(CFm.claimNewChest({ dir: dir2, key, site, world: 'w1' }).ok)
  const b2 = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir2 })
  assert.equal(SK.townFarmPlan(b2.bot)?.actions?.[0]?.role, 'refound')
  const moved = SK.townFarm(b2.bot)
  assert.equal(moved.gen, 2); assert.deepEqual(moved.record.cells.filter(q => flat(q, site) <= TF.FARM_CONTAINER_DISTANCE), [])
})

async function wellStandScene (SKmod) {
  // a planted farm; a junk well recorded diagonally off its corner plot (4.24 away: the farm does not yield); that plot
  // emptied (ready to replant); the replanting bot standing just beyond the well, so the NEAREST stand to it is the column
  const dir = pool('wellstand')
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  await SKmod.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const rec = SKmod.knownFarmRecord(a.bot)
  const corner = plotsOf(rec).reduce((m, p) => (p.x + p.z < m.x + m.z ? p : m))
  const cap = { x: corner.x - 3, y: 63, z: corner.z - 3 }
  writeWellSite(dir, cap)
  assert.equal(TF.farmYields(rec, [{ x: cap.x, z: cap.z, r: TF.FARM_WELL_DISTANCE, what: 'junk_well' }]), null, 'the farm does not yield to it')
  a.w.set(corner.x, corner.y, corner.z, 'air')
  const b = fakeTown({ items: [S('birch_sapling', 1)], storeDir: dir, shared: a.w, name: 'b-Stand' })
  b.bot.entity.position = new Vec3(cap.x - 0.5, 64, cap.z - 0.5)
  const goals = []
  b.state.onGoto = g => goals.push({ x: g.x, y: g.y, z: g.z })
  const r = await SKmod.SKILLS.tend_farm.run({ bot: b.bot }, {}, new AbortController().signal)
  const inCol = goals.filter(g => g.x === cap.x && g.z === cap.z)
  return { r, goals, inCol, planted: /_sapling$/.test(a.w.nameAt(corner.x, corner.y, corner.z)) }
}
await t('WELL STAND: a farm visit never walks to a stand in a junk well\'s column (a stand 3 around a plot can be one); it plants from another', async () => {
  const s0 = await wellStandScene(SK)
  assert.deepEqual(s0.inCol, [], JSON.stringify(s0.goals))
  assert.equal(s0.planted, true, s0.r.detail)
})
await t('MUTANT KILLED: without the well-column forbid the same visit walks into the well\'s column', async () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const old = ' || idx.torch.has(`${c.x},${c.y},${c.z}`) || inWell(c)'
  assert.equal(src.split(old).length, 2, 'anchor present and unique')
  const out = new URL(`./_mutant-${process.pid}-ws.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, ' || idx.torch.has(`${c.x},${c.y},${c.z}`)').replace(/from '\.\//g, "from '../src/"))
  try {
    const m = await import(out.href)
    const s1 = await wellStandScene(m)
    assert.ok(s1.inCol.length > 0, `the mutant walks to the column: ${JSON.stringify(s1.goals)}`)
  } finally { try { (await import('node:fs')).unlinkSync(out) } catch {} }
})

await t('farmYields: a chest chest-full may place never moves the farm (one rule both sides); a torch keeps FARM_TORCH_WELL_DISTANCE from a well', () => {
  const rec = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const idx = TF.farmIndex(rec), p = plotsOf(rec).reduce((m, q) => (q.x + q.z < m.x + m.z ? q : m))   // a corner plot
  // chest-full's boundary cell: (3,1) outward off the corner plot is 3.16 away -- allowed there, so the farm must not yield
  const legal = { x: p.x - 3, y: p.y, z: p.z - 1 }
  assert.equal(TF.farmChestRefusal(idx, legal), null, 'positive control: chest-full allows it')
  assert.equal(TF.farmYields(rec, [{ ...legal, r: 3.5, what: 'chest_claim' }]), null)
  const illegal = { x: p.x - 2, y: p.y, z: p.z }
  assert.ok(TF.farmChestRefusal(idx, illegal))
  assert.match(TF.farmYields(rec, [{ ...illegal, r: 3.5, what: 'chest_claim' }]) ?? '', /chest claim/)
  // a chest in a cellar far under a plot: chest-full allows it (outside the column's span), so no yield
  const cellar = { x: p.x, y: p.y - 6, z: p.z }
  assert.equal(TF.farmChestRefusal(idx, cellar), null); assert.equal(TF.farmYields(rec, [{ ...cellar, r: 3.5, what: 'chest_claim' }]), null)
  // a well 2..4 from a torch and >= 4 from every plot: the well's search allows it (torch 2), so the farm does not yield.
  // Such a torch is at the grid's EDGE, which happens when plots were refused at founding: drop one column of plots.
  const maxX = Math.max(...plotsOf(rec).map(q => q.x))
  const rec6 = { ...rec, cells: rec.cells.filter(c => !(c.role === 'plot' && c.x === maxX)) }
  const cands = []
  for (const t0 of TF.torchesOf(rec6)) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    const q = { x: t0.x + dx, z: t0.z + dz }
    const dT = Math.hypot(dx, dz)
    if (dT >= 2 && dT < 4 && plotsOf(rec6).every(pp => flat(pp, q) >= TF.FARM_WELL_DISTANCE) && TF.torchesOf(rec6).every(tt => flat(tt, q) >= 2)) cands.push(q)
  }
  assert.ok(cands.length > 0, 'the edge torch has well cells the well\'s search allows within 4 of it')
  for (const q of cands) assert.equal(TF.farmYields(rec6, [{ ...q, r: TF.FARM_WELL_DISTANCE, what: 'junk_well' }]), null, `well at ${q.x},${q.z}`)
})

await t('MID-VISIT YIELD (Claude r2 P3): a well site recorded during the founding visit stops it before its next placement; nothing is planted in the keep-out', async () => {
  const dir = pool('midvisit')
  const free = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const last = plotsOf(free).at(-1)
  const cap = { x: last.x + 2, y: 63, z: last.z }   // 2 from the last plot: inside its keep-out
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  let placed = 0
  a.state.onPlace = () => { if (++placed === 2) writeWellSite(dir, cap) }
  const r = await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  assert.ok(placed >= 2 && placed < plotsOf(free).length, `stopped mid-visit after ${placed} placements: ${r.detail}`)
  assert.match(r.detail, /stopped: farm must yield/)
  assert.equal(/_sapling$/.test(a.w.nameAt(last.x, last.y, last.z)), false, 'the plot beside the new well was not planted')
  // positive control: without the mid-visit record every plot is planted
  const b = fakeTown({ items: [S('birch_sapling', 9)], storeDir: pool('midvisit-ctrl') })
  await SK.SKILLS.tend_farm.run({ bot: b.bot }, {}, new AbortController().signal)
  assert.equal(plotsOf(free).filter(p => /_sapling$/.test(b.w.nameAt(p.x, p.y, p.z))).length, plotsOf(free).length)
})

await t('MID-WALK YIELD (Codex r4 P2): a well site recorded while the bot walks to a plot stops the visit before that plot is planted', async () => {
  const dir = pool('midwalk')
  const free = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  let walks = 0, target = null
  a.state.onGoto = goal => { if (++walks === 3) { target = goal; writeWellSite(dir, { x: goal.x + 1, y: 63, z: goal.z }) } }
  const r = await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  assert.ok(target, 'a third walk happened')
  assert.match(r.detail, /farm must yield/, r.detail)
  const planted = plotsOf(free).filter(p => /_sapling$/.test(a.w.nameAt(p.x, p.y, p.z)))
  assert.deepEqual(planted.filter(p => flat(p, { x: target.x + 1, z: target.z }) < TF.FARM_WELL_DISTANCE), [], 'nothing planted inside the keep-out of the well recorded during the walk')
})

await t('MID-LOOK YIELD (Codex r5 P2): a well site recorded during the look before a placement stops the visit before that click', async () => {
  const dir = pool('midlook')
  const free = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  let looks = 0, at = null
  a.state.onLook = p => { if (++looks === 3) { at = { x: Math.floor(p.x), z: Math.floor(p.z) }; writeWellSite(dir, { x: at.x + 1, y: 63, z: at.z }) } }
  const r = await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  assert.ok(at, 'a third look happened')
  assert.match(r.detail, /farm must yield/, r.detail)
  const planted = plotsOf(free).filter(p => /_sapling$/.test(a.w.nameAt(p.x, p.y, p.z)))
  assert.equal(planted.length, 2, `exactly the two placements before the look: ${planted.length}`)
})

await t('PLINTH CELL (Claude r2 P3): a recorded farm yields to a raised-well plan cell only when it lands ON a farm cell (the planner\'s own exact rule)', () => {
  const rec = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const p = plotsOf(rec)[0]
  assert.equal(TF.farmYields(rec, [{ x: p.x + 1, y: p.y, z: p.z, r: 2, what: 'plinth_cell' }]), null, 'beside a plot: legal for the planner, no yield')
  assert.match(TF.farmYields(rec, [{ x: p.x, y: p.y + 2, z: p.z, r: 2, what: 'plinth_cell' }]) ?? '', /tree-farm cell/, 'in a plot column: yield')
  assert.match(TF.farmYields(rec, [{ x: p.x, y: p.y - 2, z: p.z, r: 2, what: 'plinth_cell' }]) ?? '', /tree-farm cell/, 'a stand whose head is the soil cell: yield')
})

await t('PLINTH -> FARM: a raised-well plan on disk (plinth-01) keeps the farm off its cap and every planned cell and stand', async () => {
  const dir = pool('plinth')
  const free = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const target = plotsOf(free)[1]
  const cap = { x: target.x, y: 66, z: target.z }
  const steps = [{ op: 'place', c: [cap.x + 2, 64, cap.z], s: [cap.x + 3, 64, cap.z] }, { op: 'place', c: [cap.x - 2, 64, cap.z + 2], s: [cap.x - 3, 64, cap.z + 3] }]
  writeFileSync(path.join(dir, `junkwell-plinth-${homeKey}.json`), JSON.stringify({ v: 1, state: 'plan', world: 'w1', plan: { cap, steps } }))
  const { bot } = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  const farm = SK.townFarm(bot)
  assert.ok(farm.record, farm.why)
  const cells = farm.record.cells
  assert.deepEqual(cells.filter(c => c.role === 'plot' && flat(c, cap) < TF.FARM_WELL_DISTANCE), [])
  for (const st of steps) for (const q of [st.c, st.s]) assert.deepEqual(cells.filter(c => flat(c, { x: q[0], z: q[2] }) < TF.FARM_TORCH_WELL_DISTANCE), [], `planned cell ${q}`)
  // a plinth record of ANOTHER world (a reseed) keeps nothing out
  const dir2 = pool('plinth-other')
  writeFileSync(path.join(dir2, `junkwell-plinth-${homeKey}.json`), JSON.stringify({ v: 1, state: 'plan', world: 'w-old', plan: { cap, steps } }))
  const other = SK.townFarm(fakeTown({ items: [], storeDir: dir2 }).bot)
  assert.deepEqual(other.record.cells, free.cells, 'another world\'s plinth plan is not this town\'s')
})

await t('farmKeepOut: every soil, column and torch cell, exactly (the keep-out a plinth or floor planner takes)', () => {
  const rec = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const ko = TF.farmKeepOut(rec), idx = TF.farmIndex(rec)
  const plots = plotsOf(rec), torches = TF.torchesOf(rec)
  assert.equal(ko.length, plots.length * (TF.CLEAR_ABOVE + 2) + torches.length * 2)
  for (const c of ko) assert.ok(TF.farmPlaceRefusal(idx, c.x, c.y, c.z, 'cobblestone'), `a cobble in ${c.x},${c.y},${c.z} is refused by the farm's own rule`)
  assert.ok(ko.every(c => c.r === 0))
})

// ================================================================ the town floor's band ======================================

await t('FLOOR: the farm never plants in the town floor\'s band (a dug-out pit inside Chebyshev 16, at or below home.y-2)', async () => {
  // the whole town square dug down to y 59 (soil top), so a plot cell would be at 60 <= L = 62; outside the square, grass at 63
  const over = {}
  const inSq = (x, z) => Math.max(Math.abs(x), Math.abs(z)) <= 16
  const base = world()
  const pit = {
    read: (x, y, z) => {
      if (inSq(x, z) && y >= 60 && y <= 63) return { name: 'air', boundingBox: 'empty' }
      if (inSq(x, z) && y === 59) return { name: 'grass_block', boundingBox: 'block' }
      return base.read(x, y, z)
    },
  }
  void over
  const unguarded = TF.canonicalFarm({ home: HOME, read: pit.read }).record
  assert.ok(unguarded && plotsOf(unguarded).some(p => TF.inFloorBand(HOME, p)), 'positive control: without the guard the farm goes into the pit')
  const guarded = TF.canonicalFarm({ home: HOME, read: pit.read, reserved: c => TF.inFloorBand(HOME, c) }).record
  assert.ok(guarded, 'a farm still fits outside the band')
  assert.deepEqual(guarded.cells.filter(c => TF.inFloorBand(HOME, c)), [])
  assert.equal(TF.inFloorBand(HOME, { x: 16, y: 62, z: 0 }), true); assert.equal(TF.inFloorBand(HOME, { x: 17, y: 62, z: 0 }), false)
  assert.equal(TF.inFloorBand(HOME, { x: 0, y: 63, z: 0 }), false, 'above L the floor fills nothing'); assert.equal(TF.inFloorBand(HOME, { x: 0, y: 51, z: 0 }), false, 'below the band')
})

// ================================================================ chest-full's new chest =====================================

await t('CHEST: a new chest never goes in a farm cell nor within FARM_CONTAINER_DISTANCE of a plot; the search finds a cell beyond it', async () => {
  const rec = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const idx = TF.farmIndex(rec)
  const p = plotsOf(rec).filter(q => flat(q, HOME) <= 13).sort((a, b) => flat(a, HOME) - flat(b, HOME))[0]
  assert.ok(p, 'a plot inside town storage reach (the chest search\'s own bound)')
  const read = world().read
  assert.match(CF.chestSiteRefusal(read, { x: p.x, y: p.y, z: p.z }, { home: HOME, farm: idx }) ?? '', /tree-farm/)
  assert.match(CF.chestSiteRefusal(read, { x: p.x + 2, y: p.y, z: p.z }, { home: HOME, farm: idx }) ?? '', /within 3 of a tree-farm plot/)
  assert.equal(CF.chestSiteRefusal(read, { x: p.x + 2, y: p.y, z: p.z }, { home: HOME }), null, 'positive control: without the farm that cell is a chest site')
  // the pick from an anchor beside the farm lands outside it
  const pick = CF.pickChestSite({ read, anchor: { x: p.x + 1, y: p.y, z: p.z }, home: HOME, farm: idx })
  assert.ok(pick.site, pick.why)
  assert.equal(TF.farmChestRefusal(idx, pick.site), null)
  // A FARM COVERING THE RINGS around the full chest widens the search (as the well's does): the pick from inside the farm,
  // limited to the rings the farm covers, finds nothing -- and its refusals are the kind that widen
  const boxed = CF.pickChestSite({ read, anchor: { x: p.x, y: p.y, z: p.z }, home: HOME, farm: idx, rings: 2 })
  assert.equal(boxed.site, null, 'positive control: every ring cell is refused by the farm')
  assert.equal(CF.widensChestSearch(boxed.refused), true, JSON.stringify(boxed.refused))
  assert.equal(CF.widensChestSearch({ 'outside town': 3 }), false, 'an ordinary refusal does not widen')
})

// ================================================================ the _dig_town instrument ===================================

await t('DIGTOWN: the farm\'s leftover-log dig is a TARGET dig by tend_farm, class free (a log is never town ground); farm soil IS ground', async () => {
  const storeDir = pool('dig')
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const rec = SK.knownFarmRecord(a.bot)
  const p = plotsOf(rec)[2]
  a.w.set(p.x, p.y, p.z, 'air'); a.w.set(p.x, p.y + 3, p.z, 'birch_log')   // a harvested plot with a floating log
  const b = fakeTown({ items: [S('stone_axe', 1)], storeDir, shared: a.w, name: 'b-Dig' })
  const sums = []
  const dt = DT.attachDigTown(b.bot, { home: HOME, context: () => ({ skill: 'tend_farm' }), emitDig: () => {}, emitSummary: s => sums.push(s), timers: false, graceMs: 50 })
  assert.ok(dt, 'the instrument wrapped bot.dig')
  const r = await SK.SKILLS.tend_farm.run({ bot: b.bot }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', r.detail)
  await new Promise(res => setTimeout(res, 120))
  dt.final()
  const keys = sums.flatMap(s => Object.keys(s.args)).filter(k => k.startsWith('z_'))
  assert.ok(keys.includes('z_zone_free_target_confirmed'), `the clear is counted as a target dig of a free cell: ${keys}`)
  assert.equal(TG.townDigClass({ x: p.x, y: p.y - 1, z: p.z }, 'grass_block', HOME), 'ground', 'farm soil inside the square is town ground (the zone keeps it too)')
})

// ================================================================ the REAL decision loop =====================================

const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const ldir = mkdtempSync(path.join(tmpdir(), 'tfc-lessons-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const loopReady = bot => Object.assign(bot, {
  health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
  recipesFor: () => [], recipesAll: () => [], findBlock: () => null, findBlocks: () => [], experience: { level: 0 },
})
/** n dispatches through the REAL loop. tend_farm RUNS (the real skill against the fake town); everything else is recorded
 *  and succeeds with no change (so the farm order must win on its own merits, not because the others failed). */
async function decisions (bot, n, { propose = 'status', state = null, max = 200, handlers = {} } = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (handlers[skill]) {
      const r = await handlers[skill](args ?? {})
      ran.push({ skill, args, status: r.status, detail: r.detail })
      return { delta: {}, contractEvidence: r.status === 'success' ? [`${skill}: probe 1`] : [], ...r }
    }
    if (skill === 'tend_farm') {
      const r = await SK.SKILLS.tend_farm.run({ bot }, args ?? {}, new AbortController().signal)
      ran.push({ skill, status: r.status, detail: r.detail })
      return { ...r, delta: {}, contractEvidence: r.status === 'success' ? ['world_change: farm'] : [] }
    }
    ran.push({ skill, status: 'success' })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: propose, args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  if (state) Object.assign(loop, state)
  loop.start()
  for (let i = 0; i < max && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return { ran, loop }
}

await t('LOOP CHAIN: a bot at town holding saplings founds the farm through the real loop; the next decisions are the model\'s (one visit, then the cooldown -- never a loop)', async () => {
  const storeDir = pool('loop-found')
  const { bot, w } = fakeTown({ items: [S('birch_sapling', 6), S('oak_sapling', 4)], storeDir })
  loopReady(bot)
  const { ran } = await decisions(bot, 4)
  assert.equal(ran[0]?.skill, 'tend_farm', JSON.stringify(ran))
  assert.equal(ran[0].status, 'success', ran[0].detail)
  assert.equal(ran.filter(r => r.skill === 'tend_farm').length, 1, `one farm visit in ${ran.length} decisions: ${ran.map(r => r.skill)}`)
  const rec = SK.knownFarmRecord(bot)
  assert.ok(rec)
  assert.equal(plotsOf(rec).filter(p => /_sapling$/.test(w.nameAt(p.x, p.y, p.z))).length, Math.min(10, plotsOf(rec).length), 'planted from the bag')
})

await t('LOOP CHAIN (the refusal): a farm with ready plots and a bag with no saplings -> never a tend_farm order; the model decides; the remedy it would be told is a gather (executable at town)', async () => {
  const storeDir = pool('loop-nosap')
  const a = fakeTown({ items: [S('birch_sapling', 6)], storeDir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const b = fakeTown({ items: [S('stick', 3)], storeDir, shared: a.w, name: 'b-NoSap' })
  loopReady(b.bot)
  const { ran } = await decisions(b.bot, 4)
  assert.ok(ran.length >= 4, 'the loop kept deciding')
  assert.equal(ran.filter(r => r.skill === 'tend_farm').length, 0, ran.map(r => r.skill).join(','))
  const skip = await SK.SKILLS.tend_farm.run({ bot: b.bot }, {}, new AbortController().signal)
  assert.match(skip.detail, /gather birch_log or oak_log/)
})

await t('LOOP CHAIN (another builder): a lease held by another bot -> the visit skips for free; no backoff, the model decides next, no second visit inside the cooldown', async () => {
  const storeDir = pool('loop-lease')
  const BPm = await import('../src/blueprint.mjs')
  const lease = BPm.takeLease(storeDir, `treefarm-${homeKey}`, 'b-Other')
  assert.ok(lease.ok)
  const { bot } = fakeTown({ items: [S('birch_sapling', 9)], storeDir })
  loopReady(bot)
  const { ran, loop } = await decisions(bot, 4)
  const tends = ran.filter(r => r.skill === 'tend_farm')
  assert.equal(tends.length, 1, ran.map(r => r.skill).join(','))
  assert.equal(tends[0].status, 'no_effect'); assert.match(tends[0].detail, /another bot \(b-Other\)/)
  assert.ok(!(loop.farmState?.backoffUntil > Date.now()), 'a held lease is not a fault')
  assert.ok(ran.slice(1).every(r => r.skill !== 'tend_farm'))
})

await t('LOOP CHAIN (bone meal OFF by default): a planted farm and a bag of 40 bone meal -> never a tend_farm order through the real loop', async () => {
  const storeDir = pool('loop-bmoff')
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const b = fakeTown({ items: [S('bone_meal', 40)], storeDir, shared: a.w, name: 'b-BmOff' })
  loopReady(b.bot)
  const r = await decisions(b.bot, 3)
  assert.ok(r.ran.length >= 3)
  assert.equal(r.ran.filter(x => x.skill === 'tend_farm').length, 0, r.ran.map(x => x.skill).join(','))
  assert.equal((b.state.bonemealed ?? []).length, 0)
  // positive control (Claude r7 P3): the same bag with the arm ON gets the farm order through the same loop
  process.env.TREEFARM_BONEMEAL = 'on'
  try {
    const c = fakeTown({ items: [S('bone_meal', 40)], storeDir, shared: a.w, name: 'b-BmOn' })
    loopReady(c.bot)
    const r2 = await decisions(c.bot, 2)
    assert.equal(r2.ran[0]?.skill, 'tend_farm', r2.ran.map(x => x.skill).join(','))
  } finally { delete process.env.TREEFARM_BONEMEAL }
})

await t('LOOP CHAIN (bone meal arm ON, at the reserve): a planted farm and a bag of exactly BONEMEAL_RESERVE bone meal -> no order; above it -> one visit spends only the surplus', async () => {
  process.env.TREEFARM_BONEMEAL = 'on'
  try {
  const storeDir = pool('loop-bm')
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const b = fakeTown({ items: [S('bone_meal', TF.BONEMEAL_RESERVE)], storeDir, shared: a.w, name: 'b-Res' })
  loopReady(b.bot)
  const r1 = await decisions(b.bot, 3)
  assert.equal(r1.ran.filter(r => r.skill === 'tend_farm').length, 0, r1.ran.map(r => r.skill).join(','))
  const c = fakeTown({ items: [S('bone_meal', TF.BONEMEAL_RESERVE + 3)], storeDir, shared: a.w, name: 'b-Sur' })
  loopReady(c.bot)
  const r2 = await decisions(c.bot, 3)
  assert.equal(r2.ran[0]?.skill, 'tend_farm', r2.ran.map(r => r.skill).join(','))
  assert.equal(c.bot.inventory.items().filter(i => i.name === 'bone_meal').reduce((n, i) => n + i.count, 0), TF.BONEMEAL_RESERVE, 'the reserve stays in the bag')
  assert.equal((c.state.bonemealed ?? []).length, 3)
  } finally { delete process.env.TREEFARM_BONEMEAL }
})

await t('LOOP CHAIN (the town orders first): at 34+ slots with a farm to found, the deterministic orders ahead of the farm keep their turn, and the farm order still comes (not starved)', async () => {
  const storeDir = pool('loop-full')
  const junk = ['andesite', 'diorite', 'granite', 'dirt', 'cobblestone', 'gravel', 'sand', 'stick', 'flint', 'string', 'bone', 'feather', 'leather', 'wheat_seeds',
    'poppy', 'dandelion', 'clay_ball', 'coal', 'raw_iron', 'raw_copper', 'iron_ingot', 'copper_ingot', 'gold_ingot', 'redstone', 'lapis_lazuli', 'quartz', 'egg', 'arrow',
    'paper', 'book', 'glass', 'torch']
  // ...and a spent axe (exactly 1 use left): wear_out is ranked AHEAD of the farm, so it must run first
  const spentAxe = { name: 'stone_axe', count: 1, maxDurability: 131, durabilityUsed: 130 }
  const items = [S('birch_sapling', 20), S('oak_sapling', 20), spentAxe, ...junk.map(n => S(n, 5))]
  assert.ok(items.length >= 34)
  const { bot } = fakeTown({ items, storeDir })
  loopReady(bot)
  const { ran } = await decisions(bot, 8, { max: 300 })
  if (process.env.TFC_DEBUG) console.log("FULLBAG", ran.map(r => r.skill).join(","))
  const iFarm = ran.findIndex(r => r.skill === 'tend_farm')
  assert.ok(iFarm >= 0, `the farm order came: ${ran.map(r => r.skill)}`)
  const order = ['town_deposit', 'count_town', 'wear_out', 'compost', 'build_composter', 'withdraw_pick', 'dispose_well', 'build_well', 'close_well', 'prune_town']
  // whatever ran before the farm is one of the orders ranked ahead of it (or the model, which only runs when no order does)
  assert.ok(iFarm >= 1 && ran[0].skill === 'wear_out', `the order ranked ahead (wear_out) ran first: ${ran.map(r => r.skill)}`)
  for (const r of ran.slice(0, iFarm)) assert.ok(order.includes(r.skill), `ran before the farm: ${r.skill}`)
  assert.equal(ran[iFarm].status, 'success', ran[iFarm].detail)
})

// ================================================================ wiring with mutants ========================================

// ================================================================ the farm's torches vs kitshrink-01 ==========================
// kitshrink-01 banks torches at the town deposit; the farm places only torches the bag carries. So the farm FETCHES them back:
// a deterministic `withdraw torch <shortfall>` at town when its torch cells are unlit (treefarm.mjs farmTorchOrder).

await t('TORCH FETCH (pure): at town and its level only, the exact shortfall, a cooldown charged when issued, the scan throttled; the town having none backs off for hours', () => {
  let calls = 0
  const need = () => { calls++; return 4 }
  const base = { now: 1e7, distHome: 5, dy: 0, need, held: 0 }
  const r = TF.farmTorchOrder(base)
  assert.deepEqual(r.order.args, { item: 'torch', count: 4, town: true }); assert.equal(r.order.skill, 'withdraw'); assert.equal(calls, 1)
  assert.equal(TF.farmTorchOrder({ ...base, held: 1, state: {} }).order.args.count, 3, 'only the shortfall')
  assert.equal(TF.farmTorchOrder({ ...base, held: 4, state: {} }).order, null, 'nothing short')
  assert.equal(TF.farmTorchOrder({ ...base, distHome: 60 }).order, null, 'never a trip from outside town')
  assert.equal(TF.farmTorchOrder({ ...base, dy: -30 }).order, null, 'never from a cave under town')
  assert.equal(TF.farmTorchOrder({ ...base, enabled: false }).order, null)
  calls = 0
  assert.equal(TF.farmTorchOrder({ ...base, state: r.state, now: 1e7 + 60_000 }).order, null, 'the cooldown, charged when issued')
  assert.equal(calls, 0, 'no world read inside the cooldown')
  const scanned = TF.farmTorchOrder({ ...base, need: () => 0 })
  assert.equal(TF.farmTorchOrder({ ...base, state: scanned.state, now: 1e7 + 1000 }).order, null, 'the scan is throttled (FARM_SCAN_MS)')
  // "none in the three containers tried" is a SAMPLE: the backoff doubles (10, 20, 40 ... min, capped at 2 h); no chest at all: 2 h
  let st = r.state
  const waits = []
  for (let k = 0; k < 6; k++) { st = TF.farmTorchOutcome('failed', 'container_short', 2e7, st); waits.push((st.backoffUntil - 2e7) / 60000) }
  assert.deepEqual(waits, [10, 20, 40, 80, 120, 120])
  assert.equal(TF.farmTorchOutcome('failed', 'nothing_found', 2e7, r.state).backoffUntil, 2e7 + TF.TORCH_FETCH_BACKOFF_MS)
  assert.equal(TF.farmTorchOutcome('success', null, 3e7, st).misses, 0, 'a success resets the doubling')
  // the farm's own backoff (no visit could place them), a full bag, a withdraw the gate's memory would refuse: no fetch
  assert.equal(TF.farmTorchOrder({ ...base, farmBackoffUntil: 1e7 + 1 }).order, null)
  assert.equal(TF.farmTorchOrder({ ...base, room: () => false }).order, null)
  let asked = null
  assert.equal(TF.farmTorchOrder({ ...base, refused: a => { asked = a; return 'cooldown' } }).order, null)
  assert.deepEqual(asked, { item: 'torch', count: 4, town: true }, 'the gate memory is asked with the args the order would carry')
  assert.deepEqual(TF.farmTorchOutcome('failed', 'runner_busy', 2e7, r.state, new Set(['runner_busy'])), r.state, 'a runner refusal costs nothing')
})

await t('LOOP CHAIN (kitshrink x farm): a farm planted without torches (the founder held none) -> the real loop fetches the shortfall from the town chests, then the next visit lights every torch cell', async () => {
  const storeDir = pool('torch-fetch')
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const rec = SK.knownFarmRecord(a.bot), torches = TF.torchesOf(rec)
  assert.equal(torches.filter(c => a.w.nameAt(c.x, c.y, c.z) === 'torch').length, 0, 'positive control: the farm is unlit')
  assert.equal(SK.farmTorchNeed(a.bot), torches.length)
  const b = fakeTown({ items: [S('stick', 2)], storeDir, shared: a.w, name: 'b-Torch' })
  loopReady(b.bot)
  // the WITHDRAW, as the server would give it: the torches land in the bag (withdrawVisit holds them back from the deposit)
  const withdraw = async args => {
    const slot = b.slots.findIndex((x, i) => i >= 9 && i < 45 && i !== 36 && !x)
    b.slots[slot] = { name: 'torch', count: args.count, type: REG_ID('torch'), slot }
    return { status: 'success', detail: `took ${args.count} torch` }
  }
  const { ran } = await decisions(b.bot, 2, { handlers: { withdraw }, max: 400, state: { farmState: { lastTendAt: -Infinity } } })
  assert.equal(ran[0]?.skill, 'withdraw', JSON.stringify(ran)); assert.deepEqual(ran[0].args, { item: 'torch', count: torches.length, town: true })
  // THROUGH THE LOOP (Claude r13 P3-5): the fetch lets the farm order scan again at once, so the next decision is the visit
  assert.equal(ran[1]?.skill, 'tend_farm', `the next decision is the visit that places them: ${ran.map(x => x.skill)}`)
  assert.equal(ran[1].status, 'success', ran[1].detail)
  assert.equal(torches.filter(c => a.w.nameAt(c.x, c.y, c.z) === 'torch').length, torches.length, 'every torch cell lit')
  assert.equal(SK.farmTorchNeed(b.bot), 0, 'and no more fetches are needed')
})

await t('LOOP CHAIN: a lit farm, or a bag already holding the torches -> no fetch (positive and negative controls through the real loop)', async () => {
  const storeDir = pool('torch-lit')
  const a = fakeTown({ items: [S('birch_sapling', 9), S('torch', 4)], storeDir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  assert.equal(SK.farmTorchNeed(a.bot), 0, 'lit by the founder')
  const b = fakeTown({ items: [S('stick', 2)], storeDir, shared: a.w, name: 'b-Lit' })
  loopReady(b.bot)
  const { ran } = await decisions(b.bot, 3, { handlers: { withdraw: async () => ({ status: 'success', detail: 'x' }) } })
  assert.equal(ran.filter(x => x.skill === 'withdraw').length, 0, ran.map(x => x.skill).join(','))
})

await t('LOOP CHAIN: the three containers tried hold no torch -> ONE fetch fails, then a (doubling) backoff: no fetch loop', async () => {
  const storeDir = pool('torch-none')
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const b = fakeTown({ items: [S('stick', 2)], storeDir, shared: a.w, name: 'b-None' })
  loopReady(b.bot)
  const { ran, loop } = await decisions(b.bot, 5, { handlers: { withdraw: async () => ({ status: 'failed', failClass: 'container_short', detail: 'torch is not in the 1 container(s) tried here' }) },
    state: { farmState: { lastTendAt: Date.now() } } })
  assert.equal(ran.filter(x => x.skill === 'withdraw').length, 1, ran.map(x => x.skill).join(','))
  assert.ok(loop.farmTorchState.backoffUntil > Date.now() + 9 * 60 * 1000, 'the first backoff (10 min, doubling after) is set')
  assert.equal(loop.farmTorchState.misses, 1)
})

await t('NO FETCH FOR A FARM NO VISIT WILL TEND (Claude r13 P2-1): a record that must yield (a well recorded in its keep-out) -> need 0 and no fetch through the real loop; the same farm tended -> the fetch (positive control)', async () => {
  const dir = pool('torch-yield')
  const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
  await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
  const rec = SK.knownFarmRecord(a.bot)
  assert.ok(SK.farmTorchNeed(a.bot) > 0, 'positive control: the unlit farm needs torches')
  const p0 = plotsOf(rec)[4]
  writeWellSite(dir, { x: p0.x + 2, y: 63, z: p0.z })   // the farm must yield to this well now
  const b = fakeTown({ items: [S('stick', 2)], storeDir: dir, shared: a.w, name: 'b-Yield' })
  assert.equal(SK.farmTorchNeed(b.bot), 0, 'a yielding record: nothing to light')
  assert.equal(SK.townFarmPlan(b.bot), null, 'and indeed no visit would come (no saplings to re-found)')
  loopReady(b.bot)
  const { ran } = await decisions(b.bot, 3, { handlers: { withdraw: async () => ({ status: 'success', detail: 'x' }) } })
  assert.equal(ran.filter(x => x.skill === 'withdraw').length, 0, ran.map(x => x.skill).join(','))
})

await t('THE HYBRID (Claude r13 P3-4): the town deposit KEEPS the torches the farm\'s unlit cells need (farm_torches); a lit farm keeps none (positive control)', async () => {
  const BK = await import('../src/bankable.mjs')
  const items = [{ name: 'torch', count: 6 }, { name: 'cobblestone', count: 64 }]
  BK.clearWithdrawHolds()
  try {
    BK.setKitKeepReader(() => ({ torch: 4 }))
    const inv = BK.bankableInventory(items)
    assert.equal(inv.detail.torch, 2, 'only the torches above the farm\'s need are banked')
    BK.setKitKeepReader(() => ({ torch: 8 }))
    assert.equal(BK.bankableInventory(items).excluded.torch, 'farm_torches')
    BK.setKitKeepReader(() => ({ torch: 0 }))
    assert.equal(BK.bankableInventory(items).detail.torch, 6, 'a lit farm keeps none: the kit rule banks them all')
    // the installed reader asks the farm (the real farmTorchNeed) for this bot
    const dir = pool('keep')
    const a = fakeTown({ items: [S('birch_sapling', 9)], storeDir: dir })
    await SK.SKILLS.tend_farm.run({ bot: a.bot }, {}, new AbortController().signal)
    SK.installFarmKitKeep(a.bot)
    assert.equal(BK.kitKeepView().torch, TF.torchesOf(SK.knownFarmRecord(a.bot)).length)
    assert.equal(BK.bankableInventory(items).detail.torch, 6 - TF.torchesOf(SK.knownFarmRecord(a.bot)).length)
  } finally { BK.setKitKeepReader(null) }
})

await t('KITSHRINK COMPOSITION: torches the fetch took are held back from the next town deposit (the withdraw hold); without the hold the kit rule banks them (positive control)', async () => {
  const BK = await import('../src/bankable.mjs')
  const items = [{ name: 'torch', count: 4 }, { name: 'cobblestone', count: 64 }]
  BK.clearWithdrawHolds()
  assert.equal(BK.bankableInventory(items).detail.torch, 4, 'positive control: the kit rule banks loose torches')
  BK.setWithdrawHold('torch', 4, Date.now() + 60_000)
  try {
    const inv = BK.bankableInventory(items)
    assert.equal(inv.detail.torch ?? 0, 0); assert.equal(inv.excluded.torch, 'withdraw_hold')
  } finally { BK.clearWithdrawHolds() }
})

await t('LIDCLEAR COMPOSITION: no farm cell can be a chest\'s lid -- a chest under any plot column, soil or torch cell is refused by the farm\'s rule (so lidclear never digs a farm cell); a chest 4 off a plot is fine (positive control)', () => {
  const rec = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const idx = TF.farmIndex(rec)
  const cells = []
  for (const c of rec.cells) {
    if (c.role === 'plot') for (let y = c.y - 1; y <= c.y + TF.CLEAR_ABOVE; y++) cells.push({ x: c.x, y, z: c.z })
    else cells.push({ x: c.x, y: c.y, z: c.z }, { x: c.x, y: c.y - 1, z: c.z })
  }
  for (const lid of cells) assert.ok(TF.farmChestRefusal(idx, { x: lid.x, y: lid.y - 1, z: lid.z }), `a chest under ${lid.x},${lid.y},${lid.z} would have a farm cell as its lid`)
  const p = plotsOf(rec).reduce((m, q) => (q.x + q.z < m.x + m.z ? q : m))
  assert.equal(TF.farmChestRefusal(idx, { x: p.x - 4, y: p.y, z: p.z }), null)
})

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const wired = src => {
  const s = strip(src)
  assert.equal((s.match(/pickChestSite\(\{[^}]*\bfarm\b[^}]*\}\)/g) ?? []).length, 2, 'both pickChestSite calls pass the farm')
  assert.ok(/chestSiteRefusal\(read, pick\.site, \{[^}]*farm: chestFarmIndex\(bot\)[^}]*\}\)/.test(s), 'the re-check on arrival passes the farm')
  // (wellsite-02/03 capture the search as `(searched = canonicalWellSite(...))`: either form)
  assert.ok(/compute: \(\) => \(?(?:searched = )?canonicalWellSite\(\{ home, read, avoid: wellSearchAvoid\(bot\) \}\)\)?,/.test(s), 'a NEW well site keeps off the farm')
  assert.ok(/if \(first\.site \|\| !widensChestSearch\(first\.refused\)\) return first/.test(s), 'the pick widens on the farm\'s refusals')
}
const SKSRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
await t('WIRED: chest-full passes the farm to both chest-site picks and the arrival re-check; the well\'s NEW-site search carries the farm (source, comments stripped)', () => wired(SKSRC))
await t('MUTANTS KILLED: each wiring removed fails the wiring check (anchor present and unique)', () => {
  const muts = [
    ['    const first = pickChestSite({ read, anchor, home, composterSites, bodies, wells, farm, skip })', '    const first = pickChestSite({ read, anchor, home, composterSites, bodies, wells, skip })'],
    ['wells: chestWellKeepouts(bot), farm: chestFarmIndex(bot) })) { site = pick.site; break }', 'wells: chestWellKeepouts(bot) })) { site = pick.site; break }'],
    (() => { const line = (/\n( {4}compute: \(\) => \(?(?:searched = )?canonicalWellSite\(\{ home, read, avoid: wellSearchAvoid\(bot\) \}\)\)?,)/.exec(SKSRC) ?? [])[1] ?? 'WELL SEARCH LINE NOT FOUND'
      return [line, line.replace('avoid: wellSearchAvoid(bot)', 'avoid')] })(),
    ['    if (first.site || !widensChestSearch(first.refused)) return first', "    if (first.site || !Object.keys(first.refused ?? {}).some(k => /junk well/.test(k))) return first"],
  ]
  for (const [old, neu] of muts) {
    assert.equal(SKSRC.split(old).length, 2, `anchor present and unique: ${old.slice(0, 50)}`)
    assert.throws(() => wired(SKSRC.replace(old, neu)), `the mutant is caught: ${old.slice(0, 50)}`)
  }
})

await t('FLOOR, through townFarm (the skill\'s own search): a town dug into a pit inside the square gets a farm outside the band', () => {
  const over = {}
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) { for (let y = 60; y <= 63; y++) over[K(x, y, z)] = 'air'; over[K(x, 59, z)] = 'grass_block' }
  const { bot } = fakeTown({ items: [S('birch_sapling', 9)], over, storeDir: pool('pit') })
  const farm = SK.townFarm(bot)
  assert.ok(farm.record, farm.why)
  assert.deepEqual(farm.record.cells.filter(c => TF.inFloorBand(HOME, c)), [])
  // positive control: the same search without the band guard puts plots in the pit
  const raw = TF.canonicalFarm({ home: HOME, read: (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox } : null } }).record
  assert.ok(raw && raw.cells.some(c => TF.inFloorBand(HOME, c)), 'without the guard the pit is used')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log('FAILED:\n  ' + failed.join('\n  ')); process.exit(1) }
process.exit(0)
