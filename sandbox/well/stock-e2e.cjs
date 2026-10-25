// SANDBOX-ONLY end-to-end proof of STOCK TARGETS + CHEST PRUNING (stocktarget-01; design
// docs/reports/stocktargets-design-2026-10-08.md), derived from well-e2e.cjs (the junk well's own driver: the arena, the
// built well, the server's truth). The REAL bot (src/index.mjs from <botRoot>, unmodified; trace.cjs only observes)
// runs its own deterministic town orders; a queue in the loopback brain can hand it a model verb (`deposit`).
//
//   node sandbox/well/stock-e2e.cjs <botRoot> <scene,scene,...> [server]
//   scenes: build (the well; every later scene uses it)  stockdispose  stockbank  stockprune  stockprunekeep  stocknochest  stockrace  stockrefuse  stockrecount  cobblecap
//           lidrecount lidrecountpick (lidclear-01: no well needed; LOCK_OWNER=lidclear)
//           liddirt lidleaves lidglass (cobblekeep-01: a DIRT lid is dug, a LEAVES lid is no lid; no well needed; LOCK_OWNER=cobblekeep)
//           ironbank (cobblekeep-01: 3 ingots stay, raw iron and coal bank; no well needed)
//           cobbleband (cobblekeep-01: a town at 984 of the 1000 cap, a full bag of cobble -> the well takes it; after `build`)
//           townsearch townsearch2 (townsearch-01: the far chest; no well needed; LOCK_OWNER=townsearch)
//           kitsearch smeltcoal (toolkit-03: the far chest of iron / of coal; no well needed; LOCK_OWNER=kitsearch)
//           ironpick ironpickkeep ironpickfull (ironpick-01: the kit's iron pickaxe; no well needed; LOCK_OWNER=ironpick)
//           townindex (townindex-01: the index the bot's own orders write, read back against the server; no well; LOCK_OWNER=townindex)
//           junkbank junkcompost (junkout-01: a fresh arena, no well) build junkwell junkwelloff (junkout-01: after `build`;
//           NATURAL_BUILD=1 builds a natural well with PLINTH_FIRST=0 for the build bot only); LOCK_OWNER=junkout
//
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. Sandbox servers and sandbox-* names
// only. Refuses to run unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `stocktarget`.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const sbx = require('../lib/sbxlock.cjs')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node well-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.WELL_REPO || path.resolve(__dirname, '../..')
const NAME = 'sandbox-Stock', NAME2 = 'sandbox-Stock2', WALKER = 'sandbox-SWalk'
const OUT = process.env.WELL_OUT || `${R}/sandbox/log/stock-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-stockab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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
async function waitFor (pred, ms, step = 250, stop = null) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; if (stop && stop()) return null; await sleep(step) } return null }

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
  await waitFor(() => !/sandbox-Stock/.test(r1('list')), 30000, 1000)
}
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const procs = {}
async function startBot (scene, slotsSpec, { pool = `sbxstock-${RUN}`, name = NAME, early = false, env: extraEnv = {} } = {}) {
  const tag = `${RUN}-${scene}-${name}`
  const logRel = `./sandbox/log/stock-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/stock-e2e/${tag}/skill-${name}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`; const trace = `${OUT}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.stock-e2e-${name}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', name); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/stock-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('STOCK_PRUNE_COOLDOWN_MS', 60000)   // the only harness setting beyond well-e2e's: a prune look every minute
  for (const [k, v] of Object.entries(extraEnv)) set(k, v)   // a scene's own setting (junkout-01: the switches; PLINTH_FIRST=0 for `build`)
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
  // NATURAL_BUILD=1 (bagbudget-01 Paper r2): a NATURAL well, which plinth-first (the fleet default) declines -- PLINTH_FIRST=0
  // for THIS bot only; every other scene runs the default
  const files = await startBot('build', bagSpec, process.env.NATURAL_BUILD === '1' ? { env: { PLINTH_FIRST: '0' } } : {})
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

scenes.dispose = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`)
  const listed = LISTED.slice(0, 11).map(id => [id, ['egg', 'brown_egg', 'blue_egg'].includes(id) ? 16 : 64])
  const other = [['cobblestone', 64], ['oak_sapling', 20], ['bread', 8], ['stone_pickaxe', 1], ['leaf_litter', 30], ['oak_log', 5], ['iron_ingot', 3]]
  const bagSpec = fill([...listed, ...other])
  const files = await startBot('dispose', bagSpec)
  const before = bag(NAME)
  const w = await watchOrder(files, 'dispose_well', 200000)
  await sleep(1500)
  const c1 = census(CAP)
  await sleep(30000)            // C5: anything left on the surface at +30 s?
  const c30 = census(CAP)
  const after = bag(NAME)
  const d = deltaOf(before.totals, after.totals)
  const nonListedLost = Object.entries(d).filter(([k, v]) => v < 0 && !LISTED.includes(k))
  const tr = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  await stopBot()
  result({ scene: 'dispose', ended: w.ended?.slice(0, 300), bag: { before: before.used, after: after.used, delta: d }, nonListedLost, census: c1, censusAt30s: c30,
    blocks: wellBlocks(CAP, FACING), openSamples: w.samples.filter(s => s.open).length, throwClicks: tr.filter(e => e.pkt === 'click' && e.mode === 4).length,
    otherClicks: tr.filter(e => e.pkt === 'click' && e.mode !== 4).map(e => `${e.slot}/${e.mode}/${e.btn}`), rows: w.rows.map(r => `${r.name} ${r.status} ${r.detail.slice(0, 260)}`) })
}

scenes.isolation = async () => {
  if (!CAP) throw new Error('no well')
  await walkerJoin()
  rcon(`clear ${WALKER}`, `execute as ${shaftSel(CAP)} run data modify entity @s Age set value 0s`)
  const cx = CAP.x + 0.5, cz = CAP.z + 0.5
  // POSITIVE CONTROL: an egg on open ground, 6 blocks off, PickupDelay 0 -- the walker must collect it
  rcon(`summon item ${cx + 6} ${G + 1} ${cz} {Item:{id:"minecraft:egg",count:1},PickupDelay:0s,Tags:["wellctl"]}`)
  await tpWalker(cx + 8, G + 1, cz); await walkTo(cx + 6, cz, { timeout: 5000 }); await sleep(1500)
  const ctl = bag(WALKER)
  const c0 = census(CAP)
  let minY = 999
  for (let i = 0; i < 60; i++) {
    const dir = i % 2 ? 1 : -1
    if (i % 3 === 0) { await walkTo(cx - 1.6 * dir, cz, { timeout: 3000 }); minY = Math.min(minY, await walkTo(cx + 1.6 * dir, cz, { jump: i % 4 === 0, timeout: 3000 })) }
    else if (i % 3 === 1) { await walkTo(cx, cz - 1.6 * dir, { timeout: 3000 }); minY = Math.min(minY, await walkTo(cx, cz + 1.6 * dir, { jump: i % 5 === 0, timeout: 3000 })) }
    else { await walkTo(cx - 1.2 * dir, cz - 1.2 * dir, { timeout: 3000 }); minY = Math.min(minY, await walkTo(cx + 1.2 * dir, cz + 1.2 * dir, { timeout: 3000 })) }
  }
  await walkTo(cx, cz, { timeout: 3000, tol: 0.15 })
  for (let j = 0; j < 20; j++) { if (j % 4 === 0) { walker.setControlState('jump', true); await sleep(300); walker.setControlState('jump', false); await sleep(700) } else await sleep(1000) }
  const onCap = walker.entity.position.y
  for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) { await walkTo(cx + dx, cz + dz, { timeout: 3000, tol: 0.15 }); await sleep(2500) }
  const c1 = census(CAP); const wb = bag(WALKER)
  await tpWalker(cx + 12, G + 1, cz + 12)
  result({ scene: 'isolation', control: ctl.totals, wellBefore: c0, wellAfter: c1, walkerBag: wb.totals, passes: 60, minY, feetOnCap: onCap })
}

scenes.admission = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  BRAIN_WANDER = true
  await walkerJoin()
  rcon(`kill ${ARENA_SEL}`, `clear ${WALKER}`)
  const st = { x: CAP.x + 0.5 + 2.5 * (FACING === 'east' || FACING === 'west' ? 0 : 1), z: CAP.z + 0.5 + 2.5 * (FACING === 'east' || FACING === 'west' ? 1 : 0) }
  await tpWalker(st.x, G + 1, st.z)
  const bagSpec = fill([['egg', 16], ['flint', 64], ['clay_ball', 64], ['cobblestone', 64]])
  const files = await startBot('admission', bagSpec)
  // the refusal: wait for a _well_refused player_near row, the walker parked 2.5 off the rim the whole time
  const t0 = Date.now(); const samples = []
  let refusal = null
  while (Date.now() - t0 < 120000 && !refusal) {
    samples.push(passed(r1(`execute if block ${CAP.x} ${CAP.y} ${CAP.z} #minecraft:wooden_trapdoors[open=true]`)))
    refusal = rowsOf(files.skillLog).find(r => r.name === '_well_refused' && /player_near/.test(r.detail))
    await sleep(500)
  }
  const bagAtRefusal = bag(NAME)
  // the chain: the walker leaves; the next order (after the 3-minute cooldown) must dispose
  await walkerLeave()
  const t1 = Date.now()
  const success = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_well_dispose' && r.status === 'success'), 300000, 2000)
  const after = bag(NAME)
  await stopBot()
  result({ scene: 'admission', refusal: refusal && refusal.detail.slice(0, 200), openWhileWalkerNear: samples.filter(Boolean).length, samples: samples.length,
    bagAtRefusal: bagAtRefusal.totals, chainSuccessAfterS: success ? Math.round((success.ts - t1) / 1000) : null, chainRow: success?.detail.slice(0, 240), bagAfter: after.totals })
}

