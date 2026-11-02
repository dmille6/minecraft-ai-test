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
  assert.equal(E.ringOf([ok, ok, { returned: false, t: 0, dist: 80, ring: 150 }], 1000), 100)
  assert.equal(E.ringOf([ok, ok, ok, ok, { returned: false, t: 0, dist: 80, ring: 150 }], 48 * 60 * 60_000), 200, 'a late trip older than 24 h is forgiven')
  // wholemap-s1a: a late close NEAR TOWN (under half its ring: a stuck in the streets) is no sign the ring is too far
  assert.equal(E.ringOf([ok, ok, { returned: false, t: 0, dist: 12, ring: 150 }], 1000), 150)
})

await t('the bearing: fans out over the least-travelled, skips one blocked early by water, reuses a good one every other trip', async () => {
  const now = 1e9
  assert.deepEqual(E.tripBearing([], now), { bearing: 0, reuse: false })
  const t1 = [{ t: now - 1, v: 2, bearing: 0, dist: 20, reason: 'water', returned: true, haul: 0 }]
  const b1 = E.tripBearing(t1, now)
  assert.notEqual(b1.bearing, 0, 'the water bearing is blocked for the day')
  assert.equal(b1.reuse, false, 'nothing good to reuse yet')
  const t2 = [{ t: now - 2, v: 2, bearing: 3, dist: 120, reason: 'reached', returned: true, haul: 6 }]
  assert.deepEqual(E.tripBearing(t2, now), { bearing: 3, reuse: true }, 'odd count: the good bearing again (its markers walked)')
  const t3 = [...t2, { t: now - 1, v: 2, bearing: 3, dist: 130, reason: 'reached', returned: true, haul: 4 }]
  const b3 = E.tripBearing(t3, now)
  assert.equal(b3.reuse, false); assert.notEqual(b3.bearing, 3, 'even count: a fresh spoke')
  const all = Array.from({ length: 8 }, (_, k) => ({ t: now - 1, v: 2, bearing: k, dist: 10, reason: 'zone' }))
  assert.equal(E.tripBearing(all, now).bearing, null)
  // wholemap-s1a: rows from the older planner (no v) never block a bearing -- it planned without zone heights or detours
  assert.notEqual(E.tripBearing(all.map(({ v, ...r }) => r), now).bearing, null)
})

await t('the surface read: canopy passed through, a lake is water, unread is null', async () => {
  const leaves = { name: 'oak_leaves', boundingBox: 'block' }
  const r = world({ blocks: { '5,74,5': leaves, '5,73,5': leaves, '5,72,5': { name: 'oak_log', boundingBox: 'block' } }, lake: { x0: 20, x1: 30, z0: -5, z1: 5 } })
  assert.deepEqual(E.surfaceAt(r, 1, 1, 70), { y: 70, ground: 'grass_block', water: false })
  assert.equal(E.surfaceAt(r, 5, 5, 70).y, 70, 'under the canopy')
  assert.equal(E.surfaceAt(r, 25, 0, 70).water, true)
  assert.equal(E.surfaceAt(() => null, 1, 1, 70), null)
  const trunk = world({ blocks: Object.fromEntries([69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82].map(y => [`3,${y},3`, { name: 'spruce_log', boundingBox: 'block' }])) })
  assert.deepEqual(E.surfaceAt(trunk, 3, 3, 70, { up: 12, down: 2 }), { none: true, obstructed: true }, 'a trunk column: read, but nowhere to stand')
})

await t('a leg never crosses water: it bends round a lake, and a lake across every bend turns the trip (no bridging)', async () => {
  const pos = { x: 0, y: 70, z: 0 }
  const narrow = world({ lake: { x0: 10, x1: 25, z0: -3, z1: 3 } })
  const lt = E.legTarget(narrow, { pos, home: { x: -100, y: 70, z: 0 }, bearing: 0 })
  assert.equal(lt.ok, true)
  assert.notEqual(lt.bend, 0, 'straight ahead is the lake')
  assert.ok(Math.abs(lt.target.z) > 3, 'the target is off the water')
  const wide = world({ lake: { x0: 5, x1: 60, z0: -60, z1: 60 } })
  const lw = E.legTarget(wide, { pos, home: { x: -100, y: 70, z: 0 }, bearing: 0 })
  assert.equal(lw.ok, false); assert.equal(lw.why, 'water')
})

await t('MUTANT KILLED: a line check blind to water would walk the bot into the lake', async () => {
  await withMutant(EX_PATH, "    if (s.water) return { ok: false, why: 'water', at: [x, z] }\n", '', async M => {
    const wide = world({ lake: { x0: 5, x1: 60, z0: -60, z1: 60 } })
    assert.equal(M.lineClear(wide, { x: 0, y: 70, z: 0 }, { x: 20, y: 70, z: 0 }).ok, true, 'the mutant passes the lake')
  })
})

