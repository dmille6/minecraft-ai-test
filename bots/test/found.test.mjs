// FOUND-01: a town's first chest, crafting table and furnace go into their plan cells -- crafted when the bot has none -- and the
// placements that already happen (the full-town recovery, craft's temporary table, planting) keep out of the plan. Design
// docs/reports/town-plan-2026-10-20.md sections 5, 7.1, 8; build spec docs/reports/townplan-found-spec-2026-10-21.md section 2
// (both engines APPROVE r7).
//
// Behaviour first: the pure decisions (the founding floor, the station rule, the found slot's matrix, the lease); then the REAL
// skills in a fake world (fakeworld.mjs) -- the planner tick writes the plan, found_work / found_store place through the plan's
// reservation protocol, the recovery takes the next store cell, place()'s spot search and planting keep out -- and the found slot
// through the REAL CognitiveLoop. Anchored mutants (the anchor present and unique, or the mutant is not a kill).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-found-logs-'))
process.env.BOT_NAME = 'FoundBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.MEMORY_SCOPE = 'board'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.FOUND ??= 'on'   // the code under test (dormant by default in townplan-01; found-01 turns it on)
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-found-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const F = await import('../src/found.mjs')
const S = await import('../src/skills.mjs')
const PS = await import('../src/planstore.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const FOUND_PATH = new URL('../src/found.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

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
const RECS = []
tapRecords(r => RECS.push(r))
const rowsOf = (kind, n0 = 0) => RECS.slice(n0).filter(r => r.skill?.name === `_${kind}` || r.skill?.name === kind).map(r => r.skill?.detail ?? '')
const st = (n, c) => ({ name: n, count: c })

console.log('found: the pure decisions')
await t('THE FOUNDING FLOOR (build spec 2.1): 16 logs + 20 cobble at hour 1 can found (28 planks above 8 units + 4 planks + scaffold); 64 logs and nothing else is spent only above it', () => {
  const m = F.foundMeans([st('oak_log', 16), st('cobblestone', 20)])
  assert.equal(m.planks, 28); assert.equal(m.cobble, 4)
  assert.ok(F.chestMeans([st('oak_log', 16), st('cobblestone', 20)], m).ok, 'a chest above the floor')
  assert.equal(F.foundMeans([st('oak_log', 16)]).planks, 0, 'logs alone are also the scaffold reserve: nothing above the floor')
  // the active rung's wants raise the floor (Claude spec r2 P3)
  assert.equal(F.foundMeans([st('oak_log', 16), st('cobblestone', 20)], { wanted: { oak_log: 14 } }).planks, 4)
  // the stockpile cap is NOT the floor (Claude spec r1 P1): 20 logs found a chest although 20 < 64
  assert.ok(F.foundMeans([st('oak_log', 20), st('cobblestone', 20)]).planks >= 8)
})
await t('THE STATION RULE (Codex spec r2 P1): a giver never ends without the kind it gives -- 2 tables give one; 1 crafts a spare first; 1 with no wood is not eligible', () => {
  const two = F.stationRule('crafting_table', [st('crafting_table', 2)])
  assert.deepEqual([two.ok, two.crafts], [true, 0])
  const one = F.stationRule('crafting_table', [st('crafting_table', 1), st('oak_log', 16), st('cobblestone', 20)])
  assert.deepEqual([one.ok, one.crafts], [true, 1])
  assert.equal(F.stationRule('crafting_table', [st('crafting_table', 1)]).ok, false)
  assert.equal(F.stationRule('furnace', [st('furnace', 1), st('cobblestone', 40)]).crafts, 1)
  assert.equal(F.stationRule('furnace', [st('furnace', 1), st('cobblestone', 20)]).ok, false, '20 cobble is 4 above the floor: no spare')
})
const plan0 = () => {
  const T = { plots: [
    { id: 'store', kind: 'storehouse', cells: [{ at: [9, 64, -2], kind: 'chest', role: 'overflow', group: null, state: 'free' }, { at: [9, 64, 2], kind: 'chest', role: null, group: null, state: 'free' }] },
    { id: 'work', kind: 'workshop', stations: [{ at: [7, 64, 7], kind: 'crafting_table', state: 'free' }, { at: [8, 64, 7], kind: 'furnace', state: 'free' }] }],
    groups: { v: 1, status: 'greenfield', homes: {} } }
  return T
}
const order = (o = {}) => F.foundOrder({ plan: plan0(), items: [st('crafting_table', 2), st('chest', 2), st('furnace', 2)], ready: () => true, now: 1e9, ...o })
await t('THE FOUND SLOT (build spec 2.1): F1 first; F2 only with no container; F3b once the table is placed; F3 for a homeless group; each guard', () => {
  assert.equal(order().order.args.step, 'F1')
  const p = plan0(); p.plots[1].stations[0].state = 'placed'
  assert.equal(order({ plan: p }).order.args.step, 'F2')
  assert.equal(order({ plan: p, townContainer: true }).order.args.step, 'F3b')
  p.plots[1].stations[1].state = 'placed'
  assert.equal(order({ plan: p, townContainer: true }).skip, 'nothing')
  assert.equal(order({ plan: p, townContainer: true, bankGroups: ['stone'] }).order.args.step, 'F3')
  assert.equal(order({ plan: p, townContainer: true, bankGroups: ['stone'] }).order.args.at.join(), '9,64,2', 'the next cell, never the overflow cell')
  // guards
  assert.equal(order({ plan: null }).skip, 'no_plan')
  assert.equal(order({ zonesKnown: false }).skip, 'zones_unknown')
  assert.equal(order({ state: { visitUsed: true } }).skip, 'visit_used')
  assert.equal(order({ state: { lastAt: 1e9 - 60_000 } }).skip, 'cooldown')
  assert.equal(order({ leaseFree: false }).skip, 'lease_busy')
  assert.equal(order({ ready: () => false }).skip, 'nothing', 'an unready cell is never ordered')
})
await t('INTENT-COMPATIBLE CELLS (Claude/Codex code r2 P2): F3 takes its own group\'s cell first, then a cell with no intent, never another group\'s; F2 never a home cell', () => {
  const p = plan0()
  p.plots[1].stations.forEach(c => { c.state = 'placed' })
  const ov = p.plots[0].cells[0]; ov.state = 'placed'
  // a GONE/EXPIRED home of `wood` (free, intent kept) first in fill order, then a cell with no intent
  p.plots[0].cells = [ov, { at: [9, 64, 2], kind: 'chest', role: 'home', group: 'wood', state: 'free' }, { at: [11, 64, -2], kind: 'chest', role: null, group: null, state: 'free' }]
  const o = g => order({ plan: p, townContainer: true, bankGroups: [g] }).order
  assert.equal(o('stone').args.at.join(), '11,64,-2', 'another group: the no-intent cell, never wood\'s')
  assert.equal(o('wood').args.at.join(), '9,64,2', 'its own cell first')
  // only conflicting cells free -> nothing (no order the walk would refuse)
  p.plots[0].cells = [ov, { at: [9, 64, 2], kind: 'chest', role: 'home', group: 'wood', state: 'free' }]
  assert.equal(order({ plan: p, townContainer: true, bankGroups: ['stone'] }).skip, 'nothing')
  // F2: the overflow unready -> the no-intent cell, never a home cell
  const q = plan0()
  q.plots[0].cells = [{ at: [9, 64, -2], kind: 'chest', role: 'overflow', group: null, state: 'free' }, { at: [9, 64, 2], kind: 'chest', role: 'home', group: 'wood', state: 'free' }, { at: [11, 64, -2], kind: 'chest', role: null, group: null, state: 'free' }]
  q.plots[1].stations.forEach(c => { c.state = 'placed' })
  const r = F.foundOrder({ plan: q, items: [st('chest', 2)], ready: c => c.at.join() !== '9,64,-2', now: 1e9 })
  assert.equal(r.order.args.step, 'F2'); assert.equal(r.order.args.at.join(), '11,64,-2')
})
await t('THE FOUND SLOT vs THE DEPOSIT (build spec 2.1): when the deposit would issue, only an F3 with a CARRIED chest goes first; room-safe crafting', () => {
  const p = plan0(); p.plots[1].stations[0].state = 'placed'; p.plots[1].stations[1].state = 'placed'
  assert.equal(order({ depositWouldIssue: true }).skip, 'deposit_first')
  assert.equal(order({ plan: p, townContainer: true, bankGroups: ['stone'], depositWouldIssue: true }).order.args.step, 'F3')
  const crafted = { items: [st('oak_log', 30), st('cobblestone', 20)] }
  assert.equal(order({ ...crafted, plan: p, townContainer: true, bankGroups: ['stone'], depositWouldIssue: true }).skip, 'deposit_first', 'a crafting F3 waits')
  assert.equal(order({ ...crafted, plan: p, townContainer: true, bankGroups: ['stone'], craftFits: () => false }).skip, 'nothing', 'a craft that does not fit is not ordered')
})
await t('THE FOUND LEASE: one holder; a second is refused; renewal is a new generation by the holder; release frees it', () => {
  const dir = freshPool()
  const a = F.takeFoundLease(dir, 'k', 'A', { now: 1000 })
  assert.ok(a.ok)
  assert.equal(F.takeFoundLease(dir, 'k', 'B', { now: 2000 }).ok, false)
  assert.ok(F.holdsFoundLease(dir, 'k', 'A', a.gen, 2000))
  const g2 = F.renewFoundLease(dir, 'k', 'A', a.gen, { now: 3000 })
  assert.equal(g2, a.gen + 1); assert.equal(F.holdsFoundLease(dir, 'k', 'A', a.gen, 3000), false, 'the old generation is not the lease any more')
  F.releaseFoundLease(dir, 'k', 'A', g2)
  assert.ok(F.takeFoundLease(dir, 'k', 'B', { now: 4000 }).ok)
  assert.ok(F.takeFoundLease(dir, 'k2', 'C', { now: 1000 }).ok && F.takeFoundLease(dir, 'k2', 'D', { now: 1000 + F.FOUND_LEASE_MS + 1 }).ok, 'an expired lease is free')
})

console.log('found: the real skills in a fake world')
/** A fresh greenfield town: the planner tick writes the root plan (flat grass, home 0,64,0). */
function town (bag = [], at = [2.5, 64, 0.5]) {
  freshPool(); S.resetPlanZones()
  const w = fakeWorld({ bag, at })
  Object.assign(w.bot, { worldId: 'w', username: 'FoundBot', players: {} })
  const r = S.townPlanTick(w.bot, { now: Date.now() })
  assert.equal(r.op, 'root'); assert.equal(r.result, 'accepted', JSON.stringify(r))
  return w
}
const head = bot => S.townPlanHead(bot).head.plan
const storeCells = bot => head(bot).plots.find(p => p.id === 'store').cells
const stations = bot => head(bot).plots.find(p => p.id === 'work').stations
const runSkill = (bot, skill, args) => S.SKILLS[skill].run({ bot }, args, new AbortController().signal)
await t('THE FOUND LEASE, TORN (Claude code r1 P2): an unparseable newest generation is busy only until it is older than any lease; then another bot takes the next generation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-found-torn-'))
  fs.writeFileSync(path.join(dir, 'k.found-lease.g1.json'), '{"holder":"A","at":')   // a kill inside the write
  const t0 = fs.statSync(path.join(dir, 'k.found-lease.g1.json')).mtimeMs
  assert.equal(F.foundLeaseState(dir, 'k', t0 + 1000).live, true, 'fresh: busy (it may be a write in flight)')
  assert.equal(F.takeFoundLease(dir, 'k', 'B', { now: t0 + 1000 }).ok, false)
  assert.equal(F.foundLeaseState(dir, 'k', t0 + F.FOUND_LEASE_MS + 1).live, false, 'older than any lease: not live')
  const r = F.takeFoundLease(dir, 'k', 'B', { now: t0 + F.FOUND_LEASE_MS + 1 })
  assert.ok(r.ok && r.gen === 2, JSON.stringify(r))
  assert.equal(F.foundLeaseLive({ rec: null, mtimeMs: 0, now: F.FOUND_LEASE_MS - 1 }), true)
  assert.equal(F.foundLeaseLive({ rec: null, released: true, mtimeMs: 0, now: 1 }), false)
})
await t('FOUND-FLAT F1 (found_work): the bot with 2 tables puts one in station 0 through the reservation protocol; the plan says placed; the lease is released', async () => {
  const w = town([stack('crafting_table', 2)])
  const s0 = stations(w.bot)[0]
  const n0 = RECS.length
  const r = await runSkill(w.bot, 'found_work', { kind: 'crafting_table', at: s0.at, crafts: 0, step: 'F1' })
  assert.equal(r.status, 'success', r.detail)
  // the contract's evidence (Paper FOUND-NOFIT 10-22: scored `unknown` without it): world_change reads result.placed
  assert.equal(r.placed, 1); assert.deepEqual(r.at, s0.at); assert.ok(S.SKILL_CONTRACTS.found_work.expects.includes('world_change'))
  assert.equal(w.nameAt(...s0.at), 'crafting_table')
  const p = stations(w.bot)[0]
  assert.equal(p.state, 'placed'); assert.equal(p.by, 'FoundBot')
  assert.ok(rowsOf('found', n0).some(d => /outcome=placed/.test(d)))
  assert.ok(F.foundLeaseState(process.env.POOL_STATE_DIR, PS.planKey({ x: 0, y: 64, z: 0 })).live === false, 'released')
  assert.equal(w.bot.inventory.items().find(i => i.name === 'crafting_table').count, 1, 'the giver keeps one')
})
await t('FOUND-FLAT F2 (found_store): the town\'s first chest goes in the OVERFLOW cell; it is opened once (the index observes it); the plan says placed, role overflow', async () => {
  const w = town([stack('chest', 1)])
  const ov = storeCells(w.bot)[0]
  assert.equal(ov.role, 'overflow')
  const r = await runSkill(w.bot, 'found_store', { at: ov.at, role: 'overflow', step: 'F2' })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.nameAt(...ov.at), 'chest')
  assert.ok(w.spy.opened.includes(ov.at.join(',')), 'opened once')
  const c = storeCells(w.bot)[0]
  assert.equal(c.state, 'placed'); assert.equal(c.role, 'overflow')
})
await t('F2 (dead end F2): the cell occupied on arrival -> unready, the reservation RELEASED by an explicit transition; nothing placed', async () => {
  const w = town([stack('chest', 1)])
  const ov = storeCells(w.bot)[0]
  w.set(...ov.at, 'cobblestone')
  const r = await runSkill(w.bot, 'found_store', { at: ov.at, role: 'overflow', step: 'F2' })
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /no longer ready|could not be reserved/)
  const c = storeCells(w.bot)[0]
  assert.equal(c.state, 'free')
})
await t('THE CHAIN, intent kept (Claude/Codex code r2 P2): a free cell meant for `wood` -> F3 for `stone` picks the no-intent cell, the reserve is ACCEPTED and the chest lands; a released reservation keeps an older intent and drops the one it set', async () => {
  const w = town([stack('chest', 3), stack('oak_log', 64)])
  const cells = storeCells(w.bot)
  await runSkill(w.bot, 'found_store', { at: cells[0].at, role: 'overflow', step: 'F2' })
  // the next cell in fill order becomes wood's (a gone home: free, intent kept) -- a free cell's intent is the writer's to set
  PS.publishPlan(process.env.POOL_STATE_DIR, PS.planKey({ x: 0, y: 64, z: 0 }), 'w', cur => { Object.assign(cur.plots.find(p => p.id === 'store').cells[1], { role: 'home', group: 'wood' }); return cur }, { by: 'Other' })
  S.townPlanHead(w.bot)
  const plan = S.townPlanNow(w.bot).plan
  const noWork = JSON.parse(JSON.stringify(plan)); for (const c of noWork.plots.find(x => x.id === 'work').stations) c.state = 'placed'
  const o = F.foundOrder({ plan: noWork, items: w.bot.inventory.items(), townContainer: true, bankGroups: ['stone'], ready: () => true, now: 1e9 }).order
  assert.equal(o.args.step, 'F3'); assert.notEqual(o.args.at.join(), cells[1].at.join(), 'never wood\'s cell')
  const r = await runSkill(w.bot, 'found_store', o.args)
  assert.equal(r.status, 'success', r.detail)
  const placed = storeCells(w.bot).find(c => c.at.join() === o.args.at.join())
  assert.equal(placed.state, 'placed'); assert.equal(placed.group, 'stone'); assert.equal(placed.intentSet, undefined, 'the intent is the cell\'s now')
  // a release keeps wood's older intent: occupy wood's cell, then try to found wood there -> unready -> released, still wood's
  const woodCell = storeCells(w.bot)[1]
  w.set(...woodCell.at, 'cobblestone')
  await runSkill(w.bot, 'found_store', { at: woodCell.at, role: 'home', group: 'wood', step: 'F3' })
  const after = storeCells(w.bot)[1]
  assert.equal(after.state, 'free'); assert.equal(after.role, 'home'); assert.equal(after.group, 'wood')
  // ...and a release DROPS the intent its own reservation set: `iron` on a no-intent cell occupied on arrival -> released, no intent
  const free = storeCells(w.bot).find(c => c.state === 'free' && (c.role ?? null) === null)
  w.set(...free.at, 'cobblestone')
  await runSkill(w.bot, 'found_store', { at: free.at, role: 'home', group: 'iron', step: 'F3' })
  const freed = storeCells(w.bot).find(c => c.at.join() === free.at.join())
  assert.equal(freed.state, 'free'); assert.equal(freed.role ?? null, null); assert.equal(freed.group ?? null, null); assert.equal(freed.intentSet, undefined)
})
await t('F8 (craft first, Codex spec r1 P1): the craft fails -> nothing was reserved, the cell is untouched', async () => {
  const w = town([stack('crafting_table', 1), stack('oak_log', 16), stack('cobblestone', 20)])
  const s0 = stations(w.bot)[0]
  const g0 = S.townPlanHead(w.bot).head.gen
  const r = await runSkill(w.bot, 'found_work', { kind: 'crafting_table', at: s0.at, crafts: 1, step: 'F1' })
  assert.equal(r.status, 'failed'); assert.match(r.detail, /could not be crafted/)
  assert.equal(S.townPlanHead(w.bot).head.gen, g0, 'no generation written: no reservation was taken')
  assert.equal(stations(w.bot)[0].state, 'free')
})
await t('F7 (the lease): another bot founding -> lost_lease, a free skip', async () => {
  const w = town([stack('crafting_table', 2)])
  F.takeFoundLease(process.env.POOL_STATE_DIR, PS.planKey({ x: 0, y: 64, z: 0 }), 'OtherBot', { now: Date.now() })
  const r = await runSkill(w.bot, 'found_work', { kind: 'crafting_table', at: stations(w.bot)[0].at, crafts: 0, step: 'F1' })
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /another bot is founding/)
})
await t('THE RECOVERY, greenfield (build spec 2.2): the overflow chest full -> the next STORE cell takes the new chest (no recovery claim); the deposit lands there', async () => {
  const w = town([stack('chest', 1), stack('oak_log', 64)])
  const cells = storeCells(w.bot)
  // the overflow chest exists and is full (placed by found earlier)
  await runSkill(w.bot, 'found_store', { at: cells[0].at, role: 'overflow', step: 'F2' })
  w.fill(...cells[0].at, 'stone')
  w.bag.push(stack('chest', 1))
  const r = await S.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
  const next = storeCells(w.bot)[1]
  assert.equal(w.nameAt(...next.at), 'chest', `the next store cell took the chest (${r.status}: ${r.detail})`)
  assert.equal(next.state, 'placed')
  assert.equal(PS.planGens(process.env.POOL_STATE_DIR, PS.planKey({ x: 0, y: 64, z: 0 })).length > 2, true)
  assert.equal(fs.readdirSync(process.env.POOL_STATE_DIR).filter(f => /town-chest-.*\.c\d+\.json$/.test(f)).length, 0, 'no recovery claim: the section cap, not the budget')
})
await t('GREENFIELD F3 AFTER A RECOVERY CHEST (Claude/Codex code r1 P2): the recovery-placed role:null chest is taken by the bag\'s homeless group (a plan-only publish), and F3 can found the next home', async () => {
  const w = town([stack('chest', 1), stack('oak_log', 64)])
  const cells = storeCells(w.bot)
  await runSkill(w.bot, 'found_store', { at: cells[0].at, role: 'overflow', step: 'F2' })
  w.fill(...cells[0].at, 'stone')
  w.bag.push(stack('chest', 1))
  await S.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
  const plan1 = S.townPlanNow(w.bot).plan
  const un = F.storeHomes(plan1).unassigned
  assert.equal(un.length, 1, 'the recovery chest is unassigned')
  // the pure rule: before, F3 waits (an unassigned container exists); foundAssign names it for the bag's homeless group
  const noWork = pl => { const q = JSON.parse(JSON.stringify(pl)); for (const c of q.plots.find(x => x.id === 'work').stations) c.state = 'placed'; return q }
  assert.equal(order({ plan: noWork(plan1), townContainer: true, bankGroups: ['stone'] }).skip, 'nothing')
  const as = F.foundAssign({ plan: plan1, bankGroups: ['stone'] })
  assert.deepEqual(as, { at: un[0].at, group: 'stone' })
  assert.equal(F.foundAssign({ plan: plan1, bankGroups: [] }), null, 'no homeless group: nothing to assign')
  // the publish: the cell keeps its state, takes role home / group stone (a placed cell's role set once from null)
  const r = S.foundAssignHome(w.bot, as.at, as.group)
  assert.equal(r.result, 'accepted', JSON.stringify(r))
  const plan2 = S.townPlanNow(w.bot).plan
  const c = plan2.plots.find(p => p.id === 'store').cells.find(x => x.at.join() === as.at.join())
  assert.equal(c.state, 'placed'); assert.equal(c.role, 'home'); assert.equal(c.group, 'stone')
  assert.equal(S.foundAssignHome(w.bot, as.at, 'wood').result, 'nothing', 'never re-assigned')
  // F3 again: the next homeless group gets the next store cell
  assert.equal(order({ plan: noWork(plan2), townContainer: true, bankGroups: ['stone', 'wood'] }).order?.args?.step, 'F3')
})
await t('TEMPORARY TABLES (build spec 1.6): craft\'s own spot search never puts a table on a NEVER plan cell; a free plan cell only when nothing else is left; a non-station never', async () => {
  const w = town([stack('crafting_table', 1), stack('cobblestone', 4)])
  const s0 = stations(w.bot)[0]
  // reserve station 0 for someone else: a NEVER cell; stand the bot beside it
  S.townPlanHead(w.bot)
  const key = PS.planKey({ x: 0, y: 64, z: 0 })
  PS.publishPlan(process.env.POOL_STATE_DIR, key, 'w', cur => { const c = cur.plots.find(p => p.id === 'work').stations[0]; Object.assign(c, { state: 'reserved', by: 'Other', visit: 'v', until: Date.now() + 120_000 }); return cur }, { by: 'Other' })
  S.townPlanHead(w.bot)
  w.bot.entity.position = new (await import('vec3')).Vec3(s0.at[0] + 1.5, 64, s0.at[2] + 0.5)
  const r = await S.SKILLS.place.run({ bot: w.bot }, { item: 'crafting_table' }, new AbortController().signal)
  assert.equal(r.status, 'success', r.detail)
  assert.notEqual(w.nameAt(...s0.at), 'crafting_table', 'never the reserved station cell')
  // a non-station (cobblestone) never takes a free plan cell: surround the bot with free plan cells only... the store's
  // free cells are SOFT/NEVER; the bot beside the free station 1 places its cobble elsewhere
  const s1 = stations(w.bot)[1]
  w.bot.entity.position = new (await import('vec3')).Vec3(s1.at[0] + 0.5, 64, s1.at[2] - 0.5)
  await S.SKILLS.place.run({ bot: w.bot }, { item: 'cobblestone' }, new AbortController().signal)
  assert.notEqual(w.nameAt(...s1.at), 'cobblestone')
})
await t('PLANTING (build spec 1.6): never a plan cell, a stand, a plot or a path', async () => {
  const w = town([])
  const s0 = stations(w.bot)[0]
  w.bot.entity.position = new (await import('vec3')).Vec3(s0.at[0] + 0.5, 64, s0.at[2] + 0.5)
  const spot = S.plantableSpotNear(w.bot, 2, 'oak_sapling')
  if (spot) assert.equal(S.planTierAt(w.bot, spot.x, spot.y, spot.z), null, `the spot ${JSON.stringify(spot)} is in the plan`)
  // positive control: far from every plot a spot is found
  w.bot.entity.position = new (await import('vec3')).Vec3(-30.5, 64, -30.5)
  assert.ok(S.plantableSpotNear(w.bot, 2, 'oak_sapling'), 'a spot outside the plan')
})

