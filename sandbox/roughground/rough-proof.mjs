// SANDBOX-ONLY (roughground-1b/1c/2, 2026-11-07): THE GROUNDSKEEPER'S ROUGH-GROUND WORK ON PAPER, WITH THE BOTS' OWN CODE.
//   BOT_ROOT=<worktree> SBX=sandbox6 PORT=25604 SCENE=hollow|stand|grass node sandbox/roughground/rough-proof.mjs
// The record is the bots' own: tidy.mjs siteStage('inwall') on the bot's world read (roughground.mjs surveyRough inside it); the work
// is buildrun.mjs runVisit with the tidy visit's options (skills.mjs buildTidy: the cuts, the layered fills, tidyOk = cutSafeNow +
// no other body on the cell + roughground-1b hollowClear); the walks and clicks are buildbot.mjs botBuildEffects (mineflayer-pathfinder,
// the server-witnessed dig and place). RCON builds the scene (a sandbox only) and reads the result (`execute if block`).
//   hollow  A: a raised grass crust over a 2-deep hollow -> the crust cut AND the hollow filled, the column solid to the ground.
//           B: the same with an armor stand standing IN the hollow -> the crust is not cut while it is there; removed, the next visit
//           cuts and fills it.
//   stand   (1c) a dirt block floating 8 over the grass: a stand of stone is built beside it, the block cut from the stand, the stand
//           taken down (tidy.mjs platformTeardown) -> the block gone, every stand cell air, nothing left.
//   grass   (2) bare dirt next to grass in daylight, default random tick speed: minutes until each greens (a measurement, no bot).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const BOT_ROOT = path.resolve(process.env.BOT_ROOT || '.')
const req = createRequire(path.join(BOT_ROOT, 'bots', 'package.json'))
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const imp = f => import(path.join(BOT_ROOT, 'bots/src', f))
const SERVER = process.env.SBX || 'sandbox6'
const PORT = Number(process.env.PORT || 25604)
const SCENE = process.env.SCENE || 'hollow'
const NAME = `sbx-Rough${SCENE.slice(0, 4)}`
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
const rcon = (...cmds) => {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const isBlock = (x, y, z, b) => /Test passed/.test(rcon(`execute if block ${x} ${y} ${z} ${b}`)[0]?.reply || '')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const RES = path.join(path.dirname(new URL(import.meta.url).pathname), `rough-proof-${SCENE}.jsonl`)
const rec = o => fs.appendFileSync(RES, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n')

const HX = SCENE === 'grass' ? 500 : 400, HY = 120, HZ = 400, R0 = 24
const fillAll = (x0, y0, z0, x1, y1, z1, block) => { const out = []; const per = Math.max(1, Math.floor(32768 / ((y1 - y0 + 1) * (z1 - z0 + 1)))); for (let x = x0; x <= x1; x += per) out.push(`fill ${x} ${y0} ${z0} ${Math.min(x1, x + per - 1)} ${y1} ${z1} minecraft:${block}`); return out }

async function arena () {
  rcon(`forceload add ${HX - R0 - 4} ${HZ - R0 - 4} ${HX + R0 + 4} ${HZ + R0 + 4}`, 'gamerule doTileDrops true', 'gamerule doDaylightCycle false', 'time set 6000')
  rcon(...fillAll(HX - R0, HY - 6, HZ - R0, HX + R0, HY - 6, HZ + R0, 'stone'), ...fillAll(HX - R0, HY - 5, HZ - R0, HX + R0, HY - 2, HZ + R0, 'dirt'),
    ...fillAll(HX - R0, HY - 1, HZ - R0, HX + R0, HY - 1, HZ + R0, 'grass_block'), ...fillAll(HX - R0, HY, HZ - R0, HX + R0, HY + 16, HZ + R0, 'air'),
    `kill @e[type=!player,x=${HX - R0 - 2},y=${HY - 8},z=${HZ - R0 - 2},dx=${2 * R0 + 4},dy=30,dz=${2 * R0 + 4}]`)
}

async function grassScene () {
  await arena()
  // 24 bare dirt cells in the grass, each with grass on its 4 sides (sky light 15 above), random tick speed at its default 3
  const cells = []
  for (let i = 0; i < 24; i++) { const x = HX - 15 + (i % 6) * 5, z = HZ - 15 + Math.floor(i / 6) * 5; cells.push([x, HY - 1, z]) }
  // and 8 where the dirt is TWO from any grass (a 3x3 dirt patch's centre): no neighbour to spread from inside 1 -> the far case
  const far = []
  for (let i = 0; i < 4; i++) { const x = HX + 12, z = HZ - 15 + i * 8; rcon(`fill ${x - 1} ${HY - 1} ${z - 1} ${x + 1} ${HY - 1} ${z + 1} minecraft:dirt`); far.push([x, HY - 1, z]) }
  rcon('gamerule randomTickSpeed 3', ...cells.map(c => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:dirt`))
  const greened = new Map(), farG = new Map()
  const t0 = Date.now()
  while (Date.now() - t0 < 30 * 60_000 && (greened.size < cells.length || farG.size < far.length)) {
    await sleep(30_000)
    const m = (Date.now() - t0) / 60_000
    for (const c of cells) if (!greened.has(c.join(',')) && isBlock(...c, 'minecraft:grass_block')) greened.set(c.join(','), m)
    for (const c of far) if (!farG.has(c.join(',')) && isBlock(...c, 'minecraft:grass_block')) farG.set(c.join(','), m)
    P(`t=${m.toFixed(1)} min: next-to-grass greened ${greened.size}/${cells.length}; centre of a 3x3 dirt patch greened ${farG.size}/${far.length}`)
  }
  const ts = [...greened.values()].sort((a, b) => a - b)
  const out = { kind: 'grass', n: cells.length, greened: greened.size, median_min: ts[Math.floor(ts.length / 2)] ?? null, max_min: ts.at(-1) ?? null, far: far.length, farGreened: farG.size, farTimes: [...farG.values()] }
  rec(out); P('RESULT', out)
  return out
}

async function main () {
  P('lock', sbx.requireSandboxLock(SERVER, 'roughground'))
  if (SCENE === 'grass') return grassScene()
  const mineflayer = req('mineflayer')
  const { pathfinder, Movements } = req('mineflayer-pathfinder')
  const { Vec3 } = req('vec3')
  const [T, LP, R, PJ, BB, RG] = await Promise.all(['tidy.mjs', 'landplan.mjs', 'buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'roughground.mjs'].map(imp))
  await arena()
  // THE SCENE
  const A = [HX + 6, HZ], B = [HX + 6, HZ + 8]
  const scene = []
  if (SCENE === 'hollow') {
    for (const [x, z] of [A, B]) scene.push(`setblock ${x} ${HY - 1} ${z} minecraft:air`, `setblock ${x} ${HY - 2} ${z} minecraft:air`, `setblock ${x} ${HY} ${z} minecraft:grass_block`)
    scene.push(`summon minecraft:armor_stand ${B[0] + 0.5} ${HY - 2} ${B[1] + 0.5} {NoGravity:1b,Invulnerable:1b,Tags:["roughproof"]}`)
  } else if (SCENE === 'stand') {
    scene.push(`setblock ${A[0]} ${HY + 7} ${A[1]} minecraft:dirt`)   // 8 over the grass top (HY - 1): out of a ground stand's reach
  }
  rcon(...scene)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`,
    `give ${NAME} minecraft:dirt 64`, `give ${NAME} minecraft:cobblestone 64`, `give ${NAME} minecraft:iron_shovel 1`, `give ${NAME} minecraft:iron_pickaxe 1`)
  await sleep(4000)
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox } : null }
  const home = { x: HX, y: HY, z: HZ }
  const stage = LP.landStages().find(q => q.id === 'inwall')
  const wall = { ring: [HX - R0 + 2, HZ - R0 + 2, HX + R0 - 2, HZ + R0 - 2] }
  const s = T.siteStage(read, { home, land: { seed: 1 }, stage, env: { ROUGH: 'on' }, terrace: { wall, records: [] } })
  if (!s.record) { P('NO RECORD', s.why, JSON.stringify(s.survey?.skipped ?? {})); rec({ kind: 'no_record', why: s.why }); bot.quit(); return }
  P('record', 'cuts', s.record.cut.map(c => `${c.at.join(',')}${c.hollow ? ` hollow:${c.hollow.length}` : ''}`), 'cells', s.record.cells.map(c => `${c.at.join(',')}:${c.role}`), 'rough', s.record.inwall?.rough?.census, 'platforms', (s.record.plotprep?.platforms ?? []).length)
  rec({ kind: 'record', cut: s.record.cut, cells: s.record.cells, platforms: s.record.plotprep?.platforms ?? [] })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rough-proof-'))
  const key = PJ.projKey(home, T.TIDY_PLOT)
  PJ.publishRecord(dir, key, () => ({ ...s.record, state: 'open' }))
  // skills.mjs otherBodyOnCell, as the tidy visit reads it
  const bodyOn = at => Object.values(bot.entities ?? {}).some(e => {
    if (!e || e === bot.entity || !e.position || ['item', 'experience_orb', 'arrow'].includes(e.name)) return false
    const p = e.position, w = (e.width ?? 0.6) / 2
    return p.x + w > at[0] && p.x - w < at[0] + 1 && p.z + w > at[2] && p.z - w < at[2] + 1 && p.y >= at[1] && p.y < at[1] + 2.01
  })
  const logs = []
  const e = BB.botBuildEffects(bot, { log: (k, d) => { logs.push([k, d]); if (k === '_build') P(k, d) } })
  const visit = async n => {
    for (let i = 0; i < n; i++) {
      const slot = PJ.takeSlot(dir, key, NAME, 3)
      const h = PJ.recordHead(dir, key)
      const cuts = T.tidyCuts(h.head.rec, read)
      const r = await R.runVisit({ dir, key, me: NAME, home, stood: [[HX, HY, HZ]], record: h.head.rec, tidy: cuts, recordGen: h.head.gen, palette: T.TIDY_PALETTE, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, stands: { pending: null, bans: {} }, unknown: new Set(), beat: true,
        domain: () => true, walkR: 40, blockLayer: false, clearMax: 16, tidyKeepOrder: true, deferSpent: true, stuckStalledOnly: true,
        tidyOk: (q, rd) => T.cutSafeNow(rd, q.at, 'owner-1101') && !bodyOn(q.at) && (RG.hollowClear ? RG.hollowClear(q, bodyOn) : true) }, e, { deadline: Date.now() + 3 * 60_000, maxSteps: 200 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
      P(`visit: stop ${r.stop} placed ${r.placed} refused ${r.refused} cleared ${r.cleared} tidyWet ${(r.tidyWet ?? []).length}`)
      if (r.stop === 'complete') return r
      await sleep(1000)
    }
    return null
  }
  const out = { kind: SCENE }
  if (SCENE === 'hollow') {
    await visit(4)
    const col = ([x, z]) => ({ crust: isBlock(x, HY, z, 'minecraft:grass_block'), y1: isBlock(x, HY - 1, z, '#minecraft:dirt') || isBlock(x, HY - 1, z, 'minecraft:cobblestone'), y2: isBlock(x, HY - 2, z, '#minecraft:dirt') || isBlock(x, HY - 2, z, 'minecraft:cobblestone') })
    out.A = col(A); out.Bheld = col(B)
    P('A (nobody in it):', out.A, ' B (armor stand in it):', out.Bheld)
    rcon('kill @e[type=armor_stand,tag=roughproof]')
    await sleep(2000)
    await visit(4)
    out.Bafter = col(B); out.Aafter = col(A)
    P('B after the stand left:', out.Bafter)
    out.pass = !out.A.crust && out.A.y1 && out.A.y2 && out.Bheld.crust && !out.Bafter.crust && out.Bafter.y1 && out.Bafter.y2 && out.Aafter.y1 && out.Aafter.y2
  } else if (SCENE === 'stand') {
    const target = [A[0], HY + 7, A[1]]
    const plats = PJ.recordHead(dir, key).head.rec.plotprep?.platforms ?? []
    const standCells = plats.flatMap(p => p.cells)
    P('stand cells', standCells)
    await visit(6)
    out.built = standCells.filter(c => isBlock(...c, '#minecraft:base_stone_overworld') || isBlock(...c, 'minecraft:cobblestone')).length
    out.targetGone = isBlock(...target, 'minecraft:air')
    P('after the work: stand cells standing', out.built, '/', standCells.length, 'target gone', out.targetGone)
    // the keeper's teardown step (skills.mjs: platformUp -> platformTeardown, a new generation of the record), then its visits
    const pub = PJ.publishRecord(dir, key, cur => T.platformTeardown(cur, read, Date.now()))
    P('teardown generation', pub.result, pub.gen)
    await visit(6)
    out.left = standCells.filter(c => !isBlock(...c, 'minecraft:air')).length
    out.pass = out.targetGone && out.built === standCells.length && out.left === 0 && standCells.length > 0
    P('after the teardown: stand cells left', out.left)
  }
  out.rows = logs.filter(([k]) => k === '_build').map(([, d]) => `${d.op} ${d.cell ?? ''} ${d.block ?? ''}`).slice(0, 60)
  rec(out); P('RESULT', out.pass ? 'PASS' : 'FAIL', JSON.stringify({ ...out, rows: undefined }))
  e.close?.(); bot.quit()
}
main().then(() => setTimeout(() => process.exit(0), 1000)).catch(err => { P('ERROR', String(err?.stack || err)); rec({ kind: 'error', e: String(err?.stack || err).slice(0, 400) }); setTimeout(() => process.exit(1), 500) })
