// SANDBOX-ONLY end-to-end run of the town TREE FARM (bots/src/treefarm.mjs + blueprint.mjs + skills tend_farm), Paper.
// The REAL bot (src/index.mjs from <botRoot>, unmodified) runs its own deterministic town orders; the loopback brain in
// THIS process answers the model's decisions (status, or a scene's queued gather/goto/place). Two node processes in all.
//
//   node sandbox/treefarm/treefarm-e2e.cjs <botRoot> <scene,scene,...> [server]
//   scenes: build  resume  lease  paths  grow  bonemeal
//
// The SERVER is the oracle: every plot, torch and soil cell is read back by RCON (`execute if block`), the bag by
// `data get entity`, items on the ground by entity selectors. The bot's rows are recorded, never trusted as the outcome.
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -` (it reads the password itself). Every edit
// is on this arena; the run refuses a non-sandbox server or bot name. randomTickSpeed is raised only inside `grow` and
// restored in a finally.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox4'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node treefarm-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.TF_REPO || path.resolve(__dirname, '../..')
const NAME = 'sandbox-Farm'
if (!/^sandbox-/.test(NAME)) throw new Error('sandbox bot names only')
const OUT = process.env.TF_OUT || `${R}/sandbox/log/treefarm-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tfe2e-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const cnt = rep => Number(/count: (\d+)/.exec(rep || '')?.[1] ?? 0)

