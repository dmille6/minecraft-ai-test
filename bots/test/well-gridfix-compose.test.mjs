// THE JUNK WELL ON TOP OF THE GRID FIX (gf-on-911d792 = 911d792 junk well + the craftsync grid fix). Each parent was
// tested alone; well.test.mjs fakes the craft controller (a boolean busy stub, a faked resync answer), so nothing there
// ran the well's window-0 resync through the grid fix's PERMANENT send filter, after a craft that invalidated its
// clicks. CLAUDE.md: test the CHAIN, not the single guard. This file does, with REAL craftsync + REAL mineflayer
// inventory/craft plugins over test/helpers/fake-paper-craft.mjs, and the server as the oracle:
//   aborted 2x2 craft (grid + cursor loaded on the server) -> the grid fix clears it -> the well's admission is not
//   refused 'grid_loaded' -> the well's serverBag resync goes out unmodified, is answered, and the bag is whole.
import assert from 'node:assert/strict'
process.env.LOG_DIR = `/tmp/mcbot-test-logs-wellgf-${process.pid}`
process.env.BOT_NAME = 'TestBot'
const CS = await import('../src/craftsync.mjs')
const { serverBag } = await import('../src/skills.mjs')
const { FakePaper, craftBot, recipeFor, TABLE, id } = await import('./helpers/fake-paper-craft.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
process.on('unhandledRejection', () => {})
const tick = () => new Promise(resolve => setTimeout(resolve, 50))
const BAMBOO = { 36: ['bamboo', 10], 9: ['dirt', 64] }
const bag = (server, name) => server.p.filter(x => x && x.type === id(name)).reduce((n, x) => n + x.count, 0)
const serverGrid = server => server.grid[0].slice(1).filter(Boolean).length
const localGridLoaded = bot => [1, 2, 3, 4].map(i => bot.inventory?.slots?.[i]).filter(Boolean).length + (bot.inventory?.selectedItem ? 1 : 0)
const isResync = p => p?.windowId === 0 && p.slot === -999 && p.stateId === -1 && p.mode === 0
const dropRows = rows => rows.filter(r => r.kind === 'click_dropped' || r.kind === 'click_refused')

/** A 2x2 bamboo -> stick craft aborted after the 2nd ingredient the SERVER applied (grid 2, cursor 8: the stranding). */
async function abortedCraft () {
  const server = new FakePaper({ inventory: BAMBOO })
  const bot = craftBot(server)
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  const recipe = recipeFor(bot, server, 'stick', false)
  const ac = new AbortController()
  const recv = server.receive.bind(server)
  let placed = 0, atStop = null
  server.receive = (name, params) => {
    const r = recv(name, params)
    if (name === 'window_click' && params?.windowId === 0 && params.slot >= 1 && params.slot <= 4 && params.mouseButton === 1 && ++placed === 2) {
      atStop = { grid: serverGrid(server), cursor: server.cursor?.count ?? 0 }
      ac.abort()
    }
    return r
  }
  let error = null
  try { await bot.craft(recipe, 1, undefined, { signal: ac.signal }) } catch (e) { error = e }
  await server.settle()
  return { server, bot, rows, error, atStop }
}

await t('CHAIN: an aborted 2x2 craft, then the well: no grid_loaded refusal, the resync passes the filter, the bag is whole', async () => {
  const { server, bot, rows, error, atStop } = await abortedCraft()
  assert.ok(error?.aborted, `positive control: the craft aborted (got ${error?.message})`)
  assert.deepEqual(atStop, { grid: 2, cursor: 8 }, 'positive control: at the abort the server held the grid and the cursor')
  // the well writes AFTER an invalidation (a craft stop with a click held, or a click-cap expiry: stopIssued). This
  // abort's last click had already settled, so make the epoch bump explicit rather than hope for it.
  const e0 = bot.craftSync.tracker.epoch
  CS.invalidateClicks(bot, 'craft stopped: test')
  assert.equal(bot.craftSync.tracker.epoch, e0 + 1, 'premise: every click issued before now is stale')
  assert.equal(bot.craftSync.busy(), false, 'the craft released the inventory')
  // the grid fix's work, read off the server
  assert.equal(serverGrid(server), 0, 'the grid fix emptied the server grid')
  assert.equal(server.cursor, null, 'the grid fix emptied the server cursor')
  // the well's P2-6 admission (skills.mjs: grid slots 1-4 or the cursor loaded -> refused grid_loaded) reads clean
  assert.equal(localGridLoaded(bot), 0, 'the well would refuse grid_loaded on a grid the server no longer holds')
  // the well's own resync, through whatever bot._client.write now is
  const w0 = server.writes.length
  const dropsBefore = bot.craftSync.dropped()
  const sb = await serverBag(bot, tick)
  assert.equal(sb.source, 'resync', 'the server answered the well\'s resync')
  const sent = server.writes.slice(w0)
  assert.deepEqual(sent.map(w => w.name), ['close_window', 'window_click'], 'the well wrote exactly its close + resync')
  assert.equal(sent[0].params.windowId, 0)
  assert.ok(isResync(sent[1].params), `the resync reached the server unmodified (no stateId rewrite): ${JSON.stringify(sent[1].params)}`)
  assert.equal(bot.craftSync.dropped(), dropsBefore, 'the permanent filter dropped nothing of the well\'s')
  assert.equal(dropRows(rows).length, 0, 'no click_dropped / click_refused row')
  assert.equal(sb.counts.bamboo, 10, `the well's bag holds all ten bamboo (got ${JSON.stringify(sb.counts)})`)
  assert.equal(bag(server, 'bamboo'), 10, 'the server bag holds all ten bamboo')
  assert.equal(server.dropped.length, 0, 'nothing was dropped')
})

await t('POSITIVE CONTROL: the same resync packet IS dropped by the filter when written inside a stale dispatch', async () => {
  // the pass above is because the well writes outside any dispatch, not because the filter cannot see the packet
  const { server, bot } = await abortedCraft()
  const tr = bot.craftSync.tracker
  const ticket = tr.bind({ windowId: 0 })
  tr.invalidate('test: a stop')
  const w0 = server.writes.length
  const d0 = bot.craftSync.dropped()
  tr.dispatch(ticket, () => bot._client.write('window_click', CS.resyncPacket(0)))
  assert.equal(server.writes.length, w0, 'a stale-ticket write reached the server')
  assert.equal(bot.craftSync.dropped(), d0 + 1, 'the filter counted the drop')
})

await t('a craft holding the inventory: the well reads its LOCAL bag and writes nothing; after the craft ends it resyncs', async () => {
  const server = new FakePaper({ inventory: { 36: ['oak_planks', 3], 37: ['stick', 2], 9: ['dirt', 64] }, openDelayMs: Infinity })
  const bot = craftBot(server)
  await server.sync()
  CS.installCraftSync(bot, { log: () => {} })
  const recipe = recipeFor(bot, server, 'wooden_pickaxe', true)
  const ac = new AbortController()
  const p = bot.craft(recipe, 1, TABLE, { signal: ac.signal }).catch(e => e)
  for (let i = 0; i < 40 && !bot.craftSync.busy(); i++) await tick()
  await tick(); await tick()
  assert.equal(bot.craftSync.busy(), true, 'positive control: the craft holds the inventory (its table never opens)')
  const w0 = server.writes.length
  const sb = await serverBag(bot, tick)
  assert.equal(sb.source, 'local', 'the well must not resync while a craft holds the inventory')
  assert.equal(server.writes.slice(w0).filter(w => w.name === 'close_window' || isResync(w.params)).length, 0, 'the well wrote into a craft')
  ac.abort()
  const e = await p
  assert.ok(e?.aborted, `the craft ended on the abort (got ${e?.message})`)
  await server.settle()
  assert.equal(bot.craftSync.busy(), false)
  const sb2 = await serverBag(bot, tick)
  assert.equal(sb2.source, 'resync', 'after the craft the well\'s resync is answered')
  assert.equal(sb2.counts.oak_planks, 3)
  assert.equal(sb2.counts.stick, 2)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
