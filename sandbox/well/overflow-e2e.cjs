// SANDBOX-ONLY end-to-end proof of cobbleoverflow-01 (OWNER 10-16 "yes, junk can take the extra"): below the town cobble cap
// (1000), the junk well takes whole surplus cobble stacks ONLY when no town container can take them, the bot keeps its 64,
// and unknown room sends nothing. Derived from stock-e2e.cjs (main): the arena, the built well, the server's truth. The REAL
// bot (src/index.mjs from <botRoot>, unmodified; trace.cjs only observes) runs its own deterministic town orders.
//
//   node sandbox/well/overflow-e2e.cjs <botRoot> <scene,scene,...> [server]
//   scenes: build (the well; every later scene uses it)  ovfull  ovroom  ovunknown
//
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. Sandbox servers and sandbox-* names
// only. Refuses to run unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `cobbleoverflow`.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node well-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.WELL_REPO || path.resolve(__dirname, '../..')
const NAME = 'sandbox-Ovfl', NAME2 = 'sandbox-Ovfl2', WALKER = 'sandbox-OWalk'
const OUT = process.env.WELL_OUT || `${R}/sandbox/log/overflow-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ovflab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const has = rep => { const m = /has (-?\d+) \[/.exec(rep || ''); return m ? Number(m[1]) : null }

// ---------------------------------------------------------------- the arena: a dirt slab, 7 deep, floating at y 113..119
const HOME = { x: 1315, y: 120, z: 1315 }
const A = { x0: 1297, x1: 1333, z0: 1297, z1: 1333 }
const G = 119
const arenaRead = (x, y, z) => {
  const inside = x >= A.x0 && x <= A.x1 && z >= A.z0 && z <= A.z1
  const name = inside && y >= 113 && y <= G ? 'dirt' : 'air'
  return { name, boundingBox: name === 'air' ? 'empty' : 'block', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]], hardness: name === 'air' ? 0 : 0.5, props: null }
}
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=40,dz=${A.z1 - A.z0}]`,
    `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
    `fill ${A.x0} 113 ${A.z0} ${A.x1} ${G} ${A.z1} minecraft:dirt`]
  const r = rcon(...c)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}

// ---------------------------------------------------------------- the server's truth
const parseItem = seg => {
  const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]
  if (!id) return null
  return { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) }
}
function bag (name) {
  const cmds = []; for (let s = 0; s < 36; s++) cmds.push(`data get entity ${name} Inventory[{Slot:${s}b}]`)
  const r = rcon(...cmds); const slots = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const totals = {}; for (const it of Object.values(slots)) totals[it.id] = (totals[it.id] || 0) + it.count
  return { used: Object.keys(slots).length, totals }
}
// item census with SMALL replies only (a multi-packet RCON reply desyncs sbx-rcon.py): scoreboard sums
const ARENA_SEL = `@e[type=item,x=${A.x0},y=105,z=${A.z0},dx=${A.x1 - A.x0},dy=30,dz=${A.z1 - A.z0}]`
const shaftSel = cap => `@e[type=item,x=${cap.x},y=${cap.y - 2},z=${cap.z},dx=0,dy=1.4,dz=0]`
function census (cap) {
  const sh = shaftSel(cap)
  const r = rcon('scoreboard objectives add wc dummy',
    `execute as ${ARENA_SEL} store result score @s wc run data get entity @s Item.count`,
    'scoreboard players set #in wc 0', 'scoreboard players set #all wc 0',
    `scoreboard players operation #in wc += ${sh} wc`, `scoreboard players operation #all wc += ${ARENA_SEL} wc`,
    'scoreboard players get #in wc', 'scoreboard players get #all wc', `execute if entity ${sh}`, `execute if entity ${ARENA_SEL}`)
  const cnt = rep => Number(/count: (\d+)/.exec(rep || '')?.[1] ?? 0)
  const inItems = has(r[6]?.reply), allItems = has(r[7]?.reply)
  return { inItems, allItems, outItems: allItems - inItems, inEnt: cnt(r[8]?.reply), allEnt: cnt(r[9]?.reply) }
}
function wellBlocks (cap, facing) {
  const r = rcon(`execute if block ${cap.x} ${cap.y} ${cap.z} #minecraft:wooden_trapdoors[half=top,open=false]`,
    `execute if block ${cap.x} ${cap.y} ${cap.z} #minecraft:wooden_trapdoors[half=top,open=false,facing=${facing}]`,
    `execute if block ${cap.x} ${cap.y - 1} ${cap.z} #minecraft:wooden_trapdoors[half=bottom]`,
    `execute if block ${cap.x} ${cap.y - 2} ${cap.z} minecraft:dirt`,
    `execute if block ${cap.x} ${cap.y} ${cap.z} #minecraft:wooden_trapdoors[open=true]`)
  return { capClosedTop: passed(r[0]?.reply), facingOk: passed(r[1]?.reply), floorTrapdoor: passed(r[2]?.reply), solidFloor: passed(r[3]?.reply), open: passed(r[4]?.reply) }
}

