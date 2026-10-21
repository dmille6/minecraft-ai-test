// SANDBOX-ONLY end-to-end proof of THE TOWN PLAN (townplan-01) and FOUNDING (found-01). Build spec
// docs/reports/townplan-found-spec-2026-10-21.md section 3. Derived from sandbox/well/stock-e2e.cjs (its arena, its RCON, its
// loopback brain, its startBot). The REAL bot (src/index.mjs from <botRoot>, unmodified) runs its own planner tick and its own
// deterministic town orders; the scene reads back the SERVER (every plan cell, every pre-existing block, every container's
// items) and the plan files the bots wrote.
//
//   WELL_REPO=<checkout with sandbox/run-bot.sh> LOCK_OWNER=townplan node sandbox/townplan/townplan-e2e.cjs <botRoot> <scenes> [server]
//   scenes:
//     tpgreen    TP-GREEN  a bare flat town, one bot carrying nothing to found with: the root plan is greenfield, every plan cell
//                          is air over a solid floor on the server, inside the ground, and its stands are reachable cells
//     tpretro    TP-RETRO + TP-ZONES  a bench-like town (6 chests with items, a table and a furnace, a dirt wall) and a
//                          protected zone over its north side: the root plan is retrofit, NO plan cell is in the zone or on a
//                          pre-existing block, and after the run every pre-existing block and every container's items are
//                          exactly as set (nothing torn down, every container still usable: its lid cell air)
//     foundbare  FOUND-BARE + FOUND-HOUR1  the bare town, THREE bots each with 16 oak logs and 32 cobblestone (one found order per
//                          bot per visit): the workshop table goes in station 0, the town's first chest in the overflow cell, the
//                          furnace in station 1 -- read back on the server, and the plan says each is `placed`
//     foundretro FOUND-RETRO the bench town (no zone), two bots with logs and cobble: the new table and furnace go into the
//                          retrofit workshop's station cells; every pre-existing block and item unchanged
//   Each scene prints CANDIDATE_PASS (the built shape) and BASE_SHAPE (the base: no plan, no found rows, nothing placed).
//
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -` (ports 25599-25602). Sandbox servers and sandbox-*
// names only. Refuses to run unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names LOCK_OWNER (default townplan).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node townplan-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.WELL_REPO || path.resolve(__dirname, '../..')
const NAMES = ['sandbox-Plan', 'sandbox-Plan2', 'sandbox-Plan3']
const OUT = process.env.WELL_OUT || `${R}/sandbox/log/townplan-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-townplan-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = []
  for (let i = 0; i < cmds.length; i += 200) {   // bounded batches: one ssh per 200 commands
    const o = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.slice(i, i + 200).join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
    let cur = null
    for (const line of o.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; out.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  }
  return out
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')

// ---------------------------------------------------------------- the arena: a dirt slab 7 deep at y 113..119, +-24 of home
// (FIT_R 20 and the store pad's u 15 fit inside it; outside it is air: never READY)
const HOME = { x: 1515, y: 120, z: 1515 }
const A = { x0: HOME.x - 24, x1: HOME.x + 24, z0: HOME.z - 24, z1: HOME.z + 24 }
const G = 119
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=40,dz=${A.z1 - A.z0}]`,
    `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
    `fill ${A.x0} 113 ${A.z0} ${A.x1} ${G} ${A.z1} minecraft:dirt`]
  const r = rcon(...c)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
const ARENA_SEL = `@e[type=item,x=${A.x0},y=105,z=${A.z0},dx=${A.x1 - A.x0},dy=30,dz=${A.z1 - A.z0}]`
const parseItem = seg => { const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; return id ? { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) } : null }
function chestTotals (at) {
  const cmds = []; for (let s = 0; s < 27; s++) cmds.push(`data get block ${at.x} ${at.y} ${at.z} Items[{Slot:${s}b}]`)
  const r = rcon(...cmds); const t = {}
  for (let s = 0; s < 27; s++) { const it = /has the following block data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) t[it.id] = (t[it.id] || 0) + it.count }
  return t
}
/** the block NAME at each cell (one `execute if block` per candidate; small replies only) */
function blockIs (cells, name) { return rcon(...cells.map(([x, y, z]) => `execute if block ${x} ${y} ${z} minecraft:${name}`)).map(x => passed(x.reply)) }
function countIn (name, y = HOME.y, r = 22) {
  const cells = []; for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) cells.push([HOME.x + dx, y, HOME.z + dz])
  const hit = blockIs(cells, name)
  return cells.filter((_, i) => hit[i])
}

