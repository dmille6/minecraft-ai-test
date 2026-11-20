// FLOATCLEAN-01show: bots clean up the floating blocks other bots left behind (floatclean.mjs, the lap in skills.mjs, the two clear
// options in buildrun.mjs). Behaviour first -- the cell's verdict, the host survey over CoreProtect's placements, and the COMPOSED
// chain on the real visit (buildrun.mjs runVisit over the fake server, with the lap's own options): a beam over a pit taken down top
// first from the ground, never from the beam itself, the cells no ground stand reaches set aside with a row after two passes, the
// held cells (a torch on its side, water against it, a record's cell) never dug, a gone cell closed. Then the wiring. Every guard
// has an anchored mutant (present and unique), and each scenario passes on the real module first.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const FC = await import('../src/floatclean.mjs')
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
const FC_PATH = new URL('../src/floatclean.mjs', import.meta.url)
const RUN_PATH = new URL('../src/buildrun.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

// a small world: { 'x,y,z': name }, air elsewhere above y 64, stone at and below 64
const box = n => (/^(air|cave_air|water|lava|torch|wall_torch|ladder|short_grass|snow|oak_sign|oak_wall_sign)$/.test(n) ? 'empty' : 'block')
const W = (set = {}) => (x, y, z) => { if (Math.abs(x) > 200 || Math.abs(z) > 200) return null; const n = set[`${x},${y},${z}`] ?? (y <= 64 ? 'stone' : 'air'); return { name: n, boundingBox: box(n) } }
const J = (at, name = 'dirt') => ({ at, name })

console.log('THE CELL\'S VERDICT (floatVerdict)')
await t('a bot block over air, air over it, nothing on its sides: take; the controls for every refusal', () => {
  const at = [0, 70, 0]
  const base = { '0,70,0': 'dirt' }
  assert.strictEqual(FC.floatVerdict(J(at), W(base)), 'take')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,70,0': 'grass_block' })), 'take', 'greened dirt is the same block')
  assert.strictEqual(FC.floatVerdict(J(at), W({})), 'gone', 'dug: closes')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,69,0': 'cobblestone' })), 'grounded', 'filled under it: closes')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,71,0': 'torch' })), 'holds', 'a torch on it')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '1,70,0': 'wall_torch' })), 'holds', 'a torch on its side')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,69,0': 'ladder' })), 'holds', 'something hung under it')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,70,1': 'water' })), 'wet')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,75,0': 'stone' })), 'covered', 'a roof or a cave over it')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,75,0': 'oak_leaves' })), 'take', 'leaves over it are no roof')
  assert.strictEqual(FC.floatVerdict(J(at), W(base), { cells: k => k === '0,70,0' }), 'record')
  assert.strictEqual(FC.floatVerdict(J(at), W(base), { zone: () => true }), 'zoned')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,71,0': 'cobblestone' }), { listed: k => k === '0,71,0' }), 'above', 'a listed block on it: taken first')
  assert.strictEqual(FC.floatVerdict(J(at), W({ ...base, '0,71,0': 'cobblestone' })), 'holds', 'an unlisted block on it')
  assert.strictEqual(FC.floatVerdict(J(at), () => null), 'unread')
})
await t('MUTANTS: each guard of the verdict is load-bearing (anchored, unique)', async () => {
  const at = [0, 70, 0], base = { '0,70,0': 'dirt' }
  const cases = [
    ["  if (ns.some(isLiquid)) return 'wet'\n", '\n', M => assert.strictEqual(M.floatVerdict(J(at), W({ ...base, '0,70,1': 'water' })), 'wet')],
    ["  if (cells(k3(job.at))) return 'record'\n", '\n', M => assert.strictEqual(M.floatVerdict(J(at), W(base), { cells: () => true }), 'record')],
    ["  if (zone(x, y, z)) return 'zoned'\n", '\n', M => assert.strictEqual(M.floatVerdict(J(at), W(base), { zone: () => true }), 'zoned')],
    ["  for (const [dx, , dz] of N4) { const s = read(x + dx, y, z + dz); if (!isAir(s) && !isSolid(s)) return 'holds' }\n", '\n', M => assert.strictEqual(M.floatVerdict(J(at), W({ ...base, '1,70,0': 'wall_torch' })), 'holds')],
    ["  if (!isAir(over)) return listed(k3([x, y + 1, z])) && isSolid(over) ? 'above' : 'holds'\n", '\n', M => assert.strictEqual(M.floatVerdict(J(at), W({ ...base, '0,71,0': 'torch' })), 'holds')],
    ["  if (isSolid(under) && !listed(k3([x, y - 1, z]))) return 'grounded'\n", '\n', M => assert.strictEqual(M.floatVerdict(J(at), W({ ...base, '0,69,0': 'cobblestone' })), 'grounded')],
    ["    if (isSolid(u) && !LEAVES.test(nm(u)) && !listed(k3([x, y + dy, z]))) return 'covered'\n", '\n', M => assert.strictEqual(M.floatVerdict(J(at), W({ ...base, '0,75,0': 'stone' })), 'covered')],
  ]
  for (const [old, neu, sc] of cases) await killedBy(FC_PATH, FC, [[old, neu]], sc)
})

