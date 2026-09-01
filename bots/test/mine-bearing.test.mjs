// THE STAIRCASE COULD ONLY EVER FACE ONE WAY.
//
// `mine` chose its bearing by reading the bot's yaw and snapping it to a
// cardinal. That is a sensor reading, not a decision: if the one direction it
// landed on had water in the tread, `mine` refused; the next decision cycle
// found the bot facing the same way, snapped to the same cardinal, and refused
// again. Three dry directions sat there untried.
//
// Full telemetry walk, 8.8M records, 80 bots:
//
//     mine records                            62,824
//     water refusals                           1,418
//     ...with distance_moved = 0               1,370   (96.6%)
//     ...in a streak of >=2 consecutive mines    249 streaks, longest 45
//     y at refusal                             61-63   (sea level is 63)
//
// distance_moved is Math.round of the whole-skill displacement and one stair
// step is 1.41 blocks, so a zero means the bot never took a step: the refusal
// happened at the FIRST tread, standing on dry land at a shoreline, where at
// least one cardinal runs inland. Not one of them was ever tried.
//
// These tests are about the CHOICE. The bearing is still chosen once and held
// for the whole descent -- that invariant was bought with a bug where a
// per-step bearing followed the swinging yaw and curled the stair into itself,
// and mine-staircase.test.mjs still guards it. What changed is that the choice
// now looks at the world before it is made.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { V, AIR, WATER, STONE } from './helpers/microworld.mjs'

const {
  SKILLS, stairBearing, stairBearings, stairLiquid, stairRunway, stairFlowRisk,
  chooseStairBearing, STAIR_LOOKAHEAD,
} = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const key = (x, y, z) => `${x},${y},${z}`

