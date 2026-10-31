// EXPEDITION-01: SHORT SURFACE EXPEDITIONS (bots/src/expedition.mjs), pure and composed: the switch; the admission (never while a
// project can use the bot); buildOrder's ask (the order is build_shop {expedition}); the ring and the bearing (blocked bearings
// skipped, every other trip reusing a good one); the surface read (canopy passed, water seen); a leg never set across water or
// into a zone, bending round a lake; a known marker walked to; the turn reasons; a whole synthetic trip out and back over the
// crumbs (the cursor only falls); the marker rules (spacing, off the route, never on sand or by water); a village beam is not a
// tree; the haul less the kit; and the wiring in skills.mjs / features.mjs. Mutants assert their anchors present and unique.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const E = await import('../src/expedition.mjs')
const SHOP = await import('../src/shop.mjs')

const EX_PATH = new URL('../src/expedition.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const FEAT_PATH = new URL('../src/features.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A mutant (anchor present and unique: CLAUDE.md), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---- a synthetic world: flat grass at feet y=70 (ground 69), with a lake, trees and sand where a test puts them ---------------
function world ({ lake = null, sand = [], blocks = {} } = {}) {
  const key = (x, y, z) => `${x},${y},${z}`
  return (x, y, z) => {
    if (blocks[key(x, y, z)]) return blocks[key(x, y, z)]
    if (lake && x >= lake.x0 && x <= lake.x1 && z >= lake.z0 && z <= lake.z1) {
      if (y === 69) return { name: 'water', boundingBox: 'empty' }
      if (y < 69) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air', boundingBox: 'empty' }
    }
    if (y === 69) return sand.some(([a, c]) => a === x && c === z) ? { name: 'sand', boundingBox: 'block' } : { name: 'grass_block', boundingBox: 'block' }
    if (y < 69) return { name: 'stone', boundingBox: 'block' }
    return { name: 'air', boundingBox: 'empty' }
  }
}
const HOME = { x: 0, y: 70, z: 0 }

await t('the switch: on only in the showcase pool by default; EXPEDITION=on|off wins; markers switch apart', async () => {
  assert.equal(E.expeditionOn({}, 'showcase'), true)
  assert.equal(E.expeditionOn({}, 'board-a'), false)
  assert.equal(E.expeditionOn({ EXPEDITION: 'off' }, 'showcase'), false)
  assert.equal(E.expeditionOn({ EXPEDITION: 'on' }, 'board-a'), true)
  assert.equal(E.expeditionOn({ EXPEDITION_POOLS: 'board-a,hive-b' }, 'hive-b'), true)
  assert.equal(E.markersOn({ EXPEDITION_MARKERS: 'off' }), false)
  assert.equal(E.markersOn({}), true)
  assert.match(E.expeditionModeDetail(false), /^on=0 /)
})

await t('admission: never while a project can use the bot; health, food, room, dusk, cooldown, slots; a pending haul first', async () => {
  const ok = { on: true, complete: true, now: 10 * 60 * 60_000, timeOfDay: 1000 }
  assert.deepEqual(E.expeditionAdmit(ok), { ok: true, phase: 'trip', why: 'go' })
  assert.equal(E.expeditionAdmit({ ...ok, complete: false }).why, 'project_open')
  assert.equal(E.expeditionAdmit({ ...ok, complete: false, lastStop: 'no_material' }).ok, true)
  assert.equal(E.expeditionAdmit({ ...ok, complete: false, lastStop: 'complete' }).ok, true, 'a visit that found nothing to do')
  assert.equal(E.expeditionAdmit({ ...ok, complete: false, lastStop: 'deadline' }).why, 'project_open')
  assert.equal(E.expeditionAdmit({ ...ok, on: false }).why, 'off')
  assert.equal(E.expeditionAdmit({ ...ok, lastTripAt: ok.now - 5 * 60_000 }).why, 'cooldown')
  assert.equal(E.expeditionAdmit({ ...ok, lastTripAt: ok.now - 25 * 60_000 }).ok, true)
  assert.equal(E.expeditionAdmit({ ...ok, health: 14 }).why, 'health')
  assert.equal(E.expeditionAdmit({ ...ok, food: 8 }).why, 'food')
  assert.equal(E.expeditionAdmit({ ...ok, freeSlots: 3 }).why, 'room')
  assert.equal(E.expeditionAdmit({ ...ok, timeOfDay: 11_000 }).why, 'night')
  assert.equal(E.expeditionAdmit({ ...ok, timeOfDay: 24_000 + 500 }).ok, true)
  assert.equal(E.expeditionAdmit({ ...ok, slotFree: false }).why, 'slots_full')
  assert.deepEqual(E.expeditionAdmit({ ...ok, complete: false, pendingDeposit: true }), { ok: true, phase: 'deposit', why: 'pending_deposit' })
})

await t('buildOrder asks only when the projects have nothing for the bot, and orders build_shop {expedition}', async () => {
  const asked = []
  SHOP.setExpeditionAsk(o => { asked.push(o); return { ok: true, phase: 'trip' } })
  try {
    const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, health: 20, freeSlots: 30 }
    const r1 = SHOP.buildOrder({ ...base, complete: true, record: { plot: 'treefarm' } })
    assert.deepEqual(r1.order, { skill: 'build_shop', args: { expedition: true, phase: 'trip' } })
    const r2 = SHOP.buildOrder({ ...base, complete: false, record: { plot: 'treefarm' }, state: { lastStop: 'no_material', lastAt: 1e12 - 1000 } })
    assert.equal(r2.order?.args?.expedition, true, 'a project out of material does not hold the bot')
    const n = asked.length
    const r3 = SHOP.buildOrder({ ...base, complete: false, record: { plot: 'treefarm' }, state: { lastStop: 'deadline', lastAt: 0 } })
    assert.equal(r3.order?.args?.expedition, undefined, 'an open project with work gets the build')
    assert.equal(asked.length, n, 'not even asked')
    // a visit that just COMPLETED one project stops `complete` while the next stands open: the open record keeps the builder
    const r4 = SHOP.buildOrder({ ...base, complete: false, record: { plot: 'house1', structure_complete: false }, state: { lastStop: 'complete', lastAt: 0 } })
    assert.notEqual(r4.order?.args?.expedition, true, 'the next open project keeps its builder (Codex r4)')
    // the finished farm that is only due (trees no bot can fell): the visit found nothing to do -> free
    const r5 = SHOP.buildOrder({ ...base, complete: false, record: { plot: 'treefarm', structure_complete: true }, state: { lastStop: 'complete', lastAt: 1e12 - 1000 } })
    assert.equal(r5.order?.args?.expedition, true)
    assert.equal(SHOP.buildOrder({ ...base, atTown: false, complete: true }).order, null, 'only at town')
    SHOP.setExpeditionAsk(() => ({ ok: false, why: 'cooldown' }))
    assert.deepEqual(SHOP.buildOrder({ ...base, complete: true, record: { plot: 'treefarm' } }), { order: null, skip: 'complete' })
    SHOP.setExpeditionAsk(() => { throw new Error('boom') })
    assert.deepEqual(SHOP.buildOrder({ ...base, complete: true, record: { plot: 'treefarm' } }), { order: null, skip: 'complete' }, 'a throwing ask never breaks the order')
  } finally { SHOP.setExpeditionAsk(null) }
})

