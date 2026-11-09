// CITYWALL-01, THE FLEET PORT (FLAT: no reach-only click, no block state on this base; no towers, no gatehouse) (bots/src/citywall.mjs; buildrun.mjs swapDigOk; owner 11-09 "re-face or rebuild the cobble walls in
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
  const u = { at: [0, 69, 0], role: 'cw-foot' }   // an underpinning cell (no sw): open and placeable
  air.add(k3(u.at))
  assert.strictEqual(R.swapDigOk(a, [u, a, b], { clear, has }), false, 'the underpinning first')
  assert.strictEqual(R.swapDigOk(a, [u, a, b], { clear, has, tries: () => 2 }), true, 'an added cell whose attempts are spent holds nothing back')
  assert.strictEqual(R.swapDigOk(a, [u, a, b], { clear, has, fillable: () => false }), true, 'nor one no stand can fill now (never a dead end: offline 11-09)')
  air.add(k3(c.at))
  assert.strictEqual(R.swapDigOk(a, [u, a, b, c], { clear, has, fillable: () => false }), false, 'a DUG cell holds the next dig whatever its stands')
  air.delete(k3(c.at))
  const u2 = { at: [0, 68, 0], role: 'cw-foot' }
  air.add(k3(u2.at))
  // the upper underpinning waits on the lower (open below it): only the lower blocks
  air.delete(k3(u2.at))
  assert.strictEqual(R.swapDigOk(a, [u2, u, a], { clear: q => q === u, has }), true, 'a clear cell waiting on an open one below it is not a hole now')
})

await t('THE CLEARS: a tree in a new cell is felled whole (its connected logs), leaves in a new cell cleared; a swapped cell owes none', () => {
  const srv = server()
  for (let y = G + 1; y <= G + 6; y++) srv.set([9, y, 9], 'spruce_log')
  srv.set([9, G + 7, 9], 'spruce_leaves'); srv.set([10, G + 3, 9], 'spruce_leaves')
  const cl = CW.designClears(srv.read, [{ at: [9, G + 3, 9] }, { at: [10, G + 3, 9] }, { at: [9, G + 1, 9], sw: 1 }])
  assert.strictEqual(cl.filter(c => c.kind === 'tree').length, 6)
  assert.deepStrictEqual(cl.filter(c => c.kind === 'leaves').map(c => k3(c.at)), [`10,${G + 3},9`])
})
let SRV = null, REC = null, DES = null
await t('THE FLEET DESIGN (FLAT, no gate) on a real wall@1: every reachable O cell swapped, no tower, no gate, torches at the run ends, no blind cell, no state; nobody trapped', () => {
  SRV = server(); REC = standingWall(SRV)
  DES = CW.citywallDesign(SRV.read, REC, { style: 'dark', seed: 3, flat: true })
  assert.ok(DES.ok, DES.why)
  const byK = new Map(DES.cells.map(c => [k3(c.at), c]))
  for (const c of REC.cells.filter(q => q.role === 'wall')) assert.ok(byK.get(k3(c.at))?.sw === 1, `O cell ${c.at} swapped`)
  assert.strictEqual(DES.counts.towers, 0); assert.strictEqual(DES.gate, null)
  assert.ok(!DES.cells.some(c => c.blind || c.ws)); assert.ok(DES.cells.some(c => c.role === 'light'))
  const esc = W.wallEscape(SRV.read, HOME, [...REC.cells, ...DES.cells], { r: 56 })
  assert.strictEqual(esc.cut, 0); assert.strictEqual(esc.trapped, 0)
})
await t('THE GENERATIONS AND THE NEXT PHASE: phase by phase, the ring standing; the next only when the last stands and the bill is in town', () => {
  let rec = REC
  for (const p of DES.phases) rec = CW.citywallGeneration(rec, DES, p.ph, { now: 1 })
  assert.ok(rec.structure_complete && rec.citywall.phase === DES.phases.at(-1).ph)
  for (const c of REC.cells.filter(q => q.role === 'step')) assert.ok(rec.cells.some(q => k3(q.at) === k3(c.at)))
  const r0 = CW.citywallGeneration(REC, DES, 0)
  const all = { stone_bricks: 1e5, deepslate_bricks: 1e5, torch: 1e5, cobblestone: 1e5 }
  assert.match(CW.citywallNext(r0, { done: () => false, stock: all }).why, /^open:/)
  assert.strictEqual(CW.citywallNext(r0, { done: () => true, stock: all }).ph, DES.phases[1].ph)
  assert.match(CW.citywallNext(r0, { done: () => true, stock: {} }).why, /^stock:/)
})
/** THE UPGRADE BUILT by fake builders running buildrun.mjs runVisit (the wall visit's options and `swap`), every phase; the holes per
 *  segment watched at every dig. -> { open, maxHoles, digs, places, offRecord }. */