// ---------------------------------------------------------------- the bot and its logs
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// the loopback brain: short walks WEST of home (away from every orientation's E-first store pad), never `status` for ever
// (the livelock breaker relocates the bot off the arena)
let brainN = 0
const WANDER = [{ x: HOME.x - 4, y: HOME.y, z: HOME.z - 1 }, { x: HOME.x - 5, y: HOME.y, z: HOME.z + 1 }]
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    if (brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const procs = {}
async function stopBots () {
  for (const [n, p] of Object.entries(procs)) { try { p.kill('SIGTERM') } catch {} delete procs[n] }
  await waitFor(() => !/sandbox-Plan/.test(r1('list')), 30000, 1000)
}
async function startBot (scene, slotsSpec, { pool, name = NAMES[0], at = HOME, onSpawn = null } = {}) {
  const tag = `${RUN}-${scene}-${name}`
  const logRel = `./sandbox/log/townplan-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/townplan-e2e/${tag}/skill-${name}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`
  const envRel = `sandbox/.env.townplan-e2e-${name}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', name); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/townplan-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  const proc = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  procs[name] = proc
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBots(); throw new Error('no spawn ' + name) }
  rcon(`gamemode survival ${name}`, `clear ${name}`, `tp ${name} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`)
  await sleep(8000)
  const poolDir = path.join(R, 'sandbox/state', `_pool-${pool}`)
  if (onSpawn) await onSpawn({ skillLog, poolDir })
  const c = [`tp ${name} ${at.x + 0.5} ${at.y} ${at.z + 0.5}`]
  let s = 0
  for (const [id, n] of slotsSpec) c.push(`item replace entity ${name} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(1500)
  return { skillLog, botOut, name, pool, poolDir }
}
const worldOf = async skillLog => {
  const row = await waitFor(() => rowsOf(skillLog).find(r => r.name === '_plinth_mode'), 30000, 250)
  const w = ((row?.detail ?? '').match(/ w=(\S+)/) || [])[1] ?? null
  if (!w || w === '-') throw new Error('no world identity in the bot\'s _plinth_mode row')
  return w
}
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), root: BOT_ROOT, ...r }) + '\n'); P('RESULT', r) }
const rowsAll = files => files.flatMap(f => rowsOf(f.skillLog).map(r => ({ ...r, bot: f.name }))).sort((a, b) => a.ts - b.ts)
const fmt = r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.bot ?? ''} ${r.name} ${r.status} ${r.detail.slice(0, 200)}`

// ---------------------------------------------------------------- the plan, as the bots wrote it (the build's own walk)
async function planOf (poolDir, world) {
  try {
    const PS = await import(path.join(BOT_ROOT, 'bots/src/planstore.mjs'))
    const key = PS.planKey({ x: HOME.x, y: HOME.y, z: HOME.z })
    const h = PS.planHead(poolDir, key, world, { fresh: true })
    const files = fs.existsSync(poolDir) ? fs.readdirSync(poolDir).filter(f => f.startsWith(key + '.g')) : []
    return { ok: h.ok, head: h.head ?? null, gens: files.length, rejected: (h.rejected ?? []).length }
  } catch (e) { return { ok: false, head: null, gens: 0, err: String(e.message).slice(0, 120) } }
}
const cellsOf = plan => (plan?.plots ?? []).flatMap(p => [...(p.cells ?? []), ...(p.stations ?? [])].map(c => ({ ...c, plot: p.id })))
const inArena = ([x, , z]) => x >= A.x0 && x <= A.x1 && z >= A.z0 && z <= A.z1

// ---------------------------------------------------------------- the bench-like town (TP-RETRO, FOUND-RETRO)
// six single chests two apart east of home with items; a table and a furnace south-west; a 5-long dirt wall (a structure)
const BENCH = {
  chests: [[3, 3, [['cobblestone', 64], ['cobblestone', 20]]], [5, 3, [['oak_log', 30]]], [7, 3, [['dirt', 64]]],
           [3, -3, [['iron_ingot', 5], ['coal', 12]]], [5, -3, [['oak_sapling', 9]]], [7, -3, [['stick', 20], ['oak_planks', 16]]]],
  table: [-3, 3], furnace: [-3, 5],
  wall: [[-6, -6], [-5, -6], [-4, -6], [-3, -6], [-2, -6]],
}
const at = ([dx, dz], dy = 0) => ({ x: HOME.x + dx, y: HOME.y + dy, z: HOME.z + dz })
function buildBench () {
  const c = []
  for (const [dx, dz, stacks] of BENCH.chests) {
    const p = at([dx, dz])
    c.push(`setblock ${p.x} ${p.y} ${p.z} minecraft:chest[facing=north,type=single]`)
    stacks.forEach(([id, n], i) => c.push(`item replace block ${p.x} ${p.y} ${p.z} container.${i} with minecraft:${id} ${n}`))
  }
  const t = at(BENCH.table), f = at(BENCH.furnace)
  c.push(`setblock ${t.x} ${t.y} ${t.z} minecraft:crafting_table`, `setblock ${f.x} ${f.y} ${f.z} minecraft:furnace[facing=north]`)
  for (const w of BENCH.wall) { const p = at(w); c.push(`setblock ${p.x} ${p.y} ${p.z} minecraft:cobblestone`, `setblock ${p.x} ${p.y + 1} ${p.z} minecraft:cobblestone`) }
  const bad = rcon(...c).filter(x => /Unknown|Incorrect|Cannot|not loaded/i.test(x.reply))
  if (bad.length) throw new Error('bench: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
function benchTruth () {
  const chests = BENCH.chests.map(([dx, dz]) => { const p = at([dx, dz]); return { at: [p.x, p.y, p.z], items: chestTotals(p) } })
  const cells = [...BENCH.chests.map(([dx, dz]) => ['chest', at([dx, dz])]), ['crafting_table', at(BENCH.table)], ['furnace', at(BENCH.furnace)],
    ...BENCH.wall.flatMap(w => [['cobblestone', at(w)], ['cobblestone', at(w, 1)]])]
  const ok = rcon(...cells.map(([n, p]) => `execute if block ${p.x} ${p.y} ${p.z} minecraft:${n}`)).map(x => passed(x.reply))
  const lids = blockIs(BENCH.chests.map(([dx, dz]) => { const p = at([dx, dz], 1); return [p.x, p.y, p.z] }), 'air')
  return { chests, blocksIntact: ok.every(Boolean), missing: cells.filter((_, i) => !ok[i]).map(([n, p]) => `${n}@${p.x},${p.y},${p.z}`), lidsAir: lids.every(Boolean) }
}
const PRE_CELLS = () => new Set([...BENCH.chests.map(([dx, dz]) => at([dx, dz])), at(BENCH.table), at(BENCH.furnace), ...BENCH.wall.flatMap(w => [at(w), at(w, 1)])].map(p => `${p.x},${p.y},${p.z}`))

// ---------------------------------------------------------------- scenes
const scenes = {}
const IDLE_BAG = [['stone_pickaxe', 1], ['torch', 16]]
const FOUND_BAG = [['stone_pickaxe', 1], ['oak_log', 16], ['cobblestone', 32], ['torch', 8]]

/** The plan's cells read on the server: air over a solid floor, inside the ground. */
function cellTruth (plan) {
  const cs = cellsOf(plan).filter(c => c.state === 'free')
  const air = blockIs(cs.map(c => c.at), 'air')
  const floor = rcon(...cs.map(c => `execute unless block ${c.at[0]} ${c.at[1] - 1} ${c.at[2]} #minecraft:replaceable`)).map(x => passed(x.reply))
  return { n: cs.length, allAir: air.every(Boolean), allFloor: floor.every(Boolean), allInArena: cs.every(c => inArena(c.at)),
    notAir: cs.filter((_, i) => !air[i]).map(c => c.at.join(',')).slice(0, 6), noFloor: cs.filter((_, i) => !floor[i]).map(c => c.at.join(',')).slice(0, 6) }
}

