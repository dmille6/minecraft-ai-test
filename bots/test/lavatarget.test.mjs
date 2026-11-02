// LAVATARGET-01 (bots/src/lavatarget.mjs + knownTarget in skills.mjs): explore never heads for a sighting beside, or
// behind, lava this bot has seen. Behaviour first (the design's Paper scene as a unit test: an iron ore beside a lava pool
// the bot saw and a second, clear iron ore -- the variant picks the clear one, the base the nearer); then the ring, the
// feeding rule, the wiring (structural, comments stripped) and anchored mutants.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { knownTarget } = await import('../src/skills.mjs')
const { lavaBlocksTarget, makeLavaRing, noteLavaFinding, namesLava, lavatargetOn, lavatargetModeDetail, lavaRingOf,
        NEAR_R, RING_MS } = await import('../src/lavatarget.mjs')

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve().then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })
const LT_PATH = new URL('../src/lavatarget.mjs', import.meta.url)
const SK_PATH = new URL('../src/skills.mjs', import.meta.url)
const IX_PATH = new URL('../src/index.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-lt-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const botAt = (x, z, resources, lava = []) => {
  const bot = {
    entity: { position: { x, y: 64, z } },
    worldFacts: { resourcesNear: (kind, pos, radius) =>
      (resources[kind] ?? []).filter(r => Math.hypot(r.x - pos.x, r.z - pos.z) <= radius)
        .sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z)) },
  }
  const ring = lavaRingOf(bot)
  for (const c of lava) ring.note(c, Date.now())
  return bot
}
// the scene: iron A 40 east beside a pool at 43,40,0 the bot saw; iron B 80 north, clear
const SCENE = { iron_ore: [{ x: 40, y: 40, z: 0 }, { x: 0, y: 40, z: 80 }] }

