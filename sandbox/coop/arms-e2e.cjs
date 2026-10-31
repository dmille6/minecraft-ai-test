// SANDBOX-ONLY: THE B5 PAPER ARMS (cooperation tier docs/reports/cooperation-tier-2026-10-23.md s.6.2). Does assigning the
// town's BUILD job have headroom over today's rotation, and does a frontier model assign at least as well as greedy?
//
//   node sandbox/coop/arms-e2e.cjs <botRoot> <arm> <pairSeed> [server]
//   arms: rotation | random | greedy | oracle | starved | frontier:<model>   (model = claude-sonnet-5-5 | claude-haiku-5-5 | gpt-6.1-sol)
//
// THE SCENE (one run = one arm, ARMS_WINDOW_MIN minutes, default 60): a flat town at home (760,120,760), FIVE REAL BOTS
// (index.mjs from <botRoot>, ROLES=on) named sandbox-Coop1..5, town chests holding the workshop's and the house's whole bill
// plus raw copper and coal (so the town smelt job and the furnace drain compete with building for each visit, as on the
// fleet: 6 h fleet read 10-31, 80 bots: build_shop 590 runs / 7.6 bot-h vs smelt_town 209 / 2.6, furnace_drain 619 / 1.9,
// make_material 473 / 1.5), one town furnace, a scripted brain per bot that only idles (status, or a short walk where the bot is: no model choice).
// THE BOTS COME AND GO: each bot follows an arrival schedule drawn from the measured process (r3: 9.3% of time inside town,
// stays median 1 min, p90 3 min), heterogeneous across bots (at-town shares 20/12/8/5/3%, nominal distances 60..300); the
// schedule is a function of <pairSeed> only, so every arm of a pair sees the same arrivals. "Away" = teleported to a field
// spot 70 blocks out (outside TOWN_RADIUS 48: no town job runs there); "arrival" = teleported to the town stand. A bot is
// never moved mid-skill: a stay that ends while a skill runs ends when that skill ends (capped at STAY_OVERRUN_MS).
// THE ARMS write roles-760_120_760.json in the pool (bots/src/roles.mjs reads it) every ARMS_TICK_MS (5 min), through
// scripts/overseer/assign.mjs's validator: rotation and starved write nothing; greedy, random and oracle every tick; the
// frontier on its token bucket (scripts/overseer/caller.py, the spend guard, purpose `paper`), its accepted leases
// re-validated every tick with their original expiry. starved = rotation with SHOP=off for the first 30 min (the instrument's
// positive control: it must lower cells per hour).
// THE MEASURE: `_build op=place` rows per hour over the window (every bot), the cells still standing at the end (RCON:
// `execute unless block <cell> air` for every placed cell), the time of each `_structure_complete`, and the lease ledger
// (issued / honoured / released). Results append to sandbox/log/arms-e2e/results.jsonl.
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. sandbox5..8 only. Refuses to run unless a
// sandbox lock covering SERVER has `coop` as its owner's first word. The Mac mini runs it (one run at a time: 5 bots).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const sbx = require('../lib/sbxlock.cjs')
const [BOT_ROOT, ARM, SEED_S, SERVER = 'sandbox5'] = process.argv.slice(2)
const MAIN = require.main === module
if (MAIN && (!BOT_ROOT || !ARM || !SEED_S)) throw new Error('usage: node arms-e2e.cjs <botRoot> <arm> <pairSeed> [server]')
const SEED = Number(SEED_S)
const ARMS = ['rotation', 'random', 'greedy', 'oracle', 'starved']
const FRONTIER = /^frontier:(claude-sonnet-5-5|claude-haiku-5-5|claude-opus-5-5|gpt-6\.1-sol)$/.exec(ARM ?? '')?.[1] ?? null
if (MAIN && !ARMS.includes(ARM) && !FRONTIER) throw new Error(`unknown arm ${ARM}`)
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => /^sandbox[5-8]$/.test(n)))
if (MAIN && !PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const OUTDIR = `${R}/sandbox/log/arms-e2e`
const RES = `${OUTDIR}/results.jsonl`
const WINDOW_MS = Number(process.env.ARMS_WINDOW_MIN || 60) * 60000
const TICK_MS = Number(process.env.ARMS_TICK_MS || 5 * 60000)
const STARVE_MS = 30 * 60000
const STAY_OVERRUN_MS = 8 * 60000
const PY = process.env.OVERSEER_PY || `${process.env.HOME}/learnloop/venv/bin/python`
const BRAIN_PORT = 11800 + 10 * Number(String(SERVER).replace('sandbox', '') || 0)   // + bot index
const sleep = ms => new Promise(r => setTimeout(r, ms))
const N = 5
const NAMES = Array.from({ length: N }, (_, i) => `sandbox-Coop${i + 1}`)
const SHARE = [0.20, 0.12, 0.08, 0.05, 0.03]           // at-town share per bot (mean 9.6%; the fleet's 9.3%)
const DIST = [60, 120, 180, 240, 300]                 // nominal distance when away (the snapshot's `dist`)

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-coop-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const rconMany = (cmds, per = 40) => { const out = []; for (let i = 0; i < cmds.length; i += per) out.push(...rcon(...cmds.slice(i, i + per))); return out }

// ---------------------------------------------------------------- the schedule (a function of the pair seed only)
function mulberry (seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const STAY_MU = Math.log(60000), STAY_SIGMA = Math.log(3) / 1.2816   // median 60 s, p90 180 s
const STAY_MEAN = Math.exp(STAY_MU + STAY_SIGMA ** 2 / 2)
/** -> per bot [{ at, stay }] arrivals over the window, relative to t0. Exponential away times; the first arrival is a residual. */
function schedule (seed, windowMs) {
  return NAMES.map((nm, i) => {
    const rnd = mulberry(seed * 1009 + i * 7919 + 17)
    const normal = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
    const awayMean = STAY_MEAN * (1 - SHARE[i]) / SHARE[i]
    const out = []
    let t = -Math.log(1 - rnd()) * awayMean
    while (t < windowMs) {
      const stay = Math.min(10 * 60000, Math.exp(STAY_MU + STAY_SIGMA * normal()))
      out.push({ at: Math.round(t), stay: Math.round(stay) })
      t += stay + -Math.log(1 - rnd()) * awayMean
    }
    return out
  })
}
const ARRIVALS_PER_H = SHARE.map(f => +(3600000 * f / STAY_MEAN).toFixed(2))

// ---------------------------------------------------------------- arena and scene
const HOME = { x: 760, y: 120, z: 760 }
const HK = `${HOME.x}_${HOME.y}_${HOME.z}`
// the arena: x A0..AX1 (the town and, east of it, the field), z A0..A1, flat stone at FLOOR, air above to TOP
const A0 = 704, A1 = 816, AX1 = 852, FLOOR = 119, TOP = 140
// each bot's away spot: 75+ blocks east of home (outside TOWN_RADIUS 48), a pair of points 8 apart it walks between (the
// stagnation watchdog relocates a bot that moves < 8 blocks in 180 s: an idle bot would walk off on its own)
const FIELD = NAMES.map((_, i) => ({ x: 836.5, y: 120, z: 744 + 8 * i + 0.5 }))
const FIELD2 = FIELD.map(p => ({ x: p.x + 8, y: p.y, z: p.z }))
const WANDER = [{ x: 756, y: 120, z: 756 }, { x: 764, y: 120, z: 756 }]
const CHESTS = [{ x: 763, y: 120, z: 757 }, { x: 762, y: 120, z: 760 }, { x: 763, y: 120, z: 763 }]
const FURNACE_AT = { x: 760, y: 120, z: 764 }
const STAND = { x: 760.5, y: 120, z: 760.5 }
const at = c => `${c.x} ${c.y} ${c.z}`
const stacks = (id, n) => { const o = []; while (n > 0) { o.push([id, Math.min(64, n)]); n -= 64 } return o }
const BAG = [['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['bread', 5]]
// the workshop's bill (89 stone bricks, 49 planks, 4 panes, 20 cut copper, 2 torches, 2 furnaces, 1 table) and the house's, with
// room to spare; raw copper + coal for the smelt job
const CHEST_ITEMS = [
  [...stacks('stone_bricks', 384), ...stacks('oak_planks', 640), ...stacks('cobblestone', 512)],
  [...stacks('glass_pane', 128), ...stacks('cut_copper', 128), ...stacks('torch', 128), ['furnace', 6], ['crafting_table', 3], ...stacks('oak_log', 256)],
  [...stacks('raw_copper', 256), ...stacks('coal', 128)],
]
function arenaCmds () {
  const c = [`forceload add ${A0} ${A0} ${AX1} ${A1}`, `kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..100]`]
  // one layer per fill (a 149 x 113 layer is 16.8k blocks: under the 32768 limit)
  for (const y of [FLOOR - 2, FLOOR - 1, FLOOR]) c.push(`fill ${A0} ${y} ${A0} ${AX1} ${y} ${A1} minecraft:stone`)
  for (let y = FLOOR + 1; y <= TOP; y++) c.push(`fill ${A0} ${y} ${A0} ${AX1} ${y} ${A1} minecraft:air`)
  c.push(`kill @e[type=item,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..100]`)
  return c
}
const sceneCmds = () => [
  `setblock ${at(FURNACE_AT)} minecraft:furnace[facing=north]`,
  ...CHESTS.map(p => `setblock ${at(p)} minecraft:chest[facing=west]`),
  ...CHESTS.flatMap((p, k) => CHEST_ITEMS[k].map(([id, n], s) => `item replace block ${at(p)} container.${s} with minecraft:${id} ${n}`)),
]
const bagCmds = nm => [`clear ${nm}`, ...BAG.map(([id, n], s) => `item replace entity ${nm} container.${s} with minecraft:${id} ${n}`)]
const tpCmd = (nm, p) => `tp ${nm} ${p.x} ${p.y} ${p.z}`

// ---------------------------------------------------------------- the bots
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
async function waitFor (pred, ms, step = 1000) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }
// THE BRAINS: one loopback endpoint per bot (BRAIN_PORT + i), so the answer can follow where the driver has put that bot. Away:
// walk between the bot's two field points (never toward town). At town: `status`, or a short walk between two points by
// the stand (shop-e2e's idle). The town-job chain runs BEFORE the model on every decision, so the brain never displaces a job.
const WHERE = NAMES.map(() => 'away')
let brainN = 0
const brains = NAMES.map((nm, i) => http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    const k = brainN++
    if (k % 2) {
      const c = WHERE[i] === 'away' ? [FIELD, FIELD2][(k >> 1) % 2][i] : WANDER[(k >> 1) % 2]
      decision = { skill: 'goto', args: { x: Math.floor(c.x), y: c.y, z: Math.floor(c.z) } }
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
}))
const kids = new Map()
async function stopBots (names = NAMES, signal = 'SIGTERM') {
  for (const nm of names) { const b = kids.get(nm); if (b) { try { b.kill(signal) } catch {} kids.delete(nm) } }
  await waitFor(() => { const l = rcon('list')[0].reply; return names.every(nm => !new RegExp(`\\b${nm}\\b`).test(l)) }, 30000, 1000)
}
function startBot (p) {
  const bo = fs.openSync(p.botOut, 'a')
  const seen = lines(p.botOut).filter(l => /spawned pos=/.test(l)).length
  const b = spawn('bash', [`${R}/sandbox/run-bot.sh`, p.envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  kids.set(p.nm, b)
  let err = null
  b.on('error', e => { err = e })
  return waitFor(() => err || lines(p.botOut).filter(l => /spawned pos=/.test(l)).length > seen, 90000, 300).then(v => { if (!v || err) throw new Error(`${p.nm}: no spawn${err ? `: ${err.message}` : ''}`) })
}
/** Is the bot inside a skill now? (its last `LLM -> X` has no `skill X ->` after it) */
function midSkill (botOut) {
  const ls = lines(botOut).slice(-60)
  for (let i = ls.length - 1; i >= 0; i--) {
    if (/ skill [a-z_]+ -> /.test(ls[i])) return false
    if (/ LLM -> [a-z_]+ /.test(ls[i])) return true
  }
  return false
}
function lastSkills (botOut, n = 3) {
  const out = []
  for (const l of lines(botOut).slice(-200).reverse()) { const m = / skill ([a-z_]+) -> ([a-z_]+)/.exec(l); if (m && m[1] !== 'status') out.push([m[1], m[2]]); if (out.length >= n) break }
  return out
}

// ---------------------------------------------------------------- the host side (the assigner, on the bots' own modules)
let S = null, SHOP = null, A = null, BP = null
async function loadHost (envText, poolDir) {
  for (const line of envText.split('\n')) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
  process.env.POOL_STATE_DIR = poolDir
  process.env.BOT_NAME = 'sandbox-CoopHost'
  process.env.LOG_DIR = `${OUTDIR}/host-logs`; process.env.STATE_DIR = `${OUTDIR}/host-state`
  process.env.LOG_LEVEL = 'error'
  fs.mkdirSync(process.env.LOG_DIR, { recursive: true })
  SHOP = await import(path.join(BOT_ROOT, 'bots/src/shop.mjs'))
  S = await import(path.join(BOT_ROOT, 'bots/src/skills.mjs'))
  BP = await import(path.join(BOT_ROOT, 'bots/src/buildproj.mjs'))
  A = await import(path.join(R, 'scripts/overseer/assign.mjs'))
}
function projectNow () {
  let plot = null; try { plot = S.shopActive().plot } catch {}
  const h = S.shopRecordHead()
  const rec = h.ok ? (h.head?.rec ?? null) : null
  // the plan is bound to the world the bots joined (bot.worldId from the login packet): read it from the plan files themselves
  let planned = false
  try {
    const dir = process.env.POOL_STATE_DIR
    const w = fs.readdirSync(dir).filter(n => /^townplan-.*\.g\d+\.json$/.test(n)).map(n => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')).world } catch { return null } }).find(Boolean) ?? null
    planned = !!(w && S.townPlanHead({ worldId: w })?.head)
  } catch {}
  return { plot, record_gen: h.head?.gen ?? null, record: rec, complete: !!rec?.structure_complete, planned,
    slots_free: (() => { try { return S.shopSlotsFree(null) } catch { return false } })(),
    slots_free_for: Object.fromEntries(NAMES.map(nm => [nm, (() => { try { return S.shopSlotsFree({ username: nm }) } catch { return false } })()])) }
}
function freeSlots () {
  const cmds = NAMES.flatMap(nm => Array.from({ length: 36 }, (_, s) => `data get entity ${nm} Inventory[{Slot:${s}b}]`))
  const r = rconMany(cmds, 60)
  return Object.fromEntries(NAMES.map((nm, i) => [nm, r.slice(i * 36, i * 36 + 36).filter(q => !/has the following entity data/.test(q?.reply || '')).length]))
}

// ---------------------------------------------------------------- one run
async function run () {
  const tag = `${ARM.replace(':', '-')}-p${SEED}-${SERVER}-${new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)}`
  const logRel = `./sandbox/log/arms-e2e/${tag}`
  const pool = `sbxcoop-${tag}`.slice(0, 80)
  const poolDir = `${R}/sandbox/state/_pool-${pool}`
  fs.mkdirSync(`${R}/${logRel.slice(2)}`, { recursive: true }); fs.mkdirSync(poolDir, { recursive: true })
  const armLog = `${R}/${logRel.slice(2)}/arm.jsonl`
  const note = row => fs.appendFileSync(armLog, JSON.stringify({ t: Date.now(), ...row }) + '\n')
  const base = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const envOf = (nm, i, shopOn = true) => {
    let env = base
    const set = (k, v) => { env = new RegExp(`^${k}=`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `\n${k}=${v}` }
    set('BOT_NAME', nm); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/coop-${tag}-${i}`); set('MEMORY_POOL', pool)
    set('MEMORY_SCOPE', 'shared'); set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0); set('PLINTH_FIRST', 0)
    set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT + i}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT + i}`); set('MAX_CONSECUTIVE_FAILURES', 50)
    set('FOUND', 'off'); set('SHAFT', 'off'); set('MONUMENT', 'off'); set('PATHS', process.env.ARMS_PATHS === 'off' ? 'off' : 'on'); set('TOWNWALL', 'off'); set('TREEFARM', 'off')
    set('ROLES', 'on'); set('SHOP', shopOn ? 'on' : 'off'); set('LLM_DECISION_COOLDOWN_MS', 8000)
    for (const ax of ['X', 'Y', 'Z']) { set(`HOME_${ax}`, HOME[ax.toLowerCase()]); set(`BOARD_${ax}`, HOME[ax.toLowerCase()]) }
    return env + '\n'
  }
  const per = NAMES.map((nm, i) => ({ nm, i, envRel: `sandbox/.env.coop-${SERVER}-${process.pid}-${i}`, botOut: `${R}/${logRel.slice(2)}/bot-${nm}.out`, skill: `${R}/${logRel.slice(2)}/skill-${nm}.jsonl` }))
  const writeEnv = (shopOn) => per.forEach(p => fs.writeFileSync(`${R}/${p.envRel}`, envOf(p.nm, p.i, shopOn)))
  await loadHost(envOf('sandbox-CoopHost', 9), poolDir)
  const starved = ARM === 'starved'
  writeEnv(!starved)
  for (const p of per) await startBot(p)
  rcon('difficulty peaceful')
  for (const nm of NAMES) rcon(`gamemode survival ${nm}`, `effect clear ${nm}`)
  const built = [...rconMany(arenaCmds()), ...rconMany(sceneCmds(), 400), ...NAMES.flatMap(nm => rconMany([...bagCmds(nm), tpCmd(nm, FIELD[NAMES.indexOf(nm)])]))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected|Too many blocks/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (bad.length) throw new Error('arena not built: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  const sched = schedule(SEED, WINDOW_MS)
  note({ kind: 'start', arm: ARM, seed: SEED, sched: sched.map(s => s.map(v => [v.at, v.stay])), arrivals_per_h: ARRIVALS_PER_H })
  const t0 = Date.now()
  // per-bot state: 'away' | 'town'; the stay ends at `until`
  const st = NAMES.map(() => ({ where: 'away', next: 0, until: 0, lastLeft: null, arrived: [] }))
  let gen = 0, fileGen = 0, accepted = [], bucket = undefined, emptySince = -Infinity, lastRelease = 0, calls = []
  let restarted = !starved
  const placeRows = () => per.flatMap(p => jl(p.skill).filter(r => r.skill?.name === '_build' && /(?:^| )op=place(?: |$)/.test(r.skill.detail || '') && Date.parse(r['@timestamp']) >= t0))
  const roleRows = kind => per.flatMap(p => jl(p.skill).filter(r => r.skill?.name === `_${kind}` && Date.parse(r['@timestamp']) >= t0))
  const writeFile = (leases, prior) => {
    fileGen++
    const proj = projectNow()
    const doc = A.rolesDoc({ leases, gen: fileGen, now: Date.now(), world: pool, home: HK, arm: ARM, project: { plot: proj.plot, record_gen: proj.record_gen }, snapshotGen: gen, prior })
    A.writeRoles(poolDir, HK, doc)
    return doc
  }
  const snapshotNow = (now, fs_) => {
    const proj = projectNow()
    const refused = {}
    for (const r of roleRows('role_released')) { const nm = r.bot?.name; if (nm) refused[nm] = { BUILD: Math.max(refused[nm]?.BUILD ?? 0, Date.parse(r['@timestamp'])) } }
    const roster = NAMES.map((nm, i) => ({ bot: nm, at_town: st[i].where === 'town', dist: st[i].where === 'town' ? 0 : DIST[i], dy: 0, hp: 20,
      free_slots: fs_[nm], flags: [], seen_at: now, arrivals_per_h: ARRIVALS_PER_H[i], stays_min: 1.0,
      last_seen_town_min: st[i].where === 'town' ? 0 : (st[i].lastLeft == null ? null : Math.round((now - st[i].lastLeft) / 60000)),
      doing: lastSkills(per[i].botOut), affinity: { BUILD: placeRows().filter(r => r.bot?.name === nm).length > 0 ? 1 : 0 } }))
    gen++
    const snap = { v: 1, town: 'sbx', gen, t_min: Math.round((now - t0) / 60000), project: { plot: proj.plot, state: proj.complete ? 'complete' : proj.record ? 'building' : 'unsited',
      record_gen: proj.record_gen, cells: { placed_in_run: placeRows().length, total: proj.record?.cells?.length ?? null }, slots: { free: proj.slots_free } },
      caps: { BUILD: 2, leased_max: 3 }, roster, refused, last_gen: { gen: gen - 1, leases: accepted.map(l => ({ bot: l.bot, job: l.job, expires_in_min: Math.round((l.expires_at - now) / 60000) })),
        released_since: roleRows('role_released').filter(r => Date.parse(r['@timestamp']) >= now - TICK_MS).map(r => r.bot?.name), honoured_since: roleRows('role_honoured').filter(r => Date.parse(r['@timestamp']) >= now - TICK_MS).map(r => r.bot?.name) } }
    const eligible = A.eligibleOf({ roster, project: proj, refused }, { buildOrder: SHOP.buildOrder, now })
    for (const b of snap.roster) b.eligible = eligible[b.bot]
    return { snap, eligible, proj }
  }
  async function frontierCall (snap) {
    const f = `${R}/${logRel.slice(2)}/snap-g${snap.gen}.json`, o = `${R}/${logRel.slice(2)}/reply-g${snap.gen}.json`
    const model = snap.roster ? FRONTIER : null
    // the model sees `refused` only through `eligible` and last_gen (the validator's filter)
    const shown = { ...snap }; delete shown.refused
    for (const b of shown.roster) { delete b.seen_at; delete b.flags }
    fs.writeFileSync(f, JSON.stringify(shown))
    const code = await new Promise(resolve => {
      const c = spawn(PY, [`${R}/scripts/overseer/caller.py`, 'call', '--model', model, '--snapshot', f, '--out', o, '--purpose', 'paper', '--run', tag, '--wait-lock', '120'], { stdio: ['ignore', 'ignore', 'pipe'] })
      const kill = setTimeout(() => { try { c.kill('SIGKILL') } catch {} }, 180000)
      c.on('exit', x => { clearTimeout(kill); resolve(x) })
    })
    let out = null; try { out = JSON.parse(fs.readFileSync(o, 'utf8')) } catch {}
    return { code, reply: out?.reply ?? null, meta: out?.meta ?? null }
  }
  async function tick (now) {
    const fs_ = freeSlots()
    const { snap, eligible } = snapshotNow(now, fs_)
    const caps = snap.caps
    let reply = null, meta = null, v = null
    if (ARM === 'rotation' || ARM === 'starved') { note({ kind: 'tick', gen, eligible, leases: [] }); return }
    if (ARM === 'greedy') reply = A.greedyReply(snap, eligible, caps)
    else if (ARM === 'random') reply = A.randomReply(snap, eligible, caps, A.rng(SEED * 31 + gen))
    else if (ARM === 'oracle') {
      const eta = {}
      NAMES.forEach((nm, i) => { const nx = sched[i].find(a => t0 + a.at > now); eta[nm] = nx ? t0 + nx.at - now : Infinity })
      reply = A.oracleReply(snap, eligible, caps, eta)
    } else {
      const released = snap.last_gen.released_since.length > 0 && now - lastRelease > 0
      // nothing to decide (no bot eligible for any job): no call is due -- the token is kept (s.3.2: not a failure)
      const anyEligible = Object.values(eligible).some(e => e.length)
      const b = !anyEligible ? { bucket, call: false } : A.bucketStep(bucket, { now, event: released || snap.project.slots.free === true && accepted.length === 0, day: new Date(now).toISOString().slice(0, 10) })
      bucket = b.bucket
      if (b.call) {
        const r = await frontierCall(snap)
        meta = r.meta; calls.push({ gen, code: r.code, outcome: meta?.outcome, usd: meta?.usd ?? null, usd_worst: meta?.usd_worst ?? null, latency_s: meta?.latency_s ?? null })
        // the reply is validated on the NEWEST facts (the call took time): a fresh eligibility, the gen rule
        const fresh = snapshotNow(Date.now(), fs_)
        v = r.reply ? A.validate(r.reply, { snapshot: fresh.snap, eligible: fresh.eligible, caps, nowGen: gen, emptySince }) : { leases: [], dropped: [], abstain: false, invalid: `no_reply:${meta?.outcome ?? r.code}` }
        if (v.invalid) { accepted = []; emptySince = gen; writeFile([], {}); note({ kind: 'call', gen, meta, invalid: v.invalid, empty: true }); return }
        if (!v.abstain) accepted = v.leases.map(l => ({ ...l, expires_at: Date.now() + l.ttl_min * 60000 }))
        note({ kind: 'call', gen, meta, reply: r.reply, kept: v.leases, dropped: v.dropped, abstain: v.abstain })
      }
      if (snap.last_gen.released_since.length) lastRelease = now
      accepted = A.revalidate(accepted, { eligible, now })
      const doc = writeFile(accepted.map(l => ({ ...l, ttl_min: Math.max(1, Math.round((l.expires_at - now) / 60000)) })), Object.fromEntries(accepted.map(l => [l.bot, l.expires_at])))
      note({ kind: 'tick', gen, eligible, leases: doc.leases.map(l => l.bot) })
      return
    }
    v = A.validate(reply, { snapshot: snap, eligible, caps, nowGen: gen })
    accepted = v.leases.map(l => ({ ...l, expires_at: now + l.ttl_min * 60000 }))
    const doc = writeFile(v.leases, {})
    note({ kind: 'tick', gen, eligible, leases: doc.leases.map(l => l.bot), dropped: v.dropped })
  }
  // ---- the clock
  let nextTick = t0
  while (Date.now() - t0 < WINDOW_MS) {
    const now = Date.now(), rel = now - t0
    if (!restarted && rel >= STARVE_MS) {           // starved: the first 30 min with SHOP=off, then today's code
      await stopBots(); writeEnv(true)
      for (const p of per) await startBot(p)
      for (const [i, nm] of NAMES.entries()) rcon(`gamemode survival ${nm}`, tpCmd(nm, st[i].where === 'town' ? STAND : FIELD[i]))
      restarted = true; note({ kind: 'unstarved' })
    }
    for (let i = 0; i < N; i++) {
      const s = st[i], a = sched[i][s.next]
      if (s.where === 'away' && a && rel >= a.at) {
        rcon(tpCmd(NAMES[i], { x: STAND.x + (i - 2), y: STAND.y, z: STAND.z }))
        s.where = 'town'; WHERE[i] = 'town'; s.until = t0 + a.at + a.stay; s.next++; s.arrived.push(rel); note({ kind: 'arrive', bot: NAMES[i], rel })
      } else if (s.where === 'town' && now >= s.until && (!midSkill(per[i].botOut) || now >= s.until + STAY_OVERRUN_MS)) {
        rcon(tpCmd(NAMES[i], FIELD[i]))
        s.where = 'away'; WHERE[i] = 'away'; s.lastLeft = now; note({ kind: 'leave', bot: NAMES[i], rel, overrun_ms: now - s.until })
        // an arrival that fell inside this overrun is skipped (the bot was still here)
        while (sched[i][s.next] && t0 + sched[i][s.next].at < now) s.next++
      }
    }
    if (now >= nextTick) { try { await tick(now) } catch (e) { note({ kind: 'tick_error', error: e.message }) } nextTick += TICK_MS }
    await sleep(1000)
  }
  // ---- the measure
  const places = placeRows()
  const cells = [...new Set(places.map(r => (/(?:^| )cell=(\S+)/.exec(r.skill.detail) || [])[1]).filter(Boolean))]
  const standing = cells.length ? rconMany(cells.map(c => `execute unless block ${c.split(',').join(' ')} minecraft:air`)).filter(q => /Test passed/.test(q.reply)).length : 0
  const completes = per.flatMap(p => jl(p.skill).filter(r => r.skill?.name === '_structure_complete' && Date.parse(r['@timestamp']) >= t0)).map(r => ({ rel_min: +((Date.parse(r['@timestamp']) - t0) / 60000).toFixed(1), detail: String(r.skill.detail || '').slice(0, 80) }))
  const byBot = {}; for (const r of places) byBot[r.bot?.name] = (byBot[r.bot?.name] || 0) + 1
  const visits = per.flatMap(p => jl(p.skill).filter(r => r.skill?.name === 'build_shop' && Date.parse(r['@timestamp']) >= t0)).length
  const comp = {}; for (const p of per) for (const r of jl(p.skill)) { const n = r.skill?.name; if (Date.parse(r['@timestamp']) >= t0 && ['smelt_town', 'furnace_drain', 'make_material', 'build_shop', 'town_deposit', 'toolkit'].includes(n)) comp[n] = (comp[n] || 0) + 1 }
  const deaths = per.flatMap(p => jl(p.skill).filter(r => r.skill?.name === '_death' && Date.parse(r['@timestamp']) >= t0)).length
  const out = { arm: ARM, seed: SEED, server: SERVER, tag, window_min: (Date.now() - t0) / 60000,
    sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    place_rows: places.length, cells_per_h: +(places.length / ((Date.now() - t0) / 3600000)).toFixed(1), distinct_cells: cells.length, standing,
    completes, places_by_bot: byBot, build_visits: visits, town_jobs: comp, arrivals: st.map(s => s.arrived.length),
    honoured: roleRows('role_honoured').length, released: roleRows('role_released').length, file_gens: fileGen, calls,
    usd: +calls.reduce((t, c) => t + (c.usd || 0), 0).toFixed(5), deaths }
  fs.mkdirSync(OUTDIR, { recursive: true })
  fs.appendFileSync(RES, JSON.stringify(out) + '\n')
  console.log(JSON.stringify(out))
  return out
}

let owned = false
async function cleanup () {
  if (owned) await stopBots().catch(() => {})
  for (const b of brains) { try { b.close() } catch {} }
  for (let i = 0; i < N; i++) { try { fs.unlinkSync(`${R}/sandbox/.env.coop-${SERVER}-${process.pid}-${i}`) } catch {} }
  if (owned) { try { rconMany([`kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..100]`, ...arenaCmds().slice(2, -1), `forceload remove ${A0} ${A0} ${AX1} ${A1}`]) } catch {} }
}
async function main () {
  sbx.requireSandboxLock(SERVER, 'coop')
  const pl = rcon('list')[0].reply; if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  fs.mkdirSync(OUTDIR, { recursive: true })
  owned = true
  for (const [i, b] of brains.entries()) await new Promise((resolve, reject) => { b.once('error', reject); b.listen(BRAIN_PORT + i, '127.0.0.1', resolve) })
  await run()
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
if (require.main === module) {
  main().then(() => finish(0), e => { console.error('FATAL', e.stack || e.message); finish(1) })
  process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1)); process.on('SIGHUP', () => finish(1))
}
module.exports = { schedule, ARRIVALS_PER_H, SHARE, STAY_MEAN, midSkill }
