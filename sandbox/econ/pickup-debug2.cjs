'use strict'
// SANDBOX-ONLY debug 2: two jobless villagers 4 b apart; bread summoned at the SECOND one's feet, 4 times -> who takes it?
const { execFileSync } = require('child_process')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const rc = (...c) => execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', 'python3 /tmp/sbx-rcon.py sandbox7 -'], { input: c.join('\n') + '\n', encoding: 'utf8' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function main () {
  requireSandboxLock('sandbox7', 'econ')
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: 25605, username: 'sandbox-Baker', auth: 'offline', version: '1.21.8' })
  await new Promise(r => bot.once('spawn', r))
  const ids = {}
  bot.on('playerCollect', (a, b) => console.log('COLLECT by', a.id, a.name))
  rc('gamemode survival sandbox-Baker', 'tp sandbox-Baker 4212.5 121 4204.5')
  await sleep(4000)
  for (const v of Object.values(bot.entities)) if (v.name === 'villager') console.log('villager', v.id, v.position)
  for (let i = 0; i < 4; i++) {
    console.log(rc('execute as @e[tag=q2] at @s run summon item ~ ~0.3 ~ {Item:{id:"minecraft:bread",count:1},PickupDelay:10s}', 'data get entity @e[tag=q1,limit=1] Pos', 'data get entity @e[tag=q2,limit=1] Pos').replace(/\n/g, ' | '))
    await sleep(5000)
  }
  console.log(rc('data get entity @e[tag=q1,limit=1] Inventory', 'data get entity @e[tag=q2,limit=1] Inventory', 'data get entity @e[tag=q2,limit=1] Brain.memories').replace(/\n/g, ' | '))
  console.log(rc('kill @e[tag=q1]', 'kill @e[tag=q2]', 'kill @e[type=item,x=4200,y=115,z=4200,dx=40,dy=10,dz=40]', 'forceload remove 4200 4200 4240 4240'))
  bot.quit()
}
main().catch(e => { console.log('FAILED', e.stack); process.exit(1) })
