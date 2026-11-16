// SEALEDCORE-01 (bots/src/sealedcore.mjs; skills.mjs buildMonument; buildrun.mjs runVisit `access` on its result). LIVE showcase: the
// ziggurat at 4,885 of 4,889 -- two core cells of L00-E (-36,69,-25 and -36,69,-26) are air inside the finished body, over a one-high
// air run under the base that is no record cell; `stuck_on_cell visits=20`, the void access refused 13 times (no plan: its shaft
// would dig cells that are not the monument's), 13 other open cells waiting on the segment.
// Here: the rule on `read` scenes (the live shape; an opening; the box edge; an unread cell; a visible role; the cap; a visible cell
// that rests on the void), each condition with its mutant, and THE CHAIN on the fake server with the real runVisit and the real
// void access: deferred, stuck, the access refused with no plan, the waiver, then the 13 dependants built and the record complete.
// The scene is a stepped mound on the fake server shaped as the live case is described; the live world itself was not read here.
import assert from 'node:assert'
import fs from 'node:fs'
const SC = await import('../src/sealedcore.mjs')
const Z = await import('../src/ziggurat.mjs')
const W = await import('../src/wall.mjs')
const SHOP = await import('../src/shop.mjs')
const TIDY = await import('../src/tidy.mjs')
const V = await import('../src/voidfill.mjs')
const { R, PJ, withMutant, G, server, bot, project } = await import('./helpers/buildfake.mjs')
const SC_PATH = new URL('../src/sealedcore.mjs', import.meta.url)

let pass = 0, fail = 0
const FAILED = [], DEBUG = []   // named again at the end (the suite keeps a failing file's last 40 lines)
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; FAILED.push(`${name} :: ${String(e.message).split('\n')[0].slice(0, 160)}`); console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withScMutant (old, neu, fn) {
  const src = fs.readFileSync(SC_PATH, 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-sc-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module and THROWS on the mutant (a mutant that passes survived). */
async function killed (old, neu, scenario) {
  await scenario(SC)
  let dead = false
  await withScMutant(old, neu, async M => { try { await scenario(M) } catch { dead = true } })
  assert.ok(dead, 'the mutant survived')
}
const k = a => a.join(',')
const PAL = Z.ZIG_PALETTE

// ---- THE SCENE: a stepped mound (layers L00..L03 at G+1..G+4, half widths 6, 5, 4, 3; the outer two rings and the cap are skin,
// the rest core), two adjacent core cells of L00 open at its centre, a one-high air run under the base, 13 open cells on the cap ----
const CX = 30, CZ = 0, BASE = G + 1
const RADS = [6, 5, 4, 3]
const C1 = [CX, BASE, CZ], C2 = [CX, BASE, CZ + 1], K1 = k(C1), K2 = k(C2)
const RUN = [0, 1, 2, 3].map(i => [CX + i, G, CZ])                                                   // the live shape: under C1, eastward
const WIDE = [-1, 0, 1].flatMap(dx => [-1, 0, 1, 2].map(dz => [CX + dx, G, CZ + dz]))                 // under C1, C2 and every cell beside them
const DEPS = [...[-3, -2, -1, 0, 1, 2, 3].map(dx => [CX + dx, BASE + 4, CZ - 3]), ...[-3, -2, -1, 0, 1, 2].map(dx => [CX + dx, BASE + 4, CZ + 3])]
// (the 13 wait on L00 itself, as a ziggurat layer's quadrants wait on every quadrant of the layer below: runVisit asks a segment's
// OWN deps -- a finished layer in between passes nothing on)
const SEGS = [{ seg: 'L00', deps: [] }, { seg: 'L01', deps: ['L00'] }, { seg: 'L02', deps: ['L01'] }, { seg: 'L03', deps: ['L02'] }, { seg: 'L04', deps: ['L00', 'L03'] }]
/** `pocket` the air cells under the base; `set` world overrides; `roles` record role overrides; `drop` cells left out of the record. */
function mound ({ pocket = RUN, set = {}, roles = {}, drop = [], deps = true, waived = null } = {}) {
  const cells = [], world = {}
  RADS.forEach((r, l) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const at = [CX + dx, BASE + l, CZ + dz], role = l === 3 || Math.max(Math.abs(dx), Math.abs(dz)) >= r - 1 ? 'skin' : 'core'
      world[k(at)] = role === 'skin' ? 'cobblestone' : 'dirt'
      if (!drop.includes(k(at))) cells.push({ at, role: roles[k(at)] ?? role, seg: `L0${l}` })
    }
  })
  world[K1] = 'air'; world[K2] = 'air'
  for (const p of pocket) world[k(p)] = 'air'
  if (deps) for (const at of DEPS) cells.push({ at, role: 'skin', seg: 'L04' })
  Object.assign(world, set)
  const record = { v: 1, blueprint: Z.MONUMENT_BLUEPRINT, plot: 'shop', box: [CX - 6, CZ - 6, CX + 6, CZ + 6], baseY: BASE, cells, segments: SEGS, clear: [], replant: [], ...(waived ? { waived } : {}) }
  return { record, world, read: server(world).read }
}
const doneOf = (rec, Mod = SC) => { const also = Mod.zigAlsoDone(rec, {}); return (c, rd) => { const b = rd(...c.at); return !!b && (R.cellDone(b, PAL, c.role) || also(c, rd)) } }
const DEFERRED = (visits = SC.SEALED_CORE.after) => [{ k: K1, why: 'no_stand', visits }, { k: K2, why: 'no_stand', visits }]
const REFUSED = { result: 'refused', seg: 'L00', noPlan: true, cells: [K1, K2] }
// (`access: undefined` is a visit whose access was never tried: an explicit key is kept, only a missing one takes the refusal)
const due = (m, opts = {}) => {
  const { deferred = DEFERRED(), read = m.read, Mod = SC, access: _a, ...o } = opts
  return Mod.sealedCoreDue(m.record, deferred, { read, palette: PAL, isDone: doneOf(m.record, Mod), ...o, access: 'access' in opts ? opts.access : REFUSED })
}
const voidOf = (m, at = C1, { read = m.read, Mod = SC, ...o } = {}) => Mod.sealedVoid(m.record, at, read, { palette: PAL, isDone: doneOf(m.record, Mod), ...o })

