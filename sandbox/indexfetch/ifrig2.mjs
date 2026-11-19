// SANDBOX-ONLY (sandbox2): indexfetch-01show PLACEMENT rig (ifrig2): the bot's own loop on one project -- the real order (shop.mjs
// buildOrder, the fetch ask installed) and the real build_shop run it names, visit after visit, so the chain is the bot's own:
// the visit's draw comes up short -> the want -> the order's trip -> the items booked -> the next visit places them. RIG FIXTURES:
// every project but IF_PLOT is held for this bot (the real `room` wait stop, as t11rig.mjs); the order's record is { plot: IF_PLOT }.
//   node sandbox/indexfetch/ifrig2.mjs <bot> <out dir> <plot>      (env IF_MIN minutes, default 25)
// (header of ifrig.mjs follows)
// SANDBOX-ONLY (sandbox2): indexfetch-01show rig. One bot on a copy of the T11 rig world (run 34's end state) with that run's pool
// copy (its town index: the storage hall's chests ~55 blocks from home hold torches, lanterns, bone meal). Derived from
// sandbox/t11/t11rig.mjs (t11reach2-01show: the world id, the movements, the death rows). For each scenario:
//   1. THE SHORT DRAW: the real build draw (skills.mjs matsWithdraw) inside a build visit whose clock is nearly spent (RIG FIXTURE: the
//      runner's start is set back so ~40 s of 180 remain -- the visit's clock ending is exactly the case), so it ends short and notes
//      the fetch want (`_index_fetch op=want`) from the real index;
//   2. THE ORDER: the real shop.mjs buildOrder inside its cooldown (lastAt = now) -> the trip, or not;
//   3. THE TRIP: the real build_shop run with the order's args (skills.mjs indexFetchVisit: walks, opens, verifies, takes) -> the
//      `_index_fetch op=trip` row; then the order again (the follow-up build, no cooldown).
// A scenario's `stale` (RIG FIXTURE, the pool copy only, never a world): one index observation appended claiming a container holds
// what it does not -- the stale entry the trip must catch, correct and not retry.
//   node sandbox/indexfetch/ifrig.mjs <bot> <out dir> '<scenarios json>'
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks, createRequire } from 'node:module'
const NAME = process.argv[2], OUT = path.resolve(process.argv[3]), PLOT = process.argv[4] ?? 'stepwell'
fs.mkdirSync(path.join(OUT, 'log-' + NAME), { recursive: true })
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'showcase', WORLD_BORDER_RADIUS: '8000',
  LOG_DIR: path.join(OUT, 'log-' + NAME), STATE_DIR: path.join(OUT, 'state-' + NAME), POOL_STATE_DIR: path.join(OUT, 'pool'),
  HOME_X: '0', HOME_Y: '70', HOME_Z: '0', BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
