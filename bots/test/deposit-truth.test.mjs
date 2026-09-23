// THE REFUSAL WAS FALSE, AND THE BOT KEPT ASKING.
//
// MEASURED 2026-09-23 on the deployed build 9b572aa, full walk, 917,491 rows,
// 3,226 deposit runs over 54 bots in 24 h (isolated pools excluded):
//
//   2,079 runs ended `no_effect` with "nothing matching <item> to hand over".
//   THE BOT WAS CARRYING THE ITEM IN 2,078 OF THEM -- 100.0%.
//   The one true negative (a single `dirt` run) is the positive control that
//   says this check CAN answer "held none"; without it the 100% is an artefact.
//   1,874 of the 2,079 (90.1%) are a bot re-proposing an item it has already
//   been refused. One bot asked to deposit `apple` 151 times in that day.
//
// The REFUSAL is correct -- apples are food and food is not bankable. Its REASON
// was false, and a false reason is the one thing that cannot teach.
//
// These are BEHAVIOURAL tests. The source-grep tests in deposit-noop.test.mjs
// still pass against a patch that ships completely inert (the old string stays
// in the file as the fallback), which is this repo's `canary-can-ship-inert`
// failure verbatim -- so the last two run the REAL deposit path.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-deposit-truth'
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '28'; process.env.HOME_Y = '79'; process.env.HOME_Z = '0'

const { depositNoopReason, depositPlan } = await import('../src/bankable.mjs')
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const inv = o => Object.entries(o).map(([name, count], i) => ({ type: i + 1, name, count }))

// ---------------------------------------------------------- the pure function

await t('POSITIVE CONTROL: the function returns null when there IS something to bank', async () => {
  // Without this line every "it said the right thing" below could be a function
  // that returns a sentence unconditionally.
  const items = inv({ oak_log: 12 })
  assert.ok(depositPlan(items, 'oak_log').length > 0, 'fixture must be bankable, or the control is empty')
  assert.equal(depositNoopReason(items, 'oak_log'), null)
})

await t('HOLDING IT BUT UNBANKABLE: names the item, no count, no borrowed phrase', async () => {
  const r = depositNoopReason(inv({ apple: 30, oak_log: 12 }), 'apple')
  assert.match(r, /carrying apple/, `got: ${r}`)
  assert.match(r, /not a banking target/, `got: ${r}`)
  // NO COUNT. An embedded quantity splits one refusal into one distinct detail
  // string per amount held, and this project's own refusal reads bucket on
  // Counter(detail[:95]) (sneak.py, wo5.py) -- the biggest refusal on the fleet
  // would leave every top-N the day this shipped.
  assert.doesNotMatch(r, /\d/, `a number crept back into the message: ${r}`)
  // NOT the phrase prompt.mjs:619 already owns ("CARRYING: N items worth
  // banking", computed WITHOUT wants). The two land in the same prompt and read
  // as a flat contradiction with nothing naming the scope.
  assert.doesNotMatch(r, /worth banking/, `collides with prompt.mjs:619: ${r}`)
  assert.doesNotMatch(r, /nothing matching/, 'the false sentence must not survive')
})

// UNREACHABLE FROM THE FLEET, KEPT FOR CHAT. admission.mjs:326 refuses
// `deposit <item>` with deposit_item_missing before the skill ever runs, so a
// bot holding none cannot reach this branch; commands.mjs:105 (chat) can.
await t('HOLDING NONE: still says so, and does not claim a phantom stack', async () => {
  const r = depositNoopReason(inv({ oak_log: 12 }), 'apple')
  assert.match(r, /carrying no apple/, `got: ${r}`)
  assert.doesNotMatch(r, /worth banking/, 'held-none and held-but-unbankable are different sentences')
})

await t('THE TWO CASES ARE DISTINGUISHABLE -- which is the whole point', async () => {
  const held = depositNoopReason(inv({ apple: 30 }), 'apple')
  const none = depositNoopReason(inv({ oak_log: 12 }), 'apple')
  assert.notEqual(held, none, 'one string for two states is what shipped, and it taught nothing')
})