// ---------------------------------------------------------------- the bot and its logs
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

let BRAIN_WANDER = false, brainN = 0
const brainQueue = []
const WANDER = [{ x: 1322, y: 120, z: 1322 }, { x: 1324, y: 120, z: 1322 }]
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    // 'status' for ever trips the fleet's livelock breaker (repeat_loop rejections -> a 58-block relocation off the arena,
    // sandbox 10-05 r4); BRAIN_WANDER alternates two short walks on the arena, away from the well, instead.
    let decision = { skill: 'status', args: {} }
    // THE QUEUE (stock scenes): the next queued model verb, else idle
    const q = brainQueue.shift()
    if (q) { const [skill, item] = q.split(/\s+/); decision = { skill, args: item ? { item } : {} } }
    // the repeat-loop key buckets nearby gotos together (r5: two cells 2 apart read as 'identical 4x'): status and goto alternate
    else if (BRAIN_WANDER && brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot () {
  for (const [n, p] of Object.entries(procs)) { try { p.kill('SIGTERM') } catch {} delete procs[n] }
  bot = null
  await waitFor(() => !/sandbox-Ovfl/.test(r1('list')), 30000, 1000)
}
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const procs = {}
async function startBot (scene, slotsSpec, { pool = `sbxovfl-${RUN}`, name = NAME, early = false } = {}) {
  const tag = `${RUN}-${scene}-${name}`
  const logRel = `./sandbox/log/overflow-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/overflow-e2e/${tag}/skill-${name}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`; const trace = `${OUT}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.overflow-e2e-${name}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', name); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/overflow-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('STOCK_PRUNE_COOLDOWN_MS', 60000)   // the only harness setting beyond well-e2e's: a prune look every minute
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  const proc = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(R, 'sandbox/craft/trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (name === NAME) bot = proc
  procs[name] = proc
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  // THE CHUNKS FIRST: an order read before the arena's chunks reach the client sees 'unknown' and (correctly) skips.
  rcon(`gamemode survival ${name}`, `clear ${name}`, `tp ${name} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`)
  // early: the bag at once, before the first decision (cobblecap run 10: with an empty bag for 10 s the bot's first order was
  // withdraw_pick, which opened and counted the town chest before the scene's deposit could)
  if (early) { let s0 = 0; rcon(...slotsSpec.map(([id, n]) => `item replace entity ${name} container.${s0++} with minecraft:${id} ${n}`)) }
  await sleep(10000)
  const c = [`tp ${name} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`]
  let s = 0
  for (const [id, n] of slotsSpec) c.push(`item replace entity ${name} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(2500)
  return { skillLog, botOut, trace, name, pool, poolDir: path.join(R, 'sandbox/state', `_pool-${pool}`) }
}

// ---------------------------------------------------------------- the walker (bare mineflayer, this process)
let walker = null
async function walkerJoin () {
  if (walker) return walker
  const mineflayer = require(require.resolve('mineflayer', { paths: [path.join(BOT_ROOT, 'bots')] }))
  walker = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: WALKER, version: '1.21.8', auth: 'offline' })
  walker.on('error', e => P('walker error', String(e?.message)))
  await new Promise(r => walker.once('spawn', r)); await sleep(1500)
  rcon(`gamemode survival ${WALKER}`, `clear ${WALKER}`)
  return walker
}
async function walkerLeave () { if (walker) { try { walker.quit('done') } catch {} walker = null; await sleep(2000) } }
async function tpWalker (x, y, z) {
  rcon(`tp ${WALKER} ${x} ${y} ${z}`)
  const { Vec3 } = require(require.resolve('vec3', { paths: [path.join(BOT_ROOT, 'bots')] }))
  const t = new Vec3(x, y, z)
  for (let i = 0; i < 40; i++) { if (walker.entity.position.distanceTo(t) < 0.1) break; await sleep(100) }
  await sleep(300)
}
async function walkTo (x, z, { jump = false, timeout = 4000, tol = 0.25 } = {}) {
  const { Vec3 } = require(require.resolve('vec3', { paths: [path.join(BOT_ROOT, 'bots')] }))
  const end = Date.now() + timeout; let minY = walker.entity.position.y
  while (Date.now() < end) {
    const p = walker.entity.position; minY = Math.min(minY, p.y)
    if (Math.hypot(x - p.x, z - p.z) < tol) break
    await walker.lookAt(new Vec3(x, p.y + 1.62, z), true)
    walker.setControlState('forward', true); walker.setControlState('jump', jump)
    await sleep(50)
  }
  walker.clearControlStates(); await sleep(150)
  return Math.min(minY, walker.entity.position.y)
}

