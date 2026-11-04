// SWIMCENTRE-01: a rising body is centred under the hole it rises through (src/swimcentre.mjs, design and evidence in
// docs/reports/swimcentre-01-2026-11-03.md). 56 of 63 drownings in 7 days died at y N.2 -- the 1.8-tall body pressed
// under a block two cells above the feet; 12 had an `up` route whose own column was open (the hitbox overlapped a capped
// neighbour and nothing moved it sideways) and 7 an `out` route that stalled at the column boundary.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { bodyColumns, caps, riseCentreTarget, riseCentreDecision, centreSteer, makeCentreSteer, swimCentreOn, CENTRE_TOL } from '../src/swimcentre.mjs'
import { drowningControls } from '../src/reflex.mjs'

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const SRC = new URL('../src/swimcentre.mjs', import.meta.url)
const REFLEX = new URL('../src/reflex.mjs', import.meta.url)
const POCKET = new URL('../src/airpocket.mjs', import.meta.url)

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---- a tiny water scene: blocks by absolute cell, and a water-physics body ------------------------------------------
const WATER = { name: 'water', boundingBox: 'empty' }, AIR = { name: 'air', boundingBox: 'empty' }, STONE = { name: 'stone', boundingBox: 'block' }
// a 2-deep water layer, feet y=58 head y=59, under a roof at y=60 everywhere EXCEPT the open columns listed; air above 60
function scene (open) {
  const isOpen = (x, z) => open.some(([ox, oz]) => ox === x && oz === z)
  return (x, y, z) => {
    if (y <= 57) return STONE
    if (y === 58 || y === 59) return WATER
    if (y === 60) return isOpen(x, z) ? WATER : STONE
    return AIR
  }
}
// the cap a body meets at its top: the lowest y >= 60 whose cell in ANY overlapped column has a collision box
function capTop (at, x, z) {
  let top = Infinity
  for (const [cx, cz] of bodyColumns(x, z)) for (let y = 60; y <= 62; y++) if (caps(at(cx, y, cz))) { top = Math.min(top, y); break }
  return top
}
// one physics tick in water: forward accelerates 0.02 toward the look yaw; inertia 0.8; jump rises 0.04/tick, capped
function step (b, at, ctl) {
  if (ctl.forward && b.look) {
    const dx = b.look.x - b.x, dz = b.look.z - b.z, d = Math.hypot(dx, dz) || 1
    b.vx += 0.02 * dx / d; b.vz += 0.02 * dz / d
  }
  b.vx *= 0.8; b.vz *= 0.8
  // horizontal collision with solid feet/head cells is not needed in these scenes (the water layer is open)
  b.x += b.vx; b.z += b.vz
  if (ctl.jump) b.vy = Math.min(0.1, b.vy * 0.8 + 0.04); else b.vy = b.vy * 0.8 - 0.02
  b.y = Math.min(b.y + b.vy, capTop(at, b.x, b.z) - 1.8)
  b.y = Math.max(b.y, 58)
}
const eyeInAir = (b, at) => at(Math.floor(b.x), Math.floor(b.y + 1.62), Math.floor(b.z)).name === 'air'
const routeOf = (b, at) => {   // the scan's answer, from the HEAD cell's column (as breathableRoute reads it)
  const hx = Math.floor(b.x), hz = Math.floor(b.z), hy = Math.floor(b.y + 1)
  for (let dy = 1; dy <= 4; dy++) {
    const c = at(hx, hy + dy, hz)
    if (c.name === 'air') return { dir: 'up', dist: dy, target: { x: b.x, y: hy + dy, z: b.z } }
    if (caps(c)) break
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (at(hx + dx, hy + 1, hz + dz).name !== 'stone') return { dir: 'out', dist: 1, target: { x: b.x + dx, y: hy + 1, z: b.z + dz } }
  }
  return { dir: null, sealed: true }
}
// run a controller for up to `ticks`; returns the tick the eye reached air (or null)
function run (b, at, decide, ticks = 600) {
  let ctl = { forward: false, jump: true }
  for (let t = 0; t < ticks; t++) {
    if (t % 10 === 0 || decide.perTick) ctl = decide(b, at, t)   // the reflex decides every 500 ms; a steerer every tick
    step(b, at, ctl)
    if (eyeInAir(b, at)) return t
  }
  return null
}
const oldControls = (b, at) => {   // today's rescue: drowningControls + the fractional target
  const route = routeOf(b, at)
  const c = drowningControls({ losing: true, route })
  if (c.lookAt) b.look = { x: c.lookAt.x, z: c.lookAt.z }
  return { forward: c.forward, jump: c.jump }
}
const newControls = Object.assign((b, at) => {   // the rescue with swimcentre: centre decided per tick
  const route = routeOf(b, at)
  const t = riseCentreTarget({ route, pos: { x: b.x, y: b.y, z: b.z }, at })
  if (!t) { const c = drowningControls({ losing: true, route }); if (c.lookAt) b.look = { x: c.lookAt.x, z: c.lookAt.z }; return { forward: c.forward, jump: true } }
  const s = centreSteer({ pos: { x: b.x, z: b.z }, vel: { x: b.vx, z: b.vz }, cx: t.cx, cz: t.cz })
  if (s.look) b.look = s.look
  return { forward: s.forward, jump: true }
}, { perTick: true })
const body = (x, z) => ({ x, y: 58.2, z, vx: 0, vy: 0, vz: 0, look: null })

