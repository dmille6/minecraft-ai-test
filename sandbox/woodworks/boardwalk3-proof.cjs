// SANDBOX-ONLY boardwalk-03 proof (owner 11-08: "replace the bots' dirt and cobble lines standing in water with plank walkways, and
// remove the stray dirt and cobble in water"). Paper 1.21.8 + mineflayer and the bots' OWN code: bots/src/boardwalk.mjs bw3Work over
// the bot's view, buildrun.mjs runVisit (`wet`, the tidy cuts in the keeper's order) and buildbot.mjs botBuildEffects (the clicks
// and digs the fleet sends). The crossings are walked by mineflayer-pathfinder with the bots' no-scaffold, no-dig walk.
//   BOT_ROOT=<checkout with bots/node_modules and the boardwalk-03 code> SBX=sandbox7 node sandbox/woodworks/boardwalk3-proof.cjs
//   (lock first: sandbox/sbxlock.sh take sandbox7 boardwalk3 "...", release after)
//   W1  a 12-wide lake in a sealed stone shell (the only dry way over is the line): a DIRT line bank to bank, listed `walk` ->
//       every cell PLANKS on the server, laid in place (dig then plank in the same cell, never two cells open)
//   W2  crossings both ways (16) over the planks, each arrival dry (never in the water on the way)
//   R1  a 6-cell dirt-and-cobble spur from the near bank, listed (not walk) -> every cell WATER on the server, dug far end first,
//       the digger never standing past its cut
//   C1  never anything unlisted: an unlisted dirt block in the lake and a listed cell now stone both still stand
//   S1  survives: 30 s with random ticks raised -- the planks stay, the dug cells stay water
// Setup in the sandbox only: forceload, fill, setblock, give, tp.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox7', PORT = REG.servers[SERVER].port, NAME = 'sbx-Deck', TAG = 'boardwalk3'
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
const areBlocks = qs => rcon(...qs.map(([c, name]) => `execute if block ${c[0]} ${c[1]} ${c[2]} minecraft:${name}`)).map(q => /Test passed/.test(q.reply))
const X0 = 7200, G = 140, Z0 = 7200, W = 12
const LX = X0 + 10, FX = LX + W, XE = FX + 8, ZA = Z0 - 8, ZB = Z0 + 8
const OUT = path.join(__dirname, 'boardwalk3-proof.jsonl')
const R = { at: new Date().toISOString(), server: SERVER, W }

