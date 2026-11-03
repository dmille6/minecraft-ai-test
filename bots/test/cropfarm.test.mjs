// CROPFARM-01: THE TOWN WHEAT FARM (bots/src/cropfarm.mjs, bots/src/cropkeep.mjs; farms design docs/reports/farms-design-2026-11-03.md).
// Behaviour on buildfake's flat world (stone below G, grass at G) and hand-built grounds: the rows layout (no crop diagonal to another:
// vanilla's half-speed rule), the siting (flat, natural ground, off every reservation, the land plan's farms zone before the town,
// the hydrated site first), the crops read, the harvest, the due test, the seed gather's targets; the SEED KEEP composed through
// hygiene, the composter and the chest rule in a child process per pool; the record BUILT END TO END by buildrun.mjs runVisit (the
// hoe tills, the seeds go in, a cell with no seed is passed and never tilled for nothing); the wiring in skills.mjs and shop.mjs
// (structural only). Every mutant asserts its anchor present and unique.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const C = await import('../src/cropfarm.mjs')
const K = await import('../src/cropkeep.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const CROP_PATH = new URL('../src/cropfarm.mjs', import.meta.url)
const KEEP_PATH = new URL('../src/cropkeep.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const HYG_PATH = new URL('../src/hygiene.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
/** A world read with crop ages: `ages` "x,y,z" -> age over the fake server's names. */
const withAges = (srv, ages = new Map()) => (x, y, z) => { const b = srv.read(x, y, z); return b && ages.has(`${x},${y},${z}`) ? { ...b, age: ages.get(`${x},${y},${z}`) } : b }
const diag = crops => { const s = new Set(crops.map(p => `${p.x},${p.z}`)); return crops.filter(p => [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dz]) => s.has(`${p.x + dx},${p.z + dz}`))).length }
const bothAxes = crops => { const s = new Set(crops.map(p => `${p.x},${p.z}`)); return crops.filter(p => (s.has(`${p.x + 1},${p.z}`) || s.has(`${p.x - 1},${p.z}`)) && (s.has(`${p.x},${p.z + 1}`) || s.has(`${p.x},${p.z - 1}`))).length }

console.log('THE LAYOUT')
await t('bedLayout: 4 rows of 7 between walkways -- 28 crops, 53 walkway columns, a 9 x 9 box; no crop diagonal to another, none with crops on both axes (vanilla half speed); orient z is the transpose', async () => {
  const a = C.bedLayout(10, 20, 'x')
  assert.strictEqual(a.crops.length, 28)
  assert.strictEqual(a.walk.length, 81 - 28)
  assert.deepStrictEqual(a.box, [9, 20, 17, 28])
  assert.strictEqual(diag(a.crops), 0)
  assert.strictEqual(bothAxes(a.crops), 0)
  const b = C.bedLayout(10, 20, 'z')
  assert.deepStrictEqual(b.box, [10, 19, 18, 27])
  assert.strictEqual(diag(b.crops), 0)
  assert.ok(b.crops.every(p => (p.x - 10) % 2 === 1), 'orient z: the crop rows are the odd x offsets')
})
await t('MUTANT KILLED: crops on every row (no walkways between) put crops diagonal to each other', async () => {
  await withMutant(CROP_PATH, 'if (v % 2 === 1 && u >= 0 && u < len)', 'if (v >= 1 && v < 2 * rows && u >= 0 && u < len)', async M => {
    assert.ok(diag(M.bedLayout(10, 20, 'x').crops) > 0)
  })
})

