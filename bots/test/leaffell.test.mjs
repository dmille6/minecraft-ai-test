// LEAFFELL-01SHOW (bots/src/leaffell.mjs; reroof.mjs reroofLeafFell + the stepped reach tests; sitecanopy.mjs cellClearsHook `leafFell`;
// buildsite.mjs siteBlueprintSteps `ctx.leafFell` / `ctx.leafReplantDomain`; buildrun.mjs runVisit `leaf_decay`, `clear_zoned`,
// `p.replantDomain`). LIVE showcase 11-12: natural leaves no stand reaches held the storage hall's re-roof (`clear_unreached 13/29 first
// spruce_leaves@11,74,-53`), the styled buildings' sitings (`leaves_unreached`) and the tower (9 leaf clears in a protected zone, walked
// to and refused on every visit). A natural leaf never needs a stand: it needs its trunk down.
// Here: the pure rules; the reach test with fell-first; THE CHAIN on the fake server (the real siteBlueprint: a canopy no stand reaches
// with its trunk beside the plot -- refused as before with the switch off, sited with the trunk listed and its sapling owed; the composed
// dead end -- the replant band out of the stands' domain -- as its own control); the visit (a cell under a decaying leaf waits, bounded;
// a zone-refused clear is set aside before any walk); anchored mutants; the wiring.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
process.env.SHOP_COOLDOWN_MS = String(3 * 60_000)   // the live showcase's order cooldown (read once, when shop.mjs loads)
const { R, PJ, G, HOME, k3, server, bot, BP, SITE, project, plan, withMutant } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')
const C = await import('../src/cottage.mjs')
const RR = await import('../src/reroof.mjs')
const SC = await import('../src/sitecanopy.mjs')
const LF = await import('../src/leaffell.mjs')
const S = await import('../src/shop.mjs')
const G2 = await import('../src/grounds2.mjs')
const SRC = f => new URL(`../src/${f}`, import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** A mutant of one src file (its anchor present and unique), imported from the test directory; `also` rewires the files that import it. */
async function withSrcMutant (file, old, neu, fn, also = []) {
  const src = readFileSync(SRC(file), 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const name = f => `_mutant-${f.replace(/\.mjs$/, '')}-${tag}.mjs`
  const files = [file, ...also], outs = files.map(f => new URL(`./${name(f)}`, import.meta.url))
  const rewire = text => files.reduce((s, f) => s.split(`from './${f}'`).join(`from './${name(f)}'`), text).replace(/from '\.\/(?!_mutant)/g, "from '../src/")
  writeFileSync(outs[0], rewire(src.replace(old, neu)))
  also.forEach((f, i) => writeFileSync(outs[i + 1], rewire(readFileSync(SRC(f), 'utf8'))))
  try { return await fn(...await Promise.all(outs.map(o => import(o.href)))) } finally { for (const o of outs) { try { unlinkSync(o) } catch {} } }
}
const LOG = { name: 'spruce_log', boundingBox: 'block' }
const LEAF = (persistent = 'false') => ({ name: 'spruce_leaves', boundingBox: 'block', props: { persistent } })
const AIRB = { name: 'air', boundingBox: 'empty' }
const DIRT = { name: 'dirt', boundingBox: 'block' }
const world = (m, dflt = AIRB) => (x, y, z) => (Object.hasOwn(m, `${x},${y},${z}`) ? m[`${x},${y},${z}`] : dflt)
const k = a => a.join(',')
const clearOf = (m, keys, kind = 'leaves') => keys.map(q => ({ at: q.split(',').map(Number), kind, name: m[q].name }))

console.log('THE PURE RULES')
await t('leafFellOn: on by default; off | 0 | false | no turn it off', () => {
  assert.strictEqual(LF.leafFellOn({}), true)
  for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.strictEqual(LF.leafFellOn({ LEAFFELL: v }), false, v)
  assert.strictEqual(RR.reroofFixes({ LEAFFELL: 'off' }).leafFell, false); assert.strictEqual(RR.reroofFixes({}).leafFell, true)
})
await t('leafSupport: the logs within 6 steps THROUGH LEAVES (a placed leaf carries the distance on too); 7 steps away: none; an unread cell: unknown', () => {
  const m = { '0,5,0': LEAF() }
  for (let x = 1; x <= 5; x++) m[`${x},5,0`] = x === 3 ? LEAF('true') : LEAF()
  m['6,5,0'] = LOG
  assert.deepStrictEqual(LF.leafSupport(world(m), [0, 5, 0]).logs, [[6, 5, 0]], 'the log is the 6th step')
  const far = { ...m, '6,5,0': LEAF(), '7,5,0': LOG }
  assert.deepStrictEqual(LF.leafSupport(world(far), [0, 5, 0]).logs, [], 'POSITIVE CONTROL: the 7th step holds nothing (the server decays it)')
  const gap = { ...m, '3,5,0': AIRB }
  assert.deepStrictEqual(LF.leafSupport(world(gap), [0, 5, 0]).logs, [], 'no chain of leaves: nothing holds it')
  assert.deepStrictEqual(LF.leafSupport(world({ '0,5,0': LEAF() }), [0, 5, 0], { planned: new Set(['0,6,0']) }).logs, [[0, 6, 0]], 'a log the build will place holds it')
  assert.strictEqual(LF.leafSupport(world({ '0,5,0': LEAF(), '1,5,0': null }), [0, 5, 0]).unknown, true)
  assert.strictEqual(LF.leafSupport(world({ '0,5,0': LEAF(), '1,5,0': { name: 'stripped_oak_wood' } }), [0, 5, 0]).logs.length, 1, 'any log-class block holds')
})
// a spruce rooted in the ground at 3,1..4,0 with a leaf blob; the unreached leaf at 1,4,0
const tree = (extra = {}) => ({ '3,0,0': DIRT, '3,1,0': LOG, '3,2,0': LOG, '3,3,0': LOG, '3,4,0': LOG, '2,4,0': LEAF(), '1,4,0': LEAF(), ...extra })
await t('leafFellPlan: a leaf held only by a listed log a stand reaches is DECAYING -- nothing more to fell', () => {
  const m = tree()
  const clear = [...clearOf(m, ['1,4,0']), ...clearOf(m, ['3,1,0', '3,2,0', '3,3,0', '3,4,0'], 'tree')]
  const pl = LF.leafFellPlan(world(m), clear, [[1, 4, 0]])
  assert.deepStrictEqual({ ok: pl.ok, decay: pl.decay, fell: pl.fell, blockers: pl.blockers }, { ok: true, decay: [[1, 4, 0]], fell: [], blockers: [] })
  const un = LF.leafFellPlan(world(m), clear, [[1, 4, 0], [3, 4, 0]])
  assert.strictEqual(un.ok, false)
  assert.ok(un.blockers.some(b => k(b.at) === '1,4,0' && /^trunk_unreached 3,4,0$/.test(b.why)), JSON.stringify(un.blockers))
  assert.ok(un.blockers.some(b => k(b.at) === '3,4,0' && b.why === 'trunk_unreached'), 'the log itself is named too')
})
await t('leafFellPlan: a tree ROOTED IN THE GROUND that holds it is listed whole, kind tree, one sapling owed at its base', () => {
  const m = tree()
  const pl = LF.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]])
  assert.strictEqual(pl.ok, true)
  assert.deepStrictEqual(pl.fell.map(c => `${k(c.at)}:${c.kind}:${c.name}`).sort(), ['3,1,0:tree:spruce_log', '3,2,0:tree:spruce_log', '3,3,0:tree:spruce_log', '3,4,0:tree:spruce_log'])
  assert.deepStrictEqual(pl.trees, [{ base: [3, 1, 0], species: 'spruce', sapling: 'spruce_sapling', logs: 4, tree: LF.LEAF_TREE_ID0 }])
  assert.ok(pl.fell.every(c => c.tree === LF.LEAF_TREE_ID0), 'its logs carry its tag (fellfirst-01 asks of ITS sapling kind)')
  assert.deepStrictEqual(pl.decay, [[1, 4, 0]])
})
await t('leafFellPlan: floating remains (air under them) and a tree on the building\'s own cell (`rooted`) owe no sapling: kind remains', () => {
  const fl = tree({ '3,0,0': AIRB })
  const pl = LF.leafFellPlan(world(fl), clearOf(fl, ['1,4,0']), [[1, 4, 0]])
  assert.strictEqual(pl.ok, true); assert.deepStrictEqual(pl.trees, [])
  assert.ok(pl.fell.length === 4 && pl.fell.every(c => c.kind === LF.LEAF_REMAINS && !('tree' in c)))
  assert.strictEqual(LF.LEAF_REMAINS, RR.REROOF_REMAINS, 'the retrofit\'s own kind (no sapling owed: never kind=tree)')
  const roof = tree()
  const pr = LF.leafFellPlan(world(roof), clearOf(roof, ['1,4,0']), [[1, 4, 0]], { rooted: new Set(['3,0,0']) })
  assert.ok(pr.ok && !pr.trees.length && pr.fell.every(c => c.kind === LF.LEAF_REMAINS))
})
await t('leafFellPlan keeps the old answer, naming the leaf and why: a placed leaf, a record\'s log, a closed trunk, a stripped log, a 2x2, an unread cell, no leaf at all', () => {
  const why = (m, opts = {}, un = [[1, 4, 0]]) => { const pl = LF.leafFellPlan(world(m), clearOf(m, un.map(k)), un, opts); assert.strictEqual(pl.ok, false); assert.deepStrictEqual(pl.fell, [], 'a refused plan fells nothing'); return pl.blockers[0].why }
  assert.strictEqual(why(tree({ '1,4,0': LEAF('true') })), 'placed_leaves')
  assert.strictEqual(why(tree({ '1,4,0': { name: 'spruce_leaves', boundingBox: 'block' } })), 'placed_leaves', 'unread properties: never natural')
  assert.strictEqual(why(tree(), { own: new Set(['3,4,0']) }), 'record_log 3,4,0', 'the building\'s own post')
  assert.strictEqual(why(tree(), { recordAt: (x, y, z) => x === 3 && y === 2 }), 'record_log 3,4,0', 'another record\'s log anywhere in the trunk')
  assert.strictEqual(why(tree(), { planned: new Set(['1,5,0']) }), 'record_log 1,5,0', 'a log the build will set beside it')
  assert.strictEqual(why(tree(), { closed: (x, y, z) => x === 3 && y === 1 }), 'trunk_closed 3,4,0', 'a trunk in a protected zone is never felled')
  assert.strictEqual(why(tree({ '3,4,0': { name: 'stripped_spruce_log', boundingBox: 'block' } })), 'placed_log 3,4,0')
  assert.strictEqual(why(tree({ '4,0,0': DIRT, '4,1,0': LOG })), 'tree_2x2 3,4,0')
  assert.strictEqual(why(tree({ '0,4,0': null })), 'unread_near')
  assert.strictEqual(why(tree({ '1,4,0': DIRT })), 'not_leaves')
  const big = tree(); for (let y = 5; y < 5 + LF.LEAFFELL_MAX_LOGS; y++) big[`3,${y},0`] = LOG
  assert.strictEqual(why(big), 'tree_too_big 3,4,0')
})
await t('markDecay / leafBlockerText / rowDue', () => {
  const c = [{ at: [1, 4, 0], kind: 'leaves', name: 'spruce_leaves' }, { at: [3, 1, 0], kind: 'tree', name: 'spruce_log' }]
  assert.deepStrictEqual(LF.markDecay(c, [[1, 4, 0]]).map(x => x.decay ?? 0), [1, 0])
  assert.strictEqual(LF.leafBlockerText({ at: [11, 74, -53], name: 'spruce_leaves', why: 'record_log 12,73,-52' }), 'record_log:12,73,-52 spruce_leaves@11,74,-53')
  const mem = new Map()
  assert.strictEqual(LF.rowDue(mem, 'a', 1000), true); assert.strictEqual(LF.rowDue(mem, 'a', 2000), false, 'once')
  assert.strictEqual(LF.rowDue(mem, 'a', 1000 + LF.LEAF_ROW_MS), true); assert.strictEqual(LF.rowDue(mem, 'b', 2000), true)
})

