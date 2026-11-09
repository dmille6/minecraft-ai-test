// SANDBOX-ONLY proof for country-01 + upkeep-01 (owner 11-09: the countryside smoothed and made pretty in rings outside the walls --
// meadows, flower drifts, tree groves; the upkeep crew -- strays swept, felled trees' remains taken down and replanted). Paper 1.21.8 +
// mineflayer and the bots' OWN code: upkeep.mjs upkeepSurvey / upkeepRecord and country.mjs countryPlantings / countryRecord over the
// bot's view of the arena, buildrun.mjs runVisit with the very options skills.mjs buildUpkeep and the country lane of buildTidyVisit pass
// it (the palettes, openRole, alsoDone: a planting with nothing in the bag is passed -- park.mjs terraceSkip), buildbot.mjs
// botBuildEffects (the clicks and digs the fleet sends). Every outcome is read from the SERVER (`execute if block`, `clear <bot> 0`).
//   BOT_ROOT=<checkout with bots/node_modules and the country-01 code> SBX=sandbox5 node sandbox/country/country-proof.cjs
//   (lock first: sandbox/sbxlock.sh take sandbox5 country "...", release after)
//   U1  a crafting table and a furnace standing on the grass outside every record -> listed (kind stray), dug, in the bag
//   U2  two spruce trunks felled at the base (logs over air, tops ground+5 and ground+6) -> listed (kind remains), every log dug from
//       the ground (no tower), one spruce sapling planted at each one's own soil -- THE REPLANT FIRST (upkeep.mjs replantGate)
//   U2b ONE sapling for the two groups: one planted and taken down, the other HELD with all its logs standing; then saplings given,
//       the other planted and taken down
//   U3  never: a living tree (its trunk on the grass), a beam floating ten up (no stand on the ground reaches it)
//   C1  the plantings of a band round the arena's home: groves (spruce first: the arena grows spruce) and flower drifts on the
//       untouched grass, a quarter of it under one snow layer; first visit with saplings only -> every grove sapling on the server,
//       every drift cell PASSED (no flower in the bag: never a blocker, the visit ends complete); then flowers given -> every drift
//       flower on the server; nothing planted on a stray's or a remains' column
// Setup in the sandbox only: forceload, fill, fillbiome, setblock, give, tp.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox5', PORT = REG.servers[SERVER].port, NAME = 'sbx-Ranger', TAG = 'country'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const areBlocks = qs => (qs.length ? rcon(...qs.map(([c, name]) => `execute if block ${c[0]} ${c[1]} ${c[2]} ${name.startsWith('#') ? name : 'minecraft:' + name}`)).map(q => /Test passed/.test(q.reply)) : [])
const countIn = name => +(rcon(`clear ${NAME} minecraft:${name} 0`)[0].reply.match(/Found (\d+)/)?.[1] ?? 0)
const X = 8200, G = 140, Z = 8200, H = 24
const OUT = path.join(__dirname, 'country-proof.jsonl')
const R = { at: new Date().toISOString(), server: SERVER }

