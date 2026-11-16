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
  const pick = M => { assert.equal(M.roomTarget([boxFull, boxLid, boxOk, hallOk], { reach: true })?.at, 'box-ok'); assert.equal(M.roomTarget([hallOk], { reach: true })?.at, 'hall-ok'); assert.equal(M.roomTarget([{ ...hallOk, d: 500 }], { reach: true }), null) }
  await killedBy(BAGFIX_PATH, BF, ' && !SKIPPED_STATUS.includes(c.status)', '', pick)
  await killedBy(BAGFIX_PATH, BF, ' && !c.lid && c.d <= maxD', ' && c.d <= maxD', M => assert.equal(M.roomTarget([boxLid, boxOk], { reach: true })?.at, 'box-ok'))
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
  one(sk, 'if \\(BAGFIX\\.light\\) \\{ const r = tidyWorkBase\\(b\\); return \\{ \\.\\.\\.r, tidyOpen: !!b && \\(r\\.tidyWork \\|\\| tidyRecWork\\(\\)\\) \\} \\}', 'the tidy read')
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

// ---- M, Codex r1 BLOCKER 1: every merge click is answered by the SERVER before the next -----------------------------------------------
console.log('M (Codex r1): THE MERGE SEQUENCE TRUSTS THE SERVER, CLICK BY CLICK')
// A SERVER, as vanilla answers window clicks: a left click with a loaded cursor MERGES onto the same item up to the stack (the rest
// stays on the cursor), PLACES into an empty slot, SWAPS with anything else; with an empty cursor it picks the stack up (right: half).
// The bot sees NOTHING of it but what confirm() returns: the server's cursor, and a refresh of the slots.
const CH = 27   // container slots 0..26, bag slots 27..62
// the server's stack as the Item the probe decodes: a `tag` is a custom name (a component), `dmg` a damage component
const asItem = x => ({ name: x.name, count: x.count, type: 1, metadata: 0, nbt: null, components: [...(x.tag ? [{ type: 'custom_name', data: x.tag }] : []), ...(x.dmg ? [{ type: 'damage', data: x.dmg }] : [])] })
function server ({ chest = {}, bagSlots = {}, onClick = null, mute = () => false, closeAt = null } = {}) {
  const slots = Array.from({ length: 63 }, () => null)
  for (const [i, v] of Object.entries(chest)) slots[i] = { ...v }
  for (const [i, v] of Object.entries(bagSlots)) slots[i] = { ...v }
  const sv = { slots, cursor: null, clicks: 0, confirms: 0, closed: false, view: slots.map(x => (x ? { ...x } : null)) }
  const sameS = (a, b) => a && b && a.name === b.name && (a.tag ?? null) === (b.tag ?? null) && (a.dmg ?? 0) === (b.dmg ?? 0)
  sv.io = {
    click: async (slot, button = 0) => {
      sv.clicks++
      if (closeAt != null && sv.clicks >= closeAt) { sv.closed = true; if (sv.cursor) { const f = sv.slots.findIndex((x, i) => i >= CH && !x); sv.slots[f] = sv.cursor; sv.cursor = null } }   // the server closes: its cursor returns to the bag
      if (sv.closed) throw new Error('the window changed')
      onClick?.(sv, sv.clicks, slot)
      const at = sv.slots[slot]
      if (!sv.cursor) { if (!at) return; const take = button === 1 ? Math.ceil(at.count / 2) : at.count; sv.cursor = { ...at, count: take }; at.count -= take; if (!at.count) sv.slots[slot] = null; return }
      if (!at) { sv.slots[slot] = sv.cursor; sv.cursor = null; return }
      if (sameS(at, sv.cursor)) { const n = Math.min(sv.cursor.count, 64 - at.count); at.count += n; sv.cursor.count -= n; if (!sv.cursor.count) sv.cursor = null; return }
      sv.slots[slot] = sv.cursor; sv.cursor = at   // a swap
    },
    confirm: async () => { sv.confirms++; if (sv.closed || mute(sv.confirms)) return null; sv.view = sv.slots.map(x => (x ? { ...x } : null)); return sv.cursor ? { name: sv.cursor.name, count: sv.cursor.count, item: asItem(sv.cursor) } : { name: null, count: 0, item: null } },
    slot: i => { const x = sv.view[i]; return x ? { ...x, stackSize: 64 } : null },
    emptyDest: () => { for (let i = 0; i < CH; i++) if (!sv.view[i]) return i; return null },
    same: d => sameS(d, sv.cursor),
  }
  // the caller's settle (skills.mjs settleCursor: server-confirmed): the cursor back to the bag slot it came from, or a free one
  sv.settle = from => { if (!sv.cursor || sv.closed) return; const home = sv.slots[from]; if (!home) sv.slots[from] = sv.cursor; else if (sameS(home, sv.cursor)) home.count += sv.cursor.count; else sv.slots[sv.slots.findIndex((x, i) => i >= CH && !x)] = sv.cursor; sv.cursor = null }
  sv.total = name => sv.slots.reduce((t, x) => t + (x?.name === name ? x.count : 0), 0) + (sv.cursor?.name === name ? sv.cursor.count : 0)
  return sv
}
const FROM = 30, TOOL = 31
const fullChest = extra => ({ ...Object.fromEntries(Array.from({ length: CH }, (_, i) => [i, { name: 'lantern', count: 4 }])), ...extra })
const coalStep = { slot: 12, name: 'coal', count: 40, merges: [{ dest: 3, n: 40 }], dest: null }
const bagCoal = { [FROM]: { name: 'coal', count: 40 }, [TOOL]: { name: 'iron_pickaxe', count: 1 } }
const raise = (sv, n) => { if (n === 2) sv.slots[3].count = 50 }   // ANOTHER BOT, between the pickup's answer and the merge click
const settled = (sv, coal) => { assert.equal(sv.cursor, null, 'nothing is left on the cursor'); assert.equal(sv.total('coal'), coal, 'every coal is somewhere'); assert.deepEqual(sv.slots[TOOL], { name: 'iron_pickaxe', count: 1 }, 'the tool\'s slot was never swapped') }
const raceFull = async M => {
  // CODEX'S RACE: 40 coal onto a stack of 5 that another bot raises to 50 under the click; the chest has no empty slot
  const sv = server({ chest: fullChest({ 3: { name: 'coal', count: 5 } }), bagSlots: bagCoal, onClick: raise })
  const r = await M.runMerge(sv.io, coalStep, FROM)
  assert.deepEqual(r.moves, [{ dest: 3, n: 14, base: 5, after: 64, merged: true }], 'what moved is what the SERVER\'s cursor lost: 14, not the 40 the client predicted')
  assert.equal(r.stop, 'no_empty_slot'); assert.equal(r.full, true)
  assert.deepEqual(sv.cursor, { name: 'coal', count: 26 }, 'the 26 are on the server\'s cursor -- and no click followed')
  assert.equal(sv.clicks, 2)
  sv.settle(FROM)
  settled(sv, 40 + 50); assert.equal(sv.slots[FROM].count, 26, 'the rest is back in the bag slot it came from')
}
await t('THE RACE (Codex): the destination raised under the click -> 14 credited, 26 back in the bag, the tool untouched, totals conserved', () => raceFull(BF))
await t('the same race with an empty slot in the chest: 14 merge, the confirmed 26 go into it -- all 40 banked, none on the cursor', async () => {
  const sv = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: bagCoal, onClick: raise })
  const r = await BF.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, null)
  assert.deepEqual(r.moves.map(m => [m.dest, m.n, m.merged]), [[3, 14, true], [0, 26, false]])
  settled(sv, 90); assert.equal(sv.slots[FROM], null)
})
const lateMerge = async M => {
  // A LATE ANSWER: the merge click's confirmation does not come -> nothing is assumed, nothing more is clicked
  const sv = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: bagCoal, mute: n => n === 2 })
  const r = await M.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, 'merge_unconfirmed'); assert.deepEqual(r.moves, [], 'an unanswered merge is credited nothing')
  assert.equal(sv.clicks, 2, 'no click on an unconfirmed cursor')
  sv.settle(FROM); settled(sv, 45)
}
await t('A LATE SERVER ANSWER after a merge click: stop, credit nothing, click nothing more; the pickup unanswered: the same after ONE click', async () => {
  await lateMerge(BF)
  const sv = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: bagCoal, mute: n => n === 1 })
  const r = await BF.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, 'pickup_unconfirmed'); assert.equal(sv.clicks, 1); assert.deepEqual(r.moves, [])
  sv.settle(FROM); settled(sv, 45); assert.equal(sv.slots[FROM].count, 40)
})
await t('THE WINDOW CLOSED MID-SEQUENCE: the click fails, the sequence ends, the server returned its cursor to the bag -- conserved, no swap', async () => {
  const sv = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: bagCoal, closeAt: 2 })
  const r = await BF.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, 'click_failed'); assert.deepEqual(r.moves, [])
  settled(sv, 45)
  const sv2 = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: bagCoal, closeAt: 1 })
  const r2 = await BF.runMerge(sv2.io, coalStep, FROM)
  assert.equal(r2.stop, 'click_failed'); assert.equal(r2.picked, false); settled(sv2, 45)
})
const swapped = async M => {
  // the destination became ANOTHER item under the click: the server swaps -- the cursor holds sticks, and nothing more is clicked
  const sv = server({ chest: fullChest({ 3: { name: 'coal', count: 5 } }), bagSlots: bagCoal, onClick: (s, n) => { if (n === 2) s.slots[3] = { name: 'stick', count: 7 } } })
  const r = await M.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, 'cursor_swapped'); assert.deepEqual(r.moves, []); assert.equal(sv.clicks, 2)
  sv.settle(FROM); assert.equal(sv.cursor, null); assert.deepEqual(sv.slots[TOOL], { name: 'iron_pickaxe', count: 1 })
  assert.equal(sv.total('coal'), 40); assert.equal(sv.total('stick'), 7)
}
const pickupDiffers = async M => {
  const sv = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: { ...bagCoal, [FROM]: { name: 'coal', count: 10 } } })
  const r = await M.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, 'pickup_differs'); assert.equal(sv.clicks, 1); sv.settle(FROM); settled(sv, 15)
}
await t('a swap under the click, a bag stack that is not the planned one: stop at once, settle, conserved', async () => { await swapped(BF); await pickupDiffers(BF) })
await t('the plain case still works: 40 onto 5 -> one merge of 40, the cursor confirmed empty, three probes', async () => {
  const sv = server({ chest: fullChest({ 3: { name: 'coal', count: 5 } }), bagSlots: bagCoal })
  const r = await BF.runMerge(sv.io, coalStep, FROM)
  assert.deepEqual(r, { moves: [{ dest: 3, n: 40, base: 5, after: 45, merged: true }], stop: null, full: false, picked: true })
  settled(sv, 45); assert.equal(sv.confirms, 2, 'the pickup and the merge, each answered')
})
await t('THE RE-OPEN CREDITS AGAINST THE BAG: a merge is credited at most what the bag lost of the item (Codex: 40 "verified", 14 gone)', () => {
  const merge = (n, after) => ({ step: { name: 'coal', count: n }, dest: 3, base: 5, after })
  assert.deepEqual(BF.creditMoves([merge(40, 45)], { coal: 40 }, { coal: 26 }), [], 'the bag lost 14: a claim of 40 is not credited')
  assert.equal(BF.creditMoves([merge(14, 64)], { coal: 40 }, { coal: 26 }).length, 1, 'the true 14 is')
  assert.equal(BF.creditMoves([merge(14, 64), { step: { name: 'coal', count: 26 }, dest: 0 }], { coal: 40 }, {}).length, 2)
  assert.equal(BF.creditMoves([merge(14, 64)], null, null).length, 0, 'no bag counts: a merge is never credited on the slot alone')
  const plain = { step: { name: 'torch', count: 11 }, dest: 4 }
  assert.deepEqual(BF.creditMoves([plain], null, null), [plain], 'an empty-slot move with no merge is judged as before (its slot, exactly)')
})
await t('MUTANTS KILLED (Codex r1): the client\'s prediction credited; a late answer read as empty; a swap read as a merge; a wrong pickup clicked on; the bag ignored', async () => {
  await killedBy(BAGFIX_PATH, BF, '    const n = left - cur.count\n', '    const n = Math.min(left, max - base)\n', raceFull)
  await killedBy(BAGFIX_PATH, BF, "    if (!cur) return out('merge_unconfirmed')\n", '    if (!cur) cur = { name: null, count: 0 }\n', lateMerge)
  await killedBy(BAGFIX_PATH, BF, "    if (foreign(cur)) return out('cursor_swapped')\n", '', swapped)
  await killedBy(BAGFIX_PATH, BF, "  if (cur.name !== step.name || cur.count !== step.count) return out(cur.count ? 'pickup_differs' : 'pickup_empty')\n", '', pickupDiffers)
  await killedBy(BAGFIX_PATH, BF, '    const lost = before && after ? Math.max(0, (Number(before[name]) || 0) - (Number(after[name]) || 0)) : 0\n', '    const lost = Infinity\n',
    M => assert.deepEqual(M.creditMoves([{ step: { name: 'coal', count: 40 }, dest: 3, base: 5, after: 45 }], { coal: 40 }, { coal: 26 }), []))
})

