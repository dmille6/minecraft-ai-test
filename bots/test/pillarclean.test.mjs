// PILLARS-01show: bots take down the lone pillars bots left outside the walls (pillarclean.mjs, the lap in skills.mjs on floatclean's
// visit machinery). Behaviour first -- the column scan's rule (the vision render's), the cell's verdict, the sea guard, and the
// COMPOSED chain on the real visit (buildrun.mjs runVisit over the fake server, with the lap's own options): a land pillar taken top
// down to the ground round it, a natural bump never touched, a pillar on the frozen sea never dug from the ice (the shore's pillar
// dug from the shore), the held cells never dug. Then the bundled list and the wiring. Every guard has an anchored mutant (present and
// unique), and each scenario passes on the real module first.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const PC = await import('../src/pillarclean.mjs')
const BF = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, pairs, fn) {
  let src = fs.readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module, and fails with an AssertionError on the mutant. */
const killedBy = async (file, real, pairs, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, pairs, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const PC_PATH = new URL('../src/pillarclean.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const G = BF.G

// a small world for the pure rules: { 'x,y,z': name }, stone at and below 64, air above
const box = n => (/^(air|cave_air|water|lava|torch|wall_torch|ladder|short_grass|snow|oak_sign|oak_wall_sign)$/.test(n) ? 'empty' : 'block')
const W = (set = {}) => (x, y, z) => { if (Math.abs(x) > 200 || Math.abs(z) > 200) return null; const n = set[`${x},${y},${z}`] ?? (y <= 64 ? 'stone' : 'air'); return { name: n, boundingBox: box(n) } }
const tops = (read, x0, x1) => { const m = new Map(); for (let x = x0; x <= x1; x++) for (let z = -4; z <= 4; z++) m.set(`${x},${z}`, PC.standTop(read, x, z, 90)); return m }

console.log('THE COLUMN SCAN (the vision render\'s rule)')
await t('a 4-high dirt pillar on flat ground is a pillar to its neighbourhood\'s median; a 2-high bump is not; a tree is not', () => {
  const set = {}
  for (let y = 65; y <= 68; y++) set[`0,${y},0`] = 'dirt'
  set['5,65,0'] = 'dirt'; set['5,66,0'] = 'dirt'                  // a bump 2 over the ground
  for (let y = 65; y <= 69; y++) set[`-5,${y},0`] = 'spruce_log'   // a tree: its trunk under leaves
  set['-5,70,0'] = 'spruce_leaves'
  const read = W(set), m = tops(read, -8, 8), at = (x, z) => m.get(`${x},${z}`)
  assert.deepStrictEqual(at(0, 0), { y: 68, name: 'dirt', leavesOver: false })
  assert.deepStrictEqual(PC.pillarCandidate(0, 0, at(0, 0), (x, z) => at(x, z)), { med: 64, base: 'stone' })
  assert.strictEqual(PC.pillarCandidate(5, 0, at(5, 0), (x, z) => at(x, z)), null, '2 over: not a pillar')
  assert.strictEqual(PC.pillarCandidate(-5, 0, at(-5, 0), (x, z) => at(x, z)), null, 'a log under leaves: a tree')
  assert.strictEqual(PC.pillarCandidate(0, 0, { y: 68, name: 'oak_leaves' }, (x, z) => at(x, z)), null, 'not a bot\'s material on top')
})
await t('a pillar whose lower blocks were taken back (its top run hangs) counts by default; skipPerched reads past it', () => {
  const read = W({ '0,69,0': 'dirt', '0,70,0': 'dirt' })
  assert.strictEqual(PC.standTop(read, 0, 0, 90).y, 70)
  assert.strictEqual(PC.standTop(read, 0, 0, 90, -64, { skipPerched: true }).y, 64)
})
await t('the base: a pillar on the frozen sea reads `ice` (the sea guard\'s case)', () => {
  const set = {}
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { set[`${x},65,${z}`] = 'ice'; set[`${x},64,${z}`] = 'water' }
  for (let y = 66; y <= 69; y++) set[`0,${y},0`] = 'dirt'
  const read = W(set), m = tops(read, -6, 6)
  assert.deepStrictEqual(PC.pillarCandidate(0, 0, m.get('0,0'), (x, z) => m.get(`${x},${z}`)), { med: 65, base: 'ice' })
})

console.log('THE CELL\'S VERDICT (pillarVerdict)')
const J = (at, name = 'dirt') => ({ at, name })
await t('the top of a pillar: take; the one under it waits (`above`); the controls for every refusal', () => {
  const set = { '0,65,0': 'dirt', '0,66,0': 'dirt' }
  const listed = k => k === '0,65,0' || k === '0,66,0'
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W(set), { listed }), 'take')
  assert.strictEqual(PC.pillarVerdict(J([0, 65, 0]), W(set), { listed }), 'above', 'its top first')
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W({ ...set, '0,66,0': 'grass_block' }), { listed }), 'take', 'greened dirt is the same block')
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W({ '0,65,0': 'dirt' }), { listed }), 'gone')
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W({ ...set, '0,67,0': 'torch' }), { listed }), 'holds', 'a torch on it')
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W({ ...set, '1,66,0': 'wall_torch' }), { listed }), 'holds', 'a torch on its side')
  assert.strictEqual(PC.pillarVerdict(J([0, 65, 0]), W({ ...set, '0,66,0': 'stone' }), { listed: k => k === '0,65,0' }), 'holds', 'an unlisted block over it')
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W({ ...set, '0,66,1': 'water' }), { listed }), 'wet')
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W(set), { listed, cells: k => k === '0,66,0' }), 'record')
  assert.strictEqual(PC.pillarVerdict(J([0, 66, 0]), W(set), { listed, zone: () => true }), 'zoned')
  assert.strictEqual(PC.pillarVerdict(J([300, 66, 0]), W(set), { listed }), 'unread', 'its chunk not loaded: no finding')
})
await t('MUTANTS: each guard of the verdict is load-bearing (anchored, unique)', async () => {
  const set = { '0,65,0': 'dirt', '0,66,0': 'dirt' }
  const listed = k => k === '0,65,0' || k === '0,66,0'
  const cases = [
    ["  if (cells(k3(job.at))) return 'record'\n", M => M.pillarVerdict(J([0, 66, 0]), W(set), { listed, cells: () => true }), 'record'],
    ["  if (zone(x, y, z)) return 'zoned'\n", M => M.pillarVerdict(J([0, 66, 0]), W(set), { listed, zone: () => true }), 'zoned'],
    ["  if (ns.some(isLiquid)) return 'wet'\n", M => M.pillarVerdict(J([0, 66, 0]), W({ ...set, '0,66,1': 'water' }), { listed }), 'wet'],
    ["  for (const [dx, , dz] of N4) { const s = read(x + dx, y, z + dz); if (!isAir(s) && !isSolid(s) && !cover(s) && !isLiquid(s)) return 'holds' }\n", M => M.pillarVerdict(J([0, 66, 0]), W({ ...set, '1,66,0': 'wall_torch' }), { listed }), 'holds'],
  ]
  for (const [anchor, run, want] of cases) {
    assert.strictEqual(run(PC), want)
    await withMutant(PC_PATH, [[anchor, '\n']], async M => assert.notStrictEqual(run(M), want, `the mutant still returns ${want}`))
  }
})

