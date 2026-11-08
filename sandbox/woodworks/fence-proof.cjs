// SANDBOX-ONLY fences-01 proof (woodworks, owner 11-08: "fences and gates around farms, pens, path edges and the managed forest").
// Paper 1.21.8 + mineflayer and the bots' own code: the ring is SITED by bots/src/woodworks.mjs (ringTargets, ringPlan, ringRuns,
// proveFences) over the bot's view of the arena, each cell's step by buildsite.mjs stepFor, each click by buildbot.mjs botBuildEffects
// (hold, look, the aimed block_place, its acknowledgement) with townstyle.mjs orientAim's yaw for a gate -- the code the visit runs.
//   BOT_ROOT=<checkout with bots/node_modules and the fences-01 code> SBX=sandbox7 node sandbox/woodworks/fence-proof.cjs
//   (lock first: sandbox/sbxlock.sh take sandbox7 woodworks "...", release after)
// Every result is read from the SERVER: a block by `execute if block`, the bag by `clear <name> 0`.
//   F1  the ring: sited round a forest-shaped record (box 9x7, its zone box + 1, aisle ends north and south); every fence and gate
//       placed by the bots' click; each one on the server (gates: their facing in line with the fence)
//   F2  the walk: the sited ring loses no node of the town walk (proveFences' model) read again from the BUILT world
//   F3  crossings: the pathfinder (a walk profile: no dig, no tower, no scaffold) goes in and out of the ring 12 times, alternating the
//       outside goal west and east; every crossing column is an opening of the plan (never over a fence)
//   G1  a gate as the only gap of a fence line: CLOSED -- the pathfinder finds no way; OPENED (activate) -- does it walk through
//       (prismarine reports the open gate's bounding box 'block', but its type is in the pathfinder's emptyBlocks: the run decides);
//       a body walked through the open gate by hand; the gate dug (a plain gap) -- the way is found
//   K1  the kit: 6 spruce logs -> planks -> sticks -> fences (3 a craft) and a gate (1 a craft) at a table, the bag counted
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, give, tp, clear.
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
const SERVER = process.env.SBX || 'sandbox7', PORT = REG.servers[SERVER].port, NAME = 'sbx-Wood', TAG = 'woodworks'
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
const X = 6600, G = 140, Z = 6600, H = 18
const OUT = path.join(__dirname, 'fence-proof.jsonl')
const R = { at: new Date().toISOString(), server: SERVER }
const isBlock = (x, y, z, name) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${name}`))
const countIn = name => +(r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/)?.[1] ?? 0)
function arena () {
  return rcon(`fill ${X - H - 2} ${G - 3} ${Z - H - 2} ${X + H + 2} ${G + 8} ${Z + H + 2} minecraft:air`,
    `fill ${X - H - 2} ${G - 3} ${Z - H - 2} ${X + H + 2} ${G - 1} ${Z + H + 2} minecraft:dirt`,
    `fill ${X - H} ${G} ${Z - H} ${X + H} ${G} ${Z + H} minecraft:grass_block`,
    // a stone shell 4 high round the arena: no way round but through the arena
    `fill ${X - H - 1} ${G} ${Z - H - 1} ${X + H + 1} ${G + 4} ${Z + H + 1} minecraft:stone hollow`,
    `fill ${X - H} ${G + 1} ${Z - H} ${X + H} ${G + 4} ${Z + H} minecraft:air`,
    `kill @e[type=item,x=${X - H - 4},y=${G - 4},z=${Z - H - 4},dx=48,dy=20,dz=48]`).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  const W = await import(path.resolve(BOT_ROOT, 'bots/src/woodworks.mjs'))
  const { botBuildEffects } = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))
  const { stepFor } = await import(path.resolve(BOT_ROOT, 'bots/src/buildsite.mjs'))
  const { orientAim } = await import(path.resolve(BOT_ROOT, 'bots/src/townstyle.mjs'))
  rcon(`forceload add ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`, 'time set 1000', 'gamerule doDaylightCycle false', 'difficulty peaceful')
  R.setup = arena()
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X - 12 + 0.5} ${G + 1} ${Z + 0.5}`, `give ${NAME} minecraft:spruce_fence 64`, `give ${NAME} minecraft:spruce_fence_gate 8`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []; mv.allowParkour = false
    bot.pathfinder.setMovements(mv)
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    const home = { x: X - 12, y: G + 1, z: Z }
    const walkTo = async (c, ms = 30000) => { try { await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(c[0], c[1], c[2])), sleep(ms).then(() => { throw new Error('walk timeout') })]) } catch (err) { bot.pathfinder.setGoal(null); return String(err?.message ?? err).slice(0, 60) } return null }
    // ---- F1: site the ring with the bots' own code over the bot's view of the arena, then build it with the bots' click ----------
    const rec = { plot: 'forest', box: [X - 4, Z - 3, X + 4, Z + 3], level: G, axis: 'z', structure_complete: true, state: 'standing',
      zones: [{ box: [X - 5, 0, Z - 4, X + 5, 300, Z + 4], why: 'project:forest' }], aisles: [[X - 1, Z - 4, G], [X, Z - 4, G], [X - 1, Z + 4, G], [X, Z + 4, G]] }
    const [tg] = W.ringTargets([{ plot: 'forest', rec }])
    const plan = W.ringPlan(e.read, tg, home, { pathCols: new Map() })
    const runs = W.ringRuns(plan)
    const inside = (x, z) => x > X - 6 && x < X + 6 && z > Z - 5 && z < Z + 5
    const domain = (x, z) => Math.abs(x - X) <= 14 && Math.abs(z - Z) <= 14
    const pr = W.proveFences(e.read, home, runs, { walkR: 20, inside, domain })
    R.F1 = { ring: plan.ring, fences: plan.fences.length, openings: plan.openings.map(o => ({ why: o.why, cols: o.cols })), proof: pr.why, cells: pr.cells.length, dropped: pr.dropped, placed: 0, failed: [] }
    P('F1 plan', R.F1)
    const nodes = W.woodNodes(e.read, home, { walkR: 20 })
    for (const c of pr.cells) {
      const name = c.gate ? 'spruce_fence_gate' : 'spruce_fence'
      const want = c.gate ? { name, ws: { facing: c.facing } } : null
      const st = stepFor(e.read, home, c.at, W.woodNodes(e.read, home, { walkR: 20 }), domain, want)
      if (!st) { R.F1.failed.push({ at: c.at, why: 'no_step' }); continue }
      const f = e.feet()
      if (f[0] !== st.stand[0] || f[2] !== st.stand[2]) { const err = await walkTo(st.stand); if (err) P('walk', err, st.stand) }
      if (!(await e.hold(name))) { R.F1.failed.push({ at: c.at, why: 'no_item' }); continue }
      const aim = c.gate ? orientAim(name, { facing: c.facing }, st.face) : null
      await e.look(st.support, st.face, aim)
      await sleep(60)
      const seq = e.nextSeq(); e.send(st.support, st.face, seq, aim)
      const ack = await e.waitAck(seq, 3000)
      await sleep(250)
      const on = c.gate ? isBlock(...c.at, `spruce_fence_gate[facing=${c.facing}]`) : isBlock(...c.at, 'spruce_fence')
      if (on) R.F1.placed++; else R.F1.failed.push({ at: c.at, why: `not_on_server:${ack}`, gate: !!c.gate })
    }
    R.F1.allOnServer = R.F1.placed === pr.cells.length
    void nodes
    P('F1 built', { placed: R.F1.placed, of: pr.cells.length, failed: R.F1.failed })
    // ---- F2: the walk over the BUILT world loses nothing the empty arena's walk held (proveFences' model of a fence) -------------
    await sleep(1000)
    const after = W.woodNodes(e.read, home, { walkR: 20 })
    let lost = 0
    for (const [k, ys] of nodes) { if (pr.cells.some(c => `${c.at[0]},${c.at[2]}` === k)) continue; const a = after.get(k) ?? []; if (ys.some(y => !a.includes(y))) lost++ }
    R.F2 = { before: nodes.size, after: after.size, lost, insideNodes: [...after.keys()].filter(k => { const [x, z] = k.split(',').map(Number); return inside(x, z) }).length }
    P('F2', R.F2)
    // ---- F3: crossings in and out, the crossing column logged ---------------------------------------------------------------------
    const ringCols = new Set(W.ringOf(tg.box, tg.d).map(q => q.col.join(',')))
    const openCols = new Set(plan.openings.flatMap(o => o.cols.map(c => c.join(','))))
    R.F3 = []
    for (let i = 0; i < 12; i++) {
      const to = i % 2 === 0 ? [X, G + 1, Z] : (i % 4 === 1 ? [X - 12, G + 1, Z] : [X + 12, G + 1, Z + 6])
      const crossed = new Set()
      const tick = () => { const f = e.feet(); const k = `${f[0]},${f[2]}`; if (ringCols.has(k)) crossed.add(k) }
      bot.on('physicsTick', tick)
      const t0 = Date.now(); const err = await walkTo(to, 40000)
      bot.off('physicsTick', tick)
      await sleep(300)
      const f = e.feet()
      const arrived = f[0] === to[0] && f[2] === to[2]
      R.F3.push({ i, dir: i % 2 === 0 ? 'in' : 'out', arrived, err, ms: Date.now() - t0, crossed: [...crossed], viaOpening: [...crossed].every(k => openCols.has(k)) })
      P('F3', R.F3.at(-1))
    }
    R.F3sum = { n: R.F3.length, arrived: R.F3.filter(q => q.arrived).length, viaOpening: R.F3.filter(q => q.viaOpening && q.crossed.length).length }
    // ---- G1: the gate's limit ---------------------------------------------------------------------------------------------------
    R.setupG = arena()
    const LZ = Z + 6
    rcon(`fill ${X - H} ${G + 1} ${LZ} ${X + H} ${G + 1} ${LZ} minecraft:spruce_fence`, `setblock ${X} ${G + 1} ${LZ} minecraft:spruce_fence_gate[facing=north,open=false]`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`)
    await sleep(2500)
    const goal = [X, G + 1, LZ + 6]
    const tryWay = async () => { const err = await walkTo(goal, 15000); await sleep(300); const f = e.feet(); const ok = f[0] === goal[0] && f[2] === goal[2]; if (!ok) { rcon(`tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`); await sleep(1500) } return { ok, err } }
    R.G1 = { closed: await tryWay() }
    await walkTo([X, G + 1, LZ - 2], 15000); await sleep(500)
    const gb = bot.blockAt(new Vec3(X, G + 1, LZ))
    try { await bot.activateBlock(gb) } catch (err) { P('activate', String(err)) }
    await sleep(800)
    R.G1.openOnServer = isBlock(X, G + 1, LZ, 'spruce_fence_gate[open=true]')
    R.G1.openedBox = bot.blockAt(new Vec3(X, G + 1, LZ))?.boundingBox ?? null
    R.G1.open = await tryWay()
    // the open gate's BODY: walked straight through by hand (no pathfinder) -- the physics lets a body pass an open gate
    rcon(`tp ${NAME} ${X + 0.5} ${G + 1} ${LZ - 1.5} 0 0`); await sleep(1500)
    bot.setControlState('forward', true); await sleep(1600); bot.setControlState('forward', false); await sleep(400)
    R.G1.byHandThroughOpen = e.feet()[2] > LZ
    rcon(`tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`); await sleep(1500)
    rcon(`setblock ${X} ${G + 1} ${LZ} minecraft:air`); await sleep(1500)
    R.G1.gap = await tryWay()
    P('G1', R.G1)
    // ---- K1: the kit ------------------------------------------------------------------------------------------------------------
    rcon(`clear ${NAME}`, `give ${NAME} minecraft:spruce_log 6`, `setblock ${X + 2} ${G + 1} ${Z} minecraft:crafting_table`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`)
    await sleep(2500)
    const table = bot.blockAt(new Vec3(X + 2, G + 1, Z))
    const reg = bot.registry
    const craftN = async (name, n, tbl = null) => { const rs = bot.recipesFor(reg.itemsByName[name].id, null, 1, tbl); if (!rs.length) return `no_recipe:${name}`; try { await bot.craft(rs[0], n, tbl); return 'ok' } catch (err) { return String(err?.message ?? err).slice(0, 60) } }
    R.K1 = { planks: await craftN('spruce_planks', 6) }
    await sleep(500)
    R.K1.sticks = await craftN('stick', 2)
    await sleep(1500)
    // one craft at a time, the inventory given time to sync (craft sync: the next craft reads the last one's output)
    R.K1.fence = [await craftN('spruce_fence', 1, table)]
    await sleep(1500)
    R.K1.fence.push(await craftN('spruce_fence', 1, table))
    await sleep(500)
    R.K1.gate = await craftN('spruce_fence_gate', 1, table)
    await sleep(800)
    R.K1.bag = { spruce_fence: countIn('spruce_fence'), spruce_fence_gate: countIn('spruce_fence_gate'), spruce_planks: countIn('spruce_planks'), stick: countIn('stick'), spruce_log: countIn('spruce_log') }
    P('K1', R.K1)
  } finally {
    R.pass = {
      F1: !!R.F1?.allOnServer && (R.F1?.cells ?? 0) > 0,
      F2: R.F2?.lost === 0 && (R.F2?.insideNodes ?? 0) > 0,
      F3: R.F3sum?.arrived === R.F3sum?.n && R.F3?.every(q => q.viaOpening) && R.F3sum?.viaOpening >= R.F3sum?.n - 1,
      G1: R.G1 && !R.G1.closed.ok && R.G1.gap.ok,
      K1: R.K1?.bag?.spruce_fence === 3 * (R.K1?.fence ?? []).filter(v => v === 'ok').length && R.K1?.bag?.spruce_fence > 0 && R.K1?.bag?.spruce_fence_gate === 1,
    }
    fs.appendFileSync(OUT, JSON.stringify(R) + '\n')
    P('PASS', R.pass)
    rcon(`gamemode spectator ${NAME}`, `forceload remove ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`)
    bot.quit(); await sleep(500)
  }
}
main().then(() => process.exit(0)).catch(err => { P('FATAL', err?.stack ?? String(err)); process.exit(1) })
