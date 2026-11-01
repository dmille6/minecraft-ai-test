// DEEPMINER-01 (OWNER 11-01 item 2): the town deep miner's decisions, as behaviour over plain data (deepmine.mjs), plus the
// few wiring facts behaviour cannot reach (the skill is registered chat-only, the admission branch, the cognitive slots, mine's
// exit credit, gather's diamond tunnel), each with a mutant that asserts its anchor is present and unique.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-deepmine'
process.env.BOT_NAME = process.env.BOT_NAME || 'DeepBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'deep-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const D = await import('../src/deepmine.mjs')
const G = await import('../src/shaftgeom.mjs')
const OT = await import('../src/oretunnel.mjs')
const { canContinueDescent } = await import('../src/exit-contract.mjs')
const { isHousekeeping } = await import('../src/hygiene.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')

const pick = (name, used, max) => ({ name, count: 1, maxDurability: max, durabilityUsed: used })
const stack = (name, count) => ({ name, count })
const stone = used => pick('stone_pickaxe', used, 131)
const iron = used => pick('iron_pickaxe', used, 250)
const fill = n => Array.from({ length: n }, (_, i) => stack(`junk_${i}`, 1))

// ---- 1. the bag ------------------------------------------------------------------------------------------------------------------
test('tripKit: uses split by tier (stone pays the descent, the iron one is kept for diamonds), blocks, room, ore', () => {
  const k = D.tripKit([stone(31), stone(0), iron(50), stack('cobblestone', 40), stack('cobbled_deepslate', 10), stack('diamond', 2), stack('raw_iron', 5), stack('torch', 7)])
  assert.equal(k.lowUses, 100 + 131)
  assert.equal(k.ironUses, 200)
  assert.equal(k.uses, 431)
  assert.equal(k.seal, 50)
  assert.equal(k.free, 36 - 8)
  assert.equal(k.diamonds, 2); assert.equal(k.rawIron, 5); assert.equal(k.torches, 7)
})
test('tripTarget: diamond needs an iron pickaxe AND the descent\'s uses; iron needs only uses; neither -> null', () => {
  assert.equal(D.tripTarget(D.tripKit([iron(0), stone(0)])), 'diamond')
  // an iron pickaxe alone pays the descent only with its spare uses above the diamond reserve: 250-40 = 210 >= 120
  assert.equal(D.tripTarget(D.tripKit([iron(0)])), 'diamond')
  assert.equal(D.tripTarget(D.tripKit([iron(200), stone(100)])), 'iron')   // 50 iron uses < 40+... : 31 low + 10 spare < 120
  assert.equal(D.tripTarget(D.tripKit([stone(0)])), 'iron')
  assert.equal(D.tripTarget(D.tripKit([stone(100)])), null)                 // 31 uses < 70
  assert.equal(D.tripTarget(D.tripKit([])), null)
})

