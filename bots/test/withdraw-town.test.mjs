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
 * containers: [{ at: [x,y,z], items: [...], hang?: true, lid?: 'stone', double?: true, reject?: true }]
 * The bot starts at (200,62,200); containers are visible only once `home` has walked it to town,
 * unless `nearby` is set. The window is a real slot array: containerItems reads it, firstEmptySlotRange
 * honours its range, and moveSlotItem moves the item (or, with `reject`, leaves it, as a server that
 * refused the click would once its correction arrives).
 */
function withdrawBot({ containers, nearby = false, freeSlots = 5, held = [] }) {
  const log = { navAsserts: [], moved: [], withdrawn: [], closed: 0, opened: [], late: null, dug: [] }
  let atHome = nearby
  const blocks = containers.map(c => ({ ...c, name: 'chest', position: V(...c.at), type: 1 }))
  const window = c => {
    const start = c.double ? 54 : 27
    const slots = new Array(start + 36).fill(null)
    c.items.forEach(it => { slots[it.slot] = { ...it } })
    for (let i = start; i < start + 36 - freeSlots; i++) slots[i] = { name: 'dirt', count: 64, slot: i }
    return {
      inventoryStart: start, inventoryEnd: start + 36, slots,
      containerItems: () => slots.slice(0, start).filter(Boolean),
      firstEmptySlotRange: (lo, hi) => { for (let i = lo; i < hi; i++) if (!slots[i]) return i; return null },
      withdraw: async (type, _m, n) => log.withdrawn.push(n),
      close: () => { log.closed++ },
      reject: !!c.reject,
    }
  }
  const bot = {
    entity: { position: V(200, 62, 200), onGround: true, velocity: V(0, 0, 0) },
    health: 20, food: 20, version: '1.21.8',
    registry: { blocks: { 1: { name: 'chest' } }, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => held, emptySlotCount: () => freeSlots },
    assertNav: who => log.navAsserts.push(who),
    // mineflayer's matcher contract: the nearest block the matcher accepts, within range
    findBlock: ({ matching }) => (atHome ? blocks.find(b => matching(b)) : null) ?? null,
    blockAt: p => {
      const at = blocks.find(b => b.position.x === p.x && b.position.z === p.z && b.position.y === p.y)
      if (at) return at
      const under = blocks.find(b => b.position.x === p.x && b.position.z === p.z && b.position.y === p.y - 1)
      if (under?.lid && !log.dug.includes(`${p.x},${p.z}`)) return { name: under.lid, boundingBox: 'block', position: p }
      // BESIDE a lid: water when that chest is marked wetLid (never safe to dig), stone otherwise
      const besideLid = blocks.find(b => b.lid && b.position.y === p.y - 1 && Math.abs(b.position.x - p.x) + Math.abs(b.position.z - p.z) === 1)
      if (besideLid) return besideLid.wetLid ? { name: 'water', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' }
      return { name: 'air', boundingBox: 'empty' }
    },
    dig: async b => { log.dug.push(`${b.position.x},${b.position.z}`) },
    pathfinder: {
      movements: {}, setMovements() {}, setGoal() {}, stop() {},
      goto: async (goal) => {
        if (blocks.some(b => b.unreachable && goal?.x === b.position.x && goal?.z === b.position.z)) throw new Error('No path to the goal!')
        atHome = true; bot.entity.position = V(28, 79, 0)
      },
    },
    openContainer: async (b) => {
      log.opened.push(`${b.position.x},${b.position.z}`)
      if (b.hang) return new Promise(res => { log.late = () => res(window(b)) })   // opens only when the test says so
      const w = window(b)
      bot.currentWindow = b.stray ? window({ items: [] }) : w   // `stray`: another chest's late window got there first
      return w
    },
    moveSlotItem: async (from, to) => {
      log.moved.push([from, to])
      const w = bot.currentWindow
      if (w.reject) return
      // THE SAME OBJECT MOVES, AND ITS .slot IS REWRITTEN -- prismarine-windows' updateSlot does exactly this.
      // A fake that copied the item hid a real-server bug: the verification read best.slot AFTER the move.
      const it = w.slots[from]; w.slots[from] = null; it.slot = to; w.slots[to] = it
    },
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
  assert.equal(log.moved.length, 1)
  const [from, to] = log.moved[0]
  assert.equal(from, 5, 'the fullest copy is window slot 5')
  assert.ok(to >= 27 && to < 63, `destination ${to} is not in the window's player range`)
  assert.equal(bot.currentWindow.slots[to].durabilityUsed, 1, 'the 130-use copy is what landed')
  assert.deepEqual(log.withdrawn, [], 'a durable item is never taken with chest.withdraw, which takes the first by slot')
  assert.match(r.detail, /130 uses left/)
})

await t('3b. bestBankCopy: fullest first, lowest slot on a tie, empty -> null', () => {
  assert.equal(bestBankCopy([pick(1, 0), pick(130, 5)]).slot, 5)
  assert.equal(bestBankCopy([pick(50, 8), pick(50, 2)]).slot, 2)
  assert.equal(bestBankCopy([]), null)
})

await t('4. a window that never opens is container_open inside the bound, ENDS the sweep, and is closed when it arrives late', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [pick(90, 0)], hang: true },
    { at: [31, 79, 0], items: [pick(90, 0)] },
  ] })
  // Raced here, so an unbounded open FAILS this test instead of hanging the file until the runner kills it.
  let timer
  const r = await Promise.race([run(bot, { item: 'stone_pickaxe' }),
    new Promise(res => { timer = setTimeout(() => res({ status: 'HUNG' }), 12_000) })]).finally(() => clearTimeout(timer))
  assert.notEqual(r.status, 'HUNG', 'the open was not bounded: still waiting after 12 s')
  assert.equal(r.failClass, 'container_open', r.detail)
  assert.deepEqual(log.opened, ['30,0'], 'a second open after a timed-out one could be handed the late window')
  const before = log.closed
  log.late(); await new Promise(res => setImmediate(res))
  assert.equal(log.closed, before + 1, 'the window that arrived after the timeout was left open')
})

