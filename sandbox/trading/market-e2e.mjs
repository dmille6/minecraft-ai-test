// SANDBOX-ONLY (sandbox4) E2E for market-01: the REAL code path -- skills.mjs marketAsk (market.mjs marketRunAdmit /
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
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxmarket',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mklog-')), POOL_STATE_DIR: POOL,
  HOME_X: String(X), HOME_Y: String(F), HOME_Z: String(Z), WORLD_BORDER_RADIUS: '6000', BOT_NAME: 'sbx-Market', LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
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
const SERVER = process.env.SBX || 'sandbox4', REG = req(path.resolve('sandbox/sandboxes.json')), PORT = REG.servers[SERVER].port, NAME = 'sbx-Market'
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
    `fill ${X - 22} ${Y - 1} ${Z - 22} ${X + 22} ${Y + 6} ${Z + 22} minecraft:air`,
    `fill ${X - 22} ${Y - 1} ${Z - 22} ${X + 22} ${Y - 1} ${Z + 22} minecraft:stone`,
    `fill ${X - 22} ${Y} ${Z - 22} ${X + 22} ${Y} ${Z + 22} minecraft:grass_block`,
    `fill ${X - 22} ${F} ${Z - 22} ${X + 22} ${F + 3} ${Z - 22} minecraft:glass`, `fill ${X - 22} ${F} ${Z + 22} ${X + 22} ${F + 3} ${Z + 22} minecraft:glass`,
    `fill ${X - 22} ${F} ${Z - 22} ${X - 22} ${F + 3} ${Z + 22} minecraft:glass`, `fill ${X + 22} ${F} ${Z - 22} ${X + 22} ${F + 3} ${Z + 22} minecraft:glass`,
    // the town: two chests, a crafting table; the pond 5x5 (its 3x3 middle is open water: 8 source neighbours each)
    `setblock ${X - 3} ${F} ${Z - 3} minecraft:chest`, `setblock ${X - 3} ${F} ${Z - 1} minecraft:chest`, `setblock ${X + 2} ${F} ${Z - 3} minecraft:crafting_table`,
    `item replace block ${X - 3} ${F} ${Z - 3} container.0 with minecraft:iron_ingot 64`, `item replace block ${X - 3} ${F} ${Z - 3} container.1 with minecraft:iron_ingot 64`,
    `item replace block ${X - 3} ${F} ${Z - 3} container.2 with minecraft:iron_ingot 16`,
    `item replace block ${X - 3} ${F} ${Z - 1} container.0 with minecraft:coal 64`, `item replace block ${X - 3} ${F} ${Z - 1} container.1 with minecraft:coal 36`,
    `item replace block ${X - 3} ${F} ${Z - 1} container.2 with minecraft:spruce_log 32`,
    `fill ${X - 12} ${Y} ${Z + 8} ${X - 8} ${Y} ${Z + 12} minecraft:water`,
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
    // the town index, as a real bot builds it: count_town opens every chest
    // a withdraw observes the chest it opens (the index's first records), then count_town reads every chest
    for (const item of ['coal', 'iron_ingot', 'spruce_log']) R[`seed_${item}`] = (await SK.SKILLS.withdraw.run({ bot }, { item, count: 1 }, ac.signal))?.status
    R.count = await SK.SKILLS.count_town.run({ bot }, {}, ac.signal)
    P('count_town', R.count)
    // ---- scene 1: the wandering trader near town ----
    rcon(`summon wandering_trader ${X + 8.5} ${F} ${Z + 8.5} {Tags:["mkT"],NoAI:1b,DespawnDelay:48000,Offers:{Recipes:[{buy:{id:"minecraft:water_bucket",count:1},sell:{id:"minecraft:emerald",count:2},maxUses:2,xp:1,priceMultiplier:0.05f},{buy:{id:"minecraft:emerald",count:1},sell:{id:"minecraft:cherry_log",count:8},maxUses:4,xp:1,priceMultiplier:0.05f}]}}`)
    await sleep(2500)
    const ask1 = SK.marketAsk({ now: Date.now() }, bot)
    R.s1_ask = ask1
    P('s1 ask', ask1)
    const before1 = { iron: countIn('iron_ingot'), bucket: countIn('bucket'), emerald: countIn('emerald'), cherry: countIn('cherry_log'), water: countIn('water_bucket') }
    if (ask1?.order) {
      const t = Date.now()
      R.s1_run = await SK.SKILLS[ask1.order.skill].run({ bot }, ask1.order.args, ac.signal)
      R.s1_ms = Date.now() - t
    }
    await sleep(1000)
    R.s1_server = { before: before1, after: { iron: countIn('iron_ingot'), bucket: countIn('bucket'), emerald: countIn('emerald'), cherry: countIn('cherry_log'), water: countIn('water_bucket') },
      chestIron: chestItems(X - 3, F, Z - 3), traderUses: r1(`data get entity @e[type=wandering_trader,tag=mkT,limit=1] Offers.Recipes[0].uses`), pond: r1(`execute if block ${X - 10} ${Y} ${Z + 10} minecraft:water`) }
    P('s1', R.s1_run, R.s1_server)
    R.s1_offers = fs.existsSync(path.join(POOL)) ? fs.readdirSync(POOL).filter(f => /^market-/.test(f)) : []
    // ---- scene 2: a protected zone east of town, two FREE jobless villagers in it ----
    rcon(`kill @e[type=wandering_trader,tag=mkT]`)
    fs.writeFileSync(path.join(POOL, 'protected-zones.json'), JSON.stringify({ version: 1, zones: [{ id: 'sbx-village', kind: 'village', box: [X + 10, -64, Z - 21, X + 21, 320, Z - 5] }] }))
    SK.resetPlanZones?.()
    rcon(`summon villager ${X + 13.5} ${F} ${Z - 12.5} {Tags:["mkV"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
      `summon villager ${X + 14.5} ${F} ${Z - 10.5} {Tags:["mkV"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`)
    await sleep(3000)
    // the free test needs a sighting 6+ b away 5+ min ago: written to the pool's sightings file as the ask would have
    const vs = Object.values(bot.entities).filter(e => e.name === 'villager')
    const seen = Object.fromEntries(vs.map(e => [e.uuid, [{ x: e.position.x - 8, z: e.position.z, at: Date.now() - 10 * 60_000 }]]))
    fs.writeFileSync(SK._marketTest.mkFile('seen'), JSON.stringify(seen))
    SK._marketTest.mkState.lastRunAt = -Infinity
    const ask2 = SK.marketAsk({ now: Date.now() }, bot)
    R.s2_ask = ask2
    P('s2 ask', ask2)
    if (ask2?.order) R.s2_run = await SK.SKILLS[ask2.order.skill].run({ bot }, ask2.order.args, ac.signal)
    await sleep(1000)
    const st = r1(`execute if block ${X + 2} ${F} ${Z - 3} minecraft:crafting_table`)
    const cells = []
    for (let x = X - 4; x <= X + 21; x++) for (let z = Z - 21; z <= Z + 4; z++) cells.push([x, F, z])
    const out = rcon(...cells.map(([x, y, z]) => `execute if block ${x} ${y} ${z} minecraft:smithing_table`)).split('\n')
    const found = []
    let ci = -1
    for (const line of out) { if (line.startsWith('> ')) ci++; else if (/passed/i.test(line) && ci >= 0) found.push(cells[ci]) }
    R.s2_server = { smithing_tables: found, insideZone: found.filter(([x, , z]) => x >= X + 10 && x <= X + 21 && z >= Z - 21 && z <= Z - 5).length,
      professions: r1(`data get entity @e[type=villager,tag=mkV,limit=1,sort=nearest] VillagerData.profession`), table: st }
    P('s2', R.s2_run, R.s2_server)
    // ---- scene 3: the new toolsmith works at the market: a run reads its window (and sells coal if it buys it) ----
    await sleep(20000)
    SK._marketTest.mkState.lastRunAt = -Infinity
    const before3 = { coal: countIn('coal'), emerald: countIn('emerald') }
    const ask3 = SK.marketAsk({ now: Date.now() }, bot)
    R.s3_ask = ask3
    if (ask3?.order) R.s3_run = await SK.SKILLS[ask3.order.skill].run({ bot }, ask3.order.args, ac.signal)
    await sleep(1000)
    R.s3_server = { before: before3, after: { coal: countIn('coal'), emerald: countIn('emerald') }, villagerXp: r1(`data get entity @e[type=villager,tag=mkV,limit=1,sort=nearest] Xp`) }
    P('s3', R.s3_ask, R.s3_run, R.s3_server)
    try { R.offersFile = JSON.parse(fs.readFileSync(SK._marketTest.mkFile('offers'), 'utf8')) } catch { R.offersFile = null }
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
