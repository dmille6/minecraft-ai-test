// THE SHORE SCAN'S REACH, ITS COST, AND THE THIRD OUTCOME IT COULD NOT SAY.
//
// Twelve hours of Block 2 telemetry, 40 bots, Paper 1.21.8:
//
//     drowning escape rate            14.1%   (the capability gate needs >=50%)
//     _drowning_no_shore              1,572
//     _drowning_released_timeout      1,075
//
// `no_shore` never meant "there is no shore". It meant "there is no shore
// within TEN BLOCKS", which on an open lake is almost always false -- so the
// dominant failure was a bot floating safely, with full lungs, next to a bank
// it was never allowed to look at. Raising the radius is the fix; the rest of
// this file exists because raising it naively costs more than the tick has.
//
// A full square sweep at radius 24 is 2,401 columns and ~21,600 block reads,
// inside a 500ms tick that also owns health, hunger, entombment and stuck
// detection. So the scan is ordered by Chebyshev ring and stops as soon as no
// later ring COULD beat the best hit already held. These tests pin that the
// stopping rule is EXACT rather than merely early -- a first-hit-per-ring scan
// returns a shore that is not the nearest one, and the rescue then steers at it
// while a closer bank sits behind the bot.
//
// They also pin maxRise at 2. A larger rise finds taller banks, but a bot
// swimming at the surface clears about 1.25 blocks jumping out of water, so a
// 3-block rise aims the rescue at shore it can only reach in the log.
import assert from 'node:assert'
import { shoreRoute, drowningRelease } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c) })
const AIR = { name: 'air', boundingBox: 'empty' }
const WATER = { name: 'water', boundingBox: 'empty' }
const DIRT = { name: 'dirt', boundingBox: 'block' }

/** world(fn) -> a bot at 0,62,0 whose blockAt is fn(x,y,z). */
const world = (fn) => ({ entity: { position: V(0, 62, 0), onGround: false },
                         blockAt: (p) => fn(p.x, p.y, p.z) })

const openOcean = world((x, y) => (y <= 62 ? WATER : AIR))

// --- reach -----------------------------------------------------------------

t('a bank beyond the old radius is now found', () => {
  // 18 blocks out: invisible to the radius-10 scan that produced 1,572
  // "no shore" verdicts, and the single largest cause of them.
  const farBank = world((x, y) => (x >= 18 ? (y <= 62 ? DIRT : AIR)
                                           : (y <= 62 ? WATER : AIR)))
  const r = shoreRoute(farBank)
  assert.equal(r.dir, 'shore', 'a bank 18 blocks away must be reachable now')
  assert.ok(Math.abs(r.dist - 18) < 1.5, `expected ~18b, got ${r.dist}`)
})

t('the old radius genuinely could not see it', () => {
  // Guards against the test above passing for the wrong reason.
  const farBank = world((x, y) => (x >= 18 ? (y <= 62 ? DIRT : AIR)
                                           : (y <= 62 ? WATER : AIR)))
  assert.equal(shoreRoute(farBank, { radius: 10 }).dir, null,
    'if radius 10 finds this, the fixture is not testing the reach change')
})

t('open ocean still honestly reports no shore', () => {
  // A wider scan must not start inventing targets; open water is a real
  // failed rescue and must stay one.
  const r = shoreRoute(openOcean)
  assert.equal(r.dir, null)
  assert.equal(r.partial, false, 'a completed scan must not claim it was cut short')
})

// --- exactness of the ring stopping rule -----------------------------------

t('returns the NEAREST shore, not the first one a ring touches', () => {
  // Two banks: z<=-4 (distance 4) and x>=6 (distance 6). Scanning ring 4 in
  // dx-major order touches (-3,-4) at distance 5 BEFORE (0,-4) at distance 4.
  // A scan that returned on first hit would answer 5 and steer the bot away
  // from the closer bank. The ring must be completed before it is trusted.
  const twoBanks = world((x, y, z) => {
    if (z <= -4 || x >= 6) return y <= 62 ? DIRT : AIR
    return y <= 62 ? WATER : AIR
  })
  const r = shoreRoute(twoBanks)
  assert.equal(r.dir, 'shore')
  assert.ok(Math.abs(r.dist - 4) < 0.01,
    `nearest bank is 4b away; got ${r.dist} -- the scan returned mid-ring`)
  assert.equal(r.target.z, -4, `expected the z bank, got ${JSON.stringify(r.target)}`)
})

