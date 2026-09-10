// EXPLORE WALKED A RANDOM BEARING WHILE THE COORDINATES SAT ON DISK.
//
// Measured: explore was 36% of every decision the fleet made, succeeded 72.6%,
// and produced 11 items from 574 attempts -- 0.0 per success. Its contract is
// `position`, so walking 20 blocks satisfies it. A successful explore did not
// even improve the NEXT gather (22.5% vs 24.3%). Most-chosen action in the
// fleet, only one that produced nothing.
//
// Meanwhile the reflex layer had been writing resource sightings every 20s
// since it was built -- 200 per pool on disk, real coordinates for iron_ore,
// coal_ore, stone, oak_log -- and `resourcesNear` had ZERO callers. Same shape
// as `bot.waterMovements`: built, committed, never read.
//
// knownTarget is exported and pure-but-for-the-store-read precisely because a
// heading is the kind of decision a source-grep cannot check, and one that
// degrades silently to random if it breaks.
import assert from 'node:assert'
import test from 'node:test'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { knownTarget } = await import('../src/skills.mjs')

const botAt = (x, z, resources) => ({
  entity: { position: { x, y: 64, z } },
  worldFacts: { resourcesNear: (kind, pos, radius) =>
    (resources[kind] ?? []).filter(r => Math.hypot(r.x - pos.x, r.z - pos.z) <= radius)
      .sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z)) },
})

test('it picks the nearest known sighting', () => {
  const bot = botAt(0, 0, { iron_ore: [{ x: 300, y: 40, z: 0 }, { x: 100, y: 30, z: 0 }] })
  const t = knownTarget(bot)
  assert.equal(t.kind, 'iron_ore')
  assert.equal(t.x, 100, 'nearest first')
})

test('a sighting we are standing on is NOT worth exploring to', () => {
  // Under 24 blocks, gather can already see it. Walking there would burn the
  // decision that should have gathered it.
  const bot = botAt(0, 0, { iron_ore: [{ x: 6, y: 60, z: 0 }] })
  assert.equal(knownTarget(bot), null)
})

test('`toward` overrides the default preference order', () => {
  const bot = botAt(0, 0, {
    iron_ore: [{ x: 50, y: 40, z: 0 }],
    oak_log: [{ x: 200, y: 70, z: 0 }],
  })
  assert.equal(knownTarget(bot).kind, 'iron_ore', 'ore first by default')
  assert.equal(knownTarget(bot, 'oak_log').kind, 'oak_log', 'but the caller may name one')
})

test('no store, no position, or no sightings -> null, never a throw', () => {
  // The fallback must be the OLD random bearing, so explore is better-informed
  // rather than conditional on being informed.
  assert.equal(knownTarget({}), null)
  assert.equal(knownTarget({ entity: { position: { x: 0, y: 64, z: 0 } } }), null)
  assert.equal(knownTarget(botAt(0, 0, {})), null)
  const throws = { entity: { position: { x: 0, y: 64, z: 0 } },
                   worldFacts: { resourcesNear () { throw new Error('corrupt store') } } }
  assert.equal(knownTarget(throws), null, 'a broken store must not break travel')
})

test('explore still accepts an explicit heading and falls back to it', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = fs.readFileSync(path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'skills.mjs'), 'utf8')
  const exec = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(exec, /const known = knownTarget\(bot, toward\)/)
  assert.match(exec, /if \(known\) \{/, 'the known-target branch is conditional')
  assert.match(exec, /Number\.isFinite\(Number\(heading\)\)/,
    'the original bearing path survives for bots that have seen nothing')
})