console.log('THE SEA GUARD (seaFloors)')
await t('every floor with a liquid under it round a pillar is never a stand: the frozen sea\'s ice, a block on the water; ground is', () => {
  const set = { '0,65,0': 'ice', '0,64,0': 'water', '1,65,0': 'dirt', '1,64,0': 'water', '2,65,0': 'ice', '2,64,0': 'packed_ice', '3,65,0': 'dirt' }
  const f = PC.seaFloors(W(set), [{ x: 0, z: 0, med: 65, top: 68 }])
  assert.ok(f.has('0,65,0'), 'ice over water'); assert.ok(f.has('1,65,0'), 'dirt laid on the water')
  assert.ok(!f.has('2,65,0'), 'ice over ice'); assert.ok(!f.has('3,65,0'), 'dirt on ground'); assert.ok(!f.has('-2,64,0'), 'the stone floor')
  assert.ok(!PC.seaFloors(W(set), [{ x: 50, z: 0, med: 65, top: 68 }]).has('0,65,0'), 'only round the lap\'s pillars')
})

console.log('THE CHAIN (the real runVisit over the fake server, the lap\'s own options)')
// the ground is grass at G. A land pillar at x 8 (dirt G+1..G+4), a natural stone bump at x 12 (never listed), a pillar with a torch
// on its side at x -8, a gone pillar on the list. The frozen sea: x 20..40, ice at G over water; a pillar on the ice at x 30 (no
// ground in reach) and one at x 21 (the shore at x 19 is in reach).
function world () {
  const srv = BF.server()
  for (let y = G + 1; y <= G + 4; y++) srv.set([8, y, 0], 'dirt')
  srv.set([12, G + 1, 0], 'stone'); srv.set([12, G + 2, 0], 'stone'); srv.set([12, G + 3, 0], 'stone')
  for (let y = G + 1; y <= G + 3; y++) srv.set([-8, y, 0], 'cobblestone')
  srv.set([-8, G + 2, 1], 'wall_torch')
  for (let x = 20; x <= 40; x++) for (let z = -8; z <= 8; z++) { srv.set([x, G, z], 'ice'); srv.set([x, G - 1, z], 'water'); srv.set([x, G - 2, z], 'water') }
  for (let y = G + 1; y <= G + 3; y++) { srv.set([30, y, 0], 'dirt'); srv.set([21, y, 3], 'dirt') }
  const P = (id, x, z, med, ys, name = 'dirt', sea = false) => ({ id, x, z, med, top: Math.max(...ys), sea, take: ys.map(y => [x, y, z, name, 'showcase-Gale']) })
  const pillars = [P(0, 8, 0, G, [G + 1, G + 2, G + 3, G + 4]), P(1, -8, 0, G, [G + 1, G + 2, G + 3], 'cobblestone'), P(2, 30, 0, G, [G + 1, G + 2, G + 3], 'dirt', true),
    P(3, 21, 3, G, [G + 1, G + 2, G + 3], 'dirt', true), P(4, 80, 0, G, [G + 1, G + 2, G + 3])]
  return { srv, list: { v: 1, pool: 'showcase', surveyedAt: 1, pillars } }
}
/** ONE LAP, composed exactly as skills.mjs pillarcleanLap composes it (the options are checked against the source below). */
async function lap (RM, P, srv, list, mem, { walked = [], feet = [0, G + 1, 0], walkFails = false, max = 64, passRead = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'))
  const key = BF.PJ.projKey(BF.HOME, P.PILLARCLEAN_PLOT)
  const slot = BF.PJ.takeSlot(dir, key, 'A', P.PL.builders)
  const pj = P.pillarPassJobs(list, passRead ?? srv.read, { pos: { x: feet[0] + 0.5, y: feet[1], z: feet[2] + 0.5 }, aside: k => (Number(mem.until?.[k]) || 0) > 1000, max })
  const take = new Map(pj.take.map(q => [q.at.join(','), q]))
  const considered = new Set()
  const e = BF.bot(srv, 'A', { feet })
  const walk0 = e.walkTo
  e.walkTo = async s => { walked.push(s.slice()); return walkFails ? false : walk0(s) }
  const under = () => { const f = e.feet(); return [`${f[0]},${f[1] - 1},${f[2]}`] }
  const record = { v: 1, plot: P.PILLARCLEAN_PLOT, home: BF.HOME, cells: [], clear: pj.take, segments: [], zones: [], structure_complete: false }
  const r = await RM.runVisit({ dir, key, me: 'A', home: BF.HOME, stood: [], record, recordGen: 0, palette: {}, res: null, resFailed: false,
    slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 50, blockLayer: false, clearMax: Infinity, stuckStalledOnly: true,
    clearKeepOrder: true, clearNoFloor: pj.floor, clearPart: { lease: 'seg-clear-A', has: () => true },
    clearOk: (q, rd) => { considered.add(q.at.join(',')); return P.pillarClearOk(q, rd ?? srv.read, { listed: k => take.has(k), under: under(), noFloor: k => pj.floor.has(k) }) } }, e, { maxSteps: 400 })
  return { r, pj, logs: e.logs, considered, feetAfter: e.feet() }
}
const col = (srv, x, z, y0, y1) => { const o = []; for (let y = y0; y <= y1; y++) o.push(srv.read(x, y, z)?.name); return o.join(' ') }
await t('a land pillar comes down top first to the ground round it; the bump, the torch\'s pillar and the sea pillar off the shore stay', async () => {
  const { srv, list } = world()
  const walked = []
  const a = await lap(BF.R, PC, srv, list, { until: {} }, { walked })
  assert.strictEqual(a.pj.census.unread, 1, 'the pillar out of the fake\'s world: unread, no finding')
  assert.strictEqual(col(srv, 8, 0, G, G + 4), 'grass_block air air air air', 'level with the ground round it')
  const digs = a.logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'pillar').map(([, d]) => d.cell.join(','))
  assert.deepStrictEqual(digs.filter(k => k.startsWith('8,')), [`8,${G + 4},0`, `8,${G + 3},0`, `8,${G + 2},0`, `8,${G + 1},0`], 'top down')
  assert.strictEqual(col(srv, 12, 0, G + 1, G + 3), 'stone stone stone', 'the natural bump: never listed, never dug')
  assert.strictEqual(col(srv, -8, 0, G + 1, G + 3), 'cobblestone cobblestone air', 'a torch hangs on its middle block: that one and the one under it held, the top over it taken')
  assert.ok(a.considered.has(`-8,${G + 2},0`), 'the held block was asked at the dig (under its top, it read `above` when the lap was drawn)')
  assert.deepStrictEqual(PC.pillarPassJobs(list, srv.read, { pos: { x: -8, y: G + 1, z: 0 } }).census.why, { holds: 1 }, 'the next lap names it held')
  assert.strictEqual(col(srv, 30, 0, G + 1, G + 3), 'dirt dirt dirt', 'the pillar out on the ice: no ground stand reaches it')
  assert.strictEqual(col(srv, 21, 3, G + 1, G + 3), 'air air air', 'the shore\'s pillar: dug from the shore')
  const onIce = walked.filter(s => s[0] >= 20 && s[1] - 1 === G)
  assert.deepStrictEqual(onIce, [], 'no walk to a stand on the ice over water')
  for (const s of walked) assert.ok(!(s[0] >= 20), `a stand at ${s}`)
})
await t('MUTANT (the sea guard cut from the lap\'s floor): the bot walks out on the ice over water to dig (killed)', async () => {
  await killedBy(PC_PATH, PC, [['  const floor = new Set([...standing, ...seaFloors(read, chosen)])\n', '  const floor = new Set([...standing])\n']], async P => {
    const { srv, list } = world()
    const walked = []
    await lap(BF.R, P, srv, list, { until: {} }, { walked, feet: [18, G + 1, 0] })
    assert.deepStrictEqual(walked.filter(s => s[0] >= 20 && s[1] - 1 === G), [], 'no stand on the ice')
  })
})
await t('MUTANT (the check at the dig): without pillarClearOk the torch\'s pillar is dug (killed)', async () => {
  await killedBy(PC_PATH, PC, [["  if (c?.kind !== 'pillar') return true\n", "  if (c?.kind !== 'pillar' || true) return true\n"]], async P => {
    const { srv, list } = world()
    // the torch hung AFTER the lap's list was read: only the check at the dig sees it
    const before = (x, y, z) => (x === -8 && y === G + 2 && z === 1 ? { name: 'air', boundingBox: 'empty' } : srv.read(x, y, z))
    const e0 = srv.read
    await lap(BF.R, P, srv, { ...list, pillars: list.pillars.filter(p => p.id === 1) }, { until: {} }, { feet: [-10, G + 1, 0], passRead: before })
    assert.strictEqual(e0(-8, G + 2, 0)?.name, 'cobblestone', 'a torch hung on it before the dig: not dug')
  })
})
await t('a bot standing on the ice over water digs nothing (never while its floor has water under it); from the shore it does', async () => {
  const scenario = async P => {
    const { srv, list } = world()
    const one = { ...list, pillars: list.pillars.filter(p => p.id === 3) }
    await lap(BF.R, P, srv, one, { until: {} }, { feet: [22, G + 1, 3], walkFails: true })
    assert.strictEqual(col(srv, 21, 3, G + 1, G + 3), 'dirt dirt dirt', 'nothing dug from the ice')
  }
  await killedBy(PC_PATH, PC, [['  if (under.includes(k3(c.at)) || under.some(k => noFloor(k))) return false\n', '  if (under.includes(k3(c.at))) return false\n']], scenario)
})
await t('the lap: nearest pillars first, whole pillars while they fit, the crew split by pillar id, the done count', () => {
  const { srv, list } = world()
  const near8 = PC.pillarPassJobs(list, srv.read, { pos: { x: 8, y: G + 1, z: 0 }, max: 4 })
  assert.deepStrictEqual(near8.pillars.map(p => p.id), [0], 'the nearest pillar, whole (4 cells)')
  const nearShore = PC.pillarPassJobs(list, srv.read, { pos: { x: 25, y: G + 1, z: 3 }, max: 6 })
  assert.deepStrictEqual(nearShore.pillars.map(p => p.id), [3, 2], 'the shore\'s, then the one on the ice')
  const big = PC.pillarPassJobs(list, srv.read, { pos: { x: 8, y: G + 1, z: 0 }, max: 2 })
  assert.deepStrictEqual(big.pillars.map(p => p.id), [0], 'the first pillar is always taken whole')
  const part = PC.pillarPassJobs(list, srv.read, { pos: { x: 8, y: G + 1, z: 0 }, max: 3, part: 2, parts: 3 })
  assert.strictEqual(part.pillars[0].id % 3, 2, 'slot 3 takes its own pillars first')
  for (let y = G + 1; y <= G + 4; y++) srv.set([8, y, 0], 'air')
  assert.strictEqual(PC.pillarPassJobs(list, srv.read, {}).census.done, 1, 'a pillar whose every cell is gone is done')
})
await t('a list for another pool, or malformed, is never read', () => {
  assert.strictEqual(PC.pillarListOk({ v: 1, pool: 'fleet', pillars: [] }, 'showcase'), null)
  assert.strictEqual(PC.pillarListOk({ v: 2, pool: 'showcase', pillars: [] }, 'showcase'), null)
  const l = PC.pillarListOk({ v: 1, pool: 'showcase', pillars: [{ x: 1, z: 1, med: 64, take: [[1, 65, 1, 'dirt']] }, { x: 1, z: 1, med: 64, take: [[1, 65.5, 1, 'dirt']] }, { x: 1, z: 1, take: [] }] }, 'showcase')
  assert.strictEqual(l.pillars.length, 1); assert.strictEqual(l.pillars[0].top, 65)
  assert.strictEqual(PC.pillarListNewer({ surveyedAt: 1 }, { surveyedAt: 2 }).surveyedAt, 2)
  assert.strictEqual(PC.pillarcleanOn({}), true); assert.strictEqual(PC.pillarcleanOn({ PILLARCLEAN: 'off' }), false)
})
await t('THE BUNDLED LIST: the showcase\'s, valid, CoreProtect-controlled, every listed block a bot\'s placement, nothing past the walk radius', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../src/pillarclean/showcase.json', import.meta.url), 'utf8'))
  const l = PC.pillarListOk(doc, 'showcase')
  assert.ok(l && l.pillars.length === doc.pillars.length && l.pillars.length > 1000, `${l?.pillars.length} pillars`)
  assert.ok(doc.source.controls.length && doc.source.controls.every(c => c.found), 'the CoreProtect read\'s positive control found its placement')
  for (const p of l.pillars) {
    assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) <= PC.PL.walkR, `pillar ${p.id} past the walk radius`)
    for (const t of p.take) { assert.ok(/^showcase-[A-Z][a-z]+$/.test(t[4]), `${t} placer`); assert.ok(t[1] > p.med, `${t} at or under the median`) }
  }
  assert.strictEqual(doc.census.list_pillars, l.pillars.length)
})

