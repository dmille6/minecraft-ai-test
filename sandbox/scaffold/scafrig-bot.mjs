// SANDBOX-ONLY rig bot for scaffold-01show (a Paper sandbox on the worlds host, never a live world). The orchestrator
// (sandbox/scaffold/scafrig.sh, Mac side) builds each scene by RCON, places the bot, gives it 64 dirt, writes trial-<n>.json here and
// waits for result-<n>.json. This bot walks the trial's legs with the movement profiles built as index.mjs builds them (the walk:
// canDig off, 1x1 towers on the extended scaffold list, no parkour, maxDropDown 6, placeCost 5, liquidCost 2, nobridge, the corner
// rule, the town price + whatever scaftown.mjs of THIS checkout adds; gather: canDig on, dontCreateFlow, capped searches, with this
// checkout's flags), the place audit's receipts and THIS checkout's take-back (takeback.mjs), each leg fenced by skills.mjs
// withTimeout exactly as gotoLegs fences one. The same script runs over the base checkout and the head: only the modules differ.
//   BOT_ROOT=<checkout> node scafrig-bot.mjs <dir> <port>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
const [DIR, PORT] = process.argv.slice(2)
const ROOT = path.resolve(process.env.BOT_ROOT)
Object.assign(process.env, { OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', LOG_DIR: path.join(DIR, 'log'), STATE_DIR: path.join(DIR, 'state'), POOL_STATE_DIR: path.join(DIR, 'pool'), LOG_LEVEL: 'error' })
const req = createRequire(path.join(ROOT, 'bots', 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const imp = f => import(path.join(ROOT, 'bots', 'src', f))
const [ST, TB, PA, SC, NB, CR, SK] = await Promise.all(['scaftown.mjs', 'takeback.mjs', 'placeaudit.mjs', 'scaffold.mjs', 'nobridge.mjs', 'cornermoves.mjs', 'skills.mjs'].map(imp))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const W = (f, o) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(o))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(PORT), username: 'sbx-Scaf', auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder)
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 90000) })
let deaths = 0
bot.on('death', () => { deaths++ })
const rows = []
const emit = (kind, status, detail) => rows.push({ kind, status, detail, t: Date.now() })
const HOME = { x: Number(process.env.RIG_HOME_X ?? 0), y: 100, z: Number(process.env.RIG_HOME_Z ?? 0) }   // the town is far away
// the walk profile as index.mjs builds it
const moves = new Movements(bot)
moves.canDig = false; moves.allow1by1towers = true; SC.extendScaffolding(moves, bot.registry); moves.allowParkour = false; moves.maxDropDown = 6; moves.placeCost = 5; moves.liquidCost = 2
NB.installNoBridge(moves, (x, y, z) => bot.blockAt(new Vec3(x, y, z)), () => bot.game?.minY ?? -64)
CR.installCornerRule(moves)
const area = ST.scafAreaOf({ home: HOME })
const price = ST.makeScafTownPrice({ area: () => area, on: true, wild: ST.scafWildOn ? ST.scafWildOn(process.env) : undefined, now: () => performance.now() })
ST.installScafTownPrice(moves, price)
ST.installScafTownSearch(bot.pathfinder, price)
const gather = Object.assign(Object.create(Object.getPrototypeOf(moves)), moves)
gather.canDig = true; gather.allow1by1towers = true; gather.dontCreateFlow = true
if (ST.scafProfileFlags) Object.assign(gather, ST.scafProfileFlags('gather')); else gather.scafTown = false   // the base: gather exempt
bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk'
const tb = TB.installTakeback(bot, { emit, timers: true })
const sums = []
const placed = []
bot.on('blockPlaced', (o, n) => placed.push(`${n?.position}:${n?.name}`))
const pa = PA.attachPlaceAudit(bot, { home: HOME, onPlaced: r => tb?.note(r), emitPlace: () => {}, emitSummary: ({ detail }) => sums.push(detail), timers: false })
const perr = []
{ const inner = bot.placeBlock; bot.placeBlock = async function (ref, face) { const t0 = Date.now(); const dest = ref.position.plus(face); try { return await inner.call(this, ref, face) } catch (e) { const at = bot.blockAt(dest)?.name; perr.push({ dest: `${dest}`, ms: Date.now() - t0, err: String(e?.message).slice(0, 80), atFail: at }); const k = `blockUpdate:${dest}`; const rec = perr.at(-1); const on = (o, n) => { rec.late = `${n?.name}@${Date.now() - t0}` }; bot.once(k, on); setTimeout(() => bot.removeListener(k, on), 8000); throw e } } }
const resets = []
bot.on('path_reset', why => resets.push(why))
const code = (() => { try { return fs.readFileSync(path.join(ROOT, 'COMMIT'), 'utf8').trim() } catch { return '?' } })()
W('ready.json', { pid: process.pid, code, wild: price.wildCost ?? 0, gatherPriced: gather.scafTown !== false })
const goalOf = g => (g.near ? new goals.GoalNear(g.x, g.y, g.z, g.near) : new goals.GoalBlock(g.x, g.y, g.z))
const dirt = () => (bot.inventory.items().filter(i => i.name === 'dirt').reduce((s, i) => s + i.count, 0))
for (let n = 1; ; n++) {
  const f = path.join(DIR, `trial-${n}.json`)
  while (!fs.existsSync(f)) { if (fs.existsSync(path.join(DIR, 'quit'))) { bot.quit(); await sleep(300); process.exit(0) } await sleep(200) }
  const tr = JSON.parse(fs.readFileSync(f, 'utf8'))
  await sleep(1500)                                     // the tp and the give have landed
  const r0 = rows.length, d0 = deaths, dirt0 = dirt()
  const legs = []
  // the take-back's view, sampled while the legs run (diagnostics: open receipts, ripe ones, the library's state)
  const trace = []
  const tick = setInterval(() => {
    try {
      const e = bot.entity, op = tb.state.open.filter(r => !r.closed)
      if (!op.length) return
      const h = { pos: e.position, feet: TB.feetOf(e.position), onGround: !!e.onGround, inWater: !!e.isInWater }
      trace.push([Date.now() % 1e6, +e.position.x.toFixed(1), +e.position.y.toFixed(1), +e.position.z.toFixed(1), e.onGround ? 1 : 0, op.length, op.filter(r => TB.ripe(r, h, Date.now())).length, bot.pathfinder.isBuilding() ? 1 : 0, bot.pathfinder.goal ? 1 : 0, op.filter(r => r.used).length, op.filter(r => TB.ripe(r, h, Date.now())).map(r => { const b = bot.blockAt(new Vec3(...r.cell)); return `${r.cell.join(',')}:${b?.name}:see${bot.canSeeBlock(b) ? 1 : 0}:mine${bot.pathfinder.isMining() ? 1 : 0}` }).join(' ')])
    } catch { /* diagnostics */ }
  }, 200)
  for (const leg of tr.legs) {
    const t0 = Date.now()
    let ok = 'ok'
    const run = async () => {
      if (leg.profile === 'gather') {
        bot.pathfinder.setMovements(gather); bot.movementProfile = 'gather'; const before = bot.pathfinder.searchRadius; bot.pathfinder.searchRadius = 400
        try { await SK.withTimeout(bot.pathfinder.goto(goalOf(leg.goal)), leg.ms ?? 60000, bot, { needsDrop: false }) } finally { bot.pathfinder.searchRadius = before; bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk' }
      } else await SK.withTimeout(bot.pathfinder.goto(goalOf(leg.goal)), leg.ms ?? 60000, bot, { needsDrop: false })
    }
    try { await run() } catch (e) { ok = String(e?.name ?? '') + ':' + String(e?.message ?? e).slice(0, 60) }
    legs.push({ ok, ms: Date.now() - t0, at: bot.entity.position, health: bot.health, oxygen: bot.oxygenLevel ?? null })
    await sleep(leg.pause ?? 500)
  }
  await sleep(1500)
  clearInterval(tick)
  try { pa.flush() } catch { /* diagnostics */ }
  await sleep(3000)
  const audit = sums.splice(0), events = placed.splice(0), why = resets.splice(0), fails = perr.splice(0)
  const mine = rows.slice(r0)
  const cnt = re => mine.filter(r => re.test(`${r.kind} ${r.detail}`)).length
  W(`result-${n}.json`, { n, scene: tr.scene, legs, deaths: deaths - d0, dirtUsed: dirt0 - dirt(), dug: cnt(/^takeback outcome=dug/), carried: cnt(/^takeback outcome=carried/), left: cnt(/^takeback outcome=left/), adopted: cnt(/^takeback outcome=adopted/), walks: mine.filter(r => r.kind === 'takeback_walk').map(r => r.detail), outcomes: mine.filter(r => r.kind === 'takeback').map(r => /outcome=(\S+) why=(\S+)/.exec(r.detail)?.slice(1).join(':')), trace: trace.slice(0, 400), audit, blockPlaced: events, resets: why, fails })
}