// ---- M, Paper proof 11-16 (cases 3b, 4c): the plan reads the REAL items ---------------------------------------------------------------
console.log('M (Paper 3b, 4c): THE PLAN READS THE REAL ITEMS -- stack size and components')
const REG = { snowball: 16, coal: 64, iron_pickaxe: 1, ender_pearl: 16 }
const regSize = n => REG[n] ?? 1
await t('CASE 3b: a 16-stack that does not WHOLLY fit is never planned (no click at all); one that fits merges; an unknown size never merges', () => {
  const chest = () => { const c = Array.from({ length: 27 }, () => it('lantern', 4)); c[4] = it('snowball', 10, { stackSize: 16 }); return c }
  assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'snowball', count: 16 }], chest(), { merge: true, stackOf: regSize }), [], 'LIVE on Paper: 10 + 16 in a full chest moved 6 and reported success -- now nothing is planned, the deposit says full')
  assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'snowball', count: 6 }], chest(), { merge: true, stackOf: regSize }), [{ slot: 9, name: 'snowball', count: 6, dest: null, merges: [{ dest: 4, n: 6 }] }], 'a 16-stack that fits is merged')
  assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'snowball', count: 7 }], chest(), { merge: true, stackOf: regSize }), [], '7 onto 10 of 16: one too many')
  const open = chest(); open[26] = null
  assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'snowball', count: 16 }], open, { merge: true, stackOf: regSize }), [{ slot: 9, name: 'snowball', count: 16, dest: 26, merges: [{ dest: 4, n: 6 }] }], 'with an empty slot: 6 merge, 10 into it')
  assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'mystery_item', count: 5 }], [it('mystery_item', 5), null], { merge: true, stackOf: regSize }), [{ slot: 9, name: 'mystery_item', count: 5, dest: 1, merges: [] }], 'a name the registry does not know takes an empty slot, as before')
  assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'mystery_item', count: 5 }], [it('mystery_item', 5)], { merge: true, stackOf: () => undefined }), [])
})
await t('CASE 4c: a named, enchanted or damaged stack against a plain one -- either way round -- is never planned as a merge (no pickup)', () => {
  const variants = [{ nbt: { display: { Name: 'x' } } }, { components: [{ type: 'custom_name', data: 'Lucky' }] }, { components: [{ type: 'enchantments', data: { levels: { unbreaking: 1 } } }] }, { components: [{ type: 'damage', data: 3 }] }, { removedComponents: ['lore'] }]
  for (const v of variants) {
    // the bag's REAL item is the variant, the chest's is plain -- and the reverse
    for (const [bagItem, chestItem] of [[it('coal', 20, v), it('coal', 5)], [it('coal', 20), it('coal', 5, v)]]) {
      const slots = Array.from({ length: 27 }, () => it('lantern', 4)); slots[3] = chestItem
      const same = (d, st) => st.name === bagItem.name && BF.sameStack(d, bagItem)
      assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'coal', count: 20 }], slots, { merge: true, stackOf: regSize, same }), [], JSON.stringify(v))
      slots[26] = null
      assert.deepEqual(BF.mergeFit([{ slot: 9, name: 'coal', count: 20 }], slots, { merge: true, stackOf: regSize, same }), [{ slot: 9, name: 'coal', count: 20, dest: 26, merges: [] }], 'it goes whole into an empty slot, as before')
    }
  }
  // positive control: plain onto plain merges with the same callbacks
  const slots = Array.from({ length: 27 }, () => it('lantern', 4)); slots[3] = it('coal', 5)
  assert.equal(BF.mergeFit([{ slot: 9, name: 'coal', count: 20 }], slots, { merge: true, stackOf: regSize, same: d => BF.sameStack(d, it('coal', 20)) })[0].merges.length, 1)
})
await t('the confirmed pass uses the registry\'s size too: a 16-stack destination at 10 takes 6, never "54"; MUTANTS: a guessed 64 in the plan and at the click', async () => {
  const run = async M => {
    const sv = server({ chest: { 4: { name: 'snowball', count: 10 } }, bagSlots: { [FROM]: { name: 'snowball', count: 6 } } })
    const step = { slot: 12, name: 'snowball', count: 6, merges: [{ dest: 4, n: 6 }], dest: null }
    const r = await M.runMerge({ ...sv.io, slot: i => { const x = sv.view[i]; return x ? { ...x } : null }, stackOf: regSize }, step, FROM)
    assert.equal(r.stop, null); assert.deepEqual(r.moves.map(m => [m.dest, m.n]), [[4, 6]])
    // a destination already at its 16 is not clicked (the slot item carries no size here: the registry decides)
    const sv2 = server({ chest: fullChest({ 4: { name: 'snowball', count: 16 } }), bagSlots: { [FROM]: { name: 'snowball', count: 6 } } })
    const r2 = await M.runMerge({ ...sv2.io, slot: i => { const x = sv2.view[i]; return x ? { ...x } : null }, stackOf: regSize }, step, FROM)
    assert.equal(r2.stop, 'no_empty_slot'); assert.equal(sv2.clicks, 1, 'the pickup only: a full 16-stack is never clicked')
  }
  await killedBy(BAGFIX_PATH, BF, "    const max = Number(typeof io.stackOf === 'function' ? io.stackOf(step.name) : d?.stackSize) || 1\n", '    const max = 64\n', run)
  await killedBy(BAGFIX_PATH, BF, '    const max = Number(stackOf(step?.name)) || 1   // an unknown size never merges\n', '    const max = Number(stackOf(step?.name)) || 64\n',
    M => assert.deepEqual(M.mergeFit([{ slot: 9, name: 'mystery_item', count: 5 }], [it('mystery_item', 5)], { merge: true, stackOf: () => undefined }), []))
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  one(sk, 'stackOf: n => mergeStackOf\\(bot, n\\), same: \\(d, st\\) => \\{ const real = win\\.slots\\[bag\\.find\\(b => b\\.slot === st\\.slot\\)\\?\\.wslot \\?\\? -1\\] \\?\\? null; return !!real && real\\.name === st\\.name && sameStack\\(d, real\\) \\}', 'the plan judges the window\'s REAL item and the registry\'s size')
  one(sk, 'const n = Number\\(bot\\?\\.registry\\?\\.itemsByName\\?\\.\\[name\\]\\?\\.stackSize\\); return Number\\.isInteger\\(n\\) && n >= 1 \\? n : 1', 'an unknown size is 1')
})

