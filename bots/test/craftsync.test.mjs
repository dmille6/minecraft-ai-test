// craftsync.mjs: lockstep clicks while bot.craft runs (see the header there for the sandbox evidence).
//
// The scenario tests run mineflayer 4.37.1's REAL craft.js + inventory.js against test/helpers/fake-paper-craft.mjs,
// a server model of the four behaviours the sandbox trace showed. The first test is the positive control: bare
// mineflayer must LOSE the craft against the fake while reporting success, or nothing after it means anything.
//
// The fake's refresh lands 3 client clicks behind, or 60 ms after the click, whichever is first. Both are model
// parameters, not Paper measurements: 3 clicks is where a 10 ms-paced client (the no-quiet-wait mutant) loses the
// craft as a microsecond burst does; 60 ms is under quietMs, so a lockstep client is waiting when it lands.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as CS from '../src/craftsync.mjs'
import { FakePaper, craftBot, recipeFor, TABLE, Item, VERSION } from './helpers/fake-paper-craft.mjs'

const require_ = createRequire(import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const INV = { 36: ['oak_planks', 7], 37: ['stick', 4], 9: ['dirt', 64] }   // spare ingredients: the losing case
const INV2 = { 36: ['oak_planks', 9], 37: ['stick', 5], 9: ['dirt', 64] }  // two pickaxes, with spares

async function trial ({ mod = CS, wrap = true, opts = {}, item = 'wooden_pickaxe', table = true, count = 1, inv = INV,
                        lag = 3, fallbackMs = 60, signal = null, before = null } = {}) {
  const server = new FakePaper({ lagClicks: lag, fallbackMs, inventory: inv })
  const bot = craftBot(server)
  await server.sync()
  const orig = { clickWindow: bot.clickWindow, putAway: bot.putAway, putSelectedItemRange: bot.putSelectedItemRange, write: bot._client.write }
  const rows = []
  if (wrap) mod.installCraftSync(bot, { log: r => rows.push(r), ...opts })
  const recipe = recipeFor(bot, server, item, table)
  if (before) await before({ server, bot })
  const startWrite = server.writes.length
  const t0 = Date.now()
  let error = null
  try { await bot.craft(recipe, count, table ? TABLE : undefined, signal ? { signal } : undefined) } catch (e) { error = e }
  const ms = Date.now() - t0
  const writes = server.writes.slice(startWrite)
  await server.settle(); server.stop()
  const clicks = writes.filter(w => w.name === 'window_click')
  const resyncs = clicks.filter(w => w.params.stateId === -1 && w.params.slot === -999)
  const real = clicks.filter(w => !resyncs.includes(w))
  const gaps = real.slice(1).map((w, i) => w.t - real[i].t)
  return { server, bot, rows, error, ms, orig, writes, clicks, resyncs, real, minGap: gaps.length ? Math.min(...gaps) : Infinity }
}
const restored = (r) => r.bot.clickWindow === r.orig.clickWindow && r.bot.putAway === r.orig.putAway &&
  r.bot.putSelectedItemRange === r.orig.putSelectedItemRange && r.bot._client.write === r.orig.write

// ------------------------------------------------------------------ the mechanism, and the fix
let bare
await t('POSITIVE CONTROL: bare mineflayer loses the table craft against the fake, and reports success', async () => {
  bare = await trial({ wrap: false })
  assert.equal(bare.error, null, 'bare craft threw; the defect is that it does NOT')
  assert.equal(bare.server.count('wooden_pickaxe'), 0, 'the fake did not reproduce the loss; every test below is unproven')
  assert.equal(bare.server.count('oak_planks'), 7, 'the grid was handed back on close')
  assert.equal(bare.server.count('stick'), 4)
  assert.ok(bare.server.staleClicks > 1, 'the loss must come from stale clicks, as on the sandbox')
})

await t('lockstep keeps the craft: one pickaxe on the SERVER, ingredients spent', async () => {
  const r = await trial()
  assert.equal(r.error, null)
  assert.equal(r.server.count('wooden_pickaxe'), 1)
  assert.equal(r.server.count('oak_planks'), 4)
  assert.equal(r.server.count('stick'), 2)
})

let aOnly
await t('arm A alone (no stateId rewrite) keeps it too: stale clicks still happen, and lockstep absorbs them', async () => {
  aOnly = await trial({ opts: { rewriteStateId: false } })
  assert.ok(aOnly.server.staleClicks > 1, 'with B off the clicks should still be stale; this is not testing A')
  assert.equal(aOnly.server.count('wooden_pickaxe'), 1)
})

await t('two crafts in one window: bare comes up short, lockstep makes both', async () => {
  const b = await trial({ wrap: false, inv: INV2, count: 2 })
  assert.ok(b.server.count('wooden_pickaxe') < 2, `bare made ${b.server.count('wooden_pickaxe')}; the repeat case is not reproduced`)
  const r = await trial({ inv: INV2, count: 2, opts: { rewriteStateId: false } })
  assert.equal(r.server.count('wooden_pickaxe'), 2)
  assert.equal(r.resyncs.length, 1, 'one resync per window, not per craft')
})

await t('lockstep on the wire: no two real clicks closer than quietMs (A-only, so nothing else hides a burst)', async () => {
  assert.ok(bare.minGap < 20, `positive control: bare clicks burst (min gap ${bare.minGap} ms)`)
  assert.ok(aOnly.minGap >= CS.CRAFT_SYNC.quietMs, `min gap ${aOnly.minGap} ms < ${CS.CRAFT_SYNC.quietMs}`)
})

await t('2x2 inventory craft: lockstepped, no resync for window 0, sticks land on the server', async () => {
  const r = await trial({ item: 'stick', table: false, inv: { 36: ['oak_planks', 5], 9: ['dirt', 64] } })
  assert.equal(r.error, null)
  assert.equal(r.server.count('stick'), 4)
  assert.equal(r.resyncs.length, 0)
  assert.ok(r.minGap >= CS.CRAFT_SYNC.quietMs)
})

// ------------------------------------------------------------------ the resync
await t('resync: the first click in a container is a stateId -1 no-op outside the window, sent once', async () => {
  const r = await trial()
  assert.equal(r.resyncs.length, 1)
  assert.equal(r.clicks[0], r.resyncs[0], 'the resync must precede every real click')
  assert.deepEqual({ ...r.resyncs[0].params, cursorItem: undefined },
    { windowId: r.real[0].params.windowId, stateId: -1, slot: -999, mouseButton: 0, mode: 0, changedSlots: [], cursorItem: undefined })
  assert.equal(r.rows[0].args.resync_answered, 1, 'the fake answers a stale click with a refresh; the wrapper must see it')
})

await t('resync packet serializes for 1.21.8 exactly as mineflayer encodes an empty cursor', () => {
  const { createSerializer } = require_('minecraft-protocol')
  const ser = createSerializer({ state: 'play', isServer: false, version: VERSION })
  const ours = ser.createPacketBuffer({ name: 'window_click', params: CS.resyncPacket(3) })
  const theirs = ser.createPacketBuffer({ name: 'window_click', params: { ...CS.resyncPacket(3), cursorItem: Item.toNotch(null) } })
  assert.equal(ours.toString('hex'), theirs.toString('hex'))
})

// ------------------------------------------------------------------ arm B
await t('withWindowStateId uses the per-window value, leaves unknown windows and -1 decisions to the caller', () => {
  const ids = new Map([[0, 512], [3, 7]])
  assert.equal(CS.withWindowStateId({ windowId: 3, stateId: 512 }, ids).stateId, 7)
  const same = { windowId: 3, stateId: 7 }
  assert.equal(CS.withWindowStateId(same, ids), same, 'no copy when nothing changes')
  const unknown = { windowId: 9, stateId: 512 }
  assert.equal(CS.withWindowStateId(unknown, ids), unknown)
})

await t('arm B on: every real click carries the table\'s own stateId, so only the resync is stale', async () => {
  const r = await trial()
  assert.equal(r.server.staleClicks, 1, `stale clicks ${r.server.staleClicks}; expected only the deliberate resync`)
  assert.ok(r.rows[0].args.stateid_rewrites > 0)
})

// ------------------------------------------------------------------ restore, abort, throw
await t('wrappers are mineflayer\'s again after a successful craft', async () => {
  const r = await trial()
  assert.ok(restored(r), 'a wrapper outlived the craft')
  assert.ok(r.bot.craftSync && r.bot.craftSync.active() === null)
})

await t('wrappers restored when the craft throws mid-way (missing ingredient after the planks)', async () => {
  const r = await trial({
    before: async ({ server }) => { server.p[37] = null; await server.sync() },   // sticks gone after the recipe was chosen
  })
  assert.ok(r.error && /missing ingredient/.test(r.error.message), `expected mineflayer's own error, got ${r.error?.message}`)
  assert.ok(r.real.length >= 3, 'the throw must come mid-craft, with wrappers installed')
  assert.ok(restored(r))
  assert.equal(r.rows[0].status, 'failed')
})

await t('abort: the signal stops the craft within one click, closes the window, restores everything', async () => {
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 250)
  const r = await trial({ signal: ac.signal })
  assert.ok(r.error && /craft aborted/.test(r.error.message), `got ${r.error?.message}`)
  assert.ok(r.ms < 250 + CS.CRAFT_SYNC.clickCapMs, `took ${r.ms} ms after a 250 ms abort`)
  assert.ok(r.writes.some(w => w.name === 'close_window'), 'mineflayer\'s catch should close the table')
  assert.ok(restored(r))
  assert.equal(r.rows[0].args.aborted, true)
})

