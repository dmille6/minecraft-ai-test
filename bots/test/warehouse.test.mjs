// WAREHOUSE-01 (src/warehouse.mjs has the owner's words and the layout): sorted chests per kind are the town's main store. Behaviour
// (the pure layout, the access proof, the deposit's order, a kind's room and cap, the next tier, the clerk's homes), anchored mutants,
// then the wiring.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-warehouse-${process.pid}`
process.env.BOT_NAME = 'TestBot'
const W = await import('../src/warehouse.mjs')
const H = await import('../src/storehub.mjs')
const Y = await import('../src/yard.mjs')
const TD = await import('../src/towndeposit.mjs')

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

// A STACKED DESIGN (the new storehouse's shape, one wing): an aisle 3 wide (x 1..3) and 9 long (z 0..8), 4 high; a column of three
// chests every other cell along both walls (x 0 and x 4), a post between; the doorway is the aisle's end (z 0).
const wing = () => {
  const columns = []
  for (const x of [0, 4]) for (const z of [1, 3, 5, 7]) columns.push({ col: columns.length, kind: columns.length < 2 ? 'cobblestone' : columns.length < 4 ? 'logs' : columns.length === 7 ? 'overflow' : 'parts', section: 's', chests: [[x, 1, z], [x, 2, z], [x, 3, z]], stand: [x === 0 ? 1 : 3, 1, z] })
  const open = (x, y, z) => y >= 1 && y <= 4 && z >= 0 && z <= 8 && ((x >= 1 && x <= 3) || ((x === 0 || x === 4) && z % 2 === 1 && y === 4))
  return { layout: { id: 'wing', columns }, doors: [[1, 1, 0], [2, 1, 0], [3, 1, 0]], open }
}

await t('the old hall is a layout of 18 one-chest columns, each with a use, and its access proof holds', () => {
  assert.equal(Object.keys(W.WH_HALL).length, 18)
  assert.deepEqual(Object.keys(W.WH_HALL).sort(), H.HALL_LAYOUT.map(c => `${c.u},${c.v}`).sort(), 'the hall\'s 18 chest cells exactly')
  for (const kind of Object.values(W.WH_HALL)) assert.ok(W.WH_USES[kind], kind)
  const d = W.whHallDesign(), a = W.whAccess(d)
  assert.deepEqual(a.fails, [])
  assert.deepEqual(a.stats, { columns: 18, chests: 18, slots: 486, floor: 86, aisle: 73, niches: 13 })
  // the record's own chests (world cells) give the same columns
  const rec = { anchor: [100, -40], s: 70, orient: 'N' }
  const cs = H.hubChestsOf(rec)
  assert.equal(cs.length, 18, 'positive control: the record has its 18 chests')
  const L = W.whHallLayout(cs, H.HALL_LAYOUT)
  assert.equal(L.columns.length, 18)
  assert.equal(L.columns.filter(c => c.kind === 'cobblestone').length, 2)
  for (const c of L.columns) { assert.equal(c.chests.length, 1); assert.equal(Math.abs(c.chests[0][0] - c.stand[0]) + Math.abs(c.chests[0][2] - c.stand[2]), 1, 'the stand is the cell in front') }
  assert.equal(W.whHallLayout([], []), null)
  assert.equal(W.whHallLayout(cs, H.HALL_LAYOUT.slice(1)), null, 'a record that is not the hall\'s 18')
})

