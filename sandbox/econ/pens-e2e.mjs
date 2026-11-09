// SANDBOX-ONLY E2E for pens-01 + herd-01 (villager economy, docs/reports/villagecon-2026-11-09/design.md), with the bots' own code:
//   1. THE BUILD: pens.mjs sitePens on the bot's own world read (a grass field), the record published, buildrun.mjs runVisit with
//      buildbot.mjs botBuildEffects (the walks, the AIMED clicks: the gates' facing) under penDomain (never a stand on a floor). The
//      kit (fences, gates) by RCON -- the skill's crafts are not this proof's. PASS: every fence cell reads a spruce fence and each gate
//      `spruce_fence_gate[facing=<into the pen>,open=false]` BY THE SERVER.
//   2. THE HERD: skills.mjs herdVisit (its real goto, gates, lure, breed and shear) run as the pens' upkeep, visit after visit: two
//      sheep summoned ~30 b from the pens are FETCHED through the gate, then BRED, then SHEARED. PASS (server): 2+ sheep inside the
//      sheep ring, a lamb, Sheared=1b on an adult, wool in the bag, the gate closed, the bot outside.
//   SBX=sandbox7 node sandbox/econ/pens-e2e.mjs   (lock: sandbox/sbxlock.sh take <sbx> econ "...")
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const HX = 5200, HY = 121, HZ = 5200
const POOL = fs.mkdtempSync(path.join(os.tmpdir(), 'penpool-'))
const NAME = 'sbx-Pens'
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxpens',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'penlog-')), POOL_STATE_DIR: POOL,
  HOME_X: String(HX), HOME_Y: String(HY), HOME_Z: String(HZ), WORLD_BORDER_RADIUS: '20000', BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const lock = req(path.resolve('sandbox/lib/sbxlock.cjs'))