// ---- M, Paper proof 11-16: an interrupt between a merge click and its probe -------------------------------------------------------------
await t('INTERRUPTED AFTER A MERGE CLICK, BEFORE ITS PROBE: the row credits what left the bag -- 4 after the first merge, 8 after the second (Paper: `banked -`, `bagdelta 0`)', async () => {
  // LIVE (Paper): chest 60 + 60 coal partials and one free... here: 20 coal onto two partials of 60, the skill aborted in the probe
  for (const [abortAtConfirm, want] of [[2, 4], [3, 8]]) {
    const sv = server({ chest: fullChest({ 3: { name: 'coal', count: 60 }, 5: { name: 'coal', count: 60 } }), bagSlots: { [FROM]: { name: 'coal', count: 20 }, [TOOL]: { name: 'iron_pickaxe', count: 1 } } })
    const open = { coal: 20, iron_pickaxe: 1 }
    const io = { ...sv.io, confirm: async () => { if (sv.confirms + 1 === abortAtConfirm) { sv.confirms++; throw Object.assign(new Error('interrupted'), { aborted: true }) } return sv.io.confirm() } }
    const step = { slot: 12, name: 'coal', count: 20, merges: [{ dest: 3, n: 4 }, { dest: 5, n: 4 }], dest: null }
    let moves = null
    await assert.rejects(async () => { moves = (await BF.runMerge(io, step, FROM)).moves }, /interrupted/, 'the interrupt passes through: no move is returned for the click it cut off')
    sv.settle(FROM)   // the caller's settle (every exit), then the bag as the server holds it
    const end = { coal: sv.slots.reduce((t, x, k) => t + (k >= CH && x?.name === 'coal' ? x.count : 0), 0), iron_pickaxe: 1 }
    assert.equal(sv.cursor, null); assert.equal(sv.total('coal'), 140, 'conserved')
    assert.deepEqual(BF.lossCredit({ banked: {}, before: {}, open, end }), { coal: want }, `the row credits ${want}`)
  }
})
await t('lossCredit: never less than what left the bag, never a second time; no server bag, no change; MUTANT: the loss dropped', async () => {
  const sc = M => {
    assert.deepEqual(M.lossCredit({ banked: { coal: 4 }, before: {}, open: { coal: 20 }, end: { coal: 12 } }), { coal: 8 }, 'credited 4, lost 8: 8')
    assert.deepEqual(M.lossCredit({ banked: { coal: 8 }, before: {}, open: { coal: 20 }, end: { coal: 12 } }), { coal: 8 }, 'already whole: unchanged')
    assert.deepEqual(M.lossCredit({ banked: { coal: 30 }, before: { coal: 30 }, open: { coal: 20 }, end: { coal: 16 } }), { coal: 34 }, 'an earlier container\'s 30 stand; this one adds its 4')
    assert.deepEqual(M.lossCredit({ banked: { torch: 11 }, before: {}, open: { coal: 20, torch: 11 }, end: { coal: 20 } }), { torch: 11 }, 'nothing lost of coal: nothing credited')
    assert.deepEqual(M.lossCredit({ banked: { coal: 4 }, before: {}, open: { coal: 20 }, end: null }), { coal: 4 }, 'no answered probe: the tally as it is')
    assert.deepEqual(M.lossCredit({ banked: {}, before: {}, open: { coal: 20 }, end: { coal: 26 } }), {}, 'a bag that GAINED credits nothing')
  }
  await killedBy(BAGFIX_PATH, BF, "  for (const [name, lost] of Object.entries(lostBy)) out[name] = Math.max(Number(out[name]) || 0, (Number(before?.[name]) || 0) + lost)\n", '', sc)
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  one(sk, 'if \\(ev\\?\\.answered && !ev\\.decodeFailed && ev\\.cursorEmpty\\) \\{ bagEnd = idBag\\(\\); serverBag = held\\(windowBag\\(bot, win\\)\\) \\}', 'the end bag is read after the settle, on the server\'s word, and is bagdelta\'s')
  one(sk, 'if \\(!returned && bagEnd && mergeNames\\.size\\) Object\\.assign\\(banked, lossCredit\\(\\{ banked, before: bankedAt, open: mergedOpen\\(\\), end: bagEnd \\}\\)\\)', 'an abort or a throw is credited in the finally')
  one(sk, 'if \\(bagEnd && v\\.ok && mergeNames\\.size\\) Object\\.assign\\(banked, lossCredit\\(\\{ banked, before: bankedAt, open: mergedOpen\\(\\), end: bagEnd \\}\\)\\)', 'a stop is credited after the re-open')

  assert.ok(sk.indexOf('settled = await settleCursor(bot, win)\n') < sk.indexOf('bagEnd = idBag()'), 'after the settle')
})