await t('MUTANT KILLED: buildOrder asking with an open project would send builders away', async () => {
  await withMutant(SHOP_PATH, "if (buildIdle({ complete, record, lastStop: state.lastStop }) && expeditionAskOf) {", 'if (expeditionAskOf) {', async M => {
    M.setExpeditionAsk(() => ({ ok: true, phase: 'trip' }))
    const r = M.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: 1e12, complete: false, record: { plot: 'treefarm' }, state: { lastStop: 'deadline', lastAt: 0 } })
    assert.equal(r.order?.args?.expedition, true, 'the mutant does send the builder out, so the test above has teeth')
  })
})

await t('the ring grows with trips that reached it and came home, shrinks on late ones, stays in [100, 300]', async () => {
  assert.equal(E.ringOf([], 0), 100)
  const ok = { returned: true, reason: 'reached' }
  assert.equal(E.ringOf([ok, ok, ok], 0), 175)
  assert.equal(E.ringOf(Array(20).fill(ok), 0), 300)
  assert.equal(E.ringOf([ok, ok, { returned: false, t: 0 }], 1000), 100)
  assert.equal(E.ringOf([ok, ok, ok, ok, { returned: false, t: 0 }], 48 * 60 * 60_000), 200, 'a late trip older than 24 h is forgiven')
})

