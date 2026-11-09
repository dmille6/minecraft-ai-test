// SANDBOX-ONLY (roads-01show, 2026-11-09): A TRAFFIC ROAD ON PAPER, SITED AND BUILT BY THE BOTS' OWN CODE, THEN WALKED.
//   BOT_ROOT=<worktree> SBX=sandbox8 node sandbox/roads/roads-e2e.mjs        (lock first: sandbox/sbxlock.sh take sandbox8 roadsproof ...)
// THE GROUND (laid by RCON in the sandbox only): a town ring with a home, then east of it flat grass, a 2-deep pit on the line, a slope
// rising one block every two columns, a spruce standing on the line, a pond beside it, flat ground to the destination; the fleet's
// litter -- a floating cobble beam over the line and a cobble pillar on it (the road clears both). The route is a
// straight traffic line from the ring to the destination (the host's file shape, roads.mjs trafficRoutes).
// THE CODE UNDER TEST: sinks.mjs siteSink -> roads.mjs siteRoad2 (the router, the cells, the proof loop) over the bot's own read of the
// server; the growing record (appendInstance / completeInstance); buildrun.mjs runVisit with the road's slab floors and sinkVisitOpts
// (buildbot.mjs botBuildEffects: the pathfinder's walks, the aimed clicks, the digs, the acks). Instances are sited and built until the
// route arrives.
// PASS: every instance ends `complete`; EVERY record cell reads its block BY THE SERVER (`execute if block`, the slab rows type=bottom, a
// log post axis=y, the lantern standing); every listed clear is gone; no stray block in the box; then WALK: the pathfinder (no digging,
// no scaffold) walks landing -> road end -> landing WALKS times; per walk it arrives, places 0 and digs 0 blocks, and the bot's feet
// (sampled every 100 ms) never rise more than 0.55 between two samples while on the road's columns (a half step, never a jump).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const BOT_ROOT = path.resolve(process.env.BOT_ROOT || '.')
const req = createRequire(path.join(BOT_ROOT, 'bots', 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const imp = f => import(path.join(BOT_ROOT, 'bots/src', f))
const [R, PJ, BB, RD] = await Promise.all(['buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'roads.mjs'].map(imp))
// the line under test: the showcase's (sinks.mjs siteSink's road2 hand-off, townstyle's states) or the fleet's (roadsbase.mjs, no aimed click)
const FLEET = fs.existsSync(path.join(BOT_ROOT, 'bots/src/roadsbase.mjs'))
const RB = FLEET ? await imp('roadsbase.mjs') : null
const S = FLEET ? null : await imp('sinks.mjs')
const stateKey = (name, st) => (st && Object.keys(st).length ? `${name}[${Object.keys(st).sort().map(k => `${k}=${st[k]}`).join(',')}]` : String(name))
const instancesOf = rec => (Array.isArray(rec?.instances) ? rec.instances : [])
const REG = JSON.parse(fs.readFileSync(path.join(BOT_ROOT, 'sandbox/sandboxes.json'), 'utf8'))
const SERVER = process.env.SBX || 'sandbox8'
const PORT = REG.servers[SERVER].port
const NAME = 'sbx-Roads1'
const SSH = ['-o', 'BatchMode=yes', `mike@${REG.host}`]
const LOCK = req(path.join(BOT_ROOT, 'sandbox/lib/sbxlock.cjs'))
LOCK.requireSandboxLock(SERVER, process.env.SBX_TAG || 'roadsproof')
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

const X0 = Number(process.env.X0 ?? 6000), Z0 = Number(process.env.Z0 ?? 6000), G = 100
const BOX = [X0 - 16, Z0 - 18, X0 + 74, Z0 + 18]
const RING = [X0 - 12, Z0 - 12, X0 + 12, Z0 + 12]
const groundAt = (x, z) => {
  const dx = x - X0
  if (dx <= 22) return G
  if (dx <= 34) return G + Math.floor((dx - 22) / 2) + 1
  return G + 7
}
const ROUTE = { id: 'east', to: 'village', kind: 'village', trips: 999, median_s: 20, start: [X0 + 13, Z0], line: [[X0 + 13, Z0], [X0 + 30, Z0], [X0 + 50, Z0], [X0 + 64, Z0]], box: [X0 + 64, Z0 - 6, X0 + 74, Z0 + 6] }

async function main () {
  // ---- the ground (a sandbox only: forceload, fill, setblock) -------------------------------------------------------------------
  rcon(`forceload add ${BOX[0]} ${BOX[1]} ${BOX[2]} ${BOX[3]}`, 'gamerule doTileDrops true', 'gamerule randomTickSpeed 0', 'gamerule doFireTick false', 'gamerule doDaylightCycle false', 'time set day', 'gamerule doMobSpawning false')
  const cmds = []
  for (let x = BOX[0]; x <= BOX[2]; x++) {
    cmds.push(`fill ${x} ${G - 6} ${BOX[1]} ${x} ${G + 24} ${BOX[3]} minecraft:air`)
    const g = groundAt(x, Z0)
    cmds.push(`fill ${x} ${G - 6} ${BOX[1]} ${x} ${g - 1} ${BOX[3]} minecraft:dirt`, `fill ${x} ${g} ${BOX[1]} ${x} ${g} ${BOX[3]} minecraft:grass_block`)
  }
  // a 2-deep pit on the line, a spruce on the line (4 logs, a crown), a pond 2 off the road's verge, a wall with a 3-wide gap at the ring
  cmds.push(`fill ${X0 + 18} ${G - 1} ${Z0 + 1} ${X0 + 18} ${G} ${Z0 + 1} minecraft:air`)
  cmds.push(`fill ${X0 + 44} ${G + 8} ${Z0 - 1} ${X0 + 44} ${G + 11} ${Z0 - 1} minecraft:spruce_log`, `fill ${X0 + 43} ${G + 10} ${Z0 - 2} ${X0 + 45} ${G + 12} ${Z0} minecraft:spruce_leaves[persistent=true] keep`)
  cmds.push(`fill ${X0 + 50} ${G + 6} ${Z0 + 9} ${X0 + 53} ${G + 7} ${Z0 + 12} minecraft:water`)
  cmds.push(`fill ${X0 + 12} ${G + 1} ${Z0 - 12} ${X0 + 12} ${G + 3} ${Z0 + 12} minecraft:cobblestone`, `fill ${X0 + 12} ${G + 1} ${Z0 - 1} ${X0 + 12} ${G + 3} ${Z0 + 1} minecraft:air`)
  // the fleet's litter (roads.mjs LITTER): a floating cobble beam over the line (air under it) and a 3-high cobble pillar on the plateau
  cmds.push(`fill ${X0 + 16} ${G + 3} ${Z0 - 1} ${X0 + 19} ${G + 3} ${Z0 + 1} minecraft:cobblestone`, `fill ${X0 + 40} ${G + 8} ${Z0 + 2} ${X0 + 40} ${G + 10} ${Z0 + 2} minecraft:cobblestone`)
  for (let i = 0; i < cmds.length; i += 500) rcon(...cmds.slice(i, i + 500))
  rcon(`kill @e[type=item,x=${BOX[0]},y=${G - 8},z=${BOX[1]},dx=${BOX[2] - BOX[0]},dy=40,dz=${BOX[3] - BOX[1]}]`)
  P('ground laid', cmds.length, 'commands')
  const home = { x: X0, y: G + 1, z: Z0 }
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `effect give ${NAME} minecraft:saturation infinite 1 true`, `tp ${NAME} ${home.x + 0.5} ${home.y} ${home.z + 0.5}`)
  await sleep(6000)
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  const PROPS = /slab|stairs|leaves|_log|_wood|lantern|torch|water|fence/
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, props: PROPS.test(b.name) ? b.getProperties() : null } : null }
  // the box before (the stray check)
  const before = new Map()
  for (let x = BOX[0]; x <= BOX[2]; x++) for (let z = BOX[1]; z <= BOX[3]; z++) for (let y = G - 3; y <= G + 14; y++) { const b = bot.blockAt(new Vec3(x, y, z)); if (b) before.set(`${x},${y},${z}`, b.name) }
  // THE KIT (a sandbox only): the road's blocks, tools
  const KIT = { stone_bricks: 192, cobbled_deepslate: 128, deepslate_bricks: 64, stone_brick_slab: 64, cobblestone: 128, dirt: 64, spruce_fence: 8, spruce_log: 8, lantern: 8, iron_pickaxe: 1, iron_shovel: 1, iron_axe: 1, shears: 1 }
  const gives = []
  for (const [n, c] of Object.entries(KIT)) { let left = c; while (left > 0) { const k = Math.min(64, left); gives.push(`give ${NAME} minecraft:${n} ${k}`); left -= k } }
  rcon(...gives); await sleep(2500)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roads-e2e-'))
  const key = PJ.projKey({ x: X0, y: G + 1, z: Z0 }, 'road')
  const logs = []
  const e = BB.botBuildEffects(bot, { log: (k, d) => { logs.push([k, d]); if ((k === '_build' && /clear|deferred|stuck/.test(String(d.op) + String(d.kind))) || (process.env.LOGALL && k !== '_build_seg')) P(k, d) } })
  const touched = new Set()
  { const d1 = e.dig; e.dig = async (c, ...a) => { touched.add(k3(c)); return d1(c, ...a) } }
  const stood = [[home.x, home.y, home.z]]
  const avail = { stone_bricks: 2000, cobbled_deepslate: 2000, deepslate_bricks: 500 }
  let rec = null
  const visits = []
  for (let inst = 0; inst < 8; inst++) {
    const n = instancesOf(rec).length + 1
    const t1 = Date.now()
    const ctx2 = { routes: [ROUTE], ring: RING, townBoxes: [RING], landOk: () => true, own: () => false, lamp: true }
    const r = FLEET ? RD.siteRoad2(read, { id: `R${n}`, n, home, pool: 'sandbox', avail, guard: () => null, rec, stood, ...ctx2 }) : S.siteSink(read, { kind: 'road', n, id: `R${n}`, home, pool: 'sandbox', avail, guard: () => null, rec, stood, roads2: ctx2 })
    P(`siting R${n}`, r.ok ? `OK ${r.meta.summary} len ${r.meta.len} cells ${r.inst.cells.length} clears ${r.inst.clear.length} slabs ${r.meta.slabs} lamps ${r.meta.lamps} ended ${r.meta.ended ?? '-'}` : `${r.why} ${JSON.stringify(r.tried)}`, `${Date.now() - t1} ms`)
    if (!r.ok) break
    if (r.meta.ended && r.meta.ended !== 'arrived') {
      // diagnosis: the router again from this instance's end, its refusals, and the reads along the rest of the line (null = unloaded)
      const rr = RD.routeRoad(read, { line: ROUTE.line, start: r.meta.end, hy: home.y })
      const nulls = []; for (let x = r.meta.end.x; x <= X0 + 66; x++) { if (!read(x, G + 7, Z0)) nulls.push(x) }
      P('BLOCKED diagnosis', rr.why, JSON.stringify(rr.tally), 'nodes', rr.nodes.length, 'end', r.meta.end, 'unloaded x', nulls.slice(0, 5), nulls.length, 'bot at', bot.entity.position.floored())
    }
    const meta = { ...r.meta, sitedBy: NAME, sitedAt: Date.now() }
    const pub = PJ.publishRecord(dir, key, cur => (FLEET ? RB.appendRoad(cur, { home, inst: r.inst, meta }) : S.appendInstance(cur, { kind: 'road', home, inst: r.inst, meta })))
    if (pub.result !== 'accepted') { P('publish', pub.result); break }
    let v = null
    for (let visit = 0; visit < 10; visit++) {
      const h = PJ.recordHead(dir, key)
      const head = h.head.rec
      const slot = PJ.takeSlot(dir, key, NAME, 3)
      v = await R.runVisit({ dir, key, me: NAME, home, stood, record: head, recordGen: h.head.gen, palette: head.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} }, ...(FLEET ? RB.roadVisitOpts(head, home) : S.sinkVisitOpts(head, home)), floors: RD.roadFloors(head) }, e, { deadline: Date.now() + 15 * 60_000, maxSteps: 400 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
      P(`  R${n} visit ${visit}: stop ${v.stop} ${v.why ?? ''} placed ${v.placed} refused ${v.refused} silent ${v.silent} cleared ${v.cleared}`)
      visits.push({ inst: `R${n}`, visit, stop: v.stop, placed: v.placed, cleared: v.cleared })
      if (v.stop === 'complete') break
      await sleep(1000)
    }
    if (v?.stop !== 'complete') break
    PJ.publishRecord(dir, key, cur => (FLEET ? RB.completeRoad(cur) : S.completeInstance(cur)))
    rec = PJ.recordHead(dir, key).head.rec
    if (r.meta.ended) break
  }
  rec = PJ.recordHead(dir, key).head.rec
  // ---- THE SERVER'S WORD on every cell ------------------------------------------------------------------------------------------
  const wantOf = c => { const names = rec.palette[c.role].filter(q => q !== '*solid'); return names.map(nm => (c.ws ? stateKey(nm, c.ws) : nm)) }
  const cmdsV = [], idx = []
  for (const c of rec.cells) for (const w of wantOf(c)) { cmdsV.push(`execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${w}`); idx.push(c) }
  const res = []
  for (let i = 0; i < cmdsV.length; i += 200) res.push(...rcon(...cmdsV.slice(i, i + 200)))
  const okCells = new Set(); res.forEach((x, i) => { if (/passed/i.test(x.reply)) okCells.add(idx[i]) })
  // a core cell is any solid ('*solid'): read it as not air instead
  const bad = rec.cells.filter(c => !okCells.has(c) && !(rec.palette[c.role].includes('*solid') && (() => { const b = read(...c.at); return b && b.boundingBox === 'block' })()))
  const standing = (rec.clear ?? []).filter(c => { const b = read(...c.at); return b && String(b.name) === c.name })
  const allowed = new Set([...rec.cells.map(c => k3(c.at)), ...(rec.clear ?? []).map(c => k3(c.at))])
  const placedAt = new Set(logs.filter(([k, d]) => k === '_build' && d.op === 'place' && Array.isArray(d.cell)).map(([, d]) => k3(d.cell)))
  const stray = []
  for (const [kk, n0] of before) {
    const [x, y, z] = kk.split(',').map(Number)
    const b = bot.blockAt(new Vec3(x, y, z)); if (!b) continue
    const n1 = b.name
    if (n1 === n0 || allowed.has(kk)) continue
    if (/_leaves$/.test(n0) && /air/.test(n1)) continue
    if (/water/.test(n0) || /water/.test(n1)) continue
    const nearBot = [-1, 0, 1].some(dx => [-1, 0, 1].some(dy => [-1, 0, 1].some(dz => touched.has(k3([x + dx, y + dy, z + dz])) || placedAt.has(k3([x + dx, y + dy, z + dz])))))
    if (nearBot) stray.push(`${kk}:${n0}->${n1}`)
  }
  for (const c of bad.slice(0, 6)) P('BAD-CELL', c.role, c.at, 'now', read(...c.at), 'below', read(c.at[0], c.at[1] - 1, c.at[2])?.name, 'nbrs', [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(q => read(c.at[0] + q[0], c.at[1], c.at[2] + q[2])?.name).join('/'))
  P('cells', rec.cells.length, 'server-ok', rec.cells.length - bad.length, 'bad', bad.slice(0, 8).map(c => `${c.role}@${c.at}${c.ws ? JSON.stringify(c.ws) : ''}`), 'clears left', standing.length, 'stray', stray.slice(0, 8))
  // ---- THE WALK: landing <-> road end, the pathfinder alone (no dig, no scaffold), feet sampled ---------------------------------
  const ins = instancesOf(rec).filter(i => i.design?.kind === 'road2')
  const land = ins[0]?.land, end = ins.at(-1)?.end
  const roadCols = new Set(rec.cells.filter(c => /-(tr|acc|ed|sl)$/.test(c.role)).map(c => `${c.at[0]},${c.at[2]}`))
  const walks = []
  if (land && end) {
    const snapBefore = new Map(); for (const c of rec.cells) snapBefore.set(k3(c.at), read(...c.at)?.name)
    for (let w = 0; w < Number(process.env.WALKS ?? 6); w++) {
      const to = w % 2 === 0 ? [end.x, end.L + 1, end.z] : [land.x, land.L + 1, land.z]
      let last = null, maxRise = 0, onRoad = 0, jumps = 0
      const samp = setInterval(() => { const p = bot.entity.position; const col = `${Math.floor(p.x)},${Math.floor(p.z)}`; if (last != null && roadCols.has(col)) { const d = p.y - last; if (d > maxRise) maxRise = d; if (d > 0.55) jumps++; onRoad++ } last = p.y }, 100)
      const t1 = Date.now(); let ok = true
      try { await bot.pathfinder.goto(new goals.GoalNear(to[0], to[1], to[2], 1)) } catch (err) { ok = false; P('walk error', String(err?.message ?? err).slice(0, 80)) }
      clearInterval(samp)
      walks.push({ w, ok, ms: Date.now() - t1, maxRise: Number(maxRise.toFixed(3)), jumps, samples: onRoad })
      P('walk', walks.at(-1))
    }
    const changed = [...snapBefore].filter(([kk, n0]) => read(...kk.split(',').map(Number))?.name !== n0)
    walks.changed = changed.length
  }
  const pass = !bad.length && !standing.length && !stray.length && ins.length > 0 && ins.at(-1).ended === 'arrived' && walks.length > 0 && walks.every(w => w.ok && w.jumps === 0) && !walks.changed
  const summary = { instances: ins.map(i => `${i.id}:${i.len}${i.ended ? `:${i.ended}` : ''}`), cells: rec.cells.length, serverOk: rec.cells.length - bad.length, bad: bad.slice(0, 8).map(c => `${c.role}@${c.at}`), clears: (rec.clear ?? []).length, clearsLeft: standing.length, stray: stray.length, strayEx: stray.slice(0, 6),
    slabs: rec.cells.filter(c => /-sl$/.test(c.role)).length, lamps: rec.cells.filter(c => /-light$/.test(c.role)).length, visits, walks, walkChanged: walks.changed ?? null, places: logs.filter(([k, d]) => k === '_build' && d.op === 'place').length }
  e.close(); bot.quit(); await sleep(500)
  finish(summary, pass ? 0 : 1)
}
function finish (summary, code) {
  P(code ? 'FAIL' : 'PASS', summary)
  fs.appendFileSync(process.env.OUT || 'roads-e2e.jsonl', JSON.stringify({ t: new Date().toISOString(), pass: !code, ...summary }) + '\n')
  try { rcon('forceload remove all') } catch { /* sandbox */ }
  process.exit(code)
}
main().catch(err => { P('ERROR', err.stack); process.exit(1) })
