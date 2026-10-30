// VOIDFILL-01 (OWNER 10-30, "with the ziggurat, lets do 3"): A SEALED VOID IN A PROJECT RECORD IS REPAIRED FROM INSIDE.
// The showcase ziggurat, 10-30: an escape's shaft through the core (-34..-33, y67..70, z -33), sealed by the repair of the skin
// cells it left by, 7 open record cells under a solid cap (y71..74), no stand sees a face: stuck_on_cell for good.
//   1. the plan on THAT geometry (the record's cells and a read-only RCON scan of the world, test/fixtures), and its refusals;
//   2. the plan's invariants replayed step by step (the bot's own way out above it at every step; every opened cell re-placed);
//   3. the visit on the fake server: deferred, deferred, then the access fills the void and the record reads complete.
import assert from 'node:assert'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const V = await import('../src/voidfill.mjs')
const Z = await import('../src/ziggurat.mjs')
const { R, PJ, withMutant, G, HOME, server, bot, project } = await import('./helpers/buildfake.mjs')
const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')

// ---- the showcase geometry --------------------------------------------------------------------------------------------------
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/voidfill-showcase-ziggurat-1030.json', import.meta.url), 'utf8'))
const box = n => mc.blocksByName[n]?.boundingBox ?? 'block'
const readOf = (over = {}) => (x, y, z) => { const n = over[`${x},${y},${z}`] ?? FX.world[`${x},${y},${z}`]; return !n || n === '?' ? null : { name: n, boundingBox: box(n) } }
const REC = Z.zigSplitFoundation({ ...FX.record, cells: FX.cells })
const zigDone = (c, r) => R.cellDone(r(...c.at), Z.ZIG_PALETTE, c.role) || Z.zigHidden(c, r)
const plainDone = (c, r) => R.cellDone(r(...c.at), Z.ZIG_PALETTE, c.role)
const blockOf = role => R.blockFor(Z.ZIG_PALETTE, role, n => n === 'cobblestone')
// the walk's nodes over the scan: a full floor, feet and head clear (the visit's walkFrom is stricter: reachable from town)
const nodesOf = read => {
  const m = new Map(), [x0, x1, y0, y1, z0, z1] = FX.region
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0 + 1; y < y1; y++) {
    const f = read(x, y - 1, z), a = read(x, y, z), h = read(x, y + 1, z)
    if (f?.boundingBox === 'block' && a?.boundingBox === 'empty' && h?.boundingBox === 'empty') { const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  }
  return m
}
const SHAFT = ['-34,67,-33', '-34,68,-33', '-33,67,-33', '-34,69,-33', '-33,69,-33', '-34,70,-33', '-33,70,-33']
const STUCK = ['-34,67,-33', '-33,67,-33']
const planFor = ({ read = readOf(), isDone = zigDone, mayDig, nodes } = {}) => V.planVoidAccess({ read, record: REC, stuck: STUCK, nodes: nodes ?? nodesOf(read), isDone, blockOf, ...(mayDig ? { mayDig } : {}) })

/** Replay a plan's steps over a simulated world: every step's preconditions, and the bot's way out above it at each one. */
function replay (plan, read, isDone) {
  const W = V.simWorld(read)
  const [x, T, z] = plan.top
  let f = T
  const exitOpen = () => { for (let y = f; y <= T + 1; y++) if (W(x, y, z)?.boundingBox !== 'empty') return false; return true }
  for (const s of plan.steps) {
    assert.strictEqual(s.feet, f, `${s.op} ${k(s.at)}: planned from feet ${s.feet}, the bot is at ${f}`)
    assert.ok(exitOpen(), `${s.op} ${k(s.at)}: the column above the bot is not open to its top`)
    if (s.op === 'dig') {
      assert.deepStrictEqual(s.at, [x, f - 1, z], 'a dig is always the cell underfoot')
      W.set(s.at, { name: 'air', boundingBox: 'empty' })
      let g = f; while (W(x, g - 1, z)?.boundingBox === 'empty') g--
      assert.ok(f - g <= V.FALL_MAX, `a drop of ${f - g}`)
      f = g
    } else if (s.op === 'place') {
      assert.ok(!(s.at[0] === x && s.at[2] === z), `a place in the bot's own column ${k(s.at)}`)
      assert.strictEqual(W(...s.at)?.boundingBox, 'empty', `placed into a filled cell ${k(s.at)}`)
      W.set(s.at, { name: s.block, boundingBox: 'block' })
    } else {
      assert.deepStrictEqual(s.at, [x, f, z], 'a pillar places the feet cell')
      assert.strictEqual(W(x, f + 2, z)?.boundingBox, 'empty', 'a pillar step has head room')
      W.set(s.at, { name: s.block, boundingBox: 'block' }); f++
    }
  }
  assert.strictEqual(f, T, 'the climb ends on the top it started from')
  for (const d of plan.digs) assert.strictEqual(W(...d)?.boundingBox, 'block', `opened cell ${k(d)} left open`)
  return { W, done: REC.cells.filter(c => isDone(c, W)).length }
}

