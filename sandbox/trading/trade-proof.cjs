// SANDBOX-ONLY (sandbox4): villager trading facts on Paper 1.21.8 with mineflayer 4.37 (trading design 2026-11-03).
//   BOT_ROOT=<worktree> node sandbox/trading/trade-proof.cjs        (take the lock first: sandbox/sbxlock.sh take sandbox4 trading)
// Arena (RCON edits on a floating glass-walled platform, sandbox only, far from the sandbox's own villages): two pens.
//   P1 job acquisition: an UNEMPLOYED villager (summoned) + a job-site block the BOT places in survival -> does it take the job?
//      run once with gamerule mobGriefing true (fleet) and once with false (the showcase's value), each in its own pen.
//   P2 openVillager: does the trade list parse on 1.21.8 (inputs, outputs, uses, prices)?
//   P3 villager.trade: one SELL (goods -> emerald) and one BUY (emerald -> goods), confirmed in the server's own inventory
//      record (`data get entity`), villager health unchanged.
//   P4 anvil: an enchanted book (Mending) onto an iron pickaxe with 10 XP levels; levels spent; Mending on the result.
//   P5 enchanting table: lapis + levels -> an enchanted iron pickaxe (no bookshelves).
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, summon, give, tp, xp.
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const SERVER = 'sandbox4', PORT = 25602, NAME = 'sbx-Trader', TAG = 'trading'
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
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
const X = 3400, Y = 140, Z = 3400
const R = {}
const prof = tag => r1(`data get entity @e[type=villager,tag=${tag},limit=1] VillagerData.profession`)
const health = tag => r1(`data get entity @e[type=villager,tag=${tag},limit=1] Health`)
const countIn = (name) => { const m = r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/); return m ? +m[1] : 0 }