console.log('THE LIVE SHAPE')
await t('positive control: the scene is the live shape (two adjacent open core cells, dirt beside, two dirt layers and the cap above, a one-high run below)', () => {
  const m = mound()
  const cellAt = new Map(m.record.cells.map(c => [k(c.at), c]))
  for (const c of [C1, C2]) { assert.strictEqual(cellAt.get(k(c)).role, 'core'); assert.strictEqual(cellAt.get(k(c)).seg, 'L00'); assert.strictEqual(m.read(...c).name, 'air') }
  for (const [dx, dz] of [[-1, 0], [1, 0]]) for (const c of [C1, C2]) assert.strictEqual(m.read(c[0] + dx, c[1], c[2] + dz).name, 'dirt')
  assert.deepStrictEqual([1, 2, 3].map(d => m.read(CX, BASE + d, CZ).name), ['dirt', 'dirt', 'cobblestone'])
  assert.ok(RUN.every(p => m.read(...p).name === 'air' && !cellAt.has(k(p))), 'the run under the base is air and no record cell')
  const open = m.record.cells.filter(c => !doneOf(m.record)(c, m.read))
  assert.strictEqual(open.length, 2 + 13, 'two sealed cells and the 13 that wait')
  assert.strictEqual(open.filter(c => c.seg === 'L04').length, 13)
  assert.strictEqual(Z.zigHidden(cellAt.get(K1), m.read), false, 'zigHidden does not see it: the hollow is more than one cell')
})
await t('the enclosed void: the two cells and the run (6 cells); both cells are due after the wall\'s 5 deferring visits with the access refused', () => {
  const m = mound()
  const v = voidOf(m)
  assert.ok(v.ok, v.why)
  assert.deepStrictEqual(v.cells.map(k).sort(), [C1, C2, ...RUN].map(k).sort())
  const d = due(m)
  assert.deepStrictEqual(d.due, [{ k: K1, why: 'sealed_core', n: 6, visits: 5 }, { k: K2, why: 'sealed_core', n: 6, visits: 5 }])
  assert.deepStrictEqual(d.held, [])
  assert.strictEqual(SC.SEALED_CORE.after, W.WALL_WAIVE_AFTER, 'N is the wall\'s')
  assert.strictEqual(SC.FILL_MARK, R.SOLID_ANY, 'the fill mark is the palette\'s own')
})
await t('AFTER THE WAIVER: the record names both cells; L00 reads complete and the 13 dependants\' segment is the workable one', () => {
  const m = mound()
  const before = SC.zigAlsoDone(m.record, {})
  assert.strictEqual(R.segComplete(m.read, m.record, PAL, 'L00', before), false)
  assert.strictEqual(R.workableSeg(m.record, m.read, PAL, () => true, before), 'L00', 'before: the stuck segment is all there is')
  const next = SC.withSealedCore(m.record, due(m).due, { now: 7, by: 'A' })
  assert.deepStrictEqual(next.waived, { [K1]: { why: 'sealed_core', at: 7, by: 'A', void: 6 }, [K2]: { why: 'sealed_core', at: 7, by: 'A', void: 6 } })
  const after = SC.zigAlsoDone(next, {})
  assert.strictEqual(R.segComplete(m.read, next, PAL, 'L00', after), true)
  assert.strictEqual(R.workableSeg(next, m.read, PAL, () => true, after), 'L04', 'the 13 waiting cells\' segment')
  assert.strictEqual(next.cells.filter(c => !doneOf(next)(c, m.read)).length, 13, 'the 13 stay open: they are built, never waived')
  assert.strictEqual(W.wallWaived(next, { at: C1 }), true, 'the map is the wall\'s shape')
  assert.strictEqual(SC.withSealedCore(next, due(m).due), null, 'nothing new: no generation')
  assert.deepStrictEqual(due({ ...m, record: next }).due, [], 'a waived cell is never due again')
})

