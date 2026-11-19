// SANDBOX-ONLY (sandbox2): gradetidy-01show T11 rig. Bots on a copy of the showcase world (T11 as on 11-18: 54.1%) with a copy of
// the pool plus grade-target.json (gated to T11) run the GROUNDS visit in a loop -- skills.mjs buildShop({ grounds: true }), the idle
// bots' own path: the keeper sites or refreshes the inside-the-wall record (the grade's cells), the crew cuts and fills. Every
// other project is held for the rig's bots (the real `room` wait stop) so the tidy is their only work. Derived from bfrig.mjs.
//   node sandbox/t11/t11rig.mjs <bot> <out dir>      (env T11_MIN minutes, default 40)
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
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['buildShop', 'buildTidy'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TD, SH] = await Promise.all(['skills.mjs', 'towndeposit.mjs', 'shop.mjs'].map(imp))
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
SK.bagRoomInstall(bot)
const used = () => (bot.inventory?.items?.() ?? []).length
const bag = () => Object.fromEntries((bot.inventory?.items?.() ?? []).reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.count), new Map()))
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid)
while (!has('go')) await sleep(500)
await sleep(3000)
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'start', bag: bag() })
const until = Date.now() + Number(process.env.T11_MIN ?? 40) * 60000
for (let n = 1; Date.now() < until && !has('stop'); n++) {
  try { SK.townPlanTick(bot) } catch { /* the plan as it stands */ }
  // RIG FIXTURE: every project but the tidy is held for this bot (the real `room` wait stop): the grounds are its only work
  bot.shopWait ??= new Map(); for (const p of SH.projectsOn()) if (p.plot !== 'tidy') bot.shopWait.set(p.plot, { stop: 'room', until: Date.now() + 3600000 })
  const t = Date.now(), u0 = used()
  let r = null
  // T11_DIRECT=1 (rig fixture): the tidy visit itself (skills.mjs buildTidy: the keeper's election, its hourly refresh, the crew's
  // cuts and fills), not through the idle steer's grounds quota (whose turns kept the rig's three bots waiting on 14 absent ones)
  try { r = process.env.T11_DIRECT ? await E.buildTidy({ bot }, {}, new AbortController().signal) : await E.buildShop({ bot }, { grounds: true, why: 'idle' }, new AbortController().signal) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } } finally { bot.groundsPick = null }
  W('decisions.jsonl', { bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, status: r?.status ?? null, stop: r?.stop ?? null, placed: r?.placed ?? null, detail: String(r?.detail ?? '').slice(0, 240), slots: `${u0}->${used()}`, dirt: bag().dirt ?? 0 })
  P(n, r?.status, r?.stop ?? '', String(r?.detail ?? '').slice(0, 120), `${u0}->${used()}`)
  await sleep(r?.status === 'no_effect' ? 15000 : 2000)
}
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag() })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
