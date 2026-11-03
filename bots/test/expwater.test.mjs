// EXPWATER-01: EXPEDITIONS CROSS NARROW WATER (bots/src/expedition.mjs swimLeg / lineClear `swim` / crumbDue `shore` / deadBearings
// EXIT_RETRY_MS / gatherSpare; skills.mjs expeditionVisit). Behaviour on synthetic worlds: a stream across every bend is swum to a dry
// far shore (dry legs only refuse it: the control); a dry bend still beats a swim; wide water, lava, a bubble column, a ravine
// plunge, a far bank a swimmer cannot climb and a line ending in the water are refused; a crossing keeps a crumb on BOTH shores and
// the way home crosses back over them; a refused walk near town blocks its bearing for hours, not the day; a multi-call trip gathers.
// Mutants assert their anchors present and unique (CLAUDE.md).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const E = await import('../src/expedition.mjs')

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

// A synthetic world: grass at feet y=70 (ground 69). `river`: a band of x [x0, x1] across all z, its liquid `liquid` at `surface`
// (69 = level with the ground: a swimmer climbs out one block up), stone below; `bank`: the far side's ground raised to this y.
const AIR = { name: 'air', boundingBox: 'empty' }, STONE = { name: 'stone', boundingBox: 'block' }, GRASS = { name: 'grass_block', boundingBox: 'block' }
function world ({ river = null, liquid = 'water', surface = 69, bank = 69, lakes = [] } = {}) {
  return (x, y, z) => {
    for (const l of lakes) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return y === 69 ? { name: 'water', boundingBox: 'empty' } : y < 69 ? STONE : AIR
    if (river && x >= river.x0 && x <= river.x1) {
      if (y === surface) return { name: liquid, boundingBox: 'empty' }
      return y < surface ? STONE : AIR
    }
    const g = river && x > river.x1 ? bank : 69
    if (y === g) return GRASS
    return y < g ? STONE : AIR
  }
}
const HOME = { x: -100, y: 70, z: 0 }
const POS = { x: 0, y: 70, z: 0 }

await t('a STREAM across every bend: dry legs refuse it (the control), a swim leg crosses it to a dry far shore', async () => {
  const r = world({ river: { x0: 8, x1: 12 } })
  // the water 12+ out: a DRY leg to its near shore first (the crossing leg then starts there)
  const far = world({ river: { x0: 20, x1: 24 } })
  const sh = E.legTarget(far, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.equal(sh.via, 'shore'); assert.equal(sh.target.x, 19, 'the last dry column before the water'); assert.equal(sh.wet, 0)
  const dry = E.legTarget(r, { pos: POS, home: HOME, bearing: 0 })
  assert.equal(dry.ok, false); assert.equal(dry.why, 'water', 'the 11-02 planner turns here')
  const lt = E.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.equal(lt.ok, true, `refused: ${lt.why} ${lt.whys}`)
  assert.equal(lt.via, 'swim'); assert.equal(lt.bend, 0)
  assert.ok(lt.target.x > 12, 'the target is past the far shore'); assert.equal(lt.target.y, 70)
  assert.ok(E.standableAt(r, [lt.target.x, lt.target.y, lt.target.z]), 'a dry standable cell')
  assert.equal(lt.wet, 5, 'five wet columns, counted block by block')
  assert.deepEqual(lt.shore, [0, 70, 0], 'the near shore is the bot\'s own cell')
})

await t('a dry bend still beats a swim (a lake with dry land round it is walked round)', async () => {
  const r = world({ lakes: [{ x0: 10, x1: 25, z0: -3, z1: 3 }] })
  const lt = E.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.equal(lt.ok, true); assert.equal(lt.via, 'bearing'); assert.notEqual(lt.bend, 0)
})

await t('WIDE water is refused with its width (the boat / bridge piece\'s evidence), and a line ending in the water is no leg', async () => {
  const r = world({ river: { x0: 5, x1: 60 } })
  const lt = E.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.equal(lt.ok, false); assert.equal(lt.why, 'water')
  const w = /swim_wide:(\d+)/.exec(lt.whys)
  assert.ok(w && Number(w[1]) > E.SWIM_MAX, `the width is logged: ${lt.whys}`)
  const open = E.lineClear(r, POS, { x: 15, y: 70, z: 0 }, { swim: E.SWIM_MAX })
  assert.equal(open.ok, false); assert.equal(open.open, true)
})

await t('never LAVA, never a BUBBLE COLUMN, never a plunge into ravine water, never a far bank a swimmer cannot climb', async () => {
  for (const liquid of ['lava', 'bubble_column']) {
    const lt = E.legTarget(world({ river: { x0: 8, x1: 10 }, liquid }), { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
    assert.equal(lt.ok, false, `${liquid} swum`)
  }
  const ravine = world({ river: { x0: 8, x1: 10 }, surface: 69 - E.SWIM_DROP - 2 })
  assert.equal(E.legTarget(ravine, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX }).ok, false, 'a ravine')
  // Paper 11-03 (sandbox/swim/swim.mjs): the pathfinder with the bots' shore egress planned 0 of 10 exits onto a one-block-up shore
  const step = world({ river: { x0: 8, x1: 10 }, bank: 70 })
  assert.equal(E.legTarget(step, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX }).ok, false, 'a far shore one block up: refused')
  const sunk = world({ river: { x0: 8, x1: 10 }, surface: 68 })   // the water one below BOTH banks: no way out on either side
  assert.equal(E.legTarget(sunk, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX }).ok, false, 'a near bank one block up: the way home could not climb out')
  assert.equal(E.legTarget(world({ river: { x0: 8, x1: 10 } }), { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX }).ok, true, 'level shores (the positive control)')
})

