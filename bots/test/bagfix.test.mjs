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

// ---- M: merging deposits -------------------------------------------------------------------------------------------------------
console.log('M: A DEPOSIT MERGES ONTO THE PARTIAL STACKS A CHEST HOLDS')
const TD = await import('../src/towndeposit.mjs')
const TD_PATH = P('towndeposit'), BAGROOM_PATH = P('bagroom')
const it = (name, count, extra = {}) => ({ name, count, type: 1, metadata: 0, nbt: null, stackSize: 64, ...extra })
// LIVE 11-16 20:01Z: a chest with NO empty slot, full of fragments (moss 410 items in 93 slots town-wide)
const fullOfFragments = () => { const c = Array.from({ length: 27 }, () => it('lantern', 4)); c[3] = it('moss_block', 5); c[9] = it('moss_block', 60); c[20] = it('cobbled_deepslate', 30); return c }
await t('a stack goes onto the partial stacks of its own item, in slot order, and what is left into an empty slot; ALL of it or none', () => {
  const slots = fullOfFragments()
  const fit = BF.mergeFit([{ slot: 10, name: 'moss_block', count: 40 }, { slot: 11, name: 'cobbled_deepslate', count: 64 }, { slot: 12, name: 'spruce_log', count: 8 }], slots, { merge: true })
  assert.deepEqual(fit, [{ slot: 10, name: 'moss_block', count: 40, dest: null, merges: [{ dest: 3, n: 40 }] }], 'the moss fits a partial; 64 deepslate does not fit 34 of room and no empty slot; the logs have no stack to join')
  slots[26] = null
  const fit2 = BF.mergeFit([{ slot: 11, name: 'cobbled_deepslate', count: 64 }, { slot: 12, name: 'spruce_log', count: 8 }], slots, { merge: true })
  assert.deepEqual(fit2, [{ slot: 11, name: 'cobbled_deepslate', count: 64, dest: 26, merges: [{ dest: 20, n: 34 }] }], 'with one empty slot: 34 merged, 30 into it -- and the logs find it taken')
  const two = BF.mergeFit([{ slot: 1, name: 'moss_block', count: 50 }, { slot: 2, name: 'moss_block', count: 13 }], fullOfFragments(), { merge: true })
  assert.deepEqual(two.map(x => x.merges), [[{ dest: 3, n: 50 }], [{ dest: 3, n: 9 }, { dest: 9, n: 4 }]], 'the second step sees what the first left')
  assert.equal(BF.mergeFit([{ slot: 1, name: 'iron_pickaxe', count: 1 }], [it('iron_pickaxe', 1, { stackSize: 1 })], { merge: true, stackOf: () => 1 }).length, 0, 'a tool never merges')
  const many = Array.from({ length: 6 }, () => it('coal', 63))
  assert.equal(BF.mergeFit([{ slot: 1, name: 'coal', count: 5 }], many, { merge: true }).length, 0, `at most ${BF.MERGE_MAX} partial stacks a step: 5 does not fit 3`)
  assert.equal(BF.mergeFit([{ slot: 1, name: 'coal', count: 3 }], many, { merge: true })[0].merges.length, 3)
})
await t('OFF is fitToContainer exactly (empty slots only), over random plans', () => {
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  for (let k = 0; k < 200; k++) {
    const slots = Array.from({ length: 27 }, () => (rnd(3) ? it(['moss_block', 'coal', 'stick'][rnd(3)], 1 + rnd(64)) : null))
    const steps = Array.from({ length: rnd(8) }, (_, i) => ({ slot: 9 + i, name: ['moss_block', 'coal', 'stick', 'oak_log'][rnd(4)], count: 1 + rnd(64) }))
    assert.deepEqual(BF.mergeFit(steps, slots, { merge: false }).map(({ merges, ...x }) => x), TD.fitToContainer(steps, slots))
    assert.ok(BF.mergeFit(steps, slots, { merge: false }).every(x => x.merges.length === 0))
    // ON: never more items planned into a slot than its stack holds, and every planned step wholly placed
    const on = BF.mergeFit(steps, slots, { merge: true })
    const add = {}
    for (const st of on) { let n = 0; for (const m of st.merges) { add[m.dest] = (add[m.dest] ?? 0) + m.n; n += m.n; assert.equal(slots[m.dest].name, st.name) } assert.ok(n === st.count ? st.dest === null : Number.isInteger(st.dest) && !slots[st.dest]) }
    for (const [d, n] of Object.entries(add)) assert.ok(slots[d].count + n <= 64, 'a stack is never overfilled')
    assert.equal(new Set(on.filter(x => x.dest != null).map(x => x.dest)).size, on.filter(x => x.dest != null).length, 'an empty slot is given once')
  }
})
await t('only the SAME item merges: a different nbt, components, metadata or type is another stack (the server would swap, not merge)', () => {
  assert.equal(BF.sameStack(it('moss_block', 5), it('moss_block', 60)), true)
  assert.equal(BF.sameStack(it('moss_block', 5), it('coal', 5)), false)
  assert.equal(BF.sameStack(it('moss_block', 5), it('moss_block', 5, { nbt: { name: 'x' } })), false)
  assert.equal(BF.sameStack(it('moss_block', 5), it('moss_block', 5, { components: [{ type: 'custom_name', data: 'x' }] })), false)
  assert.equal(BF.sameStack(it('moss_block', 5), it('moss_block', 5, { removedComponents: ['lore'] })), false)
  assert.equal(BF.sameStack(it('moss_block', 5), it('moss_block', 5, { metadata: 1 })), false)
  assert.equal(BF.sameStack(it('moss_block', 5), it('moss_block', 5, { type: 2 })), false)
  assert.equal(BF.sameStack(null, it('moss_block', 5)), false)
})
await t('the server\'s word: an empty-slot move reads back exactly; a merge holds at least what it left; a wrong name never', () => {
  const step = { name: 'moss_block', count: 40 }
  assert.equal(BF.destHolds({ name: 'moss_block', count: 40 }, { step }), true)
  assert.equal(BF.destHolds({ name: 'moss_block', count: 41 }, { step }), false, 'an empty-slot move is exact, as before')
  assert.equal(BF.destHolds({ name: 'moss_block', count: 45 }, { step, after: 45 }), true)
  assert.equal(BF.destHolds({ name: 'moss_block', count: 50 }, { step, after: 45 }), true, 'a later merge onto it')
  assert.equal(BF.destHolds({ name: 'moss_block', count: 44 }, { step, after: 45 }), false, 'the merge did not land')
  assert.equal(BF.destHolds({ name: 'moss_block', count: 60 }, { step, grew: true }), true)
  assert.equal(BF.destHolds({ name: 'moss_block', count: 39 }, { step, grew: true }), false)
  assert.equal(BF.destHolds({ name: 'coal', count: 45 }, { step, after: 45 }), false)
  assert.equal(BF.destHolds(null, { step, after: 45 }), false)
})
await t('a chest remembered full is still tried while its partial stacks take a whole planned stack; never an unusable one', () => {
  const names = { moss_block: [65, 2], coal: [64, 1], iron_pickaxe: [3, 3] }
  assert.equal(BF.mergeRoom(names, ['moss_block', 'coal', 'spruce_log']), 63)
  assert.equal(BF.mergeRoom(names, ['iron_pickaxe'], () => 1), 0)
  assert.equal(BF.mergeRoom(undefined, ['moss_block']), 0)
  assert.equal(BF.fullStillTakes({ merge: true, status: 'full', room: 63, least: 40 }), true)
  assert.equal(BF.fullStillTakes({ merge: true, status: 'full', room: 63, least: 64 }), false)
  assert.equal(BF.fullStillTakes({ merge: true, status: 'unusable', room: 63, least: 1 }), false)
  assert.equal(BF.fullStillTakes({ merge: false, status: 'full', room: 63, least: 1 }), false)
})
await t('MUTANTS KILLED (M): a part planned; an overfill; another item merged; the merge cap; an under-count verified', async () => {
  const frag = () => { const c = fullOfFragments(); return c }
  await killedBy(BAGFIX_PATH, BF, '    if (left > 0 && !free.length) continue', '    if (false) continue', M => assert.equal(M.mergeFit([{ slot: 11, name: 'cobbled_deepslate', count: 64 }], frag(), { merge: true }).length, 0))
  await killedBy(BAGFIX_PATH, BF, '        const n = Math.min(left, max - cnt[i])\n', '        const n = left\n', M => assert.deepEqual(M.mergeFit([{ slot: 1, name: 'moss_block', count: 62 }], frag(), { merge: true })[0].merges, [{ dest: 3, n: 59 }, { dest: 9, n: 3 }]))
  await killedBy(BAGFIX_PATH, BF, '        if (!list[i] || cnt[i] >= max || !same(list[i], step)) continue', '        if (!list[i] || cnt[i] >= max) continue', M => assert.equal(M.mergeFit([{ slot: 1, name: 'spruce_log', count: 8 }], frag(), { merge: true }).length, 0))
  await killedBy(BAGFIX_PATH, BF, ' && left > 0 && merges.length < MERGE_MAX; i++', ' && left > 0; i++', M => assert.equal(M.mergeFit([{ slot: 1, name: 'coal', count: 5 }], Array.from({ length: 6 }, () => it('coal', 63)), { merge: true }).length, 0))
  await killedBy(BAGFIX_PATH, BF, '  return d.count >= (x.after ?? x.step.count)', '  return true', M => assert.equal(M.destHolds({ name: 'moss_block', count: 44 }, { step: { name: 'moss_block', count: 40 }, after: 45 }), false))
  await killedBy(BAGFIX_PATH, BF, "!!merge && status === 'full' && Number(room)", '!!merge && Number(room)', M => assert.equal(M.fullStillTakes({ merge: true, status: 'unusable', room: 63 }), false))
})

