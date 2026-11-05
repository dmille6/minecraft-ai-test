// STUCKCELLS-01 (fleetstatus 11-01 21:43Z): THE CELLS A WHOLE PROJECT WAITS ON, each case read from a read-only copy of its town's
// region files (bots/src/stuckcells.mjs has the list). Tested by what the code DOES, on the fake server (test/helpers/buildfake.mjs)
// and the stair fake; each remedy killed by a mutant whose anchor is asserted present and unique; each control is the live stop.
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const SC = await import('../src/stuckcells.mjs')
const GEO = await import('../src/shaftgeom.mjs')
const { runStairVisit } = await import('../src/shaftvisit.mjs')
const { replaceableCell } = await import('../src/townplan.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const k = a => a.join(',')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/** The scenario passes on the real module; the mutant fails the scenario's OWN assertion. */
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const PAL = { fill: ['cobblestone'], base: ['stone_bricks'], wall: ['oak_planks'], plinth: ['cobblestone'], skin: ['cobblestone'], core: ['cobblestone'] }
const B = n => ({ name: n, boundingBox: /^(air|cave_air|water|short_grass|snow|torch)$/.test(n) ? 'empty' : 'block' })

// ---- 1. the snow read (hive-d's workshop: `earth: 4 open, 0 placeable now` for 98 h) ------------------------------------------
console.log('THE SNOW READ')
await t('readBlock carries a snow layer\'s properties (layers=1 is replaceable); STUCKCELLS=off drops them, as the live read did', () => {
  const blk = { name: 'snow', boundingBox: 'empty', getProperties: () => ({ layers: 1 }) }
  const on = SC.readBlock(blk, true), off = SC.readBlock(blk, false)
  assert.deepStrictEqual(on, { name: 'snow', boundingBox: 'empty', props: { layers: 1 } })
  assert.strictEqual(replaceableCell(on), true, 'a single layer takes a placement')
  assert.strictEqual(replaceableCell(off), false, 'CONTROL: without its properties the layer reads unplaceable (the live 98 h)')
  assert.deepStrictEqual(SC.readBlock({ name: 'stone', boundingBox: 'block', getProperties: () => { throw new Error('never asked') } }, true), { name: 'stone', boundingBox: 'block' })
  assert.strictEqual(SC.readBlock(null), null)
})
await t('wiring: the visit\'s read (buildbot.mjs) is readBlock', () => {
  const src = strip(readFileSync(new URL('../src/buildbot.mjs', import.meta.url), 'utf8'))
  assert.strictEqual(src.split('const read = (x, y, z) => readBlock(bot.blockAt(new Vec3(x, y, z)))').length, 2)
})
await t('an earth cell under ONE snow layer is placed (with the layer\'s properties) and the visit stops blocked without them', async () => {
  const run = async withProps => {
    const srv = server()
    const read0 = srv.read
    const read = (x, y, z) => { const b = read0(x, y, z); return b?.name === 'snow' ? (withProps ? { ...b, props: { layers: 1 } } : { name: b.name, boundingBox: b.boundingBox }) : b }
    const at = [10, G + 1, 10]
    srv.set(at, 'snow')
    const rec = { v: 1, plot: 'shop', cells: [{ at, role: 'fill', seg: 'earth' }], clear: [], replant: [], segments: [{ seg: 'earth', deps: [] }] }
    const pr = projectOf(rec), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
    e.read = read
    const send = e.send
    e.send = (s, f, q) => { const tg = s.map((v, i) => v + f[i]); if (srv.read(...tg)?.name === 'snow') srv.set(tg, 'air'); send(s, f, q) }   // vanilla: the layer is replaced
    return (await R.runVisit(pr.p('A', { domain: () => true, walkR: 40 }), e, { maxSteps: 200 })).stop
  }
  assert.strictEqual(await run(true), 'complete')
  assert.strictEqual(await run(false), 'blocked', 'CONTROL: the live stop')
})

// ---- 2. the sealed pocket (board-a house1 327,66,151; board-d shop 353,66,118) --------------------------------------------------
console.log('THE SEALED POCKET')
const pocketWorld = (over = {}) => (x, y, z) => {
  const kk = `${x},${y},${z}`
  if (kk in over) return over[kk] == null ? null : B(over[kk])
  return B(kk === '0,0,0' ? 'air' : 'stone')
}
await t('a fill or base cell sealed on all six faces by full non-leaf blocks is done; a leaf, an open face, an unread face, a wall role are not', () => {
  const c = { at: [0, 0, 0], role: 'base' }
  assert.strictEqual(SC.sealedPocket(c, pocketWorld()), true)
  assert.strictEqual(SC.sealedPocket({ ...c, role: 'fill' }, pocketWorld()), true)
  assert.strictEqual(SC.sealedPocket({ ...c, role: 'wall' }, pocketWorld()), false, 'a wall cell is never left a hole')
  assert.strictEqual(SC.sealedPocket(c, pocketWorld({ '0,1,0': 'oak_leaves' })), false, 'leaves decay: never a seal (zigHidden\'s rule)')
  assert.strictEqual(SC.sealedPocket(c, pocketWorld({ '1,0,0': 'air' })), false, 'an open face: a stand may see it')
  assert.strictEqual(SC.sealedPocket(c, pocketWorld({ '0,-1,0': null })), false, 'an unread face: not known sealed')
  assert.strictEqual(SC.sealedPocket(c, pocketWorld({ '0,0,0': 'stone' })), false, 'a cell holding a block is not a pocket')
})
await t('board-a\'s shape on the fake server: the pad\'s one sealed cell under a placed plank stalls every visit; done with the rule, the walls go on', async () => {
  const scene = () => {
    const srv = server()
    const cells = []
    for (let x = 10; x <= 12; x++) for (let z = 10; z <= 12; z++) { cells.push({ at: [x, G + 1, z], role: 'base', seg: 'pad' }); if (!(x === 11 && z === 11)) srv.set([x, G + 1, z], 'stone_bricks') }
    srv.set([11, G + 2, 11], 'oak_planks')        // the wall cell over it, placed
    cells.push({ at: [11, G + 2, 11], role: 'wall', seg: 'wall' }, { at: [10, G + 2, 10], role: 'wall', seg: 'wall' })
    return { srv, rec: { v: 1, plot: 'house1', cells, clear: [], replant: [], segments: [{ seg: 'pad', deps: [] }, { seg: 'wall', deps: ['pad'] }] } }
  }
  const visit = async opts => { const { srv, rec } = scene(), pr = projectOf(rec), e = bot(srv, 'A', { inv: { stone_bricks: 9, oak_planks: 9 } }); const stops = []; for (let v = 0; v < 3; v++) stops.push((await R.runVisit(pr.p('A', { domain: () => true, walkR: 40, ...opts(rec) }), e, { maxSteps: 200 })).stop); return { stops, srv } }
  const on = await visit(rec => SC.visitOpts(rec, 'shop', null, true))
  assert.strictEqual(on.stops[0], 'complete', on.stops.join(','))
  assert.strictEqual(on.srv.read(10, G + 2, 10).name, 'oak_planks', 'the wall above the pad was built')
  const off = await visit(() => ({}))
  assert.deepStrictEqual(off.stops, ['cell_deferred', 'cell_deferred', 'stuck_on_cell'], 'CONTROL: the live stall')
})

// ---- 3. the waiver (isolated-b 377,69,121 / 381,69,119; placebo-a's 1x1 hole 203,60..66,-205) -------------------------------
console.log('THE WAIVER')
const cellAt = cells => { const m = new Map(cells.map(c => [k(c.at), c])); return kk => m.get(kk) ?? null }
await t('waivePick: due at WAIVE_AFTER visits counting this one; the chain over a waived cell of the same segment; the bound; mayWaive', () => {
  const a = { at: [0, 0, 0], role: 'fill', seg: 'earth' }, b = { at: [0, 1, 0], role: 'fill', seg: 'earth' }, p = { at: [0, 2, 0], role: 'base', seg: 'pad' }
  const at = cellAt([a, b, p])
  const may = SC.shopMayWaive
  assert.deepStrictEqual(SC.waivePick([a], { counts: { '0,0,0': { visits: 2 } }, room: 6, mayWaive: may, cellAt: at }).map(d => k(d.c.at)), ['0,0,0'])
  assert.deepStrictEqual(SC.waivePick([a], { counts: { '0,0,0': { visits: 1 } }, room: 6, mayWaive: may, cellAt: at }), [], 'CONTROL: one visit short')
  assert.deepStrictEqual(SC.waivePick([b], { waived: kk => kk === '0,0,0', room: 6, mayWaive: may, cellAt: at }).map(d => d.why), ['no_stand over waived 0,0,0'])
  assert.deepStrictEqual(SC.waivePick([p], { waived: kk => kk === '0,1,0', counts: { '0,2,0': { visits: 9 } }, room: 6, mayWaive: may, cellAt: at }), [], 'a pad cell: never waived (a hole in the floor)')
  assert.deepStrictEqual(SC.waivePick([a], { counts: { '0,0,0': { visits: 9 } }, room: 0, mayWaive: may, cellAt: at }), [], 'the record\'s bound')
  assert.strictEqual(SC.zigMayWaive({ seg: 'F-N', role: 'plinth' }), true)
  assert.strictEqual(SC.zigMayWaive({ seg: 'L03-E', role: 'core' }), true)
  assert.strictEqual(SC.zigMayWaive({ seg: 'L03-E', role: 'skin' }), false, 'the ziggurat\'s skin is never left a hole')
})
// placebo-a's shape: a 1x1 hole HOLE deep through ground; its record cells are the whole column (foundation), the next layer over it
const HOLE = 6
function holeScene () {
  const srv = server()
  const cells = []
  for (let i = 0; i < HOLE; i++) { const y = G - HOLE + 1 + i; srv.set([10, y, 10], 'air'); cells.push({ at: [10, y, 10], role: 'plinth', seg: 'F-N' }) }
  cells.push({ at: [10, G + 1, 10], role: 'skin', seg: 'L00-N' }, { at: [11, G + 1, 10], role: 'skin', seg: 'L00-N' })
  return { srv, rec: { v: 1, plot: 'monument', cells, clear: [], replant: [], segments: [{ seg: 'F-N', deps: [] }, { seg: 'L00-N', deps: ['F-N'] }] } }
}
const holeRun = async (M, opts, visits = R.STUCK_VISITS + 1) => {
  const { srv, rec } = holeScene(), pr = projectOf(rec, 'monument')
  let cur = rec
  const e = bot(srv, 'A', { inv: { cobblestone: 64 } })
  const stops = []
  for (let v = 0; v < visits; v++) {
    const r = await M.runVisit({ ...pr.p('A', { domain: () => true, walkR: 40, ...opts(cur) }), record: cur }, e, { maxSteps: 300 })
    stops.push(r.stop)
    if (r.waived?.length) cur = SC.withWaived(cur, r.waived, { cells: cur.cells.length, now: 1, by: 'A' }) ?? cur
    if (r.stop === 'complete') break
  }
  return { srv, cur, e, stops }
}
await t('the hole: its bottom cell waived after WAIVE_AFTER visits, the chain up it in the same visit, the top cell PLACED, the next layer built', async () => {
  const scenario = async M => {
    const { srv, cur, e, stops } = await holeRun(M, c => SC.visitOpts(c, 'zig', null, true))
    assert.strictEqual(stops.at(-1), 'complete', stops.join(','))
    const waived = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'waived').map(([, d]) => d.cell[1])
    assert.ok(waived.length >= 1 && waived.length <= HOLE - 1, `waived ${waived}`)
    assert.strictEqual(srv.read(10, G, 10).name, 'cobblestone', 'the hole\'s top is placed (a stand sees it): never waived')
    assert.strictEqual(srv.read(11, G + 1, 10).name, 'cobblestone', 'the layer over it is built')
    assert.strictEqual(Object.keys(cur.waived).length, waived.length, 'the record names every waived cell')
  }
  await killedBy('          if (p.waive && cand.length && (monuStuckOn() ? open.every(c => isClear(c.at) || sealed.has(kOf(c.at))) : !open.some(c => !isClear(c.at)))) {', '          if (false) {', scenario)   // monustuck-01 re-anchored
})
await t('CONTROL (no waiver, the live stall): deferred, stuck_on_cell, the layer never starts', async () => {
  const { srv, stops } = await holeRun(R, () => ({}))
  assert.deepStrictEqual(stops.slice(0, R.STUCK_VISITS), [...Array(R.STUCK_VISITS - 1).fill('cell_deferred'), 'stuck_on_cell'])
  assert.strictEqual(srv.read(11, G + 1, 10).name, 'air')
})
await t('the chain is killed by its own mutant: without it each cell up the hole waits WAIVE_AFTER more visits', async () => {
  const scenario = async M => {
    const { stops } = await holeRun(M, c => SC.visitOpts(c, 'zig', null, true), R.STUCK_VISITS)
    assert.strictEqual(stops.at(-1), 'complete', `the chain finishes the hole in the visit the bottom is waived (${stops})`)
  }
  await scenario(R)
  const src = readFileSync(new URL('../src/stuckcells.mjs', import.meta.url), 'utf8')
  const old = '    else if (chained) out.push({ c, why: `no_stand over waived ${belowK}` })'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-sc.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '    else if (false) out.push({ c })'))
  let why = null
  try {
    // runVisit with ITS import of the waiver's pick pointed at the mutant (withMutant: anchor present and unique)
    await withMutant("import { waivePick, monuStuckOn, hardDeferrals } from './stuckcells.mjs'", `import { waivePick, monuStuckOn, hardDeferrals } from '${out.href}'`, async M => { try { await scenario(M) } catch (err) { why = err } })
  } finally { try { unlinkSync(out) } catch {} }
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
})
await t('withWaived: merged, only record cells, never past the record\'s bound, never on a complete record or a changed cell count; the completion merges them', () => {
  const rec = { cells: [{ at: [0, 0, 1] }, { at: [0, 0, 2] }, { at: [0, 0, 3] }], waived: { '0,0,1': { why: 'x' } } }
  assert.deepStrictEqual(Object.keys(SC.withWaived(rec, [{ k: '0,0,2', why: 'y' }], { cells: 3 }).waived), ['0,0,1', '0,0,2'])
  assert.strictEqual(SC.withWaived(rec, [{ k: '0,0,1' }], { cells: 3 }), null, 'nothing new')
  assert.strictEqual(SC.withWaived(rec, [{ k: '9,9,9' }], { cells: 3 }), null, 'not a record cell')
  assert.deepStrictEqual(Object.keys(SC.withWaived(rec, [{ k: '0,0,2' }, { k: '0,0,3' }], { cells: 3, max: 2 }).waived), ['0,0,1', '0,0,2'], 'the bound is the record\'s')
  assert.strictEqual(SC.withWaived({ ...rec, structure_complete: true }, [{ k: '0,0,2' }]), null)
  assert.strictEqual(SC.withWaived(rec, [{ k: '0,0,2' }], { cells: 4 }), null)
  assert.deepStrictEqual(Object.keys(SC.completeWithWaived(rec, [{ k: '0,0,3' }], { cells: 3 }).waived), ['0,0,1', '0,0,3'], 'the completion carries the visit\'s waivers (Claude r1)')
  assert.strictEqual(SC.completeWithWaived(rec, [], {}), rec)
  assert.strictEqual(SC.visitOpts({ cells: [], structure_complete: true }, 'shop', null, true).waive, undefined, 'never a waiver on a complete record\'s repair (Codex r1 BLOCK)')
  assert.ok(SC.visitOpts({ cells: [] }, 'shop', null, true).waive, 'positive control: an open record has one')
})
await t('stampLiftable: a stamp on cells all done or due their waiver is lifted; one cell neither, no room, or a cell not CLEAR (Claude r1 BLOCK) holds', () => {
  const rec = { cells: [{ at: [0, 0, 0], role: 'fill', seg: 'earth' }, { at: [1, 0, 0], role: 'base', seg: 'pad' }] }
  const o = { counts: { '0,0,0': { visits: 5 } }, mayWaive: SC.shopMayWaive, max: 6, clear: () => true }
  assert.strictEqual(SC.stampLiftable(['0,0,0'], rec, { ...o, clear: () => false }), false, 'a blocked or sealed cell: the visit cannot waive it, the stamp holds')
  assert.strictEqual(SC.stampLiftable(['0,0,0'], rec, o), true)
  assert.strictEqual(SC.stampLiftable(['0,0,0', '1,0,0'], rec, o), false, 'a pad cell holds')
  assert.strictEqual(SC.stampLiftable(['0,0,0', '1,0,0'], rec, { ...o, done: c => c.role === 'base' }), true)
  assert.strictEqual(SC.stampLiftable(['0,0,0'], rec, { ...o, max: 0 }), false)
  assert.strictEqual(SC.stampLiftable(['0,0,0'], rec, { ...o, counts: {} }), false, 'CONTROL: not due yet')
})

