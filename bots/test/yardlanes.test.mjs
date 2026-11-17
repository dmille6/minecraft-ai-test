// YARDLANES-01 (src/yard.mjs has the owner's words and the rules): one lane a kind, growing to a cap; more yards beside the first as
// ordinary projects; one lease a lane; the bag banks to the yard on any town visit; WELL_HOLD; `over_cap`. Behaviour first (the pure
// decisions over a real blueprint and a block world), the composed chains (bag -> lane -> cap -> well), anchored mutants, the wiring.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-yardlanes-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const Y = await import('../src/yard.mjs')
const W = await import('../src/well.mjs')
const S = await import('../src/shop.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const P = n => new URL(`../src/${n}.mjs`, import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} in ${path.pathname} (a mutant that was never written reads as killed)`)
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (path, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(path, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const one = (src, re, what) => assert.equal((src.match(new RegExp(re, 'g')) ?? []).length, 1, `${what}: expected exactly one executable line matching ${re}`)

// the REAL blueprint (yard@2: four bays of 2 x 22) and a block world over a sited record
const BP = JSON.parse(readFileSync(new URL('../src/blueprints/yard@2.json', import.meta.url), 'utf8'))
const REC = { anchor: [100, 200], orient: 'N', s: 70, blueprint: 'yard@2', cells: [{ at: [100, 70, 200] }, { at: [117, 70, 225] }] }
const ON = Y.laneSettings({ YARD: 'on' }), OFF = Y.laneSettings({ YARD: 'on', YARDLANES: 'off' })
const world = () => { const m = new Map(); const read = (x, y, z) => ({ name: m.get(`${x},${y},${z}`) ?? 'air' }); read.put = (at, name) => m.set(at.join(','), name); read.map = m; return read }
const fill = (read, slots, n, name) => { for (const s of slots.slice(0, n)) read.put(s, name) }
const lanes = (read, l = ON) => Y.laneBays(REC, BP, read, { lanes: l })
const states = (read, l = ON) => Y.bayStates(lanes(read, l), read, { kinds: Y.yardKinds(l.on) })

await t('SETTINGS: the lanes are the yard\'s (on where the yard is), YARDLANES=off alone switches them off; every number is a setting', () => {
  assert.equal(ON.on, true); assert.equal(OFF.on, false)
  assert.equal(Y.laneSettings({}).on, false, 'no yard in this pool: no lanes (the fleet, the suite)')
  assert.equal(Y.laneSettings({}, 'showcase').on, true, 'the showcase pool has the yard, so it has the lanes')
  assert.deepEqual({ start: ON.start, step: ON.step, modules: ON.modules, min: ON.min, builders: ON.builders, visitors: ON.visitors, visitMax: ON.visitMax }, { start: 8, step: 8, modules: 4, min: 16, builders: 3, visitors: 4, visitMax: 128 })
  assert.equal(Y.laneSettings({ YARD: 'on', YARD_LANE_PASS_MS: '60000' }).passMs, 60_000)
  assert.deepEqual({ ...ON.caps }, { cobblestone: 4, cobbled_deepslate: 4, '*': 2 })
  const s = Y.laneSettings({ YARD: 'on', YARD_LANE_START: '4', YARD_LANE_STEP: '2', YARD_MODULES: '6', YARD_LANE_CAPS: 'dirt:3,*:1', YARD_LANE_MIN: '8', YARD_LANE_BUILDERS: '5', YARD_LANE_VISITORS: '2', YARD_LANE_VISIT_MAX: '64' })
  assert.deepEqual({ start: s.start, step: s.step, modules: s.modules, min: s.min, builders: s.builders, visitors: s.visitors, visitMax: s.visitMax, caps: { ...s.caps } }, { start: 4, step: 2, modules: 6, min: 8, builders: 5, visitors: 2, visitMax: 64, caps: { dirt: 3, '*': 1 } })
  assert.equal(Y.laneSettings({ YARD: 'on', YARD_LANE_START: 'banana' }).start, 8, 'unreadable: the default')
  assert.equal(Y.laneCapOf('cobblestone', ON.caps), 4); assert.equal(Y.laneCapOf('gravel', ON.caps), 2)
  assert.deepEqual(Y.yardPlots(ON), ['yard', 'yard2', 'yard3', 'yard4']); assert.deepEqual(Y.yardPlots(OFF), ['yard'])
  assert.equal(Y.yardAfterOf('yard'), null); assert.equal(Y.yardAfterOf('yard3'), 'yard2')
  for (const k of ['deepslate', 'stone', 'dirt', 'gravel', 'sand', 'tuff', 'andesite', 'diorite', 'granite', 'spruce_log', 'cobblestone', 'cobbled_deepslate']) assert.ok(Y.LANE_KINDS.includes(k), k)
  assert.deepEqual(Y.yardKinds(false), Y.YARD_BULK)
})

await t('A LANE STARTS 8 ROWS LONG AND GROWS BY 8 TO ITS BAY, stepped to 4: 52 -> 116 -> 164 blocks; it grows only when its rows are full', () => {
  assert.equal(Y.laneCapacity(8), 52); assert.equal(Y.laneCapacity(16), 116); assert.equal(Y.laneCapacity(22), 164)
  assert.equal(Y.laneLen(0, 22), 8); assert.equal(Y.laneLen(51, 22), 8); assert.equal(Y.laneLen(52, 22), 16, 'full at 52: the next 8 rows')
  assert.equal(Y.laneLen(115, 22), 16); assert.equal(Y.laneLen(116, 22), 22); assert.equal(Y.laneLen(500, 22), 22, 'never past the bay (the hard cap)')
  assert.equal(Y.laneLen(0, 11), 8); assert.equal(Y.laneLen(52, 11), 11, 'yard@1\'s shorter bay')
  // PAPER PROOF 11-17 (defect B): a lane's length was fixed for the visit, so 64 sand became 52 + 12 in TWO lanes. A lane is now one
  // list in GROWTH ORDER: the 8-row ramp's 52 slots, then what 16 rows add (to 116), then the bay (164) -- it grows WITHIN a plan
  const read = world()
  const l0 = lanes(read)
  assert.deepEqual(l0.map(b => b.slots.length), [164, 164, 164, 164], 'every lane lists its whole bay, in growth order')
  const whole = Y.pileSlots(REC, BP)
  const ramp = len => Y.pileSlots(REC, BP, { lenOf: id => (id === 0 ? len : 22) })[0].slots.map(s => s.join(','))
  const key0 = l0[0].slots.map(s => s.join(','))
  assert.deepEqual(key0.slice(0, 52), ramp(8), 'first the 8-row ramp, exactly as it was placed before')
  assert.deepEqual([...key0.slice(0, 116)].sort(), [...ramp(16)].sort(), 'then what 16 rows add')
  assert.deepEqual([...key0].sort(), whole[0].slots.map(s => s.join(',')).sort(), 'then the bay: the same 164 slots, no more')
  // EVERY slot's support comes before it in the list (the floor, or a slot listed earlier): the growth never asks for a floating block
  const before = new Set()
  for (const sl of l0[0].slots) { assert.ok(sl[1] === 71 || before.has([sl[0], sl[1] - 1, sl[2]].join(',')), `support of ${sl}`); before.add(sl.join(',')) }
  // the exact cases: 64 sand is ONE lane (52 + 12 in the same lane); 128 cobblestone is ONE lane
  const st0 = Y.bayStates(l0, read, { kinds: Y.yardKinds(true) })
  const sand = Y.pileCells(st0, { sand: 64 }, { lanes: ON })
  assert.deepEqual([sand.lanes, sand.cells.length, sand.segs], [{ sand: [0] }, 64, ['pile0']])
  assert.deepEqual(sand.cells.map(c => c.at.join(',')), key0.slice(0, 64), 'in growth order: the ramp, then the next rows')
  const cob = Y.pileCells(st0, { cobblestone: 128 }, { lanes: ON })
  assert.deepEqual([cob.lanes, cob.cells.length], [{ cobblestone: [0] }, 128], 'one lane, not three')
  // three kinds of 64 take three lanes and leave the fourth for the next kind (Paper: three kinds used all four)
  const three = Y.pileCells(st0, { cobblestone: 64, gravel: 64, sand: 64 }, { lanes: ON })
  assert.deepEqual(three.lanes, { cobblestone: [0], gravel: [1], sand: [2] }); assert.deepEqual(three.segs.sort(), ['pile0', 'pile1', 'pile2'])
  assert.deepEqual(lanes(read, OFF).map(b => b.slots.length), [164, 164, 164, 164], 'YARDLANES=off: the whole bays, as before')
  assert.deepEqual(lanes(read, OFF)[0].slots, whole[0].slots, 'off: the old fill order exactly')
  assert.deepEqual(Y.pileCells(Y.bayStates(whole, read), { cobblestone: 10 }, { lanes: OFF }).cells[0].seg, 'pile', 'off: the one segment, as before')
})

await t('ONE LANE A KIND, the first empty lane the first time it is banked; a kind\'s second lane only when the first is full and under its cap', () => {
  const read = world()
  const pc = Y.pileCells(states(read), { gravel: 20, dirt: 30, cobblestone: 10 }, { lanes: ON })
  assert.deepEqual(pc.lanes, { cobblestone: [0], dirt: [1], gravel: [2] }, 'each kind its own lane (the kinds\' own order)')
  assert.equal(pc.cells.length, 60)
  for (const c of pc.cells) read.put(c.at, c.role.replace(/^pile_/, ''))
  const st = states(read)
  assert.deepEqual(st.map(s => [s.name, s.filled]), [['cobblestone', 10], ['dirt', 30], ['gravel', 20], [null, 0]])
  // gravel and sand: every slot planned stands on the floor or on its own kind (a falling block never placed over air)
  for (const c of pc.cells) { const below = read(c.at[0], c.at[1] - 1, c.at[2]).name; assert.ok(c.at[1] === 71 || below === c.role.replace(/^pile_/, ''), `${c.role} at ${c.at} over ${below}`) }
  // a kind with room in its lane never opens another; at its cap it opens none
  assert.deepEqual(Y.pileCells(st, { gravel: 10, sand: 5 }, { lanes: ON }).lanes, { gravel: [2], sand: [3] })
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: ON }), false, 'gravel has its lane and ONE lane is left: that one is a first lane\'s (first lanes before second ones)')
  assert.equal(Y.laneMayOpen(states(world()), 'gravel', { lanes: ON, others: { gravel: { lanes: 1, room: 0 } } }), false, 'two lanes over the yards: its cap')
  { const w2 = world(); fill(w2, lanes(w2)[0].slots, 164, 'gravel'); assert.equal(Y.laneMayOpen(states(w2), 'gravel', { lanes: ON }), true, 'its lane FULL, three lanes empty: a second may open') }
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: ON, others: { gravel: { lanes: 1, room: 0 } } }), false, 'two lanes over the yards: its cap')
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: ON, others: { gravel: { lanes: 1, room: 40 } } }), false, 'room in its lane in another yard: bank there, open nothing here')
  assert.equal(Y.laneMayOpen(states(world()), 'cobblestone', { lanes: ON, others: { cobblestone: { lanes: 2, room: 0 } } }), true, 'cobblestone may hold four')
  assert.equal(Y.laneMayOpen(states(world()), 'andesite', { lanes: ON }), true, 'a kind with no lane takes any empty one, the last too')
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: OFF, others: { gravel: { lanes: 9, room: 0 } } }), true, 'off: the old yard has no caps')
})

