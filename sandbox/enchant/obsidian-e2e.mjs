#!/usr/bin/env node
// SANDBOX-ONLY end-to-end run of OBSIDIAN-01, THE DEEP MINER'S CAST (bots/src/deepmine.mjs obsidian section + skills.mjs deepObs*),
// Paper 1.21.8 -- deepmine-e2e.mjs's arena and harness with an OBSIDIAN scene. THE WHOLE BOT, UNMODIFIED (`node src/index.mjs` via
// sandbox/run-bot.sh, the loopback scripted brain): the trip starts by itself at the town's finished stair with a kit that pays for
// a diamond trip AND the cast (a diamond pickaxe, one EMPTY bucket, 40 cobblestone so the start tops up from the town chest and the
// town index sees it), fills the bucket at an infinite surface pond, descends, deepens to feet -53, finds a lava lake under cave
// air with rock behind its shore, digs the approach and the basin, casts (water, the lake's lava, the water back), digs and picks
// up the obsidian, fills the basin, returns and banks.
//
//   node sandbox/enchant/obsidian-e2e.mjs <botRoot> [server] [seed]
// THE ARENA (161 x 161): bedrock -64, deepslate -63..-1, stone 0..69, grass 70; CAVE LAKES -- 5x5 lava sources at y -55 under
// cave air y -54..-52 -- in a ring 14..34 out from the stair, diamond ore at the work depth; a 3x3 water pond in the ground 6
// blocks from the stair's exit (infinite: the middle cells have two source neighbours).
// THE SERVER'S TRUTH (RCON, after the trip): the bot alive; obsidian in its bag or the town chest; round every lake cell the bot
// named (`_deepmine op=obs ... lake=`), no lava and no water left at the tunnel's level in the site row, the basin cells not lava.
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <server> -`; edits on the arena only. Refuses unless the
// sandbox lock names `obsidian`. Never a pkill by pattern: the driver kills its own two children only.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sbx from '../lib/sbxlock.cjs'

const [BOT_ROOT, SERVER = 'sandbox3', SEED_S = '11'] = process.argv.slice(2)
const SCENE = 'obsidian'
if (!BOT_ROOT) throw new Error('usage: obsidian-e2e.mjs <botRoot> [server] [seed]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
sbx.requireSandboxLock(SERVER, 'obsidian')
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = path.resolve(__dir, '../..')
const OUT = `${R}/sandbox/log/obsidian-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/${RUN}-driver.log`, s + '\n'); console.log(s) }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ run: RUN, server: SERVER, scene: SCENE, at: new Date().toISOString(), ...r }) + '\n'); P_('RESULT', r) }
const G = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/shaftgeom.mjs')))
const BP = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/buildproj.mjs')))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-obs-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const parseR = out => { const res = []; let cur = null; for (const line of String(out ?? '').split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line } return res }
/** A batch that survives a slow command (chunk generation, a big fill): the helper's 20 s socket timeout ends the batch, the
 *  server still runs the command; wait, then go on from the command after it. */
async function rconBatch (cmds, n = 400) {
  const out = []
  let i = 0
  while (i < cmds.length) {
    const chunk = cmds.slice(i, i + n)
    try {
      const o = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: chunk.join('\n') + '\n', encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 })
      out.push(...parseR(o)); i += chunk.length
    } catch (e) {
      const done = parseR(e?.stdout)
      out.push(...done.filter(x => x.reply !== ''))
      const skip = Math.max(1, done.length)   // the command that timed out is counted as sent
      P_('rcon slow', { at: i + skip - 1, cmd: chunk[skip - 1]?.slice(0, 80) })
      i += skip
      await sleep(25_000)
    }
  }
  return out
}
const bad = res => res.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected|Invalid/i.test(x.reply))

// ---------------------------------------------------------------- the arena
const C = { x: 7600, z: 7600 }, HALF = 80
const A = { x0: C.x - HALF, x1: C.x + HALF, z0: C.z - HALF, z1: C.z + HALF }
const GY = 70
const HOME = { x: C.x - 22, y: GY + 1, z: C.z }
const CENTER = [C.x, C.z]
const AWAY = G.awayFrom(HOME, C.x, C.z)
let seed = Number(SEED_S) || 11
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const set = (c, id) => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`
async function buildArena () {
  const fl = []
  for (let x = A.x0; x <= A.x1; x += 48) for (let z = A.z0; z <= A.z1; z += 48) fl.push(`forceload add ${x} ${z} ${Math.min(A.x1, x + 47)} ${Math.min(A.z1, z + 47)}`)
  await rconBatch(fl, 1)
  for (let i = 0; i < 20; i++) { const r = rcon(`execute if block ${A.x1} 0 ${A.z1} minecraft:air`, `execute if block ${A.x1} 0 ${A.z1} minecraft:stone`, `execute if block ${A.x1} 0 ${A.z1} minecraft:deepslate`); if (r.some(x => /Test (passed|failed)/.test(x.reply))) break; await sleep(5000) }
  const c = [`kill @e[type=!player,x=${A.x0},y=-64,z=${A.z0},dx=${A.x1 - A.x0},dy=200,dz=${A.z1 - A.z0}]`]
  for (let y = GY + 1; y <= GY + 30; y++) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y} ${A.z1} minecraft:air`)
  c.push(`fill ${A.x0} -64 ${A.z0} ${A.x1} -64 ${A.z1} minecraft:bedrock`)
  for (let y = -63; y <= GY - 1; y++) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y} ${A.z1} minecraft:${y < 0 ? 'deepslate' : 'stone'}`)
  c.push(`fill ${A.x0} ${GY} ${A.z0} ${A.x1} ${GY} ${A.z1} minecraft:grass_block`)
  const b = bad(await rconBatch(c, 40))
  if (b.length) throw new Error('arena: ' + b.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
}
/** The obsidian scene, seeded -> { cmds, native: [[x,y,z]] cave air the arena made, lakes: [[x0,z0]], notes }. */
function hazards () {
  const cmds = [], native = [], lakes = [], notes = { lakes: 0, diamonds: 0, iron: 0 }
  const far = (x, z, r = 9) => Math.max(Math.abs(x - C.x), Math.abs(z - C.z)) > r
  // CAVE LAKES in a ring round the stair: 5x5 lava sources at -55, cave air -54..-52 over them (the worlds' lava level under caves)
  // ...and round where `mine`'s descent from the y=16 stub ends (the stair runs AWAY = east; Paper 11-07 runs 1-3: the miner worked
  // at x ~7670, 70 out, beyond a ring round the stair): half the lakes ring the stair, half ring (C.x + 60, C.z)
  for (let k = 0; k < 16; k++) {
    const far2 = k >= 8, a = (k / 8) * 2 * Math.PI + rnd() * 0.3, rr = far2 ? ri(9, 16) : ri(14, 34)
    const cx = far2 ? C.x + 60 : C.x
    const x = Math.min(A.x1 - 6, Math.round(cx + Math.cos(a) * rr) - 2), z = Math.round(C.z + Math.sin(a) * rr) - 2
    if (!far(x, z, 12) || !far(x + 4, z + 4, 12)) continue
    // never over mine's descent line (it runs east along z = C.z: run 4's tread over a lake cave could not be stood in)
    if (far2 && z <= C.z + 5 && z + 4 >= C.z - 5) continue
    cmds.push(`fill ${x} -55 ${z} ${x + 4} -55 ${z + 4} minecraft:lava`, `fill ${x} -54 ${z} ${x + 4} -52 ${z + 4} minecraft:cave_air`)
    for (let dx = 0; dx <= 4; dx++) for (let dz = 0; dz <= 4; dz++) for (let y = -54; y <= -52; y++) native.push([x + dx, y, z + dz])
    lakes.push([x, z]); notes.lakes++
  }
  for (let gx = A.x0 + 6; gx <= A.x1 - 6; gx += 11) for (let gz = A.z0 + 6; gz <= A.z1 - 6; gz += 11) {
    const x = gx + ri(-3, 3), z = gz + ri(-3, 3), y = ri(-52, -48)
    if (!far(x, z)) continue
    if (lakes.some(([lx, lz]) => x >= lx - 2 && x <= lx + 6 && z >= lz - 2 && z <= lz + 6)) continue
    cmds.push(set([x, y, z], 'deepslate_diamond_ore')); notes.diamonds++
  }
  for (let i = 0; i < 60; i++) {
    const x = ri(A.x0 + 4, A.x1 - 4), z = ri(A.z0 + 4, A.z1 - 4), y = ri(-20, 24)
    if (!far(x, z)) continue
    const id = y < 0 ? 'deepslate_iron_ore' : 'iron_ore'
    for (let k = 0; k < ri(2, 5); k++) { cmds.push(set([x + (k % 2), y + (k >> 1), z], id)); notes.iron++ }
  }
  return { cmds, native, lakes, notes }
}
async function carveStair () {
  const origin = G.originFor(C.x, C.z, AWAY)
  const plan = G.planStair({ origin, away: AWAY, g: GY })
  const air = plan.cells.filter(c => c.role === 'air').map(c => c.at)
  const b = bad(await rconBatch(air.map(c => set(c, 'air'))))
  if (b.length) throw new Error('stair: ' + b[0].cmd + ' => ' + b[0].reply)
  return { plan, air, origin }
}
/** A read over the built arena (for the survey: the record is the stair's own, as a builder would publish it). */
const arenaRead = airSet => (x, y, z) => {
  if (airSet.has(`${x},${y},${z}`) || y > GY) return { name: 'air', boundingBox: 'empty', full: false }
  if (y === GY) return { name: 'grass_block', boundingBox: 'block', full: true }
  return { name: y < 0 ? 'deepslate' : 'stone', boundingBox: 'block', full: true }
}