// ---- 2. the order ---------------------------------------------------------------------------------------------------------------
const okStair = { usable: true }
const bag = () => D.tripKit([iron(0), stone(0), stack('cobblestone', 64)])
const base = (o = {}) => ({ on: true, now: 1_000_000_000, atStairTop: true, stair: okStair, kit: bag(), health: 20, me: 'A', state: {}, lease: () => ({ free: true, last: null, releasedAt: null }), ...o })
test('deepMineOrder: issues a trip with the target the bag pays for', () => {
  const r = D.deepMineOrder(base())
  assert.equal(r.order?.skill, 'deep_mine'); assert.equal(r.order.args.target, 'diamond'); assert.equal(r.skip, null)
})
test('deepMineOrder: every precondition is a skip, never an order (off, milestone, cooldown, stair, place, health, room, blocks, pickaxe, lease)', () => {
  const cases = [
    [{ on: false }, 'off'], [{ holds: true }, 'milestone'], [{ state: { cooldownUntil: 2_000_000_000 } }, 'cooldown'],
    [{ stair: { usable: false, why: 'stair_unfinished' } }, 'stair_unfinished'], [{ stair: null }, 'no_stair'],
    [{ atStairTop: false }, 'not_at_stair'], [{ health: 12 }, 'health'],
    [{ kit: D.tripKit([iron(0), stone(0), stack('cobblestone', 64), ...fill(30)]) }, 'room'],
    [{ kit: D.tripKit([iron(0), stone(0), stack('cobblestone', 10)]) }, 'seal_blocks'],
    [{ kit: D.tripKit([stone(120), stack('cobblestone', 64)]) }, 'pickaxe'],
    [{ lease: () => ({ free: false }) }, 'lease_busy'],
  ]
  for (const [o, why] of cases) { const r = D.deepMineOrder(base(o)); assert.equal(r.order, null, why); assert.equal(r.skip, why) }
})
test('deepMineOrder: SOFT PREFERENCE -- the last miner may go at once; another bot waits PREFER_MS after its release, then may go', () => {
  const now = 1_000_000_000
  const lease = releasedAt => () => ({ free: true, last: 'A', releasedAt })
  assert.ok(D.deepMineOrder(base({ me: 'A', lease: lease(now - 60_000) })).order, 'the last miner itself')
  assert.equal(D.deepMineOrder(base({ me: 'B', lease: lease(now - 60_000) })).skip, 'preferred_other')
  assert.ok(D.deepMineOrder(base({ me: 'B', lease: lease(now - D.PREFER_MS - 1) })).order, 'flexible: after the hold anyone may')
  assert.ok(D.deepMineOrder(base({ me: 'B', lease: () => ({ free: true, last: null, releasedAt: null }) })).order, 'no last miner')
})
test('deepTripOrder: an open trip always issues its next call; a closed or absent one never does', () => {
  assert.equal(D.deepTripOrder(null), null)
  assert.equal(D.deepTripOrder({ phase: 'closed' }), null)
  for (const phase of ['descend', 'deepen', 'work', 'return', 'bank']) assert.equal(D.deepTripOrder({ id: 't', target: 'iron', phase }).skill, 'deep_mine')
})

// ---- 3. going home --------------------------------------------------------------------------------------------------------------
test('returnWhy: the clocks, the bag, the pickaxes, the blocks, the goal and the misses each send the miner home', () => {
  const t0 = 1_000_000
  const trip = (o = {}) => ({ ...D.newTrip({ id: 't', target: 'diamond', now: t0 }), arrivedAt: t0, diamonds0: 0, rawIron0: 0, ...o })
  const kit = (o = {}) => ({ ...D.tripKit([iron(0), stone(0), stack('cobblestone', 64)]), ...o })
  assert.equal(D.returnWhy(trip(), { now: t0 + 1000, kit: kit() }), null)
  assert.equal(D.returnWhy(trip(), { now: t0 + D.TRIP_MAX_MS + 1, kit: kit() }), 'trip_time')
  assert.equal(D.returnWhy(trip({ calls: D.CALLS_MAX }), { now: t0, kit: kit() }), 'calls')
  assert.equal(D.returnWhy(trip(), { now: t0, kit: kit(), health: 9 }), 'health')
  assert.equal(D.returnWhy(trip(), { now: t0, kit: kit({ free: 2 }) }), 'bag_full')
  assert.equal(D.returnWhy(trip(), { now: t0, kit: kit({ uses: 15 }) }), 'pickaxe')
  assert.equal(D.returnWhy(trip(), { now: t0, kit: kit({ ironUses: 4 }) }), 'iron_pickaxe')
  assert.equal(D.returnWhy(trip({ target: 'iron' }), { now: t0, kit: kit({ ironUses: 0 }) }), null, 'an iron trip needs no iron pickaxe')
  assert.equal(D.returnWhy(trip(), { now: t0, kit: kit({ seal: 5 }) }), 'seal_blocks')
  assert.equal(D.returnWhy(trip({ diamonds0: 1 }), { now: t0, kit: kit({ diamonds: 9 }) }), 'goal')
  assert.equal(D.returnWhy(trip(), { now: t0 + D.WORK_MS + 1, kit: kit() }), 'work_time')
  assert.equal(D.returnWhy(trip({ misses: D.MISSES_MAX }), { now: t0, kit: kit() }), 'no_ore')
})
test('workKinds: diamonds only on a diamond trip below y=0, iron always', () => {
  assert.deepEqual(D.workKinds({ target: 'diamond' }, -53), [...D.DIAMOND_KINDS, ...D.IRON_ORE_KINDS])
  assert.deepEqual(D.workKinds({ target: 'diamond' }, 16), [...D.IRON_ORE_KINDS])
  assert.deepEqual(D.workKinds({ target: 'iron' }, -53), [...D.IRON_ORE_KINDS])
})

