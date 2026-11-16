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
  const read = world()
  const l0 = lanes(read)
  assert.deepEqual(l0.map(b => b.slots.length), [52, 52, 52, 52], 'four empty lanes, 8 rows each')
  // the 8 rows are the bay's FAR end, and every slot of a short lane is a slot of the whole bay (a lane never leaves its bay)
  const whole = Y.pileSlots(REC, BP)
  for (const [i, b] of l0.entries()) { const all = new Set(whole[i].slots.map(s => s.join(','))); assert.ok(b.slots.every(s => all.has(s.join(',')))) }
  assert.equal(l0[0].slots.filter(s => s[1] === 71).length, 16, 'the floor layer: 2 wide x 8 rows')
  assert.deepEqual(l0[0].slots.slice(0, 16), whole[0].slots.slice(0, 16), 'the far end: the whole bay\'s own first 8 rows (its fill order is far end first)')
  // filled: the lane is longer; an old pile standing past the lane's rows is never hidden (the lane covers what stands)
  fill(read, l0[0].slots, 52, 'cobblestone')
  assert.deepEqual(lanes(read).map(b => b.slots.length), [116, 52, 52, 52])
  const old = world(); fill(old, whole[1].slots, 150, 'cobblestone')
  assert.equal(lanes(old)[1].slots.length, 164, 'the old yard\'s full bay reads whole')
  assert.deepEqual(lanes(read, OFF).map(b => b.slots.length), [164, 164, 164, 164], 'YARDLANES=off: the whole bays, as before')
  const unread = (x, y, z) => null
  assert.equal(Y.laneBays(REC, BP, unread, { lanes: ON })[0].slots.length, 164, 'an unread bay keeps its whole length (never a guess)')
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
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: ON }), true, 'one lane of two')
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: ON, others: { gravel: { lanes: 1, room: 0 } } }), false, 'two lanes over the yards: its cap')
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: ON, others: { gravel: { lanes: 1, room: 40 } } }), false, 'room in its lane in another yard: bank there, open nothing here')
  assert.equal(Y.laneMayOpen(st, 'cobblestone', { lanes: ON, others: { cobblestone: { lanes: 2, room: 0 } } }), true, 'cobblestone may hold four')
  assert.equal(Y.laneMayOpen(st, 'gravel', { lanes: OFF, others: { gravel: { lanes: 9, room: 0 } } }), true, 'off: the old yard has no caps')
})

