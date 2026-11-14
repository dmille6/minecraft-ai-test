#!/usr/bin/env node
// STAIRUSE-01 PAPER DRIVER (2026-11-06). SANDBOX ONLY (Paper 1.21.8 on 10.0.0.30). A REAL mineflayer bot on a town stair carved from
// shaftgeom's own plan, running the build's REAL shaftvisit.mjs runStairDescent with the REAL effects: the hop walk is skills.mjs
// stairWalk's (GoalBlock goto on the town-deposit profile: index.mjs's walk movements through towndeposit.mjs townWalkMovements,
// bounded 9 s; the collar approach 90 s), the dig is shaftvisit.mjs stairBotEffects over buildbot.mjs botBuildEffects (equip,
// bot.dig, the server's own block update as the witness). WHAT IS SYNTHETIC, said so in every result row: the arena (stone to 69,
// grass 70, the stair's air cells set to air by RCON, as deepmine-e2e carves it); the bot placed by RCON `tp` (scene setup only);
// dirt set into air cells by RCON for `pillared`, lava into the lining for `lava`, a tread set to air for `tread`; no reflex layer
// and no runner. OUTCOMES FROM THE SERVER: the bot's position (`data get entity`), every planned cell's block after the run
// (`execute if block`), the descent's own result.
//
//   node sandbox/stairuse/descent-e2e.mjs <botRoot> <scene,scene,...> [server]
//   before     the base's one walk (skills.mjs stairWalk to the 16 landing's stand, 90 s) from the surface, on a clean stair (the
//              control) -- and landingUsable vs landingRoute with one dirt block in step 21 (the base refuses the whole descent)
//   clean      runStairDescent from the surface 4 off the collar exit to the 16 landing's stand
//   pillared   dirt in four air cells (steps 5, 21 x2, 40) and one stub cell: each dug, the stand reached; the bag EMPTY (by hand)
//   lava       dirt in step 30's feet cell with lava in the lining beside it: the descent stops `wet`, digs nothing, no lava inside
//   tread      step 20's tread gone: the descent stops `tread` on step 19, the bot on its stand (nothing stepped over)
//   stair48    from the 48 landing's stub end down to the 16 landing (no collar walk)
// Refuses unless a sandbox lock covering SERVER has `stairuse` as its owner's first word. World edits on its arena only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, SCENES_S = 'before,clean,pillared,lava,tread,stair48', SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT) throw new Error('usage: descent-e2e.mjs <botRoot> <scenes> [server]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'stairuse')
const NAME = 'sbx-descent'
const OUT = process.env.EG_OUT || path.join(os.tmpdir(), 'stairuse-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: 'sbx-descent', MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '20000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: 'sandbox-stairuse', RUN_ID: 'sandbox-stairuse', LOG_DIR: fs.mkdtempSync(path.join(OUT, 'log-')), STATE_DIR: fs.mkdtempSync(path.join(OUT, 'state-')),
  HOME_X: '7178', HOME_Y: '71', HOME_Z: '7200',
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements, goals } = breq('mineflayer-pathfinder')
const { Vec3 } = breq('vec3')
const G = await import(path.join(BOT_ROOT, 'bots/src/shaftgeom.mjs'))
const SV = await import(path.join(BOT_ROOT, 'bots/src/shaftvisit.mjs'))
const { botBuildEffects } = await import(path.join(BOT_ROOT, 'bots/src/buildbot.mjs'))
const { townWalkMovements } = await import(path.join(BOT_ROOT, 'bots/src/towndeposit.mjs'))
const { bodyOnCell } = await import(path.join(BOT_ROOT, 'bots/src/skills.mjs'))
let sha = 'unknown'; try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-su-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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
  // `Could not set the block` is a setblock that changed nothing (the cell already held it): not an error
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid/i.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? [+m[1], +m[2], +m[3]] : null }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), sha, server: SERVER,
  synthetic: 'arena; stair carved by RCON from shaftgeom plan; bot placed by tp; scene dirt/lava/tread by RCON; no reflexes, no runner', ...r }) + '\n'); P_('RESULT', r) }

