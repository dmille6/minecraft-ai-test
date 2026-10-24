#!/usr/bin/env node
// FAILMINE SCENE DRIVER (2026-10-24). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/failmine-2026-10-24.md section 4. The scene format is scripts/host/failmine/failmine.py's
// (schema failmine-scene/1); the library is sandbox/scenes/.
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot>/bots, so whatever the build does at that place runs exactly
// as on the fleet. WHAT IS SYNTHETIC, said in every result row:
//   - the arena: the scene's cut of a fleet region COPY, cell for cell with full block states, set with `strict` (no block
//     updates while building: water and lava stand as they were saved until something touches them), translated in x/z to
//     a far corner of the sandbox (y is kept: depth-dependent code sees the fleet's depth), inside a 2-block stone shell
//     (open above when the cut's top layer is open); block entities (chest contents, furnace state) are not copied;
//   - the bot is teleported to the scene's start and given its fleet bag (bot.inventory + tool durability);
//   - the fleet's gamerules for that world are set for the run and restored afterwards;
//   - `script`: the scene's recorded skill is answered by the sandbox brain (sandbox/sandbox-brain.mjs) on loopback;
//     without one the model is off (LLM_ENABLED=false) and the reflex loop drives the bot.
// OUTCOMES FROM THE WORLD: position and health by RCON (`data get entity`), the death message from the bot's own `_death`
// row, classified by failmine.py's own table (the same one the clusters were built with).
//
//   node sandbox/failmine/scene-e2e.mjs <botRoot> <label> <scene.json> [server] [minutes]
// sandbox5..sandbox8 only, and only under that server's OWN per-server lock with `failmine` as its owner's first word (the
// global lock alone is refused: Codex r1 P2). The verdict is oracle.mjs's (a pure function, tested in bots/test/failmine.test.mjs).
// World edits on its own arena only; cleanup leaves the arena a plain stone block (not the sandbox's original terrain), and
// the holding pad's 3x5x3 stone block 20 west of it stays (harmless, sandbox only).
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { decide, fidelityProbes } from './oracle.mjs'
import { createHash } from 'node:crypto'

const [BOT_ROOT, LABEL, SCENE_FILE, SERVER = 'sandbox6', MIN_S, START_S = '0'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENE_FILE) throw new Error('usage: scene-e2e.mjs <botRoot> <label> <scene.json> [server] [minutes] [start#]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
// the owner's scope: the four new sandboxes (sandbox4 is the model benchmark's; sandbox..sandbox3 belong to older drivers)
const ALLOWED = ['sandbox5', 'sandbox6', 'sandbox7', 'sandbox8']
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => ALLOWED.includes(n)))
if (!PORTS[SERVER]) throw new Error(`failmine runs on ${ALLOWED.join(', ')} only, not ${SERVER}`)
// THE RUN'S OWNER (lavasight-01, 10-24): `failmine` by default; FM_TAG names another owner's per-server lock (a fix's own
// Paper runs on the library, e.g. `lavasight`). It changes WHO may run, never how many: the lock verdict is unchanged
// (every lock covering SERVER absent or owned by exactly this tag, at least one held, and it must be the per-server one).
const TAG = process.env.FM_TAG || 'failmine'
if (!/^[A-Za-z0-9][A-Za-z0-9._]*(-[A-Za-z0-9._]+)*$/.test(TAG)) throw new Error(`FM_TAG must be a lock tag word: ${JSON.stringify(TAG)}`)
const LOCK = TAG === 'failmine' ? sbx.requireSandboxLock(SERVER, 'failmine') : sbx.requireSandboxLock(SERVER, TAG)
// THE PER-SERVER LOCK, judged from the STRUCTURED probe (Codex lavasight-driver P2): the verdict string above is human-readable
// and an owner note could carry "per-server: <tag>" in a global lock's text
{
  const locks = sbx.parseProbe(execFileSync('ssh', ['-o', 'BatchMode=yes', sbx.REGISTRY.lockHost, sbx.probeCmd(SERVER)], { encoding: 'utf8' }), SERVER)
  if (locks.server === null || !sbx.ownerNames(locks.server, TAG)) throw new Error(`take ${SERVER}'s own lock (sandbox/sbxlock.sh take ${SERVER} ${TAG}): ${LOCK}`)
}
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FM = path.join(REPO, 'scripts/host/failmine/failmine.py')
// THE LIBRARY CONTRACT IS PYTHON'S (one implementation): a scene that does not validate is never built
const valid = JSON.parse(execFileSync('python3', ['-B', FM, 'validate', SCENE_FILE], { encoding: 'utf8' }))
const S = JSON.parse(fs.readFileSync(SCENE_FILE, 'utf8'))
const MINUTES = Number(MIN_S || S.oracle.minutes)
// START 0 is the scene's own; 1.. are its alternates (other deaths of the cluster in the same world): position, bag, script
const START = Number(START_S)
const ALT = START ? (S.alternates || [])[START - 1] : null
if (START && !ALT) throw new Error(`scene ${S.id} has ${(S.alternates || []).length} alternate start(s), not ${START}`)
const ST = ALT ? { pos: ALT.pos, bag: ALT.bag, script: ALT.script, death: ALT.death, health: ALT.health ?? ALT.bag.health }
  : { pos: S.bot.pos, bag: S.bot.bag, script: S.script, death: S.death, health: S.bot.bag.health }
