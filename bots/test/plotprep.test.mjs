// PLOTPREP-01: the wall extension's reserved plots made ready for their buildings (coordinator 11-04, the owner's "cut down trees and
// replant in better spots"): the LIVE blocker -- a 9-log spruce at 25,-64 (logs 69..77 on soil 68) in plot X1 (x 10..28, z -75..-63)
// -- felled from a temporary stone stand and replanted; the plot levelled to its floor; a sited plot left alone.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// the LIVE geometry, shifted into buildfake's world (soil at G = 69 here, the live soil at 68): the plot X1, the spruce at 25,-54
// (z +10: the fake world reads |z| <= 60), 9 logs G+1..G+9, spruce leaves round its top
const X1 = { id: 'X1', kind: 'hall', box: [10, -65, 28, -53], y: [G, G] }
const TREE = [25, -54]
const scene = () => {
  const srv = server()
  for (let y = G + 1; y <= G + 9; y++) srv.set([TREE[0], y, TREE[1]], 'spruce_log')
  for (let y = G + 5; y <= G + 9; y++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) srv.set([TREE[0] + dx, y, TREE[1] + dz], 'spruce_leaves')
  return srv
}
const prep = (srv, extra = {}) => T.plotPrep(srv.read, { plots: [X1], home: HOME, records: [], ...extra })

