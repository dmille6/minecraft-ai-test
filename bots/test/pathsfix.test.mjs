// PATHSFIX-01 (projectaudit 11-06: 13 of 14 fleet towns' paths `state=no_site`, complete with 0 cells; only board-b has a path).
// MEASURED on the 11-06 region copies of the 16 fleet towns (the bots' own sitePaths): 57 required legs unrouted, 30 with no brush
// the router may stand at the destination itself (a one-column front beside its own record); the core plazas stand on platforms
// with 5-8 drops round them; one unrouted leg left a whole town with no path; and a due no-site record waited behind every open
// project for days. The fix: a front's APPROACH (its free columns within 2, height-checked), the paths' own earthwork for a leg the
// strict router misses (PATH_GRADES), a network laid in SECTIONS (the rest `pending`, asked again), a leg joins the plaza at the
// plaza's height, an unsited record is NOT complete (but settles the order) and its retry is a repair. PATHSFIX=off is the rollback.
// Pure: buildfake's flat world (stone below G, grass at G) with cells set per scene.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, server, plan } = await import('./helpers/buildfake.mjs')
const P = await import('../src/paths.mjs')
const SHOPM = await import('../src/shop.mjs')
const TIDY = await import('../src/tidy.mjs')
const { placeBlueprint } = await import('../src/buildsite.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const PATHS_PATH = new URL('../src/paths.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const CORE = [-6, -6, 6, 6]
const corePlan = () => ({ ...plan(), plots: [{ id: 'core', kind: 'plaza', box: CORE, keepout: false }] })
const legOf = (s, id) => s.net?.legs?.find(l => l.id === id)

// ---- scene A: the stair's collar exit in a NOTCH (its own record east, a built stoop west): no 2x2 brush covers the column ------
const EXIT = [24, 0]
const notchWorld = () => {
  const srv = server()
  for (const z of [-1, 0, 1]) srv.set([EXIT[0] - 1, G, z], 'oak_planks')   // a placed stoop: pathColumn `built`
  return srv
}
const notchRec = () => {
  const cells = []
  for (let x = EXIT[0] + 1; x <= EXIT[0] + 5; x++) for (let z = -2; z <= 2; z++) cells.push({ at: [x, G, z], role: 'lining' })
  return { blueprint: 'shaft@2', structure_complete: true, exit: [EXIT[0], G + 1, EXIT[1]], cells }
}
const notchIn = (extra = {}) => ({ plan: corePlan(), projects: [{ plot: 'shaft', rec: notchRec() }], place: placeBlueprint, ...extra })

console.log('THE APPROACH (a one-column front beside its own record)')
await t('approachCols: the column first, then the free columns within 2, nearest first, deterministic; a refused column is left out', async () => {
  const a = P.approachCols([0, 0], (x, z) => (x === 1 && z === 0 ? 'project' : null))
  assert.deepStrictEqual(a[0], [0, 0])
  assert.strictEqual(a.length, 24, '25 columns in the 5x5, the refused one out')
  assert.ok(!a.some(([x, z]) => x === 1 && z === 0))
  assert.ok(a.slice(1, 8).every(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) === 1), 'the ring at 1 before the ring at 2')
  assert.deepStrictEqual(P.approachCols([0, 0], () => null), P.approachCols([0, 0], () => null), 'deterministic')
})
await t('a collar exit in a notch routes through its approach; CONTROL fix false: unreachable (no brush over the one column)', async () => {
  const srv = notchWorld()
  const off = P.sitePaths(srv.read, notchIn({ fix: false }))
  assert.strictEqual(off.ok, false); assert.match(off.why, /shaft:unreachable/)
  const s = P.sitePaths(srv.read, notchIn())
  assert.ok(s.ok, s.why)
  const leg = legOf(s, 'shaft')
  assert.ok(leg.ok && leg.nodes.length, 'the shaft leg is laid')
  // the leg ends within 2 of the exit (the bot steps the rest), never on the record or the stoop
  const cols = new Set(s.record.cells.map(c => `${c.at[0]},${c.at[2]}`))
  assert.ok([...cols].some(k => { const [x, z] = k.split(',').map(Number); return Math.max(Math.abs(x - EXIT[0]), Math.abs(z - EXIT[1])) <= 2 }))
  assert.ok(![...cols].some(k => { const [x] = k.split(',').map(Number); return x > EXIT[0] }), 'no path column on the record')
})
await t('the approach is height-checked: a column 2 above the front is no approach (the bot could not step it)', async () => {
  const terrace = () => {
    const srv = notchWorld()
    // every approach column the stoop and the record leave is a terrace 2 above the exit's ground (a bot cannot step up it)
    for (let x = EXIT[0] - 2; x <= EXIT[0]; x++) for (let z = -2; z <= 2; z++) {
      if ((x === EXIT[0] - 1 && Math.abs(z) <= 1) || (x === EXIT[0] && Math.abs(z) <= 1)) continue
      srv.set([x, G + 1, z], 'stone'); srv.set([x, G + 2, z], 'stone')
    }
    return srv
  }
  const D = P.pathDests(notchIn())
  const d = D.dests.find(q => q.id === 'shaft')
  assert.ok(d.cols.some(([x, z]) => z === 2), 'pathDests lists them (no read there)')
  const s = P.sitePaths(terrace().read, notchIn({ grade: false }))
  assert.strictEqual(legOf(s, 'shaft').ok, false, 'no approach column within one of the exit\'s ground: unrouted')
  await withMutant(PATHS_PATH, 'return !!c && !c.why && Number.isFinite(c.y) && Math.abs(c.y - c0.y) <= 1 })', 'return true })', async M => {
    const s2 = M.sitePaths(terrace().read, notchIn({ grade: false }))
    assert.strictEqual(s2.net.legs.find(l => l.id === 'shaft').ok, true, 'MUTANT KILLED: without the check the terrace is an approach')
  })
})
await t('MUTANT KILLED: a front without its approach is unreachable again', async () => {
  await withMutant(PATHS_PATH, 'const one = c => (fix ? approachCols(c, avoid) : [c])', 'const one = c => [c]', async M => {
    const s = M.sitePaths(notchWorld().read, notchIn())
    assert.strictEqual(s.net.legs.find(l => l.id === 'shaft').ok, false)
  })
})

