// craftsync.mjs: lockstep clicks (best effort) + server-verified results (truth) while bot.craft runs.
//
// The scenario tests run mineflayer 4.37.1's REAL craft.js + inventory.js against test/helpers/fake-paper-craft.mjs,
// a server model of the behaviours the sandbox trace showed. The first test is the positive control: bare
// mineflayer must LOSE the craft against the fake while reporting success, or nothing after it means anything.
// The mutants live in craftsync-mutants.test.mjs (same fixtures), to keep each file inside the runner's timeout.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as CS from '../src/craftsync.mjs'
import { Item, VERSION, id, FakePaper, craftBot, recipeFor } from './helpers/fake-paper-craft.mjs'
import { trial as trialWith, restored, stubBot, STUB_RECIPE, INV, INV2, INV3 } from './helpers/craftsync-trial.mjs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-craftsync-'))
// The craft skill's deadline is the runner's skill timeout. The suite runner sets 300 ms (for hard-stop tests),
// which leaves no room to craft and verify -- the skill then correctly refuses with craft_deadline. This file
// tests the abort path, so it gets the production timeout; the deadline itself is tested on bot.craft below.
process.env.SKILL_TIMEOUT_MS = '180000'
const { SKILLS, craftFailureOutcome, CRAFT_ABORTED, statusFor, craftsFor } = await import('../src/skills.mjs')
const { evidenceScope } = await import('../src/cognitive.mjs')

const require_ = createRequire(import.meta.url)
const trial = (o) => trialWith(CS, o)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
let unhandled = 0
process.on('unhandledRejection', () => { unhandled++ })

// ------------------------------------------------------------------ the mechanism, and the fix
let bare
await t('POSITIVE CONTROL: bare mineflayer loses the table craft against the fake, and reports success', async () => {
  bare = await trial({ wrap: false })
  assert.equal(bare.error, null, 'bare craft threw; the defect is that it does NOT')
  assert.equal(bare.server.count('wooden_pickaxe'), 0, 'the fake did not reproduce the loss; every test below is unproven')
  assert.equal(bare.server.count('oak_planks'), 7, 'the grid was handed back on close')
  assert.ok(bare.server.staleClicks > 1, 'the loss must come from stale clicks, as on the sandbox')
})

await t('lockstep keeps the craft: one pickaxe on the SERVER, ingredients spent, confirmed via resync', async () => {
  const r = await trial()
  assert.equal(r.error, null, r.error?.message)
  assert.equal(r.server.count('wooden_pickaxe'), 1)
  assert.equal(r.server.count('oak_planks'), 4)
  assert.equal(r.server.count('stick'), 2)
  assert.equal(r.rows[0].args.confirmed, 'yes')
  assert.equal(r.rows[0].args.verify_source, 'resync')
})

let aOnly
await t('arm A alone (no stateId rewrite) keeps it too: stale clicks still happen, and lockstep absorbs them', async () => {
  aOnly = await trial({ opts: { rewriteStateId: false } })
  assert.ok(aOnly.server.staleClicks > aOnly.resyncs.length, 'with B off the clicks should still be stale; this is not testing A')
  assert.equal(aOnly.error, null, aOnly.error?.message)
  assert.equal(aOnly.server.count('wooden_pickaxe'), 1)
})

await t('two crafts in one window: bare comes up short, lockstep makes both', async () => {
  const b = await trial({ wrap: false, inv: INV2, count: 2 })
  assert.ok(b.server.count('wooden_pickaxe') < 2, `bare made ${b.server.count('wooden_pickaxe')}; the repeat case is not reproduced`)
  const r = await trial({ inv: INV2, count: 2, opts: { rewriteStateId: false } })
  assert.equal(r.error, null, r.error?.message)
  assert.equal(r.server.count('wooden_pickaxe'), 2)
  assert.equal(r.tableResyncs.length, 1, 'one resync per window, not per craft')
})

