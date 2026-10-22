#!/usr/bin/env node
// poolescape-01 PAPER DRIVER (2026-10-22). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/poolescape-01-design-2026-10-22.md section 6.
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot> (the model off), so the reflex loop's own marooned check,
// the pillar that cannot rise, and (on a candidate) the pool rung run exactly as on the fleet. WHAT IS SYNTHETIC, said so in
// every result row:
//   - the arena: a LIVE pit copied cell for cell from board-d's region files (bots/test/fixtures/poolescape-board-d-*.json,
//     200 of 200 core cells matched the live world by read-only RCON on 10-22), set into a stone plain on the sandbox whose
//     top is level with the pit's rim; block states beyond the name (facing, waterlogged) are defaults;
//   - the bot is teleported into the pit and given the trapped bot's tools and blocks (from its last live snapshot);
//   - scene `lava`: lava set behind the pit's preferred (north) wall; scene `zone`: a protected-zones.json covering the
//     whole arena in the bot's own pool state dir.
// OUTCOMES FROM THE WORLD: the bot's position and health by RCON (`data get entity`), the cells around the pit read back by
// `execute if block`, and the build's own rows (`_marooned`, `_poolescape_start`, `_poolescape`, `_death`) from its log.
//
//   node sandbox/poolescape/poolescape-e2e.mjs <botRoot> <label> <scene> [server] [minutes]
//   scenes: bravo   board-d-Bravo/Comet's pit (329,61,213) with TWO bots in the one cell, as on the fleet
//           alpha   board-d-Alpha's pit (555,61,116): a 1x1 gap in a bridge on a lake, every feet-level side water
//           lava    the bravo pit with a lava pocket behind its north wall (one bot)
//           zone    the bravo pit inside a protected zone (one bot)
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `poolescape` as its owner's first word.
// World edits on its own arena only.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, LABEL, SCENE, SERVER = 'sandbox5', MIN_S = '9'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENE) throw new Error('usage: poolescape-e2e.mjs <botRoot> <label> <scene> [server] [minutes]')
if (!['bravo', 'alpha', 'lava', 'zone'].includes(SCENE)) throw new Error(`unknown scene ${SCENE}`)
// sandbox names/ports and the lock from the shared registry (sandbox/sandboxes.json via sandbox/lib/sbxlock.cjs);
// sandbox4 stays excluded: it is the model benchmark's
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'poolescape')
const MINUTES = Number(MIN_S)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = process.env.PE_OUT || path.join(os.tmpdir(), 'poolescape-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const RUN = fs.mkdtempSync(path.join(OUT, `${LABEL}-${SCENE}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL}/${SCENE} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let sha = 'unknown'
try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { try { sha = fs.readFileSync(path.join(BOT_ROOT, 'SHA'), 'utf8').trim() } catch {} }

// ---------------------------------------------------------------- RCON (sandbox only, through the worlds host's helper)
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-pe-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
// `Could not set the block` is setblock's answer when the cell already holds that block: not a failure
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

// ---------------------------------------------------------------- the arena
const FIX = { bravo: 'bravo', lava: 'bravo', zone: 'bravo', alpha: 'alpha' }[SCENE]
const fixture = JSON.parse(fs.readFileSync(path.join(REPO, `bots/test/fixtures/poolescape-board-d-${FIX}.json`), 'utf8'))
const A = { x: 5200 + 40 * ['bravo', 'alpha', 'lava', 'zone'].indexOf(SCENE), y: 100, z: 5200 }   // the pit's feet cell
const R = 14
const stateOf = raw => {
  const s = String(raw)
  if (s === '?' || s === 'air?') return 'stone'
  const m = /^water\[(\d+)\]$/.exec(s)
  if (m) return `water[level=${Math.min(15, Number(m[1]))}]`
  return s.replace(/\[wl\]$/, '').replace(/^bubble_column$/, 'water')
}
function arenaCmds () {
  const c = [`kill @e[type=!player,x=${A.x - R},y=${A.y - 8},z=${A.z - R},dx=${2 * R},dy=24,dz=${2 * R}]`]
  for (let dy = -8; dy <= 12; dy++) c.push(`fill ${A.x - R} ${A.y + dy} ${A.z - R} ${A.x + R} ${A.y + dy} ${A.z + R} minecraft:${dy <= 1 ? 'stone' : 'air'}`)
  const cells = Object.entries(fixture.cells).map(([k, v]) => [k.split(',').map(Number), stateOf(v)])
  // solids first, then water, so a source never flows into a cell that is about to be set solid
  const wet = ([, v]) => /^water/.test(v)
  for (const [[dx, dy, dz], v] of [...cells.filter(e => !wet(e)), ...cells.filter(wet)]) c.push(`setblock ${A.x + dx} ${A.y + dy} ${A.z + dz} minecraft:${v}`)
  // THE LAVA POCKET, ENCASED: a lava block set beside water turns to obsidian/stone at once (the first run of this scene did
  // exactly that), so the pocket behind the north wall is walled in stone on its other five sides before the lava goes in
  if (SCENE === 'lava') {
    c.push(`fill ${A.x - 1} ${A.y} ${A.z - 3} ${A.x + 1} ${A.y + 2} ${A.z - 2} minecraft:stone`)
    c.push(`setblock ${A.x} ${A.y + 1} ${A.z - 2} minecraft:lava`)
  }
  return c
}

// ---------------------------------------------------------------- the bots
const BAGS = {
  // board-d-Bravo's last snapshot (10-22 17:2xZ): iron 0/250, stone 0 and 110 of 131, 91 cobblestone, 10 dirt, 64 oak logs
  Bravo: ['iron_pickaxe[damage=0] 1', 'stone_pickaxe[damage=0] 1', 'stone_pickaxe[damage=110] 1', 'cobblestone 64', 'cobblestone 27', 'dirt 10', 'oak_log 64', 'bamboo 64', 'torch 10'],
  // board-d-Comet: stone 116, 121, 0 of 131; 61 oak logs
  Comet: ['stone_pickaxe[damage=116] 1', 'stone_pickaxe[damage=121] 1', 'stone_pickaxe[damage=0] 1', 'oak_log 61', 'torch 27', 'glass 11'],
  // board-d-Alpha: stone 0/131, wooden 16 and 52 of 59, 16 oak logs, ladders, glass
  Alpha: ['stone_pickaxe[damage=0] 1', 'wooden_pickaxe[damage=16] 1', 'wooden_pickaxe[damage=52] 1', 'oak_log 16', 'ladder 17', 'glass 11', 'oak_slab 5'],
}
const who = SCENE === 'bravo' ? ['Bravo', 'Comet'] : SCENE === 'alpha' ? ['Alpha'] : ['Bravo']
const nameOf = w => `pe${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 6)}${w.slice(0, 3)}${SCENE.slice(0, 2)}`.slice(0, 16)
const procs = []
function launch (w) {
  const name = nameOf(w)
  const dir = path.join(RUN, name)
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
  const poolDir = path.join(dir, 'pool'); fs.mkdirSync(poolDir, { recursive: true })
  if (SCENE === 'zone') {
    fs.writeFileSync(path.join(poolDir, 'protected-zones.json'), JSON.stringify({ version: 1, world: 'sandbox', zones: [
      { id: 'sbx-pool-zone', kind: 'scenery', label: 'the protected pool (sandbox)', box: [A.x - 6, A.y - 8, A.z - 6, A.x + 6, A.y + 12, A.z + 6] }] }))
  }
  const env = { ...process.env,
    BOT_NAME: name, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxpe-${LABEL}-${SCENE}`, POOL_STATE_DIR: poolDir, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'false', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: 'http://127.0.0.1:11499',
    OLLAMA_BASE_URLS: 'http://127.0.0.1:11499', LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '8000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-pe-${LABEL}`, RUN_ID: 'sandbox-poolescape01', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(A.x + 200), HOME_Y: String(A.y + 2), HOME_Z: String(A.z), BOARD_X: String(A.x + 200), BOARD_Y: String(A.y + 2), BOARD_Z: String(A.z) }
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'bot.out'))
  child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return { w, name, dir, child, log: path.join(dir, 'log', `skill-${name}.jsonl`) }
}
const rowsOf = b => { try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const kind = r => r?.skill?.name ?? ''

async function main () {
  // a previous run's bots can take a few seconds to log out: wait up to 60 s for an empty server, then refuse
  let pl = r1('list')
  for (let k = 0; k < 30 && !/There are 0 of/.test(pl); k++) { await sleep(2000); pl = r1('list') }
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scene=${SCENE} bots=${who.join(',')} arena=${A.x},${A.y},${A.z}`)
  r1(`forceload add ${A.x - R} ${A.z - R} ${A.x + R} ${A.z + R}`)
  await sleep(2000)
  batch(arenaCmds())
  P_('arena set', { feet: isBlock(A.x, A.y, A.z, 'water'), head: isBlock(A.x, A.y + 1, A.z, 'air'), floor: !isBlock(A.x, A.y - 1, A.z, 'water'), lava: SCENE === 'lava' ? isBlock(A.x, A.y + 1, A.z - 2, 'lava') : null })
  const bots = who.map(launch)
  for (let k = 0; k < 60; k++) { await sleep(2000); const l = r1('list'); if (bots.every(b => l.includes(b.name))) break }
  for (const b of bots) {
    const bag = BAGS[b.w]
    rcon(`gamemode survival ${b.name}`, `clear ${b.name}`, `effect clear ${b.name}`, `tp ${b.name} ${A.x + 0.5} ${A.y} ${A.z + 0.5}`,
         ...bag.map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${b.name} container.${9 + i} with minecraft:${id} ${n}` }))
  }
  await sleep(3000)
  // re-set the pit's own water after the teleports (a bot landing can splash nothing, but the order of joins is not ours)
  batch([`setblock ${A.x} ${A.y} ${A.z} minecraft:water`, `setblock ${A.x} ${A.y + 1} ${A.z} minecraft:air`])
  const start = Object.fromEntries(bots.map(b => [b.name, posOf(b.name)]))
  P_('placed', start)
  const deadline = Date.now() + MINUTES * 60_000
  const outAt = {}, minHealth = {}
  const isOut = p => p && (Math.floor(p.y) >= A.y + 1) && !(Math.floor(p.x) === A.x && Math.floor(p.z) === A.z)
  while (Date.now() < deadline) {
    await sleep(5000)
    let all = true
    for (const b of bots) {
      const p = posOf(b.name), h = healthOf(b.name)
      if (h != null) minHealth[b.name] = Math.min(minHealth[b.name] ?? 20, h)
      if (isOut(p)) { outAt[b.name] ??= Date.now() } else { delete outAt[b.name]; all = false }
      if (outAt[b.name] && Date.now() - outAt[b.name] < 20_000) all = false
    }
    if (all) break
  }
  const ev = { scene: SCENE, sha, server: SERVER, bots: [] }
  for (const b of bots) {
    const rows = rowsOf(b)
    const p = posOf(b.name)
    const pe = rows.filter(r => kind(r) === '_poolescape').map(r => String(r.skill.detail).slice(0, 260))
    ev.bots.push({ bot: b.w, name: b.name, start: start[b.name], end: p, escaped: isOut(p), outAfterS: outAt[b.name] ? +((outAt[b.name] - T0) / 1000).toFixed(0) : null,
      minHealth: minHealth[b.name] ?? null, deaths: rows.filter(r => kind(r) === '_death').map(r => String(r.skill.detail).slice(0, 160)),
      licence: rows.some(r => kind(r) === '_poolescape_mode'), marooned: rows.filter(r => kind(r) === '_marooned').length,
      pillarPicks: rows.filter(r => kind(r) === '_scaffold_pick').length, starts: rows.filter(r => kind(r) === '_poolescape_start').length,
      poolescape: pe.slice(0, 6), rows: rows.length })
  }
  // the world around the pit, read back: the four wall cells at head level and the four feet-level side cells
  const around = {}
  for (const [k, dx, dz] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]]) {
    const st = ['air', 'water', 'cobblestone', 'dirt', 'andesite', 'oak_log', 'lava', 'stone'].find(n => isBlock(A.x + dx, A.y + 1, A.z + dz, n)) ?? 'other'
    const tr = ['air', 'water', 'cobblestone', 'dirt', 'andesite', 'oak_log', 'stone', 'crafting_table'].find(n => isBlock(A.x + dx, A.y, A.z + dz, n)) ?? 'other'
    around[k] = { head: st, tread: tr }
  }
  ev.around = around
  if (SCENE === 'lava') ev.lavaPocketStill = isBlock(A.x, A.y + 1, A.z - 2, 'lava')
  ev.synthetic = 'arena copied from the live pit (default block states); bots teleported in and given the live bags; model off'
  fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, ...ev }) + '\n')
  P_('RESULT', ev)
}
async function cleanup () {
  for (const c of procs) { try { c.kill('SIGTERM') } catch {} }
  await sleep(4000)
  try {
    const c = [`kill @e[type=!player,x=${A.x - R},y=${A.y - 8},z=${A.z - R},dx=${2 * R},dy=24,dz=${2 * R}]`]
    for (let dy = -8; dy <= 12; dy++) c.push(`fill ${A.x - R} ${A.y + dy} ${A.z - R} ${A.x + R} ${A.y + dy} ${A.z + R} minecraft:${dy <= 1 ? 'stone' : 'air'}`)
    c.push(`forceload remove ${A.x - R} ${A.z - R} ${A.x + R} ${A.z + R}`)
    batch(c)
    P_('cleanup', r1('list').slice(0, 80))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
