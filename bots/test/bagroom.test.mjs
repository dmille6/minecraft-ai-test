// BAGROOM-01 (src/bagroom.mjs has the measurement): the build order's room refusal composed with the junk well's 34-slot order left
// a dead band (29-33 slots: no build, no dispose); and a drawn share in a full bag was spendable only by the visit the room rule
// refused. Behaviour first (the pure decisions and the composed chain: wellOrder at the band, buildOrder's room ask), then
// anchored mutants of the three executable lines, then the wiring (structural: the ask installed, the dispatch, the licence row).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-bagroom-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const BR = await import('../src/bagroom.mjs')
const W = await import('../src/well.mjs')
const S = await import('../src/shop.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }

const BAGROOM_PATH = new URL('../src/bagroom.mjs', import.meta.url)
const WELL_PATH = new URL('../src/well.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const FEATURES_PATH = new URL('../src/features.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const NOW = 10_000_000
const well0 = { open: false, attended: false }
const order = (mod, x) => mod.wellOrder({ now: NOW, distHome: 5, well: well0, slots: 30, freeSlots: 6, junkStacks: 3, bagRoom: true, ...x }).order

await t('the restated room equals the build order\'s own (shop.mjs SHOP_BAG_SLOTS_MIN)', () => {
  assert.equal(BR.BUILD_ROOM_SLOTS, S.SHOP_BAG_SLOTS_MIN)
})

await t('SWITCHES: on in the showcase pool by default, off elsewhere; BAGROOM=off rolls back both, each half has its own off', () => {
  // batch-14c release (owner stoneworks plan): the WELL half is off unless BAGROOM_WELL=on
  assert.deepEqual(BR.bagRoomSwitches({}, 'showcase'), { on: true, well: false, share: true, bank: true })
  assert.deepEqual(BR.bagRoomSwitches({ BAGROOM_WELL: 'on' }, 'showcase'), { on: true, well: true, share: true, bank: true })
  assert.deepEqual(BR.bagRoomSwitches({}, 'board-a'), { on: false, well: false, share: false, bank: false })
  assert.deepEqual(BR.bagRoomSwitches({ BAGROOM: 'off' }, 'showcase'), { on: false, well: false, share: false, bank: false })
  assert.deepEqual(BR.bagRoomSwitches({ BAGROOM: 'on' }, 'board-a'), { on: true, well: false, share: true, bank: true })
  assert.deepEqual(BR.bagRoomSwitches({ BAGROOM_WELL: 'off' }, 'showcase'), { on: true, well: false, share: true, bank: true })
  assert.deepEqual(BR.bagRoomSwitches({ BAGROOM_SHARE: '0' }, 'showcase'), { on: true, well: false, share: false, bank: true })
  assert.match(BR.bagRoomModeDetail({ on: true, well: true, share: false, bank: true }), /^on=1 well=1 share=0 bank=1 room=8 /)
  assert.deepEqual(BR.bagRoomSwitches({ BAGROOM_BANK: 'off' }, 'showcase'), { on: true, well: false, share: true, bank: false })
})

await t('WELL: due in the dead band (free < 8, a whole stack the well would take); never with room, never with nothing to throw, never off', () => {
  assert.equal(BR.wellRoomDue({ on: true, freeSlots: 6, junkStacks: 3 }), true)
  assert.equal(BR.wellRoomDue({ on: true, freeSlots: 7, junkStacks: 1 }), true)
  assert.equal(BR.wellRoomDue({ on: true, freeSlots: 8, junkStacks: 3 }), false)
  assert.equal(BR.wellRoomDue({ on: true, freeSlots: 6, junkStacks: 0 }), false)
  assert.equal(BR.wellRoomDue({ on: false, freeSlots: 6, junkStacks: 3 }), false)
})

await t('THE CHAIN: at 30 of 36 slots with at-cap stacks the well order disposes (it waited for 34); off, the base exactly', () => {
  assert.equal(order(W, {})?.skill, 'dispose_well')
  assert.match(order(W, {}).why, /bagroom: the build needs the room/)
  assert.equal(order(W, { bagRoom: false }), null, 'BAGROOM_WELL=off: below 34 nothing, as before')
  assert.equal(order(W, { slots: 28, freeSlots: 8 }), null, 'the build has its room: no early dispose')
  assert.equal(order(W, { junkStacks: 0 }), null, 'nothing the well may take (below the cap, no junk): no order')
  assert.equal(order(W, { distHome: 60 }), null, 'never away from town')
  assert.equal(order(W, { slots: 34, freeSlots: 2, bagRoom: false })?.skill, 'dispose_well', 'the 34-slot order is unchanged')
  assert.equal(order(W, { slots: 34, freeSlots: 2 }).why.includes('bagroom'), false)
  // the cooldown still governs it: an order issued now is not issued again within DISPOSE_COOLDOWN_MS
  const r1 = W.wellOrder({ now: NOW, distHome: 5, well: well0, slots: 30, freeSlots: 6, junkStacks: 3, bagRoom: true })
  const r2 = W.wellOrder({ now: NOW + 60_000, distHome: 5, well: well0, slots: 30, freeSlots: 6, junkStacks: 3, bagRoom: true, state: r1.state })
  assert.equal(r2.order, null)
})

await t('THE CHAIN: the at-cap plan is what the band throws -- cobble above 64 at the cap, never below it (disposePlan unchanged)', () => {
  const bag = [{ slot: 9, name: 'cobblestone', count: 64 }, { slot: 10, name: 'cobblestone', count: 64 }, { slot: 11, name: 'cobblestone', count: 64 }, { slot: 12, name: 'cobbled_deepslate', count: 40 }]
  const atCap = W.disposePlan(bag, { cobbleAtCap: true })
  const below = W.disposePlan(bag, { cobbleAtCap: false })
  assert.ok(atCap.junkStacks >= 3, `at the cap the band has stacks to throw: ${atCap.junkStacks}`)
  assert.equal(below.junkStacks, 0, 'below the cap the deposit banks cobble: the well takes none')
  const kept = bag.reduce((t, it) => t + it.count, 0) - atCap.stacks.reduce((t, s) => t + s.count, 0)
  assert.ok(kept >= W.COBBLE_WELL_RESERVE, `the bot keeps its own ${W.COBBLE_WELL_RESERVE}: kept ${kept}`)
  assert.equal(order(W, { junkStacks: below.junkStacks }), null)
  assert.equal(order(W, { junkStacks: atCap.junkStacks })?.skill, 'dispose_well')
})

const hall = (o) => ({ plot: 'hall', share: o })
await t('SHARE: planned in the band for whole stacks of drawn share; never with room, never recent, never part stacks only, never off', () => {
  const p = BR.shareBankPlan({ on: true, shares: [hall({ stone_bricks: 112, spruce_planks: 119, chest: 4 })], freeSlots: 5, now: NOW })
  assert.equal(p.ok, true); assert.equal(p.slots, 1 + 1 + 0, "112 bricks and 119 planks are one whole stack each")
  assert.deepEqual(p.names, { stone_bricks: 112, spruce_planks: 119, chest: 4 })
  assert.equal(BR.shareBankPlan({ on: true, shares: [hall({ stone_bricks: 112 })], freeSlots: 8, now: NOW }).why, 'room_ok')
  assert.equal(BR.shareBankPlan({ on: true, shares: [hall({ stone_bricks: 112 })], freeSlots: 5, now: NOW, lastAt: NOW - 60_000 }).why, 'recent')
  assert.equal(BR.shareBankPlan({ on: true, shares: [hall({ stone_bricks: 112 })], freeSlots: 5, now: NOW, lastAt: NOW - BR.SHARE_BANK_EVERY_MS }).ok, true)
  assert.equal(BR.shareBankPlan({ on: true, shares: [hall({ glass_pane: 8, torch: 4 })], freeSlots: 5, now: NOW }).why, 'part_stacks')
  assert.equal(BR.shareBankPlan({ on: true, shares: [], freeSlots: 5, now: NOW }).why, 'no_share')
  assert.equal(BR.shareBankPlan({ on: false, shares: [hall({ stone_bricks: 112 })], freeSlots: 5, now: NOW }).why, 'off')
  // stack sizes come from the registry: 16 signs are one whole stack
  assert.equal(BR.shareBankPlan({ on: true, shares: [hall({ oak_sign: 16 })], freeSlots: 5, now: NOW, stackOf: n => (n === 'oak_sign' ? 16 : 64) }).ok, true)
  // two projects' shares are summed for the decision
  assert.equal(BR.shareBankPlan({ on: true, shares: [hall({ stone_bricks: 40 }), { plot: 'stepwell', share: { stone_bricks: 30 } }], freeSlots: 5, now: NOW }).slots, 1)
})

await t('THE REFUSAL NAMES ITS REMEDY: buildOrder\'s room skip asks the room ask; an order replaces the skip, none keeps it', () => {
  const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, freeSlots: 5, record: { plot: 'hall', structure_complete: false } }
  try {
    S.setRoomAsk(null)
    assert.equal(S.buildOrder(base).skip, 'room')
    let asked = null
    S.setRoomAsk(a => { asked = a; return { order: { skill: 'build_shop', args: { shareBank: true } } } })
    const r = S.buildOrder(base)
    assert.deepEqual(r, { order: { skill: 'build_shop', args: { shareBank: true } }, skip: null })
    assert.equal(asked.freeSlots, 5); assert.equal(asked.plot, 'hall')
    S.setRoomAsk(() => null)
    assert.equal(S.buildOrder(base).skip, 'room', 'nothing to bank: the skip, as before')
    S.setRoomAsk(() => { throw new Error('boom') })
    assert.equal(S.buildOrder(base).skip, 'room', 'an ask that throws is no ask')
    S.setRoomAsk(() => ({ order: { skill: 'build_shop', args: { shareBank: true } } }))
    assert.equal(S.buildOrder({ ...base, freeSlots: 8 }).order?.args?.shareBank, undefined, 'with room the build order is the build')
  } finally { S.setRoomAsk(null) }
})

await t('THE DETAIL: one row says what went and what is left per project', () => {
  const d = BR.shareBankDetail({ per: [{ plot: 'hall', banked: { stone_bricks: 112, spruce_planks: 0 }, left: { spruce_planks: 119 } }], slotsBefore: 31, slotsAfter: 29 })
  assert.equal(d, 'slots=31->29 stop=done hall=stone_bricks:112/left=spruce_planks:119')
  assert.ok(BR.shareBankDetail({ per: [] }).endsWith('none'))
})

// ---- mutants: each executable line, anchored and unique ----
await t('MUTANT KILLED: the band rule removed from the dispose order (the 34-slot rule alone)', async () => {
  await withMutant(WELL_PATH, '(slots >= TRIGGER_SLOTS || wellRoomDue({ on: bagRoom, freeSlots, junkStacks }))', '(slots >= TRIGGER_SLOTS)', async m => {
    assert.equal(order(m, {}), null, 'the mutant must lose the band dispose (killed)')
  })
})
await t('MUTANT KILLED: the band rule fires with room (< replaced by <=)', async () => {
  await withMutant(BAGROOM_PATH, 'return !!on && Number(freeSlots) < BUILD_ROOM_SLOTS', 'return !!on && Number(freeSlots) <= BUILD_ROOM_SLOTS', async m => {
    assert.equal(m.wellRoomDue({ on: true, freeSlots: 8, junkStacks: 3 }), true, 'the mutant fires at 8 free (killed by the room test)')
    assert.equal(BR.wellRoomDue({ on: true, freeSlots: 8, junkStacks: 3 }), false)
  })
})
await t('MUTANT KILLED: the room ask never consulted (the bare skip)', async () => {
  await withMutant(SHOP_PATH, '      if (ra?.order) return { order: ra.order, skip: null }', '      if (false) return { order: ra.order, skip: null }', async m => {
    try {
      m.setRoomAsk(() => ({ order: { skill: 'build_shop', args: { shareBank: true } } }))
      assert.equal(m.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, freeSlots: 5, record: { plot: 'hall', structure_complete: false } }).skip, 'room')
    } finally { m.setRoomAsk(null) }
  })
})
await t('MUTANT KILLED: the share bank ignores its rate limit', async () => {
  await withMutant(BAGROOM_PATH, 'if (Number.isFinite(lastAt) && now - lastAt < every)', 'if (false)', async m => {
    assert.equal(m.shareBankPlan({ on: true, shares: [hall({ stone_bricks: 112 })], freeSlots: 5, now: NOW, lastAt: NOW - 1 }).ok, true)
    assert.equal(BR.shareBankPlan({ on: true, shares: [hall({ stone_bricks: 112 })], freeSlots: 5, now: NOW, lastAt: NOW - 1 }).ok, false)
  })
})