// ------------------------------------------------------------------ caps
function stubBot ({ spam = false } = {}) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.writes = []
  bot._client.write = (name, params) => bot._client.writes.push({ name, params })
  bot.inventory = { id: 0 }
  bot.currentWindow = { id: 5 }
  bot.clickWindow = spam ? async () => {} : () => new Promise(() => {})  // silent server: mineflayer's click never settles
  bot.putAway = async () => {}
  bot.putSelectedItemRange = async () => {}
  bot.craft = async () => { await bot.clickWindow(3, 0, 0) }
  let timer = null
  if (spam) timer = setInterval(() => bot._client.emit('set_slot', { windowId: 5, stateId: 1, slot: 3 }), 20)
  return { bot, stop: () => clearInterval(timer) }
}

await t('caps bound every wait at the DEFAULTS: silent server = quiet + resync 1 s + quiet + click 1.5 s + quiet', async () => {
  assert.deepEqual([CS.CRAFT_SYNC.quietMs, CS.CRAFT_SYNC.quietCapMs, CS.CRAFT_SYNC.clickCapMs, CS.CRAFT_SYNC.resyncCapMs], [100, 1000, 1500, 1000])
  const { bot } = stubBot()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  const t0 = Date.now()
  await bot.craft({ result: { id: 1 } }, 1)
  const ms = Date.now() - t0
  assert.ok(ms >= 2700 && ms < 3300, `silent craft took ${ms} ms`)
  assert.equal(rows[0].args.resync_caps, 1)
  assert.equal(rows[0].args.click_caps, 1)
})

