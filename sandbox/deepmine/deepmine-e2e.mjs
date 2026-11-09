#!/usr/bin/env node
// SANDBOX-ONLY end-to-end run of DEEPMINER-01, THE TOWN DEEP MINER (bots/src/deepmine.mjs + skills.mjs deepMine), Paper 1.21.8.
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot> through sandbox/run-bot.sh, with the loopback scripted brain
// (sandbox/sandbox-brain.mjs answering `status`), so the cognitive loop's deterministic order, the reflexes, the watchdog and the
// runner's 180 s cut all run as on the fleet. Nothing is commanded: the trip starts by itself when the bot stands by its town's
// finished stair with a kit, and ends by itself.
//
//   node sandbox/deepmine/deepmine-e2e.mjs <botRoot> <scene> [server] [seed]
//   diamond   an iron + two stone pickaxes: down the stair to y=16, `mine` on to y=-53, branches, back, bank, a diamond pickaxe
//   iron      two stone pickaxes only: an iron trip at the stair's y=16 landing
//   blocked   as diamond, with dirt pillared into three of the stair's air cells first (the 11-01 fleet failure, 852/1,163)
//   mine      TOWNMINE-01: the whole town mine -- sited at the first trip, BUILT on build trips (the deep stair to -53, bays, the hall, its
//             chest/table/furnace, torches; liquids sealed), then a diamond trip DOWN THE MINE to the hall and its gallery. Ends at
//             the first diamond trip's end after the mine is complete (or 240 min).
//   gallery   TOWNMINE-01: an iron trip on a stair whose mine is not sited (ext no_site): the IRON GALLERY from the 16 stub's end face
//             (LIVE: 2,030 iron branches in 3 d started inside the stub and dug nothing)
//   hall      TOWNMINE-01: the mine already standing (carved from the bots' own extended plan, fixtures set): a diamond trip walks
//             DOWN THE MINE to the hall (no `mine` staircase of its own), digs the diamond gallery, and climbs back
//   hazard    as diamond, plus a HAZARD FIELD at the work depth: a lava or water source every 4 blocks in x and z at y -53..-51
//             (outside the stair's skirt), so every branch and tunnel meets liquid; the server's truth must still show 0 breaches
// THE ARENA (181 x 181, rebuilt every run): bedrock -64, deepslate -63..-1, stone 0..69, grass 70, air above; a lava LAKE at
// y -58..-55 under the whole deep layer (the fleet worlds' lava level, region scan 11-01); seeded hazards -- lava pockets
// and water pockets at the work depth and along the descent band, iron clusters at 8..24, diamond clusters at -59..-48 -- and
// a town stair carved from shaftgeom's own plan (its air cells set to air; its treads and lining are the arena's stone).
// THE SERVER'S TRUTH after the trip (sandbox/deepmine/regiontruth.py over the saved region files): `breach` = cells the bot
// opened with lava or water beside them (must be 0), `flowing` = moving liquid (must stay at the arena's own count), what
// was dug and what ore remains; plus the bot's rows, its inventory, its deaths.
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <server> -`; edits on the arena only. Refuses unless the
// sandbox lock names `deepmine`.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sbx from '../lib/sbxlock.cjs'

const [BOT_ROOT, SCENE = 'diamond', SERVER = 'sandbox3', SEED_S = '11'] = process.argv.slice(2)
if (!BOT_ROOT || !['diamond', 'iron', 'blocked', 'hazard', 'mine', 'gallery', 'hall'].includes(SCENE)) throw new Error('usage: deepmine-e2e.mjs <botRoot> <diamond|iron|blocked|hazard|mine|gallery|hall> [server] [seed]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
sbx.requireSandboxLock(SERVER, 'deepmine')
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = path.resolve(__dir, '../..')
const OUT = `${R}/sandbox/log/deepmine-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15) + `-${SCENE}-${process.pid}`   // townmine-01: two lanes started in one minute shared a pool
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/${RUN}-driver.log`, s + '\n'); console.log(s) }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ run: RUN, server: SERVER, scene: SCENE, at: new Date().toISOString(), ...r }) + '\n'); P_('RESULT', r) }
const G = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/shaftgeom.mjs')))
const BP = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/buildproj.mjs')))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-deep-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const parseR = out => { const res = []; let cur = null; for (const line of String(out ?? '').split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line } return res }
/** A batch that survives a slow command (chunk generation, a big fill): the helper's 20 s socket timeout ends the batch, the
 *  server still runs the command; wait, then go on from the command after it. */
async function rconBatch (cmds, n = 400) {
  const out = []
  let i = 0
  while (i < cmds.length) {
    const chunk = cmds.slice(i, i + n)
    try {
      const o = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: chunk.join('\n') + '\n', encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 })
      out.push(...parseR(o)); i += chunk.length
    } catch (e) {
      const done = parseR(e?.stdout)
      out.push(...done.filter(x => x.reply !== ''))
      const skip = Math.max(1, done.length)   // the command that timed out is counted as sent
      P_('rcon slow', { at: i + skip - 1, cmd: chunk[skip - 1]?.slice(0, 80) })
      i += skip
      await sleep(25_000)
    }
  }
  return out
}
const bad = res => res.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected|Invalid/i.test(x.reply))

// ---------------------------------------------------------------- the arena
const C = { x: 7200, z: 7200 }, HALF = 80
const A = { x0: C.x - HALF, x1: C.x + HALF, z0: C.z - HALF, z1: C.z + HALF }
const GY = 70
const HOME = { x: C.x - 22, y: GY + 1, z: C.z }
const CENTER = [C.x, C.z]
const AWAY = G.awayFrom(HOME, C.x, C.z)
let seed = Number(SEED_S) || 11
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const set = (c, id) => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`
async function buildArena () {
  const fl = []
  for (let x = A.x0; x <= A.x1; x += 48) for (let z = A.z0; z <= A.z1; z += 48) fl.push(`forceload add ${x} ${z} ${Math.min(A.x1, x + 47)} ${Math.min(A.z1, z + 47)}`)
  await rconBatch(fl, 1)
  for (let i = 0; i < 20; i++) { const r = rcon(`execute if block ${A.x1} 0 ${A.z1} minecraft:air`, `execute if block ${A.x1} 0 ${A.z1} minecraft:stone`, `execute if block ${A.x1} 0 ${A.z1} minecraft:deepslate`); if (r.some(x => /Test (passed|failed)/.test(x.reply))) break; await sleep(5000) }
  const c = [`kill @e[type=!player,x=${A.x0},y=-64,z=${A.z0},dx=${A.x1 - A.x0},dy=200,dz=${A.z1 - A.z0}]`]
  for (let y = GY + 1; y <= GY + 30; y++) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y} ${A.z1} minecraft:air`)
  c.push(`fill ${A.x0} -64 ${A.z0} ${A.x1} -64 ${A.z1} minecraft:bedrock`)
  for (let y = -63; y <= GY - 1; y++) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y} ${A.z1} minecraft:${y < 0 ? 'deepslate' : 'stone'}`)
  c.push(`fill ${A.x0} ${GY} ${A.z0} ${A.x1} ${GY} ${A.z1} minecraft:grass_block`)
  const b = bad(await rconBatch(c, 40))
  if (b.length) throw new Error('arena: ' + b.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
}
/** The hazards and ores, seeded -> { cmds, native: [[x,y,z]] air the arena made, notes }. */
function hazards () {
  const cmds = [], native = [], notes = { lavaPockets: 0, waterPockets: 0, diamonds: 0, iron: 0 }
  // the lava lake (the fleet worlds' lava level): y -58..-55 under everything but a 12-block skirt round the stair
  // ...in PATCHES (the worlds' lava lakes are caves below the lava level, not a sheet): 10 lakes, 12-30 across, 4 deep
  for (let i = 0; i < 10; i++) {
    const w = ri(12, 30), d = ri(12, 30), x = ri(A.x0, A.x1 - w), z = ri(A.z0, A.z1 - d)
    cmds.push(`fill ${x} -58 ${z} ${x + w} -55 ${z + d} minecraft:lava`)
    notes.lakes = (notes.lakes ?? 0) + 1
  }
  const far = (x, z, r = 9) => Math.max(Math.abs(x - C.x), Math.abs(z - C.z)) > r
  // diamond clusters at the work depth, every ~10 blocks (denser than the worlds: a 3-h canary-sized trip must meet some)
  for (let gx = A.x0 + 6; gx <= A.x1 - 6; gx += 11) for (let gz = A.z0 + 6; gz <= A.z1 - 6; gz += 11) {
    const x = gx + ri(-3, 3), z = gz + ri(-3, 3), y = ri(-56, -48)
    if (!far(x, z)) continue
    if (y <= -55) continue   // in the lake
    const n = ri(1, 4)
    for (let i = 0; i < n; i++) { cmds.push(set([x + (i % 2), y + (i > 1 ? 1 : 0), z], 'deepslate_diamond_ore')); notes.diamonds++ }
  }
  // iron clusters round the y=16 landing and down the descent band
  for (let i = 0; i < 90; i++) {
    const x = ri(A.x0 + 4, A.x1 - 4), z = ri(A.z0 + 4, A.z1 - 4), y = ri(-20, 24)
    if (!far(x, z)) continue
    const id = y < 0 ? 'deepslate_iron_ore' : 'iron_ore'
    for (let k = 0; k < ri(2, 5); k++) { cmds.push(set([x + (k % 2), y + (k >> 1), z], id)); notes.iron++ }
  }
  // LAVA POCKETS (a 2x1x2 source block pool behind rock) at the work depth and in the descent band; WATER POCKETS likewise
  for (let i = 0; i < 70; i++) {
    const x = ri(A.x0 + 3, A.x1 - 3), z = ri(A.z0 + 3, A.z1 - 3), y = i % 2 ? ri(-54, -46) : ri(-40, 14)
    if (!far(x, z, 12)) continue
    const id = i % 3 === 0 ? 'water' : 'lava'
    cmds.push(`fill ${x} ${y} ${z} ${x + 1} ${y} ${z + 1} minecraft:${id}`)
    notes[id === 'lava' ? 'lavaPockets' : 'waterPockets']++
  }
  if (SCENE === 'hazard') {
    // three layers (the miner works where its last tunnel left it: -53 .. -44 on Paper 11-01)
    for (const band of [[-53, -51], [-50, -48], [-47, -44]]) for (let x = A.x0 + 2 + (band[0] & 1); x <= A.x1 - 2; x += 4) for (let z = A.z0 + 2; z <= A.z1 - 2; z += 4) {
      if (!far(x, z, 12)) continue
      const y = ri(band[0], band[1]), id = rnd() < 0.6 ? 'lava' : 'water'
      cmds.push(set([x, y, z], id)); notes.field = (notes.field ?? 0) + 1
    }
  }
  return { cmds, native, notes }
}
async function carveStair () {
  const origin = G.originFor(C.x, C.z, AWAY)
  const plan = G.planStair({ origin, away: AWAY, g: GY })
  const air = plan.cells.filter(c => c.role === 'air').map(c => c.at)
  const b = bad(await rconBatch(air.map(c => set(c, 'air'))))
  if (b.length) throw new Error('stair: ' + b[0].cmd + ' => ' + b[0].reply)
  return { plan, air, origin }
}
/** A read over the built arena (for the survey: the record is the stair's own, as a builder would publish it). */
const arenaRead = airSet => (x, y, z) => {
  if (airSet.has(`${x},${y},${z}`) || y > GY) return { name: 'air', boundingBox: 'empty', full: false }
  if (y === GY) return { name: 'grass_block', boundingBox: 'block', full: true }
  return { name: y < 0 ? 'deepslate' : 'stone', boundingBox: 'block', full: true }
}