// ---- 4. a blocked cell is deferred (hive-d's stair waited 20 h behind the blocked workshop) -----------------------------------
console.log('A BLOCKED CELL IS DEFERRED')
const blockedScene = () => {
  const srv = server()
  srv.set([10, G + 1, 10], 'chest')
  // a pad cell (a chest is no stone brick: never done; a FILL cell would read done -- any solid fills)
  return { srv, rec: { v: 1, plot: 'shop', cells: [{ at: [10, G + 1, 10], role: 'base', seg: 'pad' }, { at: [11, G + 1, 10], role: 'base', seg: 'pad' }], clear: [], replant: [], segments: [{ seg: 'pad', deps: [] }] } }
}
await t('a cell holding a block the visit may not dig is DEFERRED (counted to stuck_on_cell, the town\'s other projects go on), never `blocked` for good', async () => {
  const scenario = async M => {
    const { srv, rec } = blockedScene(), pr = projectOf(rec), e = bot(srv, 'A', { inv: { stone_bricks: 8 } })
    const stops = []
    for (let v = 0; v < R.STUCK_VISITS; v++) stops.push((await M.runVisit(pr.p('A', { domain: () => true, walkR: 40, ...SC.visitOpts(rec, 'shop', null, true) }), e, { maxSteps: 200 })).stop)
    assert.deepStrictEqual(stops, [...Array(R.STUCK_VISITS - 1).fill('cell_deferred'), 'stuck_on_cell'])
    assert.strictEqual(srv.read(11, G + 1, 10).name, 'stone_bricks', 'the other cell was placed')
    assert.strictEqual(srv.read(10, G + 1, 10).name, 'chest', 'the chest is never dug')
    assert.ok(PJ.stuckAt(pr.dir, pr.key), 'the project is stamped: stuckBackoff lets the next project go')
  }
  await killedBy('          if (p.blockedDefers && !needSapling && notClear.length && notClear.every(permanent)) {', '          if (false) {', scenario)
})
await t('a TRANSIENT obstruction keeps `blocked` (Codex r1 BLOCK): a diggable foreign block whose dig is refused, with blockedDefers on', async () => {
  const srv = server()
  srv.set([10, G + 1, 10], 'dirt')
  const rec = { v: 1, plot: 'shop', cells: [{ at: [10, G + 1, 10], role: 'base', seg: 'pad' }], clear: [], replant: [], segments: [{ seg: 'pad', deps: [] }] }
  const pr = projectOf(rec), e = bot(srv, 'A', { inv: { stone_bricks: 8 }, dig: async () => 'refused' })
  const stops = []
  for (let v = 0; v < R.STUCK_VISITS; v++) stops.push((await R.runVisit(pr.p('A', { domain: () => true, walkR: 40, ...SC.visitOpts(rec, 'shop', null, true) }), e, { maxSteps: 200 })).stop)
  assert.deepStrictEqual(stops, Array(R.STUCK_VISITS).fill('blocked'), 'retried at once every visit, never stamped')
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key), null)
})
await t('CONTROL (the live behaviour): `blocked` every visit, no stamp', async () => {
  const { srv, rec } = blockedScene(), pr = projectOf(rec), e = bot(srv, 'A', { inv: { stone_bricks: 8 } })
  const stops = []
  for (let v = 0; v < R.STUCK_VISITS; v++) stops.push((await R.runVisit(pr.p('A', { domain: () => true, walkR: 40 }), e, { maxSteps: 200 })).stop)
  assert.deepStrictEqual(stops, Array(R.STUCK_VISITS).fill('blocked'))
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key), null)
})