const imp = f => import(path.join(BOTS, 'src', f))
const [PN, R, PJ, BB, T, SK] = await Promise.all(['pens.mjs', 'buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'townstyle.mjs', 'skills.mjs'].map(imp))
const { tapRecords } = await imp('logger.mjs')
const SERVER = process.env.SBX || 'sandbox7', REG = req(path.resolve('sandbox/sandboxes.json')), PORT = REG.servers[SERVER].port
const rcon = (...cmds) => execFileSync('ssh', ['-o', 'BatchMode=yes', `mike@${REG.host}`, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
const r1 = c => rcon(c).split('\n').slice(1).join(' ').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const R0 = 48
const fillAll = (x0, y0, z0, x1, y1, z1, block) => { const out = []; const per = Math.max(1, Math.floor(32768 / ((y1 - y0 + 1) * (z1 - z0 + 1)))); for (let x = x0; x <= x1; x += per) out.push(`fill ${x} ${y0} ${z0} ${Math.min(x1, x + per - 1)} ${y1} ${z1} minecraft:${block}`); return out }
const RES = {}
async function main () {
  lock.requireSandboxLock(SERVER, 'econ')
  const recs = []
  tapRecords(r => { if (/herd|build_visit|structure_complete/.test(r.skill?.name ?? '')) recs.push(`${r.skill.name} ${r.skill.status} ${String(r.skill.detail ?? '').slice(0, 220)}`) })
  const dl0 = r1('gamerule doDaylightCycle')
  rcon(`forceload add ${HX - R0 - 4} ${HZ - R0 - 4} ${HX + R0 + 4} ${HZ + R0 + 4}`, 'difficulty peaceful', 'gamerule doDaylightCycle false', 'time set 3000')
  rcon(...fillAll(HX - R0, HY - 4, HZ - R0, HX + R0, HY - 2, HZ + R0, 'dirt'), ...fillAll(HX - R0, HY - 1, HZ - R0, HX + R0, HY - 1, HZ + R0, 'grass_block'),
    ...fillAll(HX - R0, HY, HZ - R0, HX + R0, HY + 8, HZ + R0, 'air'),
    `kill @e[type=!player,x=${HX - R0 - 2},y=${HY - 6},z=${HZ - R0 - 2},dx=${2 * R0 + 4},dy=30,dz=${2 * R0 + 4}]`)
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`,
    `give ${NAME} minecraft:spruce_fence 64`, `give ${NAME} minecraft:spruce_fence 8`, `give ${NAME} minecraft:spruce_fence_gate 2`, `give ${NAME} minecraft:dirt 16`)
  await sleep(4000)
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  const ac = new AbortController()
  try {
    const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, props: T.oriented(b.name) ? b.getProperties() : null } : null }
    const home = { x: HX, y: HY, z: HZ }
    const s = PN.sitePens(read, { home, wood: 'spruce' })
    if (!s.ok) throw new Error('no site ' + s.why)
    const rec0 = s.record
    RES.site = { box: rec0.box, orient: rec0.orient, front: rec0.front, level: rec0.level, gates: rec0.cells.filter(c => c.role === 'gate').map(c => [...c.at, c.ws.facing]) }
    P('sited', RES.site)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pens-e2e-'))
    const key = PJ.projKey(home, PN.PENS_PLOT)
    PJ.publishRecord(dir, key, () => ({ ...rec0, state: 'open' }))
    const e = BB.botBuildEffects(bot, { log: () => {} })
    let r = null
    for (let visit = 0; visit < 6; visit++) {
      const slot = PJ.takeSlot(dir, key, NAME, 1)
      const h = PJ.recordHead(dir, key)
      r = await R.runVisit({ dir, key, me: NAME, home, stood: [[HX, HY, HZ]], record: h.head.rec, recordGen: h.head.gen, palette: rec0.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} },
        domain: PN.penDomain(rec0), foreign: PN.PEN_FOREIGN, walkR: 96 }, e, { deadline: Date.now() + 15 * 60_000, maxSteps: 400 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
      P(`visit ${visit}: stop ${r.stop} ${r.why ?? ''} placed ${r.placed} refused ${r.refused} silent ${r.silent}`)
      if (r.stop === 'complete') break
    }
    let bad = []
    for (const c of rec0.cells) {
      const want = c.role === 'gate' ? T.stateKey('minecraft:spruce_fence_gate', { facing: c.ws.facing, open: false }) : c.role === 'fence' ? 'minecraft:spruce_fence' : '#minecraft:dirt'
      if (!/passed/.test(r1(`execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} ${want}`))) bad.push([c.role, ...c.at])
    }
    RES.build = { stop: r?.stop, cells: rec0.cells.length, bad: bad.slice(0, 8), badN: bad.length }
    P('build check', RES.build)
    try { e.close?.() } catch {}
    // 2. THE HERD
    const rec = { ...rec0, structure_complete: true }
    const sg = rec.pens.sheep.gate
    const inV = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] }[sg.facing]
    // two sheep out in front of the gates, ~28 b and ~34 b out
    const s1 = [sg.x - inV[0] * 28 + 0.5, sg.z - inV[1] * 28 + 0.5], s2 = [sg.x - inV[0] * 34 + 6.5, sg.z - inV[1] * 34 + 0.5]
    rcon(`summon sheep ${s1[0]} ${HY} ${s1[1]} {Color:0b,Tags:["pe","pe1"]}`, `summon sheep ${s2[0]} ${HY} ${s2[1]} {Color:0b,Tags:["pe","pe2"]}`,
      `give ${NAME} minecraft:wheat 40`, `give ${NAME} minecraft:shears 1`)
    await sleep(2500)
    const ctx = { bot }
    const herd = []
    // the sightings: the bot near the sheep once (as a gatherer passing), the herd file noted (any bot does this through pensDueFor)
    await bot.pathfinder.goto(new (req('mineflayer-pathfinder').goals.GoalNear)(s1[0], HY, s1[1], 6)).catch(() => {})
    SK._pensTest.hdNoteSightings(bot, rec, Date.now())
    const ops = new Set()
    for (let v = 0; v < 12; v++) {
      const hv = await SK._pensTest.herdVisit(ctx, rec, { deadline: Date.now() + 170_000, signal: ac.signal })
      herd.push(hv); P('herd visit', v, hv)
      const inside = +(r1(`execute if entity @e[type=sheep,x=${Math.min(...rec.pens.sheep.floor.map(p => p[0]))},y=${HY - 2},z=${Math.min(...rec.pens.sheep.floor.map(p => p[2]))},dx=6,dy=4,dz=6]`).match(/count: (\d+)/)?.[1] ?? 0)
      P('sheep inside', inside)
      if (hv.ok) ops.add(hv.op)
      if (ops.has('shear') && ops.has('breed') && inside >= 3) break
      if (!hv.op) { SK._pensTest.hdNoteSightings(bot, rec, Date.now() + 61_000 * (v + 1)); await sleep(2000) }
    }
    const fl = rec.pens.sheep.floor
    const box = `x=${Math.min(...fl.map(p => p[0]))},y=${HY - 2},z=${Math.min(...fl.map(p => p[2]))},dx=6,dy=4,dz=6`
    RES.herd = {
      visits: herd.map(h => `${h.op}:${h.why}`),
      inside: +(r1(`execute if entity @e[type=sheep,${box}]`).match(/count: (\d+)/)?.[1] ?? 0),
      ops: [...ops],
      sheared: +(r1(`execute if entity @e[type=sheep,${box},nbt={Sheared:1b}]`).match(/count: (\d+)/)?.[1] ?? 0),
      wool: +(r1(`clear ${NAME} minecraft:white_wool 0`).match(/Found (\d+)/)?.[1] ?? 0),
      gate: r1(`execute if block ${sg.x} ${rec.level + 1} ${sg.z} minecraft:spruce_fence_gate[open=false]`),
      botOnFloor: !!PN.penOf(rec, bot.entity.position.x, bot.entity.position.z),
    }
    RES.records = recs
    RES.ok = { build: RES.build.badN === 0, fetched: RES.herd.inside >= 2, bred: ops.has('breed') && RES.herd.inside >= 3, sheared: RES.herd.sheared >= 1 && RES.herd.wool > 0, gateClosed: /passed/.test(RES.herd.gate), botOut: !RES.herd.botOnFloor }
    P('herd', RES.herd, RES.ok)
  } finally {
    bot.quit(); await sleep(500)
    rcon(`kill @e[type=!player,x=${HX - R0 - 2},y=${HY - 6},z=${HZ - R0 - 2},dx=${2 * R0 + 4},dy=30,dz=${2 * R0 + 4}]`, ...fillAll(HX - R0, HY - 4, HZ - R0, HX + R0, HY + 8, HZ + R0, 'air'),
      `forceload remove ${HX - R0 - 4} ${HZ - R0 - 4} ${HX + R0 + 4} ${HZ + R0 + 4}`, `gamerule doDaylightCycle ${/false/.test(dl0) ? 'false' : 'true'}`)
    fs.appendFileSync(path.resolve('sandbox/econ/pens-e2e.jsonl'), JSON.stringify({ run: new Date(T0).toISOString(), ...RES }) + '\n')
    console.log('RESULT ' + JSON.stringify({ ...RES, records: undefined }))
  }
}
main().then(() => process.exit(0)).catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(RES)); process.exit(1) })
