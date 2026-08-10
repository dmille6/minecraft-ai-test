// THE FLEET KEPT SOLVING ITS OWN EXTINCTION.
//
// Over one 5.9-hour run, three of six bots lived below sea level -- Scout01 at
// a mean y of -42 -- and the numbers down there are not survivable as a
// strategy:
//
//     nothing_found          263   (largest single failure class in the run)
//     _drowning_escaped      209/hr
//     craft                  permanently blocked on oak_log
//
// oak_log only grows above ground. The system already held every fact it
// needed: craft said "gather oak_log first", gather said "no oak_log within 32
// blocks", and every record carried y=-42. Nothing joined them -- and no action
// existed that would have helped if something had. `mine` only descends, and
// goto/explore use the travel config, whose canDig=false leaves A* almost no
// legal moves in deepslate.
import assert from 'node:assert'
import { SKILLS, SKILL_CONTRACTS } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a,b,c) => V(x+a,y+b,z+c),
                          distanceTo: o => Math.hypot(x-o.x,y-o.y,z-o.z), clone: () => V(x,y,z) })

// `route` says which config can reach the surface, which is exactly what the
// probe asks: 'walk' = reachable without digging, 'dig' = only with digging
// allowed, 'none' = neither.
function climbBot({ y = -42, rise = 0, borrowed = [], route = 'dig', gotos = [], partialOnly = false } = {}) {
  const TRAVEL = { kind: 'travel' }
  const ASCENT = { kind: 'ascent' }
  const bot = {
    entity: { position: V(10, y, 10) },
    health: 20, food: 20,
    inventory: { items: () => [] },
    registry: { itemsByName: {}, items: {}, blocks: {} },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    ascentMovements: ASCENT,
    pathfinder: {
      movements: TRAVEL,
      setMovements(m) { this.movements = m },
      getPathTo(moves) {
        const ok = route === 'walk' ? true : route === 'dig' ? moves === ASCENT : false
        // noPath and timeout still return a partial path, so the fake returns
        // one too -- a test that passes on path.length would be lying.
        if (ok) return { status: 'success', path: [1, 2] }
        // `partialOnly` models the REAL library: getPathTo advances the search
        // generator once, bounded by a 40ms tick slice, so underground it
        // almost always answers 'partial' rather than finishing.
        return { status: partialOnly ? 'partial' : 'noPath', path: [1] }
      },
      async goto() { gotos.push(bot.pathfinder.movements.kind); bot.entity.position = V(10, y + rise, 10) },
    },
    async withAscentMovements(fn) {
      borrowed.push('in')
      bot.pathfinder.setMovements(ASCENT)
      try { return await fn() } finally { bot.pathfinder.setMovements(TRAVEL); borrowed.push('out') }
    },
    chat() {},
  }
  return bot
}

const run = (bot) => SKILLS.surface.run({ bot }, {}, new AbortController().signal)

await t('the skill exists and is offered to the model', () => {
  assert.ok(SKILLS.surface, 'surface must be in the registry the prompt is built from')
  assert.ok(!SKILLS.surface.chatOnly, 'it must be selectable by the cognitive loop, not chat-only')
  assert.deepEqual(SKILL_CONTRACTS.surface.expects, ['position'],
    'its achievement is a change of position, so a no-op cannot read as success')
})

await t('a bot at y=-42 that reaches sea level succeeds', async () => {
  const bot = climbBot({ y: -42, rise: 105, route: 'dig' })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.match(r.detail, /climbed 105 blocks/, r.detail)
})

await t('the dig-capable config is borrowed and always given back', async () => {
  const borrowed = []
  await run(climbBot({ y: -42, rise: 105, borrowed, route: 'dig' }))
  assert.deepEqual(borrowed, ['in', 'out'],
    'canDig=true must not outlive the climb, or travel starts tunnelling again')
})

await t('a climb that goes nowhere is stranded, not success', async () => {
  // goto resolves on an empty path, so the promise says nothing. Only altitude does.
  const bot = climbBot({ y: -42, rise: 0, route: 'dig' })
  const r = await run(bot)
  // The property that matters is that going nowhere is NEVER success. The class
  // is `path_interrupted` rather than `stranded` here, and deliberately so: the
  // ascent planner finished and found a route, so the terrain is not the
  // problem -- the traversal is. `stranded` is reserved for both searches
  // completing and finding nothing, which is the only case that is genuinely
  // about the world and the only one allowed to become a lesson.
  assert.notEqual(r.status, 'success', 'zero altitude gained is not a climb')
  assert.equal(r.failClass, 'path_interrupted', r.detail)
})

await t('partial progress is distinct from going nowhere', async () => {
  const bot = climbBot({ y: -42, rise: 30, route: 'dig' })
  const r = await run(bot)
  assert.equal(r.failClass, 'travel_incomplete',
    'the store must not punish a climb that is working: ' + r.detail)
  assert.match(r.detail, /call again to continue/)
})

await t('a bot already at the surface is refused, not credited', async () => {
  const bot = climbBot({ y: 70 })
  const r = await run(bot)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'already_surfaced',
    'a no-op recorded as success clears the avoid rule that would stop it recurring')
})