await t('ROOM AND THE CAP: a kind\'s room is its lanes\' and the lanes it may still open; FULL at the cap is over_cap; a lane another bot holds is skipped', () => {
  const read = world()
  const st0 = states(read)
  assert.equal(Y.yardRoomFor(st0, 'gravel', { lanes: ON }), 328, 'two lanes of 164')
  assert.equal(Y.yardRoomFor(st0, 'cobblestone', { lanes: ON }), 656, 'four')
  assert.equal(Y.yardRoomFor(st0, 'gravel', { lanes: ON, others: { gravel: { lanes: 2, room: 0 } } }), 0, 'at its cap elsewhere: none here')
  assert.equal(Y.yardRoomFor(states(read, OFF), 'cobblestone', { lanes: OFF }), 656, 'off: every empty bay, whole, as before')
  assert.equal(Y.kindOverCap('gravel', { lanes: ON, held: { lanes: 2, room: 0 }, empty: 3 }), true)
  assert.equal(Y.kindOverCap('gravel', { lanes: ON, held: { lanes: 2, room: 5 }, empty: 0 }), false, 'room left: not full')
  assert.equal(Y.kindOverCap('gravel', { lanes: ON, held: { lanes: 1, room: 0 }, empty: 1 }), false, 'a lane to open: not full')
  assert.equal(Y.kindOverCap('gravel', { lanes: ON, held: { lanes: 1, room: 0 }, empty: 0 }), true, 'no lane left anywhere: full')
  assert.equal(Y.kindOverCap('gravel', { lanes: ON, held: { lanes: 0, room: 0 }, empty: 0 }), false, 'a kind with NO home yet is not "over its cap": today\'s behaviour')
  assert.equal(Y.kindOverCap('wheat_seeds', { lanes: ON, held: { lanes: 9, room: 0 }, empty: 0 }), false, 'not a lane kind')
  assert.equal(Y.kindOverCap('gravel', { lanes: OFF, held: { lanes: 2, room: 0 }, empty: 0 }), false)
  // leases: with lane 0 another bot's, cobblestone takes the next empty lane; with every lane held nothing is planned
  assert.deepEqual(Y.pileCells(st0, { cobblestone: 10 }, { lanes: ON, skip: new Set([0]) }).lanes, { cobblestone: [1] })
  assert.equal(Y.pileCells(st0, { cobblestone: 10 }, { lanes: ON, skip: new Set([0, 1, 2, 3]) }).cells.length, 0)
  assert.deepEqual(Y.lanesElsewhere([[{ name: 'dirt', free: 5 }, { name: null, free: 52 }], [{ name: 'dirt', free: 0 }]]), { dirt: { lanes: 2, room: 5 } })
  assert.match(Y.overCapDetail({ name: 'gravel', n: 64, lanes: 2, cap: 2 }), /^kind=gravel n=64 lanes=2\/2 to=well why=over_cap$/)
})

await t('THE BAG BANKS ON ANY TOWN VISIT: every lane kind above its keep; 16 is enough (was a whole stack or a pressed bag); the old yard unchanged', () => {
  const held = { cobblestone: 119, cobbled_deepslate: 69, dirt: 26, gravel: 15, andesite: 9, wheat_seeds: 60, spruce_log: 20 }
  const keeps = { cobblestone: 64, dirt: 16, spruce_log: 16 }
  assert.deepEqual(Y.bagSurplus(held, { lanes: ON, keeps }), { cobblestone: 55, cobbled_deepslate: 69, dirt: 10, gravel: 15, andesite: 9, spruce_log: 4 }, 'LIVE averages: seeds are no lane kind')
  assert.deepEqual(Y.bagSurplus(held, { lanes: OFF }), { cobbled_deepslate: 60 }, 'off: the cobble family above 128, as before')
  assert.deepEqual(Y.bagSurplus({ cobblestone: 119 }, { lanes: ON }), { cobblestone: 55 }, 'no keeps given: cobblestone 64')
  const read = world()
  const w = Y.yardWork({ held, slots: 20, freeSlots: 16, states: states(read), lanes: ON, keeps })
  assert.equal(w.kind, 'stock'); assert.equal(w.urgent, true, '(a) a stock is the bot\'s first work at town whatever its project')
  assert.equal(Y.yardWork({ held: { cobblestone: 400 }, slots: 20, freeSlots: 16, states: states(read, OFF), lanes: OFF }).urgent, false, 'off: only a pressed bag goes first, as before')
  assert.equal(ON.passMs, 150_000)
  assert.deepEqual(w.place, { cobblestone: 55, cobbled_deepslate: 69, dirt: 4 }, 'in the kinds\' order, 128 a visit')
  assert.equal(Y.yardWork({ held: { gravel: 15 }, slots: 20, states: states(read), lanes: ON, keeps: {} }).kind, null, 'under 16 and not pressed: no trip')
  assert.equal(Y.yardWork({ held: { gravel: 16 }, slots: 20, states: states(read), lanes: ON, keeps: {} }).kind, 'stock')
  assert.equal(Y.yardWork({ held: { gravel: 3 }, slots: 31, states: states(read), lanes: ON, keeps: {} }).kind, 'stock', 'a pressed bag banks any surplus (the partial-slot rule\'s exit)')
  assert.equal(Y.yardWork({ held: { cobblestone: 180 }, slots: 20, states: states(read, OFF), lanes: OFF }).kind, null, 'off: 52 above 128 is no whole stack')
  // a later yard never runs the clerk or the refill (the town's chests against the FIRST yard's cobblestone pile)
  const town = { cobblestone: 900 }
  assert.equal(Y.yardWork({ held: {}, slots: 5, freeSlots: 31, town, states: states(read), lanes: ON, keeps: {}, first: true }).kind, 'clerk')
  assert.equal(Y.yardWork({ held: {}, slots: 5, freeSlots: 31, town, states: states(read), lanes: ON, keeps: {}, first: false }).kind, null)
})