await t('4b. a lid that is not safe to dig is container_blocked, and the sweep moves on', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [pick(90, 0)], lid: 'stone', wetLid: true },
    { at: [33, 79, 0], items: [pick(20, 0)] },
  ] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(log.dug, [], 'a lid with water beside it must not be dug')
  assert.deepEqual(log.opened, ['33,0'], 'the blocked chest is never opened')
})

await t('4d. a window that is not this chest\'s is refused before anything moves', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [{ at: [30, 79, 0], items: [pick(90, 0)], stray: true }] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.failClass, 'container_open', r.detail)
  assert.deepEqual(log.moved, [], 'moved an item through a window that was not the chest it opened')
})

await t('4e. a chest that cannot be reached is chest_unreachable, which has no vote -- not no_path, which does', async () => {
  const { bot } = withdrawBot({ nearby: true, containers: [{ at: [30, 79, 0], items: [pick(90, 0)], unreachable: true }] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.failClass, 'chest_unreachable', r.detail)
  assert.equal(evidenceScope(r.failClass), null)
  assert.equal(evidenceScope('no_path'), 'action', 'control: no_path does vote, which is why the class matters')
})

await t('4c. control: a lid that IS safe to dig is dug, and that chest is opened', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [{ at: [30, 79, 0], items: [pick(90, 0)], lid: 'stone' }] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(log.dug, ['30,0'])
  assert.deepEqual(log.opened, ['30,0'])
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

await t('5c. no empty slot but a partial stack of the named item is room, not a refusal', async () => {
  const { bot, log } = withdrawBot({ freeSlots: 0, held: [{ name: 'stick', count: 20, stackSize: 64 }],
                                     containers: [{ at: [30, 79, 0], items: [stack('stick', 30, 0)] }] })
  const r = await run(bot, { item: 'stick', count: 4 })
  assert.notEqual(r.failClass, 'inventory_full', r.detail)
  assert.deepEqual(log.withdrawn, [4])
})

await t('5d. a double chest is one inventory: its other half is not spent as a second attempt', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [stack('dirt', 64, 0)], double: true },
    { at: [31, 79, 0], items: [stack('dirt', 64, 0)], double: true },   // the other half
    { at: [40, 79, 0], items: [stack('cobblestone', 64, 0)] },
    { at: [41, 79, 0], items: [pick(100, 0)] },
  ] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'success', `the third DISTINCT container should have been reached: ${r.detail}`)
  assert.deepEqual(log.opened, ['30,0', '40,0', '41,0'])
})

