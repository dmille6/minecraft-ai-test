// KEEPOUT-01 x IRONPICK-01 (JIT 10-22b): where keepout's exit order meets ironpick's kit order and its no-double-trip rule.
// The chain (cognitive.mjs): withdraw_pick steps aside while the kit's DRY run would make the iron pickaxe
// (toolkit.mjs withdrawDefersToKit); the kit's order -- the whole kit or ironpick's PREFIX (args.n) -- comes later; keepout's
// `_keepout_exit` is LAST and overrides every order for a body inside a live fire column, except a town job inside a column
// that covers the town (C12, KEEPOUT_TOWN_YIELD). Composed questions, behaviour only:
//   1. ironpick's prefix order is still a town job (`toolkit`), so C12's yield holds for it as for the whole kit;
//   2. the exit overriding a kit order never leaves the pickaxe need with no legal order: on the next decision the kit
//      either re-issues (its cooldown not charged) or, once it cannot, withdraw_pick fetches the stone copy as before.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
delete process.env.TOOLKIT_IRONPICK
import assert from 'node:assert/strict'
import test from 'node:test'

const KO = await import('../src/keepout.mjs')
const K = await import('../src/toolkit.mjs')
const { roomPlan } = await import('../src/withdrawpick.mjs')
const { tool, stack } = await import('./fakeworld.mjs')

const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
const site = { kind: KO.FIRE_KIND, x: 10, y: 60, z: 10, count: 4, deaths: 1, last: Date.now(), by: ['x'] }
const inside = { x: 11.5, y: 64, z: 10.5 }   // 1.5 from the centre, 4 above the site: inside the column
const kitBase = items => ({ now: 1e9, on: true, atTown: true, items, container: true, townMiss: false,
                            room: d => roomPlan(items, K.kitRoomTakes(d)).ok, tableNear: () => true, state: {} })

test('positive control: the body is in the column, and the column overrides a non-town order', () => {
  assert.ok(KO.columnAt([site], inside), 'inside')
  const d = KO.exitDecision({ sites: [site], pos: inside, skill: 'gather', yielded: () => true, yieldOn: true })
  assert.equal(d.start, true); assert.equal(d.why, 'inside')
})

test('ironpick\'s PREFIX order (n=1) is the skill `toolkit`, a town job: C12 yields for it as for the whole kit; no yield -> the exit', () => {
  const items = [T('stone_pickaxe', 100), stack('stick', 9)]
  const prefix = K.toolkitOrder({ ...kitBase(items), townMiss: d => d.ingots > 3, room: () => true }).order
  assert.deepEqual(prefix?.args, { credit: 0, n: 1 }, 'the prefix (ironpick-01)')
  const whole = K.toolkitOrder({ ...kitBase(items), room: () => true }).order
  assert.deepEqual(whole?.args, { credit: 0 }, 'CONTROL: the whole kit')
  for (const o of [prefix, whole]) {
    assert.equal(o.skill, 'toolkit'); assert.ok(KO.TOWN_JOB_SKILLS.has(o.skill), 'a town job')
    const y = KO.exitDecision({ sites: [site], pos: inside, skill: o.skill, yielded: () => true, yieldOn: true })
    assert.equal(y.start, false); assert.equal(y.why, 'town_job')
    assert.equal(KO.exitDecision({ sites: [site], pos: inside, skill: o.skill, yielded: () => false, yieldOn: true }).start, true, 'a column not covering the town: the exit')
    assert.equal(KO.exitDecision({ sites: [site], pos: inside, skill: o.skill, yielded: () => true, yieldOn: false }).start, true, 'KEEPOUT_TOWN_YIELD=0: the exit')
  }
})

test('THE REFUSAL CHAIN: withdraw_pick defers to the kit, the exit overrides the kit -- the next decision still has a legal order for the pickaxe', () => {
  const items = [T('stone_pickaxe', 20), T('iron_axe', 200), T('iron_shovel', 200), stack('stick', 9)]
  const o = kitBase(items)
  // decision 1: the dry run (state NOT kept) says the kit would make the pickaxe -> withdraw_pick steps aside
  const dry = K.toolkitOrder(o).order
  assert.equal(dry?.skill, 'toolkit')
  assert.equal(K.withdrawDefersToKit('pick', dry, items), true, 'withdraw_pick steps aside')
  // ... the real kit order is issued (its state kept: lastIssuedAt) and the exit replaces it (the body is in a non-town column)
  const issued = K.toolkitOrder(o)
  assert.equal(KO.exitDecision({ sites: [site], pos: inside, skill: issued.order.skill, yielded: () => false }).start, true, 'overridden')
  // decision 2, out of the column: the kit cannot re-issue within its cooldown -> its dry run is null -> withdraw_pick is NOT
  // deferred, so the pickaxe need still has an order (the stone copy, as before ironpick)
  const later = { ...o, now: o.now + 1000, state: issued.state }
  assert.equal(K.toolkitOrder(later).order, null, 'the kit on its cooldown')
  assert.equal(K.withdrawDefersToKit('pick', K.toolkitOrder(later).order, items), false, 'withdraw_pick runs')
  // ...and past the cooldown the kit is back
  const after = { ...o, now: o.now + K.TOOLKIT_COOLDOWN_MS + 1, state: issued.state }
  assert.equal(K.toolkitOrder(after).order?.skill, 'toolkit', 'the kit re-issues after its cooldown')
  assert.equal(KO.exitDecision({ sites: [site], pos: { x: 40.5, y: 64, z: 40.5 }, skill: 'toolkit' }).start, false, 'outside: no exit')
})