// ---------------------------------------------------------------- the arena and the stair
const C = { x: 7200, z: 7200 }, HALF = 12, GY = 70
const HOME = { x: C.x - 22, y: GY + 1, z: C.z }
const AWAY = G.awayFrom(HOME, C.x, C.z)
const ORIGIN = G.originFor(C.x, C.z, AWAY)
const PLAN = G.planStair({ origin: ORIGIN, away: AWAY, g: GY })
const set = (c, id) => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`
async function arena () {
  const x0 = C.x - HALF, x1 = C.x + HALF, z0 = C.z - HALF, z1 = C.z + HALF
  await batch([`forceload add ${x0} ${z0} ${x1} ${z1}`], 1)
  await sleep(3000)
  const c = [`kill @e[type=!player,x=${x0},y=0,z=${z0},dx=${2 * HALF},dy=110,dz=${2 * HALF}]`]
  for (let y = GY + 1; y <= GY + 8; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:air`)
  for (let y = 0; y <= GY - 1; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:stone`)
  c.push(`fill ${x0} ${GY} ${z0} ${x1} ${GY} ${z1} minecraft:grass_block`)
  for (const cell of PLAN.cells) c.push(set(cell.at, cell.role === 'air' ? 'air' : 'stone'))
  c.push('difficulty peaceful')
  await batch(c)
}
/** The collar exit (shaftgeom collarExit over the server's own reads would need a bot; the arena is flat: computed). */
function exitCell () {
  const read = (x, y, z) => {
    const cell = PLAN.byKey.get(`${x},${y},${z}`)
    if (cell) return cell.role === 'air' ? { name: 'air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block', full: true }
    if (y > GY) return { name: 'air', boundingBox: 'empty' }
    return { name: y === GY ? 'grass_block' : 'stone', boundingBox: 'block', full: true }
  }
  return G.collarExit(read, PLAN)
}
/** Every planned cell's block on the server, per role: { air: { open, other }, tread: { solid, other }, lining: ... }. */
function truth () {
  const out = { air: { ok: 0, bad: [] }, solid: { ok: 0, bad: [] } }
  const cmds = PLAN.cells.map(c => c.role === 'air' ? `execute if block ${c.at.join(' ')} minecraft:air` : `execute if block ${c.at.join(' ')} minecraft:stone`)
  const res = rcon(...cmds)
  PLAN.cells.forEach((c, i) => {
    const okk = /Test passed/.test(res[i]?.reply ?? '')
    const b = c.role === 'air' ? out.air : out.solid
    if (okk) b.ok++; else b.bad.push(c.at.join(','))
  })
  return out
}

// ---------------------------------------------------------------- the bot
let bot = null, moves = null, townMoves = null
async function connect () {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  // index.mjs's walk profile (moves) and the town-deposit walk on it (towndeposit.mjs townWalkMovements)
  moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = true; moves.allowParkour = false; moves.maxDropDown = 6
  townMoves = townWalkMovements(moves)
  bot.pathfinder.setMovements(moves)
  bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(townMoves); try { return await fn() } finally { bot.pathfinder.setMovements(moves) } }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 900 1 true`)
  await sleep(1500)
}
async function place (feet, dx = 0.5, dz = 0.5) {
  rcon(`tp ${NAME} ${feet[0] + dx} ${feet[1]} ${feet[2] + dz}`)
  await sleep(2500)
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(250)
}
/** skills.mjs stairWalk, as written (a bounded GoalBlock goto on the town-deposit walk; arrival within 1). */
async function stairWalk (cell, ms) {
  let timer = null
  const go = () => bot.pathfinder.goto(new goals.GoalBlock(cell[0], cell[1], cell[2]))
  const walk = bot.withTownDepositWalk(go)
  try {
    await Promise.race([walk, new Promise(resolve => { timer = setTimeout(() => { try { bot.pathfinder.setGoal(null) } catch {} resolve() }, ms) })])
    await Promise.race([walk.catch(() => {}), new Promise(r => setTimeout(r, 2_000))])
  } catch { /* the walk's own failure: arrival decides */ } finally { if (timer) clearTimeout(timer) }
  const p = bot.entity?.position
  return !!p && Math.abs(Math.floor(p.x) - cell[0]) <= 1 && Math.abs(Math.floor(p.z) - cell[2]) <= 1 && Math.abs(Math.floor(p.y + 1e-6) - cell[1]) <= 1
}
async function descend (label, { to = null, landing = null, extra = {} } = {}) {
  const L = landing ?? PLAN.landings.find(l => l.feet === 16)
  const B = botBuildEffects(bot, { withWalk: fn => bot.withTownDepositWalk(fn), aborted: () => false, log: () => {} })
  const e0 = SV.stairBotEffects(bot, B, { log: () => {} })
  const rows = []
  const t0 = Date.now()
  const r = await SV.runStairDescent(PLAN, {
    get read () { return SV.stairRead(bot) },
    feet: () => { const q = bot.entity.position; return [Math.floor(q.x), Math.floor(q.y + 1e-6), Math.floor(q.z)] },
    walkTo: c => stairWalk(c, c === EXIT ? 90_000 : 9_000),
    dig: c => e0.dig(c),
    occupied: c => bodyOnCell(bot, c),
    now: () => Date.now(), aborted: () => false,
    log: (op, d) => rows.push({ op, ...d }),
  }, { to: to ?? L.k, landing: to == null ? L : null, exit: EXIT, deadline: Date.now() + 170_000 })
  try { B.close() } catch {}
  await sleep(1500)
  const pos = posOf()
  const stand = G.stubEnd(L)
  const atStand = !!pos && Math.floor(pos[0]) === stand[0] && Math.floor(pos[1] + 1e-6) === stand[1] && Math.floor(pos[2]) === stand[2]
  return { scene: label, r, ms: Date.now() - t0, pos, atStand, stand, digs: rows.filter(x => x.op === 'descent_dig').map(x => x.at.join(',')), ...extra }
}
const EXIT = exitCell()

