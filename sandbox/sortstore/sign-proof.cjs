// SANDBOX-ONLY (sandbox3): can a mineflayer 4.37 bot on Paper 1.21.8 place a WALL SIGN above a chest and set its text?
//   BOT_ROOT=<worktree> node sign-proof.cjs
// Arena (RCON edits on a floating platform, sandbox only): a 7x7 stone floor at y=120, a 3-high stone wall on its north edge,
// a chest against the wall. The bot (survival) is given oak signs, places one on the wall face above the chest, writes two
// lines; the server's own copy is read back with `data get block`. Then: the chest under the sign still opens; a BLANK sign
// (set by RCON) is re-opened for editing by a right click and written; an edit from 4+ blocks away.
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const mineflayer = require(require.resolve('mineflayer', { paths: [path.join(BOT_ROOT, 'bots')] }))
const { Vec3 } = require(require.resolve('vec3', { paths: [path.join(BOT_ROOT, 'bots')] }))
const SERVER = 'sandbox3', PORT = 25601, NAME = 'sbx-SignProof'
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 3000, Y = 120, Z = 3000
const results = {}
async function main () {
  rcon(`forceload add ${X - 8} ${Z - 8} ${X + 8} ${Z + 8}`,
    `fill ${X - 4} ${Y} ${Z - 4} ${X + 4} ${Y + 6} ${Z + 4} minecraft:air`,
    `fill ${X - 3} ${Y} ${Z - 3} ${X + 3} ${Y} ${Z + 3} minecraft:stone`,
    `fill ${X - 3} ${Y + 1} ${Z - 3} ${X + 3} ${Y + 3} ${Z - 3} minecraft:stone_bricks`,
    `setblock ${X} ${Y + 1} ${Z - 2} minecraft:chest[facing=south]`,
    `setblock ${X + 2} ${Y + 1} ${Z - 2} minecraft:chest[facing=south]`,
    `setblock ${X + 2} ${Y + 2} ${Z - 2} minecraft:oak_wall_sign[facing=south]`,
    `kill @e[type=item,x=${X - 5},y=${Y - 2},z=${Z - 5},dx=10,dy=10,dz=10]`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  const opened = []
  bot._client.on('open_sign_entity', p => { opened.push(p); P('open_sign_entity', p) })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned')
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`, `give ${NAME} minecraft:oak_sign 3`)
  await sleep(2500)
  const sign = bot.inventory.items().find(i => i.name === 'oak_sign')
  P('bag', bot.inventory.items().map(i => `${i.name}x${i.count}`))
  await bot.equip(sign, 'hand')
  // 1. place on the wall face above the chest: the wall block at (X, Y+2, Z-3), face +z
  const wall = bot.blockAt(new Vec3(X, Y + 2, Z - 3))
  const L = new Vec3(X, Y + 2, Z - 2)
  P('wall', wall?.name, 'label cell before', bot.blockAt(L)?.name)
  try { await bot.placeBlock(wall, new Vec3(0, 0, 1)); results.place = 'ok' } catch (e) { results.place = 'threw ' + e.message }
  await sleep(800)
  const sb = bot.blockAt(L)
  P('label cell after', sb?.name, sb?.getProperties?.(), 'opened events', opened.length)
  results.placedBlock = sb?.name
  results.editorOpenedOnPlace = opened.length
  bot.updateSign(sb, 'STONE\ncobble, bricks')
  await sleep(1500)
  results.serverFront1 = rcon(`data get block ${L.x} ${L.y} ${L.z} front_text`)[0].reply
  results.clientRead1 = bot.blockAt(L)?.getSignText?.()
  P('server', results.serverFront1); P('client', results.clientRead1)
  // 2. the chest under the sign opens
  try { const w = await bot.openContainer(bot.blockAt(new Vec3(X, Y + 1, Z - 2))); results.chestOpens = !!w; w.close() } catch (e) { results.chestOpens = 'threw ' + e.message }
  await sleep(500)
  // 3. a BLANK sign set by RCON: right click opens the editor again?
  const B = new Vec3(X + 2, Y + 2, Z - 2)
  const before = opened.length
  try { await bot.activateBlock(bot.blockAt(B)) } catch (e) { P('activate threw', e.message) }
  await sleep(1000)
  results.editorOpenedOnClick = opened.length - before
  bot.updateSign(bot.blockAt(B), 'WOOD\nlogs, planks')
  await sleep(1500)
  results.serverFront2 = rcon(`data get block ${B.x} ${B.y} ${B.z} front_text`)[0].reply
  // 4. an edit WITHOUT an editor (the server must refuse it): rewrite the first sign without a click
  bot.updateSign(bot.blockAt(L), 'HACKED')
  await sleep(1500)
  results.serverFront3_noEditor = rcon(`data get block ${L.x} ${L.y} ${L.z} front_text`)[0].reply
  // 5. re-edit from the far corner (4.2 blocks): click then write
  rcon(`tp ${NAME} ${X - 2.5} ${Y + 1} ${Z + 2.5}`)
  await sleep(1500)
  const b2 = opened.length
  try { await bot.activateBlock(bot.blockAt(L)) } catch (e) { P('activate far threw', e.message) }
  await sleep(1000)
  results.editorOpenedFar = opened.length - b2
  bot.updateSign(bot.blockAt(L), 'STONE\ncobble, bricks\nstone')
  await sleep(1500)
  results.serverFront4_far = rcon(`data get block ${L.x} ${L.y} ${L.z} front_text`)[0].reply
  P('RESULTS', results)
  bot.quit(); await sleep(500)
  rcon(`fill ${X - 4} ${Y} ${Z - 4} ${X + 4} ${Y + 6} ${Z + 4} minecraft:air`, `forceload remove ${X - 8} ${Z - 8} ${X + 8} ${Z + 8}`)
  process.exit(0)
}
main().catch(e => { P('FAIL', e.stack); process.exit(1) })