async function buildUpgrade (Rmod, { flat = true } = {}) {
  const srv = server(); const rec0 = standingWall(srv)
  const des = CW.citywallDesign(srv.read, rec0, { style: 'dark', seed: 3, flat })
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
          domain: () => true, walkR: W.wallWalkR(rec, HOME), foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX, swap: true, stands: stands[n] }, bots[n], { maxSteps: 400 })
        PJ.releaseLease(dir, key, `slot${slot.slot}`, n, slot.gen)
      }
    }
  }
  const open = rec.cells.filter(c => !Rmod.cellDone(srv.read(...c.at), rec.palette, c.role))
  const rows = Object.values(bots).flatMap(b => b.logs).filter(([k]) => k === '_build').map(([, d]) => d)
  const keys = new Set(rec.cells.map(c => k3(c.at)))
  return { open, maxHoles, digs: rows.filter(d => d.op === 'clear' && d.kind === 'foreign').length, places: rows.filter(d => d.op === 'place').length, offRecord: rows.filter(d => d.op === 'place' && !keys.has(k3(d.cell))).length, swN: sw.length }
}
await t('BUILT END TO END with the swap (FLAT): every phase complete, every swapped cell dug and placed again, NEVER TWO HOLES in a segment, every placement a record cell', async () => {
  const r = await buildUpgrade(R)
  assert.strictEqual(r.open.length, 0, `open ${r.open.slice(0, 5).map(c => `${c.at}:${c.role}:${c.seg}`).join(' ')}`)
  assert.ok(r.digs >= r.swN * 0.9, `swapped ${r.digs} of ${r.swN}`)
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
await t('MUTANT KILLED: without the swap rule in the visit\'s dig filter, a segment opens more than one hole', async () => {
  await withMutant(' && (tries.get(kOf(c.at)) ?? 0) < BUILD_ATTEMPTS && swapOk(c) })', ' && (tries.get(kOf(c.at)) ?? 0) < BUILD_ATTEMPTS })', async M => {
    const r = await buildUpgrade(M)
    assert.ok(r.maxHoles > 1, `the mutant kept ${r.maxHoles} hole(s)`)
  })
})
// ---- THE WIRING (structural; comments stripped, anchored) --------------------------------------------------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const BR = strip(readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8'))
await t('WIRED (the fleet: no planner plot): the wall visit publishes the next phase, judges by the record palette, swaps; the due read; the waiver; the sealed remedy never for a swapped cell', () => {
  assert.ok(/if \(rec\.structure_complete && citywallDueFor\(bot, rec\)\.due\) \{\s*\n\s*const adv = citywallAdvance\(/.test(SK))
  assert.ok(/const palette = isCitywall\(rec\) \? \{ \.\.\.WALL_PALETTE, \.\.\.rec\.palette \} : WALL_PALETTE/.test(SK))
  assert.ok(/\.\.\.\(isCitywall\(rec\) \? \{ swap: true \} : \{\}\)/.test(SK))
  assert.ok(/if \(tidy && r\.blueprint === WALL_BLUEPRINT && r\.structure_complete && citywallDueFor\(bot, r\)\.due\) return true/.test(SK))
  assert.ok(/flat: true,/.test(SK), 'the fleet design is FLAT')
  assert.ok(/wallEscape\(read0, home, \[\.\.\.rec\.cells, \.\.\.design\.cells\]/.test(SK))
  assert.ok(/done: q => wallWaived\(rec, q\) \|\| /.test(SK))
  assert.ok(/\(cur\.structure_complete && !isCitywall\(cur\)\)/.test(SK))
  assert.ok(/if \(v === 'no_stand' && p\.sealed && kind !== 'tree' && !\(p\.swap && f\.sw\)\) \{/.test(BR))
})

console.log(`\ncitywall (fleet): ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