await t('the access proof over a stacked layout: every tier reached from the floor, and each way of breaking it is named', async () => {
  const d = wing()
  const ok = W.whAccess(d)
  assert.deepEqual(ok.fails, [])
  assert.deepEqual([ok.stats.columns, ok.stats.chests, ok.stats.slots], [8, 24, 648])
  assert.equal(ok.stats.niches, 0, 'the stands are the aisle\'s own cells')
  const fails = blocked => W.whAccess({ ...d, blocked }).fails
  // a post on a stand: the column is not reached AND the aisle is under 3 there
  assert.ok(fails((x, y, z) => x === 1 && z === 3 && y === 1).some(f => /column 1 .*stand 1,1,3 is not on the floor/.test(f)))
  // a ceiling at y 3 over the stand: the third tier is hidden behind it
  assert.ok(fails((x, y, z) => x === 1 && z === 3 && y === 3).some(f => /column 1 .*tier 3: 1,3,3 stands between the eye and the chest/.test(f)))
  // a solid block over the top chest: its lid
  assert.ok(fails((x, y, z) => x === 0 && z === 5 && y === 4).some(f => /column 2 .*tier 3: a solid block is over it/.test(f)))
  // a wall across the aisle: the far columns are cut off
  assert.ok(fails((x, y, z) => z === 4 && y <= 2).some(f => /column 2 .*not on the floor walked from a doorway/.test(f)))
  // a pillar in the aisle's middle: the aisle is under 3 wide there
  assert.ok(fails((x, y, z) => x === 2 && z === 4 && y === 1).length > 0)
  // a chest out of reach (a seventh tier)
  const tall = wing(); tall.layout.columns[0].chests.push([0, 4, 1], [0, 5, 1], [0, 6, 1], [0, 7, 1])
  const tf = W.whAccess({ ...tall, open: (x, y, z) => d.open(x, y, z) || (y >= 5 && y <= 8 && x >= 0 && x <= 4) }).fails
  assert.ok(tf.some(f => /tier 7: .*past the reach/.test(f)) && !tf.some(f => /tier 3: /.test(f)), 'the seventh tier is past the reach; the third is not')
  // a stand that is not in front of its column
  const off = wing(); off.layout.columns[3].stand = [2, 1, 7]
  assert.ok(W.whAccess(off).fails.some(f => /column 3 .*tier 1: its stand is not the cell in front of it/.test(f)))
  // MUTANTS: the proof without its sight line, without its lid rule, without its aisle
  const sight = M => assert.ok(M.whAccess({ ...d, blocked: (x, y, z) => x === 1 && z === 3 && y === 3 }).fails.length > 0)
  await killedBy(P('warehouse'), W, "if (!air(...p)) { fails.push(", 'if (false) { fails.push(', sight)
  const lid = M => assert.ok(M.whAccess({ ...d, blocked: (x, y, z) => x === 0 && z === 5 && y === 4 }).fails.length > 0)
  await killedBy(P('warehouse'), W, 'if (top ? !(air(at[0], at[1] + 1, at[2]) || ', 'if (top ? !(true || ', lid)
  const aisle = M => assert.ok(M.whAccess({ ...d, blocked: (x, y, z) => x === 2 && z === 4 && y === 1 }).fails.length > 0)
  await killedBy(P('warehouse'), W, "for (let a = 0; a < 3 && all; a++) for (let b = 0; b < 3 && all; b++) if (!floor.has(k2(x + a, z + b))) all = false", '', aisle)
  const hall = M => assert.ok(M.whAccess({ ...M.whHallDesign(), blocked: (x, y, z) => x === 8 && z === 7 && y === 1 }).fails.some(f => /not on the floor walked from a doorway/.test(f)))
  await killedBy(P('warehouse'), W, "if (sy !== y0 || !floor.has(k2(sx, sz))) {", 'if (false) {', hall)
})

await t('every item has a column: a use of its own, its section\'s, or the overflow', () => {
  const s = n => W.whSectionOf(n, H.hubSectionOf(n))
  assert.equal(s('cobblestone'), 'cobblestone'); assert.equal(s('spruce_log'), 'logs'); assert.equal(s('oak_planks'), 'planks'); assert.equal(s('stick'), 'planks')
  assert.equal(s('gravel'), 'gravel'); assert.equal(s('red_sand'), 'sand'); assert.equal(s('tuff'), 'deepslate'); assert.equal(s('granite'), 'stones')
  assert.equal(s('cobblestone_wall'), 'parts'); assert.equal(s('lantern'), 'parts'); assert.equal(s('copper_ingot'), 'valuables'); assert.equal(s('coal'), 'valuables')
  assert.equal(s('iron_pickaxe'), 'tools'); assert.equal(s('wheat_seeds'), 'farm'); assert.equal(s('oak_sapling'), 'farm'); assert.equal(s('clay_ball'), 'farm')
  assert.equal(s('bread'), 'farm', 'food has no use of its own: its section\'s column'); assert.equal(s('stone_bricks'), 'parts')
  assert.equal(s('rotten_flesh'), 'overflow'); assert.equal(s(''), 'overflow')
  assert.equal(W.whKindOf('bread'), null); assert.equal(W.whKindOf('rotten_flesh'), null)
  for (const [kind, u] of Object.entries(W.WH_USES)) for (const n of u.names) assert.equal(W.whKindOf(n), kind, `${n} names one use`)
  assert.ok(W.whTakes('cobblestone', 'cobblestone') && !W.whTakes('cobblestone', 'dirt') && W.whTakes('overflow', 'dirt'))
})

await t('the deposit goes to the bag\'s own columns first, then the town\'s other chests, then the overflow -- never another kind\'s column', async () => {
  const { layout } = wing()
  const kinds = W.whChestKinds(layout)
  assert.equal(kinds.size, 24)
  const keys = ['0,1,5', '9,9,9', '4,1,7', '0,1,1', '0,2,1', '4,1,1']   // logs, a town chest, overflow, cobble t1, cobble t2, parts
  const order = W.whDepositOrder(keys, kinds, new Set(['cobblestone', 'farm']))
  assert.deepEqual(order.map(i => keys[i]), ['0,1,1', '0,2,1', '9,9,9', '4,1,7'])
  assert.deepEqual(W.whDepositOrder(keys, new Map(), new Set(['cobblestone'])), [0, 1, 2, 3, 4, 5], 'no layout: the caller\'s order')
  await killedBy(P('warehouse'), W, 'else if (want.has(kind)) own.push(i)', 'else own.push(i)', M => assert.ok(!M.whDepositOrder(keys, kinds, new Set(['cobblestone'])).map(i => keys[i]).includes('0,1,5'), 'the logs column is never listed for a bag of cobblestone'))
})