// ---------------------------------------------------------------- the arena: a grass slab, 7 deep, floating at y 113..119
// INSIDE THE BOT'S WORLD BORDER (WORLD_BORDER_RADIUS=1950 from spawn): run 1 used 2650,2650 (3,747 out) and every
// gather/goto refused on the border -- the farm's own visit does not check it, the other skills do.
const HOME = { x: 1200, y: 120, z: -1200 }
const A = { x0: 1160, x1: 1240, z0: -1240, z1: -1160 }
const G = 119
const arenaRead = (x, y, z) => {
  const inside = x >= A.x0 && x <= A.x1 && z >= A.z0 && z <= A.z1
  const name = inside && y >= 113 && y <= G ? (y === G ? 'grass_block' : 'dirt') : 'air'
  return { name, boundingBox: name === 'air' ? 'empty' : 'block' }
}
function buildArena () {
  const c = [`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, `kill @e[type=!player,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=50,dz=${A.z1 - A.z0}]`]
  // TOP DOWN: clearing the ground first pops the previous scene's saplings and torches off as ITEMS (run 1: 9 on the
  // ground at the next scene's start, picked up by the bot). The plants go first, then their ground; items killed after.
  for (let y = 144; y >= 112; y -= 4) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y + 3} ${A.z1} minecraft:air`)
  c.push(`fill ${A.x0} 113 ${A.z0} ${A.x1} 116 ${A.z1} minecraft:dirt`, `fill ${A.x0} 117 ${A.z0} ${A.x1} 118 ${A.z1} minecraft:dirt`,
    `fill ${A.x0} ${G} ${A.z0} ${A.x1} ${G} ${A.z1} minecraft:grass_block`,
    `kill @e[type=item,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=50,dz=${A.z1 - A.z0}]`, `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  const r = rcon(...c)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}

// ---------------------------------------------------------------- the server's truth
const parseItem = seg => { const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; return id ? { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) } : null }
function bag (name) {
  const cmds = []; for (let s = 0; s < 36; s++) cmds.push(`data get entity ${name} Inventory[{Slot:${s}b}]`)
  const r = rcon(...cmds); const totals = {}; let used = 0
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) { used++; totals[it.id] = (totals[it.id] || 0) + it.count } }
  return { used, totals }
}
const deltaOf = (a, b) => Object.fromEntries(Object.keys({ ...a, ...b }).map(k => [k, (b[k] || 0) - (a[k] || 0)]).filter(([, d]) => d))
const itemsOnGround = () => cnt(r1(`execute if entity @e[type=item,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=50,dz=${A.z1 - A.z0}]`))
/** Every plot / torch / soil cell as the SERVER has it. */
function farmTruth (rec) {
  const plots = rec.cells.filter(c => c.role === 'plot'), torches = rec.cells.filter(c => c.role === 'torch')
  const cmds = []
  for (const p of plots) cmds.push(`execute if block ${p.x} ${p.y} ${p.z} #minecraft:saplings`, `execute if block ${p.x} ${p.y} ${p.z} #minecraft:logs`, `execute if block ${p.x} ${p.y - 1} ${p.z} #minecraft:dirt`)
  for (const t of torches) cmds.push(`execute if block ${t.x} ${t.y} ${t.z} minecraft:torch`, `execute if block ${t.x} ${t.y - 1} ${t.z} #minecraft:dirt`)
  const r = rcon(...cmds)
  let i = 0
  const out = { saplings: 0, trees: 0, soil: 0, torches: 0, torchFloors: 0, plots: plots.length, torchCells: torches.length, plotStates: [] }
  for (const p of plots) {
    const s = passed(r[i++]?.reply), l = passed(r[i++]?.reply), d = passed(r[i++]?.reply)
    out.saplings += s; out.trees += l; out.soil += d; out.plotStates.push(s ? 'sapling' : l ? 'tree' : 'empty')
  }
  for (const t of torches) { out.torches += passed(r[i++]?.reply); out.torchFloors += passed(r[i++]?.reply); void t }
  return out
}
/** Logs left in each plot's column above the plot cell (a partial harvest's leftovers), as the server has them. */
function columnLogs (rec) {
  const plots = rec.cells.filter(c => c.role === 'plot')
  const cmds = []
  for (const p of plots) for (let k = 1; k <= 8; k++) cmds.push(`execute if block ${p.x} ${p.y + k} ${p.z} #minecraft:logs`)
  const r = rcon(...cmds)
  let i = 0
  return plots.map(p => { let n = 0; for (let k = 1; k <= 8; k++) n += passed(r[i++]?.reply); return { x: p.x, z: p.z, n } })
}
/** OFF-PLAN: every non-air cell above the ground inside the farm's box (+2) that is not a recorded cell or a tree part. */
function offPlan (rec) {
  const xs = rec.cells.map(c => c.x), zs = rec.cells.map(c => c.z)
  const box = { x0: Math.min(...xs) - 3, x1: Math.max(...xs) + 3, z0: Math.min(...zs) - 3, z1: Math.max(...zs) + 3 }
  const recorded = new Set(rec.cells.map(c => `${c.x},${c.y},${c.z}`))
  const cells = []
  for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) for (let y = G + 1; y <= G + 2; y++) if (!recorded.has(`${x},${y},${z}`)) cells.push({ x, y, z })
  const r = rcon(...cells.map(c => `execute unless block ${c.x} ${c.y} ${c.z} #minecraft:air unless block ${c.x} ${c.y} ${c.z} #minecraft:logs unless block ${c.x} ${c.y} ${c.z} #minecraft:leaves`))
  const hits = cells.filter((c, i) => passed(r[i]?.reply))
  const holes = []
  const r2 = rcon(...cells.filter(c => c.y === G + 1).map(c => `execute unless block ${c.x} ${G} ${c.z} #minecraft:dirt`))
  cells.filter(c => c.y === G + 1).forEach((c, i) => { if (passed(r2[i]?.reply)) holes.push({ x: c.x, y: G, z: c.z }) })
  return { box, scanned: cells.length, foreign: hits, holes }
}

