// REROOF-02 (reroof.mjs; skills.mjs buildReroof; decorator.mjs siteDecor/decorRetire): the showcase retrofit out of candidates
// (LIVE 11-05: 9 of 9 visits no_site -- house1 and storehub under decorator lanterns, the workshop's east apex with no stand). Behaviour
// of every fix on the pure functions, the retrofit BUILT on the fake vanilla through a lantern post, canopy leaves and a stray dirt in
// its roof's cells, and anchored mutants for each.
import assert from 'node:assert'
import fs from 'node:fs'
const T = await import('../src/townstyle.mjs')
const RR = await import('../src/reroof.mjs')
const D = await import('../src/decorator.mjs')
const F = await import('./helpers/buildfake.mjs')
const { B, R, PJ, HOME, G, k3 } = F
const { STYLE, vanillaBot, kitFor, withSrcMutant } = await import('./helpers/townstylefake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** BOTH WAYS: the scenario passes on the real module and throws on the mutant (its anchor present and unique: withSrcMutant). */
const killed = async (file, old, neu, scenario) => {
  await scenario(RR)
  let k = false
  await withSrcMutant(file, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}
const blk = (name, bb = name === 'air' ? 'empty' : 'block') => ({ name, boundingBox: bb })
const worldOf = (cells, dflt = y => (y < 70 ? 'stone' : 'air')) => (x, y, z) => { const n = cells[`${x},${y},${z}`] ?? dflt(y); return blk(n, /^(air|short_grass|spruce_sapling)$/.test(n) ? 'empty' : 'block') }

console.log('THE SWITCHES')
await t('reroofFixes: every fix on by default, each REROOF_<X>=off its own rollback; the licence row names them', () => {
  assert.deepStrictEqual(RR.reroofFixes({}), { avoid: true, decor: true, clutter: true, fresh: true, doorstep: true, roofTree: true, ordered: true, access: true })   // reroof-03 adds two, reroof-04 one
  for (const [env, key] of [['REROOF_DECOR_AVOID', 'avoid'], ['REROOF_DECOR_CLEAR', 'decor'], ['REROOF_CLUTTER_CLEAR', 'clutter'], ['REROOF_FAILS_FRESH', 'fresh'], ['REROOF_DOORSTEP', 'doorstep'], ['REROOF_ROOFTREE', 'roofTree'], ['REROOF_ORDERED', 'ordered']]) {
    const f = RR.reroofFixes({ [env]: 'off' })
    assert.strictEqual(f[key], false, env); assert.strictEqual(Object.values(f).filter(v => !v).length, 1, `${env} turns off only ${key}`)
  }
  assert.match(RR.reroofModeDetail(true, RR.reroofFixes({ REROOF_DOORSTEP: '0' })), /^on=1 v=2 avoid=1 decor=1 clutter=1 fresh=1 doorstep=0 rooftree=1 ordered=1 access=1 fails_max=3 fails_ttl_h=6$/)
})

console.log('(c) THE FAILURE COUNTS')
await t('reroofFailCount / reroofFailBump: fresh -- the old plain numbers (LIVE 3/3/3) read 0, a versioned entry counts until its TTL; off -- the numbers as before', () => {
  const now = 10 * 3_600_000
  assert.strictEqual(RR.reroofFailCount(3, { now, fresh: true }), 0, 'the live file\'s plain 3 reads 0: the release starts fresh')
  assert.strictEqual(RR.reroofFailCount(3, { now, fresh: false }), 3, 'POSITIVE CONTROL: off, the plain number as before')
  const e1 = RR.reroofFailBump(3, { now, fresh: true })
  assert.deepStrictEqual(e1, { v: 2, n: 1, at: now }, 'the first failure under fresh starts at 1')
  const e3 = RR.reroofFailBump(RR.reroofFailBump(e1, { now, fresh: true }), { now, fresh: true })
  assert.strictEqual(RR.reroofFailCount(e3, { now, fresh: true }), 3)
  assert.strictEqual(RR.reroofFailCount(e3, { now: now + RR.REROOF_FAILS_TTL_MS - 1, fresh: true }), 3)
  assert.strictEqual(RR.reroofFailCount(e3, { now: now + RR.REROOF_FAILS_TTL_MS, fresh: true }), 0, 'expired: the building is tried again')
  assert.strictEqual(RR.reroofFailBump(e3, { now: now + RR.REROOF_FAILS_TTL_MS, fresh: true }).n, 1, 'an expired entry restarts at 1')
  assert.strictEqual(RR.reroofFailBump(2, { fresh: false }), 3)
  assert.strictEqual(RR.reroofFailCount({ v: 1, n: 5, at: now }, { now, fresh: true }), 0, 'another version: not counted')
})
await t('reroofNext with the live file: fresh passes nothing over; three fresh failures pass the building over until the TTL', async () => {
  const done = blueprint => ({ blueprint, structure_complete: true })
  const recs = { house1: done('house@1'), shop: done('workshop@1'), storehub: done('storehub@1') }
  const live = { house1: 3, shop: 3, storehub: 3 }
  const now = 1_000_000_000
  await killed('reroof.mjs', "  if (!entry || typeof entry !== 'object' || entry.v !== REROOF_FAILS_V) return 0\n", "  if (!entry || typeof entry !== 'object' || entry.v !== REROOF_FAILS_V) return Number(entry) || 0\n", M => {
    assert.strictEqual(M.reroofNext(recs, { logs: 200, failed: live, fresh: false, now }).why, 'none', 'POSITIVE CONTROL: the base passes all three over')
    assert.strictEqual(M.reroofNext(recs, { logs: 200, failed: live, fresh: true, now }).target.plot, 'house1', 'fresh: house1 is due again')
  })
  const f3 = { house1: { v: 2, n: 3, at: now } }
  assert.strictEqual(RR.reroofNext(recs, { logs: 200, failed: f3, fresh: true, now }).target.plot, 'shop')
  assert.strictEqual(RR.reroofNext(recs, { logs: 200, failed: f3, fresh: true, now: now + RR.REROOF_FAILS_TTL_MS }).target.plot, 'house1')
})

console.log('(a) THE PENDING ROOF\'S CELLS')
await t('reroofPendingCells: the live house1 record -> its eave cells -33,72,-8 and -33,72,-4 (both posts\' lanterns) are pending; a styled record adds none', () => {
  const house1 = { blueprint: 'house@1', anchor: [-33, -9], s: 69, orient: 'S', structure_complete: true }
  const storehub = { blueprint: 'storehub@1', anchor: [28, -49], s: 70, orient: 'W', structure_complete: true }
  const cells = RR.reroofPendingCells({ house1, storehub }, { bpOf: B.loadBlueprint })
  for (const k of ['-33,72,-8', '-33,72,-4', '22,73,-49']) assert.ok(cells.has(k), k)
  assert.ok(!cells.has('-33,71,-8'), 'the fence\'s own cell is no roof cell')
  const none = RR.reroofPendingCells({ house1: { ...house1, style: { wood: 'spruce' } } }, { bpOf: B.loadBlueprint })
  assert.strictEqual(none.size, 0)
  assert.strictEqual(RR.reroofPendingCells({ house1: { ...house1, blueprint: 'house@2' } }, { bpOf: B.loadBlueprint }).size, 0, 'another blueprint: never a target')
})

console.log('(b) WHAT STANDS IN THE ADDED CELLS')
const DECOR = { cells: [{ at: [5, 71, 5], role: 'D1-post', seg: 'D1-L0' }, { at: [5, 72, 5], role: 'D1-lamp', seg: 'D1-L0' }, { at: [9, 72, 9], role: 'D2-pot', seg: 'D2-B0' }] }
await t('reroofObstacles: a lantern post goes WHOLE (fence + lantern, kind decor_post, both retired), leaves and scaffold clutter are dug, a log / a record cell / a chest block it', async () => {
  const world = { '5,71,5': 'spruce_fence', '5,72,5': 'lantern', '6,72,5': 'spruce_leaves', '7,72,5': 'dirt', '9,72,9': 'flower_pot' }
  const cells = [[5, 72, 5], [6, 72, 5], [7, 72, 5], [8, 72, 5], [9, 72, 9]]
  await killed('reroof.mjs', "    if (fx.decor && role && DECOR_ORNAMENT_RX.test(role)) {\n", "    if (false) {\n", M => {
    const o = M.reroofObstacles(worldOf(world), cells, { decor: DECOR, fx: M.reroofFixes({}) })
    assert.strictEqual(o.blocker, null, JSON.stringify(o.blocker))
    assert.deepStrictEqual(o.clear.map(c => `${c.kind}:${c.name}@${c.at.join(',')}`), ['decor_post:spruce_fence@5,71,5', 'decor_post:lantern@5,72,5', 'leaves:spruce_leaves@6,72,5', 'foreign:dirt@7,72,5', 'decor_post:flower_pot@9,72,9'], 'low before high')
    assert.deepStrictEqual(o.retire.map(a => a.join(',')).sort(), ['5,71,5', '5,72,5', '9,72,9'])
  })
  const blocker = (w, extra = {}) => RR.reroofObstacles(worldOf(w), [[6, 72, 5]], { decor: DECOR, fx: RR.reroofFixes({}), ...extra }).blocker
  assert.deepStrictEqual(blocker({ '6,72,5': 'spruce_log' }), { at: [6, 72, 5], name: 'spruce_log' }, 'a log: felling owes saplings, never dug here')
  assert.deepStrictEqual(blocker({ '6,72,5': 'chest' }), { at: [6, 72, 5], name: 'chest' })
  assert.deepStrictEqual(blocker({ '6,72,5': 'spruce_leaves' }, { recordAt: () => 'decor' }), { at: [6, 72, 5], name: 'spruce_leaves' }, 'leaves that are a record\'s cell (a hedge of another record): never')
  assert.deepStrictEqual(blocker({ '6,72,5': 'lantern' }), { at: [6, 72, 5], name: 'lantern' }, 'a lantern that is no decor ornament: never')
  assert.deepStrictEqual(RR.reroofObstacles(worldOf(world), [[5, 72, 5]], { decor: DECOR, fx: RR.reroofFixes({ REROOF_DECOR_CLEAR: 'off' }) }).blocker.name, 'lantern', 'REROOF_DECOR_CLEAR=off: the base refusal')
  assert.deepStrictEqual(RR.reroofObstacles(worldOf(world), [[6, 72, 5]], { decor: DECOR, fx: RR.reroofFixes({ REROOF_CLUTTER_CLEAR: 'off' }) }).blocker.name, 'spruce_leaves', 'REROOF_CLUTTER_CLEAR=off')
  assert.strictEqual(RR.reroofObstacles(() => null, [[1, 1, 1]], { decor: DECOR }).blocker.name, 'unknown', 'an unread cell is never a dig')
})
await t('Codex r1 BLOCKER: the decor cells retired by a retrofit whose building generation was never published are found again (resumable); another retirement is not', async () => {
  const decor = { cells: [{ at: [5, 71, 5], role: 'D1-post' }, { at: [5, 72, 5], role: 'D1-lamp' }] }
  const read = worldOf({ '5,71,5': 'spruce_fence', '5,72,5': 'lantern' })
  const first = RR.reroofObstacles(read, [[5, 72, 5]], { decor })
  const after = D.decorRetire(decor, first.retire.map(a => a.join(',')), { by: 'reroof:house1' })
  await killed('reroof.mjs', "  const roleAt = new Map([...(decor?.retired ?? []).filter(c => Array.isArray(c?.at) && /^reroof:/.test(String(c.by ?? ''))), ...(decor?.cells ?? []).filter(c => Array.isArray(c?.at))]", "  const roleAt = new Map([...(decor?.cells ?? []).filter(c => Array.isArray(c?.at))]", M => {
    const again = M.reroofObstacles(read, [[5, 72, 5]], { decor: after })
    assert.strictEqual(again.blocker, null); assert.strictEqual(again.clear.length, 2)
  })
  const other = D.decorRetire(decor, ['5,71,5', '5,72,5'], { by: 'gk' })
  assert.strictEqual(RR.reroofObstacles(read, [[5, 72, 5]], { decor: other }).blocker.name, 'lantern', 'POSITIVE CONTROL: a cell retired by anyone else is no ornament')
})
await t('reroofObstacles: a lamp\'s partner is dug only when it IS that post\'s fence (same instance id, the cell below)', () => {
  const dec = { cells: [{ at: [5, 72, 5], role: 'D1-lamp' }, { at: [5, 71, 5], role: 'D2-post' }] }
  const o = RR.reroofObstacles(worldOf({ '5,71,5': 'spruce_fence', '5,72,5': 'lantern' }), [[5, 72, 5]], { decor: dec, fx: RR.reroofFixes({}) })
  assert.deepStrictEqual(o.clear.map(c => c.at.join(',')), ['5,72,5'], 'another instance\'s fence stays')
})
await t('reroofClearsReached: a dig within DIG_REACH of the town walk (with the digs below it applied) is reached; one over a sealed roof is not', async () => {
  const w = {}
  for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) w[`${x},74,${z}`] = 'spruce_planks'   // a flat roof at 74, nothing under it walked
  w['5,75,5'] = 'spruce_leaves'; w['1,75,1'] = 'spruce_leaves'
  const home = { x: 0, y: 70, z: 0 }
  const r = RR.reroofClearsReached(worldOf(w), home, [{ at: [1, 75, 1], name: 'spruce_leaves' }, { at: [5, 75, 5], name: 'spruce_leaves' }], { walkR: 20 })
  assert.strictEqual(r.ok, false); assert.deepStrictEqual(r.unreached, [[5, 75, 5]], 'the one over open ground is reached, the one over the middle of the roof nobody reaches')
  assert.ok(RR.reroofClearsReached(worldOf(w), home, [{ at: [1, 75, 1], name: 'spruce_leaves' }], { walkR: 20 }).ok)
})

console.log('(d) THE DOORSTEP')
// a building facing -z: doorway local (4, 1, 1..2) -> world (4 + ax, s + 1, 1 + az) with orient E (rot E: dx = u, dz = v)
const doorBp = { doorway: [[4, 1, 1], [4, 1, 2]] }
const doorRec = { anchor: [0, 10], s: 72, orient: 'E' }
await t('reroofDoorstep: the doorway front 2 above the walk in front (LIVE workshop: path P-shop-3 ends at feet 71, the front at 73) -> the step at the walk\'s feet; 1 or 3 apart -> null', async () => {
  const front = (gy, extra = {}) => { const w = { '4,72,10': 'stone_bricks', ...extra }; for (let y = 60; y < gy; y++) w[`4,${y},9`] = 'dirt'; return worldOf(w, y => (y < 60 ? 'stone' : 'air')) }
  await killed('reroof.mjs', '    if (fy - y !== 2) return null\n', '', M => {
    assert.deepStrictEqual(M.reroofDoorstep(front(71), doorRec, doorBp), [4, 71, 9], 'two below: one step')
    assert.strictEqual(M.reroofDoorstep(front(72), doorRec, doorBp), null, 'one below: walked already')
    assert.strictEqual(M.reroofDoorstep(front(70), doorRec, doorBp), null, 'three below: one block cannot fix it')
  })
  assert.strictEqual(RR.reroofDoorstep(front(71, { '4,73,9': 'stone' }), doorRec, doorBp), null, 'no head room over the step: null')
  assert.strictEqual(RR.reroofDoorstep(front(71, { '4,73,10': 'stone' }), doorRec, doorBp), null, 'the front itself shut: null')
})
await t('reroofProofBlueprint: an interior cell a block stands in (the town\'s chest) is no floor to walk to; reroofRecord puts a proven doorstep first and lists the digs', () => {
  const bp = B.loadBlueprint('workshop@1')
  const nw = RR.reroofBlueprint(bp, 'gable')
  const base = RR.reroofProofBlueprint(bp, nw, STYLE)
  const occ = RR.reroofProofBlueprint(bp, nw, STYLE, { occupied: (u, v, y) => u === 2 && v === 2 && y === 1 })
  assert.strictEqual(base.interior.length - occ.interior.length, 1)
  const rec = { cells: [{ at: [0, 0, 0], role: 'base', seg: 'pad' }], segments: [{ seg: 'roof-inner' }], clear: [{ at: [9, 9, 9], kind: 'tree', name: 'oak_log' }] }
  const added = [{ at: [1, 1, 1], role: 'fill', seg: 'earth' }, { at: [2, 2, 2], role: 'gable', seg: 'gable' }]
  const r = RR.reroofRecord(rec, added, nw, STYLE, { now: 1, clear: [{ at: [3, 3, 3], kind: 'decor_post', name: 'lantern' }] })
  const segs = r.segments.filter(s => /^reroof-/.test(s.seg))
  assert.strictEqual(segs[0].seg, 'reroof-earth'); assert.deepStrictEqual(segs[0].deps, [])
  for (const s of segs.slice(1)) assert.ok(s.deps.includes('reroof-earth'), `${s.seg} after the doorstep`)
  assert.deepStrictEqual(r.clear, [{ at: [9, 9, 9], kind: 'tree', name: 'oak_log' }, { at: [3, 3, 3], kind: 'decor_post', name: 'lantern' }], 'the old clears kept, the new ones after')
  const r0 = RR.reroofRecord(rec, added.slice(1), nw, STYLE, { now: 1 })
  assert.ok(!r0.segments.some(s => s.seg === 'reroof-earth') && r0.clear === rec.clear, 'POSITIVE CONTROL: no doorstep, no digs -- as before')
})

console.log('THE RETROFIT BUILT THROUGH WHAT STANDS IN ITS ROOF (fake vanilla)')
await t('house@1 built flat; a decor lantern post, canopy leaves and a stray dirt in its roof\'s cells: proven, retired, dug by its own visit, the roof complete', async () => {
  const bp = B.loadBlueprint('house@1')
  const srv = F.server()
  const site = B.siteBlueprint(srv.read, F.plan(), bp, { tries: 3, plot: 'house1' })
  assert.ok(site.ok, site.why)
  const pr = F.project(site.record)
  const kit = kitFor({ ...bp, palette: { ...bp.palette, trim: ['$planks'] } })
  const bpNew = RR.reroofBlueprint(bp, 'gable')
  const styled = T.stylePalette(bpNew.palette, STYLE)
  for (const c of RR.reroofAdded(bp, bpNew)) { const n = R.roleFirst(styled, c.role); kit[n] = (kit[n] ?? 0) + 1 }
  const e = vanillaBot(srv, 'A', { inv: kit })
  const visit = async (rec, gen, palette) => R.runVisit({ ...pr.p('A'), record: rec, recordGen: gen, palette, walkR: 30 }, e, { maxSteps: 3000, barrierWaitMs: 50, deadline: Date.now() + 40_000 })
  let h = PJ.recordHead(pr.dir, pr.key), r = null
  for (let i = 0; i < 4 && r?.stop !== 'complete'; i++) r = await visit(h.head.rec, h.head.gen, bp.palette)
  assert.strictEqual(r.stop, 'complete', `the flat house: ${r.stop}`)
  PJ.publishRecord(pr.dir, pr.key, cur => ({ ...cur, structure_complete: true, state: 'complete' }))
  h = PJ.recordHead(pr.dir, pr.key)
  const rec = h.head.rec
  const bpAdd = RR.reroofProofBlueprint(bp, bpNew, STYLE)
  const addedAt = B.placeBlueprint(bpAdd, { x: rec.anchor[0], z: rec.anchor[1] }, rec.s, rec.orient)
  // the decorator's post stands under an eave (its lantern IN the eave cell), canopy leaves and a dirt in two more low roof cells
  const lowest = Math.min(...addedAt.map(c => c.at[1]))
  const eaves = addedAt.filter(c => c.at[1] === lowest && srv.read(c.at[0], c.at[1] - 1, c.at[2]).name === 'air' && srv.read(c.at[0], c.at[1] - 2, c.at[2]).name !== 'air')
  assert.ok(eaves.length >= 3, `eave cells over standable ground: ${eaves.length}`)
  const [lamp, leaf, dirt] = eaves
  srv.set(lamp.at, 'lantern'); srv.set([lamp.at[0], lamp.at[1] - 1, lamp.at[2]], 'spruce_fence'); srv.set(leaf.at, 'spruce_leaves'); srv.set(dirt.at, 'dirt')
  const decor = { cells: [{ at: [lamp.at[0], lamp.at[1] - 1, lamp.at[2]], role: 'D1-post', seg: 'D1-L0' }, { at: lamp.at, role: 'D1-lamp', seg: 'D1-L0' }] }
  const site0 = { anchor: { x: rec.anchor[0], z: rec.anchor[1] }, s: rec.s, orient: rec.orient, clear: [], fill: [] }
  assert.strictEqual(B.proveSite(srv.read, HOME, bpAdd, site0, { walkR: 30 }).why, 'cell_not_free', 'POSITIVE CONTROL: the base proof refuses (the live dead end)')
  const ob = RR.reroofObstacles(srv.read, addedAt.map(c => c.at), { decor, recordAt: () => null, fx: RR.reroofFixes({}) })
  assert.strictEqual(ob.blocker, null); assert.strictEqual(ob.clear.length, 4); assert.strictEqual(ob.retire.length, 2)
  assert.ok(RR.reroofClearsReached(srv.read, HOME, ob.clear, { walkR: 30 }).ok)
  const p = B.proveSite(srv.read, HOME, bpAdd, { ...site0, clear: ob.clear }, { walkR: 30 })
  assert.ok(p.ok, `${p.why} ${p.detail ?? ''}`)
  const dec2 = D.decorRetire(decor, ob.retire.map(a => a.join(',')), { by: 'reroof:house1' })
  assert.strictEqual(dec2.cells.length, 0); assert.strictEqual(dec2.retired.length, 2)
  assert.strictEqual(PJ.publishRecord(pr.dir, pr.key, cur => RR.reroofRecord(cur, p.cells, bpNew, STYLE, { clear: ob.clear })).result, 'accepted')
  h = PJ.recordHead(pr.dir, pr.key)
  r = null
  for (let i = 0; i < 4 && r?.stop !== 'complete'; i++) r = await visit(h.head.rec, h.head.gen, h.head.rec.palette)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
  const digs = e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear').map(([, d]) => `${d.kind}:${d.block}`).sort()
  assert.deepStrictEqual(digs, ['decor_post:lantern', 'decor_post:spruce_fence', 'foreign:dirt', 'leaves:spruce_leaves'], 'each dug once, by its listed kind')
  for (const c of h.head.rec.cells.filter(q => /^reroof-/.test(q.seg))) assert.ok(R.cellDone(srv.read(...c.at), h.head.rec.palette, c.role, c.ws ?? null), `${c.role}@${c.at}`)
  assert.strictEqual(srv.read(lamp.at[0], lamp.at[1] - 1, lamp.at[2]).name, 'air', 'the post went whole')
})

await t('MUTANTS: the reach check, the clutter rule and the occupied interior each killed', async () => {
  const w = {}
  for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) w[`${x},74,${z}`] = 'spruce_planks'
  w['5,75,5'] = 'spruce_leaves'
  await killed('reroof.mjs', '    if (!digStand(overlay(read, over), c.at, nodes)) { unreached.push(c.at.slice()); continue }\n', '', M => {
    assert.strictEqual(M.reroofClearsReached(worldOf(w), { x: 0, y: 70, z: 0 }, [{ at: [5, 75, 5], name: 'spruce_leaves' }], { walkR: 20 }).ok, false)
  })
  await killed('reroof.mjs', "    if (fx.clutter && !recordAt(...at) && (LEAVES_RX.test(nmOf(b)) || foreignKind(nmOf(b)) === 'scaffold')) {", "    if (false) {", M => {
    assert.strictEqual(M.reroofObstacles(worldOf({ '6,72,5': 'dirt' }), [[6, 72, 5]], { fx: M.reroofFixes({}) }).blocker, null)
  })
  const bp = B.loadBlueprint('workshop@1')
  await killed('reroof.mjs', '!filled.has(`${u},${v},${y}`) && !occupied(u, v, y)),', '!filled.has(`${u},${v},${y}`)),', M => {
    const nw = M.reroofBlueprint(bp, 'gable')
    assert.ok(M.reroofProofBlueprint(bp, nw, STYLE, { occupied: () => true }).interior.length === 0)
  })
})

