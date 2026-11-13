// REROOF-03 (bots/src/reroof.mjs roofTree / reroofOrderedReach / reroofCanopyGrow; skills.mjs buildReroof). LIVE showcase 11-08: the
// retrofit refused every try in 72 h -- hall `cell_not_free spruce_log@-11,71,29` (a spruce rooted on its flat roof), enchanting
// workshop `spruce_log@26,74,-69` (a felled tree's floating remains over its eave), storehub `clear_unreached 5/32` (leaves inside the
// canopy of floating remains beside its west wall, no GROUND stand sees them). Offline on the region dump with the live proof: storehub
// proves (ordered reach + the remains' canopy listed: 79 added, every dig made); the hall's and workshop's logs are no blocker any more.
// Here: the pure rules, THE CHAIN on the fake server (a dig only the new roof's own cells reach: the ground test refuses it -- the
// positive control -- the ordered reach makes it), anchored mutants, the wiring.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const RR = await import('../src/reroof.mjs')
const RR_PATH = new URL('../src/reroof.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withRrMutant (old, neu, fn) {
  const src = readFileSync(RR_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const LOG = { name: 'spruce_log', boundingBox: 'block' }
const LEAF = (persistent = 'false') => ({ name: 'spruce_leaves', boundingBox: 'block', props: { persistent } })
const AIRB = { name: 'air', boundingBox: 'empty' }
const PLANK = { name: 'spruce_planks', boundingBox: 'block' }
const world = (m, dflt = AIRB) => (x, y, z) => m[`${x},${y},${z}`] ?? dflt
const k = a => a.join(',')

console.log('THE PURE RULES')
await t('roofTree: a trunk ROOTED on the building\'s own cell -> the whole trunk + its natural leaves (never a placed hedge, never a record cell)', () => {
  const m = { '0,69,0': PLANK, '0,70,0': LOG, '0,71,0': LOG, '0,72,0': LOG, '1,72,0': LEAF(), '-1,72,0': LEAF('true'), '0,73,1': LEAF(), '2,74,0': LEAF() }
  const tr = RR.roofTree(world(m), [0, 71, 0], { own: new Set(['0,69,0']), recordAt: (x, y, z) => x === 0 && y === 73 && z === 1 })
  assert.strictEqual(tr.why, 'rooted')
  assert.deepStrictEqual(tr.logs, [[0, 70, 0], [0, 71, 0], [0, 72, 0]])
  assert.deepStrictEqual(tr.leaves.map(k).sort(), ['1,72,0', '2,74,0'], 'natural only; another record\'s cell never')
})
await t('roofTree: a felled tree\'s FLOATING remains (air under its lowest log) -> dug whole; a tree in the ground -> null; too tall -> null', () => {
  const fl = { '26,73,-69': LOG, '26,74,-69': LOG, '26,75,-69': LOG }   // the enchanting workshop's remains: air at 72
  assert.strictEqual(RR.roofTree(world(fl), [26, 74, -69]).why, 'floating')
  assert.strictEqual(RR.roofTree(world(fl), [26, 74, -69]).logs.length, 3)
  const ground = { ...fl, '26,72,-69': { name: 'dirt', boundingBox: 'block' } }
  assert.strictEqual(RR.roofTree(world(ground), [26, 74, -69]), null, 'a living tree beside the building: felling it owes a sapling')
  const tall = { '0,69,0': PLANK }; for (let y = 70; y < 70 + RR.ROOFTREE_MAX + 2; y++) tall[`0,${y},0`] = LOG
  assert.strictEqual(RR.roofTree(world(tall), [0, 72, 0], { own: new Set(['0,69,0']) }), null)
  assert.strictEqual(RR.roofTree(world({}), [0, 70, 0]), null, 'no log')
})
await t('reroofObstacles: a roof tree in an added cell is listed (kind remains + leaves); without the building\'s cells it stays the blocker', () => {
  const m = { '0,69,0': PLANK, '0,70,0': LOG, '0,71,0': LOG, '1,71,0': LEAF() }
  const fx = RR.reroofFixes({})
  const ob = RR.reroofObstacles(world(m), [[0, 70, 0], [0, 71, 0]], { fx, own: new Set(['0,69,0']) })
  assert.strictEqual(ob.blocker, null)
  assert.deepStrictEqual(ob.clear.filter(c => c.kind === RR.REROOF_REMAINS).map(c => k(c.at)), ['0,70,0', '0,71,0'])
  assert.ok(ob.clear.some(c => c.kind === 'leaves' && k(c.at) === '1,71,0'))
  assert.notStrictEqual(RR.REROOF_REMAINS, 'tree', 'no sapling owed: never a kind=tree clear (G5, clears()\' replant wait)')
  const live = RR.reroofObstacles(world(m), [[0, 70, 0]], { fx })
  assert.deepStrictEqual(live.blocker, { at: [0, 70, 0], name: 'spruce_log' }, 'POSITIVE CONTROL: the live answer')
  const off = RR.reroofObstacles(world(m), [[0, 70, 0]], { fx: RR.reroofFixes({ REROOF_ROOFTREE: 'off' }), own: new Set(['0,69,0']) })
  assert.ok(off.blocker, 'REROOF_ROOFTREE=off: as before')
})
await t('reroofCanopyGrow: round an unreached dig, a floating remains\' log is listed whole (remains) and natural leaves within 1; bounded', () => {
  const m = { '5,10,5': LEAF(), '6,10,5': LEAF(), '7,10,5': LOG, '7,11,5': LOG, '5,11,5': LEAF('true') }
  const read = world(m)
  const clear = [{ at: [5, 10, 5], kind: 'leaves', name: 'spruce_leaves' }]
  // the stub reach: the listed leaf is reached only once the remains log at 7,11,5 is on the list
  const reach = list => (list.some(c => k(c.at) === '7,11,5') ? { ok: true, unreached: [] } : { ok: false, unreached: [[5, 10, 5]] })
  const g = RR.reroofCanopyGrow(read, clear, reach)
  assert.ok(g.rc.ok)
  assert.deepStrictEqual(g.clear.filter(c => c.kind === RR.REROOF_REMAINS).map(c => k(c.at)).sort(), ['7,10,5', '7,11,5'])
  assert.ok(g.clear.some(c => k(c.at) === '6,10,5' && c.kind === 'leaves'))
  assert.ok(!g.clear.some(c => k(c.at) === '5,11,5'), 'a placed hedge: never')
  const never = RR.reroofCanopyGrow(read, clear, () => ({ ok: false, unreached: [[5, 10, 5]] }), { max: 2 })
  assert.ok(!never.rc.ok && never.added <= 2, 'bounded, and the answer stays no')
  assert.strictEqual(RR.reroofCanopyGrow(read, clear, () => ({ ok: true, unreached: [] })).added, 0, 'reached already: nothing added')
})

// ---- THE CHAIN: a leaf no ground stand reaches, and the new roof's own cells (a stair of columns) that reach it once they stand ----
const LEAF_AT = [10, G + 9, 0]
function scene () {
  const srv = server({ [k(LEAF_AT)]: 'spruce_leaves' })
  const plain = srv.read
  srv.read = (x, y, z) => { const b = plain(x, y, z); return b && /_leaves$/.test(b.name) ? { ...b, props: { persistent: 'false' } } : b }
  // the roof's proven cells in the proof's order (bottom up): columns of 1..5 blocks at x 5..9, the walk climbs them
  const cells = []
  for (let i = 0; i < 5; i++) for (let y = G + 1; y <= G + 1 + i; y++) cells.push({ at: [5 + i, y, 0], role: 'roof', seg: 'roof-edge' })
  return { read: srv.read, cells, clear: [{ at: LEAF_AT, kind: 'leaves', name: 'spruce_leaves' }] }
}
console.log('THE CHAIN (fake server, the real walkFrom / stepFor / digStand)')
await t('POSITIVE CONTROL (the live dead end): no ground stand reaches the leaf (reroofClearsReached: unreached)', () => {
  const s = scene()
  const rc = RR.reroofClearsReached(s.read, HOME, s.clear, { stood: [], walkR: 40 })
  assert.strictEqual(rc.ok, false); assert.deepStrictEqual(rc.unreached, [LEAF_AT])
})
await t('reroofOrderedReach: the roof\'s own cells placed first (bottom up, each from a step) give the stand -- every dig made', () => {
  const s = scene()
  const o = RR.reroofOrderedReach(s.read, HOME, s.clear, s.cells, { stood: [], walkR: 40, domain: () => true })
  assert.strictEqual(o.ok, true, JSON.stringify(o))
  assert.ok(o.placed >= 10, `placed ${o.placed}`)
})
await t('reroofOrderedReach: cells that never stand (no support anywhere) -> the dig stays unreached, by name', () => {
  const s = scene()
  const floating = s.cells.map(c => ({ ...c, at: [c.at[0], c.at[1] + 30, c.at[2]] }))
  const o = RR.reroofOrderedReach(s.read, HOME, s.clear, floating, { stood: [], walkR: 40, domain: () => true })
  assert.strictEqual(o.ok, false); assert.deepStrictEqual(o.unreached, [LEAF_AT])
})
await t('Codex r1 BLOCKER 2: a dig only a LATER segment\'s cells reach is unreached while an earlier segment cannot finish (runVisit stops there)', () => {
  const s = scene()
  // an earlier segment with one cell that never stands (high in the air), the stair after it
  const cells = [{ at: [30, G + 30, 30], role: 'roof', seg: 'roof-edge' }, ...s.cells.map(c => ({ ...c, seg: 'roof-inner' }))]
  const o = RR.reroofOrderedReach(s.read, HOME, s.clear, cells, { stood: [], walkR: 40, domain: () => true })
  assert.strictEqual(o.ok, false); assert.strictEqual(o.placed, 0)
})
await t('Codex r1 BLOCKER 3: a placed cell is its own block -- a stair of SLABS is no floor to the walk, the leaf stays unreached', () => {
  const s = scene()
  const o = RR.reroofOrderedReach(s.read, HOME, s.clear, s.cells, { stood: [], walkR: 40, domain: () => true, blockOf: () => ({ name: 'spruce_slab', boundingBox: 'block', props: { type: 'bottom' } }) })
  assert.strictEqual(o.ok, false)
})
await t('Codex r1 BLOCKERS 1 + 4: a trunk with a record\'s log cell is never a roof tree; roofTrees off lists no log', () => {
  const m = { '0,69,0': PLANK, '0,70,0': LOG, '0,71,0': LOG }
  assert.strictEqual(RR.roofTree(world(m), [0, 70, 0], { own: new Set(['0,69,0']), recordAt: (x, y, z) => y === 71 }), null, 'another record\'s log in the trunk')
  assert.strictEqual(RR.roofTree(world(m), [0, 70, 0], { own: new Set(['0,69,0', '0,71,0']) }), null, 'the building\'s own log cell in the trunk')
  const fl = { '5,10,5': LEAF(), '7,10,5': LOG, '7,11,5': LOG }
  const g = RR.reroofCanopyGrow(world(fl), [{ at: [5, 10, 5], kind: 'leaves', name: 'spruce_leaves' }], () => ({ ok: false, unreached: [[5, 10, 5]] }), { roofTrees: false })
  assert.ok(!g.clear.some(c => c.kind === RR.REROOF_REMAINS), 'REROOF_ROOFTREE=off: no log listed')
})
await t('MUTANT: the placement pass never places -- the ordered reach answers like the ground test (killed for that reason)', async () => {
  await withRrMutant('          over.set(key, blockOf(c) ?? SOLIDB); open.delete(key); placed++; progress = true; moved = true\n', '          continue\n', async M => {
    const s = scene()
    assert.strictEqual(M.reroofOrderedReach(s.read, HOME, s.clear, s.cells, { stood: [], walkR: 40, domain: () => true }).ok, false)
  })
})
await t('MUTANT: roofTree loses the floating rule -- the workshop\'s remains are a blocker again', async () => {
  await withRrMutant("  const why = own.has(`${x},${lo - 1},${z}`) ? 'rooted' : under && AIR_RX.test(nmOf(under)) ? 'floating' : null\n",
    "  const why = own.has(`${x},${lo - 1},${z}`) ? 'rooted' : null\n", async M => {
      assert.strictEqual(M.roofTree(world({ '26,73,-69': LOG, '26,74,-69': LOG }), [26, 74, -69]), null)
    })
})
await t('wired (structural, comments stripped): buildReroof passes its own cells, asks the ordered reach then the canopy, publishes the grown list', () => {
  // reroof-04: the proof moved into reroof.mjs reroofProve (reroofProveWith); buildReroof calls it and publishes its lists
  const strip = f => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const sk = strip('../src/skills.mjs'), rr = strip('../src/reroof.mjs')
  assert.ok(rr.includes('reroofObstacles(read, addedAt, { decor, recordAt, fx, own })'))
  assert.ok(rr.includes('if (rc.ok || !fx.ordered) return { ok: rc.ok, clear: clear0, p: p0, rc }'))
  assert.ok(rr.includes('const g = reroofCanopyGrow(read, clear0, list => ordered(list, p0.cells), { own, recordAt, roofTrees: fx.roofTree })'))
  assert.ok(rr.includes("blockOf: c => ({ name: nameOf(c.role), boundingBox: c.role === 'light' ? 'empty' : 'block'"))
  assert.ok(sk.includes('const pr = await reroofProve(read, home, rec, bpOld, bpAdd, { stood, walkR, domain, decor: decorRec, recordAt, fx: REROOF_FIX, ...(REROOF_FIX.leafFell ? reroofLeafCtx(bot, h.head.plan, rec, read, home, stood, walkR) : {}) })'))
  assert.ok(sk.includes('reroofRecord(cur, p.cells, bpNew, style, { clear, temp: pr.temp, notch: pr.notch, replant: pr.replant ?? [], leaf: pr.leaf ?? null })'))
  assert.ok(RR.reroofModeDetail(true, RR.reroofFixes({})).includes('rooftree=1 ordered=1'))
  assert.strictEqual(RR.reroofFixes({ REROOF_ORDERED: 'off' }).ordered, false)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