// ---------------------------------------------------------------- the bot and its logs
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// the loopback brain: a queue of decisions per scene, else status and a short walk near home (a lone 'status' trips the
// fleet's livelock breaker and relocates the bot off the arena -- the well harness found that)
let QUEUE = [], brainN = 0
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = QUEUE.length ? QUEUE.shift() : (brainN++ % 2 ? { skill: 'goto', args: { x: HOME.x + (brainN % 4 < 2 ? 2 : -2), y: HOME.y, z: HOME.z + 1 } } : { skill: 'status', args: {} })
    P('brain ->', decision)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot (sig = 'SIGTERM') {
  try { bot && bot.kill(sig) } catch {}
  bot = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
let POOL = null
async function startBot (scene, slotsSpec, { pool = null, env: extra = {}, keepBag = false } = {}) {
  POOL = pool ?? `sbxfarm-${RUN}-${scene}`
  const tag = `${RUN}-${scene}-${Date.now() % 100000}`
  const logRel = `./sandbox/log/treefarm-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/treefarm-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`
  const envRel = 'sandbox/.env.treefarm-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/treefarm-e2e/${POOL}/bot`); set('MEMORY_POOL', POOL)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  for (const [k, v] of Object.entries(extra)) set(k, v)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`)
  if (!keepBag) rcon(`clear ${NAME}`)
  await sleep(8000)
  if (!keepBag) {
    const c = [`tp ${NAME} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`]
    let s = 0
    for (const [id, n] of slotsSpec) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
    rcon(...c)
  }
  await sleep(2000)
  return { skillLog, botOut, tag }
}
const poolDir = () => `${R}/sandbox/state/treefarm-e2e/${POOL}/_pool-${POOL}`
function record () {
  const dir = poolDir()
  let best = null
  try { for (const f of fs.readdirSync(dir)) { const m = /^treefarm-.*\.g(\d+)\.json$/.exec(f); if (m && (!best || +m[1] > best.n)) best = { n: +m[1], f } } } catch { return null }
  return best ? { gen: best.n, ...JSON.parse(fs.readFileSync(path.join(dir, best.f), 'utf8')) } : null
}
const tendRows = files => rowsOf(files.skillLog).filter(r => r.name === '_farm_tend')
const placeRows = files => rowsOf(files.skillLog).filter(r => r.name === '_farm_place')
const field = (d, k) => (new RegExp(`(?:^| )${k}=([^ ]*)`).exec(d) || [])[1]
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), run: RUN, ...r }) + '\n'); P('RESULT', r) }
const ROCKS = ['andesite', 'diorite', 'granite', 'calcite']
const fill = (spec, n = 20) => { const out = [...spec]; let i = 0; while (out.length < n) out.push([ROCKS[i++ % ROCKS.length], 64]); return out }
let TF = null

// ---------------------------------------------------------------- scenes
const scenes = {}
const BASE_BAG = [['birch_sapling', 6], ['oak_sapling', 6], ['torch', 4], ['bone_meal', 5], ['stone_axe', 1]]

scenes.build = async () => {
  buildArena()
  const expected = TF.canonicalFarm({ home: HOME, read: arenaRead }).record
  const files = await startBot('build', fill(BASE_BAG))
  const before = bag(NAME)
  const row = await waitFor(() => tendRows(files).find(r => r.status === 'success' || r.status === 'failed'), 240000)
  await sleep(3000)
  const after = bag(NAME), rec = record()
  const truth = rec ? farmTruth(rec) : null, off = rec ? offPlan(rec) : null
  await stopBot()
  result({ scene: 'build', row: row && `${row.status} ${row.detail}`, gen: rec?.gen,
    sameAsCanonical: !!rec && JSON.stringify(rec.cells) === JSON.stringify(expected?.cells), truth, offPlan: off && { scanned: off.scanned, foreign: off.foreign, holes: off.holes },
    bag: { before: before.used, after: after.used, delta: deltaOf(before.totals, after.totals) }, ground: itemsOnGround(),
    placeRows: placeRows(files).map(r => `${r.status} ${r.detail}`) })
}

