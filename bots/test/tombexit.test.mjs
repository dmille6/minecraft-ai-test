// TOMBEXIT-01 (bots/src/tombexit.mjs): the entombed arm's walk-back decline, and the in-wall dig.
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: decisions extracted and driven, never matched as text):
//   A. walkBack / declineDecision on the design's fixtures (F2 of docs/reports/mineshaft-safety-2026-10-23.md):
//      declined with a walk-in history (tunnel dead end, a tread of a 2-high stair walked DOWN into, an alcove), not
//      declined (the suite's tomb with no history, a one-way 4-block drop, a 6-long tunnel sealed behind, a covered
//      2-cell pocket, unknown cells, a lava floor), and the large sealed cave: declined twice, then today's arm.
//   B. the ring (expiry, the jump clear) and the bound (per area, per window).
//   C. the in-wall decision (a suffocating eye cell + falling health -> dig; open eye + unexplained loss -> unseen)
//      and `suffocates` (full cubes only, the vanilla non-suffocating exceptions).
//   D. the wiring in reflex.mjs / index.mjs (structural, comments stripped).
//   E. anchored mutants (present AND unique) for every decision line, each seen to fail its own test.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { walkBack, walkMoves, declineDecision, boundDecide, makeFreeRing, inwallDecision, suffocates, makeHealthTrend,
         tombexitOn, inwallOn, tombexitModeDetail, inwallBackoffMs, INWALL_MAX_DIGS, MAX_NODES, BOUND_N, RING_MS, INWALL_DROP_HP, inwallDigMs, lavaOver,
         floorOk } from '../src/tombexit.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const TE_PATH = new URL('../src/tombexit.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)
const INDEX_PATH = new URL('../src/index.mjs', import.meta.url)

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-te-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** Did `fn` (a test body) fail? A mutant is killed when the assertion that guards its line throws. */
const throws = fn => { try { fn(); return false } catch { return true } }

// ---------------------------------------------------------------------------------------------------------- fixtures
// A world of stone with the listed cells open (air) or named; anything farther than 40 from the origin is UNKNOWN (null).
const blk = name => ({ name, boundingBox: /^(air|cave_air|water|lava|flowing_lava|fire|bubble_column|torch)$/.test(name) ? 'empty' : 'block' })
function makeWorld () {
  const cells = new Map()
  const w = {
    open (x, y, z) { cells.set(`${x},${y},${z}`, 'air'); return w },
    set (x, y, z, name) { cells.set(`${x},${y},${z}`, name); return w },
    // a 1-wide, 2-high corridor along x from x0 to x1 (inclusive) at feet y, row z
    corridorX (x0, x1, y, z) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { w.open(x, y, z); w.open(x, y + 1, z) } return w },
    // a room: feet y and y+1 open over [x0..x1] x [z0..z1]
    room (x0, x1, z0, z1, y) { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { w.open(x, y, z); w.open(x, y + 1, z) } return w },
    at (x, y, z) {
      if (Math.abs(x) > 40 || Math.abs(z) > 40 || Math.abs(y) > 40) return null
      const n = cells.get(`${x},${y},${z}`)
      if (n === null) return null
      return blk(n ?? 'stone')
    },
  }
  return w
}
const free = (...cs) => cs.map(([x, y, z], i) => ({ x, y, z, t: 1000 + i }))
const FEET = (x, y, z) => ({ x: x + 0.5, y, z: z + 0.5 })
const NOW = 60_000

