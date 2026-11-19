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
const NAME = process.argv[2], OUT = path.resolve(process.argv[3]), SCEN = JSON.parse(process.argv[4] ?? '[]')
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
const RES = MATS.matsReserve().table ?? MATS.matsReserve()
for (const [i, sc] of SCEN.entries()) {
  if (has('stop')) break
  const b0 = bag()
  W('rig.jsonl', { bot: NAME, i, t: new Date().toISOString(), phase: 'start', sc, pos: posOf(), bag: b0, slots: used() })
  if (sc.stale) {
    const at = Date.now()
    const ok = TI.appendIndex(path.join(OUT, 'pool'), '0_70_0', bot.worldId ?? null, { t: 'obs', id: `rig-${at}`, k: sc.stale.k, h: [sc.stale.k], at, bot: 'rig', by: 'rig_fixture', ...TI.observation(Object.entries(sc.stale.names).map(([name, count], slot) => ({ name, count, slot })), 27) })
    W('rig.jsonl', { bot: NAME, i, phase: 'stale_fixture', k: sc.stale.k, names: sc.stale.names, ok })
  }
  // 1. the short draw inside a build visit whose clock is nearly spent
  step = `draw:${i}`
  bot.shopVisitBusy = true; bot.shopVisitPlot = sc.plot; bot.bfShortExtra = sc.extra === true
  ctx.runner.current.startedAt = Date.now() - (180_000 - (sc.visitLeftMs ?? 40_000))
  let w = null
  try { w = await SK._draw.matsWithdraw(ctx, sc.need, new AbortController().signal, 30_000, RES, SH.shopAllow) } catch (e) { w = { threw: String(e?.message ?? e).slice(0, 200) } } finally { bot.shopVisitBusy = false; bot.bfShortExtra = false }
  W('rig.jsonl', { bot: NAME, i, phase: 'draw', took: w?.took, tried: w?.tried, short: w?.short, fetch: w?.fetch ?? null, threw: w?.threw, want: bot.indexFetchWant ? { state: bot.indexFetchWant.state, items: bot.indexFetchWant.items, plot: bot.indexFetchWant.plot } : null })
  P(i, 'draw', JSON.stringify({ took: w?.took, short: w?.short, fetch: w?.fetch ?? null }))
  // 2. the order, inside its cooldown
  const q = { on: true, shared: true, atTown: true, planned: true, record: { plot: sc.plot, structure_complete: false }, freeSlots: 36 - used(), health: bot.health, fall: false }
  const o = SH.buildOrder({ ...q, now: Date.now(), state: { lastAt: Date.now(), lastStop: 'no_material' } })
  W('rig.jsonl', { bot: NAME, i, phase: 'order', order: o.order, skip: o.skip })
  P(i, 'order', JSON.stringify(o))
  if (o.order?.args?.indexFetch) {
    step = `trip:${i}`
    ctx.runner.current.startedAt = Date.now()
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 180_000)
    const t = Date.now()
    let r = null
    try { r = await E.buildShop(ctx, o.order.args, ac.signal) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } } finally { clearTimeout(tm) }
    const b1 = bag(), delta = {}
    for (const n of new Set([...Object.keys(b0), ...Object.keys(b1)])) { const d = (b1[n] ?? 0) - (b0[n] ?? 0); if (d) delta[n] = d }
    W('rig.jsonl', { bot: NAME, i, phase: 'trip', ms: Date.now() - t, status: r?.status, stop: r?.stop, detail: String(r?.detail ?? '').slice(0, 240), bagDelta: delta, pos: posOf() })
    P(i, 'trip', r?.status, r?.stop, String(r?.detail ?? '').slice(0, 160), JSON.stringify(delta))
    const o2 = SH.buildOrder({ ...q, freeSlots: 36 - used(), now: Date.now(), state: { lastAt: Date.now(), lastStop: r?.stop ?? '-' } })
    W('rig.jsonl', { bot: NAME, i, phase: 'followup_order', order: o2.order, skip: o2.skip })
    P(i, 'followup', JSON.stringify(o2.order))
  }
  bot.indexFetchWant = null   // the rig does not run the build visit itself (its projects are the T11 world's); the follow-up order is shown
  step = null
  await sleep(3000)
}
W('rig.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag(), deaths, backoff: [...(bot.indexFetchBackoff ?? new Map())] })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