await t('S1 the design scene: the variant heads for the CLEAR iron, not the nearer one beside seen lava', () => {
  const k = knownTarget(botAt(0, 0, SCENE, [[43, 40, 0]]))
  assert.strictEqual(k.kind, 'iron_ore'); assert.strictEqual(k.z, 80)
  assert.strictEqual(k.lavaSkipped, 1); assert.strictEqual(k.lavaFirst.why, 'near')
})
await t('S2 the positive control: with no lava seen, the nearer iron is chosen (today\'s behaviour)', () => {
  const k = knownTarget(botAt(0, 0, SCENE, []))
  assert.strictEqual(k.x, 40); assert.strictEqual(k.lavaSkipped, undefined)
})
await t('S3 a target whose straight bearing crosses seen lava is skipped (line), lava off the line is not', () => {
  const s = { iron_ore: [{ x: 60, y: 60, z: 0 }] }
  assert.strictEqual(knownTarget(botAt(0, 0, s, [[30, 62, 1]])).lavaFirst.why, 'line')
  assert.strictEqual(knownTarget(botAt(0, 0, s, [[30, 62, 9]])).x, 60, 'lava 8.5 off the line: still a target')
  assert.strictEqual(knownTarget(botAt(0, 0, s, [[30, 20, 0]])).x, 60, 'lava far below the band: still a target')
})
await t('S3b (Claude note) lava right beside the bot does not block every bearing: a target AWAY from it stays a target', () => {
  const s = { iron_ore: [{ x: -60, y: 64, z: 0 }] }
  assert.strictEqual(knownTarget(botAt(0, 0, s, [[1, 64, 0]])).x, -60)
  assert.ok(knownTarget(botAt(0, 0, { iron_ore: [{ x: 60, y: 64, z: 0 }] }, [[5, 64, 0]])).lavaSkipped, 'lava 5 out along the bearing still blocks it')
})
await t('S5b (Codex r1) cell to cell: lava at (45,43,0) is 5.83 from the ore at (40,40,0) -- skipped', () => {
  const k = knownTarget(botAt(0, 0, { iron_ore: [{ x: 40, y: 40, z: 0 }, { x: 0, y: 40, z: 80 }] }, [[45, 43, 0]]))
  assert.strictEqual(k.z, 80); assert.strictEqual(k.lavaFirst.why, 'near')
  assert.ok(Math.abs(k.lavaFirst.distance - Math.hypot(5, 3)) < 1e-9)
})
await t('S3c (Codex r2) lava right AHEAD of the bot still blocks the bearing behind it', () => {
  const bot = botAt(0.5, 0.5, { iron_ore: [{ x: 60, y: 64, z: 0 }, { x: -60, y: 64, z: 0 }] }, [[2, 64, 0]])
  const k = knownTarget(bot)
  assert.strictEqual(k.x, -60, 'the sighting behind the lava is skipped, the one away from it taken')
  assert.strictEqual(k.lavaFirst.why, 'line')
})
await t('S4 every sighting beside lava: no target; the skip is reported and explore falls back to its bearing', () => {
  const k = knownTarget(botAt(0, 0, { iron_ore: [{ x: 40, y: 40, z: 0 }] }, [[41, 40, 0]]))
  assert.strictEqual(k.kind, undefined); assert.strictEqual(k.lavaSkipped, 1)
})
await t('S5 NEAR_R is a 3-D distance: lava 6 above the ore counts, 7 does not', () => {
  assert.ok(lavaBlocksTarget({ target: { x: 0.5, y: 40.5, z: 0.5 }, lava: [{ x: 0, y: 40 + NEAR_R, z: 0 }] }))
  assert.strictEqual(lavaBlocksTarget({ target: { x: 0.5, y: 40.5, z: 0.5 }, lava: [{ x: 0, y: 47, z: 0 }] }), null)
})
await t('R1 the ring forgets after RING_MS and keeps the newest 256', () => {
  const r = makeLavaRing()
  r.note([1, 2, 3], 0); r.note({ x: 4, y: 5, z: 6 }, 1000)
  assert.strictEqual(r.cells(RING_MS + 500).length, 1)
  for (let i = 0; i < 300; i++) r.note([i, 0, 0], RING_MS + 600)
  assert.strictEqual(r.size, 256)
  assert.strictEqual(r.note([NaN, 0, 0], 0), false)
})
await t('R2 only a refusal that NAMES lava feeds the ring (not unknown cells, not drops, not safe verdicts)', () => {
  const bot = {}
  assert.strictEqual(noteLavaFinding(bot, { safe: false, why: 'lava_corridor: lava beside', at: [1, 2, 3] }), true)
  assert.strictEqual(noteLavaFinding(bot, { safe: false, why: 'blind_step: lava below', at: [4, 2, 3] }), true)
  assert.strictEqual(noteLavaFinding(bot, { safe: false, why: 'lava_corridor: unknown below', at: [5, 2, 3] }), false)
  assert.strictEqual(noteLavaFinding(bot, { safe: false, why: 'blind_step: drop of 9 ahead (limit 3)', at: [6, 2, 3] }), false)
  assert.strictEqual(noteLavaFinding(bot, { safe: true }), false)
  assert.strictEqual(bot.lavaSeenRing.size, 2)
  assert.strictEqual(namesLava('lava_corridor: unknown'), false)
})
await t('R3 LAVATARGET=0: no ring is made, nothing is noted', () => {
  assert.strictEqual(lavatargetOn({ LAVATARGET: '0' }), false); assert.strictEqual(lavaRingOf({}, { LAVATARGET: '0' }), null)
  assert.match(lavatargetModeDetail({ LAVATARGET: '0' }), /^on=0/); assert.match(lavatargetModeDetail({}), /^on=1/)
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
await t('W1 the corridor guard (index.mjs) and the blind-step guard (explore) feed the ring', () => {
  assert.match(strip(readFileSync(IX_PATH, 'utf8')), /if \(!v\.safe\) \{\s*try \{ bot\.pathfinder\.setGoal\(null\) \} catch \{\s*\}\s*try \{ noteLavaFinding\(bot, v\) \}/)
  assert.match(strip(readFileSync(SK_PATH, 'utf8')), /if \(!v\.safe\) noteLavaFinding\(bot, v\)/)
})
await t('W2 explore writes `_lavatarget_skip` when knownTarget skipped one', () => {
  assert.match(strip(readFileSync(SK_PATH, 'utf8')), /if \(known\?\.lavaSkipped\) \{[\s\S]{0,120}kind: 'lavatarget_skip'/)
})
await t('M1 mutant: knownTarget ignores the ring -> S1 picks the iron beside the lava', () => withMutant(SK_PATH,
  'try { lava = lavaRingOf(bot)?.cells(Date.now()) ?? [] } catch { lava = [] }', 'lava = []', m => {
    assert.strictEqual(m.knownTarget(botAt(0, 0, SCENE, [[43, 40, 0]])).x, 40)
  }))
await t('M2 mutant: the near test dropped -> S1 keeps the iron beside the lava', () => withMutant(LT_PATH,
  'if (d <= NEAR_R && (!best', 'if (false && (!best', m => {
    assert.strictEqual(m.lavaBlocksTarget({ from: { x: 0, y: 64, z: 0 }, target: { x: 40, y: 40, z: 0 }, lava: [{ x: 43, y: 40, z: 3 }] }), null)
  }))
await t('M3 mutant: any refusal feeds the ring -> R2\'s unknown cell would be noted', () => withMutant(LT_PATH,
  "/lava/.test(why) && !/unknown/.test(why)", '/lava/.test(why)', m => {
    assert.strictEqual(m.noteLavaFinding({}, { safe: false, why: 'lava_corridor: unknown below', at: [5, 2, 3] }), true)
  }))

console.log(`\nlavatarget: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
