// WHSITE-01 (src/whsite.mjs has the owner's words, the record and the phases): the new storehouse's ground -- the site is the switch,
// the record only grows, the clears go by quadrant under their own leases. Behaviour, anchored mutants, then the wiring.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-whsite-${process.pid}`
process.env.BOT_NAME = 'TestBot'
delete process.env.WAREHOUSE_SITE
const W = await import('../src/whsite.mjs')
const B = await import('../src/buildrun.mjs')
const T = await import('../src/tidy.mjs')
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

const SITE = '38,-51,62,-27/38,-58,78,-18/68'
const site = W.whSiteOf({ WAREHOUSE_SITE: SITE })
const k = a => a.join(',')
// a survey's findings (tidy.mjs plotPrep's shape): two trees (one tall, with a two-step stair), a leaf over the stair, cuts, fills
const pp1 = () => ({
  trees: [{ col: [40, -50], name: 'spruce_log', base: [40, 69, -50], top: 76 }, { col: [60, -30], name: 'oak_log', base: [60, 69, -30], top: 72 }],
  clear: [...[69, 70, 71, 72, 73, 74, 75, 76].map(y => ({ at: [40, y, -50], kind: 'tree', name: 'spruce_log', tree: 0 })), ...[69, 70, 71, 72].map(y => ({ at: [60, y, -30], kind: 'tree', name: 'oak_log', tree: 1 })),
    { at: [41, 72, -50], kind: 'leaves', name: 'spruce_leaves' }],
  platforms: [{ tree: 0, cells: [[41, 69, -50], [41, 70, -50], [42, 69, -50]], phase: 'up' }],
  cut: [{ at: [45, 69, -45], name: 'dirt' }, { at: [45, 70, -45], name: 'grass_block' }],
  fill: [{ at: [55, 68, -29] }, { at: [55, 67, -29] }],
  skipped: { tree_tall: 1 },
})
const rp1 = [{ cell: [90, 69, -40], species: 'spruce', sapling: 'spruce_sapling', state: 'owed' }]   // one cell for two trees: the second owes none

await t('THE SITE IS THE SWITCH: unset is off; a site is read whole or not at all', () => {
  for (const v of [undefined, '', 'off', '0', 'false', 'no', ' OFF ']) assert.equal(W.whSiteOf({ WAREHOUSE_SITE: v }), null)
  assert.equal(W.WHSITE.on, false, 'the default: no project (this process has no WAREHOUSE_SITE)')
  assert.deepEqual(site, { core: [38, -51, 62, -27], grow: [38, -58, 78, -18], floor: 68 })
  for (const bad of ['38,-51,62,-27', '38,-51,62,-27/38,-58,78,-18', '38,-51,62,-27/38,-58,78,-18/x', '38,-51,62/38,-58,78,-18/68', '62,-51,38,-27/38,-58,78,-18/68',
    '30,-51,62,-27/38,-58,78,-18/68' /* the core leaves the growth box */, '38,-51,62,-27/38,-58,78,-18/68/9', '0,0,200,10/0,0,200,10/68' /* too wide */, '38.5,-51,62,-27/38,-58,78,-18/68', '38,,62,-27/38,-58,78,-18/68', '38,-51,62,-27/38,-58,78,-18/']) assert.equal(W.whSiteOf({ WAREHOUSE_SITE: bad }), null, bad)
  assert.match(W.whSiteModeDetail(site), /^on=1 core=38,-51,62,-27 grow=38,-58,78,-18 floor=68 builders=6 quads=NE\/NW\/SE\/SW$/)
  assert.equal(W.whSiteModeDetail(null), 'on=0')
})