// ---- the wiring (structural: behaviour cannot reach a spawn's install or the skill's dispatch without a live bot) ----
await t('WIRED: the ask is installed under the switch, the dispatch reaches the visit, the licence row is written once per spawn', () => {
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (src, s) => assert.equal(src.split(s).length, 2, `exactly one: ${s}`)
  one(sk, "  if (BAGROOM.share || BAGROOM.bank) setRoomAsk(roomAsk)")
  one(sk, "  if (BAGROOM.share) { const sb = shareBankAsk({ now, freeSlots }); if (sb) return sb }")
  one(sk, "  if (args?.shareBank === true) return shareBankVisit(ctx, args, signal)")
  one(sk, "logEvent({ kind: 'bagroom_mode'")
  one(sk, "logEvent({ kind: 'share_bank'")
  const ft = strip(readFileSync(FEATURES_PATH, 'utf8'))
  one(ft, '  try { bagRoomInstall(bot) }')
  // the share-bank visit banks into the materials chests first (matsBank's `prefer`) and reduces the drawn record
  const fn = sk.slice(sk.indexOf('async function shareBankVisit'), sk.indexOf('function shareBankRow'))
  assert.ok(fn.includes('prefer: mats.map(b => b.position)'), 'the materials chests first')
  assert.ok(/drawnWrite\(dir, sh\.key, me, left, \{ bag: b1 \}\)/.test(fn), 'the drawn record reduced by what went')
})

await t('MUTANT KILLED (wiring): the install without the ask', async () => {
  const src = readFileSync(SKILLS_PATH, 'utf8')
  const old = '  if (BAGROOM.share || BAGROOM.bank) setRoomAsk(roomAsk)'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const mut = strip(src.replace(old, '  if (false) setRoomAsk(roomAsk)'))
  assert.equal(mut.split(old).length, 1, 'the structural check fails on the mutant (killed)')
})

if (failed) { console.log(`# ${failed} failed`); process.exit(1) }
console.log('# bagroom: all passed')
