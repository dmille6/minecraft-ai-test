// SANDBOX-ONLY E2E for market-03show (hay for the wandering trader), derived from market-e2e.mjs. The showcase town as measured
// 11-08 (wheat 141, iron 122, NO hay, NO pond within 24 b), a wandering trader with the showcase's commonest offers fixed by NBT:
// it BUYS hay_block 1 -> 1 emerald (2 uses) and a water bucket 1 -> 2, and SELLS 8 jungle logs for 1 emerald. Expected (server
// read-back): 18 wheat leave the chest, 2 hay blocks are crafted and sold (uses 2), the 2 emeralds buy 16 jungle logs, NO bucket is
// crafted (no pond: the 11-07/08 waste), the town's iron unchanged.
//   SBX=sandbox4 node sandbox/trading/hay-e2e.mjs   (lock: sandbox/sbxlock.sh take <sbx> market "...")
//
// (market-e2e.mjs's header follows) the REAL code path -- skills.mjs marketAsk (market.mjs marketRunAdmit /
// nextJobBlock) -> SKILLS.market_run.run / SKILLS.market_job.run (withdraw from the town chests, craft, goto, the bucket
// filled at open water, openMerchant + the trades, the job block placed outside a protected zone) -- on Paper 1.21.8, every
// result read back from the SERVER (`clear <bot> <item> 0`, `data get block`, `data get entity`).
//   node sandbox/trading/market-e2e.mjs      (from a worktree root with bots/node_modules; take the lock first:
//   sandbox/sbxlock.sh take sandbox4 market "...", release after)
// Setup by RCON (sandbox only; the owner's no-admin-edit rule is for the bots' worlds): a walled grass platform, the town's
// chests (iron, coal, logs), a crafting table, a 5x5 pond, a wandering trader whose offers are fixed by NBT (it buys a water
// bucket for 2 emeralds and sells 8 cherry logs for 1), then a protected zone with two jobless villagers in it.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const X = 3400, Y = 140, Z = 3700, F = Y + 1
const POOL = fs.mkdtempSync(path.join(os.tmpdir(), 'mkpool-'))
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxhay',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mklog-')), POOL_STATE_DIR: POOL,
  HOME_X: String(X), HOME_Y: String(F), HOME_Z: String(Z), WORLD_BORDER_RADIUS: '6000', BOT_NAME: 'sbx-Hay', LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const lock = req(path.resolve('sandbox/lib/sbxlock.cjs'))
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const MK = await import(path.join(BOTS, 'src/market.mjs'))
const CS = await import(path.join(BOTS, 'src/craftsync.mjs'))
const { tapRecords } = await import(path.join(BOTS, 'src/logger.mjs'))
const SERVER = process.env.SBX || 'sandbox4', REG = req(path.resolve('sandbox/sandboxes.json')), PORT = REG.servers[SERVER].port, NAME = 'sbx-Hay'
const rcon = (...cmds) => execFileSync('ssh', ['-o', 'BatchMode=yes', `mike@${REG.host}`, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
const r1 = c => rcon(c).split('\n').slice(1).join(' ').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const R = {}
const countIn = n => +(r1(`clear ${NAME} minecraft:${n} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const chestItems = (x, y, z) => r1(`data get block ${x} ${y} ${z} Items`).replace(/^.*block data: /, '').slice(0, 400)

async function main () {
  lock.requireSandboxLock(SERVER, 'market')
  const recs = []
  tapRecords(r => { if (/market|trade|withdraw|craft|count_town/.test(r.skill?.name ?? '')) recs.push(`${r.skill.name} ${r.skill.status} ${String(r.skill.detail ?? '').slice(0, 220)}`) })
  rcon(`forceload add ${X - 24} ${Z - 24} ${X + 24} ${Z + 24}`,
    `fill ${X - 40} ${Y - 1} ${Z - 40} ${X + 40} ${Y + 6} ${Z + 40} minecraft:air`,
    `fill ${X - 22} ${Y - 1} ${Z - 22} ${X + 22} ${Y - 1} ${Z + 22} minecraft:stone`,
    `fill ${X - 22} ${Y} ${Z - 22} ${X + 22} ${Y} ${Z + 22} minecraft:grass_block`,
    `fill ${X - 22} ${F} ${Z - 22} ${X + 22} ${F + 3} ${Z - 22} minecraft:glass`, `fill ${X - 22} ${F} ${Z + 22} ${X + 22} ${F + 3} ${Z + 22} minecraft:glass`,
    `fill ${X - 22} ${F} ${Z - 22} ${X - 22} ${F + 3} ${Z + 22} minecraft:glass`, `fill ${X + 22} ${F} ${Z - 22} ${X + 22} ${F + 3} ${Z + 22} minecraft:glass`,
    // the town as measured: wheat 141, iron 122, no hay, NO POND
    `setblock ${X - 3} ${F} ${Z - 3} minecraft:chest`, `setblock ${X - 3} ${F} ${Z - 1} minecraft:chest`, `setblock ${X + 2} ${F} ${Z - 3} minecraft:crafting_table`,
    `item replace block ${X - 3} ${F} ${Z - 3} container.0 with minecraft:iron_ingot 64`, `item replace block ${X - 3} ${F} ${Z - 3} container.1 with minecraft:iron_ingot 58`,
    `item replace block ${X - 3} ${F} ${Z - 1} container.0 with minecraft:wheat 64`, `item replace block ${X - 3} ${F} ${Z - 1} container.1 with minecraft:wheat 64`,
    `item replace block ${X - 3} ${F} ${Z - 1} container.2 with minecraft:wheat 13`,
    `kill @e[type=villager,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`, `kill @e[type=wandering_trader,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`,
    `kill @e[type=item,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`, 'time set 2000', 'gamerule doDaylightCycle false')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  CS.installCraftSync(bot, { log: () => {} })
  const ac = new AbortController()
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${F} ${Z + 0.5}`, `give ${NAME} minecraft:bucket 1`, `give ${NAME} minecraft:stone_pickaxe 1`)
    await sleep(3000)
    for (const item of ['wheat', 'iron_ingot']) R[`seed_${item}`] = (await SK.SKILLS.withdraw.run({ bot }, { item, count: 1 }, ac.signal))?.status
    R.count = await SK.SKILLS.count_town.run({ bot }, {}, ac.signal)
    P('count_town', R.count)
    rcon(`clear ${NAME} minecraft:wheat`, `clear ${NAME} minecraft:iron_ingot`)
    await sleep(1000)
    rcon(`summon wandering_trader ${X + 8.5} ${F} ${Z + 8.5} {Tags:["mkT"],NoAI:1b,DespawnDelay:48000,Offers:{Recipes:[{buy:{id:"minecraft:hay_block",count:1},sell:{id:"minecraft:emerald",count:1},maxUses:2,xp:1,priceMultiplier:0.05f},{buy:{id:"minecraft:water_bucket",count:1},sell:{id:"minecraft:emerald",count:2},maxUses:2,xp:1,priceMultiplier:0.05f},{buy:{id:"minecraft:emerald",count:1},sell:{id:"minecraft:jungle_log",count:8},maxUses:8,xp:1,priceMultiplier:0.05f}]}}`)
    await sleep(2500)
    R.spare = MK.spareGoods({ wheat: 141, iron_ingot: 122 }, {})
    const ask = SK.marketAsk({ now: Date.now() }, bot)
    R.ask = ask
    P('ask', ask)
    const snap = () => ({ wheat: countIn('wheat'), hay: countIn('hay_block'), bucket: countIn('bucket'), water: countIn('water_bucket'), iron: countIn('iron_ingot'), emerald: countIn('emerald'), jungle: countIn('jungle_log') })
    const before = snap()
    if (ask?.order) { const t = Date.now(); R.run = await SK.SKILLS[ask.order.skill].run({ bot }, ask.order.args, ac.signal); R.ms = Date.now() - t }
    await sleep(1000)
    R.server = { before, after: snap(), chestWheat: chestItems(X - 3, F, Z - 1), chestIron: chestItems(X - 3, F, Z - 3),
      hayUses: r1(`data get entity @e[type=wandering_trader,tag=mkT,limit=1] Offers.Recipes[0].uses`),
      logUses: r1(`data get entity @e[type=wandering_trader,tag=mkT,limit=1] Offers.Recipes[2].uses`) }
    P('result', R.run, R.server)
    R.records = recs
  } finally {
    bot.quit(); await sleep(500)
    rcon(`kill @e[type=villager,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`, `kill @e[type=wandering_trader,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`,
      `kill @e[type=item,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`,
      `fill ${X - 22} ${Y - 1} ${Z - 22} ${X + 22} ${Y + 6} ${Z + 22} minecraft:air`, `forceload remove ${X - 24} ${Z - 24} ${X + 24} ${Z + 24}`, 'gamerule doDaylightCycle true')
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().then(() => process.exit(0)).catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
