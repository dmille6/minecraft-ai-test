// BRIDGEPOST-01: COBBLE BRIDGES AT REFUSED CROSSINGS (bots/src/bridge.mjs, bridgeio.mjs; expedition.mjs bridgeLeg / beyondGain;
// skills.mjs expeditionVisit). Behaviour on synthetic worlds: a lake's span is read (level and one-up shores; a high bank, lava, a zone,
// over-wide water refused); every planned block is clicked from the deck already built with the walkway's rails placed before the
// builder steps forward; the builder over a simulated world finishes a walkable bridge, resumes a half-built one from what stands, stops
// wet and on a body in the cell; a site must OPEN the way and be reached dry; sightings merge and a site is built after SITE_SEEN trips;
// a finished bridge is walked by the planner (and not walked back); bridge trips do not move the ring. Mutants assert their anchors
// present and unique (CLAUDE.md).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const B = await import('../src/bridge.mjs')
const E = await import('../src/expedition.mjs')
const IO = await import('../src/bridgeio.mjs')

const BR_PATH = new URL('../src/bridge.mjs', import.meta.url)
const EX_PATH = new URL('../src/expedition.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// A synthetic world: grass ground at y 69 (stand 70). A LAKE x [x0, x1] across z [z0, z1]: water 66..69 (surface 69: a level shore),
// stone below; `farUp`: the ground beyond the lake raised by this; `side`: a block put in every deck side cell; an overlay map holds
// placed blocks.
const AIR = { name: 'air', boundingBox: 'empty' }, STONE = { name: 'stone', boundingBox: 'block' }, GRASS = { name: 'grass_block', boundingBox: 'block' }
const WATER = { name: 'water', boundingBox: 'empty' }, COBBLE = { name: 'cobblestone', boundingBox: 'block' }
function world ({ x0 = 10, x1 = 21, z0 = -20, z1 = 20, farUp = 0, nearUp = 0, lava = null, islandTo = null } = {}) {
  const over = new Map()
  const base = (x, y, z) => {
    if (lava && x === lava[0] && z === lava[1] && y === 69) return { name: 'lava', boundingBox: 'empty' }
    const inLake = x >= x0 && x <= x1 && z >= z0 && z <= z1
    // islandTo: the land past the lake is an island ending at this x, water beyond to x 200 (a dead end)
    const inSea = islandTo != null && x > islandTo && z >= z0 && z <= z1
    if (inLake || inSea) return y >= 66 && y <= 69 ? WATER : y < 66 ? STONE : AIR
    const g = x > x1 ? 69 + farUp : x < x0 ? 69 + nearUp : 69
    return y <= g ? (y === g ? GRASS : STONE) : AIR
  }
  const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
  read.set = (c, b) => over.set(c.join(','), b)
  read.over = over
  return read
}
const NEAR = [9, 70, 0]

await t('THE SPAN of a level lake: 12 wet columns, deck at the surface, both ends level, the landing 3 inland', async () => {
  const r = world()
  const s = B.bridgeSpan(r, NEAR, [1, 0])
  assert.equal(s.ok, true, s.why); assert.equal(s.w, 12); assert.equal(s.wy, 69)
  assert.deepEqual(s.far, [22, 70, 0]); assert.deepEqual(s.land, [25, 70, 0])
  assert.equal(s.rows.length, 12); assert.deepEqual(s.rows[0].centre, [10, 69, 0])
  // a far shore ONE up is a walkable step; a near one up too
  assert.equal(B.bridgeSpan(world({ farUp: 1 }), NEAR, [1, 0]).ok, true)
  assert.equal(B.bridgeSpan(world({ nearUp: 1 }), [9, 71, 0], [1, 0]).ok, true)
})

await t('REFUSED: a high bank either side, lava in a side cell, a zone, water wider than BRIDGE_MAX (the controls pass above)', async () => {
  assert.equal(B.bridgeSpan(world({ farUp: 3 }), NEAR, [1, 0]).why, 'far_bank')
  assert.equal(B.bridgeSpan(world({ nearUp: 3 }), [9, 73, 0], [1, 0]).why, 'bank_high')
  assert.match(B.bridgeSpan(world({ lava: [14, 1] }), NEAR, [1, 0]).why, /^side_lava/)
  assert.equal(B.bridgeSpan(world(), NEAR, [1, 0], { zones: [{ id: 'v', box: [15, -64, 5, 30, 90, 30] }] }).why, 'zone')
  const wide = B.bridgeSpan(world({ x1: 10 + B.BRIDGE_MAX }), NEAR, [1, 0])
  assert.equal(wide.ok, false); assert.equal(wide.why, 'wide')
  assert.equal(B.bridgeSpan(world({ x1: 10 + B.BRIDGE_MAX - 1 }), NEAR, [1, 0]).ok, true, 'exactly BRIDGE_MAX is built')
})

await t('THE PLAN: every block is clicked onto one already built (or the shore), from the deck behind it, the rails before the step forward', async () => {
  const s = B.bridgeSpan(world(), NEAR, [1, 0])
  const plan = B.bridgePlan(s)
  assert.equal(plan.filter(p => p.kind !== 'torch').length, 5 * s.w, 'five blocks a row')
  const done = new Set([[9, 69, 0].join(',')])   // the near shore's ground
  const stands = new Set([NEAR.join(',')])
  for (const p of plan) {
    assert.ok(done.has(p.ref.join(',')), `the reference of ${p.kind} ${p.cell} is built first`)
    assert.ok(stands.has(p.stand.join(',')), `the stand of ${p.kind} ${p.cell} is a finished row (both rails placed)`)
    assert.ok(Math.hypot(p.cell[0] + 0.5 - (p.stand[0] + 0.5), p.cell[1] + 0.5 - (p.stand[1] + 1.62), p.cell[2] + 0.5 - (p.stand[2] + 0.5)) <= 4, 'in reach')
    done.add(p.cell.join(','))
    // a row's centre becomes a stand once its two rails are done
    const [cx, cy, cz] = [p.cell[0], 69, 0]
    if (p.kind === 'rail' && done.has(`${cx},70,-1`) && done.has(`${cx},70,1`)) stands.add(`${cx},70,0`)
  }
})

// A SIMULATED BUILDER over the synthetic world: a walk lands on a standable cell, a click lands when the reference is solid, the
// cell takes a block and the cell is within reach of the eye; `clock` advances per action
function sim (r, { feet = [...NEAR], wet = () => false, body = null, clock = { t: 0 } } = {}) {
  const standOk = c => B.blockDone(r(c[0], c[1] - 1, c[2])) && r(...c).boundingBox !== 'block'
  return {
    read: r, feet: () => feet, has: () => 999, now: () => clock.t, sleep: async () => {}, torchOk: () => true,
    inWater: wet,
    walkTo: async c => { clock.t += 500; if (standOk(c)) feet.splice(0, 3, ...c) },
    place: async s => {
      clock.t += 300
      if (body && body(s.cell)) return false
      const eye = [feet[0] + 0.5, feet[1] + 1.62, feet[2] + 0.5]
      if (Math.hypot(s.cell[0] + 0.5 - eye[0], s.cell[1] + 0.5 - eye[1], s.cell[2] + 0.5 - eye[2]) > 4.5) return false
      if (!B.blockDone(r(...s.ref)) || !B.placeableInto(r(...s.cell))) return false
      r.set(s.cell, s.kind === 'torch' ? { name: 'torch', boundingBox: 'empty' } : COBBLE)
      return true
    },
  }
}

await t('THE BUILDER finishes a walkable bridge; an interrupted build RESUMES from what stands (no stored progress)', async () => {
  const r = world()
  const plan = B.bridgePlan(B.bridgeSpan(r, NEAR, [1, 0]))
  const clock = { t: 0 }
  const io = sim(r, { clock })
  const a = await B.buildBridge(io, plan, { until: 8_000 })
  assert.equal(a.stop, 'time'); assert.ok(a.placed > 0 && a.placed < plan.length)
  assert.equal(B.bridgeIntact(r, plan), false, 'a half-built bridge is not intact')
  const io2 = sim(r, { clock, feet: [...NEAR] })   // a later trip, at the near end again
  const b = await B.buildBridge(io2, plan, { until: Infinity })
  assert.equal(b.stop, 'done', JSON.stringify(b))
  assert.equal(a.placed + b.placed, plan.length, 'every block placed exactly once over the two visits')
  assert.equal(B.bridgeIntact(r, plan), true)
  assert.deepEqual(B.bridgeNeed(r, plan), { cobblestone: 0, torch: 0 })
  // the deck reads as DRY GROUND to the expedition's own surface read, level with the shore
  const s = E.surfaceAt(r, 15, 0, 70)
  assert.equal(s.water, false); assert.equal(s.y, 70)
})

await t('THE BUILDER stops WET (it swims out; the next trip resumes) and on a body in the cell it does not place into', async () => {
  const r = world()
  const plan = B.bridgePlan(B.bridgeSpan(r, NEAR, [1, 0]))
  const w = await B.buildBridge(sim(r, { wet: () => true }), plan)
  assert.equal(w.stop, 'wet'); assert.equal(w.placed, 0)
  const b = await B.buildBridge(sim(r, { body: c => c[0] === 12 }), plan)
  assert.equal(b.stop, 'place_failed'); assert.equal(b.cell[0], 12, 'stops at the occupied cell'); assert.ok(b.placed >= 10)
  // the actuator's own body test: a squid in the cell, an item drop never
  assert.equal(IO.bodyOverlaps({ position: { x: 12.5, y: 68.6, z: 0.5 }, width: 0.8, height: 0.8 }, [12, 69, 0]), true)
  assert.equal(IO.bodyOverlaps({ position: { x: 14.5, y: 68.6, z: 0.5 }, width: 0.8, height: 0.8 }, [12, 69, 0]), false)
})

await t('THE SITE must OPEN the way and be reached dry: a dead-end island span is refused, an unreachable near end is refused', async () => {
  const home = { x: -100, y: 70, z: 0 }
  const bv = E.bearingVec(0)
  const open = world()
  const beyond = r => s => E.beyondGain(r, s, { home, bearing: 0, swim: 0 })
  const ok = B.bridgeSite(open, { x: 5.5, y: 70, z: 0.5 }, { home, bearingV: bv, beyond: beyond(open) })
  assert.equal(ok.ok, true, JSON.stringify(ok.tried)); assert.equal(ok.span.w, 12); assert.ok(ok.gain >= B.BEYOND_MIN)
  const dead = world({ islandTo: 26 })
  const no = B.bridgeSite(dead, { x: 5.5, y: 70, z: 0.5 }, { home, bearingV: bv, beyond: beyond(dead) })
  assert.equal(no.ok, false); assert.ok(no.tried.dead_end > 0, JSON.stringify(no.tried))
  const far = B.bridgeSite(open, { x: 5.5, y: 70, z: 0.5 }, { home, bearingV: bv, beyond: beyond(open), reach: () => false })
  assert.equal(far.ok, false); assert.ok(far.tried.unreached > 0)
})

await t('SIGHTINGS merge; a site is built after SITE_SEEN distinct trips; a complete site is a bridge the planner walks', async () => {
  const s = B.bridgeSpan(world(), NEAR, [1, 0])
  const moved = { ...s, near: [9, 70, 3] }
  const lines = [{ op: 'sight', span: s, bearing: 0, trip: 'a', t: 1 }]
  assert.equal(B.bridgeToBuild(B.bridgeSites(lines), 10), null, 'one sighting is not a site to build')
  lines.push({ op: 'sight', span: s, bearing: 0, trip: 'a', t: 2 })
  assert.equal(B.bridgeToBuild(B.bridgeSites(lines), 10), null, 'the same trip twice is one sighting')
  lines.push({ op: 'sight', span: moved, bearing: 0, trip: 'b', t: 3 })
  const sites = B.bridgeSites(lines)
  assert.equal(sites.length, 1, 'a near end 3 away on the same axis is the same site')
  const pick = B.bridgeToBuild(sites, 10)
  assert.ok(pick); assert.equal(pick.seen.size, 2)
  lines.push({ op: 'state', id: pick.id, complete: true, t: 4 })
  const done = B.bridgesDone(B.bridgeSites(lines))
  assert.equal(done.length, 1); assert.equal(B.bridgeToBuild(B.bridgeSites(lines), 10), null)
  // the tidy keeps off every planned cell of it
  assert.ok(B.bridgeCellKeys(B.bridgeSites(lines)).includes('10,69,0'))
  assert.equal(B.bridgeZones(B.bridgeSites(lines)).length, 1)
})

await t('THE PLANNER walks a finished bridge (no swim allowed: the control refuses), and never takes it back from the far side', async () => {
  const home = { x: -100, y: 70, z: 0 }
  const r = world()
  const span = B.bridgeSpan(r, NEAR, [1, 0])
  const pos = { x: 5.5, y: 70, z: 0.5 }
  const before = E.legTarget(r, { pos, home, bearing: 0 })
  assert.equal(before.ok, false, 'the control: dry legs turn at the lake')
  await B.buildBridge(sim(r), B.bridgePlan(span))
  const bridges = [{ id: 'x', near: span.near, far: span.far, land: span.land, axis: span.axis, w: span.w }]
  const a = E.legTarget(r, { pos, home, bearing: 0, bridges })
  assert.equal(a.ok, true); assert.ok(['bridge_in', 'bearing', 'bridge'].includes(a.via))
  const atNear = E.bridgeLeg(r, { pos: { x: 9.5, y: 70, z: 0.5 }, home, bridges })
  assert.equal(atNear.via, 'bridge'); assert.deepEqual([atNear.target.x, atNear.target.y, atNear.target.z], span.land); assert.deepEqual(atNear.shore, span.near)
  assert.equal(E.bridgeLeg(r, { pos: { x: 25.5, y: 70, z: 0.5 }, home, bridges }), null, 'not taken back from the landing')
  // both reviews r1 BLOCKER: goto (range 2) leaves the bot up to ~2.4 from the near end's centre: that is AT the bridge, not 'bridge_in' again
  for (const x of [7.4, 7.7, 8.2]) assert.equal(E.bridgeLeg(r, { pos: { x, y: 70, z: 0.5 }, home, bridges })?.via, 'bridge', `at x ${x}`)
  assert.equal(E.bridgeLeg(r, { pos: { x: 4.5, y: 70, z: 0.5 }, home, bridges })?.via, 'bridge_in', 'the control: 5 off walks to it first')
  // a broken deck: its far end gone is not walked
  r.set(span.far.map((v, i) => (i === 1 ? v - 1 : v)), WATER); r.set([22, 69, 0], WATER)
  const br = world(); // fresh: the bridge never built, ends read as water
  assert.equal(E.bridgeLeg(br, { pos: { x: 9.5, y: 70, z: 0.5 }, home, bridges: [{ ...bridges[0], far: [15, 70, 0] }] }), null, 'a far end that is not standable is no leg')
})

await t('a BRIDGE trip says nothing about the ring (ringOf skips it); the row names the work', async () => {
  const now = 10 * 60 * 60_000
  const late = { t: now - 1000, ring: 300, dist: 280, returned: false, reason: 'bridge_work', via: 'later' }
  assert.equal(E.ringOf([late], now), E.RING_MIN - 0 > 0 ? Math.max(E.RING_MIN, E.RING_MIN - 2 * E.RING_STEP) : 0, 'the control: a late trip shrinks the ring')
  assert.equal(E.ringOf([{ ...late, bridge: 's1' }], now), E.RING_MIN)
  assert.match(E.tripDetail({ bridge: 's1', bridgeStop: 'done', bridgePlaced: 62 }), / br=done:62 /)
})

await t('MUTANTS: the plan without rails-first, the site without the reach check, the leg without the near-side rule are caught', async () => {
  // 1. the rails placed AFTER the step forward: the plan test's stand rule fails
  await withMutant(BR_PATH, "    for (const s of [-1, 1]) out.push(w({ cell: [cx + lx * s, wy + 1, cz + lz * s], kind: 'rail', stand,",
    "    for (const s of [-1, 1]) out.push(w({ cell: [cx + lx * s, wy + 1, cz + lz * s], kind: 'rail', stand: [cx, wy + 1, cz],", async M => {
      const plan = M.bridgePlan(M.bridgeSpan(world(), NEAR, [1, 0]))
      assert.ok(plan.some(p => p.kind === 'rail' && p.stand[0] === p.cell[0]), 'the mutant stands on the row it rails')
    })
  // 2. no reach check: an unreachable near end is sited
  await withMutant(BR_PATH, "if (reach && !reach(s.near)) { tried.unreached", "if (false && reach && !reach(s.near)) { tried.unreached", async M => {
    const home = { x: -100, y: 70, z: 0 }
    const r = M.bridgeSite(world(), { x: 5.5, y: 70, z: 0.5 }, { home, bearingV: E.bearingVec(0), reach: () => false })
    assert.equal(r.ok, true, 'the mutant sites what the bot cannot reach')
  })
  // 3. no near-side rule: the bot at the landing takes the bridge back
  await withMutant(EX_PATH, "Math.hypot(b.near[0] + 0.5 - pos.x, b.near[2] + 0.5 - pos.z) < Math.hypot(b.land[0] + 0.5 - pos.x, b.land[2] + 0.5 - pos.z))",
    "true)", async M => {
      const r = world()
      const span = B.bridgeSpan(r, NEAR, [1, 0])
      await B.buildBridge(sim(r), B.bridgePlan(span))
      const bridges = [{ id: 'x', near: span.near, far: span.far, land: span.land, axis: span.axis, w: span.w }]
      assert.ok(M.bridgeLeg(r, { pos: { x: 25.5, y: 70, z: 0.5 }, home: { x: -100, y: 70, z: 0 }, bridges }), 'the mutant shuttles')
    })
})

await t('wiring (structural): the switch, the siting at a dry water turn, the bridge trip, the build, the lease, the reservations', async () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (re, what) => assert.equal((src.match(re) ?? []).length, 1, what)
  one(/bridge: bridgeOn\(process\.env\)/g, 'the switch')
  one(/if \(EXPEDITION\.bridge && !bsite && trip\.reason === 'water' && \/water\|swim_\/\.test\(String\(trip\.whys \?\? ''\)\) && !bot\.entity\?\.isInWater\) exSiteBridge\(bot, trip, read, keepOff, home\)/g, 'siting at a refused crossing')
  one(/const cand = bridgeToBuild\(bSites, Date\.now\(\)\)/g, 'the site to build')
  // boardwalk-01: the wooden pick and the cobble pick each take the same one-builder lease
  assert.equal((src.match(/takeSlot\(dir, exBridgeKey\(\), me, 1, \{ ttl: budget \+ 60_000 \}\)/g) ?? []).length, 2, 'one builder: the lease (wood or cobble)')
  one(/releaseLease\(dir, exBridgeKey\(\), `slot\$\{blease\.slot\}`, me, blease\.gen\)/g, 'released in finally')
  one(/const bw = await exBridgeWork\(ctx, signal, trip, bsite, deadline - 12_000\)/g, 'the build')
  one(/bridges: EXPEDITION\.bridge \? exBridgesNow\(bot, bSites, read, trip\) : \[\]/g, 'the planner walks finished bridges')
  one(/const swim = lt\.via === 'swim' \|\| lt\.via === 'bridge'/g, 'a bridge crossing keeps both ends and its gate')
  one(/exPlaceMarker\(ctx, signal, cell, dirV, \{ zones: markerOff, trip, me \}\)/g, 'no marker on a bridge footprint')
  one(/const markerOff = bSites\.length \? \[\.\.\.keepOff, \.\.\.bridgeZones\(bSites\)\] : keepOff/g, 'the bridge footprints join the marker keep-off')
  one(/z = \[\.\.\.z, \.\.\.bridgeZones\(exBridgeSites\(\)\)\]/g, 'the tidy reservation')
  one(/for \(const k of bridgeCellKeys\(exBridgeSites\(\)\)\) guard\.add\(k\)/g, 'the tidy dig guard')
  const v = src.indexOf('async function expeditionVisit'), f = src.indexOf('} finally {', src.indexOf('const bw = await exBridgeWork'))
  assert.ok(v > 0 && f > v && src.indexOf('releaseLease(dir, exBridgeKey()', f) > f, 'the lease is released in the visit\'s finally')
})

