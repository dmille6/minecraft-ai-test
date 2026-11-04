#!/usr/bin/env node
// BAMBOOWALK-01 PAPER DRIVER (2026-11-04). SANDBOX ONLY (Paper 1.21.8 on 10.0.0.30). A REAL mineflayer bot walks board-d's live
// bamboo grove, rebuilt block for block AT ITS OWN COORDINATES (bamboo's collision offset is a function of x,z, so the posts stand
// where the fleet's do): bots/test/fixtures/bamboowalk-boardd-1103.json, the 11-03 03:16Z backup's region copy, 326..350 x 64..80 x
// 100..128. The walk is the fleet's: index.mjs's profile (canDig=false, allow1by1towers, cornerwalk-01's installCornerRule) under
// towndeposit.mjs townWalkMovements, and pathfinder.goto. The ARM is the bot root: a root with bots/src/bamboowalk.mjs loads its
// plugin exactly as index.mjs does (bot.loadPlugin before spawn); the base root has none.
// WHAT IS SYNTHETIC, said so in every result row: the grove set by RCON; the bot put at each trial's START by RCON `tp` (scene
// setup only, outside the grove: it then walks in through ordinary gameplay); no reflex layer, no runner (the stuck reflex is the
// fleet's response to what this measures). OUTCOMES: the server's position (`data get entity`), the server's position corrections
// the client received (mineflayer `forcedMove`), the pathfinder's `path_reset stuck` rows, arrival.
//
//   node sandbox/bamboowalk/wedge-e2e.mjs <botRoot> <trial,trial,...> [server]
//   trial = <start>:<goal>, named below (e.g. se:fe,wedge:fe,e:fe, town1:fe with BW_FIXTURE = the town cut)
//           probe:real | probe:baked   the mechanism, controls only, past one stalk (see PROBE)
//           incell:e|w|n|s             a body in a bamboo cell walks out (see incell)
//           rand:<n>                   n seeded walks between surface cells of the grove (BW_SEED; same pairs in both arms)
//   env BW_REPS (repeat the list), BW_OUT, BW_NAME, BW_SHA, BW_FIXTURE
// 11-04 results: docs/reports/bamboowalk-01-2026-11-04.md s.5
// Refuses unless a sandbox lock covering SERVER has `bamboowalk` as its owner's first word. World edits on its box only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, TRIALS_S = 'se:fe', SERVER = 'sandbox2'] = process.argv.slice(2)
if (!BOT_ROOT) throw new Error('usage: wedge-e2e.mjs <botRoot> <trials> [server]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'bamboowalk')
const NAME = process.env.BW_NAME || 'sbx-bamboo'
if (!/^sbx-/.test(NAME)) throw new Error('bot name must start with sbx-')
const OUT = process.env.BW_OUT || path.join(os.tmpdir(), 'bamboowalk-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements, goals } = breq('mineflayer-pathfinder')
const { townWalkMovements } = await import(path.join(BOT_ROOT, 'bots/src/towndeposit.mjs'))
const { installCornerRule } = await import(path.join(BOT_ROOT, 'bots/src/cornermoves.mjs'))
const { protectTownBlocks } = await import(path.join(BOT_ROOT, 'bots/src/composter.mjs'))
const bwPath = path.join(BOT_ROOT, 'bots/src/bamboowalk.mjs')
const BW = fs.existsSync(bwPath) ? await import(bwPath) : null
let sha = 'unknown'; try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
if (process.env.BW_SHA) sha = process.env.BW_SHA
const ARM = BW && BW.bambooWalkOn() ? 'candidate' : 'base'

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-bw-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
async function batch (cmds, n = 200) {
  const out = []
  for (let i = 0; i < cmds.length; i += n) out.push(...rcon(...cmds.slice(i, i + n)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid/i.test(x.reply) && !/No blocks were filled/.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? [+m[1], +m[2], +m[3]] : null }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), sha, arm: ARM, server: SERVER,
  synthetic: 'grove set by RCON at its fleet coordinates; bot put at the trial start by tp (outside the grove); no reflexes, no runner', ...r }) + '\n'); P_('RESULT', r) }

