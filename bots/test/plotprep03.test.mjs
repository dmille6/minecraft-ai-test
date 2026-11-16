// PLOTPREP-03: A PLOT'S TREES FALL ONCE THEIR OWN SAPLINGS ARE SETTLED (bots/src/buildrun.mjs treeReplanted, `p.replantPerTree`,
// `p.replantGoOn`; skills.mjs buildTidy passes both for the groundskeeper). LIVE showcase 11-05: the enchanting workshop found no
// site on X1 (x 10..28, z -75..-63) -- its 17 x 11 shell fits the 19 x 13 plot in one place, and a 9-log spruce there is out of a
// builder's reach (tree_out_of_reach). The in-wall stage (gen 53, sited 15:34Z) planned X1's 4 trees (26 logs) and a stand; by
// 17:48Z none was felled: B4 waited for EVERY replant of the record (10 of 12 pending, x -62..-72, 80 blocks west), and each keeper
// visit ended at the first failed replant's remedy (`replanned`, 5 visits). The chain runs on the fake server, visit after visit.
import assert from 'node:assert'
const { B, R, PJ, G, k3, server, bot, BP, SITE, project, withMutant } = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

console.log('THE PURE RULE')
const planted = set => cell => set.has(cell.join(','))
await t('treeReplanted: a tagged tree waits for ITS replants only (same tree, same plot); skipped or planted settles one', () => {
  const rp = [
    { cell: [1, 0, 1], tree: 0, plot: 'X1', state: 'skipped' },
    { cell: [2, 0, 2], tree: 1, plot: 'X1', state: 'pending' },
    { cell: [3, 0, 3], tree: 2, plot: 'X1', state: 'pending' },
    { cell: [4, 0, 4], tree: 0, plot: 'X2', state: 'pending' },   // the same index on ANOTHER plot is another tree
  ]
  const p = planted(new Set(['3,0,3']))
  assert.strictEqual(R.treeReplanted(rp, { tree: 0, plot: 'X1' }, p), true)
  assert.strictEqual(R.treeReplanted(rp, { tree: 1, plot: 'X1' }, p), false)
  assert.strictEqual(R.treeReplanted(rp, { tree: 2, plot: 'X1' }, p), true)
  assert.strictEqual(R.treeReplanted(rp, { tree: 0, plot: 'X2' }, p), false)
  assert.strictEqual(R.treeReplanted(rp, { tree: 9, plot: 'X1' }, p), true, 'a tree that owes none')
})
await t('POSITIVE CONTROL (the old rule kept): an untagged clear, or a record with no tagged replant, waits for every replant', () => {
  const rp = [{ cell: [1, 0, 1], tree: 0, state: 'skipped' }, { cell: [2, 0, 2], tree: 1, state: 'pending' }]
  assert.strictEqual(R.treeReplanted(rp, { kind: 'tree' }, () => false), false)
  const untagged = [{ cell: [1, 0, 1], state: 'skipped' }, { cell: [2, 0, 2], state: 'pending' }]
  assert.strictEqual(R.treeReplanted(untagged, { tree: 0 }, () => false), false)
  assert.strictEqual(R.treeReplanted(untagged, { tree: 0 }, () => true), true)
})

