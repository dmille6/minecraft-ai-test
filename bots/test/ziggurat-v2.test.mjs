// ZIGGURAT V2 (OWNER 10-29 "Let's do 1 to 3"; bots/src/zigdesign.mjs + ziggurat.mjs's generalised stair, siting and record): the
// design is chosen once from the town's seed, the palette is one the town can pay for, the details drop when it cannot, every
// design's cells keep the v1 invariants, and ziggurat@1 -- the showcase's sited record -- is byte-for-byte what it was.
import assert from 'node:assert'
import crypto from 'node:crypto'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, G, HOME, k3, server } = await import('./helpers/buildfake.mjs')
const { Z, G12, colOf, zigProject, zbot } = await import('./helpers/zigfake.mjs')
const D = await import('../src/zigdesign.mjs')
const SHOPM = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const DPATH = new URL('../src/zigdesign.mjs', import.meta.url)
/** A mutant of zigdesign.mjs, its anchor present and unique (CLAUDE.md). */
async function withDesignMutant (old, neu, fn) {
  const src = readFileSync(DPATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-zig2-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const RICH = { stone_bricks: 900, cobbled_deepslate: 2500, andesite: 1500, polished_deepslate: 400, mossy_cobblestone: 600, torch: 69, lantern: 40, campfire: 2, sandstone: 3000, granite: 800, tuff: 900 }
const SEEDS = Array.from({ length: 300 }, (_, i) => D.fnv1a(`seed-${i}`))
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
/** The design's palette's first name per record cell -> { name: cells } (what the build will draw first). */
const firstNames = (cells, palette) => { const out = {}; for (const c of cells) { if (c.role === 'core') continue; const n = palette[c.role][0]; out[n] = (out[n] ?? 0) + 1 } return out }
/** A design dressed at the origin (no site): the cells a record of it would hold over flat ground, foundation aside. */
const dressed = d => d.dress({ body: Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0, face: 's' }, d.g), found: [], corner: { x: 0, z: 0 }, baseY: 0, face: 's', g: d.g }).body

