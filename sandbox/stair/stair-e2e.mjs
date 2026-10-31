#!/usr/bin/env node
// SANDBOX-ONLY end-to-end run of SHAFT-02, THE TOWN STAIR (bots/src/shaftgeom.mjs + shaftvisit.mjs), Paper 1.21.8.
// A BARE mineflayer bot runs the SAME visit code the fleet runs (runStairVisit over stairBotEffects over buildbot.mjs
// botBuildEffects: the server-witnessed dig, the acknowledged click), walking on a no-dig, no-tower, no-scaffold profile (the
// town-deposit walk's settings). What this proves on the server: the stair gets built from bare rock past the hazards, and the
// pathfinder walks it down and up. What it does not: the cognitive order, the reflexes (the fleet canary reads those).
//
//   node sandbox/stair/stair-e2e.mjs <botRoot> <scene,...> [server]
//   build     bare rock + hazards (a cave beside a step, water in a lining cell, water in a LATER step's air cell beside an
//             earlier step, lava in a lining cell, a gravel ceiling, a dry void under a tread) -> visits until `complete`;
//             THE SERVER'S TRUTH: every air cell open, every tread and lining cell solid, no liquid beside any air cell
//   kill      the builder disconnected mid-visit (twice) and reconnected: it resumes from the world; complete; same truths
//   walk      on the built stair: collar exit -> each landing's stub end and back, timed; feet checked
//   traffic   two bots at once, one walking down, one up: both arrive
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <server> -`; edits on the arena only. Refuses unless the
// sandbox lock names `stair`.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import sbx from '../lib/sbxlock.cjs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: stair-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
sbx.requireSandboxLock(SERVER, 'stair')
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = path.resolve(__dir, '../..')
const OUT = `${R}/sandbox/log/stair-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements, goals } = breq('mineflayer-pathfinder')
const G = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/shaftgeom.mjs')))
const V = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/shaftvisit.mjs')))
const BB = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/buildbot.mjs')))
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const result = r => { fs.appendFileSync(RES, JSON.stringify({ run: RUN, server: SERVER, at: new Date().toISOString(), ...r }) + '\n'); P_('RESULT', r) }

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-stair-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const passed = rep => /Test passed/.test(rep || '')
const rconBatch = (cmds, n = 300) => { const out = []; for (let i = 0; i < cmds.length; i += n) out.push(...rcon(...cmds.slice(i, i + n))); return out }

// ---------------------------------------------------------------- the arena: stone to y=69, grass at 70, air above
const C = { x: 5200, z: 5200 }
const A = { x0: C.x - 30, x1: C.x + 20, z0: C.z - 20, z1: C.z + 20 }
const GY = 70
const HOME = { x: C.x - 22, y: GY + 1, z: C.z }       // home west of the pillar: the stair points east
const CAND = { x: C.x, z: C.z, away: G.awayFrom(HOME, C.x, C.z) }
function buildArena () {
  const c = [`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, `kill @e[type=!player,x=${A.x0},y=0,z=${A.z0},dx=${A.x1 - A.x0},dy=100,dz=${A.z1 - A.z0}]`]
  for (let y = GY + 1; y <= GY + 12; y += 4) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(GY + 12, y + 3)} ${A.z1} minecraft:air`)
  for (let y = 4; y <= GY - 1; y += 4) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(GY - 1, y + 3)} ${A.z1} minecraft:stone`)
  c.push(`fill ${A.x0} ${GY} ${A.z0} ${A.x1} ${GY} ${A.z1} minecraft:grass_block`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
const plan0 = () => G.planStair({ origin: G.originFor(C.x, C.z, CAND.away), away: CAND.away, g: GY, center: [C.x, C.z] })
const set = (c, id) => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`
function hazards () {
  const p = plan0()
  const out = [], note = []
  const s20 = p.steps[20]; const cave = s20.lining.find(c => c[1] === s20.air[1][1])
  out.push(set(cave, 'air')); note.push(['cave beside step 20', cave])
  const s35 = p.steps[35]; out.push(set(s35.lining[0], 'water')); note.push(['water in step 35 lining', s35.lining[0]])
  out.push(set(p.steps[30].air[1], 'water')); note.push(['water in step 30 air, beside step 29', p.steps[30].air[1]])
  const s44 = p.steps[44]; out.push(set(s44.lining[1], 'lava')); note.push(['lava in step 44 lining', s44.lining[1]])
  const s12 = p.steps[12]; const ceil = [s12.air[2][0], s12.air[2][1] + 1, s12.air[2][2]]; out.push(set(ceil, 'gravel')); note.push(['gravel ceiling step 12', ceil])
  const s25 = p.steps[25]; out.push(set([s25.tread[0], s25.tread[1], s25.tread[2]], 'air')); note.push(['void tread step 25', s25.tread])
  rcon(...out)
  return note
}
/** THE SERVER'S TRUTH for a record: air cells open (air/cave_air/torch), treads and lining solid, no liquid beside an air cell. */
function truth (rec) {
  const p = G.planOf(rec)
  const air = p.cells.filter(c => c.role === 'air').map(c => c.at)
  const solid = p.cells.filter(c => c.role !== 'air').map(c => c.at)
  const q = (cells, id) => rconBatch(cells.map(c => `execute if block ${c[0]} ${c[1]} ${c[2]} ${id}`)).map(r => passed(r.reply))
  const rep = q(air, '#minecraft:replaceable'), torch = q(air, 'minecraft:wall_torch'), wetIn = q(air, 'minecraft:water')
  const lavaIn = q(air, 'minecraft:lava')
  const openN = air.filter((c, i) => (rep[i] || torch[i]) && !wetIn[i] && !lavaIn[i]).length
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  const nb = air.flatMap(c => N.map(([a, b, d]) => [c[0] + a, c[1] + b, c[2] + d]))
  const water = q(nb, 'minecraft:water').filter(Boolean).length, lava = q(nb, 'minecraft:lava').filter(Boolean).length
  const solidBad = q(solid, '#minecraft:replaceable').filter(Boolean).length
  return {
    air: air.length, airOpen: openN, wetIn: wetIn.filter(Boolean).length + lavaIn.filter(Boolean).length,
    solid: solid.length, solidBad, waterBeside: water, lavaBeside: lava,
  }
}