// --- the world --------------------------------------------------------------
//
// A SHORELINE, which is the only terrain this defect has ever been seen on.
// Solid below y=64, and a body of water occupying whatever cells `wet` names.
// The pathfinder only moves the bot when the cell it is sent to is genuinely
// open, because the failure being guarded against is a bot that digs and stays.
function shoreWorld ({ wet = () => false, yaw = 0 } = {}) {
  const carved = new Set()
  const digs = []
  const blockAt = p => {
    if (carved.has(key(p.x, p.y, p.z))) return AIR
    if (wet(p.x, p.y, p.z)) return WATER
    return p.y < 64 ? STONE : AIR
  }
  const bot = {
    entity: { position: new V(200, 64, 200), yaw },
    health: 20, food: 20, oxygenLevel: 300,
    heldItem: { type: 1 },
    blockAt: p => {
      const b = blockAt(p)
      return { ...b, position: new V(p.x, p.y, p.z), canHarvest: () => true,
               digTime: () => 100, harvestTools: undefined, material: 'rock' }
    },
    inventory: { items: () => [
      { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 },
      { name: 'cobblestone', count: 512 },
    ] },
    equip: async () => {},
    dig: async b => { digs.push(b.position); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        const at = new V(goal.x, goal.y, goal.z)
        if (blockAt(at) !== AIR || blockAt(at.offset(0, 1, 0)) !== AIR) return
        bot.entity.position = at
        bot.entity.yaw += 0.9        // a live pathfinder swings the facing
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    _digs: digs,
  }
  return bot
}

const run = (mine, bot, y) => mine.run({ bot }, { y }, new AbortController().signal)

// The bot starts at (200,64,200) facing yaw=0, which snaps to +z.
// `pond` floods the +z side only: the facing tread is wet, the other three dry.
const pond = (x, y, z) => z >= 201 && y <= 63 && y >= 50
// `lagoon` floods every cardinal's first tread. Nothing to choose.
const lagoon = (x, y, z) => y === 63 && (x !== 200 || z !== 200)
// `inlet` leaves the facing wet, the first perpendicular dry for exactly one
// step, and the other two dry all the way down.
const inlet = (x, y, z) =>
  (z >= 201 && y <= 63 && y >= 50) ||        // the facing (+z) is wet at once
  (x === 198 && z === 200 && y === 62)       // going -x runs dry for one step

const displacement = (bot, start) =>
  ({ dx: bot.entity.position.x - start.x, dz: bot.entity.position.z - start.z,
     drop: start.y - bot.entity.position.y })

// --- the pure chooser -------------------------------------------------------

await t('the four cardinals are offered facing-first, then the turns, then the reverse', () => {
  const b = shoreWorld()
  const order = stairBearings(b)
  assert.equal(order.length, 4, 'a stair has four ways to run and all four must be offered')
  assert.deepEqual(order[0], stairBearing(b), 'the way the bot faces must be tried first')
  assert.deepEqual(order[3], { x: -order[0].x, z: -order[0].z },
    'the reverse must be last: it is the one turn that walks back over the ground just crossed')
  const seen = new Set(order.map(o => `${o.x},${o.z}`))
  assert.equal(seen.size, 4, `duplicate bearings offered: ${JSON.stringify(order)}`)
  for (const o of order) {
    assert.equal(Math.abs(o.x) + Math.abs(o.z), 1,
      `diagonal bearing ${JSON.stringify(o)}: a diagonal tread needs two cells per step`)
  }
})

await t('the runway counts dry treads and stops at the first wet one', () => {
  const bot = shoreWorld({ wet: pond })
  const from = new V(200, 64, 200)
  assert.equal(stairRunway(bot, from, { x: 0, z: 1 }, 4), 0, 'the pond is one step ahead')
  assert.equal(stairRunway(bot, from, { x: 0, z: -1 }, 4), 4, 'inland is dry the whole way')
  assert.equal(stairRunway(bot, from, { x: 1, z: 0 }, 4), 4)
  assert.equal(stairRunway(bot, from, { x: -1, z: 0 }, 4), 4)
})

await t('the runway sees water in the HEADROOM, not only the tread', () => {
  // 73 of the fleet refusals named the headroom rather than the tread. A
  // lookahead that only checked feet would score those directions dry and hand
  // the loop a bearing the loop then refuses -- the livelock, one layer up.
  const bot = shoreWorld({ wet: (x, y, z) => x === 201 && y === 64 && z === 200 })
  assert.equal(stairRunway(bot, new V(200, 64, 200), { x: 1, z: 0 }, 4), 0,
    'water at head height over the first tread was scored as dry')
})

await t('the chooser takes the driest cardinal, not merely a passable one', () => {
  const bot = shoreWorld({ wet: inlet })
  const c = chooseStairBearing(bot, new V(200, 64, 200))
  assert.ok(c.runway >= STAIR_LOOKAHEAD,
    `chose a bearing with only ${c.runway} dry steps when a fully dry one existed`)
  assert.notDeepEqual(c.bear, { x: -1, z: 0 },
    'chose the direction that runs dry after one step')
})

await t('ties break toward the way the bot is already facing', () => {
  // Nothing is wet, so all four score the same. Turning for no reason costs a
  // walk the model did not ask for, and makes the stair unpredictable.
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const bot = shoreWorld({ yaw })
    assert.deepEqual(chooseStairBearing(bot, new V(200, 64, 200)).bear, stairBearing(bot),
      `yaw ${yaw} turned the stair away from the facing for no reason`)
  }
})

await t('runway 0 everywhere is reported as such, and is a fact about the SPOT', () => {
  const bot = shoreWorld({ wet: lagoon })
  const c = chooseStairBearing(bot, new V(200, 64, 200))
  assert.equal(c.runway, 0, 'water on all four first treads must score zero')
  assert.deepEqual(c.bear, stairBearing(bot), 'with nothing to choose, keep the facing')
})

await t('the chooser uses the guard\'s own liquid test and nothing wider', () => {
  // Widening a wetness predicate from `water` to kelp and seagrass on
  // 2026-08-29 multiplied drownings sevenfold and was rolled back. The chooser
  // must not re-open that: it refuses exactly what the guard refuses.
  assert.equal(stairLiquid({ name: 'water' }), true)
  assert.equal(stairLiquid({ name: 'lava' }), true)
  assert.equal(stairLiquid(null), false, 'an unloaded chunk is not a liquid')
  for (const n of ['seagrass', 'kelp', 'kelp_plant', 'bubble_column', 'water_cauldron', 'ice']) {
    assert.equal(stairLiquid({ name: n }), false, `${n} was treated as water`)
  }
})

