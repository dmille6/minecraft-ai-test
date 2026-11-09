// CITYWALL-01: THE TOWN WALL UPGRADE (bots/src/citywall.mjs; buildrun.mjs swapDigOk; owner 11-09 "re-face or rebuild the cobble walls in
// stone bricks: a crenellated top, corner towers, a gatehouse at the main road, and lights. Retrofit in place, never leaving a gap").
// Pure and on the fake server: the courses; the underpinning; the swap rule (one hole a segment, the block in the bag, an underpinning
// first); the towers and the gatehouse (headroom kept, the passage's columns never filled); the design on a real wall@1 record (every O
// cell swapped, nothing taken, nobody trapped); the generations (segments ordered, the gate's deps, the clears); the next phase (open,
// stock); and the upgrade BUILT END TO END by buildrun.mjs runVisit with `swap`, NEVER TWO HOLES in a segment (the mutant without the
// swap rule opens a run); the wiring in skills.mjs / shop.mjs (anchored, comment-stripped).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const W = await import('../src/wall.mjs')
const CW = await import('../src/citywall.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const PLAN = () => ({ home: HOME, gen: 4, plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: true }], paths: [] })
const k3 = a => a.join(',')

/** A sited wall@1 on the fake server, its cells STANDING (cobblestone set in the world), a gateway named `path` on its south side. */
function standingWall (srv) {
  const s = W.siteWall(srv.read, { plan: PLAN() })
  assert.ok(s.ok, s.why)
  const rec = { ...s.record, structure_complete: true }
  for (const c of rec.cells) srv.set(c.at, c.role === 'post' ? 'stone_bricks' : c.role === 'light' ? 'torch' : 'cobblestone')
  // a gateway (the siting found none on an empty plan): five columns of the south side cleared, named `path`
  const south = rec.cols.filter(c => c.z === rec.ring[3] && c.s === 'wall')
  const mid = south[Math.floor(south.length / 2)]
  const gcols = south.filter(c => Math.abs(c.x - mid.x) <= 2)
  const gk = new Set(gcols.map(c => `${c.x},${c.z}`))
  rec.cells = rec.cells.filter(c => { const hit = gk.has(`${c.at[0]},${c.at[2]}`) || (gk.has(`${c.at[0]},${c.at[2] + 1}`) && c.role === 'step') || (gk.has(`${c.at[0]},${c.at[2] + 2}`) && c.role === 'step'); if (hit) srv.set(c.at, 'air'); return !hit })
  rec.cols = rec.cols.map(c => (gk.has(`${c.x},${c.z}`) ? { x: c.x, z: c.z, s: 'gate', why: 'path' } : c))
  rec.gates = [{ cols: gcols.map(c => [c.x, c.z]).sort((a, b) => a[0] - b[0]), why: 'path' }]
  return rec
}

await t('THE PALETTE COPY: OLD_WALL_PALETTE is wall.mjs WALL_PALETTE (the steps, posts and lights the upgrade leaves)', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(CW.OLD_WALL_PALETTE)), JSON.parse(JSON.stringify(W.WALL_PALETTE)))
  for (const st of Object.keys(CW.WALL_STYLES)) for (const r of Object.values(CW.CW)) assert.ok(CW.citywallPalette(st)[r]?.length, `${st} ${r}`)
})
await t('THE COURSES: <= b foot, b+1 plinth, b+2 body (moss by the seed, some), b+3 band, b+4 merlon', () => {
  assert.strictEqual(CW.courseRole(0), CW.CW.foot); assert.strictEqual(CW.courseRole(-2), CW.CW.foot)
  assert.strictEqual(CW.courseRole(1), CW.CW.plinth); assert.strictEqual(CW.courseRole(3), CW.CW.band)
  assert.strictEqual(CW.courseRole(2, { moss: false }), CW.CW.body); assert.strictEqual(CW.courseRole(4, { moss: false }), CW.CW.merlon)
  const body = Array.from({ length: 400 }, (_, i) => CW.courseRole(2, { seed: 5, at: [i, 70, 3] }))
  const m = body.filter(r => r === CW.CW.bodym).length
  assert.ok(m > 20 && m < 120, `moss share ${m}/400`)
  assert.deepStrictEqual(body, Array.from({ length: 400 }, (_, i) => CW.courseRole(2, { seed: 5, at: [i, 70, 3] })), 'deterministic')
})
await t('THE UNDERPINNING: the void under a column filled to its ground; ground at once -> none; water, too deep -> why', () => {
  const srv = server()
  const col = { x: 5, z: 5, cells: [{ at: [5, G + 3, 5] }] }
  assert.deepStrictEqual(CW.underpinOf(srv.read, col), { cells: [[5, G + 2, 5], [5, G + 1, 5]], why: null })
  assert.deepStrictEqual(CW.underpinOf(srv.read, { ...col, cells: [{ at: [5, G + 1, 5] }] }), { cells: [], why: null })
  srv.set([5, G, 5], 'water'); srv.set([5, G + 1, 5], 'water')
  assert.strictEqual(CW.underpinOf(srv.read, col).why, 'water')
  assert.strictEqual(CW.underpinOf(server().read, { ...col, cells: [{ at: [5, G + 12, 5] }] }).why, 'deep')
})
await t('THE SWAP RULE (swapDigOk): no hole open in the segment and the block in the bag -- else never the dig', () => {
  const air = new Set()
  const clear = q => air.has(k3(q.at))
  const a = { at: [0, 71, 0], sw: 1, role: 'cw-plinth' }, b = { at: [0, 72, 0], sw: 1, role: 'cw-body' }, c = { at: [1, 71, 0], sw: 1, role: 'cw-plinth' }
  const has = () => true
  assert.strictEqual(R.swapDigOk(a, [a, b, c], { clear, has }), true, 'nothing open')
  assert.strictEqual(R.swapDigOk(a, [a, b, c], { clear, has: () => false }), false, 'no block in the bag: never a dig')
  air.add(k3(c.at))
  assert.strictEqual(R.swapDigOk(a, [a, b, c], { clear, has }), false, 'a dug cell stands open: the next waits')
  assert.strictEqual(R.swapDigOk(a, [a, b, c], { clear, has, tries: () => 9 }), false, 'a dug cell blocks whatever its attempts')
  air.clear()
  const u = { at: [5, 69, 0], role: 'cw-foot' }   // an underpinning cell (no sw) of another column: open and placeable
  air.add(k3(u.at))
  assert.strictEqual(R.swapDigOk(a, [u, a, b], { clear, has }), false, 'the underpinning first')
  assert.strictEqual(R.swapDigOk(a, [u, a, b], { clear, has, tries: () => 2 }), true, 'an added cell whose attempts are spent holds nothing back')
  assert.strictEqual(R.swapDigOk(a, [u, a, b], { clear, has, fillable: () => false }), true, 'nor one no stand can fill now (never a dead end: offline 11-09)')
  air.add(k3(c.at))
  assert.strictEqual(R.swapDigOk(a, [u, a, b, c], { clear, has, fillable: () => false }), false, 'a DUG cell holds the next dig whatever its stands')
  air.delete(k3(c.at))
  const u2 = { at: [5, 68, 0], role: 'cw-foot' }
  air.add(k3(u2.at))
  // the upper underpinning waits on the lower (open below it): only the lower blocks
  air.delete(k3(u2.at))
  assert.strictEqual(R.swapDigOk(a, [u2, u, a], { clear: q => q === u, has }), true, 'a clear cell waiting on an open one below it is not a hole now')
  // NEVER OVER A HOLE in its own column (offline board-b 11-09: a dug plinth over a spent underpinning could not be placed again)
  const under = { at: [0, 70, 0], role: 'cw-foot' }
  assert.strictEqual(R.swapDigOk(a, [under, a], { clear: q => q === under, has, tries: () => 2 }), false, 'a spent hole under it: never dug')
  assert.strictEqual(R.swapOverHole(a, [under, a], q => q === under), true)
})