// the tunnel dead end: a 1x2 tunnel x=0..-20, z=0, ending in a 12x12 room; the bot at the dead end x=0, free at x=-5
const tunnelDeadEnd = () => makeWorld().corridorX(0, -20, 0, 0).room(-32, -21, -6, 5, 0)
// the alcove: a corridor z=0 along x=-20..5 into the same room, the bot in a 1-cell alcove at (0,0,1)
const alcove = () => makeWorld().corridorX(-20, 5, 0, 0).room(-32, -21, -6, 5, 0).open(0, 0, 1).open(0, 1, 1)
// mine's 3-high stair walked DOWN: treads at (0,0), (-1,-1) ... (-6,-6) along x, each 3 high, ending in a room at y=-6.
// (A 2-high stair cannot be walked either way: the step needs the cell over the head open -- vanilla's and the
// pathfinder's rule -- so a bot on a 2-high tread really cannot leave without digging, and stays entombed: A5.)
function stairDown () {
  const w = makeWorld()
  for (let i = 0; i <= 6; i++) { w.open(-i, -i, 0); w.open(-i, -i + 1, 0); w.open(-i, -i + 2, 0) }
  return w.room(-18, -7, -6, 5, -6)
}

// ---------------------------------------------------------------------------------------------- A. the fixtures
await t('A1 tunnel dead end with a walk-in history: declined (open component, free cell 5 away)', () => {
  const w = tunnelDeadEnd()
  const r = walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) })
  assert.strictEqual(r.ok, true, r.reason)
  assert.strictEqual(r.nodes, MAX_NODES)
  assert.strictEqual(r.free_cell, '-5,0,0')
  assert.ok(r.path.length >= 6 && r.path.every(s => /walk|^0,0,0$/.test(s)), r.path.join(' '))
})
await t('A2 the same dead end with NO history: not declined (the positive control for A1)', () => {
  const r = walkBack({ at: tunnelDeadEnd().at, feet: FEET(0, 0, 0), free: [] })
  assert.strictEqual(r.ok, false); assert.match(r.reason, /no free cell/)
})
await t('A3 alcove off a corridor, free cell in the corridor: declined', () => {
  const r = walkBack({ at: alcove().at, feet: FEET(0, 0, 1), free: free([-4, 0, 0]) })
  assert.strictEqual(r.ok, true, r.reason)
})
await t('A4 a tread of a 3-high stair walked DOWN into a room where the bot was free: declined (drops of 1)', () => {
  const r = walkBack({ at: stairDown().at, feet: FEET(0, 0, 0), free: free([-10, -6, 0]) })
  assert.strictEqual(r.ok, true, r.reason)
  assert.ok(r.path.some(s => s.endsWith(':drop')), r.path.join(' '))
})
await t('A5 the same 2-high stair, free only ABOVE the bot (it cannot walk up a 2-high stair: no headroom): not declined', () => {
  // the walk profile's step-up needs the cell over the head open, as vanilla and the pathfinder do; a 2-high tread has stone there
  const w = makeWorld(); for (let i = 0; i <= 6; i++) { w.open(i, i, 0); w.open(i, i + 1, 0) }
  w.room(7, 18, -6, 5, 6)
  const r = walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([10, 6, 0]) })
  assert.strictEqual(r.ok, false)
})
await t('A6 the suite tomb (sealed 1x2) with a free cell recorded outside: not declined (closed component)', () => {
  const w = makeWorld().open(0, 0, 0).open(0, 1, 0)
  const r = walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([5, 0, 0]) })
  assert.strictEqual(r.ok, false); assert.match(r.reason, /closed component \(1 cells\)/)
})
await t('A7 a one-way 4-block drop (free at the top): not declined', () => {
  const w = makeWorld().room(-10, 10, -10, 10, 4)          // the floor the bot walked on, y=4 feet
  for (let y = 0; y <= 3; y++) w.open(0, y, 0)              // the shaft it fell down (feet y=0 at the bottom)
  w.set(0, 3, 0, 'air')
  const r = walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([3, 4, 0]) })
  assert.strictEqual(r.ok, false); assert.match(r.reason, /closed component/)
})
await t('A8 a 6-long tunnel sealed behind the bot, free cell at its far end: not declined (closed, 6 cells)', () => {
  const w = makeWorld().corridorX(0, -5, 0, 0)
  const r = walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) })
  assert.strictEqual(r.ok, false); assert.match(r.reason, /closed component \(6 cells\)/)
  assert.strictEqual(r.free_cell, '-5,0,0', 'the free cell WAS reached: closedness alone refuses')
})
await t('A9 a covered 2-cell pocket: not declined', () => {
  const w = makeWorld().corridorX(0, 1, 0, 0)
  const r = walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([1, 0, 0], [4, 0, 0]) })
  assert.strictEqual(r.ok, false)
})
await t('A10 unknown cells are never walked: the dead-end tunnel whose way back runs into an unloaded chunk is closed', () => {
  const w = tunnelDeadEnd()
  for (let y = -1; y <= 2; y++) w.set(-8, y, 0, null)       // an unloaded cell column across the tunnel
  const r = walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) })
  assert.strictEqual(r.ok, false); assert.match(r.reason, /closed/)
})
await t('A11 a lava floor cuts the walk; water in the body cells too', () => {
  const lavaW = tunnelDeadEnd().set(-3, -1, 0, 'magma_block')
  assert.strictEqual(walkBack({ at: lavaW.at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) }).ok, false)
  const wetW = tunnelDeadEnd().set(-3, 0, 0, 'water').set(-3, 1, 0, 'water')
  assert.strictEqual(walkBack({ at: wetW.at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) }).ok, false)
})
await t('A12 a free cell nearer than 3 is the same place: not declined even in an open room', () => {
  const w = makeWorld().room(-10, 10, -10, 10, 0)
  assert.strictEqual(walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([1, 0, 0], [0, 0, 2]) }).ok, false)
  assert.strictEqual(walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([3, 0, 0]) }).ok, true, 'positive control: 3 away counts')
})
await t('A13 the large sealed cave: declined twice in the area, then today\'s arm (bound), never stranded', () => {
  const w = makeWorld().room(-6, 6, -6, 6, 0)               // 169 cells, sealed: open past the 64-node cap
  let areas = []
  const seen = []
  for (let i = 0; i < 4; i++) {
    const d = declineDecision({ at: w.at, feet: FEET(0, 0, 0), free: free([3, 0, 2]), areas, now: NOW + i * 15_000 })
    areas = d.areas; seen.push(d.decline)
  }
  assert.deepStrictEqual(seen, [true, true, false, false])
  // after the window the area is forgotten and the walk may be believed again
  const later = declineDecision({ at: w.at, feet: FEET(0, 0, 0), free: free([3, 0, 2]), areas, now: NOW + 11 * 60_000 })
  assert.strictEqual(later.decline, true)
})
await t('A14 a closed component charges no bound (the bound counts declines, not firings)', () => {
  const w = makeWorld().open(0, 0, 0).open(0, 1, 0)
  const d = declineDecision({ at: w.at, feet: FEET(0, 0, 0), free: free([5, 0, 0]), areas: [], now: NOW })
  assert.strictEqual(d.decline, false); assert.deepStrictEqual(d.areas, [])
})
await t('A15 walkMoves: walk, up (with headroom), drop<=3; never onto unknown, never up without headroom', () => {
  const w = makeWorld().open(1, 0, 0).open(1, 1, 0)          // walk +x
    .set(-1, 0, 0, 'stone').open(-1, 1, 0).open(-1, 2, 0).open(0, 2, 0).open(0, 1, 0).open(0, 0, 0)   // up -x (headroom open)
    .open(0, 0, 1).open(0, 1, 1).open(0, -1, 1).open(0, -2, 1)                                    // drop 2 at +z
  const ms = walkMoves(w.at, { x: 0, y: 0, z: 0 }).map(m => `${m.move}:${m.x},${m.y},${m.z}`).sort()
  assert.deepStrictEqual(ms, ['drop:0,-2,1', 'up:-1,1,0', 'walk:1,0,0'])
  w.set(0, 2, 0, 'stone')
  assert.ok(!walkMoves(w.at, { x: 0, y: 0, z: 0 }).some(m => m.move === 'up'), 'no headroom, no step up')
})