await t('lockstep on the wire: no two real clicks closer than quietMs (A-only, so nothing else hides a burst)', async () => {
  assert.ok(bare.minGap < 20, `positive control: bare clicks burst (min gap ${bare.minGap} ms)`)
  assert.ok(aOnly.minGap >= CS.CRAFT_SYNC.quietMs, `min gap ${aOnly.minGap} ms < ${CS.CRAFT_SYNC.quietMs}`)
})

await t('2x2 inventory craft: lockstepped, no container resync, sticks land on the server and are confirmed', async () => {
  const r = await trial({ item: 'stick', table: false, inv: { 36: ['oak_planks', 5], 9: ['dirt', 64] } })
  assert.equal(r.error, null, r.error?.message)
  assert.equal(r.server.count('stick'), 4)
  assert.equal(r.tableResyncs.length, 0)
  assert.ok(r.minGap >= CS.CRAFT_SYNC.quietMs)
  assert.equal(r.rows[0].args.confirmed, 'yes')
})

// ------------------------------------------------------------------ 1. verification is the truth
await t('LIMIT, DOCUMENTED: a refresh slower than quietMs beats lockstep -- and verification says so', async () => {
  // fallbackMs 400 >> quietMs 100: each refresh lands ~3 lockstep clicks late, as the burst's did. A-only.
  // (At 150-300 ms lockstep still happened to keep this recipe; 400 is where it loses. A model, not Paper.)
  const r = await trial({ lag: 999, fallbackMs: 400, opts: { rewriteStateId: false } })
  assert.equal(r.server.count('wooden_pickaxe'), 0, 'lockstep survived a slow refresh here; this test no longer shows the limit')
  assert.ok(r.error, 'the lost craft RESOLVED: verification did not catch it')
  assert.equal(r.error.failClass, 'craft_unconfirmed')
  assert.equal(r.error.produced, 0)
  assert.equal(r.error.requested, 1)
  assert.equal(r.rows[0].args.confirmed, 'no')
  assert.equal(r.rows[0].args.verify_source, 'resync')
  assert.ok(Number.isFinite(r.rows[0].args.max_answer_ms))
})

await t('craftConfirmed: produced must cover count x result.count, and only a SERVER count confirms', () => {
  const A = { authoritative: true }
  assert.deepEqual(CS.craftConfirmed({ before: 2, after: 6, count: 1, perCraft: 4, ...A }), { requested: 4, produced: 4, confirmed: true })
  assert.equal(CS.craftConfirmed({ before: 2, after: 5, count: 1, perCraft: 4, ...A }).confirmed, false)
  assert.equal(CS.craftConfirmed({ before: 0, after: 1, count: 2, perCraft: 1, ...A }).confirmed, false)
  assert.equal(CS.craftConfirmed({ before: NaN, after: 1, count: 1, perCraft: 1, ...A }).confirmed, false, 'no count is no confirmation')
  assert.equal(CS.craftConfirmed({ before: 2, after: 6, count: 1, perCraft: 4 }).confirmed, false, 'a local count must never confirm')
})

await t('AUTHORITATIVE: a missing before- or after-resync answer is craft_unconfirmed, even when the local count rose', async () => {
  for (const [answers, which] of [[[Infinity, 20, 20], 'before'], [[20, 20, Infinity], 'after']]) {
    const { bot } = stubBot({ click: async () => {}, resyncAnswerMs: answers })
    const rows = []
    CS.installCraftSync(bot, { log: r => rows.push(r), resyncCapMs: 200 })
    let err = null
    try { await bot.craft(STUB_RECIPE, 1) } catch (e) { err = e }
    assert.equal(bot.made, 1, 'the stub craft did make its item; the count rose locally')
    assert.equal(err?.failClass, 'craft_unconfirmed', `${which} unanswered was confirmed from the local count`)
    assert.equal(err.reason, 'unverified')
    assert.equal(rows[0].args.confirmed, 'no')
    assert.match(rows[0].args.verify_source, new RegExp(`local \\(${which} unanswered\\)`))
  }
})

