// WITHDRAW MUST WORK FROM A MINE, FROM THE RIGHT CHEST, AND HAND BACK A TOOL WORTH HOLDING.
//
// 124,894 items went into the banks and 48 a day came out. withdraw had four defects that only
// work as a set (see the comment above `withdraw` in skills.mjs): no walk home, an unbounded open,
// one container, and a durability-blind take. And one seam that would have killed the fix: after
// homing, every attempt happens at the same town chest, so a miss classed `nothing_found` never
// earns the place amnesty and four of them become a permanent learned_avoid. A miss is
// `container_short`, which has no vote.
//
// There was no withdraw test in the tree at all before this file; the deposit ones
// (deposit-town, chest-lid, storage-full) are the pattern.
import assert from 'node:assert'
import fs from 'node:fs'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-withdraw'
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '28'; process.env.HOME_Y = '79'; process.env.HOME_Z = '0'
const { SKILLS, SKILL_CONTRACTS, actionKey } = await import('../src/skills.mjs')
const { bestBankCopy } = await import('../src/bankable.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { evidenceScope } = await import('../src/cognitive.mjs')
const { classifyFailure } = await import('../src/state.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), clone: () => V(x, y, z) })
const pick = (uses, slot) => ({ name: 'stone_pickaxe', type: 7, count: 1, slot, maxDurability: 131, durabilityUsed: 131 - uses })
const stack = (name, count, slot) => ({ name, type: 9, count, slot })

/**
 * containers: [{ at: [x,y,z], items: [...], hang?: true, lid?: 'stone' }]
 * The bot starts at (200,62,200); containers are visible only once `home` has walked it to town,
 * unless `nearby` is set.
 */
function withdrawBot({ containers, nearby = false, freeSlots = 5 }) {
  const log = { navAsserts: [], moved: [], withdrawn: [], closed: 0, opened: [] }
  let atHome = nearby
  const blocks = containers.map(c => ({ ...c, position: V(...c.at), type: 1 }))
  const bot = {
    entity: { position: V(200, 62, 200), onGround: true, velocity: V(0, 0, 0) },
    health: 20, food: 20, version: '1.21.8',
    registry: { blocks: { 1: { name: 'chest' } }, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => [], emptySlotCount: () => freeSlots },
    assertNav: who => log.navAsserts.push(who),
    // mineflayer's matcher contract: the nearest block the matcher accepts, within range
    findBlock: ({ matching }) => (atHome ? blocks.find(b => matching(b)) : null) ?? null,
    blockAt: p => {
      const under = blocks.find(b => b.position.x === p.x && b.position.z === p.z && b.position.y === p.y - 1)
      if (under?.lid) return { name: under.lid, boundingBox: 'block', position: p }
      return p && p.y > 79 ? { name: 'air', boundingBox: 'empty' } : { name: 'water', boundingBox: 'empty' }   // water beside a lid: never safe to dig
    },
    pathfinder: {
      movements: {}, setMovements() {}, setGoal() {}, stop() {},
      goto: async () => { atHome = true; bot.entity.position = V(28, 79, 0) },
    },
    openContainer: async (b) => {
      log.opened.push(`${b.position.x},${b.position.z}`)
      if (b.hang) return new Promise(() => {})   // a window that never opens
      const items = b.items
      return {
        inventoryStart: 27, inventoryEnd: 63,
        containerItems: () => items,
        firstEmptySlotRange: () => (freeSlots > 0 ? 40 : null),
        withdraw: async (type, _m, n) => log.withdrawn.push(n),
        close: () => { log.closed++ },
      }
    },
    moveSlotItem: async (from, to) => log.moved.push([from, to]),
    setControlState() {}, lookAt: async () => {},
    on: () => {}, off: () => {}, once: () => {}, removeListener: () => {},
    waitForTicks: async () => {}, chat() {},
  }
  return { bot, log, walkedHome: () => log.navAsserts.includes('goto') }
}

const run = (bot, args) => SKILLS.withdraw.run({ bot }, args, new AbortController().signal)

await t('1. far from any chest, withdraw walks home, rescans, and takes the item', async () => {
  const { bot, log, walkedHome } = withdrawBot({ containers: [{ at: [30, 79, 0], items: [stack('stick', 20, 0)] }] })
  const r = await run(bot, { item: 'stick', count: 4 })
  assert.equal(walkedHome(), true, `should travel home first; got ${JSON.stringify(r)}`)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(log.withdrawn, [4])
})

await t('2. the named item is in the THIRD container, not the first', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [stack('cobblestone', 64, 0)] },
    { at: [31, 79, 0], items: [stack('dirt', 64, 0)] },
    { at: [32, 79, 0], items: [pick(100, 3)] },
  ] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(log.opened.length, 3, `opened ${log.opened.join(' ')}`)
  assert.equal(log.closed, 3, 'every window that opened must be closed')
  assert.match(r.detail, /container 3 of 3/)
})

await t('3. a chest holding a 1-use and a 130-use stone_pickaxe hands over the 130-use one, by WINDOW slot', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [{ at: [30, 79, 0], items: [pick(1, 0), pick(130, 5), pick(40, 9)] }] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(log.moved, [[5, 40]], 'the fullest copy (window slot 5) into the window\'s own player range')
  assert.deepEqual(log.withdrawn, [], 'a durable item is never taken with chest.withdraw, which takes the first by slot')
  assert.match(r.detail, /130 uses left/)
})