await t('A16 (Codex r1) a fence in the floor of the way back: not a floor -- no decline over it', () => {
  const w = tunnelDeadEnd()
  const at = (x, y, z) => (x === -3 && y === -1 && z === 0 ? { name: 'oak_fence', boundingBox: 'block', shapes: [[0.375, 0, 0.375, 0.625, 1.5, 0.625]] } : w.at(x, y, z))
  assert.strictEqual(walkBack({ at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) }).ok, false)
  assert.strictEqual(floorOk({ name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }), true, 'positive control')
  assert.strictEqual(floorOk({ name: 'stone_slab', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.5, 1]] }), false)
})

// ---------------------------------------------------------------------------------------------- B. ring + bound
await t('B1 ring: fresh() forgets cells older than RING_MS; note() of a revisited cell refreshes it', () => {
  const r = makeFreeRing()
  r.note({ x: 1.2, y: 64, z: 3.9 }, 0); r.note({ x: 5, y: 64, z: 5 }, 1000)
  assert.strictEqual(r.fresh(RING_MS + 500).length, 1)
  r.note({ x: 5.5, y: 64, z: 5.5 }, RING_MS + 500)
  assert.deepStrictEqual(r.fresh(RING_MS + 600).map(c => `${c.x},${c.y},${c.z}`), ['5,64,5'])
})
await t('B2 ring: a body moved farther than 6 between samples (death, respawn, relocation) forgets every cell', () => {
  const r = makeFreeRing()
  r.touch({ x: 0, y: 64, z: 0 }); r.note({ x: 0, y: 64, z: 0 }, 0)
  assert.strictEqual(r.touch({ x: 2, y: 64, z: 0 }), false); assert.strictEqual(r.size, 1)
  assert.strictEqual(r.touch({ x: 200, y: 70, z: 0 }), true); assert.strictEqual(r.size, 0)
})
await t('B3 bound: separate areas each get their own BOUND_N declines', () => {
  let areas = []
  for (let i = 0; i < BOUND_N; i++) areas = boundDecide({ areas, at: { x: 0, y: 0, z: 0 }, now: NOW }).areas
  assert.strictEqual(boundDecide({ areas, at: { x: 1, y: 0, z: 0 }, now: NOW }).decline, false)
  assert.strictEqual(boundDecide({ areas, at: { x: 30, y: 0, z: 0 }, now: NOW }).decline, true)
})

