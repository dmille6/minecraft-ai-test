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
  return { name, boundingBox: name === 'air' ? 'empty' : 'block', hardness: name === 'air' ? 0 : 0.5, props: null }
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

const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill: 'status', args: {}, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot () {
  try { bot && bot.kill('SIGTERM') } catch {}
  bot = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
async function startBot (tag, slotsSpec, { pool = 'sbxwell' } = {}) {
  const logRel = `./sandbox/log/well-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/well-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`; const trace = `${OUT}/trace-${tag}.jsonl`
  const envRel = 'sandbox/.env.well-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/well-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(R, 'sandbox/craft/trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  const c = [`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`]
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
  if (!CAP) throw new Error('no well')
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

async function main () {
  W = await import(path.join(BOT_ROOT, 'bots/src/well.mjs'))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} sha=${execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()} server=${SERVER} scenes=${SCENES_S}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  for (const s of SCENES_S.split(',')) { P('=== scene', s); await scenes[s]() }
}
async function cleanup () {
  await stopBot().catch(() => {}); await walkerLeave().catch(() => {})
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