let SRV = null, REC = null, DES = null
await t('THE DESIGN on a real wall@1 (siteWall on the fake server): every O cell swapped to a course, towers, the gatehouse, lamps; nothing taken, nobody trapped', () => {
  SRV = server(); REC = standingWall(SRV)
  const taken = new Set([`${REC.ring[0] + 3},${G + 1},${REC.ring[1] - 1}`])
  DES = CW.citywallDesign(SRV.read, REC, { style: 'grey', seed: 3, gatePick: 'path', taken: (x, y, z) => taken.has(`${x},${y},${z}`) })
  assert.ok(DES.ok, DES.why)
  const oCells = REC.cells.filter(c => c.role === 'wall')
  const byK = new Map(DES.cells.map(c => [k3(c.at), c]))
  for (const c of oCells) assert.ok(byK.get(k3(c.at))?.sw === 1, `O cell ${c.at} swapped`)
  for (const c of REC.cells.filter(q => q.role === 'step')) assert.ok(!byK.has(k3(c.at)) || /tower|quoin|tcore|slit/.test(byK.get(k3(c.at)).role), 'a step stays, unless a tower stands on it')
  assert.ok(DES.counts.towers >= 1, 'towers'); assert.ok(DES.gate?.P === 5, `the gate over the named gateway ${JSON.stringify(DES.gate)}`)
  for (const c of DES.cells) assert.ok(!taken.has(k3(c.at)), 'never a taken cell')
  // THE GATE'S PASSAGE: every column of it clear from its ground + 1 to the deck - 1 (the haunches at the edges at deck - 1 only)
  for (const [x, z] of DES.gate.cols) for (let o = 0; o < 3; o++) for (let y = G + 1; y < DES.gate.deckY - 1; y++) {
    const n = REC.ring[3] === z ? [0, 1] : [0, 0]
    assert.ok(!byK.has(`${x + n[0] * o},${y},${z + n[1] * o}`), `passage cell ${x},${y},${z} filled`)
  }
  assert.ok(DES.gate.deckY >= G + 4, 'headroom 3')
  const esc = W.wallEscape(SRV.read, HOME, [...REC.cells, ...DES.cells], { r: 56 })
  assert.strictEqual(esc.cut, 0); assert.strictEqual(esc.trapped, 0)
})
await t('CODEX r1 BLOCKERS 2 + 3: a WAIVED cell is never swapped nor a tower\'s; a gatehouse with ANY added cell on a taken one is refused (the deck included)', () => {
  const k = k3(REC.cells.find(c => c.role === 'wall').at)
  const d2 = CW.citywallDesign(SRV.read, { ...REC, waived: { [k]: { why: 'no_stand', at: 1, by: 'x' } } }, { style: 'grey', seed: 3, gatePick: 'path' })
  assert.ok(d2.ok && !d2.cells.some(c => k3(c.at) === k), 'the waived cell stays as it is')
  const deck = DES.cells.find(c => c.role === CW.CW.deck)
  const d3 = CW.citywallDesign(SRV.read, REC, { style: 'grey', seed: 3, gatePick: 'path', taken: (x, y, z) => k3([x, y, z]) === k3(deck.at) })
  assert.strictEqual(d3.gate, null); assert.match(String(d3.skipped.gate), /taken/)
  assert.ok(!d3.cells.some(c => k3(c.at) === k3(deck.at)))
})
await t('THE UNDERPINNING NO STAND REACHES is left out (the waiver is bounded): reachUnder false -> no foot added, counted `unreached`', () => {
  const srv = server(); const rec = standingWall(srv)
  const col = CW.wallColumns(rec)[3]
  for (const c of col.cells) srv.set(c.at, 'air')
  const lo = col.cells[0].at[1]
  for (const c of col.cells) srv.set(c.at, 'cobblestone')
  srv.set([col.x, lo - 1, col.z], 'air'); srv.set([col.x, lo - 2, col.z], 'air')
  const a = CW.citywallDesign(srv.read, rec, { seed: 3, gatePick: 'path' })
  const b = CW.citywallDesign(srv.read, rec, { seed: 3, gatePick: 'path', reachUnder: () => false })
  const feet = d => d.cells.filter(c => c.role === CW.CW.foot && !c.sw && c.at[0] === col.x && c.at[2] === col.z).length
  assert.ok(feet(a) >= 1, `underpinned ${feet(a)}`); assert.strictEqual(feet(b), 0); assert.ok(b.skipped.underpin.unreached >= 1)
})
await t('A CELL NO STAND CAN DIG stays cobblestone (counted), its run keeps the rest; a tower or a gate with one is refused', () => {
  const o = REC.cells.filter(c => c.role === 'wall')
  const lowK = new Set(o.filter(c => c.at[1] <= G + 1).map(c => k3(c.at)))
  const d = CW.citywallDesign(SRV.read, REC, { seed: 3, gatePick: 'path', reachSwap: at => !lowK.has(k3(at)) })
  assert.ok(d.ok && d.skipped.cells > 0)
  assert.ok(!d.cells.some(c => lowK.has(k3(c.at))), 'never swapped')
  assert.ok(d.cells.some(c => c.sw), 'the reachable courses still are')
  assert.strictEqual(d.counts.towers, 0, 'every tower here has a low in-line cell: refused'); assert.strictEqual(d.gate, null)
})
await t('THE GENERATIONS: phase by phase; segments ordered gate towers, gate deck, gate lamps, towers, runs, lamps; the deck waits on its towers', () => {
  let rec = REC
  for (const p of DES.phases) rec = CW.citywallGeneration(rec, DES, p.ph, { now: 1 })
  const segs = rec.segments.map(s => s.seg)
  const rank = s => (s === 'CW-GTs' ? -0.5 : s === 'CW-GT' ? 0 : s === 'CW-G' ? 1 : s === 'CW-GL' ? 1.5 : /^CW-T\d+s$/.test(s) ? 1.8 : /^CW-T/.test(s) ? 2 : /^CW-L/.test(s) ? 4 : 3)
  assert.deepStrictEqual(segs.map(rank), segs.map(rank).slice().sort((a, b) => a - b), segs.join(' '))
  assert.ok(rec.segments.find(s => s.seg === 'CW-G').deps.includes('CW-GT'))
  assert.ok(rec.segments.find(s => s.seg === 'CW-GL').deps.includes('CW-G'))
  // a tower's outer rows wait on its swapped in-line column (swapped from the outside ground before the rows enclose it)
  for (const sg of rec.segments.filter(q => /^CW-(GT|T\d+)$/.test(q.seg))) if (rec.segments.some(q => q.seg === `${sg.seg}s`)) assert.ok(sg.deps.includes(`${sg.seg}s`), sg.seg)
  for (const c of rec.cells.filter(q => /^CW-(GT|T\d+)$/.test(q.seg))) assert.ok(!REC.cells.some(o => k3(o.at) === k3(c.at)), `${c.at} an old cell outside the swap-first segment`)
  assert.strictEqual(rec.citywall.phase, DES.phases.at(-1).ph)
  assert.ok(rec.structure_complete, 'the ring stays standing')
  for (const c of REC.cells.filter(q => q.role === 'step')) assert.ok(rec.cells.some(q => k3(q.at) === k3(c.at)), 'every old step cell is kept')
  assert.ok(rec.palette.step && rec.palette['cw-band'])
  // one phase at a time: phase 0 alone carries no later phase's cells
  const r0 = CW.citywallGeneration(REC, DES, 0)
  assert.ok(!r0.cells.some(c => Number.isInteger(c.ph) && c.ph > 0))
})
await t('THE NEXT PHASE: the last one standing first, then the bill in town (a later name of the same role counts), stock unknown waits', () => {
  const r0 = CW.citywallGeneration(REC, DES, 0)
  const all = { stone_bricks: 1e5, deepslate_bricks: 1e5, cobblestone: 1e5, mossy_stone_bricks: 1e5, lantern: 1e5, iron_bars: 1e5, stone_brick_wall: 1e5, stone_brick_stairs: 1e5, chiseled_stone_bricks: 1e5 }
  assert.match(CW.citywallNext(r0, { done: () => false, stock: all }).why, /^open:/)
  assert.strictEqual(CW.citywallNext(r0, { done: () => true, stock: null }).why, 'stock_unknown')
  const nx = CW.citywallNext(r0, { done: () => true, stock: all })
  assert.strictEqual(nx.ph, DES.phases[1].ph)
  assert.match(CW.citywallNext(r0, { done: () => true, stock: {} }).why, /^stock:/)
  // a deepslate plinth laid in stone bricks: the bill's deepslate shortfall met by stone bricks
  assert.deepStrictEqual(CW.stockShort({ deepslate_bricks: 10 }, { stone_bricks: 10 }), {})
  assert.deepStrictEqual(CW.stockShort({ deepslate_bricks: 10 }, { stone_bricks: 4 }), { deepslate_bricks: 6 })
  assert.deepStrictEqual(CW.stockShort({ stone_bricks: 10 }, { deepslate_bricks: 10 }), { stone_bricks: 10 }, 'a body brick is never deepslate')
})
await t('THE CLEARS: a tree in a new cell is felled whole (its connected logs), leaves in a new cell cleared; a swapped cell owes none', () => {
  const srv = server()
  for (let y = G + 1; y <= G + 6; y++) srv.set([9, y, 9], 'spruce_log')
  srv.set([9, G + 7, 9], 'spruce_leaves'); srv.set([10, G + 3, 9], 'spruce_leaves')
  const cl = CW.designClears(srv.read, [{ at: [9, G + 3, 9] }, { at: [10, G + 3, 9] }, { at: [9, G + 1, 9], sw: 1 }])
  assert.strictEqual(cl.filter(c => c.kind === 'tree').length, 6)
  assert.deepStrictEqual(cl.filter(c => c.kind === 'leaves').map(c => k3(c.at)), [`10,${G + 3},9`])
})
await t('THE STYLE AND THE GATE PICK: grey unless few stone bricks and much deepslate; the extension takes its road gateway; CITYWALL_GATE overrides', () => {
  assert.strictEqual(CW.citywallStyleFor({ stone_bricks: 582, deepslate_bricks: 288, cobbled_deepslate: 1010 }, 'showcase', {}), 'grey')
  assert.strictEqual(CW.citywallStyleFor({ stone_bricks: 120, cobbled_deepslate: 14000 }, 'hive-a', {}), 'dark')
  assert.strictEqual(CW.citywallStyleFor({}, '', { CITYWALL_STYLE: 'dark' }), 'dark')
  assert.strictEqual(CW.citywallGatePick({}, 'wallext'), 'road'); assert.strictEqual(CW.citywallGatePick({}, 'wall'), 'path')
  assert.strictEqual(CW.citywallGatePick({ CITYWALL_GATE: 'none' }, 'wallext'), null); assert.strictEqual(CW.citywallGatePick({ CITYWALL_GATE: 'spoke' }, 'wall'), 'spoke')
  assert.strictEqual(CW.citywallOn({}, 'showcase'), true); assert.strictEqual(CW.citywallOn({}, 'hive-a'), false); assert.strictEqual(CW.citywallOn({ CITYWALL: 'off' }, 'showcase'), false)
})

