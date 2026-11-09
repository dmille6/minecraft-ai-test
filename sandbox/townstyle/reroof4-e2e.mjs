// SANDBOX-ONLY (reroof4-01show, 2026-11-08): THE ROOF-ACCESS RETROFIT ON PAPER, ON THE LIVE SHOWCASE GEOMETRY, WITH THE BOTS' OWN CODE.
//   BOT_ROOT=<worktree> SBX=sandbox4 PORT=25602 PLOT=hall|enchantshop|storehub DUMP=<dir> node sandbox/townstyle/reroof4-e2e.mjs
// DUMP holds a READ-ONLY region dump of the showcase town (town.json: {pal, box, d}), the building records (recs/<plot>.json, decor.json)
// and the pool's stood file (project-0_70_0.shop.stood.jsonl). The building and everything round it are PASTED into the sandbox at their
// own coordinates (RCON setblock: a sandbox only), so the proof and the visits meet the live terrain: the hall's trench, the workshop's
// porch rows, the spruces. The code under test: reroof.mjs reroofProve (the whole proof: obstacles, doorstep, slab floors, the door-side
// eave notch, a temporary stair), reroofRecord, buildrun.mjs runVisit with the record's slab floors (skills.mjs reroofVisitOpts), the
// teardown (reroofDismantleDue / reroofDismantle) and buildbot.mjs botBuildEffects (mineflayer-pathfinder walks, aimed clicks, acks).
// PASS: the visits end `complete`; EVERY new roof cell reads its block and state BY THE SERVER (`execute if block`); every listed clear
// is gone; no temporary stair cell stands and none is left in the record; NO STRAY BLOCK: every cell of the pasted box that changed is a
// record cell, a listed clear or a torn-down stair cell. Evidence: the bot's feet over a slab (its own roof) are sampled every 250 ms.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const BOT_ROOT = path.resolve(process.env.BOT_ROOT || '.')
const req = createRequire(path.join(BOT_ROOT, 'bots', 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const imp = f => import(path.join(BOT_ROOT, 'bots/src', f))
const [B, R, PJ, BB, T, RR, TP] = await Promise.all(['buildsite.mjs', 'buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'townstyle.mjs', 'reroof.mjs', 'townplan.mjs'].map(imp))
const SERVER = process.env.SBX || 'sandbox4'
const PORT = Number(process.env.PORT || 25602)
const PLOT = process.env.PLOT || 'hall'
const DUMP = process.env.DUMP
const NAME = `sbx-R4${PLOT.slice(0, 8)}`
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
const rcon = (...cmds) => {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const k3 = a => a.join(',')

// the lock (sandbox/lib/sbxlock.cjs): this driver runs only on a sandbox its owner tag holds
const LOCK = req(path.join(BOT_ROOT, 'sandbox/lib/sbxlock.cjs'))
LOCK.requireSandboxLock(SERVER, process.env.SBX_TAG || 'reroof4')

const TARGETS = { hall: { bp: 'hall@1', form: 'slab' }, enchantshop: { bp: 'enchantshop@1', form: 'slab' }, storehub: { bp: 'storehub@1', form: 'slab' } }
const STYLE = { wood: 'spruce', roof: 'spruce', stone: 'cobblestone' }

async function main () {
  const j = JSON.parse(fs.readFileSync(path.join(DUMP, 'town.json'), 'utf8'))
  const [x0, x1, y0, y1, z0, z1] = j.box, ny = y1 - y0 + 1, nz = z1 - z0 + 1
  const dumpAt = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : j.pal[j.d[((x - x0) * ny + (y - y0)) * nz + (z - z0)]]
  const rec0 = JSON.parse(fs.readFileSync(path.join(DUMP, 'recs', `${PLOT}.json`), 'utf8'))
  const decor = JSON.parse(fs.readFileSync(path.join(DUMP, 'recs', 'decor.json'), 'utf8'))
  const others = fs.readdirSync(path.join(DUMP, 'recs')).filter(f => f.endsWith('.json') && !/\.r4\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(DUMP, 'recs', f), 'utf8')))
  // THE PASTE: the building's box + 16 round it (its walk and its trees), y 58..88; home is the nearest dump cell the live stood file walked
  const M = 16
  const bx = [rec0.box[0] - M, rec0.box[1] - M, rec0.box[2] + M, rec0.box[3] + M]
  const PY0 = 58, PY1 = 88
  const allStood = fs.readFileSync(path.join(DUMP, 'project-0_70_0.shop.stood.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const stoodAt = [...new Set(allStood.map(r => r?.c).filter(Array.isArray).map(k3))].map(k => k.split(',').map(Number)).filter(a => Array.isArray(a) && a.length === 3 && a[0] >= bx[0] + 2 && a[0] <= bx[2] - 2 && a[2] >= bx[1] + 2 && a[2] <= bx[3] - 2 && a[1] > PY0 && a[1] < PY1)
  const cx = (rec0.box[0] + rec0.box[2]) / 2, cz = (rec0.box[1] + rec0.box[3]) / 2
  stoodAt.sort((a, b) => Math.hypot(a[0] - cx, a[2] - cz) - Math.hypot(b[0] - cx, b[2] - cz))
  const outside = stoodAt.filter(a => a[0] < rec0.box[0] - 2 || a[0] > rec0.box[2] + 2 || a[2] < rec0.box[1] - 2 || a[2] > rec0.box[3] + 2)
  // no stood cell there (the stood file holds the town's busy cells): the nearest dry ground cell 3..6 outside the pad, on its door side
  const open1 = n => n != null && /^(air|cave_air|short_grass|fern|snow)/.test(n)
  const ground = []
  for (let x = rec0.box[0] - 6; x <= rec0.box[2] + 6; x++) for (let z = rec0.box[1] - 6; z <= rec0.box[3] + 6; z++) {
    const d = Math.max(rec0.box[0] - x, x - rec0.box[2], rec0.box[1] - z, z - rec0.box[3])
    if (d < 3) continue
    for (let y = PY1 - 2; y > PY0; y--) { const f = dumpAt(x, y - 1, z); if (f && !open1(f) && !/leaves|water|lava|log/.test(f) && open1(dumpAt(x, y, z)) && open1(dumpAt(x, y + 1, z))) { ground.push([x, y, z, d]); break } }
  }
  ground.sort((a, b) => a[3] - b[3] || Math.hypot(a[0] - cx, a[2] - cz) - Math.hypot(b[0] - cx, b[2] - cz))
  // else: the town walk's own cell nearest the building (walkFrom from the live home over the dump, the live stood cells): the bot starts
  // on the network the bots walk, never in a pocket the model links and the pathfinder does not
  let walkedHome = null
  if (!outside[0]) {
    const md = req('minecraft-data')('1.21.8')
    const pal = j.pal.map(n => { const base = n.replace(/\[.*$/, ''); const b = md.blocksByName[base]; return b ? { name: base, boundingBox: b.boundingBox } : null })
    const dRead = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : pal[j.d[((x - x0) * ny + (y - y0)) * nz + (z - z0)]]
    const live = B.walkFrom(dRead, { x: 0, y: 70, z: 0 }, new Set(), 90, { stood: [...new Set(allStood.map(r => r?.c).filter(Array.isArray).map(k3))].map(k => k.split(',').map(Number)) })
    const cand = [...live].map(k => k.split(',').map(Number)).filter(a => a[0] >= bx[0] + 2 && a[0] <= bx[2] - 2 && a[2] >= bx[1] + 2 && a[2] <= bx[3] - 2 && Math.max(rec0.box[0] - a[0], a[0] - rec0.box[2], rec0.box[1] - a[2], a[2] - rec0.box[3]) >= 3)
    cand.sort((a, b) => Math.hypot(a[0] - cx, a[2] - cz) - Math.hypot(b[0] - cx, b[2] - cz))
    walkedHome = cand[0] ?? null
  }
  const homeAt = outside[0] ?? walkedHome ?? ground[0]?.slice(0, 3)
  if (!homeAt) { P('NO HOME: no stood or ground cell outside the building in the paste'); process.exit(2) }
  const home = { x: homeAt[0], y: homeAt[1], z: homeAt[2] }   // MOAT=1 moves it to the causeway's end once the moat is laid
  P('plot', PLOT, 'box', rec0.box, 'paste', bx, PY0, PY1, 'home', home, 'stood in paste', stoodAt.length)
  rcon(`forceload add ${bx[0] - 2} ${bx[1] - 2} ${bx[2] + 2} ${bx[3] + 2}`, 'gamerule doTileDrops true', 'gamerule randomTickSpeed 0', 'gamerule doFireTick false')
  // clear the box (in x slices: /fill takes 32,768 at most), then every non-air dump cell (its kept properties) by setblock
  const per = Math.max(1, Math.floor(32768 / ((PY1 - PY0 + 1) * (bx[3] - bx[1] + 1))))
  const clr = []; for (let x = bx[0]; x <= bx[2]; x += per) clr.push(`fill ${x} ${PY0} ${bx[1]} ${Math.min(bx[2], x + per - 1)} ${PY1} ${bx[3]} minecraft:air`)
  rcon(...clr, `fill ${bx[0]} ${PY0 - 3} ${bx[1]} ${bx[2]} ${PY0 - 1} ${bx[3]} minecraft:stone`)
  const sets = [], before = new Map()
  for (let x = bx[0]; x <= bx[2]; x++) for (let z = bx[1]; z <= bx[3]; z++) for (let y = PY0; y <= PY1; y++) {
    const n = dumpAt(x, y, z)
    if (n == null) continue
    before.set(`${x},${y},${z}`, n.replace(/\[.*$/, ''))
    if (/^(air|cave_air)/.test(n) || n === '?') continue
    if (/^(chest|trapped_chest|barrel|furnace|crafting_table)/.test(n)) { sets.push(`setblock ${x} ${y} ${z} minecraft:${n.replace(/\[.*$/, '')}`); continue }
    sets.push(`setblock ${x} ${y} ${z} minecraft:${n}`)
  }
  for (let i = 0; i < sets.length; i += 2000) rcon(...sets.slice(i, i + 2000))
  // MOAT=1 (the TEMP stair's proof): only the building itself (its pad box + 1) stays; the rest of the box is a flat grass field one
  // below its floor, then a MOAT four deep in the ring 2..8 round the pad, but a 3-wide causeway from the doorway out (the walk's way
  // in): no ground eye reaches the far slopes and no walk climbs the roof, so the proof must build a stair from the moat floor
  let moatHome = null
  if (process.env.MOAT === '1') {
    const pb = rec0.box, fy = rec0.s - 1
    const keep = (x, z) => x >= pb[0] - 1 && x <= pb[2] + 1 && z >= pb[1] - 1 && z <= pb[3] + 1
    const side = RR.reroofDoorSide(rec0)
    const bp0 = B.loadBlueprint(TARGETS[PLOT].bp)
    const dw = (bp0.doorway ?? []).map(([u, v]) => { const q = TP.rot(rec0.orient, u, v); return [rec0.anchor[0] + q.dx, rec0.anchor[1] + q.dz] })
    const dxs = dw.map(a => a[0]), dzs = dw.map(a => a[1])
    const cw = (x, z) => side[0] !== 0 ? (z >= Math.min(...dzs) - 1 && z <= Math.max(...dzs) + 1 && (side[0] > 0 ? x > pb[2] : x < pb[0])) : (x >= Math.min(...dxs) - 1 && x <= Math.max(...dxs) + 1 && (side[1] > 0 ? z > pb[3] : z < pb[1]))
    const cmds = []
    for (let x = bx[0]; x <= bx[2]; x++) for (let z = bx[1]; z <= bx[3]; z++) {
      if (keep(x, z)) continue
      const d = Math.max(pb[0] - x, x - pb[2], pb[1] - z, z - pb[3])
      const moat = d >= 2 && d <= 8 && !cw(x, z)
      cmds.push(`fill ${x} ${PY0} ${z} ${x} ${PY1} ${z} minecraft:air`, `fill ${x} ${PY0} ${z} ${x} ${moat ? fy - 4 : fy - 1} ${z} minecraft:dirt`, `setblock ${x} ${moat ? fy - 4 : fy} ${z} minecraft:grass_block`)
      for (const y of [moat ? fy - 4 : fy]) before.set(`${x},${y},${z}`, 'grass_block')
      for (let y = PY0; y <= PY1; y++) if (y !== (moat ? fy - 4 : fy)) before.set(`${x},${y},${z}`, y < (moat ? fy - 4 : fy) ? 'dirt' : 'air')
    }
    for (let i = 0; i < cmds.length; i += 3000) rcon(...cmds.slice(i, i + 3000))
    // home: the causeway's far end
    const far = side[0] !== 0 ? [side[0] > 0 ? pb[2] + 9 : pb[0] - 9, Math.round((Math.min(...dzs) + Math.max(...dzs)) / 2)] : [Math.round((Math.min(...dxs) + Math.max(...dxs)) / 2), side[1] > 0 ? pb[3] + 9 : pb[1] - 9]
    moatHome = { x: far[0], y: fy + 1, z: far[1] }
    P('moat laid', cmds.length / 3, 'columns; home', moatHome)
  }
  rcon(`kill @e[type=item,x=${bx[0]},y=${PY0 - 4},z=${bx[1]},dx=${bx[2] - bx[0]},dy=40,dz=${bx[3] - bx[1]}]`)
  P('pasted', sets.length, 'blocks')
  if (moatHome) { home.x = moatHome.x; home.y = moatHome.y; home.z = moatHome.z; stoodAt.length = 0 }
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `effect give ${NAME} minecraft:saturation infinite 1 true`, `tp ${NAME} ${home.x + 0.5} ${home.y} ${home.z + 0.5}`)
  await sleep(5000)
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  const PROPS = /slab|stairs|leaves|_log|_wood|trapdoor|lantern|torch|snow|water/
  const read0 = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, props: PROPS.test(b.name) ? b.getProperties() : null } : null }
  // r5: the PROOF reads through a memo, as skills.mjs buildReroof's planReader does (an unmemoised bot read held the event loop past the
  // 30 s keep-alive on Paper: the bot was kicked mid-proof); the visits read live
  const memo = new Map()
  const readMemo = (x, y, z) => { const k = `${x},${y},${z}`; if (memo.has(k)) return memo.get(k); const v = read0(x, y, z); memo.set(k, v); return v }
  const read = read0
  // THE PROOF: reroofProve on the bot's own read of the pasted world (the planner's call, skills.mjs buildReroof)
  const tg = TARGETS[PLOT]
  const bpOld = B.loadBlueprint(tg.bp), bpNew = RR.reroofBlueprint(bpOld, tg.form)
  const occupied = (u, v, y) => { const q = TP.rot(rec0.orient, u, v); const b = read(rec0.anchor[0] + q.dx, rec0.s + y, rec0.anchor[1] + q.dz); return !!b && b.boundingBox === 'block' }
  const bpAdd = RR.reroofProofBlueprint(bpOld, bpNew, STYLE, { occupied })
  const box = rec0.box
  const domain = (x, z) => x >= box[0] - 4 && x <= box[2] + 4 && z >= box[1] - 4 && z <= box[3] + 4
  const stood = [[home.x, home.y, home.z], ...stoodAt]
  const recCells = new Set(others.flatMap(r => (r.cells ?? []).map(c => k3(c.at))))
  const fx = RR.reroofFixes(process.env)
  const tP = Date.now()
  const pr = await RR.reroofProve(readMemo, home, rec0, bpOld, bpAdd, { stood, walkR: Number.isFinite(rec0.walkR) ? rec0.walkR : 90, domain, decor, recordAt: (x, y, z) => recCells.has(`${x},${y},${z}`), fx })
  P('proof took', Date.now() - tP, 'ms')
  P('proof', pr.ok ? `OK cells ${pr.p.cells.length} clears ${pr.clear.length} notch ${pr.notch} temp ${pr.temp?.size ?? 0} step ${pr.step ? k3(pr.step) : '-'} approach ${JSON.stringify(pr.approach ?? null)}` : `${pr.why} ${pr.detail}`)
  if (!pr.ok) { finish({ stop: 'unproven', why: pr.why, detail: pr.detail }, 1); return }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reroof4-e2e-'))
  const key = PJ.projKey({ x: 0, y: 70, z: 0 }, PLOT)
  PJ.publishRecord(dir, key, () => ({ ...rec0 }))
  const pub = PJ.publishRecord(dir, key, cur => RR.reroofRecord(cur, pr.p.cells, bpNew, STYLE, { clear: pr.clear, temp: pr.temp, notch: pr.notch }))
  P('retrofit generation', pub.result, pub.gen)
  let head = PJ.recordHead(dir, key).head.rec
  // THE KIT (a sandbox only): each new cell's first block name, cobblestone for the stair and the doorstep, an axe and shears for the digs
  const KIT = { cobblestone: 64, iron_axe: 1, shears: 1, iron_shovel: 1 }
  for (const c of head.cells.filter(q => /^reroof-/.test(String(q.seg)))) { const n = R.roleFirst(head.palette, c.role); if (n) KIT[n === 'oak_planks' ? 'spruce_planks' : n] = (KIT[n === 'oak_planks' ? 'spruce_planks' : n] ?? 0) + 1 }
  const gives = []
  for (const [n, c] of Object.entries(KIT)) { let left = c + (c > 1 ? 8 : 0); while (left > 0) { const k = Math.min(64, left); gives.push(`give ${NAME} minecraft:${n} ${k}`); left -= k } }
  rcon(...gives); await sleep(2500)
  // THE EVIDENCE: the block under the bot's feet, every 250 ms -- a slab of the new roof means it stood on its own placed sections
  const newKeys = new Set(head.cells.filter(q => /^reroof-/.test(String(q.seg))).map(q => k3(q.at)))
  const onSlab = new Map()
  const sampler = setInterval(() => { try { if (fallFrom && !fallLeft) { const q = bot.entity.position.floored(); if (q.y >= fallFrom.y + Number(process.env.FALL_UP ?? 2)) { fallLeft = q; P("FALL: climbed back out to", q) } } const p = bot.entity.position; const fx0 = Math.floor(p.x), fz0 = Math.floor(p.z); const below = [fx0, Math.floor(p.y - 0.01), fz0]; const b = bot.blockAt(new Vec3(...below)); if (b && /_slab$/.test(b.name) && newKeys.has(k3(below))) onSlab.set(k3(below), `${b.getProperties().type}@y${p.y.toFixed(2)}`) } catch { /* sample */ } }, 250)
  const logs = []
  const apexKeys = RR.reroofApexKeys ? RR.reroofApexKeys(head) : new Map()
  const e = BB.botBuildEffects(bot, { cornerSquare: RR.REROOF_FIX?.cornerSquare !== false, apexDig: RR.REROOF_FIX?.apex === false ? null : k => apexKeys.get(k) ?? null, log: (k, d) => { logs.push([k, d]); if (k === '_build' && /clear|deferred|stuck|temp/.test(String(d.op) + String(d.kind))) P(k, d) } })
  // r5: every cell the bot dug (the stray check tells the bot's changes from the world's own: a mushroom or a leaf that pops)
  const touched = new Set()
  { const d1 = e.dig; e.dig = async (c, ...a) => { touched.add(k3(c)); return d1(c, ...a) } }
  if (process.env.WALKLOG) { const w0 = e.walkTo; e.walkTo = async (st, ...a) => { const t1 = Date.now(); const ok = await w0(st, ...a); P('walkTo', st, ok, `${Date.now() - t1} ms`, 'at', bot.entity.position.floored()); return ok }; const d0 = e.dig; e.dig = async (c, ...a) => { const t1 = Date.now(); const v = await d0(c, ...a); P('dig', c, v, `${Date.now() - t1} ms`); return v } }
  let r = null, torn = null, fallFrom = null, fallLeft = null
  for (let visit = 0; visit < Number(process.env.VISITS ?? 14); visit++) {
    head = PJ.recordHead(dir, key).head.rec
    const h = PJ.recordHead(dir, key)
    const slot = PJ.takeSlot(dir, key, NAME, 2)
    const floors = RR.reroofFloors(head.cells.filter(q => /^reroof-/.test(String(q.seg))))
    r = await R.runVisit({ dir, key, me: NAME, home, stood, record: head, recordGen: h.head.gen, palette: head.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} }, domain, walkR: 90, floors, walkRead: RR.reroofNoLeafFloor, stairFirst: true, stood: RR.reroofSeeds(stood, head.box), ...(fx.fallSafe ? { avoid: rd => RR.reroofFallRisk(rd, B.walkFrom(rd, home, new Set(), 90, { stood: RR.reroofSeeds(stood, head.box), floors }), { box: head.box, floors, recover: true }) } : {}) }, e, { deadline: Date.now() + 20 * 60_000 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
    // FALL_AT=x,y,z (r5, the fall-recovery test): after the first visit the bot is dropped into that cell (the storage hub's cavity
    // 14,67,-47: Paper 11-08 a builder fell there and every walk out timed out); the next visits must walk out and finish
    if (process.env.FALL_AT && visit === 0) { const [qx, qy, qz] = process.env.FALL_AT.split(',').map(Number); rcon(`tp ${NAME} ${qx + 0.5} ${qy} ${qz + 0.5}`); await sleep(2500); fallFrom = bot.entity.position.floored(); P('FALL: dropped at', fallFrom) }
    P(`visit ${visit}: stop ${r.stop} ${r.why ?? ''} placed ${r.placed} refused ${r.refused} silent ${r.silent} cleared ${r.cleared}`)
    // r6 diagnosis: a `blocked` segment's open cells, what stands in them and round them (the face a click needs)
    if (r.stop === 'blocked') { const m = String(r.why ?? '').match(/^(\S+):/); const seg = m ? m[1] : null; for (const c of head.cells.filter(q => q.seg === seg)) { const b = read(...c.at); if (b && (b.name === 'air' || b.name === 'cave_air' || !String(b.name).startsWith(String(c.role ?? '')))) P('BLOCKED-CELL', seg, c.at, c.role, 'now', b?.name, 'stand', c.stand, 'support', c.support, '->', c.support ? read(...c.support)?.name : '-', 'nbrs', [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(d => read(c.at[0] + d[0], c.at[1] + d[1], c.at[2] + d[2])?.name).join('/')) } }
    // the teardown (skills.mjs reroofTempState/reroofTempDown): the roof stands -> the stair's cells become kind=temp clears
    const done = c => { const b = read(...c.at); return !!b && R.cellDone({ name: b.name, boundingBox: b.boundingBox, props: b.props ?? null }, head.palette, c.role, c.ws) }
    if (RR.reroofDismantleDue(head, done)) { torn = PJ.publishRecord(dir, key, cur => RR.reroofDismantle(cur)); P('teardown generation', torn.result, torn.gen); continue }
    if (r.stop === 'complete' && !RR.reroofTempStanding(head, read).length) break
    await sleep(1500)
  }
  clearInterval(sampler)
  head = PJ.recordHead(dir, key).head.rec
  // THE SERVER'S WORD on every new cell (its block and its world state; '$planks' roles: any planks)
  const want = c => {
    const n = R.roleFirst(head.palette, c.role)
    if (c.role === 'fill') return ['cobblestone']
    if (n === 'oak_planks') return ['spruce_planks']
    if ((head.palette[c.role] ?? []).includes('$planks')) return [...new Set([c.ws ? T.stateKey(n, c.ws) : n, 'spruce_planks'])]
    return [c.ws ? T.stateKey(n, c.ws) : n]
  }
  const newCells = head.cells.filter(q => /^reroof-/.test(String(q.seg)))
  const cmds = [], idx = []
  for (const c of newCells) for (const w of want(c)) { cmds.push(`execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${w}`); idx.push(c) }
  const res = []
  for (let i = 0; i < cmds.length; i += 200) res.push(...rcon(...cmds.slice(i, i + 200)))
  const okCells = new Set(); res.forEach((x, i) => { if (/passed/i.test(x.reply)) okCells.add(idx[i]) })
  const bad = newCells.filter(c => !okCells.has(c))
  // the listed clears gone, the stair gone and out of the record, no stray block in the pasted box
  const standing = (head.clear ?? []).filter(c => { const b = read(...c.at); return b && String(b.name) === c.name })
  // r5: listed natural leaves / plants left standing OUTSIDE every new cell are an untouched canopy (listed for sight lines the roof's own
  // stands made unneeded): reported apart; any other listed dig still standing fails
  const sightLeft = standing.filter(c => ['leaves', 'plant'].includes(c.kind) && !touched.has(k3(c.at)))
  const clearsLeft = standing.filter(c => !sightLeft.includes(c))
  const tempCellsLeft = RR.reroofTempCells(head).length, tempStanding = RR.reroofTempStanding(head, read).length
  const allowed = new Set([...head.cells.map(c => k3(c.at)), ...(head.clear ?? []).map(c => k3(c.at))])
  const stray = [], env = []
  const placedAt = new Set(logs.filter(([k, d]) => k === '_build' && d.op === 'place' && Array.isArray(d.cell)).map(([, d]) => k3(d.cell)))
  for (const [kk, n0] of before) {
    const [x, y, z] = kk.split(',').map(Number)
    const b = bot.blockAt(new Vec3(x, y, z))
    if (!b) continue
    const n1 = b.name
    if (n1 === n0 || allowed.has(kk)) continue
    if (/^(air|cave_air)$/.test(n0) && /^(air|cave_air)$/.test(n1)) continue
    // leaves decay and fluids flow on their own (a felled tree's crown): not the bot's blocks
    if (/_leaves$/.test(n0) && /^(air|cave_air)$/.test(n1)) continue
    if (/^(water|lava)$/.test(n0) || /^(water|lava)$/.test(n1)) continue
    // r5: a change no bot action came near (no dig, no placement within 1) is the world's own (a mushroom popping, a leaf decaying):
    // reported apart, never hidden
    const nearBot = [-1, 0, 1].some(dx => [-1, 0, 1].some(dy => [-1, 0, 1].some(dz => touched.has(k3([x + dx, y + dy, z + dz])) || placedAt.has(k3([x + dx, y + dy, z + dz])))))
    ;(nearBot ? stray : env).push(`${kk}:${n0}->${n1}`)
  }
  const slabStands = [...onSlab.values()]
  const summary = { plot: PLOT, stop: r?.stop, newCells: newCells.length, serverOk: newCells.length - bad.length, bad: bad.slice(0, 8).map(c => `${c.role}@${c.at}${c.ws ? JSON.stringify(c.ws) : ''}`),
    clears: (head.clear ?? []).length, clearsLeft: clearsLeft.length, clearsLeftEx: clearsLeft.slice(0, 6).map(c => `${c.kind}:${c.name}@${c.at}`), sightLeft: sightLeft.length, notch: pr.notch, temp: pr.temp?.size ?? 0, torn: torn?.result ?? '-', tempCellsLeft, tempStanding, stray: stray.length, strayEx: stray.slice(0, 8), env: env.length, envEx: env.slice(0, 6),
    fall: process.env.FALL_AT ? (fallLeft ? `left ${fallLeft}` : 'STUCK') : '-', slabStands: slabStands.length, slabBottom: slabStands.filter(s => s.startsWith('bottom')).length, slabTop: slabStands.filter(s => s.startsWith('top')).length, places: logs.filter(([k, d]) => k === '_build' && d.op === 'place').length }
  const pass = r?.stop === 'complete' && !bad.length && !clearsLeft.length && !tempCellsLeft && !tempStanding && !stray.length && (!process.env.FALL_AT || !!fallLeft)
  e.close(); bot.quit(); await sleep(500)
  finish(summary, pass ? 0 : 1)
}
function finish (summary, code) {
  P(code ? 'FAIL' : 'PASS', summary)
  fs.appendFileSync(process.env.OUT || 'reroof4-e2e.jsonl', JSON.stringify({ t: new Date().toISOString(), ...summary }) + '\n')
  try { rcon('forceload remove all') } catch { /* sandbox */ }
  process.exit(code)
}
main().catch(err => { P('ERROR', err.stack); process.exit(1) })
