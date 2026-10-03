// SANDBOX-ONLY craft sync experiment. node craftsync.cjs <arm: none|A|B|AB> <trials-per-cell> [cells]
// Connects to the sandbox Paper (10.0.0.30:25599) only; RCON only via /tmp/sbx-rcon.py sandbox.
'use strict'
// mineflayer from a bot worktree: CRAFT_NODE_MODULES=<worktree>/bots/node_modules/ (default: this checkout's bots/node_modules)
const NM = process.env.CRAFT_NODE_MODULES || require('path').resolve(__dirname, '../../bots/node_modules') + '/'
const mineflayer = require(NM + 'mineflayer')
const { Vec3 } = require(NM + 'vec3')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ARM = process.argv[2] || 'none'
const N = Number(process.argv[3] || 5)
const CELLS = (process.argv[4] || 'wood-fresh,wood-exist,stone-fresh,stone-exist,planks-inv,sticks-inv,sticks-exist').split(',')
const NAME = 'sandbox-Craft'
const HOST = '10.0.0.30'; const PORT = 25599
if (HOST !== '10.0.0.30' || PORT !== 25599) throw new Error('sandbox only')
const LOGD = path.resolve(__dirname, '../log/craft'); fs.mkdirSync(LOGD, { recursive: true })
const OUT = path.join(LOGD, `trace-${ARM}.jsonl`)
const RES = path.join(LOGD, `results-${ARM}.jsonl`)
const tr = fs.createWriteStream(OUT, { flags: 'a' })
const t0 = Date.now()
const now = () => Date.now() - t0
let trialId = null
const log = (o) => tr.writable && tr.write(JSON.stringify({ t: now(), trial: trialId, ...o }) + '\n')