await t('THE CHAIN bag -> lane -> cap -> well: a kind with room is HELD off the well for as long as it has room; full at its cap the well takes it again; a jammed bag banks again soon', () => {
  // Codex r1 BLOCKER 1: the hold is the ROOM and nothing else -- no back-off, no lapse (both sent a kind with room down the well)
  assert.deepEqual(Y.wellHold({ room: 40 }), { hold: true })
  assert.deepEqual(Y.wellHold({ room: 40, holdAt: 0, stockAt: null, now: 9e15 }), { hold: true }, 'however long ago the bag was first held: room is room')
  assert.equal(Y.wellHold({ room: 0 }).hold, false, 'FULL at its cap, or no yard standing: only then the well')
  assert.equal(Y.wellHold({ on: false, room: 40 }).hold, false)
  // a bag that jams with room in the yard is the BANK step's: it comes back in 2 minutes (20 for a bag under no pressure, and the old yard)
  assert.equal(Y.yardRestMs({ lanes: ON, slots: 34 }), 2 * 60_000); assert.equal(Y.yardRestMs({ lanes: ON, slots: 30 }), 2 * 60_000)
  assert.equal(Y.yardRestMs({ lanes: ON, slots: 12 }), Y.YARD_REST_MS); assert.equal(Y.yardRestMs({ lanes: OFF, slots: 36 }), Y.YARD_REST_MS)
  assert.equal(Y.wellHoldOn({}), true); assert.equal(Y.wellHoldOn({ WELL_HOLD: 'off' }), false)
  // through the well's real plan: andesite + diorite on the junk list, 200 cobblestone at the proven chest cap
  const bag = [{ name: 'andesite', count: 40, slot: 9 }, { name: 'diorite', count: 30, slot: 10 }, { name: 'egg', count: 12, slot: 11 }, { name: 'cobblestone', count: 64, slot: 12 }, { name: 'cobblestone', count: 64, slot: 13 }, { name: 'cobblestone', count: 64, slot: 14 }]
  const names = p => p.stacks.map(s => s.name).sort()
  try {
    assert.deepEqual(names(W.disposePlan(bag, { cobbleAtCap: true })), ['andesite', 'cobblestone', 'cobblestone', 'diorite', 'egg'], 'positive control: with no hold the well takes them')
    W.setYardHold(n => ['andesite', 'diorite', 'cobblestone'].includes(n))
    assert.deepEqual(names(W.disposePlan(bag, { cobbleAtCap: true })), ['egg'], 'held for the yard: only true junk goes')
    W.setYardHold(n => n === 'andesite')   // diorite and cobblestone FULL at their caps
    assert.deepEqual(names(W.disposePlan(bag, { cobbleAtCap: true })), ['cobblestone', 'cobblestone', 'diorite', 'egg'], 'over_cap: the well takes that kind again')
    W.setYardHold(() => { throw new Error('boom') })
    assert.equal(W.disposePlan(bag, { cobbleAtCap: true }).stacks.length, 5, 'a hold that throws holds nothing')
    // the owner's cobblestone rule: the yard full, the well takes cobble above the bag's 64 WITHOUT the chest cap proven
    W.setYardHold(null)
    assert.deepEqual(names(W.disposePlan(bag)).filter(n => n === 'cobblestone'), [], 'positive control: no cap proven, no cobble')
    W.setYardFull(n => n === 'cobblestone')
    assert.deepEqual(names(W.disposePlan(bag)).filter(n => n === 'cobblestone'), ['cobblestone', 'cobblestone'], '64 stay')
  } finally { W.setYardHold(null); W.setYardFull(null) }
})

await t('MORE YARDS ARE ORDINARY PROJECTS: yard2..yard4 on the list, each after the one before, three builders; on only with the lanes; a full bag is their reason too', () => {
  const ps = S.PROJECTS.filter(p => Y.isYardPlot(p.plot))
  assert.deepEqual(ps.map(p => [p.plot, p.after ?? null, p.builders]), [['yard', null, 1], ['yard2', 'yard', 3], ['yard3', 'yard2', 3], ['yard4', 'yard3', 3], ['yard5', 'yard4', 3], ['yard6', 'yard5', 3]])
  assert.equal(S.turnOwnNeed('yard3'), true); assert.equal(S.turnOwnNeed('tidy'), false)
  // the suite's pool has no yard: none of them is on (positive control: the list holds them)
  assert.equal(S.projectsOn().some(p => Y.isYardPlot(p.plot)), false)
  assert.equal(S.PROJECTS.at(-1).plot, 'tidy', 'the tidy stays the list\'s last (the order\'s fallback)')
  // siting: a later yard is ranked nearest the FIRST yard's pad
  const first = { cells: [{ at: [100, 70, 200] }, { at: [118, 70, 226] }] }
  const pad = (x, z) => [[x, z], [x + 17, z + 25]]
  assert.equal(Y.nearYardRank(first, pad(100, 200)), 0)
  assert.ok(Y.nearYardRank(first, pad(120, 200)) < Y.nearYardRank(first, pad(180, 200)))
  assert.equal(Y.nearYardRank(null, pad(0, 0)), 0, 'no first yard: the yard\'s own ranking decides')
})

