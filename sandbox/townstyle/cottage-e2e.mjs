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
const [B, R, PJ, BB, C, T] = await Promise.all(['buildsite.mjs', 'buildrun.mjs', 'buildproj.mjs', 'buildbot.mjs', 'cottage.mjs', 'townstyle.mjs'].map(imp))

const SERVER = process.env.SBX || 'sandbox4'
const PORT = Number(process.env.PORT || 25602)
const VARIANT = process.env.VARIANT || 's'
const MISORIENT = process.env.MISORIENT === '1'
const NAME = `sbx-Cottage${VARIANT.toUpperCase()}`
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
const KIT = { cobblestone: 128, spruce_planks: 64, spruce_log: 16, glass_pane: 8, dark_oak_stairs: 48, dark_oak_slab: 12, spruce_trapdoor: 8, torch: 4 }

async function main () {
  rcon(`forceload add ${HX - 24} ${HZ - 24} ${HX + 24} ${HZ + 24}`, `gamerule doTileDrops true`)
  rcon(`fill ${HX - 20} ${HY - 4} ${HZ - 20} ${HX + 20} ${HY - 2} ${HZ + 20} minecraft:dirt`,
    `fill ${HX - 20} ${HY - 1} ${HZ - 20} ${HX + 20} ${HY - 1} ${HZ + 20} minecraft:grass_block`,
    `fill ${HX - 20} ${HY} ${HZ - 20} ${HX + 20} ${HY + 14} ${HZ + 20} minecraft:air`,
    `kill @e[type=item,x=${HX - 22},y=${HY - 4},z=${HZ - 22},dx=44,dy=20,dz=44]`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`,
    ...Object.entries(KIT).map(([n, c]) => `give ${NAME} minecraft:${n} ${c}`))
  await sleep(4000)
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = []; moves.allowParkour = false
  bot.pathfinder.setMovements(moves)
  P('spawned at', bot.entity.position, 'bag', bot.inventory.items().map(i => `${i.name}x${i.count}`))
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, props: T.oriented(b.name) ? b.getProperties() : null } : null }
  // the town: home at the field's centre; the plot 12..22 east of home (a house-size plot, 11 x 11)
  const home = { x: HX, y: HY, z: HZ }
  const plan = { v: 1, template: 'ring@1', gen: 1, prev: null, home, s: HY - 1, mode: 'retrofit', at: 1, world: 'sbx', plots: [{ id: 'core', kind: 'plaza', box: [HX - 3, HZ - 3, HX + 3, HZ + 3], y: HY - 1, state: 'existing', keepout: false }], paths: [], groups: {}, transitions: [] }
  const plot = { id: 'X3', kind: 'house', box: [HX + 10, HZ - 5, HX + 20, HZ + 5], y: HY - 1 }
  const sp = C.cottageSitingPlan(home, plot, [])
  const bp = C.styledBlueprint(B.loadBlueprint(`cottage@1${VARIANT}`), STYLE)
  const stood = [[HX, HY, HZ]]
  const site = B.siteBlueprint(read, plan, bp, { tries: 6, plot: C.COTTAGE_PLOT, stood, sectors: sp.sectors, earth: sp.earth, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line })
  if (!site.ok) { P('NO SITE', site.why, JSON.stringify(site.sectors).slice(0, 600)); bot.quit(); process.exit(2) }
  const rec0 = C.cottageRecordOf(site.record, bp, STYLE, { plotId: plot.id, walkR: sp.walkR })
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
    r = await R.runVisit({ dir, key, me: NAME, home, stood, record: h.head.rec, recordGen: h.head.gen, palette: rec0.palette, slot: slot.slot, slotGen: slot.gen, beat: true, unknown: new Set(), stands: { pending: null, bans: {} }, ...C.cottageVisitOpts(h.head.rec) }, e, { deadline: Date.now() + 20 * 60_000 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, NAME, slot.gen)
    P(`visit ${visit}: stop ${r.stop} ${r.why ?? ''} placed ${r.placed} refused ${r.refused} silent ${r.silent} cleared ${r.cleared}`)
    if (r.stop === 'complete') break
    await sleep(1500)
  }
  // THE SERVER'S WORD on every cell: the role's first block name, with the world state for a state cell (a torch: torch or wall_torch)
  const want = c => {
    const n = R.roleFirst(rec0.palette, c.role)
    if (c.role === 'light') return [n, 'wall_torch']
    return [c.ws ? T.stateKey(n, c.ws) : n]
  }
  const cmds = [], idx = []
  for (const c of rec0.cells) for (const w of want(c)) { cmds.push(`execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${w}`); idx.push(c) }
  const res = []
  for (let i = 0; i < cmds.length; i += 120) res.push(...rcon(...cmds.slice(i, i + 120)))
  const okCells = new Set()
  res.forEach((x, i) => { if (/passed/i.test(x.reply)) okCells.add(idx[i]) })
  const bad = rec0.cells.filter(c => !okCells.has(c))
  const places = logs.filter(([k, d]) => k === '_build' && d.op === 'place')
  const reorient = logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'reorient')
  const summary = { variant: VARIANT, misorient: MISORIENT, stop: r?.stop, cells: rec0.cells.length, serverOk: okCells.size, bad: bad.slice(0, 8).map(c => `${c.role}@${c.at}${c.ws ? JSON.stringify(c.ws) : ''}`), places: places.length, stateRows: places.filter(([, d]) => d.st).length, reorient: reorient.length, secs: Math.round((Date.now() - T0) / 1000) }
  P(bad.length || r?.stop !== 'complete' ? 'FAIL' : 'PASS', summary)
  fs.appendFileSync(process.env.OUT || 'cottage-e2e.jsonl', JSON.stringify({ t: new Date().toISOString(), ...summary }) + '\n')
  e.close(); bot.quit(); await sleep(500)
  if (process.env.KEEP !== '1') rcon(`fill ${HX - 20} ${HY} ${HZ - 20} ${HX + 20} ${HY + 14} ${HZ + 20} minecraft:air`, `kill @e[type=item,x=${HX - 22},y=${HY - 4},z=${HZ - 22},dx=44,dy=20,dz=44]`)
  rcon(`forceload remove ${HX - 24} ${HZ - 24} ${HX + 24} ${HZ + 24}`)
  process.exit(bad.length || r?.stop !== 'complete' ? 1 : 0)
}
main().catch(err => { P('ERROR', err.stack); process.exit(1) })