scenes.creeper = async () => {
  // THE CLEARANCE, measured by the game: a monster spawner as each shaft's floor block, SpawnRange 0, custom spawn
  // rules (no light check): vanilla BaseSpawner tries x+0.5, y-1..y+1, z+0.5 and skips any position whose creeper box
  // (0.6 x 1.7) collides -- the shaft cell is the only open one. CONTROL: an RCON-built copy of the well with NO floor
  // trapdoor (clear height 1.8125: a creeper fits). The bot's well keeps its floor trapdoor (clear 1.625).
  if (!CAP) throw new Error('no well')
  await walkerJoin()
  const ctl = { x: CAP.x + (FACING === 'east' || FACING === 'west' ? 0 : 6), y: CAP.y, z: CAP.z + (FACING === 'east' || FACING === 'west' ? 6 : 0) }
  const sp = `{SpawnRange:0s,SpawnCount:2s,Delay:0s,MinSpawnDelay:10s,MaxSpawnDelay:20s,RequiredPlayerRange:32s,MaxNearbyEntities:6s,SpawnData:{entity:{id:"minecraft:creeper",NoAI:1b,PersistenceRequired:1b,Tags:["wellspawn"]},custom_spawn_rules:{block_light_limit:[0,15],sky_light_limit:[0,15]}}}`
  const setup = rcon(
    `setblock ${ctl.x} ${ctl.y - 1} ${ctl.z} minecraft:air`, `setblock ${ctl.x} ${ctl.y} ${ctl.z} minecraft:oak_trapdoor[half=top,open=false,facing=north]`,
    `setblock ${CAP.x} ${CAP.y - 2} ${CAP.z} minecraft:spawner${sp}`, `setblock ${ctl.x} ${ctl.y - 2} ${ctl.z} minecraft:spawner${sp}`,
    `execute if block ${CAP.x} ${CAP.y - 1} ${CAP.z} #minecraft:wooden_trapdoors[half=bottom]`, `execute if block ${ctl.x} ${ctl.y - 1} ${ctl.z} minecraft:air`)
  await tpWalker(CAP.x + 0.5 + 3, G + 1, CAP.z + 0.5 + 3)
  rcon('difficulty easy')
  await sleep(45000)
  const q = rcon(`execute if entity @e[type=creeper,tag=wellspawn,x=${CAP.x},y=${CAP.y - 1},z=${CAP.z},dx=0,dy=0,dz=0]`,
    `execute if entity @e[type=creeper,tag=wellspawn,x=${ctl.x},y=${ctl.y - 1},z=${ctl.z},dx=0,dy=0,dz=0]`,
    'execute if entity @e[type=creeper,tag=wellspawn]')
  const cleanup = rcon('difficulty peaceful', 'kill @e[type=creeper,tag=wellspawn]', `setblock ${CAP.x} ${CAP.y - 2} ${CAP.z} minecraft:dirt`, `setblock ${ctl.x} ${ctl.y - 2} ${ctl.z} minecraft:dirt`,
    `setblock ${ctl.x} ${ctl.y} ${ctl.z} minecraft:dirt`, `setblock ${ctl.x} ${ctl.y - 1} ${ctl.z} minecraft:dirt`, 'difficulty')
  const n = rep => Number(/count: (\d+)/.exec(rep || '')?.[1] ?? 0)
  result({ scene: 'creeper', setup: setup.map(x => x.reply.slice(0, 80)), wellCreepers: n(q[0]?.reply), controlCreepers: n(q[1]?.reply), allTagged: n(q[2]?.reply), cleanup: cleanup.map(x => x.reply.slice(0, 60)) })
}

// ESCAPE FROM INSIDE (Claude review P2-1): the bot is put in the shaft of the OPEN well (as a fall through an open cap
// would leave it). It must never close the cap over itself, and must get itself out (its own column exempt from its own
// exclusions). The brain wanders (status/goto) so it has somewhere to go. Samples: cap state and the bot's feet.
scenes.escape = async () => {
  if (!CAP) throw new Error('no well')
  BRAIN_WANDER = true
  rcon(`kill ${ARENA_SEL}`)
  const files = await startBot('escape', fill([['egg', 16], ['cobblestone', 64]], 20))
  rcon(`setblock ${CAP.x} ${CAP.y} ${CAP.z} minecraft:oak_trapdoor[half=top,open=true,facing=${FACING}]`, `tp ${NAME} ${CAP.x + 0.5} ${CAP.y - 1 + 0.2} ${CAP.z + 0.5}`)
  const t0 = Date.now(); const samples = []
  let out = null
  while (Date.now() - t0 < 300000) {
    const r = rcon(`data get entity ${NAME} Pos`, `execute if block ${CAP.x} ${CAP.y} ${CAP.z} #minecraft:wooden_trapdoors[open=true]`)
    const m = /\[([-\d.]+)d, ([-\d.]+)d, ([-\d.]+)d\]/.exec(r[0]?.reply || '')
    const pos = m ? { x: +m[1], y: +m[2], z: +m[3] } : null
    const inside = pos && Math.floor(pos.x) === CAP.x && Math.floor(pos.z) === CAP.z && pos.y < CAP.y + 0.75
    samples.push({ t: Date.now() - t0, inside, open: passed(r[1]?.reply), pos })
    if (pos && !inside && samples.some(x => x.inside)) { out = { afterS: Math.round((Date.now() - t0) / 1000), pos }; break }
    await sleep(1000)
  }
  await sleep(2000)
  const rows = rowsOf(files.skillLog).filter(r => /well|marooned|escape|surface|pillar/.test(r.name))
  const closedOverSelf = samples.some((x, i) => i && x.inside && samples[i - 1].open && !x.open)
  const cap = wellBlocks(CAP, FACING)
  await stopBot(); BRAIN_WANDER = false
  result({ scene: 'escape', out, closedOverSelf, insideSamples: samples.filter(x => x.inside).length, openWhileInside: samples.filter(x => x.inside && x.open).length,
    capNow: cap, rows: rows.map(r => `${r.name} ${r.status} ${r.detail.slice(0, 160)}`).slice(0, 30) })
}

// ADMISSION RACE (Claude review P2-8): a second player arrives 0 / 1.5 / 2.5 s after the dispose order starts -- during the
// walk, the hold, or the resync. The cap must never be open while that player is within 5. A fresh bot per trial.
scenes.race = async () => {
  if (!CAP) throw new Error('no well')
  await walkerJoin()
  const trials = []
  for (const delay of [0, 1500, 2500]) {
    rcon(`kill ${ARENA_SEL}`, `clear ${WALKER}`, `setblock ${CAP.x} ${CAP.y} ${CAP.z} minecraft:oak_trapdoor[half=top,open=false,facing=${FACING}]`)
    await tpWalker(CAP.x + 12.5, G + 1, CAP.z + 12.5)
    const files = await startBot(`race${delay}`, fill([['egg', 16], ['flint', 64], ['clay_ball', 64], ['cobblestone', 64]]))
    const order = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_work_order' && /dispose_well/.test(r.detail)), 120000, 100)
    const t0 = Date.now()
    if (order) { if (delay) await sleep(delay); rcon(`tp ${WALKER} ${CAP.x + 0.5 + 2.5} ${G + 1} ${CAP.z + 0.5}`) }
    const tArrive = Date.now() - t0
    const samples = []
    for (const tEnd = Date.now() + 20000; Date.now() < tEnd;) {
      samples.push(passed(r1(`execute if block ${CAP.x} ${CAP.y} ${CAP.z} #minecraft:wooden_trapdoors[open=true]`)))
      await sleep(200)
    }
    const rows = rowsOf(files.skillLog).filter(r => /^_well_(refused|dispose)$|^dispose_well$/.test(r.name))
    const tr = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    await stopBot()
    trials.push({ delay, ordered: !!order, arrivedAfterMs: tArrive, openSamplesWhileNear: samples.filter(Boolean).length, samples: samples.length,
      resyncs: tr.filter(e => e.pkt === 'click' && e.slot === -999).length, throws: tr.filter(e => e.pkt === 'click' && e.mode === 4).length,
      rows: rows.map(r => `${r.name} ${r.status} ${r.detail.slice(0, 150)}`) })
  }
  result({ scene: 'race', trials })
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

// AT TARGET -> THE WELL: a town chest of 640 oak logs (over the 64 target); a 36-slot bag of oak 3x64, dirt 2x64, iron,
// saplings, a pickaxe and torches. Expected: the town deposit's COUNT step counts the chest (unknown -> 640), then the well
// order throws oak and dirt above the keeps (wood 64 units; dirt 16; 64 pillar blocks) -- never the iron, saplings,
// pickaxe or torches; the chest is unchanged; nothing on the ground.
scenes.stockdispose = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`); CHEST = pickChest()
  setChest(Array.from({ length: 10 }, () => ['oak_log', 64]))
  const spec = [['oak_log', 64], ['oak_log', 64], ['oak_log', 64], ['dirt', 64], ['dirt', 64], ['iron_ingot', 3], ['oak_sapling', 10], ['stone_pickaxe', 1], ...TORCH(28)]
  const files = await startBot('stockdispose', spec, { pool: `sbxstock-${RUN}-d` })
  const before = bag(NAME), chest0 = chestTotals()
  const counted = await waitRow(files, /^_cobble_reconcile$/, 150000)
  const w = await watchOrder(files, 'dispose_well', 200000)
  await sleep(1500)
  const c1 = census(CAP); await sleep(20000); const c20 = census(CAP)
  const after = bag(NAME), chest1 = chestTotals()
  await stopBot()
  result({ scene: 'stockdispose', counted: counted?.detail ?? null, ended: w.ended?.slice(0, 200), bag: { before: before.totals, after: after.totals, delta: deltaOf(before.totals, after.totals) },
    chest: { before: chest0.totals, after: chest1.totals }, census: c1, censusAt20s: c20, rows: stockRows(files) })
}

// COBBLEKEEP-01, THE BAND: the town's only chest holds 984 cobblestone (15 x 64 + 24: 16 short of the 1000 cap); a 36-slot
// bag of cobblestone, 30 + 35 x 64. No whole stack of the bag can be banked (984 + 30 > 1000), so the town deposit refuses
// it at the cap. BASE: the well's switch reads the 1 h floor (984 < 1000) and says `below` -- no dispose order, the bag stays
// full. CANDIDATE: the switch takes the stack the bank refused -> dispose_well throws whole cobble stacks (the 30 first), the
// bag keeps >= 64, the chest is unchanged. Read back: the server's bag, the chest (RCON data get), the shaft census.
scenes.cobbleband = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`); CHEST = pickChest()
  // THE CHEST COMES AFTER THE BAG (runs 1-2: the bot spawns with an empty bag before the scene's items are set, and its
  // withdraw_pick took 3 cobble from the chest -- a withdraw hold on cobble, which rightly keeps the well off it for 10 min)
  rcon(`setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} minecraft:air`)
  const spec = [['cobblestone', 30], ...Array.from({ length: 34 }, () => ['cobblestone', 64]), ['stone_pickaxe', 1]]
  const files = await startBot('cobbleband', spec, { pool: `sbxstock-${RUN}-band` })
  setChest([...Array.from({ length: 15 }, () => ['cobblestone', 64]), ['cobblestone', 24]])
  const before = bag(NAME), chest0 = chestTotals()
  const w = await watchOrder(files, 'dispose_well', 240000)
  await sleep(1500)
  const c1 = census(CAP)
  const after = bag(NAME), chest1 = chestTotals()
  const refused = rowsOf(files.skillLog).filter(r => r.name === '_stock_refused').map(r => r.detail.slice(0, 160))
  const disp = rowsOf(files.skillLog).filter(r => r.name === '_well_dispose').map(r => r.detail.slice(0, 260))
  const keepLicence = rowsOf(files.skillLog).filter(r => r.name === '_cobblekeep_mode').length
  await stopBot()
  const lost = (before.totals.cobblestone ?? 0) - (after.totals.cobblestone ?? 0)
  result({ scene: 'cobbleband', root: BOT_ROOT, ended: w.ended?.slice(0, 200) ?? null, bag: { before: before.totals, after: after.totals, used: [before.used, after.used] },
    chest: { before: chest0.totals, after: chest1.totals }, census: c1, refused: refused.slice(0, 4), dispose: disp, keepLicence, rows: stockRows(files).slice(0, 30),
    // the bag may also spend a few blocks as scaffold (run 1: a livelock relocation bridged off the slab), so the throw is read
    // from the SHAFT (census) and the order, not from the bag's loss alone
    CANDIDATE_PASS: !!(w.ended && /-> success/.test(w.ended) && (c1?.inItems ?? 0) >= 30 && lost >= 30 && (after.totals.cobblestone ?? 0) >= 64 && (chest1.totals.cobblestone ?? 0) === (chest0.totals.cobblestone ?? -1) && keepLicence >= 1),
    BASE_SHAPE: !!(!w.ended && (c1?.inItems ?? 0) === 0 && after.used >= 34 && (chest1.totals.cobblestone ?? 0) === (chest0.totals.cobblestone ?? -1) && keepLicence === 0) })
}