console.log('EVERY CONDITION (a refusal each, with the live shape as its positive control)')
await t('young: under 5 deferring visits it waits (the lifetime tally counts when the stuck map has forgotten)', () => {
  const m = mound()
  const d = due(m, { deferred: DEFERRED(4) })
  assert.deepStrictEqual(d.due, []); assert.deepStrictEqual(d.held.map(h => h.why), ['young 4/5', 'young 4/5'])
  assert.strictEqual(due(m, { deferred: DEFERRED(1), counts: { [K1]: { visits: 9 }, [K2]: { visits: 5 } } }).due.length, 2)
  assert.strictEqual(due(m, { deferred: DEFERRED(1), counts: { [K1]: { visits: 9 } } }).due.length, 1)
})
await t('the access: only a refusal with NO PLAN for this cell THIS visit -- or a visit that has no void access at all', () => {
  const m = mound()
  assert.deepStrictEqual(due(m, { access: undefined }).held.map(h => h.why), ['access_untried', 'access_untried'])
  for (const result of ['young', 'spent', 'late', 'done', 'failed']) assert.deepStrictEqual(due(m, { access: { result, noPlan: false, cells: [K1, K2] } }).due, [], result)
  assert.deepStrictEqual(due(m, { access: { result: 'refused', noPlan: false, cells: [K1, K2] } }).due, [], 'a bag that was short is no refusal of the plan')
  assert.deepStrictEqual(due(m, { access: { ...REFUSED, cells: [K1] } }).due.map(o => o.k), [K1], 'only the cells the access was asked for')
  assert.strictEqual(due(m, { access: null }).due.length, 2, 'no void access on this visit: not applicable')
  assert.strictEqual(due(m).due.length, 2, 'the positive control')
})
await t('ONE OPENING to the outside air: never waived (the void does not stay small)', () => {
  // the cap's cell over C1 is no record cell and open, as are the two core cells under it: a chimney to the sky
  const up = [1, 2, 3].map(d => k([CX, BASE + d, CZ]))
  const m = mound({ deps: false, drop: [up[2]], set: Object.fromEntries(up.map(q => [q, 'air'])) })
  const v = voidOf(m)
  assert.strictEqual(v.ok, false); assert.strictEqual(v.why, 'too_big')
  assert.deepStrictEqual(due(m).due, [])
  assert.ok(voidOf(mound({ deps: false })).ok, 'the positive control: the same mound closed')
})
await t('a void that leaves the box under its edge, or touches the box edge: never waived', () => {
  const out = mound({ pocket: [0, 1, 2, 3, 4, 5, 6, 7].map(i => [CX + i, G, CZ]) })       // one cell past the box (x1 = CX + 6)
  assert.match(voidOf(out).why, /^box_edge /)
  const edge = mound({ pocket: [0, 1, 2, 3, 4, 5, 6].map(i => [CX + i, G, CZ]) })           // its last cell in the edge column
  assert.strictEqual(voidOf(edge).why, `boundary_foreign ${CX + 7},${G},${CZ}`, 'the ground beyond the edge is not the monument\'s')
  assert.deepStrictEqual([due(out).due, due(edge).due], [[], []])
  assert.ok(voidOf(mound({ pocket: [0, 1, 2, 3, 4, 5].map(i => [CX + i, G, CZ]) })).ok, 'one short of the edge column: enclosed')
})
await t('an UNREAD cell in the void or round it: never waived', () => {
  const m = mound()
  const hole = key => (x, y, z) => (`${x},${y},${z}` === key ? null : m.read(x, y, z))
  assert.strictEqual(voidOf(m, C1, { read: hole(k(RUN[2])) }).why, `unread ${k(RUN[2])}`, 'a void cell')
  assert.strictEqual(voidOf(m, C1, { read: hole(k([CX + 2, G - 1, CZ])) }).why, `unread ${k([CX + 2, G - 1, CZ])}`, 'a boundary cell')
  assert.strictEqual(voidOf(m, C1, { read: hole(K1) }).why, `unread ${K1}`, 'the cell itself')
  assert.deepStrictEqual(due(m, { read: hole(k([CX - 1, BASE, CZ + 1])) }).due, [])
  assert.deepStrictEqual(due(m, { read: () => null }).due, [])
})
await t('a VISIBLE-role cell in the same situation: never a candidate -- and it holds the whole void', () => {
  const m = mound({ roles: { [K1]: 'skin' } })
  const d = due(m)
  assert.deepStrictEqual(d.due, [])
  assert.deepStrictEqual(d.held, [{ k: K2, why: `visible_cell ${K1}`, visits: 5 }], 'the skin cell is not even held: the rule never looks at it')
  for (const role of ['skin', 'stair']) assert.strictEqual(SC.fillRole(PAL, role), false, role)
  assert.strictEqual(SC.fillRole(PAL, 'core'), true)
  const v2 = { core: PAL.core.slice(), plinth: ['cobblestone'], stair: ['stone_bricks'], shrine: ['stone_bricks'], parapet: ['cobblestone_wall'], light: ['torch'], band0: ['cobblestone'] }
  assert.deepStrictEqual(Object.keys(v2).filter(r => SC.fillRole(v2, r)), ['core'], 'a v2 palette: its core only')
  assert.strictEqual(SC.fillRole(PAL, 'nope'), false); assert.strictEqual(SC.fillRole(null, 'core'), false)
})
await t('the CAP: at most 8 waived cells a record, ever', () => {
  const full = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${CX - 2},${BASE},${CZ - 2 + i}`, { why: 'sealed_core' }]))
  const m = mound({ waived: full })
  assert.deepStrictEqual(due(m).due, []); assert.deepStrictEqual(due(m).held.map(h => h.why), ['cap 8', 'cap 8'])
  const seven = mound({ waived: Object.fromEntries(Object.entries(full).slice(0, 7)) })
  assert.deepStrictEqual(due(seven).due.map(o => o.k), [K1]); assert.deepStrictEqual(due(seven).held.map(h => h.why), ['cap 8'])
  assert.strictEqual(SC.SEALED_CORE.max, 8)
})
await t('STRUCTURE: an open visible cell that rests on the void, or a boundary cell that is not done, holds the waiver', () => {
  // the cell over C1 is a visible-role cell of the record and open (sealed too): C1 is what it would be placed on
  const over = k([CX, BASE + 1, CZ])
  const rests = mound({ roles: { [over]: 'skin' }, set: { [over]: 'air' } })
  assert.deepStrictEqual(due(rests).due, [])
  assert.deepStrictEqual(due(rests).held.map(h => h.why), [`visible_cell ${over}`, `visible_cell ${over}`])
  // an open CORE cell there instead is fill like them: the void is still the body's own hollow (it is waived by its own turn only)
  const fill = mound({ set: { [over]: 'air' } })
  assert.deepStrictEqual(due(fill).due.map(o => [o.k, o.n]), [[K1, 7], [K2, 7]])
  assert.ok(!due(fill).due.some(o => o.k === over), 'the cell above is not waived by the back door: this visit did not defer it')
  // a visible cell beside C1 that holds the wrong block (open, to be dug and laid again: the void will be opened by that work)
  const beside = k([CX - 1, BASE, CZ])
  const wrong = mound({ roles: { [beside]: 'skin' } })
  assert.strictEqual(wrong.read(CX - 1, BASE, CZ).name, 'dirt')
  assert.deepStrictEqual(due(wrong).held.map(h => h.why), [`boundary_open ${beside}`, `boundary_open ${beside}`])
})
await t('the boundary is the record\'s own DONE cells or solid ground under the base: a stray block, a log, leaves, a liquid refuse', () => {
  const beside = k([CX - 1, BASE, CZ])
  assert.strictEqual(voidOf(mound({ drop: [beside] })).why, `boundary_foreign ${beside}`, 'a solid block in the body that is no record cell')
  const under = k([CX + 1, G - 1, CZ])
  assert.strictEqual(voidOf(mound({ set: { [under]: 'spruce_log' } })).why, `boundary_foreign ${under}`, 'a log under the run: no ground')
  assert.ok(voidOf(mound({ set: { [under]: 'gravel' } })).ok, 'gravel under it is ground')
  // leaves never seal a void (they decay): a record cell of leaves is not done, leaves under the base are no ground
  assert.strictEqual(voidOf(mound({ set: { [beside]: 'oak_leaves' } })).why, `boundary_open ${beside}`)
  assert.strictEqual(voidOf(mound({ set: { [under]: 'oak_leaves' } })).why, `boundary_foreign ${under}`)
  assert.strictEqual(voidOf(mound({ set: { [k(RUN[3])]: 'water' } })).why, `liquid ${k(RUN[3])}`)
  assert.strictEqual(voidOf(mound({ pocket: [-1, 0, 1].flatMap(dx => [-2, -1, 0, 1, 2, 3].map(dz => [CX + dx, G, CZ + dz])) })).why, 'too_big', 'an enclosed hollow of 20 cells is no small void')
  assert.strictEqual(voidOf(mound(), [CX - 1, BASE, CZ]).why, 'not_open', 'a cell that holds a block')
  assert.strictEqual(SC.sealedVoid({ cells: [] }, C1, mound().read, { palette: PAL, isDone: () => true }).why, 'no_box')
})
await t('never a cell that holds a block, a cell of another blueprint, a cell this visit did not defer', () => {
  const m = mound()
  const solid = k([CX - 2, BASE, CZ])
  assert.deepStrictEqual(due(m, { deferred: [{ k: solid, why: 'sealed no_stand', visits: 9 }], access: null }).due, [])
  assert.deepStrictEqual(due(m, { deferred: [], access: null }).due, [])
  assert.deepStrictEqual(due({ ...m, record: { ...m.record, blueprint: 'wall@1' } }).due, [])
  assert.deepStrictEqual(due(m, { deferred: [{ k: '0,0,0', visits: 9 }] }).due, [])
})
await t('sealedCoreWaived / zigAlsoDone: the record\'s map, the monument only, and SEALEDCORE=off reads it open again (zigHidden itself)', () => {
  const m = mound({ waived: { [K1]: { why: 'sealed_core' } } })
  const c1 = { at: C1, role: 'core' }, c2 = { at: C2, role: 'core' }
  assert.strictEqual(SC.sealedCoreWaived(m.record, c1, {}), true)
  assert.strictEqual(SC.sealedCoreWaived(m.record, c2, {}), false)
  assert.strictEqual(SC.sealedCoreWaived({ ...m.record, blueprint: 'wall@1' }, c1, {}), false)
  assert.strictEqual(SC.sealedCoreWaived(m.record, c1, { SEALEDCORE: 'off' }), false)
  assert.strictEqual(SC.zigAlsoDone(m.record, {})(c1, m.read), true)
  assert.strictEqual(SC.zigAlsoDone(m.record, {})(c2, m.read), false)
  assert.strictEqual(SC.zigAlsoDone(m.record, { SEALEDCORE: 'off' }), Z.zigHidden, 'off: the very function the visit had')
  // zigHidden is kept: a one-cell hollow is done with no waiver (the old rule)
  const one = mound({ pocket: [], set: { [K2]: 'dirt' } })
  assert.strictEqual(SC.zigAlsoDone(one.record, {})({ at: C1, role: 'core' }, one.read), true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(SC.sealedCoreOn({ SEALEDCORE: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(SC.sealedCoreOn({ SEALEDCORE: v }), true, String(v))
})
await t('the rows survive the formatter: op=waived with its void and visits; op=waive_held with its reason', () => {
  const a = SHOP.buildRowDetail({ project: 'monument', op: 'waived', cell: C1, gen: 9, n: 6, visits: 5, why: SC.SEALED_WHY })
  assert.strictEqual(a, `project=monument op=waived cell=${K1} gen=9 visits=5 n=6 why=sealed_core`)
  const b = SHOP.buildRowDetail({ project: 'monument', op: 'waive_held', cell: C1, n: 2, visits: 3, why: `${SC.SEALED_WHY} boundary_foreign ${CX + 7},${G},${CZ}` })
  assert.strictEqual(b, `project=monument op=waive_held cell=${K1} visits=3 n=2 why=sealed_core_boundary_foreign_${CX + 7},${G},${CZ}`)
  assert.strictEqual(TIDY.gkStopAfterWaive('stuck_on_cell', 2), 'cell_waived'); assert.strictEqual(TIDY.gkStopAfterWaive('stuck_on_cell', 0), 'stuck_on_cell')
})

console.log('MUTANTS (each condition killed for its own reason)')
const M = (name, old, neu, scenario) => t(`MUTANT ${name}`, () => killed(old, neu, scenario))
await M('the fill role is not asked: a sealed skin cell becomes a candidate', "|| !fillRole(palette, c.role)) continue", ') continue', Mod => {
  const d = due(mound({ roles: { [K1]: 'skin' } }), { Mod })
  assert.ok(!d.held.some(h => h.k === K1) && !d.due.some(o => o.k === K1))
})
await M('a visible cell in the void is passed: the core cell under an open skin cell is waived', 'if (rc && !fillRole(palette, rc.role)) return', 'if (false) return', Mod => {
  const over = k([CX, BASE + 1, CZ])
  assert.deepStrictEqual(due(mound({ roles: { [over]: 'skin' }, set: { [over]: 'air' } }), { Mod }).due, [])
})
await M('a boundary cell that is not done is passed', 'if (nc) { if (!isDone(nc, read)) return', 'if (nc) { if (false) return', Mod => {
  assert.deepStrictEqual(due(mound({ roles: { [k([CX - 1, BASE, CZ])]: 'skin' } }), { Mod }).due, [])
})
await M('a boundary block that is neither the record\'s nor ground under the base is passed', 'if (!(n[1] < baseY && inBox(n) && solidFloor(nb))) return', 'if (false) return', Mod => {
  assert.strictEqual(voidOf(mound({ drop: [k([CX - 1, BASE, CZ])] }), C1, { Mod }).ok, false)
})
await M('"under the base" is not asked of a stray boundary block', 'if (!(n[1] < baseY && inBox(n) && solidFloor(nb))) return', 'if (!(inBox(n) && solidFloor(nb))) return', Mod => {
  assert.strictEqual(voidOf(mound({ drop: [k([CX - 1, BASE, CZ])] }), C1, { Mod }).ok, false)
})
await M('the box is not asked of the ground round the void', 'if (!(n[1] < baseY && inBox(n) && solidFloor(nb))) return', 'if (!(n[1] < baseY && solidFloor(nb))) return', Mod => {
  assert.strictEqual(voidOf(mound({ pocket: [0, 1, 2, 3, 4, 5, 6].map(i => [CX + i, G, CZ]) }), C1, { Mod }).ok, false)
})
await M('any block under the base is ground (a log)', 'if (!(n[1] < baseY && inBox(n) && solidFloor(nb))) return', 'if (!(n[1] < baseY && inBox(n))) return', Mod => {
  assert.strictEqual(voidOf(mound({ set: { [k([CX + 1, G - 1, CZ])]: 'spruce_log' } }), C1, { Mod }).ok, false)
})
await M('a void cell outside the box is passed', "if (!inBox(c)) return { ok: false, why: `box_edge ${k}` }", '', Mod => {
  assert.match(voidOf(mound({ pocket: [0, 1, 2, 3, 4, 5, 6, 7].map(i => [CX + i, G, CZ]) }), C1, { Mod }).why, /^box_edge /)
})
await M('an unread cell round the void is passed over', "if (!nb) return { ok: false, why: `unread ${nk}` }", 'if (!nb) continue', Mod => {
  const m = mound(), key = k([CX + 2, G - 1, CZ])
  assert.strictEqual(voidOf(m, C1, { Mod, read: (x, y, z) => (`${x},${y},${z}` === key ? null : m.read(x, y, z)) }).ok, false)
})
await M('the void\'s size is not bounded (an enclosed hollow of 20 cells)', "if (cells.length > voidMax) return { ok: false, why: 'too_big' }", '', Mod => {
  assert.strictEqual(voidOf(mound({ pocket: [-1, 0, 1].flatMap(dx => [-2, -1, 0, 1, 2, 3].map(dz => [CX + dx, G, CZ + dz])) }), C1, { Mod }).ok, false)
})
await M('a liquid in the void is passed', 'if (LIQUIDISH.test(nm(read(...c)))) return', 'if (false) return', Mod => {
  assert.strictEqual(voidOf(mound({ set: { [k(RUN[3])]: 'water' } }), C1, { Mod }).ok, false)
})
await M('a cell that holds a block is flooded from', "if (wallBlock(b0)) return { ok: false, why: 'not_open' }", '', Mod => {
  assert.deepStrictEqual(due(mound(), { Mod, deferred: [{ k: k([CX - 2, BASE, CZ]), why: 'sealed no_stand', visits: 9 }], access: null }).due, [])
})
await M('the deferring visits are not counted', 'if (visits < after) {', 'if (false) {', Mod => {
  assert.deepStrictEqual(due(mound(), { Mod, deferred: DEFERRED(4) }).due, [])
})
await M('the lifetime tally is not read', 'Math.max(Number(counts?.[k]?.visits) || 0, Number(d?.visits) || 0)', 'Number(d?.visits) || 0', Mod => {
  assert.strictEqual(due(mound(), { Mod, deferred: DEFERRED(1), counts: { [K1]: { visits: 5 }, [K2]: { visits: 5 } } }).due.length, 2)
})
await M('the access is not asked', "if (access !== null && !(access?.result === 'refused' && access.noPlan === true && (access.cells ?? []).includes(k))) {", 'if (false) {', Mod => {
  assert.deepStrictEqual(due(mound(), { Mod, access: undefined }).due, [])
})
await M('a short bag counts as no plan', "access?.result === 'refused' && access.noPlan === true && ", "access?.result === 'refused' && ", Mod => {
  assert.deepStrictEqual(due(mound(), { Mod, access: { result: 'refused', noPlan: false, cells: [K1, K2] } }).due, [])
})
await M('the access\'s own cells are not asked', ' && (access.cells ?? []).includes(k))) {', ')) {', Mod => {
  assert.deepStrictEqual(due(mound(), { Mod, access: { ...REFUSED, cells: [K1] } }).due.map(o => o.k), [K1])
})
await M('a visit with no void access never waives', 'if (access !== null && !(', 'if (!(', Mod => {
  assert.strictEqual(due(mound(), { Mod, access: null }).due.length, 2)
})
await M('the cap is not kept', 'if (room <= 0) {', 'if (false) {', Mod => {
  const full = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${CX - 2},${BASE},${CZ - 2 + i}`, { why: 'sealed_core' }]))
  assert.deepStrictEqual(due(mound({ waived: full }), { Mod }).due, [])
})
await M('another blueprint\'s waived map reads as the monument\'s', 'return sealedCoreOn(env) && isZigBlueprint(rec?.blueprint) && !!rec?.waived', 'return sealedCoreOn(env) && !!rec?.waived', Mod => {
  assert.strictEqual(Mod.sealedCoreWaived({ blueprint: 'wall@1', waived: { [K1]: {} } }, { at: C1 }, {}), false)
})
await M('the switch (SEALEDCORE never read): off no longer turns it off', "String(env?.SEALEDCORE ?? '')", "String(env?.SEALEDCORE_ ?? '')", Mod => {
  assert.strictEqual(Mod.sealedCoreOn({ SEALEDCORE: 'off' }), false)
  assert.strictEqual(Mod.sealedCoreWaived(mound({ waived: { [K1]: {} } }).record, { at: C1 }, { SEALEDCORE: 'off' }), false)
})
await M('off no longer hands the visit zigHidden itself', 'if (!sealedCoreOn(env)) return zigHidden', 'if (false) return zigHidden', Mod => {
  assert.strictEqual(Mod.zigAlsoDone(mound({ waived: { [K1]: {} } }).record, { SEALEDCORE: 'off' }), Z.zigHidden)
})

