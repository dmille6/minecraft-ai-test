// STEPWELL-01: THE TOWN STEPWELL (bots/src/stepwell.mjs, bots/src/stepwellvisit.mjs; shop.mjs PROJECTS; skills.mjs buildStepwell).
// Behaviour: the shape's walk proof for every width and tier count it allows (with a mutant that removes one post), the plan's cells
// and cuts (disjoint, the cut list above each top, the order top down), the next mutation's SAFETY ORDER (lava stops, water is sealed
// before a cut, cuts before faces, never the bot's own cells, a post only on its trim), the siting survey on a fake world (a site,
// lava and water refusals with a positive control, trees), the record and its plan round trip, the felling view, and THE TANK BUILT
// END TO END on a fake world by the real visit loop -- with the invariant that no cell beside a walkway is cut 2 below it before that
// walkway's posts stand, and that the visit ends at the exit. Anchored mutants (each asserts its anchor present and unique) show the
// ordering tests fail for the intended reason. STRUCTURAL checks only for the wiring (comments stripped, executable lines).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/stepwell.mjs')
const V = await import('../src/stepwellvisit.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const SW_PATH = new URL('../src/stepwell.mjs', import.meta.url)
const SV_PATH = new URL('../src/stepwellvisit.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// ---- a fake world: grass at G, dirt G-1..G-3, stone below to G-40; overrides by "x,y,z" -> name ------------------------------
const G = 64
const EMPTY = /^(air|cave_air|torch|short_grass)$/
const mk = n => (n == null ? null : { name: n, boundingBox: EMPTY.test(n) || /_sapling$/.test(n) ? 'empty' : (/water|lava/.test(n) ? 'empty' : 'block') })
function world (over = {}) {
  const m = new Map(Object.entries(over))
  const base = (x, y, z) => (y > G ? 'air' : y === G ? 'grass_block' : y >= G - 3 ? 'dirt' : y >= G - 40 ? 'stone' : 'bedrock')
  const get = (x, y, z) => { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : base(x, y, z) }
  return { read: (x, y, z) => mk(get(x, y, z)), set: (c, n) => m.set(c.join(','), n), get: c => get(...c), m }
}

console.log('THE SHAPE')
await t('every width and tier count the shape allows passes the walk proof: no walkway beside a drop of 2+, every walkway reached from the rim', () => {
  let n = 0
  for (const W of [15, 21, 25, 27, 33]) {
    for (let T = 1; T <= S.tiersFit(W); T++) {
      const m = S.columnMap({ W, T, g: G })
      const wc = S.walkCheck(m, W)
      assert.ok(wc.ok, `W${W} T${T}: ${wc.problems.slice(0, 3).join('; ')}`)
      assert.ok(wc.reached === wc.walkable && wc.walkable > 0)
      n++
    }
  }
  assert.ok(n >= 8, `only ${n} shapes checked`)
  assert.strictEqual(S.tiersFit(27), 2)
  assert.strictEqual(S.tiersFit(25), 2)
  assert.strictEqual(S.tiersFit(33), 3)
})
await t('POSITIVE CONTROL: the walk proof finds a missing post (one rail column made a walkway) and a too-deep step', () => {
  const m = S.columnMap({ W: 27, T: 2, g: G })
  // a rail column mid-side (a corner rail's four neighbours are rails and walkway: it is safe without its post, and the proof says so)
  const rail = [...m.values()].find(c => c.kind === 'rail' && c.b === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([du, dv]) => (m.get(`${c.u + du},${c.v + dv}`)?.s ?? Infinity) < c.s - 1))
  rail.post = false; rail.path = true
  assert.ok(!S.walkCheck(m, 27).ok, 'a rail column without its post must fail the proof')
  const m2 = S.columnMap({ W: 27, T: 2, g: G })
  const tread = [...m2.values()].find(c => c.kind === 'tread')
  tread.s -= 2
  assert.ok(!S.walkCheck(m2, 27).ok, 'a tread two lower than its neighbour must fail the proof')
})
await t('the flights: one per tier, 2 wide, on side (t-1) mod 4, a head at the upper band\'s level, a 2-wide gap over the top treads', () => {
  const W = 33, T = 3, m = S.columnMap({ W, T, g: G })
  const c = (W - 1) / 2
  for (let t = 1; t <= T; t++) {
    const side = (t - 1) % 4
    const head = [0, 1, 2].map(i => m.get(S.sideUV(W, side, c - 2, S.bandR(t) + i).join(',')))
    assert.ok(head.every(h => h.kind === 'head' && h.s === G - 4 * (t - 1)), `tier ${t} head`)
    const top = [S.bandR(t), S.bandR(t) + 1].map(r => m.get(S.sideUV(W, side, c - 1, r).join(',')))
    assert.ok(top.every(q => q.kind === 'tread' && q.path && q.s === G - 4 * t + 3), `tier ${t} top treads`)
    const gap = [c - 1, c].map(a => m.get(S.sideUV(W, side, a, S.bandR(t) - 1).join(',')))
    assert.ok(gap.every(q => q.kind === 'gap' && q.path && q.s === G - 4 * (t - 1)), `tier ${t} gap`)
  }
  assert.ok(![...m.values()].some(q => q.kind === 'basin' && (q.kind === 'tread' || q.kind === 'frail')))
})

console.log('THE PLAN')
const SITE = { origin: { x: 0, z: 0 }, away: 's', g: G, W: 21, T: 1 }
await t('the plan: cells and cuts disjoint, every cut above its column\'s top, posts on trims, lights on posts, units top down', () => {
  const P = S.planTank(SITE)
  const cells = new Set(P.cells.map(e => e.at.join(',')))
  assert.ok(P.cut.every(c => !cells.has(c.at.join(','))), 'a cut cell is also a record cell')
  for (const e of P.cells.filter(q => q.role === 'post')) assert.strictEqual(P.byKey.get([e.at[0], e.at[1] - 1, e.at[2]].join(','))?.role, 'trim')
  for (const e of P.cells.filter(q => q.role === 'light')) assert.strictEqual(P.byKey.get([e.at[0], e.at[1] - 1, e.at[2]].join(','))?.role, 'post')
  for (let i = 1; i < P.units.length; i++) assert.ok(P.units[i].y < P.units[i - 1].y)
  assert.ok(S.walkCheck(P.cols, P.W).ok)
  assert.deepStrictEqual(P.exit, [10, G + 1, -1])
})
await t('the record\'s own clear list is its plan\'s cuts (never a cell the record does not list), with the felling\'s logs in the clear list', () => {
  const w = world()
  const sv = { site: { ...SITE, centre: [10, 10], tiersDry: 1 }, counts: {}, byTier: {}, d: 40 }
  const fell = { trees: [{ base: [8, G + 1, 8], name: 'spruce_log', top: G + 9 }], platforms: [{ tree: 0, cells: [[8, G + 1, 9]] }], clear: [{ at: [8, G + 1, 8], kind: 'tree', name: 'spruce_log', tree: 0 }, { at: [8, G + 9, 8], kind: 'tree', name: 'spruce_log', tree: 0 }], replant: [{ cell: [40, G + 1, 40], species: 'spruce', sapling: 'spruce_sapling', state: 'pending' }] }
  const rec = S.stepwellRecord(sv, { home: { x: 0, y: G, z: -40 }, seed: 7, fell, read: w.read })
  const P = S.planOfRecord(rec)
  const listed = new Set(rec.clear.map(c => c.at.join(',')))
  assert.ok(P.cut.every(c => listed.has(c.at.join(','))), 'the plan cuts a cell the record does not list')
  assert.ok(rec.clear.some(c => c.kind === 'tree' && c.at[1] === G + 9), 'the log above the cut top is a clear')
  assert.strictEqual(rec.cells.find(c => c.at.join(',') === `8,${G + 1},9`)?.role, 'stand')
  assert.ok(!P.cut.some(c => c.at.join(',') === `8,${G + 1},9`), 'a stand is a record cell, never a cut')
  assert.ok(P.units.some(u => u.cut.some(c => c.join(',') === `8,${G + 1},9`)), 'a stand is taken down by its layer\'s unit')
  assert.ok(!rec.clear.some(c => c.at[1] > G + S.CUT_OPEN && c.kind === 'cut'), 'open sky above the cut top is not listed')
  const fv = S.fellView(rec)
  assert.deepStrictEqual(fv.cells.map(c => c.role), ['stand'])
  assert.ok(fv.clear.every(c => c.kind === 'tree' || c.kind === 'leaves') && fv.clear.length === 2)
  assert.strictEqual(fv.replant.length, 1)
  w.set([8, G + 1, 8], 'spruce_log'); w.set([8, G + 9, 8], 'spruce_log')
  assert.strictEqual(S.fellPending(w.read, rec), 2)
  w.set([8, G + 1, 8], 'air'); w.set([8, G + 9, 8], 'air')
  assert.strictEqual(S.fellPending(w.read, rec), 0)
})

console.log('THE NEXT MUTATION (the safety order)')
const P1 = S.planTank(SITE)
const unitAt = y => P1.units.find(u => u.y === y)
await t('lava at or beside a cut STOPS the tank; water beside a cut is SEALED (a record cell) before any cut; an unread cell waits', () => {
  const u = unitAt(G - 1)
  const w = world()
  const c = u.cut[5]
  w.set([c[0] + 0, c[1] - 1, c[2]], 'lava')
  assert.deepStrictEqual(S.stepwellNext(w.read, P1, u).op, 'stop')
  const w2 = world()
  const face = P1.cells.find(e => e.role === 'wall' && e.y === G - 1)
  w2.set(face.at, 'water')
  const op = S.stepwellNext(w2.read, P1, u)
  assert.strictEqual(op.op, 'place'); assert.strictEqual(op.why, 'seal'); assert.deepStrictEqual(op.at, face.at)
  const w3 = world()
  const rd = (x, y, z) => (x === c[0] && y === c[1] && z === c[2] ? null : w3.read(x, y, z))
  assert.strictEqual(S.stepwellNext(rd, P1, u).op, 'wait')
})
await t('a cut never digs the bot\'s own body or floor; the cuts go before the faces; a post waits for its trim', () => {
  const u = unitAt(G - 1)
  const w = world()
  const first = S.stepwellNext(w.read, P1, u)
  assert.strictEqual(first.op, 'dig'); assert.strictEqual(first.kind, 'cut')
  const feet = [first.at[0], first.at[1] + 1, first.at[2]]   // standing ON the first cut cell
  const op = S.stepwellNext(w.read, P1, u, { feet })
  assert.notDeepStrictEqual(op.at, first.at, 'dug the cell under the bot')
  const u0 = P1.units.find(q => q.posts.length)
  const w2 = world()
  for (const c of u0.cut) w2.set(c, 'air')
  const op2 = S.stepwellNext(w2.read, P1, u0)
  assert.ok(op2.why !== 'post', 'a post was placed before its trim')
})
await t('MUTANT KILLED: without the seal-first survey, water beside a cut is cut into', async () => {
  await withMutant(SW_PATH, "      if (isWet(nb)) return sealOp(n)", "      if (false) return sealOp(n)", async M => {
    const P = M.planTank(SITE)
    const u = P.units.find(q => q.y === G - 1)
    const w2 = world()
    const face = P.cells.find(e => e.role === 'wall' && e.y === G - 1)
    w2.set(face.at, 'water')
    const op = M.stepwellNext(w2.read, P, u)
    assert.ok(!(op.op === 'place' && op.why === 'seal'), 'the mutant still seals: the test above proves nothing')
  })
})

await t('Codex r1 BLOCKER 1: a seal refused twice (skipped) still blocks every cut beside it; water in the bot\'s own cell moves the bot, never skipped', () => {
  const u = unitAt(G - 1)
  const w = world()
  const face = P1.cells.find(e => e.role === 'wall' && e.y === G - 1)
  w.set(face.at, 'water')
  const op = S.stepwellNext(w.read, P1, u, { skip: new Set([face.at.join(',')]) })
  assert.strictEqual(op.op, 'stop'); assert.strictEqual(op.why, 'unsealed')
  const feet = [face.at[0], face.at[1], face.at[2]]
  const op2 = S.stepwellNext(w.read, P1, u, { feet })
  assert.strictEqual(op2.op, 'place'); assert.strictEqual(op2.own, true)
})
await t('Claude r1 BLOCKER 3: a record\'s felled cell is never sealed (SW1 seals only cut cells of kind cut): water there stops the tank', () => {
  const w = world()
  const sv = { site: { ...SITE, centre: [10, 10], tiersDry: 1 }, counts: {}, byTier: {}, d: 40 }
  const P0 = S.planTank(SITE)
  const logAt = P0.cut.find(c => c.at[1] === G - 1).at
  const fell = { trees: [{ base: logAt, name: 'spruce_log', top: G + 3 }], platforms: [], clear: [{ at: logAt, kind: 'tree', name: 'spruce_log', tree: 0 }], replant: [{ cell: [40, G + 1, 40], species: 'spruce', sapling: 'spruce_sapling', state: 'pending' }] }
  const rec = S.stepwellRecord(sv, { home: { x: 0, y: G, z: -40 }, fell, read: w.read })
  const P = S.planOfRecord(rec)
  assert.ok(P.cutKeys.has(logAt.join(',')) && !P.sealKeys.has(logAt.join(',')))
  w.set(logAt, 'water')
  const u = P.units.find(q => q.y === G - 1)
  const op = S.stepwellNext(w.read, P, u)
  assert.strictEqual(op.op, 'stop'); assert.strictEqual(op.why, 'water_outside')
})
await t('Codex r1 BLOCKER 2: a cut another body stands on is never dug (passed after two tries)', async () => {
  const P = S.planTank(SITE)
  const w = world()
  const target = P.units.find(u => u.y === G).cut[0]
  const e = fakeBot(w, P, { start: [10, G + 1, -2] })
  e.occupied = c => c.join(',') === target.join(',')
  await V.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {} }, e, { opsMax: 60 })
  assert.strictEqual(w.get(target), 'grass_block', 'dug from under another body')
})