console.log('THE SITING')
await t('siteCropFarm on open flat grass: a site at least rMin from home, the nearest; 28 till cells at G under 28 wheat cells; 4 row segments; the front is a walkway column', async () => {
  const srv = server()
  const s = C.siteCropFarm(srv.read, { home: HOME })
  assert.ok(s.ok, s.why)
  const rec = s.record
  assert.strictEqual(rec.blueprint, C.CROPFARM_BLUEPRINT)
  assert.strictEqual(rec.cells.filter(c => c.role === 'till').length, 28)
  assert.strictEqual(rec.cells.filter(c => c.role === 'wheat').length, 28)
  assert.ok(rec.cells.filter(c => c.role === 'till').every(c => c.at[1] === G))
  assert.ok(rec.cells.filter(c => c.role === 'wheat').every(c => c.at[1] === G + 1))
  assert.deepStrictEqual(rec.segments.map(q => q.seg), ['R-1', 'R-2', 'R-3', 'R-4'])
  const [x0, z0, x1, z1] = rec.box
  const near = Math.max(Math.abs(Math.max(x0, Math.min(0, x1))), Math.abs(Math.max(z0, Math.min(0, z1))))
  assert.ok(near >= C.CROP.rMin && near <= C.CROP.rMin + 1, `nearest column ${near}`)
  const walk = new Set(rec.walk.map(w => `${w[0]},${w[2]}`))
  assert.ok(rec.front.every(([x, z]) => walk.has(`${x},${z}`)))
  assert.strictEqual(rec.counts.hydrated, 0)
})
await t('the siting keeps off a reservation, a step in the ground and a water column; the plants on crop cells are listed clears', async () => {
  const srv = server()
  const s0 = C.siteCropFarm(srv.read, { home: HOME }).record
  // block every column of the first site: the next site never overlaps it
  const b0 = s0.box
  const blocked = (x, z) => (x >= b0[0] && x <= b0[2] && z >= b0[1] && z <= b0[3] ? 'project' : null)
  const s1 = C.siteCropFarm(srv.read, { home: HOME, blocked }).record
  assert.ok(s1.box[2] < b0[0] || s1.box[0] > b0[2] || s1.box[3] < b0[1] || s1.box[1] > b0[3], 'off the reservation')
  // a dirt step inside the first site's box refuses it (level), and so does a water column
  const srvS = server(); srvS.set([b0[0] + 3, G + 1, b0[1] + 3], 'grass_block'); srvS.set([b0[0] + 3, G, b0[1] + 3], 'dirt')
  const s2 = C.siteCropFarm(srvS.read, { home: HOME }).record
  assert.notDeepStrictEqual(s2.box, b0)
  const srvW = server(); srvW.set([b0[0] + 4, G, b0[1] + 4], 'water')
  assert.notDeepStrictEqual(C.siteCropFarm(srvW.read, { home: HOME }).record.box, b0)
  // short grass on a crop cell: a listed plant clear (the till's overburden)
  const srvP = server(); const c0 = s0.cells.find(c => c.role === 'wheat').at
  srvP.set(c0, 'short_grass')
  const P = (await import('../src/paths.mjs'))
  const col = (x, z) => P.pathColumn(srvP.read, x, z, { yHi: HOME.y + 16, yLo: HOME.y - 16 })
  const f3 = C.fitBed(srvP.read, { x0: s0.anchor[0], z0: s0.anchor[1], orient: s0.orient, home: HOME, col })
  assert.ok(f3.ok, `a plant does not refuse the site (${f3.why})`)
  assert.deepStrictEqual(f3.clear, [{ at: c0, kind: 'plant', name: 'short_grass' }])
  // ...but the site with nothing to clear is preferred (the cost counts the clears)
  assert.notDeepStrictEqual(C.siteCropFarm(srvP.read, { home: HOME }).record.box, b0)
})
await t('MUTANT KILLED: without the level rule a box with a step in it is sited (a fall onto farmland tramples it)', async () => {
  const srv = server()
  const b0 = C.siteCropFarm(srv.read, { home: HOME }).record.box
  srv.set([b0[0] + 3, G + 1, b0[1] + 3], 'grass_block'); srv.set([b0[0] + 3, G, b0[1] + 3], 'dirt')
  await withMutant(CROP_PATH, "    if (c.y !== L) return { ok: false, why: 'level' }\n", '\n', async M => {
    assert.deepStrictEqual(M.siteCropFarm(srv.read, { home: HOME }).record.box, b0)
  })
})
await t('the land plan: the farms zone before the town ring; neither fits -> a named no fit', async () => {
  const srv = server()
  // farms: the east half beyond x 30; town: everything else within 30
  const zone = (x, z) => (x > 30 ? 'farms' : Math.max(Math.abs(x), Math.abs(z)) <= 30 ? 'town' : 'wild')
  const s = C.siteCropFarm(srv.read, { home: HOME, zone })
  assert.ok(s.ok && s.zone === 'farms', s.why)
  assert.ok(s.record.box[0] > 30)
  const zt = (x, z) => (Math.max(Math.abs(x), Math.abs(z)) <= 30 ? 'town' : 'wild')
  const s2 = C.siteCropFarm(srv.read, { home: HOME, zone: zt })
  assert.ok(s2.ok && s2.zone === 'town')
  const s3 = C.siteCropFarm(srv.read, { home: HOME, zone: () => 'wild' })
  assert.ok(!s3.ok && /no fit/.test(s3.why))
})
await t('hydration: the site with crops within 4 of still water wins over a nearer dry one', async () => {
  const srv = server()
  const dry = C.siteCropFarm(srv.read, { home: HOME }).record
  // a pond 20 blocks further out on the +x side, its cells at G (the farmland's level)
  for (let z = -2; z <= 2; z++) srv.set([36, G, z], 'water')
  const water = (x, y, z) => srv.read(x, y, z)?.name === 'water'
  const wet = C.siteCropFarm(srv.read, { home: HOME, water }).record
  assert.ok(wet.counts.hydrated >= 10, `hydrated ${wet.counts.hydrated}`)
  assert.notDeepStrictEqual(wet.box, dry.box)
})

