// SANDBOX-ONLY end-to-end run of the BUILT junk well (bots/src/well.mjs + skills build_well / dispose_well), Paper sandbox.
// The REAL bot (src/index.mjs from <botRoot>, unmodified; trace.cjs only observes packets) runs its own deterministic town
// orders -- nothing is queued for the model (the loopback brain answers 'status'). A second, bare-mineflayer bot in THIS
// process is the walker / the "other player". Two node processes in all: this driver and the bot.
//
//   node sandbox/well/well-e2e.cjs <botRoot> <scene,scene,...> [server]
//   scenes: build  dispose  isolation  admission  creeper   (in that order: each later scene uses the well `build` made)
//
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -` (it reads the password itself, nothing
// secret here). Every RCON edit is on the sandbox arena only. The run refuses a non-sandbox server or bot name.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node well-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.WELL_REPO || path.resolve(__dirname, '../..')
const NAME = 'sandbox-Well', WALKER = 'sandbox-WWalk'
const OUT = process.env.WELL_OUT || `${R}/sandbox/log/well-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-wellab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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
const BRAIN_Q = []
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
    // a QUEUED line first (the coupling scenes' `deposit oak_log`): skill [item]
    if (BRAIN_Q.length) { const [skill, item] = BRAIN_Q.shift().split(/\s+/); decision = { skill, args: item ? { item } : {} }; res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox queue', saw_end: sentinel }) },
        done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 })); return }
    // the repeat-loop key buckets nearby gotos together (r5: two cells 2 apart read as 'identical 4x'): status and goto alternate
    if (BRAIN_WANDER && brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot () {
  try { bot && bot.kill('SIGTERM') } catch {}
  bot = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
let TRIAL_N = 0
async function startBot (scene, slotsSpec, { pool = `sbxwell-${RUN}`, root = BOT_ROOT } = {}) {
  // a repeated scene in one run gets its own logs (run 10-07: the second swordp read the first one's `skill dispose_well ->` line)
  const tag = `${RUN}-${scene}-${++TRIAL_N}`
  const logRel = `./sandbox/log/well-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/well-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`; const trace = `${OUT}/trace-${tag}.jsonl`
  const envRel = 'sandbox/.env.well-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/well-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  set('FOOD_SKIP', process.env.WELL_FOOD_SKIP || 'auto')   // junkwell-02 swords: the switch under test (default auto; WELL_FOOD_SKIP=on|off for Job 8)
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT: root, NODE_OPTIONS: `--require ${process.env.WELL_TRACE || path.join(R, 'sandbox/craft/trace.cjs')}`, CRAFT_TRACE: trace, TRACE_RCON_SERVER: process.env.WELL_TRACE ? SERVER : '' }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  // THE CHUNKS FIRST: an order read before the arena's chunks reach the client sees 'unknown' and (correctly) skips.
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`)
  await sleep(10000)
  const c = [`tp ${NAME} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`]
  let s = 0
  for (const [id, n] of slotsSpec) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(2500)
  return { skillLog, botOut, trace }
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
  // WELL_BUILD_SLOTS (default 36): a bag with free slots builds WITHOUT the pit-first toss -- the set-up for the coupling scenes
  // (10-07 22:06-22:47: the pit-first diorite toss missed 5 times running on BOTH 12440d9 and 5c13330, so no well was built)
  // WELL_BUILD_BAG=j7 (2a6214f): one dirt (the cover block; without one the build refuses no_cover) and fillers without
  // calcite (calcite ranks before dirt in PIT_COVER_BLOCKS, so a calcite filler would be the cover instead)
  const bagSpec = process.env.WELL_BUILD_BAG === 'j7'
    ? fill7([['oak_log', 3], ['egg', 16], ['egg', 16], ['flint', 64], ['dirt', 1]], Number(process.env.WELL_BUILD_SLOTS || 36))
    : fill([['oak_log', 3], ['egg', 16], ['egg', 16], ['flint', 64]], Number(process.env.WELL_BUILD_SLOTS || 36))
  // WELL_BUILD_ROOT: the build is set-up for the coupling scenes; it may come from another revision (12440d9's build failed
  // its pit-first toss on the sandbox 10-07: a diorite stack thrown that missed the pit, then well_no_room)
  const files = await startBot('build', bagSpec, { root: process.env.WELL_BUILD_ROOT || BOT_ROOT })
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

// ---------------------------------------------------------------- SWORDS (junkwell-02, 7c9bc2a..5c13330)
// The bot at town beside the well `build` made, 36/36: egg 16, flint 64, clay_ball 64, ink_sac 64 (listed junk, slots 0-3),
// stone_sword + wooden_sword (slots 4, 5), cobblestone 64, then stone x64 (never disposed) to 36. FOOD_SKIP=auto.
//   swordp  cand, peaceful            -> both swords thrown, swords=2 peaceful=1
//   sworde  cand, easy                -> swords kept (swords=0), the listed junk still thrown (the visit ran)
//   swordc  CTRL_ROOT, peaceful       -> no sword thrown (c6e91a8 has no junk well at all: no order is expected)
//   swordj  PRE_ROOT, peaceful        -> no sword thrown (junkwell-02 before the swords commit: the well runs, swords stay)
//   swordd  cand, peaceful -> `difficulty easy` the moment the first throw click is traced -> the remaining swords kept
const CTRL_ROOT = process.env.WELL_CTRL_ROOT || null
const PRE_ROOT = process.env.WELL_PRE_ROOT || null
function shaOf (root) { try { return fs.readFileSync(path.join(root, '.sha'), 'utf8').trim() } catch { return 'unknown' } }
function bagSlots (name) {
  const cmds = []; for (let s = 0; s < 36; s++) cmds.push(`data get entity ${name} Inventory[{Slot:${s}b}]`)
  const r = rcon(...cmds); const slots = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const totals = {}; for (const it of Object.values(slots)) totals[it.id] = (totals[it.id] || 0) + it.count
  const swords = Object.entries(slots).filter(([, it]) => /_sword$/.test(it.id)).map(([s, it]) => `${it.id}@${s}`)
  return { used: Object.keys(slots).length, totals, swords }
}
const swordSel = (base, id) => base.replace(/\]$/, `,nbt={Item:{id:"minecraft:${id}"}}]`)
function swordCensus (cap) {
  const ids = ['stone_sword', 'wooden_sword']
  const r = rcon(...ids.flatMap(id => [`execute if entity ${swordSel(shaftSel(cap), id)}`, `execute if entity ${swordSel(ARENA_SEL, id)}`]))
  const cnt = rep => Number(/count: (\d+)/.exec(rep || '')?.[1] ?? 0)
  const o = {}; ids.forEach((id, i) => { o[id] = { inShaft: cnt(r[2 * i]?.reply), inArena: cnt(r[2 * i + 1]?.reply) } })
  return o
}
// EVERY CHEST / BARREL in the arena (x/z 1297..1333, y 113..125), counted without touching them: a filtered clone into the
// empty sky above the forceloaded arena reports how many it copied; the copy is then cleared.
function containerCensus () {
  const out = {}
  for (const b of ['chest', 'trapped_chest', 'barrel']) {
    const rep = r1(`clone ${A.x0} 113 ${A.z0} ${A.x1} 125 ${A.z1} ${A.x0} 200 ${A.z0} filtered minecraft:${b}`)
    out[b] = /Successfully cloned (\d+)/.exec(rep)?.[1] != null ? Number(/Successfully cloned (\d+)/.exec(rep)[1]) : (/No blocks|0 block/i.test(rep) ? 0 : rep.slice(0, 80))
    rcon(`fill ${A.x0} 200 ${A.z0} ${A.x1} 212 ${A.z1} minecraft:air`, `kill @e[type=item,x=${A.x0},y=199,z=${A.z0},dx=${A.x1 - A.x0},dy=15,dz=${A.z1 - A.z0}]`)
  }
  return out
}
const SWORD_BAG = (() => { const b = [['egg', 16], ['flint', 64], ['clay_ball', 64], ['ink_sac', 64], ['stone_sword', 1], ['wooden_sword', 1], ['cobblestone', 64]]; while (b.length < 36) b.push(['stone', 64]); return b })()
async function swordScene (arm) {
  if (!CAP) throw new Error('no well (run build first)')
  const root = arm === 'c' ? CTRL_ROOT : arm === 'j' ? PRE_ROOT : BOT_ROOT
  if (!root) throw new Error(`no root for sword arm ${arm}`)
  const difficulty = arm === 'e' ? 'easy' : 'peaceful'
  rcon(`kill ${ARENA_SEL}`, `setblock ${CAP.x} ${CAP.y} ${CAP.z} minecraft:oak_trapdoor[half=top,open=false,facing=${FACING}]`, `difficulty ${difficulty}`)
  const files = await startBot(`sword${arm}`, SWORD_BAG, { root })
  const diffAtStart = r1('difficulty')
  const before = bagSlots(NAME)
  const marks = { arm, root: shaOf(root), difficulty, diffAtStart: diffAtStart.slice(0, 60) }
  let switcher = null
  if (arm === 'd') {
    // the switch: the first THROW click (mode 4) in the trace -> difficulty easy, at once
    switcher = (async () => {
      const t0 = Date.now()
      while (Date.now() - t0 < 200000) {
        const first = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).find(e => e && e.pkt === 'click' && e.mode === 4)
        if (first) { const tr = r1('difficulty easy'); marks.switched = { afterFirstThrowMs: Date.now() - first.ts, slot: first.slot, reply: tr.slice(0, 60) }; return }
        await sleep(25)
      }
    })()
  }
  const w = await watchOrder(files, 'dispose_well', arm === 'c' ? 120000 : 200000)
  if (switcher) await switcher
  await sleep(3000)
  const after = bagSlots(NAME)
  const cs = census(CAP), sw = swordCensus(CAP), boxes = containerCensus()
  const tr = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const throws = tr.filter(e => e.pkt === 'click' && e.mode === 4).map(e => ({ t: e.ts, slot: e.slot }))
  const allRows = rowsOf(files.skillLog)
  await stopBot()
  const diffEnd = r1('difficulty')
  rcon('difficulty peaceful')
  const t0 = throws[0]?.t ?? 0
  result({ scene: `sword${arm}`, marks, ended: w.ended?.slice(0, 200) ?? null, diffEnd: diffEnd.slice(0, 60),
    bag: { before: { used: before.used, swords: before.swords, totals: before.totals }, after: { used: after.used, swords: after.swords, totals: after.totals }, delta: deltaOf(before.totals, after.totals) },
    swordItems: sw, census: cs, containers: boxes, throws: throws.map(x => ({ dt: x.t - t0, slot: x.slot })),
    rows: allRows.filter(r => /well|_work_order|food_skip/.test(r.name)).map(r => `${r.name} ${r.status} ${r.detail.slice(0, 600)}`) })
}
// ---------------------------------------------------------------- COBBLE AT THE CAP -> THE WELL (stonecap x junkwell, 12440d9)
// A town chest (in town, >= 4 from the well) holding `town` cobble and a composter; a FRESH pool per trial (empty cobble
// journal). The bot (31 slots: cobblestone 30 + 64 + 64, egg 16, flint 64, oak_log 5, a stone_pickaxe, stone x64) is queued
// `deposit oak_log` (the deposit counts the town chest first: reconcile), then given 4 stacks of stone (-> 34 slots) and the
// dispose_well order WATCHED. W4: the town at 300 when planned; the moment the first cobble THROW click is traced, a lower
// count (200) of the chest is appended to the journal (a recount by another bot), so the second cobble click must not go.
//   W1 cand, town 280 -> the 30 and one 64 thrown, 64 left, `cobble=94 cobble_left=64 cap=at_cap`; chest unchanged
//   W2 cand, town 250 -> no cobble thrown (cobble=0), egg/flint thrown
//   W3 CTRL_ROOT (5c13330, no cap), town 280 -> no cobble thrown
//   W4 cand, town 300, lowered to 200 after the first cobble click -> the second cobble stack stays
const cobN = n => { const o = []; while (n > 0) { o.push(['cobblestone', Math.min(64, n)]); n -= 64 } return o }
const W_BAG = (() => { const b = [['cobblestone', 30], ['cobblestone', 64], ['cobblestone', 64], ['egg', 16], ['flint', 64], ['oak_log', 5], ['stone_pickaxe', 1]]; while (b.length < 31) b.push(['stone', 64]); return b })()
function chestRead (c) {
  const r = rcon(...Array.from({ length: 27 }, (_, s) => `data get block ${c.x} ${c.y} ${c.z} Items[{Slot:${s}b}]`))
  const slots = {}; for (let s = 0; s < 27; s++) { const it = /has the following block data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const totals = {}; for (const it of Object.values(slots)) totals[it.id] = (totals[it.id] || 0) + it.count
  return totals
}
function cobbleItems (cap) {
  const r = rcon(`execute if entity ${swordSel(shaftSel(cap), 'cobblestone')}`, `execute if entity ${swordSel(ARENA_SEL, 'cobblestone')}`,
    'scoreboard objectives add wcc dummy', `execute as ${swordSel(ARENA_SEL, 'cobblestone')} store result score @s wcc run data get entity @s Item.count`,
    'scoreboard players set #s wcc 0', 'scoreboard players set #a wcc 0',
    `scoreboard players operation #s wcc += ${swordSel(shaftSel(cap), 'cobblestone')} wcc`, `scoreboard players operation #a wcc += ${swordSel(ARENA_SEL, 'cobblestone')} wcc`,
    'scoreboard players get #s wcc', 'scoreboard players get #a wcc')
  const cnt = rep => Number(/count: (\d+)/.exec(rep || '')?.[1] ?? 0)
  return { shaftEntities: cnt(r[0]?.reply), arenaEntities: cnt(r[1]?.reply), shaftItems: has(r[8]?.reply), arenaItems: has(r[9]?.reply) }
}
async function wellCobbleScene (name, { town, root = BOT_ROOT, lowerTo = null }) {
  if (!CAP) throw new Error('no well (run build first)')
  const far = (p, q, d) => Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z)) >= d
  const spots = [[-6, -6], [6, 6], [-6, 6], [6, -6], [-8, 0], [8, 0], [0, -8], [0, 8]].map(([dx, dz]) => ({ x: HOME.x + dx, y: HOME.y, z: HOME.z + dz }))
  const CH = spots.find(p => far(p, CAP, 4)); const CO = spots.find(p => p !== CH && far(p, CAP, 4) && far(p, CH, 3))
  const setup = rcon(`kill ${ARENA_SEL}`, `setblock ${CAP.x} ${CAP.y} ${CAP.z} minecraft:oak_trapdoor[half=top,open=false,facing=${FACING}]`, 'difficulty peaceful',
    `setblock ${CO.x} ${CO.y} ${CO.z} minecraft:composter`, `setblock ${CH.x} ${CH.y} ${CH.z} minecraft:chest[facing=north]`,
    ...cobN(town).map(([id, n], s) => `item replace block ${CH.x} ${CH.y} ${CH.z} container.${s} with minecraft:${id} ${n}`))
  const pool = `sbxwell-${RUN}-${name}`
  const poolDir = path.join(R, 'sandbox/state', `_pool-${pool}`)
  const journal = path.join(poolDir, `town-chest-${HOME.x}_${HOME.y}_${HOME.z}.cobble.jsonl`)
  const marks = { name, root: shaOf(root), town, chest: CH, composter: CO, poolExisted: fs.existsSync(poolDir), setupBad: setup.filter(x => /Cannot|Unknown|Incorrect|not loaded/i.test(x.reply)).map(x => x.cmd + ' => ' + x.reply) }
  const files = await startBot(name, W_BAG, { root, pool })
  const before = bagSlots(NAME), chestBefore = chestRead(CH)
  // 1) the deposit that counts the town (and banks the logs)
  const nDep = () => lines(files.botOut).filter(l => /skill deposit ->|rejected why=.*"skill":"deposit"/.test(l)).length
  BRAIN_Q.push('deposit oak_log')
  marks.depositEnded = !!await waitFor(() => nDep() >= 1, 200000, 500)
  await sleep(2000)
  const mid = bagSlots(NAME), chestMid = chestRead(CH)
  const journalAfterCount = lines(journal).length
  // 2) to 34+ slots: four stacks of stone
  marks.give = r1(`give ${NAME} minecraft:stone 256`).slice(0, 80)
  await sleep(1500)
  marks.slotsAtGive = bagSlots(NAME).used
  let lowering = null
  if (lowerTo != null) {
    lowering = (async () => {
      const t0 = Date.now()
      while (Date.now() - t0 < 230000) {
        const first = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).find(e => e && e.pkt === 'click' && e.mode === 4)
        if (first) {
          const recs = lines(journal).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
          const w = [...recs].reverse().find(x => 'w' in x)?.w ?? null
          const now = Date.now()
          const rec = { inst: `${now}-99999-sbxw4`, t: 'cnt', k: `${CH.x},${CH.y},${CH.z}`, n: lowerTo, cap: now, at: now, bot: 'sandbox-W4Other', ids: [], w }
          fs.appendFileSync(journal, '\n' + JSON.stringify(rec) + '\n')
          marks.lowered = { afterFirstThrowMs: now - first.ts, firstSlot: first.slot, rec }
          return
        }
        await sleep(20)
      }
    })()
  }
  const w = await watchOrder(files, 'dispose_well', 230000)
  if (lowering) await lowering
  await sleep(3000)
  const after = bagSlots(NAME), chestAfter = chestRead(CH), cob = cobbleItems(CAP), cs = census(CAP)
  const tr = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const throws = tr.filter(e => e.pkt === 'click' && e.mode === 4).map(e => e.slot)
  const allRows = rowsOf(files.skillLog)
  await stopBot()
  rcon(`setblock ${CH.x} ${CH.y} ${CH.z} minecraft:air`, `setblock ${CO.x} ${CO.y} ${CO.z} minecraft:air`, `kill ${ARENA_SEL}`)
  const jl = lines(journal)
  result({ scene: name, marks, ended: w.ended?.slice(0, 200) ?? null,
    bag: { before: before.totals, beforeUsed: before.used, mid: mid.totals, after: after.totals, afterUsed: after.used, delta: deltaOf(mid.totals, after.totals) },
    chest: { before: chestBefore, mid: chestMid, after: chestAfter }, cobbleItems: cob, census: cs, throwSlots: throws,
    journal: { lines: jl.length, afterCount: journalAfterCount, tail: jl.slice(-10).map(l => l.slice(0, 400)) },
    rows: allRows.filter(r => /well|_work_order|cobble|^deposit$/.test(r.name)).map(r => `${r.name} ${r.status} ${r.detail.slice(0, 700)}`) })
}
scenes.W1 = () => wellCobbleScene('W1', { town: 280 })
scenes.W2 = () => wellCobbleScene('W2', { town: 250 })
scenes.W3 = () => wellCobbleScene('W3', { town: 280, root: CTRL_ROOT })
scenes.W4 = () => wellCobbleScene('W4', { town: 300, lowerTo: 200 })
// ---------------------------------------------------------------- THE ABANDONED BUILD (88e4bb4: a pit is filled back to ground)
// The pit-first build scene (36/36, fresh site); the moment the trace shows the SHAFT dig finish (block_dig status 2 at
// y = site.y - 1), one disturbance:
//   abandonA  `clear` the bag's logs and planks (the trapdoor chain cannot be crafted)
//   abandonB  a second player (the walker, bare mineflayer) is teleported 2 east of the site (well_attended)
//   abandonC  `damage <bot> 14` (health 20 -> 6 < FLEE_BELOW_HEALTH 8): the low_health reflex aborts the skill
//   abandonK  SIGKILL of the bot process (no finally can run: what is left)
// Then the site's cells (y-2 .. y) read by block name, every row of the build, the bag before/after, the arena's items.
const SITE_NAMES = ['air', 'dirt', 'coarse_dirt', 'andesite', 'diorite', 'granite', 'calcite', 'tuff', 'cobblestone', 'stone', 'oak_trapdoor', 'oak_planks', 'crafting_table']
function blockName (x, y, z) {
  const r = rcon(...SITE_NAMES.map(n => `execute if block ${x} ${y} ${z} minecraft:${n}`))
  const i = r.findIndex(q => passed(q.reply)); return i >= 0 ? SITE_NAMES[i] : 'other'
}
function itemList () {
  const r = r1(`execute as ${ARENA_SEL} run data get entity @s Item`)
  return r.split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean).map(it => `${it.id}x${it.count}`)
}
async function abandonScene (kind) {
  buildArena()
  const site = W.canonicalWellSite({ home: HOME, read: arenaRead }).site
  if (kind === 'B') { await walkerJoin(); await tpWalker(site.x + 14.5, G + 1, site.z + 0.5) }
  const bagSpec = fill([['oak_log', 3], ['egg', 16], ['egg', 16], ['flint', 64]])
  const files = await startBot(`abandon${kind}`, bagSpec)
  const before = bagSlots(NAME)
  const marks = { kind, site }
  const t0 = Date.now()
  let fired = null
  while (Date.now() - t0 < 200000 && !fired) {
    const ev = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const dig = ev.find(e => e.pkt === 'dig' && e.status === 2 && e.loc?.y === site.y - 1 && e.loc?.x === site.x && e.loc?.z === site.z)
    if (dig) {
      if (kind === 'A') marks.action = rcon(`clear ${NAME} #minecraft:logs`, `clear ${NAME} #minecraft:planks`).map(x => x.reply.slice(0, 80))
      else if (kind === 'B') { await tpWalker(site.x + 2.5, G + 1, site.z + 0.5); marks.action = 'walker 2 east of the site' }
      else if (kind === 'C') marks.action = r1(`damage ${NAME} 14`).slice(0, 80)
      else if (kind === 'K') { try { bot.kill('SIGKILL') } catch {} bot = null; marks.action = 'SIGKILL' }
      fired = { afterDigMs: Date.now() - dig.ts }
    }
    if (lines(files.botOut).some(l => /skill build_well ->/.test(l))) break
    await sleep(20)
  }
  marks.fired = fired
  if (kind !== 'K') await waitFor(() => lines(files.botOut).some(l => /skill build_well ->/.test(l)), 120000, 500)
  await sleep(kind === 'K' ? 8000 : 5000)
  const cells = {}; for (const dy of [-2, -1, 0]) cells[site.y + dy] = blockName(site.x, site.y + dy, site.z)
  const after = kind === 'K' ? null : bagSlots(NAME)
  const ground = itemList()
  const rows = rowsOf(files.skillLog).filter(r => /well|_work_order|reflex|low_health|abort|build/.test(r.name)).map(r => `${r.name} ${r.status} ${r.detail.slice(0, 400)}`)
  const ended = lines(files.botOut).find(l => /skill build_well ->/.test(l)) ?? null
  await stopBot()
  if (kind === 'B') { await tpWalker(site.x + 14.5, G + 1, site.z + 0.5); await walkerLeave() }
  const afterLogout = kind === 'K' ? bagSlots(NAME) : null   // offline: reads nothing (logged out); kept for the record
  result({ scene: `abandon${kind}`, marks, ended: ended?.slice(0, 260), cells, bag: { before: before.totals, after: after?.totals ?? null, delta: after ? deltaOf(before.totals, after.totals) : null },
    ground, rows, afterLogoutUsed: afterLogout?.used ?? null })
}
// ---------------------------------------------------------------- JOB 7 (2a6214f): the pit COVER, a visitor's close_well
const ROCKS7 = ['andesite', 'diorite', 'granite']
function fill7 (spec, n = 36) { const out = [...spec]; let i = 0; while (out.length < n) out.push([ROCKS7[i++ % ROCKS7.length], 64]); return out }
// THE VISITOR: a second REAL bot (sandbox-WellB, the same build, the same pool -> the same recorded site), its own process
const VNAME = 'sandbox-WellB'
let botB = null
async function startVisitor (scene, slotsSpec, { pool = `sbxwell-${RUN}`, root = BOT_ROOT, at = null } = {}) {
  const tag = `${RUN}-${scene}-B-${++TRIAL_N}`
  const logRel = `./sandbox/log/well-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/well-e2e/${tag}/skill-${VNAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`; const trace = `${OUT}/trace-${tag}.jsonl`
  const envRel = 'sandbox/.env.well-e2e-B'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', VNAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/well-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  set('FOOD_SKIP', 'auto')
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  botB = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT: root, NODE_OPTIONS: `--require ${process.env.WELL_TRACE || path.join(R, 'sandbox/craft/trace.cjs')}`, CRAFT_TRACE: trace, TRACE_RCON_SERVER: process.env.WELL_TRACE ? SERVER : '' }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopVisitor(); throw new Error('visitor: no spawn') }
  const p = at ?? { x: HOME.x + 0.5, y: HOME.y, z: HOME.z + 0.5 }
  rcon(`gamemode survival ${VNAME}`, `clear ${VNAME}`, `tp ${VNAME} ${p.x} ${p.y} ${p.z}`)
  let s = 0; rcon(...slotsSpec.map(([id, n]) => `item replace entity ${VNAME} container.${s++} with minecraft:${id} ${n}`))
  return { skillLog, botOut, trace, tag }
}
async function stopVisitor () {
  try { botB && botB.kill('SIGTERM') } catch {}
  botB = null
  await waitFor(() => !new RegExp(VNAME).test(r1('list')), 30000, 1000)
}
const VISITOR_BAG = [['dirt', 1], ['andesite', 64], ['diorite', 64], ['stone_pickaxe', 1]]   // a cover block, no wood, 4 slots
// the site census: the cap cell and the shaft cell by name, the items in the shaft column vs everywhere else in the arena
function siteCensus (site) {
  const cs = census(site)
  return { cap: blockName(site.x, site.y, site.z), shaft: blockName(site.x, site.y - 1, site.z), floor: blockName(site.x, site.y - 2, site.z),
    itemsInShaft: cs.inItems, itemsOutside: cs.outItems, entInShaft: cs.inEnt, entAll: cs.allEnt, ground: itemList() }
}
const rowsWell = f => rowsOf(f).filter(r => /well|_work_order|reflex|low_health/.test(r.name))
const rowStr = r => `${new Date(r.ts).toISOString().slice(11, 23)} ${r.name} ${r.status} ${r.detail.slice(0, 420)}`
const BAG7 = () => fill7([['oak_log', 3], ['egg', 16], ['egg', 16], ['flint', 64], ['dirt', 1], ['cobblestone', 64]])
async function waitTrace (file, pred, ms = 200000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) {
    const ev = lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const hit = ev.find(pred); if (hit) return hit
    await sleep(20)
  }
  return null
}
const SITE7 = () => W.canonicalWellSite({ home: HOME, read: arenaRead }).site
let SITE_A7 = null   // the site (a) covered, for (e)
// (a) GIVE-UP AFTER THE DIG: at the first THROW click (the pit is dug, a stack is in the air), the bag's logs, planks,
//     crafting tables and trapdoors are cleared -> the build cannot finish and covers its own pit (by=build)
scenes.j7a = async () => {
  buildArena()
  const site = SITE7(); SITE_A7 = site
  const files = await startBot('j7a', BAG7())
  const before = bagSlots(NAME)
  const thr = await waitTrace(files.trace, e => e.pkt === 'click' && e.mode === 4)
  const cleared = thr ? rcon(`clear ${NAME} #minecraft:logs`, `clear ${NAME} #minecraft:planks`, `clear ${NAME} minecraft:crafting_table`, `clear ${NAME} #minecraft:wooden_trapdoors`).map(x => x.reply.trim().slice(0, 60)) : null
  await waitFor(() => lines(files.botOut).some(l => /skill build_well ->/.test(l)), 120000, 300)
  const tEnd = Date.now()
  await sleep(2000); const c2 = siteCensus(site)
  const after = bagSlots(NAME)
  await sleep(Math.max(0, 30000 - (Date.now() - tEnd))); const c30 = siteCensus(site)
  const rows = rowsWell(files.skillLog).map(rowStr)
  await stopBot()
  result({ scene: 'j7a', site, clearedAtThrowMs: thr ? Date.now() - thr.ts : null, cleared, ended: lines(files.botOut).find(l => /skill build_well ->/.test(l))?.slice(0, 300),
    census2s: c2, census30s: c30, bag: { before: before.totals, after: after.totals, delta: deltaOf(before.totals, after.totals) }, rows })
}
// (e) RESUME on (a)'s covered pit (no arena reset): a fresh build digs the cover out and finishes; (a)'s items stay contained
scenes.j7e = async () => {
  const site = SITE_A7 ?? SITE7()
  const c0 = siteCensus(site)
  const files = await startBot('j7e', BAG7())
  const before = bagSlots(NAME)
  await waitFor(() => lines(files.botOut).some(l => /skill build_well ->/.test(l)), 240000, 500)
  await sleep(3000)
  const c1 = siteCensus(site)
  const after = bagSlots(NAME)
  const rows = rowsWell(files.skillLog).map(rowStr)
  const blocks = wellBlocks(site, 'north')
  await stopBot()
  result({ scene: 'j7e', site, censusBefore: c0, censusAfter: c1, blocks, ended: lines(files.botOut).find(l => /skill build_well ->/.test(l))?.slice(0, 300),
    bag: { delta: deltaOf(before.totals, after.totals) }, rows })
}
// (b) ABORT BY DAMAGE right after the shaft dig, then A logs out; B (the visitor) comes to town and covers it
// (k) PROCESS KILL right after the shaft dig, then the visitor
async function abortThenVisitor (kind) {
  buildArena()
  const site = SITE7()
  const files = await startBot(`j7${kind}`, BAG7())
  const dig = await waitTrace(files.trace, e => e.pkt === 'dig' && e.status === 2 && e.loc?.y === site.y - 1 && e.loc?.x === site.x && e.loc?.z === site.z)
  let tAbort = null, act = null
  if (dig) {
    if (kind === 'b') act = r1(`damage ${NAME} 14`).trim().slice(0, 60)
    else { try { bot.kill('SIGKILL') } catch {} act = 'SIGKILL' }
    tAbort = Date.now()
  }
  if (kind === 'b') await waitFor(() => lines(files.botOut).some(l => /skill build_well ->/.test(l)), 60000, 200)
  await sleep(1500)
  const rowsA = rowsWell(files.skillLog).map(rowStr)
  const cA = siteCensus(site)
  if (kind === 'b') await stopBot(); else { bot = null; await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000) }
  const tA = Date.now()
  const vis = await startVisitor(`j7${kind}`, VISITOR_BAG)
  const covered = await waitFor(() => rowsOf(vis.skillLog).find(r => r.name === '_well_pit_covered'), 150000, 500)
  await sleep(2000)
  const cB = siteCensus(site)
  const rowsB = rowsWell(vis.skillLog).map(rowStr)
  await stopVisitor()
  result({ scene: `j7${kind}`, site, action: act, abortAfterDigMs: dig && tAbort ? tAbort - dig.ts : null, endedA: lines(files.botOut).find(l => /skill build_well ->/.test(l))?.slice(0, 260) ?? null,
    rowsA, censusAfterA: cA, visitorJoinedAfterAbortMs: tA - (tAbort ?? tA), coverAfterAbortMs: covered && tAbort ? covered.ts - tAbort : null, rowsB, censusAfterB: cB })
}
scenes.j7b = () => abortThenVisitor('b')
scenes.j7k = () => abortThenVisitor('k')
// (d) THE RACE: B is online but parked OUTSIDE town (60 east of home); at A's shaft dig B is teleported into town, 8 from
//     the site (outside the admission radius, 5), holding a cover block, while A is on the stand with the pit open
scenes.j7d = async () => {
  buildArena()
  const site = SITE7()
  // a floor for B out there (TOWN_RADIUS 48), its chunks forceloaded so the fill lands before B does
  rcon(`forceload add ${HOME.x + 56} ${HOME.z - 4} ${HOME.x + 64} ${HOME.z + 4}`, `fill ${HOME.x + 56} 119 ${HOME.z - 4} ${HOME.x + 64} 119 ${HOME.z + 4} minecraft:dirt`)
  const vis = await startVisitor('j7d', VISITOR_BAG, { at: { x: HOME.x + 60.5, y: 120, z: HOME.z + 0.5 } })
  const files = await startBot('j7d', BAG7())
  const dig = await waitTrace(files.trace, e => e.pkt === 'dig' && e.status === 2 && e.loc?.y === site.y - 1 && e.loc?.x === site.x && e.loc?.z === site.z)
  if (dig) rcon(`tp ${VNAME} ${site.x - 7.5} ${G + 1} ${site.z + 0.5}`)
  const samples = []
  for (const t0 = Date.now(); Date.now() - t0 < 40000;) {
    samples.push({ t: Date.now() - (dig?.ts ?? t0), cap: blockName(site.x, site.y, site.z) })
    if (lines(files.botOut).some(l => /skill build_well ->/.test(l)) && Date.now() - t0 > 20000) break
    await sleep(1500)
  }
  const rowsA = rowsWell(files.skillLog).map(rowStr), rowsB = rowsWell(vis.skillLog).map(rowStr)
  const ordersB = lines(vis.botOut).filter(l => /close_well/.test(l)).map(l => l.slice(0, 220))
  await stopBot(); await stopVisitor()
  rcon(`fill ${HOME.x + 56} 119 ${HOME.z - 4} ${HOME.x + 64} 119 ${HOME.z + 4} minecraft:air`, `forceload remove ${HOME.x + 56} ${HOME.z - 4} ${HOME.x + 64} ${HOME.z + 4}`)
  result({ scene: 'j7d', site, tpAtDig: !!dig, endedA: lines(files.botOut).find(l => /skill build_well ->/.test(l))?.slice(0, 260) ?? null,
    capSamples: samples.map(s => `${(s.t / 1000).toFixed(1)}s:${s.cap}`), rowsA, rowsB, ordersB })
}
// (f) NO COVER BLOCK: no dirt/stone, exactly 64 cobblestone (the reserve): skip no_cover, no walk, no dig
scenes.j7f = async () => {
  buildArena()
  const site = SITE7()
  const files = await startBot('j7f', fill7([['oak_log', 3], ['egg', 16], ['egg', 16], ['flint', 64], ['cobblestone', 64]]))
  const p0 = r1(`data get entity ${NAME} Pos`)
  await sleep(90000)
  const p1 = r1(`data get entity ${NAME} Pos`)
  const rows = rowsWell(files.skillLog).map(rowStr)
  const tr = lines(files.trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const cells = siteCensus(site)
  const out = lines(files.botOut).filter(l => /build_well|well/.test(l)).map(l => l.slice(0, 240)).slice(0, 12)
  await stopBot()
  result({ scene: 'j7f', site, pos0: p0.replace(/.*data: /, ''), pos90: p1.replace(/.*data: /, ''), digs: tr.filter(e => e.pkt === 'dig').length, cells, rows, out })
}
scenes.abandonA = () => abandonScene('A')
scenes.abandonB = () => abandonScene('B')
scenes.abandonC = () => abandonScene('C')
scenes.abandonK = () => abandonScene('K')
scenes.swordp = () => swordScene('p')
scenes.sworde = () => swordScene('e')
scenes.swordc = () => swordScene('c')
scenes.swordj = () => swordScene('j')
scenes.swordd = () => swordScene('d')

async function main () {
  W = await import(path.join(BOT_ROOT, 'bots/src/well.mjs'))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} sha=${shaOf(BOT_ROOT)} ctrl=${CTRL_ROOT ? shaOf(CTRL_ROOT) : '-'} pre=${PRE_ROOT ? shaOf(PRE_ROOT) : '-'} server=${SERVER} scenes=${SCENES_S}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  P('difficulty at start', r1('difficulty'), '->', r1('difficulty peaceful'))
  for (const s of SCENES_S.split(',')) { P('=== scene', s); await scenes[s]() }
}
async function cleanup () {
  await stopBot().catch(() => {}); await stopVisitor().catch(() => {}); await walkerLeave().catch(() => {})
  try { fs.unlinkSync(`${R}/sandbox/.env.well-e2e-B`) } catch {}
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.well-e2e`) } catch {}
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