registerHooks({ load (url, context, nextLoad) {
  const r = nextLoad(url, context)
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['buildShop'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TD, SH, MATS, TI] = await Promise.all(['skills.mjs', 'towndeposit.mjs', 'shop.mjs', 'mats.mjs', 'townindex.mjs'].map(imp))
const E = SK.__e2e
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const has = f => fs.existsSync(path.join(OUT, f))
const W = (f, o) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n')
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(0)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: 25600, username: NAME, auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder)
const { worldIdFromLogin } = await imp('composter.mjs')
const POOL_SEED = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(OUT, 'pool', 'protected-zones.json'), 'utf8')).hashed_seed ?? '') } catch { return '' } })()
bot._client.on('login', p => { bot.loginWorldId = worldIdFromLogin(p); bot.worldId = POOL_SEED || bot.loginWorldId })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 240000) })
P('world', JSON.stringify(bot.worldId), 'pos', bot.entity.position.toString())
// DEATHS (t11rig.mjs's row): NO SURVIVAL REFLEXES in this harness -- one row a death, the cause guessed from the feet/head blocks
let deaths = 0, deadAt = 0, lastOxy = null, lastHp = null, step = null
const posOf = () => { const p = bot.entity?.position; return p ? [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10] : null }
const nameAt = dy => { try { return bot.blockAt(bot.entity.position.offset(0, dy, 0))?.name ?? null } catch { return null } }
bot.on('breath', () => { lastOxy = bot.oxygenLevel ?? null })
const deathRow = via => {
  if (Date.now() - deadAt < 5000) return
  deadAt = Date.now(); deaths++
  const feet = nameAt(0), head = nameAt(1)
  const cause = /lava/.test(`${feet} ${head}`) ? 'lava' : (lastOxy === 0 || /water/.test(head ?? '')) ? 'drowning' : (lastHp != null && lastHp > 0 && feet && !/water|lava/.test(feet)) ? 'fall_or_other' : 'unknown'
  W('events.jsonl', { bot: NAME, t: new Date().toISOString(), death: true, via, pos: posOf(), feet, head, oxygen: lastOxy, hp_before: lastHp, cause, step })
}
bot.on('health', () => { if (bot.health <= 0) deathRow('health0'); else lastHp = bot.health })
bot.on('death', () => deathRow('death_event'))
;(await imp('craftsync.mjs')).installCraftSync(bot, { log: () => {} })
const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
mv.scafoldingBlocks = ['cobblestone', 'dirt'].map(n => bot.registry.itemsByName[n]?.id).filter(v => v != null)
bot.pathfinder.setMovements(mv)
const tdMoves = TD.townWalkMovements(mv)
bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(tdMoves); bot.movementProfile = 'town_deposit_walk'; try { return await fn() } finally { bot.pathfinder.setMovements(mv); bot.movementProfile = 'walk' } }
SK.__setActive(bot)
SK.bagRoomInstall(bot)   // installs the fetch ask (shop.mjs setFetchAsk)
const used = () => (bot.inventory?.items?.() ?? []).length
const bag = () => Object.fromEntries((bot.inventory?.items?.() ?? []).reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.count), new Map()))
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid)
while (!has('go')) await sleep(500)
await sleep(3000)
const ctx = { bot, runner: { current: { startedAt: Date.now() } } }
let state = { lastAt: -Infinity, lastStop: null }
const until = Date.now() + Number(process.env.IF_MIN ?? 25) * 60000
for (let n = 1; Date.now() < until && !has('stop'); n++) {
  try { SK.townPlanTick(bot) } catch { /* the plan as it stands */ }
  bot.shopWait ??= new Map(); for (const p of SH.projectsOn()) if (p.plot !== PLOT) bot.shopWait.set(p.plot, { stop: 'room', until: Date.now() + 3600000 })
  const p = bot.entity.position
  const now = Date.now()
  const o = SH.buildOrder({ on: true, shared: true, atTown: true, holds: false, now, state, record: { plot: PLOT, structure_complete: false }, complete: false, slotsFree: true,
    health: bot.health ?? 20, freeSlots: 36 - used(), planned: true, feet: [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)], groundY: 70, cooldown: process.env.IF_COOLDOWN === '1' })
  const want = bot.indexFetchWant ? { state: bot.indexFetchWant.state, items: bot.indexFetchWant.items, plot: bot.indexFetchWant.plot } : null
  if (!o.order) { W('rig.jsonl', { bot: NAME, n, t: new Date(now).toISOString(), phase: 'no_order', skip: o.skip, want }); await sleep(15000); continue }
  step = `visit:${n}`
  const b0 = bag()
  ctx.runner.current.startedAt = Date.now()
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 180_000)
  let r = null
  try { r = await E.buildShop(ctx, o.order.args, ac.signal) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } } finally { clearTimeout(tm); step = null }
  state = { lastAt: now, lastStop: r?.stop ?? null }
  const b1 = bag(), delta = {}
  for (const k of new Set([...Object.keys(b0), ...Object.keys(b1)])) { const d = (b1[k] ?? 0) - (b0[k] ?? 0); if (d) delta[k] = d }
  W('rig.jsonl', { bot: NAME, n, t: new Date(now).toISOString(), ms: Date.now() - now, order: o.order.args, wantBefore: want, status: r?.status, stop: r?.stop, placed: r?.placed ?? null, detail: String(r?.detail ?? '').slice(0, 240), bagDelta: delta, pos: posOf() })
  P(n, JSON.stringify(o.order.args), r?.status, r?.stop ?? '', `placed=${r?.placed ?? '-'}`, String(r?.detail ?? '').slice(0, 120), JSON.stringify(delta))
  await sleep(3000)
}
W('rig.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag(), deaths, backoff: [...(bot.indexFetchBackoff ?? new Map())] })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