await t('a click timeout REJECTS, and the abandoned click\'s late error leaks nowhere', async () => {
  let n = 0
  const { bot } = stubBot({ click: () => (++n === 1
    ? new Promise((resolve, reject) => setTimeout(() => reject(new Error('late failure')), 300))
    : Promise.resolve()) })
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), clickCapMs: 100 })
  let err = null
  try { await bot.craft(STUB_RECIPE, 1) } catch (e) { err = e }
  assert.ok(err, 'the craft resolved although its click was never answered')
  assert.equal(err.failClass, 'craft_unconfirmed')
  assert.match(err.message, /not answered in 100 ms/)
  await new Promise(resolve => setTimeout(resolve, 400))            // the late rejection fires now
  const before = unhandled
  await bot.craft(STUB_RECIPE, 1)                                  // later work is untouched
  assert.equal(unhandled, before)
  assert.equal(unhandled, 0, 'an abandoned click\'s rejection escaped')
  assert.equal(rows.at(-1).args.confirmed, 'yes')
})

// ------------------------------------------------------------------ 3. one craft at a time
await t('a second craft while one is running is refused as craft_busy; the first completes', async () => {
  let second = null
  const r = await trial({
    during: async ({ bot }) => {
      await new Promise(resolve => setTimeout(resolve, 50))
      try { await bot.craft(bot.recipesFor(id('wooden_pickaxe'), null, 1, true)[0], 1, null) } catch (e) { second = e }
    },
  })
  assert.ok(second, 'the overlapping craft was let through')
  assert.equal(second.failClass, 'craft_busy')
  assert.equal(evidenceScope('craft_busy'), null, 'busy must not vote')
  assert.equal(r.error, null, r.error?.message)
  assert.equal(r.server.count('wooden_pickaxe'), 1)
})

// ------------------------------------------------------------------ 4. resync safety
await t('cursorProvablyEmpty: only an empty statement with no click since, for that window or any', () => {
  assert.equal(CS.cursorProvablyEmpty(null, 3, 0), false)
  assert.equal(CS.cursorProvablyEmpty({ win: 3, clicks: 2 }, 3, 2), true)
  assert.equal(CS.cursorProvablyEmpty({ win: 3, clicks: 2 }, 3, 3), false, 'a click since may have filled it')
  assert.equal(CS.cursorProvablyEmpty({ win: 3, clicks: 0 }, 4, 0), false)
  assert.equal(CS.cursorProvablyEmpty({ win: 'any', clicks: 0 }, 4, 0), true)
})

await t('resync: the first click in a container is a stateId -1 no-op outside the window, sent once', async () => {
  const r = await trial()
  assert.equal(r.tableResyncs.length, 1)
  const firstTable = r.clicks.find(w => w.params.windowId !== 0)
  assert.equal(firstTable, r.tableResyncs[0], 'the resync must precede every real click in the table')
  assert.deepEqual({ ...r.tableResyncs[0].params, cursorItem: undefined },
    { windowId: firstTable.params.windowId, stateId: -1, slot: -999, mouseButton: 0, mode: 0, changedSlots: [], cursorItem: undefined })
  assert.ok(r.rows[0].args.resync_answered >= 1)
})

await t('resync SKIPPED when the server cursor is not provably empty: nothing is dropped', async () => {
  const r = await trial({ cursorOnOpen: ['dirt', 3] })
  assert.equal(r.tableResyncs.length, 0, 'a -999 click went out with a held cursor -- that drops it')
  assert.ok(r.rows[0].args.resync_skipped >= 1)
  assert.deepEqual(r.server.dropped, [])
})

await t('only a window_items for THAT window answers a resync', async () => {
  // window 5's resync is "answered" with set_slot(5) and window_items(0); window 0's two resyncs are answered properly
  const { bot } = stubBot({ click: async () => {}, wrongAnswers: true })
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), resyncCapMs: 200 })
  await bot.craft(STUB_RECIPE, 1)
  assert.equal(rows[0].args.resyncs, 3)
  assert.equal(rows[0].args.resync_answered, 2, 'set_slot or another window\'s window_items was taken as the answer')
  assert.equal(rows[0].args.resync_caps, 1)
})

