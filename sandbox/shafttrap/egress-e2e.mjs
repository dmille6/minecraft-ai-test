#!/usr/bin/env node
// SHAFTTRAP-01 PAPER DRIVER (2026-11-03). SANDBOX ONLY (Paper 1.21.8 on 10.0.0.30). A REAL mineflayer bot in a town stair carved
// from shaftgeom's own plan, running the build's REAL shaftvisit.mjs runStairEgress with the REAL effects: the hop walk is
// skills.mjs stairWalk's (GoalBlock goto on the town-deposit profile: index.mjs's walk movements through towndeposit.mjs
// townWalkMovements, bounded 9 s), the dig is shaftvisit.mjs stairBotEffects over buildbot.mjs botBuildEffects (equip, bot.dig,
// the server's own block update as the witness). WHAT IS SYNTHETIC, said so in every result row: the arena (stone to 69, grass 70,
// the stair's air cells set to air by RCON, as deepmine-e2e carves it); the bot placed by RCON `tp` (scene setup only); dirt set
// into air cells by RCON for the `pillared` scene (the leavings of an escape pillar); no reflex layer and no runner (the claim
// is the runner's: unit-tested in town-stair-stuck.test.mjs). OUTCOMES FROM THE SERVER: the bot's position (`data get entity`),
// every planned cell's block after the run (`execute if block`), the egress's own result.
//
//   node sandbox/shafttrap/egress-e2e.mjs <botRoot> <scene,scene,...> [server]
//   before    the chain as it was: on a stand at step 40 with one dirt block in step 30's air, the maroon probe (reflex.mjs
//             canStartAPath: GoalNear(x+8, y, z+8, 3), 800 ms) and the ascent plan (stairAscend: a plan to the exit) -- both fail
//   before_clean  the same on a clean stair (the probe's answer there, and the ascent plan succeeding: the positive control)
//   clean     from step 44's stand to the collar exit
//   pillared  from step 44, dirt in four air cells (its own head room, steps 40, 30, 12): each dug, the exit reached; the bag
//             is EMPTY (dirt by hand)
//   lava      dirt in an air cell with lava in the cell above it (a barrier): the egress stops `wet`, digs nothing
//   edge      from step 37 with the centre over step 38's column (the stance the live rows show)
//   stub      from the y=32 landing's stub end
// Refuses unless a sandbox lock covering SERVER has `shafttrap` as its owner's first word. World edits on its arena only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, SCENES_S = 'before,clean,pillared,edge,stub', SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT) throw new Error('usage: egress-e2e.mjs <botRoot> <scenes> [server]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'shafttrap')
const NAME = 'sbx-egress'
const OUT = process.env.EG_OUT || path.join(os.tmpdir(), 'shafttrap-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: 'sbx-egress', MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '20000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: 'sandbox-shafttrap', RUN_ID: 'sandbox-shafttrap', LOG_DIR: fs.mkdtempSync(path.join(OUT, 'log-')), STATE_DIR: fs.mkdtempSync(path.join(OUT, 'state-')),
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
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-eg-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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
  synthetic: 'arena; stair carved by RCON from shaftgeom plan; bot placed by tp; scene dirt by RCON; no reflexes, no runner', ...r }) + '\n'); P_('RESULT', r) }

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
async function egress (label, extra = {}) {
  const B = botBuildEffects(bot, { withWalk: fn => bot.withTownDepositWalk(fn), aborted: () => false, log: () => {} })
  const e0 = SV.stairBotEffects(bot, B, { log: () => {} })
  const rows = []
  const t0 = Date.now()
  const r = await SV.runStairEgress(PLAN, {
    get read () { return SV.stairRead(bot) },
    feet: () => { const q = bot.entity.position; return [Math.floor(q.x), Math.floor(q.y + 1e-6), Math.floor(q.z)] },
    walkTo: c => stairWalk(c, 9_000),
    dig: c => e0.dig(c),
    occupied: c => bodyOnCell(bot, c),
    now: () => Date.now(), aborted: () => false,
    log: (op, d) => rows.push({ op, ...d }),
  }, { exit: EXIT, deadline: Date.now() + 170_000 })
  try { B.close() } catch {}
  await sleep(1500)
  const pos = posOf()
  const atExit = !!pos && Math.floor(pos[0]) === EXIT[0] && Math.floor(pos[1] + 1e-6) === EXIT[1] && Math.floor(pos[2]) === EXIT[2]
  return { scene: label, r, ms: Date.now() - t0, pos, atExit, digs: rows.filter(x => x.op === 'egress_dig').map(x => x.at.join(',')), ...extra }
}
const EXIT = exitCell()