// ---------------------------------------------------------------- bots
function walkMoves (bot) {
  const m = new Movements(bot)
  m.canDig = false; m.allow1by1towers = false; m.allowParkour = false; m.scafoldingBlocks = []; m.allowSprinting = true
  return m
}
async function join (name) {
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: name, version: '1.21.8', auth: 'offline' })
  bot.on('error', e => P_(`${name} error`, String(e?.message)))
  bot.loadPlugin(pathfinder)
  await new Promise(r => bot.once('spawn', r))
  await sleep(1500)
  bot.pathfinder.setMovements(walkMoves(bot))
  return bot
}
async function kit (name, at) {
  rcon(`gamemode survival ${name}`, `clear ${name}`, `effect give ${name} minecraft:saturation 3600 1 true`,
    `give ${name} minecraft:iron_pickaxe 2`, `give ${name} minecraft:iron_shovel 1`, `give ${name} minecraft:cobblestone 192`, `give ${name} minecraft:torch 16`,
    `tp ${name} ${at[0] + 0.5} ${at[1]} ${at[2] + 0.5}`, `spawnpoint ${name} ${at[0]} ${at[1]} ${at[2]}`)
  await sleep(4000)   // after the tp: the ghost-block rule (no dig in the first seconds) and the chunks
}
let rec = null
async function visits (bot, { killAfterUnits = null, maxVisits = 60 } = {}) {
  let r = null, n = 0, units = 0
  const built = new Set(rec.landings_built ?? [])
  while (n++ < maxVisits) {
    const B = BB.botBuildEffects(bot, { aborted: () => false, log: () => {} })
    const e = V.stairBotEffects(bot, B, { log: (op, d) => { if (op !== 'dig' && op !== 'place') P_(op, d) } })
    try {
      r = await V.runStairVisit({ rec, exit: rec.exit, built,
        onLanding: async feet => { rec = { ...rec, landings_built: [...new Set([...(rec.landings_built ?? []), feet])].sort((a, b) => b - a) }; return true },
        onStop: async (k, why) => { rec = { ...G.truncatedRecord(rec, k, { why }), structure_complete: true } },
        onDropLanding: async (feet, why) => { rec = G.droppedLandingRecord(rec, feet, { why }) },
      }, e, { deadline: Date.now() + 150_000, unitsMax: killAfterUnits ?? 40 })
    } finally { try { B.close() } catch {} }
    units += r.units
    P_('visit', { stop: r.stop, why: r.why, k: r.k, dug: r.dug, placed: r.placed, units: r.units, landings: r.landings })
    if (killAfterUnits && r.stop === 'units') return { r, units, killed: true }
    if (!['units', 'time'].includes(r.stop)) break
  }
  return { r, units, killed: false }
}
async function walkTimed (bot, cell, ms = 120_000) {
  const t0 = Date.now()
  try {
    await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(cell[0], cell[1], cell[2])), sleep(ms).then(() => { throw new Error('timeout') })])
  } catch (e) { try { bot.pathfinder.setGoal(null) } catch {} return { ok: false, ms: Date.now() - t0, why: String(e?.message ?? e) } }
  const p = bot.entity.position
  const at = [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)]
  return { ok: at.join() === cell.join(), ms: Date.now() - t0, at }
}

