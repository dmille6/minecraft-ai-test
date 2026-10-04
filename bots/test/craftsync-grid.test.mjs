// craftsync: an unclean exit never leaves the 2x2 grid or the cursor loaded (sandbox 10-04, bamboo fold aborted by
// the stuck watchdog: 2 bamboo in the grid and 8 on the cursor -- out of the bag while online, on the ground at
// logout; on the live craftsync-01 canary 2 of 82 craft_sync rows in 4.5 h were aborted 2x2 oak_planks crafts).
//
// REAL craftsync + REAL mineflayer craft.js/inventory.js against test/helpers/fake-paper-craft.mjs. The abort lands at
// a chosen ingredient click (after the server applied it), so "after the ingredients, before the result" is exact,
// not a timer. The oracle is the SERVER: its grid, its cursor, its bag. The first test is the positive control: a
// server that ignores the close strands the ingredients exactly as the sandbox saw, and the row must SAY so.
import assert from 'node:assert/strict'
import * as CS from '../src/craftsync.mjs'
import { Item, FakePaper, craftBot, recipeFor, TABLE, id } from './helpers/fake-paper-craft.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
let unhandled = 0
process.on('unhandledRejection', () => { unhandled++ })

const BAMBOO = { 36: ['bamboo', 10], 9: ['dirt', 64] }
const LOGS = { 36: ['oak_log', 5], 9: ['dirt', 64] }
const bag = (server, name) => server.p.filter(x => x && x.type === id(name)).reduce((n, x) => n + x.count, 0)
const gridOf = (server, table) => (table ? server.grid.table : server.grid[0]).slice(1).filter(Boolean).length

/**
 * One craft; `stopAt(n)` fires after the n-th ingredient placement the SERVER applied (a right-click into the grid)
 * and returns 'abort' | 'disconnect' | null. `before({ server, bot })` may change the fake or the bot first.
 */
async function gridTrial ({ item = 'stick', inv = BAMBOO, table = false, stopAt = () => null, opts = {}, before = null } = {}) {
  const server = new FakePaper({ inventory: inv })
  const bot = craftBot(server)
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), ...opts })
  const recipe = recipeFor(bot, server, item, table)
  if (before) await before({ server, bot })
  const ac = new AbortController()
  const recv = server.receive.bind(server)
  let placed = 0, stoppedAtWrite = null, atStop = null
  server.receive = (name, params) => {
    const r = recv(name, params)
    const grid = table ? params?.windowId !== 0 && params?.slot >= 1 && params?.slot <= 9
                       : params?.windowId === 0 && params?.slot >= 1 && params?.slot <= 4
    if (name === 'window_click' && grid && params.mouseButton === 1) {
      const what = stopAt(++placed)
      if (what) {
        stoppedAtWrite = server.writes.length
        atStop = { grid: gridOf(server, table), cursor: server.cursor?.count ?? 0, bag: server.p.filter(Boolean).reduce((n, x) => n + x.count, 0) }
      }
      if (what === 'abort') ac.abort()
      if (what === 'disconnect') bot.emit('end')
    }
    return r
  }
  const startWrite = server.writes.length
  let error = null
  try { await bot.craft(recipe, 1, table ? TABLE : undefined, { signal: ac.signal }) } catch (e) { error = e }
  await server.settle()
  const next = async () => {
    let e = null
    try { await bot.craft(recipe, 1, table ? TABLE : undefined, {}) } catch (x) { e = x }
    await server.settle()
    return e
  }
  return { server, bot, rows, error, recipe, next, atStop, writes: server.writes.slice(startWrite),
           after: stoppedAtWrite === null ? [] : server.writes.slice(stoppedAtWrite) }
}
const closes0 = (writes) => writes.filter(w => w.name === 'close_window' && w.params.windowId === 0).length

// ------------------------------------------------------------------ positive control
await t('POSITIVE CONTROL: at the abort the server really holds the grid and the cursor (what the old build stranded)', async () => {
  const r = await gridTrial({ stopAt: n => n === 2 ? 'abort' : null })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.deepEqual({ grid: r.atStop.grid, cursor: r.atStop.cursor }, { grid: 2, cursor: 8 },
    'the abort did not land between the ingredients and the result; nothing below is proven')
  assert.equal(r.atStop.bag, 64, 'only the dirt was in the bag at the abort: all ten bamboo were out of it')
})