await t('MUTANTS KILLED: a lane that never grows; a lane past its bay; the cap ignored; another yard\'s room ignored; a held lane taken; a hold with no room; the jam resting long; the hold ignored', async () => {
  const YP = P('yard'), WP = P('well')
  await killedBy(YP, Y, 'if (laneCapacity(len, { w, h }) > held) return len', 'if (true) return len', M => assert.equal(M.laneLen(52, 22), 16))
  await killedBy(YP, Y, '  return f\n}\n/** THE RANK OF A SITE', '  return f + 8\n}\n/** THE RANK OF A SITE', M => assert.equal(M.laneLen(500, 22), 22))
  const st = () => states(world())
  await killedBy(YP, Y, '  if (!(mine < laneCapOf(name, lanes.caps))) return false\n', '', M => assert.equal(M.laneMayOpen(st(), 'gravel', { lanes: ON, others: { gravel: { lanes: 2, room: 0 } } }), false))
  await killedBy(YP, Y, '  if (o.room > 0) return false\n', '', M => assert.equal(M.laneMayOpen(st(), 'gravel', { lanes: ON, others: { gravel: { lanes: 1, room: 40 } } }), false))
  await killedBy(YP, Y, '  const mine = s => !(skip?.has?.(s.id))', '  const mine = () => true', M => assert.deepEqual(M.pileCells(st(), { cobblestone: 10 }, { lanes: ON, skip: new Set([0]) }).lanes, { cobblestone: [1] }))
  await killedBy(YP, Y, '  return { hold: !!on && Number(room) > 0 }', '  return { hold: !!on }', M => assert.equal(M.wellHold({ room: 0 }).hold, false))
  await killedBy(YP, Y, 'export const yardRestMs = ({ lanes = LANES, slots = 0 } = {}) => (lanes?.on && Number(slots) >= YARD_URGENT_SLOTS ? YARD_JAM_REST_MS : YARD_REST_MS)', 'export const yardRestMs = () => YARD_REST_MS', M => assert.equal(M.yardRestMs({ lanes: ON, slots: 34 }), 2 * 60_000))
  await killedBy(YP, Y, "return { kind: 'stock', urgent: pressed || !!lanes?.on, place,", "return { kind: 'stock', urgent: pressed, place,", M => assert.equal(M.yardWork({ held: { gravel: 16 }, slots: 20, states: st(), lanes: ON, keeps: {} }).urgent, true))
  await killedBy(YP, Y, '  const stockMin = lanes?.on ? (clear ? 1 : Math.min(YARD_STOCK_MIN, lanes.min)) : YARD_STOCK_MIN', '  const stockMin = YARD_STOCK_MIN', M => assert.equal(M.yardWork({ held: { gravel: 16 }, slots: 20, states: st(), lanes: ON, keeps: {} }).kind, 'stock'))
  const bag = [{ name: 'andesite', count: 40, slot: 9 }, { name: 'egg', count: 12, slot: 11 }, { name: 'cobblestone', count: 64, slot: 12 }, { name: 'cobblestone', count: 64, slot: 13 }]
  await killedBy(WP, W, ').filter(it => !yardHolds(it.name))', ')', M => { try { M.setYardHold(n => n === 'andesite'); assert.deepEqual(M.disposePlan(bag).stacks.map(s => s.name), ['egg']) } finally { M.setYardHold(null) } })
  await killedBy(WP, W, "(cobbleAtCap || yardFull('cobblestone')) ?", 'cobbleAtCap ?', M => { try { M.setYardFull(() => true); assert.equal(M.disposePlan(bag).stacks.filter(s => s.name === 'cobblestone').length, 1) } finally { M.setYardFull(null) } })
})

await t('WIRED: every yard is the yard\'s (order, siting, visit); the lanes\' leases; the hold and the full word installed; the over_cap row; the licence row', () => {
  const sk = strip(readFileSync(P('skills'), 'utf8')), sh = strip(readFileSync(P('shop'), 'utf8')), ft = strip(readFileSync(P('features'), 'utf8'))
  one(sh, 'isYardPlot\\(p\\.plot\\) \\? yard && yardOffered\\(p\\.plot\\)', 'projectsOn')
  one(sh, 'if \\(!isYardPlot\\(plot\\) && freeSlots < need\\) \\{', 'a full bag is a yard visit\'s reason, never its refusal')
  one(sk, 'const yw = complete && b && isYardPlot\\(p\\.plot\\) \\? yardWorkNow\\(b, rec, now, p\\.plot\\) : null', 'the order reads every yard\'s work')
  one(sk, 'const ss = await yardSiteFor\\(bot, \\{ \\.\\.\\.h\\.head\\.plan, gen: h\\.head\\.gen \\}, c, stood, signal, plot\\)', 'a later yard is sited by the yard\'s siting')
  one(sk, 'rankKey: firstRec \\? site => nearYardRank\\(firstRec, site\\.pad\\) \\* 100 \\+ step\\.rankKey\\(site\\) : step\\.rankKey', 'nearest the first yard')
  one(sk, 'return yardVisit\\(ctx, rec, rh\\.head\\.gen, signal, out, t0, \\{ plot, \\.\\.\\.\\(LANES\\.on \\? \\{ until: t0 \\+ LANES\\.passMs \\} : \\{\\}\\) \\}\\)', 'a complete yard gets the yard\'s visit, bounded')
  one(sk, 'const slot = takeSlot\\(dir, key, me, LANES\\.on && !\\(Number\\(draw\\) > 0\\) \\? LANES\\.visitors : YARD_BUILDERS\\)', 'several visitors')
  one(sk, 'const laneLease = id => \\{ try \\{ const l = projLeaseState\\(dir, key, `seg-pile\\$\\{id\\}`\\); return !\\(l && l\\.rec\\?\\.holder && l\\.rec\\.holder !== me && Date\\.now\\(\\) < \\(l\\.holdsUntil \\?\\? 0\\)\\)', 'the lane\'s lease is the runner\'s segment lease: the plan asks who holds it')
  assert.equal((sk.match(/segments: pc\.segments \}/g) ?? []).length, 2, 'both stocking paths hand the runner one segment a lane')
  one(sk, "const laneHeld = LANES\\.on && \\(w\\.kind === 'stock' \\|\\| w\\.kind === 'clerk'\\) && \\(lanesBusy\\.length > 0 \\|\\| r\\?\\.stop === 'unknown'\\)", 'a zero-block visit behind a held lane is not an empty visit')
  one(sk, "stop = held \\? 'lane_held' : \\(w\\.noLane\\?\\.length \\? 'no_lane' : 'yard_full'\\)", 'the stop names the reason')
  one(sk, 'if \\(LANES\\.on && w\\.noLane\\?\\.length\\) yardNoLaneNote\\(bot, plot, w\\.noLane, now\\)', 'no lane anywhere stamps the town\'s want')
  one(sk, 'if \\(LANES\\.on\\) setYardsWanted\\(\\(\\) => yardsWantedNow\\(activeMem\\?\\.bot \\?\\? null\\)\\)', 'the order reads how many yards are wanted')
  // Codex r1 BLOCKER 6: EVERY path that places on the piles takes its lanes' leases (the upkeep's clear-then-stock had none)
  assert.equal((sk.match(/const \{ pc, busy \} = leasedPileCells\(states, (place|w2\.place), laneOpts, laneLease\)/g) ?? []).length, 2, 'the stock and the upkeep-then-stock paths')
  assert.equal((sk.match(/[^a-zA-Z]pileCells\(/g) ?? []).length, 0, 'no bare pileCells call is left in skills.mjs')
  // Codex r1 BLOCKER 1: the hold reads no back-off and no clock
  const hold = sk.slice(sk.indexOf('function yardHoldNow ('), sk.indexOf('export function yardLanesInstall'))
  assert.ok(hold.length > 100 && !/yardRestUntil|yardHoldAt|stockAt/.test(hold), 'yardHoldNow reads the room alone')
  one(sk, 'return wellHold\\(\\{ room: k\\.room \\}\\)\\.hold', 'the hold is the room')
  assert.equal((sk.match(/yardRestUntil = Date\.now\(\) \+ yardRestMs\(\{ slots: slotsNow\(\) \}\)/g) ?? []).length, 3, 'a visit that banked nothing rests by the bag\'s pressure')
  one(sk, 'if \\(LANES\\.on && wellHoldOn\\(\\)\\) \\{ setYardHold\\(yardHoldNow\\); setYardFull\\(', 'WELL_HOLD installed')
  one(sk, "dispose_well: \\{ run: \\(ctx, a, signal\\) => withOverCap\\(ctx, \\(\\) => disposeWell\\(ctx, a, signal\\)\\)", 'the over_cap row wraps the well')
  one(sk, "if \\(k\\.over\\) logEvent\\(\\{ kind: 'yard_over_cap'", 'only a kind FULL at its cap is logged over_cap')
  one(sk, "logEvent\\(\\{ kind: 'yard_lanes', status: 'success'", 'the licence row')
  one(sk, 'try \\{ yardLanesInstall\\(bot\\) \\} catch', 'installed at spawn (inside bagRoomInstall)')
  one(ft, 'try \\{ bagRoomInstall\\(bot\\) \\}', 'which features.mjs calls once per spawn')
})

