// SANDBOX-ONLY herd proof (villager economy design docs/reports/villagecon-2026-11-09/design.md, pens-01 / herd-01). Paper 1.21.8 +
// mineflayer 4.37.1 + mineflayer-pathfinder (the bots' Movements: canDig false, no towers). RCON builds a grass arena with a 9 x 9
// oak fence ring and a closed gate on its north wall, summons the sheep (sandbox only); every bot step is the mineflayer call a skill
// would use, and every result is read back from the SERVER (entity positions, `Sheared`, the gate's `open`, the bot's wool by `clear`).
//   BOT_ROOT=<worktree> node herd-proof.cjs [server=sandbox7] [port=25605] [parts=L,B,S]
//   L  LURE: a sheep FAR_B blocks from the pen; the bot holding wheat walks in short legs, waiting for it (<= 5 b) at each; at the
//      apron: open the gate, walk into the pen (the pathfinder through the open gate), the sheep follows in; wheat put away; out; the
//      gate closed from the apron. Twice (two adults). PASS: both sheep's positions inside the ring's floor, the gate closed.
//   B  BREED ACROSS THE FENCE: the bot at the apron holding wheat (the sheep come to the fence), activateEntity on each adult within
//      reach over the fence -> a lamb inside the ring.
//   S  SHEAR INSIDE: gate open, in, gate closed behind (from inside), shear each woolly adult, walk over the wool, gate open, out,
//      gate closed. PASS: Sheared=1b, wool in the bag (server count), every sheep still inside, the gate closed.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { pathfinder, Movements, goals } = require(require.resolve('mineflayer-pathfinder', { paths: [ROOT] }))
const { Vec3 } = require(require.resolve('vec3', { paths: [ROOT] }))
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const [SERVER = 'sandbox7', PORT = '25605', PARTS = 'L,B,S'] = process.argv.slice(2)
const FAR_B = +(process.env.FAR_B || 50)
const OUT = (process.env.FP_OUT || __dirname) + '/herd-proof.jsonl'
const NAME = 'sandbox-Herder'
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-hp-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply || ''
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const rows = []
const rec = (step, ok, ev = {}) => { const row = { step, ok: !!ok, t: +((Date.now() - T0) / 1000).toFixed(1), ...ev }; rows.push(row); P(ok ? 'PASS' : 'FAIL', step, ev) }
const A = { x0: 4800, x1: 4880, z0: 4800, z1: 4860, g: 120 }
const G = A.g
// the ring: x 4810..4818, z 4810..4818 (floor 4811..4817), the gate at (4814, 4810) facing south (into the pen)
const R = { x0: 4810, x1: 4818, z0: 4810, z1: 4818, gx: 4814, gz: 4810 }
const inPen = p => p.x > R.x0 + 0.2 && p.x < R.x1 + 0.8 && p.z > R.z0 + 0.8 && p.z < R.z1 + 0.2 && p.x >= R.x0 + 1 && p.x < R.x1 && p.z >= R.z0 + 1 && p.z < R.z1
const posOf = tag => { const m = r1(`data get entity @e[tag=${tag},limit=1] Pos`).match(/\[([-\d.]+)d?,\s*([-\d.]+)d?,\s*([-\d.]+)d?\]/); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
const gateOpen = () => /passed/.test(r1(`execute if block ${R.gx} ${G + 1} ${R.gz} minecraft:oak_fence_gate[open=true]`))
const countIn = n => +(r1(`clear ${NAME} minecraft:${n} 0`).match(/Found (\d+)/)?.[1] ?? 0)
let bot
async function equip (name) { const it = bot.inventory.items().find(i => i.name === name); if (!it) throw new Error('no ' + name); await bot.equip(it, 'hand') }
async function unequipToEmpty () { try { await bot.unequip('hand') } catch { /* empty */ } }
async function goNear (x, y, z, r = 1, ms = 20000) {
  try { await Promise.race([bot.pathfinder.goto(new goals.GoalNear(x, y, z, r)), sleep(ms).then(() => { throw new Error('goto timeout') })]) } catch (e) { bot.pathfinder.setGoal(null); return String(e.message || e) }
  return 'ok'
}
async function useGate () { await bot.lookAt(new Vec3(R.gx + 0.5, G + 1.5, R.gz + 0.5), true); await bot.activateBlock(bot.blockAt(new Vec3(R.gx, G + 1, R.gz))); await sleep(500) }
async function lureOne (tag, from) {
  const t = Date.now()
  rcon(`summon sheep ${from.x} ${G + 1} ${from.z} {Color:0b,Tags:["${tag}","hp"]}`)
  await sleep(1500)
  await equip('wheat')
  let p = posOf(tag)
  const ev = { legs: 0, waits: 0, gate: [] }
  // the approach: to within 4 b of the sheep, from the pen's side
  ev.approach = await goNear(p.x, G + 1, p.z - 3, 2)
  await sleep(2000)
  const apron = { x: R.gx + 0.5, z: R.gz - 2 }
  for (let i = 0; i < 40; i++) {
    p = posOf(tag)
    const me = bot.entity.position
    if (Math.hypot(me.x - apron.x, me.z - apron.z) < 1.5) break
    if (Math.hypot(p.x - me.x, p.z - me.z) > 5) { ev.waits++; await sleep(1500); if (Math.hypot(posOf(tag).x - me.x, posOf(tag).z - me.z) > 9) { ev.lost = true; break } continue }
    const d = Math.hypot(apron.x - me.x, apron.z - me.z), step = Math.min(5, d)
    const nx = me.x + (apron.x - me.x) / d * step, nz = me.z + (apron.z - me.z) / d * step
    await goNear(nx, G + 1, nz, 1, 8000); ev.legs++
  }
  // the gate open, the bot into the pen's middle, the sheep after it
  await useGate(); ev.gate.push(gateOpen())
  ev.enter = await goNear(R.gx + 0.5, G + 1, R.gz + 4.5, 1)
  for (let i = 0; i < 8 && !inPen(posOf(tag)); i++) await sleep(1000)
  ev.sheepIn = inPen(posOf(tag))
  // wheat away (the sheep loses interest), out through the gate, closed from the apron
  await unequipToEmpty()
  await sleep(1500)
  ev.exit = await goNear(R.gx + 0.5, G + 1, R.gz - 2, 0)
  await useGate(); ev.gate.push(gateOpen())
  await sleep(3000)
  ev.after = { sheepIn: inPen(posOf(tag)), gateOpen: gateOpen(), bot: [bot.entity.position.x.toFixed(1), bot.entity.position.z.toFixed(1)] }
  ev.s = Math.round((Date.now() - t) / 1000)
  return ev
}
async function partL () {
  const a = await lureOne('s1', { x: R.gx + 0.5, z: R.gz - FAR_B })
  rec(`L lure 1 (${FAR_B} b)`, a.after.sheepIn && !a.after.gateOpen, a)
  const b = await lureOne('s2', { x: R.gx + FAR_B * 0.6, z: R.gz - FAR_B * 0.8 })
  rec(`L lure 2 (${FAR_B} b, diagonal)`, b.after.sheepIn && !b.after.gateOpen && inPen(posOf('s1')), { ...b, s1StillIn: inPen(posOf('s1')) })
}
async function partB () {
  // run 1 11-09: across the fence the sheep never came within reach (3 b from the eye) -- 0 fed. INSIDE, as the shear: in by the gate,
  // the gate closed behind, wheat to two adults, out, closed
  const n0 = +((r1(`execute if entity @e[type=sheep,x=${R.x0},y=${G},z=${R.z0},dx=8,dy=4,dz=8]`).match(/count: (\d+)/) || [])[1] || 0)
  await unequipToEmpty()
  await goNear(R.gx + 0.5, G + 1, R.gz - 1.5, 0)
  await useGate(); const g1 = gateOpen()
  const enter = await goNear(R.gx + 0.5, G + 1, R.gz + 1.5, 0)
  await useGate(); const g2 = gateOpen()
  await equip('wheat')
  const fed = []
  for (let i = 0; i < 6 && fed.length < 2; i++) {
    const sh = Object.values(bot.entities).filter(e => e.name === 'sheep' && inPen(e.position) && e.metadata?.[16] !== true && !fed.includes(e.id))
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
    if (!sh) { await sleep(1000); continue }
    if (sh.position.distanceTo(bot.entity.position) > 2.5) await goNear(sh.position.x, G + 1, sh.position.z, 1.5, 6000)
    await bot.lookAt(sh.position.offset(0, 0.6, 0), true)
    await bot.activateEntity(sh); fed.push(sh.id); await sleep(600)
  }
  let n1 = n0; const t = Date.now()
  while (Date.now() - t < 20000 && n1 <= n0) { await sleep(1500); n1 = +((r1(`execute if entity @e[type=sheep,x=${R.x0},y=${G},z=${R.z0},dx=8,dy=4,dz=8]`).match(/count: (\d+)/) || [])[1] || 0) }
  await unequipToEmpty(); await sleep(1500)
  await goNear(R.gx + 0.5, G + 1, R.gz + 1.5, 0)
  await useGate(); const g3 = gateOpen()
  const out = await goNear(R.gx + 0.5, G + 1, R.gz - 1.5, 0)
  await useGate(); const g4 = gateOpen()
  await sleep(2000)
  const n2 = +((r1(`execute if entity @e[type=sheep,x=${R.x0},y=${G},z=${R.z0},dx=8,dy=4,dz=8]`).match(/count: (\d+)/) || [])[1] || 0)
  rec('B breed inside the pen', n1 > n0 && n2 >= n1 && !g4, { fed: fed.length, before: n0, after: n1, afterExit: n2, gate: [g1, g2, g3, g4], enter, out, s: Math.round((Date.now() - t) / 1000), wheatLeft: countIn('wheat') })
}
async function partS () {
  const wool0 = countIn('white_wool')
  await unequipToEmpty()
  await goNear(R.gx + 0.5, G + 1, R.gz - 1.5, 0)
  await useGate()
  const g1 = gateOpen()
  const enter = await goNear(R.gx + 0.5, G + 1, R.gz + 1.5, 0)
  await useGate()   // closed from inside
  const g2 = gateOpen()
  const done = []
  await equip('shears')
  for (let i = 0; i < 4; i++) {
    const sh = Object.values(bot.entities).filter(e => e.name === 'sheep' && inPen(e.position) && e.metadata?.[16] !== true && !((e.metadata?.[17] ?? 0) & 0x10) && !done.includes(e.id))
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
    if (!sh) break
    await goNear(sh.position.x, G + 1, sh.position.z, 2, 8000)
    await bot.lookAt(sh.position.offset(0, 0.6, 0), true)
    await bot.activateEntity(sh); done.push(sh.id); await sleep(700)
    await goNear(sh.position.x, G + 1, sh.position.z, 0, 6000); await sleep(1500)
  }
  await unequipToEmpty()
  await goNear(R.gx + 0.5, G + 1, R.gz + 1.5, 0)
  await useGate(); const g3 = gateOpen()
  const out = await goNear(R.gx + 0.5, G + 1, R.gz - 1.5, 0)
  await useGate(); const g4 = gateOpen()
  await sleep(2000)
  const inside = ['s1', 's2'].map(t => inPen(posOf(t)))
  const sheared = ['s1', 's2'].map(t => /1b/.test(r1(`data get entity @e[tag=${t},limit=1] Sheared`)))
  rec('S shear inside, in and out by the gate', sheared.some(Boolean) && countIn('white_wool') > wool0 && inside.every(Boolean) && !g4, { gate: [g1, g2, g3, g4], enter, out, sheared, wool: [wool0, countIn('white_wool')], inside, botIn: inPen(bot.entity.position) })
}
async function main () {
  requireSandboxLock(SERVER, 'econ')
  const dl0 = r1('gamerule doDaylightCycle')
  const r = rcon(`forceload add ${A.x0} ${A.z0 - 64} ${A.x1} ${A.z1}`, 'difficulty peaceful',
    `fill ${A.x0} ${G - 1} ${A.z0 - 64} ${A.x1} ${G - 1} ${A.z1} minecraft:stone`, `fill ${A.x0} ${G} ${A.z0 - 64} ${A.x1} ${G} ${A.z1} minecraft:grass_block`,
    ...[0, 1, 2, 3, 4].map(i => `fill ${A.x0} ${G + 1} ${A.z0 - 64 + i * 25} ${A.x1} ${G + 6} ${Math.min(A.z1, A.z0 - 64 + i * 25 + 24)} minecraft:air`),
    `kill @e[type=!player,x=${A.x0},y=${G - 5},z=${A.z0 - 64},dx=80,dy=20,dz=124]`,
    `fill ${R.x0} ${G + 1} ${R.z0} ${R.x1} ${G + 1} ${R.z0} minecraft:oak_fence`, `fill ${R.x0} ${G + 1} ${R.z1} ${R.x1} ${G + 1} ${R.z1} minecraft:oak_fence`,
    `fill ${R.x0} ${G + 1} ${R.z0} ${R.x0} ${G + 1} ${R.z1} minecraft:oak_fence`, `fill ${R.x1} ${G + 1} ${R.z0} ${R.x1} ${G + 1} ${R.z1} minecraft:oak_fence`,
    `setblock ${R.gx} ${G + 1} ${R.gz} minecraft:oak_fence_gate[facing=south,open=false]`, 'gamerule doDaylightCycle false', 'time set 6000')
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(PORT), username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${R.gx + 0.5} ${G + 1} ${R.gz - 6}`, `give ${NAME} wheat 32`, `give ${NAME} shears 1`)
  await sleep(3000)
  try { await bot.waitForChunksToLoad() } catch (e) { P('chunks', String(e)) }
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  try {
    const parts = PARTS.split(',')
    if (parts.includes('L')) await partL()
    if (parts.includes('B')) await partB()
    if (parts.includes('S')) await partS()
  } finally {
    try { bot.quit() } catch {}
    rcon(`kill @e[type=!player,x=${A.x0},y=${G - 5},z=${A.z0 - 64},dx=80,dy=20,dz=124]`, ...[0, 1, 2, 3, 4].map(i => `fill ${A.x0} ${G - 1} ${A.z0 - 64 + i * 25} ${A.x1} ${G + 6} ${Math.min(A.z1, A.z0 - 64 + i * 25 + 24)} minecraft:air`),
      `forceload remove ${A.x0} ${A.z0 - 64} ${A.x1} ${A.z1}`, `gamerule doDaylightCycle ${/false/.test(dl0) ? 'false' : 'true'}`)
    fs.appendFileSync(OUT, rows.map(x => JSON.stringify({ run: new Date(T0).toISOString(), ...x })).join('\n') + '\n')
    console.log('SUMMARY', rows.filter(x => 'ok' in x).map(x => `${x.ok ? 'PASS' : 'FAIL'} ${x.step}`).join(' | '))
  }
}
main().catch(e => { console.log('FAILED', e.stack); process.exit(1) })