await t('the bearing: fans out over the least-travelled, skips one blocked early by water, reuses a good one every other trip', async () => {
  const now = 1e9
  assert.deepEqual(E.tripBearing([], now), { bearing: 0, reuse: false })
  const t1 = [{ t: now - 1, bearing: 0, dist: 20, reason: 'water', returned: true, haul: 0 }]
  const b1 = E.tripBearing(t1, now)
  assert.notEqual(b1.bearing, 0, 'the water bearing is blocked for the day')
  assert.equal(b1.reuse, false, 'nothing good to reuse yet')
  const t2 = [{ t: now - 2, bearing: 3, dist: 120, reason: 'reached', returned: true, haul: 6 }]
  assert.deepEqual(E.tripBearing(t2, now), { bearing: 3, reuse: true }, 'odd count: the good bearing again (its markers walked)')
  const t3 = [...t2, { t: now - 1, bearing: 3, dist: 130, reason: 'reached', returned: true, haul: 4 }]
  const b3 = E.tripBearing(t3, now)
  assert.equal(b3.reuse, false); assert.notEqual(b3.bearing, 3, 'even count: a fresh spoke')
  const all = Array.from({ length: 8 }, (_, k) => ({ t: now - 1, bearing: k, dist: 10, reason: 'zone' }))
  assert.equal(E.tripBearing(all, now).bearing, null)
})

await t('the surface read: canopy passed through, a lake is water, unread is null', async () => {
  const leaves = { name: 'oak_leaves', boundingBox: 'block' }
  const r = world({ blocks: { '5,74,5': leaves, '5,73,5': leaves, '5,72,5': { name: 'oak_log', boundingBox: 'block' } }, lake: { x0: 20, x1: 30, z0: -5, z1: 5 } })
  assert.deepEqual(E.surfaceAt(r, 1, 1, 70), { y: 70, ground: 'grass_block', water: false })
  assert.equal(E.surfaceAt(r, 5, 5, 70).y, 70, 'under the canopy')
  assert.equal(E.surfaceAt(r, 25, 0, 70).water, true)
  assert.equal(E.surfaceAt(() => null, 1, 1, 70), null)
})

await t('a leg never crosses water: it bends round a lake, and a lake across every bend turns the trip (no bridging)', async () => {
  const pos = { x: 0, y: 70, z: 0 }
  const narrow = world({ lake: { x0: 10, x1: 25, z0: -3, z1: 3 } })
  const lt = E.legTarget(narrow, { pos, home: { x: -100, y: 70, z: 0 }, bearing: 0 })
  assert.equal(lt.ok, true)
  assert.notEqual(lt.bend, 0, 'straight ahead is the lake')
  assert.ok(Math.abs(lt.target.z) > 3, 'the target is off the water')
  const wide = world({ lake: { x0: 5, x1: 60, z0: -60, z1: 60 } })
  assert.deepEqual(E.legTarget(wide, { pos, home: { x: -100, y: 70, z: 0 }, bearing: 0 }), { ok: false, why: 'water' })
})

await t('MUTANT KILLED: a line check blind to water would walk the bot into the lake', async () => {
  await withMutant(EX_PATH, "    if (s.water) return { ok: false, why: 'water', at: [x, z] }\n", '', async M => {
    const wide = world({ lake: { x0: 5, x1: 60, z0: -60, z1: 60 } })
    assert.equal(M.lineClear(wide, { x: 0, y: 70, z: 0 }, { x: 20, y: 70, z: 0 }).ok, true, 'the mutant passes the lake')
  })
})

