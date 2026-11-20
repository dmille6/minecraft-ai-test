// SANDBOX-ONLY (sandbox2): pit-01show rig. Bots on a copy of the showcase world whose regions are ci2 ~/world18full/region (the 11-18
// copy that holds P1 untouched), with a copy of the pool (ci2 ~/pool-1119b), run the PIT visit in a loop -- skills.mjs buildPit (the
// demand, the walk, the plan and record, the layer's dig through runVisit, the bank) with PIT_SITE set to the owner's site. Derived from
// sandbox/t11/t11rig.mjs (the T11 rig recipe, with its death row).
//   node sandbox/pit/pitrig.mjs <bot> <out dir>      (env PIT_MIN minutes, default 40; PIT_SITE default -51,-99,15,21/60)
// NO SURVIVAL REFLEXES: this harness runs the visit in a loop with none of index.mjs's reflexes (air, drowning, fall, unstick, eat,
// flee) -- a bot that drowns or falls dies here where a fleet bot might not. Read deaths with that in mind.
// DEATHS: `events.jsonl` gets a `death` row on the death event AND on a health drop to 0 (deduplicated), with the position, the oxygen
// and health last seen, the block at the feet and head (a cause guess) and the visit in progress; a `respawn` row follows.
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks, createRequire } from 'node:module'
const NAME = process.argv[2], OUT = path.resolve(process.argv[3])
fs.mkdirSync(path.join(OUT, 'log-' + NAME), { recursive: true })
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'showcase', WORLD_BORDER_RADIUS: '8000',
  LOG_DIR: path.join(OUT, 'log-' + NAME), STATE_DIR: path.join(OUT, 'state-' + NAME), POOL_STATE_DIR: path.join(OUT, 'pool'),
  HOME_X: '0', HOME_Y: '70', HOME_Z: '0', BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer', PIT_SITE: process.env.PIT_SITE ?? '-51,-99,15,21/60',
})
registerHooks({ load (url, context, nextLoad) {
  const r = nextLoad(url, context)
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __e2e = { ${['buildShop', 'buildTidy', 'buildPit'].map(n => `get ${n} () { return typeof ${n} === 'undefined' ? undefined : ${n} }`).join(', ')} }\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
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
// the world id as the bots' own (index.mjs: the hashed seed). The dimension name here read as another world to the zones file, so every
// refresh's repair was closed (`st=closed:excl_unread:zones`, runs 19 and 21)
const { worldIdFromLogin } = await imp('composter.mjs')
// run 22-24: the sandbox's login id is not the showcase's, and the town plan's head and the zones are keyed by the world id -- the
// rig world is a copy of the showcase, so its id IS the pool's own zones file's `hashed_seed` (the value the showcase bots log in with)
const POOL_SEED = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(OUT, 'pool', 'protected-zones.json'), 'utf8')).hashed_seed ?? '') } catch { return '' } })()
bot._client.on('login', p => { bot.loginWorldId = worldIdFromLogin(p); bot.worldId = POOL_SEED || bot.loginWorldId })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 240000) })
// the refresh repair is open only when the survey's inputs read whole: say what the rig gives it (run 22/23: closed on `zones`)
try { P('world', JSON.stringify(bot.worldId), 'login', JSON.stringify(bot.loginWorldId), 'keep-out report', JSON.stringify(SK._fillcol.keepInputs(bot, SK.townPlanHead(bot)).report).slice(0, 600)) } catch (e) { P('keep-out report threw', JSON.stringify(bot.worldId), JSON.stringify(bot.loginWorldId), String(e?.message ?? e).slice(0, 200)) }
let deaths = 0, visitNow = null, lastPos = null, lastOxy = null, lastHp = null, deadAt = 0
const posOf = () => { const p = bot.entity?.position; return p ? [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10] : null }
const nameAt = (dx, dy) => { try { const p = bot.entity.position; return bot.blockAt(p.offset(0, dy, 0))?.name ?? null } catch { return null } }
bot.on('move', () => { lastPos = posOf() })
bot.on('breath', () => { lastOxy = bot.oxygenLevel ?? null })
const deathRow = via => {
  if (Date.now() - deadAt < 5000) return   // one row a death (the event and the health drop both fire)
  deadAt = Date.now(); deaths++
  const feet = nameAt(0, 0), head = nameAt(0, 1)
  const cause = /lava/.test(`${feet} ${head}`) ? 'lava' : (lastOxy === 0 || /water/.test(head ?? '')) ? 'drowning' : (lastHp != null && lastHp > 0 && feet && !/water|lava/.test(feet)) ? 'fall_or_other' : 'unknown'
  W('events.jsonl', { bot: NAME, t: new Date().toISOString(), death: true, via, pos: posOf() ?? lastPos, feet, head, oxygen: lastOxy, hp_before: lastHp, cause, visit: visitNow })
}
bot.on('health', () => { if (bot.health <= 0) deathRow('health0'); else lastHp = bot.health })
bot.on('death', () => deathRow('death_event'))
bot.on('respawn', () => { W('events.jsonl', { bot: NAME, t: new Date().toISOString(), respawn: true, pos: posOf(), slots: (bot.inventory?.items?.() ?? []).length, visit: visitNow }) })
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
const until = Date.now() + Number(process.env.PIT_MIN ?? 40) * 60000
for (let n = 1; Date.now() < until && !has('stop'); n++) {
  try { SK.townPlanTick(bot) } catch { /* the plan as it stands */ }
  const t = Date.now(), u0 = used()
  visitNow = { n, at: new Date(t).toISOString(), kind: 'pit' }
  let r = null
  const d0 = bag().dirt ?? 0
  try { r = await E.buildPit({ bot }, {}, new AbortController().signal) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } }
  W('decisions.jsonl', { bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, status: r?.status ?? null, stop: r?.stop ?? null, placed: r?.placed ?? null, detail: String(r?.detail ?? '').slice(0, 240), slots: `${u0}->${used()}`, dirt0: d0, dirt: bag().dirt ?? 0, pos: posOf() })
  P(n, r?.status, r?.stop ?? '', String(r?.detail ?? '').slice(0, 120), `${u0}->${used()}`)
  await sleep(r?.status === 'no_effect' ? 15000 : 2000)
}
W('bags.jsonl', { bot: NAME, t: new Date().toISOString(), phase: 'end', bag: bag() })
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