console.log('THE DESIGN: ONCE, FROM THE SEED')
await t('SAME SEED, SAME DESIGN; the seed is the pool and the home (the same home in two pools differs)', async () => {
  const a = D.zigDesign(D.zigSeed('hive-a', { x: 0, y: 70, z: 0 }), { stock: RICH })
  const b = D.zigDesign(D.zigSeed('hive-a', { x: 0, y: 70, z: 0 }), { stock: { ...RICH } })
  assert.deepStrictEqual(a.summary, b.summary); assert.deepStrictEqual(a.palette, b.palette)
  assert.strictEqual(sha(dressed(a)), sha(dressed(b)), 'the dressed cells too')
  assert.notStrictEqual(D.zigSeed('hive-a', { x: 0, y: 70, z: 0 }), D.zigSeed('board-b', { x: 0, y: 70, z: 0 }))
  assert.notStrictEqual(D.zigSeed('hive-a', { x: 0, y: 70, z: 0 }), D.zigSeed('hive-a', { x: 1, y: 70, z: 0 }))
})
await t('DIFFERENT SEEDS, DIFFERENT DESIGNS: 300 seeds give 250+ distinct designs and cover every knob\'s range; the shape ignores the stock', async () => {
  const names = new Set(), seen = { B: new Set(), H: new Set(), S: new Set(), W: new Set(), F: new Set(), P: 0, pat: new Set(), trunc: 0 }
  for (const s of SEEDS) {
    const d = D.zigDesign(s, { stock: RICH })
    names.add(D.zigDesignName(d))
    const g = d.g
    assert.strictEqual(D.zigShapeWhy(g), null, `seed ${s}: ${D.zigShapeWhy(g)} ${JSON.stringify(g)}`)
    assert.deepStrictEqual(D.zigDesign(s, {}).g, g, 'the shape is the seed\'s alone')
    seen.B.add(g.B); seen.H.add(g.H); seen.S.add(g.S); seen.W.add(g.STAIR_W); seen.F.add(g.FACES); seen.pat.add(d.summary.pattern)
    if (Number.isInteger(g.PARAPET)) seen.P++
    if (g.TIERS < Z.tierSides({ B: g.B, S: g.S }).length) seen.trunc++
  }
  assert.ok(names.size >= 250, `${names.size} distinct`)
  assert.deepStrictEqual([...seen.B].sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => 24 + 2 * i), 'B: every even 24..48')
  assert.deepStrictEqual([...seen.H].sort(), [2, 3]); assert.deepStrictEqual([...seen.S].sort(), [2, 3, 4])
  assert.deepStrictEqual([...seen.W].sort(), [1, 3, 5]); assert.deepStrictEqual([...seen.F].sort(), [1, 4])
  assert.strictEqual(seen.pat.size, D.ZIG2_PATTERNS.length); assert.ok(seen.P > 20 && seen.trunc > 20, JSON.stringify({ P: seen.P, trunc: seen.trunc }))
})
await t('THE SHAPE\'S CONSTRAINTS: S >= H, at most 24 layers, 2+ tiers, the summit >= 2S, an odd stair <= the summit - 2 (zigShapeWhy names each)', async () => {
  const ok = { B: 30, S: 3, H: 3, STAIR_W: 3, FACES: 1, TIERS: 3, PARAPET: null }
  assert.strictEqual(D.zigShapeWhy(ok), null)
  assert.strictEqual(D.zigShapeWhy({ ...ok, S: 2 }), 'S'); assert.strictEqual(D.zigShapeWhy({ ...ok, B: 31 }), 'B'); assert.strictEqual(D.zigShapeWhy({ ...ok, B: 50 }), 'B')
  assert.strictEqual(D.zigShapeWhy({ ...ok, TIERS: 1 }), 'tiers'); assert.strictEqual(D.zigShapeWhy({ ...ok, STAIR_W: 2 }), 'stair'); assert.strictEqual(D.zigShapeWhy({ B: 24, S: 2, H: 2, STAIR_W: 3, FACES: 1, TIERS: 6 }), 'stair', 'summit 4: a stair of 3 would take a corner')
  assert.strictEqual(D.zigShapeWhy({ ...ok, FACES: 2 }), 'FACES')
  for (const s of SEEDS.slice(0, 50)) for (const pin of D.zigCandidates(s)) assert.strictEqual(D.zigShapeWhy(D.zigShape(s, pin)), null, `fallback ${JSON.stringify(pin)}`)
})
await t('THE SWITCH: MONUMENT_DESIGN=v1 forces ziggurat@1 at a new siting; unset is v2. The fallbacks: the seed\'s own first, then one face, then smaller', async () => {
  assert.strictEqual(D.zigDesignVersion({}), 'v2'); assert.strictEqual(D.zigDesignVersion({ MONUMENT_DESIGN: 'v1' }), 'v1'); assert.strictEqual(D.zigDesignVersion({ MONUMENT_DESIGN: 'V2' }), 'v2')
  const s = SEEDS.find(x => D.zigShape(x).FACES === 4 && D.zigShape(x).B >= 36)
  const c = D.zigCandidates(s)
  assert.deepStrictEqual(c[0], {}); assert.deepStrictEqual(c[1], { FACES: 1 }); assert.deepStrictEqual(c[2], { B: D.zigShape(s).B - 6, FACES: 1 })
  assert.deepStrictEqual(D.zigCandidates(s, { B: 30 }), [{ B: 30 }, { B: 30, FACES: 1 }], 'MONUMENT_B pins the base: no smaller fallback')
  assert.strictEqual(D.zigShape(s, { B: 30 }).B, 30)
})

