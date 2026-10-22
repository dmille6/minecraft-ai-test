// SANDBOX-ONLY end-to-end proof of THE TOWN PLAN (townplan-01) and FOUNDING (found-01). Build spec
// docs/reports/townplan-found-spec-2026-10-21.md section 3. Derived from sandbox/well/stock-e2e.cjs (its arena, its RCON, its
// loopback brain, its startBot). The REAL bot (src/index.mjs from <botRoot>, unmodified) runs its own planner tick and its own
// deterministic town orders; the scene reads back the SERVER (plan cells, pre-existing blocks, container items) and the plan
// files the bots wrote (with the build's own walk).
//
//   WELL_REPO=<checkout with sandbox/run-bot.sh> LOCK_OWNER=townplan node sandbox/townplan/townplan-e2e.cjs <botRoot> <scenes> [server]
//
// SCENES (spec section 3 name -> scene id). Each result line carries CANDIDATE_PASS (the built shape) and BASE_SHAPE (what the
// base does: no plan, no found rows); a scene the base cannot discriminate says so (base: null).
//   TP-GREEN    tpgreen     the SHOWCASE ground (the 93x93 dump rebuilt at an offset, the showcase zones and the seed's avoid box
//                           shifted with it): the root plan equals the offline planner's plan for the same ground; no cell in a
//                           zone or avoid box; every free cell air over a solid floor
//   TP-RETRO    tpretro     a bench-like town on a platform: 12 chests (one double) with items, two tables, two furnaces, a junk
//                           well beside the free strip; the bot's own counts: `waiting` then `allocated`; the workshop strip off
//                           every container's stand and >= 3 from the cap; every container OPENED by the bot after the root (the
//                           town index records it); a dispose_well afterwards succeeds; nothing torn down
//   TP-CAS      tpcas       three bots arriving together: ONE root; every generation accepted (none rejected); no `invalid`; a
//                           bot SIGKILLed and restarted writes no second root and its next generation chains
//   TP-ZONES    tpzones     a zones file over the E pad: E never chosen; mid-run a malformed file: the last good list kept (no
//                           re-fit, no invalid); a fresh pool started with the malformed file: no root and no found row until
//                           the file is good, then a root
//   TP-TEMP     tptemp      a bot crafting (its own temporary table) while it stands beside the free station 0 with every other
//                           neighbour walled: the table never on a NEVER cell; the craft succeeds; station 0 not `placed`
//   FOUND-FLAT  foundflat   3 bots with chests, spare tables and furnaces and a bag of stacks: first container in the overflow
//                           cell; group homes in store cells; table/furnace in stations 0/1; 0 containers outside plots; 0 lids
//   FOUND-BARE  foundbare   bags EMPTY on a ground with trees and a stone patch: the bots gather, then table/chest/furnace into
//                           their cells (a long scene: the gather is the bots' own milestone orders)
//   FOUND-HOUR1 foundhour1  16 logs, 20 cobblestone, 1 crafting table: founding from these; the givers still craft a wooden and a
//                           stone pickaxe afterwards
//   FOUND-ROUGH foundrough  holes, a slope and a pond around home: a qualifying fit; no placement on an unready cell
//   FOUND-CANOPY foundcanopy store cells under spruce leaves, in large_fern / tall_grass, beside a trunk; one cell with 2 snow
//                           layers, one with mud above: chests placed into the fern/grass/leaf cells and OPENED; the snow-2 and
//                           mud-lid cells never chosen
//   FOUND-NOFIT foundnofit  arenas with exactly 1..5 READY cells (a walkway out to radius 7): the annex, the table first; 1: a
//                           table and `store: unplaced`; 2-5: a table and containers
//   FOUND-NONE  foundnone   home on a pillar in water: `found` places nothing; a named work row succeeds
//   FOUND-KILL  foundkill   SIGKILL between `reserved` and `placed`, and between the placement and its publication: no duplicate,
//                           no stuck reservation; the orphan placement observed `placed` with its intent after until + 60 s + 10 min
//   FOUND-RETRO foundretro  TP-RETRO's town, bots carrying tables and furnaces: table and furnace in the strip's stations; nothing
//                           removed; the giver still holds a table and crafts a stone pickaxe afterwards
//   FOUND-SOFT  foundsoft   greenfield, every store cell placed and full: the recovery's chest lands outside the plan (or soft, or
//                           the committed box), never on a NEVER cell; every placed cell still reachable; no new `no_site`
//   FOUND-BOX   foundbox    the only valid recovery cell inside the committed storehouse box: the base places there; the candidate
//                           too (tier=box), never a NEVER cell
//   FOUND-ACCESS foundaccess a committed storehouse whose only approach is one cell wide, the recovery's cheapest BOX candidate that
//                           cell: the candidate skips it (ACCESS) and places elsewhere; every container then opened by the bot
//   FOUND-PLINTH foundplinth the raised well planned by build_plinth under a plan: its cap and placed cells never on a NEVER
//                           cell, never in a box + 1 (the base shows the cheapest cap lies in the E storehouse box); ONLY-BOX
//                           (the only feasible plinth inside the committed box) is fake-world only (townplan-adopters)
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
const SHA = (() => { try { return fs.readFileSync(path.join(BOT_ROOT, '.sha'), 'utf8').trim() } catch { return 'unknown' } })()
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-townplan-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = []
  for (let i = 0; i < cmds.length; i += 250) {   // bounded batches: one ssh per 250 commands
    const o = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.slice(i, i + 250).join('\n') + '\n', encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 })
    let cur = null
    for (const line of o.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; out.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  }
  return out
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const bad = rs => rs.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|out of the world/i.test(x.reply))
const must = (rs, what) => { const b = bad(rs); if (b.length) throw new Error(`${what}: ` + b.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; ')); return rs }

// ---------------------------------------------------------------- arenas
// THE FLAT ARENA: a dirt slab 7 deep at y 113..119 around HOME (+-24): FIT_R 20 and the store pad's u 15 fit inside it
const HOME = { x: 1100, y: 120, z: -1100 }   // inside the bots' WORLD_BORDER_RADIUS 1950 (1515,1515 is 2142 out: every place refused)
const G = 119
const box = (h, r) => ({ x0: h.x - r, x1: h.x + r, z0: h.z - r, z1: h.z + r })
const A = box(HOME, 24)
const at = ([dx, dz], dy = 0, h = HOME) => ({ x: h.x + dx, y: h.y + dy, z: h.z + dz })
const ARENA_SEL = b => `@e[type=item,x=${b.x0},y=40,z=${b.z0},dx=${b.x1 - b.x0},dy=100,dz=${b.z1 - b.z0}]`
function fillChunks (b, y0, y1, name) {   // fill in <= 32768-block pieces
  const c = []
  for (let x = b.x0; x <= b.x1; x += 16) for (let z = b.z0; z <= b.z1; z += 16) {
    const xe = Math.min(b.x1, x + 15), ze = Math.min(b.z1, z + 15)
    for (let y = y0; y <= y1; y += 64) c.push(`fill ${x} ${y} ${z} ${xe} ${Math.min(y1, y + 63)} ${ze} minecraft:${name}`)
  }
  return c
}
function buildArena ({ ground = 'dirt' } = {}) {
  must(rcon(`kill ${ARENA_SEL(A)}`, ...fillChunks(A, 112, 140, 'air'), ...fillChunks(A, 113, G, ground)), 'arena')
  fenceArena()
}
// A BARRIER RING at the slab's edge, 3 high (an invisible solid): a bot on a milestone walk never steps off the floating arena
// (foundhour1 r1: a bot fell 50 blocks to the ground below and the watchdog reconnected it there)
function fenceArena () {
  const c = []
  for (const [x0, z0, x1, z1] of [[A.x0, A.z0, A.x1, A.z0], [A.x0, A.z1, A.x1, A.z1], [A.x0, A.z0, A.x0, A.z1], [A.x1, A.z0, A.x1, A.z1]]) c.push(`fill ${x0} ${G + 1} ${z0} ${x1} ${G + 3} ${z1} minecraft:barrier`)
  must(rcon(...c), 'fence')
}
const parseItem = seg => { const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; return id ? { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) } : null }
function chestTotals (p) {
  const cmds = []; for (let s = 0; s < 27; s++) cmds.push(`data get block ${p.x} ${p.y} ${p.z} Items[{Slot:${s}b}]`)
  const r = rcon(...cmds); const t = {}
  for (let s = 0; s < 27; s++) { const it = /has the following block data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) t[it.id] = (t[it.id] || 0) + it.count }
  return t
}
function bagOf (name) {
  const cmds = []; for (let s = 0; s < 36; s++) cmds.push(`data get entity ${name} Inventory[{Slot:${s}b}]`)
  const r = rcon(...cmds); const t = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) t[it.id] = (t[it.id] || 0) + it.count }
  return t
}
const blockIs = (cells, name) => rcon(...cells.map(([x, y, z]) => `execute if block ${x} ${y} ${z} minecraft:${name}`)).map(x => passed(x.reply))
function standing (name, h = HOME, r = 22, ys = [h.y]) {
  const cells = []
  for (const y of ys) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) cells.push([h.x + dx, y, h.z + dz])
  const hit = blockIs(cells, name)
  return cells.filter((_, i) => hit[i]).map(c => c.join(','))
}
function setChest (p, stacks = [], { type = 'single', facing = 'north' } = {}) {
  const c = [`setblock ${p.x} ${p.y} ${p.z} minecraft:air`, `setblock ${p.x} ${p.y} ${p.z} minecraft:chest[facing=${facing},type=${type}]`]
  stacks.forEach(([id, n], i) => c.push(`item replace block ${p.x} ${p.y} ${p.z} container.${i} with minecraft:${id} ${n}`))
  must(rcon(...c), 'chest')
}

// ---------------------------------------------------------------- the bot and its logs
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || ''), args: r.skill.args ?? null }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