await t('LIVE 17:40Z: a tree trunk on the line does not close it (only water and zones do)', async () => {
  const blocks = {}
  for (let y = 69; y <= 90; y++) blocks[`9,${y},0`] = { name: 'spruce_log', boundingBox: 'block' }
  const r = world({ blocks })
  assert.deepEqual(E.lineClear(r, { x: 0, y: 70, z: 0 }, { x: 18, y: 70, z: 0 }), { ok: true })
  assert.equal(E.legTarget(r, { pos: { x: 40, y: 70, z: 0 }, home: HOME, bearing: 0 }).ok, true)
})

await t('Codex r7: a ravine over water below the scan window closes the line (a drop, not a trunk)', async () => {
  const base = world()
  const r = (x, y, z) => {
    if (x >= 43 && x <= 55) { if (y === 45) return { name: 'water', boundingBox: 'empty' }; if (y < 45) return { name: 'stone', boundingBox: 'block' }; return { name: 'air', boundingBox: 'empty' } }
    return base(x, y, z)
  }
  const lc = E.lineClear(r, { x: 40, y: 70, z: 0 }, { x: 60, y: 70, z: 0 })
  assert.equal(lc.ok, false); assert.equal(lc.why, 'drop')
})

await t('a protected zone (+8) is never entered by a leg, nor a marker put in it', async () => {
  const zones = [{ id: 'village', box: [30, -64, -40, 140, 90, 40] }]
  const r = world()
  assert.equal(E.zoneHit(zones, 25, 0), 'village', 'the margin')
  assert.equal(E.zoneHit(zones, 21, 0), null)
  const lz = E.legTarget(r, { pos: { x: 10, y: 70, z: 0 }, home: { x: -100, y: 70, z: 0 }, bearing: 0, zones })
  // wholemap-s1a: a village across the bearing is walked ROUND (a detour), never into
  assert.equal(lz.ok, true); assert.equal(lz.via, 'detour', 'a village across the bearing is detoured')
  assert.equal(E.zoneHit(zones, lz.target.x, lz.target.z), null)
  // ... and with the lake round it on both sides, the trip turns for the zone
  const moat = world({ lake: { x0: 12, x1: 200, z0: -200, z1: 200 } })
  const lm = E.legTarget(moat, { pos: { x: 10, y: 70, z: 0 }, home: { x: -100, y: 70, z: 0 }, bearing: 0, zones })
  assert.equal(lm.ok, false); assert.ok(['zone', 'water'].includes(lm.why))
  const small = [{ id: 'hut', box: [40, -64, -5, 60, 90, 5] }]
  const lt = E.legTarget(r, { pos: { x: 15, y: 70, z: 0 }, home: { x: -100, y: 70, z: 0 }, bearing: 0, zones: small })
  assert.equal(lt.ok, true)
  assert.ok(E.lineClear(r, { x: 15, y: 70, z: 0 }, lt.target, { zones: small }).ok)
  assert.equal(Math.abs(lt.bend), 50, 'bent round the zone')
  assert.equal(E.markerSpot(r, [30, 70, 0], { dx: 1, dz: 0 }, { zones }), null)
})

