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
//   `left`   = out of the TRAP (the column and the water cells beside it) with dry feet and head, held >= 30 s, never dead, in
//              the arena, the scene still set (column water + ceiling) at the end, and the run VALID (rows read, the right build's
//              licence, observed >= 80% of polls, the bot alive to the end). An invalid run is reported as invalid, never as a negative.
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
  // a missing or empty reply is a failure too (Codex driver r3 P2): every command must answer, and not with an error
  if (out.length !== cmds.length) throw new Error(`rcon: ${cmds.length} commands, ${out.length} replies`)
  // (gamemode/effect clear/kill/clear may legitimately answer nothing on a fresh bot or an empty selector)
  const bad = out.filter(x => BAD.test(x.reply) || (!String(x.reply).trim() && !/^(gamemode|effect clear|kill|clear) /.test(x.cmd)))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const posOf = name => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${name} Pos`)); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
const healthOf = name => { const m = /([\d.]+)f/.exec(r1(`data get entity ${name} Health`)); return m ? +m[1] : null }
const isBlock = (x, y, z, b) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${b}`))
// TRI-STATE (Codex driver r3 P2): true / false only on an explicit test answer; anything else is null -- an observation that failed
let obsFailures = 0
const blockIs = (x, y, z, b) => { const r = r1(`execute if block ${x} ${y} ${z} minecraft:${b}`); if (/Test passed/.test(r)) return true; if (/Test failed/.test(r)) return false; obsFailures++; return null }

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

// THE TRAP, NOT ONE CELL (Claude driver P1): open water lies beside both columns (Comet's N and W cells, Bravo's N), and both
// bots drift across a cell boundary, so "out of the column cell" is not an escape. The trap box is the column and every water
// cell beside it: x A.x-1 .. A.x (inclusive), z A.z-1 .. A.z+1, y within the column's height; LEFT also needs dry feet and head.
// The trap's cells are measured at setup (Codex driver r2 P2): the column, plus each of its eight neighbours that holds water at
// the feet or head height then. A dry bearing (copper2's south decoy) is therefore NOT trap: a bot standing dry there is out.
const FH = SCENE === 'noexit' ? [2, 3] : [0, 1]
let trapCells = new Set([`${A.x},${A.z}`])
const inTrap = q => !!q && trapCells.has(`${Math.floor(q.x)},${Math.floor(q.z)}`) && q.y >= A.y - DN && q.y <= A.y + FH[1] + 1
let setupBegan = false
let lastInvalid = false
// DRY ONLY WHEN BOTH CELLS ARE CONFIRMED NOT WATER: a failed observation is never "dry" (fail closed)
const dryAt = q => !!q && [0, 1].every(dy => blockIs(Math.floor(q.x), Math.floor(q.y) + dy, Math.floor(q.z), 'water') === false)
let botProc = null

