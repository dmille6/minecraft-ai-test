// SANDBOX-ONLY boardwalk-01 proof (owner 11-08: "wooden bridges at water edges instead of dirt bridges"). Paper 1.21.8 + mineflayer and
// the bots' own bridge builder: bots/src/bridge.mjs bridgeSpan / bridgePlan(span, { wood }) / buildBridge over bots/src/bridgeio.mjs
// (the code the expedition runs), the crossing walked with the bridgepost proof's walk profile (no dig, no tower, no scaffold, the
// bots' shore egress from watermoves.mjs).
//   BOT_ROOT=<checkout with bots/node_modules and the boardwalk-01 code> SBX=sandbox7 node sandbox/woodworks/boardwalk-proof.cjs [width]
//   (lock first: sandbox/sbxlock.sh take sandbox7 woodworks "...", release after)
//   B1  a 12-wide lake in a sealed stone shell (no way round): the span read by the bot's own reader; the wooden plan built; every deck
//       cell PLANKS and every rail a FENCE on the server; bridgeIntact over the bot's view
//   B2  crossings both ways (16), each arrival dry (never in the water on the way)
//   B3  a torch on a fence rail stands (the plan's light every 8 rows)
//   B4  survives: 30 s with random ticks raised (fire off, peaceful): every plan cell still there
// Setup in the sandbox only: forceload, fill, give, tp.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox7', PORT = REG.servers[SERVER].port, NAME = 'sbx-Plank', TAG = 'woodworks'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0].reply
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const W = Math.max(1, Math.min(32, Number(process.argv[2]) || 12))
const X0 = 6800, G = 140, Z0 = 6800        // the near shore's first column x X0 .. X0+9; the lake X0+10 .. X0+9+W; the far shore 8 beyond
const LX = X0 + 10, FX = LX + W, XE = FX + 8, ZA = Z0 - 8, ZB = Z0 + 8
const OUT = path.join(__dirname, 'boardwalk-proof.jsonl')
const R = { at: new Date().toISOString(), server: SERVER, W }
const isBlock = (x, y, z, name) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${name}`))
/** Many block checks in ONE rcon call (each ssh call blocks the event loop: 120 of them one by one let the bot's keepalive lapse). */
const areBlocks = qs => rcon(...qs.map(([c, name]) => `execute if block ${c[0]} ${c[1]} ${c[2]} minecraft:${name}`)).map(q => /Test passed/.test(q.reply))

async function main () {
  requireSandboxLock(SERVER, TAG)
  const BR = await import(path.resolve(BOT_ROOT, 'bots/src/bridge.mjs'))
  const { bridgeIo } = await import(path.resolve(BOT_ROOT, 'bots/src/bridgeio.mjs'))
  const { installShoreEgress } = await import(path.resolve(BOT_ROOT, 'bots/src/watermoves.mjs'))
  rcon(`forceload add ${X0 - 8} ${ZA - 8} ${XE + 8} ${ZB + 8}`, 'time set 1000', 'gamerule doDaylightCycle false', 'difficulty peaceful', 'gamerule doFireTick false')
  R.setup = rcon(
    `fill ${X0 - 1} ${G - 6} ${ZA - 1} ${XE + 1} ${G + 6} ${ZB + 1} minecraft:stone hollow`,
    `fill ${X0} ${G - 5} ${ZA} ${XE} ${G + 5} ${ZB} minecraft:air`,
    `fill ${X0} ${G - 5} ${ZA} ${XE} ${G - 1} ${ZB} minecraft:stone`,
    `fill ${X0} ${G - 4} ${ZA} ${LX - 1} ${G} ${ZB} minecraft:grass_block`,   // near shore: ground top G, stand G+1 (level with the water)
    `fill ${LX} ${G - 4} ${ZA} ${FX - 1} ${G} ${ZB} minecraft:water`,        // the lake: surface G, 5 deep
    `fill ${FX} ${G - 4} ${ZA} ${XE} ${G} ${ZB} minecraft:grass_block`,
    `kill @e[type=item,x=${X0 - 4},y=${G - 8},z=${ZA - 4},dx=${XE - X0 + 8},dy=20,dz=${ZB - ZA + 8}]`).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const NEAR = [LX - 1, G + 1, Z0]
  let wet = 0, phase = 'build'
  const wetBy = { build: 0, walk: 0 }
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${NEAR[0] - 3 + 0.5} ${G + 1} ${Z0 + 0.5}`, `give ${NAME} minecraft:spruce_planks 128`, `give ${NAME} minecraft:spruce_fence 64`, `give ${NAME} minecraft:torch 8`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    bot.on('physicsTick', () => { if (bot.entity.isInWater) { wet++; wetBy[phase]++ } })
    const m = new Movements(bot)
    m.allowParkour = false; m.allow1by1towers = false; m.canDig = false; m.scaffoldingBlocks = []; m.placeCost = 5; m.liquidCost = 2
    m.exclusionAreasStep = [b => (b?.liquid ? 1 : 0)]; m.maxDropDown = 6
    installShoreEgress(m)
    bot.pathfinder.setMovements(m)
    const walkTo = async (c, ms = 30000) => { try { await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(c[0], c[1], c[2])), sleep(ms).then(() => { throw new Error('walk timeout') })]) } catch (err) { bot.pathfinder.setGoal(null); return String(err?.message ?? err).slice(0, 60) } return null }
    const misses = []
    const io = bridgeIo(bot, { Vec3, walkTo: async c => { await walkTo(c) }, onPlace: (s, ok, why) => { if (!ok) misses.push({ kind: s.kind, cell: s.cell, why }) } })
    // ---- B1: the span and the wooden build ----------------------------------------------------------------------------------------
    const span = BR.bridgeSpan(io.read, NEAR, [1, 0])
    R.span = { ok: span.ok, why: span.why ?? null, w: span.w, wy: span.wy, near: span.near, land: span.land }
    if (!span.ok) throw new Error('no span: ' + span.why)
    const plan = BR.bridgePlan(span, { wood: BR.bridgeWood('spruce') })
    const runs = []
    for (let k = 0; k < 6; k++) {
      const t0 = Date.now()
      const r = await BR.buildBridge(io, plan, { until: t0 + 240000 })
      runs.push({ k, stop: r.stop, placed: r.placed, ms: Date.now() - t0 })
      P('build', runs.at(-1))
      if (r.stop === 'done') break
      if (r.stop === 'wet') { await sleep(3000); await walkTo(NEAR) }
    }
    await sleep(1000)
    const onServer = areBlocks(plan.filter(s => s.kind !== 'torch').map(s => [s.cell, s.kind === 'rail' ? 'spruce_fence' : 'spruce_planks']))
    R.B1 = { runs, misses: misses.length, cells: onServer.length, onServer: onServer.filter(Boolean).length, intact: BR.bridgeIntact(io.read, plan), wetBuilding: wetBy.build }
    P('B1', R.B1)
    // ---- B3: the torches on the fence rails -----------------------------------------------------------------------------------------
    const torches = plan.filter(s => s.kind === 'torch')
    R.B3 = { planned: torches.length, standing: areBlocks(torches.map(s => [s.cell, 'torch'])).filter(Boolean).length }
    // ---- B2: crossings ----------------------------------------------------------------------------------------------------------
    phase = 'walk'
    R.B2 = []
    for (let i = 0; i < 16; i++) {
      const to = i % 2 === 0 ? span.land : [NEAR[0] - 2, NEAR[1], NEAR[2]]
      const w0 = wetBy.walk, t0 = Date.now()
      const from = io.feet()
      let plan0 = null
      try { const r = bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalBlock(to[0], to[1], to[2]), 10000); plan0 = { status: r.status, len: r.path?.length ?? 0, visited: r.visitedNodes } } catch (e2) { plan0 = { err: String(e2).slice(0, 60) } }
      const err = await walkTo(to, 40000)
      await sleep(300)
      const f = io.feet()
      R.B2.push({ i, arrived: f[0] === to[0] && f[2] === to[2], fell: wetBy.walk > w0, err, ms: Date.now() - t0, from, at: f, plan0 })
      if (process.env.DIAG) P('cross', R.B2.at(-1))
    }
    R.B2sum = { n: 16, ok: R.B2.filter(q => q.arrived && !q.fell).length }
    P('B2', R.B2sum)
    // ---- B4: survives ------------------------------------------------------------------------------------------------------------
    rcon('gamerule randomTickSpeed 300'); await sleep(30000); rcon('gamerule randomTickSpeed 3')
    R.B4 = { stillIntact: BR.bridgeIntact(io.read, plan), onServer: areBlocks(plan.filter(s => s.kind !== 'torch').map(s => [s.cell, s.kind === 'rail' ? 'spruce_fence' : 'spruce_planks'])).filter(Boolean).length }
    P('B4', R.B4)
  } finally {
    R.pass = { B1: !!R.B1?.intact && R.B1.onServer === R.B1.cells, B2: R.B2sum?.ok === 16, B3: (R.B3?.planned ?? 0) > 0 && R.B3.standing === R.B3.planned, B4: !!R.B4?.stillIntact && R.B4.onServer === R.B1?.cells }
    fs.appendFileSync(OUT, JSON.stringify(R) + '\n')
    P('PASS', R.pass)
    rcon(`gamemode spectator ${NAME}`, `forceload remove ${X0 - 8} ${ZA - 8} ${XE + 8} ${ZB + 8}`)
    bot.quit(); await sleep(500)
  }
}
main().then(() => process.exit(0)).catch(err => { P('FATAL', err?.stack ?? String(err)); process.exit(1) })
