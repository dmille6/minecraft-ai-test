#!/usr/bin/env node
// respawnfall-01 PAPER DRIVER (2026-10-24). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/respawnfall-01-design-2026-10-24.md section 7.
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot>, the model replaced by the sandbox brain answering every
// decision with `explore` (the skill 7 of the 12 platform falls of the week were running), so the base walks the platform the
// way the fleet did and the candidate's deterministic order runs ahead of it.
// WHAT IS REAL: the platform. isolated-a's 1,118 bot-placed cells, cell for cell with their block states, from the 10-24
// staged backup (isolated-a-platform.json), translated by (+4000, 0, +4000). The respawn is a real respawn: the driver sets
// the bot's spawnpoint on the column a respawn picked on the fleet, then kills it once; every later death respawns there
// again, the fleet's loop.
// WHAT IS SYNTHETIC, said so in every result row: the ground is a flat stone floor with its top at y=70 (the fleet's landings
// were y 63-101); the jungle under and around the platform is not copied; the bag is a fleet-typical one (the week's
// platform bots carried 247-349 placeable blocks, 64-66 of them logs) or, in `bare`, a pickaxe alone.
// SCENES:
//   deck    respawn on the y=180 deck at (353,181,147) -> real (4353,181,4147). Base expected: explores and (sometimes) falls;
//           candidate: `sky_descend` -- the cheapest column within 8 (the pillar at 354,148 has 44 cells over 96..183),
//           rideFloorDown to the ground; never a fall of more than 3
//   bridge  respawn on the y=125 bridges at (355,126,145)
//   tree    respawn on a tree standing on the deck at (355,185,147) (37 of the 174 spawn-square columns are tree-topped)
//   bare    the deck respawn with a pickaxe and nothing placeable: the candidate stays put with a `_needs_rescue` row and is
//           still on its cell at the end; the base explores
// OUTCOMES FROM THE WORLD AND THE BUILD: position and health by RCON every 3 s, the platform cells still standing at the end
// (`execute if block`), and the build's own rows (`_death`, `sky_descend`, `_sky_descend`, `_needs_rescue`, explore).
//
//   node sandbox/respawnfall/respawnfall-e2e.mjs <botRoot> <label> <scene> [server] [minutes]
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `respawnfall` as its owner's first
// word. World edits on its own arena only (x 4311-4434, z 4086-4214, y 60-190); cleanup sets it to air above the floor.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, LABEL, SCENE, SERVER = 'sandbox6', MIN_S = '8'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENE) throw new Error('usage: respawnfall-e2e.mjs <botRoot> <label> <scene> [server] [minutes]')
const SCENES = { deck: { spawn: [353, 181, 147], bag: 'fleet' }, bridge: { spawn: [355, 126, 145], bag: 'fleet' }, bare: { spawn: [353, 181, 147], bag: 'bare' }, tree: { spawn: [355, 185, 147], bag: 'fleet' } }
if (!SCENES[SCENE]) throw new Error(`unknown scene ${SCENE} (${Object.keys(SCENES).join(', ')})`)
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'respawnfall')
const MINUTES = Number(MIN_S)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// ABSOLUTE: the bot runs with its own cwd, so a relative LOG_DIR would land in its tree and the read would see no rows
const OUT = path.resolve(process.env.RF_OUT || path.join(os.tmpdir(), 'respawnfall-e2e'))
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const RUN = fs.mkdtempSync(path.join(OUT, `${LABEL}-${SCENE}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL}/${SCENE}/${SERVER} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let stopping = false
let sha = 'unknown'
try { sha = fs.readFileSync(path.join(BOT_ROOT, 'SHA'), 'utf8').trim() } catch { try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {} }

// ---------------------------------------------------------------- RCON (sandbox only, through the worlds host's helper)
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-rf-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const BAD = /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid/i
function batch (cmds) {
  const out = []
  for (let i = 0; i < cmds.length; i += 400) out.push(...rcon(...cmds.slice(i, i + 400)))
  const bad = out.filter(x => BAD.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
// health and position parsed after the 'entity data:' prefix, never from the name (ceilescape's Codex driver r8)
const posOf = name => { const m = /entity data: \[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${name} Pos`)); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
const healthOf = name => { const m = /entity data: ([\d.]+)f/.exec(r1(`data get entity ${name} Health`)); return m ? +m[1] : null }