scenes.resume = async () => {
  // DISCONNECT MID-BUILD: SIGKILL the bot after its third confirmed placement; restart it; the farm must finish from the world.
  buildArena()
  let files = await startBot('resume', fill(BASE_BAG))
  const third = await waitFor(() => placeRows(files).filter(r => r.status === 'success').length >= 3, 240000, 200)
  await stopBot('SIGKILL')
  const rec0 = record(), mid = rec0 ? farmTruth(rec0) : null
  const groundAtKill = itemsOnGround()
  const pool = POOL
  files = await startBot('resume2', [], { pool, keepBag: true })
  const row = await waitFor(() => tendRows(files).find(r => r.status === 'success' || r.status === 'failed'), 420000)
  await sleep(3000)
  const rec = record(), truth = rec ? farmTruth(rec) : null, off = rec ? offPlan(rec) : null
  const bagAfter = bag(NAME)
  await stopBot()
  result({ scene: 'resume', killedAfterThird: !!third, mid: mid && { saplings: mid.saplings, torches: mid.torches }, groundAtKill, sameRecord: rec0?.gen === rec?.gen,
    row: row && `${row.status} ${row.detail}`, truth, offPlan: off && { foreign: off.foreign, holes: off.holes }, bagAfter: bagAfter.totals, ground: itemsOnGround() })
}

scenes.lease = async () => {
  // ONE BUILDER PER TOWN: another bot's live lease (written into the shared pool dir) -> this bot changes nothing; once it
  // expires this bot takes over (after its own 5-minute tend cooldown) and builds.
  buildArena()
  POOL = `sbxfarm-${RUN}-lease`
  fs.mkdirSync(poolDir(), { recursive: true })
  const key = `treefarm-${HOME.x}_${HOME.y}_${HOME.z}`
  const until = Date.now() + 100_000
  fs.writeFileSync(path.join(poolDir(), `${key}.lease1.json`), JSON.stringify({ holder: 'sandbox-Other', until, at: new Date().toISOString() }))
  const files = await startBot('lease', fill(BASE_BAG), { pool: POOL })
  const refused = await waitFor(() => tendRows(files).find(r => /held:sandbox-Other/.test(r.detail)), 150000)
  const duringLease = record() ? farmTruth(record()) : null
  const placedDuring = placeRows(files).filter(r => r.ts < until).length
  const took = await waitFor(() => tendRows(files).find(r => r.status === 'success'), 480000, 1000)
  await sleep(3000)
  const rec = record(), truth = rec ? farmTruth(rec) : null
  await stopBot()
  result({ scene: 'lease', refused: refused && `${refused.status} ${refused.detail}`, duringLease: duringLease && { saplings: duringLease.saplings, torches: duringLease.torches },
    placedDuringLease: placedDuring, tookOver: took && `${took.status} ${took.detail}`, tookOverAfterExpiry: took ? took.ts >= until : null, truth })
}

scenes.paths = async () => {
  // OTHER WORK AROUND A BUILT FARM: the real bot's own gather/place/goto, with the farm's exclusions, near and across it.
  if (!record()) await scenes.build()
  const rec0 = record()
  const plots = rec0.cells.filter(c => c.role === 'plot')
  const inside = { x: plots[0].x + 2, y: G + 1, z: plots[0].z + 2 }
  const far = plots.reduce((a, p) => (Math.hypot(p.x - HOME.x, p.z - HOME.z) > Math.hypot(a.x - HOME.x, a.z - HOME.z) ? p : a))
  QUEUE = [{ skill: 'gather', args: { block: 'dirt', count: 12 } }, { skill: 'place', args: { item: 'crafting_table' } },
           { skill: 'goto', args: { x: far.x + 3, y: G + 1, z: far.z + 3 } }, { skill: 'goto', args: { x: HOME.x, y: HOME.y, z: HOME.z } }]
  const files = await startBot('paths', fill([['crafting_table', 1], ['stone_shovel', 1]]), { pool: POOL })
  rcon(`tp ${NAME} ${inside.x + 0.5} ${inside.y} ${inside.z + 0.5}`)
  const done = await waitFor(() => QUEUE.length === 0 && rowsOf(files.skillLog).filter(r => /^(gather|place|goto)$/.test(r.name)).length >= 3, 300000, 1000)
  await sleep(8000)
  const truth = farmTruth(rec0), off = offPlan(rec0)
  const skills = rowsOf(files.skillLog).filter(r => /^(gather|place|goto)$/.test(r.name)).map(r => `${r.name} ${r.status} ${r.detail.slice(0, 160)}`)
  await stopBot()
  // `truth` is the reserved cells (plots, soil, torches); `walkway` is anything else placed between them (allowed: only
  // reserved cells are protected; a table or a scaffold block in a walkway does not stop a tree)
  result({ scene: 'paths', done: !!done, truth, walkway: off.foreign, holes: off.holes, skills })
}

