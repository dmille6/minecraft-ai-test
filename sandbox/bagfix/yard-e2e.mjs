// SANDBOX-ONLY (sandbox2): bagfix-02's YARD LANES, CHEST ROW and CLERK on Paper 1.21.8 -- the yard visit's OWN CODE (skills.mjs yardVisit
// and what it calls) driven in-process on real mineflayer bots. The yard itself (yard@2: the paved pad and its lights) is laid by RCON
// from the blueprint's own cells and its project record published as the build would (sandbox only); everything on it is the bots'.
// THE SERVER IS THE ORACLE: every lane slot, chest and bag is read with `execute if block` / `data get` before and after.
// skills.mjs keeps yardVisit private, so this file loads it through a module hook that APPENDS one export line to the source in memory
// (nothing under bots/ is edited or written).
//   node sandbox/bagfix/yard-e2e.mjs <scenario>        (from the worktree root; the caller holds the sandbox2 lock)
// A second and third bot are further processes of this file (--follower <name>), told what to do through files in the run's dir.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks, createRequire } from 'node:module'

const argv = process.argv.slice(2)
const SCEN = argv[0] ?? 'help'
const FOLLOWER = argv.includes('--follower') ? argv[argv.indexOf('--follower') + 1] : null
const NAME = FOLLOWER ?? 'sbx-YardA'
const HX = 3300, HY = 120, HZ = 3300, S = HY - 1
const AX = HX + 24, AZ = HZ - 13           // the yard's anchor: x AX..AX+17, z AZ..AZ+25 (yard@2, orient E)
const DIR = path.resolve('sandbox/log/yard', SCEN)
if (!FOLLOWER) fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(path.join(DIR, 'pool'), { recursive: true }); fs.mkdirSync(path.join(DIR, 'log-' + NAME), { recursive: true })
const ENVX = Object.fromEntries((process.env.YARD_E2E_ENV ?? '').split(';').filter(Boolean).map(kv => kv.split('=')))
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxyard', YARD: 'on', BAGROOM: 'on', WORLD_BORDER_RADIUS: '8000',
  LOG_DIR: path.join(DIR, 'log-' + NAME), STATE_DIR: path.join(DIR, 'state-' + NAME), POOL_STATE_DIR: path.join(DIR, 'pool'),
  HOME_X: String(HX), HOME_Y: String(HY), HOME_Z: String(HZ), BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer', ...ENVX,
})
const WANT = ['yardVisit', 'yardWorkNow', 'yardRecNow', 'yardsNow', 'yardKindNow', 'yardLaneOpts', 'townDir', 'projKeyOf', 'planHomeP', 'blueprintOf', 'planReader', 'heldMap', 'projectsOn',
  'yardRowPlanNow', 'yardRowsNow', 'yardRowStep', 'clerkPassNow', 'yardClerkPass', 'refillJobsNow', 'refillRaiseNow', 'refillCheck', 'withOverCap', 'yardHoldNow', 'townDeposit', 'matsTownStock', 'townIndexObserve', 'useNote', 'activeMem']