await t('the first generation holds the growth box and lists nothing; a survey only ever ADDS (the read judges against the head record)', async () => {
  const base = W.whSiteBase(site, { home: { x: 0, y: 70, z: 0 }, now: 1, by: 'A' })
  assert.equal(base.plot, 'warehouse'); assert.equal(base.blueprint, 'warehouse@0'); assert.equal(base.builders_max, 6)
  assert.deepEqual(base.zones, [{ box: [38, -64, -58, 78, 320, -18], why: 'project:warehouse' }])
  assert.deepEqual([base.cells.length, base.clear.length, base.replant.length, base.surveys], [0, 0, 0, 0])
  assert.deepEqual(base.segments.map(s => s.seg), ['prep'], 'ONE segment: one bot places at a time')
  const a = W.whSiteAdd(base, pp1(), rp1, { now: 2 })
  assert.deepEqual(a.added, { trees: 2, logs: 12, stands: 3, cuts: 2, fills: 2, replants: 1 })
  const r = a.rec
  assert.equal(r.surveys, 1); assert.deepEqual(r.kept, { tree_tall: 1 })
  assert.equal(a.read, false, 'these findings carry no plot summary: not a read of the box')
  assert.equal(W.whSiteAdd(base, { ...pp1(), plots: [{ id: 'WH', floor: 68 }] }, rp1).read, true)
  assert.equal(W.whSiteAdd(base, { trees: [], clear: [], platforms: [], cut: [], fill: [], plots: [], skipped: { plot_unread: 1 } }, []).read, false, 'an unloaded box: nothing found, and NOT read')
  assert.deepEqual(r.trees.map(x => x.q), ['NW', 'SE'])
  assert.ok(r.cells.every(c => c.seg === 'prep'))
  assert.deepEqual(r.cells.map(c => c.role).sort(), ['fill', 'fill', 'stand', 'stand', 'stand'])
  // every stair cell is BOTH a cell (its placement is on the record) and a clear (its dig is on the record)
  for (const c of r.cells.filter(x => x.role === 'stand')) assert.ok(r.clear.some(x => x.kind === 'stand' && k(x.at) === k(c.at) && x.name === 'cobblestone' && x.q === 'NW'))
  assert.ok(r.clear.filter(c => c.kind === 'tree').every(c => c.q === (c.tree === 0 ? 'NW' : 'SE')), 'a tree is one quadrant\'s, whole')
  assert.deepEqual(r.replant.map(x => [x.tree, x.sapling]), [[0, 'spruce_sapling']], 'the tree with no cell owes none')
  assert.equal(new Set(r.clear.map(c => k(c.at))).size, r.clear.length, 'a cell is listed once')
  // the same findings again: nothing new
  const b = W.whSiteAdd(r, pp1(), rp1, { now: 3 })
  assert.deepEqual(b.added, { trees: 0, logs: 0, stands: 0, cuts: 0, fills: 0, replants: 0 })
  // a later survey: one new tree (index 2), one new cut; EVERYTHING listed before is still listed
  const pp2 = { trees: [{ col: [61, -50], name: 'birch_log', base: [61, 69, -50], top: 73 }], clear: [{ at: [61, 69, -50], kind: 'tree', name: 'birch_log', tree: 0 }], platforms: [], cut: [{ at: [40, 69, -50], name: 'dirt' }, { at: [50, 69, -40], name: 'stone' }], fill: [], skipped: {} }
  const c2 = W.whSiteAdd(b.rec, pp2, [{ cell: [95, 69, -40], sapling: 'birch_sapling', state: 'owed' }])
  assert.deepEqual(c2.added, { trees: 1, logs: 1, stands: 0, cuts: 1, fills: 0, replants: 1 }, 'the cut where the spruce\'s log is listed is not listed twice')
  assert.equal(c2.rec.clear.find(x => k(x.at) === '61,69,-50').tree, 2); assert.equal(c2.rec.replant[1].tree, 2); assert.equal(c2.rec.trees[2].q, 'NE')
  for (const e of r.clear) assert.ok(c2.rec.clear.some(x => k(x.at) === k(e.at) && x.kind === e.kind), 'no clear is ever dropped')
  for (const e of r.cells) assert.ok(c2.rec.cells.some(x => k(x.at) === k(e.at) && x.role === e.role), 'no cell is ever dropped')
  assert.equal(W.whSiteAdd({ plot: 'yard', cells: [], clear: [] }, pp1()), null)
  // Codex r2 blocker G: TWO BOTS, ONE OLD RECORD -- bot A surveyed `r`; meanwhile bot B listed canopy leaves on the head; A's publish
  // is applied to the HEAD (whSurveyPublish), so the head holds both; a second surveyor's findings from the same old record too
  const read = x => ({ ...x, plots: [{ id: 'WH', floor: 68 }] })
  const head = W.whSiteCanopy(r, [{ at: [39, 75, -50], kind: 'leaves', name: 'spruce_leaves', tree: 0 }])
  assert.equal(head.clear.length, r.clear.length + 1, 'positive control: the head has one more clear than the record A surveyed')
  const afterA = W.whSurveyPublish(head, read(pp2), [{ cell: [95, 69, -40], sapling: 'birch_sapling', state: 'owed' }], { surveys0: r.surveys })
  const pp3 = { trees: [], clear: [], platforms: [], cut: [{ at: [52, 69, -33], name: 'dirt' }], fill: [{ at: [53, 68, -33] }], skipped: {} }
  const afterB = W.whSurveyPublish(afterA, read(pp3), [], { surveys0: r.surveys })
  const sup = (big, small) => small.clear.every(e => big.clear.some(x => k(x.at) === k(e.at) && x.kind === e.kind)) && small.cells.every(e => big.cells.some(x => k(x.at) === k(e.at)))
  assert.ok(sup(afterA, head) && sup(afterB, afterA) && sup(afterB, head), 'the head only ever grows')
  assert.ok(afterB.clear.some(x => k(x.at) === '39,75,-50') && afterB.clear.some(x => k(x.at) === '61,69,-50') && afterB.clear.some(x => k(x.at) === '52,69,-33'), 'B\'s canopy, A\'s tree and the second survey\'s cut are all there')
  // nothing new: it completes only when no other survey was published since it looked, and only a READ box
  assert.equal(W.whSurveyPublish(afterB, read(pp3), [], { surveys0: r.surveys }), null, 'another survey came first: look again')
  const fin = W.whSurveyPublish(afterB, read(pp3), [], { surveys0: afterB.surveys, now: 9 })
  assert.equal(fin.structure_complete, true); assert.equal(fin.prepDone, 9); assert.ok(sup(fin, afterB))
  assert.equal(W.whSurveyPublish(afterB, pp3, [], { surveys0: afterB.surveys }), null, 'an unread box completes nothing')
  assert.equal(W.whSurveyPublish({ ...afterB, blueprint: 'warehouse@1' }, read(pp3), [], { surveys0: afterB.surveys }), null, 'a later generation\'s record is not this one\'s')
  await killedBy(P('whsite'), W, '  const a = whSiteAdd(cur, pp, rp, { now })\n  if (!a || !a.read) return null', '  const a = whSiteAdd(arguments[4] ?? cur, pp, rp, { now })\n  if (!a || !a.read) return null', M => assert.ok(sup(M.whSurveyPublish(head, read(pp2), [], { surveys0: r.surveys }, r), head)))
  await killedBy(P('whsite'), W, "const push = e => { const k = kOf(e.at); if (inClear.has(k)) return false; inClear.add(k); clear.push(e); return true }", 'const push = e => { clear.push(e); return true }', M => { const x = M.whSiteAdd(M.whSiteAdd(base, pp1(), rp1).rec, pp2, []); assert.equal(new Set(x.rec.clear.map(c => k(c.at))).size, x.rec.clear.length) })
})