// ---------------------------------------------------------------------------------------------- C. the in-wall dig
const shaped = (name, shapes) => ({ name, boundingBox: 'block', shapes })
await t('C1 eye in a full stone/gravel/sand cube with health falling: dig', () => {
  for (const n of ['stone', 'gravel', 'sand', 'dirt', 'deepslate']) {
    assert.strictEqual(inwallDecision({ eye: shaped(n, [[0, 0, 0, 1, 1, 1]]), healthNow: 15, healthThen: 16 }).act, 'dig', n)
  }
})
await t('C2 health not falling (stale client view, or regenerating): nothing', () => {
  assert.strictEqual(inwallDecision({ eye: shaped('stone', [[0, 0, 0, 1, 1, 1]]), healthNow: 20, healthThen: 20 }).act, 'none')
  assert.strictEqual(inwallDecision({ eye: shaped('stone', [[0, 0, 0, 1, 1, 1]]), healthNow: 15, healthThen: null }).act, 'none')
  assert.strictEqual(inwallDecision({ eye: shaped('stone', [[0, 0, 0, 1, 1, 1]]), healthNow: 15, healthThen: 15 + INWALL_DROP_HP - 0.1 }).act, 'none')
})
await t('C3 not suffocating: glass, leaves, a slab, a fence, air, null', () => {
  assert.strictEqual(suffocates(shaped('glass', [[0, 0, 0, 1, 1, 1]])), false)
  assert.strictEqual(suffocates(shaped('oak_leaves', [[0, 0, 0, 1, 1, 1]])), false)
  assert.strictEqual(suffocates(shaped('stone_slab', [[0, 0, 0, 1, 0.5, 1]])), false)
  assert.strictEqual(suffocates(shaped('oak_fence', [[0.375, 0, 0.375, 0.625, 1.5, 0.625]])), false)
  assert.strictEqual(suffocates({ name: 'air', boundingBox: 'empty' }), false)
  assert.strictEqual(suffocates(null), false)
  assert.strictEqual(suffocates(shaped('cobblestone', [[0, 0, 0, 1, 1, 1]])), true, 'positive control')
})
await t('C4 health falling, eye open, nothing explains it: unseen (instrument); explained: none', () => {
  const air = { name: 'air', boundingBox: 'empty' }
  assert.strictEqual(inwallDecision({ eye: air, healthNow: 12, healthThen: 14 }).act, 'unseen')
  assert.strictEqual(inwallDecision({ eye: air, healthNow: 12, healthThen: 14, explained: true }).act, 'none')
  assert.strictEqual(inwallDecision({ eye: air, healthNow: 0, healthThen: 2 }).act, 'none', 'dead: nothing')
})
await t('C5 health trend: then() is the newest reading at least the window old', () => {
  const h = makeHealthTrend({ windowMs: 3000 })
  h.push(0, 20); h.push(1000, 19); h.push(2000, 18); h.push(3500, 17)
  assert.strictEqual(h.then(3500), 20); assert.strictEqual(h.then(4000), 19); assert.strictEqual(h.then(1000), null)
})
await t('C7 (Codex r1) the dig deadline follows mineflayer\'s dig time: bare-handed cobble 10 s and deepslate 15 s fit', () => {
  assert.ok(inwallDigMs(10_000) > 10_000 && inwallDigMs(15_000) > 15_000)
  assert.strictEqual(inwallDigMs(null), 9500)
  assert.strictEqual(inwallDigMs(10 ** 6), 30_000)
  assert.strictEqual(lavaOver({ name: 'lava' }), true); assert.strictEqual(lavaOver({ name: 'stone' }), false); assert.strictEqual(lavaOver(null), false)
})
await t('C8 (Paper IW-G5) a refilling column retries at once; only a cell nothing could dig backs off; the cap covers a tall column', () => {
  assert.ok(INWALL_MAX_DIGS >= 8)
  const short = inwallBackoffMs({ stopped: 'freed' })
  assert.strictEqual(inwallBackoffMs({ stopped: 'still in gravel after 16 digs', digsDone: 16 }), short)
  assert.ok(inwallBackoffMs({ stopped: 'bedrock cannot be dug', digsDone: 0 }) > short)
  assert.ok(inwallBackoffMs({ stopped: 'lava over sand: not opened', digsDone: 0 }) > short)
  assert.ok(inwallBackoffMs({ stopped: 'dig failed on stone: dig exceeded', digsDone: 0 }) > short)
})
await t('C6 switches: TOMBEXIT=0 turns both parts off; TOMBEXIT_INWALL=0 only the dig; default on', () => {
  assert.strictEqual(tombexitOn({}), true); assert.strictEqual(inwallOn({}), true)
  assert.strictEqual(tombexitOn({ TOMBEXIT: '0' }), false); assert.strictEqual(inwallOn({ TOMBEXIT: '0' }), false)
  assert.strictEqual(tombexitOn({ TOMBEXIT_INWALL: 'off' }), true); assert.strictEqual(inwallOn({ TOMBEXIT_INWALL: 'off' }), false)
  assert.match(tombexitModeDetail({ TOMBEXIT: '0' }), /^on=0 inwall=0/)
})