await t('caps bound the quiet wait when the window never goes quiet', async () => {
  const { bot, stop } = stubBot({ spam: true })
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), quietCapMs: 250 })
  const t0 = Date.now()
  await bot.craft({ result: { id: 1 } }, 1)
  const ms = Date.now() - t0
  stop()
  assert.equal(rows[0].args.quiet_caps, 3, 'before the resync, after it, after the click')
  assert.ok(ms < 3 * 250 + 200, `took ${ms} ms`)
})

await t('quietReached: needs quietMs since the wait began AND since the last packet', () => {
  assert.equal(CS.quietReached({ now: 1000, start: 950, lastPacketAt: 0, quietMs: 100 }), false)
  assert.equal(CS.quietReached({ now: 1000, start: 900, lastPacketAt: 950, quietMs: 100 }), false)
  assert.equal(CS.quietReached({ now: 1000, start: 900, lastPacketAt: 900, quietMs: 100 }), true)
})

// ------------------------------------------------------------------ install + telemetry + wiring
await t('install refuses a bot whose plugins have not loaded (the createBot-time overwrite)', () => {
  const bot = new EventEmitter(); bot._client = new EventEmitter(); bot._client.write = () => {}
  assert.throws(() => CS.installCraftSync(bot), /plugins not loaded/)
})