await t('THE PHASES: fell while a log stands (the stairs up), then level (the stairs down, the cuts, the fills), then a survey, then done', async () => {
  const r = W.whSiteAdd(W.whSiteBase(site), pp1(), rp1).rec
  const world = new Map()
  const AIR = { name: 'air', boundingBox: 'empty' }
  const read = (x, y, z) => world.get(`${x},${y},${z}`) ?? AIR
  const set = (at, name) => world.set(k(at), { name, boundingBox: name === 'air' ? 'empty' : 'block' })
  for (const c of r.clear) if (c.kind !== 'stand') set(c.at, c.name)
  let ph = W.whPhase(read, r)
  assert.equal(ph.phase, 'fell'); assert.equal(ph.logs, 12)
  assert.deepEqual(ph.byQuad, { NW: 9, SE: 4 }, '8 logs and the leaf in NW, 4 logs in SE')
  assert.equal(W.whPhase(() => null, r).phase, 'unread')
  // the views
  const fv = W.whFellView(r), lv = W.whLevelView(r)
  assert.deepEqual([...new Set(fv.cells.map(c => c.role))], ['stand']); assert.deepEqual([...new Set(fv.clear.map(c => c.kind))].sort(), ['leaves', 'tree']); assert.equal(fv.replant.length, 1)
  assert.deepEqual([...new Set(lv.cells.map(c => c.role))], ['fill']); assert.deepEqual([...new Set(lv.clear.map(c => c.kind))].sort(), ['cut', 'stand']); assert.equal(lv.replant.length, 0)
  assert.equal(fv.clear.length + lv.clear.length, r.clear.length, 'every clear is in exactly one view')
  // the stairs go up; the oak comes down: its quadrant is finished, the spruce's stair is still wanted
  for (const c of r.cells.filter(x => x.role === 'stand')) set(c.at, 'cobblestone')
  for (const c of r.clear.filter(x => x.kind === 'tree' && x.tree === 1)) set(c.at, 'air')
  ph = W.whPhase(read, r)
  assert.deepEqual([ph.phase, ph.logs, ph.byQuad.SE ?? 0, ph.stands], ['fell', 8, 0, 0], 'a stair is no cut while its tree stands')
  const done = W.whStandDone(r, read)
  assert.equal(done(r.cells.find(x => x.role === 'stand')), false, 'the spruce stands: its stair is wanted')
  // the spruce comes down: the level -- the three stair cells, the two cuts, the two fills
  for (const c of r.clear.filter(x => x.kind === 'tree' || x.kind === 'leaves')) set(c.at, 'air')
  ph = W.whPhase(read, r)
  assert.deepEqual([ph.phase, ph.logs, ph.stands, ph.cuts, ph.fills], ['level', 0, 3, 2, 2])
  assert.deepEqual(ph.byQuad, { NW: 5 })
  assert.equal(W.whStandDone(r, read)(r.cells.find(x => x.role === 'stand')), true, 'its tree is down: never placed again')
  for (const c of r.clear) set(c.at, 'air')
  for (const c of r.cells.filter(x => x.role === 'fill')) set(c.at, 'grass_block')
  assert.equal(W.whPhase(read, r).phase, 'survey', 'nothing listed is left: look again (the ground the trees stood on)')
  assert.equal(W.whPhase(read, { ...r, prepDone: 5 }).phase, 'done'); assert.equal(W.whPhase(read, { ...r, surveys: W.WHS_SURVEYS }).phase, 'done', 'bounded')
  await killedBy(P('whsite'), W, "else if (c.kind === 'stand') { if (here && !treeUp.has(c.tree)) {", "else if (c.kind === 'stand') { if (here) {", M => { const w2 = new Map(world); const rd = (x, y, z) => w2.get(`${x},${y},${z}`) ?? AIR; for (const c of r.clear) if (c.kind === 'tree') w2.set(k(c.at), { name: c.name, boundingBox: 'block' }); for (const c of r.cells.filter(x => x.role === 'stand')) w2.set(k(c.at), { name: 'cobblestone', boundingBox: 'block' }); assert.equal(M.whPhase(rd, r).stands, 0) })
})

