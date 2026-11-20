// SANDBOX-ONLY (a sandbox Paper server holding a COPY of the showcase world -- the 11-20 04:15Z nightly backup copy -- never a live
// world): roadsite-01show rig, derived from sandbox/floatclean/fcrig.mjs and sandbox/pit/pitrig.mjs (the T11 rig recipe, its death
// row). Bots on the world copy with a copy of the showcase pool (ci2 ~/roads1120: the 11-20 13:06Z pool and the installed traffic
// file) run THE ROAD VISIT (skills.mjs buildSink on the `road` plot: the gate, the siting -- roads.mjs siteRoad2 with the shared
// columns --, the kit, the build through runVisit) in a loop. After each visit: the outcome, the road record's instances and how many
// of their cells read built by this bot's own world view, and the deaths (events.jsonl).
//   node sandbox/roadsite/rsrig.mjs <bot> <out dir>      (env RS_MIN minutes, default 40; RS_PORT, default 25601 = sandbox3)
// NO SURVIVAL REFLEXES: the visit runs in a loop with none of index.mjs's reflexes (air, drowning, fall, unstick, eat, flee) -- a bot
// that drowns or falls dies here where a fleet bot might not. Read deaths with that in mind.
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
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['buildSink'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TD, CF, BP, BR] = await Promise.all(['skills.mjs', 'towndeposit.mjs', 'config.mjs', 'buildproj.mjs', 'buildrun.mjs'].map(imp))
const E = SK.__e2e
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const has = f => fs.existsSync(path.join(OUT, f))
const W = (f, o) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n')
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(0)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(process.env.RS_PORT ?? 25601), username: NAME, auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder)
const { worldIdFromLogin } = await imp('composter.mjs')
// the rig world is a copy of the showcase: its id is the pool's own zones file's `hashed_seed` (t11rig.mjs run 22-24)
const POOL_SEED = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(OUT, 'pool', 'protected-zones.json'), 'utf8')).hashed_seed ?? '') } catch { return '' } })()
bot._client.on('login', p => { bot.loginWorldId = worldIdFromLogin(p); bot.worldId = POOL_SEED || bot.loginWorldId })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 240000) })
// THE DEATH ROW (pitrig.mjs): a row on the death event AND on a health drop to 0 (deduplicated), the position, the oxygen and health
// last seen, the blocks at the feet and head (a cause guess) and the visit in progress
let deaths = 0, visitNow = null, lastPos = null, lastOxy = null, lastHp = null, deadAt = 0
const posOf = () => { const p = bot.entity?.position; return p ? [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10] : null }
const nameAt = dy => { try { return bot.blockAt(bot.entity.position.offset(0, dy, 0))?.name ?? null } catch { return null } }
bot.on('move', () => { lastPos = posOf() })
bot.on('breath', () => { lastOxy = bot.oxygenLevel ?? null })
const deathRow = via => {
  if (Date.now() - deadAt < 5000) return
  deadAt = Date.now(); deaths++
  const feet = nameAt(0), head = nameAt(1)
  const cause = /lava/.test(`${feet} ${head}`) ? 'lava' : (lastOxy === 0 || /water/.test(head ?? '')) ? 'drowning' : (lastHp != null && lastHp > 0 && feet && !/water|lava/.test(feet)) ? 'fall_or_other' : 'unknown'
  W('events.jsonl', { bot: NAME, t: new Date().toISOString(), death: true, via, pos: posOf() ?? lastPos, feet, head, oxygen: lastOxy, hp_before: lastHp, cause, visit: visitNow })
  P('DIED', via, cause, posOf() ?? lastPos)
}
bot.on('health', () => { if (bot.health <= 0) deathRow('health0'); else lastHp = bot.health })
bot.on('death', () => deathRow('death_event'))
bot.on('respawn', () => { W('events.jsonl', { bot: NAME, t: new Date().toISOString(), respawn: true, pos: posOf(), visit: visitNow }) })
;(await imp('craftsync.mjs')).installCraftSync(bot, { log: () => {} })
const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
mv.scafoldingBlocks = ['cobblestone', 'dirt'].map(n => bot.registry.itemsByName[n]?.id).filter(v => v != null)
bot.pathfinder.setMovements(mv)
const tdMoves = TD.townWalkMovements(mv)
bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(tdMoves); bot.movementProfile = 'town_deposit_walk'; try { return await fn() } finally { bot.pathfinder.setMovements(mv); bot.movementProfile = 'walk' } }
SK.__setActive(bot)
SK.bagRoomInstall?.(bot)
const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? b : null }
// the road record as this bot sees it: every instance's cells built / open / unread (buildrun.mjs cellDone, the record's palette)
const roadSeen = () => {
  const h = BP.recordHead(path.join(OUT, 'pool'), 'project-0_70_0.road')
  const rec = h.ok ? h.head?.rec ?? null : null
  if (!rec) return { why: h.ok ? 'no record' : 'unreadable' }
  const by = {}
  for (const c of rec.cells ?? []) {
    const id = String(c.seg ?? c.role ?? '').split('-')[0]
    const a = (by[id] ??= { built: 0, open: 0, unread: 0 })
    const b = read(...c.at)
    if (!b) a.unread++; else if (BR.cellDone(b, rec.palette ?? {}, c.role, c.ws ?? null)) a.built++; else a.open++
  }
  return { gen: h.head?.gen, instances: (rec.instances ?? []).map(i => ({ id: i.id, route: i.route ?? null, len: i.len ?? null, lamps: i.lamps ?? null, ended: i.ended ?? null })), cells: by, complete: !!rec.structure_complete }
}
const bag = () => Object.fromEntries((bot.inventory?.items?.() ?? []).reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.count), new Map()))
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid, 'code', CF.config.code.version, 'at', bot.entity.position)
while (!has('go')) await sleep(500)
await sleep(3000)
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'start', bag: bag(), pos: posOf(), road: roadSeen() })
const until = Date.now() + Number(process.env.RS_MIN ?? 40) * 60000
for (let n = 1; Date.now() < until && !has('stop'); n++) {
  try { SK.townPlanTick?.(bot) } catch { /* the plan as it stands */ }
  const t = Date.now()
  visitNow = { n, at: new Date(t).toISOString(), kind: 'road' }
  let r = null
  try { r = await E.buildSink({ bot }, {}, new AbortController().signal, { plot: 'road' }) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } }
  const road = roadSeen()
  W('decisions.jsonl', { bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, status: r?.status ?? null, stop: r?.stop ?? null, placed: r?.placed ?? null, detail: String(r?.detail ?? '').slice(0, 300), pos: posOf(), road, deaths })
  P(n, r?.status, r?.stop ?? '', String(r?.detail ?? '').slice(0, 140), JSON.stringify(road.cells ?? road))
  await sleep(r?.status === 'no_effect' ? 15000 : 2000)
}
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag(), pos: posOf(), road: roadSeen() })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
