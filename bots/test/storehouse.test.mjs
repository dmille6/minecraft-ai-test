// STOREHOUSE-01: THE TOWN STOREHOUSE (bots/src/storehouse.mjs), pure and on the fake server: the switch; the plot it needs (a ring@1
// storehouse plot, never an annex); the blueprint (walls two high round the 7x7, a side doorway at the first gap cell, eaves and roof,
// three wall torches, a corner step); the siting around the containers already placed (litter in the wall line and the interior
// listed as clears, a free container cell's dirt cleared, a placed chest never touched, a container or a furnace in a wall cell
// refusing); the proof and the record BUILT END TO END by buildrun.mjs runVisit with fake builders -- every chest still there, the
// cell above each chest open (a lid needs it), every stand and the doorway open; the tidy of a finished storehouse; the paths'
// leg to its doorway through the plan plot's refusal (frontOpen); the project's place in shop.mjs's order; the wiring in
// skills.mjs. Mutants assert their anchors present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, B, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const H = await import('../src/storehouse.mjs')
const TP = await import('../src/townplan.mjs')
const SHOP = await import('../src/shop.mjs')
const P = await import('../src/paths.mjs')

const SH_PATH = new URL('../src/storehouse.mjs', import.meta.url)
const PATHS_PATH = new URL('../src/paths.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A mutant of a module (anchor present and unique: CLAUDE.md), imported from the test directory. */
async function withMutant (old, neu, fn, file = SH_PATH) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (old, neu, scenario, file = SH_PATH, real = H) => {
  await scenario(real)
  let k = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { k = true } }, file)
  assert.ok(k, 'the mutant survived')
}
const k3 = a => a.join(',')