// ---------------------------------------------------------------- the arena: isolated-a's platform, translated
const DX = 4000, DZ = 4000
const GEO = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'isolated-a-platform.json'), 'utf8'))
const CELLS = GEO.cells.map(([x, y, z, b]) => [x + DX, y, z + DZ, b])
const X0 = 315 + DX - 4, X1 = 430 + DX + 4, Z0 = 90 + DZ - 4, Z1 = 210 + DZ + 4, YF = 60, YG = 70, Y1 = 190
const SP = SCENES[SCENE].spawn, SPAWN = { x: SP[0] + DX, y: SP[1], z: SP[2] + DZ }
function arenaCmds () {
  const c = [`kill @e[type=!player,x=${X0},y=${YF},z=${Z0},dx=${X1 - X0},dy=${Y1 - YF},dz=${Z1 - Z0}]`]
  for (let y = YF; y <= Y1; y++) c.push(`fill ${X0} ${y} ${Z0} ${X1} ${y} ${Z1} minecraft:${y <= YG ? 'stone' : 'air'}`)
  for (const [x, y, z, b] of CELLS) c.push(`setblock ${x} ${y} ${z} minecraft:${b}`)
  return c
}
const cellName = b => b.split('[')[0]
const standing = () => {
  const out = rcon(...CELLS.map(([x, y, z, b]) => `execute if block ${x} ${y} ${z} minecraft:${cellName(b)}`))
  return out.filter(o => /Test passed/.test(o.reply)).length
}

// ---------------------------------------------------------------- the bot
const BAG = SCENES[SCENE].bag === 'bare' ? ['stone_pickaxe[damage=40] 1']
  : ['stone_pickaxe[damage=40] 1', 'cobblestone 64', 'cobblestone 64', 'cobblestone 64', 'oak_log 64', 'dirt 32']
