#!/usr/bin/env node
// cavefall-01 PAPER DRIVER (2026-10-24). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/cavefall-01-design-2026-10-24.md section 7.
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot>, the model replaced by the sandbox brain answering every
// decision with `gather <n> dirt` (then idle), so gather's own candidate choice, reach probe, stance walk and dig run exactly
// as on the fleet. WHAT IS SYNTHETIC, said so in every result row:
//   - the arena is built from the MEASURED SHAPE of the fleet's cave-fall cluster (failmine cluster 1, ~(379,2,154) under the
//     shared town; 17 of its 26 deaths ran `gather dirt` from a ledge at y 11-40 and fell 14-43 blocks, half onto
//     stalagmites), not cut cell for cell: a 3x5 dirt shelf at y=29 (feet y=30) off a 2-wide stone cliff, over a cave whose
//     floor is stone at y=7; the bot's own world y is kept, so depth-dependent code sees cave depth;
//   - the bot is teleported onto the centre of the shelf with a stone pickaxe, an iron shovel and 16 cobblestone;
//   - the sandbox's gamerules are set to the fleet's (keepInventory, doImmediateRespawn) and difficulty peaceful, then restored.
// SCENES (what lies under the shelf):
//   cave    stalagmites (pointed_dripstone, tip up) on the cave floor at y=8: a fall from the shelf is ~21 blocks onto them.
//           Base expected: digs a shelf cell (its own floor first) and falls; candidate: skips every shelf cell (gather ends
//           no_safe_target with the all-floors message and a `_cavefall_skip` row), digs nothing, lives
//   ground  the cave filled with stone up to y=28: digging the floor drops the bot ONE block (the no-regression control)
//   water   the cave floor flooded y=8..9 (2 deep): a fall from the shelf lands in water (swimming is travel: must be allowed)
// OUTCOMES FROM THE WORLD: position and health by RCON, the shelf cells read back by `execute if block`, the build's own rows
// (`_death` with the server's message, `gather`, `_cavefall_floor`, `_fall_path`) from its log.
//
//   node sandbox/cavefall/cavefall-e2e.mjs <botRoot> <label> <scene> [server] [minutes]
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `cavefall` as its owner's first word.
// World edits on its own arena only; cleanup sets the arena to air above a stone floor.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, LABEL, SCENE, SERVER = 'sandbox6', MIN_S = '4'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENE) throw new Error('usage: cavefall-e2e.mjs <botRoot> <label> <scene> [server] [minutes]')
const SCENES = ['cave', 'ground', 'water']
if (!SCENES.includes(SCENE)) throw new Error(`unknown scene ${SCENE} (${SCENES.join(', ')})`)
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'cavefall')
const MINUTES = Number(MIN_S)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// ABSOLUTE: the bot runs with its own cwd, so a relative LOG_DIR lands in its tree and the read sees no rows (10-24 rep 2)
const OUT = path.resolve(process.env.CF_OUT || path.join(os.tmpdir(), 'cavefall-e2e'))
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
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-cf-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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
const posOf = name => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${name} Pos`)); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
const healthOf = name => { const m = /([\d.]+)f/.exec(r1(`data get entity ${name} Health`)); return m ? +m[1] : null }
const isBlock = (x, y, z, b) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${b}`))