/** A greenfield ring@1 plan at HOME (s = G) in orientation `o`: the store plot with its 7 chest cells, `placed` of them placed. */
function planOf (o = 'E', { placed = 6, workSide = 1, kind = 'storehouse' } = {}) {
  const g = TP.ring1(HOME, G, o, workSide)
  const cells = g.cells.map((c, i) => ({ at: c.at, kind: 'chest', stand: c.stand, role: i === 0 ? 'overflow' : 'home', group: null, state: i < placed ? 'placed' : 'free', ready: true }))
  return {
    v: 1, template: 'ring@1', gen: 7, home: HOME, s: G, mode: 'greenfield', orientation: o, workSide,
    plots: [{ id: 'core', kind: 'plaza', box: g.core, y: G, state: 'planned', keepout: true },
      { id: 'store', kind, box: g.storeBox, y: G, door: g.door, state: 'planned', keepout: true, cells },
      { id: 'work', kind: 'workshop', box: g.workBox, y: G, state: 'planned', keepout: true, stations: [] }],
    paths: [], groups: {},
  }
}
/** The fake world with the plan's placed chests standing. */
function worldOf (plan, extra = {}) {
  const cells = { ...extra }
  for (const c of plan.plots.find(p => p.id === 'store').cells) if (c.state === 'placed') cells[k3(c.at)] = 'chest'
  return server(cells)
}
const W = (plan, u, v, y) => { const { dx, dz } = TP.rot(plan.orientation, u, v); return [HOME.x + dx, G + y, HOME.z + dz] }
/** Site and prove -> the record (asserting both). */
function recordOf (srv, plan, stood = []) {
  const st = H.storeSite(srv.read, plan, {})
  assert.ok(st.ok, `site: ${st.why} ${st.detail ?? ''}`)
  const dom = (x, z) => true
  const p = B.proveSite(srv.read, plan.home, st.bp, st.site, { stood, domain: dom })
  assert.ok(p.ok, `proof: ${p.why} ${p.detail ?? ''}`)
  return { st, rec: H.storeRecord(st, p, { plan }) }
}
async function buildOut (srv, rec, dir, key, gen, bots, rounds = 30, tidy = null) {
  const stops = {}
  const done = () => rec.cells.every(c => R.cellDone(srv.read(...c.at), H.STORE_PALETTE, c.role))
  for (let round = 0; round < rounds && (!done() || (tidy && tidy().length)); round++) {
    for (const [n, b] of Object.entries(bots)) {
      const slot = PJ.takeSlot(dir, key, n, H.STORE_BUILDERS)
      if (!slot.ok) continue
      const v = await R.runVisit({ dir, key, me: n, home: HOME, stood: [], record: rec, recordGen: gen, palette: H.STORE_PALETTE, slot: slot.slot, slotGen: slot.gen,
        domain: H.storeDomain(rec), tidy: tidy ? tidy() : undefined, stands: (b.stands ??= { pending: null, bans: {} }) }, b, { maxSteps: 300 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, n, slot.gen)
      stops[v.stop] = (stops[v.stop] ?? 0) + 1
    }
  }
  return { stops, done: done() }
}
const KIT = () => ({ stone_bricks: 60, oak_planks: 60, glass_pane: 8, cut_copper: 10, torch: 4, cobblestone: 16 })
const rowsOf = bots => Object.values(bots).flatMap(b => b.logs).filter(([k]) => k === '_build').map(([, d]) => d)

await t('the switch: STOREHOUSE on/off, else only the pools STOREHOUSE_POOLS names (default showcase)', async () => {
  assert.strictEqual(H.storehouseOn({}, 'showcase'), true)
  assert.strictEqual(H.storehouseOn({}, 'hive-a'), false)
  assert.strictEqual(H.storehouseOn({ STOREHOUSE: 'off' }, 'showcase'), false)
  assert.strictEqual(H.storehouseOn({ STOREHOUSE: 'on' }, 'hive-a'), true)
  assert.strictEqual(H.storehouseOn({ STOREHOUSE_POOLS: 'hive-a,hive-b' }, 'hive-b'), true)
})
await t('the blueprint: 46 wall cells (doorway open), 49 roof cells, 3 torches, the steps; the door in the side wall away from the workshop', async () => {
  const bp = H.storeBlueprint(-1, [1])
  const by = bp.cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
  assert.deepStrictEqual(by, { corner: 8, base: 19, upper: 14, window: 5, eave: 24, roof: 25, step: 1, light: 3 })
  assert.ok(!bp.cells.some(c => c.u === 10 && c.v === -3 && c.y <= 2), 'the doorway is open')
  assert.ok(bp.cells.some(c => c.u === 10 && c.v === 3 && c.y === 2 && c.role === 'window'), 'a window opposite the door')
  // never a cell in a container cell, the cell above one, or a stand
  const per = new Set([[9, -2], [11, -2], [13, -2], [13, 0], [13, 2], [11, 2], [9, 2]].map(([u, v]) => `${u},${v}`))
  for (const c of bp.cells) assert.ok(!(per.has(`${c.u},${c.v}`) && c.y <= 2), `a record cell on a chest column ${c.u},${c.v},${c.y}`)
  const p = planOf('E')
  assert.strictEqual(H.storePlot(p).side, 1)
  assert.deepStrictEqual(H.storeBlueprint(1, [1]).doorway[0], [10, 3, 1])
})
await t('the plot: only a ring@1 storehouse plot where ring1 puts it (an annex, a cluster, a moved box: no storehouse)', async () => {
  assert.ok(H.storePlot(planOf('W')).ok)
  assert.strictEqual(H.storePlot(planOf('W', { kind: 'annex' })).why, 'store_annex')
  const moved = planOf('W'); moved.plots[1].box = moved.plots[1].box.map(v => v + 1)
  assert.strictEqual(H.storePlot(moved).why, 'store_shape')
  assert.strictEqual(H.storePlot({ ...planOf('W'), plots: [] }).why, 'no_store_plot')
})
await t('the siting: litter in the wall line and the interior cleared, a free cell\'s dirt cleared, placed chests never listed; a chest or furnace in the way refuses', async () => {
  for (const o of ['E', 'S', 'W', 'N']) {
    const plan = planOf(o)
    const extra = {}
    extra[k3(W(plan, 11, 0, 1))] = 'crafting_table'     // a table in a stand
    extra[k3(W(plan, 8, 1, 1))] = 'dirt'                // a pillar in the plaza wall's line...
    extra[k3(W(plan, 8, 1, 2))] = 'dirt'
    extra[k3(W(plan, 8, 1, 3))] = 'dirt'                // ...through the eave
    extra[k3(W(plan, 8, 1, 4))] = 'dirt'                // ...and above the roof
    const free = plan.plots[1].cells.find(c => c.state === 'free')
    extra[k3(free.at)] = 'dirt'                         // the free chest cell
    const srv = worldOf(plan, extra)
    const st = H.storeSite(srv.read, plan, {})
    assert.ok(st.ok, `${o}: ${st.why} ${st.detail ?? ''}`)
    const listed = new Set(st.site.clear.map(c => k3(c.at)))
    for (const k of Object.keys(extra)) assert.ok(listed.has(k), `${o}: ${k} listed`)
    for (const c of plan.plots[1].cells.filter(q => q.state === 'placed')) assert.ok(!listed.has(k3(c.at)), `${o}: a placed chest is never cleared`)
    // a furnace in a stand, a chest in the wall line: refused
    const f2 = worldOf(plan, { [k3(W(plan, 11, 0, 1))]: 'furnace' })
    assert.strictEqual(H.storeSite(f2.read, plan, {}).why, 'interior_blocked')
    const c2 = worldOf(plan, { [k3(W(plan, 14, 0, 1))]: 'chest' })
    assert.strictEqual(H.storeSite(c2.read, plan, {}).why, 'cell_not_free')
  }
})
await t('MUTANT KILLED: a siting that does not leave the placed containers alone refuses its own town (a chest is no litter)', async () => {
  await killed("    if (pc && pc.state !== 'free') continue\n", '', async M => {
    const plan = planOf('W')
    const srv = worldOf(plan)
    const st = M.storeSite(srv.read, plan, {})
    assert.ok(st.ok, st.why)
  })
})
await t('BUILT END TO END: walls, eaves, roof, torches -- chests untouched, the cells above them and every stand and the doorway open; every placement and clear on the record', async () => {
  for (const o of ['W', 'N']) {
    const plan = planOf(o)
    const extra = { [k3(W(plan, 11, 0, 1))]: 'crafting_table', [k3(W(plan, 8, 1, 1))]: 'dirt', [k3(W(plan, 8, 1, 2))]: 'dirt' }
    const srv = worldOf(plan, extra)
    const { rec } = recordOf(srv, plan)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'))
    const key = PJ.projKey(HOME, H.STORE_PLOT)
    const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
    const bots = { A: bot(srv, 'A', { inv: KIT(), feet: [0, G + 1, 0] }), B: bot(srv, 'B', { inv: KIT(), feet: [1, G + 1, 1] }) }
    const r1 = await buildOut(srv, rec, dir, key, pub.gen, bots)
    assert.ok(r1.done, `${o}: open after the rounds: ${JSON.stringify(r1.stops)}`)
    for (const c of plan.plots[1].cells.filter(q => q.state === 'placed')) {
      assert.strictEqual(srv.read(...c.at).name, 'chest', `${o}: chest ${c.at}`)
      assert.strictEqual(srv.read(c.at[0], c.at[1] + 1, c.at[2]).name, 'air', `${o}: the lid cell above ${c.at}`)
      assert.ok(srv.read(...c.stand).boundingBox === 'empty' && srv.read(c.stand[0], c.stand[1] + 1, c.stand[2]).boundingBox === 'empty', `${o}: the stand ${c.stand}`)
    }
    const door = rec.door
    assert.strictEqual(srv.read(...door).name, 'air'); assert.strictEqual(srv.read(door[0], door[1] + 1, door[2]).name, 'air')
    // the interior reachable from town through the doorway (the finished world)
    const walk = B.walkFrom(srv.read, HOME, new Set(), 48, { stood: [] })
    for (const c of plan.plots[1].cells.filter(q => q.state === 'placed')) assert.ok(walk.has(k3(c.stand)), `${o}: stand ${c.stand} walked to through the door`)
    const recKeys = new Set(rec.cells.map(c => k3(c.at))), clearKeys = new Set(rec.clear.map(c => k3(c.at)))
    for (const d of rowsOf(bots).filter(d => d.op === 'place')) assert.ok(recKeys.has(d.cell.join(',')), `G1 off_record ${d.cell} ${d.block}`)
    for (const d of rowsOf(bots).filter(d => d.op === 'clear')) assert.ok(d.kind === 'foreign' ? recKeys.has(d.cell.join(',')) : clearKeys.has(d.cell.join(',')), `G2 clear_outside ${d.cell}`)
    // B5: enclosed (no wall gap but the doorway), a roof, a light inside
    assert.ok(rec.cells.filter(c => c.role === 'light').every(c => /torch/.test(srv.read(...c.at).name)))
    // THE TIDY: an idle crafting table set in a stand afterwards is the finished storehouse's tidy, and goes
    const stand = plan.plots[1].cells[0].stand
    srv.set(stand, 'crafting_table')
    const tries = new Map()
    assert.deepStrictEqual(H.storeTidy(rec, srv.read, tries).map(c => k3(c.at)), [k3(stand)])
    const r2 = await buildOut(srv, rec, dir, key, pub.gen, bots, 3, () => H.storeTidy(rec, srv.read, tries))
    assert.strictEqual(srv.read(...stand).name, 'air', `${o}: the table tidied ${JSON.stringify(r2.stops)}`)
    // bounded: a cell offered STORE_TIDY_TRIES times is not asked again by this bot
    srv.set(stand, 'crafting_table'); tries.set(k3(stand), H.STORE_TIDY_TRIES)
    assert.deepStrictEqual(H.storeTidy(rec, srv.read, tries), [])
    assert.deepStrictEqual(H.storeTidy({ ...rec, blueprint: 'house@1' }, srv.read), [], 'only a storehouse record')
    // r4 (LIVE 11-01): leaves grown into the doorway's approach at head height are the tidy's too (the interior's only way in)
    const ap = H.storeApproach(rec)
    assert.strictEqual(ap.length, 2 + 3 * 3, 'the doorway (2) + the 3 front columns beside the door, 3 high')
    const head = [rec.front[0][0], rec.door[1] + 1, rec.front[0][1]]
    assert.ok(ap.some(a => k3(a) === k3(head)))
    srv.set(head, 'spruce_leaves'); srv.set([rec.front[0][0], rec.door[1], rec.front[0][1]], 'spruce_log')
    const tl = H.storeTidy(rec, srv.read, new Map())
    assert.ok(tl.some(c => k3(c.at) === k3(head) && c.name === 'spruce_leaves'), 'the leaves at the door are tidied')
    assert.ok(!tl.some(c => c.name === 'spruce_log'), 'never a log (the tree stays)')
    const r3 = await buildOut(srv, rec, dir, key, pub.gen, bots, 2, () => H.storeTidy(rec, srv.read, new Map()))
    assert.strictEqual(srv.read(...head).name, 'air', `${o}: the doorway's head room cleared ${JSON.stringify(r3.stops)}`)
    srv.set([rec.front[0][0], rec.door[1], rec.front[0][1]], 'air')
    for (const at of ap) assert.ok(at[0] >= rec.box[0] - 1 && at[0] <= rec.box[2] + 1 && at[2] >= rec.box[1] - 1 && at[2] <= rec.box[3] + 1 && at[1] >= rec.baseY && at[1] <= Math.max(...rec.cells.map(c => c.at[1])) + 2, `approach cell ${at} in the read's tidy space`)
    // the showcase read judges a tidy dig inside its record's box + 1, from baseY to the top + 2 (shopread tidy_ok)
    const top = Math.max(...rec.cells.map(c => c.at[1]))
    for (const at of rec.inside) assert.ok(at[0] >= rec.box[0] - 1 && at[0] <= rec.box[2] + 1 && at[2] >= rec.box[1] - 1 && at[2] <= rec.box[3] + 1 && at[1] >= rec.baseY && at[1] <= top + 2, `inside cell ${at} in the read's tidy space`)
  }
})
await t('MUTANT KILLED: a tidy that does not see a crafting table as litter leaves it in a chest\'s stand', async () => {
  await killed('export const storeLitter = n => FOREIGN_CLEAR.test(String(n ?? \'\')) || STATION_CLEAR.test(String(n ?? \'\'))', 'export const storeLitter = n => FOREIGN_CLEAR.test(String(n ?? \'\'))', async M => {
    const plan = planOf('W')
    const srv = worldOf(plan, { [k3(W(plan, 11, 0, 1))]: 'crafting_table' })
    const st = M.storeSite(srv.read, plan, {})
    assert.ok(st.ok && st.site.clear.some(c => c.name === 'crafting_table'), `${st.why}`)
  })
})
await t('THE PATHS reach the doorway: its front columns pass the plan plot\'s refusal (frontOpen), nothing else does', async () => {
  const plan = planOf('W')
  const srv = worldOf(plan)
  const { rec } = recordOf(srv, plan)
  assert.strictEqual(rec.front.length, 1)
  const [fx, fz] = rec.front[0]
  const without = P.pathAvoid({ plan, records: [] })
  const withRec = P.pathAvoid({ plan, records: [rec] })
  assert.ok(without(fx, fz), 'the front column is inside the plan plot')
  assert.strictEqual(withRec(fx, fz), null, 'the record opens it')
  for (const [x, z] of rec.frontOpen) assert.strictEqual(withRec(x, z), null)
  const inside = W(plan, 11, 0, 0)
  assert.ok(withRec(inside[0], inside[2]), 'the storehouse\'s own columns stay refused')
  // the destination: the record's front (pathDests' explicit `front`), once the storehouse stands
  const D = P.pathDests({ plan, projects: [{ plot: H.STORE_PLOT, rec: { ...rec, structure_complete: true }, bp: null }], place: B.placeBlueprint })
  assert.ok(D.dests.some(d => d.to === H.STORE_PLOT && d.cols[0][0] === fx && d.cols[0][1] === fz))
})
await t('MUTANT KILLED: without the frontOpen exemption the doorway\'s front is refused (its leg unroutable)', async () => {
  const plan = planOf('W')
  const srv = worldOf(plan)
  const { rec } = recordOf(srv, plan)
  await killed("    if (plots.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) && !open.has(`${x},${z}`)) return 'plan_plot'", "    if (plots.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])) return 'plan_plot'", async M => {
    assert.strictEqual(M.pathAvoid({ plan, records: [rec] })(rec.front[0][0], rec.front[0][1]), null)
  }, PATHS_PATH, P)
})
await t('the project: seventh, after the workshop, two builders; projectsOn takes it only with its switch and the house\'s', async () => {
  const p = SHOP.PROJECTS.find(q => q.plot === H.STORE_PLOT)
  assert.ok(p && p.after === 'shop' && p.blueprint === H.STORE_BLUEPRINT && SHOP.buildersOf(p) === 2)
  assert.strictEqual(SHOP.PROJECTS.at(-1).plot, H.STORE_PLOT, 'last: the workshop stays PROJECTS[0] (skills.mjs workshopStations reads hs[0])')
  assert.ok(SHOP.projectsOn(true, true, true, true, false, true, true).some(q => q.plot === H.STORE_PLOT))
  assert.ok(!SHOP.projectsOn(true, true, true, true, false, true, false).some(q => q.plot === H.STORE_PLOT))
  assert.ok(!SHOP.projectsOn(false, true, true, true, false, true, true).some(q => q.plot === H.STORE_PLOT))
  // everything else complete: the storehouse is the active project
  const st = SHOP.projectsOn(true, true, true, true, false, true, true).map(q => ({ plot: q.plot, exists: true, complete: q.plot !== H.STORE_PLOT, damaged: false }))
  assert.strictEqual(SHOP.activeProject(st, SHOP.projectsOn(true, true, true, true, false, true, true)).plot, H.STORE_PLOT)
})
await t('r4: a storehouse\'s stuck stamp holds 30 min (the stair\'s), not the 6 h of a workshop', async () => {
  assert.strictEqual(SHOP.stuckWindowOf(H.STORE_PLOT), SHOP.SHAFT_STUCK_RETRY_MS)
  assert.strictEqual(SHOP.stuckWindowOf('house1'), SHOP.SHOP_STUCK_RETRY_MS)
})
await t('THE STEP FENCE (LIVE 11-01): a builder\'s walk routes around the segment\'s open cells (101 on a feet/head cell in them), only during the walk, never on the shared array', async () => {
  const BB = await import('../src/buildbot.mjs')
  const avoid = new Set(['-14,71,0'])
  const f = BB.stepFence(avoid)
  assert.strictEqual(f({ position: { x: -14, y: 71, z: 0 } }), 101)
  assert.ok(BB.STEP_FENCE_COST > 100, 'over the pathfinder\'s 100 cut: the move is dropped')
  assert.strictEqual(f({ position: { x: -15, y: 71, z: 0 } }), 0)
  assert.strictEqual(BB.stepFence(new Set()), null)
  const shared = [() => 0]
  const mv = { exclusionAreasStep: shared }, clone = { exclusionAreasStep: shared }
  let inside = null
  await BB.withStepFence(mv, avoid, async () => { inside = mv.exclusionAreasStep.reduce((t, g) => t + g({ position: { x: -14, y: 71, z: 0 } }), 0) })
  assert.strictEqual(inside, 101, 'priced during the walk')
  assert.strictEqual(mv.exclusionAreasStep, shared, 'the old array back after')
  assert.strictEqual(clone.exclusionAreasStep.length, 1, 'the other profiles sharing the array untouched')
  await assert.rejects(BB.withStepFence(mv, avoid, async () => { throw new Error('walk failed') }))
  assert.strictEqual(mv.exclusionAreasStep, shared, 'restored on a throw too')
  const src = readFileSync(new URL('../src/buildbot.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(src.includes('await withWalk(() => withStepFence(bot.pathfinder?.movements, avoid, () => Promise.race(['), 'walkTo walks inside the fence, the whole race (its clock too)')
  // Codex r3 BLOCK: a cleanup that runs after another walk replaced the array takes its own fence out by identity
  const later = { exclusionAreasStep: shared }
  let release
  const slow = BB.withStepFence(later, avoid, () => new Promise(r => { release = r }))
  const fenced = later.exclusionAreasStep
  later.exclusionAreasStep = [...fenced, () => 0]      // another walk's own array, built on the fenced one
  release(); await slow
  assert.strictEqual(later.exclusionAreasStep.reduce((t, g) => t + g({ position: { x: -14, y: 71, z: 0 } }), 0), 0, 'no fence left behind')
})
await t('WIRED (skills.mjs, comments stripped): the storehouse site, its palette, its stand domain and tidy, its due', async () => {
  const src = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(/if \(plot === STORE_PLOT\) \{\s*const ss = storeSiteFor\(/.test(src), 'buildShop sites the storehouse on its plot')
  assert.ok(src.includes('id === STORE_BLUEPRINT ? { id, palette: STORE_PALETTE }'), 'blueprintOf knows the palette')
  assert.ok(/rec\.blueprint === STORE_BLUEPRINT \? \{ domain: storeDomain\(rec\), tidy: storeTidy\(/.test(src), 'the visit gets the domain and the tidy')
  assert.ok(src.includes('...placedBy, ...storeOpts }') || src.includes('placedBy, ...storeOpts }'), 'passed to runVisit')
  assert.ok(src.includes('if (tidy && r.blueprint === STORE_BLUEPRINT && storeTidy(r, read, bot.storeTidyTries ?? null).length) return true'), 'due on litter')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
