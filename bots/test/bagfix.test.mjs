// BAGFIX-01 (src/bagfix.mjs has the measurement): the room bank goes where it can bank (A), a room refusal falls through to light
// work (B), the bag trim (C), carried chests (D), merging deposits (M). Behaviour first (the pure decisions, the composed refusal
// chains), then anchored mutants of the executable lines, then the wiring (structural: what behaviour cannot reach without a bot).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-bagfix-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const BF = await import('../src/bagfix.mjs')
const BR = await import('../src/bagroom.mjs')
const S = await import('../src/shop.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }

const P = n => new URL(`../src/${n}.mjs`, import.meta.url)
const BAGFIX_PATH = P('bagfix'), SHOP_PATH = P('shop'), SKILLS_PATH = P('skills')
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} in ${path.pathname} (a mutant that was never written reads as killed)`)
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module and fails, by an assertion, on the mutant. */
const killedBy = async (path, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(path, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const one = (src, re, what) => assert.equal((src.match(new RegExp(re, 'g')) ?? []).length, 1, `${what}: expected exactly one executable line matching ${re}`)

// ---- the switches --------------------------------------------------------------------------------------------------------------
await t('SWITCHES: every part on by default; BAGFIX=off is all of it; each part has its own; the clear is off unless dated', () => {
  const d = BF.bagfixSwitches({})
  assert.deepEqual(d, { on: true, reach: true, light: true, trim: true, chest: true, merge: true, clearUntil: null })
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.deepEqual(BF.bagfixSwitches({ BAGFIX: v, BAGCLEAR_UNTIL: '2026-11-17T00:00:00Z' }), { on: false, reach: false, light: false, trim: false, chest: false, merge: false, clearUntil: null })
  for (const [k, f] of [['BAGFIX_REACH', 'reach'], ['BAGFIX_LIGHT', 'light'], ['BAGFIX_TRIM', 'trim'], ['BAGFIX_CHEST', 'chest'], ['BAGFIX_MERGE', 'merge']]) {
    const s = BF.bagfixSwitches({ [k]: 'off' })
    assert.equal(s[f], false, k)
    assert.equal(Object.entries(s).filter(([n, v]) => n !== 'clearUntil' && v === false).length, 1, `${k} switches one part only`)
  }
  assert.equal(BF.bagfixSwitches({ BAGFIX_REACH: 'banana' }).reach, true, 'an unreadable value reads as on')
  const u = Date.parse('2026-11-17T00:00:00Z')
  assert.equal(BF.bagfixSwitches({ BAGCLEAR_UNTIL: '2026-11-17T00:00:00Z' }).clearUntil, u)
  assert.equal(BF.bagfixSwitches({ BAGCLEAR_UNTIL: String(u) }).clearUntil, u)
  assert.equal(BF.bagfixSwitches({ BAGCLEAR_UNTIL: 'soon' }).clearUntil, null, 'unreadable: off')
  assert.equal(BF.clearActive({ clearUntil: u }, u - 1), true)
  assert.equal(BF.clearActive({ clearUntil: u }, u), false, 'the clear ends at its date')
  assert.equal(BF.clearActive({ clearUntil: null }, u), false)
  assert.match(BF.bagfixModeDetail(d, u), /^on=1 reach=1 light=1 trim=1 chest=1 merge=1 clear=0 clear_until=- /)
})

// ---- A: the room bank's target ---------------------------------------------------------------------------------------------------
console.log('A: THE ROOM BANK GOES WHERE IT CAN BANK')
// LIVE 11-16 (the town index, 20:01Z): the box's 15 containers 405 of 405 slots, the hall's 18 at 462 of 486 -- the nearest chest of the
// box is one the town's memory calls full, and the only room is in the hall
const boxFull = { at: 'box-full', d: 6, inBox: true, extra: false, status: 'full', lid: false }
const boxLid = { at: 'box-lid', d: 9, inBox: true, extra: false, status: 'visit', lid: true }
const boxOk = { at: 'box-ok', d: 14, inBox: true, extra: false, status: 'visit', lid: false }
const hallOk = { at: 'hall-ok', d: 31, inBox: false, extra: true, status: 'visit', lid: false }
const stray = { at: 'stray', d: 3, inBox: false, extra: false, status: 'visit', lid: false }
await t('the target is the nearest chest the deposit would ACCEPT: never one the memory skips, never a shut lid, never a stray chest', () => {
  assert.equal(BF.roomTarget([boxFull, boxLid, boxOk, hallOk, stray], { reach: true }).at, 'box-ok')
  assert.equal(BF.roomTarget([boxFull, boxLid, hallOk, stray], { reach: true }).at, 'hall-ok', 'the box full: the hall')
  for (const st of BF.SKIPPED_STATUS) assert.equal(BF.roomTarget([{ ...boxOk, status: st }], { reach: true }), null, st)
  assert.equal(BF.roomTarget([{ ...hallOk, d: BF.ROOM_REACH_R + 1 }], { reach: true }), null, 'never a walk past the reach')
  assert.equal(BF.roomTarget([boxFull, boxLid, stray], { reach: true }), null, 'nothing acceptable: no target (positive control above)')
})
await t('OFF is the base exactly: the nearest chest of the box whatever its state, never the hall', () => {
  assert.equal(BF.roomTarget([boxFull, boxLid, boxOk, hallOk, stray], { reach: false }).at, 'box-full')
  assert.equal(BF.roomTarget([hallOk, stray], { reach: false }), null)
  assert.equal(BF.depositZone({ reach: false, inBox: false, extra: true }), false)
  assert.equal(BF.depositZone({ reach: true, inBox: false, extra: true }), true)
  assert.equal(BF.depositZone({ reach: true, inBox: false, extra: false }), false, 'a chest that is neither is never the town\'s')
  assert.equal(BF.depositZone({ reach: false, inBox: true, extra: false }), true)
})
await t('the ask needs a target (in reach, or one to walk to); off the bag alone decides, as before', () => {
  assert.equal(BF.roomAskTarget({ reach: true, inReach: false, target: null }), false)
  assert.equal(BF.roomAskTarget({ reach: true, inReach: true, target: null }), true)
  assert.equal(BF.roomAskTarget({ reach: true, inReach: false, target: hallOk }), true)
  assert.equal(BF.roomAskTarget({ reach: false, inReach: false, target: null }), true)
})
await t('the row says why a visit banked nothing and where its chest was', () => {
  assert.equal(BF.roomStop({ status: 'success' }), 'banked')
  assert.equal(BF.roomStop({ status: 'no_effect', inReach: false, target: null }), 'no_target')
  assert.equal(BF.roomStop({ status: 'no_effect', inReach: false, target: hallOk, arrived: false }), 'walk_short')
  assert.equal(BF.roomStop({ status: 'no_effect', inReach: false, target: hallOk, arrived: true, detail: 'no town chest within reach now; the town deposit waits for another visit' }), 'none_in_reach')
  assert.equal(BF.roomStop({ status: 'no_effect', inReach: true, detail: 'the town chests in reach are full; deposit (no item) tries other chests' }), 'full')
  assert.equal(BF.roomStop({ status: 'no_effect', inReach: true, detail: 'nothing to bank: everything carried is kept' }), 'nothing_to_bank')
  assert.equal(BF.roomNear({ inReach: true }), 'reach')
  assert.equal(BF.roomNear({ target: hallOk }), '31:hall')
  assert.equal(BF.roomNear({ target: boxOk }), '14:box')
  assert.equal(BF.roomNear({}), '-')
  const d = BR.roomBankDetail({ plot: 'forest', need: 8, planned: 3, slotsBefore: 31, slotsAfter: 28, banked: { moss_block: 6 }, status: 'success', then: 'build', stop: 'banked', near: '31:hall' })
  assert.match(d, / stop=banked near=31:hall banked=moss_block:6$/)
  assert.doesNotMatch(BR.roomBankDetail({ plot: 'forest' }), /stop=|near=/, 'no stop given: the row as before')
})
await t('MUTANTS KILLED (A): the memory ignored; the lid ignored; the hall refused; the reach unbounded; the ask without a target', async () => {
  const pick = M => { assert.equal(M.roomTarget([boxFull, boxLid, boxOk, hallOk], { reach: true }).at, 'box-ok'); assert.equal(M.roomTarget([hallOk], { reach: true }).at, 'hall-ok'); assert.equal(M.roomTarget([{ ...hallOk, d: 500 }], { reach: true }), null) }
  await killedBy(BAGFIX_PATH, BF, ' && !SKIPPED_STATUS.includes(c.status)', '', pick)
  await killedBy(BAGFIX_PATH, BF, ' && !c.lid && c.d <= maxD', ' && c.d <= maxD', M => assert.equal(M.roomTarget([boxLid, boxOk], { reach: true }).at, 'box-ok'))
  await killedBy(BAGFIX_PATH, BF, '!!inBox || (!!reach && !!extra)', '!!inBox', pick)
  await killedBy(BAGFIX_PATH, BF, ' && !c.lid && c.d <= maxD', ' && !c.lid', pick)
  await killedBy(BAGFIX_PATH, BF, '!reach || !!inReach || !!target', 'true', M => assert.equal(M.roomAskTarget({ reach: true }), false))
})

// ---- B: the room refusal's light work --------------------------------------------------------------------------------------------
console.log('B: A ROOM REFUSAL FALLS THROUGH TO LIGHT WORK')
const anyBot = { on: true, plot: 'hall', need: 8, keeper: false, tidyWork: false, tidyQuiet: false, light: true, tidyOpen: true }
await t('any bot refused a heavy plot with 2-7 free slots works the tidy while it has work; 1 or 8 free, no work, quiet, the tidy itself: none', () => {
  for (const f of [2, 5, 7]) assert.equal(S.roomFallback({ ...anyBot, freeSlots: f }), 'tidy')
  assert.equal(S.roomFallback({ ...anyBot, freeSlots: 1 }), null, 'below the tidy\'s own 2')
  assert.equal(S.roomFallback({ ...anyBot, freeSlots: 8 }), null)
  assert.equal(S.roomFallback({ ...anyBot, freeSlots: 5, tidyOpen: false }), null)
  assert.equal(S.roomFallback({ ...anyBot, freeSlots: 5, tidyQuiet: true }), null, 'a tidy visit that did nothing is not re-sent')
  assert.equal(S.roomFallback({ ...anyBot, freeSlots: 5, plot: 'tidy' }), null)
  assert.equal(S.roomFallback({ ...anyBot, freeSlots: 5, light: false }), null, 'BAGFIX_LIGHT=off: the keeper\'s alone, as before')
  assert.equal(S.roomFallback({ on: true, plot: 'forest', need: 8, keeper: true, tidyWork: true, freeSlots: 5, light: false }), 'tidy', 'the keeper\'s fallback is unchanged with it off')
})
const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, freeSlots: 5, record: { plot: 'forest', structure_complete: false } }
const chainB = M => {
  try {
    M.setRoomAsk(() => null)   // A found no chest to bank in: no ask
    M.setTidyWork(() => ({ keeper: false, tidyWork: false, tidyOpen: true }))
    assert.deepStrictEqual(M.buildOrder(base), { order: { skill: 'build_shop', args: { plot: 'tidy', why: 'room_fallback' } }, skip: null }, 'the refusal chain ends in WORK, not a skip')
    M.setRoomAsk(() => ({ order: { skill: 'build_shop', args: { roomBank: true } } }))
    assert.deepStrictEqual(M.buildOrder(base).order.args, { roomBank: true }, 'the room bank still comes first')
    M.setRoomAsk(() => null)
    M.setTidyWork(() => ({ keeper: false, tidyWork: false, tidyOpen: false }))
    assert.equal(M.buildOrder(base).skip, 'room', 'no tidy work: the skip (the well\'s trim is the bag\'s remedy)')
    M.setTidyWork(() => ({ keeper: false, tidyWork: false, tidyOpen: true }))
    assert.equal(M.buildOrder({ ...base, freeSlots: 1 }).skip, 'room', 'one free slot: no visit fits')
  } finally { M.setRoomAsk(null); M.setTidyWork(() => ({ keeper: false, tidyWork: false })) }
}
await t('THE CHAIN (buildOrder): no room, nothing to bank in -> the tidy for any bot; MUTANTS: the light clause removed, the read not passed', async () => {
  assert.equal(BF.BAGFIX.light, true, 'the suite runs with the switch at its default')
  await killedBy(SHOP_PATH, S, '  const any = !!light && plot !== TIDY_PLOT && !!tidyOpen\n', '  const any = false\n', chainB)
  await killedBy(SHOP_PATH, S, ', light: BAGFIX.light, tidyOpen: !!tw.tidyOpen })', ' })', chainB)
  await killedBy(SHOP_PATH, S, '  if ((!base && !any) || tidyQuiet) return null\n', '  if (!base && !any) return null\n', M => assert.equal(M.roomFallback({ ...anyBot, freeSlots: 5, tidyQuiet: true }), null))
})

// ---- the wiring ------------------------------------------------------------------------------------------------------------------
await t('WIRED (A, B): the deposit\'s zone, the ask\'s gate, the visit\'s walk and row, the licence row, the tidy read for any bot', () => {
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  one(sk, 'filter\\(p => depositZone\\(\\{ inBox: inTownZone\\(p, home\\), extra: inTownExtra\\(home, p\\) \\}\\) && me\\.distanceTo\\(p\\) <= STORAGE_REACH\\)', 'townContainers takes the registered chests')
  one(sk, 'if \\(BAGFIX\\.reach && !roomAskTarget\\(\\{ inReach: townContainers\\(bot, 1\\)\\.length > 0, target: roomTargetNow\\(bot, now\\) \\}\\)\\) return null', 'roomAsk')
  assert.ok(sk.indexOf('if (BAGFIX.reach && !roomAskTarget(') < sk.indexOf('bot.roomBankAt = now'), 'no target: the ask\'s rate limit is not charged')
  one(sk, 'const target = roomTarget\\(cands\\)', 'the scan asks the pure pick')
  one(sk, 'target = roomTargetNow\\(bot, Date\\.now\\(\\), \\{ fresh: true \\}\\)', 'the visit walks to the pick, read fresh')
  one(sk, 'BAGFIX\\.reach \\? ROOM_REACH_WALK_MS : ROOM_BASE_WALK_MS', 'the walk\'s bound')
  one(sk, 'stop: roomStop\\(\\{ status: r\\?\\.status, inReach, target, arrived, detail: r\\?\\.detail \\}\\), near: roomNear\\(\\{ inReach, target \\}\\)', 'the row')
  one(sk, "logEvent\\(\\{ kind: 'bagfix', status: 'success', snapshot: snapshot\\(bot\\), detail: bagfixModeDetail\\(BAGFIX\\) \\}\\)", 'the licence row')
  one(sk, 'tidyOpen: BAGFIX\\.light && work', 'the tidy read')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall bagfix tests passed')
