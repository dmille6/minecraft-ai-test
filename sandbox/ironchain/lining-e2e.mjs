#!/usr/bin/env node
// IRONCHAIN-01 (B) PAPER DRIVER (11-09). SANDBOX ONLY (10.0.0.30; sandbox5..sandbox8, under that server's own lock with
// `ironchain` as its owner's first word). Design: docs/reports/ironchain-2026-11-09.md.
//
// THE FLEET'S SCENE, rebuilt: a bot on the town stair's landing at y=16; the stair's wall holds an EXPOSED iron ore that is a
// `lining` cell of the stair's record (project-<home>.shaft.g1.json in the bot's pool dir: gather never takes a record cell);
// a REAL iron ore lies buried 6 blocks south in solid stone. The scripted brain asks `gather 2 iron_ore` on every decision.
//   base      (the fleet): gather finds nothing it may take, escalates to the ore tunnel, the tunnel aims at the stair's ore
//             (the nearest), "arrives", and gather fails "every candidate is buried [mine said: tunnelled to iron at <lining>]"
//   candidate (ironchain-01): the tunnel aims at the real ore, digs to it, and gather takes it (raw_iron in the bag)
// Every verdict is the SERVER's word (RCON, read-only after the build): the lining ore and the real ore by name, and the bag.
// The bot is the REAL bot (src/index.mjs from <botRoot>, unmodified); the record is the only synthetic state.
//
//   node sandbox/ironchain/lining-e2e.mjs <botRoot> <label> [server] [minutes]
// World edits on its own arena only (a stone box far from spawn).
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, LABEL, SERVER = 'sandbox8', MIN_S = '6'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL) throw new Error('usage: lining-e2e.mjs <botRoot> <label> [server] [minutes]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const ALLOWED = ['sandbox5', 'sandbox6', 'sandbox7', 'sandbox8']
if (!ALLOWED.includes(SERVER)) throw new Error(`sandbox5..8 only, not ${SERVER}`)
const LOCK = sbx.requireSandboxLock(SERVER, 'ironchain')
if (!/per-server: ironchain\b/.test(LOCK)) throw new Error(`take ${SERVER}'s own lock (sandbox/sbxlock.sh take ${SERVER} ironchain): ${LOCK}`)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const OUT = process.env.IC_OUT || path.join(os.tmpdir(), 'ironchain-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUT, `${LABEL}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ic-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const BAD = /not loaded|Cannot|Unknown|Incorrect|Too many|Expected|Invalid/i
function batch (cmds, what) {
  const out = []
  for (let i = 0; i < cmds.length; i += 400) out.push(...rcon(...cmds.slice(i, i + 400)))
  const bad = out.filter(x => BAD.test(x.reply))
  if (bad.length) throw new Error(`${what}: ` + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const is = (x, y, z, n) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${n}`))

// ---------------------------------------------------------------- the arena (sandbox coordinates)
const O = { x: 9000, y: 16, z: 9000 }                   // the landing: the bot's feet
const R = 36                                            // a stone box +-36 around it: no other ore within gather's 32 or the tunnel's 24
const Y0 = O.y - 30, Y1 = O.y + 30
const LINING = { x: O.x + 4, y: O.y, z: O.z }           // the stair wall's exposed ore, 4 east along the corridor (the nearest ore)
// IC_SCENE=only: the REFUSAL CHAIN -- no real ore, only the stair's; the brain asks gather, then the remedy the refusal names
// (`mine` down to new rock), and the verdict is that the remedy RUNS from the landing (a mine row that is not a refusal)
const ONLY = process.env.IC_SCENE === 'only'
const REAL = ONLY ? [] : [{ x: O.x, y: O.y, z: O.z + 6 }, { x: O.x, y: O.y + 1, z: O.z + 6 }]   // the real ore, buried 6 south (a cluster of 2)
const HOME = { x: O.x, y: 64, z: O.z + 400 }            // far: no town ground, no town orders here
const hk = `${HOME.x}_${HOME.y}_${HOME.z}`
function arena () {
  const c = [`forceload add ${O.x - R} ${O.z - R} ${O.x + R} ${O.z + R}`]
  c.push(`kill @e[type=!player,x=${O.x - R},y=${Y0},z=${O.z - R},dx=${2 * R},dy=${Y1 - Y0 + 10},dz=${2 * R}]`)
  for (let y = Y0; y <= Y1; y++) c.push(`fill ${O.x - R} ${y} ${O.z - R} ${O.x + R} ${y} ${O.z + R} minecraft:stone strict`)
  // the landing: a 3x3 room, 2 high, and the corridor east to the stair's wall
  c.push(`fill ${O.x - 1} ${O.y} ${O.z - 1} ${O.x + 1} ${O.y + 1} ${O.z + 1} minecraft:air strict`)
  c.push(`fill ${O.x} ${O.y} ${O.z} ${LINING.x - 1} ${O.y + 1} ${O.z} minecraft:air strict`)
  c.push(`setblock ${LINING.x} ${LINING.y} ${LINING.z} minecraft:iron_ore strict`)
  for (const q of REAL) c.push(`setblock ${q.x} ${q.y} ${q.z} minecraft:iron_ore strict`)
  c.push(`setblock ${O.x - 1} ${O.y + 1} ${O.z - 1} minecraft:torch strict`)
  return c
}
// THE STAIR'S RECORD (the fleet's shape, buildproj.mjs recordHead: gen 1, prev null; shaft-02 fields): its lining cell is the ore,
// its air cells the landing and the corridor; complete, so no build or repair order is drawn to it
function writeRecord (poolDir) {
  const cells = [{ at: [LINING.x, LINING.y, LINING.z], role: 'lining' }]
  for (let x = O.x; x < LINING.x; x++) for (const y of [O.y, O.y + 1]) cells.push({ at: [x, y, O.z], role: 'air' })
  const rec = { v: 1, blueprint: 'shaft@2', plot: 'shaft', home: HOME, site: { origin: { x: O.x, z: O.z }, away: 'e', g: 1, center: [O.x, O.z] },
    K: 1, landings: [O.y], landings_built: [O.y], exit: [O.x, HOME.y, O.z], state: 'complete', structure_complete: true,
    sitedAt: Date.now(), sitedBy: 'sandbox', cells, box: [O.x - 2, O.z - 2, LINING.x + 1, O.z + 2], survey: { lining: 1, digs: 0, stopK: null },
    gen: 1, prev: null, prevSha: null, at: Date.now(), by: 'sandbox', completeAt: Date.now() }
  fs.writeFileSync(path.join(poolDir, `project-${hk}.shaft.g1.json`), JSON.stringify(rec))
}

// ---------------------------------------------------------------- the bot and its brain
const SIDX = Object.keys(sbx.PORTS).indexOf(SERVER)
const BRAIN_PORT = 11560 + SIDX
const bname = `sandbox-IC${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 7)}`
const procs = []
function launch () {
  const brain = spawn(process.execPath, [path.join(REPO, 'sandbox/sandbox-brain.mjs'), String(BRAIN_PORT)], {
    env: { ...process.env, SANDBOX_SCRIPT: ONLY ? `gather 2 iron_ore;mine ${O.y - 8};status` : 'gather 2 iron_ore', SANDBOX_DELAY_MS: '25000' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const bo = fs.createWriteStream(path.join(RUN, 'brain.out')); brain.stdout.pipe(bo); brain.stderr.pipe(bo); procs.push(brain)
  const dir = path.join(RUN, bname)
  for (const d of ['log', 'state', 'pool']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  writeRecord(path.join(dir, 'pool'))
  const env = { ...process.env,
    BOT_NAME: bname, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxic-${LABEL}`, POOL_STATE_DIR: path.join(dir, 'pool'), MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(sbx.PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '16000', BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'true', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`,
    OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '8000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-ic-${LABEL}`, RUN_ID: 'sandbox-ironchain', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(HOME.x), HOME_Y: String(HOME.y), HOME_Z: String(HOME.z), BOARD_X: String(HOME.x), BOARD_Y: String(HOME.y), BOARD_Z: String(HOME.z) }
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'bot.out')); child.stdout.pipe(out); child.stderr.pipe(out); procs.push(child)
  return { child, log: path.join(dir, 'log', `skill-${bname}.jsonl`) }
}
const rowsOf = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }

async function main () {
  let pl = r1('list')
  for (let k = 0; k < 20 && !/There are 0 of/.test(pl); k++) { await sleep(3000); pl = r1('list') }
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} landing=${O.x},${O.y},${O.z} lining=${LINING.x},${LINING.y},${LINING.z} real=${REAL.map(q => `${q.x},${q.y},${q.z}`).join(' ')}`)
  batch(arena(), 'arena')
  await sleep(2000)
  const pre = { lining: is(LINING.x, LINING.y, LINING.z, 'iron_ore'), real: REAL.map(q => is(q.x, q.y, q.z, 'iron_ore')), landing: is(O.x, O.y, O.z, 'air') }
  P_('arena', pre)
  if (!pre.lining || pre.real.includes(false) || !pre.landing) throw new Error('the arena did not set')
  const b = launch()
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(bname)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join')
  batch([`gamemode survival ${bname}`, `clear ${bname}`, `effect clear ${bname}`, `tp ${bname} ${O.x + 0.5} ${O.y} ${O.z + 0.5}`,
    `item replace entity ${bname} container.0 with minecraft:iron_pickaxe 1`, `item replace entity ${bname} container.1 with minecraft:cobblestone ${ONLY ? 64 : 16}`,
    `item replace entity ${bname} container.2 with minecraft:bread 8`], 'placing the bot')
  const tPlaced = Date.now()
  P_('placed')
  const deadline = Date.now() + Number(MIN_S) * 60_000
  let gathers = []
  while (Date.now() < deadline) {
    await sleep(5000)
    gathers = rowsOf(b.log).filter(r => r.skill?.name === 'gather' && Date.parse(r['@timestamp']) >= tPlaced && r.skill.status !== 'started')
    if (ONLY ? rowsOf(b.log).some(r => r.skill?.name === 'mine' && Date.parse(r['@timestamp']) >= tPlaced && r.skill.status !== 'started') : (gathers.some(r => r.skill.status === 'success') || gathers.length >= 3)) break
    if (b.child.exitCode !== null) break
  }
  await sleep(3000)
  const rows = rowsOf(b.log).filter(r => Date.parse(r['@timestamp']) >= tPlaced)
  // THE BAG, by the server (`execute if items`: the entity-data dump is truncated over RCON)
  const inv = r1(`execute if items entity ${bname} container.* minecraft:raw_iron`)
  const ev = {
    label: LABEL, sha, server: SERVER,
    gathers: gathers.map(r => `${r.skill.status} ${String(r.skill.detail ?? '').slice(0, 200)}`),
    mines: rows.filter(r => r.skill?.name === 'mine' && r.skill.status !== 'started').map(r => `${r.skill.status} ${String(r.skill.detail ?? '').slice(0, 160)}`),
    tunnels: rows.filter(r => r.skill?.name === '_ore_tunnel').map(r => String(r.skill.detail).slice(0, 220)),
    changeRows: rows.filter(r => r.skill?.name === '_ironchain_tunnel').map(r => String(r.skill.detail).slice(0, 200)),
    liningAfter: is(LINING.x, LINING.y, LINING.z, 'iron_ore'),
    realAfter: REAL.map(q => is(q.x, q.y, q.z, 'iron_ore')),
    rawIronInBag: /Test passed/.test(inv) ? Number((/count:? (\d+)/i.exec(inv) || [])[1] ?? 1) : 0,
    gatherDelta: gathers.map(r => JSON.stringify(r.skill.inventory_delta ?? {})),
  }
  ev.tunnelAimedAtLining = ev.tunnels.some(d => d.includes(`to ${LINING.x},${LINING.y},${LINING.z}`))
  ev.tunnelAimedAtReal = ev.tunnels.some(d => REAL.some(q => d.includes(`to ${q.x},${q.y},${q.z}`)))
  fs.appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n')
  P_('RESULT', ev)
}
try { await main() } catch (e) { P_('ERROR', String(e?.stack ?? e).slice(0, 600)) } finally {
  for (const p of procs) { try { p.kill('SIGTERM') } catch {} }
  await sleep(3000)
  try { rcon(`forceload remove ${O.x - R} ${O.z - R} ${O.x + R} ${O.z + R}`) } catch {}
}
