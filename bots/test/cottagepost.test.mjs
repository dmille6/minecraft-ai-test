// COTTAGEPOST-01 (bots/src/buildrun.mjs ownLog / ownLogAt, the clears pass, treeDownFor). LIVE showcase 11-09..11-12, cottage1: a
// spruce stood on the corner post's column at siting, so the record lists `clear {kind:'tree', name:'spruce_log'}` at -8,67..69,-37 --
// the cells its plan fills with `post: ['spruce_log']`. Every visit felled the posts it had placed (10:26:32Z and 10:26:42Z on 11-12,
// the second one an owner one-off repair) and then could not place the upper one from the ground: stuck_on_cell, the project STALLED
// for three days. The rule: a listed trunk cell that holds the building's OWN log is no clear at all. Behaviour on the fake server,
// the old felling as the positive control (three anchored mutants, one per guard).
import assert from 'node:assert'
import fs from 'node:fs'
const { R, PJ, G, k3, server, bot, BP, SITE, project, KIT, withMutant } = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const PAL = { post: ['spruce_log'], wall: ['spruce_planks', '$planks'], core: [R.SOLID_ANY], base: ['stone_bricks'] }
const log = (axis = 'y', name = 'spruce_log') => ({ name, boundingBox: 'block', props: { axis } })
const TREE = { at: [1, 2, 3], kind: 'tree', name: 'spruce_log' }

console.log('THE PURE RULE')
await t('ownLog: a listed trunk cell holding the post its role names, upright, is the building\'s own', () => {
  assert.strictEqual(R.ownLog(TREE, { at: [1, 2, 3], role: 'post', ws: { axis: 'y' } }, PAL, log('y')), true)
  assert.strictEqual(R.ownLog(TREE, { at: [1, 2, 3], role: 'post' }, PAL, log('y')), true, 'a cell that names no state: the family is enough')
})
await t('ownLog: never a log the plan does not want there (the tree it was listed as)', () => {
  const post = { at: [1, 2, 3], role: 'post', ws: { axis: 'y' } }
  assert.strictEqual(R.ownLog(TREE, post, PAL, log('x')), false, 'a log on its side is not the post')
  assert.strictEqual(R.ownLog(TREE, post, PAL, log('y', 'oak_log')), false, 'another species')
  assert.strictEqual(R.ownLog(TREE, { at: [1, 2, 3], role: 'fill' }, PAL, log('y')), false, 'a fill takes any solid block: still the tree')
  assert.strictEqual(R.ownLog(TREE, { at: [1, 2, 3], role: 'core' }, PAL, log('y')), false, 'a *solid core takes any solid block: still the tree (monument-01)')
  assert.strictEqual(R.ownLog(TREE, { at: [1, 2, 3], role: 'wall' }, PAL, log('y')), false, 'a wall of planks')
  assert.strictEqual(R.ownLog(TREE, { at: [1, 2, 3], role: 'base' }, PAL, log('y')), false, 'the pad under the trunk')
  assert.strictEqual(R.ownLog(TREE, null, PAL, log('y')), false, 'no record cell there')
  assert.strictEqual(R.ownLog(TREE, post, PAL, null), false, 'an unread cell')
  assert.strictEqual(R.ownLog(TREE, post, null, log('y')), false, 'no palette')
  assert.strictEqual(R.ownLog({ ...TREE, kind: 'leaves' }, post, PAL, log('y')), false, 'only a tree clear')
})
await t('treeDownFor: the trunk felled everywhere but the cells that are now posts reads DOWN; a trunk log in a pad cell reads standing', () => {
  const cells = [{ at: [0, 3, 0], role: 'post', ws: { axis: 'y' } }, { at: [0, 2, 0], role: 'base' }]
  const record = { cells, palette: PAL, clear: [0, 1, 2, 3, 4].map(y => ({ at: [0, y, 0], kind: 'tree', name: 'spruce_log' })) }
  const world = m => (x, y, z) => m[`${x},${y},${z}`] ?? { name: 'air', boundingBox: 'empty' }
  assert.strictEqual(R.treeDownFor(record, {}, world({ '0,3,0': log('y') })), true, 'only the post stands')
  assert.strictEqual(R.treeDownFor(record, {}, world({ '0,3,0': log('y'), '0,2,0': log('y') })), false, 'the trunk in the pad cell is still the tree')
  assert.strictEqual(R.treeDownFor(record, {}, world({ '0,3,0': log('x') })), false, 'a log on its side in the post cell is not the post')
  assert.strictEqual(R.treeDownFor({ ...record, palette: undefined }, {}, world({ '0,3,0': log('y') }), PAL), true, 'the caller\'s palette')
  assert.strictEqual(R.treeDownFor({ ...record, palette: undefined }, {}, world({ '0,3,0': log('y') })), false, 'no palette: the old rule')
})