console.log('THE CARRIED HELPERS (floatclean-01show\'s rules, carried so the piece stands alone)')
await t('pillarGuardOf: every cell or clear a record lists, the bridges, the plan plots\' columns (the plan head\'s shape); never an unguarded cell', () => {
  const g = PC.pillarGuardOf({ records: [{ cells: [{ at: [1, 70, 1] }], clear: [{ at: [2, 70, 2] }], replant: [{ cell: [3, 70, 3] }] }], extra: ['4,70,4'], plan: { plots: [{ box: [10, 10, 12, 12] }] } })
  for (const k of ['1,70,1', '2,70,2', '3,70,3', '4,70,4', '11,90,11']) assert.strictEqual(g(k), true, k)
  assert.strictEqual(g('30,70,30'), false, 'the positive control: an unguarded cell')
})
await t('pillarFloorKeys: every column a body stands over (a player one, a spider\'s middle too); pillarAsideAfter: a try per considered cell, aside at two', () => {
  assert.deepStrictEqual(PC.pillarFloorKeys({ x: 0.5, y: 70, z: 0.5 }), ['0,69,0'])
  const sp = PC.pillarFloorKeys({ x: 1.5, y: 70, z: 0.5 }, 1.4)
  assert.strictEqual(sp.length, 9); assert.ok(sp.includes('1,69,0'), 'the middle column too')
  assert.deepStrictEqual(PC.pillarFloorKeys(null), [])
  let m = { tries: {}, until: {} }
  const a = PC.pillarAsideAfter(m, { offered: ['a', 'b', 'c'], standing: k => k !== 'c', considered: k => k === 'a', now: 1000 })
  assert.deepStrictEqual(a.aside, []); assert.deepStrictEqual(a.mem.tries, { a: 1 })
  const b = PC.pillarAsideAfter(a.mem, { offered: ['a'], standing: () => true, considered: () => true, now: 2000 })
  assert.deepStrictEqual(b.aside.map(q => q.k), ['a']); assert.ok(PC.pillarAsideNow(b.mem, 'a', 3000)); assert.ok(!PC.pillarAsideNow(b.mem, 'a', 2000 + PC.PL.asideMs + 1))
})
await t('the other body\'s block waits (pillarClearOk `others`), and the bot\'s own floor (killed mutants)', async () => {
  const read = W({ '0,65,0': 'dirt' })
  const c = { at: [0, 65, 0], kind: 'pillar', name: 'dirt' }
  const scenario = M => {
    assert.strictEqual(M.pillarClearOk(c, read, {}), true, 'the positive control')
    assert.strictEqual(M.pillarClearOk(c, read, { others: ['0,65,0'] }), false, 'another body stands on it')
  }
  await killedBy(PC_PATH, PC, [["  if (others.includes(k3(c.at))) return false\n", '\n']], scenario)
  await killedBy(PC_PATH, PC, [["  if (under.includes(k3(c.at)) || under.some(k => noFloor(k))) return false\n", "  if (under.some(k => noFloor(k))) return false\n"]], M => assert.strictEqual(M.pillarClearOk(c, read, { under: ['0,65,0'] }), false, 'the block under the bot'))
})

