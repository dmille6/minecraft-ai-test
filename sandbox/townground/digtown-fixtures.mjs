// SANDBOX-ONLY Paper fixtures for the `_dig_town` instrument (bots/src/digtown.mjs; townground-2026-10-13.md 2.3).
//
// Two BARE mineflayer bots (no bot code but the instrument itself, loaded from <botRoot>) dig on a sandbox arena. The
// instrument's per-dig outcome is compared with the WORLD, read over RCON (`execute if block`), cell by cell:
//   confirmed / foreign  <=> the cell no longer holds the dug block;   unconfirmed / aborted / death / rejected <=> it does
// and the read's (cell, +-2 s) dedupe of `confirmed` equals the number of removed cells.
//   S1 normal       5 dirt cells, one bot                                     -> 5 confirmed, 5 removed
//   S2 competing    both bots dig ONE cell at the same instant (x3 cells)    -> 1 removed per cell; deduped confirmed = 1
//   S3 abort        stone by hand, stopDigging after 1 s                      -> aborted, intact
//   S4 death        stone by hand, RCON kill after 1 s                        -> death, intact
//   S5 rejected     a dig within ~300 ms of a fresh join (no player_loaded)  -> whatever Paper does, the outcome agrees with the world
//   S6 pathfinder   a goto through a dirt wall on a dig-capable profile: transit; then the same with the tunnel's tag: target:ore_tunnel
//
//   node sandbox/townground/digtown-fixtures.mjs <botRoot> [server=sandbox4] [scenes=S1,S2,S3,S4,S5,S6]
// Refuses a non-sandbox server; requires /tmp/mcai-sandbox.lock on 10.0.0.31 naming 'townground'.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import sbx from '../lib/sbxlock.cjs'
import path from 'node:path'

const [BOT_ROOT, SERVER = 'sandbox4', SCENES = 'S1,S2,S3,S4,S5,S6'] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!BOT_ROOT || !PORTS[SERVER]) throw new Error('usage: digtown-fixtures.mjs <botRoot> [sandbox..sandbox4] [scenes]')
sbx.requireSandboxLock(SERVER, /townground/)   // the global lock or this server's own (sandbox/lib/sbxlock.cjs); throws unless every lock on SERVER names us
const require = createRequire(path.resolve(BOT_ROOT, 'bots/package.json'))
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { attachDigTown } = await import(path.resolve(BOT_ROOT, 'bots/src/digtown.mjs'))

const OUT = path.resolve(process.env.DT_OUT ?? 'sandbox/log/townground'); fs.mkdirSync(OUT, { recursive: true })
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/fixtures-${RUN}.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tg-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const passed = rep => /Test passed/.test(rep || '')
/** the WORLD: does the cell still hold `name`? true | false | null (not loaded: never a guess) */
function holds (cells) {
  const r = rcon(...cells.map(c => `execute if block ${c.x} ${c.y} ${c.z} minecraft:${c.name}`))
  return r.map(x => /not loaded/i.test(x.reply) ? null : passed(x.reply))
}