await t('THE LIVE TREE: 9 logs, too tall for a ground stand -> felled from a 3-step stone stand against its trunk; every log listed', async () => {
  const srv = scene()
  const p = prep(srv)
  assert.strictEqual(p.trees.length, 1)
  const logs = p.clear.filter(c => c.kind === 'tree')
  assert.strictEqual(logs.length, 9); assert.ok(logs.every(c => c.tree === 0 && c.name === 'spruce_log'))
  assert.strictEqual(p.platforms.length, 1)
  const cells = p.platforms[0].cells
  assert.strictEqual(cells.length, 6, 'steps of 3, 2 and 1 blocks')
  // the top step stands beside the trunk, 3 high: its top at G+3, so the feet at G+4 -- the stand's eye reaches the log at G+9
  const top = cells.filter(c => Math.max(Math.abs(c[0] - TREE[0]), Math.abs(c[2] - TREE[1])) === 1)
  assert.deepStrictEqual(top.map(c => c[1]).sort(), [G + 1, G + 2, G + 3])
  // the leaves in a step's head room are listed as clears
  assert.ok(p.clear.some(c => c.kind === 'leaves'), 'the head room over the stand is cleared of the tree\'s leaves')
  assert.strictEqual(p.plots[0].trees, 1); assert.strictEqual(p.plots[0].stands, 1)
})
await t('a tree a ground stand reaches needs no stand; a tree taller than a 3-step stand is kept (named); a sited plot is left alone', async () => {
  const lo = server(); for (let y = G + 1; y <= G + 5; y++) lo.set([TREE[0], y, TREE[1]], 'oak_log')
  const a = prep(lo)
  assert.strictEqual(a.trees.length, 1); assert.strictEqual(a.platforms.length, 0)
  const hi = server(); for (let y = G + 1; y <= G + 12; y++) hi.set([TREE[0], y, TREE[1]], 'spruce_log')
  const b = prep(hi)
  assert.strictEqual(b.trees.length, 0); assert.ok(b.skipped.tree_tall >= 1 || b.skipped.tree_tall_terrace >= 1 || Object.keys(b.skipped).some(k => /tall/.test(k)), JSON.stringify(b.skipped))
  const sited = prep(scene(), { records: [{ plot: 'shop', cells: [{ at: [12, G + 1, -60] }] }] })
  assert.strictEqual(sited.trees.length, 0); assert.strictEqual(sited.plots[0].sited, true)
  assert.strictEqual(T.plotSited(X1, [{ plot: 'tidy', cells: [{ at: [12, G + 1, -60] }] }]), false, 'the tidy\'s own cells are no siting')
})
await t('the plot levelled to its prevailing floor: a bump cut, a hole filled; never a record cell\'s column, never ore', async () => {
  const srv = server()
  srv.set([15, G + 1, -60], 'dirt'); srv.set([15, G + 2, -60], 'grass_block')     // a 2-high bump
  srv.set([16, G, -58], 'air')                                                     // a 1-deep hole
  srv.set([18, G + 1, -60], 'iron_ore')                                            // never ore
  const p = prep(srv)
  assert.deepStrictEqual(p.cut.map(c => c.at.join(',')).sort(), [`15,${G + 1},-60`, `15,${G + 2},-60`].sort())
  assert.deepStrictEqual(p.fill.map(c => c.at.join(',')), [`16,${G},-58`])
  assert.strictEqual(p.plots[0].floor, G)
  assert.ok(p.skipped.level_natural >= 1, 'the ore column is named, never cut')
})
const land = { home: HOME, seed: 1, ringR: 4, workR: 60, zones: { E: 'treefarm', SE: 'treefarm', S: 'treefarm', SW: 'treefarm', W: 'treefarm', NW: 'treefarm', N: 'treefarm', NE: 'treefarm' }, corridors: [], roads: [] }
const siteInwall = srv => T.siteStage(srv.read, { home: HOME, land, stage: LP.landStages().find(q => q.id === 'inwall'), terrace: { wall: { ring: [-8, -8, 8, 8] }, wallext: { interior: [9, -66, 30, -52], plots: [X1] }, records: [] } })
await t('siteStage inwall: the tree\'s logs (clears with its replant, never in a plot), the stand\'s `access` cells, record.plotprep', async () => {
  const srv = scene()
  const s = siteInwall(srv)
  assert.ok(s.ok && s.record, s.why)
  const r = s.record
  assert.strictEqual(r.clear.filter(c => c.kind === 'tree').length, 9)
  assert.strictEqual(r.replant.length, 1); assert.strictEqual(r.replant[0].tree, 0)
  const rc = r.replant[0].cell
  assert.ok(!(rc[0] >= 10 && rc[0] <= 28 && rc[2] >= -65 && rc[2] <= -53), 'the sapling goes to the tree farm, never into the plot')
  assert.strictEqual(r.cells.filter(c => c.role === 'access').length, 6)
  assert.strictEqual(r.plotprep.platforms.length, 1); assert.strictEqual(r.plotprep.platforms[0].phase, 'up')
  assert.ok(T.platformUp(r))
})
await t('the stand torn down once the tree is down: its cells leave the record as cuts (top first), its phase down; the time limit too', async () => {
  const srv = scene()
  const r = siteInwall(srv).record
  for (const c of r.plotprep.platforms[0].cells) srv.set(c, 'cobblestone')       // the stand built
  assert.strictEqual(T.platformTeardown(r, srv.read, r.sitedAt + 60_000), null, 'the tree stands: the stand stays')
  for (let y = G + 1; y <= G + 9; y++) srv.set([TREE[0], y, TREE[1]], 'air')     // felled
  const r2 = T.platformTeardown(r, srv.read, r.sitedAt + 60_000)
  assert.ok(r2)
  assert.strictEqual(r2.cells.filter(c => c.role === 'access').length, 0)
  const td = r2.cut.filter(c => c.teardown)
  assert.strictEqual(td.length, 6); assert.ok(td.every(c => c.name === 'cobblestone' && c.kind === 'tidy'))
  assert.ok(td[0].at[1] >= td[td.length - 1].at[1], 'top first')
  assert.strictEqual(r2.plotprep.platforms[0].phase, 'down'); assert.strictEqual(T.platformUp(r2), false)
  assert.strictEqual(T.platformTeardown(r2, srv.read), null, 'once')
  // a tree no stand finishes never keeps it: down after PLOTPREP.teardownMs
  const srv3 = scene(); const r3 = siteInwall(srv3).record
  for (const c of r3.plotprep.platforms[0].cells) srv3.set(c, 'cobblestone')
  assert.ok(T.platformTeardown(r3, srv3.read, r3.sitedAt + T.PLOTPREP.teardownMs + 1), 'the time limit')
})
await t('BUILT by runVisit: the stand laid, the tree felled from it -- the top logs only from the stand -- with its sapling planted first', async () => {
  const srv = scene()
  const r = siteInwall(srv).record
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plotprep-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...r }))
  const slot = PJ.takeSlot(dir, key, 'K', 3)
  const e = bot(srv, 'K', { inv: { cobblestone: 32, spruce_sapling: 2 }, feet: [20, G + 1, -50] })
  for (let i = 0; i < 4; i++) await R.runVisit({ dir, key, me: 'K', home: HOME, stood: [], record: r, recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, skipOpenDeps: true, clearMax: 40 }, e, { maxSteps: 300 })
  const standing = []
  for (let y = G + 1; y <= G + 9; y++) if (/_log$/.test(srv.read(TREE[0], y, TREE[1]).name)) standing.push(y)
  assert.deepStrictEqual(standing, [], `every log felled (left: ${standing.join(',')})`)
  assert.ok(/sapling/.test(srv.read(...r.replant[0].cell).name), 'replanted')
  assert.ok(r.plotprep.platforms[0].cells.every(c => srv.read(...c).name === 'cobblestone'), 'the stand stands until the keeper tears it down')
  // the control: with no stand the top logs are out of a ground stand's reach
  const srv2 = scene()
  const r0 = { ...r, cells: r.cells.filter(c => c.role !== 'access'), segments: r.segments.filter(sg => r.cells.some(c => c.seg === sg.seg && c.role !== 'access')), plotprep: null }
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'plotprep0-'))
  const pub2 = PJ.publishRecord(dir2, key, () => ({ ...r0 }))
  const slot2 = PJ.takeSlot(dir2, key, 'K', 3)
  const e2 = bot(srv2, 'K', { inv: { cobblestone: 32, spruce_sapling: 2 }, feet: [20, G + 1, -50] })
  for (let i = 0; i < 4; i++) await R.runVisit({ dir: dir2, key, me: 'K', home: HOME, stood: [], record: r0, recordGen: pub2.gen, palette: T.TIDY_PALETTE, slot: slot2.slot, slotGen: slot2.gen, domain: () => true, walkR: 64, skipOpenDeps: true, clearMax: 40 }, e2, { maxSteps: 300 })
  assert.ok(/_log$/.test(srv2.read(TREE[0], G + 9, TREE[1]).name), 'control: without the stand the top log stands')
})
await t('Codex r1 BLOCKERS: an unread stand or log never retires the stand; a stand never on a door\'s approach or outside its plot; a cut never under another body', async () => {
  const srv = scene()
  const r = siteInwall(srv).record
  for (const c of r.plotprep.platforms[0].cells) srv.set(c, 'cobblestone')
  for (let y = G + 1; y <= G + 9; y++) srv.set([TREE[0], y, TREE[1]], 'air')
  const unread = (x, y, z) => (x === r.plotprep.platforms[0].cells[0][0] && z === r.plotprep.platforms[0].cells[0][2] ? null : srv.read(x, y, z))
  assert.strictEqual(T.platformTeardown(r, unread, r.sitedAt + 60_000), null, 'a stand cell unread: wait')
  const logUnread = (x, y, z) => (x === TREE[0] && z === TREE[1] ? null : srv.read(x, y, z))
  assert.strictEqual(T.platformTeardown(r, logUnread, r.sitedAt + 60_000), null, 'a log unread is never felled')
  // the stand runs along +x (26..28, z -54) and lands at 29: a door's front approach there refuses every side that way
  const p0 = T.plotPrep(scene().read, { plots: [X1], home: HOME, records: [] })
  const st = p0.platforms[0].cells
  const noStair = T.accessNoStair([{ plot: 'storehouse', frontOpen: [[st[0][0], st[0][2]]] }])
  const p1 = T.plotPrep(scene().read, { plots: [X1], home: HOME, records: [], noStair })
  assert.ok(!p1.platforms.some(q => q.cells.some(c => noStair(c[0], c[2]))), 'never on the approach')
  // a plot too narrow for the stand on any side: the tree is kept (no stand outside the plot)
  const narrow = { ...X1, box: [24, -55, 26, -53] }
  assert.strictEqual(T.plotPrep(scene().read, { plots: [narrow], home: HOME, records: [] }).platforms.length, 0)
  const s = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/tidyOk: \(q, rd\) => cutSafeNow\(rd, q\.at, tidyWater\(\)\) && !otherBodyOnCell\(bot, q\.at\)/.test(s), 'a tidy cut waits while another body stands on it')
})
console.log('PLOTPREP-02: A PROJECT SITED ON A PLOT WHILE ITS PREP RUNS (Codex fold r4 BLOCKER: 120 cuts pending under the workshop pad)')
await t('every plot entry carries its plot; a workshop sited on X1 later retires ALL its pending prep at execution time and on the record', async () => {
  const srv = scene()
  srv.set([15, G + 1, -60], 'dirt'); srv.set([16, G, -58], 'air')
  const r = siteInwall(srv).record
  const mine = q => q.plot === 'X1'
  assert.ok(r.cut.some(mine) && r.cells.some(mine) && r.clear.some(mine) && r.replant.some(mine), 'cuts, fills/stand, clears and replants tagged')
  assert.ok(r.cut.filter(c => c.at[0] >= 10 && c.at[0] <= 28 && c.at[2] >= -65 && c.at[2] <= -53).every(mine))
  assert.deepStrictEqual(r.plotprep.plots[0].box, X1.box)
  // the race: the workshop sites on X1 AFTER the stage was sited (its pad cells over the levelling)
  const shop = { plot: 'shop', cells: [{ at: [15, G + 1, -60], role: 'pad', seg: 'pad' }] }
  const sited = T.plotsSitedNow(r, [shop])
  assert.deepStrictEqual([...sited], ['X1'])
  for (const q of [...r.cut, ...r.cells, ...r.clear].filter(mine)) assert.ok(T.plotEntryRetired(q, sited), 'passed at execution')
  assert.strictEqual(T.plotsSitedNow(r, [{ plot: 'tidy', cells: shop.cells }, { plot: 'wallext', cells: shop.cells }]).size, 0, 'the groundskeeper\'s and the wall\'s own cells are no siting')
  // the record retired
  const r2 = T.plotRetire(r, sited)
  assert.ok(r2)
  assert.ok(![...r2.cut, ...r2.cells, ...r2.clear].some(mine), 'no plot cell, cut or clear left')
  assert.ok(r2.replant.filter(mine).every(q => q.state === 'skipped' && q.why === 'plot_sited'), 'replants skipped (the read\'s G5 counts only the rest)')
  assert.ok(r2.plotprep.platforms.every(p => p.phase === 'retired') && r2.plotprep.plots[0].retired)
  assert.ok(r2.segments.every(sg => r2.cells.some(c => c.seg === sg.seg)), 'no empty segment left')
  assert.strictEqual(T.plotsSitedNow(r2, [shop]).size, 0, 'once')
  assert.strictEqual(T.plotRetire(r2, new Set(['X1'])), null)
  assert.strictEqual(T.platformUp(r2), false, 'a retired stand holds no completion')
})
await t('mutant: the execution-time test blind to a later siting is caught (the cuts under the pad would run)', async () => {
  await withMutant(TIDY_PATH, "  for (const p of rec?.plotprep?.plots ?? []) if (p?.id != null && !p.sited && !p.retired && Array.isArray(p.box) && plotSited(p, records)) out.add(String(p.id))\n", '', async M => {
    const srv = scene(); srv.set([15, G + 1, -60], 'dirt')
    const r = siteInwall(srv).record
    const cutsUnderPad = r.cut.filter(c => c.plot === 'X1')
    assert.ok(cutsUnderPad.length > 0)
    const sited = M.plotsSitedNow(r, [{ plot: 'shop', cells: [{ at: [15, G + 1, -60] }] }])
    assert.ok(cutsUnderPad.every(c => !M.plotEntryRetired(c, sited)), 'the mutant would dig them')
  })
})
await t('WIRED: the visit passes sited plots\' entries (cells, cuts, clears) whoever visits; the keeper retires them first; a complete stage with a next one holds no stuck back-off; a completing visit is no idle mark', async () => {
  const s = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/const waivedK = q => plotEntryRetired\(q, plotsSited\) \|\|/.test(s), 'cells (fills, stands) passed')
  assert.ok(/const cuts0 = tidyCuts\(rec, read, mem\)\.filter\(q => !plotEntryRetired\(q, plotsSited\) &&/.test(s), 'cuts never dug')
  assert.ok(/if \(plotsSited\.size\) visitRec = \{ \.\.\.visitRec, clear: \(visitRec\.clear \?\? \[\]\)\.filter\(q => !plotEntryRetired\(q, plotsSited\)\) \}/.test(s), 'trees never felled')
  assert.ok(/plotRetire\(cur, plotsSitedNow\(cur, projectHeads\(\)/.test(s), 'the keeper retires them')
  assert.ok(/rec\?\.blueprint === TIDY_BLUEPRINT && \(gkStageDue\(rec\) \|\| stuckStale\(keys, rec, c => !!rec\.waived\?\.\[c\.at\.join\(','\)\] \|\| recordCellDone\(b, rec, c\)\)\)\) return true/.test(s), 'the quiet hours: no back-off over a due next stage')
  assert.ok(/gathered\?\.n > 0 \|\| completed \? 'success' : 'no_effect'/.test(s), 'a completing visit')
})
await t('mutant: no stand (a tall tree felled from the ground only) is caught', async () => {
  await withMutant(TIDY_PATH, '      if (need > 0) {\n', '      if (false) {\n', async M => {
    assert.strictEqual(M.plotPrep(scene().read, { plots: [X1], home: HOME, records: [] }).platforms.length, 0)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
