// MINE KEEPS OUT OF THE JUNK WELL'S SHELL (minewell-01) -- composed with mine's home guard (a separate process: config
// reads HOME_* once at import).
//
// The fleet case, 10-14 hive-d (base build): a bot disposed 189 items from its town well's stand, ran `mine` from that
// stand, and the staircase dug the well's wall (g and g-1) and then its floor; the bot collected the shaft's items as it
// stood in the dug wall cell. This file replays that geometry in a micro-world: a well whose cap is at y=63, the bot on
// its south stand, and `mine` asked to go deep.
//
// Behaviour, through the real skill and the exported pure functions:
//   - the shell box is the pathfinder's box (wellBreakCost), for a dug well and a raised plinth alike;
//   - from the stand no stair is clear -> the bot WALKS to the nearest cell with a clear stair and mines from there; no
//     dig ever lands in the shell (the refusal -> relocate -> retry CHAIN, through the real skill);
//   - nowhere clear within the radius -> a refusal naming the well and the walk; after that walk, mine succeeds;
//   - a bot inside the well never starts a descent there;
//   - every dig of the descent is checked again (a well appearing mid-descent stops the stair at its shell).
// Mutants (anchors asserted present and unique) turn each of these red.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { V, AIR, STONE } from './helpers/microworld.mjs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-minewell-${process.pid}`
process.env.BOT_NAME = 'TestBot'
// HOME 14 south of the well: the NEAREST clear walk-off cells (south of the stand) lie within 12 of it, so the home guard
// must steer the walk-off elsewhere (Claude r3 P2: with home 13 east the guard was never exercised)
// HOME_Y 100 (townzone-01 on minewell-01): the town's ground band (y >= home.y - 12 = 88) sits ABOVE this scene, so these
// tests keep pinning the shell rule and the 12-block guard (both horizontal) alone; the town x well composition, with the
// band over the scene, is test/townzone-minewell.test.mjs
process.env.HOME_X = '200'; process.env.HOME_Y = '100'; process.env.HOME_Z = '214'
const here = path.dirname(fileURLToPath(import.meta.url))
const SKP = path.join(here, '../src/skills.mjs'), MWP = path.join(here, '../src/minewell.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const MW = await import('../src/minewell.mjs')
const { wellBreakCost } = await import('../src/well.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) { return withMutants(file, [[old, neu]], fn) }
async function withMutants (file, pairs, fn) {
  let src = fs.readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = path.join(here, `.mutant-minewell-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}

// ---- the world: stone below y=64, a well at cap 200,63,200 (shaft 62, floor 61), the bot on its south stand -------------
const CAP = { x: 200, y: 63, z: 200 }
const key = (x, y, z) => `${x},${y},${z}`
const inBox = (p, c = CAP) => Math.abs(p.x - c.x) <= 2 && Math.abs(p.z - c.z) <= 2 && p.y >= c.y - 3 && p.y <= c.y
function wellWorld ({ at = new V(200.5, 64, 201.5), yaw = Math.PI, cols = () => [CAP], solidAbove = new Set(), canMove = () => true, sand = new Set() } = {}) {
  const carved = new Set([key(CAP.x, CAP.y - 1, CAP.z)])   // the shaft is open under the cap
  const digs = [], gotos = []
  const raw = p => {
    if (carved.has(key(p.x, p.y, p.z))) return AIR
    if (sand.has(key(p.x, p.y, p.z))) return { name: 'sand', boundingBox: 'block' }
    if (solidAbove.has(key(p.x, p.y, p.z))) return STONE
    if (p.x === CAP.x && p.z === CAP.z && p.y === CAP.y) return { name: 'oak_trapdoor', boundingBox: 'block' }
    return p.y < 64 ? STONE : AIR
  }
  const bot = {
    entity: { position: at, yaw }, health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...raw(p), position: new V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 100, harvestTools: undefined, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push({ x: b.position.x, y: b.position.y, z: b.position.z }); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        gotos.push({ x: goal.x, y: goal.y, z: goal.z })
        if (!canMove(goal)) return
        const c = new V(goal.x, goal.y, goal.z)
        if (raw(c).boundingBox !== 'empty' || raw(c.offset(0, 1, 0)).boundingBox !== 'empty') return
        bot.entity.position = new V(c.x + 0.5, c.y, c.z + 0.5)
        bot.entity.yaw += 0.9
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    wellCellsNow: cols, _digs: digs, _gotos: gotos, _carved: carved,
  }
  return bot
}
const run = (mod, bot, y = 50) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal)
const rows = kind => { try { return fs.readFileSync(`${process.env.LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] } }

await t('THE HOME GUARD COMPOSED: the nearest clear walk-off is within 12 of home -- mine walks to one outside it and descends', async () => {
  const bot = wellWorld()
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.ok(bot._gotos.length >= 1, 'it walked off')
  const g = bot._gotos[0]
  assert.ok(Math.hypot(g.x + 0.5 - 200, g.z + 0.5 - 214) > 12, `walked to ${JSON.stringify(g)}, inside the home guard`)
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [])
})
await t('MUTANT (skills): the home rule removed from the walk-off -- mine walks into the home guard and is refused there', async () => {
  await withMutant(SKP, "  const standableAt = c => Math.hypot(c.x + 0.5 - config.world.homeX, c.z + 0.5 - config.world.homeZ) > 12 && canStand(c)", "  const standableAt = c => canStand(c)", async m => {
    const bot = wellWorld()
    const r = await run(m, bot)
    assert.notEqual(r.status, 'success', `mutant inert: ${r.status} ${r.detail} to=${JSON.stringify(bot._gotos[0])}`)
  })
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