const OUT = process.env.FM_OUT || path.join(os.tmpdir(), 'failmine-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const RUN = fs.mkdtempSync(path.join(OUT, `${LABEL}-${S.id.slice(0, 40)}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL}/${S.id} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let stopping = false
// THE BUILD'S SHA decides base vs candidate in the proof (Claude r1 P2): git only when BOT_ROOT IS the repository's top (a
// `git archive` extract inside another checkout would report THAT checkout's HEAD), else its SHA file, else refuse
let sha = null
try {
  const top = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  if (fs.realpathSync(top) === fs.realpathSync(BOT_ROOT)) sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {}
if (!sha) { try { sha = fs.readFileSync(path.join(BOT_ROOT, 'SHA'), 'utf8').trim() } catch {} }
if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error(`cannot tell which build ${BOT_ROOT} is (no repository top, no 40-hex SHA file)`)

// ---------------------------------------------------------------- RCON (sandbox only, through the worlds host's helper)
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fm-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 600000, maxBuffer: 256 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const BAD = /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid|No blocks were filled/i
function batch (cmds, what = 'rcon') {
  const out = []
  for (let i = 0; i < cmds.length; i += 500) out.push(...rcon(...cmds.slice(i, i + 500)))
  const bad = out.filter(x => BAD.test(x.reply) && !/No blocks were filled/.test(x.reply))
  if (bad.length) throw new Error(`${what}: ` + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const POS_RE = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/
function observe (name) {
  const [p, h] = rcon(`data get entity ${name} Pos`, `data get entity ${name} Health`)
  const m = POS_RE.exec(p?.reply ?? ''), mh = /([\d.]+)f/.exec(h?.reply ?? '')
  return { pos: m ? { x: +m[1], y: +m[2], z: +m[3] } : null, health: mh ? +mh[1] : null, at: Date.now() }
}
const posOf = name => { const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(r1(`data get entity ${name} Pos`)); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
const healthOf = name => { const m = /([\d.]+)f/.exec(r1(`data get entity ${name} Health`)); return m ? +m[1] : null }

// ---------------------------------------------------------------- the arena: the cut, translated
const C = S.cells
const [OX, OY, OZ] = C.origin
const [SX, SY, SZ] = C.size
const slot = [...S.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 24
const SIDX = Object.keys(sbx.PORTS).indexOf(SERVER)
// the arena's min corner in the sandbox: 4800..7008 x, 6400..7072 z -- clear of poolescape's 5200..5320 z 5200 strip, and
// well inside WORLD_BORDER_RADIUS below (the bot measures its border from 0,0: an arena at 8000,8000 put every relocation
// "12198 blocks out" and refused it, which the fleet bot never meets -- first fall run, 10-24)
const BX = 4800 + 96 * slot, BZ = 6400 + 96 * SIDX
const DX = BX - OX, DZ = BZ - OZ                          // fleet -> sandbox translation (y unchanged)
const M = 2                                               // shell
const lo = { x: BX - M, y: Math.max(-64, OY - M), z: BZ - M }, hi = { x: BX + SX - 1 + M, y: Math.min(319, OY + SY - 1 + M), z: BZ + SZ - 1 + M }
const names = C.palette
const nameOf = s => s.split('[')[0]
const FLUID = s => /^(water|lava|bubble_column)(\[|$)/.test(s)
function flat () { const f = []; for (let k = 0; k < C.rle.length; k += 2) for (let n = 0; n < C.rle[k + 1]; n++) f.push(C.rle[k]); return f }
const FLAT = flat()
if (FLAT.length !== SX * SY * SZ) throw new Error('rle length mismatch')
const at = (x, y, z) => FLAT[(y * SZ + z) * SX + x]                 // cut-local
// THE HOLDING PAD: a stone block AT THE START'S HEIGHT, 20 blocks west of the arena (its own forceloaded chunk). It used to
// sit 14 above the arena's top, and the teleport down from it reached the bot as a fall: every lava proof died "after
// falling 24-41 blocks" (the bot's own fall tracker), a descent the fleet bot never made. Level, the teleport is not a fall.
const PAD = { x: lo.x - 20, y: Math.max(-63, Math.floor(ST.pos[1]) - 1), z: BZ }   // the floor never below the world
const topOpen = (() => { let open = 0; for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) if (/^(air|cave_air)$/.test(nameOf(names[at(x, SY - 1, z)]))) open++; return open / (SX * SZ) >= 0.3 })()
function arenaCmds () {
  const c = [`kill @e[type=!player,x=${lo.x},y=${lo.y},z=${lo.z},dx=${hi.x - lo.x},dy=${hi.y - lo.y + 14},dz=${hi.z - lo.z}]`]
  for (let y = lo.y; y <= hi.y; y++) c.push(`fill ${lo.x} ${y} ${lo.z} ${hi.x} ${y} ${hi.z} minecraft:stone strict`)
  if (topOpen) for (let y = OY + SY; y <= Math.min(319, OY + SY + 12); y++) c.push(`fill ${lo.x} ${y} ${lo.z} ${hi.x} ${y} ${hi.z} minecraft:air strict`)
  c.push(`fill ${PAD.x - 1} ${PAD.y - 1} ${PAD.z - 1} ${PAD.x + 1} ${PAD.y + 3} ${PAD.z + 1} minecraft:stone strict`,
         `fill ${PAD.x} ${PAD.y + 1} ${PAD.z} ${PAD.x} ${PAD.y + 2} ${PAD.z} minecraft:air strict`)
  // SOLIDS FIRST, bottom up, then fluids: a fluid never meets a cell that is about to change; `strict` sends no updates
  for (const pass of ['solid', 'fluid']) {
    for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) {
      let x = 0
      while (x < SX) {
        const i = at(x, y, z); let x2 = x
        while (x2 + 1 < SX && at(x2 + 1, y, z) === i) x2++
        const st = names[i]
        if ((pass === 'fluid') === FLUID(st) && st !== 'stone') {
          const wy = OY + y, wz = BZ + z
          c.push(x === x2 ? `setblock ${BX + x} ${wy} ${wz} minecraft:${st} strict` : `fill ${BX + x} ${wy} ${wz} ${BX + x2} ${wy} ${wz} minecraft:${st} strict`)
        }
        x = x2 + 1
      }
    }
  }
  return c
}
// fidelity: the scene's named checks, then a deterministic sample of every 37th cell, by block name
function fidelity () {
  const probes = fidelityProbes(S, BX, BZ, 37)
  const r = rcon(...probes.map(p => `execute if block ${p.x} ${p.y} ${p.z} minecraft:${p.is}`))
  const bad = probes.filter((p, i) => !/Test passed/.test(r[i]?.reply ?? ''))
  return { probes: probes.length, mismatched: bad.length, checksFailed: bad.filter(p => p.check).map(p => `${p.x - DX},${p.y},${p.z - DZ}:${p.is}`), share: +(1 - bad.length / probes.length).toFixed(4), mode: 'full-state' }
}

// ---------------------------------------------------------------- the bot
const bag = ST.bag.stacks.slice(0, 36)
const dropped = ST.bag.stacks.length - bag.length
const bname = `fm${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 5)}${S.id.replace(/[^a-z0-9]/gi, '').slice(0, 9)}`.slice(0, 16)
const home = S.home ? S.home.map((v, i) => v + [DX, 0, DZ][i]) : [BX + SX + 40, OY + SY + 1, BZ]
const BRAIN_PORT = 11540 + SIDX
const scriptLine = () => {
  const s = ST.script; if (!s) return null
  const a = s.args || {}
  if (s.skill === 'goto') return `goto ${a.x + DX} ${a.y} ${a.z + DZ}`
  if (s.skill === 'gather') return `gather ${a.count ?? ''} ${a.block}`.replace(/\s+/g, ' ')
  if (s.skill === 'mine') return `mine ${a.y}`
  if (s.skill === 'explore') return `explore ${a.blocks ?? ''}`.trim()
  if (s.skill === 'craft') return `craft ${a.count ?? ''} ${a.item}`.replace(/\s+/g, ' ')
  return s.skill
}
const procs = []
function launchBrain (line) {
  // answers `status` until the bot is placed, then the scene's skill on every decision (its last line repeats)
  const child = spawn(process.execPath, [path.join(REPO, 'sandbox/sandbox-brain.mjs'), String(BRAIN_PORT)], {
    env: { ...process.env, SANDBOX_SCRIPT: line, SANDBOX_DELAY_MS: '45000' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(RUN, 'brain.out')); child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return child
}
function launchBot (llm) {
  if (stopping) throw new Error('stopping: no bot is launched once the cleanup has begun')
  const dir = path.join(RUN, bname)
  for (const d of ['log', 'state', 'pool']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  const env = { ...process.env,
    BOT_NAME: bname, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxfm-${LABEL}-${slot}`, POOL_STATE_DIR: path.join(dir, 'pool'), MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '16000', BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: llm ? 'true' : 'false', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`,
    OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '8000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-fm-${LABEL}`, RUN_ID: 'sandbox-failmine', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(home[0]), HOME_Y: String(home[1]), HOME_Z: String(home[2]), BOARD_X: String(home[0]), BOARD_Y: String(home[1]), BOARD_Z: String(home[2]) }
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'bot.out')); child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return { name: bname, dir, child, log: path.join(dir, 'log', `skill-${bname}.jsonl`) }
}
const rowsOf = b => { try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const kind = r => r?.skill?.name ?? ''
const classify = msg => JSON.parse(execFileSync('python3', ['-B', FM, 'classify', msg], { encoding: 'utf8' }))
const ruleNames = Object.keys(S.gamerules || {})
let savedRules = null
let placedAt = Infinity
let hookNote = null
// THE DRIVER'S OWN IDENTITY in every result row (Claude r5 P3): which code built the arena and judged the run
const DRIVER_SHA256 = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).update(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'oracle.mjs'))).digest('hex')

async function main () {
  let pl = r1('list')
  for (let k = 0; k < 30 && !/There are 0 of/.test(pl); k++) { await sleep(2000); pl = r1('list') }
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scene=${S.id} label=${S.label} cells=${valid.cells} arena=${BX},${OY},${BZ} (dx ${DX}, dz ${DZ}) topOpen=${topOpen} script=${scriptLine()}`)
  const saved = Object.fromEntries(ruleNames.map(g => [g, (/set to: (\S+)/.exec(r1(`gamerule ${g}`)) || [])[1]]))
  const unread = Object.entries(saved).filter(([, v]) => v == null).map(([g]) => g)
  if (unread.length) throw new Error(`cannot read the sandbox's current gamerule(s) ${unread.join(', ')}: refusing to change what cannot be restored`)
  savedRules = saved
  batch(ruleNames.map(g => `gamerule ${g} ${S.gamerules[g]}`), 'gamerules')
  // THE DEATH COUNTER, independent of the bot's own logging (Claude r1 P1)
  rcon('scoreboard objectives add fmdeaths deathCount')
  r1(`forceload add ${lo.x} ${lo.z} ${hi.x} ${hi.z}`)
  r1(`forceload add ${PAD.x} ${PAD.z}`)
  await sleep(3000)
  const cmds = arenaCmds()
  P_(`building: ${cmds.length} commands`)
  batch(cmds, 'arena')
  await sleep(2000)
  const fid = fidelity()
  P_('fidelity', fid)
  // A SCENE THAT DID NOT SET IS NOT A SCENE: abort rather than judge a bot against some other place
  if (fid.checksFailed.length || fid.share < 0.98) throw new Error('arena did not set: ' + JSON.stringify(fid))
  const line = scriptLine()
  if (line) launchBrain(line)
  // AN OPTIONAL POOL FILE before the bot starts (lavasight-01: the per-world lava map it reads at spawn). FM_POOL_HOOK is a
  // module exporting prepare({ poolDir, pool, DX, DZ, scene, start, seed }); it is handed the sandbox's seed STRING, not RCON
  // (Claude lavasight-driver P3-2: a hook must not be able to change the world), and is meant to write only in poolDir.
  if (process.env.FM_POOL_HOOK) {
    const poolDir = path.join(RUN, bname, 'pool'); fs.mkdirSync(poolDir, { recursive: true })
    const hook = await import(path.resolve(process.env.FM_POOL_HOOK))
    const seed = (/\[(-?\d+)\]/.exec(r1('seed')) || [])[1] ?? null
    hookNote = await hook.prepare({ poolDir, pool: `sbxfm-${LABEL}-${slot}`, DX, DZ, scene: S, start: ST, seed })
    P_('pool hook', hookNote)
  }
  const b = launchBot(!!line)
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(b.name)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join: ' + r1('list'))
  const sp = ST.pos
  // PLACEMENT, in two steps (first contact-start run, 10-24: teleported straight into lava, the bot burned for the 4 s
  // its chunks took to arrive, and the health set afterwards then killed it with a GENERIC death -- not the fleet's):
  //   1. bag and gamemode at the join point, then a wait on the HOLDING PAD (level with the start, beside the arena) until chunks are in;
  //   2. ONE batch: the fleet health (generic damage, applied on the pad) and the teleport to the start.
  batch([`scoreboard players set ${b.name} fmdeaths 0`], 'death counter')
  const placed = rcon(`gamemode survival ${b.name}`, `clear ${b.name}`, `effect clear ${b.name}`, `tp ${b.name} ${PAD.x + 0.5} ${PAD.y + 1} ${PAD.z + 0.5}`,
    ...bag.map((it, i) => `item replace entity ${b.name} container.${i} with minecraft:${it.id}${it.damage != null ? `[damage=${it.damage}]` : ''} ${it.count}`))
  const badGive = placed.filter(x => BAD.test(x.reply))
  if (badGive.length) throw new Error('placing the bot: ' + badGive.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  await sleep(5000)
  const h0 = Number(ST.health)
  rcon(...(h0 > 0 && h0 < 20 ? [`damage ${b.name} ${(20 - h0).toFixed(1)} minecraft:generic`] : []), `tp ${b.name} ${sp[0] + DX} ${sp[1]} ${sp[2] + DZ}`)
  placedAt = Date.now()
  await sleep(600)
  const start = posOf(b.name)
  if (!start) throw new Error('the bot was not observed after placement')
  P_('placed', start, { stacks: bag.length, dropped })
  const F = S.oracle.from_cell ?? ST.pos.map(Math.floor)
  const cellOf = p => [Math.floor(p.x - DX), Math.floor(p.y), Math.floor(p.z - DZ)]
  const inArena = p => p && p.x >= lo.x && p.x <= hi.x + 1 && p.z >= lo.z && p.z <= hi.z + 1 && p.y >= lo.y - 1 && p.y <= hi.y + 14
  const isOut = p => { if (!p) return false; const c = cellOf(p); return Math.max(Math.abs(c[0] - F[0]), Math.abs(c[2] - F[2])) >= (S.oracle.min_horizontal ?? 2) || c[1] - F[1] >= (S.oracle.min_up ?? 2) }
  const deadline = Date.now() + MINUTES * 60_000
  let outAt = null, minHealth = 20, maxDist = 0, lastPos = start, lastSeen = Date.now(), maxGapS = 0, polls = 0, missed = 0, lastHealth = null
  const deathRows = () => rowsOf(b).filter(r => kind(r) === '_death')
  while (Date.now() < deadline) {
    await sleep(3000)
    if (deathRows().length) break
    if (b.child.exitCode !== null || b.child.signalCode !== null) break
    const o = observe(b.name); polls++
    if (o.pos && o.health != null) {
      maxGapS = Math.max(maxGapS, (o.at - lastSeen) / 1000); lastSeen = o.at; lastPos = o.pos; lastHealth = o.health
      minHealth = Math.min(minHealth, o.health)
      maxDist = Math.max(maxDist, Math.hypot(o.pos.x - start.x, o.pos.y - start.y, o.pos.z - start.z))
      if (o.health <= 0) break
    } else { missed++; maxGapS = Math.max(maxGapS, (o.at - lastSeen) / 1000) }
    if (S.oracle.type === 'escape') {
      if (o.pos && isOut(o.pos) && inArena(o.pos)) { outAt ??= Date.now(); if (Date.now() - outAt >= (S.oracle.hold_s ?? 20) * 1000) break } else outAt = null
    }
  }
  await sleep(2000)
  const fin = observe(b.name)
  if (fin.pos && fin.health != null) { maxGapS = Math.max(maxGapS, (fin.at - lastSeen) / 1000); lastSeen = fin.at; lastPos = fin.pos; lastHealth = fin.health }
  const rows = rowsOf(b)
  const dRows = rows.filter(r => kind(r) === '_death')
  const died = dRows.length ? String(dRows[0].skill.detail || '') : null
  const dc = died ? classify(died.split(';')[0].split('|')[0].trim()) : null
  const dp = dRows[0]?.bot?.pos
  const scoreTxt = r1(`scoreboard players get ${b.name} fmdeaths`)
  const ms = /has (\d+) \[/.exec(scoreTxt)
  const obs = { deathsLog: dRows.length, deathsScore: ms ? Number(ms[1]) : null, deathFamily: dc?.family ?? null,
    deathCell: dp ? cellOf(dp) : null, childExited: b.child.exitCode !== null || b.child.signalCode !== null,
    maxGapS, lastSeenAgoS: (Date.now() - lastSeen) / 1000, endHealth: lastHealth,
    outHeldS: outAt && lastPos && isOut(lastPos) ? (Date.now() - outAt) / 1000 : 0, inArenaEnd: inArena(lastPos) }
  const end = lastPos
  const verdict = decide(S.oracle, obs, { deathCell: ST.death?.pos ? ST.death.pos.map(Math.floor) : null })
  const { outcome, pass } = verdict
  const matched = verdict.matched_fleet
  // only rows logged AFTER the teleport to the start: the holding pad is an enclosed pocket, and its own `_entombed` would
  // otherwise count toward the overlap with the fleet's rows (Claude r5 P3)
  const kinds = {}
  for (const r of rows) {
    const t = Date.parse(r['@timestamp'] ?? r.ts ?? '')
    const k = kind(r); if (k && !(t < placedAt)) kinds[k] = (kinds[k] || 0) + 1
  }
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 14)
  // MECHANISM, not just outcome: which of the fleet bot's own top row kinds at this site the sandbox bot also logged
  const fk = (S.fleet_kinds || []).map(([k]) => k)
  const mechanism = fk.length ? { fleet: fk, seen: fk.filter(k => kinds[k]), share: +(fk.filter(k => kinds[k]).length / fk.length).toFixed(2) } : null
  const ev = { at: new Date().toISOString(), run_dir: path.resolve(RUN), placed_at: new Date(placedAt).toISOString(), pool_hook: hookNote, label: LABEL, scene: S.id, cells_sha256: S.cells_sha256, sceneLabel: S.label, sha, server: SERVER, minutes: MINUTES, outcome, pass,
    matched_fleet: matched, start_index: START, driver_sha256: DRIVER_SHA256, observation: { ...obs, polls, missed }, fleet: ALT ? `${ALT.death?.bot} ${ALT.death?.t}: ${String(ALT.death?.detail || '').slice(0, 160)}` : S.base.fleet, death: died ? died.slice(0, 220) : null, deathClass: dc,
    start: start && [start.x, start.y, start.z].map(v => +v.toFixed(2)), end: end && cellOf(end), maxDistance: +maxDist.toFixed(1),
    minHealth, fidelity: fid, mechanism, rows: rows.length, topKinds: top, kinds, script: scriptLine(), bagStacks: bag.length, bagDropped: dropped,
    detail: `${outcome}; moved max ${maxDist.toFixed(1)} blocks; min health ${minHealth}`,
    synthetic: 'cut from a fleet region copy (strict placement, no block entities), x/z translated; bot teleported in with its fleet bag; fleet gamerules; ' + (scriptLine() ? `scripted skill "${scriptLine()}"` : 'model off') }
  fs.appendFileSync(RES, JSON.stringify(ev) + '\n')
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
    const c = [`kill @e[type=!player,x=${lo.x},y=${lo.y},z=${lo.z},dx=${hi.x - lo.x},dy=${hi.y - lo.y + 14},dz=${hi.z - lo.z}]`]
    for (let y = lo.y; y <= hi.y; y++) c.push(`fill ${lo.x} ${y} ${lo.z} ${hi.x} ${y} ${hi.z} minecraft:stone strict`)
    c.push(`forceload remove ${lo.x} ${lo.z} ${hi.x} ${hi.z}`, `forceload remove ${PAD.x} ${PAD.z}`)
    if (savedRules) for (const [g, v] of Object.entries(savedRules)) if (v != null) c.push(`gamerule ${g} ${v}`)
    batch(c, 'cleanup')
    P_('cleanup', r1('list').slice(0, 80))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; cleanup().then(() => process.exit(1)) })