await t('a protected zone (+8) is never entered by a leg, nor a marker put in it', async () => {
  const zones = [{ id: 'village', box: [30, -64, -40, 140, 90, 40] }]
  const r = world()
  assert.equal(E.zoneHit(zones, 25, 0), 'village', 'the margin')
  assert.equal(E.zoneHit(zones, 21, 0), null)
  assert.deepEqual(E.legTarget(r, { pos: { x: 10, y: 70, z: 0 }, home: { x: -100, y: 70, z: 0 }, bearing: 0, zones }), { ok: false, why: 'zone' }, 'a village across the bearing turns the trip')
  const small = [{ id: 'hut', box: [40, -64, -5, 60, 90, 5] }]
  const lt = E.legTarget(r, { pos: { x: 15, y: 70, z: 0 }, home: { x: -100, y: 70, z: 0 }, bearing: 0, zones: small })
  assert.equal(lt.ok, true)
  assert.ok(E.lineClear(r, { x: 15, y: 70, z: 0 }, lt.target, { zones: small }).ok)
  assert.equal(Math.abs(lt.bend), 50, 'bent round the zone')
  assert.equal(E.markerSpot(r, [30, 70, 0], { dx: 1, dz: 0 }, { zones }), null)
})

await t('a known marker on the way is walked to (reuse) instead of a fresh cell', async () => {
  const r = world()
  const m = { at: [62, 70, 2], approach: [61, 70, 1] }
  const lt = E.legTarget(r, { pos: { x: 42, y: 70, z: 0 }, home: HOME, bearing: 0, markers: [m] })
  assert.equal(lt.via, 'marker'); assert.deepEqual(lt.target, { x: 61, y: 70, z: 1 })
  const behind = { at: [30, 70, 0], approach: [31, 70, 0] }
  assert.equal(E.legTarget(r, { pos: { x: 42, y: 70, z: 0 }, home: HOME, bearing: 0, markers: [behind] }).via, 'bearing', 'never one behind the bot')
})

await t('turn reasons: danger first, then the ring, then the clock, then two refused legs', async () => {
  assert.equal(E.turnReason({}), null)
  assert.equal(E.turnReason({ health: 10, dist: 500 }), 'health')
  assert.equal(E.turnReason({ food: 4 }), 'food')
  assert.equal(E.turnReason({ freeSlots: 1 }), 'bag_full')
  assert.equal(E.turnReason({ timeOfDay: 12_500 }), 'night')
  assert.equal(E.turnReason({ inWater: true }), 'water')
  assert.equal(E.turnReason({ dist: 100, ring: 100 }), 'reached')
  assert.equal(E.turnReason({ elapsedMs: 70_000, outMs: 66_000 }), 'time')
  assert.equal(E.turnReason({ legFails: 2 }), 'blocked')
})

await t('A WHOLE TRIP, composed: legs out to the ring with crumbs and markers, then the return cursor falls to 0 in hops <= 28', async () => {
  const r = world({ lake: { x0: 50, x1: 62, z0: -4, z1: 4 } })
  const markers = []
  const crumbs = [[0, 70, 0]]
  let pos = { x: 0, y: 70, z: 0 }, since = 0, reason = null, legs = 0
  while (!(reason = E.turnReason({ dist: Math.hypot(pos.x, pos.z), ring: 100 })) && legs < 30) {
    const lt = E.legTarget(r, { pos, home: HOME, bearing: 0, markers })
    assert.ok(lt.ok, `leg ${legs} refused: ${lt.why}`)
    assert.ok(E.lineClear(r, pos, lt.target).ok, 'every leg walked is clear of water')
    since += Math.hypot(lt.target.x - pos.x, lt.target.z - pos.z)
    pos = lt.target
    const cell = [pos.x, pos.y, pos.z]
    if (E.crumbDue(crumbs, cell, r)) crumbs.push(cell)
    if (E.markerDue({ pos, home: HOME, sinceLast: since, markers })) {
      const spot = E.markerSpot(r, cell, E.bearingVec(0))
      assert.ok(spot, 'a marker spot beside the route')
      markers.push({ at: spot, approach: cell }); since = 0
    }
    legs++
  }
  assert.equal(reason, 'reached')
  assert.ok(markers.length >= 1 && markers.every(m => Math.hypot(m.at[0], m.at[2]) >= E.MARKER_MIN_HOME))
  for (let i = 1; i < markers.length; i++) assert.ok(Math.hypot(markers[i].at[0] - markers[i - 1].at[0], markers[i].at[2] - markers[i - 1].at[2]) >= E.MARKER_SPACING)
  // back: hop by hop over the crumbs
  let cursor = crumbs.length, here = { x: pos.x, z: pos.z }, hops = 0
  for (;;) {
    const i = E.nextCrumb(crumbs, here, cursor)
    if (i < 0) break
    assert.ok(i < cursor, 'the cursor only falls')
    assert.ok(Math.hypot(crumbs[i][0] - here.x, crumbs[i][2] - here.z) <= 28 + 1e-9 || i === cursor - 1, 'a hop is in reach (or the adjacent crumb)')
    here = { x: crumbs[i][0], z: crumbs[i][2] }; cursor = i; hops++
    if (i === 0) break
  }
  assert.equal(cursor, 0, 'home reached over the crumbs')
  assert.ok(hops >= 3)
})

