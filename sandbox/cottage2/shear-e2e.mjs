// SANDBOX-ONLY (cottage2-01, 2026-11-08): THE WOOL AND THE FURNITURE, BY THE BOTS' OWN CODE ON PAPER.
//   BOT_ROOT=<worktree> SBX=sandbox7 node sandbox/cottage2/shear-e2e.mjs
// S1  the sheep byte: mineflayer's metadata read by cottage.mjs sheepWool says a fresh sheep is NOT sheared and, after the errand,
//     that it IS (the instrument sees both states)
// S2  the shear errand (skills.mjs _cottage2.cottageShearVisit, the code a standing cottage's upkeep runs): 3 sheep summoned 6-10 b
//     away on grass, the bot with shears -> wool in the bag, every sheep sheared by the SERVER (`execute if entity ... Sheared:1b`)
// S3  a sheep out of sight (beyond SHEAR.seeR) is never walked to (the errand ends no_sheep_in_sight, nothing gained)
// S4  the furniture crafts (_cottage2.cottageFurnitureCrafts): 6 wool + spruce logs -> 2 beds of that colour; 1 iron ingot + 2 torches
//     -> 1 lantern (9 nuggets, 8 spent) -- a crafting table beside the bot
// Arena (RCON, sandbox only): a grass field far from spawn, the sheep summoned, the kit given. Never on a fleet or showcase world.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HX = 500, HY = 121, HZ = 500
const SERVER = process.env.SBX || 'sandbox7'
const NAME = 'sbx-Cottage2S'
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'showcase',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'c2log-')), POOL_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'c2pool-')),
  HOME_X: String(HX), HOME_Y: String(HY), HOME_Z: String(HZ), WORLD_BORDER_RADIUS: '6000', BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
  COTTAGE: 'on', COTTAGE2: 'on',
})
const BOT_ROOT = path.resolve(process.env.BOT_ROOT || '.')
const BOTS = path.join(BOT_ROOT, 'bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const REG = req(path.join(BOT_ROOT, 'sandbox/sandboxes.json'))
const PORT = REG.servers[SERVER].port
const SK = await import(path.join(BOTS, 'src', 'skills.mjs'))
const C = await import(path.join(BOTS, 'src', 'cottage.mjs'))
const CS = await import(path.join(BOTS, 'src', 'craftsync.mjs'))   // the bots' craft sync (index.mjs installs it): bare back-to-back crafts race
const rcon = (...cmds) => {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', `mike@${REG.host}`, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const count = (bot, re) => bot.inventory.items().filter(i => re.test(i.name)).reduce((t, i) => t + i.count, 0)

async function main () {
  const out = []
  const R = 24
  rcon(`forceload add ${HX - R} ${HZ - R} ${HX + R} ${HZ + R}`, `fill ${HX - R} ${HY - 2} ${HZ - R} ${HX + R} ${HY - 2} ${HZ + R} minecraft:dirt`, `fill ${HX - R} ${HY - 1} ${HZ - R} ${HX + R} ${HY - 1} ${HZ + R} minecraft:grass_block`,
    `fill ${HX - R} ${HY} ${HZ - R} ${HX + R} ${HY + 6} ${HZ + R} minecraft:air`, `kill @e[type=sheep,x=${HX - 80},y=${HY - 10},z=${HZ - 80},dx=160,dy=30,dz=160]`, `kill @e[type=item,x=${HX - R},y=${HY - 5},z=${HZ - R},dx=${2 * R},dy=15,dz=${2 * R}]`)
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  bot.pathfinder.setMovements(new Movements(bot))
  CS.installCraftSync(bot, { log: () => {} })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`, `give ${NAME} minecraft:shears 1`)
  await sleep(1500)
  const fakeOut = (status, outcome, detail, extra = {}) => ({ status, outcome, detail, ...extra })
  const rec = { plot: 'cottage2', blueprint: 'cottage@2-Csg0-', structure_complete: true, cells: [] }

  // S3 first: one sheep 70 b away (beyond seeR 48): never walked to
  rcon(`summon minecraft:sheep ${HX + 70} ${HY} ${HZ} {NoAI:1b,Color:0b}`)
  await sleep(2500)
  const far = await SK._cottage2.cottageShearVisit({ bot }, rec, null, fakeOut)
  out.push({ case: 'S3', result: far, ok: far.status === 'no_effect' && /no_sheep_in_sight/.test(far.detail) && count(bot, /_wool$/) === 0 })
  P('S3', out.at(-1))
  rcon(`kill @e[type=sheep,x=${HX - 80},y=${HY - 10},z=${HZ - 80},dx=160,dy=30,dz=160]`)

  // S1 + S2: three sheep near (white, black, white), standing (NoAI: the errand's walk is the bot's, not a chase)
  rcon(`summon minecraft:sheep ${HX + 6} ${HY} ${HZ + 2} {NoAI:1b,Color:0b}`, `summon minecraft:sheep ${HX - 7} ${HY} ${HZ + 4} {NoAI:1b,Color:15b}`, `summon minecraft:sheep ${HX + 3} ${HY} ${HZ - 9} {NoAI:1b,Color:0b}`)
  await sleep(3000)
  const near = e => Math.hypot(e.position.x - HX, e.position.z - HZ) <= 12   // the summoned three (the world's own sheep graze further out)
  const sheep0 = Object.values(bot.entities).filter(e => e.name === 'sheep' && near(e))
  const before = sheep0.map(e => C.sheepWool(e.metadata))
  out.push({ case: 'S1-before', wool: before, ok: before.length === 3 && before.every(w => w && w.sheared === false) && before.map(w => w.colour).sort().join() === '0,0,15' })
  P('S1-before', out.at(-1))
  SK._cottage2.sheepInSight(bot)   // warm
  const res = await SK._cottage2.cottageShearVisit({ bot }, rec, null, fakeOut)
  await sleep(1500)
  const wool = { white: count(bot, /^white_wool$/), black: count(bot, /^black_wool$/) }
  const srv = rcon(`execute if entity @e[type=sheep,x=${HX - 30},y=${HY - 5},z=${HZ - 30},dx=60,dy=15,dz=60,nbt={Sheared:1b}] run say SHEARED_SOME`,
    `execute if entity @e[type=sheep,x=${HX - 30},y=${HY - 5},z=${HZ - 30},dx=60,dy=15,dz=60,nbt={Sheared:0b}] run say UNSHEARED_LEFT`)
  const after = Object.values(bot.entities).filter(e => e.name === 'sheep' && near(e)).map(e => C.sheepWool(e.metadata))
  out.push({ case: 'S2', result: res, wool, after, server: srv.map(r => r.reply).join(' | ').slice(0, 200), ok: res.status === 'success' && wool.white >= 2 && wool.black >= 1 && after.filter(w => w?.sheared).length === 3 && !/UNSHEARED_LEFT/.test(srv.map(r => r.reply).join(' ')) })
  P('S2', out.at(-1))
  out.push({ case: 'S1-after', ok: after.length === 3 && after.every(w => w?.sheared === true) })

  // S4: the furniture crafts -- a table beside the bot, 6 white wool + 2 spruce logs, 1 iron ingot + 2 torches
  rcon(`clear ${NAME}`, `setblock ${HX + 2} ${HY} ${HZ} minecraft:crafting_table`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`, `give ${NAME} minecraft:white_wool 6`, `give ${NAME} minecraft:spruce_log 2`, `give ${NAME} minecraft:iron_ingot 1`, `give ${NAME} minecraft:torch 2`)
  await sleep(1500)
  const cells = [{ role: 'bed', seg: 'furnish', at: [HX - 5, HY, HZ - 5], ws: { facing: 'south', part: 'foot' }, bed: 'b1' }, { role: 'bed', seg: 'furnish', at: [HX - 3, HY, HZ - 5], ws: { facing: 'south', part: 'foot' }, bed: 'b2' },
    { role: 'lamp', seg: 'furnish', at: [HX - 5, HY + 1, HZ - 7], ws: { hanging: false } }]
  const rec4 = { plot: 'cottage2', blueprint: 'cottage@2-Csg0-', style: { wood: 'spruce' }, cells }
  const pal = { bed: ['white_bed', 'black_bed'], lamp: ['lantern'] }
  const read = (x, y, z) => { const b = bot.blockAt(new (req('vec3').Vec3)(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, props: b.getProperties() } : null }
  await SK._cottage2.cottageFurnitureCrafts({ bot }, rec4, pal, read, null, async () => 0)
  const got = { white_bed: count(bot, /^white_bed$/), lantern: count(bot, /^lantern$/), white_wool: count(bot, /^white_wool$/), iron_nugget: count(bot, /^iron_nugget$/) }
  out.push({ case: 'S4', got, ok: got.white_bed === 2 && got.lantern === 1 && got.white_wool === 0 && got.iron_nugget === 1 })
  P('S4', out.at(-1))

  const file = path.join(path.dirname(new URL(import.meta.url).pathname), 'shear-e2e.jsonl')
  fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), cases: out }) + '\n')
  P(`SUMMARY ${out.filter(o => o.ok).length}/${out.length} ok`)
  bot.quit(); await sleep(500)
  rcon(`kill @e[type=sheep,x=${HX - 80},y=${HY - 10},z=${HZ - 80},dx=160,dy=30,dz=160]`, `kill @e[type=item,x=${HX - R},y=${HY - 5},z=${HZ - R},dx=${2 * R},dy=15,dz=${2 * R}]`, `setblock ${HX + 2} ${HY} ${HZ} minecraft:air`, `forceload remove ${HX - R} ${HZ - R} ${HX + R} ${HZ + R}`)
  process.exit(out.every(o => o.ok) ? 0 : 1)
}
main().catch(err => { P('FAIL', err.stack); process.exit(1) })