console.log('THE SHOWCASE ZIGGURAT, 10-30 (the record and the world as read)')
await t('positive control: the fixture holds the 7 open shaft cells, and no stand-free cell elsewhere in the shaft region', () => {
  const read = readOf()
  const openNear = REC.cells.filter(c => c.at[0] >= -37 && c.at[0] <= -30 && c.at[1] <= 76 && !zigDone(c, read)).map(c => k(c.at)).sort()
  assert.deepStrictEqual(openNear, [...SHAFT].sort(), `open: ${openNear}`)
  assert.ok(REC.cells.length > 500, `the record subset (${REC.cells.length} cells)`)
})
await t('the plan: column -33,-33 from its top (feet 75), four cap cells dug, all 7 cells done, cobblestone 10', () => {
  const p = planFor()
  assert.ok(p.ok, p.why)
  assert.deepStrictEqual(p.col, [-33, -33]); assert.deepStrictEqual(p.top, [-33, 75, -33])
  assert.deepStrictEqual(p.digs.map(k), ['-33,74,-33', '-33,73,-33', '-33,72,-33', '-33,71,-33'])
  assert.strictEqual(p.fall, 3, 'the drop into the shaft is 3 (no damage)')
  assert.deepStrictEqual([...p.done].sort(), [...SHAFT].sort())
  assert.deepStrictEqual(p.need, { cobblestone: 10 })
  const { W } = replay(p, readOf(), zigDone)
  for (const c of SHAFT) assert.ok(zigDone(REC.cells.find(q => k(q.at) === c), W), `${c} done after the plan`)
})
await t('a record with no sealed-core rule: the deeper plan (cell -33,68 opened too) PLACES -33,67 instead of sealing it', () => {
  const p = planFor({ isDone: plainDone })
  assert.ok(p.ok, p.why)
  assert.deepStrictEqual(p.digs.map(k), ['-33,74,-33', '-33,73,-33', '-33,72,-33', '-33,71,-33', '-33,68,-33'])
  assert.ok(p.steps.some(s => s.op === 'pillar' && k(s.at) === '-33,67,-33'), 'the stuck cell is pillared')
  replay(p, readOf(), plainDone)
})
await t('column -34: refused, the drop into its shaft is 7 (fall damage)', () => {
  const cellAt = key => REC.cells.find(c => k(c.at) === key) ?? null
  const targets = REC.cells.filter(c => !zigDone(c, readOf()))
  const why = []
  for (let depth = 4; depth <= 10; depth++) why.push(V.planColumn({ read: readOf(), col: [-34, -33], topFeet: 75, depth, cellAt, isDone: zigDone, targets, stuck: STUCK, blockOf }).why)
  assert.ok(why.every(w => /^fall 7/.test(w)), why.join(' | '))
})