await t('a kind\'s room and cap are its columns\'; a full kind grows one tier at a time, bottom-up, from carried chests', async () => {
  const { layout } = wing()
  const up = new Set(['0,1,1', '0,1,3'])   // cobblestone: the two bottom chests stand, four cells above are free
  const standing = k => up.has(k)
  assert.deepEqual(W.whRoom(layout, 'cobblestone', { standing }), { chests: 2, free: 2, open: 4, cap: 6, room: 6, over: false })
  const full = new Set(['0,1,1', '0,1,3'])
  assert.deepEqual(W.whRoom(layout, 'cobblestone', { standing, full }), { chests: 2, free: 0, open: 4, cap: 6, room: 4, over: false })
  const all = new Set(W.whRows(layout).filter(r => r.kind === 'cobblestone').map(r => r.k))
  assert.deepEqual(W.whRoom(layout, 'cobblestone', { standing: () => true, full: all }), { chests: 6, free: 0, open: 0, cap: 6, room: 0, over: true })
  assert.equal(W.whRoom(layout, 'sand').over, false, 'a kind with no column is not over a cap (it has none)')
  assert.equal(W.whRoom(layout, 'overflow', { standing: () => true }).room, 0, 'the overflow is never a kind\'s room')
  // the next tier
  assert.equal(W.whPlace(layout, 'cobblestone', { standing, carried: 3 }), null, 'a standing chest has room: nothing is placed')
  assert.deepEqual(W.whPlace(layout, 'cobblestone', { standing, full, carried: 3 }), [0, 2, 1], 'the first column\'s second tier')
  assert.equal(W.whPlace(layout, 'cobblestone', { standing, full, carried: 1 }), null, 'one carried chest stays with the bot')
  const up2 = new Set([...up, '0,2,1']), full2 = new Set([...full, '0,2,1'])
  assert.deepEqual(W.whPlace(layout, 'cobblestone', { standing: k => up2.has(k), full: full2, carried: 2 }), [0, 2, 3], 'the neighbour\'s second tier before the first column\'s third')
  assert.equal(W.whPlace(layout, 'cobblestone', { standing: () => true, full: all, carried: 9 }), null, 'at its cap')
  // never a floating chest: a column whose bottom is gone grows from the bottom
  assert.deepEqual(W.whPlace(layout, 'logs', { standing: k => k === '0,2,5', full: new Set(['0,2,5']), carried: 2 }), [0, 1, 5])
  await killedBy(P('warehouse'), W, 'if (cols.some(c => c.chests.some(at => up(at) && !full.has(kOf(at))))) return null', '', M => assert.equal(M.whPlace(layout, 'cobblestone', { standing, carried: 3 }), null))
  await killedBy(P('warehouse'), W, 'const free = up.filter(r => !full.has(r.k)).length', 'const free = up.length', M => assert.equal(M.whRoom(layout, 'cobblestone', { standing: () => true, full: all }).over, true))
  // the fullness is the town index's word, by the column's own kind (yard.mjs rowFullKeys with `kindOf`)
  const rows = W.whRows(layout).filter(r => r.kind === 'logs')
  const s = n => W.whSectionOf(n, H.hubSectionOf(n))
  const obs = { '0,1,5': { size: 27, used: 27, names: { spruce_log: [27 * 64, 27] } }, '0,2,5': { size: 27, used: 27, names: { oak_log: [100, 27] } }, '0,3,5': { size: 27, used: 27, names: { dirt: [5, 27] } } }
  const fullK = Y.rowFullKeys(rows, { obsOf: k => obs[k] ?? null, kindOf: s })
  assert.deepEqual([...fullK].sort(), ['0,1,5', '0,3,5'], 'full of logs; a partial log stack still takes logs; partial stacks of ANOTHER kind are no room; never seen: room')
})