console.log('THE PALETTE: WHAT THE TOWN CAN PAY FOR')
await t('NOTHING IN STOCK: every shown role is cobblestone, no light, no fire -- and the shape is unchanged', async () => {
  for (const s of SEEDS.slice(0, 40)) {
    const d = D.zigDesign(s, {})
    for (const [role, list] of Object.entries(d.palette)) if (role !== 'core') assert.deepStrictEqual(list, ['cobblestone'], `${role}: ${list}`)
    assert.ok(!d.palette.light && !d.palette.fire && d.summary.lights === null && d.summary.fire === null)
    const cells = dressed(d)
    assert.ok(!cells.some(c => c.role === 'light' || c.role === 'fire'), 'no detail cell the town cannot pay for')
    assert.ok(cells.some(c => c.role === 'shrine'), 'the shrine is solid stone: built of cobblestone')
  }
})
await t('NEVER MORE THAN THE TOWN CAN PAY FOR: for any stock, each material\'s first-choice cells <= its allowance (share of the stock above the project floor)', async () => {
  const stocks = [RICH, { stone_bricks: 215, torch: 69, cobblestone: 994 }, { torch: 32 }, { torch: 40, campfire: 1 }, { mossy_cobblestone: 50, polished_deepslate: 30, lantern: 3 }, { andesite: 64, granite: 64, diorite: 64, tuff: 64 }]
  for (const s of SEEDS.slice(0, 60)) {
    for (const stock of stocks) {
      const d = D.zigDesign(s, { stock })
      const used = firstNames(dressed(d), d.palette)
      const allow = D.zigAllowance(stock)
      for (const [n, k] of Object.entries(used)) assert.ok(k <= allow(n), `seed ${s} ${JSON.stringify(stock)}: ${n} ${k} > ${allow(n)}`)
      for (const [role, list] of Object.entries(d.palette)) if (role !== 'core') assert.strictEqual(list[list.length - 1], 'cobblestone', `${role} ends in cobblestone`)
    }
  }
  // the reserve: 32 torches is the build reserve; a project may spend 80% of it, the design half of that, rounded up -- 13
  assert.strictEqual(D.zigAllowance({ torch: 32 })('torch'), 13); assert.strictEqual(D.zigAllowance({ andesite: 9 })('andesite'), 5)
  assert.strictEqual(D.zigAllowance({})('cobblestone'), Infinity)
  // killed: the allowance check removed, a design takes stone it cannot pay for
  let killed = false
  await withDesignMutant('    if (rest(name) < k) return false\n', '    if (false) return false\n', async M => {
    for (const s of SEEDS.slice(0, 20)) {
      const d = M.zigDesign(s, { stock: { torch: 40, stone_bricks: 30 } })
      const used = firstNames(M.zigDesignFor(d.g, s, { stock: { torch: 40, stone_bricks: 30 } }).dress({ body: Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0, face: 's' }, d.g), found: [], corner: { x: 0, z: 0 }, baseY: 0, face: 's' }).body, d.palette)
      if (Object.entries(used).some(([n, k]) => k > D.zigAllowance({ torch: 40, stone_bricks: 30 })(n))) killed = true
    }
  })
  assert.ok(killed, 'the mutant survived')
})
await t('A SHORT TOWN GETS A CROWN: the stone goes to the highest tiers first; the base stays cobblestone', async () => {
  let crowned = 0
  for (const s of SEEDS.slice(0, 80)) {
    const d = D.zigDesign(s, { stock: { stone_bricks: 400 } })
    const tiers = d.summary.tiers
    const first = tiers.findIndex(m => m !== 'cobblestone')
    if (first < 0) continue
    crowned++
    assert.strictEqual(tiers[0], 'cobblestone', `seed ${s}: ${tiers}`)
  }
  assert.ok(crowned > 10, `${crowned} crowned`)
})
await t('RICH STOCK: varied bands, trim lines, weathering, lanterns and a campfire across seeds; the desert prefers sandstone', async () => {
  const seen = { stones: new Set(), trim: 0, moss: 0, lantern: 0, fire: 0 }
  for (const s of SEEDS.slice(0, 80)) {
    const d = D.zigDesign(s, { stock: RICH })
    for (const m of d.summary.tiers) seen.stones.add(m)
    if (d.summary.trim.some(Boolean)) seen.trim++
    if (d.summary.moss.some(Boolean)) seen.moss++
    if (d.summary.lights?.block === 'lantern') seen.lantern++
    if (d.summary.fire === 'campfire') seen.fire++
  }
  assert.ok(seen.stones.size >= 6 && seen.trim > 20 && seen.moss > 5 && seen.lantern > 5 && seen.fire > 40, JSON.stringify({ ...seen, stones: [...seen.stones] }))
  let sand = 0
  for (const s of SEEDS.slice(0, 40)) if (/sandstone/.test(D.zigDesign(s, { stock: RICH, biome: 'desert' }).summary.tiers.at(-1))) sand++
  assert.ok(sand >= 30, `desert summits in sandstone: ${sand}/40`)
})
await t('LIGHTS: as many torches as the town pays for, the shrine and the highest tiers first; a lit fire only with a campfire in stock', async () => {
  const s = SEEDS.find(x => D.zigShape(x).TIERS >= 4)
  const d = D.zigDesign(s, { stock: { torch: 40 } })                                 // 40 - 7 floor = 33, half: 17
  const cells = dressed(d)
  const lights = cells.filter(c => c.role === 'light')
  assert.strictEqual(lights.length, 17); assert.strictEqual(d.summary.lights.n, 17); assert.ok(d.summary.lights.of > 17)
  assert.ok(!cells.some(c => c.role === 'fire'), 'no campfire in stock: the brazier holds a light instead')
  const lowest = Math.min(...lights.map(c => c.at[1]))
  const all = D.zigLayout(d.g, s, {}).extra.filter(c => c.cat === 'light')
  assert.ok(Math.min(...all.map(c => c.at[1])) < lowest, 'the lowest tier\'s corners are the ones dropped')
  assert.deepStrictEqual(d.palette.light, ['torch', 'cobblestone'])
  const f = D.zigDesign(s, { stock: { torch: 40, campfire: 1 } })
  assert.strictEqual(dressed(f).filter(c => c.role === 'fire').length, 1); assert.deepStrictEqual(f.palette.fire, ['campfire', 'torch', 'cobblestone'])
})