/** THE UPGRADE BUILT by fake builders running buildrun.mjs runVisit (the wall visit's options and `swap`), every phase; the holes per
 *  segment watched at every dig. -> { open, maxHoles, digs, places, offRecord }. */
async function buildUpgrade (Rmod, { flat = false } = {}) {
  const srv = server(); const rec0 = standingWall(srv)
  // the fake server places no block state (a stair's facing is Paper's proof: sandbox/citywall/wall-e2e.mjs): no haunch stairs here
  const des = CW.citywallDesign(srv.read, rec0, { style: 'grey', seed: 3, gatePick: 'path', stairs: false, flat })
  const sw = des.cells.filter(c => c.sw)
  let maxHoles = 0
  const dig = async (c, expect) => {
    if (expect && srv.read(...c)?.name !== expect) return 'refused'
    srv.set(c, 'air')
    const holes = {}
    for (const q of sw) if (srv.read(...q.at)?.name === 'air') holes[q.seg] = (holes[q.seg] ?? 0) + 1
    maxHoles = Math.max(maxHoles, ...Object.values(holes), 0)
    return 'confirmed'
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citywall-'))
  const key = PJ.projKey(HOME, W.WALL_PLOT)
  PJ.publishRecord(dir, key, () => rec0)
  const inv = { stone_bricks: 4000, deepslate_bricks: 4000, mossy_stone_bricks: 400, cobblestone: 2000, stone_brick_wall: 200, chiseled_stone_bricks: 20, stone_brick_stairs: 50, iron_bars: 50, lantern: 100, torch: 50 }
  const names = ['A', 'B']
  const bots = Object.fromEntries(names.map((n, i) => [n, bot(srv, n, { inv: { ...inv }, feet: [i, G + 1, 0], dig })]))
  const stands = Object.fromEntries(names.map(n => [n, { pending: null, bans: {} }]))
  let rec = rec0
  for (const p of des.phases) {
    rec = CW.citywallGeneration(rec, des, p.ph)
    const pub = PJ.publishRecord(dir, key, () => rec)
    for (let round = 0; round < 30; round++) {
      if (rec.cells.filter(c => c.ph === p.ph).every(c => Rmod.cellDone(srv.read(...c.at), rec.palette, c.role))) break
      for (const n of names) {
        const slot = PJ.takeSlot(dir, key, n, W.WALL_BUILDERS)
        await Rmod.runVisit({ dir, key, me: n, home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: slot.slot, slotGen: slot.gen,
          domain: () => true, walkR: W.wallWalkR(rec, HOME), foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, swap: true, skipOpenDeps: true, stands: stands[n] }, bots[n], { maxSteps: 400 })
        PJ.releaseLease(dir, key, `slot${slot.slot}`, n, slot.gen)
      }
    }
  }
  const open = rec.cells.filter(c => !Rmod.cellDone(srv.read(...c.at), rec.palette, c.role))
  const rows = Object.values(bots).flatMap(b => b.logs).filter(([k]) => k === '_build').map(([, d]) => d)
  const keys = new Set(rec.cells.map(c => k3(c.at)))
  return { open, maxHoles, digs: rows.filter(d => d.op === 'clear' && d.kind === 'foreign').length, places: rows.filter(d => d.op === 'place').length, offRecord: rows.filter(d => d.op === 'place' && !keys.has(k3(d.cell))).length, swN: sw.length }
}
await t('BUILT END TO END with the swap: every phase complete, every swapped cell dug and placed again, NEVER TWO HOLES in a segment, every placement a record cell', async () => {
  const r = await buildUpgrade(R)
  assert.strictEqual(r.open.length, 0, `open ${r.open.slice(0, 5).map(c => `${c.at}:${c.role}:${c.seg}`).join(' ')}`)
  assert.ok(r.digs >= r.swN * 0.9, `swapped ${r.digs} of ${r.swN}`)
  assert.strictEqual(r.maxHoles, 1, `holes ${r.maxHoles}`)
  assert.strictEqual(r.offRecord, 0)
})
await t('FLAT (the fleet before townstyle: no reach-only click, no block state): no blind cell, no state, torches for lamps -- and BUILT END TO END the same way', async () => {
  const d = CW.citywallDesign(SRV.read, REC, { style: 'dark', seed: 3, gatePick: 'path', flat: true })
  assert.ok(d.ok && d.counts.towers === 0 && d.gate, 'no bastions flat; the gate keeps its towers')
  assert.ok(!d.cells.some(c => c.blind || c.ws), 'no blind cell, no state')
  assert.ok(d.cells.some(c => c.role === 'light') && !d.cells.some(c => c.role === CW.CW.lamp || c.role === CW.CW.parapet || c.role === CW.CW.haunch))
  const r = await buildUpgrade(R, { flat: true })
  assert.strictEqual(r.open.length, 0, `open ${r.open.slice(0, 5).map(c => `${c.at}:${c.role}:${c.seg}`).join(' ')}`)
  assert.strictEqual(r.maxHoles, 1); assert.strictEqual(r.offRecord, 0)
})
await t('A SWAPPED CELL NO STAND SEES is DEFERRED (counted for the waiver), never a `blocked` run for good, never a chain of digs', async () => {
  const srv = server()
  // a cobble cell buried in stone: no stand sees any of its faces
  const at = [10, G - 3, 10]
  srv.set(at, 'cobblestone')
  const rec = { v: 1, blueprint: 'wall@1', plot: 'wall', home: HOME, cells: [{ at, role: 'cw-plinth', seg: 'W-00', sw: 1 }], segments: [{ seg: 'W-00', deps: [] }], clear: [], replant: [], structure_complete: true }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwsealed-')); const key = PJ.projKey(HOME, W.WALL_PLOT)
  const pub = PJ.publishRecord(dir, key, () => rec)
  const b = bot(srv, 'A', { inv: { deepslate_bricks: 10 }, feet: [0, G + 1, 0] })
  const slot = PJ.takeSlot(dir, key, 'A', 4)
  const v = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: CW.citywallPalette('dark'), slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, swap: true, sealed: { mayDig: () => true }, stands: { pending: null, bans: {} } }, b, { maxSteps: 100 })
  assert.notStrictEqual(v.stop, 'blocked', `${v.stop} ${v.why}`)
  assert.ok((v.deferred ?? []).some(d => String(d.k) === at.join(',')), `deferred ${JSON.stringify(v.deferred)}`)
  assert.strictEqual(srv.read(...at).name, 'cobblestone', 'never dug: the wall stays whole')
})
await t('CODEX r3 BLOCKER: a SEALED lower swap never strands the hole dug above it -- the cell above is placed on the old block, the sealed ones deferred', async () => {
  const srv = server()
  // a column of three swapped cells: the lower two buried in the ground (no stand sees them), the top one in the open air
  const col = [[12, G - 1, 12], [12, G, 12], [12, G + 1, 12]]
  for (const at of col) srv.set(at, 'cobblestone')
  const rec = { v: 1, blueprint: 'wall@1', plot: 'wall', home: HOME, cells: col.map(at => ({ at, role: 'cw-body', seg: 'W-00', sw: 1 })), segments: [{ seg: 'W-00', deps: [] }], clear: [], replant: [], structure_complete: true }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwsealed3-')); const key = PJ.projKey(HOME, W.WALL_PLOT)
  const pub = PJ.publishRecord(dir, key, () => rec)
  const b = bot(srv, 'A', { inv: { deepslate_bricks: 10, stone_bricks: 10 }, feet: [0, G + 1, 0] })
  const pal = CW.citywallPalette('dark')
  for (let v = 0; v < 2; v++) {
    const slot = PJ.takeSlot(dir, key, 'A', 4)
    await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: pal, slot: slot.slot, slotGen: slot.gen,
      domain: () => true, walkR: 40, foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, swap: true, sealed: { mayDig: () => true }, stands: { pending: null, bans: {} } }, b, { maxSteps: 100 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, 'A', slot.gen)
  }
  assert.ok(R.cellDone(srv.read(...col[2]), pal, 'cw-body'), `the top cell swapped: ${srv.read(...col[2]).name}`)
  for (const at of col) assert.notStrictEqual(srv.read(...at).name, 'air', `never a hole left at ${at}`)
})
await t('MUTANT KILLED: without the swap rule in the visit\'s dig filter, a segment opens more than one hole', async () => {
  await withMutant(' && !useOf(c)?.can(rd(...c.at)) && swapOk(c) })', ' && !useOf(c)?.can(rd(...c.at)) })', async M => {
    const r = await buildUpgrade(M)
    assert.ok(r.maxHoles > 1, `the mutant kept ${r.maxHoles} hole(s)`)
  })
})

