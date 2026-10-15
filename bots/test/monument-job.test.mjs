// MONUMENT-01: the job's pure core (monumentjob.mjs) and the real build_monument skill on a micro-world with a tiny
// geometry (the sandbox override). Behaviour, with anchored mutants (withMutant asserts the anchor is present and unique).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-monument-${process.pid}`
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'mtestpool'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monjob-'))
// THE SANDBOX OVERRIDE (a 6-wide, one-tier monument at a fixed corner): the same code path as a fleet site
process.env.MONUMENT_SITE = JSON.stringify({ corner: { x: 10, z: 10 }, stairFace: 'w' })
process.env.MONUMENT_GEOM = JSON.stringify({ B: 6, S: 3, H: 2, STAIR_W: 1, APRON: 2 })
process.env.MONUMENT_COOLDOWN_MS = '1'
const here = path.dirname(fileURLToPath(import.meta.url))
const MJP = path.join(here, '../src/monumentjob.mjs')
const MJ = await import('../src/monumentjob.mjs')
const MON = await import('../src/monument.mjs')
const B = await import('../src/builder.mjs')
const ST = await import('../src/structures.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  let src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  src = src.replace(old, neu)
  const out = path.join(here, `.mutant-monjob-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}
const AIR = { name: 'air', boundingBox: 'empty' }, STONE = { name: 'stone', boundingBox: 'block' }, COBBLE = { name: 'cobblestone', boundingBox: 'block' }
const DIRT = { name: 'dirt', boundingBox: 'block' }, WATER = { name: 'water', boundingBox: 'empty' }, POPPY = { name: 'poppy', boundingBox: 'empty' }
const TORCH = { name: 'wall_torch', boundingBox: 'empty' }, LAVA = { name: 'lava', boundingBox: 'empty' }
function world ({ g = 64 } = {}) {
  const m = new Map(), k = (x, y, z) => `${x},${y},${z}`
  const read = (x, y, z) => (Math.abs(x) > 300 || Math.abs(z) > 300) ? null : (m.get(k(x, y, z)) ?? (y < g ? STONE : AIR))
  return { read, set: (x, y, z, b) => m.set(k(x, y, z), b) }
}
const G6 = { B: 6, S: 3, H: 2, STAIR_W: 1, APRON: 2 }
const colOf = read => (x, z) => MON.scanColumn(read, x, z, { yHi: 100, yLo: 30 })

// ---- the sites ---------------------------------------------------------------------------------------------------------
await t('SITES: every shared world of stage 1 has its offline site (12), matching the stage-1 JSON where it is on disk', () => {
  assert.equal(Object.keys(MJ.MONUMENT_SITES).length, 12)
  const j = path.join(here, '../../docs/reports/zig-z0m0-2026-10-15.json')
  if (fs.existsSync(j)) {
    const d = JSON.parse(fs.readFileSync(j, 'utf8'))
    for (const [p, w] of Object.entries(d.worlds)) {
      const s = MJ.MONUMENT_SITES[p]
      assert.deepEqual({ corner: s.corner, baseY: s.baseY, stairFace: s.stairFace }, { corner: w.ziggurat.corner, baseY: w.ziggurat.baseY, stairFace: w.ziggurat.stairFace }, p)
    }
  }
  assert.deepEqual(MJ.siteCandidates('isolated-x', { x: 0, z: 0 }), [], 'no site, no lane')
})

await t('VERIFY: flat ground -> base one above it, no fill; a dip -> foundation runs; a cliff -> a 2-high guard; lava -> refused', () => {
  const w = world()
  const v = MJ.verifySite({ col: colOf(w.read), corner: { x: 10, z: 10 }, stairFace: 'w', g: G6 })
  assert.equal(v.ok, true, v.why); assert.equal(v.site.baseY, 64); assert.deepEqual(v.fill, [])
  const w2 = world()
  for (let y = 61; y < 64; y++) w2.set(12, y, 12, AIR)                    // a 3-deep hole inside the footprint
  const v2 = MJ.verifySite({ col: colOf(w2.read), corner: { x: 10, z: 10 }, stairFace: 'w', g: G6 })
  // the base height minimises the fill (scoreSite): here it sinks one into the flat ground (layer 0 = the ground's own
  // stone, kept as foreign skin / degraded core) and the hole's foundation runs from its floor to baseY-1
  assert.ok(v2.ok); assert.deepEqual(v2.fill.find(r => r[0] === 12 && r[1] === 12), [12, 12, 61, v2.site.baseY - 1, 'foundation'])
  const w3 = world()
  // the ground south of the apron (the apron ends at z=17; the ring is z=18) falls 14
  for (let x = 13; x <= 14; x++) for (let z = 18; z <= 24; z++) for (let y = 50; y < 64; y++) w3.set(x, y, z, AIR)   // a 2-wide gully
  const v3 = MJ.verifySite({ col: colOf(w3.read), corner: { x: 10, z: 10 }, stairFace: 'w', g: G6 })
  assert.ok(v3.ok, v3.why); assert.ok(v3.fill.some(r => r[4] === 'guard' && r[2] === 64 && r[3] === 65), JSON.stringify(v3.fill.filter(r => r[4] === 'guard').slice(0, 3)))
  const w4 = world(); w4.set(12, 64, 12, LAVA)
  assert.equal(MJ.verifySite({ col: colOf(w4.read), corner: { x: 10, z: 10 }, stairFace: 'w', g: G6 }).ok, false)
})

// ---- the plan and the cell states -----------------------------------------------------------------------------------------
const SITE6 = { corner: { x: 10, z: 10 }, baseY: 64, stairFace: 'w' }
await t('PLAN: body + stair + fill, each cell once, layers ascending; the stair cells are known', () => {
  const p = MJ.monumentPlan({ site: SITE6, geom: G6, fill: [[12, 12, 61, 63, 'foundation'], [12, 12, 63, 63, 'apron']] })
  assert.equal(p.cells.length, MON.planSize(G6) + 3, 'the doubled fill cell counted once')
  assert.deepEqual(p.ys, [61, 62, 63, 64, 65])
  assert.equal(p.stairs.size, 1)
})

await t('CELL STATES: skin wants cobble (another solid is foreign), core accepts stone-family (dirt is degraded); water and air open; a poppy clears; lava and a torch block', () => {
  const skin = { role: 'skin' }, core = { role: 'core' }
  assert.equal(MJ.cellState(COBBLE, skin), 'done'); assert.equal(MJ.cellState(STONE, skin), 'foreign')
  assert.equal(MJ.cellState({ name: 'andesite', boundingBox: 'block' }, core), 'done'); assert.equal(MJ.cellState(DIRT, core), 'degraded')
  assert.equal(MJ.cellState(WATER, core), 'open'); assert.equal(MJ.cellState(AIR, skin), 'open')
  assert.equal(MJ.cellState(POPPY, core), 'clear'); assert.equal(MJ.cellState(TORCH, core), 'clear')
  assert.equal(MJ.cellState(LAVA, core), 'blocked'); assert.equal(MJ.cellState(null, core), 'unknown')
  assert.equal(MJ.cellState({ name: 'lantern', boundingBox: 'block' }, skin), 'foreign')
})

await t('BARRIER: a layer closes only with nothing open, to clear, blocked or unloaded; a waived cell counts as closed', () => {
  const w = world()
  const p = MJ.monumentPlan({ site: SITE6, geom: G6, fill: [] })
  const l0 = p.byY.get(64)
  assert.equal(MJ.layerCensus(w.read, l0).closed, false)
  for (const c of l0) w.set(c.x, c.y, c.z, COBBLE)
  assert.equal(MJ.layerCensus(w.read, l0).closed, true)
  w.set(l0[0].x, 64, l0[0].z, LAVA)
  const c1 = MJ.layerCensus(w.read, l0)
  assert.equal(c1.closed, false); assert.equal(c1.blocked, 1)
  assert.equal(MJ.layerCensus(w.read, l0, new Set([`${l0[0].x},64,${l0[0].z}`])).closed, true, 'waived')
})

await t('COVER RULE: a waived hole in layer y-1 holds every y-cell within Chebyshev 1 of its cover except one anchor; the cover and anchor are free', () => {
  const w = world()
  const p = MJ.monumentPlan({ site: SITE6, geom: G6, fill: [] })
  for (const c of p.byY.get(64)) w.set(c.x, c.y, c.z, COBBLE)
  const hole = { x: 12, y: 64, z: 12 }
  w.set(hole.x, hole.y, hole.z, AIR)
  const { held, covers } = MJ.coverHold(w.read, p, 65, new Set([`${hole.x},${hole.y},${hole.z}`]))
  assert.equal(covers.length, 1)
  const { cover, anchor } = covers[0]
  assert.deepEqual([cover.x, cover.y, cover.z], [12, 65, 12])
  assert.ok(anchor && Math.abs(anchor.x - 12) + Math.abs(anchor.z - 12) === 1, 'a side neighbour')
  assert.equal(held.has(B.bk(12, 65, 12)), false); assert.equal(held.has(B.bk(anchor.x, 65, anchor.z)), false)
  assert.equal(held.size, (p.byY.get(65).filter(c => Math.max(Math.abs(c.x - 12), Math.abs(c.z - 12)) <= 1).length) - 2)
  // the builder over the unheld cells: the anchor goes in, then the cover against it, and no held cell before the cover
  const free = p.byY.get(65).filter(c => !held.has(B.bk(c.x, c.y, c.z)))
  const seq = B.sequence(w.read, free.filter(c => Math.max(Math.abs(c.x - 12), Math.abs(c.z - 12)) <= 1), { start: { x: 6, y: 64, z: 13 }, box: { x0: 0, x1: 24, y0: 58, y1: 72, z0: 0, z1: 24 } })
  assert.equal(seq.why, undefined, JSON.stringify(seq))
  const order = seq.steps.map(s => s.c.join(','))
  assert.ok(order.indexOf('12,65,12') > order.indexOf(`${anchor.x},65,${anchor.z}`), `anchor before cover: ${order}`)
  // with the cover placed nothing is held
  w.set(12, 65, 12, COBBLE)
  assert.equal(MJ.coverHold(w.read, p, 65, new Set([`${hole.x},${hole.y},${hole.z}`])).held.size, 0)
  // a waived cell that holds a solid after all is footing: no obligation
  const w2 = world(); for (const c of p.byY.get(64)) w2.set(c.x, c.y, c.z, COBBLE)
  assert.equal(MJ.coverHold(w2.read, p, 65, new Set(['12,64,12'])).held.size, 0)
})

await t('MUTANT KILLED: the cover rule without its hold -- every neighbour of the cover is free', async () => {
  await withMutant(MJP, "      if (Math.max(Math.abs(c.x - cover.x), Math.abs(c.z - cover.z)) <= 1) held.add(bk(c.x, c.y, c.z))\n", '', async m => {
    const w = world()
    const p = m.monumentPlan({ site: SITE6, geom: G6, fill: [] })
    for (const c of p.byY.get(64)) w.set(c.x, c.y, c.z, COBBLE)
    w.set(12, 64, 12, AIR)
    assert.equal(m.coverHold(w.read, p, 65, new Set(['12,64,12'])).held.size, 0)
  })
})

await t('SEGMENTS: the centre 10x10 is segment 0, the rest four quadrants; every cell of a 48 plan has one', () => {
  const p = MJ.monumentPlan({ site: { corner: { x: 0, z: 0 }, baseY: 64, stairFace: 's' }, geom: MON.ZIG, fill: [] })
  const n = [0, 0, 0, 0, 0]
  for (const c of p.byY.get(64)) n[MJ.segmentOf(c, MON.ZIG)]++
  assert.equal(n[0], 100); assert.equal(n.reduce((a, b) => a + b, 0), p.byY.get(64).length)
  assert.ok(n.slice(1).every(v => v > 400))
})

await t('WAIVER: three DIFFERENT bots waive a cell; one bot three times does not; the frontier only moves up and drops stuck counts below it', () => {
  let r = { layer_open: 64, stuck: {}, waived: [] }
  r = MJ.mergeVisit(r, { me: 'a', failed: ['1,64,1'] }); r = MJ.mergeVisit(r, { me: 'a', failed: ['1,64,1'] })
  assert.deepEqual(r.waived, []); assert.deepEqual(r.stuck['1,64,1'], ['a'])
  r = MJ.mergeVisit(r, { me: 'b', failed: ['1,64,1'] }); r = MJ.mergeVisit(r, { me: 'c', failed: ['1,64,1'] })
  assert.deepEqual(r.waived, ['1,64,1']); assert.equal(r.stuck['1,64,1'], undefined)
  r = MJ.mergeVisit(r, { me: 'a', failed: ['2,64,2'] })
  const up = MJ.mergeVisit(r, { advance: 65 })
  assert.equal(up.layer_open, 65); assert.equal(up.stuck['2,64,2'], undefined)
  assert.equal(MJ.mergeVisit(up, { advance: 64 }).layer_open, 65, 'never back down')
})

await t('FUNDING: the bag keeps 64 reserve stone + 1; skin takes only cobble; core prefers the other stone-family, then cobble; tuff is free', () => {
  assert.equal(MJ.fundable([{ name: 'cobblestone', count: 65 }]).total, 0)
  assert.equal(MJ.fundable([{ name: 'cobblestone', count: 100 }]).total, 35)
  assert.equal(MJ.fundable([{ name: 'cobblestone', count: 60 }, { name: 'andesite', count: 20 }]).total, 15)
  assert.equal(MJ.fundable([{ name: 'cobblestone', count: 60 }, { name: 'tuff', count: 20 }]).total, 20)
  const bag = [{ name: 'cobblestone', count: 90 }, { name: 'andesite', count: 10 }]
  assert.equal(MJ.fundPick(bag, { role: 'skin' }), 'cobblestone'); assert.equal(MJ.fundPick(bag, { role: 'core' }), 'andesite')
  assert.equal(MJ.fundPick([{ name: 'cobblestone', count: 65 }], { role: 'skin' }), null, 'at the reserve: nothing')
  assert.equal(MJ.fundPick([{ name: 'cobblestone', count: 60 }, { name: 'tuff', count: 3 }], { role: 'core' }), 'tuff')
})

await t('ADMISSION: one pure decision -- off, far, no funds, a full bag with a conversion waiting, slots full, cooldown, budget; then the order', () => {
  const rich = [{ name: 'cobblestone', count: 200 }]
  const base = { now: 1e9, enabled: true, siteKnown: true, distSite: 50, items: rich, slots: 5, record: { state: 'building' } }
  assert.equal(MJ.monumentOrder({ ...base, enabled: false }).why, 'off')
  assert.equal(MJ.monumentOrder({ ...base, distSite: 500 }).why, 'far')
  assert.equal(MJ.monumentOrder({ ...base, items: [{ name: 'cobblestone', count: 70 }] }).why, 'funds')
  assert.equal(MJ.monumentOrder({ ...base, slots: 35, noRoom: true }).why, 'full_bag_conversion')
  assert.equal(MJ.monumentOrder({ ...base, freeSlot: () => false }).why, 'slots_full')
  assert.equal(MJ.monumentOrder({ ...base, record: { state: 'complete' } }).why, 'state_complete')
  const ok = MJ.monumentOrder(base)
  assert.equal(ok.order.skill, 'build_monument')
  assert.equal(MJ.monumentOrder({ ...base, state: { ...ok.state }, now: base.now + 0 }).why, 'cooldown')
  const spent = { lastIssuedAt: 0, spent: [{ t: base.now - 1000, ms: 11 * 60_000 }] }
  assert.equal(MJ.monumentOrder({ ...base, state: spent }).why, 'budget')
  assert.ok(MJ.monumentOrderOutcome('failed', 'monument_no_site', 0, 0, {}).backoffUntil >= MJ.NO_SITE_BACKOFF_MS)
  assert.equal(MJ.monumentOrderOutcome('no_effect', 'monument_slots_full', 0, 0, {}).backoffUntil, undefined, 'a busy monument: the cooldown alone')
})

await t('RECORD: one writer wins a generation (link); the loser reads the winner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monrec-'))
  const k = MJ.monumentKey({ x: 1, y: 2, z: 3 })
  assert.equal(MJ.createMonumentGen(dir, k, 1, { a: 1 }), true)
  assert.equal(MJ.createMonumentGen(dir, k, 1, { a: 2 }), false)
  assert.equal(MJ.readMonument(dir, k).record.a, 1)
})

await t('GUARD COMPOSITION: the recorded fill (a foundation deeper than base-8, the apron, a guard wall) is reserved; the stair is a place exclusion', () => {
  const rec = { site: SITE6, geom: G6, fill: [[12, 12, 40, 63, 'foundation'], [8, 12, 63, 63, 'apron'], [7, 7, 64, 65, 'guard']], state: 'building' }
  const idx = ST.monumentIndex(rec)
  assert.equal(idx.has(12, 41, 12), true, 'deep foundation'); assert.equal(idx.has(8, 63, 12), true, 'apron'); assert.equal(idx.has(7, 65, 7), true, 'guard')
  assert.equal(idx.has(8, 64, 12), false, 'above the apron: walkable air')
  const k = ST.structureKeepOut([idx])
  const st = MJ.monumentPlan(rec).cells.find(c => c.role === 'stair')
  assert.equal(ST.monumentPlaceCost(k, { position: st }), 100); assert.equal(ST.monumentPlaceCost(k, { position: { x: 0, y: 64, z: 0 } }), 0)
  assert.ok(idx.box.x0 <= 7 && idx.box.z0 <= 7, 'the box covers the fill')
})

// ---- the real build_monument skill on a micro-world --------------------------------------------------------------------
const SK = await import('../src/skills.mjs')
const { Vec3 } = await import('vec3')
function fakeBot (w, at = { x: 4, y: 64, z: 13 }, name = 'TestBot') {
  const client = new EventEmitter()
  const ids = { cobblestone: 1, air: 0, andesite: 2 }
  const names = { 0: { name: 'air' }, 1: { name: 'cobblestone' }, 2: { name: 'andesite' } }
  const inv = [{ name: 'cobblestone', count: 300, type: 4 }]
  const bot = {
    username: name, worldId: null, _client: client, registry: { blocksByStateId: names, blocksByName: {}, itemsByName: {} },
    entity: { position: new Vec3(at.x + 0.5, at.y, at.z + 0.5), yaw: 0, width: 0.6, height: 1.8 }, entities: {}, players: {}, health: 20, food: 20,
    heldItem: null, inventory: { items: () => inv.filter(i => i.count > 0), slots: [] },
    equip: async it => { bot.heldItem = it }, lookAt: async () => {}, waitForTicks: async () => {},
    blockAt: p => { const b = w.read(p.x, p.y, p.z); return b ? { ...b, position: new Vec3(p.x, p.y, p.z) } : null },
    _placeBlockWithOptions: async (ref, face) => {
      const d = { x: ref.position.x + face.x, y: ref.position.y + face.y, z: ref.position.z + face.z }
      const held = bot.heldItem?.name
      w.set(d.x, d.y, d.z, { name: held, boundingBox: 'block' })
      const it = inv.find(i => i.name === held); if (it) it.count--
      setImmediate(() => client.emit('block_change', { location: d, type: ids[held] }))
    },
    dig: async b => { w.set(b.position.x, b.position.y, b.position.z, AIR); setImmediate(() => client.emit('block_change', { location: b.position, type: 0 })) },
    pathfinder: {
      goto: async goal => {
        let x = goal.x, y = goal.y, z = goal.z
        if (y === undefined) { y = 100; while (y > 0 && w.read(x, y - 1, z)?.boundingBox !== 'block') y--; }
        if (B.standable(w.read, x, y, z)) bot.entity.position = new Vec3(x + 0.5, y, z + 0.5)
      },
      setGoal: () => {}, stop: () => {}, isMining: () => false,
    },
    setControlState: () => {}, clearControlStates: () => {}, setQuickBarSlot: () => {},
    wellCellsNow: () => [], farmIndexNow: () => null,
  }
  return { bot, inv }
}
const run = bot => SK.SKILLS.build_monument.run({ bot }, {}, new AbortController().signal)
const KEY = MJ.monumentKey({ x: 0, y: 64, z: 0 })
const DIR = process.env.POOL_STATE_DIR

await t('THE CHAIN: the first visit sites the monument (record g1), builds the open layer from the apron, and the layer closes and the frontier rises', async () => {
  const w = world()
  const { bot } = fakeBot(w)
  const r1 = await run(bot)
  const rec1 = MJ.readMonument(DIR, KEY)
  assert.ok(rec1.record, `recorded (${r1.status}: ${r1.detail})`)
  assert.deepEqual(rec1.record.site, { corner: { x: 10, z: 10 }, baseY: 64, stairFace: 'w' })
  assert.equal(r1.status, 'success', r1.detail)
  // visits until the bottom layer is closed (48 placements per visit at most)
  let r = r1
  for (let i = 0; i < 6 && MJ.readMonument(DIR, KEY).record.layer_open === 64; i++) r = await run(bot)
  const rec = MJ.readMonument(DIR, KEY).record
  assert.ok(rec.layer_open > 64, `the frontier rose (${rec.layer_open}; last: ${r.status} ${r.detail})`)
  const plan = MJ.monumentPlan({ ...rec, gen: 'x' })
  for (const c of plan.byY.get(64)) assert.equal(w.read(c.x, c.y, c.z).name, 'cobblestone', `${c.x},${c.y},${c.z} ${c.role}`)
  // the funding rule held: the bag never went below the reserve
  assert.ok(bot.inventory.items().reduce((n, i) => n + i.count, 0) >= MJ.FUND_KEEP)
})

await t('THE CHAIN, to the top: further visits complete the tiny monument; the record says complete; nothing outside the plan was placed', async () => {
  const w = world()
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true })
  const { bot } = fakeBot(w)
  let r
  for (let i = 0; i < 12 && MJ.readMonument(DIR, KEY).record?.state !== 'complete'; i++) r = await run(bot)
  const rec = MJ.readMonument(DIR, KEY).record
  assert.equal(rec.state, 'complete', `${rec.layer_open} ${r?.status} ${r?.detail}`)
  const plan = MJ.monumentPlan({ ...rec, gen: 'y' })
  for (const c of plan.cells) assert.equal(w.read(c.x, c.y, c.z).name, 'cobblestone')
  let extra = 0
  for (let x = 0; x <= 24; x++) for (let z = 0; z <= 24; z++) for (let y = 64; y <= 70; y++) if (w.read(x, y, z).name === 'cobblestone' && !plan.key.has(B.bk(x, y, z))) extra++
  assert.equal(extra, 0)
})

await t('THE CHAIN with a poppy and water in the footprint: the poppy is cleared by hand and placed over, the water is placed into', async () => {
  const w = world()
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true })
  w.set(12, 64, 12, POPPY); w.set(13, 64, 13, WATER)
  const { bot } = fakeBot(w)
  for (let i = 0; i < 6 && (MJ.readMonument(DIR, KEY).record?.layer_open ?? 64) === 64; i++) await run(bot)
  assert.equal(w.read(12, 64, 12).name, 'cobblestone'); assert.equal(w.read(13, 64, 13).name, 'cobblestone')
})

await t('A BLOCKED CELL (redstone wire: not solid, not clearable, not fillable) waits; three different bots waive it; the layer then closes', async () => {
  const w = world()
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true })
  w.set(12, 64, 12, { name: 'redstone_wire', boundingBox: 'empty' })
  for (const name of ['A', 'A', 'B', 'C', 'C']) { const { bot } = fakeBot(w, undefined, name); await run(bot) }
  const rec = MJ.readMonument(DIR, KEY).record
  assert.ok(rec.waived.includes('12,64,12'), JSON.stringify(rec.stuck))
  const { bot } = fakeBot(w, undefined, 'D'); await run(bot)
  assert.ok(MJ.readMonument(DIR, KEY).record.layer_open > 64)
})

await t('SLOTS: with three slots held by others, a fourth bot is refused (no_effect monument_slots_full) and places nothing', async () => {
  const w = world()
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true })
  const { bot } = fakeBot(w, undefined, 'first'); await run(bot)
  const { takeLease } = await import('../src/blueprint.mjs')
  for (let i = 0; i < 3; i++) assert.ok(takeLease(DIR, `${KEY}.slot${i}`, `other${i}`, Date.now(), 60_000).ok)
  const before = JSON.stringify([...Array(25).keys()].map(x => w.read(x, 64, 12).name))
  const { bot: b4 } = fakeBot(w, undefined, 'fourth')
  const r = await run(b4)
  assert.equal(r.failClass, 'monument_slots_full', r.detail)
  assert.equal(JSON.stringify([...Array(25).keys()].map(x => w.read(x, 64, 12).name)), before)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
