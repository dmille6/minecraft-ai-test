// SANDBOX-ONLY (sandbox2): bagfix-01's MERGE-ON-DEPOSIT on Paper 1.21.8 -- the town deposit's OWN CODE (skills.mjs town_deposit ->
// bankInto -> verifyTown) driven in-process on a real mineflayer bot, one case a process. RCON builds the arena, fills the chest slot
// by slot and gives the bag (sandbox only); THE SERVER IS THE ORACLE: the chest's Items and the player's Inventory are read from the
// server before and after (`data get`), never from the bot's belief. Every window click the client sends is recorded.
//   node sandbox/bagfix/merge-e2e.mjs <case>            (run from the worktree root; the caller holds the sandbox2 lock)
//   node sandbox/bagfix/merge-e2e.mjs list
// Two-bot cases start a second process of this file themselves (--follower). Results: sandbox/log/bagfix/<case>/result.json
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const X = 3100, Y = 120, Z = 3100
const C1 = [X, Y + 1, Z - 2], C2 = [X + 3, Y + 1, Z - 2]
const FILL = 'stone_bricks'
const NAMED = 'coal[custom_name="Marked"]', ENCH = 'coal[enchantments={"minecraft:unbreaking":1}]'
// chest spec: { set: [[slot, item, count]...], empty: [slots left empty] } -- every other slot holds 64 of FILL
const CASES = {
  merge1:      { what: '1 merge onto one partial', c1: { set: [[4, 'coal', 20]] }, bag: [['coal', 30]] },
  merge1off:   { what: 'control: case 1 with BAGFIX_MERGE=off', env: { BAGFIX_MERGE: 'off' }, c1: { set: [[4, 'coal', 20]] }, bag: [['coal', 30]] },
  merge1offempty: { what: 'control: BAGFIX_MERGE=off, a partial AND one empty slot', env: { BAGFIX_MERGE: 'off' }, c1: { set: [[4, 'coal', 20]], empty: [26] }, bag: [['coal', 30]] },
  merge3:      { what: '2 merge across three partials (the room bank: moss)', args: { room: true }, c1: { set: [[2, 'moss_block', 60], [9, 'moss_block', 60], [20, 'moss_block', 10]] }, bag: [['moss_block', 60]] },
  merge3coal:  { what: '2 merge across three partials (coal)', c1: { set: [[2, 'coal', 60], [9, 'coal', 60], [20, 'coal', 10]] }, bag: [['coal', 60]] },
  merge3lit:   { what: '2 as written: 60, 60, 10 and a stack of 64 (room for 62): nothing moves', c1: { set: [[2, 'coal', 60], [9, 'coal', 60], [20, 'coal', 10]] }, bag: [['coal', 64]] },
  mergeplus:   { what: '2b partials then an empty slot for the rest', args: { room: true }, c1: { set: [[2, 'moss_block', 60], [9, 'moss_block', 60]], empty: [26] }, bag: [['moss_block', 64]] },
  nofit:       { what: '3 does not fit: nothing moves', c1: { set: [[4, 'coal', 60]] }, bag: [['coal', 30]] },
  pick:        { what: '4a a damaged pickaxe in the chest, undamaged in the bag, no empty slot', c1: { set: [[0, 'iron_pickaxe[damage=100]', 1]] }, bag: [['iron_pickaxe', 1], ['iron_pickaxe', 1]] },
  namedchest:  { what: '4b a NAMED coal stack in the chest, plain coal in the bag', c1: { set: [[4, NAMED, 20]] }, bag: [['coal', 30]] },
  namedbag:    { what: '4c plain coal in the chest, a NAMED coal stack in the bag', c1: { set: [[4, 'coal', 20]] }, bag: [[NAMED, 30]] },
  enchchest:   { what: '4d an ENCHANTED coal stack in the chest, plain coal in the bag', c1: { set: [[4, ENCH, 20]] }, bag: [['coal', 30]] },
  mixed:       { what: '4e a named partial BEFORE a plain partial: the plain one takes it', c1: { set: [[3, NAMED, 20], [12, 'coal', 20]] }, bag: [['coal', 30]] },
  remembered:  { what: '5a remembered full (a first visit that fits nothing), then a stack its partial takes', c1: { set: [[4, 'coal', 20], [5, 'copper_ingot', 60]] }, bag: [['copper_ingot', 30]], then: [['coal', 30]] },
  max3:        { what: '2c four partials, the stack needs all four: MERGE_MAX 3, nothing moves', args: { room: true }, c1: { set: [[1, 'moss_block', 62], [2, 'moss_block', 62], [3, 'moss_block', 62], [4, 'moss_block', 62]] }, bag: [['moss_block', 8]] },
  stack16:     { what: '3b a 16-stack item onto a partial that cannot take it all, no empty slot', args: { room: true }, c1: { set: [[4, 'snowball', 10]] }, bag: [['snowball', 16]] },
  stack16fit:  { what: '3c a 16-stack item onto a partial that takes it all', args: { room: true }, c1: { set: [[4, 'snowball', 4]] }, bag: [['snowball', 12]] },
  stack16empty: { what: '3d a 16-stack item, a partial and one empty slot', args: { room: true }, c1: { set: [[4, 'snowball', 10]], empty: [26] }, bag: [['snowball', 16]] },
  pickempty:   { what: '4f a damaged pickaxe in the chest and one empty slot: the spare goes into the empty slot', c1: { set: [[0, 'iron_pickaxe[damage=100]', 1]], empty: [26] }, bag: [['iron_pickaxe', 1], ['iron_pickaxe', 1]] },
  namedbagempty: { what: '4g a NAMED coal stack in the bag, plain partial and one empty slot', c1: { set: [[4, 'coal', 20]], empty: [26] }, bag: [[NAMED, 30]] },
  fullnext:    { what: '5b a truly full chest, then a second chest with a partial', c1: { set: [] }, c2: { set: [[7, 'coal', 20]] }, bag: [['coal', 30]] },
  fullonly:    { what: '5c a truly full chest and no other', c1: { set: [] }, bag: [['coal', 30]] },
  two_fit:     { what: '6a two bots, one partial, both fit', two: true, c1: { set: [[4, 'coal', 10]] }, bag: [['coal', 20]], bagB: [['coal', 20]] },
  two_over:    { what: '6b two bots, one partial, only one fits; then A deposits again', two: true, again: true, c1: { set: [[4, 'coal', 40]] }, bag: [['coal', 20]], bagB: [['coal', 20]] },
  two_three:   { what: '6c two bots, three partials, a stack each', two: true, again: true, c1: { set: [[2, 'coal', 50], [9, 'coal', 50], [20, 'coal', 10]] }, bag: [['coal', 40]], bagB: [['coal', 40]] },
  two_over_empty: { what: '6d two bots, one partial and one empty slot', two: true, again: true, c1: { set: [[4, 'coal', 40]], empty: [26] }, bag: [['coal', 20]], bagB: [['coal', 20]] },
  abort1:      { what: '7a interrupted after the pickup click', abortAfter: 1, c1: { set: [[2, 'coal', 60], [9, 'coal', 60], [20, 'coal', 10]] }, bag: [['coal', 60]] },
  abort2:      { what: '7b interrupted after the first merge click', abortAfter: 2, c1: { set: [[2, 'coal', 60], [9, 'coal', 60], [20, 'coal', 10]] }, bag: [['coal', 60]] },
  abort3:      { what: '7c interrupted after the second merge click', abortAfter: 3, c1: { set: [[2, 'coal', 60], [9, 'coal', 60], [20, 'coal', 10]] }, bag: [['coal', 60]] },
  chests13:    { what: 'carried chests: 13 held, banked in halves, one stays', c1: { set: [], empty: [20, 21, 22, 23, 24, 25, 26] }, bag: [['chest', 13]] },
}
const argv = process.argv.slice(2)
if (argv[0] === 'list' || !CASES[argv[0]]) { for (const [k, c] of Object.entries(CASES)) console.log(k.padEnd(16), c.what); process.exit(argv[0] === 'list' ? 0 : 2) }
const CASE = argv[0], DEF = CASES[CASE], FOLLOWER = argv.includes('--follower')
const NAME = FOLLOWER ? 'sbx-BagB' : 'sbx-BagA', OTHER = 'sbx-BagB'
const DIR = path.resolve('sandbox/log/bagfix', CASE)
if (!FOLLOWER) { fs.rmSync(DIR, { recursive: true, force: true }) }
fs.mkdirSync(path.join(DIR, 'pool'), { recursive: true }); fs.mkdirSync(path.join(DIR, 'log-' + NAME), { recursive: true })
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxbag', BAGROOM: 'on',
  LOG_DIR: path.join(DIR, 'log-' + NAME), STATE_DIR: path.join(DIR, 'state-' + NAME), POOL_STATE_DIR: path.join(DIR, 'pool'),
  HOME_X: String(X), HOME_Y: String(Y + 1), HOME_Z: String(Z), BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer', ...(DEF.env ?? {}),
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const TD = await import(path.join(BOTS, 'src/towndeposit.mjs'))
const BF = await import(path.join(BOTS, 'src/bagfix.mjs'))
const SERVER = 'sandbox2', PORT = 25600
const rcon = (...cmds) => {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/bagfix-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const parse = reply0 => {
  const reply = String(reply0 ?? '').trim()
  const id = /id: "minecraft:(\w+)"/.exec(reply), n = /count: (\d+)/.exec(reply), sl = /Slot: (\d+)b/.exec(reply)
  if (!id) return null
  // a player's entry reads {Slot, components, count, id}; a chest's {Slot, id, count, components} and the server cuts a long one with "..."
  let comp = /components: \{(.*)$/.exec(reply)?.[1] ?? ''
  if (comp.includes('}, count:')) comp = comp.slice(0, comp.indexOf('}, count:'))
  return { slot: sl ? Number(sl[1]) : null, id: id[1], count: n ? Number(n[1]) : 1, comp: comp.replace(/[}.]+$/, ''), raw: reply.replace(/^.*?data: /, '') }
}
// THE SERVER'S COPY: a chest slot by slot, a player's inventory entry by entry, and the item entities lying about the arena
const chestOf = k => rcon(...Array.from({ length: 27 }, (_, i) => `data get block ${k[0]} ${k[1]} ${k[2]} Items[${i}]`)).map(r => parse(r.reply)).filter(Boolean).sort((a, b) => a.slot - b.slot)
const bagOf = name => rcon(...Array.from({ length: 41 }, (_, i) => `data get entity ${name} Inventory[${i}]`)).map(r => parse(r.reply)).filter(Boolean).sort((a, b) => a.slot - b.slot)
const groundOf = () => { const m = /count: (\d+)/.exec(rcon(`execute if entity @e[type=minecraft:item,x=${X},y=${Y + 1},z=${Z},distance=..14]`)[0].reply); return m ? Number(m[1]) : 0 }
const key = e => e.id + (e.comp ? `{${e.comp}}` : '')
const show = list => list.filter(e => e.id !== FILL).map(e => `${e.slot}:${key(e)}x${e.count}`).join(' ') || '-'
const shape = list => `${show(list)} | ${FILL} slots ${list.filter(e => e.id === FILL).length}, empty ${27 - list.length}`
const totals = (...lists) => { const t = {}; for (const l of lists) for (const e of l) if (e.id !== FILL) t[key(e)] = (t[key(e)] ?? 0) + e.count; return t }
const fillChest = (k, spec) => {
  const set = new Map((spec.set ?? []).map(([s, it, n]) => [s, [it, n]])), empty = new Set(spec.empty ?? [])
  return [`setblock ${k[0]} ${k[1]} ${k[2]} minecraft:air`, `setblock ${k[0]} ${k[1]} ${k[2]} minecraft:chest[facing=south]`,
    ...Array.from({ length: 27 }, (_, s) => (empty.has(s) ? null : set.has(s) ? `item replace block ${k[0]} ${k[1]} ${k[2]} container.${s} with minecraft:${set.get(s)[0]} ${set.get(s)[1]}` : `item replace block ${k[0]} ${k[1]} ${k[2]} container.${s} with minecraft:${FILL} 64`)).filter(Boolean)]
}
const wipe = `fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y + 6} ${Z + 6} minecraft:air`
const flag = (f, v) => fs.writeFileSync(path.join(DIR, f), String(v))
const waitFlag = async (f, ms = 90000) => { const t = Date.now(); while (!fs.existsSync(path.join(DIR, f))) { if (Date.now() - t > ms) throw new Error('no ' + f); await sleep(100) } return fs.readFileSync(path.join(DIR, f), 'utf8') }

async function join () {
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  bot._client.on('login', p => { bot.worldId = p?.worldName ?? 'sbx' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  ;(await import(path.join(BOTS, 'src/craftsync.mjs'))).installCraftSync(bot, { log: () => {} })   // as index.mjs does at spawn: the clicks in lockstep
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  // EVERY CLICK THE CLIENT SENDS, with the cursor the client held after its own prediction of that click
  bot.clicks = []
  const write = bot._client.write.bind(bot._client)
  bot._client.write = (name, data) => {
    if (name === 'window_click') {
      const cur = bot.currentWindow?.selectedItem
      bot.clicks.push({ t: Date.now(), win: data.windowId, slot: data.slot, button: data.mouseButton, mode: data.mode, clientCursor: cur ? `${cur.name}x${cur.count}` : null })
      bot.onClick?.(bot.clicks.length)
    }
    if (name === 'close_window') bot.clicks.push({ t: Date.now(), close: data.windowId })
    return write(name, data)
  }
  return bot
}
const rowsOf = name => {
  const out = []
  for (const f of fs.readdirSync(path.join(DIR, 'log-' + name)).filter(f => f.startsWith('skill-'))) {
    for (const l of fs.readFileSync(path.join(DIR, 'log-' + name, f), 'utf8').split('\n')) {
      try { const r = JSON.parse(l); if (['_town_deposit', '_junkout', '_stock_refused', '_town_memory', '_cursor_settle', '_withdraw_hold'].includes(r.skill?.name) || /cursor|unsettled/.test(r.skill?.name ?? '')) out.push(`${r['@timestamp'].slice(11, 23)} ${r.skill.name} ${r.skill.status} | ${r.skill.detail}`) } catch { /* not a row */ }
    }
  }
  return out
}
async function deposit (bot, label) {
  const ac = new AbortController()
  if (DEF.abortAfter) bot.onClick = n => { if (n === DEF.abortAfter) setTimeout(() => ac.abort(), 0) }
  const plan = TD.townDepositPlan(bot.inventory.items(), { wanted: [], noSwords: true, ...(DEF.args?.room ? { room: true } : {}) }).steps.map(s => `${s.name}x${s.count}${s.half ? '(half)' : ''}@${s.slot}`)
  const c0 = bot.clicks.length, t = Date.now()
  let res
  try { const r = await SK.SKILLS.town_deposit.run({ bot }, { ...(DEF.args ?? {}) }, ac.signal); res = { status: r.status, detail: r.detail } } catch (e) { res = { threw: String(e?.message ?? e).slice(0, 200), aborted: !!(e?.aborted || ac.signal.aborted) } }
  const ms = Date.now() - t
  const clicks = bot.clicks.slice(c0)
  const tc = clicks.filter(c => c.slot != null)
  return { label, plan, ...res, ms, clickMs: tc.length ? tc[tc.length - 1].t - tc[0].t : 0, clicks: clicks.map(c => (c.close != null ? `close(win ${c.close})` : `+${c.t - t}ms slot ${c.slot} button ${c.button} mode ${c.mode} client_cursor_after ${c.clientCursor ?? 'empty'}`)),
           cursorAfter: bot.currentWindow?.selectedItem ? 'WINDOW OPEN, CURSOR HELD' : bot.inventory.selectedItem ? `${bot.inventory.selectedItem.name}x${bot.inventory.selectedItem.count}` : 'empty', windowOpen: !!bot.currentWindow }
}

async function follower () {
  const bot = await join()
  flag('ready-B', 1)
  const go = Number(await waitFlag('go'))
  await sleep(Math.max(0, go - Date.now()))
  const r = await deposit(bot, 'B')
  fs.writeFileSync(path.join(DIR, 'res-B.json'), JSON.stringify(r))
  await waitFlag('done', 60000).catch(() => {})
  bot.quit(); await sleep(300); process.exit(0)
}

async function main () {
  P(CASE, DEF.what, 'switches', BF.bagfixModeDetail())
  rcon(`forceload add ${X - 8} ${Z - 8} ${X + 8} ${Z + 8}`, wipe, `fill ${X - 5} ${Y} ${Z - 4} ${X + 5} ${Y} ${Z + 4} minecraft:stone`,
    `fill ${X - 4} ${Y + 1} ${Z - 3} ${X + 4} ${Y + 3} ${Z - 3} minecraft:stone_bricks`, `kill @e[type=minecraft:item,x=${X},y=${Y + 1},z=${Z},distance=..14]`)
  const setup = [...fillChest(C1, DEF.c1), ...(DEF.c2 ? fillChest(C2, DEF.c2) : [])].map(c => rcon(c)[0]).filter(r => !/Replaced a slot|Changed the block|Could not set the block/.test(r.reply))
  if (setup.length) P('SETUP REPLIES TO READ', setup)
  const bot = await join()
  let child = null
  if (DEF.two) { child = spawn(process.execPath, [process.argv[1], CASE, '--follower'], { stdio: 'inherit' }); await waitFlag('ready-B') }
  const give = (name, bag) => bag.map(([it, n]) => `give ${name} minecraft:${it} ${n}`)
  const prep = rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`, ...give(NAME, DEF.bag),
    ...(DEF.two ? [`gamemode survival ${OTHER}`, `clear ${OTHER}`, `tp ${OTHER} ${X - 0.5} ${Y + 1} ${Z + 0.5}`, ...give(OTHER, DEF.bagB)] : []))
  const bad = prep.filter(r => /Unknown|Incorrect|Expected|No player|Invalid/.test(r.reply)); if (bad.length) P('PREP REPLIES TO READ', bad)
  await sleep(3000)
  const R = { case: CASE, what: DEF.what, env: DEF.env ?? {}, switches: BF.bagfixModeDetail(), runs: [] }
  const read = () => ({ c1: chestOf(C1), c2: DEF.c2 ? chestOf(C2) : [], bagA: bagOf(NAME), bagB: DEF.two ? bagOf(OTHER) : [], ground: groundOf() })
  const stages = [null, ...(DEF.then ? [DEF.then] : []), ...(DEF.again ? ['again'] : [])]
  for (const more of stages) {
    if (more === 'again') await sleep(6000); else if (more) { rcon(...give(NAME, more)); await sleep(2500) }
    const before = read()
    let rA, rB = null
    if (DEF.two && more !== 'again') {
      const go = Date.now() + 2500; flag('go', go); await sleep(go - Date.now())
      rA = await deposit(bot, 'A'); rB = JSON.parse(await waitFlag('res-B.json', 120000))
    } else rA = await deposit(bot, 'A')
    await sleep(2000)
    const after = read()
    const tb = totals(before.c1, before.c2, before.bagA, before.bagB), ta = totals(after.c1, after.c2, after.bagA, after.bagB)
    const names = [...new Set([...Object.keys(tb), ...Object.keys(ta)])]
    const conserved = names.every(n => (tb[n] ?? 0) === (ta[n] ?? 0)) && after.ground === 0
    const fillMoved = before.c1.filter(e => e.id === FILL).length !== after.c1.filter(e => e.id === FILL).length || after.bagA.some(e => e.id === FILL) || after.bagB.some(e => e.id === FILL)
    const run = { stage: more ? 'then ' + JSON.stringify(more) : 'first', windowOpenBefore: null, before: { c1: shape(before.c1), ...(DEF.c2 ? { c2: shape(before.c2) } : {}), bagA: show(before.bagA), ...(DEF.two ? { bagB: show(before.bagB) } : {}) },
                  after: { c1: shape(after.c1), ...(DEF.c2 ? { c2: shape(after.c2) } : {}), bagA: show(after.bagA), ...(DEF.two ? { bagB: show(after.bagB) } : {}), ground: after.ground },
                  totalsBefore: tb, totalsAfter: ta, conserved, fillerMoved: fillMoved, A: rA, ...(rB ? { B: rB } : {}), rowsA: rowsOf(NAME), ...(DEF.two ? { rowsB: rowsOf(OTHER) } : {}) }
    R.runs.push(run)
    run.rawAfter = [...after.c1, ...after.c2, ...after.bagA, ...after.bagB].filter(e => e.id !== FILL).map(e => e.raw); P('RAW AFTER', run.rawAfter)
    P('BEFORE', run.before); P('AFTER ', run.after); P('CONSERVED', conserved, 'filler moved', fillMoved, 'totals', tb, '->', ta)
    P('A', { plan: rA.plan, status: rA.status, detail: rA.detail, threw: rA.threw, ms: rA.ms, clickMs: rA.clickMs, cursorAfter: rA.cursorAfter }); for (const c of rA.clicks) P('   A click', c)
    if (rB) { P('B', { plan: rB.plan, status: rB.status, detail: rB.detail, threw: rB.threw, ms: rB.ms, clickMs: rB.clickMs, cursorAfter: rB.cursorAfter }); for (const c of rB.clicks) P('   B click', c) }
    for (const r of run.rowsA.slice(-4)) P('   A row', r.slice(0, 420))
    for (const r of (run.rowsB ?? []).slice(-4)) P('   B row', r.slice(0, 420))
  }
  try { R.memory = fs.readdirSync(path.join(DIR, 'pool')).filter(f => /town|memory|index/i.test(f)) } catch { /* none */ }
  fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(R, null, 1))
  flag('done', 1)
  rcon(`clear ${NAME}`, ...(DEF.two ? [`clear ${OTHER}`] : []))
  bot.quit(); await sleep(800)
  if (child) await new Promise(res => { child.once('exit', res); setTimeout(res, 5000) })
  rcon(`kill @e[type=minecraft:item,x=${X},y=${Y + 1},z=${Z},distance=..14]`, wipe, `forceload remove ${X - 8} ${Z - 8} ${X + 8} ${Z + 8}`)
  process.exit(0)
}
(FOLLOWER ? follower() : main()).catch(e => { P('FAIL', e.stack); if (!FOLLOWER) { try { flag('done', 1); rcon(wipe, `forceload remove ${X - 8} ${Z - 8} ${X + 8} ${Z + 8}`) } catch { /* best effort */ } } process.exit(1) })
