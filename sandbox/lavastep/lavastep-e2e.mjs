#!/usr/bin/env node
// lavastep-01 PAPER DRIVER (2026-10-23). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/mineshaft-safety-2026-10-23.md F1 "Paper (the main evidence)".
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot>, with a SCRIPTED brain (sandbox/sandbox-brain.mjs) so the
// cognitive loop, the watchdog and the reflex layer run as on the fleet. The brain answers `status` (an instant skill:
// the runner is busy-then-idle every decision, so the idle lava stand-off is gated off as it is on the fleet, where the
// danger episodes start 3-10 s after a skill ended) or, in scene `busy`, `goto` across the pool (a skill and its
// pathfinder are steering when the danger arm fires). The danger arm itself -- today's blind sprint on a base build, the
// verified move on a lavastep build -- is the only thing that differs.
// WHAT IS SYNTHETIC, said so in every result row: the arena (a stone plain with the scene's lava/magma/campfire set by
// RCON); the bot is teleported to the scene's start pose (position and yaw) and given its bag; between trials it is put in
// a water cell (fire out), healed with instant_health and its effects cleared.
// OUTCOMES FROM THE WORLD: health, position and burning by RCON (`data get entity`) every 0.5 s; the cell at the end read
// back by `execute if block`; the build's own rows (`_reflex_danger_block`, `_lava_retreat`, `_death`) from its log.
//
//   node sandbox/lavastep/lavastep-e2e.mjs <botRoot> <label> <scene> [server] [trials] [seconds]
//   scenes (feet level y = A.y; the floor A.y-1):
//     edge      S1  a lava pool (2 deep) replacing the floor east of the bot; the bot's centre over its first cell, its
//                   body on the shore block, FACING THE POOL (dry feet over lava: the commonest fatal start, 31/303)
//     deep1     S2  a 1-deep lava pool sunk into the floor; the bot's feet in it, 1 block from the shore (one step up),
//                   facing away from the shore (feet in lava: 32/74)
//     ledge     S3  a 1-wide stone ledge between two lava lakes level with it; the centre over the south lake, facing it
//     magma     S4  a magma floor block in the plain
//     fall      S5  falling 3 blocks past the edge of a 1-deep lava lake, facing into it
//     campfire  S6  a campfire underfoot
//     busy      S7  the S1 pool with the brain walking `goto` to a point beside an iron ore across the pool (a lava pool
//                   beside an explore target): the bot is placed on the edge while the skill and pathfinder steer
//   env LS_BAG=cobble|none (default cobble: fleet bags hold cobble); LS_OUT (default $TMPDIR/lavastep-e2e)
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `lavastep` as its owner's first word.
// World edits on its own arena only; cleanup re-sets the driver's OWN stone/air plain there.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const SCENES = ['edge', 'deep1', 'ledge', 'magma', 'fall', 'campfire', 'busy']
const [BOT_ROOT, LABEL, SCENE, SERVER = 'sandbox5', TRIALS_S = '20', SECS_S = '20'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENE) throw new Error('usage: lavastep-e2e.mjs <botRoot> <label> <scene> [server] [trials] [seconds]')
if (!SCENES.includes(SCENE)) throw new Error(`unknown scene ${SCENE} (${SCENES.join(', ')})`)
// sandbox names/ports and the lock from the shared registry (sandbox/sandboxes.json via sandbox/lib/sbxlock.cjs);
// sandbox4 stays excluded: it is the model benchmark's
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'lavastep')
const TRIALS = Math.max(1, Math.min(60, Number(TRIALS_S) || 20))
const SECS = Math.max(8, Math.min(60, Number(SECS_S) || 20))
const BAG = process.env.LS_BAG === 'none' ? 'none' : 'cobble'
// LS_YAW=cycle: trial k faces the scene's yaw + 45 deg x (k mod 8) -- every bearing equally often, the same sequence on both
// arms (the scene's own facing, toward the hazard, is the design's mechanism demonstration; the cycle is the fair rate)
const YAW = process.env.LS_YAW === 'cycle' ? 'cycle' : 'scene'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = process.env.LS_OUT || path.join(os.tmpdir(), 'lavastep-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const RUN = fs.mkdtempSync(path.join(OUT, `${LABEL}-${SCENE}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL}/${SCENE}/${SERVER} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let stopping = false
let sha = 'unknown'
try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { try { sha = fs.readFileSync(path.join(BOT_ROOT, 'SHA'), 'utf8').trim() } catch {} }
const lavastepBuild = fs.existsSync(path.join(BOT_ROOT, 'bots/src/lavastep.mjs'))

// ---------------------------------------------------------------- RCON (sandbox only, through the worlds host's helper)
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ls-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const BAD = /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid/i
function batch (cmds) {
  const out = []
  for (let i = 0; i < cmds.length; i += 300) out.push(...rcon(...cmds.slice(i, i + 300)))
  const bad = out.filter(x => BAD.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
/** One RCON round trip: position, health, fire ticks. */
function probe (name) {
  const rs = rcon(`data get entity ${name} Pos`, `data get entity ${name} Health`, `data get entity ${name} Fire`)
  const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(rs[0]?.reply ?? '')
  const h = /([\d.]+)f/.exec(rs[1]?.reply ?? '')
  const f = /(-?\d+)s/.exec(rs[2]?.reply ?? '')
  return { pos: m ? { x: +m[1], y: +m[2], z: +m[3] } : null, hp: h ? +h[1] : null, fire: f ? +f[1] : null }
}
const isBlock = (x, y, z, b) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${b}`))

// ---------------------------------------------------------------- the arena
const A = { x: 6400 + 64 * SCENES.indexOf(SCENE), y: 100, z: 6400 + 64 * Object.keys(PORTS).indexOf(SERVER) }
const R = 12
const REST = { x: A.x - 8, y: A.y, z: A.z - 8 }            // the rest pad: a 1-deep water cell (fire out between trials)
const f = (x0, x1, y0, y1, z0, z1, b) => `fill ${A.x + x0} ${A.y + y0} ${A.z + z0} ${A.x + x1} ${A.y + y1} ${A.z + z1} minecraft:${b}`
const s1 = (x, y, z, b) => `setblock ${A.x + x} ${A.y + y} ${A.z + z} minecraft:${b}`
function plainCmds () {
  const c = [`kill @e[type=!player,x=${A.x - R},y=${A.y - 8},z=${A.z - R},dx=${2 * R},dy=24,dz=${2 * R}]`]
  for (let dy = -8; dy <= 12; dy++) c.push(f(-R, R, dy, dy, -R, R, dy <= -1 ? 'stone' : 'air'))
  c.push(s1(REST.x - A.x, 0, REST.z - A.z, 'water'))
  return c
}
// each scene: its cells, the start pose (feet position; MC yaw: 0 = +z, -90 = +x, 90 = -x, 180 = -z), and the expected
// danger: what makes the scene's arm fire
const SCENE_DEF = {
  edge: { cells: [f(1, 5, -2, -1, -3, 3, 'lava')], start: { x: 1.2, y: 0, z: 0.5, yaw: -90 } },
  busy: { cells: [f(1, 5, -2, -1, -3, 3, 'lava'), s1(7, 0, 0, 'iron_ore'), s1(7, 1, 0, 'stone')], start: { x: 1.2, y: 0, z: 0.5, yaw: -90 }, brain: `goto ${A.x + 6} ${A.y} ${A.z}` },
  // the pool is SUNK into the floor (lava at y-1 over stone at y-2): lava set at feet level on open ground flows across the
  // shore (the first runs of this scene did exactly that: every neighbour read lava), so the shore is one step UP
  deep1: { cells: [f(1, 4, -1, -1, -2, 2, 'lava')], start: { x: 1.5, y: -1, z: 0.5, yaw: -90 } },
  ledge: { cells: [f(-6, 6, -2, -1, 1, 4, 'lava'), f(-6, 6, -2, -1, -4, -1, 'lava')], start: { x: 0.5, y: 0, z: 1.2, yaw: 0 } },
  magma: { cells: [s1(0, -1, 0, 'magma_block')], start: { x: 0.5, y: 0, z: 0.5, yaw: -90 } },
  fall: { cells: [f(1, 6, -1, -1, -4, 4, 'lava')], start: { x: 1.3, y: 3, z: 0.5, yaw: -90 } },
  campfire: { cells: [s1(0, 0, 0, 'campfire[lit=true]')], start: { x: 0.5, y: 0.5, z: 0.5, yaw: -90 } },
}
const DEF = SCENE_DEF[SCENE]

// ---------------------------------------------------------------- the brain + the bot
const BRAIN_PORT = 11520 + Object.keys(PORTS).indexOf(SERVER)
const procs = []
function startBrain () {
  const env = { ...process.env, SANDBOX_SCRIPT: DEF.brain ?? 'status' }
  const child = spawn(process.execPath, [path.join(REPO, 'sandbox/sandbox-brain.mjs'), String(BRAIN_PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(RUN, 'brain.out')); child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
}
const NAME = `ls${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 7)}${SCENE.slice(0, 3)}${SERVER.slice(-1)}`.slice(0, 16)
function launch () {
  if (stopping) throw new Error('stopping: no bot is launched once the cleanup has begun')
  const dir = path.join(RUN, NAME)
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
  const poolDir = path.join(dir, 'pool'); fs.mkdirSync(poolDir, { recursive: true })
  const env = { ...process.env,
    BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxls-${LABEL}-${SCENE}`, POOL_STATE_DIR: poolDir, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '500', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'true', OLLAMA_MODEL: 'sandbox-script', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`,
    OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '4000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-ls-${LABEL}`, RUN_ID: 'sandbox-lavastep01', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(A.x + 300), HOME_Y: String(A.y), HOME_Z: String(A.z), BOARD_X: String(A.x + 300), BOARD_Y: String(A.y), BOARD_Z: String(A.z) }
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'bot.out')); child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return { name: NAME, dir, child, log: path.join(dir, 'log', `skill-${NAME}.jsonl`) }
}
const rowsOf = b => { try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const kind = r => r?.skill?.name ?? ''
const tsOf = r => Date.parse(r?.['@timestamp'] ?? '') || 0

function wilson (k, n) {
  if (!n) return [0, 1]
  const z = 1.96, p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return [+(Math.max(0, c - h)).toFixed(3), +(Math.min(1, c + h)).toFixed(3)]
}

async function prepTrial (b) {
  // rest in the water cell until not burning (<= 15 s), heal, clear effects, re-set the arena and the bag
  rcon(`tp ${b.name} ${REST.x + 0.5} ${REST.y} ${REST.z + 0.5}`)
  for (let k = 0; k < 30; k++) { await sleep(500); const p = probe(b.name); if (p.hp != null && p.hp > 0 && (p.fire == null || p.fire <= 0)) break }
  batch([...plainCmds(), ...DEF.cells])
  const bag = BAG === 'cobble' ? ['cobblestone 64', 'cobblestone 64', 'stone_pickaxe 1', 'oak_log 16'] : ['stone_pickaxe 1', 'oak_log 16']
  rcon(`effect give ${b.name} minecraft:instant_health 1 10 true`, `effect clear ${b.name}`, `clear ${b.name}`, `gamemode survival ${b.name}`,
       ...bag.map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${b.name} container.${i} with minecraft:${id} ${n}` }))
  await sleep(1500)
}

async function trial (b, k) {
  await prepTrial(b)
  const s = DEF.start
  const t0 = Date.now()
  const yaw = YAW === 'cycle' ? ((s.yaw + 45 * (k % 8) + 540) % 360) - 180 : s.yaw
  rcon(`tp ${b.name} ${A.x + s.x} ${A.y + s.y} ${A.z + s.z} ${yaw} 0`)
  const start = probe(b.name)
  let minHp = start.hp ?? 20, died = false, burnedTicks = 0, deathAt = null
  const until = t0 + SECS * 1000
  let last = start
  while (Date.now() < until) {
    await sleep(500)
    const p = probe(b.name)
    if (p.hp != null) minHp = Math.min(minHp, p.hp)
    if (p.fire != null && p.fire > 0) burnedTicks++
    if (p.hp === 0 || (p.hp == null && p.pos == null)) { died = true; deathAt = Date.now() - t0; break }
    last = p
  }
  const rows = rowsOf(b).filter(r => tsOf(r) >= t0 - 200 && tsOf(r) <= Date.now() + 1000)
  if (rows.some(r => kind(r) === '_death')) died = true
  const end = died ? null : probe(b.name)
  const endPos = end?.pos ?? last.pos
  let endCell = null, endHazard = null
  if (endPos && !died) {
    const fx = Math.floor(endPos.x), fy = Math.floor(endPos.y), fz = Math.floor(endPos.z)
    endCell = [fx, fy, fz]
    endHazard = ['lava', 'fire', 'magma_block', 'campfire'].filter(n => isBlock(fx, fy, fz, n) || isBlock(fx, fy - 1, fz, n))
  }
  const retreats = rows.filter(r => kind(r) === '_lava_retreat').map(r => r.skill?.args ?? {}).filter(a => a.phase === 'firing')
  const res = {
    trial: k, scene: SCENE, bag: BAG, yaw, died, deathAtMs: deathAt, minHp, endHp: end?.hp ?? null, burnedHalfSeconds: burnedTicks,
    start: start.pos, end: endPos, endCell, endOnHazard: endHazard && endHazard.length ? endHazard : null,
    dangerRows: rows.filter(r => kind(r) === '_reflex_danger_block').length,
    standOff: rows.filter(r => kind(r) === '_lava_adjacent_stand_off').length,
    retreats: retreats.map(a => ({ case: a.case, outcome: a.outcome, path: (a.path || []).join('>'), ended: a.ended, seal: a.seal?.witnessed ?? null, aim: a.aim?.chosen ?? null })),
    deathMsg: rows.filter(r => kind(r) === '_death').map(r => String(r.skill?.detail ?? '').slice(0, 120)),
  }
  P_('TRIAL', res)
  return res
}

async function main () {
  let pl = r1('list')
  for (let k = 0; k < 30 && !/There are 0 of/.test(pl); k++) { await sleep(2000); pl = r1('list') }
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} lavastep_build=${lavastepBuild} server=${SERVER} scene=${SCENE} bag=${BAG} yaw=${YAW} trials=${TRIALS} secs=${SECS} arena=${A.x},${A.y},${A.z}`)
  r1(`forceload add ${A.x - R - 10} ${A.z - R - 10} ${A.x + R} ${A.z + R}`)
  await sleep(1500)
  batch([...plainCmds(), ...DEF.cells])
  startBrain()
  await sleep(800)
  const b = launch()
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(b.name)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join: ' + r1('list'))
  await sleep(6000)   // the cognitive loop starts 5 s after spawn
  const results = []
  for (let k = 0; k < TRIALS && !stopping; k++) results.push(await trial(b, k))
  const rows = rowsOf(b)
  const n = results.length, survived = results.filter(r => !r.died).length
  const unhurt = results.filter(r => !r.died && r.minHp >= 18).length
  const summary = { at: new Date().toISOString(), label: LABEL, scene: SCENE, bag: BAG, yawMode: YAW, sha, lavastep_build: lavastepBuild, server: SERVER, trials: n,
    survived, survival: +(survived / Math.max(1, n)).toFixed(3), survival_ci95: wilson(survived, n), unhurt, unhurt_ci95: wilson(unhurt, n),
    deaths: n - survived, median_min_hp: results.map(r => r.minHp).sort((a, c) => a - c)[Math.floor(n / 2)] ?? null,
    fired: results.filter(r => r.dangerRows > 0).length, standOffRows: results.reduce((a, r) => a + r.standOff, 0),
    licence: rows.some(r => kind(r) === '_lavastep_mode'), retreatRows: rows.filter(r => kind(r) === '_lava_retreat').length,
    outcomes: Object.entries(results.flatMap(r => r.retreats.map(x => x.outcome)).reduce((m, o) => (m[o] = (m[o] || 0) + 1, m), {})),
    log: b.log, synthetic: 'arena by RCON; bot teleported to the start pose with the scene bag; healed in a water cell between trials; scripted brain (status/goto)' }
  fs.appendFileSync(RES, JSON.stringify({ ...summary, results }) + '\n')
  P_('SUMMARY', summary)
}
let cleaned = null
function cleanup () { return (cleaned ??= cleanupOnce()) }
async function cleanupOnce () {
  stopping = true
  for (const c of procs) { try { c.kill('SIGTERM') } catch {} }
  for (let k = 0; k < 25 && procs.some(c => c.exitCode === null && c.signalCode === null); k++) await sleep(200)
  for (const c of procs) { if (c.exitCode === null && c.signalCode === null) { try { c.kill('SIGKILL') } catch {} } }
  await sleep(1500)
  try {
    const c = [`kill @e[type=!player,x=${A.x - R - 10},y=${A.y - 8},z=${A.z - R - 10},dx=${2 * R + 10},dy=24,dz=${2 * R + 10}]`]
    for (let dy = -8; dy <= 12; dy++) c.push(f(-R, R, dy, dy, -R, R, dy <= -1 ? 'stone' : 'air'))
    c.push(`fill ${REST.x} ${REST.y} ${REST.z} ${REST.x} ${REST.y} ${REST.z} minecraft:air`)
    c.push(`forceload remove ${A.x - R - 10} ${A.z - R - 10} ${A.x + R} ${A.z + R}`)
    batch(c)
    P_('cleanup', r1('list').slice(0, 80))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; cleanup().then(() => process.exit(1)) })
