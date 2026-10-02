// GATHER MUST CARRY A DIG'S OUTCOME CLASS, NOT REWRITE IT AS A PATH FAILURE (Codex second pass on 35dd656).
//
// collectManually throws `unverified` (dig_unsettled: digsync could not say whether the server broke the block) and
// `dig_unconfirmed` (the server did not break it). gather's catch kept only the error TEXT, so after BARREN_LIMIT such
// rounds barrenFailClass(0, barren, 0) returned `no_path` -- which is in cognitive.mjs's EVIDENCE_ABOUT_THE_ACTION and
// becomes a persistent avoid rule -- for blocks the bot had REACHED and swung at. With one candidate the run ended on
// the all-excluded return instead, saying "could not stand within reach". And a dig_unsettled message with
// "(timeout)" in it was counted as a collect timeout by gather's /exceeded|timeout/ regex.
//
// Driven end to end: the real gather, the real collectManually, a synthetic world, and a digsync stub that answers
// what the real one would for the case under test.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.4')
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

function gatherBot (logs, waitResult, { digBreaks = false } = {}) {
  const world = new Map()
  const k = (x, y, z) => `${x},${y},${z}`
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) world.set(k(x, 63, z), 'stone')
  for (const [x, y, z] of logs) world.set(k(x, y, z), 'oak_log')
  const blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
    const name = world.get(k(x, y, z)) ?? 'air'
    const def = registry.blocksByName[name]
    return { name, type: def.id, stateId: def.defaultState, position: new Vec3(x, y, z), boundingBox: name === 'air' ? 'empty' : 'block',
             diggable: name !== 'air', hardness: def.hardness, material: def.material, harvestTools: def.harvestTools, drops: def.drops, metadata: 0 }
  }
  const bot = new EventEmitter()
  Object.assign(bot, {
    registry, version: '1.21.4', username: 't',
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8 },
    entities: {}, players: {}, heldItem: null, targetDigBlock: null, game: { gameMode: 'survival' },
    inventory: { items: () => [], slots: [] },
    blockAt, canDigBlock: b => !!b && b.name !== 'air',
    findBlocks: ({ matching }) => [...world].filter(([, n]) => registry.blocksByName[n].id === matching).map(([s]) => new Vec3(...s.split(',').map(Number))),
    findBlock: () => null, equip: async () => {}, dig: async b => { if (digBreaks) world.delete(k(b.position.x, b.position.y, b.position.z)) }, stopDigging: () => {}, nearestEntity: () => null,
    withGatherMovements: async fn => fn(),
    pathfinder: { movements: { canDig: true }, setGoal: () => {}, stop: () => {}, goto: async () => {},
                  getPathFromTo: () => ({ next: () => ({ value: { result: { status: 'success', path: [] } } }) }) },
    digSync: { waitSettled: async () => waitResult },
  })
  return bot
}
const FOUR = [[2, 64, 0], [-2, 64, 0], [0, 64, 2], [0, 64, -2]]
const run = (logs, res, o) => SKILLS.gather.run({ bot: gatherBot(logs, res, o) }, { block: 'oak_log', count: 1 }, new AbortController().signal)
const UNKNOWN = { broken: null, pending: false, why: 'restore-failed' }
const REFUSED = { broken: false, pending: false, why: 'server' }

await t('repeated UNKNOWN dig outcomes (barren limit) -> not no_path: unverified, an unknown status', async () => {
  const r = await run(FOUR, UNKNOWN)
  assert.notEqual(r.failClass, 'no_path', r.detail)
  assert.equal(r.failClass, 'unverified', r.detail); assert.equal(r.status, 'unknown')
  assert.doesNotMatch(r.detail, /unreachable/)
})
await t('repeated server REFUSALS (barren limit) -> dig_unconfirmed, not no_path', async () => {
  const r = await run(FOUR, REFUSED)
  assert.equal(r.failClass, 'dig_unconfirmed', r.detail)
})
await t('one candidate, UNKNOWN outcome (all-excluded return) -> unverified, not "could not stand within reach"', async () => {
  const r = await run([[2, 64, 0]], UNKNOWN)
  assert.equal(r.failClass, 'unverified', r.detail)
  assert.doesNotMatch(r.detail, /could not stand within reach/)
})
await t('a waitSettled TIMEOUT is not a collect timeout: no collect_budget from dig_unsettled prose', async () => {
  const r = await run(FOUR, { broken: null, pending: true, why: 'timeout' })
  assert.notEqual(r.failClass, 'collect_budget', r.detail)
  assert.equal(r.failClass, 'unverified', r.detail)
})
await t('positive control: a CONFIRMED dig (the block is gone) with no item gained is still an ordinary barren run (no_path), unchanged', async () => {
  const r = await run(FOUR, { broken: true, pending: false, why: 'server' }, { digBreaks: true })
  assert.equal(r.failClass, 'no_path', r.detail)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