// ---- M, Codex r2 BLOCKER: a swap is judged on the WHOLE item, not its name ---------------------------------------------------------------
console.log('M (Codex r2): THE CURSOR\'S WHOLE IDENTITY -- a named or damaged stack swapped onto it is never read as a merge')
const namedSwap = async M => {
  // CODEX'S CASE: 40 plain coal; another bot replaces the destination with 5 NAMED coal under the click; the server SWAPS
  const sv = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: bagCoal, onClick: (s, n) => { if (n === 2) s.slots[3] = { name: 'coal', count: 5, tag: 'Lucky' } } })
  const r = await M.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, 'cursor_swapped', 'the stop names the surprise')
  assert.deepEqual(r.moves, [], 'no "35 merged": nothing is credited by the pass for a click the server answered with a swap')
  assert.equal(sv.clicks, 2, 'the named coal is never clicked into a chest slot by this pass')
  assert.deepEqual(sv.cursor, { name: 'coal', count: 5, tag: 'Lucky' })
  assert.deepEqual(sv.slots[3], { name: 'coal', count: 40 }, 'what really happened: our 40 are in the chest')
  // the caller's settle returns the foreign stack to the bag; the credit is the ORIGINAL identity's loss -- the named 5 that came in hide nothing
  const idBag = () => { const c = {}; for (let k = CH; k < sv.slots.length; k++) { const x = sv.slots[k]; if (x) { const key = M.stackKey(asItem(x)); c[key] = (c[key] ?? 0) + x.count } } return c }
  const open = { coal: 40, iron_pickaxe: 1 }
  sv.settle(FROM)
  const end = idBag()
  assert.equal(sv.cursor, null); assert.equal(sv.total('coal'), 45, 'conserved: 40 plain in the chest, 5 named in the bag')
  assert.deepEqual(sv.slots[TOOL], { name: 'iron_pickaxe', count: 1 })
  assert.equal(end.coal ?? 0, 0); assert.equal(Object.keys(end).filter(k => k.startsWith('coal#')).length, 1, 'the named coal is its own identity')
  assert.deepEqual(M.lossCredit({ banked: {}, before: {}, open: { coal: open.coal }, end }), { coal: 40 }, 'the row says what really moved: 40 (by name alone it would read 35)')
}
const damagedSwap = async M => {
  // the same with a DAMAGED TOOL put where the coal stack was
  const sv = server({ chest: { 3: { name: 'coal', count: 5 } }, bagSlots: bagCoal, onClick: (s, n) => { if (n === 2) s.slots[3] = { name: 'iron_pickaxe', count: 1, dmg: 17 } } })
  const r = await M.runMerge(sv.io, coalStep, FROM)
  assert.equal(r.stop, 'cursor_swapped'); assert.deepEqual(r.moves, []); assert.equal(sv.clicks, 2)
  sv.settle(FROM)
  assert.equal(sv.cursor, null); assert.equal(sv.total('coal'), 40); assert.equal(sv.total('iron_pickaxe'), 2, 'both tools exist; ours never left its slot')
  assert.deepEqual(sv.slots[TOOL], { name: 'iron_pickaxe', count: 1 })
}
await t('THE EXACT CASE (Codex r2): the destination replaced by a NAMED stack mid-deposit -> stop cursor_swapped, nothing of it moved by us, 40 credited, conserved; the same with a damaged tool', async () => { await namedSwap(BF); await damagedSwap(BF) })
await t('a stack of the SAME identity as the pickup is still a merge (a named stack onto its own kind); stackKey: plain is the name, anything else its own key', async () => {
  const lucky = { name: 'coal', count: 20, tag: 'Lucky' }
  const sv = server({ chest: fullChest({ 3: { name: 'coal', count: 5, tag: 'Lucky' } }), bagSlots: { [FROM]: { ...lucky } } })
  const r = await BF.runMerge(sv.io, { slot: 12, name: 'coal', count: 20, merges: [{ dest: 3, n: 20 }], dest: null }, FROM)
  assert.equal(r.stop, null); assert.deepEqual(r.moves.map(m => m.n), [20])
  assert.equal(BF.stackKey(it('coal', 5)), 'coal')
  assert.notEqual(BF.stackKey(asItem(lucky)), 'coal'); assert.ok(BF.stackKey(asItem(lucky)).startsWith('coal#'))
  assert.equal(BF.stackKey(asItem(lucky)), BF.stackKey(asItem({ ...lucky, count: 3 })), 'the count is not identity')
  assert.notEqual(BF.stackKey(asItem({ name: 'iron_pickaxe', count: 1, dmg: 17 })), BF.stackKey(asItem({ name: 'iron_pickaxe', count: 1 })))
  assert.equal(BF.stackKey(null), '')
})
await t('MUTANTS KILLED (Codex r2): the swap judged by name alone; the credit by name alone; a surprise that does not end the deposit', async () => {
  await killedBy(BAGFIX_PATH, BF, " || (!!picked0 && !!c.item && !sameStack(picked0, c.item)) || (!!picked0 !== !!c.item))", ')', namedSwap)
  await killedBy(BAGFIX_PATH, BF, "  return extra === 'null|[]|[]|0' ? it.name : `${it.name}#${extra}`", '  return it.name', namedSwap)
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  one(sk, 'item: win\\.selectedItem \\?\\? null \\}', 'the probe hands the WHOLE cursor item to the pass')
  one(sk, 'mergeNames\\?\\.add\\?\\.\\(stackKey\\(win\\.slots\\[it\\.wslot\\]\\)\\)', 'the credit is keyed by the original identity')
  one(sk, "if \\(mergeStop\\) \\{ stop = `merge:\\$\\{mergeStop\\}`; break \\}", 'a surprise ends the deposit and the row names it')
  one(sk, '!\\/\\^merge stopped: \\(no_empty_slot\\|place_refused\\)\\$\\/\\.test\\(String\\(r\\.err\\)\\)', 'a chest that is merely full is not a surprise')
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
await t('BOTH OFF-SWITCHES RESTORE 4 A DAY / 12 STANDING for a carried chest (Codex r1): BAGFIX=off, BAGFIX_CHEST=off, CHESTCARRY=off; MUTANT: bagfix ignored', async () => {
  const day = n => Array.from({ length: n }, (_, i) => ({ n: i + 1, x: i, y: 70, z: 0, at: NOW - (i + 1) * 3_600_000, world: null, state: 'placed' }))
  const old = n => Array.from({ length: n }, (_, i) => ({ n: i + 1, x: i, y: 70, z: 0, at: NOW - (30 + i) * 3_600_000, world: null, state: 'placed' }))
  const scenario = M => {
    assert.equal(M.carriedLimitsOn({}), true, 'the default: on')
    for (const env of [{ BAGFIX: 'off' }, { BAGFIX_CHEST: 'off' }, { CHESTCARRY: 'off' }, { BAGFIX: '0', CHESTCARRY: 'on' }]) {
      const on = M.carriedLimitsOn(env)
      assert.equal(on, false, JSON.stringify(env))
      assert.equal(M.chestBudget({ claims: day(4), now: NOW, carried: true, on }).ok, false, `${JSON.stringify(env)}: a fifth carried chest in a day is refused`)
      assert.match(M.chestBudget({ claims: day(4), now: NOW, carried: true, on }).why, /\(4 in 24 h\)/)
      assert.equal(M.chestBudget({ claims: old(12), now: NOW, carried: true, on }).ok, false, `${JSON.stringify(env)}: 12 standing is the limit`)
    }
    // positive control: the same ledgers pass with everything on
    assert.equal(M.chestBudget({ claims: day(4), now: NOW, carried: true, on: M.carriedLimitsOn({}) }).ok, true)
    assert.equal(M.chestBudget({ claims: old(12), now: NOW, carried: true, on: M.carriedLimitsOn({}) }).ok, true)
  }
  await killedBy(P('chestfull'), CF, 'chestCarryOn(env) && bagfixSwitches(env).chest', 'chestCarryOn(env)', scenario)
  // the authoritative claim reads the same default (structural: claimNewChest passes no `on`)
  const cf = strip(readFileSync(P('chestfull'), 'utf8'))
  one(cf, 'carried = false, on = carriedLimitsOn\\(\\) \\} = \\{\\}\\) \\{', 'chestBudget\'s default is the composed switch')
  one(cf, 'const b = chestBudget\\(\\{ claims, now, world, carried \\}\\)', 'claimNewChest uses that default')
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
  assert.deepEqual(roomSteps({ iron_nugget: 64 + 9 }).map(s => [s.name, s.count]), [['iron_nugget', 64], ['iron_nugget', 9]], 'both stacks: no keep (in bag-slot order)')
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
  one(sk, "const canConfirm = BAGFIX\\.merge && typeof bot\\?\\.craftSync\\?\\.confirmCursor === 'function'", 'no server confirmation to hand: empty slots only')
  one(sk, 'const steps = canConfirm', 'the plan merges only with it')
  one(sk, 'if \\(step\\.merges\\?\\.length\\) continue', 'a merging stack never moves in the unconfirmed pass')
  one(sk, 'const m = await runMerge\\(\\{ click: oneClick, confirm, slot: i => win\\.slots\\[i\\] \\?\\? null, emptyDest, same: d => sameStack\\(d, win\\.selectedItem\\), stackOf: n => mergeStackOf\\(bot, n\\) \\}, step, it\\.wslot\\)', 'the confirmed pass')
  one(sk, 'const ev = await confirmCursor\\(bot, win, \\{ deadline: Math\\.min\\(deadline, Date\\.now\\(\\) \\+ 1_500\\), cancelled: \\(\\) => !!signal\\?\\.aborted \\}\\)', 'the confirmation is craftsync\'s cursor probe')
  one(sk, "if \\(m\\.stop\\) \\{ err = `merge stopped: \\$\\{m\\.stop\\}`\\.slice\\(0, 80\\); break \\}", 'a stop ends the pass: no further click')
  one(sk, 'verified: creditMoves\\(done\\.filter\\(x => destHolds\\(win\\.slots\\[x\\.dest\\], x\\)\\), before, bag\\)', 'the re-open credits against the bag')
  one(sk, "!\\(st === 'full' && fullOk\\?\\.\\(posKey\\(p\\)\\)\\)\\) continue", 'townContainers')
  one(sk, 'const next0 = fullChestNext\\(\\{ nearHome, unknown: unk, budget, carried: !!carried \\}\\)', 'the recovery skips an unreadable container')
  one(sk, 'const skip = \\[\\.\\.\\.failedSites\\(claims\\)\\]', 'the site picker')
  one(sk, 'claimNewChest\\(\\{ dir, key, site, world, carried: !!carried \\}\\)', 'chestcarry-01 is on this line')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall bagfix tests passed')