// THE LOOPBACK BRAIN: a queue of model verbs per bot (by the sentinel-free request: round-robin is fine, one queue for all), else
// short walks WEST of home -- never `status` for ever (the livelock breaker relocates the bot off the arena)
let brainN = 0, brainHome = HOME, brainFar = false, brainPoints = null   // brainPoints: an island scene's own walkable wander cells
const brainQueue = []
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    const q = brainQueue.shift()
    if (q) decision = q
    else if (brainN++ % 2) {
      // brainFar: every other walk leaves the town circle (a found order is one per bot per VISIT: a visit ends outside it)
      const pts = brainPoints ?? (brainFar ? [{ x: brainHome.x - 22, y: brainHome.y, z: brainHome.z }, { x: brainHome.x - 4, y: brainHome.y, z: brainHome.z + 1 }]
        : [{ x: brainHome.x - 4, y: brainHome.y, z: brainHome.z - 1 }, { x: brainHome.x - 5, y: brainHome.y, z: brainHome.z + 1 }])
      decision = { skill: 'goto', args: pts[(brainN >> 1) % 2] }
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: scripted', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const procs = {}
async function stopBots (names = Object.keys(procs), sig = 'SIGTERM') {
  for (const n of names) { const p = procs[n]; if (!p) continue; try { p.kill(sig) } catch {} delete procs[n] }
  await waitFor(() => { const l = r1('list'); return !names.some(n => l.includes(n)) }, 30000, 1000)
}
async function startBot (scene, slotsSpec, { pool, name = NAMES[0], home = HOME, standAt = null, env: extra = {}, onSpawn = null } = {}) {
  const tag = `${RUN}-${scene}-${name}-${Date.now() % 100000}`
  const logRel = `./sandbox/log/townplan-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/townplan-e2e/${tag}/skill-${name}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`
  const envRel = `sandbox/.env.townplan-e2e-${name}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', name); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/townplan-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20); set('WORLD_BORDER_RADIUS', 4000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, home[a.toLowerCase()]); set(`BOARD_${a}`, home[a.toLowerCase()]) }
  for (const [k, v] of Object.entries(extra)) set(k, v)
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  const proc = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  procs[name] = proc
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBots([name]); throw new Error('no spawn ' + name) }
  const st = standAt ?? home
  rcon(`gamemode survival ${name}`, `clear ${name}`, `tp ${name} ${st.x + 0.5} ${st.y} ${st.z + 0.5}`)
  await sleep(6000)
  const poolDir = path.join(R, 'sandbox/state', `_pool-${pool}`)
  if (onSpawn) await onSpawn({ skillLog, poolDir })
  const c = [`tp ${name} ${st.x + 0.5} ${st.y} ${st.z + 0.5}`]
  let s = 0
  for (const [id, n] of slotsSpec) c.push(`item replace entity ${name} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(1000)
  return { skillLog, botOut, name, pool, poolDir, proc }
}
const worldOf = async skillLog => {
  const row = await waitFor(() => rowsOf(skillLog).find(r => r.name === '_plinth_mode'), 30000, 250)
  const w = ((row?.detail ?? '').match(/ w=(\S+)/) || [])[1] ?? null
  if (!w || w === '-') throw new Error('no world identity in the bot\'s _plinth_mode row')
  return w
}
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), sha: SHA, root: BOT_ROOT, ...r }) + '\n'); P('RESULT', JSON.stringify({ scene: r.scene, CANDIDATE_PASS: r.CANDIDATE_PASS, BASE_SHAPE: r.BASE_SHAPE })) }
const rowsAll = files => files.flatMap(f => rowsOf(f.skillLog).map(r => ({ ...r, bot: f.name }))).sort((a, b) => a.ts - b.ts)
const fmt = r => `${new Date(r.ts).toISOString().slice(11, 19)} ${r.bot ?? ''} ${r.name} ${r.status} ${r.detail.slice(0, 180)}`
const rootRow = files => rowsAll(files).find(r => r.name === '_townplan' && /op=root result=accepted/.test(r.detail))
const licence = (files, kind) => rowsAll(files).filter(r => r.name === kind).length

// ---------------------------------------------------------------- the plan, as the bots wrote it (the build's own walk)
async function planOf (poolDir, world, home = HOME) {
  try {
    const PS = await import(path.join(BOT_ROOT, 'bots/src/planstore.mjs'))
    const key = PS.planKey(home)
    const h = PS.planHead(poolDir, key, world, { fresh: true })
    const files = fs.existsSync(poolDir) ? fs.readdirSync(poolDir).filter(f => f.startsWith(key + '.g')) : []
    return { ok: h.ok, head: h.head ?? null, gens: files.length, accepted: h.accepted ?? [], rejected: h.rejected ?? [] }
  } catch (e) { return { ok: false, head: null, gens: 0, accepted: [], rejected: [], err: String(e.message).slice(0, 120) } }
}
const cellsOf = plan => (plan?.plots ?? []).flatMap(p => [...(p.cells ?? []), ...(p.stations ?? [])].map(c => ({ ...c, plot: p.id })))
const storeCells = plan => (plan?.plots?.find(p => p.id === 'store')?.cells ?? [])
const stations = plan => (plan?.plots?.find(p => p.id === 'work')?.stations ?? [])
const K = a => a.join(',')
const inBox3 = (b, a) => b[0] <= a[0] && a[0] <= b[3] && b[1] <= a[1] && a[1] <= b[4] && b[2] <= a[2] && a[2] <= b[5]
const NEVER = plan => {
  const s = new Set()
  for (const c of cellsOf(plan)) { s.add(K(c.at)); if ((c.state === 'reserved' || c.state === 'placed') && Array.isArray(c.stand)) { s.add(K(c.stand)); s.add(K([c.stand[0], c.stand[1] + 1, c.stand[2]])) } }
  return s
}
/** The plan's FREE cells on the server: air over a solid floor. */
function cellTruth (plan, inside = () => true) {
  const cs = cellsOf(plan).filter(c => c.state === 'free' && c.ready !== false)
  if (!cs.length) return { n: 0, allAir: true, allFloor: true, allInside: true, notAir: [], noFloor: [] }
  const air = rcon(...cs.map(c => `execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} #minecraft:replaceable`)).map(x => passed(x.reply))
  const floor = rcon(...cs.map(c => `execute unless block ${c.at[0]} ${c.at[1] - 1} ${c.at[2]} #minecraft:replaceable`)).map(x => passed(x.reply))
  return { n: cs.length, allAir: air.every(Boolean), allFloor: floor.every(Boolean), allInside: cs.every(c => inside(c.at)),
    notAir: cs.filter((_, i) => !air[i]).map(c => K(c.at)).slice(0, 6), noFloor: cs.filter((_, i) => !floor[i]).map(c => K(c.at)).slice(0, 6) }
}
function zonesFile (poolDir, world, zones) {
  fs.mkdirSync(poolDir, { recursive: true })
  fs.writeFileSync(path.join(poolDir, 'protected-zones.json'), JSON.stringify({ version: 1, hashed_seed: world, zones }))
}
const IDLE_BAG = [['stone_pickaxe', 1], ['torch', 16]]
const FOUND_BAG = [['stone_pickaxe', 1], ['oak_log', 16], ['cobblestone', 32], ['torch', 8]]
const scenes = {}