// ---------------------------------------------------------------- scenes
const LISTED = ['egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac', 'armadillo_scute', 'dead_bush', 'pointed_dripstone', 'rail']
const ROCKS = ['andesite', 'diorite', 'granite', 'calcite']
const fill = (spec, n = 36) => { const out = [...spec]; let i = 0; while (out.length < n) out.push([ROCKS[i++ % ROCKS.length], 64]); return out }
let W = null, CAP = null, FACING = null
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n'); P('RESULT', r) }
const deltaOf = (a, b) => Object.fromEntries(Object.keys({ ...a, ...b }).map(k => [k, (b[k] || 0) - (a[k] || 0)]).filter(([, d]) => d))

// Watch one order to its end; meanwhile sample the cap (open?) and whether any OTHER player is within 5 while it is open.
async function watchOrder (files, skill, ms = 240000) {
  const samples = []
  const t0 = Date.now()
  let ended = null
  while (Date.now() - t0 < ms) {
    const rows = rowsOf(files.skillLog)
    ended = lines(files.botOut).find(l => new RegExp(`skill ${skill} ->`).test(l))
    if (CAP) {
      const open = passed(r1(`execute if block ${CAP.x} ${CAP.y} ${CAP.z} #minecraft:wooden_trapdoors[open=true]`))
      const walkerNear = walker ? walker.entity.position.distanceTo({ x: CAP.x + 0.5, y: CAP.y + 1, z: CAP.z + 0.5 }) <= 5 : false
      samples.push({ t: Date.now() - t0, open, walkerNear })
    }
    if (ended) break
    await sleep(400)
    void rows
  }
  return { ended, samples, rows: rowsOf(files.skillLog).filter(r => /well/.test(r.name)) }
}

const scenes = {}
scenes.build = async () => {
  // A FULL bag (36/36): 3 oak_log, two egg stacks and a flint stack, rocks -- the pit-first path: dig, throw junk down
  // the open pit to make the craft's room, planks -> table -> 2 trapdoors, floor trapdoor, cap.
  buildArena()
  const bagSpec = fill([['oak_log', 3], ['egg', 16], ['egg', 16], ['flint', 64]])
  const files = await startBot('build', bagSpec)
  const before = bag(NAME)
  const w = await watchOrder(files, 'build_well', 240000)
  await sleep(4000)
  const after = bag(NAME)
  const built = w.rows.find(r => r.name === '_well_built')
  const at = /at=(-?\d+),(-?\d+),(-?\d+)/.exec(built?.detail || '')
  if (at) { CAP = { x: +at[1], y: +at[2], z: +at[3] }; FACING = /facing=(\w+)/.exec(built.detail)[1] }
  const blocks = CAP ? wellBlocks(CAP, FACING) : null
  const cs = CAP ? census(CAP) : null
  await stopBot()
  result({ scene: 'build', canonical: W.canonicalWellSite({ home: HOME, read: arenaRead }).site, cap: CAP, facing: FACING, ended: w.ended?.slice(0, 300), blocks, census: cs,
    bag: { before: before.used, after: after.used, delta: deltaOf(before.totals, after.totals) }, openSamples: w.samples.filter(s => s.open).length,
    rows: w.rows.map(r => `${r.name} ${r.status} ${r.detail.slice(0, 220)}`) })
}

