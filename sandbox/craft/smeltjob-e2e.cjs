// SANDBOX-ONLY end-to-end proof of smeltjob-01 (the town smelt job + the furnace drain; stage 1 of
// docs/reports/townprojects-design-2026-10-14.md). ONE FRESH BOT PER SCENE from <botRoot> (unmodified; trace.cjs only
// observes packets), the scene set by RCON once the bot is there, and the SERVER's truth before and after: every bag
// slot, the town chest, the furnace's three slots, the item entities on the ground. The bot's own claim is recorded,
// never trusted. Nothing is queued to the model (every model decision is `status`): the job must be the bot's OWN order.
//
//   node smeltjob-e2e.cjs <botRoot> <scene,...> [server]      (CRAFT_REPO=<a main checkout with sandbox/run-bot.sh>)
//
// scenes:
//   copper     town chest 24 raw_copper + 4 coal, a furnace in town, a bag with no copper, no fuel, no rung ready ->
//              smelt_town: 8 raw out of the chest, 8 ingots back in, 1 coal used; the bag and the ground unchanged
//   drain      an UNLIT furnace holding 5 copper_ingot (output) + 3 raw_iron (input, no fuel), a chest with no copper ->
//              (smelt_town finds none) -> furnace_drain empties it into the bag
//   carry      a bag holding 6 ingots + 2 raw copper (an interrupted job), a town with coal and no copper -> all 8 banked
//   fullchest  8 ingots in the bag, the town chest full -> no loss; one slot freed -> the retry banks all 8
//   recovery   SIGKILL mid-smelt, restart -> every copper unit back in the town chest
//   nofurnace  no furnace, too little cobble to craft one -> the 8 raw copper and the town coal go back; the bag's own
//              coal stays (the exit returns everything the job took)
//   milestone  a bag whose stone-pickaxe rung is craft-ready, at town, the chest holding copper -> the CRAFT runs first,
//              no smelt_town before it (positive control: the job then runs once the rung is done)
//
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. Sandbox servers and sandbox-* names
// only. Refuses to run unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `smeltjob`.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const sbx = require('../lib/sbxlock.cjs')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox2'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node smeltjob-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const TRACE = path.join(R, 'sandbox/craft/trace.cjs')
const NAME = process.env.SJ_BOT_NAME || 'sandbox-Smelt'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/smeltjob-e2e`
const RES = `${OUTDIR}/results.jsonl`
const BRAIN_PORT = Number(process.env.SJ_BRAIN_PORT || 11497)
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-sjab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const HOME = { x: 700, y: 120, z: 700 }
const CHEST = { x: 702, y: 120, z: 700 }
const FURNACE = { x: 700, y: 120, z: 703 }
const TABLE = { x: 699, y: 120, z: 702 }
const STAND = { x: 700.5, y: 120, z: 700.5 }
const at = c => `${c.x} ${c.y} ${c.z}`
const wool = n => Array.from({ length: n }, (_, i) => ['white_wool', 1 + (i % 3)])
// no dirt, cobble, stone or planks: nothing a pit-first well build or a composter build could start with
const LIGHT_BAG = [['stone_pickaxe', 1], ['torch', 8], ['bread', 5], ...wool(6)]
// orderroom-ab's ROOM_BAG (its active rung is a craft-ready stone pickaxe: the stick stack empties, so the craft fits), with
// fewer fillers so the job's two free slots exist too; it already carries 5 raw_copper -- and 2 coal for its fuel
const RUNG_BAG = [['cobblestone', 64], ['cobblestone', 20], ['stick', 2], ['crafting_table', 1], ['oak_log', 64], ['oak_log', 64], ['oak_log', 40],
  ['dirt', 16], ['wooden_pickaxe', 1, 9], ['furnace', 1], ['sand', 8], ['raw_copper', 5], ['coal', 2], ...wool(10)]
const SPEC = {
  copper: { bag: LIGHT_BAG, chest: [['raw_copper', 24], ['coal', 4]], furnace: [], until: rows => rows.some(r => r.name === '_smelt_town' && r.status === 'success') },
  // the chest holds COAL but no copper: the job's no-copper look must leave the town's coal where it is (Claude code r2 P3)
  drain: { bag: LIGHT_BAG, chest: [['oak_sapling', 3], ['coal', 4]], furnace: [[0, 'raw_iron', 3], [2, 'copper_ingot', 5]],
           until: rows => rows.some(r => r.name === '_furnace_drain' && r.status === 'success') },
  milestone: { bag: RUNG_BAG, chest: [['raw_copper', 16], ['coal', 4]], furnace: [], table: true,
               until: rows => rows.some(r => r.name === '_smelt_town' && r.status === 'success') && rows.some(r => r.name === 'craft' && r.status === 'success' && /stone_pickaxe/.test(r.detail)) },
  // THE CARRY RETURN (Codex code r2): a bag left with 6 ingots + 2 raw copper by an interrupted job, a town with coal but
  // no copper -> one job smelts the 2 and banks all 8 ingots
  carry: { bag: [...LIGHT_BAG, ['copper_ingot', 6], ['raw_copper', 2]], chest: [['coal', 4]], furnace: [],
           until: rows => rows.some(r => r.name === '_smelt_town' && r.status === 'success') },
  // THE RECOVERY CHAIN (Codex code r3 item 6), two scenes, sandbox pacing SMELT_JOB_COOLDOWN_MS / DRAIN_COOLDOWN_MS = 20 s:
  // fullchest  a bag of 8 INGOTS ONLY (no raw: the bank-only branch), the town chest FULL -> the bank fails, nothing lost,
  //            the ingots stay; the driver frees one chest slot -> the job's deterministic retry banks all 8
  fullchest: { bag: [...LIGHT_BAG, ['copper_ingot', 8]], chest: Array.from({ length: 27 }, () => ['diorite', 64]), furnace: [], pace: true,
               during: async ({ rows, t0 }) => {
                 const firstTry = await waitFor(() => rows().find(r => r.ts >= t0 && r.name === '_smelt_town'), 120000, 1000)
                 const held = snapshot()
                 rcon(`item replace block ${at(CHEST)} container.0 with minecraft:air`)
                 return { firstTry, heldAfterFirst: totals(held) }
               },
               until: rows => rows.filter(r => r.name === '_smelt_town').length >= 2 && rows.some(r => r.name === '_smelt_town' && r.status === 'success') },
  // recovery   town chest 8 raw copper + coal; the bot is SIGKILLED mid-smelt (ingots already in the output slot), then
  //            restarted with the same state: every copper unit must end in the town chest (the carry return + the drain)
  // THE EXIT GIVES BACK WHAT IT TOOK (Claude rebase review 10-15 P2/P3): no furnace in reach and too little cobble to craft
  // one -> the job withdrew 8 raw copper + 1 town coal, and must put BOTH back; the bag's own 2 coal stay in the bag
  nofurnace: { bag: [...LIGHT_BAG, ['coal', 2]], chest: [['raw_copper', 8], ['coal', 4]], furnace: [], noFurnace: true,
               until: rows => rows.some(r => r.name === '_smelt_town' && /stop=no_furnace/.test(r.detail)) },
  recovery: { bag: LIGHT_BAG, chest: [['raw_copper', 8], ['coal', 4]], furnace: [], pace: true, restart: true,
              during: async ({ kill, restart }) => {
                // MID-SMELT: ingots already made (smelt takes them into the bag each half second, so look at bag + slot) while
                // raw copper is still in the furnace's input slot
                const mid = await waitFor(() => { const t = totals(snapshot()); return ((t.bag.copper_ingot || 0) + (t.furnace.copper_ingot || 0)) >= 2 && (t.furnace.raw_copper || 0) >= 1 ? t : null }, 150000, 1000)
                await kill()
                const atKill = totals(snapshot())
                // THE DEAD HOLDER'S LEASE EXPIRES BY TTL (furnacelease.mjs, 240 s): the bot comes back once it has, so the
                // restarted bot's carry return AND its drain run before the scripted brain's idling can trip the livelock
                // breaker (Paper 10-15 recovery runs 2-3: a relocation off the arena, where no town job runs)
                await sleep(250000)
                await restart()
                return { killedAt: mid, atKill }
              },
              until: rows => false },
}
const RECOVERY_WINDOW_MS = Number(process.env.SJ_RECOVERY_MS || 240000)
const WINDOW_MS = Number(process.env.SJ_WINDOW_MS || 300000)
const arenaCmds = () => ['forceload add 684 684 716 716', 'kill @e[type=!player,x=700,y=120,z=700,distance=..20]',
  'fill 686 120 686 714 126 714 minecraft:air', 'fill 686 119 686 714 119 714 minecraft:stone']
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  spec.bag.forEach(([id, n, uses], s) => {
    const dmg = uses != null ? ({ wooden_pickaxe: 59, stone_pickaxe: 131 }[id] - uses) : null
    c.push(`item replace entity ${NAME} container.${s} with ${itemArg(id, dmg)} ${n}`)
  })
  return c
}
const sceneCmds = spec => [
  `setblock ${at(CHEST)} minecraft:chest[facing=west]`,
  ...spec.chest.map(([id, n], s) => `item replace block ${at(CHEST)} container.${s} with minecraft:${id} ${n}`),
  spec.noFurnace ? `setblock ${at(FURNACE)} minecraft:air` : `setblock ${at(FURNACE)} minecraft:furnace[facing=north]`,
  ...spec.furnace.map(([slot, id, n]) => `item replace block ${at(FURNACE)} container.${slot} with minecraft:${id} ${n}`),
  ...(spec.table ? [`setblock ${at(TABLE)} minecraft:crafting_table`] : []),
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
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST)} Items[{Slot:${s}b}]`)
  for (let s = 0; s < 3; s++) cmds.push(`data get block ${at(FURNACE)} Items[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..20] run data get entity @s Item')
  cmds.push(`execute if block ${at(FURNACE)} minecraft:furnace[lit=true]`)
  const r = rcon(...cmds)
  const pick = (q, re) => (re.test(q?.reply || '') ? parseItem(q.reply) : null)
  const bag = {}; const chest = {}; const furnace = {}
  for (let s = 0; s < 36; s++) { const it = pick(r[s], /has the following entity data/); if (it) bag[s] = it }
  for (let s = 0; s < 27; s++) { const it = pick(r[36 + s], /has the following block data/); if (it) chest[s] = it }
  for (let s = 0; s < 3; s++) { const it = pick(r[63 + s], /has the following block data/); if (it) furnace[s] = it }
  const ground = (r[66]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  return { bag, chest, furnace, ground, lit: /Test passed/.test(r[67]?.reply || '') }
}
const tot = list => { const t = {}; for (const it of list) t[it.id] = (t[it.id] || 0) + it.count; return t }
const totals = snap => ({ bag: tot(Object.values(snap.bag)), chest: tot(Object.values(snap.chest)), furnace: tot(Object.values(snap.furnace)), ground: tot(snap.ground) })
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
const d1 = (a, b, n) => (b[n] || 0) - (a[n] || 0)

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const WANT = /^(craft|smelt|deposit|withdraw|town_deposit|smelt_town|furnace_drain|build_well|_work_order|_smelt_town|_furnace_drain|_furnace_session|_smelt_job_skip|_death)$/
const skillRows = f => jl(f).filter(r => r.skill && WANT.test(r.skill.name))
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 300) }))
const decisions = f => jl(f).map(r => ({ ts: Date.parse(r['@timestamp']), order: (r.llm?.latency_ms ?? 0) === 0 && !(r.response?.text), skill: r.tool_calls?.[0]?.skill,
  admitted: r.llm?.admission != null, err: r.llm?.error ?? null, status: r.outcome?.status, detail: String(r.outcome?.detail || '').slice(0, 160) }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE BRAIN, IN THIS PROCESS: nothing is queued, so every model decision is `status`.
let brainLog = null
let brainN = 0
const WANDER = [{ x: 694, y: 120, z: 696 }, { x: 706, y: 120, z: 696 }]
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const all = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (all.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    // 'status' for ever trips the fleet's livelock breaker (repeat_loop -> a relocation off the arena: Paper 10-15 recovery
    // run 2 ended 100 blocks from town, where no town job runs); as stock-e2e does, status alternates with two short walks
    // on the arena floor, clear of the chest and the furnace
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

function verdict (scene, tb, ta, rows, dec, b, a, done, extra = null) {
  const out = { pass: false, why: [] }
  const need = (ok, why) => { if (!ok) out.why.push(why) }
  if (scene === 'copper') {
    need(d1(tb.chest, ta.chest, 'raw_copper') === -8, `chest raw_copper ${diff({ r: tb.chest.raw_copper || 0 }, { r: ta.chest.raw_copper || 0 })} (want -8)`)
    need(d1(tb.chest, ta.chest, 'copper_ingot') === 8, `chest copper_ingot +${d1(tb.chest, ta.chest, 'copper_ingot')} (want +8)`)
    need(d1(tb.chest, ta.chest, 'coal') === -1, `chest coal ${d1(tb.chest, ta.chest, 'coal')} (want -1)`)
    need(!(ta.bag.raw_copper || 0) && !(ta.bag.copper_ingot || 0), 'no copper left in the bag')
    need(!Object.keys(ta.ground).length, `nothing on the ground (${diff({}, ta.ground)})`)
    need(!Object.keys(ta.furnace).length && !a.lit, 'the furnace is left empty and cold')
    const row = rows.find(r => r.name === '_smelt_town' && r.status === 'success')
    need(!!row && /verdict=ok/.test(row.detail) && /deposited=8/.test(row.detail), `the row says verdict=ok deposited=8 (${row?.detail ?? 'none'})`)
  } else if (scene === 'drain') {
    need(!Object.keys(ta.furnace).length, `the furnace is empty (${JSON.stringify(ta.furnace)})`)
    need(d1(tb.bag, ta.bag, 'copper_ingot') + d1(tb.chest, ta.chest, 'copper_ingot') === 5, 'the 5 ingots are in the bag or the chest')
    need(d1(tb.bag, ta.bag, 'raw_iron') + d1(tb.chest, ta.chest, 'raw_iron') === 3, 'the 3 raw_iron are in the bag or the chest')
    need(!Object.keys(ta.ground).length, 'nothing on the ground')
    need(d1(tb.chest, ta.chest, 'coal') === 0, `the town's coal stays when there is no copper (${d1(tb.chest, ta.chest, 'coal')})`)
    need(rows.some(r => r.name === '_furnace_drain' && r.status === 'success' && /taken=8/.test(r.detail)), 'a _furnace_drain row: taken=8')
  } else if (scene === 'carry') {
    need(d1(tb.chest, ta.chest, 'copper_ingot') === 8, `chest copper_ingot +${d1(tb.chest, ta.chest, 'copper_ingot')} (want +8)`)
    need(!(ta.bag.raw_copper || 0) && !(ta.bag.copper_ingot || 0), 'no copper left in the bag')
    need(d1(tb.chest, ta.chest, 'coal') === -1, 'one town coal burned')
    need(!Object.keys(ta.ground).length && !Object.keys(ta.furnace).length, 'nothing on the ground or in the furnace')
  } else if (scene === 'fullchest') {
    const first = extra?.firstTry
    need(!!first && /stop=banked_carry/.test(first.detail) && /dep_i=0/.test(first.detail) && first.status === 'no_effect', `the first try could not bank into the full chest and said so (${first?.status} ${first?.detail?.slice(0, 120)})`)
    need((extra?.heldAfterFirst?.bag?.copper_ingot || 0) === 8 && !(extra?.heldAfterFirst?.ground?.copper_ingot), 'after the failed bank the 8 ingots are still in the bag (nothing lost, nothing dropped)')
    need(d1(tb.chest, ta.chest, 'copper_ingot') === 8, `the retry banked all 8 (chest +${d1(tb.chest, ta.chest, 'copper_ingot')})`)
    need(!(ta.bag.copper_ingot || 0) && !Object.keys(ta.ground).length, 'none left in the bag or on the ground')
    need(rows.some(r => r.name === 'smelt_town' && r.status === 'success'), 'the runner graded the retry a success (inventory_loss evidence)')
  } else if (scene === 'nofurnace') {
    need(d1(tb.chest, ta.chest, 'raw_copper') === 0, `the 8 raw copper are back in the chest (chest ${d1(tb.chest, ta.chest, 'raw_copper')})`)
    need(d1(tb.chest, ta.chest, 'coal') === 0, `the town's coal is back in the chest (chest ${d1(tb.chest, ta.chest, 'coal')})`)
    need((ta.bag.coal || 0) === (tb.bag.coal || 0), `the bag keeps exactly its own coal (${tb.bag.coal || 0} -> ${ta.bag.coal || 0})`)
    need(!(ta.bag.raw_copper || 0) && !(ta.bag.copper_ingot || 0), 'no copper left in the bag')
    need(!Object.keys(ta.ground).length, 'nothing on the ground')
    const row = rows.find(r => r.name === '_smelt_town' && /stop=no_furnace/.test(r.detail))
    need(!!row && /withdrawn=8 coal=1 /.test(row.detail) && /dep_r=8 /.test(row.detail) && /verdict=ok/.test(row.detail) && /fb=1/.test(row.detail), `the row: withdrawn=8 coal=1 dep_r=8 verdict=ok fb=1 (${row?.detail ?? 'none'})`)
  } else if (scene === 'recovery') {
    const cu = t => (t.raw_copper || 0) + (t.copper_ingot || 0)
    need(!!extra?.killedAt, 'the bot was killed mid-smelt (ingots made, raw copper still in the furnace)')
    need(cu(ta.chest) === 8, `every copper unit is back in the town chest (chest ${cu(ta.chest)}, bag ${cu(ta.bag)}, furnace ${cu(ta.furnace)}, ground ${cu(ta.ground)})`)
    need((ta.chest.copper_ingot || 0) >= 2, `the ingots made before the kill were banked (chest ingots ${ta.chest.copper_ingot || 0})`)
    need(!cu(ta.bag) && !cu(ta.furnace) && !cu(ta.ground), 'none in the bag, the furnace or on the ground')
  } else if (scene === 'milestone') {
    const craftOk = rows.find(r => r.name === 'craft' && r.status === 'success' && /stone_pickaxe/.test(r.detail))
    const firstJob = rows.find(r => r.name === '_smelt_town')
    // the town's recount (count_town) outranks a rung by design (stocktarget-02); the question is craft vs the JOB
    const firstOrder = dec.find(d => d.order && ['craft', 'smelt_town', 'furnace_drain'].includes(d.skill))
    need(firstOrder?.skill === 'craft', `the first of craft / smelt_town / furnace_drain ORDERS is the rung's craft (${firstOrder?.skill})`)
    need(!!craftOk, 'the rung craft succeeded')
    // the POSITIVE CONTROL is required, not reported (Codex code r1 P2-10): the job must run, AFTER the craft, and succeed
    const jobOk = rows.find(r => r.name === '_smelt_town' && r.status === 'success')
    need(!!firstJob && !!craftOk && firstJob.ts > craftOk.ts, 'the job ran, and only after the rung craft succeeded')
    need(!!jobOk, 'the job then succeeded (positive control)')
    need(d1(tb.bag, ta.bag, 'stone_pickaxe') + d1(tb.chest, ta.chest, 'stone_pickaxe') >= 1, 'a stone pickaxe exists (server)')
    out.positiveControl = !!jobOk
  }
  out.pass = !out.why.length && done
  if (!done) out.why.push('the scene did not reach its completion condition inside the window')
  return out
}

