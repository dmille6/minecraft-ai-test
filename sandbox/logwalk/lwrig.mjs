// SANDBOX-ONLY (sandbox2, a COPY of the showcase world as saved 11-18 -- never a live world): logwalk-01show rig, derived from
// sandbox/nostock (nsrig.mjs) and the T11 rig. A bot on the world copy with a copy of the showcase pool (the town plan, the zones, the
// bots' atlas files) walks to a spot within ~12 blocks of the town centre (where 99 of the 117 live failures 11-20 started) and runs
// the REAL `gather spruce_log` skill (skills.mjs SKILLS.gather: gatherRun under withKeepout) with the gather profile index.mjs builds
// (the plan's cells, the zones and keep-out priced 100, canDig, dontCreateFlow), and the atlas installed as features.mjs installs it.
// Each try writes tries.jsonl: the result, the logs gained, the time, the walk rows. Once, from the centre: the census of every log
// within LW_SCAN blocks (built / cave floor / free) and the nearest free one -> census.jsonl.
//   node sandbox/logwalk/lwrig.mjs <bot> <out dir>      (env LW_TRIES, default 6; LW_SPOT index; LW_PORT 25600 = sandbox2)
// NO SURVIVAL REFLEXES (as t11rig): deaths are written to events.jsonl.
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
  if (url.endsWith('/bots/src/skills.mjs')) r.source = String(r.source) + `\nexport const __setActive = b => { activeMem = { ...(activeMem ?? {}), bot: b } }\n`
  return r
} })
const BOTS = path.resolve('bots')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const collectBlock = req('mineflayer-collectblock').plugin
const { Vec3 } = req('vec3')
const imp = f => import(path.join(BOTS, 'src', f))
const [SK, TP, PZ, GB, FE, CF, TD] = await Promise.all(['skills.mjs', 'townplan.mjs', 'protectzone.mjs', 'gatherbuilt.mjs', 'features.mjs', 'config.mjs', 'towndeposit.mjs'].map(imp))
const { tapRecords } = await imp('logger.mjs')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const has = f => fs.existsSync(path.join(OUT, f))
const W = (f, o) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(o) + '\n')
const P = (...a) => console.log(`[${NAME} ${((Date.now() - T0) / 1000).toFixed(0)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(process.env.LW_PORT ?? 25600), username: NAME, auth: 'offline', version: '1.21.8' })
bot.loadPlugin(pathfinder); bot.loadPlugin(collectBlock)
const { worldIdFromLogin } = await imp('composter.mjs')
const POOL_SEED = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(OUT, 'pool', 'protected-zones.json'), 'utf8')).hashed_seed ?? '') } catch { return '' } })()
bot._client.on('login', p => { bot.loginWorldId = worldIdFromLogin(p); bot.worldId = POOL_SEED || bot.loginWorldId })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 240000) })
let deaths = 0
bot.on('death', () => { deaths++; W('events.jsonl', { bot: NAME, t: new Date().toISOString(), death: true, pos: bot.entity?.position }) })
;(await imp('craftsync.mjs')).installCraftSync(bot, { log: () => {} })
// the zones and the plan as index.mjs reads them
const zoneRd = PZ.zoneReader({ file: () => PZ.zonesFileIn(path.join(OUT, 'pool')), worldId: () => bot.worldId ?? null })
zoneRd.refresh(); setInterval(() => zoneRd.refresh(), 30_000).unref()
bot.protectZones = () => zoneRd.zones()
try { SK.townPlanTick(bot) } catch { /* the plan as it stands */ }
try { SK.townPlanHead(bot) } catch { /* read again by gather */ }
// THE PROFILES (index.mjs 640-845, the parts gather reads): the walk prices the plan's cells and the zones 100; the gather clone digs
const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
mv.scafoldingBlocks = ['cobblestone', 'dirt'].map(n => bot.registry.itemsByName[n]?.id).filter(v => v != null)
const zonePrice = PZ.zoneCost(() => bot.protectZones?.() ?? [], { feet: () => bot.entity?.position ?? null })
mv.exclusionAreasBreak = [b => TP.planBreakCost(bot.townPlan?.cells, b), zonePrice]
bot.pathfinder.setMovements(mv)
const gm = Object.create(Object.getPrototypeOf(mv)); Object.assign(gm, mv)
gm.canDig = true; gm.allowParkour = false; gm.allow1by1towers = true; gm.maxDropDown = 6; gm.dontCreateFlow = true; gm.scafTown = false
gm.exclusionAreasBreak = [...mv.exclusionAreasBreak]
bot.gatherMovements = gm
bot.collectBlock.movements = gm
bot.withGatherMovements = async fn => { bot.pathfinder.setMovements(gm); bot.movementProfile = 'gather'; try { return await fn() } finally { bot.pathfinder.setMovements(mv); bot.movementProfile = 'walk' } }
const tdMoves = TD.townWalkMovements(mv)
bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(tdMoves); bot.movementProfile = 'town_deposit_walk'; try { return await fn() } finally { bot.pathfinder.setMovements(mv); bot.movementProfile = 'walk' } }
SK.__setActive(bot)
try { FE.installAtlasFeature(bot) } catch (e) { P('atlas not installed', String(e?.message ?? e)) }
const logs = () => (bot.inventory?.items?.() ?? []).filter(i => /_log$/.test(i.name)).reduce((a, i) => a + i.count, 0)
const pos = () => { const p = bot.entity?.position; return p ? [Math.round(p.x), Math.round(p.y), Math.round(p.z)] : null }
// spots within ~12 blocks of the town centre (home 0,70,0), one per bot (LW_SPOT), the try's start
const SPOTS = [[6, 4], [-5, 8], [9, -6], [-8, -7], [2, 11], [11, 2]]
const spot = SPOTS[Number(process.env.LW_SPOT ?? 0) % SPOTS.length]
// THE START (rig fixture, sandbox only): every try starts on the surface at the spot -- the rig asks its driver for a reset
// (reset-<bot>: the Mac driver runs `spreadplayers <x> <z> 0 1 false <bot>` over sandbox2's RCON and deletes the file), so a
// try that ended in a cave or 80 blocks out does not decide where the next one starts
const toSpot = async () => {
  const f = path.join(OUT, `reset-${NAME}`)
  fs.writeFileSync(f, `${spot[0]} ${spot[1]}`)
  for (let i = 0; i < 240 && fs.existsSync(f); i++) await sleep(500)
  if (fs.existsSync(f)) { P('reset not served'); try { fs.unlinkSync(f) } catch {} }
  await sleep(2500)
  return pos()
}
fs.writeFileSync(path.join(OUT, `ready-${NAME}`), String(process.pid))
P('ready pid', process.pid, 'code', CF.config.code.version, 'zones', zoneRd.zones().length, 'plan cells', bot.townPlan?.cells?.size ?? null, 'atlas', !!bot.atlas, 'finds', bot.atlas?.view?.()?.finds?.length ?? null)
while (!has('go')) await sleep(500)
await sleep(1500)
await toSpot()
// THE CENSUS (once, the first bot): every log within LW_SCAN of the centre -> built (the gather profile prices it 100) / cave floor /
// free, and the nearest free one's distance from the town centre
if (process.env.LW_CENSUS) {
  try {
    const ids = Object.values(bot.registry.blocksByName).filter(b => /_log$/.test(b.name)).map(b => b.id)
    const R = Number(process.env.LW_SCAN ?? 128)
    const cave = SK.caveFilter(bot)
    const all = bot.findBlocks({ matching: ids, maxDistance: R, count: 20000 })
    const rows = all.map(p => {
      const b = bot.blockAt(p)
      const built = GB.isBuiltCell(gm, b), floor = !built && cave.skip(p)
      return { x: p.x, y: p.y, z: p.z, kind: b?.name, d: Math.round(Math.hypot(p.x, p.z)), cls: built ? 'built' : floor ? 'cave' : 'free' }
    })
    const free = rows.filter(r => r.cls === 'free').sort((a, b) => a.d - b.d)
    const by = c => rows.filter(r => r.cls === c).length
    const within = (c, r) => rows.filter(q => q.cls === c && q.d <= r).length
    W('census.jsonl', { bot: NAME, from: pos(), R, logs: rows.length, built: by('built'), cave: by('cave'), free: by('free'),
      within32: { built: within('built', 32), cave: within('cave', 32), free: within('free', 32) }, within64: { built: within('built', 64), cave: within('cave', 64), free: within('free', 64) },
      nearestFree: free.slice(0, 5) })
    // LW_FIXR (the FIXTURE, sandbox only): every FREE log within LW_FIXR of the centre -> `setblock x y z air` lines (fixture.cmds),
    // so the town's near logs are built cells and cave floors only and the nearest free wood is LW_FIXR+ out (the showcase 11-20)
    if (process.env.LW_FIXR) {
      const fr = Number(process.env.LW_FIXR)
      const cut = rows.filter(r => r.cls === 'free' && r.d <= fr)
      fs.writeFileSync(path.join(OUT, 'fixture.cmds'), cut.map(r => `setblock ${r.x} ${r.y} ${r.z} air`).join('\n') + '\n')
      fs.writeFileSync(path.join(OUT, 'fixture-cut.json'), JSON.stringify(cut))
      P('fixture', cut.length, 'free logs within', fr, 'to cut')
    }
    P('census', rows.length, 'logs; built', by('built'), 'cave', by('cave'), 'free', by('free'), 'nearest free', JSON.stringify(free[0] ?? null))
  } catch (e) { P('census threw', String(e?.stack ?? e).slice(0, 300)) }
}
const N = Number(process.env.LW_TRIES ?? 6)
for (let n = 1; n <= N && !has('stop'); n++) {
  const start = await toSpot()
  const rows = []
  const untap = tapRecords(r => { const k = r?.skill?.name; if (/^_(gather_walk|gather_built|cavefall_skip|gather_zone|town_ground)$/.test(k ?? '')) rows.push(`${k} ${r.skill.status} ${String(r.skill.detail).slice(0, 200)}`) })
  const l0 = logs(), t = Date.now()
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 180_000)
  let r = null
  // THE RUNNER'S HARD STOP, as the rig has it (the runner ends a skill at its contract, 180 s, plus grace): a run still going at
  // 200 s is written `hung` and this bot stops (its promise may still hold the pathfinder, so no later try would be clean)
  let hung = false
  const hard = sleep(200_000).then(() => { hung = true; return { status: 'hung', detail: 'still running 20 s after the 180 s abort (the rig has no runner hard stop)' } })
  try { r = await Promise.race([SK.SKILLS.gather.run({ bot }, { block: 'spruce_log', count: 4 }, ac.signal), hard]) } catch (e) { r = { status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) } } finally { clearTimeout(timer); untap(); try { bot.pathfinder.setGoal(null) } catch {} }
  const row = { bot: NAME, n, t: new Date(t).toISOString(), ms: Date.now() - t, start, end: pos(), status: r?.status ?? null, failClass: r?.failClass ?? null,
    detail: String(r?.detail ?? '').slice(0, 300), logs: logs() - l0, code: CF.config.code.version, deaths, rows }
  W('tries.jsonl', row)
  P(n, r?.status, r?.failClass ?? '', `+${row.logs} logs`, `${row.ms} ms`, String(r?.detail ?? '').slice(0, 140), JSON.stringify(rows.filter(x => /gather_walk/.test(x))))
  // the bag: logs tossed (a sandbox world) so the next try starts the same
  for (const it of (bot.inventory?.items?.() ?? []).filter(i => /_log$/.test(i.name))) { try { await bot.tossStack(it) } catch {} }
  if (hung) break
  await sleep(2000)
}
fs.writeFileSync(path.join(OUT, `done-${NAME}`), JSON.stringify({ deaths }))
bot.quit(); await sleep(500); process.exit(0)
