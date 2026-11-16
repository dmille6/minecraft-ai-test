// STEPCLASS-01 (LIVE showcase 11-15: 2,118 `deferred` rows and 1,234 temporary-stand `no_step` refusals in three days, none saying
// why: buildsite.mjs stepFor answers null for six causes alike). Behaviour: (1) buildsite.mjs stepRefusal -- one scene a class on the
// fake flat world, each with the step it denies as its positive control; (2) over random worlds it is null EXACTLY when stepFor
// finds a step, never `unclassified`, and each class agrees with an oracle written here; (3) the REAL visit (buildrun.mjs runVisit)
// puts the class on its `deferred` row and on a temporary stand's refusal, asked once a cell; STEPCLASS=off: the rows as before;
// (4) the row formatter (shop.mjs buildRowDetail) keeps the key. Anchored mutants (each anchor present and unique) for every rule.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { B, R, PJ, G, HOME, k3, server, bot, project, withMutant: withRunMutant } = await import('./helpers/buildfake.mjs')
const SH = await import('../src/shop.mjs')
const SRC = f => new URL(`../src/${f}`, import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** A mutant of one src file (its anchor present and unique), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(SRC(file), 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-steprefusal-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** BOTH WAYS: the scenario passes on the real buildsite.mjs and fails ITS OWN ASSERTION on the mutant (never a crash). */
const kills = async (old, neu, scenario) => {
  await scenario(B)
  let why = null
  await withMutant('buildsite.mjs', old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const killsRun = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withRunMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const ANY = () => true
const byCol = keys => { const m = new Map(); for (const key of keys) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
const nodesOf = (srv, block = []) => byCol(B.walkFrom(srv.read, HOME, new Set(block.map(k3)), 48))
const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
const sum = n => n.out_of_domain + n.out_of_reach + n.wrong_side + n.no_sight

// ---- the scenes: [cell, the world, the nodes, the domain, the want] -> the class --------------------------------------------------
const GROUND = [30, G + 1, 0]
const scenes = {
  step: () => { const srv = server(); return { srv, cell: GROUND, nodes: nodesOf(srv, [GROUND]), domain: ANY, want: null } },
  no_support: () => { const srv = server(), cell = [30, G + 4, 0]; return { srv, cell, nodes: nodesOf(srv, [cell]), domain: ANY, want: null } },
  over_water: () => { const srv = server({ [k3([31, G, 5])]: 'water' }), cell = [31, G + 1, 5]; return { srv, cell, nodes: nodesOf(srv, [cell]), domain: ANY, want: null } },
  closed_guard: () => ({ ...scenes.step(), want: { supportOk: () => false } }),
  closed_state: () => ({ ...scenes.step(), want: { name: 'oak_slab', ws: { type: 'top' } } }),
  // an island one block wide in a 13 x 13 pond: a block to click, and nothing to stand on within 5 columns
  no_node: () => {
    const srv = server(), cell = [-25, G + 1, -25]
    for (let x = -31; x <= -19; x++) for (let z = -31; z <= -19; z++) srv.set([x, G, z], 'water')
    srv.set([-25, G, -25], 'stone')
    return { srv, cell, nodes: nodesOf(srv, [cell]), domain: ANY, want: null }
  },
  // the only stands are in the cell: its feet cell, and the cell under it (the head would be in the cell)
  own_cell: () => { const srv = server(), cell = [30, G + 2, 0]; srv.set([31, G + 2, 0], 'stone'); return { srv, cell, nodes: new Map([['30,0', [G + 1, G + 2]]]), domain: ANY, want: null } },
  out_of_domain: () => { const srv = server(), cell = [10, G + 1, 5]; return { srv, cell, nodes: nodesOf(srv, [cell]), domain: null, want: null } },
  // on a pillar 7 high: the top face is 5.4 above every eye on the ground
  out_of_reach: () => { const srv = server(), cell = [30, G + 8, 0]; col(srv, 30, 0, G + 1, G + 7, 'stone'); return { srv, cell, nodes: nodesOf(srv, [cell]), domain: ANY, want: null } },
  // on a post 2 high: the top face is in reach and ABOVE the eye (the cell a temporary stand is for)
  wrong_side: () => { const srv = server(), cell = [30, G + 3, 0]; col(srv, 30, 0, G + 1, G + 2, 'stone'); return { srv, cell, nodes: nodesOf(srv, [cell]), domain: ANY, want: null } },
  // a ground cell inside a ring of walls 2 high: in reach, the faces before the eye, every sight line through the ring
  no_sight: () => {
    const srv = server(), cell = GROUND
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) col(srv, 30 + dx, dz, G + 1, G + 2, 'stone')
    return { srv, cell, nodes: nodesOf(srv, [cell]), domain: ANY, want: null }
  },
}
const ask = (M, s, over = {}) => { const q = { ...s, ...over }; return { step: M.stepFor(q.srv.read, HOME, q.cell, q.nodes, q.domain, q.want), why: M.stepRefusal(q.srv.read, HOME, q.cell, q.nodes, q.domain, q.want) } }
const classOf = (M, name, over) => { const a = ask(M, scenes[name](), over); assert.strictEqual(a.step, null, `${name}: stepFor finds no step`); assert.ok(a.why, `${name}: a refusal`); return a.why }

console.log('ONE SCENE A CLASS (buildsite.mjs stepRefusal)')
await t('the fixed set of classes', () => {
  assert.deepStrictEqual([...B.STEP_CLASSES], ['no_support', 'support_closed', 'no_node', 'own_cell', 'out_of_domain', 'out_of_reach', 'wrong_side', 'no_sight', 'unclassified'])
})
const hasStep = M => { const a = ask(M, scenes.step()); assert.ok(a.step, 'POSITIVE CONTROL: a ground cell 30 east has a step'); assert.strictEqual(a.why, null, 'a cell with a step has no refusal') }
await t('a cell stepFor finds a step for: null (nothing to explain)', () => hasStep(B))
await t('MUTANT stepFor not asked first: a cell with a step is "explained" (`unclassified`)', () => kills('  if (stepFor(read, home, cell, nodes, domain, want)) return null\n', '', hasStep))
const noSupport = M => {
  const w = classOf(M, 'no_support'); assert.strictEqual(w.class, 'no_support'); assert.strictEqual(w.n.supports, 0); assert.ok(w.n.stands > 20, `${w.n.stands} stands near, none of use`); assert.strictEqual(sum(w.n), 0, 'no face: no stand is judged')
  assert.strictEqual(classOf(M, 'over_water').class, 'no_support', 'water under the cell is no block to click')
  assert.ok(ask(M, scenes.no_support(), { cell: [30, G + 1, 0] }).step, 'POSITIVE CONTROL: the same column\'s ground cell has a step')
}
await t('no_support: a cell in the air, or over water -- no block to click below or beside', () => noSupport(B))
await t('MUTANT the support count ignored: a floating cell reads as closed', () => kills("  const cls = !n.supports ? 'no_support' : !faces.length ? 'support_closed'", "  const cls = !faces.length ? 'support_closed'", noSupport))
const closed = M => {
  const g = classOf(M, 'closed_guard'); assert.strictEqual(g.class, 'support_closed'); assert.deepStrictEqual([g.n.supports, g.n.closed], [1, 1])
  const s = classOf(M, 'closed_state'); assert.strictEqual(s.class, 'support_closed', 'a top slab is never made by a click on a top face'); assert.deepStrictEqual([s.n.supports, s.n.closed], [1, 1])
  assert.ok(ask(M, scenes.closed_state(), { want: { name: 'oak_slab', ws: { type: 'bottom' } } }).step, 'POSITIVE CONTROL: the bottom slab has its step on the same face')
  assert.ok(ask(M, scenes.closed_guard(), { want: { supportOk: () => true } }).step, 'POSITIVE CONTROL: a guard that allows the support')
}
await t('support_closed: the only block to click is refused by the zone guard (`want.supportOk`), or its face cannot make the cell\'s state', () => closed(B))
await t('MUTANT a refused support counted as open: the class moves on to the stands', () => kills('{ n.closed++; continue }', '{ n.closed++ }', closed))
const noNode = M => {
  const w = classOf(M, 'no_node'); assert.strictEqual(w.class, 'no_node'); assert.deepStrictEqual([w.n.supports, w.n.stands, w.n.own], [1, 0, 0])
  const sc = scenes.no_node(); sc.srv.set([-24, G, -25], 'stone')
  assert.ok(ask(M, sc, { nodes: new Map([['-24,-25', [G + 1]]]) }).step, 'POSITIVE CONTROL: one more island block beside it, stood on: a step')
}
await t('no_node: a block to click, and nothing walkable within 5 columns (an island in a pond)', () => noNode(B))
const ownCell = M => {
  const w = classOf(M, 'own_cell'); assert.strictEqual(w.class, 'own_cell'); assert.deepStrictEqual([w.n.stands, w.n.own], [0, 2], 'the feet in the cell, and the head in the cell')
  const sc = scenes.own_cell()
  assert.ok(ask(M, sc, { nodes: new Map([['30,0', [G + 1, G + 2]], ['29,0', [G + 2]]]) }).step, 'POSITIVE CONTROL: a stand beside the cell: a step')
}
await t('own_cell: the only stands are in the cell itself (never a block placed into the builder\'s body)', () => ownCell(B))
await t('MUTANT the builder\'s own cell counted as a stand: the class is no longer own_cell', () => kills('{ n.own++; continue }', '{ n.stands++ }', ownCell))
const outOfDomain = M => {
  const w = classOf(M, 'out_of_domain'); assert.strictEqual(w.class, 'out_of_domain'); assert.ok(w.n.stands > 50); assert.strictEqual(w.n.out_of_domain, w.n.stands, 'every stand near it is outside the ring')
  assert.ok(ask(M, scenes.out_of_domain(), { domain: ANY }).step, 'POSITIVE CONTROL: the same cell and walk with the domain not asked for: a step')
  // a named domain is asked as stepFor asks it
  assert.strictEqual(classOf(M, 'step', { domain: (x, z) => x < 20 }).class, 'out_of_domain')
}
await t('out_of_domain: stands all round the cell, none in the build domain (the two landmarks\' 47 cells)', () => outOfDomain(B))
await t('MUTANT the domain test dropped: the stands outside it are judged on reach and sight (`unclassified`)', () => kills('      if (!inDom) { n.out_of_domain++; continue }\n', '', outOfDomain))
const outOfReach = M => {
  const w = classOf(M, 'out_of_reach'); assert.strictEqual(w.class, 'out_of_reach'); assert.strictEqual(w.n.out_of_reach, w.n.stands); assert.ok(w.n.stands > 50)
  assert.strictEqual(classOf(M, 'out_of_reach', { want: { blind: true } }).class, 'out_of_reach', 'a reach-only cell is still out of reach')
  const sc = scenes.out_of_reach()
  assert.ok(ask(M, sc, { nodes: new Map([['31,0', [G + 8]]]) }).step, 'POSITIVE CONTROL: a stand at the pillar\'s height beside it: a step')
}
await t('out_of_reach: stands in the domain, every one farther than REACH from every face (a cell on a pillar 7 high)', () => outOfReach(B))
const wrongSide = M => {
  const w = classOf(M, 'wrong_side'); assert.strictEqual(w.class, 'wrong_side'); assert.ok(w.n.wrong_side > 0 && w.n.out_of_reach > 0 && w.n.no_sight === 0, JSON.stringify(w.n))
  assert.strictEqual(sum(w.n), w.n.stands, 'each stand counted once, under the last test it failed')
  assert.ok(ask(M, scenes.wrong_side(), { want: { blind: true } }).step, 'POSITIVE CONTROL: placed by reach alone (blind), the same cell has a step')
}
await t('wrong_side: in reach, the face above every eye (a cell on a post 2 high); the farther stands are counted out_of_reach, the LAST test wins', () => wrongSide(B))
await t('MUTANT the first failed test wins: a cell some stand is behind the face of reads as out_of_reach', () => kills(
  "n.no_sight ? 'no_sight' : n.wrong_side ? 'wrong_side' : n.out_of_reach ? 'out_of_reach' : 'out_of_domain'", "n.out_of_reach ? 'out_of_reach' : n.wrong_side ? 'wrong_side' : n.no_sight ? 'no_sight' : 'out_of_domain'", wrongSide))
await t('MUTANT the side test dropped: the stands behind the face go on to the sight test', () => kills('        if (!blind && v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2] <= 0) { far = Math.max(far, 1); continue }\n', '', wrongSide))
const noSight = M => {
  const w = classOf(M, 'no_sight'); assert.strictEqual(w.class, 'no_sight'); assert.ok(w.n.no_sight > 0, JSON.stringify(w.n)); assert.strictEqual(sum(w.n), w.n.stands)
  assert.strictEqual(w.n.supports, 5, 'the ground under it and the four walls beside it')
  assert.ok(ask(M, scenes.no_sight(), { want: { blind: true } }).step, 'POSITIVE CONTROL: placed by reach alone (blind), the same cell has a step')
}
await t('no_sight: in reach and before a face, every sight line through a wall (a ground cell inside a ring 2 high)', () => noSight(B))
await t('MUTANT the sight test dropped: the walled-in cell has a stand that "passes" (`unclassified`)', () => kills('        if (!blind && !sightClear(read, eye, fc, through)) { far = Math.max(far, 2); continue }\n', '', noSight))
await t('unclassified is a NAMED bug, never silence: with stepFor broken (always null) a cell that has a step reads `unclassified`', async () => {
  await withMutant('buildsite.mjs', '  return best\n}\n/**\n * STEPCLASS-01', '  return null\n}\n/**\n * STEPCLASS-01', async M => {
    const a = ask(M, scenes.step())
    assert.strictEqual(a.step, null, 'the mutant: stepFor finds nothing'); assert.strictEqual(a.why?.class, 'unclassified')
    assert.strictEqual(ask(M, scenes.no_support()).why.class, 'no_support', 'POSITIVE CONTROL: a real refusal keeps its class there')
  })
})

console.log('RANDOM WORLDS: null exactly when stepFor finds a step; never unclassified; each class against an oracle written here')
const property = (M, worlds = 60, per = 60) => {
  let seed = 20261115
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const BOX = { stone: 'block', air: 'empty', water: 'empty', oak_slab: 'block', oak_fence: 'block', short_grass: 'empty', oak_leaves: 'block', chest: 'block' }
  const stat = { cases: 0, step: 0, classes: {} }
  for (let w = 0; w < worlds; w++) {
    const Rr = 26, home = { x: 0, y: G + 1, z: 0 }
    const cells = new Map(), h = new Map()
    for (let x = -Rr - 6; x <= Rr + 6; x++) for (let z = -Rr - 6; z <= Rr + 6; z++) h.set(`${x},${z}`, Math.max(Math.abs(x), Math.abs(z)) <= 3 ? G : G + Math.round(1.5 * Math.sin(x / (3 + w % 5)) + 1.5 * Math.cos(z / (4 + w % 3))) + (rnd() < 0.06 ? ri(-2, 3) : 0))
    const extras = []
    for (let i = 0; i < Rr * Rr; i++) { const x = ri(-Rr, Rr), z = ri(-Rr, Rr), u = rnd(); extras.push([x, h.get(`${x},${z}`) + 1 + (u < 0.3 ? ri(0, 2) : 0), z]); cells.set(extras[i].join(','), u < 0.12 ? 'oak_fence' : u < 0.24 ? 'oak_slab' : u < 0.4 ? 'water' : u < 0.5 ? 'short_grass' : u < 0.8 ? 'stone' : u < 0.9 ? 'chest' : 'oak_leaves') }
    const read = (x, y, z) => {
      if (Math.abs(x) > Rr + 6 || Math.abs(z) > Rr + 6 || y < G - 12 || y > G + 24) return null
      const n = cells.get(`${x},${y},${z}`) ?? (y <= h.get(`${x},${z}`) ? 'stone' : 'air')
      return { name: n, boundingBox: BOX[n] }
    }
    const nodes = byCol(M.walkFrom(read, home, new Set(), Rr + 4))
    for (let i = 0; i < per; i++) {
      // a cell on the ground, in the air over it, or on top of / beside one of the world's loose blocks
      const on = rnd() < 0.3 ? extras[ri(0, extras.length - 1)] : null, side = on && rnd() < 0.4 ? ri(0, 3) : -1
      const [cx, cz] = on ? [on[0] + (side === 0 ? 1 : side === 1 ? -1 : 0), on[2] + (side === 2 ? 1 : side === 3 ? -1 : 0)] : [ri(-Rr, Rr), ri(-Rr, Rr)]
      const cell = [cx, on ? on[1] + (side < 0 ? 1 : 0) : h.get(`${cx},${cz}`) + 1 + (rnd() < 0.6 ? 0 : ri(1, 6)), cz]
      const u = rnd(), v = rnd()
      const domain = u < 0.4 ? null : u < 0.7 ? ANY : ((bx, bz) => (x, z) => Math.abs(x - bx) <= 3 && Math.abs(z - bz) <= 3)(cx + ri(-4, 4), cz + ri(-4, 4))
      const want = v < 0.4 ? null : v < 0.55 ? { blind: true } : v < 0.7 ? { supportOk: sup => (sup[0] + sup[1] + sup[2]) % 2 === 0 } : v < 0.8 ? { name: 'oak_slab', ws: { type: rnd() < 0.5 ? 'top' : 'bottom' } }
        : v < 0.9 ? { name: 'oak_stairs', ws: { facing: 'north', half: rnd() < 0.5 ? 'top' : 'bottom' } } : { also: [[cx + 1, cell[1], cz]] }
      const step = M.stepFor(read, home, cell, nodes, domain, want), why = M.stepRefusal(read, home, cell, nodes, domain, want)
      stat.cases++
      assert.strictEqual(why === null, step !== null, `world ${w} cell ${cell}: stepFor ${step ? 'has a step' : 'null'}, the refusal ${JSON.stringify(why)}`)
      if (step) { stat.step++; continue }
      stat.classes[why.class] = (stat.classes[why.class] ?? 0) + 1
      assert.ok(M.STEP_CLASSES.includes(why.class) && why.class !== 'unclassified', `world ${w} cell ${cell}: ${why.class}`)
      // THE ORACLES (written here, from the definitions): the supports, the stands in the window, the domain
      const sups = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].filter(([a, b, c]) => M.refUsable(read(cx + a, cell[1] + b, cz + c))).length
      let stands = 0, own = 0, inDom = 0
      for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) for (const y of nodes.get(`${cx + dx},${cz + dz}`) ?? []) {
        const mine = (dx === 0 && dz === 0 && (y === cell[1] || y + 1 === cell[1])) || (want?.also ?? []).some(([ax, ay, az]) => cx + dx === ax && cz + dz === az && (y === ay || y + 1 === ay))
        if (mine) { own++; continue }
        stands++
        if (domain ? domain(cx + dx, cz + dz) : M.inDomain(home, cx + dx, cz + dz)) inDom++
      }
      assert.deepStrictEqual([why.n.supports, why.n.stands, why.n.own, why.n.out_of_domain], [sups, stands, own, stands - inDom], `world ${w} cell ${cell}: the counts`)
      const c = why.class
      assert.strictEqual(c === 'no_support', sups === 0, `world ${w} cell ${cell}: ${c} with ${sups} supports`)
      if (c === 'support_closed') assert.ok(sups > 0 && why.n.closed === sups && (want?.supportOk || want?.ws))
      if (sups > 0 && c !== 'support_closed') {
        assert.strictEqual(c === 'no_node', stands === 0 && own === 0); assert.strictEqual(c === 'own_cell', stands === 0 && own > 0)
        assert.strictEqual(c === 'out_of_domain', stands > 0 && inDom === 0)
        assert.strictEqual(sum(why.n), stands, 'each stand under exactly one failed test')
        if (want?.blind) assert.ok(why.n.wrong_side === 0 && why.n.no_sight === 0, 'a reach-only cell is never refused for side or sight')
      }
    }
  }
  return stat
}
await t('3,600 cells over 60 random worlds (rolling ground, water, fences, slabs, chests; ring / any / box domains; blind, guarded, state-bearing and bed-like wants)', () => {
  const s = property(B)
  console.log(`        (${s.cases} cells: ${s.step} with a step, ${s.cases - s.step} without -- ${Object.entries(s.classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')})`)
  assert.ok(s.step > 200 && s.cases - s.step > 200, 'POSITIVE CONTROL: both answers occur often')
  assert.ok(Object.keys(s.classes).length >= 5, `POSITIVE CONTROL: at least five classes occur (${Object.keys(s.classes)})`)
})
await t('MUTANT the reach test loosened in the refusal only (REACH + 1): some cell without a step has a stand that "passes" -- the property fails', async () => {
  let why = null
  await withMutant('buildsite.mjs', '        if (Math.hypot(...v) > REACH) continue\n', '        if (Math.hypot(...v) > REACH + 1) continue\n', async M => { try { property(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `survived: ${why}`)
})

console.log('THE ROWS (buildrun.mjs runVisit on the fake server; shop.mjs buildRowDetail)')
const PAL = { post: ['oak_planks'] }
const PX = 10, POST = [1, 2, 3].map(i => [PX, G + i, 0]), TOP = POST[2], FLOAT = [PX, G + 3, 0]
const rec = cells => ({ v: 1, plot: 'shop', cells: cells.map(at => ({ at, role: 'post', seg: 'A' })), segments: [{ seg: 'A', deps: [] }], clear: [], replant: [] })
// (a visit raises a stand only with a body that can: buildrun.mjs asks for the effects' rise / land / settle -- tempstand.test.mjs `body`)
const builder = (srv, o = {}) => { const inv = { oak_planks: 16, dirt: 8 }; const e = bot(srv, 'A', { inv, feet: [2, G + 1, 0], ...o }); e.count = n => inv[n] ?? 0; e.rise = async () => true; e.land = async () => {}; e.settle = async () => {}; return e }
const visit = (Mod, pr, e, { extra = {}, opts = {} } = {}) => { const h = PJ.recordHead(pr.dir, pr.key); return Mod.runVisit({ ...pr.p('A'), palette: PAL, record: h.head.rec, recordGen: h.head.gen, domain: ANY, ...extra }, e, { maxSteps: 400, tempStand: false, ...opts }) }
const rowsOf = (e, op) => e.logs.filter(([k, d]) => k === '_build' && d.op === op).map(([, d]) => d)
const postRow = async Mod => {
  const srv = server(), pr = project(rec(POST)), e = builder(srv)
  const r = await visit(Mod, pr, e)
  assert.strictEqual(r.placed, 2, 'POSITIVE CONTROL: the two cells the ground reaches are laid'); assert.strictEqual(r.stop, 'cell_deferred')
  assert.deepStrictEqual(rowsOf(e, 'deferred'), [{ op: 'deferred', seg: 'A', cell: TOP, n: 1, class: 'wrong_side' }], 'the deferral says why: the face is above the eye')
}
await t('a post 3 high, any stand allowed: the top cell is deferred `class=wrong_side` (in reach, its face above the eye)', () => postRow(R))
await t('MUTANT the deferral row without its class', () => killsRun("e.log('_build', { op: 'deferred', seg, cell: cand[0].at, n: cand.length, ...classRow(cand[0], nodes) })", "e.log('_build', { op: 'deferred', seg, cell: cand[0].at, n: cand.length })", postRow))
await t('MUTANT the class asked without the visit\'s domain: the post beside home reads out_of_domain', () => killsRun('cls = stepRefusal(rd, home, c.at, nodes, domain, supportOk', 'cls = stepRefusal(rd, home, c.at, nodes, null, supportOk', postRow))
const ringRow = async Mod => {
  const srv = server(), pr = project(rec(POST)), e = builder(srv)
  const r = await visit(Mod, pr, e, { extra: { domain: undefined } })
  assert.strictEqual(r.placed, 0); assert.strictEqual(r.stop, 'cell_deferred')
  assert.deepStrictEqual(rowsOf(e, 'deferred'), [{ op: 'deferred', seg: 'A', cell: POST[0], n: 1, class: 'out_of_domain' }], 'the same post under the workshop ring: its first cell, out of the domain')
}
await t('the same post with no domain named (the workshop ring, 10 from home): deferred `class=out_of_domain`', () => ringRow(R))
const switchOff = async Mod => {
  assert.strictEqual(Mod.stepClassOn({}), true); for (const v of ['off', '0', 'false', 'no', 'OFF', ' No ']) assert.strictEqual(Mod.stepClassOn({ STEPCLASS: v }), false, v)
  for (const v of ['', 'on', '1', 'yes']) assert.strictEqual(Mod.stepClassOn({ STEPCLASS: v }), true, v)
  const srv = server(), pr = project(rec(POST)), e = builder(srv)
  const r = await visit(Mod, pr, e, { opts: { stepClass: false } })
  assert.strictEqual(r.placed, 2); assert.strictEqual(r.stop, 'cell_deferred')
  assert.deepStrictEqual(rowsOf(e, 'deferred'), [{ op: 'deferred', seg: 'A', cell: TOP, n: 1 }], 'STEPCLASS off: the row exactly as before')
}
await t('the switch: STEPCLASS=off|0|false|no -- the deferral row is the one before, nothing asked', () => switchOff(R))
await t('MUTANT the switch ignored: the row carries a class with the switch off', () => killsRun('    if (!stepClassOpt) return {}\n', '', switchOff))
// a cell in the air with nothing under it: no ground stand, and no temporary stand either (a stand needs a block to click too)
const floating = async (Mod, { stepClass = true } = {}) => {
  const srv = server(), pr = project(rec([FLOAT])), under = k3([PX, G + 2, 0])
  let reads = 0
  const read0 = srv.read
  srv.read = (x, y, z) => { if (`${x},${y},${z}` === under) reads++; return read0(x, y, z) }
  const stand = { mayPlace: () => true, mem: {} }
  const e1 = builder(srv); const r1 = await visit(Mod, pr, e1, { extra: { tempStand: stand }, opts: { tempStand: true, stepClass } })
  const first = reads; reads = 0
  const e2 = builder(srv); const r2 = await visit(Mod, pr, e2, { extra: { tempStand: stand }, opts: { tempStand: true, stepClass } })
  return { srv, e1, r1, e2, r2, first, second: reads }
}
const standRow = async Mod => {
  const v = await floating(Mod)
  assert.strictEqual(v.r1.stop, 'cell_deferred'); assert.deepStrictEqual(rowsOf(v.e1, 'tempstand'), [], 'a first miss plans no stand')
  assert.deepStrictEqual(rowsOf(v.e1, 'deferred'), [{ op: 'deferred', seg: 'A', cell: FLOAT, n: 1, class: 'no_support' }])
  assert.deepStrictEqual(rowsOf(v.e2, 'tempstand'), [{ op: 'tempstand', seg: 'A', cell: FLOAT, result: 'refused', why: 'no_step', class: 'no_support' }], 'the stand\'s refusal says what `no_step` hides: nothing to click')
  assert.deepStrictEqual(rowsOf(v.e2, 'deferred'), [{ op: 'deferred', seg: 'A', cell: FLOAT, n: 1, class: 'no_support' }])
  assert.deepStrictEqual([...v.srv.placedAt.keys()], [], 'nothing was placed')
}
await t('a cell in the air: deferred `class=no_support`; the next visit\'s temporary stand is `refused why=no_step class=no_support`', () => standRow(R))
await t('MUTANT the stand\'s refusal without its class', () => killsRun("tsRow({ seg, cell: c.at, result: 'refused', why: String(pl.why).slice(0, 80), ...classRow(c, nodes) })", "tsRow({ seg, cell: c.at, result: 'refused', why: String(pl.why).slice(0, 80) })", standRow))
const cost = async Mod => {
  const on = await floating(Mod), off = await floating(Mod, { stepClass: false })
  assert.ok(off.first > 0 && off.second > off.first, `POSITIVE CONTROL: the stand search reads the block under the cell (${off.first}, then ${off.second} with the stand's plans)`)
  // ONE question a cell and visit: stepFor again (one read of the block under the cell) and the refusal's own pass (one more)
  assert.strictEqual(on.first - off.first, 2, `the first visit's one row (${on.first} against ${off.first})`)
  assert.strictEqual(on.second - off.second, 2, `the second visit's TWO rows name the same cell: asked once (${on.second} against ${off.second})`)
}
await t('THE COST: the class is asked once a cell and visit -- two reads of the block under it, whether one row names the cell or two', () => cost(R))
await t('MUTANT the class asked again for every row', () => killsRun('    if (!m || m.nodes !== nodes) {\n', '    if (true) {\n', cost))
const kept = M => {
  const d = M.buildRowDetail({ project: 'civicH', op: 'deferred', seg: 'roof', cell: [9, 75, 16], n: 3, class: 'out_of_domain' })
  assert.match(d, /(^| )class=out_of_domain( |$)/, d); assert.match(d, /(^| )n=3( |$)/, 'POSITIVE CONTROL: a field the list always had')
  assert.match(M.buildRowDetail({ project: 'tidy', op: 'tempstand', seg: 'f1', cell: [1, 2, 3], result: 'refused', why: 'no_step', class: 'no_support' }), / class=no_support .*why=no_step$/)
  assert.ok(!/class=/.test(M.buildRowDetail({ project: 'tidy', op: 'deferred', seg: 'f1', cell: [1, 2, 3], n: 1 })), 'absent: not written')
}
await t('the row formatter (shop.mjs buildRowDetail) keeps `class`', () => kept(SH))
await t('MUTANT `class` not on the formatter\'s list: the key is dropped on its way to the logs', async () => {
  let why = null
  await withMutant('shop.mjs', "'kind', 'class', 'saplings',", "'kind', 'saplings',", async M => { try { kept(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `survived: ${why}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