await ta('S1 bodyColumns: centred = 1 column; flush at .3/.7 = 1; past the edge = 2; a corner = 4', () => {
  assert.deepEqual(bodyColumns(10.5, 20.5), [[10, 20]])
  assert.deepEqual(bodyColumns(10.7, 20.3), [[10, 20]])
  assert.deepEqual(bodyColumns(10.75, 20.5), [[10, 20], [11, 20]])
  assert.equal(bodyColumns(10.8, 20.1).length, 4)
  assert.deepEqual(bodyColumns(-3.1, -0.5), [[-4, -1], [-3, -1]])
})

await ta('S2 caps: water, bubble column, seagrass do not cap; stone, a waterlogged slab and an unreadable cell do', () => {
  assert.equal(caps(WATER), false); assert.equal(caps({ name: 'bubble_column', boundingBox: 'empty' }), false)
  assert.equal(caps({ name: 'seagrass', boundingBox: 'empty' }), false)
  assert.equal(caps(STONE), true); assert.equal(caps({ name: 'oak_slab', boundingBox: 'block' }), true); assert.equal(caps(null), true)
})

await ta('S3 riseCentreTarget: up + a capped overlapped neighbour -> own column (edge); up uncapped -> null; out -> the target column; sealed -> null', () => {
  const at = scene([[10, 20]])
  const edge = riseCentreTarget({ route: { dir: 'up' }, pos: { x: 10.8, y: 58.2, z: 20.5 }, at })
  assert.deepEqual([edge.cx, edge.cz, edge.why], [10, 20, 'edge'])
  assert.equal(riseCentreTarget({ route: { dir: 'up' }, pos: { x: 10.5, y: 58.2, z: 20.5 }, at }), null)
  const open2 = scene([[10, 20], [11, 20]])
  assert.equal(riseCentreTarget({ route: { dir: 'up' }, pos: { x: 10.8, y: 58.2, z: 20.5 }, at: open2 }), null, 'a straddle over two open columns rises anyway')
  const out = riseCentreTarget({ route: { dir: 'out', target: { x: 11.3, y: 60, z: 20.5 } }, pos: { x: 10.3, y: 58.2, z: 20.5 }, at })
  assert.deepEqual([out.cx, out.cz, out.why], [11, 20, 'out'])
  assert.equal(riseCentreTarget({ route: { dir: null, sealed: true }, pos: { x: 10.5, y: 58.2, z: 20.5 }, at }), null)
  const unknown = (x, y, z) => (x === 11 ? null : at(x, y, z))
  assert.equal(riseCentreTarget({ route: { dir: 'up' }, pos: { x: 10.8, y: 58.2, z: 20.5 }, at: unknown }).why, 'edge', 'an unreadable neighbour is not clear')
})

await ta('S4 centreSteer: inside the tolerance -> centred, no forward; far -> forward + a level look at the centre; coasting fast enough -> brake', () => {
  const c = centreSteer({ pos: { x: 10.6, z: 20.4 }, cx: 10, cz: 20 }); assert.equal(c.centred, true); assert.equal(c.forward, false)
  const f = centreSteer({ pos: { x: 10.95, z: 20.5 }, cx: 10, cz: 20 }); assert.equal(f.forward, true); assert.deepEqual(f.look, { x: 10.5, z: 20.5 })
  const b = centreSteer({ pos: { x: 10.95, z: 20.5 }, vel: { x: -0.1, z: 0 }, cx: 10, cz: 20 }); assert.equal(b.forward, false, '0.45 to go at 0.1/tick coasts 0.4')
})

