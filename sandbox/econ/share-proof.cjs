'use strict'
// SANDBOX-ONLY: does a villager holding >= 24 food points (6+ bread) THROW food to a hungry neighbour (vanilla TradeWithVillager)?
// Two jobless adults 3 b apart in a glass pen, one given 8 bread by NBT (the other none), a player near (activation range); 150 s.
const { execFileSync } = require('child_process')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const rc = (...c) => execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', 'python3 /tmp/sbx-rcon.py sandbox7 -'], { input: c.join('\n') + '\n', encoding: 'utf8' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const bread = s => [...s.matchAll(/count:\s*(\d+),\s*id:\s*"minecraft:bread"|id:\s*"minecraft:bread",\s*count:\s*(\d+)/g)].reduce((a, m) => a + +(m[1] || m[2]), 0)
async function main () {
  requireSandboxLock('sandbox7', 'econ')
  const G = 120, X = 4300, Z = 4300
  rc(`forceload add ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`, 'gamerule mobGriefing true', `fill ${X - 8} ${G} ${Z - 8} ${X + 8} ${G + 4} ${Z + 8} minecraft:glass`, `fill ${X - 7} ${G + 1} ${Z - 7} ${X + 7} ${G + 4} ${Z + 7} minecraft:air`,
    `fill ${X - 7} ${G} ${Z - 7} ${X + 7} ${G} ${Z + 7} minecraft:grass_block`, 'time set 6000', 'gamerule doDaylightCycle false',
    `summon villager ${X - 1.5} ${G + 1} ${Z + 0.5} {CanPickUpLoot:1b,Tags:["s1"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"},Inventory:[{id:"minecraft:bread",count:8}]}`,
    `summon villager ${X + 1.5} ${G + 1} ${Z + 0.5} {CanPickUpLoot:1b,Tags:["s2"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: 25605, username: 'sandbox-Baker', auth: 'offline', version: '1.21.8' })
  await new Promise(r => bot.once('spawn', r))
  rc('gamemode spectator sandbox-Baker', `tp sandbox-Baker ${X} ${G + 6} ${Z}`)
  const t0 = Date.now()
  const rows = []
  while (Date.now() - t0 < 150_000) {
    await sleep(10_000)
    const a = bread(rc('data get entity @e[tag=s1,limit=1] Inventory')), b = bread(rc('data get entity @e[tag=s2,limit=1] Inventory'))
    rows.push([Math.round((Date.now() - t0) / 1000), a, b]); console.log('t', rows.at(-1))
    if (b > 0) break
  }
  console.log('RESULT ' + JSON.stringify({ shared: rows.at(-1)[2] > 0, rows }))
  rc('kill @e[tag=s1]', 'kill @e[tag=s2]', `kill @e[type=item,x=${X - 9},y=${G},z=${Z - 9},dx=18,dy=6,dz=18]`, `fill ${X - 8} ${G} ${Z - 8} ${X + 8} ${G + 4} ${Z + 8} minecraft:air`, `forceload remove ${X - 10} ${Z - 10} ${X + 10} ${Z + 10}`, 'gamerule doDaylightCycle true', 'gamemode survival sandbox-Baker')
  bot.quit()
}
main().catch(e => { console.log('FAILED', e.stack); process.exit(1) })