console.log('REFUSALS (no plan, nothing dug)')
await t('water beside the shaft: no plan (positive control: the same world without it has one)', () => {
  assert.ok(planFor().ok)
  const p = planFor({ read: readOf({ '-32,70,-33': 'water' }) })
  // the shaft moves to a column away from the water, or there is none; never one beside it
  if (p.ok) { for (let y = p.bottom - 1; y <= p.top[1] + 1; y++) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notStrictEqual(readOf({ '-32,70,-33': 'water' })(p.col[0] + dx, y, p.col[1] + dz)?.name, 'water') }
  assert.ok(!p.ok || k(p.col) !== '-33,-33', `the plan uses the wet column ${p.col}`)
})
await t('every dig vetoed (another record, a zone): no plan', () => {
  const p = planFor({ mayDig: () => false })
  assert.ok(!p.ok, 'a plan with every dig vetoed'); assert.match(p.why, /no_plan/)
})
await t('no walk reaches a column top: no plan', () => {
  const p = planFor({ nodes: new Map() })
  assert.ok(!p.ok); assert.match(p.why, /no column top is walked|no_plan/)
})
await t('a gravel cell in the cap: never dug (it would fall on the bot)', () => {
  const p = planFor({ read: readOf({ '-33,72,-33': 'gravel' }) })
  assert.ok(!p.ok || k(p.col) !== '-33,-33', `dug under gravel in ${p.col}`)
})
await t('the bag short of the plan + spare: accessShort names it; full: {}', () => {
  assert.deepStrictEqual(V.accessShort({ cobblestone: 10 }, () => 11, 'cobblestone'), { cobblestone: 1 })
  assert.deepStrictEqual(V.accessShort({ cobblestone: 10 }, () => 12, 'cobblestone'), {})
  assert.deepStrictEqual(V.accessShort({ cobblestone: 10, dirt: 2 }, n => (n === 'dirt' ? 0 : 99), 'cobblestone'), { dirt: 2 })
})
await t('attempts are bounded per target set (ACCESS_TRIES inside ACCESS_RETRY_MS), then asked again after it', () => {
  const mem = {}
  for (let i = 0; i < V.ACCESS_TRIES; i++) { assert.ok(V.accessAllowed(mem, 'a', 1000 + i)); V.accessNote(mem, 'a', 1000 + i) }
  assert.ok(!V.accessAllowed(mem, 'a', 2000)); assert.ok(V.accessAllowed(mem, 'b', 2000))
  assert.ok(V.accessAllowed(mem, 'a', 1000 + V.ACCESS_RETRY_MS))
})