// ---- the chain: the workshop finished, one wall cell re-roled a post of oak_log, the record listing the tree that stood there ----
const PALETTE = { ...BP.palette, post: ['oak_log'] }
function scene ({ extra = [] } = {}) {
  // the LAST wall-B cell: one a stand outside reaches for a dig in the finished building (the first is an enclosed corner: no dig stand,
  // so the old code could not fell it either -- the positive control below would prove nothing)
  const target = SITE.record.cells.filter(c => c.seg === 'wall-B' && c.role === 'wall').at(-1)
  const cells = SITE.record.cells.map(c => (c === target ? { ...c, role: 'post' } : c))
  // the tree as sited: its trunk on the post's cell, and one log more on a cell no plan fills (beside the pad, in the open)
  const record = { ...SITE.record, cells, clear: [{ at: target.at, kind: 'tree', name: 'oak_log' }, ...extra], replant: [] }
  const world = Object.fromEntries(cells.map(c => [k3(c.at), c.role === 'fill' ? 'dirt' : c.role === 'post' ? 'oak_log' : R.roleFirst(BP.palette, c.role)]))
  for (const x of extra) world[k3(x.at)] = x.name
  const srv = server(world), pr = project(record)
  return { at: target.at, record, srv, pr }
}
async function visit (M, { extra, unknown = null, probe } = {}) {
  const s = scene({ extra })
  const h = PJ.recordHead(s.pr.dir, s.pr.key)
  const e = bot(s.srv, 'A', { inv: KIT(), ...(probe ? { probe } : {}) })
  const r = await M.runVisit({ ...s.pr.p('A'), palette: PALETTE, record: h.head.rec, recordGen: h.head.gen, ...(unknown ? { unknown: unknown(s) } : {}) }, e, { maxSteps: 800 })
  const clears = e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear').map(([, d]) => k3(d.cell))
  const leases = fs.readdirSync(s.pr.dir).filter(f => f.includes('seg-clear'))
  return { ...s, r, clears, leases, logs: e.logs }
}
const stands = async M => {
  const v = await visit(M)
  assert.strictEqual(v.srv.read(...v.at).name, 'oak_log', 'the post stands after the visit')
  assert.deepStrictEqual(v.clears, [], 'no clear row')
  assert.strictEqual(v.r.cleared, 0)
  assert.strictEqual(v.r.stop, 'complete', `the finished building reads complete (${v.r.stop}: ${v.r.why})`)
}

console.log('THE CHAIN (fake server)')
await t('the post on the listed trunk cell is not felled, and the finished building reads complete', () => stands(R))
await t('POSITIVE CONTROL (the live loop): without the rule the visit fells its own post and cannot put it back', async () => {
  await withMutant("  return cellDone(b, palette, cell.role, cell.ws ?? null)\n}\n/** ownLog over a record", "  return false\n}\n/** ownLog over a record", async M => {
    const v = await visit(M)
    assert.deepStrictEqual(v.clears, [k3(v.at)], 'the post was felled as a tree')
    assert.notStrictEqual(v.srv.read(...v.at).name, 'oak_log', 'and the bag holds no log to place it again')
    assert.notStrictEqual(v.r.stop, 'complete')
  })
})
await t('a real trunk log beside it (a cell no plan fills) is still felled: the rule keeps only the building\'s own block', async () => {
  const beside = [SITE.record.box[2] + 2, G + 1, SITE.record.box[1]]
  const v = await visit(R, { extra: [{ at: beside, kind: 'tree', name: 'oak_log' }] })
  assert.strictEqual(v.srv.read(...v.at).name, 'oak_log', 'the post stands')
  assert.deepStrictEqual(v.clears, [k3(beside)], 'the trunk log in the open is felled, and only it')
  assert.notStrictEqual(v.srv.read(...beside).name, 'oak_log')
})
await t('only own posts listed: the clears pass has no work at all (no clear lease is taken from the other builders)', async () => {
  const v = await visit(R)
  assert.deepStrictEqual(v.leases, [])
  await withMutant("(nm(e.read(...c.at)) === c.name && !ownNow(c))", "(nm(e.read(...c.at)) === c.name)", async M => {
    const m = await visit(M)
    assert.ok(m.leases.length > 0, 'mutant: the pass takes its lease for a list it then skips')
    assert.strictEqual(m.srv.read(...m.at).name, 'oak_log', 'the guard at the dig still holds the post')
  })
})
await t('an UNKNOWN cell that resolves to the post is not felled (the guard at the dig), and is felled without it', async () => {
  const unknown = s => new Set([k3(s.at)])
  const probe = async () => 'oak_log'
  const v = await visit(R, { unknown, probe })
  assert.strictEqual(v.srv.read(...v.at).name, 'oak_log'); assert.deepStrictEqual(v.clears, [])
  await withMutant("        if (ownAtDig(c)) continue ", "        ", async M => {
    const m = await visit(M, { unknown, probe })
    assert.deepStrictEqual(m.clears, [k3(m.at)], 'mutant: the resolved post is felled')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
