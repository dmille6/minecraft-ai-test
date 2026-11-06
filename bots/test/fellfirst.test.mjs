// FELLFIRST-01 (bots/src/buildrun.mjs treeOwed / fellFirstOk / `p.saplingAbsent`; skills.mjs swSaplingAbsent for the stepwell's
// felling). LIVE showcase 11-06: the stepwell's visits ended "felling complete, 17 logs left" for hours -- tree 5's replant
// (-68,67,12) waited on a spruce sapling no bag and no town chest held (B4: never a tree before its sapling), and only felling a
// spruce yields one. Owner via coordinator 11-06: when no sapling of the needed kind exists in any bag or town chest, fell first,
// then replant from the tree's own drops. Behaviour on the fake server, the old wait as the positive control, an anchored mutant.
import assert from 'node:assert'
const { R, PJ, G, k3, server, bot, BP, SITE, project, KIT, withMutant } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

console.log('THE PURE RULES')
await t('treeOwed: the tree\'s own unsettled replants (tagged), else every one; skipped and planted ones are settled', () => {
  const rp = [{ cell: [1, 0, 1], tree: 0, state: 'pending', sapling: 'spruce_sapling' }, { cell: [2, 0, 2], tree: 1, state: 'skipped', sapling: 'spruce_sapling' },
    { cell: [3, 0, 3], tree: 1, state: 'pending', sapling: 'oak_sapling' }]
  const none = () => false
  assert.deepStrictEqual(R.treeOwed(rp, { tree: 1 }, none).map(r => r.cell[0]), [3])
  assert.deepStrictEqual(R.treeOwed(rp, { tree: 0 }, c => c[0] === 1).map(r => r.cell[0]), [], 'planted: settled')
  assert.deepStrictEqual(R.treeOwed([{ cell: [5, 0, 5], state: 'pending', sapling: 'oak_sapling' }], { tree: 3 }, none).length, 1, 'untagged: every replant')
})
await t('fellFirstOk: only when the caller names `absent` and EVERY owed replant is of a kind the bag lacks and the town lacks', () => {
  const owed = [{ sapling: 'spruce_sapling' }]
  assert.strictEqual(R.fellFirstOk(owed, { has: () => false, absent: () => true }), true)
  assert.strictEqual(R.fellFirstOk(owed, { has: () => false }), false, 'no absent test: the old wait')
  assert.strictEqual(R.fellFirstOk(owed, { has: () => false, absent: () => false }), false, 'the town holds one: wait for it')
  assert.strictEqual(R.fellFirstOk(owed, { has: () => true, absent: () => true }), false, 'the bag holds one: plant it first')
  assert.strictEqual(R.fellFirstOk([...owed, { sapling: 'oak_sapling' }], { has: () => false, absent: n => n === 'spruce_sapling' }), false, 'one owed kind the town has: wait')
  assert.strictEqual(R.fellFirstOk([], { absent: () => true }), false, 'nothing owed: treeReady already let it fall')
})

// ---- the chain: a tree on the pad owing an oak sapling, the bag without one -------------------------------------------------
function scene () {
  const log = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[30]
  const at = [log[0], G + 1, log[1]]
  const rp = { cell: [SITE.record.box[2] + 10, G + 1, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending', tree: 0, plot: 'SW' }
  const record = { ...SITE.record, clear: [{ at, kind: 'tree', name: 'oak_log', tree: 0, plot: 'SW' }], replant: [rp] }
  const srv = server({ [k3(at)]: 'oak_log' }), pr = project(record)
  const inv = KIT(); delete inv.oak_sapling
  return { at, srv, pr, inv }
}
async function visit (M, opts) {
  const s = scene()
  const h = PJ.recordHead(s.pr.dir, s.pr.key)
  const e = bot(s.srv, 'A', { inv: s.inv })
  const r = await M.runVisit({ ...s.pr.p('A'), record: h.head.rec, recordGen: h.head.gen, replantGoOn: true, replantPerTree: true, ...opts }, e, { maxSteps: 400 })
  return { ...s, r, logs: e.logs }
}

console.log('THE CHAIN (fake server)')
await t('POSITIVE CONTROL (the live dead end): no sapling in the bag, no absent test -- the tree waits, every visit', async () => {
  const { srv, at } = await visit(R, {})
  assert.strictEqual(srv.read(...at).name, 'oak_log')
})
await t('with `saplingAbsent` naming oak_sapling: the tree is felled FIRST and its row says first=1', async () => {
  const { srv, at, r, logs } = await visit(R, { saplingAbsent: n => n === 'oak_sapling' })
  assert.notStrictEqual(srv.read(...at).name, 'oak_log', 'the tree came down')
  assert.strictEqual(r.felledFirst, 1)
  const row = logs.find(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'tree')
  assert.ok(row && row[1].first === 1, JSON.stringify(row))
})
await t('the town holds the kind (absent false): the tree still waits for its sapling', async () => {
  const { srv, at } = await visit(R, { saplingAbsent: () => false })
  assert.strictEqual(srv.read(...at).name, 'oak_log')
})
await t('MUTANT: fellFirstOk never allows -- the tree waits again (the test fails for that reason)', async () => {
  await withMutant("  if (typeof absent !== 'function' || !owed.length) return false\n", "  return false\n", async M => {
    const { srv, at } = await visit(M, { saplingAbsent: n => n === 'oak_sapling' })
    assert.strictEqual(srv.read(...at).name, 'oak_log')
  })
})
await t('the row writer carries `first` (shop.mjs buildRowDetail) and the stepwell felling names its absent test (structural)', async () => {
  const { buildRowDetail } = await import('../src/shop.mjs')
  assert.match(buildRowDetail({ project: 'stepwell', op: 'clear', cell: [1, 2, 3], kind: 'tree', saplings: '7/8', first: 1 }), / saplings=7\/8 first=1( |$)/)
  assert.ok(!/first=/.test(buildRowDetail({ project: 'stepwell', op: 'clear', cell: [1, 2, 3], kind: 'tree', saplings: '8/8' })), 'absent field: not written')
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(/replantGoOn: true, replantPerTree: true, saplingAbsent: swSaplingAbsent\(bot\) \}/.test(src))
})

console.log(`\nfellfirst: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
