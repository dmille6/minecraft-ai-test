// SANDBOX-ONLY (citywall-01, 2026-11-09): A REAL BOT UPGRADES A COBBLE TOWN WALL ON PAPER, PHASE BY PHASE, WITH THE BOTS' OWN CODE --
// and the wall is NEVER OPEN while it does.
//   BOT_ROOT=<worktree> SBX=sandbox4 node sandbox/citywall/wall-e2e.mjs        (lock: sandbox/sbxlock.sh take sandbox4 civic)
// THE ARENA (RCON, sandbox only): a grass field; a small wall@1-shaped ring (the town wall's cross-section: O wall to b+3, merlons on
// alternate columns and run ends at b+4, the walk S2 to b+2, the fire-step S1 to b+1) laid by /fill as the town's standing cobble wall,
// with a 5-wide gateway on its south side and a 2-wide sally port on the east; three O columns of the north side hang over a dug
// trench (the showcase's measured void under 86 of 215 columns), one corner gapped.
// THE CODE UNDER TEST: citywall.mjs citywallDesign (the courses, the underpinning, the towers, the gatehouse, the lamps, the phases) and
// citywallGeneration on the bot's own world read; buildrun.mjs runVisit with the wall visit's options and `swap` (swapDigOk) and
// buildbot.mjs botBuildEffects (walks, aimed clicks, digs, acknowledgements). The kit by RCON (a sandbox only).
// PASS: every phase's visit loop ends `complete`; EVERY design cell reads its role's block (any of its names) and its state BY THE SERVER;
// NEVER A GAP: from the bot's own block updates (the server's word on every change), at no moment two swapped cells of one O column
// open at once, nor two in one segment.
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
const [R, PJ, BB, T, W, CW] = await Promise.all(['buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'townstyle.mjs', 'wall.mjs', 'citywall.mjs'].map(imp))
const lockLib = createRequire(import.meta.url)('../lib/sbxlock.cjs')
const SERVER = process.env.SBX || 'sandbox4'
const REG = JSON.parse(fs.readFileSync(new URL('../sandboxes.json', import.meta.url), 'utf8'))
const PORT = REG.servers[SERVER].port
lockLib.requireSandboxLock?.(SERVER, 'civic')
const NAME = process.env.NAME || 'sbx-Mason2'
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
const rcon = (...cmds) => {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
// /fill refuses more than 32,768 blocks: in x slices
const fill = (x0, y0, z0, x1, y1, z1, b) => `fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} minecraft:${b}`
const fillAll = (x0, y0, z0, x1, y1, z1, block) => { const out = []; const per = Math.max(1, Math.floor(32768 / ((y1 - y0 + 1) * (z1 - z0 + 1)))); for (let x = x0; x <= x1; x += per) out.push(fill(x, y0, z0, Math.min(x1, x + per - 1), y1, z1, block)); return out }
const OUT = process.env.OUT || path.join(path.dirname(new URL(import.meta.url).pathname), 'wall-e2e.jsonl')

// ---- the arena and the old wall ---------------------------------------------------------------------------------------------------
const HX = Number(process.env.HX || 3000), HY = 120, HZ = 3000, G = HY - 1   // home's feet; the grass top G
const RING = [HX - 12, HZ - 9, HX + 12, HZ + 9]      // x0, z0, x1, z1
const GATE = new Set([-2, -1, 0, 1, 2].map(d => `${HX + d},${RING[3]}`))   // the south side's gateway (5 wide)
const PORT2 = new Set([`${RING[2]},${HZ}`, `${RING[2]},${HZ + 1}`])        // an east sally port
const GAPPED = new Set([`${RING[0]},${RING[1]}`, `${RING[0] + 1},${RING[1]}`, `${RING[0]},${RING[1] + 1}`])   // the NW corner a gap
const TRENCH = [[HX - 2, HX], RING[1]]                                     // north side x HX-2..HX: the ground under them dug 2 deep
function oldWall () {
  const loop = W.ringLoop([RING[0], RING[1], RING[2], RING[3]], 0)
  const cols = [], cells = []
  let seg = 0, run = 0, prevWall = false
  loop.forEach(c => {
    const k = `${c.x},${c.z}`
    const s = GATE.has(k) ? 'gate' : PORT2.has(k) ? 'open' : GAPPED.has(k) ? 'gap' : 'wall'
    cols.push({ x: c.x, z: c.z, s, ...(s === 'wall' ? { b: G } : { why: s === 'gate' ? 'path' : s === 'open' ? 'q7' : 'reach' }) })
    if (s === 'wall' && !prevWall) { seg++; run = 0 }
    prevWall = s === 'wall'
    if (s !== 'wall') return
    run++
  })
  // the O cells, the merlons (alternate columns and both run ends) and the steps inward
  const wallCols = cols.filter(c => c.s === 'wall')
  const idx = new Map(cols.map((c, i) => [`${c.x},${c.z}`, i]))
  const isWall = i => cols[(i + cols.length) % cols.length]?.s === 'wall'
  let segN = 0, prev = -2
  for (const c of wallCols) {
    const i = idx.get(`${c.x},${c.z}`)
    if (i !== prev + 1) segN++
    prev = i
    const sg = `W-${String(segN).padStart(2, '0')}`
    for (let y = G + 1; y <= G + 3; y++) cells.push({ at: [c.x, y, c.z], role: 'wall', seg: sg })
    const end = !isWall(i - 1) || !isWall(i + 1)
    if (end || i % 2 === 0) cells.push({ at: [c.x, G + 4, c.z], role: 'wall', seg: sg })
    const outs = W.ringLoop([RING[0], RING[1], RING[2], RING[3]], 0)[i].out
    const ins = outs.map(([dx, dz]) => [-dx, -dz])
    const inn = ins.reduce((a, d) => [a[0] + d[0], a[1] + d[1]], [0, 0])
    const s2 = [c.x + inn[0], c.z + inn[1]], s1 = [c.x + 2 * inn[0], c.z + 2 * inn[1]]
    for (let y = G + 1; y <= G + 2; y++) cells.push({ at: [s2[0], y, s2[1]], role: 'step', seg: sg })
    cells.push({ at: [s1[0], G + 1, s1[1]], role: 'step', seg: sg })
  }
  // de-duplicate (a corner's steps meet)
  const seen = new Set(), uniq = []
  for (const c of cells) { const k = c.at.join(','); if (seen.has(k)) continue; seen.add(k); uniq.push(c) }
  const segs = [...new Set(uniq.map(c => c.seg))].map(s => ({ seg: s, deps: [] }))
  return { v: 1, blueprint: 'wall@1', plot: 'wall', home: { x: HX, y: HY, z: HZ }, ring: RING, cols, cells: uniq, segments: segs, gates: [{ cols: [...GATE].map(k => k.split(',').map(Number)).sort((a, b) => a[0] - b[0]), why: 'path' }],
    clear: [], replant: [], zones: [], builders_max: 4, structure_complete: true, state: 'complete', ports: 1, posts: 0, lights: 0 }
}

export { oldWall }
async function main () {
  if (process.env.DRY === '1') return dry()
  const R0 = 26
  rcon(`forceload add ${HX - R0} ${HZ - R0} ${HX + R0} ${HZ + R0}`, 'gamerule doTileDrops true')
  rcon(...fillAll(HX - R0, G - 4, HZ - R0, HX + R0, G - 1, HZ + R0, 'dirt'), ...fillAll(HX - R0, G, HZ - R0, HX + R0, G, HZ + R0, 'grass_block'), ...fillAll(HX - R0, HY, HZ - R0, HX + R0, HY + 14, HZ + R0, 'air'),
    `kill @e[type=item,x=${HX - R0},y=${G - 6},z=${HZ - R0},dx=${2 * R0},dy=30,dz=${2 * R0}]`)
  const rec0 = oldWall()
  // the old wall by /fill (the town's standing cobble), then the TRENCH under three north columns (the hanging wall)
  const sets = rec0.cells.map(c => `setblock ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:cobblestone`)
  for (let i = 0; i < sets.length; i += 200) rcon(...sets.slice(i, i + 200))
  rcon(fill(TRENCH[0][0], G - 1, TRENCH[1] - 1, TRENCH[0][1], G, TRENCH[1] + 1, 'air'))
  // the O cells over the trench hang: their lowest cell is G+1 over air at G and G-1
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `effect give ${NAME} minecraft:saturation infinite 1 true`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`)
  await sleep(3500); await bot.waitForChunksToLoad()
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, props: T.oriented(b.name) ? b.getProperties() : null } : null }
  const home = { x: HX, y: HY, z: HZ }
  const BS = await imp('buildsite.mjs')
  const walkNodes = new Map()
  for (const k of BS.walkFrom(read, home, new Set(), 40, { stood: [[HX, HY, HZ]] })) { const [x, y, z] = k.split(',').map(Number); const ck = `${x},${z}`; if (!walkNodes.has(ck)) walkNodes.set(ck, []); walkNodes.get(ck).push(y) }
  const design = CW.citywallDesign(read, rec0, { style: process.env.STYLE || 'grey', seed: 7, gatePick: 'path', flat: process.env.FLAT === '1',
    reachUnder: at => !!BS.stepFor(read, home, at, walkNodes, () => true, null), reachSwap: at => !!R.digStand(read, at, walkNodes) })
  if (!design.ok) throw new Error('no design ' + design.why)
  P('design', design.counts, 'skipped', design.skipped, 'gate', design.gate, 'phases', design.phases.map(p => `${p.ph}:${p.kind}:${p.n}`))
  // the kit: every design cell's first name, generously
  const bill = CW.citywallBill(design.cells, design.style)
  const gives = []
  for (const [n, c] of Object.entries(bill)) { let left = c + 8; while (left > 0) { const k = Math.min(64, left); gives.push(`give ${NAME} minecraft:${n} ${k}`); left -= k } }
  rcon(...gives); await sleep(1500)
  // NEVER A GAP: the server's every block change on a swapped cell, from the bot's own world
  const sw = new Map(design.cells.filter(c => c.sw).map(c => [c.at.join(','), c]))
  const open = new Set(), violations = []
  let maxCol = 0, maxSeg = 0
  bot.on('blockUpdate', (oldB, newB) => {
    if (!newB?.position) return
    const k = `${newB.position.x},${newB.position.y},${newB.position.z}`
    const c = sw.get(k); if (!c) return
    if (newB.name === 'air') open.add(k); else open.delete(k)
    const byCol = {}, bySeg = {}
    for (const q of open) { const d = sw.get(q); const ck = `${d.at[0]},${d.at[2]}`; byCol[ck] = (byCol[ck] ?? 0) + 1; bySeg[d.seg] = (bySeg[d.seg] ?? 0) + 1 }
    const mc = Math.max(0, ...Object.values(byCol)), ms = Math.max(0, ...Object.values(bySeg))
    maxCol = Math.max(maxCol, mc); maxSeg = Math.max(maxSeg, ms)
    if (mc > 1 || ms > 1) violations.push({ at: k, open: [...open] })
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citywall-e2e-'))
  const key = PJ.projKey(home, W.WALL_PLOT)
  PJ.publishRecord(dir, key, () => rec0)
  const logs = []
  const e = BB.botBuildEffects(bot, { log: (k, d) => { logs.push([k, d]); if (k === '_build' && /deferred|stuck|refused|misplaced|failed/.test(`${d.op}${d.kind ?? ''}${d.result ?? ''}`)) P(k, d) } })
  const perPhase = []
  for (const ph of design.phases) {
    const h = PJ.recordHead(dir, key).head
    const recN = CW.citywallGeneration(h.rec, design, ph.ph)
    PJ.publishRecord(dir, key, () => recN)
    let r = null
    for (let visit = 0; visit < 12; visit++) {
      // THE TOWN'S DRAW, by RCON in the sandbox (the wall visit draws its bill from the town chests): any first name of this phase's
      // bill the bag holds under 24 of is topped up by 64 (Paper 11-09: a single up-front kit ran short mid-run and the swap waited)
      const held = n => bot.inventory.items().filter(i => i.name === n).reduce((t, i) => t + i.count, 0)
      const tops = Object.keys(ph.bill).filter(n => held(n) < 24).map(n => `give ${NAME} minecraft:${n} 64`)
      if (tops.length) { rcon(...tops); await sleep(800) }
      const hh = PJ.recordHead(dir, key)
      const slot = PJ.takeSlot(dir, key, NAME, 4)
      r = await R.runVisit({ dir, key, me: NAME, home, stood: [[HX, HY, HZ]], record: W.wallVisitRecord(W.wallLightsLast(hh.head.rec), new Map()), recordGen: hh.head.gen, palette: recN.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} },
        domain: () => true, walkR: 40, foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, swap: true, skipOpenDeps: true }, e, { deadline: Date.now() + 20 * 60_000, maxSteps: 600 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
      P(`phase ${ph.ph} ${ph.kind} visit ${visit}: stop ${r.stop} ${r.why ?? ''} placed ${r.placed} cleared ${r.cleared} refused ${r.refused}`)
      if (r.stop === 'complete' || recN.cells.filter(c => c.ph === ph.ph).every(c => R.cellDone(read(...c.at), recN.palette, c.role, c.ws))) break
      await sleep(800)
    }
    perPhase.push({ ph: ph.ph, kind: ph.kind, stop: r?.stop })
  }
  // THE SERVER'S WORD on every design cell
  const pal = CW.citywallPalette(design.style)
  const cmds = [], idx = []
  for (const c of design.cells) for (const n of pal[c.role]) { const w = c.ws ? T.stateKey(n, Object.fromEntries(Object.entries(c.ws).map(([k, v]) => [k, String(v)]))) : n; cmds.push(`execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${w}`); idx.push(c) }
  const res = []
  for (let i = 0; i < cmds.length; i += 150) res.push(...rcon(...cmds.slice(i, i + 150)))
  const okCells = new Set()
  res.forEach((x, i) => { if (/passed/i.test(x.reply)) okCells.add(idx[i]) })
  const bad = design.cells.filter(c => !okCells.has(c))
  const digs = logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'foreign').length
  const summary = { style: design.style, counts: design.counts, perPhase, cells: design.cells.length, serverOk: okCells.size, bad: bad.slice(0, 10).map(c => `${c.role}@${c.at}${c.ws ? JSON.stringify(c.ws) : ''}`), swapDigs: digs, places: logs.filter(([k, d]) => k === '_build' && d.op === 'place').length, maxOpenPerColumn: maxCol, maxOpenPerSegment: maxSeg, gapViolations: violations.length, secs: Math.round((Date.now() - T0) / 1000) }
  const ok = !bad.length && !violations.length
  P(ok ? 'PASS' : 'FAIL', summary)
  fs.appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), server: SERVER, ok, ...summary }) + '\n')
  e.close(); bot.quit(); await sleep(500)
  if (process.env.KEEP !== '1') rcon(...fillAll(HX - R0, HY - 3, HZ - R0, HX + R0, HY + 14, HZ + R0, 'air'))
  rcon(`forceload remove ${HX - R0} ${HZ - R0} ${HX + R0} ${HZ + R0}`)
  process.exit(ok ? 0 : 1)
}
async function dry () {
  // OFFLINE: the arena as a reader (grass at G, the wall's cells, the trench) -> the design the bot will make
  const rec0 = oldWall()
  const solid = new Set(rec0.cells.map(c => c.at.join(',')))
  const trench = (x, y, z) => x >= TRENCH[0][0] && x <= TRENCH[0][1] && z >= TRENCH[1] - 1 && z <= TRENCH[1] + 1 && (y === G || y === G - 1)
  const read = (x, y, z) => (solid.has(`${x},${y},${z}`) ? { name: 'cobblestone', boundingBox: 'block' } : trench(x, y, z) || y > G ? { name: 'air', boundingBox: 'empty' } : { name: y === G ? 'grass_block' : 'dirt', boundingBox: 'block' })
  const d = CW.citywallDesign(read, rec0, { style: 'grey', seed: 7, gatePick: 'path' })
  console.log(JSON.stringify({ ok: d.ok, why: d.why, counts: d.counts, skipped: d.skipped, towers: d.towers, gate: d.gate, phases: d.phases.map(p => `${p.ph}:${p.kind}:${p.n}:${p.segs.join('/')}`) }, null, 1))
  const esc = W.wallEscape(read, { x: HX, y: HY, z: HZ }, [...rec0.cells, ...d.cells], { r: 24 })
  console.log('escape', esc.cut, esc.trapped)
}
main().catch(err => { P('ERROR', err.stack); process.exit(1) })
