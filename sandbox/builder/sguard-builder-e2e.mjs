#!/usr/bin/env node
// SANDBOX-ONLY end-to-end run of STRUCTUREGUARD-01 and the GENERIC PLACEMENT BUILDER (ziggurat stage 3), Paper 1.21.8.
//
//   WELL_REPO=<harness checkout (main)> node sandbox/builder/sguard-builder-e2e.mjs <botRoot> <scene,...> [server]
//   scenes (the builder: a bare mineflayer bot running <botRoot>'s builder.mjs + buildbot.mjs, the fleet's own code)
//     zig        a 12-wide SOLID ziggurat (monument.mjs zigCells, 2 tiers + the grand stair) on flat ground, from the apron:
//                every planned cell must read cobblestone ON THE SERVER, and the builder's confirmed count must equal it
//     bystander  a 5x5 pad with an armor stand standing on one cell: that cell stays air, the other 24 are placed; the
//                stand removed, a second visit places the last one
//     resume     a 5x5x2 block: a visit stopped after 12 placements, the bot disconnected, a NEW connection's visit
//                finishes it -- server cells = 50, nothing placed twice (confirmed total = 50)
//   scenes (the guard: the REAL bot, src/index.mjs unmodified, decisions from a loopback brain)
//     mine       a monument record in the pool dir whose west edge is 2 east of the bot, the bot facing east, `mine 100`:
//                NOT ONE cell of the reserved volume (the foundation guard, y 112..119 here) changes on the server
//     minectl    the positive control: the same scene with NO record -- the stair goes east into those cells
//     gather     stone only in two patches: one inside the reserved volume (3 east), one outside (11 west); `gather stone
//                6`: no reserved stone is dug
//     gatherctl  the control: no record -- the near (reserved-to-be) patch is dug
// THE SERVER'S TRUTH: cells by `execute if block`. Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31)
// names `sguard`.
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox4'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: sguard-builder-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/sguard/.test(lock)) throw new Error(`the sandbox lock does not name sguard: ${lock.trim()}`)
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = process.env.WELL_REPO || path.resolve(__dir, '../..')
const NAME = 'sandbox-Guard'
const BNAME = 'sandbox-Builder'
const BRAIN_PORT = 11496
const OUT = `${R}/sandbox/log/sguard-builder-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-sguard-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ run: RUN, at: new Date().toISOString(), ...r }) + '\n'); P_('RESULT', r) }
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)

// ---------------------------------------------------------------- the arena: solid y 96..119, air 120..140, ground 119
const C = { x: 2700, z: 2600 }
let A = { x0: C.x - 30, x1: C.x + 30, z0: C.z - 30, z1: C.z + 30 }
const A_BIG = { x0: C.x - 50, x1: C.x + 50, z0: C.z - 50, z1: C.z + 50 }
const HOME = { x: C.x, y: 120, z: C.z }
function buildArena (fillTop = 'dirt') {
  const c = [`kill @e[type=!player,x=${A.x0},y=90,z=${A.z0},dx=${A.x1 - A.x0},dy=60,dz=${A.z1 - A.z0}]`]
  const step = (A.x1 - A.x0 + 1) * (A.z1 - A.z0 + 1) > 8000 ? 3 : 4
  for (let y = 120; y <= 140; y += step) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(140, y + step - 1)} ${A.z1} minecraft:air`)
  for (let y = 96; y <= 119; y += step) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(119, y + step - 1)} ${A.z1} minecraft:${y >= 112 ? fillTop : 'dirt'}`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
function countBlock (cells, id) {
  return rcon(...cells.map(c => `execute if block ${c.x} ${c.y} ${c.z} minecraft:${id}`)).filter(r => passed(r.reply)).length
}

// ---------------------------------------------------------------- the builder: a bare bot on <botRoot>'s modules
const req = createRequire(path.join(BOT_ROOT, 'bots', 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const B = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/builder.mjs')))
const BB = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/buildbot.mjs')))
const MON = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/monument.mjs')))
async function bareBot (at) {
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: BNAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', r => reject(new Error(`kicked ${r}`))) })
  rcon(`gamemode survival ${BNAME}`, `clear ${BNAME}`, `effect give ${BNAME} minecraft:saturation 600 1 true`, `tp ${BNAME} ${at.x + 0.5} ${at.y} ${at.z + 0.5}`)
  await sleep(3000)
  const m = new Movements(bot)
  m.canDig = false; m.allow1by1towers = false; m.scafoldingBlocks = []; m.allowParkour = false; m.allowSprinting = false; m.maxDropDown = 3
  return { bot, moves: m }
}
function giveCobble (n) {
  const c = []; let s = 0
  for (let left = n; left > 0; left -= 64) c.push(`item replace entity ${BNAME} container.${s++} with minecraft:cobblestone ${Math.min(64, left)}`)
  rcon(...c)
}
async function visit (bb, cells, start, box, opts = {}) {
  // the driver is not src/: it sets the walk profile itself, as index.mjs's scoped wrappers do for the fleet
  const eff = BB.botBuildEffects(bb.bot, { withWalk: async fn => { bb.bot.pathfinder.setMovements(bb.moves); return fn() } })
  try {
    return await B.runPlacements({ read: eff.read, cells, start, box, feet: eff.feet, bodies: eff.bodies, self: eff.self, walkTo: eff.walkTo, hold: eff.hold, click: eff.click,
      fence: () => true, maxSteps: opts.maxSteps ?? 2000, deadline: Date.now() + (opts.ms ?? 20 * 60_000) })
  } finally { eff.close() }
}
const quit = async bb => { try { bb.bot.quit() } catch {} await waitFor(() => !new RegExp(BNAME).test(r1('list')), 20000, 1000) }

async function sceneZig () {
  buildArena('dirt')
  const G = { B: 12, S: 3, H: 2, STAIR_W: 3, APRON: 2 }
  const corner = { x: C.x + 4, z: C.z - 6 }
  const cells = MON.zigCells({ corner, baseY: 120, stairFace: 'w' }, G).map(c => ({ x: c.x, y: c.y, z: c.z, want: 'cobblestone', layer: c.layer }))
  const start = { x: C.x, y: 120, z: C.z }
  const box = { x0: A.x0, x1: A.x1, y0: 110, y1: 140, z0: A.z0, z1: A.z1 }
  const plan = B.sequence(B.memo((x, y, z) => (y < 120 ? { name: 'dirt', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })), cells, { start, box })
  P_('offline plan', plan.why ?? 'ok', plan.steps.length, '/', cells.length)
  const bb = await bareBot(start)
  giveCobble(cells.length + 64)
  await sleep(1500)
  const r = await visit(bb, cells, start, box)
  await sleep(1500)
  const onServer = countBlock(cells, 'cobblestone')
  const at = bb.bot.entity.position.floored()
  await quit(bb)
  result({ scene: 'zig', cells: cells.length, stop: r.stop, why: r.why, stuck: r.stuck, placed: r.placed, refused: r.refused, silent: r.silent, unreachable: r.unreachable, onServer, endAt: `${at.x},${at.y},${at.z}`,
    ok: r.stop === 'complete' && onServer === cells.length && r.placed === cells.length })
}
async function sceneBystander () {
  buildArena('dirt')
  const cells = []; for (let x = 3; x <= 7; x++) for (let z = -2; z <= 2; z++) cells.push({ x: C.x + x, y: 120, z: C.z + z, want: 'cobblestone' })
  const held = { x: C.x + 5, y: 120, z: C.z }
  rcon(`summon minecraft:armor_stand ${held.x + 0.5} ${held.y} ${held.z + 0.5} {NoGravity:1b,Invulnerable:1b}`)
  const start = { x: C.x, y: 120, z: C.z }
  const box = { x0: A.x0, x1: A.x1, y0: 110, y1: 140, z0: A.z0, z1: A.z1 }
  const bb = await bareBot(start)
  giveCobble(64)
  await sleep(1500)
  const r1v = await visit(bb, cells, start, box)
  await sleep(1000)
  const heldAir = countBlock([held], 'air'), others = countBlock(cells.filter(c => c.x !== held.x || c.z !== held.z), 'cobblestone')
  rcon(`kill @e[type=minecraft:armor_stand,x=${held.x},y=${held.y},z=${held.z},distance=..2]`)
  await sleep(1500)
  const r2v = await visit(bb, cells, start, box)
  await sleep(1000)
  const all = countBlock(cells, 'cobblestone')
  await quit(bb)
  result({ scene: 'bystander', v1: { stop: r1v.stop, why: r1v.why, placed: r1v.placed }, heldAir, others, v2: { stop: r2v.stop, placed: r2v.placed }, all,
    ok: heldAir === 1 && others === 24 && r1v.placed === 24 && r2v.stop === 'complete' && r2v.placed === 1 && all === 25 })
}
async function sceneResume () {
  buildArena('dirt')
  const cells = []; for (let y = 120; y <= 121; y++) for (let x = 3; x <= 7; x++) for (let z = -2; z <= 2; z++) cells.push({ x: C.x + x, y, z: C.z + z, want: 'cobblestone' })
  const start = { x: C.x, y: 120, z: C.z }
  const box = { x0: A.x0, x1: A.x1, y0: 110, y1: 140, z0: A.z0, z1: A.z1 }
  let bb = await bareBot(start)
  giveCobble(128)
  await sleep(1500)
  const a = await visit(bb, cells, start, box, { maxSteps: 12 })
  const mid = countBlock(cells, 'cobblestone')
  await quit(bb)
  bb = await bareBot(start)
  giveCobble(128)
  await sleep(1500)
  const b = await visit(bb, cells, start, box)
  await sleep(1000)
  const all = countBlock(cells, 'cobblestone')
  await quit(bb)
  result({ scene: 'resume', first: { stop: a.stop, placed: a.placed }, mid, second: { stop: b.stop, placed: b.placed, why: b.why, stuck: b.stuck }, all,
    ok: a.stop === 'max_steps' && mid === a.placed && b.stop === 'complete' && all === 50 && a.placed + b.placed === 50 })
}

// ---------------------------------------------------------------- the guard: the real bot + a loopback brain
const queue = []
let brainN = 0
const brain = http.createServer((rq, res) => {
  let body = ''; rq.on('data', c => { body += c })
  rq.on('end', () => {
    if (rq.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!rq.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const decision = queue.shift() ?? { skill: 'status', args: {} }
    brainN++
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let proc = null
async function stopBot (sig = 'SIGTERM') {
  try { proc && proc.kill(sig) } catch {}
  proc = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
async function startBot (tag, slotsSpec, at, { record = null, yaw = 0 } = {}) {
  const logRel = `./sandbox/log/sguard-builder-e2e/${RUN}-${tag}`
  const skillLog = `${R}/sandbox/log/sguard-builder-e2e/${RUN}-${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${RUN}-${tag}.out`
  const envRel = 'sandbox/.env.sguard-e2e'
  const pool = `sbxsguard-${RUN}-${tag}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/sguard-${RUN}-${tag}`); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  set('WORLD_BORDER_RADIUS', 4000)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  // THE RECORD, where the bot's poolStateDir puts it: dirname(STATE_DIR)/_pool-<pool>/monument-<home>.g1.json
  if (record) {
    const dir = `${R}/sandbox/state/_pool-${pool}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/monument-${HOME.x}_${HOME.y}_${HOME.z}.g1.json`, JSON.stringify(record))
  }
  const bo = fs.openSync(botOut, 'a')
  proc = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:saturation 600 1 true`, `tp ${NAME} ${at.x + 0.5} ${at.y} ${at.z + 0.5} ${yaw} 0`)
  await sleep(4000)
  const c = [`tp ${NAME} ${at.x + 0.5} ${at.y} ${at.z + 0.5} ${yaw} 0`]
  let s = 0
  for (const [id, n] of slotsSpec) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(2000)
  return { skillLog, botOut }
}
const KIT = [['stone_pickaxe', 1], ['stone_pickaxe', 1], ['bread', 16], ['cobblestone', 32]]
const P = { x: C.x + 14, y: 120, z: C.z }                       // > 12 from home: mine's home guard does not move it
const SITE = { corner: { x: P.x + 2, z: P.z - 24 }, baseY: 120, stairFace: 'w' }
const REC = { v: 1, structure: 'monument', world: null, site: SITE, geom: { B: 48, S: 3, H: 2, STAIR_W: 3, APRON: 2 }, state: 'building' }