// ---------------------------------------------------------------------------------------------- D. wiring (structural)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const RX = strip(readFileSync(REFLEX_PATH, 'utf8'))
// shafttrap-02 adds the walk-through stand-down just before the decline (tombDeclines stays LAST)
const armRx = /isEntombed\(bot\) && Date\.now\(\) >= airPocketBreatheUntil &&\s*!pocketing && !pocketPending && Date\.now\(\) - lastEscapeAt > ESCAPE_MIN_INTERVAL_MS &&\s*(?:!stairWalkThrough\(\) &&\s*)?!tombDeclines\(\)\) \{/
await t('D1 the entombed arm asks tombDeclines() LAST (only when it would fire)', () => {
  assert.match(RX, armRx)
})
await t('D2 the sampler notes a free cell only where isEntombed is false, and runs before the arm', () => {
  assert.match(RX, /if \(!isEntombed\(bot\)\) freeRing\.note\(pos, now\)/)
  assert.ok(RX.indexOf('freeRing.note(pos, now)') < RX.search(armRx), 'the sampler sits above the arm in the tick')
  assert.ok(RX.indexOf('if (airPocketing) return') < RX.indexOf('freeRing.note(pos, now)'))
})
await t('D3 the in-wall dig is fired, never awaited, by the tick; and the tick holds while it runs', () => {
  assert.match(RX, /if \(dec\.act === 'dig'\) \{ void runInwall\(dec\.why\); return \}/)
  assert.match(RX, /if \(inwalling\) return/)
})
await t('D4 the licence row is written at spawn', () => {
  assert.match(strip(readFileSync(INDEX_PATH, 'utf8')), /kind: 'tombexit_mode', status: 'success', snapshot: snapshot\(bot\), detail: tombexitModeDetail\(\)/)
})

// ---------------------------------------------------------------------------------------------- E. mutants
await t('E1 mutant: skip the component test -> A8 (sealed 6-long tunnel) would decline', () => withMutant(TE_PATH,
  '  if (!capped) return none(`closed component (${nodes} cells)`, nodes, found ? cellStr(found) : null)\n', '', m => {
    const r = m.walkBack({ at: makeWorld().corridorX(0, -5, 0, 0).at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) })
    assert.strictEqual(r.ok, true, 'the mutant must change the A8 verdict')
  }))
