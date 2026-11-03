// SANDBOX-ONLY (sandbox4): what does a mineflayer 4.37 client on Paper 1.21.8 see of a villager it is NOT trading with?
// (trading design 2026-11-03, merchant scout). Teleports the test bot near sandbox4's natural village (sandbox setup only) and
// prints every villager / wandering trader entity's metadata as the client decodes it, beside the server's own VillagerData.
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const SERVER = 'sandbox4', PORT = 25602, NAME = 'sbx-Scout', TAG = 'trading'
const rcon = (...c) => execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: c.join('\n') + '\n', encoding: 'utf8' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function main () {
  requireSandboxLock(SERVER, TAG)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej) })
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} 2390 70 2430`, `xp set ${NAME} 7 levels`)
  await sleep(8000)
  console.log('experience', JSON.stringify(bot.experience))
  const vs = Object.values(bot.entities).filter(e => /villager|trader/.test(e.name ?? ''))
  for (const e of vs) {
    const md = {}; (e.metadata ?? []).forEach((v, i) => { if (v !== undefined && v !== null && typeof v !== 'function') md[i] = v })
    console.log(e.name, e.uuid, e.position.floored().toString(), JSON.stringify(md).slice(0, 400))
  }
  console.log(rcon('data get entity @e[type=villager,x=2390,y=64,z=2430,distance=..64,limit=4,sort=nearest] VillagerData'))
  const vd = bot.registry.entitiesByName.villager
  console.log('registry villager metadataKeys', JSON.stringify(vd?.metadataKeys))
  bot.quit()
}
main().catch(e => { console.log('FAILED', e.stack); process.exit(1) })