console.log('THE REACH TEST WITH FELL-FIRST')
// the reach of these scenes: a stand reaches every listed dig at y <= 3 (the ground's eye), nothing above
const lowReach = calls => function * (list) { calls.push(list.length); yield null; const un = list.filter(c => c.at[1] > 3).map(c => c.at); return { ok: !un.length, unreached: un } }
const run = g => { let n = 0; for (;;) { const r = g.next(); if (r.done) return { v: r.value, yields: n }; n++ } }
await t('leafFellSteps: the trunk is listed, the reach asked again (a turn after its walk), the leaves it cannot reach are marked decaying', () => {
  const m = tree({ '3,4,0': LEAF(), '2,3,0': LEAF() })   // the trunk 3,1..3 (reached); leaves at y 4 (not reached)
  const clear = clearOf(m, ['1,4,0', '2,4,0'])
  const calls = []
  const { v, yields } = run(LF.leafFellSteps(world(m), clear, { ok: false, unreached: [[1, 4, 0], [2, 4, 0]] }, lowReach(calls)))
  assert.strictEqual(v.ok, true, JSON.stringify(v.blockers))
  assert.deepStrictEqual(v.fell.map(c => k(c.at)).sort(), ['3,1,0', '3,2,0', '3,3,0'])
  assert.deepStrictEqual(v.clear.filter(c => c.decay === 1).map(c => k(c.at)).sort(), ['1,4,0', '2,4,0'])
  assert.ok(v.clear.filter(c => c.kind === 'tree').every(c => c.decay !== 1), 'a log is never marked decaying')
  assert.deepStrictEqual(calls, [5], 'one more reach test, over the longer list'); assert.strictEqual(yields, 1, 'its walk hands the loop back')
  assert.deepStrictEqual(v.trees.map(q => q.sapling), ['spruce_sapling'])
})
await t('leafFellSteps: a trunk whose top no stand reaches keeps the old answer (the leaf and the log named); nothing is listed', () => {
  const m = tree()   // the trunk's top log at y 4: not reached
  const { v } = run(LF.leafFellSteps(world(m), clearOf(m, ['1,4,0']), { ok: false, unreached: [[1, 4, 0]] }, lowReach([])))
  assert.strictEqual(v.ok, false); assert.deepStrictEqual(v.fell, [])
  assert.ok(v.blockers.some(b => /^trunk_unreached/.test(b.why)), JSON.stringify(v.blockers))
  assert.ok(v.clear.every(c => c.decay !== 1) && v.clear.length === 1, 'the caller\'s list as it was')
})
await t('reroofLeafFell (the retrofit): remains are felled with no replant asked; a rooted tree needs `replantFor` -- none: no_replant_cell, the old answer', async () => {
  const reachOf = () => async (list, p) => { const un = list.filter(c => c.at[1] > 3).map(c => c.at); return { ok: !un.length, clear: list, p, rc: { ok: !un.length, unreached: un } } }
  const prove = async list => ({ ok: true, cells: [], n: list.length })
  const fl = tree({ '3,0,0': AIRB, '3,4,0': LEAF() })
  const r0 = { ok: false, clear: clearOf(fl, ['1,4,0']), p: { ok: true }, rc: { ok: false, unreached: [[1, 4, 0]] } }
  const a = await RR.reroofLeafFell(world(fl), r0, null, { reach: reachOf(), prove })
  assert.strictEqual(a.ok, true, JSON.stringify(a))
  assert.deepStrictEqual([a.decay, a.fell, a.trees, a.replant.length], [1, 3, 0, 0])
  assert.strictEqual(a.r.clear.find(c => k(c.at) === '1,4,0').decay, 1)
  assert.strictEqual(a.r.p.n, 4, 'the roof was proven again over the longer list')
  const gr = tree({ '3,4,0': LEAF() })
  const g0 = { ...r0, clear: clearOf(gr, ['1,4,0']) }
  const no = await RR.reroofLeafFell(world(gr), g0, null, { reach: reachOf(), prove })
  assert.deepStrictEqual([no.ok, no.blocker.why], [false, 'no_replant_cell'], 'POSITIVE CONTROL: a tree that owes a sapling is never felled without its replant cell')
  const cell = { cell: [20, 1, 0], species: 'spruce', sapling: 'spruce_sapling', state: 'pending' }
  const yes = await RR.reroofLeafFell(world(gr), g0, null, { reach: reachOf(), prove, replantFor: trees => ({ ok: true, cells: trees.map(() => cell) }) })
  assert.deepStrictEqual([yes.ok, yes.trees, yes.replant], [true, 1, [{ ...cell, tree: LF.LEAF_TREE_ID0 }]])
  assert.ok(yes.r.clear.filter(c => c.kind === 'tree').every(c => c.tree === LF.LEAF_TREE_ID0), 'the logs and the sapling carry one tag')
  assert.ok(yes.r.clear.filter(c => c.kind === 'tree').length === 3)
  const bad = await RR.reroofLeafFell(world(gr), g0, null, { reach: reachOf(), prove: async () => ({ ok: false, why: 'no_step' }), replantFor: () => ({ ok: true, cells: [cell] }) })
  assert.deepStrictEqual([bad.ok, bad.blocker.why], [false, 'proof_no_step'], 'a roof that is not proven over the longer list is not published')
})
await t('reroofRecord carries the decay marks, the owed replants and the plan\'s count; without them the record is as before', () => {
  const rec = { cells: [], segments: [], clear: [], replant: [{ cell: [1, 1, 1], sapling: 'oak_sapling', state: 'pending' }], palette: {} }
  const bpNew = { id: 'x@1', segments: [], palette: {} }
  const clear = [{ at: [1, 4, 0], kind: 'leaves', name: 'spruce_leaves', decay: 1 }, { at: [3, 1, 0], kind: 'tree', name: 'spruce_log' }]
  const rp = [{ cell: [20, 1, 0], species: 'spruce', sapling: 'spruce_sapling', state: 'pending' }]
  const out = RR.reroofRecord(rec, [], bpNew, {}, { clear, replant: rp, leaf: { decay: 1, fell: 1, trees: 1 } })
  assert.deepStrictEqual(out.clear, [{ at: [1, 4, 0], kind: 'leaves', name: 'spruce_leaves', decay: 1 }, { at: [3, 1, 0], kind: 'tree', name: 'spruce_log' }])
  assert.deepStrictEqual(out.replant.map(r => r.sapling), ['oak_sapling', 'spruce_sapling'])
  assert.deepStrictEqual(out.leaffell, { decay: 1, fell: 1, trees: 1 })
  const old = RR.reroofRecord(rec, [], bpNew, {}, { clear: [clear[1]] })
  assert.ok(!('leaffell' in old) && old.replant.length === 1 && !('decay' in old.clear[0]))
})
await t('the stepped reach tests answer as the straight ones, value for value, and hand the loop back after every walk', () => {
  // flat ground at G; a leaf low (reached from the ground) and one high (never)
  const srv = server({ [`10,${G + 2},0`]: 'spruce_leaves', [`10,${G + 12},0`]: 'spruce_leaves' })
  const clear = [{ at: [10, G + 2, 0], kind: 'leaves', name: 'spruce_leaves' }, { at: [10, G + 12, 0], kind: 'leaves', name: 'spruce_leaves' }]
  const straight = RR.reroofClearsReached(srv.read, HOME, clear, { stood: [], walkR: 20 })
  const stepped = run(RR.reroofClearsReachedSteps(srv.read, HOME, clear, { stood: [], walkR: 20 }))
  assert.deepStrictEqual(stepped.v, straight); assert.deepStrictEqual(straight, { ok: false, unreached: [[10, G + 12, 0]] })
  assert.strictEqual(stepped.yields, 2, 'one walk for the first dig, one more after it landed')
  const o1 = RR.reroofOrderedReach(srv.read, HOME, clear, [], { stood: [], walkR: 20, domain: () => true })
  const o2 = run(RR.reroofOrderedReachSteps(srv.read, HOME, clear, [], { stood: [], walkR: 20, domain: () => true }))
  assert.deepStrictEqual(o2.v, o1); assert.ok(o2.yields >= 2, `yields ${o2.yields}`)
})

