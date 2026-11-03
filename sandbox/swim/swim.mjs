// SANDBOX-ONLY expwater-01 Paper repro: does the bots' pathfinder (mineflayer-pathfinder with the walk profile's water prices from
// bots/src/index.mjs: liquidCost 2, +1 to enter water, no parkour, no towers, no bridging, maxDropDown 6, and the bots' own
// watermoves.mjs installShoreEgress) swim a 20-block lake and climb out onto a level and a one-block-up shore? Bare mineflayer plus
// that one bot module. The arena is a sealed stone shell, so the only way across is the water.
//   node swim.mjs <server> <out.jsonl> <crossings> <bots_dir> [noegress]
// RCON goes out as "@@RCON {json}" lines on stdout; replies come back on stdin (swimrelay.py).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import readline from 'node:readline'
const [SERVER, OUT, N, BOTS, NOEGRESS, FARUP = '1', WIDTH = '20'] = process.argv.slice(2)   // WIDTH: the lake's wet columns (<= 34)
const W = Math.max(1, Math.min(34, Number(WIDTH) || 20)), FAR_X0 = 910 + W   // FARUP: the far shore's stand cell this many above the near's
const require = createRequire(BOTS + '/package.json')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { installShoreEgress } = await import(BOTS + '/src/watermoves.mjs')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601 }
if (!PORTS[SERVER]) throw new Error('sandbox/sandbox2/sandbox3 only')
const NAME = 'sandbox-Swim'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => process.stderr.write(new Date().toISOString().slice(11, 23) + ' ' + a.join(' ') + '\n')
let rid = 0; const pending = new Map()
readline.createInterface({ input: process.stdin }).on('line', l => { let m; try { m = JSON.parse(l) } catch { return } const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m) } })
// the arena: x 895..945, y 30..55, z 899..917 -- every fill/setblock is checked against it
const BOX = [895, 30, 899, 945, 55, 917]
function rcon (...cmds) {
  for (const c of cmds) {
    const m = c.match(/^(fill|setblock) (-?\d+) (-?\d+) (-?\d+)(?: (-?\d+) (-?\d+) (-?\d+))?/)
    if (m) { const v = m.slice(2).filter(Boolean).map(Number); for (let i = 0; i < v.length; i += 3) if (v[i] < BOX[0] || v[i] > BOX[3] || v[i + 1] < BOX[1] || v[i + 1] > BOX[4] || v[i + 2] < BOX[2] || v[i + 2] > BOX[5]) throw new Error('outside arena: ' + c) }
  }
  return new Promise((res, rej) => { const id = ++rid; pending.set(id, m => res(m.replies)); process.stdout.write('@@RCON ' + JSON.stringify({ id, cmds }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('rcon timeout')) } }, 20000) })
}
const SCENE = [
  'forceload add 880 880 960 940',
  // a sealed stone SHELL (hollow: walls, floor and roof stone, inside air): the sandbox's own terrain and water stay out (an open
  // top let the sea above flood the first arena)
  'fill 895 30 899 945 55 917 minecraft:stone hollow',
  'fill 896 31 900 944 35 916 minecraft:stone',                 // bed
  'fill 896 36 900 909 39 916 minecraft:grass_block',           // near shore: ground top 39, stand 40 (level with the water)
  `fill 910 36 900 ${FAR_X0 - 1} 39 916 minecraft:water`,        // the lake: x 910.. (WIDTH wide), surface 39, 4 deep
  `fill ${FAR_X0} 36 900 944 ${39 + Number(FARUP)} 916 minecraft:grass_block`,   // far shore: ground top 39 + FARUP (0: level with the water, 1: one block up)
]
const NEAR = { x: 901, y: 40, z: 908 }, FAR = { x: Math.min(942, FAR_X0 + 4), y: 40 + Number(FARUP), z: 908 }
let bot
function connect () {
  return new Promise((res, rej) => {
    bot = mineflayer.createBot({ host: '127.0.0.1', port: PORTS[SERVER], username: NAME, version: '1.21.8', auth: 'offline' })
    bot.loadPlugin(pathfinder)
    bot.once('spawn', () => res()); bot.once('error', e => rej(e)); bot.on('kicked', r => log('KICKED', JSON.stringify(r)))
  })
}
function walkMoves () {
  const m = new Movements(bot)
  m.allowParkour = false; m.allow1by1towers = false; m.canDig = false; m.scaffoldingBlocks = []; m.placeCost = 5
  m.liquidCost = 2
  m.exclusionAreasStep = [b => (b?.liquid ? 1 : 0)]   // index.mjs WATER_ENTRY_COST
  m.maxDropDown = 6
  if (NOEGRESS !== 'noegress') installShoreEgress(m)
  return m
}
;(async () => {
  // the arena is built BEFORE the bot joins (a joined client's physics falls through a spectator's air while the fill runs)
  // forceload first and wait for the chunks: a fill into an unloaded chunk is refused ("not loaded") and the arena would not exist
  await rcon('difficulty peaceful', SCENE[0]); await sleep(5000)
  const built = await rcon(...SCENE.slice(1)); log('scene', JSON.stringify(built))
  if (built.some(r => !/(Successfully filled|blocks? filled|^$)/i.test(r || ''))) throw new Error('the arena was not built: ' + JSON.stringify(built))
  await sleep(3000)
  await connect(); await sleep(1500)
  await rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${NEAR.x + 0.5} ${NEAR.y} ${NEAR.z + 0.5}`, `effect give ${NAME} minecraft:instant_health 1 5 true`)
  await sleep(4000)
  const srvPos = async () => { const r = await rcon(`data get entity ${NAME} Pos`); return (r[0] || '').replace(/^.*: /, '') }
  log('start client', JSON.stringify(bot.entity.position), 'server', await srvPos(), 'below', bot.blockAt(bot.entity.position.offset(0, -1, 0))?.name)
  let deaths = 0
  bot.on('death', () => { deaths++; log('DEATH') })
  bot.pathfinder.setMovements(walkMoves())
  const n = Number(N) || 20
  for (let i = 0; i < n; i++) {
    const to = i % 2 === 0 ? FAR : NEAR
    const p0 = bot.entity.position.clone(), t0 = Date.now()
    let minOx = 20, wetMs = 0, lastT = Date.now(), maxDeep = 0, err = null, hp0 = bot.health
    const tick = () => { const now = Date.now(); if (bot.entity.isInWater) { wetMs += now - lastT; maxDeep = Math.max(maxDeep, 39.9 - bot.entity.position.y) } lastT = now; minOx = Math.min(minOx, bot.oxygenLevel ?? 20) }
    bot.on('physicsTick', tick)
    let tries = 0
    for (; tries < 2; tries++) {
      err = null
      try { await Promise.race([bot.pathfinder.goto(new goals.GoalNear(to.x, to.y, to.z, 2)), sleep(60000).then(() => { throw new Error('timeout 60s') })]) } catch (e) { err = String(e?.message ?? e).slice(0, 80); bot.pathfinder.setGoal(null) }
      if (!err) break
      await sleep(700)
    }
    bot.off('physicsTick', tick)
    await sleep(500)
    const p = bot.entity.position
    const arrived = Math.hypot(p.x - to.x - 0.5, p.z - to.z - 0.5) <= 3 && Math.abs(p.y - to.y) <= 1 && !bot.entity.isInWater
    const rec = { i, dir: to === FAR ? 'out' : 'back', arrived, ms: Date.now() - t0, from: [p0.x, p0.y, p0.z].map(v => +v.toFixed(1)), at: [p.x, p.y, p.z].map(v => +v.toFixed(1)), wetMs, minOx, maxDeep: +maxDeep.toFixed(2), hp0, hp: bot.health, err, tries: tries + (err ? 0 : 1), deaths, srv: await srvPos() }
    fs.appendFileSync(OUT, JSON.stringify(rec) + '\n'); log(JSON.stringify(rec))
    if (!arrived) { await rcon(`tp ${NAME} ${to.x + 0.5} ${to.y} ${to.z + 0.5}`); await sleep(1500) }   // the next crossing starts from the right shore
  }
  await rcon(`gamemode spectator ${NAME}`, 'forceload remove 880 880 960 940')
  bot.quit(); await sleep(500); process.exit(0)
})().catch(e => { log('FATAL', e?.stack ?? e); process.exit(1) })
