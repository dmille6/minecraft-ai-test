// SANDBOX-ONLY (sandbox4) E2E for coalsale-01 (T2) + T4: the REAL trade_trip skill, call after call as cognitive.mjs issues it,
// on a floating strip: home at one end, 44 blocks away a toolsmith (coal 15 -> emerald), a mason (emerald -> bricks /
// chiseled stone bricks) and a librarian (5 emeralds + book -> Mending book), all with fixed novice offers (summoned with an
// Offers list: sandbox setup only), each beside its job site. The bot starts with 60 coal and 1 book (given: sandbox setup).
//   node sandbox/trading/coalsale-e2e.mjs        (from the worktree root; lock: sandbox/sbxlock.sh take sandbox4 trading)
// BOOK=1: no mason, so the emeralds reach the librarian (the T4 book path).
// READ: coal sold and emeralds earned (the bag), the blocks and the book bought, back home over the breadcrumbs, the rows.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const X = 3400, Y = 140, Z = 3400, F = Y + 1, D = 44
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxtrade',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'trlog-')), POOL_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'trpool-')),
  HOME_X: String(X), HOME_Y: String(F), HOME_Z: String(Z), WORLD_BORDER_RADIUS: '6000', BOT_NAME: 'sbx-Trade', LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const lock = req(path.resolve('sandbox/lib/sbxlock.cjs'))
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const T = await import(path.join(BOTS, 'src/trade.mjs'))
const { tapRecords } = await import(path.join(BOTS, 'src/logger.mjs'))
const SERVER = 'sandbox4', PORT = 25602, NAME = 'sbx-Trade'
const rcon = (...cmds) => execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const R = {}
const off = (buy, sell, extra = '') => `{buy:${buy},sell:${sell},maxUses:16,xp:2,rewardExp:1b${extra}}`
async function main () {
  lock.requireSandboxLock(SERVER, 'trading')
  const rows = []; tapRecords(r => { if (/trade|merchant/.test(r.skill?.name ?? '')) rows.push(`${r.skill.name} ${r.skill.status} ${r.skill.detail}`) })
  rcon(`forceload add ${X - 8} ${Z - 8} ${X + D + 12} ${Z + 12}`,
    `fill ${X - 4} ${Y} ${Z - 6} ${X + D + 8} ${Y + 5} ${Z + 6} minecraft:air`,
    `fill ${X - 4} ${Y} ${Z - 6} ${X + D + 8} ${Y} ${Z + 6} minecraft:stone`,
    `fill ${X - 4} ${F} ${Z - 6} ${X + D + 8} ${F + 2} ${Z - 6} minecraft:glass`, `fill ${X - 4} ${F} ${Z + 6} ${X + D + 8} ${F + 2} ${Z + 6} minecraft:glass`,
    `fill ${X - 4} ${F} ${Z - 6} ${X - 4} ${F + 2} ${Z + 6} minecraft:glass`, `fill ${X + D + 8} ${F} ${Z - 6} ${X + D + 8} ${F + 2} ${Z + 6} minecraft:glass`,
    `setblock ${X + D} ${F} ${Z - 4} minecraft:smithing_table`, `setblock ${X + D + 3} ${F} ${Z - 4} minecraft:stonecutter`, `setblock ${X + D + 6} ${F} ${Z - 4} minecraft:lectern`,
    `kill @e[type=villager,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=${D + 30},dy=20,dz=30]`, 'time set 1000')
  await sleep(1000)
  rcon(`summon villager ${X + D + 0.5} ${F} ${Z - 2.5} {Tags:["trd"],NoAI:1b,VillagerData:{profession:"minecraft:toolsmith",level:1,type:"minecraft:plains"},Offers:{Recipes:[${off('{id:"minecraft:coal",count:15}', '{id:"minecraft:emerald",count:1}')},${off('{id:"minecraft:emerald",count:1}', '{id:"minecraft:stone_axe",count:1}')}]}}`,
    ...(process.env.BOOK ? [] : [`summon villager ${X + D + 3.5} ${F} ${Z - 2.5} {Tags:["trd"],NoAI:1b,VillagerData:{profession:"minecraft:mason",level:1,type:"minecraft:plains"},Offers:{Recipes:[${off('{id:"minecraft:clay_ball",count:10}', '{id:"minecraft:emerald",count:1}')},${off('{id:"minecraft:emerald",count:1}', '{id:"minecraft:bricks",count:10}')}]}}`]),
    `summon villager ${X + D + 6.5} ${F} ${Z - 2.5} {Tags:["trd"],NoAI:1b,VillagerData:{profession:"minecraft:librarian",level:1,type:"minecraft:plains"},Offers:{Recipes:[${off('{id:"minecraft:emerald",count:2}', '{id:"minecraft:enchanted_book",count:1,components:{"minecraft:stored_enchantments":{"minecraft:mending":1}}}', ',buyB:{id:"minecraft:book",count:1}')}]}}`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  const ac = new AbortController()
  const count = n => (bot.inventory.items().filter(i => i.name === n).reduce((a, i) => a + i.count, 0))
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${F} ${Z + 0.5}`, `give ${NAME} minecraft:coal 60`, `give ${NAME} minecraft:book 1`)
    await sleep(4000)
    R.start = { coal: count('coal'), emerald: count('emerald'), book: count('book') }
    const home = { x: X, y: F, z: Z }
    bot.tradeTrip = T.newTrip({ now: Date.now(), home, dest: { x: X + D + 3, y: F, z: Z, p: 'toolsmith' }, take: 0 })
    R.calls = []
    for (let i = 0; i < 15 && bot.tradeTrip; i++) {
      const r = await SK.SKILLS.trade_trip.run({ bot }, {}, ac.signal)
      R.calls.push(`${r.status}: ${r.detail}`)
      P('call', i, r.status, r.detail)
    }
    R.end = { coal: count('coal'), emerald: count('emerald'), bricks: count('bricks'), book: count('book'), enchanted_book: count('enchanted_book'),
      atHome: +Math.hypot(bot.entity.position.x - X, bot.entity.position.z - Z).toFixed(1), tripOpen: !!bot.tradeTrip }
    R.server = rcon(`clear ${NAME} minecraft:emerald 0`, `clear ${NAME} minecraft:coal 0`, `clear ${NAME} minecraft:bricks 0`, `clear ${NAME} minecraft:enchanted_book 0`).split('\n').filter(l => /Found|No items/.test(l))
    R.health = rcon('data get entity @e[type=villager,tag=trd,limit=1] Health').split('\n')[1]
  } finally {
    R.rows = rows
    bot.quit(); await sleep(500)
    rcon('kill @e[type=villager,tag=trd]', `kill @e[type=item,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=${D + 30},dy=20,dz=30]`,
      `fill ${X - 4} ${Y} ${Z - 6} ${X + D + 8} ${Y + 5} ${Z + 6} minecraft:air`, `forceload remove ${X - 8} ${Z - 8} ${X + D + 12} ${Z + 12}`)
    console.log('RESULT ' + JSON.stringify(R))
    process.exit(0)
  }
}
main().catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