console.log('THE WIDER SET (owner 11-20: natural and unnatural; the control session\'s guards)')
const C = (x, z, med, ys, name = 'stone') => ({ x, z, med, top: Math.max(...ys), body: ys.map(y => [y, name]) })
await t('columnGuard: a lone column of the ground\'s blocks is ok; a slope\'s edge, a tree, a plant, ice, a structure\'s block, something on it are not', () => {
  const col = { '0,65,0': 'stone', '0,66,0': 'stone', '0,67,0': 'stone' }
  const c = C(0, 0, 64, [65, 66, 67])
  assert.strictEqual(PC.columnGuard(W(col), c), 'ok')
  assert.strictEqual(PC.columnGuard(W({ ...col, '1,65,0': 'short_grass', '0,68,0': 'snow' }), c), 'ok', 'a grass tuft beside it, snow on it: still lone')
  assert.strictEqual(PC.columnGuard(W({ ...col, '1,65,0': 'stone', '1,66,0': 'stone' }), c), 'not_lone', 'the edge of a slope: the ground rises beside it')
  assert.strictEqual(PC.columnGuard(W({ ...col, '0,68,0': 'spruce_leaves' }), c), 'tree')
  assert.strictEqual(PC.columnGuard(W({ ...col, '0,66,1': 'sugar_cane' }), c), 'plant')
  assert.strictEqual(PC.columnGuard(W({ '0,65,0': 'packed_ice', '0,66,0': 'packed_ice', '0,67,0': 'packed_ice' }), C(0, 0, 64, [65, 66, 67], 'packed_ice')), 'ice', 'an ice spike')
  assert.strictEqual(PC.columnGuard(W({ '0,65,0': 'spruce_planks', '0,66,0': 'spruce_planks', '0,67,0': 'spruce_planks' }), C(0, 0, 64, [65, 66, 67], 'spruce_planks')), 'material', 'a structure\'s post')
  assert.strictEqual(PC.columnGuard(W({ ...col, '0,68,0': 'torch' }), c), 'holds')
  assert.strictEqual(PC.columnGuard(W(col), C(300, 0, 64, [65])), 'unread')
})
await t('a column of the wider set is dug only while it is still lone and of the ground\'s blocks (the check at the dig; killed mutant)', async () => {
  const scenario = M => {
    const job = { at: [0, 66, 0], name: 'stone', lone: true }
    const set = { '0,65,0': 'stone', '0,66,0': 'stone' }
    assert.strictEqual(M.pillarVerdict(job, W(set)), 'take', 'the positive control')
    assert.strictEqual(M.pillarVerdict(job, W({ ...set, '1,66,0': 'short_grass' })), 'take', 'cover beside it')
    assert.strictEqual(M.pillarVerdict(job, W({ ...set, '1,66,0': 'dirt' })), 'not_lone', 'a block beside it now: a slope, never dug')
    assert.strictEqual(M.pillarVerdict({ ...job, lone: false }, W({ ...set, '1,66,0': 'dirt' })), 'take', 'a proven pillar: CoreProtect says the bot placed it')
  }
  await killedBy(PC_PATH, PC, [["    for (const [dx, , dz] of N4) { const s = read(x + dx, y, z + dz); if (isSolid(s)) return 'not_lone' }\n", '\n']], scenario)
})
await t('the two lists as one, counted apart: proven n/N and other n/N', () => {
  const pv = { v: 1, pool: 'showcase', surveyedAt: 5, pillars: [{ id: 0, x: 0, z: 0, med: 64, top: 65, take: [[0, 65, 0, 'dirt']] }] }
  const ot = { v: 1, pool: 'showcase', surveyedAt: 7, pillars: [{ id: 100000, x: 3, z: 0, med: 64, top: 66, take: [[3, 65, 0, 'stone'], [3, 66, 0, 'stone']] }, { id: 100001, x: 6, z: 0, med: 64, top: 65, take: [[6, 65, 0, 'stone']] }] }
  const m = PC.pillarListsMerged(PC.pillarListOk(pv, 'showcase'), PC.pillarListOk(ot, 'showcase'))
  assert.strictEqual(m.pillars.length, 3); assert.strictEqual(m.surveyedAt, 7)
  const read = W({ '3,65,0': 'stone', '3,66,0': 'stone' })   // the proven one and one other already level
  const j = PC.pillarPassJobs(m, read, { pos: { x: 3, y: 65, z: 0 } })
  assert.deepStrictEqual([j.census.proven_done, j.census.proven, j.census.other_done, j.census.other], [1, 1, 1, 2])
  assert.ok(j.take.every(q => q.lone === true), 'the wider set\'s clears carry lone to the dig')
  assert.deepStrictEqual(j.take.map(q => q.at[1]), [66, 65], 'top down')
  assert.strictEqual(PC.pillarListsMerged(null, null), null)
})
await t('THE BUNDLED WIDER LIST: the showcase\'s, every column lone of the ground\'s blocks in the copy, its census adding up to the 5,331', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../src/pillarclean/showcase-other.json', import.meta.url), 'utf8'))
  const l = PC.pillarListOk(doc, 'showcase')
  assert.ok(l && l.pillars.length === doc.pillars.length && l.pillars.length > 0)
  const c = doc.census
  assert.strictEqual(Object.entries(c).filter(([k]) => /^(drop_|pass)/.test(k)).reduce((a, [, v]) => a + v, 0), c.unproven, 'every unproven column is passed or dropped by a named guard')
  for (const p of l.pillars) { assert.ok(p.id >= 100000); for (const t of p.take) assert.ok(PC.OTHER_BLOCKS.test(t[3]) && t[1] > p.med, String(t)) }
})