// ---- scene B: a raised plaza (core 5 above the ground round it) -- the fleet's platform ----------------------------------------
const H = 5
const platformWorld = () => {
  const srv = server()
  for (let x = CORE[0]; x <= CORE[2]; x++) for (let z = CORE[1]; z <= CORE[3]; z++) for (let y = G + 1; y <= G + H; y++) srv.set([x, y, z], 'cobblestone')
  return srv
}
const platformIn = (extra = {}) => ({ plan: { ...corePlan(), home: { x: 0, y: G + H + 1, z: 0 } }, caps: [[0, G + 1, 24]], place: placeBlueprint, ...extra })

console.log('THE PATHS\' OWN EARTHWORK (a leg the strict router misses)')
await t('a raised plaza: strict unreachable; the graded rounds lay a ramp of fill cells, every step +-1, the grade named', async () => {
  const srv = platformWorld()
  const strict = P.sitePaths(srv.read, platformIn({ grade: false }))
  assert.strictEqual(legOf(strict, 'well').ok, false, 'CONTROL: the strict router cannot leave the platform')
  const s = P.sitePaths(srv.read, platformIn())
  assert.ok(s.ok, s.why)
  const w = legOf(s, 'well')
  assert.ok(w.ok && P.PATH_GRADES.includes(w.grade), `graded ${w.grade}`)
  assert.ok(s.record.cells.some(c => c.role === 'fill'), 'fill cells (cobblestone, bottom-up)')
  assert.ok(s.record.maxStep <= 1, `max step ${s.record.maxStep}`)
  // fills bottom-up per column: a fill cell's column has every cell from the ground up to it
  const byCol = new Map()
  for (const c of s.record.cells) { const k = `${c.at[0]},${c.at[2]}`; if (!byCol.has(k)) byCol.set(k, []); byCol.get(k).push(c.at[1]) }
  for (const [k, ys] of byCol) { const lo = Math.min(...ys), hi = Math.max(...ys); assert.strictEqual(ys.length, hi - lo + 1, `column ${k} is contiguous`) }
})
await t('the leg joins the plaza AT the plaza\'s height (within one), never at the foot of its drop (Codex design: no plaza access)', async () => {
  const srv = platformWorld()
  const s = P.sitePaths(srv.read, platformIn())
  const w = legOf(s, 'well')
  const end = w.nodes[w.nodes.length - 1]
  assert.ok(end[2] >= G + H - 1, `joins at level ${end[2]}, the plaza's ground ${G + H}`)
  // CONTROL (the mutant): the hub at any level joins at the foot
  await withMutant(PATHS_PATH, "    const targets = new Map(hubs.map(([x, z]) => [`${x},${z}`, hubLevel ? (hubLevel(x, z) ?? null) : null]))", "    const targets = new Map(hubs.map(([x, z]) => [`${x},${z}`, null]))", async M => {
    const s2 = M.sitePaths(srv.read, platformIn())
    const w2 = s2.net.legs.find(l => l.id === 'well')
    const e2 = w2.nodes.length ? w2.nodes[w2.nodes.length - 1] : null
    assert.ok(w2.ok && (!e2 || e2[2] < G + H - 1), `MUTANT KILLED: joins at ${e2?.[2]} (the foot)`)
  })
})
await t('a graded cut is never beside water (a cut there lets it in); a fill only into air, a plant or leaves', async () => {
  const srv = server()
  const lim = P.pathGradeLim(srv.read, 4)
  srv.set([3, G, 3], 'water')
  assert.strictEqual(lim.cutOk(null, 4, G, 3), false, 'beside water')
  assert.strictEqual(lim.cutOk(null, 10, G, 10), true, 'CONTROL: dry')
  assert.strictEqual(lim.fillOk({ name: 'air', boundingBox: 'empty' }), true)
  assert.strictEqual(lim.fillOk({ name: 'oak_leaves', boundingBox: 'block' }), true)
  assert.strictEqual(lim.fillOk({ name: 'chest', boundingBox: 'block' }), false)
  assert.ok(lim.cut.test('cobblestone') && lim.cut.test('dirt') && !lim.cut.test('oak_planks'), 'the bots\' spoil, never planks')
})
await t('MUTANT KILLED: without the graded rounds the platform\'s well leg stays unrouted', async () => {
  await withMutant(PATHS_PATH, '    routeGraded(read, I, net, dests, o)\n', '\n', async M => {
    const s = M.sitePaths(platformWorld().read, platformIn())
    assert.strictEqual(s.net.legs.find(l => l.id === 'well').ok, false)
  })
})
await t('the graded rounds keep their wall-clock budget: no allowance begun after it (the leg named, the budget noted)', async () => {
  let t0 = 0
  const clock = () => (t0 += 10_000)
  const s = P.sitePaths(platformWorld().read, platformIn({ clock }))
  assert.strictEqual(legOf(s, 'well').ok, false)
  assert.strictEqual(s.net.budget, 4, 'stopped before its first allowance')
})