// ---- YARDROW-01 (b): the chest row for what is not a block ---------------------------------------------------------------------------
console.log('(b) THE CHEST ROW')
const TDm = await import('../src/towndeposit.mjs')
const key = at => at.join(',')
const CELLS = Y.rowCells(REC, BP)
const cellsNow = (over = {}) => CELLS.map(at => ({ at, name: over[key(at)] ?? 'air' }))
await t('the row: seeds, cane, sticks, saplings (one chest for every species), nuggets, clay balls, snowballs; the kit\'s keeps; its settings', () => {
  assert.deepEqual([...Y.ROW_KINDS], ['wheat_seeds', 'sugar_cane', 'stick', 'sapling', 'iron_nugget', 'clay_ball', 'snowball'])
  assert.equal(Y.rowKindOf('spruce_sapling'), 'sapling'); assert.equal(Y.rowKindOf('mangrove_propagule'), 'sapling'); assert.equal(Y.rowKindOf('wheat_seeds'), 'wheat_seeds')
  assert.equal(Y.rowKindOf('cobblestone'), null, 'a block is a lane\'s'); assert.equal(Y.rowKindOf(null), null)
  assert.deepEqual(['wheat_seeds', 'sugar_cane', 'stick', 'oak_sapling', 'iron_nugget', 'clay_ball'].map(Y.rowKeepOf), [16, 16, 8, 4, 0, 0])
  assert.deepEqual([ON.row, ON.rowCap, ON.rowMin], [true, 2, 8])
  assert.equal(Y.laneSettings({ YARD: 'on', YARD_ROW: 'off' }).row, false)
  assert.deepEqual([Y.laneSettings({ YARD: 'on', YARD_ROW_CAP: '3', YARD_ROW_MIN: '4' }).rowCap, Y.laneSettings({ YARD: 'on', YARD_ROW_CAP: '3', YARD_ROW_MIN: '4' }).rowMin], [3, 4])
})
await t('the cells: the rear floor row, one above the floor, every OTHER cell (two chests side by side would join), never a light\'s', () => {
  assert.ok(CELLS.length >= 6, `${CELLS.length} cells`)
  assert.ok(CELLS.every(c => c[1] === REC.s + 1))
  for (let i = 1; i < CELLS.length; i++) assert.ok(Math.abs(CELLS[i][0] - CELLS[i - 1][0]) + Math.abs(CELLS[i][2] - CELLS[i - 1][2]) >= 2, 'no two cells touch')
  const lightU = new Set(BP.cells.filter(c => c.v === BP.footprint.v - 1 && c.y >= 1).map(c => c.u))
  assert.ok(lightU.size >= 1, 'positive control: the rear row has a light')
  assert.equal(CELLS.length, [...Array(BP.footprint.u).keys()].filter(u => u >= 1 && u < BP.footprint.u - 1 && u % 2 === 1 && !lightU.has(u)).length)
  // none is a pile slot or a floor cell of the blueprint
  const piles = new Set(Y.pileSlots(REC, BP).flatMap(b => b.slots.map(key)))
  assert.ok(CELLS.every(c => !piles.has(key(c))))
  assert.deepEqual(Y.rowCells(null, BP), [])
})
const P0 = { held: { wheat_seeds: 60, clay_ball: 20 }, keeps: {}, rows: [], cells: cellsNow(), carried: 13, lanes: ON }
await t('THE CHAIN: a kind\'s first chest is PLACED from the carried chests and banked into; then its chest is the target; full -> a second under the cap; at the cap, nothing', () => {
  const p = Y.rowPlan(P0)
  assert.deepEqual(p.place, { kind: 'wheat_seeds', at: CELLS[0] }, 'one placement a visit, the first free cell, the kinds\' own order')
  assert.deepEqual(p.bank, [{ kind: 'wheat_seeds', at: CELLS[0], names: { wheat_seeds: 44 } }], 'clay waits for the next visit\'s placement')
  // the chest stands and is recorded: clay gets the NEXT cell, seeds go to theirs
  const rows1 = Y.rowAssign([], CELLS[0], 'wheat_seeds', { plot: 'yard', by: 'A', now: 1 })
  const p2 = Y.rowPlan({ ...P0, rows: rows1, cells: cellsNow({ [key(CELLS[0])]: 'chest' }) })
  assert.deepEqual(p2.place, { kind: 'clay_ball', at: CELLS[1] })
  assert.deepEqual(p2.bank.map(b => [b.kind, key(b.at)]), [['wheat_seeds', key(CELLS[0])], ['clay_ball', key(CELLS[1])]])
  // a bag with ONE chest keeps it (the full-town recovery's): nothing is placed -- and with none recorded nothing is banked
  assert.deepEqual(Y.rowPlan({ ...P0, carried: 1 }), { bank: [], place: null, why: 'idle' })
  // its chest full: a second, under the cap; both full at the cap: nothing more of the kind
  const full1 = new Set([key(CELLS[0])])
  const p3 = Y.rowPlan({ ...P0, held: { wheat_seeds: 60 }, rows: rows1, cells: cellsNow({ [key(CELLS[0])]: 'chest' }), full: full1 })
  assert.deepEqual(p3.place, { kind: 'wheat_seeds', at: CELLS[1] })
  const rows2 = Y.rowAssign(rows1, CELLS[1], 'wheat_seeds')
  assert.deepEqual(Y.rowPlan({ ...P0, held: { wheat_seeds: 60 }, rows: rows2, cells: cellsNow({ [key(CELLS[0])]: 'chest', [key(CELLS[1])]: 'chest' }), full: new Set([key(CELLS[0]), key(CELLS[1])]) }), { bank: [], place: null, why: 'idle' })
  // a recorded chest that is GONE from the world is no target: the kind is given a chest again
  const p4 = Y.rowPlan({ ...P0, held: { wheat_seeds: 60 }, rows: rows1, cells: cellsNow() })
  assert.equal(p4.place?.kind, 'wheat_seeds'); assert.notDeepEqual(p4.place.at, CELLS[0], 'never the recorded cell (the record is pruned at the visit)')
  // under the minimum and not pressed: no trip; pressed (30+ slots): any surplus goes (the partial-slot rule's exit)
  assert.equal(Y.rowPlan({ ...P0, held: { wheat_seeds: 20 } }).bank.length, 0, '4 above the keep')
  assert.equal(Y.rowPlan({ ...P0, held: { wheat_seeds: 20 }, pressed: true }).bank.length, 1)
  assert.equal(Y.rowPlan({ ...P0, held: { wheat_seeds: 12 }, keeps: { wheat_seeds: 0 }, pressed: true }).bank[0].names.wheat_seeds, 12, 'the caller\'s keep (the partial-slot rule lowered it)')
  assert.equal(Y.rowPlan({ ...P0, lanes: Y.laneSettings({ YARD: 'on', YARD_ROW: 'off' }) }).why, 'off')
  assert.equal(Y.rowPlan({ ...P0, lanes: OFF }).why, 'off')
})
await t('the steps: whole stacks while the keep stays, then HALVES (60 seeds with 16 kept: 30 go; 64 + 20: the 20, then 32); saplings keep 4 a species', () => {
  const b = (...xs) => xs.map(([name, count], i) => ({ name, count, slot: 9 + i }))
  assert.deepEqual(Y.rowSteps(b(['wheat_seeds', 60]), { wheat_seeds: 44 }, {}, TDm.logHalfSteps), [{ slot: 9, count: 30, from: 60, half: true, name: 'wheat_seeds' }])
  assert.deepEqual(Y.rowSteps(b(['wheat_seeds', 64], ['wheat_seeds', 20]), { wheat_seeds: 68 }, {}, TDm.logHalfSteps).map(s => [s.slot, s.count, !!s.half]), [[10, 20, false], [9, 32, true], [9, 16, true]])
  assert.deepEqual(Y.rowSteps(b(['spruce_sapling', 10], ['oak_sapling', 3]), { spruce_sapling: 6 }, {}, TDm.logHalfSteps).map(s => [s.name, s.count]), [['spruce_sapling', 5]], '10 -> 5 banked, 5 kept (never under 4)')
  assert.deepEqual(Y.rowSteps(b(['clay_ball', 20]), { clay_ball: 20 }, {}, TDm.logHalfSteps), [{ slot: 9, name: 'clay_ball', count: 20 }], 'no keep: the whole stack')
  assert.deepEqual(Y.rowSteps(b(['wheat_seeds', 12]), { wheat_seeds: 12 }, { wheat_seeds: 0 }, TDm.logHalfSteps).length, 1)
  const rows = Y.rowAssign([], [1, 2, 3], 'stick')
  assert.equal(Y.rowAssign(rows, [1, 2, 3], 'clay_ball'), rows, 'a cell is one kind\'s for good')
  assert.deepEqual(Y.rowPrune(rows, new Set(['1,2,3'])), [])
})
await t('MUTANTS KILLED (b): chests side by side; the last carried chest placed; the cap ignored; a full chest banked into; a gone chest trusted; the keep halved away', async () => {
  const YP = P('yard')
  const apart = M => { const c = M.rowCells(REC, BP); for (let i = 1; i < c.length; i++) assert.ok(Math.abs(c[i][0] - c[i - 1][0]) + Math.abs(c[i][2] - c[i - 1][2]) >= 2) }
  await killedBy(YP, Y, '  for (let u = 1; u < bp.footprint.u - 1; u += 2) {', '  for (let u = 1; u < bp.footprint.u - 1; u += 1) {', apart)
  await killedBy(YP, Y, '    if (place || mine.length >= lanes.rowCap || !(carried >= 2)) continue', '    if (place || mine.length >= lanes.rowCap || !(carried >= 1)) continue', M => assert.equal(M.rowPlan({ ...P0, carried: 1 }).place, null))
  const rows2 = Y.rowAssign(Y.rowAssign([], CELLS[0], 'wheat_seeds'), CELLS[1], 'wheat_seeds')
  const bothFull = { ...P0, held: { wheat_seeds: 60 }, rows: rows2, cells: cellsNow({ [key(CELLS[0])]: 'chest', [key(CELLS[1])]: 'chest' }), full: new Set([key(CELLS[0]), key(CELLS[1])]) }
  await killedBy(YP, Y, '    if (place || mine.length >= lanes.rowCap || !(carried >= 2)) continue', '    if (place || !(carried >= 2)) continue', M => assert.equal(M.rowPlan(bothFull).place, null))
  await killedBy(YP, Y, '    const target = mine.find(r => !full.has(key(r.at)))', '    const target = mine[0]', M => assert.equal(M.rowPlan(bothFull).bank.length, 0))
  await killedBy(YP, Y, "  const stands = r => { const c = here.get(key(r.at)); return !c || c.name == null || IS_BOX.test(c.name) }", '  const stands = () => true',
    M => assert.notDeepEqual(M.rowPlan({ ...P0, held: { wheat_seeds: 60 }, rows: Y.rowAssign([], CELLS[0], 'wheat_seeds'), cells: cellsNow() }).bank[0].at, CELLS[0]))
  await killedBy(YP, Y, "    let room = total - Math.max(0, Number(keeps?.[name] ?? rowKeepOf(name)) || 0)\n    const left = []", '    let room = total\n    const left = []',
    M => assert.deepEqual(M.rowSteps([{ name: 'wheat_seeds', count: 60, slot: 9 }], { wheat_seeds: 44 }, {}, TDm.logHalfSteps).map(s => s.count), [30]))
})
await t('WIRED (b): a row chest is a town container but never a general deposit\'s; placed under the lease and recorded only once it STANDS; banked by the deposit\'s own body', () => {
  const sk = strip(readFileSync(P('skills'), 'utf8'))
  one(sk, 'if \\(rowKeys\\.has\\(posKey\\(p\\)\\)\\) continue', 'townContainers skips the row')
  one(sk, 'if \\(LANES\\.on && LANES\\.row\\) setTownExtra\\(homeVec\\(\\), \\[\\.\\.\\.townExtraKeys\\(homeVec\\(\\)\\), \\.\\.\\.yardRowKeys\\(activeMem\\?\\.bot \\?\\? null\\)\\]\\)', 'registered with the town\'s containers')
  // Codex r1 BLOCKER 4: ONE pool-wide row lock (the first yard's key, whichever yard the bot is at) over the plan, the placement, the
  // assignment and the prune -- and the plan is made again inside it
  one(sk, "const rowLock = poolLock\\('row'\\)", 'the row\'s lock is the pool\'s')
  one(sk, "lock: \\(\\) => \\{ const l = projTakeLease\\(townDir\\(\\), projKeyOf\\(YARD_PLOT\\), name,", 'one key for every yard')
  const rs = sk.slice(sk.indexOf('async function yardRowStep ('), sk.indexOf('const recorded = new Set(yardRowsNow(bot)'))
  const iLock = rs.indexOf('const tok = rowLock.lock()'), iFresh = rs.indexOf('yardRowsNow(bot, Date.now(), { fresh: true })'), iPlan = rs.lastIndexOf('plan = yardRowPlanNow(bot, rec, bp)')
  assert.ok(rs.indexOf('let plan = yardRowPlanNow(bot, rec, bp)') >= 0 && rs.indexOf('let plan = yardRowPlanNow(bot, rec, bp)') < iLock && iLock < iFresh && iFresh < iPlan, 'planned again under the lock, on the fresh record')
  assert.ok(rs.lastIndexOf('plan = yardRowPlanNow(bot, rec, bp)') < rs.indexOf('await place(ctx, { item: \'chest\'') && rs.indexOf('yardRowsWrite(bot, rowAssign(') < rs.indexOf('rowLock.unlock(tok)'), 'placed and assigned before the lock is given back')
  one(sk, "if \\(!tok\\) plan = \\{ \\.\\.\\.plan, place: null \\}", 'no lock: nothing is placed')
  one(sk, "const tok = rowLock\\.lock\\(\\)\\n      if \\(tok\\) \\{ try \\{ yardRowsWrite\\(bot, rowPrune\\(", 'the prune too')
  one(sk, "if \\(stands\\) \\{ yardRowsWrite\\(bot, rowAssign\\(rows, at, plan\\.place\\.kind, \\{ plot, by: me \\}\\)\\); out\\.placed\\+\\+", 'the record follows the world')
  one(sk, "const p = await sortPut\\(bot, block, b\\.names, deadline, signal, keeps, bag => rowSteps\\(bag, b\\.names, keeps, logHalfSteps\\), 'yard_row'\\)", 'the bank')
  one(sk, "if \\(typeof stepsOf === 'function'\\) return stepsOf\\(bag\\)", 'sortPut takes the row\'s steps')
  one(sk, "if \\(rp\\.bank\\.length\\) return \\{ kind: 'row', urgent: true,", 'the order reads the row\'s work')
  one(sk, 'const k = rk \\? \\{ room: yardRowRoomNow\\(bot, rk, now\\) \\} : yardKindNow\\(bot, name, now\\)', 'WELL_HOLD covers a row kind with room')
})

