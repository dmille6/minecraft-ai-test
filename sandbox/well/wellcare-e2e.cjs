// SANDBOX-ONLY scenes for wellcare-01 (the well clean-up bundle). The REAL bot (src/index.mjs from <botRoot>, unmodified)
// is driven by the loopback brain; after each scene the server is asked, read-only, what the world holds.
//
//   node sandbox/well/wellcare-e2e.cjs <botRoot> <label> [server] [scenes=mine,deep,table]
//
//   mine   a raised well (a plinth-01/02 shell: k=4, cap g=123 on the slab top 119, its record in the pool's store) and a
//          bot on its south stand ordered `mine`. Read back: every one of the 81 shell cells still cobblestone, the cap
//          and floor trapdoors still there; the mine result and the bot's _mine_well_guard rows.
//   deep   a low town (dirt 60..66 over stone) with a dug junk well (cap 1300,66,1315, 15 from home) and a bot with a full bag
//          of junk in a room 22 below the stand (y 45, under sea level) with a mine stair, under home. 60 s of the loop's own
//          decisions (the brain proposes `status`): the base gives dispose_well from down there, the candidate holds it
//          (_well_deep action=hold remedy=surface). Then the brain proposes `surface` (the real skill) and up to 200 s more for
//          dispose_well. Read back: the order sequence with the bot's height at each.
//   table  the plinth again, two blocks on its south corners (town furniture), the bot on the south stand with a table,
//          planks and sticks, ordered `craft wooden_pickaxe` (no table within 32: the craft puts its own down). Read back:
//          where the table went (_table_retaken / _station_placed rows) against the well's cells, and the cap column.
//
// Run it twice: the base (the positive control) and the candidate. RCON only through
// `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. Refuses a non-sandbox server, refuses to run unless the
// sandbox lock on 10.0.0.31 names `wellcare`, and refuses a server with anyone on it.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, LABEL, SERVER = 'sandbox3', SCENES = 'mine,deep,table'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL) throw new Error('usage: node wellcare-e2e.cjs <botRoot> <label> [server] [scenes]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.WELL_REPO || path.resolve(__dirname, '../..')
const NAME = 'sandbox-Wcare'
const OUT = process.env.WELL_OUT || `${R}/sandbox/log/wellcare-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-wcare-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const bad = r => r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Expected/i.test(x.reply))

// ---- the arena: a dirt slab y 113..119 (well-e2e's), x/z 1297..1333 ----------------------------------------------------
const A = { x0: 1297, x1: 1333, z0: 1297, z1: 1333 }
const G = 119
const ARENA_SEL = `@e[type=item,x=${A.x0},y=40,z=${A.z0},dx=${A.x1 - A.x0},dy=100,dz=${A.z1 - A.z0}]`
// the plinth: cap g = 123 (k = 4 over the surface t = 119), the 81 shell cells of plinth.mjs (g: 3x3 minus the cap; g-1: 5x5
// minus the shaft; g-2: 5x5; g-3: 5x5 minus the centre); the floor trapdoor in the shaft at g-1, the cap trapdoor at g
const PC = { x: 1305, y: 123, z: 1305 }
const SHELL = []
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
  const r = Math.max(Math.abs(dx), Math.abs(dz)), x = PC.x + dx, z = PC.z + dz
  if (r === 1) SHELL.push({ x, y: PC.y, z })
  if (r >= 1) SHELL.push({ x, y: PC.y - 1, z })
  SHELL.push({ x, y: PC.y - 2, z })
  if (r >= 1) SHELL.push({ x, y: PC.y - 3, z })
}
// THE DEEP SCENE'S TOWN IS BELOW-SEA-LEVEL-REALISTIC: a low slab (stone 41..59, dirt 60..66), the dug well's cap at
// 1300,66,1315 facing east (stand y 67, 15 from home), the room 22 below the stand at y 45 -- under sea level 63, as all 417
// fleet orders from deep were (72 h to 10-17 12:55Z), so the held row's remedy is `surface`
const DG = 66
const DC = { x: 1300, y: DG, z: 1315 }
const DEEP_HOME = { x: 1315, y: DG + 1, z: 1315 }
// the plinth scenes' home: 21 from the plinth, its y above the town ground band (y >= home.y - 12) so the zone keeps out
// nothing in this arena -- the plinth's own shell is the only keep-out (townzone x minewell has its own Paper scene)
const PLINTH_HOME = { x: 1320, y: 150, z: 1320 }
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=40,z=${A.z0},dx=${A.x1 - A.x0},dy=100,dz=${A.z1 - A.z0}]`,
    `fill ${A.x0} 95 ${A.z0} ${A.x1} 111 ${A.z1} minecraft:air`, `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
    `fill ${A.x0} 113 ${A.z0} ${A.x1} ${G} ${A.z1} minecraft:dirt`,
    // the deep scene's low town: stone 41..59, dirt 60..66, its dug well, and a 5x5x3 room at 45..47 under home
    `fill ${A.x0} 41 ${A.z0} ${A.x1} 59 ${A.z1} minecraft:stone`, `fill ${A.x0} 60 ${A.z0} ${A.x1} ${DG} ${A.z1} minecraft:dirt`, `fill ${A.x0} ${DG + 1} ${A.z0} ${A.x1} 80 ${A.z1} minecraft:air`, `fill ${A.x0} 81 ${A.z0} ${A.x1} 94 ${A.z1} minecraft:air`,
    `setblock ${DC.x} ${DC.y - 1} ${DC.z} minecraft:oak_trapdoor[half=bottom,facing=east,open=false]`,
    `setblock ${DC.x} ${DC.y} ${DC.z} minecraft:oak_trapdoor[half=top,facing=east,open=false]`,
    `fill 1313 45 1313 1317 47 1317 minecraft:air`, `setblock 1315 47 1313 minecraft:torch`,
    // ...and the mine's own stair up to the town (a bot's mine leaves one): west along z=1315..1317 from the room (feet
    // 46..55, x 1312..1303), then south along x=1303..1305 to the surface (feet 56..67, z 1318..1329) -- three wide and four
    // high (a one-wide tunnel reads as entombed to the reflexes and fights the climb), and never within 2 of the well's
    // column (1300,1315): an earlier layout cut its underground ring (no well found) or left no headroom at the turn
    ...Array.from({ length: 10 }, (_, i) => `fill ${1312 - i} ${46 + i} 1315 ${1312 - i} ${49 + i} 1317 minecraft:air`),
    ...Array.from({ length: 12 }, (_, j) => `fill 1303 ${56 + j} ${1318 + j} 1305 ${59 + j} ${1318 + j} minecraft:air`),
    // the plinth
    `fill ${PC.x - 2} ${PC.y - 3} ${PC.z - 2} ${PC.x + 2} ${PC.y - 1} ${PC.z + 2} minecraft:cobblestone`,
    `fill ${PC.x - 1} ${PC.y} ${PC.z - 1} ${PC.x + 1} ${PC.y} ${PC.z + 1} minecraft:cobblestone`,
    `setblock ${PC.x} ${PC.y - 3} ${PC.z} minecraft:air`,
    `setblock ${PC.x} ${PC.y - 1} ${PC.z} minecraft:oak_trapdoor[half=bottom,facing=south,open=false]`,
    `setblock ${PC.x} ${PC.y} ${PC.z} minecraft:oak_trapdoor[half=top,facing=south,open=false]`]
  const r = rcon(...c)
  if (bad(r).length) throw new Error('arena: ' + bad(r).map(x => x.cmd + ' => ' + x.reply).join('; '))
}
const shellIntact = () => rcon(...SHELL.map(c => `execute if block ${c.x} ${c.y} ${c.z} minecraft:cobblestone`)).filter(x => passed(x.reply)).length
const isBlock = (c, id) => passed(r1(`execute if block ${c.x} ${c.y} ${c.z} minecraft:${id}`))
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? m.slice(1).map(Number) : null }
// wellcare.mjs stationKeepOut for one column, in the driver's own words (the read's geometry, scripts/host/wellcareread.py)
function keepOut (c, cap, own = false) {
  if (c.x === cap.x && c.z === cap.z && c.y >= cap.y - 2 && c.y <= cap.y + 3) return 'shaft'
  if ((c.y === cap.y + 1 || c.y === cap.y + 2) && Math.abs(c.x - cap.x) + Math.abs(c.z - cap.z) === 1) return 'stand'
  if (Math.abs(c.x - cap.x) <= 2 && Math.abs(c.z - cap.z) <= 2 && c.y >= cap.y - 3 && c.y <= cap.y) return own && Math.max(Math.abs(c.x - cap.x), Math.abs(c.z - cap.z)) >= 2 ? null : 'well'
  return null
}

// ---- the bot -----------------------------------------------------------------------------------------------------------
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ t: r['@timestamp'], name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || ''), y: r.bot?.pos?.y ?? null }))
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }
let ORDER = null
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const decision = ORDER ?? { skill: 'status', args: {} }
    ORDER = null
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot () { try { bot && bot.kill('SIGTERM') } catch {} bot = null; await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000) }
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
async function startBot (scene, home, { plinth = false } = {}) {
  const tag = `${RUN}-${LABEL}-${scene}`
  const logRel = `./sandbox/log/wellcare-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/wellcare-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`
  const envRel = 'sandbox/.env.wellcare-e2e'
  const pool = `sbxwcare-${tag}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/wellcare-e2e-${tag}`); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 60)
  set('LLM_DECISION_COOLDOWN_MS', 4000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, home[a.toLowerCase()]); set(`BOARD_${a}`, home[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  // THE PLINTH'S RECORD, as plinth-02 writes it (junkwell-plinth-<home>.json in the pool's store; world unset = any world)
  if (plinth) {
    const dir = `${R}/sandbox/state/_pool-${pool}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/junkwell-plinth-${home.x}_${home.y}_${home.z}.json`, JSON.stringify({ v: 1, state: 'complete', id: `sbx-${tag}`, world: null, at: Date.now(), by: 'sandbox',
      plan: { cap: PC, steps: [], stair: [] }, prev: [], left: 0, stuck: null, doneAt: Date.now(), doneBy: 'sandbox' }))
  }
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:saturation 600 1 true`)
  return { skillLog, botOut }
}
const give = (...stacks) => rcon(...stacks.map(([id, n], i) => `item replace entity ${NAME} container.${i} with minecraft:${id} ${n}`))
const record = res => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, root: BOT_ROOT, ...res }) + '\n'); P('RESULT', res) }