// COBBLEKEEP-01, COAL AND IRON (OWNER 10-19 ~14:10Z "coal and iron must get banked in town"; towndeposit.mjs ironKeeps): an
// empty town chest, a 36-slot bag of 3 iron ingots, 5 raw iron, 7 coal, a bucket, a stone pickaxe and white wool (never bankable,
// never junk). The town deposit fires at 34+ slots. BASE: the iron ladder keeps every unit -- nothing of it banked.
// CANDIDATE: the 3 ingots stay (the next craft), the raw iron and the coal are banked. Read back: the chest and the bag by RCON.
scenes.ironbank = async () => {
  buildArena(); BRAIN_WANDER = true
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  rcon(`setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} minecraft:air`)
  // a BUCKET held (79 of 80 fleet bags, 10-19): one iron craft left, so 3 units are the bot's own (r4: 3 per missing craft)
  const spec = [['iron_ingot', 3], ['raw_iron', 5], ['coal', 7], ['stone_pickaxe', 1], ['bucket', 1], ...Array.from({ length: 31 }, (_, i) => ['white_wool', 1 + (i % 3)])]
  const files = await startBot('ironbank', spec, { pool: `sbxstock-${RUN}-iron` })
  setChest([])
  const b0 = bag(NAME)
  const dep = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_town_deposit'), 150000, 500)
  await sleep(2000)
  const b1 = bag(NAME), c1 = chestTotals()
  const licence = rowsOf(files.skillLog).filter(r => r.name === '_cobblekeep_mode').length
  await stopBot(); BRAIN_WANDER = false
  result({ scene: 'ironbank', root: BOT_ROOT, deposit: dep ? `${dep.status} ${dep.detail.slice(0, 220)}` : null, bag: { before: b0.totals, after: b1.totals }, chest: c1.totals, licence,
    CANDIDATE_PASS: !!(dep && (c1.totals.raw_iron ?? 0) === 5 && (c1.totals.coal ?? 0) === 7 && !c1.totals.iron_ingot && (b1.totals.iron_ingot ?? 0) === 3 && licence >= 1),
    BASE_SHAPE: !!(!c1.totals.raw_iron && !c1.totals.coal && !c1.totals.iron_ingot && (b1.totals.raw_iron ?? 0) === 5 && licence === 0) })
}

// UNDER TARGET -> BANKED: a fresh town (journal empty) whose chest holds 20 oak; a 36-slot bag with oak 64+64+30 and torches.
// Expected: the count step counts it, the town deposit banks the 30-stack under ONE confirmed claim (20 -> 50 <= 64), never
// more than the room; the claim released by the post-transfer count.
scenes.stockbank = async () => {
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  setChest([['oak_log', 20]])
  const spec = [['oak_log', 64], ['oak_log', 64], ['oak_log', 30], ['stone_pickaxe', 1], ...TORCH(32)]
  const files = await startBot('stockbank', spec, { pool: `sbxstock-${RUN}-b` })
  const before = bag(NAME), chest0 = chestTotals()
  const td = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_town_deposit' && !/counted/.test(r.detail)), 200000, 500)
  await sleep(3000)
  const after = bag(NAME), chest1 = chestTotals()
  const jr = journalOf(files)
  await stopBot()
  result({ scene: 'stockbank', townDeposit: td?.detail?.slice(0, 260) ?? null, bag: { delta: deltaOf(before.totals, after.totals) }, chest: { before: chest0.totals, after: chest1.totals },
    claims: jr.filter(r => r.t === 'claim').map(r => ({ g: r.g ?? 'cobble', n: r.n, kind: r.kind ?? 'bank' })), liveAfter: jr.filter(r => r.t === 'claim').length - jr.filter(r => r.t === 'cnt' && r.ids?.length).length,
    rows: stockRows(files) })
}

// PRUNE: a fresh town, chest 10x64 oak. A full bag first (the count step counts the chest), then the torches cleared to
// leave room: the prune order takes at most 4 FULL stacks (never below the 64 target), throws exactly them, the bag ends
// with what it had.
scenes.stockprune = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  setChest(Array.from({ length: 10 }, () => ['oak_log', 64]))
  // the bag holds its keep (64) and 30 more: the prune's stacks go down whole, the 30 are bag surplus (Claude code r2 P2-2:
  // a prune takes only what the well then throws -- the bag never ends with more oak than it began)
  const spec = [['oak_log', 64], ['oak_log', 30], ['stone_pickaxe', 1], ['iron_ingot', 3], ...TORCH(32)]
  const files = await startBot('stockprune', spec, { pool: `sbxstock-${RUN}-p` })
  const counted = await waitRow(files, /^_cobble_reconcile$/, 150000)
  rcon(`clear ${NAME} minecraft:torch 1280`)
  await sleep(2000)
  const before = bag(NAME), chest0 = chestTotals(), sh0 = census(CAP)
  const visit = await waitRow(files, /^_stock_prune_visit$/, 300000)
  await sleep(3000)
  const after = bag(NAME), chest1 = chestTotals(), sh1 = census(CAP)
  const jr = journalOf(files)
  await stopBot()
  result({ scene: 'stockprune', counted: counted?.detail ?? null, visit: visit?.detail ?? null, bag: { delta: deltaOf(before.totals, after.totals) }, chest: { before: chest0.totals, after: chest1.totals },
    bagOakGrew: (after.totals.oak_log ?? 0) > (before.totals.oak_log ?? 0), outcome: lines(files.botOut).filter(l => /skill prune_town ->/.test(l)).map(l => l.slice(0, 200)),
    shaft: { before: sh0, after: sh1 }, takes: jr.filter(r => r.t === 'claim' && r.kind === 'take').map(r => r.n), rows: stockRows(files) })
}

// THE KEEP-ONLY CONTROL (Claude code r2 P2-2): the same over-target chest, a bag holding NO oak -- the well would keep any
// stack taken (the bag's keep), so no prune is ordered and nothing leaves the chest.
scenes.stockprunekeep = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  setChest(Array.from({ length: 10 }, () => ['oak_log', 64]))
  // free slots FROM THE START (run 3: a full bag until the clear could not prune for want of room -- not the control), and
  // a short wait (run 3: 180 s idle on the floating arena ended in a livelock relocation off its edge)
  const files = await startBot('stockprunekeep', [['stone_pickaxe', 1], ['iron_ingot', 3], ...TORCH(14)], { pool: `sbxstock-${RUN}-k` })
  const counted = await waitRow(files, /^(_cobble_reconcile|_withdraw_pick)$/, 150000)
  const before = bag(NAME), chest0 = chestTotals()
  await sleep(100000)   // >= one prune look after the count (STOCK_PRUNE_COOLDOWN_MS 60 s)
  const after = bag(NAME), chest1 = chestTotals()
  const jr = journalOf(files)
  const died = lines(files.botOut).some(l => /\bdied\b/.test(l))
  await stopBot()
  result({ scene: 'stockprunekeep', counted: counted?.name ?? null, died, oakCounts: jr.filter(r => r.t === 'cnt' && r.m && r.m.oak_log != null).map(r => r.m.oak_log),
    chest: { before: chest0.totals, after: chest1.totals }, bag: { delta: deltaOf(before.totals, after.totals) },
    visits: rowsOf(files.skillLog).filter(r => /^(_stock_prune_visit|prune_town)$/.test(r.name)).length,
    orders: lines(files.botOut).filter(l => /prune_town/.test(l)).length, takes: jr.filter(r => r.t === 'claim' && r.kind === 'take').length })
}

// NO CHEST AT TARGET: a fresh town whose only chest is FULL of oak (27x64); the bag carries a chest, oak 2x64 and torches;
// `deposit` is queued. Expected: no chest placed (the remainder is at target). POSITIVE CONTROL (same scene + 30 iron
// ingots, a fresh town): the recovery qualifies on the ingots (an untargeted item) and does build a chest.
async function noChestTrial (tag, extra) {
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  // FULL, and the oak exactly AT its target (64): nothing a prune may take (run 4: a chest of 27 oak stacks was pruned,
  // which made room in it, so the control's ingots went into the old chest and no recovery was ever asked)
  setChest([['oak_log', 64], ...Array.from({ length: 26 }, () => ['torch', 64])])
  // ONE free slot (run 3: with room the bot PRUNED the full chest first, which made room in it, so the control's ingots went
  // into the old chest and no recovery was ever asked; a prune needs two free slots)
  const spec = [['chest', 1], ['oak_log', 64], ['oak_log', 64], ['stone_pickaxe', 1], ...extra, ...TORCH(31 - extra.length)]
  const files = await startBot(tag, spec, { pool: `sbxstock-${RUN}-${tag}` })
  const ch0 = chestCount()
  brainQueue.push('deposit')
  const done = await waitFor(() => lines(files.botOut).find(l => /skill deposit ->/.test(l)), 240000, 500)
  await sleep(3000)
  const ch1 = chestCount()
  const b = bag(NAME)
  await stopBot()
  brainQueue.length = 0
  return { ended: done?.slice(0, 260) ?? null, chestsBefore: ch0, chestsAfter: ch1, bagChest: b.totals.chest ?? 0, rows: stockRows(files) }
}
scenes.stocknochest = async () => {
  const atTarget = await noChestTrial('nochest', [])
  const control = await noChestTrial('nochestctl', [['iron_ingot', 30]])
  result({ scene: 'stocknochest', atTarget, control,
    PASS: atTarget.chestsAfter === atTarget.chestsBefore && atTarget.bagChest === 1 && control.chestsAfter === control.chestsBefore + 1 })
}