scenes.tpgreen = async () => {
  buildArena(); rcon(`kill ${ARENA_SEL}`)
  const pool = `sbxtp-${RUN}-green`
  let world = null
  const f = await startBot('tpgreen', IDLE_BAG, { pool, onSpawn: async ({ skillLog }) => { world = await worldOf(skillLog) } })
  const root = await waitFor(() => rowsOf(f.skillLog).find(r => r.name === '_townplan' && /op=root result=accepted/.test(r.detail)), 150000, 1000)
  await sleep(root ? 65000 : 1000)   // two more ticks: nothing else is written to a bare town
  const rows = rowsAll([f]).filter(r => /^_townplan/.test(r.name))
  await stopBots()
  const pl = await planOf(f.poolDir, world)
  const plan = pl.head?.plan
  const store = plan?.plots?.find(p => p.id === 'store'), work = plan?.plots?.find(p => p.id === 'work')
  const ct = plan ? cellTruth(plan) : null
  const licence = rows.filter(r => r.name === '_townplan_mode').length
  result({ scene: 'tpgreen', world, rows: rows.map(fmt), plan: plan ? { gen: pl.head.gen, gens: pl.gens, mode: plan.mode, orientation: plan.orientation, s: plan.s,
    store: store && { kind: store.kind, box: store.box, cells: store.cells.length }, work: work && { box: work.box, stations: (work.stations ?? []).map(c => `${c.kind}@${c.at.join(',')}`) },
    sectors: (plan.plots ?? []).filter(p => p.sector).map(p => `${p.id}:${p.sector}`) } : null, cells: ct, rejected: pl.rejected,
    CANDIDATE_PASS: !!(licence >= 1 && root && pl.ok && plan && plan.mode === 'greenfield' && store?.cells?.length === 7 && (work?.stations ?? []).length === 5 &&
      ct.allAir && ct.allFloor && ct.allInArena && !rows.some(r => /result=invalid/.test(r.detail))),
    BASE_SHAPE: !!(licence === 0 && rows.length === 0 && pl.gens === 0) })
}