await t('flow risk counts the liquid faces the stair would open, and never looks down', () => {
  // The neighbourhood mineflayer-pathfinder's dontCreateFlow and Baritone's
  // avoidAdjacentBreaking both use: above and the four horizontals. A block
  // sitting ON water is not a way in, and counting it would penalise every
  // descent over an aquifer for nothing.
  const dry = shoreWorld()
  assert.equal(stairFlowRisk(dry, new V(200, 64, 200), { x: 1, z: 0 }, 4), 0,
    'solid stone was scored as a flood risk')

  const under = shoreWorld({ wet: (x, y, z) => y === 62 && x === 201 && z === 200 })
  // (201,62,200) sits directly beneath the first tread at (201,63,200).
  assert.equal(stairFlowRisk(under, new V(200, 64, 200), { x: 1, z: 0 }, 1), 0,
    'water below a tread was counted; that is the check both upstreams skip')

  const beside = shoreWorld({ wet: (x, y, z) => y === 63 && x === 201 && z === 201 })
  assert.ok(stairFlowRisk(beside, new V(200, 64, 200), { x: 1, z: 0 }, 1) > 0,
    'water against the side of the first tread was not counted')
})

await t('among equally dry bearings it digs INLAND, not along the shore', () => {
  // The risk this fix creates: bots that used to refuse at a shoreline now
  // descend there. Two cardinals can both run four dry steps while one hugs the
  // water. Nothing here can add a refusal -- it only orders the survivors.
  //
  // The pond fills z >= 201. Facing +z is wet at the first tread and is out.
  // The remaining three all run four dry steps -- but +x and -x run along the
  // z=200 shore with the pond against their flank the whole way, and only -z
  // walks away from it.
  const bot = shoreWorld({ wet: pond })
  const c = chooseStairBearing(bot, new V(200, 64, 200))
  assert.equal(c.runway, STAIR_LOOKAHEAD, 'the chosen bearing must still be the driest')
  assert.deepEqual(c.bear, { x: 0, z: -1 },
    `chose ${JSON.stringify(c.bear)}; -z is the only bearing that walks away from ` +
    'the pond, and it is tied on dryness with the two that run along it')
  assert.equal(c.flow, 0, 'the inland bearing should expose no liquid faces at all')
})

await t('flow risk cannot turn into a refusal', () => {
  // mineflayer-collectblock sets dontCreateFlow = false on every single call
  // because as a veto it stops the bot doing anything. It is a tie-break here
  // and must stay one: a bearing with a dry run still wins however wet its
  // flanks are, when it is the only dry run there is.
  const bot = shoreWorld({ wet: (x, y, z) => y <= 63 && !(x === 200 && z <= 200) })
  const c = chooseStairBearing(bot, new V(200, 64, 200))
  assert.ok(c.runway > 0, 'the one dry corridor was refused because its flanks were wet')
  assert.ok(c.flow > 0, 'anchor: that corridor really is flanked by water')
})

// --- and the skill actually descends ----------------------------------------

await t('a bot facing a pond digs inland instead of refusing', async () => {
  const bot = shoreWorld({ wet: pond })
  const start = bot.entity.position.clone()
  const r = await run(SKILLS.mine, bot, 54)
  assert.equal(r.status, 'success', `got ${r.status}: ${r.detail}`)
  const { dx, dz, drop } = displacement(bot, start)
  assert.ok(drop >= 9, `descended only ${drop} blocks`)
  assert.ok(dz <= 0, `the stair ran into the pond (dz=${dz})`)
  const ratio = Math.hypot(dx, dz) / drop
  assert.ok(ratio > 0.9 && ratio < 1.1, `shape ratio ${ratio.toFixed(2)}, not a staircase`)
})

