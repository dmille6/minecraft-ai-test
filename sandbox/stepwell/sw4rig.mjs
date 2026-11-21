// SANDBOX-ONLY (sandbox3, a COPY of the stepwell-03show rig's end world -- the showcase as saved 11-18 with the tank dug to y 59 --
// never a live world): stepwell-04show rig, derived from swrig.mjs. The driver has set the tank's y 62 rim back to LIVE's state (the
// 151 trim cells and their 151 posts and 33 torches air: the first unit not done is the rim at y 62) and given ONE bot LUMEN'S BAG
// (98 cobblestone, a pickaxe, 2 torches) at the tank's exit. The bot, with a copy of the showcase pool (its town index: 308
// stone_bricks, 29 cobblestone, 971 cobbled_deepslate, 3,246 cobblestone_wall), runs THE STEP WELL'S OWN VISIT (skills.mjs
// buildStepwell) in a loop. After each visit: the visit's result, the bag, and the y 62 trim and y 63 post cells as the bot reads them.
//   node sandbox/stepwell/sw4rig.mjs <bot> <out dir>      (cwd: a checkout whose bots/ is the code under test; env SW_MIN, SW_VISITS)
// NO SURVIVAL REFLEXES (as swrig): deaths are written to events.jsonl.
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
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['buildStepwell'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TD, CF] = await Promise.all(['skills.mjs', 'towndeposit.mjs', 'config.mjs'].map(imp))
const E = SK.__e2e
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const has = f => fs.existsSync(path.join(OUT, f))
const W = (f, o) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n')
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(0)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(process.env.SW_PORT ?? 25601), username: NAME, auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder)
const { worldIdFromLogin } = await imp('composter.mjs')
const POOL_SEED = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(OUT, 'pool', 'protected-zones.json'), 'utf8')).hashed_seed ?? '') } catch { return '' } })()
bot._client.on('login', p => { bot.loginWorldId = worldIdFromLogin(p); bot.worldId = POOL_SEED || bot.loginWorldId })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 240000) })
let deaths = 0
bot.on('death', () => { deaths++; W('events.jsonl', { bot: NAME, t: new Date().toISOString(), death: true, pos: bot.entity?.position }) })
;(await imp('craftsync.mjs')).installCraftSync(bot, { log: () => {} })
const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
mv.scafoldingBlocks = ['cobblestone', 'dirt'].map(n => bot.registry.itemsByName[n]?.id).filter(v => v != null)
bot.pathfinder.setMovements(mv)
const tdMoves = TD.townWalkMovements(mv)
bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(tdMoves); bot.movementProfile = 'town_deposit_walk'; try { return await fn() } finally { bot.pathfinder.setMovements(mv); bot.movementProfile = 'walk' } }
SK.__setActive(bot)
SK.bagRoomInstall?.(bot)
try { SK.yardLanesInstall?.(bot) } catch { /* the base may not install the well's per-name count */ }
const bag = () => Object.fromEntries((bot.inventory?.items?.() ?? []).reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.count), new Map()))
// the y 62 rim as the bot reads it (the driver's probe: the 151 trim cells and the 151 posts on them)
const PROBE = JSON.parse(fs.readFileSync(path.join(OUT, 'probe62.json'), 'utf8'))
const rim = () => {
  const nm = c => bot.blockAt(new Vec3(...c))?.name ?? null
  const t = PROBE.trim.map(nm), p = PROBE.posts.map(nm)
  return { trimLaid: t.filter(n => /^(stone_bricks|cobblestone|mossy_cobblestone|cobbled_deepslate)$/.test(n ?? '')).length, trimUnread: t.filter(n => n == null).length,
    trimBy: t.reduce((m, n) => (n && n !== 'air' ? { ...m, [n]: (m[n] ?? 0) + 1 } : m), {}), postsLaid: p.filter(n => /_wall$/.test(n ?? '')).length, of: PROBE.trim.length }
}
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid, 'code', CF.config.code.version)
while (!has('go')) await sleep(500)
await sleep(3000)
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'start', bag: bag(), rim: rim(), pos: bot.entity?.position })
P('start', JSON.stringify(bag()), JSON.stringify(rim()))
const until = Date.now() + Number(process.env.SW_MIN ?? 15) * 60000
for (let n = 1; n <= Number(process.env.SW_VISITS ?? 4) && Date.now() < until && !has('stop'); n++) {
  const t = Date.now(), b0 = bag()
  let r = null
  // the runner's clock as live (withdrawClock: every draw ends by the skill's own SKILL_TIMEOUT_MS from its start, 180 s by default)
  try { r = await E.buildStepwell({ bot, runner: { current: { startedAt: t } } }, {}, new AbortController().signal) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } }
  const after = rim()
  W('decisions.jsonl', { bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, status: r?.status ?? null, stop: r?.stop ?? null, detail: String(r?.detail ?? '').slice(0, 300), bag0: b0, bag1: bag(), rim: after, deaths })
  P(n, r?.status, r?.stop ?? '', String(r?.detail ?? '').slice(0, 160), JSON.stringify(after), JSON.stringify(bag()))
  await sleep(r?.status === 'no_effect' ? 10000 : 3000)
}
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag(), rim: rim() })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