// ---- THE CHAIN: the cottage's siting on the fake server -- a canopy over the plot, its trunk east of the plot ------------------------
const BOX = [20, -5, 30, 5]
const LEAF_Y = G + 5, TRUNK = [BOX[2] + 2, 0]
function scene ({ persistent = 'false', trunk = true } = {}) {
  const plain = server().read
  return (x, y, z) => {
    const b = plain(x, y, z); if (!b) return b
    if (trunk && x === TRUNK[0] && z === TRUNK[1] && y > G && y <= LEAF_Y) return LOG
    if (y === LEAF_Y && x >= BOX[0] - 1 && x <= BOX[2] + 1 && z >= BOX[1] - 1 && z <= BOX[3] + 1 && b.name === 'air') return LEAF(persistent)
    return b
  }
}
const bpC = B.loadBlueprint('cottage@1f')
// the canopy's east half (x >= 25) is out of every stand's sight in these scenes; everything else is reached
const halfReach = cl => { const un = cl.filter(c => /_leaves$/.test(c.name) && c.at[0] >= 25).map(c => c.at); return { ok: !un.length, unreached: un } }
function site (read, { leafFell = true, replantWide = true, mod = SC, closed = () => null, decisions = [], farm = [], bmod = B } = {}) {
  const sp = C.cottageSitingPlan(HOME, { id: 'X9', box: BOX }, [])
  const ctx = { zones: [], farm, stood: [], sectors: sp.sectors, plot: 'cottage1', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line,
    cellClears: mod.cellClearsHook(read, { cellsOf: s => B.placeBlueprint(bpC, s.anchor, s.s, s.orient).map(c => c.at), reached: halfReach }),
    ...(leafFell ? { leafFell: { plan: s => ({ own: new Set(B.placeBlueprint(bpC, s.anchor, s.s, s.orient).map(c => c.at.join(','))), closed }), onDecision: (s, lf) => decisions.push(lf) } } : {}),
    ...(replantWide ? { leafReplantDomain: () => true } : {}) }
  return bmod.siteBlueprint(read, plan(), bpC, ctx)
}
const fails = s => Object.assign({}, ...(s.sectors ?? []).map(r => r.proofFails ?? {}))