await t('one _craft_sync row per craft, and its click count is the wire\'s', async () => {
  const r = await trial()
  assert.equal(r.rows.length, 1)
  const a = r.rows[0].args
  assert.equal(r.rows[0].kind, 'craft_sync')
  assert.equal(a.clicks, r.real.length, `row says ${a.clicks} clicks, the wire carried ${r.real.length}`)
  assert.equal(a.resyncs, 1)
  assert.ok(a.wait_ms >= a.clicks * CS.CRAFT_SYNC.quietMs)
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
await t('WIRED: index.mjs installs craftsync inside the spawn handler, and skills.mjs hands the craft its signal', () => {
  const idx = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
  assert.ok(wiredAtSpawn(idx), 'installCraftSync is not called (exactly once) inside bot.once(\'spawn\')')
  const mutant = idx.replace(/\n[^\n]*installCraftSync\(bot[^\n]*/, '').replace('const runner = new Runner(bot)', 'installCraftSync(bot, {})\n  const runner = new Runner(bot)')
  assert.ok(mutant.includes('installCraftSync(bot, {})') && !wiredAtSpawn(mutant), 'the wiring check cannot see a createBot-time install')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(sk.includes('await bot.craft(recipe, count, table ?? undefined, { signal })'))
})

// ------------------------------------------------------------------ mutants (each must reproduce its defect)
const SRC = new URL('../src/craftsync.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SRC, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}. A mutant that was never written reads as killed.`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

await t('MUTANT KILLED: no quiet wait after a click -> the A-only craft bursts and is lost again', async () => {
  await withMutant('      await cappedClick(st, orig.clickWindow, slot, mouseButton, mode)\n      await waitQuiet(st, win)\n',
    '      await cappedClick(st, orig.clickWindow, slot, mouseButton, mode)\n', async mod => {
      const r = await trial({ mod, opts: { rewriteStateId: false } })
      assert.ok(r.minGap < CS.CRAFT_SYNC.quietMs, 'the mutant still waits between clicks')
      assert.equal(r.server.count('wooden_pickaxe'), 0, 'the mutant kept the craft, so the lockstep test proves nothing')
    })
})

await t('MUTANT KILLED: no resync click -> the resync test sees none', async () => {
  await withMutant("        try { orig.write.call(bot._client, 'window_click', resyncPacket(win)) } finally { resyncing = false }",
    '        try { /* mutant: no resync */ } finally { resyncing = false }', async mod => {
      const r = await trial({ mod })
      assert.equal(r.resyncs.length, 0, 'the mutant still sends a resync')
    })
})

await t('MUTANT KILLED: put-away not routed -> its clicks burst past the lockstep and the row undercounts', async () => {
  await withMutant('    const mine = { clickWindow, putAway, putSelectedItemRange }',
    '    const mine = { clickWindow }', async mod => {
      const r = await trial({ mod, opts: { rewriteStateId: false } })
      assert.ok(r.minGap < CS.CRAFT_SYNC.quietMs, `min gap ${r.minGap}: the put-away still waits`)
      assert.ok(r.rows[0].args.clicks < r.real.length, 'the row still counts every wire click')
    })
})

await t('MUTANT KILLED: wrappers not restored -> they outlive the craft', async () => {
  await withMutant('      try { restore?.() } finally { active = null }', '      active = null', async mod => {
    const r = await trial({ mod })
    assert.ok(!restored(r), 'the mutant restored anyway')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