await t('the clerk sorts by column: the homes are the columns bottom tier first, and a stack in another kind\'s column is moved to its own', () => {
  const { layout } = wing()
  const homes = W.whHomes(layout)
  assert.deepEqual(homes.homeOf.get('cobblestone'), ['0,1,1', '0,1,3', '0,2,1', '0,2,3', '0,3,1', '0,3,3'], 'both bottoms, then the second tier')
  assert.deepEqual(homes.overflow, ['4,1,7', '4,2,7', '4,3,7'])
  assert.equal(homes.byKey.get('0,1,5').section, 'logs')
  const entries = {
    '0,1,5': { size: 27, used: 3, names: { spruce_log: [64, 1], gravel: [40, 1], iron_pickaxe: [1, 1] } },   // the logs column holds gravel and a pickaxe
    '4,1,1': { size: 27, used: 1, names: { cobblestone_wall: [64, 1] } },                                      // parts, in place
  }
  const m = H.clerkMoves(homes, entries, { hubKeys: new Set(homes.byKey.keys()), sources: new Set(), stackable: () => true, well: false, sectionOf: W.whSectionOf })
  assert.equal(m.from, '0,1,5')
  // gravel has no column in this layout, a pickaxe none either: both to the overflow; the logs stay
  assert.deepEqual(m.moves.map(x => [x.name, x.to]).sort(), [['gravel', '4,1,7'], ['iron_pickaxe', '4,1,7']])
  // positive control: release 2's sections call the same chest's logs misplaced too (no `wood` home in a column layout) -- the
  // section function is what keeps them
  const old = H.clerkMoves(homes, entries, { hubKeys: new Set(homes.byKey.keys()), sources: new Set(), stackable: () => true, well: false })
  assert.ok(old.moves.some(x => x.name === 'spruce_log'), 'without the columns\' section function the logs would leave their column')
  assert.equal(H.clerkRoute('oak_sapling', { well: false, sectionOf: W.whSectionOf, plantsHeld: 64 }).to, 'stay', 'the plants\' cap is the item\'s, whatever column takes it')
  assert.equal(H.clerkRoute('spruce_log', { well: false }).section, 'wood', 'no section function: release 2 exactly')
})

await t('ROOM IS PER ITEM and a failed deposit is the newer word: a column\'s "room" never holds a kind off the piles and the well when the item cannot go in (Codex r1 blockers 1-2)', async () => {
  const { layout } = wing()
  const rows = W.whRows(layout).filter(r => r.kind === 'logs')
  const oakFull = { size: 27, used: 27, names: { oak_log: [26 * 64 + 10, 27] }, at: 1000 }   // 27 slots, one PARTIAL oak stack
  const obs = Object.fromEntries(rows.map(r => [r.k, oakFull]))
  assert.equal(W.whNameRoom(oakFull, 'oak_log'), true); assert.equal(W.whNameRoom(oakFull, 'spruce_log'), false); assert.equal(W.whNameRoom(null, 'spruce_log'), null)
  assert.equal(W.whNameRoom({ size: 27, used: 26, names: {} }, 'spruce_log'), true, 'an empty slot takes any name')
  const fullFor = (name, o = {}) => W.whFullFor(rows, name, { obsOf: k => obs[k] ?? null, now: 5000, ...o })
  assert.equal(fullFor('oak_log').size, 0, 'positive control: oak still fits')
  assert.equal(fullFor('spruce_log').size, 6, 'every logs chest is full FOR SPRUCE')
  // THE CHAIN: room for spruce is 0 -> the well is not held off it, and the lanes' keep is not lifted (the same `room > 0` test)
  const room = name => W.whRoom(layout, 'logs', { full: fullFor(name), standing: () => true }).room
  assert.equal(room('oak_log'), 6); assert.equal(room('spruce_log'), 0)
  assert.equal(Y.wellHold({ room: room('spruce_log') }).hold, false); assert.equal(Y.wellHold({ room: room('oak_log') }).hold, true)
  await killedBy(P('warehouse'), W, 'const v = obs.names?.[name]', 'const v = Object.values(obs.names ?? {})[0]', M => assert.equal(M.whNameRoom(oakFull, 'spruce_log'), false))
  // A REFUSED DEPOSIT (the cobble cap, a stock target: slots stand empty, the admission says no): the column was asked and took none
  const cob = W.whRows(layout).filter(r => r.kind === 'cobblestone')
  const empty = { size: 27, used: 3, names: { cobblestone: [192, 3] }, at: 1000 }
  const failed = new Map()
  const cobFull = now => W.whFullFor(cob, 'cobblestone', { obsOf: () => empty, failed, now })
  assert.equal(cobFull(5000).size, 0, 'positive control: empty slots, nothing failed -- room')
  for (const r of cob) W.whFailUpdate(failed, r.k, ['cobblestone'], new Set(), 5000)
  assert.equal(cobFull(6000).size, 6, 'asked, took none: no room for this bot')
  assert.equal(W.whRoom(layout, 'cobblestone', { full: cobFull(6000), standing: () => true }).room, 0)
  assert.equal(cobFull(5000 + W.WH_FAIL_MS + 1).size, 0, 'the mark lapses')
  // an observation made AFTER the failure wins (another bot drew from it); a later success clears the mark
  assert.equal(W.whFullFor(cob, 'cobblestone', { obsOf: () => ({ ...empty, at: 5500 }), failed, now: 6000 }).size, 0)
  W.whFailUpdate(failed, cob[0].k, ['cobblestone'], new Set(['cobblestone']), 6000)
  assert.equal(cobFull(6000).has(cob[0].k), false)
  await killedBy(P('warehouse'), W, "if (whNameRoom(obs, name, stackOf) === false || mine) out.add(r.k)", 'if (whNameRoom(obs, name, stackOf) === false) out.add(r.k)', M => { const fm = new Map(); for (const r of cob) M.whFailUpdate(fm, r.k, ['cobblestone'], new Set(), 5000); assert.equal(M.whFullFor(cob, 'cobblestone', { obsOf: () => empty, failed: fm, now: 6000 }).size, 6) })
})

