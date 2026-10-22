#!/usr/bin/env node
// keepout-01 PAPER DRIVER (2026-10-22). SANDBOX ONLY (Paper 1.21.8, 10.0.0.30:25599..25601; never sandbox4). Design:
// docs/reports/comms-design-2026-10-21.md 4.6 (the keepout rows' Paper tests) and 8 row 2 (the bypassed-guard mutant).
//
// A REAL mineflayer bot on a sandbox server, driven by the build's REAL Runner and skills (gather, mine, keepout_exit) from
// <botRoot> (unmodified). WHAT IS SYNTHETIC, said so in every result row:
//   - the arena: a flat plain (stone to 101, dirt 102-104, grass 105, stand 106) with a 3x3 LAVA POOL at y 100 under a 2-high
//     cave (101-102) and the dirt cap -- hive-b's shape (a pool under the ground the bots gather from);
//   - the fire death site is written into this bot's own world facts (worldfacts reportDeath('fire', the pool)), as the
//     death handler would after a death there;
//   - index.mjs's keep-out wiring is copied here (it is not importable): bot.fireSitesNow, the route/break veto on the
//     movements (keepoutStepPenalty / keepoutBreakPenalty via keepout.mjs routeForbids, columnAt, scopeHolds) and the dig
//     guard (keepout.mjs keepoutDigGuard + guardPurpose over digtown.mjs digPurpose), exactly as index.mjs builds them. A base
//     build has no keepout.mjs: none of it is installed (the base as shipped);
//   - no reflex layer (an entombment or drowning reflex would take the body first: the composed chains are unit-tested);
//   - fire resistance + resistance on the bot, so a base bot that digs into the pool survives to be counted.
// OUTCOMES FROM THE WORLD: every dig the bot sent (a recorder outermost on bot.dig), the cells' blocks read back by RCON, the
// bot's position by RCON (`data get entity ... Pos`), and the build's own `_mine_plan` / `_mine_dig` / `_keepout_exit` rows.
//
//   node sandbox/keepout/keepout-e2e.mjs <botRoot> <label> <scene,scene,...> [server]
//   scenes: gather  the bot on the surface above the pool (inside the column) is told `gather dirt 3`
//           ledge   the bot sealed in a 1x1x2 rock pocket above the pool (inside the column): candidate keepout_exit, then gather
//           mine    the bot 10 blocks east of the pool facing it, told `mine` to y 85: its stair would cut the column
//           town    C12: home, a chest and a furnace holding 8 copper ingots inside the column; the bot at home: the exit
//                   decision (keepout.mjs exitDecision, as cognitive.mjs asks it) yields, the real furnace_drain empties the
//                   furnace, then `gather dirt 3` digs nothing in the column; `_keepout_yield` names the town
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `keepout01`. World edits on its arena only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, LABEL, SCENES_S, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENES_S) throw new Error('usage: keepout-e2e.mjs <botRoot> <label> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601 }        // sandbox4 is the model benchmark's: never
if (!PORTS[SERVER]) throw new Error('sandbox servers only (sandbox, sandbox2, sandbox3)')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/keepout01/.test(lock)) throw new Error(`the sandbox lock does not name keepout01: ${lock.trim()}`)
const NAME = `sbx-ko-${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 6)}`
const OUT = process.env.KO_OUT || path.join(os.tmpdir(), 'keepout-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const LOGDIR = fs.mkdtempSync(path.join(OUT, `${LABEL}-`))
const STATE = fs.mkdtempSync(path.join(OUT, `${LABEL}-state-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const C = { x: 4800, y: 100, z: 4800 }          // the pool's centre (the site)
// the TOWN scene's home is in the column; it runs ALONE (Codex r3 P2), so no other scene shares that home
const TOWN = String(SCENES_S).split(',').includes('town')
if (TOWN && String(SCENES_S).split(',').length > 1) throw new Error('run the town scene on its own (its home is inside the column)')
const HOME = TOWN ? { x: 4803, y: 106, z: 4800 } : { x: 4800 + 200, y: 106, z: 4800 }  // the town scene's home is IN the column
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: `sbxko-${LABEL}`, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: `sandbox-${LABEL}`, RUN_ID: 'sandbox-keepout01', LOG_DIR: LOGDIR, STATE_DIR: STATE,
  HOME_X: String(HOME.x), HOME_Y: String(HOME.y), HOME_Z: String(HOME.z),
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements } = breq('mineflayer-pathfinder')
const { SKILLS } = await import(path.join(BOT_ROOT, 'bots/src/skills.mjs'))
const { Runner } = await import(path.join(BOT_ROOT, 'bots/src/runner.mjs'))
const { tapRecords, logEvent } = await import(path.join(BOT_ROOT, 'bots/src/logger.mjs'))
const { Vec3 } = createRequire(path.join(BOT_ROOT, 'bots/package.json'))('vec3')
const { WorldFacts } = await import(path.join(BOT_ROOT, 'bots/src/worldfacts.mjs'))
const { deathSiteStepCost } = await import(path.join(BOT_ROOT, 'bots/src/deathsites.mjs'))
const { digPurpose, currentDigScope } = await import(path.join(BOT_ROOT, 'bots/src/digtown.mjs'))
const KOPATH = path.join(BOT_ROOT, 'bots/src/keepout.mjs')
const KO = fs.existsSync(KOPATH) ? await import(KOPATH) : null
let sha = process.env.KO_SHA || 'unknown'

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ko-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? { x: +(+m[1]).toFixed(2), y: +(+m[2]).toFixed(2), z: +(+m[3]).toFixed(2) } : null }
async function batch (cmds) {
  const out = []; for (let i = 0; i < cmds.length; i += 10) out.push(...rcon(...cmds.slice(i, i + 10)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not/i.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const inCol = p => p && Math.hypot(Math.floor(p.x) - C.x, Math.floor(p.z) - C.z) <= 6 && Math.floor(p.y) >= C.y && Math.floor(p.y) <= C.y + 12
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, sha, server: SERVER, keepout_build: !!KO,
  synthetic: 'arena; the site written into world facts; index.mjs keep-out wiring copied; no reflexes; fire resistance', ...r }) + '\n'); P_('RESULT', r) }

// ---------------------------------------------------------------- the arena
const R = 40
async function arena (scene) {
  const x0 = C.x - R, x1 = C.x + R, z0 = C.z - R, z1 = C.z + R
  const c = [`kill @e[type=!player,x=${x0},y=85,z=${z0},dx=${2 * R},dy=40,dz=${2 * R}]`]
  for (let y = 85; y <= 118; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:${y <= 101 ? 'stone' : y <= 104 ? 'dirt' : y === 105 ? 'grass_block' : 'air'}`)
  c.push(`fill ${C.x - 2} 101 ${C.z - 2} ${C.x + 2} 102 ${C.z + 2} minecraft:air`)          // the cave over the pool
  c.push(`fill ${C.x - 1} 100 ${C.z - 1} ${C.x + 1} 100 ${C.z + 1} minecraft:lava`)        // the pool
  if (scene === 'town') {
    c.push(`setblock ${C.x + 3} 106 ${C.z + 2} minecraft:chest`, `setblock ${C.x + 2} 106 ${C.z - 2} minecraft:furnace`)
  }
  if (scene === 'ledge') {
    c.push(`fill ${C.x + 1} 105 ${C.z - 1} ${C.x + 3} 108 ${C.z + 1} minecraft:stone`)     // a rock pocket on the surface, inside the column
    c.push(`fill ${C.x + 2} 106 ${C.z} ${C.x + 2} 107 ${C.z} minecraft:air`)
  }
  await batch(c)
}

// ---------------------------------------------------------------- the bot
let bot = null
async function connect () {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`,
       `effect give ${NAME} minecraft:resistance 900 4 true`, `effect give ${NAME} minecraft:fire_resistance 900 0 true`,
       `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe 1`, `item replace entity ${NAME} container.1 with minecraft:stone_shovel 1`)
  await sleep(1500)
}
async function disconnect () { try { bot?.quit('scene over') } catch {} bot = null; await sleep(2500) }

function wire (runner, wf) {
  // THE MOVEMENTS, as index.mjs builds them for these profiles (walk: no digging; gather: the dig-capable approach)
  const deathSites = () => wf.deathSites()
  const moves = new Movements(bot); moves.canDig = false; moves.allowParkour = false
  const gatherMoves = Object.create(Object.getPrototypeOf(moves)); Object.assign(gatherMoves, moves)
  gatherMoves.canDig = true; gatherMoves.allow1by1towers = true; gatherMoves.maxDropDown = 6; gatherMoves.dontCreateFlow = true
  if (KO) {
    bot.fireSitesNow = () => KO.fireSites(deathSites())
    // as index.mjs: the arbiter is OFF in production (config.mjs), the scope must be this generation's and a run must be live
    const koHeld = kr => KO.scopeHolds(kr, { reflex: null, holder: runner.arb?.holder?.owner ?? null, arbiter: false, generation: runner.generation, running: !!runner.current })
    const stepPen = block => { const kr = bot.keepoutRoute; if (!kr || !kr.sites.length || !block?.position) return 0; return KO.routeForbids(kr.sites, bot.entity?.position, block.position) && koHeld(kr) ? 101 : 0 }
    const brkPen = block => { const kr = bot.keepoutRoute; if (!kr || !kr.sites.length || !block?.position) return 0; return KO.columnAt(kr.sites, block.position) && koHeld(kr) ? 101 : 0 }
    // the C12 yield and its row, as index.mjs bot.keepoutYields
    bot.keepoutYields = site => {
      const v = KO.coversTown(site, { home: HOME, nameAt: (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null })
      if (v.yields) try { logEvent({ kind: 'keepout_yield', status: 'success', detail: `site=${KO.siteKey(site)} pool=${process.env.MEMORY_POOL} home=${v.home ? 1 : 0} containers=${v.containers} furnaces=${v.furnaces}` }) } catch {}
      return v.yields
    }
    moves.exclusionAreasStep = [b => deathSiteStepCost(deathSites(), b) + stepPen(b)]
    gatherMoves.exclusionAreasStep = moves.exclusionAreasStep
    gatherMoves.exclusionAreasBreak = [b => brkPen(b)]
    const inner = bot.dig
    bot.dig = KO.keepoutDigGuard(inner, { sitesNow: () => bot.fireSitesNow(), purposeOf: () => {
      const holder = runner.arb?.holder?.owner ?? null, skill = runner.current?.skill ?? null, scope = currentDigScope()
      let mining = false; try { mining = !!bot.pathfinder?.isMining?.() } catch {}
      return KO.guardPurpose({ reflex: null, holder, skill, scope, base: digPurpose({ scope, pathfinderMining: mining, movementsPurpose: bot.pathfinder?.movements?.digPurpose ?? null, skill, holder }).purpose })
    } })
  } else {
    moves.exclusionAreasStep = [b => deathSiteStepCost(deathSites(), b)]
    gatherMoves.exclusionAreasStep = moves.exclusionAreasStep
  }
  bot.pathfinder.setMovements(moves)
  bot.gatherMovements = gatherMoves
  bot.withGatherMovements = async fn => { bot.pathfinder.setMovements(gatherMoves); try { return await fn() } finally { bot.pathfinder.setMovements(moves) } }
  bot.ascentMovements = gatherMoves
  bot.withAscentMovements = bot.withGatherMovements
  bot.assertNav = () => {}
  // the recorder, OUTERMOST: every dig the bot sends (a refused one never reaches it)
  const digs = []
  const guarded = bot.dig
  bot.dig = function (b, ...rest) { const p = b?.position; const pr = guarded.call(this, b, ...rest); pr.then(() => { if (p) digs.push({ x: p.x, y: p.y, z: p.z, name: b.name, t: Date.now() }) }, () => {}); return pr }
  return digs
}

async function scene (s) {
  await connect()
  rcon(`tp ${NAME} ${C.x + 0.5} 112 ${C.z + 20.5}`); await sleep(4000)      // load the chunks first
  await arena(s)
  // the town scene starts INSIDE the column but more than 4 blocks from home, so the yield that holds is the TOWN-JOB one
  // (Claude r3 P3-5), not the at-home one
  const start = s === 'mine' ? { x: C.x + 10.5, y: 106, z: C.z + 0.5 } : s === 'ledge' ? { x: C.x + 2.5, y: 106, z: C.z + 0.5 } : s === 'town' ? { x: C.x - 3.5, y: 106, z: C.z - 2.5 } : { x: C.x + 1.5, y: 106, z: C.z + 0.5 }
  rcon(`tp ${NAME} ${start.x} ${start.y} ${start.z}`); await sleep(3000)
  const wf = new WorldFacts(path.join(STATE, `world-facts-${s}.json`))
  wf.reportDeath('fire', { x: C.x + 0.3, y: C.y, z: C.z + 0.2 }, 'sbx-ko-victim')
  const runner = new Runner(bot)
  const digs = wire(runner, wf)
  const rows = []; const untap = tapRecords(r => rows.push(r))
  const runs = []; const t0 = Date.now(); let outAt = null
  const poll = setInterval(() => { try { const p = bot.entity.position; if (!outAt && !inCol(p)) outAt = Date.now() } catch {} }, 250)
  let town = null
  try {
    if (s === 'town') {
      rcon(`item replace block ${C.x + 2} 106 ${C.z - 2} container.2 with minecraft:copper_ingot 8`)
      await sleep(1500)
      const sites = KO ? bot.fireSitesNow() : []
      const d = KO ? KO.exitDecision({ sites, pos: bot.entity.position, home: HOME, skill: 'furnace_drain', yielded: q => bot.keepoutYields(q), yieldOn: KO.townYieldOn({}) }) : { start: false, why: 'base' }
      const dAway = KO ? KO.exitDecision({ sites, pos: bot.entity.position, home: HOME, skill: 'gather', yielded: q => bot.keepoutYields(q), yieldOn: true }) : null
      runs.push(['furnace_drain', await runner.run('furnace_drain', {}, { trigger: 'sandbox' })])
      const left = r1(`data get block ${C.x + 2} 106 ${C.z - 2} Items`)
      town = { decisionOnDrain: { start: d.start, why: d.why }, decisionOnGather: dAway && { start: dAway.start, why: dAway.why },
               furnaceItemsAfter: left.slice(0, 160), ingotsInBag: bot.inventory.items().filter(i => i.name === 'copper_ingot').reduce((a, i) => a + i.count, 0) }
      runs.push(['gather', await runner.run('gather', { block: 'dirt', count: 3 }, { trigger: 'llm:sandbox' })])
    }
    if (s === 'mine') { await bot.look(Math.PI / 2, 0, true).catch(() => {}); runs.push(['mine', await runner.run('mine', { y: 85 }, { trigger: 'llm:sandbox' })]) }
    if (s === 'ledge' && KO) runs.push(['keepout_exit', await runner.run('keepout_exit', {}, { trigger: 'sandbox' })])
    if (s === 'gather' || s === 'ledge') runs.push(['gather', await runner.run('gather', { block: 'dirt', count: 3 }, { trigger: 'llm:sandbox' })])
    if (s === 'gather' && KO && inCol(bot.entity.position)) runs.push(['keepout_exit', await runner.run('keepout_exit', {}, { trigger: 'sandbox' })])
  } finally { clearInterval(poll); untap() }
  const end = posOf()
  const colDigs = digs.filter(inCol)
  const brief = r => ({ name: r.skill?.name, status: r.skill?.status, fc: r.skill?.fail_class, detail: String(r.skill?.detail ?? '').slice(0, 220),
    args: /^_mine_(plan|dig)$/.test(r.skill?.name ?? '') ? { n: r.skill.args?.n, in_column: r.skill.args?.in_column } : undefined })
  const ev = { scene: s, start, end, endInColumn: inCol(end), outAfterS: outAt ? +((outAt - t0) / 1000).toFixed(1) : null, town,
    runs: runs.map(([k, r]) => ({ skill: k, status: r?.status, fc: r?.failClass ?? null, detail: String(r?.detail ?? '').slice(0, 220) })),
    digs: digs.length, columnDigs: colDigs.length, columnDigCells: colDigs.slice(0, 12), lavaBelowBot: end ? /Test passed/.test(r1(`execute if block ${Math.floor(end.x)} ${Math.floor(end.y) - 1} ${Math.floor(end.z)} minecraft:lava`)) : null,
    rows: rows.filter(r => /^_(mine_plan|mine_dig|keepout|keepout_exit|keepout_dispute|keepout_yield|furnace_drain)$/.test(r.skill?.name ?? '')).map(brief).slice(0, 12) }
  await disconnect()
  return ev
}

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scenes=${SCENES_S} keepout=${!!KO}`)
  for (const s of SCENES_S.split(',')) {
    P_('=== scene', s)
    try { result(await scene(s)) } catch (e) { P_('scene failed', s, e.stack || e.message); result({ scene: s, error: String(e.message).slice(0, 300) }); await disconnect() }
  }
}
async function cleanup () {
  await disconnect().catch(() => {})
  try {
    await connect(); rcon(`tp ${NAME} ${C.x + 0.5} 112 ${C.z + 20.5}`); await sleep(3000)
    const x0 = C.x - R, x1 = C.x + R, z0 = C.z - R, z1 = C.z + R
    const c = [`kill @e[type=!player,x=${x0},y=85,z=${z0},dx=${2 * R},dy=40,dz=${2 * R}]`]
    for (let y = 85; y <= 118; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:${y <= 101 ? 'stone' : y <= 104 ? 'dirt' : y === 105 ? 'grass_block' : 'air'}`)
    await batch(c)
    await disconnect()
    P_('cleanup', rcon('list').map(x => x.reply.slice(0, 80)))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