// ---------------------------------------------------------------- run
const NAME = 'sandbox-Deep'
const POOL = `${R}/sandbox/state/_pool-deep-${RUN}`
const ENV = `sandbox/log/deepmine-e2e/deep-${RUN}.env`   // under sandbox/log (ignored): never an untracked file in the tree
const LOGD = `./sandbox/log/deepmine-${RUN}`
let brain = null, botp = null
const kill = p => { try { p?.kill('SIGTERM') } catch {} }
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { kill(botp); kill(brain); try { execFileSync('pkill', ['-f', `deep-${RUN}.env`]) } catch {} ; process.exit(1) })
try {
  P_('arena', { server: SERVER, scene: SCENE, center: C, away: AWAY })
  rcon(`kick ${NAME} rebuild`)
  await buildArena()
  const hz = hazards()
  const hb = bad(await rconBatch(hz.cmds))
  if (hb.length) throw new Error('hazards: ' + hb[0].cmd + ' => ' + hb[0].reply)
  const st = await carveStair()
  // THE STAIR'S CELLS ARE THE BUILDER'S: never a hazard or ore inside the 5x5 shell (the far() skirt) -- re-assert the lining
  const airSet = new Set(st.air.map(c => c.join(',')))
  const sv = G.surveySite(arenaRead(new Set()), HOME, { x: C.x, z: C.z, away: AWAY })
  if (!sv.ok) throw new Error(`survey: ${sv.why}`)
  let rec = { ...G.stairRecord(sv, { home: HOME, now: Date.now(), by: 'sandbox-Builder' }), state: 'complete', structure_complete: true, completeAt: Date.now() }
  rec.landings_built = [...rec.landings]
  // townmine-01 gallery scene: the mine is refused (no_site), so the trip is an iron trip on the stair as it stands
  if (SCENE === 'gallery') rec.ext = { v: 1, blueprint: 'townmine@1', state: 'no_site', why: 'scene' }
  if (SCENE === 'hall') {
    const TM = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/townmine.mjs')))
    rec = TM.withMine(rec, { ...G.mineExt(GY, { now: Date.now(), by: 'sandbox-Builder' }), state: 'complete', completeAt: Date.now(), furnished: Date.now() })
    const full = G.planOf(rec)
    const extAir = full.cells.filter(c => c.role === 'air' && !airSet.has(c.at.join(','))).map(c => c.at)
    const fx = full.rooms.find(r => r.kind === 'hall').fixtures
    const hb2 = bad(await rconBatch([...extAir.map(c => set(c, 'air')), ...fx.map(f => set(f.at, f.item))]))
    if (hb2.length) throw new Error('hall: ' + hb2[0].cmd + ' => ' + hb2[0].reply)
    st.air.push(...extAir)
    P_('hall', { extAir: extAir.length, K: full.K })
  }
  if (SCENE === 'blocked') {
    // THE FLEET'S FAILURE (11-01): dirt pillared into three air cells (steps 12, 30 and 47)
    const blocks = [12, 30, 47].map(k => G.planOf(rec).steps[k].air[0])
    rcon(...blocks.map(c => set(c, 'dirt')))
    P_('blocked', blocks)
  }
  fs.mkdirSync(POOL, { recursive: true })
  const key = BP.projKey(HOME, G.SHAFT_PLOT)
  const pub = BP.publishRecord(POOL, key, () => rec, { by: 'sandbox-Builder' })
  if (pub.result !== 'accepted') throw new Error(`record: ${pub.result}`)
  P_('record', { key, K: rec.K, landings: rec.landings, exit: rec.exit, notes: hz.notes })
  // the town: a chest and a table by home (the deposit and the pickaxe craft)
  rcon(set([HOME.x + 3, GY + 1, HOME.z + 2], 'chest'), set([HOME.x + 3, GY + 1, HOME.z - 2], 'crafting_table'),
    `setworldspawn ${HOME.x} ${HOME.y} ${HOME.z}`, 'gamerule spawnRadius 0', 'difficulty peaceful')
  // the bot
  const envSrc = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted-stair.env`, 'utf8')
    .replace(/^BOT_NAME=.*$/m, `BOT_NAME=${NAME}`).replace(/^MINECRAFT_PORT=.*$/m, `MINECRAFT_PORT=${PORTS[SERVER]}`)
    .replace(/^MEMORY_POOL=.*$/m, 'MEMORY_POOL=deep').replace(/^LOG_DIR=.*$/m, `LOG_DIR=${LOGD}`).replace(/^STATE_DIR=.*$/m, `STATE_DIR=./sandbox/state/${NAME}-${RUN}`)
    .replace(/^HOME_X=.*$/m, `HOME_X=${HOME.x}`).replace(/^HOME_Y=.*$/m, `HOME_Y=${HOME.y}`).replace(/^HOME_Z=.*$/m, `HOME_Z=${HOME.z}`)
    .replace(/^BOARD_X=.*$/m, `BOARD_X=${HOME.x}`).replace(/^BOARD_Y=.*$/m, `BOARD_Y=${HOME.y}`).replace(/^BOARD_Z=.*$/m, `BOARD_Z=${HOME.z}`)
    .replace(/^CODE_VERSION=.*$/m, `CODE_VERSION=deepmine-${RUN}`)
    .replace(/^WORLD_BORDER_RADIUS=.*$/m, 'WORLD_BORDER_RADIUS=20000')   // the arena is ~10,000 from the origin; gather filters by the border
  fs.writeFileSync(`${R}/${ENV}`, envSrc + `\nPOOL_STATE_DIR=${POOL}\nDEEPMINE=on\nSHAFT=on\n${['mine', 'gallery'].includes(SCENE) ? 'TOWNMINE=on\n' : 'TOWNMINE=off\n'}`)
  brain = spawn('node', [`${R}/sandbox/sandbox-brain.mjs`, '11499'], { env: { ...process.env, SANDBOX_SCRIPT: 'status' }, stdio: ['ignore', fs.openSync(`${OUT}/${RUN}-brain.log`, 'a'), 'inherit'] })
  await sleep(800)
  botp = spawn('bash', [`${R}/sandbox/run-bot.sh`, ENV], { env: { ...process.env, BOT_ROOT }, stdio: ['ignore', fs.openSync(`${OUT}/${RUN}-bot.log`, 'a'), fs.openSync(`${OUT}/${RUN}-bot.log`, 'a')] })
  // wait for the join, then the kit (the bot stands at home: the world spawn was moved there)
  for (let i = 0; i < 60; i++) { await sleep(2000); if (rcon('list')[0]?.reply?.includes(NAME)) break }
  if (!rcon('list')[0]?.reply?.includes(NAME)) throw new Error('the bot never joined')
  const kitCmds = [`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${rec.exit[0] + 0.5} ${rec.exit[1]} ${rec.exit[2] + 0.5}`, `spawnpoint ${NAME} ${HOME.x} ${HOME.y} ${HOME.z}`,
    `effect give ${NAME} minecraft:saturation 7200 1 true`,
    ...(['iron', 'gallery'].includes(SCENE) ? [] : [`give ${NAME} minecraft:iron_pickaxe ${SCENE === 'mine' ? 3 : SCENE === 'hall' ? 2 : 1}`]), `give ${NAME} minecraft:stone_pickaxe ${SCENE === 'mine' ? 4 : 2}`,
    `give ${NAME} minecraft:cobblestone ${SCENE === 'mine' ? 192 : 64}`, `give ${NAME} minecraft:torch ${SCENE === 'mine' ? 64 : 24}`, `give ${NAME} minecraft:stick 4`, `give ${NAME} minecraft:oak_planks 8`,
    ...(SCENE === 'mine' ? [`give ${NAME} minecraft:chest 1`, `give ${NAME} minecraft:crafting_table 1`, `give ${NAME} minecraft:furnace 1`] : [])]
  rcon(...kitCmds)
  P_('kit', { scene: SCENE })
  // watch: the bot's own rows, the server's view of it
  const rowsFile = () => { try { const d = `${R}/${LOGD.slice(2)}`; return fs.readdirSync(d).filter(f => /^skill-.*\.jsonl$/.test(f)).map(f => `${d}/${f}`) } catch { return [] } }
  const seen = new Set(), events = []
  let end = null, minY = Infinity, deaths = 0
  const DEADLINE = Date.now() + (SCENE === 'mine' ? 240 : 75) * 60_000
  let mineDone = false
  while (Date.now() < DEADLINE && !end) {
    await sleep(5000)
    for (const f of rowsFile()) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line || seen.has(line)) continue
        seen.add(line)
        let r; try { r = JSON.parse(line) } catch { continue }
        const k = r?.skill?.name
        const y = r?.bot?.pos?.y
        if (Number.isFinite(y)) minY = Math.min(minY, y)
        if (k === '_death') { deaths++; P_('DEATH', r.skill.detail) }
        if (['_deepmine', '_deepmine_skip', '_exit_reserve_abort', '_shaft_use', '_lava_escape', '_entombed', 'deep_mine', '_townmine'].includes(k) || (k === 'mine' && r?.trigger !== 'reflex')) {
          const e = { t: r['@timestamp'], k, s: r.skill.status, d: String(r.skill.detail ?? '').slice(0, 200), y: Math.floor(y) }
          events.push(e); P_(k, e.s, e.y, e.d)
          if (k === '_townmine' && /op=complete /.test(e.d)) mineDone = true
          if (k === '_deepmine' && /op=end /.test(e.d) && (SCENE !== 'mine' || (mineDone && /target=diamond/.test(e.d)))) end = e
        }
      }
    }
  }
  // the server's truth
  rcon('save-all flush'); await sleep(4000)
  const inv = rcon(`data get entity ${NAME} Inventory`)[0]?.reply ?? ''
  // the server's own count, one item at a time (`data get` truncates a long inventory): `clear <p> <item> 0` only counts
  const count = id => { const r = rcon(`clear ${NAME} minecraft:${id} 0`)[0]?.reply ?? ''; return Number((r.match(/Found (\d+) matching/) ?? [])[1] ?? 0) }
  const pos = rcon(`data get entity ${NAME} Pos`)[0]?.reply ?? ''
  const nativeF = `${OUT}/${RUN}-native.json`
  fs.writeFileSync(nativeF, JSON.stringify(st.air))
  execFileSync('scp', ['-q', ...SSH.slice(0, 6), nativeF, `${__dir}/regiontruth.py`, 'mike@10.0.0.30:/tmp/'])
  const world = `/srv/block2/${SERVER}/world`
  let truth = null
  try {
    truth = JSON.parse(execFileSync('ssh', [...SSH, `nice -n 19 python3 /tmp/regiontruth.py ${world} ${A.x0} -60 ${A.z0} ${A.x1} 69 ${A.z1} /tmp/${path.basename(nativeF)} 12`], { encoding: 'utf8', timeout: 900000 }))
  } catch (e) { truth = { error: String(e?.message ?? e).slice(0, 200) } }
  const deep = events.filter(e => e.k === '_deepmine')
  const phases = [...new Set(deep.map(e => (e.d.match(/phase=(\w+)/) ?? [])[1]).filter(Boolean))]
  const found = Number((end?.d?.match(/found=(\d+)/) ?? [])[1] ?? 0)
  // THE LOOP CLOSED (Codex r1 note: zero ore must not pass): home, ore brought back, nobody died, nothing opened beside a liquid
  // TOWNMINE-01: the mine scene passes on the mine complete, its fixtures standing (the server's own test), a diamond trip that
  // walked down the mine to the hall, no death and no breach; the gallery scene on gallery cells dug and no stair_cells branch
  const mineRows = events.filter(e => e.k === '_townmine')
  let fixtures = null
  if (SCENE === 'mine') {
    const r2 = { ...rec, ...(BP.recordHead(POOL, key).head?.rec ?? {}) }
    const plan2 = G.planOf(r2)
    const hall = (plan2.rooms ?? []).find(q => q.kind === 'hall')
    fixtures = (hall?.fixtures ?? []).map(f => ({ item: f.item, at: f.at, ok: /Test passed/.test(rcon(`execute if block ${f.at[0]} ${f.at[1]} ${f.at[2]} minecraft:${f.item}`)[0]?.reply ?? '') }))
  }
  const viaHall = deep.some(e => /why=mine_hall/.test(e.d))
  const galleryCells = mineRows.filter(e => /op=gallery /.test(e.d)).reduce((n, e) => n + Number((e.d.match(/cells=(\d+)/) ?? [])[1] ?? 0), 0)
  const stairCells = deep.filter(e => /op=branch .*why=stair_cells/.test(e.d)).length
  const ok = SCENE === 'mine'
    ? mineDone && !!fixtures?.length && fixtures.every(f => f.ok) && viaHall && deaths === 0 && !!truth && truth.breach_n === 0
    : SCENE === 'hall'
      ? !!end && /end=home/.test(end.d) && viaHall && galleryCells > 0 && deaths === 0 && !!truth && truth.breach_n === 0
    : SCENE === 'gallery'
      ? !!end && /end=home/.test(end.d) && galleryCells > 0 && stairCells === 0 && deaths === 0 && !!truth && truth.breach_n === 0
      : !!end && /end=home/.test(end.d) && found > 0 && deaths === 0 && !!truth && truth.breach_n === 0 && truth.flowing === 0
  result({ ok, end: end?.d ?? null, deaths, minY: Number.isFinite(minY) ? Math.floor(minY) : null, phases, pos: pos.slice(-60),
    bag: { diamond: count('diamond'), diamond_pickaxe: count('diamond_pickaxe'), raw_iron: count('raw_iron'), iron_pickaxe: count('iron_pickaxe'), stone_pickaxe: count('stone_pickaxe'), cobblestone: count('cobblestone'), cobbled_deepslate: count('cobbled_deepslate'), torch: count('torch') },
    rows: deep.length, deepRows: deep.map(e => e.d).slice(-40), mineRows: mineRows.map(e => e.d).slice(-40), mineDone, fixtures, viaHall, galleryCells, stairCells, truth, hazards: hz.notes, ms: Date.now() - T0 })
} catch (e) {
  result({ ok: false, error: String(e?.stack ?? e).slice(0, 500) })
} finally {
  kill(botp); kill(brain)
  await sleep(1500)
  try { rcon(`kick ${NAME} done`, 'setworldspawn 0 80 0') } catch {}
  process.exit(0)
}