// ================================================================ TP-GREEN: the showcase ground
const SHOW = { dx: -1200, dz: 1200 }
const SHOW_HOME = { x: SHOW.dx, y: 70, z: SHOW.dz }
const STONE_BELOW = 64   // the rebuild puts stone below y 64 (ores and caves are not the fit's business); the offline read does too
function showDump () {
  const d = JSON.parse(fs.readFileSync(path.join(BOT_ROOT, 'bots/test/fixtures/townplan-showcase-dump.json'), 'utf8'))
  const [x0, z0, x1, z1] = d.box, [y0, y1] = d.y
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1
  const buf = Buffer.from(d.cells, 'base64')
  const cells = d.bits === 8 ? new Uint8Array(buf.buffer, buf.byteOffset, buf.length) : new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2)
  const nameAt = (x, y, z) => { if (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) return null; const n = d.palette[cells[((y - y0) * nz + (z - z0)) * nx + (x - x0)]]; return n === '?' ? null : (y < STONE_BELOW ? 'stone' : n) }
  return { d, x0, x1, z0, z1, y0, y1, nameAt }
}
function setName (n, below) {
  if (n === 'spruce_leaves' || /_leaves$/.test(n)) return `${n}[persistent=true]`
  if (n === 'large_fern' || n === 'tall_grass') return `${n}[half=${below === n ? 'upper' : 'lower'}]`
  return n
}
function rebuildShowcase () {
  const S = showDump()
  const b = { x0: S.x0 + SHOW.dx, x1: S.x1 + SHOW.dx, z0: S.z0 + SHOW.dz, z1: S.z1 + SHOW.dz }
  must(rcon(`forceload add ${b.x0} ${b.z0} ${b.x1} ${b.z1}`, `kill ${ARENA_SEL(b)}`, ...fillChunks(b, S.y0, 110, 'air'), ...fillChunks(b, 40, STONE_BELOW - 1, 'stone')), 'showcase base')
  const cmds = []
  for (let x = S.x0; x <= S.x1; x++) for (let z = S.z0; z <= S.z1; z++) {
    let y = STONE_BELOW
    while (y <= S.y1) {
      const n = S.nameAt(x, y, z)
      if (!n || n === 'air') { y++; continue }
      const plant = /fern|grass|bush|mushroom|lichen|leaves/.test(n)
      if (plant) { cmds.push(`setblock ${x + SHOW.dx} ${y} ${z + SHOW.dz} minecraft:${setName(n, S.nameAt(x, y - 1, z))}`); y++; continue }
      let e = y; while (e + 1 <= S.y1 && S.nameAt(x, e + 1, z) === n) e++
      cmds.push(`fill ${x + SHOW.dx} ${y} ${z + SHOW.dz} ${x + SHOW.dx} ${e} ${z + SHOW.dz} minecraft:${n}`)
      y = e + 1
    }
  }
  P(`showcase rebuild: ${cmds.length} commands`)
  // logs/solids first, plants after (a plant needs its floor)
  const solid = cmds.filter(c => c.startsWith('fill')), plants = cmds.filter(c => c.startsWith('setblock'))
  const rs = rcon(...solid, ...plants)
  const b2 = bad(rs)
  P(`showcase rebuild done: ${rs.length} replies, ${b2.length} refused ${b2.slice(0, 2).map(x => x.cmd + ' => ' + x.reply).join('; ')}`)
  return { box: b, S }
}
async function offlinePlan (S, zones, seedAvoid, world) {
  const T = await import(path.join(BOT_ROOT, 'bots/src/townplan.mjs'))
  const mcData = req('minecraft-data')('1.21.8')
  const read = (x, y, z) => {
    const n = S.nameAt(x - SHOW.dx, y, z - SHOW.dz)
    if (n === null && (x - SHOW.dx < S.x0 || x - SHOW.dx > S.x1 || z - SHOW.dz < S.z0 || z - SHOW.dz > S.z1)) return null
    const name = n ?? 'air'
    return { name, boundingBox: mcData.blocksByName[name]?.boundingBox ?? 'block' }
  }
  const all = [...zones, ...seedAvoid]
  return T.fitTown(read, SHOW_HOME, { containers: [], existing: [], zones: all, seed: { avoid: seedAvoid }, seedInfo: { why: 'ok', avoid: seedAvoid }, zoneInfo: { n: zones.length, avoid: seedAvoid.length, why: 'ok' } })
}
const shiftBox = b => [b[0] + SHOW.dx, b[1], b[2] + SHOW.dz, b[3] + SHOW.dx, b[4], b[5] + SHOW.dz]
scenes.tpgreen = async () => {
  const { S } = rebuildShowcase()
  const pz = JSON.parse(fs.readFileSync(path.join(BOT_ROOT, 'bots/test/fixtures/protected-zones.showcase.json'), 'utf8'))
  const zones = pz.zones.map(z => ({ ...z, box: shiftBox(z.box) }))
  const avoid = [{ id: 'trial-chambers', box: shiftBox([-16, -43, 69, 84, 27, 160]) }]
  const pool = `sbxtp-${RUN}-green`
  let world = null
  brainHome = SHOW_HOME
  const f = await startBot('tpgreen', IDLE_BAG, { pool, home: SHOW_HOME, onSpawn: async ({ skillLog, poolDir }) => {
    world = await worldOf(skillLog)
    zonesFile(poolDir, world, zones)
    fs.writeFileSync(path.join(poolDir, 'town-site.json'), JSON.stringify({ version: 1, hashed_seed: world, home: [SHOW_HOME.x, SHOW_HOME.y, SHOW_HOME.z], town_plan: { template: 'ring@1', avoid } }))
  } })
  const root = await waitFor(() => rootRow([f]), 180000, 1000)
  await sleep(root ? 65000 : 1000)
  const rows = rowsAll([f]).filter(r => /^_townplan/.test(r.name))
  await stopBots(); brainHome = HOME
  const pl = await planOf(f.poolDir, world, SHOW_HOME)
  const plan = pl.head?.plan
  const off = await offlinePlan(S, zones, avoid, world)
  const geo = p => (p?.plots ?? []).map(x => ({ id: x.id, kind: x.kind, box: x.box ?? null, sector: x.sector ?? null, cells: (x.cells ?? []).map(c => K(c.at)), stations: (x.stations ?? []).map(c => `${c.kind}@${K(c.at)}`) }))
  const same = !!plan && JSON.stringify(geo(plan)) === JSON.stringify(geo(off.body)) && plan.orientation === off.body?.orientation && plan.s === off.body?.s
  const zoneHits = cellsOf(plan).filter(c => [...zones, ...avoid].some(z => inBox3(z.box, c.at))).map(c => K(c.at))
  const ct = plan ? cellTruth(plan) : null
  const lic = rows.filter(r => r.name === '_townplan_mode').length
  result({ scene: 'tpgreen', world, rows: rows.map(fmt).slice(0, 30), plan: plan ? { gen: pl.head.gen, gens: pl.gens, mode: plan.mode, orientation: plan.orientation, s: plan.s, plots: geo(plan) } : null,
    offline: off.body ? { mode: off.body.mode, orientation: off.body.orientation, s: off.body.s, why: off.why } : null, same, zoneHits, cells: ct,
    CANDIDATE_PASS: !!(lic >= 1 && root && pl.ok && plan?.mode === 'greenfield' && same && !zoneHits.length && ct.allAir && ct.allFloor && !rows.some(r => /result=invalid/.test(r.detail))),
    BASE_SHAPE: !!(lic === 0 && rows.length === 0 && pl.gens === 0) })
}

// ================================================================ the bench-like town (TP-RETRO, FOUND-RETRO)
// a cobblestone platform (r 9); 11 single chests and one double chest east and north of home with items; two tables and two
// furnaces south-west; a junk well (an RCON-built natural well: closed top trapdoor, floor trapdoor, dirt floor) south-east
const BENCH = {
  chests: [[3, 3, [['cobblestone', 64], ['cobblestone', 20]]], [5, 3, [['oak_log', 30]]], [7, 3, [['dirt', 64]]], [3, -3, [['iron_ingot', 5], ['coal', 12]]],
           [5, -3, [['oak_sapling', 9]]], [7, -3, [['stick', 20], ['oak_planks', 16]]], [3, 6, [['wheat_seeds', 10]]], [5, 6, [['andesite', 40]]],
           [7, 6, [['granite', 40]]], [3, -6, [['bread', 4]]], [5, -6, [['torch', 30]]]],
  double: [[8, -6], [8, -5]],
  tables: [[-3, 3], [-5, 3]], furnaces: [[-3, 5], [-5, 5]],
  well: [6, 9],
}
function buildBench ({ well = true } = {}) {
  const c = [`fill ${HOME.x - 9} ${G} ${HOME.z - 9} ${HOME.x + 9} ${G} ${HOME.z + 9} minecraft:cobblestone`]
  must(rcon(...c), 'platform')
  for (const [dx, dz, stacks] of BENCH.chests) setChest(at([dx, dz]), stacks)
  const [l, r] = BENCH.double
  must(rcon(`setblock ${at(l).x} ${HOME.y} ${at(l).z} minecraft:chest[facing=west,type=right]`, `setblock ${at(r).x} ${HOME.y} ${at(r).z} minecraft:chest[facing=west,type=left]`,
    `item replace block ${at(l).x} ${HOME.y} ${at(l).z} container.0 with minecraft:cobblestone 64`), 'double')
  for (const t of BENCH.tables) { const p = at(t); must(rcon(`setblock ${p.x} ${p.y} ${p.z} minecraft:crafting_table`), 'table') }
  for (const f of BENCH.furnaces) { const p = at(f); must(rcon(`setblock ${p.x} ${p.y} ${p.z} minecraft:furnace[facing=north]`), 'furnace') }
  if (well) {
    const w = at(BENCH.well)
    must(rcon(`setblock ${w.x} ${G} ${w.z} minecraft:oak_trapdoor[half=top,open=false,facing=north]`, `setblock ${w.x} ${G - 1} ${w.z} minecraft:oak_trapdoor[half=bottom,open=false,facing=north]`,
      `setblock ${w.x} ${G - 2} ${w.z} minecraft:dirt`), 'well')
  }
}
const benchContainers = () => [...BENCH.chests.map(([dx, dz]) => at([dx, dz])), ...BENCH.double.map(d => at(d))]
function benchTruth () {
  const cells = [...BENCH.chests.map(([dx, dz]) => ['chest', at([dx, dz])]), ...BENCH.double.map(d => ['chest', at(d)]), ...BENCH.tables.map(t => ['crafting_table', at(t)]),
    ...BENCH.furnaces.map(f => ['furnace', at(f)])]
  const ok = rcon(...cells.map(([n, p]) => `execute if block ${p.x} ${p.y} ${p.z} minecraft:${n}`)).map(x => passed(x.reply))
  const items = benchContainers().map(p => chestTotals(p))
  return { intact: ok.every(Boolean), missing: cells.filter((_, i) => !ok[i]).map(([n, p]) => `${n}@${p.x},${p.y},${p.z}`), items }
}
const PRE = () => new Set([...benchContainers(), ...BENCH.tables.map(t => at(t)), ...BENCH.furnaces.map(f => at(f))].map(p => `${p.x},${p.y},${p.z}`))
/** The bot's own opens after `t`: the town index's observation records (townindex-01) per container key. */
async function opensAfter (poolDir, t, home = HOME) {
  try {
    const TI = await import(path.join(BOT_ROOT, 'bots/src/townindex.mjs'))
    return new Set(TI.indexRecords(poolDir, TI.indexHomeKey(home)).filter(r => r.t === 'obs' && r.at >= t && r.bot !== 'sandbox-scene').flatMap(r => r.h ?? [r.k]))
  } catch { return new Set() }
}
// a full bag of mixed stacks: the town deposit counts the town first (its count step) and banks; then dispose_well takes junk
const DEPOSIT_BAG = [['stone_pickaxe', 1], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 64], ['dirt', 64], ['andesite', 64], ['granite', 64], ['diorite', 64],
  ['oak_log', 20], ['flint', 64], ['egg', 16], ['egg', 16], ['clay_ball', 64], ['iron_ingot', 4], ['wheat_seeds', 20], ['bread', 6]]
const fillBag = (spec, n = 36) => { const o = [...spec]; const rocks = ['andesite', 'diorite', 'granite', 'calcite']; let i = 0; while (o.length < n) o.push([rocks[i++ % 4], 64]); return o }