// ---------------------------------------------------------------- scenes
const scenes = SCENES_S.split(',')
const NAME = 'sbx-Stair', NAME2 = 'sbx-Stair2'
let bot = null
try {
  if (scenes.includes('build') || scenes.includes('kill')) {
    buildArena()
    const notes = hazards()
    P_('hazards', notes)
    bot = await join(NAME)
    const read = V.stairRead(bot)
    await kit(NAME, [HOME.x, HOME.y, HOME.z])
    const sv = G.surveySite(V.stairRead(bot), HOME, CAND)
    if (!sv.ok) throw new Error(`survey: ${sv.why}`)
    rec = G.stairRecord(sv, { home: HOME, now: Date.now(), by: NAME })
    P_('sited', { K: rec.K, landings: rec.landings, exit: rec.exit, stopK: sv.stopK, lining: sv.lining, digs: sv.digs })
    void read
    const t0 = Date.now()
    let killed = 0
    if (scenes.includes('kill')) {
      for (let i = 0; i < 2; i++) {
        const v = await visits(bot, { killAfterUnits: 12 + i * 9 })
        if (!v.killed) break
        killed++
        P_('KILL: disconnect mid-build', { units: v.units })
        bot.quit('kill'); await sleep(5000)
        bot = await join(NAME); await sleep(3000)
      }
    }
    const v = await visits(bot)
    const tr = truth(rec)
    const ok = v.r.stop === 'complete' && tr.airOpen === tr.air && tr.solidBad === 0 && tr.waterBeside === 0 && tr.lavaBeside === 0 && (rec.landings_built ?? []).length === rec.landings.length
    result({ scene: scenes.includes('kill') ? 'kill' : 'build', ok, stop: v.r.stop, why: v.r.why, killed, ms: Date.now() - t0, landings: rec.landings, built: rec.landings_built, K: rec.K, truth: tr })
    fs.writeFileSync(`${OUT}/${RUN}-record.json`, JSON.stringify(rec))
  }
  if (scenes.includes('walk') || scenes.includes('traffic')) {
    if (!rec) { const f = fs.readdirSync(OUT).filter(x => x.endsWith('-record.json')).sort().pop(); rec = JSON.parse(fs.readFileSync(`${OUT}/${f}`, 'utf8')) }
    const plan = G.planOf(rec)
    bot ??= await join(NAME)
    rcon(`tp ${NAME} ${rec.exit[0] + 0.5} ${rec.exit[1]} ${rec.exit[2] + 0.5}`); await sleep(3000)
    if (scenes.includes('walk')) {
      const legs = []
      for (const l of plan.landings) {
        const end = G.stubEnd(l)
        const down = await walkTimed(bot, end)
        const up = await walkTimed(bot, rec.exit)
        legs.push({ feet: l.feet, down, up })
      }
      result({ scene: 'walk', ok: legs.every(x => x.down.ok && x.up.ok), legs })
    }
    if (scenes.includes('traffic')) {
      const b2 = await join(NAME2)
      const deep = G.stubEnd(plan.landings[plan.landings.length - 1])
      rcon(`gamemode survival ${NAME2}`, `tp ${NAME2} ${deep[0] + 0.5} ${deep[1]} ${deep[2] + 0.5}`)
      rcon(`tp ${NAME} ${rec.exit[0] + 0.5} ${rec.exit[1]} ${rec.exit[2] + 0.5}`); await sleep(3000)
      const [a, b] = await Promise.all([walkTimed(bot, deep), walkTimed(b2, rec.exit)])
      result({ scene: 'traffic', ok: a.ok && b.ok, down: a, up: b })
      b2.quit('done')
    }
  }
} catch (e) {
  result({ scene: SCENES_S, ok: false, error: String(e?.stack ?? e).slice(0, 400) })
} finally {
  try { bot?.quit('done') } catch {}
  await sleep(1000)
  process.exit(0)
}