await t('a server that IGNORES the close leaves the grid loaded -- the row reads it as not clear, never assumes yes', async () => {
  // Paper always honours a close; this is the instrument's check, not a case the fleet meets. (The clear's resync
  // relies on the close having emptied the cursor -- the same assumption the baseline close has always made.)
  let ignore = false
  const r = await gridTrial({
    stopAt: n => { if (n === 2) { ignore = true; return 'abort' } return null },
    before: ({ server }) => { const close = server.onClose.bind(server); server.onClose = (p) => (ignore ? undefined : close(p)) },
  })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(gridOf(r.server, false), 2)
  assert.equal(r.rows[0].args.grid_clear, 'no')
  assert.match(r.rows[0].args.grid_residue ?? '', /slot\d:/)
})

// ------------------------------------------------------------------ the fix, case by case (server oracle)
for (const [label, opt] of [
  ['2x2 bamboo, aborted with both ingredients placed', { stopAt: n => n === 2 ? 'abort' : null }],
  ['2x2 bamboo, aborted with the first ingredient placed (the stack on the cursor)', { stopAt: n => n === 1 ? 'abort' : null }],
  ['2x2 oak_log -> planks, aborted after the ingredient', { item: 'oak_planks', inv: LOGS, stopAt: n => n === 1 ? 'abort' : null }],
]) {
  await t(`${label}: grid + cursor empty on the server, bag whole, local cursor clear, grid_clear=yes, next craft works`, async () => {
    const r = await gridTrial(opt)
    const src = opt.item === 'oak_planks' ? 'oak_log' : 'bamboo'
    const n0 = opt.item === 'oak_planks' ? 5 : 10
    assert.ok(r.error?.aborted, `got ${r.error?.message}`)
    assert.equal(gridOf(r.server, false), 0, 'grid still loaded on the server')
    assert.equal(r.server.cursor, null, 'server cursor still loaded')
    assert.equal(bag(r.server, src), n0, `the bag is not whole: ${bag(r.server, src)} of ${n0}`)
    assert.equal(r.server.dropped.length, 0, 'nothing may be thrown')
    assert.equal(r.bot.inventory.selectedItem, null, 'mineflayer still believes it holds a stack')
    assert.equal(r.rows[0].args.grid_clear, 'yes')
    assert.equal(r.rows[0].args.outcome, 'aborted')
    assert.equal(closes0(r.after), 1, 'exactly one close_window 0 after the abort')
    assert.equal(r.bot.craftSync.busy(), false)
    const e = await r.next()
    assert.equal(e, null, `the next craft failed: ${e?.message}`)
    if (src === 'bamboo') { assert.equal(bag(r.server, 'stick'), 1); assert.equal(bag(r.server, 'bamboo'), 8) }
    else { assert.equal(bag(r.server, 'oak_planks'), 4); assert.equal(bag(r.server, 'oak_log'), 4) }
  })
}

await t('the grid clear runs BEFORE ownership is released: no other click can interleave with it', async () => {
  const owned = []   // for every close_window 0: did craftsync still own the inventory?
  const r = await gridTrial({
    stopAt: n => n === 2 ? 'abort' : null,
    before: ({ server, bot }) => {
      const recv = server.receive.bind(server)
      server.receive = (name, params) => {
        if (name === 'close_window' && params.windowId === 0) owned.push(bot.craftSync.active() !== null)
        return recv(name, params)
      }
    },
  })
  assert.ok(r.error?.aborted)
  assert.equal(owned.length, 2, `expected the baseline close and the clear's close, saw ${owned.length}`)
  assert.equal(owned[1], true, 'the clear ran after the wrappers were released')
})

await t('a disconnect: nothing is sent after it, grid_clear=skipped_disconnected', async () => {
  const r = await gridTrial({ stopAt: n => n === 2 ? 'disconnect' : null })
  assert.ok(r.error?.aborted && /disconnected/.test(r.error.message), `got ${r.error?.message}`)
  assert.equal(closes0(r.after), 0, 'a close was written to a dead connection')
  assert.equal(r.after.filter(w => w.name === 'window_click' && w.params.stateId === -1).length, 0)
  assert.equal(r.rows[0].args.grid_clear, 'skipped_disconnected')
})

