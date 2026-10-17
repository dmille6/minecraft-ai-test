#!/usr/bin/env node
// plinthfirst-01 PAPER DRIVER (10-17). SANDBOX ONLY (Paper 1.21.8, 10.0.0.30:25599..25602). The REAL bot (src/index.mjs from
// <botRoot>, unmodified) runs its own deterministic town orders; the loopback brain answers 'status'. Every verdict below is
// an RCON read of the world (execute if block / data get), never only a bot row.
//
//   WELL_REPO=<a copy of the harness: sandbox/run-bot.sh, sandbox/sandbox-bot-scripted.env, sandbox/craft/trace.cjs>
//   node sandbox/well/plinthfirst-e2e.mjs <botRoot> <scene,scene,...> [server]
//   scenes (fixture `solid`: intact natural ground, so the NATURAL search finds a site -- the case plinth-first changes):
//     pfnew     no well, no record: plinth-first declines the natural cell (read back: still grass/dirt), plans a RAISED
//               plinth (k >= 2), builds it, and build_well finishes the well on it
//     pfkeep    a sealed NATURAL well at the natural cell: it keeps being used (a dispose visit, items in the shaft), and no
//               plinth is planned or placed
//     pfretire  the same natural well with a wall dug out: it is retired (well_retired), left standing (no teardown: its
//               trapdoors read back), and replaced by a plinth with its well built on it
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `plinthfirst`. World edits on the arena only.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox2'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: plinthfirst-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/plinthfirst/.test(lock)) throw new Error(`the sandbox lock does not name plinthfirst: ${lock.trim()}`)
const R = process.env.WELL_REPO
if (!R || !fs.existsSync(`${R}/sandbox/run-bot.sh`)) throw new Error('WELL_REPO must hold sandbox/run-bot.sh')
const NAME = 'sandbox-PFirst'
const BRAIN_PORT = Number(process.env.PF_BRAIN_PORT || 11497)
const OUT = `${R}/sandbox/log/plinthfirst-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const PL = await import(path.join(BOT_ROOT, 'bots/src/plinth.mjs'))
const W = await import(path.join(BOT_ROOT, 'bots/src/well.mjs'))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-pfirst-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const rconBatch = (cmds, n = 400) => { const out = []; for (let i = 0; i < cmds.length; i += n) out.push(...rcon(...cmds.slice(i, i + n))); return out }

// ---------------------------------------------------------------- the arena: intact natural ground
const C = { x: 2400, z: 2400 }
const A = { x0: C.x - 26, x1: C.x + 26, z0: C.z - 26, z1: C.z + 26, y0: 100, y1: 140 }
const HOME = { x: C.x, y: 120, z: C.z }
const Block = breq('prismarine-block')(breq('prismarine-registry')('1.21.8'))
const BC = new Map()
const blk = name => { if (!BC.has(name)) { const b = Block.fromString(name, 0); BC.set(name, { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness, props: null }) } return BC.get(name) }
const AIRB = blk('air')
const inside = (x, z) => Math.abs(x - C.x) <= 24 && Math.abs(z - C.z) <= 24
/** The fixture as the bot will read it: stone 108..116, dirt 117..118, grass 119 over the arena; air above and outside. */
const solidRead = (x, y, z) => (y < A.y0 || y > A.y1 ? null : !inside(x, z) ? AIRB : y >= 108 && y <= 116 ? blk('stone') : y === 117 || y === 118 ? blk('dirt') : y === 119 ? blk('grass_block') : AIRB)
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`]
  for (let y = A.y0; y <= A.y1; y += 10) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(A.y1, y + 9)} ${A.z1} minecraft:air`)
  c.push(`fill ${C.x - 24} 108 ${C.z - 24} ${C.x + 24} 116 ${C.z + 24} minecraft:stone`, `fill ${C.x - 24} 117 ${C.z - 24} ${C.x + 24} 118 ${C.z + 24} minecraft:dirt`,
    `fill ${C.x - 24} 119 ${C.z - 24} ${C.x + 24} 119 ${C.z + 24} minecraft:grass_block`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
const NATURAL = W.canonicalWellSite({ home: HOME, read: solidRead }).site   // what the base would build
if (!NATURAL) throw new Error('the fixture offers no natural site: the scenes would prove nothing')
const blockIs = (c, id) => passed(r1(`execute if block ${c.x} ${c.y} ${c.z} ${id}`))
const cobbleIn = box => {
  const cmds = [], keys = []
  for (let x = box.x0; x <= box.x1; x++) for (let y = box.y0; y <= box.y1; y++) for (let z = box.z0; z <= box.z1; z++) { cmds.push(`execute if block ${x} ${y} ${z} minecraft:cobblestone`); keys.push(`${x},${y},${z}`) }
  const r = rconBatch(cmds, 500)
  return keys.filter((k, i) => passed(r[i]?.reply))
}
const wellAt = cap => ({ top: blockIs(cap, '#minecraft:wooden_trapdoors[half=top]'), floor: blockIs({ ...cap, y: cap.y - 1 }, '#minecraft:wooden_trapdoors[half=bottom]') })
const WALLS = cap => [0, -1].flatMap(dy => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([dx, dz]) => ({ x: cap.x + dx, y: cap.y + dy, z: cap.z + dz })))
const placedWalls = cap => { const r = rcon(...WALLS(cap).map(c => `execute if block ${c.x} ${c.y} ${c.z} minecraft:cobblestone`)); return r.filter(x => passed(x.reply)).length }

// ---------------------------------------------------------------- the bot and its logs
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
const field = (d, k) => { const m = new RegExp(`(?:^| )${k}=(\\S+)`).exec(d ?? ''); return m ? m[1] : null }
const xyz = s => { const a = String(s ?? '').split(',').map(Number); return a.length === 3 && a.every(Number.isFinite) ? { x: a[0], y: a[1], z: a[2] } : null }
async function waitFor (pred, ms, step = 1000) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }
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
async function stopBot (sig = 'SIGTERM') {
  try { bot && bot.kill(sig) } catch {}
  bot = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const poolOf = scene => `sbxpfirst-${RUN}-${scene}`
const poolDir = scene => `${R}/sandbox/state/_pool-${poolOf(scene)}`
const homeKey = `${HOME.x}_${HOME.y}_${HOME.z}`
async function startBot (scene, slots) {
  const logRel = `./sandbox/log/plinthfirst-e2e/${RUN}-${scene}`
  const skillLog = `${R}/sandbox/log/plinthfirst-e2e/${RUN}-${scene}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${RUN}-${scene}.out`
  const envRel = 'sandbox/.env.plinthfirst-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/pfirst-${RUN}-${scene}`); set('MEMORY_POOL', poolOf(scene))
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  set('PLINTH_COOLDOWN_MS', 20000); set('WORLD_BORDER_RADIUS', 4000); set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`)
  await sleep(8000)
  const c = [`tp ${NAME} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5}`]
  let s = 0
  for (const [id, n] of slots) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(2000)
  return { skillLog, botOut }
}
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), run: RUN, natural: NATURAL, ...r }) + '\n'); P_('RESULT', r) }
const freshPool = scene => { fs.mkdirSync(poolDir(scene), { recursive: true }); for (const f of fs.readdirSync(poolDir(scene))) fs.rmSync(path.join(poolDir(scene), f), { force: true }) }
const recordOf = scene => { try { return JSON.parse(fs.readFileSync(`${poolDir(scene)}/junkwell-plinth-${homeKey}.json`, 'utf8')) } catch { return null } }
const naturalIntact = () => ({ grass: blockIs(NATURAL, 'minecraft:grass_block'), dirt: blockIs({ ...NATURAL, y: NATURAL.y - 1 }, 'minecraft:dirt') })
const BUILD_BAG = [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['oak_trapdoor', 2], ['dirt', 8]]
const summary = rows => ({
  plinth: rows.filter(r => r.name === '_plinth').map(r => r.detail.slice(0, 160)).slice(-6),
  refused: rows.filter(r => r.name === '_well_refused').map(r => r.detail.slice(0, 200)).slice(-6),
  pitDug: rows.filter(r => r.name === '_well_pit_dug').map(r => r.detail),
  built: rows.filter(r => r.name === '_well_built').map(r => r.detail.slice(0, 120)),
  retired: rows.filter(r => r.name === '_well_retired').map(r => r.detail.slice(0, 120)).slice(0, 2),
  mode: rows.filter(r => r.name === '_plinthfirst_mode').map(r => r.detail).slice(0, 1),
})

/** A plinth planned, built and capped from the bot's own orders -> the evidence. `pre` sets the scene's world first. */
async function scenePlinth (scene, pre = () => {}) {
  buildArena(); pre(); freshPool(scene)
  const files = await startBot(scene, BUILD_BAG)
  const done = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_well_built'), 35 * 60_000, 5000)
  await sleep(3000)
  const rows = rowsOf(files.skillLog), rec = recordOf(scene)
  const cap = rec?.plan?.cap ?? null
  const builtAt = done ? xyz(field(done.detail, 'at')) : null
  const ev = { scene, rec: rec ? { state: rec.state, k: rec.plan?.k, cost: rec.plan?.cost, plannedFor: rec.plannedFor, cap } : null, builtAt,
    builtOnPlinth: !!cap && !!builtAt && builtAt.x === cap.x && builtAt.y === cap.y && builtAt.z === cap.z,
    wellOnPlinth: cap ? wellAt(cap) : null, wallsPlaced: cap ? placedWalls(cap) : null, naturalIntact: naturalIntact(),
    freshNaturalDigs: rows.filter(r => r.name === '_well_pit_dug' && field(r.detail, 'from') === 'fresh' && field(r.detail, 'pf') === '1' && !(cap && field(r.detail, 'at') === `${cap.x},${cap.y},${cap.z}`)).length,
    ...summary(rows) }
  await stopBot()
  return ev
}
async function scenePfnew () {
  const ev = await scenePlinth('pfnew')
  result({ ...ev, ok: ev.builtOnPlinth && ev.wellOnPlinth?.top && ev.wellOnPlinth?.floor && ev.rec?.k >= PL.PLINTH_FIRST_MIN_RAISE && ev.wallsPlaced === 16 && ev.naturalIntact.grass && ev.naturalIntact.dirt && ev.freshNaturalDigs === 0 })
}
/** The natural well at the natural cell, as build_well leaves one: a top trapdoor facing north over a bottom one. */
const placeNaturalWell = () => {
  const r = rcon(`setblock ${NATURAL.x} ${NATURAL.y - 1} ${NATURAL.z} minecraft:oak_trapdoor[half=bottom,facing=north,open=false]`,
    `setblock ${NATURAL.x} ${NATURAL.y} ${NATURAL.z} minecraft:oak_trapdoor[half=top,facing=north,open=false]`)
  if (r.some(x => !/Changed the block/.test(x.reply))) throw new Error('natural well: ' + JSON.stringify(r))
  const id = W.wellIdentity((x, y, z) => (x === NATURAL.x && z === NATURAL.z && y === NATURAL.y ? { name: 'oak_trapdoor', boundingBox: 'block', shapes: [], props: { half: 'top', facing: 'north', open: false } }
    : x === NATURAL.x && z === NATURAL.z && y === NATURAL.y - 1 ? { name: 'oak_trapdoor', boundingBox: 'block', shapes: [], props: { half: 'bottom', facing: 'north', open: false } } : solidRead(x, y, z)), NATURAL)
  if (!id.ok) throw new Error('the placed natural well is not a well by the bot\'s own test')
}
async function scenePfkeep () {
  buildArena(); placeNaturalWell(); freshPool('pfkeep')
  rcon(`kill @e[type=item,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`)
  const bag = [['egg', 16], ['flint', 64], ['rail', 16], ['dirt', 8]]
  for (let i = bag.length; i < 35; i++) bag.push([['andesite', 'diorite', 'granite'][i % 3], 64])
  const files = await startBot('pfkeep', bag)
  const disp = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_well_dispose' && r.status !== 'aborted'), 8 * 60_000, 3000)
  await sleep(60_000)   // a minute more of town orders: a plinth order would have come by now
  const rows = rowsOf(files.skillLog)
  const sh = `@e[type=item,x=${NATURAL.x},y=${NATURAL.y - 2},z=${NATURAL.z},dx=0,dy=1.4,dz=0]`
  const inShaft = rcon(`execute if entity ${sh}`)[0]?.reply ?? ''
  const cob = cobbleIn({ x0: HOME.x - 16, x1: HOME.x + 16, z0: HOME.z - 16, z1: HOME.z + 16, y0: 118, y1: 126 })
  const ev = { scene: 'pfkeep', dispose: disp?.detail.slice(0, 200) ?? null, itemsInShaft: passed(inShaft), well: wellAt(NATURAL), cobbleNearHome: cob.length,
    plinthRows: rows.filter(r => r.name === '_plinth').length, plinthRecord: recordOf('pfkeep')?.state ?? null, ...summary(rows) }
  await stopBot()
  result({ ...ev, ok: !!disp && ev.itemsInShaft && ev.well.top && ev.well.floor && ev.plinthRows === 0 && ev.plinthRecord === null && ev.cobbleNearHome === 0 })
}
async function scenePfretire () {
  const wall = { x: NATURAL.x + 1, y: NATURAL.y - 1, z: NATURAL.z }
  const ev = await scenePlinth('pfretire', () => {
    placeNaturalWell()
    if (!/Changed the block/.test(r1(`setblock ${wall.x} ${wall.y} ${wall.z} minecraft:air`))) throw new Error('wall not dug')
  })
  const old = wellAt(NATURAL)
  result({ ...ev, oldWellStanding: old, oldWallStillAir: blockIs(wall, 'minecraft:air'),
    ok: ev.retired.some(d => field(d, 'at') === `${NATURAL.x},${NATURAL.y},${NATURAL.z}`) && ev.builtOnPlinth && ev.wellOnPlinth?.top && ev.wellOnPlinth?.floor &&
        ev.rec?.k >= PL.PLINTH_FIRST_MIN_RAISE && ev.wallsPlaced === 16 && old.top && old.floor && ev.freshNaturalDigs === 0 })
}

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  P_(`root=${BOT_ROOT} sha=${execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()} server=${SERVER} scenes=${SCENES_S} natural=${JSON.stringify(NATURAL)}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  for (const s of SCENES_S.split(',')) {
    P_('=== scene', s)
    try {
      if (s === 'pfnew') await scenePfnew()
      else if (s === 'pfkeep') await scenePfkeep()
      else if (s === 'pfretire') await scenePfretire()
      else throw new Error(`unknown scene ${s}`)
    } catch (e) { P_('scene failed', s, e.stack || e.message); result({ scene: s, error: String(e.message).slice(0, 300) }); await stopBot().catch(() => {}) }
  }
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.plinthfirst-e2e`) } catch {}
  try {
    const c = [`kill @e[type=!player,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`]
    for (let y = A.y0; y <= A.y1; y += 10) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(A.y1, y + 9)} ${A.z1} minecraft:air`)
    P_('cleanup', rcon(...c, `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'list').slice(-2).map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`))
  } catch (e) { P_('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P_('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
