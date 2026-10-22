// SANDBOX-ONLY Paper scenes for the town-ground ZONE (townzone-01) on the REAL bot, candidate vs control.
// The bot (src/index.mjs from <botRoot>, unmodified) answers an embedded loopback brain (127.0.0.1:11499) that serves the
// scene's one decision, then `status`. The WORLD is the oracle: after each scene the removed cells inside the town square
// are counted by RCON (`fill ... dirt replace air` over the slab returns how many it filled), the bag by `clear ... 0`;
// the instrument's own `_dig_town` rows are compared with that count (the real-bot half of the instrument fixture).
//
//   node sandbox/townground/zone-scenes.mjs <arm> <botRoot> [server=sandbox4] [scenes=G,M,P,F]
//   G  gather dirt from home: candidate takes dirt OUTSIDE the square only; control digs inside.
//   M  mine from inside the square (16 from home on x, > 12): candidate walks out and stairs outside; control stairs in place.
//   P  a bot at the bottom of a 5-deep 1x1 pit inside town asks for dirt: candidate digs out (transit, priced) and gathers
//      outside; control digs the town (Claude code r1 P2: the pit trap shown on real Paper, not only by a neighbour's cost).
//   E  REFLEX PREEMPTION: the bot is GATHERING (an order of 30 dirt, so gather holds the body) when RCON entombs it in town
//      (stone on every side and above). Whatever digs it out -- a reflex (survival) or the running gather's own pathfinder
//      (transit) -- no dig of the tomb may read as gather's TARGET, and the bot must end outside the tomb (Codex code r2-r4 A).
//   F  gather dirt with NO dirt outside the square within reach (a stone floor beyond it): candidate refuses naming the
//      remedy and digs nothing in town; control digs town.
// Refuses unless /tmp/mcai-sandbox.lock on 10.0.0.31 names 'townground'.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import sbx from '../lib/sbxlock.cjs'
import path from 'node:path'

const [ARM, BOT_ROOT, SERVER = 'sandbox4', SCENES = 'G,M,P,E,F'] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!ARM || !BOT_ROOT || !PORTS[SERVER]) throw new Error('usage: zone-scenes.mjs <arm> <botRoot> [server] [scenes]')
sbx.requireSandboxLock(SERVER, 'townground')   // the global lock or this server's own (sandbox/lib/sbxlock.cjs); throws unless every lock on SERVER has our tag as its owner's first word
const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const NAME = 'sandbox-Zone'
const OUT = `${R}/sandbox/log/townground`; fs.mkdirSync(OUT, { recursive: true })
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ${ARM} ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/zone-${RUN}.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tgz-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const filled = rep => Number(/Successfully filled (\d+)/.exec(rep || '')?.[1] ?? (/No blocks were filled/.test(rep || '') ? 0 : NaN))