console.log('THE CROPS READ, THE HARVEST, THE DUE TEST')
const REC = () => C.siteCropFarm(server().read, { home: HOME }).record
await t('cropState: mature at age 7 (beetroots 3), growing below, open over farmland, till_lost over grass, blocked by a block', async () => {
  const srv = server(), rec = REC(), [a, b, c, d, e] = C.cropCells(rec)
  const ages = new Map()
  for (const q of [a, b, c, d, e]) srv.set([q.at[0], q.at[1] - 1, q.at[2]], 'farmland')
  srv.set(a.at, 'wheat'); ages.set(a.at.join(','), 7)
  srv.set(b.at, 'wheat'); ages.set(b.at.join(','), 3)
  srv.set(c.at, 'beetroots'); ages.set(c.at.join(','), 3)
  srv.set(e.at, 'cobblestone')
  const rd = withAges(srv, ages)
  assert.deepStrictEqual([a, b, c, d, e].map(q => C.cropState(rd, q)), ['mature', 'growing', 'mature', 'open', 'blocked'])
  assert.strictEqual(C.cropState(rd, C.cropCells(rec)[6]), 'till_lost', 'grass below: the till cell is open again')
  assert.deepStrictEqual(C.harvestCells(rd, rec).map(q => q.at), [a.at, c.at].sort((p, q) => Math.hypot(p[0], p[2]) - Math.hypot(q[0], q[2]) || p[0] - q[0] || p[2] - q[2]))
})
await t('cropDue: a mature crop -> harvest (not at the town\'s wheat cap, nor with a full bag); open cells -> replant only with seeds; an empty seedless farm is quiet', async () => {
  const srv = server(), rec = REC(), [a] = C.cropCells(rec)
  for (const q of C.cropCells(rec)) srv.set([q.at[0], q.at[1] - 1, q.at[2]], 'farmland')
  const ages = new Map([[a.at.join(','), 7]]); srv.set(a.at, 'wheat')
  const rd = withAges(srv, ages)
  assert.strictEqual(C.cropDue(rd, rec, { seeds: 0 }), 'harvest')
  assert.strictEqual(C.cropDue(rd, rec, { seeds: 0, townWheat: 128 }), null)
  assert.strictEqual(C.cropDue(rd, rec, { seeds: 5, townWheat: 128 }), 'replant')
  assert.strictEqual(C.cropDue(rd, rec, { seeds: 0, freeSlots: 2 }), null)
  ages.set(a.at.join(','), 2)
  assert.strictEqual(C.cropDue(rd, rec, { seeds: 0 }), null, 'growing and no seed: quiet')
  assert.strictEqual(C.seedNeed(rd, rec, 10), 27 - 10)
  assert.strictEqual(C.seedKeep(rec), 28 + C.CROP.seedSpare)
})
await t('cropAlsoDone: a till cell under a crop is done; without a seed a till cell and an empty crop cell are passed, a planted one never', async () => {
  const srv = server(), rec = REC()
  const till = C.tillCells(rec)[0], crop = C.cropCells(rec).find(q => q.at[0] === till.at[0] && q.at[2] === till.at[2])
  assert.strictEqual(C.cropAlsoDone(till, srv.read, { noSeed: false }), false)
  assert.strictEqual(C.cropAlsoDone(till, srv.read, { noSeed: true }), true)
  assert.strictEqual(C.cropAlsoDone(crop, srv.read, { noSeed: true }), true)
  srv.set(crop.at, 'wheat')
  assert.strictEqual(C.cropAlsoDone(till, srv.read, { noSeed: false }), true)
  assert.strictEqual(C.cropAlsoDone(crop, srv.read, { noSeed: true }), false)
})
await t('cropStand: every crop cell has a walkway stand beside it (dug and planted from the walkway, the drop within reach)', async () => {
  for (const orient of ['x', 'z']) {
    const srv = server()
    const rec = C.cropRecord({ f: C.fitBed(srv.read, { x0: 15, z0: 15, orient, home: HOME, col: (x, z) => ({ y: G, name: 'grass_block', why: null, above: [] }) }), x0: 15, z0: 15 }, { home: HOME })
    const walk = new Set(rec.walk.map(w => w.join(',')))
    for (const c of C.cropCells(rec)) {
      const s = C.cropStand(rec, c)
      assert.ok(s && walk.has(s.join(',')) && Math.abs(s[0] - c.at[0]) + Math.abs(s[2] - c.at[2]) === 1, `${orient} ${c.at}`)
    }
  }
})