await t('CURSOR PROOF AT SEND TIME: a non-empty set_cursor_item during the pre-resync wait -> no resync is sent', async () => {
  const { bot } = stubBot({ click: async () => {} })
  bot.craft = async () => {
    bot.currentWindow = { id: 5 }
    try {
      bot._client.emit('window_items', { windowId: 5, stateId: 1, items: [], carriedItem: { itemCount: 0 } })   // proof...
      setTimeout(() => bot._client.emit('set_cursor_item', { contents: { itemCount: 1, itemId: 5 } }), 40)     // ...gone mid-wait
      await bot.clickWindow(3, 0, 0)
      bot.made++
    } finally { bot.currentWindow = null }
  }
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  await bot.craft(STUB_RECIPE, 1)
  const sent = bot._client.writes.filter(w => w.name === 'window_click' && w.params.windowId === 5 && w.params.slot === -999)
  assert.equal(sent.length, 0, 'a -999 resync went out with a cursor the server had just said was full')
  assert.ok(rows[0].args.resync_skipped >= 1)
})

await t('resync packet serializes for 1.21.8 exactly as mineflayer encodes an empty cursor', () => {
  const { createSerializer } = require_('minecraft-protocol')
  const ser = createSerializer({ state: 'play', isServer: false, version: VERSION })
  const ours = ser.createPacketBuffer({ name: 'window_click', params: CS.resyncPacket(3) })
  const theirs = ser.createPacketBuffer({ name: 'window_click', params: { ...CS.resyncPacket(3), cursorItem: Item.toNotch(null) } })
  assert.equal(ours.toString('hex'), theirs.toString('hex'))
})

// ------------------------------------------------------------------ arm B
await t('withWindowStateId uses the per-window value and leaves unknown windows alone', () => {
  const ids = new Map([[0, 512], [3, 7]])
  assert.equal(CS.withWindowStateId({ windowId: 3, stateId: 512 }, ids).stateId, 7)
  const same = { windowId: 3, stateId: 7 }
  assert.equal(CS.withWindowStateId(same, ids), same, 'no copy when nothing changes')
  const unknown = { windowId: 9, stateId: 512 }
  assert.equal(CS.withWindowStateId(unknown, ids), unknown)
})

await t('arm B on: every real click carries its window\'s own stateId, so only the resyncs are stale', async () => {
  const r = await trial()
  assert.equal(r.server.staleClicks, r.resyncs.length, `stale ${r.server.staleClicks}, resyncs ${r.resyncs.length}`)
  assert.ok(r.rows[0].args.stateid_rewrites > 0)
})

// ------------------------------------------------------------------ restore, abort, throw
await t('wrappers are mineflayer\'s again after a successful craft', async () => {
  const r = await trial()
  assert.ok(restored(r), 'a wrapper outlived the craft')
  assert.equal(r.bot.craftSync.busy(), false)
})

await t('wrappers restored when the craft throws mid-way (missing ingredient after the planks)', async () => {
  const r = await trial({ before: async ({ server }) => { server.p[37] = null; await server.sync() } })
  assert.ok(r.error && /missing ingredient/.test(r.error.message), `expected mineflayer's own error, got ${r.error?.message}`)
  assert.ok(r.real.length >= 3, 'the throw must come mid-craft, with wrappers installed')
  assert.ok(restored(r))
  assert.equal(r.rows[0].status, 'failed')
})

await t('abort mid-craft: stops within one click, closes the window, restores everything, says aborted', async () => {
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 400)
  const r = await trial({ options: { signal: ac.signal } })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.ok(r.ms < 400 + 300, `took ${r.ms} ms after a 400 ms abort`)
  assert.ok(r.writes.some(w => w.name === 'close_window' && w.params.windowId !== 0), 'mineflayer\'s catch should close the table')
  assert.ok(restored(r))
  assert.equal(r.rows[0].args.outcome, 'aborted')
})

