// SANDBOX-ONLY villager feeding proof (villager economy design docs/reports/villagecon-2026-11-09/design.md). Paper 1.21.8 +
// mineflayer 4.37.1. RCON builds glass pens, summons jobless villagers and hands the bread (sandbox only); every FEED is the bot's
// own bot.toss of ONE loaf while looking at a villager's feet, and every result is read back from the SERVER (`data get entity
// ... Inventory`, entity counts), with the client's `playerCollect` packet logged beside it (collector = the villager's id).
//   BOT_ROOT=<worktree> node feed-proof.cjs [server=sandbox7] [port=25605] [parts=D,P,B,N]
// THE SUMMONS CARRY CanPickUpLoot:1b. MEASURED 11-09: `summon villager ~ ~ ~ {nbt}` skips finalizeSpawn, so a summoned villager
// has CanPickUpLoot 0b and NEVER picks anything up (the market proof's 11-06 "tossed bread not picked up" was this); every one of
// the showcase world's 63 real villagers has CanPickUpLoot 1b (region copy 11-09). pickup-debug.cjs shows the flip: 0b -> no pickup
// in 18 s beside the loaf; 1b -> picked up within 6 s (`playerCollect` collector = the villager).
// Parts:
//   D  DISTANCE: one villager, the bot 1.5 / 3 / 5 / 7 b away, one loaf tossed -> picked up? by whom? in how long?
//   P  PENNED: one villager inside a 2x1 ring of OPEN spruce trapdoors (the showcase 6_1 shape), the bot outside at 2 b -> pickup?
//   B  BREED: two jobless adults, 3 free beds, the bot tosses 3 loaves to each (one at a time, at 1.5 b) -> a baby?
//   N  NO-BED CONTROL: the same two fed adults with every bed removed -> no baby in the same wait.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { Vec3 } = require(require.resolve('vec3', { paths: [ROOT] }))
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const [SERVER = 'sandbox7', PORT = '25605', PARTS = 'D,P,B,N'] = process.argv.slice(2)
const TAG = 'econ'
const OUT = (process.env.FP_OUT || __dirname) + '/feed-proof.jsonl'
const NAME = 'sandbox-Baker'
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fp-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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
const A = { x0: 4200, x1: 4260, z0: 4200, z1: 4260, g: 120 }
const G = A.g
async function waitFor (fn, ms, step = 1000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step) } return null }
const breadIn = tag => { const s = r1(`data get entity @e[type=villager,tag=${tag},limit=1] Inventory`); const m = s.match(/count:\s*(\d+)[^}]*id:\s*"minecraft:bread"|id:\s*"minecraft:bread"[^}]*count:\s*(\d+)/); return m ? +(m[1] || m[2]) : (/minecraft:bread/.test(s) ? 1 : 0) }
const villagersIn = (x, z, r) => +((r1(`execute if entity @e[type=villager,x=${x - r},y=${G - 2},z=${z - r},dx=${2 * r},dy=8,dz=${2 * r}]`).match(/(\d+)/) || [])[1] || 0)
const babiesIn = (x, z, r) => +((r1(`execute if entity @e[type=villager,x=${x - r},y=${G - 2},z=${z - r},dx=${2 * r},dy=8,dz=${2 * r},nbt={Age:-24000}]`).match(/(\d+)/) || [])[1] || 0)
let bot
const collects = []
async function tossOne (target) {
  const e = Object.values(bot.entities).find(x => x.name === 'villager' && x.position.distanceTo(target) < 2)
  const at = e ? e.position : target
  await bot.lookAt(new Vec3(at.x, at.y + 0.2, at.z), true)
  const b = bot.inventory.items().find(i => i.name === 'bread')
  if (!b) throw new Error('no bread')
  await bot.toss(b.type, null, 1)
  return e?.id ?? null
}
function pen (cx, cz, r, extra = []) {
  return rcon(`fill ${cx - r - 1} ${G} ${cz - r - 1} ${cx + r + 1} ${G + 4} ${cz + r + 1} minecraft:glass`,
    `fill ${cx - r} ${G + 1} ${cz - r} ${cx + r} ${G + 4} ${cz + r} minecraft:air`, ...extra)
}
async function partD () {
  for (const d of [1.5, 3, 5, 7]) {
    const cx = 4210 + Math.round(d * 4), cz = 4210
    pen(cx, cz, 9)
    rcon(`kill @e[type=villager,tag=fd]`, `kill @e[type=item,x=${cx - 10},y=${G},z=${cz - 10},dx=20,dy=6,dz=20]`,
      `summon villager ${cx + 0.5} ${G + 1} ${cz + 0.5} {CanPickUpLoot:1b,Tags:["fd"],NoAI:0b,VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
      `tp ${NAME} ${cx + 0.5 - d} ${G + 1} ${cz + 0.5} -90 20`, `clear ${NAME}`, `give ${NAME} minecraft:bread 4`, 'time set 6000')
    await sleep(2500)
    const c0 = collects.length
    let vid = null
    try { vid = await tossOne(new Vec3(cx + 0.5, G + 1, cz + 0.5)) } catch (err) { rec(`D toss ${d}`, false, { err: String(err) }); continue }
    const got = await waitFor(() => breadIn('fd') > 0, 30000, 1500)
    const mine = collects.slice(c0).filter(c => c.item === 'bread')
    const left = +((r1(`execute if entity @e[type=item,x=${cx - 10},y=${G},z=${cz - 10},dx=20,dy=6,dz=20]`).match(/(\d+)/) || [])[1] || 0)
    rec(`D distance ${d}`, !!got, { villagerBread: breadIn('fd'), collectPackets: mine.map(c => ({ byVillager: c.collector === vid, collector: c.collectorName })), itemsLeft: left })
  }
  rcon('kill @e[type=villager,tag=fd]')
}
async function partP () {
  const cx = 4240, cz = 4210
  pen(cx, cz, 6)
  // a 2x1 ring of OPEN bottom trapdoors round two cells (the 6_1 house ring's shape): cells (cx,cz) and (cx+1,cz)
  const td = (x, z, f) => `setblock ${x} ${G + 1} ${z} minecraft:spruce_trapdoor[facing=${f},half=bottom,open=true]`
  rcon(`kill @e[type=villager,tag=fp]`,
    td(cx - 1, cz, 'west'), td(cx + 2, cz, 'east'), td(cx, cz - 1, 'north'), td(cx + 1, cz - 1, 'north'), td(cx, cz + 1, 'south'), td(cx + 1, cz + 1, 'south'),
    `summon villager ${cx + 0.5} ${G + 1} ${cz + 0.5} {CanPickUpLoot:1b,Tags:["fp"],VillagerData:{profession:"minecraft:none",level:1,type:"plains"}}`,
    `tp ${NAME} ${cx + 0.5} ${G + 1} ${cz + 3.5} 180 20`, `clear ${NAME}`, `give ${NAME} minecraft:bread 4`, 'time set 6000')
  await sleep(3000)
  const c0 = collects.length
  let vid = null
  try { vid = await tossOne(new Vec3(cx + 0.5, G + 1, cz + 0.5)) } catch (err) { rec('P toss', false, { err: String(err) }); return }
  const got = await waitFor(() => breadIn('fp') > 0, 30000, 1500)
  rec('P penned (trapdoor ring, bot 3 b outside)', !!got, { villagerBread: breadIn('fp'), collectPackets: collects.slice(c0).filter(c => c.item === 'bread').map(c => ({ byVillager: c.collector === vid })) })
  rcon('kill @e[type=villager,tag=fp]', `fill ${cx - 2} ${G + 1} ${cz - 2} ${cx + 3} ${G + 1} ${cz + 2} minecraft:air`)
}
async function breedRun (label, beds) {
  const cx = 4220, cz = 4240
  const extra = beds ? [[cx - 4, 'red'], [cx, 'white'], [cx + 4, 'blue']].flatMap(([x, c]) => [
    `setblock ${x} ${G + 1} ${cz - 5} minecraft:${c}_bed[facing=south,part=foot]`, `setblock ${x} ${G + 1} ${cz - 4} minecraft:${c}_bed[facing=south,part=head]`]) : []
  pen(cx, cz, 6, extra)
  rcon(`kill @e[type=villager,tag=fb]`, `kill @e[type=item,x=${cx - 7},y=${G},z=${cz - 7},dx=14,dy=6,dz=14]`,
    `summon villager ${cx - 1.5} ${G + 1} ${cz + 2.5} {CanPickUpLoot:1b,Tags:["fb","fb1"],VillagerData:{profession:"minecraft:none",level:1,type:"plains"}}`,
    `summon villager ${cx + 2.5} ${G + 1} ${cz + 2.5} {CanPickUpLoot:1b,Tags:["fb","fb2"],VillagerData:{profession:"minecraft:none",level:1,type:"plains"}}`,
    `tp ${NAME} ${cx + 0.5} ${G + 1} ${cz + 4.5}`, `clear ${NAME}`, `give ${NAME} minecraft:bread 6`, 'time set 6000')
  // a glass wall between the two while they are fed (the breed run 11-09 13:20Z: one villager walked to and took 10 of 10 loaves meant for
  // both, so neither pair member alone could show the breeding); the wall goes once each has collected 3
  rcon(`fill ${cx + 1} ${G + 1} ${cz - 3} ${cx + 1} ${G + 4} ${cz + 6} minecraft:glass`)   // x = cx + 1, z from cz - 3: clear of the beds (run 2's wall at x = cx replaced the middle bed: 2 beds for 2 adults, none vacant)
  await sleep(3000)
  const before = villagersIn(cx, cz, 6)
  const c0 = collects.length
  // THE SKILL'S RULE: a loaf counts for the villager whose `playerCollect` took it (another one may grab it first); toss to each
  // target until IT has collected 3 (at most 8 tosses a target)
  const got = {}
  for (const tag of ['fb1', 'fb2']) {
    for (let i = 0; i < 8; i++) {
      const pos = r1(`data get entity @e[type=villager,tag=${tag},limit=1] Pos`).match(/\[([-\d.]+)d?,\s*([-\d.]+)d?,\s*([-\d.]+)d?\]/)
      if (!pos) break
      const v = new Vec3(+pos[1], +pos[2], +pos[3])
      const tid = Object.values(bot.entities).filter(x => x.name === 'villager').sort((a, b) => a.position.distanceTo(v) - b.position.distanceTo(v))[0]?.id
      if (tid != null && (got[tid] ?? 0) >= 3) break
      rcon(`tp ${NAME} ${v.x} ${G + 1} ${v.z + 1.5} 180 20`)
      await sleep(800)
      const n0 = collects.length
      if (!bot.inventory.items().some(i => i.name === 'bread')) rcon(`give ${NAME} minecraft:bread 4`)
      await sleep(300)
      try { await tossOne(v) } catch (err) { rec(`${label} toss`, false, { err: String(err) }) }
      await waitFor(() => collects.length > n0, 6000, 300)
      for (const c of collects.slice(n0)) if (c.item === 'bread') got[c.collector] = (got[c.collector] ?? 0) + 1
    }
  }
  const fed = { fb1: breadIn('fb1'), fb2: breadIn('fb2') }
  rcon(`fill ${cx + 1} ${G + 1} ${cz - 3} ${cx + 1} ${G + 4} ${cz + 6} minecraft:air`)
  rcon(`tp ${NAME} ${cx + 0.5} ${G + 1} ${cz - 8.5}`)   // out of the pen (glass between)
  const baby = await waitFor(() => villagersIn(cx, cz, 6) > before, +(process.env.BREED_MS || 900000), 5000)   // the market proof's NBT-fed pair: a baby at ~8 min
  rec(`${label} (${beds ? '3 free beds' : 'NO beds'})`, beds ? !!baby : !baby, { fed, before, after: villagersIn(cx, cz, 6), babies: babiesIn(cx, cz, 6), breadLeft: { fb1: breadIn('fb1'), fb2: breadIn('fb2') }, collects: collects.slice(c0).filter(c => c.item === 'bread').length })
  rcon(`kill @e[type=villager,x=${cx - 7},y=${G - 2},z=${cz - 7},dx=14,dy=8,dz=14]`, `kill @e[type=item,x=${cx - 7},y=${G},z=${cz - 7},dx=14,dy=6,dz=14]`)
}
async function main () {
  requireSandboxLock(SERVER, TAG)
  const mg0 = r1('gamerule mobGriefing'), dl0 = r1('gamerule doDaylightCycle')
  rows.push({ step: 'env', version: r1('version').slice(0, 120), mobGriefing: mg0, doDaylightCycle: dl0 })
  const r = rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'difficulty peaceful', 'gamerule mobGriefing true', 'gamerule doDaylightCycle false',
    `fill ${A.x0} ${G - 1} ${A.z0} ${A.x1} ${G - 1} ${A.z1} minecraft:stone`, `fill ${A.x0} ${G} ${A.z0} ${A.x1} ${G} ${A.z1} minecraft:grass_block`,
    `fill ${A.x0} ${G + 1} ${A.z0} ${A.x1} ${G + 6} ${A.z1} minecraft:air`,
    `kill @e[type=!player,x=${A.x0},y=${G - 5},z=${A.z0},dx=60,dy=20,dz=60]`, 'time set 6000')
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(PORT), username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  bot.on('playerCollect', (collector, collected) => {
    let item = null
    try { item = collected.getDroppedItem?.()?.name ?? null } catch { item = null }
    collects.push({ t: Date.now(), collector: collector.id, collectorName: collector.name ?? collector.username, item })
  })
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} 4205 ${G + 1} 4205`)
  await sleep(3000)
  try {
    try { await bot.waitForChunksToLoad() } catch (err) { P('chunks', String(err)) }
    const parts = PARTS.split(',')
    if (parts.includes('D')) await partD()
    if (parts.includes('P')) await partP()
    if (parts.includes('B')) await breedRun('B breed', true)
    if (parts.includes('N')) await breedRun('N control', false)
  } finally {
    try { bot.quit() } catch {}
    rcon(`kill @e[type=!player,x=${A.x0},y=${G - 5},z=${A.z0},dx=60,dy=20,dz=60]`, `fill ${A.x0} ${G - 1} ${A.z0} ${A.x1} ${G + 6} ${A.z1} minecraft:air`,
      `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, `gamerule mobGriefing ${/false/.test(mg0) ? 'false' : 'true'}`, `gamerule doDaylightCycle ${/false/.test(dl0) ? 'false' : 'true'}`)
    fs.appendFileSync(OUT, rows.map(x => JSON.stringify({ run: new Date(T0).toISOString(), ...x })).join('\n') + '\n')
    console.log('SUMMARY', rows.filter(x => 'ok' in x).map(x => `${x.ok ? 'PASS' : 'FAIL'} ${x.step}`).join(' | '))
  }
}
main().catch(e => { console.log('FAILED', e.stack); process.exit(1) })
