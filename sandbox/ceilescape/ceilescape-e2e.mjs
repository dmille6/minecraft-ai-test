#!/usr/bin/env node
// ceilescape-01 PAPER DRIVER (2026-10-24). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/ceilescape-01-design-2026-10-24.md section 9 (on branch ceilescape-on-3cc5f14d).
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot> (the model off), so the entombed arm's pillar refusals, the
// refusal escalation, the ramp, the float hold, the drowning rescue and the stranded lattice all run exactly as on the fleet.
// WHAT IS SYNTHETIC, said so in every result row:
//   - the arena: a LIVE trap copied cell for cell, WITH block states (water levels, the ladder's facing), from a fresh
//     read-only region copy (<fixtureDir>/arena-*.json, made by make_fixture.py; Comet's arena is 25 x 25 x 25 so it holds
//     the cascade's feed, Claude design r1 P2-9), sealed in a one-block stone shell so no water leaves the copy;
//   - the bot is teleported in and given the trapped bot's tools and blocks (its last live snapshot, 10-24 03:4xZ);
//   - scene edits: `lava` (lava behind the east feet cell, encased), `wethead` (a water source beside the east head cell),
//     `copper2` (a second, dry bearing to the south whose new ceiling is copper).
// OUTCOMES FROM THE WORLD: position and health by RCON (`data get entity`), the exit cells and the ceiling read back by
// `execute if block`, and the build's own rows (`_ceilescape`, `_needs_rescue`, `_entombed_ramp_cut`, `_death`).
//
//   node sandbox/ceilescape/ceilescape-e2e.mjs <botRoot> <label> <scene> <fixtureDir> [server] [minutes]
//   scenes: comet    board-a-Comet's column (359,40,187), the live geometry
//           lava     comet with lava at (361,40,187), behind the east dirt, encased in stone
//           wethead  comet with a water source at (360,41,188), beside the east head cell
//           copper2  comet with a dry south bearing (dirt feet + head) whose new ceiling is copper
//           noexit   placebo-c-Bravo's sealed flooded shaft (559,37,219)
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `ceilescape` as its owner's first
// word. World edits on its own arena only. Cleanup re-sets the driver's OWN stone/air plain there (not the sandbox's original
// terrain).
//   `left`   = the bot's cell is no longer the column (x/z) at the end, it has been out >= 30 s, never dead, in the arena.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, LABEL, SCENE, FIXDIR, SERVER = 'sandbox5', MIN_S = '12'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENE || !FIXDIR) throw new Error('usage: ceilescape-e2e.mjs <botRoot> <label> <scene> <fixtureDir> [server] [minutes]')
const SCENES = ['comet', 'lava', 'wethead', 'copper2', 'noexit']
if (!SCENES.includes(SCENE)) throw new Error(`unknown scene ${SCENE}`)
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'ceilescape')
const MINUTES = Number(MIN_S)
const OUT = process.env.CE_OUT || path.join(os.tmpdir(), 'ceilescape-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const RUN = fs.mkdtempSync(path.join(OUT, `${LABEL}-${SCENE}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL}/${SCENE} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let stopping = false
let sha = 'unknown'
try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}

// ---------------------------------------------------------------- RCON (sandbox only, through the worlds host's helper)
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ce-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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

// ---------------------------------------------------------------- the arena
const FIX = SCENE === 'noexit' ? 'arena-placebo-c-bravo.json' : 'arena-board-a-comet.json'
const fixture = JSON.parse(fs.readFileSync(path.join(FIXDIR, FIX), 'utf8'))
const RX = fixture.radius, DN = fixture.down, UP = fixture.up
const A = { x: 5300 + 64 * SCENES.indexOf(SCENE), y: 100, z: 5300 }   // the bot's FEET cell
const FEET_Y = SCENE === 'noexit' ? 2.2 : 0.2                          // Bravo floats at y 37.2 (anchor 35), Comet at 40.2 (anchor 40)
const stateOf = raw => {
  const s = String(raw)
  const m = /^water\[(\d+)\]$/.exec(s)
  if (m) return `water[level=${Math.min(15, Number(m[1]))}]`
  if (/\[wl\]$/.test(s)) return `${s.replace(/\[wl\]$/, '')}[waterlogged=true]`
  return s
}
const EDITS = {
  comet: {},
  lava: { '2,0,0': 'lava', '3,0,0': 'stone', '2,0,1': 'stone', '2,0,-1': 'stone', '2,1,0': 'stone', '2,-1,0': 'stone' },
  wethead: { '1,1,1': 'water[0]' },
  copper2: { '0,-1,1': 'stone', '0,0,1': 'dirt', '0,1,1': 'dirt', '0,2,1': 'copper_ore', '-1,1,1': 'stone' },
  noexit: {},
}[SCENE]
function arenaCmds () {
  const c = [`kill @e[type=!player,x=${A.x - RX - 1},y=${A.y - DN - 1},z=${A.z - RX - 1},dx=${2 * RX + 2},dy=${DN + UP + 2},dz=${2 * RX + 2}]`]
  // THE SHELL FIRST: one block of stone all round, so the copy's water cannot leave it (and nothing outside reaches in)
  for (let dy = -DN - 1; dy <= UP + 1; dy++) c.push(`fill ${A.x - RX - 1} ${A.y + dy} ${A.z - RX - 1} ${A.x + RX + 1} ${A.y + dy} ${A.z + RX + 1} minecraft:stone`)
  const cells = Object.entries({ ...fixture.cells, ...EDITS }).map(([k, v]) => [k.split(',').map(Number), stateOf(v)])
  const wet = ([, v]) => /^(water|lava)/.test(v)
  for (const [[dx, dy, dz], v] of [...cells.filter(e => !wet(e)), ...cells.filter(wet)]) {
    if (v === 'stone') continue                                       // already stone
    c.push(`setblock ${A.x + dx} ${A.y + dy} ${A.z + dz} minecraft:${v}`)
  }
  return c
}
const at = (dx, dy, dz) => [A.x + dx, A.y + dy, A.z + dz]