console.log('THE CELLS: EVERY DESIGN KEEPS THE INVARIANTS')
/** Site + record on the flat fake server for a design; the record's checks. */
function checkRecord (d, { box = [-54, -54, d.g.B - 50, d.g.B - 50] } = {}) {
  const srv = server()
  const s = Z.siteZiggurat(colOf(srv.read), () => null, { box, home: HOME, g: d.g })
  assert.ok(s.ok, JSON.stringify(s.rejects))
  const rec = Z.zigRecord(s.site, srv.read, { home: HOME, g: d.g, design: d, now: 1 })
  const at = new Map(rec.cells.map(c => [k3(c.at), c]))
  assert.strictEqual(at.size, rec.cells.length, 'no cell twice')
  assert.strictEqual(rec.blueprint, Z.MONUMENT_BLUEPRINT_V2); assert.strictEqual(Z.zigPaletteOf(rec), rec.palette)
  // every role has a palette; every cell rests on a record cell or the ground (a light on a solid, never on a light)
  for (const c of rec.cells) {
    assert.ok(rec.palette[c.role], `role ${c.role} has no palette`)
    const below = at.get(k3([c.at[0], c.at[1] - 1, c.at[2]]))
    const ground = srv.read(c.at[0], c.at[1] - 1, c.at[2])
    assert.ok(below || (ground && ground.name !== 'air'), `${c.role} ${c.at} floats`)
    if (c.role === 'light' || c.role === 'fire') assert.ok(below && below.role !== 'light' && below.role !== 'fire', `${c.role} ${c.at} on ${below?.role}`)
  }
  // SEGMENTS: every cell's segment listed, every dep a segment, and the cell under each cell in its own segment or an ancestor
  const segs = new Map(rec.segments.map(x => [x.seg, x.deps]))
  const anc = sg => { const out = new Set(), st = [...(segs.get(sg) ?? [])]; while (st.length) { const x = st.pop(); if (!out.has(x)) { out.add(x); st.push(...(segs.get(x) ?? [])) } } return out }
  for (const [sg, deps] of segs) for (const x of deps) assert.ok(segs.has(x), `${sg} waits on a missing ${x}`)
  for (const c of rec.cells) {
    assert.ok(segs.has(c.seg), `${c.seg} unlisted`)
    const below = at.get(k3([c.at[0], c.at[1] - 1, c.at[2]]))
    if (below) assert.ok(below.seg === c.seg || anc(c.seg).has(below.seg), `${c.at} ${c.seg} over ${below.seg}`)
  }
  assert.ok(rec.segments.filter(x => x.seg.startsWith('D-')).every(x => x.deps.length > 0), 'the details come last')
  // THE STAIRS REACH THE SUMMIT: on the finished structure, from the ground, every climb +1 (a light or fire is no floor, no wall)
  const hgt = new Map()
  for (const c of rec.cells) if (c.role !== 'light' && c.role !== 'fire') { const k = `${c.at[0]},${c.at[2]}`; hgt.set(k, Math.max(hgt.get(k) ?? G, c.at[1])) }
  const h = (x, z) => hgt.get(`${x},${z}`) ?? G
  const [x0, z0, x1, z1] = rec.box
  const start = `${x0 - 6},${z0 - 6}`, seen = new Set([start]), q = [start]
  while (q.length) {
    const [x, z] = q.shift().split(',').map(Number)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = `${nx},${nz}`
      if (seen.has(k) || nx < x0 - 8 || nx > x1 + 8 || nz < z0 - 8 || nz > z1 + 8) continue
      if (h(nx, nz) - h(x, z) <= 1) { seen.add(k); q.push(k) }
    }
  }
  const sides = Z.tierSides(d.g), o = (sides.length - 1) * d.g.S, topY = rec.baseY + sides.length * d.g.H - 1
  const summit = rec.cells.filter(c => c.at[1] === topY && /^(tier|trim|moss)/.test(c.role))
  assert.ok(summit.length > 0 && summit.some(c => seen.has(`${c.at[0]},${c.at[2]}`)), 'the summit is reached by +1 climbs')
  for (const f of Z.facesOf(d.g, rec.face)) {
    const st = Z.stairSteps(sides.length - 1, f, d.g)[0]
    assert.ok(seen.has(`${rec.corner[0] + st.i},${rec.corner[1] + st.j}`), `the ${f} stair's top step is reached`)
  }
  // THE FIRE IS NEVER A FLOOR: its top stands 2+ above every feet level beside it (a +1 climb never ends on it)
  for (const c of rec.cells.filter(c => c.role === 'fire')) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(c.at[1] - h(c.at[0] + dx, c.at[2] + dz) >= 2, `the fire at ${c.at} is a step from ${dx},${dz}`)
  }
  // EVERY DETAIL CAN BE PLACED: a light's or the fire's support top face is below the eyes of a builder on a floor beside it
  for (const c of rec.cells.filter(c => c.role === 'light' || c.role === 'fire')) {
    const floors = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([dx, dz]) => h(c.at[0] + dx, c.at[2] + dz))
    assert.ok(floors.some(f => c.at[1] <= f + 2), `${c.role} ${c.at}: no floor within reach of its support's top`)
  }
  return { srv, rec, o }
}
await t('24 SEEDS x 2 STOCKS: sited on flat ground, every cell rests on one below, segments and barriers valid, every stair face reached, the fire out of reach', async () => {
  for (const s of SEEDS.slice(0, 24)) for (const stock of [RICH, {}]) checkRecord(D.zigDesign(s, { stock }))
})
await t('THE RECORD CARRIES THE DESIGN: palette, summary, topY; the bill draws each role\'s first stocked name; a v1 record keeps ZIG_PALETTE', async () => {
  const d = D.zigDesign(SEEDS[3], { stock: RICH })
  const { rec } = checkRecord(d)
  assert.deepStrictEqual(rec.design, JSON.parse(JSON.stringify(d.summary)))
  assert.strictEqual(rec.topY, Math.max(...rec.cells.map(c => c.at[1])))
  const bill = SHOPM.billOf(rec, rec.palette, () => ({ name: 'air', boundingBox: 'empty' }), { done: R.cellDone, inTown: () => true })
  for (const [n, k] of Object.entries(firstNames(rec.cells, rec.palette))) assert.strictEqual(bill[n] ?? 0, k + (n === 'cobblestone' ? rec.cells.filter(c => c.role === 'core').length : 0), n)
  const none = SHOPM.billOf(rec, rec.palette, () => ({ name: 'air', boundingBox: 'empty' }), { done: R.cellDone, inTown: n => n === 'cobblestone' })
  assert.deepStrictEqual(Object.keys(none), ['cobblestone'], 'a town with none of the design\'s stone bills cobblestone: the build is never blocked')
  // the torches AT the reserve floor (what zigBillInTown answers): the lights bill cobblestone, never a torch the draw refuses
  if (rec.palette.light) {
    const atFloor = SHOPM.billOf({ cells: rec.cells.filter(c => c.role === 'light') }, rec.palette, () => ({ name: 'air', boundingBox: 'empty' }), { done: R.cellDone, inTown: n => n !== 'torch' && n !== 'lantern' && n !== 'soul_lantern' })
    assert.deepStrictEqual(Object.keys(atFloor), ['cobblestone'])
  }
  assert.strictEqual(Z.zigPaletteOf({ blueprint: Z.MONUMENT_BLUEPRINT }), Z.ZIG_PALETTE, 'v1: the very object')
  assert.strictEqual(Z.zigPaletteOf({ blueprint: Z.MONUMENT_BLUEPRINT, palette: { skin: ['x'] } }), Z.ZIG_PALETTE, 'v1 never reads a palette field')
  assert.ok(Z.isZigBlueprint('ziggurat@1') && Z.isZigBlueprint('ziggurat@2') && !Z.isZigBlueprint('house@1'))
  assert.deepStrictEqual(Z.zigProgress({ cells: [{ seg: 'D-N', at: [0, 0, 0] }, { seg: 'L03-E', at: [1, 0, 0] }] }, c => c.seg === 'L03-E'), { done: 1, open: 1, layer: 99 })
})
await t('A CELL FALLS BACK, NEVER STALLS: a band cell is done in its stone or in cobblestone; a builder with only cobblestone places it', async () => {
  const d = D.zigDesign(SEEDS.find(x => D.zigDesign(x, { stock: RICH }).summary.tiers.some(m => m !== 'cobblestone')), { stock: RICH })
  const role = Object.keys(d.palette).find(r => /^tier/.test(r) && d.palette[r][0] !== 'cobblestone')
  const b = n => ({ name: n, boundingBox: 'block' })
  assert.ok(R.cellDone(b(d.palette[role][0]), d.palette, role) && R.cellDone(b('cobblestone'), d.palette, role) && !R.cellDone(b('dirt'), d.palette, role))
  assert.strictEqual(R.blockFor(d.palette, role, n => n === 'cobblestone'), 'cobblestone')
  assert.strictEqual(R.blockFor(d.palette, role, () => true), d.palette[role][0], 'the design\'s stone first when held')
  if (d.palette.light) assert.strictEqual(R.blockFor(d.palette, 'light', n => n === 'cobblestone'), 'cobblestone', 'a light the town ran out of: a cap stone')
})