// ---- D: carried chests ---------------------------------------------------------------------------------------------------------
console.log('D: CARRIED CHESTS')
const CF = await import('../src/chestfull.mjs')
const NOW = Date.parse('2026-11-16T20:00:00Z')
await t('the showcase line has the owner\'s 16 a day / 24 standing for a CARRIED chest (chestcarry-01); a crafted one the base\'s 4 / 12', () => {
  const claims = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, x: i, y: 70, z: 0, at: NOW - (i + 1) * 3_600_000, world: null, state: 'placed' }))
  assert.equal(CF.chestBudget({ claims, now: NOW, carried: true, on: true }).ok, true, 'LIVE: 8 claims, 8 today -- a carried chest goes down')
  assert.equal(CF.chestBudget({ claims, now: NOW, carried: false, on: true }).ok, false, 'a crafted one keeps the 4 a day')
  assert.equal(CF.chestBudget({ claims, now: NOW, carried: true, on: false }).ok, false, 'CHESTCARRY=off: the base')
})
await t('one unreadable container defers nothing while another is known full; the ones out of TIME still say "deposit again"', () => {
  assert.equal(BF.deferUnknown({ chest: true, unknown: 1, unknownTime: 0, known: 14 }), 0)
  assert.equal(CF.fullChestNext({ nearHome: true, unknown: BF.deferUnknown({ chest: true, unknown: 1, unknownTime: 0, known: 14 }), budget: { ok: true }, carried: true }), 'place_carried', 'THE CHAIN: the carried chest goes down')
  assert.equal(CF.fullChestNext({ nearHome: true, unknown: BF.deferUnknown({ chest: false, unknown: 1, unknownTime: 0, known: 14 }), budget: { ok: true }, carried: true }), 'defer', 'off: as before')
  assert.equal(BF.deferUnknown({ chest: true, unknown: 3, unknownTime: 2, known: 14 }), 2)
  assert.equal(BF.deferUnknown({ chest: true, unknown: 2, unknownTime: 0, known: 0 }), 2, 'nothing known full: a new chest is not built on a guess')
})
await t('a cell a placement failed at is not picked again for a day (LIVE: c6, c7, c8 all at -6,71,9)', () => {
  const c = (n, state, h) => ({ n, x: -6, y: 71, z: 9, at: NOW - h * 3_600_000, state })
  assert.deepEqual(BF.failedSites([c(6, 'not_placed', 14), c(7, 'not_placed', 12), c(8, 'not_placed', 11), { n: 5, x: -14, y: 71, z: -7, at: NOW - 17 * 3_600_000, state: 'placed' }], { chest: true, now: NOW }), [{ x: -6, y: 71, z: 9 }])
  assert.deepEqual(BF.failedSites([c(6, 'not_placed', 25)], { chest: true, now: NOW }), [], 'after a day the cell may be tried again')
  assert.deepEqual(BF.failedSites([c(6, 'placed', 1), c(7, 'unresolved', 1), c(8, 'gone', 1)], { chest: true, now: NOW }), [])
  assert.deepEqual(BF.failedSites([c(6, 'not_placed', 1)], { chest: false, now: NOW }), [])
})
const bag = inv => { const out = []; let slot = 9; for (const [name, c] of Object.entries(inv)) { let k = c; while (k > 0) { out.push({ name, count: Math.min(k, 64), slot: slot++, stackSize: 64 }); k -= 64 } } return out }
await t('a stack of 13 carried chests is banked in halves down to the one kept (7, 3, 2); one chest stays; off: nothing', () => {
  const plan = TD.townDepositPlan(bag({ chest: 13, cobblestone: 20 }), { wanted: [], tail: 'only', bagAllowance: true })
  const halves = plan.steps.filter(s => s.name === 'chest')
  assert.deepEqual(halves.map(s => [s.count, s.from, s.half, s.allowance]), [[7, 13, true, 'station'], [3, 6, true, 'station'], [2, 3, true, 'station']])
  assert.equal(TD.townDepositPlan(bag({ chest: 1 }), { wanted: [], tail: 'only', bagAllowance: true }).steps.length, 0, 'the one kept never moves')
  assert.deepEqual(BF.chestHalves(bag({ chest: 13 }), { chest: false, halves: TD.logHalfSteps }), [])
  // THE CHAIN: the not-full visit's tail order fires for the halves alone (a half frees no slot)
  const home = { x: 0, y: 70, z: 0 }
  const r = TD.tailOrder({ now: 1e12, slots: 20, pos: home, home, plan: () => plan, container: true, state: {}, on: true })
  assert.equal(r.order?.skill, 'town_deposit')
  assert.equal(TD.tailOrder({ now: 1e12, slots: 20, pos: home, home, plan: () => ({ steps: [], freed: 0 }), container: true, state: {}, on: true }).order, null, 'nothing to bank: no order')
})
await t('MUTANTS KILLED (D): the unknowns counted; the failed cell forgotten; the halves unplanned; the tail deaf to them', async () => {
  await killedBy(BAGFIX_PATH, BF, '(chest && Number(known) > 0 ? Math.min(Number(unknown) || 0, Number(unknownTime) || 0) : Number(unknown) || 0)', '(Number(unknown) || 0)', M => assert.equal(M.deferUnknown({ chest: true, unknown: 1, unknownTime: 0, known: 3 }), 0))
  await killedBy(BAGFIX_PATH, BF, "    if (c?.state !== 'not_placed' || ", "    if (c?.state === 'not_placed' || ", M => assert.equal(M.failedSites([{ x: 1, y: 2, z: 3, at: NOW - 1, state: 'not_placed' }], { chest: true, now: NOW }).length, 1))
  const halvesOf = M => M.townDepositPlan(bag({ chest: 13 }), { wanted: [], tail: 'only', bagAllowance: true }).steps.filter(s => s.name === 'chest').length
  await killedBy(TD_PATH, TD, "    if (BAGFIX.chest && !steps.some(st => st.name === 'chest' || st.name === 'trapped_chest')) {", '    if (false) {', M => assert.equal(halvesOf(M), 3))
  const home = { x: 0, y: 70, z: 0 }
  await killedBy(TD_PATH, TD, '  if (!p || !(p.freed >= 1 || logs || coal || count || chests)) return none()', '  if (!p || !(p.freed >= 1 || logs || coal || count)) return none()',
    M => assert.equal(M.tailOrder({ now: 1e12, slots: 20, pos: home, home, plan: () => M.townDepositPlan(bag({ chest: 13 }), { wanted: [], tail: 'only', bagAllowance: true }), container: true, state: {}, on: true }).order?.skill, 'town_deposit'))
})