t('ring order agrees with an exhaustive scan', () => {
  // The strongest available check: same answer as brute force, much cheaper.
  const patchy = world((x, y, z) => {
    const land = (x === 7 && z === 7) || (x === -9 && z === 2) || (z === 11)
    return land ? (y <= 62 ? DIRT : AIR) : (y <= 62 ? WATER : AIR)
  })
  const ring = shoreRoute(patchy, { radius: 24 })
  let brute = Infinity
  for (let dx = -24; dx <= 24; dx++) {
    for (let dz = -24; dz <= 24; dz++) {
      if (!dx && !dz) continue
      const d = Math.hypot(dx, dz)
      if (d > 24 || d >= brute) continue
      for (let dy = 0; dy <= 2; dy++) {
        const below = patchy.blockAt(V(dx, 61 + dy, dz))
        const foot = patchy.blockAt(V(dx, 62 + dy, dz))
        const head = patchy.blockAt(V(dx, 63 + dy, dz))
        if (below?.boundingBox === 'block' && foot?.boundingBox === 'empty' &&
            head?.boundingBox === 'empty' && below.name !== 'water') { brute = d; break }
      }
    }
  }
  assert.ok(Math.abs(ring.dist - brute) < 0.01,
    `ring scan says ${ring.dist}, exhaustive scan says ${brute}`)
})

// --- height, deliberately NOT raised ---------------------------------------

t('a bank three blocks up is not shore', () => {
  // Reachable in the log, not in the water: jumping out of water clears ~1.25
  // blocks. Raising maxRise would convert honest no_shore verdicts into
  // to_shore events the bot cannot act on -- a metric fix wearing a bot fix.
  const highBank = world((x, y) => {
    if (x >= 5) return y <= 64 ? DIRT : AIR
    return y <= 62 ? WATER : AIR
  })
  assert.equal(shoreRoute(highBank).dir, null,
    'a 3-block ledge must not be offered to a swimming bot')
})

// --- the cost ceiling ------------------------------------------------------

t('a scan that runs out of budget says so', () => {
  const r = shoreRoute(openOcean, { maxReads: 30 })
  assert.equal(r.partial, true, 'a cut-short scan must be distinguishable')
  assert.equal(r.dir, null)
  assert.ok(r.scanned >= 30, `expected the budget to be spent, got ${r.scanned}`)
})

t('partial is never claimed when the scan completed', () => {
  // The caller caches only complete results. If `partial` were sticky or
  // defaulted wrong, a real "no shore" would never be cached, or -- far worse
  // -- a truncated scan would be cached as settled and a bank one ring past the
  // cutoff would stay invisible for the whole TTL.
  assert.equal(shoreRoute(openOcean, { maxReads: 0 }).partial, false)
  const lake = world((x, y) => (x >= 5 ? (y <= 62 ? DIRT : AIR) : (y <= 62 ? WATER : AIR)))
  assert.equal(shoreRoute(lake).partial, false)
})

t('a near bank costs a fraction of an open-ocean sweep', () => {
  // The entire reason for ring ordering. If these converge, the scan has
  // stopped being early-exiting and the tick budget is gone.
  const lake = world((x, y) => (x >= 5 ? (y <= 62 ? DIRT : AIR) : (y <= 62 ? WATER : AIR)))
  const near = shoreRoute(lake).scanned
  const far = shoreRoute(openOcean).scanned
  assert.ok(near * 10 < far,
    `near-shore scan cost ${near} reads vs ${far} for open ocean -- not early-exiting`)
})

// --- the release taxonomy --------------------------------------------------

t('reaching land is still the only escape', () => {
  const r = drowningRelease(true)
  assert.equal(r.kind, 'drowning_escaped')
  assert.equal(r.escaped, true)
  assert.equal(r.landed, true)
})

t('the two non-escapes are told apart', () => {
  // These want OPPOSITE fixes. A bot that ran the ceiling down swimming at a
  // bank failed at execution -- steer better, hold longer. A bot that surfaced
  // into open water with nowhere to stand never had a rescue to execute -- that
  // is a planner question, not a reflex one. Fusing them into one counter is
  // why 1,075 timeouts could not be acted on.
  const ceiling = drowningRelease(false, { reason: 'ceiling' })
  const stranded = drowningRelease(false, { reason: 'no_shore' })
  assert.equal(ceiling.kind, 'drowning_released_timeout')
  assert.equal(stranded.kind, 'drowning_surfaced_stranded')
  assert.notEqual(ceiling.kind, stranded.kind)
})

t('neither non-escape claims to have escaped', () => {
  for (const reason of ['ceiling', 'no_shore']) {
    const r = drowningRelease(false, { reason })
    assert.equal(r.escaped, false, `${reason} must not count as an escape`)
    assert.equal(r.landed, false)
    assert.equal(r.status, 'failed')
  }
})

t('the old boolean call still means timeout', () => {
  // escape-water-maroon.test.mjs asserts this two-argument-free contract, and
  // more importantly the caller must not silently change meaning if someone
  // drops the options object.
  assert.equal(drowningRelease(false).kind, 'drowning_released_timeout')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