async function sceneMine (withRecord) {
  buildArena('stone')
  // the reserved volume next to the bot: the foundation guard (base-8 .. base-1) of the monument's west edge, 6 deep east
  const vol = []; for (let x = SITE.corner.x; x <= SITE.corner.x + 5; x++) for (let z = P.z - 5; z <= P.z + 5; z++) for (let y = 112; y <= 119; y++) vol.push({ x, y, z })
  const s0 = countBlock(vol, 'stone')
  const f = await startBot(withRecord ? 'mine' : 'minectl', KIT, P, { record: withRecord ? REC : null, yaw: -90 })
  queue.push({ skill: 'mine', args: { y: 100 } })
  const done = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === 'mine'), 240000)
  await sleep(2000)
  const s1 = countBlock(vol, 'stone')
  await stopBot()
  const guard = rowsOf(f.skillLog).filter(r => /^_?mine_well_guard$/.test(r.skill.name)).map(r => String(r.skill.detail).slice(0, 120))
  const out = { scene: withRecord ? 'mine' : 'minectl', mine: done ? `${done.skill.status}: ${String(done.skill.detail).slice(0, 160)}` : null, reservedStoneBefore: s0, reservedStoneDug: s0 - s1, guard }
  out.ok = !!done && (withRecord ? s0 - s1 === 0 : s0 - s1 > 0)
  result(out)
}
// THE PERFORMED WALK-OFF (Codex stage-3 r1 P1-3): the bot stands INSIDE a 48-wide monument's box (unbuilt: its foundation
// guard is the arena's stone), 14 from its nearest side, where every start within FAR_RADIUS is reserved. mine must walk
// off that side itself and descend there, digging no reserved cell.
async function sceneOffMonument () {
  A = A_BIG
  buildArena('stone')
  // the box spans x C-11..C+38, z C-41..C+8; the bot is 24+ from every side (beyond FAR_RADIUS 16) and 22 from home
  const site = { corner: { x: C.x - 10, z: C.z - 40 }, baseY: 120, stairFace: 'w' }
  const rec = { ...REC, site }
  const at = { x: C.x + 14, y: 120, z: C.z - 17 }
  const vol = []; for (let x = C.x + 28; x <= C.x + 37; x++) for (let z = C.z - 23; z <= C.z - 11; z++) for (let y = 112; y <= 119; y++) vol.push({ x, y, z })
  const s0 = countBlock(vol, 'stone')
  const f = await startBot('offmon', KIT, at, { record: rec, yaw: 90 })   // facing west, back into the monument
  queue.push({ skill: 'mine', args: { y: 113 } })   // 7 steps: any bearing stays inside the 101-wide arena
  const done = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === 'mine'), 300000)
  await sleep(2000)
  const s1 = countBlock(vol, 'stone')
  const pos = r1(`data get entity ${NAME} Pos`)
  await stopBot()
  const guard = rowsOf(f.skillLog).filter(r => /^_?mine_well_guard$/.test(r.skill.name)).map(r => String(r.skill.detail).slice(0, 140))
  result({ scene: 'offmon', mine: done ? `${done.skill.status}: ${String(done.skill.detail).slice(0, 160)}` : null, reservedStoneBefore: s0, reservedStoneDug: s0 - s1, guard, pos: pos.slice(-60),
    ok: !!done && done.skill.status === 'success' && s0 - s1 === 0 && guard.some(g => /try=off_monument/.test(g)) })
  A = { x0: C.x - 30, x1: C.x + 30, z0: C.z - 30, z1: C.z + 30 }
}
// THE ORE TUNNEL'S DIG BOUNDARY (Claude stage-3 r3 P3-3): the bot stands 3 inside a monument's west edge, iron 7 west and
// 7 down, OUTSIDE the box; the staircase west must cross the foundation guard. The record is written only once the bot has
// started down (its y < 119.5) -- after the tunnel was planned without it -- so the pathfinder's own breaks meet the
// guard at bot.dig. Measured: reserved stone broken AFTER the record existed (0 expected).
async function sceneTunnel () {
  buildArena('stone')
  const P2 = { x: C.x + 24, y: 120, z: C.z }
  const site = { corner: { x: P2.x - 3, z: P2.z - 24 }, baseY: 120, stairFace: 'w' }
  const ore = { x: P2.x - 7, y: 113, z: P2.z }
  rcon(`setblock ${ore.x} ${ore.y} ${ore.z} minecraft:iron_ore`)
  const vol = []; for (let x = site.corner.x; x <= P2.x + 2; x++) for (let z = P2.z - 3; z <= P2.z + 3; z++) for (let y = 112; y <= 119; y++) vol.push({ x, y, z })
  const tag = 'tunnel'
  const f = await startBot(tag, KIT.slice(0, 3), P2, { yaw: 90 })
  queue.push({ skill: 'gather', args: { block: 'iron_ore', count: 1 } })
  const dir = `${R}/sandbox/state/_pool-sbxsguard-${RUN}-${tag}`
  let wroteAt = null, s0 = null
  const t0 = Date.now()
  while (Date.now() - t0 < 120000 && !wroteAt) {
    const m = /\[([-\d.]+)d, ([-\d.]+)d, ([-\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`))
    if (m && Number(m[2]) < 119.5) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(`${dir}/monument-${HOME.x}_${HOME.y}_${HOME.z}.g1.json`, JSON.stringify({ ...REC, site }))
      wroteAt = { t: Date.now() - t0, pos: m.slice(1).map(Number) }
      s0 = countBlock(vol, 'stone')
    }
    await sleep(250)
  }
  const done = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === 'gather'), 240000)
  await sleep(2000)
  const s1 = countBlock(vol, 'stone')
  await stopBot()
  const tunnelRows = rowsOf(f.skillLog).filter(r => /tunnel/.test(r.skill.name)).map(r => `${r.skill.name} ${r.skill.status}: ${String(r.skill.detail).slice(0, 140)}`)
  const out = { scene: 'tunnel', wroteAt, reservedStoneAtWrite: s0, reservedDugAfterWrite: s0 == null ? null : s0 - s1,
    gather: done ? `${done.skill.status}: ${String(done.skill.detail).slice(0, 200)}` : null, tunnelRows: tunnelRows.slice(-4) }
  // TWO CORRECT OUTCOMES, named (measured 5 runs, 10-15): the pathfinder's next break is a reserved cell and the dig boundary
  // REFUSES it (the tunnel stops naming the structure: 2 runs), or the 2 s cache expires first and the tunnel profile
  // RE-ROUTES over the reserve on foot (the tunnel succeeds; every break after the record is outside the box: 3 runs).
  // ONE in-flight dig is allowed: a dig whose check ran before the record existed completes after the driver's snapshot
  // (debug-logged on the sandbox: its check read no record). Codex stage-3 r4 P3: the scene must OBSERVE an outcome, so a
  // stalled bot or a timed-out gather fails.
  const fired = !!done && /town structure was recorded over the tunnel/.test(`${done.skill.detail} ${tunnelRows.join(' ')}`)
  const rerouted = !!done && done.skill.status === 'success' && tunnelRows.some(r => /^_ore_tunnel success/.test(r))
  out.outcome = fired ? 'refused_at_dig' : rerouted ? 'rerouted' : 'none'
  out.ok = !!wroteAt && s0 - s1 <= 1 && (fired || rerouted)
  if (!wroteAt) out.note = 'INCONCLUSIVE: the bot never started down, so the boundary was not exercised'
  result(out)
}
async function sceneGather (withRecord) {
  buildArena('dirt')
  const near = [], far = []
  for (let z = P.z - 1; z <= P.z + 1; z++) for (let y = 118; y <= 119; y++) { for (let x = SITE.corner.x + 1; x <= SITE.corner.x + 2; x++) near.push({ x, y, z }); for (let x = P.x - 12; x <= P.x - 11; x++) far.push({ x, y, z }) }
  rcon(...near.map(c => `setblock ${c.x} ${c.y} ${c.z} minecraft:stone`), ...far.map(c => `setblock ${c.x} ${c.y} ${c.z} minecraft:stone`))
  const n0 = countBlock(near, 'stone'), f0 = countBlock(far, 'stone')
  const f = await startBot(withRecord ? 'gather' : 'gatherctl', KIT.slice(0, 3), P, { record: withRecord ? REC : null })
  queue.push({ skill: 'gather', args: { block: 'stone', count: 6 } })
  const done = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === 'gather'), 240000)
  await sleep(2000)
  const n1 = countBlock(near, 'stone'), f1 = countBlock(far, 'stone')
  await stopBot()
  const out = { scene: withRecord ? 'gather' : 'gatherctl', gather: done ? `${done.skill.status}: ${String(done.skill.detail).slice(0, 160)}` : null, nearDug: n0 - n1, farDug: f0 - f1 }
  out.ok = !!done && (withRecord ? out.nearDug === 0 && out.farDug > 0 : out.nearDug > 0)
  result(out)
}

await new Promise(r => brain.listen(BRAIN_PORT, '127.0.0.1', r))
let failed = 0
P_('forceload', rcon(`forceload add ${A_BIG.x0} ${A_BIG.z0} ${A_BIG.x1} ${A_BIG.z1}`).map(x => x.reply).join(' '))
P_(`root=${BOT_ROOT} server=${SERVER} scenes=${SCENES_S}`)
await sleep(3000)
try {
  for (const sc of SCENES_S.split(',')) {
    P_(`SCENE ${sc}`)
    try {
      if (sc === 'zig') await sceneZig()
      else if (sc === 'bystander') await sceneBystander()
      else if (sc === 'resume') await sceneResume()
      else if (sc === 'mine') await sceneMine(true)
      else if (sc === 'minectl') await sceneMine(false)
      else if (sc === 'gather') await sceneGather(true)
      else if (sc === 'gatherctl') await sceneGather(false)
      else if (sc === 'offmon') await sceneOffMonument()
      else if (sc === 'tunnel') await sceneTunnel()
      else throw new Error(`no scene ${sc}`)
    } catch (e) { failed++; P_('SCENE FAILED', sc, String(e?.stack ?? e).slice(0, 600)); await stopBot('SIGKILL') }
    queue.length = 0
  }
} finally {
  brain.close()
  try {
    const Z = A_BIG
    const c = []; for (let y = 96; y <= 140; y += 3) c.push(`fill ${Z.x0} ${y} ${Z.z0} ${Z.x1} ${Math.min(140, y + 2)} ${Z.z1} minecraft:air`)
    rcon(...c, `kill @e[type=!player,x=${Z.x0},y=90,z=${Z.z0},dx=${Z.x1 - Z.x0},dy=60,dz=${Z.z1 - Z.z0}]`, `forceload remove ${Z.x0} ${Z.z0} ${Z.x1} ${Z.z1}`)
  } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.sguard-e2e`) } catch {}
}
const bad = lines(RES).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.run === RUN && !r.ok).length
P_(`DONE: ${failed} scene(s) failed to run, ${bad} result(s) not ok`)
process.exit(failed || bad ? 1 : 0)