// a mutant of voidfill.mjs, its anchor present and unique (CLAUDE.md), imported from the test directory
async function withVoidMutant (old, neu, fn) {
  const src = fs.readFileSync(new URL('../src/voidfill.mjs', import.meta.url), 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-void-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
// A SYNTHETIC COLUMN (x 0, z 0): stone floor at y0, record cells y1..8 (core), the lowest `voids` of them open (air), a done
// ring round it at every height so no stand sees in; the top's feet at y9
const replay2 = (plan, read) => replay(plan, read, () => false)
function column (voids) {
  const world = {}, cells = []
  for (let y = 1; y <= 8; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    cells.push({ at: [dx, y, dz], role: 'core', seg: 'S' })
    world[`${dx},${y},${dz}`] = dx === 0 && dz === 0 && y <= voids ? 'air' : 'cobblestone'
  }
  const read = (x, y, z) => { if (Math.abs(x) > 4 || Math.abs(z) > 4 || y < -2 || y > 14) return null; const n = world[`${x},${y},${z}`] ?? (y <= 0 ? 'stone' : 'air'); return { name: n, boundingBox: box(n) } }
  const record = { cells }
  const cellAt = key => cells.find(c => k(c.at) === key) ?? null
  const isDone = (c, r) => R.cellDone(r(...c.at), Z.ZIG_PALETTE, c.role)
  const targets = cells.filter(c => !isDone(c, read))
  return { read, record, cellAt, isDone, targets, stuck: ['0,1,0'], nodes: new Map([['0,0', [9]], ['1,0', [9]], ['-1,0', [9]], ['0,1', [9]], ['0,-1', [9]]]) }
}
await t('a void 2 deep under 6 done cells: planned in its column, the drop 3; 4 deep: its column refused for the drop (5)', () => {
  const a = column(2)
  const pa = V.planVoidAccess({ ...a, blockOf })
  assert.ok(pa.ok, pa.why); assert.strictEqual(pa.fall, 3); assert.deepStrictEqual(pa.col, [0, 0])
  const b = column(4)
  const pb = V.planVoidAccess({ ...b, blockOf })
  // the void's own column is refused (a 5-block drop); a plan, if any, goes down a neighbour cell by cell (every drop <= 3)
  assert.ok(pb.tried.some(x => x.col === '0,0' && /^fall 5/.test(x.why)), JSON.stringify(pb.tried.slice(0, 3)))
  assert.ok(!pb.ok || (k(pb.col) !== '0,0' && pb.fall <= V.FALL_MAX), `planned col ${pb.col} with a ${pb.fall}-block drop`)
  if (pb.ok) replay2(pb, b.read)
})
await t('MUTANT killed: the fall bound removed -> the 4-deep void is planned with a 5-block drop', async () => {
  await withVoidMutant('if (f - g > FALL_MAX) return', 'if (f - g > 99) return', async M => {
    const p = M.planVoidAccess({ ...column(4), blockOf })
    assert.ok(p.ok && k(p.col) === '0,0' && p.fall === 5, `the mutant's plan: ${p.why} col=${p.col} fall=${p.fall}`)
  })
})
await t('MUTANT killed: the dig veto ignored -> a plan digs cells mayDig refuses', async () => {
  await withVoidMutant('if (!mayDig(below)) return', 'if (false) return', async M => {
    const p = M.planVoidAccess({ read: readOf(), record: REC, stuck: STUCK, nodes: nodesOf(readOf()), isDone: zigDone, blockOf, mayDig: () => false })
    assert.ok(p.ok, `the mutant refused too (${p.why})`)
  })
})

// ---- the visit on the fake server -------------------------------------------------------------------------------------------
console.log('THE VISIT (fake server): a three-tier mound with a sealed void in its core')
const CX = 30, CZ = 0, PAL = { core: ['cobblestone'] }
const VOID = [[CX, G + 1, CZ], [CX, G + 2, CZ], [CX + 1, G + 1, CZ]]
function mound () {
  const cells = [], world = {}
  for (const [y, r, seg] of [[G + 1, 3, 'A'], [G + 2, 2, 'B'], [G + 3, 1, 'C']]) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const at = [CX + dx, y, CZ + dz]
      cells.push({ at, role: 'core', seg })
      world[k(at)] = VOID.some(v => k(v) === k(at)) ? 'air' : 'cobblestone'
    }
  }
  const record = { v: 1, plot: 'shop', cells, segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: ['A'] }, { seg: 'C', deps: ['B'] }], clear: [], replant: [] }
  return { record, world }
}
/** The fake bot with a body: walks teleport, a dig underfoot drops it, a pillar's place lifts it (land after rise). */
function body (srv, { inv = { cobblestone: 64 }, ack } = {}) {
  const e = bot(srv, 'A', { inv, ...(ack ? { ack } : {}) })
  let at = [2, G + 1, 0], risen = false
  e.feet = () => at.slice()
  e.walkTo = async s => { at = s.slice(); return true }
  e.count = n => inv[n] ?? 0
  e.rise = async () => { risen = true; return true }
  e.land = async () => { if (risen && srv.read(...at)?.boundingBox === 'block') at[1]++; risen = false }
  e.settle = async () => { while (srv.read(at[0], at[1] - 1, at[2])?.boundingBox === 'empty') at[1]-- }
  e.tool = async () => {}
  return e
}
async function visit (Mod, pr, srv, e, mem) {
  const h = PJ.recordHead(pr.dir, pr.key)
  return Mod.runVisit({ ...pr.p('A'), palette: PAL, record: h.head.rec, recordGen: h.head.gen, domain: () => true, access: { mem, mayDig: () => true } }, e, { maxSteps: 4000 })
}
const allDone = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), PAL, c.role))
const scene = async (Mod = R, { inv, ack } = {}) => {
  const { record, world } = mound()
  const srv = server(world), pr = project(record), mem = {}
  const stops = []
  let e = null, r = null
  for (let i = 0; i < 4; i++) { e = body(srv, { inv: inv ? { ...inv } : undefined, ack }); r = await visit(Mod, pr, srv, e, mem); stops.push(r.stop); if (r.stop === 'complete') break }
  return { srv, pr, stops, e, r, record }
}
await t('deferred while young, then the access fills the void: the record reads complete, the bot back on top, no lease left', async () => {
  const { srv, pr, stops, e, record } = await scene()
  assert.ok(stops.slice(0, V.ACCESS_AFTER).every(s => s === 'cell_deferred'), `${stops}`)
  assert.strictEqual(stops.at(-1), 'complete', `${stops}`)
  assert.ok(allDone(srv, record), 'every record cell done')
  for (const v of VOID) assert.strictEqual(srv.read(...v).name, 'cobblestone', `${k(v)} filled`)
  assert.strictEqual(srv.read(CX, G + 3, CZ).name, 'cobblestone', 'the opened cap cell re-placed')
  assert.deepStrictEqual(e.feet(), [CX, G + 4, CZ], 'standing on the top again')
  const ops = e.logs.filter(([kk]) => kk === '_build').map(([, d]) => d.op)
  for (const op of ['access_plan', 'access_dig', 'access_done']) assert.ok(ops.includes(op), `a ${op} row (${ops})`)
  for (const s of ['A', 'B', 'C']) { const st = PJ.leaseState(pr.dir, pr.key, `seg-${s}`); assert.ok(!st || st.rec?.holder !== 'A' || Date.now() >= st.blocksUntil || st.released, `seg-${s} still held`) }
})
await t('positive control for the trigger: with the access off (no p.access) the same visits never complete', async () => {
  const { record, world } = mound()
  const srv = server(world), pr = project(record)
  const stops = []
  for (let i = 0; i < 4; i++) { const e = body(srv); const h = PJ.recordHead(pr.dir, pr.key); stops.push((await R.runVisit({ ...pr.p('A'), palette: PAL, record: h.head.rec, recordGen: h.head.gen, domain: () => true }, e, { maxSteps: 4000 })).stop) }
  assert.ok(!stops.includes('complete'), `${stops}`); assert.strictEqual(srv.read(CX, G + 3, CZ).name, 'cobblestone', 'nothing dug')
})
await t('a bag short of the plan: refused, nothing dug, the cells deferred as before', async () => {
  const { srv, stops, e } = await scene(R, { inv: { cobblestone: 3 } })
  assert.ok(!stops.includes('complete'), `${stops}`)
  assert.strictEqual(srv.read(CX, G + 3, CZ).name, 'cobblestone', 'the cap is untouched')
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'access_refused' && /no_material/.test(d.why)), 'a named refusal')
})
await t('the server refuses every pillar step: the climb ends at once, nothing is ever placed above the bot, no open cap left unnamed', async () => {
  // a refused place in the bot's own column: the bot never rises, the access fails and names it; the shaft above stays open
  const { record, world } = mound()
  const srv = server(world), pr = project(record), mem = {}
  let e = null
  const ack = target => (target[0] === CX && target[2] === CZ ? 'refuse' : 'ok')
  for (let i = 0; i < 3; i++) { e = body(srv, { ack }); await visit(R, pr, srv, e, mem) }
  const end = e.logs.find(([kk, d]) => kk === '_build' && d.op === 'access_end')
  assert.ok(end, 'an access_end row'); assert.strictEqual(end[1].result, 'failed')
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'access_climbout' && d.result === 'short'), 'the climb-out named short')
  const f = e.feet()
  for (let y = f[1]; y <= G + 5; y++) assert.strictEqual(srv.read(f[0], y, f[2]).boundingBox, 'empty', `a block over the bot at ${y}`)
})
await t('MUTANT killed: the access trigger removed -> the void is never filled', async () => {
  await withMutant('if (access && !accessTried && cand.length', 'if (false && access && !accessTried && cand.length', async M => {
    const { stops } = await scene(M)
    assert.ok(!stops.includes('complete'), `the mutant completed: ${stops}`)
  })
  const { stops } = await scene(R)
  assert.strictEqual(stops.at(-1), 'complete', 'and the real module does')
})

console.log('WIRING (structural: the monument visit is not reachable offline)')
const SKILLS = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
await t('the monument visit passes the access, and draws its cap + spare from town when the stuck map holds cells (Codex r1 BLOCK)', () => {
  assert.strictEqual(SKILLS.split('access: zigAccessOf(bot, c) }, effects').length, 2, 'the access is wired into the monument visit once')
  assert.match(SKILLS, /if \(zigAccessOf\(bot, c\) && Object\.keys\(vfStuckRead\(dir, key\)\)\.length\) want\.cobblestone = \(want\.cobblestone \?\? 0\) \+ VF_ACCESS_DIG_MAX \+ VF_ACCESS_SPARE/)
  assert.ok(SKILLS.indexOf('VF_ACCESS_SPARE } catch') < SKILLS.indexOf('const need = needFromTown(want, spare0)', SKILLS.indexOf('VF_ACCESS_SPARE } catch')), 'the extra draw is added before the need is computed')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
