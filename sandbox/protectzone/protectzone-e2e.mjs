#!/usr/bin/env node
// protectzone-01 PAPER DRIVER (10-20). SANDBOX ONLY (Paper 1.21.8, 10.0.0.30:25599..25602). The REAL bot (src/index.mjs from
// <botRoot>, unmodified) reads a `protected-zones.json` of the SAME SHAPE as the showcase's (version 1, hashed_seed of THIS
// world, one zone box) from its pool's directory; a loopback brain hands it model verbs. Every verdict is the SERVER's word:
//   ZONE INTACT   `execute if blocks <zone> <pristine copy> all` -- the zone compared, cell by cell, with a copy cloned
//                 before the bot joined (the copy sits 100 blocks south, force-loaded, untouched by any scene)
//   CHEST INTACT  `data get block <chest> Items` before and after
// and every scene has a POSITIVE CONTROL: the same scene with the file absent (the zone off) must break the zone or take
// from the chest -- an instrument that cannot see a change proves nothing.
//
//   WELL_REPO=<harness: sandbox/run-bot.sh, sandbox/sandbox-bot-scripted.env>
//   node sandbox/protectzone/protectzone-e2e.mjs <botRoot> <scene[:off],...> [server]
//   scenes: gather   the bot stands inside the zone; `gather dirt` -- the nearest dirt is in the zone, more lies outside
//           mine     the bot stands inside the zone; `mine` -- it must walk out and cut its stair outside
//           chest    a village chest (16 oak logs) inside the zone, 13 blocks from home; `withdraw oak_log`
//           craft    the only crafting table is the village's; the bag holds planks and sticks; `craft wooden_pickaxe`
//   `<scene>:off` runs it with NO zone file (the positive control).
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `protectzone`. World edits on the arena only.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: protectzone-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/protectzone/.test(lock)) throw new Error(`the sandbox lock does not name protectzone: ${lock.trim()}`)
const R = process.env.WELL_REPO
if (!R || !fs.existsSync(`${R}/sandbox/run-bot.sh`)) throw new Error('WELL_REPO must hold sandbox/run-bot.sh')
const NAME = 'sandbox-PZone'
const BRAIN_PORT = Number(process.env.PZ_BRAIN_PORT || 11493)
const OUT = `${R}/sandbox/log/protectzone-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const PZ = await import(path.join(BOT_ROOT, 'bots/src/protectzone.mjs'))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-pzone-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
async function waitFor (pred, ms, step = 1000) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

// ---------------------------------------------------------------- THE WORLD'S ID (as mineflayer reads the login packet)
function worldIdOf (seed) {
  const buf = Buffer.alloc(8); buf.writeBigInt64LE(BigInt(seed))
  const h = crypto.createHash('sha256').update(buf).digest()
  const v = h.readBigInt64LE(0)
  const b = Buffer.alloc(8); b.writeBigInt64BE(v)
  return `${b.readInt32BE(0)}:${b.readInt32BE(4)}`
}

// ---------------------------------------------------------------- the arena: flat ground, a small spruce house in the zone
const C = { x: 3000, z: 3000 }
const A = { x0: C.x - 50, x1: C.x + 40, z0: C.z - 30, z1: C.z + 30, y0: 100, y1: 140 }
const ZB = { x0: C.x - 5, y0: 110, z0: C.z - 15, x1: C.x + 25, y1: 135, z1: C.z + 15 }      // 31 x 26 x 31 = 24,986 cells (< clone's 32,768)
const COPY_DZ = 100                                                                          // the pristine copy, 100 south
// home: 3 west of the zone for the chest / craft scenes (the village chest 15 east of home, inside the town's scan); 25 west
// for gather / mine (the town's square then ends 9 west of the zone, so bare dirt lies between them)
const HOME_NEAR = { x: C.x - 8, y: 120, z: C.z }, HOME_FAR = { x: C.x - 30, y: 120, z: C.z }
let HOME = HOME_NEAR
const CHEST = { x: C.x + 7, y: 120, z: C.z }, TABLE = { x: C.x + 6, y: 120, z: C.z + 1 }
const IN_ZONE = { x: C.x + 2, y: 120, z: C.z + 8 }                                            // where the bot stands for gather / mine
const chunksOf = (x0, z0, x1, z1) => `${x0} ${z0} ${x1} ${z1}`
function buildArena () {
  const c = [`forceload add ${chunksOf(A.x0, A.z0, A.x1, A.z1)}`, `forceload add ${chunksOf(ZB.x0, ZB.z0 + COPY_DZ, ZB.x1, ZB.z1 + COPY_DZ)}`]
  rcon(...c)
  const k = [`kill @e[type=!player,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`]
  for (let y = A.y0; y <= A.y1; y += 5) k.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(A.y1, y + 4)} ${A.z1} minecraft:air`)
  for (let y = 108; y <= 116; y += 4) k.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(116, y + 3)} ${A.z1} minecraft:stone`)
  k.push(`fill ${A.x0} 117 ${A.z0} ${A.x1} 119 ${A.z1} minecraft:dirt`)
  // the house: spruce plank walls 5 x 5, 3 high, a plank roof, an open doorway on the west; a chest, a table, a bed inside
  const hx0 = C.x + 5, hx1 = C.x + 9, hz0 = C.z - 2, hz1 = C.z + 2
  k.push(`fill ${hx0} 120 ${hz0} ${hx1} 122 ${hz1} minecraft:spruce_planks hollow`, `fill ${hx0} 123 ${hz0} ${hx1} 123 ${hz1} minecraft:spruce_planks`,
    `fill ${hx0} 120 ${C.z} ${hx0} 121 ${C.z} minecraft:air`,
    `setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} minecraft:chest[facing=west]{Items:[{Slot:0b,id:"minecraft:oak_log",count:16}]}`,
    `setblock ${TABLE.x} ${TABLE.y} ${TABLE.z} minecraft:crafting_table`,
    `setblock ${C.x + 8} 120 ${C.z} minecraft:red_bed[facing=north,part=head]`, `setblock ${C.x + 8} 120 ${C.z + 1} minecraft:red_bed[facing=north,part=foot]`,
    // a dirt path through the zone and a lamp, as a village has
    `fill ${ZB.x0} 119 ${C.z + 6} ${ZB.x1} 119 ${C.z + 6} minecraft:dirt_path`, `setblock ${C.x + 12} 120 ${C.z + 7} minecraft:cobblestone_wall`, `setblock ${C.x + 12} 121 ${C.z + 7} minecraft:torch`)
  const bad = rcon(...k).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
  const cl = r1(`clone ${ZB.x0} ${ZB.y0} ${ZB.z0} ${ZB.x1} ${ZB.y1} ${ZB.z1} ${ZB.x0} ${ZB.y0} ${ZB.z0 + COPY_DZ}`)
  if (!/cloned/i.test(cl)) throw new Error('pristine copy: ' + cl)
}
const zoneIntact = () => {
  const rep = r1(`execute if blocks ${ZB.x0} ${ZB.y0} ${ZB.z0} ${ZB.x1} ${ZB.y1} ${ZB.z1} ${ZB.x0} ${ZB.y0} ${ZB.z0 + COPY_DZ} all`)
  return { intact: /Test passed/.test(rep), reply: rep.slice(0, 120) }
}
const chestItems = () => r1(`data get block ${CHEST.x} ${CHEST.y} ${CHEST.z} Items`).replace(/^.*has the following block data: /, '').slice(0, 200)
const tablesOutside = () => {
  const cmds = [], keys = []
  for (let x = A.x0; x <= A.x1; x++) for (let z = A.z0; z <= A.z1; z++) for (const y of [120, 121]) {
    if (x >= ZB.x0 && x <= ZB.x1 && z >= ZB.z0 && z <= ZB.z1) continue
    cmds.push(`execute if block ${x} ${y} ${z} minecraft:crafting_table`); keys.push(`${x},${y},${z}`)
  }
  const out = []
  for (let i = 0; i < cmds.length; i += 500) out.push(...rcon(...cmds.slice(i, i + 500)))
  return keys.filter((k, i) => /Test passed/.test(out[i]?.reply ?? ''))
}

// ---------------------------------------------------------------- the brain: a queue of model verbs, else status
const brainQueue = []
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const decision = brainQueue.shift() ?? { skill: 'status', args: {} }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: scripted', saw_end: sentinel }) },
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
const poolOf = scene => `sbxpz-${RUN}-${scene.replace(':', '-')}`
const poolDir = scene => `${R}/sandbox/state/_pool-${poolOf(scene)}`
const SEED = Number((r1('seed').match(/\[(-?\d+)\]/) || [])[1])
if (!Number.isFinite(SEED)) throw new Error('no seed')
const WORLD_ID = worldIdOf(SEED)
function writeZones (scene, on) {
  fs.mkdirSync(poolDir(scene), { recursive: true })
  for (const f of fs.readdirSync(poolDir(scene))) fs.rmSync(path.join(poolDir(scene), f), { force: true })
  if (!on) return null
  const doc = { version: 1, world: 'sandbox', seed: SEED, hashed_seed: WORLD_ID,
                zones: [{ id: 'village-sbx', kind: 'village', label: 'the sandbox village', box: [ZB.x0, ZB.y0, ZB.z0, ZB.x1, ZB.y1, ZB.z1] }] }
  const parsed = PZ.parseZones(doc, { worldId: WORLD_ID })
  if (parsed.why !== 'ok') throw new Error('the zone file does not parse: ' + parsed.why)
  fs.writeFileSync(path.join(poolDir(scene), PZ.ZONES_FILE), JSON.stringify(doc, null, 1))
  return doc
}
async function startBot (scene, slots, at) {
  const logRel = `./sandbox/log/protectzone-e2e/${RUN}-${scene.replace(':', '-')}`
  const skillLog = `${R}/sandbox/log/protectzone-e2e/${RUN}-${scene.replace(':', '-')}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${RUN}-${scene.replace(':', '-')}.out`
  const envRel = 'sandbox/.env.protectzone-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/pz-${RUN}-${scene.replace(':', '-')}`); set('MEMORY_POOL', poolOf(scene))
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 30)
  set('WORLD_BORDER_RADIUS', 4000); set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  set('LLM_DECISION_COOLDOWN_MS', 3000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${at.x + 0.5} ${at.y} ${at.z + 0.5}`, `effect clear ${NAME}`)
  await sleep(6000)
  const c = [`tp ${NAME} ${at.x + 0.5} ${at.y} ${at.z + 0.5}`]
  let s = 0
  for (const [id, n] of slots) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(3000)
  return { skillLog, botOut }
}
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), run: RUN, server: SERVER, world_id: WORLD_ID, ...r }) + '\n'); P_('RESULT', r) }
const pzRows = rows => ({
  mode: rows.filter(r => r.name === '_protectzone_mode').map(r => r.detail).slice(0, 1),
  refused: rows.filter(r => r.name === '_protect_zone_refused').map(r => r.detail.slice(0, 160)).slice(0, 6),
  counts: rows.filter(r => r.name === '_protect_zone').map(r => r.detail).slice(-3),
})
const skillRow = (rows, name, after) => rows.find(r => r.name === name && r.ts >= after && r.status !== 'started')

async function scene (spec) {
  const [name, flag] = spec.split(':'), on = flag !== 'off'
  HOME = name === 'gather' || name === 'mine' ? HOME_FAR : HOME_NEAR
  buildArena()
  const pre = { zone: zoneIntact(), chest: chestItems() }
  if (!pre.zone.intact) throw new Error('the pristine copy does not match the zone before the scene: ' + pre.zone.reply)
  writeZones(spec, on)
  const bag = name === 'craft' ? [['oak_planks', 8], ['stick', 4]] : name === 'mine' ? [['stone_pickaxe', 1], ['cobblestone', 32]] : [['wooden_shovel', 1]]
  const at = name === 'chest' || name === 'craft' ? { x: C.x + 3, y: 120, z: C.z } : IN_ZONE
  const files = await startBot(spec, bag, at)
  const t0 = Date.now()
  const verb = name === 'gather' ? { skill: 'gather', args: { block: 'dirt', count: 3 } }
    : name === 'mine' ? { skill: 'mine', args: { y: 104 } }
    : name === 'chest' ? { skill: 'withdraw', args: { item: 'oak_log', count: 8 } }
    : { skill: 'craft', args: { item: 'wooden_pickaxe', count: 1 } }
  brainQueue.length = 0; brainQueue.push(verb)
  const done = await waitFor(() => skillRow(rowsOf(files.skillLog), verb.skill, t0), 6 * 60_000, 2000)
  await sleep(4000)
  const rows = rowsOf(files.skillLog)
  const ev = { scene: spec, zoneFile: on, verb, outcome: done ? `${done.status} ${done.detail.slice(0, 220)}` : 'no outcome row',
               zone: zoneIntact(), chestBefore: pre.chest, chestAfter: chestItems(), ...pzRows(rows) }
  if (name === 'craft') ev.tablesOutside = tablesOutside()
  if (name === 'gather') ev.gotDirt = /dirt/.test(r1(`data get entity ${NAME} Inventory`))
  await stopBot()
  // THE VERDICT. With the zone: the zone and the chest are exactly as before. Without it (the control): the scene changed them.
  const changed = !ev.zone.intact || ev.chestAfter !== ev.chestBefore
  ev.ok = on ? (ev.zone.intact && ev.chestAfter === ev.chestBefore && ev.mode.some(d => /zones=1 why=ok/.test(d))) : changed
  if (on && name === 'gather') ev.ok = ev.ok && ev.gotDirt
  if (on && name === 'mine') ev.ok = ev.ok && /^success/.test(ev.outcome)
  result(ev)
}

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  // NO RANDOM TICKS while a scene runs (restored after): covered dirt and paths otherwise change on their own and the
  // zone-vs-copy comparison would see the world, not the bot (first run 10-20: 'Test failed' with nothing dug)
  const tick0 = Number((r1('gamerule randomTickSpeed').match(/(-?\d+)\s*$/) || [])[1])
  if (!Number.isFinite(tick0)) throw new Error('randomTickSpeed unreadable')
  r1('gamerule randomTickSpeed 0')
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  P_('world', SEED, WORLD_ID)
  try { for (const s of SCENES_S.split(',')) { try { await scene(s) } catch (e) { result({ scene: s, ok: false, error: String(e?.stack ?? e).slice(0, 400) }); await stopBot() } } }
  finally {
    try { brain.close() } catch {}
    try { fs.unlinkSync(`${R}/sandbox/.env.protectzone-e2e`) } catch {}
    try { r1(`gamerule randomTickSpeed ${tick0}`) } catch {}
    try { rcon(`forceload remove ${chunksOf(A.x0, A.z0, A.x1, A.z1)}`, `forceload remove ${chunksOf(ZB.x0, ZB.z0 + COPY_DZ, ZB.x1, ZB.z1 + COPY_DZ)}`) } catch {}
  }
}
await main()
