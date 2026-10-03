// Shared by craftsync.test.mjs and craftsync-mutants.test.mjs: one craft against the fake Paper, with everything
// a test needs to read back -- the server's truth, the wire, the _craft_sync row, and whether the wrappers left.
import { EventEmitter } from 'node:events'
import { FakePaper, craftBot, recipeFor, TABLE } from './fake-paper-craft.mjs'

export const INV = { 36: ['oak_planks', 7], 37: ['stick', 4], 9: ['dirt', 64] }   // spare ingredients: the losing case
export const INV2 = { 36: ['oak_planks', 9], 37: ['stick', 5], 9: ['dirt', 64] }  // two pickaxes, with spares
export const INV3 = { 36: ['oak_planks', 12], 37: ['stick', 8], 9: ['dirt', 64] } // three

// The fake's refresh lands 3 client clicks behind, or 60 ms after the click, whichever is first. Both are model
// parameters, not Paper measurements: 3 clicks is where a 10 ms-paced client (the no-quiet-wait mutant) loses the
// craft as a microsecond burst does; 60 ms is under quietMs, so a lockstep client is waiting when it lands.
export async function trial (mod, { wrap = true, opts = {}, item = 'wooden_pickaxe', table = true, count = 1, inv = INV,
                                    lag = 3, fallbackMs = 60, openDelayMs = 0, cursorOnOpen = null, options = {},
                                    before = null, during = null, equip = null } = {}) {
  const server = new FakePaper({ lagClicks: lag, fallbackMs, openDelayMs, cursorOnOpen, inventory: inv })
  const bot = craftBot(server)
  if (equip) bot.equip = equip(bot)
  await server.sync()
  const orig = { clickWindow: bot.clickWindow, putAway: bot.putAway, putSelectedItemRange: bot.putSelectedItemRange,
                 write: bot._client.write, equip: bot.equip }
  const rows = []
  if (wrap) mod.installCraftSync(bot, { log: r => rows.push(r), ...opts })
  const recipe = recipeFor(bot, server, item, table)
  if (before) await before({ server, bot })
  const startWrite = server.writes.length
  const t0 = Date.now()
  let error = null
  const craftP = bot.craft(recipe, count, table ? TABLE : undefined, options)
  const side = during ? during({ server, bot, orig, t0 }) : null
  try { await craftP } catch (e) { error = e }
  const ms = Date.now() - t0
  const sideResult = side ? await side : null
  const writes = server.writes.slice(startWrite)
  await server.settle(); server.stop()
  const clicks = writes.filter(w => w.name === 'window_click')
  const resyncs = clicks.filter(w => w.params.stateId === -1 && w.params.slot === -999)
  const real = clicks.filter(w => !resyncs.includes(w))
  const gaps = real.slice(1).map((w, i) => w.t - real[i].t)
  return { server, bot, rows, error, ms, orig, writes, clicks, resyncs, real, sideResult, recipe,
           tableResyncs: resyncs.filter(w => w.params.windowId !== 0),
           minGap: gaps.length ? Math.min(...gaps) : Infinity }
}

export const restored = (r) => r.bot.clickWindow === r.orig.clickWindow && r.bot.putAway === r.orig.putAway &&
  r.bot.putSelectedItemRange === r.orig.putSelectedItemRange && r.bot._client.write === r.orig.write &&
  r.bot.equip === r.orig.equip

/** A bare bot for the cap tests: window 5 is open, nothing is mineflayer. `click` decides what a click does. */
export function stubBot ({ click = () => new Promise(() => {}), spam = null } = {}) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.writes = []
  bot._client.write = (name, params) => bot._client.writes.push({ name, params, t: Date.now() })
  bot.made = 0
  bot.inventory = { id: 0, count: () => bot.made }
  bot.currentWindow = { id: 5 }
  bot.clickWindow = click
  bot.putAway = async () => {}
  bot.putSelectedItemRange = async () => {}
  bot.craft = async () => {
    // the window opening: its window_items says the cursor is empty (the proof the resync needs)
    bot._client.emit('window_items', { windowId: 5, stateId: 1, items: [], carriedItem: { itemCount: 0 } })
    await bot.clickWindow(3, 0, 0)
    bot.made++
  }
  let timer = null
  if (spam) timer = setInterval(() => bot._client.emit(...spam()), 20)
  return { bot, stop: () => clearInterval(timer) }
}
export const STUB_RECIPE = { result: { id: 1, count: 1 } }
