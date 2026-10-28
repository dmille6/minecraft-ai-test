// TOWNPLAN-01, THE ADOPTERS (build spec 1.6, both engines APPROVE r7): the natural well's NEW-cap search, the raised well's plan,
// the composter's site and the full-town recovery search OUTSIDE the plan first, then SOFT, then a committed BOX -- NEVER a plan
// cell or stand -- and an existing well is never re-judged by the plan. Then the wiring the behaviour cannot reach (comments
// stripped; each with an anchored mutant).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-tpad-logs-'))
process.env.BOT_NAME = 'PlanBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.MEMORY_SCOPE = 'board'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-tpad-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const S = await import('../src/skills.mjs')
const T = await import('../src/townplan.mjs')
const W = await import('../src/well.mjs')
const C = await import('../src/composter.mjs')
const CF = await import('../src/chestfull.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { Vec3 } = await import('vec3')
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

const { tapRecords } = await import('../src/logger.mjs')
const RECS = []
tapRecords(r => RECS.push(r))
const rowsOf = (kind, n0 = 0) => RECS.slice(n0).filter(r => r.skill?.name === `_${kind}` || r.skill?.name === kind).map(r => r.skill?.detail ?? '')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
async function killedBy (fn) { try { await fn(); return false } catch { return true } }
/** Source with comments stripped (this codebase's comments quote the code they explain: CLAUDE.md). */
const code = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** A greenfield town with its root plan (the planner tick), flat grass, home 0,64,0. */
function town (bag = [], at = [2.5, 64, 0.5]) {
  freshPool(); S.resetPlanZones()
  const w = fakeWorld({ bag, at })
  Object.assign(w.bot, { worldId: 'w', username: 'PlanBot', players: {} })
  const r = S.townPlanTick(w.bot, { now: Date.now() })
  assert.equal(r.result, 'accepted', JSON.stringify(r))
  return w
}
const HOME = { x: 0, y: 64, z: 0 }
const readOf = bot => (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness, props: null } : null }