// ---- BAGCLEAR_UNTIL (f): the bots-only one-time clear ---------------------------------------------------------------------------------
console.log('(f) THE ONE-TIME CLEAR')
const BFx = await import('../src/bagfix.mjs')
const BRx = await import('../src/bagroom.mjs')
await t('BAGCLEAR_UNTIL: unset is off; while it lasts a visit banks ANY surplus, up to 640, and the clerk moves every lane kind out of the chests down to the build reserve', () => {
  const until = Date.parse('2026-11-18T00:00:00Z')
  assert.equal(BFx.clearActive(BFx.bagfixSwitches({}), until - 1), false, 'unset: off')
  assert.equal(BFx.clearActive(BFx.bagfixSwitches({ BAGCLEAR_UNTIL: '2026-11-18T00:00:00Z' }), until - 1), true)
  assert.equal(BFx.clearActive(BFx.bagfixSwitches({ BAGCLEAR_UNTIL: '2026-11-18T00:00:00Z' }), until), false, 'it ends at its date')
  const read = world()
  const st = states(read)
  // the bag: 3 gravel is a stock under the clear (positive control: without it, no trip)
  assert.equal(Y.yardWork({ held: { gravel: 3 }, slots: 10, states: st, lanes: ON, keeps: {} }).kind, null)
  assert.equal(Y.yardWork({ held: { gravel: 3 }, slots: 10, states: st, lanes: ON, keeps: {}, clear: true }).kind, 'stock')
  // the per-visit limit is lifted: 500 cobblestone, all of it (128 without)
  assert.equal(Y.yardWork({ held: { cobblestone: 500 }, slots: 10, states: st, lanes: ON, keeps: {} }).place.cobblestone, 128)
  assert.equal(Y.yardWork({ held: { cobblestone: 500 }, slots: 10, states: st, lanes: ON, keeps: {}, clear: true }).place.cobblestone, 500)
  assert.equal(Y.CLEAR_VISIT_MAX, 640)
  // the chests: LIVE 11-16 cobbled_deepslate 945, spruce_log 414, stone 319, cobblestone 52 -> the clear's clerk draws the stone kinds;
  // the logs stay under the build reserve's 512, cobblestone under its 256
  const town = { cobbled_deepslate: 200, spruce_log: 414, stone: 319, cobblestone: 52, coal: 325 }   // (LIVE: 945 deepslate -- it alone fills a 640 visit)
  const w = Y.yardWork({ held: {}, slots: 5, freeSlots: 31, town, states: st, lanes: ON, keeps: {}, clear: true })
  assert.equal(w.kind, 'clerk'); assert.equal(w.clear, true)
  assert.deepEqual(Object.keys(w.draw).sort(), ['cobbled_deepslate', 'stone'], 'never coal (no lane), never the reserve\'s logs or cobblestone')
  assert.equal(Y.yardWork({ held: {}, slots: 5, freeSlots: 31, town, states: st, lanes: ON, keeps: {} }).kind, null, 'positive control: without the clear the clerk moves only cobblestone above 320')
  assert.equal(Y.yardWork({ held: {}, slots: 5, freeSlots: 31, town: { ...town, spruce_log: 700 }, states: st, lanes: ON, keeps: {}, clear: true }).draw.spruce_log > 0, true, 'logs above the reserve go')
})
await t('the room bank under the clear keeps nothing of a name it may move -- a hard keep aside; MUTANTS: the limit not lifted, the clerk past the reserve, the hard keep cleared', async () => {
  const bagX = [{ name: 'sugar_cane', count: 12, slot: 9 }, { name: 'ladder', count: 30, slot: 10 }]
  const elig = () => true
  assert.deepEqual(BRx.roomBankSteps(bagX, { eligible: elig, keep: {}, clear: false }).map(s => s.name), [], 'positive control: under their keeps nothing moves')
  assert.deepEqual(BRx.roomBankSteps(bagX, { eligible: elig, keep: {}, clear: true }).map(s => s.name), ['ladder', 'sugar_cane'])
  assert.deepEqual(BRx.roomBankSteps(bagX, { eligible: elig, keep: { ladder: 64 }, hard: n => n === 'ladder', clear: true }).map(s => s.name), ['sugar_cane'], 'the goal\'s want stands')
  const YP = P('yard')
  const st = () => states(world())
  await killedBy(YP, Y, '  let left = lanes?.on ? (clear ? CLEAR_VISIT_MAX : lanes.visitMax) : YARD_VISIT_MAX', '  let left = lanes?.on ? lanes.visitMax : YARD_VISIT_MAX', M => assert.equal(M.yardWork({ held: { cobblestone: 500 }, slots: 10, states: st(), lanes: ON, keeps: {}, clear: true }).place.cobblestone, 500))
  await killedBy(YP, Y, "(clear && lanes?.on ? (CLEAR_CHEST_KEEP[name] ?? 0) : YARD_CHEST_KEEP[name]))", "(clear && lanes?.on ? 0 : YARD_CHEST_KEEP[name]))", M => assert.equal(M.yardWork({ held: {}, slots: 5, freeSlots: 31, town: { spruce_log: 414, stone: 319 }, states: st(), lanes: ON, keeps: {}, clear: true }).draw.spruce_log, undefined))
  await killedBy(P('bagroom'), BRx, '    let room = total - (clear && !hard(name) ? 0 : k)\n', '    let room = total - (clear ? 0 : k)\n', M => assert.deepEqual(M.roomBankSteps(bagX, { eligible: elig, keep: { ladder: 64 }, hard: n => n === 'ladder', clear: true }).map(s => s.name), ['sugar_cane']))
  const sk = strip(readFileSync(P('skills'), 'utf8'))
  one(sk, 'if \\(clearActive\\(BAGFIX\\)\\) \\{ out\\[name\\] = 0; continue \\}\\s*out\\[name\\] = partialKeep\\(\\{ slots: items\\.length, copies: copies\\.length, total: counts\\[name\\] \\?\\? 0, keep: keep\\[name\\]', 'the lanes\' keeps')
  one(sk, 'noRefill: REFILL\\.on, clear: clearActive\\(BAGFIX\\) \\}', 'the visit\'s plan')
  one(sk, 'w\\.clear \\? \\(n, want, o\\) => compactAllow\\(n, want, o, CLEAR_CHEST_KEEP\\[n\\] \\?\\? 0\\) : undefined', 'the clear\'s clerk takes every lane kind, down to its floor')
})