// ---------------------------------------------------------------- the arena (absolute world coordinates; y kept at cave depth)
const A = { x: 3600 + 40 * SCENES.indexOf(SCENE), z: 3600 }   // the arena's (0,0) corner
const X0 = A.x - 2, X1 = A.x + 14, Z0 = A.z - 2, Z1 = A.z + 14, Y0 = 5, Y1 = 36
const CLIFF = { x0: A.x, x1: A.x + 1 }              // the stone cliff/walkway, top at y=29 (feet 30)
const SHELF = { x0: A.x + 2, x1: A.x + 4, z0: A.z + 4, z1: A.z + 8, y: 29 }
const START = { x: A.x + 3, y: 30, z: A.z + 6 }      // the centre of the shelf
function arenaCmds () {
  const c = [`kill @e[type=!player,x=${X0},y=${Y0},z=${Z0},dx=${X1 - X0},dy=${Y1 - Y0},dz=${Z1 - Z0}]`]
  // a closed stone box, emptied inside, with a stone floor at y=7
  for (let y = Y0; y <= Y1; y++) c.push(`fill ${X0} ${y} ${Z0} ${X1} ${y} ${Z1} minecraft:stone`)
  for (let y = 8; y <= Y1 - 1; y++) c.push(`fill ${X0 + 1} ${y} ${Z0 + 1} ${X1 - 1} ${y} ${Z1 - 1} minecraft:air`)
  // the cliff and its top walkway
  c.push(`fill ${CLIFF.x0} 8 ${A.z} ${CLIFF.x1} 29 ${A.z + 12} minecraft:stone`)
  if (SCENE === 'ground') c.push(`fill ${A.x + 2} 8 ${A.z} ${A.x + 12} 28 ${A.z + 12} minecraft:stone`)
  if (SCENE === 'water') c.push(`fill ${A.x + 2} 8 ${A.z} ${A.x + 12} 9 ${A.z + 12} minecraft:water`)
  if (SCENE === 'cave') {
    for (let x = A.x + 2; x <= A.x + 8; x++) for (let z = A.z + 2; z <= A.z + 10; z++) c.push(`setblock ${x} 8 ${z} minecraft:pointed_dripstone[vertical_direction=up,thickness=tip]`)
  }
  // the dirt shelf, floating off the cliff
  c.push(`fill ${SHELF.x0} ${SHELF.y} ${SHELF.z0} ${SHELF.x1} ${SHELF.y} ${SHELF.z1} minecraft:dirt`)
  return c
}
const shelfCells = () => { const out = []; for (let x = SHELF.x0; x <= SHELF.x1; x++) for (let z = SHELF.z0; z <= SHELF.z1; z++) out.push([x, SHELF.y, z]); return out }