await t('BURIED LEAVES ARE A VOID (offline seed 2716330262: a core cell of leaves under natural dirt, cleared, then unreachable): left out of the record', async () => {
  const scenario = ZM => {
    const s0 = Z.siteZiggurat(colOf(server().read), () => null, { box: [-30, -30, -7, -7], home: HOME, g: G12 }).site
    const x = s0.corner.x + 5, z = s0.corner.z + 5
    const srv = server({ [k3([x, G + 1, z])]: 'spruce_leaves', [k3([x, G + 2, z])]: 'dirt' })
    const r = ZM.siteZiggurat(colOf(srv.read), () => null, { box: [s0.corner.x - 2, s0.corner.z - 2, s0.corner.x + 13, s0.corner.z + 13], home: HOME, g: G12 })
    const rec = ZM.zigRecord(r.site, srv.read, { home: HOME, g: G12 })
    assert.strictEqual(rec.baseY, G + 1)
    assert.ok(!rec.cells.some(c => k3(c.at) === k3([x, G + 1, z])), 'the leaves cell is no record cell')
    assert.ok(rec.cells.some(c => k3(c.at) === k3([x, G + 2, z])), 'the dirt above it is (done as core)')
  }
  scenario(Z)
  const src = readFileSync(new URL('../src/ziggurat.mjs', import.meta.url), 'utf8')
  const old = "const voidAt = b => !full(b) || /_leaves$/.test(nm(b))"
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-zigleaf-${process.pid}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, 'const voidAt = b => !full(b)').replace(/from '\.\//g, "from '../src/"))
  let killed = false
  try { scenario(await import(out.href)) } catch { killed = true } finally { try { unlinkSync(out) } catch {} }
  assert.ok(killed, 'the mutant survived')
})

