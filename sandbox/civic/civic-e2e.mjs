// SANDBOX-ONLY (civic-01, 2026-11-09): A REAL BOT BUILDS EACH LANDMARK LOOK ON PAPER, END TO END, WITH THE BOTS' OWN CODE.
//   BOT_ROOT=<worktree> SBX=sandbox4 node sandbox/civic/civic-e2e.mjs [civic@1-<kind><code> ...]   (lock: sandbox/sbxlock.sh take sandbox4 civic)
// The code under test is the build visit's: buildsite.mjs proveSite (the stands, faces, aims, reach-only cells) on the bot's own world
// read, buildrun.mjs runVisit (segments, leases, misoriented digs), buildbot.mjs botBuildEffects (walks with mineflayer-pathfinder, the
// aimed clicks, the acknowledgements). The kit (each role's first block) is given by RCON (a sandbox only); the crafting is stoneworks'.
// Arena per look (RCON, sandbox only): a 28 x 28 grass field, air above, the bot at its centre (home), the pad 6 east of home.
// PASS per look: the visit loop ends `complete` and EVERY record cell reads its role's block (any of the role's names) and, for a cell
// with a world state, that state, BY THE SERVER (`execute if block x y z <name>[state]`).
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
const [B, R, PJ, BB, T, CV] = await Promise.all(['buildsite.mjs', 'buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'townstyle.mjs', 'civic.mjs'].map(imp))
const lockLib = createRequire(import.meta.url)('../lib/sbxlock.cjs')

const SERVER = process.env.SBX || 'sandbox4'
const REG = JSON.parse(fs.readFileSync(new URL('../sandboxes.json', import.meta.url), 'utf8'))
const PORT = REG.servers[SERVER].port
lockLib.requireSandboxLock?.(SERVER, 'civic')
const IDS = process.argv.slice(2).length ? process.argv.slice(2) : CV.CIVIC_ORDER.flatMap(k => CV.civicLooks(k).slice(0, 1))
const NAME = 'sbx-Civic'
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
const fillAll = (x0, y0, z0, x1, y1, z1, block) => { const out = []; const per = Math.max(1, Math.floor(32768 / ((y1 - y0 + 1) * (z1 - z0 + 1)))); for (let x = x0; x <= x1; x += per) out.push(`fill ${x} ${y0} ${z0} ${Math.min(x1, x + per - 1)} ${y1} ${z1} minecraft:${block}`); return out }
const R0 = 14, HY = 120, OUT = process.env.OUT || path.join(path.dirname(new URL(import.meta.url).pathname), 'civic-e2e.jsonl')

async function runLook (bot, id, HX, HZ) {
  rcon(`forceload add ${HX - R0 - 4} ${HZ - R0 - 4} ${HX + R0 + 4} ${HZ + R0 + 4}`, 'gamerule doTileDrops true')
  rcon(...fillAll(HX - R0, HY - 4, HZ - R0, HX + R0, HY - 2, HZ + R0, 'dirt'), ...fillAll(HX - R0, HY - 1, HZ - R0, HX + R0, HY - 1, HZ + R0, 'grass_block'),
    ...fillAll(HX - R0, HY, HZ - R0, HX + R0, HY + 22, HZ + R0, 'air'), `kill @e[type=item,x=${HX - R0 - 2},y=${HY - 4},z=${HZ - R0 - 2},dx=${2 * R0 + 4},dy=30,dz=${2 * R0 + 4}]`)
  const bp = B.loadBlueprint(id)
  const KIT = {}
  for (const c of bp.cells) { const n = bp.palette[c.role][0]; KIT[n] = (KIT[n] ?? 0) + 1 }
  const gives = []
  for (const [n, c] of Object.entries(KIT)) { let left = c + 4; while (left > 0) { const k = Math.min(64, left); gives.push(`give ${NAME} minecraft:${n} ${k}`); left -= k } }
  rcon(`clear ${NAME}`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`, ...gives)
  await sleep(3500)
  await bot.waitForChunksToLoad()
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, props: T.oriented(b.name) ? b.getProperties() : null } : null }
  const home = { x: HX, y: HY, z: HZ }
  const anchor = { x: HX + 6, z: HZ - 2 }, orient = process.env.ORIENT || 'E'
  const pr = B.proveSite(read, home, bp, { anchor, s: HY, orient, clear: [], fill: [] }, { stood: [[HX, HY, HZ]], domain: () => true, walkR: 30 })
  if (!pr.ok) { P('NO PROOF', id, pr.why, pr.detail ?? ''); return { id, ok: false, why: `proof ${pr.why} ${pr.detail ?? ''}` } }
  const cells = B.placeBlueprint(bp, anchor, HY, orient).map(c => ({ at: c.at, role: c.role, seg: c.seg, ...(c.ws ? { ws: c.ws } : {}), ...(c.blind ? { blind: true } : {}) }))
  const rec0 = { v: 1, blueprint: bp.id, plot: CV.CIVIC_PLOT, home, anchor: [anchor.x, anchor.z], s: HY, orient, cells, segments: bp.segments.map(s => ({ seg: s.seg, deps: s.deps })), palette: bp.palette, clear: [], replant: [], zones: [], builders_max: 1, structure_complete: false, state: 'open' }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civic-e2e-'))
  const key = PJ.projKey(home, CV.CIVIC_PLOT)
  PJ.publishRecord(dir, key, () => rec0)
  const logs = []
  const e = BB.botBuildEffects(bot, { log: (k, d) => { logs.push([k, d]); if (k === '_build' && /clear|deferred|stuck|refused|misplaced/.test(`${d.op}${d.kind ?? ''}${d.result ?? ''}`)) P(k, d) } })
  if (process.env.DEBUG) { const w0 = e.walkTo; e.walkTo = async (s, ...a) => { const ok = await w0(s, ...a); const f = e.feet(); if (!ok || f.join() !== s.join()) P('WALK', ok, s, 'at', f); return ok } }
  let r = null
  const visitOpts = { domain: () => true, walkR: 30 }
  for (let visit = 0; visit < 10; visit++) {
    const slot = PJ.takeSlot(dir, key, NAME, 1)
    const h = PJ.recordHead(dir, key)
    r = await R.runVisit({ dir, key, me: NAME, home, stood: [[HX, HY, HZ]], record: h.head.rec, recordGen: h.head.gen, palette: bp.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} }, ...visitOpts }, e, { deadline: Date.now() + 20 * 60_000 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
    P(`${id} visit ${visit}: stop ${r.stop} ${r.why ?? ''} placed ${r.placed} refused ${r.refused} silent ${r.silent} cleared ${r.cleared}`)
    if (r.stop === 'complete') break
    if (process.env.DEBUG && visit === 1) { const open = cells.filter(c => !R.cellDone(read(...c.at), bp.palette, c.role, c.ws)); P('OPEN', open.slice(0, 6).map(c => `${c.role}@${c.at} sees ${JSON.stringify(read(...c.at))} below ${read(c.at[0], c.at[1] - 1, c.at[2])?.name} feet ${bot.entity.position}`)) }
    await sleep(1000)
  }
  // THE SERVER'S WORD on every cell: any name its role accepts, in the cell's world state when it has one
  const cmds = [], idx = []
  for (const c of cells) for (const n of bp.palette[c.role]) { const w = c.ws ? T.stateKey(n, Object.fromEntries(Object.entries(c.ws).map(([k, v]) => [k, String(v)]))) : n; cmds.push(`execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${w}`); idx.push(c) }
  const res = []
  for (let i = 0; i < cmds.length; i += 150) res.push(...rcon(...cmds.slice(i, i + 150)))
  const okCells = new Set()
  res.forEach((x, i) => { if (/passed/i.test(x.reply)) okCells.add(idx[i]) })
  const bad = cells.filter(c => !okCells.has(c))
  const places = logs.filter(([k, d]) => k === '_build' && d.op === 'place')
  const summary = { id, orient, stop: r?.stop, cells: cells.length, serverOk: okCells.size, stateCells: cells.filter(c => c.ws).length, blind: cells.filter(c => c.blind).length, bad: bad.slice(0, 8).map(c => `${c.role}@${c.at}${c.ws ? JSON.stringify(c.ws) : ''}`), places: places.length, reorient: logs.filter(([k, d]) => k === '_build' && d.kind === 'reorient').length, secs: Math.round((Date.now() - T0) / 1000) }
  const ok = !bad.length && r?.stop === 'complete'
  P(ok ? 'PASS' : 'FAIL', summary)
  fs.appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), server: SERVER, ok, ...summary }) + '\n')
  e.close()
  if (process.env.KEEP !== '1') rcon(...fillAll(HX - R0, HY, HZ - R0, HX + R0, HY + 22, HZ + R0, 'air'))
  rcon(`forceload remove ${HX - R0 - 4} ${HZ - R0 - 4} ${HX + R0 + 4} ${HZ + R0 + 4}`)
  return { id, ok }
}

async function main () {
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `effect give ${NAME} minecraft:saturation infinite 1 true`)
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  const out = []
  let i = 0
  for (const id of IDS) { out.push(await runLook(bot, id, 2000 + (i % 4) * 40, 2000 + Math.floor(i / 4) * 40)); i++ }
  P('DONE', out.map(o => `${o.id}:${o.ok ? 'PASS' : 'FAIL'}`).join(' '))
  bot.quit(); await sleep(500)
  process.exit(out.every(o => o.ok) ? 0 : 1)
}
main().catch(err => { P('ERROR', err.stack); process.exit(1) })