// THE REFUSAL IS A ROW, READ FROM THE WORLD (stonecap-01 INCONCLUSIVE 10-12; operator: Paper first). A town chest of 26
// cobble stacks (1,664: 6.5x the 256 cap) and one empty slot; a small bag (no full-bag order fires) of cobble 64+64+30
// and oak 64+64. Trial 1 (`deposit`, mixed bag): the logs go in, the cobble stays -- the server's chest gains oak and
// no cobble, the server's bag keeps its 158 cobble -- and a _stock_refused row via=deposit names cobblestone:..:cobble_cap
// at_cobble=1. Trial 2 (the oak taken out of the bag; `deposit` again on the now-counted town): admission refuses the
// cobble-only plan before any skill runs and a row via=admission names the cap; the chest's cobble does not rise.
scenes.stockrefuse = async () => {
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  setChest(Array.from({ length: 26 }, () => ['cobblestone', 64]))
  const spec = [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 30], ['oak_log', 64], ['oak_log', 64], ['stone_pickaxe', 1], ...TORCH(4)]
  const files = await startBot('stockrefuse', spec, { pool: `sbxstock-${RUN}-rf` })
  const c0 = chestTotals(), b0 = bag(NAME)
  brainQueue.push('deposit')
  const d1 = await waitFor(() => lines(files.botOut).find(l => /skill deposit ->/.test(l)), 240000, 500)
  await sleep(2000)
  const c1 = chestTotals(), b1 = bag(NAME)
  const rows1 = rowsOf(files.skillLog).filter(r => r.name === '_stock_refused').map(r => r.detail)
  rcon(`clear ${NAME} minecraft:oak_log`)
  await sleep(1500)
  const n1 = rows1.length
  brainQueue.push('deposit')
  const adm = await waitFor(() => rowsOf(files.skillLog).filter(r => r.name === '_stock_refused').slice(n1).find(r => /^via=admission /.test(r.detail)), 120000, 500)
  await sleep(2000)
  const c2 = chestTotals(), b2 = bag(NAME)
  await stopBot()
  brainQueue.length = 0
  const cob = t => (t.cobblestone ?? 0) + (t.cobbled_deepslate ?? 0)
  result({ scene: 'stockrefuse', deposit: d1?.slice(0, 200) ?? null,
    world: { chest: [c0.totals, c1.totals, c2.totals], bag: [b0.totals, b1.totals, b2.totals] },
    trial1: { chestOakGained: (c1.totals.oak_log ?? 0) - (c0.totals.oak_log ?? 0), chestCobbleGained: cob(c1.totals) - cob(c0.totals), bagCobbleKept: cob(b1.totals),
      row: rows1.find(d => /^via=deposit .*cobblestone:\d+:cobble_cap/.test(d)) ?? null, rows: rows1 },
    trial2: { admissionRow: adm?.detail ?? null, chestCobbleGained: cob(c2.totals) - cob(c1.totals), bagCobble: cob(b2.totals) },
    PASS: !!(d1 && rows1.some(d => /^via=deposit .*at_cobble=1 .*cobblestone:\d+:cobble_cap/.test(d)) && (c1.totals.oak_log ?? 0) > (c0.totals.oak_log ?? 0)
      && cob(c1.totals) <= cob(c0.totals) && cob(b1.totals) >= 158 && adm && /at_cobble=1/.test(adm.detail) && cob(c2.totals) <= cob(c1.totals)) })
}

// THE RECOUNT (stocktarget-02; chest clear #2 10-14: the fenced towns stayed uncounted while bags sat under 34 slots).
// A well (the stock caps bind), a town chest of 20 oak, a 7-slot bag of oak 64+64. Life 1 counts the town (the journal
// must exist to be fenced). Then the clear's procedure: the bot stopped, the operator's fence (bots/scripts/stockreset.mjs
// on the pool dir), the bot started. Life 2, still 7 slots: the count_town order counts the chest AT ONCE (a
// _stock_recount row counted >= 1), and the queued `deposit` then GOES THROUGH under the target -- the server's chest
// 20 -> 64 oak (the room under 64), read from the world.
scenes.stockrecount = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  setChest([['oak_log', 20]])
  const pool = `sbxstock-${RUN}-rc`
  const spec = [['oak_log', 64], ['oak_log', 64], ['stone_pickaxe', 1], ...TORCH(4)]
  const counted = f => rowsOf(f.skillLog).find(r => r.name === '_stock_recount' && /counted=[1-9]/.test(r.detail))
  let files = await startBot('stockrecount1', spec, { pool })
  // life 1 only needs the town COUNTED by anything (run 7: its withdraw_pick opened the chest and counted it first)
  const life1 = await waitFor(() => journalOf(files).find(r => r.t === 'cnt' && r.m), 150000, 500)
  await stopBot()
  const fence = execFileSync('node', [path.join(BOT_ROOT, 'bots/scripts/stockreset.mjs'), files.poolDir], { encoding: 'utf8' }).trim()
  setChest([['oak_log', 20]])
  files = await startBot('stockrecount2', spec, { pool })
  const c0 = chestTotals(), b0 = bag(NAME)
  const life2 = await waitFor(() => counted(files), 150000, 500)
  const slotsAtCount = b0.used   // the server's bag: well under the town deposit's 34
  brainQueue.push('deposit')
  const dep = await waitFor(() => lines(files.botOut).find(l => /skill deposit ->/.test(l)), 180000, 500)
  await sleep(2000)
  const c1 = chestTotals(), b1 = bag(NAME)
  const rows = stockRows(files)
  await stopBot()
  brainQueue.length = 0
  const unknownAfter = rowsOf(files.skillLog).filter(r => r.name === '_stock_refused' && /_unknown/.test(r.detail) && life2 && r.ts > life2.ts).length
  result({ scene: 'stockrecount', life1: life1 ? `count of ${life1.k} oak=${life1.m.oak_log ?? 0}` : null, fence, life2: life2?.detail ?? null, slotsAtCount, deposit: dep?.slice(0, 200) ?? null,
    world: { chest: [c0.totals, c1.totals], bag: [b0.totals, b1.totals] }, unknownRefusalsAfterCount: unknownAfter, rows,
    PASS: !!(life1 && /reset/i.test(fence) && slotsAtCount < 34 && life2 && dep && /-> success/.test(dep) && (c1.totals.oak_log ?? 0) > (c0.totals.oak_log ?? 0)
      && (c1.totals.oak_log ?? 0) <= 64 && unknownAfter === 0) })
}

// THE COBBLE CAP AT 1000 (cobblecap-1000, OWNER 10-14). No well needed. Two towns (two pools, two journals), each a single
// town chest set by RCON and never counted before the bot joins; the bag is cobble 64+64+30, a stone pickaxe and torches
// (well under 34 slots); the model verb is `deposit`. Read from the WORLD (the server's chest and bag), not the bot's row:
//   A  the chest holds 800 (12x64 + 32; the base's 256 cap would refuse every stack): the town is counted (count_town,
//      stocktarget-02, or the deposit's own reconciliation), then the deposit banks a WHOLE surplus stack (one per run: the
//      smallest that frees a slot) -- the server's chest gains exactly what the bag lost, the _cobble_bank row says cap=1000
//      town_before=800 and its town_after is the server's chest
//   B  the chest holds exactly 1000 (15x64 + 40): once counted, the cobble is refused -- at admission ("nothing worth banking
//      (town cobble cap)", a _stock_refused at_cobble row; run 11) or by the deposit ("past its 1000 cobble (town cobble
//      cap)", when the deposit does the counting) -- the chest stays 1000, no _cobble_bank row moves anything
scenes.cobblecap = async () => {
  buildArena()   // run 9: without the arena (another agent's scenes cleared it) the bot fell 47 blocks at spawn
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  const stacksOf = n => { const a = []; for (let left = n; left > 0; left -= 64) a.push(['cobblestone', Math.min(64, left)]); return a }
  const cob = t => (t.cobblestone ?? 0) + (t.cobbled_deepslate ?? 0)
  // a crafting table and a furnace in the bag: without them the tech ladder's furnace rung (means: 8 cobble) is current and
  // WANTS cobblestone, so admission keeps every cobble ('nothing worth banking' -- run 10); both are kept by the deposit
  const spec = [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 30], ['stone_pickaxe', 1], ['crafting_table', 1], ['furnace', 1], ...TORCH(4)]
  const trials = {}
  for (const [tag, n] of [['A', 800], ['B', 1000]]) {
    setChest(stacksOf(n))
    const files = await startBot(`cobblecap${tag}`, spec, { pool: `sbxstock-${RUN}-cc${tag}`, early: true })
    const c0 = chestTotals(), b0 = bag(NAME)
    brainQueue.push('deposit')
    const dep = await waitFor(() => lines(files.botOut).find(l => /skill deposit ->|why=deposit_nothing_to_bank/.test(l)), 240000, 500)
    await sleep(2500)
    const c1 = chestTotals(), b1 = bag(NAME)
    const bankRows = rowsOf(files.skillLog).filter(r => r.name === '_cobble_bank').map(r => r.detail)
    const rows = stockRows(files)
    await stopBot()
    brainQueue.length = 0
    trials[tag] = { chestBefore: cob(c0.totals), chestAfter: cob(c1.totals), bagBefore: cob(b0.totals), bagAfter: cob(b1.totals), deposit: dep ?? null, bankRows, rows }
  }
  const A = trials.A, B = trials.B
  const gained = A.chestAfter - A.chestBefore
  const passA = !!(A.deposit && /-> success/.test(A.deposit) && A.chestBefore === 800 && gained > 0 && gained === A.bagBefore - A.bagAfter && A.bagAfter >= 64
    && A.bankRows.some(d => /town_before=800 /.test(d) && / cap=1000 /.test(d) && new RegExp(`town_after=${A.chestAfter} `).test(d)))
  const passB = !!(B.deposit && (/why=deposit_nothing_to_bank \(nothing worth banking \(town cobble cap\)/.test(B.deposit) || /past its 1000 cobble \(town cobble cap\)/.test(B.deposit))
    && B.chestBefore === 1000 && B.chestAfter === 1000 && !B.bankRows.some(d => !/ moved=0 /.test(d))
    && (B.rows.some(r => /^_stock_refused .* at_cobble=[1-9]\d* .*cobblestone:\d+:cobble_cap/.test(r)) || B.bankRows.some(d => / cap=1000 at_cap=1 /.test(d))))
  result({ scene: 'cobblecap', A, B, passA, passB, PASS: passA && passB })
}
// LIDCLEAR-01 (docs/reports/lidclear-2026-10-16.md): the town's only chest (20 oak) has COBBLESTONE on its lid -- the
// fleet's 18 of 18. A fresh pool: the town is uncounted, the bot holds 2x64 oak (a targeted group the plan cannot judge),
// so count_town fires at once. The base fails `lid_blocked` before walking and the town stays unknown; the candidate
// walks, digs the lid (bare-handed in `lidrecount`: the 10 s dig the old 10 s race always lost; a stone pickaxe in
// `lidrecountpick`), the SERVER opens the chest and the journal gets a count. Read back from the world: the lid cell, the
// chest's contents unchanged, the journal's `cnt` for the chest.
// COBBLEKEEP-01 (docs/reports/cobblekeep-01-cause-2026-10-19.md): the same scene with the fleet's two other lids -- DIRT
// (3,774 of 4,200 refusals in 60 h: the candidate digs it) and OAK LEAVES (422: the server opens a chest under leaves, so
// the candidate opens it WITHOUT a dig). `lid` is the block set on the lid, `dig` whether the candidate must dig it.
async function lidScene (scene, spec, { lid = 'cobblestone', dig = true } = {}) {
  buildArena()   // the floating dirt slab the town stands on (the `build` scene's first step; no well is needed here)
  BRAIN_WANDER = true   // two short walks in town, not 'status' for ever (that trips the livelock relocation off the arena: run 3 10-16)
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  setChest([['oak_log', 20]])
  const lidCell = `${CHEST.x} ${CHEST.y + 1} ${CHEST.z}`
  const lidState = lid === 'oak_leaves' ? 'oak_leaves[persistent=true]' : lid   // persistent: no decay during the scene
  const put = rcon(`setblock ${lidCell} minecraft:${lidState}`, `execute if block ${lidCell} minecraft:${lid}`)
  if (!passed(put[1]?.reply)) throw new Error('lid not set: ' + JSON.stringify(put))
  const pool = `sbxlid-${RUN}-${scene}`
  const files = await startBot(scene, spec, { pool })
  const key = `${CHEST.x},${CHEST.y},${CHEST.z}`
  // phase 1 ends at the first count of the chest from ANY path (a withdraw's visit counts it too), or a recount row
  const recount = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_stock_recount'), 150000, 500,
    () => journalOf(files).some(r => r.t === 'cnt' && r.k === key))
  await sleep(3000)
  const lidAir = passed(r1(`execute if block ${lidCell} minecraft:air`))
  const lidCobble = passed(r1(`execute if block ${lidCell} minecraft:${lid}`))   // the lid block still there (named for the census's cobblestone)
  const chest = chestTotals()
  const cnt = journalOf(files).filter(r => r.t === 'cnt' && r.k === key)
  const lidRows = rowsOf(files.skillLog).filter(r => r.name === '_lid_clear').map(r => `${r.status} ${r.detail}`)
  const digRows = rowsOf(files.skillLog).filter(r => r.name === '_dig_town').map(r => r.detail)
  const licence = rowsOf(files.skillLog).filter(r => r.name === '_lidclear_mode').length
  const keepLicence = rowsOf(files.skillLog).filter(r => r.name === '_cobblekeep_mode').length
  const recounts = rowsOf(files.skillLog).filter(r => r.name === '_stock_recount').map(r => `${r.status} ${r.detail.slice(0, 200)}`)
  // PHASE 2 (the RECOUNT's own path, `lidrecountpick` only): a bot with no pickaxe at spawn walks to WITHDRAW one first, and
  // that visit opens (and so counts) the chest before any count_town (Paper 10-16, both builds). So, once the server's bag
  // holds the stone pickaxe: cobblestone back on the lid, the town's counts fenced (stockreset.mjs, a journal append), and
  // the next count_town order must clear the lid itself -- with the pickaxe -- and count.
  let phase2 = null
  if (/pick/.test(scene)) {
    const hasPick = await waitFor(() => (bag(NAME).totals.stone_pickaxe ?? 0) >= 1, 60000, 2000)
    const put2 = rcon(`setblock ${lidCell} minecraft:cobblestone`, `execute if block ${lidCell} minecraft:cobblestone`)
    const fence = execFileSync('node', [path.join(BOT_ROOT, 'bots/scripts/stockreset.mjs'), files.poolDir], { encoding: 'utf8' }).trim()
    const t2 = Date.now()
    const rc2 = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_stock_recount' && r.ts >= t2 - 1000), 180000, 500)
    await sleep(3000)
    const cnt2 = journalOf(files).filter(r => r.t === 'cnt' && r.k === key && (r.cap ?? r.at) >= t2)
    phase2 = { hasPick: !!hasPick, lidSet: passed(put2[1]?.reply), fence: fence.slice(0, 120), recount: rc2?.detail ?? null,
      lidRows: rowsOf(files.skillLog).filter(r => r.name === '_lid_clear' && r.ts >= t2 - 1000).map(r => `${r.status} ${r.detail}`),
      lidAir: passed(r1(`execute if block ${lidCell} minecraft:air`)), lidCobble: passed(r1(`execute if block ${lidCell} minecraft:cobblestone`)),
      chest: chestTotals().totals, journalCountsAfterFence: cnt2.map(r => ({ n: r.n, m: r.m, cap: r.cap })) }
    phase2.CANDIDATE_PASS = !!(phase2.lidAir && cnt2.length >= 1 && rc2 && /counted=[1-9]/.test(rc2.detail) && phase2.lidRows.some(l => /outcome=dug by=count_town .*tool=stone_pickaxe/.test(l)))
    phase2.BASE_SHAPE = !!(phase2.lidCobble && cnt2.length === 0 && rc2 && /fails=lid_blocked:1/.test(rc2.detail))
  }
  await stopBot(); BRAIN_WANDER = false
  const lidDigs = digRows.filter(d => /purpose=lid/.test(d)).length
  result({ scene, root: BOT_ROOT, lid, recount: recount?.detail ?? null, recounts, lidRows, digRows, licence, keepLicence, phase2,
    world: { lidAir, lidStill: lidCobble, chest: chest.totals }, journalCounts: cnt.map(r => ({ n: r.n, m: r.m, cap: r.cap })),
    CANDIDATE_PASS: dig
      ? !!(lidAir && !lidCobble && cnt.length >= 1 && (chest.totals.oak_log ?? 0) === 20 && licence >= 1 && lidRows.some(l => /outcome=dug /.test(l)) && (lid === 'cobblestone' || keepLicence >= 1))
      : !!(lidCobble && cnt.length >= 1 && (chest.totals.oak_log ?? 0) === 20 && lidRows.length === 0 && lidDigs === 0 && keepLicence >= 1),
    BASE_SHAPE: !!(lidCobble && cnt.length === 0 && recount && /fails=lid_blocked:1/.test(recount.detail) && keepLicence === 0) })
}
scenes.lidrecount = () => lidScene('lidrecount', [['oak_log', 64], ['oak_log', 64], ...TORCH(4)])
// cobble above the bag's 64 reserve: the COBBLE CAP (no well needed) refuses it `cobble_unknown` until the town is counted
scenes.lidrecountpick = () => lidScene('lidrecountpick', [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['stone_pickaxe', 1], ...TORCH(4)])
// cobblekeep-01: the bag of the fleet's unknown towns (cobble above the 64 reserve, refused `cobble_unknown` until counted)
scenes.liddirt = () => lidScene('liddirt', [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['stone_pickaxe', 1], ...TORCH(4)], { lid: 'dirt' })
scenes.lidglass = () => lidScene('lidglass', [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['stone_pickaxe', 1], ...TORCH(4)], { lid: 'glass', dig: false })
scenes.lidleaves = () => lidScene('lidleaves', [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['stone_pickaxe', 1], ...TORCH(4)], { lid: 'oak_leaves', dig: false })