// ---- Codex r1 BLOCKER 6: every placement on the piles takes its lanes' leases ---------------------------------------------------------
await t('LEASED PILE CELLS: each lane used is leased; a held lane is skipped and the plan made again; a second collision stocks nothing; MUTANT: a lane placed on without its lease', async () => {
  const st = () => states(world())
  const asked = []
  const all = Y.leasedPileCells(st(), { cobblestone: 10, gravel: 5 }, { lanes: ON }, id => { asked.push(id); return true })
  assert.deepEqual([all.leased, asked, all.pc.cells.length], [[0, 1], [0, 1], 15])
  // lane 0 is another bot's: cobblestone takes lane 1 (leased), gravel lane 2 (leased)
  const held0 = Y.leasedPileCells(st(), { cobblestone: 10, gravel: 5 }, { lanes: ON }, id => id !== 0)
  assert.deepEqual(held0.pc.lanes, { cobblestone: [1], gravel: [2] }); assert.deepEqual([...held0.leased].sort(), [1, 2])
  // every lane held: nothing is placed (positive control above: the same call places 15)
  assert.equal(Y.leasedPileCells(st(), { cobblestone: 10 }, { lanes: ON }, () => false).pc.cells.length, 0)
  // the SECOND plan opens a lane that is held too: nothing (never a third plan)
  assert.equal(Y.leasedPileCells(st(), { cobblestone: 10 }, { lanes: ON }, id => id > 1).pc.cells.length, 0)
  // a lease that throws is no lease
  assert.equal(Y.leasedPileCells(st(), { cobblestone: 10 }, { lanes: ON }, () => { throw new Error('boom') }).pc.cells.length, 0)
  // the old yard: its one visitor, no lease asked
  let n = 0
  assert.equal(Y.leasedPileCells(states(world(), OFF), { cobblestone: 10 }, { lanes: OFF }, () => { n++; return false }).pc.cells.length, 10); assert.equal(n, 0)
  await killedBy(P('yard'), Y, '  const busy = new Set(idsOf(pc).filter(id => !lease(id)))', '  const busy = new Set()', M => assert.equal(M.leasedPileCells(st(), { cobblestone: 10 }, { lanes: ON }, () => false).pc.cells.length, 0))
  await killedBy(P('yard'), Y, '    if (idsOf(pc).some(id => !lease(id))) pc = { ...pc, cells: [] }', '', M => assert.equal(M.leasedPileCells(st(), { cobblestone: 10 }, { lanes: ON }, id => id > 1).pc.cells.length, 0))
})