// ---------------------------------------------------------------- STOCK TARGET scenes (stocktarget-01)
// The town chest: 4 from home, never within 5 of the well's cap. Its contents are set and read by RCON (the server's word).
let CHEST = null
function pickChest () {
  for (const [dx, dz] of [[4, -4], [-4, -4], [-4, 4], [4, 4], [6, 0], [0, 6], [-6, 0], [0, -6]]) {
    const c = { x: HOME.x + dx, y: HOME.y, z: HOME.z + dz }
    if (!CAP || Math.hypot(c.x - CAP.x, c.z - CAP.z) >= 5) return c
  }
  throw new Error('no chest cell')
}
function setChest (stacks, at = CHEST) {
  const c = [`setblock ${at.x} ${at.y} ${at.z} minecraft:air`, `setblock ${at.x} ${at.y} ${at.z} minecraft:chest[facing=north]`]
  stacks.forEach(([id, n], i) => c.push(`item replace block ${at.x} ${at.y} ${at.z} container.${i} with minecraft:${id} ${n}`))
  const bad = rcon(...c).filter(x => /Unknown|Incorrect|Cannot|not loaded/i.test(x.reply))
  if (bad.length) throw new Error('chest: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
function chestTotals (at = CHEST) {
  const cmds = []; for (let s = 0; s < 27; s++) cmds.push(`data get block ${at.x} ${at.y} ${at.z} Items[{Slot:${s}b}]`)
  const r = rcon(...cmds); const t = {}; let used = 0
  for (let s = 0; s < 27; s++) { const it = /has the following block data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) { used++; t[it.id] = (t[it.id] || 0) + it.count } }
  return { used, totals: t }
}
function chestCount () {
  // chests standing near home (a new one would be the recovery's): one small `execute if block` per cell, read-only
  const cells = []
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) cells.push([HOME.x + dx, HOME.z + dz])
  const r = rcon(...cells.map(([x, z]) => `execute if block ${x} 120 ${z} minecraft:chest`))
  return r.filter(x => passed(x.reply)).length
}
const journalOf = files => { try { return fs.readdirSync(files.poolDir).filter(f => /\.cobble\./.test(f)).flatMap(f => /\.jsonl$/.test(f) ? lines(path.join(files.poolDir, f)).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []) } catch { return [] } }
const stockRows = files => rowsOf(files.skillLog).filter(r => /stock|town_deposit|_cobble|well_dispose|deposit_new_chest|prune/.test(r.name)).map(r => `${r.name} ${r.status} ${r.detail.slice(0, 240)}`)
const TORCH = n => Array.from({ length: n }, () => ['torch', 64])
async function waitRow (files, re, ms) { return waitFor(() => rowsOf(files.skillLog).find(r => re.test(r.name)), ms, 500) }