await t('5e. a move the server rejects is a failure, not a success -- and it ENDS the sweep', async () => {
  const { bot, log } = withdrawBot({ nearby: true, containers: [
    { at: [30, 79, 0], items: [pick(100, 2)], reject: true },
    { at: [31, 79, 0], items: [pick(100, 0)] },   // taking this too could leave the bot with two
  ] })
  const r = await run(bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'failed', r.detail)
  assert.equal(r.failClass, 'transfer_rejected')
  assert.deepEqual(log.opened, ['30,0'], 'the sweep went on after a transfer it could not verify')
})

// --- the seam -----------------------------------------------------------------------------------

const gateBot = () => ({
  registry: { blocksByName: {}, itemsByName: { stone_pickaxe: { id: 7 } } },
  entity: { position: { x: 28, y: 79, z: 0 } }, players: {}, inventory: { items: () => [] },
})
const proposal = { skill: 'withdraw', args: { item: 'stone_pickaxe', count: 16 } }

// 6. A DECISION, PINNED so it is re-made on purpose rather than undone by accident. The design asked
// for `#output('withdraw') = args.item`; both implementation reviews showed that exemption returns
// before the repeat guard, so a withdraw of an item in no chest would be re-admitted every 45 s,
// each time possibly a walk home. The seam is closed at the source instead (tests 7 below).
await t('6. withdraw is deliberately NOT milestone-exempt; its misses cannot accrue in the first place', () => {
  const file = '/tmp/test-withdraw-lessons.json'; try { fs.unlinkSync(file) } catch {}
  const L = new Lessons(file)
  L.data.avoid[actionKey('withdraw', proposal.args)] = { skill: 'withdraw', args: proposal.args, fails: 5, classes: {}, last: Date.now() }
  const hot = new AdmissionControl(L).check(proposal, gateBot(), new Set(['stone_pickaxe']))
  assert.equal(hot.ok, false, `withdraw became milestone-exempt: ${JSON.stringify(hot)} -- re-read the comment above before keeping that`)
  // and the control that the gate CAN exempt: a craft of the same item with the same record is admitted
  const craft = { skill: 'craft', args: { item: 'stone_pickaxe', count: 1 } }
  L.data.avoid[actionKey('craft', craft.args)] = { skill: 'craft', args: craft.args, fails: 5, classes: {}, last: Date.now() }
  const c = new AdmissionControl(L).check(craft, gateBot(), new Set(['stone_pickaxe']))
  assert.equal(c.kind, 'milestone_critical', `control failed: ${JSON.stringify(c)}`)
})

// THE CHAIN, NOT THE GUARD: five misses at the town chest, each routed exactly as cognitive.mjs
// routes a failure (evidenceScope decides whether recordFailure runs at all), must leave NO persistent
// rule. What this does NOT claim (Codex review): within a run, every failure still sets the 45 s
// failedCooldown and the repeat guard still counts admissions -- those throttles are wanted, and they
// forget. The claim is only that the misses never become a learned_avoid that outlives the run.
const chain = failClass => {
  const file = '/tmp/test-withdraw-chain.json'; try { fs.unlinkSync(file) } catch {}
  const L = new Lessons(file)
  for (let i = 0; i < 5; i++) {
    if (evidenceScope(failClass)) L.recordFailure('withdraw', proposal.args, failClass, { x: 28, y: 79, z: 0 })
  }
  return { fails: L.failCount('withdraw', proposal.args), next: new AdmissionControl(L).check(proposal, gateBot(), null) }
}

await t('7. five container_short misses at one chest leave no persistent rule: a new run admits the sixth', () => {
  for (const c of ['container_short', 'chest_unreachable', 'inventory_full', 'transfer_rejected', 'container_open', 'container_blocked']) {
    assert.equal(evidenceScope(c), null, `${c} has a vote`)
  }
  const { fails, next } = chain('container_short')
  assert.equal(fails, 0)
  assert.equal(next.ok, true, `withdraw was shut by its own misses: ${JSON.stringify(next)}`)
})

await t('7-control. the same five misses classed nothing_found DO shut it -- the instrument can see a presence', () => {
  const { fails, next } = chain('nothing_found')
  assert.ok(fails >= 4, `fails=${fails}`)
  assert.equal(next.ok, false, 'nothing_found at one coordinate should accrue to learned_avoid; if it does not, test 7 proves nothing')
  assert.equal(next.reason, 'learned_avoid')
})

await t('the contract budget covers the walk home', () => {
  assert.ok(SKILL_CONTRACTS.withdraw.maxMs >= 240_000, `withdraw.maxMs=${SKILL_CONTRACTS.withdraw.maxMs}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