await t('THE ROOM BANK STAYS OR WALKS BY WHAT TAKES THE BAG: another kind\'s column in reach is no chest in reach (Codex r1 blocker 3)', async () => {
  const kindOf = n => W.whSectionOf(n, H.hubSectionOf(n))
  const names = ['spruce_log', 'gravel']
  assert.equal(W.whEligible('parts', names, kindOf), false, 'a parts column takes none of this bag')
  assert.equal(W.whEligible('logs', names, kindOf), true, 'positive control: its own column')
  assert.equal(W.whEligible('logs', names, kindOf, n => n === 'spruce_log'), false, 'its own column, full for the item')
  assert.equal(W.whEligible('overflow', names, kindOf, n => n === 'spruce_log'), true, 'the overflow still takes the gravel')
  assert.equal(W.whEligible('overflow', names, kindOf, () => true), false)
  assert.equal(W.whEligible(null, names, kindOf, () => true), true, 'a chest that is no column: as before')
  assert.equal(W.whEligible('logs', [], kindOf), false, 'nothing to bank')
  await killedBy(P('warehouse'), W, "return names.some(n => (kind === 'overflow' || kindOf(n) === kind) && !full(n))", 'return true', M => assert.equal(M.whEligible('parts', names, kindOf), false))
})

await t('A FULL MIXED HALL IS NEVER STUCK: with no ordinary move the clerk stages one stack, and the hall sorts itself out (Codex r1 blocker 4)', async () => {
  const { layout } = wing()
  const homes = W.whHomes(layout)
  const cols = kind => layout.columns.filter(c => c.kind === kind)
  const keysOf = c => c.chests.map(a => a.join(','))
  const build = () => {
    const e = {}
    for (const c of cols('logs')) for (const k of keysOf(c)) e[k] = { size: 27, used: 27, names: { cobblestone_wall: [27 * 64, 27] } }      // parts, in the logs columns
    cols('parts').forEach((c, i) => { for (const k of keysOf(c)) e[k] = { size: 27, used: 27, names: i < 2 ? { spruce_log: [27 * 64, 27] } : { cobblestone_wall: [27 * 64, 27] } } })   // logs in two parts columns
    for (const c of cols('overflow')) for (const k of keysOf(c)) e[k] = { size: 27, used: 27, names: { rotten_flesh: [27 * 64, 27] } }
    for (const c of cols('cobblestone')) for (const k of keysOf(c)) e[k] = { size: 27, used: 27, names: { cobblestone: [27 * 64, 27] } }
    const k0 = keysOf(cols('cobblestone')[0])[0]
    e[k0] = { size: 27, used: 26, names: { cobblestone: [26 * 64, 26] } }   // ONE free slot in the whole hall, in an unrelated column
    return e
  }
  const kindOf = n => W.whSectionOf(n, H.hubSectionOf(n))
  const misplaced = e => Object.entries(e).reduce((t, [k, v]) => t + Object.entries(v.names).filter(([n, x]) => x[1] > 0 && homes.byKey.get(k).section !== 'overflow' && kindOf(n) !== homes.byKey.get(k).section).reduce((a, [, x]) => a + x[1], 0), 0)
  const opts = { hubKeys: new Set(homes.byKey.keys()), sources: new Set(), stackable: () => true, well: false, sectionOf: W.whSectionOf }
  const run = (M, stage) => {
    const e = build()
    let n = 0, stages = 0
    for (; n < 3000; n++) {
      const p = M.clerkMoves(homes, e, { ...opts, stage })
      if (!p) break
      for (const m of p.moves) {
        if (m.why === 'stage') stages++
        const s = e[p.from].names[m.name]; s[0] -= m.count; s[1] -= m.slots; e[p.from].used -= m.slots; if (s[1] <= 0) delete e[p.from].names[m.name]
        const d = (e[m.to].names[m.name] ??= [0, 0]); d[0] += m.count; d[1] += m.slots; e[m.to].used += m.slots
        assert.ok(e[m.to].used <= 27 && e[p.from].used >= 0, 'never past a chest\'s slots')
      }
    }
    return { left: misplaced(e), n, stages }
  }
  assert.equal(misplaced(build()), 2 * 3 * 27 * 2, 'positive control: 324 misplaced slots at the start')
  assert.equal(H.clerkMoves(homes, build(), opts), null, 'release 2\'s clerk has no plan for this hall: the dead end')
  const r = run(H, true)
  assert.equal(r.left, 0, `every stack ends in its own column (${r.n} plans, ${r.stages} staged)`)
  assert.ok(r.n < 3000 && r.stages >= 1, 'it terminates, and the stage was what opened it')
  await killedBy(P('storehub'), H, '  if (stage) {\n    const owner = k =>', '  if (false) {\n    const owner = k =>', M => assert.equal(run(M, true).left, 0))
  // Codex r2 blocker E: ONE WHOLE STACK'S WORTH, never the average -- a 64 and a 1 of the same name: 64 are taken (a slot is freed)
  const e3 = build(); const kL = keysOf(cols('logs')[0])[0]; e3[kL] = { size: 27, used: 27, names: { cobblestone_wall: [25 * 64, 25], lantern: [65, 2] } }
  for (const k of Object.keys(e3)) if (k !== kL && e3[k].names.cobblestone_wall && homes.byKey.get(k).section === 'logs') e3[k].names = { spruce_log: [27 * 64, 27] }   // only kL holds misplaced stacks among the logs chests
  const st = H.clerkMoves(homes, e3, { ...opts, stage: true, stackOf: () => 64 })
  assert.equal(st.moves[0].why, 'stage'); assert.equal(st.moves[0].name, 'lantern', 'the fewest slots first'); assert.equal(st.moves[0].count, 64, 'a whole stack\'s worth of the 65, not 32')
  await killedBy(P('storehub'), H, 'const count = Math.min(m.count, Math.max(1, Number(stackOf(m.name)) || 64))', 'const count = Math.floor(m.count / m.slots)', M => assert.equal(M.clerkMoves(homes, e3, { ...opts, stage: true, stackOf: () => 64 }).moves[0].count, 64))
  // never a stage while an ordinary move exists, never a stack that is where it belongs
  const e2 = build(); e2[keysOf(cols('parts')[0])[0]].used = 26; e2[keysOf(cols('parts')[0])[0]].names.spruce_log = [26 * 64, 26]
  assert.notEqual(H.clerkMoves(homes, e2, { ...opts, stage: true }).moves[0].why, 'stage', 'a free slot in the stack\'s own home: the ordinary move')
})