// ---------------------------------------------------------------- the grove (board-d, 11-03 copy, at its own coordinates)
// BW_FIXTURE: a larger cut of the same copy (the town and the grove: 322..366 x 60..84 x 98..154) for walks from the town chests
const FX = JSON.parse(fs.readFileSync(process.env.BW_FIXTURE || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bots/test/fixtures/bamboowalk-boardd-1103.json'), 'utf8'))
const [OX, OY, OZ] = FX.origin, [SX, SY, SZ] = FX.size
const cell = (() => { const m = new Map(); let i = 0; for (let r = 0; r < FX.rle.length; r += 2) for (let n = 0; n < FX.rle[r + 1]; n++, i++) m.set(`${OX + (i % SX)},${OY + Math.floor(i / (SX * SZ))},${OZ + (Math.floor(i / SX) % SZ)}`, FX.palette[FX.rle[r]]); return m })()
async function grove () {
  const x0 = OX, x1 = OX + SX - 1, z0 = OZ, z1 = OZ + SZ - 1
  await batch([`forceload add ${x0 - 16} ${z0 - 16} ${x1 + 16} ${z1 + 16}`], 1)
  await sleep(3000)
  const c = [`kill @e[type=!player,x=${x0 - 8},y=0,z=${z0 - 8},dx=${SX + 16},dy=200,dz=${SZ + 16}]`, 'difficulty peaceful', 'gamerule randomTickSpeed 0']
  for (let y = OY + SY; y <= OY + SY + 20; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:air`)
  for (let y = OY; y < OY + SY; y++) {
    for (let z = z0; z <= z1; z++) {
      let runStart = x0, cur = cell.get(`${x0},${y},${z}`)
      for (let x = x0 + 1; x <= x1 + 1; x++) {
        const b = x <= x1 ? cell.get(`${x},${y},${z}`) : null
        if (b !== cur) { c.push(runStart === x - 1 ? `setblock ${runStart} ${y} ${z} minecraft:${cur}` : `fill ${runStart} ${y} ${z} ${x - 1} ${y} ${z} minecraft:${cur}`); runStart = x; cur = b }
      }
    }
  }
  await batch(c)
  // positive control: a sample of cells read back from the server, every bamboo among them
  const sample = [...cell.entries()].filter(([, v], i) => v.startsWith('bamboo') || i % 97 === 0)
  const res = rcon(...sample.map(([k, v]) => `execute if block ${k.split(',').join(' ')} minecraft:${v.split('[')[0]}`))
  const bad = sample.filter((_, i) => !/Test passed/.test(res[i]?.reply ?? ''))
  return { cmds: c.length, checked: sample.length, bamboo: sample.filter(([, v]) => v.startsWith('bamboo')).length, bad: bad.slice(0, 5).map(([k, v]) => k + '=' + v), badN: bad.length }
}

// ---------------------------------------------------------------- the bot
let bot = null, townMoves = null, forced = 0, stuckResets = 0, resetAt = []
async function connect () {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  if (BW) bot.loadPlugin(BW.bambooWalkPlugin)            // index.mjs's line, before spawn
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  const moves = protectTownBlocks(new Movements(bot), bot.registry)
  moves.canDig = false; moves.allow1by1towers = true; moves.allowParkour = false; moves.maxDropDown = 6   // index.mjs's walk
  installCornerRule(moves)
  townMoves = townWalkMovements(moves)
  bot.pathfinder.setMovements(townMoves)
  bot.on('forcedMove', () => { forced++ })
  bot.on('path_reset', r => { if (r === 'stuck') { stuckResets++; const p = bot.entity.position; resetAt.push(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`) } })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 900 1 true`)
  await sleep(1500)
  P_('connected', { arm: ARM, wrapped: !!bot.blockAt?.bambooWalk })
}
const STARTS = { se: [344.5, 68, 121.5], s: [339.5, 67, 123.5], e: [346.5, 70, 118.5], sw: [333.5, 68, 121.5], wedge: [338.0, 71, 114.0],
  // the live approaches (board-d 11-02..11-03, the rows before each wedge): the town chests, and two field starts
  town1: [356.5, 73, 147.5], town2: [352.5, 73, 148.5], town3: [358.5, 73, 146.9], town4: [355.4, 73, 147.5], d: [341.3, 67, 130.9], c: [344.6, 69, 111.5] }
const GOALS = { fe: [331, 69, 104, 2], nw: [328, 69, 108, 1.5], slot: [338, 71, 113, 0] }
// THE MECHANISM PROBE (no pathfinder): one bamboo stalk at 405,100..101,115 on a grass floor (y 99; bamboo pops on stone), whose server post is at
// x .656-.844, z .623-.811 (offset +0.25,+0.217) and whose baked client post is at x/z .156-.344. The body walks +x with the
// controls only, its centre on z = 115.75 (`real`: through the server's post, clear of the baked one) or z = 115.25 (`baked`:
// through the baked post only). The server's final position and its corrections say which post the walk met.
const PROBE = { x0: 398, x1: 418, z0: 112, z1: 118, y: 99, stalk: [405, 115] }
async function probeArena () {
  const { x0, x1, z0, z1, y } = PROBE
  await batch([`forceload add ${x0} ${z0} ${x1} ${z1}`], 1)
  await sleep(2000)
  await batch([`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:grass_block`, `fill ${x0} ${y + 1} ${z0} ${x1} ${y + 4} ${z1} minecraft:air`,
    `setblock ${PROBE.stalk[0]} ${y + 1} ${PROBE.stalk[1]} minecraft:bamboo[age=1,leaves=none,stage=0]`, `setblock ${PROBE.stalk[0]} ${y + 2} ${PROBE.stalk[1]} minecraft:bamboo[age=1,leaves=none,stage=0]`])
}
async function probe (lane) {
  const z = lane === 'real' ? 115.75 : 115.25
  rcon(`tp ${NAME} 402.5 ${PROBE.y + 1} ${z} -90 0`)
  await sleep(2500)
  forced = 0
  await bot.look(-Math.PI / 2, 0, true)
  bot.setControlState('forward', true)
  await sleep(2500)
  bot.clearControlStates()
  await sleep(800)
  const pos = posOf()
  const stalk = /Test passed/.test(r1(`execute if block ${PROBE.stalk[0]} ${PROBE.y + 1} ${PROBE.stalk[1]} minecraft:bamboo`))
  return { stalk, trial: `probe:${lane}`, lane, z, forcedMoves: forced, pos, client: [bot.entity.position.x, bot.entity.position.z], passed: !!pos && pos[0] > 406.2 }
}
// RANDOM GROVE WALKS (`rand:<n>`): n start/goal pairs drawn (seeded, BW_SEED) from the standable cells of the grove's core
// (330..346 x 106..122): a full solid floor that is not bamboo or leaves, feet and head air, open above, bamboo within 2. The same seed gives both arms
// the same pairs; each walk is a GoalBlock goto, 25 s.
const AIRY = v => !v || /^(air|cave_air|short_grass|tall_grass|fern|vine|dandelion|poppy)/.test(v)
const SOLID = v => !!v && !AIRY(v) && !/bamboo|leaves|water|lava|torch|snow|carpet|slab|stairs|fence|wall|door|trapdoor|chest|ladder|vine/.test(v)
const OPEN = v => AIRY(v) || /bamboo|leaves/.test(v ?? '')
const nearBamboo = (x, y, z) => { for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const dy of [0, 1]) if (/^bamboo/.test(cell.get(`${x + dx},${y + dy},${z + dz}`) ?? '')) return true; return false }
function standables () {
  // SURFACE cells only (open to the top of the cut: nothing but air, leaves or bamboo above), with bamboo within 2
  const out = []
  for (let x = 330; x <= 346; x++) for (let z = 106; z <= 122; z++) for (let y = OY + 1; y < OY + SY - 2; y++) {
    if (!(SOLID(cell.get(`${x},${y - 1},${z}`)) && AIRY(cell.get(`${x},${y},${z}`)) && AIRY(cell.get(`${x},${y + 1},${z}`)))) continue
    let open = true; for (let yy = y + 2; yy < OY + SY; yy++) if (!OPEN(cell.get(`${x},${yy},${z}`))) { open = false; break }
    if (open && nearBamboo(x, y, z)) out.push([x, y, z])
  }
  return out
}
function rng (seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
async function randWalks (n) {
  const S = standables(), R = rng(Number(process.env.BW_SEED || 1104))
  const out = []
  for (let i = 0; i < n; i++) {
    const a = S[Math.floor(R() * S.length)]; let b = S[Math.floor(R() * S.length)]
    for (let k = 0; k < 20 && Math.hypot(a[0] - b[0], a[2] - b[2]) < 6; k++) b = S[Math.floor(R() * S.length)]
    STARTS[`r${i}`] = [a[0] + 0.5, a[1], a[2] + 0.5]; GOALS[`g${i}`] = [b[0], b[1], b[2], 0]
    const r = await trial(`r${i}`, `g${i}`, 25_000)
    out.push(r)
    result({ ...r, mode: 'rand', i, wrapped: !!bot.blockAt?.bambooWalk, ok: r.forcedMoves === 0 })
  }
  const sum = k => out.reduce((t, r) => t + (r[k] || 0), 0)
  return { mode: 'rand-summary', n, standables: S.length, seed: Number(process.env.BW_SEED || 1104), arrived: out.filter(r => r.arrived).length,
    forcedMoves: sum('forcedMoves'), walksWithForced: out.filter(r => r.forcedMoves > 0).length, stuckResets: sum('stuckResets'),
    walksWithStuck: out.filter(r => r.stuckResets > 0).length, ms: sum('ms') }
}
// (B) A BODY IN A BAMBOO CELL, open ground (`incell:<side>`): the probe arena's stalk, the bot put by tp at the centre of the
// stalk's own cell (overlapping both the server's post and the baked one, as the fleet's 169 feet-in-bamboo rows were), then a
// pathfinder walk 4 blocks (3 north or south) to the given side (e/w/n/s) on the fleet walk profile, 20 s.
async function incell (side) {
  const [sx, sz] = PROBE.stalk
  const d = { e: [4, 0], w: [-4, 0], n: [0, -3], s: [0, 3] }[side]
  if (!d) throw new Error(`incell side ${side}`)
  STARTS[`in-${side}`] = [sx + 0.5, PROBE.y + 1, sz + 0.5]; GOALS[`to-${side}`] = [sx + d[0], PROBE.y + 1, sz + d[1], 0]
  return trial(`in-${side}`, `to-${side}`, 20_000)
}
async function trial (startK, goalK, ms = 45_000) {
  const s = STARTS[startK], g = GOALS[goalK]
  if (!s || !g) throw new Error(`unknown trial ${startK}:${goalK}`)
  rcon(`tp ${NAME} ${s[0]} ${s[1]} ${s[2]}`)
  await sleep(2500)
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(250)
  forced = 0; stuckResets = 0; resetAt = []
  const t0 = Date.now()
  let timer = null, err = null
  const goal = g[3] ? new goals.GoalNear(g[0], g[1], g[2], g[3]) : new goals.GoalBlock(g[0], g[1], g[2])
  try {
    await Promise.race([bot.pathfinder.goto(goal), new Promise(resolve => { timer = setTimeout(() => { try { bot.pathfinder.setGoal(null) } catch {} resolve('timeout') }, ms) })])
  } catch (e) { err = String(e?.message ?? e).slice(0, 120) } finally { if (timer) clearTimeout(timer) }
  const ms2 = Date.now() - t0
  await sleep(800)
  const pos = posOf()
  const arrived = !!pos && (g[3] ? Math.hypot(pos[0] - (g[0] + 0.5), pos[2] - (g[2] + 0.5)) <= g[3] + 1 && Math.abs(pos[1] - g[1]) <= 2.5
                                  : Math.floor(pos[0]) === g[0] && Math.floor(pos[2]) === g[2])
  const spots = Object.entries(resetAt.reduce((a, k) => { a[k] = (a[k] ?? 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3)
  return { trial: `${startK}:${goalK}`, start: s, goal: g, arrived, ms: ms2, timedOut: ms2 >= ms - 50, err, forcedMoves: forced, stuckResets, stuckAt: spots, pos }
}

try {
  P_('grove', { server: SERVER, origin: FX.origin, size: FX.size, sha, arm: ARM })
  const gv = await grove()
  P_('built', gv)
  if (gv.badN) throw new Error('the grove did not build as the copy: ' + gv.bad.join(' '))
  await connect()
  const reps = Number(process.env.BW_REPS || 1)
  for (let rep = 0; rep < reps; rep++) {
    for (const tr of TRIALS_S.split(',')) {
      const [a, b] = tr.split(':')
      if (a === 'rand') { result({ ...(await randWalks(Number(b))), rep, wrapped: !!bot.blockAt?.bambooWalk }); continue }
      if (a === 'incell') { if (!probe.built) { await probeArena(); probe.built = true } const r = await incell(b); result({ ...r, rep, wrapped: !!bot.blockAt?.bambooWalk, ok: r.arrived && r.forcedMoves === 0 }); continue }
      if (a === 'probe') { if (!probe.built) { await probeArena(); probe.built = true } const r = await probe(b); result({ ...r, rep, wrapped: !!bot.blockAt?.bambooWalk }); continue }
      const r = await trial(a, b)
      result({ ...r, rep, wrapped: !!bot.blockAt?.bambooWalk, ok: r.arrived && r.forcedMoves === 0 })
    }
  }
} catch (e) {
  result({ ok: false, error: String(e?.stack ?? e).slice(0, 600) })
} finally {
  try { bot?.quit('done') } catch {}
  await sleep(1000)
  try { rcon(`kick ${NAME} done`) } catch {}
  // the server as it was: random ticks back on (the grove was frozen for the run), this run's chunk tickets released
  try { rcon('gamerule randomTickSpeed 3', `forceload remove ${OX - 16} ${OZ - 16} ${OX + SX + 15} ${OZ + SZ + 15}`, `forceload remove ${PROBE.x0} ${PROBE.z0} ${PROBE.x1} ${PROBE.z1}`) } catch {}
  process.exit(0)
}