// ------------------------------------------------------------------ 6. cancellation while mineflayer awaits windowOpen
await t('abort while awaiting windowOpen returns promptly; only the fuse stays until the late window is refused', async () => {
  // 400 ms: after the baseline count (~200 ms here), so mineflayer has asked for the table and is waiting on it
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 400)
  let mid = null
  const r = await trial({
    openDelayMs: 900, options: { signal: ac.signal },
    during: async ({ bot, orig }) => {
      await new Promise(resolve => setTimeout(resolve, 650))       // after the abort (400), before the table opens (~1100)
      mid = { fuse: bot.clickWindow !== orig.clickWindow, write: bot._client.write === orig.write, putAway: bot.putAway === orig.putAway,
              busy: bot.craftSync.busy() }
      let busyErr = null
      try { await bot.craft(bot.recipesFor(id('wooden_pickaxe'), null, 1, true)[0], 1, null) } catch (e) { busyErr = e }
      mid.busyErr = busyErr?.failClass
      await new Promise(resolve => setTimeout(resolve, 1200))       // the table opens at 900 ms; the zombie hits the fuse
      return { clickBack: bot.clickWindow === orig.clickWindow, busy: bot.craftSync.busy() }
    },
  })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.ok(r.writes.some(w => w.name === 'window_click' && w.params.windowId === 0 && w.params.stateId === -1), 'the baseline did not finish before the abort')
  assert.ok(r.ms < 400 + CS.CRAFT_SYNC.quietMs + 150, `took ${r.ms} ms to honour an abort at 400 ms`)
  assert.ok(mid.write && mid.putAway, 'wrappers other than the fuse must be gone at once')
  assert.ok(mid.fuse && mid.busy, 'the abandoned craft must be fused and count as busy')
  assert.equal(mid.busyErr, 'craft_busy')
  assert.equal(r.real.filter(w => w.params.windowId !== 0).length, 0, 'the abandoned craft clicked the late window')
  assert.ok(r.writes.some(w => w.name === 'close_window' && w.params.windowId !== 0), 'the late window was not closed')
  assert.deepEqual(r.sideResult, { clickBack: true, busy: false })
})

await t('disconnect while awaiting windowOpen: aborted, promptly', async () => {
  const r = await trial({ openDelayMs: Infinity, during: async ({ bot }) => { await new Promise(resolve => setTimeout(resolve, 400)); bot.emit('end') } })
  assert.ok(r.error?.aborted && /disconnected/.test(r.error.message), `got ${r.error?.message}`)
  assert.ok(r.ms < 400 + CS.CRAFT_SYNC.quietMs + 150, `took ${r.ms} ms`)
})

// ------------------------------------------------------------------ 5. other inventory actions preempt
await t('a reflex equip mid-craft preempts it: the craft unwinds first, the equip waits < 2 s, nothing interleaves', async () => {
  const seen = []
  const r = await trial({
    equip: (bot) => async function () { seen.push({ t: Date.now(), clickWindowIsMineflayers: bot.clickWindow === bot.__origClick, writes: bot.__server.writes.length }) },
    before: async ({ bot, server }) => { bot.__server = server },
    during: async ({ bot, orig }) => {
      bot.__origClick = orig.clickWindow
      await new Promise(resolve => setTimeout(resolve, 500))
      const t0 = Date.now()
      await bot.equip({ name: 'stone_sword' }, 'hand')
      return { waited: Date.now() - t0 }
    },
  })
  assert.equal(seen.length, 1, 'the equip never ran')
  assert.ok(r.sideResult.waited < CS.CRAFT_SYNC.preemptWaitMs, `the reflex waited ${r.sideResult.waited} ms`)
  assert.ok(seen[0].clickWindowIsMineflayers, 'the equip ran with the craft\'s wrappers still installed')
  assert.ok(r.error?.aborted && /preempted by equip/.test(r.error.message), `got ${r.error?.message}`)
  assert.equal(r.rows[0].args.preempted, true, 'the row must say the craft was preempted')
  const craftClicksAfter = r.server.writes.slice(seen[0].writes).filter(w => w.name === 'window_click')
  assert.equal(craftClicksAfter.length, 0, 'the craft clicked after the equip began')
})

await t('an equip during the baseline count stops the craft before mineflayer starts it: no table, no clicks', async () => {
  const r = await trial({
    equip: () => async function () {},
    during: async ({ bot }) => { await new Promise(resolve => setTimeout(resolve, 20)); await bot.equip({ name: 'stone_sword' }, 'hand') },
  })
  assert.ok(r.error?.aborted && /preempted by equip/.test(r.error.message), `got ${r.error?.message}`)
  assert.equal(r.real.length, 0, 'the craft clicked after it was preempted')
  assert.equal(r.server.nextWindowId, 1, 'the craft opened the table after it was preempted')
  assert.ok(restored(r))
})