console.log('THE CHAIN (fake server, the real siteBlueprint)')
await t('POSITIVE CONTROL (the live dead end, LEAFFELL off): leaves no stand reaches refuse every candidate, leaves_unreached', () => {
  const s = site(scene(), { leafFell: false })
  assert.strictEqual(s.ok, false); assert.ok(fails(s).leaves_unreached > 0, JSON.stringify(fails(s)))
})
let sited = null
await t('fell first: the cottage sites -- the trunk beside the plot is listed (kind tree), its sapling owed, the unreached leaves marked decaying', () => {
  const decisions = []
  const s = site(scene(), { decisions })
  assert.ok(s.ok, JSON.stringify(s.sectors?.map(r => [r.proofFails, r.proofEx])))
  sited = s.record
  const logs = s.record.clear.filter(c => c.kind === 'tree')
  assert.deepStrictEqual(logs.map(c => k(c.at)).sort(), [1, 2, 3, 4, 5].map(d => `${TRUNK[0]},${G + d},${TRUNK[1]}`).sort(), 'the whole trunk, nothing else')
  const dec = s.record.clear.filter(c => c.decay === 1)
  assert.ok(dec.length > 0 && dec.every(c => c.kind === 'leaves' && c.at[0] >= 25), `${dec.length} decaying`)
  assert.ok(s.record.clear.filter(c => c.kind === 'leaves' && c.at[0] < 25).every(c => c.decay !== 1), 'a leaf a stand reaches is dug, not waited for')
  assert.strictEqual(s.record.replant.length, 1); assert.strictEqual(s.record.replant[0].sapling, 'spruce_sapling')
  assert.ok(Number.isFinite(s.record.replant[0].tree) && logs.every(c => c.tree === s.record.replant[0].tree), 'the trunk and its sapling carry one tag')
  assert.deepStrictEqual(s.record.leaffell, { decay: dec.length, fell: 5, trees: 1 })
  assert.ok(s.record.trees.some(q => q.species === 'spruce' && k(q.base) === `${TRUNK[0]},${G + 1},${TRUNK[1]}`))
  assert.ok(decisions.length >= 1 && decisions.at(-1).ok === true, 'one decision per candidate asked')
})
await t('THE REFUSAL CHAIN: the sited sapling cell has NO stand in the visit\'s own domain (the pad + 3) -- the visit must plant it from the town walk', () => {
  // two correct rules composing into a dead end: the replant band keeps 8 from the pad, the cottage's visit stands within 3 of it
  const read = scene(), cell = sited.replant[0].cell
  const nodes = new Map()
  for (const q of B.walkFrom(read, HOME, new Set(), 90, {})) { const [x, y, z] = q.split(',').map(Number); const c = `${x},${z}`; if (!nodes.has(c)) nodes.set(c, []); nodes.get(c).push(y) }
  assert.strictEqual(B.stepFor(read, HOME, cell, nodes, C.cottageStandDomain(sited)), null, 'POSITIVE CONTROL: the visit\'s domain holds no stand for it')
  assert.ok(B.stepFor(read, HOME, cell, nodes, () => true), 'the town walk does (runVisit `p.replantDomain`, below)')
})
await t('a canopy with NO trunk near it (nothing holds it) is decaying as it stands: sited, no log listed, no sapling owed', () => {
  const s = site(scene({ trunk: false }))
  assert.ok(s.ok, JSON.stringify(fails(s)))
  assert.ok(!s.record.clear.some(c => c.kind === 'tree') && !s.record.replant.length)
  assert.deepStrictEqual([s.record.leaffell.fell, s.record.leaffell.trees], [0, 0])
})
await t('a trunk inside a protected zone is never felled: the old answer, the leaf and the reason in the search\'s row', () => {
  const decisions = []
  const s = site(scene(), { closed: (x, y, z) => x === TRUNK[0] && z === TRUNK[1], decisions })
  assert.strictEqual(s.ok, false); assert.ok(fails(s).leaves_unreached > 0)
  assert.ok(/trunk_closed/.test(decisions[0].blockers[0].why))
  assert.ok((s.sectors ?? []).some(r => (r.proofEx ?? []).some(x => /leaves_unreached trunk_closed:\d+,\d+,-?\d+ spruce_leaves@/.test(x))), JSON.stringify(s.sectors.map(r => r.proofEx)))
})
await t('r1: a trunk in a PLAN RESERVATION (the tree farm\'s columns) is never felled for its leaves -- the candidates fail `leaf_tree_reserved`; CONTROL: the same trunk unreserved is felled (above)', () => {
  const s = site(scene(), { farm: [[TRUNK[0], TRUNK[1]]] })
  assert.strictEqual(s.ok, false)
  assert.ok(fails(s).leaf_tree_reserved > 0 && !(fails(s).leaves_unreached > 0), JSON.stringify(fails(s)))
})
await t('r1: ONE trunk rule for the sitings and the retrofit (buildsite.mjs trunkReserved / trunkGuard): the same reason, a zone first, unread reservations fell nothing', () => {
  const res = B.reservations(plan(), { farm: [[3, 0]] }), open = B.reservations(plan(), {})
  assert.strictEqual(B.trunkReserved(res, [3, 2, 0]), 'leaf_tree_reserved'); assert.strictEqual(B.trunkReserved(res, [5, 2, 2]), 'leaf_tree_reserved', 'the farm\'s columns reach 2 out')
  assert.strictEqual(B.trunkReserved(res, [9, 2, 0]), null); assert.strictEqual(B.trunkReserved(open, [3, 2, 0]), null)
  assert.strictEqual(B.trunkReserved({ column: () => null, zones: [{ box: [3, 0, 0, 3, 9, 0] }] }, [3, 2, 0]), 'leaf_tree_reserved', 'a zone or an avoid box of the reservations too')
  // the retrofit's plan (leafFellPlan with the guard skills.mjs reroofLeafCtx passes): the tree() fixture's trunk stands at 3,1..4,0
  const m = tree()
  const kept = LF.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]], { closed: B.trunkGuard(res) })
  assert.strictEqual(kept.ok, false); assert.deepStrictEqual(kept.fell, [])
  assert.strictEqual(kept.blockers[0].why, 'leaf_tree_reserved 3,4,0', 'the siting\'s own word')
  const felled = LF.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]], { closed: B.trunkGuard(open) })
  assert.strictEqual(felled.ok, true, 'CONTROL: the same trunk, no reservation on it'); assert.strictEqual(felled.fell.length, 4)
  assert.strictEqual(LF.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]], { closed: B.trunkGuard(open, (x, y, z) => x === 3 && y === 1) }).blockers[0].why, 'trunk_closed 3,4,0', 'a protected zone names itself')
  assert.strictEqual(LF.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]], { closed: B.trunkGuard(null) }).blockers[0].why, 'reservations_unread 3,4,0', 'the town\'s reservations unreadable: nothing is felled on a guess')
})
await t('r1 MUTANT (buildsite.mjs): the trunk rule answers nothing -- the tree farm\'s tree is felled by both paths (killed for that reason)', async () => {
  await withSrcMutant('buildsite.mjs', "export const trunkReserved = (res, [x, y, z]) => (res.column(x, z, y, y) || cellInZones(x, y, z, res.zones ?? []) ? 'leaf_tree_reserved' : null)\n", 'export const trunkReserved = () => null\n', async M => {
    const s = site(scene(), { farm: [[TRUNK[0], TRUNK[1]]], bmod: M })
    assert.ok(s.ok && s.record.clear.some(c => c.kind === 'tree'), 'the siting fells the reserved trunk')
    const m = tree()
    assert.strictEqual(LF.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]], { closed: M.trunkGuard(M.reservations(plan(), { farm: [[3, 0]] })) }).ok, true, 'and so does the retrofit')
  })
})
await t('a PLACED canopy (persistent) is never judged decaying: the old answer', () => {
  // the hook lists natural leaves only, so a hedge never reaches the reach test: the candidates fail the proof as before
  const s = site(scene({ persistent: 'true' }))
  assert.strictEqual(s.ok, false); assert.ok(fails(s).cell_not_free > 0, JSON.stringify(fails(s)))
})
await t('MUTANT (sitecanopy.mjs): the hook never asks what holds the leaves -- the candidates are refused again (killed for that reason)', async () => {
  await withSrcMutant('sitecanopy.mjs', '      if (!rc?.ok && lfx && Array.isArray(rc?.unreached)) {', '      if (false) {', async M => {
    const s = site(scene(), { mod: M })
    assert.strictEqual(s.ok, false); assert.ok(fails(s).leaves_unreached > 0)
  })
})
await t('MUTANT (leaffell.mjs): the plan forgets whose log it is -- a record\'s post would be felled (the ownership test above fails for that reason)', async () => {
  await withSrcMutant('leaffell.mjs', "    if (logs.some(q => own.has(k(q)) || recordAt(...q))) return set(logs, { ok: false, why: 'record_log' })\n", '', async M => {
    const m = tree()
    const pl = M.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]], { recordAt: (x, y, z) => x === 3 && y === 2 })
    assert.strictEqual(pl.ok, true, 'the mutant fells another record\'s trunk')
  })
})
await t('MUTANT (leaffell.mjs): a placed leaf read as natural -- a hedge would be waited on for good (the placed_leaves test fails for that reason)', async () => {
  await withSrcMutant('leaffell.mjs', "    if (!naturalLeaf(b)) { blockers.push({ at: at.slice(), name, why: 'placed_leaves' }); continue }\n", '', async M => {
    const m = tree({ '1,4,0': LEAF('true') })
    assert.strictEqual(M.leafFellPlan(world(m), clearOf(m, ['1,4,0']), [[1, 4, 0]]).ok, true, 'the mutant calls a placed leaf decaying')
  })
})
await t('MUTANT (leaffell.mjs): a listed trunk no stand reaches no longer holds its leaf -- a tree nobody fells would be waited on', async () => {
  await withSrcMutant('leaffell.mjs', "{ if (un.has(lk)) { why = `trunk_unreached ${lk}`; break } continue }", '{ continue }', async M => {
    const m = tree()
    const clear = [...clearOf(m, ['1,4,0']), ...clearOf(m, ['3,4,0'], 'tree')]
    const pl = M.leafFellPlan(world(m), clear, [[1, 4, 0], [3, 4, 0]])
    assert.ok(!pl.blockers.some(b => k(b.at) === '1,4,0'), 'the mutant lets the leaf wait on a log that never comes down')
  })
})