// --- PROBE BEFORE DIGGING (the mindcraft pattern) --------------------------
//
// Digging changes the world permanently and this project's whole navigation
// stance is canDig=false, so taking the destructive branch when the ordinary
// one would have worked is a real cost, not a harmless shortcut.
await t('a walkable route is walked, and nothing is dug', async () => {
  const borrowed = [], gotos = []
  const bot = climbBot({ y: -42, rise: 105, route: 'walk', borrowed, gotos })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(borrowed, [], 'the dig-capable config must not be borrowed at all')
  assert.deepEqual(gotos, ['travel'], 'the climb must use the ordinary travel config')
  assert.match(r.detail, /without digging/, r.detail)
})

await t('digging is only used when walking cannot reach the surface', async () => {
  const gotos = []
  await run(climbBot({ y: -42, rise: 105, route: 'dig', gotos }))
  assert.deepEqual(gotos, ['ascent'], 'the dig branch is the fallback, not the default')
})

await t('when neither config can reach the surface it says so immediately', async () => {
  const gotos = [], borrowed = []
  const bot = climbBot({ y: -42, rise: 0, route: 'none', gotos, borrowed })
  const r = await run(bot)
  assert.equal(r.failClass, 'stranded')
  assert.deepEqual(gotos, [], 'a 1s probe must not become a 90s climb to learn the same thing')
  assert.deepEqual(borrowed, [])
  assert.match(r.detail, /both searches finished and found nothing/, r.detail)
})

await t('a route that exists but is not followed is NOT called stranded', async () => {
  // goto resolves on an empty path. If the planner says walkable and the bot
  // still does not move, that is a traversal failure, and relabelling it
  // "walled in" would send the wrong remedy.
  const bot = climbBot({ y: -42, rise: 0, route: 'walk' })
  const r = await run(bot)
  assert.equal(r.failClass, 'path_interrupted', r.detail)
})


// --- A PROBE MUST BE ASKED A QUESTION IT CAN ANSWER ------------------------
//
// The first version probed for GoalY(63) with a 1000ms budget. From y=-42 that
// is a 105-block vertical route; A* cannot find one in a second, so `surface`
// reported "no route to the surface even with digging allowed" -- a conclusion
// its evidence could not reach. Live, Scout01 at y=-42 and Gather02 at y=-2
// were told they were walled in, over and over, on that basis.
await t('a deep bot climbs in a bounded stage, not to sea level in one search', async () => {
  const asked = []
  const bot = climbBot({ y: -42, rise: 24, route: 'dig' })
  const realGetPath = bot.pathfinder.getPathTo
  bot.pathfinder.getPathTo = (m, goal, timeout) => {
    asked.push({ y: goal.y, timeout })
    return realGetPath(m, goal, timeout)
  }
  await run(bot)
  assert.ok(asked.length > 0, 'the probe should have run')
  const target = asked[0].y
  assert.ok(target < 0, `a bot at y=-42 should aim for a nearby stage, not 63 -- asked for ${target}`)
  assert.ok(asked[0].timeout >= 3000,
    `and the budget must fit the question: ${asked[0].timeout}ms`)
})

await t('a bot just under the surface still aims at sea level, not past it', async () => {
  const asked = []
  const bot = climbBot({ y: 55, rise: 8, route: 'walk' })
  const real = bot.pathfinder.getPathTo
  bot.pathfinder.getPathTo = (m, goal, t2) => { asked.push(goal.y); return real(m, goal, t2) }
  await run(bot)
  assert.equal(asked[0], 63, `a stage must never overshoot sea level, got ${asked[0]}`)
})


// --- A PROBE THAT SAYS "partial" HAS NOT SAID NO ---------------------------
//
// pathfinder's getPathTo advances the search generator exactly once, and each
// slice is capped at tickTimeout (40ms), so underground it answers `partial`
// for almost everything. Requiring status==='success' read "I have not finished
// thinking" as "there is no way out": surface reported stranded 28 times out of
// 28, including Miner01 at y=62 told there was no route to y=63 -- one block up.
await t('an unfinished search is not a refusal', async () => {
  const gotos = []
  const bot = climbBot({ y: -42, rise: 24, route: 'none', partialOnly: true, gotos })
  const r = await run(bot)
  assert.notEqual(r.failClass, 'stranded',
    'partial means the search was cut short, not that there is no way out')
  // And the point of the rewrite: an unfinished search must not stop the bot
  // from TRYING. Before it, 15 of 15 invocations returned unknown and the
  // altitude-judging code below was unreachable.
  assert.ok(gotos.length > 0, 'it must have attempted the climb anyway')
})

await t('an exhausted search IS a refusal', async () => {
  const gotos = []
  const bot = climbBot({ y: -42, rise: 0, route: 'none', partialOnly: false, gotos })
  const r = await run(bot)
  assert.equal(r.failClass, 'stranded',
    'noPath means the space was searched and there is genuinely no way up')
  assert.deepEqual(gotos, [], 'and a definite no should not cost a 90s attempt')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