async function retroScene (scene, { zone = false, bots = 1, bag = IDLE_BAG, wait = 150000 } = {}) {
  buildArena(); rcon(`kill ${ARENA_SEL}`)
  buildBench()
  const before = benchTruth()
  const pool = `sbxtp-${RUN}-${scene}`
  // THE ZONE: the north side of town (z <= home - 8), a protected-zones.json under the LIVE bot's world identity, written
  // before the planner's first tick (30 s after spawn)
  const zoneBox = [A.x0, 100, A.z0, A.x1, 140, HOME.z - 8]
  let world = null
  const files = []
  files.push(await startBot(scene, bag, { pool, onSpawn: async ({ skillLog, poolDir }) => {
    world = await worldOf(skillLog)
    if (zone) {
      fs.mkdirSync(poolDir, { recursive: true })
      fs.writeFileSync(path.join(poolDir, 'protected-zones.json'), JSON.stringify({ version: 1, hashed_seed: world, zones: [{ id: 'scene-north', kind: 'village', box: zoneBox }] }))
    }
  } }))
  for (let i = 1; i < bots; i++) files.push(await startBot(scene, bag, { pool, name: NAMES[i], at: at([-2 - i, 0]) }))
  const root = await waitFor(() => rowsAll(files).find(r => r.name === '_townplan' && /op=root result=accepted/.test(r.detail)), 150000, 1000)
  return { files, world, root, before, zoneBox, pool, wait }
}

