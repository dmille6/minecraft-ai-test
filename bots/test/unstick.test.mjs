/**
 * The bot hopping in a hole.
 *
 * Observed on instance #1, 2026-08-07: 73 stuck events in two hours, 74 "unstick
 * found a legal step", and ZERO failures -- while the same escape square was
 * chosen 8 times in a row. Stage 0 graded itself with "am I on a different block
 * than I started on", which a two-corner shuffle inside a pit satisfies every
 * single time. The rescue was reporting success for the wrong reason.
 *
 * These tests build the actual geometry that caused it: a 2x2 pit, floor at
 * y=70, walls to y=73, open sky above. A bot standing in it can legally reach
 * the other three floor squares and nothing else.
 */
import assert from 'node:assert'
import {
  escapeCandidates, unstickMemory, standableAt, cellKey,
  OSCILLATION_TRIES, OSCILLATION_RADIUS, UNSTICK_TABU_MAX,
} from '../src/reflex.mjs'

let passed = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); passed++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

/** Minimal Vec3 with only what reflex.mjs uses. */
class V {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z }
  offset(dx, dy, dz) { return new V(this.x + dx, this.y + dy, this.z + dz) }
  floored() { return new V(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) }
  equals(o) { return this.x === o.x && this.y === o.y && this.z === o.z }
  clone() { return new V(this.x, this.y, this.z) }
  distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) }
}

const AIR = { name: 'air', boundingBox: 'empty' }
const ROCK = { name: 'stone', boundingBox: 'block' }

/**
 * A 2x2 pit: floor y=70 at x,z in {0,1}, stone walls up to y=73, sky above.
 * Ground level outside the pit is y=74.
 */
function pitBot(at = new V(0, 71, 0)) {
  const inPit = (x, z) => (x === 0 || x === 1) && (z === 0 || z === 1)
  return {
    entity: { position: at },
    blockAt(p) {
      if (p.y <= 69) return ROCK                       // bedrock-ish floor
      if (inPit(p.x, p.z)) return p.y === 70 ? ROCK : AIR   // pit floor, then air
      if (p.y <= 73) return ROCK                       // the walls holding it in
      return AIR                                       // open sky at 74+
    },
  }
}

ok('the pit is genuinely inescapable sideways', () => {
  const bot = pitBot()
  const cands = escapeCandidates(bot)
  assert.ok(cands.length > 0, 'a bot in a pit can still walk within it')
  // Everything reachable is another pit floor square -- nothing climbs out.
  for (const c of cands) {
    assert.equal(c.pos.y, 71, `escape at y=${c.pos.y} should not exist; walls reach 73`)
    assert.ok((c.pos.x === 0 || c.pos.x === 1) && (c.pos.z === 0 || c.pos.z === 1),
      `${cellKey(c.pos)} is outside the pit -- the geometry is wrong`)
  }
})

ok('a tried square is not offered again', () => {
  const bot = pitBot()
  const first = escapeCandidates(bot)[0].pos
  const again = escapeCandidates(bot, new Set([cellKey(first)]))
  assert.ok(!again.some(c => cellKey(c.pos) === cellKey(first)),
    'the square that already failed was re-offered -- this is the 8x repeat bug')
})

ok('tabu can exhaust the pit entirely', () => {
  const bot = pitBot()
  const all = escapeCandidates(bot).map(c => cellKey(c.pos))
  assert.equal(escapeCandidates(bot, new Set(all)).length, 0,
    'exhausting every square must be observable, not silently fall back to the same pick')
})

ok('open ground still offers an escape that leaves the area', () => {
  const bot = { entity: { position: new V(0, 71, 0) },
                blockAt: p => (p.y <= 70 ? ROCK : AIR) }   // flat plain at y=71
  const cands = escapeCandidates(bot)
  assert.equal(cands.length, 8, 'on flat ground all eight neighbours are standable')
  assert.equal(cands[0].open, 4, 'most-open-first ordering still holds')
})

ok('memory is per-bot and never leaks between them', () => {
  const a = pitBot(), b = pitBot()
  unstickMemory(a).tried.push({ key: '1,2,3', at: Date.now() })
  assert.equal(unstickMemory(b).tried.length, 0,
    'one bot\'s failed escapes must not constrain another\'s')
  assert.equal(unstickMemory(a).tried.length, 1, 'and its own memory must survive')
})

ok('stale memory is forgotten', () => {
  const bot = pitBot()
  const m = unstickMemory(bot)
  m.tried.push({ key: '9,9,9', at: Date.now() - 10 * 60 * 1000 })   // 10m ago
  m.origins.push({ pos: new V(0, 71, 0), at: Date.now() - 10 * 60 * 1000 })
  const fresh = unstickMemory(bot)
  assert.equal(fresh.tried.length, 0, 'a square tried ten minutes ago is worth retrying')
  assert.equal(fresh.origins.length, 0, 'and an old origin must not count toward oscillation')
})

ok('memory is bounded', () => {
  const bot = pitBot()
  const m = unstickMemory(bot)
  for (let i = 0; i < UNSTICK_TABU_MAX + 20; i++) m.tried.push({ key: `${i},0,0`, at: Date.now() })
  assert.ok(unstickMemory(bot).tried.length <= UNSTICK_TABU_MAX,
    'a bot stuck for hours must not grow this list without bound')
})

ok('oscillation is detected only after repeats from the same place', () => {
  const bot = pitBot()
  const m = unstickMemory(bot)
  const here = new V(0, 71, 0)
  const near = () => m.origins.filter(o => o.pos.distanceTo(here) <= OSCILLATION_RADIUS)

  m.origins.push({ pos: new V(0, 71, 0), at: Date.now() })
  assert.ok(near().length < OSCILLATION_TRIES - 1, 'one prior attempt is not a pattern')
  m.origins.push({ pos: new V(1, 71, 1), at: Date.now() })
  assert.ok(near().length >= OSCILLATION_TRIES - 1,
    'two prior attempts within the radius is the third strike -- escalate to pillaring')
})

ok('a bot that genuinely travelled is not called oscillating', () => {
  const bot = pitBot()
  const m = unstickMemory(bot)
  m.origins.push({ pos: new V(0, 71, 0), at: Date.now() })
  m.origins.push({ pos: new V(200, 71, 200), at: Date.now() })
  const here = new V(400, 71, 400)
  assert.equal(m.origins.filter(o => o.pos.distanceTo(here) <= OSCILLATION_RADIUS).length, 0,
    'unsticking in three different places is three problems, not one loop')
})

ok('standable requires head clearance, not just feet', () => {
  const bot = { entity: { position: new V(0, 71, 0) },
                blockAt: p => (p.y === 70 ? ROCK : p.y === 72 ? ROCK : AIR) }
  assert.equal(standableAt(bot, new V(1, 71, 0)), false,
    'feet-clear but head-blocked was the original thrash-against-stone bug')
})

console.log(`\n${passed} passed`)