console.log('THE SEED GATHER')
await t('seedGrassTargets: grass plants within 24 of the farm, nearest first, a tall plant at its lower half; never a reserved cell, nor another plant, nor one too far', async () => {
  const srv = server(), box = [10, 10, 18, 18]
  srv.set([20, G + 1, 12], 'short_grass')
  srv.set([22, G + 1, 12], 'tall_grass'); srv.set([22, G + 2, 12], 'tall_grass')
  srv.set([25, G + 1, 12], 'poppy')
  srv.set([30, G + 1, 12], 'short_grass')                     // reserved
  srv.set([50, G + 1, 12], 'short_grass')                     // 32 from the box
  const cands = [[20, G + 1, 12], [22, G + 2, 12], [25, G + 1, 12], [30, G + 1, 12], [50, G + 1, 12]].map(at => ({ at }))
  const reserved = (x) => (x === 30 ? 'project' : null)
  const ts = C.seedGrassTargets(cands, { read: srv.read, box, reserved, from: [14, G + 1, 14] })
  assert.deepStrictEqual(ts, [{ at: [20, G + 1, 12], name: 'short_grass' }, { at: [22, G + 1, 12], name: 'tall_grass' }])
  assert.strictEqual(C.seedGrassTargets(cands, { read: srv.read, box, reserved, max: 1 }).length, 1)
})