console.log('THE HOST SURVEY (floatSurvey over CoreProtect\'s bot placements)')
await t('only a bot\'s standing placement, perched, of a bot\'s material is listed; a natural overhang never; areas first, each beam top down', () => {
  const set = {
    // a natural overhang (no CoreProtect row): never listed
    '0,70,0': 'stone',
    // a bot beam in the step well area, two blocks, and a cobble on its west end (a stack: top first)
    '-50,70,-70': 'dirt', '-51,70,-70': 'dirt', '-51,71,-70': 'cobblestone',
    // a bot block in town, nearer home than the step well
    '5,72,5': 'dirt',
    // a bot pillar on the ground (not perched: the tidy's)
    '8,65,8': 'dirt', '8,66,8': 'dirt',
    // a bot chest over air (not a bot's walking material)
    '9,70,9': 'chest',
    // a bot block holding a torch: held, and the bot block under it is held too (it holds a held block)
    '12,71,12': 'dirt', '12,72,12': 'torch', '12,70,12': 'dirt',
    // far outside the reach
    '190,70,0': 'dirt',
  }
  const cp = new Map(Object.entries({
    '-50,70,-70': { user: 'showcase-Maple', t: 1, block: 'dirt' }, '-51,70,-70': { user: 'showcase-Maple', t: 1, block: 'dirt' }, '-51,71,-70': { user: 'showcase-Echo', t: 2, block: 'cobblestone' },
    '5,72,5': { user: 'showcase-Iris', t: 3, block: 'dirt' }, '8,65,8': { user: 'showcase-Iris', t: 3, block: 'dirt' }, '8,66,8': { user: 'showcase-Iris', t: 3, block: 'dirt' },
    '9,70,9': { user: 'showcase-Iris', t: 3, block: 'chest' }, '12,71,12': { user: 'showcase-Iris', t: 3, block: 'dirt' }, '12,70,12': { user: 'showcase-Iris', t: 3, block: 'dirt' },
    '190,70,0': { user: 'showcase-Iris', t: 3, block: 'dirt' }, '40,70,40': { user: 'showcase-Iris', t: 3, block: 'dirt' },   // the last one dug since: gone
  }))
  const sv = FC.floatSurvey(W(set), { cp, home: { x: 0, y: 70, z: 0 }, reach: 128, areas: [{ name: 'stepwell', box: [-60, -80, -40, -60] }] })
  assert.deepStrictEqual(sv.jobs.map(j => j.at.join(',')), ['-51,71,-70', '-51,70,-70', '-50,70,-70', '5,72,5'], 'step well first, top down; then the town')
  assert.deepStrictEqual(sv.jobs.map(j => j.area), ['stepwell', 'stepwell', 'stepwell', 'town'])
  assert.strictEqual(sv.jobs[0].placer, 'showcase-Echo', 'each job names its placer (CoreProtect)')
  assert.strictEqual(sv.verdict.get('0,70,0'), undefined, 'the natural overhang is never even a candidate')
  assert.strictEqual(sv.verdict.get('8,66,8'), 'not_perched')
  assert.strictEqual(sv.verdict.get('9,70,9'), 'not_float_block')
  assert.strictEqual(sv.verdict.get('12,71,12'), 'holds')
  assert.strictEqual(sv.verdict.get('12,70,12'), 'holds', 'under a held bot block: not listed (it holds it up)')
  assert.strictEqual(sv.verdict.get('190,70,0'), 'far')
  assert.strictEqual(sv.verdict.get('40,70,40'), 'gone')
  assert.strictEqual(sv.census.listed, 4)
})
await t('MUTANT: without the CoreProtect rule (every perched block a candidate) the natural overhang is listed', async () => {
  // the mutant reads the world's own blocks over air as candidates (what the tidy's shape rules did): a natural block would be listed
  const set = { '0,70,0': 'stone', '5,72,5': 'dirt' }
  const cp = new Map([['5,72,5', { user: 'showcase-Iris', t: 3, block: 'dirt' }]])
  await killedBy(FC_PATH, FC, [["  for (const [k, e] of cp) {\n", "  for (const [k, e] of [...cp, ['0,70,0', { user: '-', t: 0, block: 'stone' }]]) {\n"]], M => {
    const sv = M.floatSurvey(W(set), { cp, home: { x: 0, y: 70, z: 0 } })
    assert.deepStrictEqual(sv.jobs.map(j => j.at.join(',')), ['5,72,5'])
  })
})