console.log('found: the found slot through the REAL CognitiveLoop')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop, refundDeclined } = await import('../src/cognitive.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-found-l-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
async function decisions (bot, n) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => { ran.push({ skill, args, slots: bot.inventory.items().length }); return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe`] } } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 200 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return ran
}
const loopBot = w => Object.assign(w.bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
  recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 } })
await t('CHAIN: in a fresh town with a plan, a bot carrying 2 tables gets found_work (F1) first -- ahead of the milestone order and the model', async () => {
  const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
  loopBot(w)
  const ran = await decisions(w.bot, 1)
  assert.equal(ran[0]?.skill, 'found_work', JSON.stringify(ran))
  assert.equal(ran[0].args.step, 'F1')
})
await t('CHAIN, A STALE CACHE (Paper FOUND-RETRO 10-22): another bot reserved station 0 since this bot last read the plan -> the found slot reads the head fresh and never orders F1 at that station', async () => {
  const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
  const s0 = stations(w.bot)[0]
  // on disk only: Other reserves station 0 (this bot's cached head still says free)
  PS.publishPlan(process.env.POOL_STATE_DIR, PS.planKey({ x: 0, y: 64, z: 0 }), 'w', cur => { Object.assign(cur.plots.find(p => p.id === 'work').stations[0], { state: 'reserved', by: 'Other', visit: 'v', until: Date.now() + 120_000 }); return cur }, { by: 'Other' })
  assert.equal(S.townPlanNow(w.bot).plan.plots.find(p => p.id === 'work').stations[0].state, 'free', 'the cache is stale')
  loopBot(w)
  const ran = await decisions(w.bot, 1)
  assert.ok(!(ran[0]?.skill === 'found_work' && ran[0]?.args?.at?.join() === s0.at.join()), JSON.stringify(ran))
})
await t('A BODY IN THE CELL IS A FREE SKIP (Paper FOUND-NOFIT 10-22), pure: foundRetry gives back the visit and the cooldown foundIssued charged; the next order waits FOUND_RETRY_MS, then is issued', () => {
  const st0 = { lastAt: 1000, visitUsed: false }
  const issued = F.foundIssued(st0, 1e9)
  assert.equal(issued.visitUsed, true); assert.equal(issued.lastAt, 1e9)
  const back = F.foundRetry(issued, 1e9 + 5)
  assert.equal(back.visitUsed, false); assert.equal(back.lastAt, 1000, 'the cooldown is the one before this order')
  assert.equal(back.retryAt, 1e9 + 5 + F.FOUND_RETRY_MS)
  assert.equal(order({ state: back, now: 1e9 + 10 }).skip, 'retry_wait')
  assert.equal(order({ state: back, now: 1e9 + 5 + F.FOUND_RETRY_MS }).order?.args?.step, 'F1', 'after the wait: ordered again, the same visit')
  // a NOT-body refusal keeps the charge (only the body is free)
  assert.equal(order({ state: issued, now: 1e9 + 5 + F.FOUND_RETRY_MS }).skip, 'visit_used')
  // THE CAP (Claude code r9 P2): FOUND_BODY_SKIPS_MAX free skips per cell per visit, then charged; another cell has its own;
  // leaving town (a new visit) clears it
  let st = { lastAt: 1000 }
  for (let i = 0; i < F.FOUND_BODY_SKIPS_MAX; i++) { st = F.foundRetry(F.foundIssued(st, 1e9 + i), 1e9 + i, [7, 64, 7]); assert.equal(st.visitUsed, false, `skip ${i + 1} is free`) }
  const capped = F.foundRetry(F.foundIssued(st, 2e9), 2e9, [7, 64, 7])
  assert.equal(capped.visitUsed, true, 'past the cap: charged'); assert.equal(capped.lastAt, 2e9)
  assert.equal(F.foundRetry(F.foundIssued(st, 2e9), 2e9, [9, 64, 2]).visitUsed, false, 'another cell')
  assert.deepEqual(F.foundVisit(capped, false).bodySkips, {}, 'a new visit clears the count')
})
await t('A BODY IN THE CELL, the skill: found_work ends outcome=body, failClass found_body; the reservation is released; nothing placed', async () => {
  const w = town([stack('crafting_table', 2)])
  const s0 = stations(w.bot)[0]
  const { Vec3 } = await import('vec3')
  w.bot.entities = { other: { name: 'player', position: new Vec3(s0.at[0] + 0.5, s0.at[1], s0.at[2] + 0.5), width: 0.6, height: 1.8 } }
  const n0 = RECS.length
  const r = await runSkill(w.bot, 'found_work', { kind: 'crafting_table', at: s0.at, crafts: 0, step: 'F1' })
  assert.equal(r.status, 'no_effect', r.detail); assert.equal(r.failClass, 'found_body'); assert.equal(r.placed, undefined)
  assert.deepEqual(r.at, s0.at, 'the cell travels with the result (the cap is per cell)')
  assert.ok(rowsOf('found', n0).some(d => /outcome=body/.test(d)))
  assert.equal(stations(w.bot)[0].state, 'free')
  assert.notEqual(w.nameAt(...s0.at), 'crafting_table')
})
/** The REAL CognitiveLoop with a runner that answers each found order with `answer`; -> { ran, loop }. */
async function bodyLoop (Loop, w, answer, n) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => { ran.push({ skill, args }); return /^found_/.test(skill) ? answer : { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe`] } } }
  const loop = new Loop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 200 && ran.filter(x => /^found_/.test(x.skill)).length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return { ran, loop }
}
const BODY = { status: 'no_effect', failClass: 'found_body', detail: 'someone is standing in the plan cell' }
await t('CHAIN, A BODY: the found slot gives the visit back on found_body -- no found order inside FOUND_RETRY_MS, the same order after it (one visit)', async () => {
  const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
  loopBot(w)
  const { loop } = await bodyLoop(CognitiveLoop, w, BODY, 1)
  assert.equal(loop.foundState?.visitUsed, false, JSON.stringify(loop.foundState))
  assert.ok(loop.foundState.retryAt > Date.now(), 'the short wait')
  // the wait passes (same visit: the bot never left town) -> ordered again
  assert.equal(F.foundOrder({ plan: S.townPlanNow(w.bot).plan, items: w.bot.inventory.items(), ready: () => true, state: loop.foundState, now: Date.now() }).skip, 'retry_wait')
  assert.equal(F.foundOrder({ plan: S.townPlanNow(w.bot).plan, items: w.bot.inventory.items(), ready: () => true, state: loop.foundState, now: loop.foundState.retryAt }).order?.args?.step, 'F1', 'the same order, the same visit')
})
await t('A BODY, the bot ITSELF over the cell (Claude code r9 P2): never a free skip -- a refusal that could never succeed is charged', async () => {
  const w = town([stack('crafting_table', 2)])
  const s0 = stations(w.bot)[0]
  const { Vec3 } = await import('vec3')
  // the fake world never moves the bot when it is asked to centre: it stays over the cell
  w.bot.entity.position = new Vec3(s0.at[0] + 0.5, s0.at[1], s0.at[2] + 0.5)
  w.bot.pathfinder.goto = async () => {}
  const r = await runSkill(w.bot, 'found_work', { kind: 'crafting_table', at: s0.at, crafts: 0, step: 'F1' })
  assert.equal(r.status, 'no_effect', r.detail); assert.notEqual(r.failClass, 'found_body'); assert.match(r.detail, /the bot itself/)
})
/** The bot on its stand but 0.25 toward the cell (a walk ends within 0.35 of the centre): over the cell. A step forward (the
 *  nudge) moves the fake bot to the stand's centre. -> the run's result and the cell's block. */