await t('paths-01 finds a v2 ziggurat\'s front: the stair foot on the face toward home, one row, outside the record (four stairs too)', async () => {
  const P = await import('../src/paths.mjs')
  const s = SEEDS.find(x => D.zigShape(x).FACES === 4)
  const { rec } = checkRecord(D.zigDesign(s, { stock: RICH }))
  const foot = P.stairFoot(rec)
  const cols = new Set(rec.cells.map(c => `${c.at[0]},${c.at[2]}`))
  assert.ok(foot.length >= 1 && foot.every(([x, z]) => !cols.has(`${x},${z}`)))
  const f = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] }[rec.face]
  const [x0, z0, x1, z1] = rec.box
  assert.ok(foot.every(([x, z]) => (f[0] === 1 ? x > x1 : f[0] === -1 ? x < x0 : f[1] === 1 ? z > z1 : z < z0)), `on the ${rec.face} side`)
  const src = readFileSync(new URL('../src/paths.mjs', import.meta.url), 'utf8')
  assert.ok(/if \(\/\^ziggurat@\/\.test\(String\(p\.rec\.blueprint\)\)\) \{ const f = stairFoot\(p\.rec\)/.test(src), 'sitePaths takes both blueprints')
})

console.log('ZIGGURAT@1 UNCHANGED (the showcase\'s sited record keeps building as it was)')
await t('v1 geometry, site and record: byte-identical to the code before v2 (hashes taken from origin/main e6cc6b56\'s ziggurat.mjs)', async () => {
  const out = {}
  for (const f of ['n', 's', 'e', 'w']) out[`cells12${f}`] = sha(Z.zigCells({ corner: { x: -20, z: -20 }, baseY: 70, face: f }, G12))
  out.cells30 = sha(Z.zigCells({ corner: { x: 0, z: 0 }, baseY: 0, face: 'e' }, Z.ZIG_SHOWCASE))
  const cells = {}
  for (let dx = 4; dx < 7; dx++) for (let dz = 4; dz < 7; dz++) { cells[`${-22 + dx},${G},${-22 + dz}`] = 'air'; cells[`${-22 + dx},${G - 1},${-22 + dz}`] = 'air' }
  cells[`${-22},${G + 1},${-22}`] = 'dirt'; cells[`${-12},${G},${-25}`] = 'air'; cells[`${-12},${G - 1},${-25}`] = 'air'
  const srv = server(cells)
  const s = Z.siteZiggurat(colOf(srv.read), () => null, { box: [-40, -40, -7, -7], home: HOME, g: G12 })
  const { base, apron, appr, ...rest } = s.site
  out.site = sha(rest)
  out.record = sha({ ...Z.zigRecord(s.site, srv.read, { home: HOME, g: G12, now: 1 }) })
  assert.deepStrictEqual(out, { cells12n: '0351969ad415033c', cells12s: '4200a689dc410927', cells12e: '1e8a8295429f9139', cells12w: 'cc34e03a47f93396', cells30: '3e0ab01d6906ac3d', site: 'd51ff1f1084c9fa7', record: '0441711e855bad11' })
})
await t('skills.mjs (structural: the visit cannot run here): buildMonument builds and judges with the RECORD\'s palette; the damage check and the footprint know both blueprints', async () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/[^\n'`]*$/gm, '$1')
  const fn = name => { const i = src.indexOf(`function ${name} (`); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n}\n', i)) }
  const bm = fn('buildMonument')
  assert.ok(/const palette = zigPaletteOf\(rec\)/.test(bm), 'the visit\'s palette is the record\'s')
  assert.ok(!/ZIG_PALETTE/.test(bm) && !/ZIG_PALETTE/.test(fn('zigProgressNow')), 'no fixed palette in the visit')
  assert.ok(/zigRecord\(s\.site, read, \{ home, g: gs, design,/.test(bm), 'the design reaches the record')
  assert.ok(/zigDesignVersion\(process\.env\) === 'v2'/.test(bm), 'the switch is read at siting')
  // Codex v2 r1 BLOCK: a v2 bill resolves each role against the stock ABOVE the draw's reserve floor; v1 bills as before
  assert.ok(/const inTownZ = rec\.blueprint === MONUMENT_BLUEPRINT \? billInTown\(town\) : zigBillInTown\(bot, town\)/.test(bm))
  assert.ok(/billOf\(rec, palette, read, \{ done: buildCellDone, inTown: inTownZ \}\)/.test(bm))
  assert.ok(/- \(k \? \(Number\(table\[k\]\) \|\| 0\) : 0\) > 0/.test(fn('zigBillInTown')), 'the floor is subtracted')
  const rd = fn('recordDamaged')
  assert.ok(/isZigBlueprint\(r\.blueprint\)/.test(rd) && /zigPaletteOf\(r\)/.test(rd))
  assert.ok(/isZigBlueprint\(r\.blueprint\)/.test(fn('shopFootprintRefresh')))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
