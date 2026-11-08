// SANDBOX-ONLY bridges-01 proof (owner 11-08: "if a bridge is built i want it to be something really nice looking, professional and
// creative. something showcase worthy"). Paper 1.21.8 + mineflayer and the bots' own code: bots/src/bridgedesign.mjs designs and
// solves the plan, bots/src/bridge.mjs buildBridge executes it over bots/src/bridgeio.mjs (the aimed click: the yaw packet, the cursor)
// -- the code the expedition runs; the crossing walked with the bridgepost proof's walk profile (no dig, no tower, no scaffold, the
// bots' shore egress from watermoves.mjs).
//   BOT_ROOT=<checkout with bots/node_modules> SBX=sandbox7 node sandbox/bridges/design-proof.cjs [case ...]
//   (lock first: sandbox/sbxlock.sh take sandbox7 bridges "...", release after)
// Cases (style:w:nb:fb[:islets][:wood]): every one in a sealed stone shell (no way round the lake), the near shore at wy + 1 + nb, the
// far shore at wy + 1 + fb, the lake 4 deep:
//   D1  the plan solved (designPlan) and built by the bot's clicks until done (resumed after a stop, as a later trip would)
//   D2  EVERY placed cell on the server is its block IN ITS STATE (execute if block <cell> <block>[props]): each stair's facing and
//       half, each slab's type, each log's axis, each lantern's hanging -- the orientation check
//   D3  8 crossings both ways over the built bridge, each arrival dry (never in the water on the way)
//   D4  the lights: every lantern the plan kept stands
//   D5  survives 20 s at randomTickSpeed 300: every cell still there
// Plus K1: the stone parts and a lantern crafted by the bot at a table from bricks, cobbled deepslate, an iron ingot and a torch.
// Setup in the sandbox only: forceload, fill, give, tp, clear.
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
const SERVER = process.env.SBX || 'sandbox7', PORT = REG.servers[SERVER].port, NAME = 'sbx-Mason', TAG = 'bridges'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const OUT = path.join(__dirname, 'design-proof.jsonl')
const CASES = process.argv.slice(2).length ? process.argv.slice(2) : ['arch:13:0:1', 'covered:9:1:1:-:wood', 'trestle:20:0:0:7,8:wood', 'trestle:16:1:0:-:stone', 'foot:5:0:0', 'foot:4:1:2:-:wood']
const stateKey = (item, st) => `minecraft:${item}${st && Object.keys(st).length ? `[${Object.entries(st).map(([k, v]) => `${k}=${v}`).join(',')}]` : ''}`
const areBlocks = qs => {
  const out = []
  for (let i = 0; i < qs.length; i += 150) out.push(...rcon(...qs.slice(i, i + 150).map(([c, b]) => `execute if block ${c[0]} ${c[1]} ${c[2]} ${b}`)).map(q => /Test passed/.test(q.reply)))
  return out
}