await t('the descent it chooses is still STRAIGHT: one bearing, held', async () => {
  const bot = shoreWorld({ wet: pond })
  const start = bot.entity.position.clone()
  await run(SKILLS.mine, bot, 54)
  const { dx, dz } = displacement(bot, start)
  assert.ok(dx === 0 || dz === 0,
    `stair wandered to (${dx}, ${dz}); a bearing that follows the swinging yaw ` +
    'curls the stair into itself and the bot digs through its own steps')
})

await t('the choice does not depend on the bot turning first', async () => {
  // A bearing is pure geometry: bot.dig looks at the block it is given and the
  // pathfinder walks the tread. The fixture never lets anything write yaw
  // except the pathfinder, so a fix that needed a physical turn would fail here.
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const bot = shoreWorld({ wet: pond, yaw })
    const yawBefore = bot.entity.yaw
    const r = await run(SKILLS.mine, bot, 60)
    assert.equal(r.status, 'success', `yaw ${yaw}: ${r.status} — ${r.detail}`)
    assert.ok(bot._digs.length > 0, `yaw ${yaw}: nothing was dug`)
    assert.equal(yawBefore, yaw, 'the fixture let something other than the pathfinder write yaw')
  }
})

await t('water everywhere still refuses, and the detail names the only move left', async () => {
  const bot = shoreWorld({ wet: lagoon })
  const r = await run(SKILLS.mine, bot, 54)
  assert.equal(r.status, 'failed', `got ${r.status}: ${r.detail}`)
  assert.equal(r.failClass, 'hazard_interrupt',
    'the class Kibana aggregates on must not shift under a detail change')
  assert.ok(/water in the (tread|headroom) ahead/.test(r.detail),
    `the prose the fleet has always emitted changed: ${r.detail}`)
  assert.ok(/every other direction/.test(r.detail),
    `a bot that cannot mine anywhere from here was not told so: ${r.detail}`)
  assert.ok(/goto/.test(r.detail),
    `the detail must name the thing to do instead: ${r.detail}`)
  assert.equal(bot._digs.length, 0, 'refused, but dug anyway')
})

await t('a refusal on a direction that was merely deep does NOT claim all four are wet', async () => {
  // The suffix is a claim about the entry cell. Attaching it to a refusal that
  // happened eight steps down would be a lie the model then acts on.
  const bot = shoreWorld({ wet: (x, y, z) => y === 56 })
  const r = await run(SKILLS.mine, bot, 40)
  assert.ok(/water in the/.test(r.detail), `expected a water refusal, got: ${r.detail}`)
  assert.ok(!/every other direction/.test(r.detail),
    `claimed every direction was wet after descending eight blocks: ${r.detail}`)
})

// --- THE MUTANTS ------------------------------------------------------------
//
// Each one rebuilds a specific piece of the original defect in the real source
// and re-imports it. `mutate` asserts the text it is replacing is actually
// there first: a mutant that silently fails to apply runs the FIXED code and
// reads as killed, which is the way this kind of test lies.
const SRC = path.join(here, '../src/skills.mjs')
const raw = fs.readFileSync(SRC, 'utf8')