await t('LIVE 17:20Z: a bot west of home on an east bearing walks out along the spoke (it is not "inward")', async () => {
  const lt = E.legTarget(world(), { pos: { x: -11.6, y: 71, z: 1.5 }, home: HOME, bearing: 0 })
  assert.equal(lt.ok, true, lt.why)
  assert.ok(lt.target.x >= 55 && Math.abs(lt.target.z) <= 1, `on the spoke, past the town: ${JSON.stringify(lt.target)}`)
  const lt2 = E.legTarget(world(), { pos: { x: 40.5, y: 70, z: 6 }, home: HOME, bearing: 0 })
  assert.ok(lt2.target.x >= 60 && Math.abs(lt2.target.z) <= 1, 'drifted off the spoke: back onto it')
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

// ---- WHOLEMAP-S1a (docs/reports/wholemap-expeditions-design-2026-11-01.md section 4 S1 items 1-3, 5, 6) ------------------------
const ZFILE = JSON.parse(readFileSync(new URL('../../infra/showcase/protected-zones.showcase.json', import.meta.url), 'utf8'))
const CHAMBERS = { id: 'trial-chambers', box: [-20, -64, 65, 88, 31, 164] }    // design section 1.4 (owner 10-21 #18)
const SHOW_ZONES = [...ZFILE.zones, CHAMBERS]
const VILLAGE_E = ZFILE.zones.find(z => z.id === 'village-taiga-6_1')
/** Walk the out legs in a synthetic world (each leg's target is where the bot stands next) -> { dist, legs, entered, why, detours }. */
function walkOut (E2, read, bearing, zones, { max = 60, ring = 300 } = {}) {
  let pos = { x: 0.5, y: 70, z: 0.5 }, detour = null, entered = null, why = null, detours = 0, dist = 0, legs = 0
  for (; legs < max; legs++) {
    const lt = E2.legTarget(read, { pos, home: HOME, bearing, zones, detour })
    if (!lt.ok) { why = lt.why; break }
    const nd = lt.detour?.waypoints?.length ? lt.detour : null
    if (nd && !detour) detours++
    detour = nd
    // every block of the leg, at the walk's height: never inside a zone (+ margin) that is not under the walk
    const n = Math.ceil(Math.hypot(lt.target.x - pos.x, lt.target.z - pos.z))
    for (let i = 0; i <= n && !entered; i++) {
      const x = Math.floor(pos.x + (lt.target.x - pos.x) * i / n), z = Math.floor(pos.z + (lt.target.z - pos.z) * i / n)
      const id = E2.zoneHit(zones, x, z, E2.ZONE_MARGIN, { surfaceY: 70 })
      if (id) entered = `${id}@${x},${z}`
    }
    pos = { x: lt.target.x + 0.5, y: lt.target.y, z: lt.target.z + 0.5 }
    dist = Math.max(dist, Math.hypot(pos.x - HOME.x, pos.z - HOME.z))
    if (dist >= ring) break
  }
  return { dist, legs, entered, why, detours }
}

await t('wholemap-s1a item 2: a zone UNDER the walk (the trial chambers, top y 31 under grass at 70) is walked over; a village is not', async () => {
  assert.equal(E.zoneHit([CHAMBERS], 30, 100, E.ZONE_MARGIN, { surfaceY: 70 }), null, 'over the chambers on the grass')
  assert.equal(E.zoneHit([CHAMBERS], 30, 100, E.ZONE_MARGIN, { surfaceY: 35 }), 'trial-chambers', 'a walk down near their roof')
  assert.equal(E.zoneHit([CHAMBERS], 30, 100), 'trial-chambers', 'no height: every zone at every height (markers, digs)')
  assert.equal(E.zoneHit([VILLAGE_E], 100, 0, E.ZONE_MARGIN, { surfaceY: 70 }), VILLAGE_E.id, 'the village box reaches y 90')
  const r = world()
  const lt = E.legTarget(r, { pos: { x: 0.5, y: 70, z: 60.5 }, home: HOME, bearing: 2, zones: [CHAMBERS] })
  assert.equal(lt.ok, true); assert.equal(lt.via, 'bearing'); assert.equal(lt.bend, 0, 'straight on over the chambers')
})

await t('MUTANT KILLED: zoneHit blind to height refuses the grass over the chambers again (38 trips on bearing 2)', async () => {
  await withMutant(EX_PATH, '    if (Number.isFinite(surfaceY) && b[4] <= surfaceY - ZONE_UNDER) continue\n', '', async M => {
    assert.equal(M.zoneHit([CHAMBERS], 30, 100, M.ZONE_MARGIN, { surfaceY: 70 }), 'trial-chambers')
    const w = walkOut(M, world(), 2, [CHAMBERS])
    assert.ok(w.dist < 300, `the mutant stops short of 300 on bearing 2 (dist ${Math.round(w.dist)})`)
  })
})

await t('wholemap-s1a items 2+3: on the showcase zones, every one of the 8 bearings walks out past 300 on flat ground, never into a zone', async () => {
  const r = world()
  for (let k = 0; k < 8; k++) {
    const w = walkOut(E, r, k, SHOW_ZONES)
    assert.equal(w.entered, null, `bearing ${k} entered ${w.entered}`)
    assert.ok(w.dist >= 300, `bearing ${k} reached ${Math.round(w.dist)} (${w.why})`)
    if (k === 0) assert.ok(w.detours >= 1, 'bearing 0 walks round the east village (1 and 7 clip its corner: bends suffice)')
  }
})

await t('MUTANT KILLED: without the detour, the east village closes bearing 0 again', async () => {
  await withMutant(EX_PATH, "  if (whys.includes('zone')) {\n", '  if (false) {\n', async M => {
    const r = world()
    assert.ok(walkOut(M, r, 0, SHOW_ZONES).dist < 300, 'the mutant turns on bearing 0')
  })
})

await t('wholemap-s1a item 3: the detour takes the shorter side, and the other side when that one is refused (a lake)', async () => {
  const d = E.zoneDetour([VILLAGE_E], HOME, 0, { y: 70 })
  assert.equal(d.zone, VILLAGE_E.id)
  const g = E.ZONE_MARGIN + E.DETOUR_PAD
  assert.deepEqual(d.waypoints[0], [VILLAGE_E.box[0] - g, VILLAGE_E.box[5] + g], 'the near corner on the short (+z) side')
  assert.equal(d.waypoints.at(-1)[1], 0, 'back on the spoke past the exit')
  assert.ok(d.waypoints.at(-1)[0] > VILLAGE_E.box[3] + g)
  const o = E.zoneDetour([VILLAGE_E], HOME, 0, { y: 70, side: -d.side })
  assert.equal(o.waypoints[0][1], VILLAGE_E.box[2] - g, 'the other side: the -z corner')
  assert.equal(E.zoneDetour([CHAMBERS], HOME, 2, { y: 70 }), null, 'a zone under the walk needs no detour')
  // a lake along the short side: the walk goes round the other way
  const r = world({ lake: { x0: 20, x1: 200, z0: 40, z1: 90 } })
  const w = walkOut(E, r, 0, [VILLAGE_E])
  assert.equal(w.entered, null); assert.ok(w.dist >= 300, `round the -z side (${Math.round(w.dist)}, ${w.why})`)
})

await t('MUTANT KILLED: a detour leg that need not close on its waypoint zigzags along the lake shore and never gets round', async () => {
  await withMutant(EX_PATH, "    if (L - Math.hypot(wx - x, wz - z) < Math.max(2, 0.1 * len * f)) { whys.push('no_progress'); continue }\n", '', async M => {
    const r = world({ lake: { x0: 20, x1: 200, z0: 40, z1: 90 } })
    assert.ok(walkOut(M, r, 0, [VILLAGE_E]).dist < 300, 'the mutant wanders')
  })
})

await t('wholemap-s1a item 1: a bearing is dead after two obstacle turns short of the ring at any distance (the 54-55 loop), not after one', async () => {
  const now = 1e9
  const z = (d, extra = {}) => ({ t: now - 1, v: 2, bearing: 2, dist: d, ring: 100, reason: 'zone', returned: true, haul: 0, ...extra })
  assert.deepEqual([...E.deadBearings([z(55)])], [], 'one turn at 55: not yet')
  assert.deepEqual([...E.deadBearings([z(55), z(54)])], [2], 'two: dead for the day')
  assert.deepEqual([...E.deadBearings([z(30)])], [2], 'one turn before 40, as before')
  assert.deepEqual([...E.deadBearings([z(55), z(120, { reason: 'reached' })])], [], 'a reached trip is no obstacle')
  assert.deepEqual([...E.deadBearings([z(55), z(260, { ring: 300 })])], [2], 'short of the ring is short of the ring')
  const day = [z(55), z(54)]
  assert.notEqual(E.tripBearing(day, now).bearing, 2)
})

await t('MUTANT KILLED: without the two-strike rule, the zone loop on one bearing is chosen again and again', async () => {
  await withMutant(EX_PATH, '  for (const [k, c] of n) if (c >= DEAD_TURNS) out.add(k)\n', '', async M => {
    const now = 1e9
    const day = Array.from({ length: 7 }, (_, i) => ({ t: now - 10 + i, v: 2, bearing: (i + 3) % 8, dist: 200, ring: 150, reason: 'reached', returned: true, haul: 0 }))
      .concat([0, 1].map(i => ({ t: now - 2 + i, v: 2, bearing: 2, dist: 55, ring: 100, reason: 'zone', returned: true, haul: 0 })))
    assert.equal(M.deadBearings(day).has(2), false)
    assert.equal(E.deadBearings(day).has(2), true)
  })
})

await t('wholemap-s1a item 5: no marker torch within 3 of ice (packed / blue ice do not melt); an unread cube refuses', async () => {
  const at = [10, 72, 10]
  const ice = (x, y, z) => world({ blocks: { [`${x},${y},${z}`]: { name: 'ice', boundingBox: 'block' } } })
  assert.equal(E.torchSafe(world(), at), true)
  assert.equal(E.torchSafe(ice(12, 69, 11), at), false, 'ice 2-3 below and beside')
  assert.equal(E.torchSafe(ice(13, 69, 13), at), false, 'the cube corner')
  assert.equal(E.torchSafe(ice(14, 69, 10), at), true, 'four away')
  assert.equal(E.torchSafe(world({ blocks: { '11,69,10': { name: 'packed_ice', boundingBox: 'block' } } }), at), true)
  assert.equal(E.torchSafe(() => null, at), false)
})

await t('MUTANT KILLED: a torch check blind to ice lights the frozen lake', async () => {
  await withMutant(EX_PATH, "    if (/^(ice|frosted_ice)$/.test(q.name ?? '')) return false\n", '', async M => {
    assert.equal(M.torchSafe(world({ blocks: { '11,69,10': { name: 'ice', boundingBox: 'block' } } }), [10, 72, 10]), true)
  })
})

await t('wholemap-s1a item 6: a ring past one call is a multi-call trip (more of the call out); its trail home in a later call counts', async () => {
  assert.equal(E.multiCall(225), false); assert.equal(E.multiCall(250), true)
  assert.equal(E.outShareOf(150), E.OUT_SHARE); assert.equal(E.outShareOf(300), E.LONG_OUT_SHARE)
  const ok = { returned: true, reason: 'reached' }
  const six = Array(6).fill(ok)                                   // 100 + 6 x 25 = 250
  assert.equal(E.ringOf(six, 0), 250)
  const viaTrail = { t: 0, multi: true, returned: false, late: true, via: 'home_crumbs', reason: 'reached', dist: 260, ring: 250 }
  assert.equal(E.ringOf([...six, viaTrail], 1000), 275, 'home over its own trail next call: a success, the ring grows')
  const lost = { t: 0, multi: true, returned: false, late: true, via: 'later', reason: 'reached', dist: 260, ring: 250 }
  assert.equal(E.ringOf([...six, lost], 1000), 200, 'back some other way: still a late trip')
  assert.equal(E.ringOf(Array(12).fill(ok), 0), E.RING_MAX, 'growth 100 -> 300, capped')
  assert.equal(E.trailAge({ startedAt: 0, trailAt: 5_000 }, 6_000), 1_000, 'the trail TTL runs from its last walked leg')
  assert.equal(E.trailAge({ startedAt: 1_000 }, 6_000), 5_000)
  // Claude r1 BLOCK: a trip stuck out of town (its hops never arrive, so trailAt stays old) -- and past TRIP_MAX_MS from its
  // start, whatever trailAt says -- is past every TTL: it no longer holds an expedition slot
  assert.equal(E.trailAge({ startedAt: 0, trailAt: 13 * 3_600_000 - 1_000 }, 13 * 3_600_000), Infinity)
})

await t('MUTANT KILLED: a ring penalty for every late close keeps the ring at 100 (stucks in the streets)', async () => {
  await withMutant(EX_PATH, '      (Number(t?.dist) || 0) >= (Number(t?.ring) || RING_MIN) / 2) r -= 2 * RING_STEP\n', '      true) r -= 2 * RING_STEP\n', async M => {
    assert.equal(M.ringOf([{ returned: true, reason: 'reached' }, { returned: true, reason: 'reached' }, { returned: false, t: 0, dist: 12, ring: 150 }], 1000), 100)
  })
})

await t('wholemap-s1a wiring (structural): the visit carries the detour leg to leg, checks ice before a torch, sizes the out share by the ring, rows carry v', async () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (re, what) => assert.equal((src.match(re) ?? []).length, 1, what)
  one(/legTarget\(read, \{ pos: p, home, bearing: trip\.bearing, markers, zones, detour: trip\.detour \}\)/g, 'legTarget gets the trip detour')
  one(/trip\.detour = dNext/g, 'the detour is kept')
  one(/const iceOk = torchSafe\(read, \[x, y \+ 2, z\]\)/g, 'the ice check')
  one(/if \(iceOk && \(heldMap\(bot\)\.torch \?\? 0\) > 0\) \{/g, 'the torch waits for it')
  one(/const outMs = \(deadline - tOut\) \* outShareOf\(trip\.ring\)/g, 'the out share')
  one(/v: trip\.v, multi: trip\.multi === true/g, 'the returned row')
  one(/if \(trailAge\(trip, Date\.now\(\)\) > TRAIL_TTL_MS \|\| exAtHome\(p\)\) return null/g, 'home follows by trail age')
  one(/if \(arrived\) trip\.trailAt = Date\.now\(\)/g, 'only an arrived hop freshens the trail')
  one(/if \(moved >= 4\) trip\.trailAt = Date\.now\(\)/g, 'only a leg that moved freshens it outbound')
  assert.ok(!/trip\.trailAt = Date\.now\(\)\n\s*persist\(\)/.test(src), 'no unconditional stamp in the walk home')
  assert.equal(E.PLANNER_V, 2)
})

console.log(`\nexpedition: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
