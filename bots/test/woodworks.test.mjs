// FENCES-01: THE WOODWORKS SINK (bots/src/woodworks.mjs; the `wood` kind in sinks.mjs; the gate's facing in townstyle.mjs orientAim;
// the skills.mjs wiring: its pressure, its siting context, its kit and the stall that keeps an unfunded structure from being offered).
// Behaviour on the flat fake server (helpers/buildfake.mjs): the bill, the pressure (reserve and unread town), the ring and its loop
// order, the fence rules (never a path, a record column, a door front, a reservation, a wet column), the openings (ways in, path
// crossings, at least two on different sides), the gates (one an opening, in line with the fence), the PROOF (a ring that would shut
// the walk is opened where the walk went; a ring round ground the town cannot reach is refused; nothing the walk held is lost), the
// rails (a shoulder above a drop, never over it), the refusal chain (no logs -> unfunded, nothing to fence -> no_site, a retired record
// never fenced, a record fenced once), the kit's need, the sink wiring. Anchored mutants (present and unique) for the rules leaned on.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const W = await import('../src/woodworks.mjs')
const S = await import('../src/sinks.mjs')
const TS = await import('../src/townstyle.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const WOOD_PATH = new URL('../src/woodworks.mjs', import.meta.url)
const SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const MODS = new Map([[WOOD_PATH.href, W], [SINKS_PATH.href, S]])
/** BOTH WAYS: the scenario passes on the real module and throws on the mutant. */
const killed = async (file, old, neu, scenario) => {
  await scenario(MODS.get(file.href))
  let k = false
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}

// ---- the fake town: a forest record (box 10..16 x 10..14, its zone box + 1, level G), a farm, a path along z = 0 ------------------
const forestRec = (o = {}) => ({ plot: 'forest', blueprint: 'forest@1', box: [10, 10, 16, 14], level: G, axis: 'z', structure_complete: true, state: 'standing',
  zones: [{ box: [9, 60, 9, 17, 80, 15], why: 'project:forest' }], aisles: [[12, 9, G], [13, 9, G], [12, 15, G], [13, 15, G]], cells: [{ at: [11, G, 11], role: 'floor', seg: 'F' }], ...o })
const pathsRec = (cells = Array.from({ length: 41 }, (_, i) => [i - 20, G, 0])) => ({ plot: 'paths', blueprint: 'paths@1', structure_complete: true, palette: { path: ['dirt_path'] },
  cells: cells.map(a => ({ at: a, role: 'path', seg: 'P' })) })
const recsOf = (...rs) => rs.map(r => ({ plot: r.plot, rec: r }))
const fenceCols = cells => cells.map(c => `${c.at[0]},${c.at[2]}`)

await t('woodBill: 24 fences = 10 logs (Codex design), 4 gates = 4 logs, nothing = 0; sticks come out of planks', () => {
  assert.strictEqual(W.woodBill(24, 0).logs, 10)
  assert.strictEqual(W.woodBill(0, 4).logs, 4)
  assert.deepStrictEqual(W.woodBill(0, 0), { logs: 0, planks: 0, sticks: 0, fenceCrafts: 0 })
  const b = W.woodBill(3, 1)
  assert.strictEqual(b.fenceCrafts, 1); assert.strictEqual(b.sticks, 6); assert.strictEqual(b.planks, 4 + 2 + 4)
})
await t('woodPressure: the town above the owner reserve + 64 (read towns only) plus the bag above 16; the showcase 11-08 reads 101', async () => {
  const sc = W.woodPressure({ town: { spruce_log: 559, oak_log: 76, spruce_planks: 145, oak_planks: 25 }, coverage: 1, bag: {}, reserve: 512 })
  assert.strictEqual(sc.avail, 101); assert.ok(sc.p > 0)
  const low = W.woodPressure({ town: { oak_log: 500 }, coverage: 1, bag: { oak_log: 10 }, reserve: 512 })
  assert.strictEqual(low.avail, 0); assert.ok(!(low.p > 0), 'below the reserve: no wood instance')
  const unread = W.woodPressure({ town: { oak_log: 5000 }, coverage: 0.5, bag: { oak_log: 40 }, reserve: 512 })
  assert.strictEqual(unread.avail, 24, 'an unread town counts nothing: the bag above its keep only')
  await killed(WOOD_PATH, '  const known = !!town && Number(coverage) >= 0.8\n  const t = known ?', '  const known = !!town\n  const t = known ?', async M => {
    assert.strictEqual(M.woodPressure({ town: { oak_log: 5000 }, coverage: 0.5, bag: {}, reserve: 512 }).avail, 0)
  })
})
await t('ringOf: the loop round a box at d -- every column once, each next to the last, four corners, sides as outward normals', () => {
  const r = W.ringOf([0, 0, 4, 2], 1)
  assert.strictEqual(r.length, 2 * (7 + 5) - 4)
  assert.strictEqual(new Set(r.map(q => q.col.join(','))).size, r.length)
  for (let i = 0; i < r.length; i++) { const a = r[i].col, b = r[(i + 1) % r.length].col; assert.strictEqual(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, `loop broken at ${a}`) }
  assert.strictEqual(r.filter(q => q.corner).length, 4)
  assert.ok(r.filter(q => q.side === 'north').every(q => q.col[1] === -1) && r.filter(q => q.side === 'west').every(q => q.col[0] === -1))
})
await t('ringTargets: the forest at its own zone + 1 (d 2), its aisle ends as ways in; a retired or open record is never a target', () => {
  const [f] = W.ringTargets(recsOf(forestRec()))
  assert.strictEqual(f.plot, 'forest'); assert.strictEqual(f.d, 2)
  assert.deepStrictEqual(f.access, [[12, 9], [13, 9], [12, 15], [13, 15]])
  assert.strictEqual(W.ringTargets(recsOf(forestRec({ state: 'retired' }))).length, 0)
  assert.strictEqual(W.ringTargets(recsOf(forestRec({ structure_complete: false, state: 'open' }))).length, 0)
})
await t('fenceAt: never on a path, a record column, a door front, a reservation, a wet column; a fence on open grass stands at G+1', () => {
  const srv = server({ [`3,${G},5`]: 'water' })
  const g0 = { cols: new Set(['1,1']), cells: new Set(), doors: new Set(['2,2']) }
  const o = { pathCols: new Map([['0,0', {}]]), guard: g0, reserved: (x, z) => (x === 4 && z === 4 ? 'well' : null) }
  assert.strictEqual(W.fenceAt(srv.read, [0, 0], G, o).why, 'path')
  assert.strictEqual(W.fenceAt(srv.read, [1, 1], G, o).why, 'record')
  assert.strictEqual(W.fenceAt(srv.read, [2, 2], G, o).why, 'door')
  assert.match(W.fenceAt(srv.read, [4, 4], G, o).why, /^reserved/)
  assert.strictEqual(W.fenceAt(srv.read, [3, 4], G, o).why, 'wet')
  assert.deepStrictEqual(W.fenceAt(srv.read, [8, 8], G, o), { at: [8, G + 1, 8], ground: G })
  const tree = server({ [`9,${G + 2},9`]: 'spruce_leaves', [`9,${G + 1},10`]: 'spruce_log' })
  assert.deepStrictEqual(W.fenceAt(tree.read, [9, 9], G, o).at, [9, G + 1, 9], 'under a low bough (leaves at G+2): a fence still stands')
  assert.strictEqual(W.fenceAt(tree.read, [9, 10], G, o).why, 'no_floor', 'a trunk: none')
})
await t('ringPlan: the ways in are open (2 wide), every opening has a gate beside it in line with its side; two or more openings', () => {
  const srv = server()
  const [tg] = W.ringTargets(recsOf(forestRec()))
  const plan = W.ringPlan(srv.read, tg, HOME, { pathCols: new Map() })
  const open = plan.openings.flatMap(o => o.cols.map(c => c.join(',')))
  for (const a of ['12,8', '13,8', '12,16', '13,16']) assert.ok(open.includes(a), `the aisle end ${a} is open`)
  assert.ok(plan.openings.length >= 2 && new Set(plan.openings.map(o => o.cols[0][1])).size >= 2, 'openings on two sides')
  const gates = W.gatesFor(plan.fences, plan.openings, plan.ring)
  assert.strictEqual(gates.length, plan.openings.length)
  for (const g of gates) { assert.ok(!g.corner); assert.ok((g.side === 'north' && g.at[2] === 8) || (g.side === 'south' && g.at[2] === 16), `gate ${g.at} faces its side`) }
  assert.ok(!plan.fences.some(f => open.includes(`${f.at[0]},${f.at[2]}`)), 'no fence in an opening')
})
await t('ringPlan: a ring with no way in still gets two openings on opposite sides (the column nearest home and one across)', async () => {
  const scenario = M => {
    const srv = server()
    const [tg] = M.ringTargets(recsOf(forestRec({ aisles: [] })))
    const plan = M.ringPlan(srv.read, tg, HOME, { pathCols: new Map() })
    assert.ok(plan.openings.length >= 2, `openings ${plan.openings.length}`)
    assert.ok(new Set(plan.openings.map(o => o.why)).has('home') && new Set(plan.openings.map(o => o.why)).has('far'))
  }
  await killed(WOOD_PATH, "      if (second != null && (runs() < FENCE.openingsMin || sidesOpen().size < 2)) open(second, 'far')", '', scenario)
})
await t('proveFences: NEVER FENCES THE WALK IN -- a closed ring is opened where the walk went; every node the walk held stays', async () => {
  const srv = server()
  // a closed ring of fences round 10..16 x 10..14 (no openings): the inside is reachable before
  const ring = W.ringOf([10, 10, 16, 14], 2).map(q => ({ at: [q.col[0], G + 1, q.col[1]], run: 0 }))
  const before = W.woodNodes(srv.read, HOME, { walkR: 40 })
  assert.ok(W.lostNodes(srv.read, HOME, ring, before, { walkR: 40 }).length > 0, 'POSITIVE CONTROL: the closed ring loses the inside')
  const domain = () => true
  const pr = W.proveFences(srv.read, HOME, [ring], { walkR: 40, base: before, domain })
  assert.ok(pr.ok && pr.dropped > 0 && pr.dropped <= 4 && pr.cells.length === ring.length - pr.dropped, `ok ${pr.ok} dropped ${pr.dropped} kept ${pr.cells.length}/${ring.length}`)
  assert.deepStrictEqual(W.lostNodes(srv.read, HOME, pr.cells, before, { walkR: 40 }), [], 'the kept fences lose nothing')
  await killed(WOOD_PATH, '    if (!lost.length) break\n', '    break\n', M => {
    const p2 = M.proveFences(srv.read, HOME, [ring], { walkR: 40, base: before, domain })
    assert.deepStrictEqual(W.lostNodes(srv.read, HOME, p2.cells, before, { walkR: 40 }), [])
  })
})
await t('proveFences: a ring round ground the walk cannot reach is refused (never seeded to pass)', async () => {
  const srv = server()
  // a stone box walls 30..36 x 30..34 off (walls 3 high): its inside is not a node of the town walk
  for (let x = 29; x <= 37; x++) for (let z = 29; z <= 35; z++) if (x === 29 || x === 37 || z === 29 || z === 35) for (let y = G + 1; y <= G + 3; y++) srv.set([x, y, z], 'stone')
  const scenario = M => {
    const pr = M.proveFences(srv.read, HOME, [[{ at: [31, G + 1, 31], run: 0 }]], { walkR: 50, inside: (x, z) => x > 29 && x < 37 && z > 29 && z < 35 })
    assert.strictEqual(pr.why, 'unreached')
  }
  await killed(WOOD_PATH, "    if (!reached) return { ok: false, cells: [], why: 'unreached', dropped: 0 }", '', scenario)
})
await t('railCandidates: a rail on the shoulder above a drop of 2+ (never over the drop, never on the path); a drop of 1 is not railed', async () => {
  const srv = server()
  // a raised path at G+1 along x 0..6, z = 20; its north shoulder (z 19) at G+1; beyond it (z 18) dug to G-2 (x 0..3; a drop of 3), left at G (x 4..6; a drop of 1)
  const pathCells = []
  for (let x = 0; x <= 6; x++) { srv.set([x, G + 1, 20], 'dirt_path'); srv.set([x, G + 1, 19], 'grass_block'); srv.set([x, G + 1, 21], 'grass_block'); pathCells.push([x, G + 1, 20]) }
  for (let x = 0; x <= 3; x++) for (let y = G - 1; y <= G; y++) srv.set([x, y, 18], 'air')
  const scenario = M => {
    const c = M.railCandidates(srv.read, pathsRec(pathCells), HOME, { guard: { cols: new Set(pathCells.map(a => `${a[0]},${a[2]}`)), cells: new Set(), doors: new Set() } })
    const cols = c.map(q => `${q.at[0]},${q.at[2]}`).sort()
    assert.deepStrictEqual(cols, ['0,19', '1,19', '2,19', '3,19'], `rails ${cols}`)
    assert.ok(c.every(q => q.at[1] === G + 2), 'standing on the shoulder')
  }
  await killed(WOOD_PATH, '    if (top != null && r.ground - top < FENCE.railDrop) continue', '', scenario)
})
await t('siteWood: the REFUSAL CHAIN -- no logs -> unfunded (nothing sited), nothing to fence -> no_site, a fenced record never again', () => {
  const srv = server()
  const base = { id: 'W1', n: 1, home: HOME, records: recsOf(forestRec(), pathsRec()), rec: null, stood: [] }
  const broke = S.siteSink(srv.read, { ...base, kind: 'wood', wood: { avail: 0, species: 'spruce' } })
  assert.strictEqual(broke.ok, false); assert.strictEqual(broke.why, 'unfunded')
  const r = S.siteSink(srv.read, { ...base, kind: 'wood', wood: { avail: 40, species: 'spruce' } })
  assert.ok(r.ok, JSON.stringify(r.tried)); assert.strictEqual(r.meta.type, 'ring'); assert.strictEqual(r.meta.target, 'forest')
  assert.ok(r.meta.logs <= 40 && r.meta.gates >= 2)
  assert.ok(r.inst.cells.every(c => c.at[1] === G + 1))
  assert.ok(r.inst.cells.filter(c => /-g$/.test(c.role)).every(c => ['north', 'south', 'east', 'west'].includes(c.ws?.facing)))
  const rec = S.appendInstance(null, { kind: 'wood', home: HOME, inst: r.inst, meta: r.meta })
  const again = S.siteSink(srv.read, { ...base, kind: 'wood', rec: S.completeInstance(rec), records: recsOf(forestRec()), wood: { avail: 40, species: 'spruce' } })
  assert.strictEqual(again.ok, false, 'the forest is fenced once'); assert.ok(again.tried.includes('forest:done'))
  const none = S.siteSink(srv.read, { ...base, kind: 'wood', records: [], wood: { avail: 40, species: 'spruce' } })
  assert.strictEqual(none.why, 'no_site')
})
await t('woodInstance: fence and gate roles (any species done, the species first), the gate carries its facing, zones on each column and each planned opening', () => {
  const inst = W.woodInstance('W3', { cells: [{ at: [1, G + 1, 1], run: 0 }, { at: [2, G + 1, 1], run: 0, gate: true, facing: 'north' }, { at: [5, G + 1, 1], run: 1 }], species: 'spruce', openings: [{ why: 'access', cols: [[3, 1], [4, 1]] }, { why: 'path', cols: [[9, 9]] }] })
  assert.strictEqual(inst.palette['W3-f'][0], 'spruce_fence'); assert.ok(inst.palette['W3-f'].includes('oak_fence'))
  assert.strictEqual(inst.palette['W3-g'][0], 'spruce_fence_gate')
  assert.deepStrictEqual(inst.cells[1], { at: [2, G + 1, 1], role: 'W3-g', seg: 'W3-R0', ws: { facing: 'north' } })
  assert.strictEqual(inst.segments.length, 2)
  assert.deepStrictEqual(inst.cols.map(c => c.join(',')).sort(), ['1,1', '2,1', '3,1', '4,1', '5,1'], 'an access opening is kept open by a zone; a path is the path\'s')
})
await t('woodKitNeed: the bag\'s fences and gates count first; the logs to draw are the bill less the bag\'s wood above its keep', () => {
  assert.deepStrictEqual(W.woodKitNeed({ fences: 6, gates: 1 }, { spruce_fence: 9, oak_fence_gate: 1 }), { fences: 0, gates: 0, logs: 0 })
  assert.deepStrictEqual(W.woodKitNeed({ fences: 24, gates: 0 }, {}), { fences: 24, gates: 0, logs: 10 })
  assert.deepStrictEqual(W.woodKitNeed({ fences: 24, gates: 0 }, { oak_log: 20 }), { fences: 24, gates: 0, logs: 6 })
})
await t('orientAim: a fence gate takes the yaw of its facing from any face (in line with the fence: Paper places it by the look)', () => {
  assert.deepStrictEqual(TS.orientAim('spruce_fence_gate', { facing: 'north' }, [0, 1, 0]).yaw, TS.YAW_OF.north)
  assert.deepStrictEqual(TS.orientAim('oak_fence_gate', { facing: 'east' }, [1, 0, 0]).yaw, TS.YAW_OF.east)
  assert.strictEqual(TS.orientAim('oak_fence_gate', { facing: 'up' }, [0, 1, 0]), null)
})
await t('sinks: `wood` is a sink kind (plot wood, W), an ORNAMENT kind -- never held by nor counted in SINK.maxOpen; its fence no stand reaches is waived', async () => {
  assert.ok(S.SINK_KINDS.includes('wood') && S.SINK_PLOTS.wood === 'wood' && S.SINK_LETTER.wood === 'W' && S.SINK_ROTATION.includes('wood'))
  const scenario = M => {
    assert.strictEqual(M.sinkNextGate({ kind: 'wood', rec: null, pressure: { p: 1 }, openCount: 9, ready: true }).want, true)
    assert.strictEqual(M.stoneOpenCount({ wood: { instances: [{}], structure_complete: false } }), 0)
  }
  await killed(SINKS_PATH, "export const ORNAMENT_KINDS = Object.freeze(['dress', 'decor', 'wood'])", "export const ORNAMENT_KINDS = Object.freeze(['dress', 'decor'])", scenario)
  assert.ok(S.sinkWaiveKind('wood'))
})
await t('fold (Codex BLOCKER): WOODWORKS=off holds an OPEN structure too -- never offered, never built; a stalled kit waits out its stamp', () => {
  assert.equal(W.woodHold({ on: false, now: 5, stallUntil: 0 }), 'wood_off')
  assert.equal(W.woodHold({ on: false, now: 5, stallUntil: 99 }), 'wood_off', 'off wins over a stall')
  assert.equal(W.woodHold({ on: true, now: 5, stallUntil: 99 }), 'wood_stall')
  assert.equal(W.woodHold({ on: true, now: 100, stallUntil: 99 }), null, 'positive control: on and past the stamp, the open structure is offered')
  assert.equal(W.woodHold({ on: true, now: 100, stallUntil: undefined }), null)
  assert.equal(W.woodHold({ on: W.woodOn({ WOODWORKS: 'off' }) }), 'wood_off')
  assert.equal(W.woodHold({ on: W.woodOn({}) }), null)
  // fold r2: off, a damaged / due standing wood record is no repair or upkeep pick (shop.mjs reads st.damaged / st.due)
  const st = { plot: 'wood', exists: true, complete: true, damaged: true, due: true, sink: true }
  assert.deepEqual(W.woodHeldState(st, 'wood_off'), { ...st, damaged: false, due: false })
  assert.equal(W.woodHeldState(st, 'wood_stall'), st, 'positive control: a stall keeps its repair')
  assert.equal(W.woodHeldState(st, null), st)
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.strictEqual(src.split('return woodHeldState({ ...rest, sinkOpen: open, sinkNext: next, sinkWhy: why }, held)').length, 2, 'the sink states pass through it')
})
await t('skills wiring (structural): the wood kit runs before a slot is taken, an unfunded open structure is not offered under its stamp, fences are never billed to town', () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.strictEqual(src.split('      const kit = await woodKit(ctx, rec, signal)\n').length, 2)
  const bs = src.indexOf('async function buildSink (')
  assert.ok(bs > 0 && src.indexOf('const kit = await woodKit(ctx, rec, signal)', bs) < src.indexOf('const slot = takeSlot(dir, key, me, buildersOf(proj))', bs))
  assert.strictEqual(src.split("const held = kind === WOOD_KIND ? woodHold({ on: WOOD_ON, now, stallUntil: bot ? noSiteUntilOf(bot.sinkNoSite, townNoSiteRead(), WOOD_STALL) : 0 }) : null").length, 2)
  assert.strictEqual(src.split('const open = sinkOpen(rec) && !held\n').length, 2)
  // fold (Codex BLOCKER): WOODWORKS=off -- buildSink refuses a wood visit before any withdraw or kit
  const off = src.indexOf("if (kind === WOOD_KIND && woodHold({ on: WOOD_ON }) === 'wood_off') return out('no_effect', 'off',", bs)
  assert.ok(off > bs && off < src.indexOf('const kit = await woodKit(ctx, rec, signal)', bs), 'the off refusal stands before the kit')
  assert.ok(/dressSignRole\(role\) \|\| decorBagRole\(role\) \|\| woodBagRole\(role\) \|\| buildCellDone/.test(src))
  assert.ok(/if \(kind === WOOD_KIND\) return WOOD_ON && /.test(src), 'sinkReady names the wood')
  // Codex r1 blockers: the kit is whole or the visit does not run; a waived cell is never owed; an empty-handed visit stamps the stall
  assert.strictEqual(src.split('  const any = after.fences === 0 && after.gates === 0\n').length, 2)
  assert.strictEqual(src.split('  const owed = woodOwed(rec, q => sinkWaived(rec, q) || buildCellDone(').length, 2)
  assert.strictEqual(src.split("if (kind === WOOD_KIND && r.stop === 'no_material' && !(r.placed > 0)) { bot.sinkNoSite = ").length, 2)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
