#!/usr/bin/env node
// lavastep-01 PAPER DRIVER, r2 (2026-10-23). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/mineshaft-safety-2026-10-23.md F1 "Paper (the main evidence)".
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot>, with a SCRIPTED brain (sandbox/sandbox-brain.mjs) so the
// cognitive loop, the watchdog and the reflex layer run as on the fleet. The brain answers `status` (an instant skill: the
// runner is busy-then-idle every decision, which is meant to keep the idle lava stand-off gated off as on the fleet, where
// danger episodes start 3-10 s after a skill ended; a trial whose stand-off fired before the danger arm is FLAGGED masked and
// reported apart) or, in scene `busy`, `goto` across the pool (a skill and its pathfinder steering when the arm fires; each
// trial records whether a goto was cut by the arm). The danger arm -- today's blind sprint on a base build, the verified
// move on a lavastep build -- is the only thing that differs. LAVASTEP is removed from the child's environment on both arms.
// A FRESH BOT PER TRIAL (driver review r1, both engines): a new process, name and state each trial, so no death site, hunger,
// cooldown or episode history carries from one trial to the next.
// WHAT IS SYNTHETIC, said so in every result row: the arena (a stone plain with the scene's lava/magma/campfire set by RCON);
// the bot is put in a SUNK 1x1 water cell (fire out), healed (instant_health + saturation), given its bag, then teleported to
// the scene's start pose. Every step is VERIFIED (RCON replies, the scene cells read back, health, burning, the bag and the
// start pose): a setup that did not take makes the trial INVALID, never a measurement.
// OUTCOMES FROM THE WORLD: health, position and burning by RCON every 0.5 s through the window AND until the fire is out (no
// rest, no heal: a late death counts); the build's own rows (`_reflex_danger_block`, `_lava_retreat`, `_death`, stand-off).
// A trial whose observation was lost (the bot left, RCON could not see it) is INVALID, never a death.
//
//   node sandbox/lavastep/lavastep-e2e.mjs <botRoot> <label> <scene> [server] [trials] [seconds]
//   scenes (feet level y = A.y; the floor A.y-1; every pool SUNK into the floor so no lava flows over open ground):
//     edge      S1  a lava pool (2 deep) east of the bot; its centre over the first lava cell, its body on the shore block,
//                   FACING THE POOL (dry feet over lava: the commonest fatal start, 31/303)
//     deep1     S2  a 1-deep pool sunk into the floor; the bot's feet in it, 1 block from the shore (one step up), facing away
//     ledge     S3  a 1-wide stone ledge between two lava lakes level with it; the centre over the south lake, facing it
//     magma     S4  a magma floor block in the plain
//     fall      S5  falling 3 blocks past the edge of a 1-deep lava lake, facing into it
//     campfire  S6  a campfire underfoot
//     busy      S7  the S1 pool with the brain walking `goto` to a point beside an iron ore across the pool
//   env LS_BAG=cobble|none (default cobble); LS_YAW=cycle (trial k faces the scene yaw + 45 deg x (k mod 8); trials must be a
//   multiple of 8); LS_SLOT=0|1 (an arena offset, so two arms run side by side on one server); LS_OUT (default $TMPDIR/lavastep-e2e)
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `lavastep` as its owner's first word;
// re-checked every trial. World edits only inside its own arena; cleanup re-sets the driver's OWN stone/air plain there.
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
if (!/^[a-z0-9]{1,6}$/i.test(LABEL)) throw new Error('label: 1-6 letters/digits (it is part of the bot name)')
// sandbox names/ports and the lock from the shared registry (sandbox/sandboxes.json via sandbox/lib/sbxlock.cjs);
// sandbox4 stays excluded: it is the model benchmark's
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'lavastep')
const TRIALS = Number(TRIALS_S), SECS = Number(SECS_S)
if (!Number.isInteger(TRIALS) || TRIALS < 1 || TRIALS > 64) throw new Error('trials: an integer 1..64')
if (!Number.isInteger(SECS) || SECS < 8 || SECS > 60) throw new Error('seconds: an integer 8..60')
const BAG = process.env.LS_BAG === 'none' ? 'none' : 'cobble'
const YAW = process.env.LS_YAW === 'cycle' ? 'cycle' : 'scene'
if (YAW === 'cycle' && TRIALS % 8 !== 0) throw new Error('LS_YAW=cycle needs a multiple of 8 trials (every bearing equally often)')
const SLOT = process.env.LS_SLOT === '1' ? 1 : 0
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
// every command's reply is checked; `Could not set the block` is setblock's answer when the cell already holds that block
const BAD = /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid|No entity was found|No player was found|No targets matched/i
function batch (cmds) {
  const out = []
  for (let i = 0; i < cmds.length; i += 300) out.push(...rcon(...cmds.slice(i, i + 300)))
  const bad = out.filter(x => BAD.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
/** One RCON round trip: position, health, fire ticks; `lost` when RCON cannot see the bot. */
function probe (name) {
  const rs = rcon(`data get entity ${name} Pos`, `data get entity ${name} Health`, `data get entity ${name} Fire`)
  const lost = rs.some(x => /No entity was found/.test(x.reply))
  const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(rs[0]?.reply ?? '')
  const h = /([\d.]+)f/.exec(rs[1]?.reply ?? '')
  const f = /(-?\d+)s/.exec(rs[2]?.reply ?? '')
  return { lost, pos: m ? { x: +m[1], y: +m[2], z: +m[3] } : null, hp: h ? +h[1] : null, fire: f ? +f[1] : null }
}
const isBlock = (x, y, z, b) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${b}`))
const online = () => { const l = r1('list'); const i = l.indexOf(':'); return i < 0 ? [] : l.slice(i + 1).split(',').map(s => s.trim()).filter(Boolean) }

// ---------------------------------------------------------------- the arena (owned volume: x,z in [-R, R] around A, y A-8..A+12)
const A = { x: 6400 + 64 * SCENES.indexOf(SCENE), y: 100, z: 6400 + 64 * Object.keys(PORTS).indexOf(SERVER) + 32 * SLOT }
const R = 12
const REST = { x: A.x - 8, y: A.y - 1, z: A.z - 8 }        // the rest pad: a SUNK 1x1 water cell, stone around and below
const f = (x0, x1, y0, y1, z0, z1, b) => `fill ${A.x + x0} ${A.y + y0} ${A.z + z0} ${A.x + x1} ${A.y + y1} ${A.z + z1} minecraft:${b}`
const s1 = (x, y, z, b) => `setblock ${A.x + x} ${A.y + y} ${A.z + z} minecraft:${b}`
const OWN = `x=${A.x - R},y=${A.y - 8},z=${A.z - R},dx=${2 * R},dy=20,dz=${2 * R}`
// non-player entities (dropped items) in the owned volume; "No entity was found" is the normal reply, so this one is unchecked
const killOwned = () => r1(`kill @e[type=!player,${OWN}]`)
function plainCmds (rest = true) {
  killOwned()
  const c = []
  for (let dy = -8; dy <= 12; dy++) c.push(f(-R, R, dy, dy, -R, R, dy <= -1 ? 'stone' : 'air'))
  if (rest) c.push(`setblock ${REST.x} ${REST.y} ${REST.z} minecraft:water`)
  return c
}
// each scene: its cells, the start pose (feet position; MC yaw: 0 = +z, -90 = +x, 90 = -x, 180 = -z), and the cells read back
const SCENE_DEF = {
  edge: { cells: [f(1, 5, -2, -1, -3, 3, 'lava')], start: { x: 1.2, y: 0, z: 0.5, yaw: -90 }, check: [[1, -1, 0, 'lava'], [0, -1, 0, 'stone'], [5, -2, 3, 'lava']] },
  busy: { cells: [f(1, 5, -2, -1, -3, 3, 'lava'), s1(7, 0, 0, 'iron_ore'), s1(7, 1, 0, 'stone')], start: { x: 1.2, y: 0, z: 0.5, yaw: -90 }, brain: `goto ${A.x + 6} ${A.y} ${A.z}`, check: [[1, -1, 0, 'lava'], [7, 0, 0, 'iron_ore']] },
  // the pool is SUNK into the floor (lava at y-1 over stone at y-2): lava set at feet level on open ground flows across the
  // shore (the first runs of this scene did exactly that: every neighbour read lava), so the shore is one step UP
  deep1: { cells: [f(1, 4, -1, -1, -2, 2, 'lava')], start: { x: 1.5, y: -1, z: 0.5, yaw: -90 }, check: [[1, -1, 0, 'lava'], [0, -1, 0, 'stone'], [1, -2, 0, 'stone'], [0, 0, 0, 'air']] },
  ledge: { cells: [f(-6, 6, -2, -1, 1, 4, 'lava'), f(-6, 6, -2, -1, -4, -1, 'lava')], start: { x: 0.5, y: 0, z: 1.2, yaw: 0 }, check: [[0, -1, 0, 'stone'], [0, -1, 1, 'lava'], [0, -1, -1, 'lava'], [-6, -1, -4, 'lava']] },
  magma: { cells: [s1(0, -1, 0, 'magma_block')], start: { x: 0.5, y: 0, z: 0.5, yaw: -90 }, check: [[0, -1, 0, 'magma_block']] },
  fall: { cells: [f(1, 6, -1, -1, -4, 4, 'lava')], start: { x: 1.3, y: 3, z: 0.5, yaw: -90 }, check: [[1, -1, 0, 'lava'], [0, -1, 0, 'stone']] },
  campfire: { cells: [s1(0, 0, 0, 'campfire[lit=true]')], start: { x: 0.5, y: 0.5, z: 0.5, yaw: -90 }, check: [[0, 0, 0, 'campfire']] },
}
const DEF = SCENE_DEF[SCENE]

// ---------------------------------------------------------------- the brain + the bots
const BRAIN_PORT = 11520 + 2 * Object.keys(PORTS).indexOf(SERVER) + SLOT
const procs = new Set()
function track (child, label) {
  procs.add(child)
  child.on('error', e => { P_(`${label} process error`, e.message); stopping = true })
  child.on('exit', () => procs.delete(child))
  return child
}
function startBrain () {
  if (stopping) throw new Error('stopping: the brain is not started once the cleanup has begun')
  const env = { ...process.env, SANDBOX_SCRIPT: DEF.brain ?? 'status' }
  const brain = track(spawn(process.execPath, [path.join(REPO, 'sandbox/sandbox-brain.mjs'), String(BRAIN_PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] }), 'brain')
  const out = fs.createWriteStream(path.join(RUN, 'brain.out')); out.on('error', () => {}); brain.stdout.pipe(out); brain.stderr.pipe(out)
}
const prefix = `ls${LABEL}${SCENE.slice(0, 2)}${SERVER.slice(-1)}${SLOT}`
const nameFor = k => `${prefix}${k}`.slice(0, 16)
function launch (k) {
  if (stopping) throw new Error('stopping: no bot is launched once the cleanup has begun')
  const name = nameFor(k)
  const dir = path.join(RUN, name)
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
  const poolDir = path.join(dir, 'pool'); fs.mkdirSync(poolDir, { recursive: true })
  const env = { ...process.env,
    BOT_NAME: name, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxls-${LABEL}-${SCENE}-${k}`, POOL_STATE_DIR: poolDir, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '20000',   // the arenas sit ~9,000 from 0,0: 8000 rejected every goto (busy)
    BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '500', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'true', OLLAMA_MODEL: 'sandbox-script', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`,
    OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '4000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-ls-${LABEL}`, RUN_ID: 'sandbox-lavastep01', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(A.x + 300), HOME_Y: String(A.y), HOME_Z: String(A.z), BOARD_X: String(A.x + 300), BOARD_Y: String(A.y), BOARD_Z: String(A.z) }
  delete env.LAVASTEP           // both arms run their build's default; a stray LAVASTEP=0 in the shell cannot flip the candidate
  const child = track(spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] }), `bot ${name}`)
  const out = fs.createWriteStream(path.join(dir, 'bot.out')); out.on('error', () => {}); child.stdout.pipe(out); child.stderr.pipe(out)
  return { name, dir, child, log: path.join(dir, 'log', `skill-${name}.jsonl`) }
}
async function retire (b) {
  if (!b) return
  try { b.child.kill('SIGTERM') } catch {}
  for (let k = 0; k < 25 && b.child.exitCode === null && b.child.signalCode === null; k++) await sleep(200)
  if (b.child.exitCode === null && b.child.signalCode === null) { try { b.child.kill('SIGKILL') } catch {} }
  for (let k = 0; k < 20 && online().includes(b.name); k++) await sleep(500)
}
const rowsOf = b => {
  try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) }
  catch (e) { throw new Error(`the build's log is unreadable (${b.log}): ${e.message}`) }
}
const kind = r => r?.skill?.name ?? ''
const tsOf = r => Date.parse(r?.['@timestamp'] ?? '') || 0
function wilson (k, n) {
  if (!n) return [0, 1]
  const z = 1.96, p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return [+(Math.max(0, c - h)).toFixed(3), +(Math.min(1, c + h)).toFixed(3)]
}
const far = p => !p || Math.abs(p.x - A.x) > 3 * R || Math.abs(p.z - A.z) > 3 * R || Math.abs(p.y - A.y) > 20

