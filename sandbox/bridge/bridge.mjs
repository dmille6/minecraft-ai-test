// SANDBOX-ONLY bridgepost-01 Paper proof: does the bots' bridge builder (bots/src/bridge.mjs bridgeSpan/bridgePlan/buildBridge over
// bots/src/bridgeio.mjs -- the very code the bot runs) build a walkable cobble bridge over a lake while standing on its own deck, resume
// a half-built one from the world after an interruption, and can the bots' walk profile (index.mjs prices + watermoves shore egress)
// cross it both ways without falling in? Bare mineflayer plus those bot modules. The arena is a sealed stone shell (no way round).
//   node bridge.mjs <server> <out.jsonl> <width> <far_up 0|1> <crossings> <bots_dir> [interrupt_ms] [squid]
// RCON goes out as "@@RCON {json}" lines on stdout; replies come back on stdin (bridgerelay.py). RCON builds the ARENA only (fill,
// setblock inside BOX), gives the sandbox player its cobble, and tps it to the start: never a bridge block.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import readline from 'node:readline'
const [SERVER, OUT, WIDTH = '20', FARUP = '0', N = '20', BOTS, INTERRUPT = '0', SQUID = ''] = process.argv.slice(2)
const W = Math.max(1, Math.min(32, Number(WIDTH) || 20))
const LX = 944 - 7 - W              // the lake's first column; far shore x LX+W .. 944 (7 columns), near shore 896 .. LX-1
const require = createRequire(BOTS + '/package.json')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { installShoreEgress } = await import(BOTS + '/src/watermoves.mjs')
const BR = await import(BOTS + '/src/bridge.mjs')
const { bridgeIo } = await import(BOTS + '/src/bridgeio.mjs')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601 }
if (!PORTS[SERVER]) throw new Error('sandbox/sandbox2/sandbox3 only')
const NAME = 'sandbox-Bridge'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => process.stderr.write(new Date().toISOString().slice(11, 23) + ' ' + a.join(' ') + '\n')
const rec = o => { fs.appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), W, farUp: Number(FARUP), ...o }) + '\n'); log(JSON.stringify(o)) }
let rid = 0; const pending = new Map()
readline.createInterface({ input: process.stdin }).on('line', l => { let m; try { m = JSON.parse(l) } catch { return } const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m) } })
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
  'fill 895 30 899 945 55 917 minecraft:stone hollow',
  'fill 896 31 900 944 54 916 minecraft:air',
  'fill 896 31 900 944 35 916 minecraft:stone',
  `fill 896 36 900 ${LX - 1} 39 916 minecraft:grass_block`,            // near shore: ground top 39, stand 40 (level with the water)
  `fill ${LX} 36 900 ${LX + W - 1} 39 916 minecraft:water`,             // the lake: surface 39, 4 deep
  `fill ${LX + W} 36 900 944 ${39 + Number(FARUP)} 916 minecraft:grass_block`,
]
const NEAR = [LX - 1, 40, 908]
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
  m.exclusionAreasStep = [b => (b?.liquid ? 1 : 0)]
  m.maxDropDown = 6
  installShoreEgress(m)
  return m
}
async function walkTo (c, ms = 20000) {
  try { await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(c[0], c[1], c[2])), sleep(ms).then(() => { throw new Error('walk timeout') })]) } catch (e) { bot.pathfinder.setGoal(null); return String(e?.message ?? e).slice(0, 60) }
  return null
}
;(async () => {
  await rcon('difficulty peaceful', SCENE[0]); await sleep(5000)
  const built = await rcon(...SCENE.slice(1)); log('scene', JSON.stringify(built))
  if (built.some((r, i) => !/(Successfully filled|blocks? filled|^$)/i.test(r || '') && !(i === 1 && /No blocks were filled/i.test(r || '')))) throw new Error('the arena was not built: ' + JSON.stringify(built))
  await sleep(3000)
  await connect(); await sleep(1500)
  await rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${NEAR[0] - 3 + 0.5} ${NEAR[1]} ${NEAR[2] + 0.5}`, `effect give ${NAME} minecraft:instant_health 1 5 true`,
    `give ${NAME} minecraft:cobblestone 256`, `give ${NAME} minecraft:torch 8`)
  await sleep(4000)
  let deaths = 0, wetTicks = 0, phase = 'build'
  const wet = { build: 0, walk: 0 }
  bot.on('death', () => { deaths++; log('DEATH') })
  bot.on('physicsTick', () => { if (bot.entity.isInWater) wet[phase]++ })
  bot.pathfinder.setMovements(walkMoves())
  const io0 = bridgeIo(bot, { Vec3, walkTo: async c => { await walkTo(c) }, onPlace: (s, ok, why) => { if (!ok) rec({ ev: 'place_miss', kind: s.kind, cell: s.cell, why }) } })
  // THE SITE, read from the world by the bot's own span reader
  const span = BR.bridgeSpan(io0.read, NEAR, [1, 0])
  rec({ ev: 'span', ok: span.ok, why: span.why ?? null, w: span.w, wy: span.wy, near: span.near, far: span.far, land: span.land })
  if (!span.ok) throw new Error('no span: ' + span.why)
  const plan = BR.bridgePlan(span)
  if (SQUID) await rcon(`summon minecraft:squid ${LX + 2.5} 39 908.5 {NoAI:1b,PersistenceRequired:1b}`)
  // BUILD: an interrupted first call (INTERRUPT ms), then a resumed one from what stands
  const runs = []
  for (let k = 0; k < 6; k++) {
    const t0 = Date.now()
    const until = k === 0 && Number(INTERRUPT) > 0 ? t0 + Number(INTERRUPT) : t0 + 240000
    const r = await BR.buildBridge(io0, plan, { until })
    runs.push({ k, ...r, ms: Date.now() - t0, need: BR.bridgeNeed(io0.read, plan) })
    rec({ ev: 'build', ...runs.at(-1) })
    if (r.stop === 'done') break
    if (r.stop === 'wet') { await sleep(3000); await walkTo(NEAR) }
    if (SQUID && /place_failed|blocked/.test(r.stop)) { await rcon(`kill @e[type=minecraft:squid,x=${LX},y=30,z=899,dx=40,dy=20,dz=18]`); await sleep(1000) }
  }
  const intact = BR.bridgeIntact(io0.read, plan)
  rec({ ev: 'built', intact, wet_ticks_building: wet.build, deaths, runs: runs.length, placed: runs.reduce((a, r) => a + r.placed, 0) })
  // CROSSINGS both ways over the finished bridge, the bots' walk profile
  phase = 'walk'
  const n = Number(N) || 20
  let okN = 0
  for (let i = 0; i < n; i++) {
    const to = i % 2 === 0 ? span.land : [NEAR[0] - 2, NEAR[1], NEAR[2]]
    const w0 = wet.walk, t0 = Date.now()
    const err = await walkTo(to, 40000)
    await sleep(400)
    const f = io0.feet()
    const arrived = f[0] === to[0] && f[2] === to[2] && Math.abs(f[1] - to[1]) <= 0
    const fell = wet.walk > w0
    if (arrived && !fell) okN++
    rec({ ev: 'cross', i, dir: i % 2 === 0 ? 'out' : 'back', arrived, fell, ms: Date.now() - t0, err, at: f })
  }
  rec({ ev: 'summary', intact, crossings: n, ok: okN, wet_ticks_walking: wet.walk, wet_ticks_building: wet.build, deaths })
  await rcon(`gamemode spectator ${NAME}`, 'forceload remove 880 880 960 940')
  bot.quit(); await sleep(500); process.exit(0)
})().catch(e => { log('FATAL', e?.stack ?? e); process.exit(1) })