// ---------------------------------------------------------------- TOWNSEARCH-01 (withdraw_pick looks in every town container)
// THE FAR CHEST: 12 single chests in town (on the slab, y 120), 11 of them within 8 of home holding 5 dirt each, and ONE
// 13.9 from home (dx -13, dz +5) holding a stone pickaxe (damage 20) and 20 sticks. The bot spawns at home with no pickaxe:
// a crafting table and 3 cobblestone (so its one deficit is 2 sticks). Its own town order runs withdraw_pick; the scene reads
// every `_withdraw_pick` row until one TAKES something or `orders` rows have been written, then reads back the WORLD: the
// server's bag, the far chest and every near chest's contents (RCON `data get`), which chests the server was asked to open
// (the trace), and the licence row. BASE SHAPE: no pickaxe, the far chest untouched, the near chests nearest home opened.
// CANDIDATE: the server's bag holds the stone pickaxe, the far chest lost exactly it, every near chest still 5 dirt.
const TS_NEAR = [[3, 0], [0, 3], [-3, 0], [0, -3], [5, 5], [-5, 5], [5, -5], [-5, -5], [8, 0], [0, 8], [0, -8]]
const TS_FAR = [-13, 5]
async function townSearchScene (scene, { orders = 1, wait = 300000 } = {}) {
  buildArena()
  BRAIN_WANDER = true   // two short walks in town, not 'status' for ever (the livelock relocation off the arena)
  rcon(`kill ${ARENA_SEL}`)
  const at = ([dx, dz]) => ({ x: HOME.x + dx, y: HOME.y, z: HOME.z + dz })
  for (const c of TS_NEAR) setChest([['dirt', 5]], at(c))
  const far = at(TS_FAR)
  setChest([['stick', 20]], far)
  const put = rcon(`item replace block ${far.x} ${far.y} ${far.z} container.1 with minecraft:stone_pickaxe[minecraft:damage=20] 1`)
  if (/Unknown|Incorrect|Cannot|not loaded/i.test(put[0]?.reply ?? '')) throw new Error('far pickaxe: ' + put[0].reply)
  const before = { far: chestTotals(far).totals, near: TS_NEAR.map(c => chestTotals(at(c)).totals) }
  const pool = `sbxts-${RUN}-${scene}`
  const files = await startBot(scene, [['crafting_table', 1], ['cobblestone', 3], ...TORCH(2)], { pool })
  const t0 = Date.now()
  const wpRows = () => rowsOf(files.skillLog).filter(r => r.name === '_withdraw_pick' && / verb=withdraw_pick /.test(r.detail))
  await waitFor(() => { const w = wpRows(); return w.length >= orders || w.some(r => / took=(?!-)/.test(r.detail)) }, wait, 1000)
  await sleep(3000)
  const rows = wpRows()
  const after = { far: chestTotals(far).totals, near: TS_NEAR.map(c => chestTotals(at(c)).totals) }
  const b = bag(NAME)
  const opened = (() => { try { return lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && /open|window_open|block_place/.test(e.pkt ?? '')).length } catch { return null } })()
  const licence = rowsOf(files.skillLog).filter(r => r.name === '_townsearch_mode').length
  const visitsPerRow = rows.map(r => ((r.detail.match(/tried=\[(.*)\]?/) || [])[1] || '').split(';').filter(Boolean).length)
  const skillEnd = lines(files.botOut).filter(l => /skill withdraw_pick ->/.test(l)).map(l => l.slice(0, 200))
  await stopBot(); BRAIN_WANDER = false
  const nearUnchanged = after.near.every(t => JSON.stringify(t) === JSON.stringify({ dirt: 5 }))
  result({ scene, root: BOT_ROOT, ms: Date.now() - t0, rows: rows.map(r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.status} ${r.detail}`), visitsPerRow, skillEnd,
    world: { bag: b.totals, farBefore: before.far, farAfter: after.far, nearUnchanged, nearAfter: after.near }, licence, openPkts: opened,
    CANDIDATE_PASS: !!((b.totals.stone_pickaxe ?? 0) === 1 && !after.far.stone_pickaxe && (after.far.stick ?? 0) === 20 && nearUnchanged && licence >= 1 &&
      rows.some(r => /^outcome=took_pick /.test(r.detail))),
    BASE_SHAPE: !!(!(b.totals.stone_pickaxe ?? 0) && (after.far.stone_pickaxe ?? 0) === 1 && licence === 0 && rows.length >= 1 && rows.every(r => !/^outcome=took_pick /.test(r.detail))) })
}
// KITSEARCH (toolkit-03): 10 single chests, 9 near home with 5 dirt, ONE 13.9 from home with 20 iron ingots; the bot holds a
// full iron pickaxe (no pickaxe order), 9 sticks and a crafting table (the craft's table), no axe and no shovel. Its own
// toolkit town order runs. BASE: opens the 3 nearest home, `no_iron`, the far chest keeps its 20. CANDIDATE: the search reaches
// the far chest, takes 4, crafts the iron axe and the iron shovel; every near chest still 5 dirt; licence _toolkit_search_mode.
scenes.kitsearch = async () => {
  buildArena()
  BRAIN_WANDER = true
  rcon(`kill ${ARENA_SEL}`)
  const at = ([dx, dz]) => ({ x: HOME.x + dx, y: HOME.y, z: HOME.z + dz })
  const near = TS_NEAR.slice(0, 9)
  for (const c of near) setChest([['dirt', 5]], at(c))
  const far = at(TS_FAR)
  setChest([['iron_ingot', 20]], far)
  const before = { far: chestTotals(far).totals, near: near.map(c => chestTotals(at(c)).totals) }
  const pool = `sbxks-${RUN}`
  const files = await startBot('kitsearch', [['iron_pickaxe', 1], ['stick', 9], ['crafting_table', 1], ...TORCH(2)], { pool })
  const t0 = Date.now()
  const kitRows = () => rowsOf(files.skillLog).filter(r => r.name === '_toolkit' && /^phase=kit /.test(r.detail))
  await waitFor(() => kitRows().length >= 1, 300000, 1000)
  await sleep(3000)
  const rows = kitRows()
  const after = { far: chestTotals(far).totals, near: near.map(c => chestTotals(at(c)).totals) }
  const b = bag(NAME)
  const licence = rowsOf(files.skillLog).filter(r => r.name === '_toolkit_search_mode').length
  const skillEnd = lines(files.botOut).filter(l => /skill toolkit ->/.test(l)).map(l => l.slice(0, 220))
  const tools = rcon(`execute if items entity ${NAME} container.* minecraft:iron_axe[minecraft:damage=0]`, `execute if items entity ${NAME} container.* minecraft:iron_shovel[minecraft:damage=0]`)
  await stopBot(); BRAIN_WANDER = false
  const nearUnchanged = after.near.every(t => JSON.stringify(t) === JSON.stringify({ dirt: 5 }))
  result({ scene: 'kitsearch', root: BOT_ROOT, ms: Date.now() - t0, rows: rows.map(r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.status} ${r.detail}`), skillEnd,
    world: { bag: b.totals, farBefore: before.far, farAfter: after.far, nearUnchanged, nearAfter: after.near, freshTools: tools.map(x => x.reply) }, licence,
    CANDIDATE_PASS: !!((b.totals.iron_axe ?? 0) === 1 && (b.totals.iron_shovel ?? 0) === 1 && (after.far.iron_ingot ?? 0) === 16 && nearUnchanged && licence >= 1 &&
      rows.some(r => /^phase=kit outcome=crafted /.test(r.detail))),
    BASE_SHAPE: !!(!(b.totals.iron_axe ?? 0) && !(b.totals.iron_shovel ?? 0) && (after.far.iron_ingot ?? 0) === 20 && licence === 0 && rows.length >= 1 &&
      rows.every(r => /^phase=kit outcome=no_iron /.test(r.detail))) })
}
// SMELTCOAL (toolkit-03, the smelt job's part): 10 single chests; the one nearest home (2.2 away, uniquely nearest: run 1 put
// it among four chests 3 away and the base's tie-break never opened it) holds 8 raw copper, 8 hold dirt, the far one (13.9
// from home) holds the town's ONLY coal; a furnace beside home. The bot holds the full kit (iron pickaxe, axe,
// shovel: no toolkit or pickaxe order) and no fuel. BASE: copper taken, 3 containers looked in, no coal -> no_fuel, the copper
// back. CANDIDATE: the coal pass reaches the far chest, the job smelts 8 and banks the ingots; the far chest loses 1 coal.
scenes.smeltcoal = async () => {
  buildArena()
  BRAIN_WANDER = true
  rcon(`kill ${ARENA_SEL}`)
  const at = ([dx, dz]) => ({ x: HOME.x + dx, y: HOME.y, z: HOME.z + dz })
  const near = [[1, 2], ...TS_NEAR.slice(0, 8)]
  near.forEach((c, i) => setChest(i === 0 ? [['raw_copper', 8]] : [['dirt', 5]], at(c)))
  const far = at(TS_FAR)
  setChest([['coal', 4]], far)
  const fur = at([2, -2])
  rcon(`setblock ${fur.x} ${fur.y} ${fur.z} minecraft:air`, `setblock ${fur.x} ${fur.y} ${fur.z} minecraft:furnace[facing=south]`)
  const before = { far: chestTotals(far).totals, near: near.map(c => chestTotals(at(c)).totals) }
  const pool = `sbxsc-${RUN}`
  const files = await startBot('smeltcoal', [['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ...TORCH(2)], { pool })
  const t0 = Date.now()
  const jobRows = () => rowsOf(files.skillLog).filter(r => r.name === '_smelt_town')
  await waitFor(() => jobRows().length >= 1, 420000, 1000)
  await sleep(3000)
  const rows = jobRows()
  const after = { far: chestTotals(far).totals, near: near.map(c => chestTotals(at(c)).totals) }
  const b = bag(NAME)
  const skillEnd = lines(files.botOut).filter(l => /skill smelt_town ->/.test(l)).map(l => l.slice(0, 220))
  await stopBot(); BRAIN_WANDER = false
  const townIngots = after.near.reduce((n, t) => n + (t.copper_ingot ?? 0), 0) + (after.far.copper_ingot ?? 0)
  const townRaw = after.near.reduce((n, t) => n + (t.raw_copper ?? 0), 0) + (after.far.raw_copper ?? 0)
  result({ scene: 'smeltcoal', root: BOT_ROOT, ms: Date.now() - t0, rows: rows.map(r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.status} ${r.detail}`), skillEnd,
    world: { bag: b.totals, farBefore: before.far, farAfter: after.far, nearAfter: after.near, townIngots, townRaw },
    CANDIDATE_PASS: !!(rows.some(r => /^stop=done .* smelted=8 /.test(r.detail)) && townIngots === 8 && townRaw === 0 && (after.far.coal ?? 0) === 3),
    BASE_SHAPE: !!(rows.length >= 1 && rows.every(r => /^stop=no_fuel /.test(r.detail)) && townRaw === 8 && townIngots === 0 && (after.far.coal ?? 0) === 4) })
}
// IRONPICK (ironpick-01; LOCK_OWNER=ironpick; no well needed): the kit makes an IRON PICKAXE from the town's iron when the bag has
// none above 40 uses. One chest 3 from home; the bot holds a WORN iron pickaxe (damage 220 = 30 uses left), the iron axe and the
// iron shovel (so the base build's kit has nothing to make), 9 sticks and a crafting table. Read back from the WORLD: the
// server's bag (a fresh copy = damage 0, the worn copy = damage 220, by `execute if items`), the chest's contents, the item
// entities on the arena, the rows. Scenes:
//   ironpick      chest 20 ingots + 64 sticks -> CANDIDATE: a fresh iron pickaxe, the worn copy still held, the chest 20 -> 17, a
//                 `_kit_ironpick` made=1 row. BASE: no kit order (the kit is held), the chest keeps its 20.
//   ironpickkeep  chest 3 + TOWN_IRON_KEEP - 1 = 6 ingots -> CANDIDATE: no craft, the chest keeps 6, a `_kit_ironpick` no_iron row.
//   ironpickfull  a FULL bag (36/36): worn iron pickaxe, iron axe, sticks, table, three whole bankable stacks (raw copper, copper
//                 ingots, coal) and 29 single white wool; chest 20 ingots -> CANDIDATE: room made (by the town deposit, which goes
//                 first at 34+, or the kit's own room plan), the fresh pickaxe AND the shovel crafted, chest 20 -> 16, nothing on
//                 the ground.
const IRON_WORN = 'iron_pickaxe[minecraft:damage=220]'
async function ironpickScene (scene, { chestIron, bagSpec, wait = 300000 }) {
  buildArena()
  BRAIN_WANDER = true
  rcon(`kill ${ARENA_SEL}`)
  const at = { x: HOME.x + 3, y: HOME.y, z: HOME.z }
  setChest([['iron_ingot', chestIron], ['stick', 64]], at)
  const before = chestTotals(at).totals
  const files = await startBot(scene, bagSpec, { pool: `sbxip-${RUN}-${scene}` })
  const b0 = bag(NAME)
  const t0 = Date.now()
  const ipRows = () => rowsOf(files.skillLog).filter(r => r.name === '_kit_ironpick')
  await waitFor(() => ipRows().length >= 1, wait, 1000)
  await sleep(4000)
  const rows = ipRows()
  const kit = rowsOf(files.skillLog).filter(r => r.name === '_toolkit' && /^phase=kit /.test(r.detail)).map(r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.status} ${r.detail}`)
  const orders = rowsOf(files.skillLog).filter(r => /^_(town_deposit|withdraw_pick|toolkit|kit_ironpick|well_dispose|wear_out)$/.test(r.name)).map(r => `${r.name}:${r.status}`)
  const after = chestTotals(at).totals
  const b = bag(NAME)
  const freshN = /count: (\d+)/.exec(r1(`execute if items entity ${NAME} container.* minecraft:iron_pickaxe[minecraft:damage=0]`))?.[1]
  const wornN = /count: (\d+)/.exec(r1(`execute if items entity ${NAME} container.* minecraft:iron_pickaxe[minecraft:damage=220]`))?.[1]
  const ground = /count: (\d+)/.exec(r1(`execute if entity ${ARENA_SEL}`))?.[1] ?? '0'
  const licence = rowsOf(files.skillLog).filter(r => r.name === '_toolkit_ironpick_mode').map(r => r.detail)
  await stopBot(); BRAIN_WANDER = false
  const out = { scene, root: BOT_ROOT, ms: Date.now() - t0, rows: rows.map(r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.status} ${r.detail}`), kit, orders: orders.slice(0, 20),
    world: { bagBefore: b0.totals, bag: b.totals, used: [b0.used, b.used], chestBefore: before, chestAfter: after, freshIronPick: Number(freshN ?? 0), wornIronPick: Number(wornN ?? 0), groundItems: Number(ground) },
    licence }
  return out
}
scenes.ironpick = async () => {
  const r = await ironpickScene('ironpick', { chestIron: 20, bagSpec: [[IRON_WORN, 1], ['iron_axe', 1], ['iron_shovel', 1], ['stick', 9], ['crafting_table', 1], ...TORCH(2)] })
  const w = r.world
  result({ ...r, CANDIDATE_PASS: !!(w.freshIronPick === 1 && w.wornIronPick === 1 && (w.chestAfter.iron_ingot ?? 0) === 17 && w.groundItems === 0 &&
      r.rows.some(x => / outcome=crafted made=1 best=iron_pickaxe@30->iron_pickaxe@250 drew=3 iron_seen=20 keep=4 /.test(` ${x.split(' ').slice(2).join(' ')}`)) && r.licence.some(l => /^phase=mode on=1 /.test(l))),
    BASE_SHAPE: !!(w.freshIronPick === 0 && w.wornIronPick === 1 && (w.chestAfter.iron_ingot ?? 0) === 20 && r.rows.length === 0 && r.licence.length === 0) })
}
scenes.ironpickkeep = async () => {
  const r = await ironpickScene('ironpickkeep', { chestIron: 6, bagSpec: [[IRON_WORN, 1], ['iron_axe', 1], ['iron_shovel', 1], ['stick', 9], ['crafting_table', 1], ...TORCH(2)] })
  const w = r.world
  result({ ...r, CANDIDATE_PASS: !!(w.freshIronPick === 0 && w.wornIronPick === 1 && (w.chestAfter.iron_ingot ?? 0) === 6 && (w.bag.iron_ingot ?? 0) === 0 &&
      r.rows.length >= 1 && r.rows.every(x => / outcome=no_iron made=0 .* drew=0 /.test(` ${x.split(' ').slice(2).join(' ')}`))) })
}
scenes.ironpickfull = async () => {
  const spec = [[IRON_WORN, 1], ['iron_axe', 1], ['stick', 9], ['crafting_table', 1], ['raw_copper', 64], ['copper_ingot', 64], ['coal', 64], ...Array.from({ length: 29 }, () => ['white_wool', 1])]
  const r = await ironpickScene('ironpickfull', { chestIron: 20, bagSpec: spec })
  const w = r.world
  result({ ...r, BAG_FULL_AT_START: w.used[0] === 36,
    CANDIDATE_PASS: !!(w.used[0] === 36 && w.freshIronPick === 1 && w.wornIronPick === 1 && (w.bag.iron_shovel ?? 0) === 1 && (w.chestAfter.iron_ingot ?? 0) === 16 && w.groundItems === 0 &&
      r.rows.some(x => / outcome=crafted made=1 /.test(` ${x.split(' ').slice(2).join(' ')}`))) })
}
// TOWNINDEX (townindex-01): the bot's OWN town orders (the toolkit's search for the shovel's iron; the town deposit of a
// 36-slot bag) open the town's containers; the scene then stops the bot and reads back the WORLD (RCON `data get` of every
// container) against the index file the bot wrote in its pool directory. Containers (on the slab, y 120):
//   N1 (+3, 0) dirt 5 | DBL (0..1, +3) a DOUBLE chest: sticks 20 + cobblestone 30 in its left half | N3 (-3, 0) coal 9 + planks 12
//   FAR (-13, +5) 20 iron ingots (in town, 13.9 from home) | OUT (+17, 0) 64 coal: OUTSIDE town (17 > 16), never indexed
// CANDIDATE: the licence row; every container the index holds as KNOWN reads exactly the server's contents (all halves); the
// double chest, if opened, under its LOWER half with both halves; OUT never in the index; every verified transfer joined to its
// pre-state and its re-open (same container) and the re-open showing the stack; a container drawn from or deposited into ends
// dirty or known (re-opened). BASE: the same orders run, no index file, no licence row.
const TI_N = { N1: [3, 0], N3: [-3, 0], FAR: [-13, 5], OUT: [17, 0] }
scenes.townindex = async () => {
  buildArena()
  BRAIN_WANDER = true
  rcon(`kill ${ARENA_SEL}`)
  const at = ([dx, dz]) => ({ x: HOME.x + dx, y: HOME.y, z: HOME.z + dz })
  setChest([['dirt', 5]], at(TI_N.N1))
  setChest([['coal', 9], ['oak_planks', 12]], at(TI_N.N3))
  setChest([['iron_ingot', 20]], at(TI_N.FAR))
  setChest([['coal', 64]], at(TI_N.OUT))
  const dl = at([0, 3]), dr = at([1, 3])
  const put = rcon(`setblock ${dl.x} ${dl.y} ${dl.z} minecraft:air`, `setblock ${dr.x} ${dr.y} ${dr.z} minecraft:air`,
    `setblock ${dl.x} ${dl.y} ${dl.z} minecraft:chest[facing=north,type=left]`, `setblock ${dr.x} ${dr.y} ${dr.z} minecraft:chest[facing=north,type=right]`,
    `item replace block ${dl.x} ${dl.y} ${dl.z} container.0 with minecraft:stick 20`, `item replace block ${dl.x} ${dl.y} ${dl.z} container.1 with minecraft:cobblestone 30`)
  if (put.some(x => /Unknown|Incorrect|Cannot|not loaded/i.test(x.reply))) throw new Error('double chest: ' + JSON.stringify(put))
  const key = p => `${p.x},${p.y},${p.z}`
  const conts = { N1: [at(TI_N.N1)], N3: [at(TI_N.N3)], FAR: [at(TI_N.FAR)], OUT: [at(TI_N.OUT)], DBL: [dl, dr] }
  // the bag: a full bag (bagbudget-01's measured BAG_MIX, restated here: that driver constant came with bagbudget-01, which this
  // base does not carry) with an iron axe and no shovel (the toolkit draws 1 ingot from a container keeping 4: FAR is the only
  // one). On this base the town deposit banks what the base's plan banks (no allowance rows); the scene's CANDIDATE_PASS still
  // needs one town_deposit that banked -- NOT re-run on Paper for this variant
  const TI_BAG = [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 50], ['bucket', 1], ['furnace', 1], ['crafting_table', 2], ['chest', 12],
    ['torch', 11], ['ladder', 4], ['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 35], ['oak_log', 64], ['oak_sapling', 9], ['birch_sapling', 7], ['bone_meal', 32],
    ['bamboo', 64], ['bamboo', 30], ['apple', 7], ['cooked_beef', 5], ['salmon', 3], ['egg', 6], ['flint', 4], ['amethyst_block', 4], ['iron_axe', 1], ['stick', 6]]
  const spec = [...TI_BAG]; while (spec.length < 36) spec.push(['white_wool', 1 + (spec.length % 3)])
  const pool = `sbxti-${RUN}`
  const files = await startBot('townindex', spec, { pool })
  const t0 = Date.now()
  const want = () => { const rs = rowsOf(files.skillLog); return rs.some(r => r.name === '_town_deposit') && rs.some(r => r.name === '_toolkit' && /^phase=kit /.test(r.detail)) }
  await waitFor(want, 360000, 1000)
  await sleep(4000)
  const rows = rowsOf(files.skillLog).filter(r => /^(_town_deposit|_toolkit|_kit_search|_townindex_mode|_townindex_count|_stock_recount)$/.test(r.name))
  await stopBot(); BRAIN_WANDER = false
  // the server's truth, every container (a double chest's halves summed)
  const truth = {}
  for (const [n, ps] of Object.entries(conts)) {
    const t = {}
    for (const p of ps) for (const [id, c] of Object.entries(chestTotals(p).totals)) t[id] = (t[id] || 0) + c
    truth[n] = t
  }
  // the index the bot wrote (its pool directory), folded with the build's own fold
  const TI = await import(path.join(R, 'bots/src/townindex.mjs'))
  const hk = TI.indexHomeKey(HOME)
  let recs = []
  try { recs = TI.indexRecords(files.poolDir, hk) } catch { recs = [] }
  const fold = TI.foldIndex(recs).worlds
  const ents = Object.values(fold)[0] ?? {}
  const nameOf = k => Object.entries(conts).find(([, ps]) => ps.some(p => key(p) === k))?.[0] ?? k
  const report = {}
  let knownExact = 0, knownWrong = 0
  for (const [k, e] of Object.entries(ents)) {
    const n = nameOf(k), st = TI.indexStateOf(e)
    const seen = Object.fromEntries(Object.entries(e.obs?.names ?? {}).map(([id, [c]]) => [id, c]))
    const exact = JSON.stringify(Object.entries(seen).sort()) === JSON.stringify(Object.entries(truth[n] ?? {}).sort())
    report[n] = { k, state: st, seen, halves: e.obs?.h ?? null }
    if (st === 'known') { if (exact) knownExact++; else knownWrong++ }
  }
  const obs = recs.filter(r => r.t === 'obs'), xf = recs.filter(r => r.t === 'xfer'), dirty = recs.filter(r => r.t === 'dirty')
  const byId = Object.fromEntries(obs.map(r => [r.id, r]))
  const xfBad = xf.filter(r => r.ok === 1).filter(r => !(byId[r.pre]?.k === r.k && byId[r.ver]?.k === r.k && ((byId[r.ver].names?.[r.name]?.[0] ?? 0) >= r.n)))
  const outIndexed = recs.some(r => r.k === key(conts.OUT[0]))
  const dblOk = !report.DBL || (report.DBL.k === key(dl) && JSON.stringify(report.DBL.halves) === JSON.stringify([key(dl), key(dr)]))
  const licence = rowsOf(files.skillLog).filter(r => r.name === '_townindex_mode').length
  const kit = rows.filter(r => r.name === '_toolkit' && /^phase=kit /.test(r.detail)), td = rows.filter(r => r.name === '_town_deposit')
  result({ scene: 'townindex', root: BOT_ROOT, ms: Date.now() - t0, rows: rows.map(r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.name} ${r.status} ${r.detail.slice(0, 160)}`),
    world: { truth }, index: { records: recs.length, obs: obs.length, dirty: dirty.length, xfer: xf.length, xferVerified: xf.filter(r => r.ok === 1).length, report, knownExact, knownWrong, xfBad: xfBad.length, outIndexed, dblOk }, licence,
    // NOT VACUOUS (Codex code r1 P2): the mutations happened (a kit crafted from drawn iron; a town deposit that banked stacks),
    // verified transfers exist to be joined, and the double chest was opened -- before the negative assertions mean anything
    CANDIDATE_PASS: !!(licence >= 1 && kit.some(r => r.status === 'success' && /outcome=crafted /.test(r.detail)) && td.some(r => r.status === 'success' && / banked (?!-)/.test(r.detail)) &&
      obs.length >= 2 && knownExact >= 2 && knownWrong === 0 && xf.filter(r => r.ok === 1).length >= 1 && xfBad.length === 0 && !outIndexed &&
      !!report.DBL && dblOk && report.FAR?.state === 'dirty' && Object.values(report).every(e => ['known', 'dirty'].includes(e.state))),
    BASE_SHAPE: !!(licence === 0 && recs.length === 0 && kit.length >= 1 && td.length >= 1) })
}
scenes.townsearch = () => townSearchScene('townsearch')
scenes.townsearch2 = () => townSearchScene('townsearch2', { orders: 2, wait: 1700000 })   // two orders (the second ~20 min later)

// RACE: two bots, one town at target + ONE stack (128 oak, target 64), both with room and a fresh count: both get prune
// orders; at most one stack may leave (the take claims, decided in the journal's order).
scenes.stockrace = async () => {
  if (!CAP) throw new Error('no well (run build first)')
  rcon(`kill ${ARENA_SEL}`); CHEST = CHEST ?? pickChest()
  setChest([['oak_log', 64], ['oak_log', 64]])
  const chest0 = chestTotals()   // before either bot (10-10 run 2 read it after the first prune)
  const pool = `sbxstock-${RUN}-r`
  const full = [['stone_pickaxe', 1], ...TORCH(35)]
  // both bags hold their keep (64 oak), so either bot's prune would be thrown whole (one slot holds 64, never 70: run 2's
  // 70 was refused by the server and the bot started with none)
  const f1 = await startBot('stockrace', [['oak_log', 64], ['oak_log', 6], ...full.slice(0, 34)], { pool, name: NAME })
  const counted = await waitRow(f1, /^_cobble_reconcile$/, 150000)
  const f2 = await startBot('stockrace', [['stone_pickaxe', 1], ['oak_log', 64], ['iron_ingot', 2]], { pool, name: NAME2 })
  rcon(`clear ${NAME} minecraft:torch 2304`)
  const v1 = waitRow(f1, /^_stock_prune_visit$/, 300000), v2 = waitRow(f2, /^_stock_prune_visit$/, 300000)
  const [a, b] = await Promise.all([v1, v2])
  await sleep(3000)
  const chest1 = chestTotals()
  const jr = journalOf(f1)
  await stopBot()
  result({ scene: 'stockrace', counted: counted?.detail ?? null, visits: [a?.detail ?? null, b?.detail ?? null], chest: { before: chest0.totals, after: chest1.totals },
    takes: jr.filter(r => r.t === 'claim' && r.kind === 'take').map(r => ({ bot: r.bot, n: r.n })), rels: jr.filter(r => r.t === 'rel').length,
    floorOk: (chest1.totals.oak_log ?? 0) >= 64 })
}

// ---------------------------------------------------------------- JUNKOUT-01 (docs/reports/junkout-01-design-2026-10-21.md)
// Every verdict is read from the WORLD (the server's bag by RCON `data get`, the chest's contents, the item entities on the
// arena); the bot's own `_junkout` rows only say which order ran. LOCK_OWNER=junkout. Base = the fleet sha's bots/ tree,
// candidate = junkout-on-34d3e5e; the same driver for both arms.
const JO_LISTED = ['egg', 'flint', 'ink_sac', 'glass']
const joRows = files => rowsOf(files.skillLog).filter(r => /^(dispose_well|_well_dispose|_junkout|_junkout_mode|compost|_compost|town_deposit|_town_deposit|count_town|wear_out)$/.test(r.name))
  .map(r => `${r.name} ${r.status} ${r.detail.slice(0, 230)}`)
const unchanged = (before, after, names) => names.filter(n => (before.totals[n] ?? 0) !== (after.totals[n] ?? 0))
// S1 (after `build`): a NOT-full bag with listed junk at town, no chest, no composter: the visit dispose throws the listed
// junk ONLY; everything else in the bag is unchanged. `junkwelloff` is the same scene with JUNK_VISIT=off BAG_ALLOWANCE=off.
async function junkWellScene (scene, env = {}) {
  if (!CAP) throw new Error('no well (run build first)')
  BRAIN_WANDER = true
  rcon(`kill ${ARENA_SEL}`); CHEST = pickChest(); rcon(`setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} minecraft:air`)
  const spec = [['egg', 16], ['flint', 30], ['ink_sac', 10], ['glass', 5], ['cobblestone', 64], ['oak_log', 20], ['bread', 8], ['stone_pickaxe', 1, 30], ['torch', 4], ['bone_meal', 5]]
  const keep = ['cobblestone', 'oak_log', 'bread', 'stone_pickaxe', 'torch', 'bone_meal']
  const files = await startBot(scene, spec, { pool: `sbxstock-${RUN}-${scene}`, env })
  const before = bag(NAME)
  const visitRow = () => rowsOf(files.skillLog).find(r => r.name === '_junkout' && /^phase=well /.test(r.detail))
  const disp = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === 'dispose_well') && visitRow(), 240000, 1000)
  await sleep(6000)
  const after = bag(NAME), cs = census(CAP)
  const anyDispose = rowsOf(files.skillLog).filter(r => r.name === 'dispose_well').length
  const licence = rowsOf(files.skillLog).filter(r => r.name === '_junkout_mode').map(r => r.detail)
  await stopBot(); BRAIN_WANDER = false
  const listedLeft = JO_LISTED.filter(n => (after.totals[n] ?? 0) > 0)
  const changed = unchanged(before, after, keep)
  result({ scene, root: BOT_ROOT, env, licence, bag: { used: [before.used, after.used], before: before.totals, after: after.totals }, census: cs, visitRow: disp ? disp.detail : null,
    disposeRuns: anyDispose, listedLeft, otherChanged: changed, rows: joRows(files).slice(0, 20),
    CANDIDATE_PASS: !!(disp && /status=success/.test(disp.detail) && listedLeft.length === 0 && changed.length === 0 && after.used < before.used && cs.outItems === 0 && cs.inItems > 0),
    BASE_SHAPE: !!(anyDispose === 0 && listedLeft.length === JO_LISTED.length && changed.length === 0 && after.used === before.used) })
}
scenes.junkwell = () => junkWellScene('junkwell')
scenes.junkwelloff = () => junkWellScene('junkwelloff', { JUNK_VISIT: 'off', BAG_ALLOWANCE: 'off' })
// S2 (a fresh arena: NO well, so the bag's junk has no exit here and must stay out of the chest): 8 chests + 3 tables + a
// furnace + five usable stone pickaxes + torches, bone meal, junk, saplings, leaf litter. The candidate banks torch + bone
// meal (and the usable stone copies beyond the best + 2 once the town is counted); the stations stay (one stack each); no
// junk enters the chest. The base: a 21-slot bag gets no town deposit at all.
scenes.junkbank = async () => {
  buildArena(); BRAIN_WANDER = true; CAP = null
  rcon(`kill ${ARENA_SEL}`); CHEST = pickChest()
  const spec = [['chest', 8], ['crafting_table', 3], ['furnace', 1], ['stone_pickaxe', 1, 0], ['stone_pickaxe', 1, 10], ['stone_pickaxe', 1, 20], ['stone_pickaxe', 1, 30], ['stone_pickaxe', 1, 40],
    ['torch', 11], ['bone_meal', 30], ['egg', 6], ['flint', 4], ['oak_sapling', 12], ['leaf_litter', 10], ['cobblestone', 20], ['stick', 6]]
  const files = await startBot('junkbank', spec, { pool: `sbxstock-${RUN}-junkbank` })
  setChest([])
  const before = bag(NAME), chest0 = chestTotals()
  const bankRow = () => rowsOf(files.skillLog).find(r => r.name === '_junkout' && /^phase=bank /.test(r.detail))
  const bank = await waitFor(bankRow, 300000, 1000)
  await sleep(bank ? 8000 : 0)
  const after = bag(NAME), chest1 = chestTotals()
  const picks = b => b.totals.stone_pickaxe ?? 0   // one per copy (a tool does not stack); bag() reports totals only
  const tds = rowsOf(files.skillLog).filter(r => r.name === 'town_deposit').length
  // the town's count of stone pickaxes (row P banks only under the target, so a count must come first): the recount order's run
  const counted = rowsOf(files.skillLog).find(r => r.name === 'count_town' && r.status === 'success')
  await stopBot(); BRAIN_WANDER = false
  const junkIn = ['egg', 'flint', 'oak_sapling', 'leaf_litter'].filter(n => (chest1.totals[n] ?? 0) > (chest0.totals[n] ?? 0))
  const stationsLeft = ['chest', 'crafting_table', 'furnace'].map(n => [n, after.totals[n] ?? 0])
  // the BASE-owned stacks stay (a tail run banks the rows only: Claude code r1 P3-4)
  const baseChanged = unchanged(before, after, ['cobblestone', 'stick', 'egg', 'flint', 'oak_sapling', 'leaf_litter'])
  result({ scene: 'junkbank', root: BOT_ROOT, bag: { used: [before.used, after.used], before: before.totals, after: after.totals }, chest: { before: chest0.totals, after: chest1.totals },
    bankRow: bank ? bank.detail : null, townDeposits: tds, countedFirst: !!(counted && bank && counted.ts < bank.ts), picks: [picks(before), picks(after)], picksBanked: (chest1.totals.stone_pickaxe ?? 0) - (chest0.totals.stone_pickaxe ?? 0),
    junkIntoChest: junkIn, stationsLeft, baseChanged, rows: joRows(files).slice(0, 24),
    CANDIDATE_PASS: !!(bank && (chest1.totals.torch ?? 0) === 11 && (chest1.totals.bone_meal ?? 0) === 30 && junkIn.length === 0 &&
      stationsLeft.every(([, n]) => n >= 1) && baseChanged.length === 0 && picks(after) === 3 && (chest1.totals.stone_pickaxe ?? 0) - (chest0.totals.stone_pickaxe ?? 0) === 2 && after.used < before.used),
    BASE_SHAPE: !!(tds === 0 && chest1.used === 0 && after.used === before.used) })
}
// S3 (a fresh arena, a composter + a chest in town, peaceful): mushrooms, leaf litter and seeds go into the composter at a
// NOT-full visit; the saplings stay. The base: a 9-slot bag gets no compost order.
scenes.junkcompost = async () => {
  buildArena(); BRAIN_WANDER = true; CAP = null
  rcon(`kill ${ARENA_SEL}`, 'difficulty peaceful'); CHEST = pickChest(); setChest([])
  const COMP = [[-4, 4], [4, 4], [-4, -4], [0, -6], [6, 0], [-6, 0]].map(([dx, dz]) => ({ x: HOME.x + dx, y: HOME.y, z: HOME.z + dz }))
    .find(c => Math.hypot(c.x - CHEST.x, c.z - CHEST.z) >= 3)
  rcon(`setblock ${COMP.x} ${COMP.y} ${COMP.z} minecraft:composter`)
  // cooked_beef, not bread: the peaceful switch composts bread (peacefulkit.mjs PEACEFUL_COMPOST; Codex code r1 P2-4)
  const spec = [['brown_mushroom', 6], ['red_mushroom', 5], ['leaf_litter', 20], ['wheat_seeds', 7], ['oak_sapling', 20], ['spruce_sapling', 5], ['cobblestone', 20], ['cooked_beef', 3], ['stick', 4]]
  const files = await startBot('junkcompost', spec, { pool: `sbxstock-${RUN}-junkcompost` })
  const before = bag(NAME)
  const visitRow = () => rowsOf(files.skillLog).find(r => r.name === '_junkout' && /^phase=compost /.test(r.detail))
  const v = await waitFor(visitRow, 240000, 1000)
  await sleep(4000)
  const after = bag(NAME)
  const composts = rowsOf(files.skillLog).filter(r => r.name === 'compost').length
  await stopBot(); BRAIN_WANDER = false
  rcon(`setblock ${COMP.x} ${COMP.y} ${COMP.z} minecraft:air`)
  const gone = ['brown_mushroom', 'red_mushroom', 'leaf_litter', 'wheat_seeds'].filter(n => !(after.totals[n] ?? 0))
  const kept = unchanged(before, after, ['oak_sapling', 'spruce_sapling', 'cobblestone', 'cooked_beef', 'stick'])
  result({ scene: 'junkcompost', root: BOT_ROOT, peaceful: /peaceful/i.test(r1('difficulty')), bag: { used: [before.used, after.used], before: before.totals, after: after.totals },
    visitRow: v ? v.detail : null, compostRuns: composts, gone, otherChanged: kept, rows: joRows(files).slice(0, 20),
    CANDIDATE_PASS: !!(v && /status=success/.test(v.detail) && gone.length === 4 && kept.length === 0),
    BASE_SHAPE: !!(composts === 0 && gone.length === 0 && kept.length === 0) })
}

async function main () {
  const owner = process.env.LOCK_OWNER || 'stocktarget'   // OPERATOR OVERRIDE: the lock tag this run accepts (e.g. LOCK_OWNER=cobblekeep)
  sbx.requireSandboxLock(SERVER, owner)   // the global lock or this server's own (sandbox/lib/sbxlock.cjs); throws unless every lock on SERVER has our tag as its owner's first word
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
  for (const n of [NAME, NAME2]) { try { fs.unlinkSync(`${R}/sandbox/.env.stock-e2e-${n}`) } catch {} }
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