await t('A KIND HELD FOR ITS COLUMN IS A KIND THE DEPOSIT PLANS (Paper rig defect A: dirt, gravel and andesite sat in the bag -- the column had room, the deposit never asked)', async () => {
  const stacks = name => [0, 1, 2, 3, 4].map(i => ({ name, count: 64, slot: 9 + i, stackSize: 64 }))
  const plans = (name, columns) => TD.townDepositPlan(stacks(name), { columns }).steps.filter(st => st.name === name)
  // positive control, the dead end as the rig saw it: without the column layer the deposit plans none of these
  for (const n of ['dirt', 'gravel', 'andesite', 'diorite', 'granite']) assert.equal(plans(n, null).length, 0, `${n}: the base plan never banks it`)
  // THE INVARIANT: every lane kind, every row kind, and the well's junk that has a column -- "its column has room" => "a deposit plans it"
  const names = [...new Set([...Y.LANE_KINDS, 'wheat_seeds', 'sugar_cane', 'stick', 'oak_sapling', 'iron_nugget', 'clay_ball', 'snowball', 'flint', 'sand', 'tuff', 'stone', 'deepslate', 'coarse_dirt'])]
  let checked = 0
  for (const n of names) {
    const kind = W.whKindOf(n)
    if (!kind || !TD.columnBankable(n)) continue
    if (TD.CAP_COBBLE.includes(n)) { assert.ok(plans(n, null).length > 0, `${n}: the base plan banks it (under the town's cap)`); checked++; continue }
    const p = plans(n, x => x === n)
    assert.ok(p.length > 0, `${n} (column ${kind}): a deposit plans it`)
    checked++
  }
  assert.ok(checked >= 15, `the invariant was checked for ${checked} names`)
  // only what has room, only above the keeps, never the kit, never under a tail run
  assert.equal(plans('dirt', () => false).length, 0, 'no room in its column: not planned (the piles and the well take it, as before)')
  assert.ok(plans('dirt', () => true).every(st => st.column === true))
  assert.equal(TD.columnBankable('iron_pickaxe'), false); assert.equal(TD.columnBankable('bread'), false); assert.equal(TD.columnBankable('dirt'), true)
  assert.equal(TD.townDepositPlan(stacks('dirt'), { columns: () => true, tail: 'only' }).steps.filter(st => st.name === 'dirt').length, 0)
  assert.equal(TD.townDepositPlan(stacks('dirt'), { columns: () => true, roomExclude: new Set(['dirt']), room: true }).steps.filter(st => st.name === 'dirt').length, 0, 'a build\'s drawn share is never banked')
  await killedBy(P('towndeposit'), TD, "  if (typeof columns === 'function' && baseOn && !tail) {", '  if (false) {', M => assert.ok(M.townDepositPlan(stacks('gravel'), { columns: () => true }).steps.some(st => st.name === 'gravel')))
  // the hold and the keep read the same predicate (skills.mjs whRoomNow): a name the layer never plans has no column room
  const src = strip(readFileSync(P('skills'), 'utf8'))
  one(src, 'const kind = columnBankable\\(name\\) \\? whKindOf\\(name\\) : null', 'the room counts only for a name the deposit plans')
  one(src, 'setDepositColumns\\(WAREHOUSE\\.on \\? name => \\{ const b = activeMem\\?\\.bot \\?\\? null; return !!b && whRoomNow\\(b, name\\)\\?\\.room > 0 \\} : null\\)', 'the deposit reads the same room')
  one(src, '\\} else if \\(columnNames\\.has\\(step\\.name\\)\\) \\{', 'a column stack asks no stock-target claim')
})

