// SANDBOX-ONLY (a sandbox Paper server holding a COPY of the showcase world -- the 11-20 04:15Z nightly backup copy, the step well's
// pit and its bridge leftovers -- never a live world): floatclean-01show rig, derived from sandbox/stepwell/swrig.mjs (the T11 rig
// recipe). Bots on the world copy with a copy of the showcase pool run THE LAP (skills.mjs floatcleanLap: the bundled list, the
// strict guard, the real visit loop) in a loop. After each lap: the lap's outcome, the list's cells as this bot sees them now
// (standing / gone), and the bot's deaths (the death row: events.jsonl).
//   node sandbox/floatclean/fcrig.mjs <bot> <out dir>      (env FC_MIN minutes, default 40; FC_PORT, default 25601 = sandbox3)
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
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['floatcleanLap'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TD, FCM, CF] = await Promise.all(['skills.mjs', 'towndeposit.mjs', 'floatclean.mjs', 'config.mjs'].map(imp))
const E = SK.__e2e
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const has = f => fs.existsSync(path.join(OUT, f))
const W = (f, o) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n')
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(0)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(process.env.FC_PORT ?? 25601), username: NAME, auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder)
const { worldIdFromLogin } = await imp('composter.mjs')
// the rig world is a copy of the showcase: its id is the pool's own zones file's `hashed_seed` (t11rig.mjs run 22-24)
const POOL_SEED = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(OUT, 'pool', 'protected-zones.json'), 'utf8')).hashed_seed ?? '') } catch { return '' } })()
bot._client.on('login', p => { bot.loginWorldId = worldIdFromLogin(p); bot.worldId = POOL_SEED || bot.loginWorldId })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 240000) })
let deaths = 0
bot.on('death', () => { deaths++; W('events.jsonl', { bot: NAME, t: new Date().toISOString(), death: true, pos: bot.entity?.position }); P('DIED at', bot.entity?.position) })
;(await imp('craftsync.mjs')).installCraftSync(bot, { log: () => {} })
const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
mv.scafoldingBlocks = ['cobblestone', 'dirt'].map(n => bot.registry.itemsByName[n]?.id).filter(v => v != null)
bot.pathfinder.setMovements(mv)
const tdMoves = TD.townWalkMovements(mv)
bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(tdMoves); bot.movementProfile = 'town_deposit_walk'; try { return await fn() } finally { bot.pathfinder.setMovements(mv); bot.movementProfile = 'walk' } }
SK.__setActive(bot)
SK.bagRoomInstall?.(bot)
const list = JSON.parse(fs.readFileSync(path.join(BOTS, 'src', 'floatclean', 'showcase.json'), 'utf8'))
const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox } : null }
// the list as this bot sees it now, by area: standing (still the listed block), gone, unread (chunk not loaded)
const seen = () => {
  const o = {}
  for (const j of list.jobs) {
    const a = (o[j.area] ??= { standing: 0, gone: 0, unread: 0 })
    const b = read(...j.at)
    if (!b) a.unread++; else if (FCM.sameBlock(b.name, j.name)) a.standing++; else a.gone++
  }
  return o
}
const bag = () => Object.fromEntries((bot.inventory?.items?.() ?? []).reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.count), new Map()))
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid, 'code', CF.config.code.version, 'at', bot.entity.position)
while (!has('go')) await sleep(500)
await sleep(3000)
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'start', bag: bag(), pos: bot.entity.position, seen: seen() })
const until = Date.now() + Number(process.env.FC_MIN ?? 40) * 60000
for (let n = 1; Date.now() < until && !has('stop'); n++) {
  const t = Date.now()
  let r = null
  try { r = await E.floatcleanLap({ bot, runner: null }, new AbortController().signal, { deadline: Date.now() + FCM.FC.passMs }) } catch (e) { r = { status: 'threw', why: String(e?.stack ?? e).slice(0, 300) } }
  const s = seen()
  W('decisions.jsonl', { bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, tried: r?.tried ?? null, status: r?.status ?? null, stop: r?.stop ?? null, cleared: r?.cleared ?? null, why: String(r?.why ?? '').slice(0, 240), pos: bot.entity.position, seen: s, deaths })
  P(n, r?.tried ? 'tried' : 'not tried', r?.status ?? '', r?.why ?? '', JSON.stringify(s.stepwell ?? {}), JSON.stringify(s.west ?? {}))
  await sleep(r?.tried ? 2000 : 20000)
}
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag(), pos: bot.entity.position, seen: seen() })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