// ------------------------------------------------------------------ 7. deadline
await t('repeated crafts stop at the deadline, never past it, and report produced/requested from the server', async () => {
  const deadlineIn = 2600
  let deadline
  const r = await trial({ inv: INV3, count: 3, before: async () => { deadline = Date.now() + deadlineIn }, options: { get deadline () { return deadline } } })
  assert.ok(r.error, 'three crafts fit in 2.6 s; the deadline was not exercised')
  assert.equal(r.error.failClass, 'craft_deadline', r.error.message)
  assert.equal(r.error.requested, 3)
  assert.ok(r.error.produced < 3)
  assert.equal(r.error.produced, r.server.count('wooden_pickaxe'), 'produced must be the server\'s count')
  assert.ok(r.ms <= deadlineIn + 30, `the craft ran ${r.ms} ms against a ${deadlineIn} ms deadline`)
  assert.equal(statusFor('craft_deadline'), 'unknown', 'running out of clock is not a failure of the recipe')
})

// ------------------------------------------------------------------ abort at entry and during verification
await t('an already-aborted signal is an interruption, not craft_deadline, and sends nothing', async () => {
  const ac = new AbortController(); ac.abort()
  const r = await trial({ options: { signal: ac.signal } })
  assert.ok(r.error?.aborted, `got ${r.error?.failClass}: ${r.error?.message}`)
  assert.equal(r.error.failClass, 'interrupted')
  assert.equal(r.writes.length, 0)
})

await t('abort DURING verification stops it promptly and says aborted', async () => {
  const { bot } = stubBot({ click: async () => {}, resyncAnswerMs: [20, 20, 1500] })   // the after-resync is slow
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 900)                                    // ~200 ms into the after-resync wait
  const t0 = Date.now()
  let err = null
  try { await bot.craft(STUB_RECIPE, 1, null, { signal: ac.signal }) } catch (e) { err = e }
  const ms = Date.now() - t0
  assert.equal(bot._client.writes.filter(w => w.name === 'close_window' && w.params.windowId === 0).length, 2, 'verification had not started')
  assert.ok(err?.aborted, `got ${err?.failClass}: ${err?.message}`)
  assert.ok(ms < 900 + 150, `verification ignored the abort for ${ms - 900} ms`)
})

// ------------------------------------------------------------------ count semantics: items, not crafts
await t('craftsFor: items wanted -> crafts, by the recipe\'s yield', () => {
  assert.equal(craftsFor(4, { result: { count: 4 } }), 1)
  assert.equal(craftsFor(5, { result: { count: 4 } }), 2)
  assert.equal(craftsFor(16, { result: { count: 4 } }), 4)
  assert.equal(craftsFor(1, { result: { count: 1 } }), 1)
  assert.equal(craftsFor(undefined, { result: { count: 4 } }), 1)
})

async function skillCraft (inv, item, count) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  recipeFor(bot, server, item, false)                                   // the server learns the recipe
  const out = await SKILLS.craft.run({ bot }, { item, count }, new AbortController().signal)
  await server.settle(); server.stop()
  return { out, server, rows }
}
await t('SKILL: 4 sticks from 2 planks is ONE craft -- success, 4 sticks, planks spent', async () => {
  const { out, server, rows } = await skillCraft({ 36: ['oak_planks', 2], 9: ['dirt', 64] }, 'stick', 4)
  assert.equal(out.status, 'success', JSON.stringify(out))
  assert.equal(server.count('stick'), 4)
  assert.equal(server.count('oak_planks'), 0)
  assert.deepEqual([rows[0].args.count, rows[0].args.produced, rows[0].args.confirmed], [1, 4, 'yes'])
})
await t('SKILL: 16 planks from 4 logs is FOUR crafts -- one verified bot.craft each (craftroom: the room check before every one)', async () => {
  const { out, server, rows } = await skillCraft({ 36: ['oak_log', 4], 9: ['dirt', 64] }, 'oak_planks', 16)
  assert.equal(out.status, 'success', JSON.stringify(out))
  assert.equal(server.count('oak_planks'), 16)
  assert.equal(server.count('oak_log'), 0)
  assert.deepEqual(rows.map(r => [r.args.count, r.args.produced, r.args.requested, r.args.confirmed]), Array(4).fill([1, 4, 4, 'yes']))
  assert.deepEqual([out.requested, out.executions, out.produced], [16, 4, 16], 'the skill sums what craftsync verified, once')
})