try {
  P_('arena', { server: SERVER, origin: ORIGIN, away: AWAY, K: PLAN.K, exit: EXIT, sha })
  await arena()
  const t0 = truth()
  P_('carved', { air_ok: t0.air.ok, air_bad: t0.air.bad.length, solid_ok: t0.solid.ok, solid_bad: t0.solid.bad.length })
  if (t0.air.bad.length || t0.solid.bad.length) throw new Error('the stair did not carve as planned')
  await connect()
  for (const scene of SCENES_S.split(',')) {
    // every scene starts on a freshly carved stair
    await batch(PLAN.cells.map(c => set(c.at, c.role === 'air' ? 'air' : 'stone')))
    rcon(`clear ${NAME}`)
    if (scene === 'before' || scene === 'before_clean') {
      const s = G.standOf(PLAN, 40)
      if (scene === 'before') rcon(set(PLAN.steps[30].air[0], 'dirt'))
      await place(s)
      // reflex.mjs canStartAPath, as written: getPathTo(movements, GoalNear(x+8, y, z+8, 3), 800) on the walk profile
      const p = bot.entity.position
      bot.pathfinder.thinkTimeout = 800
      const pr = bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalNear(Math.round(p.x) + 8, Math.round(p.y), Math.round(p.z) + 8, 3), 800)
      const canStart = !!(pr && pr.path && pr.path.length > 0)
      // skills.mjs stairAscend's plan: getPathFromTo to the exit on the town-deposit walk, its slices within 4 s
      let planned = null
      await bot.withTownDepositWalk(async () => {
        const it = bot.pathfinder.getPathFromTo(bot.pathfinder.movements, bot.entity.position, new goals.GoalBlock(EXIT[0], EXIT[1], EXIT[2]), { timeout: 4000, tickTimeout: 40 })
        const end = Date.now() + 4000
        while (Date.now() < end) { const st = it.next(); const s2 = st?.value?.result?.status; if (s2 === 'success' || s2 === 'noPath' || s2 === 'timeout' || st?.done) { planned = s2 ?? 'done'; break } await sleep(0) }
      })
      result({ scene, ok: scene === 'before' ? (canStart === false && planned !== 'success') : planned === 'success', canStartAPath: canStart, canStartStatus: pr?.status, ascentPlan: planned,
        note: 'the chain before shafttrap-01: the maroon probe fails in the stair; one dirt block in an air cell above makes the ascent plan fail' })
      continue
    }
    if (scene === 'clean') { await place(G.standOf(PLAN, 44)); const x = await egress(scene); const tr = truth(); result({ ...x, ok: x.r.ok && x.atExit && !tr.air.bad.length && !tr.solid.bad.length, truth: { air_bad: tr.air.bad, solid_bad: tr.solid.bad } }); continue }
    if (scene === 'pillared') {
      const blocks = [PLAN.steps[44].air[2], PLAN.steps[40].air[0], PLAN.steps[30].air[1], PLAN.steps[12].air[2]]
      rcon(...blocks.map(c => set(c, 'dirt')))
      await place(G.standOf(PLAN, 44))
      const x = await egress(scene, { pillared: blocks.map(c => c.join(',')), bag: 'empty (dirt by hand)' })
      const tr = truth()
      result({ ...x, ok: x.r.ok && x.atExit && x.r.cleared === 4 && !tr.air.bad.length && !tr.solid.bad.length, truth: { air_bad: tr.air.bad, solid_bad: tr.solid.bad } })
      continue
    }
    if (scene === 'lava') {
      // Codex r1 blocker 1 on Paper: dirt in step 43's feet cell is the only thing between a LAVA source in the lining beside it
      // and the stair (a lining cell touching no other air cell): the egress must stop `wet` and dig nothing; the lava stays put
      const dirt = PLAN.steps[43].air[0]
      const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      const add = (c, d) => [c[0] + d[0], c[1] + d[1], c[2] + d[2]]
      const lava = N6.map(d => add(dirt, d)).find(n => PLAN.byKey.get(n.join(','))?.role === 'lining' &&
        N6.every(d => { const m = add(n, d); return m.join(',') === dirt.join(',') || !PLAN.air.has(m.join(',')) }))
      if (!lava) throw new Error('no sealed lining cell beside the dirt')
      rcon(set(dirt, 'dirt'), set(lava, 'lava'))
      await place(G.standOf(PLAN, 44))
      const x = await egress(scene, { dirt: dirt.join(','), lavaAt: lava.join(',') })
      const still = /Test passed/.test(r1(`execute if block ${dirt.join(' ')} minecraft:dirt`))
      const leak = PLAN.cells.filter(c => c.role === 'air').some(c => /Test passed/.test(r1(`execute if block ${c.at.join(' ')} minecraft:lava`)))
      result({ ...x, ok: !x.r.ok && x.r.why === 'wet' && x.digs.length === 0 && still && !leak, dirtStands: still, lavaInStair: leak })
      rcon(set(lava, 'stone'), set(dirt, 'air'))
      continue
    }
    if (scene === 'edge') {
      const s = G.standOf(PLAN, 37), lo = G.standOf(PLAN, 38)
      // the centre 0.45 toward step 38's column (still on the tread: the box is 0.6 wide)
      const dx = 0.5 + 0.45 * Math.sign(lo[0] - s[0]), dz = 0.5 + 0.45 * Math.sign(lo[2] - s[2])
      await place(s, dx, dz)
      const at = bot.entity.position
      const x = await egress(scene, { start: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)], startFloor: [Math.floor(at.x), Math.floor(at.y + 1e-6), Math.floor(at.z)] })
      result({ ...x, ok: x.r.ok && x.atExit })
      continue
    }
    if (scene === 'stub') {
      const l = PLAN.landings.find(q => q.feet === 32)
      await place(G.stubEnd(l))
      const x = await egress(scene)
      result({ ...x, ok: x.r.ok && x.atExit })
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
