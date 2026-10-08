// SANDBOX-ONLY (sandbox..sandbox4 = 10.0.0.30:25599-25602), RCON for setup and the oracle. THE DRAIN'S CURSOR ON PAPER
// (Codex, junkwell merge): a wooden sword really lifted onto the cursor of an open furnace window (mineflayer's first
// click of a take), then either a plain close (what the drain did before) or the new drainFurnace. The server's slots
// and the ground are read back by RCON, never the bot's claim.
//   node pk-cursor-probe.mjs <bots dir> [sandbox3]
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const BOTS = path.resolve(process.argv[2])
const SERVER = process.argv[3] ?? 'sandbox3'
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
Object.assign(process.env, { OLLAMA_MODEL: 'probe', LOG_DIR: '/tmp/pk-cursor-probe-log', BOT_NAME: 'sandbox-Cur', HOME_X: '760', HOME_Y: '120', HOME_Z: '700' })
const { createRequire } = await import('node:module')
const require = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = require('mineflayer')
const { drainFurnace } = await import(path.join(BOTS, 'src/skills.mjs'))
const NAME = 'sandbox-Cur'
const F = { x: 762, y: 120, z: 700 }
const sleep = ms => new Promise(r => setTimeout(r, ms))
function rcon (...cmds) {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += line }
  return res
}
const oracle = () => {
  const r = rcon(`data get block ${F.x} ${F.y} ${F.z} Items[{Slot:1b}].id`,
    `execute if entity @e[type=item,x=${F.x},y=${F.y},z=${F.z},distance=..8,nbt={Item:{id:"minecraft:wooden_sword"}}]`,
    `execute if entity @a[name=${NAME},nbt={Inventory:[{id:"minecraft:wooden_sword"}]}]`)
  return { fuelSlot: /wooden_sword/.test(r[0].reply) ? 'wooden_sword' : '-', onGround: /passed/i.test(r[1].reply), inBag: /passed/i.test(r[2].reply) }
}
async function scene (bot, what, full) {
  rcon(`kill @e[type=item,x=${F.x},y=${F.y},z=${F.z},distance=..12]`, `clear ${NAME}`,
    `setblock ${F.x} ${F.y} ${F.z} minecraft:air`,
    `setblock ${F.x} ${F.y} ${F.z} minecraft:furnace[facing=west]{Items:[{Slot:1b,id:"minecraft:wooden_sword",count:1}]}`,
    `tp ${NAME} ${F.x - 2} ${F.y} ${F.z}`)
  if (full) rcon(...Array.from({ length: 36 }, (_, s) => `item replace entity ${NAME} container.${s} with minecraft:cobblestone 64`))
  await sleep(1500)
  const furnace = await bot.openFurnace(bot.blockAt(bot.entity.position.offset(2, 0, 0).floored()))
  await sleep(500)
  await bot.clickWindow(1, 0, 0)        // the take's FIRST click: the sword onto the cursor
  await sleep(500)
  const lifted = furnace.selectedItem?.name ?? '-'
  if (what === 'close') furnace.close()  // the old drain after a take that stopped between its clicks
  else await drainFurnace(furnace, 5000, bot)
  await sleep(2000)
  const o = oracle()
  console.log(`${what.padEnd(6)} bag=${full ? 'FULL ' : 'room '} lifted=${lifted.padEnd(13)} fate=${furnace.swordFate ?? '-'} | SERVER: fuel slot ${o.fuelSlot}, in bag ${o.inBag}, on the ground ${o.onGround}`)
  return o
}
rcon(`forceload add ${F.x - 8} ${F.z - 8} ${F.x + 8} ${F.z + 8}`, `fill ${F.x - 6} ${F.y} ${F.z - 6} ${F.x + 6} ${F.y + 4} ${F.z + 6} minecraft:air`,
  `fill ${F.x - 6} ${F.y - 1} ${F.z - 6} ${F.x + 6} ${F.y - 1} ${F.z + 6} minecraft:stone`, 'difficulty peaceful')
const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline' })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
rcon(`gamemode survival ${NAME}`)
await sleep(2000)
try {
  for (const [what, full] of [['close', false], ['close', true], ['drain', false], ['drain', true]]) await scene(bot, what, full)
} finally {
  rcon(`kill @e[type=item,x=${F.x},y=${F.y},z=${F.z},distance=..12]`, `clear ${NAME}`, `setblock ${F.x} ${F.y} ${F.z} minecraft:air`)
  bot.quit(); await sleep(1000)
  rcon(`forceload remove ${F.x - 8} ${F.z - 8} ${F.x + 8} ${F.z + 8}`)
  process.exit(0)
}