await t('3b. bestBankCopy: fullest first, lowest slot on a tie, empty -> null', () => {
  assert.equal(bestBankCopy([pick(1, 0), pick(130, 5)]).slot, 5)
  assert.equal(bestBankCopy([pick(50, 8), pick(50, 2)]).slot, 2)
  assert.equal(bestBankCopy([]), null)
})

await t('4. a window that never opens fails as container_open inside the bound, and the next container is tried', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [], hang: true },
    { at: [31, 79, 0], items: [pick(90, 0)] },
  ] })
  // Raced here, so an unbounded open FAILS this test instead of hanging the file until the runner kills it.
  let timer
  const r = await Promise.race([run(bot, { item: 'stone_pickaxe' }),
    new Promise(res => { timer = setTimeout(() => res({ status: 'HUNG' }), 12_000) })]).finally(() => clearTimeout(timer))
  assert.notEqual(r.status, 'HUNG', 'the open was not bounded: still waiting after 12 s')
  assert.equal(r.status, 'success', `the second container should have served it: ${r.detail}`)
  assert.deepEqual(log.opened, ['30,0', '31,0'])
})

await t('4b. a lid that is not safe to dig is container_blocked, and the sweep moves on', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [pick(90, 0)], lid: 'stone' },
    { at: [31, 79, 0], items: [pick(20, 0)] },
  ] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(log.opened, ['31,0'], 'the blocked chest is never opened')
})

await t('5. absent from all three -> container_short, and the prose does not re-mint nothing_found', async () => {
  const { bot } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [stack('cobblestone', 64, 0)] },
    { at: [31, 79, 0], items: [] },
    { at: [32, 79, 0], items: [stack('dirt', 64, 0)] },
    { at: [33, 79, 0], items: [pick(100, 0)] },   // a fourth exists and must NOT be tried
  ] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'container_short', r.detail)
  assert.notEqual(classifyFailure(r.detail), 'nothing_found', `the detail reads as nothing_found: ${r.detail}`)
  assert.match(r.detail, /3 container/)
})

await t('5b. a full inventory is refused BEFORE the walk, with a remedy the bot can perform', async () => {
  const { bot, walkedHome } = withdrawBot({ freeSlots: 0, containers: [{ at: [30, 79, 0], items: [pick(100, 0)] }] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.failClass, 'inventory_full')
  assert.equal(walkedHome(), false, 'no walk across the map to learn the pockets are full')
  assert.match(r.detail, /deposit/)
})

// --- the seam -----------------------------------------------------------------------------------

const gateBot = () => ({
  registry: { blocksByName: {}, itemsByName: { stone_pickaxe: { id: 7 } } },
  entity: { position: { x: 28, y: 79, z: 0 } }, players: {}, inventory: { items: () => [] },
})
const proposal = { skill: 'withdraw', args: { item: 'stone_pickaxe', count: 16 } }

await t('6. a withdraw with a 5-fail record is admitted as milestone_critical when the milestone wants the item', () => {
  const file = '/tmp/test-withdraw-lessons.json'; try { fs.unlinkSync(file) } catch {}
  const L = new Lessons(file)
  L.data.avoid[actionKey('withdraw', proposal.args)] = { skill: 'withdraw', args: proposal.args, fails: 5, classes: {}, last: Date.now() }
  const cold = new AdmissionControl(L).check(proposal, gateBot(), null)
  assert.equal(cold.ok, false, 'control: an unwanted 5-fail withdraw must be vetoed, or this test proves nothing')
  const hot = new AdmissionControl(L).check(proposal, gateBot(), new Set(['stone_pickaxe']))
  assert.equal(hot.ok, true, `milestone_critical did not fire: ${JSON.stringify(hot)}`)
  assert.equal(hot.kind, 'milestone_critical')
})

// THE CHAIN, NOT THE GUARD: five misses at the town chest, each routed exactly as cognitive.mjs
// routes a failure (evidenceScope decides whether recordFailure runs at all), must leave the sixth
// admissible with NO milestone exemption.
const chain = failClass => {
  const file = '/tmp/test-withdraw-chain.json'; try { fs.unlinkSync(file) } catch {}
  const L = new Lessons(file)
  for (let i = 0; i < 5; i++) {
    if (evidenceScope(failClass)) L.recordFailure('withdraw', proposal.args, failClass, { x: 28, y: 79, z: 0 })
  }
  return new AdmissionControl(L).check(proposal, gateBot(), null)
}

await t('7. five container_short misses at one chest leave the sixth withdraw admissible', () => {
  assert.equal(evidenceScope('container_short'), null)
  assert.equal(evidenceScope('inventory_full'), null)
  const r = chain('container_short')
  assert.equal(r.ok, true, `withdraw was shut by its own misses: ${JSON.stringify(r)}`)
})

await t('7-control. the same five misses classed nothing_found DO shut it -- the instrument can see a presence', () => {
  const r = chain('nothing_found')
  assert.equal(r.ok, false, 'nothing_found at one coordinate should accrue to learned_avoid; if it does not, test 7 proves nothing')
  assert.equal(r.reason, 'learned_avoid')
})

await t('the contract budget covers the walk home', () => {
  assert.ok(SKILL_CONTRACTS.withdraw.maxMs >= 240_000, `withdraw.maxMs=${SKILL_CONTRACTS.withdraw.maxMs}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