await t('FOUR BOTS FELL AT ONCE: a quadrant a lease; a builder takes its own first, then the next with work that is free', async () => {
  assert.equal(W.quadOf(site.core, 38, -51), 'NW'); assert.equal(W.quadOf(site.core, 62, -51), 'NE'); assert.equal(W.quadOf(site.core, 38, -27), 'SW'); assert.equal(W.quadOf(site.core, 62, -27), 'SE')
  assert.equal(W.quadOf(site.core, 50, -39), 'SE', 'the middle column and row')
  const by = { NE: 3, SW: 9 }
  assert.equal(W.whQuadFor(by, 1), 'NE'); assert.equal(W.whQuadFor(by, 2), 'SW', 'NW has none: the next with work'); assert.equal(W.whQuadFor(by, 4), 'SW'); assert.equal(W.whQuadFor(by, 5), 'NE')
  assert.equal(W.whQuadFor(by, 1, q => q !== 'NE'), 'SW', 'NE is another bot\'s'); assert.equal(W.whQuadFor(by, 1, () => false), null); assert.equal(W.whQuadFor({}, 1), null)
  // the leases: the read's own pattern (seg-[A-Za-z0-9-]+), one per quadrant, and each part's own clears only
  for (const q of W.WHS_QUADS) { const p = W.whClearPart(q); assert.match(p.lease, /^seg-[A-Za-z0-9-]+$/); assert.equal(B.clearLeaseOf({ clearPart: p }), `seg-clear-${q}`); assert.equal(p.has({ q }), true); assert.equal(p.has({ q: 'XX' }), false) }
  assert.equal(new Set(W.WHS_QUADS.map(q => W.whClearPart(q).lease)).size, 4)
  // EVERY OTHER PROJECT: the one lease and the whole list, as before
  assert.equal(B.clearLeaseOf({}), 'seg-clear'); assert.equal(B.clearLeaseOf(undefined), 'seg-clear'); assert.equal(B.clearLeaseOf({ clearPart: { lease: 'slot1' } }), 'seg-clear', 'never another kind of lease')
  assert.equal(B.clearPartHas({}, { q: 'NE' }), true); assert.equal(B.clearPartHas({ clearPart: W.whClearPart('NE') }, { q: 'SW' }), false)
  // Codex r2 blocker F: a replant's click is checked against the lease the visit HOLDS -- `clear-NE` under a quadrant's, `clear` otherwise
  assert.equal(B.clearSegOf({}), 'clear'); assert.equal(B.clearSegOf({ clearPart: W.whClearPart('NE') }), 'clear-NE')
  for (const q of W.WHS_QUADS) assert.equal(`seg-${B.clearSegOf({ clearPart: W.whClearPart(q) })}`, B.clearLeaseOf({ clearPart: W.whClearPart(q) }), 'the click\'s segment IS the lease taken')
  await killedBy(P('buildrun'), B, ".test(p.clearPart.lease) ? p.clearPart.lease : 'seg-clear')", ".test(p.clearPart.lease) ? p.clearPart.lease : 'seg-clear-all')", M => assert.equal(M.clearLeaseOf({}), 'seg-clear'))
  await killedBy(P('buildrun'), B, "export const clearPartHas = (p, c) => typeof p?.clearPart?.has !== 'function' || !!p.clearPart.has(c)", 'export const clearPartHas = (p, c) => !!p?.clearPart?.has?.(c)', M => assert.equal(M.clearPartHas({}, { q: 'NE' }), true))
  // the canopy's leaves join the quadrant of the tree they hide, once
  const r = W.whSiteAdd(W.whSiteBase(site), pp1(), rp1).rec
  const c = W.whSiteCanopy(r, [{ at: [39, 75, -50], kind: 'leaves', name: 'spruce_leaves', tree: 0 }, { at: [41, 72, -50], kind: 'leaves', name: 'spruce_leaves', tree: 0 }])
  assert.equal(c.clear.length, r.clear.length + 1, 'the listed leaf is not listed again'); assert.equal(c.clear.at(-1).q, 'NW')
  assert.equal(W.whSiteCanopy(c, [{ at: [39, 75, -50], name: 'spruce_leaves', tree: 0 }]), null)
})