async function main () {
  let pl = r1('list')
  for (let k = 0; k < 30 && !/There are 0 of/.test(pl); k++) { await sleep(2000); pl = r1('list') }
  // REFUSED BEFORE SETUP: nothing in the world is touched, not even by the cleanup (Codex driver P2)
  if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  if (process.env.CE_EXPECT_SHA && sha !== process.env.CE_EXPECT_SHA) throw new Error(`refused: the tree is ${sha}, expected ${process.env.CE_EXPECT_SHA}`)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scene=${SCENE} bot=${who} arena=${A.x},${A.y},${A.z} fixture=${FIX} (${fixture.source}, anchor ${fixture.anchor})`)
  setupBegan = true
  batch([`forceload add ${A.x - RX - 1} ${A.z - RX - 1} ${A.x + RX + 1} ${A.z + RX + 1}`])
  await sleep(2000)
  batch(arenaCmds())
  await sleep(3000)                                    // let the copied water settle before anything is measured
  // A SETUP THAT DID NOT TAKE IS NOT A SCENE: the column and its exit as the fixture has them, and every scene edit
  const column = SCENE === 'noexit'
    ? { feet: ['water', ...at(0, 2, 0)], head: ['water', ...at(0, 3, 0)], ceiling: ['stone', ...at(0, 4, 0)] }
    : { feet: ['water', ...at(0, 0, 0)], head: ['water', ...at(0, 1, 0)], ceiling: ['copper_ore', ...at(0, 2, 0)] }
  const want = SCENE === 'noexit' ? column
    : { ...column, eastFeet: ['dirt', ...at(1, 0, 0)], eastHead: ['ladder', ...at(1, 1, 0)], eastTread: ['dirt', ...at(1, -1, 0)],
        ...(SCENE === 'lava' ? { lava: ['lava', ...at(2, 0, 0)] } : {}),
        ...(SCENE === 'wethead' ? { wetSrc: ['water[level=0]', ...at(1, 1, 1)] } : {}),
        ...(SCENE === 'copper2' ? { southCeil: ['copper_ore', ...at(0, 2, 1)], southFeet: ['dirt', ...at(0, 0, 1)], southHead: ['dirt', ...at(0, 1, 1)],
                                    southTread: ['stone', ...at(0, -1, 1)] } : {}) }
  const check = w => Object.fromEntries(Object.entries(w).map(([k, [b, x, y, z]]) => [k, isBlock(x, y, z, b)]))
  const set = check(want)
  P_('arena set', set)
  if (!Object.values(set).every(Boolean)) throw new Error('arena did not set: ' + JSON.stringify(set))
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (FH.some(dy => isBlock(A.x + dx, A.y + dy, A.z + dz, 'water'))) trapCells.add(`${A.x + dx},${A.z + dz}`)
  }
  P_('trap cells', [...trapCells])
  const bot = launch(who)
  botProc = bot.child
  let joined = false
  for (let k = 0; k < 60; k++) { await sleep(2000); if (r1('list').includes(bot.name)) { joined = true; break } }
  if (!joined) throw new Error('the bot did not join: ' + r1('list'))
  // every setup command's reply is checked (batch throws on an error reply: Codex driver r2 P2)
  batch([`gamemode survival ${bot.name}`, `clear ${bot.name}`, `effect clear ${bot.name}`, `tp ${bot.name} ${A.x + 0.5} ${A.y + FEET_Y} ${A.z + 0.5}`,
         ...BAGS[who].map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${bot.name} container.${9 + i} with minecraft:${id} ${n}` })])
  await sleep(3000)
  // THE BAG TOOK: every item of the live bag, by id AND count (`execute if items` counts across the inventory). Damage is set by
  // the replace command and not read back.
  const short = []
  for (const it of BAGS[who]) {
    const [id, n] = it.split(' '), base = id.replace(/\[.*$/, '')
    const m = /count: (\d+)/.exec(r1(`execute if items entity ${bot.name} container.* minecraft:${base}`))
    if (!m || Number(m[1]) < Number(n)) short.push(`${base} ${m ? m[1] : 0}/${n}`)
  }
  if (short.length) throw new Error('the bag did not take: ' + short.join(','))
  const start = posOf(bot.name)
  P_('placed', start)
  const col = q => q && Math.floor(q.x) === A.x && Math.floor(q.z) === A.z
  if (!col(start) || Math.abs(start.y - (A.y + FEET_Y)) > 0.6) throw new Error('the bot is not in the column after the teleport: ' + JSON.stringify(start))
  const deadline = Date.now() + MINUTES * 60_000
  let outAt = null, minHealth = 20, track = [], polls = 0, seen = 0
  while (Date.now() < deadline) {
    await sleep(5000)
    polls++
    const p = posOf(bot.name), h = healthOf(bot.name)
    if (p) seen++
    if (h != null) minHealth = Math.min(minHealth, h)
    if (p) track.push([Math.round((Date.now() - T0) / 1000), +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)])
    // OUT AND DRY, continuously (Codex driver r2 P2): the hold clock runs only while both hold
    if (p && !inTrap(p) && dryAt(p)) { outAt ??= Date.now() } else outAt = null
    if (outAt && Date.now() - outAt >= 60_000) break                  // out of the trap and dry a full minute: done
  }
  const rows = rowsOf(bot)
  const p = posOf(bot.name)
  const held = outAt ? (Date.now() - outAt) / 1000 : 0
  const died = rows.some(r => kind(r) === '_death') || minHealth <= 0
  const inArena = !!p && Math.abs(p.x - A.x) <= RX && Math.abs(p.z - A.z) <= RX && p.y >= A.y - DN && p.y <= A.y + UP
  const ce = rows.filter(r => kind(r) === '_ceilescape').map(r => String(r.skill.detail))
  const cut = rows.filter(r => kind(r) === '_entombed_ramp_cut' || kind(r) === '_marooned_ramp_cut').map(r => `${kind(r)}: ${String(r.skill.detail).replace(/^.*stopped because /, '').slice(0, 160)}`)
  const cells = SCENE === 'noexit' ? { ceiling: at(0, 4, 0) } : { ceiling: at(0, 2, 0), eastFeet: at(1, 0, 0), eastHead: at(1, 1, 0), southFeet: at(0, 0, 1), southHead: at(0, 1, 1) }
  const NAMES = ['air', 'water', 'copper_ore', 'stone', 'dirt', 'ladder', 'lava', 'cobblestone', 'obsidian']
  const world = Object.fromEntries(Object.entries(cells).map(([k, [x, y, z]]) => [k, NAMES.find(n => isBlock(x, y, z, n)) ?? 'other']))
  // THE SCENE HELD TO THE END (Claude driver P2-1): the column's water and its ceiling are still there, so a drained arena
  // (a cheap dry ceiling) can never read as the design's success
  const endCol = check(column)
  const sceneHeld = Object.values(endCol).every(Boolean)
  // THE INSTRUMENT (Claude driver P2-2, Codex driver P2): the bot's own log was read, the right build ran, it was observed,
  // and it was alive to the end -- otherwise the run is INVALID, never an ordinary negative
  const licence = rows.filter(r => kind(r) === '_ceilescape_mode').map(r => String(r.skill.detail))
  const isCand = LABEL.startsWith('cand')
  const buildOk = isCand ? licence.some(d => /^on=1 /.test(d)) : rows.every(r => !/^_(ceilescape|needs_rescue)/.test(kind(r)))
  const alive = botProc.exitCode === null && botProc.signalCode === null && r1('list').includes(bot.name)   // and still connected
  const shaOk = process.env.CE_EXPECT_SHA ? sha === process.env.CE_EXPECT_SHA : null
  const endDry = dryAt(p)              // BEFORE the validity list (Codex driver r4 P2): a failed final observation must invalidate
  const invalid = [p ? null : 'the final position could not be read (Codex driver r5 P2)', shaOk === false ? `sha ${sha} != expected ${process.env.CE_EXPECT_SHA}` : null, obsFailures ? `${obsFailures} block observations failed` : null,
    sceneHeld ? null : 'the scene did not hold (column water or ceiling changed)', rows.length > 0 ? null : 'no rows read from the bot log', buildOk ? null : (isCand ? 'no _ceilescape_mode on=1 licence' : 'a base build wrote _ceilescape rows'),
    polls && seen / polls >= 0.8 ? null : `observed ${seen}/${polls} polls`, alive ? null : `the bot process ended (code ${botProc.exitCode}, signal ${botProc.signalCode})`].filter(Boolean)
  const left = invalid.length === 0 && sceneHeld && !inTrap(p) && endDry && held >= 30 && !died && inArena
  const outcome = invalid.length ? 'INVALID' : left ? 'LEFT' : 'STAYED'
  // a BASE run is a positive control only when the scene held and the base swung its futile dig (Claude driver r2 P3-2)
  const controlOk = isCand ? null : (sceneHeld && cut.some(s => /dig exceeded/.test(s)))
  const ev = { scene: SCENE, outcome, controlOk, sha, shaExpected: process.env.CE_EXPECT_SHA || null,
    shaOk, server: SERVER, lock: 'ceilescape (per-server)', bot: who, name: bot.name, start, end: p, left,
    endedEast: !!p && p.x >= A.x + 1, sceneHeld, endColumn: endCol, invalid, heldOutS: +held.toFixed(0),
    inArena, minHealth, deaths: rows.filter(r => kind(r) === '_death').map(r => String(r.skill.detail).slice(0, 160)), licence: licence.map(d => d.slice(0, 40)),
    actions: ce.reduce((m, d) => { const a = (/ action=(\S+)/.exec(d) || [])[1] ?? '?'; m[a] = (m[a] || 0) + 1; return m }, {}),
    ceilescape: ce.slice(0, 4).map(d => d.slice(0, 300)), needsRescue: rows.filter(r => kind(r) === '_needs_rescue').length,
    rampStops: cut.slice(0, 8), digExceeded: cut.filter(s => /dig exceeded/.test(s)).length, entombed: rows.filter(r => kind(r) === '_entombed').length,
    world, track: track.filter((_, i) => i % 6 === 0).slice(0, 40), rows: rows.length, polls, seen }
  ev.synthetic = 'arena copied from a fresh region copy (states kept, stone shell); the bot teleported in with its live bag; model off'
  lastInvalid = invalid.length > 0
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
  if (!setupBegan) { P_('cleanup: setup never began, the world was not touched'); return true }
  await sleep(2000)
  let ok = true
  try {
    const c = [`kill @e[type=!player,x=${A.x - RX - 1},y=${A.y - DN - 1},z=${A.z - RX - 1},dx=${2 * RX + 2},dy=${DN + UP + 2},dz=${2 * RX + 2}]`]
    for (let dy = -DN - 1; dy <= UP + 1; dy++) c.push(`fill ${A.x - RX - 1} ${A.y + dy} ${A.z - RX - 1} ${A.x + RX + 1} ${A.y + dy} ${A.z + RX + 1} minecraft:${dy <= 1 ? 'stone' : 'air'}`)
    batch(c)
  } catch (e) { ok = false; P_('cleanup failed', e.message) } finally {
    // its own call, whatever the fills did (Claude driver P3-2): never leave the arena's chunks force-loaded
    try { batch([`forceload remove ${A.x - RX - 1} ${A.z - RX - 1} ${A.x + RX + 1} ${A.z + RX + 1}`]) } catch (e) { ok = false; P_('forceload remove failed', e.message) }
  }
  P_('cleanup', ok ? 'ok' : 'FAILED', r1('list').slice(0, 80))
  return ok
}
// a cleanup that failed exits non-zero (Codex driver P3)
main().then(() => cleanup().then(ok => process.exit(ok ? (lastInvalid ? 3 : 0) : 2)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; cleanup().then(() => process.exit(1)) })
