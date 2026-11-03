// SANDBOX-ONLY: anvil + enchanting table on Paper 1.21.8 with mineflayer 4.37.1 (anvilproof-1103, ledger anvilbooks-1103 step 1).
//   BOT_ROOT=<checkout with bots/node_modules> node sandbox/trading/anvil-proof.cjs     (take the lock first:
//   sandbox/sbxlock.sh take sandbox3 anvilproof "...", release after). SBX=<sandbox name> picks another free sandbox.
// Why: trade-proof.cjs P4/P5 (11-03) failed both. This driver isolates each cause and proves a working path.
//   A1 anvil.combine (mineflayer helper)              expected to refuse: prismarine-item 1.18 reads no stored_enchantments
//   A2 anvil by hand: clickWindow into slots 0 and 1 (WINDOW slot numbers), wait for the server's result in slot 2 and the
//      repair cost (window property 0), shift-click slot 2 out. Verified in the SERVER's inventory record + XP levels.
//   A3 anvil rename by hand (name_item packet) on a plain item: result + cost
//   A4 a combine the bot cannot afford (0 levels): the server must refuse the take
//   E1 enchanting table with window-numbered items (table.items()), lapis, 'ready', enchant(i): server-verified enchants
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, give, tp, xp.
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox3', PORT = REG.servers[SERVER].port, NAME = 'sbx-Anvil', TAG = 'anvilproof'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0].reply
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 3600, Y = 140, Z = 3600
const R = {}
// the server's own record of the bot's inventory -- the ground truth for every result below
// (one entry per RCON reply: a whole-Inventory reply is cut at RCON's packet size)
const serverInv = () => rcon(...Array.from({ length: 16 }, (_, i) => `data get entity ${NAME} Inventory[${i}]`))
  .map(r => r.reply).filter(s => /entity data/.test(s)).map(s => s.replace(/^.*entity data: /, '').trim()).join('\n')
const serverLevel = () => +(r1(`xp query ${NAME} levels`).match(/has (\d+) experience levels/)?.[1] ?? NaN)
const countIn = name => +(r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const until = async (f, ms, step = 100) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await sleep(step) } return f() }
const desc = it => it ? `${it.name}x${it.count}@${it.slot}` : null
const comps = it => it?.componentMap ? Object.fromEntries([...it.componentMap].map(([k, v]) => [k, v.data])) : null

async function placeFromBag (bot, item, at) {
  const it = bot.inventory.items().find(i => i.name === item)
  if (!it) throw new Error('no ' + item + ' in bag')
  await bot.equip(it, 'hand')
  await bot.lookAt(at, true)
  await bot.placeBlock(bot.blockAt(at.offset(0, -1, 0)), new Vec3(0, 1, 0))
  await sleep(600)
  return bot.blockAt(at)?.name
}
// a WINDOW-numbered item from the open window's player-inventory section (not bot.inventory's numbering)
const winItem = (win, pred) => win.slots.slice(win.inventoryStart, win.inventoryEnd).find(i => i && pred(i))

async function openWithProps (bot, block) {
  const props = {}
  const onProp = p => { if (bot.currentWindow && p.windowId === bot.currentWindow.id) props[p.property] = p.value }
  bot._client.on('craft_progress_bar', onProp)
  const win = await bot.openBlock(block)
  win.once('close', () => bot._client.removeListener('craft_progress_bar', onProp))
  win.props = props
  return win
}