// ---------------------------------------------------------------- the bots (their live bags, 10-24 03:4xZ)
const BAGS = {
  Comet: ['wooden_pickaxe[damage=21] 1', 'stone_axe[damage=123] 1', 'stone_sword[damage=24] 1', 'wooden_sword[damage=40] 1', 'crafting_table 7',
          'ladder 2', 'glass 4', 'cobblestone 2', 'dirt 1', 'stick 1', 'bucket 1', 'apple 6', 'melon_slice 51', 'flint 16', 'pointed_dripstone 22'],
  Bravo: ['stone_shovel[damage=121] 1', 'stone_axe[damage=121] 1', 'stone_sword[damage=8] 1', 'wooden_sword 1', 'bamboo 64', 'stick 26',
          'chest 8', 'furnace 2', 'coal 7', 'torch 4', 'glass 6', 'apple 58', 'flint 25'],
}
const who = SCENE === 'noexit' ? 'Bravo' : 'Comet'
const nameOf = w => `ce${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 6)}${w.slice(0, 3)}${SCENE.slice(0, 3)}`.slice(0, 16)
const procs = []
function launch (w) {
  if (stopping) throw new Error('stopping: no bot is launched once the cleanup has begun')
  const name = nameOf(w)
  const dir = path.join(RUN, name)
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
  const poolDir = path.join(dir, 'pool'); fs.mkdirSync(poolDir, { recursive: true })
  const env = { ...process.env,
    BOT_NAME: name, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxce-${LABEL}-${SCENE}`, POOL_STATE_DIR: poolDir, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'false', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: 'http://127.0.0.1:11499',
    OLLAMA_BASE_URLS: 'http://127.0.0.1:11499', LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '8000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-ce-${LABEL}`, RUN_ID: 'sandbox-ceilescape01', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    HOME_X: String(A.x), HOME_Y: String(A.y + 33), HOME_Z: String(A.z - 40), BOARD_X: String(A.x), BOARD_Y: String(A.y + 33), BOARD_Z: String(A.z - 40) }
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs'], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = fs.createWriteStream(path.join(dir, 'bot.out'))
  child.stdout.pipe(out); child.stderr.pipe(out)
  procs.push(child)
  return { w, name, dir, child, log: path.join(dir, 'log', `skill-${name}.jsonl`) }
}
const rowsOf = b => { try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const kind = r => r?.skill?.name ?? ''

async function main () {
  let pl = r1('list')
  for (let k = 0; k < 30 && !/There are 0 of/.test(pl); k++) { await sleep(2000); pl = r1('list') }
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scene=${SCENE} bot=${who} arena=${A.x},${A.y},${A.z} fixture=${FIX} (${fixture.source}, anchor ${fixture.anchor})`)
  r1(`forceload add ${A.x - RX - 1} ${A.z - RX - 1} ${A.x + RX + 1} ${A.z + RX + 1}`)
  await sleep(2000)
  batch(arenaCmds())
  await sleep(3000)                                    // let the copied water settle before anything is measured
  // A SETUP THAT DID NOT TAKE IS NOT A SCENE: the column and its exit as the fixture has them
  const want = SCENE === 'noexit'
    ? { feet: ['water', ...at(0, 2, 0)], head: ['water', ...at(0, 3, 0)], ceiling: ['stone', ...at(0, 4, 0)] }
    : { feet: ['water', ...at(0, 0, 0)], head: ['water', ...at(0, 1, 0)], ceiling: ['copper_ore', ...at(0, 2, 0)], eastFeet: ['dirt', ...at(1, 0, 0)],
        eastHead: ['ladder', ...at(1, 1, 0)], eastTread: ['dirt', ...at(1, -1, 0)],
        ...(SCENE === 'lava' ? { lava: ['lava', ...at(2, 0, 0)] } : {}), ...(SCENE === 'copper2' ? { southCeil: ['copper_ore', ...at(0, 2, 1)] } : {}) }
  const set = Object.fromEntries(Object.entries(want).map(([k, [b, x, y, z]]) => [k, isBlock(x, y, z, b)]))
  P_('arena set', set)
  if (!Object.values(set).every(Boolean)) throw new Error('arena did not set: ' + JSON.stringify(set))
  const bot = launch(who)
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(bot.name)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join: ' + r1('list'))
  rcon(`gamemode survival ${bot.name}`, `clear ${bot.name}`, `effect clear ${bot.name}`, `tp ${bot.name} ${A.x + 0.5} ${A.y + FEET_Y} ${A.z + 0.5}`,
       ...BAGS[who].map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${bot.name} container.${9 + i} with minecraft:${id} ${n}` }))
  await sleep(3000)
  const start = posOf(bot.name)
  P_('placed', start)
  const col = q => q && Math.floor(q.x) === A.x && Math.floor(q.z) === A.z
  if (!col(start)) throw new Error('the bot is not in the column after the teleport: ' + JSON.stringify(start))
  const deadline = Date.now() + MINUTES * 60_000
  let outAt = null, minHealth = 20, track = []
  while (Date.now() < deadline) {
    await sleep(5000)
    const p = posOf(bot.name), h = healthOf(bot.name)
    if (h != null) minHealth = Math.min(minHealth, h)
    if (p) track.push([Math.round((Date.now() - T0) / 1000), +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)])
    if (p && !col(p)) { outAt ??= Date.now() } else outAt = null
    if (outAt && Date.now() - outAt >= 60_000) break                  // out a full minute: done
  }
  const rows = rowsOf(bot)
  const p = posOf(bot.name)
  const held = outAt ? (Date.now() - outAt) / 1000 : 0
  const died = rows.some(r => kind(r) === '_death') || minHealth <= 0
  const inArena = !!p && Math.abs(p.x - A.x) <= RX && Math.abs(p.z - A.z) <= RX && p.y >= A.y - DN && p.y <= A.y + UP
  const ce = rows.filter(r => kind(r) === '_ceilescape').map(r => String(r.skill.detail))
  const cut = rows.filter(r => kind(r) === '_entombed_ramp_cut' || kind(r) === '_marooned_ramp_cut').map(r => `${kind(r)}: ${String(r.skill.detail).replace(/^.*stopped because /, '').slice(0, 160)}`)
  const cells = SCENE === 'noexit' ? { ceiling: at(0, 4, 0) } : { ceiling: at(0, 2, 0), eastFeet: at(1, 0, 0), eastHead: at(1, 1, 0), southFeet: at(0, 0, 1) }
  const NAMES = ['air', 'water', 'copper_ore', 'stone', 'dirt', 'ladder', 'lava', 'cobblestone', 'obsidian']
  const world = Object.fromEntries(Object.entries(cells).map(([k, [x, y, z]]) => [k, NAMES.find(n => isBlock(x, y, z, n)) ?? 'other']))
  const ev = { scene: SCENE, sha, server: SERVER, bot: who, name: bot.name, start, end: p, left: !col(p) && held >= 30 && !died && inArena, heldOutS: +held.toFixed(0),
    inArena, minHealth, deaths: rows.filter(r => kind(r) === '_death').map(r => String(r.skill.detail).slice(0, 160)),
    licence: rows.filter(r => kind(r) === '_ceilescape_mode').map(r => String(r.skill.detail).slice(0, 40)),
    actions: ce.reduce((m, d) => { const a = (/ action=(\S+)/.exec(d) || [])[1] ?? '?'; m[a] = (m[a] || 0) + 1; return m }, {}),
    ceilescape: ce.slice(0, 4).map(d => d.slice(0, 300)), needsRescue: rows.filter(r => kind(r) === '_needs_rescue').length,
    rampStops: cut.slice(0, 8), digExceeded: cut.filter(s => /dig exceeded/.test(s)).length, entombed: rows.filter(r => kind(r) === '_entombed').length,
    world, track: track.filter((_, i) => i % 6 === 0).slice(0, 40), rows: rows.length }
  ev.synthetic = 'arena copied from a fresh region copy (states kept, stone shell); the bot teleported in with its live bag; model off'
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
    const c = [`kill @e[type=!player,x=${A.x - RX - 1},y=${A.y - DN - 1},z=${A.z - RX - 1},dx=${2 * RX + 2},dy=${DN + UP + 2},dz=${2 * RX + 2}]`]
    for (let dy = -DN - 1; dy <= UP + 1; dy++) c.push(`fill ${A.x - RX - 1} ${A.y + dy} ${A.z - RX - 1} ${A.x + RX + 1} ${A.y + dy} ${A.z + RX + 1} minecraft:${dy <= 1 ? 'stone' : 'air'}`)
    c.push(`forceload remove ${A.x - RX - 1} ${A.z - RX - 1} ${A.x + RX + 1} ${A.z + RX + 1}`)
    batch(c)
    P_('cleanup', r1('list').slice(0, 80))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; cleanup().then(() => process.exit(1)) })