await t('the project: in the list, in the order only with a site, guarded once sited; plotPrep levels to a given floor', () => {
  assert.deepEqual({ ...S.WHS_PROJECT }, { plot: 'warehouse', blueprint: 'warehouse@0', after: 'storehub', builders: 6 })
  // NO SITE NAMED (this process): not a project at all -- not in the list, not guarded, not one more record read (Codex r3)
  assert.ok(S.PROJECTS.some(p => p.plot === 'storehub'), 'positive control: the list is read')
  assert.ok(!S.PROJECTS.some(p => p.plot === 'warehouse')); assert.ok(!S.projectsGuarded().some(p => p.plot === 'warehouse')); assert.ok(!S.projectsGuarded([]).some(p => p.plot === 'warehouse'))
  one(strip(readFileSync(P('shop'), 'utf8')), '\\.\\.\\.\\(WHSITE\\.on \\? \\[WHS_PROJECT\\] : \\[\\]\\),', 'listed only with a site')
  const args = Array(31).fill(undefined); args[0] = true; args[7] = true; args[14] = true
  assert.ok(S.projectsOn(...args).some(p => p.plot === 'storehub'), 'positive control: the hall is in the order')
  assert.ok(!S.projectsOn(...args).some(p => p.plot === 'warehouse'), 'no site: not in the order')
  args[30] = true
  assert.ok(!S.projectsOn(...args).some(p => p.plot === 'warehouse'), 'unlisted: the order cannot offer it')
  // tidy.mjs plotPrep: a flat 3 x 3 of grass at y 66 -- its median floor is 66 (nothing to do); floor 68: two fills a column
  const read = (x, y, z) => (y <= 66 ? { name: y === 66 ? 'grass_block' : 'dirt', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  const home = { x: 0, y: 66, z: 0 }
  const own = T.plotPrep(read, { plots: [{ id: 'A', box: [10, 10, 12, 12] }], home })
  assert.equal(own.plots[0].floor, 66, 'positive control: the plot was read'); assert.equal(own.fill.length, 0)
  const given = T.plotPrep(read, { plots: [{ id: 'A', box: [10, 10, 12, 12], floor: 68 }], home })
  assert.equal(given.plots[0].floor, 68); assert.equal(given.fill.length, 18)
  assert.equal(T.plotPrep(read, { plots: [{ id: 'A', box: [10, 10, 12, 12], floor: 65 }], home }).cut.length, 9)
})

await t('wiring: the dispatch, the visit\'s quadrant lease, the fileless blueprint, the record that is never damaged', () => {
  const src = strip(readFileSync(P('skills'), 'utf8'))
  one(src, 'if \\(proj\\.plot === WHS_PLOT\\) return buildWarehouseSite\\(ctx, args, signal\\)', 'the dispatch')
  one(src, "clearPart: q \\? whClearPart\\(q\\) : \\{ lease: 'seg-clear-none', has: \\(\\) => false \\}", 'the quadrant\'s lease')
  one(src, 'record: fell \\? whFellView\\(rec\\) : whLevelView\\(rec\\)', 'the phase\'s view')
  one(src, 'if \\(r\\.blueprint === WHS_BLUEPRINT\\) return false', 'prepared ground is never damaged')
  one(src, 'id === STEPWELL_BLUEPRINT \\|\\| id === WHS_BLUEPRINT \\? \\{ id, palette: \\{\\} \\}', 'no blueprint file is read')
  one(src, "const lz = projTakeLease\\(dir, key, 'seg-survey', me\\)", 'one surveyor')
  one(src, "if \\(!sv\\?\\.read\\) \\{ whsRow\\(bot, 'survey', \\{ phase: 'survey', why: 'box_unread' \\}, 'no_effect'\\); return out\\(", 'an unread box never completes the ground')
  one(src, "kind: 'warehouse_site', status: 'success', snapshot: snapshot\\(bot\\), detail: `op=mode ", 'the licence row')
  const br = strip(readFileSync(P('buildrun'), 'utf8'))
  assert.equal((br.match(/clearLeaseOf\(p\)/g) ?? []).length, 6, 'the clears\' and the replant\'s lease: taken, held, released')
  one(br, 'const v = await click\\(r\\.cell, r\\.sapling, step, clearSegOf\\(p\\), seg\\.gen, ', 'the replant\'s click is under the lease it holds')
  assert.ok(W.WHS_PALETTE.fill.includes('cobblestone') && W.WHS_PALETTE.fill.includes('dirt') && W.WHS_PALETTE.fill.at(-1) === '*solid', 'a fill is whatever ground the bag holds')
  one(src, 'palette: WHS_PALETTE, res, resFailed, slot: slot\\.slot', 'a moved replant reads the reservations')
  one(src, 'const pub = publishRecord\\(dir, key, cur => whSurveyPublish\\(cur, sv\\.pp, sv\\.rp, \\{ surveys0 \\}\\), \\{ by: me \\}\\)', 'the survey is merged onto the head')
  one(br, 'record\\.clear \\?\\? \\[\\]\\)\\.filter\\(c => clearPartHas\\(p, c\\)\\)\\.filter\\(c => c\\?\\.apex !== 1 && ', 'the part\'s own clears')
})

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