// ---- scene C: a moat round one destination, another routes -- IN SECTIONS ---------------------------------------------------------
const moatWorld = () => { const srv = server(); for (let x = 30; x <= 42; x++) for (let z = 30; z <= 42; z++) if (Math.max(Math.abs(x - 36), Math.abs(z - 36)) >= 4) srv.set([x, G, z], 'water'); return srv }
const moatIn = (extra = {}) => ({ plan: corePlan(), caps: [[0, G + 1, 24]], composter: [36, G + 1, 36], place: placeBlueprint, ...extra })

console.log('IN SECTIONS (one unroutable leg never leaves the town without a path)')
await t('the farm behind a moat is PENDING, the well\'s leg is laid; CONTROL fix false: no record at all', async () => {
  const srv = moatWorld()
  const off = P.sitePaths(srv.read, moatIn({ fix: false }))
  assert.strictEqual(off.ok, false); assert.match(off.why, /farm:unreachable/)
  const s = P.sitePaths(srv.read, moatIn())
  assert.ok(s.ok, s.why); assert.match(s.why, /^sections:farm:unreachable/)
  assert.deepStrictEqual(s.record.pending, ['farm'])
  assert.strictEqual(s.missed, 1)
  assert.ok(s.record.cells.length > 0 && legOf(s, 'well').ok)
  assert.strictEqual(s.record.structure_complete, false)
  assert.strictEqual(P.pathsSiteStop(s), null)
})
await t('a pending destination is a new destination for the extension (newDests); a failed OPTIONAL leg is not, as before', async () => {
  const srv = moatWorld()
  const s = P.sitePaths(srv.read, moatIn())
  const D = P.pathDests(moatIn())
  assert.deepStrictEqual(P.newDests(s.record, D.dests).map(d => d.to), ['farm'])
  const rec2 = { ...s.record, legs: [...s.record.legs, { id: 'chest1', to: 'chest:1,2,3', ok: false, why: 'unreachable' }] }
  assert.deepStrictEqual(P.newDests(rec2, [...D.dests, { id: 'chest1', to: 'chest:1,2,3', cols: [[50, 50]], optional: true }]).map(d => d.to), ['farm'])
  assert.deepStrictEqual(P.newDests({ ...s.record, pending: [] }, D.dests).map(d => d.to), [], 'CONTROL: not pending -> served (as before)')
})
await t('the moat drained: the extension lays the pending leg, joined to the network, and it leaves the pending list', async () => {
  const srv = moatWorld()
  const s = P.sitePaths(srv.read, moatIn())
  for (let x = 30; x <= 42; x++) for (let z = 30; z <= 42; z++) srv.set([x, G, z], 'grass_block')
  const x = P.extendPaths(srv.read, { ...s.record, structure_complete: true }, moatIn())
  assert.ok(x.ok, x.why)
  assert.ok(x.added.some(id => /^farm/.test(id)))
  assert.deepStrictEqual(x.record.pending, [])
  assert.strictEqual(x.record.structure_complete, false, 'reopened to build it')
})
await t('the extension\'s skipTo leaves out what the caller is not asking for now (its unrouted memo)', async () => {
  const s = P.sitePaths(moatWorld().read, moatIn())
  const x = P.extendPaths(moatWorld().read, s.record, moatIn({ skipTo: to => to === 'farm' }))
  assert.strictEqual(x.why, 'nothing_new')
})
await t('MUTANT KILLED: all-or-nothing again -> the moat leaves the town without a path', async () => {
  await withMutant(PATHS_PATH, 'const sections = fix && missed.length > 0 && net.legs.some(l => l.ok && l.nodes.length)', 'const sections = false', async M => {
    const s = M.sitePaths(moatWorld().read, moatIn())
    assert.strictEqual(s.ok, false)
  })
})
await t('the tidy grades a network laid in sections (its strict check reads `missed`, not ok)', async () => {
  const srv = platformWorld()
  srv.set([0, G, 30], 'water')   // nothing; the grading reads the paths' own answer
  const pin = { ...platformIn(), plan: { ...platformIn().plan } }
  const g = TIDY.gradeTidy(srv.read, pin)
  // the paths route here (graded), nothing missed: the grading has nothing to add
  assert.strictEqual(g.why, 'paths_route')
  const pinM = moatIn()
  const g2 = TIDY.gradeTidy(moatWorld().read, pinM)
  assert.notStrictEqual(g2.why, 'paths_route', 'a pending leg keeps the grading on')
})