// ---- the arena: home 2410,120,2410; the square 2394..2426 x 2394..2426; dirt slab y 113..119 over stone 100..112 ------
const HOME = { x: 2410, y: 120, z: 2410 }
const SQ = { x0: 2394, x1: 2426, z0: 2394, z1: 2426 }
const A = { x0: 2380, x1: 2450, z0: 2390, z1: 2430 }
function buildArena ({ outsideDirt = true } = {}) {
  const c = [`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`,
    `kill @e[type=item,x=${A.x0},y=90,z=${A.z0},dx=70,dy=60,dz=40]`]
  for (let x = A.x0; x <= A.x1; x += 20) {
    const x1 = Math.min(A.x1, x + 19)
    c.push(`fill ${x} 100 ${A.z0} ${x1} 112 ${A.z1} minecraft:stone`, `fill ${x} 113 ${A.z0} ${x1} 119 ${A.z1} minecraft:dirt`, `fill ${x} 120 ${A.z0} ${x1} 135 ${A.z1} minecraft:air`)
  }
  if (!outsideDirt) for (const [x0, x1] of [[A.x0, SQ.x0 - 1], [SQ.x1 + 1, A.x1]]) c.push(`fill ${x0} 113 ${A.z0} ${x1} 119 ${A.z1} minecraft:stone`)
  if (!outsideDirt) for (const [z0, z1] of [[A.z0, SQ.z0 - 1], [SQ.z1 + 1, A.z1]]) c.push(`fill ${SQ.x0} 113 ${z0} ${SQ.x1} 119 ${z1} minecraft:stone`)
  const r = rcon(...c)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Expected|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
/** removed cells in the square's slab (y 100..119): the count of air the replace-fill finds (and refills). */
function removedInSquare (pitCells = 0) {
  const r = rcon(`fill ${SQ.x0} 113 ${SQ.z0} ${SQ.x1} 119 ${SQ.z1} minecraft:dirt replace minecraft:air`,
                 `fill ${SQ.x0} 100 ${SQ.z0} ${SQ.x1} 112 ${SQ.z1} minecraft:stone replace minecraft:air`)
  const a = filled(r[0]?.reply), b = filled(r[1]?.reply)
  return { dirtLayer: a - pitCells, stoneLayer: b, total: a + b - pitCells }
}
const countItem = (item) => Number(/Found (\d+) matching/.exec(rcon(`clear ${NAME} minecraft:${item} 0`)[0]?.reply || '')?.[1] ?? 0)

// ---- the brain -------------------------------------------------------------------------------------------------------
let queue = []
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const decision = queue.length ? queue.shift() : { skill: 'status', args: {} }
    P('decision', decision)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox scene', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
await new Promise(r => brain.listen(11499, '127.0.0.1', r))

// ---- the bot ---------------------------------------------------------------------------------------------------------
let bot = null
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }
async function stopBot () { try { bot && bot.kill('SIGTERM') } catch {} bot = null; await waitFor(() => !new RegExp(NAME).test(rcon('list')[0]?.reply || ''), 30000, 1000) }
async function startBot (scene, at, kit) {
  const tag = `${RUN}-${ARM}-${String(scene).split(" ")[0]}`   // no spaces: the env file is sourced
  const logRel = `./sandbox/log/townground/${tag}`
  const skillLog = `${R}/sandbox/log/townground/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (k, v) => { env = new RegExp(`^${k}=`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `\n${k}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/townground-${tag}`); set('MEMORY_POOL', `sbxzone-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('WORLD_BORDER_RADIUS', 5000); set('MAX_CONSECUTIVE_FAILURES', 50); set('STUCK_SECONDS', 30); set('LLM_DECISION_COOLDOWN_MS', 3000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/sandbox/.env.townground`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, 'sandbox/.env.townground'], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 500)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:saturation 600 1 true`, `tp ${NAME} ${at[0] + 0.5} ${at[1]} ${at[2] + 0.5}`)
  await sleep(8000)
  const c = [`tp ${NAME} ${at[0] + 0.5} ${at[1]} ${at[2] + 0.5}`]
  kit.forEach(([id, n], s) => c.push(`item replace entity ${NAME} container.${s} with minecraft:${id} ${n}`))
  rcon(...c)
  await sleep(4000)
  return { skillLog, botOut }
}

const RES = `${OUT}/zone-results.jsonl`
const results = []
function record (r) { results.push(r); fs.appendFileSync(RES, JSON.stringify({ run: RUN, arm: ARM, botRoot: BOT_ROOT, ...r }) + '\n'); P('RESULT', r) }
const KIT = [['stone_pickaxe', 1], ['stone_pickaxe', 1], ['cobblestone', 64], ['cobblestone', 64], ['oak_log', 16], ['bread', 16]]

