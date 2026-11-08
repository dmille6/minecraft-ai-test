// BRIDGES-01: DESIGNED BRIDGES (bots/src/bridgedesign.mjs; bridge.mjs buildBridge / sitePlan / bridgeSites; skills.mjs wiring).
// Behaviour: every style solves for every bank and width it is offered (each block clicked on a block already standing, its state made
// by that click, within reach, never into the builder's body, the walkway's headroom never built in); the choice of style by shape and
// by what the town can pay; seeded variety; islets; the build over a simulated world (finished, resumed, a misoriented block dug and
// placed again, natural ground dug out of a cell, a foreign block refused); the index (design lines, nodesign, traffic sightings); the
// reservations; the crossing watch and the traffic sites. Mutants assert their anchors present and unique (CLAUDE.md).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const D = await import('../src/bridgedesign.mjs')
const B = await import('../src/bridge.mjs')
const { YAW_OF } = await import('../src/townstyle.mjs')

const BD_PATH = new URL('../src/bridgedesign.mjs', import.meta.url)
const BR_PATH = new URL('../src/bridge.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// A synthetic span (no world needed for the plan): near stand at x 100, wy 62, along `axis`
function mkSpan (w, nb = 0, fb = 0, axis = [1, 0], isl = []) {
  const wy = 62, [ax, az] = axis
  const near = [100, wy + 1 + nb, 200]
  const rows = []
  for (let i = 0; i < w; i++) rows.push({ i, centre: [near[0] + ax * (i + 1), wy, near[2] + az * (i + 1)], ...(isl.includes(i) ? { isl: wy } : { depth: 3 }) })
  return { ok: true, near, far: [near[0] + ax * (w + 1), wy + 1 + fb, near[2] + az * (w + 1)], axis, wy, w, rows, nb, fb, islets: isl.length }
}
const FACE_OF = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }
/** Every rule a solved plan must keep, checked step by step against the cells placed before it (and the near shore's anchors). */
function checkPlan (span, steps, what) {
  const placed = new Map(D.nearAnchors(span).map(c => [c.join(','), { item: 'anchor' }]))
  for (const r of span.rows) if (r.isl != null) for (const s of [-2, -1, 0, 1, 2]) placed.set(D.frameOf(span).at(r.i, s, r.isl).join(','), { item: 'anchor' })
  const walkHead = new Set()
  for (const s of steps) if (s.role === 'walk') { walkHead.add([s.cell[0], s.cell[1] + 1, s.cell[2]].join(',')); walkHead.add([s.cell[0], s.cell[1] + 2, s.cell[2]].join(',')) }
  for (const s of steps) {
    const k = s.cell.join(',')
    assert.ok(!placed.has(k) || placed.get(k).item === 'anchor', `${what}: one block a cell (${k})`)
    assert.ok(!walkHead.has(k), `${what}: nothing is built in a walkway's headroom (${s.role} ${k})`)
    const rb = placed.get(s.ref.join(','))
    assert.ok(rb, `${what}: ${s.role} ${s.item} ${k} clicks a block already standing (${s.ref})`)
    assert.deepEqual([s.ref[0] + s.face[0], s.ref[1] + s.face[1], s.ref[2] + s.face[2]], s.cell, `${what}: the face leads into the cell`)
    const eye = [s.stand[0] + 0.5, s.stand[1] + 1.62, s.stand[2] + 0.5]
    const p = [s.ref[0] + s.aim.cursor[0], s.ref[1] + s.aim.cursor[1], s.ref[2] + s.aim.cursor[2]]
    assert.ok(Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) <= D.REACH + 1e-9, `${what}: ${s.role} ${k} in reach`)
    assert.ok(k !== s.stand.join(',') && k !== [s.stand[0], s.stand[1] + 1, s.stand[2]].join(','), `${what}: never into the builder's own body`)
    assert.ok(D.refFaceOk(rb.item === 'anchor' ? { item: 'stone' } : rb, s.face, s.aim.cursor[1]), `${what}: the clicked part of ${s.ref} is solid`)
    // THE STATE THE CLICK MAKES (vanilla 1.21, Paper-proven: townstyle-2026-11-04)
    if (s.st?.facing && /_stairs$/.test(s.item)) assert.equal(s.aim.yaw, YAW_OF[s.st.facing], `${what}: a stair's facing is the yaw sent`)
    const half = s.st?.half ?? (/_slab$/.test(s.item) ? s.st?.type : null)
    if (half) {
      const top = s.face[1] < 0 || (s.face[1] === 0 && s.aim.cursor[1] > 0.5)
      assert.equal(top, half === 'top', `${what}: ${s.item} ${half} by the face and the cursor (${s.face} ${s.aim.cursor[1]})`)
    }
    if (s.st?.axis) assert.equal(s.st.axis, s.face[1] !== 0 ? 'y' : s.face[0] !== 0 ? 'x' : 'z', `${what}: a log's axis is the face's`)
    if (s.item === 'lantern') assert.equal(s.st.hanging, s.face[1] < 0, `${what}: a hanging lantern from an underside, a standing one on a top`)
    if (s.item === 'lantern' && s.st.hanging) assert.ok(!/(_stairs|_slab|_wall|_fence)$/.test(rb.item), `${what}: a lantern hangs from a full block`)
    placed.set(k, { item: s.item, st: s.st })
  }
}