// ---- THE VISIT (buildrun.mjs runVisit on the fake server) ---------------------------------------------------------------------------
const PADC = SITE.record.cells.filter(c => c.seg === 'pad')[30].at
function leafServer (cells) {
  const srv = server(cells)
  const plain = srv.read
  srv.read = (x, y, z) => { const b = plain(x, y, z); return b && /_leaves$/.test(b.name) ? { ...b, props: { persistent: 'false' } } : b }
  return srv
}
async function visit (M, { cells = {}, clear, opts = {}, vopts = {}, zoneClosed = null, digRefuse = () => false, mem = new Map(), replant = [] } = {}) {
  const record = { ...SITE.record, clear, replant }
  const srv = leafServer(cells), pr = project(record)
  const h = PJ.recordHead(pr.dir, pr.key)
  const dug = []
  const e = bot(srv, 'A', { dig: async (c, expect) => { dug.push(k3(c)); if (digRefuse(c)) return 'refused'; if (expect && srv.read(...c)?.name !== expect) return 'refused'; srv.set(c, 'air'); return 'confirmed' } })
  const walks = []
  const w0 = e.walkTo; e.walkTo = async (s, o) => { walks.push(s.slice()); return w0(s, o) }
  if (zoneClosed) e.zoneClosed = zoneClosed
  const r = await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, leafMem: mem, ...opts }, e, { maxSteps: 400, ...vopts })
  return { r, srv, dug, walks, logs: e.logs, pr, mem }
}
const LEAFC = { at: PADC, kind: 'leaves', name: 'spruce_leaves', decay: 1 }
const padLeaf = { [k3(PADC)]: 'spruce_leaves' }
const refuseLeaf = c => k3(c) === k3(PADC)