async function scene (name, { at, decision, pit = 0, outsideDirt = true, ms = 150000, setup = null, during = null, repeat = 1, judge = null, kit = KIT }) {
  buildArena({ outsideDirt })
  if (setup) setup()
  const f = await startBot(name, at, kit)
  const dirt0 = countItem('dirt')
  queue = Array.from({ length: repeat }, () => decision)
  const t0 = Date.now()
  let duringOut = null
  if (during) duringOut = await during(f, t0)
  const done = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === decision.skill && Date.parse(r['@timestamp']) > t0 && r.skill.status !== 'started'), ms, 1000)
  await sleep(13000)                                       // the instrument's 10 s grace
  const dirt1 = countItem('dirt')
  const rows = rowsOf(f.skillLog)
  await stopBot()
  const removed = removedInSquare(pit)
  const dig = rows.filter(r => r.skill.name === '_dig_town').map(r => r.skill.args || {})
  const conf = dig.filter(a => a.outcome === 'confirmed' && a.x >= SQ.x0 && a.x <= SQ.x1 && a.z >= SQ.z0 && a.z <= SQ.z1)
  const zrows = rows.filter(r => r.skill.name === '_town_ground').map(r => r.skill.detail)
  const out = {
    scene: name, decision, result: done ? `${done.skill.status} ${done.skill.detail ?? ''}`.slice(0, 260) : 'no result row',
    removed_in_square: removed, dirt_gained: dirt1 - dirt0,
    instrument_confirmed_in_square: conf.length, instrument_by_purpose: Object.entries(conf.reduce((m, a) => { const k = `${a.purpose}:${String(a.by).split(':')[0]}`; m[k] = (m[k] ?? 0) + 1; return m }, {})),
    town_ground_rows: zrows.slice(0, 4), summaries: rows.filter(r => r.skill.name === '_dig_town_sum').length,
    during: duringOut, tomb_rows: duringOut?.tomb ? dig.filter(a => duringOut.tomb.some(c => c[0] === a.x && c[1] === a.y && c[2] === a.z)).map(a => `${a.purpose}:${String(a.by).split(':')[0]}:${a.outcome}`) : undefined,
  }
  // PASS: gather held the body at the entombment, the bot got out, and no dig of the tomb was read as a TARGET dig. Who dug
  // it out is reported: on 10-13 the running gather's own pathfinder dug out first (transit) before any reflex fired.
  if (duringOut?.tomb) out.tomb_pass = duringOut.gatherStarted && duringOut.runningAtEntomb && out.tomb_rows.length > 0 && out.tomb_rows.every(x => !x.startsWith('target:')) && duringOut.escaped === true
  if (judge) Object.assign(out, judge(rows, duringOut))
  record(out)
  return out
}

