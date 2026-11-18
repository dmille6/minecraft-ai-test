// SANDBOX-ONLY (sandbox2): buildfirst-01show rig. A bot with a showcase bag at ~35/36 at the town of a copy of the showcase world
// (and its pool state) runs the IDLE STEER's decision in a loop: skills.mjs groundsIdleAsk (the building look first) -> the order it
// returns (build_shop, a room-bank or a well trip, then the build) or the grounds' idle visit. Derived from memtidy.mjs.
//   node sandbox/buildfirst/bfrig.mjs <bot> <out dir>      (env BF_MIN minutes, default 25)
// Rows land in <out>/log-<bot>/; one line a decision in <out>/decisions.jsonl.
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks, createRequire } from 'node:module'
const NAME = process.argv[2], OUT = path.resolve(process.argv[3])
fs.mkdirSync(path.join(OUT, 'log-' + NAME), { recursive: true })
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'showcase', WORLD_BORDER_RADIUS: '8000',
  LOG_DIR: path.join(OUT, 'log-' + NAME), STATE_DIR: path.join(OUT, 'state-' + NAME), POOL_STATE_DIR: path.join(OUT, 'pool'),
  HOME_X: '0', HOME_Y: '70', HOME_Z: '0', BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
registerHooks({ load (url, context, nextLoad) {
  const r = nextLoad(url, context)
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['buildShopVisitRun', 'buildShop', 'TIDY_PLOT'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TD] = await Promise.all(['skills.mjs', 'towndeposit.mjs'].map(imp))
const E = SK.__e2e
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const has = f => fs.existsSync(path.join(OUT, f))
const W = (f, o) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n')
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(0)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: 25600, username: NAME, auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder)
bot._client.on('login', p => { bot.worldId = p?.worldName ?? 'sbx' })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 240000) })
let deaths = 0
bot.on('death', () => { deaths++; W('events.jsonl', { bot: NAME, t: new Date().toISOString(), death: true }) })
;(await imp('craftsync.mjs')).installCraftSync(bot, { log: () => {} })
const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
mv.scafoldingBlocks = ['cobblestone', 'dirt'].map(n => bot.registry.itemsByName[n]?.id).filter(v => v != null)
bot.pathfinder.setMovements(mv)
const tdMoves = TD.townWalkMovements(mv)
bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(tdMoves); bot.movementProfile = 'town_deposit_walk'; try { return await fn() } finally { bot.pathfinder.setMovements(mv); bot.movementProfile = 'walk' } }
SK.__setActive(bot)
SK.bagRoomInstall(bot)   // the room ask, the room hold, the yard's lanes (features.mjs does this once per spawn)
const used = () => (bot.inventory?.items?.() ?? []).length
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid)
while (!has('go')) await sleep(500)
await sleep(3000)
const until = Date.now() + Number(process.env.BF_MIN ?? 25) * 60000
// BF_PICKS: the bot's first, second and third pick through the real picker (each held in turn with the `room` stop, then released)
if (process.env.BF_PICKS) {
  bot.shopWait ??= new Map()
  const picks = []
  for (let i = 0; i < 3; i++) { let p = null; try { p = SK.shopActive(bot, Date.now())?.plot ?? null } catch (e) { p = 'threw:' + e.message } picks.push(p); if (p) bot.shopWait.set(p, { stop: 'room', until: Date.now() + 60000 }) }
  for (const p of picks) if (p) bot.shopWait.delete(p)
  W('picks.jsonl', { bot: NAME, t: new Date().toISOString(), picks }); P('picks', picks)
  if (process.env.BF_PICKS === 'only') { fs.writeFileSync(path.join(OUT, `done-${NAME}`), '{}'); bot.quit(); await sleep(500); process.exit(0) }
}
// the town's count (count_town: every town container opened and counted -- the cobble cap's observations), once, by BF_COUNTER
if (process.env.BF_COUNTER === NAME) {
  // the town's own recount (skills.mjs reconcileCobble) over every container the cap's view does not know yet -- what live bots do
  // as they bank and draw; the copied journal is older than the rig's clock allows
  for (let i = 0; i < 3; i++) {
    let keys = []
    try { keys = SK.cobbleTownViewFor(bot, Date.now(), { fresh: true }).unknown ?? [] } catch { keys = [] }
    P('recount pass', i, 'unknown', keys.length)
    if (!keys.length) break
    // RIG ONLY: the counter is set beside each container (an op's /tp; the walks from the spawn timed out) and counts it there
    for (const k of keys) {
      const [x, y, z] = k.split(',').map(Number)
      bot.chat(`/tp ${NAME} ${x + 0.5} ${y + 1} ${z + 0.5}`); await sleep(1500)
      try { const r = await SK.reconcileCobble(bot, new AbortController().signal, cap => Math.min(cap, 30000), [k], { remember: true, max: 1 }); P('reconcile', k, JSON.stringify(r ?? null).slice(0, 160)) } catch (e) { P('reconcile threw', k, e.message) }
    }
  }
  try { P('cap now', SK.cobbleWellCap(bot)) } catch { /* rig only */ }
  fs.writeFileSync(path.join(OUT, 'counted'), '1')
}
while (process.env.BF_COUNTER && process.env.BF_COUNTER !== NAME && !has('counted')) await sleep(2000)
for (let n = 1; Date.now() < until && !has('stop'); n++) {
  try { SK.townPlanTick(bot) } catch { /* the plan as it stands */ }
  // RIG FIXTURE (BF_ONLY=<plot>): every other project is held for this bot (the real `room` wait stop), so the real picker's pick is
  // that building -- the question is whether its cells are workable, not where it stands in the order
  if (process.env.BF_ONLY) { const SH = await imp('shop.mjs'); bot.shopWait ??= new Map(); for (const p of SH.projectsOn()) if (p.plot !== process.env.BF_ONLY && p.plot !== 'tidy') bot.shopWait.set(p.plot, { stop: 'room', until: Date.now() + 3600000 }) }
  const t = Date.now(), u0 = used()
  let d = null, r = null, kind = 'none'
  try { d = SK.groundsIdleAsk(bot, Date.now()) } catch (e) { d = { ok: false, why: 'threw ' + e.message } }
  try {
    if (d?.ok && d.order) { kind = 'build'; r = await E.buildShop({ bot }, d.order.args ?? {}, new AbortController().signal) }
    else if (d?.ok) {
      kind = 'grounds'
      try { r = await E.buildShop({ bot }, { grounds: true, why: 'idle' }, new AbortController().signal) } finally { bot.groundsPick = null }
    }
  } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } }
  let capv = null; try { const v = SK.cobbleTownViewFor(bot); capv = { cap: SK.cobbleWellCap(bot), lb: v.lb, lbLo: v.lbLo, avail: v.avail, complete: v.complete, unknown: v.unknown } } catch (e) { capv = String(e.message) }
  W('decisions.jsonl', { capv, bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, kind, why: d?.why ?? null, args: d?.order?.args ?? null, status: r?.status ?? null, stop: r?.stop ?? null, placed: r?.placed ?? null, detail: String(r?.detail ?? '').slice(0, 200), slots: `${u0}->${used()}`, plot: bot.shopVisitPlot ?? null })
  P(n, kind, d?.why, r?.status, r?.stop ?? '', `${u0}->${used()}`, bot.shopVisitPlot ?? '')
  await sleep(kind === 'none' ? 20000 : 2000)
}
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
