// SANDBOX-ONLY proof 2 of the MANAGED FOREST (forest-01): the moves the visit makes, with mineflayer-pathfinder (default
// Movements), on built trunks (RCON setblock on the arena only):
//   S  THE STUMP STANCE (the in-wall farm's retirement: an 8-log spruce on a FLAT plot): from the side stand the logs dy 1..6 bottom
//      up, then the bot walks onto the stump (GoalBlock over it), fells dy 7 from there, then digs the stump under its feet.
//   P  THE SUNK PLOT'S DROPS: an 8-log trunk in a sunk plot felled top down from the stand; how many logs reach the bag from the stand;
//      then the walk into the plot (GoalBlock in the hole) and back to the stand; the bag again.
//   A  THE AISLE: the stand and the aisle cells between full of leaves at feet and head; pathfinder goto the stand from 6 along the
//      aisle: does it arrive (digging the leaves) and how long.
//   BOT_ROOT=<worktree> node sandbox/forest/forest-proof2.cjs [server=sandbox4]
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs'); const path = require('path')
const sbx = require('../lib/sbxlock.cjs')
const req = n => require(require.resolve(n, { paths: [path.join(process.env.BOT_ROOT || '.', 'bots')] }))
const mineflayer = req('mineflayer'); const { Vec3 } = req('vec3')
const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
const [SERVER = 'sandbox4', SCENES = 'S,P,A,D', SETTLE = '800'] = process.argv.slice(2)
const ON = new Set(SCENES.split(','))
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const TAG = process.env.FP_TAG || 'forest01'
const OUT = process.env.FP_OUT || path.join(__dirname, 'log')
fs.mkdirSync(OUT, { recursive: true })
const RES = path.join(OUT, `forest-proof2-${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fp-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const rec = o => fs.appendFileSync(RES, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n')
const A = { x0: 2496, x1: 2584, z0: 2496, z1: 2566, F: 99 }
const isLog = (x, y, z) => /Test passed/.test(rcon(`execute if block ${x} ${y} ${z} #minecraft:logs`)[0]?.reply || '')
const logsBag = bot => bot.inventory.items().filter(i => /_log$/.test(i.name)).reduce((s, i) => s + i.count, 0)
const goto = async (bot, g, ms = 15000) => { try { await Promise.race([bot.pathfinder.goto(g), sleep(ms).then(() => { throw new Error('timeout') })]); return 'ok' } catch (e) { try { bot.pathfinder.setGoal(null) } catch {} return String(e?.message || e).slice(0, 60) } }
const feet = bot => { const p = bot.entity.position; return [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)] }
async function digAt (bot, x, y, z) { const b = bot.blockAt(new Vec3(x, y, z)); if (!b || b.name === 'air') return 'air'; if (!bot.canDigBlock(b)) return 'cannot'; try { await Promise.race([bot.dig(b, true), sleep(8000).then(() => { throw new Error('timeout') })]); return 'ok' } catch (e) { return String(e?.message || e).slice(0, 40) } }
function trunk (x, z, y0, n, leaves = true) {
  const c = []
  for (let k = 0; k < n; k++) c.push(`setblock ${x} ${y0 + k} ${z} minecraft:spruce_log`)
  if (leaves) for (let y = y0 + 2; y <= y0 + n; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if ((dx || dz) && Math.abs(dx) + Math.abs(dz) <= 3) c.push(`setblock ${x + dx} ${y} ${z + dz} minecraft:spruce_leaves[persistent=true] keep`)
  c.push(`setblock ${x} ${y0 + n} ${z} minecraft:spruce_leaves[persistent=true]`)
  return c
}
async function main () {
  P('lock', sbx.requireSandboxLock(SERVER, TAG))
  const c = [`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`]
  for (let y = 136; y >= 100; y -= 4) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y + 3} ${A.z1} minecraft:air`)
  c.push(`fill ${A.x0} 95 ${A.z0} ${A.x1} 95 ${A.z1} minecraft:stone`, `fill ${A.x0} 96 ${A.z0} ${A.x1} 98 ${A.z1} minecraft:dirt`,
    `fill ${A.x0} 99 ${A.z0} ${A.x1} 99 ${A.z1} minecraft:grass_block`, `kill @e[type=item,x=${A.x0},y=80,z=${A.z0},dx=90,dy=60,dz=72]`)
  rcon(...c)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: 'sandbox-Forest', auth: 'offline' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); bot.pathfinder.setMovements(mv)
  rcon('gamemode survival sandbox-Forest', 'clear sandbox-Forest', 'give sandbox-Forest minecraft:iron_axe 1', 'gamerule randomTickSpeed 0', 'gamerule doDaylightCycle false', 'time set 6000', 'effect give sandbox-Forest minecraft:saturation 99999 1 true')
  // ---- S: three 8-log trunks on FLAT plots (logs F+1..F+8); the stand at +z
  for (const [i, x] of (ON.has('S') ? [2510, 2515, 2520, 2525, 2530, 2535] : []).entries()) {
    const z = 2510, y0 = A.F + 1
    rcon(...trunk(x, z, y0, 8))
    rcon(`setblock ${x} ${y0} ${z + 1} minecraft:air`, `setblock ${x} ${y0 + 1} ${z + 1} minecraft:air`, `setblock ${x} ${y0 + 2} ${z + 1} minecraft:air`, `tp sandbox-Forest ${x + 0.5} ${y0} ${z + 1.5}`)
    await sleep(Number(SETTLE))
    const steps = []
    for (let y = y0 + 1; y <= y0 + 6; y++) steps.push(['side', y - y0, await digAt(bot, x, y, z)])
    const g = await goto(bot, new goals.GoalBlock(x, y0 + 1, z))
    const f1 = feet(bot)
    steps.push(['onto_stump', g, f1.join(',')])
    steps.push(['from_stump', 7, await digAt(bot, x, y0 + 7, z)])
    steps.push(['stump_under', 0, await digAt(bot, x, y0, z)])
    await sleep(600)
    const left = []; for (let y = y0; y <= y0 + 8; y++) if (isLog(x, y, z)) left.push(y - y0)
    const r = { kind: 'stump_stance', i, x, z, steps, onStump: f1[0] === x && f1[2] === z && f1[1] === y0 + 1, left, feetAfter: feet(bot).join(','), bag: logsBag(bot) }
    rec(r); P('S', i, r.onStump ? 'on stump' : 'NOT on stump', 'left', left, steps.map(s => s.join(':')).join(' '))
  }
  rcon('clear sandbox-Forest', 'give sandbox-Forest minecraft:iron_axe 1')
  // ---- P: three 8-log trunks in SUNK plots (logs F..F+7), felled top down from the stand, then into the hole and back
  for (const [i, x] of (ON.has('P') ? [2510, 2520, 2530] : []).entries()) {
    const z = 2530, y0 = A.F
    rcon(`setblock ${x} ${y0} ${z} minecraft:air`, ...trunk(x, z, y0, 8))
    rcon(`setblock ${x} ${y0 + 1} ${z + 1} minecraft:air`, `setblock ${x} ${y0 + 2} ${z + 1} minecraft:air`, `kill @e[type=item]`, 'clear sandbox-Forest', 'give sandbox-Forest minecraft:iron_axe 1', `tp sandbox-Forest ${x + 0.5} ${y0 + 1} ${z + 1.5}`)
    await sleep(800)
    const got = []
    for (let y = y0 + 7; y >= y0; y--) got.push(await digAt(bot, x, y, z))
    await sleep(1500)
    const bagStand = logsBag(bot)
    const gIn = await goto(bot, new goals.GoalBlock(x, y0, z))
    await sleep(800)
    const bagHole = logsBag(bot)
    const inHole = feet(bot).join(',')
    const gOut = await goto(bot, new goals.GoalBlock(x, y0 + 1, z + 1))
    const r = { kind: 'sunk_drops', i, x, z, digs: got, bagStand, gIn, inHole, bagHole, gOut, feetAfter: feet(bot).join(',') }
    rec(r); P('P', i, `bag at stand ${bagStand}/8, in the hole ${bagHole}/8`, gIn, gOut, r.feetAfter)
  }
  // ---- A: the aisle full of leaves, the stand 6 along it
  for (const [i, x] of (ON.has('A') ? [2510, 2520, 2530] : []).entries()) {
    const z = 2550, y0 = A.F + 1
    rcon(`fill ${x - 6} ${y0} ${z} ${x} ${y0 + 2} ${z} minecraft:spruce_leaves[persistent=true]`, `fill ${x - 6} ${y0} ${z - 1} ${x} ${y0 + 3} ${z - 1} minecraft:spruce_leaves[persistent=true]`, `fill ${x - 6} ${y0} ${z + 1} ${x} ${y0 + 3} ${z + 1} minecraft:spruce_leaves[persistent=true]`,
      `setblock ${x - 7} ${y0} ${z} minecraft:air`, `setblock ${x - 7} ${y0 + 1} ${z} minecraft:air`, `tp sandbox-Forest ${x - 6.5} ${y0} ${z + 0.5}`)
    await sleep(800)
    const t1 = Date.now()
    const g = await goto(bot, new goals.GoalBlock(x, y0, z), 30000)
    const f = feet(bot)
    const r = { kind: 'aisle', i, x, z, goto: g, arrived: f[0] === x && f[1] === y0 && f[2] === z, s: (Date.now() - t1) / 1000, feet: f.join(',') }
    rec(r); P('A', i, r.arrived ? 'arrived' : 'NOT arrived', g, `${r.s}s`)
  }
  // ---- D: SELF-SUPPLY. Six spruce saplings in a sunk row (3 apart), grown; felled top down from their stands; the leaves counted;
  // then the bot walks the aisle up and down while the leaves decay (rtick 60) and the saplings it picks up are counted
  if (!ON.has('D')) { bot.quit(); return }
  rcon('clear sandbox-Forest', 'give sandbox-Forest minecraft:iron_axe 1', 'kill @e[type=item]')
  const D = []; for (let i = 0; i < 6; i++) D.push({ x: 2540 + 3 * i, z: 2512 })
  rcon(...D.map(d => `setblock ${d.x} ${A.F} ${d.z} minecraft:spruce_sapling`), 'gamerule randomTickSpeed 200')
  const tg = Date.now()
  while (Date.now() - tg < 8 * 60000) {
    const r = rcon(...D.map(d => `execute if block ${d.x} ${A.F} ${d.z} #minecraft:saplings`))
    if (r.every(q => !/Test passed/.test(q.reply))) break
    await sleep(3000)
  }
  rcon('gamerule randomTickSpeed 0')
  const leafCount = () => { let n = 0; const q = []; for (let x = 2536; x <= 2560; x++) for (let z = 2508; z <= 2516; z++) for (let y = A.F + 1; y <= A.F + 11; y++) q.push(`execute if block ${x} ${y} ${z} #minecraft:leaves`); for (let i = 0; i < q.length; i += 500) n += rcon(...q.slice(i, i + 500)).filter(r => /Test passed/.test(r.reply)).length; return n }
  const leaves0 = leafCount()
  let felled = 0
  for (const d of D) {
    rcon(`setblock ${d.x} ${A.F + 1} ${d.z + 1} minecraft:air`, `setblock ${d.x} ${A.F + 2} ${d.z + 1} minecraft:air`, `tp sandbox-Forest ${d.x + 0.5} ${A.F + 1} ${d.z + 1.5}`)
    await sleep(600)
    for (let y = A.F + 8; y >= A.F; y--) { if (isLog(d.x, y, d.z) && (await digAt(bot, d.x, y, d.z)) === 'ok') felled++ }
  }
  rcon('gamerule randomTickSpeed 60')
  const sap0 = bot.inventory.items().filter(i => i.name === 'spruce_sapling').reduce((s, i) => s + i.count, 0)
  const tw = Date.now()
  let legs = 0
  while (Date.now() - tw < 4 * 60000) {
    await goto(bot, new goals.GoalBlock(legs % 2 ? 2540 : 2555, A.F + 1, 2513), 20000)
    legs++
  }
  rcon('gamerule randomTickSpeed 0')
  const sap1 = bot.inventory.items().filter(i => i.name === 'spruce_sapling').reduce((s, i) => s + i.count, 0)
  const leaves1 = leafCount()
  const r = { kind: 'self_supply', trees: D.length, felled, leaves0, leaves1, saplingsPicked: sap1 - sap0, perTree: (sap1 - sap0) / D.length, expectedPerTree: 0.05 * leaves0 / D.length, legs }
  rec(r); P('D', r)
  bot.quit()
}
main().catch(e => { P('ERROR', String(e?.stack || e)); rec({ kind: 'error', e: String(e?.stack || e).slice(0, 400) }) }).finally(() => {
  try { rcon('gamerule randomTickSpeed 3', 'gamerule doDaylightCycle true', `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch (e) { P('RESTORE FAILED', String(e)) }
  P('results', RES)
  setTimeout(() => process.exit(0), 1500)
})