// ---- THE WIRING (structural: a planner registered, the wall visit's palette and swap; comments stripped, anchored) -----------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const SH = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
await t('WIRED: the planner plot registered (shop.mjs), dispatched and waiting (skills.mjs); the wall visit judges by the record palette and swaps', () => {
  assert.ok(/plot: CITYWALL_PLOT, blueprint: 'citywall@1', builders: 1, planner: true/.test(SH))
  assert.ok(/p\.plot === CITYWALL_PLOT \? cw && wall && paths && on/.test(SH))
  assert.ok(/if \(proj\.plot === CITYWALL_PLOT\) return buildCitywall\(ctx, args, signal\)/.test(SK))
  assert.ok(/const palette = recordPalette\(rec, \{ palette: WALL_PALETTE \}\)/.test(SK))
  assert.ok(/\.\.\.\(isCitywall\(rec\) \? \{ swap: true, skipOpenDeps: true \} : \{\}\)/.test(SK))
  assert.ok(/wallEscape\(read0, home, \[\.\.\.rec\.cells, \.\.\.design\.cells\]/.test(SK), 'the design passes the escape proof')
  // Codex r1: the waiver counts for the next phase and applies to an upgraded (complete) ring
  assert.ok(/done: c => wallWaived\(rec, c\) \|\| \(!!bot && cellDoneHere\(bot, rec\.palette \?\? \{\}, c\)\)/.test(SK))
  assert.ok(/\(cur\.structure_complete && !isCitywall\(cur\)\)/.test(SK))
})
const BR = strip(readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8'))
await t('CODEX r1 BLOCKER 1 (structural: the remedy is a chain of digs): the sealed-column remedy never runs for a swapped cell in a swap visit', () => {
  assert.ok(/if \(v === 'no_stand' && p\.sealed && kind !== 'tree' && !\(p\.swap && f\.sw\)\) \{/.test(BR))
})

console.log(`\ncitywall: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