await t('MUTANT KILLED: a swim blind to the liquid swims lava', async () => {
  await withMutant(EX_PATH, "      if (s.liquid !== 'water') return { ok: false, why: 'water', at: [x, z], liquid: s.liquid ?? null }\n", '', async M => {
    assert.equal(M.legTarget(world({ river: { x0: 8, x1: 10 }, liquid: 'lava' }), { pos: POS, home: HOME, bearing: 0, swim: M.SWIM_MAX }).ok, true)
  })
})
await t('MUTANT KILLED: a swim blind to the far bank aims at a shore it cannot climb onto', async () => {
  await withMutant(EX_PATH, '      if (s.none || s.y <= waterY || s.y - waterY > SWIM_EXIT) return { ok: false, why: \'water\', at: [x, z], bank: s.none ? \'none\' : s.y - waterY }\n', '', async M => {
    assert.equal(M.legTarget(world({ river: { x0: 8, x1: 10 }, bank: 69 + M.SWIM_EXIT }), { pos: POS, home: HOME, bearing: 0, swim: M.SWIM_MAX }).ok, true)
  })
})
await t('MUTANT KILLED: a swim blind to the NEAR bank strands the way home in the water', async () => {
  await withMutant(EX_PATH, "      if (!run && y - s.y > SWIM_EXIT) return { ok: false, why: 'water', at: [x, z], bank: y - s.y }\n", '', async M => {
    // the near bank one up, the far bank level with the water (sunk river, raised far side lowered): only the near-bank rule refuses
    const r = (x, y, z) => { const b = world({ river: { x0: 8, x1: 10 }, surface: 68, bank: 68 })(x, y, z); return b }
    assert.equal(E.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX }).ok, false, 'the guard refuses')
    assert.equal(M.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: M.SWIM_MAX }).ok, true, 'the mutant swims')
  })
})
await t('MUTANT KILLED: without the shore leg a crossing starts 19 blocks from the water (its near-shore crumb is no shore)', async () => {
  await withMutant(EX_PATH, '  if (b && Math.hypot(b[0] - pos.x, b[2] - pos.z) > SHORE_NEAR && dHome({ x: b[0], z: b[2] }) >= here - SHORE_BACK && standableAt(read, b)) {\n', '  if (false) {\n', async M => {
    assert.equal(M.legTarget(world({ river: { x0: 20, x1: 24 } }), { pos: POS, home: HOME, bearing: 0, swim: M.SWIM_MAX }).via, 'swim')
  })
})
await t('MUTANT KILLED: without the swim pass the stream turns the trip again', async () => {
  await withMutant(EX_PATH, '  if (swim > 0 && whys.includes(\'water\')) {\n', '  if (false) {\n', async M => {
    assert.equal(M.legTarget(world({ river: { x0: 8, x1: 12 } }), { pos: POS, home: HOME, bearing: 0, swim: M.SWIM_MAX }).ok, false)
  })
})