async function sceneMine () {
  buildArena()
  const files = await startBot('mine', PLINTH_HOME, { plinth: true })
  give(['stone_pickaxe', 1], ['stone_pickaxe', 1], ['cobblestone', 64], ['cobblestone', 64], ['bread', 16])
  rcon(`tp ${NAME} ${PC.x + 0.5} ${PC.y + 1} ${PC.z + 1.5} 180 0`)   // the south stand, facing the well (north)
  await sleep(25000)   // index.mjs refreshes the known well columns at 5 s and every 20 s
  const before = shellIntact()
  rcon(`tp ${NAME} ${PC.x + 0.5} ${PC.y + 1} ${PC.z + 1.5} 180 0`)
  await sleep(2000)
  ORDER = { skill: 'mine', args: { y: 114 } }
  const ended = await waitFor(() => lines(files.botOut).find(l => /skill mine ->/.test(l)), 180000, 500)
  await sleep(3000)
  // KEEP MINING: the model's next `mine` from wherever the first left the bot (a k=4 plinth's ledge is over a 3-block drop)
  const first = rowsOf(files.skillLog).filter(r => r.name === 'mine').pop()
  const pos1 = posOf()
  let second = null
  if (first && first.status !== 'success') {
    const n1 = lines(files.botOut).filter(l => /skill mine ->/.test(l)).length
    ORDER = { skill: 'mine', args: { y: 114 } }
    await waitFor(() => lines(files.botOut).filter(l => /skill mine ->/.test(l)).length > n1, 180000, 500)
    await sleep(3000)
    second = rowsOf(files.skillLog).filter(r => r.name === 'mine').pop()
  }
  const rows = rowsOf(files.skillLog)
  const after = shellIntact()
  const mineRow = first
  const res = { scene: 'mine', mine: mineRow ? `${mineRow.status} ${mineRow.detail.slice(0, 160)}` : (ended ? ended.slice(0, 160) : 'no mine row'),
    afterFirst: pos1, mine2: second ? `${second.status} ${second.detail.slice(0, 120)}` : null,
    shell: { before, after, of: SHELL.length }, cap: isBlock(PC, 'oak_trapdoor'), floor: isBlock({ x: PC.x, y: PC.y - 1, z: PC.z }, 'oak_trapdoor'),
    guardRows: rows.filter(r => r.name === '_mine_well_guard').map(r => r.detail.slice(0, 120)), endPos: posOf(), licence: rows.filter(r => r.name === '_wellcare_mode').length }
  await stopBot()
  record(res)
}
async function sceneDeep () {
  buildArena()
  const files = await startBot('deep', DEEP_HOME)
  const junk = [['flint', 64], ['egg', 16], ['ink_sac', 64], ['clay_ball', 64], ['glass', 64], ['brown_egg', 16]]
  const stacks = []
  for (let i = 0; i < 36; i++) stacks.push(i === 0 ? ['stone_pickaxe', 1] : i === 1 ? ['bread', 16] : i === 2 ? ['dirt', 16] : i < 10 ? junk[i % junk.length] : ['cobblestone', 64])
  give(...stacks)
  rcon(`tp ${NAME} ${DEEP_HOME.x + 0.5} 45 ${DEEP_HOME.z + 0.5}`)
  await sleep(3000)
  const t0 = new Date().toISOString()
  const startPos = posOf()
  // THE LOOP'S OWN DECISIONS (the brain proposes `status`) for 60 s: the base gives dispose_well from down here, the candidate
  // holds it (_well_deep action=hold remedy=surface). Then the brain proposes the named remedy, `surface` (the real skill),
  // and the candidate's dispose_well comes on the first scan in reach. Up to 200 s more, or until a dispose_well row.
  const hasDispose = () => rowsOf(files.skillLog).some(r => r.t >= t0 && r.name === 'dispose_well')
  await waitFor(hasDispose, 60000, 1000)
  if (!hasDispose()) {
    ORDER = { skill: 'surface', args: {} }
    await waitFor(hasDispose, 200000, 1000)
  }
  await sleep(2000)
  const rows = rowsOf(files.skillLog).filter(r => r.t >= t0)
  const seq = rows.filter(r => ['dispose_well', 'build_well', 'close_well', 'surface', '_well_deep'].includes(r.name)).map(r => `${r.t.slice(11, 19)} ${r.name} ${r.status} y=${r.y == null ? '?' : Math.round(r.y)} ${r.detail.slice(0, 90)}`)
  const orders = rows.filter(r => ['dispose_well', 'build_well', 'close_well'].includes(r.name)).map(r => `${r.name} ${r.status} y=${r.y == null ? '?' : Math.round(r.y)} ${r.detail.slice(0, 90)}`)
  const dec = lines(files.botOut).filter(l => /LLM -> /.test(l)).slice(-12).map(l => l.replace(/^.*LLM -> /, '').slice(0, 80))
  const deepRows = rows.filter(r => r.name === '_well_deep').map(r => r.detail)
  const standSeen = (/stand_y=(\d+)/.exec(deepRows[0] || '') || [])[1]
  const res = { scene: 'deep', startPos, standY: standSeen ? Number(standSeen) : `${DC.y + 1} (the dug well's; the bot's row names its own)`, sequence: seq, orders, deepRows, decisions: dec, endPos: posOf(),
    disposeRowSeen: rows.some(r => r.name === '_well_dispose'), licence: rowsOf(files.skillLog).filter(r => r.name === '_wellcare_mode').length }
  await stopBot()
  record(res)
}
async function sceneTable () {
  buildArena()
  // town furniture on the south corners of the plinth's top (two placed blocks): the base's next candidate is the cap column
  rcon(`setblock ${PC.x - 1} ${PC.y + 1} ${PC.z + 1} minecraft:cobblestone`, `setblock ${PC.x + 1} ${PC.y + 1} ${PC.z + 1} minecraft:cobblestone`)
  const files = await startBot('table', PLINTH_HOME, { plinth: true })
  give(['crafting_table', 1], ['oak_planks', 3], ['stick', 2], ['bread', 16])
  rcon(`tp ${NAME} ${PC.x + 0.5} ${PC.y + 1} ${PC.z + 1.5} 180 0`)
  await sleep(25000)
  rcon(`tp ${NAME} ${PC.x + 0.5} ${PC.y + 1} ${PC.z + 1.5} 180 0`)
  await sleep(2000)
  ORDER = { skill: 'craft', args: { item: 'wooden_pickaxe', count: 1 } }
  // the table's cell while it stands (the craft takes it back after): the cap column and the stands, polled
  const watch = [{ x: PC.x, y: PC.y + 1, z: PC.z }, { x: PC.x + 1, y: PC.y + 1, z: PC.z }, { x: PC.x - 1, y: PC.y + 1, z: PC.z }, { x: PC.x, y: PC.y + 1, z: PC.z - 1 }]
  const seenOn = new Set()
  const ended = await waitFor(() => {
    for (const x of rcon(...watch.map(c => `execute if block ${c.x} ${c.y} ${c.z} minecraft:crafting_table`))) if (passed(x.reply)) seenOn.add(x.cmd.split(' ').slice(3, 6).join(','))
    return lines(files.botOut).find(l => /skill craft ->/.test(l))
  }, 120000, 200)
  await sleep(3000)
  const rows = rowsOf(files.skillLog)
  const cellOf = d => { const m = /^(-?\d+),(-?\d+),(-?\d+):/.exec(d) || /at=(-?\d+),(-?\d+),(-?\d+)/.exec(d); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
  const tableCells = [...rows.filter(r => r.name === '_table_retaken').map(r => cellOf(r.detail)), ...rows.filter(r => r.name === '_station_placed').map(r => cellOf(r.detail))].filter(Boolean)
  const craftRow = rows.filter(r => r.name === 'craft').pop()
  const res = { scene: 'table', craft: craftRow ? `${craftRow.status} ${craftRow.detail.slice(0, 140)}` : (ended ? ended.slice(0, 140) : 'no craft row'),
    tableCells: tableCells.map(c => ({ ...c, kind: keepOut(c, PC) })), seenOnWellCells: [...seenOn],
    stationRows: rows.filter(r => r.name === '_station_well' || r.name === '_station_placed').map(r => `${r.name} ${r.detail.slice(0, 110)}`),
    capColumnNow: isBlock({ x: PC.x, y: PC.y + 1, z: PC.z }, 'air'), shell: shellIntact(), bag: r1(`data get entity ${NAME} Inventory`).match(/wooden_pickaxe/) ? 'wooden_pickaxe' : 'none' }
  await stopBot()
  record(res)
}

async function main () {
  const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
  if (!/wellcare/.test(lock)) throw new Error('the sandbox lock is not held for wellcare: ' + lock.trim().slice(0, 160))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} label=${LABEL} server=${SERVER} scenes=${SCENES}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  for (const s of SCENES.split(',')) {
    if (s === 'mine') await sceneMine()
    else if (s === 'deep') await sceneDeep()
    else if (s === 'table') await sceneTable()
  }
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.wellcare-e2e`) } catch {}
  try {
    P('cleanup', rcon(`kill ${ARENA_SEL}`, `fill ${A.x0} 41 ${A.z0} ${A.x1} 59 ${A.z1} minecraft:air`, `fill ${A.x0} 60 ${A.z0} ${A.x1} 80 ${A.z1} minecraft:air`, `fill ${A.x0} 81 ${A.z0} ${A.x1} 94 ${A.z1} minecraft:air`,
      `fill ${A.x0} 95 ${A.z0} ${A.x1} 111 ${A.z1} minecraft:air`, `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
      `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'list').map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`))
  } catch (e) { P('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
