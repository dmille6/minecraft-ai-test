#!/usr/bin/env node
// SANDBOX-ONLY end-to-end run of the TOWN FLOOR (townfloor-01: bots/src/townfloor.mjs + skills fill_town), Paper 1.21.8.
// The REAL bot (src/index.mjs from <botRoot>, unmodified) runs its own deterministic town orders; a loopback brain answers
// 'status', so every placement comes from the bot's own floorOrder -> fill_town. A bare-mineflayer WALKER in this process is
// the other player: it stands deep in the cavern while the bot fills, and must walk home afterwards.
//
//   WELL_REPO=<harness checkout (main)> node sandbox/townfloor/floor-e2e.mjs <botRoot> <scene,...> [server]
//   scenes:  fill:<fixture>:<rep>[:kill]   visits until the town has nothing reachable left (or 25 min); :kill = SIGKILL the
//                                          bot mid-visit twice and restart it (resume and lease recovery)
//            walker:<fixture>              the same with the walker standing at the cavern's far end for the first visits
//   fixtures: town   a synthetic dug-out town: platform, a 7x5x7 cavern under it reached by a stair, a pit with a stair, a
//                    pool with holes beside it, a chest with a hole beside it, a sapling in a hole, plain holes
//             boarda board-a's real town (a read-only region copy) pasted into the arena, home at the arena centre
// THE SERVER'S TRUTH: every count is an RCON read of the world (execute if block), never only a bot row:
//   placed      every cell of the box's open cells and the two layers over the box (+2 around) read for a stone block
//               that the fixture did not have there
//   gates       a placed cell that was not a target of the fixture (outside the box, protected, a liquid, a plant) = outside
//               the plan; a placed cell with no solid block under it at the end = a bridge; a fixture walk node (a stand that
//               walked to the town before) that no longer walks to the town and is not itself filled = a cut way; the
//               protected cells' blocks unchanged
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `townfloor`.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox2'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: floor-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/townfloor/.test(lock)) throw new Error(`the sandbox lock does not name townfloor: ${lock.trim()}`)
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = process.env.WELL_REPO || path.resolve(__dir, '../..')
const REGION = process.env.FLOOR_REGION || ''
const NAME = process.env.FLOOR_BOT_NAME || 'sandbox-Floor', WALKER = process.env.FLOOR_WALKER_NAME || 'sandbox-FWalk'
const BRAIN_PORT = Number(process.env.FLOOR_BRAIN_PORT || 11498)
const OUT = process.env.FLOOR_OUT || `${R}/sandbox/log/floor-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const TF = await import(path.join(BOT_ROOT, 'bots/src/townfloor.mjs'))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-floor-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const rconBatch = (cmds, n = 500) => { const out = []; for (let i = 0; i < cmds.length; i += n) out.push(...rcon(...cmds.slice(i, i + n))); return out }

// ---------------------------------------------------------------- the arena and the fixtures
const C = { x: 2400, z: 2400 }
const A = { x0: C.x - 30, x1: C.x + 30, z0: C.z - 30, z1: C.z + 30, y0: 96, y1: 140 }
const HOME = { x: C.x, y: 120, z: C.z }
const L = HOME.y - 2
const Block = breq('prismarine-block')(breq('prismarine-registry')('1.21.8'))
const BC = new Map()
const blk = name => { if (!BC.has(name)) { const b = Block.fromString(name, 0); BC.set(name, { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness, props: null }) } return BC.get(name) }
function clearArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`]
  for (let y = A.y0; y <= A.y1; y += 8) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(A.y1, y + 7)} ${A.z1} minecraft:air`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
/** The synthetic town, as a model (the driver's own read) and as RCON commands that build it. Offsets from HOME. */
function townModel () {
  const m = new Map()
  const set = (dx, y, dz, n) => m.set(`${C.x + dx},${y},${C.z + dz}`, n)
  const carve = (x0, x1, y0, y1, z0, z1, n = 'air') => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, n) }
  carve(-3, 3, 113, 117, -3, 3)                                                       // the cavern under the platform
  for (const [x, f] of [[9, 118], [8, 117], [7, 116], [6, 115], [5, 114], [4, 113]]) carve(x, x, f, Math.min(L, f + 2), 0, 0)   // its stair
  carve(10, 12, 116, 118, 10, 12); carve(13, 13, 117, 118, 11, 11); carve(14, 14, 118, 118, 11, 11)                    // a pit with a stair
  set(-12, 117, 0, 'water'); carve(-12, -10, 118, 118, 0, 0)                          // a pool and the holes beside it
  carve(-12, -12, 118, 118, 6, 6)                                                     // a plain hole 6 from the pool
  set(2, 119, 4, 'chest'); set(2, 118, 5, 'air')                                      // a chest on the platform, a hole beside it
  carve(-4, -4, 118, 118, -4, -4)                                                     // a plain platform hole
  set(-10, 116, -10, 'dirt'); set(-10, 117, -10, 'oak_sapling'); set(-10, 118, -10, 'air')   // a sapling in a hole
  const read = (x, y, z) => {
    if (x < A.x0 || x > A.x1 || z < A.z0 || z > A.z1 || y < A.y0 || y > A.y1) return null
    const k = `${x},${y},${z}`
    if (m.has(k)) return blk(m.get(k))
    if (y > L) return blk('air')
    if (y === L) return blk(Math.max(Math.abs(x - C.x), Math.abs(z - C.z)) <= 6 ? 'stone_bricks' : 'grass_block')
    return blk('stone')
  }
  const build = () => {
    clearArena()
    const c = []
    for (let y = A.y0; y < L; y++) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y} ${A.z1} minecraft:stone`)
    c.push(`fill ${A.x0} ${L} ${A.z0} ${A.x1} ${L} ${A.z1} minecraft:grass_block`, `fill ${C.x - 6} ${L} ${C.z - 6} ${C.x + 6} ${L} ${C.z + 6} minecraft:stone_bricks`)
    // the non-air overrides last-but-one, the air carve before them so the chest and the sapling stand
    const air = [], other = []
    for (const [k, n] of m) { const [x, y, z] = k.split(',').map(Number); (n === 'air' ? air : other).push(`setblock ${x} ${y} ${z} minecraft:${n}`) }
    c.push(...air, ...other)
    const bad = rconBatch(c, 300).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not/i.test(x.reply))
    if (bad.length) P_('town build refusals', bad.length, bad.slice(0, 3).map(x => `${x.cmd} => ${x.reply.slice(0, 80)}`))
  }
  return { read, build, bag: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['andesite', 12]], walkerAt: { x: C.x - 3 + 0.5, y: 113, z: C.z - 3 + 0.5 } }
}
// board-a (a read-only region copy): home 355,73,147 -> the arena centre at y 120
function boardaModel () {
  const BA = { home: { x: 355, y: 73, z: 147 }, box: { x0: 327, x1: 383, z0: 119, z1: 175, y0: 62, y1: 92 } }
  const OFF = { x: C.x - BA.home.x, y: HOME.y - BA.home.y, z: C.z - BA.home.z }
  const W = { mod: null }
  const load = async () => { W.mod ??= await import(path.join(BOT_ROOT, 'bots/scripts/wellsite-replay.mjs')); return W.mod }
  let rd = null, raw = null
  const read = (x, y, z) => {
    const sx = x - OFF.x, sy = y - OFF.y, sz = z - OFF.z
    if (x < A.x0 || x > A.x1 || z < A.z0 || z > A.z1 || y < A.y0 || y > A.y1) return null
    if (sx < BA.box.x0 || sx > BA.box.x1 || sz < BA.box.z0 || sz > BA.box.z1 || sy < BA.box.y0 || sy > BA.box.y1) return blk(y < BA.box.y0 + OFF.y ? 'stone' : 'air')
    return rd(sx, sy, sz)
  }
  const build = async () => {
    const w = await load()
    const chunks = w.loadRegion(REGION)
    rd = w.reader(chunks); raw = rawReader(chunks)
    clearArena()
    const cmds = []
    for (let y = A.y0; y < BA.box.y0 + OFF.y; y++) cmds.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y} ${A.z1} minecraft:stone`)
    for (let y = BA.box.y0; y <= BA.box.y1; y++) for (let z = BA.box.z0; z <= BA.box.z1; z++) {
      let run = null
      const flush = () => { if (run && run.s !== 'minecraft:air') cmds.push(run.x0 === run.x1 ? `setblock ${run.x0 + OFF.x} ${y + OFF.y} ${z + OFF.z} ${run.s}` : `fill ${run.x0 + OFF.x} ${y + OFF.y} ${z + OFF.z} ${run.x1 + OFF.x} ${y + OFF.y} ${z + OFF.z} ${run.s}`); run = null }
      for (let x = BA.box.x0; x <= BA.box.x1; x++) {
        const e = raw(x, y, z)
        const s = e ? stateString(e) : 'minecraft:air'
        if (run && run.s === s) { run.x1 = x; continue }
        flush(); run = { x0: x, x1: x, s }
      }
      flush()
    }
    P_(`boarda: ${cmds.length} fill/setblock commands`)
    const bad = rconBatch(cmds, 300).filter(x => /Unknown|Incorrect|Cannot|not loaded|Expected/i.test(x.reply))
    if (bad.length) P_('boarda copy refusals', bad.length, bad.slice(0, 3).map(x => `${x.cmd.slice(0, 80)} => ${x.reply.slice(0, 80)}`))
  }
  return { read, build, bag: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['andesite', 20]], walkerAt: null }
}
function rawReader (chunks) {
  return (x, y, z) => {
    const s = chunks.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)?.get(Math.floor(y / 16))
    if (!s) return null
    if (s.palette.length === 1 || !s.data) return s.palette[0]
    const bits = Math.max(4, Math.ceil(Math.log2(s.palette.length))), per = Math.floor(64 / bits)
    const idx = (((y % 16) + 16) % 16) * 256 + (((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16)
    const [hi, lo] = s.data[Math.floor(idx / per)]
    const v = (BigInt.asUintN(32, BigInt(hi)) << 32n) | BigInt.asUintN(32, BigInt(lo))
    return s.palette[Number((v >> BigInt((idx % per) * bits)) & ((1n << BigInt(bits)) - 1n))]
  }
}
function stateString (e) {
  const props = { ...(e.Properties ?? {}) }
  if (/_leaves$/.test(e.Name)) props.persistent = 'true'
  const p = Object.entries(props)
  return p.length ? `${e.Name}[${p.map(([k, v]) => `${k}=${v}`).join(',')}]` : e.Name
}
const FIX = { town: townModel(), boarda: boardaModel() }

// ---------------------------------------------------------------- the server's truth
const STONE = ['cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite']
/** The cells a placement could have landed in: the fixture's open (non-liquid) cells in the box + 4, from the box bottom
 *  to two above the floor level. -> [{x,y,z}] */
function candidateCells (read) {
  const b = TF.floorBox(HOME), out = []
  for (let x = b.x0 - 4; x <= b.x1 + 4; x++) for (let z = b.z0 - 4; z <= b.z1 + 4; z++) for (let y = b.y0; y <= b.y1 + 2; y++) {
    const c = read(x, y, z)
    if (c && c.boundingBox === 'empty' && !/water|lava/.test(c.name)) out.push({ x, y, z })
  }
  return out
}
/** -> Map key -> block name, for the candidate cells that hold one of the floor's blocks on the server now. */
function placedNow (cells) {
  const cmds = [], keys = []
  for (const c of cells) for (const n of STONE) { cmds.push(`execute if block ${c.x} ${c.y} ${c.z} minecraft:${n}`); keys.push([`${c.x},${c.y},${c.z}`, n]) }
  const r = rconBatch(cmds, 600)
  const out = new Map()
  keys.forEach(([k, n], i) => { if (passed(r[i]?.reply)) out.set(k, n) })
  return out
}
function judge (F, placed) {
  const pre = F.read
  const cls = TF.floorCells(pre, HOME)
  const targets = new Set(cls.targets.map(t => `${t.x},${t.y},${t.z}`))
  const cells = new Map()
  for (const k of placed.keys()) cells.set(TF.cellKey(...k.split(',').map(Number)), TF.PLACED)
  const post = TF.overlay(pre, cells)
  const outside = [...placed.keys()].filter(k => !targets.has(k))
  const bridges = [...placed.keys()].filter(k => { const [x, y, z] = k.split(',').map(Number); return post(x, y - 1, z)?.boundingBox !== 'block' })
  const st = TF.startNear(pre, HOME), box = TF.walkBox(HOME)
  const before = TF.walkBack(pre, st, { box }), after = TF.walkBack(post, st, { box })
  const cut = [...before].filter(k => !after.has(k) && !cells.has(k)).map(k => { const c = TF.keyCell(k); return `${c.x},${c.y},${c.z}` })
  return { targets: targets.size, placed: placed.size, outside, bridges, cut, left: TF.floorCells(post, HOME).targets.length, protectedTally: cls.tally }
}
/** The protected cells of the synthetic town, read on the server: unchanged. */
function protectedOk () {
  const checks = [[-12, 117, 0, 'water'], [-12, 118, 0, 'air'], [-11, 118, 0, 'air'], [-10, 118, 0, 'air'], [2, 118, 5, 'air'], [2, 119, 4, 'chest'],
                  [-10, 117, -10, 'oak_sapling'], [-10, 118, -10, 'air']]
  const r = rcon(...checks.map(([dx, y, dz, n]) => `execute if block ${C.x + dx} ${y} ${C.z + dz} minecraft:${n}`))
  return checks.map((c, i) => ({ cell: `${C.x + c[0]},${c[1]},${C.z + c[2]}`, want: c[3], ok: passed(r[i]?.reply) }))
}

// ---------------------------------------------------------------- the bot, the brain, the walker
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || ''), inv: r.bot?.inventory ?? null }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    // THE MODEL'S OWN TURNS VARY (status, then a step to a cell beside home): the admission gate refuses a 4th identical
    // action within 8, and a brain that only ever says 'status' would make the fleet's repeat guard stall every order
    const n = brainN++ % 3
    const decision = n === 0 ? { skill: 'status', args: {} } : n === 1 ? { skill: 'goto', args: { x: HOME.x + 2, y: HOME.y - 1, z: HOME.z + 2 } } : { skill: 'goto', args: { x: HOME.x - 2, y: HOME.y - 1, z: HOME.z - 2 } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null, brainN = 0
async function stopBot (sig = 'SIGTERM') {
  try { bot && bot.kill(sig) } catch {}
  bot = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const poolOf = fx => `sbxfloor-${RUN}-${fx}`
const poolDir = fx => `${R}/sandbox/state/_pool-${poolOf(fx)}`
const recordOf = fx => { try { return JSON.parse(fs.readFileSync(`${poolDir(fx)}/townfloor-${HOME.x}_${HOME.y}_${HOME.z}.json`, 'utf8')) } catch { return null } }
async function startBot (fx, tag, slotsSpec, { tp = true } = {}) {
  const logRel = `./sandbox/log/floor-e2e/${RUN}-${tag}`
  const skillLog = `${R}/sandbox/log/floor-e2e/${RUN}-${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${RUN}-${tag}.out`
  const envRel = 'sandbox/.env.floor-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/floor-${RUN}-${fx}`); set('MEMORY_POOL', poolOf(fx))
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  set('FLOOR_COOLDOWN_MS', 15000)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  if (tp) {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${HOME.x + 0.5} ${HOME.y - 1} ${HOME.z + 0.5}`)
    await sleep(6000)
    const c = [`tp ${NAME} ${HOME.x + 0.5} ${HOME.y - 1} ${HOME.z + 0.5}`]
    let s = 0
    for (const [id, n] of slotsSpec) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
    rcon(...c)
  }
  await sleep(2000)
  return { skillLog, botOut, tag }
}
let walker = null
async function walkerJoin () {
  if (walker) return walker
  const mineflayer = breq('mineflayer')
  walker = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: WALKER, version: '1.21.8', auth: 'offline' })
  walker.on('error', e => P_('walker error', String(e?.message)))
  await new Promise(r => walker.once('spawn', r)); await sleep(1500)
  rcon(`gamemode survival ${WALKER}`, `clear ${WALKER}`)
  const { pathfinder, Movements } = breq('mineflayer-pathfinder')
  walker.loadPlugin(pathfinder)
  const mv = new Movements(walker); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  walker.pathfinder.setMovements(mv)
  return walker
}
async function walkerHome () {
  const { goals } = breq('mineflayer-pathfinder')
  try { await Promise.race([walker.pathfinder.goto(new goals.GoalNear(HOME.x, HOME.y - 1, HOME.z, 2)), sleep(60000).then(() => { throw new Error('timeout') })]); return true } catch (e) { P_('walker home failed', String(e?.message)); return false }
}
async function walkerLeave () { if (walker) { try { walker.quit('done') } catch {} walker = null; await sleep(2000) } }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), run: RUN, ...r }) + '\n'); P_('RESULT', r) }

// ---------------------------------------------------------------- the scene
async function sceneFill (fx, rep, { kill = false, withWalker = false } = {}) {
  const F = FIX[fx]
  await F.build()
  fs.mkdirSync(poolDir(fx), { recursive: true })
  for (const f of fs.readdirSync(poolDir(fx))) fs.rmSync(path.join(poolDir(fx), f), { force: true })
  const cand = candidateCells(F.read)
  const base = placedNow(cand)                                           // POSITIVE CONTROL of the reader: nothing yet, and...
  rcon(`setblock ${C.x - 4} ${L} ${C.z - 4} minecraft:cobblestone`)       // ...one block set by RCON is seen
  const ctl = placedNow([{ x: C.x - 4, y: L, z: C.z - 4 }]).size
  rcon(`setblock ${C.x - 4} ${L} ${C.z - 4} minecraft:air`)
  const offline = TF.planFloor({ read: F.read, home: HOME, maxSteps: 100000, maxTries: 1000000 })
  let walkerAt = null, walkerStillHome = null
  if (withWalker && F.walkerAt) {
    await walkerJoin()
    rcon(`tp ${WALKER} ${F.walkerAt.x} ${F.walkerAt.y} ${F.walkerAt.z}`)
    walkerAt = F.walkerAt
  }
  const files = await startBot(fx, `fill-${fx}-${rep}${kill ? '-kill' : ''}${withWalker ? '-walker' : ''}`, F.bag)
  const t0 = Date.now()
  const runs = [files.skillLog]
  let kills = 0, done = null, lastN = 0
  const killAt = kill ? [20, 70] : []
  while (Date.now() - t0 < 25 * 60_000) {
    await sleep(5000)
    const rows = runs.flatMap(rowsOf)
    const steps = rows.filter(r => r.name === '_town_floor_step').length
    if (walkerAt && steps >= 40) {
      // the walker has watched 40 placements from the cavern's far end: it walks home now, on foot, no digging
      walkerStillHome = await walkerHome()
      await walkerLeave(); walkerAt = null
    }
    if (killAt.length && steps >= killAt[0]) {
      killAt.shift(); kills++
      P_(`KILL at ${steps} steps`)
      await stopBot('SIGKILL'); await sleep(3000)
      const f2 = await startBot(fx, `fill-${fx}-${rep}-kill${kills}`, [], { tp: false })
      runs.push(f2.skillLog)
    }
    const rec = recordOf(fx)
    const visits = rows.filter(r => r.name === '_town_floor')
    if (rec?.noneAt || (visits.length && /why=(none_reachable|none_feasible)/.test(visits.at(-1).detail) && steps === lastN)) { done = Date.now() - t0; break }
    lastN = steps
  }
  await sleep(3000)
  const placed = placedNow(cand)
  const j = judge(F, placed)
  const rows = runs.flatMap(rowsOf)
  const stepRows = rows.filter(r => r.name === '_town_floor_step')
  const visitRows = rows.filter(r => r.name === '_town_floor')
  const rowCells = new Set(stepRows.map(r => /at=(\S+)/.exec(r.detail)?.[1]))
  const reserve = stepRows.filter(r => /block=cobble/.test(r.detail) && r.inv && ((r.inv.cobblestone ?? 0) + (r.inv.cobbled_deepslate ?? 0)) < 64).length
  const ts = stepRows.map(r => r.ts).sort((a, b) => a - b)
  const gaps = ts.slice(1).map((v, i) => v - ts[i]).filter(g => g < 20000).sort((a, b) => a - b)
  const prot = fx === 'town' ? protectedOk() : null
  result({ scene: withWalker ? 'walker' : 'fill', fx, rep, kill: !!kill, kills, readerControl: { before: base.size, seen: ctl },
    // OK needs PROGRESS and AGREEMENT too (Codex r2 P2): an unchanged fixture satisfies every safety predicate
    ok: j.placed > 0 && rowCells.size === placed.size && [...placed.keys()].every(k => rowCells.has(k)) &&
        j.outside.length === 0 && j.bridges.length === 0 && j.cut.length === 0 && (prot ?? []).every(p => p.ok) && reserve === 0 && (walkerStillHome !== false),
    targets: j.targets, offlineFillable: offline.steps.length, serverPlaced: j.placed, rowsPlaced: stepRows.length,
    rowsMatchServer: rowCells.size === placed.size && [...placed.keys()].every(k => rowCells.has(k)),
    outside: j.outside.slice(0, 10), outsideN: j.outside.length, bridges: j.bridges.slice(0, 10), cutWays: j.cut.slice(0, 10), cutN: j.cut.length,
    leftTargets: j.left, protected: prot, reserveBreaches: reserve, walkerWalkedHome: walkerStillHome,
    visits: visitRows.length, visitWhy: visitRows.map(r => /why=(\S+)/.exec(r.detail)?.[1] ?? '-'), doneMs: done,
    placeGapMs: gaps.length ? { p50: gaps[Math.floor(gaps.length / 2)], p90: gaps[Math.floor(gaps.length * 0.9)] } : null,
    refused: visitRows.reduce((t, r) => t + (Number(/refused=(\d+)/.exec(r.detail)?.[1]) || 0), 0), dropped: visitRows.reduce((t, r) => t + (Number(/dropped=(\d+)/.exec(r.detail)?.[1]) || 0), 0) })
  await stopBot()
  await walkerLeave()
}

await new Promise(r => brain.listen(BRAIN_PORT, '127.0.0.1', r))
let failed = 0
// THE ARENA'S CHUNKS stay loaded for the run (sandbox only), and are released at the end
P_('forceload', rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`).map(x => x.reply).join(' '))
await sleep(3000)
try {
  for (const sc of SCENES_S.split(',')) {
    const [kind, fx, rep = '1', opt] = sc.split(':')
    if (!FIX[fx]) throw new Error(`no fixture ${fx}`)
    P_(`SCENE ${sc}`)
    try {
      if (kind === 'fill') await sceneFill(fx, rep, { kill: opt === 'kill' })
      else if (kind === 'walker') await sceneFill(fx, rep, { withWalker: true })
      else throw new Error(`no scene ${kind}`)
    } catch (e) { failed++; P_('SCENE FAILED', sc, String(e?.stack ?? e).slice(0, 400)); await stopBot('SIGKILL'); await walkerLeave() }
  }
} finally { brain.close(); try { rcon(`forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch {} }
const bad = lines(RES).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.run === RUN && !r.ok).length
P_(`DONE: ${failed} scene(s) failed to run, ${bad} result(s) not ok`)
process.exit(failed || bad ? 1 : 0)
