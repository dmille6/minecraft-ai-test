// FELLDONE-01 (bots/src/felldone.mjs; skills.mjs buildStepwellRun + projStuckLive). LIVE showcase 11-14 08:32Z: the stepwell's felling
// visit ended `stuck_on_cell segs=stand waiting=5 stalled=true` on five stair cells hanging over the dug pit, with 0 of the record's
// 50 listed logs standing. Here: the pure rules (a tree is gone only when every listed log is READ and not a log; a stand serves its
// own tree; replants never hold a stand), the live-shaped record as a fixture, a placed stand of a gone tree still taken down by the
// tank, and THE CHAIN on the fake server with the real runVisit -- the dead end as the positive control, then the same world with
// the felling view's `alsoDone`. Anchored mutants for the gone test, the unread rule, the per-tree mapping, the stamp and the switch.
// The live-shaped fixture's stands, counts and states are the record's; the tree columns are placed to fit those stands (the
// record's own tree list was not read here).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
const FD = await import('../src/felldone.mjs')
const SW = await import('../src/stepwell.mjs')
const TIDY = await import('../src/tidy.mjs')
const FD_PATH = new URL('../src/felldone.mjs', import.meta.url)

let pass = 0, fail = 0
const FAILED = []   // named again at the end (the suite keeps a failing file's last 40 lines)
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; FAILED.push(`${name} :: ${String(e.message).split('\n')[0].slice(0, 160)}`); console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withFdMutant (old, neu, fn) {
  const src = readFileSync(FD_PATH, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module and THROWS on the mutant (a mutant that passes survived). */
async function killed (old, neu, scenario) {
  await scenario(FD)
  let dead = false
  await withFdMutant(old, neu, async M => { try { await scenario(M) } catch { dead = true } })
  assert.ok(dead, 'the mutant survived')
}
const kOf = a => a.join(',')
const blk = n => (n == null ? null : { name: n, boundingBox: /^(air|cave_air)$|_sapling$/.test(n) ? 'empty' : 'block' })
const logsOf = (i, [x, y, z], top, name = 'spruce_log') => Array.from({ length: top - y + 1 }, (_, d) => ({ at: [x, y + d, z], kind: 'tree', name, tree: i, t: 0 }))

// ---- THE LIVE-SHAPED RECORD: box [-65,-85,-43,-63], five stands, eight trees, 50 listed logs, eight replants all skipped --------
const LIVE_STANDS = [[-55, 68, -75], [-55, 69, -75], [-54, 68, -75], [-53, 68, -77], [-51, 68, -76]]
const LIVE_TREES = [
  { base: [-56, 68, -75], name: 'spruce_log', top: 75 },   // need 2: steps at -55 (two high) and -54
  { base: [-53, 68, -78], name: 'spruce_log', top: 74 },   // need 1: the step at -53,-77
  { base: [-50, 68, -76], name: 'spruce_log', top: 74 },   // need 1: the step at -51,-76
  { base: [-60, 63, -80], name: 'spruce_log', top: 68 }, { base: [-47, 64, -66], name: 'spruce_log', top: 68 }, { base: [-62, 65, -70], name: 'spruce_log', top: 69 },
  { base: [-45, 66, -82], name: 'spruce_log', top: 71 }, { base: [-58, 67, -65], name: 'spruce_log', top: 72 },
]
function liveRec ({ replant = 'skipped' } = {}) {
  const logs = LIVE_TREES.flatMap((tr, i) => logsOf(i, tr.base, tr.top))
  return {
    v: 1, blueprint: SW.STEPWELL_BLUEPRINT, plot: SW.STEPWELL_PLOT, state: 'open', box: [-65, -85, -43, -63],
    site: { stands: LIVE_STANDS, g: 66 },
    cells: [...LIVE_STANDS.map(at => ({ at, role: 'stand', t: 1, seg: SW.FELL_SEG })), { at: [-54, 66, -85], role: 'floor', t: 0 }, { at: [-54, 67, -83], role: 'post', t: 0 }],
    clear: [...logs, { at: [-55, 70, -75], kind: 'leaves', name: 'spruce_leaves', t: 0 }, { at: [-54, 66, -74], kind: 'cut', t: 1 }, { at: [-54, 65, -74], kind: 'cut', t: 1 }],
    trees: LIVE_TREES,
    replant: LIVE_TREES.map((tr, i) => ({ cell: [-30 + i, 68, -40], sapling: 'spruce_sapling', tree: i, ...(replant === 'skipped' ? { state: 'skipped' } : {}) })),
    fellCanopy: { rounds: 2, n: 108, left: 1 },
  }
}
// the saved world: the pit dug to y 60 under the stands, no log anywhere; `over` puts blocks back, `unread` keys read null
const liveRead = (over = {}, unread = new Set()) => (x, y, z) => { const k = `${x},${y},${z}`; if (unread.has(k)) return null; return blk(over[k] ?? (y < 60 ? 'stone' : 'air')) }

console.log('THE PURE RULES')
await t('the positive control: the fixture is the live record\'s shape (5 stands, 8 trees, 50 listed logs, 8 replants skipped)', () => {
  const rec = liveRec()
  assert.strictEqual(rec.cells.filter(c => c.role === 'stand').length, 5)
  assert.strictEqual(rec.trees.length, 8)
  assert.strictEqual(rec.clear.filter(c => c.kind === 'tree').length, 50)
  assert.ok(rec.replant.length === 8 && rec.replant.every(q => q.state === 'skipped'))
  assert.ok(Math.min(...rec.trees.map(q => q.base[1])) === 63 && Math.max(...rec.trees.map(q => q.top)) === 75)
})
await t('THE LIVE RECORD: every tree gone, every stand obsolete, the phase is the tank -- nothing to fell', () => {
  const rec = liveRec(), read = liveRead()
  assert.deepStrictEqual(FD.fellTrees(rec, read).map(q => q.state), Array(8).fill('gone'))
  const d = FD.fellDone(rec, read)
  assert.deepStrictEqual({ ...d, keys: d.keys.length }, { trees: 8, gone: 8, standing: 0, unknown: 0, stands: 5, obsolete: 5, placed: 0, keys: 5 })
  assert.strictEqual(FD.fellDoneRow(d), 'trees8/gone8/standing0/unknown0/stands5/obsolete5/placed0')
  assert.deepStrictEqual(FD.fellPhase(rec, read), { phase: 'tank', pending: 0, owed: 0 })
  assert.strictEqual(SW.fellPending(read, rec), 0, 'the visit\'s own count agrees')
  // the felling view: its one segment is complete, nothing is workable
  const view = SW.fellView(rec), also = FD.fellAlsoDone(rec)
  assert.strictEqual(view.cells.length, 5)
  assert.ok(view.cells.every(c => also(c, read)), 'every stair cell is done')
  assert.strictEqual(R.segComplete(read, view, SW.FELL_PALETTE, SW.FELL_SEG, also), true)
  assert.strictEqual(R.workableSeg(view, read, SW.FELL_PALETTE, () => true, also), null)
  // ...and the control: without the rule the same view is open on all five (today's behaviour, FELLDONE=off)
  assert.strictEqual(R.segComplete(read, view, SW.FELL_PALETTE, SW.FELL_SEG, null), false)
  assert.strictEqual(R.workableSeg(view, read, SW.FELL_PALETTE, () => true, null), SW.FELL_SEG)
})
await t('standTrees: each stand serves the tree whose staircase it is a step of (the siting\'s geometry), with plotPrep\'s own reach', () => {
  const m = FD.standTrees(liveRec())
  assert.deepStrictEqual(LIVE_STANDS.map(s => m.get(kOf(s))), [[0], [0], [0], [1], [2]])
  assert.strictEqual(FD.FELL_REACH_UP, TIDY.PLOTPREP.reachUp, 'the reach is the siting\'s (tidy.mjs PLOTPREP.reachUp)')
  // a cell that fits no tree's stair serves every tree (never dropped on a guess)
  const odd = { ...liveRec(), cells: [{ at: [-44, 68, -64], role: 'stand' }] }
  assert.strictEqual(FD.standTrees(odd).get('-44,68,-64'), null)
  // one step too far out, one block too high: not that tree's
  const far = { trees: [LIVE_TREES[0]], cells: [{ at: [-53, 68, -75], role: 'stand' }, { at: [-54, 69, -75], role: 'stand' }, { at: [-55, 67, -75], role: 'stand' }] }
  assert.deepStrictEqual([...FD.standTrees(far).values()], [null, null, null])
})
await t('ONE TREE STILL STANDING: only that tree\'s stand cells stay open (a single log is enough); the phase is the felling', () => {
  const rec = liveRec(), read = liveRead({ '-56,74,-75': 'spruce_log' }), also = FD.fellAlsoDone(rec)
  const open = SW.fellView(rec).cells.filter(c => !also(c, read)).map(c => kOf(c.at))
  assert.deepStrictEqual(open, LIVE_STANDS.slice(0, 3).map(kOf), 'tree 0\'s three steps')
  assert.deepStrictEqual(FD.fellTrees(rec, read).map(q => q.state), ['standing', ...Array(7).fill('gone')])
  const d = FD.fellDone(rec, read)
  assert.deepStrictEqual([d.gone, d.standing, d.obsolete], [7, 1, 2])
  assert.deepStrictEqual(FD.fellPhase(rec, read), { phase: 'fell', pending: 1, owed: 0 })
  // another tree's log (tree 2): its one step, not tree 0's
  const r2 = liveRead({ '-50,70,-76': 'stripped_spruce_wood' })
  assert.deepStrictEqual(SW.fellView(rec).cells.filter(c => !also(c, r2)).map(c => kOf(c.at)), ['-51,68,-76'])
})
await t('UNREAD LOG CELLS: unknown, never gone -- nothing is dropped for that tree, and the phase stays the felling', () => {
  const rec = liveRec(), also = FD.fellAlsoDone(rec)
  const read = liveRead({}, new Set(['-56,71,-75']))
  assert.deepStrictEqual(FD.fellTrees(rec, read).map(q => q.state), ['unknown', ...Array(7).fill('gone')])
  assert.deepStrictEqual(SW.fellView(rec).cells.filter(c => !also(c, read)).map(c => kOf(c.at)), LIVE_STANDS.slice(0, 3).map(kOf))
  assert.strictEqual(FD.fellPhase(rec, read).phase, 'fell'); assert.strictEqual(FD.fellPhase(rec, read).pending, null)
  // a wholly unread world: every tree unknown, no stand obsolete (positive control: the read world above drops five)
  const none = FD.fellDone(rec, () => null)
  assert.deepStrictEqual([none.gone, none.unknown, none.obsolete], [0, 8, 0])
  assert.strictEqual(FD.fellDone(rec, liveRead()).obsolete, 5)
})
await t('a stand that fits no tree waits for EVERY tree; a log with no tree index is every tree\'s', () => {
  const rec = { ...liveRec(), cells: [{ at: [-44, 68, -64], role: 'stand' }, ...liveRec().cells] }
  const also = FD.fellAlsoDone(rec)
  assert.strictEqual(also(rec.cells[0], liveRead()), true, 'every tree gone')
  assert.strictEqual(also(rec.cells[0], liveRead({ '-58,70,-65': 'spruce_log' })), false, 'tree 7 stands')
  const loose = { ...liveRec(), clear: [...liveRec().clear, { at: [-44, 70, -70], kind: 'tree', name: 'oak_log' }] }
  const also2 = FD.fellAlsoDone(loose)
  assert.ok(loose.cells.filter(c => c.role === 'stand').every(c => also2(c, liveRead())))
  assert.ok(loose.cells.filter(c => c.role === 'stand').every(c => !also2(c, liveRead({ '-44,70,-70': 'oak_log' }))), 'the untagged log holds every stair')
})
await t('never another role, never a cell the record does not hold as a stand', () => {
  const rec = liveRec(), also = FD.fellAlsoDone(rec), read = liveRead()
  assert.strictEqual(also({ at: [-54, 66, -85], role: 'floor' }, read), false)
  assert.strictEqual(also({ at: [-55, 68, -75], role: 'floor' }, read), false)
  assert.strictEqual(also({ at: [0, 70, 0], role: 'stand' }, read), false)
  assert.strictEqual(also({ at: [-55, 68, -75], role: 'stand' }, read), true, 'the positive control')
})
await t('REPLANTS in each state hold the PHASE by their own state, never a stand cell', () => {
  const read = liveRead()
  const owed = liveRec({ replant: 'owed' })
  assert.deepStrictEqual(FD.fellPhase(owed, read), { phase: 'fell', pending: 0, owed: 8 })
  assert.ok(SW.fellView(owed).cells.every(c => FD.fellAlsoDone(owed)(c, read)), 'the stairs are done all the same')
  // planted: a sapling reads in every cell
  const planted = liveRead(Object.fromEntries(owed.replant.map(q => [kOf(q.cell), 'spruce_sapling'])))
  assert.deepStrictEqual(FD.fellPhase(owed, planted), { phase: 'tank', pending: 0, owed: 0 })
  // one deferred (still owed), the rest skipped: the felling phase, for its replant pass alone
  const one = { ...liveRec(), replant: liveRec().replant.map((q, i) => (i === 5 ? { ...q, state: undefined, deferred: 2 } : q)) }
  assert.deepStrictEqual(FD.fellPhase(one, read), { phase: 'fell', pending: 0, owed: 1 })
  assert.strictEqual(FD.fellDone(one, read).obsolete, 5)
  // skipped: the tank
  assert.strictEqual(FD.fellPhase(liveRec(), read).phase, 'tank')
  // an unread replant cell is owed (no sapling read there), as the visit's own test
  assert.strictEqual(FD.fellPhase(owed, liveRead(Object.fromEntries(owed.replant.map(q => [kOf(q.cell), 'spruce_sapling'])), new Set([kOf(owed.replant[0].cell)]))).owed, 1)
})
await t('the stamp: stale only when it names cells and every one is an obsolete stand (the tank\'s own cell-less stamp holds)', () => {
  const rec = liveRec(), read = liveRead(), keys = LIVE_STANDS.map(kOf)
  assert.strictEqual(FD.fellStampStale(keys, rec, read), true)
  assert.strictEqual(FD.fellStampStale(keys.slice(3), rec, read), true)
  assert.strictEqual(FD.fellStampStale([], rec, read), false, 'no cells: the tank\'s back-off')
  assert.strictEqual(FD.fellStampStale([...keys, '-54,66,-85'], rec, read), false, 'a tank cell among them')
  assert.strictEqual(FD.fellStampStale(keys, rec, liveRead({ '-56,74,-75': 'spruce_log' })), false, 'a tree stands')
  assert.strictEqual(FD.fellStampStale(keys.slice(3), rec, liveRead({ '-56,74,-75': 'spruce_log' })), true, '...but not those cells\' trees')
  assert.strictEqual(FD.fellStampStale(keys, rec, () => null), false, 'unread')
})
await t('the switch: FELLDONE=off|0|false|no is off; unset or anything else is on', () => {
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(FD.fellDoneOn({ FELLDONE: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(FD.fellDoneOn({ FELLDONE: v }), true, String(v))
})

console.log('A STAND PLACED EARLIER STILL COMES OUT (the tank\'s own cut of its layer)')
await t('a placed stand of a gone tree: done for the felling view, counted `placed`, and the tank\'s next mutation digs it', () => {
  const GY = 64
  const base = (x, y, z) => (y > GY ? 'air' : y === GY ? 'grass_block' : y >= GY - 3 ? 'dirt' : 'stone')
  const over = new Map()
  const read = (x, y, z) => blk(over.get(`${x},${y},${z}`) ?? base(x, y, z))
  const sv = { site: { origin: { x: 0, z: 0 }, away: 's', g: GY, W: 21, T: 1, centre: [10, 10], tiersDry: 1 }, counts: {}, byTier: {}, d: 40 }
  const tree = { base: [8, GY + 1, 8], name: 'spruce_log', top: GY + 8 }   // need 2: steps at 8,9 (two high) and 8,10
  const stair = [[8, GY + 1, 9], [8, GY + 2, 9], [8, GY + 1, 10]]
  const fell = { trees: [tree], platforms: [{ tree: 0, cells: stair }], clear: logsOf(0, tree.base, tree.top).map(({ t: _t, ...c }) => c), replant: [{ cell: [40, GY + 1, 40], sapling: 'spruce_sapling', state: 'skipped' }] }
  const rec = SW.stepwellRecord(sv, { home: { x: 0, y: GY, z: -40 }, seed: 7, fell, read })
  assert.deepStrictEqual(rec.cells.filter(c => c.role === 'stand').map(c => kOf(c.at)), stair.map(kOf), 'the stairs are record cells')
  assert.deepStrictEqual([...FD.standTrees(rec).values()], [[0], [0], [0]])
  over.set(kOf(stair[0]), 'cobblestone')   // placed by an earlier felling visit; the tree is gone since (no log anywhere)
  const also = FD.fellAlsoDone(rec)
  assert.ok(SW.fellView(rec).cells.every(c => also(c, read)), 'no stair cell is open in the felling view')
  const d = FD.fellDone(rec, read)
  assert.deepStrictEqual([d.obsolete, d.placed], [3, 1])
  assert.strictEqual(FD.fellPhase(rec, read).phase, 'tank')
  // the tank: the placed stand is not done there, its layer's unit names it, and the next mutation is its dig
  const P = SW.planOfRecord(rec)
  assert.strictEqual(SW.cellDone(read, P, stair[0]), false, 'a standing stair block is not done for the tank')
  const u = P.units.find(q => q.cut.some(c => kOf(c) === kOf(stair[0])))
  assert.ok(u, 'the stand is in its layer\'s cuts')
  const first = SW.firstUndoneUnit(read, P)
  assert.strictEqual(first.unit, u, 'that layer is the first unit not done')
  assert.deepStrictEqual(SW.stepwellNext(read, P, u), { op: 'dig', at: stair[0], why: 'cut', kind: 'foreign' })
  // dug: the layer goes on (positive control for the reading)
  over.set(kOf(stair[0]), 'air')
  assert.strictEqual(SW.cellDone(read, P, stair[0]), true)
})

// ---- THE CHAIN (fake server, the real runVisit) -------------------------------------------------------------------------------
// tree A (gone): base 12,G+1,12 top G+8 -> its stair 13 (two high) and 14, over a pit dug 8 deep under it (nothing to place against)
// tree B (standing in `withB`): base -12,G+1,12 top G+8 (its top log out of a ground stand's reach) -> its stair -11 (two high)
// and -10 on flat ground (placeable)
const A = { base: [12, G + 1, 12], name: 'spruce_log', top: G + 8 }, A_STAIR = [[13, G + 1, 12], [13, G + 2, 12], [14, G + 1, 12]]
const Bt = { base: [-12, G + 1, 12], name: 'spruce_log', top: G + 8 }, B_STAIR = [[-11, G + 1, 12], [-11, G + 2, 12], [-10, G + 1, 12]]
function scene ({ withB = false } = {}) {
  const cells = {}
  for (let x = 10; x <= 17; x++) for (let z = 9; z <= 15; z++) for (let y = G - 7; y <= G; y++) cells[kOf([x, y, z])] = 'air'
  if (withB) for (let y = Bt.base[1]; y <= Bt.top; y++) cells[kOf([Bt.base[0], y, Bt.base[2]])] = 'spruce_log'
  const srv = server(cells)
  const trees = withB ? [A, Bt] : [A]
  const rec = { ...SITE.record, blueprint: SW.STEPWELL_BLUEPRINT, plot: SW.STEPWELL_PLOT, replant: [], trees,
    cells: [...A_STAIR, ...(withB ? B_STAIR : [])].map(at => ({ at, role: 'stand', seg: SW.FELL_SEG })),
    clear: trees.flatMap((tr, i) => logsOf(i, tr.base, tr.top)),
    zones: [{ box: [-40, G - 20, -40, 40, G + 40, 40], why: 'project:stepwell' }] }
  return { srv, rec, pr: project(rec) }
}
/** One felling visit as skills.mjs buildStepwellRun runs it: `on` = FELLDONE (the `alsoDone` passed only then). */
async function fellVisit ({ srv, rec, pr }, on) {
  const h = PJ.recordHead(pr.dir, pr.key)
  const e = bot(srv, 'A', { feet: [0, G + 1, 0] })
  const r = await R.runVisit({ ...pr.p('A'), record: SW.fellView(h.head.rec), recordGen: h.head.gen, palette: SW.FELL_PALETTE, domain: () => true,
    blockLayer: false, clearMax: 60, walkR: 64, replantGoOn: true, replantPerTree: true, ...(on ? { alsoDone: FD.fellAlsoDone(rec) } : {}) }, e, { maxSteps: 240 })
  return { r, rows: e.logs.filter(([k]) => k === '_build').map(([, d]) => d) }
}
console.log('THE CHAIN (fake server, the real runVisit)')
await t('POSITIVE CONTROL (the live dead end, FELLDONE off): deferred, deferred, then stuck_on_cell STALLED on the hanging stair', async () => {
  const s = scene()
  assert.strictEqual(SW.fellPending(s.srv.read, s.rec), 0, 'no listed log stands')
  const stops = [], last = []
  for (let i = 0; i < R.STUCK_VISITS; i++) { const v = await fellVisit(s, false); stops.push(v.r.stop); last.splice(0, Infinity, ...v.rows); assert.strictEqual(v.r.placed, 0) }
  assert.deepStrictEqual(stops, [...Array(R.STUCK_VISITS - 1).fill('cell_deferred'), 'stuck_on_cell'], `${stops}`)
  const row = last.find(d => d.op === 'stuck_on_cell')
  assert.ok(row && row.stalled === true && row.segs === SW.FELL_SEG && row.waiting === 3, JSON.stringify(row))
  assert.ok(Number.isFinite(PJ.stuckAt(s.pr.dir, s.pr.key)), 'the whole project is stamped')
  for (const c of A_STAIR) assert.strictEqual(s.srv.read(...c).name, 'air')
})
await t('THE RULE: the same world ends `complete` -- nothing placed, nothing deferred, no stuck row, no stamp', async () => {
  const s = scene()
  const v = await fellVisit(s, true)
  assert.strictEqual(v.r.stop, 'complete', `${v.r.stop} ${v.r.why}`)
  assert.strictEqual(v.r.placed, 0)
  assert.ok(!v.rows.some(d => d.op === 'deferred' || d.op === 'stuck_on_cell' || d.op === 'place'), JSON.stringify(v.rows))
  assert.deepStrictEqual(PJ.stuckRead(s.pr.dir, s.pr.key), {})
  assert.strictEqual(PJ.stuckAt(s.pr.dir, s.pr.key), null)
  for (const c of A_STAIR) assert.strictEqual(s.srv.read(...c).name, 'air', 'never placed')
})
await t('after the dead end: the stamp the control wrote is stale by the rule, and the next visit clears the stuck map and the stamp', async () => {
  const s = scene()
  for (let i = 0; i < R.STUCK_VISITS; i++) await fellVisit(s, false)
  const keys = Object.keys(PJ.stuckRead(s.pr.dir, s.pr.key))
  assert.deepStrictEqual(keys.sort(), A_STAIR.filter(c => c[1] === G + 1).map(kOf).sort(), 'the two bottom steps are on the map')
  // the order's reading (skills.mjs projStuckLive -> buildproj stuckAt `stale`): the stamp holds nothing
  assert.ok(Number.isFinite(PJ.stuckAt(s.pr.dir, s.pr.key)))
  assert.strictEqual(PJ.stuckAt(s.pr.dir, s.pr.key, { stale: ks => FD.fellStampStale(ks, s.rec, s.srv.read) }), null)
  const v = await fellVisit(s, true)
  assert.strictEqual(v.r.stop, 'complete')
  assert.deepStrictEqual(PJ.stuckRead(s.pr.dir, s.pr.key), {}, 'the obsolete cells left the stuck map')
  assert.strictEqual(PJ.stuckAt(s.pr.dir, s.pr.key), null)
})
await t('ONE TREE STANDS beside a gone one: its own stair is placed, the gone tree\'s hanging stair is never touched, nothing is deferred', async () => {
  const s = scene({ withB: true })
  assert.strictEqual(SW.fellPending(s.srv.read, s.rec), Bt.top - Bt.base[1] + 1)
  const v = await fellVisit(s, true)
  assert.deepStrictEqual([...FD.standTrees(s.rec).values()], [[0], [0], [0], [1], [1], [1]], 'each stair is its own tree\'s')
  for (const c of B_STAIR) assert.strictEqual(s.srv.read(...c).name, 'cobblestone', `tree B's step ${kOf(c)} is laid (cobblestone before dirt)`)
  assert.strictEqual(v.rows.filter(d => d.op === 'place').length, B_STAIR.length, 'three placements, all tree B\'s')
  assert.strictEqual(v.r.placed, B_STAIR.length)
  assert.ok(!v.rows.some(d => d.op === 'deferred' || d.op === 'stuck_on_cell'), JSON.stringify(v.rows.filter(d => d.op !== 'clear')))
  for (const c of A_STAIR) assert.strictEqual(s.srv.read(...c).name, 'air')
  assert.ok(v.r.cleared > 0, 'and the standing tree is being felled')
  // the control: without the rule the same visit defers the gone tree's stair
  const c2 = scene({ withB: true })
  const w = await fellVisit(c2, false)
  assert.ok(w.rows.some(d => d.op === 'deferred'), 'FELLDONE off: deferred as before')
})

console.log('MUTANTS (each killed for its own reason)')
await t('MUTANT the gone test: a tree whose log still stands reads gone -> its stair is dropped while the tree stands', async () => {
  await killed('const b = read(...at); return !!b && !isLog(b) })', 'const b = read(...at); return !!b })', M => {
    const rec = liveRec(), read = liveRead({ '-56,74,-75': 'spruce_log' })
    assert.strictEqual(M.fellAlsoDone(rec)(rec.cells[0], read), false)
  })
})
await t('MUTANT the unread rule: an unread log reads gone -> a stair is dropped on no evidence', async () => {
  await killed('const b = read(...at); return !!b && !isLog(b) })', 'const b = read(...at); return !b || !isLog(b) })', M => {
    const rec = liveRec()
    assert.strictEqual(M.fellAlsoDone(rec)(rec.cells[0], liveRead({}, new Set(['-56,71,-75']))), false)
    assert.strictEqual(M.fellDone(rec, () => null).obsolete, 0)
  })
})
await t('MUTANT the unread count: an unread log is not counted -> the tree\'s state reads gone', async () => {
  await killed('if (!b) unread++; else if (isLog(b)) standing++', 'if (b && isLog(b)) standing++', M => {
    assert.strictEqual(M.fellTrees(liveRec(), liveRead({}, new Set(['-56,71,-75'])))[0].state, 'unknown')
  })
})
await t('MUTANT the per-tree mapping (every stand serves every tree): one standing tree holds every stair', async () => {
  await killed('return (serves.get(kOf(c.at)) ?? all).every(i => gone(i, read))', 'return all.every(i => gone(i, read))', M => {
    const rec = liveRec(), read = liveRead({ '-56,74,-75': 'spruce_log' })
    assert.strictEqual(M.fellAlsoDone(rec)(rec.cells[3], read), true, 'tree 1\'s step is done while tree 0 stands')
  })
})
await t('MUTANT the per-tree mapping (the stair\'s height ignored): a cell above a step, or past the stair, is taken for its stair', async () => {
  await killed('if (y >= b[1] && y <= b[1] + need - step) mine.push(i)', 'if (y >= b[1]) mine.push(i)', M => {
    const far = { trees: [LIVE_TREES[0]], cells: [{ at: [-54, 69, -75], role: 'stand' }, { at: [-53, 68, -75], role: 'stand' }] }
    assert.deepStrictEqual([...M.standTrees(far).values()], [null, null])
  })
})
await t('MUTANT the per-tree mapping (off the trunk\'s line): a diagonal cell is taken for its stair', async () => {
  await killed('if ((dx !== 0 && dz !== 0) || step < 1) return', 'if (step < 1) return', M => {
    const diag = { trees: [LIVE_TREES[0]], cells: [{ at: [-55, 68, -74], role: 'stand' }] }
    assert.strictEqual(M.standTrees(diag).get('-55,68,-74'), null)
  })
})
await t('MUTANT the stamp (a cell-less stamp reads stale): the tank\'s own back-off would be dropped', async () => {
  await killed('if (!Array.isArray(keys) || !keys.length) return false', 'if (!Array.isArray(keys)) return false', M => {
    assert.strictEqual(M.fellStampStale([], liveRec(), liveRead()), false)
  })
})
await t('MUTANT the switch (FELLDONE never read): off no longer turns it off', async () => {
  await killed("String(env?.FELLDONE ?? '')", "String(env?.FELLDONE_ ?? '')", M => {
    assert.strictEqual(M.fellDoneOn({ FELLDONE: 'off' }), false)
  })
})

console.log('WIRING (structural: the stepwell visit is not reachable offline; comments stripped, executable lines)')
const SKS = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const WIRES = [
  ['the rule is built only with the switch on', /const fdAlso = fellDoneOn\(\) \? fellAlsoDone\(rec\) : null/],
  ['the felling visit takes `alsoDone` only then (off: the call as it was)', /record: fellView\(rec\), recordGen: rh\.head\.gen, palette: FELL_PALETTE, [^\n]*placedBy, \.\.\.\(fdAlso \? \{ alsoDone: fdAlso \} : \{\}\),\n/],
  ['the phase test is the one fellPhase mirrors (a listed log stands or is unread, or a replant is owed)', /if \(pending == null \|\| pending > 0 \|\| owedNow > 0\) \{/],
  ['...and its owed count', /const owedNow = \(rec\.replant \?\? \[\]\)\.filter\(q => q\.state !== 'skipped' && !\/_sapling\$\|\^mangrove_propagule\$\/\.test\(read0\(\.\.\.q\.cell\)\?\.name \?\? ''\)\)\.length/],
  ['the order drops an obsolete stair\'s stamp, with the switch', /if \(rec\?\.blueprint === STEPWELL_BLUEPRINT && fellDoneOn\(\) && fellStampStale\(keys, rec, stairRead\(b\)\)\) return true/],
  ['the row: in the felling branch with the rule', /if \(fdAlso\) swFellDoneRow\(bot, rec, rh\.head\.gen\)/],
  ['the row: once a generation in the tank, with the switch', /if \(fellDoneOn\(\) && bot\.swFellDoneGen !== rh\.head\.gen\) \{ bot\.swFellDoneGen = rh\.head\.gen; swFellDoneRow\(bot, rec, rh\.head\.gen\) \}/],
  ['the row is a `_stepwell op=fell_done` row', /stepwellRow\(bot, 'fell_done', \{ why: `\$\{ph\.phase\}:pending\$\{ph\.pending \?\? '\?'\}\/owed\$\{ph\.owed\}`, n: fellDoneRow\(d\)/],
]
for (const [name, re] of WIRES) {
  await t(`${name} (and a mutant of the line is not matched)`, () => {
    assert.ok(re.test(SKS), 'wired')
    const m = SKS.match(re)[0]
    assert.strictEqual(SKS.split(m).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.ok(!re.test(SKS.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant of the executable line is not matched')
  })
}
await t('the mirror: fellPhase reads the phase as the visit\'s own count does (fellPending), log for log', () => {
  const rec = liveRec()
  for (const read of [liveRead(), liveRead({ '-56,74,-75': 'spruce_log', '-50,70,-76': 'spruce_log' }), liveRead({}, new Set(['-45,70,-82']))]) {
    assert.strictEqual(FD.fellPhase(rec, read).pending, SW.fellPending(read, rec))
  }
})

for (const f of FAILED.slice(0, 30)) console.log(`  FAILED  ${f}`)
console.log(`\nfelldone: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