function rcon (...cmds) {
  const out = execFileSync('ssh', ['mike@10.0.0.30', 'python3 /tmp/sbx-rcon.py sandbox -'], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  // parse "> cmd\nreply" blocks
  const res = []; let cur = null
  for (const line of out.split('\n')) {
    if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line
  }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- recipes / cells
const SPEC = {
  'wood-fresh': { product: 'wooden_pickaxe', table: 'fresh', give: [['oak_planks', 3], ['stick', 2]] },
  'wood-exist': { product: 'wooden_pickaxe', table: 'exist', give: [['oak_planks', 3], ['stick', 2]] },
  'stone-fresh': { product: 'stone_pickaxe', table: 'fresh', give: [['cobblestone', 3], ['stick', 2]] },
  'stone-exist': { product: 'stone_pickaxe', table: 'exist', give: [['cobblestone', 3], ['stick', 2]] },
  'planks-inv': { product: 'oak_planks', table: 'none', give: [['oak_log', 1]], yield: 4 },
  'sticks-inv': { product: 'stick', table: 'none', give: [['oak_planks', 2]], yield: 4 },
  'sticks-exist': { product: 'stick', table: 'exist', give: [['oak_planks', 2]], yield: 4 },
  'wood2-exist': { product: 'wooden_pickaxe', table: 'exist', count: 2, give: [['oak_planks', 6], ['stick', 4]] },
  'wood2-fresh': { product: 'wooden_pickaxe', table: 'fresh', count: 2, give: [['oak_planks', 6], ['stick', 4]] },
  'stone3-exist': { product: 'stone_pickaxe', table: 'exist', count: 3, give: [['cobblestone', 9], ['stick', 6]] },
  'sticks3-exist': { product: 'stick', table: 'exist', count: 3, give: [['oak_planks', 6]], yield: 4 },
  'sticks3-inv': { product: 'stick', table: 'none', count: 3, give: [['oak_planks', 6]], yield: 4 },
  'stone-sur-fresh': { product: 'stone_pickaxe', table: 'fresh', give: [['cobblestone', 8], ['stick', 5]] },
  'stone-sur-exist': { product: 'stone_pickaxe', table: 'exist', give: [['cobblestone', 8], ['stick', 5]] },
  'wood-sur-fresh': { product: 'wooden_pickaxe', table: 'fresh', give: [['oak_planks', 7], ['stick', 4]] },
  'wood-sur-exist': { product: 'wooden_pickaxe', table: 'exist', give: [['oak_planks', 7], ['stick', 4]] },
  'sticks-sur-inv': { product: 'stick', table: 'none', give: [['oak_planks', 5]], yield: 4 },
  'planks-sur-inv': { product: 'oak_planks', table: 'none', give: [['oak_log', 3]], yield: 4 },
  'chain-wood': { product: 'wooden_pickaxe', table: 'fresh', makeTable: true, pre: ['crafting_table'], give: [['oak_planks', 7], ['stick', 2]] },
  'chain-stone': { product: 'stone_pickaxe', table: 'fresh', makeTable: true, pre: ['crafting_table'], give: [['oak_planks', 4], ['cobblestone', 3], ['stick', 2]] },
  'prestick-stone': { product: 'stone_pickaxe', table: 'exist', pre: ['stick'], give: [['oak_planks', 2], ['cobblestone', 3]] },
}
const TX = 702, TY = 120, TZ = 700 // table cell; bot stands at 700.5 120 700.5
const FILLER = ['dirt', 'andesite', 'diorite', 'granite']

// ---------- bot
;(function waitEmpty () { for (let i = 0; i < 180; i++) { const r = rcon('list')[0].reply; if (/There are 0 of/.test(r)) return; console.log('waiting', r.trim()); execFileSync('sleep', ['20']) } throw new Error('sandbox busy') })()
const bot = mineflayer.createBot({ host: HOST, port: PORT, username: NAME, version: '1.21.8', auth: 'offline', hideErrors: false })
bot.on('error', e => { log({ ev: 'bot_error', msg: String(e && e.message) }); console.error('bot error', e && e.message) })
bot.on('kicked', r => { log({ ev: 'kicked', r: String(r) }); console.error('kicked', r) })
bot._client.on('error', e => log({ ev: 'client_error', msg: String(e && e.message) }))

const itemStr = it => (it && (it.itemCount || it.present) && it.itemId != null) ? `${bot.registry.items[it.itemId]?.name || it.itemId}x${it.itemCount}` : '-'
const lastState = new Map() // per-window last inbound stateId
let lastGlobal = -1
const quiet = new Map() // windowId -> last inbound update time
for (const n of ['open_window', 'window_items', 'set_slot', 'set_cursor_item', 'close_window', 'set_player_inventory', 'craft_recipe_response', 'block_change', 'acknowledge_player_digging']) {
  bot._client.on(n, p => {
    const o = { dir: 'in', pkt: n }
    if (p.windowId !== undefined) o.win = p.windowId
    if (p.stateId !== undefined) { o.sid = p.stateId; lastState.set(p.windowId, p.stateId); lastGlobal = p.stateId }
    if (n === 'set_slot') { o.slot = p.slot; o.item = itemStr(p.item) }
    if (n === 'window_items') { o.items = p.items.map((x, i) => [i, itemStr(x)]).filter(x => x[1] !== '-'); o.carried = itemStr(p.carriedItem) }
    if (n === 'set_cursor_item') o.item = itemStr(p.contents)
    if (n === 'open_window') { o.type = p.inventoryType; o.title = JSON.stringify(p.windowTitle).slice(0, 60) }
    if (n === 'block_change') { if (!(p.location.x === TX && p.location.y === TY && p.location.z === TZ)) return; o.type = p.type }
    if (n === 'acknowledge_player_digging') o.seq = p.sequenceId
    if (p.windowId !== undefined) quiet.set(p.windowId, Date.now())
    log(o)
  })
}
const rawWrite = bot._client.write.bind(bot._client)
bot._client.write = function (name, params) {
  if (name === 'window_click' || name === 'close_window' || name === 'block_place' || name === 'use_item_on' || name === 'held_item_slot' || name === 'set_creative_slot') {
    const o = { dir: 'out', pkt: name }
    if (name === 'window_click') {
      // ARM B: per-window stateId
      if ((ARM === 'B' || ARM === 'AB') && !params._forced) {
        const per = lastState.get(params.windowId)
        if (per !== undefined && per !== params.stateId) { o.sidRewritten = `${params.stateId}->${per}`; params = { ...params, stateId: per } }
      }
      Object.assign(o, { win: params.windowId, sid: params.stateId, lastSidWin: lastState.get(params.windowId), lastSidGlobal: lastGlobal, slot: params.slot, btn: params.mouseButton, mode: params.mode,
        changed: (params.changedSlots || []).map(c => [c.location, itemStr(c.item)]), cursor: itemStr(params.cursorItem) })
      delete params._forced
    } else if (name === 'close_window') o.win = params.windowId
    else if (name === 'use_item_on' || name === 'block_place') { o.loc = params.location; o.seq = params.sequence }
    else if (name === 'held_item_slot') o.slot = params.slotId
    log(o)
  }
  try { return rawWrite(name, params) } catch (e) { log({ ev: 'write_throw', name, msg: String(e.message) }); throw e }
}

// ---------- ARM A: lockstep clickWindow during craft + one forced resync after a window opens
let inCraft = false; let resynced = new Set()
async function waitQuiet (winId, quietMs = 100, capMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < capMs) {
    const last = Math.max(quiet.get(winId) || 0, quiet.get(-1) || 0)
    if (Date.now() - last >= quietMs && Date.now() - start >= quietMs) return Date.now() - start
    await sleep(10)
  }
  log({ ev: 'quiet_cap', win: winId })
  return capMs
}
function installShims () {
if (ARM === 'A' || ARM === 'AB') {
  const origClick = bot.clickWindow
  bot.clickWindow = async function (slot, button, mode) {
    if (!inCraft) return origClick(slot, button, mode)
    const w = bot.currentWindow || bot.inventory
    if (w.id !== 0 && !resynced.has(w.id)) {
      resynced.add(w.id)
      const waitedOpen = await waitQuiet(w.id)
      // forced resync: no-op click outside the window (empty cursor) with a stale stateId -> server broadcastFullState
      const before = quiet.get(w.id) || 0
      bot._client.write('window_click', { windowId: w.id, stateId: -1, slot: -999, mouseButton: 0, mode: 0, changedSlots: [], cursorItem: { itemCount: 0, components: [], removeComponents: [] }, _forced: true })
      const s = Date.now()
      while (Date.now() - s < 1000 && (quiet.get(w.id) || 0) <= before) await sleep(10)
      const got = (quiet.get(w.id) || 0) > before
      const waited = await waitQuiet(w.id)
      log({ ev: 'resync', win: w.id, waitedOpen, got, waited })
    }
    let done = false
    const p = origClick(slot, button, mode).then(() => { done = true })
    const s2 = Date.now()
    while (!done && Date.now() - s2 < 1500) await sleep(10)
    if (!done) log({ ev: 'click_wait_cap', slot })
    await waitQuiet(w.id)
  }
  // putAway / putSelectedItemRange call the closure clickWindow in inventory.js; re-route them through the lockstep wrapper
  const origPSIR = bot.putSelectedItemRange; const origPutAway = bot.putAway
  bot.putSelectedItemRange = async function (start, end, window, slot) {
    if (!inCraft) return origPSIR(start, end, window, slot)
    while (window.selectedItem) {
      const item = window.findItemRange(start, end, window.selectedItem.type, window.selectedItem.metadata, true, window.selectedItem.nbt)
      if (item && item.stackSize !== item.count) await bot.clickWindow(item.slot, 0, 0)
      else {
        const empty = window.firstEmptySlotRange(start, end)
        if (empty === null) {
          if (slot !== null) await bot.clickWindow(slot, 0, 0)
          if (window.selectedItem) await bot.clickWindow(-999, 0, 0)
        } else await bot.clickWindow(empty, 0, 0)
      }
    }
  }
  bot.putAway = async function (slot) {
    if (!inCraft) return origPutAway(slot)
    const window = bot.currentWindow || bot.inventory
    await bot.clickWindow(slot, 0, 0)
    await bot.putSelectedItemRange(window.inventoryStart, window.inventoryEnd, window, null)
  }
}
const origCraft = bot.craft
bot.craft = async function (...a) { inCraft = true; resynced = new Set(); try { return await origCraft.apply(this, a) } finally { inCraft = false } }
  if (typeof origCraft !== 'function') throw new Error('shim install before plugins')
  log({ ev: 'shims_installed', arm: ARM })
}

// ---------- oracle
function countsVia (names) {
  const cmds = names.map(n => `clear ${NAME} minecraft:${n} 0`)
  cmds.push(`execute positioned 700 120 700 if entity @e[type=item,distance=..10]`)
  const r = rcon(...cmds); const out = {}
  names.forEach((n, i) => { const m = r[i]?.reply.match(/Found (\d+)/); out[n] = m ? +m[1] : (/No items were found/.test(r[i]?.reply) ? 0 : `?${r[i]?.reply}`) })
  const m = r[names.length]?.reply.match(/count: (\d+)/); out._items = m ? +m[1] : 0
  return out
}
function localCount (n) { return bot.inventory.items().filter(i => i.name === n).reduce((s, i) => s + i.count, 0) }

async function setupTrial (spec, k) {
  const cmds = [`clear ${NAME}`, `kill @e[type=item,x=700,y=120,z=700,distance=..20]`, `tp ${NAME} 700.5 120 700.5 -90 30`]
  if (spec.table === 'fresh') cmds.push(`setblock ${TX} ${TY} ${TZ} minecraft:air`)
  // filler: 12 stacks in main inventory (slots 9..20), ingredients in hotbar 0.. ; vary hotbar start to vary layout
  for (let s = 9; s < 21; s++) cmds.push(`item replace entity ${NAME} container.${s} with minecraft:${FILLER[s % 4]} 64`)
  let slot = k % 3
  for (const [it, c] of spec.give) cmds.push(`item replace entity ${NAME} container.${slot++} with minecraft:${it} ${c}`)
  if (spec.table === 'fresh' && !spec.makeTable) cmds.push(`item replace entity ${NAME} container.${slot++} with minecraft:crafting_table 1`)
  if (spec.table === 'exist') cmds.push(`setblock ${TX} ${TY} ${TZ} minecraft:crafting_table keep`)
  rcon(...cmds)
  // wait until mineflayer's local inventory reflects the gift
  const s = Date.now()
  while (Date.now() - s < 4000) {
    if (spec.give.every(([it, c]) => localCount(it) === c) && (spec.table !== 'fresh' || spec.makeTable || localCount('crafting_table') === 1)) break
    await sleep(50)
  }
  await sleep(400)
}

async function runTrial (cell, k) {
  const spec = SPEC[cell]
  trialId = `${ARM}:${cell}:${k}`
  log({ ev: 'trial_start', cell })
  await setupTrial(spec, k)
  const names = [spec.product, ...spec.give.map(g => g[0]), ...(spec.pre || [])].filter((v, i, a) => a.indexOf(v) === i)
  const before = countsVia(names)
  let table = null; let err = null; let placeMs = null
  try {
    for (const p of spec.pre || []) {
      const r0 = bot.recipesFor(bot.registry.itemsByName[p].id, null, 1, null)[0]
      if (!r0) throw new Error('no pre recipe ' + p)
      log({ ev: 'pre_craft', item: p })
      await bot.craft(r0, 1)
      log({ ev: 'pre_return' })
    }
    if (spec.table === 'fresh') {
      const ct = bot.inventory.items().find(i => i.name === 'crafting_table')
      if (!ct) throw new Error('no crafting_table in local inventory')
      await bot.equip(ct, 'hand')
      const ref = bot.blockAt(new Vec3(TX, TY - 1, TZ))
      const tp = Date.now()
      try { await bot.placeBlock(ref, new Vec3(0, 1, 0)) } catch (e) { log({ ev: 'place_err', msg: e.message }) }
      placeMs = Date.now() - tp
      table = bot.blockAt(new Vec3(TX, TY, TZ))
      if (table?.name !== 'crafting_table') throw new Error('table not placed: ' + table?.name)
    } else if (spec.table === 'exist') {
      const s = Date.now()
      while (Date.now() - s < 3000 && bot.blockAt(new Vec3(TX, TY, TZ))?.name !== 'crafting_table') await sleep(50)
      table = bot.blockAt(new Vec3(TX, TY, TZ))
    }
    if (table) await bot.lookAt(table.position.offset(0.5, 0.5, 0.5), true)
    const id = bot.registry.itemsByName[spec.product].id
    const recipe = bot.recipesFor(id, null, 1, table || null)[0]
    const cnt = spec.count || 1
    if (!recipe) throw new Error('no recipe')
    log({ ev: 'craft_call', product: spec.product, table: !!table })
    const tc = Date.now()
    await Promise.race([bot.craft(recipe, cnt, table || undefined), sleep(15000).then(() => { throw new Error('CRAFT_HANG_15s') })])
    log({ ev: 'craft_return', ms: Date.now() - tc })
  } catch (e) { err = e.message; log({ ev: 'craft_err', msg: e.message }) }
  if (bot.currentWindow) { try { bot.closeWindow(bot.currentWindow) } catch {} }
  await sleep(1200)
  const after = countsVia(names)
  const localProd = localCount(spec.product)
  const want = (spec.yield || 1) * (spec.count || 1)
  const prodGain = after[spec.product] - before[spec.product]
  let verdict
  if (prodGain === want) verdict = 'APPLIED'
  else if (prodGain === 0 && after._items === 0) verdict = 'DENIED'
  else if (after._items > 0) verdict = 'DROPPED'
  else verdict = 'OTHER'
  const r = { arm: ARM, cell, k, verdict, err, placeMs, before, after, localProd, localView: bot.inventory.items().filter(i => names.includes(i.name)).map(i => `${i.name}x${i.count}@${i.slot}`) }
  log({ ev: 'trial_end', verdict, before, after, localProd, err })
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${trialId.padEnd(26)} ${verdict.padEnd(8)} prod ${before[spec.product]}->${after[spec.product]} local ${localProd} items ${after._items} ${err ? 'ERR ' + err : ''}`)
  trialId = null
  return /CRAFT_HANG/.test(err || '')
}

const DONE = new Set(); try { for (const l of fs.readFileSync(RES, 'utf8').split('\n')) if (l) { const r = JSON.parse(l); DONE.add(`${r.cell}:${r.k}`) } } catch {}
bot.once('spawn', async () => {
  try {
    installShims()
    log({ ev: 'spawn', arm: ARM })
    rcon(`gamemode survival ${NAME}`, `fill 696 119 696 704 119 704 minecraft:stone`, `fill 696 120 696 704 122 704 minecraft:air`)
    await sleep(2000)
    for (let k = 0; k < N; k++) {
      for (const cell of CELLS) {
        if (DONE.has(`${cell}:${k}`)) continue
        const hung = await runTrial(cell, k)
        if (hung) { console.log('HANG -> reconnect'); throw new Error('HANG') }
      }
    }
  } catch (e) { console.error('FATAL', e); log({ ev: 'fatal', msg: e.message }) }
  try { rcon(`setblock ${TX} ${TY} ${TZ} minecraft:air`, `kill @e[type=item,x=700,y=120,z=700,distance=..20]`, `clear ${NAME}`) } catch {}
  tr.end(); bot.quit(); setTimeout(() => process.exit(0), 1500)
})