scenes.tpretro = async () => {
  buildArena(); buildBench()
  const before = benchTruth()
  const pool = `sbxtp-${RUN}-retro`
  let world = null
  const f = await startBot('tpretro', fillBag(DEPOSIT_BAG), { pool, onSpawn: async ({ skillLog }) => { world = await worldOf(skillLog) } })
  const root = await waitFor(() => rootRow([f]), 150000, 1000)
  const tRoot = root?.ts ?? Date.now()
  // the bot's own deposits and counts: wait for `alloc`, then a dispose_well
  const alloc = await waitFor(() => rowsAll([f]).find(r => r.name === '_townplan' && /op=alloc result=accepted/.test(r.detail)), 900000, 5000)
  const disp = await waitFor(() => rowsAll([f]).find(r => r.name === '_well_dispose' && r.status === 'success'), 600000, 5000)
  await sleep(5000)
  const rows = rowsAll([f]).filter(r => /^_townplan|^_town_deposit|^_well_dispose|^_stock_recount|^_dig_town/.test(r.name))
  await stopBots()
  const after = benchTruth()
  const pl = await planOf(f.poolDir, world)
  const plan = pl.head?.plan
  const pre = PRE()
  const onPre = cellsOf(plan).filter(c => c.state === 'free' && pre.has(K(c.at))).map(c => K(c.at))
  const ct = plan ? cellTruth(plan) : null
  const st = stations(plan)
  const cap = at(BENCH.well, -1)
  const wellD = st.length ? Math.min(...st.map(c => Math.max(Math.abs(c.at[0] - cap.x), Math.abs(c.at[2] - cap.z)))) : null
  // a station on a container's stand: the stands are the walkable cells beside each container; a strip cell ADJACENT (side) to a
  // container that has no other open side would cut it off -- read as: every container still opened by the bot after the root
  const opened = await opensAfter(f.poolDir, tRoot)
  const conts = benchContainers().map(p => `${p.x},${p.y},${p.z}`)
  const unopened = conts.filter(k => !opened.has(k))
  const lic = rows.filter(r => r.name === '_townplan_mode').length
  const itemsMoved = JSON.stringify(after.items) !== JSON.stringify(before.items)
  result({ scene: 'tpretro', world, rows: rows.map(fmt).slice(-50), plan: plan ? { gen: pl.head.gen, gens: pl.gens, rejected: pl.rejected.length, mode: plan.mode, groups: plan.groups?.status,
    store: plan.plots.find(p => p.id === 'store')?.kind, work: st.map(c => `${c.kind}@${K(c.at)}`) } : null, cells: ct, onPre, wellD, opened: [...opened].length, unopened,
    world2: { intact: after.intact, missing: after.missing, itemsMoved }, alloc: !!alloc, dispose: disp?.detail?.slice(0, 120) ?? null,
    CANDIDATE_PASS: !!(lic >= 1 && root && plan?.mode === 'retrofit' && alloc && plan.groups?.status === 'allocated' && ct.allAir && ct.allFloor && !onPre.length &&
      (wellD === null || wellD >= 3) && after.intact && !unopened.length && disp && pl.rejected.length === 0),
    BASE_SHAPE: !!(lic === 0 && pl.gens === 0 && after.intact) })
}

// ================================================================ TP-CAS: three writers, a kill and a restart
scenes.tpcas = async () => {
  buildArena()
  const pool = `sbxtp-${RUN}-cas`
  let world = null
  // all three in town before the first tick (each ticks every 30 s from its own spawn)
  // founding bags: every bot writes reservations and placements concurrently (later generations), then one is killed mid-run.
  // On a tree where FOUND is dormant (townplan-01 alone) only maintenance writes: run this scene on found-01, or with FOUND=on
  const bag = [['chest', 3], ['crafting_table', 2], ['furnace', 2], ['stone_pickaxe', 1]]
  const files = [await startBot('tpcas', bag, { pool, onSpawn: async ({ skillLog }) => { world = await worldOf(skillLog) } })]
  for (let i = 1; i < 3; i++) files.push(await startBot('tpcas', bag, { pool, name: NAMES[i], standAt: at([-2 - i, 0]) }))
  const root = await waitFor(() => rootRow(files), 150000, 1000)
  await sleep(90000)
  // SIGKILL the third and restart it (its walk starts from the files)
  await stopBots([NAMES[2]], 'SIGKILL')
  const gBefore = (await planOf(files[0].poolDir, world)).gens
  files.push(await startBot('tpcas-restart', bag, { pool, name: NAMES[2], standAt: at([-5, 0]) }))
  await sleep(120000)
  const rows = rowsAll(files).filter(r => /^_townplan$/.test(r.name))
  await stopBots()
  const pl = await planOf(files[0].poolDir, world)
  const roots = rows.filter(r => /op=root result=accepted/.test(r.detail)).length
  const invalid = rows.filter(r => /result=invalid/.test(r.detail)).length
  const PS = await import(path.join(BOT_ROOT, 'bots/src/planstore.mjs'))
  const rootsOnDisk = PS.planGens(files[0].poolDir, PS.planKey(HOME)).filter(g => { try { return JSON.parse(fs.readFileSync(path.join(files[0].poolDir, `${PS.planKey(HOME)}.g${g}.json`), 'utf8')).prev === null } catch { return false } }).length
  result({ scene: 'tpcas', world, rows: rows.map(fmt).slice(-30), roots, rootsOnDisk, invalid, gens: pl.gens, accepted: pl.accepted.length, rejected: pl.rejected, gBefore,
    CANDIDATE_PASS: !!(root && roots === 1 && rootsOnDisk === 1 && invalid === 0 && pl.rejected.length === 0 && pl.accepted.length === pl.gens && pl.gens >= 5),
    BASE_SHAPE: !!(rows.length === 0 && pl.gens === 0) })
}

// ================================================================ TP-ZONES
scenes.tpzones = async () => {
  buildArena()
  const T = await import(path.join(BOT_ROOT, 'bots/src/townplan.mjs'))
  // the E orientation's store pad (u 7..15, v -4..4) under a zone
  const ePad = [HOME.x + 7, 100, HOME.z - 4, HOME.x + 15, 140, HOME.z + 4]
  const pool = `sbxtp-${RUN}-zones`
  let world = null
  const files = [await startBot('tpzones', IDLE_BAG, { pool, onSpawn: async ({ skillLog, poolDir }) => { world = await worldOf(skillLog); zonesFile(poolDir, world, [{ id: 'epad', kind: 'village', box: ePad }]) } })]
  const root = await waitFor(() => rootRow(files), 150000, 1000)
  const pl1 = await planOf(files[0].poolDir, world)
  // MID-RUN: a malformed file -- the last good list kept: no re-fit, nothing invalid, the plan unchanged
  fs.writeFileSync(path.join(files[0].poolDir, 'protected-zones.json'), '{"version": 1, "zones": [ {"id": broken')
  await sleep(75000)
  const pl2 = await planOf(files[0].poolDir, world)
  const midRows = rowsAll(files).filter(r => /^_townplan$/.test(r.name) && r.ts > (root?.ts ?? 0))
  await stopBots()
  // A FRESH POOL STARTED WITH THE MALFORMED FILE: no root, no found row; then the good file -> a root
  const pool2 = `sbxtp-${RUN}-zones2`
  let world2 = null
  // the malformed file is there BEFORE the process starts (a restart with it): the process never had a good read
  const pd2 = path.join(R, 'sandbox/state', `_pool-${pool2}`)
  fs.mkdirSync(pd2, { recursive: true }); fs.writeFileSync(path.join(pd2, 'protected-zones.json'), '{"version": 1, "zones": [ {"id": broken')
  const f2 = await startBot('tpzones2', FOUND_BAG, { pool: pool2, onSpawn: async ({ skillLog }) => { world2 = await worldOf(skillLog) } })
  await sleep(100000)
  const blocked = { root: !!rootRow([f2]), found: rowsAll([f2]).filter(r => r.name === '_found' && /outcome=placed/.test(r.detail)).length, mode: rowsAll([f2]).find(r => r.name === '_townplan_mode')?.detail ?? null }
  zonesFile(f2.poolDir, world2, [{ id: 'epad', kind: 'village', box: ePad }])
  const root2 = await waitFor(() => rootRow([f2]), 120000, 1000)
  await stopBots()
  const pl3 = await planOf(f2.poolDir, world2)
  void T
  result({ scene: 'tpzones', world, orient1: pl1.head?.plan?.orientation ?? null, gen1: pl1.head?.gen, gen2: pl2.head?.gen, midRows: midRows.map(fmt).slice(-10), blocked, root2: !!root2, orient3: pl3.head?.plan?.orientation ?? null,
    CANDIDATE_PASS: !!(root && pl1.head?.plan?.orientation && pl1.head.plan.orientation !== 'E' && !midRows.some(r => /result=invalid|op=refit/.test(r.detail)) &&
      JSON.stringify(pl2.head?.plan?.plots) === JSON.stringify(pl1.head?.plan?.plots) && !blocked.root && blocked.found === 0 && /zones=unknown/.test(blocked.mode ?? '') && root2 && pl3.head?.plan?.orientation !== 'E'),
    BASE_SHAPE: !!(!root && !root2) })
}