await t('the NARROWEST crossing of the bends is swum (a lake 14 wide straight on, 3 wide at 50 degrees left)', async () => {
  // a lake x 5..18 across z -8..60; a 3-wide channel for z < -8 (the north side, bend -50 heads there)
  const base = world({ lakes: [{ x0: 5, x1: 18, z0: -8, z1: 60 }, { x0: 5, x1: 7, z0: -60, z1: -9 }] })
  const lt = E.legTarget(base, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.equal(lt.ok, true); assert.equal(lt.via, 'swim')
  assert.ok(lt.bend < 0 && lt.wet <= 6, `the narrow channel: bend ${lt.bend} wet ${lt.wet}`)
  await withMutant(EX_PATH, '      if (!best || lc.wet < best.lc.wet) best = { bend, lc, target: { x: ix, y: si.y, z: iz } }\n', '      if (!best) best = { bend, lc, target: { x: ix, y: si.y, z: iz } }\n', async M => {
    const m = M.legTarget(base, { pos: POS, home: HOME, bearing: 0, swim: M.SWIM_MAX })
    assert.ok(m.wet > 6, `the mutant swims the first it meets: ${m.wet}`)
  })
})

await t('Claude review r1 BLOCKER: a KELP column in deep water is water, never a far shore on the lake bed', async () => {
  // bank feet 63 (ground 62) to x 24; water 50..62 from x 25 on, deep; a kelp column at x 30..31 from the bed to the surface
  const r = (x, y, z) => {
    if (x <= 24) return y === 62 ? GRASS : y < 62 ? STONE : AIR
    if (y < 50) return STONE
    if (y <= 62) return (x === 30 || x === 31) ? { name: y === 62 ? 'kelp' : 'kelp_plant', boundingBox: 'empty' } : { name: 'water', boundingBox: 'empty' }
    return AIR
  }
  const pos = { x: 20, y: 63, z: 0 }
  assert.equal(E.surfaceAt(r, 30, 0, 63).water, true, 'kelp reads as water')
  const lt = E.legTarget(r, { pos, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.equal(lt.ok, false, `no shore in the sea: ${JSON.stringify(lt.target)}`)
  await withMutant(EX_PATH, "const liquid = b => !!b && (LIQUID.test(b.name ?? '') || AQUATIC.test(b.name ?? '') || b.waterlogged === true)\n", "const liquid = b => !!b && (LIQUID.test(b.name ?? '') || b.waterlogged === true)\n", async M => {
    assert.equal(M.surfaceAt(r, 30, 0, 63).water, false, 'the mutant reads the kelp column as ground on the bed')
  })
})

await t('the crossing keeps a crumb on BOTH shores, however close the last one (CRUMB_MIN does not drop them)', async () => {
  const r = world({ river: { x0: 8, x1: 12 } })
  const crumbs = [[-3, 70, 0]]
  assert.equal(E.crumbDue(crumbs, [0, 70, 0], r), false, 'an ordinary crumb 3 from the last: skipped (control)')
  assert.equal(E.crumbDue(crumbs, [0, 70, 0], r, { shore: true }), true, 'the near shore: kept')
  assert.equal(E.crumbDue([[0, 70, 0]], [0, 70, 0], r, { shore: true }), false, 'never the same cell twice')
  assert.equal(E.crumbDue(crumbs, [10, 69, 0], r, { shore: true }), false, 'never a wet cell')
})

await t('A WHOLE TRIP ACROSS A RIVER, composed: out over the water with crumbs on both shores, then home back across it', async () => {
  const r = world({ river: { x0: 30, x1: 40 } })
  const home = { x: 0, y: 70, z: 0 }
  const crumbs = [[0, 70, 0]]
  let pos = { x: 0, y: 70, z: 0 }, reason = null, legs = 0, swims = 0
  const gates = []
  while (!(reason = E.turnReason({ dist: Math.hypot(pos.x, pos.z), ring: 120 })) && legs < 30) {
    const lt = E.legTarget(r, { pos, home, bearing: 0, swim: E.SWIM_MAX })
    assert.ok(lt.ok, `leg ${legs} refused: ${lt.why} ${lt.whys}`)
    if (lt.via === 'swim') { swims++; if (E.crumbDue(crumbs, lt.shore, r, { shore: true })) crumbs.push(lt.shore) }
    pos = lt.target
    const cell = [pos.x, pos.y, pos.z]
    if (E.crumbDue(crumbs, cell, r, { shore: lt.via === 'swim' })) { crumbs.push(cell); if (lt.via === 'swim') gates.push(crumbs.length - 1) }
    legs++
  }
  assert.equal(reason, 'reached'); assert.equal(swims, 1, 'one crossing')
  const near = crumbs.filter(c => c[0] < 30), far = crumbs.filter(c => c[0] > 40)
  assert.ok(near.length && far.length, 'crumbs on both sides')
  // the bridge pair: the last crumb before the water and the first after it, within a hop of each other
  const a = near[near.length - 1], b = far[0]
  assert.ok(Math.hypot(b[0] - a[0], b[2] - a[2]) <= 28, `the shores are one hop apart: ${a} -> ${b}`)
  let cursor = crumbs.length, here = { x: pos.x, z: pos.z }, crossedBack = false
  for (let n = 0; n < 50; n++) {
    const i = E.nextCrumb(crumbs, here, cursor, { gates })
    if (i < 0) break
    if (here.x > 40 && crumbs[i][0] < 30) { crossedBack = true; assert.deepEqual([here.x, crumbs[i][0]], [b[0], a[0]], 'the crossing back is the checked one: far shore -> near shore') }
    here = { x: crumbs[i][0], z: crumbs[i][2] }; cursor = i
    if (i === 0) break
  }
  assert.equal(cursor, 0, 'home over the crumbs'); assert.ok(crossedBack, 'the way home swims back across')
})

await t('A CROSSING IS A GATE on the way home: no hop cuts past the far shore, and from it the next hop is its near shore (Codex design)', async () => {
  // crumbs out along x: 0 town, 10, 20 the near shore, 30 the far shore (gate 3), 40, 50
  const crumbs = [[0, 70, 0], [10, 70, 0], [20, 70, 0], [30, 70, 0], [40, 70, 0], [50, 70, 0]]
  assert.equal(E.nextCrumb(crumbs, { x: 45, z: 0 }, 5), 2, 'no gate (the control): the lowest in reach, 25 away, past the far shore')
  assert.equal(E.nextCrumb(crumbs, { x: 45, z: 0 }, 5, { gates: [3] }), 3, 'with the gate: the far shore first')
  assert.equal(E.nextCrumb(crumbs, { x: 30, z: 0 }, 3), 1, 'no gate: from the far shore it cuts past the near one')
  assert.equal(E.nextCrumb(crumbs, { x: 30, z: 0 }, 3, { gates: [3] }), 2, 'with the gate: the near shore')
  assert.equal(E.nextCrumb(crumbs, { x: 20, z: 0 }, 2, { gates: [3] }), 0, 'across: the gate no longer binds')
  await withMutant(EX_PATH, '  for (const f of gates ?? []) { if (!Number.isInteger(f)) continue; if (f < top) lo = Math.max(lo, f); else if (f === top) lo = Math.max(lo, f - 1) }\n', '', async M => {
    assert.equal(M.nextCrumb(crumbs, { x: 45, z: 0 }, 5, { gates: [3] }), 2, 'the mutant cuts past the crossing')
  })
})

await t('Codex review r1 BLOCKER 1: a swim leg lands SHORE_INLAND past the far shore (goto range 2 never stops it in the water); a strip too narrow is no landing', async () => {
  const r = world({ river: { x0: 8, x1: 12 } })
  const lt = E.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.equal(lt.via, 'swim'); assert.ok(lt.target.x - 12 >= E.SHORE_INLAND, `target ${lt.target.x}: past the water by ${lt.target.x - 12}`)
  // a 2-wide sand-bar between two rivers: not a landing; the swim takes both in one leg when it can (5 + 2 + 5 wet) or not at all
  const bar = (x, y, z) => (x >= 13 && x <= 14) ? (y === 69 ? GRASS : y < 69 ? STONE : AIR) : world({ river: { x0: 8, x1: 19 } })(x, y, z)
  const lb = E.legTarget(bar, { pos: POS, home: HOME, bearing: 0, swim: E.SWIM_MAX })
  assert.ok(!lb.ok || lb.target.x >= 19 + E.SHORE_INLAND, `never a target on the bar: ${JSON.stringify(lb.target)}`)
})

await t('Codex review r1 BLOCKER 2: a crossing not yet swum back HOLDS a dry bot (heldGate), and is released once its near shore is reached', async () => {
  assert.equal(E.heldGate([3], 6), 3, 'beyond the gate')
  assert.equal(E.heldGate([3], 3), 3, 'on the far shore')
  assert.equal(E.heldGate([3], 2), null, 'back on the near shore: released')
  assert.equal(E.heldGate([3, 7], 9), 7, 'the outermost first')
  assert.equal(E.heldGate([3, 7], 6), 3)
  assert.equal(E.heldGate([], 9), null)
})

await t('a REFUSED WALK near town blocks its bearing for EXIT_RETRY_MS, not the day; water near town still does (LIVE 11-03: 5 of 8 dead bearings)', async () => {
  const now = 1e10
  const row = (reason, age, k = 4) => ({ t: now - age, v: E.PLANNER_V, bearing: k, dist: 21, ring: 300, reason, returned: true, haul: 0 })
  assert.deepEqual([...E.deadBearings([row('blocked', 60_000)], now)], [4], 'fresh: blocked')
  assert.deepEqual([...E.deadBearings([row('blocked', E.EXIT_RETRY_MS + 1)], now)], [], 'after the retry time: open again')
  assert.deepEqual([...E.deadBearings([row('water', E.EXIT_RETRY_MS + 1)], now)], [4], 'water is ground: the day')
  assert.notEqual(E.tripBearing([row('blocked', 60_000)], now).bearing, 4)
  const old = Array.from({ length: 8 }, (_, k) => row('blocked', E.EXIT_RETRY_MS + 1, k))
  assert.notEqual(E.tripBearing(old, now).bearing, null, 'eight old town-exit refusals: the map is open')
  await withMutant(EX_PATH, "    if (d < 40 && t.reason === 'blocked' && Number.isFinite(now) && now - (Number(t?.t) || 0) >= EXIT_RETRY_MS) continue\n", '', async M => {
    assert.equal(M.tripBearing(old.map(o => ({ ...o, v: M.PLANNER_V })), now).bearing, null, 'the mutant: every bearing blocked for the day')
  })
})

await t('a v 2 planner\'s water turns no longer block (that planner could not swim); v 3 rows do', async () => {
  const now = 1e10
  const w = v => [0, 1].map(i => ({ t: now - 10 + i, v, bearing: 2, dist: 164, ring: 300, reason: 'water', returned: true, haul: 0 }))
  assert.ok(E.deadBearings(w(E.PLANNER_V), now).has(2))
  const day = Array.from({ length: 8 }, (_, k) => w(2).map(r => ({ ...r, bearing: k }))).flat()
  assert.notEqual(E.tripBearing(day, now).bearing, null, 'the 11-02 rows leave the map open')
})

await t('a MULTI-CALL trip gathers at the turn (LIVE 11-03: 0 of 35 trips did; the spare was negative by construction)', async () => {
  // the showcase's call: 165 s budget, 0.6 of it out
  const deadline = 165_000, outTook = 99_000, now = 99_000
  const oldSpare = deadline - now - Math.max(20_000, outTook * 1.2)
  assert.ok(oldSpare < 8_000, `the old rule: ${oldSpare}`)
  assert.ok(E.gatherSpare({ deadline, now, outTook, multi: true }) >= 8_000, 'multi: the gather runs')
  assert.equal(E.gatherSpare({ deadline, now, outTook, multi: false }), oldSpare, 'a one-call trip keeps its whole way back, as before')
  await withMutant(EX_PATH, '  return deadline - now - (multi ? MULTI_HOME_MS : Math.max(20_000, outTook * 1.2))\n', '  return deadline - now - Math.max(20_000, outTook * 1.2)\n', async M => {
    assert.ok(M.gatherSpare({ deadline, now, outTook, multi: true }) < 8_000)
  })
})

await t('the switch and the licence row: EXPEDITION_SWIM=off is dry legs only; the mode row names the swim width', async () => {
  assert.equal(E.swimWidth({}), E.SWIM_MAX); assert.equal(E.swimWidth({ EXPEDITION_SWIM: 'on' }), E.SWIM_MAX)
  assert.equal(E.swimWidth({ EXPEDITION_SWIM: 'off' }), 0); assert.equal(E.swimWidth({ EXPEDITION_SWIM: '0' }), 0)
  assert.equal(E.swimWidth({ EXPEDITION_SWIM: '8' }), 8, 'an operator narrows it'); assert.equal(E.swimWidth({ EXPEDITION_SWIM: '99' }), 24, 'capped')
  assert.equal(E.swimOn({ EXPEDITION_SWIM: 'off' }), false)
  assert.match(E.expeditionModeDetail(true, true, E.SWIM_MAX), new RegExp(`swim=${E.SWIM_MAX} `))
  assert.match(E.expeditionModeDetail(true, true, 0), / swim=0 /)
  // the width is what the leg gets: an 8-wide limit refuses the 11-wide river the default swims
  const r = world({ river: { x0: 4, x1: 14 } })
  assert.equal(E.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: E.swimWidth({}) }).ok, true)
  assert.equal(E.legTarget(r, { pos: POS, home: HOME, bearing: 0, swim: E.swimWidth({ EXPEDITION_SWIM: '8' }) }).ok, false)
})

await t('wiring (structural): the visit passes the swim width, keeps both shores, logs the crossing, sizes the gather by gatherSpare', async () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (re, what) => assert.equal((src.match(re) ?? []).length, 1, what)
  one(/detour: trip\.detour, swim: EXPEDITION\.swim \}\)/g, 'legTarget gets the swim width')
  one(/swim: exSwimWidth\(process\.env\)/g, 'the switch')
  one(/const gates = Array\.isArray\(trip\.gates\) \? trip\.gates : \[\]/g, 'the trip\'s gates')
  one(/nextCrumb\(crumbs, p, cursor, \{ loaded, skip, gates \}\)/g, 'the way home keeps the gates')
  one(/const gf = i < 0 && !bot\.entity\?\.isInWater \? heldGate\(gates, cursor\) : null/g, 'a dry bot is held to its gate')
  one(/if \(gateTries\+\+ >= GATE_RETRIES\) \{ via = `\$\{via\}\+gate_hold`; break \}/g, 'then the trail stays open')
  one(/\(trip\.gates \?\?= \[\]\)\.push\(f\)/g, 'a dry far shore is a gate')
  one(/if \(swim && lt\.shore && crumbDue\(trip\.crumbs, lt\.shore, read, \{ shore: true \}\)\) trip\.crumbs\.push\(lt\.shore\)/g, 'the near shore')
  one(/if \(crumbDue\(trip\.crumbs, cell, read, \{ shore: swim \}\)\) trip\.crumbs\.push\(cell\)/g, 'the far shore')
  one(/exRow\(bot, 'cross', /g, 'the crossing row')
  one(/const spare = gatherSpare\(\{ deadline, now: Date\.now\(\), outTook, multi: trip\.multi === true \}\)/g, 'the gather spare')
  one(/expeditionModeDetail\(EXPEDITION\.on, EXPEDITION\.markers, EXPEDITION\.swim\)/g, 'the licence row')
})

console.log(`\nexpwater: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