// ------------------------------------------------------------------ 2. the skill: abort is aborted
await t('craftFailureOutcome: an aborted signal is ABORTED whatever the error says; classes carry produced/requested', () => {
  assert.equal(craftFailureOutcome(new Error('Event windowOpen did not fire'), { aborted: true, item: 'stick' }), CRAFT_ABORTED)
  assert.equal(craftFailureOutcome(Object.assign(new Error('x'), { aborted: true }), { item: 'stick' }), CRAFT_ABORTED)
  const busy = craftFailureOutcome(new CS.CraftSyncError('busy', { failClass: 'craft_busy' }), { item: 'stick' })
  assert.deepEqual([busy.status, busy.failClass], ['failed', 'craft_busy'])
  const un = craftFailureOutcome(new CS.CraftSyncError('m', { failClass: 'craft_unconfirmed', produced: 0, requested: 4 }), { item: 'stick' })
  assert.equal(un.failClass, 'craft_unconfirmed'); assert.match(un.detail, /0 of 4/)
  const dl = craftFailureOutcome(new CS.CraftSyncError('m', { failClass: 'craft_deadline', produced: 2, requested: 3 }), { item: 'stick' })
  assert.deepEqual([dl.status, dl.failClass], ['unknown', 'craft_deadline']); assert.match(dl.detail, /2 of 3/)
  for (const fc of ['craft_busy', 'craft_unconfirmed', 'craft_deadline']) assert.equal(evidenceScope(fc), null, `${fc} must not vote`)
})

await t('the craft SKILL throws Aborted when its signal is aborted mid-craft (runner: aborted/interrupted)', async () => {
  const ac = new AbortController()
  let thrown = null, returned = null
  await trial({
    item: 'stick', table: false, inv: { 36: ['oak_planks', 5], 9: ['dirt', 64] },
    before: async ({ bot }) => {
      // run the skill instead of the bare call: the trial's own bot.craft call is a no-op recipe-less refusal
      setTimeout(() => ac.abort(), 300)
      try { returned = await SKILLS.craft.run({ bot }, { item: 'stick', count: 1 }, ac.signal) } catch (e) { thrown = e }
    },
  })
  assert.equal(returned, null, `the skill returned ${JSON.stringify(returned)} instead of throwing Aborted`)
  assert.ok(thrown?.aborted, `threw ${thrown?.message}`)
})

// ------------------------------------------------------------------ caps
await t('caps bound every wait at the DEFAULTS: a silent server costs 3 x (quiet + resync 1 s + quiet) + click 4 s', async () => {
  assert.deepEqual([CS.CRAFT_SYNC.quietMs, CS.CRAFT_SYNC.quietCapMs, CS.CRAFT_SYNC.clickCapMs, CS.CRAFT_SYNC.resyncCapMs], [100, 1000, 4000, 1000])
  const { bot } = stubBot({ resyncAnswerMs: Infinity })
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  const t0 = Date.now()
  let err = null
  try { await bot.craft(STUB_RECIPE, 1) } catch (e) { err = e }
  const ms = Date.now() - t0
  assert.ok(ms >= 7500 && ms < 8500, `silent craft took ${ms} ms`)
  assert.equal(err?.failClass, 'craft_unconfirmed')
  assert.equal(rows[0].args.resync_caps, 3)
  assert.equal(rows[0].args.click_caps, 1, 'click_caps is the tripwire on the row')
})

