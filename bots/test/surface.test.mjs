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

function climbBot({ y = -42, rise = 0, borrowed = [] } = {}) {
  const bot = {
    entity: { position: V(10, y, 10) },
    health: 20, food: 20,
    inventory: { items: () => [] },
    registry: { itemsByName: {}, items: {}, blocks: {} },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    pathfinder: {
      movements: {},
      setMovements(m) { this.movements = m },
      async goto() { bot.entity.position = V(10, y + rise, 10) },   // rise = what the climb achieves
    },
    async withAscentMovements(fn) { borrowed.push('in'); try { return await fn() } finally { borrowed.push('out') } },
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
  const bot = climbBot({ y: -42, rise: 105 })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.match(r.detail, /climbed 105 blocks/, r.detail)
})

await t('the dig-capable config is borrowed and always given back', async () => {
  const borrowed = []
  await run(climbBot({ y: -42, rise: 105, borrowed }))
  assert.deepEqual(borrowed, ['in', 'out'],
    'canDig=true must not outlive the climb, or travel starts tunnelling again')
})

await t('a climb that goes nowhere is stranded, not success', async () => {
  // goto resolves on an empty path, so the promise says nothing. Only altitude does.
  const bot = climbBot({ y: -42, rise: 0 })
  const r = await run(bot)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'stranded', r.detail)
})

await t('partial progress is distinct from going nowhere', async () => {
  const bot = climbBot({ y: -42, rise: 30 })
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

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