console.log('WIRED (structural: the planner and the decorator reach the fixes)')
await t('skills.mjs buildReroof asks the obstacles, the reach, the doorstep and retires before it publishes; the decorator is handed the pending cells; fail counts are fresh', () => {
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
  const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const body = SK.slice(SK.indexOf('async function buildReroof'), SK.indexOf('const reroofFailFile'))
  const at = re => { const m = body.match(re); assert.ok(m, String(re)); return m.index }
  // reroof-03: the proof of the listed digs first (the ordered reach needs its cells), then the reach over the same list (`clear`)
  // reroof-04: the obstacles, the proof and the reach are reroof.mjs reroofProve's (in that order); buildReroof asks it first
  const RRS = strip(fs.readFileSync(new URL('../src/reroof.mjs', import.meta.url), 'utf8'))
  const pw = RRS.slice(RRS.indexOf('function reroofProveWith'))
  const atR = re => { const m = pw.match(re); assert.ok(m, String(re)); return m.index }
  assert.ok(atR(/reroofObstacles\(read, addedAt, \{ decor, recordAt/) < atR(/const p = proveWith\(clear, null\)/))
  assert.ok(atR(/const proveWith = \(cl, extra = null\) => proveSite\(PR, home, bpAdd, \{[^\n]*clear: cl, fill: fillOf\(extra\) \}/) < atR(/let rc = reroofClearsReached\(PR, home, clear0/))
  assert.ok(at(/const pr = await reroofProve\(read, home, rec, bpOld, bpAdd/) < at(/if \(!pr\.ok\) return fail\(pr\.why, pr\.detail\)/))
  assert.ok(at(/publishRecord\(dir, decorKey\(\), cur => decorRetire\(cur, keys/) < at(/reroofRecord\(cur, p\.cells, bpNew, style, \{ clear, temp: pr\.temp, notch: pr\.notch \}\)/), 'the decor cells retired before the roof is published')
  assert.ok(/avoid: REROOF_FIX\.avoid && REROOF_SW\.on \? reroofPendingCells\(/.test(SK), 'the decor siting ctx carries the pending cells')
  assert.ok(/f\[plot\] = reroofFailBump\(f\[plot\], \{ fresh: REROOF_FIX\.fresh \}\)/.test(SK) && /failed: reroofFails\(dir\), fresh: REROOF_FIX\.fresh \}/.test(SK))
  const FE = strip(fs.readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
  assert.ok(/kind: 'reroof_mode'[^\n]*reroofModeDetail\(REROOF\.on, REROOF_FIX\)/.test(FE), 'the licence row')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
