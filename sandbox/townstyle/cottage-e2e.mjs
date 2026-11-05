// SANDBOX-ONLY (townstyle-01, 2026-11-04): A REAL BOT BUILDS THE COTTAGE ON PAPER, END TO END, WITH THE BOTS' OWN CODE.
//   BOT_ROOT=<worktree> SBX=sandbox4 PORT=25602 VARIANT=s|f node sandbox/townstyle/cottage-e2e.mjs
// The code under test is what a build visit runs: buildsite.mjs siteBlueprint (the proof: stands, faces, aims, the reach-only upper
// cells) on the bot's own world read, buildrun.mjs runVisit (segments, leases, intents, the barrier, misoriented digs), buildbot.mjs
// botBuildEffects (the walks with mineflayer-pathfinder, the aimed clicks, the acknowledgements) -- not the skill's bill or crafts (the
// kit is given by RCON: a sandbox only). Arena (RCON, sandbox only): a 40 x 40 grass field, air above, the bot at its centre (home).
// PASS: the visit loop ends `complete`, and EVERY record cell reads its role's block and its world state BY THE SERVER
// (`execute if block x y z <name>[state]`), every click acknowledged. A misoriented stair set by RCON before the run (one roof cell,
// its facing reversed: MISORIENT=1) must come back right through a `reorient` dig.
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
const [B, R, PJ, BB, C, T, RR] = await Promise.all(['buildsite.mjs', 'buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'cottage.mjs', 'townstyle.mjs', 'reroof.mjs'].map(imp))
// townstyle-03 (RETRO=gable|slab): build the @1 blueprint FLAT first, then the retrofit generation (reroof.mjs) on the standing building
const RETRO = process.env.RETRO || null

const SERVER = process.env.SBX || 'sandbox4'
const PORT = Number(process.env.PORT || 25602)
const VARIANT = process.env.VARIANT || 's'
// townstyle-02: any styled blueprint (workshop@2, hall@2, storehub@2, enchantshop@2, townhall@1); default the cottage
const BLUEPRINT = process.env.BLUEPRINT || `cottage@1${VARIANT}`
const MISORIENT = process.env.MISORIENT === '1'
const NAME = `sbx-TS${BLUEPRINT.replace(/[^a-z0-9]/gi, '').slice(0, 10)}`
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
const rcon = (...cmds) => {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))

const HX = 200, HY = 120, HZ = 200          // home's feet; the field's grass top is HY - 1
const STYLE = { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }
// /fill refuses more than 32,768 blocks: the arena in x slices
const fillAll = (x0, y0, z0, x1, y1, z1, block) => { const out = []; const per = Math.max(1, Math.floor(32768 / ((y1 - y0 + 1) * (z1 - z0 + 1)))); for (let x = x0; x <= x1; x += per) out.push(`fill ${x} ${y0} ${z0} ${Math.min(x1, x + per - 1)} ${y1} ${z1} minecraft:${block}`); return out }
const R0 = 40

async function main () {
  rcon(`forceload add ${HX - R0 - 4} ${HZ - R0 - 4} ${HX + R0 + 4} ${HZ + R0 + 4}`, `gamerule doTileDrops true`)
  rcon(...fillAll(HX - R0, HY - 4, HZ - R0, HX + R0, HY - 2, HZ + R0, 'dirt'), ...fillAll(HX - R0, HY - 1, HZ - R0, HX + R0, HY - 1, HZ + R0, 'grass_block'),
    ...fillAll(HX - R0, HY, HZ - R0, HX + R0, HY + 14, HZ + R0, 'air'),
    `kill @e[type=item,x=${HX - R0 - 2},y=${HY - 4},z=${HZ - R0 - 2},dx=${2 * R0 + 4},dy=20,dz=${2 * R0 + 4}]`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  // THE KIT: the styled blueprint's bill (each cell's first concrete name), given by RCON (this is the VISIT's proof; the skill's bill
  // and crafts are cottage-skill-e2e.mjs's)
  const bp0 = C.styledBlueprint(B.loadBlueprint(BLUEPRINT), STYLE)
  const KIT = {}
  for (const c of bp0.cells) { const n = R.roleFirst(bp0.palette, c.role); if (n) KIT[n] = (KIT[n] ?? 0) + 1 }
  if (RETRO) { const nb = T.stylePalette(RR.reroofBlueprint(B.loadBlueprint(BLUEPRINT), RETRO).palette, STYLE); for (const c of RR.reroofAdded(B.loadBlueprint(BLUEPRINT), RR.reroofBlueprint(B.loadBlueprint(BLUEPRINT), RETRO))) { const n = R.roleFirst(nb, c.role); KIT[n] = (KIT[n] ?? 0) + 1 } }
  for (const n of Object.keys(KIT)) KIT[n] = KIT[n] + 8
  const gives = []
  for (const [n, c] of Object.entries(KIT)) { let left = c; while (left > 0) { const k = Math.min(64, left); gives.push(`give ${NAME} minecraft:${n === 'oak_planks' ? 'spruce_planks' : n} ${k}`); left -= k } }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`, ...gives)
  await sleep(4000)
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  P('spawned at', bot.entity.position, 'bag', bot.inventory.items().map(i => `${i.name}x${i.count}`))
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, props: T.oriented(b.name) ? b.getProperties() : null } : null }
  // the town: home at the field's centre; the plot 12..22 east of home (a house-size plot, 11 x 11)
  const home = { x: HX, y: HY, z: HZ }
  const plan = { v: 1, template: 'ring@1', gen: 1, prev: null, home, s: HY - 1, mode: 'retrofit', at: 1, world: 'sbx', plots: [{ id: 'core', kind: 'plaza', box: [HX - 3, HZ - 3, HX + 3, HZ + 3], y: HY - 1, state: 'existing', keepout: false }], paths: [], groups: {}, transitions: [] }
  const fw = bp0.footprint.u, fd = bp0.footprint.v, side = Math.max(fw, fd) + 2
  const plot = { id: 'X3', kind: 'house', box: [HX + 8, HZ - Math.floor(side / 2), HX + 8 + side - 1, HZ - Math.floor(side / 2) + side - 1], y: HY - 1 }
  const sp = C.cottageSitingPlan(home, plot, [])
  const bp = bp0
  const stood = [[HX, HY, HZ]]
  const site = B.siteBlueprint(read, plan, bp, { tries: 6, plot: C.COTTAGE_PLOT, stood, sectors: sp.sectors, earth: sp.earth, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line })
  if (!site.ok) { P('NO SITE', site.why, JSON.stringify(site.sectors).slice(0, 600)); bot.quit(); process.exit(2) }
  const rec0 = { ...C.cottageRecordOf(site.record, bp, STYLE, { plotId: plot.id, walkR: sp.walkR }), ...(bp.fit ? {} : {}) }
  const visitOpts = { domain: (x, z) => x >= rec0.box[0] - 3 && x <= rec0.box[2] + 3 && z >= rec0.box[1] - 3 && z <= rec0.box[3] + 3, walkR: sp.walkR }
  P('sited', rec0.blueprint, rec0.orient, rec0.anchor, 's', rec0.s, 'cells', rec0.cells.length, 'state cells', rec0.cells.filter(c => c.ws).length, 'blind', rec0.cells.filter(c => c.blind).length)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cottage-e2e-'))
  const key = PJ.projKey(home, C.COTTAGE_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec0, state: 'open' }))
  if (MISORIENT) {
    const c = rec0.cells.find(q => q.role === 'roof' && q.seg === 'roof-edge')
    const back = { north: 'south', south: 'north', east: 'west', west: 'east' }[c.ws.facing]
    // the stair's support row is not built yet: the misoriented stair is placed by RCON where the roof will be (a stand-in for a bad
    // click); the visit must dig it (`reorient`) before it can place the cell
    rcon(`setblock ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:dark_oak_stairs[facing=${back},half=bottom]`)
    P('misoriented by RCON', c.at, back)
  }
  const logs = []
  const e = BB.botBuildEffects(bot, { log: (k, d) => { logs.push([k, d]); if (k === '_build' && /clear|reorient|deferred|stuck/.test(String(d.op) + String(d.kind))) P(k, d) } })
  let r = null
  for (let visit = 0; visit < 8; visit++) {
    const slot = PJ.takeSlot(dir, key, NAME, 2)
    const h = PJ.recordHead(dir, key)
    r = await R.runVisit({ dir, key, me: NAME, home, stood, record: h.head.rec, recordGen: h.head.gen, palette: rec0.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} }, ...visitOpts }, e, { deadline: Date.now() + 20 * 60_000 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
    P(`visit ${visit}: stop ${r.stop} ${r.why ?? ''} placed ${r.placed} refused ${r.refused} silent ${r.silent} cleared ${r.cleared}`)
    if (r.stop === 'complete') break
    await sleep(1500)
  }
  // THE SERVER'S WORD on every cell: the role's first block name, with the world state for a state cell (a torch: torch or wall_torch)
  // THE RETROFIT (RETRO): the planner's step (skills.mjs buildReroof) on the standing building, then its visits
  let recCheck = rec0, palCheck = rec0.palette
  if (RETRO && r?.stop === 'complete') {
    PJ.publishRecord(dir, key, cur => ({ ...cur, structure_complete: true, state: 'complete' }))
    const bpOld = B.loadBlueprint(BLUEPRINT), bpNew = RR.reroofBlueprint(bpOld, RETRO), added = RR.reroofAdded(bpOld, bpNew)
    const bpAdd = { ...bpNew, cells: added, segments: bpNew.segments.filter(sg => ['gable', 'roof-edge', 'roof-inner'].includes(sg.seg)), palette: T.stylePalette(bpNew.palette, STYLE), interior: bpOld.interior ?? [] }
    const hh = PJ.recordHead(dir, key).head
    const pv = B.proveSite(read, home, bpAdd, { anchor: { x: hh.rec.anchor[0], z: hh.rec.anchor[1] }, s: hh.rec.s, orient: hh.rec.orient, clear: [], fill: [] }, { stood, domain: visitOpts.domain, walkR: sp.walkR })
    P('retrofit proof', pv.ok, pv.why, pv.detail ?? '', 'added', added.length)
    if (pv.ok) {
      const pub2 = PJ.publishRecord(dir, key, cur => RR.reroofRecord(cur, pv.cells, bpNew, STYLE))
      P('retrofit generation', pub2.result, pub2.gen)
      for (let visit = 0; visit < 6; visit++) {
        const slot = PJ.takeSlot(dir, key, NAME, 2)
        const h2 = PJ.recordHead(dir, key)
        r = await R.runVisit({ dir, key, me: NAME, home, stood, record: h2.head.rec, recordGen: h2.head.gen, palette: h2.head.rec.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} }, ...visitOpts }, e, { deadline: Date.now() + 20 * 60_000 })
        PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
        P(`retrofit visit ${visit}: stop ${r.stop} ${r.why ?? ''} placed ${r.placed} refused ${r.refused} cleared ${r.cleared}`)
        if (r.stop === 'complete') break
      }
      recCheck = PJ.recordHead(dir, key).head.rec; palCheck = recCheck.palette
    } else r = { stop: 'retro_unproven' }
  }
  const want = c => {
    const n = R.roleFirst(palCheck, c.role)
    if (c.role === 'light') return [n, 'wall_torch']
    if (c.role === 'fill') return ['cobblestone']
    if (n === 'oak_planks') return ['spruce_planks', 'dark_oak_planks']   // '$planks': any species the bag held (the kit: spruce and the ridge's dark oak)
    if (n === 'cut_copper') return ['cut_copper', 'exposed_cut_copper']
    return [c.ws ? T.stateKey(n, c.ws) : n]
  }
  const cmds = [], idx = []
  for (const c of recCheck.cells) for (const w of want(c)) { cmds.push(`execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${w}`); idx.push(c) }
  const res = []
  for (let i = 0; i < cmds.length; i += 120) res.push(...rcon(...cmds.slice(i, i + 120)))
  const okCells = new Set()
  res.forEach((x, i) => { if (/passed/i.test(x.reply)) okCells.add(idx[i]) })
  const bad = recCheck.cells.filter(c => !okCells.has(c))
  const places = logs.filter(([k, d]) => k === '_build' && d.op === 'place')
  const reorient = logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'reorient')
  const summary = { blueprint: BLUEPRINT, retro: RETRO, variant: VARIANT, misorient: MISORIENT, stop: r?.stop, cells: recCheck.cells.length, serverOk: okCells.size, bad: bad.slice(0, 8).map(c => `${c.role}@${c.at}${c.ws ? JSON.stringify(c.ws) : ''}`), places: places.length, stateRows: places.filter(([, d]) => d.st).length, reorient: reorient.length, secs: Math.round((Date.now() - T0) / 1000) }
  P(bad.length || r?.stop !== 'complete' ? 'FAIL' : 'PASS', summary)
  fs.appendFileSync(process.env.OUT || 'cottage-e2e.jsonl', JSON.stringify({ t: new Date().toISOString(), ...summary }) + '\n')
  e.close(); bot.quit(); await sleep(500)
  if (process.env.KEEP !== '1') rcon(...fillAll(HX - R0, HY, HZ - R0, HX + R0, HY + 14, HZ + R0, 'air'), `kill @e[type=item,x=${HX - R0 - 2},y=${HY - 4},z=${HZ - R0 - 2},dx=${2 * R0 + 4},dy=20,dz=${2 * R0 + 4}]`)
  rcon(`forceload remove ${HX - R0 - 4} ${HZ - R0 - 4} ${HX + R0 + 4} ${HZ + R0 + 4}`)
  process.exit(bad.length || r?.stop !== 'complete' ? 1 : 0)
}
main().catch(err => { P('ERROR', err.stack); process.exit(1) })