try {
  P_('arena', { server: SERVER, origin: ORIGIN, away: AWAY, K: PLAN.K, exit: EXIT, sha })
  await arena()
  const t0 = truth()
  P_('carved', { air_ok: t0.air.ok, air_bad: t0.air.bad.length, solid_ok: t0.solid.ok, solid_bad: t0.solid.bad.length })
  if (t0.air.bad.length || t0.solid.bad.length) throw new Error('the stair did not carve as planned')
  await connect()
  const REC = { blueprint: G.SHAFT_BLUEPRINT, plot: 'shaft', state: 'complete', structure_complete: true, site: { origin: ORIGIN, away: AWAY, g: GY, center: [C.x, C.z] }, K: PLAN.K, landings: PLAN.landings.map(l => l.feet), landings_built: PLAN.landings.map(l => l.feet), exit: EXIT, cells: PLAN.cells.map(c => ({ at: c.at, role: c.role })) }
  const L16 = PLAN.landings.find(l => l.feet === 16), L48 = PLAN.landings.find(l => l.feet === 48)
  const SURF = [EXIT[0], EXIT[1], EXIT[2]]
  const surfStart = () => { const d = [[4, 0], [-4, 0], [0, 4], [0, -4]].map(([dx, dz]) => [EXIT[0] + dx, EXIT[1], EXIT[2] + dz]).find(c => !PLAN.byKey.has(c.join(',')) && !PLAN.byKey.has([c[0], c[1] - 1, c[2]].join(','))); return d ?? SURF }
  for (const scene of SCENES_S.split(',')) {
    // every scene starts on a freshly carved stair
    await batch(PLAN.cells.map(c => set(c.at, c.role === 'air' ? 'air' : 'stone')))
    rcon(`clear ${NAME}`)
    if (scene === 'before') {
      await place(surfStart())
      const t0 = Date.now()
      const arrived = await stairWalk(G.stubEnd(L16), 90_000)
      const ms = Date.now() - t0
      const pos = posOf()
      // the base's pre-check against the new one, on the server's own blocks with one dirt block in step 21's feet cell
      rcon(set(PLAN.steps[21].air[0], 'dirt'))
      await sleep(1500)
      const rd = SV.stairRead(bot)
      const base = G.landingUsable(rd, REC, 16), now = G.landingRoute(rd, REC, 16)
      result({ scene, ok: base.ok === false && now.ok === true && now.blocked === 1, oneWalkArrived: arrived, oneWalkMs: ms, pos, landingUsable: base.why, landingRoute: { ok: now.ok, blocked: now.blocked },
        note: 'the base: one GoalBlock walk from the surface to the 16 stand (clean stair), and its pre-check refusing the whole descent for one block' })
      continue
    }
    if (scene === 'clean') { await place(surfStart()); const x = await descend(scene); const tr = truth(); result({ ...x, ok: x.r.ok && x.atStand && !x.digs.length && !tr.air.bad.length && !tr.solid.bad.length, truth: { air_bad: tr.air.bad, solid_bad: tr.solid.bad } }); continue }
    if (scene === 'pillared') {
      const blocks = [PLAN.steps[5].air[0], PLAN.steps[21].air[1], PLAN.steps[21].air[0], PLAN.steps[40].air[2], L16.cols[1].air[0]]
      rcon(...blocks.map(c => set(c, 'dirt')))
      await place(surfStart())
      const x = await descend(scene, { extra: { pillared: blocks.map(c => c.join(',')), bag: 'empty (dirt by hand)' } })
      const tr = truth()
      result({ ...x, ok: x.r.ok && x.atStand && x.r.cleared === blocks.length && !tr.air.bad.length && !tr.solid.bad.length, truth: { air_bad: tr.air.bad, solid_bad: tr.solid.bad } })
      continue
    }
    if (scene === 'lava') {
      const dirt = PLAN.steps[30].air[0]
      const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      const add = (c, d) => [c[0] + d[0], c[1] + d[1], c[2] + d[2]]
      const lava = N6.map(d => add(dirt, d)).find(n => PLAN.byKey.get(n.join(','))?.role === 'lining' &&
        N6.every(d => { const mm = add(n, d); return mm.join(',') === dirt.join(',') || !PLAN.air.has(mm.join(',')) }))
      if (!lava) throw new Error('no sealed lining cell beside the dirt')
      rcon(set(dirt, 'dirt'), set(lava, 'lava'))
      await place(surfStart())
      const x = await descend(scene, { extra: { dirt: dirt.join(','), lavaAt: lava.join(',') } })
      const still = /Test passed/.test(r1(`execute if block ${dirt.join(' ')} minecraft:dirt`))
      const leak = PLAN.cells.filter(c => c.role === 'air').some(c => /Test passed/.test(r1(`execute if block ${c.at.join(' ')} minecraft:lava`)))
      result({ ...x, ok: !x.r.ok && x.r.why === 'wet' && x.digs.length === 0 && still && !leak, dirtStands: still, lavaInStair: leak })
      rcon(set(lava, 'stone'), set(dirt, 'air'))
      continue
    }
    if (scene === 'tread') {
      rcon(set(PLAN.steps[20].tread, 'air'))
      await place(surfStart())
      const x = await descend(scene)
      const pos = x.pos, s19 = G.standOf(PLAN, 19)
      const on19 = !!pos && Math.floor(pos[0]) === s19[0] && Math.floor(pos[1] + 1e-6) === s19[1] && Math.floor(pos[2]) === s19[2]
      result({ ...x, ok: !x.r.ok && x.r.why === 'tread' && x.r.to === 19 && on19, onStep19: on19 })
      continue
    }
    if (scene === 'stair48') {
      await place(G.stubEnd(L48))
      const x = await descend(scene)
      result({ ...x, ok: x.r.ok && x.atStand && x.r.from === L48.k })
      continue
    }
    throw new Error(`unknown scene ${scene}`)
  }
} catch (e) {
  result({ ok: false, error: String(e?.stack ?? e).slice(0, 600) })
} finally {
  try { bot?.quit('done') } catch {}
  await sleep(1000)
  try { rcon(`kick ${NAME} done`) } catch {}
  process.exit(0)
}