await t('an UNANSWERED clear resync is unverified, never yes (the baseline packet is not the answer)', async () => {
  let drop = false
  const r = await gridTrial({
    stopAt: n => { if (n === 2) { drop = true; return 'abort' } return null },
    opts: { gridClearCapMs: 300 },
    before: ({ server }) => {
      const recv = server.receive.bind(server)
      server.receive = (name, params) => {
        if (drop && name === 'window_click' && params.stateId === -1 && params.slot === -999) { server.writes.push({ t: Date.now(), name, params }); return }
        return recv(name, params)
      }
    },
  })
  assert.ok(r.error?.aborted)
  assert.equal(r.rows[0].args.grid_clear, 'unverified_unanswered')
  assert.equal(gridOf(r.server, false), 0, 'the close itself still returned the grid')
})

// ------------------------------------------------------------------ unchanged paths
await t('table craft aborted: unchanged -- mineflayer closes the table, no extra close_window 0, grid_clear null', async () => {
  const r = await gridTrial({ table: true, stopAt: n => n === 2 ? 'abort' : null })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(gridOf(r.server, true), 0)
  assert.equal(r.server.cursor, null)
  assert.equal(bag(r.server, 'bamboo'), 10)
  assert.equal(closes0(r.writes), 1, 'only the baseline closes window 0')
  assert.ok(r.writes.some(w => w.name === 'close_window' && w.params.windowId !== 0), 'mineflayer closes the table')
  assert.equal(r.rows[0].args.grid_clear, null)
})

await t('no signal, clean 2x2 craft: unchanged -- two closes (baseline, verify), two resyncs, grid_clear null', async () => {
  const r = await gridTrial({})
  assert.equal(r.error, null, r.error?.message)
  assert.equal(bag(r.server, 'stick'), 1)
  assert.equal(closes0(r.writes), 2)
  assert.equal(r.writes.filter(w => w.name === 'window_click' && w.params.stateId === -1).length, 2)
  assert.equal(r.rows[0].args.grid_clear, null)
  assert.equal(r.rows[0].args.confirmed, 'yes')
})

await t('the BASELINE close clears a stale local cursor too: a craft after an old-build stranding works', async () => {
  // mineflayer believes it holds 8 bamboo; the server cursor is empty (what the next craft met after the old bug).
  const r = await gridTrial({ before: ({ bot }) => { bot.inventory.selectedItem = new Item(id('bamboo'), 8) } })
  assert.equal(r.error, null, `the craft after a stale cursor failed: ${r.error?.message}`)
  assert.equal(bag(r.server, 'stick'), 1)
})

// ------------------------------------------------------------------ the verdict, pure
await t('gridClearVerdict: empty grid + cursor is clear; any slot 1-4 or the cursor is residue; no packet is not clear', () => {
  const empty = { itemCount: 0 }
  const items = [empty, empty, empty, empty, empty, { itemId: 7, itemCount: 3 }]   // slot 5 is armour: not the grid
  assert.deepEqual(CS.gridClearVerdict({ items, carriedItem: empty }), { clear: true, residue: [] })
  assert.deepEqual(CS.gridClearVerdict({ items: [empty, empty, { itemId: 1, itemCount: 1 }], carriedItem: { itemId: 1, itemCount: 8 } }).residue,
    ['slot2:1x1', 'cursor:1x8'])
  assert.equal(CS.gridClearVerdict({ items: [empty, empty, empty, empty, { itemId: 2, itemCount: 1 }], carriedItem: empty }).clear, false)
  assert.equal(CS.gridClearVerdict(null).clear, false)
})

await new Promise(resolve => setTimeout(resolve, 50))
assert.equal(unhandled, 0)
console.log(`\n${pass} passed, ${fail} failed${unhandled ? `, ${unhandled} unhandled rejections` : ''}`)
process.exit(fail || unhandled ? 1 : 0)