async function runCase (bot, BR, BD, io, spec, X0) {
  const [style, ws, nbs, fbs, isls, mat, extra] = spec.split(':')
  const w = Number(ws), nb = Number(nbs), fb = Number(fbs), islets = isls && isls !== '-' ? isls.split(',').map(Number) : []
  const G = 140, Z0 = 6800, LX = X0 + 10, FX = LX + w, XE = FX + 10, ZA = Z0 - 9, ZB = Z0 + 9
  const R = { at: new Date().toISOString(), server: SERVER, spec }
  rcon(`forceload add ${X0 - 8} ${ZA - 8} ${XE + 8} ${ZB + 8}`)
  const bad = rcon(
    `fill ${X0 - 1} ${G - 6} ${ZA - 1} ${XE + 1} ${G + 12} ${ZB + 1} minecraft:stone hollow`,
    `fill ${X0} ${G - 5} ${ZA} ${XE} ${G + 11} ${ZB} minecraft:air`,
    `fill ${X0} ${G - 5} ${ZA} ${XE} ${G - 4} ${ZB} minecraft:stone`,
    `fill ${X0} ${G - 3} ${ZA} ${LX - 1} ${G + nb} ${ZB} minecraft:grass_block`,       // near shore: ground top G + nb (stand G + 1 + nb)
    `fill ${LX} ${G - 3} ${ZA} ${FX - 1} ${G} ${ZB} minecraft:water`,                // the lake: surface G (= wy), 4 deep
    `fill ${FX} ${G - 3} ${ZA} ${XE} ${G + fb} ${ZB} minecraft:grass_block`,
    ...islets.map(i => `fill ${LX + i} ${G - 3} ${ZA} ${LX + i} ${G} ${ZB} minecraft:grass_block`),
    // 'lump': natural ground in two of the design's own cells (a bank's dirt where the deck's sides go): the build digs it first
    ...(extra === 'lump' ? [`setblock ${LX + 1} ${G + 1} ${Z0 + 1} minecraft:dirt`, `setblock ${LX + 2} ${G + 1} ${Z0 - 1} minecraft:grass_block`] : []),
    `kill @e[type=item,x=${X0 - 4},y=${G - 8},z=${ZA - 4},dx=${XE - X0 + 8},dy=30,dz=${ZB - ZA + 8}]`).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  if (bad.length) R.setupErr = bad.map(b => b.reply.slice(0, 80))
  const NEAR = [LX - 1, G + 1 + nb, Z0]
  rcon(`tp ${NAME} ${NEAR[0] - 3 + 0.5} ${NEAR[1]} ${Z0 + 0.5}`)
  await sleep(2500)
  await bot.waitForChunksToLoad()
  const span = BD.designSpan(io.read, NEAR, [1, 0])
  R.span = { ok: span.ok, why: span.why ?? null, w: span.w, wy: span.wy, nb: span.nb, fb: span.fb, islets: span.islets }
  if (!span.ok) throw new Error('no span: ' + span.why)
  const v = BD.variantOf(style, `proof|${spec}`, { species: 'spruce', woodOk: mat === 'wood' })
  const site = { id: spec, span, design: { style, v, dv: BD.DESIGN_V } }
  const plan = BR.sitePlan(site)
  R.design = BD.designDetail(site.design); R.steps = plan.length
  if (!plan.length) throw new Error('no plan: ' + JSON.stringify(BD.designPlan(span, site.design)).slice(0, 200))
  // the kit: every item the plan places (the sandbox's give; K1 below proves the crafting)
  const bill = BD.designBill(plan)
  rcon(`clear ${NAME}`, ...Object.entries(bill).map(([n, c]) => `give ${NAME} minecraft:${n} ${c + 4}`))
  await sleep(1500)
  const runs = []
  for (let k = 0; k < 10; k++) {
    const t0 = Date.now()
    const r = await BR.buildBridge(io, plan, { until: t0 + 300000 })
    runs.push({ k, stop: r.stop, placed: r.placed, ms: Date.now() - t0, ...(r.cell ? { cell: r.cell, kind: r.kind, why: r.why } : {}), ...(r.index != null ? { index: r.index, at: plan[r.index]?.cell, kindAt: plan[r.index]?.kind } : {}) })
    P(spec, 'build', runs.at(-1))
    if (r.stop === 'done') break
    if (r.stop === 'wet') { await sleep(2000); await io.walkTo(NEAR) }
    if (/^blocked/.test(r.stop) && k >= 2) break
  }
  await sleep(800)
  const lights = plan.filter(s => s.kind === 'light')
  const solid = plan.filter(s => s.kind !== 'light')
  const onServer = areBlocks(solid.map(s => [s.cell, s.want == null ? null : stateKey(s.item, s.st)]).filter(q => q[1]))
  const anyOk = areBlocks(solid.filter(s => s.want == null).map(s => [s.cell, '#minecraft:mineable/pickaxe'])).length
  const wrong = []
  solid.filter(s => s.want != null).forEach((s, i) => { if (!onServer[i]) wrong.push({ cell: s.cell, item: s.item, st: s.st, role: s.role, read: io.read(...s.cell)?.name, props: io.read(...s.cell)?.props }) })
  R.D1 = { runs, misses: io.misses.length, missWhy: io.misses.slice(0, 6), intact: BR.bridgeIntact(io.read, plan) }
  R.D2 = { cells: onServer.length, onServer: onServer.filter(Boolean).length, oriented: solid.filter(s => s.st).length, wrong: wrong.slice(0, 8), supports: solid.filter(s => s.want == null).length, supportsChecked: anyOk }
  R.D4 = { planned: lights.length, standing: areBlocks(lights.map(s => [s.cell, stateKey('lantern', s.st)])).filter(Boolean).length }
  P(spec, 'D1', R.D1, 'D2', { ...R.D2, wrong: R.D2.wrong.length }, 'D4', R.D4)
  // D3: crossings
  io.phase = 'walk'
  R.D3 = []
  for (let i = 0; i < 8; i++) {
    const to = i % 2 === 0 ? span.land : [NEAR[0] - 2, NEAR[1], NEAR[2]]
    const w0 = io.wetWalk()
    const err = await io.walkTo(to, 40000)
    await sleep(300)
    const f = io.feet()
    R.D3.push({ i, arrived: f[0] === to[0] && f[2] === to[2], fell: io.wetWalk() > w0, err: err ?? null })
  }
  R.D3sum = { n: 8, ok: R.D3.filter(q => q.arrived && !q.fell).length }
  P(spec, 'D3', R.D3sum)
  io.phase = 'build'
  rcon('gamerule randomTickSpeed 300'); await sleep(20000); rcon('gamerule randomTickSpeed 3')
  const after = areBlocks(solid.filter(s => s.want != null).map(s => [s.cell, stateKey(s.item, s.st)]))
  R.D5 = { still: after.filter(Boolean).length, of: after.length, intact: BR.bridgeIntact(io.read, plan) }
  R.pass = { D1: R.D1.intact, D2: R.D2.onServer === R.D2.cells && R.D2.cells > 0, D3: R.D3sum.ok === 8, D4: R.D4.standing === R.D4.planned, D5: R.D5.intact && R.D5.still === R.D5.of }
  P(spec, 'PASS', R.pass)
  rcon(`forceload remove ${X0 - 8} ${ZA - 8} ${XE + 8} ${ZB + 8}`)
  return R
}