await t('RIG 11-20 (6db0cb11): never a dig while the bot is in water -- swimming, or its floor a liquid (killed mutant)', async () => {
  const read = W({ '0,65,0': 'dirt', '5,64,5': 'water' })
  const c = { at: [0, 65, 0], kind: 'pillar', name: 'dirt' }
  await killedBy(PC_PATH, PC, [["  if (inWater || under.some(k => { const b = read(...k.split(',').map(Number)); return !b || isLiquid(b) })) return false\n", '\n']], M => {
    assert.strictEqual(M.pillarClearOk(c, read, { under: ['3,64,3'] }), true, 'the positive control: on stone')
    assert.strictEqual(M.pillarClearOk(c, read, { inWater: true }), false, 'swimming')
    assert.strictEqual(M.pillarClearOk(c, read, { under: ['5,64,5'] }), false, 'its floor is water')
  })
})

console.log('THE WIRING (structural: the lap passes the options the chain above was proved with; comments stripped)')
await t('skills.mjs pillarcleanLap: clearKeepOrder, clearNoFloor of the lap\'s floor (the sea guard in it), pillarClearOk at the dig; the visit head calls it after floatclean', () => {
  const src = fs.readFileSync(SKILLS_PATH, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  const i = src.indexOf('async function pillarcleanLap')
  assert.ok(i > 0)
  const body = src.slice(i, src.indexOf('\n}\n', i))
  assert.ok(body.includes('clearKeepOrder: true, clearNoFloor: pj.floor,'))
  assert.ok(body.includes('clearOk: (q, rd) => { considered.add(q.at.join(\',\')); return pillarClearOk(q, rd ?? rd0, { listed: k => take.has(k), cells: cellsNow, zone, under: plBodyKeys(bot), noFloor: k => pj.floor.has(k), others: plOthersKeys(bot), inWater: !!bot.entity?.isInWater }) } },'))
  assert.ok(body.includes('considered: k => considered.has(k) && !visitGone(bot, signal) })'), 'a try only for a cell the visit got to')
  assert.ok(body.includes('const guard = pillarGuardStrict(bot)') && body.includes("if (!guard) { row('survey', 'no_effect', { why: 'records_unread' }); return no('record_unreadable') }"), 'an unreadable record: no lap')
  assert.strictEqual(body.split('releaseLease(dir, key, `slot${slot.slot}`, me, slotRef.gen)').length, 2, 'the slot released once, in the finally')
  assert.ok(/\} finally \{\n\s+releaseLease\(dir, key, `slot\$\{slot\.slot\}`, me, slotRef\.gen\)/.test(body))
  const ww = src.indexOf('const ww = await waterWalkVisit(ctx, signal'), pl = src.indexOf('const pl = await pillarcleanLap(ctx, signal')
  assert.ok(ww > 0 && pl > ww, 'the tidy visit head, after the water lap')
  assert.ok(src.slice(pl - 120, pl).includes('if (pillarcleanDue(procMem(bot))) {'))
  const g = src.slice(src.indexOf('function pillarGuardStrict'), src.indexOf('const plKeysOf'))
  assert.ok(g.includes('return pillarGuardOf({ records, extra: [...bridgeCellKeys(bs)], plan: ph.head.plan })'), 'the guard over the records, the bridges and the plan head')
  assert.ok(g.includes('if (!hd.ok || (hd.rejected?.length ?? 0) > 0) return null') && g.includes('if (!ph.ok || !ph.head?.plan) return null'), 'one unreadable record or no plan: no lap')
  assert.ok(src.includes('const plKeysOf = e => { try { return pillarFloorKeys(e.position, e.width) } catch { return [] } }'), 'the bodies read through the pure pillarFloorKeys')
  assert.ok(src.includes("const list = pillarListsMerged(pillarListOne(pool, dir, ''), pillarListOne(pool, dir, '-other'))"), 'the lap reads both lists (then the scafleft hand-off on top)')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