console.log('THE COMPOSED CHAIN: the lap\'s list, the real runVisit with the lap\'s options, the set-aside')
const G = BF.G
// a pit x 10..24, z -6..6, y G-6..G (air), a dirt beam across it at y G on z 0, a cobble on its west end, a torch hung on one beam
// cell's side, water against another, a third a record's cell; a gone cell on the list
function pitWorld () {
  const srv = BF.server()
  for (let x = 10; x <= 24; x++) for (let z = -6; z <= 6; z++) for (let y = G - 6; y <= G; y++) srv.set([x, y, z], 'air')
  for (let x = 10; x <= 24; x++) srv.set([x, G, 0], 'dirt')
  srv.set([11, G + 1, 0], 'cobblestone')
  srv.set([12, G, 1], 'wall_torch')
  srv.set([23, G, 1], 'water')
  const jobs = [[11, G + 1, 0, 'cobblestone'], ...Array.from({ length: 15 }, (_, i) => [10 + i, G, 0, 'dirt']), [30, G + 3, 0, 'dirt']]
    .map(([x, y, z, name], i) => ({ at: [x, y, z], name, placer: 'showcase-Maple', beam: 0, area: 'stepwell', i }))
  return { srv, list: { v: 1, pool: 'showcase', surveyedAt: 1, jobs }, record: k => k === `24,${G},0` }
}
/** ONE LAP, composed exactly as skills.mjs floatcleanLap composes it (the options are checked against the source below). */
async function lap (RM, F, srv, list, mem, { cells = () => false, walked = [], feet = [0, G + 1, 0], walkFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'))
  const key = BF.PJ.projKey(BF.HOME, F.FLOATCLEAN_PLOT)
  const slot = BF.PJ.takeSlot(dir, key, 'A', F.FC.builders)
  const pj = F.floatPassJobs(list, srv.read, { aside: k => F.floatAsideNow(mem, k, 1000), cells, max: F.FC.passMax, part: slot.slot - 1, parts: F.FC.builders })
  const take = new Map(pj.take.map(q => [F.k3(q.at), q]))
  const e = BF.bot(srv, 'A', { feet })
  const walk0 = e.walkTo
  e.walkTo = async s => { walked.push(s.slice()); return walkFails ? false : walk0(s) }
  const under = () => { const f = e.feet(); return [`${f[0]},${f[1] - 1},${f[2]}`] }   // skills.mjs bodyFloorKeys (a centred body)
  const record = { v: 1, plot: F.FLOATCLEAN_PLOT, home: BF.HOME, cells: [], clear: pj.take, segments: [], zones: [], structure_complete: false }
  const r = await RM.runVisit({ dir, key, me: 'A', home: BF.HOME, stood: [], record, recordGen: 0, palette: {}, res: null, resFailed: false,
    slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 50, blockLayer: false, clearMax: Infinity, stuckStalledOnly: true,
    clearKeepOrder: true, clearNoFloor: pj.floor, clearPart: { lease: 'seg-clear-A', has: () => true },
    clearOk: (q, rd) => F.floatClearOk(q, rd ?? srv.read, { listed: k => take.has(k), cells, under: under(), floating: k => pj.floor.has(k) }) }, e, { maxSteps: 200 })
  const after = F.floatAsideAfter(mem, { offered: [...take.keys()], standing: k => F.sameBlock(srv.read(...k.split(',').map(Number))?.name ?? '', take.get(k).name), complete: r.stop === 'complete', now: 1000 })
  return { r, pj, after, logs: e.logs }
}
const standing = (srv, x, y = G) => srv.read(x, y, 0)?.name
await t('a beam over a pit: the reachable cells taken top down from the ground in ONE lap; the held cells never; the middle set aside after two laps', async () => {
  const { srv, list, record } = pitWorld()
  const walked = []
  let mem = { tries: {}, until: {} }
  const a = await lap(BF.R, FC, srv, list, mem, { cells: record, walked })
  assert.strictEqual(a.pj.census.closed, 1, 'the gone cell closes')
  assert.deepStrictEqual(Object.keys(a.pj.census.why).sort(), ['holds', 'record', 'wet'])
  // the stack: the cobble AND the dirt under it in one lap (top first, the list's order kept)
  assert.strictEqual(standing(srv, 11, G + 1), 'air'); assert.strictEqual(standing(srv, 11), 'air')
  for (const x of [10]) assert.strictEqual(standing(srv, x), 'air', `beam cell x=${x} is in reach and sight of the rim: taken`)
  assert.strictEqual(standing(srv, 12), 'dirt', 'a torch hangs on it: held'); assert.strictEqual(standing(srv, 23), 'dirt', 'water against it: held'); assert.strictEqual(standing(srv, 24), 'dirt', 'a record cell: held')
  for (let x = 14; x <= 20; x++) assert.strictEqual(standing(srv, x), 'dirt', `x=${x}: no ground stand reaches it`)
  // never a stand on the beam: every walk ends on real ground (a feet cell over a listed cell is never walked to)
  const onBeam = walked.filter(s => s[1] - 1 === G && s[2] === 0 && s[0] >= 10 && s[0] <= 24)
  assert.deepStrictEqual(onBeam, [], 'no walk to a stand on the beam')
  assert.strictEqual(a.r.stop, 'complete')
  assert.ok(a.logs.some(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'float'), 'each dig is a `_build op=clear kind=float` row')
  assert.deepStrictEqual(a.after.aside, [], 'one lap: a try, not yet aside')
  mem = a.after.mem
  const b = await lap(BF.R, FC, srv, list, mem, { cells: record })
  const left = list.jobs.filter(j => j.at[1] === G && j.at[0] >= 13 && j.at[0] <= 22 && standing(srv, j.at[0]) === 'dirt').map(j => j.at.join(','))
  assert.ok(left.includes(`17,${G},0`), 'the middle of the beam still stands')
  assert.deepStrictEqual(b.after.aside.map(q => q.k).sort(), left.sort(), 'two laps that reached the end of the list: every take-able cell left standing is set aside')
  mem = b.after.mem
  const c = FC.floatPassJobs(list, srv.read, { aside: k => FC.floatAsideNow(mem, k, 1000), cells: record })
  assert.strictEqual(c.take.length, 0, 'a set-aside cell is not offered again')
  assert.strictEqual(c.census.aside, left.length)
  assert.strictEqual(FC.floatPassJobs(list, srv.read, { aside: k => FC.floatAsideNow(mem, k, 1000 + FC.FC.asideMs + 1), cells: record }).take.length, left.length, 'and is offered again once its set-aside runs out')
})
await t('MUTANT (buildrun clearNoFloor): without it the bot walks out onto the beam and digs the middle from it', async () => {
  await killedBy(RUN_PATH, BF.R, [["        nodes ??= nodesFor(new Set(), p.clearNoFloor instanceof Set && p.clearNoFloor.size ? p.clearNoFloor : null)\n", '        nodes ??= nodesFor()\n']], async RM => {
    const { srv, list, record } = pitWorld()
    const walked = []
    await lap(RM, FC, srv, list, { tries: {}, until: {} }, { cells: record, walked })
    assert.deepStrictEqual(walked.filter(s => s[1] - 1 === G && s[2] === 0 && s[0] >= 10 && s[0] <= 24), [], 'no walk to a stand on the beam')
  })
})
await t('MUTANT (buildrun clearKeepOrder): lowest first leaves the stack\'s dirt standing under its cobble for a later lap', async () => {
  await killedBy(RUN_PATH, BF.R, [['.sort((a, b) => (p.clearKeepOrder ? 0 : a.at[1] - b.at[1])),', '.sort((a, b) => a.at[1] - b.at[1]),']], async RM => {
    const { srv, list, record } = pitWorld()
    await lap(RM, FC, srv, list, { tries: {}, until: {} }, { cells: record })
    assert.strictEqual(standing(srv, 11), 'air', 'the stack\'s dirt taken in the same lap')
  })
})
await t('MUTANT (the check at the dig): without floatClearOk the held cells are dug', async () => {
  await killedBy(FC_PATH, FC, [["  if (c?.kind !== 'float') return true\n  // THE BODY", "  if (c?.kind !== 'float' || true) return true\n  // THE BODY"]], async F => {
    const { srv, record } = pitWorld()
    // the dig-time check alone: a listed cell that came to hold a torch AFTER the list was read is still never dug
    const list = { v: 1, pool: 'showcase', surveyedAt: 1, jobs: [{ at: [13, G, 0], name: 'dirt', beam: 0 }] }
    const e0 = srv.read
    let reads = 0
    srv.read = (x, y, z) => { if (x === 13 && y === G && z === 1) { reads++; if (reads > 6) return { name: 'wall_torch', boundingBox: 'empty' } } return e0(x, y, z) }
    await lap(BF.R, F, srv, list, { tries: {}, until: {} }, { cells: record })
    assert.strictEqual(e0(13, G, 0)?.name, 'dirt', 'a torch hung on it before the dig: not dug')
  })
})
await t('CODEX r1 BLOCKER 1: a bot left standing on the beam (its walk failed) digs nothing -- never the block under it', async () => {
  const scenario = async F => {
    const { srv, list, record } = pitWorld()
    await lap(BF.R, F, srv, list, { tries: {}, until: {} }, { cells: record, feet: [10, G + 1, 0], walkFails: true })
    assert.strictEqual(standing(srv, 10), 'dirt', 'the block under the bot stands')
    assert.strictEqual(standing(srv, 11, G + 1), 'cobblestone', 'nothing dug while it stands on the beam')
  }
  await killedBy(FC_PATH, FC, [['  if (under.includes(k3(c.at)) || under.some(k => floating(k))) return false\n', '\n']], scenario)
  // the walk off works: from the rim, the same lap digs
  const { srv, list, record } = pitWorld()
  await lap(BF.R, FC, srv, list, { tries: {}, until: {} }, { cells: record, feet: [9, G + 1, 0] })
  assert.strictEqual(standing(srv, 10), 'air')
})
await t('MUTANT (floatAsideAfter): a lap that ran out of time says nothing about a cell -- no try counted', async () => {
  await killedBy(FC_PATH, FC, [['    if (!complete) continue\n', '\n']], F => {
    const r = F.floatAsideAfter({ tries: { a: 1 } }, { offered: ['a'], standing: () => true, complete: false, now: 1 })
    assert.deepStrictEqual(r.aside, [])
  })
})
await t('the crew splits the list by beam (each slot its beams first, then the rest)', () => {
  const read = W({ '0,70,0': 'dirt', '5,70,5': 'dirt', '9,70,9': 'dirt' })
  const list = { jobs: [{ at: [0, 70, 0], name: 'dirt', beam: 0 }, { at: [5, 70, 5], name: 'dirt', beam: 1 }, { at: [9, 70, 9], name: 'dirt', beam: 2 }] }
  assert.deepStrictEqual(FC.floatPassJobs(list, read, { part: 1, parts: 3 }).take.map(q => q.beam), [1, 0, 2])
  assert.deepStrictEqual(FC.floatPassJobs(list, read, { part: 0, parts: 3, max: 1 }).take.map(q => q.beam), [0])
})
await t('a list for another pool, or malformed, is never read', () => {
  assert.strictEqual(FC.floatListOk({ v: 1, pool: 'board-a', jobs: [] }, 'showcase'), null)
  assert.strictEqual(FC.floatListOk({ v: 2, pool: 'showcase', jobs: [] }, 'showcase'), null)
  assert.strictEqual(FC.floatListOk({ v: 1, pool: 'showcase', jobs: [{ at: [1, 2], name: 'dirt' }, { at: [1, 2, 3], name: 'dirt' }] }, 'showcase').jobs.length, 1)
  assert.strictEqual(FC.floatListNewer({ surveyedAt: 1 }, { surveyedAt: 2 }).surveyedAt, 2)
  assert.strictEqual(FC.floatListNewer({ surveyedAt: 3 }, null).surveyedAt, 3)
})
await t('THE BUNDLED LIST: the showcase\'s, valid, CoreProtect-controlled, the step well\'s pit first, Maple\'s 11-16 bridge leftovers on it', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../src/floatclean/showcase.json', import.meta.url), 'utf8'))
  const l = FC.floatListOk(doc, 'showcase')
  assert.ok(l && l.jobs.length > 100, 'a list')
  assert.ok(doc.source.controls.length && doc.source.controls.every(c => c.found), 'its CoreProtect read carried a passing positive control')
  assert.strictEqual(l.jobs[0].area, 'stepwell')
  const k = new Set(l.jobs.map(j => j.at.join(',')))
  for (const c of ['-59,70,-74', '-59,70,-75']) assert.ok(k.has(c), `Maple's bridge dirt ${c} is listed`)
  assert.ok(!k.has('-58,70,-74'), 'the step well\'s own listed cut is not (a record cell)')
  assert.ok(l.jobs.every(j => /^showcase-[A-Z][a-z]+$/.test(j.placer)), 'every job names a bot as its placer')
})