// put `first` in slot 0, optionally rename, optional `second` in slot 1 (plain left clicks), wait for the server's
// result + cost, shift-click the result out. Returns what the client saw.
async function anvilByHand (bot, anvilBlock, firstPred, secondPred, rename) {
  const win = await openWithProps(bot, anvilBlock)
  const out = { type: win.type }
  const first = winItem(win, firstPred)
  if (!first) { bot.closeWindow(win); return { ...out, error: 'no first item' } }
  await bot.clickWindow(first.slot, 0, 0); await bot.clickWindow(0, 0, 0)
  if (secondPred) {
    const second = winItem(win, secondPred)
    if (!second) { bot.closeWindow(win); return { ...out, error: 'no second item' } }
    await bot.clickWindow(second.slot, 0, 0); await bot.clickWindow(1, 0, 0)
  }
  if (rename != null) bot._client.write('name_item', { name: rename })
  out.inputs = [desc(win.slots[0]), desc(win.slots[1])]
  out.result = desc(await until(() => win.slots[2], 5000))
  await sleep(400)
  out.cost = win.props[0] ?? null
  out.resultComponents = comps(win.slots[2])
  out.levelBefore = bot.experience.level
  if (win.slots[2]) {
    await bot.clickWindow(2, 0, 1) // shift-click the result into the bag
    await sleep(1200)
    out.afterTake = { slot0: desc(win.slots[0]), slot1: desc(win.slots[1]), slot2: desc(win.slots[2]) }
  }
  bot.closeWindow(win); await sleep(800)
  out.levelAfter = bot.experience.level
  return out
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`,
    `fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y + 5} ${Z + 6} minecraft:air`,
    `fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y} ${Z + 6} minecraft:stone`,
    `fill ${X - 6} ${Y + 1} ${Z - 6} ${X + 6} ${Y + 3} ${Z - 6} minecraft:glass`,
    `fill ${X - 6} ${Y + 1} ${Z + 6} ${X + 6} ${Y + 3} ${Z + 6} minecraft:glass`,
    `fill ${X - 6} ${Y + 1} ${Z - 6} ${X - 6} ${Y + 3} ${Z + 6} minecraft:glass`,
    `fill ${X + 6} ${Y + 1} ${Z - 6} ${X + 6} ${Y + 3} ${Z + 6} minecraft:glass`,
    `kill @e[type=item,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=20,dy=20,dz=20]`, 'time set 1000')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned', bot.version)
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `xp set ${NAME} 0 points`, `xp set ${NAME} 10 levels`,
      `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`,
      `give ${NAME} minecraft:anvil 1`, `give ${NAME} minecraft:enchanting_table 1`,
      `give ${NAME} minecraft:iron_pickaxe 3`, `give ${NAME} minecraft:lapis_lazuli 10`,
      `give ${NAME} minecraft:enchanted_book[minecraft:stored_enchantments={"minecraft:mending":1}] 1`,
      `give ${NAME} minecraft:enchanted_book[minecraft:stored_enchantments={"minecraft:unbreaking":3}] 1`)
    await sleep(2500)
    R.bag0 = bot.inventory.items().map(desc)
    R.booksClientSide = bot.inventory.items().filter(i => i.name === 'enchanted_book').map(i => ({ enchants: i.enchants, components: comps(i) }))
    R.xp0 = { client: bot.experience.level, server: serverLevel() }
    const ax = new Vec3(X + 2, Y + 1, Z + 0)
    R.anvilPlaced = await placeFromBag(bot, 'anvil', ax)
    const plainPick = i => i.name === 'iron_pickaxe' && !i.componentMap?.has('enchantments') && !i.componentMap?.has('custom_name')
    const mendId = bot.registry.enchantmentsByName?.mending?.id
    const bookWith = id => i => i.name === 'enchanted_book' && JSON.stringify(comps(i)?.stored_enchantments ?? '').includes(`"id":${id}`)

    // ---- A1: the mineflayer helper ----
    try {
      const anvil = await bot.openAnvil(bot.blockAt(ax))
      R.a1_type = anvil.type
      try {
        await anvil.combine(bot.inventory.items().find(plainPick), bot.inventory.items().find(i => i.name === 'enchanted_book'))
        R.a1 = 'combine returned'
      } catch (e) { R.a1 = 'threw ' + e.message }
      try { bot.closeWindow(anvil) } catch {}
    } catch (e) { R.a1 = 'open threw ' + e.message }
    await sleep(1000)
    P('A1 helper', R.a1)

    // ---- A2: by hand, plain iron pickaxe + the Mending book ----
    const lv2 = serverLevel(), books2 = countIn('enchanted_book')
    R.a2_mendId = mendId
    R.a2 = await anvilByHand(bot, bot.blockAt(ax), plainPick, bookWith(mendId))
    if (R.a2.error) { R.a2_fallback = R.a2.error; R.a2 = await anvilByHand(bot, bot.blockAt(ax), plainPick, i => i.name === 'enchanted_book') }
    const inv2 = serverInv()
    R.a2.server = { levelBefore: lv2, levelAfter: serverLevel(), booksBefore: books2, booksAfter: countIn('enchanted_book'), picks: countIn('iron_pickaxe') }
    R.a2.serverInv = inv2
    P('A2 by hand', R.a2)

    // ---- A3: rename only (a plain iron pickaxe -> "TownPick") ----
    const lv3 = serverLevel()
    R.a3 = await anvilByHand(bot, bot.blockAt(ax), plainPick, null, 'TownPick')
    R.a3.server = { levelBefore: lv3, levelAfter: serverLevel(), named: /TownPick/.test(serverInv()) }
    P('A3 rename', R.a3)

    // ---- A4: cannot afford: 0 levels, the remaining (Unbreaking III) book onto the last plain pickaxe ----
    rcon(`xp set ${NAME} 0 points`, `xp set ${NAME} 0 levels`); await sleep(1000)
    const books4 = countIn('enchanted_book')
    R.a4 = await anvilByHand(bot, bot.blockAt(ax), plainPick, i => i.name === 'enchanted_book')
    R.a4.server = { level: serverLevel(), booksBefore: books4, booksAfter: countIn('enchanted_book'), serverInv: serverInv() }
    P('A4 unaffordable', R.a4)
    R.anvilAfterUses = { client: bot.blockAt(ax)?.name, server: r1(`execute if block ${ax.x} ${ax.y} ${ax.z} minecraft:anvil`) }   // 12% damage chance per completed use

    // ---- E1: enchanting table, no bookshelves, window-numbered items ----
    rcon(`xp set ${NAME} 10 levels`); await sleep(1000)
    const ex = new Vec3(X - 2, Y + 1, Z + 0)
    R.tablePlaced = await placeFromBag(bot, 'enchanting_table', ex)
    const lv5 = serverLevel(), lapis0 = countIn('lapis_lazuli')
    try {
      const table = await bot.openEnchantmentTable(bot.blockAt(ex))
      R.e1_type = table.type
      // the trade-proof failure: putTargetItem(<bot.inventory item>) clicks an INVENTORY slot number in the TABLE window
      const invPick = bot.inventory.items().find(i => i.name === 'iron_pickaxe')
      R.e1_inventoryNumbered = { slot: invPick?.slot, tableInventoryEnd: table.inventoryEnd }
      const tgt = table.items().find(plainPick) || table.items().find(i => i.name === 'iron_pickaxe' && !i.componentMap?.has('enchantments'))
      R.e1_target = desc(tgt)
      await table.putTargetItem(tgt)
      await table.putLapis(table.items().find(i => i.name === 'lapis_lazuli'))
      // mineflayer's 'ready' fires on the zero properties sent at open (0 >= 0), before the server prices the item:
      // wait for a real offer instead
      R.e1_waitedMs = await (async () => { const t = Date.now(); await until(() => table.enchantments.some(e => e.level > 0), 8000); await sleep(800); return Date.now() - t })()   // the 3 offers arrive as separate properties
      R.e1_offers = table.enchantments.map(e => ({ level: e.level, enchant: e.expected.enchant, enchLevel: e.expected.level }))
      const best = [2, 1, 0].find(i => table.enchantments[i]?.level > 0 && table.enchantments[i].level <= bot.experience.level)
      R.e1_choice = best
      const item = await Promise.race([table.enchant(best), sleep(5000).then(() => 'timeout')])
      R.e1_item = item === 'timeout' ? item : { name: item?.name, components: comps(item) }
      await sleep(500)
      R.e1_tableSlots = { target: desc(table.slots[0]), targetComponents: comps(table.slots[0]), lapis: desc(table.slots[1]) }
      await table.takeTargetItem()
      if (table.slots[1]) await bot.putAway(1)
      await sleep(500)
      bot.closeWindow(table)
    } catch (e) { R.e1 = 'threw ' + e.message }
    await sleep(1000)
    R.e1_server = { levelBefore: lv5, levelAfter: serverLevel(), lapisBefore: lapis0, lapisAfter: countIn('lapis_lazuli') }
    R.finalServerInv = serverInv()
    // the enchantments the SERVER holds on every item (paths, so RCON does not cut them)
    R.finalServerEnchants = rcon(...Array.from({ length: 16 }, (_, i) => `data get entity ${NAME} Inventory[${i}].components."minecraft:enchantments"`),
      ...Array.from({ length: 16 }, (_, i) => `data get entity ${NAME} Inventory[${i}].components."minecraft:custom_name"`))
      .filter(r => /entity data/.test(r.reply)).map(r => r.cmd.replace(/^data get entity \S+ /, '') + ' = ' + r.reply.replace(/^.*entity data: /, '').trim())
    P('server enchants', R.finalServerEnchants)
    P('E1 table', R.e1_offers, R.e1_choice, R.e1_item, R.e1_server)
  } finally {
    bot.quit(); await sleep(500)
    rcon(`kill @e[type=item,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=20,dy=20,dz=20]`,
      `fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y + 5} ${Z + 6} minecraft:air`,
      `forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`)
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
