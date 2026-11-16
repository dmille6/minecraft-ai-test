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
  const zs = l0[0].slots.filter(s => s[1] === 71).map(s => s[2]); assert.equal(new Set(zs).size, 8)
  assert.equal(Math.max(...zs), Math.max(...whole[0].slots.map(s => s[2])), 'the far end')
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
  assert.equal(Y.yardRoomFor(st0, 'gravel', { lanes: OFF }), 656, 'off: every empty bay, as before')
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
  assert.equal(w.kind, 'stock'); assert.equal(w.urgent, false)
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
  one(sk, 'return yardVisit\\(ctx, rec, rh\\.head\\.gen, signal, out, t0, \\{ plot \\}\\)', 'a complete yard gets the yard\'s visit')
  one(sk, 'const slot = takeSlot\\(dir, key, me, LANES\\.on && !\\(Number\\(draw\\) > 0\\) \\? LANES\\.visitors : YARD_BUILDERS\\)', 'several visitors')
  one(sk, 'const lease = id => \\{ const l = projTakeLease\\(dir, key, `lane\\$\\{id\\}`, me\\)', 'one lease a lane')
  one(sk, 'for \\(const l of laneLeases\\) \\{ try \\{ releaseLease\\(dir, key, l\\.name, me, l\\.gen\\) \\}', 'released when the visit ends')
  one(sk, 'if \\(LANES\\.on && wellHoldOn\\(\\)\\) \\{ setYardHold\\(yardHoldNow\\); setYardFull\\(', 'WELL_HOLD installed')
  one(sk, "dispose_well: \\{ run: \\(ctx, a, signal\\) => withOverCap\\(ctx, \\(\\) => disposeWell\\(ctx, a, signal\\)\\)", 'the over_cap row wraps the well')
  one(sk, "if \\(k\\.over\\) logEvent\\(\\{ kind: 'yard_over_cap'", 'only a kind FULL at its cap is logged over_cap')
  one(sk, "logEvent\\(\\{ kind: 'yard_lanes', status: 'success'", 'the licence row')
  one(ft, 'try \\{ yardLanesInstall\\(bot\\) \\}', 'installed at spawn')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall yardlanes tests passed')
