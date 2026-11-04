#!/usr/bin/env node
// SHAFTTRAP-02 PAPER DRIVER (2026-11-03): THE WHOLE BOT, IDLE ON THE TOWN STAIR. SANDBOX ONLY (Paper 1.21.8 on 10.0.0.30).
// `node src/index.mjs` from <botRoot>/bots, unmodified, model OFF (LLM_ENABLED=false): the reflex loop alone drives the bot, so
// whatever the marooned and entombed arms do to a bot standing in a finished stair runs exactly as on the fleet. WHAT IS
// SYNTHETIC, said in every result row: the arena (stone to 69, grass 70) and the stair's air cells carved by RCON from
// shaftgeom's own plan (as egress-e2e.mjs carves it); the town's stair RECORD written into the bot's pool dir (complete, all
// landings built, the collar exit) before the bot starts; the bot placed on a stand by RCON `tp` and given a fleet-like bag
// (stone pickaxe, 64 cobblestone, 16 dirt); scene blocks set by RCON (dirt in air cells: an earlier escape's pillar; a tread
// removed). OUTCOMES FROM THE SERVER AND THE BUILD'S OWN ROWS: the bot's position (`data get entity`), every planned cell's
// block at the end (`execute if block`), and the bot's `_stair_handoff`, `_shaft op=egress*`, `_marooned*`, `_entombed*`,
// `_inventory_mutation`, `_escape_guard*` rows.
//
//   node sandbox/shafttrap/handoff-e2e.mjs <botRoot> <scene,scene,...> [server] [minutes]
//   blocked        idle at step 44, dirt in step 43's feet and head cells (the way up) and in step 30: the maroon probe has no route
//                  and the column over the head is open (maroonState climb) -> the arm hands over, the egress digs the dirt and
//                  ends at the collar exit; nothing placed in the stair, every other planned cell as planned
//   blocked_base   the same with SHAFTTRAP=0: the chain as it is on the fleet today (the control)
//   descend        a scripted `goto` (the sandbox brain on loopback) from the collar to the 16 landing's stub end: the walk goes
//                  down the stair; the entombed arm must not cut it short (no `_entombed` while it moves), it arrives
//   descend_base   the same with SHAFTTRAP=0 (the control: does the base's entombed arm interrupt the walk, as LIVE 3,643 rows?)
//   tread          step 44, step 43's tread removed: the egress stops `tread` at once (nothing gained) -> the arm's own escape
//                  runs in the same firing; no second hand-over from that step inside EGRESS_RETRY_MS
// Refuses unless a sandbox lock covering SERVER has `shafttrap` as its owner's first word. World edits on its arena only.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, SCENES_S = 'blocked,blocked_base,descend,descend_base,tread', SERVER = 'sandbox3', MIN_S = '6'] = process.argv.slice(2)
if (!BOT_ROOT) throw new Error('usage: handoff-e2e.mjs <botRoot> <scenes> [server] [minutes]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'shafttrap')
const MINUTES = Number(MIN_S)
const NAME = 'sandbox-Handoff'
const OUT = process.env.HO_OUT || path.join(os.tmpdir(), 'shafttrap-handoff')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let sha = null
try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch {}
if (!sha) { try { sha = fs.readFileSync(path.join(BOT_ROOT, 'SHA'), 'utf8').trim() } catch {} }
if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error(`cannot tell which build ${BOT_ROOT} is`)
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const G = await import(path.join(BOT_ROOT, 'bots/src/shaftgeom.mjs'))
const BP = await import(path.join(BOT_ROOT, 'bots/src/buildproj.mjs'))

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ho-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const BAD = /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid/i
function batch (cmds, n = 200) {
  const out = []
  for (let i = 0; i < cmds.length; i += n) out.push(...rcon(...cmds.slice(i, i + n)))
  const bad = out.filter(x => BAD.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const posOf = () => { const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? [+m[1], +m[2], +m[3]] : null }

// ---------------------------------------------------------------- the arena, the stair and its record
const C = { x: 7200, z: 7400 }, HALF = 12, GY = 70
const HOME = { x: C.x - 22, y: GY + 1, z: C.z }
const AWAY = G.awayFrom(HOME, C.x, C.z)
const ORIGIN = G.originFor(C.x, C.z, AWAY)
const SITE = { origin: ORIGIN, away: AWAY, g: GY, center: [C.x, C.z] }
const PLAN = G.planStair({ ...SITE, landings: [48, 32, 16] })
const set = (c, id) => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`
const flatRead = (x, y, z) => {
  const cell = PLAN.byKey.get(`${x},${y},${z}`)
  if (cell) return cell.role === 'air' ? { name: 'air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block', full: true }
  if (y > GY) return { name: 'air', boundingBox: 'empty' }
  return { name: y === GY ? 'grass_block' : 'stone', boundingBox: 'block', full: true }
}
const EXIT = G.collarExit(flatRead, PLAN)
function arena () {
  const x0 = C.x - HALF, x1 = C.x + HALF, z0 = C.z - HALF, z1 = C.z + HALF
  batch([`forceload add ${x0 - 30} ${z0} ${x1} ${z1}`], 1)
  const c = [`kill @e[type=!player,x=${x0 - 30},y=0,z=${z0},dx=${2 * HALF + 30},dy=110,dz=${2 * HALF}]`]
  for (let y = GY + 1; y <= GY + 8; y++) c.push(`fill ${x0 - 30} ${y} ${z0} ${x1} ${y} ${z1} minecraft:air`)
  for (let y = 0; y <= GY - 1; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:stone`)
  c.push(`fill ${x0 - 30} ${GY} ${z0} ${x1} ${GY} ${z1} minecraft:grass_block`, `fill ${x0 - 30} ${GY - 3} ${z0} ${x0 - 1} ${GY - 1} ${z1} minecraft:stone`)
  for (const cell of PLAN.cells) c.push(set(cell.at, cell.role === 'air' ? 'air' : 'stone'))
  c.push('difficulty peaceful')
  batch(c)
}
function truth () {
  const out = { air: { ok: 0, bad: [] }, solid: { ok: 0, bad: [] } }
  const res = rcon(...PLAN.cells.map(c => `execute if block ${c.at.join(' ')} minecraft:${c.role === 'air' ? 'air' : 'stone'}`))
  PLAN.cells.forEach((c, i) => { const b = c.role === 'air' ? out.air : out.solid; if (/Test passed/.test(res[i]?.reply ?? '')) b.ok++; else b.bad.push(c.at.join(',')) })
  return out
}
function writeRecord (poolDir) {
  const rec = { ...G.stairRecord({ site: SITE, K: PLAN.K, landings: [48, 32, 16], lining: 0, digs: 0, stopK: null, exit: EXIT }, { home: HOME, now: Date.now(), by: 'driver' }),
    landings_built: [48, 32, 16], structure_complete: true, state: 'complete', completeAt: Date.now() }
  const r = BP.publishRecord(poolDir, BP.projKey(HOME, G.SHAFT_PLOT), () => rec, { by: 'driver' })
  if (r.result !== 'accepted') throw new Error('record not published: ' + JSON.stringify(r))
  return rec
}

// ---------------------------------------------------------------- the whole bot
const procs = []
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { for (const c of procs) { try { c.kill('SIGKILL') } catch {} } try { rcon(`kick ${NAME} stopped`) } catch {} process.exit(1) })   // a stopped driver leaves no bot behind
const BRAIN_PORT = 11560 + Object.keys(sbx.PORTS).indexOf(SERVER)
function launchBrain (line, dir) {
  const child = spawn(process.execPath, [path.join(BOT_ROOT, 'sandbox/sandbox-brain.mjs'), String(BRAIN_PORT)], {
    env: { ...process.env, SANDBOX_SCRIPT: line, SANDBOX_DELAY_MS: '20000' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'brain.out')); child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return child
}
function launchBot (label, env0 = {}, script = null) {
  const dir = fs.mkdtempSync(path.join(OUT, `${label}-`))
  for (const d of ['log', 'state', 'pool']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  const rec = writeRecord(path.join(dir, 'pool'))
  const brain = script ? launchBrain(script, dir) : null
  const llm = script ? { LLM_ENABLED: 'true', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`, OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, OLLAMA_NUM_CTX: '8192',
    LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000', LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '8000' } : {}
  const env = { ...process.env,
    BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbx-handoff-${label}`, POOL_STATE_DIR: path.join(dir, 'pool'), MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '16000', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50', STUCK_SECONDS: '35',
    LLM_ENABLED: 'false', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', OLLAMA_BASE_URLS: 'http://127.0.0.1:11499',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-handoff-${label}`, RUN_ID: 'sandbox-shafttrap02', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(HOME.x), HOME_Y: String(HOME.y), HOME_Z: String(HOME.z), BOARD_X: String(HOME.x), BOARD_Y: String(HOME.y), BOARD_Z: String(HOME.z),
    SHAFT: 'on', ...llm, ...env0 }
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'bot.out')); child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return { dir, child, brain, rec, log: path.join(dir, 'log', `skill-${NAME}.jsonl`) }
}
const rowsOf = b => { try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const kind = r => r?.skill?.name ?? ''
async function stopBot (b) {
  try { b.brain?.kill('SIGTERM') } catch {}
  try { b.child.kill('SIGTERM') } catch {}
  for (let k = 0; k < 25 && b.child.exitCode === null && b.child.signalCode === null; k++) await sleep(200)
  if (b.child.exitCode === null && b.child.signalCode === null) { try { b.child.kill('SIGKILL') } catch {} }
  await sleep(3000)
}

async function scene (name) {
  batch(PLAN.cells.map(c => set(c.at, c.role === 'air' ? 'air' : 'stone')))
  const extra = []
  if (name === 'blocked' || name === 'blocked_base') extra.push(PLAN.steps[43].air[0], PLAN.steps[43].air[1], PLAN.steps[30].air[1])
  if (extra.length) rcon(...extra.map(c => set(c, 'dirt')))
  let tread = null
  if (name === 'tread') { tread = PLAN.steps[43].tread; rcon(set(tread, 'air')) }
  const descend = name === 'descend' || name === 'descend_base'
  const stub16 = G.stubEnd(PLAN.landings.find(l => l.feet === 16))
  const b = launchBot(name, /_base$/.test(name) ? { SHAFTTRAP: '0' } : {}, descend ? `goto ${stub16[0]} ${stub16[1]} ${stub16[2]};idle` : null)
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(NAME)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join: ' + r1('list'))
  const s44 = G.standOf(PLAN, 44)
  batch([`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 900 1 true`,
    `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe[damage=31] 1`,
    `item replace entity ${NAME} container.1 with minecraft:cobblestone 64`, `item replace entity ${NAME} container.2 with minecraft:dirt 16`,
    descend ? `tp ${NAME} ${EXIT[0] + 0.5} ${EXIT[1]} ${EXIT[2] + 0.5}` : `tp ${NAME} ${s44[0] + 0.5} ${s44[1]} ${s44[2] + 0.5}`], 20)
  const placedAt = Date.now()
  P_(name, 'placed', posOf(), { stand: s44, exit: EXIT, scene: extra.map(c => c.join(',')), tread })
  const deadline = Date.now() + MINUTES * 60_000
  let outAt = null, last = null, arrivedAt = null
  const atStub = p => !!p && Math.abs(Math.floor(p[0]) - stub16[0]) <= 1 && Math.abs(Math.floor(p[2]) - stub16[2]) <= 1 && Math.abs(Math.floor(p[1] + 1e-6) - stub16[1]) <= 1
  const atExit = p => !!p && Math.abs(Math.floor(p[0]) - EXIT[0]) <= 1 && Math.abs(Math.floor(p[2]) - EXIT[2]) <= 1 && Math.floor(p[1] + 1e-6) >= GY + 1
  while (Date.now() < deadline) {
    await sleep(3000)
    if (b.child.exitCode !== null || b.child.signalCode !== null) break
    last = posOf()
    if (descend) { if (atStub(last)) { arrivedAt ??= Date.now(); if (Date.now() - arrivedAt > 15_000) break } continue }
    if (name === 'tread') { const ho = rowsOf(b).filter(r => kind(r) === '_stair_handoff'); if (ho.length && Date.now() - placedAt > 4 * 60_000) break; continue }
    if (atExit(last)) { outAt ??= Date.now(); if (Date.now() - outAt > 20_000) break } else outAt = null
  }
  const rows = rowsOf(b).filter(r => !(Date.parse(r['@timestamp']) < placedAt))
  await stopBot(b)
  const tr = truth()
  const pick = re => rows.filter(r => re.test(kind(r))).map(r => ({ t: r['@timestamp'].slice(11, 23), k: kind(r), s: r.skill?.status, d: String(r.skill?.detail ?? '').slice(0, 170), y: r.bot?.pos?.y }))
  const kinds = {}; for (const r of rows) { const k = kind(r); if (k) kinds[k] = (kinds[k] || 0) + 1 }
  const handoffs = pick(/^_stair_handoff$/)
  const trail = pick(/^_(stair_handoff|shaft|marooned|entombed|maroon_|escape_guard|inventory_mutation|needs_rescue|escape_lattice)/)
  const extraK = new Set(extra.map(c => c.join(',')))
  const airBadNotScene = tr.air.bad.filter(k => !extraK.has(k))
  const placedInStair = rows.filter(r => kind(r) === '_inventory_mutation').length
  let ok = null, verdict = ''
  const entombedWhileGoto = rows.filter(r => kind(r) === '_entombed').length
  if (name === 'blocked') {
    ok = atExit(last) && handoffs.some(h => /then=out/.test(h.d)) && !tr.solid.bad.length && !tr.air.bad.length
    verdict = 'handed over, out at the collar, every planned cell as planned (the dirt dug, nothing else)'
  } else if (name === 'blocked_base' || name === 'descend_base') {
    ok = handoffs.length === 0
    verdict = 'CONTROL: no hand-over with SHAFTTRAP=0; what the base does is recorded (trail, cells)'
  } else if (name === 'descend') {
    ok = arrivedAt != null && entombedWhileGoto === 0 && !tr.solid.bad.length && !tr.air.bad.length
    verdict = 'the walk down the stair is not cut short by the entombed arm; it arrives at the 16 stub end; the stair as planned'
  } else if (name === 'tread') {
    const ft = handoffs.filter(h => /then=fallthrough/.test(h.d) && /egress=tread/.test(h.d))
    const i = trail.findIndex(x => x.k === '_stair_handoff')
    const after = i >= 0 ? trail.slice(i + 1, i + 6).map(x => x.k) : []
    ok = ft.length >= 1 && handoffs.filter(h => /k=44 /.test(h.d)).length === 1 && after.some(k => /^_(marooned|entombed|maroon_|escape|inventory_mutation)/.test(k))
    verdict = 'one hand-over from step 44 (tread -> fallthrough), then the arm\'s own escape; not again from that step'
  }
  const res = { at: new Date().toISOString(), sha, server: SERVER, scene: name, ok, verdict, minutes: MINUTES,
    end: last, atExit: atExit(last), exit: EXIT, arrived: arrivedAt != null, entombedRows: entombedWhileGoto, handoffs, trail: trail.slice(0, 40), kinds,
    truth: { air_ok: tr.air.ok, air_bad: tr.air.bad, air_bad_not_scene: airBadNotScene, solid_ok: tr.solid.ok, solid_bad: tr.solid.bad }, inventoryMutations: placedInStair,
    synthetic: 'arena + stair carved by RCON from shaftgeom plan; stair record written to the pool dir; bot placed by tp with a fleet-like bag; scene blocks by RCON; model off (reflexes only)' }
  fs.appendFileSync(RES, JSON.stringify(res) + '\n')
  P_('RESULT', { scene: name, ok, atExit: res.atExit, handoffs, solid_bad: tr.solid.bad.length, air_bad: tr.air.bad.length, kinds })
}

try {
  let pl = r1('list')
  for (let k = 0; k < 30 && !/There are 0 of/.test(pl); k++) { await sleep(2000); pl = r1('list') }
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_('arena', { server: SERVER, sha, origin: ORIGIN, away: AWAY, K: PLAN.K, exit: EXIT })
  arena()
  await sleep(2000)
  const t0 = truth()
  if (t0.air.bad.length || t0.solid.bad.length) throw new Error('the stair did not carve as planned: ' + JSON.stringify({ air: t0.air.bad.length, solid: t0.solid.bad.length }))
  for (const s of SCENES_S.split(',')) await scene(s)
} catch (e) {
  P_('FATAL', String(e?.stack ?? e).slice(0, 800))
  fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), sha, ok: false, error: String(e?.stack ?? e).slice(0, 600) }) + '\n')
} finally {
  for (const c of procs) { try { c.kill('SIGKILL') } catch {} }
  try { rcon(`kick ${NAME} done`, `forceload remove ${C.x - HALF - 30} ${C.z - HALF} ${C.x + HALF} ${C.z + HALF}`) } catch {}
  process.exit(0)
}