async function main () {
  requireSandboxLock(SERVER, TAG)
  const BW = await import(path.resolve(BOT_ROOT, 'bots/src/boardwalk.mjs'))
  const RUN = await import(path.resolve(BOT_ROOT, 'bots/src/buildrun.mjs'))
  const PJ = await import(path.resolve(BOT_ROOT, 'bots/src/buildproj.mjs'))
  const { botBuildEffects } = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))
  rcon(`forceload add ${X0 - 8} ${ZA - 8} ${XE + 8} ${ZB + 8}`, 'time set 1000', 'gamerule doDaylightCycle false', 'difficulty peaceful', 'gamerule doFireTick false')
  const WALKZ = Z0, SPURZ = Z0 + 5, CTLZ = Z0 - 5
  R.setup = rcon(
    `fill ${X0 - 1} ${G - 6} ${ZA - 1} ${XE + 1} ${G + 6} ${ZB + 1} minecraft:stone hollow`,
    `fill ${X0} ${G - 5} ${ZA} ${XE} ${G + 5} ${ZB} minecraft:air`,
    `fill ${X0} ${G - 5} ${ZA} ${XE} ${G - 1} ${ZB} minecraft:stone`,
    `fill ${X0} ${G - 4} ${ZA} ${LX - 1} ${G} ${ZB} minecraft:grass_block`,
    `fill ${LX} ${G - 4} ${ZA} ${FX - 1} ${G} ${ZB} minecraft:water`,
    `fill ${FX} ${G - 4} ${ZA} ${XE} ${G} ${ZB} minecraft:grass_block`,
    // the bots' old lines, as the pathfinder left them: dirt at the water's level, standing in the lake
    `fill ${LX} ${G} ${WALKZ} ${FX - 1} ${G} ${WALKZ} minecraft:dirt`,
    `fill ${LX} ${G} ${SPURZ} ${LX + 2} ${G} ${SPURZ} minecraft:dirt`,
    `fill ${LX + 3} ${G} ${SPURZ} ${LX + 5} ${G} ${SPURZ} minecraft:cobblestone`,
    `setblock ${LX + 3} ${G} ${CTLZ} minecraft:dirt`,                  // C1: unlisted (natural, as far as this proof knows)
    `kill @e[type=item,x=${X0 - 4},y=${G - 8},z=${ZA - 4},dx=${XE - X0 + 8},dy=20,dz=${ZB - ZA + 8}]`).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  // the evidence as waterstrays.py writes it: the walk line, the spur, and one listed spur cell that is STONE now (C1)
  const walkCells = Array.from({ length: W }, (_, i) => [LX + i, G, WALKZ, 'dirt'])
  const spurCells = Array.from({ length: 6 }, (_, i) => [LX + i, G, SPURZ, i < 3 ? 'dirt' : 'cobblestone'])
  const changed = [LX + 6, G, SPURZ]
  rcon(`setblock ${changed.join(' ')} minecraft:stone`)
  const home = { x: X0 + 4, y: G + 1, z: Z0 }
  const doc = { v: 1, pool: 'sbx', home: [home.x, home.y, home.z], generated: new Date().toISOString(),
    lines: [{ id: 'L000', walk: true, cells: walkCells }, { id: 'L001', walk: false, cells: [...spurCells, [...changed, 'dirt']] }] }
  const ev = BW.bw3Evidence(doc, { pool: 'sbx', home })
  if (!ev.ok) throw new Error('evidence ' + ev.why)
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  let wet = 0, phase = 'build'
  const wetBy = { build: 0, walk: 0, dig: 0 }
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${home.x + 0.5} ${G + 1} ${home.z + 0.5}`, `give ${NAME} minecraft:spruce_planks 64`, `give ${NAME} minecraft:iron_shovel 1`, `give ${NAME} minecraft:iron_pickaxe 1`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    bot.on('physicsTick', () => { if (bot.entity.isInWater) { wet++; wetBy[phase]++ } })
    // the bots' walk: no digging, no towers, no scaffold (nobridge-01: never a block over water), liquids passable at a cost
    const m = new Movements(bot)
    m.allowParkour = false; m.allow1by1towers = false; m.canDig = false; m.scaffoldingBlocks = []; m.placeCost = 5; m.liquidCost = 2; m.maxDropDown = 4
    bot.pathfinder.setMovements(m)
    const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes } : null }
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    const ops = []
    const dig0 = e.dig, send0 = e.send
    e.dig = async (c, x) => { ops.push(['dig', c.join(','), e.feet()]); return dig0(c, x) }
    e.send = (s, f, q) => { ops.push(['place', s.map((v, i) => v + f[i]).join(','), e.feet()]); return send0(s, f, q) }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw3proof-'))
    const key = PJ.projKey(home, BW.BW3_PLOT)
    const runs = []
    for (let k = 0; k < 8; k++) {
      const w = BW.bw3Work(ev.lines, read)
      if (!BW.bw3HasWork(w)) break
      if (k === 0) R.work = { cuts: w.cuts.length, deck: w.record.cells.length, segs: w.record.segments.length, stats: w.stats }
      const sig = w.record.cells.map(q => q.at.join(',')).join(' ')
      PJ.publishRecord(dir, key, cur => (cur?.sig === sig ? null : { ...w.record, sig }))
      const rh = PJ.recordHead(dir, key)
      const slot = PJ.takeSlot(dir, key, NAME, 2)
      phase = w.cuts.length ? 'dig' : 'build'
      const t0 = Date.now()
      const r = await RUN.runVisit({ dir, key, me: NAME, home, stood: [], record: w.record, tidy: w.cuts, tidyKeepOrder: true, recordGen: rh.head.gen, palette: BW.BW3_PALETTE,
        slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 40, blockLayer: false, clearMax: BW.BW3.cutsPerVisit, stuckStalledOnly: true, wet: true }, e, { deadline: Date.now() + 170000, maxSteps: 300 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
      runs.push({ k, stop: r.stop, placed: r.placed, cleared: r.cleared, ms: Date.now() - t0, why: String(r.why ?? '').slice(0, 120) })
      P('visit', runs.at(-1))
    }
    await sleep(1500)
    R.runs = runs
    const deckOn = areBlocks(walkCells.map(c => [c.slice(0, 3), 'spruce_planks']))
    let inPlace = true
    for (let i = 0; i < ops.length; i++) if (ops[i][0] === 'dig' && Number(ops[i][1].split(',')[2]) === WALKZ && !(ops[i + 1]?.[0] === 'place' && ops[i + 1][1] === ops[i][1])) inPlace = false
    R.W1 = { cells: walkCells.length, planks: deckOn.filter(Boolean).length, inPlace, wetBuilding: wetBy.build }
    const spurDigs = ops.filter(o => o[0] === 'dig' && Number(o[1].split(',')[2]) === SPURZ)
    R.R1 = { cells: spurCells.length, water: areBlocks(spurCells.map(c => [c.slice(0, 3), 'water'])).filter(Boolean).length,
      order: spurDigs.map(o => Number(o[1].split(',')[0]) - LX), behindCut: spurDigs.every(o => o[2][0] < Number(o[1].split(',')[0])), wetDigging: wetBy.dig }
    R.C1 = { unlisted: areBlocks([[[LX + 3, G, CTLZ], 'dirt']])[0], changed: areBlocks([[changed, 'stone']])[0] }
    P('W1', R.W1); P('R1', R.R1); P('C1', R.C1)
    // ---- W2: crossings over the planks ----------------------------------------------------------------------------------------
    phase = 'walk'
    const near = [LX - 2, G + 1, WALKZ], far = [FX + 1, G + 1, WALKZ]
    const walkTo = async (c, ms = 30000) => { try { await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(c[0], c[1], c[2])), sleep(ms).then(() => { throw new Error('walk timeout') })]) } catch (err) { bot.pathfinder.setGoal(null); return String(err?.message ?? err).slice(0, 60) } return null }
    await walkTo(near)
    R.W2 = []
    for (let i = 0; i < 16; i++) {
      const to = i % 2 === 0 ? far : near
      const w0 = wetBy.walk
      const err = await walkTo(to, 40000)
      await sleep(300)
      const f = e.feet()
      R.W2.push({ i, arrived: f[0] === to[0] && f[2] === to[2], fell: wetBy.walk > w0, err })
    }
    R.W2sum = { n: 16, ok: R.W2.filter(q => q.arrived && !q.fell).length }
    P('W2', R.W2sum)
    // ---- S1: survives -------------------------------------------------------------------------------------------------------------
    rcon('gamerule randomTickSpeed 300'); await sleep(30000); rcon('gamerule randomTickSpeed 3')
    R.S1 = { planks: areBlocks(walkCells.map(c => [c.slice(0, 3), 'spruce_planks'])).filter(Boolean).length, water: areBlocks(spurCells.map(c => [c.slice(0, 3), 'water'])).filter(Boolean).length }
    P('S1', R.S1)
  } finally {
    R.pass = { W1: R.W1?.planks === W && R.W1?.inPlace === true, W2: R.W2sum?.ok === 16, R1: R.R1?.water === 6 && R.R1?.behindCut === true && JSON.stringify(R.R1?.order) === JSON.stringify([5, 4, 3, 2, 1, 0]),
      C1: R.C1?.unlisted === true && R.C1?.changed === true, S1: R.S1?.planks === W && R.S1?.water === 6 }
    fs.appendFileSync(OUT, JSON.stringify(R) + '\n')
    P('PASS', R.pass)
    rcon(`gamemode spectator ${NAME}`, `forceload remove ${X0 - 8} ${ZA - 8} ${XE + 8} ${ZB + 8}`)
    bot.quit(); await sleep(500)
  }
}
main().then(() => process.exit(0)).catch(err => { P('FATAL', err?.stack ?? String(err)); process.exit(1) })