// ---- the chain: two trees on the pad (X1#0 owes a skipped replant, X1#1 one no stand reaches and no cell replaces) --------
function twoTrees () {
  const pad = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad
  const a = [pad[30][0], G + 1, pad[30][1]], b = [pad[40][0], G + 1, pad[40][1]]
  const rp0 = { cell: [SITE.record.box[2] + 12, G + 1, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'skipped', tree: 0, plot: 'X1' }
  const rp1 = { cell: [SITE.record.box[2] + 10, G + 6, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending', tree: 1, plot: 'X1' }   // floating: no step
  const record = { ...SITE.record, clear: [{ at: a, kind: 'tree', name: 'oak_log', tree: 0, plot: 'X1' }, { at: b, kind: 'tree', name: 'oak_log', tree: 1, plot: 'X1' }], replant: [rp1, rp0] }
  return { a, b, record }
}
const RES = { column: () => 'plan_cell', zones: [] }   // no plantable cell anywhere: the floating replant is deferred, then skipped
async function firstVisit (M, opts) {
  const f = twoTrees(), srv = server({ [k3(f.a)]: 'oak_log', [k3(f.b)]: 'oak_log' }), pr = project(f.record)
  const h = PJ.recordHead(pr.dir, pr.key)
  const r = await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, res: RES, ...opts }, bot(srv, 'A'), { maxSteps: 2000 })
  return { r, srv, f, pr }
}

console.log('THE CHAIN (fake server)')
await t('with the groundskeeper\'s options: the failed replant is remedied, the visit GOES ON, and the tree whose sapling is settled falls; the other stands', async () => {
  const { r, srv, f, pr } = await firstVisit(R, { replantGoOn: true, replantPerTree: true })
  assert.notStrictEqual(r.stop, 'replanned', `the visit went on (${r.stop})`)
  assert.strictEqual(r.remedied, 1)
  // LIVE 11-05 19:04Z (batch 11): the remedy's own publish fenced the rest of the visit -- the visit adopts its own generation
  assert.notStrictEqual(r.stop, 'fence:record', 'the visit was fenced by its own remedy')
  assert.ok(r.placed > 0, `the segments were built after the remedy (placed ${r.placed}, stop ${r.stop})`)
  assert.notStrictEqual(srv.read(...f.a).name, 'oak_log', 'X1#0 felled (its replant is skipped)')
  assert.strictEqual(srv.read(...f.b).name, 'oak_log', 'X1#1 stands (its replant is still owed: B4)')
  assert.strictEqual(PJ.recordHead(pr.dir, pr.key).head.rec.replant[0].deferred, 1, 'the remedy was written')
})
await t('POSITIVE CONTROL (every other build): without the options the visit ends `replanned` and neither tree falls', async () => {
  const { r, srv, f } = await firstVisit(R, {})
  assert.strictEqual(r.stop, 'replanned')
  assert.strictEqual(srv.read(...f.a).name, 'oak_log'); assert.strictEqual(srv.read(...f.b).name, 'oak_log')
})
await t('the chain to the end: visit after visit the owed replant is skipped (REPLANT_DEFERS) and the second tree falls too', async () => {
  const f = twoTrees(), srv = server({ [k3(f.a)]: 'oak_log', [k3(f.b)]: 'oak_log' }), pr = project(f.record)
  for (let i = 0; i < R.REPLANT_DEFERS + 3; i++) {
    const h = PJ.recordHead(pr.dir, pr.key)
    const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, res: RES, replantGoOn: true, replantPerTree: true }, bot(srv, 'A'), { maxSteps: 2000 })
    if (r.stop === 'complete') break
  }
  assert.strictEqual(PJ.recordHead(pr.dir, pr.key).head.rec.replant[0].state, 'skipped')
  assert.notStrictEqual(srv.read(...f.b).name, 'oak_log', 'X1#1 felled after its replant was skipped')
})
await t('MUTANT: B4 global again (treeReady = replanted) -- the settled tree no longer falls on the first visit', async () => {
  await withMutant("const treeReady = c => (p.replantPerTree ? treeReplanted(record.replant ?? [], c, cell => SAPLING.test(nm(rd(...cell)))) : replanted())", 'const treeReady = c => replanted()', async M => {
    const { srv, f } = await firstVisit(M, { replantGoOn: true, replantPerTree: true })
    assert.strictEqual(srv.read(...f.a).name, 'oak_log')
  })
})
await t('MUTANT: the generation not adopted (the live bug) -- the visit is fenced `fence:record` after its own remedy', async () => {
  await withMutant('    p.recordGen = lp.gen\n', '', async M => {
    const { r } = await firstVisit(M, { replantGoOn: true, replantPerTree: true })
    assert.strictEqual(r.stop, 'fence:record')
  })
})
await t('another bot\'s generation in between: the visit ends as before (`replanned`), never adopting a head it has not read', async () => {
  const f = twoTrees(), srv = server({ [k3(f.a)]: 'oak_log', [k3(f.b)]: 'oak_log' }), pr = project(f.record)
  const h = PJ.recordHead(pr.dir, pr.key)
  PJ.publishRecord(pr.dir, pr.key, cur => ({ ...cur, note: 'another bot' }), { by: 'B' })   // the head moves past the visit's gen
  const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, res: RES, replantGoOn: true, replantPerTree: true }, bot(srv, 'A'), { maxSteps: 2000 })
  assert.ok(r.stop === 'replanned' || /^fence/.test(r.stop), r.stop)
  assert.ok(!r.remedied, 'never adopted')
})
await t('MUTANT: a remedy ends the visit again -- `replanned`, nothing felled', async () => {
  await withMutant("    if (!p.replantGoOn || o.stop !== 'replanned') return o\n", '    return o\n', async M => {
    const { r, srv, f } = await firstVisit(M, { replantGoOn: true, replantPerTree: true })
    assert.strictEqual(r.stop, 'replanned'); assert.strictEqual(srv.read(...f.a).name, 'oak_log')
  })
})

console.log('THE WIRING (structural)')
await t('skills.mjs buildTidy passes replantGoOn + replantPerTree with the groundskeeper\'s options', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(/\.\.\.\(GROUNDS\.on \? \{ tidyKeepOrder: true, deferSpent: true, replantGoOn: true, replantPerTree: true \} : \{\}\)/.test(src))
})

console.log(`\nplotprep03: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