await t('caps bound the quiet wait when the window never goes quiet', async () => {
  const { bot, stop } = stubBot({ click: async () => {}, spam: () => ['window_items', { windowId: 5, stateId: 1, items: [], carriedItem: { itemCount: 0 } }] })
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), quietCapMs: 250 })
  const t0 = Date.now()
  await bot.craft(STUB_RECIPE, 1)
  const ms = Date.now() - t0
  stop()
  assert.equal(rows[0].args.quiet_caps, 3, 'before the resync, after it, after the click (window 0 is quiet)')
  assert.ok(ms < 3 * 250 + 800, `took ${ms} ms`)
})

await t('quietReached: needs quietMs since the wait began AND since the last packet', () => {
  assert.equal(CS.quietReached({ now: 1000, start: 950, lastPacketAt: 0, quietMs: 100 }), false)
  assert.equal(CS.quietReached({ now: 1000, start: 900, lastPacketAt: 950, quietMs: 100 }), false)
  assert.equal(CS.quietReached({ now: 1000, start: 900, lastPacketAt: 900, quietMs: 100 }), true)
})

// ------------------------------------------------------------------ install + telemetry + wiring
await t('install refuses a bot whose plugins have not loaded (the createBot-time overwrite)', async () => {
  const { EventEmitter } = await import('node:events')
  const bot = new EventEmitter(); bot._client = new EventEmitter(); bot._client.write = () => {}
  assert.throws(() => CS.installCraftSync(bot), /plugins not loaded/)
})

await t('one _craft_sync row per craft: confirmed, produced/requested, max answer, and the wire\'s click count', async () => {
  const r = await trial()
  assert.equal(r.rows.length, 1)
  const a = r.rows[0].args
  assert.equal(r.rows[0].kind, 'craft_sync')
  assert.equal(a.clicks, r.real.length, `row says ${a.clicks} clicks, the wire carried ${r.real.length}`)
  assert.deepEqual([a.confirmed, a.produced, a.requested, a.outcome], ['yes', 1, 1, 'ok'])
  assert.equal(a.resyncs, r.resyncs.length)
  assert.ok(a.wait_ms >= a.clicks * CS.CRAFT_SYNC.quietMs)
  assert.ok(a.max_answer_ms >= 0 && a.max_answer_ms < CS.CRAFT_SYNC.quietMs)
  assert.equal(a.quiet_caps + a.click_caps + a.resync_caps, 0)
  assert.equal(a.item, 'wooden_pickaxe')
})

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
/** Is installCraftSync(bot ...) called inside the body of the spawn handler? (brace depth from the opener) */
function wiredAtSpawn (code) {
  const at = code.indexOf('installCraftSync(bot')
  if (at < 0 || code.indexOf('installCraftSync(bot', at + 1) >= 0) return false
  const openers = [...code.slice(0, at).matchAll(/bot\.(?:once|on)\('(\w+)'[^{]*\{/g)]
  for (const m of openers.reverse()) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < at; i++) { if (code[i] === '{') depth++; else if (code[i] === '}') depth-- }
    if (depth > 0) return m[1] === 'spawn'
  }
  return false
}
await t('WIRED: index.mjs installs craftsync inside the spawn handler; skills.mjs hands the craft its signal and deadline', () => {
  const idx = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
  assert.ok(wiredAtSpawn(idx), 'installCraftSync is not called (exactly once) inside bot.once(\'spawn\')')
  const mutant = idx.replace(/\n[^\n]*installCraftSync\(bot[^\n]*/, '').replace('const runner = new Runner(bot)', 'installCraftSync(bot, {})\n  const runner = new Runner(bot)')
  assert.ok(mutant.includes('installCraftSync(bot, {})') && !wiredAtSpawn(mutant), 'the wiring check cannot see a createBot-time install')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(sk.includes('got = await bot.craft(recipe, 1, table ?? undefined, { signal, deadline })'))
})

await new Promise(resolve => setTimeout(resolve, 50))
assert.equal(unhandled, 0)
console.log(`\n${pass} passed, ${fail} failed${unhandled ? `, ${unhandled} unhandled rejections` : ''}`)
process.exit(fail || unhandled ? 1 : 0)