const want = new Set(SCENES.split(','))
P('run', RUN, 'arm', ARM, 'botRoot', BOT_ROOT, 'server', SERVER)
try {
  if (want.has('G')) await scene('G gather dirt from home', { at: [2410, 120, 2410], decision: { skill: 'gather', args: { block: 'dirt', count: 4 } } })
  if (want.has('M')) await scene('M mine from inside the square', { at: [2425, 120, 2410], decision: { skill: 'mine', args: { y: 104 } } })
  if (want.has('P')) await scene('P gather from a 5-deep 1x1 town pit', {
    at: [2414, 115, 2410], pit: 5, decision: { skill: 'gather', args: { block: 'dirt', count: 2 } },
    setup: () => rcon('fill 2414 115 2410 2414 119 2410 minecraft:air'),
  })
  if (want.has('E')) await scene('E reflex preemption: entombed while gathering', {
    at: [2440, 120, 2410], decision: { skill: 'gather', args: { block: 'dirt', count: 30 } }, ms: 150000, outsideDirt: true,
    during: async (f, T0) => {
      // wait until gather holds the body (its first dig), then entomb the bot where it stands -- in town: tp it in first
      // gather must HOLD the body when the tomb closes (Codex code r4): it has dug (a summary counted a dig) and its own
      // result row has not been written yet (the runner writes it when the skill ends)
      const gatherEnded = () => rowsOf(f.skillLog).some(r => r.skill.name === 'gather' && Date.parse(r['@timestamp']) >= T0)
      const started = await waitFor(() => rowsOf(f.skillLog).some(r => r.skill.name === '_dig_town_sum' && (r.skill.args?.all ?? 0) > 0) || null, 60000, 500)
      const runningAtEntomb = !!started && !gatherEnded()
      const x = 2412, y = 120, z = 2410
      rcon(`tp ${NAME} ${x + 0.5} ${y} ${z + 0.5}`)
      await sleep(400)
      rcon(`fill ${x - 1} ${y} ${z - 1} ${x + 1} ${y + 2} ${z + 1} minecraft:stone`, `fill ${x} ${y} ${z} ${x} ${y + 1} ${z} minecraft:air`)
      const tomb = []
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) if (dx || dz || dy === 2) tomb.push([x + dx, y + dy, z + dz])
      await sleep(60000)
      const pos = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(rcon(`data get entity ${NAME} Pos`)[0]?.reply || '')
      const p = pos ? pos.slice(1).map(Number) : null
      const escaped = !!p && (Math.abs(p[0] - (x + 0.5)) > 1.2 || Math.abs(p[2] - (z + 0.5)) > 1.2 || p[1] > y + 1.5)
      return { gatherStarted: !!started, runningAtEntomb, tomb, pos: p, escaped }
    },
  })
  // E2 (Codex re-review 10-13): a REFLEX dig while gather is ACTIVE. gather is ordered six times back to back so it is the
  // running skill nearly all the time; the bot is entombed in stone after its first dig. Judged from the rows: a dig labelled
  // survival whose own start (args.t0) lies inside a gather run's [start, start + duration_ms] (the runner's row), and no
  // dig labelled survival ever labelled target. Run on the INSTRUMENT build (dt): that is what digtown-01 ships.
  if (want.has('E2')) await scene('E2 reflex dig during an active gather', {
    at: [2440, 120, 2410], decision: { skill: 'gather', args: { block: 'dirt', count: 30 } }, repeat: 30, ms: 240000,
    kit: [['stone_pickaxe', 1], ['stone_pickaxe', 1], ['bread', 16]],
    during: async (f) => {
      await waitFor(() => rowsOf(f.skillLog).some(r => r.skill.name === '_dig_town_sum' && (r.skill.args?.all ?? 0) > 0) || null, 60000, 500)
      // IN A HOLE (the entombment detector needs ground well above the head within 4: a flat arena reads as a corridor):
      // the bot at y 114, six below the slab's top
      const x = 2412, y = 114, z = 2410
      rcon(`fill ${x - 1} ${y - 1} ${z - 1} ${x + 1} ${y + 3} ${z + 1} minecraft:obsidian`)
      rcon(`tp ${NAME} ${x + 0.5} ${y} ${z + 0.5}`); await sleep(400)
      // an OBSIDIAN box (neither gather's pathfinder nor a stone pickaxe can take it) with ONE stone ceiling cell, and no
      // placeable block in the bag: gather has no route out, so it keeps failing and being re-ordered, while the reflexes
      // (marooned / entombed) are the only ones that can act -- on the stone ceiling
      rcon(`fill ${x - 1} ${y - 1} ${z - 1} ${x + 1} ${y + 3} ${z + 1} minecraft:obsidian`, `fill ${x} ${y} ${z} ${x} ${y + 1} ${z} minecraft:air`, `setblock ${x} ${y + 2} ${z} minecraft:stone`, `setblock ${x} ${y + 3} ${z} minecraft:dirt`)
      await sleep(150000)
      return { entombedAt: Date.now() - 150000 }
    },
    judge: (rows) => {
      const gathers = rows.filter(r => r.skill.name === 'gather').map(r => [Date.parse(r['@timestamp']), Date.parse(r['@timestamp']) + (r.skill.duration_ms ?? 0)])
      const digs = rows.filter(r => r.skill.name === '_dig_town').map(r => r.skill.args || {})
      const inGather = t => gathers.some(([a, b]) => t >= a && t <= b)
      const reflexDuring = digs.filter(a => a.purpose === 'survival' && inGather(a.t0))
      const mislabel = digs.filter(a => a.purpose === 'target' && /^(reflex|holder):/.test(String(a.by)))
      return { gather_runs: gathers.map(([a, b]) => `${new Date(a).toISOString().slice(11, 19)}+${Math.round((b - a) / 1000)}s`),
               survival_digs: digs.filter(a => a.purpose === 'survival').map(a => `${new Date(a.t0).toISOString().slice(11, 19)} ${a.by} ${a.block}@${a.x},${a.y},${a.z} ${a.outcome}`),
               reflex_during_gather: reflexDuring.length, e2_pass: reflexDuring.length > 0 && mislabel.length === 0 }
    },
  })
  if (want.has('F')) await scene('F gather dirt, none outside', { at: [2410, 120, 2410], outsideDirt: false, decision: { skill: 'gather', args: { block: 'dirt', count: 2 } } })
} finally {
  await stopBot().catch(() => {})
  try { rcon(`forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch {}
  brain.close()
}
P('DONE', results.map(r => `${r.scene}: removed ${r.removed_in_square.total} (instrument ${r.instrument_confirmed_in_square}), dirt +${r.dirt_gained} :: ${r.result.slice(0, 90)}`))
process.exit(results.some(r => r.tomb_pass === false || r.e2_pass === false) ? 1 : 0)