console.log('THE VISIT (fake server)')
await t('POSITIVE CONTROL (LEAFFELL off): a pad cell under a leaf the visit cannot dig ends it `blocked`', async () => {
  const { r } = await visit(R, { cells: padLeaf, clear: [LEAFC], digRefuse: refuseLeaf, vopts: { leafFell: false } })
  assert.strictEqual(r.stop, 'blocked')
})
await t('a cell under a listed DECAYING leaf waits: the visit lays the rest of the pad, ends `leaf_decay`, counts no stuck cell, writes one row', async () => {
  const { r, logs, pr, srv } = await visit(R, { cells: padLeaf, clear: [LEAFC], digRefuse: refuseLeaf })
  assert.strictEqual(r.stop, 'leaf_decay', `${r.stop} ${r.why}`)
  assert.ok(r.placed > 30, `placed ${r.placed}`)
  assert.strictEqual(srv.read(...PADC).name, 'spruce_leaves')
  assert.deepStrictEqual(PJ.stuckRead(pr.dir, pr.key, {}), {}, 'never a stuck count: no stuck_on_cell, no 6-hour back-off')
  assert.ok(!logs.some(([, d]) => d.op === 'stuck_on_cell' || d.op === 'deferred'))
  const rows = logs.filter(([kk, d]) => kk === '_build' && d.op === 'leaf_decay')
  assert.strictEqual(rows.length, 1); assert.deepStrictEqual([rows[0][1].cell, rows[0][1].n, rows[0][1].why], [PADC, 1, 'trunk_down'])
})
await t('the same leaf WITHOUT the decay mark (a leaf the proof said a stand reaches) is what it was: blocked', async () => {
  const { r } = await visit(R, { cells: padLeaf, clear: [{ ...LEAFC, decay: undefined }], digRefuse: refuseLeaf })
  assert.strictEqual(r.stop, 'blocked')
})
await t('a log that is NO listed clear holds the leaf (a tree grown since, a post): no wait -- blocked, as before', async () => {
  const up = [PADC[0], PADC[1] + 1, PADC[2]]
  const { r } = await visit(R, { cells: { ...padLeaf, [k3(up)]: 'spruce_log' }, clear: [LEAFC], digRefuse: refuseLeaf })
  assert.strictEqual(r.stop, 'blocked')
})
await t('the wait is BOUNDED: a leaf first waited on LEAF_WAIT_MS ago is blocked again; forgotten after LEAF_FORGET_MS', async () => {
  const pr0 = project(SITE.record)
  const key = `${pr0.key}|${k3(PADC)}`
  const { r } = await visit(R, { cells: padLeaf, clear: [LEAFC], digRefuse: refuseLeaf, mem: new Map([[key, performance.now() - LF.LEAF_WAIT_MS - 1]]) })
  assert.strictEqual(r.stop, 'blocked', 'spent')
  const { r: r2 } = await visit(R, { cells: padLeaf, clear: [LEAFC], digRefuse: refuseLeaf, mem: new Map([[key, performance.now() - LF.LEAF_FORGET_MS - 1]]) })
  assert.strictEqual(r2.stop, 'leaf_decay', 'a fresh wait')
})
await t('leafWait / segLeafWait (pure): trunk_listed while its listed log stands, trunk_down after; one cell held by anything else and nothing waits', () => {
  const m = { '0,5,0': LEAF(), '1,5,0': LOG }
  const listed = q => ({ '0,5,0': { name: 'spruce_leaves', decay: 1 }, '1,5,0': { name: 'spruce_log' } })[k(q)] ?? null
  assert.deepStrictEqual(LF.leafWait(world(m), [0, 5, 0], { listed }), { wait: true, why: 'trunk_listed' })
  assert.deepStrictEqual(LF.leafWait(world({ ...m, '1,5,0': AIRB }), [0, 5, 0], { listed }), { wait: true, why: 'trunk_down' })
  assert.strictEqual(LF.leafWait(world(m), [0, 5, 0], { listed: q => (k(q) === '0,5,0' ? listed(q) : null) }).wait, false)
  assert.strictEqual(LF.leafWait(world({ ...m, '0,5,0': LEAF('true') }), [0, 5, 0], { listed }).wait, false, 'a placed leaf never waits')
  const mem = new Map()
  assert.strictEqual(LF.leafWait(world(m), [0, 5, 0], { listed, mem, now: 0 }).wait, true)
  assert.deepStrictEqual(LF.leafWait(world(m), [0, 5, 0], { listed, mem, now: LF.LEAF_WAIT_MS }), { wait: false, why: 'wait_spent' })
  assert.strictEqual(LF.leafWait(world(m), [0, 5, 0], { listed, mem, now: LF.LEAF_FORGET_MS }).wait, true)
  assert.strictEqual(LF.segLeafWait([], () => ({ wait: true })).wait, false, 'nothing held: nothing to wait for')
  assert.strictEqual(LF.segLeafWait([[1, 1, 1], [2, 2, 2]], at => ({ wait: at[0] === 1, why: 'x' })).wait, false)
  assert.deepStrictEqual(LF.segLeafWait([[1, 1, 1], [2, 2, 2]], () => ({ wait: true, why: 'trunk_down' })), { wait: true, cells: [[1, 1, 1], [2, 2, 2]], why: 'trunk_down' })
})
await t('POSITIVE CONTROL (the live tower): a listed clear the zone rule refuses is walked to and dug at (refused) -- every visit', async () => {
  const { dug, r } = await visit(R, { cells: padLeaf, clear: [{ ...LEAFC, decay: undefined }], digRefuse: refuseLeaf, zoneClosed: c => (k3(c) === k3(PADC) ? 'village-taiga-6_1' : null), vopts: { leafFell: false } })
  assert.ok(dug.filter(q => q === k3(PADC)).length >= 1, 'the dig was sent')
  assert.strictEqual(r.stop, 'blocked')
})
await t('a zone-refused clear is SET ASIDE: no dig sent, one `clear_zoned` row naming it, the rest of the pad laid, the visit ends zone_closed', async () => {
  const mem = new Map()
  const asked = []
  const zc = (c, name, feet) => { asked.push([k3(c), name, feet]); return k3(c) === k3(PADC) ? 'village-taiga-6_1' : null }
  const { dug, r, logs } = await visit(R, { cells: padLeaf, clear: [{ ...LEAFC, decay: undefined }], digRefuse: refuseLeaf, zoneClosed: zc, mem })
  assert.ok(!dug.includes(k3(PADC)), 'never dug at')
  assert.ok(asked.length >= 1 && asked[0][1] === 'spruce_leaves' && Array.isArray(asked[0][2]), 'the guard is asked with the block and the stand')
  const rows = logs.filter(([kk, d]) => kk === '_build' && d.op === 'clear_zoned')
  assert.strictEqual(rows.length, 1)
  assert.deepStrictEqual([rows[0][1].cell, rows[0][1].n], [PADC, 1])
  assert.match(rows[0][1].why, /^closed by protected zone village-taiga-6_1: never dug by a bot; set aside, the project goes on without it$/, 'the row says what closes it and what happens next')
  assert.strictEqual(r.stop, 'zone_closed', `${r.stop} ${r.why}`); assert.deepStrictEqual(r.zoned, [k3(PADC)]); assert.ok(r.placed > 30)
  // the stop's detail names the remedy in plain words, whole inside the visit row's 120 characters
  assert.match(r.why, /^1 cell\(s\) closed by protected zone village-taiga-6_1 \(-?\d+,\d+,-?\d+\): bots never dig there; built without them; not waived$/)
  assert.ok(r.why.length <= 120, `${r.why.length} chars`)
  assert.ok(!(r.deferred ?? []).some(d => d.k === k3(PADC)), 'not deferred: neither the stuck count nor a waiver (sinkWaiveDue / wallWaiveDue read `deferred`) sees it')
  // the next visit of this bot within LEAF_ROW_MS: set aside again, no second row
  const again = await visit(R, { cells: padLeaf, clear: [{ ...LEAFC, decay: undefined }], digRefuse: refuseLeaf, zoneClosed: zc, mem })
  assert.ok(!again.dug.includes(k3(PADC)))
  assert.strictEqual(again.logs.filter(([, d]) => d.op === 'clear_zoned').length, 0, 'named once')
})
await t('a clear the guard does NOT refuse is dug as before (the guard asked, the answer null)', async () => {
  const { dug, r, srv } = await visit(R, { cells: padLeaf, clear: [{ ...LEAFC, decay: undefined }], zoneClosed: () => null, vopts: { maxSteps: 60 } })
  assert.ok(dug.includes(k3(PADC))); assert.strictEqual(srv.read(...PADC).name === 'spruce_leaves', false); assert.notStrictEqual(r.stop, 'zone_closed')
})
await t('`p.replantDomain`: a sapling owed beside a building whose stands are its pad + 3 is planted from the town walk; without it, the old remedy', async () => {
  const box = SITE.record.box
  const rp = { cell: [box[2] + 10, G + 1, box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending' }
  const near = (x, z) => x >= box[0] - 3 && x <= box[2] + 3 && z >= box[1] - 3 && z <= box[3] + 3
  const old = await visit(R, { clear: [], replant: [rp], opts: { domain: near }, vopts: { maxSteps: 40 } })
  assert.strictEqual(old.r.stop, 'replanned', `POSITIVE CONTROL: ${old.r.stop}`); assert.strictEqual(old.r.planted, 0)
  const wide = await visit(R, { clear: [], replant: [rp], opts: { domain: near, replantDomain: () => true }, vopts: { maxSteps: 40 } })
  assert.strictEqual(wide.r.planted, 1); assert.strictEqual(wide.srv.read(...rp.cell).name, 'oak_sapling')
  const off = await visit(R, { clear: [], replant: [rp], opts: { domain: near, replantDomain: () => true }, vopts: { maxSteps: 40, leafFell: false } })
  assert.strictEqual(off.r.stop, 'replanned', 'LEAFFELL off: as before')
})
await t('THE CHAIN: an OLDER replant the building\'s stand domain never reached is planted from the town walk too, THEN the trunk falls -- saplings=2/2 (the read\'s G5: never fewer than the record owes)', async () => {
  const box = SITE.record.box
  const near = (x, z) => x >= box[0] - 3 && x <= box[2] + 3 && z >= box[1] - 3 && z <= box[3] + 3
  const oldRp = { cell: [box[2] + 10, G + 1, box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending' }
  const ownRp = { cell: [box[2] + 10, G + 1, box[1] + 3], species: 'oak', sapling: 'oak_sapling', state: 'pending', tree: LF.LEAF_TREE_ID0 }
  const logC = { at: PADC, kind: 'tree', name: 'oak_log', tree: LF.LEAF_TREE_ID0 }
  const sc = { cells: { [k3(PADC)]: 'oak_log' }, clear: [logC], replant: [oldRp, ownRp], vopts: { maxSteps: 60 } }
  const old = await visit(R, { ...sc, opts: { domain: near } })
  assert.strictEqual(old.srv.read(...PADC).name, 'oak_log', 'POSITIVE CONTROL: no stand for either sapling in the pad + 3 -- the trunk stands, the replant is moved')
  assert.strictEqual(old.r.stop, 'replanned')
  const wide = await visit(R, { ...sc, opts: { domain: near, replantDomain: () => true, replantGoOn: true } })
  assert.deepStrictEqual([wide.srv.read(...oldRp.cell).name, wide.srv.read(...ownRp.cell).name], ['oak_sapling', 'oak_sapling'], 'every replant first (B4)')
  assert.notStrictEqual(wide.srv.read(...PADC).name, 'oak_log', 'then the trunk comes down')
  const row = wide.logs.find(([kk, d]) => kk === '_build' && d.op === 'clear' && d.kind === 'tree')
  assert.ok(row && row[1].saplings === '2/2' && row[1].first !== 1, JSON.stringify(row))
})
await t('MUTANT (buildrun.mjs): the segment never waits -- the decaying leaf ends the visit blocked again', async () => {
  await withMutant('            if (lw.wait) {\n', '            if (false) {\n', async M => {
    const { r } = await visit(M, { cells: padLeaf, clear: [LEAFC], digRefuse: refuseLeaf })
    assert.strictEqual(r.stop, 'blocked')
  })
})
await t('MUTANT (buildrun.mjs): the guard\'s answer is ignored -- the refused clear is walked to and dug at again', async () => {
  await withMutant('          if (z) { zoned.set(kOf(c.at), String(z)); zonedNew.push(c); continue }\n', '', async M => {
    const { dug } = await visit(M, { cells: padLeaf, clear: [{ ...LEAFC, decay: undefined }], digRefuse: refuseLeaf, zoneClosed: c => (k3(c) === k3(PADC) ? 'z' : null) })
    assert.ok(dug.includes(k3(PADC)))
  })
})

// ---- THE ORDER: does a project whose visit ended waiting come back at the next cooldown? (r1, Codex blocker 1) -------------------------
console.log('THE ORDER (the real shop.mjs activeProject / buildOrder; grounds2.mjs)')
const MIN = 60_000, CD = S.SHOP_COOLDOWN_MS
const ORD = { on: true, shared: true, atTown: true, holds: false, state: {}, record: null, complete: false, slotsFree: true, health: 20, freeSlots: 20 }
const OWN_ORDER = { order: { skill: 'build_shop', args: {} }, skip: null }
const HUB = { plot: 'storehub' }, HOUSE = { plot: 'house2' }, TOWER = { plot: 'tower', sink: true }, ROAD = { plot: 'road', sink: true }
/** One bot's order as skills.mjs wires it: the states through waitBackoff then idleMarks (shopActive), the pick's record to buildOrder. */
function orderChain (Sx, { list, states, hold = true }) {
  const idle = new Map(), wait = new Map()
  let clock = 0
  Sx.setWaitNow(plot => (hold ? Sx.waitHeld(wait, plot, clock) : null))
  const pick = now => Sx.activeProject(Sx.idleMarks(hold ? Sx.waitBackoff(states, wait, now) : states, idle, now), list)
  const order = (now, state) => { clock = now; const p = pick(now); return { pick: p.plot, ...Sx.buildOrder({ ...ORD, now, state, record: { plot: p.plot } }) } }
  const visited = (plot, res, now) => { Sx.noteIdle(idle, plot, res, now); if (hold) Sx.noteWait(wait, plot, res, now); return { lastAt: now, lastStop: res.stop } }
  return { order, visited, wait }
}
await t('CD is the showcase\'s 3 minutes here (the scene of the blocker)', () => assert.strictEqual(CD, 3 * MIN))
await t('POSITIVE CONTROL (Codex r1 blocker, the base\'s order): the re-roofed hall is the only work, its visit ends leaf_decay with nothing done -- the idle mark holds nothing without a sink and the SAME project is ordered at every cooldown', () => {
  const c = orderChain(S, { list: [HUB], states: [{ plot: 'storehub', exists: true, complete: true, damaged: true }], hold: false })
  const T0 = 1_000_000
  let st = c.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, T0)
  for (let i = 1; i <= 4; i++) {
    const o = c.order(T0 + i * CD, st)
    assert.deepStrictEqual(o, { pick: 'storehub', ...OWN_ORDER }, `cooldown ${i}: ordered again`)
    st = c.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, T0 + i * CD)
  }
  // ...and the same for zone_closed, which nothing ever changes
  const z = orderChain(S, { list: [TOWER], states: [{ plot: 'tower', exists: true, complete: true, sinkOpen: true }], hold: false })
  const sz = z.visited('tower', { status: 'no_effect', stop: 'zone_closed' }, T0)
  assert.deepStrictEqual(z.order(T0 + S.orderCooldown('tower'), sz).order, OWN_ORDER.order, 'the tower again, every sink cooldown')
})
await t('the hold: a visit that ended leaf_decay is NOT ordered again at the next cooldown -- the skip names the stop; the project comes back when the leaf\'s retry is due (5 min), and a visit that then works ends the hold', () => {
  const c = orderChain(S, { list: [HUB], states: [{ plot: 'storehub', exists: true, complete: true, damaged: true }] })
  const T0 = 1_000_000
  const st = c.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, T0)
  assert.deepStrictEqual(c.order(T0 + CD, st), { pick: 'storehub', order: null, skip: 'leaf_decay' })
  assert.deepStrictEqual(c.order(T0 + S.SHOP_LEAF_RETRY_MS - 1, { ...st, lastAt: T0 - CD }), { pick: 'storehub', order: null, skip: 'leaf_decay' }, 'to the last millisecond of the hold')
  assert.deepStrictEqual(c.order(T0 + S.SHOP_LEAF_RETRY_MS, { ...st, lastAt: T0 - CD }), { pick: 'storehub', ...OWN_ORDER }, 'minutes, not an hour: decay takes minutes')
  assert.strictEqual(S.SHOP_LEAF_RETRY_MS, 5 * MIN); assert.ok(S.SHOP_LEAF_RETRY_MS < S.IDLE_MS)
  c.visited('storehub', { status: 'success', stop: 'complete' }, T0 + 6 * MIN)
  assert.strictEqual(c.wait.has('storehub'), false, 'a visit that happened and did not wait ends the hold')
  c.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, T0 + 7 * MIN); c.visited('storehub', { status: 'aborted', stop: 'aborted' }, T0 + 8 * MIN); c.visited('storehub', { status: 'no_effect', stop: 'slots_full' }, T0 + 8 * MIN)
  assert.strictEqual(S.waitHeld(c.wait, 'storehub', T0 + 8 * MIN), 'leaf_decay', 'a visit that did not happen (an abort, a full slot set) neither marks nor ends it')
})
await t('the hold: zone_closed holds its project 6 h for this bot (nothing there changes by itself) -- and only that project: another open project is the pick at once, another sink takes the tower\'s place', () => {
  const T0 = 1_000_000, H6 = S.SHOP_STUCK_RETRY_MS
  assert.strictEqual(S.WAIT_STOPS.zone_closed, H6); assert.strictEqual(H6, 6 * 60 * MIN)
  // alone: no order for it, 6 h
  const a = orderChain(S, { list: [TOWER], states: [{ plot: 'tower', exists: true, complete: true, sinkOpen: true }] })
  const st = a.visited('tower', { status: 'no_effect', stop: 'zone_closed' }, T0)
  for (const dt of [S.orderCooldown('tower'), 60 * MIN, H6 - 1]) assert.deepStrictEqual(a.order(T0 + dt, { ...st, lastAt: T0 - H6 }), { pick: 'tower', order: null, skip: 'zone_closed' }, String(dt))
  assert.deepStrictEqual(a.order(T0 + H6, { ...st, lastAt: T0 - H6 }).order, OWN_ORDER.order, 'asked again after the hold')
  // a visit that PLACED blocks and then ended zone_closed holds too (everything else of the project is built: the stop is the visit\'s last word)
  const p = orderChain(S, { list: [TOWER], states: [{ plot: 'tower', exists: true, complete: true, sinkOpen: true }] })
  assert.strictEqual(p.order(T0 + CD, p.visited('tower', { status: 'success', stop: 'zone_closed' }, T0)).skip, 'zone_closed')
  // beside an open house and another sink: the bot works those -- its whole build order is never held
  const states = [{ plot: 'house2', exists: true, complete: false, free: true }, { plot: 'tower', exists: true, complete: true, sinkOpen: true }, { plot: 'road', exists: true, complete: true, sinkOpen: true }]
  const b = orderChain(S, { list: [HOUSE, TOWER, ROAD], states })
  const sb = b.visited('tower', { status: 'no_effect', stop: 'zone_closed' }, T0)
  assert.deepStrictEqual(b.order(T0 + CD, sb), { pick: 'house2', ...OWN_ORDER })
  const sinks = orderChain(S, { list: [TOWER, ROAD], states: states.slice(1) })
  const ss = sinks.visited('tower', { status: 'no_effect', stop: 'zone_closed' }, T0)
  assert.deepStrictEqual(sinks.order(T0 + S.orderCooldown('road'), ss), { pick: 'road', ...OWN_ORDER }, 'the next sink kind, not the held tower')
  assert.strictEqual(S.waitBackoff(states, sinks.wait, T0 + CD).find(x => x.plot === 'tower').stuck, true, 'stepped aside as a stuck project is (never a sink pick, never a service pick)')
  assert.strictEqual(S.waitBackoff(states, sinks.wait, T0 + H6).find(x => x.plot === 'tower').stuck, undefined)
})
await t('the grounds stand in: the SAME visit falls through to the cleanup on either stop (FALL_STOPS), and while the hold is on the order asks the grounds (NO_ORDER_SKIPS)', () => {
  const L = { record: 'open', emptyUntil: 0, feet: [3, 71, 4], home: { x: 0, y: 70, z: 0 }, slotFree: true, now: 1_000_000 }
  for (const stop of ['leaf_decay', 'zone_closed']) {
    assert.deepStrictEqual(G2.groundsFall({ status: 'no_effect', stop, msLeft: 150_000, tailMs: 60_000, ...L }), { fall: true, why: `fallback:${stop}`, asked: true })
    assert.strictEqual(G2.groundsFall({ status: 'success', stop, placed: 4, msLeft: 150_000, tailMs: 60_000, ...L }).fall, false, 'a visit that built something used its time: no second leg')
    assert.deepStrictEqual(G2.groundsNoOrder({ skip: stop, sinceMs: CD, cooldownMs: CD, health: 20, healthMin: 10, freeSlots: 20, roomMin: 2, ...L }), { ask: true, why: `no_order:${stop}` })
  }
  assert.strictEqual(G2.fallStops('blocked'), false, 'POSITIVE CONTROL: the stop these visits ended on before never fell through')
  // through the real buildOrder with the grounds\' ask wired as skills.mjs wires it (setGroundsFall)
  const GROUNDS = { skill: 'build_shop', args: { grounds: true, why: 'no_order:leaf_decay' } }
  S.setGroundsFall({ ask: ({ skip, now, state }) => { const d = G2.groundsNoOrder({ skip, sinceMs: now - (state?.lastAt ?? -Infinity), cooldownMs: CD, health: 20, healthMin: 10, freeSlots: 20, roomMin: 2, ...L, now }); return d.ask ? { order: { skill: 'build_shop', args: { grounds: true, why: d.why } } } : null }, hold: s => s })
  try {
    const c = orderChain(S, { list: [HUB], states: [{ plot: 'storehub', exists: true, complete: true, damaged: true }] })
    const st = c.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, 1_000_000)
    assert.deepStrictEqual(c.order(1_000_000 + CD, st), { pick: 'storehub', order: GROUNDS, skip: null }, 'the cooldown is a grounds visit, not the hall again')
  } finally { S.setGroundsFall(null) }
})
await t('r1 MUTANT (shop.mjs): the order never asks the hold -- the held project is ordered again at the next cooldown (the live loop; killed for that reason)', async () => {
  await withSrcMutant('shop.mjs', "  { let w = null; try { w = waitOf(plot0) } catch { w = null } if (w && Object.hasOwn(WAIT_STOPS, w)) return { order: null, skip: w } }\n", '', async M => {
    const c = orderChain(M, { list: [HUB], states: [{ plot: 'storehub', exists: true, complete: true, damaged: true }] })
    const st = c.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, 1_000_000)
    assert.deepStrictEqual(c.order(1_000_000 + CD, st), { pick: 'storehub', ...OWN_ORDER })
  })
})
await t('r1 MUTANT (shop.mjs): a held project does not step aside -- it stays the pick ahead of the open house (killed for that reason)', async () => {
  await withSrcMutant('shop.mjs', "  if (!mem?.size) return states\n  return states.map(st => (st?.exists && waitHeld(mem, st.plot, now) ?", "  if (!mem?.size) return states\n  return states.map(st => (false ?", async M => {
    const states = [{ plot: 'storehub', exists: true, complete: true, damaged: true }, { plot: 'house2', exists: true, complete: false, free: true }]
    const c = orderChain(M, { list: [HUB, HOUSE], states })
    const st = c.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, 1_000_000)
    assert.strictEqual(c.order(1_000_000 + CD, st).pick, 'storehub', 'the mutant keeps the bot off the house (its order skipped)')
    const real = orderChain(S, { list: [HUB, HOUSE], states })
    assert.deepStrictEqual(real.order(1_000_000 + CD, real.visited('storehub', { status: 'no_effect', stop: 'leaf_decay' }, 1_000_000)), { pick: 'house2', ...OWN_ORDER })
  })
})