await t('CODEX r1/r2 BLOCKERS: the guard covers every cell and clear a record lists, the bridges, and the plan plots (the plan head\'s real shape)', async () => {
  const plan = BF.plan()   // the town plan as townPlanHead gives it (head.plan): plots with boxes [x0, z0, x1, z1]
  const rec = { cells: [{ at: [1, 2, 3], role: 'wall' }], clear: [{ at: [4, 5, 6], kind: 'tree' }], replant: [{ cell: [7, 8, 9] }], box: [0, 0, 9, 9] }
  const scenario = M => {
    const g = M.floatGuardOf({ records: [rec], extra: ['20,70,20'], plan })
    assert.strictEqual(g('1,2,3'), true, 'a cell'); assert.strictEqual(g('4,5,6'), true, 'a clear'); assert.strictEqual(g('7,8,9'), true, 'a replant')
    assert.strictEqual(g('20,70,20'), true, 'a bridge cell')
    assert.strictEqual(g('3,90,-4'), true, 'the plaza plot\'s column, any height')
    assert.strictEqual(g('30,70,30'), false, 'the positive control: an unguarded cell')
  }
  await killedBy(FC_PATH, FC, [["  const boxes = (plan?.plots ?? []).map(p => p?.box)", "  const boxes = (plan?.rec?.plots ?? []).map(p => p?.box)"]], scenario)
  await killedBy(FC_PATH, FC, [["const at = q?.at ?? q?.cell; if (tri(at)) out.add(at.join(','))", "const at = q?.at; if (tri(at) && q?.role) out.add(at.join(','))"]], scenario)
})
console.log('THE WIRING (structural: the lap passes the options the chain above was proved with; comments stripped)')
await t('skills.mjs floatcleanLap: the runVisit call carries clearKeepOrder, clearNoFloor of the take list, and floatClearOk at the dig', () => {
  const src = fs.readFileSync(SKILLS_PATH, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  const i = src.indexOf('async function floatcleanLap')
  assert.ok(i > 0)
  const body = src.slice(i, src.indexOf('\n}\n', i))
  assert.ok(body.includes('clearKeepOrder: true, clearNoFloor: pj.floor,'), 'top down, never a stand on a listed cell')
  assert.ok(/clearOk: \(q, rd\) => floatClearOk\(q, rd \?\? rd0, \{ listed: k => take\.has\(k\)/.test(body), 'the dig-time check')
  assert.ok(body.includes("row('aside', 'no_effect', { at: a.k, why: 'unreached'"), 'a set-aside cell gets its row')
  assert.strictEqual(body.split('releaseLease(dir, key, `slot${slot.slot}`, me, slotRef.gen)').length, 2, 'the slot released once, in the finally, at its latest generation')
  assert.ok(/\} finally \{\n\s+releaseLease\(dir, key, `slot\$\{slot\.slot\}`, me, slotRef\.gen\)/.test(body), 'in the finally')
  assert.ok(body.includes('const guard = floatGuardStrict(bot)') && body.includes("if (!guard) { row('survey', 'no_effect', { why: 'records_unread' }); return no('record_unreadable') }"), 'an unreadable record: no lap')
  assert.ok(/clearOk: \(q, rd\) => floatClearOk\(q, rd \?\? rd0, \{ listed: k => take\.has\(k\), cells: cellsNow, zone, under: bodyFloorKeys\(bot\), floating: k => pj\.floor\.has\(k\) \}\)/.test(body), 'the guard read again at the dig, the body')
  const g = src.slice(src.indexOf('function floatGuardStrict'), src.indexOf('function bodyFloorKeys'))
  assert.ok(g.includes('return floatGuardOf({ records, extra: [...bridgeCellKeys(bs)], plan: ph.head.plan })'), 'the guard over the records, the bridges and the plan head (head.plan)')
  assert.ok(g.includes('if (!ph.ok || !ph.head?.plan) return null'), 'no plan: no lap')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