await t('ROOM AND THE CAP: a kind\'s room is its lanes\' and the lanes it may still open; FULL at the cap is over_cap; a lane another bot holds is skipped', () => {
  const read = world()
  const st0 = states(read)
  assert.equal(Y.yardRoomFor(st0, 'gravel', { lanes: ON }), 104, 'two lanes of 52 at the start')
  assert.equal(Y.yardRoomFor(st0, 'cobblestone', { lanes: ON }), 208, 'four')
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

await t('THE CHAIN bag -> lane -> cap -> well: a kind with room is HELD off the well; full at its cap the well takes it again; a hold lapses unanswered', () => {
  const NOW = 1e12, MS = Y.YARD_DEFER_MS
  assert.deepEqual(Y.wellHold({ room: 40, holdAt: null, now: NOW }), { hold: true, stamp: NOW })
  assert.deepEqual(Y.wellHold({ room: 40, holdAt: NOW - MS + 1, now: NOW }), { hold: true, stamp: NOW - MS + 1 })
  assert.equal(Y.wellHold({ room: 40, holdAt: NOW - MS, now: NOW }).hold, false, 'unanswered for 30 min: the well\'s turn (a bag is never held full on the yard\'s promise)')
  assert.equal(Y.wellHold({ room: 40, holdAt: NOW - 2 * MS, now: NOW }).hold, true, 'and after as long again a new hold may start')
  assert.deepEqual(Y.wellHold({ room: 40, holdAt: NOW - MS, stockAt: NOW - 5, now: NOW }), { hold: true, stamp: NOW }, 'a stock visit answered it')
  assert.equal(Y.wellHold({ room: 0, holdAt: null, now: NOW }).hold, false, 'no room (over_cap, or no home yet): the well as before')
  assert.equal(Y.wellHold({ on: false, room: 40, now: NOW }).hold, false)
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

await t('MUTANTS KILLED: a lane that never grows; a lane past its bay; the cap ignored; another yard\'s room ignored; a held lane taken; the hold that never lapses; the hold ignored', async () => {
  const YP = P('yard'), WP = P('well')
  await killedBy(YP, Y, 'if (laneCapacity(len, { w, h }) > held) return len', 'if (true) return len', M => assert.equal(M.laneLen(52, 22), 16))
  await killedBy(YP, Y, '  return f\n}\n/** THE RANK OF A SITE', '  return f + 8\n}\n/** THE RANK OF A SITE', M => assert.equal(M.laneLen(500, 22), 22))
  const st = () => states(world())
  await killedBy(YP, Y, '  return states.filter(s => s.name === name).length + o.lanes < laneCapOf(name, lanes.caps)', '  return true', M => assert.equal(M.laneMayOpen(st(), 'gravel', { lanes: ON, others: { gravel: { lanes: 2, room: 0 } } }), false))
  await killedBy(YP, Y, '  if (o.room > 0) return false\n', '', M => assert.equal(M.laneMayOpen(st(), 'gravel', { lanes: ON, others: { gravel: { lanes: 1, room: 40 } } }), false))
  await killedBy(YP, Y, '      const mine = s => !(skip?.has?.(s.id))', '      const mine = () => true', M => assert.deepEqual(M.pileCells(st(), { cobblestone: 10 }, { lanes: ON, skip: new Set([0]) }).lanes, { cobblestone: [1] }))
  await killedBy(YP, Y, '  return { hold: now - holdAt < ms, stamp: holdAt }', '  return { hold: true, stamp: holdAt }', M => assert.equal(M.wellHold({ room: 40, holdAt: 1e12 - M.YARD_DEFER_MS, now: 1e12 }).hold, false))
  await killedBy(YP, Y, "  if (!on || !(Number(room) > 0)) return { hold: false, stamp: holdAt }", "  if (!on) return { hold: false, stamp: holdAt }", M => assert.equal(M.wellHold({ room: 0, now: 1e12 }).hold, false))
  await killedBy(YP, Y, "return { kind: 'stock', urgent: pressed || !!lanes?.on, place,", "return { kind: 'stock', urgent: pressed, place,", M => assert.equal(M.yardWork({ held: { gravel: 16 }, slots: 20, states: st(), lanes: ON, keeps: {} }).urgent, true))
  await killedBy(YP, Y, '  const stockMin = lanes?.on ? Math.min(YARD_STOCK_MIN, lanes.min) : YARD_STOCK_MIN', '  const stockMin = YARD_STOCK_MIN', M => assert.equal(M.yardWork({ held: { gravel: 16 }, slots: 20, states: st(), lanes: ON, keeps: {} }).kind, 'stock'))
  const bag = [{ name: 'andesite', count: 40, slot: 9 }, { name: 'egg', count: 12, slot: 11 }, { name: 'cobblestone', count: 64, slot: 12 }, { name: 'cobblestone', count: 64, slot: 13 }]
  await killedBy(WP, W, ').filter(it => !yardHolds(it.name))', ')', M => { try { M.setYardHold(n => n === 'andesite'); assert.deepEqual(M.disposePlan(bag).stacks.map(s => s.name), ['egg']) } finally { M.setYardHold(null) } })
  await killedBy(WP, W, "(cobbleAtCap || yardFull('cobblestone')) ?", 'cobbleAtCap ?', M => { try { M.setYardFull(() => true); assert.equal(M.disposePlan(bag).stacks.filter(s => s.name === 'cobblestone').length, 1) } finally { M.setYardFull(null) } })
})

await t('WIRED: every yard is the yard\'s (order, siting, visit); the lanes\' leases; the hold and the full word installed; the over_cap row; the licence row', () => {
  const sk = strip(readFileSync(P('skills'), 'utf8')), sh = strip(readFileSync(P('shop'), 'utf8')), ft = strip(readFileSync(P('features'), 'utf8'))
  one(sh, 'isYardPlot\\(p\\.plot\\) \\? yard && yardPlots\\(\\)\\.includes\\(p\\.plot\\)', 'projectsOn')
  one(sh, 'if \\(!isYardPlot\\(plot\\) && freeSlots < need\\) \\{', 'a full bag is a yard visit\'s reason, never its refusal')
  one(sk, 'const yw = complete && b && isYardPlot\\(p\\.plot\\) \\? yardWorkNow\\(b, rec, now, p\\.plot\\) : null', 'the order reads every yard\'s work')
  one(sk, 'const ss = await yardSiteFor\\(bot, \\{ \\.\\.\\.h\\.head\\.plan, gen: h\\.head\\.gen \\}, c, stood, signal, plot\\)', 'a later yard is sited by the yard\'s siting')
  one(sk, 'rankKey: firstRec \\? site => nearYardRank\\(firstRec, site\\.pad\\) \\* 100 \\+ step\\.rankKey\\(site\\) : step\\.rankKey', 'nearest the first yard')
  one(sk, 'return yardVisit\\(ctx, rec, rh\\.head\\.gen, signal, out, t0, \\{ plot, \\.\\.\\.\\(LANES\\.on \\? \\{ until: t0 \\+ LANES\\.passMs \\} : \\{\\}\\) \\}\\)', 'a complete yard gets the yard\'s visit, bounded')
  one(sk, 'const slot = takeSlot\\(dir, key, me, LANES\\.on && !\\(Number\\(draw\\) > 0\\) \\? LANES\\.visitors : YARD_BUILDERS\\)', 'several visitors')
  one(sk, 'const lease = id => \\{ const l = projTakeLease\\(dir, key, `lane\\$\\{id\\}`, me\\)', 'one lease a lane')
  one(sk, 'for \\(const l of laneLeases\\) \\{ try \\{ releaseLease\\(dir, key, l\\.name, me, l\\.gen\\) \\}', 'released when the visit ends')
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
  one(sk, "const lease = projTakeLease\\(dir, key, 'row', me\\)\\n    if \\(lease\\.ok\\) \\{\\n      try \\{", 'one placer at a time')
  one(sk, "if \\(stands\\) \\{ yardRowsWrite\\(bot, rowAssign\\(rows, at, plan\\.place\\.kind, \\{ plot, by: me \\}\\)\\); out\\.placed\\+\\+", 'the record follows the world')
  one(sk, "const p = await sortPut\\(bot, block, b\\.names, deadline, signal, keeps, bag => rowSteps\\(bag, b\\.names, keeps, logHalfSteps\\), 'yard_row'\\)", 'the bank')
  one(sk, "if \\(typeof stepsOf === 'function'\\) return stepsOf\\(bag\\)", 'sortPut takes the row\'s steps')
  one(sk, "if \\(rp\\.bank\\.length\\) return \\{ kind: 'row', urgent: true,", 'the order reads the row\'s work')
  one(sk, 'const k = rk \\? \\{ room: yardRowRoomNow\\(bot, rk, now\\) \\} : yardKindNow\\(bot, name, now\\)', 'WELL_HOLD covers a row kind with room')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall yardlanes tests passed')