console.log('UNSITED IS NOT DONE')
await t('pathsNoSite (fix): NOT complete, no cells, asked again after 6 h; the order reads it settled (pathsSettled)', async () => {
  const now = 1_000_000
  const r = P.pathsNoSite({ home: { x: 1, y: 70, z: 2 }, now, by: 'A', why: 'unrouted:shop:unreachable', fix: true })
  assert.deepStrictEqual([r.state, r.structure_complete, r.cells.length], ['no_site', false, 0])
  assert.strictEqual(P.pathsNoSiteRec(r), true)
  assert.strictEqual(P.pathsSettled(r), true)
  assert.strictEqual(P.pathsDue(r, now + P.PATHS_UNSITED_RETRY_MS - 1), false)
  assert.strictEqual(P.pathsDue(r, now + P.PATHS_UNSITED_RETRY_MS), true)
  assert.strictEqual(P.pathsSettled({ blueprint: P.PATHS_BLUEPRINT, state: 'open', structure_complete: false, cells: [{}] }), false, 'an open laid record is not settled')
  assert.strictEqual(P.pathsNoSite({ now, fix: false }).structure_complete, true, 'PATHSFIX=off: complete, as before')
})
await t('COMPOSED (the order): a DUE unsited paths record is visited before an open monument; not due, the monument (shopActive\'s states)', async () => {
  const list = SHOPM.projectsOn(true, true, true, true, true, false)
  const now = 10 * 60 * 60_000
  const r = P.pathsNoSite({ home: { x: 0, y: 70, z: 0 }, now: 0, fix: true })
  const st = rec => [{ plot: 'shop', exists: true, complete: true }, { plot: 'shaft', exists: true, complete: true }, { plot: 'house1', exists: true, complete: true },
    { plot: 'monument', exists: true, complete: false, free: true }, { plot: 'paths', exists: true, complete: P.pathsSettled(rec), damaged: P.pathsDue(rec, now) }]
  assert.strictEqual(SHOPM.activeProject(st(r), list).plot, 'paths', 'due: first (one cheap siting a retry window)')
  const r2 = P.pathsNoSite({ home: { x: 0, y: 70, z: 0 }, now, fix: true })
  assert.strictEqual(SHOPM.activeProject(st(r2), list).plot, 'monument', 'CONTROL: not due -> the open project')
  // the wall (after the paths) is not blocked by an unsited record
  const st3 = [...st(r2).filter(q => q.plot !== 'monument'), { plot: 'monument', exists: true, complete: true }]
  assert.strictEqual(SHOPM.activeProject(st3, list).plot, 'wall')
})
await t('pathsUnroutedDue: a Map memo re-asks after 6 h; the old Set and PATHSFIX=off never; an unknown destination is due', async () => {
  const m = new Map()
  assert.strictEqual(P.pathsUnroutedDue(m, 'farm', 0, true), true)
  P.pathsUnroutedNote(m, 'farm', 1000)
  assert.strictEqual(P.pathsUnroutedDue(m, 'farm', 1000 + P.PATHS_UNSITED_RETRY_MS - 1, true), false)
  assert.strictEqual(P.pathsUnroutedDue(m, 'farm', 1000 + P.PATHS_UNSITED_RETRY_MS, true), true)
  assert.strictEqual(P.pathsUnroutedDue(m, 'farm', 1000 + P.PATHS_UNSITED_RETRY_MS, false), false, 'off: as before')
  assert.strictEqual(P.pathsUnroutedDue(new Set(['farm']), 'farm', 1e12, true), false)
})
await t('the switch: PATHSFIX=off|0|false|no is the rollback; unset is on', async () => {
  assert.strictEqual(P.pathsFixOn({}), true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(P.pathsFixOn({ PATHSFIX: v }), false, v)
})
/** routeLeg as it was before pathsfix-01 (string state keys), verbatim but for the name: the equivalence's reference. */
function routeLegStrings (grid, sources, targets, { discount = () => false, maxPops = 600_000 } = {}) {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], COST = P.COST
  const heap = []
  const less = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]
  const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p]) >= 0) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p } }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m]) < 0) m = l; if (r < heap.length && less(heap[r], heap[m]) < 0) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m } }
    return top
  }
  const best = new Map(), prev = new Map()
  const sk = (x, z, d, s) => `${x},${z},${d},${s}`
  for (const [x, z] of [...sources].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    for (const s of grid.levels(x, z)) { const c0 = grid.cost(x, z, s); const k = sk(x, z, 4, s); if (c0 < (best.get(k) ?? Infinity)) { best.set(k, c0); push([c0, x, z, 4, s]) } }
  }
  let pops = 0
  while (heap.length && pops++ < maxPops) {
    const [c, x, z, d, s] = pop()
    if (c > (best.get(sk(x, z, d, s)) ?? Infinity)) continue
    const tk = `${x},${z}`
    if (targets.has(tk) && (targets.get(tk) == null || Math.abs(targets.get(tk) - s) <= 1)) {
      const nodes = [[x, z, s]]
      let k = sk(x, z, d, s)
      while (prev.has(k)) { k = prev.get(k); const [px, pz, , ps] = k.split(',').map(Number); nodes.push([px, pz, ps]) }
      return { ok: true, nodes: nodes.reverse(), cost: c, why: 'ok' }
    }
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DIRS[nd][0], nz = z + DIRS[nd][1]
      for (const ns of grid.levels(nx, nz)) {
        if (Math.abs(ns - s) > 1) continue
        const disc = discount(nx, nz) ? COST.planSeg : 1
        const nc = c + disc * (COST.step + grid.cost(nx, nz, ns)) + COST.rise * Math.abs(ns - s) + (d !== 4 && d !== nd ? COST.turn : 0)
        const k = sk(nx, nz, nd, ns)
        if (nc < (best.get(k) ?? Infinity)) { best.set(k, nc); prev.set(k, sk(x, z, d, s)); push([nc, nx, nz, nd, ns]) }
      }
    }
  }
  return { ok: false, nodes: [], cost: Infinity, why: pops >= maxPops ? 'search_bound' : 'unreachable' }
}
await t('routeLeg\'s numeric state keys: the same nodes and cost as the string-keyed original, on flat, raised (graded) and negative ground', async () => {
  const scenes = [[server(), null, [[-20, 20]]], [platformWorld(), 6, [[-1, 24]]], [moatWorld(), null, [[-30, -30]]]]
  for (const [srv, n, src] of scenes) {
    const grid = P.pathGrid((x, z) => P.pathColumn(srv.read, x, z, { yHi: G + 12, yLo: G - 12 }), () => null, [-56, -56, 56, 56], srv.read, n ? P.pathGradeLim(srv.read, n) : null)
    const targets = new Map(P.hubBrushes(CORE).map(([x, z]) => [`${x},${z}`, null]))
    const a = P.routeLeg(grid, src, targets), b = routeLegStrings(grid, src, targets)
    assert.deepStrictEqual([a.ok, a.cost, a.nodes], [b.ok, b.cost, b.nodes])
    assert.ok(a.ok, 'a route exists in each scene')
  }
})