await ta('S5 BEHAVIOUR (edge pin, route up): today\'s jump-only rescue never breathes in 30 s; centring breathes within 3 s', () => {
  const at = scene([[10, 20]])
  const old = run(body(10.8, 20.5), at, oldControls)
  assert.equal(old, null, `the old rescue breathed at tick ${old}: the scene does not reproduce the pin`)
  const neu = run(body(10.8, 20.5), at, newControls)
  assert.ok(neu != null && neu <= 60, `centring breathed at tick ${neu}`)
  const negative = run(body(-3.85, -7.5), scene([[-4, -8]]), newControls)
  assert.ok(negative != null && negative <= 60, `negative coordinates: tick ${negative}`)
})

await ta('S6 BEHAVIOUR (route out, air one column over): the centred stroke breathes within 3 s from anywhere in the capped cell', () => {
  const at = scene([[10, 21]])
  for (const z of [20.35, 20.5, 20.69]) {
    for (const x of [10.32, 10.5, 10.68]) {
      const t = run(body(x, z), at, newControls)
      assert.ok(t != null && t <= 60, `start ${x},${z}: tick ${t}`)
    }
  }
})

await ta('S7 the brake: arriving at full swim speed from 0.8 off, the body settles inside the tolerance and crosses the centre by < tol/2', () => {
  const b = { x: 11.3, z: 20.5, vx: -0.1, vz: 0 }
  let worst = 0
  for (let t = 0; t < 200; t++) {
    const s = centreSteer({ pos: b, vel: { x: b.vx, z: b.vz }, cx: 10, cz: 20 })
    if (s.forward) { b.vx += 0.02 * Math.sign(10.5 - b.x) }
    b.vx *= 0.8; b.x += b.vx
    if (b.x < 10.5) worst = Math.max(worst, 10.5 - b.x)
  }
  assert.ok(Math.abs(b.x - 10.5) <= CENTRE_TOL, `settled at ${b.x}`)
  assert.ok(worst < CENTRE_TOL / 2, `overshoot ${worst}`)
})

await ta('S8 the steerer: writes forward + a look per tick while aimed; lapses and clears ITS forward; yields at once when may() is false', () => {
  const writes = []; let t = 0; let mayOk = true
  const bot = { entity: { position: { x: 10.95, y: 58.2, z: 20.5, offset (dx, dy, dz) { return { x: this.x + dx, y: this.y + dy, z: this.z + dz } } }, velocity: { x: 0, z: 0 } },
                setControlState: (n, v) => writes.push([n, v]), lookAt: () => {}, on: () => {}, removeListener: () => {} }
  const ends = []
  const st = makeCentreSteer(bot, { now: () => t, emit: e => { if (e.phase === 'end') ends.push(e.how) }, may: () => mayOk })
  st.aim(10, 20, 'edge'); st.tick()
  assert.deepEqual(writes.at(-1), ['forward', true])
  t = 800; st.tick()
  assert.deepEqual(writes.at(-1), ['forward', false]); assert.deepEqual(ends, ['lapsed'])
  t = 1000; st.aim(10, 20, 'edge'); st.tick(); const n = writes.length
  mayOk = false; t = 1050; st.tick()
  assert.equal(writes.length, n, 'a yield must not write forward over the new owner'); assert.deepEqual(ends, ['lapsed', 'yielded'])
  assert.equal(st.active(), null)
})

await ta('S9 the switch: SWIMCENTRE=0 turns it off; unset or 1 is on', () => {
  assert.equal(swimCentreOn({}), true); assert.equal(swimCentreOn({ SWIMCENTRE: '1' }), true)
  assert.equal(swimCentreOn({ SWIMCENTRE: '0' }), false); assert.equal(swimCentreOn({ SWIMCENTRE: 'off' }), false)
})