scenes.tpretro = async () => {
  const s = await retroScene('tpretro', { zone: true })
  await sleep(s.root ? 65000 : 1000)
  const rows = rowsAll(s.files).filter(r => /^_townplan|^_zone|^_dig_town/.test(r.name))
  await stopBots()
  const after = benchTruth()
  const pl = await planOf(s.files[0].poolDir, s.world)
  const plan = pl.head?.plan
  const cells = cellsOf(plan)
  const pre = PRE_CELLS()
  const onPre = cells.filter(c => c.state === 'free' && pre.has(c.at.join(',')))
  const inZone = cells.filter(c => c.at[0] >= s.zoneBox[0] && c.at[0] <= s.zoneBox[3] && c.at[2] >= s.zoneBox[2] && c.at[2] <= s.zoneBox[5])
  const ct = plan ? cellTruth(plan) : null
  const licence = rows.filter(r => r.name === '_townplan_mode').length
  const itemsSame = JSON.stringify(after.chests) === JSON.stringify(s.before.chests)
  const store = plan?.plots?.find(p => p.id === 'store')
  result({ scene: 'tpretro', world: s.world, rows: rows.map(fmt), plan: plan ? { gen: pl.head.gen, gens: pl.gens, mode: plan.mode, store: store && { kind: store.kind, cells: (store.cells ?? []).map(c => `${c.state}@${c.at.join(',')}`) },
    work: plan.plots.find(p => p.id === 'work')?.stations?.map(c => `${c.kind}@${c.at.join(',')}`), groups: plan.groups?.status, zones: (plan.zones ?? plan.seed?.avoid ?? null) } : null,
    cells: ct, onPre: onPre.map(c => c.at.join(',')), inZone: inZone.map(c => c.at.join(',')), world2: { before: s.before, after },
    CANDIDATE_PASS: !!(licence >= 1 && s.root && pl.ok && plan?.mode === 'retrofit' && ct.allAir && ct.allFloor && onPre.length === 0 && inZone.length === 0 &&
      after.blocksIntact && after.lidsAir && itemsSame),
    BASE_SHAPE: !!(licence === 0 && pl.gens === 0 && after.blocksIntact && itemsSame) })
}