scenes.grow = async () => {
  // GROW, HARVEST WITH THE ORDINARY GATHER, REPLANT. randomTickSpeed 30 on this sandbox for the scene only (10x: a median
  // 16 min sapling -> ~100 s; leaves decay 10x faster too), restored in the finally.
  if (!record()) await scenes.build()
  const rec = record()
  try {
    rcon('gamerule randomTickSpeed 30')
    const files = await startBot('grow', fill([['oak_sapling', 6], ['birch_sapling', 4], ['stone_axe', 1]]), { pool: POOL })
    const grown = await waitFor(() => { const t = farmTruth(rec); return t.trees >= 6 ? t : null }, 600000, 10000)
    const before = bag(NAME)
    QUEUE = [{ skill: 'gather', args: { block: 'birch_log', count: 10 } }, { skill: 'gather', args: { block: 'oak_log', count: 10 } }]
    const harvested = await waitFor(() => QUEUE.length === 0 && rowsOf(files.skillLog).filter(r => r.name === 'gather').length >= 2, 400000, 2000)
    await sleep(3000)
    const afterHarvest = { truth: farmTruth(rec), leftovers: columnLogs(rec).filter(c => c.n > 0), ground: itemsOnGround(), bag: deltaOf(before.totals, bag(NAME).totals) }
    const gathers = rowsOf(files.skillLog).filter(r => r.name === 'gather').map(r => `${r.status} ${r.detail.slice(0, 160)}`)
    const t0 = Date.now()
    // THE LOOP CLOSES WHEN A HARVESTED PLOT IS REPLANTED (a clearing-only visit is not the end of it: run 3)
    const replant = await waitFor(() => tendRows(files).find(r => r.ts > t0 && r.status === 'success' && +field(r.detail, 'planted') > 0), 780000, 2000)
    await sleep(5000)
    const end = { truth: farmTruth(rec), leftovers: columnLogs(rec).filter(c => c.n > 0), off: offPlan(rec) }
    await stopBot()
    result({ scene: 'grow', grownAt: grown && { trees: grown.trees, saplings: grown.saplings }, gathers, afterHarvest, replant: replant && replant.detail,
      tends: tendRows(files).map(r => `${r.status} ${r.detail}`), end: { truth: end.truth, leftovers: end.leftovers, foreign: end.off.foreign, holes: end.off.holes } })
  } finally {
    rcon('gamerule randomTickSpeed 3')
  }
}