// ---- 5. the stair's support chain (hive-a 374,68,129; placebo-a's 48 landing in a cave) --------------------------------------
console.log('THE STAIR\'S SUPPORT CHAIN')
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const stairWorld = (g, over = new Map()) => {
  const at = new Map(over)
  const name = (x, y, z) => at.get(`${x},${y},${z}`) ?? (y <= g ? 'stone' : 'air')
  return { at, read: (x, y, z) => B(name(x, y, z)), set: (c, n) => at.set(k(c), n) }
}
await t('supportChain: the shortest chain to a block that stands, every click in reach, never the stair\'s air nor the body; exclude; null past the bound', () => {
  const site = { origin: GEO.originFor(100, 100, 'n'), away: 'n', g: 70, center: [100, 100] }, plan = GEO.planStair(site)
  const w = stairWorld(70)
  const cell = [120, 70, 120], feet = [121, 71, 121]
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 0; dy++) for (let dz = -3; dz <= 3; dz++) w.set([120 + dx, 70 + dy, 120 + dz], 'air')
  w.set([121, 70, 121], 'stone')                                   // the bot's floor
  // the nearest standing block: two below the cell (120,67,120 open; 120,66,120 is the hole's floor? no: open to 67) -> a 2-chain via the floor
  const ch = GEO.supportChain(w.read, plan, cell, feet)
  assert.ok(ch && ch.length >= 1 && ch.length <= GEO.CHAIN_MAX, JSON.stringify(ch))
  const placed = new Set()
  for (const c of ch) {
    assert.ok(!plan.air.has(k(c)) && k(c) !== k(feet) && k(c) !== k([feet[0], feet[1] + 1, feet[2]]))
    assert.ok(N6.some(([a, b, d]) => { const m = [c[0] + a, c[1] + b, c[2] + d]; return placed.has(k(m)) || w.read(...m).boundingBox === 'block' }), `each held when placed: ${k(c)}`)
    placed.add(k(c))
  }
  const last = ch.at(-1)
  assert.strictEqual(Math.abs(last[0] - cell[0]) + Math.abs(last[1] - cell[1]) + Math.abs(last[2] - cell[2]), 1, 'the last is beside the cell')
  const ex = GEO.supportChain(w.read, plan, cell, feet, { exclude: new Set([k(ch[0])]) })
  assert.ok(!ex || !ex.some(c => k(c) === k(ch[0])), 'an excluded cell is never in the next chain')
  const deep = stairWorld(70)
  for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) for (let dz = -6; dz <= 6; dz++) deep.set([120 + dx, 60 + dy, 120 + dz], 'air')
  assert.strictEqual(GEO.supportChain(deep.read, plan, [120, 60, 120], [120, 61, 121]), null, 'POSITIVE CONTROL: deep in open air, nothing within the bound')
})
function fx (w, feet0) {
  let feet = feet0
  const rows = []
  return {
    rows, get read () { return w.read }, feet: () => feet,
    walkTo: async c => { const f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2]), fl = w.read(c[0], c[1] - 1, c[2]); if (f.boundingBox === 'empty' && h.boundingBox === 'empty' && fl.boundingBox === 'block') feet = c; return true },
    dig: async c => { w.set(c, 'air'); return 'confirmed' },
    place: async c => {
      const refs = N6.map(([a, b, d]) => [c[0] + a, c[1] + b, c[2] + d]).filter(r => w.read(...r).boundingBox === 'block')
      if (!refs.length) return 'no_support'
      const eye = [feet[0] + 0.5, feet[1] + 1.62, feet[2] + 0.5]
      if (!refs.some(r => { const f = [c[0] - r[0], c[1] - r[1], c[2] - r[2]]; return Math.hypot(r[0] + 0.5 + f[0] * 0.5 - eye[0], r[1] + 0.5 + f[1] * 0.5 - eye[1], r[2] + 0.5 + f[2] * 0.5 - eye[2]) <= 4.5 })) return 'no_reach'
      w.set(c, 'cobblestone'); return 'confirmed'
    },
    toolOk: () => true, fence: () => true, now: () => 0, aborted: () => false, log: (op, d) => rows.push([op, d]),
  }
}
// a lining cell of step `k` in a CAVE: every cell within 2 of it is air but what the steps above it have built (their treads and
// linings): the single support has nothing to hold it (the old remedy's dead end; hive-a's quarried pocket, placebo-a's cave)
const cave = (plan, w, kk) => {
  const c = plan.steps[kk].lining[0]
  const keep = new Set()
  for (let j = 0; j < kk; j++) for (const q of [plan.steps[j].tread, ...plan.steps[j].lining]) keep.add(k(q))
  for (const l of plan.landings) if (l.k < kk) for (const col of l.cols) for (const q of col.lining) keep.add(k(q))
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) { const m = [c[0] + dx, c[1] + dy, c[2] + dz]; if (!keep.has(k(m))) w.set(m, 'air') }
  return c
}
const stairRec = (site, w) => GEO.stairRecord({ site, K: GEO.planStair(site).K, landings: GEO.planStair(site).landings.map(l => l.feet), lining: 0, digs: 0, stopK: null, exit: GEO.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } })
const stairVisit = async (run, rec, e) => { let r, n = 0; do { r = await run({ rec, exit: rec.exit, built: new Set(), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, e, { unitsMax: 30 }) } while (r.stop === 'units' && ++n < 40); return r }
await t('a stair lining two deep in a cave: the chain is placed (named rows), the stair goes on; STUCKCELLS=off ends `no_support` (the live 31 h)', async () => {
  const site = { origin: GEO.originFor(100, 100, 'n'), away: 'n', g: 70, center: [100, 100] }, plan = GEO.planStair(site)
  const w = stairWorld(70), rec = stairRec(site, w)
  const c = cave(plan, w, 12)
  assert.strictEqual(GEO.supportFor(w.read, plan, c, null), null, 'the cave defeats the single support (the old remedy)')
  const e = fx(w, rec.exit)
  const r = await stairVisit(runStairVisit, rec, e)
  assert.ok(GEO.firstUndone(w.read, plan) === null || GEO.firstUndone(w.read, plan).k > 12, `past step 12 (${r.stop} ${r.why})`)
  assert.ok(e.rows.some(([op, d]) => op === 'place' && /^support/.test(d.why)), 'named support rows')
  const w2 = stairWorld(70), rec2 = stairRec(site, w2)
  cave(plan, w2, 12)
  process.env.STUCKCELLS = 'off'
  try { assert.strictEqual((await stairVisit(runStairVisit, rec2, fx(w2, rec2.exit))).stop, 'no_support', 'CONTROL') } finally { delete process.env.STUCKCELLS }
})
await t('a support the server refuses is NAMED (`support:<result>`) and the next chain is tried', async () => {
  const site = { origin: GEO.originFor(100, 100, 'n'), away: 'n', g: 70, center: [100, 100] }, plan = GEO.planStair(site)
  const w = stairWorld(70), rec = stairRec(site, w)
  const c = cave(plan, w, 12)
  const e = fx(w, rec.exit)
  const first = new Set()
  const place = e.place
  let refused = 0
  e.place = async q => { const ch = GEO.supportChain(w.read, plan, c, e.feet()); if (!refused && ch && k(q) === k(ch[0])) { refused++; first.add(k(q)); return 'refused' } return place(q) }
  await stairVisit(runStairVisit, rec, e)
  assert.ok(e.rows.some(([op, d]) => op === 'refused' && d.why === 'support:refused'), 'the refusal is a row')
  assert.ok(e.rows.some(([op, d]) => op === 'place' && /^support/.test(d.why)), 'another chain was placed')
})

// ---- 6. wiring (comments stripped; executable lines) -------------------------------------------------------------------------
console.log('WIRING')
await t('buildShop and buildMonument pass the options and publish the waivers; the order\'s stale rule; the done rules read the waiver', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const line of ["...stuckVisitOpts(rec, 'shop') }", "...stuckVisitOpts(rec, 'zig', zigHidden, stuckCellsOn(), zigPlaceOk(c)) }", 'stuckCellsPublish(bot, dir, key, rec, r, me, plot)', 'stuckCellsPublish(bot, dir, key, rec, r, me, MONUMENT_PLOT)',
    'return stampLiftable(keys, rec, {', 'if (stuckCellsOn() && recWaived(r, c)) return false']) assert.strictEqual(src.split(line).length, 2, `wired once: ${line}`)
  assert.deepStrictEqual(SC.visitOpts({ cells: [] }, 'shop', null, false), {}, 'STUCKCELLS=off: the visit as before')
})
await t('the offline harnesses are tracked on main (nothing-important-is-orphaned lists them)', () => {
  const src = readFileSync(new URL('./nothing-important-is-orphaned.test.mjs', import.meta.url), 'utf8')
  for (const f of ['bots/src/stuckcells.mjs', 'bots/scripts/stuckcells-offline.mjs', 'bots/scripts/stairstuck-offline.mjs', 'bots/test/stuckcells.test.mjs']) assert.ok(src.includes(f), f)
})

// ---- helpers ------------------------------------------------------------------------------------------------------------------
function projectOf (record, plot = record.plot ?? 'shop') {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/stuckcells-`)
  const key = PJ.projKey(HOME, plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 3)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slots[n].slot, slotGen: slots[n].gen, stands: { pending: null, bans: {} }, blockLayer: false, ...extra }
  }
  return { dir, key, p }
}

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
