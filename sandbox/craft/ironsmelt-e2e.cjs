// SANDBOX-ONLY end-to-end proof of ironsmelt-01 (the town smelt job smelts RAW IRON first, and only the town's:
// docs/reports/ironsmelt-01-design-2026-10-23.md on branch ironsmelt-on-6e1afb5). smeltjob-e2e.cjs's harness: ONE FRESH BOT
// PER SCENE from <botRoot> (unmodified; trace.cjs only observes packets), the scene set by RCON once the bot is there, and the
// SERVER's truth before and after: every bag slot, both town chests, the furnace's three slots, the item entities on the
// ground. The bot's own claim is recorded, never trusted. Nothing is queued to the model (every model decision is `status` or
// a short walk): the job must be the bot's OWN order.
//
//   node ironsmelt-e2e.cjs <botRoot> <scene,...> [server]      (CRAFT_REPO=<a main checkout with sandbox/run-bot.sh>)
//
// THE BUILD decides the expectation: a <botRoot> whose smeltjob.mjs exports ironsmeltModeDetail is the CANDIDATE (verdict
// CANDIDATE_PASS / FAIL); any other is the BASE, run as the POSITIVE CONTROL (verdict BASE_SHAPE when the base does what the
// base does -- leaves the town's raw iron where it lies -- else BASE_UNEXPECTED).
//
// scenes (no copper anywhere unless named; LIGHT_BAG + the bag's OWN 3 raw_iron + 2 iron_ingot):
//   iron       chest A 12 raw_iron + 4 coal -> CANDIDATE: chest A raw_iron -8, iron_ingot +8, coal -1; the bag ends with its
//              own 3 raw_iron + 2 iron_ingot; furnace empty and cold; nothing on the ground; the row in=fe fed=8 fe=3/2>3/2
//              verdict=ok. BASE: the job finds no copper (town_has_none), chest A's 12 raw iron untouched.
//   scattered  chest A 5 raw_iron + 4 coal, chest B 4 raw_iron (the census: raw iron in 5-21 containers per town, a few each)
//              -> CANDIDATE: 8 taken across both chests, 8 ingots banked; the bag's own iron unchanged. BASE: untouched.
//   mixed      chest B (the NEARER) 8 raw_copper, chest A 8 raw_iron + 4 coal -> CANDIDATE: the first job smelts the IRON
//              (in=fe); chest B's copper untouched by it. BASE: the copper is smelted (its job), the iron untouched.
//
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. sandbox5..8 only, sandbox-* names only.
// Refuses to run unless a sandbox lock covering SERVER has `ironsmelt` as its owner's first word (sandbox/lib/sbxlock.cjs).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const sbx = require('../lib/sbxlock.cjs')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox5'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node ironsmelt-e2e.cjs <botRoot> <scenes> [server]')
// sandbox5..8 only (the registry's ports): sandbox..sandbox4 belong to other agents' drills and the model benchmark
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => /^sandbox[5-8]$/.test(n)))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const TRACE = path.join(R, 'sandbox/craft/trace.cjs')
const NAME = process.env.IS_BOT_NAME || 'sandbox-Iron'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/ironsmelt-e2e`
const RES = `${OUTDIR}/results.jsonl`
// one brain per server by default (Claude driver r1 P3-8): two concurrent drivers never share a port
const BRAIN_PORT = Number(process.env.IS_BRAIN_PORT || (11490 + Number(String(SERVER).replace('sandbox', ''))))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ENV_REL = `sandbox/.env.isab-${SERVER}-${process.pid}`
const CANDIDATE = (() => { try { return /export const ironsmeltModeDetail/.test(fs.readFileSync(path.join(BOT_ROOT, 'bots/src/smeltjob.mjs'), 'utf8')) } catch { return false } })()

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-isab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const HOME = { x: 760, y: 120, z: 760 }
const CHEST_A = { x: 763, y: 120, z: 757 }       // 4.2 from the stand
const CHEST_B = { x: 762, y: 120, z: 760 }       // 1.5 from the stand: the NEARER
const FURNACE = { x: 760, y: 120, z: 763 }
const STAND = { x: 760.5, y: 120, z: 760.5 }
const at = c => `${c.x} ${c.y} ${c.z}`
const wool = n => Array.from({ length: n }, (_, i) => ['white_wool', 1 + (i % 3)])
// no dirt, cobble, stone or planks: nothing a pit-first well build or a composter build could start with; an IRON pickaxe so the
// toolkit (which the town orders run before the job) has nothing to make (pickaxe, axe, shovel all carried), and the bag's OWN iron the job must not touch
const BAG = [['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['torch', 8], ['bread', 5], ['raw_iron', 3], ['iron_ingot', 2], ...wool(6)]
const SPEC = {
  iron: { chestA: [['raw_iron', 12], ['coal', 4]], chestB: [] },
  scattered: { chestA: [['raw_iron', 5], ['coal', 4]], chestB: [['raw_iron', 4]] },
  mixed: { chestA: [['raw_iron', 8], ['coal', 4]], chestB: [['raw_copper', 8]] },
}
// the scene is done at the first job row that ran past the search: success, or any stop at all on the base
const DONE = rows => rows.some(r => r.name === '_smelt_town' && (r.status === 'success' || !CANDIDATE))
const WINDOW_MS = Number(process.env.IS_WINDOW_MS || 300000)
const arenaCmds = () => ['forceload add 744 744 776 776', `kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..20]`,
  'fill 746 120 746 774 126 774 minecraft:air', 'fill 746 119 746 774 119 774 minecraft:stone']
const itemArg = id => `minecraft:${id}`
function bagCmds () {
  const c = [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  BAG.forEach(([id, n], s) => c.push(`item replace entity ${NAME} container.${s} with ${itemArg(id)} ${n}`))
  return c
}
const sceneCmds = spec => [
  `setblock ${at(CHEST_A)} minecraft:chest[facing=west]`,
  `setblock ${at(CHEST_B)} minecraft:chest[facing=west]`,
  ...spec.chestA.map(([id, n], s) => `item replace block ${at(CHEST_A)} container.${s} with minecraft:${id} ${n}`),
  ...spec.chestB.map(([id, n], s) => `item replace block ${at(CHEST_B)} container.${s} with minecraft:${id} ${n}`),
  `setblock ${at(FURNACE)} minecraft:furnace[facing=north]`,
]

// ---------------------------------------------------------------- oracle (the server's slots, never the bot's claim)
const parseItem = seg => {
  const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]
  if (!id) return null
  return { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) }
}
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST_A)} Items[{Slot:${s}b}]`)
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST_B)} Items[{Slot:${s}b}]`)
  for (let s = 0; s < 3; s++) cmds.push(`data get block ${at(FURNACE)} Items[{Slot:${s}b}]`)
  cmds.push(`execute as @e[type=item,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..20] run data get entity @s Item`)
  cmds.push(`execute if block ${at(FURNACE)} minecraft:furnace[lit=true]`)
  const r = []
  for (let i = 0; i < cmds.length; i += 30) r.push(...rcon(...cmds.slice(i, i + 30)))
  // EVERY READ IS VALIDATED (Codex driver r1 P2): a slot is an item or the server's explicit "no elements" -- anything else (an
  // unloaded chunk, a missing block entity, a lost reply) is a FAILED READ and stops the scene, never an empty slot
  const SLOT_OK = /has the following (entity|block) data|Found no elements matching/
  for (let i = 0; i < 93; i++) if (!SLOT_OK.test(r[i]?.reply || '')) throw new Error(`oracle read failed: ${r[i]?.cmd} => ${JSON.stringify(r[i]?.reply ?? null)}`)
  // ...and a slot that answered with data must PARSE to an item with a count (Codex driver r2 P2): an unparseable item is a failed
  // read, never an empty slot
  for (let i = 0; i < 93; i++) {
    if (/has the following (entity|block) data/.test(r[i].reply) && !(parseItem(r[i].reply)?.count > 0)) throw new Error(`oracle read failed (unparseable item): ${r[i].cmd} => ${r[i].reply.slice(0, 200)}`)
  }
  for (const seg of (r[93]?.reply || '').split(/has the following entity data:/).slice(1)) if (!(parseItem(seg)?.count > 0)) throw new Error(`oracle read failed (unparseable ground item): ${seg.slice(0, 200)}`)
  if (!/Test (passed|failed)/.test(r[94]?.reply || '')) throw new Error(`oracle read failed: the furnace's lit state => ${JSON.stringify(r[94]?.reply ?? null)}`)
  if (/Cannot|Unknown|Incorrect|No entity/i.test(r[93]?.reply || '')) throw new Error(`oracle read failed: the ground => ${r[93].reply}`)
  const pick = (q, re) => (re.test(q?.reply || '') ? parseItem(q.reply) : null)
  const bag = {}; const a = {}; const b = {}; const furnace = {}
  for (let s = 0; s < 36; s++) { const it = pick(r[s], /has the following entity data/); if (it) bag[s] = it }
  for (let s = 0; s < 27; s++) { const it = pick(r[36 + s], /has the following block data/); if (it) a[s] = it }
  for (let s = 0; s < 27; s++) { const it = pick(r[63 + s], /has the following block data/); if (it) b[s] = it }
  for (let s = 0; s < 3; s++) { const it = pick(r[90 + s], /has the following block data/); if (it) furnace[s] = it }
  const ground = (r[93]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  return { bag, a, b, furnace, ground, lit: /Test passed/.test(r[94]?.reply || '') }
}
const tot = list => { const t = {}; for (const it of list) t[it.id] = (t[it.id] || 0) + it.count; return t }
const totals = snap => ({ bag: tot(Object.values(snap.bag)), a: tot(Object.values(snap.a)), b: tot(Object.values(snap.b)), furnace: tot(Object.values(snap.furnace)), ground: tot(snap.ground) })
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
const d1 = (a, b, n) => (b[n] || 0) - (a[n] || 0)
const town = (t, n) => (t.a[n] || 0) + (t.b[n] || 0)

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const WANT = /^(craft|smelt|deposit|withdraw|town_deposit|smelt_town|furnace_drain|toolkit|_smelt_town|_furnace_drain|_furnace_session|_smelt_job_skip|_ironsmelt_mode|_death)$/
const skillRows = f => jl(f).filter(r => r.skill && WANT.test(r.skill.name))
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 300) }))
const decisions = f => jl(f).map(r => ({ ts: Date.parse(r['@timestamp']), order: (r.llm?.latency_ms ?? 0) === 0 && !(r.response?.text), skill: r.tool_calls?.[0]?.skill,
  admitted: r.llm?.admission != null, err: r.llm?.error ?? null, status: r.outcome?.status, detail: String(r.outcome?.detail || '').slice(0, 160) }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE BRAIN, IN THIS PROCESS (smeltjob-e2e's): status alternating with two short walks on the arena floor
let brainLog = null
let brainN = 0
const WANDER = [{ x: 754, y: 120, z: 756 }, { x: 766, y: 120, z: 756 }]
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const all = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (all.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    if (brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: ${decision.skill}\n`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

let bot = null
async function stopBot () {
  try { bot && bot.kill('SIGTERM') } catch {}
  bot = null
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}

function verdict (scene, tb, ta, rows, b, a, done) {
  const out = { pass: false, why: [], expect: CANDIDATE ? 'candidate' : 'base' }
  const need = (ok, why) => { if (!ok) out.why.push(why) }
  const job = rows.find(r => r.name === '_smelt_town' && r.status === 'success') ?? rows.find(r => r.name === '_smelt_town')
  const own = () => {
    need((ta.bag.raw_iron || 0) === 3, `the bag keeps its OWN 3 raw_iron (${ta.bag.raw_iron || 0})`)
    need((ta.bag.iron_ingot || 0) === 2, `the bag keeps its OWN 2 iron_ingot (${ta.bag.iron_ingot || 0})`)
    need(!Object.keys(ta.ground).length, `nothing on the ground (${diff({}, ta.ground)})`)
  }
  if (CANDIDATE) {
    need(rows.some(r => r.name === '_ironsmelt_mode'), 'the licence row _ironsmelt_mode was written (the build is live)')
    need(!!job && /in=fe /.test(job.detail) && /verdict=ok/.test(job.detail), `the first job is an IRON job, verdict=ok (${job?.detail ?? 'none'})`)
    need(town(ta, 'raw_iron') - town(tb, 'raw_iron') === -8, `the town's raw_iron -8 (${town(ta, 'raw_iron') - town(tb, 'raw_iron')})`)
    need(town(ta, 'iron_ingot') - town(tb, 'iron_ingot') === 8, `the town's iron_ingot +8 (${town(ta, 'iron_ingot') - town(tb, 'iron_ingot')})`)
    need(town(ta, 'coal') - town(tb, 'coal') === -1, `one town coal burned (${town(ta, 'coal') - town(tb, 'coal')})`)
    need(!Object.keys(ta.furnace).length && !a.lit, 'the furnace is left empty and cold')
    need(!!job && /fed=8 /.test(job.detail) && / fe=3\/2>3\/2/.test(job.detail), `the row: fed=8, fe=3/2>3/2 (${job?.detail ?? 'none'})`)
    own()
    if (scene === 'scattered') need(d1(tb.a, ta.a, 'raw_iron') + d1(tb.b, ta.b, 'raw_iron') === -8 && d1(tb.b, ta.b, 'raw_iron') < 0 && d1(tb.a, ta.a, 'raw_iron') < 0, 'the 8 came from BOTH chests')
    if (scene === 'mixed') need(d1(tb.b, ta.b, 'raw_copper') === 0, `the copper is untouched by the iron job (${d1(tb.b, ta.b, 'raw_copper')})`)
    out.pass = !out.why.length && done
    out.verdict = out.pass ? 'CANDIDATE_PASS' : 'FAIL'
  } else {
    // THE POSITIVE CONTROL: the base, in the same scene, leaves the town's raw iron where it lies
    need(town(ta, 'raw_iron') === town(tb, 'raw_iron'), `the base leaves the town's raw iron unsmelted (${town(tb, 'raw_iron')} -> ${town(ta, 'raw_iron')})`)
    need(town(ta, 'iron_ingot') === town(tb, 'iron_ingot'), 'and makes no iron ingots in town')
    need(!!job, 'the base job ran (the instrument could see a job)')
    if (scene === 'mixed') need(d1(tb.b, ta.b, 'raw_copper') === -8 && d1(tb.b, ta.b, 'copper_ingot') === 8, `the base smelts the copper (${diff(tb.b, ta.b)})`)
    else need(!!job && /stop=town_has_none/.test(job.detail), `the base job finds no copper: town_has_none (${job?.detail ?? 'none'})`)
    own()
    out.pass = !out.why.length && done
    out.verdict = out.pass ? 'BASE_SHAPE' : 'BASE_UNEXPECTED'
  }
  if (!done) out.why.push('the scene did not reach its completion condition inside the window')
  return out
}

async function runScene (scene) {
  const spec = SPEC[scene]
  if (!spec) throw new Error(`unknown scene ${scene}`)
  const tag = `${scene}-${CANDIDATE ? 'cand' : 'base'}-${SERVER}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`   // the server in it: no shared run dirs (P3-7)
  const logRel = `./sandbox/log/ironsmelt-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/ironsmelt-e2e/${tag}/skill-${NAME}.jsonl`
  const llmLog = `${R}/sandbox/log/ironsmelt-e2e/${tag}/llm-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  // ONE ENV FILE PER DRIVER PROCESS: two drivers on two sandboxes from one checkout shared `.env.isab`, and each bot read the
  // other's server and name (Paper 10-23 r1/r2: two bots logging each other out every 20 s in the first scene)
  const envRel = ENV_REL
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/ironsmelt-${tag}`); set('MEMORY_POOL', `sbxis-${tag}`)
  set('MEMORY_SCOPE', 'shared'); set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`); set('MAX_CONSECUTIVE_FAILURES', 50)
  for (const ax of ['X', 'Y', 'Z']) { set(`HOME_${ax}`, HOME[ax.toLowerCase()]); set(`BOARD_${ax}`, HOME[ax.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  const seen = lines(botOut).filter(l => /spawned pos=/.test(l)).length
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${TRACE}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  let spawnErr = null
  bot.on('error', e => { spawnErr = e })      // a failed spawn ends the scene, never an unhandled event (P3-9)
  if (!await waitFor(() => spawnErr || lines(botOut).filter(l => /spawned pos=/.test(l)).length > seen, 90000, 300) || spawnErr) { await stopBot(); throw new Error(`no spawn${spawnErr ? `: ${spawnErr.message}` : ''}`) }
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${NAME}`, 'difficulty peaceful')
  await sleep(1500)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds()), ...rcon(...sceneCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(1500)
  const before = snapshot()
  // THE SCENE IS WHAT IT SAYS BEFORE ANYTHING IS MEASURED (Codex driver r1 P2): the bag and both chests exactly as specified
  {
    const tb0 = totals(before)
    const want = (list) => list.reduce((m, [id, n]) => ({ ...m, [id]: (m[id] || 0) + n }), {})
    const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
    const bad0 = [!same(tb0.a, want(spec.chestA)) && `chest A ${JSON.stringify(tb0.a)}`, !same(tb0.b, want(spec.chestB)) && `chest B ${JSON.stringify(tb0.b)}`,
      !same(tb0.bag, want(BAG)) && `bag ${JSON.stringify(tb0.bag)}`, Object.keys(tb0.furnace).length && `furnace ${JSON.stringify(tb0.furnace)}`].filter(Boolean)
    if (bad0.length) { await stopBot(); throw new Error('the scene is not as specified before the measurement: ' + bad0.join('; ')) }
  }
  const t0 = Date.now()
  const done = await waitFor(() => DONE(skillRows(skillLog).filter(r => r.ts >= t0 - 5000)), WINDOW_MS, 1000)
  if (done) await sleep(5000)
  const after = snapshot()
  const rows = skillRows(skillLog)                       // the licence row is written at spawn: the whole log
  const sceneRows = rows.filter(r => r.ts >= t0 - 5000 || r.name === '_ironsmelt_mode')
  const dec = decisions(llmLog).filter(r => r.ts >= t0 - 5000)
  await stopBot()
  await sleep(1000)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tb = totals(before), ta = totals(after)
  const v = verdict(scene, tb, ta, sceneRows, before, after, !!done)
  const r = { scene, tag, candidate: CANDIDATE, server: SERVER,
    sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    windowMs: Date.now() - t0, done: !!done, verdict: v, before: { ...before, totals: tb }, after: { ...after, totals: ta },
    d: { bag: diff(tb.bag, ta.bag), chestA: diff(tb.a, ta.a), chestB: diff(tb.b, ta.b), furnace: diff(tb.furnace, ta.furnace), ground: diff(tb.ground, ta.ground) },
    decisions: dec.map(d => `${d.order ? 'ORDER' : 'model'} ${d.skill} ${d.admitted ? d.status : 'REFUSED ' + d.err}`), rows: sceneRows }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${scene.padEnd(10)} ${v.verdict} done=${r.done} d(bag){${r.d.bag}} d(A){${r.d.chestA}} d(B){${r.d.chestB}} d(furnace){${r.d.furnace}} ground{${r.d.ground}} lit=${after.lit}` +
    (v.why.length ? `\n   why: ${v.why.join('; ')}` : ''))
  console.log('   decisions: ' + r.decisions.slice(0, 12).join(' | '))
  console.log('   rows: ' + sceneRows.filter(x => x.name !== '_ironsmelt_mode').map(x => `${x.name}:${x.status}:${x.detail.slice(0, 220)}`).join(' || '))
  return v.pass
}

// WORLD CLEANUP ONLY FOR AN ARENA THIS RUN BUILT (Codex driver r1 P1): a refused lock or a busy server touches nothing
let arenaOwned = false
async function main () {
  sbx.requireSandboxLock(SERVER, 'ironsmelt')   // the global lock or this server's own (sandbox/lib/sbxlock.cjs); throws unless every lock on SERVER has our tag as its owner's first word
  const pl = rcon('list')[0].reply; if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  fs.mkdirSync(OUTDIR, { recursive: true })      // the filesystem only after the lock and the empty-server checks
  arenaOwned = true
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`root=${BOT_ROOT} build=${CANDIDATE ? 'CANDIDATE' : 'BASE'} server=${SERVER} scenes=${SCENES_S}`)
  let ok = true
  for (const s of SCENES_S.split(',')) {
    try { ok = (await runScene(s)) && ok } catch (e) { ok = false; console.log(`${s} SCENE FAILED: ${e.message}`); await stopBot().catch(() => {}) }
  }
  return ok
}
async function cleanup () {
  if (arenaOwned) await stopBot().catch(() => {})   // no `list` polling on a server this run never held (Claude driver r1 P2-1)
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/${ENV_REL}`) } catch {}
  if (arenaOwned) { try { rcon(`kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..20]`, 'fill 746 120 746 774 126 774 minecraft:air', 'forceload remove 744 744 776 776') } catch {} }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(ok => finish(ok ? 0 : 2), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
process.on('SIGHUP', () => finish(1))
