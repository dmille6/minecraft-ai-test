// SANDBOX-ONLY (a sandbox Paper server holding a COPY of the T11 rig world -- the showcase as saved 11-18, the step well with the
// bridge block at -58,70,-74 -- never a live world): stepwell-03show rig, derived from sandbox/t11/t11rig.mjs. Bots on the world copy
// with a copy of the showcase pool run THE STEP WELL'S OWN VISIT in a loop (skills.mjs buildStepwell: the tank by layers, the set-aside,
// the stamp), and before the first visit the rig asks the project's stuck back-off (projStuckLive) over a stamp written as today's live
// visits wrote it (no cells, no code version): the release rule must read it stale. After each visit it logs the first unit the next
// visit works (the set-aside cells aside), the tank's done units, and the bot's deaths.
//   node sandbox/stepwell/swrig.mjs <bot> <out dir>      (env SW_MIN minutes, default 40; SW_PORT, default 25601 = sandbox3)
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
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['buildStepwell', 'projStuckLive', 'projKeyOf'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TD, SW, BP, CF] = await Promise.all(['skills.mjs', 'towndeposit.mjs', 'stepwell.mjs', 'buildproj.mjs', 'config.mjs'].map(imp))
const E = SK.__e2e
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const has = f => fs.existsSync(path.join(OUT, f))
const W = (f, o) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n')
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(0)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(process.env.SW_PORT ?? 25601), username: NAME, auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder)
const { worldIdFromLogin } = await imp('composter.mjs')
// the rig world is a copy of the showcase: its id is the pool's own zones file's `hashed_seed` (t11rig.mjs run 22-24)
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
const used = () => (bot.inventory?.items?.() ?? []).length
const bag = () => Object.fromEntries((bot.inventory?.items?.() ?? []).reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.count), new Map()))
const key = E.projKeyOf('stepwell')
const recNow = () => { const h = BP.recordHead(path.join(OUT, 'pool'), key); return h.ok ? h.head?.rec ?? null : null }
// the tank as this bot sees it: the first unit the next visit works (its own set-aside cells aside) and the units done
const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); if (!b) return null; let p = null; try { p = b.getProperties() } catch { p = null } return { name: b.name, boundingBox: b.boundingBox, props: p } }
const tank = () => {
  try {
    const rec = recNow(); if (!rec) return { rec: 'none' }
    const plan = SW.planOfRecord(rec)
    const aside = new Set(bot.stepwellAside?.keys() ?? [])
    const w = SW.firstUndoneUnit(read, plan, { aside })
    const done = plan.units.filter(u => SW.unitDone(read, plan, u) === true).length
    return { next: w ? (w.unknown ? `unread@${w.unit.y}` : w.unit.y) : 'complete', done, units: plan.units.length, cell: read(-58, 70, -74)?.name ?? '?', tiers: SW.tiersDone(read, plan).join('+') || '-' }
  } catch (e) { return { err: String(e?.message ?? e).slice(0, 120) } }
}
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid, 'code', CF.config.code.version)
while (!has('go')) await sleep(500)
await sleep(3000)
// THE HOLD: today's live stamp (11-20 12:10Z Bravo: no cells, no version), written fresh by the rig before the go; this code must read it stale
let hold = null
try { hold = E.projStuckLive(key, Date.now()) } catch (e) { hold = `threw ${String(e?.message ?? e).slice(0, 80)}` }
W('hold.jsonl', { bot: NAME, t: new Date().toISOString(), stuckAt: hold, code: CF.config.code.version })
P('stuck back-off read', hold == null ? 'NONE (released)' : hold)
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'start', bag: bag(), tank: tank() })
const until = Date.now() + Number(process.env.SW_MIN ?? 40) * 60000
for (let n = 1; Date.now() < until && !has('stop'); n++) {
  const t = Date.now(), u0 = used(), before = tank()
  let r = null
  try { r = await E.buildStepwell({ bot, runner: null }, {}, new AbortController().signal) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } }
  const after = tank()
  W('decisions.jsonl', { bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, status: r?.status ?? null, stop: r?.stop ?? null, placed: r?.placed ?? null, detail: String(r?.detail ?? '').slice(0, 240), slots: `${u0}->${used()}`, before, after, deaths })
  P(n, r?.status, r?.stop ?? '', String(r?.detail ?? '').slice(0, 120), JSON.stringify(after))
  await sleep(r?.status === 'no_effect' ? 15000 : 3000)
}
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag(), tank: tank() })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