registerHooks({ load (url, context, nextLoad) {
  const r = nextLoad(url, context)
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${WANT.map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, B, PJ, Y] = await Promise.all(['skills.mjs', 'buildsite.mjs', 'buildproj.mjs', 'yard.mjs'].map(imp))
const E = SK.__e2e
const SERVER = 'sandbox2', PORT = 25600
const rcon = (...cmds) => {
  const res = []
  for (let i = 0; i < cmds.length; i += 400) {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/bagfix-rcon.py ${SERVER} -`], { input: cmds.slice(i, i + 400).join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
    let cur = null
    for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const fillAll = (x0, y0, z0, x1, y1, z1, block) => { const out = []; const per = Math.max(1, Math.floor(32000 / ((y1 - y0 + 1) * (z1 - z0 + 1)))); for (let x = x0; x <= x1; x += per) out.push(`fill ${x} ${y0} ${z0} ${Math.min(x1, x + per - 1)} ${y1} ${z1} minecraft:${block}`); return out }
const F = { x0: HX - 8, x1: HX + 50, z0: HZ - 24, z1: HZ + 24 }
const bp = B.loadBlueprint('yard@2')
const REC = { anchor: [AX, AZ], s: S, orient: 'E' }
const BAYS = Y.pileSlots(REC, bp)                       // the WHOLE bays (164 slots each), fill order
const KINDS = ['cobblestone', 'gravel', 'sand', 'andesite', 'diorite', 'granite', 'dirt', 'tuff', 'stone', 'chest', 'torch']
// THE SERVER'S COPY of a list of cells -> [name | 'air' | '?'] (two passes: air, then each kind for what is not air)
function worldOf (cells) {
  const air = rcon(...cells.map(c => `execute if block ${c[0]} ${c[1]} ${c[2]} minecraft:air`)).map(r => /passed/.test(r.reply))
  const out = air.map(a => (a ? 'air' : '?'))
  const idx = out.map((v, i) => (v === '?' ? i : -1)).filter(i => i >= 0)
  for (const k of KINDS) {
    const todo = idx.filter(i => out[i] === '?')
    if (!todo.length) break
    rcon(...todo.map(i => `execute if block ${cells[i][0]} ${cells[i][1]} ${cells[i][2]} minecraft:${k}`)).forEach((r, j) => { if (/passed/.test(r.reply)) out[todo[j]] = k })
  }
  return out
}
// the lanes as the server holds them -> per bay { id, held: { kind: n }, layers: [n at y S+1 ..], floating: cells with air under a block, rows: v-extent used }
function lanesOf () {
  const all = BAYS.flatMap(b => b.slots)
  const names = worldOf(all)
  const at = new Map(all.map((c, i) => [c.join(','), names[i]]))
  let i = 0
  return BAYS.map(b => {
    const held = {}, layers = [0, 0, 0, 0], floating = [], zs = new Set()
    for (const c of b.slots) {
      const n = names[i++]
      if (n === 'air') continue
      held[n] = (held[n] ?? 0) + 1; layers[c[1] - S - 1]++; zs.add(c[2])
      if (c[1] > S + 1 && at.get([c[0], c[1] - 1, c[2]].join(',')) === 'air') floating.push(c.join(','))
    }
    const z = [...zs].sort((a, c) => a - c)
    return { id: b.id, held, layers, rows: z.length ? `z ${z[0]}..${z[z.length - 1]} (${z.length} rows)` : '-', floating }
  })
}
const parse = reply0 => {
  const reply = String(reply0 ?? '').trim()
  const id = /id: "minecraft:(\w+)"/.exec(reply), n = /count: (\d+)/.exec(reply), sl = /Slot: (\d+)b/.exec(reply)
  return id ? { slot: sl ? Number(sl[1]) : null, id: id[1], count: n ? Number(n[1]) : 1 } : null
}
const bagOf = name => { const t = {}; for (const e of rcon(...Array.from({ length: 41 }, (_, i) => `data get entity ${name} Inventory[${i}]`)).map(r => parse(r.reply)).filter(Boolean)) t[e.id] = (t[e.id] ?? 0) + e.count; return t }
const chestOf = k => rcon(...Array.from({ length: 54 }, (_, i) => `data get block ${k[0]} ${k[1]} ${k[2]} Items[${i}]`)).map(r => parse(r.reply)).filter(Boolean)
const countOf = sel => { const m = /count: (\d+)/.exec(rcon(`execute if entity @e[${sel},x=${F.x0},y=${S - 4},z=${F.z0},dx=${F.x1 - F.x0},dy=30,dz=${F.z1 - F.z0}]`)[0].reply); return m ? Number(m[1]) : 0 }
const looseOf = () => ({ items: countOf('type=minecraft:item'), falling: countOf('type=minecraft:falling_block') })
const flag = (f, v) => fs.writeFileSync(path.join(DIR, f), typeof v === 'string' ? v : JSON.stringify(v))
const waitFlag = async (f, ms = 240000) => { const t = Date.now(); while (!fs.existsSync(path.join(DIR, f))) { if (Date.now() - t > ms) throw new Error('no ' + f); await sleep(100) } await sleep(50); return fs.readFileSync(path.join(DIR, f), 'utf8') }
const rowsOf = (name, since = 0) => {
  const out = []
  for (const f of fs.readdirSync(path.join(DIR, 'log-' + name)).filter(f => f.startsWith('skill-'))) {
    for (const l of fs.readFileSync(path.join(DIR, 'log-' + name, f), 'utf8').split('\n')) {
      try { const r = JSON.parse(l); if (Date.parse(r['@timestamp']) >= since && /^_(yard|refill|compact|use|clerk|town_deposit|build_visit|well)/.test(r.skill?.name ?? '') && !/_mode$/.test(r.skill.name)) out.push(`${r['@timestamp'].slice(11, 23)} ${r.skill.name} ${r.skill.status} | ${r.skill.detail}`) } catch { /* not a row */ }
    }
  }
  return out
}
// the leases still HELD: a lease file with no `.released` beside it
const leasesOf = () => { try { const fl = fs.readdirSync(path.join(DIR, 'pool')); return fl.filter(f => /\.lease\.g\d+\.json$/.test(f) && !fl.includes(f + '.released')).map(f => f.replace(/^project-[-\d_]+\./, '')) } catch { return [] } }

async function join () {
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  bot._client.on('login', p => { bot.worldId = p?.worldName ?? 'sbx' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  ;(await imp('craftsync.mjs')).installCraftSync(bot, { log: () => {} })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  try { SK.yardLanesInstall(bot) } catch (e) { P('yardLanesInstall threw', e.message) }
  return bot
}
// ONE YARD VISIT, as buildShop's hand-off makes it (a bounded pass); `abortMs` interrupts it
async function visit (bot, { draw = 0, abortMs = 0, plot = 'yard' } = {}) {
  const h = PJ.recordHead(E.townDir(), E.projKeyOf(plot))
  if (!h.ok || !h.head) return { status: 'no_record' }
  const ac = new AbortController(), t0 = Date.now()
  let timer = null; if (abortMs) timer = setTimeout(() => ac.abort(), abortMs)
  const out = (status, outcome, detail, extra = {}) => ({ status, outcome, detail, ...extra })
  const result = {}
  let r
  try { r = await E.yardVisit({ bot }, h.head.rec, h.head.gen, ac.signal, out, t0, { plot, ...(draw ? { draw, until: t0 + 60_000, result } : { until: t0 + Y.LANES.passMs }) }) } catch (e) { r = { status: 'threw', detail: String(e?.message ?? e).slice(0, 160), aborted: ac.signal.aborted } }
  clearTimeout(timer)
  return { ...r, ...(draw ? { got: result.got ?? null } : {}), ms: Date.now() - t0, rows: rowsOf(NAME, t0).filter(x => / _yard /.test(x) || /_yard_/.test(x)).map(x => x.slice(13, 330)), leasesAfter: leasesOf() }
}

// ---- a follower: joins, says ready, then does each `cmd-<n>` file in turn ({ do: 'visit', opts, at }) and writes `res-<name>-<n>.json`
async function follower () {
  const bot = await join()
  flag(`ready-${NAME}`, 1)
  for (let n = 1; ; n++) {
    const cmd = JSON.parse(await waitFlag(`cmd-${NAME}-${n}`, 900000))
    if (cmd.do === 'quit') break
    await sleep(Math.max(0, (cmd.at ?? 0) - Date.now()))
    bot.yardRestUntil = 0; bot.yardsMemo = null
    const r = cmd.do === 'visit' ? await visit(bot, cmd.opts ?? {}) : { status: 'unknown' }
    flag(`res-${NAME}-${n}.json`, r)
  }
  bot.quit(); await sleep(300); process.exit(0)
}

const H = {}   // the lead's helpers for scenarios
const followers = new Map()
H.spawn = async name => { const ch = spawn(process.execPath, [process.argv[1], SCEN, '--follower', name], { stdio: 'inherit', env: { ...process.env, BOT_NAME: name } }); followers.set(name, { ch, n: 0 }); await waitFlag(`ready-${name}`); rcon(`gamemode survival ${name}`, `clear ${name}`, `tp ${name} ${HX + 0.5 + followers.size} ${HY} ${HZ + 0.5 + followers.size}`); await sleep(1500) }
H.tell = (name, cmd) => { const f = followers.get(name); f.n++; flag(`cmd-${name}-${f.n}`, cmd); return async () => JSON.parse(await waitFlag(`res-${name}-${f.n}.json`, 400000)) }
H.give = (name, items) => rcon(...Object.entries(items).flatMap(([it, n]) => { const o = []; let left = n; while (left > 0) { const k = Math.min(64, left); o.push(`give ${name} minecraft:${it} ${k}`); left -= k } return o }))
H.reset = name => rcon(`clear ${name}`, `tp ${name} ${HX + 0.5} ${HY} ${HZ + 0.5}`)
H.snap = (names = [NAME]) => ({ lanes: lanesOf(), bags: Object.fromEntries(names.map(n => [n, bagOf(n)])), loose: looseOf() })
H.show = (label, s) => { P(label, 'lanes', s.lanes.map(l => `bay${l.id} ${JSON.stringify(l.held)} layers ${l.layers} ${l.rows}${l.floating.length ? ' FLOATING ' + l.floating.slice(0, 4) : ''}`).join(' | ')); P(label, 'bags', s.bags, 'loose', s.loose) }
H.step = async (R, label, bot, fn, names = [NAME]) => {
  const before = H.snap(names); H.show(`${label} BEFORE`, before)
  bot.yardRestUntil = 0; bot.yardsMemo = null
  const res = await fn()
  await sleep(2500)
  const after = H.snap(names); H.show(`${label} AFTER `, after)
  const tot = s => { const t = {}; for (const l of s.lanes) for (const [k, v] of Object.entries(l.held)) t[k] = (t[k] ?? 0) + v; for (const b of Object.values(s.bags)) for (const [k, v] of Object.entries(b)) t[k] = (t[k] ?? 0) + v; return t }
  const tb = tot(before), ta = tot(after)
  const conserved = [...new Set([...Object.keys(tb), ...Object.keys(ta)])].filter(k => KINDS.includes(k) && k !== 'torch').every(k => (tb[k] ?? 0) === (ta[k] ?? 0)) && after.loose.items === 0
  const floating = after.lanes.flatMap(l => l.floating)
  for (const [who, r] of Object.entries(res)) { P(`${label} ${who}:`, { status: r.status, outcome: r.outcome, detail: r.detail, stop: r.stop, ms: r.ms, got: r.got, leasesAfter: r.leasesAfter }); for (const x of r.rows ?? []) P(`   ${who} row`, x) }
  P(`${label} CONSERVED`, conserved, 'floating', floating.length, 'falling entities', after.loose.falling, 'items on the ground', after.loose.items)
  R.steps.push({ label, before, after, conserved, floating, res })
  return { before, after, res }
}

const kindNow = (bot, name) => { try { bot.yardsMemo = null; const k = E.yardKindNow(bot, name); return { room: k.room, over: !!k.over, lanes: k.lanes, cap: k.cap } } catch (e) { return 'threw ' + e.message } }
const SCENARIOS = {
  // 1, 2, 4 in order: one lane a kind (16 of each first), gravel to 52 and past it, sand on sand, a fourth kind, a fifth with no lane left
  async lanes2 (bot, R) {
    H.give(NAME, { cobblestone: 80 }); await sleep(2500)
    await H.step(R, '1 cobblestone 80 (keep 64): 16 into the first lane', bot, async () => ({ A: await visit(bot) }))
    H.give(NAME, { gravel: 52 }); await sleep(2500)
    await H.step(R, '2 gravel 52: a second lane, layer on layer', bot, async () => ({ A: await visit(bot) }))
    H.give(NAME, { gravel: 40 }); await sleep(2500)
    P('gravel now', kindNow(bot, 'gravel'))
    await H.step(R, '4 gravel 40 more: the lane grows', bot, async () => ({ A: await visit(bot) }))
    await H.step(R, '4b gravel: what is left', bot, async () => ({ A: await visit(bot) }))
    H.give(NAME, { sand: 72 }); await sleep(2500)
    await H.step(R, '2 sand 72 (keep 8): a third lane', bot, async () => ({ A: await visit(bot) }))
    H.give(NAME, { andesite: 64 }); await sleep(2500)
    await H.step(R, '1 andesite 64: the fourth lane', bot, async () => ({ A: await visit(bot) }))
    H.give(NAME, { diorite: 64 }); await sleep(2500)
    P('diorite now (no lane left in this yard)', kindNow(bot, 'diorite'))
    await H.step(R, '1 diorite 64: every lane taken', bot, async () => ({ A: await visit(bot) }))
    R.kinds = Object.fromEntries(['cobblestone', 'gravel', 'sand', 'andesite', 'diorite'].map(k => [k, kindNow(bot, k)])); P('kinds', R.kinds)
  },
  // 3: two bots, two lanes at once; a third wanting the lane another holds; an abort releases its leases
  async two (bot, R) {
    await H.spawn('sbx-YardB'); await H.spawn('sbx-YardC')
    const all = [NAME, 'sbx-YardB', 'sbx-YardC']
    H.give(NAME, { cobblestone: 112 }); H.give('sbx-YardB', { gravel: 48 }); H.give('sbx-YardC', { cobblestone: 112 }); await sleep(3000)
    await H.step(R, '3 A cobblestone 48, B gravel 48, C cobblestone 48, all at once', bot, async () => { const at = Date.now() + 1500; const b = H.tell('sbx-YardB', { do: 'visit', at }), c = H.tell('sbx-YardC', { do: 'visit', at }); await sleep(at - Date.now()); const [A, B, C] = await Promise.all([visit(bot), b(), c()]); return { A, B, C } }, all)
    P('leases held after the three visits', leasesOf())
    H.give(NAME, { cobblestone: 64 }); await sleep(2500)
    await H.step(R, '3 A interrupted 6 s into a stock visit', bot, async () => ({ A: await visit(bot, { abortMs: 6000 }) }), all)
    R.leasesAfterAbort = leasesOf(); P('leases held after the interrupt', R.leasesAfterAbort)
    await H.step(R, '3 A again after the interrupt', bot, async () => ({ A: await visit(bot) }), all)
    R.leasesEnd = leasesOf(); P('leases held at the end', R.leasesEnd)
  },
  // 5: a kind at its cap (YARD_LANE_CAPS=andesite:1, its one lane filled to the bay's 164 by RCON) banks nothing more; a kind with
  // room is the yard's. The well itself is not built here: the hold's inputs and the over-cap row are read through the code's own calls.
  async cap (bot, R) {
    rcon(...BAYS[0].slots.map(c => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:andesite`))
    H.give(NAME, { andesite: 96, gravel: 64 }); await sleep(3000)
    R.before = { andesite: kindNow(bot, 'andesite'), gravel: kindNow(bot, 'gravel') }; P('5 kinds before', R.before)
    await H.step(R, '5 andesite 96 with its one lane full (cap 1), gravel 64 with room', bot, async () => ({ A: await visit(bot) }))
    R.after = { andesite: kindNow(bot, 'andesite'), gravel: kindNow(bot, 'gravel') }; P('5 kinds after', R.after)
    R.hold = { andesite: Y.wellHold({ room: R.after.andesite.room, holdAt: null, stockAt: bot.yardStockAt ?? null }), gravel: Y.wellHold({ room: R.after.gravel.room, holdAt: null, stockAt: null }) }; P('5 wellHold from those rooms', R.hold)
    // the over-cap row: a run that throws andesite out of the bag (the well's dispose would), wrapped as the well's run is
    const t = Date.now()
    await E.withOverCap({ bot }, async () => { const it = bot.inventory.items().find(i => i.name === 'andesite'); if (it) await bot.toss(it.type, null, 32) ; await sleep(800) })
    R.overCapRows = rowsOf(NAME, t); P('5 rows after a wrapped throw of 32 andesite', R.overCapRows)
    await sleep(1500); rcon(`kill @e[type=minecraft:item,x=${F.x0},y=${S - 4},z=${F.z0},dx=${F.x1 - F.x0},dy=30,dz=${F.z1 - F.z0}]`)
  },
  // 1 (+2, +4): cobblestone into a lane; gravel opens a second and fills its 52 (layers on layers); the next visit reads 16 rows and
  // goes on; sand opens a third; a cobblestone draw from the top
  async lanes (bot, R) {
    H.give(NAME, { cobblestone: 192, iron_pickaxe: 1 }); await sleep(2500)
    await H.step(R, '1a cobblestone 192 held (keep 64)', bot, async () => ({ A: await visit(bot) }))
    H.give(NAME, { gravel: 64 }); await sleep(2500)
    await H.step(R, '1b/2 gravel 64: a second lane, 52 slots of 8 rows', bot, async () => ({ A: await visit(bot) }))
    await H.step(R, '4 gravel: the lane full at 52 reads longer; the rest goes on the new rows', bot, async () => ({ A: await visit(bot) }))
    H.give(NAME, { sand: 72 }); await sleep(2500)
    await H.step(R, '1c/2 sand 72 (keep 8): a third lane', bot, async () => ({ A: await visit(bot) }))
    await H.step(R, '2 a DRAW of 16 cobblestone from the top of its lane', bot, async () => ({ A: await visit(bot, { draw: 16 }) }))
  },
}

async function main () {
  if (!SCENARIOS[SCEN]) { console.log('scenarios:', Object.keys(SCENARIOS).join(', ')); process.exit(2) }
  P(SCEN, 'lanes', Y.lanesModeDetail(Y.LANES))
  rcon(`forceload add ${F.x0} ${F.z0} ${F.x1} ${F.z1}`, 'gamerule doTileDrops true')
  rcon(...fillAll(F.x0, S - 3, F.z0, F.x1, S - 1, F.z1, 'dirt'), ...fillAll(F.x0, S, F.z0, F.x1, S, F.z1, 'grass_block'), ...fillAll(F.x0, S + 1, F.z0, F.x1, S + 14, F.z1, 'air'),
    `kill @e[type=minecraft:item,x=${F.x0},y=${S - 4},z=${F.z0},dx=${F.x1 - F.x0},dy=30,dz=${F.z1 - F.z0}]`)
  // THE YARD: the blueprint's own cells (the paved pad, then the lights), each its role's first block; the record as the build leaves it
  const cells = B.placeBlueprint(bp, { x: AX, z: AZ }, S, 'E').map(c => ({ at: c.at, role: c.role, seg: c.seg, ...(c.ws ? { ws: c.ws } : {}) }))
  const order = [...cells].sort((a, c) => a.at[1] - c.at[1])
  const bad = rcon(...order.map(c => `setblock ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${bp.palette[c.role][0]}`)).filter(r => !/Changed the block|Could not set/.test(r.reply))
  if (bad.length) P('YARD SETBLOCK REPLIES TO READ', bad.slice(0, 5))
  const home = { x: HX, y: HY, z: HZ }
  const rec0 = { v: 1, blueprint: bp.id, plot: 'yard', home, anchor: [AX, AZ], s: S, orient: 'E', band: 44, cells, segments: bp.segments.map(s => ({ seg: s.seg, deps: s.deps })), palette: bp.palette, clear: [], replant: [], zones: [], builders_max: 1, structure_complete: true, state: 'open' }
  const bot = await join()
  const pub = PJ.publishRecord(E.townDir(), E.projKeyOf('yard'), () => rec0, { by: NAME })
  rcon(`gamemode survival ${NAME}`); H.reset(NAME); await sleep(3000)
  await bot.waitForChunksToLoad()
  P('record', pub.result, 'projectsOn has yard:', (() => { try { return E.projectsOn().some(p => p.plot === 'yard') } catch (e) { return 'threw ' + e.message } })(), 'yardsNow', (() => { try { return E.yardsNow(bot).map(y => `${y.plot}:${y.states.map(s => `${s.id}/${s.name}/${s.filled}/${s.free}`).join(',')}`) } catch (e) { return 'threw ' + e.message } })())
  const R = { scenario: SCEN, lanes: Y.lanesModeDetail(Y.LANES), env: ENVX, steps: [] }
  let err = null
  try { await SCENARIOS[SCEN](bot, R) } catch (e) { err = e; P('SCENARIO FAILED', e.stack) }
  fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(R, null, 1))
  for (const [name, f] of followers) { try { f.n++; flag(`cmd-${name}-${f.n}`, { do: 'quit' }) } catch { /* gone */ } }
  rcon(`clear ${NAME}`, ...[...followers.keys()].map(n => `clear ${n}`))
  bot.quit(); await sleep(1500)
  for (const [, f] of followers) await new Promise(res => { f.ch.once('exit', res); setTimeout(() => { try { f.ch.kill() } catch { /* gone */ } res() }, 6000) })
  if (process.env.KEEP !== '1') rcon(`kill @e[type=minecraft:item,x=${F.x0},y=${S - 4},z=${F.z0},dx=${F.x1 - F.x0},dy=30,dz=${F.z1 - F.z0}]`, ...fillAll(F.x0, S, F.z0, F.x1, S + 14, F.z1, 'air'), `forceload remove ${F.x0} ${F.z0} ${F.x1} ${F.z1}`)
  process.exit(err ? 1 : 0)
}
(FOLLOWER ? follower() : main()).catch(e => { P('FAIL', e.stack); process.exit(1) })