console.log('THE SITING SURVEY')
const HOME = { x: 0, y: G, z: 0 }
await t('a dry, flat, treeless site surveys ok with counts; lava in a cut refuses it; water in a face refuses the tier (POSITIVE CONTROL: the same site without them is ok)', () => {
  const w = world()
  const cand = { x: 40, z: 0, away: 'e', d: 40 }
  const ok = S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 })
  assert.ok(ok.ok, ok.why); assert.ok(ok.counts.dug > 0 && ok.counts.soft > 0)
  const P = S.planTank(ok.site)
  const lava = P.cut.find(c => c.at[1] === G - 2)
  w.set(lava.at, 'lava')
  const bad = S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 })
  assert.ok(!bad.ok && /^lava/.test(bad.why), JSON.stringify(bad))
  w.set(lava.at, 'stone')
  const face = P.cells.find(e => e.role === 'wall' && e.y < G)
  w.set(face.at, 'water')
  const wet = S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 })
  assert.ok(!wet.ok && /^wet:tier1/.test(wet.why), JSON.stringify(wet.why))
  w.set(face.at, 'stone')
  assert.ok(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 }).ok)
})
await t('Codex r1 BLOCKER 3: the rim is walled outside (a parapet post on every outer column but the 2-wide gate); ground 2 below the rim in front of the gate refuses the site, anywhere else it is walled', () => {
  const m = S.columnMap({ W: 21, T: 1, g: G })
  const outer = [...m.values()].filter(c => c.r === 0)
  assert.strictEqual(outer.filter(c => c.kind === 'gate').length, 2)
  assert.ok(outer.every(c => c.kind === 'gate' ? c.path : c.post), 'every outer column but the gate is posted')
  const w = world()
  const cand = { x: 40, z: 0, away: 'e', d: 40 }
  const P = S.planTank(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 }).site)
  // outside a walled column: two below the rim -- fine (the parapet)
  const far = [P.box[2] + 1, G, P.box[3] - 3]
  w.set(far, 'air'); w.set([far[0], G - 1, far[2]], 'air')
  assert.ok(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 }).ok, 'a drop outside the parapet is walled')
  // in front of the gate (the exit's floor): two below the rim refuses; one below is a step (the positive control)
  const ex = P.exit
  w.set([ex[0], G, ex[2]], 'air'); w.set([ex[0], G - 1, ex[2]], 'air')
  assert.strictEqual(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 }).why, 'gate_step')
  w.set([ex[0], G - 1, ex[2]], 'dirt')
  assert.ok(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 }).ok, 'one below is a step: ok')
})
await t('Claude r1 BLOCKERS 1-2: a felling stand on a tank cell or above the cut top refuses the site', () => {
  const P = S.planTank(SITE)
  const post = P.cells.find(e => e.role === 'post').at
  assert.strictEqual(S.standsFit(SITE, [{ cells: [post] }]), 'stand_on_cell')
  assert.strictEqual(S.standsFit(SITE, [{ cells: [[7, P.top + 1, 7]] }]), 'stand_above_cut')
  assert.strictEqual(S.standsFit(SITE, [{ cells: [[7, G + 2, 7]] }]), null)
})
await t('a reserved column, a disallowed zone and a tree refuse a site (trees counted when allowed)', () => {
  const w = world()
  const cand = { x: 40, z: 0, away: 'e', d: 40 }
  assert.ok(/^reserved/.test(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1, blocked: (x, z) => (x === 38 && z === 1 ? 'project:tower' : null) }).why))
  assert.ok(/^zone:homes/.test(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1, zoneOf: () => 'homes' }).why))
  assert.ok(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1, zoneOf: () => 'industry' }).ok)
  w.set([40, G + 1, 1], 'spruce_log'); w.set([40, G + 2, 1], 'spruce_log')
  assert.strictEqual(S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1 }).why, 'trees')
  const tr = S.surveyStepwell(w.read, HOME, cand, { W: 21, tiers: 1, tiersMax: 1, treesOk: true })
  assert.ok(tr.ok && tr.counts.trunks === 1)
})

