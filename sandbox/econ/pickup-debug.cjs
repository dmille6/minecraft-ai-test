'use strict'
// SANDBOX-ONLY debug: does a villager pick up bread at all with a player near? (sandbox7, lock tag econ)
const { execFileSync } = require('child_process')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const SERVER = 'sandbox7'
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
const rc = (...c) => execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: c.join('\n') + '\n', encoding: 'utf8' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function main () {
  requireSandboxLock(SERVER, 'econ')
  console.log(rc('forceload add 4200 4200 4220 4220', 'fill 4200 119 4200 4220 119 4220 minecraft:stone', 'fill 4200 120 4200 4220 120 4220 minecraft:grass_block', 'time set 6000', 'gamerule mobGriefing'))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: 25605, username: 'sandbox-Baker', auth: 'offline', version: '1.21.8' })
  await new Promise(r => bot.once('spawn', r))
  bot.on('playerCollect', (a, b) => console.log('COLLECT', a.name || a.username, a.id, b.id))
  console.log(rc('gamemode survival sandbox-Baker', 'tp sandbox-Baker 4205.5 121 4210.5',
    'summon villager 4210.5 121 4210.5 {Tags:["t1"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}'))
  await sleep(5000)
  console.log(rc('data get entity @e[type=villager,tag=t1,limit=1] CanPickUpLoot', 'data get entity @e[type=villager,tag=t1,limit=1] Brain', 'execute as @e[type=villager,tag=t1] at @s run summon item ~ ~0.3 ~ {Item:{id:"minecraft:bread",count:1},PickupDelay:0s}'))
  for (let i = 0; i < 6; i++) {
    await sleep(3000)
    console.log(rc('data get entity @e[type=villager,tag=t1,limit=1] Inventory', 'data get entity @e[type=villager,tag=t1,limit=1] Pos', 'data get entity @e[type=item,x=4200,y=115,z=4200,dx=20,dy=10,dz=20,limit=1] Pos').replace(/\n/g, ' | '))
  }
  console.log(rc('data merge entity @e[type=villager,tag=t1,limit=1] {CanPickUpLoot:1b}'))
  await sleep(6000)
  console.log('after CanPickUpLoot=1', rc('data get entity @e[type=villager,tag=t1,limit=1] Inventory').replace(/\n/g, ' | '))
  console.log(rc('kill @e[type=villager,tag=t1]', 'kill @e[type=item,x=4200,y=115,z=4200,dx=20,dy=10,dz=20]', 'forceload remove 4200 4200 4220 4220'))
  bot.quit()
}
main().catch(e => { console.log('FAILED', e.stack); process.exit(1) })