await t('REFUSED COLUMNS ARE NO TRIES (Paper rig defect B: two cobblestone columns refused at the cap, the logs column never opened)', async () => {
  const failed = new Map()
  // the first deposit: both cobblestone columns are opened and take nothing -- each reads `full`, so the run still has its tries
  const tried = [{ at: 'A', result: W.whTryResult('none', true, false) }, { at: 'B', result: W.whTryResult('none', true, false) }]
  assert.deepEqual(tried.map(x => x.result), ['full', 'full'])
  assert.equal(TD.tdMoreContainers(tried), true, 'the logs column is still opened')
  assert.equal(TD.tdMoreContainers([{ result: 'none' }, { result: 'none' }]), false, 'positive control: two plain `none` tries end a run')
  assert.equal(W.whTryResult('none', false, false), 'none', 'a chest that is no column: as before'); assert.equal(W.whTryResult('took', true, true), 'took'); assert.equal(W.whTryResult('unverified', true, false), 'unverified')
  // the next deposit: both are marked for cobblestone -- passed without an open
  W.whFailUpdate(failed, 'A', ['cobblestone'], new Set(), 1000); W.whFailUpdate(failed, 'B', ['cobblestone'], new Set(), 1000)
  assert.equal(W.whAllFailed(failed, 'A', ['cobblestone'], 2000), true); assert.equal(W.whAllFailed(failed, 'A', ['cobblestone', 'cobbled_deepslate'], 2000), false, 'another name it may still take: opened')
  assert.equal(W.whAllFailed(failed, 'C', ['oak_log'], 2000), false); assert.equal(W.whAllFailed(failed, 'A', ['cobblestone'], 1000 + W.WH_FAIL_MS + 1), false, 'the mark lapses')
  assert.equal(W.whAllFailed(undefined, 'A', ['cobblestone'], 2000), false)
  await killedBy(P('warehouse'), W, "export const whTryResult = (result, column, took) => (column && !took && result === 'none' ? 'full' : result)", 'export const whTryResult = (result, column, took) => result', M => assert.equal(TD.tdMoreContainers([{ result: M.whTryResult('none', true, false) }, { result: M.whTryResult('none', true, false) }]), true))
  const src = strip(readFileSync(P('skills'), 'utf8'))
  one(src, 'if \\(whK && whAllFailed\\(bot\\.whFail, at, whAsk\\)\\) continue', 'a marked column is passed')
  one(src, 'tried\\[tried\\.length - 1\\]\\.result = whTryResult\\(tried\\[tried\\.length - 1\\]\\.result, !!whK, v\\.verified\\.length > 0\\)', 'a column that took nothing is no try')
})

await t('WAREHOUSE=off is release 2; the label is the pool\'s record', () => {
  // rc2: THE COLUMNS ARE DARK BY DEFAULT -- unset is release 2; only WAREHOUSE=hall turns the old hall's columns on
  assert.equal(W.warehouseOn({}), false); assert.equal(W.warehouseMode({}), 'auto'); assert.equal(W.WAREHOUSE.on, false, 'this process: no WAREHOUSE set')
  assert.equal(W.warehouseOn({ WAREHOUSE: 'hall' }), true); assert.equal(W.warehouseMode({ WAREHOUSE: ' HALL ' }), 'hall')
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) { assert.equal(W.warehouseOn({ WAREHOUSE: v }), false); assert.equal(W.warehouseMode({ WAREHOUSE: v }), 'off') }
  for (const v of ['on', '1', 'true', 'yes', 'x']) { assert.equal(W.warehouseOn({ WAREHOUSE: v }), false, `${v}: not the hall's layout`); assert.equal(W.warehouseMode({ WAREHOUSE: v }), 'auto') }
  const d = W.whHallDesign()
  const r = W.whRecord(d.layout, { now: 5 })
  assert.equal(r.columns.length, 18); assert.deepEqual(Object.keys(r.columns[0]).sort(), ['chests', 'col', 'kind', 'section', 'stand'])
  assert.match(W.warehouseModeDetail(true, d.layout), /^on=1 mode=auto v=1 layout=storehub columns=18 chests=18 hall_access=ok /)
  // the wall signs: a short label a kind, never cut (rig: "COBBLED DEEPSLA")
  for (const kind of Object.keys(W.WH_USES)) { const l = W.whLabel(kind); assert.ok(l.length >= 1 && l.length <= 4 && l.every(x => x.length >= 1 && x.length <= 15), `${kind}: ${l.join('|')}`) }
  assert.deepEqual(W.whLabel('cobbled_deepslate'), ['COBBLED', 'DEEPSLATE'])
  // the proof's lid rule is the bot's (lidrule.mjs): glass over the top chest opens it, a solid block does not
  const g = wing()
  const glassAt = (x, y, z) => (x === 0 || x === 4) && z % 2 === 1 && y === 4
  const roofed = { ...g, open: (x, y, z) => g.open(x, y, z) && !glassAt(x, y, z) }
  assert.ok(W.whAccess(roofed).fails.some(f => /a solid block is over it/.test(f)), 'positive control: a roof the proof takes for solid')
  assert.deepEqual(W.whAccess({ ...roofed, lid: glassAt }).fails, [], 'glass over the top chests: every tier opens')
  assert.ok(W.whAccess({ ...roofed, lid: glassAt, blocked: (x, y, z) => x === 0 && z === 1 && y === 4 }).fails.length > 0, 'a block set on that cell still fails it')
})