await t('EVERY STYLE SOLVES for every bank (0..2 each side), every axis and the widths it is offered; every step keeps the click rules', async () => {
  let n = 0
  for (const style of D.STYLES) for (const axis of [[1, 0], [0, 1], [-1, 0], [0, -1]]) for (const nb of [0, 1, 2]) for (const fb of [0, 1, 2]) {
    for (const w of [1, 2, 3, 5, 8, 9, 12, 16, 21, 24, 33, 40]) for (const isl of style === 'trestle' ? [[], [4, 5], [9]] : [[]]) {
      if (isl.some(i => i >= w - 1)) continue
      const span = mkSpan(w, nb, fb, axis, isl)
      if (!D.stylesFor(span).includes(style)) continue
      for (const id of ['a', 'b']) for (const woodOk of [true, false]) {
        const p = D.designPlan(span, { style, v: D.variantOf(style, id, { species: 'spruce', woodOk }) })
        if (!p.ok && ['short', 'no_layout'].includes(p.why)) continue
        assert.ok(p.ok, `${style} w${w} nb${nb} fb${fb} axis ${axis}: ${p.why} ${p.role} ${p.cell}`)
        checkPlan(span, p.steps, `${style} w${w} nb${nb} fb${fb} ${axis}`)
        n++
      }
    }
  }
  assert.ok(n > 300, `plans checked: ${n}`)
})

await t('THE STYLE BY SHAPE: footbridge to 8, arch 9..21, covered 9..16 on low banks, trestle beyond and over islets; banks over 2 none', async () => {
  assert.deepEqual(D.stylesFor(mkSpan(6)), ['foot'])
  assert.deepEqual(D.stylesFor(mkSpan(12)), ['arch', 'covered', 'trestle'])
  assert.deepEqual(D.stylesFor(mkSpan(12, 2, 0)), ['arch', 'trestle'], 'a 2-high bank: no covered bridge (its deck is at the water)')
  assert.deepEqual(D.stylesFor(mkSpan(18)), ['arch', 'trestle'])
  assert.deepEqual(D.stylesFor(mkSpan(30)), ['trestle'])
  assert.deepEqual(D.stylesFor(mkSpan(12, 0, 0, [1, 0], [5])), ['trestle'], 'islets: a trestle with stone piers on them')
  assert.deepEqual(D.stylesFor({ ...mkSpan(12), nb: 3 }), [])
})

await t('THE STYLE BY WHAT THE TOWN CAN PAY: no logs above the reserve -> stone; a short brick stock -> the next style or unfunded; seeded and stable', async () => {
  const span = mkSpan(12)
  const rich = { stone_bricks: 9999, deepslate_bricks: 9999, cobbled_deepslate: 9999, iron_ingot: 99, torch: 99, glass_pane: 99 }
  const a = D.chooseDesign(span, { id: 'site-1', avail: rich, woodAvail: 0 })
  assert.ok(a.ok); assert.notEqual(a.design.style, 'covered', 'no wood: never the covered bridge')
  const b = D.chooseDesign(span, { id: 'site-1', avail: rich, woodAvail: 0 })
  assert.deepEqual(b.design, a.design, 'the same site gets the same design (the seed is its id)')
  const styles = new Set(), vs = new Set()
  for (let i = 0; i < 24; i++) { const c = D.chooseDesign(span, { id: `site-${i}`, avail: rich, woodAvail: 9999 }); styles.add(c.design.style); vs.add(JSON.stringify(c.design.v)) }
  assert.ok(styles.has('arch') && styles.has('covered'), `both mid-span styles appear with wood: ${[...styles]}`)
  assert.ok(vs.size >= 8, `seeded variety: ${vs.size} distinct designs of 24`)
  const poor = D.chooseDesign(span, { id: 'site-1', avail: { stone_bricks: 10 }, woodAvail: 0 })
  assert.equal(poor.ok, false); assert.equal(poor.why, 'unfunded'); assert.ok(Object.values(poor.tried).every(v => /^unfunded/.test(v)), JSON.stringify(poor.tried))
  // the control: the bill a design names is what its base materials are
  const bb = D.designBase({ stone_brick_stairs: 5, stone_brick_slab: 7, stone_brick_wall: 1, stone_bricks: 2, lantern: 2, oak_fence: 3, oak_planks: 4, cobbled_deepslate_wall: 6, polished_deepslate: 1 })
  assert.deepEqual(bb.base, { stone_bricks: 2 * 6 + 2 * 3 + 6 + 2, iron_ingot: 2, torch: 2, cobbled_deepslate: 6 + 4, oak_log: Math.ceil((4 + 4 + 2) / 4) })
})