async function offsetScene (S2) {
  const w = town([stack('crafting_table', 2)])
  const s0 = stations(w.bot)[0]
  const { Vec3 } = await import('vec3')
  const st = s0.stand
  const dx = Math.sign(s0.at[0] - st[0]), dz = Math.sign(s0.at[2] - st[2])
  w.bot.entity.position = new Vec3(st[0] + 0.5 + 0.25 * dx, st[1], st[2] + 0.5 + 0.25 * dz)
  w.bot.pathfinder.goto = async () => {}
  w.bot.setControlState = (k, on) => { if (k === 'forward' && on) w.bot.entity.position = new Vec3(st[0] + 0.5, st[1], st[2] + 0.5) }
  const r = await S2.SKILLS.found_work.run({ bot: w.bot }, { kind: 'crafting_table', at: s0.at, crafts: 0, step: 'F1' }, new AbortController().signal)
  return { r, block: w.nameAt(...s0.at) }
}
await t('A BODY, the bot ITSELF 0.25 into the cell (Claude code r10 P2): the nudge steps it off on the cell\'s own test and the table is placed', async () => {
  const { r, block } = await offsetScene(S)
  assert.equal(r.status, 'success', r.detail); assert.equal(block, 'crafting_table')
})
await t('MUTANT KILLED: the nudge removed -> the bot\'s own body over the cell refuses (charged) a placement it could make', async () => {
  const k = await withMutant(new URL('../src/skills.mjs', import.meta.url), '    if (selfIn() && stand) {\n', '    if (false) {\n', async M => killedBy(async () => {
    const { r } = await offsetScene(M)
    assert.equal(r.status, 'success')
  }))
  assert.ok(k, 'the mutant survived')
})
await t('CHAIN, NOT A BODY: an ordinary no_effect (failClass unready) keeps the visit charged (only found_body is free)', async () => {
  const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
  loopBot(w)
  const { loop } = await bodyLoop(CognitiveLoop, w, { status: 'no_effect', failClass: 'unready', detail: 'the plan cell is no longer ready' }, 1)
  assert.equal(loop.foundState?.visitUsed, true)
  assert.equal(loop.foundState?.retryAt, undefined)
})
await t('MUTANT KILLED: the free skip keyed on status instead of failClass -> an ordinary refusal is refunded', async () => {
  const COGP = new URL('../src/cognitive.mjs', import.meta.url)
  const k = await withMutant(COGP, "&& r.failClass === 'found_body') this.foundState = foundRetry(", "&& r.status === 'no_effect') this.foundState = foundRetry(", async M => killedBy(async () => {
    const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
    loopBot(w)
    const { loop } = await bodyLoop(M.CognitiveLoop, w, { status: 'no_effect', failClass: 'unready', detail: 'x' }, 1)
    assert.equal(loop.foundState?.visitUsed, true)
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: the free skip removed -> a body costs the visit (the order never comes back while in town)', async () => {
  const COGP = new URL('../src/cognitive.mjs', import.meta.url)
  const line = "      if (!declined && (admitted.skill === 'found_store' || admitted.skill === 'found_work') && r.failClass === 'found_body') this.foundState = foundRetry(this.foundState ?? {}, Date.now(), r.at ?? admitted.args?.at ?? null)\n"
  const k = await withMutant(COGP, line, '', async M => killedBy(async () => {
    const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
    loopBot(w)
    const { loop } = await bodyLoop(M.CognitiveLoop, w, BODY, 1)
    assert.equal(loop.foundState?.visitUsed, false)
  }))
  assert.ok(k, 'the mutant survived')
})
await t('THE FOUNDING FLOOR SWITCH (OWNER DECISION 2026-10-22: yes, founding only): FOUND_BELOW_STOCKPILE off -> the 64-unit stockpile is the floor and an hour-1 bag founds nothing', () => {
  const hour1 = [st('oak_log', 16), st('cobblestone', 20)]
  assert.ok(F.foundMeans(hour1).planks >= 8, 'default: founds from the hour-1 bag')
  assert.equal(F.FOUND_BELOW_STOCKPILE, true)
  const off = F.foundMeans(hour1, { belowStockpile: false })
  assert.equal(off.planks, 0); assert.equal(off.cobble, 0)
  assert.ok(F.foundMeans([st('oak_log', 80), st('cobblestone', 90)], { belowStockpile: false }).planks > 0, 'above 64 it founds')
  assert.match(F.foundModeDetail(), / below_stockpile=1 retry_s=60$/)
})
await t('DECLINED (homefix-01 composition): a found run the runner declined never ran -- its cooldown and its visit are refunded; other skills keep theirs', () => {
  assert.deepEqual(refundDeclined('found_work', { foundState: { lastAt: 5, visitUsed: true, x: 1 } }), { foundState: { lastAt: -Infinity, visitUsed: false, x: 1 } })
  assert.deepEqual(refundDeclined('found_store', { foundState: { lastAt: 5, visitUsed: true } }), { foundState: { lastAt: -Infinity, visitUsed: false } })
  assert.deepEqual(refundDeclined('gather', { foundState: { lastAt: 5, visitUsed: true } }), {})
  assert.deepEqual(refundDeclined('found_work', {}), {})
  // with the previous order's cooldown kept by foundIssued: that one is restored, not wiped (Claude code r9 P3)
  assert.deepEqual(refundDeclined('found_work', { foundState: { lastAt: 9, prevLastAt: 5, visitUsed: true } }), { foundState: { lastAt: 5, prevLastAt: 5, visitUsed: false } })
})
await t('CHAIN CONTROL: the same bot in a town with NO plan on disk (no tick has rooted it) -> no found order (the slot reads the head fresh: a nulled cache is not "no plan" any more)', async () => {
  freshPool(); S.resetPlanZones()
  const w = fakeWorld({ bag: [stack('crafting_table', 2), stack('oak_log', 30)], at: [2.5, 64, 0.5] })
  Object.assign(w.bot, { worldId: 'w', username: 'FoundBot', players: {} })
  loopBot(w)
  const ran = await decisions(w.bot, 1)
  assert.notEqual(ran[0]?.skill, 'found_work', JSON.stringify(ran))
  assert.equal(PS.planGens(process.env.POOL_STATE_DIR, PS.planKey({ x: 0, y: 64, z: 0 })).length, 0, 'still no plan on disk')
})

console.log('found: anchored mutants')
await t('MUTANT KILLED: the station rule gives the only table away', async () => {
  const k = await withMutant(FOUND_PATH, "if (held === 1) return can(1) ?", "if (held === 1) return true ?", async M => killedBy(() => {
    assert.equal(M.stationRule('crafting_table', [st('crafting_table', 1)]).ok, false)
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: the 64-unit stockpile as the floor (no founding at hour 1)', async () => {
  const k = await withMutant(FOUND_PATH, "export const FLOOR_WOOD_UNITS = 8", "export const FLOOR_WOOD_UNITS = 64", async M => killedBy(() => {
    assert.ok(M.chestMeans([st('oak_log', 16), st('cobblestone', 20)]).ok)
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: the deposit priority dropped (a crafting found order ahead of a deposit that would issue)', async () => {
  const k = await withMutant(FOUND_PATH, "  if (depositWouldIssue) {", "  if (false) {", async M => killedBy(() => {
    assert.equal(M.foundOrder({ plan: plan0(), items: [st('crafting_table', 2)], ready: () => true, now: 1e9, depositWouldIssue: true }).skip, 'deposit_first')
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: the re-check before the click skipped (a cell taken during the walk is placed into anyway)', async () => {
  const k = await withMutant(SKILLS_PATH, "    if (why) return { status: 'no_effect', outcome: 'unready', detail: `the plan cell at ${at.join(',')} is no longer ready (${why})` }", '', async M => killedBy(async () => {
    freshPool(); M.resetPlanZones()
    const w = fakeWorld({ bag: [stack('chest', 1)], at: [2.5, 64, 0.5] })
    Object.assign(w.bot, { worldId: 'w', username: 'FoundBot', players: {} })
    M.townPlanTick(w.bot, { now: Date.now() })
    const ov = M.townPlanHead(w.bot).head.plan.plots.find(p => p.id === 'store').cells[0]
    w.set(...ov.at, 'cobblestone')
    const r = await M.SKILLS.found_store.run({ bot: w.bot }, { at: ov.at, role: 'overflow' }, new AbortController().signal)
    assert.equal(r.status, 'no_effect')
  }))
  assert.ok(k, 'the mutant survived')
})

console.log(`\nfound: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
