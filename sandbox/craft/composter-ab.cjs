// SANDBOX-ONLY composter A/B driver: ONE FRESH BOT PER TRIAL (the town orders' cooldowns and backoffs live in the
// bot's memory: build 5 min / 30 min, compost 3 min / 15 min), the real bot from <botRoot> unmodified (trace.cjs only
// observes packets). The scene is set by RCON; nothing is queued for the model -- compost and build_composter are
// deterministic town orders (composter.mjs townOrder), so the driver WATCHES for them for a fixed window and reads the
// server's truth before and after.
//
//   node composter-ab.cjs <arm> <botRoot> <reps> <scene,scene,...> [server]
//
// "Town" for the bot (composter.mjs / cognitive.mjs): within TOWN_RADIUS 48 of HOME_X/HOME_Z, a chest/barrel within
// STORAGE_NEAR 16 of the bot, and for compost/harvest a composter within ADOPT_RADIUS 16 of home. The arena puts home at
// the stand (700 120 700) and a chest at 690 120 690 (14.9 from the stand, far outside any site's 3-block clearance).
// The site record lives in the pool state dir (sandbox/state/_pool-<MEMORY_POOL>), fresh per trial.
'use strict'
const { execFileSync, spawn } = require('child_process')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node composter-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Compo'
const OUTDIR = `${R}/sandbox/log/composter-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-craftab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const STAND = { x: 700.5, y: 120, z: 700.5 }
const HOME = { x: 700, y: 120, z: 700 }
const CHEST = '690 120 690'
const SITE = '697 120 699'          // canonicalComposterSite for this arena (computed with composter.mjs, checked in the read)
const SITE_STAND = '698 120 699'    // standableBeside(SITE)
const ROCKS = ['andesite', 'diorite', 'granite', 'calcite']
const logs = used => ({ slots: [['oak_log', 3]], fill: used, fillers: ROCKS })
const COMPOST_BAG = [['leaf_litter', 64], ['leaf_litter', 64], ['leaf_litter', 30], ['wheat_seeds', 64], ['wheat_seeds', 6], ['beetroot_seeds', 5],
  ['oak_sapling', 64], ['oak_sapling', 20], ['birch_sapling', 10], ['apple', 12], ['bread', 8], ['cooked_beef', 4], ['poppy', 3]]
const SPEC = {
  // 1. build from logs (3 oak_log + rock stacks): 30/36 and 34/36 -- the chain from logs needs 2 free slots
  'build30': { ...logs(30), watch: 'build_composter' },
  'build34': { ...logs(34), watch: 'build_composter' },
  // 2. too full to start: 35/36 and 36/36
  'build35': { ...logs(35), watch: 'build_composter' },
  'build36': { ...logs(36), watch: 'build_composter' },
  // 2c. the refusal path the scheduler never reaches: a 34/36 build, and the moment the order starts two stacks of tuff
  //     arrive (`give`, which only fills empty slots) -- the bag fills mid-chain, as an auto-pickup would
  'build34-fillmid': { ...logs(34), watch: 'build_composter', fillOnStart: ['tuff', 128] },
  // 3. compost at an existing composter (level 0 at the canonical site), 36/36 of litter/seeds/saplings/food + rocks
  'compost36': { slots: COMPOST_BAG, fill: 36, fillers: ROCKS, composter: true, watch: 'compost' },
  // 3b. the same with the FLEET's stuck watchdog (deploy-harness.sh / bootstrap-mcbots.sh: STUCK_SECONDS=20; the sandbox
  //     env file says 35): a compost visit stands still for up to VISIT_BUDGET_MS (45 s)
  'compost36-stuck20': { slots: COMPOST_BAG, fill: 36, fillers: ROCKS, composter: true, watch: 'compost', env: { STUCK_SECONDS: 20 } },
  // 4. the standing cell occupied: an oak boat on it under a ceiling block at y+2 -- no bot fits in that cell, while the
  //    block reads standableBeside() does (feet, head, floor) are unchanged, so the stand stays the chosen cell
  'stand-blocked': { ...logs(30), watch: 'build_composter', blockStand: true },
}
const WINDOW_MS = 100000   // first town scan can wait TOWN_SCAN_MS (30 s) behind a scan made before the chest existed

function arenaCmds (spec) {
  const c = ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 690 120 690 710 130 710 minecraft:air', 'fill 690 119 690 710 119 710 minecraft:stone', `setblock ${CHEST} minecraft:chest`]
  if (spec.composter) c.push(`setblock ${SITE} minecraft:composter[level=0]`)
  if (spec.blockStand) c.push('setblock 698 122 699 minecraft:stone')
  return c
}
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  let s = 0
  for (const [id, n, dmg] of spec.slots || []) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''} ${n}`)
  while (s < (spec.fill || 0) && s < 36) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${spec.fillers[s % spec.fillers.length]} 64`)
  if (spec.blockStand) c.push(`summon minecraft:oak_boat 698.5 120 699.5`)
  return c
}

// ---------------------------------------------------------------- oracle
const parseItem = seg => {
  const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]
  if (!id) return null
  const count = +((seg.match(/count: (\d+)/) || [])[1] || 1)
  const dm = seg.match(/"minecraft:damage": (\d+)/)
  return { id, count, ...(dm ? { damage: +dm[1] } : {}) }
}
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..20] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  for (let l = 0; l <= 8; l++) cmds.push(`execute if block ${SITE} minecraft:composter[level=${l}]`)
  cmds.push(`execute if entity @e[type=oak_boat,x=698.5,y=120,z=699.5,distance=..1]`)
  const r = rcon(...cmds)
  const slots = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const ground = (r[36]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const pos = (((r[37]?.reply || '').match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '')
  let level = null
  for (let l = 0; l <= 8; l++) if (/Test passed/.test(r[38 + l]?.reply || '')) level = l
  return { slots, used: Object.keys(slots).length, ground, pos, siteComposterLevel: level, boat: /Test passed/.test(r[47]?.reply || '') }
}
const totals = snap => { const t = {}; for (const it of Object.values(snap.slots)) t[it.id] = (t[it.id] || 0) + it.count; return t }
// blocks the build may have put down anywhere in the arena, counted (and removed) at the end of the trial
function worldCount () {
  const r = rcon('fill 690 119 690 710 130 710 minecraft:air replace minecraft:composter', 'fill 690 119 690 710 130 710 minecraft:air replace minecraft:crafting_table')
  const n = x => +(((x?.reply || '').match(/filled (\d+)/) || [])[1] || 0)
  return { composters: n(r[0]), tables: n(r[1]) }
}
function where (block) {   // where in the arena a block of this kind stands (the table cell, a composter off-site)
  const cells = []
  for (const c of ['699 120 699', '697 120 699', '698 120 699', '699 120 698', '699 120 700', '700 120 699', '696 120 699', '697 120 700', '697 120 698']) cells.push(c)
  const r = rcon(...cells.map(c => `execute if block ${c} minecraft:${block}`))
  return cells.filter((c, i) => /Test passed/.test(r[i]?.reply || ''))
}

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const NOISE = /^(_affordance_scan)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && !NOISE.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, trigger: r.trigger, ms: r.skill.duration_ms, fail: r.skill.fail_class,
      args: r.skill.name === '_craft_sync' ? { item: r.skill.args?.item, outcome: r.skill.args?.outcome, clicks: r.skill.args?.clicks } : undefined,
      detail: String(r.skill.detail || '').slice(0, 700) }))
}
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

let bot = null, brain = null
async function stopBot () {
  try { bot && bot.kill('SIGTERM') } catch {}
  try { brain && brain.kill('SIGTERM') } catch {}
  bot = null; brain = null
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/composter-ab/${tag}`
  const skillLog = `${R}/sandbox/log/composter-ab/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const queue = `${OUTDIR}/queue-${tag}.txt`; fs.writeFileSync(queue, '')
  const envRel = `sandbox/.env.coab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/composter-ab-${tag}`); set('MEMORY_POOL', `sbxcoab-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  for (const [key, v] of Object.entries(spec.env || {})) set(key, v)
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brain = spawn('node', [path.join(D, 'qbrain.mjs'), String(BRAIN_PORT)], { env: { ...process.env, QUEUE_FILE: queue }, stdio: ['ignore', fs.openSync(`${OUTDIR}/brain-${tag}.log`, 'a'), 'inherit'] })
  await sleep(800)
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  // THE ARENA IS BUILT ONLY ONCE THE BOT IS THERE: setblock/fill into an unloaded chunk fails ("not loaded") -- the first
  // pilot built its chest into nothing, and no town order could ever fire.
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`)
  await sleep(3000)
  const built = rcon(...arenaCmds(spec))
  const notLoaded = built.filter(x => /not loaded|Cannot place/i.test(x.reply))
  if (notLoaded.length) throw new Error('arena not built: ' + notLoaded.map(x => x.cmd + ' => ' + x.reply).join('; '))
  rcon(...bagCmds(spec))
  await sleep(2500)
  const before = snapshot()
  const t0 = Date.now()
  const startPat = new RegExp(`${spec.watch}`)
  const endPat = new RegExp(`skill ${spec.watch} ->`)
  // the window: an order of the watched kind, then its end; or nothing at all in WINDOW_MS
  const started = await waitFor(() => skillRows(skillLog).some(r => r.name === spec.watch) || lines(botOut).some(l => startPat.test(l)), WINDOW_MS)
  if (started && spec.fillOnStart) { const t = Date.now(); const g = rcon(`give ${NAME} minecraft:${spec.fillOnStart[0]} ${spec.fillOnStart[1]}`); spec._fill = { atMs: t - t0, reply: g[0]?.reply } }
  let ended = null
  if (started) ended = await waitFor(() => lines(botOut).some(l => endPat.test(l)), 200000)
  await sleep(4000)
  const after = snapshot()
  const tableAt = where('crafting_table'); const composterAt = where('composter')
  const rows = skillRows(skillLog)
  await stopBot()
  const world = worldCount()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0)
  const watched = rows.filter(r => r.name === spec.watch).pop() || null
  const firstTablePlace = null
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    watched, started: !!started, fill: spec._fill || null, ended: !!ended, windowMs: Date.now() - t0,
    before: { used: before.used, totals: totals(before), slots: before.slots, ground: before.ground, pos: before.pos, level: before.siteComposterLevel, boat: before.boat },
    after: { used: after.used, totals: totals(after), slots: after.slots, ground: after.ground, pos: after.pos, level: after.siteComposterLevel, boat: after.boat, tableAt, composterAt, ...world },
    rows, lines: lines(botOut).filter(l => /build_composter|compost|decision rejected|town|order/i.test(l)).map(l => l.slice(0, 400)).slice(-40),
    trace: { clicks: tr.filter(e => e.pkt === 'click').length, pickups: tr.filter(e => e.pkt === 'collect' && e.self).length, spawns: tr.filter(e => e.pkt === 'spawn_item').length } }
  void firstTablePlace
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const tb = totals(before); const ta = totals(after)
  const delta = Object.keys({ ...tb, ...ta }).map(n => [n, (ta[n] || 0) - (tb[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
  console.log(`${r.id.padEnd(24)} ${String(watched?.status || 'no-order').padEnd(9)} ${watched?.ms ?? '-'}ms slots ${before.used}->${after.used} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] composters=${world.composters}@${composterAt.join('|')} tables=${world.tables}@${tableAt.join('|')} level ${before.siteComposterLevel}->${after.siteComposterLevel} d{${delta}} | ${(watched?.detail || '').slice(0, 200)}`)
}

async function main () {
  for (const t = Date.now(); ;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - t > 3600000) throw new Error('sandbox not empty')
    console.log('waiting:', pl.trim()); await sleep(20000)
  }
  console.log(`arm=${ARM} root=${BOT_ROOT} server=${SERVER}`)
  for (let k = 0; k < REPS; k++) for (const scene of SCENES) await runTrial(scene, k)
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { fs.unlinkSync(`${R}/sandbox/.env.coab-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 690 119 690 710 130 710 minecraft:air', 'fill 690 119 690 710 119 710 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