console.log('townplan: the permanent adopters')
await t('NATURAL WELL (a NEW cap): no plan -> the base\'s spiral answer exactly; under a plan -> never a NEVER cell, the plan\'s well sector first, outside before soft', () => {
  const w0 = fakeWorld({ bag: [] }); Object.assign(w0.bot, { worldId: 'w' })
  const base = W.canonicalWellSite({ home: HOME, read: readOf(w0.bot), avoid: [] })
  assert.deepEqual(S.planWellSearch(w0.bot, { home: HOME, read: readOf(w0.bot), avoid: [] }).site, base.site, 'no plan: the base exactly')
  const w = town()
  const tp = S.townPlanNow(w.bot)
  const r = S.planWellSearch(w.bot, { home: HOME, read: readOf(w.bot), avoid: [] })
  assert.ok(r.site, r.why)
  assert.equal(T.footprintTier(tp.ko, r.site), null, 'pass 1: outside the plan')
  const sec = tp.plan.plots.find(p => p.id === 'well').sector
  assert.equal(T.sectorCard(HOME, r.site.x, r.site.z), sec, 'the well sector first')
  for (const c of tp.plan.plots.find(p => p.id === 'store').cells) assert.ok(Math.hypot(r.site.x - c.at[0], r.site.z - c.at[2]) >= 7, 'WELL_HOME_CLEARANCE from every planned store chest')
})
await t('ADOPT ROWS: a NEW well site under a plan writes ONE _townplan_adopt row (tier= plan_refused= gen= never=0); the same answer again writes none; no plan writes none', () => {
  const w = town()
  const tp = S.townPlanNow(w.bot)
  const n0 = RECS.length
  const r = S.planWellSearch(w.bot, { home: HOME, read: readOf(w.bot), avoid: [] })
  S.planWellSearch(w.bot, { home: HOME, read: readOf(w.bot), avoid: [] })
  const rows = rowsOf('townplan_adopt', n0)
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.match(rows[0], new RegExp(`^what=well at=${r.site.x},${r.site.y},${r.site.z} tier=outside plan_refused=\\d+ gen=${tp.gen} never=0$`))
  const w0 = fakeWorld({ bag: [] }); Object.assign(w0.bot, { worldId: 'w' })
  freshPool(); S.resetPlanZones()
  const n1 = RECS.length
  S.planWellSearch(w0.bot, { home: HOME, read: readOf(w0.bot), avoid: [] })
  assert.equal(rowsOf('townplan_adopt', n1).length, 0)
  // never= is the decision's own cells on a NEVER cell: a plan cell handed in as the site counts 1
  const w2 = town()
  const c = S.townPlanNow(w2.bot).plan.plots.find(p => p.id === 'store').cells[0].at
  const n2 = RECS.length
  assert.equal(S.planAdoptRow(w2.bot, 'test', { x: c[0], y: c[1], z: c[2] }), true)
  assert.match(rowsOf('townplan_adopt', n2)[0], / never=1$/)
})
await t('NATURAL WELL: the re-check of a RECORDED site is the base\'s (the plan never re-judges an existing well, Claude spec r1 P1)', () => {
  const src = code('skills.mjs')
  const fn = src.slice(src.indexOf('export function townWellSite'), src.indexOf('function readCapRefused'))
  assert.ok(/compute: \(\) => \(searched = first \? plinthFirstSearch\(planWellSearch\(bot,/.test(fn), 'the compute is the plan\'s search')
  const refuse = fn.slice(fn.indexOf('refuse: site =>'))
  assert.ok(!/planWellSearch|townPlanNow|planTierAt|planWellAvoid/.test(refuse), 'the refuse path never reads the plan')
})
await t('COMPOSTER: the plan\'s farm.composter first when the composter\'s own rules pass; never a NEVER cell', () => {
  const w = town()
  const tp = S.townPlanNow(w.bot)
  const fc = tp.plan.plots.find(p => p.id === 'farm').composter
  const r = S.planComposterSite(w.bot, { home: HOME, read: readOf(w.bot) })
  assert.ok(r.site); assert.deepEqual([r.site.x, r.site.y, r.site.z], fc)
  // the farm cell refused (a chest in its clearance): the spiral, still off the plan's cells
  w.set(fc[0] + 1, fc[1], fc[2], 'chest')
  const r2 = S.planComposterSite(w.bot, { home: HOME, read: readOf(w.bot) })
  assert.ok(r2.site); assert.notDeepEqual([r2.site.x, r2.site.y, r2.site.z], fc)
  assert.notEqual(tp.ko.tier(r2.site.x, r2.site.y, r2.site.z), 'never')
})
await t('RAISED WELL: the plinth planner\'s keep-outs carry every NEVER cell in every pass, the committed boxes in passes 1-2, soft boxes and paths in pass 1 only', () => {
  const w = town()
  const tp = S.townPlanNow(w.bot)
  const p1 = S.planPlinthKeepOut(w.bot, 1), p2 = S.planPlinthKeepOut(w.bot, 2), p3 = S.planPlinthKeepOut(w.bot, 3)
  const never = tp.ko.neverCells.length
  assert.equal(p3.length, never, 'pass 3: NEVER only')
  assert.ok(p1.length > p2.length && p2.length >= p3.length)
  for (const [x, y, z] of tp.ko.neverCells) assert.ok(p3.some(e => e.x === x && e.y === y && e.z === z && e.r === 0))
})
await t('RECOVERY (retrofit, no store cell): the first pass takes a cell OUTSIDE the plan; a base-valid cell the plan refused is counted plan_refused', async () => {
  const w = town([stack('oak_log', 64), stack('chest', 1)])
  // a full chest on the core (the cluster): rings around it reach into the soft core and the workshop
  const tp = S.townPlanNow(w.bot)
  w.set(3, 64, 0, 'chest'); w.fill(3, 64, 0)
  // retrofit-like: no free READY store cell for the recovery (all reserved by another bot)
  const key = (await import('../src/planstore.mjs')).planKey(HOME)
  const PS = await import('../src/planstore.mjs')
  PS.publishPlan(process.env.POOL_STATE_DIR, key, 'w', cur => { for (const c of cur.plots.find(p => p.id === 'store').cells) Object.assign(c, { state: 'reserved', by: 'Other', visit: 'v', until: Date.now() + 120_000 }); return cur }, { by: 'Other' })
  S.townPlanHead(w.bot)
  const n0 = RECS.length
  const r = await S.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
  const placed = w.spy.placed.map(k => k.split(',').map(Number))
  // the row says what the plan cost: a base-valid ring cell (in the soft core around the full chest) refused in pass 1
  const row = rowsOf('deposit_new_chest', n0).find(d => / tier=/.test(d)) ?? ''
  assert.match(row, / tier=outside plan_refused=[1-9]\d* gen=\d+/, row)
  assert.ok(placed.length >= 1, `a chest was placed (${r.status}: ${r.detail})`)
  const ko = S.townPlanNow(w.bot).ko
  for (const p of placed) assert.notEqual(ko.tier(...p), 'never', `never a NEVER cell (${p})`)
  assert.equal(ko.tier(...placed[0]), null, 'the first pass: outside the plan')
  assert.ok(tp)
})

await t('BUILDERS\' TEMPORARY TABLES (Claude code r1 P2): the composter\'s and the well\'s table pickers take a non-plan cell first, a free plan cell second, a NEVER cell never; no plan: the base exactly', async () => {
  const w = town()
  const tp = S.townPlanNow(w.bot)
  const st = tp.plan.plots.find(p => p.id === 'work').stations
  const free = { x: st[0].at[0], y: st[0].at[1], z: st[0].at[2] }
  const PS = await import('../src/planstore.mjs')
  PS.publishPlan(process.env.POOL_STATE_DIR, PS.planKey(HOME), 'w', cur => { Object.assign(cur.plots.find(p => p.id === 'work').stations[1], { state: 'reserved', by: 'Other', visit: 'v', until: Date.now() + 120_000 }); return cur }, { by: 'Other' })
  S.townPlanHead(w.bot)
  const never = { x: st[1].at[0], y: st[1].at[1], z: st[1].at[2] }
  const outside = { x: 30, y: 64, z: 30 }
  const [strict, loose] = S.planTableForbids(w.bot, () => false)
  assert.equal(strict(outside), false); assert.equal(loose(outside), false)
  assert.equal(strict(free), true, 'a free plan cell: refused in the first tier'); assert.equal(loose(free), false, '...taken in the second')
  assert.equal(strict(never), true); assert.equal(loose(never), true, 'a NEVER cell: refused in both')
  const base = c => c.x === 30
  const [s2, l2] = S.planTableForbids(w.bot, base)
  assert.equal(s2(outside), true); assert.equal(l2(outside), true, 'the base forbid still applies')
  const w0 = fakeWorld({ bag: [] }); freshPool(); S.resetPlanZones()
  const [b1, b2] = S.planTableForbids(w0.bot, base)
  assert.equal(b1, base); assert.equal(b2, base, 'no plan: the base forbid itself, twice')
  const src = code('skills.mjs')
  assert.equal(src.split('planTableForbids(bot, wellFree)').length, 2, 'the composter builder')
  assert.equal(src.split('planTableForbids(bot, tableForbid)').length, 2, 'the well builder')
  assert.ok(/wellTableCell\(\{ \.\.\.tableArgs, tableForbid: wellStrict \}\) \?\? wellTableCell\(\{ \.\.\.tableArgs, tableForbid: wellLoose \}\)/.test(src))
  assert.ok(/forbid: planStrict \}\) \?\?\s+tableCellFor\(\{ site, stand: \{ x: stand\.x, y: stand\.y, z: stand\.z \}, read, bodies: bodiesAround\(bot\), forbid: planLoose \}\)/.test(src))
})
await t('BUILDERS\' TABLES, LAST (Codex code r2 P2): place() with planTemp re-judges its EXPLICIT cell against the plan last -- a station reserved meanwhile is refused; without planTemp (placeIntoPlan\'s own reservation) it is placed', async () => {
  const w = town([stack('crafting_table', 2)])
  const PS = await import('../src/planstore.mjs')
  const s0 = S.townPlanNow(w.bot).plan.plots.find(p => p.id === 'work').stations[0]
  PS.publishPlan(process.env.POOL_STATE_DIR, PS.planKey(HOME), 'w', cur => { Object.assign(cur.plots.find(p => p.id === 'work').stations[0], { state: 'reserved', by: 'Other', visit: 'v', until: Date.now() + 120_000 }); return cur }, { by: 'Other' })
  // NO cached plan (Claude code r4 P3): the reservation is only on disk -- place() must refresh the head before asking whether a
  // plan exists, or this case is the one the r3 order missed
  w.bot.townPlan = null
  w.bot.entity.position = new Vec3(s0.at[0] - 0.5, 64, s0.at[2] + 0.5)
  const r = await S.placeForTest({ bot: w.bot }, { item: 'crafting_table', x: s0.at[0], y: s0.at[1], z: s0.at[2] }, new AbortController().signal, { planTemp: true })
  assert.notEqual(w.nameAt(...s0.at), 'crafting_table', JSON.stringify(r))
  const r2 = await S.placeForTest({ bot: w.bot }, { item: 'crafting_table', x: s0.at[0], y: s0.at[1], z: s0.at[2] }, new AbortController().signal, {})
  assert.equal(w.nameAt(...s0.at), 'crafting_table', JSON.stringify(r2))
  const src = code('skills.mjs')
  assert.ok(/placeWithin\(\{ item: 'crafting_table', x: cell\.x, y: cell\.y, z: cell\.z \}, \{ planTemp: true \}\)/.test(src), 'the composter builder')
  assert.ok(/\{ wellOwn: site, by: 'build_well', planTemp: true \}/.test(src), 'the well builder')
})
await t('A BOT THAT NEVER TICKED SEES THE PLAN (Paper FOUND-PLINTH 10-22): its first ask reads the head -- the raised well\'s keep-outs and the well\'s search carry the plan before the first PLAN_TICK_MS', () => {
  town()   // bot A ticks: the root is on disk
  const b = fakeWorld({ bag: [], at: [2.5, 64, 0.5] })
  Object.assign(b.bot, { worldId: 'w', username: 'Late', players: {} })
  assert.equal(b.bot.townPlan, undefined, 'never read')
  assert.ok(S.townPlanNow(b.bot), 'the first ask reads it')
  assert.ok(S.planPlinthKeepOut(b.bot, 1).length > 0, 'the plinth planner sees the plan\'s keep-outs')
  // no world id yet: nothing is read (a write needs the world), the ask is retried later
  const c = fakeWorld({ bag: [] }); Object.assign(c.bot, { username: 'NoWorld' })
  assert.equal(S.townPlanNow(c.bot), null); assert.equal(c.bot.townPlan, undefined)
  // a bot that read "no plan" (null) is not re-read on every ask: the tick refreshes it
  const d = fakeWorld({ bag: [] }); Object.assign(d.bot, { worldId: 'w', username: 'Read', players: {}, townPlan: null })
  assert.equal(S.townPlanNow(d.bot), null)
})
await t('THE PLAN\'S FURNITURE IS NO PATH\'S DIG (Paper FOUND-NOFIT 10-22; real mineflayer-pathfinder Movements): a move through a placed workshop table is no move at all; the same table off the plan is dug as before', async () => {
  const { createRequire } = await import('node:module')
  const rq = createRequire(new URL('../package.json', import.meta.url))
  const { Movements } = rq('mineflayer-pathfinder')
  const registry = rq('prismarine-registry')('1.21.8')
  const Block = rq('prismarine-block')(registry)
  const tables = new Set(['205,65,200', '205,66,200'])
  const blockAt = q => {
    const name = q.y <= 64 ? 'stone' : tables.has(`${q.x},${q.y},${q.z}`) ? 'crafting_table' : 'air'
    const blk = Block.fromStateId(registry.blocksByName[name].defaultState, 0); blk.position = new Vec3(q.x, q.y, q.z); return blk
  }
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(204.5, 65, 200.5), effects: {} }, entities: {}, inventory: { items: () => [] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const forward = cells => {
    const m = new Movements(bot); m.canDig = true; m.allowParkour = false; m.allowSprinting = false; m.scafoldingBlocks = []
    m.exclusionAreasBreak = [blk => T.planBreakCost(cells, blk)]
    return m.getNeighbors({ x: 204, y: 65, z: 200, remainingBlocks: 0 }).find(n => n.x === 205 && n.y === 65 && n.z === 200)
  }
  assert.ok(forward(new Set()), 'off the plan: the table wall is dug through (the base)')
  assert.equal(forward(new Set(['205,65,200'])), undefined, 'a placed plan cell: no move')
  // the cells come from the plan: placed and reserved, never free
  const plan = { plots: [{ id: 'work', stations: [{ at: [1, 2, 3], state: 'placed' }, { at: [4, 5, 6], state: 'reserved' }, { at: [7, 8, 9], state: 'free' }] }] }
  assert.deepEqual([...T.planFurnitureCells(plan)].sort(), ['1,2,3', '4,5,6'])
  // every head read keeps them on the bot (the A* step reads bot.townPlan.cells, never a file)
  const w = town()
  assert.ok(S.townPlanNow(w.bot).cells instanceof Set)
  // the wiring: the SAME break entry as the well (no new array entry)
  assert.ok(/moves\.exclusionAreasBreak = \[\(block\) => wellBreakCost\(wellCols, block, selfWell\) \|\| planBreakCost\(bot\.townPlan\?\.cells, block\)\]/.test(code('index.mjs')))
})
console.log('townplan: the wiring (comments stripped)')
await t('WIRED: the planner tick every PLAN_TICK_MS (index.mjs) and both licence rows once per spawn (features.mjs installFeatures)', () => {
  const src = code('index.mjs')
  assert.ok(/setInterval\(\(\) => \{ try \{ townPlanTick\(bot\) \} catch \{\} \}, PLAN_TICK_MS\)/.test(src))
  const feat = code('features.mjs')   // called once per spawn from index.mjs (test/features-wired)
  assert.ok(/kind: 'townplan_mode'/.test(feat)); assert.ok(/kind: 'found_mode'/.test(feat))
})
await t('WIRED: the found slot sits between the raised well and the town deposit; the recount never displaces a found order (cognitive.mjs)', () => {
  const src = code('cognitive.mjs')
  assert.ok(/order = this\.#plinthOrder\(\) \?\? this\.#foundOrder\(milestone\) \?\? this\.#townDepositOrder\(milestone\) \?\? order/.test(src))
  assert.ok(/order\.skill !== 'found_store' && order\.skill !== 'found_work'\)\) order = this\.#recountOrder\(\)/.test(src))
})
await t('WIRED: found_store / found_work are housekeeping, registered, chatOnly, with a world_change contract', async () => {
  const { HOUSEKEEPING } = await import('../src/hygiene.mjs')
  for (const k of ['found_store', 'found_work']) {
    assert.ok(HOUSEKEEPING.has(k)); assert.ok(S.SKILLS[k]?.chatOnly); assert.deepEqual(S.SKILL_CONTRACTS[k].expects, ['world_change'])
  }
})
/** A temporary table offered a reserved station as its FIRST candidate; `race` reserves it only DURING the look (after the scan). */
async function tableScene (M, { race = false } = {}) {
  freshPool(); M.resetPlanZones()
  const w = fakeWorld({ bag: [stack('crafting_table', 1)], at: [2.5, 64, 0.5] })
  Object.assign(w.bot, { worldId: 'w', username: 'PlanBot', players: {} })
  M.townPlanTick(w.bot, { now: Date.now() })
  const PS = await import('../src/planstore.mjs')
  const s0 = M.townPlanHead(w.bot).head.plan.plots.find(p => p.id === 'work').stations[0]
  const reserve = () => {
    PS.publishPlan(process.env.POOL_STATE_DIR, PS.planKey(HOME), 'w', cur => { Object.assign(cur.plots.find(p => p.id === 'work').stations[0], { state: 'reserved', by: 'Other', visit: 'v', until: Date.now() + 120_000 }); return cur }, { by: 'Other' })
  }
  if (!race) { reserve(); M.townPlanHead(w.bot) } else {
    const look = w.bot.lookAt?.bind(w.bot)
    let once = false
    w.bot.lookAt = async (...a) => { if (!once) { once = true; reserve() } return look ? look(...a) : undefined }
  }
  // the bot stands so that the station is its FIRST candidate (dx +1 at the floor level)
  w.bot.entity.position = new Vec3(s0.at[0] - 0.5, 64, s0.at[2] + 0.5)
  // RACE: every other spot around the bot walled at feet and head level, so the station (a FREE plan cell at the scan: the
  // second tier) is the only candidate -- and it is reserved during the look, after the scan
  if (race) {
    const bx = s0.at[0] - 1, bz = s0.at[2]
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (bx + dx === s0.at[0] && bz + dz === s0.at[2]) continue
      w.set(bx + dx, 64, bz + dz, 'stone'); w.set(bx + dx, 65, bz + dz, 'stone')
    }
  }
  await M.SKILLS.place.run({ bot: w.bot }, { item: 'crafting_table' }, new AbortController().signal)
  return { onStation: w.nameAt(...s0.at) === 'crafting_table', placed: w.spy.placed.length }
}
const SCAN_SKIP = "      if (pc) { planSkip.n++; if (pc === 'plan' && item === 'crafting_table') planLater.push({ ref: under, face: UP }); continue }   // only craft's own temporary table (Claude code r1 P3)\n"
const LATE_SKIP = "        if (pc === 'never' || (pc === 'plan' && item !== 'crafting_table')) { failures.push(`${tgt} became a town plan cell: place again`); continue }\n"
await t('TEMPORARY TABLE: a reserved station cell is skipped at the scan and, when reserved during the look, at the last re-read; the table goes elsewhere', async () => {
  const a = await tableScene(S), b = await tableScene(S, { race: true })
  assert.ok(!a.onStation && a.placed >= 1, JSON.stringify(a))
  assert.ok(!b.onStation, JSON.stringify(b))
})
await t('MUTANT KILLED: placeSites without the scan skip AND the late re-read (a temporary table on a reserved station cell)', async () => {
  const src = readFileSync(SKILLS_PATH, 'utf8')
  assert.equal(src.split(SCAN_SKIP).length, 2, 'SCAN anchor missing or not unique')
  assert.equal(src.split(LATE_SKIP).length, 2, 'LATE anchor missing or not unique')
  const out = new URL(`./_mutant-${process.pid}-both.mjs`, import.meta.url)
  writeFileSync(out, src.replace(SCAN_SKIP, '').replace(LATE_SKIP, '').replace(/from '\.\//g, "from '../src/"))
  try { const M = await import(out.href); assert.equal((await tableScene(M)).onStation, true, 'the mutant must put the table on the station') } finally { try { unlinkSync(out) } catch {} }
})
await t('MUTANT KILLED: the late re-read removed -> a station reserved during the look still takes the table (Codex code r1 P2)', async () => {
  const k = await withMutant(SKILLS_PATH, LATE_SKIP, '', async M => killedBy(async () => {
    assert.equal((await tableScene(M, { race: true })).onStation, false)
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: the recovery\'s first pass allowed into SOFT cells', async () => {
  // the unmutated pass 1 refuses the soft ring cell (the same body, the real module: a kill is not an unrelated throw)
  { const read = (x, y, z) => ({ name: y <= 63 ? 'grass_block' : 'air', boundingBox: y <= 63 ? 'block' : 'empty' })
    assert.equal(CF.pickChestSite({ read, anchor: { x: 10, y: 64, z: 10 }, home: { x: 0, y: 64, z: 0 }, tierOf: () => 'soft', pass: 1 }).site, null)
    assert.ok(CF.pickChestSite({ read, anchor: { x: 10, y: 64, z: 10 }, home: { x: 0, y: 64, z: 0 }, tierOf: () => 'soft', pass: 2 }).site, 'pass 2 takes it: the scene can place') }
  const k = await withMutant(new URL('../src/chestfull.mjs', import.meta.url), "        if (tier && !(rank[tier] < pass)) { planRefused++; bump(`town plan (${tier})`); continue }", "        if (tier === 'never') { planRefused++; bump(`town plan (${tier})`); continue }", async CFM => killedBy(() => {
    // a ring cell inside a soft box: pass 1 must refuse it
    const read = (x, y, z) => ({ name: y <= 63 ? 'grass_block' : 'air', boundingBox: y <= 63 ? 'block' : 'empty' })
    const p = CFM.pickChestSite({ read, anchor: { x: 10, y: 64, z: 10 }, home: { x: 0, y: 64, z: 0 }, tierOf: () => 'soft', pass: 1 })
    assert.equal(p.site, null)
  }))
  assert.ok(k, 'the mutant survived')
})

console.log(`\ntownplan-adopters: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