/** One trial on a FRESH bot. -> a result row; `invalid` names why it was not a measurement. */
async function trial (k) {
  sbx.requireSandboxLock(SERVER, 'lavastep')
  const b = launch(k)
  const invalid = why => { P_('INVALID', { trial: k, why }); return { trial: k, invalid: why } }
  try {
    let joined = false
    for (let w = 0; w < 40; w++) { await sleep(1000); if (online().includes(b.name)) { joined = true; break } if (b.child.exitCode !== null) break }
    if (!joined) return invalid('the bot did not join')
    await sleep(6500)   // the cognitive loop starts 5 s after spawn; its first `status` decision follows
    // PREPARE, VERIFIED: the arena, the rest pad, health, food, effects, the bag
    batch([...plainCmds(true), ...DEF.cells])
    for (const [dx, dy, dz, n] of DEF.check) if (!isBlock(A.x + dx, A.y + dy, A.z + dz, n)) return invalid(`scene cell ${dx},${dy},${dz} is not ${n}`)
    if (!isBlock(REST.x, REST.y, REST.z, 'water')) return invalid('the rest pad is not water')
    batch([`tp ${b.name} ${REST.x + 0.5} ${REST.y} ${REST.z + 0.5}`, `gamemode survival ${b.name}`, `clear ${b.name}`])
    let rested = null
    for (let w = 0; w < 30; w++) { await sleep(500); const p = probe(b.name); if (p.lost) return invalid('lost at the rest pad'); if (p.fire != null && p.fire <= 0) { rested = p; break } }
    if (!rested) return invalid('still burning after 15 s at the rest pad')
    const bag = BAG === 'cobble' ? ['cobblestone 64', 'cobblestone 64', 'stone_pickaxe 1', 'oak_log 16'] : ['stone_pickaxe 1', 'oak_log 16']
    batch([`effect give ${b.name} minecraft:instant_health 1 10 true`, `effect give ${b.name} minecraft:saturation 1 20 true`, `effect clear ${b.name}`,
           ...bag.map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${b.name} container.${i} with minecraft:${id} ${n}` })])
    await sleep(1200)
    const cob = /Found (\d+) matching/.exec(r1(`clear ${b.name} minecraft:cobblestone 0`))
    if ((BAG === 'cobble') !== (cob != null && +cob[1] === 128)) return invalid(`bag: cobblestone ${cob ? cob[1] : 0}`)
    const pre = probe(b.name)
    if (pre.lost || pre.hp == null || pre.hp < 19 || pre.fire == null || pre.fire > 0) return invalid(`not ready: hp ${pre.hp} fire ${pre.fire}`)
    // RELEASE: the start pose, verified
    const s = DEF.start
    const yaw = YAW === 'cycle' ? ((s.yaw + 45 * (k % 8) + 540) % 360) - 180 : s.yaw
    const t0 = Date.now()
    batch([`tp ${b.name} ${A.x + s.x} ${A.y + s.y} ${A.z + s.z} ${yaw} 0`])
    const start = probe(b.name)
    if (start.lost || !start.pos || Math.hypot(start.pos.x - (A.x + s.x), start.pos.z - (A.z + s.z)) > 0.6 || Math.abs(start.pos.y - (A.y + s.y)) > (SCENE === 'fall' ? 2 : 0.7)) {
      return invalid(`start pose not taken: ${JSON.stringify(start.pos)}`)
    }
    // OBSERVE: the window, then until the fire is out (<= 20 s more), no rest, no heal
    let minHp = start.hp ?? 20, died = false, lost = false, burned = 0, last = start, deathAt = null
    const until = t0 + SECS * 1000
    for (let phase = 0; phase < 2 && !died && !lost; phase++) {
      const end = phase === 0 ? until : Date.now() + 20_000
      while (Date.now() < end) {
        await sleep(500)
        const p = probe(b.name)
        if (p.lost) { if (b.child.exitCode !== null || !online().includes(b.name)) { lost = true; break } continue }
        if (p.hp != null) minHp = Math.min(minHp, p.hp)
        if (p.fire != null && p.fire > 0) burned++
        if (p.hp === 0 || far(p.pos)) { died = true; deathAt = Date.now() - t0; break }   // a respawn lands far from the arena
        last = p
        if (phase === 1 && (p.fire == null || p.fire <= 0)) break
      }
    }
    const all = rowsOf(b)
    const rows = all.filter(r => tsOf(r) >= t0 - 200)
    if (rows.some(r => kind(r) === '_death')) died = true
    if (lost && !died) return invalid('observation lost (the bot left the server)')
    const firstDanger = rows.filter(r => kind(r) === '_reflex_danger_block').map(tsOf).sort((a, c) => a - c)[0] ?? null
    const standOffFirst = rows.some(r => kind(r) === '_lava_adjacent_stand_off' && (firstDanger == null || tsOf(r) <= firstDanger))
    // a goto the danger arm cut: its row is stamped at its START (before the release) and ends `aborted` on danger_block
    const gotoCut = SCENE === 'busy' ? all.some(r => kind(r) === 'goto' && tsOf(r) >= t0 - 60_000 && r.skill?.status !== 'success' && /danger_block/.test(`${r.trigger ?? ''} ${r.skill?.detail ?? ''}`)) : null
    let endCell = null, endHazard = null
    if (!died && last.pos) {
      const fx = Math.floor(last.pos.x), fy = Math.floor(last.pos.y), fz = Math.floor(last.pos.z)
      endCell = [fx, fy, fz]
      endHazard = ['lava', 'fire', 'magma_block', 'campfire'].filter(n => isBlock(fx, fy, fz, n) || isBlock(fx, fy - 1, fz, n))
    }
    const retreats = rows.filter(r => kind(r) === '_lava_retreat').map(r => r.skill?.args ?? {}).filter(a => a.phase === 'firing')
    const res = {
      trial: k, name: b.name, scene: SCENE, bag: BAG, yaw, died, deathAtMs: deathAt, minHp, endHp: died ? null : last.hp, endFire: died ? null : last.fire,
      burnedHalfSeconds: burned, start: start.pos, end: last.pos, endCell, endOnHazard: endHazard && endHazard.length ? endHazard : null,
      fired: firstDanger != null, dangerRows: rows.filter(r => kind(r) === '_reflex_danger_block').length, masked: standOffFirst, gotoCut,
      licence: all.some(r => kind(r) === '_lavastep_mode' && /on=1/.test(r.skill?.detail ?? '')),   // written at spawn, before t0
      retreats: retreats.map(a => ({ case: a.case, outcome: a.outcome, path: (a.path || []).join('>'), ended: a.ended, seal: a.seal?.witnessed ?? null, aim: a.aim?.chosen ?? null })),
      deathMsg: rows.filter(r => kind(r) === '_death').map(r => String(r.skill?.detail ?? '').slice(0, 120)),
    }
    P_('TRIAL', res)
    return res
  } finally { await retire(b) }
}

let setupBegan = false
async function main () {
  for (let k = 0; k < 30 && online().some(n => n.startsWith(prefix)); k++) await sleep(2000)
  if (online().some(n => n.startsWith(prefix))) throw new Error('a bot of this run is still online: ' + online().join(','))
  P_(`root=${BOT_ROOT} sha=${sha} lavastep_build=${lavastepBuild} server=${SERVER} slot=${SLOT} scene=${SCENE} bag=${BAG} yaw=${YAW} trials=${TRIALS} secs=${SECS} arena=${A.x},${A.y},${A.z}`)
  setupBegan = true
  batch([`forceload add ${A.x - R} ${A.z - R} ${A.x + R} ${A.z + R}`])
  await sleep(1500)
  batch([...plainCmds(true), ...DEF.cells])
  startBrain()
  await sleep(800)
  const results = []
  for (let k = 0; k < TRIALS && !stopping; k++) results.push(await trial(k))
  const valid = results.filter(r => !r.invalid)
  const unmasked = valid.filter(r => !r.masked)
  const sum = list => { const n = list.length, ok = list.filter(r => !r.died).length, un = list.filter(r => !r.died && r.minHp >= 18).length; return { n, survived: ok, survival_ci95: wilson(ok, n), unhurt: un, unhurt_ci95: wilson(un, n) } }
  const summary = { at: new Date().toISOString(), label: LABEL, scene: SCENE, bag: BAG, yawMode: YAW, sha, lavastep_build: lavastepBuild, server: SERVER, slot: SLOT,
    trials: results.length, invalid: results.filter(r => r.invalid).map(r => `${r.trial}:${r.invalid}`), valid: sum(valid), unmasked: sum(unmasked),
    masked: valid.length - unmasked.length, fired: valid.filter(r => r.fired).length, licence: valid.filter(r => r.licence).length,
    gotoCut: SCENE === 'busy' ? valid.filter(r => r.gotoCut).length : null,
    median_min_hp: valid.map(r => r.minHp).sort((a, c) => a - c)[Math.floor(valid.length / 2)] ?? null,
    outcomes: Object.entries(valid.flatMap(r => r.retreats.map(x => x.outcome)).reduce((m, o) => (m[o] = (m[o] || 0) + 1, m), {})),
    synthetic: 'arena by RCON; a fresh bot per trial, rested in a sunk water cell, healed + fed, given the scene bag, teleported to the start pose (all verified); scripted brain (status/goto)' }
  fs.appendFileSync(RES, JSON.stringify({ ...summary, results }) + '\n')
  P_('SUMMARY', summary)
}
let cleaned = null
function cleanup () { return (cleaned ??= cleanupOnce()) }
async function cleanupOnce () {
  stopping = true
  for (let pass = 0; pass < 2; pass++) {     // twice: a child spawned while the first pass ran is caught by the second
    for (const c of [...procs]) { try { c.kill('SIGTERM') } catch {} }
    for (let k = 0; k < 25 && [...procs].some(c => c.exitCode === null && c.signalCode === null); k++) await sleep(200)
    for (const c of [...procs]) { if (c.exitCode === null && c.signalCode === null) { try { c.kill('SIGKILL') } catch {} } }
    await sleep(500)
  }
  if (!setupBegan) return true               // nothing of ours was ever set in the world
  try {
    batch([...plainCmds(false), `forceload remove ${A.x - R} ${A.z - R} ${A.x + R} ${A.z + R}`])
    P_('cleanup ok', online().join(','))
    return true
  } catch (e) { P_('cleanup FAILED', e.message); return false }
}
const finish = code => cleanup().then(ok => process.exit(ok ? code : 3))
process.on('uncaughtException', e => { P_('FATAL uncaught', e.stack || e.message); finish(1) })
process.on('unhandledRejection', e => { P_('FATAL unhandled', e?.stack || String(e)); finish(1) })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; finish(1) })
main().then(() => finish(0), e => { P_('FATAL', e.stack || e.message); finish(1) })