console.log('THE SEED KEEP (cropkeep.mjs, composed through hygiene, the composter and the chest rule)')
await t('cropfarmOn: the showcase by default; CROPFARM on/off overrides; neverKeepFor drops wheat_seeds only while on, the base untouched', async () => {
  assert.strictEqual(K.cropfarmOn({}, 'showcase'), true)
  assert.strictEqual(K.cropfarmOn({}, 'board-a'), false)
  assert.strictEqual(K.cropfarmOn({ CROPFARM: 'off' }, 'showcase'), false)
  assert.strictEqual(K.cropfarmOn({ CROPFARM: 'on' }, 'board-a'), true)
  assert.strictEqual(K.cropfarmOn({ CROPFARM_POOLS: 'hive-a,showcase' }, 'hive-a'), true)
  const base = ['wheat_seeds', 'beetroot_seeds', 'egg']
  assert.deepStrictEqual([...K.neverKeepFor(base, {}, 'showcase')], ['beetroot_seeds', 'egg'])
  assert.deepStrictEqual([...K.neverKeepFor(base, {}, 'board-a')], base)
  assert.deepStrictEqual(base, ['wheat_seeds', 'beetroot_seeds', 'egg'])
})
const probe = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  const H = await import(${JSON.stringify(new URL('../src/hygiene.mjs', import.meta.url).href)})
  const C = await import(${JSON.stringify(new URL('../src/composter.mjs', import.meta.url).href)})
  const T = await import(${JSON.stringify(new URL('../src/towndeposit.mjs', import.meta.url).href)})
  const n = 'wheat_seeds'
  console.log(JSON.stringify({ neverKeep: H.NEVER_KEEP.has(n), pickupSkip: H.neverPickUp({ getDroppedItem: () => ({ name: n }) }), compost: C.isCompostJunk(n), notForChest: T.notForChest(n), beet: H.NEVER_KEEP.has('beetroot_seeds') }))
`], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim().split('\n').at(-1))
await t('COMPOSED: in the showcase the farm\'s seeds are walked to, never composted, and banked; in a fleet pool (and with CROPFARM=off) they stay junk on all three', async () => {
  const sc = probe({ MEMORY_POOL: 'showcase', CROPFARM: '' })
  assert.deepStrictEqual(sc, { neverKeep: false, pickupSkip: false, compost: false, notForChest: false, beet: true })
  const fl = probe({ MEMORY_POOL: 'board-a', CROPFARM: '' })
  assert.deepStrictEqual(fl, { neverKeep: true, pickupSkip: true, compost: true, notForChest: true, beet: true })
  const off = probe({ MEMORY_POOL: 'showcase', CROPFARM: 'off' })
  assert.deepStrictEqual(off, { neverKeep: true, pickupSkip: true, compost: true, notForChest: true, beet: true })
})
await t('MUTANT KILLED: with the keep\'s delete gone the showcase\'s seeds are still composted', async () => {
  await withMutant(KEEP_PATH, '  if (cropfarmOn(env, pool)) for (const s of KEPT_SEEDS) out.delete(s)\n', '\n', async M => {
    assert.ok(M.neverKeepFor(['wheat_seeds'], {}, 'showcase').has('wheat_seeds'))
  })
})

console.log('THE VISIT: the hoe tills, the seeds go in, a seedless cell is passed and never tilled')
const farmVisit = async ({ inv, rec, seeds = () => (inv.wheat_seeds ?? 0) > 0 }) => {
  const srv = server()
  for (const c of rec.clear ?? []) srv.set(c.at, c.name)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cf-'))
  const key = PJ.projKey(HOME, C.CROPFARM_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 2)
  const e = bot(srv, 'A', { inv, feet: [rec.front[0][0], G + 1, rec.front[0][1]], as: n => ({ wheat_seeds: 'wheat' }[n] ?? n), ack: (tg, held) => (held === 'stone_hoe' ? 'refuse' : 'ok') })
  let heldNow = null
  const hold0 = e.hold
  e.hold = async n => { const ok = await hold0(n); if (ok) heldNow = n; return ok }
  const send0 = e.send
  e.send = (support, face, seq) => { if (heldNow === 'stone_hoe') srv.set(support, 'farmland'); return send0(support, face, seq) }
  const hoe = { block: 'farmland', can: b => C.TILLABLE.test(b?.name), want: b => b?.name === 'farmland', held: () => heldNow === 'stone_hoe', hold: () => e.hold('stone_hoe') }
  const r = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: C.CROP_PALETTE, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, foreign: C.CROP_FOREIGN, blockLayer: false, clearMax: 40,
    useFor: q => (q.role === 'till' ? hoe : null), openRole: role => role === 'wheat' || role === 'till', alsoDone: (q, rd) => C.cropAlsoDone(q, rd ?? srv.read, { noSeed: !seeds() }) }, e, { maxSteps: 400 })
  return { r, srv, e }
}
await t('a sited farm built end to end: every till cell farmland, every crop cell wheat, the listed grass dug first; complete', async () => {
  const srv0 = server()
  const s0 = C.siteCropFarm(srv0.read, { home: HOME }).record
  const g0 = C.cropCells(s0)[0].at
  srv0.set(g0, 'short_grass')
  const P = (await import('../src/paths.mjs'))
  const col = (x, z) => P.pathColumn(srv0.read, x, z, { yHi: HOME.y + 16, yLo: HOME.y - 16 })
  const rec = C.cropRecord({ f: C.fitBed(srv0.read, { x0: s0.anchor[0], z0: s0.anchor[1], orient: s0.orient, home: HOME, col }), x0: s0.anchor[0], z0: s0.anchor[1] }, { home: HOME })
  assert.strictEqual(rec.clear.length, 1)
  const inv = { stone_hoe: 1, wheat_seeds: 40 }
  const { r, srv } = await farmVisit({ inv, rec })
  assert.strictEqual(r.stop, 'complete', `${r.stop}: ${r.why}`)
  assert.ok(C.tillCells(rec).every(c => srv.read(...c.at).name === 'farmland'))
  assert.ok(C.cropCells(rec).every(c => srv.read(...c.at).name === 'wheat'))
  assert.strictEqual(inv.wheat_seeds, 40 - 28)
  assert.strictEqual(srv.read(...g0).name, 'wheat', 'the listed grass was dug and the cell planted')
})
await t('no seed: nothing is tilled (a farmland with nothing on it only dries back), the visit completes over the passed cells', async () => {
  const rec = REC()
  const { r, srv } = await farmVisit({ inv: { stone_hoe: 1 }, rec })
  assert.ok(C.tillCells(rec).every(c => srv.read(...c.at).name === 'grass_block'))
  assert.strictEqual(r.stop, 'complete', `${r.stop}: ${r.why}`)
})
await t('MUTANT KILLED: with the seedless pass of a till cell gone the hoe tills cells nothing will be planted on', async () => {
  await withMutant(CROP_PATH, '    return !!noSeed\n', '    return false\n', async M => {
    const rec = REC()
    const srv = server()
    assert.strictEqual(M.cropAlsoDone(C.tillCells(rec)[0], srv.read, { noSeed: true }), false)
  })
})

console.log('THE WIRING (structural: what behaviour cannot reach)')
const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
const sh = strip(readFileSync(SHOP_PATH, 'utf8'))
await t('build_shop dispatches the crop farm\'s plot to buildCropFarm; a standing farm is only due (never damaged) through cropDue', async () => {
  assert.strictEqual(sk.split('if (proj.plot === CROPFARM_PLOT) return buildCropFarm(ctx, args, signal)').length, 2)
  assert.strictEqual(sk.split('if (r.blueprint === CROPFARM_BLUEPRINT) return tidy && !!cropDueFor(bot, r)').length, 2)
  assert.ok(/async function buildCropFarm \(ctx, args, signal\)/.test(sk))
})
await t('shop.mjs: the crop farm is a project after the tree farm, gated by its switch; its palette is CROP_PALETTE for the damage test', async () => {
  assert.ok(/plot: CROPFARM_PLOT, blueprint: CROPFARM_BLUEPRINT, after: TREEFARM_PLOT, builders: CROPFARM_BUILDERS/.test(sh))
  assert.ok(/p\.plot === CROPFARM_PLOT \? crop && on/.test(sh))
  assert.ok(/id === CROPFARM_BLUEPRINT \? \{ id, palette: CROP_PALETTE \}/.test(sk))
})
await t('junkswap never drops a kept seed (skills.mjs JUNKSWAP_ITEMS is built through the keep)', async () => {
  assert.ok(/export const JUNKSWAP_ITEMS = neverKeepFor\(/.test(sk))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