// ---------------------------------------------------------------- the bot
const BAG = ['stone_pickaxe[damage=40] 1', 'iron_shovel[damage=100] 1', 'cobblestone 16', 'oak_log 8']
const name = `cf${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 7)}${SCENE.slice(0, 2)}`.slice(0, 16)
const procs = []
const BRAIN_PORT = 11400 + Math.floor(Math.random() * 90)
function launchBrain () {
  const env = { ...process.env, SANDBOX_SCRIPT: `gather ${process.env.CF_COUNT || 4} dirt;idle`, SANDBOX_DELAY_MS: '40000' }
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
    MEMORY_POOL: `sbxcf-${LABEL}-${SCENE}`, POOL_STATE_DIR: poolDir, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'true', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`,
    OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '4000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-cf-${LABEL}`, RUN_ID: 'sandbox-cavefall01', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(A.x + 300), HOME_Y: '72', HOME_Z: String(A.z), BOARD_X: String(A.x + 300), BOARD_Y: '72', BOARD_Z: String(A.z) }
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
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scene=${SCENE} bot=${name} arena=${A.x},${A.z}`)
  // the fleet's rules for the run; the previous values are restored by the cleanup
  rules = { keepInventory: r1('gamerule keepInventory'), doImmediateRespawn: r1('gamerule doImmediateRespawn'), difficulty: r1('difficulty') }
  P_('rules before', rules)
  batch(['gamerule keepInventory true', 'gamerule doImmediateRespawn true', 'difficulty peaceful'])
  r1(`forceload add ${X0} ${Z0} ${X1} ${Z1}`)
  await sleep(2000)
  batch(arenaCmds())
  const set = { shelf: shelfCells().every(([x, y, z]) => isBlock(x, y, z, 'dirt')), under: SCENE === 'ground' ? isBlock(START.x, 28, START.z, 'stone') : isBlock(START.x, 28, START.z, 'air'),
    floor: SCENE === 'cave' ? isBlock(START.x, 8, START.z, 'pointed_dripstone') : SCENE === 'water' ? isBlock(START.x, 9, START.z, 'water') : true,
    cliff: isBlock(A.x + 1, 29, START.z, 'stone') }
  P_('arena set', set)
  if (!Object.values(set).every(Boolean)) throw new Error('arena did not set: ' + JSON.stringify(set))
  launchBrain()
  const b = launch()
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(b.name)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join: ' + r1('list'))
  rcon(`gamemode survival ${b.name}`, `clear ${b.name}`, `effect clear ${b.name}`, `tp ${b.name} ${START.x + 0.5} ${START.y} ${START.z + 0.5}`,
       ...BAG.map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${b.name} container.${9 + i} with minecraft:${id} ${n}` }))
  await sleep(2500)
  const start = posOf(b.name)
  P_('placed', start)
  if (!start || Math.floor(start.x) !== START.x || Math.floor(start.z) !== START.z || Math.abs(start.y - START.y) > 0.2) throw new Error('the bot is not on the shelf after the teleport: ' + JSON.stringify(start))
  const tStart = Date.now()
  const deadline = Date.now() + MINUTES * 60_000
  let minHealth = 20, minY = start.y
  const gone = {}
  while (Date.now() < deadline) {
    await sleep(3000)
    const p = posOf(b.name), h = healthOf(b.name)
    if (h != null) minHealth = Math.min(minHealth, h)
    if (p) minY = Math.min(minY, p.y)
    // WHICH SHELF CELL WENT, WHEN, AND WHERE THE BOT STOOD (the first candidate run lost one cell it never stood on)
    for (const [x, y, z] of shelfCells()) {
      const k = `${x},${y},${z}`
      // ...AND WHAT STOOD OVER IT: cavefall.mjs's fast path calls a cell with a full cube over it "not a floor" (nobody can
      // stand on it), so a cell capped by the bot's own pillar block is a legal dig the shelf count would still score
      if (!gone[k] && !isBlock(x, y, z, 'dirt')) gone[k] = { t: +((Date.now() - tStart) / 1000).toFixed(0), bot: p ? [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] : null, capped: isBlock(x, y + 1, z, 'cobblestone') }
    }
    if (rowsOf(b).some(r => kind(r) === '_death')) { await sleep(3000); break }
  }
  const rows = rowsOf(b).filter(r => Date.parse(r['@timestamp']) >= tStart - 1000)
  const p = posOf(b.name)
  const deaths = rows.filter(r => kind(r) === '_death').map(r => String(r.skill.detail).slice(0, 160))
  const collected = rows.filter(r => kind(r) === 'gather').reduce((n, r) => { const m = /collected (\d+) dirt/.exec(r.skill.detail || ''); return n + (m ? +m[1] : 0) }, 0)
  const shelfLeft = shelfCells().filter(([x, y, z]) => isBlock(x, y, z, 'dirt')).length
  const ev = { scene: SCENE, sha, server: SERVER, bot: b.name, start, end: p, died: deaths.length > 0 || minHealth <= 0, deaths, minHealth, minY: +minY.toFixed(1),
    fellBelowShelf: minY < SHELF.y - 2, collected, shelfDug: 15 - shelfLeft, shelfGone: gone,
    licence: rows.filter(r => kind(r) === '_cavefall_mode').map(r => String(r.skill.detail).slice(0, 120)),
    floor: rows.filter(r => kind(r) === '_cavefall_floor').map(r => String(r.skill.detail).slice(0, 220)),
    falls: rows.filter(r => kind(r) === '_fall_path').map(r => String(r.skill.detail).slice(0, 140)),
    gathers: rows.filter(r => kind(r) === 'gather').map(r => `${r.skill.status}: ${String(r.skill.detail).slice(0, 120)}`),
    gatherMs: rows.filter(r => kind(r) === 'gather').map(r => r.skill.duration_ms),   // whole-search latency (Codex r4 P3-4)
    skips: rows.filter(r => kind(r) === '_cavefall_skip').map(r => String(r.skill.detail).slice(0, 160)),
    rows: rows.length, valid: rows.length > 0,   // no rows = the read could not see the bot: never a result
    synthetic: 'arena built from the measured shape of the fleet cave-fall cluster (not a cell cut); bot teleported onto the shelf with a stone pickaxe, iron shovel, 16 cobblestone, 8 oak logs; fleet gamerules; scripted `gather dirt`' }
  fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, ...ev }) + '\n')
  P_('RESULT', ev)
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
    const c = [`kill @e[type=!player,x=${X0},y=${Y0},z=${Z0},dx=${X1 - X0},dy=${Y1 - Y0},dz=${Z1 - Z0}]`]
    for (let y = Y0; y <= Y1; y++) c.push(`fill ${X0} ${y} ${Z0} ${X1} ${y} ${Z1} minecraft:${y <= 7 ? 'stone' : 'air'}`)
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