async function main () {
  requireSandboxLock(SERVER, TAG)
  const UK = await import(path.resolve(BOT_ROOT, 'bots/src/upkeep.mjs'))
  const CO = await import(path.resolve(BOT_ROOT, 'bots/src/country.mjs'))
  const TI = await import(path.resolve(BOT_ROOT, 'bots/src/tidy.mjs'))
  const PK = await import(path.resolve(BOT_ROOT, 'bots/src/park.mjs'))
  const RUN = await import(path.resolve(BOT_ROOT, 'bots/src/buildrun.mjs'))
  const PJ = await import(path.resolve(BOT_ROOT, 'bots/src/buildproj.mjs'))
  const { botBuildEffects } = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))
  const SW = await import(path.resolve(BOT_ROOT, 'bots/src/gksweep.mjs'))
  rcon(`forceload add ${X - H - 8} ${Z - H - 8} ${X + H + 8} ${Z + H + 8}`, 'time set 1000', 'gamerule doDaylightCycle false', 'difficulty peaceful', 'gamerule doFireTick false', 'gamerule randomTickSpeed 0')
  const T = { table: [X + 6, G + 1, Z + 2], furnace: [X + 6, G + 1, Z + 4] }
  const A = [X - 6, Z], B = [X - 6, Z + 6], TREE = [X + 10, Z - 6]
  const logsA = [3, 4, 5].map(d => [A[0], G + d, A[1]]), logsB = [2, 3, 4, 5, 6].map(d => [B[0], G + d, B[1]]), logsT = [1, 2, 3, 4, 5].map(d => [TREE[0], G + d, TREE[1]])
  const beam = [[X + 10, G + 10, Z + 8], [X + 11, G + 10, Z + 8], [X + 12, G + 10, Z + 8]]
  // the arena in 10-wide x slabs (Paper's fill limit is 32,768 blocks: one 53 x 21 x 53 fill is refused -- and a refused reset is a
  // stale arena, the proof's first run's leftovers)
  const slabs = []
  for (let x0 = X - H - 2; x0 <= X + H + 2; x0 += 10) {
    const x1 = Math.min(X + H + 2, x0 + 9)
    slabs.push(`fill ${x0} ${G - 6} ${Z - H - 2} ${x1} ${G + 14} ${Z + H + 2} minecraft:air`, `fill ${x0} ${G - 6} ${Z - H - 2} ${x1} ${G - 4} ${Z + H + 2} minecraft:stone`,
      `fill ${x0} ${G - 3} ${Z - H - 2} ${x1} ${G - 1} ${Z + H + 2} minecraft:dirt`, `fill ${x0} ${G} ${Z - H - 2} ${x1} ${G} ${Z + H + 2} minecraft:grass_block`,
      `fillbiome ${x0} ${G - 6} ${Z - H - 2} ${x1} ${G + 14} ${Z + H + 2} minecraft:taiga`)
  }
  R.setup = rcon(
    ...slabs,
    // a quarter of the band under one snow layer (the snowy taiga beside the showcase town)
    `fill ${X + 3} ${G + 1} ${Z - 18} ${X + 18} ${G + 1} ${Z - 3} minecraft:snow[layers=1]`,
    `setblock ${T.table.join(' ')} minecraft:crafting_table`, `setblock ${T.furnace.join(' ')} minecraft:furnace`,
    ...[...logsA, ...logsB, ...logsT, ...beam].map(c => `setblock ${c.join(' ')} minecraft:spruce_log`),
    `fill ${A[0] - 1} ${G + 5} ${A[1] - 1} ${A[0] + 1} ${G + 6} ${A[1] + 1} minecraft:spruce_leaves[persistent=true] keep`,
    `fill ${TREE[0] - 1} ${G + 5} ${TREE[1] - 1} ${TREE[0] + 1} ${G + 6} ${TREE[1] + 1} minecraft:spruce_leaves[persistent=true] keep`,
    `kill @e[type=item,x=${X - H - 4},y=${G - 8},z=${Z - H - 4},dx=${2 * H + 8},dy=30,dz=${2 * H + 8}]`).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  if (R.setup.length) throw new Error('arena: ' + JSON.stringify(R.setup))
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const home = { x: X, y: G + 1, z: Z }
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`, `give ${NAME} minecraft:iron_axe 1`, `give ${NAME} minecraft:iron_pickaxe 1`, `give ${NAME} minecraft:spruce_sapling 32`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    // the bots' own walk: no digging on the way, no towers, no scaffold
    const m = new Movements(bot)
    m.allowParkour = false; m.allow1by1towers = false; m.canDig = false; m.scaffoldingBlocks = []; m.placeCost = 5
    bot.pathfinder.setMovements(m)
    const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, props: b.getProperties?.() ?? {} } : null }
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    { const dig1 = e.dig; e.dig = async (c, expect) => { if (UK.STRAY_PICK.test(String(expect ?? ''))) await e.tool?.(); return dig1(c, expect) } }
    const ops = []
    const dig0 = e.dig, send0 = e.send
    e.dig = async (c, x) => { ops.push(['dig', c.join(','), e.feet()]); return dig0(c, x) }
    e.send = (s, f, q, a) => { ops.push(['place', s.map((v, i) => v + f[i]).join(','), e.feet()]); return send0(s, f, q, a) }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'countryproof-'))
    // ---- U: THE UPKEEP -- the survey over the bot's view, then the visit buildUpkeep runs, until the list is worked out ----------------
    const box = [X - H, Z - H, X + H, Z + H]
    const sv = UK.upkeepSurvey(read, { home, r: H, box, U: { ...UK.UPKEEP, r: H } })
    R.survey = { clears: sv.clear.map(c => `${c.kind}:${c.at.join(',')}`), cells: sv.cells.map(c => c.at.join(',')), census: sv.census }
    P('U survey', R.survey)
    const ukey = PJ.projKey(home, UK.UPKEEP_PLOT)
    PJ.publishRecord(dir, ukey, () => UK.upkeepRecord(sv, { home, now: Date.now(), by: NAME }))
    R.uruns = []
    // the visit buildUpkeep runs: THE REPLANT FIRST (the plant pass), then the clears the gate allows read again (the clear pass)
    const upVisit = async (record, k, pass) => {
      const slot = PJ.takeSlot(dir, ukey, NAME, UK.UPKEEP.builders)
      const rh = PJ.recordHead(dir, ukey)
      const grown = (q, rd) => q.role === 'sapling' && UK.replantDone((rd ?? read)(...q.at))
      const noSapling = q => q.role === 'sapling' && !UK.UPKEEP_PALETTE.sapling.some(n => !!e.has?.(n))
      const hasPick = () => bot.inventory.items().some(i => /_pickaxe$/.test(i.name))
      const t0 = Date.now()
      // skills.mjs buildUpkeep's options exactly: the gate at the dig (clearOk), a furnace-kind stray dug with the pickaxe in hand
      const r = await RUN.runVisit({ dir, key: ukey, me: NAME, home, stood: [], record, recordGen: rh.head.gen, palette: UK.UPKEEP_PALETTE, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, slotRef: { gen: slot.gen },
        stands: { pending: null, bans: {} }, unknown: new Set(), beat: true, placedBy: {}, domain: () => true, blockLayer: false, clearMax: 24, walkR: UK.UPKEEP.r + 8, stuckStalledOnly: true,
        clearOk: (c, rd) => UK.upkeepClearOk(urec(), c, rd ?? read, { hasPick: hasPick() }),
        openRole: role => role === 'sapling', alsoDone: (q, rd) => grown(q, rd) || noSapling(q) }, e, { deadline: Date.now() + 170000, maxSteps: pass === 'plant' ? 80 : 160 })
      PJ.releaseLease(dir, ukey, `slot${slot.slot}`, NAME, slot.gen)
      const row = { k, pass, stop: r.stop, placed: r.placed, cleared: r.cleared, ms: Date.now() - t0, why: String(r.why ?? '').slice(0, 120) }
      R.uruns.push(row); P('U visit', row)
      return r
    }
    const urec = () => PJ.recordHead(dir, ukey).head.rec
    // U2b: ONE sapling for two groups -- one group planted and taken down, the other HELD (its logs stand)
    rcon(`clear ${NAME} minecraft:spruce_sapling`, `give ${NAME} minecraft:spruce_sapling 1`)
    await sleep(1500)
    {
      const v1 = UK.upkeepVisitJobs(urec(), read)
      if (v1.plant.cells.length) await upVisit(v1.plant, 0, 'plant')
      await sleep(800)
      const v2 = UK.upkeepVisitJobs(urec(), read)
      R.oneSapling = { held: v2.held, clears: v2.clear.clear.length }
      if (v2.clear.clear.length) await upVisit(v2.clear, 0, 'clear')
      await sleep(1500)
      const standA = areBlocks(logsA.map(c => [c, 'spruce_log'])).filter(Boolean).length, standB = areBlocks(logsB.map(c => [c, 'spruce_log'])).filter(Boolean).length
      R.oneSapling = { ...R.oneSapling, standA, standB, saplingsOn: areBlocks(sv.cells.map(c => [c.at, 'spruce_sapling'])).filter(Boolean).length }
      P('U one sapling', R.oneSapling)
    }
    rcon(`give ${NAME} minecraft:spruce_sapling 8`)
    await sleep(1500)
    for (let k = 1; k < 4; k++) {
      const v1 = UK.upkeepVisitJobs(urec(), read)
      if (v1.plant.cells.length) await upVisit(v1.plant, k, 'plant')
      await sleep(800)
      const v2 = UK.upkeepVisitJobs(urec(), read)
      if (v2.clear.clear.length) await upVisit(v2.clear, k, 'clear')
      await sleep(1000)
      if (UK.upkeepLeft(urec(), read, { canPlant: true }) === 0) break
    }
    // U1's sweep (skills.mjs gkSweep's walk over gksweep.mjs sweepPick, the upkeep's reach): the stray's drops picked up
    await sleep(1500)
    {
      const near = Object.values(bot.entities).filter(en => en?.name === 'item' && en.position).map(en => { let d = null; try { d = en.getDroppedItem?.() } catch {} return { id: en.id, name: d?.name, count: d?.count ?? 1, pos: en.position } })
      const items = bot.inventory.items()
      const sel = SW.sweepPick(near, { boxes: [box], home, caps: [], from: bot.entity.position, stacks: items.map(i => ({ name: i.name, count: i.count, stackSize: i.stackSize })), free: bot.inventory.emptySlotCount(), never: new Set() })
      R.sweep = { seen: sel.seen, picks: sel.picks.map(d => d.name) }
      for (const d of sel.picks) { const en = bot.entities[d.id]; if (!en) continue; try { await Promise.race([bot.pathfinder.goto(new goals.GoalNear(en.position.x, en.position.y, en.position.z, 1)), sleep(8000)]) } catch {} await sleep(400) }
      P('U sweep', R.sweep)
    }
    await sleep(1500)
    const gone = areBlocks([...sv.clear.map(c => [c.at, 'air'])])
    const reps = areBlocks(sv.cells.map(c => [c.at, 'spruce_sapling']))
    const ctl = areBlocks([...logsT.map(c => [c, 'spruce_log']), ...beam.map(c => [c, 'spruce_log'])])
    R.U = { listed: sv.clear.length, gone: gone.filter(Boolean).length, replants: sv.cells.length, replanted: reps.filter(Boolean).length, controlsKept: ctl.filter(Boolean).length, controls: ctl.length,
      bag: { crafting_table: countIn('crafting_table'), furnace: countIn('furnace'), spruce_log: countIn('spruce_log') }, towers: ops.filter(o => o[0] === 'place' && !sv.cells.some(c => c.at.join(',') === o[1])).length }
    P('U', R.U)
    // ---- C: THE PLANTINGS of a band round the arena's home (the record the country lane works) --------------------------------------
    rcon(`give ${NAME} minecraft:spruce_sapling 64`)
    await sleep(1500)
    const band = { id: 'cproof', rMin: 2, rMax: 18, k: 200 }
    const Cx = { ...CO.COUNTRY, grovePer: 70, driftPer: 45, groveLogR: 2, groveSep: 7, driftSep: 5, plantMax: 60, edge: 1 }
    const busy = new Set([...sv.clear.map(c => `${c.at[0]},${c.at[2]}`), ...[TREE, A, B].map(q => q.join(',')), ...beam.map(c => `${c[0]},${c[2]}`)])
    const plant = CO.countryPlantings(read, { home, band, busy, seed: 7, C: Cx })
    const crec = CO.countryRecord(null, plant, { stage: band, home })
    const onSnow = plant.cells.filter(c => (bot.blockAt(new Vec3(...c.at))?.name ?? '') === 'snow')
    R.plan = { cells: plant.cells.length, groves: plant.census.groves, saplings: plant.census.saplings, drifts: plant.census.drifts, flowers: plant.census.flowers, onSnow: onSnow.length, roles: [...new Set(plant.cells.map(c => c.role))], skipped: plant.census.skipped }
    P('C plan', R.plan)
    const ckey = PJ.projKey(home, CO.COUNTRY_PLOT)
    PJ.publishRecord(dir, ckey, () => ({ ...crec, state: 'open' }))
    const plantRun = async label => {
      const rh = PJ.recordHead(dir, ckey)
      const slot = PJ.takeSlot(dir, ckey, NAME, CO.COUNTRY.builders)
      const tools = { get hoe () { return false }, get boneMeal () { return false } }
      const skipV = q => PK.terraceSkip(q, read, { has: n => !!e.has?.(n), tools })
      const t0 = Date.now()
      const r = await RUN.runVisit({ dir, key: ckey, me: NAME, home, stood: [], record: rh.head.rec, recordGen: rh.head.gen, palette: TI.TIDY_PALETTE, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, slotRef: { gen: slot.gen },
        stands: { pending: null, bans: {} }, unknown: new Set(), beat: true, placedBy: {}, domain: () => true, walkR: TI.tidyWalkR(rh.head.rec), blockLayer: false, clearMax: 16, alsoDone: q => !!skipV(q), stuckStalledOnly: true,
        tidyKeepOrder: true, deferSpent: true, openRole: role => PK.OPEN_ROLES.has(role) }, e, { deadline: Date.now() + 170000, maxSteps: 300 })
      PJ.releaseLease(dir, ckey, `slot${slot.slot}`, NAME, slot.gen)
      const row = { label, stop: r.stop, placed: r.placed, ms: Date.now() - t0, why: String(r.why ?? '').slice(0, 120) }
      P('C visit', row)
      return row
    }
    const groves = plant.cells.filter(c => c.plant === 'grove'), drifts = plant.cells.filter(c => c.plant === 'drift')
    R.c1 = await plantRun('saplings_only')
    await sleep(1500)
    R.C1 = { grovesOn: areBlocks(groves.map(c => [c.at, 'spruce_sapling'])).filter(Boolean).length, groves: groves.length, driftsOn: areBlocks(drifts.map(c => [c.at, '#minecraft:small_flowers'])).filter(Boolean).length, drifts: drifts.length }
    P('C1', R.C1)
    rcon(`give ${NAME} minecraft:poppy 32`, `give ${NAME} minecraft:dandelion 32`, `give ${NAME} minecraft:cornflower 32`)
    await sleep(1500)
    R.c2 = await plantRun('flowers_given')
    await sleep(1500)
    const snowK = new Set(onSnow.map(c => c.at.join(',')))
    const placedOn = areBlocks(plant.cells.map(c => [c.at, c.plant === 'grove' ? 'spruce_sapling' : '#minecraft:small_flowers']))
    R.C2 = { grovesOn: areBlocks(groves.map(c => [c.at, 'spruce_sapling'])).filter(Boolean).length, driftsOn: areBlocks(drifts.map(c => [c.at, '#minecraft:small_flowers'])).filter(Boolean).length,
      snowPlaced: plant.cells.filter((c, i) => snowK.has(c.at.join(',')) && placedOn[i]).length, onBusy: plant.cells.filter(c => busy.has(`${c.at[0]},${c.at[2]}`)).length }
    P('C2', R.C2)
  } finally {
    R.pass = {
      U1: (R.survey?.clears ?? []).filter(s => /^stray:/.test(s)).length === 2 && R.U?.bag?.crafting_table >= 1 && R.U?.bag?.furnace >= 1,
      U2: (R.survey?.clears ?? []).filter(s => /^remains:/.test(s)).length === 8 && R.U?.gone === R.U?.listed && R.U?.replants === 2 && R.U?.replanted === 2 && R.U?.towers === 0,
      U2b: R.oneSapling?.held === 1 && R.oneSapling?.saplingsOn === 1 && ((R.oneSapling?.standA === 0 && R.oneSapling?.standB === 5) || (R.oneSapling?.standA === 3 && R.oneSapling?.standB === 0)),
      U3: R.U?.controlsKept === R.U?.controls && R.U?.controls === 8,
      C1: (R.C1?.groves ?? 0) > 0 && R.C1?.grovesOn === R.C1?.groves && R.C1?.driftsOn === 0 && R.c1?.stop === 'complete',
      C2: (R.C1?.drifts ?? 0) > 0 && R.C2?.driftsOn === R.C1?.drifts && R.C2?.grovesOn === R.C1?.groves && (R.plan?.onSnow ?? 0) > 0 && R.C2?.snowPlaced === R.plan?.onSnow && R.C2?.onBusy === 0,
    }
    fs.appendFileSync(OUT, JSON.stringify(R) + '\n')
    P('PASS', R.pass)
    rcon(`gamemode spectator ${NAME}`, `forceload remove ${X - H - 8} ${Z - H - 8} ${X + H + 8} ${Z + H + 8}`, 'gamerule randomTickSpeed 3')
    bot.quit(); await sleep(500)
  }
}
main().then(() => process.exit(0)).catch(err => { P('FATAL', err?.stack ?? String(err)); process.exit(1) })