// ---------------------------------------------------------------- cobbleoverflow-01 scenes
// Every scene: the well built by `build`; the town's containers set by RCON and never counted before the bot joins; a FULL
// bag (36/36): cobble 64 + 64 + 30 (158: the 30 and one 64 are surplus above the bot's 64), a stone pickaxe, a crafting
// table, a furnace (so the tech ladder wants no cobble) and 30 torch stacks. The town holds no cobble: far below its 1000.
// The bot's own deterministic town orders run (town deposit at a full bag, then the well); the model idles.
// Read from the WORLD: the server's bag and chests (RCON), the items lying in the well's shaft (census), and the journal's
// count record of each chest (what the build wrote: its room `r`).
const OV_BAG = [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 30], ['stone_pickaxe', 1], ['crafting_table', 1], ['furnace', 1], ...TORCH(30)]
const cobOf = t => (t?.cobblestone ?? 0) + (t?.cobbled_deepslate ?? 0)
const keyOf = c => `${c.x},${c.y},${c.z}`
const roomRec = (files, at) => journalOf(files).filter(r => r.t === 'cnt' && r.k === keyOf(at) && r.r).map(r => r.r).pop() ?? null
const modeRows = files => rowsOf(files.skillLog).filter(r => r.name === '_cobbleoverflow_mode').map(r => r.detail)
const throwRows = files => rowsOf(files.skillLog).filter(r => r.name === '_cobble_overflow' && /^phase=throw /.test(r.detail)).map(r => r.detail)
const dumpRows = files => rowsOf(files.skillLog).filter(r => /town_deposit|_cobble|well_dispose|_well_refused|deposit_new_chest|_stock_refused/.test(r.name)).map(r => `${r.name} ${r.status} ${r.detail.slice(0, 220)}`)
const SECOND = () => { for (const [dx, dz] of [[-4, 4], [4, 4], [-6, 0], [0, 6]]) { const c = { x: HOME.x + dx, y: HOME.y, z: HOME.z + dz }; if (keyOf(c) !== keyOf(CHEST) && Math.hypot(c.x - CAP.x, c.z - CAP.z) >= 5) return c } throw new Error('no second chest cell') }
async function ovScene (scene, setup, { waitMs = 300000, until = null, post = 6000, wander = false } = {}) {
  // wander: two short walks near home instead of an idle 'status' (run 1: an idle bot's livelock breaker relocated it 29
  // blocks off the town square, spending 10 cobble on its bridge -- not the change, but it left town mid-scene)
  BRAIN_WANDER = wander
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  const extra = setup()
  const files = await startBot(scene, OV_BAG, { pool: `sbxovfl-${RUN}-${scene}`, early: true })
  const b0 = bag(NAME), c0 = chestTotals(), s0 = census(CAP)
  const t0 = Date.now()
  // until the scene's own end condition, or the wait; then a settle for the throws and the rows
  const hit = await waitFor(() => (until ? until(files) : null), waitMs, 1000)
  await sleep(post)
  const b1 = bag(NAME), c1 = chestTotals(), s1 = census(CAP)
  brainQueue.length = 0; BRAIN_WANDER = false
  const out = { scene, hit: !!hit, secs: Math.round((Date.now() - t0) / 1000), bag: { before: cobOf(b0.totals), after: cobOf(b1.totals), slotsBefore: b0.used, slotsAfter: b1.used },
    chest: { before: c0.totals, after: c1.totals, usedBefore: c0.used, usedAfter: c1.used }, shaft: { before: s0.inItems, after: s1.inItems }, arenaItemsAfter: s1.allItems,
    room: roomRec(files, CHEST), licence: modeRows(files), clicks: throwRows(files), rows: dumpRows(files), extra: extra?.read ? extra.read(files) : null }
  await stopBot()
  return out
}

// A  EVERY TOWN CONTAINER FULL, the town far below its cap: the town deposit opens the chest (the count carries room 0/0) and
//    fails town_storage_full; the well then takes the surplus -- the 30 and one 64 -- and the bot keeps exactly 64.
scenes.ovfull = async () => {
  const r = await ovScene('ovfull', () => { setChest(Array.from({ length: 27 }, () => ['dirt', 64])) },
    { until: files => rowsOf(files.skillLog).find(x => x.name === '_well_dispose' && / overflow=\d+/.test(x.detail)) })
  const disp = r.rows.filter(x => x.startsWith('_well_dispose'))
  const pass = r.bag.before === 158 && r.bag.after === 64 && r.shaft.after - r.shaft.before === 94 && cobOf(r.chest.after) === 0 && r.chest.usedAfter === 27
    && !!r.room && r.room.cobblestone === 0 && disp.some(d => / cobble=94 /.test(d) && / cap=below /.test(d) && / overflow=94/.test(d)) && r.licence.length === 1
    && r.clicks.length === 2 && r.clicks.every(d => / cap=below mode=overflow known=1 /.test(d) && / max=0\/0$/.test(d))
  result({ ...r, PASS: pass })
}