await t('the return: a failed hop is skipped to the next crumb; an unloaded crumb is not planned to; a marker nearer home is the fallback', async () => {
  const crumbs = [[0, 70, 0], [20, 70, 0], [40, 70, 0], [60, 70, 0]]
  const pos = { x: 60, z: 0 }
  assert.equal(E.nextCrumb(crumbs, pos, 4), 2, 'the lowest in reach (40 is 20 away)')
  assert.equal(E.nextCrumb(crumbs, pos, 4, { skip: new Set([2]) }), 3, 'a failed hop: the adjacent one')
  assert.equal(E.nextCrumb(crumbs, pos, 4, { loaded: c => c[0] !== 40 }), 3)
  const m = E.markerHome([{ approach: [45, 70, 3] }, { approach: [80, 70, 0] }], { x: 60, z: 0 }, HOME)
  assert.deepEqual(m.approach, [45, 70, 3])
  assert.equal(E.markerHome([{ approach: [80, 70, 0] }], { x: 60, z: 0 }, HOME), null, 'never one further out')
})

await t('marker spots: beside the route (never ahead), not on sand, not by water; the pillar recognised', async () => {
  const r = world({ sand: [[50, 1]] })
  assert.deepEqual(E.markerSpot(r, [50, 70, 0], { dx: 1, dz: 0 }), [50, 70, -1], 'the left side (sand on the right is skipped first only if it comes first)')
  const r2 = world({ sand: [[50, -1], [50, 1]] })
  assert.deepEqual(E.markerSpot(r2, [50, 70, 0], { dx: 1, dz: 0 }), [49, 70, 0], 'both sides sand: behind, never ahead')
  const wet = world({ lake: { x0: 48, x1: 52, z0: -3, z1: -2 } })
  assert.notDeepEqual(E.markerSpot(wet, [50, 70, 0], { dx: 1, dz: 0 }), [50, 70, -1], 'not on a bank')
  const cob = { name: 'cobblestone', boundingBox: 'block' }
  assert.equal(E.pillarIs(world({ blocks: { '5,70,5': cob, '5,71,5': cob } }), [5, 70, 5]), true)
  assert.equal(E.pillarIs(world({ blocks: { '5,70,5': cob } }), [5, 70, 5]), false)
  assert.equal(E.markerDue({ pos: { x: 30, z: 0 }, home: HOME, sinceLast: 99 }), false, 'never in town')
  assert.equal(E.markerDue({ pos: { x: 80, z: 0 }, home: HOME, sinceLast: 40, markers: [{ at: [90, 70, 0] }] }), false, 'a standing one within 24')
  assert.equal(E.markerDue({ pos: { x: 80, z: 0 }, home: HOME, sinceLast: 40, markers: [{ at: [110, 70, 0] }] }), true)
})