console.log('THE TANK BUILT END TO END (the real visit loop on a fake world)')
/** A fake bot over the world: walkTo teleports to a valid stand (floor full, feet and head open); dig and place mutate the world. */
function fakeBot (w, plan, { start, log = [] } = {}) {
  let feet = [...start]
  let t = 0
  const placed = role => ({ floor: 'stone_bricks', trim: 'stone_bricks', wall: 'cobblestone', body: 'cobblestone', under: 'cobblestone', post: 'cobblestone_wall', light: 'torch', seal: 'cobblestone' }[role])
  return {
    get read () { return w.read },
    feet: () => feet,
    walkTo: async c => {
      const fl = w.read(c[0], c[1] - 1, c[2]), f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2])
      if (!(fl?.boundingBox === 'block' && f?.boundingBox === 'empty' && h?.boundingBox === 'empty')) return false
      feet = [...c]; t += 1; return true
    },
    dig: async c => {
      const k = c.join(',')
      if (k === [feet[0], feet[1] - 1, feet[2]].join(',') || k === feet.join(',')) throw new Error(`dug own cell ${k}`)
      w.set(c, 'air'); log.push(['dig', c]); t += 1; return 'confirmed'
    },
    place: async (c, role) => { w.set(c, placed(role)); log.push(['place', c, role]); t += 1; return 'confirmed' },
    toolOk: () => true,
    fence: () => true,
    log: () => {},
    now: () => t,
    aborted: () => false,
  }
}
await t('a W21 one-tier tank builds to complete; every cell done; no cut 2 below a walkway before its posts stand; the visit ends at the exit', async () => {
  const P = S.planTank(SITE)
  const w = world()
  const log = []
  const e = fakeBot(w, P, { start: [10, G + 1, -2], log })
  let r = null
  for (let i = 0; i < 20; i++) {
    r = await V.runStepwellVisit({ rec: null, plan: P, exit: P.exit, onStop: async () => { throw new Error('stopped') } }, e, { deadline: Infinity, opsMax: 2000 })
    if (r.stop === 'complete') break
  }
  assert.strictEqual(r.stop, 'complete', JSON.stringify(r))
  assert.strictEqual(S.firstUndoneUnit(w.read, P), null)
  assert.ok(S.tiersDone(w.read, P).includes(1))
  // THE INVARIANT: the rim's posts (band 0's rail ring) all stand before any cut at g-1 or lower
  const rimPosts = new Set(P.cells.filter(q => q.role === 'post' && q.t === 0).map(q => q.at.join(',')))
  const firstDeep = log.findIndex(x => x[0] === 'dig' && x[1][1] <= G - 1)
  const lastRimPost = Math.max(...log.map((x, i) => (x[0] === 'place' && rimPosts.has(x[1].join(',')) ? i : -1)))
  assert.ok(firstDeep > lastRimPost, `a cut at ${log[firstDeep]?.[1]} went before the last rim post (${firstDeep} < ${lastRimPost})`)
  assert.deepStrictEqual(e.feet(), P.exit, 'the visit did not end at the exit')
  assert.ok(S.walkCheck(P.cols, P.W).ok)
})
await t('MUTANT KILLED: with the posts after the deeper cuts (the unit\'s posts read from the layer below), the invariant fails', async () => {
  await withMutant(SW_PATH, "      else if (e.y === y + 1 && e.role === 'post') u.posts.push(e.at)", "      else if (e.y === y + 3 && e.role === 'post') u.posts.push(e.at)", async M => {
    const P = M.planTank(SITE)
    const w = world()
    const log = []
    const e = fakeBot(w, P, { start: [10, G + 1, -2], log })
    for (let i = 0; i < 20; i++) { const r = await V.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {} }, e, { opsMax: 2000 }); if (r.stop === 'complete') break }
    const rimPosts = new Set(P.cells.filter(q => q.role === 'post' && q.t === 0).map(q => q.at.join(',')))
    const firstDeep = log.findIndex(x => x[0] === 'dig' && x[1][1] <= G - 1)
    const lastRimPost = Math.max(...log.map((x, i) => (x[0] === 'place' && rimPosts.has(x[1].join(',')) ? i : -1)))
    assert.ok(!(firstDeep > lastRimPost), 'the mutant kept the order: the invariant test proves nothing')
  })
})
await t('a lava cell met during the build stops the tank (onStop with the layer) and never digs into it', async () => {
  const P = S.planTank(SITE)
  const w = world()
  const lava = P.cut.find(c => c.at[1] === G - 2).at
  w.set(lava, 'lava')
  const e = fakeBot(w, P, { start: [10, G + 1, -2] })
  let stopped = null
  let r = null
  for (let i = 0; i < 10; i++) { r = await V.runStepwellVisit({ plan: P, exit: P.exit, onStop: async (y, why) => { stopped = { y, why } } }, e, { opsMax: 2000 }); if (r.stop !== 'ops' && r.stop !== 'passed') break }
  assert.strictEqual(r.stop, 'stopped'); assert.ok(stopped && /lava/.test(stopped.why))
  assert.strictEqual(w.get(lava), 'lava')
})
await t('MUTANT KILLED: the visit without its egress leaves the builder in the pit', async () => {
  await withMutant(SV_PATH, '        const okOut = await e.walkTo(p.exit)', '        const okOut = false', async M => {
    const P = S.planTank(SITE)
    const w = world()
    const e = fakeBot(w, P, { start: [10, G + 1, -2] })
    for (let i = 0; i < 20; i++) { const r = await M.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {} }, e, { opsMax: 2000 }); if (r.stop === 'complete') break }
    assert.notDeepStrictEqual(e.feet(), P.exit, 'the mutant still walked out: the egress test proves nothing')
  })
})

