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
function climbBot({ y = -42, rise = 0, borrowed = [], route = 'dig', gotos = [] } = {}) {
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
        return ok ? { status: 'success', path: [1, 2] } : { status: 'noPath', path: [1] }
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
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'stranded', r.detail)
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
  assert.match(r.detail, /even with digging allowed/, r.detail)
})

await t('a route that exists but is not followed is NOT called stranded', async () => {
  // goto resolves on an empty path. If the planner says walkable and the bot
  // still does not move, that is a traversal failure, and relabelling it
  // "walled in" would send the wrong remedy.
  const bot = climbBot({ y: -42, rise: 0, route: 'walk' })
  const r = await run(bot)
  assert.equal(r.failClass, 'path_interrupted', r.detail)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