await t('a natural tree is felled; a village beam (a log on cobble) or a bare post is not', async () => {
  const log = { name: 'spruce_log', boundingBox: 'block' }, lv = { name: 'spruce_leaves', boundingBox: 'block' }, cob = { name: 'cobblestone', boundingBox: 'block' }
  const tree = world({ blocks: { '5,70,5': log, '5,71,5': log, '5,72,5': log, '5,73,5': lv } })
  const t1 = E.naturalTree(tree, [5, 71, 5])
  assert.equal(t1.ok, true); assert.deepEqual(t1.base, [5, 70, 5]); assert.equal(t1.logs.length, 3)
  const beam = world({ blocks: { '5,69,5': cob, '5,70,5': log, '5,71,5': log, '5,72,5': lv } })
  assert.equal(E.naturalTree(beam, [5, 71, 5]).ok, false)
  const post = world({ blocks: { '5,70,5': log, '5,71,5': log } })
  assert.equal(E.naturalTree(post, [5, 70, 5]).why, 'no_leaves')
})

await t('MUTANT KILLED: without the soil test a village beam reads as a tree', async () => {
  await withMutant(EX_PATH, "  if (!SOIL.test(under?.name ?? '')) return { ok: false, why: `base_on_${under?.name ?? 'unread'}` }\n", '', async M => {
    const log = { name: 'spruce_log', boundingBox: 'block' }, lv = { name: 'spruce_leaves', boundingBox: 'block' }, cob = { name: 'cobblestone', boundingBox: 'block' }
    const beam = world({ blocks: { '5,69,5': cob, '5,70,5': log, '5,71,5': log, '5,72,5': lv } })
    assert.equal(M.naturalTree(beam, [5, 71, 5]).ok, true)
  })
})

await t('the haul is the bag gained less the kit, and the markers\' cobble and torches are not banked; the kit draws only for a thin bag', async () => {
  const h = E.haulOf({ cobblestone: 2, oak_log: 1 }, { cobblestone: 10, oak_log: 7, spruce_sapling: 1, torch: 3 }, { cobblestone: 12, torch: 6 })
  assert.deepEqual(h, { oak_log: 6, spruce_sapling: 1 })
  assert.deepEqual(E.bankableHaul({ oak_log: 6, cobblestone: 4, torch: 1 }), { oak_log: 6 })
  assert.deepEqual(E.kitNeed({ cobblestone: 64, torch: 0 }), { torch: 6 })
  // matsBank banks the bag ABOVE its baseline: the baseline is the bag less the haul, so the haul is what goes (Codex r1 BLOCK 1)
  const base = E.depositBase({ oak_log: 9, cobblestone: 20 }, { oak_log: 6 })
  assert.deepEqual(base, { oak_log: 3, cobblestone: 20 })
  assert.equal(9 - base.oak_log, 6, 'the bankable amount above the baseline is the haul')
  assert.deepEqual(E.kitNeed({ cobblestone: 1, torch: 2 }), { cobblestone: 11 })
  assert.deepEqual(E.kitNeed({}, E.KIT, false), {})
  assert.ok(E.tripDetail({ id: 'x', haul: { oak_log: 3 } }).length < 300)
})

await t('WIRED: buildShop dispatches the expedition, home follows the trail first, features installs the ask, the ask is set', async () => {
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.equal(sk.split('if (args?.expedition === true) return expeditionVisit(ctx, args, signal)').length, 2)
  assert.equal(sk.split('try { await expeditionHomeLeg(ctx, signal, deadline - 60_000) }').length, 2)
  assert.equal(sk.split('if (EXPEDITION.on) setExpeditionAsk(expeditionAsk)').length, 2)
  const homeAt = sk.indexOf('async function home(ctx, _args, signal) {')
  const hookAt = sk.indexOf('await expeditionHomeLeg(ctx, signal, deadline - 60_000)')
  assert.ok(homeAt > 0 && hookAt > homeAt && hookAt - homeAt < 1500, 'the hook is at the top of home')
  const ft = strip(readFileSync(FEAT_PATH, 'utf8'))
  assert.equal(ft.split('try { expeditionInstall(bot) }').length, 2)
})

console.log(`\nexpedition: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