// B  ROOM IN TOWN (the chest has 10 free slots): the bank takes cobble (whole surplus stacks, below the cap), the count shows
//    room for whole stacks, and the well takes NO cobble -- nothing reaches the shaft, the bot's cobble only goes to the chest.
scenes.ovroom = async () => {
  // the model's verb is `deposit` too (the town deposit's own plan may bank the torches first); after the first cobble bank
  // the scene waits 90 s more -- the well order would act in that time if it were going to
  const r = await ovScene('ovroom', () => { setChest(Array.from({ length: 17 }, () => ['dirt', 64])); brainQueue.push('deposit', 'deposit') },
    { waitMs: 240000, post: 90000, until: files => rowsOf(files.skillLog).find(x => x.name === '_cobble_bank' && / moved=[1-9]/.test(x.detail)) })
  const pass = r.bag.after >= 64 && r.bag.after < r.bag.before && cobOf(r.chest.after) === r.bag.before - r.bag.after && r.shaft.after === r.shaft.before
    && !!r.room && r.room.cobblestone >= 64 && !r.rows.some(x => /^_well_dispose .* overflow=/.test(x)) && r.clicks.length === 0 && r.licence.length === 1
  result({ ...r, PASS: pass })
}

// C  UNKNOWN ROOM: the first chest full, a SECOND town chest under a bedrock lid (it cannot be opened, so it is never
//    counted). The room of the town is unknown -> nothing goes down the well; the bag keeps all 158 for the whole wait.
scenes.ovunknown = async () => {
  let B = null
  const r = await ovScene('ovunknown', () => {
    setChest(Array.from({ length: 27 }, () => ['dirt', 64]))
    B = SECOND()
    setChest(Array.from({ length: 27 }, () => ['dirt', 64]), B)
    const bad = rcon(`setblock ${B.x} ${B.y + 1} ${B.z} minecraft:bedrock`).filter(x => /Unknown|Incorrect|Cannot|not loaded/i.test(x.reply))
    if (bad.length) throw new Error('lid: ' + bad.map(x => x.reply).join('; '))
    return { read: files => ({ second: keyOf(B), secondCounted: journalOf(files).some(x => x.t === 'cnt' && x.k === keyOf(B)) }) }
  }, { waitMs: 240000, until: () => null, wander: true })
  const pass = r.bag.before === 158 && r.bag.after === 158 && r.shaft.after === r.shaft.before && !r.rows.some(x => /^_well_dispose .* overflow=/.test(x))
    && r.clicks.length === 0 && r.extra && r.extra.secondCounted === false && r.licence.length === 1
  result({ ...r, PASS: pass })
}

async function main () {
  const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
  if (!/cobbleoverflow/.test(lock)) throw new Error('the sandbox lock is not held for cobbleoverflow: ' + lock.trim().slice(0, 160))
  W = await import(path.join(BOT_ROOT, 'bots/src/well.mjs'))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} sha=${(() => { try { return fs.readFileSync(path.join(BOT_ROOT, '.sha'), 'utf8').trim() } catch { return 'unknown' } })()} server=${SERVER} scenes=${SCENES_S}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  for (const s of SCENES_S.split(',')) { P('=== scene', s); await scenes[s]() }
}
async function cleanup () {
  await stopBot().catch(() => {}); await walkerLeave().catch(() => {})
  try { brain.close() } catch {}
  for (const n of [NAME, NAME2]) { try { fs.unlinkSync(`${R}/sandbox/.env.overflow-e2e-${n}`) } catch {} }
  try {
    P('cleanup', rcon('difficulty peaceful', `kill ${ARENA_SEL}`, 'kill @e[type=creeper,tag=wellspawn]', 'scoreboard objectives remove wc',
      `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
      `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'difficulty', 'list').map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`))
  } catch (e) { P('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