console.log('THE WIRING (structural: comments stripped)')
await t('the retrofit, the two styled sitings, the visit and the effects are wired to the one switch', () => {
  const strip = f => readFileSync(SRC(f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const rr = strip('reroof.mjs'), sk = strip('skills.mjs'), bb = strip('buildbot.mjs'), bs = strip('buildsite.mjs'), br = strip('buildrun.mjs')
  assert.ok(rr.includes('    leafFell: !offs(env?.LEAFFELL) }'))
  assert.ok(rr.includes('  const reach = fx.leafFell ? reachY : reach0'), 'LEAFFELL off: the old reach, line for line')
  assert.strictEqual(rr.split('    if (fx.leafFell) {\n      const lf = await leafFell(r, null)').length, 2, 'asked only after the old reach failed')
  assert.strictEqual(rr.split('if (!r.ok && fx.leafFell && r.rc?.unreached?.length) {').length, 2, 'and after a stair\'s reach')
  assert.ok(rr.includes('let rc = await drive(reroofClearsReachedSteps(PR, home, clear0, { stood, walkR, avoid }))'), 'the switch-on reach hands the loop back after every walk')
  assert.strictEqual(sk.split('...leafFellCtx(bot, bp, TOWNHALL_PLOT),').length, 2); assert.strictEqual(sk.split('...leafFellCtx(bot, bp, plot),').length, 2)
  assert.ok(sk.includes('  if (!LEAFFELL_ON) return {}'))
  assert.ok(sk.includes("const leafFellVisitOpts = (bot, rec) => (LEAFFELL_ON && rec?.leaffell?.trees ? { replantDomain: () => true, replantGoOn: true, saplingAbsent: swSaplingAbsent(bot) } : {})"), 'never replantPerTree: the read\'s G5 counts the record\'s whole replant list at each felling')
  assert.ok(sk.includes('    Object.assign(storeOpts, leafFellVisitOpts(bot, rec))'))
  assert.ok(sk.includes('...(REROOF_FIX.leafFell ? { ...reroofLeafCtx(bot, h.head.plan, rec, read, home, stood, walkR), aborted: () => !!signal?.aborted } : {}) })'))
  assert.ok(bb.includes("const d = zoneDecision({ zones, op: 'dig', cell: { x: c[0], y: c[1], z: c[2] }, purpose: 'target', name, nameRule: zoneGuardOn(),"), 'the effects ask the guard\'s own decision')
  assert.ok(bs.includes("if (typeof ctx.cellClears === 'function' && ctx.leafFell !== undefined) ctx.cellClears.leafFell = ctx.leafFell"))
  assert.ok(br.includes('standMs = STAND_MS, leafFell = LEAFFELL_ON } = {}) {'), 'the visit\'s default is the switch')
  assert.ok(br.includes("        if (leafFell && typeof e.zoneClosed === 'function') {"))
  // r1: the hold, the trunk guard, the cooperative proofs
  assert.ok(sk.includes('    const marked = idleMarks(waitBackoff(waited, b?.shopWait ?? null, now), b?.shopIdle ?? null, now)'), 'the picker reads the holds')
  assert.ok(sk.includes('try { noteWait((ctx.bot.shopWait ??= new Map()), ctx.bot.shopVisitPlot ?? null, res, Date.now()) }'), 'every visit\'s result marks or ends its plot\'s hold')
  assert.ok(sk.includes('setWaitNow(plot => waitHeld(activeMem?.bot?.shopWait ?? null, plot, Date.now()))'), 'the order\'s hook')
  assert.ok(sk.includes('  return { closed: trunkGuard(resNow(), leafZoneClosed(bot)), replantFor }'), 'the retrofit\'s trunk guard is the siting\'s reservation rule')
  assert.ok(bs.includes('if (xc?.fellLogs?.some(at => trunkReserved(res, at))) {'), 'the siting asks the same helper')
  assert.ok(sk.includes("  if (!pr.ok && pr.why === 'aborted') { check(signal); return out('no_effect', 'aborted',"), 'an interrupted proof is no failed proof (no count, no site wait)')
  assert.ok(sk.indexOf("if (!pr.ok && pr.why === 'aborted')") < sk.indexOf('if (!pr.ok) return fail(pr.why, pr.detail)'))
  assert.ok(rr.includes('const p = fx.leafFell ? await proveY(clear, null) : proveWith(clear, null)') && rr.includes('const q = fx.leafFell ? await proveY(clear, keys) : proveWith(clear, keys)'), 'the roof\'s own proofs are driven as steps (bots/test/reroof4.test.mjs traces the whole plan)')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