console.log('THE WIRING (structural: skills.mjs, comments stripped)')
const code = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
await t('shopActive: an unsited paths record is settled, and its due retry a repair; the extension asks the timed memo', async () => {
  assert.match(code, /const fixNoSite = p\.plot === PATHS_PLOT && pathsFixOn\(\) && pathsNoSiteRec\(rec\)/)
  assert.match(code, /const complete = fixNoSite \? pathsSettled\(rec\) : !!rec\?\.structure_complete/)
  assert.match(code, /\(fixNoSite \? pathsDue\(rec, now\) : recordDamaged\(b, rec, \{ tidy: tidyFirst \}\)\)/)
  assert.match(code, /return newDests\(rec, D\.dests \?\? \[\]\)\.some\(d => pathsUnroutedDue\(bot\.pathsUnrouted, d\.to\)\)/)
  assert.match(code, /pathsUnroutedNote\(\(bot\.pathsUnrouted \?\?= new Map\(\)\), t\)/)
  assert.match(code, /skipTo: to => !pathsUnroutedDue\(bot\.pathsUnrouted, to\)/)
})
await t('buildPaths: an unsited record whose retry met unread ground is stamped again (PATHS_UNREAD_RETRY_MS); the tidy pins a pending network', async () => {
  assert.match(code, /if \(stop === 'site_unread' && pathsFixOn\(\) && rh\.head && pathsNoSiteRec\(rh\.head\.rec\)\) \{/)
  assert.match(code, /retryAt: Date\.now\(\) \+ PATHS_UNREAD_RETRY_MS/)
  assert.match(code, /pathsNoSiteRec\(pathsRec\) \|\| \(pathsFixOn\(\) && \(pathsRec\.pending \?\? \[\]\)\.length > 0\)/)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