// ---- the arena: a dirt slab y 113..119 at 2400..2420, home at its centre (every cell is town ground) -----------------
const HOME = { x: 2410, y: 120, z: 2410 }
const A = { x0: 2400, x1: 2420, z0: 2400, z1: 2420 }
function buildArena () {
  const r = rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`,
    `kill @e[type=item,x=${A.x0},y=100,z=${A.z0},dx=20,dy=40,dz=20]`,
    `fill ${A.x0} 112 ${A.z0} ${A.x1} 130 ${A.z1} minecraft:air`,
    `fill ${A.x0} 113 ${A.z0} ${A.x1} 119 ${A.z1} minecraft:dirt`,
    `fill ${A.x0 - 1} 120 ${A.z0 - 1} ${A.x1 + 1} 122 ${A.z0 - 1} minecraft:barrier`)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Expected/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
  const ok = holds([{ x: 2405, y: 119, z: 2405, name: 'dirt' }, { x: 2415, y: 113, z: 2415, name: 'dirt' }, { x: 2405, y: 120, z: 2405, name: 'air' }])
  if (!ok.every(Boolean)) throw new Error('arena not as built: ' + JSON.stringify(ok))
}

// ---- bots ----------------------------------------------------------------------------------------------------------
const recs = []                      // every instrument row: { bot, scene, args }
const sums = []
let scene = '-'
const ctxOf = {}
async function join (name) {
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: name, auth: 'offline', version: '1.21.8', hideErrors: true })
  bot.on('error', e => P(name, 'error', e.message))
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('kicked', r => rej(new Error('kicked ' + r))); setTimeout(() => rej(new Error('no spawn')), 60000) })
  ctxOf[name] = { skill: 'fixture' }
  attachDigTown(bot, { home: HOME, context: () => ctxOf[name], emitDig: r => recs.push({ bot: name, scene, t: Date.now(), ...r.args }),
                       emitSummary: r => sums.push({ bot: name, scene, ...r.args }), summaryMs: 5000 })
  return bot
}
const at = (bot, x, y, z) => { rcon(`tp ${bot.username} ${x} ${y} ${z} 0 90`, `gamemode survival ${bot.username}`, `clear ${bot.username}`, `effect clear ${bot.username}`) }
async function digCell (bot, c) { const b = bot.blockAt(new Vec3(c.x, c.y, c.z)); if (!b) throw new Error('not loaded ' + JSON.stringify(c)); return bot.dig(b, true) }
const settle = () => sleep(12_000)          // the instrument's 10 s grace + slack

const results = []
function judge (label, expected, rows, { dedupe = false, outcomes = null, purposes = null } = {}) {
  // every expected cell AND every cell the instrument reported (a dig the fixture did not plan is judged too)
  const seen = new Map(expected.map(c => [`${c.x},${c.y},${c.z}`, c]))
  for (const r of rows) if (!seen.has(`${r.x},${r.y},${r.z}`)) seen.set(`${r.x},${r.y},${r.z}`, { x: r.x, y: r.y, z: r.z, name: r.block })
  const cells = [...seen.values()]
  const world = holds(cells)
  const byCell = {}
  for (const r of rows) (byCell[`${r.x},${r.y},${r.z}`] ??= []).push(r.outcome)
  let agree = 0, disagree = []
  cells.forEach((c, i) => {
    const os = byCell[`${c.x},${c.y},${c.z}`] ?? []
    const removed = world[i] === false
    const said = os.some(o => o === 'confirmed' || o === 'foreign')
    if (world[i] == null) disagree.push({ c, why: 'not loaded' })
    else if (removed === said) agree++
    else disagree.push({ c, removed, outcomes: os })
  })
  const confirmedCells = new Set(rows.filter(r => r.outcome === 'confirmed').map(r => `${r.x},${r.y},${r.z}`)).size
  const removedCells = world.filter(v => v === false).length
  const confirmedRows = rows.filter(r => r.outcome === 'confirmed').length
  const out = { scene: label, cells: cells.length, removed: removedCells, agree, disagree, outcomes: rows.map(r => r.outcome),
                confirmed_rows: confirmedRows, confirmed_deduped: confirmedCells, purposes: [...new Set(rows.map(r => `${r.purpose}:${r.by}`))] }
  // EXPECTED CLASSES (Codex code r1 P2): every row's outcome in the scene's allowed set, and the purposes exactly as named
  out.outcome_ok = !outcomes || rows.every(r => outcomes.includes(r.outcome))
  out.purpose_ok = !purposes || JSON.stringify([...new Set(rows.map(r => `${r.purpose}:${String(r.by).split(':')[0]}`))].sort()) === JSON.stringify([...purposes].sort())
  out.pass = disagree.length === 0 && (!dedupe || confirmedCells === removedCells) && rows.length >= expected.length && out.outcome_ok && out.purpose_ok
  results.push(out); P('RESULT', out)
  fs.appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ run: RUN, botRoot: BOT_ROOT, server: SERVER, ...out }) + '\n')
}

const want = new Set(SCENES.split(','))
P('run', RUN, 'botRoot', BOT_ROOT, 'server', SERVER, 'scenes', [...want])
buildArena()
let a = await join('sandbox-DigA'); let b = await join('sandbox-DigB')
at(a, 2405.5, 120, 2405.5); at(b, 2407.5, 120, 2405.5)
await sleep(5000)                            // past Paper's 60-tick "loaded" window (the bots never send player_loaded)

if (want.has('S1')) {
  scene = 'S1'; ctxOf[a.username] = { skill: 'gather', args: { block: 'dirt' } }
  const cells = [0, 1, 2, 3, 4].map(k => ({ x: 2403 + k, y: 119, z: 2403, name: 'dirt' }))
  for (const c of cells) { await digCell(a, c).catch(e => P('S1 dig err', e.message)); await sleep(300) }
  await settle(); judge('S1 normal (gather)', cells, recs.filter(r => r.scene === 'S1'), { dedupe: true, outcomes: ['confirmed'], purposes: ['target:gather'] })
}
if (want.has('S2')) {
  scene = 'S2'; ctxOf[a.username] = ctxOf[b.username] = { skill: 'gather', args: { block: 'dirt' } }
  const cells = [0, 1, 2].map(k => ({ x: 2405 + k, y: 119, z: 2407, name: 'dirt' }))
  for (const c of cells) { await Promise.allSettled([digCell(a, c), digCell(b, c)]); await sleep(500) }
  await settle(); judge('S2 competing (two bots, one cell)', cells, recs.filter(r => r.scene === 'S2'), { dedupe: true, outcomes: ['confirmed', 'foreign'], purposes: ['target:gather'] })
}
if (want.has('S3')) {
  scene = 'S3'; ctxOf[a.username] = { skill: 'mine', args: { y: 100 } }
  rcon('setblock 2404 120 2406 minecraft:stone'); await sleep(500)
  const c = { x: 2404, y: 120, z: 2406, name: 'stone' }
  const p = digCell(a, c).catch(e => P('S3 dig err (expected)', e.message)); await sleep(1000); a.stopDigging(); await p
  await settle(); judge('S3 abort', [c], recs.filter(r => r.scene === 'S3'), { outcomes: ['aborted'], purposes: ['target:mine'] })
}
if (want.has('S4')) {
  scene = 'S4'; ctxOf[a.username] = { skill: 'mine', args: { y: 100 } }
  rcon('setblock 2404 120 2404 minecraft:stone'); await sleep(500)
  const c = { x: 2404, y: 120, z: 2404, name: 'stone' }
  const p = digCell(a, c).catch(e => P('S4 dig err (expected)', e.message)); await sleep(1000); rcon(`kill ${a.username}`); await p
  await sleep(3000); try { a.respawn?.() } catch {}
  await settle(); judge('S4 death', [c], recs.filter(r => r.scene === 'S4'), { outcomes: ['death'], purposes: ['target:mine'] })
  at(a, 2405.5, 120, 2405.5); await sleep(4000)
}
if (want.has('S5')) {
  scene = 'S5'
  b.quit(); await sleep(4000)
  const c = { x: 2408, y: 119, z: 2405, name: 'dirt' }
  b = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: 'sandbox-DigB', auth: 'offline', version: '1.21.8', hideErrors: true })
  ctxOf['sandbox-DigB'] = { skill: 'gather', args: { block: 'dirt' } }
  // bot.dig exists only once mineflayer has injected its plugins (after createBot returns): attach at login, before spawn
  await new Promise(res => b.once('login', res))
  const att = attachDigTown(b, { home: HOME, context: () => ctxOf['sandbox-DigB'], emitDig: r => recs.push({ bot: 'sandbox-DigB', scene, t: Date.now(), ...r.args }),
                     emitSummary: r => sums.push({ bot: 'sandbox-DigB', scene, ...r.args }), summaryMs: 5000 })
  if (!att) throw new Error('S5: the instrument did not attach (bot.dig missing)')
  await new Promise(res => b.once('spawn', res))
  await new Promise(res => setTimeout(res, 300))
  const seenBlock = b.blockAt(new Vec3(c.x, c.y, c.z)); P('S5 the client sees', seenBlock?.name, 'at', c)
  const t = Date.now(); await digCell(b, c).catch(e => P('S5 dig err', e.message)); P('S5 dig settled after', Date.now() - t, 'ms since +300')
  await sleep(12_000); P('S5 summaries', sums.filter(x => x.scene === 'S5'))
  await settle(); judge('S5 dig right after join (no player_loaded)', [c], recs.filter(r => r.scene === 'S5'), { outcomes: ['unconfirmed', 'confirmed'], purposes: ['target:gather'] })
  rcon('setblock 2408 119 2405 minecraft:dirt')
}
if (want.has('S6')) {
  a.loadPlugin(pathfinder)
  const mk = tag => { const m = new Movements(a); m.canDig = true; m.allowParkour = false; m.scafoldingBlocks = []; if (tag) m.digPurpose = tag; return m }
  for (const [label, tag, z, want] of [['S6a transit', null, 2412, 'transit:gather'], ['S6b tunnel tag', 'target:ore_tunnel', 2416, 'target:ore_tunnel']]) {
    scene = label; ctxOf[a.username] = { skill: 'gather', args: { block: 'iron_ore' } }
    // a sealed 1-wide dirt corridor: the bot at one end, the goal through 2 solid columns
    rcon(`fill 2402 120 ${z - 1} 2410 122 ${z + 1} minecraft:dirt`, `fill 2403 120 ${z} 2409 121 ${z} minecraft:air`, `fill 2405 120 ${z} 2406 121 ${z} minecraft:dirt`)
    at(a, 2403.5, 120, z + 0.5); await sleep(2500)
    const cells = [{ x: 2405, y: 120, z, name: 'dirt' }, { x: 2405, y: 121, z, name: 'dirt' }, { x: 2406, y: 120, z, name: 'dirt' }, { x: 2406, y: 121, z, name: 'dirt' }]
    a.pathfinder.setMovements(mk(tag))
    try { await Promise.race([a.pathfinder.goto(new goals.GoalBlock(2408, 120, z)), sleep(40000).then(() => { throw new Error('goto timeout') })]) } catch (e) { P(label, 'goto', e.message) }
    a.pathfinder.setGoal(null)
    await settle(); judge(label, cells, recs.filter(r => r.scene === label), { dedupe: true, outcomes: ['confirmed'], purposes: [want] })
  }
}
P('SUMMARY ROWS', sums.length, 'last', sums.slice(-2))
const ok = results.every(r => r.pass)
P(ok ? 'ALL FIXTURES PASS' : 'FIXTURE FAILURE', results.map(r => `${r.scene}: ${r.pass ? 'PASS' : 'FAIL'}`))
try { a.quit(); b.quit() } catch {}
try { rcon(`forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch {}
setTimeout(() => process.exit(ok ? 0 : 1), 1500)