// ---- Paper proof 11-17, defects A and B: the reasons a visit names, first lanes before second, the next yard wanted --------------------
await t('FIRST LANES BEFORE SECOND ONES: a kind opens a second lane only when its first is FULL, its cap allows, and a lane is still left for a kind with none', () => {
  const w = world()
  const L = lanes(w)
  fill(w, L[0].slots, 164, 'cobblestone')   // cobblestone's lane is at its full length
  const st = states(w)
  // one plan with more cobblestone AND three kinds that have no lane: the three get the lanes; cobblestone's second waits
  const pc = Y.pileCells(st, { cobblestone: 64, gravel: 10, sand: 10, andesite: 10 }, { lanes: ON })
  assert.deepEqual(pc.lanes, { gravel: [1], sand: [2], andesite: [3] }, 'the kinds\' own order would have given cobblestone lane 1 first')
  // only cobblestone carried: a second lane opens (three empty)...
  assert.deepEqual(Y.pileCells(st, { cobblestone: 64 }, { lanes: ON }).lanes, { cobblestone: [1] })
  // ...but never the LAST empty lane (it is a first lane's)
  fill(w, L[1].slots, 10, 'gravel'); fill(w, L[2].slots, 10, 'sand')
  assert.equal(Y.pileCells(states(w), { cobblestone: 64 }, { lanes: ON }).cells.length, 0)
  assert.deepEqual(Y.pileCells(states(w), { andesite: 5 }, { lanes: ON }).lanes, { andesite: [3] }, 'positive control: a first lane takes it')
})
await t('THE VISIT NAMES ITS REASON: no_lane (never a bare idle) when this yard has no lane for a kind the bag carries; lane_held is a short retry, not an empty visit', () => {
  const w = world()
  const L = lanes(w)
  for (const [i, k] of ['cobblestone', 'gravel', 'sand', 'dirt'].entries()) fill(w, L[i].slots, 10, k)
  const st = states(w)
  const r = Y.yardWork({ held: { andesite: 40, diorite: 20 }, slots: 12, states: st, lanes: ON, keeps: {} })
  assert.deepEqual([r.kind, r.why, r.noLane], [null, 'no_lane:andesite+diorite', ['andesite', 'diorite']])
  assert.equal(Y.yardWork({ held: { andesite: 40 }, slots: 12, states: st, lanes: ON, keeps: {}, others: { andesite: { lanes: 1, room: 100 } } }).why, 'idle', 'a lane with room in ANOTHER yard: not "no lane" (the bot banks there)')
  assert.deepEqual(Y.yardWork({ held: { andesite: 40, gravel: 40 }, slots: 12, states: st, lanes: ON, keeps: {} }).noLane, ['andesite'], 'a stock still names the kind it could not place')
  assert.equal(Y.yardWork({ held: { gravel: 3 }, slots: 12, states: st, lanes: ON, keeps: {} }).why, 'idle', 'positive control: nothing to bank is idle')
  // the rests: a held lane 45 s, a jammed bag 2 min, an idle bag 20 min
  assert.deepEqual([Y.yardRestMs({ lanes: ON, slots: 36, held: true }), Y.yardRestMs({ lanes: ON, slots: 36 }), Y.yardRestMs({ lanes: ON, slots: 10 })], [45_000, 120_000, Y.YARD_REST_MS])
  assert.equal(Y.yardRestMs({ lanes: OFF, slots: 36, held: true }), Y.YARD_REST_MS)
  // leasedPileCells says which lanes were another bot's
  assert.deepEqual(Y.leasedPileCells(states(world()), { cobblestone: 10 }, { lanes: ON }, id => id !== 0).busy, [0])
})
await t('"A KIND HAS NO LANE ANYWHERE" MAKES THE NEXT YARD WANTED: the setting\'s four, then one more than stand while the want is fresh, never past the list', () => {
  const NOW = 1e12
  assert.equal(Y.yardsWanted({ lanes: ON, standing: 4, noLaneAt: null, now: NOW }), 4, 'no want: the setting\'s')
  assert.equal(Y.yardsWanted({ lanes: ON, standing: 4, noLaneAt: NOW - 60_000, now: NOW }), 5)
  assert.equal(Y.yardsWanted({ lanes: ON, standing: 2, noLaneAt: NOW - 60_000, now: NOW }), 4, 'yards still to build under the setting: no extra one')
  assert.equal(Y.yardsWanted({ lanes: ON, standing: 6, noLaneAt: NOW - 60_000, now: NOW }), 6, 'never past the list')
  assert.equal(Y.yardsWanted({ lanes: ON, standing: 4, noLaneAt: NOW - Y.YARD_WANT_MS, now: NOW }), 4, 'a want a day old is over')
  assert.equal(Y.yardsWanted({ lanes: OFF, standing: 4, noLaneAt: NOW, now: NOW }), 1)
  // the order's list follows it
  try {
    assert.equal(S.yardOffered('yard'), true)
    S.setYardsWanted(() => 5)
    assert.equal(S.yardOffered('yard5'), Y.LANES.on, 'offered only where the lanes are')
    assert.equal(S.yardOffered('yard6'), false)
  } finally { S.setYardsWanted(null) }
})
await t('MUTANTS KILLED (Paper 11-17): the last lane given to a second lane; first lanes not first; the reason unnamed; a held lane resting long; the want that never ends', async () => {
  const YP = P('yard')
  const w = world(); const L = lanes(w)
  fill(w, L[0].slots, 164, 'cobblestone'); fill(w, L[1].slots, 10, 'gravel'); fill(w, L[2].slots, 10, 'sand')
  await killedBy(YP, Y, "  if (mine > 0 && states.filter(s => s.name == null && s.foreign === 0 && s.free > 0).length < 2) return false\n", '', M => assert.equal(M.pileCells(M.bayStates(M.laneBays(REC, BP, w, { lanes: ON }), w, { kinds: M.LANE_KINDS }), { cobblestone: 64 }, { lanes: ON }).cells.length, 0))
  const w2 = world(); fill(w2, lanes(w2)[0].slots, 164, 'cobblestone')
  await killedBy(YP, Y, "      const e = (!on || !hasLane) && laneMayOpen(st, name, { lanes, others }) ? empty() : null", "      const e = laneMayOpen(st, name, { lanes, others }) ? empty() : null", M => assert.deepEqual(M.pileCells(M.bayStates(M.laneBays(REC, BP, w2, { lanes: ON }), w2, { kinds: M.LANE_KINDS }), { cobblestone: 64, gravel: 10, sand: 10, andesite: 10 }, { lanes: ON }).lanes, { gravel: [1], sand: [2], andesite: [3] }))
  const w3 = world(); for (const [i, k] of ['cobblestone', 'gravel', 'sand', 'dirt'].entries()) fill(w3, lanes(w3)[i].slots, 10, k)
  await killedBy(YP, Y, "why: noLane.length ? `no_lane:${noLane.join('+')}`.slice(0, 80) : 'idle', noLane }", "why: 'idle', noLane }", M => assert.equal(M.yardWork({ held: { andesite: 40 }, slots: 12, states: M.bayStates(M.laneBays(REC, BP, w3, { lanes: ON }), w3, { kinds: M.LANE_KINDS }), lanes: ON, keeps: {} }).why, 'no_lane:andesite'))
  await killedBy(YP, Y, "(lanes?.on && held ? YARD_HELD_REST_MS : lanes?.on && Number(slots) >= YARD_URGENT_SLOTS ? YARD_JAM_REST_MS : YARD_REST_MS)", "(lanes?.on && Number(slots) >= YARD_URGENT_SLOTS ? YARD_JAM_REST_MS : YARD_REST_MS)", M => assert.equal(M.yardRestMs({ lanes: ON, slots: 10, held: true }), 45_000))
  await killedBy(YP, Y, "  const more = Number.isFinite(noLaneAt) && now - noLaneAt < YARD_WANT_MS ? standing + 1 : 0", "  const more = Number.isFinite(noLaneAt) ? standing + 1 : 0", M => assert.equal(M.yardsWanted({ lanes: ON, standing: 4, noLaneAt: 1e12 - M.YARD_WANT_MS, now: 1e12 }), 4))
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall yardlanes tests passed')