console.log('THE SWITCH AND THE WIRING (structural: comments stripped, executable lines, each with a one-character mutant)')
await t('the switch: on only in STEPWELL_POOLS (default showcase), STEPWELL=on|off overrides; the licence row names it', () => {
  assert.strictEqual(S.stepwellOn({}, 'showcase'), true)
  assert.strictEqual(S.stepwellOn({}, 'hive-a'), false)
  assert.strictEqual(S.stepwellOn({ STEPWELL: 'off' }, 'showcase'), false)
  assert.strictEqual(S.stepwellOn({ STEPWELL: 'on' }, 'hive-a'), true)
  assert.strictEqual(S.stepwellOn({ STEPWELL_POOLS: 'hive-a,showcase' }, 'hive-a'), true)
  assert.ok(/^on=1 W=23 tiers=2\/2/.test(S.stepwellModeDetail(true)))
})
await t('the item ladders: a role\'s palette first, the town\'s common stone after; posts are walls, lights torches', async () => {
  const VV = await import('../src/stepwellvisit.mjs')
  assert.deepStrictEqual(VV.itemsFor('floor', { floor: ['stone_bricks', 'cobblestone'] }).slice(0, 2), ['stone_bricks', 'cobblestone'])
  assert.ok(VV.itemsFor('post', {}).every(n => /_wall$/.test(n)))
  assert.strictEqual(VV.itemsFor('light', {})[0], 'torch')
  assert.ok(VV.itemsFor('under', {}).includes('cobblestone'))
})
const SKS = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const SHS = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
const FXS = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
const WIRES = [
  ['skills: the build order dispatches the stepwell\'s visit', SKS, /if \(proj\.plot === STEPWELL_PLOT\) return buildStepwell\(ctx, args, signal\)/],
  ['skills: a standing stepwell judges its own cells (its damage is a repair)', SKS, /if \(r\.blueprint === STEPWELL_BLUEPRINT\) return stepwellDamaged\(stairRead\(bot\), r\) != null/],
  ['skills: an unsited stepwell whose siting found no site waits town-wide', SKS, /if \(p\.plot === STEPWELL_PLOT && !rec && Date\.now\(\) < siteWaitUntil\(STEPWELL_PLOT, dir\)\) return/],
  ['skills: the felling runs on the felling view (runVisit: replants first, G5 rows)', SKS, /const r = await runVisit\(\{ dir, key, me, home, stood, record: fellView\(rec\), recordGen: rh\.head\.gen, palette: FELL_PALETTE/],
  ['skills: the tank runs the tested loop', SKS, /const r = await runStepwellVisit\(\{/],
  ['skills: a stop publishes the stopped record (never a deeper cut)', SKS, /onStop: async \(y, why\) => \{ publishRecord\(dir, key, cur => \(cur && cur\.blueprint === STEPWELL_BLUEPRINT && cur\.state !== 'stopped' \? stepwellStopped\(cur/],
  ['shop: the stepwell in the project list, one builder', SHS, /Object\.freeze\(\{ plot: STEPWELL_PLOT, blueprint: STEPWELL_BLUEPRINT, builders: STEPWELL_BUILDERS \}\)/],
  ['shop: a sited stepwell stays guarded whatever its switch', SHS, /for \(const p of PROJECTS\) if \(p\.plot === STEPWELL_PLOT && !out\.some\(q => q\.plot === p\.plot\)\) out\.push\(p\)/],
  ['features: the licence row', FXS, /logEvent\(\{ kind: 'stepwell_mode', status: 'success', snapshot: snapshot\(bot\), detail: stepwellModeDetail\(STEPWELL\.on\) \}\)/],
]
for (const [name, src, re] of WIRES) {
  await t(`${name} (and a mutant of it fails)`, () => {
    assert.ok(re.test(src), 'wired')
    const m = src.match(re)[0]
    assert.strictEqual(src.split(m).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.ok(!re.test(src.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant of the executable line is not matched')
  })
}
await t('the comment stripper is not fooled: a wiring line only in a comment does not match (control)', () => {
  assert.ok(!WIRES[0][2].test(strip('// if (proj.plot === STEPWELL_PLOT) return buildStepwell(ctx, args, signal)\n')))
})

console.log(`\nstepwell: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