// ---- 4. the way back --------------------------------------------------------------------------------------------------------------
test('trail: stands kept TRAIL_GAP apart; the way back starts at the stand nearest the bot and runs to the trail\'s start', () => {
  let tr = []
  for (const c of [[0, 16, 0], [1, 15, 0], [2, 14, 0], [3, 13, 0], [4, 12, 0], [4, 12, 1], [4, 12, 4], [4, 12, 8]]) tr = D.trailPush(tr, c)
  assert.deepEqual(tr, [[0, 16, 0], [2, 14, 0], [4, 12, 0], [4, 12, 4], [4, 12, 8]])
  assert.deepEqual(D.trailBack(tr, [4, 12, 5]), [[4, 12, 4], [4, 12, 0], [2, 14, 0], [0, 16, 0]])
  assert.deepEqual(D.trailBack(tr, [50, 12, 50]), [], 'off the trail: nothing to walk')
  assert.deepEqual(D.trailPush(tr, [NaN, 1, 1]), tr)
})
const REC = (() => {
  const g = 70, center = [100, 100]
  const away = 'n'
  const origin = G.originFor(center[0], center[1], away)
  const plan = G.planStair({ origin, away, g })
  return { blueprint: G.SHAFT_BLUEPRINT, state: 'complete', structure_complete: true, site: { origin, away, g, center }, K: plan.K, landings: plan.landings.map(l => l.feet), landings_built: plan.landings.map(l => l.feet), exit: [center[0] - 3, g + 1, center[1]], cells: plan.cells }
})()
test('stairRoute: every step\'s stand top down, then the stub floor out to its end, one stair move apart; routeIndex finds the bot on it', () => {
  const r = D.stairRoute(REC, 16)
  const plan = G.planOf(REC)
  const l = plan.landings.find(q => q.feet === 16)
  assert.equal(r.length, l.k + 1 + 4)
  assert.deepEqual(r[0], G.standOf(plan, 0))
  assert.equal(r[l.k][1], 16)
  assert.deepEqual(r[r.length - 1], G.stubEnd(l))
  for (let i = 1; i < r.length; i++) {
    const d = Math.max(Math.abs(r[i][0] - r[i - 1][0]), Math.abs(r[i][2] - r[i - 1][2]))
    assert.ok(d === 1 && r[i - 1][1] - r[i][1] <= 1 && r[i - 1][1] - r[i][1] >= 0, `hop ${i} is one stair move`)
  }
  assert.equal(D.routeIndex(r, r[20]), 20)
  assert.equal(D.routeIndex(r, [0, 0, 0]), -1)
  assert.equal(D.stairRoute({ ...REC, blueprint: 'x' }), null)
})