async function craftProof (bot) {
  // K1: the stone parts and a lantern from their bases at a crafting table, bare mineflayer recipes (the bots' craft resolves the
  // same recipes): stone_brick_stairs (6 -> 4), stone_brick_slab (3 -> 6), stone_brick_wall (6 -> 6), deepslate_brick_stairs,
  // cobbled_deepslate_wall, polished_deepslate (4 -> 4), iron_nugget (1 -> 9), lantern (8 nuggets + torch)
  const out = {}
  const p = bot.entity.position.floored()
  rcon(`clear ${NAME}`, `setblock ${p.x + 2} ${p.y} ${p.z} minecraft:crafting_table`, `give ${NAME} minecraft:stone_bricks 15`, `give ${NAME} minecraft:deepslate_bricks 6`, `give ${NAME} minecraft:cobbled_deepslate 10`, `give ${NAME} minecraft:iron_ingot 1`, `give ${NAME} minecraft:torch 1`)
  await sleep(1500)
  const table = bot.blockAt(new Vec3(p.x + 2, p.y, p.z))
  for (const name of ['stone_brick_stairs', 'stone_brick_slab', 'stone_brick_wall', 'deepslate_brick_stairs', 'cobbled_deepslate_wall', 'polished_deepslate', 'iron_nugget', 'lantern']) {
    const id = bot.registry.itemsByName[name].id
    const before = bot.inventory.items().filter(i => i.name === name).reduce((a, i) => a + i.count, 0)
    try {
      const r = bot.recipesFor(id, null, 1, table)[0]
      if (!r) { out[name] = 'no_recipe'; continue }
      await bot.craft(r, 1, table)
      await sleep(400)
      out[name] = bot.inventory.items().filter(i => i.name === name).reduce((a, i) => a + i.count, 0) - before
    } catch (e) { out[name] = String(e?.message ?? e).slice(0, 50) }
  }
  rcon(`setblock ${p.x + 2} ${p.y} ${p.z} minecraft:air`)
  return out
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  const BR = await import(path.resolve(BOT_ROOT, 'bots/src/bridge.mjs'))
  const BD = await import(path.resolve(BOT_ROOT, 'bots/src/bridgedesign.mjs'))
  const { bridgeIo } = await import(path.resolve(BOT_ROOT, 'bots/src/bridgeio.mjs'))
  const { installShoreEgress } = await import(path.resolve(BOT_ROOT, 'bots/src/watermoves.mjs'))
  rcon('time set 1000', 'gamerule doDaylightCycle false', 'difficulty peaceful', 'gamerule doFireTick false', 'gamerule randomTickSpeed 3')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`)
  const results = []
  try {
    const m = new Movements(bot)
    m.allowParkour = false; m.allow1by1towers = false; m.canDig = false; m.scaffoldingBlocks = []; m.placeCost = 5; m.liquidCost = 2
    m.exclusionAreasStep = [b => (b?.liquid ? 1 : 0)]; m.maxDropDown = 6
    installShoreEgress(m)
    bot.pathfinder.setMovements(m)
    let wetWalk = 0
    const shell = { phase: 'build' }
    bot.on('physicsTick', () => { if (bot.entity.isInWater && shell.phase === 'walk') wetWalk++ })
    const walkTo = async (c, ms = 30000) => { try { await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(c[0], c[1], c[2])), sleep(ms).then(() => { throw new Error('walk timeout') })]) } catch (err) { bot.pathfinder.setGoal(null); return String(err?.message ?? err).slice(0, 60) } return null }
    const misses = []
    const io0 = bridgeIo(bot, { Vec3, walkTo: async c => { await walkTo(c) }, torchOk: s => BD.lightOk(io0.read, s.cell), onPlace: (s, ok, why) => { if (!ok) misses.push({ kind: s.kind, cell: s.cell, item: s.item, why }) } })
    const io = Object.assign(io0, { misses, walkTo, wetWalk: () => wetWalk, get phase () { return shell.phase }, set phase (p) { shell.phase = p } })
    let X0 = 7000
    for (const spec of CASES) {
      try { results.push(await runCase(bot, BR, BD, io, spec, X0)) } catch (e) { P(spec, 'FATAL', e?.stack ?? String(e)); results.push({ spec, fatal: String(e?.message ?? e).slice(0, 200) }) }
      misses.length = 0
      X0 += 80
      fs.appendFileSync(OUT, JSON.stringify(results.at(-1)) + '\n')
    }
    if (!process.env.NO_K1) { const k = await craftProof(bot); P('K1', k); fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), K1: k }) + '\n') }
  } finally {
    rcon(`gamemode spectator ${NAME}`)
    bot.quit(); await sleep(500)
  }
  P('SUMMARY', results.map(r => ({ spec: r.spec, pass: r.pass ?? r.fatal })))
}
main().then(() => process.exit(0)).catch(err => { P('FATAL', err?.stack ?? String(err)); process.exit(1) })