// ---- THE CHAIN (fake server, the real runVisit and the real void access) -------------------------------------------------------
// the WIDE pocket: the ground under the two cells and under every cell beside them is air, so every shaft the access could dig
// lands on a cell that is not the record's (the live refusal's own reason: its plan would dig cells that are not in the record)
console.log('THE CHAIN (fake server): deferred, stuck, the access refused, the waiver, the 13 built')
/** The fake bot with a body (voidfill.test.mjs): walks teleport, a dig underfoot drops it, a pillar's place lifts it. */
function body (srv, inv) {
  const e = bot(srv, 'A', inv ? { inv } : {})
  let at = [2, G + 1, 0], risen = false
  e.feet = () => at.slice()
  e.walkTo = async s => { at = s.slice(); return true }
  e.count = n => e.inv[n] ?? 0
  e.rise = async () => { risen = true; return true }
  e.land = async () => { if (risen && srv.read(...at)?.boundingBox === 'block') at[1]++; risen = false }
  e.settle = async () => { while (srv.read(at[0], at[1] - 1, at[2])?.boundingBox === 'empty') at[1]-- }
  e.tool = async () => {}
  // (the fake checks every row against the log formatter; buildrun's own `access_refused` row carries a `why` of up to 140
  // characters and the formatter keeps 120 -- as on the live rows; not this piece's row: kept, unchecked)
  const log0 = e.log
  e.log = (kk, d) => (kk === '_build' && d?.op === 'access_refused' ? e.logs.push([kk, d]) : log0(kk, d))
  return e
}
async function visit (Mod, pr, srv, mem, { inv } = {}) {
  const h = PJ.recordHead(pr.dir, pr.key), rec = h.head.rec
  const e = body(srv, inv)
  const r = await Mod.runVisit({ ...pr.p('A'), palette: PAL, record: rec, recordGen: h.head.gen, domain: () => true, walkR: 64, feetIn: () => true,
    alsoDone: SC.zigAlsoDone(rec, {}), access: { mem, mayDig: () => true } }, e, { maxSteps: 4000 })
  return { r, rec, rows: e.logs.filter(([kk]) => kk === '_build').map(([, d]) => d), read: srv.read }
}
/** The visit's waiver as skills.mjs buildMonument runs it after runVisit. */
function waive (pr, v, { access = v.r.access } = {}) {
  const sc = SC.sealedCoreDue(v.rec, v.r.deferred ?? [], { read: v.read, palette: PAL, isDone: doneOf(v.rec), access })
  if (sc.due.length) PJ.publishRecord(pr.dir, pr.key, cur => SC.withSealedCore(cur, sc.due, { by: 'A' }), { by: 'A' })
  return sc
}
await t('five visits defer the two cells (stuck from the third, 15 cells waiting); the access finds no plan; the fifth waives; the sixth builds the 13 and completes', async () => {
  const m = mound({ pocket: WIDE })
  assert.strictEqual(voidOf(m).cells.length, 14, 'the wide pocket is one enclosed void of 14 cells')
  const srv = server(m.world), pr = project(m.record)
  const stops = [], acc = [], held = []
  let v = null
  for (let i = 1; i <= SC.SEALED_CORE.after; i++) {
    v = await visit(R, pr, srv, {})          // a fresh access memory: a visit of the live fleet is hours after the last
    stops.push(v.r.stop); acc.push(v.r.access?.result)
    assert.strictEqual(v.r.placed, 0, 'nothing is placed while L00 is open: the 13 wait')
    if (i < SC.SEALED_CORE.after) { const sc = waive(pr, v); assert.deepStrictEqual(sc.due, [], `visit ${i} waives nothing`); held.push(sc.held[0]?.why) }
  }
  assert.deepStrictEqual(stops, ['cell_deferred', 'cell_deferred', 'stuck_on_cell', 'stuck_on_cell', 'stuck_on_cell'])
  assert.deepStrictEqual(acc, ['young', 'young', 'refused', 'refused', 'refused'])
  assert.deepStrictEqual(held, ['young 1/5', 'young 2/5', 'young 3/5', 'young 4/5'])
  const stuck = v.rows.find(d => d.op === 'stuck_on_cell')
  assert.ok(stuck && stuck.stalled === true && stuck.waiting === 15 && stuck.visits === 5, JSON.stringify(stuck))
  const refused = v.rows.find(d => d.op === 'access_refused')
  assert.ok(refused && /^no_plan \(/.test(refused.why) && /not_record/.test(refused.why), `the real access refused for cells that are not the record's: ${refused?.why}`)
  assert.deepStrictEqual(v.r.access, { result: 'refused', seg: 'L00', noPlan: true, cells: [K1, K2] })
  assert.deepStrictEqual(v.r.deferred.map(d => [d.k, d.visits]), [[K1, 5], [K2, 5]])
  assert.ok(Number.isFinite(PJ.stuckAt(pr.dir, pr.key)), 'the stall stamped the project')
  // THE WAIVER
  const sc = waive(pr, v)
  assert.deepStrictEqual(sc.due.map(o => [o.k, o.why, o.n]), [[K1, 'sealed_core', 14], [K2, 'sealed_core', 14]])
  const head = PJ.recordHead(pr.dir, pr.key).head.rec
  assert.deepStrictEqual(Object.keys(head.waived), [K1, K2])
  // the order's reading of the stamp (skills.mjs projStuckLive): every cell it names reads done now -- it holds nothing
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key, { stale: ks => SHOP.stuckStale(ks, head, c => doneOf(head)(c, srv.read)) }), null)
  assert.ok(Number.isFinite(PJ.stuckAt(pr.dir, pr.key, { stale: ks => SHOP.stuckStale(ks, m.record, c => doneOf(m.record)(c, srv.read)) })), 'positive control: the record before the waiver holds it')
  // THE NEXT VISIT: the 13 are workable and built, the record complete, the two cells still air, the stuck map empty
  const w = await visit(R, pr, srv, {})
  assert.strictEqual(w.r.stop, 'complete', `${w.r.stop} ${w.r.why}`)
  assert.strictEqual(w.r.placed, 13)
  for (const c of DEPS) assert.strictEqual(srv.read(...c).name, 'cobblestone', `${k(c)} built`)
  for (const c of [C1, C2, ...WIDE]) assert.strictEqual(srv.read(...c).name, 'air', `${k(c)} untouched`)
  assert.ok(!w.rows.some(d => d.op === 'deferred' || d.op === 'stuck_on_cell' || d.op === 'access_refused'))
  assert.deepStrictEqual(PJ.stuckRead(pr.dir, pr.key), {})
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key), null)
})
await t('positive control (SEALEDCORE off: nothing waived): a sixth visit is stuck again and the 13 are never built', async () => {
  const m = mound({ pocket: WIDE })
  const srv = server(m.world), pr = project(m.record)
  let v = null
  for (let i = 1; i <= SC.SEALED_CORE.after + 1; i++) v = await visit(R, pr, srv, {})
  assert.strictEqual(v.r.stop, 'stuck_on_cell')
  assert.ok(DEPS.every(c => srv.read(...c).name === 'air'))
  assert.strictEqual(PJ.recordHead(pr.dir, pr.key).head.rec.waived, undefined)
})
await t('the same bot again inside the access window (`spent`): no refusal this visit, so no waiver this visit', async () => {
  const m = mound({ pocket: WIDE })
  const srv = server(m.world), pr = project(m.record), mem = {}
  let v = null
  const acc = []
  for (let i = 1; i <= SC.SEALED_CORE.after; i++) { v = await visit(R, pr, srv, mem); acc.push(v.r.access?.result) }
  assert.deepStrictEqual(acc, ['young', 'young', ...Array(V.ACCESS_TRIES).fill('refused'), 'spent'])
  const sc = waive(pr, v)
  assert.deepStrictEqual(sc.due, []); assert.deepStrictEqual(sc.held.map(h => h.why), ['access_spent', 'access_spent'])
})
await t('a void the access CAN fill is filled, never waived (the access first): two open cells on solid ground', async () => {
  const m = mound({ pocket: [] })
  const srv = server(m.world), pr = project(m.record), mem = {}
  let v = null, waived = 0
  const seen = []
  for (let i = 0; i < 6 && v?.r.stop !== 'complete'; i++) {
    v = await visit(R, pr, srv, mem, { inv: { cobblestone: 64 } })
    seen.push(`${v.r.stop}/${v.r.access?.result ?? '-'}:${v.rows.filter(d => /^access/.test(d.op)).map(d => `${d.op}=${d.result ?? ''}${String(d.why ?? '').slice(0, 150)}`).join('|')}`)
    waived += waive(pr, v).due.length
  }
  if (v.r.stop !== 'complete') { DEBUG.push(...seen, `deferred ${JSON.stringify(v.r.deferred)}`, `open ${PJ.recordHead(pr.dir, pr.key).head.rec.cells.filter(c => !doneOf(m.record)(c, srv.read)).map(c => k(c.at)).join(' ')}`) }
  assert.strictEqual(v.r.stop, 'complete', `${v.r.stop} ${v.r.why}`)
  assert.strictEqual(waived, 0)
  for (const c of [C1, C2]) assert.strictEqual(srv.read(...c).name, 'cobblestone', `${k(c)} filled by the access`)
  assert.strictEqual(PJ.recordHead(pr.dir, pr.key).head.rec.waived, undefined)
})
await t('the run shape end to end: the access fills the cell that has ground under it; the one over the run has no plan and is waived on its fifth visit', async () => {
  const m = mound()
  const srv = server(m.world), pr = project(m.record)
  let v = null
  const seen = [], dues = []
  for (let i = 0; i < 8 && v?.r.stop !== 'complete'; i++) {
    v = await visit(R, pr, srv, {}, { inv: { cobblestone: 64 } })
    const sc = waive(pr, v)
    seen.push(`${v.r.stop}/${v.r.access?.result ?? '-'}/${(v.r.deferred ?? []).map(d => `${d.k}x${d.visits}`).join('+')}/due${sc.due.map(o => o.k).join('+')}/held${sc.held.map(h => h.why).join('+')}`)
    dues.push(...sc.due)
  }
  if (v.r.stop !== 'complete') DEBUG.push(...seen)
  assert.strictEqual(v.r.stop, 'complete', `${v.r.stop} ${v.r.why}`)
  assert.deepStrictEqual(dues.map(o => [o.k, o.n, o.visits]), [[K1, 5, 5]], `only the cell over the run, with the run (${seen.join(' ; ')})`)
  assert.strictEqual(srv.read(...C2).name, 'cobblestone', 'the access filled the cell on solid ground')
  assert.strictEqual(srv.read(...C1).name, 'air')
  assert.ok(seen.some(q => /\/done\//.test(q)) && seen.some(q => /\/refused\//.test(q)), seen.join(' ; '))
  assert.ok(m.record.cells.every(c => doneOf(PJ.recordHead(pr.dir, pr.key).head.rec)(c, srv.read)), 'every cell reads done')
})
await t('a bag short of an access plan is `refused` with noPlan false (never the waiver\'s refusal)', async () => {
  const m = mound()
  const srv = server(m.world), pr = project(m.record)
  let v = null
  for (let i = 0; i < 3; i++) v = await visit(R, pr, srv, {}, { inv: { cobblestone: 1 } })
  assert.ok(v.rows.some(d => d.op === 'access_refused' && /^no_material/.test(d.why)), JSON.stringify(v.rows.map(d => d.op)))
  assert.deepStrictEqual(v.r.access, { result: 'refused', seg: 'L00', noPlan: false, cells: [] })
  assert.deepStrictEqual(waive(pr, { ...v, r: { ...v.r, deferred: DEFERRED(9) } }).due, [], 'even at nine visits')
})
await t('MUTANT (buildrun): the access result is not put on the visit -> the waiver never has its refusal', async () => {
  const run = async Mod => { const m = mound({ pocket: WIDE }); const srv = server(m.world), pr = project(m.record); let v = null; for (let i = 0; i < 3; i++) v = await visit(Mod, pr, srv, {}); return v.r.access }
  assert.deepStrictEqual(await run(R), { result: 'refused', seg: 'L00', noPlan: true, cells: [K1, K2] })
  await withMutant('            out.access = { result: a.result, seg, noPlan: a.noPlan === true, cells: a.cells ?? [] }\n', '', async Mod => { assert.strictEqual(await run(Mod), undefined) })
  await withMutant("return { result: 'refused', noPlan: true, cells: stuck } }", "return { result: 'refused' } }", async Mod => { assert.deepStrictEqual(await run(Mod), { result: 'refused', seg: 'L00', noPlan: false, cells: [] }) })
})

console.log('WIRING (structural: the monument visit is not reachable offline; comments stripped, executable lines)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const SKS = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const WIRES = [
  ['the visit\'s alsoDone is built from the record (off: zigHidden itself)', /const zAlso = zigAlsoDone\(rec\)/],
  ['...and passed to the visit', /feetIn: zigFeetIn, alsoDone: zAlso, clearMax: ZIG_CLEAR_MAX,/],
  ['...to the draw\'s workable test', /workableSeg\(rec, read, palette, segFree, zAlso\)/],
  ['...and to the progress the visit row names', /const pal = zigPaletteOf\(rec\), also = zigAlsoDone\(rec\)/],
  ['the waiver runs only with the switch on, on what the visit deferred', /if \(sealedCoreOn\(\) && \(r\.deferred \?\? \[\]\)\.length\) \{/],
  ['a boundary cell is judged by the order\'s own cell test', /const sc = sealedCoreDue\(rec, r\.deferred, \{ read: rdNow, palette, isDone: q => recordCellDone\(bot, rec, q\),/],
  ['the waiver reads a fresh world, the visit\'s access (none configured: not applicable) and the lifetime tally', /access: zigAccessOf\(bot, c\) \? r\.access : null, counts: sinkDeferCounts\(dir, key, me, r\.deferred, k => openK\.has\(k\)\) \}\)/],
  ['the record\'s next generation names the cells (a monument record of the same cells only)', /cur && isZigBlueprint\(cur\.blueprint\) && cur\.cells\.length === rh\.head\.rec\.cells\.length \? withSealedCore\(cur, sc\.due, \{ by: me \}\) : null/],
  ['the row: op=waived why=sealed_core', /op: 'waived', cell: d\.k\.split\(','\)\.map\(Number\), gen: pub\.gen, n: d\.n, visits: d\.visits, why: SEALED_WHY \}/],
  ['a refusal of the rule is named once a visit', /op: 'waive_held', cell: d\.k\.split\(','\)\.map\(Number\), n: sc\.held\.length, visits: d\.visits, why: `\$\{SEALED_WHY\} \$\{d\.why\}` \}/],
  ['a visit that waived ends cell_waived', /const stopZ = gkStopAfterWaive\(r\.stop, waivedN\)/],
  ['a waived cell is done for the order\'s cell test', /if \(mon && sealedCoreWaived\(r, c\)\) return true/],
  ['...and no damage of a complete monument', /if \(mon && sealedCoreWaived\(r, c\)\) continue/],
  ['the order drops a stamp whose cells were waived since, with the switch', /if \(isZigBlueprint\(rec\?\.blueprint\) && sealedCoreOn\(\) && rec\?\.waived && stuckStale\(keys, rec, c => recordCellDone\(b, rec, c\)\)\) return true/],
]
for (const [name, re] of WIRES) {
  await t(`${name} (and a mutant of the line is not matched)`, () => {
    assert.ok(re.test(SKS), 'wired')
    const m = SKS.match(re)[0]
    assert.strictEqual(SKS.split(m).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.ok(!re.test(SKS.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant of the executable line is not matched')
  })
}

for (const f of FAILED.slice(0, 30)) console.log(`  FAILED  ${f}`)
for (const d of DEBUG.slice(0, 12)) console.log(`  DEBUG   ${String(d).slice(0, 900)}`)
console.log(`\nsealedcore: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