await t('E2 mutant: any ring cell counts, however near -> A12 would decline', () => withMutant(TE_PATH,
  'if (dist(f, start) >= minFree) freeKeys', 'if (true) freeKeys', m => {
    const w = makeWorld().room(-10, 10, -10, 10, 0)
    assert.strictEqual(m.walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([1, 0, 0]) }).ok, true)
  }))
await t('E3 mutant: no bound -> A13 declines forever', () => withMutant(TE_PATH,
  'if (area.n >= n) return', 'if (false) return', m => {
    const w = makeWorld().room(-6, 6, -6, 6, 0)
    let areas = []; const seen = []
    for (let i = 0; i < 3; i++) { const d = m.declineDecision({ at: w.at, feet: FEET(0, 0, 0), free: free([3, 0, 2]), areas, now: NOW }); areas = d.areas; seen.push(d.decline) }
    assert.deepStrictEqual(seen, [true, true, true])
  }))
await t('E4 mutant: an unknown floor counts as ground -> A10 would decline', () => withMutant(TE_PATH,
  'export const floorOk = b => !!b && b.boundingBox', 'export const floorOk = b => !b || b.boundingBox', m => {
    const w = tunnelDeadEnd(); for (let y = -1; y <= 2; y++) w.set(-8, y, 0, null)
    // with null floors walkable, the tunnel is still blocked by null BODY cells -- so open the body cells, null only the floor
    w.open(-8, 0, 0).open(-8, 1, 0)
    assert.strictEqual(walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) }).ok, false, 'base: an unknown floor is not ground')
    assert.strictEqual(m.walkBack({ at: w.at, feet: FEET(0, 0, 0), free: free([-5, 0, 0]) }).ok, true)
  }))
await t('E5 mutant: the in-wall dig ignores the health trend -> C2 would dig on a stale view', () => withMutant(TE_PATH,
  'healthThen - healthNow >= INWALL_DROP_HP', 'true', m => {
    assert.strictEqual(m.inwallDecision({ eye: shaped('stone', [[0, 0, 0, 1, 1, 1]]), healthNow: 20, healthThen: 20 }).act, 'dig')
  }))
await t('E6 mutant: the wiring test D1 fails when the arm stops asking', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const old = ' &&\n          !tombDeclines()) {'
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.ok(throws(() => assert.match(strip(src.replace(old, ') {')), armRx)))
})

console.log(`\ntombexit: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