async function withMutant (label, edits, fn) {
  let out = raw
  for (const [old, neu] of edits) {
    assert.ok(out.includes(old),
      `MUTANT "${label}" does not apply: the source no longer contains\n---\n${old}\n---`)
    const next = out.replace(old, neu)
    assert.notEqual(next, out, `MUTANT "${label}" replaced nothing`)
    out = next
  }
  // Written beside the real module so relative imports and node_modules both
  // resolve; the rewrite points its siblings back at src/.
  const file = path.join(here, `.mutant-${label.replace(/\W+/g, '-')}-${process.pid}.mjs`)
  fs.writeFileSync(file, out.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try {
    const mod = await import(pathToFileURL(file))
    return await fn(mod)
  } finally {
    fs.rmSync(file, { force: true })
  }
}
const pathToFileURL = p => new URL(`file://${p}?v=${Math.random()}`)

// The original bug, exactly: the bearing IS the yaw, and the world is not
// consulted before it is chosen.
await t('MUTANT: a bearing read from the yaw refuses the pond the real code descends', async () => {
  const dead = await withMutant('yaw-only', [[
    '  const choice = chooseStairBearing(bot, bot.entity.position.floored())',
    '  const choice = { bear: stairBearing(bot), runway: 1 }',
  ]], async mod => {
    const bot = shoreWorld({ wet: pond })
    const r = await run(mod.SKILLS.mine, bot, 54)
    return { r, digs: bot._digs.length }
  })
  assert.equal(dead.r.status, 'failed',
    'anchor: the mutant must reproduce the fleet failure, and did not')
  assert.equal(dead.r.failClass, 'hazard_interrupt')
  assert.ok(/water in the tread ahead/.test(dead.r.detail), dead.r.detail)
  assert.equal(dead.digs, 0, 'anchor: the fleet refusals dug nothing (distance_moved = 0)')

  const bot = shoreWorld({ wet: pond })
  const r = await run(SKILLS.mine, bot, 54)
  assert.equal(r.status, 'success', `the real implementation must descend: ${r.detail}`)
})

// The yaw is consulted but the alternatives are not offered.
await t('MUTANT: offering only the facing cardinal rebuilds the trap', async () => {
  const dead = await withMutant('one-candidate', [[
    '  return [q, (q + 1) % 4, (q + 3) % 4, (q + 2) % 4].map(i => CARDINALS[i])',
    '  return [CARDINALS[q]]',
  ]], async mod => {
    const bot = shoreWorld({ wet: pond })
    assert.equal(mod.stairBearings(bot).length, 1, 'anchor: the mutant offers one bearing')
    return run(mod.SKILLS.mine, bot, 54)
  })
  assert.equal(dead.status, 'failed', 'anchor: one candidate must refuse the pond')
  assert.ok(/water in the/.test(dead.detail), dead.detail)

  const bot = shoreWorld({ wet: pond })
  assert.equal((await run(SKILLS.mine, bot, 54)).status, 'success')
})

// Alternatives are offered, but the first passable one wins instead of the
// driest -- so the stair walks one step and refuses again.
await t('MUTANT: taking the first passable bearing stops one step in', async () => {
  const dead = await withMutant('first-passable', [[
    [
      '    if (!best || runway > best.runway || (runway === best.runway && flow < best.flow)) {',
      '      best = { bear, runway, flow }',
      '    }',
    ].join('\n'),
    '    if (!best || best.runway <= 0) best = { bear, runway, flow }',
  ]], async mod => {
    const bot = shoreWorld({ wet: inlet })
    const c = mod.chooseStairBearing(bot, new V(200, 64, 200))
    assert.deepEqual(c.bear, { x: -1, z: 0 },
      `anchor: the mutant must take the one-step bearing, took ${JSON.stringify(c.bear)}`)
    return run(mod.SKILLS.mine, bot, 54)
  })
  assert.notEqual(dead.status, 'success',
    'anchor: a one-step runway must not carry a descent to y=54')

  const bot = shoreWorld({ wet: inlet })
  const r = await run(SKILLS.mine, bot, 54)
  assert.equal(r.status, 'success',
    `the real implementation must pick the fully dry bearing: ${r.detail}`)
})

// --- the two predicates must not drift apart --------------------------------

await t('the guard inside mine calls the same predicate the chooser scored with', () => {
  // A chooser that disagrees with the guard picks a bearing the guard refuses:
  // the livelock returns with a lookahead scan bolted on to pay for it. Comments
  // are stripped first -- a source grep has been fooled by its own explanation
  // three times in this repo.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const i = src.indexOf('async function mine(')
  assert.ok(i > 0, 'mine moved; re-read this test')
  const body = src.slice(i, src.indexOf('\n}\n', i))
  assert.ok(/stairLiquid\(b\)/.test(body),
    'the stair guard no longer calls stairLiquid — it has its own liquid test again')
  assert.ok(!/b\.name === 'water'/.test(body),
    'an inline water comparison is back inside mine, beside the shared predicate')
  assert.ok(/chooseStairBearing\(/.test(body),
    'mine no longer chooses its bearing; it is reading the yaw again')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