scenes.harvest = async () => {
  // HARVEST A/B: the SAME farm (the candidate's canonical layout, planted by RCON: 6 birch + 3 oak, 4 torches) grown at
  // rtick 30, then the ordinary `gather birch_log` / `gather oak_log`. Control = the baseline bot (no farm code); candidate
  // = this build with the farm record on disk (exclusions active) and no saplings (so its only farm work is clearing
  // leftover logs). Question: do the farm's exclusions make the fleet's own harvest worse?
  const arm = process.env.TF_ARM || 'cand'
  buildArena()
  const rec = TF.canonicalFarm({ home: HOME, read: arenaRead }).record
  POOL = `sbxfarm-${RUN}-harvest-${arm}-${Date.now() % 100000}`
  if (arm === 'cand') {
    fs.mkdirSync(poolDir(), { recursive: true })
    fs.writeFileSync(path.join(poolDir(), `treefarm-${HOME.x}_${HOME.y}_${HOME.z}.g1.json`), JSON.stringify({ ...rec, world: null, at: new Date().toISOString() }))
  }
  const files = await startBot(`harvest-${arm}`, fill([['stone_axe', 1]]), { pool: POOL })
  const plots = rec.cells.filter(c => c.role === 'plot'), torches = rec.cells.filter(c => c.role === 'torch')
  rcon(...plots.map((p, i) => `setblock ${p.x} ${p.y} ${p.z} minecraft:${i < 6 ? 'birch' : 'oak'}_sapling`), ...torches.map(t => `setblock ${t.x} ${t.y} ${t.z} minecraft:torch`))
  try {
    rcon('gamerule randomTickSpeed 30')
    const grown = await waitFor(() => { const t = farmTruth(rec); return t.trees >= 7 ? t : null }, 600000, 10000)
    rcon('gamerule randomTickSpeed 3')
    const logsBefore = columnLogs(rec).reduce((a, c) => a + c.n, 0) + farmTruth(rec).trees
    const before = bag(NAME), t0 = Date.now()
    QUEUE = [{ skill: 'gather', args: { block: 'birch_log', count: 10 } }, { skill: 'gather', args: { block: 'oak_log', count: 10 } }]
    await waitFor(() => QUEUE.length === 0 && rowsOf(files.skillLog).filter(r => r.name === 'gather' && r.ts >= t0).length >= 2, 420000, 2000)
    await sleep(3000)
    const d = deltaOf(before.totals, bag(NAME).totals)
    const t = farmTruth(rec), cl = columnLogs(rec)
    const leftover = t.plotStates.reduce((a, st, i) => a + (st === 'empty' ? cl[i].n : 0), 0)
    const off = offPlan(rec)
    await stopBot()
    result({ scene: 'harvest', arm, grownAt: grown && grown.trees, logsStanding: logsBefore, logsGathered: Object.entries(d).filter(([k]) => /_log$/.test(k)).reduce((a, [, v]) => a + v, 0),
      scaffoldUsed: -Object.entries(d).filter(([k]) => /^(andesite|diorite|granite|calcite)$/.test(k)).reduce((a, [, v]) => a + v, 0),
      gathers: rowsOf(files.skillLog).filter(r => r.name === 'gather' && r.ts >= t0).map(r => `${r.status} ${r.detail.slice(0, 120)}`),
      leftoverLogsInEmptyColumns: leftover, plotsAfter: t.plotStates, walkwayBlocks: off.foreign.length, ground: itemsOnGround(),
      farmRows: tendRows(files).map(r => `${r.status} ${r.detail.slice(0, 160)}`) })
  } finally {
    rcon('gamerule randomTickSpeed 3')
  }
}

scenes.bonemeal = async () => {
  // THE ARM, ON: TREEFARM_BONEMEAL=on. First visit plants; the next (after the 5-minute cooldown) bone meals saplings.
  buildArena()
  const files = await startBot('bonemeal', fill([['oak_sapling', 9], ['bone_meal', 12]]), { env: { TREEFARM_BONEMEAL: 'on' } })
  const before = bag(NAME)
  const bm = await waitFor(() => tendRows(files).find(r => +field(r.detail, 'bonemeal') > 0), 600000, 2000)
  await sleep(3000)
  const rec = record(), truth = rec ? farmTruth(rec) : null
  const after = bag(NAME)
  await stopBot()
  result({ scene: 'bonemeal', row: bm && bm.detail, used: (before.totals.bone_meal || 0) - (after.totals.bone_meal || 0), truth,
    rows: placeRows(files).filter(r => /bonemeal/.test(r.detail)).map(r => r.detail) })
}

;(async () => {
  TF = await import(process.env.TF_SRC || path.join(BOT_ROOT, 'bots/src/treefarm.mjs'))   // TF_SRC: the layout for a control arm
  if (!/There are 0 of/.test(r1('list'))) throw new Error(`${SERVER} is not empty`)
  await new Promise(r => brain.listen(11499, '127.0.0.1', r))
  for (const s of SCENES_S.split(',')) {
    P('=== scene', s)
    try { await scenes[s]() } catch (e) { P('scene failed', s, String(e?.stack || e)); result({ scene: s, error: String(e?.message || e) }); await stopBot() }
  }
  brain.close()
  process.exit(0)
})()