async function placeFromBag (bot, item, at) {
  const it = bot.inventory.items().find(i => i.name === item)
  if (!it) throw new Error('no ' + item + ' in bag')
  await bot.equip(it, 'hand')
  for (let i = 0; i < 20 && !bot.blockAt(at.offset(0, -1, 0)); i++) await sleep(500)
  await bot.lookAt(at, true)
  await bot.placeBlock(bot.blockAt(at.offset(0, -1, 0)), new Vec3(0, 1, 0))
  await sleep(600)
  return bot.blockAt(at)?.name
}
async function waitProf (tag, ms) {
  const t = Date.now()
  while (Date.now() - t < ms) { const p = prof(tag); if (!/minecraft:none/.test(p)) return { prof: p, s: (Date.now() - t) / 1000 }; await sleep(5000) }
  return { prof: prof(tag), s: ms / 1000, timeout: true }
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  const mg0 = r1('gamerule mobGriefing')
  R.mobGriefingBefore = mg0
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`,
    `fill ${X - 12} ${Y} ${Z - 6} ${X + 12} ${Y + 5} ${Z + 6} minecraft:air`,
    `fill ${X - 12} ${Y} ${Z - 6} ${X + 12} ${Y} ${Z + 6} minecraft:stone`,
    // outer glass wall, 3 high, and a glass divider at X: pen W (x<X) and pen E (x>X)
    `fill ${X - 12} ${Y + 1} ${Z - 6} ${X + 12} ${Y + 3} ${Z - 6} minecraft:glass`,
    `fill ${X - 12} ${Y + 1} ${Z + 6} ${X + 12} ${Y + 3} ${Z + 6} minecraft:glass`,
    `fill ${X - 12} ${Y + 1} ${Z - 6} ${X - 12} ${Y + 3} ${Z + 6} minecraft:glass`,
    `fill ${X + 12} ${Y + 1} ${Z - 6} ${X + 12} ${Y + 3} ${Z + 6} minecraft:glass`,
    `fill ${X} ${Y + 1} ${Z - 6} ${X} ${Y + 3} ${Z + 6} minecraft:glass`,
    `kill @e[type=villager,x=${X - 20},y=${Y - 5},z=${Z - 20},dx=40,dy=20,dz=40]`,
    `kill @e[type=item,x=${X - 20},y=${Y - 5},z=${Z - 20},dx=40,dy=20,dz=40]`,
    'time set 1000', 'gamerule mobGriefing true')
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned')
  try {
    // ---- P1a: mobGriefing TRUE, pen E, unemployed villager + bot-placed smithing table (toolsmith) ----
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `xp set ${NAME} 0 levels`, `xp set ${NAME} 0 points`,
      `tp ${NAME} ${X + 6.5} ${Y + 1} ${Z + 0.5}`,
      `give ${NAME} minecraft:smithing_table 1`, `give ${NAME} minecraft:fletching_table 1`,
      `summon villager ${X + 9.5} ${Y + 1} ${Z + 3.5} {Tags:["trA"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`)
    await sleep(2500)
    R.p1a_before = prof('trA')
    R.p1a_placed = await placeFromBag(bot, 'smithing_table', new Vec3(X + 8, Y + 1, Z - 2))
    R.p1a = await waitProf('trA', 150000)
    P('P1a mobGriefing=true', R.p1a_before, R.p1a_placed, R.p1a)
    // ---- P1b: mobGriefing FALSE (the showcase's gamerule), pen W, bot-placed fletching table (fletcher) ----
    rcon('gamerule mobGriefing false', `tp ${NAME} ${X - 6.5} ${Y + 1} ${Z + 0.5}`,
      `summon villager ${X - 9.5} ${Y + 1} ${Z + 3.5} {Tags:["trB"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`)
    await sleep(2500)
    R.p1b_placed = await placeFromBag(bot, 'fletching_table', new Vec3(X - 8, Y + 1, Z - 2))
    R.p1b = await waitProf('trB', 150000)
    rcon('gamerule mobGriefing true')
    P('P1b mobGriefing=false', R.p1b_placed, R.p1b)

    // ---- P2/P3: trade with whichever villager took a job (prefer A) ----
    const tag = !R.p1a.timeout ? 'trA' : (!R.p1b.timeout ? 'trB' : null)
    if (!tag) throw new Error('no villager took a job: P2/P3 not reachable')
    const vx = tag === 'trA' ? X + 6.5 : X - 6.5
    rcon(`tp ${NAME} ${vx} ${Y + 1} ${Z + 0.5}`, `give ${NAME} minecraft:emerald 10`, `give ${NAME} minecraft:coal 40`,
      `give ${NAME} minecraft:stick 64`, `give ${NAME} minecraft:string 40`, `give ${NAME} minecraft:flint 40`,
      `give ${NAME} minecraft:iron_ingot 10`)
    await sleep(2500)
    const ve = Object.values(bot.entities).filter(e => e.name === 'villager').sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
    R.villagerSeen = ve ? { id: ve.id, dist: +ve.position.distanceTo(bot.entity.position).toFixed(1), meta: ve.metadata?.length } : null
    R.healthBefore = health(tag)
    const v = await bot.openVillager(ve)
    R.trades = v.trades.map((t, i) => ({ i, in1: `${t.inputItem1?.name}x${t.inputItem1?.count}`, in2: t.hasItem2 ? `${t.inputItem2?.name}x${t.inputItem2?.count}` : null, out: `${t.outputItem?.name}x${t.outputItem?.count}`, uses: t.nbTradeUses, max: t.maximumNbTradeUses, realPrice: t.realPrice, disabled: t.tradeDisabled, xp: t.xp }))
    P('P2 trades', R.trades)
    const sell = v.trades.findIndex(t => t.outputItem?.name === 'emerald' && !t.tradeDisabled)
    const buy = v.trades.findIndex(t => t.inputItem1?.name === 'emerald' && !t.tradeDisabled)
    const em0 = countIn('emerald')
    if (sell >= 0) {
      const t = v.trades[sell], inName = t.inputItem1.name, in0 = countIn(inName)
      try { await v.trade(sell, 1); R.sell = 'ok' } catch (e) { R.sell = 'threw ' + e.message }
      await sleep(1200)
      R.sellCheck = { inName, inBefore: in0, inAfter: countIn(inName), emBefore: em0, emAfter: countIn('emerald') }
      P('P3 sell', R.sell, R.sellCheck)
    } else R.sell = 'no sell offer'
    if (buy >= 0) {
      const t = v.trades[buy], outName = t.outputItem.name, em1 = countIn('emerald'), out0 = countIn(outName)
      try { await v.trade(buy, 1); R.buy = 'ok' } catch (e) { R.buy = 'threw ' + e.message }
      await sleep(1200)
      R.buyCheck = { outName, outBefore: out0, outAfter: countIn(outName), emBefore: em1, emAfter: countIn('emerald') }
      P('P3 buy', R.buy, R.buyCheck)
    } else R.buy = 'no buy offer'
    v.close(); await sleep(500)
    R.healthAfter = health(tag)
    R.villagerXp = r1(`data get entity @e[type=villager,tag=${tag},limit=1] Xp`)
    R.botXpAfterTrades = bot.experience

    // ---- P4: anvil, Mending book onto an iron pickaxe ----
    rcon(`clear ${NAME}`, `xp set ${NAME} 10 levels`, `give ${NAME} minecraft:anvil 1`, `give ${NAME} minecraft:iron_pickaxe 1`,
      `give ${NAME} minecraft:enchanted_book[minecraft:stored_enchantments={"minecraft:mending":1}] 1`,
      `give ${NAME} minecraft:enchanting_table 1`, `give ${NAME} minecraft:lapis_lazuli 10`, `give ${NAME} minecraft:iron_pickaxe 1`)
    await sleep(2500)
    R.bagBeforeAnvil = bot.inventory.items().map(i => `${i.name}x${i.count}`)
    R.xpBeforeAnvil = bot.experience?.level
    const ax = new Vec3(Math.floor(bot.entity.position.x) + 2, Y + 1, Z + 0)
    R.anvilPlaced = await placeFromBag(bot, 'anvil', ax)
    try {
      const anvil = await bot.openAnvil(bot.blockAt(ax))
      const pick = bot.inventory.items().find(i => i.name === 'iron_pickaxe')
      const book = bot.inventory.items().find(i => i.name === 'enchanted_book')
      try { await anvil.combine(pick, book); R.anvil = 'combine ok' } catch (e) {
        // mineflayer's combine prices the work with prismarine-item's Item.anvil, which reads pre-1.20.5 NBT: drive the window by hand
        R.anvilCombine = 'threw ' + e.message
        const ws = it => it.slot - 9 + anvil.inventoryStart
        await bot.moveSlotItem(ws(pick), 0)
        await bot.moveSlotItem(ws(bot.inventory.items().find(i => i.name === 'enchanted_book')), 1)
        await sleep(1500)
        R.anvilOutSlot = anvil.slots[2] ? anvil.slots[2].name : null
        if (anvil.slots[2]) { await bot.putAway(2); R.anvil = 'manual ok' } else R.anvil = 'manual: no result in slot 2'
      }
      anvil.close()
    } catch (e) { R.anvil = 'threw ' + e.message }
    await sleep(1500)
    R.xpAfterAnvil = bot.experience?.level
    R.anvilResult = r1(`data get entity ${NAME} Inventory`).match(/mending[^}]*/)?.[0] ?? 'no mending in the inventory record'
    P('P4 anvil', R.anvil, R.xpBeforeAnvil, '->', R.xpAfterAnvil, R.anvilResult)

    // ---- P5: enchanting table, no bookshelves ----
    rcon(`xp set ${NAME} 10 levels`)
    await sleep(1000)
    const ex = new Vec3(Math.floor(bot.entity.position.x) - 2, Y + 1, Z + 0)
    R.tablePlaced = await placeFromBag(bot, 'enchanting_table', ex)
    try {
      R.p5step = 'open ' + bot.blockAt(ex)?.name
      const table = await bot.openEnchantmentTable(bot.blockAt(ex))
      const picks = bot.inventory.items().filter(i => i.name === 'iron_pickaxe')
      const pick = picks[picks.length - 1]
      R.p5step = 'target'
      await table.putTargetItem(pick)
      R.p5step = 'lapis'
      await table.putLapis(bot.inventory.items().find(i => i.name === 'lapis_lazuli'))
      R.p5step = 'offers'
      await sleep(1500)
      R.enchantOffers = table.enchantments
      const best = [2, 1, 0].find(i => table.enchantments[i]?.level > 0 && table.enchantments[i].level <= bot.experience.level)
      const item = await table.enchant(best)
      R.enchanted = { slot: best, enchants: item?.enchants }
      await table.takeTargetItem(); table.close()
    } catch (e) { R.enchanted = 'threw ' + e.message }
    await sleep(1000)
    R.xpAfterEnchant = bot.experience?.level
    P('P5 enchant', R.enchantOffers, R.enchanted, R.xpAfterEnchant)
  } finally {
    bot.quit(); await sleep(500)
    rcon(`kill @e[type=villager,tag=trA]`, `kill @e[type=villager,tag=trB]`,
      `kill @e[type=item,x=${X - 20},y=${Y - 5},z=${Z - 20},dx=40,dy=20,dz=40]`,
      `fill ${X - 12} ${Y} ${Z - 6} ${X + 12} ${Y + 5} ${Z + 6} minecraft:air`,
      `forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`,
      `gamerule mobGriefing ${/false/.test(mg0) ? 'false' : 'true'}`)
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