function wantFromPlan (poolDir, world, kinds) {
  // the plan's cells for each wanted kind (read live from the bots' files each poll)
  return async () => {
    const pl = await planOf(poolDir, world)
    const plan = pl.head?.plan
    if (!plan) return null
    const work = plan.plots.find(p => p.id === 'work'), store = plan.plots.find(p => p.id === 'store')
    const pick = { crafting_table: (work?.stations ?? []).find(c => c.kind === 'crafting_table'), furnace: (work?.stations ?? []).find(c => c.kind === 'furnace'),
      chest: (store?.cells ?? []).find(c => c.role === 'overflow') ?? (store?.cells ?? [])[0] }
    return kinds.map(k => ({ kind: k, cell: pick[k], state: pick[k]?.state }))
  }
}
async function foundScene (scene, { retro = false, bots = 3, kinds = ['crafting_table', 'chest', 'furnace'], ms = 900000 } = {}) {
  let s
  if (retro) s = await retroScene(scene, { bots, bag: FOUND_BAG })
  else {
    buildArena(); rcon(`kill ${ARENA_SEL}`)
    const pool = `sbxtp-${RUN}-${scene}`
    let world = null
    const files = [await startBot(scene, FOUND_BAG, { pool, onSpawn: async ({ skillLog }) => { world = await worldOf(skillLog) } })]
    for (let i = 1; i < bots; i++) files.push(await startBot(scene, FOUND_BAG, { pool, name: NAMES[i], at: at([-2 - i, 0]) }))
    const root = await waitFor(() => rowsAll(files).find(r => r.name === '_townplan' && /op=root result=accepted/.test(r.detail)), 150000, 1000)
    s = { files, world, root, before: null, pool }
  }
  const poolDir = s.files[0].poolDir
  const live = wantFromPlan(poolDir, s.world, kinds)
  let snap = null
  const t0 = Date.now()
  while (s.root && Date.now() - t0 < ms) {
    snap = await live()
    if (snap && snap.every(x => x.cell)) {
      const on = rcon(...snap.map(x => `execute if block ${x.cell.at[0]} ${x.cell.at[1]} ${x.cell.at[2]} minecraft:${x.kind}`)).map(x => passed(x.reply))
      snap.forEach((x, i) => { x.on = on[i] })
      if (snap.every(x => x.on && x.state === 'placed')) break
    }
    await sleep(15000)
  }
  await sleep(5000)
  const rows = rowsAll(s.files).filter(r => /^_found|^_townplan$|^_townplan_mode$|^craft$|^_craft_room$/.test(r.name))
  await stopBots()
  const pl = await planOf(poolDir, s.world)
  const plan = pl.head?.plan
  const final = await live()
  if (final) {
    const on = rcon(...final.filter(x => x.cell).map(x => `execute if block ${x.cell.at[0]} ${x.cell.at[1]} ${x.cell.at[2]} minecraft:${x.kind}`)).map(x => passed(x.reply))
    final.filter(x => x.cell).forEach((x, i) => { x.on = on[i] })
  }
  // everything of those kinds standing in town (a stray placement off the plan would show here)
  const standing = { chest: countIn('chest').map(c => c.join(',')), crafting_table: countIn('crafting_table').map(c => c.join(',')), furnace: countIn('furnace').map(c => c.join(',')) }
  const planCells = new Set(cellsOf(plan).map(c => c.at.join(',')))
  const pre = retro ? PRE_CELLS() : new Set()
  const stray = Object.entries(standing).flatMap(([k, cs]) => cs.filter(c => !planCells.has(c) && !pre.has(c)).map(c => `${k}@${c}`))
  const after = retro ? benchTruth() : null
  const placedRows = rows.filter(r => r.name === '_found' && /outcome=placed/.test(r.detail))
  const licence = rows.filter(r => r.name === '_found_mode').length
  const allIn = !!final && final.every(x => x.on && x.state === 'placed')
  result({ scene, world: s.world, rows: rows.map(fmt).slice(-60), want: final?.map(x => ({ kind: x.kind, at: x.cell?.at?.join(','), state: x.state, on: x.on })), standing, stray,
    plan: plan ? { gen: pl.head.gen, gens: pl.gens, mode: plan.mode, rejected: pl.rejected } : null, world2: after && { intact: after.blocksIntact, missing: after.missing, lidsAir: after.lidsAir, itemsSame: JSON.stringify(after.chests) === JSON.stringify(s.before.chests) },
    CANDIDATE_PASS: !!(licence >= 1 && s.root && allIn && placedRows.length >= kinds.length && stray.length === 0 && pl.rejected === 0 &&
      (!retro || (after.blocksIntact && after.lidsAir && JSON.stringify(after.chests) === JSON.stringify(s.before.chests)))),
    BASE_SHAPE: !!(licence === 0 && rows.filter(r => /^_found|^_townplan/.test(r.name)).length === 0 && (!retro || after.blocksIntact)) })
}
scenes.foundbare = () => foundScene('foundbare')
scenes.foundretro = () => foundScene('foundretro', { retro: true, bots: 2, kinds: ['crafting_table', 'furnace'] })

async function main () {
  const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
  const owner = process.env.LOCK_OWNER || 'townplan'
  if (!new RegExp(owner).test(lock)) throw new Error(`the sandbox lock is not held for ${owner}: ` + lock.trim().slice(0, 160))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} sha=${(() => { try { return fs.readFileSync(path.join(BOT_ROOT, '.sha'), 'utf8').trim() } catch { return 'unknown' } })()} server=${SERVER} scenes=${SCENES_S}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  for (const s of SCENES_S.split(',')) { P('=== scene', s); await scenes[s]() }
}
async function cleanup () {
  await stopBots().catch(() => {})
  try { brain.close() } catch {}
  for (const n of NAMES) { try { fs.unlinkSync(`${R}/sandbox/.env.townplan-e2e-${n}`) } catch {} }
  try {
    P('cleanup', rcon(`kill ${ARENA_SEL}`, `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
      `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'list').map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`))
  } catch (e) { P('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