// ---- boardwalk-01: WOODEN BRIDGES (owner 11-08: "wooden bridges at water edges, instead of dirt bridges") ---------------------------
/** The simulator placing each step's OWN item (planks, a fence, a torch). */
const simItem = (r, o = {}) => {
  const io = sim(r, o), place0 = io.place
  io.place = async st => { const ok = await place0(st); if (ok) r.set(st.cell, st.kind === 'torch' ? { name: 'torch', boundingBox: 'empty' } : { name: st.item, boundingBox: 'block' }); return ok }
  return io
}
await t('boardwalk-01: a WOODEN plan is the cobble plan cell for cell, click for click -- planks on the deck and sides, fences on the rails', async () => {
  const s = B.bridgeSpan(world(), NEAR, [1, 0])
  const c = B.bridgePlan(s), w = B.bridgePlan(s, { wood: B.bridgeWood('spruce') })
  assert.deepEqual(w.map(p => [p.cell, p.kind, p.stand, p.ref, p.face]), c.map(p => [p.cell, p.kind, p.stand, p.ref, p.face]))
  assert.ok(w.filter(p => p.kind === 'deck' || p.kind === 'side').every(p => p.item === 'spruce_planks'))
  assert.ok(w.filter(p => p.kind === 'rail').every(p => p.item === 'spruce_fence'))
  assert.ok(c.every(p => p.kind === 'torch' || p.item === 'cobblestone'), 'the cobble plan is unchanged')
})
await t('boardwalk-01: a wooden deck reads done only as PLANKS (the bots\' dirt never stands for it); sides and rails take any solid (a bank\'s rock is kept)', async () => {
  const s = B.bridgeSpan(world(), NEAR, [1, 0])
  const w = B.bridgePlan(s, { wood: B.bridgeWood('oak') })
  const deck = w.find(p => p.kind === 'deck'), side = w.find(p => p.kind === 'side')
  const r = world()
  r.set(deck.cell, { name: 'dirt', boundingBox: 'block' })
  assert.equal(B.stepDone(r, deck), false, 'dirt in a wooden deck cell is not the deck')
  r.set(deck.cell, { name: 'birch_planks', boundingBox: 'block' })
  assert.equal(B.stepDone(r, deck), true, 'any planks are')
  r.set(side.cell, { name: 'stone', boundingBox: 'block' })
  assert.equal(B.stepDone(r, side), true)
  const scenario = M => { const r2 = world(); const d2 = M.bridgePlan(s, { wood: M.bridgeWood('oak') }).find(p => p.kind === 'deck'); r2.set(d2.cell, { name: 'dirt', boundingBox: 'block' }); assert.equal(M.stepDone(r2, d2), false) }
  scenario(B)
  let k = false
  await withMutant(BR_PATH, '  return blockDone(b) && familyOk(b, s.want)\n', '  return blockDone(b)\n', async M => { try { scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
})
await t('boardwalk-01: the BUILDER finishes a wooden bridge over the simulated lake; it reads intact by its own palette and crosses as a deck', async () => {
  const r = world()
  const span = B.bridgeSpan(r, NEAR, [1, 0])
  const plan = B.bridgePlan(span, { wood: B.bridgeWood('spruce') })
  const res = await B.buildBridge(simItem(r), plan)
  assert.equal(res.stop, 'done'); assert.equal(B.bridgeIntact(r, plan), true)
  assert.ok(plan.filter(p => p.kind === 'rail').every(p => r(...p.cell).name === 'spruce_fence'))
  assert.equal(B.bridgeIntact(r, B.bridgePlan(span)), true, 'a wooden bridge is a bridge to the cobble reading too (legTarget walks it)')
})
await t('boardwalk-01: THE MATERIAL -- wood for a new site when the wood pays the bill; cobble when it cannot, when the switch is off, or when a cobble deck already stands; a named material is kept', async () => {
  const r = world()
  const span = B.bridgeSpan(r, NEAR, [1, 0])
  const bill = B.bridgeWoodBill(span)
  assert.deepEqual([bill.planks, bill.fences], [36, 24]); assert.equal(bill.logs, Math.ceil((36 + 4 * 8 + 2 * 4) / 4))
  const site = { span }
  assert.equal(B.bridgeMaterial(site, r, { on: true, woodAvail: bill.logs }), 'wood')
  assert.equal(B.bridgeMaterial(site, r, { on: true, woodAvail: bill.logs - 1 }), 'cobble')
  assert.equal(B.bridgeMaterial(site, r, { on: false, woodAvail: 999 }), 'cobble')
  const r2 = world(); r2.set(B.bridgePlan(span)[0].cell, { name: 'cobblestone', boundingBox: 'block' })
  assert.equal(B.bridgeMaterial(site, r2, { on: true, woodAvail: 999 }), 'cobble', 'a half-built cobble bridge stays cobble')
  assert.equal(B.bridgeMaterial({ span, mat: 'wood' }, r2, { on: false, woodAvail: 0 }), 'wood', 'a wooden site stays wood')
  // Codex r2 BLOCKER 1: an UNLOADED deck says nothing -- an old site (no woodv) stays cobble; one sighted under boardwalk-01 (woodv: every
  // build names its material first) may go wood; a named cobble site stays cobble
  const unread = () => null
  assert.equal(B.bridgeMaterial({ span }, unread, { on: true, woodAvail: 999 }), 'cobble', 'an old site, deck unread: cobble')
  assert.equal(B.bridgeMaterial({ span, woodv: 1 }, unread, { on: true, woodAvail: 999 }), 'wood', 'a new site, deck unread: wood')
  assert.equal(B.bridgeMaterial({ span, woodv: 1, mat: 'cobble' }, r, { on: true, woodAvail: 999 }), 'cobble', 'a named cobble site stays cobble')
  const s2 = B.bridgeSites([{ op: 'sight', id: 'b', span, trip: 't1', woodv: 1 }, { op: 'state', id: 'b', mat: 'cobble' }])
  assert.equal(s2[0].woodv, 1); assert.equal(s2[0].mat, 'cobble')
  let k = false
  await withMutant(BR_PATH, "  if (!site.woodv && decks.some(b => b == null)) return 'cobble'\n", '', async M => { try { assert.equal(M.bridgeMaterial({ span }, unread, { on: true, woodAvail: 999 }), 'cobble') } catch { k = true } })
  assert.ok(k, 'the mutant survived')
  const sites = B.bridgeSites([{ op: 'sight', id: 'a', span, trip: 't1' }, { op: 'state', id: 'a', mat: 'wood', species: 'spruce' }, { op: 'state', id: 'a', mat: 'wood', species: 'oak' }])
  assert.equal(sites[0].mat, 'wood'); assert.equal(sites[0].species, 'spruce', 'the first named species is kept')
  assert.ok(B.sitePlan(sites[0]).some(p => p.item === 'spruce_fence'))
})
await t('boardwalk-01 wiring (structural): the expedition builds and judges a site by its own plan; the wooden pick names the material once its lease is taken', async () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (re, what) => assert.equal((src.match(re) ?? []).length, 1, what)
  one(/const plan = sitePlan\(site\)/g, 'the build by the site\'s plan')
  one(/const plan = s \? sitePlan\(s\) : \[\]/g, 'the intact check by the site\'s plan')
  one(/const mat = cand && Number\.isInteger\(cand\.bearing\) \? bridgeMaterial\(cand, exReader\(bot\), \{ on: BRIDGE_WOOD_ON, woodAvail: woodPressureNow\(bot\)\.avail \}\) : 'cobble'/g, 'the material pick')
  one(/if \(cand\.mat !== 'wood'\) \{ exAppend\(exBridgesFile\(\), \{ op: 'state', id: cand\.id, mat: 'wood', species: sp/g, 'named once')
  one(/if \(!site\.mat\) \{ exAppend\(exBridgesFile\(\), \{ op: 'state', id: site\.id, mat: 'cobble'/g, 'a cobble build names its material before its first block')
  one(/gain: r\.gain, woodv: 1 \}\)/g, 'a sighting is marked woodv')
  one(/const avail = woodPressure\(\{ town: t\?\.stock \?\? null, coverage: t\?\.coverage \?\? 0, bag: \{\}, reserve:/g, 'the kit draws the town above its reserve only')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
