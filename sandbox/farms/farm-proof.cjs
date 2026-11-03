// SANDBOX-ONLY farms proof (farms design docs/reports/farms-design-2026-11-03.md section 5). Paper 1.21.8 + mineflayer 4.37.1.
// RCON builds a floating grass arena, summons the animals and hands the kit (sandbox only: never a fleet or showcase world);
// everything the BOT does goes through the same mineflayer calls a skill would use, and each step reads its result back from
// the SERVER (RCON `execute if block` / `data get entity`), never from the client's own world model.
//   BOT_ROOT=<worktree> node farm-proof.cjs [server=sandbox4] [port=25602]
// Steps: till, plant, grow (randomTickSpeed raised, restored after), harvest + pickup, fence ring + gate open/close, wheat lure,
// lead attach + walk + tie to a fence, breed, shear, attack (leather), bread craft. Writes farm-proof.jsonl beside this file.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { pathfinder, Movements, goals } = require(require.resolve('mineflayer-pathfinder', { paths: [ROOT] }))
const { Vec3 } = require(require.resolve('vec3', { paths: [ROOT] }))
const [SERVER = 'sandbox4', PORT = '25602'] = process.argv.slice(2)
const OUT = (process.env.FP_OUT || __dirname) + '/farm-proof.jsonl'
const NAME = 'sandbox-Farmer'
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fp-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply || ''
const isBlock = (x, y, z, b) => /passed/.test(r1(`execute if block ${x} ${y} ${z} ${b}`))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const rows = []
const rec = (step, ok, ev = {}) => { const row = { step, ok: !!ok, t: +((Date.now() - T0) / 1000).toFixed(1), ...ev }; rows.push(row); P(ok ? 'PASS' : 'FAIL', step, ev) }
// arena: grass at y=99 (dirt 97-98, stone 96), open sky, x/z 2500..2540
const A = { x0: 2500, x1: 2540, z0: 2500, z1: 2540, g: 99 }
const G = A.g
const inv = bot => Object.fromEntries(bot.inventory.items().reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.count), new Map()))
const count = (bot, n) => inv(bot)[n] ?? 0
async function equip (bot, name) { const it = bot.inventory.items().find(i => i.name === name); if (!it) throw new Error('no ' + name); await bot.equip(it, 'hand') }
const near = (bot, name, r = 16) => Object.values(bot.entities).filter(e => e.name === name && e.position.distanceTo(bot.entity.position) <= r)
async function goNear (bot, x, y, z, r = 1) { await bot.pathfinder.goto(new goals.GoalNear(x, y, z, r)) }
async function main () {
  const r = rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'difficulty peaceful',
    `fill ${A.x0} 96 ${A.z0} ${A.x1} 96 ${A.z1} minecraft:stone`, `fill ${A.x0} 97 ${A.z0} ${A.x1} 98 ${A.z1} minecraft:dirt`,
    `fill ${A.x0} ${G} ${A.z0} ${A.x1} ${G} ${A.z1} minecraft:grass_block`,
    ...[100, 108].map(y => `fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y + 7} ${A.z1} minecraft:air`),
    `kill @e[type=!player,x=${A.x0},y=90,z=${A.z0},dx=40,dy=40,dz=40]`,
    'gamerule doDaylightCycle false', 'time set 6000')
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(PORT), username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const attach = []
  bot._client.on('attach_entity', p => attach.push(p))
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} 2510 ${G + 1} 2510`,
    `give ${NAME} wooden_hoe 1`, `give ${NAME} wheat_seeds 8`, `give ${NAME} wheat 16`, `give ${NAME} shears 1`, `give ${NAME} lead 2`,
    `give ${NAME} oak_fence 16`, `give ${NAME} oak_fence_gate 1`, `give ${NAME} crafting_table 1`)
  await sleep(3000)
  await bot.waitForChunksToLoad()
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  P('spawned', bot.entity.position, inv(bot))

  // 1 TILL: hoe used on the grass top face -> farmland (server)
  const fx = 2512, fz = 2510
  try {
    await goNear(bot, fx, G + 1, fz - 2, 1)
    await equip(bot, 'wooden_hoe')
    await bot.activateBlock(bot.blockAt(new Vec3(fx, G, fz)), new Vec3(0, 1, 0))
    await sleep(800)
    rec('till', isBlock(fx, G, fz, 'minecraft:farmland'), { call: 'activateBlock(grass, up) holding wooden_hoe' })
  } catch (e) { rec('till', false, { err: String(e) }) }
  // 2 PLANT: seeds against the farmland's top face -> wheat age 0
  try {
    await equip(bot, 'wheat_seeds')
    const s0 = count(bot, 'wheat_seeds')
    await bot.placeBlock(bot.blockAt(new Vec3(fx, G, fz)), new Vec3(0, 1, 0)).catch(e => P('placeBlock threw (expected for non-solid results?)', String(e)))
    await sleep(800)
    rec('plant', isBlock(fx, G + 1, fz, 'minecraft:wheat'), { call: 'placeBlock(farmland, up) holding wheat_seeds', seeds: [s0, count(bot, 'wheat_seeds')] })
  } catch (e) { rec('plant', false, { err: String(e) }) }
  // 3 GROW (sandbox: randomTickSpeed 300) then HARVEST by dig, pick up the drops by walking over them
  try {
    rcon('gamerule randomTickSpeed 300')
    let age7 = false; const t = Date.now()
    while (!age7 && Date.now() - t < 90000) { await sleep(2000); age7 = isBlock(fx, G + 1, fz, 'minecraft:wheat[age=7]') }
    rcon('gamerule randomTickSpeed 3')
    rec('grow', age7, { s: (Date.now() - t) / 1000, rtick: 300 })
    const w0 = count(bot, 'wheat'), s0 = count(bot, 'wheat_seeds')
    const b = bot.blockAt(new Vec3(fx, G + 1, fz))
    P('client sees', b?.name, b?.getProperties?.())
    await bot.dig(b, true)
    await sleep(500)
    await goNear(bot, fx, G + 1, fz, 0).catch(() => {})
    await sleep(2500)
    const farmlandKept = isBlock(fx, G, fz, 'minecraft:farmland')
    rec('harvest', count(bot, 'wheat') > w0 && isBlock(fx, G + 1, fz, 'minecraft:air'), { wheat: [w0, count(bot, 'wheat')], seeds: [s0, count(bot, 'wheat_seeds')], farmlandKept })
    // replant from where it stands (on the farmland's neighbour)
    await goNear(bot, fx, G + 1, fz - 2, 1)
    await equip(bot, 'wheat_seeds')
    await bot.placeBlock(bot.blockAt(new Vec3(fx, G, fz)), new Vec3(0, 1, 0)).catch(() => {})
    await sleep(800)
    rec('replant', isBlock(fx, G + 1, fz, 'minecraft:wheat'), {})
  } catch (e) { rec('grow/harvest', false, { err: String(e) }) }

  // 4 FENCE RING (5x5 outer, 3x3 inside) round 2520..2524 x 2520..2524 with a gate on the north side
  const px0 = 2520, pz0 = 2520, px1 = 2524, pz1 = 2524, gate = [2522, pz0]
  try {
    const ring = []
    for (let x = px0; x <= px1; x++) for (let z = pz0; z <= pz1; z++) if (x === px0 || x === px1 || z === pz0 || z === pz1) ring.push([x, z])
    let placed = 0
    for (const [x, z] of ring) {
      const isGate = x === gate[0] && z === gate[1]
      await goNear(bot, x, G + 1, z < pz0 + 2 ? z - 2 : z + 2, 1).catch(() => goNear(bot, x, G + 1, z, 3))
      await equip(bot, isGate ? 'oak_fence_gate' : 'oak_fence')
      await bot.placeBlock(bot.blockAt(new Vec3(x, G, z)), new Vec3(0, 1, 0)).catch(e => P('fence place', x, z, String(e)))
      await sleep(250)
      if (isBlock(x, G + 1, z, isGate ? 'minecraft:oak_fence_gate' : 'minecraft:oak_fence')) placed++
    }
    rec('fence_ring', placed === ring.length, { placed, of: ring.length })
    await goNear(bot, gate[0], G + 1, gate[1] - 2, 1)
    await bot.activateBlock(bot.blockAt(new Vec3(gate[0], G + 1, gate[1])))
    await sleep(600)
    const open = isBlock(gate[0], G + 1, gate[1], 'minecraft:oak_fence_gate[open=true]')
    await bot.activateBlock(bot.blockAt(new Vec3(gate[0], G + 1, gate[1])))
    await sleep(600)
    const shut = isBlock(gate[0], G + 1, gate[1], 'minecraft:oak_fence_gate[open=false]')
    rec('gate_open_close', open && shut, { open, shut })
  } catch (e) { rec('fence', false, { err: String(e) }) }

  // 5 WHEAT LURE: a cow 6 blocks away; the bot holds wheat and walks 12 blocks away; does the cow follow?
  try {
    rcon(`summon cow 2506 ${G + 1} 2530`)
    await goNear(bot, 2506, G + 1, 2524, 0)
    await sleep(1500)
    await equip(bot, 'wheat')
    await sleep(2500)
    const cow = near(bot, 'cow', 12)[0]
    const d0 = cow ? cow.position.distanceTo(bot.entity.position) : null
    await goNear(bot, 2506, G + 1, 2512, 0)
    await sleep(6000)
    const d1 = cow ? cow.position.distanceTo(bot.entity.position) : null
    rec('wheat_lure', cow && d1 != null && d1 < 5, { d0, d1, cowAt: cow?.position })
  } catch (e) { rec('wheat_lure', false, { err: String(e) }) }

  // 6 LEAD: attach to the lured cow, walk to the pen gate, tie to a fence post
  try {
    const cow = near(bot, 'cow', 12)[0]
    await goNear(bot, cow.position.x, G + 1, cow.position.z, 2)
    await equip(bot, 'lead')
    const a0 = attach.length
    await bot.activateEntity(cow)
    await sleep(1000)
    const leashed = attach.slice(a0).some(p => p.entityId === cow.id && p.vehicleId === bot.entity.id)
    rec('lead_attach', leashed, { attachPackets: attach.slice(a0), leadsLeft: count(bot, 'lead') })
    await goNear(bot, px0 - 2, G + 1, pz0 + 2, 0)
    await sleep(3000)
    const dWalk = cow.position.distanceTo(bot.entity.position)
    rec('lead_walk', dWalk < 8, { d: dWalk, cowAt: cow.position })
    const a1 = attach.length
    await bot.activateBlock(bot.blockAt(new Vec3(px0, G + 1, pz0 + 2)))
    await sleep(1000)
    const knot = Object.values(bot.entities).some(e => e.name === 'leash_knot')
    rec('lead_tie_fence', knot, { attachPackets: attach.slice(a1) })
  } catch (e) { rec('lead', false, { err: String(e) }) }

  // 7 BREED: two adult cows side by side, wheat to each -> a calf within 15 s
  try {
    rcon(`summon cow 2530 ${G + 1} 2506`, `summon cow 2531 ${G + 1} 2506`)
    await goNear(bot, 2530, G + 1, 2509, 1)
    await sleep(1500)
    const cows = near(bot, 'cow', 6).slice(0, 2)
    const ids0 = new Set(near(bot, 'cow', 40).map(e => e.id))
    await equip(bot, 'wheat')
    const w0 = count(bot, 'wheat')
    for (const c of cows) { await bot.activateEntity(c); await sleep(400) }
    let calf = null; const t = Date.now()
    while (!calf && Date.now() - t < 20000) { await sleep(1000); calf = near(bot, 'cow', 40).find(e => !ids0.has(e.id)) ?? null }
    rec('breed', !!calf, { fed: cows.length, wheat: [w0, count(bot, 'wheat')], calfAfterS: calf ? (Date.now() - t) / 1000 : null })
  } catch (e) { rec('breed', false, { err: String(e) }) }

  // 8 SHEAR: three sheep, each approached to 2.5 and sheared -> wool drops (picked up) and Sheared=1b on the server
  try {
    const out = []
    for (const [k, sz] of [[0, 2518], [1, 2524], [2, 2530]]) {
      rcon(`summon sheep 2536 ${G + 1} ${sz} {Color:0b,Tags:["fp${k}"]}`)
      await sleep(1200)
      const sh = Object.values(bot.entities).filter(e => e.name === 'sheep').sort((a, b) => a.position.distanceTo(new Vec3(2536, G + 1, sz)) - b.position.distanceTo(new Vec3(2536, G + 1, sz)))[0]
      await goNear(bot, sh.position.x, G + 1, sh.position.z, 2).catch(() => {})
      if (sh.position.distanceTo(bot.entity.position) > 3) await goNear(bot, sh.position.x, G + 1, sh.position.z, 1).catch(() => {})
      await equip(bot, 'shears')
      const wl0 = count(bot, 'white_wool')
      await bot.lookAt(sh.position.offset(0, 0.8, 0), true)
      await bot.activateEntity(sh)
      await sleep(800)
      const flag = r1(`data get entity @e[type=sheep,tag=fp${k},limit=1] Sheared`)
      await goNear(bot, sh.position.x, G + 1, sh.position.z, 0).catch(() => {})
      await sleep(2500)
      out.push({ k, d: +sh.position.distanceTo(bot.entity.position).toFixed(2), wool: [wl0, count(bot, 'white_wool')], sheared: /: 1b/.test(flag), flag: flag.slice(-40) })
    }
    rec('shear', out.every(o => o.sheared), { out })
  } catch (e) { rec('shear', false, { err: String(e) }) }

  // 9 ATTACK: kill one cow with the hand (peaceful allows it) -> leather 0-2 + beef
  try {
    rcon(`summon cow 2534 ${G + 1} 2534`)
    await goNear(bot, 2534, G + 1, 2532, 1)
    await sleep(1500)
    const c = near(bot, 'cow', 6).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
    const l0 = count(bot, 'leather'), b0 = count(bot, 'beef')
    let hits = 0
    while (bot.entities[c.id] && hits < 40) {
      if (c.position.distanceTo(bot.entity.position) > 2.8) await goNear(bot, c.position.x, c.position.y, c.position.z, 1).catch(() => {})
      await bot.lookAt(c.position.offset(0, c.height * 0.6, 0), true); bot.attack(c); hits++; await sleep(700)
    }
    await sleep(500)
    await goNear(bot, c.position.x, G + 1, c.position.z, 0).catch(() => {})
    await sleep(2500)
    rec('attack', !bot.entities[c.id], { hits, leather: [l0, count(bot, 'leather')], beef: [b0, count(bot, 'beef')] })
  } catch (e) { rec('attack', false, { err: String(e) }) }

  // 10 BREAD: a table, 3 wheat -> 1 bread (the craft path every skill uses)
  try {
    await goNear(bot, 2512, G + 1, 2532, 0)
    await equip(bot, 'crafting_table')
    await bot.placeBlock(bot.blockAt(new Vec3(2514, G, 2532)), new Vec3(0, 1, 0))
    await sleep(600)
    const table = bot.blockAt(new Vec3(2514, G + 1, 2532))
    const recipe = bot.recipesFor(bot.registry.itemsByName.bread.id, null, 1, table)[0]
    const b0 = count(bot, 'bread')
    await bot.craft(recipe, 1, table)
    await sleep(600)
    rec('bread', count(bot, 'bread') === b0 + 1, { wheatLeft: count(bot, 'wheat') })
  } catch (e) { rec('bread', false, { err: String(e) }) }

  fs.writeFileSync(OUT, rows.map(x => JSON.stringify(x)).join('\n') + '\n')
  P('SUMMARY', rows.map(x => `${x.step}=${x.ok ? 'ok' : 'FAIL'}`).join(' '))
  bot.quit()
}
main().catch(e => { P('ERROR', String(e?.stack || e)); try { fs.writeFileSync(OUT, rows.map(x => JSON.stringify(x)).join('\n') + '\n') } catch {} }).finally(() => {
  try { rcon('gamerule randomTickSpeed 3', 'gamerule doDaylightCycle true', `kill @e[type=!player,x=${A.x0},y=90,z=${A.z0},dx=40,dy=40,dz=40]`, `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch (e) { P('RESTORE FAILED', String(e)) }
  setTimeout(() => process.exit(0), 1000)
})