// ================================================================ TP-TEMP: craft's own temporary table beside the free station 0
scenes.tptemp = async () => {
  buildArena()
  const pool = `sbxtp-${RUN}-temp`
  let world = null
  const a = await startBot('tptemp', IDLE_BAG, { pool, env: { FOUND: 'off' }, onSpawn: async ({ skillLog }) => { world = await worldOf(skillLog) } })
  const root = await waitFor(() => rootRow([a]), 150000, 1000)
  const plan0 = (await planOf(a.poolDir, world)).head?.plan
  const s0 = stations(plan0)[0]
  if (!s0) { await stopBots(); result({ scene: 'tptemp', CANDIDATE_PASS: false, BASE_SHAPE: !root, why: 'no station 0 (base: no plan)' }); return }
  // the crafter stands west of station 0; every other neighbour walled (feet and head), so station 0 is the only floor spot left
  // and the station 0's own stand side stays open
  const bx = s0.at[0] - 1, bz = s0.at[2]
  const walls = []
  for (const [dx, dz] of [[-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) walls.push(`setblock ${bx + dx} ${HOME.y} ${bz + dz} minecraft:stone`, `setblock ${bx + dx} ${HOME.y + 1} ${bz + dz} minecraft:stone`)
  must(rcon(...walls), 'walls')
  const b = await startBot('tptemp', [['oak_planks', 12], ['stick', 4]], { pool, name: NAMES[1], env: { FOUND: 'off' }, standAt: { x: bx, y: HOME.y, z: bz } })
  brainQueue.push({ skill: 'craft', args: { item: 'wooden_pickaxe', count: 1 } }, { skill: 'craft', args: { item: 'wooden_pickaxe', count: 1 } })
  const crafted = await waitFor(() => rowsOf(b.skillLog).find(r => r.name === 'craft' && r.status === 'success'), 180000, 1000)
  await sleep(3000)
  const rows = rowsAll([a, b]).filter(r => /^craft$|^_townplan_place$|^_station|^_table/.test(r.name))
  await stopBots()
  const pl = await planOf(a.poolDir, world)
  const never = NEVER(pl.head?.plan)
  const tables = standing('crafting_table', HOME, 22, [HOME.y, HOME.y + 1])
  const onNever = tables.filter(t => never.has(t) && t !== K(s0.at))
  const s0now = stations(pl.head?.plan)[0]
  const bagB = crafted ? null : null
  void bagB
  result({ scene: 'tptemp', world, rows: rows.map(fmt).slice(-20), tables, onNever, s0: K(s0.at), s0state: s0now?.state, crafted: !!crafted,
    // station 0 was FREE: the second tier may use it (a temporary table), but the plan must not call it placed without a table there
    CANDIDATE_PASS: !!(root && crafted && !onNever.length && !(s0now?.state === 'placed' && !tables.includes(K(s0.at)))),
    BASE_SHAPE: null })
}

// ================================================================ the found scenes
async function plannedTown (scene, { bags = [FOUND_BAG, FOUND_BAG, FOUND_BAG], pool = `sbxtp-${RUN}-${scene}`, onRoot = null, env = {} } = {}) {
  let world = null
  const files = [await startBot(scene, bags[0], { pool, env, onSpawn: async ({ skillLog }) => { world = await worldOf(skillLog) } })]
  for (let i = 1; i < bags.length; i++) files.push(await startBot(scene, bags[i], { pool, env, name: NAMES[i], standAt: at([-2 - i, 0]) }))
  const root = await waitFor(() => rootRow(files), 150000, 1000)
  if (onRoot && root) await onRoot({ files, world })
  return { files, world, root, pool, poolDir: files[0].poolDir }
}
/** Wait until the plan says each wanted cell is placed AND the server has its block (or ms passes). */
async function untilPlaced (s, want, ms) {
  let last = null
  await waitFor(async () => {
    const plan = (await planOf(s.poolDir, s.world)).head?.plan
    if (!plan) return false
    const cells = want(plan)
    if (!cells.length || cells.some(c => !c)) return false
    const on = rcon(...cells.map(c => `execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${c.kind === 'chest' ? 'chest' : c.kind}`)).map(x => passed(x.reply))
    last = cells.map((c, i) => ({ kind: c.kind, at: K(c.at), state: c.state, role: c.role ?? null, group: c.group ?? null, on: on[i] }))
    return last.every(x => x.on && x.state === 'placed')
  }, ms, 15000)
  return last
}
function strayOf (plan, pre = new Set(), h = HOME) {
  const planCells = new Set(cellsOf(plan).map(c => K(c.at)))
  const st = { chest: standing('chest', h), crafting_table: standing('crafting_table', h), furnace: standing('furnace', h) }
  // STRAY = a CONTAINER (chest, furnace) outside the plan's cells ("0 containers outside plots"); a crafting table outside them is
  // craft's own temporary table (allowed off the plan) and is reported apart
  const off = k => st[k].filter(c => !planCells.has(c) && !pre.has(c)).map(c => `${k}@${c}`)
  return { standing: st, stray: [...off('chest'), ...off('furnace')], tablesOff: off('crafting_table') }
}
function lidsOf (cells) {
  if (!cells.length) return []
  const r = rcon(...cells.map(c => `execute unless block ${c.at[0]} ${c.at[1] + 1} ${c.at[2]} #minecraft:replaceable`)).map(x => passed(x.reply))
  return cells.filter((_, i) => r[i]).map(c => K(c.at))
}
const want3 = plan => [stations(plan).find(c => c.kind === 'crafting_table'), storeCells(plan).find(c => c.role === 'overflow') ?? storeCells(plan)[0], stations(plan).find(c => c.kind === 'furnace')]
function foundSummary (s, rows, extra = {}) {
  return { world: s.world, rows: rows.map(fmt).slice(-50), licence: rows.filter(r => r.name === '_found_mode').length,
    placed: rows.filter(r => r.name === '_found' && /outcome=placed/.test(r.detail)).length, ...extra }
}
const foundRows = files => rowsAll(files).filter(r => /^_found|^_townplan$|^_townplan_mode$|^craft$|^_deposit_new_chest$|^_town_deposit$/.test(r.name))

scenes.foundflat = async () => {
  buildArena()
  const bag = [['chest', 3], ['crafting_table', 2], ['furnace', 2], ['stone_pickaxe', 1], ['cobblestone', 64], ['oak_log', 32], ['iron_ingot', 6], ['wheat_seeds', 20], ['coal', 16]]
  const s = await plannedTown('foundflat', { bags: [bag, bag, bag] })
  const last = await untilPlaced(s, want3, 900000)
  // GROUP HOMES: the bags hold iron, seeds and coal (groups with no home); after each bot's 10-min cooldown and a new visit (the
  // brain walks them out of the town circle and back), F3 founds a home per group in the next store cells
  brainFar = true
  await waitFor(async () => storeCells((await planOf(s.poolDir, s.world)).head?.plan).filter(c => c.state === 'placed' && c.role === 'home').length >= 2, 1500000, 20000)
  brainFar = false
  const rows = foundRows(s.files)
  await stopBots()
  const plan = (await planOf(s.poolDir, s.world)).head?.plan
  const { standing: st, stray } = strayOf(plan)
  const placedStore = storeCells(plan).filter(c => c.state === 'placed')
  const lids = lidsOf(placedStore)
  const homes = placedStore.filter(c => c.role === 'home').map(c => `${c.group}@${K(c.at)}`)
  const { tablesOff } = strayOf(plan)
  const sum = foundSummary(s, rows, { want: last, standing: st, stray, tablesOff, lids, homes })
  result({ scene: 'foundflat', ...sum,
    CANDIDATE_PASS: !!(s.root && sum.licence >= 1 && last?.every(x => x.on && x.state === 'placed') && last[1].role === 'overflow' && !stray.length && !lids.length && homes.length >= 2),
    BASE_SHAPE: !!(sum.licence === 0 && sum.placed === 0) })
}

scenes.foundhour1 = async () => {
  buildArena()
  const bag = [['oak_log', 16], ['cobblestone', 20], ['crafting_table', 1]]
  const s = await plannedTown('foundhour1', { bags: [bag, bag, bag] })
  // the founding floor at hour 1: 28 planks and 4 cobblestone above it (found.test THE FOUNDING FLOOR) -- the table and the chest
  // are founded from these; the furnace (8 cobblestone above the floor) is not, by design, until the bots hold more stone
  const want2 = plan => [stations(plan).find(c => c.kind === 'crafting_table'), storeCells(plan).find(c => c.role === 'overflow') ?? storeCells(plan)[0]]
  const last = await untilPlaced(s, want2, 1200000)
  // afterwards: the givers' own pickaxe rungs (the ladder crafts wooden then stone)
  const picks = await waitFor(() => { const r = rowsAll(s.files).filter(x => x.name === 'craft' && x.status === 'success'); return ['wooden_pickaxe', 'stone_pickaxe'].every(n => r.some(x => (x.args?.item ?? '') === n || x.detail.includes(n))) && r }, 900000, 10000)
  const rows = foundRows(s.files)
  const bags = NAMES.map(n => bagOf(n))
  await stopBots()
  const plan = (await planOf(s.poolDir, s.world)).head?.plan
  const { stray } = strayOf(plan)
  const sum = foundSummary(s, rows, { want: last, stray, bags, picks: !!picks })
  result({ scene: 'foundhour1', ...sum,
    CANDIDATE_PASS: !!(s.root && sum.licence >= 1 && last?.every(x => x.on && x.state === 'placed') && !stray.length && picks),
    BASE_SHAPE: !!(sum.licence === 0 && sum.placed === 0) })
}

scenes.foundbare = async () => {
  buildArena({ ground: 'grass_block' })
  // a few trees and a stone patch west of home (outside every orientation's E/S/N pads... the W pad keeps trees within r 16)
  const trees = [[-12, -12], [-14, 10], [-10, 14], [12, -14], [14, 12]]
  const c = [`fill ${HOME.x - 20} ${G - 3} ${HOME.z - 2} ${HOME.x - 17} ${G} ${HOME.z + 2} minecraft:stone`]
  for (const [dx, dz] of trees) { const p = at([dx, dz]); c.push(`fill ${p.x} ${p.y} ${p.z} ${p.x} ${p.y + 4} ${p.z} minecraft:oak_log`, `fill ${p.x - 2} ${p.y + 3} ${p.z - 2} ${p.x + 2} ${p.y + 5} ${p.z + 2} minecraft:oak_leaves[persistent=true] keep`) }
  must(rcon(...c), 'trees')
  const s = await plannedTown('foundbare', { bags: [[], [], []] })
  const last = await untilPlaced(s, want3, 2400000)
  const rows = foundRows(s.files)
  await stopBots()
  const plan = (await planOf(s.poolDir, s.world)).head?.plan
  const { stray } = strayOf(plan)
  const sum = foundSummary(s, rows, { want: last, stray, gathers: rowsAll(s.files).filter(r => /^(gather|mine)$/.test(r.name) && r.status === 'success').length })
  result({ scene: 'foundbare', ...sum,
    CANDIDATE_PASS: !!(s.root && sum.licence >= 1 && last?.every(x => x.on && x.state === 'placed') && !stray.length),
    BASE_SHAPE: !!(sum.licence === 0 && sum.placed === 0) })
}

scenes.foundrough = async () => {
  buildArena()
  // holes, a slope and a pond: a 3x3 hole NE, a slope W (steps up), a pond S
  const c = [`fill ${HOME.x + 3} ${G - 2} ${HOME.z - 6} ${HOME.x + 5} ${G} ${HOME.z - 4} minecraft:air`,
    `fill ${HOME.x - 3} ${G - 1} ${HOME.z + 5} ${HOME.x + 2} ${G} ${HOME.z + 9} minecraft:water`]
  for (let i = 0; i < 5; i++) c.push(`fill ${HOME.x - 16 + i * 2} ${G + 1} ${HOME.z - 6} ${HOME.x - 15 + i * 2} ${G + 1 + (4 - i) % 3} ${HOME.z + 6} minecraft:dirt`)
  for (let i = 0; i < 6; i++) c.push(`setblock ${HOME.x + 8 + i} ${G} ${HOME.z + (i % 2 ? 1 : -1)} minecraft:air`)
  must(rcon(...c), 'rough')
  const s = await plannedTown('foundrough')
  const last = await untilPlaced(s, want3, 900000)
  const rows = foundRows(s.files)
  await stopBots()
  const pl = await planOf(s.poolDir, s.world)
  const plan = pl.head?.plan
  // no placement on an unready cell: every placed plan cell sits on a solid floor with no liquid next to it
  const placed = cellsOf(plan).filter(c => c.state === 'placed')
  const floor = placed.length ? rcon(...placed.map(c => `execute unless block ${c.at[0]} ${c.at[1] - 1} ${c.at[2]} #minecraft:replaceable`)).map(x => passed(x.reply)) : []
  const { stray } = strayOf(plan)
  const sum = foundSummary(s, rows, { want: last, orient: plan?.orientation, mode: plan?.mode, floorOk: floor.every(Boolean), stray })
  result({ scene: 'foundrough', ...sum,
    CANDIDATE_PASS: !!(s.root && plan?.mode === 'greenfield' && plan.orientation && floor.every(Boolean) && !stray.length && last?.some(x => x.on)),
    BASE_SHAPE: !!(sum.licence === 0 && sum.placed === 0) })
}

scenes.foundcanopy = async () => {
  buildArena()
  // the plan first (FOUND off), then the store cells dressed, then founders (FOUND on)
  const pool = `sbxtp-${RUN}-canopy`
  const p0 = await plannedTown('foundcanopy-plan', { bags: [IDLE_BAG], pool, env: { FOUND: 'off' } })
  await stopBots()
  const plan0 = (await planOf(p0.poolDir, p0.world)).head?.plan
  const sc = storeCells(plan0)
  if (sc.length < 7) { result({ scene: 'foundcanopy', CANDIDATE_PASS: false, BASE_SHAPE: !p0.root, why: 'no 7-cell store (base: no plan)' }); return }
  // fill order: overflow(0), then 1..6. 0: large fern; 1: tall grass; 2: under spruce leaves; 3: beside a spruce trunk (side);
  // 4: TWO snow layers (not READY); 5: MUD above (a lid: not READY); 6: plain
  const [c0, c1, c2, c3, c4, c5] = sc.map(c => c.at)
  const cmd = [
    `setblock ${c0[0]} ${c0[1]} ${c0[2]} minecraft:large_fern[half=lower]`, `setblock ${c0[0]} ${c0[1] + 1} ${c0[2]} minecraft:large_fern[half=upper]`,
    `setblock ${c1[0]} ${c1[1]} ${c1[2]} minecraft:tall_grass[half=lower]`, `setblock ${c1[0]} ${c1[1] + 1} ${c1[2]} minecraft:tall_grass[half=upper]`,
    `setblock ${c2[0]} ${c2[1] + 1} ${c2[2]} minecraft:spruce_leaves[persistent=true]`,
    `setblock ${c3[0]} ${c3[1]} ${c3[2] + (c3[2] > c2[2] ? 1 : -1)} minecraft:spruce_log`,
    `setblock ${c4[0]} ${c4[1]} ${c4[2]} minecraft:snow[layers=2]`,
    `setblock ${c5[0]} ${c5[1] + 1} ${c5[2]} minecraft:mud`]
  must(rcon(...cmd), 'canopy')
  const bag = [['chest', 4], ['stone_pickaxe', 1], ['oak_log', 16], ['cobblestone', 32], ['iron_ingot', 4], ['wheat_seeds', 20], ['coal', 16], ['flint', 30], ['oak_sapling', 10]]
  let world = p0.world
  const files = [await startBot('foundcanopy', bag, { pool, onSpawn: async ({ skillLog }) => { world = await worldOf(skillLog) } })]
  for (let i = 1; i < 3; i++) files.push(await startBot('foundcanopy', bag, { pool, name: NAMES[i], standAt: at([-2 - i, 0]) }))
  const s = { files, world, root: true, poolDir: files[0].poolDir }
  const tStart = Date.now()
  await untilPlaced(s, plan => [storeCells(plan)[0], storeCells(plan)[1], storeCells(plan)[2]], 1500000)
  await sleep(30000)
  const rows = foundRows(files)
  await stopBots()
  const plan = (await planOf(s.poolDir, world)).head?.plan
  const cells = storeCells(plan)
  const on = blockIs(cells.map(c => c.at), 'chest')
  const opened = await opensAfter(s.poolDir, tStart)
  const status = cells.map((c, i) => ({ at: K(c.at), state: c.state, chest: on[i], opened: opened.has(K(c.at)) }))
  const sum = foundSummary(s, rows, { status, base: !p0.root })
  result({ scene: 'foundcanopy', ...sum,
    CANDIDATE_PASS: !!(p0.root && [0, 1, 2].every(i => status[i].chest && status[i].state === 'placed' && status[i].opened) && !status[4].chest && !status[5].chest),
    BASE_SHAPE: !!(sum.licence === 0 && sum.placed === 0) })
}

scenes.foundnofit = async () => {
  brainPoints = [{ x: HOME.x + 1, y: HOME.y, z: HOME.z }, { x: HOME.x - 1, y: HOME.y, z: HOME.z }]
  const out = []
  for (const n of [1, 2, 3, 4, 5]) {
    // an air arena; home on a 3x3 dirt pad; a 1-wide walkway east to x+6; n ground cells at radius 7 (x+7, z 0, +1, -1, +2, -2)
    must(rcon(`kill ${ARENA_SEL(A)}`, ...fillChunks(A, 112, 140, 'air')), 'air arena')
    const c = [`fill ${HOME.x - 1} ${G - 2} ${HOME.z - 1} ${HOME.x + 1} ${G} ${HOME.z + 1} minecraft:dirt`, `fill ${HOME.x + 2} ${G - 2} ${HOME.z} ${HOME.x + 6} ${G} ${HOME.z} minecraft:dirt`]
    const zs = [0, 1, -1, 2, -2].slice(0, n)
    for (const z of zs) c.push(`fill ${HOME.x + 7} ${G - 2} ${HOME.z + z} ${HOME.x + 7} ${G} ${HOME.z + z} minecraft:dirt`)
    must(rcon(...c), 'nofit')
    const bag = [['chest', 3], ['crafting_table', 2], ['furnace', 2], ['stone_pickaxe', 1]]
    const s = await plannedTown(`foundnofit${n}`, { bags: [bag, bag] })
    await sleep(240000)
    const rows = foundRows(s.files)
    await stopBots()
    const plan = (await planOf(s.poolDir, s.world)).head?.plan
    const store = plan?.plots?.find(p => p.id === 'store')
    const { standing: st, stray } = strayOf(plan, new Set(), HOME)
    out.push({ n, store: store?.kind ?? null, cells: (store?.cells ?? []).map(x => `${x.state}@${K(x.at)}`), work: stations(plan).map(x => `${x.kind}:${x.state}`), standing: st, stray,
      table: st.crafting_table.length, chests: st.chest.length, placedRows: rows.filter(r => r.name === '_found' && /outcome=placed/.test(r.detail)).length, licence: rows.filter(r => r.name === '_found_mode').length })
  }
  const ok = out.every(o => !o.stray.length && o.table >= 1 && (o.n === 1 ? o.store === 'unplaced' && o.chests === 0 : o.chests >= 1))
  result({ scene: 'foundnofit', arenas: out, CANDIDATE_PASS: ok, BASE_SHAPE: out.every(o => o.licence === 0 && o.placedRows === 0) })
}

scenes.foundnone = async () => {
  brainPoints = [{ x: HOME.x + 1, y: HOME.y, z: HOME.z }, { x: HOME.x - 1, y: HOME.y, z: HOME.z }]
  // home on a 1x1 dirt pillar in water (no READY cell anywhere); the bot keeps working: a named work row (craft) succeeds
  must(rcon(`kill ${ARENA_SEL(A)}`, ...fillChunks(A, 112, 140, 'air'), ...fillChunks(A, 113, G - 1, 'dirt'), ...fillChunks(A, G, G, 'water'), `setblock ${HOME.x} ${G} ${HOME.z} minecraft:dirt`), 'pillar')
  const s = await plannedTown('foundnone', { bags: [[['chest', 2], ['crafting_table', 2], ['oak_log', 16], ['stone_pickaxe', 1]]] })
  brainQueue.push({ skill: 'craft', args: { item: 'oak_planks', count: 4 } }, { skill: 'craft', args: { item: 'stick', count: 4 } })
  await sleep(180000)
  const rows = foundRows(s.files)
  await stopBots()
  const plan = (await planOf(s.poolDir, s.world)).head?.plan
  const { standing: st } = strayOf(plan)
  const work = rows.filter(r => r.name === 'craft' && r.status === 'success').length
  const sum = foundSummary(s, rows, { store: plan?.plots?.find(p => p.id === 'store')?.kind ?? null, standing: st, work })
  result({ scene: 'foundnone', ...sum,
    CANDIDATE_PASS: !!(sum.placed === 0 && !st.chest.length && !st.furnace.length && work >= 1 && (!plan || plan.plots.find(p => p.id === 'store')?.kind === 'unplaced')),
    BASE_SHAPE: !!(sum.licence === 0 && sum.placed === 0 && work >= 1) })
}

scenes.foundkill = async () => {
  buildArena()
  const pool = `sbxtp-${RUN}-kill`
  // a WATCHER (FOUND off: never founds) keeps ticking the plan; a FOUNDER is SIGKILLed the moment its reservation appears (case A),
  // then a second founder the moment its block stands but the plan still says reserved (case B)
  const w = await plannedTown('foundkill-watch', { bags: [IDLE_BAG], pool, env: { FOUND: 'off' } })
  const watch = async (name, standAt, bag, killWhen) => {
    const f = await startBot('foundkill', bag, { pool, name, standAt })
    let killed = null
    await waitFor(async () => {
      const plan = (await planOf(w.poolDir, w.world)).head?.plan
      const r = cellsOf(plan).find(c => c.state === 'reserved' && c.by === name)
      if (!r) return false
      if (killWhen === 'reserved') { procs[name].kill('SIGKILL'); delete procs[name]; killed = { at: K(r.at), kind: r.kind, role: r.role ?? null, until: r.until }; return true }
      if (passed(r1(`execute if block ${r.at[0]} ${r.at[1]} ${r.at[2]} minecraft:${r.kind}`))) { procs[name].kill('SIGKILL'); delete procs[name]; killed = { at: K(r.at), kind: r.kind, role: r.role ?? null, until: r.until }; return true }
      return false
    }, 420000, 150)   // B may wait out A's found lease (4 min) after A's kill
    return killed
  }
  const kA = await watch(NAMES[1], at([-3, 0]), [['crafting_table', 2], ['stone_pickaxe', 1]], 'reserved')
  await sleep(5000)
  const kB = await watch(NAMES[2], at([-4, 0]), [['chest', 2], ['stone_pickaxe', 1]], 'placed')
  // wait out until + 60 s + 10 min + a tick for the orphans to resolve (expired, or observed placed with the intent)
  const deadline = Math.max(kA?.until ?? 0, kB?.until ?? 0) + 60_000 + 10 * 60_000 + 90_000
  await waitFor(() => Date.now() > deadline, 1800000, 10000)
  await sleep(60000)
  const rows = rowsAll(w.files).filter(r => /^_townplan$/.test(r.name))
  await stopBots()
  const plan = (await planOf(w.poolDir, w.world)).head?.plan
  const cellAt = k => cellsOf(plan).find(c => K(c.at) === k)
  const a = kA && cellAt(kA.at), b = kB && cellAt(kB.at)
  const stuck = cellsOf(plan).filter(c => c.state === 'reserved').map(c => K(c.at))
  const st = { chest: standing('chest'), crafting_table: standing('crafting_table') }
  result({ scene: 'foundkill', world: w.world, killedA: kA, killedB: kB, cellA: a && { state: a.state, role: a.role ?? null, seen: a.seenSince ?? null }, cellB: b && { state: b.state, role: b.role ?? null }, stuck, standing: st,
    rows: rows.map(fmt).slice(-20),
    CANDIDATE_PASS: !!(kA && kB && a?.state === 'free' && b?.state === 'placed' && (b.role ?? null) === (kB.role ?? null) && !stuck.length && st.chest.length === 1),
    BASE_SHAPE: !!(!w.root) })
}

scenes.foundretro = async () => {
  buildArena(); buildBench({ well: false })
  const before = benchTruth()
  const bag = [['crafting_table', 1], ['furnace', 1], ['oak_log', 16], ['cobblestone', 32], ['stone_pickaxe', 1]]
  const s = await plannedTown('foundretro', { bags: [bag, bag] })
  const last = await untilPlaced(s, plan => [stations(plan).find(c => c.kind === 'crafting_table'), stations(plan).find(c => c.kind === 'furnace')], 900000)
  await sleep(30000)
  const rows = foundRows(s.files)
  const bags = NAMES.slice(0, 2).map(n => bagOf(n))
  await stopBots()
  const after = benchTruth()
  const plan = (await planOf(s.poolDir, s.world)).head?.plan
  const { stray } = strayOf(plan, PRE())
  const sum = foundSummary(s, rows, { want: last, mode: plan?.mode, stray, bags, intact: after.intact, missing: after.missing, itemsSame: JSON.stringify(after.items) === JSON.stringify(before.items) })
  result({ scene: 'foundretro', ...sum,
    CANDIDATE_PASS: !!(s.root && plan?.mode === 'retrofit' && last?.every(x => x.on && x.state === 'placed') && after.intact && !stray.length && bags.every(b => (b.crafting_table ?? 0) >= 1)),
    BASE_SHAPE: !!(sum.licence === 0 && sum.placed === 0 && after.intact) })
}

/** Greenfield with every store cell placed and FULL (chests set by RCON, then observed by the watcher: two reads 10 min apart). */
const WOOLS = ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool']
async function fullStore (scene, pool, { unique = false } = {}) {
  const w = await plannedTown(`${scene}-watch`, { bags: [IDLE_BAG], pool, env: { FOUND: 'off' } })
  const plan0 = (await planOf(w.poolDir, w.world)).head?.plan
  const sc = storeCells(plan0)
  // full of cobblestone; with `unique`, slot 0 holds one wool of a colour only that chest has (a withdraw of it is an OPEN of it)
  sc.forEach((c, i) => setChest({ x: c.at[0], y: c.at[1], z: c.at[2] }, Array.from({ length: 27 }, (_, j) => (unique && j === 0 ? [WOOLS[i], 1] : ['cobblestone', 64]))))
  await waitFor(async () => storeCells((await planOf(w.poolDir, w.world)).head?.plan).every(c => c.state === 'placed'), 1500000, 20000)
  return { w, sc }
}
scenes.foundsoft = async () => {
  buildArena()
  const pool = `sbxtp-${RUN}-soft`
  const { w } = await fullStore('foundsoft', pool)
  const observed = storeCells((await planOf(w.poolDir, w.world)).head?.plan).every(c => c.state === 'placed')
  const f = await startBot('foundsoft', fillBag([['chest', 2], ['stone_pickaxe', 1], ['oak_log', 20], ['flint', 64], ['wheat_seeds', 30]]), { pool, name: NAMES[1], standAt: at([-3, 0]) })
  const dep = await waitFor(() => rowsOf(f.skillLog).find(r => r.name === '_deposit_new_chest' && / tier=/.test(r.detail) && /placed=1/.test(r.detail)), 600000, 3000)
  await sleep(10000)
  const rows = rowsAll([w.files[0], f]).filter(r => /^_deposit_new_chest$|^_town_deposit$|^deposit$/.test(r.name))
  await stopBots()
  const plan = (await planOf(w.poolDir, w.world)).head?.plan
  const T = await import(path.join(BOT_ROOT, 'bots/src/townplan.mjs'))
  const atS = dep && /at=(-?\d+),(-?\d+),(-?\d+)/.exec(dep.detail)
  const cell = atS ? [+atS[1], +atS[2], +atS[3]] : null
  const never = NEVER(plan)
  const mcData = req('minecraft-data')('1.21.8')
  void mcData
  const reach = rcon(...storeCells(plan).map(c => `execute if block ${c.at[0]} ${c.at[1] + 1} ${c.at[2]} #minecraft:replaceable`)).map(x => passed(x.reply))
  const noSite = rows.filter(r => r.name === '_deposit_new_chest' && /site=none/.test(r.detail)).length
  result({ scene: 'foundsoft', world: w.world, observed, rows: rows.map(fmt).slice(-20), dep: dep?.detail?.slice(0, 200) ?? null, cell: cell && K(cell), tier: (dep?.detail.match(/ tier=(\w+)/) || [])[1] ?? null, onNever: cell ? never.has(K(cell)) : null, lidsClear: reach.every(Boolean), noSite,
    note: 'every placed cell reachable: read as lids clear + the walk the recovery itself ran (ACCESS on soft/box); FOUND-ACCESS opens them',
    // a SECTION placement is the recovery's own reservation of a plan (extra) cell -- legitimate; anything else never a NEVER cell
    CANDIDATE_PASS: !!(observed && dep && cell && (/ tier=section /.test(dep.detail) || !never.has(K(cell))) && reach.every(Boolean) && noSite === 0),
    BASE_SHAPE: !!(!w.root && dep) })
  void T
}
scenes.foundbox = async () => {
  brainPoints = [{ x: HOME.x + 1, y: HOME.y, z: HOME.z }, { x: HOME.x - 1, y: HOME.y, z: HOME.z }]
  // the only ground: home, a 1-wide walkway east, and the E storehouse box (u 7..15, v -4..4) -- the recovery's rings around the
  // full store chests find valid cells only inside the box
  must(rcon(`kill ${ARENA_SEL(A)}`, ...fillChunks(A, 112, 140, 'air')), 'air arena')
  must(rcon(`fill ${HOME.x - 2} ${G - 2} ${HOME.z - 2} ${HOME.x + 2} ${G} ${HOME.z + 2} minecraft:dirt`, `fill ${HOME.x + 3} ${G - 2} ${HOME.z} ${HOME.x + 6} ${G} ${HOME.z} minecraft:dirt`,
    `fill ${HOME.x + 6} ${G - 2} ${HOME.z - 5} ${HOME.x + 16} ${G} ${HOME.z + 5} minecraft:dirt`, `fill ${HOME.x - 2} ${G - 2} ${HOME.z + 3} ${HOME.x + 2} ${G} ${HOME.z + 7} minecraft:dirt`), 'box ground')
  const pool = `sbxtp-${RUN}-box`
  const { w } = await fullStore('foundbox', pool)
  const f = await startBot('foundbox', fillBag([['chest', 2], ['stone_pickaxe', 1], ['oak_log', 20], ['flint', 64]]), { pool, name: NAMES[1], standAt: at([-1, 0]) })
  const dep = await waitFor(() => rowsOf(f.skillLog).find(r => r.name === '_deposit_new_chest' && /placed=1|site=none/.test(r.detail)), 600000, 3000)
  await sleep(10000)
  await stopBots()
  const plan = (await planOf(w.poolDir, w.world)).head?.plan
  const atS = dep && /at=(-?\d+),(-?\d+),(-?\d+)/.exec(dep.detail)
  const cell = atS ? [+atS[1], +atS[2], +atS[3]] : null
  const sb = plan?.plots?.find(p => p.id === 'store')?.box
  const inBox = !!(cell && sb && cell[0] >= sb[0] - 1 && cell[0] <= sb[2] + 1 && cell[2] >= sb[1] - 1 && cell[2] <= sb[3] + 1)
  const never = NEVER(plan)
  result({ scene: 'foundbox', world: w.world, plan: plan ? { orient: plan.orientation, box: sb } : null, dep: dep?.detail?.slice(0, 220) ?? null, cell: cell && K(cell), inBox, tier: (dep?.detail.match(/ tier=(\w+)/) || [])[1] ?? null, onNever: cell ? never.has(K(cell)) : null,
    CANDIDATE_PASS: !!(dep && cell && !never.has(K(cell)) && / tier=box /.test(dep.detail) && inBox),
    // the base (no plan): it places in the same ground (the only valid cells)
    BASE_SHAPE: !!(!w.root && dep && /placed=1/.test(dep.detail)) })
}
scenes.foundaccess = async () => {
  brainPoints = [{ x: HOME.x + 1, y: HOME.y, z: HOME.z }, { x: HOME.x - 1, y: HOME.y, z: HOME.z }]
  // as foundbox, but the E box reached from home only through ONE cell (the walkway end at x+6, z 0), and that cell is the cheapest
  // recovery candidate: ACCESS must refuse it
  must(rcon(`kill ${ARENA_SEL(A)}`, ...fillChunks(A, 112, 140, 'air')), 'air arena')
  must(rcon(`fill ${HOME.x - 2} ${G - 2} ${HOME.z - 2} ${HOME.x + 2} ${G} ${HOME.z + 2} minecraft:dirt`, `fill ${HOME.x + 3} ${G - 2} ${HOME.z} ${HOME.x + 6} ${G} ${HOME.z} minecraft:dirt`,
    `fill ${HOME.x + 7} ${G - 2} ${HOME.z - 5} ${HOME.x + 16} ${G} ${HOME.z + 5} minecraft:dirt`), 'access ground')
  const pool = `sbxtp-${RUN}-access`
  const { w, sc } = await fullStore('foundaccess', pool, { unique: true })
  const f = await startBot('foundaccess', fillBag([['chest', 2], ['stone_pickaxe', 1], ['oak_log', 20], ['flint', 64]]), { pool, name: NAMES[1], standAt: at([-1, 0]) })
  const tStart = Date.now()
  const dep = await waitFor(() => rowsOf(f.skillLog).find(r => r.name === '_deposit_new_chest' && /placed=1|site=none/.test(r.detail)), 600000, 3000)
  // EVERY store container then OPENED by the bot: a model `withdraw` of the one wool only that chest holds -- the bag gaining
  // it is the server's proof of the open (a room first: the bot's own bag is emptied of rocks by RCON)
  rcon(`clear ${NAMES[1]} minecraft:andesite`, `clear ${NAMES[1]} minecraft:diorite`, `clear ${NAMES[1]} minecraft:granite`, `clear ${NAMES[1]} minecraft:calcite`)
  const wools = sc.map((_, i) => WOOLS[i])
  for (const wl of wools) brainQueue.push({ skill: 'withdraw', args: { item: wl, count: 1 } })
  await waitFor(() => { const b = bagOf(NAMES[1]); return wools.every(x => (b[x] ?? 0) >= 1) }, 600000, 10000)
  const bagNow = bagOf(NAMES[1])
  await stopBots()
  const plan = (await planOf(w.poolDir, w.world)).head?.plan
  const atS = dep && /at=(-?\d+),(-?\d+),(-?\d+)/.exec(dep.detail)
  const cell = atS ? [+atS[1], +atS[2], +atS[3]] : null
  void tStart
  const unopened = wools.filter(x => !(bagNow[x] >= 1))
  const neck = `${HOME.x + 6},${HOME.y},${HOME.z}`
  result({ scene: 'foundaccess', world: w.world, dep: dep?.detail?.slice(0, 220) ?? null, cell: cell && K(cell), neck, onNeck: cell ? K(cell) === neck : null, opened: wools.length - unopened.length, of: wools.length, unopened, gen: plan?.gen,
    CANDIDATE_PASS: !!(dep && cell && K(cell) !== neck && /placed=1/.test(dep.detail) && wools.length && !unopened.length),
    BASE_SHAPE: !!(!w.root && dep) })
}

// ================================================================ FOUND-PLINTH: the raised well planned under a plan
// Phase 1: an idle planner (FOUND off) writes the root on the flat arena (the E orientation: its storehouse box u 7..15 is where
// the cheapest plinth candidates near home lie). Phase 2: a bot with a funded build bag -> build_plinth plans the town's raised
// well (plinth-first is the fleet's policy); its cap and every placed cell are read from the town's own plinth record and judged
// against the plan: never a NEVER cell, never inside a committed box + 1 in passes 1-2, the `_townplan_adopt what=plinth` row.
// The BASE (no plan) on the same arena shows where the cheapest candidate lies (the discrimination). ONLY-BOX (the only feasible
// plinth inside the committed box) is proven in the fake world (townplan-adopters RAISED WELL), not here.
scenes.foundplinth = async () => {
  brainPoints = [{ x: HOME.x + 1, y: HOME.y, z: HOME.z }, { x: HOME.x - 1, y: HOME.y, z: HOME.z }]
  buildArena()
  // ground only EAST of home (x >= home + 3) plus a 5x5 pad at home: the plan fits E (its storehouse box u 7..15 and its
  // workshop strip are the ground nearest home), and the cheapest raised-well candidate -- with no plan -- lies in that box
  must(rcon(...fillChunks({ x0: A.x0, x1: HOME.x + 2, z0: A.z0, z1: A.z1 }, 112, G, 'air'), `fill ${HOME.x - 2} ${G - 6} ${HOME.z - 2} ${HOME.x + 2} ${G} ${HOME.z + 2} minecraft:dirt`), 'east ground')
  const pool = `sbxtp-${RUN}-plinth`
  // the planner bot must not plan the raised well before the root (plinth-first plans with no funds): PLINTH_FIRST=0 for it
  const w = await plannedTown('foundplinth-plan', { bags: [IDLE_BAG], pool, env: { FOUND: 'off', PLINTH_FIRST: '0' } })
  await stopBots()
  const bag = [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['oak_trapdoor', 2], ['dirt', 8]]
  const f = await startBot('foundplinth', bag, { pool, name: NAMES[1], env: { FOUND: 'off', PLINTH_COOLDOWN_MS: 20000 } })
  // the plan may be made by EITHER bot (plinth-first plans with no funds: the planner bot may plan it before it stops)
  const all = () => rowsAll([...w.files, f])
  const planned = await waitFor(() => all().find(r => r.name === '_plinth' && /stage=planned|stage=none/.test(r.detail)), 600000, 3000)
  await sleep(3000)
  const rows = all().filter(r => /^_plinth$|^_townplan_adopt$|^_well_refused$/.test(r.name))
  await stopBots()
  let rec = null
  try { rec = JSON.parse(fs.readFileSync(fs.readdirSync(f.poolDir).filter(n => /^junkwell-plinth-.*\.json$/.test(n)).map(n => path.join(f.poolDir, n))[0], 'utf8')) } catch { rec = null }
  const plan = (await planOf(f.poolDir, w.world)).head?.plan
  const cap = rec?.plan?.cap ?? null
  const placeCells = (rec?.plan?.steps ?? []).filter(st => st.op === 'place' && Array.isArray(st.c)).map(st => st.c)
  const never = NEVER(plan)
  const onNever = [cap && [cap.x, cap.y, cap.z], ...placeCells].filter(Boolean).filter(c => never.has(K(c))).map(K)
  const boxes = (plan?.plots ?? []).filter(p => Array.isArray(p.box) && p.keepout).map(p => ({ id: p.id, b: p.box }))
  const inBox = c => boxes.filter(({ b }) => c[0] >= b[0] - 1 && c[0] <= b[2] + 1 && c[2] >= b[1] - 1 && c[2] <= b[3] + 1).map(x => x.id)
  const capIn = cap ? inBox([cap.x, cap.y, cap.z]) : []
  const adopt = rows.find(r => r.name === '_townplan_adopt' && /what=plinth/.test(r.detail))
  result({ scene: 'foundplinth', world: w.world, rows: rows.map(fmt).slice(-12), cap, cost: rec?.plan?.cost ?? null, capIn, onNever, adopt: adopt?.detail ?? null, orient: plan?.orientation ?? null,
    store: plan?.plots?.find(p => p.id === 'store')?.box ?? null,
    CANDIDATE_PASS: !!(w.root && planned && /stage=planned/.test(planned.detail) && cap && !onNever.length && !capIn.length && adopt && / never=0$/.test(adopt.detail)),
    BASE_SHAPE: !!(!w.root && planned && /stage=planned/.test(planned.detail) && cap) })
}

async function main () {
  const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
  const owner = process.env.LOCK_OWNER || 'townplan'
  if (!new RegExp(owner).test(lock)) throw new Error(`the sandbox lock is not held for ${owner}: ` + lock.trim().slice(0, 160))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} sha=${SHA} server=${SERVER} scenes=${SCENES_S}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  for (const s of SCENES_S.split(',')) {
    P('=== scene', s)
    try { await scenes[s]() } catch (e) { P('SCENE FAILED', s, e.stack || e.message); result({ scene: s, error: String(e.message).slice(0, 300), CANDIDATE_PASS: false, BASE_SHAPE: false }); await stopBots().catch(() => {}) }
    brainQueue.length = 0; brainPoints = null; brainFar = false; brainHome = HOME
  }
}
async function cleanup () {
  await stopBots().catch(() => {})
  try { brain.close() } catch {}
  for (const n of NAMES) { try { fs.unlinkSync(`${R}/sandbox/.env.townplan-e2e-${n}`) } catch {} }
  try {
    const sb = { x0: SHOW.dx - 46, x1: SHOW.dx + 46, z0: SHOW.dz - 46, z1: SHOW.dz + 46 }
    P('cleanup', rcon(`kill ${ARENA_SEL(A)}`, ...fillChunks(A, 112, 140, 'air'), `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, `forceload remove ${sb.x0} ${sb.z0} ${sb.x1} ${sb.z1}`, 'list')
      .slice(-3).map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`))
  } catch (e) { P('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