await ta('S10 WIRED: the hold and the rescue both ask riseCentre before their stroke; the pocket rise centres on its own column', () => {
  const r = stripComments(readFileSync(REFLEX, 'utf8'))
  assert.equal((r.match(/const rc = holdState !== 'float' \? riseCentre\(airRoute\) : null/g) || []).length, 1, 'hold')
  assert.equal((r.match(/const rc = riseCentre\(route\)\n\s*const stroke = rc \?/g) || []).length, 1, 'rescue')
  assert.ok(/swimCentre\.aim\(d\.cx, d\.cz, d\.why\)/.test(r), 'riseCentre aims the steerer')
  assert.ok(/if \(d\.act === 'release'\) \{ swimCentre\.release\(d\.why\); return null \}/.test(r), 'a release decision releases the live aim')
  assert.ok(/if \(d\.act === 'guarded'\) \{\n\s*swimCentre\.release\('lava'\)/.test(r), 'a guard refusal releases the live aim')
  assert.ok(/const swimCentre = swimCentreOn\(\) \? makeCentreSteer\(bot,/.test(r), 'the steerer is made behind the switch')
  const p = stripComments(readFileSync(POCKET, 'utf8'))
  assert.ok(/const cs = centreSteer\(\{ pos, vel: bot\.entity\.velocity, cx: fx, cz: fz \}\)/.test(p), 'pocket rise')
})

await ta('S11 MUTANT KILLED: dropping the edge test (an `up` route never centres) re-pins the body (S5 catches it)', async () => {
  await withMutant(SRC, "  if (route.dir !== 'up') return null\n", "  if (route.dir !== 'up' || true) return null\n", async m => {
    const at = scene([[10, 20]])
    const dec = Object.assign((b, a) => {
      const route = routeOf(b, a); const tt = m.riseCentreTarget({ route, pos: b, at: a })
      if (!tt) return { forward: false, jump: true }
      const s = m.centreSteer({ pos: b, vel: { x: b.vx, z: b.vz }, cx: tt.cx, cz: tt.cz }); if (s.look) b.look = s.look; return { forward: s.forward, jump: true }
    }, { perTick: true })
    assert.equal(run(body(10.8, 20.5), at, dec), null, 'the mutant still breathed: S5 would not catch it')
  })
})

await ta('S12 MUTANT KILLED: no coast brake overshoots the centre by >= tol/2 (S7 catches it)', async () => {
  await withMutant(SRC, 'const forward = dist - coast * Math.max(0, vToward) > tol / 2', 'const forward = dist > tol / 2', async m => {
    const b = { x: 11.3, z: 20.5, vx: -0.1, vz: 0 }; let worst = 0
    for (let t = 0; t < 200; t++) {
      const s = m.centreSteer({ pos: b, vel: { x: b.vx, z: b.vz }, cx: 10, cz: 20 })
      if (s.forward) b.vx += 0.02 * Math.sign(10.5 - b.x)
      b.vx *= 0.8; b.x += b.vx; if (b.x < 10.5) worst = Math.max(worst, 10.5 - b.x)
    }
    assert.ok(worst >= CENTRE_TOL / 2, `the mutant overshot only ${worst}: S7 would not catch it`)
  })
})

await ta('S13 MUTANT KILLED: a steerer that ignores may() writes over the new owner (S8 catches it)', async () => {
  await withMutant(SRC, '    if (!ok) { wroteForward = false; end(\'yielded\'); return }\n', '', async m => {
    const writes = []; let t = 0
    const bot = { entity: { position: { x: 10.95, y: 58.2, z: 20.5, offset (dx, dy, dz) { return { x: this.x + dx, y: this.y + dy, z: this.z + dz } } }, velocity: { x: 0, z: 0 } },
                  setControlState: (n, v) => writes.push([n, v]), lookAt: () => {}, on: () => {} }
    const st = m.makeCentreSteer(bot, { now: () => t, may: () => false })
    st.aim(10, 20); st.tick()
    assert.ok(writes.some(([n, v]) => n === 'forward' && v === true), 'the mutant yielded anyway: S8 would not catch it')
  })
})

await ta('S14 THE REFUSAL CHAIN (riseCentreDecision): another owner -> release; no target -> release; lava on the stroke -> guarded; else aim', () => {
  const at = scene([[10, 21]])
  const route = { dir: 'out', target: { x: 10.4, y: 60, z: 21.4 } }
  const pos = { x: 10.4, y: 58.2, z: 20.4 }
  assert.deepEqual(riseCentreDecision({ may: () => false, route, pos, at }), { act: 'release', why: 'yielded' })
  assert.deepEqual(riseCentreDecision({ route: { dir: null, sealed: true }, pos, at }), { act: 'release', why: 'no_target' })
  const seen = []
  const lava = riseCentreDecision({ route, pos, at, guard: (feet, step) => { seen.push(step); return { safe: false, why: 'lava ahead', cell: [10, 58, 22] } } })
  assert.equal(lava.act, 'guarded'); assert.deepEqual(seen, [[0, 1]], 'the out stroke is swept toward +z')
  const ok = riseCentreDecision({ route, pos, at, guard: () => ({ safe: true }) })
  assert.deepEqual([ok.act, ok.cx, ok.cz, ok.why, ok.forward], ['aim', 10, 21, 'out', true])
  const edgeSeen = []
  riseCentreDecision({ route: { dir: 'up' }, pos: { x: 10.8, y: 58.2, z: 21.5 }, at: scene([[10, 21]]), guard: (f, st) => { edgeSeen.push(st); return { safe: true } } })
  assert.deepEqual(edgeSeen, [[0, 0]], 'centring inside the own column enters no new cell')
})

await ta('S15 B1 (composed): an aim followed by a guard refusal and its release -> no physics tick presses forward again', () => {
  const writes = []; let t = 0
  const bot = { entity: { position: { x: 10.4, y: 58.2, z: 20.4, offset (dx, dy, dz) { return { x: this.x + dx, y: this.y + dy, z: this.z + dz } } }, velocity: { x: 0, z: 0 } },
                setControlState: (n, v) => writes.push([n, v]), lookAt: () => {}, on: () => {} }
  const st = makeCentreSteer(bot, { now: () => t })
  const at = scene([[10, 21]]); const route = { dir: 'out', target: { x: 10.4, y: 60, z: 21.4 } }
  const decide = guardSafe => {   // reflex.mjs riseCentre, minus the bot plumbing
    const d = riseCentreDecision({ route, pos: bot.entity.position, at, guard: () => ({ safe: guardSafe }) })
    if (d.act === 'release') { st.release(d.why); return null }
    if (d.act === 'guarded') { st.release('lava'); return { forward: false } }
    st.aim(d.cx, d.cz, d.why); return { forward: d.forward }
  }
  decide(true); st.tick(); assert.deepEqual(writes.at(-1), ['forward', true])
  t = 500; const r = decide(false); assert.equal(r.forward, false)
  const n = writes.length
  for (t = 550; t <= 700; t += 50) st.tick()
  assert.ok(!writes.slice(n).some(([k, v]) => k === 'forward' && v === true), 'a stale aim pressed forward after the refusal')
  assert.equal(st.active(), null)
})

await ta('S16 WIRED (B2): the one predicate gating the decision and every tick excludes the escape, maroon, in-wall and stranded owners and a busy skill', () => {
  const r = stripComments(readFileSync(REFLEX, 'utf8'))
  const m = r.match(/const centreMay = \(\) => ([^\n]+\n[^\n]+)/)
  assert.ok(m, 'centreMay missing')
  for (const f of ['!airPocketing', '!pocketing', '!poolEscaping', '!rampSteering', '!dangerMovingNow()', '!escaping', '!marooned', '!inwalling', '!strandedRunning', '(rescuing || !runner?.isBusy?.())']) assert.ok(m[1].includes(f), `centreMay lacks ${f}`)
  assert.ok(/may: \(\) => centreMay\(\)/.test(r), 'the steerer uses it'); assert.ok(/riseCentreDecision\(\{ may: centreMay,/.test(r), 'the decision uses it')
})

await ta('S17 MUTANT KILLED: a decision that skips the lava guard aims through lava (S14 catches it)', async () => {
  await withMutant(SRC, "  if (!hv?.safe) return { act: 'guarded', why: 'lava', hv }\n", '', async m => {
    const d = m.riseCentreDecision({ route: { dir: 'out', target: { x: 10.4, y: 60, z: 21.4 } }, pos: { x: 10.4, y: 58.2, z: 20.4 }, at: scene([[10, 21]]), guard: () => ({ safe: false }) })
    assert.equal(d.act, 'aim', 'the mutant still refused: S14 would not catch it')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