await t('wiring: the deposit, the room bank, the yard\'s room, the well\'s hold, the clerk and the label read the columns', () => {
  const src = strip(readFileSync(P('skills'), 'utf8'))
  one(src, 'if \\(!WAREHOUSE\\.on \\|\\| !HUB\\.on\\) return null', 'the switch gates the layout')
  one(src, 'const whList = whKinds \\? whDepositOrder\\(', 'the deposit\'s order')
  one(src, 'for \\(const c0 of whList\\) \\{', 'the deposit walks the ordered list')
  one(src, 'const accept = whK \\? n => whTakes\\(whK, n, hubSectionOf\\(n\\)\\) : sortH \\?', 'a column takes its kind only')
  one(src, 'const keep = roomTarget\\(own\\) \\? own : ok; cands\\.length = 0', 'the room bank prefers the bag\'s columns')
  one(src, 'const w = whRoomNow\\(bot, name, now\\)\\n  const room = k\\.room \\+ \\(w\\?\\.room \\?\\? 0\\)', 'kindRoom reads the columns')
  one(src, 'if \\(w\\?\\.room > 0\\) return wellHold\\(\\{ room: w\\.room \\}\\)\\.hold', 'WELL_HOLD follows')
  one(src, 'if \\(!clearActive\\(BAGFIX\\) && whRoomNow\\(bot, name\\)\\?\\.room > 0\\) \\{ out\\[name\\] = Infinity; continue \\}', 'the lanes are second')
  one(src, 'fs\\.writeFileSync\\(tmp, JSON\\.stringify\\(want\\)\\); fs\\.renameSync\\(tmp, f\\)', 'the pool\'s record is written')
  one(src, "kind: 'warehouse', status: 'success', snapshot: snapshot\\(bot\\), detail: `op=mode ", 'the licence row')
  one(src, 'if \\(whK\\) \\{ whFailUpdate\\(\\(bot\\.whFail \\?\\?= new Map\\(\\)\\), at, whAsk, ', 'a column that took none of a name is marked')
  one(src, 'inReach = roomInReach\\(bot\\)', 'the room bank visit\'s reach is the eligible chests\'')
  one(src, "const refused = isCobble\\(name\\) && whCobbleAtCap\\(bot\\)", 'the cobble cap is part of the room')
  one(src, 'sectionOf: hubSectNow\\(\\), stage: !!hubSectNow\\(\\), stackOf: n => mergeStackOf\\(bot, n\\) \\}\\)', 'the clerk may stage, a whole stack')
  one(src, "backoff\\(f\\.src, rest\\.filter\\(n => routes\\.get\\(n\\)\\?\\.why !== 'stage'\\)\\)", 'a failed stage is never backed off')
  one(src, 'for \\(const n of Object\\.keys\\(owed\\)\\) \\{ const r0 = bot\\.hubCargoTo\\?\\.\\[n\\]; if \\(r0\\) routes\\.set\\(n, r0\\) \\}', 'owed cargo keeps its planned target')
  one(src, 'bot\\.hubCargoTo = whCargoRoutes\\(plan\\.moves\\)', 'only a stage move\'s target is saved')
  // Codex r3: WITH NO STAGE THE CLERK IS RELEASE 2'S -- an ordinary move's target is never saved (the recovery works the order out again)
  assert.deepEqual(W.whCargoRoutes([{ name: 'spruce_log', slots: 2, count: 128, to: '1,2,3', section: 'wood', why: 'sorted' }, { name: 'egg', to: 'well', why: 'junk' }]), {})
  assert.deepEqual(W.whCargoRoutes([{ name: 'diamond', slots: 1, count: 5, to: '4,5,6', section: 'valuables', why: 'stage' }, { name: 'coal', to: '7,8,9', section: 'valuables', why: 'sorted' }]), { diamond: { name: 'diamond', to: '4,5,6', section: 'valuables', why: 'stage' } })
  one(src, 'const signVisit = !!whLayoutNow\\(\\) && f\\.signs \\+ f\\.signFails > 0', 'labels and the clerk never share a visit')
  one(src, 'if \\(\\(HUB\\.clerk \\|\\| owes\\) && \\(owes \\|\\| !signVisit\\) && deadline - Date\\.now\\(\\) > 40_000\\) f\\.moved', 'the clerk plans in its own visit')
})

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