async function runScene (scene) {
  const spec = SPEC[scene]
  const tag = `${scene}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/smeltjob-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/smeltjob-e2e/${tag}/skill-${NAME}.jsonl`
  const llmLog = `${R}/sandbox/log/smeltjob-e2e/${tag}/llm-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = 'sandbox/.env.sjab'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/smeltjob-${tag}`); set('MEMORY_POOL', `sbxsj-${tag}`)
  set('MEMORY_SCOPE', 'shared'); set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0)
  if (spec.pace) { set('SMELT_JOB_COOLDOWN_MS', 20000); set('DRAIN_COOLDOWN_MS', 20000) }   // sandbox pacing only
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`); set('MAX_CONSECUTIVE_FAILURES', 50)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  const spawnBot = async () => {
    const seen = lines(botOut).filter(l => /spawned pos=/.test(l)).length
    bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${TRACE}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
    if (!await waitFor(() => lines(botOut).filter(l => /spawned pos=/.test(l)).length > seen, 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  }
  await spawnBot()
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${NAME}`, 'difficulty peaceful')
  await sleep(1500)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds(spec)), ...rcon(...sceneCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(1500)
  const before = snapshot()
  const t0 = Date.now()
  let extra = null
  if (spec.during) {
    extra = await spec.during({ t0, rows: () => skillRows(skillLog), kill: async () => { try { bot.kill('SIGKILL') } catch {} bot = null; await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000) },
      restart: async () => { await spawnBot(); rcon(`gamemode survival ${NAME}`, `effect clear ${NAME}`) } })
  }
  const allBack = () => { const c = totals(snapshot()).chest; return (c.raw_copper || 0) + (c.copper_ingot || 0) === 8 }
  const done = spec.restart
    ? await waitFor(allBack, RECOVERY_WINDOW_MS, 5000)
    : await waitFor(() => spec.until(skillRows(skillLog).filter(r => r.ts >= t0 - 5000)), WINDOW_MS, 1000)
  if (done) await sleep(5000)
  const after = snapshot()
  const rows = skillRows(skillLog).filter(r => r.ts >= t0 - 5000)
  const dec = decisions(llmLog).filter(r => r.ts >= t0 - 5000)
  await stopBot()
  await sleep(1000)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tb = totals(before), ta = totals(after)
  const v = verdict(scene, tb, ta, rows, dec, before, after, !!done, extra)
  const r = { scene, tag, sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    windowMs: Date.now() - t0, done: !!done, verdict: v, extra, before: { ...before, totals: tb }, after: { ...after, totals: ta },
    d: { bag: diff(tb.bag, ta.bag), chest: diff(tb.chest, ta.chest), furnace: diff(tb.furnace, ta.furnace), ground: diff(tb.ground, ta.ground) },
    decisions: dec.map(d => `${d.order ? 'ORDER' : 'model'} ${d.skill} ${d.admitted ? d.status : 'REFUSED ' + d.err}`), rows }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${scene.padEnd(10)} ${v.pass ? 'PASS' : 'FAIL'} done=${r.done} d(bag){${r.d.bag}} d(chest){${r.d.chest}} d(furnace){${r.d.furnace}} ground{${r.d.ground}} lit=${after.lit}` +
    (v.why.length ? `\n   why: ${v.why.join('; ')}` : '') + (v.positiveControl != null ? `\n   positive control (the job ran after the rung): ${v.positiveControl}` : ''))
  console.log('   decisions: ' + r.decisions.slice(0, 12).join(' | '))
  console.log('   rows: ' + rows.map(x => `${x.name}:${x.status}:${x.detail.slice(0, 160)}`).join(' || '))
  return v.pass
}

async function main () {
  sbx.requireSandboxLock(SERVER, /smeltjob/)   // the global lock or this server's own (sandbox/lib/sbxlock.cjs); throws unless every lock on SERVER names us
  const pl = rcon('list')[0].reply; if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`root=${BOT_ROOT} server=${SERVER} scenes=${SCENES_S}`)
  let ok = true
  for (const s of SCENES_S.split(',')) {
    try { ok = (await runScene(s)) && ok } catch (e) { ok = false; console.log(`${s} SCENE FAILED: ${e.message}`); await stopBot().catch(() => {}) }
  }
  return ok
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.sjab`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..20]', 'fill 686 120 686 714 126 714 minecraft:air', 'forceload remove 684 684 716 716') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(ok => finish(ok ? 0 : 2), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