const name = `rf${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 7)}${SCENE.slice(0, 2)}`.slice(0, 16)
const procs = []
const BRAIN_PORT = 11400 + Math.floor(Math.random() * 90)
// explore at varied lengths (an identical action 4x in a row is rejected as repeat_loop)
const SCRIPT = Array.from({ length: 60 }, (_, i) => `explore ${[24, 40, 32][i % 3]}`).join(';')
function launchBrain () {
  const env = { ...process.env, SANDBOX_SCRIPT: SCRIPT, SANDBOX_DELAY_MS: '45000' }
  const child = spawn(process.execPath, [path.join(REPO, 'sandbox/sandbox-brain.mjs'), String(BRAIN_PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(RUN, 'brain.out')); child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
}
function launch () {
  if (stopping) throw new Error('stopping: no bot is launched once the cleanup has begun')
  const dir = path.join(RUN, name)
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
  const poolDir = path.join(dir, 'pool'); fs.mkdirSync(poolDir, { recursive: true })
  const env = { ...process.env,
    BOT_NAME: name, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxrf-${LABEL}-${SCENE}`, POOL_STATE_DIR: poolDir, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'true', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`,
    OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '4000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-rf-${LABEL}`, RUN_ID: 'sandbox-respawnfall01', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(355 + DX), HOME_Y: String(YG + 1), HOME_Z: String(147 + DZ), BOARD_X: String(355 + DX), BOARD_Y: String(YG + 1), BOARD_Z: String(147 + DZ) }
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'bot.out'))
  child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return { name, dir, child, log: path.join(dir, 'log', `skill-${name}.jsonl`) }
}
const rowsOf = b => { try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const kind = r => r?.skill?.name ?? ''

let rules = null
async function main () {
  let pl = r1('list')
  for (let k = 0; k < 30 && !/There are 0 of/.test(pl); k++) { await sleep(2000); pl = r1('list') }
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scene=${SCENE} bot=${name} spawn=${JSON.stringify(SPAWN)} cells=${CELLS.length}`)
  rules = { keepInventory: r1('gamerule keepInventory'), doImmediateRespawn: r1('gamerule doImmediateRespawn'), difficulty: r1('difficulty') }
  P_('rules before', rules)
  batch(['gamerule keepInventory true', 'gamerule doImmediateRespawn true', 'difficulty peaceful'])
  r1(`forceload add ${X0} ${Z0} ${X1} ${Z1}`)
  await sleep(4000)
  batch(arenaCmds())
  const up = standing()
  const set = { cells: up === CELLS.length, spawnCell: /Test passed/.test(r1(`execute if block ${SPAWN.x} ${SPAWN.y - 1} ${SPAWN.z} minecraft:${cellName(CELLS.find(([x, y, z]) => x === SPAWN.x && y === SPAWN.y - 1 && z === SPAWN.z)?.[3] ?? 'stone')}`)),
    open: /Test passed/.test(r1(`execute if block ${SPAWN.x} ${SPAWN.y} ${SPAWN.z} minecraft:air`)), floor: /Test passed/.test(r1(`execute if block ${SPAWN.x} ${YG} ${SPAWN.z} minecraft:stone`)) }
  P_('arena set', set, `standing=${up}/${CELLS.length}`)
  if (!Object.values(set).every(Boolean)) throw new Error('arena did not set: ' + JSON.stringify(set))
  launchBrain()
  const b = launch()
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(b.name)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join: ' + r1('list'))
  await sleep(4000)
  // THE BAG, THEN A REAL RESPAWN ON THE PLATFORM: spawnpoint on the column, one kill (keepInventory keeps the bag)
  rcon(`gamemode survival ${b.name}`, `clear ${b.name}`, `effect clear ${b.name}`,
       ...BAG.map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${b.name} container.${9 + i} with minecraft:${id} ${n}` }),
       `spawnpoint ${b.name} ${SPAWN.x} ${SPAWN.y} ${SPAWN.z}`)
  await sleep(1500)
  r1(`kill ${b.name}`)
  await sleep(4000)
  const start = posOf(b.name)
  P_('respawned', start)
  if (!start || Math.abs(start.x - (SPAWN.x + 0.5)) > 1.2 || Math.abs(start.z - (SPAWN.z + 0.5)) > 1.2 || Math.abs(start.y - SPAWN.y) > 1.2) throw new Error('the bot did not respawn on the platform: ' + JSON.stringify(start))
  const tStart = Date.now()
  const deadline = Date.now() + MINUTES * 60_000
  let minHealth = 20, maxDrift = 0, groundAt = null
  const track = []
  while (Date.now() < deadline) {
    await sleep(3000)
    const p = posOf(b.name), h = healthOf(b.name)
    if (h != null) minHealth = Math.min(minHealth, h)
    if (p) {
      track.push([+((Date.now() - tStart) / 1000).toFixed(0), +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), h])
      maxDrift = Math.max(maxDrift, Math.hypot(p.x - start.x, p.z - start.z), Math.abs(p.y - start.y))
      // ON THE GROUND ALIVE: within 3 of the floor's top, never the instant of a fall (health read with it)
      if (groundAt == null && p.y <= YG + 1 + 3 && h != null && h > 0) groundAt = +((Date.now() - tStart) / 1000).toFixed(0)
    }
  }
  // from the respawn on: the driver's own kill (before tStart) is not a death of the run
  const all = rowsOf(b), rows = all.filter(r => Date.parse(r['@timestamp']) >= tStart - 1000)
  const p = posOf(b.name)
  const deaths = rows.filter(r => kind(r) === '_death').map(r => String(r.skill.detail).slice(0, 160))
  const ev = { scene: SCENE, sha, server: SERVER, bot: b.name, spawn: SPAWN, start, end: p, minutes: MINUTES,
    died: deaths.length > 0, deaths, falls: deaths.filter(d => /fell|hit the ground|impaled/.test(d)).length,
    minHealth, groundAt, maxDrift: +maxDrift.toFixed(2), standing: standing(), cells: CELLS.length,
    licence: all.filter(r => kind(r) === '_respawnfall_mode').map(r => String(r.skill.detail).slice(0, 160)),
    sky: rows.filter(r => kind(r) === 'sky_descend').map(r => `${r.skill.status}: ${String(r.skill.detail).slice(0, 160)}`),
    skyRows: rows.filter(r => kind(r) === '_sky_descend').map(r => `${r.skill.status}: ${String(r.skill.detail).slice(0, 220)}`),
    rescue: rows.filter(r => kind(r) === '_needs_rescue').map(r => String(r.skill.detail).slice(0, 220)),
    explores: rows.filter(r => kind(r) === 'explore').length,
    track: track.filter((_, i) => i % 5 === 0), driverKill: all.filter(r => kind(r) === '_death' && Date.parse(r['@timestamp']) < tStart - 1000).length,
    rows: rows.length, valid: rows.length > 0,   // no rows = the read could not see the bot: never a result
    synthetic: 'isolated-a platform cell for cell (10-24 backup, translated +4000,0,+4000); flat stone ground top y=70 (the jungle not copied); real respawn via spawnpoint + one kill; fleet gamerules; scripted `explore`' }
  fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, ...ev }) + '\n')
  P_('RESULT', { ...ev, track: undefined })
}
let cleaned = null
function cleanup () { return (cleaned ??= cleanupOnce()) }
async function cleanupOnce () {
  stopping = true
  for (const c of procs) { try { c.kill('SIGTERM') } catch {} }
  for (let k = 0; k < 25 && procs.some(c => c.exitCode === null && c.signalCode === null); k++) await sleep(200)
  for (const c of procs) { if (c.exitCode === null && c.signalCode === null) { try { c.kill('SIGKILL') } catch {} } }
  await sleep(2000)
  try {
    const c = [`kill @e[type=!player,x=${X0},y=${YF},z=${Z0},dx=${X1 - X0},dy=${Y1 - YF},dz=${Z1 - Z0}]`]
    for (let y = YG + 1; y <= Y1; y++) c.push(`fill ${X0} ${y} ${Z0} ${X1} ${y} ${Z1} minecraft:air`)
    c.push(`forceload remove ${X0} ${Z0} ${X1} ${Z1}`)
    if (rules) {
      const v = (s, d) => (/(true|false)/.exec(s) || [null, d])[1]
      c.push(`gamerule keepInventory ${v(rules.keepInventory, 'false')}`, `gamerule doImmediateRespawn ${v(rules.doImmediateRespawn, 'false')}`)
      const dm = /(peaceful|easy|normal|hard)/i.exec(rules.difficulty || '')
      if (dm) c.push(`difficulty ${dm[1].toLowerCase()}`)
    }
    batch(c)
    P_('cleanup', r1('list').slice(0, 80))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; cleanup().then(() => process.exit(1)) })