// A SIMULATED WORLD for the builder: a lake x 101..112 at wy 62 (4 deep), shores at 62 (stand 63) either side, z any
function world ({ x0 = 101, x1 = 112, isl = [] } = {}) {
  const over = new Map()
  const base = (x, y, z) => {
    if (x >= x0 && x <= x1 && !isl.includes(x)) return y <= 62 && y >= 59 ? { name: 'water', boundingBox: 'empty' } : y < 59 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
    return y <= 62 ? { name: y === 62 ? 'grass_block' : 'dirt', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
  }
  const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
  read.set = (c, b) => over.set(c.join(','), b)
  return read
}
const blockOf = (s, st = s.st) => ({ name: s.item, boundingBox: /lantern|glass_pane/.test(s.item) ? 'block' : 'block', props: st ?? {} })
function sim (r, { clock = { t: 0 }, wrongOnce = null, feet = [100, 63, 200] } = {}) {
  const wrong = new Set(wrongOnce ? [wrongOnce] : [])
  return {
    read: r, feet: () => feet, has: () => 999, now: () => clock.t, sleep: async () => {}, torchOk: () => true, inWater: () => false,
    walkTo: async c => { clock.t += 400; feet.splice(0, 3, ...c) },
    dig: async c => { clock.t += 300; r.set(c, { name: 'air', boundingBox: 'empty' }); return true },
    place: async s => {
      clock.t += 250
      if (!B.blockDone(r(...s.ref)) || !D.designInto(r(...s.cell))) return false
      const k = s.cell.join(',')
      // a click that lands in the wrong state once (a facing the server read another way): the builder must dig and place again
      if (wrong.has(k) && s.st?.facing) { wrong.delete(k); r.set(s.cell, blockOf(s, { ...s.st, facing: s.st.facing === 'east' ? 'west' : 'east' })); return false }
      r.set(s.cell, blockOf(s))
      return true
    },
  }
}
const siteOf = (span, style, id = 'x', woodOk = false) => ({ id, span, design: { style, v: D.variantOf(style, id, { species: 'oak', woodOk }) } })

await t('THE BUILDER finishes a designed bridge in the simulated world; an interrupted build RESUMES from what stands', async () => {
  const r = world()
  const span = D.designSpan(r, [100, 63, 200], [1, 0])
  assert.ok(span.ok, span.why); assert.equal(span.w, 12)
  const site = siteOf(span, 'arch')
  const plan = B.sitePlan(site)
  assert.ok(plan.length > 100 && plan.every(s => s.d === 1), 'a designed plan, every step marked')
  const clock = { t: 0 }
  const a = await B.buildBridge(sim(r, { clock }), plan, { until: 20_000 })
  assert.equal(a.stop, 'time'); assert.equal(B.bridgeIntact(r, plan), false, 'half built: not intact')
  const b = await B.buildBridge(sim(r, { clock, feet: [100, 63, 200] }), plan, { until: Infinity })
  assert.equal(b.stop, 'done', JSON.stringify(b)); assert.equal(B.bridgeIntact(r, plan), true)
  assert.equal(a.placed + b.placed, plan.length, 'every block once')
})

await t('A MISORIENTED block of the bridge is DUG and placed again; natural ground in a cell is dug out first; a foreign block refuses', async () => {
  const r = world()
  const span = D.designSpan(r, [100, 63, 200], [1, 0])
  const site = siteOf(span, 'arch')
  const plan = B.sitePlan(site)
  const stair = plan.find(s => /_stairs$/.test(s.item) && s.st?.facing === 'east')
  const done = await B.buildBridge(sim(r, { wrongOnce: stair.cell.join(',') }), plan)
  assert.equal(done.stop, 'done'); assert.equal(B.bridgeIntact(r, plan), true, 'the wrong stair was replaced')
  // natural dirt in a required cell (a bank where a parapet goes)
  const r2 = world()
  const rail = B.sitePlan(siteOf(D.designSpan(r2, [100, 63, 200], [1, 0]), 'arch')).find(s => s.role === 'rail')
  r2.set(rail.cell, { name: 'dirt', boundingBox: 'block' })
  const plan2 = B.sitePlan(siteOf(D.designSpan(r2, [100, 63, 200], [1, 0]), 'arch'))
  assert.equal(D.designFits(r2, plan2).ok, true); assert.equal(D.designFits(r2, plan2).clear, 1)
  assert.equal((await B.buildBridge(sim(r2), plan2)).stop, 'done'); assert.equal(B.bridgeIntact(r2, plan2), true)
  // a foreign block (a chest) refuses the fit and blocks the build
  const r3 = world()
  const plan3 = B.sitePlan(siteOf(D.designSpan(r3, [100, 63, 200], [1, 0]), 'arch'))
  r3.set(plan3.find(s => s.role === 'rail').cell, { name: 'chest', boundingBox: 'block' })
  assert.match(D.designFits(r3, plan3).why, /^cell_chest/)
  assert.match((await B.buildBridge(sim(r3), plan3)).stop, /^blocked:cell_chest/)
  // the mutant: without the fix the builder is stuck on its own wrong stair
  await withMutant(BR_PATH, "      if (designMisoriented(c, s)) return { fix: s, index: k }\n", '', async M => {
    const r4 = world()
    const p4 = M.sitePlan(siteOf(D.designSpan(r4, [100, 63, 200], [1, 0]), 'arch'))
    const st4 = p4.find(s => /_stairs$/.test(s.item) && s.st?.facing === 'east')
    const res = await M.buildBridge(sim(r4, { wrongOnce: st4.cell.join(',') }), p4)
    assert.notEqual(res.stop, 'done', 'the mutant cannot finish')
  })
})

await t('DESIGN SPAN: islets (narrow, low) are part of one crossing; a far shore is 4+ wide; ice on the line refuses; the controls pass', async () => {
  const r = world({ isl: [106, 107] })
  const s = D.designSpan(r, [100, 63, 200], [1, 0])
  assert.ok(s.ok, s.why); assert.equal(s.w, 12); assert.equal(s.islets, 2)
  assert.deepEqual(s.rows.filter(q => q.isl != null).map(q => q.i), [5, 6])
  const p = D.chooseDesign(s, { id: 'm', avail: { stone_bricks: 999, deepslate_bricks: 999, cobbled_deepslate: 999, iron_ingot: 9, torch: 9 }, woodAvail: 0, read: r })
  assert.ok(p.ok, JSON.stringify(p.tried)); assert.equal(p.design.style, 'trestle')
  assert.ok(p.plan.steps.some(q => q.role === 'pier'), 'stone piers stand on the islets')
  const wide = world({ isl: [104, 105, 106, 107] })
  assert.equal(D.designSpan(wide, [100, 63, 200], [1, 0]).w, 3, 'a 4-wide island is a far shore')
  const ice = world(); ice.set([105, 62, 200], { name: 'ice', boundingBox: 'block' })
  assert.equal(D.designSpan(ice, [100, 63, 200], [1, 0]).why, 'ice')
  assert.equal(D.lightOk(ice, [105, 64, 200]), false, 'no lantern within 3 of ice'); assert.equal(D.lightOk(world(), [105, 64, 200]), true)
})

await t('THE INDEX: a design is named once and excludes a material (and the reverse); nodesign; a traffic sighting counts its bot-days', async () => {
  const span = mkSpan(12)
  const id = '100,63,200:1,0'
  const des = { style: 'arch', v: D.variantOf('arch', id, {}) }
  const sites = B.bridgeSites([{ op: 'sight', id, span, trips: ['traffic:a:1', 'traffic:b:1', 'traffic:a:2'], src: 'traffic', t: 1 },
    { op: 'state', id, design: des, t: 2 }, { op: 'state', id, mat: 'cobble', t: 3 }, { op: 'state', id, design: { style: 'foot', v: {} }, t: 4 }])
  assert.equal(sites[0].seen.size, 3); assert.equal(sites[0].src, 'traffic')
  assert.deepEqual(sites[0].design, des, 'the first design stays'); assert.equal(sites[0].mat, undefined, 'a material after a design is ignored')
  assert.ok(B.bridgeToBuild(sites, 5), 'three bot-days: due')
  const legacy = B.bridgeSites([{ op: 'sight', id, span, trip: 'a' }, { op: 'state', id, mat: 'cobble' }, { op: 'state', id, design: des }])
  assert.equal(legacy[0].mat, 'cobble'); assert.equal(legacy[0].design, undefined, 'a legacy bridge never becomes a design')
  const nod = B.bridgeSites([{ op: 'sight', id, span, trip: 'a' }, { op: 'state', id, nodesign: 'cell_chest' }])
  assert.equal(nod[0].nodesign, 'cell_chest')
  // BRIDGE_DESIGN=off: an unfinished designed site is not built
  assert.equal(B.bridgeBuildable(sites, true, false).length, 0); assert.equal(B.bridgeBuildable(sites, true, true).length, 1)
  await withMutant(BR_PATH, "      if ((l.mat === 'wood' || l.mat === 'cobble') && !s.mat && !s.design) {", "      if ((l.mat === 'wood' || l.mat === 'cobble') && !s.mat) {", async M => {
    const m = M.bridgeSites([{ op: 'sight', id, span, trip: 'a' }, { op: 'state', id, design: des }, { op: 'state', id, mat: 'cobble' }])
    assert.equal(m[0].mat, 'cobble', 'the mutant lets a material ride a design')
  })
})

await t('THE RESERVATIONS: a designed site\'s every cell is the tidy\'s dig guard and its footprint (with the eaves) a zone; an empty plan is never intact', async () => {
  const span = mkSpan(9)
  const site = { id: 's', span, seen: new Set(), design: { style: 'covered', v: D.variantOf('covered', 's', { species: 'oak' }) } }
  const plan = B.sitePlan(site)
  const keys = new Set(B.bridgeCellKeys([site]))
  for (const s of plan) assert.ok(keys.has(s.cell.join(',')), `guarded: ${s.role} ${s.cell}`)
  const z = B.bridgeZones([site])
  for (const s of plan) assert.ok(z.some(q => s.cell[0] >= q.box[0] && s.cell[0] <= q.box[3] && s.cell[2] >= q.box[2] && s.cell[2] <= q.box[5]), `in a zone: ${s.role} ${s.cell}`)
  assert.equal(B.bridgeIntact(() => ({ name: 'air' }), []), false)
})

await t('THE CROSSING WATCH and THE TRAFFIC SITES: a swim from shore to shore is a transit; a busy spot by 3 bot-days is due; wades and old lines are not', async () => {
  let st = {}, tr = []
  const feed = (t, cell, wet) => { const r = D.crossStep(st, { t, cell, wet, ground: !wet }); st = r.state; if (r.transit) tr.push(r.transit) }
  feed(0, [0, 63, 0], false); feed(2000, [1, 62, 0], true); feed(8000, [6, 62, 0], true); feed(10000, [8, 63, 0], false)
  assert.equal(tr.length, 1); assert.deepEqual(tr[0].from, [0, 63, 0]); assert.deepEqual(tr[0].to, [8, 63, 0])
  feed(12000, [9, 62, 0], true); feed(13000, [10, 63, 0], false)
  assert.equal(tr.length, 1, 'a 2-block wade is not a crossing')
  const now = Date.parse('2026-11-08T12:00:00Z')
  const L = (by, day, dx = 0) => ({ op: 'cross', from: [40 + dx, 63, 10], to: [52 + dx, 63, 10], by, t: Date.parse(`2026-11-0${day}T10:00:00Z`) })
  const lines = [L('a', 6), L('a', 6), L('b', 6), L('a', 7), L('c', 7), L('c', 7), L('b', 8), L('a', 8, 2)]
  const due = D.trafficDue(lines, { now, home: { x: 0, z: 0 } })
  assert.equal(due.length, 1); assert.equal(due[0].n, 8); assert.ok(due[0].botDays.length >= 3); assert.ok(Math.abs(due[0].dir[0]) > Math.abs(due[0].dir[1]))
  assert.equal(D.trafficDue(lines.slice(0, 7), { now, home: { x: 0, z: 0 } }).length, 0, 'seven crossings are not enough')
  assert.equal(D.trafficDue(lines, { now: now + 20 * 86_400_000, home: { x: 0, z: 0 } }).length, 0, 'lines older than TRAFFIC_DAYS')
  assert.equal(D.trafficDue(lines, { now, home: { x: 0, z: 0 }, sites: [{ span: { near: [42, 63, 10], far: [52, 63, 10] } }] }).length, 0, 'a site there already')
  await withMutant(BD_PATH, 'export const TRAFFIC_BOTDAYS = 3 ', 'export const TRAFFIC_BOTDAYS = 1 ', async M => {
    const one = [0, 1, 2, 3, 4, 5, 6, 7].map(() => L('a', 6))
    assert.equal(M.trafficDue(one, { now, home: { x: 0, z: 0 } }).length, 1, 'the mutant sites one bot\'s day')
    assert.equal(D.trafficDue(one, { now, home: { x: 0, z: 0 } }).length, 0, 'the real rule does not')
  })
  // the traffic span over the simulated lake: the crossing at z 200 found from its cluster's midpoint
  const r = world()
  const ts = D.trafficSpan(r, { mid: [106, 200], dir: [1, 0] }, { r: 8, yTop: 70, yBot: 55 })
  assert.ok(ts.ok, JSON.stringify(ts)); assert.equal(ts.span.w, 12); assert.equal(D.bearingTo({ x: 0, z: 0 }, [100, 63, 0]), 0); assert.equal(D.bearingTo({ x: 0, z: 0 }, [0, 63, 100]), 2)
})

await t('REF FACES: a top slab\'s side clicked low and a fence\'s side are not references (the mutant that allows them breaks the rule)', async () => {
  assert.equal(D.refFaceOk({ item: 'stone_brick_slab', st: { type: 'top' } }, [1, 0, 0], 0.75), true)
  assert.equal(D.refFaceOk({ item: 'stone_brick_slab', st: { type: 'top' } }, [1, 0, 0], 0.25), false)
  assert.equal(D.refFaceOk({ item: 'oak_fence' }, [1, 0, 0], 0.5), false); assert.equal(D.refFaceOk({ item: 'oak_fence' }, [0, 1, 0], 0.5), true)
  assert.equal(D.refFaceOk({ item: 'oak_stairs', st: { facing: 'east', half: 'bottom' } }, [1, 0, 0], 0.75), true, 'a stair\'s back face is whole')
  await withMutant(BD_PATH, "  if (/(_wall|_fence)$/.test(n)) return face[1] > 0\n", '', async M => {
    assert.equal(M.refFaceOk({ item: 'oak_fence' }, [1, 0, 0], 0.5), false, 'the anchor is the fence rule')
  })
})

await t('WIRING (structural): the design named at the site before the first block with its cells, the switches, the kit before the lease, the traffic siting', async () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (re, what) => assert.equal((src.match(re) ?? []).length, 1, what)
  one(/const BRIDGE_DESIGN_ON = bridgeDesignOn\(process\.env\)/g, 'the design switch')
  one(/const BRIDGE_TRAFFIC_ON = bridgeTrafficOn\(process\.env\)/g, 'the traffic switch')
  one(/exAppend\(exBridgesFile\(\), \{ op: 'state', id: site\.id, design: site\.pendingDesign, dv: DESIGN_V, cells: designCellKeys\(steps\)/g, 'the design named with its cells')
  one(/const fit = steps\.length \? designFits\(read, steps\) : \{ ok: false, why: 'plan_unsolved' \}/g, 'the fit read at the site')
  one(/const kit = await exDesignKit\(ctx, signal, steps\)/g, 'the kit')
  one(/if \(EXPEDITION\.bridge\) exTrafficSite\(bot, exBridgeSites\(\), zones\)/g, 'the traffic siting at the visit')
  one(/torchOk: st => \(site\.design \? lightOk\(read, st\.cell\) : torchSafe\(read, st\.cell\)\)/g, 'no lantern near ice')
  // the naming comes before the build in exBridgeWork
  const work = src.slice(src.indexOf('async function exBridgeWork'))
  assert.ok(work.indexOf('design: site.pendingDesign, dv: DESIGN_V') < work.indexOf('await buildBridge(io, plan'), 'named before the first block')
  assert.equal(D.bridgeDesignOn({ BRIDGE_DESIGN: 'off' }), false); assert.equal(D.bridgeDesignOn({}), true)
  assert.equal(D.bridgeTrafficOn({ BRIDGE_TRAFFIC: '0' }), false); assert.equal(D.bridgeTrafficOn({}), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