// ---------------------------------------------------------------- run
const NAME = 'sandbox-Obsid'
const POOL = `${R}/sandbox/state/_pool-obs-${RUN}`
const ENV = `sandbox/log/obsidian-e2e/obs-${RUN}.env`   // under sandbox/log (ignored): never an untracked file in the tree
const LOGD = `./sandbox/log/obsidian-${RUN}`
let brain = null, botp = null
const kill = p => { try { p?.kill('SIGTERM') } catch {} }
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { kill(botp); kill(brain); process.exit(1) })   // our own children only: never a pkill by pattern
try {
  P_('arena', { server: SERVER, scene: SCENE, center: C, away: AWAY })
  rcon(`kick ${NAME} rebuild`)
  await buildArena()
  const hz = hazards()
  const hb = bad(await rconBatch(hz.cmds))
  if (hb.length) throw new Error('hazards: ' + hb[0].cmd + ' => ' + hb[0].reply)
  const st = await carveStair()
  // THE STAIR'S CELLS ARE THE BUILDER'S: never a hazard or ore inside the 5x5 shell (the far() skirt) -- re-assert the lining
  const airSet = new Set(st.air.map(c => c.join(',')))
  const sv = G.surveySite(arenaRead(new Set()), HOME, { x: C.x, z: C.z, away: AWAY })
  if (!sv.ok) throw new Error(`survey: ${sv.why}`)
  let rec = { ...G.stairRecord(sv, { home: HOME, now: Date.now(), by: 'sandbox-Builder' }), state: 'complete', structure_complete: true, completeAt: Date.now() }
  rec.landings_built = [...rec.landings]
  if (false) {
    // THE FLEET'S FAILURE (11-01): dirt pillared into three air cells (steps 12, 30 and 47)
    const blocks = [12, 30, 47].map(k => G.planOf(rec).steps[k].air[0])
    rcon(...blocks.map(c => set(c, 'dirt')))
    P_('blocked', blocks)
  }
  fs.mkdirSync(POOL, { recursive: true })
  const key = BP.projKey(HOME, G.SHAFT_PLOT)
  const pub = BP.publishRecord(POOL, key, () => rec, { by: 'sandbox-Builder' })
  if (pub.result !== 'accepted') throw new Error(`record: ${pub.result}`)
  P_('record', { key, K: rec.K, landings: rec.landings, exit: rec.exit, notes: hz.notes })
  // the town: a chest and a table by home (the deposit and the pickaxe craft)
  // the pond: 3x3 water sources in the ground 6 out from the stair's exit (infinite), stone under it
  const POND = [rec.exit[0] + 6, GY, rec.exit[2] + 6]
  rcon(`fill ${POND[0] - 1} ${GY - 1} ${POND[2] - 1} ${POND[0] + 1} ${GY - 1} ${POND[2] + 1} minecraft:stone`, `fill ${POND[0] - 1} ${GY} ${POND[2] - 1} ${POND[0] + 1} ${GY} ${POND[2] + 1} minecraft:water`)
  P_('pond', POND)
  rcon(`setblock ${HOME.x + 3} ${GY + 1} ${HOME.z + 2} minecraft:chest{Items:[{Slot:0b,id:"minecraft:cobblestone",count:64},{Slot:1b,id:"minecraft:cobblestone",count:64},{Slot:2b,id:"minecraft:cobblestone",count:64},{Slot:3b,id:"minecraft:cobblestone",count:64},{Slot:4b,id:"minecraft:torch",count:32}]}`, set([HOME.x + 3, GY + 1, HOME.z - 2], 'crafting_table'),
    `setworldspawn ${HOME.x} ${HOME.y} ${HOME.z}`, 'gamerule spawnRadius 0', 'difficulty peaceful')
  // the bot
  const envSrc = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted-stair.env`, 'utf8')
    .replace(/^BOT_NAME=.*$/m, `BOT_NAME=${NAME}`).replace(/^MINECRAFT_PORT=.*$/m, `MINECRAFT_PORT=${PORTS[SERVER]}`)
    .replace(/^MEMORY_POOL=.*$/m, 'MEMORY_POOL=deep').replace(/^LOG_DIR=.*$/m, `LOG_DIR=${LOGD}`).replace(/^STATE_DIR=.*$/m, `STATE_DIR=./sandbox/state/${NAME}-${RUN}`)
    .replace(/^HOME_X=.*$/m, `HOME_X=${HOME.x}`).replace(/^HOME_Y=.*$/m, `HOME_Y=${HOME.y}`).replace(/^HOME_Z=.*$/m, `HOME_Z=${HOME.z}`)
    .replace(/^BOARD_X=.*$/m, `BOARD_X=${HOME.x}`).replace(/^BOARD_Y=.*$/m, `BOARD_Y=${HOME.y}`).replace(/^BOARD_Z=.*$/m, `BOARD_Z=${HOME.z}`)
    .replace(/^CODE_VERSION=.*$/m, `CODE_VERSION=obsidian-${RUN}`)
    .replace(/^WORLD_BORDER_RADIUS=.*$/m, 'WORLD_BORDER_RADIUS=20000')   // the arena is ~10,000 from the origin; gather filters by the border
  fs.writeFileSync(`${R}/${ENV}`, envSrc + `\nPOOL_STATE_DIR=${POOL}\nDEEPMINE=on\nSHAFT=on\nOBSIDIAN=on\nTOWNINDEX=on\n`)
  brain = spawn('node', [`${R}/sandbox/sandbox-brain.mjs`, '11499'], { env: { ...process.env, SANDBOX_SCRIPT: 'status' }, stdio: ['ignore', fs.openSync(`${OUT}/${RUN}-brain.log`, 'a'), 'inherit'] })
  await sleep(800)
  botp = spawn('bash', [`${R}/sandbox/run-bot.sh`, ENV], { env: { ...process.env, BOT_ROOT }, stdio: ['ignore', fs.openSync(`${OUT}/${RUN}-bot.log`, 'a'), fs.openSync(`${OUT}/${RUN}-bot.log`, 'a')] })
  // wait for the join, then the kit (the bot stands at home: the world spawn was moved there)
  for (let i = 0; i < 60; i++) { await sleep(2000); if (rcon('list')[0]?.reply?.includes(NAME)) break }
  if (!rcon('list')[0]?.reply?.includes(NAME)) throw new Error('the bot never joined')
  const kitCmds = [`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${rec.exit[0] + 0.5} ${rec.exit[1]} ${rec.exit[2] + 0.5}`, `spawnpoint ${NAME} ${HOME.x} ${HOME.y} ${HOME.z}`,
    `effect give ${NAME} minecraft:saturation 7200 1 true`,
    `give ${NAME} minecraft:iron_pickaxe 1`, `give ${NAME} minecraft:stone_pickaxe 8`, `give ${NAME} minecraft:diamond_pickaxe 1`, `give ${NAME} minecraft:bucket 1`,
    `give ${NAME} minecraft:cobblestone 40`, `give ${NAME} minecraft:torch 24`, `give ${NAME} minecraft:stick 4`, `give ${NAME} minecraft:oak_planks 8`]
  rcon(...kitCmds)
  P_('kit', { scene: SCENE })
  // watch: the bot's own rows, the server's view of it
  const rowsFile = () => { try { const d = `${R}/${LOGD.slice(2)}`; return fs.readdirSync(d).filter(f => /^skill-.*\.jsonl$/.test(f)).map(f => `${d}/${f}`) } catch { return [] } }
  const seen = new Set(), events = []
  let end = null, minY = Infinity, deaths = 0
  const DEADLINE = Date.now() + 90 * 60_000
  while (Date.now() < DEADLINE && !end) {
    await sleep(5000)
    for (const f of rowsFile()) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line || seen.has(line)) continue
        seen.add(line)
        let r; try { r = JSON.parse(line) } catch { continue }
        const k = r?.skill?.name
        const y = r?.bot?.pos?.y
        if (Number.isFinite(y)) minY = Math.min(minY, y)
        if (k === '_death') { deaths++; P_('DEATH', r.skill.detail) }
        if (['_deepmine', '_deepmine_skip', '_exit_reserve_abort', '_shaft_use', '_lava_escape', '_entombed', 'deep_mine'].includes(k) || (k === 'mine' && r?.trigger !== 'reflex')) {
          const e = { t: r['@timestamp'], k, s: r.skill.status, d: String(r.skill.detail ?? '').slice(0, 200), y: Math.floor(y) }
          events.push(e); P_(k, e.s, e.y, e.d)
          if (k === '_deepmine' && /op=end /.test(e.d)) end = e
        }
      }
    }
  }
  // the server's truth
  rcon('save-all flush'); await sleep(3000)
  const count = id => { const r = rcon(`clear ${NAME} minecraft:${id} 0`)[0]?.reply ?? ''; return Number((r.match(/Found (\d+) matching/) ?? [])[1] ?? 0) }
  const chestObs = Number((rcon(`data get block ${HOME.x + 3} ${GY + 1} ${HOME.z + 2} Items[{id:"minecraft:obsidian"}].count`)[0]?.reply ?? '').match(/data: (\d+)/)?.[1] ?? 0)   // run 6: `data get ... Items` is cut by RCON
  const isB = (c, id) => /Test passed/.test(rcon(`execute if block ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`)[0]?.reply ?? '')
  // every lake cell the bot named: the site row S..P3 at feet and head dry of lava and water, the basin (H, W) never lava
  const obsRows = events.filter(e => e.k === '_deepmine' && /op=obs /.test(e.d))
  const lakesNamed = [...new Set(obsRows.map(e => (e.d.match(/lake=(-?\d+,-?\d+,-?\d+)/) ?? [])[1]).filter(Boolean))]
  const siteBad = []
  for (const lk of lakesNamed) {
    const [x, y, z] = lk.split(',').map(Number)
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      for (let k = 1; k <= 4; k++) for (const dy of [2, 3]) { const c = [x - dx * k, y + dy, z - dz * k]; for (const id of ['lava', 'water']) if (isB(c, id)) siteBad.push([...c, id]) }
      for (const k of [3, 4]) { const c = [x - dx * k, y + 1, z - dz * k]; if (isB(c, 'lava')) siteBad.push([...c, 'lava']) }
    }
  }
  const pos = rcon(`data get entity ${NAME} Pos`)[0]?.reply ?? ''
  const deep = events.filter(e => e.k === '_deepmine')
  const phases = [...new Set(deep.map(e => (e.d.match(/phase=(\w+)/) ?? [])[1]).filter(Boolean))]
  const steps = obsRows.map(e => (e.d.match(/step=(\S+) why=(\S+)/) ?? []).slice(1, 3).join(':'))
  const bagObs = count('obsidian')
  const ok = !!end && deaths === 0 && (bagObs + chestObs > 0) && siteBad.length === 0
  result({ ok, end: end?.d ?? null, deaths, minY: Number.isFinite(minY) ? Math.floor(minY) : null, phases, pos: pos.slice(-60),
    obsidian: { bag: bagObs, chest: chestObs }, bag: { bucket: count('bucket'), water_bucket: count('water_bucket'), lava_bucket: count('lava_bucket'), diamond_pickaxe: count('diamond_pickaxe'), cobblestone: count('cobblestone') },
    lakesNamed, siteBad, steps, rows: deep.length, deepRows: deep.map(e => e.d).slice(-60), lakes: hz.lakes, notes: hz.notes, ms: Date.now() - T0 })
} catch (e) {
  result({ ok: false, error: String(e?.stack ?? e).slice(0, 500) })
} finally {
  kill(botp); kill(brain)
  await sleep(1500)
  try { rcon(`kick ${NAME} done`, 'setworldspawn 0 80 0') } catch {}
  process.exit(0)
}