// ---- 5. the branch: probe ahead, seal, never open beside a liquid ----------------------------------------------------------------
/** A fake world: stone everywhere at y<=20 unless set; air above. */
function world (set = {}) {
  const m = new Map(Object.entries(set))
  const read = (x, y, z) => {
    const k = `${x},${y},${z}`
    if (m.has(k)) { const n = m.get(k); return n == null ? null : { name: n, boundingBox: /air|water|lava|torch/.test(n) ? 'empty' : 'block' } }
    return y <= 20 ? { name: 'deepslate', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
  }
  return { read, dig: c => m.set(c.join(','), 'air'), set: (c, n) => m.set(c.join(','), n) }
}
/** Drive branchNext like the skill does: dig, then step; -> { cells, stop, dug }. */
function drive (w, start, b, len = D.BRANCH_LEN) {
  const cells = D.branchCells(start, b, len)
  const open = new Set([start.join(','), [start[0], start[1] + 1, start[2]].join(',')])
  let i = 0, dug = 0
  for (let g = 0; g < 200; g++) {
    const op = D.branchNext(w.read, cells, i, open)
    if (op.op === 'stop') return { cells: i, stop: op.why, dug }
    if (op.op === 'dig') { w.dig(op.at); open.add(op.at.join(',')); dug++; continue }
    i = op.i + 1
  }
  throw new Error('no end')
}
test('a branch in plain rock: 2 digs a cell, the whole length', () => {
  const w = world()
  const r = drive(w, [0, -53, 0], 0, 12)
  assert.deepEqual(r, { cells: 12, stop: 'end', dug: 24 })
})
test('PROBE AHEAD: lava beside, under or over the next cell stops the branch BEFORE that cell is opened (nothing dug next to it)', () => {
  for (const lava of [[6, -53, 1], [6, -52, -1], [6, -54, 0], [6, -51, 0], [7, -53, 0]]) {
    const w = world({ [lava.join(',')]: 'lava' })
    const r = drive(w, [0, -53, 0], 0, 12)
    assert.equal(r.stop, 'lava', `lava at ${lava}`)
    assert.equal(r.cells, 5, `stopped at cell 6 (x=6) for lava at ${lava}`)
    // no opened cell has a lava neighbour
    const opened = D.branchCells([0, -53, 0], 0, r.cells).flatMap(c => [c.feet, c.head])
    assert.deepEqual(D.sealTargets(w.read, opened), [], 'nothing opened beside the lava')
  }
})
test('PROBE AHEAD: water, a falling block over the head, an unloaded cell and a hole under the next step each stop the branch', () => {
  const at = (k, n) => world({ [k]: n })
  assert.equal(drive(at('4,-53,1', 'water'), [0, -53, 0], 0).stop, 'water')
  assert.equal(drive(at('4,-51,0', 'gravel'), [0, -53, 0], 0).stop, 'falling')
  assert.equal(drive(at('4,-52,1', null), [0, -53, 0], 0).stop, 'unknown')
  assert.equal(drive(at('4,-54,0', 'air'), [0, -53, 0], 0).stop, 'void')
})
test('a cave crossed by a branch: its open cells are walked, not dug', () => {
  const w = world({ '3,-53,0': 'cave_air', '3,-52,0': 'cave_air' })
  const r = drive(w, [0, -53, 0], 0, 6)
  assert.equal(r.stop, 'end'); assert.equal(r.dug, 10)
})
test('SEAL: a liquid beside any opened cell is a seal target; the opened cells themselves and water plants are not', () => {
  const w = world({ '1,-53,1': 'lava', '2,-52,-1': 'water', '0,-51,0': 'flowing_water', '5,-53,0': 'kelp' })
  const opened = [[0, -53, 0], [0, -52, 0], [1, -53, 0], [1, -52, 0], [2, -53, 0], [2, -52, 0]]
  const s = D.sealTargets(w.read, opened).map(c => c.join(','))
  assert.deepEqual(s.sort(), ['0,-51,0', '1,-53,1', '2,-52,-1'].sort())
})

// ---- 6. composition: the exit credit, the diamond tunnel, the gate --------------------------------------------------------------
test('EXIT CREDIT (owner O7): at y=-53 today\'s contract asks a 116-block climb; priced from the stair\'s y=16 landing it asks 69', () => {
  const items = [stone(0), iron(0), stack('cobbled_deepslate', 64), stack('cobblestone', 30)]
  const today = canContinueDescent({ y: -52, health: 20, items })
  assert.equal(today.ok, false, 'the 94 blocks of a fresh trip cannot pay a 116-block climb')
  const credited = canContinueDescent({ y: -52, health: 20, items, seaLevel: D.IRON_FEET })
  assert.equal(credited.ok, true, 'the same bag pays the climb to the stair')
})
test('gather\'s diamond tunnel: only on a deep miner\'s call; iron and coal unchanged', () => {
  assert.equal(OT.tunnelKindsFor('deepslate_diamond_ore'), null)
  assert.deepEqual(OT.tunnelKindsFor('deepslate_diamond_ore', { diamond: true }).kinds, ['diamond_ore', 'deepslate_diamond_ore'])
  assert.deepEqual(OT.DIAMOND_KINDS, [...D.DIAMOND_KINDS])
  assert.equal(OT.tunnelKindsFor('iron_ore', { diamond: true }).label, 'iron')
  assert.equal(OT.tunnelKindsFor('coal_ore', { coal: true, diamond: true }).label, 'coal')
})
test('the gate admits every call of an open trip (the same args each time): no repeat window, cooldown or learned rule strands it', () => {
  const gate = new AdmissionControl({ failCount: () => 9, bumpBlocked: () => 1, entryFor: () => null })
  const bot = { registry: { blocksByName: {}, itemsByName: {} }, entity: { position: { y: -53 } }, players: {}, inventory: { items: () => [] } }
  for (let i = 0; i < 12; i++) assert.equal(gate.check({ skill: 'deep_mine', args: { trip: 't1' } }, bot).ok, true, `call ${i}`)
  assert.equal(gate.check({ skill: 'deep_mine', args: {} }, { ...bot, inventoryUnsettled: { why: 'x' } }).reason, 'inventory_unsettled')
})
test('registered chat-only (never offered to the model), housekeeping (no milestone give-up), one call within the runner\'s cut', () => {
  assert.equal(SKILLS.deep_mine?.chatOnly, true)
  assert.equal(typeof SKILLS.deep_mine.run, 'function')
  assert.equal(isHousekeeping('deep_mine'), true)
  assert.ok(SKILL_CONTRACTS.deep_mine.maxMs <= 180_000)
})

// ---- 7. wiring the behaviour above cannot reach (comments stripped; each anchor proven by a mutant) -------------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const SK = new URL('../src/skills.mjs', import.meta.url)
const CG = new URL('../src/cognitive.mjs', import.meta.url)
const MINE_CREDIT = "...(Number.isFinite(ctx?.deepCredit) && bot.deepTrip ? { seaLevel: ctx.deepCredit } : {}),"
const DEEPEN_CALL = "r = await mineGuarded({ ...ctx, deepCredit: DEEP_IRON_FEET }, { y: DEEP_DEEP_FEET }, sub.signal)"
const GATHER_DIAMOND = "const tk = tunnelKindsFor(viaSource ?? blockName, { diamond: bot.deepTunnelKinds === true })"
const COG_CONT = "{ const o = deepTripOrder(this.bot?.deepTrip); if (o) order = o }"
const COG_START = "const r = deepMineOrder({ now: Date.now(), holds: milestoneHolds({ order, ready }), atStairTop, stair: st,"
const wired = (src) => ({
  credit: strip(src.sk).includes(MINE_CREDIT), deepen: strip(src.sk).includes(DEEPEN_CALL), diamond: strip(src.sk).includes(GATHER_DIAMOND),
  cont: strip(src.cg).includes(COG_CONT), start: strip(src.cg).includes(COG_START),
})
test('wired: mine prices a leaseholder\'s climb from the stair, the deepen call passes the credit, gather tunnels diamonds on the flag, cognitive continues and starts trips', () => {
  const src = { sk: readFileSync(SK, 'utf8'), cg: readFileSync(CG, 'utf8') }
  assert.deepEqual(wired(src), { credit: true, deepen: true, diamond: true, cont: true, start: true })
})
test('MUTANTS: each wiring anchor is present exactly once, and removing it is seen', () => {
  const src = { sk: readFileSync(SK, 'utf8'), cg: readFileSync(CG, 'utf8') }
  const cases = [['sk', MINE_CREDIT, '', 'credit'], ['sk', DEEPEN_CALL, 'r = await mineGuarded(ctx, { y: DEEP_DEEP_FEET }, sub.signal)', 'deepen'],
    ['sk', GATHER_DIAMOND, 'const tk = tunnelKindsFor(viaSource ?? blockName)', 'diamond'], ['cg', COG_CONT, '', 'cont'], ['cg', COG_START, 'const r = ({', 'start']]
  for (const [f, old, neu, key] of cases) {
    assert.equal(src[f].split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${key}`)
    const m = { ...src, [f]: src[f].replace(old, neu) }
    assert.equal(wired(m)[key], false, `mutant ${key} not seen`)
  }
})
test('MUTANT: without the admission branch, the trip\'s 5th identical call is refused (repeat_loop) -- the branch is what keeps it going', async () => {
  const path = new URL('../src/admission.mjs', import.meta.url)
  const old = "    if (skill === 'deep_mine' && !bot?.inventoryUnsettled) return { ok: true, skill, args: args ?? {}, kind: 'deep_mine' }\n" +
    "    if (skill === 'deep_mine') return { ok: false, reason: 'inventory_unsettled', detail: `wait: a stack is still being put back from the cursor (${String(bot.inventoryUnsettled.why ?? '').slice(0, 60)})` }\n"
  const src = readFileSync(path, 'utf8')
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-deep-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '').replace(/from '\.\//g, "from '../src/"))
  try {
    const { AdmissionControl: A } = await import(out.href)
    const gate = new A(null)
    const bot = { registry: { blocksByName: {}, itemsByName: {} }, entity: { position: { y: -53 } }, players: {}, inventory: { items: () => [] } }
    const res = []
    for (let i = 0; i < 6; i++) res.push(gate.check({ skill: 'deep_mine', args: { trip: 't1' } }, bot).reason ?? 'ok')
    assert.ok(res.includes('repeat_loop'), `mutant refused nothing: ${res}`)
  } finally { try { unlinkSync(out) } catch {} }
})

// ---- 8. Paper r1 (11-01): the reflexes and the loop between two calls of one trip ------------------------------------------------
test('tripHoldsBody: underground phases of a live trip only; a stale trip (nobody advancing it) hands the body back', () => {
  const now = 10_000_000
  for (const phase of ['deepen', 'work', 'return']) assert.equal(D.tripHoldsBody({ phase, startedAt: now - 60_000 }, now), true, phase)
  for (const phase of ['descend', 'bank', 'closed']) assert.equal(D.tripHoldsBody({ phase, startedAt: now }, now), false, phase)
  assert.equal(D.tripHoldsBody(null, now), false)
  assert.equal(D.tripHoldsBody({ phase: 'work', startedAt: now - D.TRIP_MAX_MS - 11 * 60_000 }, now), false, 'stale')
})
const RF = new URL('../src/reflex.mjs', import.meta.url)
const MAROON_GATE = "!runner.isBusy() && !tripHoldsBody(bot.deepTrip) && Date.now() >= airPocketBreatheUntil"
const NEXT_SOON = "this.#scheduleNext(deepTripOrder(this.bot?.deepTrip) ? DEEP_TRIP_NEXT_MS : undefined)"
test('wired: the maroon lattice asks tripHoldsBody; the loop schedules an open trip\'s next call at once (mutants seen)', () => {
  const rf = readFileSync(RF, 'utf8'), cg = readFileSync(CG, 'utf8')
  assert.ok(strip(rf).includes(MAROON_GATE)); assert.ok(strip(cg).includes(NEXT_SOON))
  assert.equal(rf.split(MAROON_GATE).length, 2, 'ANCHOR MISSING OR NOT UNIQUE: maroon'); assert.equal(cg.split(NEXT_SOON).length, 2, 'ANCHOR MISSING OR NOT UNIQUE: next')
  assert.equal(strip(rf.replace(MAROON_GATE, "!runner.isBusy() && Date.now() >= airPocketBreatheUntil")).includes(MAROON_GATE), false)
  assert.equal(strip(cg.replace(NEXT_SOON, 'this.#scheduleNext()')).includes(NEXT_SOON), false)
})