await t('ONE DEFINITION: the sentence cannot contradict the plan for any input admission can produce', async () => {
  // The previous attempt computed bankability twice and was refused in review
  // for it. Sweep every item the fixtures use against both entry points.
  const items = inv({ apple: 30, oak_log: 12, cobblestone: 40, iron_pickaxe: 1, chest: 3, raw_iron: 2 })
  for (const name of ['apple', 'oak_log', 'cobblestone', 'iron_pickaxe', 'chest', 'raw_iron', 'diamond']) {
    const planned = depositPlan(items, name).length > 0
    const said = depositNoopReason(items, name)
    assert.equal(planned, said === null,
      `${name}: depositPlan says ${planned ? 'bankable' : 'not'} but the sentence says ${said === null ? 'bankable' : JSON.stringify(said)}`)
  }
})

await t('A RESERVED ITEM IS NOT A MISSING ITEM: 8 cobblestone is the scaffold reserve', async () => {
  // cobblestone IS a standing target, but 8 are reserved to pillar out. The bot
  // holding exactly 8 was told it had none; it has eight and cannot spare them.
  const r = depositNoopReason(inv({ cobblestone: 8 }), 'cobblestone')
  assert.match(r, /carrying cobblestone/, `got: ${r}`)
  assert.match(r, /not a banking target/, `got: ${r}`)
})

await t('NO REMEDY IS SUGGESTED -- that machinery produced five findings in the last review', async () => {
  for (const r of [depositNoopReason(inv({ apple: 30 }), 'apple'),
                   depositNoopReason(inv({ oak_log: 12 }), 'apple'),
                   depositNoopReason(inv({ apple: 30 }), null)]) {
    assert.ok(r.length <= 120, `${r.length} chars: ${r}`)
    assert.doesNotMatch(r, /try |instead|you should|say deposit/i, `a remedy crept back in: ${r}`)
  }
})

// ------------------------------------------------- THE REAL SKILL, END TO END
// Reuses deposit-town.test.mjs's harness shape. Without these the patch can ship
// inert with every test above green: nothing else drives SKILLS.deposit.run.

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), clone: () => V(x, y, z) })

function depositBot(items) {
  const chestBlock = { position: V(30, 79, 0), type: 1 }
  const deposited = []
  const bot = {
    entity: { position: V(29, 79, 0), onGround: true, velocity: V(0, 0, 0) },
    health: 20, food: 20, version: '1.21.8',
    registry: { blocks: { 1: { name: 'chest' } }, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => items },
    assertNav: () => {},
    findBlock: () => chestBlock,
    blockAt: (p) => p && p.y > 79 ? { name: 'air', boundingBox: 'empty' } : { name: 'grass_block', boundingBox: 'block' },
    pathfinder: { movements: {}, setMovements() {}, setGoal() {}, stop() {}, goto: async () => {} },
    openContainer: async () => ({ deposit: async (type, _m, n) => deposited.push(n), close: () => {} }),
    on: () => {}, off: () => {}, once: () => {}, removeListener: () => {},
    waitForTicks: async () => {}, chat() {},
  }
  return { bot, deposited }
}
const run = (bot, args) => SKILLS.deposit.run({ bot }, args, new AbortController().signal)

await t('END TO END POSITIVE CONTROL: a bankable item still transfers', async () => {
  // If this fails, the two below prove nothing -- they would be measuring a
  // deposit path that never reaches the chest at all.
  const { bot, deposited } = depositBot(inv({ oak_log: 12 }))
  const r = await run(bot, { item: 'oak_log' })
  assert.equal(r.status, 'success', JSON.stringify(r))
  assert.deepEqual(deposited, [12])
})

await t('END TO END: `deposit apple` holding 30 apples gets the TRUE sentence', async () => {
  const { bot, deposited } = depositBot(inv({ apple: 30 }))
  const r = await run(bot, { item: 'apple' })
  assert.equal(r.status, 'no_effect', JSON.stringify(r))
  assert.equal(deposited.length, 0, 'the refusal itself is correct: apples are not banked')
  assert.match(r.detail, /carrying apple/, `THE FLEET STRING IS UNCHANGED -- patch is inert: ${r.detail}`)
  assert.doesNotMatch(r.detail, /nothing matching/, `the false sentence still ships: ${r.detail}`)
})

await t('END TO END: holding none of it is still reported as none', async () => {
  const { bot } = depositBot(inv({ apple: 30 }))
  const r = await run(bot, { item: 'diamond' })
  assert.equal(r.status, 'no_effect', JSON.stringify(r))
  assert.match(r.detail, /carrying no diamond/, `got: ${r.detail}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