// ---- C (release 1): the kit keeps, the partial-slot rule, the nuggets' exit ---------------------------------------------------------
console.log('C: THE KIT KEEPS, THE PARTIAL-SLOT RULE, THE NUGGETS')
const roomSteps = (inv, o = {}) => TD.townDepositPlan(bag(inv), { wanted: [], room: true, ...o }).steps.filter(s => s.room)
const filler = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'][i % 16]}_${i < 16 ? 'carpet' : 'banner'}`, 1]))
await t('seeds and sugar cane keep 16 (were 64): a stack of 64 leaves while 16 stay; 70 in one... the kit keep is the floor', () => {
  assert.equal(BF.kitKeepOf('wheat_seeds', 64, { trim: true }), 16)
  assert.equal(BF.kitKeepOf('sugar_cane', 64, { trim: true }), 16)
  assert.equal(BF.kitKeepOf('ladder', 64, { trim: true }), 64, 'the ladder keeps its stack')
  assert.equal(BF.kitKeepOf('wheat_seeds', 64, { trim: false }), 64, 'off: as before')
  assert.deepEqual(roomSteps({ sugar_cane: 64 + 20 }).map(s => [s.name, s.count]), [['sugar_cane', 20]], '84 cane in two slots: the 20 goes, 64 >= 16 stay (the smallest first)')
})
await t('ONE RULE FOR PARTIAL SLOTS: at 30+ used slots a single partial slot under its keep may leave; under 30, two slots, a full stack, a hard keep: never', () => {
  const P0 = { trim: true, slots: 31, copies: 1, total: 12, keep: 16, stack: 64 }
  assert.equal(BF.partialKeep(P0), 0)
  assert.equal(BF.partialKeep({ ...P0, slots: 29 }), 16, 'under 30 kinds the keep stands')
  assert.equal(BF.partialKeep({ ...P0, copies: 2, total: 12 }), 16)
  assert.equal(BF.partialKeep({ ...P0, total: 64, keep: 64 }), 64, 'a full stack is not a partial slot')
  assert.equal(BF.partialKeep({ ...P0, total: 20 }), 16, 'above its keep: the ordinary rule already speaks')
  assert.equal(BF.partialKeep({ ...P0, hard: true }), 16, 'the goal\'s want and the scaffold reserve stand')
  assert.equal(BF.partialKeep({ ...P0, trim: false }), 16)
  // through the real plan: 12 sugar cane alone in a 31-slot bag leaves; in a 20-slot bag it stays (positive control: same bag, same name)
  assert.deepEqual(roomSteps({ sugar_cane: 12, ...filler(30) }).filter(s => s.name === 'sugar_cane').map(s => s.count), [12])
  assert.deepEqual(roomSteps({ sugar_cane: 12, ...filler(19) }).filter(s => s.name === 'sugar_cane'), [])
  assert.deepEqual(roomSteps({ sugar_cane: 12, ...filler(30) }, { wanted: ['sugar_cane'] }).filter(s => s.name === 'sugar_cane'), [], 'the active goal\'s want is never trimmed')
  for (const keepName of ['iron_pickaxe', 'bread', 'torch', 'crafting_table', 'cobblestone']) assert.deepEqual(roomSteps({ [keepName]: 1, ...filler(31) }).filter(s => s.name === keepName), [], `${keepName} never leaves by the room bank`)
})
await t('iron nuggets have an exit (a chest, by the room bank); the rest of the iron ladder still never moves', () => {
  assert.deepEqual(roomSteps({ iron_nugget: 64 + 9 }).map(s => [s.name, s.count]), [['iron_nugget', 9], ['iron_nugget', 64]])
  assert.deepEqual(roomSteps({ iron_ingot: 64, raw_iron: 64, coal: 64 }).filter(s => ['iron_ingot', 'raw_iron', 'coal'].includes(s.name)), [])
  assert.equal(BF.trimBankable('iron_nugget', { trim: false }), false)
})
await t('MUTANTS KILLED (C): the kit keep at 64; the rule under 30; the rule on two slots; a hard keep trimmed; the nuggets shut in', async () => {
  await killedBy(BAGFIX_PATH, BF, 'Math.min(Number(base) || 0, TRIM_KIT_KEEP[name])', '(Number(base) || 0)', M => assert.equal(M.kitKeepOf('sugar_cane', 64, { trim: true }), 16))
  const P0 = { trim: true, slots: 31, copies: 1, total: 12, keep: 16, stack: 64 }
  const rule = M => { assert.equal(M.partialKeep(P0), 0); assert.equal(M.partialKeep({ ...P0, slots: 29 }), 16); assert.equal(M.partialKeep({ ...P0, copies: 2 }), 16); assert.equal(M.partialKeep({ ...P0, hard: true }), 16); assert.equal(M.partialKeep({ ...P0, total: 64, keep: 64 }), 64) }
  await killedBy(BAGFIX_PATH, BF, ' || !(Number(slots) >= TRIM_SLOTS) || copies !== 1', ' || copies !== 1', rule)
  await killedBy(BAGFIX_PATH, BF, ' || !(Number(slots) >= TRIM_SLOTS) || copies !== 1', ' || !(Number(slots) >= TRIM_SLOTS)', rule)
  await killedBy(BAGFIX_PATH, BF, '  if (!trim || hard || ', '  if (!trim || ', rule)
  await killedBy(BAGFIX_PATH, BF, ' || !(total < stack) || ', ' || ', rule)
  await killedBy(TD_PATH, TD, "hard: n => why[n] === 'wanted' || why[n] === 'scaffold_reserve'", 'hard: () => false', M => assert.deepEqual(M.townDepositPlan(bag({ sugar_cane: 12, ...filler(30) }), { wanted: ['sugar_cane'], room: true }).steps.filter(s => s.room && s.name === 'sugar_cane'), []))
  await killedBy(TD_PATH, TD, '      (!IRON_LADDER.includes(n) || trimBankable(n)) && ', '      !IRON_LADDER.includes(n) && ', M => assert.equal(M.townDepositPlan(bag({ iron_nugget: 73 }), { wanted: [], room: true }).steps.filter(s => s.room).length, 2))
  await killedBy(BAGROOM_PATH, BR, 'const k = partialKeep({ slots: list.length, copies: copies.length, total, keep: k0,', 'const k = k0; void ({ slots: list.length, copies: copies.length, total, keep: k0,',
    M => assert.equal(M.roomBankSteps(bag({ sugar_cane: 12, ...filler(30) }), { eligible: n => n === 'sugar_cane', keep: {} }).length, 1))
})
await t('WIRED (M, D): the plan asks mergeFit, the clicks read the cursor back, the re-open asks destHolds, the sweep skips, the picker skips', () => {
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  one(sk, '\\? mergeFit\\(plan\\.steps, win\\.slots\\.slice\\(0, win\\.inventoryStart\\)', 'bankInto plans with mergeFit')
  one(sk, ': fitToContainer\\(plan\\.steps, win\\.slots\\.slice\\(0, win\\.inventoryStart\\)\\)', 'off: fitToContainer')
  one(sk, 'if \\(!d \\|\\| !sameStack\\(d, win\\.selectedItem\\) \\|\\| d\\.count >= max\\) continue', 'each merge is re-read at its click')
  one(sk, 'if \\(left - n > 0 \\? !\\(cur && cur\\.name === step\\.name && cur\\.count === left - n\\) : !!cur\\) throw stop', 'the cursor is read back after a merge')
  one(sk, 'verified: done\\.filter\\(x => destHolds\\(win\\.slots\\[x\\.dest\\], x\\)\\)', 'the re-open')
  one(sk, "!\\(st === 'full' && fullOk\\?\\.\\(posKey\\(p\\)\\)\\)\\) continue", 'townContainers')
  one(sk, 'const next0 = fullChestNext\\(\\{ nearHome, unknown: unk, budget, carried: !!carried \\}\\)', 'the recovery skips an unreadable container')
  one(sk, 'const skip = \\[\\.\\.\\.failedSites\\(claims\\)\\]', 'the site picker')
  one(sk, 'claimNewChest\\(\\{ dir, key, site, world, carried: !!carried \\}\\)', 'chestcarry-01 is on this line')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall bagfix tests passed')
